# CUA (Computer-Use Agent) Integration (`tools/cua`)

Tích hợp nền tảng điều khiển máy tính tự động **CUA** từ [trycua/cua](https://github.com/trycua/cua) dành cho Otter Daemon và các AI Agent (ChatGPT, Claude, Gemini).

---

## 1. Thành phần chính trong `tools/cua`

* **`cua-driver.exe`**: Runtime driver điều khiển Desktop UI (Windows UI Automation, quản lý cửa sổ, chuột, bàn phím, chụp ảnh màn hình và UIA accessibility tree diffs).
* **`cua_driver_sdk.dll`**: Thư viện FFI C-ABI cấp thấp kết nối trực tiếp với Otter qua `bun:ffi`.
* **`cua_driver_abi.h`**: Định nghĩa giao tiếp C header cho SDK.
* **`setup-cua.ts`**: Script tự động tải và cập nhật phiên bản mới nhất từ [trycua/cua](https://github.com/trycua/cua/releases).

---

## 2. Cách thiết lập (Setup)

### Cách 1: Tự động qua lệnh tiện ích Otter
```bash
bun tools/cua/setup-cua.ts
# Hoặc chạy toàn bộ bộ cài nhị phân:
bun run setup:bin
```

### Cách 2: Cài đặt chính thức từ trang chủ Cua AI (Khuyến nghị trên Windows)
Mở PowerShell và chạy:
```powershell
irm https://cua.ai/driver/install.ps1 | iex
```
Script sẽ tự động đăng ký Service / Scheduled Task `cua-driver serve` khi đăng nhập máy tính.

---

## 3. Cách sử dụng

### Kiểm tra phiên bản Driver
```cmd
tools\cua\cua-driver.exe --version
```

### Khởi động CUA Driver Daemon
```cmd
tools\cua\cua-driver.exe serve
```

### Tích hợp trong Otter MCP Daemon
Hệ thống Otter Daemon tự động nạp `tools/cua/cua_driver_sdk.dll` thông qua tool MCP:
* **`cua_get_inventory`**: Tra cứu danh sách **61 công cụ tự động hóa giao diện máy tính** chuyên sâu (Accessibility tree walking, element tokens, bounding boxes, screenshot OCR grounding).
* Tra cứu trực tiếp từ AI client:
  ```json
  {
    "toolName": "cua_get_inventory",
    "arguments": { "query": "window" }
  }
  ```

