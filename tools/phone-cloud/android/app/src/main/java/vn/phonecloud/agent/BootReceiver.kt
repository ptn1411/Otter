package vn.phonecloud.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Tự khởi động dịch vụ sau khi máy khởi động lại (nếu người dùng đã bật trước đó).
 * Dịch vụ sẽ nối server và chờ; quyền quay màn hình vẫn cần người dùng cấp lại
 * (giới hạn của Android) — app sẽ tự mở lên khi phía web yêu cầu stream.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!Prefs.isServiceWanted(context) || !Prefs.isRegistered(context)) return
        try {
            ContextCompat.startForegroundService(context, Intent(context, AgentService::class.java))
            Log.i("BootReceiver", "agent service started after boot")
        } catch (e: Exception) {
            Log.w("BootReceiver", "cannot start service after boot: ${e.message}")
        }
    }
}
