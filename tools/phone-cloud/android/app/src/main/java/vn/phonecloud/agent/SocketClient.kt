package vn.phonecloud.agent

import android.accessibilityservice.AccessibilityService
import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.Log
import android.view.Display
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Kết nối Socket.IO tới server PhoneCloud + điều phối lệnh từ phía web.
 * Lệnh cần phản hồi (findElements, appEvent...) trả về qua sự kiện "result" kèm taskId.
 */
class SocketClient(
    private val ctx: Context,
    private val serverUrl: String,
    private val key: String,
    private val screenWidth: Int,
    private val screenHeight: Int,
    private val onStream: (Boolean) -> Unit,
    private val onKeyFrameRequest: () -> Unit,
    private val onStatus: (String) -> Unit,
    private val onSettings: (quality: Int, fps: Int) -> Unit
) {
    companion object { private const val TAG = "SocketClient" }

    private var socket: Socket? = null
    private val executor = Executors.newSingleThreadExecutor()

    fun connect() {
        try {
            val opts = IO.Options().apply {
                transports = arrayOf("websocket", "polling")
                reconnection = true
                reconnectionDelay = 2000
                reconnectionAttempts = Int.MAX_VALUE
            }
            val s = IO.socket(serverUrl, opts)
            socket = s

            s.on(Socket.EVENT_CONNECT) {
                Log.i(TAG, "socket connected")
                s.emit("join_room", JSONObject().apply {
                    put("key", key)
                    put("width", screenWidth)
                    put("height", screenHeight)
                })
            }
            s.on("joined") { args ->
                val d = args.firstOrNull() as? JSONObject
                val ok = d?.optBoolean("status") == true
                onStatus(if (ok) "Đã kết nối server" else "Server từ chối: ${d?.optString("msg")}")
                if (ok) onSettings(d?.optInt("quality", 720) ?: 720, d?.optInt("fps", 30) ?: 30)
            }
            s.on("settings") { args ->
                val d = args.firstOrNull() as? JSONObject ?: return@on
                onSettings(d.optInt("quality", 720), d.optInt("fps", 30))
            }
            s.on("stream") { args ->
                val d = args.firstOrNull() as? JSONObject
                onStream(d?.optBoolean("status") == true)
            }
            s.on("command") { args ->
                val cmd = args.firstOrNull() as? JSONObject ?: return@on
                executor.execute { handleCommand(cmd) }
            }
            s.on(Socket.EVENT_DISCONNECT) { onStatus("Mất kết nối server, đang thử lại...") }
            s.connect()
        } catch (e: Exception) {
            Log.e(TAG, "connect failed", e)
            onStatus("Lỗi kết nối: ${e.message}")
        }
    }

    fun disconnect() {
        try { socket?.disconnect() } catch (_: Exception) {}
        socket = null
    }

    fun emitMeta(
        width: Int,
        height: Int,
        spsB64: String,
        ppsB64: String,
        screenWidth: Int = 0,
        screenHeight: Int = 0
    ) {
        socket?.emit("video_meta", JSONObject().apply {
            put("width", width)
            put("height", height)
            put("sps", spsB64)
            put("pps", ppsB64)
            if (screenWidth > 0) put("screenWidth", screenWidth)
            if (screenHeight > 0) put("screenHeight", screenHeight)
        })
    }

    fun emitFrame(frame: ByteArray) {
        socket?.emit("screen", frame)
    }

    fun emitMessage(action: String, extra: JSONObject = JSONObject()) {
        socket?.emit("message", extra.apply { put("action", action) })
    }

    private fun reply(taskId: String, status: Boolean, data: Any? = null, msg: String? = null) {
        socket?.emit("result", JSONObject().apply {
            put("taskId", taskId)
            put("status", status)
            if (data != null) put("data", data)
            if (msg != null) put("msg", msg)
        })
    }

    private fun handleCommand(cmd: JSONObject) {
        val action = cmd.optString("action")
        val taskId = cmd.optString("taskId", "0")
        val a11y = ControlAccessibilityService.instance
        try {
            when (action) {
                "pointerEvent" -> {
                    a11y?.pointer(cmd.optString("phase"), cmd.optInt("x"), cmd.optInt("y"))
                }
                "touchEvent", "clickEvent" -> {
                    a11y?.tap(cmd.optInt("x"), cmd.optInt("y"))
                }
                "swipeEvent" -> {
                    a11y?.swipe(
                        cmd.optInt("start_x"), cmd.optInt("start_y"),
                        cmd.optInt("end_x"), cmd.optInt("end_y"),
                        cmd.optLong("duration", 300)
                    )
                }
                "wheelEvent" -> {
                    a11y?.wheel(cmd.optInt("x"), cmd.optInt("y"), cmd.optInt("deltaY"))
                }
                "keyEvent" -> {
                    val k = cmd.optString("keyName")
                    when (k.uppercase()) {
                        "BACK", "HOME", "RECENTS", "NOTIFICATIONS" -> a11y?.globalAction(k)
                        else -> {
                            val ime = AgentIME.instance
                            if (ime == null || !ime.sendKey(k)) a11y?.globalAction(k)
                        }
                    }
                }
                "setTextEvent" -> {
                    val text = cmd.optString("text")
                    val ime = AgentIME.instance
                    val ok = (ime != null && ime.commitText(text)) || (a11y?.setTextFocused(text) == true)
                    if (!ok) Log.w(TAG, "setTextEvent failed (IME chưa chọn / không có ô focus)")
                }
                "findElements" -> {
                    val list = a11y?.findElements(cmd.optString("xpath")) ?: emptyList()
                    reply(taskId, a11y != null, JSONArray(list.map { JSONObject(it) }),
                        if (a11y == null) "chưa bật Accessibility" else null)
                }
                "clickElement" -> {
                    val ok = a11y?.clickElement(cmd.optString("xpath")) == true
                    reply(taskId, ok, JSONObject().put("done", ok),
                        if (!ok) "không tìm thấy phần tử" else null)
                }
                "setTextElement" -> {
                    val ok = a11y?.setTextElement(cmd.optString("xpath"), cmd.optString("text")) == true
                    reply(taskId, ok, JSONObject().put("done", ok),
                        if (!ok) "không tìm thấy phần tử" else null)
                }
                "appEvent" -> handleAppEvent(cmd, taskId)
                "clipboard" -> handleClipboard(cmd, taskId)
                "screenshot" -> handleScreenshot(taskId)
                "power" -> a11y?.globalAction("POWER")
                "onSyncIFrame" -> onKeyFrameRequest()
                "timeSync" -> reply(taskId, true, JSONObject().put("time", System.currentTimeMillis()))
                "toastEvent" -> { /* bỏ qua: không hiển thị toast từ xa */ }
                else -> Log.w(TAG, "lệnh chưa hỗ trợ: $action")
            }
        } catch (e: Exception) {
            Log.e(TAG, "handleCommand $action failed", e)
            reply(taskId, false, null, e.message)
        }
    }

    private fun handleAppEvent(cmd: JSONObject, taskId: String) {
        val command = cmd.optString("command")
        val pkg = cmd.optString("packageName")
        when (command) {
            "start" -> {
                val intent = ctx.packageManager.getLaunchIntentForPackage(pkg)
                if (intent == null) return reply(taskId, false, null, "không tìm thấy app $pkg")
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
                reply(taskId, true, JSONObject().put("done", true))
            }
            "stop" -> {
                val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                am.killBackgroundProcesses(pkg)
                reply(taskId, true, JSONObject().put("done", true).put("note", "killBackgroundProcesses"))
            }
            "clear" -> {
                // Android không cho app thường xóa dữ liệu app khác.
                reply(taskId, false, null, "xóa dữ liệu app khác cần quyền hệ thống (device owner/root)")
            }
            "uninstall" -> {
                val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
                reply(taskId, true, JSONObject().put("done", true).put("note", "đã mở màn hình gỡ cài đặt, cần xác nhận trên máy"))
            }
            "openInfo" -> {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                ctx.startActivity(intent)
                reply(taskId, true, JSONObject().put("done", true))
            }
            else -> reply(taskId, false, null, "command không hỗ trợ: $command")
        }
    }

    private fun handleClipboard(cmd: JSONObject, taskId: String) {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        when (cmd.optString("command")) {
            "set" -> {
                cm.setPrimaryClip(ClipData.newPlainText("phonecloud", cmd.optString("text")))
                reply(taskId, true, JSONObject().put("done", true))
            }
            "get" -> {
                val text = cm.primaryClip?.getItemAt(0)?.coerceToText(ctx)?.toString() ?: ""
                reply(taskId, true, JSONObject().put("text", text))
            }
            else -> reply(taskId, false, null, "command không hỗ trợ")
        }
    }

    private fun handleScreenshot(taskId: String) {
        val a11y = ControlAccessibilityService.instance
        if (a11y == null || Build.VERSION.SDK_INT < 30) {
            return reply(taskId, false, null, "cần Accessibility + Android 11+")
        }
        a11y.takeScreenshot(
            Display.DEFAULT_DISPLAY,
            executor,
            object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
                    try {
                        val hw = result.hardwareBuffer
                        val bmp = Bitmap.wrapHardwareBuffer(hw, result.colorSpace)
                        if (bmp == null) {
                            reply(taskId, false, null, "không tạo được bitmap")
                        } else {
                            val soft = bmp.copy(Bitmap.Config.ARGB_8888, false)
                            val out = ByteArrayOutputStream()
                            soft.compress(Bitmap.CompressFormat.PNG, 100, out)
                            reply(
                                taskId,
                                true,
                                JSONObject().put(
                                    "pngBase64",
                                    Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                                )
                            )
                        }
                        hw.close()
                    } catch (e: Exception) {
                        reply(taskId, false, null, e.message)
                    }
                }

                override fun onFailure(errorCode: Int) {
                    reply(taskId, false, null, "takeScreenshot thất bại (mã lỗi $errorCode)")
                }
            }
        )
    }
}
