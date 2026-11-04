/**
 * VPS SSH & SFTP Bridge for Otter Daemon
 * Connects MCP server to Python Paramiko engine (scripts/vps_ssh.py)
 */
import { spawn } from "bun";
import * as path from "node:path";
import * as fs from "node:fs";

export interface VpsConnectArgs {
  host: string;
  user?: string;
  port?: number;
  key?: string;
  password?: string;
  passphrase?: string;
  timeout?: number;
}

export interface VpsExecArgs extends VpsConnectArgs {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface VpsUploadArgs extends VpsConnectArgs {
  local: string;
  remote: string;
}

export interface VpsDownloadArgs extends VpsConnectArgs {
  remote: string;
  local: string;
}

export interface VpsListArgs extends VpsConnectArgs {
  remote_dir: string;
}

export interface VpsEngineCmd {
  cmd: string[];
  mode: "binary" | "python";
  enginePath: string;
}

export function resolveVpsEngine(payload: string): VpsEngineCmd {
  const isWin = process.platform === "win32";
  const binaryName = isWin ? "vps_ssh.exe" : "vps_ssh";

  const exeDir = path.dirname(process.execPath);
  const cwd = process.cwd();

  const candidateBinaries = [
    path.join(cwd, "tools", "vps-ssh", binaryName),
    path.join(exeDir, "tools", "vps-ssh", binaryName),
    path.join(cwd, "bin", binaryName),
    path.join(exeDir, "bin", binaryName),
    path.join(exeDir, binaryName),
    path.join(cwd, binaryName),
  ];

  for (const binPath of candidateBinaries) {
    if (fs.existsSync(binPath)) {
      return {
        cmd: [binPath, "--json", payload],
        mode: "binary",
        enginePath: binPath
      };
    }
  }

  // Fallback: Tìm script Python vps_ssh.py nếu máy khách có cài Python
  const candidateScripts = [
    path.join(cwd, "tools", "vps-ssh", "vps_ssh.py"),
    path.join(exeDir, "tools", "vps-ssh", "vps_ssh.py"),
    path.join(cwd, "scripts", "vps_ssh.py"),
    path.join(exeDir, "scripts", "vps_ssh.py"),
    path.join(cwd, "vps_ssh.py"),
    path.join(exeDir, "vps_ssh.py"),
    path.resolve("tools/vps-ssh/vps_ssh.py"),
    path.resolve("scripts/vps_ssh.py")
  ];

  const pythonBin = process.env.PYTHON_BIN || (isWin ? "python" : "python3");

  for (const pyPath of candidateScripts) {
    if (fs.existsSync(pyPath)) {
      return {
        cmd: [pythonBin, pyPath, "--json", payload],
        mode: "python",
        enginePath: pyPath
      };
    }
  }

  const defaultScript = path.resolve("tools/vps-ssh/vps_ssh.py");
  return {
    cmd: [pythonBin, defaultScript, "--json", payload],
    mode: "python",
    enginePath: defaultScript
  };
}

export async function invokeVpsSsh(
  action: string,
  args: Record<string, any>
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const payload = JSON.stringify({ action, ...args });
  const engine = resolveVpsEngine(payload);

  try {
    const proc = spawn({
      cmd: engine.cmd,
      stdout: "pipe",
      stderr: "pipe"
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ]);

    await proc.exited;

    const trimmedOut = stdout.trim();
    if (!trimmedOut) {
      return {
        ok: false,
        error: stderr.trim() || "Python VPS engine produced no output"
      };
    }

    try {
      const parsed = JSON.parse(trimmedOut);
      if (parsed.ok) {
        return { ok: true, data: parsed };
      } else {
        return { ok: false, error: parsed.error || "Thực thi thất bại", data: parsed };
      }
    } catch {
      return { ok: false, error: trimmedOut };
    }
  } catch (err: any) {
    return { ok: false, error: `Lỗi gọi engine VPS SSH: ${err.message}` };
  }
}
