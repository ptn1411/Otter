/**
 * FB Reply Loop — tracker thuần (daemon).
 *
 * Theo plan docs/plans/2026-10-31-fb-reply-loop.md: ChatGPT Web là người
 * soạn câu trả lời (nó gọi MCP tools), daemon chỉ giữ sổ: một post một
 * phiên đang chạy tại một thời điểm, chống gửi trùng bằng hash bình luận,
 * chặn vượt giới hạn và chặn gửi nhanh hơn 5s.
 *
 * File này cố tình không phụ thuộc MCP/Zod, giống plan.ts, để test được
 * bằng `bun scripts/test-fb-reply.ts` mà không cần node_modules.
 * MCP tool wrappers nằm ở ./tools/fb-reply-tools.ts.
 * Đọc bình luận có cấu trúc (fb_read_comments) là một action riêng của
 * extension, không nằm ở đây — xem BrowserController.readComments.
 */
import * as crypto from "node:crypto";

export type FbReplyMode = "draft" | "auto";
export type FbReplyRunStatus = "running" | "paused" | "done" | "blocked" | "stopped";
export type FbReplyCommentStatus = "pending" | "drafted" | "sent" | "skipped" | "failed";

export interface FbReplyRun {
  id: string;
  postUrl: string;
  mode: FbReplyMode;
  status: FbReplyRunStatus;
  maxReplies: number;
  maxRunMinutes: number;
  tone?: string;
  skipRules: string[];
  includeReplies: boolean;
  fromRunId?: string;
  sentCount: number;
  draftCount: number;
  skippedCount: number;
  failedCount: number;
  lastSentAt: number | null;
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FbReplyComment {
  id: string;
  runId: string;
  commentKey: string;
  author?: string;
  excerpt?: string;
  status: FbReplyCommentStatus;
  draftText?: string;
  skipReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FbReplyRunInput {
  postUrl: string;
  mode?: FbReplyMode;
  maxReplies?: number;
  maxRunMinutes?: number;
  tone?: string;
  skipRules?: string[];
  includeReplies?: boolean;
  fromRunId?: string;
}

export interface FbReplyStatusView {
  run: FbReplyRun;
  counts: Record<FbReplyCommentStatus, number>;
  recent: FbReplyComment[];
}

export const FB_REPLY_LIMITS = {
  /** Số bình luận tối đa / phiên (mặc định). */
  maxReplies: 20,
  /** Thời gian tối đa / phiên (phút). */
  maxRunMinutes: 60,
  /** Khoảng cách tối thiểu giữa hai lần gửi (ms). */
  minSendGapMs: 5_000,
  /** Số lần thử gửi tối đa cho một bình luận (ghi ở tầng gọi, không ở đây). */
  maxAttemptsPerComment: 2,
} as const;

type DbLike = {
  run: (sql: string, params?: unknown[]) => unknown;
  query: (sql: string) => { get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
};

function now(): number {
  return Date.now();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function parseJsonArray(value: unknown): string[] {
  if (!value || typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Định danh ổn định của một bình luận: hash(tác giả + nội dung + thời gian).
 * Dùng để chống gửi trùng ngay cả khi ChatGPT chạy lại cùng một bài.
 * Nội dung đầy đủ được hash, excerpt chỉ để hiển thị.
 */
export function commentKey(author: string, text: string, time: string): string {
  return crypto.createHash("sha256").update(`${author}\n${text}\n${time}`).digest("hex");
}

export function excerptOf(text: string, max = 300): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function rowToRun(row: Record<string, unknown>): FbReplyRun {
  return {
    id: String(row.id),
    postUrl: String(row.post_url),
    mode: row.mode as FbReplyMode,
    status: row.status as FbReplyRunStatus,
    maxReplies: Number(row.max_replies ?? FB_REPLY_LIMITS.maxReplies),
    maxRunMinutes: Number(row.max_run_minutes ?? FB_REPLY_LIMITS.maxRunMinutes),
    tone: row.tone ? String(row.tone) : undefined,
    skipRules: parseJsonArray(row.skip_rules_json),
    includeReplies: Boolean(row.include_replies),
    fromRunId: row.from_run_id ? String(row.from_run_id) : undefined,
    sentCount: Number(row.sent_count ?? 0),
    draftCount: Number(row.draft_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    lastSentAt: row.last_sent_at ? Number(row.last_sent_at) : null,
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToComment(row: Record<string, unknown>): FbReplyComment {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    commentKey: String(row.comment_key),
    author: row.author ? String(row.author) : undefined,
    excerpt: row.excerpt ? String(row.excerpt) : undefined,
    status: row.status as FbReplyCommentStatus,
    draftText: row.draft_text ? String(row.draft_text) : undefined,
    skipReason: row.skip_reason ? String(row.skip_reason) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getFbReplyRun(db: DbLike, runId: string): FbReplyRun | null {
  const row = db.query("SELECT * FROM fb_reply_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function requireFbReplyRun(db: DbLike, runId: string): FbReplyRun {
  const run = getFbReplyRun(db, runId);
  if (!run) throw new Error(`Không tìm thấy phiên trả lời bình luận: ${runId}`);
  return run;
}

export function startFbReplyRun(db: DbLike, input: FbReplyRunInput): FbReplyRun {
  if (!input.postUrl || !/^https?:\/\//.test(input.postUrl.trim())) {
    throw new Error("postUrl phải là một URL http(s) hợp lệ");
  }
  // Một post, một phiên đang chạy tại một thời điểm.
  const running = db.query(
    "SELECT * FROM fb_reply_runs WHERE post_url = ? AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1",
  ).get(input.postUrl.trim()) as Record<string, unknown> | undefined;
  if (running) {
    throw new Error(
      `Bài này đã có phiên đang chạy/tạm dừng: ${running.id} (${running.status}). Dừng phiên đó trước khi start phiên mới.`,
    );
  }
  const run: FbReplyRun = {
    id: newId("fbreply"),
    postUrl: input.postUrl.trim(),
    mode: input.mode ?? "draft",
    status: "running",
    maxReplies: input.maxReplies ?? FB_REPLY_LIMITS.maxReplies,
    maxRunMinutes: input.maxRunMinutes ?? FB_REPLY_LIMITS.maxRunMinutes,
    tone: input.tone,
    skipRules: input.skipRules ?? [],
    includeReplies: input.includeReplies ?? false,
    fromRunId: input.fromRunId,
    sentCount: 0,
    draftCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastSentAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.run(
    `INSERT INTO fb_reply_runs
      (id, post_url, mode, status, max_replies, max_run_minutes, tone, skip_rules_json,
       include_replies, from_run_id, sent_count, draft_count, skipped_count, failed_count,
       last_sent_at, blocked_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id, run.postUrl, run.mode, run.status, run.maxReplies, run.maxRunMinutes,
      run.tone ?? null, JSON.stringify(run.skipRules), run.includeReplies ? 1 : 0,
      run.fromRunId ?? null, 0, 0, 0, 0, null, null, run.createdAt, run.updatedAt,
    ],
  );
  return run;
}

/**
 * Ghi nhận một bình luận vừa đọc được từ trang. Idempotent nhờ
 * UNIQUE(run_id, comment_key): đọc lại cùng bình luận không tạo dòng mới.
 * Trả về dòng bình luận (mới hoặc đã có).
 */
export function recordFbReplyComment(
  db: DbLike,
  runId: string,
  key: string,
  author?: string,
  text?: string,
): FbReplyComment {
  requireFbReplyRun(db, runId);
  db.run(
    `INSERT OR IGNORE INTO fb_reply_comments
      (id, run_id, comment_key, author, excerpt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [newId("fbcomment"), runId, key, author ?? null, text ? excerptOf(text) : null, now(), now()],
  );
  const row = db.query("SELECT * FROM fb_reply_comments WHERE run_id = ? AND comment_key = ?").get(runId, key) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Không ghi được bình luận ${key} cho phiên ${runId}`);
  return rowToComment(row);
}

export function getFbReplyComments(db: DbLike, runId: string): FbReplyComment[] {
  // Sắp xếp theo rowid (thứ tự ghi thật), KHÔNG theo created_at/id:
  // nhiều bình luận ghi trong cùng một mili-giây sẽ có created_at bằng
  // nhau, còn id chứa hex ngẫu nhiên nên thứ tự sẽ nhảy lung tung.
  const rows = db.query("SELECT * FROM fb_reply_comments WHERE run_id = ? ORDER BY rowid ASC").all(runId) as Record<
    string,
    unknown
  >[];
  return rows.map(rowToComment);
}

function countComments(db: DbLike, runId: string): Record<FbReplyCommentStatus, number> {
  const counts: Record<FbReplyCommentStatus, number> = { pending: 0, drafted: 0, sent: 0, skipped: 0, failed: 0 };
  for (const c of getFbReplyComments(db, runId)) counts[c.status] += 1;
  return counts;
}

function refreshRunCounts(db: DbLike, run: FbReplyRun): FbReplyRun {
  const counts = countComments(db, run.id);
  db.run(
    "UPDATE fb_reply_runs SET sent_count = ?, draft_count = ?, skipped_count = ?, failed_count = ?, updated_at = ? WHERE id = ?",
    [counts.sent, counts.drafted, counts.skipped, counts.failed, now(), run.id],
  );
  return { ...run, sentCount: counts.sent, draftCount: counts.drafted, skippedCount: counts.skipped, failedCount: counts.failed, updatedAt: now() };
}

function setRunStatus(db: DbLike, run: FbReplyRun, status: FbReplyRunStatus, blockedReason?: string): FbReplyRun {
  db.run("UPDATE fb_reply_runs SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?", [
    status,
    blockedReason ?? null,
    now(),
    run.id,
  ]);
  return { ...run, status, blockedReason, updatedAt: now() };
}

export function getFbReplyStatus(db: DbLike, runId: string): FbReplyStatusView {
  const run = requireFbReplyRun(db, runId);
  const comments = getFbReplyComments(db, runId);
  const counts: Record<FbReplyCommentStatus, number> = { pending: 0, drafted: 0, sent: 0, skipped: 0, failed: 0 };
  for (const c of comments) counts[c.status] += 1;
  return { run, counts, recent: comments.slice(-10) };
}

/**
 * Lấy bình luận pending tiếp theo, kèm kiểm tra giới hạn.
 * Trả về { ok: false, reason } khi phiên không còn được lấy tiếp
 * (dừng, hết giới hạn, hết thời gian, gửi quá nhanh) thay vì throw,
 * để ChatGPT nhận được lý do rõ ràng và dừng đúng cách.
 */
export function nextFbReplyComment(
  db: DbLike,
  runId: string,
): { ok: true; comment: FbReplyComment; remaining: number } | { ok: false; reason: string } {
  const run = requireFbReplyRun(db, runId);
  if (run.status !== "running") {
    return { ok: false, reason: `Phiên không còn chạy (trạng thái: ${run.status}).` };
  }
  if (run.sentCount + run.draftCount >= run.maxReplies) {
    setRunStatus(db, run, "done");
    return { ok: false, reason: `Đã hết giới hạn ${run.maxReplies} bình luận / phiên.` };
  }
  if (now() - run.createdAt > run.maxRunMinutes * 60_000) {
    setRunStatus(db, run, "blocked", "Hết thời gian phiên (maxRunMinutes).");
    return { ok: false, reason: "Đã hết thời gian phiên." };
  }
  if (run.lastSentAt && now() - run.lastSentAt < FB_REPLY_LIMITS.minSendGapMs) {
    const waitMs = FB_REPLY_LIMITS.minSendGapMs - (now() - run.lastSentAt);
    return { ok: false, reason: `Gửi quá nhanh: chờ thêm ${Math.ceil(waitMs / 1000)}s từ lần gửi trước.` };
  }
  const comment = db.query(
    "SELECT * FROM fb_reply_comments WHERE run_id = ? AND status = 'pending' ORDER BY rowid ASC LIMIT 1",
  ).get(runId) as Record<string, unknown> | undefined;
  if (!comment) {
    return { ok: false, reason: "Không còn bình luận pending nào. Hãy đọc thêm bình luận từ trang rồi ghi nhận tiếp, hoặc kết thúc phiên." };
  }
  return { ok: true, comment: rowToComment(comment), remaining: run.maxReplies - (run.sentCount + run.draftCount) };
}

function setCommentStatus(
  db: DbLike,
  run: FbReplyRun,
  commentKeyValue: string,
  status: FbReplyCommentStatus,
  extra: { draftText?: string; skipReason?: string } = {},
): FbReplyComment {
  const row = db.query("SELECT * FROM fb_reply_comments WHERE run_id = ? AND comment_key = ?").get(run.id, commentKeyValue) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error(`Bình luận ${commentKeyValue} chưa được ghi nhận trong phiên ${run.id}.`);
  const prev = row.status as FbReplyCommentStatus;
  // Idempotent: mark sent lần 2 trên cùng bình luận không đếm thêm.
  if (prev === status) return rowToComment(row);
  db.run("UPDATE fb_reply_comments SET status = ?, draft_text = ?, skip_reason = ?, updated_at = ? WHERE id = ?", [
    status,
    extra.draftText ?? (row.draft_text as string | null) ?? null,
    extra.skipReason ?? null,
    now(),
    row.id,
  ]);
  const updated = refreshRunCounts(db, run);
  if (status === "sent") {
    db.run("UPDATE fb_reply_runs SET last_sent_at = ? WHERE id = ?", [now(), run.id]);
    updated.lastSentAt = now();
  }
  return rowToComment({
    ...row,
    status,
    draft_text: extra.draftText ?? row.draft_text,
    skip_reason: extra.skipReason ?? null,
    updated_at: now(),
  });
}

export function saveFbReplyDraft(db: DbLike, runId: string, key: string, draftText: string): FbReplyComment {
  const run = requireFbReplyRun(db, runId);
  if (run.status !== "running") throw new Error(`Phiên không còn chạy (trạng thái: ${run.status}).`);
  if (!draftText.trim()) throw new Error("draftText không được rỗng.");
  return setCommentStatus(db, run, key, "drafted", { draftText });
}

export function markFbReplySent(db: DbLike, runId: string, key: string): FbReplyComment {
  const run = requireFbReplyRun(db, runId);
  if (run.status !== "running" && run.status !== "paused") {
    throw new Error(`Phiên không còn chạy (trạng thái: ${run.status}).`);
  }
  return setCommentStatus(db, run, key, "sent");
}

export function markFbReplySkipped(db: DbLike, runId: string, key: string, reason: string): FbReplyComment {
  const run = requireFbReplyRun(db, runId);
  return setCommentStatus(db, run, key, "skipped", { skipReason: reason });
}

export function markFbReplyFailed(db: DbLike, runId: string, key: string, reason: string): FbReplyComment {
  const run = requireFbReplyRun(db, runId);
  return setCommentStatus(db, run, key, "failed", { skipReason: reason });
}

export function stopFbReplyRun(db: DbLike, runId: string, reason?: string): FbReplyRun {
  const run = requireFbReplyRun(db, runId);
  return setRunStatus(db, run, "stopped", reason);
}

export function pauseFbReplyRun(db: DbLike, runId: string): FbReplyRun {
  const run = requireFbReplyRun(db, runId);
  if (run.status !== "running") throw new Error(`Chỉ pause được phiên đang chạy (hiện tại: ${run.status}).`);
  return setRunStatus(db, run, "paused");
}

export function resumeFbReplyRun(db: DbLike, runId: string): FbReplyRun {
  const run = requireFbReplyRun(db, runId);
  if (run.status !== "paused") throw new Error(`Chỉ resume được phiên đang pause (hiện tại: ${run.status}).`);
  return setRunStatus(db, run, "running");
}

export function finishFbReplyRun(db: DbLike, runId: string): FbReplyRun {
  const run = requireFbReplyRun(db, runId);
  const refreshed = refreshRunCounts(db, run);
  return setRunStatus(db, refreshed, "done");
}
