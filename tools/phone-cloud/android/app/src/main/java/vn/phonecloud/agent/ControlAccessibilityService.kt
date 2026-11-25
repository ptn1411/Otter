package vn.phonecloud.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Dịch vụ trợ năng: thực thi chạm/vuốt (dispatchGesture), phím hệ thống
 * (performGlobalAction) và tự động hóa cây giao diện (tìm/bấm/gõ theo selector).
 * Instance tĩnh để AgentService gọi tới.
 */
class ControlAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "ControlA11y"
        private const val STEP_MS = 90L
        @Volatile var instance: ControlAccessibilityService? = null
    }

    private val main = Handler(Looper.getMainLooper())
    private var stroke: GestureDescription.StrokeDescription? = null
    private var lx = 0f
    private var ly = 0f

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "accessibility connected")
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) { /* không cần xử lý */ }
    override fun onInterrupt() { /* không cần xử lý */ }

    /** Ngón tay sống: down / move / up. Move được nối bằng continueStroke để kéo mượt. */
    fun pointer(phase: String, x: Int, y: Int) {
        main.post { pointerOnMain(phase, x, y) }
    }

    private fun pointerOnMain(phase: String, x: Int, y: Int) {
        when (phase) {
            "down" -> beginStroke(x, y)
            "move" -> extendStroke(x, y, true)
            else -> if (stroke == null) tap(x, y) else extendStroke(x, y, false)
        }
    }

    private fun beginStroke(x: Int, y: Int) {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val next = GestureDescription.StrokeDescription(path, 0, STEP_MS, true)
        stroke = next
        lx = x.toFloat()
        ly = y.toFloat()
        dispatchGesture(GestureDescription.Builder().addStroke(next).build(), null, null)
    }

    private fun extendStroke(x: Int, y: Int, cont: Boolean) {
        val prev = stroke
        if (prev == null) {
            if (cont) beginStroke(x, y) else tap(x, y)
            return
        }
        val path = Path()
        path.moveTo(lx, ly)
        var nx = x.toFloat()
        val ny = y.toFloat()
        if (nx == lx && ny == ly) nx += 0.4f
        path.lineTo(nx, ny)
        try {
            val next = prev.continueStroke(path, 0, if (cont) STEP_MS else 30L, cont)
            stroke = if (cont) next else null
            lx = x.toFloat()
            ly = y.toFloat()
            dispatchGesture(GestureDescription.Builder().addStroke(next).build(), null, null)
        } catch (e: Exception) {
            Log.w(TAG, "continueStroke failed", e)
            stroke = null
            if (cont) beginStroke(x, y)
        }
    }

    fun tap(x: Int, y: Int): Boolean {
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    fun swipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long): Boolean {
        val path = Path().apply {
            moveTo(x1.toFloat(), y1.toFloat())
            lineTo(x2.toFloat(), y2.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.coerceIn(50, 5000)))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    /** Cuộn dọc tại điểm (x,y): deltaY dương = cuộn xuống (vuốt lên). */
    fun wheel(x: Int, y: Int, deltaY: Int): Boolean {
        val dy = (deltaY.coerceIn(-800, 800))
        return swipe(x, y, x, y - dy, 250)
    }

    /** Phím hệ thống: BACK, HOME, RECENTS, POWER(dialog), NOTIFICATIONS... */
    fun globalAction(name: String): Boolean {
        val action = when (name.uppercase()) {
            "BACK" -> GLOBAL_ACTION_BACK
            "HOME" -> GLOBAL_ACTION_HOME
            "RECENTS" -> GLOBAL_ACTION_RECENTS
            "NOTIFICATIONS" -> GLOBAL_ACTION_NOTIFICATIONS
            "POWER" -> GLOBAL_ACTION_POWER_DIALOG
            "LOCK" -> GLOBAL_ACTION_LOCK_SCREEN
            else -> return false
        }
        return performGlobalAction(action)
    }

    fun findElements(xpath: String): List<Map<String, Any?>> {
        val root = rootInActiveWindow ?: return emptyList()
        return Selector.findAll(root, xpath).map { Selector.nodeToMap(it) }
    }

    fun clickElement(xpath: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = Selector.findAll(root, xpath, limit = 1)
        if (nodes.isEmpty()) return false
        var node: AccessibilityNodeInfo? = nodes[0]
        // Tìm node bấm được (chính nó hoặc cha gần nhất)
        var cur = node
        while (cur != null && !cur.isClickable) cur = cur.parent
        if (cur != null) return cur.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        // Không bấm được bằng action -> chạm vào tâm phần tử
        val r = Rect()
        node!!.getBoundsInScreen(r)
        return tap(r.centerX(), r.centerY())
    }

    fun setTextElement(xpath: String, text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = Selector.findAll(root, xpath, limit = 1)
        if (nodes.isEmpty()) return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return nodes[0].performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    /** Gõ chữ vào ô đang focus (khi bàn phím PhoneCloud chưa được chọn). */
    fun setTextFocused(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }
}
