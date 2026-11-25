package vn.phonecloud.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Màn hình chính: đăng ký thiết bị, bật/tắt dịch vụ, mở các trang cấp quyền. */
class MainActivity : AppCompatActivity() {

    private lateinit var tvInfo: TextView
    private lateinit var tvStatus: TextView
    private lateinit var etServer: EditText

    private val projectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val svc = Intent(this, AgentService::class.java).apply {
                putExtra(AgentService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(AgentService.EXTRA_RESULT_DATA, result.data)
            }
            ContextCompat.startForegroundService(this, svc)
            Prefs.setServiceWanted(this, true)
            toast("Đã bật dịch vụ điều khiển")
        } else {
            toast("Chưa cấp quyền quay màn hình")
        }
        refreshStatus()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        tvInfo = findViewById(R.id.tvInfo)
        tvStatus = findViewById(R.id.tvStatus)
        etServer = findViewById(R.id.etServer)
        etServer.setText(Prefs.getServer(this))

        findViewById<Button>(R.id.btnRegister).setOnClickListener { registerDevice() }
        findViewById<Button>(R.id.btnStart).setOnClickListener { startServiceWithPermission() }
        findViewById<Button>(R.id.btnStop).setOnClickListener {
            stopService(Intent(this, AgentService::class.java))
            Prefs.setServiceWanted(this, false)
            toast("Đã tắt dịch vụ")
            refreshStatus()
        }
        findViewById<Button>(R.id.btnAccessibility).setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        findViewById<Button>(R.id.btnIme).setOnClickListener {
            startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
            toast("Bật PhoneCloud Keyboard rồi chọn làm bàn phím hiện tại")
        }
        findViewById<Button>(R.id.btnBattery).setOnClickListener {
            val i = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                .setData(Uri.parse("package:$packageName"))
            try { startActivity(i) } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            }
        }
        findViewById<Button>(R.id.btnOverlay).setOnClickListener {
            val i = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                .setData(Uri.parse("package:$packageName"))
            startActivity(i)
        }
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun registerDevice() {
        val server = etServer.text.toString().trim().trimEnd('/')
        if (server.isEmpty()) return toast("Nhập địa chỉ server trước")
        Prefs.setServer(this, server)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val conn = URL("$server/api/device/register").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                val body = JSONObject().put("name", Build.MODEL).toString()
                conn.outputStream.use { it.write(body.toByteArray()) }
                val text = conn.inputStream.bufferedReader().readText()
                val j = JSONObject(text)
                if (j.optBoolean("status")) {
                    Prefs.saveDevice(
                        this@MainActivity,
                        j.optString("device_id"),
                        j.optString("password"),
                        j.optString("key")
                    )
                    withContext(Dispatchers.Main) {
                        toast("Đăng ký thành công")
                        refreshStatus()
                    }
                } else {
                    withContext(Dispatchers.Main) { toast("Đăng ký thất bại") }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { toast("Lỗi: ${e.message}") }
            }
        }
    }

    private fun startServiceWithPermission() {
        if (!Prefs.isRegistered(this)) return toast("Đăng ký thiết bị trước")
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projectionLauncher.launch(mpm.createScreenCaptureIntent())
    }

    private fun isAccessibilityOn(): Boolean {
        val enabled = Settings.Secure.getString(
            contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        return enabled.contains(packageName)
    }

    private fun isImeCurrent(): Boolean {
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        val current = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD) ?: ""
        return current.contains(packageName)
    }

    private fun isBatteryIgnored(): Boolean {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun refreshStatus() {
        tvInfo.text = if (Prefs.isRegistered(this)) {
            "ID thiết bị: ${Prefs.getDeviceId(this)}\nMật khẩu: ${Prefs.getPassword(this)}\nServer: ${Prefs.getServer(this)}"
        } else {
            "Chưa đăng ký thiết bị"
        }
        val sb = StringBuilder()
        sb.append("Dịch vụ: ").append(if (AgentService.running) "đang chạy" else "đã tắt").append('\n')
        if (AgentService.statusText.isNotEmpty()) sb.append("Trạng thái: ").append(AgentService.statusText).append('\n')
        sb.append("Trợ năng: ").append(if (isAccessibilityOn()) "đã bật ✓" else "chưa bật ✗").append('\n')
        sb.append("Bàn phím PhoneCloud: ").append(if (isImeCurrent()) "đang dùng ✓" else "chưa chọn ✗").append('\n')
        sb.append("Bỏ tối ưu pin: ").append(if (isBatteryIgnored()) "đã bỏ ✓" else "chưa ✗")
        tvStatus.text = sb.toString()
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}
