/**
 * Page-loop leases — Phase 2 + 7 của plan nâng cấp từ codex-web.
 * Một tab = một lease đang chạy; tối đa 5 lease/daemon (mặc định,
 * cấu hình được); lease stale khi quá hạn heartbeat.
 * Logic thuần SQLite, không phụ thuộc MCP/Zod.
 */
import * as crypto from "node:crypto";

export const PAGE_LOOP_MAX_LEASES = 5;
export const PAGE_LOOP_LEASE_STALE_MS = 120_000;

export type LeaseStatus = "active" | "stale" | "released";

export interface PageLoopLease {
  id: string;
  loopId: string;
  tabId: string;
  conversationId: string;
  status: LeaseStatus;
  heartbeatAt: number;
  createdAt: number;
  updatedAt: number;
}

type DbLike = {
  run: (sql: string, ...params: any[]) => unknown;
  query: (sql: string) => { get: (...params: any[]) => unknown; all: (...params: any[]) => unknown[] };
};

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function rowToLease(row: Record<string, unknown>): PageLoopLease {
  return {
    id: String(row.id),
    loopId: String(row.loop_id),
    tabId: String(row.tab_id),
    conversationId: String(row.conversation_id),
    status: row.status as LeaseStatus,
    heartbeatAt: Number(row.heartbeat_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function countActiveLeases(db: DbLike): number {
  const row = db.query("SELECT COUNT(*) AS n FROM page_loop_leases WHERE status = 'active'").get() as { n: number };
  return Number(row.n);
}

export function listLeases(db: DbLike): PageLoopLease[] {
  const rows = db.query("SELECT * FROM page_loop_leases ORDER BY created_at DESC LIMIT 50").all() as Record<string, unknown>[];
  return rows.map(rowToLease);
}

export function getLeaseForLoop(db: DbLike, loopId: string): PageLoopLease | null {
  const row = db.query("SELECT * FROM page_loop_leases WHERE loop_id = ? ORDER BY created_at DESC LIMIT 1").get(loopId) as Record<string, unknown> | undefined;
  return row ? rowToLease(row) : null;
}

export function createLease(db: DbLike, input: { loopId: string; tabId?: string; conversationId?: string; maxLeases?: number }): PageLoopLease {
  const max = input.maxLeases ?? PAGE_LOOP_MAX_LEASES;
  if (countActiveLeases(db) >= max) {
    throw new Error(`Đã đủ ${max} lease page-loop đang chạy trên daemon này. Đợi một lease trống rồi bấm Start lại — không xếp hàng ngầm.`);
  }
  if (input.tabId) {
    const clash = db.query("SELECT * FROM page_loop_leases WHERE tab_id = ? AND status = 'active' LIMIT 1").get(input.tabId) as Record<string, unknown> | undefined;
    if (clash) throw new Error(`Tab này đã có một phiên page-loop đang chạy (loop ${clash.loop_id}). Dừng phiên đó trước khi Start phiên mới.`);
  }
  const now = Date.now();
  const lease: PageLoopLease = {
    id: newId("lease"),
    loopId: input.loopId,
    tabId: input.tabId || "unbound",
    conversationId: input.conversationId || "chatgpt-web",
    status: "active",
    heartbeatAt: now,
    createdAt: now,
    updatedAt: now,
  };
  db.run("INSERT INTO page_loop_leases (id, loop_id, tab_id, conversation_id, status, heartbeat_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
    [lease.id, lease.loopId, lease.tabId, lease.conversationId, lease.heartbeatAt, lease.createdAt, lease.updatedAt]);
  return lease;
}

export function touchLease(db: DbLike, input: { leaseId?: string; loopId?: string; tabId?: string }): PageLoopLease | null {
  let row: Record<string, unknown> | undefined;
  if (input.leaseId) row = db.query("SELECT * FROM page_loop_leases WHERE id = ?").get(input.leaseId) as Record<string, unknown> | undefined;
  else if (input.loopId) row = db.query("SELECT * FROM page_loop_leases WHERE loop_id = ? ORDER BY created_at DESC LIMIT 1").get(input.loopId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const now = Date.now();
  const tabId = input.tabId || String(row.tab_id);
  db.run("UPDATE page_loop_leases SET heartbeat_at = ?, tab_id = ?, updated_at = ?, status = 'active' WHERE id = ?", [now, tabId, now, String(row.id)]);
  return { ...rowToLease(row), heartbeatAt: now, tabId, updatedAt: now, status: "active" };
}

export function releaseLease(db: DbLike, loopId: string): void {
  db.run("UPDATE page_loop_leases SET status = 'released', updated_at = ? WHERE loop_id = ? AND status IN ('active', 'stale')", [Date.now(), loopId]);
}

export function markStaleLeases(db: DbLike, now = Date.now()): number {
  const rows = db.query("SELECT * FROM page_loop_leases WHERE status = 'active'").all() as Record<string, unknown>[];
  let n = 0;
  for (const row of rows) {
    if (now - Number(row.heartbeat_at) > PAGE_LOOP_LEASE_STALE_MS) {
      db.run("UPDATE page_loop_leases SET status = 'stale', updated_at = ? WHERE id = ?", [now, String(row.id)]);
      n++;
    }
  }
  return n;
}

export function isLeaseStale(lease: PageLoopLease, now = Date.now()): boolean {
  return lease.status === "stale" || now - lease.heartbeatAt > PAGE_LOOP_LEASE_STALE_MS;
}
