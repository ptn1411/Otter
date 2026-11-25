package vn.phonecloud.agent

import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import java.nio.ByteBuffer
import kotlin.math.roundToInt

/**
 * Quay màn hình bằng MediaProjection -> VirtualDisplay -> MediaCodec (H.264).
 * Mỗi frame xuất ra: [1 byte cờ (bit0 = keyframe)][8 byte PTS micro giây, big-endian][dữ liệu Annex B].
 * SPS/PPS lấy từ csd-0/csd-1 của định dạng đầu ra, gửi qua callback onMeta (base64).
 */
class ScreenEncoder(
    private val projection: MediaProjection,
    private val screenWidth: Int,
    private val screenHeight: Int,
    private val screenDensity: Int,
    private val onMeta: (width: Int, height: Int, spsB64: String, ppsB64: String) -> Unit,
    private val onFrame: (ByteArray) -> Unit,
    private val onError: (String) -> Unit
) {
    companion object {
        private const val TAG = "ScreenEncoder"
        private const val MIME = MediaFormat.MIMETYPE_VIDEO_AVC

        /** Độ phân giải theo chiều cao mục tiêu, giữ tỉ lệ màn hình, làm tròn chẵn. */
        fun scaledSize(sw: Int, sh: Int, targetHeight: Int): Pair<Int, Int> {
            if (targetHeight <= 0 || sh <= targetHeight) return sw to sh
            val ratio = targetHeight.toDouble() / sh
            var w = (sw * ratio).roundToInt()
            var h = targetHeight
            if (w % 2 != 0) w--
            if (h % 2 != 0) h--
            return w.coerceAtLeast(2) to h.coerceAtLeast(2)
        }

        fun bitrateFor(height: Int): Int = when {
            height <= 240 -> 400_000
            height <= 360 -> 800_000
            height <= 480 -> 1_200_000
            height <= 720 -> 3_000_000
            height <= 1080 -> 6_000_000
            else -> 10_000_000
        }
    }

    private var codec: MediaCodec? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile private var generation = 0

    fun start(qualityHeight: Int = 720, fps: Int = 30) {
        if (running) return
        val gen = ++generation
        val (w, h) = scaledSize(screenWidth, screenHeight, qualityHeight)
        try {
            fun makeFormat(lowLatency: Boolean) = MediaFormat.createVideoFormat(MIME, w, h).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, bitrateFor(h))
                setInteger(MediaFormat.KEY_FRAME_RATE, fps)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
                setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
                setInteger(MediaFormat.KEY_PRIORITY, 0)
                if (lowLatency && Build.VERSION.SDK_INT >= 30) setInteger(MediaFormat.KEY_LATENCY, 1)
            }
            var c = MediaCodec.createEncoderByType(MIME)
            try {
                c.configure(makeFormat(true), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            } catch (e: Exception) {
                Log.w(TAG, "low-latency configure failed, retry", e)
                try { c.release() } catch (_: Exception) {}
                c = MediaCodec.createEncoderByType(MIME)
                c.configure(makeFormat(false), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            }
            val surface = c.createInputSurface()
            c.start()
            codec = c
            virtualDisplay = projection.createVirtualDisplay(
                "PhoneCloudDisplay", w, h, screenDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null
            )
            running = true
            thread = Thread({ drainLoop(w, h, gen) }, "pc-encoder").apply { start() }
            Log.i(TAG, "encoder started ${w}x${h}")
        } catch (e: Exception) {
            Log.e(TAG, "start failed", e)
            onError("encoder: ${e.message}")
            stop()
        }
    }

    private fun drainLoop(w: Int, h: Int, gen: Int) {
        val c = codec ?: return
        val info = MediaCodec.BufferInfo()
        var metaSent = false
        while (running) {
            try {
                val idx = c.dequeueOutputBuffer(info, 10_000)
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val f = c.outputFormat
                    val csd0 = f.getByteBuffer("csd-0")
                    val csd1 = f.getByteBuffer("csd-1")
                    if (csd0 != null && csd1 != null) {
                        onMeta(
                            w, h,
                            Base64.encodeToString(stripStartCode(csd0), Base64.NO_WRAP),
                            Base64.encodeToString(stripStartCode(csd1), Base64.NO_WRAP)
                        )
                        metaSent = true
                    }
                } else if (idx >= 0) {
                    val buf = c.getOutputBuffer(idx)
                    if (buf != null && info.size > 0 && metaSent) {
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        val payload = ByteArray(info.size)
                        buf.get(payload)
                        val isKey = (info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0
                        val frame = ByteArray(9 + payload.size)
                        frame[0] = if (isKey) 1 else 0
                        val pts = info.presentationTimeUs
                        for (i in 0..7) frame[1 + i] = ((pts shr (56 - i * 8)) and 0xff).toByte()
                        System.arraycopy(payload, 0, frame, 9, payload.size)
                        onFrame(frame)
                    }
                    c.releaseOutputBuffer(idx, false)
                }
            } catch (e: Exception) {
                if (running && gen == generation) {
                    Log.e(TAG, "drain error", e)
                    onError("encoder drain: ${e.message}")
                }
                break
            }
        }
    }

    /** csd có thể kèm start code 00 00 00 01 — bỏ đi để web dựng avcC. */
    private fun stripStartCode(bb: ByteBuffer): ByteArray {
        val arr = ByteArray(bb.remaining())
        bb.get(arr)
        return when {
            arr.size > 4 && arr[0] == 0.toByte() && arr[1] == 0.toByte() && arr[2] == 0.toByte() && arr[3] == 1.toByte() ->
                arr.copyOfRange(4, arr.size)
            arr.size > 3 && arr[0] == 0.toByte() && arr[1] == 0.toByte() && arr[2] == 1.toByte() ->
                arr.copyOfRange(3, arr.size)
            else -> arr
        }
    }

    fun requestKeyFrame() {
        try {
            codec?.setParameters(Bundle().apply {
                putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0)
            })
        } catch (e: Exception) {
            Log.w(TAG, "requestKeyFrame failed", e)
        }
    }

    fun stop() {
        running = false
        generation++
        try { codec?.stop() } catch (_: Exception) {}
        try { thread?.join(1500) } catch (_: Exception) {}
        thread = null
        try { virtualDisplay?.release() } catch (_: Exception) {}
        virtualDisplay = null
        try { codec?.release() } catch (_: Exception) {}
        codec = null
    }
}
