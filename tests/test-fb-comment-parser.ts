#!/usr/bin/env bun
/**
 * FB comment parser tests — thuần, không cần DOM thật, không cần node_modules.
 * Mục đích (theo yêu cầu "FB đổi DOM cũng vẫn chạy được"):
 *  1. Parser tách đúng tác giả / tác giả cha / thời gian / strategy cho
 *     mọi mẫu tên đã biết, kể cả tên chứa "vào" hay "dưới tên".
 *  2. cleanFbCommentText bỏ đúng nhiễu, không ăn mất nội dung.
 *  3. Drift check: file extension browser-controller.ts vẫn chứa cùng
 *     các mẫu VN đã xác minh live — sửa parser ở daemon mà quên sửa
 *     bản copy trong extension thì test này fail ngay.
 *  4. buildFbReplyDraftPrompt luôn mang runId + commentKey + mode, và
 *     chế độ draft luôn nói rõ KHÔNG gửi, chế độ auto luôn nhắc kiểm
 *     chứng sau khi gửi.
 *
 * Run: bun scripts/test-fb-comment-parser.ts
 * Exit 0 = all checks pass, exit 1 = any check fails.
 */
import * as fs from "node:fs";
import {
  buildFbReplyDraftPrompt,
  cleanFbCommentText,
  parseFbCommentName,
} from "../src/daemon/fb-comment-parser";

let failures = 0;
let total = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  total += 1;
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

// --- VN top-level ---
const vnTop = parseFbCommentName("Bình luận dưới tên Nhân Nguyên vào 5 phút trước");
check("vn-top author/time/strategy", vnTop?.author === "Nhân Nguyên" && vnTop?.time === "5 phút trước" && vnTop?.strategy === "vn-top" && vnTop?.parentAuthor === null, vnTop);

// Tên chứa "vào" — phải tách ở lần " vào " CUỐI, không phải lần đầu.
const vnTricky = parseFbCommentName("Bình luận dưới tên Vào Đời vào 2 giờ trước");
check("vn-top name containing 'vào'", vnTricky?.author === "Vào Đời" && vnTricky?.time === "2 giờ trước", vnTricky);

// --- VN reply ---
const vnReply = parseFbCommentName("Phản hồi bình luận của Nhân Nguyên dưới tên Phạm Thành Nam vào 2 phút trước");
check("vn-reply parent/author/time", vnReply?.parentAuthor === "Nhân Nguyên" && vnReply?.author === "Phạm Thành Nam" && vnReply?.time === "2 phút trước" && vnReply?.strategy === "vn-reply", vnReply);

// --- EN fallback (best-effort) ---
const enTop = parseFbCommentName("Comment by Jane Doe · 3h");
check("en-top with time", enTop?.author === "Jane Doe" && enTop?.time === "3h" && enTop?.strategy === "en-top", enTop);
const enTopNoTime = parseFbCommentName("Comment by Jane Doe");
check("en-top without time", enTopNoTime?.author === "Jane Doe" && enTopNoTime?.time === "", enTopNoTime);
const enReply = parseFbCommentName("Reply to John Smith's comment by Jane Doe");
check("en-reply", enReply?.parentAuthor === "John Smith" && enReply?.author === "Jane Doe" && enReply?.strategy === "en-reply", enReply);

// --- Không khớp thì null, không đoán ---
check("unknown pattern returns null", parseFbCommentName("Bài viết của Ai Đó") === null);
check("empty returns null", parseFbCommentName("") === null);
check("vn-top missing time returns null", parseFbCommentName("Bình luận dưới tên Ai Đó") === null);
check("vn-reply missing author returns null", parseFbCommentName("Phản hồi bình luận của Ai Đó dưới tên  vào 2 phút trước") === null);

// --- cleanFbCommentText ---
const parsedTop = parseFbCommentName("Bình luận dưới tên An vào 5 phút trước")!;
check(
  "clean removes author + time, keeps content",
  cleanFbCommentText("An Sản phẩm này giá bao nhiêu? 5 phút trước", parsedTop) === "Sản phẩm này giá bao nhiêu?",
  cleanFbCommentText("An Sản phẩm này giá bao nhiêu? 5 phút trước", parsedTop),
);
const parsedReply = parseFbCommentName("Phản hồi bình luận của An dưới tên Bình vào 2 phút trước")!;
check(
  "clean reply removes mentioned parent name",
  cleanFbCommentText("An Bình Cảm ơn bạn nhé 2 phút trước", parsedReply) === "Cảm ơn bạn nhé",
  cleanFbCommentText("An Bình Cảm ơn bạn nhé 2 phút trước", parsedReply),
);
check(
  "clean removes badge noise",
  cleanFbCommentText("An Xem thông tin về huy hiệu danh tính Tác giả Hay quá 5 phút trước", parsedTop).includes("Hay quá"),
);

// --- Draft prompt ---
const draftPrompt = buildFbReplyDraftPrompt({
  runId: "fbreply_1",
  commentKey: "abc123",
  postUrl: "https://www.facebook.com/post/1",
  mode: "draft",
  author: "An",
  commentText: "Giá bao nhiêu?",
  time: "5 phút trước",
  tone: "thân thiện",
});
check("draft prompt carries runId + key + mode", draftPrompt.includes("fbreply_1") && draftPrompt.includes("abc123") && draftPrompt.includes("draft"));
check("draft prompt forbids sending", draftPrompt.includes("KHÔNG bấm gửi"));
const autoPrompt = buildFbReplyDraftPrompt({
  runId: "fbreply_1",
  commentKey: "abc123",
  postUrl: "https://www.facebook.com/post/1",
  mode: "auto",
  author: "An",
  commentText: "Giá bao nhiêu?",
  time: "",
});
check("auto prompt requires verify after send", autoPrompt.includes("kiểm chứng") && autoPrompt.includes("fb_reply_mark_replied"));

// --- Drift check: extension copy vẫn chứa mẫu VN đã xác minh ---
const controller = fs.readFileSync("extension/src/background/browser-controller.ts", "utf-8");
check("extension still contains VN top pattern", controller.includes("Bình luận dưới tên "));
check("extension still contains VN reply pattern", controller.includes("Phản hồi bình luận của "));
check("extension still contains EN fallback", controller.includes("Comment by "));

console.log(failures === 0 ? `\nAll ${total} FB comment parser checks passed.` : `\n${failures}/${total} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
