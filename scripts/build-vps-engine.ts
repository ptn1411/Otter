import * as fs from "node:fs";
import * as path from "node:path";
import { execSync, spawnSync } from "node:child_process";

const rootDir = process.cwd();
const isWin = process.platform === "win32";
const outputBinName = isWin ? "vps_ssh.exe" : "vps_ssh";
const targetBinDir = path.join(rootDir, "tools", "vps-ssh");
const targetBinPath = path.join(targetBinDir, outputBinName);

console.log("========================================================");
console.log("    BUILD VPS SSH ENGINE (STANDALONE EXECUTABLE)       ");
console.log("========================================================");

// 1. Tìm Python phù hợp
function findPython(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;

  if (isWin) {
    const candidates = [
      path.join(process.env.USERPROFILE || "", ".pyenv/pyenv-win/versions/3.12.10/python.exe"),
      "python",
      "py",
      "python3"
    ];
    for (const cand of candidates) {
      if (cand.includes("/") || cand.includes("\\")) {
        if (fs.existsSync(cand)) return cand;
      } else {
        const res = spawnSync("where.exe", [cand], { encoding: "utf8" });
        if (res.status === 0 && res.stdout.trim()) {
          const first = res.stdout.trim().split(/\r?\n/)[0];
          if (fs.existsSync(first)) return first;
        }
      }
    }
  } else {
    for (const cand of ["python3", "python"]) {
      const res = spawnSync("which", [cand], { encoding: "utf8" });
      if (res.status === 0 && res.stdout.trim()) {
        return res.stdout.trim();
      }
    }
  }

  return isWin ? "python" : "python3";
}

const pythonBin = findPython();
console.log(`[*] Sử dụng Python: ${pythonBin}`);

// 2. Kiểm tra & cài đặt dependencies (paramiko, pyinstaller)
console.log("[*] Kiểm tra các gói phụ thuộc (paramiko, pyinstaller)...");
try {
  execSync(`"${pythonBin}" -c "import paramiko; import PyInstaller"`, { stdio: "ignore" });
  console.log("[+] paramiko và PyInstaller đã sẵn sàng.");
} catch {
  console.log("[*] Đang cài đặt paramiko và PyInstaller...");
  execSync(`"${pythonBin}" -m pip install --quiet paramiko pyinstaller`, { stdio: "inherit" });
}

// 3. Chuẩn bị thư mục tools/vps-ssh
fs.mkdirSync(targetBinDir, { recursive: true });

// 4. Chạy PyInstaller
console.log(`[*] Đang biên dịch Standalone Executable: tools/vps-ssh/${outputBinName}...`);
const scriptPath = path.join(rootDir, "tools", "vps-ssh", "vps_ssh.py");
const pyinstallerCmd = `"${pythonBin}" -m PyInstaller --onefile --clean --name vps_ssh --distpath "${targetBinDir}" "${scriptPath}"`;

try {
  execSync(pyinstallerCmd, { stdio: "inherit", cwd: rootDir });
} catch (err: any) {
  console.error(`[!] Lỗi khi chạy PyInstaller: ${err.message}`);
  process.exit(1);
}

// 5. Kiểm thử binary
if (fs.existsSync(targetBinPath)) {
  const stat = fs.statSync(targetBinPath);
  const sizeMB = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`\n[+] BIÊN DỊCH THÀNH CÔNG: ${targetBinPath} (${sizeMB} MB)`);

  console.log("[*] Đang kiểm tra chạy thử binary với --help...");
  const testRes = spawnSync(targetBinPath, ["--help"], { encoding: "utf8" });
  if (testRes.status === 0) {
    console.log("[+] Binary hoạt động hoàn hảo! Đã sẵn sàng phân phối cho khách hàng.");
  } else {
    console.warn(`[!] Cảnh báo kiểm thử (--help code ${testRes.status}): ${testRes.stderr || testRes.stdout}`);
  }
} else {
  console.error(`[!] Không tìm thấy file đầu ra tại: ${targetBinPath}`);
  process.exit(1);
}
