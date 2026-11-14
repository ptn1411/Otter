/**
 * Page-loop daemon — Phases 1–3, 5–6 của plan nâng cấp từ codex-web.
 * Logic thuần SQLite (theo mẫu loop-controller.ts): không MCP/Zod,
 * test được bằng scripts/test-page-loop.ts trên DB tạm.
 *
 * Nguyên tắc: daemon là nguồn thật duy nhất; trang chỉ báo lượt.
 * Token theo lượt: token thật chỉ sống trong bộ nhớ tiến trình
 * (Map dưới đây), DB chỉ lưu SHA-256 hash + scope + hạn. Restart
 * daemon làm mất token trong bộ nhớ -> session cũ thành stale, phải
 * Resume để cấp token mới. Token KHÔNG bao giờ trả ra ngoài qua
 * MCP/HTTP/status.
 */
import * as crypto from "node:crypto";
import { getPlanStatus, requirePlan, startPlan, type PlanTask } from "./plan";
import { buildContinuationPrompt, buildFinalPrompt, buildResumePrompt, enqueueInjection, type OutboxEntry } from "./continuous-loop";
import { buildCheckpointPrompt, buildFreeNudge, buildFreshEpochPrompt, buildIncrementalPrompt, checkBudget, estimateTokens, PAGE_LOOP_DEFAULT_BUDGET } from "./page-loop-context";
import { createLease, releaseLease, type PageLoopLease } from "./page-loop-lease";

export type PageLoopStatus = "armed" | "waiting_generation" | "settling" | "deciding" | "injecting" | "paused" | "done" | "blocked" | "stopped";
export type PageLoopMode = "auto" | "zero_risk";
export type PageLoopChatMode = "retained" | "fresh_per_turn";
export type PageLoopDecision = "done" | "continue" | "compact" | "paused" | "blocked" | "held_tool_paused" | "duplicate";

export const PAGE_LOOP_DEFAULT_MAX_TURNS = 10; // lần chạy thật đầu tiên chặt hơn 20/60 của plan cũ, theo plan nâng cấp §9.3
export const PAGE_LOOP_DEFAULT_MAX_MINUTES = 30;
export const PAGE_LOOP_MAX_NO_PROGRESS = 3;

export interface PageLoop {
  id: string;
  conversationId: string;
  planId: string | null;
  goal: string;
  mode: PageLoopMode;
  chatMode: PageLoopChatMode;
  status: PageLoopStatus;
  turnCount: number;
  maxTurns: number;
  maxRunMinutes: number;
  epoch: number;
  contextBudget: number;
  contextUsedEstimate: number;
  lastTurnHash: string | null;
  noProgressCount: number;
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PageLoopTurn {
  id: string;
  loopId: string;
  turnIndex: number;
  turnHash: string;
  excerpt: string | null;
  isDoneMarker: number;
  isCheckpointMarker: number;
  createdAt: number;
}

export interface PageLoopCheckpoint {
  id: string;
  loopId: string;
  epoch: number;
  excerpt: string | null;
  turnHash: string;
  createdAt: number;
}

export interface PageLoopReceipt {
  id: string;
  loopId: string;
  turnIndex: number;
  sentAt: number;
}

type DbLike = {
  run: (sql: string, ...params: any[]) => unknown;
  query: (sql: string) => { get: (...params: any[]) => unknown; all: (...params: any[]) => unknown[] };
};

function now(): number { return Date.now(); }
function newId(prefix: string): string { return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`; }
function sha256(text: string): string { return crypto.createHash("sha256").update(text).digest("hex"); }

/** Token thật chỉ ở đây (bộ nhớ tiến trình). Không persist, không log, không trả ra ngoài. */
const liveTokens = new Map<string, { token: string; turnIndex: number; tabId: string; expiresAt: number }>();

function issueToken(loopId: string, turnIndex: number, tabId: string): string {
  const token = crypto.randomBytes(24).toString("hex");
  liveTokens.set(loopId, { token, turnIndex, tabId, expiresAt: now() + 600_000 });
  return token;
}

export function tokenStatusForLoop(loopId: string): "active" | "expired" | "none" {
  const t = liveTokens.get(loopId);
  if (!t) return "none";
  return now() < t.expiresAt ? "active" : "expired";
}

function storeTokenHash(db: DbLike, loopId: string, turnIndex: number, token: string, tabId: string): void {
  db.run("INSERT INTO page_loop_turn_tokens (id, loop_id, turn_index, token_hash, scope, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)",
    [newId("tok"), loopId, turnIndex, sha256(token), `${loopId}:${turnIndex}:${tabId}`, now() + 600_000, now()]);
}

function revokeTokens(db: DbLike, loopId: string): void {
  liveTokens.delete(loopId);
  db.run("UPDATE page_loop_turn_tokens SET status = 'revoked' WHERE loop_id = ? AND status = 'active'", [loopId]);
}

function rowToLoop(row: Record<string, unknown>): PageLoop {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    planId: row.plan_id ? String(row.plan_id) : null,
    goal: String(row.goal),
    mode: (row.mode as PageLoopMode) || "auto",
    chatMode: (row.chat_mode as PageLoopChatMode) || "retained",
    status: row.status as PageLoopStatus,
    turnCount: Number(row.turn_count),
    maxTurns: Number(row.max_turns),
    maxRunMinutes: Number(row.max_run_minutes),
    epoch: Number(row.epoch ?? 0),
    contextBudget: Number(row.context_budget ?? PAGE_LOOP_DEFAULT_BUDGET),
    contextUsedEstimate: Number(row.context_used_estimate ?? 0),
    lastTurnHash: row.last_turn_hash ? String(row.last_turn_hash) : null,
    noProgressCount: Number(row.no_progress_count),
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToTurn(row: Record<string, unknown>): PageLoopTurn {
  return {
    id: String(row.id),
    loopId: String(row.loop_id),
    turnIndex: Number(row.turn_index),
    turnHash: String(row.turn_hash),
    excerpt: row.excerpt ? String(row.excerpt) : null,
    isDoneMarker: Number(row.is_done_marker ?? 0),
    isCheckpointMarker: Number(row.is_checkpoint_marker ?? 0),
    createdAt: Number(row.created_at),
  };
}

/** Page-loop next task: current running task first, else next eligible pending. Different from worker getNextEligibleTask (which returns null while a task is running or plan is draft). */
function getPageLoopNextTask(db: DbLike, planId: string): PlanTask | null {
  const view = getPlanStatus(db, planId);
  return view.currentTask ?? view.nextTask;
}

export function getPageLoop(db: DbLike, loopId: string): PageLoop | null {
  const row = db.query("SELECT * FROM page_loops WHERE id = ?").get(loopId) as Record<string, unknown> | undefined;
  return row ? rowToLoop(row) : null;
}

export function requirePageLoop(db: DbLike, loopId: string): PageLoop {
  const loop = getPageLoop(db, loopId);
  if (!loop) throw new Error(`Không tìm thấy page-loop ${loopId}`);
  return loop;
}

export function listPageLoops(db: DbLike): PageLoop[] {
  const rows = db.query("SELECT * FROM page_loops ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[];
  return rows.map(rowToLoop);
}

export function getPageLoopTurns(db: DbLike, loopId: string): PageLoopTurn[] {
  const all = (db.query("SELECT * FROM page_loop_turns WHERE loop_id = ? ORDER BY turn_index ASC").all(loopId) as Record<string, unknown>[]);
  return all.map(rowToTurn);
}

export function getPageLoopCheckpoints(db: DbLike, loopId: string): PageLoopCheckpoint[] {
  const rows = db.query("SELECT * FROM page_loop_checkpoints WHERE loop_id = ? ORDER BY epoch ASC").all(loopId) as Record<string, unknown>[];
  return rows.map((r) => ({ id: String(r.id), loopId: String(r.loop_id), epoch: Number(r.epoch), excerpt: r.excerpt ? String(r.excerpt) : null, turnHash: String(r.turn_hash), createdAt: Number(r.created_at) }));
}

export function listReceipts(db: DbLike, loopId: string): PageLoopReceipt[] {
  const rows = db.query("SELECT * FROM page_loop_receipts WHERE loop_id = ? ORDER BY sent_at DESC LIMIT 100").all(loopId) as Record<string, unknown>[];
  return rows.map((r) => ({ id: String(r.id), loopId: String(r.loop_id), turnIndex: Number(r.turn_index), sentAt: Number(r.sent_at) }));
}

/** Ghi receipt gửi — idempotent theo injectionId: gửi lại cùng id không tạo receipt mới. */
export function recordReceipt(db: DbLike, input: { injectionId: string; loopId: string; turnIndex: number }): boolean {
  const existing = db.query("SELECT id FROM page_loop_receipts WHERE id = ?").get(input.injectionId) as Record<string, unknown> | undefined;
  if (existing) return false;
  db.run("INSERT INTO page_loop_receipts (id, loop_id, turn_index, sent_at) VALUES (?, ?, ?, ?)", [input.injectionId, input.loopId, input.turnIndex, now()]);
  return true;
}

export function countReceiptsLast24h(db: DbLike, loopId: string): number {
  const row = db.query("SELECT COUNT(*) AS n FROM page_loop_receipts WHERE loop_id = ? AND sent_at >= ?").get(loopId, now() - 24 * 3600_000) as { n: number };
  return Number(row.n);
}

function setLoopStatus(db: DbLike, loop: PageLoop, status: PageLoopStatus, blockedReason?: string | null): PageLoop {
  db.run("UPDATE page_loops SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?", [status, blockedReason ?? loop.blockedReason, now(), loop.id]);
  return { ...loop, status, blockedReason: blockedReason ?? loop.blockedReason, updatedAt: now() };
}

export function createPageLoop(db: DbLike, input: {
  goal: string; planId?: string | null; conversationId?: string; tabId?: string;
  mode?: PageLoopMode; chatMode?: PageLoopChatMode; maxTurns?: number; maxRunMinutes?: number; contextBudget?: number;
}): { loop: PageLoop; lease: PageLoopLease; firstPrompt: string; preparedPrompt: string | null } {
  const goal = (input.goal || "").trim();
  if (!goal) throw new Error("goal không được để trống.");
  if (input.planId) {
    const p = requirePlan(db, input.planId);
    if (p.status === "draft" || p.status === "paused") startPlan(db, input.planId);
  }
  const nowMs = now();
  const loop: PageLoop = {
    id: newId("ploop"),
    conversationId: input.conversationId || "chatgpt-web",
    planId: input.planId || null,
    goal,
    mode: input.mode || "auto",
    chatMode: input.chatMode || "retained",
    status: input.mode === "zero_risk" ? "paused" : "armed",
    turnCount: 0,
    maxTurns: input.maxTurns ?? PAGE_LOOP_DEFAULT_MAX_TURNS,
    maxRunMinutes: input.maxRunMinutes ?? PAGE_LOOP_DEFAULT_MAX_MINUTES,
    epoch: 0,
    contextBudget: input.contextBudget ?? PAGE_LOOP_DEFAULT_BUDGET,
    contextUsedEstimate: 0,
    lastTurnHash: null,
    noProgressCount: 0,
    blockedReason: null,
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  db.run("INSERT INTO page_loops (id, conversation_id, plan_id, goal, mode, chat_mode, status, turn_count, max_turns, max_run_minutes, epoch, context_budget, context_used_estimate, last_turn_hash, no_progress_count, blocked_reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, 0, NULL, 0, NULL, ?, ?)",
    [loop.id, loop.conversationId, loop.planId, loop.goal, loop.mode, loop.chatMode, loop.status, loop.maxTurns, loop.maxRunMinutes, loop.contextBudget, loop.createdAt, loop.updatedAt]);
  const lease = createLease(db, { loopId: loop.id, tabId: input.tabId, conversationId: loop.conversationId });
  const token = issueToken(loop.id, 0, lease.tabId);
  storeTokenHash(db, loop.id, 0, token, lease.tabId);

  // Prompt đầu: có plan thì dùng task đầu tiên, không thì dùng goal + dặn marker.
  let firstPrompt: string;
  if (loop.planId) {
    const view = getPlanStatus(db, loop.planId);
    const next = getPageLoopNextTask(db, loop.planId);
    firstPrompt = next
      ? buildIncrementalPrompt({ planGoal: view.plan.goal, planId: loop.planId, nextGoal: next.goal, nextDetails: next.details || undefined, nextVerify: next.verify ?? [], lastSummary: `Bắt đầu plan: ${view.plan.goal}`, remainingCount: view.tasks.filter((t) => t.status === "pending" || t.status === "running").length })
      : buildFinalPrompt({ planGoal: view.plan.goal, planId: loop.planId, view });
  } else {
    firstPrompt = `🎯 [Otter Page Loop — bắt đầu] Mục tiêu: ${goal}\n\nLàm ngay, không dừng, không hỏi lại những gì đã rõ. Khi xong thật, ghi dòng cuối cùng đúng là OTTER-DONE, đứng một mình một dòng.`;
  }
  // Zero-risk: không enqueue, chỉ trả prompt để user copy/paste/gửi tay.
  const preparedPrompt = loop.mode === "zero_risk" ? firstPrompt : null;
  return { loop, lease, firstPrompt, preparedPrompt };
}

export function confirmSent(db: DbLike, loopId: string): PageLoop {
  const loop = requirePageLoop(db, loopId);
  if (loop.mode !== "zero_risk") throw new Error("confirmSent chỉ dùng cho chế độ zero_risk.");
  if (loop.status !== "paused") throw new Error(`Session zero-risk đang ở trạng thái ${loop.status}, không chờ xác nhận gửi.`);
  const updated = setLoopStatus(db, loop, "waiting_generation");
  recordReceipt(db, { injectionId: `manual_${loop.id}_${loop.turnCount}`, loopId: loop.id, turnIndex: loop.turnCount });
  return updated;
}

/**
 * Chuẩn bị prompt tiếp theo cho zero-risk (không enqueue, không inject).
 * Auto mode từ chối — auto dùng outbox, không dùng prompt chuẩn bị tay.
 */
export function prepareNextPrompt(db: DbLike, loopId: string): { prompt: string; decision: PageLoopDecision } {
  const loop = requirePageLoop(db, loopId);
  if (loop.mode !== "zero_risk") throw new Error("prepareNextPrompt chỉ dùng cho zero_risk; auto mode dùng outbox.");
  if (loop.planId) {
    const view = getPlanStatus(db, loop.planId);
    const next = getPageLoopNextTask(db, loop.planId);
    if (!next) return { prompt: buildFinalPrompt({ planGoal: view.plan.goal, planId: loop.planId, view }), decision: "done" };
    return {
      prompt: buildIncrementalPrompt({ planGoal: view.plan.goal, planId: loop.planId, nextGoal: next.goal, nextDetails: next.details || undefined, nextVerify: next.verify ?? [], lastSummary: "Tiếp tục plan.", remainingCount: view.tasks.filter((t) => t.status === "pending" || t.status === "running").length }),
      decision: "continue",
    };
  }
  return { prompt: buildFreeNudge({ goal: loop.goal, lastExcerpt: "" }), decision: "continue" };
}

export interface RecordTurnInput {
  loopId: string;
  turnHash: string;
  excerpt: string;
  isDoneMarker: boolean;
  isCheckpointMarker: boolean;
  /** Thời điểm MCP activity gần nhất (ms) — daemon biết, watcher không biết. */
  mcpActivityAt?: number | null;
}

export interface RecordTurnResult {
  loop: PageLoop;
  decision: PageLoopDecision;
  prompt: string | null;
  outboxEntry: OutboxEntry | null;
  reason: string | null;
}

/**
 * Ghi một lượt settle và quyết định tiếp theo. Trả prompt (nếu có) để
 * caller enqueue vào outbox — hàm này tự enqueue khi decision là
 * continue/compact/done (auto mode), zero-risk thì chỉ trả prompt.
 */
export function recordTurn(db: DbLike, input: RecordTurnInput): RecordTurnResult {
  const loop = requirePageLoop(db, input.loopId);
  const terminal: PageLoopStatus[] = ["done", "blocked", "stopped"];
  if (terminal.includes(loop.status)) {
    return { loop, decision: "blocked", prompt: null, outboxEntry: null, reason: `Session đã ở trạng thái ${loop.status}, không nhận thêm lượt.` };
  }
  // MCP activity trong 5s gần nhất -> tool-paused, không đếm lượt, không quyết.
  if (input.mcpActivityAt && now() - input.mcpActivityAt < 5000) {
    return { loop, decision: "held_tool_paused", prompt: null, outboxEntry: null, reason: "MCP activity trong 5s gần nhất — có thể ChatGPT đang chờ tool, chưa tính là settled." };
  }
  // Idempotent theo hash lượt.
  const dup = db.query("SELECT id FROM page_loop_turns WHERE loop_id = ? AND turn_hash = ?").get(loop.id, input.turnHash) as Record<string, unknown> | undefined;
  if (dup) {
    return { loop, decision: "duplicate", prompt: null, outboxEntry: null, reason: "Lượt này đã ghi rồi (trùng hash), không đếm lại." };
  }
  const turnIndex = loop.turnCount + 1;
  const noProgress = input.turnHash === loop.lastTurnHash ? loop.noProgressCount + 1 : 0;
  db.run("INSERT INTO page_loop_turns (id, loop_id, turn_index, turn_hash, excerpt, is_done_marker, is_checkpoint_marker, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [newId("pturn"), loop.id, turnIndex, input.turnHash, input.excerpt.slice(0, 500), input.isDoneMarker ? 1 : 0, input.isCheckpointMarker ? 1 : 0, now()]);
  db.run("UPDATE page_loops SET turn_count = ?, last_turn_hash = ?, no_progress_count = ?, updated_at = ? WHERE id = ?",
    [turnIndex, input.turnHash, noProgress, now(), loop.id]);
  let updated: PageLoop = { ...loop, turnCount: turnIndex, lastTurnHash: input.turnHash, noProgressCount: noProgress, updatedAt: now() };

  const finish = (status: PageLoopStatus, decision: PageLoopDecision, prompt: string | null, reason: string | null, outboxEntry: OutboxEntry | null = null): RecordTurnResult => {
    const finalLoop = setLoopStatus(db, updated, status, reason);
    if (status === "done" || status === "blocked" || status === "stopped") revokeTokens(db, loop.id);
    return { loop: finalLoop, decision, prompt, outboxEntry, reason };
  };

  if (noProgress >= PAGE_LOOP_MAX_NO_PROGRESS) {
    releaseLease(db, loop.id);
    return finish("blocked", "blocked", null, `Không tiến triển ${PAGE_LOOP_MAX_NO_PROGRESS} lượt liên tiếp (hash lượt lặp lại).`);
  }
  if (turnIndex >= loop.maxTurns) {
    releaseLease(db, loop.id);
    return finish("blocked", "blocked", null, `Hết số lượt tối đa ${loop.maxTurns}.`);
  }
  if (now() - loop.createdAt > loop.maxRunMinutes * 60_000) {
    releaseLease(db, loop.id);
    return finish("blocked", "blocked", null, `Hết thời gian tối đa ${loop.maxRunMinutes} phút.`);
  }

  // Checkpoint marker -> lưu checkpoint, tăng epoch, reset context dùng, mở epoch mới.
  if (input.isCheckpointMarker) {
    db.run("INSERT INTO page_loop_checkpoints (id, loop_id, epoch, excerpt, turn_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [newId("pchk"), loop.id, loop.epoch, input.excerpt.slice(0, 500), input.turnHash, now()]);
    const newEpoch = loop.epoch + 1;
    db.run("UPDATE page_loops SET epoch = ?, context_used_estimate = 0, updated_at = ? WHERE id = ?", [newEpoch, now(), loop.id]);
    updated = { ...updated, epoch: newEpoch, contextUsedEstimate: 0 };
    let nextGoal: string | undefined;
    if (loop.planId) {
      const next = getPageLoopNextTask(db, loop.planId);
      nextGoal = next?.goal;
    }
    const prompt = buildFreshEpochPrompt({ goal: loop.goal, planId: loop.planId || undefined, checkpointExcerpt: input.excerpt, nextGoal });
    if (loop.mode === "zero_risk") return { loop: updated, decision: "compact", prompt, outboxEntry: null, reason: "Checkpoint xong, epoch mới — zero-risk: prompt đã chuẩn bị, user gửi tay." };
    const entry = enqueueInjection(db, { planId: loop.planId, text: prompt });
    try { db.run("UPDATE injection_outbox SET loop_id = ? WHERE id = ?", [loop.id, entry.id]); } catch {}
    return { loop: setLoopStatus(db, updated, "injecting"), decision: "compact", prompt, outboxEntry: entry, reason: "Checkpoint xong, đã mở epoch mới." };
  }

  // Done marker.
  if (input.isDoneMarker) {
    if (!loop.planId) {
      releaseLease(db, loop.id);
      return finish("done", "done", null, "Marker OTTER-DONE ở lượt cuối (chế độ mục tiêu tự do).");
    }
    const view = getPlanStatus(db, loop.planId);
    const remaining = view.tasks.filter((t) => t.status === "pending" || t.status === "running" || t.status === "failed");
    if (remaining.length === 0) {
      const prompt = buildFinalPrompt({ planGoal: view.plan.goal, planId: loop.planId, view });
      if (loop.mode === "zero_risk") return finish("done", "done", prompt, "Plan đã hết task + marker OTTER-DONE.");
      const entry = enqueueInjection(db, { planId: loop.planId, text: prompt });
      try { db.run("UPDATE injection_outbox SET loop_id = ? WHERE id = ?", [loop.id, entry.id]); } catch {}
      releaseLease(db, loop.id);
      return finish("done", "done", prompt, "Plan đã hết task + marker OTTER-DONE.", entry);
    }
    // Còn task -> tiếp tục với task tiếp theo (marker chỉ xong một task, chưa xong plan).
  }

  // Continue: có plan thì task tiếp theo, không thì nudge tự do.
  let prompt: string;
  if (loop.planId) {
    const view = getPlanStatus(db, loop.planId);
    const next = getPageLoopNextTask(db, loop.planId);
    if (!next) {
      const finalPrompt = buildFinalPrompt({ planGoal: view.plan.goal, planId: loop.planId, view });
      if (loop.mode === "zero_risk") return finish("done", "done", finalPrompt, "Plan đã hết task.");
      const entry = enqueueInjection(db, { planId: loop.planId, text: finalPrompt });
      try { db.run("UPDATE injection_outbox SET loop_id = ? WHERE id = ?", [loop.id, entry.id]); } catch {}
      releaseLease(db, loop.id);
      return finish("done", "done", finalPrompt, "Plan đã hết task.", entry);
    }
    prompt = buildIncrementalPrompt({
      planGoal: view.plan.goal, planId: loop.planId, nextGoal: next.goal,
      nextDetails: next.details || undefined,
      nextVerify: next.verify ?? [],
      lastSummary: input.excerpt.slice(0, 500),
      remainingCount: view.tasks.filter((t) => t.status === "pending" || t.status === "running").length,
    });
    // Tái dùng buildContinuationPrompt khi có task vừa xong rõ ràng? Giữ
    // incremental gọn làm mặc định; buildContinuationPrompt vẫn dùng
    // cho luồng worker IDE cũ, không đổi ở đây.
    void buildContinuationPrompt;
  } else {
    prompt = buildFreeNudge({ goal: loop.goal, lastExcerpt: input.excerpt });
  }

  // Preflight budget: vượt trần thì compact (nếu được) thay vì gửi nudge.
  const budgetCheck = checkBudget({ used: updated.contextUsedEstimate, prompt, budget: updated.contextBudget, canCompact: true });
  if (budgetCheck === "compact") {
    const chkPrompt = buildCheckpointPrompt({ goal: loop.goal, planId: loop.planId || undefined, turnCount: turnIndex });
    if (loop.mode === "zero_risk") return { loop: setLoopStatus(db, updated, "deciding"), decision: "compact", prompt: chkPrompt, outboxEntry: null, reason: "Vượt ngân sách context ước lượng — cần checkpoint trước khi gửi tiếp (zero-risk: prompt đã chuẩn bị)." };
    const entry = enqueueInjection(db, { planId: loop.planId, text: chkPrompt });
    try { db.run("UPDATE injection_outbox SET loop_id = ? WHERE id = ?", [loop.id, entry.id]); } catch {}
    return { loop: setLoopStatus(db, updated, "injecting"), decision: "compact", prompt: chkPrompt, outboxEntry: entry, reason: "Vượt ngân sách context ước lượng — gửi checkpoint thay vì nudge." };
  }
  if (budgetCheck === "blocked") {
    releaseLease(db, loop.id);
    return finish("blocked", "blocked", null, "Vượt ngân sách context ước lượng và không compact được.");
  }

  db.run("UPDATE page_loops SET context_used_estimate = ?, updated_at = ? WHERE id = ?", [updated.contextUsedEstimate + estimateTokens(prompt), now(), loop.id]);
  updated = { ...updated, contextUsedEstimate: updated.contextUsedEstimate + estimateTokens(prompt) };
  if (loop.mode === "zero_risk") {
    return { loop: setLoopStatus(db, updated, "paused"), decision: "continue", prompt, outboxEntry: null, reason: "Zero-risk: prompt tiếp theo đã chuẩn bị, user gửi tay." };
  }
  const entry = enqueueInjection(db, { planId: loop.planId, text: prompt });
  try { db.run("UPDATE injection_outbox SET loop_id = ? WHERE id = ?", [loop.id, entry.id]); } catch {}
  // Cấp token cho lượt tiếp theo.
  const leaseTab = "unbound";
  const token = issueToken(loop.id, turnIndex + 1, leaseTab);
  storeTokenHash(db, loop.id, turnIndex + 1, token, leaseTab);
  return { loop: setLoopStatus(db, updated, "injecting"), decision: "continue", prompt, outboxEntry: entry, reason: null };
}

export function stopPageLoop(db: DbLike, loopId: string, reason?: string): PageLoop {
  const loop = requirePageLoop(db, loopId);
  if (["done", "blocked", "stopped"].includes(loop.status)) return loop;
  releaseLease(db, loopId);
  revokeTokens(db, loopId);
  // Không gửi thêm prompt nào của phiên này: outbox pending của loop này
  // được đánh dấu failed để flush không gửi nữa.
  try { db.run("UPDATE injection_outbox SET status = 'failed', last_error = 'page_loop stopped' WHERE loop_id = ? AND status = 'pending'", [loopId]); } catch {}
  return setLoopStatus(db, loop, "stopped", reason || "Người dùng dừng.");
}

export function resumePageLoop(db: DbLike, loopId: string): { loop: PageLoop; prompt: string } {
  const loop = requirePageLoop(db, loopId);
  if (!["paused", "armed"].includes(loop.status)) throw new Error(`Không resume được session ở trạng thái ${loop.status}.`);
  let prompt: string;
  if (loop.planId) {
    const view = getPlanStatus(db, loop.planId);
    prompt = buildResumePrompt(view);
  } else {
    prompt = buildFreeNudge({ goal: loop.goal, lastExcerpt: "" });
  }
  const token = issueToken(loop.id, loop.turnCount + 1, "unbound");
  storeTokenHash(db, loop.id, loop.turnCount + 1, token, "unbound");
  if (loop.mode === "zero_risk") {
    return { loop: setLoopStatus(db, loop, "paused"), prompt };
  }
  const entry = enqueueInjection(db, { planId: loop.planId, text: prompt });
  try { db.run("UPDATE injection_outbox SET loop_id = ? WHERE id = ?", [loop.id, entry.id]); } catch {}
  return { loop: setLoopStatus(db, loop, "injecting"), prompt };
}

export function getPageLoopStatusView(db: DbLike, loopId: string) {
  const loop = requirePageLoop(db, loopId);
  const turns = getPageLoopTurns(db, loopId);
  const checkpoints = getPageLoopCheckpoints(db, loopId);
  const receipts = listReceipts(db, loopId);
  const planView = loop.planId ? getPlanStatus(db, loop.planId) : null;
  return {
    loop,
    turns: turns.slice(-10),
    checkpoints,
    receipts: receipts.slice(0, 20),
    receipts24h: countReceiptsLast24h(db, loopId),
    tokenStatus: tokenStatusForLoop(loopId),
    plan: planView ? { goal: planView.plan.goal, status: planView.plan.status, tasks: planView.tasks.map((t: PlanTask) => ({ id: t.id, goal: t.goal, status: t.status })) } : null,
    budget: {
      usedEstimate: loop.contextUsedEstimate,
      budget: loop.contextBudget,
      leftEstimate: Math.max(0, loop.contextBudget - loop.contextUsedEstimate),
      turnsUsed: loop.turnCount,
      turnsLeft: Math.max(0, loop.maxTurns - loop.turnCount),
      minutesLeft: Math.max(0, loop.maxRunMinutes - Math.floor((now() - loop.createdAt) / 60_000)),
    },
  };
}
