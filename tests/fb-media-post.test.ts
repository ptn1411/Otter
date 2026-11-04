import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  detectMediaType,
  normalizeTargetUrl,
  addMediaPostItem,
  queueMediaFromFolder,
  queueMediaFromList,
  listMediaQueue,
  cancelMediaQueueItem,
  cancelAllPendingMediaPosts,
  updateMediaPostStatus,
  getNextPendingMediaPost
} from "../src/daemon/fb-media-post";
import { registerFbMediaPostTools } from "../src/daemon/tools/fb-media-post-tools";

describe("FB Media Post & Batch Queue Tests", () => {
  let db: Database;
  let tempDir: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS fb_media_posts (
        id TEXT PRIMARY KEY,
        target_type TEXT CHECK(target_type IN ('profile', 'group', 'page')) NOT NULL DEFAULT 'profile',
        target_url TEXT NOT NULL DEFAULT 'https://www.facebook.com/',
        target_name TEXT,
        media_path TEXT,
        media_type TEXT CHECK(media_type IN ('video', 'image', 'none')) NOT NULL DEFAULT 'video',
        caption TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        interval_seconds INTEGER NOT NULL DEFAULT 180,
        status TEXT CHECK(status IN ('pending', 'uploading', 'posted', 'failed', 'cancelled')) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        posted_at INTEGER,
        source TEXT CHECK(source IN ('folder', 'list', 'muse', 'manual')) NOT NULL DEFAULT 'manual',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fb_media_posts_pending ON fb_media_posts(status, scheduled_at);
    `);

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fb-media-test-"));
  });

  afterEach(async () => {
    db.close();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("1. detectMediaType nhận diện chính xác video, ảnh và none", () => {
    expect(detectMediaType("video.mp4")).toBe("video");
    expect(detectMediaType("C:/test/clip.MOV")).toBe("video");
    expect(detectMediaType("demo.mkv")).toBe("video");
    expect(detectMediaType("stream.webm")).toBe("video");
    expect(detectMediaType("photo.png")).toBe("image");
    expect(detectMediaType("avatar.jpg")).toBe("image");
    expect(detectMediaType("image.webp")).toBe("image");
    expect(detectMediaType("doc.pdf")).toBe("none");
    expect(detectMediaType("")).toBe("none");
    expect(detectMediaType(undefined)).toBe("none");
  });

  it("2. normalizeTargetUrl chuẩn hóa đường dẫn theo từng loại đích", () => {
    expect(normalizeTargetUrl("profile")).toBe("https://www.facebook.com/");
    expect(normalizeTargetUrl("group")).toBe("https://www.facebook.com/groups/feed/");
    expect(normalizeTargetUrl("group", "https://facebook.com/groups/123/")).toBe("https://facebook.com/groups/123");
    expect(normalizeTargetUrl("page", "facebook.com/mypage")).toBe("https://facebook.com/mypage");
  });

  it("3. addMediaPostItem thêm bài viết vào SQLite chính xác", () => {
    const item = addMediaPostItem(db, {
      targetType: "group",
      targetUrl: "https://www.facebook.com/groups/9999",
      targetName: "Nhóm Test",
      mediaPath: path.join(tempDir, "video1.mp4"),
      caption: "Bài viết test",
      scheduledAt: Date.now() + 60000,
      intervalSeconds: 300,
      source: "manual"
    });

    expect(item.id).toStartWith("fmp-");
    expect(item.target_type).toBe("group");
    expect(item.media_type).toBe("video");
    expect(item.caption).toBe("Bài viết test");
    expect(item.status).toBe("pending");
  });

  it("4. queueMediaFromFolder quét thư mục và lập lịch đăng từng bài một với giãn cách an toàn", async () => {
    // Tạo 3 tệp media mẫu trong thư mục tạm
    await fs.writeFile(path.join(tempDir, "vid_01.mp4"), "fake video 1");
    await fs.writeFile(path.join(tempDir, "vid_02.mp4"), "fake video 2");
    await fs.writeFile(path.join(tempDir, "img_03.png"), "fake image 3");
    await fs.writeFile(path.join(tempDir, "ignored.txt"), "text file");

    const result = await queueMediaFromFolder(db, {
      folderPath: tempDir,
      targetType: "page",
      targetUrl: "https://www.facebook.com/myfanpage",
      targetName: "Fanpage Test",
      defaultCaption: "Video hot: {filename}",
      intervalMinutes: 5,
      sortBy: "name"
    });

    expect(result.total).toBe(3);
    expect(result.items.length).toBe(3);

    // Kiểm tra tên caption đã được thay thế {filename}
    expect(result.items[0].caption).toBe("Video hot: img_03");
    expect(result.items[1].caption).toBe("Video hot: vid_01");
    expect(result.items[2].caption).toBe("Video hot: vid_02");

    // Kiểm tra giãn cách thời gian (5 phút = 300,000 ms)
    const diff1 = result.items[1].scheduled_at - result.items[0].scheduled_at;
    const diff2 = result.items[2].scheduled_at - result.items[1].scheduled_at;
    expect(diff1).toBe(300000);
    expect(diff2).toBe(300000);
  });

  it("5. queueMediaFromList nạp mảng danh sách bài viết cụ thể vào hàng đợi", () => {
    const list = [
      { caption: "Bài 1: Giới thiệu", mediaPath: "C:/vids/1.mp4" },
      { caption: "Bài 2: Tính năng", mediaPath: "C:/vids/2.mp4" },
      { caption: "Bài 3: Khuyến mãi", mediaPath: "C:/vids/3.mp4" }
    ];

    const result = queueMediaFromList(db, {
      items: list,
      defaultTargetType: "profile",
      intervalMinutes: 4
    });

    expect(result.total).toBe(3);
    expect(result.items[0].target_type).toBe("profile");
    expect(result.items[0].caption).toBe("Bài 1: Giới thiệu");
    expect(result.items[1].caption).toBe("Bài 2: Tính năng");

    const diff = result.items[1].scheduled_at - result.items[0].scheduled_at;
    expect(diff).toBe(240000); // 4 phút
  });

  it("6. listMediaQueue, cancel, updateStatus và getNextPendingMediaPost", () => {
    const now = Date.now();
    const item1 = addMediaPostItem(db, {
      targetType: "profile",
      caption: "Item 1",
      scheduledAt: now - 1000 // Đã đến giờ
    });
    const item2 = addMediaPostItem(db, {
      targetType: "group",
      caption: "Item 2",
      scheduledAt: now + 500000 // Tương lai
    });

    // Lấy bài đến hạn
    const pending = getNextPendingMediaPost(db);
    expect(pending?.id).toBe(item1.id);

    // Cập nhật trạng thái
    updateMediaPostStatus(db, item1.id, "posted");
    const updated = db.query(`SELECT * FROM fb_media_posts WHERE id = ?`).get(item1.id) as any;
    expect(updated.status).toBe("posted");
    expect(updated.posted_at).toBeGreaterThan(0);

    // Hủy bài trong hàng đợi
    const cancelled = cancelMediaQueueItem(db, item2.id);
    expect(cancelled).toBe(true);

    // Thống kê hàng đợi
    const queueState = listMediaQueue(db);
    expect(queueState.total).toBe(2);
    expect(queueState.postedCount).toBe(1);
    expect(queueState.pendingCount).toBe(0);

    // Thêm bài và test cancelAllPendingMediaPosts
    addMediaPostItem(db, { targetType: "profile", caption: "Pending A" });
    addMediaPostItem(db, { targetType: "profile", caption: "Pending B" });
    const count = cancelAllPendingMediaPosts(db);
    expect(count).toBe(2);
  });

  it("7. Đăng ký đầy đủ 7 MCP Tools cho FB Media Post", () => {
    const testMcp = {
      tools: new Map<string, any>(),
      tool(name: string, description: any, schema: any, handler?: any) {
        this.tools.set(name, { description, schema, handler });
      }
    };

    registerFbMediaPostTools(testMcp as any);

    expect(testMcp.tools.has("fb_post_media")).toBe(true);
    expect(testMcp.tools.has("fb_queue_media_folder")).toBe(true);
    expect(testMcp.tools.has("fb_queue_media_list")).toBe(true);
    expect(testMcp.tools.has("fb_queue_muse_video")).toBe(true);
    expect(testMcp.tools.has("fb_media_list_queue")).toBe(true);
    expect(testMcp.tools.has("fb_media_cancel_queue")).toBe(true);
    expect(testMcp.tools.has("fb_media_run_now")).toBe(true);
  });
});
