import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "test-stdio-mcp",
  version: "1.0.0"
});

server.tool(
  "ping",
  "Returns pong with payload",
  { message: z.string().optional() },
  async ({ message }) => {
    return {
      content: [{ type: "text", text: `pong: ${message || "none"}` }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
