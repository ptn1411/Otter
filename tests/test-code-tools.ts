#!/usr/bin/env bun
/**
 * Code workspace tools test — no index, no real repo, no network.
 * Fixture tree lives in a temp dir registered via registerAllowedWorkspace
 * (the same mechanism the Folder Picker uses), because code tools enforce
 * the same safe-path guard as terminal.ts. Plan tests use a temp SQLite
 * file via initDatabase, like test-fb-post.ts.
 *
 * Run: bun scripts/test-code-tools.ts
 * Exit 0 = all checks pass, exit 1 = any check fails.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { initDatabase } from "../src/daemon/db";
import { createPlan } from "../src/daemon/plan";
import { updatePlanTask } from "../src/daemon/plan";
import { registerAllowedWorkspace } from "../src/daemon/security";
import { registerCodeTools } from "../src/daemon/tools/code-tools";

let failures = 0;
let passed = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed += 1;
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-codetools-"));
const root = path.join(tmpDir, "repo");
const srcDir = path.join(root, "src");
fs.mkdirSync(srcDir, { recursive: true });
registerAllowedWorkspace(root);

const aTs = [
  "export function alpha() {",
  "  return 1;",
  "}",
  "",
  "export class Beta {",
  "  nested() { return 2; }",
  "}",
  "export interface Gamma {",
  "  x: number;",
  "}",
  "export type Delta = string;",
  "export const epsilon = () => 3;",
  "export const zeta = async (x: number) => x;",
  "if (true) {",
  "  function hiddenHelper() {}",
  "}",
].join("\n") + "\n";
fs.writeFileSync(path.join(srcDir, "a.ts"), aTs);

const bPy = [
  "def zeta_func():",
  "    return 1",
  "",
  "class Eta:",
  "    def method_inside(self):",
  "        return 2",
].join("\n") + "\n";
fs.writeFileSync(path.join(srcDir, "b.py"), bPy);

fs.writeFileSync(path.join(root, "notes.md"), "# Notes\nalpha appears here too.\n");
fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
fs.writeFileSync(path.join(root, "node_modules", "fake.ts"), "export function alpha() {}\n");
fs.mkdirSync(path.join(root, ".git"), { recursive: true });
fs.writeFileSync(path.join(root, ".git", "ignored.ts"), "export function alpha() {}\n");
fs.writeFileSync(path.join(root, "bin.dat"), Buffer.from([0x00, 0x01, 0x02, ...Buffer.from("alpha")]));

// Mock MCP server: only tool() is needed, like test-db-tools.ts.
const tools: Record<string, (args: any) => Promise<any>> = {};
const mockMcp: any = {
  tool(name: string, _desc: string, _shape: unknown, fn: (args: any) => Promise<any>) {
    tools[name] = fn;
  },
};
registerCodeTools(mockMcp);

async function callTool(name: string, args: any): Promise<{ ok: boolean; data: any }> {
  const res = await tools[name](args);
  const textOut = res?.content?.[0]?.text ?? "";
  try {
    return { ok: !res?.isError, data: JSON.parse(textOut) };
  } catch {
    return { ok: !res?.isError, data: textOut };
  }
}

const expectedTools = ["code_search_text", "code_list_files", "code_find_symbol", "code_outline", "code_git_status", "plan_task_update"];
check("all 6 code tools register on mock MCP server", expectedTools.every((t) => typeof tools[t] === "function"), Object.keys(tools).sort());

// 1. search: finds known hits, skips node_modules/.git, respects maxResults.
const search = await callTool("code_search_text", { root, pattern: "alpha", maxResults: 50 });
check("search finds a.ts hit", search.ok && search.data.hits.some((h: any) => h.file === "src/a.ts" && h.text.includes("alpha")));
check("search skips node_modules", search.ok && !search.data.hits.some((h: any) => h.file.includes("node_modules")));
check("search skips .git", search.ok && !search.data.hits.some((h: any) => h.file.includes(".git")));
check("search skips binary file", search.ok && !search.data.hits.some((h: any) => h.file === "bin.dat"));
const capped = await callTool("code_search_text", { root, pattern: "a", maxResults: 2 });
check("search respects maxResults with truncated flag", capped.ok && capped.data.hits.filter((h: any) => !h.isContext).length <= 2 && capped.data.truncated === true);
const outside = await callTool("code_search_text", { root: "/etc", pattern: "x" });
check("search outside workspace is refused", !outside.ok);

// 2. list_files: glob + cap + skip dirs.
const listed = await callTool("code_list_files", { root, glob: "**/*.py" });
check("list_files glob finds b.py only", listed.ok && listed.data.files.length === 1 && listed.data.files[0] === "src/b.py", listed.data);
const listedCap = await callTool("code_list_files", { root, maxResults: 2 });
check("list_files caps with truncated flag", listedCap.ok && listedCap.data.files.length === 2 && listedCap.data.truncated === true);
check("list_files capped output contains no skipped dirs", listedCap.ok && !listedCap.data.files.some((f: string) => f.includes("node_modules") || f.startsWith(".git/")), listedCap.data);
const listedAll = await callTool("code_list_files", { root, maxResults: 1000 });
check("list_files never returns skipped dirs", listedAll.ok && !listedAll.data.files.some((f: string) => f.includes("node_modules") || f.startsWith(".git/")));

// 3. find_symbol across languages.
const foundBeta = await callTool("code_find_symbol", { root, name: "Beta" });
check("find_symbol finds class Beta in a.ts", foundBeta.ok && foundBeta.data.symbols.some((s: any) => s.name === "Beta" && s.kind === "class" && s.file === "src/a.ts" && s.line === 5), foundBeta.data);
const foundZeta = await callTool("code_find_symbol", { root, name: "zeta" });
check("find_symbol finds TS const zeta and Python def zeta_func", foundZeta.ok
  && foundZeta.data.symbols.some((s: any) => s.name === "zeta" && s.file === "src/a.ts")
  && foundZeta.data.symbols.some((s: any) => s.name === "zeta_func" && s.file === "src/b.py"), foundZeta.data);
const foundHidden = await callTool("code_find_symbol", { root, name: "hiddenHelper" });
check("find_symbol finds indented (non-top-level) definitions", foundHidden.ok && foundHidden.data.symbols.some((s: any) => s.name === "hiddenHelper"));

// 4. outline: top-level only, correct lines.
const outline = await callTool("code_outline", { file: path.join(srcDir, "a.ts") });
const outlineNames = outline.ok ? outline.data.symbols.map((s: any) => s.name) : [];
check("outline lists top-level symbols with correct lines", outline.ok
  && outlineNames.includes("alpha") && outlineNames.includes("Beta") && outlineNames.includes("Gamma")
  && outlineNames.includes("Delta") && outlineNames.includes("epsilon") && outlineNames.includes("zeta")
  && outline.data.symbols.find((s: any) => s.name === "Beta")?.line === 5, outline.data);
check("outline excludes indented definitions", outline.ok && !outlineNames.includes("hiddenHelper") && !outlineNames.includes("nested"));
const outlinePy = await callTool("code_outline", { file: path.join(srcDir, "b.py") });
check("outline python excludes indented method", outlinePy.ok
  && outlinePy.data.symbols.some((s: any) => s.name === "zeta_func")
  && outlinePy.data.symbols.some((s: any) => s.name === "Eta")
  && !outlinePy.data.symbols.some((s: any) => s.name === "method_inside"), outlinePy.data);

// 5. git_status: dirty repo + non-repo error (skip if git missing).
const gitCheck = spawnSync("git", ["--version"], { encoding: "utf-8" });
if (gitCheck.error || gitCheck.status !== 0) {
  console.log("  SKIP git_status tests (git not available)");
} else {
  const gitRoot = path.join(tmpDir, "gitrepo");
  fs.mkdirSync(gitRoot, { recursive: true });
  registerAllowedWorkspace(gitRoot);
  const git = (args: string[]) => spawnSync("git", args, { cwd: gitRoot, encoding: "utf-8" });
  git(["init", "-q"]);
  fs.writeFileSync(path.join(gitRoot, "tracked.txt"), "one\n");
  git(["-c", "user.email=t@t", "-c", "user.name=t", "add", "."]);
  git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  fs.writeFileSync(path.join(gitRoot, "tracked.txt"), "one\ntwo\n");
  const st = await callTool("code_git_status", { root: gitRoot });
  check("git_status reports dirty file", st.ok && st.data.status.includes("tracked.txt") && st.data.diffStat.includes("tracked.txt"), st.data);
  const stDiff = await callTool("code_git_status", { root: gitRoot, includeDiff: true });
  check("git_status includeDiff capped at 200 lines", stDiff.ok && typeof stDiff.data.diff === "string" && stDiff.data.diff.split("\n").length <= 200 && stDiff.data.diff.includes("two"));
  const notRepo = await callTool("code_git_status", { root });
  check("git_status on non-repo returns clear error, not a crash", !notRepo.ok && typeof notRepo.data === "string" && /not a git repository/i.test(notRepo.data), notRepo.data);
}

// 6. plan_task_update via pure plan.ts on a temp DB.
const dbPath = path.join(tmpDir, "test.db");
const db: any = initDatabase(dbPath);
const created = createPlan(db, { goal: "Test plan", tasks: [{ goal: "First task" }, { goal: "Second task" }] });
const [t1, t2] = created.tasks;
const updated = updatePlanTask(db, t1.id, { title: "First task (edited)", notes: "do it well", status: "blocked", dependsOn: [t2.id] });
check("plan_task_update edits title/notes/status/dependsOn", updated.goal === "First task (edited)" && updated.details === "do it well" && updated.status === "blocked" && updated.dependsOn.length === 1 && updated.dependsOn[0] === t2.id, updated);
let threw = "";
try { updatePlanTask(db, "nope_missing", { title: "x" }); } catch (e: any) { threw = e.message; }
check("plan_task_update refuses unknown task id", /Unknown plan taskId/.test(threw), threw);
threw = "";
try { updatePlanTask(db, t1.id, { status: "bogus" as any }); } catch (e: any) { threw = e.message; }
check("plan_task_update refuses invalid status", /Invalid plan task status/.test(threw), threw);
threw = "";
try { updatePlanTask(db, t1.id, { dependsOn: ["nope_missing"] }); } catch (e: any) { threw = e.message; }
check("plan_task_update refuses unknown dependsOn id", /Unknown dependsOn task id/.test(threw), threw);
threw = "";
try { updatePlanTask(db, t1.id, { dependsOn: [t1.id] }); } catch (e: any) { threw = e.message; }
check("plan_task_update refuses self-dependency", /cannot depend on itself/.test(threw), threw);

console.log(`\n${passed} passed, ${failures} failed.`);
if (failures > 0) {
  console.log("Some code-tools checks FAILED.");
  process.exit(1);
}
console.log("All code-tools checks passed.");
