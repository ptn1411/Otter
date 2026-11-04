#!/usr/bin/env bun
/**
 * Otter Stdio MCP Entrypoint
 * Cho phép Claude Desktop, Claude Code CLI, Cursor, Windsurf, Codex kết nối trực tiếp qua Stdio
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp";

async function main() {
  const mcp = createMcpServer((event) => {
    // Không dùng console.log lên stdout vì sẽ làm hỏng JSON-RPC protocol của MCP
    if (process.env.DEBUG) {
      console.error(`[Otter Stdio]`, event.type);
    }
  });

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((err) => {
  console.error("[Otter Stdio Error]", err);
  process.exit(1);
});

