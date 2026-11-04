import { Database } from "bun:sqlite";
import { getDatabase } from "../db";

export interface ClockGuardResult {
  valid: boolean;
  reason?: string;
  lastSeen?: number;
  current?: number;
}

/**
 * Khởi tạo bảng system_clock_guard nếu chưa có
 */
export function ensureClockGuardTable(db: Database = getDatabase()): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS system_clock_guard (
      id TEXT PRIMARY KEY,
      last_seen INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

/**
 * Kiểm tra xem thời gian hệ thống có bị lùi về quá khứ (Clock Rollback) hay không.
 * Ngăn chặn người dùng chỉnh lùi đồng hồ máy tính để gian lận ngày hết hạn license.
 * 
 * @param currentTimestamp Mốc thời gian kiểm tra (mặc định Date.now())
 * @param toleranceMs Sai số cho phép do chênh lệch giây/đồng bộ mạng (mặc định 60,000ms = 1 phút)
 * @param db Database instance
 */
export function verifyClockIntegrity(
  currentTimestamp: number = Date.now(),
  toleranceMs: number = 60000,
  db: Database = getDatabase()
): ClockGuardResult {
  ensureClockGuardTable(db);

  const row = db.query(
    "SELECT last_seen, updated_at FROM system_clock_guard WHERE id = 'clock_tracker'"
  ).get() as { last_seen: number; updated_at: number } | null;

  if (row) {
    // Nếu thời gian hiện tại nhỏ hơn thời gian đã ghi nhận trước đó trừ đi khoảng sai số
    if (currentTimestamp < row.last_seen - toleranceMs) {
      return {
        valid: false,
        reason: `Phát hiện can thiệp thời gian hệ thống (Clock Rollback). Giờ hiện tại (${new Date(currentTimestamp).toISOString()}) nhỏ hơn mốc trước đó (${new Date(row.last_seen).toISOString()}). Vui lòng đồng bộ đúng giờ mạng.`,
        lastSeen: row.last_seen,
        current: currentTimestamp,
      };
    }
  }

  // Cập nhật mốc thời gian lớn nhất từng được ghi nhận
  const newMax = row ? Math.max(row.last_seen, currentTimestamp) : currentTimestamp;
  db.run(
    `INSERT INTO system_clock_guard (id, last_seen, updated_at) 
     VALUES ('clock_tracker', ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       last_seen = excluded.last_seen,
       updated_at = excluded.updated_at`,
    [newMax, currentTimestamp]
  );

  return { valid: true, lastSeen: newMax, current: currentTimestamp };
}

/**
 * Reset hoặc đặt lại timestamp cho mục đích kiểm thử tự động
 */
export function setClockGuardForTesting(timestamp: number, db: Database = getDatabase()): void {
  ensureClockGuardTable(db);
  db.run(
    `INSERT INTO system_clock_guard (id, last_seen, updated_at) 
     VALUES ('clock_tracker', ?, ?)
     ON CONFLICT(id) DO UPDATE SET 
       last_seen = excluded.last_seen,
       updated_at = excluded.updated_at`,
    [timestamp, timestamp]
  );
}
