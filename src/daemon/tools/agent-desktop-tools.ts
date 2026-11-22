/**
 * Agent-Desktop MCP Toolset Registration
 *
 * Exposes all 75 agent-desktop tools prefixed with `adesktop_*` to avoid collisions
 * with built-in `desktop_*` tools, while keeping argument schemas completely faithful.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentDesktopBridge } from "../agent-desktop";
import { jsonSchemaToZodShape } from "../mcp-gateway";
import agentDesktopSchema from "./agent-desktop-schema.json";

export function registerAgentDesktopTools(mcp: McpServer, onActivity?: (event: any) => void): number {
  let registeredCount = 0;

  for (const tool of agentDesktopSchema as any[]) {
    const originalName = tool.name;
    const baseName = originalName.startsWith("desktop_")
      ? originalName.slice("desktop_".length)
      : originalName;
    const qualifiedName = `adesktop_${baseName}`;

    const description = `[Agent Desktop] ${tool.description}. Preferred desktop tool for semantic inspection and ref-based actions. If POLICY_DENIED or foreground focus prevents action, fall back to cua_execute_tool or desktop_*.`;

    try {
      const shape = jsonSchemaToZodShape(tool.inputSchema);

      mcp.tool(
        qualifiedName,
        description,
        shape,
        async (args: any) => {
          onActivity?.({ type: "adesktop_action", tool: qualifiedName, args });
          return await agentDesktopBridge.callTool(qualifiedName, args || {});
        }
      );

      registeredCount++;
    } catch (err: any) {
      console.warn(`[AgentDesktop] Could not register tool '${qualifiedName}': ${err.message}`);
    }
  }

  return registeredCount;
}
