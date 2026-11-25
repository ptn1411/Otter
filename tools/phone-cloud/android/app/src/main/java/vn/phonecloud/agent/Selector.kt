package vn.phonecloud.agent

import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Bộ chọn phần tử giao diện theo cú pháp rút gọn kiểu XPath.
 * Hỗ trợ các dạng:
 *   //*[@text="OK"]
 *   //android.widget.Button[@resource-id="com.app:id/btn_ok"]
 *   //*[contains(@text,"Đăng")]
 *   //*[@content-desc="Quay lại"]
 *   //*[@class="android.widget.EditText"]
 *   //*   (mọi phần tử — dùng để dump cây giao diện)
 * Nhiều điều kiện cách nhau bằng " and ": //*[@text="OK" and @clickable="true"]
 */
object Selector {

    data class Query(
        val className: String? = null,
        val conditions: List<Pair<String, String>> = emptyList(), // attr -> giá trị (khớp đúng)
        val contains: List<Pair<String, String>> = emptyList()    // attr -> chuỗi con
    )

    private val reContains = Regex("""contains\(\s*@([\w-]+)\s*,\s*["']([^"']*)["']\s*\)""")
    private val reAttr = Regex("""@([\w-]+)\s*=\s*["']([^"']*)["']""")
    private val reClass = Regex("""^//([A-Za-z0-9_.*]+)""")

    fun parse(xpath: String): Query {
        val xp = xpath.trim()
        var cls: String? = null
        reClass.find(xp)?.let {
            val c = it.groupValues[1]
            if (c != "*") cls = c
        }
        val contains = reContains.findAll(xp).map { it.groupValues[1] to it.groupValues[2] }.toList()
        val cleaned = reContains.replace(xp, "")
        val attrs = reAttr.findAll(cleaned).map { it.groupValues[1] to it.groupValues[2] }.toList()
        return Query(cls, attrs, contains)
    }

    private fun attrOf(node: AccessibilityNodeInfo, attr: String): String? = when (attr) {
        "text" -> node.text?.toString()
        "content-desc" -> node.contentDescription?.toString()
        "resource-id" -> node.viewIdResourceName
        "class" -> node.className?.toString()
        "clickable" -> node.isClickable.toString()
        "enabled" -> node.isEnabled.toString()
        "checked" -> node.isChecked.toString()
        "selected" -> node.isSelected.toString()
        "focused" -> node.isFocused.toString()
        else -> null
    }

    fun matches(node: AccessibilityNodeInfo, q: Query): Boolean {
        if (q.className != null && node.className?.toString() != q.className) return false
        for ((attr, want) in q.conditions) {
            if (attrOf(node, attr) != want) return false
        }
        for ((attr, want) in q.contains) {
            val v = attrOf(node, attr) ?: return false
            if (!v.contains(want)) return false
        }
        return true
    }

    /** Duyệt toàn bộ cây, trả danh sách node khớp (tối đa [limit]). */
    fun findAll(root: AccessibilityNodeInfo?, xpath: String, limit: Int = 100): List<AccessibilityNodeInfo> {
        if (root == null) return emptyList()
        val q = parse(xpath)
        val out = ArrayList<AccessibilityNodeInfo>()
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.add(root)
        while (stack.isNotEmpty() && out.size < limit) {
            val n = stack.removeLast()
            if (matches(n, q)) out.add(n)
            for (i in n.childCount - 1 downTo 0) {
                n.getChild(i)?.let { stack.add(it) }
            }
        }
        return out
    }

    fun nodeToMap(node: AccessibilityNodeInfo): Map<String, Any?> {
        val r = Rect()
        node.getBoundsInScreen(r)
        return mapOf(
            "text" to (node.text?.toString() ?: ""),
            "contentDesc" to (node.contentDescription?.toString() ?: ""),
            "resourceId" to (node.viewIdResourceName ?: ""),
            "className" to (node.className?.toString() ?: ""),
            "bounds" to listOf(r.left, r.top, r.right, r.bottom),
            "clickable" to node.isClickable,
            "enabled" to node.isEnabled,
            "checked" to node.isChecked,
            "focused" to node.isFocused
        )
    }
}
