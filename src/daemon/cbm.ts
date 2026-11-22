/**
 * Codebase Memory (CBM) Bridge for Otter Daemon
 * Connects ChatGPT Web to codebase-memory-mcp persistent knowledge graph.
 *
 * Khi daemon nội bộ (--cbm-daemon-internal) giữ lock mà không trả lời rendezvous,
 * invokeCbm xác minh đúng process đó, dừng nó, rồi chạy lại CLI đúng một lần.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let cachedBinaryPath: string | null = null;
let lastActiveProject: string = process.env.CBM_PROJECT || "otter";

const PROJECT_SCOPED_TOOLS = new Set([
  "search_graph",
  "trace_path",
  "get_code_snippet",
  "get_architecture",
  "manage_adr",
  "search_code",
]);

const STALE_DAEMON_RE = /endpoint is held by pid (\d+) but that process answered no rendezvous/i;

export type CbmToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type CbmProcessInfo = {
  imageName: string;
  commandLine: string;
};

export type CbmDaemonProbe = {
  inspect(pid: number): Promise<CbmProcessInfo | null>;
  stop(pid: number): Promise<boolean>;
};

type CliRun = {
  result: CbmToolResult;
  diagnosticText: string;
  project?: string;
};

const recoveryInFlight = new Map<number, Promise<boolean>>();

export async function getCbmBinaryPath(): Promise<string> {
  if (cachedBinaryPath) return cachedBinaryPath;

  const isWin = process.platform === "win32";
  const exeName = isWin ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";

  const candidatePaths = [
    path.resolve("bin", exeName),
    path.join(__dirname, "..", "..", "bin", exeName),
    process.env.CBM_BINARY_PATH || "",
    isWin && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "codebase-memory-mcp", exeName)
      : "",
    "/opt/homebrew/bin/codebase-memory-mcp",
    "/usr/local/bin/codebase-memory-mcp",
    path.join(os.homedir(), ".cargo", "bin", exeName),
    path.join(os.homedir(), ".local", "bin", exeName),
    path.join(os.homedir(), "bin", exeName),
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate);
      cachedBinaryPath = candidate;
      console.log(`[Codebase Memory] Using binary at: ${candidate}`);
      return candidate;
    } catch {
      // Tiếp tục tìm vị trí kế tiếp
    }
  }

  cachedBinaryPath = exeName;
  return cachedBinaryPath;
}

export function getLastActiveProject(): string {
  return lastActiveProject;
}

export function setLastActiveProject(project: string) {
  if (project) {
    lastActiveProject = project;
  }
}

/**
 * PID trong câu "endpoint is held by pid N but that process answered no rendezvous".
 * Trả null khi câu lỗi không khớp, để lỗi khác không bị đem đi kill process.
 */
export function parseStaleCbmDaemonPid(text: string): number | null {
  const match = text.match(STALE_DAEMON_RE);
  if (!match) return null;
  const pid = Number(match[1]);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return pid;
}

/**
 * Chỉ nhận process daemon nội bộ. CLI `codebase-memory-mcp cli ...` cùng tên exe
 * nhưng không có --cbm-daemon-internal, nên không được dừng.
 * `comm` trên Linux bị cắt còn 15 ký tự (`codebase-memor`), nên image chỉ cần bắt đầu bằng codebase-memo
 * khi command line đã chứa đủ tên binary và cờ daemon.
 */
export function isCbmInternalDaemonCommand(imageName: string, commandLine: string): boolean {
  const command = commandLine.toLowerCase();
  if (!command.includes("codebase-memory-mcp") || !command.includes("--cbm-daemon-internal")) {
    return false;
  }
  const base = imageName.trim().replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  if (!base) return true;
  return base === "codebase-memory-mcp" || base === "codebase-memory-mcp.exe" || base.startsWith("codebase-memo");
}

export function resetCbmRecoveryForTests(): void {
  recoveryInFlight.clear();
}

export function recoverStaleCbmDaemon(text: string, probe: CbmDaemonProbe = osProbe): Promise<boolean> {
  const pid = parseStaleCbmDaemonPid(text);
  if (!pid) return Promise.resolve(false);
  const existing = recoveryInFlight.get(pid);
  if (existing) return existing;

  const run = stopVerifiedDaemon(pid, probe).finally(() => {
    if (recoveryInFlight.get(pid) === run) {
      recoveryInFlight.delete(pid);
    }
  });
  recoveryInFlight.set(pid, run);
  return run;
}

export async function invokeCbm(toolName: string, args: Record<string, any> = {}): Promise<CbmToolResult> {
  const binaryPath = await getCbmBinaryPath();
  const callArgs = withActiveProject(toolName, args);

  try {
    let run = await runCbmCli(binaryPath, toolName, callArgs);
    rememberIndexedProject(toolName, run.project);

    const stalePid = run.result.isError ? parseStaleCbmDaemonPid(run.diagnosticText) : null;
    if (stalePid) {
      const healed = await recoverStaleCbmDaemon(run.diagnosticText);
      if (healed) {
        console.warn(`[Codebase Memory] stale daemon pid ${stalePid} did not rendezvous; cleared it and retrying once`);
        run = await runCbmCli(binaryPath, toolName, callArgs);
        rememberIndexedProject(toolName, run.project);
      }
    }

    return run.result;
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Failed to execute codebase-memory-mcp: ${err?.message ?? err}` }],
      isError: true,
    };
  }
}

function withActiveProject(toolName: string, args: Record<string, any>): Record<string, any> {
  if (args.project || !PROJECT_SCOPED_TOOLS.has(toolName)) {
    return { ...args };
  }
  return { ...args, project: lastActiveProject };
}

function rememberIndexedProject(toolName: string, project?: string) {
  if (toolName === "index_repository" && project) {
    setLastActiveProject(project);
  }
}

async function runCbmCli(binaryPath: string, toolName: string, args: Record<string, any>): Promise<CliRun> {
  const proc = Bun.spawn([binaryPath, "cli", "--quiet", "--json", toolName, JSON.stringify(args)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdoutText, stderrText] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  const { result, project } = toToolResult(stdoutText, stderrText, exitCode);
  const rendered = result.content.map((item) => item.text).join("\n");
  return {
    result,
    project,
    diagnosticText: `${stderrText}\n${stdoutText}\n${rendered}`,
  };
}

function toToolResult(stdout: string, stderr: string, exitCode: number): { result: CbmToolResult; project?: string } {
  const trimmed = stdout.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && Array.isArray(parsed.content)) {
        const project = typeof parsed.structuredContent?.project === "string"
          ? parsed.structuredContent.project
          : undefined;
        return {
          project,
          result: {
            content: parsed.content.map((item: any) => ({
              type: "text" as const,
              text: typeof item?.text === "string" ? item.text : JSON.stringify(item),
            })),
            isError: Boolean(parsed.isError),
          },
        };
      }
    } catch {
      const text = exitCode !== 0 && stderr.trim() ? `${stdout}\n${stderr}` : stdout;
      return {
        result: {
          content: [{ type: "text", text }],
          isError: exitCode !== 0,
        },
      };
    }
  }

  if (exitCode !== 0) {
    return {
      result: {
        content: [{ type: "text", text: `codebase-memory error (exit ${exitCode}):\n${stderr.trim() || trimmed}` }],
        isError: true,
      },
    };
  }

  return {
    result: {
      content: [{ type: "text", text: trimmed || "Operation completed successfully." }],
      isError: false,
    },
  };
}

async function stopVerifiedDaemon(pid: number, probe: CbmDaemonProbe): Promise<boolean> {
  try {
    const info = await probe.inspect(pid);
    if (!info) return true;
    if (!isCbmInternalDaemonCommand(info.imageName, info.commandLine)) {
      console.warn(`[Codebase Memory] refused to stop pid ${pid} (${info.imageName || "unknown"}); command line is not the internal codebase-memory daemon`);
      return false;
    }
    const stopped = await probe.stop(pid);
    if (!stopped) {
      console.warn(`[Codebase Memory] failed to stop stale daemon pid ${pid}`);
    }
    return stopped;
  } catch (err: any) {
    console.warn(`[Codebase Memory] stale daemon recovery failed for pid ${pid}: ${err?.message ?? err}`);
    return false;
  }
}

const osProbe: CbmDaemonProbe = {
  inspect: (pid) => process.platform === "win32" ? inspectWindowsProcess(pid) : inspectUnixProcess(pid),
  stop: (pid) => process.platform === "win32" ? stopWindowsProcess(pid) : stopUnixProcess(pid),
};

async function inspectWindowsProcess(pid: number): Promise<CbmProcessInfo | null> {
  const { stdout, exitCode } = await spawnText([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if (-not $p) { exit 2 }; [pscustomobject]@{ Name = [string]$p.Name; CommandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress`,
  ], 20_000);
  if (exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
    return {
      imageName: parsed?.Name == null ? "" : String(parsed.Name),
      commandLine: parsed?.CommandLine == null ? "" : String(parsed.CommandLine),
    };
  } catch {
    return null;
  }
}

async function stopWindowsProcess(pid: number): Promise<boolean> {
  const { exitCode } = await spawnText([
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue; if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }`,
  ], 20_000);
  return exitCode === 0;
}

async function inspectUnixProcess(pid: number): Promise<CbmProcessInfo | null> {
  const { stdout, exitCode } = await spawnText(["ps", "-p", String(pid), "-o", "comm=", "-o", "args="], 10_000);
  if (exitCode !== 0) return null;
  const line = stdout.trim().split(/\r?\n/).find((item) => item.trim()) ?? "";
  if (!line) return null;
  const splitAt = line.search(/\s+/);
  if (splitAt === -1) return { imageName: line, commandLine: line };
  return {
    imageName: line.slice(0, splitAt),
    commandLine: line.slice(splitAt).trim(),
  };
}

async function stopUnixProcess(pid: number): Promise<boolean> {
  try {
    process.kill(pid, "SIGKILL");
    return true;
  } catch (err: any) {
    return err?.code === "ESRCH";
  }
}

async function spawnText(command: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => {
    try { proc.kill(); } catch { /* already exited */ }
  }, timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { stdout, stderr, exitCode: await proc.exited };
  } finally {
    clearTimeout(timer);
  }
}
