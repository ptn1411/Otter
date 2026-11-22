import * as fs from "node:fs/promises";
import * as path from "node:path";
import { executeCommand } from "../terminal";
import { browserBridge } from "../browser-bridge";
import { getSettings, updateSettings } from "../settings";
import { getDatabase } from "../db";
import {
  startMessengerListener,
  stopMessengerListener,
  getMessengerListenerStatus,
  getFullPlaybookOverview,
  updatePlaybookStepInDb,
  updateIntentInDb,
  updateCommentTemplatesInDb,
  resetSalesPlaybookInDb,
  nextSalesReply
} from "../fb-sales";
import { readFacebookNotifications, openNotificationAndReplyComment } from "../fb-notifications";
import { scanFacebookFeed, engageFacebookPost, listFeedEngagements, autoEngageFacebookFeed } from "../fb-engage";
import {
  postMediaDirect,
  queueMediaFromFolder,
  queueMediaFromList,
  queueMuseVideoForPost,
  listMediaQueue,
  cancelMediaQueueItem,
  cancelAllPendingMediaPosts,
  tickMediaPostScheduler
} from "../fb-media-post";
import { listWindows, takeScreenshot, mouseAction, keyboardAction, executeCuaTool, getCuaToolList } from "../desktop";
import { invokeVpsSsh } from "../vps";
import { dispatchBridgeTask, clearTaskQueue } from "../tools/task-bridge";
import {
  getAntigravityStatus,
  runAntigravityTask,
  readAntigravityChat,
  controlAntigravity,
} from "../tools/antigravity-cdp-tools";
import {
  getToolGroupsState,
  setToolGroupsEnabled,
  applyToolGroupPreset,
  TOOL_GROUP_IDS,
} from "../tool-groups";
import {
  getSocialBotStatus,
  sendSocialMessage,
  startSocialBot,
  stopSocialBot,
  getRecentChatMessages,
  mxhFilesTree,
  mxhFilesRead,
  mxhFilesWrite,
  mxhFilesEdit
} from "../social-bot";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { assertSafePath, getAuthToken } from "../security";
import { jsonResponse, errorResponse } from "./common";
import { matchDaemonRoute, matchDaemonRoutePrefix, getDaemonRoute } from "./lcg-routes";
import {
  getGpmHealth,
  listGpmProfiles,
  startGpmProfile,
  stopGpmProfile,
  generateGscriptActionNode,
  generateGscriptBlock,
  formatGpmCondition,
  validateXPathExpression
} from "../gpm";

export async function handleActivityRoutes(
  req: Request,
  url: URL,
  handleMcpActivity: (event: any) => void
): Promise<Response | null> {
  // 1. Action: Thực thi lệnh console (Terminal)
  if (matchDaemonRoute(url.pathname, "ACT_TERM_EXEC") && req.method === "POST") {
    const body: any = await req.json();
    const res = await executeCommand(body.command, body.cwd);

    handleMcpActivity({
      type: "terminal_output",
      output: res.stdout || res.stderr,
      exitCode: res.exitCode
    });

    return jsonResponse(res);
  }

  // 2. Action: Đọc tệp tin với bảo vệ chống Path Traversal & hỗ trợ nhị phân Base64
  if (matchDaemonRoute(url.pathname, "ACT_FILES_READ") && req.method === "POST") {
    try {
      const body: any = await req.json();
      const fullPath = assertSafePath(body.filePath);
      const rawBuf = await fs.readFile(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const binaryExts = new Set([
        ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".bmp",
        ".pdf", ".zip", ".gz", ".tar", ".mp4", ".mp3", ".wav", ".webm",
        ".exe", ".dll", ".sqlite", ".db"
      ]);
      const requestedEncoding = typeof body.encoding === "string" ? body.encoding.toLowerCase() : "auto";
      const hasNullByte = rawBuf.subarray(0, Math.min(rawBuf.length, 4096)).includes(0);
      const useBase64 =
        requestedEncoding === "base64" ||
        (requestedEncoding === "auto" && (binaryExts.has(ext) || hasNullByte));

      handleMcpActivity({
        type: "file_action",
        action: useBase64 ? "read_base64" : "read",
        path: fullPath,
        byteLength: rawBuf.length
      });

      if (useBase64) {
        return jsonResponse({
          content: rawBuf.toString("base64"),
          encoding: "base64",
          byteLength: rawBuf.length
        });
      }

      return jsonResponse({
        content: rawBuf.toString("utf-8"),
        encoding: "utf8",
        byteLength: rawBuf.length
      });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 3. Action: Ghi tệp tin với bảo vệ chống Path Traversal & hỗ trợ Base64
  if (matchDaemonRoute(url.pathname, "ACT_FILES_WRITE") && req.method === "POST") {
    try {
      const body: any = await req.json();
      const fullPath = assertSafePath(body.filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const isBase64 = typeof body.encoding === "string" && body.encoding.toLowerCase() === "base64";
      const dataToWrite = isBase64 ? Buffer.from(body.content || "", "base64") : String(body.content ?? "");
      await fs.writeFile(fullPath, dataToWrite as any, isBase64 ? undefined : "utf-8");

      const byteLen = typeof dataToWrite === "string" ? Buffer.byteLength(dataToWrite, "utf-8") : dataToWrite.length;
      handleMcpActivity({
        type: "file_action",
        action: "write",
        path: fullPath,
        byteLength: byteLen
      });

      return jsonResponse({ success: true, byteLength: byteLen, message: `Saved ${byteLen} bytes.` });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 4. Browser Actions (Ẩn toàn bộ prefix qua LCG)
  if (matchDaemonRoutePrefix(url.pathname, "ACT_BROWSER_PREFIX")) {
    const browserAction = url.pathname.slice(getDaemonRoute("ACT_BROWSER_PREFIX").length);

    if (browserAction === "open" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const res = await browserBridge.execute("open", { url: body.url });
        handleMcpActivity({ type: "browser_action", action: "open", url: res?.url, title: res?.title });
        return jsonResponse(res || { ok: false });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "read" && (req.method === "POST" || req.method === "GET")) {
      try {
        let urlPattern = url.searchParams.get("urlPattern") || undefined;
        if (req.method === "POST") {
          try {
            const body: any = await req.json();
            if (body?.urlPattern) urlPattern = body.urlPattern;
          } catch {}
        }
        const res = await browserBridge.execute("read_page", { urlPattern });
        if (!res) {
          return errorResponse("Không thể đọc trang (trang đang tải hoặc chưa sẵn sàng)", 500);
        }
        handleMcpActivity({ type: "browser_action", action: "read_page", url: res.url, title: res.title });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "click" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const res = await browserBridge.execute("click", { index: Number(body.index), urlPattern: body.urlPattern });
        handleMcpActivity({ type: "browser_action", action: "click", index: body.index });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "type" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const res = await browserBridge.execute("type", { index: Number(body.index), text: body.text, pressEnter: Boolean(body.pressEnter), urlPattern: body.urlPattern });
        handleMcpActivity({ type: "browser_action", action: "type", index: body.index, text: body.text });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "select" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const res = await browserBridge.execute("select", { index: Number(body.index), option: body.option });
        handleMcpActivity({ type: "browser_action", action: "select", index: body.index, option: body.option });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "scroll" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const res = await browserBridge.execute("scroll", { direction: body.direction || "down", amount: body.amount });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "back" && req.method === "POST") {
      try {
        const res = await browserBridge.execute("back");
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "inject_prompt" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const text = body.text || body.prompt;
        if (!text) return errorResponse("Thiếu nội dung text/prompt", 400);
        const ok = await browserBridge.injectPromptSmart(text, body.autoSubmit !== false);
        return jsonResponse({ ok, message: ok ? "Đã gửi prompt vào ChatGPT Web thành công" : "Không tìm thấy kết nối tới tab ChatGPT" });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "extension/reload" && (req.method === "POST" || req.method === "GET")) {
      try {
        const res = await browserBridge.execute("reload_extension");
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "engine" && (req.method === "GET" || req.method === "POST")) {
      try {
        let body: any = {};
        if (req.method === "POST") {
          try { body = await req.json(); } catch {}
        }
        const toUpdate: any = {};
        if (body.mode) {
          browserBridge.setEngineMode(body.mode);
          toUpdate.browserEngine = body.mode;
        }
        if (typeof body.headless === "boolean") toUpdate.cdpHeadless = body.headless;
        if (typeof body.hud === "boolean") toUpdate.cdpHud = body.hud;
        if (typeof body.autoClose === "boolean") toUpdate.cdpAutoClose = body.autoClose;
        if (typeof body.port === "number") toUpdate.cdpPort = body.port;
        if (typeof body.browserPath === "string") toUpdate.browserPath = body.browserPath;
        if (typeof body.userDataDir === "string") toUpdate.userDataDir = body.userDataDir;
        if (Object.keys(toUpdate).length > 0) {
          updateSettings(toUpdate);
        }
        const status = await browserBridge.getStatus();
        const currentSettings = getSettings();
        let benchmarkResult = null;
        if (body.benchmark) {
          benchmarkResult = await browserBridge.benchmark();
        }
        return jsonResponse({
          ...status,
          headless: currentSettings.cdpHeadless,
          hud: currentSettings.cdpHud,
          autoClose: currentSettings.cdpAutoClose,
          port: currentSettings.cdpPort,
          browserPath: currentSettings.browserPath,
          userDataDir: currentSettings.userDataDir,
          ...(benchmarkResult ? { benchmark: benchmarkResult } : {})
        });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if ((browserAction === "close" || browserAction === "browser/close") && (req.method === "POST" || req.method === "GET")) {
      try {
        const res = await browserBridge.execute("close");
        handleMcpActivity({ type: "browser_action", action: "close" });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "tabs/list" && (req.method === "GET" || req.method === "POST")) {
      try {
        const res = await browserBridge.execute("list_tabs");
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "tabs/switch" && req.method === "POST") {
      try {
        const body: any = await req.json().catch(() => ({}));
        const res = await browserBridge.execute("switch_tab", { tabId: Number(body.tabId) });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "tabs/close" && req.method === "POST") {
      try {
        const body: any = await req.json().catch(() => ({}));
        const res = await browserBridge.execute("close_tab", { tabId: body.tabId ? Number(body.tabId) : undefined });
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/close_docks" && req.method === "POST") {
      try {
        const res = await browserBridge.execute("close_messenger_docks");
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/listen/start" && req.method === "POST") {
      try {
        const body: any = await req.json().catch(() => ({}));
        const db = getDatabase();
        const res = startMessengerListener(db, handleMcpActivity, (body.intervalSeconds || 5) * 1000, body.mode || "chatgpt");
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/listen/stop" && req.method === "POST") {
      try {
        const res = stopMessengerListener();
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/listen/status" && req.method === "GET") {
      try {
        const status = getMessengerListenerStatus();
        return jsonResponse(status);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/playbook" && req.method === "GET") {
      try {
        const db = getDatabase();
        const overview = getFullPlaybookOverview(db);
        return jsonResponse({ ok: true, ...overview });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/playbook/stage" && req.method === "POST") {
      try {
        const body: any = await req.json().catch(() => ({}));
        const db = getDatabase();
        const res = updatePlaybookStepInDb(db, body);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/playbook/intent" && req.method === "POST") {
      try {
        const body: any = await req.json().catch(() => ({}));
        const db = getDatabase();
        const res = updateIntentInDb(db, body);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/playbook/comments" && req.method === "POST") {
      try {
        const body: any = await req.json().catch(() => ({}));
        const db = getDatabase();
        const res = updateCommentTemplatesInDb(db, body.category, body.templates, body.name);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/playbook/reset" && req.method === "POST") {
      try {
        const db = getDatabase();
        const res = resetSalesPlaybookInDb(db);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "notifications" && req.method === "GET") {
      try {
        const res = await readFacebookNotifications();
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "notifications/reply" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const db = getDatabase();
        const res = await openNotificationAndReplyComment(db, body, handleMcpActivity);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "feed/scan" && (req.method === "POST" || req.method === "GET")) {
      try {
        const res = await scanFacebookFeed(handleMcpActivity);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "feed/auto-engage" && (req.method === "POST" || req.method === "GET")) {
      try {
        const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
        const res = await autoEngageFacebookFeed(body, handleMcpActivity);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "feed/engage" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const res = await engageFacebookPost(body, handleMcpActivity);
        return jsonResponse(res);
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "feed/history" && req.method === "GET") {
      try {
        const db = getDatabase();
        const limit = Number(url.searchParams.get("limit") || 20);
        const records = listFeedEngagements(db, limit);
        return jsonResponse({ count: records.length, records });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/open" && req.method === "POST") {
      try {
        const pageData = await browserBridge.execute("read_page");
        const elements: any[] = pageData?.elements || [];
        const msgBtn = elements.find((e: any) => {
          const a = (e.ariaLabel || "").toLowerCase();
          const t = (e.text || "").toLowerCase();
          return a.includes("messenger") || t.includes("messenger");
        });
        if (!msgBtn) return errorResponse("Không tìm thấy nút Messenger trên giao diện Facebook.", 404);
        await browserBridge.execute("click", { index: msgBtn.index });
        return jsonResponse({ ok: true, message: `Đã mở Messenger (click index ${msgBtn.index})`, indexUsed: msgBtn.index });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (browserAction === "messenger/reply" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const db = getDatabase();
        const salesStep = nextSalesReply(db, body.recipientName, body.customerMessage);
        const replyText = body.customReply || salesStep.replyText;
        if (body.inputIndex) {
          await browserBridge.execute("type", { index: body.inputIndex, text: replyText, pressEnter: true });
        }
        handleMcpActivity({
          type: "fb_messenger",
          action: "reply",
          recipient: body.recipientName,
          stage: salesStep.currentStage,
          nextStage: salesStep.nextStage,
          replyText
        });
        return jsonResponse({
          ok: true,
          recipient: body.recipientName,
          customerMessage: body.customerMessage,
          currentStage: salesStep.currentStage,
          nextStage: salesStep.nextStage,
          replyText,
          message: `Đã phản hồi '${body.recipientName}' theo kịch bản [${salesStep.currentStage} -> ${salesStep.nextStage}]!`
        });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }
  }

  // 5. Desktop Actions (CUA & Screen Automation)
  if (matchDaemonRoutePrefix(url.pathname, "ACT_DESKTOP_PREFIX")) {
    const desktopAction = url.pathname.slice(getDaemonRoute("ACT_DESKTOP_PREFIX").length);

    if (desktopAction === "windows" && req.method === "GET") {
      try {
        const windows = await listWindows();
        return jsonResponse({ ok: true, count: windows.length, windows });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (desktopAction === "screenshot" && (req.method === "POST" || req.method === "GET")) {
      try {
        let body: any = {};
        try { body = await req.json(); } catch {}
        const res = await takeScreenshot(body.outputPath);
        handleMcpActivity({ type: "desktop_action", action: "screenshot", ...res });
        return jsonResponse({ ok: true, ...res });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (desktopAction === "click" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const action = body.action || "left_click";
        const msg = await mouseAction(action, Number(body.x || 0), Number(body.y || 0));
        handleMcpActivity({ type: "desktop_action", action, x: body.x, y: body.y });
        return jsonResponse({ ok: true, message: msg });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (desktopAction === "type" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const msg = await keyboardAction(body.keys || body.text || "");
        handleMcpActivity({ type: "desktop_action", action: "type", text: body.keys || body.text });
        return jsonResponse({ ok: true, message: msg });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (desktopAction === "cua/inventory" && req.method === "GET") {
      try {
        const query = url.searchParams.get("query") || "";
        const tools = await getCuaToolList();
        let filtered = tools;
        if (query) {
          const q = query.toLowerCase();
          filtered = tools.filter((t: any) =>
            (t.name && t.name.toLowerCase().includes(q)) ||
            (t.description && t.description.toLowerCase().includes(q))
          );
        }
        handleMcpActivity({ type: "cua_action", action: "inventory", count: filtered.length });
        return jsonResponse({ ok: true, tools: filtered });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }

    if (desktopAction === "cua/execute" && req.method === "POST") {
      try {
        const body: any = await req.json();
        const toolName = body.toolName || body.tool;
        if (!toolName) return errorResponse("Thiếu tham số 'toolName'", 400);
        const result = await executeCuaTool(toolName, body.arguments || body.args || {});
        handleMcpActivity({ type: "cua_action", action: "execute_tool", toolName });
        return jsonResponse({ ok: true, result });
      } catch (err: any) {
        return errorResponse(err.message, 500);
      }
    }
  }

  // 6. AI TTS Speech Synthesis (Vietnamese Studio Quality)
  if (url.pathname === "/api/activity/v1/skills/tts" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const text = body.text || "";
      const voice = body.voice || "vi-VN-HoaiMyNeural";
      const out = body.outputPath ? path.resolve(body.outputPath) : path.resolve(`tts_${Date.now()}.mp3`);
      const cmd = `uv run --with edge-tts edge-tts --voice ${voice} --text "${text.replace(/"/g, '\\"')}" --write-media "${out}"`;
      const res = await executeCommand(cmd);
      handleMcpActivity({ type: "speech_action", voice, textLength: text.length, path: out });
      return jsonResponse({ ok: res.exitCode === 0, outputPath: out, voice, exitCode: res.exitCode });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 7. Remote VPS SSH Execution
  if (url.pathname === "/api/activity/v1/vps/exec" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const res = await invokeVpsSsh("exec", body);
      handleMcpActivity({ type: "vps_action", action: "exec", host: body.host, command: body.command });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 7b. Antigravity IDE Task Dispatch & Queue Management Endpoints
  if (url.pathname === "/api/activity/v1/tasks/dispatch" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
        return errorResponse("Thiếu tham số bắt buộc 'goal'", 400);
      }
      const res = await dispatchBridgeTask({
        goal: body.goal.trim(),
        details: body.details,
        filesHint: body.filesHint,
        verify: body.verify,
        chatId: body.chatId || "chatgpt-web",
        planId: body.planId,
        planTaskId: body.planTaskId,
        orderIndex: body.orderIndex,
        dependsOn: body.dependsOn,
      }, handleMcpActivity);
      return jsonResponse({ ok: true, ...res });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/tasks/queue/clear" && req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const res = clearTaskQueue(body.reason || "api_clear", handleMcpActivity);
      return jsonResponse({ ...res });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 7b. Social Task Mesh — Bot Client Endpoints
  if (url.pathname === "/api/activity/v1/social/bot/status" && req.method === "GET") {
    try {
      const status = getSocialBotStatus();
      return jsonResponse({ ok: true, ...status });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/bot/messages" && req.method === "GET") {
    try {
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const messages = getRecentChatMessages(limit);
      return jsonResponse({ ok: true, count: messages.length, messages });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/bot/send" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.chatId || !body.text) {
        return errorResponse("Thiếu tham số 'chatId' hoặc 'text'", 400);
      }
      const res = await sendSocialMessage(body.chatId, body.text, body.replyToId);
      return jsonResponse({ ok: !!res, data: res });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/bot/connect" && req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      startSocialBot(body);
      const status = getSocialBotStatus();
      return jsonResponse({ ok: true, message: "Social Bot connection triggered", ...status });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/bot/disconnect" && req.method === "POST") {
    try {
      stopSocialBot();
      return jsonResponse({ ok: true, message: "Social Bot disconnected" });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/files/tree" && req.method === "GET") {
    try {
      const res = await mxhFilesTree({
        scope: url.searchParams.get("scope") || "shared",
        path: url.searchParams.get("path") || "",
        recursive: url.searchParams.get("recursive") === "true",
      });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/files/read" && (req.method === "GET" || req.method === "POST")) {
    try {
      const body: any = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const filePath = body.path || url.searchParams.get("path") || "";
      if (!filePath) return errorResponse("Thiếu tham số 'path'", 400);
      const res = await mxhFilesRead({
        scope: body.scope || url.searchParams.get("scope") || "shared",
        path: filePath,
        startLine: body.startLine ?? (url.searchParams.get("startLine") ? Number(url.searchParams.get("startLine")) : undefined),
        endLine: body.endLine ?? (url.searchParams.get("endLine") ? Number(url.searchParams.get("endLine")) : undefined),
        withLineNumbers: body.withLineNumbers ?? (url.searchParams.get("withLineNumbers") === "true"),
      });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/files/write" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.path) return errorResponse("Thiếu tham số 'path'", 400);
      const res = await mxhFilesWrite(body);
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/social/files/edit" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.path || !body.target) return errorResponse("Thiếu tham số 'path' hoặc 'target'", 400);
      const res = await mxhFilesEdit(body);
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 8. Universal MCP Tool Call Gateway (Call ANY of 190+ tools by name)
  if (url.pathname === "/api/activity/v1/tools/call" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const toolName = body.toolName || body.tool;
      if (!toolName) return errorResponse("Thiếu tham số 'toolName'", 400);

      const client = new Client({ name: "http-caller", version: "1.0.0" }, { capabilities: {} });
      const internalToken = getAuthToken();
      const sseUrl = new URL(`http://127.0.0.1:${process.env.PORT || 1993}/sse`);
      if (internalToken) sseUrl.searchParams.set("token", internalToken);
      const transport = new SSEClientTransport(sseUrl);
      await client.connect(transport);
      const res: any = await client.callTool({ name: toolName, arguments: body.arguments || {} });
      await client.close();

      handleMcpActivity({ type: "mcp_tool_call", tool: toolName, server: "internal" });
      return jsonResponse({ ok: true, tool: toolName, result: res });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 8c. Nhóm MCP tools — xem trạng thái + bật/tắt (cho AI tự cấu hình)
  if (url.pathname === "/api/activity/v1/tool-groups" && req.method === "GET") {
    return jsonResponse(getToolGroupsState());
  }

  if (url.pathname === "/api/activity/v1/tool-groups/set" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (typeof body.preset === "string") {
        return jsonResponse({ ok: true, ...applyToolGroupPreset(body.preset) });
      }
      if (body.groups && typeof body.groups === "object") {
        for (const id of Object.keys(body.groups)) {
          if (!TOOL_GROUP_IDS.has(id)) return errorResponse(`Nhóm không tồn tại: ${id}`, 400);
        }
        return jsonResponse({ ok: true, ...setToolGroupsEnabled(body.groups) });
      }
      if (typeof body.group === "string") {
        if (!TOOL_GROUP_IDS.has(body.group)) {
          return errorResponse(`Nhóm không tồn tại: ${body.group}`, 400);
        }
        return jsonResponse({
          ok: true,
          ...setToolGroupsEnabled({ [body.group]: body.enabled !== false }),
        });
      }
      return errorResponse("Thiếu tham số: cần preset, group+enabled, hoặc groups", 400);
    } catch (err: any) {
      return errorResponse(err.message, 400);
    }
  }

  // 8b. Antigravity IDE CDP Bridge Endpoints
  if (url.pathname === "/api/activity/v1/agy/status" && (req.method === "GET" || req.method === "POST")) {
    try {
      let body: any = {};
      if (req.method === "POST") {
        try { body = await req.json(); } catch {}
      }
      const cdpPort = body.cdpPort ?? (url.searchParams.get("cdpPort") ? Number(url.searchParams.get("cdpPort")) : undefined);
      const autoLaunch = body.autoLaunch ?? (url.searchParams.get("autoLaunch") === "true");
      const res = await getAntigravityStatus({ cdpPort, autoLaunch });
      handleMcpActivity({ type: "agy_cdp", action: "status", cdpAvailable: res.cdpAvailable, cdpPort: res.cdpPort });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/agy/run" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const prompt = body.prompt || body.task || body.text;
      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return errorResponse("Thiếu tham số bắt buộc 'prompt'", 400);
      }
      handleMcpActivity({ type: "agy_cdp", action: "run_task_start", prompt: prompt.slice(0, 120) });
      const res = await runAntigravityTask(prompt.trim(), body);
      handleMcpActivity({ type: "agy_cdp", action: "run_task_done", ok: res.ok });
      return jsonResponse(res, res.ok ? 200 : 500);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/agy/chat" && req.method === "GET") {
    try {
      const cdpPort = url.searchParams.get("cdpPort") ? Number(url.searchParams.get("cdpPort")) : undefined;
      const res = await readAntigravityChat({ cdpPort });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/agy/control" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.action) return errorResponse("Thiếu tham số 'action'", 400);
      const res = await controlAntigravity(body);
      handleMcpActivity({ type: "agy_cdp", action: body.action });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 9. AI Partner Muse Actions (Direct Custom GPT Action Endpoint)
  if (url.pathname === "/api/activity/v1/muse/ask" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const task = body.task || body.prompt;
      if (!task) return errorResponse("Thiếu tham số 'task'", 400);

      handleMcpActivity({ type: "muse_action", action: "dispatch_task", task });

      const res = await browserBridge.execute(
        "ask_muse",
        {
          task,
          newThread: body.new_thread ?? true,
          closeTabOnDone: !body.keep_tab_open,
          timeoutMs: 180000
        },
        190000
      );

      if (!res.ok) {
        return errorResponse(res.error || "Muse AI thất bại", 500);
      }

      // Tự động lưu media về ổ đĩa nếu có
      const mediaList: any[] = [];
      if (res.attachments && res.attachments.length > 0) {
        const mediaDir = path.resolve("storage/media/muse");
        await fs.mkdir(mediaDir, { recursive: true });

        for (let i = 0; i < res.attachments.length; i++) {
          const att = res.attachments[i];
          let localPath = "";
          if (att.base64) {
            let ext = ".bin";
            if (att.mime?.includes("mp4") || att.type === "video") ext = ".mp4";
            else if (att.mime?.includes("webp")) ext = ".webp";
            else if (att.mime?.includes("png")) ext = ".png";
            else if (att.mime?.includes("jpeg") || att.mime?.includes("jpg")) ext = ".jpg";

            const filename = `muse_${att.type || "media"}_${Date.now()}_${i + 1}${ext}`;
            localPath = path.join(mediaDir, filename);
            const buffer = Buffer.from(att.base64, "base64");
            await fs.writeFile(localPath, buffer);
          }
          mediaList.push({
            type: att.type,
            url: att.url,
            localPath: localPath || undefined
          });
        }
      }

      return jsonResponse({
        ok: true,
        replyText: res.replyText,
        attachments: mediaList,
        message: "Muse AI đã hoàn thành nhiệm vụ thành công!"
      });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 10. Facebook Media & Video Queue Endpoints (Profile, Group, Page)
  if (url.pathname === "/api/activity/v1/fb/media/post" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const db = getDatabase();
      const res = await postMediaDirect(db, {
        targetType: body.targetType || "profile",
        targetUrl: body.targetUrl,
        mediaPath: body.mediaPath,
        caption: body.caption
      }, handleMcpActivity);
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/fb/media/queue-folder" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const db = getDatabase();
      const res = await queueMediaFromFolder(db, {
        folderPath: body.folderPath,
        targetType: body.targetType || "profile",
        targetUrl: body.targetUrl,
        targetName: body.targetName,
        defaultCaption: body.defaultCaption,
        intervalMinutes: body.intervalMinutes,
        sortBy: body.sortBy
      });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/fb/media/queue-list" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const db = getDatabase();
      const res = queueMediaFromList(db, {
        items: body.items,
        defaultTargetType: body.defaultTargetType,
        defaultTargetUrl: body.defaultTargetUrl,
        intervalMinutes: body.intervalMinutes
      });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/fb/media/queue-muse" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const db = getDatabase();
      const res = await queueMuseVideoForPost(db, {
        task: body.task,
        targetType: body.targetType || "profile",
        targetUrl: body.targetUrl,
        targetName: body.targetName,
        caption: body.caption,
        intervalMinutes: body.intervalMinutes
      }, handleMcpActivity);
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/fb/media/queue" && req.method === "GET") {
    try {
      const db = getDatabase();
      const status = url.searchParams.get("status") as any;
      const limit = Number(url.searchParams.get("limit") || 50);
      const res = listMediaQueue(db, { status, limit });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/fb/media/cancel" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const db = getDatabase();
      if (body.cancelAll) {
        const count = cancelAllPendingMediaPosts(db);
        return jsonResponse({ ok: true, cancelledCount: count });
      }
      const ok = cancelMediaQueueItem(db, body.id);
      return jsonResponse({ ok });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/fb/media/run-now" && req.method === "POST") {
    try {
      const db = getDatabase();
      const res = await tickMediaPostScheduler(db, handleMcpActivity);
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 11. Extension Reload
  if (url.pathname === "/api/activity/v1/browser/reload-extension" && req.method === "POST") {
    try {
      const res = await browserBridge.execute("reload_extension", {});
      return jsonResponse({ ok: true, message: res?.message || "Đang nạp lại tiện ích..." });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 12. GPM Automate & GPM Login API Routes
  if (url.pathname === "/api/activity/v1/gpm/status" && req.method === "GET") {
    try {
      const health = await getGpmHealth();
      return jsonResponse(health);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/gpm/profiles" && req.method === "GET") {
    try {
      const page = Number(url.searchParams.get("page")) || 1;
      const pageSize = Number(url.searchParams.get("pageSize")) || 50;
      const search = url.searchParams.get("search") || "";
      const res = await listGpmProfiles(page, pageSize, search);
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/gpm/profiles/start" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.profileId) return errorResponse("Missing profileId", 400);
      const res = await startGpmProfile(body.profileId, {
        additionArgs: body.additionArgs,
        loadOtterExtension: body.loadOtterExtension !== false
      });
      handleMcpActivity({ type: "gpm_start_profile", profileId: body.profileId, res });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/gpm/profiles/stop" && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.profileId) return errorResponse("Missing profileId", 400);
      const res = await stopGpmProfile(body.profileId);
      handleMcpActivity({ type: "gpm_stop_profile", profileId: body.profileId, res });
      return jsonResponse(res);
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/gpm/xpath/test" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const xpath = body.xpath || "";
      const validation = validateXPathExpression(xpath);
      const condition = formatGpmCondition(xpath, Boolean(body.negate));

      let liveEvaluation = null;
      if (validation.valid && body.liveTest) {
        try {
          const evalRes = await browserBridge.execute("evaluate_js", {
            script: `(() => {
              try {
                const result = document.evaluate(${JSON.stringify(xpath)}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                const count = result.snapshotLength;
                const sampleTexts = [];
                for (let i = 0; i < Math.min(count, 5); i++) {
                  const node = result.snapshotItem(i);
                  sampleTexts.push((node.innerText || node.textContent || node.nodeName).slice(0, 100));
                }
                return { count, sampleTexts };
              } catch (e) {
                return { count: 0, error: e.message };
              }
            })()`
          }, 5000);
          liveEvaluation = evalRes?.result || evalRes;
        } catch {}
      }

      return jsonResponse({
        xpath,
        isValid: validation.valid,
        error: validation.error || null,
        hasElementCondition: condition,
        liveEvaluation
      });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (url.pathname === "/api/activity/v1/gpm/script/generate" && req.method === "POST") {
    try {
      const body: any = await req.json();
      const actionNode = generateGscriptActionNode({
        actionType: Number(body.actionType) || 48,
        xpath: body.xpath,
        rawInput: body.rawInput,
        comment: body.comment,
        delay: body.delay
      });
      const output = body.wrapInBlock !== false
        ? generateGscriptBlock([actionNode], body.comment || "Otter Action")
        : [actionNode];
      const jsonString = JSON.stringify(body.wrapInBlock !== false ? [output] : output, null, 2);
      return jsonResponse({
        success: true,
        format: "GPM Automate V3 (.NET JSON)",
        pasteReadyJson: jsonString
      });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  return null;
}
