/**
 * Phases 2-6 — Continuous-coding loop helpers (pure SQLite / pure functions).
 *
 * Kept free of MCP/Zod so `bun scripts/test-continuous-loop.ts` can test
 * this module without node_modules. MCP wrappers live in task-bridge.ts
 * (heartbeat, complete, release) and plan-tools.ts (plan_next, resume prompt).
 *
 * Limits (defaults, overridable by callers that pass explicit values):
 * - heartbeat interval expected: 60s, stale after 5 minutes
 * - max attempts per task: 3
 * - max run time per plan: 480 minutes (enforced by callers via plan age,
 *   not by this module's sweeper, to avoid surprising a long legitimate run)
 */
import * as crypto from "node:crypto";
import { getPlanStatus, type PlanStatusView, type PlanTask } from "./plan";

export const LOOP_LIMITS = {
  heartbeatIntervalMs: 60_000,
  heartbeatTimeoutMs: 5 * 60_000,
  maxAttemptsPerTask: 3,
  maxOutboxAttempts: 5,
};

type DbLike = {
  run: (sql: string, params?: unknown[]) => unknown;
  query: (sql: string) => { get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
};

function now(): number {
  return Date.now();
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ---------------------------------------------------------------------------
// Phase 4 — continuation / final / resume prompts
// ---------------------------------------------------------------------------

export function summarizeTasks(tasks: PlanTask[]): string {
  return tasks
    .map((t) => {
      const icon = t.status === "success" ? "✅" : t.status === "failed" ? "❌" : t.status === "blocked" ? "⚠️" : t.status === "running" ? "▶️" : "⏳";
      return `- ${icon} ${t.goal}`;
    })
    .join("\n");
}

export function buildContinuationPrompt(input: {
  planGoal: string;
  planId: string;
  completedTask: { goal: string; summary: string; filesTouched?: string[]; verify?: string[] };
  nextTask: PlanTask;
  completedTasks: PlanTask[];
  remainingCount: number;
}): string {
  const { planGoal, planId, completedTask, nextTask, completedTasks, remainingCount } = input;
  return [
    `🔄 [Otter Loop — tiếp tục plan] Plan: ${planGoal} (planId: ${planId})`,
    ``,
    `Task vừa xong: ${completedTask.goal}`,
    `Tóm tắt: ${truncate(completedTask.summary, 500)}`,
    completedTask.filesTouched?.length ? `Files đã thay đổi: ${completedTask.filesTouched.join(", ")}` : "",
    completedTask.verify?.length ? `Kiểm thử: ${completedTask.verify.join(", ")}` : "",
    ``,
    `Đã xong trong plan:`,
    summarizeTasks(completedTasks),
    remainingCount > 1 ? `Còn lại ${remainingCount} task (kể cả task tiếp theo).` : `Còn 1 task cuối cùng.`,
    ``,
    `Task tiếp theo — làm ngay, không dừng, không hỏi lại:`,
    `- Mục tiêu: ${nextTask.goal}`,
    nextTask.details ? `- Chi tiết: ${nextTask.details}` : "",
    nextTask.filesHint?.length ? `- File gợi ý: ${nextTask.filesHint.join(", ")}` : "",
    nextTask.verify?.length ? `- Kiểm thử bắt buộc trước khi báo xong: ${nextTask.verify.join("; ")}` : "",
    ``,
    `Hướng dẫn vòng lặp: gọi plan_next để lấy task tiếp theo nếu cần, giao task này cho worker, chờ worker báo xong, rồi lại tiếp tục. Chỉ dừng khi task báo blocked/failed quá số lần cho phép, hoặc khi plan đã hết task.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function buildFinalPrompt(input: { planGoal: string; planId: string; view: PlanStatusView }): string {
  const { planGoal, planId, view } = input;
  return [
    `✅ [Otter Loop — plan đã xong] Plan: ${planGoal} (planId: ${planId})`,
    ``,
    summarizeTasks(view.tasks),
    ``,
    `Tất cả task đã ở trạng thái success/skipped. Vui lòng tổng hợp kết quả cuối cùng cho người dùng, liệt kê file đã thay đổi và cách kiểm thử, rồi dừng vòng lặp — không tạo thêm task.`,
  ].join("\n");
}

export function buildResumePrompt(view: PlanStatusView): string {
  const { plan, currentTask, nextTask } = view;
  const target = currentTask ?? nextTask;
  if (!target) {
    return buildFinalPrompt({ planGoal: plan.goal, planId: plan.id, view });
  }
  return [
    `🔁 [Otter Loop — tiếp tục plan sau khi mất kết nối] Plan: ${plan.goal} (planId: ${plan.id}, trạng thái: ${plan.status})`,
    ``,
    `Tiến độ hiện tại:`,
    summarizeTasks(view.tasks),
    ``,
    `Task cần làm tiếp: ${target.goal}`,
    target.details ? `Chi tiết: ${target.details}` : "",
    target.filesHint?.length ? `File gợi ý: ${target.filesHint.join(", ")}` : "",
    ``,
    `Tiếp tục từ task này, không làm lại task đã success, không hỏi lại plan từ đầu.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Phase 5 — injection outbox
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  id: string;
  planId: string | null;
  taskId: string | null;
  textHash: string;
  text: string;
  status: "pending" | "delivered" | "failed";
  attemptCount: number;
  createdAt: number;
  deliveredAt: number | null;
  lastError: string | null;
}

export function enqueueInjection(
  db: DbLike,
  input: { planId?: string | null; taskId?: string | null; loopId?: string | null; text: string },
): OutboxEntry {
  const hash = sha256(input.text);
  const existing = db
    .query("SELECT * FROM injection_outbox WHERE text_hash = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1")
    .get(hash) as Record<string, unknown> | undefined;
  if (existing) return rowToOutbox(existing);
  const entry: OutboxEntry = {
    id: `inj_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    planId: input.planId ?? null,
    taskId: input.taskId ?? null,
    textHash: hash,
    text: input.text,
    status: "pending",
    attemptCount: 0,
    createdAt: now(),
    deliveredAt: null,
    lastError: null,
  };
  try {
    db.run(
      "INSERT INTO injection_outbox (id, plan_id, task_id, loop_id, text_hash, text, status, attempt_count, created_at, delivered_at, last_error) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL)",
      [entry.id, entry.planId, entry.taskId, input.loopId ?? null, entry.textHash, entry.text, entry.createdAt],
    );
  } catch {
    // DB cũ chưa có cột loop_id (chưa chạy migration mới) — vẫn enqueue được, loop scope sẽ được cập nhật sau.
    db.run(
      "INSERT INTO injection_outbox (id, plan_id, task_id, text_hash, text, status, attempt_count, created_at, delivered_at, last_error) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL)",
      [entry.id, entry.planId, entry.taskId, entry.textHash, entry.text, entry.createdAt],
    );
  }
  return entry;
}

export function listPendingInjections(db: DbLike): OutboxEntry[] {
  const rows = db.query("SELECT * FROM injection_outbox WHERE status = 'pending' ORDER BY created_at ASC").all() as Record<string, unknown>[];
  return rows.map(rowToOutbox);
}

export function markInjectionDelivered(db: DbLike, id: string): void {
  db.run("UPDATE injection_outbox SET status = 'delivered', delivered_at = ? WHERE id = ?", [now(), id]);
}

export function markInjectionFailed(db: DbLike, id: string, error: string): void {
  db.run("UPDATE injection_outbox SET status = 'failed', last_error = ? WHERE id = ?", [error, id]);
}

function rowToOutbox(row: Record<string, unknown>): OutboxEntry {
  return {
    id: String(row.id),
    planId: row.plan_id ? String(row.plan_id) : null,
    taskId: row.task_id ? String(row.task_id) : null,
    textHash: String(row.text_hash),
    text: String(row.text),
    status: row.status as OutboxEntry["status"],
    attemptCount: Number(row.attempt_count ?? 0),
    createdAt: Number(row.created_at),
    deliveredAt: row.delivered_at ? Number(row.delivered_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  };
}

/**
 * Try to deliver every pending outbox entry with `sendFn`. A sendFn that
 * returns true counts as delivered (extension ack, Phase 5, confirms this in
 * production; in tests a mock sendFn stands in for it). A false return or a
 * throw increments the attempt counter; after max attempts the entry is
 * marked failed instead of being retried forever.
 */
export async function flushInjectionOutbox(
  db: DbLike,
  sendFn: (text: string, id: string) => boolean | Promise<boolean>,
  maxAttempts: number = LOOP_LIMITS.maxOutboxAttempts,
): Promise<{ delivered: number; failed: number; remaining: number }> {
  let delivered = 0;
  let failed = 0;
  for (const entry of listPendingInjections(db)) {
    let ok = false;
    try {
      ok = await sendFn(entry.text, entry.id);
    } catch (err: any) {
      ok = false;
      db.run("UPDATE injection_outbox SET last_error = ? WHERE id = ?", [String(err?.message ?? err), entry.id]);
    }
    if (ok) {
      markInjectionDelivered(db, entry.id);
      delivered += 1;
    } else {
      const attempts = entry.attemptCount + 1;
      db.run("UPDATE injection_outbox SET attempt_count = ? WHERE id = ?", [attempts, entry.id]);
      if (attempts >= maxAttempts) {
        markInjectionFailed(db, entry.id, "Max delivery attempts reached");
        failed += 1;
      }
    }
  }
  return { delivered, failed, remaining: listPendingInjections(db).length };
}

// ---------------------------------------------------------------------------
// Phase 2/3 — recovery + stale-task sweeper (DB side)
// ---------------------------------------------------------------------------

export interface RecoveredBridgeTask {
  id: string;
  conversationId: string;
  title: string;
  details: string | null;
  filesHint: string[];
  verify: string[];
  planId: string | null;
  planTaskId: string | null;
  status: string;
  attemptCount: number;
  createdAt: number;
}

/**
 * Read pending/running bridge tasks from SQLite in creation order.
 * Running tasks with a recent heartbeat are left as `running` (a live worker
 * may reclaim them via ack/complete after restart); running tasks with no
 * recent heartbeat are moved back to `pending` with attempt+1. Callers that
 * hold in-memory queue state should use the returned lists to rebuild it.
 */
export function recoverBridgeTasks(
  db: DbLike,
  nowMs: number = now(),
  heartbeatTimeoutMs: number = LOOP_LIMITS.heartbeatTimeoutMs,
): { pending: RecoveredBridgeTask[]; stillRunning: RecoveredBridgeTask[] } {
  const rows = db.query("SELECT * FROM tasks WHERE status IN ('pending', 'running') ORDER BY created_at ASC, id ASC").all() as Record<string, unknown>[];
  const pending: RecoveredBridgeTask[] = [];
  const stillRunning: RecoveredBridgeTask[] = [];
  for (const row of rows) {
    const task = rowToRecovered(row);
    if (task.status === "pending") {
      pending.push(task);
      continue;
    }
    // status === 'running'
    const lastBeat = (row as any).last_heartbeat_at as number | null;
    // A running task with no heartbeat at all is only stale if it was created
    // a while ago; a task created seconds before the restart may simply not
    // have heartbeated yet. Use created_at as a fallback heartbeat time.
    const effectiveLastBeat = lastBeat ?? task.createdAt;
    const actuallyStale = nowMs - effectiveLastBeat > heartbeatTimeoutMs;
    if (actuallyStale) {
      const attempts = task.attemptCount + 1;
      db.run("UPDATE tasks SET status = 'pending', attempt_count = ? WHERE id = ?", [attempts, task.id]);
      try {
        db.run("INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)", [
          task.conversationId,
          "task_recovered",
          JSON.stringify({ taskId: task.id, attemptCount: attempts }),
          nowMs,
        ]);
      } catch {}
      pending.push({ ...task, status: "pending", attemptCount: attempts });
    } else {
      stillRunning.push(task);
    }
  }
  return { pending, stillRunning };
}

function rowToRecovered(row: Record<string, unknown>): RecoveredBridgeTask {
  const parse = (v: unknown): string[] => {
    if (!v || typeof v !== "string") return [];
    try {
      const p: unknown = JSON.parse(v);
      return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    title: String(row.title ?? ""),
    details: row.details ? String(row.details) : null,
    filesHint: parse(row.files_hint_json),
    verify: parse(row.verify_json),
    planId: row.plan_id ? String(row.plan_id) : null,
    planTaskId: row.plan_task_id ? String(row.plan_task_id) : null,
    status: String(row.status),
    attemptCount: Number(row.attempt_count ?? 0),
    createdAt: Number(row.created_at),
  };
}

/**
 * Sweep stale running tasks (bridge tasks + plan tasks) in the DB.
 * Returns what changed so callers can sync in-memory state and notify.
 * A task that hits max attempts becomes `blocked` (plan tasks also pause
 * their plan); otherwise it goes back to `pending` for a retry.
 */
export function sweepStaleTasks(
  db: DbLike,
  nowMs: number = now(),
  heartbeatTimeoutMs: number = LOOP_LIMITS.heartbeatTimeoutMs,
): { bridgeRecovered: string[]; bridgeBlocked: string[]; planRecovered: string[]; planBlocked: string[] } {
  const bridgeRecovered: string[] = [];
  const bridgeBlocked: string[] = [];
  const planRecovered: string[] = [];
  const planBlocked: string[] = [];

  const bridgeRows = db.query("SELECT * FROM tasks WHERE status = 'running'").all() as Record<string, unknown>[];
  for (const row of bridgeRows) {
    const lastBeat = (row as any).last_heartbeat_at as number | null;
    const effective = lastBeat ?? Number(row.created_at);
    if (nowMs - effective <= heartbeatTimeoutMs) continue;
    const attempts = Number(row.attempt_count ?? 0) + 1;
    const maxAttempts = 3;
    if (attempts >= maxAttempts) {
      db.run("UPDATE tasks SET status = 'failed', attempt_count = ? WHERE id = ?", [attempts, row.id]);
      bridgeBlocked.push(String(row.id));
    } else {
      db.run("UPDATE tasks SET status = 'pending', attempt_count = ? WHERE id = ?", [attempts, row.id]);
      bridgeRecovered.push(String(row.id));
    }
  }

  const planRows = db.query("SELECT * FROM plan_tasks WHERE status = 'running'").all() as Record<string, unknown>[];
  const pausedPlans = new Set<string>();
  for (const row of planRows) {
    const lastBeat = (row as any).last_heartbeat_at as number | null;
    const effective = lastBeat ?? Number(row.updated_at ?? row.created_at);
    if (nowMs - effective <= heartbeatTimeoutMs) continue;
    const attempts = Number(row.attempt_count ?? 0) + 1;
    const maxAttempts = Number(row.max_attempts ?? LOOP_LIMITS.maxAttemptsPerTask);
    if (attempts >= maxAttempts) {
      db.run("UPDATE plan_tasks SET status = 'blocked', attempt_count = ?, updated_at = ? WHERE id = ?", [attempts, nowMs, row.id]);
      planBlocked.push(String(row.id));
      const planId = String(row.plan_id);
      if (!pausedPlans.has(planId)) {
        pausedPlans.add(planId);
        db.run("UPDATE plans SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'running'", [nowMs, planId]);
      }
    } else {
      db.run("UPDATE plan_tasks SET status = 'pending', attempt_count = ?, updated_at = ? WHERE id = ?", [attempts, nowMs, row.id]);
      planRecovered.push(String(row.id));
    }
  }

  return { bridgeRecovered, bridgeBlocked, planRecovered, planBlocked };
}

// ---------------------------------------------------------------------------
// Phase 6 — verify gate + safety heuristic
// ---------------------------------------------------------------------------

export interface VerifyResult {
  command: string;
  ok: boolean;
  exitCode: number | null;
  output: string;
}

export async function runVerifyCommand(command: string, timeoutMs: number = 120_000): Promise<VerifyResult> {
  try {
    let cmdToRun = command;
    if (process.platform === "win32") {
      if (command.trim() === "true") cmdToRun = "exit 0";
      else if (command.trim() === "false") cmdToRun = "exit 1";
    }
    const shellCmd = process.platform === "win32"
      ? ["cmd.exe", "/d", "/s", "/c", cmdToRun]
      : ["sh", "-c", command];
    const proc = Bun.spawn(shellCmd, { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timeout);
    const output = truncate(`${stdout}\n${stderr}`.trim(), 2000);
    return { command, ok: exitCode === 0, exitCode, output };
  } catch (err: any) {
    return { command, ok: false, exitCode: null, output: String(err?.message ?? err) };
  }
}

export async function runVerifyGate(commands: string[]): Promise<{ pass: boolean; results: VerifyResult[] }> {
  const results: VerifyResult[] = [];
  for (const command of commands) {
    const result = await runVerifyCommand(command);
    results.push(result);
    if (!result.ok) return { pass: false, results };
  }
  return { pass: true, results };
}

export function isRiskyTask(input: { goal: string; details?: string; filesHint?: string[] }): { risky: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const text = `${input.goal}\n${input.details ?? ""}`.toLowerCase();
  const destructive = ["rm -rf", "rm -r", "format ", "drop table", "drop database", "delete from", "chmod 777", ":(){:|:&};:"];
  for (const pattern of destructive) {
    if (text.includes(pattern)) reasons.push(`Chứa mẫu lệnh nguy hiểm: ${pattern}`);
  }
  for (const file of input.filesHint ?? []) {
    if (file.includes("..")) reasons.push(`File gợi ý thoát khỏi workspace: ${file}`);
    if (file.startsWith("/") && !file.startsWith(process.cwd())) reasons.push(`File tuyệt đối ngoài workspace: ${file}`);
  }
  return { risky: reasons.length > 0, reasons };
}

export function planStatusSummary(view: PlanStatusView): string {
  return `Plan ${view.plan.id} (${view.plan.status}): pending=${view.counts.pending} running=${view.counts.running} success=${view.counts.success} failed=${view.counts.failed} blocked=${view.counts.blocked} skipped=${view.counts.skipped}`;
}
