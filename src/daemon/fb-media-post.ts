import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { browserBridge } from "./browser-bridge";

export type FbTargetType = "profile" | "group" | "page";
export type FbMediaType = "video" | "image" | "none";
export type FbMediaPostStatus = "pending" | "uploading" | "posted" | "failed" | "cancelled";
export type FbMediaSource = "folder" | "list" | "muse" | "manual";

export interface FbMediaPostItem {
  id: string;
  target_type: FbTargetType;
  target_url: string;
  target_name?: string;
  media_path?: string;
  media_type: FbMediaType;
  caption: string;
  scheduled_at: number;
  interval_seconds: number;
  status: FbMediaPostStatus;
  error_message?: string;
  posted_at?: number;
  source: FbMediaSource;
  created_at: number;
}

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"]);

/**
 * Tự động nhận diện loại tệp media từ phần mở rộng
 */
export function detectMediaType(filePath?: string): FbMediaType {
  if (!filePath) return "none";
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "none";
}

/**
 * Chuẩn hóa URL theo từng đích đăng bài
 */
export function normalizeTargetUrl(targetType: FbTargetType, targetUrl?: string): string {
  const trimmed = (targetUrl || "").trim().replace(/\/$/, "");
  if (!trimmed) {
    if (targetType === "profile") return "https://www.facebook.com/";
    if (targetType === "group") return "https://www.facebook.com/groups/feed/";
    return "https://www.facebook.com/";
  }
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

/**
 * Thêm 1 bài viết media vào hàng đợi
 */
export function addMediaPostItem(
  db: Database,
  input: {
    targetType: FbTargetType;
    targetUrl?: string;
    targetName?: string;
    mediaPath?: string;
    caption: string;
    scheduledAt?: number;
    intervalSeconds?: number;
    source?: FbMediaSource;
  }
): FbMediaPostItem {
  const id = "fmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const scheduledAt = input.scheduledAt || now;
  const intervalSeconds = input.intervalSeconds || 180;
  const targetUrl = normalizeTargetUrl(input.targetType, input.targetUrl);
  const mediaType = detectMediaType(input.mediaPath);
  const source = input.source || "manual";

  db.run(
    `INSERT INTO fb_media_posts (
      id, target_type, target_url, target_name, media_path, media_type, caption,
      scheduled_at, interval_seconds, status, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      id,
      input.targetType,
      targetUrl,
      input.targetName?.trim() || null,
      input.mediaPath ? path.resolve(input.mediaPath) : null,
      mediaType,
      input.caption.trim(),
      scheduledAt,
      intervalSeconds,
      source,
      now
    ]
  );

  return db.query(`SELECT * FROM fb_media_posts WHERE id = ?`).get(id) as FbMediaPostItem;
}

/**
 * Cách A: Quét thư mục máy tính, lấy toàn bộ video/ảnh và lập lịch đăng lần lượt từng bài
 */
export async function queueMediaFromFolder(
  db: Database,
  input: {
    folderPath: string;
    targetType: FbTargetType;
    targetUrl?: string;
    targetName?: string;
    defaultCaption?: string;
    intervalMinutes?: number;
    sortBy?: "name" | "time" | "random";
  }
): Promise<{ total: number; items: FbMediaPostItem[] }> {
  const resolvedDir = path.resolve(input.folderPath);
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

  const mediaFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext)) {
        mediaFiles.push(path.join(resolvedDir, entry.name));
      }
    }
  }

  if (input.sortBy === "time") {
    // Sắp xếp theo ngày sửa đổi mới nhất
    const stats = await Promise.all(mediaFiles.map(async (f) => ({ f, stat: await fs.stat(f) })));
    stats.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
    mediaFiles.length = 0;
    mediaFiles.push(...stats.map((s) => s.f));
  } else if (input.sortBy === "random") {
    mediaFiles.sort(() => Math.random() - 0.5);
  } else {
    // Mặc định sắp xếp theo tên file tự nhiên (A-Z)
    mediaFiles.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: "base" }));
  }

  const intervalSec = (input.intervalMinutes || 3) * 60;
  const now = Date.now();
  const queuedItems: FbMediaPostItem[] = [];

  for (let i = 0; i < mediaFiles.length; i++) {
    const file = mediaFiles[i];
    const baseName = path.basename(file, path.extname(file));
    let caption = input.defaultCaption || "{filename}";
    caption = caption.replace(/\{filename\}/g, baseName);

    const scheduledAt = now + (i * intervalSec * 1000);

    const item = addMediaPostItem(db, {
      targetType: input.targetType,
      targetUrl: input.targetUrl,
      targetName: input.targetName || (input.targetType === "profile" ? "Trang cá nhân" : baseName),
      mediaPath: file,
      caption,
      scheduledAt,
      intervalSeconds: intervalSec,
      source: "folder"
    });

    queuedItems.push(item);
  }

  return { total: queuedItems.length, items: queuedItems };
}

/**
 * Cách B: Nạp mảng danh sách bài viết media cụ thể vào hàng đợi
 */
export function queueMediaFromList(
  db: Database,
  input: {
    items: Array<{
      targetType?: FbTargetType;
      targetUrl?: string;
      targetName?: string;
      mediaPath?: string;
      caption: string;
      scheduledAt?: number;
    }>;
    defaultTargetType?: FbTargetType;
    defaultTargetUrl?: string;
    intervalMinutes?: number;
  }
): { total: number; items: FbMediaPostItem[] } {
  const intervalSec = (input.intervalMinutes || 3) * 60;
  const now = Date.now();
  const queuedItems: FbMediaPostItem[] = [];

  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const targetType = it.targetType || input.defaultTargetType || "profile";
    const targetUrl = it.targetUrl || input.defaultTargetUrl;
    const scheduledAt = it.scheduledAt || (now + (i * intervalSec * 1000));

    const item = addMediaPostItem(db, {
      targetType,
      targetUrl,
      targetName: it.targetName,
      mediaPath: it.mediaPath,
      caption: it.caption,
      scheduledAt,
      intervalSeconds: intervalSec,
      source: "list"
    });

    queuedItems.push(item);
  }

  return { total: queuedItems.length, items: queuedItems };
}

/**
 * Tích hợp Muse AI: Giao nhiệm vụ tạo video, tự tải về local và đưa vào hàng đợi đăng lên Facebook
 */
export async function queueMuseVideoForPost(
  db: Database,
  input: {
    task: string;
    targetType: FbTargetType;
    targetUrl?: string;
    targetName?: string;
    caption?: string;
    intervalMinutes?: number;
  },
  onActivity?: (event: any) => void
): Promise<{ ok: boolean; item?: FbMediaPostItem; videoPath?: string; error?: string }> {
  onActivity?.({
    type: "fb_media_post",
    action: "muse_generating",
    task: input.task.slice(0, 100)
  });

  const res = await browserBridge.execute(
    "ask_muse",
    {
      task: input.task,
      newThread: true,
      closeTabOnDone: false,
      timeoutMs: 180000
    },
    190000
  );

  if (!res.ok) {
    return { ok: false, error: res.error || "Muse AI không hoàn thành tạo video" };
  }

  const mediaDir = path.resolve("storage/media/muse");
  await fs.mkdir(mediaDir, { recursive: true });

  let savedVideoPath = "";
  if (res.attachments && res.attachments.length > 0) {
    for (let i = 0; i < res.attachments.length; i++) {
      const att = res.attachments[i];
      if (att.base64 && (att.mime?.includes("mp4") || att.type === "video")) {
        const filename = `muse_vid_${Date.now()}_${i + 1}.mp4`;
        const localPath = path.join(mediaDir, filename);
        await fs.writeFile(localPath, Buffer.from(att.base64, "base64"));
        savedVideoPath = localPath;
        break;
      }
    }
  }

  if (!savedVideoPath) {
    return {
      ok: false,
      error: "Muse AI đã hoàn thành phản hồi nhưng không tìm thấy file video thành phẩm đính kèm để tải về."
    };
  }

  const caption = input.caption || res.replyText || "Video tạo bởi Muse AI";
  const item = addMediaPostItem(db, {
    targetType: input.targetType,
    targetUrl: input.targetUrl,
    targetName: input.targetName,
    mediaPath: savedVideoPath,
    caption,
    scheduledAt: Date.now(),
    intervalSeconds: (input.intervalMinutes || 3) * 60,
    source: "muse"
  });

  onActivity?.({
    type: "fb_media_post",
    action: "muse_video_queued",
    id: item.id,
    videoPath: savedVideoPath
  });

  return { ok: true, item, videoPath: savedVideoPath };
}

/**
 * Lấy danh sách hàng đợi các bài đăng media
 */
export function listMediaQueue(
  db: Database,
  options?: { status?: FbMediaPostStatus; limit?: number }
): {
  total: number;
  pendingCount: number;
  postedCount: number;
  failedCount: number;
  items: FbMediaPostItem[];
} {
  let query = `SELECT * FROM fb_media_posts`;
  const params: any[] = [];

  if (options?.status) {
    query += ` WHERE status = ?`;
    params.push(options.status);
  }
  query += ` ORDER BY scheduled_at ASC`;
  if (options?.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  const items = db.query(query).all(...params) as FbMediaPostItem[];

  const counts = db.query(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' OR status = 'uploading' THEN 1 ELSE 0 END) as pendingCount,
      SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as postedCount,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failedCount
    FROM fb_media_posts
  `).get() as any;

  return {
    total: counts?.total || items.length,
    pendingCount: counts?.pendingCount || 0,
    postedCount: counts?.postedCount || 0,
    failedCount: counts?.failedCount || 0,
    items
  };
}

/**
 * Hủy một bài đăng trong hàng đợi
 */
export function cancelMediaQueueItem(db: Database, id: string): boolean {
  const res = db.run(
    `UPDATE fb_media_posts SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'uploading')`,
    [id]
  );
  return res.changes > 0;
}

/**
 * Hủy toàn bộ bài đăng đang chờ trong hàng đợi
 */
export function cancelAllPendingMediaPosts(db: Database): number {
  const res = db.run(`UPDATE fb_media_posts SET status = 'cancelled' WHERE status = 'pending'`);
  return res.changes;
}

/**
 * Lấy bài viết tiếp theo đang đến hạn trong hàng đợi (hoặc force lấy ngay bài gần nhất)
 */
export function getNextPendingMediaPost(db: Database, force = false): FbMediaPostItem | null {
  const now = Date.now();
  const query = force
    ? `SELECT * FROM fb_media_posts WHERE status = 'pending' ORDER BY scheduled_at ASC LIMIT 1`
    : `SELECT * FROM fb_media_posts WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 1`;
  const row = (force ? db.query(query).get() : db.query(query).get(now)) as FbMediaPostItem | null;

  return row || null;
}

/**
 * Cập nhật trạng thái bài đăng
 */
export function updateMediaPostStatus(
  db: Database,
  id: string,
  status: FbMediaPostStatus,
  error?: string
): void {
  const now = Date.now();
  if (status === "posted") {
    db.run(
      `UPDATE fb_media_posts SET status = ?, posted_at = ?, error_message = NULL WHERE id = ?`,
      [status, now, id]
    );
  } else if (status === "failed") {
    db.run(
      `UPDATE fb_media_posts SET status = ?, error_message = ? WHERE id = ?`,
      [status, error || "Lỗi đăng bài", id]
    );
  } else {
    db.run(`UPDATE fb_media_posts SET status = ? WHERE id = ?`, [status, id]);
  }
}

/**
 * Đăng trực tiếp 1 bài viết kèm media lên Facebook (không qua hàng đợi)
 */
export async function postMediaDirect(
  db: Database,
  input: {
    targetType: FbTargetType;
    targetUrl?: string;
    mediaPath?: string;
    caption: string;
  },
  onActivity?: (event: any) => void
): Promise<{ ok: boolean; verified: boolean; message: string; id?: string }> {
  const targetUrl = normalizeTargetUrl(input.targetType, input.targetUrl);
  const mediaType = detectMediaType(input.mediaPath);
  const resolvedPath = input.mediaPath ? path.resolve(input.mediaPath) : undefined;

  onActivity?.({
    type: "fb_media_post",
    action: "posting_direct",
    targetType: input.targetType,
    targetUrl,
    mediaPath: resolvedPath
  });

  const res: any = await browserBridge.execute(
    "fb_post_media",
    {
      targetType: input.targetType,
      targetUrl,
      mediaPath: resolvedPath,
      mediaType,
      caption: input.caption
    },
    120000 // Tối đa 2 phút cho việc upload media
  );

  const id = "fmp-" + Date.now();
  if (res?.ok) {
    db.run(
      `INSERT INTO fb_media_posts (
        id, target_type, target_url, media_path, media_type, caption,
        scheduled_at, interval_seconds, status, posted_at, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'posted', ?, 'manual', ?)`,
      [id, input.targetType, targetUrl, resolvedPath || null, mediaType, input.caption, Date.now(), Date.now(), Date.now()]
    );
    return { ok: true, verified: !!res.verified, message: res.message || "Đã đăng bài thành công!", id };
  } else {
    const errorMsg = res?.message || "Lỗi đăng bài media lên Facebook";
    db.run(
      `INSERT INTO fb_media_posts (
        id, target_type, target_url, media_path, media_type, caption,
        scheduled_at, interval_seconds, status, error_message, source, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'failed', ?, 'manual', ?)`,
      [id, input.targetType, targetUrl, resolvedPath || null, mediaType, input.caption, Date.now(), errorMsg, Date.now()]
    );
    return { ok: false, verified: false, message: errorMsg, id };
  }
}

/**
 * Tick hàng đợi đăng bài media: Kiểm tra bài tiếp theo và thực thi
 */
export async function tickMediaPostScheduler(
  db: Database,
  onActivity?: (event: any) => void,
  force = false
): Promise<{ processed: boolean; item?: FbMediaPostItem; error?: string }> {
  const item = getNextPendingMediaPost(db, force);
  if (!item) {
    return { processed: false };
  }

  updateMediaPostStatus(db, item.id, "uploading");

  onActivity?.({
    type: "fb_media_post",
    action: "uploading",
    id: item.id,
    targetType: item.target_type,
    targetUrl: item.target_url,
    mediaPath: item.media_path
  });

  try {
    const res: any = await browserBridge.execute(
      "fb_post_media",
      {
        targetType: item.target_type,
        targetUrl: item.target_url,
        mediaPath: item.media_path,
        mediaType: item.media_type,
        caption: item.caption
      },
      120000
    );

    if (res?.ok) {
      updateMediaPostStatus(db, item.id, "posted");
      onActivity?.({
        type: "fb_media_post",
        action: "posted",
        id: item.id,
        verified: true
      });
      return { processed: true, item };
    } else {
      const err = res?.message || "Không thể xác nhận bài viết xuất hiện trên Facebook";
      updateMediaPostStatus(db, item.id, "failed", err);
      onActivity?.({
        type: "fb_media_post",
        action: "failed",
        id: item.id,
        error: err
      });
      return { processed: true, item, error: err };
    }
  } catch (err: any) {
    const errorMsg = err.message || "Lỗi thực thi lệnh đăng media lên Facebook";
    updateMediaPostStatus(db, item.id, "failed", errorMsg);
    onActivity?.({
      type: "fb_media_post",
      action: "failed",
      id: item.id,
      error: errorMsg
    });
    return { processed: true, item, error: errorMsg };
  }
}

let schedulerTimer: any = null;

/**
 * Bắt đầu vòng lặp scheduler định kỳ (quét mỗi 10 giây)
 */
export function startMediaPostSchedulerLoop(
  db: Database,
  onActivity?: (event: any) => void,
  intervalMs = 10000
): void {
  if (schedulerTimer) return;

  schedulerTimer = setInterval(async () => {
    try {
      await tickMediaPostScheduler(db, onActivity);
    } catch (e) {
      console.error("[FB Media Scheduler] Lỗi tick:", e);
    }
  }, intervalMs);

  console.log(`[FB Media Scheduler] ⏱️ Đã kích hoạt bộ lập lịch đăng bài Media (quét mỗi ${intervalMs / 1000}s)`);
}

