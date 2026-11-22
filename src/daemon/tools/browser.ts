import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserBridge, cdpBridge } from "../browser-bridge";
import { getSettings, updateSettings } from "../settings";
import { getDatabase } from "../db";
import { getOrCreateConversation, recordMessage, getMessengerListenerStatus } from "../fb-sales";

export function registerBrowserTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool: Mở trang web
  mcp.tool(
    "browser_open",
    {
      url: z.string().describe("Địa chỉ URL trang web cần mở (VD: 'https://google.com')"),
      cdpPort: z.number().optional().describe("Cổng Chrome DevTools Protocol (CDP) tùy chỉnh (VD: 57326 cho GPM)"),
      wsEndpoint: z.string().optional().describe("WebSocket CDP endpoint tùy chỉnh (VD: 'ws://127.0.0.1:57326/devtools/browser/...')")
    },
    async ({ url, cdpPort, wsEndpoint }) => {
      try {
        const res = await browserBridge.execute("open", { url, cdpPort, wsEndpoint });
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
      urlPattern: z.string().optional().describe("Bộ lọc tên miền URL của tab cần đọc (ví dụ: 'facebook.com', 'youtube.com')"),
      cdpPort: z.number().optional().describe("Cổng CDP tùy chỉnh (VD: 57326 cho GPM)"),
      wsEndpoint: z.string().optional().describe("WebSocket CDP endpoint tùy chỉnh")
    },
    async ({ urlPattern, cdpPort, wsEndpoint }) => {
      try {
        const res = await browserBridge.execute("read_page", { urlPattern, cdpPort, wsEndpoint });
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
      urlPattern: z.string().optional().describe("Bộ lọc tên miền URL của tab cần click (ví dụ: 'facebook.com')"),
      cdpPort: z.number().optional().describe("Cổng CDP tùy chỉnh (VD: 57326 cho GPM)"),
      wsEndpoint: z.string().optional().describe("WebSocket CDP endpoint tùy chỉnh")
    },
    async ({ index, urlPattern, cdpPort, wsEndpoint }) => {
      try {
        const res = await browserBridge.execute("click", { index, urlPattern, cdpPort, wsEndpoint });
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
      urlPattern: z.string().optional().describe("Bộ lọc tên miền URL của tab cần gõ chữ (ví dụ: 'facebook.com')"),
      cdpPort: z.number().optional().describe("Cổng CDP tùy chỉnh (VD: 57326 cho GPM)"),
      wsEndpoint: z.string().optional().describe("WebSocket CDP endpoint tùy chỉnh")
    },
    async ({ index, text, pressEnter, urlPattern, cdpPort, wsEndpoint }) => {
      try {
        const res = await browserBridge.execute("type", { index, text, pressEnter, urlPattern, cdpPort, wsEndpoint });

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
        const ok = await browserBridge.injectPromptSmart(message, autoSubmit !== false);
        return {
          content: [{
            type: "text",
            text: ok ? "✅ Đã tự động gửi thông điệp vào ô chat ChatGPT Web thành công!" : "Lỗi: Trình duyệt Chrome CDP chưa mở hoặc không tìm thấy tab ChatGPT Web đang chạy."
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
    {
      cdpPort: z.number().optional().describe("Cổng CDP tùy chỉnh (VD: 57326 cho GPM)"),
      wsEndpoint: z.string().optional().describe("WebSocket CDP endpoint tùy chỉnh")
    },
    async ({ cdpPort, wsEndpoint }) => {
      try {
        const res = await browserBridge.execute("list_tabs", { cdpPort, wsEndpoint });
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

  // Tool: Đóng toàn bộ trình duyệt Chrome CDP để giải phóng RAM và CPU
  mcp.tool(
    "browser_close",
    {
      cdpPort: z.number().optional().describe("Cổng CDP tùy chỉnh (VD: 57326 cho GPM)"),
      wsEndpoint: z.string().optional().describe("WebSocket CDP endpoint tùy chỉnh")
    },
    async ({ cdpPort, wsEndpoint }) => {
      try {
        const res = await browserBridge.execute("close", { cdpPort, wsEndpoint });
        return {
          content: [{
            type: "text",
            text: `✅ ${res.message}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi đóng trình duyệt: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Quản lý & kiểm tra trạng thái động cơ Chrome CDP
  mcp.tool(
    "browser_engine_status",
    {
      mode: z.enum(["cdp"]).optional().describe("Chế độ động cơ trình duyệt: 'cdp' (Chrome DevTools Protocol mặc định)"),
      cdpPort: z.number().optional().describe("Cổng Chrome DevTools Protocol (CDP) tùy chỉnh (VD: 57326 cho GPM Login/Automate, mặc định: 9222)"),
      wsEndpoint: z.string().optional().describe("Địa chỉ WebSocket CDP tùy chỉnh do GPM hoặc Chrome cấp (VD: 'ws://127.0.0.1:57326/devtools/browser/...')"),
      headless: z.boolean().optional().describe("Bật/tắt chế độ chạy ngầm Chrome (headless) không hiện cửa sổ"),
      hud: z.boolean().optional().describe("Bật/tắt thanh HUD điều khiển và viền xanh trên trang web"),
      autoClose: z.boolean().optional().describe("Bật/tắt tự động đóng Chrome sau 60s không có tác vụ duyệt web (mặc định: true)"),
      benchmark: z.boolean().optional().describe("Có chạy đo đạc tốc độ phản hồi (latency) của động cơ CDP không (mặc định: false)")
    },
    async ({ mode, cdpPort, wsEndpoint, headless, hud, autoClose, benchmark }) => {
      try {
        const toUpdate: any = {};
        if (mode) {
          browserBridge.setEngineMode(mode);
          toUpdate.browserEngine = mode;
        }
        if (typeof cdpPort === "number" && cdpPort > 0) {
          toUpdate.cdpPort = cdpPort;
          cdpBridge.setPort(cdpPort);
        }
        if (typeof wsEndpoint === "string") {
          toUpdate.cdpWsEndpoint = wsEndpoint;
          cdpBridge.setWsEndpoint(wsEndpoint);
        }
        if (typeof headless === "boolean") toUpdate.cdpHeadless = headless;
        if (typeof hud === "boolean") toUpdate.cdpHud = hud;
        if (typeof autoClose === "boolean") toUpdate.cdpAutoClose = autoClose;
        if (Object.keys(toUpdate).length > 0) {
          updateSettings(toUpdate);
        }

        const status = await browserBridge.getStatus();
        const settings = getSettings();
        let report = [
          `⚙️ TRẠNG THÁI ĐỘNG CƠ ĐIỀU KHIỂN TRÌNH DUYỆT (CHROME CDP):`,
          `- Chế độ (Mode): ${status.mode.toUpperCase()} (100% Native CDP)`,
          `- Trạng thái (Active): ${status.activeEngine === "cdp" ? "✅ ĐANG HOẠT ĐỘNG" : "❌ CHƯA KẾT NỐI"}`,
          `- Khả dụng: ${status.cdp.available ? "✅ Sẵn sàng" : "❌ Cổng chưa mở"}`,
          `- Cổng (Port): ${status.cdp.port}`,
          `- WebSocket Endpoint: ${status.cdp.wsEndpoint || "(mặc định: http://127.0.0.1:" + status.cdp.port + ")"}`,
          `- Chạy ngầm (Headless): ${settings.cdpHeadless ? "✅ Bật (Ẩn cửa sổ)" : "❌ Tắt (Hiện cửa sổ)"}`,
          `- Thanh HUD & Viền xanh: ${settings.cdpHud ? "✅ Bật" : "❌ Tắt"}`,
          `- Tự động đóng khi rảnh (Auto Close): ${settings.cdpAutoClose ? "✅ Bật (sau 60s idle)" : "❌ Tắt"}`,
        ];

        if (benchmark) {
          report.push(`\n📊 KẾT QUẢ ĐO ĐẠC TỐC ĐỘ PHẢN HỒI CDP (BENCHMARK):`);
          const bench = await browserBridge.benchmark();
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
