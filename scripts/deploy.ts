import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execSync } from "node:child_process";

// Lấy version từ package.json hoặc đối số dòng lệnh
const rootDir = process.cwd();
let pkgVersion = "2.0.0";
try {
  const pkgContent = await fs.readFile(path.join(rootDir, "package.json"), "utf8");
  const pkg = JSON.parse(pkgContent);
  if (pkg.version) pkgVersion = pkg.version;
} catch {}

const targetVersion = process.argv[2] || process.env.DEPLOY_VERSION || `v${pkgVersion}`;
const deployDir = path.join(rootDir, "deploy");
const scriptsDir = path.join(rootDir, "scripts");
const binDir = path.join(rootDir, "bin");

console.log("========================================================");
console.log(`        OTTER DEPLOYMENT PIPELINE - SINGLE DIRECTORY`);
console.log(`        Phiên bản: ${targetVersion}`);
console.log("========================================================");
console.log(`[*] Thư mục đích: ${deployDir}`);

// 1. Dọn dẹp các thư mục con cũ như v1, v2 để tiết kiệm dung lượng ổ đĩa
const oldSubdirs = ["v1", "v2", "v3", "v1.2.0"];
for (const sub of oldSubdirs) {
  const p = path.join(deployDir, sub);
  if (await fs.stat(p).then(() => true).catch(() => false)) {
    console.log(`[*] Đang xóa thư mục cũ deploy/${sub}/ để giải phóng dung lượng...`);
    await fs.rm(p, { recursive: true, force: true });
  }
}

// Đảm bảo thư mục deploy/ tồn tại
await fs.mkdir(deployDir, { recursive: true });

// 2. Chạy Build Extension (Minified & TypeScript)
console.log("\n[1/4] Đang đóng gói & nén Chrome Extension...");
execSync("bun build.extension.ts", { stdio: "inherit", cwd: rootDir });

// Nén extension zip trực tiếp vào deploy/otter-extension.zip
const extZipPath = path.join(deployDir, "otter-extension.zip");
try {
  if (process.platform === "win32") {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path 'extension/dist/*' -DestinationPath '${extZipPath}' -Force"`,
      { stdio: "inherit", cwd: rootDir }
    );
  } else {
    execSync(`cd extension/dist && zip -r "${extZipPath}" ./*`, { stdio: "inherit", cwd: rootDir });
  }
  console.log(`[+] Đã tạo extension zip: ${extZipPath}`);
} catch (err: any) {
  console.warn(`[!] Không thể nén zip tự động: ${err.message}`);
}

// 3. Biên dịch Standalone Binaries (Windows & macOS)
console.log("\n[2/4] Đang biên dịch Standalone Binaries (Windows, macOS ARM64 & Intel)...");

const buildTargets = [
  {
    name: "Windows x64",
    target: "bun-windows-x64",
    outfile: "otter-windows-x64.exe",
    alias: "otter.exe"
  },
  {
    name: "macOS Apple Silicon (M1/M2/M3/M4)",
    target: "bun-darwin-arm64",
    outfile: "otter-darwin-arm64"
  },
  {
    name: "macOS Intel (x64)",
    target: "bun-darwin-x64",
    outfile: "otter-darwin-x64"
  },
  {
    name: "Linux x64",
    target: "bun-linux-x64",
    outfile: "otter-linux-x64"
  }
];

for (const t of buildTargets) {
  console.log(`[*] Biên dịch target: ${t.name} -> ${t.outfile}...`);
  const destPath = path.join(deployDir, t.outfile);
  try {
    execSync(
      `bun build --compile --minify --target=${t.target} ./src/daemon/index.ts --outfile "${destPath}"`,
      { stdio: "inherit", cwd: rootDir }
    );

    // Tạo alias otter.exe cho Windows (cả ở deploy/ và deploy/bin/)
    if (t.alias && await fs.stat(destPath).then(() => true).catch(() => false)) {
      const aliasPath = path.join(deployDir, t.alias);
      await fs.copyFile(destPath, aliasPath);
      const deployBinDir = path.join(deployDir, "bin");
      await fs.mkdir(deployBinDir, { recursive: true });
      await fs.copyFile(destPath, path.join(deployBinDir, t.alias));
    }
  } catch (err: any) {
    console.warn(`[!] Không thể biên dịch target ${t.name}: ${err.message}`);
  }
}

// 3.1 Biên dịch Skill CLI thành file thực thi độc lập (không cần Bun)
console.log("\n[*] Đang biên dịch Skill CLI (skill.exe)...");
try {
  execSync("bun run build:skill", { stdio: "inherit", cwd: rootDir });
  console.log(`[+] Đã biên dịch tools/skill/skill.exe thành công!`);
} catch (err: any) {
  console.warn(`[!] Bỏ qua biên dịch skill.exe: ${err.message}`);
}

// 3.2 Biên dịch Otter Native Tray Controller (Rust)
console.log("\n[*] Đang biên dịch Otter Native Tray Controller (Rust)...");
try {
  execSync("cargo build --release --manifest-path tray/Cargo.toml", { stdio: "inherit", cwd: rootDir });
  const traySrc = path.join(rootDir, "tray", "target", "release", process.platform === "win32" ? "otter-tray.exe" : "otter-tray");
  const trayDest = path.join(deployDir, process.platform === "win32" ? "otter-tray.exe" : "otter-tray");
  if (await fs.stat(traySrc).then(() => true).catch(() => false)) {
    await fs.copyFile(traySrc, trayDest);
    console.log(`[+] Đã xuất file native tray vào deploy/`);
  }
} catch (err: any) {
  console.warn(`[!] Bỏ qua biên dịch tray (Rust): ${err.message}`);
}

// 4. Sao chép các Script cài đặt & chạy ngầm
console.log("\n[3/4] Sao chép scripts cài đặt 1-click & helper...");

// Copy setup.ps1 và setup.sh
const setupPs1 = path.join(scriptsDir, "setup.ps1");
const setupSh = path.join(scriptsDir, "setup.sh");

if (await fs.stat(setupPs1).then(() => true).catch(() => false)) {
  let content = await fs.readFile(setupPs1, "utf8");
  // BẮT BUỘC KHÔNG DÙNG UTF-8 BOM: Nếu có BOM (\uFEFF), lệnh 'irm ... | iex' trong PowerShell sẽ bị lỗi
  // "The assignment expression is not valid" do ký tự BOM đứng trước khối param().
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  await fs.writeFile(path.join(deployDir, "setup.ps1"), content, "utf8");
}
if (await fs.stat(setupSh).then(() => true).catch(() => false)) {
  let content = await fs.readFile(setupSh, "utf8");
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  await fs.writeFile(path.join(deployDir, "setup.sh"), content, "utf8");
}

// Tạo install.bat cho người dùng Windows (click đúp là chạy setup.ps1 với UTF-8 chuẩn xác)
const installBatContent = `@echo off
chcp 65001 >nul
title Cài đặt Otter Background Agent
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if %errorlevel% neq 0 (
    echo [!] Co loi xay ra trong qua trinh cai dat.
    pause
)
`;
await fs.writeFile(path.join(deployDir, "install.bat"), installBatContent, "utf8");

// Tạo uninstall.bat
const uninstallBatContent = `@echo off
chcp 65001 >nul
title Gỡ bỏ Otter Background Agent
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" -Uninstall
if %errorlevel% neq 0 (
    pause
)
`;
await fs.writeFile(path.join(deployDir, "uninstall.bat"), uninstallBatContent, "utf8");

// Sao chép thư mục bin (nếu có các tool phụ trợ như cloudflared, codebase-memory-mcp)
if (await fs.stat(binDir).then(() => true).catch(() => false)) {
  const targetBinDir = path.join(deployDir, "bin");
  await fs.mkdir(targetBinDir, { recursive: true });
  const binFiles = await fs.readdir(binDir);
  for (const file of binFiles) {
    const srcFile = path.join(binDir, file);
    const destFile = path.join(targetBinDir, file);
    const stat = await fs.stat(srcFile);
    if (stat.isFile()) {
      await fs.copyFile(srcFile, destFile);
    }
  }
  console.log(`[+] Đã đồng bộ thư mục bin/ vào bản deploy`);
}

// Sao chép trọn bộ thư mục tools (skill.exe, cua, vps-ssh, db-manager)
const targetToolsDir = path.join(deployDir, "tools");
await fs.mkdir(targetToolsDir, { recursive: true });
const srcToolsDir = path.join(rootDir, "tools");
if (await fs.stat(srcToolsDir).then(() => true).catch(() => false)) {
  await fs.cp(srcToolsDir, targetToolsDir, { recursive: true, force: true });
  console.log(`[+] Đã đồng bộ trọn bộ thư mục tools/ (skill, cua, vps-ssh, db-manager) vào gói deploy`);
}

// Sao chép Landing Page, OpenAPI Schema và Icon ứng dụng
const iconSrc = path.join(rootDir, "assets", "otter.ico");
if (await fs.stat(iconSrc).then(() => true).catch(() => false)) {
  await fs.copyFile(iconSrc, path.join(deployDir, "otter.ico"));
  console.log(`[+] Đã xuất otter.ico vào deploy/otter.ico`);
}

const landingSrc = path.join(rootDir, "landing-page-live.html");
if (await fs.stat(landingSrc).then(() => true).catch(() => false)) {
  await fs.copyFile(landingSrc, path.join(deployDir, "index.html"));
  console.log(`[+] Đã xuất landing page vào deploy/index.html`);
}
const openapiSrc = path.join(rootDir, "openapi.json");
if (await fs.stat(openapiSrc).then(() => true).catch(() => false)) {
  await fs.copyFile(openapiSrc, path.join(deployDir, "openapi.json"));
  console.log(`[+] Đã xuất openapi.json vào deploy/openapi.json`);
}

// 5. Tạo version.json và README hướng dẫn
console.log("\n[4/4] Tạo metadata phiên bản & tài liệu hướng dẫn...");

let gitCommit = "unknown";
try {
  gitCommit = execSync("git rev-parse --short HEAD", { cwd: rootDir }).toString().trim();
} catch {}

const files = await fs.readdir(deployDir);
const artifactsSummary = [];
for (const file of files) {
  const stat = await fs.stat(path.join(deployDir, file));
  if (stat.isFile()) {
    artifactsSummary.push({
      file,
      sizeBytes: stat.size,
      sizeMB: (stat.size / (1024 * 1024)).toFixed(2) + " MB"
    });
  }
}

const versionMeta = {
  version: targetVersion,
  builtAt: new Date().toISOString(),
  gitCommit,
  artifacts: artifactsSummary
};

await fs.writeFile(
  path.join(deployDir, "version.json"),
  JSON.stringify(versionMeta, null, 2),
  "utf8"
);

const readmeContent = `# Otter Deployment Package (${targetVersion})
- **Phiên bản**: ${targetVersion}
- **Thời gian build**: ${new Date().toLocaleString("vi-VN")}
- **Git Commit**: ${gitCommit}

---

## 🚀 Hướng dẫn Cài đặt & Chạy ngầm

### 1. Dành cho Windows:
- **Cách 1 (Dễ nhất)**: Click đúp vào file \`install.bat\`.
- **Cách 2 (PowerShell cục bộ)**: Mở PowerShell tại thư mục này và chạy:
  \`\`\`powershell
  .\\setup.ps1
  \`\`\`
- **Cách 3 (Lệnh trực tiếp từ Web)**:
  \`\`\`powershell
  irm https://otter.gpt.io.vn/setup.ps1 | iex
  \`\`\`
*(Để gỡ cài đặt: Click đúp \`uninstall.bat\` hoặc chạy \`setup.ps1 -Uninstall\`)*

---

### 2. Dành cho macOS (Apple Silicon / Intel):
- **Cài đặt cục bộ**: Mở Terminal tại thư mục này và chạy:
  \`\`\`bash
  chmod +x setup.sh
  ./setup.sh
  \`\`\`
- **Cài đặt qua Web**:
  \`\`\`bash
  curl -fsSL https://otter.gpt.io.vn/setup.sh | bash
  \`\`\`
*(Để gỡ cài đặt: \`./setup.sh --uninstall\`)*

---

### 3. Cài đặt Chrome Extension:
1. Mở Chrome / Edge, truy cập: \`chrome://extensions/\`
2. Bật **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Kéo thả file \`otter-extension.zip\` (hoặc giải nén rồi chọn *Tải tiện ích đã giải nén*).

---

### 4. VPS SSH / SFTP Engine (Hỗ trợ 2 chế độ):
- **Chế độ 1 (Không cần Python)**: Bộ cài đã tích hợp sẵn binary biên dịch \`bin/vps_ssh.exe\` (Windows) hoặc \`bin/vps_ssh\` (macOS/Linux). Chạy trực tiếp mà không cần cài thêm bất kỳ môi trường Python hay thư viện nào!
- **Chế độ 2 (Dành cho máy có Python sẵn)**: Thư mục \`scripts/\` đính kèm file \`vps_ssh.py\` và \`requirements-vps.txt\`. Otter tự động nhận diện nếu máy khách muốn dùng Python (\`pip install -r scripts/requirements-vps.txt\`).

---

### 5. 💬 Cộng Đồng & Hỗ Trợ Kỹ Thuật:
- **Nhóm Facebook**: [Tham gia nhóm cộng đồng Otter](https://www.facebook.com/share/g/1CN8sjFYDH/?mibextid=wwXIfr)

---

## 🇬🇧 English Installation Guide

### 1. Windows:
- **Option 1 (Easiest)**: Double-click \`install.bat\`.
- **Option 2 (Local PowerShell)**: Run:
  \`\`\`powershell
  .\\setup.ps1
  \`\`\`
- **Option 3 (1-Line Web Install)**:
  \`\`\`powershell
  irm https://otter.gpt.io.vn/setup.ps1 | iex
  \`\`\`
*(To uninstall: Double-click \`uninstall.bat\` or run \`setup.ps1 -Uninstall\`)*

### 2. macOS (Apple Silicon / Intel) & Linux:
- **Local Install**:
  \`\`\`bash
  chmod +x setup.sh
  ./setup.sh
  \`\`\`
- **1-Line Web Install**:
  \`\`\`bash
  curl -fsSL https://otter.gpt.io.vn/setup.sh | bash
  \`\`\`
*(To uninstall: \`./setup.sh --uninstall\`)*

### 3. Install Chrome Extension:
1. Open Chrome/Edge and go to: \`chrome://extensions/\`
2. Enable **Developer mode** in the top-right corner.
3. Drag & drop \`otter-extension.zip\` (or load unpacked).

### 4. VPS SSH & SFTP Engine (Dual Mode):
- **Standalone Binary (Zero Python needed)**: Comes pre-compiled in \`bin/vps_ssh.exe\` (Windows) and \`bin/vps_ssh\` (macOS/Linux).
- **Python Fallback**: Comes with \`scripts/vps_ssh.py\` & \`scripts/requirements-vps.txt\` for systems equipped with Python.

### 5. 💬 Community & Technical Support:
- **Facebook Group**: [Join Otter Community](https://www.facebook.com/share/g/1CN8sjFYDH/?mibextid=wwXIfr)
`;

await fs.writeFile(path.join(deployDir, "README.md"), readmeContent, "utf8");

console.log("\n========================================================");
console.log(` [✓] HOÀN TẤT TRIỂN KHAI BẢN MỚI NHẤT VÀO: deploy/`);
console.log(` [✓] Phiên bản: ${targetVersion}`);
console.log("========================================================");
for (const art of artifactsSummary) {
  console.log(` - ${art.file.padEnd(28)} : ${art.sizeMB}`);
}
console.log("========================================================\n");
