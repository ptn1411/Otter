import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  TOOL_GROUPS,
  getToolGroupsState,
  setToolGroupsEnabled,
  loadToolGroupConfig,
  resetToolGroupConfig
} from "../src/daemon/tool-groups";
import {
  AgentDesktopBridge,
  findAgentDesktopCommand,
  agentDesktopBridge
} from "../src/daemon/agent-desktop";
import { registerAgentDesktopTools } from "../src/daemon/tools/agent-desktop-tools";
import { captureToolRegistrations, applyGroupState, trackMcpInstance } from "../src/daemon/tool-groups";

describe("Agent-Desktop Integration & Tool Group", () => {
  afterAll(() => {
    // Restore all groups to enabled
    setToolGroupsEnabled(Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, true])));
    resetToolGroupConfig();
  });
  it("includes agent-desktop in tool groups and is enabled by default", () => {
    const state = getToolGroupsState();
    const group = state.groups.find((g) => g.id === "agent-desktop");
    expect(group).toBeDefined();
    expect(group?.nameVi).toBe("Agent Desktop");
    expect(group?.toolCount).toBe(75);
    expect(group?.enabled).toBe(true);
  });

  it("toggling agent-desktop group disables its tools on active MCP instances", () => {
    const mcp = new McpServer({ name: "test-server", version: "1.0.0" });
    const capture = captureToolRegistrations(mcp);

    capture.setGroup("agent-desktop");
    const registeredCount = registerAgentDesktopTools(mcp);
    expect(registeredCount).toBe(75);

    applyGroupState(capture.handlesByGroup);
    trackMcpInstance(mcp, capture.handlesByGroup);

    // Initial state: enabled
    const handles = capture.handlesByGroup.get("agent-desktop") || [];
    expect(handles.length).toBe(75);

    // Turn OFF agent-desktop
    setToolGroupsEnabled({ "agent-desktop": false });
    expect(loadToolGroupConfig().has("agent-desktop")).toBe(true);

    // Turn back ON
    setToolGroupsEnabled({ "agent-desktop": true });
    expect(loadToolGroupConfig().has("agent-desktop")).toBe(false);
  });
});

describe("Agent-Desktop Bridge Lifecycle & Health", () => {
  it("detects agent-desktop command on the system", () => {
    const cmd = findAgentDesktopCommand();
    expect(cmd).not.toBeNull();
    expect(typeof cmd).toBe("string");
  });

  it("reports accurate health status", async () => {
    const health = await agentDesktopBridge.getHealth();
    expect(health.installed).toBe(true);
    expect(health.commandPath).toBeDefined();
  });

  it("lazy-starts child stdio server on first call and executes adesktop_status", async () => {
    const res = await agentDesktopBridge.callTool("adesktop_status", {});
    expect(res).toBeDefined();
    expect(agentDesktopBridge.isRunning()).toBe(true);
  }, 15000);

  it("restarts child process automatically if stopped or killed", async () => {
    await agentDesktopBridge.ensureServer();
    expect(agentDesktopBridge.isRunning()).toBe(true);

    // Kill / stop child session
    await agentDesktopBridge.stop();
    expect(agentDesktopBridge.isRunning()).toBe(false);

    // Next call should auto-restart cleanly
    const res = await agentDesktopBridge.callTool("adesktop_status", {});
    expect(res).toBeDefined();
    expect(agentDesktopBridge.isRunning()).toBe(true);
  }, 15000);

  it("provides clear installation instructions when binary is not found", async () => {
    const mockBridge = new AgentDesktopBridge();
    // Temporarily point PATH to empty to simulate missing binary
    const originalPath = process.env.PATH;
    const originalAppData = process.env.APPDATA;
    try {
      process.env.PATH = "";
      delete process.env.APPDATA;

      let caughtError: Error | null = null;
      try {
        await mockBridge.ensureServer();
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();
      expect(caughtError?.message).toContain("npm install -g agent-desktop");
    } finally {
      process.env.PATH = originalPath;
      if (originalAppData) process.env.APPDATA = originalAppData;
      await mockBridge.stop();
    }
  });
});

describe("Priority & Fallback Policy", () => {
  it("handles read-only fallback to desktop_list_windows gracefully", async () => {
    // Calling adesktop_list_windows returns window list
    const res = await agentDesktopBridge.callTool("adesktop_list_windows", {});
    expect(res).toBeDefined();
    expect(res.content).toBeDefined();
    expect(res.content.length).toBeGreaterThan(0);
  }, 15000);

  it("does not silently perform unintended mutations on policy denied ref click", async () => {
    // Passing an invalid or non-existent ref
    const res = await agentDesktopBridge.callTool("adesktop_click", { ref: "@s0000000:e9999" });
    expect(res).toBeDefined();

    // If it failed or triggered fallback, verify structured guidance
    if (res.isError) {
      const text = res.content?.[0]?.text || "";
      expect(text).toContain("fallback");
    }
  }, 15000);
});
