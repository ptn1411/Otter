package vn.phonecloud.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat

/**
 * Dịch vụ nền: giữ kết nối tới server, quay màn hình khi phía web bật stream.
 * Nhận quyền quay màn hình (resultCode + data) từ MainActivity qua Intent extras.
 * Lưu ý Android 14+: mỗi lần cấp quyền chỉ dùng được một lần; sau khi khởi động lại
 * máy hoặc dừng hẳn dịch vụ, người dùng cần bấm "Bật dịch vụ" để cấp quyền lại.
 */
class AgentService : Service() {

    companion object {
        private const val TAG = "AgentService"
        private const val CHANNEL_ID = "phonecloud_agent"
        private const val NOTIF_ID = 1001
        const val EXTRA_RESULT_CODE = "result_code"
        const val EXTRA_RESULT_DATA = "result_data"
        @Volatile var running = false
        @Volatile var statusText = ""
    }

    private var projection: MediaProjection? = null
    private var encoder: ScreenEncoder? = null
    private var socketClient: SocketClient? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var screenW = 0
    private var screenH = 0
    private var density = 0
    private var qualityHeight = 720
    private var fps = 30
    private var streaming = false
    private var lastW = 0
    private var lastH = 0
    private var lastSps = ""
    private var lastPps = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(metrics)
        screenW = metrics.widthPixels
        screenH = metrics.heightPixels
        density = metrics.densityDpi

        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PhoneCloud:agent").apply {
            setReferenceCounted(false)
            acquire(12 * 60 * 60 * 1000L) // tối đa 12 giờ
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Giữ dịch vụ bằng dataSync trước. Chỉ chuyển sang mediaProjection
        // ngay trước getMediaProjection, sau khi người dùng đã đồng ý quay màn hình.
        startForegroundWithType(capturing = false)

        // Nhận quyền quay màn hình nếu được truyền vào
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val resultData: Intent? = intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        if (resultCode != 0 && resultData != null && projection == null) {
            try {
                startForegroundWithType(capturing = true)
                val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                projection = mpm.getMediaProjection(resultCode, resultData)
                projection?.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        Log.i(TAG, "projection stopped by system")
                        streaming = false
                        encoder?.stop()
                        projection = null
                    }
                }, null)
                Log.i(TAG, "media projection ready")
            } catch (e: Exception) {
                Log.e(TAG, "getMediaProjection failed", e)
                try { startForegroundWithType(capturing = false) } catch (_: Exception) {}
            }
        }

        if (socketClient == null) {
            val server = Prefs.getServer(this)
            val key = Prefs.getKey(this)
            if (server.isEmpty() || key.isEmpty()) {
                statusText = "Chưa đăng ký thiết bị / chưa có địa chỉ server"
                Log.w(TAG, statusText)
            } else {
                socketClient = SocketClient(
                    ctx = this,
                    serverUrl = server,
                    key = key,
                    screenWidth = screenW,
                    screenHeight = screenH,
                    onStream = { on -> if (on) startStreaming() else stopStreaming() },
                    onKeyFrameRequest = { encoder?.requestKeyFrame() },
                    onStatus = { s -> statusText = s; Log.i(TAG, s) },
                    onSettings = { q, f -> applyQuality(q, f) }
                ).also { it.connect() }
            }
        }
        running = true
        return START_STICKY
    }

    private fun startForegroundWithType(capturing: Boolean) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Otter Phone", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val openIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Otter Phone đang hoạt động")
            .setContentText("Đã kết nối sẵn sàng nhận lệnh điều khiển từ Otter")
            .setSmallIcon(R.drawable.ic_stat_otter)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            val type = if (capturing) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            }
            startForeground(NOTIF_ID, notif, type)
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun applyQuality(q: Int, f: Int) {
        val nextQ = when {
            q <= 360 -> 360
            q <= 480 -> 480
            q <= 720 -> 720
            else -> 1080
        }
        val nextF = when {
            f <= 15 -> 15
            f <= 24 -> 24
            else -> 30
        }
        val changed = nextQ != qualityHeight || nextF != fps
        qualityHeight = nextQ
        fps = nextF
        statusText = "Chất lượng ${qualityHeight}p / ${fps}fps"
        if (changed && streaming) {
            encoder?.stop()
            encoder?.start(qualityHeight, fps)
        }
    }

    private fun startStreaming() {
        streaming = true
        val proj = projection
        if (proj == null) {
            Log.w(TAG, "stream requested but no projection permission")
            socketClient?.emitMessage("need_permission")
            // Mở app lên để người dùng cấp quyền quay màn hình
            val i = Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { startActivity(i) } catch (_: Exception) {}
            return
        }
        if (encoder == null) {
            encoder = ScreenEncoder(
                projection = proj,
                screenWidth = screenW,
                screenHeight = screenH,
                screenDensity = density,
                onMeta = { w, h, sps, pps ->
                    lastW = w; lastH = h; lastSps = sps; lastPps = pps
                    socketClient?.emitMeta(w, h, sps, pps, screenW, screenH)
                },
                onFrame = { frame -> socketClient?.emitFrame(frame) },
                onError = { msg -> socketClient?.emitMessage("encoder_error", org.json.JSONObject().put("msg", msg)) }
            )
        }
        encoder?.start(qualityHeight = qualityHeight, fps = fps)
        if (lastSps.isNotEmpty()) socketClient?.emitMeta(lastW, lastH, lastSps, lastPps, screenW, screenH)
        encoder?.requestKeyFrame()
        socketClient?.emitMessage("orientation", org.json.JSONObject().apply {
            put("value", if (screenH >= screenW) "portrait" else "landscape")
            put("width", screenW)
            put("height", screenH)
        })
    }

    private fun stopStreaming() {
        streaming = false
        encoder?.stop()
    }

    override fun onDestroy() {
        running = false
        stopStreaming()
        socketClient?.disconnect()
        socketClient = null
        try { projection?.stop() } catch (_: Exception) {}
        projection = null
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
        super.onDestroy()
    }
}
