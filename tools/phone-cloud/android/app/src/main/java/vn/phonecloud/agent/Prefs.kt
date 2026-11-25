package vn.phonecloud.agent

import android.content.Context
import android.content.SharedPreferences

/** Lưu cấu hình: địa chỉ server, thông tin thiết bị sau khi đăng ký. */
object Prefs {
    private const val NAME = "phonecloud"

    private fun sp(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    var serverUrl: String
        get() = ""
        set(@Suppress("UNUSED_PARAMETER") v) {}

    fun getServer(ctx: Context): String = sp(ctx).getString("server", "") ?: ""
    fun setServer(ctx: Context, v: String) = sp(ctx).edit().putString("server", v.trim().trimEnd('/')).apply()

    fun getDeviceId(ctx: Context): String = sp(ctx).getString("device_id", "") ?: ""
    fun getPassword(ctx: Context): String = sp(ctx).getString("password", "") ?: ""
    fun getKey(ctx: Context): String = sp(ctx).getString("key", "") ?: ""

    fun saveDevice(ctx: Context, deviceId: String, password: String, key: String) {
        sp(ctx).edit()
            .putString("device_id", deviceId)
            .putString("password", password)
            .putString("key", key)
            .apply()
    }

    fun isRegistered(ctx: Context): Boolean = getKey(ctx).isNotEmpty()

    fun setServiceWanted(ctx: Context, wanted: Boolean) =
        sp(ctx).edit().putBoolean("service_wanted", wanted).apply()

    fun isServiceWanted(ctx: Context): Boolean = sp(ctx).getBoolean("service_wanted", false)
}
