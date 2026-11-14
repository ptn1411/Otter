/**
 * Loop controller — the standard coding loop as a state machine
 * (docs/plans/2026-10-31-standard-coding-loop.md).
 *
 * Pure SQLite logic in the same style as plan.ts: no MCP/Zod dependencies,
 * testable with `bun scripts/test-loop-controller.ts` on a temp DB.
 *
 * Rules enforced here (not just reported):
 * - SQLite is the single truth: loop runs, per-task attempts with evidence,
 *   and suite results all live in loop_runs / loop_attempts / loop_suite_runs.
 * - Tests are the only judge of "done": a task becomes `success` only via a
 *   passed attempt report (loop_report_attempt outcome=passed). There is no
 *   tool that marks a task done without a passed verdict.
 * - Finish one task -> immediately take the next: loop_next returns the
 *   first ready task in order_index order whose dependsOn are all
 *   success/skipped, and retryable `failed` tasks are re-dispatched.
 * - Max 3 fix rounds: the 3rd failed attempt for a task blocks the task AND
 *   the loop, with the failing evidence recorded. 3 consecutive no-progress
 *   turns (identical failing evidence) block the same way.
 * - Budget: default 20 turns / 60 minutes per loop run, configurable at
 *   start. Spending the budget pauses the loop safely (checkpoint kept);
 *   loop_resume with a larger budget continues it. Nothing is marked done
 *   that did not pass.
 * - Finish requires ALL of: every plan task success/skipped AND every
 *   auto-runnable regression suite passing. loop_finish runs the suites
 *   itself and refuses with the exact open tasks / failing suites otherwise.
 * - Sync to `nam` is deliberately NOT the controller's job: it stays a
 *   manual parent step (sync_to_nam.sh + hash verify), per the task brief.
 *   loop_finish therefore covers the first two stop conditions; the caller
 *   must still sync before calling the whole run "done".
 *
 * G0 (prepare) is enforced at loop_start: every task must have a non-empty
 * goal, non-empty details (scope / acceptance criteria), a non-empty verify
 * list (the matching test commands), and dependsOn entries that all resolve
 * to tasks in the same plan. Otherwise start is refused with the offending
 * task ids — criteria are never invented by the controller.
 */

import * as crypto from "node:crypto";
import {
  getPlanTask,
  getPlanTasks,
  refreshPlanStatus,
  requirePlan,
  setPlanTaskStatus,
  type PlanTask,
} from "./plan";

export type LoopStatus = "running" | "paused" | "blocked" | "finished" | "stopped";

export const LOOP_MAX_ATTEMPTS = 3;
export const LOOP_MAX_NO_PROGRESS = 3;
export const LOOP_DEFAULT_MAX_TURNS = 20;
export const LOOP_DEFAULT_MAX_MINUTES = 60;
export const LOOP_EVIDENCE_MAX_CHARS = 2000;
export const LOOP_MAX_CHANGED_FILES = 50;

export interface LoopRun {
  id: string;
  planId: string;
  status: LoopStatus;
  maxTurns: number;
  maxMinutes: number;
  turnsUsed: number;
  noProgressTurns: number;
  startedAt: number;
  deadlineMs: number;
  blockedReason: string | null;
  decisionNeeded: string | null;
  finalGatePassed: number;
  createdAt: number;
  updatedAt: number;
}

export interface LoopAttempt {
  id: string;
  loopId: string;
  planTaskId: string;
  attemptNo: number;
  outcome: "passed" | "failed";
  testName: string | null;
  outputExcerpt: string | null;
  changedFiles: string[];
  createdAt: number;
}

export interface LoopSuiteRun {
  id: string;
  loopId: string | null;
  suiteId: string;
  passed: number;
  exitCode: number | null;
  durationMs: number;
  outputExcerpt: string | null;
  createdAt: number;
}

export interface LoopAttemptEvidence {
  testName?: string;
  outputExcerpt?: string;
  changedFiles?: string[];
}

export interface LoopTaskState {
  task: PlanTask;
  attempts: LoopAttempt[];
  failedAttempts: number;
  lastEvidence: LoopAttempt | null;
}

export interface LoopStatusView {
  loop: LoopRun;
  planId: string;
  planStatus: string;
  tasks: LoopTaskState[];
  budget: { turnsUsed: number; maxTurns: number; turnsLeft: number; minutesLeft: number; deadlineMs: number };
  openTasks: PlanTask[];
  blockedTasks: PlanTask[];
}

type DbLike = {
  run: (sql: string, ...params: any[]) => unknown;
  query: (sql: string) => { get: (...params: any[]) => unknown; all: (...params: any[]) => unknown[] };
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

function evidenceHash(ev: { testName: string | null; outputExcerpt: string | null }): string {
  return crypto.createHash("sha256").update(`${ev.testName ?? ""}\n${ev.outputExcerpt ?? ""}`).digest("hex");
}

function rowToLoopRun(row: Record<string, unknown>): LoopRun {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    status: row.status as LoopStatus,
    maxTurns: Number(row.max_turns),
    maxMinutes: Number(row.max_minutes),
    turnsUsed: Number(row.turns_used),
    noProgressTurns: Number(row.no_progress_turns),
    startedAt: Number(row.started_at),
    deadlineMs: Number(row.deadline_ms),
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : null,
    decisionNeeded: row.decision_needed ? String(row.decision_needed) : null,
    finalGatePassed: Number(row.final_gate_passed ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToLoopAttempt(row: Record<string, unknown>): LoopAttempt {
  return {
    id: String(row.id),
    loopId: String(row.loop_id),
    planTaskId: String(row.plan_task_id),
    attemptNo: Number(row.attempt_no),
    outcome: row.outcome as "passed" | "failed",
    testName: row.test_name ? String(row.test_name) : null,
    outputExcerpt: row.output_excerpt ? String(row.output_excerpt) : null,
    changedFiles: parseJsonArray(row.changed_files_json),
    createdAt: Number(row.created_at),
  };
}

export function getLoopRun(db: DbLike, loopId: string): LoopRun | null {
  const row = db.query("SELECT * FROM loop_runs WHERE id = ?").get(loopId) as Record<string, unknown> | undefined;
  return row ? rowToLoopRun(row) : null;
}

export function requireLoopRun(db: DbLike, loopId: string): LoopRun {
  const run = getLoopRun(db, loopId);
  if (!run) throw new Error(`Unknown loopId: ${loopId}`);
  return run;
}

export function getActiveLoopForPlan(db: DbLike, planId: string): LoopRun | null {
  const rows = db.query("SELECT * FROM loop_runs WHERE plan_id = ? AND status IN ('running', 'paused', 'blocked') ORDER BY created_at DESC").all(planId) as Record<string, unknown>[];
  return rows.length > 0 ? rowToLoopRun(rows[0]) : null;
}

function setLoopStatus(db: DbLike, run: LoopRun, status: LoopStatus, extra?: { blockedReason?: string | null; decisionNeeded?: string | null }): LoopRun {
  const ts = now();
  const blockedReason = extra?.blockedReason !== undefined ? extra.blockedReason : run.blockedReason;
  const decisionNeeded = extra?.decisionNeeded !== undefined ? extra.decisionNeeded : run.decisionNeeded;
  db.run("UPDATE loop_runs SET status = ?, blocked_reason = ?, decision_needed = ?, updated_at = ? WHERE id = ?",
    [status, blockedReason, decisionNeeded, ts, run.id]);
  return { ...run, status, blockedReason, decisionNeeded, updatedAt: ts };
}

/**
 * G0: every task in the plan must be queueable — non-empty goal, non-empty
 * details, non-empty verify list, and dependsOn resolving to same-plan tasks.
 * Returns the offending task ids (empty = all good).
 */
export function findUnqueueableTasks(db: DbLike, planId: string): { taskId: string; goal: string; reasons: string[] }[] {
  const tasks = getPlanTasks(db, planId);
  const ids = new Set(tasks.map((t) => t.id));
  const bad: { taskId: string; goal: string; reasons: string[] }[] = [];
  for (const task of tasks) {
    const reasons: string[] = [];
    if (!task.goal.trim()) reasons.push("empty goal");
    if (!task.details || !task.details.trim()) reasons.push("missing details (scope / acceptance criteria)");
    if (!task.verify || task.verify.length === 0) reasons.push("missing verify (matching test commands)");
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) reasons.push(`unknown dependsOn task id: ${dep}`);
    }
    if (reasons.length > 0) bad.push({ taskId: task.id, goal: task.goal, reasons });
  }
  return bad;
}

export function startLoop(
  db: DbLike,
  planId: string,
  opts?: { maxTurns?: number; maxMinutes?: number },
): LoopRun {
  const plan = requirePlan(db, planId);
  if (plan.status !== "running") {
    throw new Error(`Loop can only start on a running plan (plan ${planId} is ${plan.status}; call plan_resume first).`);
  }
  const active = getActiveLoopForPlan(db, planId);
  if (active) {
    throw new Error(`Plan ${planId} already has an active loop run ${active.id} (status: ${active.status}); stop it before starting a new one.`);
  }
  const tasks = getPlanTasks(db, planId);
  if (tasks.length === 0) throw new Error(`Plan ${planId} has no tasks.`);
  const unqueueable = findUnqueueableTasks(db, planId);
  if (unqueueable.length > 0) {
    throw new Error(
      `Refusing to start loop: ${unqueueable.length} task(s) fail the G0 readiness check (goal + details + verify + resolvable dependsOn): ` +
      unqueueable.map((u) => `${u.taskId} (${u.goal}): ${u.reasons.join("; ")}`).join(" | "),
    );
  }
  const maxTurns = opts?.maxTurns !== undefined ? Math.max(1, Math.min(200, Math.floor(opts.maxTurns))) : LOOP_DEFAULT_MAX_TURNS;
  const maxMinutes = opts?.maxMinutes !== undefined ? Math.max(1, Math.min(480, Math.floor(opts.maxMinutes))) : LOOP_DEFAULT_MAX_MINUTES;
  const ts = now();
  const run: LoopRun = {
    id: newId("loop"),
    planId,
    status: "running",
    maxTurns,
    maxMinutes,
    turnsUsed: 0,
    noProgressTurns: 0,
    startedAt: ts,
    deadlineMs: ts + maxMinutes * 60_000,
    blockedReason: null,
    decisionNeeded: null,
    finalGatePassed: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  db.run(
    "INSERT INTO loop_runs (id, plan_id, status, max_turns, max_minutes, turns_used, no_progress_turns, started_at, deadline_ms, blocked_reason, decision_needed, final_gate_passed, created_at, updated_at) VALUES (?, ?, 'running', ?, ?, 0, 0, ?, ?, NULL, NULL, 0, ?, ?)",
    [run.id, planId, maxTurns, maxMinutes, ts, run.deadlineMs, ts, ts],
  );
  return run;
}

export function pauseLoop(db: DbLike, loopId: string): LoopRun {
  const run = requireLoopRun(db, loopId);
  if (run.status !== "running") throw new Error(`Only a running loop can be paused (current: ${run.status}).`);
  return setLoopStatus(db, run, "paused");
}

export function resumeLoop(
  db: DbLike,
  loopId: string,
  opts?: { maxTurns?: number; maxMinutes?: number },
): LoopRun {
  const run = requireLoopRun(db, loopId);
  if (run.status !== "paused" && run.status !== "blocked") {
    throw new Error(`Only a paused or blocked loop can be resumed (current: ${run.status}).`);
  }
  const ts = now();
  const maxTurns = opts?.maxTurns !== undefined ? Math.max(1, Math.min(200, Math.floor(opts.maxTurns))) : run.maxTurns;
  const maxMinutes = opts?.maxMinutes !== undefined ? Math.max(1, Math.min(480, Math.floor(opts.maxMinutes))) : run.maxMinutes;
  // A fresh time budget starts at resume time when the caller extends it;
  // otherwise the original deadline stands.
  const deadlineMs = opts?.maxMinutes !== undefined ? ts + maxMinutes * 60_000 : run.deadlineMs;
  db.run("UPDATE loop_runs SET status = 'running', max_turns = ?, max_minutes = ?, deadline_ms = ?, blocked_reason = NULL, decision_needed = NULL, updated_at = ? WHERE id = ?",
    [maxTurns, maxMinutes, deadlineMs, ts, loopId]);
  return { ...run, status: "running" as LoopStatus, maxTurns, maxMinutes, deadlineMs, blockedReason: null, decisionNeeded: null, updatedAt: ts };
}

export function stopLoop(db: DbLike, loopId: string): LoopRun {
  const run = requireLoopRun(db, loopId);
  if (run.status === "finished" || run.status === "stopped") throw new Error(`Loop is already ${run.status}.`);
  return setLoopStatus(db, run, "stopped");
}

export function getLoopAttempts(db: DbLike, loopId: string, planTaskId?: string): LoopAttempt[] {
  const rows = (
    planTaskId
      ? db.query("SELECT * FROM loop_attempts WHERE loop_id = ? AND plan_task_id = ? ORDER BY attempt_no ASC, created_at ASC").all(loopId, planTaskId)
      : db.query("SELECT * FROM loop_attempts WHERE loop_id = ? ORDER BY created_at ASC, attempt_no ASC").all(loopId)
  ) as Record<string, unknown>[];
  return rows.map(rowToLoopAttempt);
}

function blockLoopWithEvidence(
  db: DbLike,
  run: LoopRun,
  task: PlanTask,
  reason: string,
  decisionNeeded: string,
): { loop: LoopRun; task: PlanTask } {
  setPlanTaskStatus(db, task.id, "blocked");
  const loop = setLoopStatus(db, run, "blocked", { blockedReason: reason, decisionNeeded });
  return { loop, task: { ...task, status: "blocked" as const } };
}

/**
 * Record a worker's verdict for the task this loop dispatched. A task only
 * becomes `success` on a passed verdict; a failed verdict counts toward the
 * 3-strike rule and the no-progress rule. Evidence is capped at write time.
 */
export function reportLoopAttempt(
  db: DbLike,
  loopId: string,
  planTaskId: string,
  outcome: "passed" | "failed",
  evidence?: LoopAttemptEvidence,
): { loop: LoopRun; task: PlanTask; attempt: LoopAttempt; blocked: boolean; blockedReason: string | null } {
  const run = requireLoopRun(db, loopId);
  if (run.status !== "running") throw new Error(`Loop ${loopId} is ${run.status}; only a running loop accepts attempt reports.`);
  const task = getPlanTask(db, planTaskId);
  if (!task) throw new Error(`Unknown plan taskId: ${planTaskId}`);
  if (task.planId !== run.planId) throw new Error(`Task ${planTaskId} does not belong to loop ${loopId}'s plan ${run.planId}.`);
  if (task.status !== "running") {
    throw new Error(`Task ${planTaskId} is ${task.status}; only the task dispatched by loop_next (status running) can report an attempt.`);
  }
  const prior = getLoopAttempts(db, loopId, planTaskId);
  const attemptNo = prior.length + 1;
  const clean: { testName: string | null; outputExcerpt: string | null; changedFiles: string[] } = {
    testName: evidence?.testName?.trim() ? evidence.testName.trim() : null,
    outputExcerpt: evidence?.outputExcerpt ? evidence.outputExcerpt.slice(0, LOOP_EVIDENCE_MAX_CHARS) : null,
    changedFiles: (evidence?.changedFiles ?? []).slice(0, LOOP_MAX_CHANGED_FILES),
  };
  const ts = now();
  const attempt: LoopAttempt = {
    id: newId("lpattempt"),
    loopId,
    planTaskId,
    attemptNo,
    outcome,
    testName: clean.testName,
    outputExcerpt: clean.outputExcerpt,
    changedFiles: clean.changedFiles,
    createdAt: ts,
  };
  db.run(
    "INSERT INTO loop_attempts (id, loop_id, plan_task_id, attempt_no, outcome, test_name, output_excerpt, changed_files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [attempt.id, loopId, planTaskId, attemptNo, outcome, clean.testName, clean.outputExcerpt, JSON.stringify(clean.changedFiles), ts],
  );

  if (outcome === "passed") {
    const done = setPlanTaskStatus(db, planTaskId, "success");
    db.run("UPDATE loop_runs SET no_progress_turns = 0, updated_at = ? WHERE id = ?", [ts, loopId]);
    return { loop: { ...run, noProgressTurns: 0, updatedAt: ts }, task: done, attempt, blocked: false, blockedReason: null };
  }

  // Failed: count strikes + no-progress turns.
  const failedCount = prior.filter((a) => a.outcome === "failed").length + 1;
  setPlanTaskStatus(db, planTaskId, "failed", { incrementAttempt: true });
  const lastFailed = [...prior].reverse().find((a) => a.outcome === "failed");
  const sameEvidence = lastFailed !== undefined && evidenceHash({ testName: lastFailed.testName, outputExcerpt: lastFailed.outputExcerpt }) === evidenceHash(clean);
  const noProgressTurns = sameEvidence ? run.noProgressTurns + 1 : 0;
  db.run("UPDATE loop_runs SET no_progress_turns = ?, updated_at = ? WHERE id = ?", [noProgressTurns, ts, loopId]);
  const updatedRun: LoopRun = { ...run, noProgressTurns, updatedAt: ts };

  if (failedCount >= LOOP_MAX_ATTEMPTS || noProgressTurns >= LOOP_MAX_NO_PROGRESS) {
    const reason =
      failedCount >= LOOP_MAX_ATTEMPTS
        ? `3 failed attempts exhausted for task ${planTaskId} (${task.goal}); last failing test: ${clean.testName ?? "unknown"}`
        : `3 consecutive no-progress turns for task ${planTaskId} (${task.goal}); identical failing evidence repeated`;
    const { loop, task: blockedTask } = blockLoopWithEvidence(db, updatedRun, { ...task, status: "failed" as const }, reason,
      "Human decision needed: fix the failing test/task, or explicitly approve skipping it (recorded approval only — the controller never auto-skips).");
    return { loop, task: blockedTask, attempt, blocked: true, blockedReason: reason };
  }
  return { loop: updatedRun, task: { ...task, status: "failed" as const, attemptCount: task.attemptCount + 1 }, attempt, blocked: false, blockedReason: null };
}

/**
 * Block a task + the loop on human input or a verify-gate refusal, with
 * evidence. This is the only way a task becomes blocked without failing
 * attempts, and it always records what decision is needed.
 */
export function blockLoop(
  db: DbLike,
  loopId: string,
  opts: { planTaskId?: string; reason: string; decisionNeeded?: string; evidence?: LoopAttemptEvidence },
): { loop: LoopRun; task: PlanTask | null } {
  const run = requireLoopRun(db, loopId);
  if (run.status !== "running" && run.status !== "paused") {
    throw new Error(`Only a running or paused loop can be blocked (current: ${run.status}).`);
  }
  if (!opts.reason.trim()) throw new Error("A block reason is required.");
  let task: PlanTask | null = null;
  if (opts.planTaskId) {
    const found = getPlanTask(db, opts.planTaskId);
    if (!found) throw new Error(`Unknown plan taskId: ${opts.planTaskId}`);
    if (found.planId !== run.planId) throw new Error(`Task ${opts.planTaskId} does not belong to loop ${loopId}'s plan.`);
    task = found;
    // Record the blocking evidence as an attempt row when evidence is given,
    // so the blocked record is complete even without failed attempts.
    if (opts.evidence && (opts.evidence.testName || opts.evidence.outputExcerpt)) {
      const prior = getLoopAttempts(db, loopId, opts.planTaskId);
      const ts = now();
      db.run(
        "INSERT INTO loop_attempts (id, loop_id, plan_task_id, attempt_no, outcome, test_name, output_excerpt, changed_files_json, created_at) VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?)",
        [newId("lpattempt"), loopId, opts.planTaskId, prior.length + 1, opts.evidence.testName ?? null, (opts.evidence.outputExcerpt ?? "").slice(0, LOOP_EVIDENCE_MAX_CHARS), JSON.stringify((opts.evidence.changedFiles ?? []).slice(0, LOOP_MAX_CHANGED_FILES)), ts],
      );
    }
  }
  const decisionNeeded = opts.decisionNeeded ?? "Human decision needed (see blocked reason).";
  if (task) {
    const { loop } = blockLoopWithEvidence(db, run, task, opts.reason, decisionNeeded);
    return { loop, task: { ...task, status: "blocked" as const } };
  }
  const loop = setLoopStatus(db, run, "blocked", { blockedReason: opts.reason, decisionNeeded });
  return { loop, task: null };
}

export type NextTaskResult =
  | { task: PlanTask; reason: null }
  | { task: null; reason: "loop_not_running" | "budget_exhausted" | "plan_not_running" | "task_in_progress" | "waiting_dependencies" | "tasks_blocked" | "all_tasks_done"; detail: string };

/**
 * G1: return the next task this loop should dispatch, or null + the exact
 * reason. Refuses: loop not running, budget spent (pauses the loop as a
 * safe checkpoint), plan not running, a task already in progress, and any
 * task whose dependsOn are not all success/skipped. Dispatch marks the task
 * running and spends one turn of budget.
 */
export function nextLoopTask(db: DbLike, loopId: string): NextTaskResult {
  const run = requireLoopRun(db, loopId);
  if (run.status !== "running") {
    return { task: null, reason: "loop_not_running", detail: `Loop ${loopId} is ${run.status}.` };
  }
  const plan = requirePlan(db, run.planId);
  if (plan.status !== "running") {
    return { task: null, reason: "plan_not_running", detail: `Plan ${run.planId} is ${plan.status}; call plan_resume first.` };
  }
  const ts = now();
  if (run.turnsUsed >= run.maxTurns || ts > run.deadlineMs) {
    const reason = run.turnsUsed >= run.maxTurns ? `turn budget spent (${run.turnsUsed}/${run.maxTurns} turns)` : `time budget spent (deadline ${new Date(run.deadlineMs).toISOString()})`;
    setLoopStatus(db, run, "paused");
    return { task: null, reason: "budget_exhausted", detail: `Loop paused as a safe checkpoint: ${reason}. Resume with a larger budget to continue; nothing is marked done that did not pass.` };
  }
  const tasks = getPlanTasks(db, run.planId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (tasks.some((t) => t.status === "running")) {
    return { task: null, reason: "task_in_progress", detail: "A task is already running for this plan; wait for its attempt report." };
  }
  const blocked = tasks.filter((t) => t.status === "blocked");
  const candidates = tasks
    .filter((t) => t.status === "pending" || t.status === "failed")
    .filter((t) => t.dependsOn.every((depId) => {
      const dep = byId.get(depId);
      return dep !== undefined && (dep.status === "success" || dep.status === "skipped");
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  if (candidates.length === 0) {
    if (blocked.length > 0) {
      return { task: null, reason: "tasks_blocked", detail: `${blocked.length} task(s) blocked: ${blocked.map((t) => t.id).join(", ")}. Resolve them before continuing.` };
    }
    const pending = tasks.filter((t) => t.status === "pending" || t.status === "failed");
    if (pending.length > 0) {
      return { task: null, reason: "waiting_dependencies", detail: `${pending.length} task(s) still wait on unsatisfied dependsOn; no task is ready right now.` };
    }
    return { task: null, reason: "all_tasks_done", detail: "All tasks are success/skipped. Run loop_finish for the final gate." };
  }
  const chosen = candidates[0];
  setPlanTaskStatus(db, chosen.id, "running");
  db.run("UPDATE loop_runs SET turns_used = turns_used + 1, updated_at = ? WHERE id = ?", [ts, loopId]);
  return { task: { ...chosen, status: "running" as const }, reason: null };
}

export function getLoopStatus(db: DbLike, loopId: string): LoopStatusView {
  const loop = requireLoopRun(db, loopId);
  const plan = requirePlan(db, loop.planId);
  const tasks = getPlanTasks(db, loop.planId);
  const taskStates: LoopTaskState[] = tasks.map((task) => {
    const attempts = getLoopAttempts(db, loopId, task.id);
    return {
      task,
      attempts,
      failedAttempts: attempts.filter((a) => a.outcome === "failed").length,
      lastEvidence: attempts.length > 0 ? attempts[attempts.length - 1] : null,
    };
  });
  const ts = now();
  return {
    loop,
    planId: loop.planId,
    planStatus: plan.status,
    tasks: taskStates,
    budget: {
      turnsUsed: loop.turnsUsed,
      maxTurns: loop.maxTurns,
      turnsLeft: Math.max(0, loop.maxTurns - loop.turnsUsed),
      minutesLeft: Math.max(0, Math.floor((loop.deadlineMs - ts) / 60_000)),
      deadlineMs: loop.deadlineMs,
    },
    openTasks: tasks.filter((t) => t.status !== "success" && t.status !== "skipped"),
    blockedTasks: tasks.filter((t) => t.status === "blocked"),
  };
}

export function recordSuiteRun(
  db: DbLike,
  loopId: string | null,
  suiteId: string,
  result: { passed: boolean; exitCode: number | null; durationMs: number; outputExcerpt: string | null },
): LoopSuiteRun {
  const ts = now();
  const row: LoopSuiteRun = {
    id: newId("lpsuite"),
    loopId,
    suiteId,
    passed: result.passed ? 1 : 0,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    outputExcerpt: result.outputExcerpt ? result.outputExcerpt.slice(0, LOOP_EVIDENCE_MAX_CHARS) : null,
    createdAt: ts,
  };
  db.run(
    "INSERT INTO loop_suite_runs (id, loop_id, suite_id, passed, exit_code, duration_ms, output_excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [row.id, loopId, suiteId, row.passed, row.exitCode, row.durationMs, row.outputExcerpt, ts],
  );
  return row;
}

/**
 * Final gate, enforced. Returns passed=true ONLY when every plan task is
 * success/skipped AND every supplied suite result passes. The caller
 * (loop_finish tool) runs the suites first; this function is the pure
 * verdict so it can be unit-tested without spawning anything.
 */
export function evaluateFinalGate(
  db: DbLike,
  loopId: string,
  suiteResults: { suiteId: string; passed: boolean }[],
): { passed: boolean; openTasks: PlanTask[]; failingSuites: string[] } {
  const run = requireLoopRun(db, loopId);
  const tasks = getPlanTasks(db, run.planId);
  const openTasks = tasks.filter((t) => t.status !== "success" && t.status !== "skipped");
  const failingSuites = suiteResults.filter((s) => !s.passed).map((s) => s.suiteId);
  return { passed: openTasks.length === 0 && failingSuites.length === 0, openTasks, failingSuites };
}

export function markLoopFinished(db: DbLike, loopId: string): LoopRun {
  const run = requireLoopRun(db, loopId);
  const ts = now();
  db.run("UPDATE loop_runs SET status = 'finished', final_gate_passed = 1, updated_at = ? WHERE id = ?", [ts, loopId]);
  refreshPlanStatus(db, run.planId);
  return { ...run, status: "finished" as LoopStatus, finalGatePassed: 1, updatedAt: ts };
}
