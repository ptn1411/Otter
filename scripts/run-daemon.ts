#!/usr/bin/env bun
/**
 * Chạy Otter daemon với PATH đầy đủ cho các MCP tool gọi qua shell.
 * Bản đa nền tảng (Windows / macOS / Linux), dùng thay cho
 * scripts/run-daemon.sh (bash, chỉ Unix):
 *   bun scripts/run-daemon.ts
 *
 * BẮT BUỘC dùng launcher này thay cho `bun src/daemon/index.ts` trần, vì:
 *   - generate_speech_audio / synthesize_bgm_or_sfx cần `uv`
 *   - render_remotion_video cần `bunx`
 * mà cả hai đều được scripts/setup-environment.ts (hoặc bản .sh)
 * cài vào user bin dir (~/.local/bin), thư mục này KHÔNG nằm trong
 * PATH mặc định của daemon.
 */
import * as path from "node:path";
import * as os from "node:os";

const repoRoot = path.resolve(import.meta.dir, "..");
const userBinDir = path.join(os.homedir(), ".local", "bin");
process.env.PATH = `${userBinDir}${path.delimiter}${path.join(repoRoot, "bin")}${path.delimiter}${process.env.PATH || ""}`;
console.log(`PATH=${process.env.PATH}`);
const which = process.platform === "win32" ? "where" : "which";
for (const cmd of ["uv", "bunx"]) {
  try {
    const proc = Bun.spawn([which, cmd], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    console.log(`${cmd}: ${out.trim() || "MISSING"}`);
  } catch { console.log(`${cmd}: MISSING`); }
}
// Phase 4 (plan nâng cấp từ codex-web): supervisor có giới hạn.
// - Ghi pid file vào ~/.otter/daemon.pid để doctor/supervisor khác phân biệt.
// - Crash loop có giới hạn: tối đa 3 lần restart trong 5 phút, quá thì
//   dừng và báo rõ, không loop vô hạn. Thoát bình thường (code 0) thì
//   không restart.
// - Trước khi restart một daemon còn sống (trường hợp supervisor được
//   gọi lại trong khi daemon cũ chưa chết), thử gọi POST /api/drain:
//   drain từ chối (409) nghĩa là còn phiên đang chạy -> không restart
//   mù, báo rõ và thoát.
import * as fs from "node:fs";
const otterDir = path.join(os.homedir(), ".otter");
try { fs.mkdirSync(otterDir, { recursive: true }); } catch {}
const pidFile = path.join(otterDir, "daemon.pid");
const port = Number(process.env.PORT || 1993);
async function drainAllowsRestart(): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};
    if (process.env.OTTER_API_KEY) headers["Authorization"] = `Bearer ${process.env.OTTER_API_KEY}`;
    const r = await fetch(`http://127.0.0.1:${port}/api/drain`, { method: "POST", headers, signal: AbortSignal.timeout(5000) });
    return r.status === 200;
  } catch { return true; } // daemon không trả lời -> không còn gì để drain
}
const restarts: number[] = [];
while (true) {
  const proc = Bun.spawn(["bun", "src/daemon/index.ts", "--tunnel", ...process.argv.slice(2)], {
    cwd: repoRoot, stdout: "inherit", stderr: "inherit", stdin: "inherit",
    env: process.env,
  });
  try { fs.writeFileSync(pidFile, String(proc.pid)); } catch {}
  const code = await proc.exited;
  if (code === 0) {
    console.log("[run-daemon] Daemon thoát bình thường (code 0), không restart.");
    process.exit(0);
  }
  const nowMs = Date.now();
  restarts.push(nowMs);
  while (restarts.length && nowMs - restarts[0] > 5 * 60_000) restarts.shift();
  if (restarts.length > 3) {
    console.error("[run-daemon] Daemon crash quá 3 lần trong 5 phút — dừng supervisor, không loop vô hạn. Chạy /api/doctor để xem trạng thái rồi sửa lỗi trước khi chạy lại.");
    process.exit(1);
  }
  console.log(`[run-daemon] Daemon thoát với code ${code}, restart lần ${restarts.length}/3 trong 5 phút...`);
  if (!(await drainAllowsRestart())) {
    console.error("[run-daemon] Drain từ chối: còn phiên page-loop đang chạy ở daemon cũ — không restart mù.");
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
}
