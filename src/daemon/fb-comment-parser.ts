/**
 * FB comment parser — thuần, không phụ thuộc DOM hay MCP.
 *
 * Mục đích: khi Facebook đổi DOM, chỉ cần thêm một strategy mới vào
 * `parseFbCommentName` + thêm case test, không sửa logic vòng lặp.
 * Extension (browser-controller.ts, hàm readComments) chứa một bản copy
 * của cùng logic này bên trong executeScript (vì code chạy trong trang
 * phải tự chứa, không import được module ngoài). Test
 * scripts/test-fb-comment-parser.ts kiểm tra cả hai chỗ đều chứa cùng
 * các mẫu VN đã xác minh live, để hai bản không lệch nhau âm thầm.
 *
 * Đã xác minh live ngày 2026-10-31 (bài công khai, không đăng nhập):
 * - VN top:    "Bình luận dưới tên <tác giả> vào <thời gian>"
 * - VN reply:  "Phản hồi bình luận của <tác giả cha> dưới tên <tác giả> vào <thời gian>"
 * - Bình luận / phản hồi là các <article> ngang hàng, không lồng nhau.
 * - Với phản hồi, link đầu tiên trong article có thể là tên người được
 *   nhắc tới, KHÔNG phải tác giả — vì vậy tác giả luôn tách từ tên
 *   truy cập, không lấy link đầu tiên.
 * Chưa xác minh live (best-effort, fallback): các mẫu tiếng Anh dưới đây.
 * Nếu Facebook đổi ngôn ngữ hiển thị, strategy EN là đường dự phòng,
 * không phải đường chính.
 */
export type FbCommentStrategy = "vn-top" | "vn-reply" | "en-top" | "en-reply";

export interface ParsedFbCommentName {
  parentAuthor: string | null;
  author: string;
  /** Thời gian dạng tương đối như trang hiển thị; có thể rỗng nếu tên không chứa thời gian. */
  time: string;
  strategy: FbCommentStrategy;
}

function clean(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ");
}

/** Tách thời gian ở lần xuất hiện CUỐI của " vào " (đề phòng tên chứa "vào"). */
function splitVnTime(head: string): { main: string; time: string } | null {
  const idx = head.lastIndexOf(" vào ");
  if (idx < 0) return null;
  return { main: head.slice(0, idx).trim(), time: head.slice(idx + 5).trim() };
}

export function parseFbCommentName(name: string): ParsedFbCommentName | null {
  const t = clean(name);
  if (!t) return null;

  // VN reply: "Phản hồi bình luận của <cha> dưới tên <tác giả> vào <thời gian>"
  const vnReplyPrefix = "Phản hồi bình luận của ";
  if (t.startsWith(vnReplyPrefix)) {
    const rest = t.slice(vnReplyPrefix.length);
    const byIdx = rest.lastIndexOf(" dưới tên ");
    if (byIdx < 0) return null;
    const parentAuthor = rest.slice(0, byIdx).trim();
    const tail = splitVnTime(rest.slice(byIdx + " dưới tên ".length));
    if (!tail || !parentAuthor || !tail.main) return null;
    return { parentAuthor, author: tail.main, time: tail.time, strategy: "vn-reply" };
  }

  // VN top: "Bình luận dưới tên <tác giả> vào <thời gian>"
  const vnTopPrefix = "Bình luận dưới tên ";
  if (t.startsWith(vnTopPrefix)) {
    const tail = splitVnTime(t.slice(vnTopPrefix.length));
    if (!tail || !tail.main) return null;
    return { parentAuthor: null, author: tail.main, time: tail.time, strategy: "vn-top" };
  }

  // EN fallback (best-effort, chưa xác minh live):
  // "Comment by <author>" — thời gian có thể nằm sau " · " nếu có.
  const enTopPrefix = "Comment by ";
  if (t.startsWith(enTopPrefix)) {
    const rest = t.slice(enTopPrefix.length);
    const dotIdx = rest.lastIndexOf(" · ");
    if (dotIdx >= 0) {
      return { parentAuthor: null, author: rest.slice(0, dotIdx).trim(), time: rest.slice(dotIdx + 3).trim(), strategy: "en-top" };
    }
    return { parentAuthor: null, author: rest.trim(), time: "", strategy: "en-top" };
  }

  // EN reply fallback: "Reply to <parent>'s comment by <author>"
  const enReplyPrefix = "Reply to ";
  if (t.startsWith(enReplyPrefix)) {
    const byIdx = t.lastIndexOf("'s comment by ");
    if (byIdx < 0) return null;
    const parentAuthor = t.slice(enReplyPrefix.length, byIdx).trim();
    const author = t.slice(byIdx + "'s comment by ".length).trim();
    if (!parentAuthor || !author) return null;
    return { parentAuthor, author, time: "", strategy: "en-reply" };
  }

  return null;
}

/**
 * Làm sạch nội dung bình luận từ innerText của article: bỏ tên tác giả,
 * thời gian và các chuỗi nhiễu (huy hiệu tác giả). Không đoán thêm gì.
 */
export function cleanFbCommentText(articleText: string, parsed: ParsedFbCommentName): string {
  let text = clean(articleText);
  if (parsed.author) text = text.replace(parsed.author, "").trim();
  if (parsed.time) {
    const ti = text.lastIndexOf(parsed.time);
    if (ti >= 0) text = text.slice(0, ti).trim();
  }
  if (parsed.parentAuthor && text.startsWith(parsed.parentAuthor)) {
    text = text.slice(parsed.parentAuthor.length).trim();
  }
  return text.replace(/Xem thông tin về huy hiệu danh tính/g, "").replace(/^Tác giả\s*/g, "").trim();
}

/**
 * Prompt gửi một bình luận về cho ChatGPT Web để nó soạn + (tùy mode)
 * gửi câu trả lời. Đây là "cầu nối" giữa tab Facebook và tab ChatGPT:
 * daemon inject prompt này vào ChatGPT Web qua injection outbox
 * (fb_reply_send_to_chatgpt), ChatGPT đọc bình luận, soạn câu trả lời
 * theo đúng ngôn ngữ của bình luận, rồi dùng browser tools + fb_reply_*
 * để gửi và ghi sổ. Prompt luôn mang runId + commentKey để không gửi
 * nhầm bình luận, và luôn nhắc kiểm chứng sau khi gửi.
 */
export function buildFbReplyDraftPrompt(input: {
  runId: string;
  commentKey: string;
  postUrl: string;
  mode: "draft" | "auto";
  author: string;
  commentText: string;
  time: string;
  tone?: string;
}): string {
  const lines = [
    `💬 [Otter FB Reply — bình luận mới cần trả lời]`,
    `Phiên: ${input.runId} | Bài: ${input.postUrl} | Chế độ: ${input.mode} | commentKey: ${input.commentKey}`,
    ``,
    `Bình luận của ${input.author}${input.time ? ` (${input.time})` : ""}:`,
    `${input.commentText}`,
    ``,
    `Hãy soạn câu trả lời bằng đúng ngôn ngữ của bình luận, ngắn gọn, đúng ý hỏi${input.tone ? `, tone: ${input.tone}` : ""}.`,
    `Tự động xác nhận & trả lời 100%: Tự suy luận câu trả lời hữu ích, khéo léo, tự nhiên theo ngữ cảnh bài viết và tư vấn an toàn. Tự động gửi luôn lên Facebook, KHÔNG bỏ qua, KHÔNG chờ người dùng xác nhận tay.`,
  ];
  if (input.mode === "draft") {
    lines.push(
      `Chế độ draft: CHỈ lưu câu trả lời bằng fb_reply_save_draft, KHÔNG bấm gửi lên Facebook.`,
    );
  } else {
    lines.push(
      `Chế độ auto (TỰ ĐỘNG GỬI 100%):
1. Thả Like: Nếu có likeIndex và isLiked=false, gọi 'browser_click' vào likeIndex.
2. Mở ô trả lời: Gọi 'browser_click' vào replyIndex.
3. Gõ và gửi ngay: Gọi tool 'browser_type' với targetIndex=-1 (hoặc index ô nhập), text là câu trả lời của bạn, và pressEnter=true để gửi tự động! Lưu ý Facebook gửi bằng phím Enter, không có nút Gửi riêng.
4. Đọc lại bằng 'fb_read_comments' để kiểm chứng câu trả lời đã hiện, rồi gọi 'fb_reply_mark_replied'.
5. Tuyệt đối KHÔNG gọi fb_reply_mark_skipped để chờ xác nhận. Tự động xác nhận và gửi hoàn tất!`,
    );
  }
  lines.push(`Không gửi trùng: bình luận này chưa được đánh dấu sent trong phiên.`);
  return lines.join("\n");
}
