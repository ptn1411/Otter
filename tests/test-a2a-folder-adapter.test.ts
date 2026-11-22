import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ensureA2aInboxTables, getInboxStats, listInboxMessages } from "../src/daemon/a2a-inbox";
import { scanAndMigrateLegacyFolder } from "../src/daemon/a2a-folder-adapter";

describe("Legacy Shared Folder Migration Adapter", () => {
  let db: Database;
  let tempBaseDir: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    ensureA2aInboxTables(db as any);

    tempBaseDir = path.join(os.tmpdir(), `otter-test-shared-${Date.now()}`);
    await fs.mkdir(path.join(tempBaseDir, "inbox", "muse002"), { recursive: true });
    await fs.mkdir(path.join(tempBaseDir, "inbox", "ai_antigravity"), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  it("should scan and migrate legacy inbox markdown files", async () => {
    // Write 2 legacy files
    const file1 = path.join(tempBaseDir, "inbox", "muse002", "TASK-001.md");
    await fs.writeFile(file1, "# Check Facebook messages\nPlease reply to customer inquiries.", "utf8");

    const file2 = path.join(tempBaseDir, "inbox", "ai_antigravity", "TASK-002.md");
    await fs.writeFile(file2, "Fix cdp connection timeout\nCheck port 9222 first", "utf8");

    const result = await scanAndMigrateLegacyFolder(tempBaseDir, db as any);
    expect(result.scanned).toBe(2);
    expect(result.migrated).toBe(2);
    expect(result.errors.length).toBe(0);

    // Verify original files are archived or renamed
    const existsOriginal = await fs.stat(file1).then(() => true).catch(() => false);
    expect(existsOriginal).toBe(false);

    // Verify inbox tasks in Otter DB
    const msgs = listInboxMessages({}, db as any);
    expect(msgs.length).toBe(2);

    const museTask = msgs.find(m => m.recipientId === "ai_muse002");
    expect(museTask).toBeDefined();
    expect(museTask?.goal).toContain("Check Facebook messages");
    expect(museTask?.senderId).toBe("legacy_folder");
  });

  it("should gracefully handle non-existent directory", async () => {
    const nonExistent = path.join(os.tmpdir(), "no-such-otter-dir-xyz");
    const result = await scanAndMigrateLegacyFolder(nonExistent);
    expect(result.scanned).toBe(0);
    expect(result.migrated).toBe(0);
    expect(result.errors.length).toBe(0);
  });
});
