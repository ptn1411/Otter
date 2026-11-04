import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { browserBridge } from "../browser-bridge";

export function registerMuseTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool: Giao nhiệm vụ cho AI Agent Muse trên web xử lý
  mcp.tool(
    "ask_muse_agent",
    {
      task: z.string().describe("Nhiệm vụ chi tiết muốn giao cho Muse AI xử lý (ví dụ: viết code, giải thuật, tạo video, vẽ ảnh, phân tích...)"),
      new_thread: z.boolean().optional().default(true).describe("Mở cuộc trò chuyện mới trên Muse để làm việc độc lập (mặc định: true)"),
      keep_tab_open: z.boolean().optional().default(true).describe("Giữ tab Muse lại trên trình duyệt sau khi xong để người dùng có thể xem kết quả trực tiếp (mặc định: true)")
    },
    async ({ task, new_thread, keep_tab_open }) => {
      try {
        onActivity?.({
          type: "muse_action",
          action: "dispatch_task",
          task: task.slice(0, 150)
        });

        const res = await browserBridge.execute(
          "ask_muse",
          {
            task,
            newThread: new_thread ?? true,
            closeTabOnDone: keep_tab_open === false,
            timeoutMs: 180000
          },
          190000
        );

        if (!res.ok) {
          return {
            content: [{
              type: "text",
              text: `❌ Muse AI không thể hoàn thành nhiệm vụ: ${res.error || "Không rõ nguyên nhân"}`
            }],
            isError: true
          };
        }

        let output = `🤖 **Phản hồi từ Muse AI Agent:**\n\n${res.replyText}\n`;
        if (res.attachments && res.attachments.length > 0) {
          const mediaDir = path.resolve("storage/media/muse");
          await fs.mkdir(mediaDir, { recursive: true });

          output += `\n💾 **Thành phẩm đã được tự động tải và lưu về máy tính:**\n`;
          for (let i = 0; i < res.attachments.length; i++) {
            const att = res.attachments[i];
            let localPath = "";
            let sizeDesc = "";

            if (att.base64) {
              let ext = ".bin";
              if (att.mime?.includes("mp4") || att.type === "video") ext = ".mp4";
              else if (att.mime?.includes("webp")) ext = ".webp";
              else if (att.mime?.includes("png")) ext = ".png";
              else if (att.mime?.includes("jpeg") || att.mime?.includes("jpg")) ext = ".jpg";

              const filename = `muse_${att.type || "media"}_${Date.now()}_${i + 1}${ext}`;
              localPath = path.join(mediaDir, filename);
              const buffer = Buffer.from(att.base64, "base64");
              await fs.writeFile(localPath, buffer);

              const mb = (buffer.length / (1024 * 1024)).toFixed(2);
              sizeDesc = buffer.length > 1024 * 1024 ? ` (${mb} MB)` : ` (${Math.round(buffer.length / 1024)} KB)`;
            }

            if (localPath) {
              output += `- [${(att.type || "media").toUpperCase()}] 📂 Đường dẫn lưu: \`${localPath}\`${sizeDesc}\n`;
            } else if (att.url) {
              output += `- [${(att.type || "media").toUpperCase()}] 🌐 Link: ${att.url}\n`;
            }
          }
        }

        return {
          content: [{
            type: "text",
            text: output
          }]
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: `Lỗi kết nối tới Muse qua Extension: ${err.message}`
          }],
          isError: true
        };
      }
    }
  );
}

