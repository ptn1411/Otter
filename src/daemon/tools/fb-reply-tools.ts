/**
 * MCP tool wrappers cho FB Reply Loop (xem ../fb-reply.ts).
 * Lớp mỏng thôi: validation và persistence nằm ở fb-reply.ts để test
 * được mà không cần MCP server, giống mẫu plan-tools.ts.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserBridge } from "../browser-bridge";
import { enqueueInjection } from "../continuous-loop";
import { getDatabase } from "../db";
import { buildFbReplyDraftPrompt } from "../fb-comment-parser";
import {
  commentKey,
  finishFbReplyRun,
  getFbReplyStatus,
  markFbReplyFailed,
  markFbReplySent,
  markFbReplySkipped,
  nextFbReplyComment,
  pauseFbReplyRun,
  recordFbReplyComment,
  resumeFbReplyRun,
  saveFbReplyDraft,
  startFbReplyRun,
  stopFbReplyRun,
} from "../fb-reply";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerFbReplyTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "fb_reply_start",
    "Bắt đầu một phiên trả lời bình luận Facebook cho một bài cụ thể. Mặc định là chế độ draft (chỉ soạn, không gửi). Một bài chỉ có một phiên running/paused tại một thời điểm.",
    {
      postUrl: z.string().describe("URL bài Facebook cần trả lời bình luận"),
      mode: z.enum(["draft", "auto"]).optional().describe("draft = chỉ soạn, auto = gửi luôn (chỉ dùng khi người dùng nói rõ)"),
      maxReplies: z.number().int().min(1).max(100).optional().describe("Số bình luận tối đa / phiên (mặc định 20)"),
      maxRunMinutes: z.number().int().min(1).optional().describe("Thời gian tối đa / phiên, tính bằng phút (mặc định 60)"),
      tone: z.string().optional().describe("Tone trả lời, ví dụ: thân thiện, ngắn gọn, xưng shop"),
      skipRules: z.array(z.string()).optional().describe("Loại bình luận bỏ qua, ví dụ: spam, link lạ, cần người xác nhận"),
      includeReplies: z.boolean().optional().describe("Có trả lời cả bình luận con trong thread không (mặc định false, chỉ bình luận gốc)"),
      fromRunId: z.string().optional().describe("Phiên draft trước đó, khi chạy phiên gửi từ draft đã duyệt"),
    },
    async (args) => {
      try {
        const run = startFbReplyRun(getDatabase() as any, args);
        onActivity?.({ type: "fb_reply", action: "start", runId: run.id, postUrl: run.postUrl, mode: run.mode });
        return text({ runId: run.id, status: run.status, mode: run.mode, maxReplies: run.maxReplies });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_record",
    "Ghi nhận một bình luận vừa đọc được từ trang vào phiên. Idempotent: ghi lại cùng bình luận không tạo dòng mới. Dùng hash tác giả + nội dung + thời gian làm key chống trùng.",
    {
      runId: z.string(),
      author: z.string().optional(),
      commentText: z.string(),
      time: z.string().optional().describe("Thời gian như trang hiển thị, ví dụ: 2 giờ"),
    },
    async ({ runId, author, commentText, time }) => {
      try {
        const comment = recordFbReplyComment(getDatabase() as any, runId, commentKey(author ?? "", commentText, time ?? ""), author, commentText);
        return text({ commentKey: comment.commentKey, status: comment.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_next",
    "Lấy bình luận pending tiếp theo trong phiên. Trả về lý do rõ ràng khi hết giới hạn, hết thời gian, gửi quá nhanh, hoặc phiên không còn chạy — khi đó phải dừng đúng cách, không tự gửi tiếp.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        return text(nextFbReplyComment(getDatabase() as any, runId));
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_save_draft",
    "Lưu câu trả lời đã soạn cho một bình luận (chế độ draft, không gửi lên Facebook).",
    {
      runId: z.string(),
      commentKey: z.string(),
      draftText: z.string(),
    },
    async ({ runId, commentKey: key, draftText }) => {
      try {
        const comment = saveFbReplyDraft(getDatabase() as any, runId, key, draftText);
        return text({ commentKey: comment.commentKey, status: comment.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_mark_replied",
    "Đánh dấu một bình luận đã gửi thành công (chỉ gọi SAU KHI đã đọc lại trang và thấy câu trả lời hiện dưới đúng bình luận đó). Gọi hai lần trên cùng bình luận chỉ đếm một lần.",
    { runId: z.string(), commentKey: z.string() },
    async ({ runId, commentKey: key }) => {
      try {
        const comment = markFbReplySent(getDatabase() as any, runId, key);
        onActivity?.({ type: "fb_reply", action: "replied", runId, commentKey: key });
        return text({ commentKey: comment.commentKey, status: comment.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_mark_skipped",
    "Đánh dấu bỏ qua một bình luận kèm lý do (của chính mình, đã trả lời rồi, spam, cần người xác nhận...).",
    { runId: z.string(), commentKey: z.string(), reason: z.string() },
    async ({ runId, commentKey: key, reason }) => {
      try {
        const comment = markFbReplySkipped(getDatabase() as any, runId, key, reason);
        return text({ commentKey: comment.commentKey, status: comment.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_mark_failed",
    "Đánh dấu một bình luận gửi thất bại kèm lý do (đã thử lại tối đa 1 lần mà vẫn không hiện câu trả lời).",
    { runId: z.string(), commentKey: z.string(), reason: z.string() },
    async ({ runId, commentKey: key, reason }) => {
      try {
        const comment = markFbReplyFailed(getDatabase() as any, runId, key, reason);
        return text({ commentKey: comment.commentKey, status: comment.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_status",
    "Xem trạng thái phiên: đếm theo pending/drafted/sent/skipped/failed và 10 bình luận gần nhất.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        return text(getFbReplyStatus(getDatabase() as any, runId));
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_stop",
    "Dừng phiên ngay. Không gửi thêm bình luận nào nữa sau lệnh này.",
    { runId: z.string(), reason: z.string().optional() },
    async ({ runId, reason }) => {
      try {
        const run = stopFbReplyRun(getDatabase() as any, runId, reason);
        return text({ runId: run.id, status: run.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_pause",
    "Tạm dừng phiên (resume được, tiếp tục từ bình luận pending tiếp theo).",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const run = pauseFbReplyRun(getDatabase() as any, runId);
        return text({ runId: run.id, status: run.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_resume",
    "Tiếp tục phiên đang pause.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const run = resumeFbReplyRun(getDatabase() as any, runId);
        return text({ runId: run.id, status: run.status });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_read_comments",
    "Đọc bình luận có cấu trúc từ tab Facebook đang điều khiển (mở trước bằng browser_open). Trả về tác giả, nội dung đầy đủ (không cắt 70 ký tự như browser_read_page), thời gian, bình luận gốc hay phản hồi, replyIndex và chẩn đoán DOM. replyIndex chỉ dùng được với danh sách phần tử mà chính lần gọi này lưu — sau mỗi click/cuộn phải gọi lại fb_read_comments. Khi chưa đăng nhập Facebook, replyIndex sẽ là null vì Facebook không hiện nút Trả lời. Để lấy HẾT bình luận: bấm nút 'Xem thêm bình luận' (tìm qua browser_read_page rồi browser_click), rồi gọi lại fb_read_comments và ghi nhận bằng fb_reply_record (bình luận trùng tự bỏ qua), lặp tới khi không còn nút load thêm hoặc hai lần liên tiếp không thêm bình luận mới. Cuộn trang một mình KHÔNG load thêm bình luận của bài gốc — nó load thêm các bài viết khác, nên reader đã giới hạn phạm vi vào dialog của bài gốc khi có thể (xem scopedToDialog).",
    {
      currentUserName: z.string().optional().describe("Tên tài khoản Facebook đang đăng nhập, để tính hasOwnReply (không có thì để null, không đoán)"),
      postUrl: z.string().optional().describe("URL bài viết gốc. Nếu cung cấp, hệ thống tự động kiểm tra xem tab có bị điều hướng lệch không; nếu lệch sẽ tự động mở lại bài viết này trước khi đọc bình luận."),
    },
    async ({ currentUserName, postUrl }) => {
      try {
        const res: any = await browserBridge.execute("read_comments", { currentUserName, postUrl });
        // Thêm commentKey (sha256) để dùng ngay với fb_reply_* mà không cần tự tính.
        const comments = (res.comments ?? []).map((c: any) => ({
          ...c,
          commentKey: commentKey(c.author ?? "", c.text ?? "", c.time ?? ""),
        }));
        return text({ ...res, comments });
      } catch (e: any) {
        return err(`Lỗi đọc bình luận Facebook: ${e.message}`);
      }
    },
  );

  mcp.tool(
    "fb_reply_draft_prompt",
    "Tạo prompt gửi một bình luận về cho ChatGPT Web để nó soạn câu trả lời. Trả về text prompt sẵn dùng — dùng khi muốn xem trước prompt, hoặc dán tay vào ChatGPT Web.",
    {
      runId: z.string(),
      commentKey: z.string(),
      postUrl: z.string(),
      mode: z.enum(["draft", "auto"]),
      author: z.string(),
      commentText: z.string(),
      time: z.string().optional(),
      tone: z.string().optional(),
    },
    async (args) => {
      try {
        return text({
          prompt: buildFbReplyDraftPrompt({ ...args, time: args.time ?? "" }),
        });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_send_to_chatgpt",
    "Gửi một bình luận vào ChatGPT Web qua injection outbox (dedupe theo nội dung, gửi lại khi extension kết nối lại). ChatGPT nhận prompt sẽ soạn câu trả lời và, tùy mode, gửi lên Facebook rồi ghi sổ bằng fb_reply_*. Dùng cho vòng lặp: đọc bình luận ở tab Facebook → gửi về ChatGPT → ChatGPT trả lời → gửi lên Facebook, từng cái một.",
    {
      runId: z.string(),
      commentKey: z.string(),
      postUrl: z.string(),
      mode: z.enum(["draft", "auto"]),
      author: z.string(),
      commentText: z.string(),
      time: z.string().optional(),
      tone: z.string().optional(),
    },
    async (args) => {
      try {
        const prompt = buildFbReplyDraftPrompt({ ...args, time: args.time ?? "" });
        const entry = enqueueInjection(getDatabase() as any, { planId: null, taskId: args.runId, text: prompt });
        onActivity?.({ type: "fb_reply", action: "sent_to_chatgpt", runId: args.runId, commentKey: args.commentKey, outboxId: entry.id });
        return text({ outboxId: entry.id, status: entry.status, commentKey: args.commentKey });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "fb_reply_finish",
    "Kết thúc phiên và trả về báo cáo đếm cuối cùng.",
    { runId: z.string() },
    async ({ runId }) => {
      try {
        const run = finishFbReplyRun(getDatabase() as any, runId);
        return text(getFbReplyStatus(getDatabase() as any, run.id));
      } catch (e: any) {
        return err(e.message);
      }
    },
  );
}
