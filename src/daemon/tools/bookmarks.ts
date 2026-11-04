import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import { saveBookmark, searchBookmarks, listBookmarks, deleteBookmark } from "../bookmarks";

export function registerBookmarkTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool: Lưu Bookmark vào kho tri thức cá nhân
  mcp.tool(
    "bookmark_save",
    "Lưu một liên kết trang web (Bookmark) vào kho tri thức cá nhân cục bộ để AI và người dùng có thể tìm kiếm lại theo từ khóa bất cứ lúc nào.",
    {
      url: z.string().describe("Địa chỉ URL của trang web cần lưu (ví dụ: 'https://github.com/remotion-dev/remotion')"),
      title: z.string().describe("Tiêu đề trang web hoặc ghi chú ngắn (ví dụ: 'Remotion - Tạo video bằng React')"),
      description: z.string().optional().describe("Mô tả tóm tắt nội dung chính hoặc lý do lưu trang web này"),
      tags: z.union([z.array(z.string()), z.string()]).optional().describe("Danh sách thẻ phân loại (ví dụ: ['video', 'react', 'code'] hoặc 'video, react')")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const bm = saveBookmark(db, args);
        onActivity?.({
          type: "bookmark_action",
          action: "save",
          url: bm.url,
          title: bm.title,
          tags: bm.tags
        });
        return {
          content: [{
            type: "text",
            text: `✅ Đã lưu bookmark thành công vào kho tri thức!\n• Tiêu đề: ${bm.title}\n• URL: ${bm.url}\n• Thẻ tags: ${bm.tags.length ? bm.tags.join(", ") : "(không)"}\n• Mô tả: ${bm.description || "(không)"}\n• Mã ID: ${bm.id}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi lưu bookmark: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Tìm kiếm Bookmark theo từ khóa liên quan
  mcp.tool(
    "bookmark_search",
    "Tìm kiếm các liên kết (bookmarks) đã lưu trong kho tri thức theo từ khóa liên quan (tìm kiếm trong tiêu đề, mô tả, thẻ tag và URL). Khi người dùng hỏi về các link, bài viết, video hay tài liệu đã lưu trước đó, HÃY GỌI CÔNG CỤ NÀY.",
    {
      query: z.string().describe("Từ khóa hoặc cụm từ tìm kiếm (ví dụ: 'thú cưng', 'video remotion', 'hacker news', 'python')"),
      limit: z.number().optional().describe("Số lượng kết quả tối đa muốn trả về (mặc định: 10)")
    },
    async ({ query, limit = 10 }) => {
      try {
        const db = getDatabase();
        const results = searchBookmarks(db, query, limit);
        onActivity?.({
          type: "bookmark_action",
          action: "search",
          query,
          count: results.length
        });

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `🔍 Không tìm thấy bookmark nào liên quan đến từ khóa "${query}". Bạn có thể thử từ khóa ngắn hơn hoặc gọi 'bookmark_list' để xem tất cả liên kết đã lưu.`
            }]
          };
        }

        const formatted = results.map((b, i) => {
          const dateStr = new Date(b.createdAt).toLocaleDateString("vi-VN");
          const tagsStr = b.tags.length > 0 ? ` [${b.tags.join(", ")}]` : "";
          return `${i + 1}. **[${b.title}](${b.url})**${tagsStr}\n   - URL: ${b.url}\n   - Mô tả: ${b.description || "(Chưa có mô tả)"}\n   - Ngày lưu: ${dateStr}`;
        }).join("\n\n");

        return {
          content: [{
            type: "text",
            text: `🔍 Tìm thấy ${results.length} bookmark liên quan đến từ khóa "${query}":\n\n${formatted}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi tìm kiếm bookmark: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Xem danh sách Bookmark
  mcp.tool(
    "bookmark_list",
    "Xem danh sách các bookmark đã lưu trong kho tri thức cục bộ (hỗ trợ lọc theo thẻ tag).",
    {
      limit: z.number().optional().describe("Số lượng liên kết cần lấy (mặc định: 20)"),
      tag: z.string().optional().describe("Lọc theo thẻ tag cụ thể (ví dụ: 'video', 'ai', 'docs')")
    },
    async ({ limit = 20, tag }) => {
      try {
        const db = getDatabase();
        const res = listBookmarks(db, limit, 0, tag);
        onActivity?.({
          type: "bookmark_action",
          action: "list",
          tag,
          count: res.items.length
        });

        if (res.items.length === 0) {
          return {
            content: [{
              type: "text",
              text: tag ? `Kho bookmark chưa có liên kết nào mang thẻ tag "${tag}".` : "Kho bookmark hiện đang trống."
            }]
          };
        }

        const formatted = res.items.map((b, i) => {
          const dateStr = new Date(b.createdAt).toLocaleDateString("vi-VN");
          const tagsStr = b.tags.length > 0 ? ` [${b.tags.join(", ")}]` : "";
          return `${i + 1}. **[${b.title}](${b.url})**${tagsStr}\n   - URL: ${b.url}\n   - Ngày lưu: ${dateStr}`;
        }).join("\n");

        return {
          content: [{
            type: "text",
            text: `📚 Danh sách ${res.items.length}/${res.total} bookmark đã lưu${tag ? ` (lọc theo: #${tag})` : ""}:\n\n${formatted}`
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi lấy danh sách bookmark: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool: Xóa Bookmark
  mcp.tool(
    "bookmark_delete",
    "Xóa một bookmark khỏi kho tri thức cá nhân theo ID hoặc URL.",
    {
      idOrUrl: z.string().describe("Mã ID (ví dụ: 'bm-...') hoặc địa chỉ URL chính xác của bookmark cần xóa")
    },
    async ({ idOrUrl }) => {
      try {
        const db = getDatabase();
        const ok = deleteBookmark(db, idOrUrl);
        onActivity?.({
          type: "bookmark_action",
          action: "delete",
          idOrUrl
        });

        if (!ok) {
          return {
            content: [{ type: "text", text: `Không tìm thấy bookmark với ID hoặc URL "${idOrUrl}" để xóa.` }]
          };
        }

        return {
          content: [{ type: "text", text: `✅ Đã xóa thành công bookmark "${idOrUrl}" khỏi kho tri thức.` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Lỗi xóa bookmark: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}
