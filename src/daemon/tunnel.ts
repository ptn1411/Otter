import { spawn, type Subprocess } from "bun";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

let tunnelProcess: Subprocess | null = null;
let currentTunnelUrl: string | null = null;
let tunnelStatus: "idle" | "starting" | "running" | "error" | "stopped" = "idle";
let lastTunnelError: string | null = null;

const isWin = process.platform === "win32";
const binaryName = isWin ? "cloudflared.exe" : "cloudflared";

/**
 * Tìm vị trí khả dụng của binary cloudflared trên máy
 */
export function getCloudflaredPath(): string | null {
  const candidates = [
    // 1. Thư mục bin/ cục bộ dự án
    path.join(process.cwd(), "bin", binaryName),
    // 2. Thư mục bin/ cùng cấp với file thực thi otter.exe khi đã compile
    path.join(path.dirname(process.execPath), "bin", binaryName),
    // 3. Thư mục cài đặt chuẩn trong AppData của Windows
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Otter", "bin", binaryName) : null,
    // 4. Đường dẫn hệ thống phổ biến
    "C:\\App\\cloudflared\\cloudflared.exe"
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 5. Kiểm tra PATH hệ thống
  try {
    const whichCmd = isWin ? ["where.exe", "cloudflared"] : ["which", "cloudflared"];
    const proc = Bun.spawnSync(whichCmd);
    if (proc.exitCode === 0) {
      const out = proc.stdout.toString().trim().split("\r\n")[0]?.split("\n")[0];
      if (out && fs.existsSync(out)) return out;
    }
  } catch {}

  return null;
}

/**
 * Khởi động Cloudflare Quick Tunnel (TryCloudflare) dùng 1 lần không cần tài khoản
 */
export async function startQuickTunnel(port: number = 1993, onUrlReady?: (url: string) => void): Promise<string> {
  if (tunnelProcess && currentTunnelUrl) {
    return currentTunnelUrl;
  }

  const cloudflaredPath = getCloudflaredPath();
  if (!cloudflaredPath) {
    const err = "Không tìm thấy file thực thi 'cloudflared' trong bin/ hoặc hệ thống.";
    tunnelStatus = "error";
    lastTunnelError = err;
    throw new Error(err);
  }

  tunnelStatus = "starting";
  lastTunnelError = null;

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        tunnelStatus = "error";
        lastTunnelError = "Hết thời gian chờ cấp phát Quick Tunnel (15s).";
        reject(new Error(lastTunnelError));
      }
    }, 20000);

    try {
      // Đảm bảo có file cấu hình trống để cloudflared KHÔNG nạp nhầm config.yml cũ của máy (tránh bị 404)
      const isolatedConfigPath = path.join(process.cwd(), "scratch", "quick-tunnel.yml");
      if (!fs.existsSync(path.dirname(isolatedConfigPath))) {
        fs.mkdirSync(path.dirname(isolatedConfigPath), { recursive: true });
      }
      if (!fs.existsSync(isolatedConfigPath)) {
        fs.writeFileSync(isolatedConfigPath, "# Quick Tunnel Empty Config\n", "utf8");
      }

      tunnelProcess = spawn({
        cmd: [cloudflaredPath, "tunnel", "--config", isolatedConfigPath, "--url", `http://127.0.0.1:${port}`],
        stdout: "pipe",
        stderr: "pipe",
        onExit(proc, exitCode, signalCode, error) {
          tunnelStatus = "stopped";
          currentTunnelUrl = null;
          tunnelProcess = null;
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error(`cloudflared thoát đột ngột (code: ${exitCode}, error: ${error})`));
          }
        }
      });

      const handleStreamData = (chunk: Uint8Array) => {
        const text = new TextDecoder().decode(chunk);
        // Bắt domain trycloudflare.com — LOẠI TRỪ api.trycloudflare.com:
        // đó là endpoint API của Cloudflare, xuất hiện trong cả thông báo
        // lỗi khi xin tunnel thất bại; regex cũ đã nhận nhầm nó thành
        // domain tunnel (bug gặp ngày 2026-10-31 trên VM này).
        const match = text.match(/https:\/\/(?!api\.)[a-zA-Z0-9-]+\.trycloudflare\.com/i);
        if (match && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          currentTunnelUrl = match[0];
          tunnelStatus = "running";

          try {
            const savePaths = [
              path.join(process.cwd(), "tunnel.url"),
              path.join(os.homedir(), ".otter", "tunnel.url"),
              process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Otter", "tunnel.url") : null
            ].filter(Boolean) as string[];

            for (const sp of savePaths) {
              const d = path.dirname(sp);
              if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
              fs.writeFileSync(sp, currentTunnelUrl, "utf8");
            }
          } catch {}

          console.log(`\n=======================================================`);
          console.log(`[+] 🌐 Cloudflare Quick Tunnel: ${currentTunnelUrl}`);
          console.log(`[+] 🔗 MCP Endpoint: ${currentTunnelUrl}/mcp`);
          console.log(`[+] 🔗 SSE Endpoint: ${currentTunnelUrl}/sse`);
          console.log(`[+] ⚡ Không cần tài khoản, miễn phí 100%, sẵn sàng dùng!`);
          console.log(`=======================================================\n`);

          onUrlReady?.(currentTunnelUrl);
          resolve(currentTunnelUrl);
        }
      };

      (async () => {
        if (tunnelProcess?.stdout) {
          for await (const chunk of tunnelProcess.stdout) {
            handleStreamData(chunk);
          }
        }
      })();

      (async () => {
        if (tunnelProcess?.stderr) {
          for await (const chunk of tunnelProcess.stderr) {
            handleStreamData(chunk);
          }
        }
      })();

    } catch (err: any) {
      clearTimeout(timeout);
      tunnelStatus = "error";
      lastTunnelError = err.message;
      reject(err);
    }
  });
}

/**
 * Dừng tiến trình Quick Tunnel
 */
export function stopQuickTunnel(): void {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch {}
    tunnelProcess = null;
    currentTunnelUrl = null;
    tunnelStatus = "stopped";
    console.log("[*] Đã dừng Cloudflare Quick Tunnel.");
  }
}

/**
 * Lấy trạng thái hiện tại của Tunnel
 */
export function getQuickTunnelStatus() {
  return {
    status: tunnelStatus,
    url: currentTunnelUrl,
    mcpUrl: currentTunnelUrl ? `${currentTunnelUrl}/mcp` : null,
    sseUrl: currentTunnelUrl ? `${currentTunnelUrl}/sse` : null,
    error: lastTunnelError
  };
}

// Đảm bảo dọn dẹp tiến trình ngầm khi thoát daemon
process.on("exit", () => stopQuickTunnel());
process.on("SIGINT", () => {
  stopQuickTunnel();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stopQuickTunnel();
  process.exit(0);
});
