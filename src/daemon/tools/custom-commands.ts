import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import {
  saveCustomCommand,
  listCustomCommands,
  getCustomCommand,
  deleteCustomCommand,
  togglePinCustomCommand
} from "../custom-commands";

export function registerCustomCommandTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 1. Tool: Tạo hoặc cập nhật tập lệnh tùy chỉnh mới
  mcp.tool(
    "command_create_or_update",
    "Tạo mới hoặc cập nhật một tập lệnh slash command ('/...') cho người dùng trong Otter. Khi người dùng yêu cầu tạo tập lệnh mới hoặc gõ tắt một prompt thường dùng, hãy gọi công cụ này.",
    {
      slash: z.string().describe("Tên lệnh slash (ví dụ: '/audit-vps', '/mydeploy', '/fix-lint')"),
      title: z.string().describe("Tiêu đề ngắn gọn của tập lệnh (ví dụ: 'Kiểm tra tài nguyên VPS', 'Deploy V2 Production')"),
      promptTemplate: z.string().describe("Nội dung câu lệnh hoặc prompt mẫu hoàn chỉnh sẽ tự động điền vào ô chat khi người dùng kích hoạt lệnh này"),
      description: z.string().optional().describe("Mô tả chi tiết chức năng của lệnh"),
      icon: z.string().optional().describe("Biểu tượng emoji đại diện cho lệnh (ví dụ: '⚡', '🚀', '🔍', '🛡️', '📦')"),
      category: z.string().optional().describe("Danh mục phân nhóm lệnh (mặc định: 'Tập lệnh của tôi')"),
      isPinned: z.boolean().optional().describe("Có ghim lệnh này ra thanh công cụ nhanh Quick Action Chips trên khung chat hay không (true/false)")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const cmd = saveCustomCommand(db, args);
        onActivity?.({
          type: "custom_command_action",
          action: "save",
          slash: cmd.slash,
          title: cmd.title,
          isPinned: cmd.isPinned
        });

        const pinText = cmd.isPinned ? " (⭐ Đã ghim ra thanh Quick Action)" : "";
        return {
          content: [{
            type: "text",
            text: `✅ Đã tạo tập lệnh thành công!\n• Lệnh gọi: **${cmd.slash}**\n• Icon: ${cmd.icon}\n• Tiêu đề: ${cmd.title}${pinText}\n• Mô tả: ${cmd.description || "(không)"}\n• Prompt mẫu:\n\`\`\`\n${cmd.promptTemplate}\n\`\`\`\n\nNgười dùng có thể gõ \`${cmd.slash}\` trong ô chat để sử dụng ngay!`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi tạo tập lệnh: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 2. Tool: Liệt kê các tập lệnh hiện có
  mcp.tool(
    "command_list",
    "Xem danh sách các tập lệnh slash command tùy chỉnh do người dùng hoặc AI tạo ra. Hỗ trợ lọc chỉ các lệnh được ghim ra ngoài thanh công cụ nhanh.",
    {
      pinnedOnly: z.boolean().optional().describe("Nếu true, chỉ trả về các lệnh đang được ghim (pinned)")
    },
    async ({ pinnedOnly = false }) => {
      try {
        const db = getDatabase();
        const items = listCustomCommands(db, pinnedOnly);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(items, null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi lấy danh sách tập lệnh: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 3. Tool: Ghim hoặc bỏ ghim tập lệnh ra thanh Quick Action Chips
  mcp.tool(
    "command_pin",
    "Ghim hoặc bỏ ghim một tập lệnh slash command ra thanh phím tắt Quick Action Chips trên ô chat để người dùng có thể bấm 1-chạm mà không cần gõ.",
    {
      slashOrId: z.string().describe("Tên lệnh slash (ví dụ: '/audit-vps') hoặc ID của tập lệnh"),
      pinned: z.boolean().describe("true để ghim ra thanh nhanh, false để bỏ ghim")
    },
    async ({ slashOrId, pinned }) => {
      try {
        const db = getDatabase();
        const cmd = togglePinCustomCommand(db, slashOrId, pinned);
        if (!cmd) {
          return {
            content: [{ type: "text", text: `Không tìm thấy tập lệnh '${slashOrId}'.` }],
            isError: true
          };
        }

        onActivity?.({
          type: "custom_command_action",
          action: "pin_toggle",
          slash: cmd.slash,
          isPinned: cmd.isPinned
        });

        const stateText = cmd.isPinned ? "⭐ Đã ghim ra thanh Quick Action Chips!" : "Đã bỏ ghim khỏi thanh Quick Action Chips.";
        return {
          content: [{
            type: "text",
            text: `✅ ${stateText}\n• Lệnh: **${cmd.slash}** (${cmd.title})`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi ghim tập lệnh: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // 4. Tool: Xóa tập lệnh tùy chỉnh
  mcp.tool(
    "command_delete",
    "Xóa một tập lệnh slash command tùy chỉnh khỏi hệ thống khi người dùng không còn cần sử dụng nữa.",
    {
      slashOrId: z.string().describe("Tên lệnh slash (ví dụ: '/audit-vps') hoặc ID của tập lệnh cần xóa")
    },
    async ({ slashOrId }) => {
      try {
        const db = getDatabase();
        const ok = deleteCustomCommand(db, slashOrId);
        if (!ok) {
          return {
            content: [{ type: "text", text: `Không tìm thấy tập lệnh '${slashOrId}' để xóa.` }],
            isError: true
          };
        }

        onActivity?.({
          type: "custom_command_action",
          action: "delete",
          slashOrId
        });

        return {
          content: [{
            type: "text",
            text: `🗑️ Đã xóa thành công tập lệnh '${slashOrId}'.`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi xóa tập lệnh: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}
