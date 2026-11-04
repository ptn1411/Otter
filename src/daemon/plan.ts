/**
 * Phase 1 — Plan & Run model for the continuous-coding loop.
 *
 * Pure SQLite logic, deliberately free of MCP/Zod dependencies so it can be
 * tested with `bun scripts/test-plan-phase1.ts` without node_modules.
 * MCP tool wrappers live in `./tools/plan-tools.ts`.
 *
 * Model:
 * - A plan is an ordered list of plan_tasks. By default tasks run in
 *   order_index order. `dependsOn` is optional and, when present, is a list
 *   of plan task ids that must be `success` (or `skipped`) before the task
 *   becomes eligible. At creation time, a dependsOn entry may also be the
 *   exact goal of an earlier task, which is resolved to that task's id.
 * - Plan status is explicit: draft -> running -> paused -> running -> done /
 *   failed / cancelled. `resume` starts a draft plan and unpauses a paused
 *   plan. A plan becomes `done` only when refreshPlanStatus() sees every
 *   task in a terminal success/skipped state (called by later phases when a
 *   task completes; Phase 1 does not auto-fail a plan on a single failed task,
 *   because Phase 3 retry may still recover it).
 * - `lastInjectionAt` is reserved for Phase 5 (injection outbox) and is null
 *   in Phase 1; `lastHeartbeatAt` is the max heartbeat across plan tasks.
 */
import * as crypto from "node:crypto";

export type PlanStatus = "draft" | "running" | "paused" | "done" | "failed" | "cancelled";
export type PlanTaskStatus = "pending" | "running" | "success" | "failed" | "blocked" | "skipped";

export interface PlanTaskInput {
  goal: string;
  details?: string;
  filesHint?: string[];
  verify?: string[];
  dependsOn?: string[];
  maxAttempts?: number;
}

export interface PlanTask {
  id: string;
  planId: string;
  orderIndex: number;
  goal: string;
  details?: string;
  filesHint?: string[];
  verify?: string[];
  dependsOn: string[];
  status: PlanTaskStatus;
  attemptCount: number;
  maxAttempts: number;
  lastHeartbeatAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Plan {
  id: string;
  conversationId: string;
  goal: string;
  loopPrompt?: string;
  status: PlanStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStatusView {
  plan: Plan;
  tasks: PlanTask[];
  counts: Record<PlanTaskStatus, number>;
  currentTask: PlanTask | null;
  nextTask: PlanTask | null;
  lastHeartbeatAt: number | null;
  /** Reserved for Phase 5 (injection outbox). Null in Phase 1. */
  lastInjectionAt: null;
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

function parseJsonArray(value: unknown): string[] {
  if (!value || typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function rowToPlan(row: Record<string, unknown>): Plan {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id ?? "chatgpt-web"),
    goal: String(row.goal),
    loopPrompt: row.loop_prompt ? String(row.loop_prompt) : undefined,
    status: row.status as PlanStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToPlanTask(row: Record<string, unknown>): PlanTask {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    orderIndex: Number(row.order_index),
    goal: String(row.goal),
    details: row.details ? String(row.details) : undefined,
    filesHint: parseJsonArray(row.files_hint_json),
    verify: parseJsonArray(row.verify_json),
    dependsOn: parseJsonArray(row.depends_on_json),
    status: row.status as PlanTaskStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 3),
    lastHeartbeatAt: row.last_heartbeat_at ? Number(row.last_heartbeat_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function timeline(db: DbLike, conversationId: string, eventType: string, payload: unknown): void {
  try {
    db.run(
      "INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
      [conversationId, eventType, JSON.stringify(payload), now()],
    );
  } catch {
    // Timeline is best-effort; plan writes must not fail because of it.
  }
}

export function getPlan(db: DbLike, planId: string): Plan | null {
  const row = db.query("SELECT * FROM plans WHERE id = ?").get(planId) as Record<string, unknown> | undefined;
  return row ? rowToPlan(row) : null;
}

export function requirePlan(db: DbLike, planId: string): Plan {
  const plan = getPlan(db, planId);
  if (!plan) throw new Error(`Unknown planId: ${planId}`);
  return plan;
}

export function getPlanTasks(db: DbLike, planId: string): PlanTask[] {
  const rows = db.query("SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY order_index ASC, id ASC").all(planId) as Record<string, unknown>[];
  return rows.map(rowToPlanTask);
}

export function getPlanTask(db: DbLike, planTaskId: string): PlanTask | null {
  const row = db.query("SELECT * FROM plan_tasks WHERE id = ?").get(planTaskId) as Record<string, unknown> | undefined;
  return row ? rowToPlanTask(row) : null;
}

function insertPlanTask(
  db: DbLike,
  plan: Plan,
  input: PlanTaskInput,
  orderIndex: number,
  resolvedDependsOn: string[],
): PlanTask {
  const goal = input.goal?.trim();
  if (!goal) throw new Error("Plan task goal must not be empty.");
  const id = newId("ptask");
  const ts = now();
  const maxAttempts = input.maxAttempts !== undefined ? Math.max(1, Math.floor(input.maxAttempts)) : 3;
  db.run(
    "INSERT INTO plan_tasks (id, plan_id, order_index, goal, details, files_hint_json, verify_json, depends_on_json, status, attempt_count, max_attempts, last_heartbeat_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?)",
    [
      id,
      plan.id,
      orderIndex,
      goal,
      input.details ?? null,
      JSON.stringify(input.filesHint ?? []),
      JSON.stringify(input.verify ?? []),
      JSON.stringify(resolvedDependsOn),
      maxAttempts,
      ts,
      ts,
    ],
  );
  return {
    id,
    planId: plan.id,
    orderIndex,
    goal,
    details: input.details,
    filesHint: input.filesHint ?? [],
    verify: input.verify ?? [],
    dependsOn: resolvedDependsOn,
    status: "pending",
    attemptCount: 0,
    maxAttempts,
    lastHeartbeatAt: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

function resolveDependsOn(tasksSoFar: PlanTask[], dependsOn: string[] | undefined): string[] {
  if (!dependsOn || dependsOn.length === 0) return [];
  return dependsOn.map((entry) => {
    const byId = tasksSoFar.find((t) => t.id === entry);
    if (byId) return byId.id;
    const byGoal = tasksSoFar.find((t) => t.goal === entry);
    if (byGoal) return byGoal.id;
    // Unknown at creation time (e.g. a task added later): keep as-is so
    // eligibility treats an unknown dependency as not satisfied, instead of
    // silently dropping a constraint the author intended.
    return entry;
  });
}

export function createPlan(
  db: DbLike,
  input: { goal: string; tasks: PlanTaskInput[]; loopPrompt?: string; conversationId?: string },
): { plan: Plan; tasks: PlanTask[] } {
  const goal = input.goal?.trim();
  if (!goal) throw new Error("Plan goal must not be empty.");
  if (!input.tasks || input.tasks.length === 0) throw new Error("Plan must contain at least one task.");
  const conversationId = input.conversationId ?? "chatgpt-web";
  const plan: Plan = {
    id: newId("plan"),
    conversationId,
    goal,
    loopPrompt: input.loopPrompt,
    status: "draft",
    createdAt: now(),
    updatedAt: now(),
  };
  db.run("INSERT INTO plans (id, conversation_id, goal, loop_prompt, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)", [
    plan.id,
    conversationId,
    goal,
    input.loopPrompt ?? null,
    plan.createdAt,
    plan.updatedAt,
  ]);
  const tasks: PlanTask[] = [];
  input.tasks.forEach((taskInput, index) => {
    const resolved = resolveDependsOn(tasks, taskInput.dependsOn);
    tasks.push(insertPlanTask(db, plan, taskInput, index, resolved));
  });
  timeline(db, conversationId, "plan_created", { planId: plan.id, goal, taskCount: tasks.length });
  return { plan, tasks };
}

export function addPlanTask(db: DbLike, planId: string, input: PlanTaskInput): PlanTask {
  const plan = requirePlan(db, planId);
  if (plan.status === "done" || plan.status === "failed" || plan.status === "cancelled") {
    throw new Error(`Cannot add a task to a ${plan.status} plan: ${planId}`);
  }
  const existing = getPlanTasks(db, planId);
  const orderIndex = existing.length === 0 ? 0 : Math.max(...existing.map((t) => t.orderIndex)) + 1;
  const resolved = resolveDependsOn(existing, input.dependsOn);
  const task = insertPlanTask(db, plan, input, orderIndex, resolved);
  timeline(db, plan.conversationId, "plan_task_added", { planId, taskId: task.id, goal: task.goal, orderIndex });
  return task;
}

export function listPlans(db: DbLike, status?: PlanStatus): (Plan & { taskCounts: Record<PlanTaskStatus, number>; taskTotal: number })[] {
  const rows = (
    status
      ? db.query("SELECT * FROM plans WHERE status = ? ORDER BY created_at DESC").all(status)
      : db.query("SELECT * FROM plans ORDER BY created_at DESC").all()
  ) as Record<string, unknown>[];
  return rows.map((row) => {
    const plan = rowToPlan(row);
    const tasks = getPlanTasks(db, plan.id);
    const counts = countTasks(tasks);
    return { ...plan, taskCounts: counts, taskTotal: tasks.length };
  });
}

export function countTasks(tasks: PlanTask[]): Record<PlanTaskStatus, number> {
  const counts: Record<PlanTaskStatus, number> = { pending: 0, running: 0, success: 0, failed: 0, blocked: 0, skipped: 0 };
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

function dependenciesSatisfied(task: PlanTask, byId: Map<string, PlanTask>): boolean {
  return task.dependsOn.every((depId) => {
    const dep = byId.get(depId);
    return dep !== undefined && (dep.status === "success" || dep.status === "skipped");
  });
}

export function getPlanStatus(db: DbLike, planId: string): PlanStatusView {
  const plan = requirePlan(db, planId);
  const tasks = getPlanTasks(db, planId);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const currentTask = tasks.find((t) => t.status === "running") ?? null;
  let nextTask: PlanTask | null = null;
  for (const task of tasks) {
    if (task.status !== "pending") continue;
    if (currentTask && task.orderIndex <= currentTask.orderIndex) continue;
    if (!dependenciesSatisfied(task, byId)) continue;
    nextTask = task;
    break;
  }
  // If there is no running task, "next" is the first eligible pending task.
  if (!currentTask && !nextTask) {
    nextTask = tasks.find((t) => t.status === "pending" && dependenciesSatisfied(t, byId)) ?? null;
  }
  const heartbeats = tasks.map((t) => t.lastHeartbeatAt).filter((v): v is number => v !== null);
  return {
    plan,
    tasks,
    counts: countTasks(tasks),
    currentTask,
    nextTask,
    lastHeartbeatAt: heartbeats.length > 0 ? Math.max(...heartbeats) : null,
    lastInjectionAt: null,
  };
}

/** The next task a worker should pull for this plan, or null when none is eligible. */
export function getNextEligibleTask(db: DbLike, planId: string): PlanTask | null {
  const view = getPlanStatus(db, planId);
  if (view.plan.status !== "running") return null;
  if (view.currentTask) return null; // one task at a time per plan, by design
  return view.nextTask;
}

function setPlanStatus(db: DbLike, plan: Plan, status: PlanStatus): Plan {
  const ts = now();
  db.run("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?", [status, ts, plan.id]);
  timeline(db, plan.conversationId, `plan_${status}`, { planId: plan.id });
  return { ...plan, status, updatedAt: ts };
}

export function pausePlan(db: DbLike, planId: string): Plan {
  const plan = requirePlan(db, planId);
  if (plan.status !== "running") throw new Error(`Only a running plan can be paused (current: ${plan.status}).`);
  return setPlanStatus(db, plan, "paused");
}

export function resumePlan(db: DbLike, planId: string): Plan {
  const plan = requirePlan(db, planId);
  if (plan.status !== "draft" && plan.status !== "paused") {
    throw new Error(`Only a draft or paused plan can be resumed (current: ${plan.status}).`);
  }
  return setPlanStatus(db, plan, "running");
}

/** Alias for resumePlan, for callers that think in terms of starting a plan. */
export function startPlan(db: DbLike, planId: string): Plan {
  return resumePlan(db, planId);
}

export function cancelPlan(db: DbLike, planId: string): Plan {
  const plan = requirePlan(db, planId);
  if (plan.status === "done" || plan.status === "cancelled") throw new Error(`Plan is already ${plan.status}.`);
  return setPlanStatus(db, plan, "cancelled");
}

/**
 * Recompute a plan's terminal state from its tasks. Only promotes to `done`
 * when every task is success/skipped. Never auto-fails on a single failed
 * task (Phase 3 retry may recover it); callers set `failed` explicitly.
 */
export function refreshPlanStatus(db: DbLike, planId: string): Plan {
  const plan = requirePlan(db, planId);
  if (plan.status === "done" || plan.status === "cancelled" || plan.status === "failed") return plan;
  const tasks = getPlanTasks(db, planId);
  if (tasks.length > 0 && tasks.every((t) => t.status === "success" || t.status === "skipped")) {
    return setPlanStatus(db, plan, "done");
  }
  return plan;
}

export function setPlanTaskStatus(
  db: DbLike,
  planTaskId: string,
  status: PlanTaskStatus,
  opts?: { incrementAttempt?: boolean },
): PlanTask {
  const task = getPlanTask(db, planTaskId);
  if (!task) throw new Error(`Unknown plan taskId: ${planTaskId}`);
  const ts = now();
  const attemptCount = task.attemptCount + (opts?.incrementAttempt ? 1 : 0);
  db.run("UPDATE plan_tasks SET status = ?, attempt_count = ?, updated_at = ? WHERE id = ?", [status, attemptCount, ts, planTaskId]);
  return { ...task, status, attemptCount, updatedAt: ts };
}

const PLAN_TASK_STATUSES: PlanTaskStatus[] = ["pending", "running", "success", "failed", "blocked", "skipped"];

/**
 * Edit one plan task's title (goal) and/or notes (details) and/or status
 * and/or dependsOn. Pure logic, same style as setPlanTaskStatus: unknown
 * task ids and invalid status values are refused with a clear error, and
 * dependsOn entries must be existing task ids in the same plan (a task
 * cannot depend on itself). No schema change: every column written here
 * already exists in plan_tasks. Note this only edits the task row; it does
 * not refresh the parent plan's status (refreshPlanStatus keeps doing that
 * on the normal completion path).
 */
export function updatePlanTask(
  db: DbLike,
  planTaskId: string,
  patch: { title?: string; notes?: string; status?: PlanTaskStatus; dependsOn?: string[] },
): PlanTask {
  const task = getPlanTask(db, planTaskId);
  if (!task) throw new Error(`Unknown plan taskId: ${planTaskId}`);
  if (patch.status !== undefined && !PLAN_TASK_STATUSES.includes(patch.status)) {
    throw new Error(`Invalid plan task status: ${patch.status} (valid: ${PLAN_TASK_STATUSES.join(", ")})`);
  }
  if (patch.title !== undefined && !patch.title.trim()) {
    throw new Error("Plan task title must not be empty.");
  }
  let dependsOn = task.dependsOn;
  if (patch.dependsOn !== undefined) {
    const siblingIds = new Set(getPlanTasks(db, task.planId).map((t) => t.id));
    for (const dep of patch.dependsOn) {
      if (dep === planTaskId) throw new Error("A plan task cannot depend on itself.");
      if (!siblingIds.has(dep)) throw new Error(`Unknown dependsOn task id: ${dep}`);
    }
    dependsOn = [...patch.dependsOn];
  }
  const ts = now();
  const next: PlanTask = {
    ...task,
    goal: patch.title !== undefined ? patch.title : task.goal,
    details: patch.notes !== undefined ? patch.notes : task.details,
    status: patch.status !== undefined ? patch.status : task.status,
    dependsOn,
    updatedAt: ts,
  };
  db.run("UPDATE plan_tasks SET goal = ?, details = ?, status = ?, depends_on_json = ?, updated_at = ? WHERE id = ?",
    [next.goal, next.details ?? null, next.status, JSON.stringify(dependsOn), ts, planTaskId]);
  return next;
}

export function recordPlanTaskHeartbeat(db: DbLike, planTaskId: string): PlanTask {
  const task = getPlanTask(db, planTaskId);
  if (!task) throw new Error(`Unknown plan taskId: ${planTaskId}`);
  const ts = now();
  db.run("UPDATE plan_tasks SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?", [ts, ts, planTaskId]);
  return { ...task, lastHeartbeatAt: ts, updatedAt: ts };
}
