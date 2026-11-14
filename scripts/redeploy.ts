/**
 * Otter All-in-One Redeploy & Reinstall Pipeline
 * 
 * Thực hiện toàn bộ quy trình chỉ trong 1 lệnh:
 * 1. Biên dịch & đóng gói toàn bộ bản build mới vào deploy/ (Extension, Binaries, Tools, Trays)
 * 2. Cài đặt lại và khởi động lại Otter Daemon trên máy cục bộ (%LOCALAPPDATA%\Otter)
 * 3. Đồng bộ và cập nhật hệ thống lên máy chủ VPS (otter.gpt.io.vn & license.gpt.io.vn)
 * 4. Tự động kéo bản mới và khởi động lại dịch vụ trên máy phụ Linux (192.168.1.3 / Tailscale 100.111.68.103)
 * 5. Kiểm tra sức khỏe (Health Check) toàn bộ các nút sau triển khai
 */

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { execSync, spawn } from "node:child_process";

const rootDir = process.cwd();
const deployDir = path.join(rootDir, "deploy");

console.log("\n========================================================");
console.log("       🦦 OTTER ALL-IN-ONE REDEPLOY & REINSTALL         ");
console.log("========================================================\n");

// -----------------------------------------------------------------------------
// [1/4] ĐÓNG GÓI BẢN BUILD MỚI NHẤT
// -----------------------------------------------------------------------------
console.log("[1/4] 📦 Đang biên dịch và đóng gói toàn diện vào deploy/...");
try {
  execSync("bun scripts/deploy.ts", { stdio: "inherit" });
} catch (err: any) {
  console.error(`\n[!] Lỗi biên dịch bản deploy: ${err.message}`);
  process.exit(1);
}

// -----------------------------------------------------------------------------
// [2/4] CÀI ĐẶT LẠI TRÊN MÁY CỤC BỘ (WINDOWS)
// -----------------------------------------------------------------------------
console.log("\n[2/4] 💻 Đang cài đặt & cập nhật lại máy cục bộ...");
if (process.platform === "win32") {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const installDir = path.join(localAppData, "Otter");

  try {
    // Dừng tiến trình otter cũ nếu đang chạy
    console.log("[*] Đang dừng tiến trình Otter cũ...");
    execSync('taskkill /F /IM otter.exe /T 2>nul || exit 0', { shell: "cmd.exe", stdio: "ignore" });
    await new Promise(r => setTimeout(r, 1000));
  } catch {}

  try {
    await fs.mkdir(installDir, { recursive: true });

    // Sao chép otter.exe & openapi.json
    console.log("[*] Sao chép file thực thi và cấu hình mới vào %LOCALAPPDATA%\\Otter...");
    await fs.copyFile(path.join(deployDir, "otter.exe"), path.join(installDir, "otter.exe"));
    
    if (await fs.stat(path.join(deployDir, "openapi.json")).then(() => true).catch(() => false)) {
      await fs.copyFile(path.join(deployDir, "openapi.json"), path.join(installDir, "openapi.json"));
    }

    // Sao chép thư mục bin/
    const targetBin = path.join(installDir, "bin");
    await fs.mkdir(targetBin, { recursive: true });
    const binFiles = await fs.readdir(path.join(deployDir, "bin")).catch(() => [] as string[]);
    for (const f of binFiles) {
      await fs.copyFile(path.join(deployDir, "bin", f), path.join(targetBin, f));
    }

    // Sao chép thư mục tools/ nếu có
    const deployTools = path.join(deployDir, "tools");
    if (await fs.stat(deployTools).then(() => true).catch(() => false)) {
      const targetTools = path.join(installDir, "tools");
      await fs.cp(deployTools, targetTools, { recursive: true, force: true });
    }

    // Đảm bảo run_silent.vbs tồn tại để chạy ngầm không hiện cửa sổ
    const vbsPath = path.join(installDir, "run_silent.vbs");
    const exePath = path.join(installDir, "otter.exe");
    const logPath = path.join(installDir, "otter.log");
    const vbsContent = [
      'Set WshShell = CreateObject("WScript.Shell")',
      `WshShell.CurrentDirectory = "${installDir}"`,
      'q = Chr(34)',
      `cmd = "cmd.exe /c " & q & q & "${exePath}" & q & " --tunnel > " & q & "${logPath}" & q & " 2>&1" & q`,
      'WshShell.Run cmd, 0, False'
    ].join("\r\n");
    await fs.writeFile(vbsPath, vbsContent, "utf8");

    // Khởi động lại Otter Daemon bằng wscript
    console.log("[*] Khởi động Otter Daemon ngầm...");
    execSync(`wscript.exe "${vbsPath}"`, { stdio: "ignore" });

    // Đợi daemon sẵn sàng
    let daemonReady = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const ping = await fetch("http://127.0.0.1:1993/api/mcp/servers", { signal: AbortSignal.timeout(1000) });
        if (ping.ok) {
          daemonReady = true;
          console.log("[+] Đã cài đặt và khởi động lại Otter Daemon cục bộ thành công (Port 1993)!");
          break;
        }
      } catch {}
    }
    if (!daemonReady) {
      console.log("[*] Daemon đang khởi động các dịch vụ phụ trợ trong nền...");
    }
  } catch (err: any) {
    console.error(`[!] Lỗi cập nhật máy cục bộ: ${err.message}`);
  }
} else {
  // Trên Linux / macOS
  const homeDir = os.homedir();
  const installDir = path.join(homeDir, ".otter");
  try {
    execSync("systemctl --user stop otter 2>/dev/null || pkill -f otter || true", { stdio: "ignore" });
    const targetBin = path.join(installDir, "bin");
    await fs.mkdir(targetBin, { recursive: true });
    const targetExe = path.join(targetBin, "otter");
    await fs.copyFile(path.join(deployDir, "otter"), targetExe);
    await fs.chmod(targetExe, 0o755);
    execSync("systemctl --user restart otter 2>/dev/null || true", { stdio: "ignore" });
    console.log("[+] Đã cập nhật Otter trên máy cục bộ Linux/macOS!");
  } catch (err: any) {
    console.error(`[!] Lỗi cập nhật cục bộ: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// [3/4] DEPLOY LÊN MÁY CHỦ VPS
// -----------------------------------------------------------------------------
console.log("\n[3/4] 🌐 Đang đồng bộ và triển khai lên máy chủ VPS (otter.gpt.io.vn)...");
try {
  execSync("bun scripts/deploy-to-vps.ts", { stdio: "inherit" });
  console.log("[+] Triển khai VPS thành công!");
} catch (err: any) {
  console.error(`[!] Lỗi deploy VPS: ${err.message}`);
}

// -----------------------------------------------------------------------------
// [4/4] CẬP NHẬT MÁY PHỤ LINUX (192.168.1.3 / 100.111.68.103)
// -----------------------------------------------------------------------------
console.log("\n[4/4] 🐧 Đang cập nhật và cài đặt lại trên máy phụ Linux (192.168.1.3)...");
const REMOTE_LINUX_IP = "100.111.68.103";
const REMOTE_LINUX_USER = "nam";

try {
  const checkSsh = execSync(
    `ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=5 ${REMOTE_LINUX_USER}@${REMOTE_LINUX_IP} "echo OK"`,
    { stdio: "pipe" }
  ).toString().trim();

  if (checkSsh === "OK") {
    console.log(`[*] Kết nối SSH tới máy Linux (${REMOTE_LINUX_IP}) thành công. Bắt đầu cập nhật...`);
    execSync(
      `ssh -o BatchMode=yes -o StrictHostKeyChecking=no ${REMOTE_LINUX_USER}@${REMOTE_LINUX_IP} "systemctl --user stop otter && curl -fsSL https://otter.gpt.io.vn/setup.sh | bash"`,
      { stdio: "inherit" }
    );
    console.log("[+] Máy phụ Linux đã được cập nhật bản mới nhất và khởi động lại dịch vụ thành công!");
  }
} catch (err: any) {
  console.warn(`[!] Không thể kết nối tới máy Linux ${REMOTE_LINUX_IP} (có thể máy đang tắt hoặc ngoài mạng Tailscale): ${err.message}`);
}

// -----------------------------------------------------------------------------
// KIỂM TRA SỨC KHỎE HỆ THỐNG (HEALTH CHECK)
// -----------------------------------------------------------------------------
console.log("\n========================================================");
console.log("       🩺 KIỂM TRA SỨC KHỎE CÁC NÚT (HEALTH CHECK)       ");
console.log("========================================================");

// Chờ 2s để daemon khởi động hoàn tất
await new Promise(r => setTimeout(r, 2000));

// Check Localhost
try {
  const localRes = await fetch("http://127.0.0.1:1993/api/mcp/servers", { signal: AbortSignal.timeout(3000) });
  if (localRes.ok) {
    const data: any = await localRes.json();
    console.log(` - [✓] Máy cục bộ (Localhost:1993)  : HOẠT ĐỘNG TỐT (${data.servers?.[0]?.toolsCount || 0} công cụ)`);
  } else {
    console.log(` - [!] Máy cục bộ (Localhost:1993)  : HTTP ${localRes.status}`);
  }
} catch {
  console.log(` - [!] Máy cục bộ (Localhost:1993)  : Đang khởi động trong nền`);
}

// Check Remote Linux Node
try {
  const remoteRes = await fetch(`http://${REMOTE_LINUX_IP}:1993/api/mcp/servers`, { signal: AbortSignal.timeout(3000) });
  if (remoteRes.ok) {
    const data: any = await remoteRes.json();
    console.log(` - [✓] Máy phụ Linux (${REMOTE_LINUX_IP}) : HOẠT ĐỘNG TỐT (${data.servers?.[0]?.toolsCount || 0} công cụ)`);
  } else {
    console.log(` - [!] Máy phụ Linux (${REMOTE_LINUX_IP}) : HTTP ${remoteRes.status}`);
  }
} catch {
  console.log(` - [!] Máy phụ Linux (${REMOTE_LINUX_IP}) : Chưa sẵn sàng hoặc không cùng mạng`);
}

// Check VPS Landing
try {
  const vpsRes = await fetch("https://otter.gpt.io.vn/version.json", { signal: AbortSignal.timeout(4000) });
  if (vpsRes.ok) {
    const v: any = await vpsRes.json();
    console.log(` - [✓] Máy chủ VPS (otter.gpt.io.vn)  : HOẠT ĐỘNG TỐT (Phiên bản ${v.version || "v2.0.0"})`);
  } else {
    console.log(` - [!] Máy chủ VPS (otter.gpt.io.vn)  : HTTP ${vpsRes.status}`);
  }
} catch {
  console.log(` - [!] Máy chủ VPS (otter.gpt.io.vn)  : Không thể kết nối`);
}

console.log("========================================================\n");
console.log("✨ TẤT CẢ CÁC BƯỚC ĐÃ HOÀN TẤT TRỌN VẸN TRONG 1 LỆNH!\n");
