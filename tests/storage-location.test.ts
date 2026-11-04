import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import { getOtterDir, getDefaultDatabasePath } from "../src/daemon/db";
import { loadMcpConfig } from "../src/daemon/mcp-gateway";

describe("Centralized ~/.otter/ Storage & Config Tests", () => {
  it("resolves the centralized Otter directory to user home", () => {
    const dir = getOtterDir();
    expect(dir).toBe(path.join(os.homedir(), ".otter"));
  });

  it("defaults SQLite database storage path to ~/.otter/storage.sqlite", () => {
    const dbPath = getDefaultDatabasePath();
    expect(dbPath).toBe(path.join(os.homedir(), ".otter", "storage.sqlite"));
  });

  it("loads MCP config prioritizing centralized ~/.otter or local project fallback", async () => {
    const config = await loadMcpConfig();
    expect(config).toBeDefined();
    expect(config.mcpServers).toBeDefined();
    // gpmlogin should be present from mcp_config.json
    expect(config.mcpServers?.gpmlogin).toBeDefined();
  });
});
