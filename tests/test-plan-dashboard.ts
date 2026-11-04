#!/usr/bin/env bun
/**
 * Plan Dashboard test — calls the route handler directly, no HTTP server,
 * no node_modules needed (routes import only db/plan/continuous-loop).
 * Checks: list, detail, resume-prompt, pause/resume/cancel, outbox in
 * detail, 404 for unknown plan, and the HTML page contains the expected
 * markers and API paths.
 *
 * Run: bun scripts/test-plan-dashboard.ts
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
import { createPlan, resumePlan, setPlanTaskStatus } from "../src/daemon/plan";
import { enqueueInjection } from "../src/daemon/continuous-loop";
import { handlePlanDashboardRoutes } from "../src/daemon/routes/plan-dashboard-routes";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-dashboard-"));
const dbPath = path.join(tmpDir, "test.sqlite");
process.env.OTTER_DB_PATH = dbPath;
const db = initDatabase(dbPath);

const { plan, tasks } = createPlan(db, {
  goal: "Dashboard test plan",
  tasks: [{ goal: "Task A" }, { goal: "Task B" }, { goal: "Task C" }],
});
resumePlan(db, plan.id);
setPlanTaskStatus(db, tasks[0].id, "success");
enqueueInjection(db as any, { planId: plan.id, taskId: "task_x", text: "Next task prompt" });

async function call(method: string, pathname: string) {
  const res = await handlePlanDashboardRoutes(new Request(`http://127.0.0.1:1993${pathname}`, { method }), new URL(`http://127.0.0.1:1993${pathname}`), db as any);
  if (!res) return { status: 0, body: null, text: "" };
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body, text };
}

let r = await call("GET", "/api/plans");
check("GET /api/plans returns the plan with counts", r.status === 200 && r.body?.plans?.[0]?.id === plan.id && r.body?.plans?.[0]?.taskCounts?.success === 1);

r = await call("GET", `/api/plans/${plan.id}`);
check("GET /api/plans/:id returns tasks + current/next", r.status === 200 && r.body?.tasks?.length === 3 && r.body?.nextTask?.goal === "Task B");
check("detail includes pending outbox for the plan", r.body?.outbox?.length === 1 && r.body?.outbox?.[0]?.textPreview?.includes("Next task prompt"));
check("detail includes queue counts", r.body?.queue && typeof r.body.queue.queued === "number");

r = await call("GET", `/api/plans/${plan.id}/resume-prompt`);
check("resume-prompt contains next task", r.status === 200 && r.body?.prompt?.includes("Task B"));

r = await call("POST", `/api/plans/${plan.id}/pause`);
check("POST pause works", r.status === 200 && r.body?.plan?.status === "paused");
r = await call("POST", `/api/plans/${plan.id}/resume`);
check("POST resume works", r.status === 200 && r.body?.plan?.status === "running");
r = await call("POST", `/api/plans/${plan.id}/cancel`);
check("POST cancel works", r.status === 200 && r.body?.plan?.status === "cancelled");

r = await call("GET", "/api/plans/plan_does_not_exist");
check("unknown plan returns 404", r.status === 404);

r = await call("GET", "/plan-dashboard");
check("HTML page served with expected markers", r.status === 200 && r.text.includes("Plan Dashboard") && r.text.includes("/api/plans") && r.text.includes("btnResumePrompt"));

r = await call("GET", "/api/not-a-plan-route");
check("unrelated path returns null (no response)", r.status === 0);

db.close();
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {}

if (failures > 0) {
  console.log(`\nPlan dashboard test FAILED: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nPlan dashboard test PASSED: all checks passed.");
