import { Database } from "bun:sqlite";
import { browserBridge } from "./browser-bridge";

export interface FbGroupTarget {
  id: string;
  name: string;
  url: string;
  topic?: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface FbGroupSchedule {
  id: string;
  mode: "preset" | "ai_generated";
  content: string;
  target_group_ids: string;
  scheduled_at: number;
  interval_seconds: number;
  status: "pending" | "running" | "completed" | "paused" | "cancelled" | "failed";
  created_at: number;
  started_at?: number;
  completed_at?: number;
}

export interface FbGroupQueueItem {
  id: string;
  schedule_id: string;
  target_group_id: string;
  group_url: string;
  group_name: string;
  content: string;
  scheduled_at: number;
  status: "pending" | "posting" | "posted" | "failed" | "skipped";
  error_message?: string;
  posted_at?: number;
  created_at: number;
}

/**
 * Thêm nhóm Facebook mục tiêu vào danh sách cài trước
 */
export function addGroupTarget(
  db: Database,
  input: { name: string; url: string; topic?: string }
): FbGroupTarget {
  const normUrl = input.url.trim().replace(/\/$/, "");
  const id = "grp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const now = Date.now();

  db.run(
    `INSERT INTO fb_group_targets (id, name, url, topic, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(url) DO UPDATE SET name = excluded.name, topic = excluded.topic, updated_at = excluded.updated_at`,
    [id, input.name.trim(), normUrl, input.topic?.trim() || null, now, now]
  );

  const row = db.query(`SELECT * FROM fb_group_targets WHERE url = ?`).get(normUrl) as FbGroupTarget;
  return row;
}

/**
 * Liệt kê danh sách nhóm Facebook
 */
export function listGroupTargets(db: Database, enabledOnly = false): FbGroupTarget[] {
  if (enabledOnly) {
    return db.query(`SELECT * FROM fb_group_targets WHERE enabled = 1 ORDER BY created_at DESC`).all() as FbGroupTarget[];
  }
  return db.query(`SELECT * FROM fb_group_targets ORDER BY created_at DESC`).all() as FbGroupTarget[];
}

/**
 * Xóa nhóm khỏi danh sách
 */
export function deleteGroupTarget(db: Database, targetId: string): boolean {
  const res = db.run(`DELETE FROM fb_group_targets WHERE id = ?`, [targetId]);
  return res.changes > 0;
}

/**
 * Sinh nội dung biến thể phù hợp theo từng chủ đề nhóm (khi dùng AI mode)
 */
export function generatePostForGroupTopic(topic: string | undefined, baseContent: string): string {
  if (!topic || topic.toLowerCase() === "chung" || topic.toLowerCase() === "general") {
    return baseContent;
  }
  // Thêm mở đầu ngữ cảnh tự nhiên phù hợp với chủ đề của nhóm
  const prefix = `[Góc ${topic}] `;
  if (!baseContent.startsWith("[Góc")) {
    return `${prefix}${baseContent}`;
  }
  return baseContent;
}

/**
 * Tạo lịch hẹn đăng bài lên nhiều nhóm
 * - Mode 'preset': 1 nội dung dùng chung cho tất cả các nhóm được chọn.
 * - Mode 'ai_generated': tự động biến tấu nội dung theo chủ đề từng nhóm.
 * - Giãn cách mặc định: 180s (3 phút) giữa các nhóm liên tiếp.
 */
export function createGroupSchedule(
  db: Database,
  input: {
    mode: "preset" | "ai_generated";
    content: string;
    targetGroupIds: string[];
    scheduledAt?: number;
    intervalSeconds?: number;
  }
): FbGroupSchedule {
  const now = Date.now();
  const startTime = input.scheduledAt && input.scheduledAt > now ? input.scheduledAt : now;
  const intervalSec = input.intervalSeconds && input.intervalSeconds >= 30 ? input.intervalSeconds : 180;
  const scheduleId = "sched-" + now + "-" + Math.random().toString(36).slice(2, 6);

  // Lấy thông tin các nhóm mục tiêu
  let targetGroups: FbGroupTarget[] = [];
  if (input.targetGroupIds.includes("*") || input.targetGroupIds.length === 0) {
    targetGroups = listGroupTargets(db, true);
  } else {
    const placeholders = input.targetGroupIds.map(() => "?").join(",");
    targetGroups = db.query(`SELECT * FROM fb_group_targets WHERE id IN (${placeholders}) AND enabled = 1`).all(...input.targetGroupIds) as FbGroupTarget[];
  }

  if (targetGroups.length === 0) {
    throw new Error("Không tìm thấy nhóm mục tiêu nào hợp lệ để lên lịch đăng bài.");
  }

  // 1. Tạo bản ghi lịch hẹn
  db.run(
    `INSERT INTO fb_group_schedules (id, mode, content, target_group_ids, scheduled_at, interval_seconds, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      scheduleId,
      input.mode,
      input.content,
      JSON.stringify(targetGroups.map(g => g.id)),
      startTime,
      intervalSec,
      now
    ]
  );

  // 2. Tạo các queue item cho từng nhóm với khoảng giãn cách intervalSeconds
  targetGroups.forEach((group, index) => {
    const queueId = "queue-" + now + "-" + index + "-" + Math.random().toString(36).slice(2, 6);
    const itemScheduledAt = startTime + index * intervalSec * 1000;
    const finalContent = input.mode === "ai_generated"
      ? generatePostForGroupTopic(group.topic, input.content)
      : input.content;

    db.run(
      `INSERT INTO fb_group_post_queue (id, schedule_id, target_group_id, group_url, group_name, content, scheduled_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        queueId,
        scheduleId,
        group.id,
        group.url,
        group.name,
        finalContent,
        itemScheduledAt,
        now
      ]
    );
  });

  return db.query(`SELECT * FROM fb_group_schedules WHERE id = ?`).get(scheduleId) as FbGroupSchedule;
}

/**
 * Liệt kê các lịch hẹn và hàng đợi chi tiết
 */
export function listGroupSchedules(db: Database): Array<FbGroupSchedule & { queue: FbGroupQueueItem[] }> {
  const schedules = db.query(`SELECT * FROM fb_group_schedules ORDER BY created_at DESC LIMIT 20`).all() as FbGroupSchedule[];
  return schedules.map(s => {
    const queue = db.query(`SELECT * FROM fb_group_post_queue WHERE schedule_id = ? ORDER BY scheduled_at ASC`).all(s.id) as FbGroupQueueItem[];
    return { ...s, queue };
  });
}

/**
 * Hủy một lịch hẹn và toàn bộ các hàng đợi pending
 */
export function cancelGroupSchedule(db: Database, scheduleId: string): boolean {
  const res = db.run(`UPDATE fb_group_schedules SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'running')`, [scheduleId]);
  db.run(`UPDATE fb_group_post_queue SET status = 'skipped', error_message = 'Lịch hẹn đã bị hủy bởi người dùng' WHERE schedule_id = ? AND status = 'pending'`, [scheduleId]);
  return res.changes > 0;
}

/**
 * Lấy item hàng đợi tiếp theo đã đến hạn (scheduled_at <= now)
 */
export function getNextPendingGroupQueueItem(db: Database): FbGroupQueueItem | null {
  const now = Date.now();
  const item = db.query(
    `SELECT * FROM fb_group_post_queue 
     WHERE status = 'pending' AND scheduled_at <= ? 
     ORDER BY scheduled_at ASC 
     LIMIT 1`
  ).get(now) as FbGroupQueueItem | null;
  return item;
}

/**
 * Cập nhật trạng thái item trong hàng đợi
 */
export function updateGroupQueueItemStatus(
  db: Database,
  itemId: string,
  status: "posted" | "failed" | "posting",
  errorMessage?: string
): void {
  const now = Date.now();
  if (status === "posted") {
    db.run(`UPDATE fb_group_post_queue SET status = 'posted', posted_at = ?, error_message = NULL WHERE id = ?`, [now, itemId]);
  } else if (status === "failed") {
    db.run(`UPDATE fb_group_post_queue SET status = 'failed', error_message = ? WHERE id = ?`, [errorMessage || "Lỗi không xác định", itemId]);
  } else {
    db.run(`UPDATE fb_group_post_queue SET status = 'posting' WHERE id = ?`, [itemId]);
  }

  // Cập nhật trạng thái tổng thể của schedule nếu toàn bộ queue item đã xong
  const item = db.query(`SELECT schedule_id FROM fb_group_post_queue WHERE id = ?`).get(itemId) as { schedule_id: string } | null;
  if (item) {
    const pendingCount = db.query(`SELECT COUNT(*) as count FROM fb_group_post_queue WHERE schedule_id = ? AND status IN ('pending', 'posting')`).get(item.schedule_id) as { count: number };
    if (pendingCount && pendingCount.count === 0) {
      db.run(`UPDATE fb_group_schedules SET status = 'completed', completed_at = ? WHERE id = ?`, [now, item.schedule_id]);
    } else {
      db.run(`UPDATE fb_group_schedules SET status = 'running' WHERE id = ? AND status = 'pending'`, [item.schedule_id]);
    }
  }
}

/**
 * Scheduler Tick: Kiểm tra hàng đợi đến giờ và gửi lệnh đăng bài qua extension
 */
export async function tickGroupPostScheduler(
  db: Database,
  onActivity?: (event: any) => void
): Promise<{ processed: boolean; item?: FbGroupQueueItem; error?: string }> {
  const item = getNextPendingGroupQueueItem(db);
  if (!item) {
    return { processed: false };
  }

  updateGroupQueueItemStatus(db, item.id, "posting");

  onActivity?.({
    type: "fb_group_post",
    action: "posting",
    groupName: item.group_name,
    groupUrl: item.group_url,
    queueId: item.id
  });

  try {
    const res: any = await browserBridge.execute("fb_post_to_group", {
      groupUrl: item.group_url,
      content: item.content
    }, 60000); // Cho phép tối đa 60s cho việc load trang, gõ và đăng bài

    if (res?.ok) {
      updateGroupQueueItemStatus(db, item.id, "posted");
      onActivity?.({
        type: "fb_group_post",
        action: "posted",
        groupName: item.group_name,
        queueId: item.id,
        verified: true
      });
      return { processed: true, item };
    } else {
      const err = res?.message || "Không thể xác nhận bài viết xuất hiện trên nhóm";
      updateGroupQueueItemStatus(db, item.id, "failed", err);
      onActivity?.({
        type: "fb_group_post",
        action: "failed",
        groupName: item.group_name,
        queueId: item.id,
        error: err
      });
      return { processed: true, item, error: err };
    }
  } catch (err: any) {
    const errorMsg = err.message || "Lỗi thực thi lệnh đăng nhóm";
    updateGroupQueueItemStatus(db, item.id, "failed", errorMsg);
    onActivity?.({
      type: "fb_group_post",
      action: "failed",
      groupName: item.group_name,
      queueId: item.id,
      error: errorMsg
    });
    return { processed: true, item, error: errorMsg };
  }
}

/**
 * Khởi động vòng lặp kiểm tra lịch hẹn tự động trong daemon
 */
export function startGroupPostSchedulerLoop(
  getDb: () => Database,
  onActivity?: (event: any) => void,
  intervalMs = 20000
): () => void {
  let isRunning = false;
  const timer = setInterval(async () => {
    if (isRunning) return;
    isRunning = true;
    try {
      const db = getDb();
      await tickGroupPostScheduler(db, onActivity);
    } catch {} finally {
      isRunning = false;
    }
  }, intervalMs);

  return () => clearInterval(timer);
}

