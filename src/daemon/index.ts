import * as path from "node:path";
import { getTailscaleIp } from "./security";
import { initDatabase } from "./db";
import { createMcpServer } from "./mcp";
import { recoverTaskQueue, sweepStaleBridgeTasks } from "./tools/task-bridge";
import { enqueueInjection, flushInjectionOutbox, markInjectionDelivered, markInjectionFailed } from "./continuous-loop";
import { recordTurn, stopPageLoop } from "./page-loop";
import { touchLease } from "./page-loop-lease";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { activeSockets, browserBridge } from "./browser-bridge";
import { getSessionsForConversation, appendTerminalOutput } from "./terminal";
import {
  initMcpGateway,
  getExternalServersState,
  onExternalServersReloaded,
  registerExternalToolsToMcpServer
} from "./mcp-gateway";
import {
  corsHeaders,
  handleCorsPreflight,
  checkAuth,
  handleSystemRoutes,
  handleMcpRoutes,
  handleConversationRoutes,
  handleActivityRoutes,
  handleSkillsRoutes,
  handleBookmarksRoutes,
  handleOAuthRoutes,
  handleCustomCommandsRoutes,
  handleLicenseRoutes,
  handlePlanDashboardRoutes,
  handleFleetRoutes,
  handleChromeRoutes,
  handlePageLoopRoutes,
  handleScheduledTasksRoutes,
  matchDaemonRoute,
  matchDaemonRoutePrefix
} from "./routes";
import { startScheduledTaskRunner } from "./scheduled-tasks";
import {
  getLicenseStatus,
  printLicenseLockBanner,
  assertHostsIntegrity,
  loadLicense,
  sendHeartbeat,
  clearLicenseCache,
  parseLicensePayload,
  activateLicense
} from "./license";

const cliArg = process.argv[2];

if (cliArg === "version" || cliArg === "--version" || cliArg === "-v") {
  console.log("Otter Agent v2.0.0");
  process.exit(0);
}

if (cliArg === "help" || cliArg === "--help" || cliArg === "-h") {
  console.log(`
🦦 Otter Agent — Agentic AI Desktop & Browser Controller (v2.0.0)

Cách sử dụng:
  otter                         Khởi động Otter Daemon ngầm (tự động kết nối TryCloudflare)
  otter --no-tunnel             Khởi động Otter Daemon chỉ trên Localhost (không mở Tunnel)
  otter cua                     Bộ công cụ CLI điều khiển màn hình máy tính CUA (trycua/cua)
  otter cua serve               Khởi động CUA Daemon (lắng nghe named pipe \\\\.\\pipe\\cua-driver)
  otter cua call <tool> [args]  Gọi trực tiếp công cụ CUA (get_screen_size, click, type_text...)
  otter cua list [query]        Liệt kê 61 công cụ CUA khả dụng
  otter cua status              Xem trạng thái hoạt động của CUA Daemon
  otter license activate <KEY>  Kích hoạt bản quyền bằng License Key
  otter license status          Xem mã thiết bị và trạng thái bản quyền
  otter version                 Xem phiên bản hiện tại
`);
  process.exit(0);
}

if (cliArg === "license" || cliArg === "license:activate" || cliArg === "license:status" || cliArg === "activate") {
  const subArg = process.argv[3];
  if (cliArg === "license:activate" || cliArg === "activate" || (cliArg === "license" && subArg === "activate")) {
    const key = (cliArg === "license" && subArg === "activate") ? process.argv[4] : subArg;
    if (!key) {
      console.log("\x1b[31m[!] Vui lòng cung cấp License Key:\x1b[0m otter license activate <LICENSE_KEY>");
      process.exit(1);
    }
    console.log(`[*] Đang kích hoạt license key...`);
    const act = await activateLicense(key);
    if (act.success) {
      console.log("\x1b[32m[✓] KÍCH HOẠT BẢN QUYỀN THÀNH CÔNG!\x1b[0m");
      console.log(`- Khách hàng: ${act.payload?.customer || "N/A"}`);
      console.log(`- Loại bản quyền: ${act.payload?.license_type}`);
      console.log(`- Hạn sử dụng: ${act.payload?.expires_at || "Vĩnh viễn"}\n`);
      process.exit(0);
    } else {
      console.log(`\x1b[31m[!] Kích hoạt thất bại: ${act.error}\x1b[0m\n`);
      process.exit(1);
    }
  } else if (cliArg === "license:status" || (cliArg === "license" && (subArg === "status" || !subArg))) {
    const status = await getLicenseStatus();
    console.log(`\n🔑 OTTER AGENT — TRẠNG THÁI BẢN QUYỀN\n`);
    console.log(`- Mã thiết bị (Support Code): \x1b[33m${status.supportCode}\x1b[0m`);
    console.log(`- Trạng thái: ${status.licensed ? "\x1b[32mĐÃ KÍCH HOẠT\x1b[0m" : "\x1b[31mCHƯA KÍCH HOẠT\x1b[0m"}`);
    if (status.reason) console.log(`- Lý do: ${status.reason}`);
    if (status.payload) {
      console.log(`- Loại bản quyền: ${status.payload.license_type}`);
      console.log(`- Hạn dùng: ${status.payload.expires_at || "Vĩnh viễn"}`);
      if (status.payload.customer) console.log(`- Khách hàng: ${status.payload.customer}`);
    }
    console.log("");
    process.exit(0);
  }
}

if (cliArg === "cua" || cliArg === "cua-driver") {
  const sub = process.argv[3];
  const { findCuaDriverExe, executeCuaTool, getCuaToolList } = await import("./desktop");
  const { spawn } = await import("bun");

  try {
    const driverExe = await findCuaDriverExe();

    if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
      console.log(`
🖱️ Otter CUA CLI — Computer-Use Agent Controller (trycua/cua)

Cú pháp:
  otter cua serve [--no-overlay]            Khởi động CUA Daemon
  otter cua call <toolName> [json_args]     Gọi trực tiếp công cụ CUA bất kỳ
  otter cua status                          Kiểm tra trạng thái CUA Daemon & Named Pipe
  otter cua stop                            Dừng CUA Daemon đang chạy
  otter cua list [query]                    Liệt kê các công cụ CUA khả dụng
  otter cua autostart [enable|disable]      Cài đặt tự khởi động CUA cùng hệ thống
  otter cua doctor                          Kiểm tra chẩn đoán quyền & hệ thống CUA

Ví dụ lệnh thực tế:
  otter cua call get_screen_size
  otter cua call get_cursor_position
  otter cua call check_permissions
  otter cua call list_windows
  otter cua call click '{"x": 500, "y": 300}'
  otter cua call type_text '{"text": "Xin chao Otter"}'
  otter cua call hotkey '{"keys": ["ctrl", "c"]}'
`);
      process.exit(0);
    }

    if (sub === "serve") {
      const extraArgs = process.argv.slice(4);
      console.log(`[*] Đang khởi động CUA Daemon (${driverExe})...`);
      const proc = spawn({
        cmd: [driverExe, "serve", ...extraArgs],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit"
      });
      await proc.exited;
      process.exit(proc.exitCode || 0);
    }

    if (sub === "call") {
      const toolName = process.argv[4];
      if (!toolName) {
        console.error("\x1b[31m[!] Thiếu tên công cụ CUA:\x1b[0m otter cua call <toolName> [jsonArgs]");
        process.exit(1);
      }
      let argsObj: any = {};
      const rawArg = process.argv[5];
      if (rawArg) {
        try {
          argsObj = JSON.parse(rawArg);
        } catch (e: any) {
          console.error(`\x1b[31m[!] Tham số JSON không hợp lệ:\x1b[0m ${e.message}`);
          process.exit(1);
        }
      }
      const res = await executeCuaTool(toolName, argsObj);
      console.log(typeof res === "object" ? JSON.stringify(res, null, 2) : res);
      process.exit(0);
    }

    if (sub === "list" || sub === "inventory") {
      const q = process.argv[4] ? process.argv[4].toLowerCase() : "";
      const tools = await getCuaToolList();
      const filtered = q
        ? tools.filter((t: any) => (t.name && t.name.toLowerCase().includes(q)) || (t.description && t.description.toLowerCase().includes(q)))
        : tools;
      console.log(`\n📦 Tìm thấy ${filtered.length} công cụ CUA${q ? ` khớp với '${q}'` : ""}:\n`);
      for (const t of filtered) {
        console.log(`  • \x1b[36m${t.name || t.id}\x1b[0m`);
        const firstLine = (t.description || "").split("\n")[0];
        if (firstLine) console.log(`    ${firstLine.slice(0, 100)}...`);
      }
      console.log("");
      process.exit(0);
    }

    // Default: forward directly to cua-driver (status, stop, autostart, doctor, permissions, etc.)
    const restArgs = process.argv.slice(3);
    const proc = spawn({
      cmd: [driverExe, ...restArgs],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit"
    });
    await proc.exited;
    process.exit(proc.exitCode || 0);

  } catch (err: any) {
    console.error(`\x1b[31m[!] Lỗi CUA CLI:\x1b[0m ${err.message}`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 1993);
const db = initDatabase();

interface WsClientData {
  conversationUrl?: string;
  conversationId?: string;
  cursor?: number;
}

function broadcast(event: any) {
  const payload = JSON.stringify(event);
  for (const ws of activeSockets) {
    try {
      ws.send(payload);
    } catch {}
  }
}

let lastMcpActivityAt: number | null = null;

function handleMcpActivity(evt: any) {
  lastMcpActivityAt = Date.now();
  broadcast(evt);

  // Tự động đẩy báo cáo hoàn thành task từ IDE lên khung chat ChatGPT Web (qua Chrome Extension)
  if (evt.type === "ide_task_completed" && evt.autoNotifyWeb !== false) {
    try {
      // Phase 4/5: task thuộc plan thì inject continuation/final prompt qua
      // outbox (không mất khi extension chưa kết nối), thay vì report một lần.
      const loopPrompt: string | undefined = evt.continuationPrompt || evt.retryPrompt;
      if (evt.planId && loopPrompt) {
        const entry = enqueueInjection(db, { planId: evt.planId, taskId: evt.taskId, text: loopPrompt });
        void flushInjectionOutbox(db, (text, id) => browserBridge.injectPrompt(text, true, id)).then((result) => {
          if (result.remaining > 0) console.log(`[Loop] ${result.remaining} prompt(s) đang chờ trong outbox (extension chưa kết nối hoặc inject thất bại).`);
        });
        void entry;
      } else {
        const statusIcon = evt.status === "success" ? "✅" : evt.status === "blocked" ? "⚠️" : "❌";
        const statusText = evt.status === "success" ? "Thành công" : evt.status === "blocked" ? "Cần hỗ trợ" : "Thất bại";
        const report = [
          `🔔 [Báo cáo từ Antigravity IDE Worker]`,
          `- Task: ${evt.goal || evt.taskId}`,
          `- Trạng thái: ${statusIcon} ${statusText}`,
          `- Tóm tắt: ${evt.summary}`,
          evt.filesTouched?.length ? `- Files đã thay đổi: ${evt.filesTouched.join(", ")}` : "",
          evt.verify?.length ? `- Kiểm thử: ${evt.verify.join(", ")}` : "",
          `\nVui lòng tổng hợp kết quả này cho người dùng.`
        ].filter(Boolean).join("\n");

        browserBridge.injectPrompt(report, true);
      }
    } catch (err) {
      console.warn("[IDE Task Complete] Auto notify prompt injection failed:", err);
    }
  }

  // Phase 6: verify gate thất bại cũng đi qua outbox (retry prompt).
  if (evt.type === "ide_task_verify_failed" && evt.autoNotifyWeb !== false && evt.retryPrompt) {
    try {
      enqueueInjection(db, { planId: evt.planId, taskId: evt.taskId, text: evt.retryPrompt });
      void flushInjectionOutbox(db, (text, id) => browserBridge.injectPrompt(text, true, id));
    } catch (err) {
      console.warn("[Loop] Enqueue retry prompt failed:", err);
    }
  }

  for (const s of activeSockets) {
    const convId = s.data?.conversationId;
    if (convId) {
      try {
        const title = evt.type === "terminal_output" ? "Thực thi lệnh Terminal" :
                      evt.type === "file_action" ? `Thao tác tệp (${evt.action})` :
                      evt.type === "speech_action" ? "Tạo giọng đọc AI" :
                      evt.type === "audio_synthesis" ? `Tổng hợp âm thanh (${evt.style})` :
                      evt.type === "mcp_tool_call" ? `Gọi MCP ngoài [${evt.server}]: ${evt.tool}` :
                      evt.type === "render_action" ? "Render video Remotion" :
                      evt.type === "ide_task_dispatched" ? `Giao việc cho IDE: ${evt.goal}` :
                      evt.type === "ide_task_started" ? `IDE nhận việc: ${evt.goal}` :
                      evt.type === "ide_task_progress" ? `Tiến độ IDE (${evt.percent || 0}%): ${evt.message}` :
                      evt.type === "ide_task_completed" ? `IDE hoàn thành task: ${evt.summary}` :
                      evt.type === "ide_task_released" ? `Hủy task: ${evt.taskId}` : evt.type;

        const description = evt.output || evt.path || JSON.stringify(evt);

        db.query(
          "INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)"
        ).run(convId, evt.type, JSON.stringify({ title, description, ...evt }), Date.now());

        s.send(JSON.stringify({
          type: "activity.page",
          page: {
            conversationId: convId,
            items: [{ title, description, type: evt.type, timestamp: Date.now() }]
          }
        }));

        if (evt.type === "terminal_output" && evt.output) {
          const termSessions = getSessionsForConversation(convId);
          if (termSessions.length > 0) {
            appendTerminalOutput(termSessions[0].id, `\r\n${evt.output}\r\n`);
          }
        }
      } catch (err) {
        console.error("[MCP Activity] Error broadcasting:", err);
      }
    }
  }
}

interface SseSession {
  sessionId: string;
  controller: ReadableStreamDefaultController<string>;
  transport: any;
  mcp: any;
}
const sseSessions = new Map<string, SseSession>();

interface StreamableSession {
  transport: WebStandardStreamableHTTPServerTransport;
  mcp: any;
}
const streamableSessions = new Map<string, StreamableSession>();

async function handleStreamableRequest(req: Request) {
  const sessionId = req.headers.get("mcp-session-id");
  let session = sessionId ? streamableSessions.get(sessionId) : undefined;

  if (!session) {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const mcpInstance = createMcpServer(handleMcpActivity);
    await mcpInstance.connect(transport);
    const response = await transport.handleRequest(req);
    if (transport.sessionId) {
      streamableSessions.set(transport.sessionId, { transport, mcp: mcpInstance });
    }
    return response;
  }

  return await session.transport.handleRequest(req);
}

// Khởi tạo Gateway kết nối các MCP server bên ngoài từ mcp_config.json
await initMcpGateway();

// Phase 2/3 — khôi phục queue sau restart + sweeper heartbeat định kỳ.
try {
  const recovered = recoverTaskQueue(db);
  if (recovered.queued > 0 || recovered.inFlight > 0) {
    console.log(`[Loop] Recovered after restart: queued=${recovered.queued} inFlight=${recovered.inFlight}`);
  }
} catch (err: any) {
  console.warn("[Loop] Task queue recovery failed:", err?.message ?? err);
}

// Khởi động bộ lập lịch tác vụ ChatGPT Web tự động (quét mỗi 5s)
startScheduledTaskRunner(db);
setInterval(() => {
  try {
    const swept = sweepStaleBridgeTasks(db);
    if (swept.bridgeRecovered.length > 0 || swept.bridgeBlocked.length > 0 || swept.planRecovered.length > 0 || swept.planBlocked.length > 0) {
      console.log(`[Loop] Sweeper: bridge recovered=${swept.bridgeRecovered.length} blocked=${swept.bridgeBlocked.length}, plan recovered=${swept.planRecovered.length} blocked=${swept.planBlocked.length}`);
    }
  } catch (err: any) {
    console.warn("[Loop] Sweeper failed:", err?.message ?? err);
  }
}, 60_000);

// Tự động đồng bộ công cụ và phát thông báo tool list changed cho các phiên kết nối MCP và Extension
onExternalServersReloaded(() => {
  for (const [, s] of sseSessions) {
    try {
      registerExternalToolsToMcpServer(s.mcp, handleMcpActivity);
      s.mcp.server.sendToolListChanged().catch(() => {});
    } catch {}
  }
  for (const [, s] of streamableSessions) {
    try {
      registerExternalToolsToMcpServer(s.mcp, handleMcpActivity);
      s.mcp.server.sendToolListChanged().catch(() => {});
    } catch {}
  }
  broadcast({
    type: "mcp_servers_updated",
    servers: getExternalServersState()
  });
});

const server = Bun.serve<WsClientData>({
  port: PORT,
  idleTimeout: 255, // Cho phép tác vụ AI chạy ngầm (Muse video/code) lên tới hơn 4 phút không bị timeout
  async fetch(req, server) {
    const url = new URL(req.url);
    console.log(`[HTTP] ${req.method} ${url.pathname}${url.search}`);

    // 1. CORS Preflight
    const preflight = handleCorsPreflight(req);
    if (preflight) return preflight;

    // 2. Kiểm tra xác thực (nếu cấu hình OTTER_API_KEY)
    const isPublicPath = url.pathname === "/" ||
      url.pathname === "/activity" ||
      url.pathname === "/dashboard" ||
      url.pathname.startsWith("/api/tasks") ||
      url.pathname.startsWith("/storage/tasks/") ||
      url.pathname === "/api/media/file" ||
      url.pathname.startsWith("/storage/media/") ||
      url.pathname.startsWith("/api/activity/v1/fb/") ||
      url.pathname.startsWith("/api/activity/v1/gpm/") ||
      url.pathname === "/openapi.json" ||
      url.pathname.startsWith("/api/system/security/full-access") ||
      matchDaemonRoute(url.pathname, "MCP_SERVERS") ||
      matchDaemonRoute(url.pathname, "SYS_LICENSE") ||
      matchDaemonRoute(url.pathname, "SYS_LICENSE_ACTIVATE") ||
      matchDaemonRoutePrefix(url.pathname, "SYS_TUNNEL") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname === "/.well-known/ai-plugin.json" ||
      url.pathname === "/.well-known/oauth-protected-resource" ||
      url.pathname === "/.well-known/oauth-authorization-server" ||
      url.pathname === "/.well-known/openid-configuration" ||
      url.pathname === "/oauth/authorize" ||
      url.pathname === "/oauth/token" ||
      url.pathname === "/oauth/register";

    if (!isPublicPath) {
      const clientIp = server.requestIP(req)?.address;
      const authErr = checkAuth(req, url, clientIp);
      if (authErr) return authErr;
    }

    // 3. MCP SSE Connection (/sse hoặc / với Accept text/event-stream)
    const isSseRequest = req.method === "GET" && (
      url.pathname === "/sse" ||
      (url.pathname === "/" && req.headers.get("accept")?.includes("text/event-stream"))
    );

    if (isSseRequest) {
      const sessionId = crypto.randomUUID();
      let sessionController!: ReadableStreamDefaultController<string>;

      const stream = new ReadableStream<string>({
        start(controller) {
          sessionController = controller;
          controller.enqueue(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
        },
        cancel() {
          sseSessions.delete(sessionId);
          console.log(`[MCP SSE] Session ${sessionId} cancelled`);
        }
      });

      const transport = {
        async start() {},
        async close() {
          try { sessionController.close(); } catch {}
          sseSessions.delete(sessionId);
        },
        async send(message: any) {
          try {
            sessionController.enqueue(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
          } catch (err) {
            console.error("[MCP SSE] Error sending message:", err);
          }
        },
        onmessage: undefined as any,
        onclose: undefined as any,
        onerror: undefined as any,
      };

      const mcpSession = createMcpServer(handleMcpActivity);
      await mcpSession.connect(transport);

      sseSessions.set(sessionId, {
        sessionId,
        controller: sessionController,
        transport,
        mcp: mcpSession
      });

      console.log(`[MCP SSE] Connected session: ${sessionId}`);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          ...corsHeaders
        }
      });
    }

    // 4. MCP Messages nhận từ SSE client (/messages)
    if (url.pathname === "/messages" && req.method === "POST") {
      const sessionId = url.searchParams.get("sessionId");
      const session = sessionId ? sseSessions.get(sessionId) : undefined;
      if (!session) {
        console.warn(`[MCP SSE] POST /messages: Session not found ${sessionId}`);
        return new Response("Session not found", { status: 404, headers: corsHeaders });
      }
      try {
        const body = await req.json();
        session.transport.onmessage?.(body);
        return new Response("Accepted", { status: 202, headers: corsHeaders });
      } catch (err: any) {
        return new Response(`Bad Request: ${err.message}`, { status: 400, headers: corsHeaders });
      }
    }

    // 5. MCP Web Standard Streamable HTTP (/mcp)
    if (url.pathname === "/mcp") {
      try {
        const response = await handleStreamableRequest(req);
        for (const [key, val] of Object.entries(corsHeaders)) {
          response.headers.set(key, val);
        }
        return response;
      } catch (err: any) {
        console.error("[MCP Streamable HTTP] Error:", err);
        return new Response(err.message, { status: 500, headers: corsHeaders });
      }
    }

    // 6. WebSocket Stream Upgrade
    if (matchDaemonRoute(url.pathname, "ACT_STREAM")) {
      const upgraded = server.upgrade(req, { data: {} });
      if (upgraded) return undefined;
      return new Response("WebSocket Upgrade Failed", { status: 400 });
    }

    // 7. Domain Route Handlers
    const oauthRes = await handleOAuthRoutes(req, url);
    if (oauthRes) return oauthRes;

    const systemRes = await handleSystemRoutes(req, url, PORT);
    if (systemRes) return systemRes;

    const mcpRes = await handleMcpRoutes(req, url, handleMcpActivity);
    if (mcpRes) return mcpRes;

    const convRes = await handleConversationRoutes(req, url, db, broadcast);
    if (convRes) return convRes;

    const actRes = await handleActivityRoutes(req, url, handleMcpActivity);
    if (actRes) return actRes;

    const skillRes = await handleSkillsRoutes(req, url);
    if (skillRes) return skillRes;

    const bookmarkRes = await handleBookmarksRoutes(req, url, db);
    if (bookmarkRes) return bookmarkRes;

    const cmdRes = await handleCustomCommandsRoutes(req, url, db);
    if (cmdRes) return cmdRes;

    const licenseRes = await handleLicenseRoutes(req, url);
    if (licenseRes) return licenseRes;

    const planRes = await handlePlanDashboardRoutes(req, url, db);
    if (planRes) return planRes;

    const fleetRes = await handleFleetRoutes(req, url, db);
    if (fleetRes) return fleetRes;

    const chromeRes = await handleChromeRoutes(req, url);
    if (chromeRes) return chromeRes;

    const pageLoopRes = await handlePageLoopRoutes(req, url, db);
    if (pageLoopRes) return pageLoopRes;

    const taskRes = await handleScheduledTasksRoutes(req, url, db);
    if (taskRes) return taskRes;

    // 8. Serve local media files (images, videos)
    if (url.pathname === "/api/media/file" && req.method === "GET") {
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return new Response(JSON.stringify({ error: "Thiếu tham số 'path'" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      try {
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
          return new Response(JSON.stringify({ error: "Không tìm thấy tệp tin trên ổ đĩa" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const ext = path.extname(filePath).toLowerCase();
        let mime = "application/octet-stream";
        if (ext === ".mp4") mime = "video/mp4";
        else if (ext === ".webm") mime = "video/webm";
        else if (ext === ".mov") mime = "video/quicktime";
        else if (ext === ".mkv") mime = "video/x-matroska";
        else if (ext === ".png") mime = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
        else if (ext === ".webp") mime = "image/webp";

        return new Response(file, {
          headers: {
            "Content-Type": mime,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
            ...corsHeaders
          }
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },

  websocket: {
    open(ws) {
      activeSockets.add(ws);
      console.log("[WS] Extension client connected");
    },
    message(ws, msg) {
      try {
        const data = JSON.parse(typeof msg === "string" ? msg : new TextDecoder().decode(msg));
        if (data.type === "browser_action_result") {
          browserBridge.handleResult(data);
          return;
        }
        if (data.type === "subscribe") {
          ws.data.conversationUrl = data.conversationUrl;
          let convId = "default";
          const match = data.conversationUrl?.match(/\/c\/([a-f0-9-]+)/i);
          if (match) {
            convId = match[1];
          } else if (data.conversationUrl) {
            convId = data.conversationUrl.split("/").pop() || "default";
          }
          ws.data.conversationId = convId;

          ws.send(JSON.stringify({
            type: "activity.ready",
            conversationId: convId
          }));

          ws.send(JSON.stringify({
            type: "activity.page",
            page: {
              conversationId: convId,
              nextCursor: 1,
              items: []
            }
          }));

          console.log(`[WS] Subscribed conversation: ${convId}`);
          // Phase 5: extension vừa kết nối lại -> gửi các prompt đang kẹt trong outbox.
          void flushInjectionOutbox(db, (text, id) => browserBridge.injectPrompt(text, true, id)).then((result) => {
            if (result.delivered > 0 || result.failed > 0) console.log(`[Loop] Outbox flush on subscribe: delivered=${result.delivered} failed=${result.failed} remaining=${result.remaining}`);
          });
        } else if (data.type === "inject_result") {
          // Phase 5 ack: extension báo kết quả inject cho một outbox entry.
          try {
            if (data.injectionId) {
              if (data.ok) markInjectionDelivered(db, data.injectionId);
              else markInjectionFailed(db, data.injectionId, data.error || "Extension reported inject failure");
            }
          } catch (err) {
            console.warn("[WS] inject_result handling failed:", err);
          }
        } else if (data.type === "chatgpt_turn") {
          // Page-loop: tab báo lượt settle. Daemon quyết định, không phải tab.
          try {
            if (!data.loopId || !data.turnHash) throw new Error("chatgpt_turn thiếu loopId/turnHash");
            // Marker phải do content script tính từ FULL TEXT của lượt (xem
            // content.ts: isDoneMarker(turn.text)). Excerpt chỉ là 500 ký tự
            // đầu nên không dùng để suy marker cho lượt dài.
            const isDoneMarker = data.isDoneMarker === true;
            const isCheckpointMarker = data.isCheckpointMarker === true;
            const result = recordTurn(db as any, {
              loopId: data.loopId,
              turnHash: data.turnHash,
              excerpt: data.excerpt || "",
              isDoneMarker,
              isCheckpointMarker,
              mcpActivityAt: lastMcpActivityAt,
            });
            // Auto mode: prompt tiếp theo đã enqueue trong recordTurn -> flush ngay.
            if (result.outboxEntry) {
              void flushInjectionOutbox(db, (text, id) => browserBridge.injectPrompt(text, true, id));
            }
            if (result.decision === "done" || result.decision === "blocked") {
              broadcast({ type: "page_loop_stop", loopId: data.loopId, reason: result.reason });
            }
            ws.send(JSON.stringify({ type: "page_loop_decision", loopId: data.loopId, decision: result.decision, reason: result.reason }));
          } catch (err: any) {
            console.warn("[WS] chatgpt_turn handling failed:", err.message);
            ws.send(JSON.stringify({ type: "page_loop_decision", loopId: data.loopId, decision: "blocked", reason: err.message }));
          }
        } else if (data.type === "page_loop_status") {
          try {
            if (data.status === "blocked" && data.loopId) {
              stopPageLoop(db as any, data.loopId, data.reason || "Trang báo lỗi lượt.");
              broadcast({ type: "page_loop_stop", loopId: data.loopId, reason: data.reason || "Trang báo lỗi lượt." });
            } else if (data.status === "paused_user_typing") {
              console.log(`[WS] Page-loop ${data.loopId}: user đang gõ, hoãn gửi.`);
            }
          } catch (err: any) {
            console.warn("[WS] page_loop_status handling failed:", err.message);
          }
        } else if (data.type === "lease_heartbeat") {
          try {
            if (data.loopId) touchLease(db as any, { loopId: data.loopId, tabId: data.tabId });
          } catch {}
        } else if (data.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (err) {
        console.error("[WS] Parse error:", err);
      }
    },
    close(ws) {
      activeSockets.delete(ws);
      console.log("[WS] Client disconnected");
    }
  }
});

// 1. Kiểm tra tính toàn vẹn tệp hosts (Chặn khởi động app nếu can thiệp DNS server về local trên Windows/macOS)
assertHostsIntegrity();

const license = await getLicenseStatus();
if (!license.licensed) {
  printLicenseLockBanner(license.supportCode);
} else {
  console.log(`[+] 🔒 License: ĐÃ KÍCH HOẠT (${license.payload?.license_type || "perpetual"})`);
  console.log(`[+] 👤 Khách hàng: ${license.payload?.customer || "Local Owner"}`);
  if (license.isGracePeriod) {
    console.log(`[!] License đang trong ân hạn offline — cần mạng để heartbeat gia hạn.`);
  }
}

// 1b. Heartbeat tự động cho leased token — trước đây sendHeartbeat không
// có chỗ nào gọi, nên token leased hết hạn là chết dù máy vẫn online.
// Chạy mỗi 6 giờ, và chạy ngay một lần nếu token sắp hết hạn trong 48 giờ.
// Lỗi heartbeat chỉ log, không crash daemon; lần sau sẽ thử lại.
try {
  const storedForHeartbeat = loadLicense();
  if (storedForHeartbeat?.leased_token) {
    const runHeartbeat = async () => {
      try {
        const res = await sendHeartbeat();
        if (res.success) {
          clearLicenseCache();
          console.log(`[+] License heartbeat: đã gia hạn tới ${res.leasedExpiresAt || "?"}`);
        } else {
          console.warn(`[!] License heartbeat thất bại: ${res.error}`);
        }
      } catch (err: any) {
        console.warn(`[!] License heartbeat lỗi: ${err?.message || err}`);
      }
    };
    const payloadForHeartbeat = parseLicensePayload(storedForHeartbeat.payload);
    const leasedExp = payloadForHeartbeat?.leased_expires_at
      ? new Date(payloadForHeartbeat.leased_expires_at).getTime()
      : NaN;
    if (!Number.isNaN(leasedExp) && leasedExp - Date.now() < 48 * 60 * 60 * 1000) {
      void runHeartbeat();
    }
    setInterval(runHeartbeat, 6 * 60 * 60 * 1000);
  }
} catch {}

console.log(`=======================================================`);
console.log(`[+] 🦦 Otter Daemon running at http://127.0.0.1:${PORT}`);
console.log(`[+] MCP SSE Endpoint: http://127.0.0.1:${PORT}/sse`);
console.log(`[+] MCP Streamable HTTP: http://127.0.0.1:${PORT}/mcp`);
console.log(`[+] Realtime Stream: ws://127.0.0.1:${PORT}/api/activity/v1/stream`);
console.log(`[+] Folder Picker: http://127.0.0.1:${PORT}/api/local/system/folder-picker`);
console.log(`[+] OpenAPI Schema: http://127.0.0.1:${PORT}/openapi.json`);
const tailscaleIp = getTailscaleIp();
if (tailscaleIp) {
  console.log(`[+] 🔒 Tailscale IP: http://${tailscaleIp}:${PORT}`);
  console.log(`[+] 🔗 Tailscale MCP: http://${tailscaleIp}:${PORT}/mcp`);
  console.log(`[+] 🔗 Tailscale SSE: http://${tailscaleIp}:${PORT}/sse`);
}
console.log(`=======================================================`);

import { startMessengerListener } from "./fb-sales";
import { startGroupPostSchedulerLoop } from "./fb-group-post";
import { startMediaPostSchedulerLoop } from "./fb-media-post";

// Tự động khởi động tiến trình lắng nghe Messenger nền theo kịch bản bán hàng
try {
  startMessengerListener(db, handleMcpActivity, 5000);
  console.log(`[+] 💬 Messenger Auto-Listener: ĐÃ KÍCH HOẠT (tự động trả lời tin nhắn 24/7)`);
} catch (err: any) {
  console.warn(`[!] Không thể tự khởi động Messenger Listener: ${err.message}`);
}

// Tự động khởi động tiến trình kiểm tra hẹn giờ đăng bài nhóm Facebook (giãn cách 3 phút/nhóm)
try {
  startGroupPostSchedulerLoop(() => db, handleMcpActivity, 15000);
  console.log(`[+] 📢 FB Group Post Scheduler: ĐÃ KÍCH HOẠT (tự động quét và đăng bài nhóm mỗi 15s)`);
} catch (err: any) {
  console.warn(`[!] Không thể tự khởi động FB Group Post Scheduler: ${err.message}`);
}

// Tự động khởi động tiến trình kiểm tra hẹn giờ đăng bài Media Facebook (Video, Ảnh, Thư mục, Muse AI)
try {
  startMediaPostSchedulerLoop(db, handleMcpActivity, 10000);
  console.log(`[+] 🎬 FB Media Post Scheduler: ĐÃ KÍCH HOẠT (tự động quét và đăng media mỗi 10s)`);
} catch (err: any) {
  console.warn(`[!] Không thể tự khởi động FB Media Post Scheduler: ${err.message}`);
}

import { startQuickTunnel } from "./tunnel";

// Tunnel flags: GitHub default-on (--no-tunnel / NO_TUNNEL=true disables it).
// Local spellings --tunnel / ENABLE_TUNNEL=true still accepted as explicit opt-in.
const tunnelExplicitlyOn = process.argv.includes("--tunnel") || process.env.ENABLE_TUNNEL === "true";
const tunnelDisabled = process.argv.includes("--no-tunnel") || process.env.NO_TUNNEL === "true";
const shouldStartTunnel = tunnelExplicitlyOn || !tunnelDisabled;
if (shouldStartTunnel) {
  console.log(`[*] Đang tự động kết nối Cloudflare Quick Tunnel (TryCloudflare)...`);
  startQuickTunnel(PORT, (url) => {
    broadcast({ type: "tunnel_ready", url });
  }).catch((err) => {
    console.warn(`[!] Không thể khởi động Quick Tunnel: ${err.message}`);
  });
}

// Kiểm tra cập nhật phiên bản mới ngầm (Non-blocking)
fetch("https://license.gpt.io.vn/api/version?component=daemon&client_version=2.0.0", {
  signal: AbortSignal.timeout(3000)
}).then(r => r.json()).then(data => {
  if (data?.update_available) {
    console.log(`\n🎉 [Otter Update] Đã có phiên bản daemon mới: v${data.version}!`);
    console.log(`👉 Tải cập nhật tại: ${data.download_url}\n`);
  }
}).catch(() => {});
