/**
 * Page-loop MCP tools — thin wrappers, logic lives in ../page-loop.ts.
 * Token thật KHÔNG bao giờ trả ra ngoài: status chỉ báo active/none/expired.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import {
  confirmSent, createPageLoop, getPageLoopStatusView, listPageLoops, prepareNextPrompt,
  resumePageLoop, stopPageLoop,
} from "../page-loop";
import { listLeases, touchLease } from "../page-loop-lease";
import { runDoctor } from "../page-loop-doctor";
import { enqueueInjection, flushInjectionOutbox, listPendingInjections } from "../continuous-loop";
import { activeSockets, browserBridge } from "../browser-bridge";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errText(e: any): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: e?.message || String(e) }], isError: true } as any;
}

function broadcastPageLoop(type: string, payload: any): void {
  for (const ws of activeSockets) {
    try { ws.send(JSON.stringify({ type, ...payload })); } catch {}
  }
}

export function registerPageLoopTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "page_loop_start",
    "Bắt đầu một phiên vòng lặp trên trang ChatGPT Web (explicit opt-in từng phiên, mặc định tắt). Auto mode: gửi prompt đầu qua outbox + báo tab bắt đầu watcher. Zero-risk mode: KHÔNG inject, KHÔNG đọc DOM — chỉ trả prompt đã chuẩn bị để user copy/paste/gửi tay rồi gọi page_loop_confirm_sent. Giới hạn mặc định lần chạy đầu: 10 lượt / 30 phút.",
    {
      goal: z.string().describe("Mục tiêu của phiên"),
      planId: z.string().optional().describe("Plan đã tạo bằng plan_create (tùy chọn; không có thì là chế độ mục tiêu tự do)"),
      conversationId: z.string().optional().describe("ID cuộc hội thoại, mặc định chatgpt-web"),
      tabId: z.string().optional().describe("TabId của tab ChatGPT (nếu biết; một tab chỉ một lease đang chạy)"),
      mode: z.enum(["auto", "zero_risk"]).optional().describe("auto = daemon inject + watcher đọc lượt; zero_risk = user gửi tay, daemon không đọc/sửa DOM"),
      chatMode: z.enum(["retained", "fresh_per_turn"]).optional().describe("retained = giữ chat đang mở, nudge tăng dần; fresh_per_turn = mỗi lượt một chat mới"),
      maxTurns: z.number().int().min(1).optional().describe("Số lượt tối đa, mặc định 10"),
      maxRunMinutes: z.number().int().min(1).optional().describe("Số phút tối đa, mặc định 30"),
    },
    async ({ goal, planId, conversationId, tabId, mode, chatMode, maxTurns, maxRunMinutes }) => {
      try {
        const db = getDatabase();
        const { loop, lease, firstPrompt, preparedPrompt } = createPageLoop(db as any, { goal, planId: planId || null, conversationId, tabId, mode: mode || "auto", chatMode: chatMode || "retained", maxTurns, maxRunMinutes });
        if (loop.mode === "auto") {
          const entry = enqueueInjection(db as any, { planId: loop.planId, loopId: loop.id, text: firstPrompt });
          broadcastPageLoop("page_loop_start", { loopId: loop.id, planId: loop.planId, goal: loop.goal, mode: loop.mode });
          void flushInjectionOutbox(db as any, (text, id) => browserBridge.injectPrompt(text, true, id));
          onActivity?.({ type: "page_loop_started", loopId: loop.id, goal });
          return text({ loop, lease, outboxEntryId: entry.id, note: "Đã enqueue prompt đầu + báo tab bắt đầu watcher. Tab phải nối WS thì watcher mới chạy." });
        }
        onActivity?.({ type: "page_loop_started_zero_risk", loopId: loop.id, goal });
        return text({ loop, lease, preparedPrompt, note: "ZERO-RISK: copy preparedPrompt, paste vào ChatGPT, tự bấm Send, rồi gọi page_loop_confirm_sent. Daemon không inject, không đọc DOM trong chế độ này." });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_stop",
    "Dừng một phiên page-loop ngay: revoke token, trả lease, outbox pending của phiên đó không gửi nữa.",
    { loopId: z.string(), reason: z.string().optional() },
    async ({ loopId, reason }) => {
      try {
        const db = getDatabase();
        const loop = stopPageLoop(db as any, loopId, reason);
        broadcastPageLoop("page_loop_stop", { loopId, reason: reason || "Người dùng dừng." });
        return text({ loop });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_status",
    "Trạng thái phiên page-loop: session + lease + 10 lượt gần nhất + checkpoint + receipt + budget còn lại. Không trả token thật, chỉ báo tokenStatus.",
    { loopId: z.string() },
    async ({ loopId }) => {
      try {
        const db = getDatabase();
        return text(getPageLoopStatusView(db as any, loopId));
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_list",
    "Danh sách phiên page-loop gần nhất (tối đa 50), kèm lease đang chạy.",
    {},
    async () => {
      try {
        const db = getDatabase();
        return text({ loops: listPageLoops(db as any), leases: listLeases(db as any) });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_resume",
    "Tiếp tục phiên paused/armed bằng resume prompt (auto: qua outbox; zero-risk: chỉ trả prompt, user gửi tay).",
    { loopId: z.string() },
    async ({ loopId }) => {
      try {
        const db = getDatabase();
        const { loop, prompt } = resumePageLoop(db as any, loopId);
        broadcastPageLoop("page_loop_start", { loopId, goal: loop.goal, mode: loop.mode });
        if (loop.mode === "auto") void flushInjectionOutbox(db as any, (text, id) => browserBridge.injectPrompt(text, true, id));
        return text({ loop, prompt, note: loop.mode === "zero_risk" ? "Zero-risk: copy prompt này gửi tay, rồi gọi page_loop_confirm_sent." : "Đã enqueue resume prompt qua outbox." });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_confirm_sent",
    "Zero-risk only: xác nhận user đã tự paste + Send prompt trong ChatGPT. Hết 60s (lượt thường) / 120s (compaction) không xác nhận thì phiên ở paused, prompt vẫn còn để copy lại.",
    { loopId: z.string() },
    async ({ loopId }) => {
      try {
        const db = getDatabase();
        const loop = confirmSent(db as any, loopId);
        return text({ loop, note: "Đã xác nhận gửi tay. Daemon chờ worker báo xong qua plan/loop tools rồi mới chuẩn bị prompt tiếp theo bằng page_loop_prepare_next." });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_prepare_next",
    "Zero-risk only: chuẩn bị prompt tiếp theo (không enqueue, không inject) từ plan/task tiếp theo hoặc nudge tự do.",
    { loopId: z.string() },
    async ({ loopId }) => {
      try {
        const db = getDatabase();
        return text(prepareNextPrompt(db as any, loopId));
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_lease_list",
    "Lease page-loop đang chạy / stale (tối đa 5 lease/daemon).",
    {},
    async () => {
      try {
        const db = getDatabase();
        return text({ leases: listLeases(db as any) });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "page_loop_lease_heartbeat",
    "Cập nhật heartbeat cho lease (tab báo còn sống). Lease quá 120s không heartbeat thì thành stale.",
    { loopId: z.string(), tabId: z.string().optional() },
    async ({ loopId, tabId }) => {
      try {
        const db = getDatabase();
        const lease = touchLease(db as any, { loopId, tabId });
        if (!lease) throw new Error(`Không tìm thấy lease cho loop ${loopId}`);
        return text({ lease });
      } catch (e: any) { return errText(e); }
    },
  );

  mcp.tool(
    "doctor_run",
    "Chạy doctor end-to-end: DB, phiên đang chạy, outbox, lease, tab extension, Chrome/GPM path. Không trả secret/token/nội dung hội thoại.",
    {},
    async () => {
      try {
        const db = getDatabase();
        let dbOk = true;
        try { (db as any).query("SELECT 1").get(); } catch { dbOk = false; }
        const activeLoops = listPageLoops(db as any).filter((l: any) => ["armed", "waiting_generation", "settling", "deciding", "injecting"].includes(l.status)).length;
        const pendingOutbox = listPendingInjections(db as any).length;
        const leases = listLeases(db as any);
        const connectedTabs = [...activeSockets].filter((ws: any) => ws.data?.conversationId && ws.data.conversationId !== "global-background-worker").length;
        const result = runDoctor({
          dbOk,
          activeLoops,
          pendingOutbox,
          activeLeases: leases.filter((l: any) => l.status === "active").length,
          staleLeases: leases.filter((l: any) => l.status === "stale").length,
          connectedTabs,
          chromePath: process.env.OTTER_CHROME_PATH || null,
          browserPath: process.env.OTTER_BROWSER_PATH || null,
          fleetNodesOnline: null,
        });
        return text(result);
      } catch (e: any) { return errText(e); }
    },
  );
}
