/**
 * FB Auto Post — tracker thuần (daemon).
 *
 * Theo doc docs/plans/2026-10-31-fb-auto-post.md: người dùng đã chọn
 * chế độ auto (đăng luôn, không duyệt trước). Daemon vẫn giữ sổ đầy đủ
 * cho mọi lần đăng: một phiên đăng một digest (mặc định 1 bài/phiên),
 * chống đăng trùng item bằng hash link, chặn vượt giới hạn và dừng
 * được bằng pause/stop. Nội dung bài đăng chỉ gồm tiêu đề + link lấy
 * từ RSS, không bịa thêm.
 *
 * File này cố tình không phụ thuộc MCP/Zod, giống fb-reply.ts, để test
 * được bằng `bun scripts/test-fb-post.ts` mà không cần node_modules.
 * MCP tool wrappers nằm ở ./tools/fb-post-tools.ts.
 * Việc bấm nút Đăng trên tab Facebook KHÔNG nằm ở đây: nó đi qua các
 * tool browser_open/browser_read_page/browser_type/browser_click chung,
 * và DOM ô soạn bài khi đã đăng nhập thì chưa từng được quan sát
 * (xem doc) — phải kiểm chứng trên tab đã đăng nhập trước khi chạy
 * auto thật.
 */
import * as crypto from "node:crypto";
import type { NewsItem } from "./fb-news";

export type FbPostMode = "auto";
export type FbPostRunStatus = "running" | "paused" | "done" | "blocked" | "stopped";
export type FbPostItemStatus = "pending" | "posted" | "failed" | "skipped";

export interface FbPostRun {
  id: string;
  targetUrl: string;
  mode: FbPostMode;
  status: FbPostRunStatus;
  maxPosts: number;
  maxRunMinutes: number;
  digestSize: number;
  feeds: string[];
  /** Số bài digest đã đăng (không phải số item) — so với maxPosts. */
  postedCount: number;
  failedCount: number;
  skippedCount: number;
  lastPostedAt: number | null;
  blockedReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FbPostItem {
  id: string;
  runId: string;
  itemKey: string;
  title: string;
  link: string;
  source: string;
  pubDateMs: number | null;
  excerpt?: string;
  status: FbPostItemStatus;
  skipReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FbPostRunInput {
  targetUrl: string;
  mode?: FbPostMode;
  maxPosts?: number;
  maxRunMinutes?: number;
  digestSize?: number;
  feeds?: string[];
}

export interface FbPostDigest {
  digestText: string;
  items: FbPostItem[];
}

export interface FbPostStatusView {
  run: FbPostRun;
  counts: Record<FbPostItemStatus, number>;
  recent: FbPostItem[];
}

export const FB_POST_LIMITS = {
  /** Số bài digest tối đa / phiên (mặc định 1: một phiên = một bài tổng hợp). */
  maxPosts: 1,
  /** Số tin trong một bài digest (mặc định). */
  digestSize: 5,
  /** Thời gian tối đa / phiên (phút). */
  maxRunMinutes: 60,
  /** Khoảng cách tối thiểu giữa hai lần đăng (ms). */
  minPostGapMs: 30_000,
} as const;

/**
 * Dấu hiệu Facebook chặn — heuristic, KHÔNG phải wording đã kiểm chứng
 * của Facebook (chưa từng quan sát tab đã đăng nhập). Dùng để tự động
 * chuyển phiên sang blocked khi lý do thất bại nhắc tới bị chặn; ngoài
 * ra fb_post_mark_failed luôn nhận cờ blocked tường minh.
 */
export const FB_POST_BLOCK_PATTERNS = [
  /blocked/i,
  /checkpoint/i,
  /temporarily blocked/i,
  /bị chặn/i,
  /tạm thời bị khóa/i,
  /không cho phép đăng/i,
] as const;

export function isFbBlockReason(reason: string): boolean {
  return FB_POST_BLOCK_PATTERNS.some((re) => re.test(reason));
}

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

/**
 * Định danh ổn định của một tin: sha256 của link. Dùng để chống đăng
 * trùng cùng tin trong một phiên, ngay cả khi fetch lại feed nhiều lần.
 */
export function newsItemKey(link: string): string {
  return crypto.createHash("sha256").update(link.trim()).digest("hex");
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

function rowToRun(row: Record<string, unknown>): FbPostRun {
  return {
    id: String(row.id),
    targetUrl: String(row.target_url),
    mode: row.mode as FbPostMode,
    status: row.status as FbPostRunStatus,
    maxPosts: Number(row.max_posts ?? FB_POST_LIMITS.maxPosts),
    maxRunMinutes: Number(row.max_run_minutes ?? FB_POST_LIMITS.maxRunMinutes),
    digestSize: Number(row.digest_size ?? FB_POST_LIMITS.digestSize),
    feeds: parseJsonArray(row.feeds_json),
    postedCount: Number(row.posted_count ?? 0),
    failedCount: Number(row.failed_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    lastPostedAt: row.last_posted_at ? Number(row.last_posted_at) : null,
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToItem(row: Record<string, unknown>): FbPostItem {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    itemKey: String(row.item_key),
    title: String(row.title),
    link: String(row.link),
    source: String(row.source ?? ""),
    pubDateMs: row.pub_date_ms ? Number(row.pub_date_ms) : null,
    excerpt: row.excerpt ? String(row.excerpt) : undefined,
    status: row.status as FbPostItemStatus,
    skipReason: row.skip_reason ? String(row.skip_reason) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function getFbPostRun(db: DbLike, runId: string): FbPostRun | null {
  const row = db.query("SELECT * FROM fb_post_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function requireFbPostRun(db: DbLike, runId: string): FbPostRun {
  const run = getFbPostRun(db, runId);
  if (!run) throw new Error(`Không tìm thấy phiên đăng bài: ${runId}`);
  return run;
}

export function startFbPostRun(db: DbLike, input: FbPostRunInput): FbPostRun {
  if (!input.targetUrl || !/^https?:\/\//.test(input.targetUrl.trim())) {
    throw new Error("targetUrl phải là một URL http(s) hợp lệ");
  }
  if (input.mode !== undefined && input.mode !== "auto") {
    throw new Error("Phiên đăng bài này chỉ hỗ trợ mode 'auto' (người dùng đã chọn đăng tự động).");
  }
  // Một đích đăng, một phiên đang chạy tại một thời điểm.
  const running = db.query(
    "SELECT * FROM fb_post_runs WHERE target_url = ? AND status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1",
  ).get(input.targetUrl.trim()) as Record<string, unknown> | undefined;
  if (running) {
    throw new Error(
      `Đích này đã có phiên đang chạy/tạm dừng: ${running.id} (${running.status}). Dừng phiên đó trước khi start phiên mới.`,
    );
  }
  const run: FbPostRun = {
    id: newId("fbpost"),
    targetUrl: input.targetUrl.trim(),
    mode: "auto",
    status: "running",
    maxPosts: input.maxPosts ?? FB_POST_LIMITS.maxPosts,
    maxRunMinutes: input.maxRunMinutes ?? FB_POST_LIMITS.maxRunMinutes,
    digestSize: input.digestSize ?? FB_POST_LIMITS.digestSize,
    feeds: input.feeds ?? [],
    postedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    lastPostedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  db.run(
    `INSERT INTO fb_post_runs
      (id, target_url, mode, status, max_posts, max_run_minutes, digest_size, feeds_json,
       posted_count, failed_count, skipped_count, last_posted_at, blocked_reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id, run.targetUrl, run.mode, run.status, run.maxPosts, run.maxRunMinutes,
      run.digestSize, JSON.stringify(run.feeds), 0, 0, 0, null, null, run.createdAt, run.updatedAt,
    ],
  );
  return run;
}

/**
 * Ghi nhận các tin vừa fetch được. Idempotent nhờ UNIQUE(run_id,
 * item_key): fetch lại cùng tin không tạo dòng mới. Trả về số tin mới
 * ghi thật (không tính dòng đã có).
 */
export function recordFbPostItems(db: DbLike, runId: string, items: NewsItem[]): { recorded: number; total: number } {
  requireFbPostRun(db, runId);
  let recorded = 0;
  for (const item of items) {
    if (!item.title || !item.link) continue;
    const key = newsItemKey(item.link);
    const before = (db.query("SELECT COUNT(*) AS c FROM fb_post_items WHERE run_id = ? AND item_key = ?").get(runId, key) as any)?.c ?? 0;
    db.run(
      `INSERT OR IGNORE INTO fb_post_items
        (id, run_id, item_key, title, link, source, pub_date_ms, excerpt, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [newId("fbitem"), runId, key, item.title, item.link, item.source, item.pubDateMs, item.excerpt ?? null, now(), now()],
    );
    const after = (db.query("SELECT COUNT(*) AS c FROM fb_post_items WHERE run_id = ? AND item_key = ?").get(runId, key) as any)?.c ?? 0;
    if (after > before) recorded += 1;
  }
  return { recorded, total: getFbPostItems(db, runId).length };
}

export function getFbPostItems(db: DbLike, runId: string): FbPostItem[] {
  // Sắp xếp theo rowid (thứ tự ghi thật), KHÔNG theo created_at/id:
  // bài học từ fb-reply.ts — nhiều item ghi trong cùng một mili-giây
  // sẽ có created_at bằng nhau, còn id chứa hex ngẫu nhiên. Feed tin
  // vốn sắp mới nhất trước, nên thứ tự ghi này cũng là mới nhất trước.
  const rows = db.query("SELECT * FROM fb_post_items WHERE run_id = ? ORDER BY rowid ASC").all(runId) as Record<
    string,
    unknown
  >[];
  return rows.map(rowToItem);
}

function countItems(db: DbLike, runId: string): Record<FbPostItemStatus, number> {
  const counts: Record<FbPostItemStatus, number> = { pending: 0, posted: 0, failed: 0, skipped: 0 };
  for (const item of getFbPostItems(db, runId)) counts[item.status] += 1;
  return counts;
}

function setRunStatus(db: DbLike, run: FbPostRun, status: FbPostRunStatus, blockedReason?: string): FbPostRun {
  db.run("UPDATE fb_post_runs SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?", [
    status,
    blockedReason ?? null,
    now(),
    run.id,
  ]);
  return { ...run, status, blockedReason, updatedAt: now() };
}

export function getFbPostStatus(db: DbLike, runId: string): FbPostStatusView {
  const run = requireFbPostRun(db, runId);
  const items = getFbPostItems(db, runId);
  const counts: Record<FbPostItemStatus, number> = { pending: 0, posted: 0, failed: 0, skipped: 0 };
  for (const item of items) counts[item.status] += 1;
  return { run, counts, recent: items.slice(-10) };
}

/**
 * Soạn MỘT bài digest từ các tin pending đầu tiên (theo rowid = thứ tự
 * feed mới nhất trước). Chỉ gồm tiêu đề + link + nguồn lấy từ feed,
 * không thêm sự kiện, con số hay nhận định nào ngoài feed.
 */
export function composeDigestPost(items: FbPostItem[], date = new Date()): string {
  const dateStr = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const lines = [`📰 Tin mới trong ngày — ${dateStr}`, ""];
  items.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.title}`);
    lines.push(`🔗 ${item.link}`);
    if (item.source) lines.push(`Nguồn: ${item.source}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

/**
 * Lấy digest tiếp theo để đăng, kèm kiểm tra giới hạn. Trả về
 * { ok: false, reason } khi phiên không còn đăng được (dừng, hết giới
 * hạn bài, hết thời gian, đăng quá nhanh, không còn tin pending) thay
 * vì throw, để bên gọi dừng đúng cách. Giới hạn bài (maxPosts) đếm
 * bằng số dòng trong fb_post_digests (mỗi lần mark_posted thành công
 * ghi một dòng), không suy ra từ số item vì digest cuối có thể thiếu
 * tin. Cột posted_count của phiên cũng đếm theo số bài digest này.
 */
export function nextFbPostDigest(
  db: DbLike,
  runId: string,
): { ok: true; digest: FbPostDigest; remainingPosts: number } | { ok: false; reason: string } {
  const run = requireFbPostRun(db, runId);
  if (run.status !== "running") {
    return { ok: false, reason: `Phiên không còn chạy (trạng thái: ${run.status}).` };
  }
  const postedDigests = getPostedDigestCount(db, run.id);
  if (postedDigests >= run.maxPosts) {
    setRunStatus(db, run, "done");
    return { ok: false, reason: `Đã hết giới hạn ${run.maxPosts} bài / phiên.` };
  }
  if (now() - run.createdAt > run.maxRunMinutes * 60_000) {
    setRunStatus(db, run, "blocked", "Hết thời gian phiên (maxRunMinutes).");
    return { ok: false, reason: "Đã hết thời gian phiên." };
  }
  if (run.lastPostedAt && now() - run.lastPostedAt < FB_POST_LIMITS.minPostGapMs) {
    const waitMs = FB_POST_LIMITS.minPostGapMs - (now() - run.lastPostedAt);
    return { ok: false, reason: `Đăng quá nhanh: chờ thêm ${Math.ceil(waitMs / 1000)}s từ lần đăng trước.` };
  }
  const pending = getFbPostItems(db, runId).filter((item) => item.status === "pending").slice(0, run.digestSize);
  if (pending.length === 0) {
    return { ok: false, reason: "Không còn tin pending nào. Hãy fetch thêm tin rồi thử lại, hoặc kết thúc phiên." };
  }
  return {
    ok: true,
    digest: { digestText: composeDigestPost(pending), items: pending },
    remainingPosts: run.maxPosts - postedDigests,
  };
}

/**
 * Số bài digest đã đăng trong phiên. Mỗi lần mark_posted thành công ghi
 * một dòng vào fb_post_digests (bảng phụ, xem db.ts) để đếm chính xác
 * theo bài, không suy ra từ số item (digest cuối có thể thiếu tin).
 */
export function getPostedDigestCount(db: DbLike, runId: string): number {
  try {
    const row = db.query("SELECT COUNT(*) AS c FROM fb_post_digests WHERE run_id = ?").get(runId) as any;
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

function setItemStatus(
  db: DbLike,
  run: FbPostRun,
  itemKeys: string[],
  status: FbPostItemStatus,
  skipReason?: string,
): FbPostItem[] {
  const updated: FbPostItem[] = [];
  for (const key of itemKeys) {
    const row = db.query("SELECT * FROM fb_post_items WHERE run_id = ? AND item_key = ?").get(run.id, key) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new Error(`Tin ${key} chưa được ghi nhận trong phiên ${run.id}.`);
    if (row.status !== status) {
      db.run("UPDATE fb_post_items SET status = ?, skip_reason = ?, updated_at = ? WHERE id = ?", [
        status,
        skipReason ?? null,
        now(),
        row.id,
      ]);
    }
    updated.push(rowToItem({ ...row, status, skip_reason: skipReason ?? null, updated_at: now() }));
  }
  return updated;
}

function refreshItemCountsOnly(db: DbLike, run: FbPostRun): FbPostRun {
  const counts = countItems(db, run.id);
  db.run("UPDATE fb_post_runs SET failed_count = ?, skipped_count = ?, updated_at = ? WHERE id = ?", [
    counts.failed,
    counts.skipped,
    now(),
    run.id,
  ]);
  return { ...run, failedCount: counts.failed, skippedCount: counts.skipped, updatedAt: now() };
}

/**
 * Đánh dấu một bài digest đã đăng thành công. Idempotent theo bài: gọi
 * hai lần với cùng danh sách item chỉ ghi một dòng digest (nhờ
 * UNIQUE(run_id, digest_hash)), không đếm thêm bài. Đủ maxPosts thì
 * phiên tự chuyển sang done — và gọi lại lần nữa sau khi done với
 * đúng digest đã đăng vẫn trả về thành công (xác nhận trùng), thay vì
 * throw, để bên gọi retry an toàn.
 */
export function markFbPostPosted(db: DbLike, runId: string, itemKeys: string[]): FbPostItem[] {
  const run = requireFbPostRun(db, runId);
  if (itemKeys.length === 0) throw new Error("itemKeys không được rỗng.");
  const digestHash = crypto.createHash("sha256").update([...itemKeys].sort().join("\n")).digest("hex");
  const alreadyPosted = db.query("SELECT * FROM fb_post_digests WHERE run_id = ? AND digest_hash = ?").get(run.id, digestHash);
  if (alreadyPosted) {
    return getFbPostItems(db, run.id).filter((item) => itemKeys.includes(item.itemKey));
  }
  if (run.status !== "running" && run.status !== "paused") {
    throw new Error(`Phiên không còn chạy (trạng thái: ${run.status}).`);
  }
  const updated = setItemStatus(db, run, itemKeys, "posted");
  db.run(
    "INSERT OR IGNORE INTO fb_post_digests (id, run_id, digest_hash, item_keys_json, created_at) VALUES (?, ?, ?, ?, ?)",
    [newId("fbdigest"), run.id, digestHash, JSON.stringify(itemKeys), now()],
  );
  const digestCount = getPostedDigestCount(db, run.id);
  db.run("UPDATE fb_post_runs SET posted_count = ?, last_posted_at = ?, updated_at = ? WHERE id = ?", [
    digestCount,
    now(),
    now(),
    run.id,
  ]);
  refreshItemCountsOnly(db, run);
  if (getPostedDigestCount(db, run.id) >= run.maxPosts) {
    setRunStatus(db, run, "done");
  }
  return updated;
}

export function markFbPostFailed(
  db: DbLike,
  runId: string,
  itemKeys: string[],
  reason: string,
  blocked = false,
): FbPostItem[] {
  const run = requireFbPostRun(db, runId);
  const updated = setItemStatus(db, run, itemKeys, "failed", reason);
  refreshItemCountsOnly(db, run);
  if (blocked || isFbBlockReason(reason)) {
    setRunStatus(db, run, "blocked", reason);
  }
  return updated;
}

export function markFbPostSkipped(db: DbLike, runId: string, itemKeys: string[], reason: string): FbPostItem[] {
  const run = requireFbPostRun(db, runId);
  const updated = setItemStatus(db, run, itemKeys, "skipped", reason);
  refreshItemCountsOnly(db, run);
  return updated;
}

export function stopFbPostRun(db: DbLike, runId: string, reason?: string): FbPostRun {
  const run = requireFbPostRun(db, runId);
  return setRunStatus(db, run, "stopped", reason);
}

export function pauseFbPostRun(db: DbLike, runId: string): FbPostRun {
  const run = requireFbPostRun(db, runId);
  if (run.status !== "running") throw new Error(`Chỉ pause được phiên đang chạy (hiện tại: ${run.status}).`);
  return setRunStatus(db, run, "paused");
}

export function resumeFbPostRun(db: DbLike, runId: string): FbPostRun {
  const run = requireFbPostRun(db, runId);
  if (run.status !== "paused") throw new Error(`Chỉ resume được phiên đang pause (hiện tại: ${run.status}).`);
  return setRunStatus(db, run, "running");
}

export function finishFbPostRun(db: DbLike, runId: string): FbPostRun {
  const run = requireFbPostRun(db, runId);
  refreshItemCountsOnly(db, run);
  return setRunStatus(db, run, "done");
}
