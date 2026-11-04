/**
 * MCP tool wrappers cho FB Auto Post (xem ../fb-post.ts và ../fb-news.ts).
 * Lớp mỏng thôi: validation và persistence nằm ở fb-post.ts để test
 * được mà không cần MCP server, giống mẫu fb-reply-tools.ts.
 *
 * LƯU Ý QUAN TRỌNG — bước đăng thật KHÔNG có tool riêng ở đây: nó đi
 * qua các tool browser_open/browser_read_page/browser_type/browser_click
 * chung. DOM ô soạn bài Facebook khi đã đăng nhập CHƯA từng được quan
 * sát (mọi lần soi trước đây đều ở trạng thái chưa đăng nhập, Facebook
 * không hiện ô nhập), nên trước lần chạy auto thật đầu tiên phải mở
 * tab đã đăng nhập, đọc browser_read_page để tìm đúng index của ô
 * soạn bài và nút Đăng, rồi mới gõ digest và bấm Đăng. Sau khi đăng,
 * đọc lại trang để thấy bài vừa đăng rồi mới gọi fb_post_mark_posted.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import { DEFAULT_FEEDS, fetchFeeds } from "../fb-news";
import {
  finishFbPostRun,
  getFbPostRun,
  getFbPostStatus,
  getPostedDigestCount,
  markFbPostFailed,
  markFbPostPosted,
  markFbPostSkipped,
  nextFbPostDigest,
  pauseFbPostRun,
  recordFbPostItems,
  resumeFbPostRun,
  startFbPostRun,
  stopFbPostRun,
} from "../fb-post";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

const POST_EXECUTION_GUIDE =
  "Để đăng digest lên Facebook: (1) browser_open tới targetUrl trên tab đã đăng nhập Facebook, " +
  "(2) browser_read_page để tìm index ô soạn bài và nút Đăng — DOM này CHƯA được kiểm chứng, không đoán index, " +
  "(3) browser_type gõ đúng digestText vào ô soạn bài, (4) browser_click nút Đăng, " +
  "(5) đọc lại trang để thấy bài vừa đăng rồi mới gọi fb_post_mark_posted. " +
  "Nếu Facebook chặn hoặc không thấy bài hiện lên, gọi fb_post_mark_failed kèm lý do (blocked=true khi bị chặn).";

export function registerFbPostTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "fb_post_start",
    "Bắt đầu một phiên đăng bài Facebook tự động (chế độ auto, người dùng đã chọn đăng luôn). Một đích đăng chỉ có một phiên running/paused tại một thời điểm. Mặc định một phiên đăng 1 bài digest gồm 5 tin mới nhất, trong tối đa 60 phút.",
    {
      targetUrl: z.string().describe("URL đích đăng: trang cá nhân, page hoặc nhóm Facebook (mở bằng browser_open)"),
      maxPosts: z.number().int().min(1).max(10).optional().describe("Số bài digest tối đa / phiên (mặc định 1)"),
      maxRunMinutes: z.number().int().min(1).optional().describe("Thời gian tối đa / phiên, tính bằng phút (mặc định 60)"),
      digestSize: z.number().int().min(1).max(10).optional().describe("Số tin trong một bài digest (mặc định 5)"),
      feeds: z.array(z.string()).optional().describe("URL RSS tự chọn; bỏ trống dùng VnExpress + Tuổi Trẻ mặc định"),
    },
    async (args) => {
      try {
        const run = startFbPostRun(getDatabase() as any, { ...args, mode: "auto" });
        onActivity?.({ type: "fb_post", action: "start", runId: run.id, targetUrl: run.targetUrl, mode: run.mode });
        return text({ runId: run.id, status: run.status, mode: run.mode, maxPosts: run.maxPosts, digestSize: run.digestSize });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_fetch_news",
    "Fetch tin mới từ RSS và ghi vào phiên. Feed hỏng chỉ ghi lỗi của feed đó, không làm hỏng cả lần fetch. Ghi trùng cùng link trong một phiên tự bỏ qua (dedupe bằng sha256 của link).",
    {
      runId: z.string(),
      feeds: z.array(z.string()).optional().describe("URL RSS tự chọn; bỏ trống dùng feed của phiên, rồi tới mặc định"),
    },
    async ({ runId, feeds }) => {
      try {
        const db: any = getDatabase();
        const run = getFbPostRun(db, runId);
        if (!run) throw new Error(`Không tìm thấy phiên đăng bài: ${runId}`);
        const urls = feeds?.length ? feeds : run.feeds.length ? run.feeds : DEFAULT_FEEDS.map((f) => f.url);
        const { items, feeds: feedResults } = await fetchFeeds(urls);
        const { recorded, total } = recordFbPostItems(db, runId, items);
        onActivity?.({ type: "fb_post", action: "fetch_news", runId, newItems: recorded, totalItems: total });
        return text({ runId, feeds: feedResults, newItems: recorded, totalItems: total });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_next",
    "Lấy bài digest tiếp theo để đăng (tiêu đề + link + nguồn, không thêm nội dung ngoài feed). Trả về lý do rõ ràng khi hết giới hạn bài, hết thời gian, đăng quá nhanh, hoặc phiên không còn chạy — khi đó phải dừng đúng cách, không tự đăng tiếp. " + POST_EXECUTION_GUIDE,
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const result = nextFbPostDigest(getDatabase() as any, runId);
        if (!result.ok) return text(result);
        return text({
          digestText: result.digest.digestText,
          items: result.digest.items.map((item) => ({
            itemKey: item.itemKey,
            title: item.title,
            link: item.link,
            source: item.source,
          })),
          remainingPosts: result.remainingPosts,
          executionGuide: POST_EXECUTION_GUIDE,
        });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_mark_posted",
    "Đánh dấu một bài digest đã đăng thành công (chỉ gọi SAU KHI đã đọc lại trang và thấy bài vừa đăng). Gọi hai lần với cùng danh sách item chỉ đếm một bài.",
    { runId: z.string(), itemKeys: z.array(z.string()).describe("Các itemKey trong digest vừa đăng (lấy từ fb_post_next)") },
    async ({ runId, itemKeys }) => {
      try {
        const items = markFbPostPosted(getDatabase() as any, runId, itemKeys);
        const postedDigests = getPostedDigestCount(getDatabase() as any, runId);
        onActivity?.({ type: "fb_post", action: "posted", runId, itemCount: items.length, postedDigests });
        return text({ postedItems: items.length, postedDigests, itemKeys });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_mark_failed",
    "Đánh dấu một bài digest đăng thất bại kèm lý do. Đặt blocked=true (hoặc lý do nhắc tới bị chặn) để phiên tự chuyển sang blocked và dừng đăng tiếp.",
    {
      runId: z.string(),
      itemKeys: z.array(z.string()),
      reason: z.string(),
      blocked: z.boolean().optional().describe("Facebook chặn đăng (checkpoint, khóa tạm thời...) thì đặt true"),
    },
    async ({ runId, itemKeys, reason, blocked }) => {
      try {
        const items = markFbPostFailed(getDatabase() as any, runId, itemKeys, reason, blocked ?? false);
        return text({ failedItems: items.length, itemKeys });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_mark_skipped",
    "Đánh dấu bỏ qua các tin trong một digest kèm lý do (tin trùng nội dung đã đăng, tin nhạy cảm, không phù hợp...).",
    { runId: z.string(), itemKeys: z.array(z.string()), reason: z.string() },
    async ({ runId, itemKeys, reason }) => {
      try {
        const items = markFbPostSkipped(getDatabase() as any, runId, itemKeys, reason);
        return text({ skippedItems: items.length, itemKeys });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_status",
    "Xem trạng thái phiên: đếm item theo pending/posted/failed/skipped, số bài digest đã đăng, và 10 tin gần nhất.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const db: any = getDatabase();
        const status = getFbPostStatus(db, runId);
        return text({ ...status, postedDigests: getPostedDigestCount(db, runId) });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_stop",
    "Dừng phiên ngay. Không đăng thêm bài nào nữa sau lệnh này.",
    { runId: z.string(), reason: z.string().optional() },
    async ({ runId, reason }) => {
      try {
        const run = stopFbPostRun(getDatabase() as any, runId, reason);
        return text({ runId: run.id, status: run.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_pause",
    "Tạm dừng phiên (resume được, tiếp tục từ tin pending tiếp theo).",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const run = pauseFbPostRun(getDatabase() as any, runId);
        return text({ runId: run.id, status: run.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_resume",
    "Tiếp tục phiên đang pause.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const run = resumeFbPostRun(getDatabase() as any, runId);
        return text({ runId: run.id, status: run.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_post_finish",
    "Kết thúc phiên và trả về báo cáo đếm cuối cùng.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const db: any = getDatabase();
        const run = finishFbPostRun(db, runId);
        return text({ ...getFbPostStatus(db, run.id), postedDigests: getPostedDigestCount(db, run.id) });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );
}
