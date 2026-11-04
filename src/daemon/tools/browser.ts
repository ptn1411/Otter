import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserBridge } from "../browser-bridge";
import { getDatabase } from "../db";
import { getOrCreateConversation, recordMessage, getMessengerListenerStatus } from "../fb-sales";

export function registerBrowserTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool: Mở trang web
  mcp.tool(
    "browser_open",
    {
      url: z.string().describe("Địa chỉ URL trang web cần mở (VD: 'https://google.com')")
    },
    async ({ url }) => {
      try {
        const res = await browserBridge.execute("open", { url });
        onActivity?.({
          type: "browser_action",
          action: "open",
          url: res.url,
          title: res.title
        });
        return {
          content: [{
            type: "text",
            text: `✅ Đã mở trang web thành công!\n- Tiêu đề: ${res.title}\n- URL: ${res.url}\n\nHãy gọi tiếp 'browser_read_page' để đọc cấu trúc các phần tử tương tác trên trang.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi mở trang web: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Đọc cấu trúc trang (DOM rút gọn đánh số [1], [2]...)
  mcp.tool(
    "browser_read_page",
    {
      urlPattern: z.string().optional().describe("Bộ lọc tên miền URL của tab cần đọc (ví dụ: 'facebook.com', 'youtube.com')")
    },
    async ({ urlPattern }) => {
      try {
        const res = await browserBridge.execute("read_page", { urlPattern });
        onActivity?.({
          type: "browser_action",
          action: "read_page",
          url: res.url,
          title: res.title
        });

        let formattedElements = res.elements.map((el: any) => {
          let desc = `[${el.index}] <${el.tagName}`;
          if (el.type) desc += ` type="${el.type}"`;
          desc += `>`;
          if (el.inView) desc += ` [Đang xem]`;
          if (el.text) desc += ` "${el.text}"`;
          if (el.value) desc += ` (value: "${el.value}")`;
          if (el.placeholder) desc += ` (placeholder: "${el.placeholder}")`;
          if (el.ariaLabel) desc += ` (aria: "${el.ariaLabel}")`;
          if (el.href) desc += ` -> ${el.href}`;
          return desc;
        }).join("\n");

        const textOutput = [
          `📄 TRANG HIỆN TẠI: ${res.title}`,
          `🌐 URL: ${res.url}`,
          `🎯 Tab ID: ${res.tabId || 'active'}`,
          `\n--- DANH SÁCH PHẦN TỬ TƯƠNG TÁC (${res.elementsCount} PHẦN TỬ TIÊU BIỂU, ƯU TIÊN VIEWPORT) ---`,
          formattedElements || "(Không tìm thấy phần tử tương tác)",
          `\n--- NỘI DUNG VĂN BẢN TÓM TẮT ---`,
          res.summaryText || "(Trống)",
          `\n👉 Hướng dẫn hành động:`,
          `- Để bấm vào phần tử: gọi 'browser_click' với tham số index (VD: index=1)`,
          `- Để gõ vào ô nhập: gọi 'browser_type' với index và text (VD: index=2, text="abc", pressEnter=true)`,
          `- Để cuộn trang xem thêm: gọi 'browser_scroll' (direction="down")`
        ].join("\n");

        return {
          content: [{ type: "text", text: textOutput }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi đọc trang web: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Click vào phần tử theo index
  mcp.tool(
    "browser_click",
    {
      index: z.number().describe("Chỉ số phần tử [index] cần click (lấy từ kết quả 'browser_read_page')"),
      urlPattern: z.string().optional().describe("Bộ lọc tên miền URL của tab cần click (ví dụ: 'facebook.com')")
    },
    async ({ index, urlPattern }) => {
      try {
        const res = await browserBridge.execute("click", { index, urlPattern });
        onActivity?.({
          type: "browser_action",
          action: "click",
          index
        });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}\n\nHãy gọi 'browser_read_page' để xem trang sau khi click.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi click phần tử [${index}]: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Nhập văn bản vào ô input theo index
  mcp.tool(
    "browser_type",
    {
      index: z.number().describe("Chỉ số ô nhập liệu [index] cần gõ chữ"),
      text: z.string().describe("Nội dung văn bản cần nhập"),
      pressEnter: z.boolean().optional().describe("Có tự động nhấn phím Enter sau khi gõ không (mặc định: false)"),
      urlPattern: z.string().optional().describe("Bộ lọc tên miền URL của tab cần gõ chữ (ví dụ: 'facebook.com')")
    },
    async ({ index, text, pressEnter, urlPattern }) => {
      try {
        const res = await browserBridge.execute("type", { index, text, pressEnter, urlPattern });

        // Tự động ghi lại tin nhắn trả lời của bot/AI vào SQLite
        try {
          const status = getMessengerListenerStatus();
          if ((!urlPattern || urlPattern.includes("facebook")) && status.lastForwardedTo) {
            const db = getDatabase();
            const conv = getOrCreateConversation(db, status.lastForwardedTo);
            recordMessage(db, conv.id, "bot", text, conv.stage);
          }
        } catch (dbErr) {
          console.warn("[browser_type] Không thể lưu lịch sử bot vào SQLite:", dbErr);
        }

        onActivity?.({
          type: "browser_action",
          action: "type",
          index,
          text
        });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}\n\nHãy gọi 'browser_read_page' để kiểm tra kết quả.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi nhập văn bản vào [${index}]: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Chọn option trong dropdown <select>
  mcp.tool(
    "browser_select",
    {
      index: z.number().describe("Chỉ số phần tử [index] của thẻ dropdown <select>"),
      option: z.string().describe("Tên chữ hiển thị hoặc giá trị value của option cần chọn")
    },
    async ({ index, option }) => {
      try {
        const res = await browserBridge.execute("select", { index, option });
        onActivity?.({
          type: "browser_action",
          action: "select",
          index,
          option
        });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}\n\nHãy gọi 'browser_read_page' để kiểm tra kết quả trang.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi chọn option trên [${index}]: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Cuộn trang
  mcp.tool(
    "browser_scroll",
    {
      direction: z.enum(["up", "down"]).describe("Hướng cuộn ('up' hoặc 'down')"),
      amount: z.number().optional().describe("Khoảng cách cuộn tính bằng pixel (mặc định: 600)")
    },
    async ({ direction, amount }) => {
      try {
        const res = await browserBridge.execute("scroll", { direction, amount });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}\nHãy gọi 'browser_read_page' để đọc các phần tử mới xuất hiện.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi cuộn trang: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Quay lại trang trước
  mcp.tool(
    "browser_back",
    {},
    async () => {
      try {
        const res = await browserBridge.execute("back");
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}\nHãy gọi 'browser_read_page' để xem trang trước đó.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi quay lại trang: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Gửi báo cáo tự động vào ô chat của ChatGPT Web
  mcp.tool(
    "browser_inject_chat_message",
    {
      message: z.string().describe("Nội dung báo cáo hoặc thông điệp cần tự động gửi vào ô chat"),
      autoSubmit: z.boolean().optional().describe("Tự động bấm gửi luôn hay chỉ để dạng bản nháp (mặc định: true)")
    },
    async ({ message, autoSubmit }) => {
      try {
        const ok = browserBridge.injectPrompt(message, autoSubmit !== false);
        return {
          content: [{
            type: "text",
            text: ok ? "✅ Đã tự động gửi thông điệp vào ô chat ChatGPT Web thành công!" : "Lỗi: Extension chưa sẵn sàng để nhận thông điệp."
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi inject thông điệp: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Liệt kê danh sách các tab đang mở
  mcp.tool(
    "browser_list_tabs",
    {},
    async () => {
      try {
        const res = await browserBridge.execute("list_tabs");
        let listText = (res.tabs || []).map((t: any) =>
          `- [ID: ${t.id}] "${t.title}" (${t.url})${t.isControlled ? " 🎯 [Đang điều khiển]" : ""}${t.active ? " 👁️ [Đang xem]" : ""}`
        ).join("\n");
        return {
          content: [{
            type: "text",
            text: `📑 DANH SÁCH TAB TRÌNH DUYỆT ĐANG MỞ (${res.tabs?.length || 0} tabs):\n${listText || "(Không có tab nào)"}\n\n👉 Bạn có thể dùng 'browser_switch_tab' để đổi tab hoặc 'browser_close_tab' để đóng tab.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi lấy danh sách tab: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Chuyển sang điều khiển một tab cụ thể
  mcp.tool(
    "browser_switch_tab",
    {
      tabId: z.number().describe("ID của tab cần chuyển sang điều khiển (lấy từ 'browser_list_tabs')")
    },
    async ({ tabId }) => {
      try {
        const res = await browserBridge.execute("switch_tab", { tabId });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}\nHãy gọi 'browser_read_page' để đọc cấu trúc trang tab này.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi chuyển tab: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Đóng một tab trình duyệt
  mcp.tool(
    "browser_close_tab",
    {
      tabId: z.number().optional().describe("ID của tab cần đóng (nếu không truyền sẽ đóng tab đang được điều khiển hiện tại)")
    },
    async ({ tabId }) => {
      try {
        const res = await browserBridge.execute("close_tab", { tabId });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi đóng tab: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Nạp lại tiện ích mở rộng Otter (Chrome Extension)
  mcp.tool(
    "browser_reload_extension",
    {},
    async () => {
      try {
        const res = await browserBridge.execute("reload_extension", {});
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message || "Đang nạp lại tiện ích mở rộng Otter..."}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi nạp lại extension: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Quản lý & đo lường trạng thái 2 động cơ trình duyệt (Extension vs CDP)
  mcp.tool(
    "browser_engine_status",
    {
      mode: z.enum(["auto", "extension", "cdp"]).optional().describe("Chuyển đổi chế độ động cơ: 'auto' (tự động fallback), 'extension' (chỉ dùng Extension), 'cdp' (chỉ dùng CDP trực tiếp)"),
      benchmark: z.boolean().optional().describe("Có chạy đo đạc so sánh tốc độ phản hồi (latency) giữa 2 động cơ không (mặc định: false)")
    },
    async ({ mode, benchmark }) => {
      try {
        if (mode) {
          browserBridge.setEngineMode(mode);
        }

        const status = await browserBridge.getStatus();
        let report = [
          `⚙️ TRẠNG THÁI ĐỘNG CƠ ĐIỀU KHIỂN TRÌNH DUYỆT (DUAL-ENGINE):`,
          `- Chế độ cấu hình (Mode): ${status.mode.toUpperCase()}`,
          `- Động cơ đang hoạt động (Active): ${status.activeEngine.toUpperCase()}`,
          `\n1. Động cơ Chrome Extension:`,
          `   + Kết nối: ${status.extension.connected ? "✅ Đang kết nối" : "❌ Chưa kết nối"}`,
          `   + Số socket mở: ${status.extension.socketsCount}`,
          `\n2. Động cơ Chrome DevTools Protocol (CDP):`,
          `   + Khả dụng: ${status.cdp.available ? "✅ Đang sẵn sàng" : "❌ Chưa mở"}`,
          `   + Cổng (Port): ${status.cdp.port}`,
        ];

        if (benchmark) {
          report.push(`\n📊 KẾT QUẢ ĐO ĐẠC SO SÁNH TỐC ĐỘ (BENCHMARK):`);
          const bench = await browserBridge.benchmark();
          report.push(`   + Độ trễ Extension: ${bench.extension.latencyMs >= 0 ? bench.extension.latencyMs + " ms" : "Không khả dụng"}`);
          report.push(`   + Độ trễ CDP: ${bench.cdp.latencyMs >= 0 ? bench.cdp.latencyMs + " ms" : "Không khả dụng"}`);
          report.push(`   + Đánh giá: ${bench.recommendation}`);
        }

        return {
          content: [{
            type: "text",
            text: report.join("\n")
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi kiểm tra trạng thái động cơ: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}
