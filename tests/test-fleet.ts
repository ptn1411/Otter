/**
 * Fleet tests — temp DB only, never the production daemon DB.
 * Run: bun scripts/test-fleet.ts   (from repo root)
 * Checks: node identity, register/list/heartbeat/stale, dispatch
 * create, worker receive idempotency, project allowlist refusal,
 * plan status -> inbox status propagation, cancel, timeout sweep.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
import {
  getNodeIdentity, registerNode, listNodes, heartbeatNode, removeNode,
  createDispatch, getDispatch, updateDispatch, sweepTimedOutDispatches,
  receiveDispatch, getInbox, refreshInboxFromPlan, cancelInbox,
} from "../src/daemon/fleet";
import { getPlanStatus, setPlanTaskStatus, refreshPlanStatus } from "../src/daemon/plan";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name} ${extra}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otter-fleet-test-"));
const dbPath = path.join(tmp, "fleet.sqlite");
const db: any = initDatabase(dbPath);
const repoRoot = process.cwd();

// 1. Identity
const id = getNodeIdentity();
check("node identity has nodeId + projects", Boolean(id.nodeId) && id.projects.length > 0);

// 2. Register / list / heartbeat / stale
const node = registerNode(db, { nodeId: "worker-test", name: "Worker Test", apiBase: "http://127.0.0.1:1994", projects: [repoRoot], capabilities: ["test"] });
check("register node online", node.status === "online" && node.apiBase === "http://127.0.0.1:1994");
check("list nodes = 1", listNodes(db).length === 1);
heartbeatNode(db, "worker-test");
check("heartbeat ok", heartbeatNode(db, "worker-test").status === "online");
db.run("UPDATE fleet_nodes SET last_heartbeat = ? WHERE node_id = ?", [Date.now() - 200_000, "worker-test"]);
check("stale after 90s", listNodes(db)[0].status === "stale");
db.run("UPDATE fleet_nodes SET last_heartbeat = ? WHERE node_id = ?", [Date.now(), "worker-test"]);

// 3. Hub dispatch create
const disp = createDispatch(db, { nodeId: "worker-test", goal: "Test fleet task", tasks: [{ goal: "Do thing" }], projectRoot: repoRoot });
check("dispatch created pending", disp.status === "pending" && disp.dispatchId.startsWith("disp_"));
check("get dispatch", getDispatch(db, disp.dispatchId)?.goal === "Test fleet task");

// 4. Worker receive (same DB simulates worker side for pure logic)
const recv1 = receiveDispatch(db, { dispatchId: disp.dispatchId, goal: "Test fleet task", tasks: [{ goal: "Do thing" }], projectRoot: repoRoot });
check("receive creates plan + outbox", Boolean(recv1.planId) && Boolean(recv1.outboxId) && !recv1.alreadyExisted);
const recv2 = receiveDispatch(db, { dispatchId: disp.dispatchId, goal: "Test fleet task", tasks: [{ goal: "Do thing" }], projectRoot: repoRoot });
check("receive idempotent (no second plan)", recv2.alreadyExisted && recv2.planId === recv1.planId);
check("inbox running", getInbox(db, disp.dispatchId)?.status === "running");

// 5. Project allowlist refusal
let refused = false;
try { receiveDispatch(db, { dispatchId: "disp_refuse", goal: "Bad", tasks: [{ goal: "x" }], projectRoot: "/etc" }); } catch { refused = true; }
check("project outside allowlist refused", refused && !getInbox(db, "disp_refuse"));

// 6. Plan done -> inbox done
const view = getPlanStatus(db, recv1.planId);
for (const t of view.tasks) setPlanTaskStatus(db, t.id, "success");
refreshPlanStatus(db, recv1.planId);
check("plan done", getPlanStatus(db, recv1.planId).plan.status === "done");
check("inbox refresh -> done", refreshInboxFromPlan(db, disp.dispatchId)?.status === "done");

// 7. Cancel + timeout sweep
const disp2 = createDispatch(db, { nodeId: "worker-test", goal: "To cancel", tasks: [{ goal: "y" }] });
receiveDispatch(db, { dispatchId: disp2.dispatchId, goal: "To cancel", tasks: [{ goal: "y" }] });
check("cancel inbox", cancelInbox(db, disp2.dispatchId).status === "cancelled");
const disp3 = createDispatch(db, { nodeId: "worker-test", goal: "Old", tasks: [{ goal: "z" }], deadlineMs: 1 });
await new Promise((r) => setTimeout(r, 5));
check("timeout sweep", sweepTimedOutDispatches(db).includes(disp3.dispatchId));

// 8. Remove node
check("remove node", removeNode(db, "worker-test") && listNodes(db).length === 0);

db.close?.();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nFleet tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
