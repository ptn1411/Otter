#!/usr/bin/env bun
/**
 * Phase 1 test — Plan & Run model, no MCP server, no node_modules needed.
 * Uses a temp SQLite file via OTTER_DB_PATH, then:
 *  1. creates a 3-task plan (task 2 depends on task 1 by goal name),
 *  2. checks order + dependency resolution + plan_status,
 *  3. pause/resume transitions + invalid transitions,
 *  4. add_task appends at the end,
 *  5. persistence: reopen the DB (new initDatabase call on the same file)
 *     and verify the plan is still there with the same tasks.
 *
 * Run: bun scripts/test-plan-phase1.ts
 * Exit 0 = all checks pass, exit 1 = any check fails.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
import {
  addPlanTask,
  createPlan,
  getNextEligibleTask,
  getPlanStatus,
  listPlans,
  pausePlan,
  refreshPlanStatus,
  resumePlan,
  setPlanTaskStatus,
} from "../src/daemon/plan";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-plan-phase1-"));
const dbPath = path.join(tmpDir, "test.sqlite");
process.env.OTTER_DB_PATH = dbPath;

console.log("Phase 1 test — DB:", dbPath);
const db = initDatabase(dbPath);

// 1. Create a 3-task plan.
const { plan, tasks } = createPlan(db, {
  goal: "Test plan: 3 tasks",
  tasks: [
    { goal: "Task A: scaffold", details: "Create files" },
    { goal: "Task B: implement", details: "Implement feature", dependsOn: ["Task A: scaffold"] },
    { goal: "Task C: verify", verify: ["bun --version"] },
  ],
});
check("plan starts in draft", plan.status === "draft");
check("3 tasks created in order", tasks.map((t) => t.orderIndex).join(",") === "0,1,2");
check("task B dependsOn resolved to task A id", tasks[1].dependsOn.length === 1 && tasks[1].dependsOn[0] === tasks[0].id);
check("task C has verify", tasks[2].verify?.join(",") === "bun --version");

// 2. Status: no running task. The status view still shows the first eligible
// pending task (A) for display, but getNextEligibleTask() returns null until
// the plan is running — that is the gate Phase 4 will use to pull work.
let status = getPlanStatus(db, plan.id);
check("status view next task is A (B blocked by dependency)", status.nextTask?.id === tasks[0].id);
check("getNextEligibleTask is null while plan is draft", getNextEligibleTask(db, plan.id) === null);
check("status counts: 3 pending", status.counts.pending === 3);
check("current task is null", status.currentTask === null);

// 3. Resume -> running, pause -> paused, invalid transitions throw.
const running = resumePlan(db, plan.id);
check("resume draft -> running", running.status === "running");
const paused = pausePlan(db, plan.id);
check("pause running -> paused", paused.status === "paused");
let threw = false;
try {
  pausePlan(db, plan.id);
} catch {
  threw = true;
}
check("pause a paused plan throws", threw);
const resumed = resumePlan(db, plan.id);
check("resume paused -> running", resumed.status === "running");

// 4. Mark task A success, then next eligible should be B (dependency satisfied).
setPlanTaskStatus(db, tasks[0].id, "success");
status = getPlanStatus(db, plan.id);
check("after A success, counts success=1 pending=2", status.counts.success === 1 && status.counts.pending === 2);
check("next eligible after A is B", status.nextTask?.id === tasks[1].id);

// 5. Add a task: appended at order 3, plan still running.
const added = addPlanTask(db, plan.id, { goal: "Task D: docs" });
check("added task order is 3", added.orderIndex === 3);
check("plan now has 4 tasks", getPlanStatus(db, plan.id).tasks.length === 4);

// 6. Persistence: reopen the same DB file and verify everything is still there.
const db2 = initDatabase(dbPath);
const reopened = getPlanStatus(db2, plan.id);
check("plan survives DB reopen with same status", reopened.plan.status === "running");
check("tasks survive DB reopen (4, in order)", reopened.tasks.map((t) => t.goal).join("|") === "Task A: scaffold|Task B: implement|Task C: verify|Task D: docs");
check("task A still success after reopen", reopened.tasks[0].status === "success");
check("listPlans finds the plan", listPlans(db2).some((p) => p.id === plan.id && p.taskTotal === 4));

// 7. Done only when every task is success/skipped.
setPlanTaskStatus(db2, tasks[1].id, "success");
setPlanTaskStatus(db2, tasks[2].id, "success");
setPlanTaskStatus(db2, added.id, "skipped");
const refreshed = refreshPlanStatus(db2, plan.id);
check("plan becomes done when all tasks success/skipped", refreshed.status === "done");

// 8. Unknown plan / empty goal errors.
threw = false;
try {
  getPlanStatus(db2, "plan_does_not_exist");
} catch {
  threw = true;
}
check("unknown planId throws", threw);
threw = false;
try {
  createPlan(db2, { goal: "  ", tasks: [{ goal: "x" }] });
} catch {
  threw = true;
}
check("empty plan goal throws", threw);

db.close();
try {
  db2.close();
} catch {}
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}

if (failures > 0) {
  console.log(`\nPhase 1 test FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nPhase 1 test PASSED: all checks passed.");
