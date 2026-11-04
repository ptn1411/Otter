/**
 * MCP tool wrappers for the loop controller (see ../loop-controller.ts).
 * Thin wrappers only: all state-machine rules live in loop-controller.ts so
 * they can be tested without an MCP server.
 *
 * Tools (10): loop_start, loop_next, loop_report_attempt, loop_status,
 * loop_pause, loop_resume, loop_stop, loop_finish, loop_run_suite,
 * loop_block.
 *
 * Final-gate safety: loop_run_suite only ever runs a script from
 * SUITE_REGISTRY below (a script id, never a caller-supplied path), and
 * loop_finish only passes when every plan task is done AND every
 * registered suite passes. Every registered suite was verified to run
 * against temp DBs/fixtures only — never the production daemon DB, never
 * a real account, no network fetch. New suites are added in exactly one
 * place: SUITE_REGISTRY.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import { assertSafePath, registerAllowedWorkspace } from "../security";
import {
  blockLoop,
  evaluateFinalGate,
  getLoopStatus,
  markLoopFinished,
  nextLoopTask,
  pauseLoop,
  recordSuiteRun,
  reportLoopAttempt,
  requireLoopRun,
  resumeLoop,
  startLoop,
  stopLoop,
} from "../loop-controller";

export interface SuiteRegistryEntry {
  id: string;
  script: string;
  description: string;
}

/**
 * THE single registry of auto-runnable regression suites. Add a new suite
 * here and it joins loop_finish automatically. All entries below were
 * verified on 2026-10-31: each uses a temp SQLite file (OTTER_DB_PATH),
 * temp dirs, or pure fixtures; none touches the production daemon DB,
 * real accounts, or the network. If a future suite ever needs the network
 * or a real account, do NOT add it here — keep it manual-only.
 */
export const SUITE_REGISTRY: SuiteRegistryEntry[] = [
  { id: "test-plan-phase1", script: "tests/test-plan-phase1.ts", description: "Plan model phase 1 (temp DB)" },
  { id: "test-continuous-loop", script: "tests/test-continuous-loop.ts", description: "Continuous loop queue/heartbeat/sweeper (temp DB)" },
  { id: "test-plan-dashboard", script: "tests/test-plan-dashboard.ts", description: "Plan dashboard routes (temp DB)" },
  { id: "test-fb-post", script: "tests/test-fb-post.ts", description: "FB auto-post tracker (temp DB, fixture RSS)" },
  { id: "test-fb-reply", script: "tests/test-fb-reply.ts", description: "FB reply tracker (temp DB)" },
  { id: "test-fb-comment-parser", script: "tests/test-fb-comment-parser.ts", description: "FB comment parser (pure, no DB)" },
  { id: "test-db-tools", script: "tests/test-db-tools.ts", description: "DB manager MCP wrapper (temp DBM_HOME)" },
  { id: "test-code-tools", script: "tests/test-code-tools.ts", description: "Code workspace tools (temp DB, temp git fixture)" },
];

export const SUITE_TIMEOUT_DEFAULT_SECONDS = 60;
export const SUITE_TIMEOUT_MAX_SECONDS = 120;
export const SUITE_OUTPUT_MAX_BYTES = 2 * 1024 * 1024;
export const SUITE_OUTPUT_EXCERPT_CHARS = 4000;

/**
 * Resolve the bun binary to spawn for suite runs. Under bun, process.execPath
 * IS the bun binary, so prefer it: relying on "bun" being on PATH breaks on
 * machines where bun is user-local (e.g. ~/.local/bin/bun on nam, not on PATH
 * for non-interactive SSH), which made every suite run fail instantly there
 * with a null exit code and no output. Fall back to PATH lookup otherwise.
 */
export function resolveBunBinary(): string {
  const base = path.basename(process.execPath);
  if (base === "bun" || base.startsWith("bun")) return process.execPath;
  return "bun";
}

export function getRepoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export interface SuiteRunResult {
  suiteId: string;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  outputExcerpt: string | null;
}

/**
 * Run one script as a regression suite. The script path must pass the
 * same safe-path guard as terminal tools (daemon cwd + registered
 * workspaces); callers must register a temp dir first when running a
 * fixture script outside the repo. Output is capped, the run is timed
 * out, and the verdict is the process exit code only.
 */
export function runSuiteScript(
  scriptPath: string,
  opts?: { timeoutSeconds?: number; cwd?: string },
): SuiteRunResult {
  const resolved = assertSafePath(scriptPath);
  if (!resolved.endsWith(".ts")) throw new Error(`Suite script must be a .ts file: ${scriptPath}`);
  if (!fs.existsSync(resolved)) throw new Error(`Suite script not found: ${resolved}`);
  const timeoutSeconds = Math.max(1, Math.min(SUITE_TIMEOUT_MAX_SECONDS, Math.floor(opts?.timeoutSeconds ?? SUITE_TIMEOUT_DEFAULT_SECONDS)));
  const started = Date.now();
  const res = spawnSync(resolveBunBinary(), [resolved], {
    cwd: opts?.cwd ?? getRepoRoot(),
    encoding: "utf-8",
    timeout: timeoutSeconds * 1000,
    maxBuffer: SUITE_OUTPUT_MAX_BYTES,
  });
  const spawnError = (res as { error?: Error }).error;
  const combined = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
  const excerpt = combined.trim()
    ? combined.slice(-SUITE_OUTPUT_EXCERPT_CHARS)
    : spawnError
      ? `spawn error: ${spawnError.message}`
      : null;
  return {
    suiteId: path.basename(resolved, ".ts"),
    passed: res.status === 0,
    exitCode: typeof res.status === "number" ? res.status : null,
    durationMs: Date.now() - started,
    outputExcerpt: excerpt,
  };
}

/** Run one registered suite by id (never by caller-supplied path). */
export function runRegisteredSuite(
  suiteId: string,
  opts?: { timeoutSeconds?: number },
): SuiteRunResult {
  const entry = SUITE_REGISTRY.find((s) => s.id === suiteId);
  if (!entry) {
    throw new Error(`Unknown suiteId: ${suiteId} (registered: ${SUITE_REGISTRY.map((s) => s.id).join(", ")})`);
  }
  const repoRoot = getRepoRoot();
  registerAllowedWorkspace(repoRoot);
  const result = runSuiteScript(path.join(repoRoot, entry.script), opts);
  return { ...result, suiteId: entry.id };
}

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function registerLoopTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "loop_start",
    "Bắt đầu vòng lặp code chuẩn cho một plan đang running (kiểm tra G0: mọi task phải có goal + details + verify + dependsOn hợp lệ, nếu không sẽ bị từ chối kèm task vi phạm). Ngân sách mặc định 20 lượt / 60 phút.",
    {
      planId: z.string(),
      maxTurns: z.number().int().min(1).max(200).optional().describe("Số lượt dispatch tối đa (mặc định 20)"),
      maxMinutes: z.number().int().min(1).max(480).optional().describe("Số phút tối đa (mặc định 60)"),
    },
    async ({ planId, maxTurns, maxMinutes }) => {
      const db = getDatabase();
      const loop = startLoop(db, planId, { maxTurns, maxMinutes });
      onActivity?.({ type: "loop_started", loopId: loop.id, planId });
      return text({ loop });
    },
  );

  mcp.tool(
    "loop_next",
    "Lấy task tiếp theo vòng lặp nên làm (task ready đầu tiên theo thứ tự, dependsOn đều done; task failed còn lượt sẽ được dispatch lại). Từ chối khi loop không running, hết ngân sách (loop tự pause làm checkpoint), plan không running, đã có task đang chạy, hoặc không còn task ready — kèm lý do chính xác.",
    { loopId: z.string() },
    async ({ loopId }) => {
      const db = getDatabase();
      const result = nextLoopTask(db, loopId);
      if (result.task) onActivity?.({ type: "loop_task_dispatched", loopId, taskId: result.task.id });
      return text(result);
    },
  );

  mcp.tool(
    "loop_report_attempt",
    "Báo cáo kết quả làm một task đã dispatch: passed thì task done (chỉ có passed mới được done); failed thì tính vào luật 3 lần (lần failed thứ 3 hoặc 3 lượt không tiến triển liên tiếp sẽ block task + loop kèm bằng chứng). Evidence: tên test fail, đoạn output, file đã đổi.",
    {
      loopId: z.string(),
      planTaskId: z.string(),
      outcome: z.enum(["passed", "failed"]),
      testName: z.string().optional().describe("Tên test/suite fail (khi failed) hoặc pass (khi passed)"),
      outputExcerpt: z.string().optional().describe("Đoạn output fail liên quan (tối đa 2000 ký tự được lưu)"),
      changedFiles: z.array(z.string()).optional().describe("File đã đổi trong lần thử này (tối đa 50)"),
    },
    async ({ loopId, planTaskId, outcome, testName, outputExcerpt, changedFiles }) => {
      const db = getDatabase();
      const result = reportLoopAttempt(db, loopId, planTaskId, outcome, { testName, outputExcerpt, changedFiles });
      onActivity?.({ type: outcome === "passed" ? "loop_task_done" : "loop_attempt_failed", loopId, taskId: planTaskId, blocked: result.blocked });
      return text(result);
    },
  );

  mcp.tool(
    "loop_status",
    "Xem trạng thái vòng lặp: ngân sách còn lại, từng task kèm số lần thử và evidence cuối, task chưa xong, task bị block.",
    { loopId: z.string() },
    async ({ loopId }) => {
      const db = getDatabase();
      return text(getLoopStatus(db, loopId));
    },
  );

  mcp.tool(
    "loop_pause",
    "Tạm dừng một vòng lặp đang running (giữ nguyên checkpoint, task done không mất).",
    { loopId: z.string() },
    async ({ loopId }) => {
      const db = getDatabase();
      return text({ loop: pauseLoop(db, loopId) });
    },
  );

  mcp.tool(
    "loop_resume",
    "Chạy tiếp một vòng lặp paused hoặc blocked (sau khi người đã can thiệp). Có thể nới ngân sách bằng maxTurns/maxMinutes mới; không nới thì giữ ngân sách cũ.",
    {
      loopId: z.string(),
      maxTurns: z.number().int().min(1).max(200).optional(),
      maxMinutes: z.number().int().min(1).max(480).optional(),
    },
    async ({ loopId, maxTurns, maxMinutes }) => {
      const db = getDatabase();
      return text({ loop: resumeLoop(db, loopId, { maxTurns, maxMinutes }) });
    },
  );

  mcp.tool(
    "loop_stop",
    "Dừng hẳn một vòng lặp (trạng thái cuối, không resume được).",
    { loopId: z.string() },
    async ({ loopId }) => {
      const db = getDatabase();
      return text({ loop: stopLoop(db, loopId) });
    },
  );

  mcp.tool(
    "loop_block",
    "Block task + vòng lặp vì cần người quyết hoặc verify gate từ chối, kèm lý do và việc cần quyết. Đây là cách duy nhất block mà không cần đủ 3 lần fail; controller không bao giờ tự bỏ qua test fail.",
    {
      loopId: z.string(),
      planTaskId: z.string().optional(),
      reason: z.string(),
      decisionNeeded: z.string().optional(),
      testName: z.string().optional(),
      outputExcerpt: z.string().optional(),
      changedFiles: z.array(z.string()).optional(),
    },
    async ({ loopId, planTaskId, reason, decisionNeeded, testName, outputExcerpt, changedFiles }) => {
      const db = getDatabase();
      const result = blockLoop(db, loopId, { planTaskId, reason, decisionNeeded, evidence: { testName, outputExcerpt, changedFiles } });
      onActivity?.({ type: "loop_blocked", loopId, taskId: planTaskId, reason });
      return text(result);
    },
  );

  mcp.tool(
    "loop_run_suite",
    "Chạy một suite hồi quy đã đăng ký theo id (không nhận đường dẫn tùy ý). Kết quả được ghi vào loop_suite_runs khi có loopId.",
    {
      suiteId: z.string().describe(`Một trong: ${SUITE_REGISTRY.map((s) => s.id).join(", ")}`),
      loopId: z.string().optional(),
      timeoutSeconds: z.number().int().min(1).max(SUITE_TIMEOUT_MAX_SECONDS).optional().describe("Timeout mỗi suite, mặc định 60s, tối đa 120s"),
    },
    async ({ suiteId, loopId, timeoutSeconds }) => {
      const db = getDatabase();
      if (loopId) requireLoopRun(db, loopId);
      const result = runRegisteredSuite(suiteId, { timeoutSeconds });
      const recorded = loopId ? recordSuiteRun(db, loopId, suiteId, result) : null;
      return text({ result, recorded });
    },
  );

  mcp.tool(
    "loop_finish",
    "Cổng cuối (final gate) có cưỡng chế: CHỈ pass khi mọi task của plan đều done VÀ mọi suite hồi quy đã đăng ký đều pass. Còn task chưa xong thì trả về đúng danh sách task đó mà không chạy suite; suite nào fail thì trả về đúng suite đó. Sync lên nam KHÔNG thuộc cổng này — đó là bước thủ công sau khi finish pass.",
    {
      loopId: z.string(),
      timeoutSeconds: z.number().int().min(1).max(SUITE_TIMEOUT_MAX_SECONDS).optional().describe("Timeout mỗi suite, mặc định 60s, tối đa 120s"),
    },
    async ({ loopId, timeoutSeconds }) => {
      const db = getDatabase();
      const run = requireLoopRun(db, loopId);
      if (run.status !== "running" && run.status !== "paused") {
        return text({ passed: false, loopId, loopStatus: run.status, message: `Loop must be running or paused to finish (current: ${run.status}).` });
      }
      const preCheck = evaluateFinalGate(db, loopId, []);
      if (preCheck.openTasks.length > 0) {
        return text({
          passed: false,
          loopId,
          openTasks: preCheck.openTasks.map((t) => ({ id: t.id, goal: t.goal, status: t.status })),
          failingSuites: [],
          suitesRun: false,
          message: `${preCheck.openTasks.length} task(s) still open; suites were not run. Finish them first, then call loop_finish again.`,
        });
      }
      const results = SUITE_REGISTRY.map((entry) => {
        const r = runRegisteredSuite(entry.id, { timeoutSeconds });
        recordSuiteRun(db, loopId, entry.id, r);
        return { suiteId: entry.id, passed: r.passed, exitCode: r.exitCode, durationMs: r.durationMs };
      });
      const verdict = evaluateFinalGate(db, loopId, results);
      if (!verdict.passed) {
        return text({ passed: false, loopId, openTasks: [], failingSuites: verdict.failingSuites, suitesRun: true, results, message: `Final gate failed: suite(s) failing: ${verdict.failingSuites.join(", ")}. Fix and re-run loop_finish.` });
      }
      const loop = markLoopFinished(db, loopId);
      onActivity?.({ type: "loop_finished", loopId });
      return text({ passed: true, loopId, loop, suitesRun: true, results, message: "Final gate passed: all tasks done and all registered suites pass. Remaining manual step: sync to nam (sync_to_nam.sh + hash verify) before calling the whole run done." });
    },
  );
}
