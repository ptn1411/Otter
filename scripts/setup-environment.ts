#!/usr/bin/env bun
/**
 * Otter / chatmcp — Setup môi trường đa nền tảng (Windows / macOS / Linux)
 *
 * Đây là bản chạy bằng Bun, dùng chung cho cả 3 nền tảng, thay cho
 * scripts/setup-environment.sh (bash, chỉ macOS/Linux). Chỉ cần có bun
 * là chạy được, không cần bash/PowerShell riêng:
 *   bun scripts/setup-environment.ts            # cài lõi + kiểm tra
 *   bun scripts/setup-environment.ts --check    # chỉ kiểm tra
 *   bun scripts/setup-environment.ts --with-codebase
 *   bun scripts/setup-environment.ts --with-cloudflared
 *   bun scripts/setup-environment.ts --with-binaries
 *   bun scripts/setup-environment.ts --with-skill=figma   # lặp lại được
 *   bun scripts/setup-environment.ts --with-all-skills
 *
 * Nguyên tắc giống bản sh: lõi code thuần là mặc định, binaries nặng
 * và skills là tùy chọn, thiếu thì chỉ cảnh báo chứ daemon không crash.
 * Nguồn cài đặt: CHỈ GitHub Releases + PyPI, không dùng server trung gian.
 *   uv:              https://github.com/astral-sh/uv/releases
 *   codebase-memory: https://github.com/DeusData/codebase-memory-mcp/releases
 *                    (qua scripts/setup-binaries.ts, có kiểm chứng file
 *                     sau khi cài thay vì tin thông báo thành công của nó)
 *   cloudflared:     https://github.com/cloudflare/cloudflared/releases
 *   paramiko:        PyPI, theo scripts/requirements-vps.txt
 *
 * Sau khi setup xong, chạy daemon bằng bản đa nền tảng tương ứng:
 *   bun scripts/run-daemon.ts
 * (bản này tự thêm user bin dir vào PATH rồi mới chạy daemon.)
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const args = process.argv.slice(2);
let CHECK_ONLY = false;
let WITH_CODEBASE = false;
let WITH_CLOUDFLARED = false;
let WITH_ALL_SKILLS = false;
const WITH_SKILLS: string[] = [];
for (const arg of args) {
  if (arg === "--check") CHECK_ONLY = true;
  else if (arg === "--with-codebase") WITH_CODEBASE = true;
  else if (arg === "--with-cloudflared") WITH_CLOUDFLARED = true;
  else if (arg === "--with-binaries") { WITH_CODEBASE = true; WITH_CLOUDFLARED = true; }
  else if (arg === "--with-all-skills") WITH_ALL_SKILLS = true;
  else if (arg.startsWith("--with-skill=")) WITH_SKILLS.push(arg.slice("--with-skill=".length));
  else if (arg === "-h" || arg === "--help") {
    console.log("Usage: bun scripts/setup-environment.ts [--check] [--with-codebase] [--with-cloudflared] [--with-binaries] [--with-skill=<name> ...] [--with-all-skills]");
    process.exit(0);
  } else { console.error(`Tham số không rõ: ${arg}`); process.exit(2); }
}

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const arch = process.arch === "arm64" ? "arm64" : "amd64";
const repoRoot = path.resolve(import.meta.dir, "..");
const userBinDir = path.join(os.homedir(), ".local", "bin");
const binDir = path.join(repoRoot, "bin");
let FAIL = 0;
const ok = (m: string) => console.log(`[OK]   ${m}`);
const warn = (m: string) => console.log(`[WARN] ${m}`);
const fail = (m: string) => { console.log(`[FAIL] ${m}`); FAIL++; };

// PATH cho chính tiến trình này: daemon cũng cần userBinDir, nên setup
// tự thêm trước để kiểm tra uv/bunx đúng cả khi shell chưa có nó.
process.env.PATH = `${userBinDir}${path.delimiter}${path.join(binDir)}${path.delimiter}${process.env.PATH || ""}`;

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
async function run(cmd: string, cmdArgs: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const proc = Bun.spawn([cmd, ...cmdArgs], {
      cwd: opts.cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore",
      env: { ...process.env, ...(opts.env || {}) },
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (e: any) { return { code: 127, stdout: "", stderr: String(e?.message || e) }; }
}
async function findCmd(name: string): Promise<string | null> {
  // Quét PATH + userBinDir, trên Windows thử thêm .exe/.cmd/.bat.
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const exts = isWin ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const cand = path.join(dir, name + ext);
      if (await exists(cand)) return cand;
    }
  }
  return null;
}
async function firstLine(cmd: string, cmdArgs: string[]): Promise<string> {
  const r = await run(cmd, cmdArgs);
  return (r.stdout || r.stderr).split(/\r?\n/).find((l) => l.trim())?.trim() || "";
}
async function download(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "otter-setup" } });
    if (!res.ok) return false;
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch { return false; }
}
async function findFileRecursive(dir: string, name: string): Promise<string | null> {
  let entries: any[] = [];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = await findFileRecursive(p, name); if (f) return f; }
    else if (e.name === name) return p;
  }
  return null;
}
async function extractArchive(archive: string, destDir: string): Promise<boolean> {
  await fs.mkdir(destDir, { recursive: true });
  // tar có sẵn trên macOS/Linux và Windows 10+ (tar.exe), và nó giải
  // được cả .tar.gz lẫn .zip. Chỉ khi tar thất bại mới fallback.
  let r = await run(isWin ? "tar.exe" : "tar", archive.endsWith(".zip") ? ["-xf", archive, "-C", destDir] : ["-xzf", archive, "-C", destDir]);
  if (r.code === 0) return true;
  if (isWin) {
    r = await run("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path '${archive}' -DestinationPath '${destDir}' -Force`]);
    if (r.code === 0) return true;
  } else {
    r = await run("unzip", ["-qo", archive, "-d", destDir]);
    if (r.code === 0) return true;
  }
  return false;
}

console.log(`Repo: ${repoRoot}`);
console.log(`Platform: ${process.platform} (${arch})`);
console.log(`Bin dir (persistent, trong HOME): ${userBinDir}`);
await fs.mkdir(userBinDir, { recursive: true });

// ---------------------------------------------------------------- 1. Nền tảng
console.log("\n== 1. Nền tảng: bun / node / python / ffmpeg / git / curl / tar ==");
let pythonCmd: string | null = null;
for (const cmd of ["bun", "node", "ffmpeg", "git", "curl", "tar"]) {
  const found = await findCmd(cmd);
  if (found) ok(`${cmd}: ${cmd === "bun" ? await firstLine(found, ["--version"]) : cmd === "node" ? await firstLine(found, ["--version"]) : cmd === "ffmpeg" ? (await firstLine(found, ["-version"])).slice(0, 60) : "có sẵn"}`);
  else fail(`${cmd}: THIẾU — bun: https://github.com/oven-sh/bun/releases, còn lại: cài bằng package manager của hệ điều hành rồi chạy lại script này`);
}
for (const cand of ["python3", "python"]) {
  const found = await findCmd(cand);
  if (found) { pythonCmd = found; ok(`${cand}: ${await firstLine(found, ["--version"])}`); break; }
}
if (!pythonCmd) fail("python: THIẾU (cần python3 hoặc python)");

// ---------------------------------------------------------------- 2. uv
console.log("\n== 2. uv (cho generate_speech_audio + synthesize_bgm_or_sfx) ==");
const uvExe = isWin ? "uv.exe" : "uv";
if (await findCmd("uv")) {
  ok(`uv: ${await firstLine(await findCmd("uv") as string, ["--version"])}`);
} else if (CHECK_ONLY) {
  fail("uv: THIẾU (chạy không có --check để cài từ GitHub astral-sh/uv)");
} else {
  console.log("[*] Đang tải uv từ GitHub Releases (astral-sh/uv)...");
  const uvAsset = isWin ? `uv-${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc.zip`
    : isMac ? `uv-${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin.tar.gz`
    : `uv-${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-gnu.tar.gz`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "otter-uv-"));
  const archive = path.join(tmp, uvAsset);
  let installed = false;
  if (await download(`https://github.com/astral-sh/uv/releases/latest/download/${uvAsset}`, archive)) {
    if (await extractArchive(archive, tmp)) {
      const found = await findFileRecursive(tmp, uvExe);
      if (found) { await fs.copyFile(found, path.join(userBinDir, uvExe)); installed = true; }
    }
  }
  if (!installed && pythonCmd) {
    console.log("[*] Tải trực tiếp thất bại, thử pip install --user uv...");
    const r = await run(pythonCmd, ["-m", "pip", "install", "--user", "uv"]);
    if (r.code !== 0) await run(pythonCmd, ["-m", "pip", "install", "--user", "--break-system-packages", "uv"]);
    installed = !!(await findCmd("uv"));
  }
  await fs.rm(tmp, { recursive: true, force: true });
  if (installed) ok(`uv: ${await firstLine(await findCmd("uv") as string, ["--version"])}`);
  else fail("uv: CÀI THẤT BẠI — cài tay: https://github.com/astral-sh/uv (hoặc: python -m pip install --user uv)");
}

// ---------------------------------------------------------------- 3. bunx
console.log("\n== 3. bunx (cho render_remotion_video) ==");
if (await findCmd("bunx")) {
  ok("bunx: có sẵn");
} else if (await findCmd("bun")) {
  if (CHECK_ONLY) fail("bunx: THIẾU (chạy không có --check để tạo shim trong user bin dir -> bun x)");
  else {
    if (isWin) {
      await fs.writeFile(path.join(userBinDir, "bunx.cmd"), "@echo off\r\nbun x %*\r\n");
      ok(`bunx: đã tạo shim ${path.join(userBinDir, "bunx.cmd")} -> bun x`);
    } else {
      const shim = path.join(userBinDir, "bunx");
      await fs.writeFile(shim, "#!/bin/sh\n# bunx shim: bản bun rút gọn không kèm binary bunx, dùng `bun x` thay thế.\nexec bun x \"$@\"\n", { mode: 0o755 });
      ok(`bunx: đã tạo shim ${shim} -> bun x`);
    }
  }
} else fail("bunx: THIẾU và bun cũng thiếu — cài bun trước: https://github.com/oven-sh/bun/releases");

// ---------------------------------------------------------------- 4. paramiko
console.log("\n== 4. Python paramiko (cho vps_*) ==");
if (pythonCmd) {
  const chk = await run(pythonCmd, ["-c", "import paramiko; print(paramiko.__version__)"]);
  if (chk.code === 0) ok(`paramiko: ${chk.stdout.trim()}`);
  else if (CHECK_ONLY) fail("paramiko: THIẾU (chạy không có --check để pip install theo scripts/requirements-vps.txt)");
  else {
    console.log("[*] Đang cài paramiko theo scripts/requirements-vps.txt...");
    // Thứ tự: pip thường trước (macOS/pip cũ không có cờ
    // --break-system-packages), rồi mới cờ đó, rồi mới uv pip.
    const req = path.join(repoRoot, "scripts", "requirements-vps.txt");
    let done = false;
    for (const a of [
      ["-m", "pip", "install", "--user", "-r", req],
      ["-m", "pip", "install", "--user", "paramiko"],
      ["-m", "pip", "install", "--user", "--break-system-packages", "-r", req],
      ["-m", "pip", "install", "--user", "--break-system-packages", "paramiko"],
    ]) {
      if ((await run(pythonCmd, a)).code === 0) { done = true; break; }
    }
    if (!done && (await findCmd("uv"))) {
      done = (await run("uv", ["pip", "install", "--system", "--break-system-packages", "paramiko"])).code === 0;
    }
    const chk2 = await run(pythonCmd, ["-c", "import paramiko; print(paramiko.__version__)"]);
    if (chk2.code === 0) ok(`paramiko: ${chk2.stdout.trim()}`);
    else fail("paramiko: pip báo xong nhưng python vẫn import không được — kiểm tra PYTHONPATH / venv đang dùng");
  }
}

// ---------------------------------------------------------------- 5. bun install + binaries tùy chọn
console.log("\n== 5. bun install + binaries tùy chọn ==");
if (!CHECK_ONLY && (await findCmd("bun"))) {
  const r = await run("bun", ["install"], { cwd: repoRoot });
  if (r.code === 0) ok("bun install: xong"); else fail("bun install thất bại");
} else if (await exists(path.join(repoRoot, "node_modules"))) ok("node_modules: có sẵn");
else if (CHECK_ONLY) warn("node_modules: chưa có (chạy không có --check để bun install)");
else fail("bun install: bỏ qua vì thiếu bun");

console.log(`    Binaries tùy chọn: codebase=${WITH_CODEBASE ? 1 : 0} cloudflared=${WITH_CLOUDFLARED ? 1 : 0} (mặc định 0 = không cài)`);
const cbmName = isWin ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
const cfName = isWin ? "cloudflared.exe" : "cloudflared";
if (WITH_CODEBASE && !CHECK_ONLY && (await findCmd("bun"))) {
  // setup-binaries.ts có nhánh win32/darwin/linux, nhưng thông báo
  // thành công của nó không đáng tin hoàn toàn (từng in thành công
  // dù file chưa có), nên sau đó kiểm chứng file thật.
  await run("bun", ["scripts/setup-binaries.ts"], { cwd: repoRoot, env: { SKIP_CLOUDFLARED: "1" } });
}
if (WITH_CLOUDFLARED && !CHECK_ONLY && !(await exists(path.join(binDir, cfName)))) {
  // Không chạy setup-binaries.ts ở đây: bản đó viết trực tiếp file
  // .tgz của macOS vào vị trí cloudflared mà không giải nén, nên
  // trên macOS sẽ ra file hỏng. Tải và giải nén đúng theo từng OS.
  console.log("[*] Đang tải cloudflared từ GitHub...");
  if (isWin) {
    await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`, path.join(binDir, cfName));
  } else if (isMac) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "otter-cf-"));
    const tgz = path.join(tmp, "cloudflared.tgz");
    if (await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`, tgz) && await extractArchive(tgz, tmp)) {
      const found = await findFileRecursive(tmp, "cloudflared");
      if (found) await fs.copyFile(found, path.join(binDir, cfName));
    }
    await fs.rm(tmp, { recursive: true, force: true });
  } else {
    await download(`https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`, path.join(binDir, cfName));
  }
  if (!isWin) { try { await fs.chmod(path.join(binDir, cfName), 0o755); } catch {} }
}
if (await exists(path.join(binDir, cbmName))) ok(`codebase-memory-mcp: bin/${cbmName} (tùy chọn, đã cài)`);
else warn("codebase-memory-mcp: chưa cài (tùy chọn, chỉ cần cho codebase_* — cài bằng: bun scripts/setup-environment.ts --with-codebase)");
if (await exists(path.join(binDir, cfName))) ok(`cloudflared: bin/${cfName} (tùy chọn, đã cài)`);
else warn("cloudflared: chưa cài (tùy chọn, chỉ cần cho --tunnel — cài bằng: bun scripts/setup-environment.ts --with-cloudflared; daemon vẫn chạy local bình thường)");

// ---------------------------------------------------------------- 5b. Skills tùy chọn
console.log("\n== 5b. Skills tùy chọn (mặc định: chỉ remotion-video-creator) ==");
if (WITH_ALL_SKILLS) WITH_SKILLS.push("figma", "hyperframes", "hyperframes-cli", "hyperframes-registry", "media-use", "remotion-to-hyperframes", "slideshow", "video-shotcraft");
if (WITH_SKILLS.length > 0 && !CHECK_ONLY && (await findCmd("bun"))) {
  for (const name of [...new Set(WITH_SKILLS)]) {
    if (await exists(path.join(binDir, "skills", name))) ok(`skill ${name}: đã có sẵn, bỏ qua`);
    else {
      console.log(`[*] Đang cài skill ${name} từ bin/skills/sources.json...`);
      const r = await run("bun", ["bin/skill.ts", "install", name], { cwd: repoRoot });
      if (r.code === 0) ok(`skill ${name}: đã cài`); else warn(`skill ${name}: cài thất bại (xem log ở trên; kiểm tra tên trong: bun bin/skill.ts sources)`);
    }
  }
} else if (WITH_SKILLS.length > 0 && CHECK_ONLY) warn(`skills yêu cầu (${WITH_SKILLS.join(" ")}) chưa cài trong chế độ --check (chạy không có --check để cài)`);
if (await exists(path.join(binDir, "skills", "remotion-video-creator"))) ok("skill remotion-video-creator: luôn có sẵn (24K, skill gốc của Otter)");
else warn("skill remotion-video-creator: THIẾU — đây là skill gốc, không có upstream GitHub để cài lại");
console.log("    Các skill tùy chọn khác cài khi cần: bun bin/skill.ts install <tên> (xem: bun bin/skill.ts sources)");

// ---------------------------------------------------------------- 6. PATH
console.log("\n== 6. PATH ==");
if ((process.env.PATH || "").split(path.delimiter).includes(userBinDir)) ok(`PATH hiện tại đã có ${userBinDir}`);
else {
  warn(`PATH hiện tại CHƯA có ${userBinDir} — daemon thì dùng bun scripts/run-daemon.ts, nó tự thêm`);
  if (isWin) console.log(`    Windows (PowerShell, chạy một lần): [Environment]::SetEnvironmentVariable("Path", "$env:Path;${userBinDir}", "User")`);
  else console.log(`    Unix: export PATH="${userBinDir}:$PATH"`);
}
console.log("    Daemon phải chạy bằng: bun scripts/run-daemon.ts");

console.log("");
if (FAIL === 0) console.log("[✓] Setup environment: OK — khởi động lại daemon bằng bun scripts/run-daemon.ts rồi test lại MCP.");
else console.log(`[!] Setup environment: còn ${FAIL} mục FAIL ở trên — sửa theo gợi ý từng mục rồi chạy lại script.`);
process.exit(FAIL === 0 ? 0 : 1);
