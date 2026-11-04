/**
 * Page-loop HTTP routes — dùng chung hàm với MCP tools, không viết
 * logic hai lần. Wired vào index.ts SAU global auth, không public path.
 */
import { jsonResponse, errorResponse } from "./common";
import { getDatabase } from "../db";
import {
  confirmSent, createPageLoop, getPageLoopStatusView, listPageLoops, prepareNextPrompt,
  resumePageLoop, stopPageLoop,
} from "../page-loop";
import { listLeases, markStaleLeases } from "../page-loop-lease";
import { canDrain, runDoctor } from "../page-loop-doctor";
import { enqueueInjection, flushInjectionOutbox, listPendingInjections } from "../continuous-loop";
import { activeSockets, browserBridge } from "../browser-bridge";

type DbLike = ReturnType<typeof getDatabase>;

async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

function broadcastPageLoop(type: string, payload: any): void {
  for (const ws of activeSockets) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch {}
  }
}

export async function handlePageLoopRoutes(req: Request, url: URL, db?: DbLike): Promise<Response | null> {
  const database = db || getDatabase();
  const p = url.pathname;

  if (p === "/api/page-loops" && req.method === "GET") {
    markStaleLeases(database as any);
    return jsonResponse({ loops: listPageLoops(database as any), leases: listLeases(database as any) }, 200, {}, req);
  }

  if (p === "/api/page-loops" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const { loop, lease, firstPrompt, preparedPrompt } = createPageLoop(database as any, body);
      if (loop.mode === "auto") {
        const entry = enqueueInjection(database as any, { planId: loop.planId, loopId: loop.id, text: firstPrompt });
        broadcastPageLoop("page_loop_start", { loopId: loop.id, planId: loop.planId, goal: loop.goal, mode: loop.mode });
        void flushInjectionOutbox(database as any, (text, id) => browserBridge.injectPrompt(text, true, id));
        return jsonResponse({ loop, lease, outboxEntryId: entry.id }, 200, {}, req);
      }
      return jsonResponse({ loop, lease, preparedPrompt }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }

  const loopMatch = p.match(/^\/api\/page-loops\/([^/]+)$/);
  if (loopMatch && req.method === "GET") {
    try { return jsonResponse(getPageLoopStatusView(database as any, decodeURIComponent(loopMatch[1])), 200, {}, req); }
    catch (e: any) { return errorResponse(e.message, 404, req); }
  }

  const stopMatch = p.match(/^\/api\/page-loops\/([^/]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    try {
      const body = await readJson(req);
      const loop = stopPageLoop(database as any, decodeURIComponent(stopMatch[1]), body.reason);
      broadcastPageLoop("page_loop_stop", { loopId: loop.id, reason: body.reason || "Người dùng dừng." });
      return jsonResponse({ loop }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }

  const resumeMatch = p.match(/^\/api\/page-loops\/([^/]+)\/resume$/);
  if (resumeMatch && req.method === "POST") {
    try {
      const { loop, prompt } = resumePageLoop(database as any, decodeURIComponent(resumeMatch[1]));
      broadcastPageLoop("page_loop_start", { loopId: loop.id, goal: loop.goal, mode: loop.mode });
      void flushInjectionOutbox(database as any, (text, id) => browserBridge.injectPrompt(text, true, id));
      return jsonResponse({ loop, prompt }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }

  const confirmMatch = p.match(/^\/api\/page-loops\/([^/]+)\/confirm-sent$/);
  if (confirmMatch && req.method === "POST") {
    try { return jsonResponse({ loop: confirmSent(database as any, decodeURIComponent(confirmMatch[1])) }, 200, {}, req); }
    catch (e: any) { return errorResponse(e.message, 400, req); }
  }

  const prepareMatch = p.match(/^\/api\/page-loops\/([^/]+)\/prepare-next$/);
  if (prepareMatch && req.method === "POST") {
    try { return jsonResponse(prepareNextPrompt(database as any, decodeURIComponent(prepareMatch[1])), 200, {}, req); }
    catch (e: any) { return errorResponse(e.message, 400, req); }
  }

  if (p === "/api/page-loops/leases" && req.method === "GET") {
    markStaleLeases(database as any);
    return jsonResponse({ leases: listLeases(database as any) }, 200, {}, req);
  }

  if (p === "/api/doctor" && req.method === "GET") {
    let dbOk = true;
    try { (database as any).query("SELECT 1").get(); } catch { dbOk = false; }
    const activeLoops = listPageLoops(database as any).filter((l: any) => ["armed", "waiting_generation", "settling", "deciding", "injecting"].includes(l.status)).length;
    const leases = listLeases(database as any);
    const connectedTabs = [...activeSockets].filter((ws: any) => ws.data?.conversationId && ws.data.conversationId !== "global-background-worker").length;
    let fleetNodesOnline: number | null = null;
    try {
      const nodes = (database as any).query("SELECT last_heartbeat FROM fleet_nodes").all() as { last_heartbeat: number | null }[];
      fleetNodesOnline = nodes.filter((n) => n.last_heartbeat && Date.now() - n.last_heartbeat < 120_000).length;
    } catch {}
    return jsonResponse(runDoctor({
      dbOk,
      activeLoops,
      pendingOutbox: listPendingInjections(database as any).length,
      activeLeases: leases.filter((l: any) => l.status === "active").length,
      staleLeases: leases.filter((l: any) => l.status === "stale").length,
      connectedTabs,
      chromePath: process.env.OTTER_CHROME_PATH || null,
      browserPath: process.env.OTTER_BROWSER_PATH || null,
      fleetNodesOnline,
    }), 200, {}, req);
  }

  if (p === "/api/drain" && req.method === "POST") {
    const activeLoops = listPageLoops(database as any).filter((l: any) => ["armed", "waiting_generation", "settling", "deciding", "injecting"].includes(l.status));
    let pendingForActive = 0;
    try {
      const rows = (database as any).query("SELECT COUNT(*) AS n FROM injection_outbox WHERE status = 'pending' AND loop_id IN (SELECT id FROM page_loops WHERE status IN ('armed','waiting_generation','settling','deciding','injecting'))").get() as { n: number };
      pendingForActive = Number(rows.n);
    } catch { pendingForActive = 0; }
    const result = canDrain({ activeLoops: activeLoops.length, pendingOutboxForActiveLoops: pendingForActive });
    return jsonResponse({ ...result, activeLoops: activeLoops.map((l: any) => l.id), pendingOutboxForActiveLoops: pendingForActive }, result.can ? 200 : 409, {}, req);
  }

  return null;
}
