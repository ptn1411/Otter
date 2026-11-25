package vn.phonecloud.agent

import android.inputmethodservice.InputMethodService
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.widget.TextView

/**
 * Bàn phím tự chế: nhận chữ/phím từ phía điều khiển và commit vào ô nhập liệu.
 * Người dùng phải chọn "PhoneCloud Keyboard" làm bàn phím hiện tại thì mới dùng được;
 * nếu chưa, AgentService sẽ fallback sang ACTION_SET_TEXT qua Accessibility.
 */
class AgentIME : InputMethodService() {

    companion object {
        private const val TAG = "AgentIME"
        @Volatile var instance: AgentIME? = null
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onCreateInputView(): View {
        return TextView(this).apply {
            text = "Otter Keyboard — nhập tiếng Việt từ Otter"
            setPadding(24, 24, 24, 24)
        }
    }

    fun commitText(text: String): Boolean {
        val ic = currentInputConnection ?: return false
        return ic.commitText(text, 1)
    }

    fun sendKey(keyName: String): Boolean {
        val ic = currentInputConnection ?: return false
        val code = when (keyName.uppercase()) {
            "ENTER" -> KeyEvent.KEYCODE_ENTER
            "DEL", "BACKSPACE" -> KeyEvent.KEYCODE_DEL
            "SPACE" -> KeyEvent.KEYCODE_SPACE
            "TAB" -> KeyEvent.KEYCODE_TAB
            "ESCAPE", "ESC" -> KeyEvent.KEYCODE_ESCAPE
            else -> return false
        }
        val down = KeyEvent(KeyEvent.ACTION_DOWN, code)
        val up = KeyEvent(KeyEvent.ACTION_UP, code)
        return ic.sendKeyEvent(down) && ic.sendKeyEvent(up)
    }
}
