/**
 * A2A Store-and-Forward Inbox Engine
 * 
 * Part of Otter Agent-to-Agent Coordination (Phase 1).
 * Replaces brittle file-based polling (/home/nam/muse-shared/inbox/) and MXH tasks
 * with an SQLite-backed durable store-and-forward message and task queue.
 * 
 * Features:
 * - Guaranteed offline durability (tasks wait safely until recipient pulls or wakes up)
 * - Lease lock mechanism (lease_until) to auto-reclaim stuck or crashed in-flight tasks
 * - Priority queuing (higher priority delivered first)
 * - Bot identity registry (mapping bots to capabilities and presence)
 * - EventEmitter for live mirroring to MXH Group 503 and Otter Dashboard
 */

import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { getDatabase } from "./db";

export type A2aMessageStatus = "queued" | "in_flight" | "acked" | "failed" | "cancelled";
export type A2aMessageType = "task" | "message" | "query" | "ack";
export type BotPresenceStatus = "online" | "busy" | "idle" | "offline";

export interface A2aArtifactPayload {
  name?: string;
  mimeType?: string;
  uri?: string;
  bytes?: string;
  metadata?: Record<string, unknown>;
}

export interface A2aInboxMessage {
  id: string;
  senderId: string;
  recipientId: string;
  messageType: A2aMessageType;
  goal: string;
  details?: string | null;
  payload?: Record<string, unknown> | null;
  artifacts?: A2aArtifactPayload[] | null;
  priority: number;
  status: A2aMessageStatus;
  leaseOwner?: string | null;
  leaseUntil?: number | null;
  attemptCount: number;
  maxAttempts: number;
  resultSummary?: string | null;
  result?: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface BotIdentity {
  botId: string;
  name: string;
  description: string;
  capabilities: string[];
  preferredNode?: string | null;
  status: BotPresenceStatus;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface SendInboxMessageParams {
  senderId: string;
  recipientId: string;
  goal: string;
  messageType?: A2aMessageType;
  details?: string;
  payload?: Record<string, unknown>;
  artifacts?: A2aArtifactPayload[];
  priority?: number;
  maxAttempts?: number;
}

export interface PullInboxParams {
  recipientId: string;
  workerId?: string;
  limit?: number;
  leaseMs?: number;
}

export interface AckInboxMessageParams {
  messageId: string;
  workerId?: string;
  status: "acked" | "failed";
  resultSummary?: string;
  result?: Record<string, unknown>;
  artifacts?: A2aArtifactPayload[];
}

export const a2aInboxEvents = new EventEmitter();

type DbLike = ReturnType<typeof getDatabase>;

const initializedDbs = new WeakSet<any>();

export function ensureA2aInboxTables(db: DbLike = getDatabase()): void {
  if (initializedDbs.has(db as any)) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS a2a_inbox_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'task',
      goal TEXT NOT NULL,
      details TEXT,
      payload_json TEXT,
      artifacts_json TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      lease_owner TEXT,
      lease_until INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      result_summary TEXT,
      result_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_a2a_inbox_recipient ON a2a_inbox_messages(recipient_id, status, priority DESC, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_a2a_inbox_sender ON a2a_inbox_messages(sender_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_a2a_inbox_lease ON a2a_inbox_messages(status, lease_until);

    CREATE TABLE IF NOT EXISTS a2a_bots (
      bot_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      capabilities_json TEXT,
      preferred_node TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Bootstrap default bot identities if empty
  const countRow = db.query("SELECT COUNT(*) as count FROM a2a_bots").get() as { count: number } | null;
  if (!countRow || countRow.count === 0) {
    const now = Date.now();
    const defaultBots: Omit<BotIdentity, "createdAt" | "updatedAt" | "lastSeenAt">[] = [
      {
        botId: "ai_antigravity",
        name: "Antigravity (Anti)",
        description: "Primary coding, system automation, and debugging agent on Windows / IDE.",
        capabilities: ["code", "terminal", "cdp", "cua", "video", "gsap", "mcp"],
        preferredNode: "nam-windows",
        status: "online",
      },
      {
        botId: "ai_sunny",
        name: "Sunny (Muse)",
        description: "Planning, architecture, creative direction, and autonomous coordinator.",
        capabilities: ["planning", "coordination", "video", "content", "review"],
        preferredNode: "nam-linux",
        status: "online",
      },
      {
        botId: "ai_muse002",
        name: "Muse Worker 002",
        description: "Social media and browser automation worker.",
        capabilities: ["browser", "facebook", "telegram", "social"],
        preferredNode: "nam-linux",
        status: "online",
      },
      {
        botId: "ai_muse003",
        name: "Muse Worker 003",
        description: "Media processing and distributed task execution worker.",
        capabilities: ["media", "video", "processing", "worker"],
        preferredNode: "hatch-vm",
        status: "online",
      },
      {
        botId: "user_pham",
        name: "Pham Thanh Nam",
        description: "Human Operator / Project Owner.",
        capabilities: ["admin", "decision", "supervisor"],
        preferredNode: "nam-windows",
        status: "online",
      },
    ];

    const insertBot = db.query(`
      INSERT INTO a2a_bots (bot_id, name, description, capabilities_json, preferred_node, status, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const b of defaultBots) {
      insertBot.run(
        b.botId,
        b.name,
        b.description,
        JSON.stringify(b.capabilities),
        b.preferredNode || null,
        b.status,
        now,
        now,
        now
      );
    }
  }

  initializedDbs.add(db as any);
}

function parseJsonSafe<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function rowToMessage(row: Record<string, unknown>): A2aInboxMessage {
  return {
    id: String(row.id),
    senderId: String(row.sender_id),
    recipientId: String(row.recipient_id),
    messageType: (row.message_type as A2aMessageType) || "task",
    goal: String(row.goal),
    details: row.details ? String(row.details) : null,
    payload: parseJsonSafe<Record<string, unknown> | null>(row.payload_json as string, null),
    artifacts: parseJsonSafe<A2aArtifactPayload[] | null>(row.artifacts_json as string, null),
    priority: Number(row.priority || 0),
    status: (row.status as A2aMessageStatus) || "queued",
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseUntil: row.lease_until ? Number(row.lease_until) : null,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 3),
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    result: parseJsonSafe<Record<string, unknown> | null>(row.result_json as string, null),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToBot(row: Record<string, unknown>): BotIdentity {
  return {
    botId: String(row.bot_id),
    name: String(row.name),
    description: String(row.description || ""),
    capabilities: parseJsonSafe<string[]>(row.capabilities_json as string, []),
    preferredNode: row.preferred_node ? String(row.preferred_node) : null,
    status: (row.status as BotPresenceStatus) || "offline",
    lastSeenAt: Number(row.last_seen_at || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Reclaims expired leases.
 * If an in_flight task exceeded its lease_until time, reset to 'queued' or 'failed' if maxAttempts exceeded.
 */
export function reclaimExpiredLeases(db: DbLike = getDatabase()): number {
  ensureA2aInboxTables(db);
  const now = Date.now();

  const expiredRows = db.query(`
    SELECT id, attempt_count, max_attempts FROM a2a_inbox_messages
    WHERE status = 'in_flight' AND lease_until IS NOT NULL AND lease_until < ?
  `).all(now) as { id: string; attempt_count: number; max_attempts: number }[];

  let reclaimedCount = 0;
  for (const r of expiredRows) {
    if (r.attempt_count >= r.max_attempts) {
      db.run(`
        UPDATE a2a_inbox_messages
        SET status = 'failed', result_summary = 'Task lease expired and exceeded max retry attempts', updated_at = ?
        WHERE id = ?
      `, [now, r.id]);
      a2aInboxEvents.emit("message_failed", { id: r.id, reason: "lease_expired_max_attempts" });
    } else {
      db.run(`
        UPDATE a2a_inbox_messages
        SET status = 'queued', lease_owner = NULL, lease_until = NULL, updated_at = ?
        WHERE id = ?
      `, [now, r.id]);
      a2aInboxEvents.emit("message_requeued", { id: r.id, reason: "lease_expired" });
    }
    reclaimedCount++;
  }

  return reclaimedCount;
}

/**
 * Sends a task or message into the recipient's inbox.
 * Stored safely in SQLite; survives recipient offline/sleep.
 */
export async function sendInboxMessage(
  params: SendInboxMessageParams,
  db: DbLike = getDatabase()
): Promise<A2aInboxMessage> {
  ensureA2aInboxTables(db);
  const now = Date.now();
  const id = `msg_${now}_${crypto.randomBytes(4).toString("hex")}`;

  const messageType = params.messageType || "task";
  const priority = params.priority ?? 0;
  const maxAttempts = params.maxAttempts ?? 3;
  const payloadJson = params.payload ? JSON.stringify(params.payload) : null;
  const artifactsJson = params.artifacts ? JSON.stringify(params.artifacts) : null;

  db.run(`
    INSERT INTO a2a_inbox_messages (
      id, sender_id, recipient_id, message_type, goal, details,
      payload_json, artifacts_json, priority, status, lease_owner,
      lease_until, attempt_count, max_attempts, result_summary,
      result_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, NULL, 0, ?, NULL, NULL, ?, ?)
  `, [
    id,
    params.senderId,
    params.recipientId,
    messageType,
    params.goal,
    params.details || null,
    payloadJson,
    artifactsJson,
    priority,
    maxAttempts,
    now,
    now,
  ]);

  const msg = getInboxMessage(id, db)!;

  // Update sender last seen
  updateBotPresence(params.senderId, "online", db);

  a2aInboxEvents.emit("message_sent", msg);
  return msg;
}

/**
 * Pulls pending tasks for a given recipient bot.
 * Atomically marks pulled tasks as 'in_flight' with a lease lock.
 */
export function pullInbox(
  params: PullInboxParams,
  db: DbLike = getDatabase()
): A2aInboxMessage[] {
  ensureA2aInboxTables(db);
  reclaimExpiredLeases(db);

  const now = Date.now();
  const limit = Math.max(1, Math.min(params.limit || 5, 50));
  const leaseMs = Math.max(10_000, params.leaseMs || 300_000); // default 5 minutes
  const leaseUntil = now + leaseMs;
  const workerId = params.workerId || params.recipientId;

  // Update recipient last seen
  updateBotPresence(params.recipientId, "online", db);

  // Fetch pending candidates
  const rows = db.query(`
    SELECT * FROM a2a_inbox_messages
    WHERE recipient_id = ? AND status = 'queued'
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `).all(params.recipientId, limit) as Record<string, unknown>[];

  const pulled: A2aInboxMessage[] = [];

  for (const r of rows) {
    const id = String(r.id);
    db.run(`
      UPDATE a2a_inbox_messages
      SET status = 'in_flight',
          lease_owner = ?,
          lease_until = ?,
          attempt_count = attempt_count + 1,
          updated_at = ?
      WHERE id = ? AND status = 'queued'
    `, [workerId, leaseUntil, now, id]);

    const updated = getInboxMessage(id, db);
    if (updated && updated.status === "in_flight") {
      pulled.push(updated);
      a2aInboxEvents.emit("message_pulled", { message: updated, workerId });
    }
  }

  return pulled;
}

/**
 * Acknowledges a task when completed or failed.
 */
export function ackInboxMessage(
  params: AckInboxMessageParams,
  db: DbLike = getDatabase()
): { ok: boolean; message: string; task?: A2aInboxMessage } {
  ensureA2aInboxTables(db);
  const now = Date.now();

  const existing = getInboxMessage(params.messageId, db);
  if (!existing) {
    return { ok: false, message: `Không tìm thấy message với id: ${params.messageId}` };
  }

  const resultJson = params.result ? JSON.stringify(params.result) : null;
  const artifactsJson = params.artifacts ? JSON.stringify(params.artifacts) : null;

  db.run(`
    UPDATE a2a_inbox_messages
    SET status = ?,
        result_summary = ?,
        result_json = COALESCE(?, result_json),
        artifacts_json = COALESCE(?, artifacts_json),
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = ?
    WHERE id = ?
  `, [
    params.status,
    params.resultSummary || (params.status === "acked" ? "Hoàn thành thành công" : "Thực thi thất bại"),
    resultJson,
    artifactsJson,
    now,
    params.messageId,
  ]);

  const updated = getInboxMessage(params.messageId, db)!;
  a2aInboxEvents.emit("message_acked", { message: updated, workerId: params.workerId });

  return { ok: true, message: `Đã cập nhật trạng thái ${params.status}`, task: updated };
}

/**
 * Cancels a task by ID.
 */
export function cancelInboxMessage(
  messageId: string,
  reason: string = "cancelled",
  db: DbLike = getDatabase()
): { ok: boolean; message: string } {
  ensureA2aInboxTables(db);
  const now = Date.now();

  const existing = getInboxMessage(messageId, db);
  if (!existing) {
    return { ok: false, message: `Không tìm thấy message với id: ${messageId}` };
  }

  if (existing.status === "acked") {
    return { ok: false, message: "Task đã hoàn thành, không thể hủy." };
  }

  db.run(`
    UPDATE a2a_inbox_messages
    SET status = 'cancelled',
        result_summary = ?,
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = ?
    WHERE id = ?
  `, [`Hủy bỏ: ${reason}`, now, messageId]);

  const updated = getInboxMessage(messageId, db)!;
  a2aInboxEvents.emit("message_cancelled", { message: updated, reason });

  return { ok: true, message: "Đã hủy task thành công" };
}

export function getInboxMessage(
  messageId: string,
  db: DbLike = getDatabase()
): A2aInboxMessage | null {
  ensureA2aInboxTables(db);
  const row = db.query(`SELECT * FROM a2a_inbox_messages WHERE id = ?`).get(messageId) as Record<string, unknown> | null;
  return row ? rowToMessage(row) : null;
}

export function listInboxMessages(
  options: {
    recipientId?: string;
    senderId?: string;
    status?: A2aMessageStatus;
    limit?: number;
    offset?: number;
  } = {},
  db: DbLike = getDatabase()
): A2aInboxMessage[] {
  ensureA2aInboxTables(db);
  reclaimExpiredLeases(db);

  const clauses: string[] = [];
  const params: any[] = [];

  if (options.recipientId) {
    clauses.push("recipient_id = ?");
    params.push(options.recipientId);
  }
  if (options.senderId) {
    clauses.push("sender_id = ?");
    params.push(options.senderId);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(options.limit || 50, 200));
  const offset = Math.max(0, options.offset || 0);

  const query = `
    SELECT * FROM a2a_inbox_messages
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const rows = db.query(query).all(...params) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function getInboxStats(
  db: DbLike = getDatabase()
): { queued: number; inFlight: number; acked: number; failed: number; total: number } {
  ensureA2aInboxTables(db);
  reclaimExpiredLeases(db);

  const rows = db.query(`
    SELECT status, COUNT(*) as count FROM a2a_inbox_messages GROUP BY status
  `).all() as { status: string; count: number }[];

  const stats = { queued: 0, inFlight: 0, acked: 0, failed: 0, total: 0 };
  for (const r of rows) {
    if (r.status === "queued") stats.queued = Number(r.count);
    else if (r.status === "in_flight") stats.inFlight = Number(r.count);
    else if (r.status === "acked") stats.acked = Number(r.count);
    else if (r.status === "failed") stats.failed = Number(r.count);
    stats.total += Number(r.count);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Bot Identity Registry
// ---------------------------------------------------------------------------

export function listBots(db: DbLike = getDatabase()): BotIdentity[] {
  ensureA2aInboxTables(db);
  const rows = db.query(`SELECT * FROM a2a_bots ORDER BY name ASC`).all() as Record<string, unknown>[];
  return rows.map(rowToBot);
}

export function getBot(botId: string, db: DbLike = getDatabase()): BotIdentity | null {
  ensureA2aInboxTables(db);
  const row = db.query(`SELECT * FROM a2a_bots WHERE bot_id = ?`).get(botId) as Record<string, unknown> | null;
  return row ? rowToBot(row) : null;
}

export function registerBot(
  bot: Omit<BotIdentity, "createdAt" | "updatedAt" | "lastSeenAt"> & { status?: BotPresenceStatus },
  db: DbLike = getDatabase()
): BotIdentity {
  ensureA2aInboxTables(db);
  const now = Date.now();
  const status = bot.status || "online";

  db.run(`
    INSERT INTO a2a_bots (bot_id, name, description, capabilities_json, preferred_node, status, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      capabilities_json = excluded.capabilities_json,
      preferred_node = COALESCE(excluded.preferred_node, a2a_bots.preferred_node),
      status = excluded.status,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `, [
    bot.botId,
    bot.name,
    bot.description,
    JSON.stringify(bot.capabilities),
    bot.preferredNode || null,
    status,
    now,
    now,
    now,
  ]);

  return getBot(bot.botId, db)!;
}

export function updateBotPresence(
  botId: string,
  status: BotPresenceStatus,
  db: DbLike = getDatabase()
): void {
  ensureA2aInboxTables(db);
  const now = Date.now();
  db.run(`
    UPDATE a2a_bots
    SET status = ?, last_seen_at = ?, updated_at = ?
    WHERE bot_id = ?
  `, [status, now, now, botId]);
}

export function deleteBot(botId: string, db: DbLike = getDatabase()): boolean {
  ensureA2aInboxTables(db);
  const res = db.run(`DELETE FROM a2a_bots WHERE bot_id = ?`, [botId]);
  return ((res as any)?.changes || 0) > 0;
}
