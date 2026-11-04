import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { initDatabase } from "../src/daemon/db";

describe("FB Group Post DB Schema", () => {
  it("initializes fb_group_targets, fb_group_schedules, and fb_group_post_queue tables", () => {
    const memDb = new Database(":memory:");
    initDatabase(":memory:"); // or test on in-memory db directly

    const tables = memDb.query("SELECT name FROM sqlite_master WHERE type='table'").all();
    // Test on a dedicated temp DB
    const testDbPath = path.join(os.tmpdir(), `test-group-db-${Date.now()}.sqlite`);
    try {
      const db = initDatabase(testDbPath);
      const tableNames = (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);

      expect(tableNames).toContain("fb_group_targets");
      expect(tableNames).toContain("fb_group_schedules");
      expect(tableNames).toContain("fb_group_post_queue");

      // Verify columns of fb_group_targets
      const targetCols = (db.query("PRAGMA table_info(fb_group_targets)").all() as any[]).map(c => c.name);
      expect(targetCols).toContain("id");
      expect(targetCols).toContain("name");
      expect(targetCols).toContain("url");
      expect(targetCols).toContain("topic");
      expect(targetCols).toContain("enabled");

      // Verify columns of fb_group_schedules
      const schedCols = (db.query("PRAGMA table_info(fb_group_schedules)").all() as any[]).map(c => c.name);
      expect(schedCols).toContain("id");
      expect(schedCols).toContain("mode");
      expect(schedCols).toContain("content");
      expect(schedCols).toContain("target_group_ids");
      expect(schedCols).toContain("scheduled_at");
      expect(schedCols).toContain("interval_seconds");
      expect(schedCols).toContain("status");

      // Verify columns of fb_group_post_queue
      const queueCols = (db.query("PRAGMA table_info(fb_group_post_queue)").all() as any[]).map(c => c.name);
      expect(queueCols).toContain("id");
      expect(queueCols).toContain("schedule_id");
      expect(queueCols).toContain("target_group_id");
      expect(queueCols).toContain("group_url");
      expect(queueCols).toContain("group_name");
      expect(queueCols).toContain("content");
      expect(queueCols).toContain("scheduled_at");
      expect(queueCols).toContain("status");

      db.close();
    } finally {
      try {
        const fs = require("node:fs");
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
        if (fs.existsSync(`${testDbPath}-wal`)) fs.unlinkSync(`${testDbPath}-wal`);
        if (fs.existsSync(`${testDbPath}-shm`)) fs.unlinkSync(`${testDbPath}-shm`);
      } catch {}
    }
  });
});

