/**
 * CUA (Computer-Use Agent) Daemon Supervisor & Execution Bridge
 *
 * Implements self-healing auto-start, health-checking, interactive GUI session validation,
 * permission mode management, and official installer alignment for trycua/cua.
 */
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { getSettings, onSettingsChange } from "./settings";
import { executeCommand } from "./terminal";

export interface CuaHealthStatus {
  ok: boolean;
  installed: boolean;
  running: boolean;
  socket: string;
  driverPath?: string;
  permissionMode: "standard" | "bounded" | "unrestricted";
  interactiveSession: boolean;
  error?: string;
  macosPermissions?: {
    accessibility: boolean;
    screenRecording: boolean;
  };
}

let spawnedCuaProcess: any = null;
let ensureCuaInFlight: Promise<boolean> | null = null;
let lastStartFailureTime = 0;
const START_COOLDOWN_MS = 5000;

export function getCuaSocketPath(): string {
  return process.platform === "win32" ? "\\\\.\\pipe\\cua-driver" : "/tmp/cua-driver.sock";
}

/**
 * Checks whether the CUA driver socket/named pipe is currently listening
 */
export async function isCuaDriverListening(socketPath = getCuaSocketPath()): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let resolved = false;
    const finish = (result: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    try {
      const client = net.connect(socketPath, () => {
        client.destroy();
        finish(true);
      });
      client.on("error", () => {
        finish(false);
      });
      setTimeout(() => {
        try { client.destroy(); } catch {}
        finish(false);
      }, 500);
    } catch {
      finish(false);
    }
  });
}

/**
 * Check if running in an interactive GUI session
 */
export function isInteractiveGuiSession(): { ok: boolean; reason?: string } {
  if (process.platform === "win32") {
    // In Windows services (Session 0), interactive GUI automation cannot target user desktops
    const sessionName = process.env.SESSIONNAME || "";
    if (sessionName.toLowerCase() === "services") {
      return {
        ok: false,
        reason: "Non-interactive Windows Session 0 (service) detected. CUA requires an interactive user console or RDP session."
      };
    }
    return { ok: true };
  }

  if (process.platform === "linux") {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      return {
        ok: false,
        reason: "No DISPLAY or WAYLAND_DISPLAY found in environment. CUA requires an active X11 or Wayland GUI session."
      };
    }
    return { ok: true };
  }

  // macOS WindowServer / Aqua session
  return { ok: true };
}

/**
 * Find the cua-driver executable across local tools and system locations
 */
export async function findCuaDriverExe(): Promise<string | null> {
  const isWindows = process.platform === "win32";
  const ext = isWindows ? ".exe" : "";
  const exeDir = path.dirname(process.execPath);

  const candidates = [
    path.resolve(`tools/cua/cua-driver${ext}`),
    path.join(process.cwd(), "tools", "cua", `cua-driver${ext}`),
    path.join(exeDir, "tools", "cua", `cua-driver${ext}`),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Otter", "tools", "cua", `cua-driver${ext}`) : "",
    path.resolve(`bin/cua/cua-driver${ext}`),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Cua", "cua-driver", "bin", `cua-driver${ext}`) : "",
    path.join(os.homedir(), ".cua-driver", "packages", "current", `cua-driver${ext}`),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {}
  }

  // Check PATH
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  const targetName = `cua-driver${ext}`;
  for (const dir of pathDirs) {
    if (!dir) continue;
    const full = path.join(dir, targetName);
    try {
      await fs.access(full);
      return full;
    } catch {}
  }

  return null;
}

/**
 * Check CUA driver health status
 */
export async function getCuaHealth(): Promise<CuaHealthStatus> {
  const driverExe = await findCuaDriverExe();
  const socketPath = getCuaSocketPath();
  const listening = await isCuaDriverListening(socketPath);
  const sessionCheck = isInteractiveGuiSession();
  const settings = getSettings();
  const permissionMode = settings.cuaPermissionMode || "standard";

  const status: CuaHealthStatus = {
    ok: Boolean(driverExe && listening && sessionCheck.ok),
    installed: Boolean(driverExe),
    running: listening,
    socket: socketPath,
    driverPath: driverExe || undefined,
    permissionMode,
    interactiveSession: sessionCheck.ok,
    error: !driverExe
      ? "CUA driver is not installed on system."
      : !sessionCheck.ok
      ? sessionCheck.reason
      : !listening
      ? "CUA driver daemon is not running."
      : undefined
  };

  return status;
}

/**
 * Start the CUA driver daemon in the background with appropriate platform and permission rules
 */
export async function startCuaDriverDaemon(options?: { permissionMode?: "standard" | "bounded" | "unrestricted" }): Promise<{ ok: boolean; message?: string }> {
  const driverExe = await findCuaDriverExe();
  if (!driverExe) {
    return {
      ok: false,
      message: "CUA driver is not installed. Please run 'bun tools/cua/setup-cua.ts' or install from https://github.com/trycua/cua."
    };
  }

  const sessionCheck = isInteractiveGuiSession();
  if (!sessionCheck.ok) {
    return { ok: false, message: sessionCheck.reason };
  }

  const mode = options?.permissionMode || getSettings().cuaPermissionMode || "standard";
  const socketPath = getCuaSocketPath();

  // macOS specific trycua rules:
  // NEVER raw-spawn the bare binary on macOS because it lacks a stable bundle identity for TCC grants.
  // Must use CuaDriver.app or run embedded.
  if (process.platform === "darwin") {
    const isEmbedded = process.env.CUA_DRIVER_EMBEDDED === "1";
    const appCandidates = [
      "/Applications/CuaDriver.app",
      path.join(os.homedir(), "Applications", "CuaDriver.app"),
      "/Library/Application Support/Cua/CuaDriver.app"
    ];
    let appPath: string | null = null;
    for (const cand of appCandidates) {
      if (fsSync.existsSync(cand)) {
        appPath = cand;
        break;
      }
    }

    if (!appPath && !isEmbedded) {
      return {
        ok: false,
        message: "On macOS, cua-driver requires CuaDriver.app for proper system permissions (Accessibility and Screen Recording). Raw-spawning the bare binary is not permitted. Please install CuaDriver.app or run 'cua-driver permissions grant'."
      };
    }

    if (appPath) {
      try {
        const { spawn } = await import("bun");
        spawn({
          cmd: ["open", "-g", "-a", appPath],
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore"
        });
      } catch (err: any) {
        return { ok: false, message: `Failed to open CuaDriver.app: ${err.message}` };
      }
    }
  } else {
    // Windows & Linux: start daemon with socket and permission mode
    const args = [
      "serve",
      "--socket",
      socketPath,
      "--permission-mode",
      mode,
      "--no-overlay"
    ];

    if (mode === "unrestricted") {
      args.push("--dangerously-bypass-approvals");
    }

    try {
      const { spawn } = await import("bun");
      const child = spawn({
        cmd: [driverExe, ...args],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore"
      });
      spawnedCuaProcess = child;
    } catch (err: any) {
      return { ok: false, message: `Failed to spawn cua-driver: ${err.message}` };
    }
  }

  // Poll for socket readiness
  const maxAttempts = 30; // ~6 seconds total
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isCuaDriverListening(socketPath)) {
      console.log(`[CUA Daemon] Connected and listening on ${socketPath} (mode: ${mode})`);
      return { ok: true, message: `CUA driver daemon running on ${socketPath}` };
    }
  }

  return {
    ok: false,
    message: `CUA driver daemon failed to become ready on ${socketPath} after 6 seconds.`
  };
}

/**
 * Ensures the CUA daemon is active, self-healing with in-flight deduplication and crash cooldown
 */
export async function ensureCuaDriver(forceRestart = false): Promise<boolean> {
  if (ensureCuaInFlight) return ensureCuaInFlight;

  const run = (async (): Promise<boolean> => {
    const socketPath = getCuaSocketPath();
    const alreadyListening = await isCuaDriverListening(socketPath);

    if (alreadyListening && !forceRestart) {
      return true;
    }

    if (forceRestart && alreadyListening) {
      await stopCuaDriver();
      await new Promise((r) => setTimeout(r, 500));
    }

    // Cooldown guard to prevent crash loops
    const now = Date.now();
    if (now - lastStartFailureTime < START_COOLDOWN_MS) {
      const remainingSec = Math.ceil((START_COOLDOWN_MS - (now - lastStartFailureTime)) / 1000);
      throw new Error(`CUA daemon auto-start cooldown in effect. Please wait ${remainingSec}s before retrying.`);
    }

    const startRes = await startCuaDriverDaemon();
    if (!startRes.ok) {
      lastStartFailureTime = Date.now();
      throw new Error(`CUA daemon is not running and auto-start failed: ${startRes.message}`);
    }

    return true;
  })();

  ensureCuaInFlight = run;
  try {
    return await run;
  } finally {
    if (ensureCuaInFlight === run) {
      ensureCuaInFlight = null;
    }
  }
}

/**
 * Stop the running CUA driver daemon
 */
export async function stopCuaDriver(): Promise<void> {
  const driverExe = await findCuaDriverExe();
  if (spawnedCuaProcess) {
    try {
      spawnedCuaProcess.kill();
    } catch {}
    spawnedCuaProcess = null;
  }

  if (driverExe) {
    try {
      await executeCommand(`"${driverExe}" stop`);
    } catch {}
  }
}

/**
 * Execute a CUA tool call via the supervised CUA daemon
 */
export async function executeCuaTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
  await ensureCuaDriver();

  const driverExe = await findCuaDriverExe();
  if (!driverExe) {
    throw new Error("CUA driver is not installed on this system.");
  }

  const { spawn } = await import("bun");
  const proc = spawn({
    cmd: [driverExe, "call", toolName, JSON.stringify(args || {})],
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore"
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0 && (!stdout || stderr)) {
    throw new Error(`Lỗi CUA (${exitCode}): ${stderr || stdout}`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return stdout || "Success";
  }
}

/**
 * Read the list of CUA tools
 */
export async function getCuaToolList(): Promise<any[]> {
  const ext = process.platform === "darwin" ? "dylib" : (process.platform === "win32" ? "dll" : "so");
  const fileName = `cua_driver_sdk.${ext}`;
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.resolve("tools/cua", fileName),
    path.join(exeDir, "tools", "cua", fileName),
    path.join(process.cwd(), "tools", "cua", fileName),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Otter", "tools", "cua", fileName) : "",
    path.resolve("bin/cua", fileName),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Cua", "cua-driver", "bin", fileName) : "",
    path.join(os.homedir(), ".cua-driver", "packages", "current", fileName)
  ].filter(Boolean);

  let dllPath = "";
  for (const c of candidates) {
    try {
      await fs.access(c);
      dllPath = c;
      break;
    } catch {}
  }

  if (dllPath) {
    try {
      const { dlopen, FFIType, ptr, toArrayBuffer } = await import("bun:ffi");
      const lib = dlopen(dllPath, {
        cua_driver_create_v1: {
          args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32,
        },
        cua_driver_destroy_v1: {
          args: [FFIType.ptr],
          returns: FFIType.void,
        },
        cua_driver_list_tools_json_v1: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32,
        },
        cua_driver_buffer_free_v1: {
          args: [FFIType.ptr],
          returns: FFIType.void,
        }
      });

      const handleBuf = new BigUint64Array(1);
      const errorBuf = new Uint8Array(24);
      const emptyOptions = Buffer.from("{}");

      lib.symbols.cua_driver_create_v1(
        ptr(emptyOptions),
        BigInt(emptyOptions.length),
        ptr(handleBuf),
        ptr(errorBuf)
      );

      const handle = handleBuf[0];
      const toolsBuffer = new Uint8Array(24);
      lib.symbols.cua_driver_list_tools_json_v1(handle, ptr(toolsBuffer), ptr(errorBuf));

      const view = new DataView(toolsBuffer.buffer, toolsBuffer.byteOffset, toolsBuffer.byteLength);
      const dataPtr = view.getBigUint64(0, true);
      const dataLen = Number(view.getBigUint64(8, true));

      const ab = toArrayBuffer(dataPtr, 0, dataLen);
      const jsonStr = new TextDecoder().decode(ab);
      const parsed = JSON.parse(jsonStr);

      lib.symbols.cua_driver_buffer_free_v1(ptr(toolsBuffer));
      lib.symbols.cua_driver_destroy_v1(ptr(handleBuf));

      return Array.isArray(parsed) ? parsed : parsed.tools || [];
    } catch {}
  }

  // Fallback to calling driver CLI if FFI fails
  const driverExe = await findCuaDriverExe();
  if (driverExe) {
    try {
      const { spawn } = await import("bun");
      const proc = spawn({
        cmd: [driverExe, "list-tools", "--json"],
        stdout: "pipe",
        stderr: "pipe"
      });
      const stdout = await new Response(proc.stdout).text();
      const parsed = JSON.parse(stdout);
      return Array.isArray(parsed) ? parsed : parsed.tools || [];
    } catch {}
  }

  return [{ error: `Cannot load CUA library (${ext}): cua_driver_sdk not found in tools/cua/ or system.` }];
}

// Clean up spawned process on exit
if (typeof process !== "undefined") {
  process.on("exit", () => {
    if (spawnedCuaProcess) {
      try { spawnedCuaProcess.kill(); } catch {}
    }
  });

  // Watch for permission mode changes and restart driver if running
  onSettingsChange((updated, previous) => {
    if (updated.cuaPermissionMode !== previous.cuaPermissionMode) {
      console.log(`[CUA] Permission mode changed from ${previous.cuaPermissionMode} to ${updated.cuaPermissionMode}. Restarting driver.`);
      ensureCuaDriver(true).catch(() => {});
    }
  });
}
