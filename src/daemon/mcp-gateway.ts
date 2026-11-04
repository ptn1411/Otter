/**
 * External MCP Gateway & Server Aggregator for Otter
 * 
 * Allows users to configure external MCP servers (HTTP / Streamable HTTP / Stdio)
 * in 'mcp_config.json', aggregating all their tools dynamically into Otter's
 * MCP Server, ChatGPT Web Extension, and OpenAPI endpoints.
 */
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { validateSecureUrl } from "./license/payload-cipher";

export interface McpServerConfig {
  type?: "http" | "streamableHttp" | "sse" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

export interface ExternalTool {
  serverKey: string;
  originalName: string;
  qualifiedName: string;
  title?: string;
  description: string;
  inputSchema: any;
  annotations?: any;
}

export interface ServerState {
  name: string;
  config: McpServerConfig;
  status: "connected" | "error" | "connecting" | "idle";
  error?: string;
  tools: ExternalTool[];
  lastChecked: number;
}

const serversCache = new Map<string, ServerState>();
let isInitialized = false;
let configFilePath: string = path.resolve("mcp_config.json");

interface StdioSession {
  client: Client;
  transport: StdioClientTransport;
}
const stdioSessions = new Map<string, StdioSession>();

async function closeStdioSession(serverKey: string): Promise<void> {
  const session = stdioSessions.get(serverKey);
  if (session) {
    stdioSessions.delete(serverKey);
    try {
      await session.client.close();
    } catch {}
  }
}

/**
 * Convert JSON Schema properties into a Zod shape
 */
export function jsonSchemaToZodShape(inputSchema: any): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  if (!inputSchema || !inputSchema.properties || typeof inputSchema.properties !== "object") {
    return shape;
  }

  const required = new Set(Array.isArray(inputSchema.required) ? inputSchema.required : []);

  for (const [key, prop] of Object.entries<any>(inputSchema.properties)) {
    let schema: z.ZodTypeAny;

    const propType = prop.type || (Array.isArray(prop.enum) ? "string" : "any");

    switch (propType) {
      case "string":
        if (Array.isArray(prop.enum) && prop.enum.length > 0) {
          schema = z.enum(prop.enum as [string, ...string[]]);
        } else {
          schema = z.string();
        }
        break;
      case "number":
        schema = z.number();
        break;
      case "integer":
        schema = z.number().int();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = z.array(z.any());
        break;
      case "object":
        schema = z.record(z.any());
        break;
      default:
        schema = z.any();
        break;
    }

    if (prop.description) {
      schema = schema.describe(prop.description);
    }

    if (!required.has(key)) {
      schema = schema.optional();
    }

    shape[key] = schema;
  }

  return shape;
}

/**
 * Thay thế biến môi trường ${VAR_NAME} trong nội dung cấu hình
 */
export function interpolateEnvVars(text: string): string {
  return text.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, varName) => {
    return process.env[varName] !== undefined ? process.env[varName] : `\${${varName}}`;
  });
}

/**
 * Load and parse mcp_config.json
 */
export async function loadMcpConfig(): Promise<McpConfigFile> {
  const otterConfig = path.join(os.homedir(), ".otter", "mcp_config.json");
  const candidates = [
    otterConfig,
    path.resolve("mcp_config.json"),
    path.resolve("mcpServers.json"),
    path.resolve("config/mcp_config.json")
  ];

  for (const candidate of candidates) {
    try {
      const content = await fs.readFile(candidate, "utf-8");
      configFilePath = candidate;

      // Nếu tìm thấy ở local project mà trong ~/.otter chưa có, tự động đồng bộ sang ~/.otter
      if (candidate !== otterConfig && !fsSync.existsSync(otterConfig)) {
        try {
          const otterDir = path.dirname(otterConfig);
          if (!fsSync.existsSync(otterDir)) fsSync.mkdirSync(otterDir, { recursive: true });
          fsSync.copyFileSync(candidate, otterConfig);
          configFilePath = otterConfig;
          console.log(`[MCP Gateway] 📦 Đã tự động đồng bộ cấu hình sang ${otterConfig}`);
        } catch {}
      }

      const interpolated = interpolateEnvVars(content);
      return JSON.parse(interpolated);
    } catch {}
  }

  return { mcpServers: {} };
}

/**
 * Save configuration back to mcp_config.json
 */
export async function saveMcpConfig(config: McpConfigFile): Promise<void> {
  const targetPath = configFilePath || path.resolve("mcp_config.json");
  await fs.writeFile(targetPath, JSON.stringify(config, null, 2), "utf-8");
  await reloadExternalMcpServers();
}

/**
 * Add or update an external server configuration
 */
export async function addExternalServer(name: string, serverConfig: McpServerConfig): Promise<ServerState> {
  const config = await loadMcpConfig();
  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers[name] = serverConfig;
  await saveMcpConfig(config);
  return serversCache.get(name) || {
    name,
    config: serverConfig,
    status: "idle",
    tools: [],
    lastChecked: Date.now()
  };
}

/**
 * Delete an external server from config
 */
export async function removeExternalServer(name: string): Promise<boolean> {
  const config = await loadMcpConfig();
  if (!config.mcpServers || !config.mcpServers[name]) return false;
  delete config.mcpServers[name];
  await saveMcpConfig(config);
  return true;
}

/**
 * Refresh tool list from a specific HTTP MCP server
 */
async function fetchToolsFromHttpServer(serverKey: string, config: McpServerConfig): Promise<ExternalTool[]> {
  if (!config.url) {
    throw new Error(`MCP Server '${serverKey}' does not have a 'url' specified.`);
  }

  const timeoutMs = config.timeoutMs || 10000;
  const headers = {
    "Content-Type": "application/json",
    ...(config.headers || {})
  };

  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {}
  };

  const sec = validateSecureUrl(config.url);
  if (!sec.secure) {
    throw new Error(sec.reason || `URL server không an toàn: ${config.url}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${errText}`);
    }

    const data: any = await res.json();
    if (data.error) {
      throw new Error(`MCP Error ${data.error.code}: ${data.error.message}`);
    }

    const rawTools: any[] = data.result?.tools || [];
    const tools: ExternalTool[] = rawTools.map((t) => ({
      serverKey,
      originalName: t.name,
      qualifiedName: `${serverKey}_${t.name}`,
      title: t.title || t.name,
      description: t.description || `[${serverKey}] Tool: ${t.name}`,
      inputSchema: t.inputSchema || { type: "object", properties: {} },
      annotations: t.annotations
    }));

    return tools;
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Refresh tool list from a Stdio MCP server
 */
async function fetchToolsFromStdioServer(serverKey: string, config: McpServerConfig): Promise<ExternalTool[]> {
  if (!config.command) {
    throw new Error(`MCP Server '${serverKey}' does not have a 'command' specified for stdio transport.`);
  }

  await closeStdioSession(serverKey);

  const envMerged: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(config.env || {})
  };
  for (const [k, v] of Object.entries(envMerged)) {
    if (typeof v === "string") {
      envMerged[k] = interpolateEnvVars(v);
    }
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: (config.args || []).map((a) => interpolateEnvVars(a)),
    env: envMerged,
    cwd: config.cwd,
    stderr: "pipe"
  });

  const client = new Client(
    { name: `otter-client-${serverKey}`, version: "2.0.0" },
    { capabilities: {} }
  );

  transport.onclose = () => {
    stdioSessions.delete(serverKey);
    const state = serversCache.get(serverKey);
    if (state && state.status === "connected") {
      state.status = "idle";
      state.error = "Stdio process exited";
    }
  };

  transport.onerror = (err: Error) => {
    const state = serversCache.get(serverKey);
    if (state) {
      state.status = "error";
      state.error = err.message;
    }
  };

  await client.connect(transport);
  stdioSessions.set(serverKey, { client, transport });

  const listRes = await client.listTools();
  const rawTools: any[] = listRes.tools || [];
  const tools: ExternalTool[] = rawTools.map((t) => ({
    serverKey,
    originalName: t.name,
    qualifiedName: `${serverKey}_${t.name}`,
    title: t.title || t.name,
    description: t.description || `[${serverKey}] Tool: ${t.name}`,
    inputSchema: t.inputSchema || { type: "object", properties: {} },
    annotations: t.annotations
  }));

  return tools;
}

/**
 * Reload all configured external MCP servers
 */
export async function reloadExternalMcpServers(): Promise<ServerState[]> {
  const configFile = await loadMcpConfig();
  const configuredServers = configFile.mcpServers || {};

  // Remove servers that are no longer in config
  for (const key of serversCache.keys()) {
    if (!configuredServers[key]) {
      serversCache.delete(key);
      await closeStdioSession(key);
    }
  }

  const entries = Object.entries(configuredServers);
  await Promise.all(
    entries.map(async ([key, config]) => {
      let state = serversCache.get(key);
      if (!state) {
        state = {
          name: key,
          config,
          status: "connecting",
          tools: [],
          lastChecked: Date.now()
        };
        serversCache.set(key, state);
      } else {
        state.config = config;
        state.status = "connecting";
      }

      try {
        if (config.type === "stdio") {
          const tools = await fetchToolsFromStdioServer(key, config);
          state.tools = tools;
          state.status = "connected";
          state.error = undefined;
          state.lastChecked = Date.now();
          console.log(`[MCP Gateway] 🚀 Connected stdio server '${key}' (${config.command}) with ${tools.length} tools`);
        } else {
          // HTTP / Streamable HTTP server
          const tools = await fetchToolsFromHttpServer(key, config);
          state.tools = tools;
          state.status = "connected";
          state.error = undefined;
          state.lastChecked = Date.now();
          console.log(`[MCP Gateway] Connected to '${key}' at ${config.url} (${tools.length} tools loaded)`);
        }
      } catch (err: any) {
        state.status = "error";
        state.error = err.message;
        state.lastChecked = Date.now();
        const target = config.type === "stdio" ? `${config.command} ${(config.args || []).join(" ")}` : config.url;
        console.warn(`[MCP Gateway] Could not connect to '${key}' (${target}): ${err.message}`);
      }
    })
  );

  for (const fn of reloadListeners) {
    try { fn(); } catch (err) { console.error("[MCP Gateway] Listener error:", err); }
  }

  return Array.from(serversCache.values());
}

type ReloadListener = () => void;
const reloadListeners: ReloadListener[] = [];

export function onExternalServersReloaded(listener: ReloadListener): () => void {
  reloadListeners.push(listener);
  return () => {
    const idx = reloadListeners.indexOf(listener);
    if (idx !== -1) reloadListeners.splice(idx, 1);
  };
}

/**
 * Execute an external tool call
 */
export async function executeExternalTool(
  serverKey: string,
  toolName: string,
  args: Record<string, any> = {},
  onActivity?: (evt: any) => void
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const server = serversCache.get(serverKey);
  if (!server) {
    return {
      content: [{ type: "text", text: `Error: External MCP server '${serverKey}' not found.` }],
      isError: true
    };
  }

  onActivity?.({
    type: "mcp_tool_call",
    server: serverKey,
    tool: toolName,
    args
  });

  if (server.config.type === "stdio") {
    let session = stdioSessions.get(serverKey);
    if (!session) {
      try {
        await fetchToolsFromStdioServer(serverKey, server.config);
        session = stdioSessions.get(serverKey);
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Failed to reconnect stdio server '${serverKey}': ${err.message}` }],
          isError: true
        };
      }
    }

    if (!session) {
      return {
        content: [{ type: "text", text: `Error: Stdio server '${serverKey}' is not running.` }],
        isError: true
      };
    }

    try {
      const result = await session.client.callTool({
        name: toolName,
        arguments: args
      });
      const content = Array.isArray(result.content)
        ? result.content
        : [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }];
      return {
        content: content as Array<{ type: string; text: string }>,
        isError: Boolean(result.isError)
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Failed to execute stdio ${serverKey}/${toolName}: ${err.message}` }],
        isError: true
      };
    }
  }

  if (!server.config.url) {
    return {
      content: [{ type: "text", text: `Error: External MCP server '${serverKey}' has no URL.` }],
      isError: true
    };
  }

  const timeoutMs = server.config.timeoutMs || 30000;
  const headers = {
    "Content-Type": "application/json",
    ...(server.config.headers || {})
  };

  const payload = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: {
      name: toolName,
      arguments: args
    }
  };

  const sec = validateSecureUrl(server.config.url);
  if (!sec.secure) {
    return {
      content: [{ type: "text", text: sec.reason || `URL server không an toàn: ${server.config.url}` }],
      isError: true,
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(server.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        content: [{ type: "text", text: `HTTP error ${res.status} from ${serverKey}: ${errText}` }],
        isError: true
      };
    }

    const data: any = await res.json();
    if (data.error) {
      return {
        content: [{ type: "text", text: `Error from ${serverKey} (${data.error.code}): ${data.error.message}` }],
        isError: true
      };
    }

    const result = data.result;
    if (result && Array.isArray(result.content)) {
      return {
        content: result.content,
        isError: Boolean(result.isError)
      };
    }

    return {
      content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
      isError: false
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    return {
      content: [{ type: "text", text: `Failed to execute ${serverKey}/${toolName}: ${err.message}` }],
      isError: true
    };
  }
}

/**
 * Register all cached external tools into an McpServer instance
 */
export function registerExternalToolsToMcpServer(mcp: McpServer, onActivity?: (evt: any) => void): number {
  let count = 0;

  // Clean up any previously registered external tools on this mcp instance to allow re-registration
  const registered = (mcp as any)._registeredTools;
  if (registered && typeof registered === "object") {
    for (const key of Object.keys(registered)) {
      if ((registered[key] as any)?.__isExternalMcpTool) {
        delete registered[key];
      }
    }
  }

  for (const server of serversCache.values()) {
    if (server.status !== "connected") continue;

    for (const tool of server.tools) {
      try {
        const shape = jsonSchemaToZodShape(tool.inputSchema);

        mcp.tool(
          tool.qualifiedName,
          tool.description,
          shape,
          async (args: any) => {
            return await executeExternalTool(tool.serverKey, tool.originalName, args, onActivity);
          }
        );

        if (registered && registered[tool.qualifiedName]) {
          registered[tool.qualifiedName].__isExternalMcpTool = true;
        }

        count++;
      } catch (err: any) {
        console.warn(`[MCP Gateway] Could not register tool '${tool.qualifiedName}': ${err.message}`);
      }
    }
  }

  return count;
}

/**
 * Get all external tools formatted as OpenAPI Path definitions
 */
export function getExternalToolsOpenApiPaths(): Record<string, any> {
  const paths: Record<string, any> = {};

  for (const server of serversCache.values()) {
    if (server.status !== "connected") continue;

    for (const tool of server.tools) {
      const pathKey = `/api/mcp/ext/${tool.serverKey}/${tool.originalName}`;
      paths[pathKey] = {
        post: {
          operationId: tool.qualifiedName,
          summary: `[${tool.serverKey}] ${tool.title || tool.originalName}`,
          description: tool.description,
          tags: [`MCP: ${tool.serverKey}`],
          requestBody: {
            required: Boolean(tool.inputSchema?.required?.length),
            content: {
              "application/json": {
                schema: tool.inputSchema || { type: "object", properties: {} }
              }
            }
          },
          responses: {
            "200": {
              description: "Kết quả thực thi từ MCP Server bên ngoài",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      content: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            type: { type: "string" },
                            text: { type: "string" }
                          }
                        }
                      },
                      isError: { type: "boolean" }
                    }
                  }
                }
              }
            }
          }
        }
      };
    }
  }

  return paths;
}

/**
 * Get list of all servers and their tools for reporting / API
 */
export function getExternalServersState(): ServerState[] {
  return Array.from(serversCache.values());
}

/**
 * Initialize gateway and start file watcher
 */
export async function initMcpGateway(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  await reloadExternalMcpServers();

  // Watch for mcp_config.json changes
  try {
    const configPath = path.resolve("mcp_config.json");
    if (fsSync.existsSync(configPath)) {
      fsSync.watch(configPath, async (eventType) => {
        if (eventType === "change" || eventType === "rename") {
          console.log("[MCP Gateway] mcp_config.json modified, reloading external servers...");
          await reloadExternalMcpServers();
        }
      });
    }
  } catch (err: any) {
    console.warn(`[MCP Gateway] File watcher could not be attached: ${err.message}`);
  }
}

/**
 * Close and clean up all active stdio sessions
 */
export async function closeAllStdioSessions(): Promise<void> {
  const keys = Array.from(stdioSessions.keys());
  for (const key of keys) {
    await closeStdioSession(key);
  }
}

if (typeof process !== "undefined") {
  process.on("exit", () => {
    closeAllStdioSessions().catch(() => {});
  });
}
