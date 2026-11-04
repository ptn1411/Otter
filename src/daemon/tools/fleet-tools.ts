/**
 * Fleet MCP tools — hub side only in practice (a worker daemon also
 * exposes them, but fleet_dispatch on a worker would just dispatch
 * onward; the tools read the local DB, so they are safe anywhere).
 *
 * Tools (5): fleet_list, fleet_dispatch, fleet_status, fleet_cancel,
 * fleet_result.
 *
 * fleet_dispatch flow (B2):
 *  1. Look up the worker node in the local fleet_nodes table.
 *  2. Create a local hub dispatch record (status pending).
 *  3. POST the same dispatch_id + goal + tasks to the worker's
 *     /api/fleet/dispatch with the fleet token (OTTER_API_KEY by
 *     default, or the caller-supplied token, which is NEVER stored
 *     in the fleet DB and never logged).
 *  4. If the worker accepts, mark the hub record running with the
 *     worker plan id. If the worker refuses (auth, project allowlist,
 *     unreachable), mark the hub record failed with the reason in
 *     result_excerpt (excerpt only, no token).
 * Idempotency: redispatching the same dispatch_id to the worker
 * returns alreadyExisted=true and no second plan is created there.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import {
  getNodeIdentity, registerNode, listNodes, getNode, removeNode,
  createDispatch, getDispatch, listDispatches, updateDispatch, sweepTimedOutDispatches,
  listInbox, refreshInboxFromPlan, getInbox,
} from "../fleet";
import { getAuthToken } from "../security";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}
const taskInputSchema = {
  goal: z.string().describe("Mục tiêu của task"),
  details: z.string().optional(),
  filesHint: z.array(z.string()).optional(),
  verify: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  maxAttempts: z.number().int().min(1).optional(),
};
async function callWorker(nodeApiBase: string, pathSuffix: string, token: string | null, method = "GET", body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const url = nodeApiBase.replace(/\/+$/, "") + pathSuffix;
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch { data = { raw: await res.text().catch(() => "") }; }
    return { ok: res.ok, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
}

export function registerFleetTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "fleet_list",
    "Liệt kê các worker node đã đăng ký trên hub này, kèm trạng thái online/stale/offline (stale sau 90s không heartbeat).",
    {},
    async () => {
      const db = getDatabase();
      return text({ hub: getNodeIdentity(), nodes: listNodes(db as any) });
    },
  );

  mcp.tool(
    "fleet_register",
    "Đăng ký (hoặc cập nhật) một worker node trên hub. Worker phải reachable từ hub qua apiBase, và phải dùng OTTER_API_KEY khớp khi hub gọi tới.",
    {
      nodeId: z.string().describe("ID ổn định của worker, ví dụ 'nam'"),
      name: z.string().optional(),
      apiBase: z.string().describe("URL daemon của worker, ví dụ 'http://100.111.68.103:1993' (mạng riêng, không dùng URL công khai)"),
      projects: z.array(z.string()).optional().describe("Các project root worker được phép chạm vào"),
      capabilities: z.array(z.string()).optional(),
    },
    async ({ nodeId, name, apiBase, projects, capabilities }) => {
      const db = getDatabase();
      try {
        const node = registerNode(db as any, { nodeId, name, apiBase, projects, capabilities });
        onActivity?.({ type: "fleet_node_registered", nodeId: node.nodeId });
        return text({ node });
      } catch (e: any) { return err(e.message); }
    },
  );

  mcp.tool(
    "fleet_dispatch",
    "Giao một task/plan con cho một worker node (B2): worker tạo plan local, đưa prompt vào outbox cho ChatGPT của worker, chạy loop local, hub poll kết quả. Gửi lại cùng dispatch sẽ không chạy trùng (worker trả alreadyExisted).",
    {
      nodeId: z.string().describe("ID worker đã đăng ký (xem fleet_list)"),
      goal: z.string().describe("Mục tiêu tổng thể giao cho worker"),
      tasks: z.array(z.object(taskInputSchema)).min(1),
      projectRoot: z.string().optional().describe("Project root trên worker; phải nằm trong allowlist của worker, nếu không worker từ chối"),
      parentPlanId: z.string().optional().describe("Plan của hub mà dispatch này thuộc về (nếu có)"),
      deadlineMinutes: z.number().int().min(1).max(1440).optional().describe("Deadline, mặc định 60 phút"),
      token: z.string().optional().describe("Token của worker (mặc định dùng OTTER_API_KEY của hub). KHÔNG được lưu vào DB, chỉ dùng cho lần gọi này."),
    },
    async ({ nodeId, goal, tasks, projectRoot, parentPlanId, deadlineMinutes, token }) => {
      const db = getDatabase();
      const node = getNode(db as any, nodeId);
      if (!node) return err(`Worker chưa đăng ký: ${nodeId}. Gọi fleet_register trước, hoặc fleet_list để xem các node.`);
      const fleetToken = token || getAuthToken();
      let dispatch: any;
      try {
        dispatch = createDispatch(db as any, {
          nodeId, goal, tasks: tasks as any, projectRoot: projectRoot || null,
          parentPlanId: parentPlanId || null,
          deadlineMs: (deadlineMinutes || 60) * 60 * 1000,
        });
      } catch (e: any) { return err(e.message); }
      const workerRes = await callWorker(node.apiBase, "/api/fleet/dispatch", fleetToken, "POST", {
        dispatchId: dispatch.dispatchId, goal, tasks, projectRoot: projectRoot || null,
        verify: tasks.flatMap((t: any) => t.verify || []),
        deadlineMs: dispatch.deadlineMs,
      });
      if (!workerRes.ok) {
        const reason = workerRes.data?.error || `worker HTTP ${workerRes.status}`;
        const failed = updateDispatch(db as any, dispatch.dispatchId, { status: "failed", resultExcerpt: `Worker refused/unreachable: ${reason}` });
        onActivity?.({ type: "fleet_dispatch_failed", dispatchId: dispatch.dispatchId, nodeId, reason });
        return err(`Worker từ chối / không tới được (${reason}). Hub dispatch đã ghi failed: ${dispatch.dispatchId}`);
      }
      const running = updateDispatch(db as any, dispatch.dispatchId, {
        status: "running",
        workerPlanId: workerRes.data?.planId || null,
        resultExcerpt: workerRes.data?.alreadyExisted ? "Worker báo đã nhận dispatch này trước đó (idempotent, không tạo plan mới)." : null,
      });
      onActivity?.({ type: "fleet_dispatch_sent", dispatchId: dispatch.dispatchId, nodeId, workerPlanId: running.workerPlanId });
      return text({ dispatch: running, worker: { planId: workerRes.data?.planId, outboxId: workerRes.data?.outboxId, alreadyExisted: workerRes.data?.alreadyExisted } });
    },
  );

  mcp.tool(
    "fleet_status",
    "Xem trạng thái một dispatch trên hub, đồng thời poll worker để cập nhật trạng thái thật (done/blocked/timeout) về hub.",
    { dispatchId: z.string() },
    async ({ dispatchId }) => {
      const db = getDatabase();
      sweepTimedOutDispatches(db as any);
      let dispatch = getDispatch(db as any, dispatchId);
      if (!dispatch) return err(`Unknown dispatch: ${dispatchId}`);
      const node = getNode(db as any, dispatch.nodeId);
      if (node && dispatch.status !== "done" && dispatch.status !== "cancelled" && dispatch.status !== "timed_out") {
        const fleetToken = getAuthToken();
        const workerRes = await callWorker(node.apiBase, `/api/fleet/inbox/${encodeURIComponent(dispatchId)}`, fleetToken, "GET");
        if (workerRes.ok && workerRes.data?.inbox) {
          const ws = workerRes.data.inbox.status as any;
          if (["done", "blocked", "cancelled", "timed_out", "failed", "running"].includes(ws)) {
            dispatch = updateDispatch(db as any, dispatchId, {
              status: ws, resultExcerpt: workerRes.data.inbox.resultExcerpt || dispatch.resultExcerpt,
            });
          }
        }
      }
      return text({ dispatch });
    },
  );

  mcp.tool(
    "fleet_result",
    "Lấy kết quả cuối của một dispatch: trạng thái hub + trạng thái worker + plan của worker (nếu có).",
    { dispatchId: z.string() },
    async ({ dispatchId }) => {
      const db = getDatabase();
      const dispatch = getDispatch(db as any, dispatchId);
      if (!dispatch) return err(`Unknown dispatch: ${dispatchId}`);
      const node = getNode(db as any, dispatch.nodeId);
      let worker: any = null;
      if (node) {
        const r = await callWorker(node.apiBase, `/api/fleet/inbox/${encodeURIComponent(dispatchId)}`, getAuthToken(), "GET");
        worker = r.ok ? r.data?.inbox : { error: r.data?.error || `HTTP ${r.status}` };
      }
      return text({ dispatch, worker });
    },
  );

  mcp.tool(
    "fleet_cancel",
    "Hủy một dispatch: đánh dấu hub cancelled và gửi cancel sang worker (worker hủy plan local của nó).",
    { dispatchId: z.string() },
    async ({ dispatchId }) => {
      const db = getDatabase();
      const dispatch = getDispatch(db as any, dispatchId);
      if (!dispatch) return err(`Unknown dispatch: ${dispatchId}`);
      const node = getNode(db as any, dispatch.nodeId);
      let workerCancelled = false;
      if (node) {
        const r = await callWorker(node.apiBase, `/api/fleet/inbox/${encodeURIComponent(dispatchId)}/cancel`, getAuthToken(), "POST", {});
        workerCancelled = r.ok;
      }
      const updated = updateDispatch(db as any, dispatchId, { status: "cancelled" });
      return text({ dispatch: updated, workerCancelled });
    },
  );

  mcp.tool(
    "fleet_remove_node",
    "Gỡ một worker node khỏi hub (không xóa dispatch cũ).",
    { nodeId: z.string() },
    async ({ nodeId }) => {
      const db = getDatabase();
      return text({ removed: removeNode(db as any, nodeId), nodeId });
    },
  );

  mcp.tool(
    "fleet_inbox",
    "Xem inbox dispatch mà daemon này đã nhận với vai trò worker (trạng thái được làm mới từ plan local).",
    {},
    async () => {
      const db = getDatabase();
      const rows = listInbox(db as any).map((e) => refreshInboxFromPlan(db as any, e.dispatchId) || e);
      return text({ node: getNodeIdentity(), inbox: rows });
    },
  );
}
