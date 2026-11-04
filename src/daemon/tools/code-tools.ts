/**
 * Code workspace tools — repo search, file listing, symbol finding and
 * outlining WITHOUT any index step (contrast with codebase.ts, whose
 * codebase_search_graph needs an indexed AST via an external binary).
 * Uses ripgrep (/usr/bin/rg) when present, with a grep -rn fallback, and
 * the same safe-path guard as terminal.ts (assertSafePath from
 * ../security, which allows the daemon cwd plus registered workspaces).
 * Also hosts plan_task_update, which edits one plan task via the pure
 * updatePlanTask() in ../plan.ts (same style as the plan-tools wrappers).
 *
 * Everything here is read-only except plan_task_update, which only edits
 * one row of the daemon's own plan_tasks table — it never touches repo
 * files. No repo file is ever written by these tools.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import { assertSafePath } from "../security";
import { updatePlanTask, type PlanTaskStatus } from "../plan";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

const RG_PATH = "/usr/bin/rg";
const SPAWN_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2_000_000;

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", "dist"]);

function safeDir(root: string): string {
  const resolved = assertSafePath(root);
  let st: fs.Stats;
  try {
    st = fs.statSync(resolved);
  } catch {
    throw new Error(`Root directory does not exist: ${root}`);
  }
  if (!st.isDirectory()) throw new Error(`Root is not a directory: ${root}`);
  return resolved;
}

function isBinaryBuffer(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

/** Convert a small glob (**, *, ?, {a,b}) to a RegExp matched against a posix-style relative path. */
function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // **/ matches zero or more directories; trailing ** matches rest.
        if (glob[i + 2] === "/") { out += "(?:.*/)?"; i += 2; }
        else { out += ".*"; i += 1; }
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      const close = glob.indexOf("}", i);
      if (close === -1) { out += "\\{"; }
      else {
        const alts = glob.slice(i + 1, close).split(",").map((a) => a.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
        out += `(?:${alts.join("|")})`;
        i = close;
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(out + "$");
}

/** Walk a tree, skipping junk dirs. Stops at hardCap files (returns truncated=true then). */
function walkFiles(root: string, hardCap: number): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.isFile()) {
        if (files.length >= hardCap) { truncated = true; continue; }
        files.push(full);
      }
    }
  }
  return { files, truncated };
}

type SearchHit = { file: string; line: number; text: string; isContext: boolean };

function searchWithRg(root: string, pattern: string, include: string | undefined, contextLines: number, maxResults: number): { hits: SearchHit[]; truncated: boolean } {
  const args = ["--json", "--line-number", "-C", String(contextLines), "--no-heading"];
  if (include) args.push("--glob", include);
  args.push("--glob", "!node_modules", "--glob", "!dist");
  args.push(pattern, root);
  const res = spawnSync(RG_PATH, args, { encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
  if (res.error) throw new Error(`ripgrep failed: ${(res.error as Error).message}`);
  const hits: SearchHit[] = [];
  let truncated = false;
  const out = (res.stdout || "") as string;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj.type !== "match" && obj.type !== "context") continue;
    const data = obj.data;
    const isContext = obj.type === "context";
    if (!isContext) {
      if (hits.filter((h) => !h.isContext).length >= maxResults) { truncated = true; break; }
    }
    hits.push({
      file: path.relative(root, data.path?.text ?? ""),
      line: data.line_number ?? 0,
      text: (data.lines?.text ?? "").replace(/\n$/, "").slice(0, 500),
      isContext,
    });
  }
  return { hits, truncated };
}

function searchFallback(root: string, pattern: string, include: string | undefined, contextLines: number, maxResults: number): { hits: SearchHit[]; truncated: boolean } {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  const incRe = include ? globToRegExp(include) : null;
  const walked = walkFiles(root, 20000);
  const hits: SearchHit[] = [];
  let truncated = false;

  for (const full of walked.files) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (incRe && !incRe.test(rel)) continue;
    const content = readTextFile(full);
    if (content === null) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        if (hits.filter((h) => !h.isContext).length >= maxResults) {
          truncated = true;
          break;
        }
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        for (let j = start; j < end; j++) {
          hits.push({
            file: rel,
            line: j + 1,
            text: lines[j].slice(0, 500),
            isContext: j !== i,
          });
        }
      }
    }
    if (truncated) break;
  }
  return { hits, truncated };
}

function searchWithGrep(root: string, pattern: string, include: string | undefined, contextLines: number, maxResults: number): { hits: SearchHit[]; truncated: boolean } {
  const args = ["-rn", "-I", "-C", String(contextLines), "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist"];
  if (include) args.push(`--include=${include}`);
  args.push(pattern, root);
  const res = spawnSync("grep", args, { encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
  if (res.error) throw new Error(`grep failed: ${(res.error as Error).message}`);
  // grep exit 1 = no matches, not an error.
  if (res.status !== 0 && res.status !== 1) throw new Error(`grep failed (exit ${res.status}): ${((res.stderr || "") as string).slice(0, 300)}`);
  const hits: SearchHit[] = [];
  let truncated = false;
  const lineRe = /^(.+?)[-:](\d+)[-:](.*)$/;
  for (const line of ((res.stdout || "") as string).split("\n")) {
    if (!line) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const isContext = line.slice(m[1].length, m[1].length + 1) === "-";
    if (!isContext) {
      if (hits.filter((h) => !h.isContext).length >= maxResults) { truncated = true; break; }
    }
    hits.push({ file: path.relative(root, m[1]), line: Number(m[2]), text: m[3].slice(0, 500), isContext });
  }
  return { hits, truncated };
}

type SymbolDef = { file: string; line: number; kind: string; name: string; text: string };

const TS_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
  { re: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/, kind: "type" },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(/, kind: "function" },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: "function" },
  { re: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, kind: "function" },
];

const PY_PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /^(\s*)def\s+([A-Za-z_]\w*)/, kind: "function" },
  { re: /^(\s*)class\s+([A-Za-z_]\w*)/, kind: "class" },
];

function patternsFor(file: string): { re: RegExp; kind: string; nameGroup: number }[] {
  if (/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/.test(file)) {
    return TS_PATTERNS.map((p) => ({ ...p, nameGroup: 1 }));
  }
  if (/\.py$/.test(file)) {
    return PY_PATTERNS.map((p) => ({ ...p, nameGroup: 2 }));
  }
  return [];
}

function extractSymbols(file: string, content: string, topLevelOnly: boolean, nameFilter?: string): SymbolDef[] {
  const patterns = patternsFor(file);
  if (patterns.length === 0) return [];
  const out: SymbolDef[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (topLevelOnly && /^\s/.test(line)) continue;
    for (const p of patterns) {
      const m = line.match(p.re);
      if (!m) continue;
      const name = m[p.nameGroup];
      if (!name) continue;
      if (nameFilter && !name.toLowerCase().includes(nameFilter.toLowerCase())) continue;
      out.push({ file, line: i + 1, kind: p.kind, name, text: line.trim().slice(0, 200) });
      break;
    }
  }
  return out;
}

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".py"]);

function readTextFile(full: string): string | null {
  let buf: Buffer;
  try {
    const st = fs.statSync(full);
    if (st.size > 1024 * 1024) return null;
    buf = fs.readFileSync(full);
  } catch {
    return null;
  }
  if (isBinaryBuffer(buf)) return null;
  return buf.toString("utf-8");
}

const TASK_STATUSES: PlanTaskStatus[] = ["pending", "running", "success", "failed", "blocked", "skipped"];

export function registerCodeTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "code_search_text",
    "Tìm chuỗi/regex trong repo mà KHÔNG cần index (ripgrep, fallback grep). Bỏ qua .git, node_modules, dist và file nhị phân. Kết quả bị giới hạn: tối đa maxResults hit, output tối đa 2MB.",
    {
      root: z.string().optional().describe("Thư mục gốc tìm kiếm (mặc định: thư mục làm việc của daemon, phải nằm trong workspace an toàn)"),
      pattern: z.string().describe("Regex cần tìm (ripgrep/grep syntax)"),
      include: z.string().optional().describe("Glob lọc file, ví dụ 'src/**/*.ts'"),
      contextLines: z.number().int().min(0).max(10).optional().describe("Số dòng ngữ cảnh quanh mỗi hit (mặc định 2)"),
      maxResults: z.number().int().min(1).max(200).optional().describe("Số hit tối đa (mặc định 50)"),
    },
    async (args) => {
      try {
        const root = safeDir(args.root ?? ".");
        const contextLines = clampInt(args.contextLines, 2, 0, 10);
        const maxResults = clampInt(args.maxResults, 50, 1, 200);
        let engine = "ts";
        let result: { hits: SearchHit[]; truncated: boolean };
        if (fs.existsSync(RG_PATH)) {
          engine = "rg";
          result = searchWithRg(root, args.pattern, args.include, contextLines, maxResults);
        } else if (process.platform !== "win32") {
          try {
            engine = "grep";
            result = searchWithGrep(root, args.pattern, args.include, contextLines, maxResults);
          } catch {
            engine = "ts";
            result = searchFallback(root, args.pattern, args.include, contextLines, maxResults);
          }
        } else {
          engine = "ts";
          result = searchFallback(root, args.pattern, args.include, contextLines, maxResults);
        }
        return text({ root, pattern: args.pattern, hits: result.hits, truncated: result.truncated, engine });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "code_list_files",
    "Liệt kê file trong repo theo glob, KHÔNG cần index. Bỏ qua .git, node_modules, __pycache__, dist. Kết quả sắp xếp theo tên, có cờ truncated khi vượt giới hạn.",
    {
      root: z.string().optional().describe("Thư mục gốc (mặc định: thư mục làm việc của daemon)"),
      glob: z.string().optional().describe("Glob lọc file (mặc định **/*.{ts,tsx,js,py,md})"),
      maxResults: z.number().int().min(1).max(1000).optional().describe("Số file tối đa (mặc định 200)"),
    },
    async (args) => {
      try {
        const root = safeDir(args.root ?? ".");
        const maxResults = clampInt(args.maxResults, 200, 1, 1000);
        const re = globToRegExp(args.glob ?? "**/*.{ts,tsx,js,py,md}");
        const walked = walkFiles(root, 20000);
        const matched = walked.files
          .map((f) => path.relative(root, f).split(path.sep).join("/"))
          .filter((rel) => re.test(rel))
          .sort();
        const truncated = walked.truncated || matched.length > maxResults;
        return text({ root, files: matched.slice(0, maxResults), truncated, totalMatched: matched.length });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "code_find_symbol",
    "Tìm định nghĩa symbol theo chuỗi tên con (không phân biệt hoa/thường), KHÔNG cần index: quét regex theo ngôn ngữ. TypeScript/JavaScript: function, class, interface, type, const arrow function, export. Python: def, class. Bỏ qua file nhị phân và file >1MB.",
    {
      root: z.string().optional().describe("Thư mục gốc (mặc định: thư mục làm việc của daemon)"),
      name: z.string().describe("Chuỗi tên con cần tìm trong tên symbol"),
      maxResults: z.number().int().min(1).max(200).optional().describe("Số kết quả tối đa (mặc định 100)"),
    },
    async (args) => {
      try {
        const root = safeDir(args.root ?? ".");
        const maxResults = clampInt(args.maxResults, 100, 1, 200);
        const walked = walkFiles(root, 20000);
        const out: SymbolDef[] = [];
        let truncated = walked.truncated;
        for (const full of walked.files) {
          if (out.length >= maxResults) { truncated = true; break; }
          if (!CODE_EXTS.has(path.extname(full))) continue;
          const content = readTextFile(full);
          if (content === null) continue;
          const rel = path.relative(root, full).split(path.sep).join("/");
          for (const sym of extractSymbols(rel, content, false, args.name)) {
            if (out.length >= maxResults) { truncated = true; break; }
            out.push(sym);
          }
        }
        return text({ root, name: args.name, symbols: out, truncated });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "code_outline",
    "Phác thảo MỘT file: chỉ các symbol cấp cao nhất (dòng không thụt đầu dòng), cùng họ regex với code_find_symbol. Tối đa 200 symbol.",
    {
      file: z.string().describe("Đường dẫn file cần phác thảo (phải nằm trong workspace an toàn)"),
    },
    async (args) => {
      try {
        const full = assertSafePath(args.file);
        const content = readTextFile(full);
        if (content === null) return err(`Cannot outline file (missing, binary, or larger than 1MB): ${args.file}`);
        const symbols = extractSymbols(path.basename(full), content, true).slice(0, 200);
        return text({ file: args.file, symbols, truncated: symbols.length >= 200 });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "code_git_status",
    "CHỈ ĐỌC: git status --short + git diff --stat trong root. Không chạy git add/commit/checkout hay bất kỳ lệnh ghi nào. Root không phải repo git thì trả lỗi rõ ràng, không stack trace.",
    {
      root: z.string().optional().describe("Thư mục gốc repo (mặc định: thư mục làm việc của daemon)"),
      includeDiff: z.boolean().optional().describe("Kèm git diff đầy đủ, tối đa 200 dòng (mặc định false)"),
    },
    async (args) => {
      try {
        const root = safeDir(args.root ?? ".");
        const runGit = (gitArgs: string[]) => spawnSync("git", gitArgs, { cwd: root, encoding: "utf-8", timeout: SPAWN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES });
        const status = runGit(["status", "--short"]);
        if (status.error) return err(`git failed: ${(status.error as Error).message}`);
        if (status.status !== 0) {
          const stderr = ((status.stderr || "") as string).trim();
          if (/not a git repository/i.test(stderr)) return err(`Not a git repository: ${root}`);
          return err(`git status failed: ${stderr.slice(0, 300) || `exit ${status.status}`}`);
        }
        const stat = runGit(["diff", "--stat"]);
        let diff: string | undefined;
        let diffTruncated = false;
        if (args.includeDiff) {
          const d = runGit(["diff"]);
          const lines = ((d.stdout || "") as string).split("\n");
          diffTruncated = lines.length > 200;
          diff = lines.slice(0, 200).join("\n");
        }
        return text({ root, status: (status.stdout as string).trim(), diffStat: ((stat.stdout || "") as string).trim(), diff, diffTruncated });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "plan_task_update",
    "Sửa MỘT task trong plan: title (goal) và/hoặc notes (details) và/hoặc status và/hoặc dependsOn. Từ chối id task không tồn tại, status không hợp lệ, và dependsOn trỏ tới id không có trong cùng plan. Chỉ sửa dòng task, không tự đổi trạng thái plan.",
    {
      planTaskId: z.string().describe("Id của plan task cần sửa"),
      title: z.string().optional().describe("Tiêu đề mới (goal)"),
      notes: z.string().optional().describe("Ghi chú mới (details)"),
      status: z.enum(TASK_STATUSES as [PlanTaskStatus, ...PlanTaskStatus[]]).optional().describe("Trạng thái mới: pending, running, success, failed, blocked, skipped"),
      dependsOn: z.array(z.string()).optional().describe("Danh sách id task trong cùng plan phải xong trước"),
    },
    async (args) => {
      try {
        const task = updatePlanTask(getDatabase() as any, args.planTaskId, {
          title: args.title,
          notes: args.notes,
          status: args.status,
          dependsOn: args.dependsOn,
        });
        onActivity?.({ type: "plan_task_updated", planTaskId: task.id, planId: task.planId });
        return text({ task });
      } catch (e: any) {
        return err(e.message);
      }
    },
  );
}
