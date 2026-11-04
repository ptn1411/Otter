import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listWindows, takeScreenshot, mouseAction, keyboardAction, getCuaToolList } from "../desktop";

export function registerDesktopTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool 17: Liệt kê các cửa sổ ứng dụng đang mở trên màn hình Desktop Windows
  mcp.tool(
    "desktop_list_windows",
    {},
    async () => {
      try {
        const windows = await listWindows();
        onActivity?.({ type: "desktop_action", action: "list_windows", count: windows.length });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(windows, null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error listing windows: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 18: Chụp ảnh màn hình Desktop (toàn màn hình)
  mcp.tool(
    "desktop_take_screenshot",
    {
      outputPath: z.string().optional().describe("Đường dẫn lưu tệp ảnh PNG (mặc định: tự động sinh trong thư mục dự án)")
    },
    async ({ outputPath }) => {
      try {
        const res = await takeScreenshot(outputPath);
        onActivity?.({ type: "desktop_action", action: "screenshot", path: res.filePath });
        return {
          content: [{
            type: "text",
            text: `Chụp ảnh màn hình thành công: ${res.filePath} (${res.width}x${res.height})`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error taking screenshot: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 19: Thao tác chuột máy tính (Click, Double Click, Right Click, Move)
  mcp.tool(
    "desktop_mouse_action",
    {
      action: z.enum(["left_click", "right_click", "double_click", "move"]).default("left_click").describe("Hành động chuột: left_click, right_click, double_click, move"),
      x: z.number().describe("Tọa độ X trên màn hình"),
      y: z.number().describe("Tọa độ Y trên màn hình")
    },
    async ({ action, x, y }) => {
      try {
        const msg = await mouseAction(action, x, y);
        onActivity?.({ type: "desktop_action", action, x, y });
        return {
          content: [{ type: "text", text: msg }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error mouse action: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 20: Thao tác bàn phím (Gõ văn bản hoặc bấm phím tắt)
  mcp.tool(
    "desktop_keyboard_action",
    {
      keys: z.string().describe("Chuỗi văn bản cần gõ hoặc phím tắt (ví dụ: 'Hello world', '{ENTER}', '^c' cho Ctrl+C, '^v' cho Ctrl+V, '%{F4}' cho Alt+F4, '{TAB}')")
    },
    async ({ keys }) => {
      try {
        const msg = await keyboardAction(keys);
        onActivity?.({ type: "desktop_action", action: "keyboard", keys });
        return {
          content: [{ type: "text", text: msg }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error keyboard action: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 21: Tra cứu công cụ OpenAI Computer Use Agent (CUA) nếu có
  mcp.tool(
    "cua_get_inventory",
    {
      query: z.string().optional().describe("Từ khóa lọc công cụ CUA (ví dụ: 'window', 'click', 'browser', 'cursor')")
    },
    async ({ query }) => {
      try {
        const tools = await getCuaToolList();
        let filtered = tools;
        if (query) {
          const q = query.toLowerCase();
          filtered = tools.filter((t: any) => 
            (t.name && t.name.toLowerCase().includes(q)) || 
            (t.description && t.description.toLowerCase().includes(q))
          );
        }
        onActivity?.({ type: "cua_action", action: "inventory", count: filtered.length });
        return {
          content: [{
            type: "text",
            text: JSON.stringify(filtered.map((t: any) => ({
              name: t.name || t.id,
              description: t.description
            })), null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error loading CUA inventory: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}
