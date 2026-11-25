import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import defaultOpenApi from "../../../openapi.json";
import { openFolderPicker, openFilePicker } from "../system";
import { registerAllowedWorkspace, isTrustedHostOrIp, getTailscaleIp, isFullAccessEnabled, setFullAccess, getAllowedWorkspaces } from "../security";
import { getExternalToolsOpenApiPaths } from "../mcp-gateway";
import { corsHeaders, jsonResponse, errorResponse } from "./common";
import { getLicenseStatus } from "../license";
import { setTelemetryUser, sendTelemetryHeartbeat, getTelemetryUser } from "../telemetry";
import { getQuickTunnelStatus, startQuickTunnel, stopQuickTunnel, openTunnelInBrowser } from "../tunnel";
import { matchDaemonRoute } from "./lcg-routes";
import { getSettings, updateSettings } from "../settings";
import { EMBEDDED_DASHBOARD_ASSETS } from "../dashboard-assets.generated";
import { OTTER_VERSION } from "../version";

export async function handleSystemRoutes(req: Request, url: URL, port: number): Promise<Response | null> {
  // -1. Public Health Check Endpoint
  if ((url.pathname === "/health" || url.pathname === "/api/health") && req.method === "GET") {
    const tunnel = getQuickTunnelStatus();
    const tailscaleIp = getTailscaleIp();
    const { getExternalServersState } = await import("../mcp-gateway");
    const { getSocialBotStatus } = await import("../social-bot");
    const { getPhoneRelayHealth } = await import("../phone-cloud");
    const ext = getExternalServersState();
    const social = getSocialBotStatus();
    const phone = getPhoneRelayHealth();
    return jsonResponse({
      status: "ok",
      service: "otter-daemon",
      version: OTTER_VERSION,
      platform: process.platform,
      uptime: Math.round(process.uptime()),
      port,
      tailscaleIp: tailscaleIp || null,
      tunnelStatus: tunnel.status,
      socialBotConnected: social.connected,
      phoneCloud: {
        devices: phone.devices,
        online: phone.online,
        viewers: phone.viewers,
      },
      externalMcpServers: {
        total: ext.length,
        connected: ext.filter((s) => s.status === "connected").length,
      },
    }, 200, {}, req);
  }

  // 0. Trạng thái mã nguồn mở & đồng bộ tài khoản người dùng hoạt động
  if (matchDaemonRoute(url.pathname, "SYS_LICENSE") && req.method === "GET") {
    const status = await getLicenseStatus();
    return jsonResponse(status);
  }

  if (matchDaemonRoute(url.pathname, "SYS_LICENSE_ACTIVATE") && req.method === "POST") {
    return jsonResponse({
      success: true,
      message: "Otter hiện miễn phí mã nguồn mở (MIT) và không còn yêu cầu kích hoạt khóa bản quyền.",
    });
  }

  if (url.pathname === "/api/system/telemetry/user" && req.method === "GET") {
    return jsonResponse({ user: getTelemetryUser() });
  }

  if (url.pathname === "/api/system/telemetry/user" && req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const clear = body?.clear === true || (!body?.email && !body?.uid && !body?.displayName);
    if (clear) {
      setTelemetryUser(null);
      void sendTelemetryHeartbeat({ source: "dashboard", clearIdentity: true });
      return jsonResponse({ ok: true, user: null });
    }
    const nextUser = {
      uid: body.uid ? String(body.uid) : null,
      email: body.email ? String(body.email).trim().toLowerCase() : null,
      displayName: body.displayName ? String(body.displayName).trim() : null,
    };
    setTelemetryUser(nextUser);
    void sendTelemetryHeartbeat({ source: "dashboard" });
    return jsonResponse({ ok: true, user: nextUser });
  }

  // 0.1 Quản lý Cloudflare Quick Tunnel tự động (TryCloudflare 1 lần)
  if (matchDaemonRoute(url.pathname, "SYS_TUNNEL") && req.method === "GET") {
    const tunnel = getQuickTunnelStatus();
    const tailscaleIp = getTailscaleIp();
    return jsonResponse({
      ...tunnel,
      tailscaleIp: tailscaleIp || null,
      tailscaleUrl: tailscaleIp ? `http://${tailscaleIp}:${port}` : null,
      tailscaleMcpUrl: tailscaleIp ? `http://${tailscaleIp}:${port}/mcp` : null,
      tailscaleSseUrl: tailscaleIp ? `http://${tailscaleIp}:${port}/sse` : null
    });
  }

  if (matchDaemonRoute(url.pathname, "SYS_TUNNEL_START") && req.method === "POST") {
    try {
      const publicUrl = await startQuickTunnel(port);
      return jsonResponse({
        success: true,
        message: "Quick Tunnel đã được kích hoạt thành công!",
        url: publicUrl,
        mcpUrl: `${publicUrl}/mcp`,
        sseUrl: `${publicUrl}/sse`
      });
    } catch (err: any) {
      return errorResponse(err.message, 500);
    }
  }

  if (matchDaemonRoute(url.pathname, "SYS_TUNNEL_STOP") && req.method === "POST") {
    stopQuickTunnel();
    return jsonResponse({ success: true, message: "Đã dừng Quick Tunnel" });
  }

  if (url.pathname === "/api/system/tunnel/open" && req.method === "POST") {
    const success = openTunnelInBrowser();
    return jsonResponse({ success, status: getQuickTunnelStatus() });
  }

  // 0.2 Quản lý quyền truy cập Full Access (Cho phép tạo dự án và truy cập file tự do)
  if (url.pathname === "/api/system/security/full-access" && req.method === "GET") {
    return jsonResponse({
      fullAccess: isFullAccessEnabled(),
      workspaces: getAllowedWorkspaces(),
      homeDir: os.homedir()
    });
  }

  if (url.pathname === "/api/system/security/full-access" && req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const enabled = Boolean(body?.enabled ?? true);
    setFullAccess(enabled, true);
    return jsonResponse({
      success: true,
      fullAccess: isFullAccessEnabled(),
      workspaces: getAllowedWorkspaces(),
      message: enabled
        ? "Đã bật chế độ Full Access (Cho phép truy cập toàn bộ tệp tin và tạo dự án tự do trên máy tính)"
        : "Đã tắt chế độ Full Access (Chỉ cho phép truy cập các workspace an toàn)"
    });
  }

  // 0.3 Quản lý cấu hình toàn diện & Biến môi trường
  if (url.pathname === "/api/system/settings" && req.method === "GET") {
    return jsonResponse(getSettings());
  }

  if (url.pathname === "/api/system/settings" && req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const updated = updateSettings(body || {});
    return jsonResponse({
      success: true,
      settings: updated,
      message: "Đã cập nhật cấu hình hệ thống thành công"
    });
  }

  // 1. Native Folder Picker
  if (matchDaemonRoute(url.pathname, "SYS_FOLDER_PICKER") && req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const res = await openFolderPicker(body.initialPath);
    if (res.path) {
      registerAllowedWorkspace(res.path);
    }
    return jsonResponse(res);
  }

  // 2. Native File Picker
  if (matchDaemonRoute(url.pathname, "SYS_FILE_PICKER") && req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const res = await openFilePicker(body.initialPath, body.multiple ?? true);
    if (res.paths && res.paths.length > 0) {
      for (const f of res.paths) {
        registerAllowedWorkspace(path.dirname(f));
      }
    }
    return jsonResponse(res);
  }

  // 3. OpenAPI Specification
  if (url.pathname === "/openapi.json") {
    try {
      let json = structuredClone(defaultOpenApi);
      if (fs.existsSync("openapi.json")) {
        try {
          const raw = await Bun.file("openapi.json").text();
          json = JSON.parse(raw);
        } catch {}
      }
      const isTrusted = isTrustedHostOrIp(url.host);
      const proto = req.headers.get("x-forwarded-proto") || (url.protocol.startsWith("https") ? "https" : (isTrusted ? "http" : "https"));
      const serverUrl = `${proto}://${url.host}`;
      json.servers = [
        {
          url: serverUrl,
          description: "Otter Server"
        }
      ];
      const extPaths = getExternalToolsOpenApiPaths();
      json.paths = { ...json.paths, ...extPaths };
      return jsonResponse(json);
    } catch {
      return jsonResponse(defaultOpenApi);
    }
  }

  // 4. Static assets (Logo, Banner) — chặn path traversal ra ngoài assets/
  if (url.pathname.startsWith("/assets/")) {
    let rel = "";
    try {
      rel = decodeURIComponent(url.pathname.slice("/assets/".length));
    } catch {
      return new Response("Bad Request", { status: 400, headers: corsHeaders });
    }
    if (!rel || rel.includes("..") || rel.startsWith("/") || rel.includes("\\")) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }
    const assetsRoot = path.resolve("assets");
    const filePath = path.resolve(assetsRoot, rel);
    if (!filePath.startsWith(assetsRoot + path.sep)) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
                          ext === ".png" ? "image/png" :
                          ext === ".svg" ? "image/svg+xml" : "application/octet-stream";
      return new Response(file, {
        headers: { "Content-Type": contentType, ...corsHeaders }
      });
    }
  }

  // 4.1 Trang Chủ (Landing Page) & User Documentation (/docs)
  if (url.pathname === "/" || url.pathname === "/docs" || url.pathname === "/docs/" || url.pathname === "/docs/index.html") {
    const docsPath = path.join(process.cwd(), "deploy", "docs", "index.html");
    const docsFile = Bun.file(docsPath);
    if (await docsFile.exists()) {
      return new Response(docsFile, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders }
      });
    }
  }

  // 5. OpenAI Plugin Manifest
  if (url.pathname === "/.well-known/ai-plugin.json" && req.method === "GET") {
    const isTrusted = isTrustedHostOrIp(url.host);
    const proto = req.headers.get("x-forwarded-proto") || (url.protocol.startsWith("https") ? "https" : (isTrusted ? "http" : "https"));
    const origin = `${proto}://${url.host}`;
    const authType = process.env.OTTER_AUTH_TYPE || "oauth";
    const authConfig = authType === "oauth" ? {
      type: "oauth",
      client_url: `${origin}/oauth/authorize`,
      scope: "all",
      authorization_url: `${origin}/oauth/token`,
      authorization_content_type: "application/json",
      verification_tokens: {
        openai: "otter-verified-token"
      }
    } : { type: "none" };

    return jsonResponse({
      schema_version: "v1",
      name_for_human: "Otter AI Controller",
      name_for_model: "otter",
      description_for_human: "Trợ lý AI Otter điều khiển máy tính cục bộ, chạy lệnh console, đọc ghi file, và tự động hóa trình duyệt web thông minh.",
      description_for_model: "Plugin for controlling the local desktop, executing terminal commands, reading and writing files, and full browser automation (opening websites, reading current webpage DOM/text, clicking elements, typing text) via Otter. When the user asks to read, analyze, or interact with an open webpage, ALWAYS call browserReadPage without asking for screenshots or links.",
      auth: authConfig,
      api: {
        type: "openapi",
        url: `${origin}/openapi.json`
      },
      logo_url: `${origin}/assets/otter_logo.jpg`,
      contact_email: "support@otter.local",
      legal_info_url: `${origin}/`
    });
  }

  // 5.5 Dashboard mới (React + Astryx) — ưu tiên file rời deploy/dashboard/ (dev),
  //     không có thì phục vụ trực tiếp từ asset đã nhúng sẵn trong binary otter.
  //     Nếu cả hai đều trống thì rơi xuống Dashboard HTML inline cũ ở mục 6.
  if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
    let rel = url.pathname === "/dashboard" || url.pathname === "/dashboard/"
      ? "index.html"
      : url.pathname.slice("/dashboard/".length);
    if (rel === "phong" || rel === "phong/") {
      rel = "phong/index.html";
    } else if (rel.endsWith("/")) {
      rel = `${rel}index.html`;
    }
    // Chặn path traversal: chỉ phục vụ file tương đối an toàn
    if (rel && !rel.includes("..") && !rel.startsWith("/") && !rel.includes("\\")) {
      const dashPath = path.join(process.cwd(), "deploy", "dashboard", rel);
      const dashFile = Bun.file(dashPath);
      if (await dashFile.exists()) {
        const ext = path.extname(dashPath).toLowerCase();
        const contentType = ext === ".html" ? "text/html; charset=utf-8" :
                            ext === ".js" ? "text/javascript; charset=utf-8" :
                            ext === ".css" ? "text/css; charset=utf-8" :
                            ext === ".svg" ? "image/svg+xml" :
                            ext === ".json" ? "application/json" :
                            ext === ".png" ? "image/png" :
                            ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
                            ext === ".ico" ? "image/x-icon" :
                            ext === ".woff" ? "font/woff" :
                            ext === ".woff2" ? "font/woff2" : "application/octet-stream";
        return new Response(dashFile, {
          headers: { "Content-Type": contentType, ...corsHeaders }
        });
      }

      const embedded = Object.prototype.hasOwnProperty.call(EMBEDDED_DASHBOARD_ASSETS, rel)
        ? EMBEDDED_DASHBOARD_ASSETS[rel]
        : undefined;
      if (embedded) {
        const gzBytes = Uint8Array.from(Buffer.from(embedded.gzipBase64, "base64"));
        const cacheControl = rel.startsWith("assets/") || rel.startsWith("phong/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache";
        const acceptsGzip = (req.headers.get("accept-encoding") || "").toLowerCase().includes("gzip");
        if (acceptsGzip) {
          return new Response(gzBytes, {
            headers: {
              "Content-Type": embedded.contentType,
              "Content-Encoding": "gzip",
              "Vary": "Accept-Encoding",
              "Cache-Control": cacheControl,
              ...corsHeaders
            }
          });
        }
        return new Response(Bun.gunzipSync(gzBytes), {
          headers: {
            "Content-Type": embedded.contentType,
            "Cache-Control": cacheControl,
            ...corsHeaders
          }
        });
      }
    }
    if (url.pathname !== "/dashboard" && url.pathname !== "/dashboard/") {
      return errorResponse("Không tìm thấy tài nguyên Dashboard", 404);
    }
    // /dashboard chưa có bản build -> rơi xuống HTML inline cũ bên dưới.
  }

  // 6. Dashboard HTML (Hỗ trợ song ngữ Tiếng Việt & Tiếng Anh)
  if (url.pathname === "/dashboard" || url.pathname === "/status" || url.pathname === "/activity") {
    const tunnel = getQuickTunnelStatus();
    const lic = await getLicenseStatus();
    const tailscaleIp = getTailscaleIp();
    const tailscaleUrl = tailscaleIp ? `http://${tailscaleIp}:${port}` : null;
    const fullAccess = isFullAccessEnabled();

    return new Response(`
      <!doctype html>
      <html lang="vi">
      <head>
        <title>Otter Daemon Dashboard</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #fff; padding: 30px 16px; margin: 0; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 26px; max-width: 680px; margin: auto; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
          .badge { background: #10b981; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 9999px; font-size: 12px; }
          .badge-warn { background: #f59e0b; color: #000; font-weight: bold; padding: 4px 10px; border-radius: 9999px; font-size: 12px; }
          pre { background: #0b0f19; padding: 14px; border-radius: 8px; color: #34d399; overflow-x: auto; font-size: 13px; border: 1px solid #1e293b; }
          a { color: #38bdf8; text-decoration: none; font-weight: 600; }
          .feature { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 14px; color: #94a3b8; }
          .feature strong { color: #f8fafc; }
          .tunnel-box { background: #0b0f19; border: 1px solid #3b82f6; border-radius: 12px; padding: 16px; margin: 18px 0; }
          button { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; font-family: inherit; }
          button:hover { background: #2563eb; }
          .lang-btn { background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid #475569; padding: 4px 10px; font-size: 12px; border-radius: 6px; cursor: pointer; }
          .lang-btn.active { background: #38bdf8; color: #0f172a; font-weight: bold; border-color: #38bdf8; }
          .tg-box { background: #0b0f19; border: 1px solid #475569; border-radius: 12px; padding: 16px; margin: 18px 0; }
          .tg-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #1e293b; }
          .tg-row:last-child { border-bottom: none; }
          .tg-info { flex: 1; min-width: 0; }
          .tg-name { font-size: 14px; font-weight: 700; color: #f8fafc; }
          .tg-desc { font-size: 12px; color: #94a3b8; margin-top: 2px; }
          .tg-meta { font-size: 12px; color: #38bdf8; white-space: nowrap; }
          .tg-switch { position: relative; width: 44px; height: 24px; flex-shrink: 0; }
          .tg-switch input { opacity: 0; width: 0; height: 0; }
          .tg-slider { position: absolute; cursor: pointer; inset: 0; background: #475569; border-radius: 9999px; transition: 0.2s; }
          .tg-slider:before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: 0.2s; }
          .tg-switch input:checked + .tg-slider { background: #10b981; }
          .tg-switch input:checked + .tg-slider:before { transform: translateX(20px); }
          .tg-preset { background: #334155; padding: 6px 12px; font-size: 12px; }
          .tg-summary { font-size: 13px; color: #cbd5e1; margin: 10px 0 4px; }
          .tg-summary strong { color: #34d399; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div style="display:flex; gap:8px; align-items:center;">
              <span class="badge" data-i18n="badge_online">ONLINE</span>
              <span class="badge">🔓 MIT OPEN SOURCE</span>
              <span class="${fullAccess ? 'badge' : 'badge-warn'}">⚡ <span>${fullAccess ? 'FULL ACCESS' : 'RESTRICTED'}</span></span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="lang-btn" id="btn-vi" onclick="setLang('vi')">🇻🇳 Tiếng Việt</button>
              <button class="lang-btn" id="btn-en" onclick="setLang('en')">🇬🇧 English</button>
            </div>
          </div>

          <h2 data-i18n="heading">🦦 Otter Agent — Desktop, Browser & PhoneCloud Controller</h2>
          <p><span data-i18n="running_on">Máy chủ Otter Daemon đang hoạt động trên cổng</span> <strong>${port}</strong>.</p>
          
          <div class="tunnel-box">
            <h4 style="margin:0 0 8px 0; color:#60a5fa;" data-i18n="tunnel_heading">🌐 Cloudflare Quick Tunnel (Miễn phí 1 lần - 0 Cấu hình)</h4>
            ${tunnel.url ? `
              <p style="margin:4px 0; font-size:13px; color:#cbd5e1;" data-i18n="tunnel_active">URL Công khai hiện tại:</p>
              <pre style="margin:8px 0; color:#38bdf8;">${tunnel.url}</pre>
              <p style="margin:4px 0; font-size:12px; color:#94a3b8;">🔗 MCP Endpoint: <code>${tunnel.url}/mcp</code></p>
              <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                <a href="${tunnel.url}" target="_blank" rel="noopener noreferrer" style="background:#10b981; color:#000; text-decoration:none; padding:8px 16px; border-radius:8px; font-weight:bold; display:inline-flex; align-items:center; gap:6px;" data-i18n="tunnel_open">🌐 Mở Tunnel</a>
                <button onclick="navigator.clipboard.writeText('${tunnel.url}'); this.innerText='Đã sao chép!'; setTimeout(()=>this.innerText='📋 Sao chép', 2000)" style="background:#334155;" data-i18n="tunnel_copy">📋 Sao chép</button>
                <button onclick="fetch('/api/system/tunnel/stop', {method:'POST'}).then(()=>location.reload())" style="background:#ef4444;" data-i18n="tunnel_stop">🛑 Dừng Quick Tunnel</button>
              </div>
            ` : `
              <p style="margin:4px 0; font-size:13px; color:#94a3b8;" data-i18n="tunnel_inactive">Chưa bật Quick Tunnel. Bạn có thể bật chỉ với 1 click để có domain HTTPS dùng tạm:</p>
              <button onclick="this.disabled=true; this.innerText='Connecting...'; fetch('/api/system/tunnel/start', {method:'POST'}).then(()=>location.reload())" style="margin-top:8px;" data-i18n="tunnel_start">🚀 Mở / Bật Cloudflare Quick Tunnel</button>
            `}
          </div>

          ${tailscaleIp ? `
          <div class="tunnel-box" style="border-color: #10b981; background: #06201b;">
            <h4 style="margin:0 0 8px 0; color:#34d399;" data-i18n="ts_heading">🦎 Mạng Tailscale WireGuard (Bảo mật Cao)</h4>
            <p style="margin:4px 0; font-size:13px; color:#cbd5e1;"><span data-i18n="ts_ip_label">IP Tailscale máy chủ:</span> <strong style="color:#38bdf8;">${tailscaleIp}</strong></p>
            <pre style="margin:8px 0; color:#34d399;">${tailscaleUrl}&#10;MCP: ${tailscaleUrl}/mcp&#10;SSE: ${tailscaleUrl}/sse</pre>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
              <button onclick="navigator.clipboard.writeText('${tailscaleUrl}'); this.innerText='Đã sao chép!'; setTimeout(()=>this.innerText='📋 Sao chép URL', 2000)" style="background:#059669;" data-i18n="ts_copy_url">📋 Sao chép URL</button>
              <button onclick="navigator.clipboard.writeText('${tailscaleUrl}/mcp'); this.innerText='Đã sao chép!'; setTimeout(()=>this.innerText='📋 Sao chép MCP', 2000)" style="background:#334155;" data-i18n="ts_copy_mcp">📋 Sao chép MCP</button>
            </div>
          </div>
          ` : ""}

          <div class="feature">⚡ <span data-i18n="f_full_access"><strong>Quyền tệp tin & dự án:</strong></span> <span style="color:${fullAccess ? '#34d399' : '#f59e0b'}; font-weight:700;">${fullAccess ? 'Toàn quyền (Full Access)' : 'Giới hạn trong Workspace'}</span> <button onclick="toggleFullAccess(!${fullAccess})" style="padding:2px 10px; font-size:12px; margin-left:8px; background:${fullAccess ? '#ef4444' : '#10b981'};">${fullAccess ? 'Tắt Full Access' : 'Bật Full Access'}</button></div>
          <div class="feature">✅ <span data-i18n="f_dom"><strong>Alibaba Page Agent DOM:</strong> Nén DOM thông minh, phân tích sâu Shadow DOM & iframe</span></div>
          <div class="feature">✅ <span data-i18n="f_hwid"><strong>Mã thiết bị (Support Code):</strong></span> <code>${lic.supportCode}</code></div>
          <div class="feature">✅ <span data-i18n="f_hud"><strong>Interactive HUD & Inspector:</strong> Viền sáng trạng thái và di chuột soi phần tử</span></div>
          <div class="feature">✅ <span data-i18n="f_term"><strong>Live Persistent Terminal:</strong> Tích hợp stream PTY và xterm liên tục</span></div>
          <div class="feature">✅ <span data-i18n="f_sub"><strong>Continuous Mode:</strong> Phối hợp sub-agent liên tục không ngắt quãng</span></div>
          <div class="feature">💬 <span data-i18n="f_community"><strong>Cộng đồng Facebook:</strong> <a href="https://www.facebook.com/share/g/1CN8sjFYDH/?mibextid=wwXIfr" target="_blank" style="color:#60a5fa; text-decoration:none;">Tham gia nhóm hỗ trợ Otter</a></span></div>
          <div class="feature">📖 <a href="/docs" target="_blank" style="color:#34d399; font-weight:700; text-decoration:none;">🌟 Xem Trang Giới Thiệu & Hướng Dẫn Sử Dụng (/docs) ➔</a></div>

          <div class="tg-box">
            <h4 style="margin:0 0 6px 0; color:#e2e8f0;" data-i18n="tg_heading">🧩 Nhóm MCP Tools (Bật/Tắt để nhẹ hơn)</h4>
            <p style="margin:4px 0 10px; font-size:13px; color:#94a3b8;" data-i18n="tg_desc">Tắt các nhóm không dùng để giảm token schema nạp vào AI mỗi phiên. Thay đổi áp dụng ngay cho các phiên MCP đang kết nối.</p>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
              <button class="tg-preset" onclick="applyToolPreset('all')" data-i18n="tg_preset_all">Bật tất cả</button>
              <button class="tg-preset" onclick="applyToolPreset('minimal')" data-i18n="tg_preset_minimal">Tối thiểu</button>
              <button class="tg-preset" onclick="applyToolPreset('code')" data-i18n="tg_preset_code">Chỉ Code</button>
              <button class="tg-preset" onclick="applyToolPreset('fb')" data-i18n="tg_preset_fb">Chỉ Facebook</button>
            </div>
            <div class="tg-summary" id="tg-summary">…</div>
            <div id="tg-list"></div>
          </div>

          <div class="tg-box">
            <h4 style="margin:0 0 6px 0; color:#e2e8f0;" data-i18n="upd_heading">⬆️ Cập Nhật Daemon</h4>
            <div class="tg-summary" id="upd-summary">…</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
              <button class="tg-preset" onclick="checkUpdateNow()" data-i18n="upd_check">Kiểm tra cập nhật</button>
              <button class="tg-preset" id="upd-apply" onclick="applyUpdateNow()" data-i18n="upd_apply" style="display:none; background:#059669; color:#fff;">Cập nhật ngay</button>
            </div>
          </div>

          <div class="tg-box">
            <h4 style="margin:0 0 6px 0; color:#e2e8f0;" data-i18n="oauth_heading">🔐 AI Đã Kết Nối (OAuth)</h4>
            <p style="margin:4px 0 10px; font-size:13px; color:#94a3b8;" data-i18n="oauth_desc">Các AI/ứng dụng đã được cấp quyền qua OAuth. Thu hồi sẽ ngắt kết nối của ứng dụng đó ngay lập tức.</p>
            <div id="oauth-list" style="display:flex; flex-direction:column; gap:6px;">…</div>
          </div>

          <p><strong data-i18n="endpoints_title">Điểm cuối kết nối (Endpoints):</strong></p>
          <pre>SSE: /sse&#10;Streamable HTTP: /mcp&#10;WebSocket: ws://${url.host}/api/activity/v1/stream</pre>
          <p><span data-i18n="openapi_label">Tài liệu OpenAPI:</span> <a href="/openapi.json" target="_blank">/openapi.json</a></p>
        </div>

        <script>
          const i18nData = {
            vi: {
              badge_online: "ONLINE",
              lic_ok: "${lic.licensed ? 'BẢN QUYỀN: ' + (lic.payload?.license_type?.toUpperCase() || 'OK') : 'CHƯA KÍCH HOẠT'}",
              lic_no: "CHƯA KÍCH HOẠT",
              heading: "🦦 Otter Pro Agent & Browser Controller",
              running_on: "Máy chủ Otter Daemon đang hoạt động trên cổng",
              tunnel_heading: "🌐 Cloudflare Quick Tunnel (Miễn phí 1 lần - 0 Cấu hình)",
              tunnel_active: "URL Công khai hiện tại:",
              tunnel_inactive: "Chưa bật Quick Tunnel. Bạn có thể bật chỉ với 1 click để có domain HTTPS dùng tạm:",
              tunnel_start: "🚀 Mở / Bật Cloudflare Quick Tunnel",
              tunnel_open: "🌐 Mở Tunnel",
              tunnel_copy: "📋 Sao chép URL",
              tunnel_stop: "🛑 Dừng Quick Tunnel",
              ts_heading: "🦎 Mạng Tailscale WireGuard (Bảo mật Cao)",
              ts_ip_label: "IP Tailscale máy chủ:",
              ts_copy_url: "📋 Sao chép URL",
              ts_copy_mcp: "📋 Sao chép MCP",
              f_full_access: "<strong>Quyền tệp tin & dự án:</strong>",
              f_dom: "<strong>Alibaba Page Agent DOM:</strong> Nén DOM thông minh, phân tích sâu Shadow DOM & iframe",
              f_hwid: "<strong>Mã thiết bị (Support Code):</strong>",
              f_hud: "<strong>Interactive HUD & Inspector:</strong> Viền sáng trạng thái và di chuột soi phần tử",
              f_term: "<strong>Live Persistent Terminal:</strong> Tích hợp stream PTY và xterm liên tục",
              f_sub: "<strong>Continuous Mode:</strong> Phối hợp sub-agent liên tục không ngắt quãng",
              f_community: "<strong>Cộng đồng Facebook:</strong> <a href=\"https://www.facebook.com/share/g/1CN8sjFYDH/?mibextid=wwXIfr\" target=\"_blank\" style=\"color:#60a5fa; text-decoration:none;\">Tham gia nhóm hỗ trợ Otter</a>",
              tg_heading: "🧩 Nhóm MCP Tools (Bật/Tắt để nhẹ hơn)",
              tg_desc: "Tắt các nhóm không dùng để giảm token schema nạp vào AI mỗi phiên. Thay đổi áp dụng ngay cho các phiên MCP đang kết nối.",
              tg_preset_all: "Bật tất cả",
              tg_preset_minimal: "Tối thiểu",
              tg_preset_code: "Chỉ Code",
              tg_preset_fb: "Chỉ Facebook",
              upd_heading: "⬆️ Cập Nhật Daemon",
              upd_check: "Kiểm tra cập nhật",
              upd_apply: "Cập nhật ngay",
              oauth_heading: "🔐 AI Đã Kết Nối (OAuth)",
              oauth_desc: "Các AI/ứng dụng đã được cấp quyền qua OAuth. Thu hồi sẽ ngắt kết nối của ứng dụng đó ngay lập tức.",
              endpoints_title: "Điểm cuối kết nối (Endpoints):",
              openapi_label: "Tài liệu OpenAPI:"
            },
            en: {
              badge_online: "ONLINE",
              lic_ok: "${lic.licensed ? 'LICENSE: ' + (lic.payload?.license_type?.toUpperCase() || 'OK') : 'UNLICENSED'}",
              lic_no: "UNLICENSED",
              heading: "🦦 Otter Pro Agent & Browser Controller",
              running_on: "Otter Daemon server is active and running on port",
              tunnel_heading: "🌐 Cloudflare Quick Tunnel (Ephemeral Free - Zero Config)",
              tunnel_active: "Current Public HTTPS URL:",
              tunnel_inactive: "Quick Tunnel is not running. Start it with 1 click to get a temporary public HTTPS domain:",
              tunnel_start: "🚀 Start / Open Cloudflare Quick Tunnel",
              tunnel_open: "🌐 Open Tunnel",
              tunnel_copy: "📋 Copy URL",
              tunnel_stop: "🛑 Stop Quick Tunnel",
              ts_heading: "🦎 Tailscale WireGuard Network (Encrypted)",
              ts_ip_label: "Server Tailscale IP:",
              ts_copy_url: "📋 Copy URL",
              ts_copy_mcp: "📋 Copy MCP",
              f_full_access: "<strong>File & Project Access:</strong>",
              f_dom: "<strong>Alibaba Page Agent DOM:</strong> Smart DOM compression, deep Shadow DOM & iframe parsing",
              f_hwid: "<strong>Hardware ID (Support Code):</strong>",
              f_hud: "<strong>Interactive HUD & Inspector:</strong> Real-time highlight border and element inspector",
              f_term: "<strong>Live Persistent Terminal:</strong> Continuous PTY streaming and xterm integration",
              f_sub: "<strong>Continuous Mode:</strong> Uninterrupted sub-agent coordination",
              f_community: "<strong>Facebook Community:</strong> <a href=\"https://www.facebook.com/share/g/1CN8sjFYDH/?mibextid=wwXIfr\" target=\"_blank\" style=\"color:#60a5fa; text-decoration:none;\">Join Otter Support Group</a>",
              tg_heading: "🧩 MCP Tool Groups (Toggle for a lighter load)",
              tg_desc: "Turn off unused groups to reduce schema tokens loaded into the AI each session. Changes apply immediately to connected MCP sessions.",
              tg_preset_all: "Enable all",
              tg_preset_minimal: "Minimal",
              tg_preset_code: "Code only",
              tg_preset_fb: "Facebook only",
              upd_heading: "⬆️ Daemon Updates",
              upd_check: "Check for updates",
              upd_apply: "Update now",
              oauth_heading: "🔐 Connected AIs (OAuth)",
              oauth_desc: "AIs/apps granted access via OAuth. Revoking disconnects that app immediately.",
              endpoints_title: "Connection Endpoints:",
              openapi_label: "OpenAPI Documentation:"
            }
          };

          function toggleFullAccess(enabled) {
            fetch('/api/system/security/full-access', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ enabled })
            }).then(r => r.json()).then(res => {
              alert(res.message);
              location.reload();
            }).catch(e => alert(e.message));
          }

          var tgState = null;
          function tgLang() { return document.documentElement.lang === 'en' ? 'en' : 'vi'; }
          function tgRender() {
            if (!tgState) return;
            var lang = tgLang();
            var list = document.getElementById('tg-list');
            var summary = document.getElementById('tg-summary');
            if (!list || !summary) return;
            var html = '';
            tgState.groups.forEach(function(g) {
              var name = lang === 'en' ? g.nameEn : g.nameVi;
              var desc = lang === 'en' ? g.descEn : g.descVi;
              var meta = g.toolCount + ' tools · ~' + g.estTokens.toLocaleString() + ' tokens';
              html += '<div class="tg-row">'
                + '<div class="tg-info"><div class="tg-name">' + name + '</div>'
                + '<div class="tg-desc">' + desc + '</div></div>'
                + '<div class="tg-meta">' + meta + '</div>'
                + '<label class="tg-switch"><input type="checkbox" ' + (g.enabled ? 'checked' : '')
                + ' onchange="toggleToolGroup(\'' + g.id + '\', this.checked)">'
                + '<span class="tg-slider"></span></label></div>';
            });
            list.innerHTML = html;
            var saved = tgState.totalEstTokens - tgState.enabledEstTokens;
            summary.innerHTML = (lang === 'en'
              ? 'Enabled: <strong>' + tgState.enabledTools + '/' + tgState.totalTools + ' tools</strong> · ~' + tgState.enabledEstTokens.toLocaleString() + ' tokens (saved ~' + saved.toLocaleString() + ')'
              : 'Đang bật: <strong>' + tgState.enabledTools + '/' + tgState.totalTools + ' tools</strong> · ~' + tgState.enabledEstTokens.toLocaleString() + ' tokens (đã giảm ~' + saved.toLocaleString() + ')');
          }
          function loadToolGroups() {
            fetch('/api/tool-groups').then(function(r) { return r.json(); }).then(function(res) {
              tgState = res;
              tgRender();
            }).catch(function(e) {
              var summary = document.getElementById('tg-summary');
              if (summary) summary.textContent = '⚠️ ' + e.message;
            });
          }
          function toggleToolGroup(id, enabled) {
            fetch('/api/tool-groups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ group: id, enabled: enabled })
            }).then(function(r) { return r.json(); }).then(function(res) {
              tgState = res;
              tgRender();
            }).catch(function(e) { alert(e.message); loadToolGroups(); });
          }
          function applyToolPreset(preset) {
            if (!tgState) return;
            var keep = { all: null, minimal: ['core', 'browser'], code: ['core', 'code', 'agents', 'skills'], fb: ['core', 'browser', 'fb', 'meta'] }[preset];
            var groups = {};
            tgState.groups.forEach(function(g) { groups[g.id] = keep === null ? true : keep.indexOf(g.id) >= 0; });
            fetch('/api/tool-groups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groups: groups })
            }).then(function(r) { return r.json(); }).then(function(res) {
              tgState = res;
              tgRender();
            }).catch(function(e) { alert(e.message); });
          }

          function setLang(lang) {
            localStorage.setItem("otter_lang", lang);
            document.querySelectorAll(".lang-btn").forEach(b => b.classList.remove("active"));
            const btn = document.getElementById("btn-" + lang);
            if (btn) btn.classList.add("active");

            const dict = i18nData[lang] || i18nData.vi;
            document.querySelectorAll("[data-i18n]").forEach(el => {
              const key = el.getAttribute("data-i18n");
              if (dict[key]) {
                el.innerHTML = dict[key];
              }
            });
            document.documentElement.lang = lang;
            tgRender();
          }

          function updRender(st) {
            var box = document.getElementById('upd-summary');
            var applyBtn = document.getElementById('upd-apply');
            if (!box) return;
            var en = tgLang() === 'en';
            var html = (en ? 'Current version: <strong>v' : 'Phiên bản hiện tại: <strong>v') + st.currentVersion + '</strong>';
            if (st.updateAvailable && st.latestVersion) {
              html += (en ? ' · New version: <strong>v' : ' · Bản mới: <strong>v') + st.latestVersion + '</strong>';
              if (st.mandatory) html += en ? ' (mandatory)' : ' (bắt buộc)';
              if (st.changelog) html += '<br><span style="color:#94a3b8;">' + st.changelog + '</span>';
              if (applyBtn) applyBtn.style.display = st.isCompiledBinary ? '' : 'none';
              if (!st.isCompiledBinary) html += '<br><span style="color:#f59e0b;">' + (en ? 'Dev build: update via git pull / build:exe.' : 'Bản dev: cập nhật bằng git pull / build:exe.') + '</span>';
            } else if (st.lastCheckedAt) {
              html += en ? ' · You are on the latest version.' : ' · Bạn đang dùng bản mới nhất.';
              if (applyBtn) applyBtn.style.display = 'none';
            }
            if (st.autoUpdateEnabled) html += '<br><span style="color:#94a3b8;">' + (en ? 'Auto-update: ON (OTTER_AUTO_UPDATE=1)' : 'Tự động cập nhật: BẬT (OTTER_AUTO_UPDATE=1)') + '</span>';
            if (st.lastError) html += '<br><span style="color:#f87171;">' + (en ? 'Last check failed: ' : 'Lần kiểm tra gần nhất lỗi: ') + st.lastError + '</span>';
            box.innerHTML = html;
          }
          function loadUpdateStatus() {
            fetch('/api/update/status').then(function(r) { return r.json(); }).then(function(st) { updRender(st); }).catch(function() {});
          }
          function checkUpdateNow() {
            var box = document.getElementById('upd-summary');
            if (box) box.innerHTML = tgLang() === 'en' ? 'Checking…' : 'Đang kiểm tra…';
            fetch('/api/update/check', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(st) { updRender(st); }).catch(function(e) { alert(e.message); loadUpdateStatus(); });
          }
          function applyUpdateNow() {
            if (!confirm(tgLang() === 'en' ? 'Download and install the update now? The daemon will restart.' : 'Tải và cài bản cập nhật ngay? Daemon sẽ khởi động lại.')) return;
            fetch('/api/update/apply', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(res) {
              alert(res.message || res.error || 'OK');
              setTimeout(function() { location.reload(); }, 4000);
            }).catch(function(e) { alert(e.message); });
          }

          function loadOAuthClients() {
            fetch('/api/oauth/clients').then(function(r) { return r.json(); }).then(function(res) {
              var box = document.getElementById('oauth-list');
              if (!box) return;
              var en = tgLang() === 'en';
              var clients = res.clients || [];
              if (!clients.length) {
                box.innerHTML = '<span style="color:#94a3b8; font-size:13px;">' + (en ? 'No OAuth clients yet.' : 'Chưa có AI nào kết nối qua OAuth.') + '</span>';
                return;
              }
              var html = '';
              clients.forEach(function(c) {
                var meta = c.activeTokens + (en ? ' active token(s)' : ' token đang hiệu lực');
                if (c.lastIssuedAt) meta += ' · ' + new Date(c.lastIssuedAt).toLocaleDateString();
                html += '<div class="tg-row">'
                  + '<div class="tg-info"><div class="tg-name">' + c.clientName + '</div>'
                  + '<div class="tg-desc">' + c.clientId + '</div></div>'
                  + '<div class="tg-meta">' + meta + '</div>'
                  + '<button class="tg-preset" style="background:#7f1d1d; color:#fecaca;" onclick="revokeOAuthClient(\'' + c.clientId + '\')">' + (en ? 'Revoke' : 'Thu hồi') + '</button></div>';
              });
              box.innerHTML = html;
            }).catch(function() {});
          }
          function revokeOAuthClient(clientId) {
            if (!confirm(tgLang() === 'en' ? 'Revoke this client? It will be disconnected immediately.' : 'Thu hồi client này? Kết nối của nó sẽ bị ngắt ngay.')) return;
            fetch('/api/oauth/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId }) })
              .then(function(r) { return r.json(); }).then(function() { loadOAuthClients(); }).catch(function(e) { alert(e.message); });
          }

          const savedLang = localStorage.getItem("otter_lang") || (navigator.language.startsWith("vi") ? "vi" : "en");
          setLang(savedLang);
          loadToolGroups();
          loadUpdateStatus();
          loadOAuthClients();
        </script>
      </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders }
    });
  }

  return null;
}
