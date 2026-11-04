import { describe, it, expect } from "bun:test";

describe("GPM Automate MCP Server Integration", () => {
  it("should connect to gpmautomate MCP on port 19977 directly", async () => {
    const res = await fetch("http://localhost:19977/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      })
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(data.result?.tools).toBeDefined();
    expect(data.result.tools.length).toBeGreaterThanOrEqual(8);
    const toolNames = data.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("browser_status");
    expect(toolNames).toContain("snapshot_page");
    expect(toolNames).toContain("run_action");
    expect(toolNames).toContain("submit_workflow");
  });

  it("should be aggregated into Otter MCP Gateway", async () => {
    const res = await fetch("http://localhost:1993/api/mcp/servers");
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    const gpmAutomateServer = data.servers.find((s: any) => s.name === "gpmautomate");
    expect(gpmAutomateServer).toBeDefined();
    expect(gpmAutomateServer.status).toBe("connected");
    expect(gpmAutomateServer.toolsCount).toBe(8);
  });

  it("should execute get_action_catalog via Otter REST proxy", async () => {
    const res = await fetch("http://localhost:1993/api/mcp/ext/gpmautomate/get_action_catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as any;
    expect(data.content).toBeDefined();
    expect(data.content[0]?.text).toContain("WORKFLOW DSL CATALOG");
  });
});
