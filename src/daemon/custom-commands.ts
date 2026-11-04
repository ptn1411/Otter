import type { Database } from "bun:sqlite";

export interface CustomCommand {
  id: string;
  slash: string;
  icon: string;
  category: string;
  title: string;
  description: string;
  promptTemplate: string;
  isPinned: boolean;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SaveCustomCommandInput {
  id?: string;
  slash: string;
  icon?: string;
  category?: string;
  title: string;
  description?: string;
  promptTemplate: string;
  isPinned?: boolean;
}

export function normalizeSlash(slash: string): string {
  let s = (slash || "").trim().toLowerCase();
  if (!s.startsWith("/")) {
    s = "/" + s;
  }
  // Loại bỏ các ký tự đặc biệt không hợp lệ trong slash command (chỉ giữ a-z, 0-9, _, -)
  return "/" + s.slice(1).replace(/[^a-z0-9_\-]/g, "");
}

function rowToCustomCommand(row: any): CustomCommand {
  return {
    id: row.id,
    slash: row.slash,
    icon: row.icon || "⚡",
    category: row.category || "Tập lệnh của tôi",
    title: row.title,
    description: row.description || "",
    promptTemplate: row.prompt_template,
    isPinned: Boolean(row.is_pinned),
    usageCount: Number(row.usage_count || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

/**
 * Lưu hoặc cập nhật một tập lệnh tùy chỉnh
 */
export function saveCustomCommand(db: Database, input: SaveCustomCommandInput): CustomCommand {
  const slash = normalizeSlash(input.slash);
  if (!slash || slash === "/") {
    throw new Error("Tên lệnh slash không hợp lệ. Ví dụ: /vpscheck hoặc /mydeploy");
  }

  const title = (input.title || "").trim();
  if (!title) {
    throw new Error("Tiêu đề tập lệnh không được để trống.");
  }

  const promptTemplate = (input.promptTemplate || "").trim();
  if (!promptTemplate) {
    throw new Error("Nội dung prompt mẫu (promptTemplate) không được để trống.");
  }

  const icon = (input.icon || "⚡").trim();
  const category = (input.category || "Tập lệnh của tôi").trim();
  const description = (input.description || "").trim();
  const isPinned = input.isPinned ? 1 : 0;
  const now = Date.now();
  const id = input.id || "cmd-" + now + "-" + Math.random().toString(36).slice(2, 7);

  db.query(`
    INSERT INTO custom_commands (id, slash, icon, category, title, description, prompt_template, is_pinned, usage_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(slash) DO UPDATE SET
      icon = excluded.icon,
      category = excluded.category,
      title = excluded.title,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE custom_commands.description END,
      prompt_template = excluded.prompt_template,
      is_pinned = CASE WHEN excluded.is_pinned != 0 THEN excluded.is_pinned ELSE custom_commands.is_pinned END,
      updated_at = excluded.updated_at
  `).run(id, slash, icon, category, title, description, promptTemplate, isPinned, now, now);

  const row = db.query("SELECT * FROM custom_commands WHERE slash = ?").get(slash) as any;
  return rowToCustomCommand(row);
}

/**
 * Lấy danh sách tập lệnh tùy chỉnh (sắp xếp: ghim lên đầu, sau đó theo tần suất sử dụng & thời gian cập nhật)
 */
export function listCustomCommands(db: Database, pinnedOnly = false): CustomCommand[] {
  let sql = "SELECT * FROM custom_commands";
  if (pinnedOnly) {
    sql += " WHERE is_pinned = 1";
  }
  sql += " ORDER BY is_pinned DESC, usage_count DESC, updated_at DESC";

  const rows = db.query(sql).all() as any[];
  return rows.map(rowToCustomCommand);
}

/**
 * Lấy chi tiết tập lệnh theo ID hoặc tên Slash
 */
export function getCustomCommand(db: Database, idOrSlash: string): CustomCommand | null {
  const norm = idOrSlash.startsWith("/") ? normalizeSlash(idOrSlash) : idOrSlash;
  const row = db.query("SELECT * FROM custom_commands WHERE id = ? OR slash = ?").get(norm, norm) as any;
  if (!row) return null;
  return rowToCustomCommand(row);
}

/**
 * Xóa một tập lệnh tùy chỉnh
 */
export function deleteCustomCommand(db: Database, idOrSlash: string): boolean {
  const norm = idOrSlash.startsWith("/") ? normalizeSlash(idOrSlash) : idOrSlash;
  const res = db.query("DELETE FROM custom_commands WHERE id = ? OR slash = ?").run(norm, norm);
  return res.changes > 0;
}

/**
 * Bật/tắt ghim (Pin) một tập lệnh ra ngoài thanh công cụ nhanh
 */
export function togglePinCustomCommand(db: Database, idOrSlash: string, pinned?: boolean): CustomCommand | null {
  const existing = getCustomCommand(db, idOrSlash);
  if (!existing) return null;

  const newPinned = pinned !== undefined ? (pinned ? 1 : 0) : (existing.isPinned ? 0 : 1);
  const now = Date.now();

  db.query("UPDATE custom_commands SET is_pinned = ?, updated_at = ? WHERE id = ?").run(newPinned, now, existing.id);

  return getCustomCommand(db, existing.id);
}

/**
 * Tăng lượt sử dụng khi người dùng kích hoạt lệnh
 */
export function incrementCommandUsage(db: Database, idOrSlash: string): void {
  const norm = idOrSlash.startsWith("/") ? normalizeSlash(idOrSlash) : idOrSlash;
  db.query("UPDATE custom_commands SET usage_count = usage_count + 1 WHERE id = ? OR slash = ?").run(norm, norm);
}
