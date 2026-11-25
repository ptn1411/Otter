import {
  executeExternalTool,
  getExternalServersState,
  reloadExternalMcpServers,
  loadMcpConfig,
  saveMcpConfig,
  addExternalServer,
  removeExternalServer
} from "../mcp-gateway";
import { jsonResponse, errorResponse } from "./common";
import { isTrustedHostOrIp } from "../security";
import { matchDaemonRoute, matchDaemonRoutePrefix, getDaemonRoute } from "./lcg-routes";
import { browserBridge } from "../browser-bridge";
import { updateSettings } from "../settings";
import { getDatabase } from "../db";
import {
  startMessengerListener,
  stopMessengerListener,
  getMessengerListenerStatus,
  checkAndReplyMessengerOnce
} from "../fb-sales";
import { autoEngageFacebookFeed } from "../fb-engage";
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
import {
  getSocialBotStatus,
  sendSocialMessage,
  startSocialBot,
  stopSocialBot,
  mxhFilesTree,
  mxhFilesRead,
  mxhFilesWrite,
  mxhFilesEdit
} from "../social-bot";
import {
  sendInboxMessage,
  pullInbox,
  ackInboxMessage,
  getInboxMessage,
  listInboxMessages,
  getInboxStats,
  listBots,
  updateBotPresence,
} from "../a2a-inbox";
import {
  getAntigravityStatus,
  runAntigravityTask,
  readAntigravityChat,
  controlAntigravity
} from "../tools/antigravity-cdp-tools";
import { executePhoneTool, PHONE_TOOL_DEFS } from "../tools/phone-tools";
import {
  getToolGroupsState,
  setToolGroupsEnabled,
  applyToolGroupPreset,
  TOOL_GROUP_IDS,
} from "../tool-groups";

export async function handleMcpRoutes(req: Request, url: URL, handleMcpActivity: (event: any) => void): Promise<Response | null> {
  // 1. External MCP Tools Proxy (Custom GPT Actions & REST API)
  if (matchDaemonRoutePrefix(url.pathname, "MCP_EXT_PREFIX") && req.method === "POST") {
    const extPrefix = getDaemonRoute("MCP_EXT_PREFIX");
    const parts = url.pathname.replace(extPrefix, "").split("/");
    const serverKey = parts[0];
    const toolName = parts.slice(1).join("/");
    if (!serverKey || !toolName) {
      return errorResponse("Missing serverKey or toolName", 400);
    }
    let body: any = {};
    try { body = await req.json(); } catch { }

    if (serverKey === "otter_core") {
      if (toolName === "browser_close") {
        const res = await browserBridge.execute("close");
        return jsonResponse(res);
      }

      if (toolName === "browser_engine_status") {
        const toUpdate: any = {};
        if (body.mode) {
          browserBridge.setEngineMode(body.mode);
          toUpdate.browserEngine = body.mode;
        }
        if (typeof body.headless === "boolean") toUpdate.cdpHeadless = body.headless;
        if (typeof body.hud === "boolean") toUpdate.cdpHud = body.hud;
        if (typeof body.autoClose === "boolean") toUpdate.cdpAutoClose = body.autoClose;
        if (Object.keys(toUpdate).length > 0) {
          updateSettings(toUpdate);
        }
        const status = await browserBridge.getStatus();
        let benchmarkResult = null;
        if (body.benchmark) {
          benchmarkResult = await browserBridge.benchmark();
        }
        return jsonResponse({
          ...status,
          ...(benchmarkResult ? { benchmark: benchmarkResult } : {})
        });
      }

      if (toolName === "ask_muse_agent" || toolName === "ask_muse") {
        const task = body.task || body.prompt;
        if (!task) return errorResponse("Thiếu tham số 'task'", 400);
        handleMcpActivity({ type: "muse_action", action: "dispatch_task", task });
        const res = await browserBridge.execute(
          "ask_muse",
          {
            task,
            newThread: body.new_thread ?? true,
            closeTabOnDone: body.keep_tab_open === false,
            timeoutMs: 180000
          },
          190000
        );
        return jsonResponse(res);
      }

      if (toolName === "fb_messenger_listen_start") {
        const res = startMessengerListener(
          getDatabase(),
          handleMcpActivity,
          (body.intervalSeconds || 5) * 1000,
          body.mode || "chatgpt"
        );
        return jsonResponse(res);
      }

      if (toolName === "fb_messenger_listen_stop") {
        const res = stopMessengerListener();
        return jsonResponse(res);
      }

      if (toolName === "fb_messenger_listen_status") {
        const status = getMessengerListenerStatus();
        return jsonResponse(status);
      }

      if (toolName === "fb_messenger_sales_reply") {
        const res = await checkAndReplyMessengerOnce(getDatabase(), handleMcpActivity);
        return jsonResponse(res);
      }

      if (toolName === "fb_feed_auto_engage") {
        const res = await autoEngageFacebookFeed(body, handleMcpActivity);
        return jsonResponse(res);
      }

      if (toolName === "gpm_status") {
        const health = await getGpmHealth();
        return jsonResponse(health);
      }

      if (toolName === "gpm_list_profiles") {
        const res = await listGpmProfiles(body.page, body.pageSize, body.search);
        return jsonResponse(res);
      }

      if (toolName === "gpm_start_profile") {
        const res = await startGpmProfile(body.profileId, {
          additionArgs: body.additionArgs
        });
        return jsonResponse(res);
      }

      if (toolName === "gpm_stop_profile") {
        const res = await stopGpmProfile(body.profileId);
        return jsonResponse(res);
      }

      if (toolName === "gpm_test_xpath") {
        const validation = validateXPathExpression(body.xpath || "");
        const condition = formatGpmCondition(body.xpath || "", Boolean(body.negate));
        return jsonResponse({ xpath: body.xpath, isValid: validation.valid, error: validation.error, hasElementCondition: condition });
      }

      if (toolName === "gpm_generate_script") {
        const node = generateGscriptActionNode({
          actionType: Number(body.actionType) || 48,
          xpath: body.xpath,
          rawInput: body.rawInput,
          comment: body.comment,
          delay: body.delay
        });
        const output = body.wrapInBlock !== false ? generateGscriptBlock([node], body.comment || "Otter Action") : [node];
        return jsonResponse({ success: true, pasteReadyJson: JSON.stringify(body.wrapInBlock !== false ? [output] : output, null, 2) });
      }

      if (toolName === "cua_get_inventory") {
        const { getCuaToolList } = await import("../desktop");
        try {
          const tools = await getCuaToolList();
          const query = (body.query || "").toLowerCase();
          const filtered = query
            ? tools.filter((t: any) =>
                (t.name && t.name.toLowerCase().includes(query)) ||
                (t.description && t.description.toLowerCase().includes(query))
              )
            : tools;
          handleMcpActivity({ type: "cua_action", action: "inventory", count: filtered.length });
          return jsonResponse({ ok: true, tools: filtered });
        } catch (err: any) {
          return errorResponse(err.message, 500);
        }
      }

      if (toolName === "cua_execute_tool") {
        const targetTool = body.toolName || body.tool;
        if (!targetTool) return errorResponse("Thiếu tham số 'toolName'", 400);
        const { executeCuaTool } = await import("../desktop");
        try {
          const res = await executeCuaTool(targetTool, body.arguments || body.args || {});
          handleMcpActivity({ type: "cua_action", action: "execute_tool", toolName: targetTool });
          return jsonResponse({ ok: true, result: res });
        } catch (err: any) {
          return errorResponse(err.message, 500);
        }
      }

      if (toolName.startsWith("adesktop_")) {
        const { agentDesktopBridge } = await import("../agent-desktop");
        try {
          const res = await agentDesktopBridge.callTool(toolName, body.arguments || body.args || body);
          handleMcpActivity({ type: "adesktop_action", action: "execute_tool", toolName });
          return jsonResponse({ ok: true, result: res });
        } catch (err: any) {
          return errorResponse(err.message, 500);
        }
      }

      if (toolName === "social_bot_status") {
        const status = getSocialBotStatus();
        return jsonResponse(status);
      }

      if (toolName === "social_bot_send") {
        const res = await sendSocialMessage(body.chatId, body.text, body.replyToId);
        return jsonResponse({ ok: !!res, data: res });
      }

      if (toolName === "social_bot_connect") {
        startSocialBot(body);
        const status = getSocialBotStatus();
        return jsonResponse({ ok: true, ...status });
      }

      if (toolName === "social_bot_disconnect") {
        stopSocialBot();
        return jsonResponse({ ok: true, message: "Disconnected" });
      }

      if (toolName === "mxh_files_tree") {
        const res = await mxhFilesTree(body);
        return jsonResponse(res);
      }

      if (toolName === "mxh_files_read") {
        if (!body.path) return errorResponse("Thiếu tham số 'path'", 400);
        const res = await mxhFilesRead(body);
        return jsonResponse(res);
      }

      if (toolName === "mxh_files_write") {
        if (!body.path) return errorResponse("Thiếu tham số 'path'", 400);
        const res = await mxhFilesWrite(body);
        return jsonResponse(res);
      }

      if (toolName === "mxh_files_edit") {
        if (!body.path || !body.target) return errorResponse("Thiếu tham số 'path' hoặc 'target'", 400);
        const res = await mxhFilesEdit(body);
        return jsonResponse(res);
      }

      if (toolName === "agy_status") {
        const res = await getAntigravityStatus({ cdpPort: body.cdpPort, autoLaunch: body.autoLaunch });
        handleMcpActivity({ type: "agy_cdp", action: "status", cdpAvailable: res.cdpAvailable });
        return jsonResponse(res);
      }

      if (toolName === "agy_run_task") {
        const prompt = body.prompt || body.task || body.text;
        if (!prompt) return errorResponse("Thiếu tham số 'prompt'", 400);
        const res = await runAntigravityTask(prompt, body);
        handleMcpActivity({ type: "agy_cdp", action: "run_task", ok: res.ok });
        return jsonResponse(res, res.ok ? 200 : 500);
      }

      if (toolName === "agy_read_chat") {
        try {
          const res = await readAntigravityChat({ cdpPort: body.cdpPort });
          return jsonResponse(res);
        } catch (err: any) {
          return errorResponse(err.message, 500);
        }
      }

      if (toolName === "agy_control") {
        if (!body.action) return errorResponse("Thiếu tham số 'action'", 400);
        try {
          const res = await controlAntigravity(body);
          handleMcpActivity({ type: "agy_cdp", action: body.action });
          return jsonResponse(res);
        } catch (err: any) {
          return errorResponse(err.message, 500);
        }
      }

      if (toolName === "tool_groups_list") {
        return jsonResponse(getToolGroupsState());
      }

      if (toolName === "tool_groups_set") {
        try {
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

      if (toolName === "a2a_send_message") {
        try {
          const msg = await sendInboxMessage({
            senderId: body.senderId,
            recipientId: body.recipientId,
            goal: body.goal,
            details: body.details,
            messageType: body.messageType,
            priority: body.priority,
            payload: body.payload,
            artifacts: body.artifacts,
          });
          return jsonResponse({ ok: true, message: msg });
        } catch (err: any) {
          return errorResponse(err.message, 400);
        }
      }

      if (toolName === "a2a_pull_inbox") {
        try {
          const tasks = pullInbox({
            recipientId: body.botId,
            workerId: body.workerId,
            limit: body.limit,
            leaseMs: body.leaseSeconds ? body.leaseSeconds * 1000 : undefined,
          });
          return jsonResponse({ ok: true, count: tasks.length, tasks });
        } catch (err: any) {
          return errorResponse(err.message, 400);
        }
      }

      if (toolName === "a2a_ack_message") {
        try {
          const res = ackInboxMessage({
            messageId: body.messageId,
            workerId: body.workerId,
            status: body.status,
            resultSummary: body.resultSummary,
            result: body.result,
            artifacts: body.artifacts,
          });
          return jsonResponse(res);
        } catch (err: any) {
          return errorResponse(err.message, 400);
        }
      }

      if (toolName === "a2a_inbox_status") {
        if (body.messageId) {
          const msg = getInboxMessage(body.messageId);
          return jsonResponse({ ok: !!msg, message: msg });
        }
        const stats = getInboxStats();
        const messages = listInboxMessages({
          recipientId: body.botId,
          status: body.status,
          limit: body.limit,
        });
        return jsonResponse({ ok: true, stats, messages });
      }

      if (toolName === "a2a_list_bots") {
        if (body.updatePresenceBotId && body.presenceStatus) {
          updateBotPresence(body.updatePresenceBotId, body.presenceStatus);
        }
        const bots = listBots();
        return jsonResponse({ ok: true, total: bots.length, bots });
      }

      if (toolName.startsWith("phone_")) {
        try {
          const res = await executePhoneTool(toolName, body.arguments || body.args || body, handleMcpActivity);
          return jsonResponse(typeof res === "object" && res !== null ? res : { ok: true, result: res });
        } catch (err: any) {
          return errorResponse(err.message, 400);
        }
      }
    }

    const result = await executeExternalTool(serverKey, toolName, body, handleMcpActivity);
    return jsonResponse(result);
  }

  // 2. External & Built-in MCP Servers List
  if (matchDaemonRoute(url.pathname, "MCP_SERVERS") && req.method === "GET") {
    const externalServers = getExternalServersState().map(s => ({
      name: s.name,
      status: s.status,
      url: s.config.url,
      toolsCount: s.tools.length,
      tools: s.tools.map(t => ({
        name: t.originalName,
        qualifiedName: t.qualifiedName,
        title: t.title,
        description: t.description
      })),
      lastChecked: s.lastChecked,
      error: s.error
    }));

    const isTrusted = isTrustedHostOrIp(url.host);
    const proto = req.headers.get("x-forwarded-proto") || (url.protocol.startsWith("https") ? "https" : (isTrusted ? "http" : "https"));
    const serverBaseUrl = `${proto}://${url.host}`;

    const builtInTools = [
        {
          name: "tool_groups_list",
          qualifiedName: "otter_core_tool_groups_list",
          title: "Danh sách nhóm MCP tools & trạng thái bật/tắt",
          description: "Liệt kê các nhóm MCP tools (core, browser, code, fb, meta, vps, db, agents...) kèm trạng thái bật/tắt, số tool và ước lượng token schema để AI quyết định bật/tắt cho nhẹ context."
        },
        {
          name: "tool_groups_set",
          qualifiedName: "otter_core_tool_groups_set",
          title: "Bật/tắt nhóm MCP tools theo nhu cầu",
          description: "AI tự bật/tắt nhóm MCP tools bằng preset (all/minimal/code/fb) hoặc từng nhóm; thay đổi áp dụng ngay cho mọi phiên MCP đang kết nối."
        },
        {
          name: "browser_close",
          qualifiedName: "otter_core_browser_close",
          title: "Đóng toàn bộ trình duyệt Chrome CDP",
          description: "Đóng toàn bộ phiên Chrome CDP đang mở để giải phóng RAM và CPU."
        },
        {
          name: "browser_engine_status",
          qualifiedName: "otter_core_browser_engine_status",
          title: "Trạng thái động cơ trình duyệt CDP",
          description: "Kiểm tra kết nối của Chrome CDP port (9222 hoặc tùy chỉnh như GPM 57326/wsEndpoint), đo đạc tốc độ benchmark và cấu hình linh hoạt."
        },
        {
          name: "fb_feed_auto_engage",
          qualifiedName: "otter_core_fb_feed_auto_engage",
          title: "Tự động lướt Bảng tin & bình luận giới thiệu nhóm",
          description: "Tự động cuộn lướt Bảng tin Facebook, lọc bài viết phù hợp, Thích bài và Bình luận tự động kèm lời giới thiệu khéo léo vào nhóm Facebook của bạn."
        },
        {
          name: "ask_muse_agent",
          qualifiedName: "otter_core_ask_muse_agent",
          title: "Giao việc cho AI đối tác Muse",
          description: "Giao nhiệm vụ chi tiết cho Muse AI trên web xử lý (viết code, giải thuật, tạo video, vẽ ảnh, phân tích...) và tự động lấy kết quả về máy"
        },
        {
          name: "fb_messenger_listen_start",
          qualifiedName: "otter_core_fb_messenger_listen_start",
          title: "Lắng nghe tin nhắn Facebook Messenger tự động",
          description: "Bật tiến trình chạy ngầm đọc tin nhắn Messenger mới và tự động chuyển tiếp lên ChatGPT Web để AI tư vấn hoặc tự trả lời theo kịch bản."
        },
        {
          name: "fb_messenger_listen_stop",
          qualifiedName: "otter_core_fb_messenger_listen_stop",
          title: "Dừng lắng nghe Messenger",
          description: "Dừng tiến trình chạy ngầm tự động lắng nghe tin nhắn Facebook Messenger."
        },
        {
          name: "fb_messenger_listen_status",
          qualifiedName: "otter_core_fb_messenger_listen_status",
          title: "Trạng thái lắng nghe Messenger",
          description: "Kiểm tra trạng thái tiến trình lắng nghe, số tin đã trả lời và tên khách hàng gần nhất."
        },
        {
          name: "fb_messenger_sales_reply",
          qualifiedName: "otter_core_fb_messenger_sales_reply",
          title: "Kiểm tra và trả lời tin nhắn Messenger một lần",
          description: "Quét khung chat Messenger đang mở một lần và tự động tạo câu trả lời theo kịch bản bán hàng."
        },
        {
          name: "fb_post_media",
          qualifiedName: "otter_core_fb_post_media",
          title: "Đăng video/ảnh lên Facebook",
          description: "Đăng ngay 1 bài viết kèm video hoặc hình ảnh lên Trang cá nhân, Nhóm, hoặc Fanpage."
        },
        {
          name: "fb_queue_media_folder",
          qualifiedName: "otter_core_fb_queue_media_folder",
          title: "Quét thư mục video đăng lên Facebook",
          description: "Quét một thư mục trên máy tính, tự động xếp hàng và lập lịch đăng từng video/ảnh lên Facebook theo khoảng cách an toàn."
        },
        {
          name: "fb_queue_media_list",
          qualifiedName: "otter_core_fb_queue_media_list",
          title: "Nạp danh sách bài viết video/ảnh",
          description: "Nạp mảng danh sách bài viết kèm media và caption vào hàng đợi tự động đăng bài Facebook."
        },
        {
          name: "fb_queue_muse_video",
          qualifiedName: "otter_core_fb_queue_muse_video",
          title: "Tạo video bằng Muse AI và đăng FB",
          description: "Giao việc cho Muse AI tạo video, tự động tải về máy và đưa vào hàng đợi đăng lên Facebook."
        },
        {
          name: "fb_media_list_queue",
          qualifiedName: "otter_core_fb_media_list_queue",
          title: "Xem hàng đợi media Facebook",
          description: "Xem tiến độ và danh sách các bài đăng media đang chờ hoặc đã đăng trên Facebook."
        },
        {
          name: "fb_media_cancel_queue",
          qualifiedName: "otter_core_fb_media_cancel_queue",
          title: "Hủy hàng đợi media Facebook",
          description: "Hủy một bài hoặc toàn bộ bài đăng media đang chờ trong hàng đợi."
        },
        {
          name: "fb_media_run_now",
          qualifiedName: "otter_core_fb_media_run_now",
          title: "Kích hoạt đăng ngay bài media tiếp theo",
          description: "Đăng ngay bài media tiếp theo trong hàng đợi mà không cần chờ đến giờ hẹn."
        },
        {
          name: "gpm_status",
          qualifiedName: "otter_core_gpm_status",
          title: "Trạng thái GPM Login & GPM Automate",
          description: "Kiểm tra kết nối tới GPM Login API (9495) và GPM Automate MCP (19977)."
        },
        {
          name: "gpm_list_profiles",
          qualifiedName: "otter_core_gpm_list_profiles",
          title: "Danh sách Profile GPM Login",
          description: "Liệt kê các profile GPM kèm proxy và trạng thái chạy."
        },
        {
          name: "gpm_start_profile",
          qualifiedName: "otter_core_gpm_start_profile",
          title: "Khởi động Profile GPM Login",
          description: "Mở profile GPM Login kèm cổng/WebSocket CDP để Otter kết nối trực tiếp."
        },
        {
          name: "gpm_stop_profile",
          qualifiedName: "otter_core_gpm_stop_profile",
          title: "Đóng Profile GPM Login",
          description: "Dừng (đóng) profile GPM Login đang chạy."
        },
        {
          name: "gpm_test_xpath",
          qualifiedName: "otter_core_gpm_test_xpath",
          title: "Kiểm tra XPath & Gợi ý hasElement",
          description: "Kiểm tra cú pháp XPath và tạo điều kiện chuẩn hasElement() cho GPM Automate V3."
        },
        {
          name: "gpm_generate_script",
          qualifiedName: "otter_core_gpm_generate_script",
          title: "Tạo kịch bản GPM Automate V3 (.NET JSON)",
          description: "Sinh mã JSON .NET paste-ready sao chép dán trực tiếp vào GPM Automate Editor."
        },
        {
          name: "cua_get_inventory",
          qualifiedName: "otter_core_cua_get_inventory",
          title: "Tra cứu danh sách công cụ CUA (Computer-Use Agent)",
          description: "Tra cứu danh sách công cụ native CUA SDK từ trycua/cua để tự động hóa màn hình, chuột, phím."
        },
        {
          name: "cua_execute_tool",
          qualifiedName: "otter_core_cua_execute_tool",
          title: "Thực thi công cụ CUA (Computer-Use Agent)",
          description: "Gọi trực tiếp bất kỳ công cụ nào của CUA trycua/cua: click, type_text, hotkey, get_screen_size, get_window_state, list_windows..."
        },
        {
          name: "adesktop_status",
          qualifiedName: "otter_core_adesktop_status",
          title: "Trạng thái Agent Desktop",
          description: "Kiểm tra sức khỏe, quyền hạn và trạng thái adapter của agent-desktop."
        },
        {
          name: "adesktop_snapshot",
          qualifiedName: "otter_core_adesktop_snapshot",
          title: "Chụp cây Accessibility giao diện Desktop (Refs)",
          description: "Chụp cây accessibility có cấu trúc ngữ nghĩa kèm các ID @ref để AI quan sát và tương tác chính xác."
        },
        {
          name: "adesktop_click",
          qualifiedName: "otter_core_adesktop_click",
          title: "Bấm chuột ngữ nghĩa trên ref (@ref)",
          description: "Thực hiện hành động bấm chuột ngữ nghĩa theo accessibility @ref của phần tử giao diện."
        },
        {
          name: "social_bot_status",
          qualifiedName: "otter_core_social_bot_status",
          title: "Trạng thái Social Task Bot",
          description: "Kiểm tra kết nối Socket.IO tới Mạng Xã Hội và số task đã tiếp nhận."
        },
        {
          name: "social_bot_send",
          qualifiedName: "otter_core_social_bot_send",
          title: "Gửi tin nhắn MXH",
          description: "Gửi tin nhắn vào cuộc trò chuyện / nhóm chat trên Mạng Xã Hội."
        },
        {
          name: "social_bot_connect",
          qualifiedName: "otter_core_social_bot_connect",
          title: "Kết nối Social Bot",
          description: "Kết nối hoặc kết nối lại Social Bot tới MXH Socket.IO server."
        },
        {
          name: "social_bot_disconnect",
          qualifiedName: "otter_core_social_bot_disconnect",
          title: "Ngắt kết nối Social Bot",
          description: "Ngắt kết nối Social Bot khỏi MXH Socket.IO server."
        },
        {
          name: "agy_status",
          qualifiedName: "otter_core_agy_status",
          title: "Trạng thái CDP Antigravity IDE",
          description: "Kiểm tra kết nối CDP tới ứng dụng Antigravity IDE, trạng thái đăng nhập, project/model đang chọn."
        },
        {
          name: "agy_run_task",
          qualifiedName: "otter_core_agy_run_task",
          title: "Giao nhiệm vụ cho Antigravity IDE qua CDP",
          description: "Gửi prompt vào Antigravity IDE qua CDP, chọn project/model/quyền, tự duyệt dialog chờ và lấy câu trả lời cuối cùng."
        },
        {
          name: "agy_read_chat",
          qualifiedName: "otter_core_agy_read_chat",
          title: "Đọc hội thoại Antigravity IDE",
          description: "Đọc các lượt hội thoại (You said / Agent said) và trạng thái thực thi hiện tại của Antigravity IDE."
        },
        {
          name: "agy_control",
          qualifiedName: "otter_core_agy_control",
          title: "Điều khiển phiên Antigravity IDE",
          description: "Thực hiện thao tác trên Antigravity IDE: new_chat, stop, select_project, select_model, set_permissions, approve_waiting, screenshot."
        },
        {
          name: "mxh_files_tree",
          qualifiedName: "otter_core_mxh_files_tree",
          title: "Duyệt cây thư mục Kho Tệp Chung MXH",
          description: "Liệt kê tệp và thư mục trên Kho Tệp Chung MXH (Shared AI Workspace / nhóm chat)."
        },
        {
          name: "mxh_files_read",
          qualifiedName: "otter_core_mxh_files_read",
          title: "Đọc tệp tin Kho Chung MXH theo dòng",
          description: "Đọc nội dung tệp trên Kho Tệp Chung MXH (hỗ trợ startLine..endLine như đọc code IDE)."
        },
        {
          name: "mxh_files_write",
          qualifiedName: "otter_core_mxh_files_write",
          title: "Ghi tệp tin Kho Chung MXH kèm lịch sử",
          description: "Ghi mới hoặc cập nhật tệp trên Kho Tệp Chung MXH kèm kiểm tra SHA256 và tự lưu lịch sử phiên bản."
        },
        {
          name: "mxh_files_edit",
          qualifiedName: "otter_core_mxh_files_edit",
          title: "Patch sửa đoạn mã trên Kho Chung MXH",
          description: "Sửa từng đoạn mã/văn bản (target -> replacement) trên Kho Tệp Chung MXH không cần gửi lại toàn bộ tệp."
        },
        {
          name: "meta_cli_exec",
          qualifiedName: "otter_core_meta_cli_exec",
          title: "Gọi lệnh Meta CLI qua cầu nối RPC",
          description: "Gọi 1 lệnh Meta CLI (facebook-cli, Messenger, Instagram, Threads, Meta Ads) qua Reverse RPC trên localhost. Dùng khi không có tool chuyên biệt."
        },
        {
          name: "meta_fb_me",
          qualifiedName: "otter_core_meta_fb_me",
          title: "Xem tài khoản Facebook",
          description: "Xem tài khoản Facebook đang đăng nhập (facebook-cli me)."
        },
        {
          name: "meta_fb_feed",
          qualifiedName: "otter_core_meta_fb_feed",
          title: "Đọc bảng tin Facebook",
          description: "Đọc bảng tin Facebook (newsfeed hoặc friends)."
        },
        {
          name: "meta_fb_groups_search",
          qualifiedName: "otter_core_meta_fb_groups_search",
          title: "Tìm nhóm Facebook",
          description: "Tìm nhóm Facebook theo từ khóa."
        },
        {
          name: "meta_fb_post_create",
          qualifiedName: "otter_core_meta_fb_post_create",
          title: "Đăng bài lên trang cá nhân Facebook",
          description: "Đăng 1 bài lên trang cá nhân Facebook (không đăng được lên nhóm)."
        },
        {
          name: "meta_ig_accounts",
          qualifiedName: "otter_core_meta_ig_accounts",
          title: "Liệt kê tài khoản Instagram",
          description: "Liệt kê tài khoản Instagram đã kết nối."
        },
        {
          name: "meta_ig_posts",
          qualifiedName: "otter_core_meta_ig_posts",
          title: "Xem bài đăng Instagram",
          description: "Xem bài đăng Instagram của 1 tài khoản."
        },
        {
          name: "meta_ig_inbox",
          qualifiedName: "otter_core_meta_ig_inbox",
          title: "Đọc hộp thư Instagram",
          description: "Đọc hộp thư Instagram (cần kết nối lại Instagram Messages nếu báo chưa kết nối)."
        },
        {
          name: "meta_th_accounts",
          qualifiedName: "otter_core_meta_th_accounts",
          title: "Liệt kê tài khoản Threads",
          description: "Liệt kê tài khoản Threads đã kết nối."
        },
        {
          name: "meta_th_profile",
          qualifiedName: "otter_core_meta_th_profile",
          title: "Xem profile Threads",
          description: "Xem profile Threads."
        },
        {
          name: "meta_th_post",
          qualifiedName: "otter_core_meta_th_post",
          title: "Đăng bài lên Threads",
          description: "Đăng 1 bài lên Threads."
        },
        {
          name: "meta_ads_status",
          qualifiedName: "otter_core_meta_ads_status",
          title: "Kiểm tra kết nối Meta Ads",
          description: "Kiểm tra kết nối Meta Ads."
        },
        {
          name: "meta_ads_list_tools",
          qualifiedName: "otter_core_meta_ads_list_tools",
          title: "Liệt kê tool Meta Ads",
          description: "Liệt kê các tool Meta Ads có sẵn."
        },
        {
          name: "meta_ads_call_tool",
          qualifiedName: "otter_core_meta_ads_call_tool",
          title: "Gọi tool Meta Ads",
          description: "Gọi 1 tool Meta Ads với tham số JSON."
        },
        {
          name: "meta_msg_chats",
          qualifiedName: "otter_core_meta_msg_chats",
          title: "Liệt kê đoạn chat Messenger",
          description: "Liệt kê đoạn chat Messenger (có thể lọc chưa đọc)."
        },
        {
          name: "meta_msg_send",
          qualifiedName: "otter_core_meta_msg_send",
          title: "Gửi tin nhắn Messenger",
          description: "Gửi 1 tin nhắn Messenger vào đoạn chat hoặc cho 1 người."
        },
        {
          name: "a2a_send_message",
          qualifiedName: "otter_core_a2a_send_message",
          title: "Gửi tin nhắn / task A2A",
          description: "Gửi nhiệm vụ (task) hoặc tin nhắn A2A bền vững trong SQLite (Store-and-Forward) cho bot."
        },
        {
          name: "a2a_pull_inbox",
          qualifiedName: "otter_core_a2a_pull_inbox",
          title: "Rút task từ hàng đợi A2A",
          description: "Rút các task đang chờ xử lý cho bot kèm khóa thuê (lease lock)."
        },
        {
          name: "a2a_ack_message",
          qualifiedName: "otter_core_a2a_ack_message",
          title: "Xác nhận kết quả task A2A",
          description: "Báo cáo kết quả hoàn thành hoặc thất bại kèm dữ liệu kết quả và artifacts."
        },
        {
          name: "a2a_inbox_status",
          qualifiedName: "otter_core_a2a_inbox_status",
          title: "Thống kê hàng đợi A2A",
          description: "Tra cứu thống kê hàng đợi và danh sách nhiệm vụ gần đây."
        },
        {
          name: "a2a_list_bots",
          qualifiedName: "otter_core_a2a_list_bots",
          title: "Danh sách Bot Persona",
          description: "Liệt kê danh sách các Bot Persona trong mạng lưới A2A, khả năng kỹ thuật và hiện diện."
        },
        ...PHONE_TOOL_DEFS.map((t) => ({
          name: t.name,
          qualifiedName: `otter_core_${t.name}`,
          title: t.title,
          description: t.description,
        }))
      ];

    const builtInServer = {
      name: "otter_core",
      status: "connected",
      url: `${serverBaseUrl}/mcp`,
      toolsCount: builtInTools.length,
      tools: builtInTools,
      lastChecked: Date.now(),
      error: null
    };

    return jsonResponse({
      servers: [builtInServer, ...externalServers]
    });
  }

  // 3. Reload External MCP Servers
  if (matchDaemonRoute(url.pathname, "MCP_RELOAD") && req.method === "POST") {
    const updated = await reloadExternalMcpServers();
    return jsonResponse({
      status: "ok",
      servers: updated.map(s => ({
        name: s.name,
        status: s.status,
        toolsCount: s.tools.length
      }))
    });
  }

  // 4. Get/Save Raw MCP Config
  if (matchDaemonRoute(url.pathname, "MCP_CONFIG")) {
    if (req.method === "GET") {
      const config = await loadMcpConfig();
      return jsonResponse(config);
    }
    if (req.method === "POST") {
      try {
        const body = await req.json();
        await saveMcpConfig(body);
        const servers = getExternalServersState();
        return jsonResponse({ status: "ok", serversCount: servers.length });
      } catch (err: any) {
        return errorResponse(err.message, 400);
      }
    }
  }

  // 5. Add or Update Single External MCP Server
  if (matchDaemonRoute(url.pathname, "MCP_SERVERS_ADD") && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.name || !body.url) {
        return errorResponse("Missing required 'name' or 'url'", 400);
      }
      const serverState = await addExternalServer(body.name.trim(), {
        type: body.type || "http",
        url: body.url.trim(),
        headers: body.headers || (body.token ? { Authorization: body.token.startsWith("Bearer ") ? body.token : `Bearer ${body.token}` } : undefined)
      });
      return jsonResponse({ status: "ok", server: serverState });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  // 6. Delete External MCP Server
  if (matchDaemonRoute(url.pathname, "MCP_SERVERS_DEL") && req.method === "POST") {
    try {
      const body: any = await req.json();
      if (!body.name) {
        return errorResponse("Missing required 'name'", 400);
      }
      const removed = await removeExternalServer(body.name);
      return jsonResponse({ status: removed ? "ok" : "not_found" });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  return null;
}
