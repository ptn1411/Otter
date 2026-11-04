import { describe, it, expect } from "bun:test";
import {
  getDaemonRoute,
  matchDaemonRoute,
  matchDaemonRoutePrefix,
  matchDaemonSubPath,
  OBFUSCATED_DAEMON_ROUTES,
  type DaemonRouteKey,
} from "../src/daemon/routes/lcg-routes";
import { Database } from "bun:sqlite";
import { handleCustomCommandsRoutes } from "../src/daemon/routes/custom-commands-routes";
import { handleBookmarksRoutes } from "../src/daemon/routes/bookmarks-routes";
import { handleSkillsRoutes } from "../src/daemon/routes/skills-routes";

describe("Daemon LCG Route Masking Tests (Ẩn router trong src/daemon/routes/)", () => {
  it("verifies all daemon route byte arrays contain only valid byte numbers", () => {
    for (const [key, bytes] of Object.entries(OBFUSCATED_DAEMON_ROUTES)) {
      expect(Array.isArray(bytes)).toBe(true);
      expect(bytes.length).toBeGreaterThan(0);
      for (const b of bytes) {
        expect(typeof b).toBe("number");
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });

  it("deobfuscates all core daemon routes accurately", () => {
    expect(getDaemonRoute("COMMANDS")).toBe("/api/commands");
    expect(getDaemonRoute("BOOKMARKS")).toBe("/api/bookmarks");
    expect(getDaemonRoute("SKILLS")).toBe("/api/skills");
    expect(getDaemonRoute("SYS_LICENSE")).toBe("/api/system/license");
    expect(getDaemonRoute("SYS_LICENSE_ACTIVATE")).toBe("/api/system/license/activate");
    expect(getDaemonRoute("SYS_TUNNEL")).toBe("/api/system/tunnel");
    expect(getDaemonRoute("SYS_TUNNEL_START")).toBe("/api/system/tunnel/start");
    expect(getDaemonRoute("SYS_TUNNEL_STOP")).toBe("/api/system/tunnel/stop");
    expect(getDaemonRoute("SYS_FOLDER_PICKER")).toBe("/api/local/system/folder-picker");
    expect(getDaemonRoute("SYS_FILE_PICKER")).toBe("/api/local/system/file-picker");
    expect(getDaemonRoute("MCP_SERVERS")).toBe("/api/mcp/servers");
    expect(getDaemonRoute("MCP_RELOAD")).toBe("/api/mcp/reload");
    expect(getDaemonRoute("MCP_CONFIG")).toBe("/api/mcp/config");
    expect(getDaemonRoute("MCP_SERVERS_ADD")).toBe("/api/mcp/servers/add");
    expect(getDaemonRoute("MCP_SERVERS_DEL")).toBe("/api/mcp/servers/delete");
    expect(getDaemonRoute("MCP_EXT_PREFIX")).toBe("/api/mcp/ext/");
    expect(getDaemonRoute("ACT_TERM_EXEC")).toBe("/api/activity/v1/terminal/exec");
    expect(getDaemonRoute("ACT_FILES_READ")).toBe("/api/activity/v1/files/read");
    expect(getDaemonRoute("ACT_FILES_WRITE")).toBe("/api/activity/v1/files/write");
    expect(getDaemonRoute("ACT_PENDING_BIND")).toBe("/api/activity/v1/pending-bind");
    expect(getDaemonRoute("ACT_BIND")).toBe("/api/activity/v1/bind");
    expect(getDaemonRoute("ACT_STREAM")).toBe("/api/activity/v1/stream");
    expect(getDaemonRoute("ACT_CONV_PREFIX")).toBe("/api/activity/v1/conversations/");
    expect(getDaemonRoute("ACT_BROWSER_PREFIX")).toBe("/api/activity/v1/browser/");
    expect(getDaemonRoute("ACT_DESKTOP_PREFIX")).toBe("/api/activity/v1/desktop/");
  });

  it("matches exact routes without exposing plain text strings", () => {
    expect(matchDaemonRoute("/api/commands", "COMMANDS")).toBe(true);
    expect(matchDaemonRoute("/api/commands/", "COMMANDS")).toBe(false);
    expect(matchDaemonRoute("/api/bookmarks", "BOOKMARKS")).toBe(true);
    expect(matchDaemonRoute("/api/skills", "SKILLS")).toBe(true);
    expect(matchDaemonRoute("/api/system/license", "SYS_LICENSE")).toBe(true);
  });

  it("matches route prefixes correctly for dynamic tool and conversation endpoints", () => {
    expect(matchDaemonRoutePrefix("/api/mcp/ext/github/search", "MCP_EXT_PREFIX")).toBe(true);
    expect(matchDaemonRoutePrefix("/api/mcp/ext/vps/exec", "MCP_EXT_PREFIX")).toBe(true);
    expect(matchDaemonRoutePrefix("/api/mcp/other", "MCP_EXT_PREFIX")).toBe(false);

    expect(matchDaemonRoutePrefix("/api/activity/v1/conversations/conv-123/terminals", "ACT_CONV_PREFIX")).toBe(true);
    expect(matchDaemonRoutePrefix("/api/activity/v1/browser/click", "ACT_BROWSER_PREFIX")).toBe(true);
  });

  it("extracts route parameters using matchDaemonSubPath", () => {
    const matchPin = matchDaemonSubPath("/api/commands/my-cmd-1/pin", "COMMANDS", "/([^/]+)/pin");
    expect(matchPin).not.toBeNull();
    expect(matchPin![1]).toBe("my-cmd-1");

    const matchDelete = matchDaemonSubPath("/api/bookmarks/bm-99", "BOOKMARKS", "/([^/]+)");
    expect(matchDelete).not.toBeNull();
    expect(matchDelete![1]).toBe("bm-99");
  });

  it("dispatches requests seamlessly to route handlers with LCG matching", async () => {
    const db = new Database(":memory:");
    db.run(`
      CREATE TABLE IF NOT EXISTS custom_commands (
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

    // GET /api/commands qua handleCustomCommandsRoutes
    const req = new Request("http://localhost:1993/api/commands", { method: "GET" });
    const url = new URL(req.url);
    const res = await handleCustomCommandsRoutes(req, url, db);

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const data = await res!.json();
    expect(data.items).toEqual([]);

    db.close();
  });
});
