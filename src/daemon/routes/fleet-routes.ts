/**
 * Fleet HTTP routes — wired into index.ts AFTER the global auth check,
 * so a configured OTTER_API_KEY protects every route here (same as the
 * plan dashboard routes). No fleet route is in the public-path list.
 *
 * Hub routes (this daemon acts as hub):
 * - GET  /api/fleet/node              this daemon's identity
 * - GET  /api/fleet/nodes             registered workers (+ stale calc)
 * - POST /api/fleet/nodes             register/update a worker (manual)
 * - POST /api/fleet/nodes/:id/heartbeat
 * - DELETE /api/fleet/nodes/:id
 * - GET  /api/fleet/dispatches        hub dispatch list (?nodeId=)
 * - GET  /api/fleet/dispatches/:id    hub dispatch detail (sweeps timeout)
 * Worker routes (this daemon acts as worker, same daemon can be both):
 * - POST /api/fleet/dispatch          receive a dispatch (idempotent)
 * - GET  /api/fleet/inbox             worker inbox list (status refreshed from plan)
 * - GET  /api/fleet/inbox/:id         worker inbox detail (refreshed)
 * - POST /api/fleet/inbox/:id/cancel  cancel worker plan + inbox row
 * - POST /api/fleet/heartbeat         worker self-report (body: {nodeId})
 *   (hub polling is the primary heartbeat path; this route exists for
 *   workers that can reach the hub but the hub cannot reach them.)
 */
import { jsonResponse, errorResponse } from "./common";
import { getDatabase } from "../db";
import {
  getNodeIdentity, registerNode, getNode, listNodes, heartbeatNode, removeNode,
  createDispatch, getDispatch, listDispatches, updateDispatch, sweepTimedOutDispatches,
  receiveDispatch, getInbox, listInbox, refreshInboxFromPlan, cancelInbox,
} from "../fleet";
import { getAllSkills } from "../skills-catalog";

type DbLike = ReturnType<typeof getDatabase>;

async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

export async function handleFleetRoutes(req: Request, url: URL, db?: DbLike): Promise<Response | null> {
  const database = db || getDatabase();
  const p = url.pathname;

  if (p === "/api/fleet/node" && req.method === "GET") {
    const identity = getNodeIdentity();
    let capabilities: string[] = [];
    try { capabilities = (await getAllSkills()).map((s) => s.name); } catch {}
    return jsonResponse({ ...identity, capabilities }, 200, {}, req);
  }

  if (p === "/api/fleet/nodes" && req.method === "GET") {
    return jsonResponse({ nodes: listNodes(database as any) }, 200, {}, req);
  }
  if (p === "/api/fleet/nodes" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const node = registerNode(database as any, body);
      return jsonResponse({ node }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }
  const hbMatch = p.match(/^\/api\/fleet\/nodes\/([^/]+)\/heartbeat$/);
  if (hbMatch && req.method === "POST") {
    try { return jsonResponse({ node: heartbeatNode(database as any, decodeURIComponent(hbMatch[1])) }, 200, {}, req); }
    catch (e: any) { return errorResponse(e.message, 404, req); }
  }
  const nodeMatch = p.match(/^\/api\/fleet\/nodes\/([^/]+)$/);
  if (nodeMatch && req.method === "DELETE") {
    const ok = removeNode(database as any, decodeURIComponent(nodeMatch[1]));
    return jsonResponse({ removed: ok }, 200, {}, req);
  }
  if (nodeMatch && req.method === "GET") {
    const node = getNode(database as any, decodeURIComponent(nodeMatch[1]));
    return node ? jsonResponse({ node }, 200, {}, req) : errorResponse("Node not found", 404, req);
  }

  if (p === "/api/fleet/dispatches" && req.method === "GET") {
    sweepTimedOutDispatches(database as any);
    return jsonResponse({ dispatches: listDispatches(database as any, url.searchParams.get("nodeId") || undefined) }, 200, {}, req);
  }
  if (p === "/api/fleet/dispatches" && req.method === "POST") {
    // Hub-side local record only (does NOT call the worker; the MCP
    // fleet_dispatch tool does the worker call, so a plain HTTP caller
    // cannot accidentally double-dispatch by POSTing here).
    try {
      const body = await readJson(req);
      const d = createDispatch(database as any, body);
      return jsonResponse({ dispatch: d }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }
  const dispMatch = p.match(/^\/api\/fleet\/dispatches\/([^/]+)$/);
  if (dispMatch && req.method === "GET") {
    sweepTimedOutDispatches(database as any);
    const d = getDispatch(database as any, decodeURIComponent(dispMatch[1]));
    return d ? jsonResponse({ dispatch: d }, 200, {}, req) : errorResponse("Dispatch not found", 404, req);
  }
  const dispCancelMatch = p.match(/^\/api\/fleet\/dispatches\/([^/]+)\/cancel$/);
  if (dispCancelMatch && req.method === "POST") {
    try { return jsonResponse({ dispatch: updateDispatch(database as any, decodeURIComponent(dispCancelMatch[1]), { status: "cancelled" }) }, 200, {}, req); }
    catch (e: any) { return errorResponse(e.message, 404, req); }
  }

  if (p === "/api/fleet/dispatch" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const result = receiveDispatch(database as any, body);
      return jsonResponse({ inbox: result.inbox, planId: result.planId, outboxId: result.outboxId, alreadyExisted: result.alreadyExisted }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }
  if (p === "/api/fleet/inbox" && req.method === "GET") {
    const rows = listInbox(database as any).map((e) => refreshInboxFromPlan(database as any, e.dispatchId) || e);
    return jsonResponse({ inbox: rows }, 200, {}, req);
  }
  const inboxMatch = p.match(/^\/api\/fleet\/inbox\/([^/]+)$/);
  if (inboxMatch && req.method === "GET") {
    const entry = refreshInboxFromPlan(database as any, decodeURIComponent(inboxMatch[1]));
    return entry ? jsonResponse({ inbox: entry }, 200, {}, req) : errorResponse("Dispatch not found", 404, req);
  }
  const cancelMatch = p.match(/^\/api\/fleet\/inbox\/([^/]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    try { return jsonResponse({ inbox: cancelInbox(database as any, decodeURIComponent(cancelMatch[1])) }, 200, {}, req); }
    catch (e: any) { return errorResponse(e.message, 404, req); }
  }
  if (p === "/api/fleet/heartbeat" && req.method === "POST") {
    try {
      const body = await readJson(req);
      // A worker reporting to a hub: the hub registers/refreshes it.
      // If the worker also sent apiBase/projects, store them; otherwise
      // keep the previously registered values (heartbeat-only update).
      const existing = body.nodeId ? getNode(database as any, body.nodeId) : null;
      const node = registerNode(database as any, {
        nodeId: body.nodeId, name: body.name || existing?.name,
        apiBase: body.apiBase || existing?.apiBase || "",
        projects: body.projects || existing?.projects || [],
        capabilities: body.capabilities || existing?.capabilities || [],
      });
      return jsonResponse({ node }, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }

  return null;
}
