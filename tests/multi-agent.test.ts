import { describe, expect, it } from "bun:test";
import { findCliBinary, cleanCliOutput } from "../src/daemon/tools/multi-agent";
import { createMcpServer } from "../src/daemon/mcp";

describe("Multi-Agent CLI Tools (Claude, Gemini, Codex) Tests", () => {
  it("locates local installed AI CLI binaries correctly", async () => {
    const claudeBin = await findCliBinary("claude");
    const geminiBin = await findCliBinary("gemini");
    const codexBin = await findCliBinary("codex");

    // Ít nhất các CLI có trên máy phải được phát hiện chính xác
    expect(claudeBin).not.toBeNull();
    expect(claudeBin?.toLowerCase()).toContain("claude");

    expect(geminiBin).not.toBeNull();
    expect(geminiBin?.toLowerCase()).toContain("agy");

    expect(codexBin).not.toBeNull();
    expect(codexBin?.toLowerCase()).toContain("codex");
  });

  it("registers all 5 multi-agent tools including pipeline orchestrator in McpServer", () => {
    const mcp = createMcpServer();
    const registeredTools = (mcp as any)._registeredTools || (mcp as any).registeredTools || {};
    const toolNames = Object.keys(registeredTools);

    expect(toolNames).toContain("agent_cli_status");
    expect(toolNames).toContain("agent_run_claude");
    expect(toolNames).toContain("agent_run_gemini");
    expect(toolNames).toContain("agent_run_codex");
    expect(toolNames).toContain("agent_orchestrate_pipeline");
  });

  it("cleans ANSI color codes and noisy CLI stdin banners properly", () => {
    const noisyText = "\x1b[32mReading additional input from stdin...\x1b[0m\r\nWarning: no stdin data received in 3s, proceeding.\r\nHello World\x1b[1m!";
    const cleaned = cleanCliOutput(noisyText);

    expect(cleaned).toContain("Hello World!");
    expect(cleaned).not.toContain("\x1b[32m");
    expect(cleaned).not.toContain("Reading additional input from stdin...");
    expect(cleaned).not.toContain("Warning: no stdin data received");
  });

  it("prevents path traversal attempts in findSkillMarkdown", async () => {
    const { findSkillMarkdown } = await import("../src/daemon/skills-catalog");
    const traversalAttempt = await findSkillMarkdown("../../../../../windows/system32");
    expect(traversalAttempt).toBeNull();

    const emptyAttempt = await findSkillMarkdown("....//");
    expect(emptyAttempt).toBeNull();
  });
});
