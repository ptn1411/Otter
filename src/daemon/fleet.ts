/**
 * Fleet / multi-node — pure SQLite logic, no MCP/Zod dependency.
 *
 * Model (see docs/plans/2026-10-31-fleet-multi-node.md):
 * - A node is one daemon (one machine, or one daemon port on a shared
 *   machine). Identity comes from env, never from a caller-supplied id
 *   for the local node: OTTER_NODE_ID, OTTER_NODE_NAME, PORT.
 * - Hub tables: fleet_nodes (registered workers) + fleet_dispatches
 *   (hub's view of a dispatch). Worker table: fleet_inbox (one row per
 *   dispatch_id, UNIQUE by PK, so a redelivered dispatch never creates
 *   a second plan or runs a task twice).
 * - Tokens are NEVER stored in these tables. A hub calls a worker with
 *   the worker's OTTER_API_KEY (shared fleet key for the first version,
 *   or a per-node token passed by the caller and never persisted in
 *   the fleet DB). Worker auth is enforced globally by index.ts
 *   checkAuth before any fleet route runs.
 * - Project allowlist: a dispatch's project_root must resolve inside
 *   the worker's allowed workspaces (daemon cwd + OTTER_PROJECTS).
 *   Anything outside is refused, never executed.
 */
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { getAllowedWorkspaces } from "./security";
import { createPlan, getPlanStatus, resumePlan, cancelPlan, refreshPlanStatus, type PlanTaskInput } from "./plan";
import { enqueueInjection } from "./continuous-loop";

export type FleetDispatchStatus =
  | "pending" | "running" | "done" | "blocked" | "timed_out" | "cancelled" | "failed";

export const FLEET_STALE_AFTER_MS = 90_000;
export const FLEET_DEFAULT_DEADLINE_MS = 60 * 60 * 1000;

type DbLike = {
  run: (sql: string, ...params: any[]) => unknown;
  query: (sql: string) => { get: (...params: any[]) => unknown; all: (...params: any[]) => unknown[] };
};

function now(): number { return Date.now(); }
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}
function excerpt(text: string | null | undefined, max = 500): string | null {
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}

export function getNodeIdentity(): { nodeId: string; nodeName: string; hostname: string; port: number; projects: string[] } {
  return {
    nodeId: process.env.OTTER_NODE_ID?.trim() || os.hostname(),
    nodeName: process.env.OTTER_NODE_NAME?.trim() || process.env.OTTER_NODE_ID?.trim() || os.hostname(),
    hostname: os.hostname(),
    port: Number(process.env.PORT || 1993),
    projects: getAllowedWorkspaces(),
  };
}

export interface FleetNode {
  nodeId: string; name: string; apiBase: string;
  projects: string[]; capabilities: string[];
  lastHeartbeat: number | null; status: "online" | "stale" | "offline";
  createdAt: number; updatedAt: number;
}
export interface FleetDispatch {
  dispatchId: string; parentPlanId: string | null; nodeId: string;
  goal: string; tasks: PlanTaskInput[]; projectRoot: string | null;
  status: FleetDispatchStatus; resultExcerpt: string | null;
  workerPlanId: string | null; deadlineMs: number; createdAt: number; updatedAt: number;
}
export interface FleetInboxEntry {
  dispatchId: string; goal: string; tasks: PlanTaskInput[];
  projectRoot: string | null; verify: string[];
  status: FleetDispatchStatus; planId: string | null;
  resultExcerpt: string | null; deadlineMs: number; createdAt: number; updatedAt: number;
}

function rowToNode(r: Record<string, unknown>): FleetNode {
  const last = r.last_heartbeat ? Number(r.last_heartbeat) : null;
  const status: FleetNode["status"] = !last ? "offline" : (now() - last > FLEET_STALE_AFTER_MS ? "stale" : "online");
  return {
    nodeId: String(r.node_id), name: String(r.name), apiBase: String(r.api_base),
    projects: JSON.parse(String(r.projects_json || "[]")) as string[],
    capabilities: JSON.parse(String(r.capabilities_json || "[]")) as string[],
    lastHeartbeat: last, status,
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
function rowToDispatch(r: Record<string, unknown>): FleetDispatch {
  return {
    dispatchId: String(r.dispatch_id), parentPlanId: r.parent_plan_id ? String(r.parent_plan_id) : null,
    nodeId: String(r.node_id), goal: String(r.goal),
    tasks: JSON.parse(String(r.tasks_json || "[]")) as PlanTaskInput[],
    projectRoot: r.project_root ? String(r.project_root) : null,
    status: r.status as FleetDispatchStatus,
    resultExcerpt: r.result_excerpt ? String(r.result_excerpt) : null,
    workerPlanId: r.worker_plan_id ? String(r.worker_plan_id) : null,
    deadlineMs: Number(r.deadline_ms), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}
function rowToInbox(r: Record<string, unknown>): FleetInboxEntry {
  return {
    dispatchId: String(r.dispatch_id), goal: String(r.goal),
    tasks: JSON.parse(String(r.tasks_json || "[]")) as PlanTaskInput[],
    projectRoot: r.project_root ? String(r.project_root) : null,
    verify: JSON.parse(String(r.verify_json || "[]")) as string[],
    status: r.status as FleetDispatchStatus,
    planId: r.plan_id ? String(r.plan_id) : null,
    resultExcerpt: r.result_excerpt ? String(r.result_excerpt) : null,
    deadlineMs: Number(r.deadline_ms), createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  };
}

export function registerNode(db: DbLike, input: { nodeId: string; name?: string; apiBase: string; projects?: string[]; capabilities?: string[] }): FleetNode {
  const nodeId = input.nodeId.trim();
  const apiBase = input.apiBase.trim().replace(/\/+$/, "");
  if (!nodeId) throw new Error("nodeId must not be empty.");
  if (!/^https?:\/\//.test(apiBase)) throw new Error("apiBase must be an http(s) URL.");
  const ts = now();
  db.run(
    `INSERT INTO fleet_nodes (node_id, name, api_base, projects_json, capabilities_json, last_heartbeat, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET name = excluded.name, api_base = excluded.api_base,
       projects_json = excluded.projects_json, capabilities_json = excluded.capabilities_json,
       last_heartbeat = excluded.last_heartbeat, updated_at = excluded.updated_at`,
    [nodeId, input.name?.trim() || nodeId, apiBase,
     JSON.stringify(input.projects || []), JSON.stringify(input.capabilities || []), ts, ts, ts],
  );
  return getNode(db, nodeId)!;
}
export function getNode(db: DbLike, nodeId: string): FleetNode | null {
  const row = db.query("SELECT * FROM fleet_nodes WHERE node_id = ?").get(nodeId) as Record<string, unknown> | undefined;
  return row ? rowToNode(row) : null;
}
export function listNodes(db: DbLike): FleetNode[] {
  const rows = db.query("SELECT * FROM fleet_nodes ORDER BY updated_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToNode);
}
export function heartbeatNode(db: DbLike, nodeId: string): FleetNode {
  const ts = now();
  const row = db.query("SELECT * FROM fleet_nodes WHERE node_id = ?").get(nodeId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Unknown fleet node: ${nodeId}. Register it first via fleet_register.`);
  db.run("UPDATE fleet_nodes SET last_heartbeat = ?, updated_at = ? WHERE node_id = ?", [ts, ts, nodeId]);
  return getNode(db, nodeId)!;
}
export function removeNode(db: DbLike, nodeId: string): boolean {
  const before = (db.query("SELECT COUNT(*) AS n FROM fleet_nodes WHERE node_id = ?").get(nodeId) as any)?.n ?? 0;
  db.run("DELETE FROM fleet_nodes WHERE node_id = ?", [nodeId]);
  return Number(before) > 0;
}

export function createDispatch(db: DbLike, input: { nodeId: string; goal: string; tasks: PlanTaskInput[]; projectRoot?: string | null; parentPlanId?: string | null; deadlineMs?: number }): FleetDispatch {
  const goal = input.goal?.trim();
  if (!goal) throw new Error("Dispatch goal must not be empty.");
  if (!input.tasks || input.tasks.length === 0) throw new Error("Dispatch must contain at least one task.");
  const dispatchId = newId("disp");
  const ts = now();
  db.run(
    "INSERT INTO fleet_dispatches (dispatch_id, parent_plan_id, node_id, goal, tasks_json, project_root, status, result_excerpt, worker_plan_id, deadline_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, ?)",
    [dispatchId, input.parentPlanId ?? null, input.nodeId, goal, JSON.stringify(input.tasks), input.projectRoot ?? null, input.deadlineMs ?? FLEET_DEFAULT_DEADLINE_MS, ts, ts],
  );
  return getDispatch(db, dispatchId)!;
}
export function getDispatch(db: DbLike, dispatchId: string): FleetDispatch | null {
  const row = db.query("SELECT * FROM fleet_dispatches WHERE dispatch_id = ?").get(dispatchId) as Record<string, unknown> | undefined;
  return row ? rowToDispatch(row) : null;
}
export function listDispatches(db: DbLike, nodeId?: string): FleetDispatch[] {
  const rows = nodeId
    ? db.query("SELECT * FROM fleet_dispatches WHERE node_id = ? ORDER BY created_at DESC").all(nodeId) as Record<string, unknown>[]
    : db.query("SELECT * FROM fleet_dispatches ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToDispatch);
}
export function updateDispatch(db: DbLike, dispatchId: string, patch: { status?: FleetDispatchStatus; resultExcerpt?: string | null; workerPlanId?: string | null }): FleetDispatch {
  const cur = getDispatch(db, dispatchId);
  if (!cur) throw new Error(`Unknown dispatch: ${dispatchId}`);
  const status = patch.status ?? cur.status;
  const resultExcerpt = patch.resultExcerpt !== undefined ? excerpt(patch.resultExcerpt) : cur.resultExcerpt;
  const workerPlanId = patch.workerPlanId !== undefined ? patch.workerPlanId : cur.workerPlanId;
  db.run("UPDATE fleet_dispatches SET status = ?, result_excerpt = ?, worker_plan_id = ?, updated_at = ? WHERE dispatch_id = ?",
    [status, resultExcerpt, workerPlanId, now(), dispatchId]);
  return getDispatch(db, dispatchId)!;
}
export function sweepTimedOutDispatches(db: DbLike): string[] {
  const rows = db.query("SELECT * FROM fleet_dispatches WHERE status IN ('pending', 'running')").all() as Record<string, unknown>[];
  const timed: string[] = [];
  for (const r of rows) {
    const d = rowToDispatch(r);
    if (now() - d.createdAt > d.deadlineMs) {
      updateDispatch(db, d.dispatchId, { status: "timed_out" });
      timed.push(d.dispatchId);
    }
  }
  return timed;
}

/** Project allowlist check, shared by worker receive + hub dispatch. */
export function isProjectAllowed(projectRoot: string | null | undefined): boolean {
  if (!projectRoot) return true; // no explicit project: worker uses its own cwd
  const resolved = path.resolve(projectRoot);
  return getAllowedWorkspaces().some((ws) => resolved === ws || resolved.startsWith(ws + path.sep));
}

/**
 * Worker side: receive a dispatch exactly once. Creates a local plan,
 * starts it (draft -> running, so plan_next can pick tasks), and puts a
 * B2 prompt into the injection outbox so a connected ChatGPT tab on
 * this worker receives the task even if it was not watching. If the
 * same dispatch_id arrives again, the original inbox row + plan are
 * returned and NO second plan is created.
 */
export function receiveDispatch(db: DbLike, input: {
  dispatchId: string; goal: string; tasks: PlanTaskInput[]; projectRoot?: string | null; verify?: string[]; deadlineMs?: number;
}): { inbox: FleetInboxEntry; planId: string; outboxId: string; alreadyExisted: boolean } {
  const dispatchId = input.dispatchId?.trim();
  if (!dispatchId) throw new Error("dispatchId must not be empty.");
  const existing = db.query("SELECT * FROM fleet_inbox WHERE dispatch_id = ?").get(dispatchId) as Record<string, unknown> | undefined;
  if (existing) {
    const entry = rowToInbox(existing);
    const pending = db.query("SELECT * FROM injection_outbox WHERE plan_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1").get(entry.planId) as any;
    return { inbox: entry, planId: entry.planId!, outboxId: pending?.id ?? "", alreadyExisted: true };
  }
  if (!isProjectAllowed(input.projectRoot)) {
    throw new Error(`Dispatch project_root '${input.projectRoot}' is outside this worker's allowed projects: ${getAllowedWorkspaces().join(", ")}. Refused.`);
  }
  const goal = input.goal?.trim();
  if (!goal) throw new Error("Dispatch goal must not be empty.");
  if (!input.tasks || input.tasks.length === 0) throw new Error("Dispatch must contain at least one task.");
  const { plan } = createPlan(db as any, {
    goal: `[FLEET ${dispatchId}] ${goal}`,
    tasks: input.tasks,
    conversationId: "chatgpt-web",
  });
  resumePlan(db as any, plan.id);
  const prompt = [
    `[FLEET TASK — dispatch ${dispatchId}]`,
    `Goal: ${goal}`,
    input.projectRoot ? `Project: ${input.projectRoot}` : "",
    ...(input.tasks.map((t, i) => `${i + 1}. ${t.goal}${t.details ? ` — ${t.details}` : ""}${t.verify?.length ? ` (verify: ${t.verify.join(", ")})` : ""}`)),
    `Nếu chưa có tab ChatGPT nào nối với daemon này, gọi chrome_open_profile trước để mở Chrome đúng profile của worker (mặc định mở chatgpt.com), rồi mới làm — đừng làm mù khi chưa có tab.`,
    `Nếu làm việc trực tiếp trên trang ChatGPT của worker (không qua worker IDE), gọi page_loop_start với planId=${plan.id} (mặc định 10 lượt / 30 phút, tối đa 5 lease/worker) để watcher đọc lượt và daemon quyết định tiếp — hub không mang token sang worker, worker tự cấp token cho phiên của nó.`,
    `Làm từng task theo loop hiện tại (plan_next -> làm -> loop_report_attempt), rồi báo done. Plan local: ${plan.id}.`,
  ].filter(Boolean).join("\n");
  const outbox = enqueueInjection(db as any, { planId: plan.id, text: prompt });
  const ts = now();
  db.run(
    "INSERT INTO fleet_inbox (dispatch_id, goal, tasks_json, project_root, verify_json, status, plan_id, result_excerpt, deadline_ms, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, ?, ?, ?)",
    [dispatchId, goal, JSON.stringify(input.tasks), input.projectRoot ?? null, JSON.stringify(input.verify || []), plan.id, input.deadlineMs ?? FLEET_DEFAULT_DEADLINE_MS, ts, ts],
  );
  return { inbox: getInbox(db, dispatchId)!, planId: plan.id, outboxId: outbox.id, alreadyExisted: false };
}
export function getInbox(db: DbLike, dispatchId: string): FleetInboxEntry | null {
  const row = db.query("SELECT * FROM fleet_inbox WHERE dispatch_id = ?").get(dispatchId) as Record<string, unknown> | undefined;
  return row ? rowToInbox(row) : null;
}
export function listInbox(db: DbLike): FleetInboxEntry[] {
  const rows = db.query("SELECT * FROM fleet_inbox ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToInbox);
}
/**
 * Worker side: derive the inbox status from its local plan, so hub
 * polling sees the truth without the worker ChatGPT having to report
 * separately. Callers (routes/tools) should call this before returning
 * an inbox row, so done/blocked/cancelled propagate.
 */
export function refreshInboxFromPlan(db: DbLike, dispatchId: string): FleetInboxEntry | null {
  const entry = getInbox(db, dispatchId);
  if (!entry || !entry.planId) return entry;
  let view: ReturnType<typeof getPlanStatus>;
  try {
    // plan_task_update edits the task row only and does not promote the
    // plan row; promote here so a worker plan whose tasks are all
    // success/skipped is reported done to the hub without waiting for
    // a loop_finish call that may never come in a B2 dispatch.
    refreshPlanStatus(db as any, entry.planId);
    view = getPlanStatus(db as any, entry.planId);
  } catch { return entry; }
  const planStatus = view.plan.status;
  let status: FleetDispatchStatus = entry.status;
  let resultExcerpt = entry.resultExcerpt;
  if (planStatus === "done") { status = "done"; resultExcerpt = excerpt(`Plan ${entry.planId} done: ${view.counts.success} success, ${view.counts.skipped} skipped, ${view.counts.failed} failed, ${view.counts.blocked} blocked.`); }
  else if (planStatus === "cancelled") status = "cancelled";
  else if (view.counts.blocked > 0 && view.counts.pending === 0 && view.counts.running === 0) status = "blocked";
  else if (planStatus === "running" || planStatus === "paused") status = "running";
  if (now() - entry.createdAt > entry.deadlineMs && status !== "done" && status !== "cancelled") status = "timed_out";
  if (status !== entry.status || resultExcerpt !== entry.resultExcerpt) {
    db.run("UPDATE fleet_inbox SET status = ?, result_excerpt = ?, updated_at = ? WHERE dispatch_id = ?",
      [status, resultExcerpt, now(), dispatchId]);
    return getInbox(db, dispatchId);
  }
  return entry;
}
export function cancelInbox(db: DbLike, dispatchId: string): FleetInboxEntry {
  const entry = getInbox(db, dispatchId);
  if (!entry) throw new Error(`Unknown dispatch: ${dispatchId}`);
  if (entry.planId) { try { cancelPlan(db as any, entry.planId); } catch {} }
  db.run("UPDATE fleet_inbox SET status = 'cancelled', updated_at = ? WHERE dispatch_id = ?", [now(), dispatchId]);
  return getInbox(db, dispatchId)!;
}
