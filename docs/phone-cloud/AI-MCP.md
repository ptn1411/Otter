# PhoneCloud — Tài liệu AI tự động (MCP Server)

`mcp-server/` là MCP server (Model Context Protocol, stdio) cho phép AI agent
(Claude Code, Claude Desktop, bot Otter, ChatGPT...) điều khiển điện thoại
Android qua PhoneCloud — không cần mở web.

**Bản 1.3.0 là bản GỘP** của Sunny + cursor_agent (pham chốt 23/11/2026):
gốc cấu trúc PhoneSession của cursor_agent (ESM, SDK 1.22.0), thêm từ Sunny:
tìm/bấm/chờ phần tử theo tiêu chí ngữ nghĩa (text/id/class/desc) bên cạnh xpath,
get_ui_tree định dạng gọn kèm tâm phần tử, screenshot trả MCP image content,
press_key chuẩn hóa + POWER, set_text mặc định ô đang focus.

Ý tưởng học từ DroidPilot (github.com/youichi-uda/droidpilot, MIT): dùng cây
giao diện có cấu trúc (Accessibility) thay vì chụp màn hình + OCR — rẻ token,
đáng tin hơn. PhoneCloud đã có sẵn nền đó (findElements/selector), MCP server
chỉ là lớp phơi bày tool cho AI.

## Cách chạy

```bash
cd mcp-server
npm install
node index.js     # stdio — thường do client MCP tự khởi động
```

Biến môi trường: `PHONECLOUD_API` — địa chỉ relay server (mặc định `http://127.0.0.1:3100`).

## Cấu hình trong client MCP

Ví dụ (Claude Code / client MCP bất kỳ):

```json
{
  "mcpServers": {
    "phonecloud": {
      "command": "node",
      "args": ["/home/nam/code/phone-cloud/mcp-server/index.js"],
      "env": { "PHONECLOUD_API": "http://100.111.68.103:3100" }
    }
  }
}
```

## Các tool (19)

| Tool | Mô tả |
|---|---|
| `connect` | Kết nối thiết bị bằng device_id + password (api bỏ trống = biến PHONECLOUD_API) |
| `disconnect` | Ngắt kết nối |
| `list_devices` | Danh sách thiết bị đã đăng ký + online |
| `get_device_info` | ID, tên, online, quality, fps, kích thước màn hình |
| `get_ui_tree` | Toàn bộ cây giao diện, định dạng gọn kèm tâm phần tử — **ưu tiên dùng** |
| `find_element` | Tìm phần tử theo xpath HOẶC tiêu chí text/id/className/contentDescription |
| `tap` / `long_press` / `swipe` / `scroll` | Thao tác chạm/vuốt/cuộn (long_press dùng pointer 1.2) |
| `type_text` | Gõ thêm chữ vào ô đang focus |
| `set_text` | Thay nội dung ô theo xpath/tiêu chí, bỏ trống = ô đang focus |
| `press_key` | Phím hệ thống: BACK/HOME/RECENTS/NOTIFICATIONS/POWER/ENTER/DEL... |
| `click_element` | Tìm + bấm phần tử (xpath hoặc tiêu chí) |
| `wait_for_element` | Chờ phần tử xuất hiện (timeoutMs tùy chọn) |
| `open_app` | App theo packageName, command: start/stop/clear/uninstall/openInfo |
| `screenshot` | Chụp màn hình PNG, trả MCP image content (chỉ khi cần nhìn hình) |
| `get_focused` | Phần tử đang focus |
| `set_quality` | Đổi chất lượng/FPS luồng hình |

## Luồng AI tự động điển hình

1. `connect` → 2. `get_ui_tree` (hiểu màn hình) → 3. `click_element`/`tap`/`type_text`
→ 4. `wait_for_element` → lặp lại cho tới khi xong việc. Chỉ gọi `screenshot`
khi cây giao diện không đủ thông tin (hình ảnh, canvas, game...).

## Kiểm tra

```bash
# Cần PhoneCloud server + fake-device đang chạy:
node tools/test-mcp.js
```
