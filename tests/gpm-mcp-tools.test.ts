import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGpmTools } from "../src/daemon/tools/gpm-tools";
import { handleActivityRoutes } from "../src/daemon/routes/activity-routes";

describe("GPM MCP Tools & REST Endpoints", () => {
  test("registers all 6 GPM tools onto McpServer", () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    const activities: any[] = [];
    registerGpmTools(server, (evt) => activities.push(evt));

    const registeredTools = (server as any)._registeredTools || {};
    const toolNames = Object.keys(registeredTools);

    expect(toolNames).toContain("gpm_status");
    expect(toolNames).toContain("gpm_list_profiles");
    expect(toolNames).toContain("gpm_start_profile");
    expect(toolNames).toContain("gpm_stop_profile");
    expect(toolNames).toContain("gpm_test_xpath");
    expect(toolNames).toContain("gpm_generate_script");
  });

  test("GET /api/activity/v1/gpm/status returns GPM health info", async () => {
    const req = new Request("http://localhost:1993/api/activity/v1/gpm/status");
    const url = new URL(req.url);
    const res = await handleActivityRoutes(req, url, () => {});

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const data = await res?.json();
    expect(data).toHaveProperty("gpmLogin");
    expect(data).toHaveProperty("gpmAutomate");
    expect(data.loginPort).toBe(9495);
    expect(data.automatePort).toBe(19977);
  });

  test("POST /api/activity/v1/gpm/xpath/test validates XPath", async () => {
    const req = new Request("http://localhost:1993/api/activity/v1/gpm/xpath/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xpath: "//button[@id='submit']", negate: false })
    });
    const url = new URL(req.url);
    const res = await handleActivityRoutes(req, url, () => {});

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const data = await res?.json();
    expect(data.isValid).toBe(true);
    expect(data.hasElementCondition).toBe("hasElement(//button[@id='submit'])");
  });

  test("POST /api/activity/v1/gpm/script/generate generates paste-ready JSON", async () => {
    const req = new Request("http://localhost:1993/api/activity/v1/gpm/script/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionType: 48,
        xpath: "//input[@type='text']",
        rawInput: { XPATH: "//input[@type='text']" },
        comment: "Click text box"
      })
    });
    const url = new URL(req.url);
    const res = await handleActivityRoutes(req, url, () => {});

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const data = await res?.json();
    expect(data.success).toBe(true);
    expect(data.format).toBe("GPM Automate V3 (.NET JSON)");
    expect(data.pasteReadyJson).toContain("GPMAutomateEditor.Models.NormalBlockNode");
    expect(data.pasteReadyJson).toContain("Click text box");
  });
});
