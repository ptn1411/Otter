/**
 * Agent-Desktop MCP Bridge & Supervision
 *
 * Spawns `agent-desktop mcp` as a child stdio MCP server on first use (lazy-start).
 * Provides health checks, crash cooldown, auto-restart, clean shutdown (no orphan processes),
 * clear install-detection errors, and priority/fallback policy between agent-desktop and CUA.
 */
import * as fsSync from "node:fs";
import * as path from "node:path";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface AgentDesktopHealth {
  installed: boolean;
  commandPath?: string;
  running: boolean;
  cooldownActive: boolean;
  error?: string;
  statusData?: any;
}

/**
 * Locate the agent-desktop binary across platform PATH and npm global locations
 */
export function findAgentDesktopCommand(): string | null {
  const isWin = process.platform === "win32";
  const exts = isWin ? [".cmd", ".exe", ".bat", ""] : [""];
  const baseNames = ["agent-desktop"];

  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  if (isWin && process.env.APPDATA) {
    pathDirs.unshift(path.join(process.env.APPDATA, "npm"));
  }

  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const base of baseNames) {
      for (const ext of exts) {
        const full = path.join(dir, base + ext);
        try {
          if (fsSync.existsSync(full)) {
            return full;
          }
        } catch {}
      }
    }
  }

  return null;
}

const READ_ONLY_TOOLS = new Set([
  "adesktop_snapshot",
  "adesktop_find",
  "adesktop_get",
  "adesktop_is",
  "adesktop_list_windows",
  "adesktop_list_apps",
  "adesktop_screenshot",
  "adesktop_list_displays",
  "adesktop_list_surfaces",
  "adesktop_status",
  "adesktop_permissions",
  "adesktop_version",
  "adesktop_wait",
  "adesktop_skills_list",
  "adesktop_skills_get",
  "adesktop_skills_path"
]);

export class AgentDesktopBridge {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private ensureInFlight: Promise<Client> | null = null;
  private lastCrashTime = 0;
  private readonly cooldownMs = 2000;
  private isShuttingDown = false;

  constructor() {
    this.registerProcessHandlers();
  }

  private registerProcessHandlers(): void {
    if (typeof process !== "undefined") {
      const cleanup = () => {
        this.isShuttingDown = true;
        this.stop().catch(() => {});
      };
      process.on("exit", cleanup);
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    }
  }

  public isRunning(): boolean {
    return Boolean(this.client && this.transport);
  }

  /**
   * Lazily ensures the `agent-desktop mcp` child server is running and connected
   */
  public async ensureServer(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    if (this.ensureInFlight) {
      return this.ensureInFlight;
    }

    const run = (async (): Promise<Client> => {
      const now = Date.now();
      if (now - this.lastCrashTime < this.cooldownMs) {
        const remaining = this.cooldownMs - (now - this.lastCrashTime);
        await new Promise((r) => setTimeout(r, remaining));
      }

      let cmd = findAgentDesktopCommand();
      if (!cmd) {
        console.log("[AgentDesktop] Chưa tìm thấy agent-desktop, đang tự động cài đặt qua npm install -g agent-desktop...");
        try {
          const { setupAgentDesktop } = await import("../../tools/agent-desktop/setup-agent-desktop");
          await setupAgentDesktop();
          cmd = findAgentDesktopCommand();
        } catch (err: any) {
          console.warn(`[AgentDesktop] Tự động cài đặt agent-desktop thất bại: ${err.message}`);
        }
      }

      if (!cmd) {
        throw new Error(
          "agent-desktop is not installed or not found on PATH. Please install it globally by running: npm install -g agent-desktop"
        );
      }

      try {
        const transport = new StdioClientTransport({
          command: cmd,
          args: ["mcp"],
          stderr: "pipe"
        });

        const client = new Client(
          { name: "otter-agent-desktop-bridge", version: "2.0.0" },
          { capabilities: {} }
        );

        transport.onclose = () => {
          this.lastCrashTime = Date.now();
          this.cleanupSession();
          if (!this.isShuttingDown) {
            console.warn("[AgentDesktop] Child stdio process exited or crashed.");
          }
        };

        transport.onerror = (err: Error) => {
          console.warn("[AgentDesktop] Stdio transport error:", err.message);
        };

        await client.connect(transport);
        this.client = client;
        this.transport = transport;
        console.log(`[AgentDesktop] Connected to child stdio MCP server (${cmd})`);
        return client;
      } catch (err: any) {
        this.lastCrashTime = Date.now();
        this.cleanupSession();
        throw new Error(`Failed to start agent-desktop MCP child server: ${err.message}`);
      }
    })();

    this.ensureInFlight = run;
    try {
      return await run;
    } finally {
      if (this.ensureInFlight === run) {
        this.ensureInFlight = null;
      }
    }
  }

  private cleanupSession(): void {
    this.client = null;
    this.transport = null;
  }

  public async stop(): Promise<void> {
    const client = this.client;
    this.cleanupSession();
    if (client) {
      try {
        await client.close();
      } catch {}
    }
  }

  /**
   * Health check for agent-desktop
   */
  public async getHealth(): Promise<AgentDesktopHealth> {
    const cmd = findAgentDesktopCommand();
    if (!cmd) {
      return {
        installed: false,
        running: false,
        cooldownActive: false,
        error: "agent-desktop is not installed or not found on PATH. Run: npm install -g agent-desktop"
      };
    }

    const cooldownActive = Date.now() - this.lastCrashTime < this.cooldownMs;
    const running = this.isRunning();

    let statusData: any = null;
    if (running && this.client) {
      try {
        const res: any = await this.client.callTool({ name: "desktop_status", arguments: {} });
        if (res?.structuredContent?.data) {
          statusData = res.structuredContent.data;
        } else if (res?.content?.[0]?.text) {
          try {
            const parsed = JSON.parse(res.content[0].text);
            statusData = parsed.data || parsed;
          } catch {}
        }
      } catch {}
    }

    return {
      installed: true,
      commandPath: cmd,
      running,
      cooldownActive,
      statusData
    };
  }

  /**
   * Execute an agent-desktop tool by prefixed name, with priority & fallback handling
   */
  public async callTool(prefixedName: string, args: Record<string, any> = {}): Promise<any> {
    // Map adesktop_xyz -> desktop_xyz
    const originalName = prefixedName.startsWith("adesktop_")
      ? `desktop_${prefixedName.slice("adesktop_".length)}`
      : prefixedName;

    try {
      const client = await this.ensureServer();
      const res: any = await client.callTool({ name: originalName, arguments: args });

      // Check if response contains an error envelope (POLICY_DENIED or ACTION_FAILED)
      const errInfo = this.extractErrorInfo(res);
      if (errInfo) {
        return await this.handleFallback(prefixedName, originalName, args, errInfo);
      }

      console.info(`[Desktop Backend: agent-desktop] Served ${prefixedName}`);
      return res;
    } catch (err: any) {
      if (err.message?.includes("npm install -g agent-desktop")) {
        throw err;
      }
      return await this.handleFallback(prefixedName, originalName, args, {
        code: "SPAWN_OR_CRASH",
        message: err.message
      });
    }
  }

  private extractErrorInfo(res: any): { code: string; message: string } | null {
    if (!res) return null;
    if (res.isError) {
      const text = res.content?.[0]?.text || "";
      try {
        const parsed = JSON.parse(text);
        if (parsed.error) {
          return {
            code: parsed.error.code || "ACTION_FAILED",
            message: parsed.error.message || text
          };
        }
      } catch {}
      return { code: "TOOL_ERROR", message: text || "Tool execution failed" };
    }

    // Sometimes result envelope has ok: false in text/structuredContent
    const structured = res.structuredContent || (res.content?.[0]?.text ? (() => {
      try { return JSON.parse(res.content[0].text); } catch { return null; }
    })() : null);

    if (structured && structured.ok === false && structured.error) {
      const errCode = structured.error.code || "ACTION_FAILED";
      const errMsg = structured.error.message || "";
      if (
        errCode === "POLICY_DENIED" ||
        errCode === "ACTION_FAILED" ||
        errMsg.toLowerCase().includes("foreground") ||
        errMsg.toLowerCase().includes("policy")
      ) {
        return { code: errCode, message: errMsg };
      }
    }

    return null;
  }

  /**
   * Handle Part B fallback decisions
   */
  private async handleFallback(
    prefixedName: string,
    originalName: string,
    args: Record<string, any>,
    errorInfo: { code: string; message: string }
  ): Promise<any> {
    const isReadOnly = READ_ONLY_TOOLS.has(prefixedName);

    // 1. Read-only automatic fallback
    if (isReadOnly) {
      if (prefixedName === "adesktop_list_windows" || prefixedName === "adesktop_list_apps") {
        try {
          const { listWindows } = await import("./desktop");
          const windows = await listWindows();
          console.info(`[Desktop Backend: desktop (fallback)] Served ${prefixedName} after agent-desktop ${errorInfo.code}`);
          return {
            content: [{ type: "text", text: JSON.stringify(windows, null, 2) }],
            _meta: { backend: "desktop_fallback", originalError: errorInfo }
          };
        } catch {}
      }

      if (prefixedName === "adesktop_screenshot") {
        try {
          const { takeScreenshot } = await import("./desktop");
          const shot = await takeScreenshot();
          console.info(`[Desktop Backend: desktop (fallback)] Served ${prefixedName} after agent-desktop ${errorInfo.code}`);
          return {
            content: [{ type: "text", text: `Chụp ảnh màn hình fallback thành công: ${shot.filePath} (${shot.width}x${shot.height})` }],
            _meta: { backend: "desktop_fallback", originalError: errorInfo }
          };
        } catch {}
      }

      if (prefixedName === "adesktop_snapshot" || prefixedName === "adesktop_find" || prefixedName === "adesktop_get") {
        try {
          const { executeCuaTool } = await import("./cua");
          const cuaRes = await executeCuaTool("list_windows");
          console.info(`[Desktop Backend: cua (fallback)] Served ${prefixedName} after agent-desktop ${errorInfo.code}`);
          return {
            content: [{ type: "text", text: typeof cuaRes === "object" ? JSON.stringify(cuaRes, null, 2) : String(cuaRes) }],
            _meta: { backend: "cua_fallback", originalError: errorInfo }
          };
        } catch {
          const { listWindows } = await import("./desktop");
          const winList = await listWindows();
          console.info(`[Desktop Backend: desktop (fallback)] Served ${prefixedName} after agent-desktop ${errorInfo.code}`);
          return {
            content: [{ type: "text", text: JSON.stringify(winList, null, 2) }],
            _meta: { backend: "desktop_fallback", originalError: errorInfo }
          };
        }
      }
    }

    // 2. Mutating operations: safe retry only where safe equivalent exists
    if (prefixedName === "adesktop_launch") {
      const appName = args.app || args.name || "";
      if (appName) {
        try {
          const { executeCuaTool } = await import("./cua");
          const launchRes = await executeCuaTool("launch_app", { app_name: appName });
          console.info(`[Desktop Backend: cua (fallback)] Served ${prefixedName} via CUA launch_app`);
          return {
            content: [{ type: "text", text: typeof launchRes === "object" ? JSON.stringify(launchRes, null, 2) : String(launchRes) }],
            _meta: { backend: "cua_fallback", action: "launch_app" }
          };
        } catch {}
      }
    }

    if (prefixedName === "adesktop_press" && args.key) {
      try {
        const { keyboardAction } = await import("./desktop");
        const keyMsg = await keyboardAction(args.key);
        console.info(`[Desktop Backend: desktop (fallback)] Served ${prefixedName} via desktop_keyboard_action`);
        return {
          content: [{ type: "text", text: keyMsg }],
          _meta: { backend: "desktop_fallback", action: "keyboard_action" }
        };
      } catch {}
    }

    // Otherwise: Return structured error naming the fallback tool to use
    // Never silently perform an action different from what was requested.
    const structuredFallback = {
      ok: false,
      error: errorInfo.code || "ACTION_FAILED",
      message: `agent-desktop returned ${errorInfo.code}: ${errorInfo.message}. Automatic fallback was not executed to prevent unintended mutations.`,
      fallback: {
        suggestedTool: "cua_execute_tool",
        suggestedArguments: {
          toolName: prefixedName.includes("click") ? "click" : "hotkey",
          arguments: prefixedName.includes("click") ? { x: "<x_coordinate>", y: "<y_coordinate>" } : {}
        },
        alternativeTool: prefixedName.includes("click") ? "desktop_mouse_action" : "desktop_keyboard_action",
        reason: "agent-desktop operates via accessibility ref IDs. When foreground focus locks or POLICY_DENIED prevents ref-based execution, switch to CUA or coordinate-based desktop_* tools."
      }
    };

    return {
      content: [{ type: "text", text: JSON.stringify(structuredFallback, null, 2) }],
      isError: true,
      _meta: { fallbackGuidance: true, originalTool: prefixedName }
    };
  }
}

export const agentDesktopBridge = new AgentDesktopBridge();
