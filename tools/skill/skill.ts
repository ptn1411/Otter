#!/usr/bin/env bun
/**
 * ChatMCP Skill CLI Runner & Discovery Tool
 * Tra cứu, kích hoạt và đọc hướng dẫn của các AI Skills trong .agents/skills/
 */
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

interface SkillMetadata {
  name: string;
  description: string;
  path: string;
  skillMdPath: string;
  hasScripts: boolean;
  hasReferences: boolean;
}

interface Flags {
  json: boolean;
  noColor: boolean;
  compact: boolean;
  force: boolean;
}

function resolveSkillsPaths(): { repoRoot: string; skillsDir: string } {
  // 1. Quét ngược từ thư mục làm việc hiện tại (process.cwd()) lên thư mục gốc
  let current = process.cwd();
  while (true) {
    const candidate = path.join(current, ".agents", "skills");
    if (existsSync(candidate)) {
      return { repoRoot: current, skillsDir: candidate };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 2. Quét tương đối từ vị trí file thực thi (process.execPath khi chạy skill.exe)
  try {
    const execDir = path.dirname(process.execPath);
    for (const rel of ["../..", "..", "."]) {
      const cand = path.resolve(execDir, rel);
      const candSkills = path.join(cand, ".agents", "skills");
      if (existsSync(candSkills)) {
        return { repoRoot: cand, skillsDir: candSkills };
      }
    }
  } catch {}

  // 3. Quét tương đối từ file mã nguồn (khi chạy `bun skill.ts`)
  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    for (const rel of ["../..", "..", "."]) {
      const cand = path.resolve(scriptDir, rel);
      const candSkills = path.join(cand, ".agents", "skills");
      if (existsSync(candSkills)) {
        return { repoRoot: cand, skillsDir: candSkills };
      }
    }
  } catch {}

  const fallbackRoot = process.cwd();
  return { repoRoot: fallbackRoot, skillsDir: path.join(fallbackRoot, ".agents", "skills") };
}

const { repoRoot, skillsDir } = resolveSkillsPaths();
const catalogFile = path.join(skillsDir, "catalog.json");
const sourcesFile = path.join(skillsDir, "sources.json");

function parseFlags(args: string[], allowed: (keyof Flags)[]): { rest: string[]; flags: Flags } {
  const flags: Flags = { json: false, noColor: false, compact: false, force: false };
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--json" && allowed.includes("json")) flags.json = true;
    else if (arg === "--no-color" && allowed.includes("noColor")) flags.noColor = true;
    else if (arg === "--compact" && allowed.includes("compact")) flags.compact = true;
    else if (arg === "--force" && allowed.includes("force")) flags.force = true;
    else rest.push(arg);
  }
  return { rest, flags };
}

function color(flags: Flags, code: string, text: string): string {
  if (flags.json || flags.noColor || !process.stdout.isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Resolve các đoạn path và đảm bảo kết quả vẫn nằm trong base. */
function resolveInside(base: string, ...segments: string[]): string {
  const resolved = path.resolve(base, ...segments);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Đường dẫn nằm ngoài thư mục cho phép: ${segments.join("/")}`);
  }
  return resolved;
}

function parseSkillDescription(content: string, fallbackName: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const descMatch = match[1].match(/description:\s*(?:>-\s*|>\s*|"?)(.*?)(?:\n[a-zA-Z0-9_-]+:|$)/s);
    if (descMatch) {
      return descMatch[1].replace(/\r?\n\s*/g, " ").replace(/^["']|["']$/g, "").trim();
    }
  }
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const firstParagraph = lines.find((l) => !l.startsWith("#") && !l.startsWith("---"));
  return firstParagraph ? firstParagraph.slice(0, 200) : `Skill ${fallbackName}`;
}

async function scanSkillsDir(): Promise<SkillMetadata[]> {
  const list: SkillMetadata[] = [];
  let dirs: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    dirs = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return list;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(skillsDir, d.name);
    let description = `Skill ${d.name}`;
    try {
      description = parseSkillDescription(await fs.readFile(path.join(dir, "SKILL.md"), "utf-8"), d.name);
    } catch {}
    let hasScripts = false;
    let hasReferences = false;
    try {
      const subs = await fs.readdir(dir);
      hasScripts = subs.includes("scripts");
      hasReferences = subs.includes("references") || subs.includes("resources");
    } catch {}
    list.push({
      name: d.name,
      description,
      path: `.agents/skills/${d.name}`,
      skillMdPath: `.agents/skills/${d.name}/SKILL.md`,
      hasScripts,
      hasReferences,
    });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

function isValidCatalog(value: unknown): value is SkillMetadata[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as SkillMetadata).name === "string" &&
      typeof (item as SkillMetadata).description === "string" &&
      typeof (item as SkillMetadata).path === "string" &&
      typeof (item as SkillMetadata).skillMdPath === "string" &&
      typeof (item as SkillMetadata).hasScripts === "boolean" &&
      typeof (item as SkillMetadata).hasReferences === "boolean",
  );
}

async function loadCatalog(): Promise<SkillMetadata[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(catalogFile, "utf-8"));
    if (isValidCatalog(parsed)) return parsed;
    console.error("[!] catalog.json không đúng định dạng, đang quét thư mục skills thật.");
  } catch {
    console.error("[!] Không đọc được catalog.json, đang quét thư mục skills thật.");
  }
  return scanSkillsDir();
}

interface SourceEntry {
  url: string;
  ref?: string;
  subdir?: string;
}

type Sources = Map<string, SourceEntry>;

async function loadSources(): Promise<Sources> {
  const sources: Sources = new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(sourcesFile, "utf-8"));
  } catch {
    return sources;
  }
  const dict = (parsed as { sources?: unknown })?.sources;
  if (!dict || typeof dict !== "object" || Array.isArray(dict)) {
    console.error("[!] sources.json không đúng định dạng (cần {\"sources\": {...}}), bỏ qua file này.");
    return sources;
  }
  for (const [name, value] of Object.entries(dict as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      sources.set(name.toLowerCase(), { url: value.trim() });
    } else if (value && typeof value === "object" && typeof (value as SourceEntry).url === "string" && (value as SourceEntry).url.trim()) {
      const entry = value as SourceEntry;
      sources.set(name.toLowerCase(), {
        url: entry.url.trim(),
        ...(entry.ref ? { ref: entry.ref.trim() } : {}),
        ...(entry.subdir ? { subdir: entry.subdir.trim() } : {}),
      });
    }
  }
  return sources;
}

function isGitUrl(value: string): boolean {
  return (
    /^https?:\/\/[a-zA-Z0-9_\-.\\/:]+(\.git)?$/i.test(value) ||
    /^git@[a-zA-Z0-9_\-.]+:[a-zA-Z0-9_\-./]+(\.git)?$/i.test(value) ||
    /^file:\/\/.+/.test(value)
  );
}

async function writeCatalog(catalog: SkillMetadata[]): Promise<void> {
  const text = JSON.stringify(catalog, null, 2);
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.writeFile(catalogFile, text, "utf-8");
}

function printUsage() {
  console.log(`
========================================================================
   ChatMCP AI Skills Suite (Kho Kỹ Năng Tự Động Hóa & Video)
========================================================================
Sử dụng:
  skill list [--json]           - Liệt kê toàn bộ các skill có sẵn
  skill search <từ khóa> [--json] - Tìm skill theo tên, mô tả, nội dung SKILL.md
  skill show <tên-skill>        - Hiển thị toàn bộ hướng dẫn SKILL.md
  skill cat <tên-skill>         - Tương tự 'show'
  skill install <url|tên-nguồn|user/repo> [tên] [--force] [--ref <branch/tag>] - Cài skill từ link git, tên trong sources.json, hoặc dạng rút gọn user/repo
  skill sources [--json]        - Liệt kê các nguồn đã cấu hình trong .agents/skills/sources.json
  skill run <tên-skill> [script] [args...] - Chạy script đi kèm trong thư mục scripts của skill
  skill sync-catalog            - Sinh lại catalog.json từ SKILL.md thật trên disk
  skill export-prompt [--json|--compact] - Xuất danh sách tóm tắt để nạp vào System Prompt của AI

Ví dụ:
  bun run skill list
  bun run skill search video
  bun run skill show remotion-video-creator
  bun run skill list --json
`);
}

async function findSkill(catalog: SkillMetadata[], name: string): Promise<SkillMetadata | undefined> {
  const lower = name.toLowerCase().trim();
  const fromCatalog = catalog.find((c) => c.name.toLowerCase() === lower);
  if (fromCatalog) return fromCatalog;
  const scanned = await scanSkillsDir();
  return scanned.find((c) => c.name.toLowerCase() === lower);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  if (!command || ["help", "-h", "--help"].includes(command)) {
    printUsage();
    return 0;
  }

  switch (command) {
    case "list":
    case "ls": {
      const { flags } = parseFlags(args.slice(1), ["json", "noColor"]);
      const catalog = await loadCatalog();
      if (flags.json) {
        console.log(JSON.stringify(catalog, null, 2));
        return 0;
      }
      console.log(`\n=== DANH SÁCH AI SKILLS TRONG '.agents/skills' (Tổng số: ${catalog.length}) ===\n`);
      for (let i = 0; i < catalog.length; i++) {
        const item = catalog[i];
        console.log(`[${(i + 1).toString().padStart(2, " ")}] ${color(flags, "36", item.name)}`);
        console.log(`     ${truncate(item.description, 110)}`);
        const badges: string[] = [];
        if (item.hasScripts) badges.push("scripts");
        if (item.hasReferences) badges.push("references");
        if (badges.length > 0) {
          console.log(`     ${color(flags, "90", `(features: ${badges.join(", ")})`)}`);
        }
        console.log();
      }
      return 0;
    }

    case "search":
    case "find": {
      const { rest, flags } = parseFlags(args.slice(1), ["json", "noColor"]);
      const query = rest.join(" ").toLowerCase().trim();
      if (!query) {
        return fail("Vui lòng nhập từ khóa tìm kiếm. Ví dụ: bun run skill search video");
      }
      const catalog = await loadCatalog();
      const scored: { item: SkillMetadata; score: number }[] = [];
      for (const item of catalog) {
        let score = 0;
        if (item.name.toLowerCase().includes(query)) score += 3;
        if (item.description.toLowerCase().includes(query)) score += 2;
        try {
          const content = await fs.readFile(path.join(skillsDir, item.name, "SKILL.md"), "utf-8");
          if (content.toLowerCase().includes(query)) score += 1;
        } catch {}
        if (score > 0) scored.push({ item, score });
      }
      scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
      if (flags.json) {
        console.log(JSON.stringify(scored.map((s) => ({ ...s.item, score: s.score })), null, 2));
        return 0;
      }
      console.log(`\n=== Kết quả tìm kiếm cho: "${query}" (${scored.length} kết quả) ===\n`);
      if (scored.length === 0) {
        console.log("Không tìm thấy skill nào phù hợp.");
      } else {
        for (const { item } of scored) {
          console.log(`• ${color(flags, "32", item.name)}:`);
          console.log(`  ${item.description}\n`);
        }
      }
      return 0;
    }

    case "show":
    case "cat":
    case "view": {
      const { rest } = parseFlags(args.slice(1), ["noColor"]);
      const name = rest[0]?.toLowerCase().trim();
      if (!name) {
        return fail("Vui lòng nhập tên skill cần xem. Ví dụ: bun run skill show remotion-video-creator");
      }
      const catalog = await loadCatalog();
      const match = await findSkill(catalog, name);
      if (!match) {
        return fail(`[-] Không tìm thấy skill '${name}'. Chạy 'bun run skill list' để xem danh sách.`);
      }
      let skillMd: string;
      try {
        skillMd = resolveInside(skillsDir, match.name, "SKILL.md");
      } catch (err: any) {
        return fail(`[-] ${err.message}`);
      }
      try {
        const content = await fs.readFile(skillMd, "utf-8");
        console.log(`\n========================================================================`);
        console.log(`   HƯỚNG DẪN SKILL: ${match.name}`);
        console.log(`   Đường dẫn: ${skillMd}`);
        console.log(`========================================================================\n`);
        console.log(content);
        return 0;
      } catch (err: any) {
        return fail(`[-] Không tìm thấy tệp SKILL.md cho skill '${name}'. Chi tiết: ${err.message}`);
      }
    }

    case "export-prompt": {
      const { flags } = parseFlags(args.slice(1), ["json", "noColor", "compact"]);
      const catalog = await loadCatalog();
      if (flags.json) {
        console.log(
          JSON.stringify(
            catalog.map((item) => ({
              name: item.name,
              description: flags.compact ? truncate(item.description, 200) : item.description,
            })),
            null,
            2,
          ),
        );
        return 0;
      }
      console.log("# Available AI Skills\n");
      for (const item of catalog) {
        console.log(`- **${item.name}**: ${flags.compact ? truncate(item.description, 200) : item.description}`);
      }
      return 0;
    }

    case "sources": {
      const { flags } = parseFlags(args.slice(1), ["json", "noColor"]);
      const sources = await loadSources();
      if (flags.json) {
        console.log(JSON.stringify(Object.fromEntries(sources), null, 2));
        return 0;
      }
      console.log(`\n=== NGUỒN CÀI ĐẶT TRONG '.agents/skills/sources.json' (${sources.size}) ===\n`);
      if (sources.size === 0) {
        console.log("Chưa có nguồn nào. Copy .agents/skills/sources.example.json thành sources.json rồi điền link vào.");
        console.log("Không có sources.json vẫn cài được bằng URL đầy đủ: bun run skill install https://github.com/user/repo");
      } else {
        for (const [name, entry] of [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          console.log(`• ${color(flags, "32", name)}: ${entry.url}`);
          if (entry.ref) console.log(`    ref: ${entry.ref}`);
          if (entry.subdir) console.log(`    subdir: ${entry.subdir}`);
        }
      }
      return 0;
    }

    case "sync-catalog": {
      const catalog = await scanSkillsDir();
      await writeCatalog(catalog);
      console.log(`[✔] Đã sinh lại catalog.json từ disk: ${catalog.length} skill (${catalog.map((c) => c.name).join(", ") || "không có skill nào"}).`);
      return 0;
    }

    case "install": {
      const { rest: rawRest, flags } = parseFlags(args.slice(1), ["force"]);
      const rest: string[] = [];
      let refOverride: string | undefined;
      for (let i = 0; i < rawRest.length; i++) {
        if (rawRest[i] === "--ref" && rawRest[i + 1]) {
          refOverride = rawRest[++i];
        } else if (rawRest[i].startsWith("--ref=")) {
          refOverride = rawRest[i].slice("--ref=".length) || undefined;
        } else {
          rest.push(rawRest[i]);
        }
      }
      const input = rest[0]?.trim();
      if (!input) {
        return fail("Vui lòng nhập URL, tên nguồn trong sources.json, hoặc dạng user/repo. Ví dụ: bun run skill install https://github.com/user/repo [tên_skill] | bun run skill install ten-skill");
      }

      let repoUrl: string | undefined;
      let ref: string | undefined;
      let subdir: string | undefined;
      let defaultName: string | undefined;
      if (isGitUrl(input)) {
        repoUrl = input;
      } else {
        const sources = await loadSources();
        const entry = sources.get(input.toLowerCase());
        if (entry) {
          repoUrl = entry.url;
          ref = entry.ref;
          subdir = entry.subdir;
          defaultName = input;
        } else if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) {
          repoUrl = `https://github.com/${input}`;
        } else {
          const available = [...sources.keys()].sort();
          return fail(
            `[-] Không phải URL git, không có trong sources.json, cũng không phải dạng user/repo: ${input}\n` +
              (available.length > 0
                ? `Nguồn đã cấu hình: ${available.join(", ")}`
                : "Chưa có nguồn nào trong .agents/skills/sources.json (xem sources.example.json)."),
          );
        }
      }
      if (!repoUrl || !isGitUrl(repoUrl)) {
        return fail(`[-] Lỗi: URL repository không hợp lệ trong cấu hình hoặc tham số: ${repoUrl ?? input}`);
      }
      if (refOverride) ref = refOverride;

      const rawName = (rest[1] || defaultName || repoUrl.split("/").pop()?.replace(/\.git$/, "") || "custom-skill").trim();
      const name = rawName.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "custom-skill";
      const targetDir = path.join(skillsDir, name);

      let targetExisted = false;
      try {
        await fs.access(targetDir);
        targetExisted = true;
      } catch {}
      if (targetExisted && !flags.force) {
        return fail(`[-] Skill '${name}' đã tồn tại ở ${targetDir}. Dùng --force nếu muốn ghi đè.`);
      }

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `chatmcp-skill-${name}-`));
      console.log(`[*] Bắt đầu tải skill '${name}' từ: ${repoUrl}${ref ? ` (ref: ${ref})` : ""}${subdir ? ` (subdir: ${subdir})` : ""}...`);
      try {
        const cloneArgs = subdir
          ? ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse", ...(ref ? ["--branch", ref] : []), repoUrl, tempDir]
          : ["git", "clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), repoUrl, tempDir];
        const proc = Bun.spawn(cloneArgs, {
          stdio: ["ignore", "inherit", "inherit"],
        });
        const code = await proc.exited;
        if (code !== 0) throw new Error(`Git clone thất bại với mã lỗi ${code}`);

        let sourceDir = tempDir;
        if (subdir) {
          const sparse = Bun.spawn(["git", "-C", tempDir, "sparse-checkout", "set", subdir], {
            stdio: ["ignore", "inherit", "inherit"],
          });
          const sparseCode = await sparse.exited;
          if (sparseCode !== 0) throw new Error(`Sparse checkout thất bại cho subdir '${subdir}' (mã ${sparseCode})`);
          sourceDir = resolveInside(tempDir, subdir);
          try {
            await fs.access(sourceDir);
          } catch {
            throw new Error(`Không tìm thấy subdir '${subdir}' trong repo đã clone.`);
          }
        }
        await fs.rm(path.join(tempDir, ".git"), { recursive: true, force: true });
        await fs.mkdir(targetDir, { recursive: true });
        await fs.cp(sourceDir, targetDir, { recursive: true, force: true });

        const catalog = await loadCatalog();
        const scanned = (await scanSkillsDir()).find((c) => c.name === name);
        const entry: SkillMetadata = scanned ?? {
          name,
          description: `Skill ${name}`,
          path: `.agents/skills/${name}`,
          skillMdPath: `.agents/skills/${name}/SKILL.md`,
          hasScripts: false,
          hasReferences: false,
        };
        const updated = catalog.filter((item) => item.name !== name);
        updated.push(entry);
        await writeCatalog(updated);

        console.log(`\n[✔] Đã cài đặt thành công skill '${name}'!`);
        console.log(`    Đường dẫn: ${targetDir}`);
        console.log(`    Tra cứu ngay bằng: bun run skill show ${name}`);
        return 0;
      } catch (err: any) {
        if (!targetExisted) {
          await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
        }
        return fail(`[-] Lỗi cài đặt: ${err.message}`);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }

    case "run": {
      const name = args[1]?.toLowerCase().trim();
      if (!name) {
        return fail("Vui lòng chỉ định tên skill và script. Ví dụ: bun run skill run <tên-skill> [script]");
      }
      const catalog = await loadCatalog();
      const match = await findSkill(catalog, name);
      if (!match) {
        return fail(`[-] Không tìm thấy skill '${name}'.`);
      }
      let scriptDir: string;
      try {
        scriptDir = resolveInside(skillsDir, match.name, "scripts");
      } catch (err: any) {
        return fail(`[-] ${err.message}`);
      }
      let scripts: string[];
      try {
        const entries = await fs.readdir(scriptDir, { withFileTypes: true });
        scripts = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
      } catch {
        return fail(`[-] Skill '${match.name}' không có thư mục 'scripts/' khả dụng.`);
      }
      if (args.length <= 2) {
        console.log(`Skill '${match.name}' có các scripts sau:\n`);
        for (const s of scripts) console.log(` - ${s}`);
        console.log(`\nChạy bằng lệnh: bun run skill run ${match.name} <tên_script>`);
        return 0;
      }
      const targetScript = args[2];
      if (targetScript !== path.basename(targetScript) || !scripts.includes(targetScript)) {
        return fail(`[-] Script '${targetScript}' không nằm trong danh sách scripts của skill '${match.name}'.`);
      }
      const scriptPath = path.join(scriptDir, targetScript);
      const isWin = process.platform === "win32";
      const runner =
        targetScript.endsWith(".py") ? (isWin ? "python" : "python3") :
        targetScript.endsWith(".ts") ? "bun" :
        targetScript.endsWith(".js") ? "node" :
        targetScript.endsWith(".sh") ? "sh" : null;
      if (!runner) {
        return fail(`[-] Không hỗ trợ chạy script đuôi khác .py/.ts/.js/.sh: ${targetScript}`);
      }
      console.log(`[*] Thực thi script: ${scriptPath}`);
      try {
        const proc = Bun.spawn([runner, scriptPath, ...args.slice(3)], {
          stdio: ["inherit", "inherit", "inherit"],
          cwd: scriptDir,
        });
        const code = await proc.exited;
        if (code !== 0) {
          console.error(`[-] Script kết thúc với mã lỗi ${code}`);
          return code ?? 1;
        }
        return 0;
      } catch (err: any) {
        return fail(`[-] Không chạy được script '${targetScript}': ${err.message}`);
      }
    }

    default:
      console.error(`Lệnh không hợp lệ: '${command}'`);
      printUsage();
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });

