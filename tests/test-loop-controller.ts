#!/usr/bin/env bun
/**
 * Loop controller test — the standard coding loop as a state machine.
 * Temp SQLite file + temp dirs only, never the real repo DB, no network,
 * no real accounts. The full loop_finish test runs the 8 registered
 * regression suites (each itself temp-DB/fixture-only); a tiny fake suite
 * in a temp dir proves the suite runner's pass/fail verdicts separately.
 *
 * Run: bun scripts/test-loop-controller.ts
 * Exit 0 = all checks pass, exit 1 = any check fails.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
import { createPlan, getPlanTask, resumePlan, updatePlanTask } from "../src/daemon/plan";
import {
  blockLoop,
  evaluateFinalGate,
  getLoopAttempts,
  getLoopStatus,
  nextLoopTask,
  pauseLoop,
  reportLoopAttempt,
  resumeLoop,
  startLoop,
} from "../src/daemon/loop-controller";
import { registerLoopTools, runRegisteredSuite, runSuiteScript, SUITE_REGISTRY } from "../src/daemon/tools/loop-tools";
import { registerAllowedWorkspace } from "../src/daemon/security";

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
function throws(name: string, fn: () => unknown, needle?: string): void {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    check(name, needle === undefined || msg.includes(needle), msg);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-loopctl-"));
const dbPath = path.join(tmpDir, "loop.sqlite");
process.env.OTTER_DB_PATH = dbPath;
const db: any = initDatabase(dbPath);

const task = (goal: string, extra?: Record<string, unknown>) => ({
  goal,
  details: `Acceptance: ${goal} works and its test passes.`,
  verify: [`bun scripts/test-loop-controller.ts#${goal}`],
  ...extra,
});

function makeRunningPlan(goal: string, tasks: any[]): { planId: string; taskIds: string[] } {
  const { plan, tasks: created } = createPlan(db, { goal, tasks });
  resumePlan(db, plan.id);
  return { planId: plan.id, taskIds: created.map((t) => t.id) };
}

// --- G0 readiness refusal ---
{
  const { planId } = makeRunningPlan("G0 plan", [task("Has everything"), { goal: "Missing details + verify" }]);
  throws("G0: start refuses a task missing details/verify", () => startLoop(db, planId), "G0");
}
{
  const { plan } = createPlan(db, { goal: "Bad dep plan", tasks: [task("Lonely", { dependsOn: ["no-such-task"] })] });
  resumePlan(db, plan.id);
  throws("G0: start refuses unknown dependsOn", () => startLoop(db, plan.id), "dependsOn");
}
{
  const { plan } = createPlan(db, { goal: "Draft plan", tasks: [task("Draft task")] });
  throws("start refuses a non-running plan", () => startLoop(db, plan.id), "running");
}

// --- Order, deps, dispatch, passed -> done -> next ---
{
  const { planId, taskIds } = makeRunningPlan("Order plan", [
    task("First"),
    task("Second depends on First", { dependsOn: ["First"] }),
    task("Third"),
  ]);
  const loop = startLoop(db, planId);
  const n1 = nextLoopTask(db, loop.id);
  check("next returns the first ready task (First)", n1.task?.id === taskIds[0], n1);
  const n1b = nextLoopTask(db, loop.id);
  check("next refuses while a task is in progress", n1.task !== null && n1b.task === null && n1b.reason === "task_in_progress", n1b);
  const r1 = reportLoopAttempt(db, loop.id, taskIds[0], "passed", { testName: "first-test" });
  check("passed attempt marks task success", r1.task.status === "success", r1.task);
  const n2 = nextLoopTask(db, loop.id);
  check("next after First done returns Second (dep satisfied, order before Third)", n2.task?.id === taskIds[1], n2);
  reportLoopAttempt(db, loop.id, taskIds[1], "passed", { testName: "second-test" });
  const n3 = nextLoopTask(db, loop.id);
  check("next after Second done returns Third", n3.task?.id === taskIds[2], n3);
  reportLoopAttempt(db, loop.id, taskIds[2], "passed", { testName: "third-test" });
  const n4 = nextLoopTask(db, loop.id);
  check("next after all done reports all_tasks_done", n4.task === null && n4.reason === "all_tasks_done", n4);
}

// --- next skips a task whose dependency is not yet done ---
{
  // The dep points forward (Early depends on Late), so it is set after
  // creation via updatePlanTask — creation-time goal resolution only sees
  // earlier tasks.
  const { planId, taskIds } = makeRunningPlan("Skip plan", [
    task("Early but blocked by dep"),
    task("Late dep"),
    task("Independent"),
  ]);
  updatePlanTask(db, taskIds[0], { dependsOn: [taskIds[1]] });
  const loop = startLoop(db, planId);
  const n1 = nextLoopTask(db, loop.id);
  check("next skips dep-unsatisfied task and returns the dep itself", n1.task?.id === taskIds[1], n1);
  reportLoopAttempt(db, loop.id, taskIds[1], "passed", { testName: "dep-test" });
  const n2 = nextLoopTask(db, loop.id);
  check("next then returns the previously skipped task", n2.task?.id === taskIds[0], n2);
}

// --- 3 strikes -> task blocked + loop blocked, evidence recorded ---
{
  const { planId, taskIds } = makeRunningPlan("Strike plan", [task("Flaky task")]);
  const loop = startLoop(db, planId);
  nextLoopTask(db, loop.id);
  const f1 = reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "flaky-test", outputExcerpt: "Error A", changedFiles: ["a.ts"] });
  check("failed attempt 1 keeps task failed and loop running", f1.task.status === "failed" && f1.loop.status === "running" && !f1.blocked, f1);
  check("failed attempt increments plan attempt_count", getPlanTask(db, taskIds[0])?.attemptCount === 1);
  nextLoopTask(db, loop.id);
  const f2 = reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "flaky-test", outputExcerpt: "Error B", changedFiles: ["b.ts"] });
  check("failed attempt 2 still retryable", f2.task.status === "failed" && f2.loop.status === "running" && !f2.blocked, f2);
  nextLoopTask(db, loop.id);
  const f3 = reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "flaky-test", outputExcerpt: "Error C", changedFiles: ["c.ts"] });
  check("failed attempt 3 blocks task + loop", f3.task.status === "blocked" && f3.loop.status === "blocked" && f3.blocked, f3);
  check("blocked reason names the 3-strike rule", (f3.blockedReason ?? "").includes("3 failed attempts"), f3.blockedReason);
  const attempts = getLoopAttempts(db, loop.id, taskIds[0]);
  check("all 3 attempts recorded with evidence", attempts.length === 3 && attempts[2].outputExcerpt === "Error C" && attempts[0].changedFiles.includes("a.ts"), attempts);
  const nBlocked = nextLoopTask(db, loop.id);
  check("next refuses while loop is blocked", nBlocked.task === null && nBlocked.reason === "loop_not_running", nBlocked);
  const status = getLoopStatus(db, loop.id);
  check("loop_status shows the blocked task + decision needed", status.blockedTasks.length === 1 && (status.loop.decisionNeeded ?? "").length > 0, status.loop);
}

// --- no-progress counter: identical evidence increments, different resets ---
{
  const { planId, taskIds } = makeRunningPlan("No-progress A", [task("Same error task")]);
  const loop = startLoop(db, planId);
  nextLoopTask(db, loop.id);
  reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "t", outputExcerpt: "same error" });
  nextLoopTask(db, loop.id);
  reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "t", outputExcerpt: "same error" });
  check("identical failing evidence increments no_progress_turns", getLoopStatus(db, loop.id).loop.noProgressTurns === 1);
}
{
  const { planId, taskIds } = makeRunningPlan("No-progress B", [task("Changing error task")]);
  const loop = startLoop(db, planId);
  nextLoopTask(db, loop.id);
  reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "t", outputExcerpt: "error one" });
  nextLoopTask(db, loop.id);
  reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "t", outputExcerpt: "error two" });
  check("different failing evidence resets no_progress_turns", getLoopStatus(db, loop.id).loop.noProgressTurns === 0);
}

// --- report guards: only the dispatched running task can report ---
{
  const { planId, taskIds } = makeRunningPlan("Guard plan", [task("Guarded task"), task("Other task")]);
  const loop = startLoop(db, planId);
  throws("report on a non-dispatched (pending) task is refused", () => reportLoopAttempt(db, loop.id, taskIds[1], "passed"), "running");
  throws("report for a task from another plan is refused", () => reportLoopAttempt(db, loop.id, "ptask_does_not_exist", "passed"), "Unknown");
  nextLoopTask(db, loop.id);
  reportLoopAttempt(db, loop.id, taskIds[0], "failed", { testName: "t", outputExcerpt: "e" });
  check("failed task stays open in loop_status", getLoopStatus(db, loop.id).openTasks.some((t) => t.id === taskIds[0]));
}

// --- budget exhaustion pauses resumably ---
{
  const { planId, taskIds } = makeRunningPlan("Budget plan", [task("Budget one"), task("Budget two")]);
  const loop = startLoop(db, planId, { maxTurns: 1 });
  nextLoopTask(db, loop.id);
  reportLoopAttempt(db, loop.id, taskIds[0], "passed", { testName: "b1" });
  const spent = nextLoopTask(db, loop.id);
  check("budget spent pauses the loop as a checkpoint", spent.task === null && spent.reason === "budget_exhausted" && getLoopStatus(db, loop.id).loop.status === "paused", spent);
  const resumed = resumeLoop(db, loop.id, { maxTurns: 5 });
  check("resume with a larger budget re-runs the loop", resumed.status === "running" && resumed.maxTurns === 5, resumed);
  const n = nextLoopTask(db, loop.id);
  check("next after budget resume returns the following task", n.task?.id === taskIds[1], n);
}

// --- pause / resume round-trip ---
{
  const { planId, taskIds } = makeRunningPlan("Pause plan", [task("Pausable task")]);
  const loop = startLoop(db, planId);
  pauseLoop(db, loop.id);
  const nPaused = nextLoopTask(db, loop.id);
  check("next refuses while paused", nPaused.task === null && nPaused.reason === "loop_not_running", nPaused);
  resumeLoop(db, loop.id);
  const n = nextLoopTask(db, loop.id);
  check("next works again after resume", n.task?.id === taskIds[0], n);
}

// --- loop_block: human decision / verify-gate refusal with evidence ---
{
  const { planId, taskIds } = makeRunningPlan("Block plan", [task("Needs human task")]);
  const loop = startLoop(db, planId);
  nextLoopTask(db, loop.id);
  const blocked = blockLoop(db, loop.id, { planTaskId: taskIds[0], reason: "Verify gate refused: task deletes a file outside the workspace", decisionNeeded: "Approve or reject the deletion" });
  check("loop_block blocks task + loop with decision needed", blocked.task?.status === "blocked" && blocked.loop.status === "blocked" && blocked.loop.decisionNeeded === "Approve or reject the deletion", blocked);
}

// --- final gate verdict (pure): refused while tasks pending ---
{
  const { planId } = makeRunningPlan("Gate plan", [task("Open task")]);
  const loop = startLoop(db, planId);
  const verdict = evaluateFinalGate(db, loop.id, []);
  check("final gate fails while tasks are open", !verdict.passed && verdict.openTasks.length === 1, verdict);
}

// --- suite runner: fake suites in a temp dir ---
{
  const fakeDir = path.join(tmpDir, "fakesuites");
  fs.mkdirSync(fakeDir, { recursive: true });
  registerAllowedWorkspace(fakeDir);
  const passScript = path.join(fakeDir, "fake-pass.ts");
  const failScript = path.join(fakeDir, "fake-fail.ts");
  fs.writeFileSync(passScript, `console.log("FAKE PASS");\n`);
  fs.writeFileSync(failScript, `console.log("FAKE FAIL");\nprocess.exit(1);\n`);
  const passRes = runSuiteScript(passScript);
  check("suite runner passes a passing fake suite", passRes.passed && passRes.exitCode === 0, passRes);
  const failRes = runSuiteScript(failScript);
  check("suite runner fails a failing fake suite", !failRes.passed && failRes.exitCode === 1, failRes);
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-loopctl-outside-"));
  const outsideScript = path.join(outsideDir, "evil.ts");
  fs.writeFileSync(outsideScript, `console.log("evil");\n`);
  throws("suite runner refuses a script outside allowed workspaces", () => runSuiteScript(outsideScript), "nằm ngoài");
}

// --- registered suite run: one real suite proves the runner end to end ---
{
  const real = runRegisteredSuite("test-fb-comment-parser");
  check("registered suite run works (real parser suite passes)", real.passed && real.suiteId === "test-fb-comment-parser", real);
  throws("unknown suite id is refused with the registry list", () => runRegisteredSuite("test-nope"), "test-fb-comment-parser");
}

// --- mock MCP registration + loop_finish end to end ---
const tools: Record<string, (args: any) => Promise<any>> = {};
const mockMcp: any = {
  tool(name: string, _desc: string, _shape: unknown, fn: (args: any) => Promise<any>) {
    tools[name] = fn;
  },
};
registerLoopTools(mockMcp);
async function callTool(name: string, args: any): Promise<{ ok: boolean; data: any }> {
  const res = await tools[name](args);
  const textOut = res?.content?.[0]?.text ?? "";
  try {
    return { ok: true, data: JSON.parse(textOut) };
  } catch {
    return { ok: false, data: textOut };
  }
}
{
  const expected = ["loop_start", "loop_next", "loop_report_attempt", "loop_status", "loop_pause", "loop_resume", "loop_stop", "loop_finish", "loop_run_suite", "loop_block"];
  check("all 10 loop tools register on mock MCP server", expected.every((t) => typeof tools[t] === "function"), Object.keys(tools).sort());
  check("suite registry lists exactly the 8 verified suites", SUITE_REGISTRY.length === 8 && SUITE_REGISTRY.every((s) => s.script.startsWith("scripts/test-")), SUITE_REGISTRY.map((s) => s.id));
}
{
  // loop_finish refused while tasks are open (no suites run).
  const { planId } = makeRunningPlan("Finish-open plan", [task("Still open")]);
  const started = await callTool("loop_start", { planId });
  const finishOpen = await callTool("loop_finish", { loopId: started.data.loop.id });
  check("loop_finish refuses while tasks are open, without running suites", finishOpen.data.passed === false && finishOpen.data.suitesRun === false && finishOpen.data.openTasks.length === 1, finishOpen.data);
}
{
  // loop_finish passes when all tasks are done AND all suites pass.
  const { planId, taskIds } = makeRunningPlan("Finish plan", [task("Finishable task")]);
  const started = await callTool("loop_start", { planId });
  const loopId = started.data.loop.id;
  await callTool("loop_next", { loopId });
  await callTool("loop_report_attempt", { loopId, planTaskId: taskIds[0], outcome: "passed", testName: "finish-test" });
  const finished = await callTool("loop_finish", { loopId, timeoutSeconds: 120 });
  check("loop_finish passes when all tasks done + all suites pass", finished.data.passed === true && finished.data.loop.status === "finished" && finished.data.results.length === 8, finished.data);
  check("loop_finish results show all 8 suites passing", finished.data.results.every((r: any) => r.passed), finished.data.results);
  const suiteRows = db.query("SELECT * FROM loop_suite_runs WHERE loop_id = ?").all(loopId) as any[];
  check("loop_finish recorded all 8 suite runs in the DB", suiteRows.length === 8 && suiteRows.every((r) => r.passed === 1), suiteRows.map((r) => ({ suite: r.suite_id, passed: r.passed })));
}

console.log(`\n${passed} passed, ${failures} failed.`);
if (failures > 0) {
  console.log("Some loop-controller checks FAILED.");
  process.exit(1);
} else {
  console.log("All loop-controller checks passed.");
}
