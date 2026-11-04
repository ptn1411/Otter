import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase } from "../src/daemon/db";
import {
  saveBookmark,
  searchBookmarks,
  listBookmarks,
  deleteBookmark,
  getBookmark
} from "../src/daemon/bookmarks";

describe("Bookmark Management & AI Search Tests", () => {
  let db: Database;

  beforeEach(() => {
    // Dùng in-memory SQLite cho test để đảm bảo độc lập
    db = initDatabase(":memory:");
  });

  it("saves a new bookmark and retrieves it", () => {
    const bm = saveBookmark(db, {
      url: "https://github.com/remotion-dev/remotion",
      title: "Remotion - Make videos programmatically with React",
      description: "Thư viện lập trình tạo video bằng React, hỗ trợ animation, âm thanh và render CLI",
      tags: ["react", "video", "remotion"]
    });

    expect(bm.id.startsWith("bm-")).toBeTrue();
    expect(bm.url).toBe("https://github.com/remotion-dev/remotion");
    expect(bm.title).toBe("Remotion - Make videos programmatically with React");
    expect(bm.tags).toContain("video");
    expect(bm.tags).toContain("remotion");

    const fetched = getBookmark(db, bm.url);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe(bm.title);
  });

  it("updates existing bookmark when url already exists (upsert)", () => {
    saveBookmark(db, {
      url: "https://youtube.com",
      title: "YouTube",
      description: "Video platform",
      tags: ["video"]
    });

    const updated = saveBookmark(db, {
      url: "https://youtube.com",
      title: "YouTube - Broadcast Yourself",
      description: "Nền tảng chia sẻ video lớn nhất thế giới",
      tags: ["video", "google", "streaming"]
    });

    expect(updated.title).toBe("YouTube - Broadcast Yourself");
    expect(updated.tags).toContain("google");

    const list = listBookmarks(db);
    expect(list.total).toBe(1);
  });

  it("searches bookmarks by related keywords with ranking", () => {
    saveBookmark(db, {
      url: "https://news.ycombinator.com",
      title: "Hacker News",
      description: "Tin tức công nghệ, lập trình và khởi nghiệp toàn cầu",
      tags: ["tech", "startup"]
    });

    saveBookmark(db, {
      url: "https://www.youtube.com/watch?v=cat123",
      title: "Trend thú cưng cảm động đáng yêu",
      description: "Tổng hợp các khoảnh khắc chó mèo hài hước và ấm áp",
      tags: ["thú cưng", "mèo", "chó", "youtube"]
    });

    saveBookmark(db, {
      url: "https://github.com/openai/openai-python",
      title: "OpenAI Python Library",
      description: "Thư viện Python gọi API GPT-4, DALL-E và Whisper",
      tags: ["ai", "python", "openai"]
    });

    // 1. Tìm từ khóa "thú cưng"
    const petResults = searchBookmarks(db, "thú cưng");
    expect(petResults.length).toBe(1);
    expect(petResults[0].title).toContain("thú cưng");

    // 2. Tìm từ khóa "chó mèo video"
    const catResults = searchBookmarks(db, "chó mèo");
    expect(catResults.length).toBe(1);
    expect(catResults[0].url).toContain("cat123");

    // 3. Tìm từ khóa "ai python"
    const aiResults = searchBookmarks(db, "lập trình ai");
    expect(aiResults.length).toBeGreaterThan(0);
    expect(aiResults[0].title).toBe("OpenAI Python Library");

    // 4. Tìm từ khóa không tồn tại
    const emptyResults = searchBookmarks(db, "khong_ton_tai_xyz_123");
    expect(emptyResults.length).toBe(0);
  });

  it("filters bookmarks by tag and supports deletion", () => {
    const b1 = saveBookmark(db, {
      url: "https://example.com/1",
      title: "Doc 1",
      tags: ["docs", "tutorial"]
    });

    saveBookmark(db, {
      url: "https://example.com/2",
      title: "Doc 2",
      tags: ["docs", "reference"]
    });

    saveBookmark(db, {
      url: "https://example.com/3",
      title: "News 1",
      tags: ["news"]
    });

    const docs = listBookmarks(db, 10, 0, "docs");
    expect(docs.total).toBe(2);

    const deleted = deleteBookmark(db, b1.id);
    expect(deleted).toBeTrue();

    const afterDelete = listBookmarks(db);
    expect(afterDelete.total).toBe(2);
  });
});
