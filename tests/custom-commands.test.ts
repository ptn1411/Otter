import { describe, expect, it, beforeEach } from "bun:sqlite";
import { describe as bunDescribe, expect as bunExpect, it as bunIt, beforeEach as bunBeforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  saveCustomCommand,
  listCustomCommands,
  getCustomCommand,
  deleteCustomCommand,
  togglePinCustomCommand,
  incrementCommandUsage,
  normalizeSlash
} from "../src/daemon/custom-commands";
import { handleCustomCommandsRoutes } from "../src/daemon/routes/custom-commands-routes";
import { createMcpServer } from "../src/daemon/mcp";

bunDescribe("Custom Slash Commands & Pinning Tests", () => {
  let db: Database;

  bunBeforeEach(() => {
    db = new Database(":memory:");
    db.run(`
      CREATE TABLE custom_commands (
        id TEXT PRIMARY KEY,
        slash TEXT NOT NULL UNIQUE,
        icon TEXT DEFAULT '⚡',
        category TEXT DEFAULT 'Tập lệnh của tôi',
        title TEXT NOT NULL,
        description TEXT,
        prompt_template TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  });

  bunIt("normalizes slash commands correctly", () => {
    bunExpect(normalizeSlash("vpscheck")).toBe("/vpscheck");
    bunExpect(normalizeSlash("/VPSCheck")).toBe("/vpscheck");
    bunExpect(normalizeSlash("/audit_ram-1")).toBe("/audit_ram-1");
    bunExpect(normalizeSlash("my command !@#")).toBe("/mycommand");
  });

  bunIt("creates a new custom command and retrieves it", () => {
    const cmd = saveCustomCommand(db, {
      slash: "/audit-vps",
      icon: "🖥️",
      category: "DevOps",
      title: "Kiểm tra VPS",
      description: "Xem CPU, RAM và Disk VPS",
      promptTemplate: "Chạy audit sức khỏe VPS",
      isPinned: true
    });

    bunExpect(cmd.id).toBeDefined();
    bunExpect(cmd.slash).toBe("/audit-vps");
    bunExpect(cmd.title).toBe("Kiểm tra VPS");
    bunExpect(cmd.isPinned).toBeTrue();
    bunExpect(cmd.usageCount).toBe(0);

    const fetched = getCustomCommand(db, "/audit-vps");
    bunExpect(fetched).not.toBeNull();
    bunExpect(fetched?.id).toBe(cmd.id);
  });

  bunIt("updates existing command on slash conflict", () => {
    saveCustomCommand(db, {
      slash: "/deploy",
      title: "Deploy V1",
      promptTemplate: "Chạy deploy v1"
    });

    const updated = saveCustomCommand(db, {
      slash: "/deploy",
      title: "Deploy V2 Pro",
      promptTemplate: "Chạy deploy v2"
    });

    bunExpect(updated.title).toBe("Deploy V2 Pro");
    bunExpect(updated.promptTemplate).toBe("Chạy deploy v2");

    const all = listCustomCommands(db);
    bunExpect(all.length).toBe(1);
  });

  bunIt("toggles pin status and filters pinnedOnly", () => {
    const c1 = saveCustomCommand(db, {
      slash: "/cmd1",
      title: "Cmd 1",
      promptTemplate: "Test 1",
      isPinned: false
    });

    const c2 = saveCustomCommand(db, {
      slash: "/cmd2",
      title: "Cmd 2",
      promptTemplate: "Test 2",
      isPinned: true
    });

    let pinned = listCustomCommands(db, true);
    bunExpect(pinned.length).toBe(1);
    bunExpect(pinned[0].slash).toBe("/cmd2");

    // Toggle pin for c1
    const toggled = togglePinCustomCommand(db, c1.id);
    bunExpect(toggled?.isPinned).toBeTrue();

    pinned = listCustomCommands(db, true);
    bunExpect(pinned.length).toBe(2);

    // Toggle off for c2
    togglePinCustomCommand(db, c2.slash, false);
    pinned = listCustomCommands(db, true);
    bunExpect(pinned.length).toBe(1);
    bunExpect(pinned[0].slash).toBe("/cmd1");
  });

  bunIt("increments usage count and orders by popularity", () => {
    saveCustomCommand(db, {
      slash: "/rare",
      title: "Rare Command",
      promptTemplate: "Do something rare"
    });

    saveCustomCommand(db, {
      slash: "/popular",
      title: "Popular Command",
      promptTemplate: "Do something often"
    });

    incrementCommandUsage(db, "/popular");
    incrementCommandUsage(db, "/popular");

    const all = listCustomCommands(db);
    bunExpect(all[0].slash).toBe("/popular");
    bunExpect(all[0].usageCount).toBe(2);
    bunExpect(all[1].slash).toBe("/rare");
  });

  bunIt("deletes a custom command", () => {
    const cmd = saveCustomCommand(db, {
      slash: "/delete-me",
      title: "To be deleted",
      promptTemplate: "delete"
    });

    bunExpect(deleteCustomCommand(db, cmd.id)).toBeTrue();
    bunExpect(getCustomCommand(db, "/delete-me")).toBeNull();
  });

  bunIt("handles REST API requests correctly", async () => {
    // 1. POST /api/commands
    const createReq = new Request("http://localhost:1993/api/commands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slash: "/api-test",
        title: "API Command",
        promptTemplate: "Test from REST API",
        isPinned: true
      })
    });
    const createRes = await handleCustomCommandsRoutes(createReq, new URL(createReq.url), db);
    bunExpect(createRes?.status).toBe(200);
    const createJson: any = await createRes?.json();
    bunExpect(createJson.ok).toBeTrue();
    bunExpect(createJson.command.slash).toBe("/api-test");

    // 2. GET /api/commands
    const getReq = new Request("http://localhost:1993/api/commands");
    const getRes = await handleCustomCommandsRoutes(getReq, new URL(getReq.url), db);
    const getJson: any = await getRes?.json();
    bunExpect(getJson.total).toBe(1);
    bunExpect(getJson.items[0].slash).toBe("/api-test");

    // 3. POST /api/commands/:id/pin
    const pinReq = new Request(`http://localhost:1993/api/commands/${createJson.command.id}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: false })
    });
    const pinRes = await handleCustomCommandsRoutes(pinReq, new URL(pinReq.url), db);
    const pinJson: any = await pinRes?.json();
    bunExpect(pinJson.command.isPinned).toBeFalse();

    // 4. DELETE /api/commands/:id
    const delReq = new Request(`http://localhost:1993/api/commands/${createJson.command.id}`, {
      method: "DELETE"
    });
    const delRes = await handleCustomCommandsRoutes(delReq, new URL(delReq.url), db);
    const delJson: any = await delRes?.json();
    bunExpect(delJson.ok).toBeTrue();
  });

  bunIt("registers all custom command MCP tools in McpServer", () => {
    const mcp = createMcpServer();
    const registeredTools = Object.keys((mcp as any)._registeredTools || {});

    bunExpect(registeredTools).toContain("command_create_or_update");
    bunExpect(registeredTools).toContain("command_list");
    bunExpect(registeredTools).toContain("command_pin");
    bunExpect(registeredTools).toContain("command_delete");
  });
});
