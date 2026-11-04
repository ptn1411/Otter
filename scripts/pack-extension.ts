#!/usr/bin/env bun
/**
 * Đóng gói extension Otter để cài trên nhiều máy / nhiều profile Chrome.
 *
 * Cách dùng (từ repo root):
 *   bun build.extension.ts          # build extension/ + extension/dist/
 *   bun scripts/pack-extension.ts   # -> extension-pack/otter-extension-<version>.zip
 *
 * Cài trên máy khác: giải nén zip (hoặc dùng thẳng thư mục dist đã
 * giải nén) rồi vào chrome://extensions → Developer mode → Load
 * unpacked → chọn thư mục đó. Mỗi profile Chrome là một lần load
 * riêng, cấu hình server của profile đó nằm trong chrome.storage.local
 * của profile đó (dùng Export/Import servers ở tab Management để mang
 * cấu hình sang profile khác, file export có token nên giữ như mật khẩu).
 * Extension chưa lên Chrome Web Store nên chưa có auto-update: khi có
 * bản mới, build lại + pack lại + load lại trên từng máy/profile.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const distDir = path.join(repoRoot, "extension", "dist");
const outDir = path.join(repoRoot, "extension-pack");
try { await fs.access(distDir); } catch {
  console.error("extension/dist/ chưa có. Chạy trước: bun build.extension.ts");
  process.exit(1);
}
const manifest = JSON.parse(await fs.readFile(path.join(distDir, "manifest.json"), "utf-8"));
const version = manifest.version || "0.0.0";
await fs.mkdir(outDir, { recursive: true });
const zipName = `otter-extension-${version}.zip`;
const zipPath = path.join(outDir, zipName);
// Dùng zip hệ thống nếu có (macOS/Linux/Windows 10+ đều có zip hoặc tar);
// tar -a cũng tạo được zip trên nhiều hệ thống, fallback là zip.
// Sửa 2026-10-31: Bun.spawn ném ENOENT khi lệnh không tồn tại (ví dụ
// `zip` vắng trên nam) thay vì trả exit code, nên phải try/catch từng
// lệnh, nếu không script chết ở lệnh đầu và không bao giờ thử tar.
let made = false;
for (const cmd of [["zip", "-r", "-q", zipPath, "."], ["tar", "-a", "-cf", zipPath, "."]]) {
  try {
    const proc = Bun.spawn(cmd, { cwd: distDir, stdout: "pipe", stderr: "pipe" });
    const code = await proc.exited;
    if (code === 0) {
      try {
        const st = await fs.stat(zipPath);
        // GNU tar -a với tên .zip tạo ra file TAR chứ không phải ZIP
        // (đã gặp trên nam: 210K, python zipfile từ chối). Chỉ chấp
        // nhận file bắt đầu bằng magic PK của ZIP thật.
        const head = await fs.readFile(zipPath).then((b) => b.subarray(0, 2).toString("latin1")).catch(() => "");
        if (st.size > 0 && head === "PK") { made = true; break; }
      } catch {}
    }
  } catch { /* lệnh không tồn tại trên máy này, thử lệnh tiếp theo */ }
  try { await fs.unlink(zipPath); } catch {}
}
if (!made) {
  console.error("Không tạo được zip: cần lệnh 'zip' hoặc 'tar -a' trên máy này.");
  process.exit(1);
}
const stat = await fs.stat(zipPath);
// Phase 8 (plan nâng cấp từ codex-web): manifest SHA-256 kèm zip.
// Khi nhận bản mới, kiểm tra manifest trước khi nhận: file thiếu, hash
// lệch, version không khớp thì từ chối rõ, không nhận nửa chừng.
// Chưa ký (Gatekeeper/SmartScreen) — ghi rõ, user tự chấp nhận cảnh báo OS.
import * as nodeCrypto from "node:crypto";
async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walk(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out.sort();
}
const files: Record<string, { sha256: string; size: number }> = {};
for (const rel of await walk(distDir)) {
  const buf = await fs.readFile(path.join(distDir, rel));
  files[rel] = { sha256: nodeCrypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
}
const packManifest = { name: "otter-extension", version, zip: zipName, zipSize: stat.size, generatedAt: new Date().toISOString(), files };
await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(packManifest, null, 2));
console.log(`[+] Manifest: ${path.join(outDir, "manifest.json")} (${Object.keys(files).length} files, SHA-256). Kiểm tra trước khi nhận bản mới; chưa ký.`);
console.log(`[+] Đã đóng gói: ${zipPath} (${stat.size} bytes, version ${version})`);
console.log("    Cài: chrome://extensions → Developer mode → Load unpacked → chọn thư mục đã giải nén từ zip này.");
console.log("    Mỗi profile Chrome load riêng; mang cấu hình sang profile khác bằng Export/Import servers ở tab Management.");
