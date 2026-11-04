#!/usr/bin/env bun
/**
 * FB Reply Loop test — tracker thuần, no MCP server, no node_modules needed.
 * Uses a temp SQLite file, then checks:
 *  1. start tạo run draft mặc định, chặn run trùng cùng post,
 *  2. record idempotent (ghi lại cùng bình luận không tạo dòng mới),
 *  3. next tôn trọng thứ tự + giới hạn maxReplies,
 *  4. mark_replied idempotent (gọi hai lần chỉ đếm một),
 *  5. save_draft / skipped / failed đếm đúng,
 *  6. pause/resume/stop transitions + stop chặn next,
 *  7. persistence: mở lại DB cùng file, run + comments vẫn còn.
 *
 * Run: bun scripts/test-fb-reply.ts
 * Exit 0 = all checks pass, exit 1 = any check fails.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
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
} from "../src/daemon/fb-reply";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-fbreply-"));
const dbPath = path.join(tmpDir, "test.db");
const db: any = initDatabase(dbPath);

const POST = "https://www.facebook.com/share/1A7oj5bKvD/?mibextid=wwXIfr";

// 1. Start + chặn trùng
const run = startFbReplyRun(db, { postUrl: POST, maxReplies: 3 });
check("start creates draft run by default", run.mode === "draft" && run.status === "running");
let duplicateBlocked = false;
try {
  startFbReplyRun(db, { postUrl: POST });
} catch {
  duplicateBlocked = true;
}
check("second running run on same post is blocked", duplicateBlocked);

// 2. Record idempotent
const keyA = commentKey("An", "Sản phẩm này giá bao nhiêu?", "2 giờ");
const keyB = commentKey("Bình", "Cảm ơn shop nhé", "1 giờ");
const keyC = commentKey("Chi", "Giao hàng về Hà Nội mất mấy ngày?", "30 phút");
recordFbReplyComment(db, run.id, keyA, "An", "Sản phẩm này giá bao nhiêu?");
recordFbReplyComment(db, run.id, keyA, "An", "Sản phẩm này giá bao nhiêu?");
recordFbReplyComment(db, run.id, keyB, "Bình", "Cảm ơn shop nhé");
recordFbReplyComment(db, run.id, keyC, "Chi", "Giao hàng về Hà Nội mất mấy ngày?");
check("record twice keeps one row", getFbReplyStatus(db, run.id).recent.length === 3);

// 3. Next theo thứ tự
const next1: any = nextFbReplyComment(db, run.id);
check("next returns first pending comment", next1.ok === true && next1.comment.commentKey === keyA);

// 4. Mark sent idempotent
markFbReplySent(db, run.id, keyA);
markFbReplySent(db, run.id, keyA);
let status = getFbReplyStatus(db, run.id);
check("mark sent twice counts once", status.counts.sent === 1 && status.counts.pending === 2, status.counts);

// 5. Draft / skipped / failed
saveFbReplyDraft(db, run.id, keyB, "Cảm ơn bạn đã ủng hộ shop nhé!");
markFbReplySkipped(db, run.id, keyC, "cần người xác nhận giá ship");
status = getFbReplyStatus(db, run.id);
check("draft/skipped counted", status.counts.drafted === 1 && status.counts.skipped === 1, status.counts);
const keyD = commentKey("Dũng", "Cho mình xin link mua", "5 phút");
recordFbReplyComment(db, run.id, keyD, "Dũng", "Cho mình xin link mua");
markFbReplyFailed(db, run.id, keyD, "câu trả lời không hiện sau khi gửi");
status = getFbReplyStatus(db, run.id);
check("failed counted", status.counts.failed === 1, status.counts);

// 6. Giới hạn maxReplies: sent+drafted = 2, max = 3 → còn 1 lượt
const next2: any = nextFbReplyComment(db, run.id);
check("no pending left reports cleanly", next2.ok === false, next2);

// 7. Pause / resume / stop
pauseFbReplyRun(db, run.id);
const pausedNext: any = nextFbReplyComment(db, run.id);
check("paused run blocks next", pausedNext.ok === false, pausedNext);
resumeFbReplyRun(db, run.id);
stopFbReplyRun(db, run.id, "user stopped");
const stoppedNext: any = nextFbReplyComment(db, run.id);
check("stopped run blocks next", stoppedNext.ok === false, stoppedNext);

// 8. Persistence: mở lại DB cùng file
const db2: any = initDatabase(dbPath);
const status2 = getFbReplyStatus(db2, run.id);
check("run survives DB reopen", status2.run.status === "stopped" && status2.counts.sent === 1, status2);

// 9. Finish trên run mới (không dính run cũ vì đã stopped)
const run2 = startFbReplyRun(db, { postUrl: POST, mode: "auto", maxReplies: 5 });
const finished = finishFbReplyRun(db, run2.id);
check("finish moves run to done", finished.status === "done");

console.log(failures === 0 ? "\nAll FB reply checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
