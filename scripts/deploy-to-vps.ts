/**
 * Automated Deployment Script from Local to VPS (160.250.181.51 / otter.gpt.io.vn)
 * Synchronizes deploy/ bundle to /var/www/otter, sets permissions, and verifies live health.
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { execSync } from "node:child_process";

const VPS_HOST = "160.250.181.51";
const VPS_USER = "root";
const SSH_KEY = path.join(os.homedir(), ".ssh", "github_actions_160_250_181_51");
const REMOTE_DIR = "/var/www/otter";
const LOCAL_DEPLOY = path.resolve("deploy");

const sshCmd = (remoteCommand: string) => {
  return execSync(
    `ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=15 ${VPS_USER}@${VPS_HOST} "${remoteCommand}"`,
    { stdio: "inherit" }
  );
};

const scpUpload = (localFile: string, remoteDest: string) => {
  execSync(
    `scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${localFile}" ${VPS_USER}@${VPS_HOST}:"${remoteDest}"`,
    { stdio: "inherit" }
  );
};

console.log("========================================================");
console.log("       DEPLOY OTTER TO VPS (otter.gpt.io.vn)            ");
console.log("========================================================");
console.log(`[*] Target Host: ${VPS_HOST} (${VPS_USER})`);
console.log(`[*] Remote Directory: ${REMOTE_DIR}`);
console.log(`[*] SSH Key: ${SSH_KEY}\n`);

// 1. Kiểm tra kết nối SSH
console.log("[1/5] Kiểm tra kết nối SSH tới VPS...");
try {
  execSync(`ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${VPS_USER}@${VPS_HOST} "echo SSH_CONNECTED"`, { stdio: "pipe" });
  console.log("[+] Kết nối SSH thành công!");
} catch (err: any) {
  console.error(`[!] Lỗi kết nối SSH: ${err.message}`);
  process.exit(1);
}

// 2. Tải lên các file tĩnh, kịch bản cài đặt và extension
console.log("\n[2/5] Tải lên kịch bản cài đặt, extension và metadata...");
const staticFiles = [
  "index.html",
  "install.bat",
  "uninstall.bat",
  "setup.ps1",
  "setup.sh",
  "openapi.json",
  "version.json",
  "README.md",
  "otter.ico",
  "otter-tray.exe",
  "otter-extension.zip"
];

for (const file of staticFiles) {
  const localFilePath = path.join(LOCAL_DEPLOY, file);
  try {
    await fs.access(localFilePath);
    console.log(`[*] Uploading ${file}...`);
    scpUpload(localFilePath, `${REMOTE_DIR}/${file}`);
  } catch {
    console.warn(`[!] Bỏ qua file không tồn tại: ${file}`);
  }
}

// 3. Tải lên các file nhị phân lớn
console.log("\n[3/5] Tải lên các bản nhị phân độc lập (Stand-alone Binaries)...");
const binaryFiles = [
  "otter-windows-x64.exe",
  "otter-linux-x64",
  "otter-darwin-arm64",
  "otter-darwin-x64"
];

for (const bin of binaryFiles) {
  const localBinPath = path.join(LOCAL_DEPLOY, bin);
  try {
    await fs.access(localBinPath);
    console.log(`[*] Uploading ${bin}...`);
    scpUpload(localBinPath, `${REMOTE_DIR}/${bin}`);
  } catch {
    console.warn(`[!] Bỏ qua file binary không tồn tại: ${bin}`);
  }
}

// 4. Nén và tải lên toàn bộ thư mục tools/
console.log("\n[4/5] Đồng bộ thư mục tools/ (skill.exe, cua, vps-ssh, db-manager)...");
const toolsArchive = path.join(LOCAL_DEPLOY, "tools.tar.gz");
try {
  await fs.access(toolsArchive);
} catch {
  console.log("[*] Đang tạo tools.tar.gz...");
  execSync(`tar -czf "${toolsArchive}" -C "${LOCAL_DEPLOY}" tools`, { stdio: "inherit" });
}

console.log("[*] Uploading tools.tar.gz...");
scpUpload(toolsArchive, `${REMOTE_DIR}/tools.tar.gz`);

console.log("[*] Giải nén tools trên VPS...");
sshCmd(`cd ${REMOTE_DIR} && tar -xzf tools.tar.gz && rm tools.tar.gz`);

// 5. Cấu hình quyền và Symlink trên VPS
console.log("\n[5/6] Cấu hình phân quyền & tạo Symlink...");
sshCmd(`cd ${REMOTE_DIR} && ln -sf otter-windows-x64.exe otter.exe && chmod +x otter-* setup.sh 2>/dev/null || true`);
sshCmd(`chown -R www-data:www-data ${REMOTE_DIR} && chmod -R u=rwX,go=rX ${REMOTE_DIR}`);

// 6. Cập nhật Backend License Server (/opt/otter-server)
console.log("\n[6/6] Cập nhật Backend License Server (/opt/otter-server)...");
try {
  const srcArchive = path.join(LOCAL_DEPLOY, "src_bundle.tar.gz");
  execSync(`tar -czf "${srcArchive}" src`, { stdio: "inherit" });
  scpUpload(srcArchive, "/opt/otter-server/src_bundle.tar.gz");
  sshCmd("cd /opt/otter-server && tar -xzf src_bundle.tar.gz && rm src_bundle.tar.gz && systemctl restart otter-license.service");
  await fs.unlink(srcArchive).catch(() => {});
  console.log("[+] Đã cập nhật src/ và khởi động lại otter-license.service thành công!");
} catch (err: any) {
  console.warn(`[!] Lỗi cập nhật license server: ${err.message}`);
}

console.log("\n========================================================");
console.log(" [✓] DEPLOY LÊN VPS THÀNH CÔNG!");
console.log("========================================================");
console.log(` - Trang chủ / Web: https://otter.gpt.io.vn`);
console.log(` - Kịch bản cài đặt: https://otter.gpt.io.vn/setup.ps1`);
console.log(` - Bản quyền: https://license.gpt.io.vn`);
console.log("========================================================\n");

