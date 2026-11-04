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
import { matchDaemonRoute, matchDaemonRoutePrefix, getDaemonRoute } from "./lcg-routes";
import { browserBridge } from "../browser-bridge";
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
      if (toolName === "browser_engine_status") {
        if (body.mode) {
          browserBridge.setEngineMode(body.mode);
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
          additionArgs: body.additionArgs,
          loadOtterExtension: body.loadOtterExtension !== false
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

    const builtInServer = {
      name: "otter_core",
      status: "connected",
      url: `http://127.0.0.1:${process.env.PORT || 1993}/mcp`,
      toolsCount: 14,
      tools: [
        {
          name: "browser_engine_status",
          qualifiedName: "otter_core_browser_engine_status",
          title: "Trạng thái 2 động cơ trình duyệt (Extension vs CDP)",
          description: "Kiểm tra kết nối của Extension và CDP port 9222, đo đạc tốc độ benchmark và chuyển đổi linh hoạt chế độ."
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
          description: "Mở profile GPM Login kèm cổng CDP và nạp extension Otter."
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
        }
      ],
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
