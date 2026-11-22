/**
 * A2A (Agent2Agent) Protocol 1.0.0 — Otter daemon as an A2A server.
 *
 * Single JSON-RPC 2.0 endpoint `POST /a2a` + public Agent Card at
 * `GET /.well-known/agent-card.json`. Follows the existing route pattern:
 * `handleA2aRoutes(req, url, db?)` returns a Response or null and is wired
 * into the daemon fetch chain in index.ts (after the global auth check,
 * like every other route).
 *
 * Spec references (a2a-protocol.org, 1.0.0):
 * - §5.3 Method Mapping: SendMessage / SendStreamingMessage / GetTask /
 *   ListTasks / CancelTask / SubscribeToTask (PascalCase). The 0.3 lowercase
 *   names (message/send, tasks/get, ...) are ALSO accepted as aliases so
 *   older clients keep working; the canonical 1.0 names are what the
 *   Agent Card advertises and what our client sends.
 * - §5.4 Error codes: -32001 TaskNotFound, -32002 TaskNotCancelable,
 *   -32003 PushNotificationNotSupported, -32004 UnsupportedOperation,
 *   -32005 ContentTypeNotSupported, -32006 InvalidAgentResponse,
 *   -32007 ExtendedAgentCardNotConfigured, -32008 ExtensionSupportRequired,
 *   -32009 VersionNotSupported; standard JSON-RPC -32700/-32600/-32601/
 *   -32602/-32603 (§9.5). Auth failures use HTTP 401 + code -32000
 *   (server-defined range; A2A defines no auth code).
 * - §5.5: enums are ProtoJSON SCREAMING_SNAKE_CASE (TASK_STATE_SUBMITTED,
 *   ROLE_USER, ...); fields are camelCase; timestamps are ISO 8601 UTC.
 * - §9.2: `A2A-Version: 1.0` header; an explicit unsupported version is
 *   rejected with VersionNotSupported (-32009). A missing header is
 *   accepted leniently (treated as 1.0).
 * - §9.4.2: SendStreamingMessage answers SSE; each `data:` line is a
 *   JSON-RPC envelope whose `result` is a StreamResponse.
 * - §4.3: push notifications POST a StreamResponse to the client webhook.
 *
 * Task model: an A2A task (`otter-<injectionId>`) is backed by one entry
 * in the daemon's injection outbox (continuous-loop.ts). Otter state map:
 *   outbox pending   -> TASK_STATE_SUBMITTED
 *   outbox delivered -> TASK_STATE_WORKING (delivered to ChatGPT Web means
 *                          the agent has the prompt, NOT that work is done)
 *   outbox failed    -> TASK_STATE_FAILED
 * Terminal states are TASK_STATE_COMPLETED / FAILED / CANCELED / REJECTED.
 *
 * COMPLETION LIMIT (honest, not faked): a bare injection has no plan, so
 * its completion cannot be observed from the outbox alone — tasks/get
 * returns SUBMITTED/WORKING/FAILED from injection state in that case.
 * Completion IS wired when the caller passes a plan/loop through
 * SendMessage `metadata` (`{ planId, loopId }`): then tasks/get runs the
 * clean hooks — plan.ts `refreshPlanStatus` + `getPlanStatus`
 * (plan.status === "done") and loop-controller.ts `getLoopStatus`
 * (loop.status === "finished") — and reports TASK_STATE_COMPLETED.
 * Making completion observable for bare injections (e.g. detecting the
 * ChatGPT Web turn settling) is a follow-up, not guessed here.
 */
import * as crypto from "node:crypto";
import { getCorsHeaders, jsonResponse } from "./common";
import { getDatabase } from "../db";
import { getAuthToken } from "../security";
import { enqueueInjection, markInjectionFailed } from "../continuous-loop";
import { getPlanStatus, refreshPlanStatus } from "../plan";
import { getLoopStatus } from "../loop-controller";
import {
  A2A_ERROR_CODES,
  A2A_VERSION,
  isA2aTerminalState,
  type A2aAgentCard,
  type A2aSendMessageRequest,
  type A2aStreamResponse,
  type A2aTask,
  type A2aTaskState,
} from "../a2a-client";

import {
  sendInboxMessage,
  pullInbox,
  ackInboxMessage,
  cancelInboxMessage,
  getInboxMessage,
  listInboxMessages,
  getInboxStats,
  listBots,
  getBot,
  registerBot,
  updateBotPresence,
  type A2aMessageType,
  type BotPresenceStatus,
} from "../a2a-inbox";

type DbLike = ReturnType<typeof getDatabase>;

const OTTER_TASK_PREFIX = "otter-";
const STREAM_POLL_MS = 2000;
const STREAM_MAX_MS = 120_000;
const PUSH_TIMEOUT_MS = 10_000;
const LIST_DEFAULT_PAGE_SIZE = 50;
const LIST_MAX_PAGE_SIZE = 100;

const METHOD_ALIASES: Record<string, string> = {
  SendMessage: "SendMessage",
  "message/send": "SendMessage",
  SendStreamingMessage: "SendStreamingMessage",
  "message/stream": "SendStreamingMessage",
  GetTask: "GetTask",
  "tasks/get": "GetTask",
  ListTasks: "ListTasks",
  "tasks/list": "ListTasks",
  CancelTask: "CancelTask",
  "tasks/cancel": "CancelTask",
  AcknowledgeTask: "AcknowledgeTask",
  "tasks/ack": "AcknowledgeTask",
  SubscribeToTask: "SubscribeToTask",
  GetExtendedAgentCard: "GetExtendedAgentCard",
};

const VALID_TASK_STATES = new Set<string>([
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
]);

// ---------------------------------------------------------------------------
// a2a_tasks table (created lazily here; db.ts init is NOT modified)
// ---------------------------------------------------------------------------

interface A2aRow {
  id: string;
  refId: string;
  state: A2aTaskState;
  contextId: string | null;
  planId: string | null;
  loopId: string | null;
  pushUrl: string | null;
  pushToken: string | null;
  ackedAt: number | null;
  ackedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

function ensureA2aTables(db: DbLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS a2a_tasks (
      id TEXT PRIMARY KEY,
      ref_id TEXT NOT NULL,
      state TEXT NOT NULL,
      context_id TEXT,
      plan_id TEXT,
      loop_id TEXT,
      push_url TEXT,
      push_token TEXT,
      acked_at INTEGER,
      acked_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_created ON a2a_tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_a2a_tasks_state ON a2a_tasks(state, created_at);
  `);
  try { db.exec("ALTER TABLE a2a_tasks ADD COLUMN acked_at INTEGER"); } catch {}
  try { db.exec("ALTER TABLE a2a_tasks ADD COLUMN acked_by TEXT"); } catch {}
}

function rowToA2aRow(row: Record<string, unknown>): A2aRow {
  return {
    id: String(row.id),
    refId: String(row.ref_id),
    state: String(row.state) as A2aTaskState,
    contextId: row.context_id ? String(row.context_id) : null,
    planId: row.plan_id ? String(row.plan_id) : null,
    loopId: row.loop_id ? String(row.loop_id) : null,
    pushUrl: row.push_url ? String(row.push_url) : null,
    pushToken: row.push_token ? String(row.push_token) : null,
    ackedAt: row.acked_at !== null && row.acked_at !== undefined ? Number(row.acked_at) : null,
    ackedBy: row.acked_by ? String(row.acked_by) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function getA2aRow(db: DbLike, taskId: string): A2aRow | null {
  ensureA2aTables(db);
  const row = db.query("SELECT * FROM a2a_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  return row ? rowToA2aRow(row) : null;
}

function listA2aRows(db: DbLike): A2aRow[] {
  ensureA2aTables(db);
  const rows = db.query("SELECT * FROM a2a_tasks ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToA2aRow);
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: unknown, code: number, message: string, httpStatus = 200, data?: unknown): Response {
  const error: Record<string, unknown> = { code, message };
  if (data !== undefined) error.data = data;
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error }, { status: httpStatus });
}

function errorData(reason: string, metadata?: Record<string, unknown>): unknown {
  return [
    {
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason,
      domain: "a2a-protocol.org",
      metadata: { timestamp: new Date().toISOString(), ...(metadata ?? {}) },
    },
  ];
}

function isValidTaskIdFormat(taskId: unknown): taskId is string {
  return typeof taskId === "string" && taskId.startsWith(OTTER_TASK_PREFIX) && taskId.length > OTTER_TASK_PREFIX.length;
}

/** Strict Bearer check against the daemon's OTTER_API_KEY (security.ts). */
function isA2aAuthorized(req: Request): boolean {
  const expected = getAuthToken();
  if (!expected) return false; // No server token configured -> no Bearer can be valid.
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice(7).trim();
  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Agent Card
// ---------------------------------------------------------------------------

export function buildAgentCard(reqUrl: URL): A2aAgentCard {
  return {
    name: "Otter",
    description:
      "Otter — Agentic AI Desktop & Browser Controller. Accepts tasks over A2A and dispatches them to the ChatGPT Web coding loop via the injection outbox; task status tracks the outbox until the underlying plan/loop finishes.",
    version: "2.0.0",
    supportedInterfaces: [
      { url: `${reqUrl.origin}/a2a`, protocolBinding: "JSONRPC", protocolVersion: A2A_VERSION },
    ],
    provider: { organization: "Otter", url: "https://otter.gpt.io.vn" },
    capabilities: { streaming: true, pushNotifications: true },
    securitySchemes: {
      OTTER_API_KEY: {
        httpAuthSecurityScheme: {
          scheme: "Bearer",
          description: "Otter API key (OTTER_API_KEY) sent as Authorization: Bearer <key>.",
        },
      },
    },
    securityRequirements: [{ OTTER_API_KEY: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "dispatch-task",
        name: "Dispatch task",
        description:
          "Dispatch a task (plain-text goal) to Otter. The task is queued in the injection outbox and executed by the ChatGPT Web loop. Returns a Task in TASK_STATE_SUBMITTED; poll GetTask or stream SendStreamingMessage for progress.",
        tags: ["dispatch", "task", "coding-loop"],
        examples: ["Implement the login form for the dashboard", "Fix the failing unit test in plan.ts"],
      },
      {
        id: "task-status",
        name: "Task status",
        description:
          "Get the current status of a previously dispatched task (GetTask/ListTasks), or cancel it (CancelTask). States follow the A2A 1.0 lifecycle: submitted, working, completed, failed, canceled.",
        tags: ["task", "status", "cancel"],
        examples: ["What is the status of task otter-inj_...?", "Cancel my pending task"],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Task state resolution
// ---------------------------------------------------------------------------

function injectionState(db: DbLike, refId: string): "pending" | "delivered" | "failed" | null {
  try {
    const row = db.query("SELECT status FROM injection_outbox WHERE id = ?").get(refId) as
      | { status: string }
      | undefined;
    if (!row) return null;
    if (row.status === "pending" || row.status === "delivered" || row.status === "failed") return row.status;
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the current A2A state for a stored row.
 * Priority: stored terminal/canceled state wins (CancelTask is authoritative);
 * then the plan/loop completion hooks; then the injection outbox state.
 */
function resolveTaskState(db: DbLike, row: A2aRow): A2aTaskState {
  if (row.state === "TASK_STATE_CANCELED") return "TASK_STATE_CANCELED";
  if (isA2aTerminalState(row.state)) return row.state;

  // Completion hook (plan.ts): a plan whose tasks are all success/skipped
  // is promoted to done by refreshPlanStatus; a done plan means completed.
  if (row.planId) {
    try {
      refreshPlanStatus(db, row.planId);
      const view = getPlanStatus(db, row.planId);
      if (view.plan.status === "done") return "TASK_STATE_COMPLETED";
      if (view.plan.status === "failed") return "TASK_STATE_FAILED";
      if (view.plan.status === "cancelled") return "TASK_STATE_CANCELED";
    } catch {
      // Unknown planId (or plan deleted) — fall through to injection state.
    }
  }

  // Completion hook (loop-controller.ts): a finished loop means completed;
  // a blocked loop needs a human decision -> input_required; stopped -> canceled.
  if (row.loopId) {
    try {
      const loopView = getLoopStatus(db, row.loopId);
      if (loopView.loop.status === "finished") return "TASK_STATE_COMPLETED";
      if (loopView.loop.status === "blocked") return "TASK_STATE_INPUT_REQUIRED";
      if (loopView.loop.status === "stopped") return "TASK_STATE_CANCELED";
    } catch {
      // Unknown loopId — fall through to injection state.
    }
  }

  switch (injectionState(db, row.refId)) {
    case "pending":
      return "TASK_STATE_SUBMITTED";
    case "delivered":
      return "TASK_STATE_WORKING";
    case "failed":
      return "TASK_STATE_FAILED";
    default:
      return row.state; // Injection row gone (e.g. DB reset): keep last known state.
  }
}

function toTask(row: A2aRow, state: A2aTaskState): A2aTask {
  return {
    id: row.id,
    contextId: row.contextId ?? row.id,
    status: { state, timestamp: new Date(row.updatedAt).toISOString() },
    ...(row.ackedAt
      ? {
          metadata: {
            ack: {
              ackedAt: new Date(row.ackedAt).toISOString(),
              ackedBy: row.ackedBy ?? "otter",
            },
          },
        }
      : {}),
  };
}

/**
 * Re-resolve a task's state; if it changed, persist it and fire a push
 * notification (statusUpdate). Returns the fresh task + whether it changed.
 * Used by GetTask / streaming, i.e. the paths that observe transitions.
 */
function syncTaskState(db: DbLike, row: A2aRow): { task: A2aTask; changed: boolean } {
  const state = resolveTaskState(db, row);
  const changed = state !== row.state;
  if (changed) {
    const now = Date.now();
    db.run("UPDATE a2a_tasks SET state = ?, updated_at = ? WHERE id = ?", [state, now, row.id]);
    const updated: A2aRow = { ...row, state, updatedAt: now };
    const task = toTask(updated, state);
    void notifyPush(updated, { statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status, final: isA2aTerminalState(state) } });
    return { task, changed: true };
  }
  return { task: toTask(row, state), changed: false };
}

// ---------------------------------------------------------------------------
// Push notifications (§4.3): fire-and-forget, 10s timeout, never fails the
// original request. The webhook token is sent as a Bearer header and is
// never written to logs.
// ---------------------------------------------------------------------------

export async function notifyPush(row: A2aRow, event: A2aStreamResponse): Promise<void> {
  if (!row.pushUrl) return;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (row.pushToken) headers["Authorization"] = `Bearer ${row.pushToken}`;
    const res = await fetch(row.pushUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[A2A] Push notification to webhook failed for task ${row.id}: HTTP ${res.status}`);
  } catch (err: any) {
    console.warn(`[A2A] Push notification failed for task ${row.id}: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Message text extraction + task creation (shared by Send / SendStreaming)
// ---------------------------------------------------------------------------

function extractMessageText(message: any): string | null {
  if (!message || typeof message !== "object" || !Array.isArray(message.parts)) return null;
  const texts = message.parts
    .map((p: any) => (p && typeof p.text === "string" ? p.text : ""))
    .filter(Boolean);
  if (texts.length === 0) return null;
  return texts.join("\n");
}

function createTaskFromMessage(
  db: DbLike,
  params: A2aSendMessageRequest,
  rpcId: unknown,
): { task: A2aTask; row: A2aRow } | Response {
  const message: any = (params as any)?.message;
  const text = extractMessageText(message);
  if (text === null) {
    return rpcError(
      rpcId,
      A2A_ERROR_CODES.InvalidParams,
      "Invalid parameters: message.parts must contain at least one text part",
      200,
      errorData("INVALID_PARAMS", { field: "message.parts" }),
    );
  }

  const pushConfig: any = (params as any)?.configuration?.pushNotificationConfig;
  if (pushConfig !== undefined) {
    if (typeof pushConfig.url !== "string" || !/^https?:\/\//.test(pushConfig.url)) {
      return rpcError(
        rpcId,
        A2A_ERROR_CODES.InvalidParams,
        "Invalid parameters: configuration.pushNotificationConfig.url must be an http(s) URL",
        200,
        errorData("INVALID_PARAMS", { field: "configuration.pushNotificationConfig.url" }),
      );
    }
  }

  // Follow-up on an existing task: the task must exist and be non-terminal.
  const followUpTaskId: string | undefined =
    typeof message?.taskId === "string" ? message.taskId : undefined;
  let existing: A2aRow | null = null;
  if (followUpTaskId) {
    if (!isValidTaskIdFormat(followUpTaskId)) {
      return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${followUpTaskId}`, 200, errorData("TASK_NOT_FOUND", { taskId: followUpTaskId }));
    }
    existing = getA2aRow(db, followUpTaskId);
    if (!existing) {
      return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${followUpTaskId}`, 200, errorData("TASK_NOT_FOUND", { taskId: followUpTaskId }));
    }
    if (isA2aTerminalState(resolveTaskState(db, existing))) {
      return rpcError(
        rpcId,
        A2A_ERROR_CODES.UnsupportedOperation,
        `Task ${followUpTaskId} is in a terminal state and cannot accept further messages`,
        200,
        errorData("UNSUPPORTED_OPERATION", { taskId: followUpTaskId }),
      );
    }
  }

  const metadata: Record<string, unknown> = (params as any)?.metadata ?? {};
  const planId = typeof metadata.planId === "string" ? metadata.planId : null;
  const loopId = typeof metadata.loopId === "string" ? metadata.loopId : null;
  const contextId =
    typeof message?.contextId === "string" ? message.contextId : (existing?.contextId ?? crypto.randomUUID());

  // NOTE: enqueueInjection's real signature is { planId?, taskId?, loopId?,
  // text } — there is no { goal, details } form. The goal text goes in `text`.
  const entry = enqueueInjection(db, {
    planId,
    taskId: typeof metadata.taskId === "string" ? metadata.taskId : undefined,
    loopId,
    text,
  });

  const now = Date.now();
  const taskId = existing?.id ?? `${OTTER_TASK_PREFIX}${entry.id}`;
  ensureA2aTables(db);
  db.run(
    `INSERT INTO a2a_tasks (id, ref_id, state, context_id, plan_id, loop_id, push_url, push_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET ref_id = excluded.ref_id, state = excluded.state, updated_at = excluded.updated_at,
       push_url = COALESCE(excluded.push_url, a2a_tasks.push_url),
       push_token = COALESCE(excluded.push_token, a2a_tasks.push_token)`,
    [
      taskId,
      entry.id,
      "TASK_STATE_SUBMITTED",
      contextId,
      planId ?? existing?.planId ?? null,
      loopId ?? existing?.loopId ?? null,
      pushConfig?.url ?? null,
      pushConfig?.token ?? null,
      existing?.createdAt ?? now,
      now,
    ],
  );
  const row = getA2aRow(db, taskId)!;
  const task = toTask(row, "TASK_STATE_SUBMITTED");
  void notifyPush(row, { task });
  return { task, row };
}

// ---------------------------------------------------------------------------
// SSE streaming (shared by SendStreamingMessage / SubscribeToTask)
// ---------------------------------------------------------------------------

function sseStreamForTask(db: DbLike, row: A2aRow, rpcId: unknown, initialTask: A2aTask): Response {
  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<string> | undefined;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearInterval(timer);
    try {
      controller?.close();
    } catch {}
  };
  const send = (payload: unknown) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(`data: ${JSON.stringify({ jsonrpc: "2.0", id: rpcId ?? null, result: payload })}\n\n`);
    } catch {
      close();
    }
  };

  const stream = new ReadableStream<string>({
    start(c) {
      controller = c;
      // Track what THIS stream has already sent. State changes may be
      // persisted by other calls (e.g. CancelTask) before this stream's
      // next poll, so "changed since last poll" cannot be the emit
      // condition — "different from what this stream last sent" is.
      let lastSentState = initialTask.status.state;
      let lastSentAckedAt = row.ackedAt;
      send({ task: initialTask });
      const startedAt = Date.now();
      timer = setInterval(() => {
        try {
          const fresh = getA2aRow(db, row.id);
          if (!fresh) {
            send({ statusUpdate: { taskId: row.id, contextId: row.contextId ?? row.id, status: { state: "TASK_STATE_FAILED" as A2aTaskState, timestamp: new Date().toISOString() }, final: true } });
            close();
            return;
          }
          const { task } = syncTaskState(db, fresh);
          const ackChanged = fresh.ackedAt !== lastSentAckedAt;
          if (task.status.state !== lastSentState || ackChanged) {
            lastSentState = task.status.state;
            lastSentAckedAt = fresh.ackedAt;
            send({
              statusUpdate: {
                taskId: task.id,
                contextId: task.contextId,
                status: task.status,
                final: isA2aTerminalState(task.status.state),
                ...(task.metadata ? { metadata: task.metadata } : {}),
              } as any,
            });
          }
          if (isA2aTerminalState(task.status.state)) {
            close();
            return;
          }
          if (Date.now() - startedAt >= STREAM_MAX_MS) {
            // 120s cap: close with a non-final status update; the client
            // can resume with GetTask / SubscribeToTask.
            send({ statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status, final: false } });
            close();
          }
        } catch (err: any) {
          console.warn(`[A2A] Stream poll failed for task ${row.id}: ${err?.message ?? err}`);
          close();
        }
      }, STREAM_POLL_MS);
    },
    cancel() {
      // Client disconnected: stop polling immediately. No server state is
      // mutated on disconnect.
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...getCorsHeaders(),
    },
  });
}

// ---------------------------------------------------------------------------
// JSON-RPC method handlers
// ---------------------------------------------------------------------------

async function handleRpc(db: DbLike, req: Request, body: any): Promise<Response> {
  const rpcId = body?.id ?? null;

  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(rpcId, A2A_ERROR_CODES.InvalidRequest, "Request payload validation error", 400);
  }

  const canonical = METHOD_ALIASES[body.method];
  if (!canonical) {
    return rpcError(rpcId, A2A_ERROR_CODES.MethodNotFound, `Method not found: ${body.method}`, 200, errorData("METHOD_NOT_FOUND", { method: body.method }));
  }

  // Version negotiation (§9.2): an explicit unsupported version is refused.
  const version = req.headers.get("a2a-version");
  if (version && version !== A2A_VERSION) {
    return rpcError(
      rpcId,
      A2A_ERROR_CODES.VersionNotSupported,
      `Protocol version ${version} is not supported by this agent`,
      200,
      errorData("VERSION_NOT_SUPPORTED", { requestedVersion: version }),
    );
  }

  const params: any = body.params ?? {};

  switch (canonical) {
    case "SendMessage": {
      const created = createTaskFromMessage(db, params as A2aSendMessageRequest, rpcId);
      if (created instanceof Response) return created;
      return rpcResult(rpcId, { task: created.task });
    }

    case "SendStreamingMessage": {
      const created = createTaskFromMessage(db, params as A2aSendMessageRequest, rpcId);
      if (created instanceof Response) return created;
      return sseStreamForTask(db, created.row, rpcId, created.task);
    }

    case "GetTask": {
      const id = params?.id;
      if (!isValidTaskIdFormat(id)) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${String(id ?? "")}`, 200, errorData("TASK_NOT_FOUND", { taskId: String(id ?? "") }));
      }
      const row = getA2aRow(db, id);
      if (!row) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${id}`, 200, errorData("TASK_NOT_FOUND", { taskId: id }));
      }
      const { task } = syncTaskState(db, row);
      return rpcResult(rpcId, task);
    }

    case "ListTasks": {
      const statusFilter = params?.status;
      if (statusFilter !== undefined && (typeof statusFilter !== "string" || !VALID_TASK_STATES.has(statusFilter))) {
        return rpcError(rpcId, A2A_ERROR_CODES.InvalidParams, `Invalid parameters: status must be a valid TaskState`, 200, errorData("INVALID_PARAMS", { field: "status" }));
      }
      const pageSizeRaw = Number(params?.pageSize ?? LIST_DEFAULT_PAGE_SIZE);
      const pageSize = Number.isFinite(pageSizeRaw)
        ? Math.min(Math.max(1, Math.floor(pageSizeRaw)), LIST_MAX_PAGE_SIZE)
        : LIST_DEFAULT_PAGE_SIZE;
      const pageTokenRaw = params?.pageToken;
      let offset = 0;
      if (pageTokenRaw !== undefined) {
        const parsed = Number.parseInt(String(pageTokenRaw), 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return rpcError(rpcId, A2A_ERROR_CODES.InvalidParams, "Invalid parameters: pageToken must be a non-negative integer offset", 200, errorData("INVALID_PARAMS", { field: "pageToken" }));
        }
        offset = parsed;
      }
      // List is a read projection: derive states without persisting or
      // firing push notifications (GetTask/streaming own the sync).
      let rows = listA2aRows(db);
      if (typeof params?.contextId === "string") rows = rows.filter((r) => r.contextId === params.contextId);
      const tasks = rows.map((r) => toTask(r, resolveTaskState(db, r)));
      if (statusFilter) {
        const filtered = tasks.filter((t) => t.status.state === statusFilter);
        const totalSize = filtered.length;
        const page = filtered.slice(offset, offset + pageSize);
        return rpcResult(rpcId, {
          tasks: page,
          totalSize,
          pageSize,
          nextPageToken: offset + page.length < totalSize ? String(offset + page.length) : "",
        });
      }
      const totalSize = tasks.length;
      const page = tasks.slice(offset, offset + pageSize);
      return rpcResult(rpcId, {
        tasks: page,
        totalSize,
        pageSize,
        nextPageToken: offset + page.length < totalSize ? String(offset + page.length) : "",
      });
    }

    case "CancelTask": {
      const id = params?.id;
      if (!isValidTaskIdFormat(id)) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${String(id ?? "")}`, 200, errorData("TASK_NOT_FOUND", { taskId: String(id ?? "") }));
      }
      const row = getA2aRow(db, id);
      if (!row) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${id}`, 200, errorData("TASK_NOT_FOUND", { taskId: id }));
      }
      const current = resolveTaskState(db, row);
      if (isA2aTerminalState(current)) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotCancelable, `Task ${id} is in terminal state ${current} and cannot be canceled`, 200, errorData("TASK_NOT_CANCELABLE", { taskId: id }));
      }
      const now = Date.now();
      db.run("UPDATE a2a_tasks SET state = ?, updated_at = ? WHERE id = ?", ["TASK_STATE_CANCELED", now, id]);
      // Best effort: fail the still-pending outbox entry so the loop does
      // not deliver it later. tasks/get still reports CANCELED because the
      // stored a2a_tasks state takes priority over injection state.
      try {
        if (injectionState(db, row.refId) === "pending") markInjectionFailed(db, row.refId, "Canceled via A2A CancelTask");
      } catch {}
      const canceled: A2aRow = { ...row, state: "TASK_STATE_CANCELED", updatedAt: now };
      const task = toTask(canceled, "TASK_STATE_CANCELED");
      void notifyPush(canceled, { statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status, final: true } });
      return rpcResult(rpcId, task);
    }

    case "AcknowledgeTask": {
      const id = params?.id ?? params?.taskId;
      if (!isValidTaskIdFormat(id)) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${String(id ?? "")}`, 200, errorData("TASK_NOT_FOUND", { taskId: String(id ?? "") }));
      }
      const row = getA2aRow(db, id);
      if (!row) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${id}`, 200, errorData("TASK_NOT_FOUND", { taskId: id }));
      }
      const current = resolveTaskState(db, row);
      if (row.ackedAt) {
        return rpcResult(rpcId, toTask(row, current));
      }
      const now = Date.now();
      const ackedBy = typeof params?.ackedBy === "string" && params.ackedBy.trim() ? params.ackedBy.trim() : "otter";
      db.run("UPDATE a2a_tasks SET acked_at = ?, acked_by = ?, updated_at = ? WHERE id = ?", [now, ackedBy, now, id]);
      const ackedRow: A2aRow = { ...row, ackedAt: now, ackedBy, updatedAt: now };
      const task = toTask(ackedRow, current);
      void notifyPush(ackedRow, { statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status, final: false, ...(task.metadata ? { metadata: task.metadata } : {}) } as any });
      return rpcResult(rpcId, task);
    }

    case "SubscribeToTask": {
      const id = params?.id;
      if (!isValidTaskIdFormat(id)) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${String(id ?? "")}`, 200, errorData("TASK_NOT_FOUND", { taskId: String(id ?? "") }));
      }
      const row = getA2aRow(db, id);
      if (!row) {
        return rpcError(rpcId, A2A_ERROR_CODES.TaskNotFound, `Task not found: ${id}`, 200, errorData("TASK_NOT_FOUND", { taskId: id }));
      }
      const { task } = syncTaskState(db, row);
      if (isA2aTerminalState(task.status.state)) {
        return rpcError(
          rpcId,
          A2A_ERROR_CODES.UnsupportedOperation,
          `Task ${id} is in a terminal state and cannot be subscribed to`,
          200,
          errorData("UNSUPPORTED_OPERATION", { taskId: id }),
        );
      }
      return sseStreamForTask(db, row, rpcId, task);
    }

    case "GetExtendedAgentCard": {
      return rpcError(
        rpcId,
        A2A_ERROR_CODES.ExtendedAgentCardNotConfigured,
        "Extended Agent Card is not configured for this agent",
        200,
        errorData("EXTENDED_AGENT_CARD_NOT_CONFIGURED"),
      );
    }

    default:
      return rpcError(rpcId, A2A_ERROR_CODES.MethodNotFound, `Method not found: ${body.method}`, 200);
  }
}

// ---------------------------------------------------------------------------
// Route entry point (pattern: handleXRoutes(req, url, db?) -> Response | null)
// ---------------------------------------------------------------------------

export async function handleA2aRoutes(req: Request, url: URL, db?: DbLike): Promise<Response | null> {
  // Agent Card is public (no auth) — index.ts also lists this path in
  // isPublicPath so the global checkAuth gate lets it through.
  if (url.pathname === "/.well-known/agent-card.json" && req.method === "GET") {
    return jsonResponse(buildAgentCard(url), 200, {}, req);
  }

  if (url.pathname === "/a2a" && req.method === "POST") {
    const database = db ?? getDatabase();
    let body: any = null;
    try {
      body = await req.json();
    } catch {
      return rpcError(null, A2A_ERROR_CODES.ParseError, "Invalid JSON payload", 400);
    }

    // Every JSON-RPC method requires a valid Bearer OTTER_API_KEY.
    if (!isA2aAuthorized(req)) {
      return rpcError(body?.id ?? null, A2A_ERROR_CODES.Unauthorized, "Unauthorized: a valid Bearer OTTER_API_KEY token is required", 401);
    }

    try {
      return await handleRpc(database, req, body);
    } catch (err: any) {
      console.error("[A2A] Internal error:", err?.message ?? err);
      return rpcError(body?.id ?? null, A2A_ERROR_CODES.InternalError, "Internal error", 200);
    }
  }

  // --- A2A REST API Endpoints (Store-and-Forward Coordination) ---
  const database = db ?? getDatabase();

  // POST /api/a2a/send
  if (url.pathname === "/api/a2a/send" && req.method === "POST") {
    try {
      const body = (await req.json()) as any;
      if (!body.senderId || !body.recipientId || !body.goal) {
        return jsonResponse({ ok: false, error: "Missing required fields: senderId, recipientId, goal" }, 400, {}, req);
      }
      const msg = await sendInboxMessage(
        {
          senderId: body.senderId,
          recipientId: body.recipientId,
          goal: body.goal,
          details: body.details,
          messageType: body.messageType as A2aMessageType,
          priority: body.priority,
          payload: body.payload,
          artifacts: body.artifacts,
        },
        database
      );
      return jsonResponse({ ok: true, message: msg }, 201, {}, req);
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err.message }, 500, {}, req);
    }
  }

  // POST /api/a2a/pull
  if (url.pathname === "/api/a2a/pull" && req.method === "POST") {
    try {
      const body = (await req.json()) as any;
      if (!body.botId) {
        return jsonResponse({ ok: false, error: "Missing required field: botId" }, 400, {}, req);
      }
      const pulled = pullInbox(
        {
          recipientId: body.botId,
          workerId: body.workerId,
          limit: body.limit,
          leaseMs: body.leaseSeconds ? body.leaseSeconds * 1000 : undefined,
        },
        database
      );
      return jsonResponse({ ok: true, count: pulled.length, tasks: pulled }, 200, {}, req);
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err.message }, 500, {}, req);
    }
  }

  // POST /api/a2a/ack
  if (url.pathname === "/api/a2a/ack" && req.method === "POST") {
    try {
      const body = (await req.json()) as any;
      if (!body.messageId || !body.status) {
        return jsonResponse({ ok: false, error: "Missing required fields: messageId, status" }, 400, {}, req);
      }
      const res = ackInboxMessage(
        {
          messageId: body.messageId,
          workerId: body.workerId,
          status: body.status,
          resultSummary: body.resultSummary,
          result: body.result,
          artifacts: body.artifacts,
        },
        database
      );
      return jsonResponse(res, res.ok ? 200 : 400, {}, req);
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err.message }, 500, {}, req);
    }
  }

  // POST /api/a2a/cancel
  if (url.pathname === "/api/a2a/cancel" && req.method === "POST") {
    try {
      const body = (await req.json()) as any;
      if (!body.messageId) {
        return jsonResponse({ ok: false, error: "Missing required field: messageId" }, 400, {}, req);
      }
      const res = cancelInboxMessage(body.messageId, body.reason, database);
      return jsonResponse(res, res.ok ? 200 : 400, {}, req);
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err.message }, 500, {}, req);
    }
  }

  // GET /api/a2a/messages
  if (url.pathname === "/api/a2a/messages" && req.method === "GET") {
    const recipientId = url.searchParams.get("recipientId") || undefined;
    const senderId = url.searchParams.get("senderId") || undefined;
    const status = (url.searchParams.get("status") as any) || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const offset = url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : undefined;

    const messages = listInboxMessages({ recipientId, senderId, status, limit, offset }, database);
    return jsonResponse({ ok: true, count: messages.length, messages }, 200, {}, req);
  }

  // GET /api/a2a/messages/:id
  if (url.pathname.startsWith("/api/a2a/messages/") && req.method === "GET") {
    const id = url.pathname.slice("/api/a2a/messages/".length);
    const msg = getInboxMessage(id, database);
    if (!msg) {
      return jsonResponse({ ok: false, error: "Message not found" }, 404, {}, req);
    }
    return jsonResponse({ ok: true, message: msg }, 200, {}, req);
  }

  // GET /api/a2a/stats
  if (url.pathname === "/api/a2a/stats" && req.method === "GET") {
    const stats = getInboxStats(database);
    return jsonResponse({ ok: true, stats }, 200, {}, req);
  }

  // GET /api/a2a/bots
  if (url.pathname === "/api/a2a/bots" && req.method === "GET") {
    const bots = listBots(database);
    return jsonResponse({ ok: true, bots }, 200, {}, req);
  }

  // POST /api/a2a/bots
  if (url.pathname === "/api/a2a/bots" && req.method === "POST") {
    try {
      const body = (await req.json()) as any;
      if (!body.botId || !body.name) {
        return jsonResponse({ ok: false, error: "Missing required fields: botId, name" }, 400, {}, req);
      }
      const bot = registerBot(
        {
          botId: body.botId,
          name: body.name,
          description: body.description || "",
          capabilities: body.capabilities || [],
          preferredNode: body.preferredNode,
          status: body.status,
        },
        database
      );
      return jsonResponse({ ok: true, bot }, 200, {}, req);
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err.message }, 500, {}, req);
    }
  }

  return null;
}
