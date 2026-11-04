#!/usr/bin/env bun
/**
 * Phase 7 test — continuous-coding loop, end to end at the SQLite level.
 * No MCP server, no node_modules needed. Scenario:
 *  1. Create a 5-task plan, start it, verify plan_next returns task 1 only.
 *  2. Simulate a task completing (plan task -> success), verify the next
 *     task becomes eligible and the continuation prompt contains it.
 *  3. Simulate a daemon restart: write bridge task rows directly (one
 *     pending, one stale running, one recent running), recover them and
 *     verify pending/stale-running come back as queue items while the
 *     recent one stays running.
 *  4. Sweeper: a stale plan task with attempt < max goes back to pending;
 *     one at max becomes blocked and pauses its plan.
 *  5. Outbox: enqueue dedupes, flush with a failing sender keeps the entry,
 *     flush with a succeeding sender delivers it, and 5 failures -> failed.
 *  6. Verify gate: "true" passes, "false" fails.
 *  7. Safety: a task with "rm -rf /" is flagged risky; a normal task is not.
 *  8. Resume prompt: after 2 successes, it names the next task and does not
 *     ask to redo the completed ones.
 *
 * Run: bun scripts/test-continuous-loop.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
import {
  createPlan,
  getNextEligibleTask,
  getPlanStatus,
  resumePlan,
  setPlanTaskStatus,
} from "../src/daemon/plan";
import {
  buildContinuationPrompt,
  buildResumePrompt,
  enqueueInjection,
  flushInjectionOutbox,
  isRiskyTask,
  listPendingInjections,
  recoverBridgeTasks,
  runVerifyGate,
  sweepStaleTasks,
} from "../src/daemon/continuous-loop";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-loop-"));
const dbPath = path.join(tmpDir, "test.sqlite");
process.env.OTTER_DB_PATH = dbPath;
const db = initDatabase(dbPath);
const now = Date.now();

// 1-2. Plan + plan_next + continuation prompt.
const { plan, tasks } = createPlan(db, {
  goal: "E2E loop test plan",
  tasks: [
    { goal: "Task 1" },
    { goal: "Task 2" },
    { goal: "Task 3" },
    { goal: "Task 4" },
    { goal: "Task 5" },
  ],
});
resumePlan(db, plan.id);
check("plan_next returns task 1 when running", getNextEligibleTask(db, plan.id)?.id === tasks[0].id);
setPlanTaskStatus(db, tasks[0].id, "running");
check("plan_next is null while a task is running", getNextEligibleTask(db, plan.id) === null);
setPlanTaskStatus(db, tasks[0].id, "success");
const next = getNextEligibleTask(db, plan.id);
check("after task 1 success, plan_next is task 2", next?.id === tasks[1].id);
const view = getPlanStatus(db, plan.id);
const cont = buildContinuationPrompt({
  planGoal: plan.goal,
  planId: plan.id,
  completedTask: { goal: "Task 1", summary: "Done task 1" },
  nextTask: tasks[1],
  completedTasks: view.tasks.filter((t) => t.status === "success"),
  remainingCount: 4,
});
check("continuation prompt contains next task", cont.includes("Task 2") && cont.includes(plan.id));

// 3. Recovery from bridge task rows (simulated pre-restart state).
const insertTask = (id: string, status: string, createdAt: number, heartbeat: number | null) => {
  db.run("INSERT INTO tasks (id, conversation_id, title, status, created_at, attempt_count, last_heartbeat_at, details, files_hint_json, verify_json) VALUES (?, 'chatgpt-web', ?, ?, ?, 0, ?, 'details', '[]', '[]')", [id, `Goal ${id}`, status, createdAt, heartbeat]);
};
insertTask("task_pending", "pending", now - 1000, null);
insertTask("task_stale_running", "running", now - 10 * 60_000, now - 10 * 60_000);
insertTask("task_recent_running", "running", now - 1000, now - 1000);
const recovered = recoverBridgeTasks(db as any, now);
check("recovery returns pending + stale running as queue items", recovered.pending.map((t) => t.id).sort().join(",") === "task_pending,task_stale_running");
check("recovery keeps recent running as still running", recovered.stillRunning.map((t) => t.id).join(",") === "task_recent_running");
const staleRow = db.query("SELECT status FROM tasks WHERE id = 'task_stale_running'").get() as any;
check("stale running row is now pending in DB", staleRow.status === "pending");

// 4. Sweeper on plan tasks.
setPlanTaskStatus(db, tasks[1].id, "running");
// Backdate its heartbeat to stale.
db.run("UPDATE plan_tasks SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?", [now - 10 * 60_000, now - 10 * 60_000, tasks[1].id]);
const swept1 = sweepStaleTasks(db as any, now);
check("sweeper recovers stale plan task to pending", swept1.planRecovered.includes(tasks[1].id));
// At max attempts -> blocked + plan paused.
setPlanTaskStatus(db, tasks[2].id, "running", { incrementAttempt: true });
setPlanTaskStatus(db, tasks[2].id, "running", { incrementAttempt: true });
setPlanTaskStatus(db, tasks[2].id, "running", { incrementAttempt: true });
db.run("UPDATE plan_tasks SET last_heartbeat_at = ?, updated_at = ? WHERE id = ?", [now - 10 * 60_000, now - 10 * 60_000, tasks[2].id]);
const swept2 = sweepStaleTasks(db as any, now);
check("sweeper blocks plan task at max attempts", swept2.planBlocked.includes(tasks[2].id));
check("plan is paused when a task is blocked", (getPlanStatus(db, plan.id).plan.status as string) === "paused");

// 5. Outbox dedupe + flush.
const entry = enqueueInjection(db as any, { planId: plan.id, taskId: "task_x", text: "Hello loop" });
const entry2 = enqueueInjection(db as any, { planId: plan.id, taskId: "task_x", text: "Hello loop" });
check("outbox dedupes identical pending text", entry.id === entry2.id);
check("one pending outbox entry", listPendingInjections(db as any).length === 1);
const failFlush = await flushInjectionOutbox(db as any, () => false, 5);
check("failing flush keeps entry pending", failFlush.remaining === 1 && failFlush.delivered === 0);
const okFlush = await flushInjectionOutbox(db as any, () => true, 5);
check("succeeding flush delivers entry", okFlush.delivered === 1 && okFlush.remaining === 0);
// 5 failures -> failed.
enqueueInjection(db as any, { planId: plan.id, text: "Will fail" });
for (let i = 0; i < 5; i++) await flushInjectionOutbox(db as any, () => false, 5);
check("entry fails after max outbox attempts", listPendingInjections(db as any).length === 0);

// 6. Verify gate.
const passGate = await runVerifyGate(["true"]);
check("verify gate passes for 'true'", passGate.pass === true);
const failGate = await runVerifyGate(["false"]);
check("verify gate fails for 'false'", failGate.pass === false);

// 7. Safety.
check("risky task flagged", isRiskyTask({ goal: "Clean up", details: "rm -rf /tmp/x" }).risky === true);
check("normal task not flagged", isRiskyTask({ goal: "Add endpoint", details: "Add GET /users", filesHint: ["src/routes.ts"] }).risky === false);

// 8. Resume prompt.
setPlanTaskStatus(db, tasks[1].id, "success");
const resume = buildResumePrompt(getPlanStatus(db, plan.id));
check("resume prompt names next task (Task 4, since Task 3 is blocked)", resume.includes("Task 4"));
check("resume prompt says not to redo success tasks", resume.includes("không làm lại"));

db.close();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch { }

if (failures > 0) {
  console.log(`\nContinuous-loop test FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nContinuous-loop test PASSED: all checks passed.");
