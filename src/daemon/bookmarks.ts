import type { Database } from "bun:sqlite";

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SaveBookmarkInput {
  url: string;
  title: string;
  description?: string;
  tags?: string[] | string;
}

function parseTags(rawTags: string | null | undefined): string[] {
  if (!rawTags) return [];
  try {
    const parsed = JSON.parse(rawTags);
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  return rawTags
    .split(/[,;\s]+/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeTagsInput(tags?: string[] | string): string {
  if (!tags) return JSON.stringify([]);
  if (Array.isArray(tags)) {
    const clean = Array.from(new Set(tags.map(t => String(t).trim().toLowerCase()).filter(Boolean)));
    return JSON.stringify(clean);
  }
  const clean = Array.from(new Set(tags.split(/[,;\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean)));
  return JSON.stringify(clean);
}

function rowToBookmark(row: any): Bookmark {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description || "",
    tags: parseTags(row.tags),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

/**
 * Lưu mới hoặc cập nhật Bookmark
 */
export function saveBookmark(db: Database, input: SaveBookmarkInput): Bookmark {
  let url = (input.url || "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const title = (input.title || "").trim() || url;
  const description = (input.description || "").trim();
  const tagsJson = normalizeTagsInput(input.tags);
  const now = Date.now();
  const id = "bm-" + now + "-" + Math.random().toString(36).slice(2, 7);

  db.query(`
    INSERT INTO bookmarks (id, url, title, description, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE bookmarks.description END,
      tags = CASE WHEN excluded.tags != '[]' THEN excluded.tags ELSE bookmarks.tags END,
      updated_at = excluded.updated_at
  `).run(id, url, title, description, tagsJson, now, now);

  const row = db.query("SELECT * FROM bookmarks WHERE url = ?").get(url) as any;
  return rowToBookmark(row);
}

/**
 * Tìm kiếm Bookmark theo từ khóa liên quan (full-text matching trên title, description, tags, url)
 */
export function searchBookmarks(db: Database, query: string, limit = 10): Bookmark[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    const rows = db.query("SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map(rowToBookmark);
  }

  const words = q.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    const rows = db.query("SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ?").all(limit) as any[];
    return rows.map(rowToBookmark);
  }

  // Lấy danh sách bookmark tiềm năng
  const allRows = db.query("SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT 200").all() as any[];

  // Chấm điểm mức độ liên quan (Relevance Scoring)
  const scored = allRows.map(row => {
    const bm = rowToBookmark(row);
    const titleLower = bm.title.toLowerCase();
    const descLower = bm.description.toLowerCase();
    const urlLower = bm.url.toLowerCase();
    const tagsLower = bm.tags.join(" ").toLowerCase();

    let score = 0;

    // Khớp chính xác cụm từ tìm kiếm
    if (titleLower.includes(q)) score += 50;
    if (descLower.includes(q)) score += 30;
    if (tagsLower.includes(q)) score += 40;
    if (urlLower.includes(q)) score += 15;

    // Khớp từng từ đơn lẻ
    for (const word of words) {
      if (titleLower.includes(word)) score += 15;
      if (descLower.includes(word)) score += 8;
      if (tagsLower.includes(word)) score += 12;
      if (urlLower.includes(word)) score += 5;
    }

    return { bm, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || b.bm.createdAt - a.bm.createdAt)
    .slice(0, limit)
    .map(s => s.bm);
}

/**
 * Liệt kê danh sách Bookmark với phân trang và lọc theo tag
 */
export function listBookmarks(db: Database, limit = 20, offset = 0, tag?: string): { items: Bookmark[]; total: number } {
  const cleanTag = tag?.trim().toLowerCase();

  if (cleanTag) {
    const countRow = db.query("SELECT COUNT(*) as count FROM bookmarks WHERE tags LIKE ?").get(`%${cleanTag}%`) as any;
    const rows = db.query(
      "SELECT * FROM bookmarks WHERE tags LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(`%${cleanTag}%`, limit, offset) as any[];

    return {
      items: rows.map(rowToBookmark),
      total: countRow?.count || 0
    };
  }

  const countRow = db.query("SELECT COUNT(*) as count FROM bookmarks").get() as any;
  const rows = db.query(
    "SELECT * FROM bookmarks ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).all(limit, offset) as any[];

  return {
    items: rows.map(rowToBookmark),
    total: countRow?.count || 0
  };
}

/**
 * Xóa một Bookmark theo ID hoặc URL
 */
export function deleteBookmark(db: Database, idOrUrl: string): boolean {
  const target = (idOrUrl || "").trim();
  const res = db.query("DELETE FROM bookmarks WHERE id = ? OR url = ?").run(target, target);
  return res.changes > 0;
}

/**
 * Lấy chi tiết Bookmark theo ID hoặc URL
 */
export function getBookmark(db: Database, idOrUrl: string): Bookmark | null {
  const target = (idOrUrl || "").trim();
  const row = db.query("SELECT * FROM bookmarks WHERE id = ? OR url = ?").get(target, target) as any;
  return row ? rowToBookmark(row) : null;
}
