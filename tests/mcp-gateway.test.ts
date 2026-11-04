import { describe, expect, it } from "bun:test";
import {
  jsonSchemaToZodShape,
  loadMcpConfig,
  reloadExternalMcpServers,
  getExternalServersState,
  getExternalToolsOpenApiPaths
} from "../src/daemon/mcp-gateway";
import { createMcpServer } from "../src/daemon/mcp";

describe("MCP Gateway & Aggregator Tests", () => {
  it("converts JSON Schema properties into Zod shapes correctly", () => {
    const inputSchema = {
      type: "object",
      properties: {
        id: { type: "string", description: "Identifier" },
        count: { type: "integer", description: "Count items" },
        enabled: { type: "boolean" },
        mode: { type: "string", enum: ["fast", "slow"] }
      },
      required: ["id"]
    };

    const shape = jsonSchemaToZodShape(inputSchema);
    expect(shape).toBeDefined();
    expect(shape.id).toBeDefined();
    expect(shape.count).toBeDefined();
    expect(shape.enabled).toBeDefined();
    expect(shape.mode).toBeDefined();

    // Required field succeeds with valid string
    expect(shape.id.safeParse("abc").success).toBe(true);
    // Optional field can be omitted
    expect(shape.count.safeParse(undefined).success).toBe(true);
    // Integer field validation
    expect(shape.count.safeParse(10).success).toBe(true);
    expect(shape.count.safeParse(10.5).success).toBe(false);
    // Enum field validation
    expect(shape.mode.safeParse("fast").success).toBe(true);
    expect(shape.mode.safeParse("invalid").success).toBe(false);
  });

  it("loads mcp_config.json containing mcpServers", async () => {
    const config = await loadMcpConfig();
    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers?.gpmlogin).toBeDefined();
    expect(config.mcpServers?.gpmlogin.url).toBe("http://127.0.0.1:9495/mcp");
  });

  it("loads external servers and registers tools in McpServer", async () => {
    const servers = await reloadExternalMcpServers();
    expect(servers.length).toBeGreaterThan(0);

    const gpmServer = servers.find((s) => s.name === "gpmlogin");
    expect(gpmServer).toBeDefined();

    // Should generate OpenAPI paths for external tools
    const openApiPaths = getExternalToolsOpenApiPaths();
    if (gpmServer?.status === "connected") {
      expect(Object.keys(openApiPaths).length).toBeGreaterThan(0);
      expect(openApiPaths["/api/mcp/ext/gpmlogin/list_profiles"]).toBeDefined();
    }

    // Creating McpServer should succeed without error
    const mcp = createMcpServer();
    expect(mcp).toBeDefined();
  });

  it("adds and removes an external MCP server dynamically", async () => {
    const { addExternalServer, removeExternalServer } = await import("../src/daemon/mcp-gateway");
    const testServerName = "test_mock_server";
    
    // Add server
    await addExternalServer(testServerName, {
      type: "http",
      url: "http://127.0.0.1:9999/mcp"
    });

    let config = await loadMcpConfig();
    expect(config.mcpServers?.[testServerName]).toBeDefined();

    // Remove server
    const removed = await removeExternalServer(testServerName);
    expect(removed).toBe(true);

    config = await loadMcpConfig();
    expect(config.mcpServers?.[testServerName]).toBeUndefined();
  });

  it("connects to a stdio MCP server, discovers tools and executes tool calls", async () => {
    const { addExternalServer, removeExternalServer, executeExternalTool } = await import("../src/daemon/mcp-gateway");
    const path = await import("node:path");
    const stdioServerName = "test_stdio_ping";
    const fixturePath = path.resolve("tests/fixtures/mock-stdio-server.ts");

    await addExternalServer(stdioServerName, {
      type: "stdio",
      command: "bun",
      args: [fixturePath]
    });

    const servers = await reloadExternalMcpServers();
    const serverState = servers.find((s) => s.name === stdioServerName);
    expect(serverState).toBeDefined();
    expect(serverState?.status).toBe("connected");
    expect(serverState?.tools.length).toBeGreaterThan(0);
    expect(serverState?.tools.some(t => t.originalName === "ping")).toBe(true);

    const callRes = await executeExternalTool(stdioServerName, "ping", { message: "OtterRocks" });
    expect(callRes.isError).toBeFalsy();
    expect(callRes.content[0].text).toContain("pong: OtterRocks");

    await removeExternalServer(stdioServerName);
  });
});

