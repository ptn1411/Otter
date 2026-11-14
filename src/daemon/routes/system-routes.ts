import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import defaultOpenApi from "../../../openapi.json";
import { openFolderPicker, openFilePicker } from "../system";
import { registerAllowedWorkspace, isTrustedHostOrIp, getTailscaleIp, isFullAccessEnabled, setFullAccess, getAllowedWorkspaces } from "../security";
import { getExternalToolsOpenApiPaths } from "../mcp-gateway";
import { corsHeaders, jsonResponse, errorResponse } from "./common";
import { getLicenseStatus, activateLicense } from "../license";
import { activateOnline, DEFAULT_LICENSE_SERVER_URL } from "../license/hybrid-client";
import { getQuickTunnelStatus, startQuickTunnel, stopQuickTunnel, openTunnelInBrowser } from "../tunnel";
import { matchDaemonRoute } from "./lcg-routes";

export async function handleSystemRoutes(req: Request, url: URL, port: number): Promise<Response | null> {
  // 0. Quản lý bản quyền (Licensing)
  if (matchDaemonRoute(url.pathname, "SYS_LICENSE") && req.method === "GET") {
    const status = await getLicenseStatus();
    return jsonResponse(status);
  }

  if (matchDaemonRoute(url.pathname, "SYS_LICENSE_ACTIVATE") && req.method === "POST") {
    let body: any = {};
    try { body = await req.json(); } catch {}
    const rawKey = (body?.key || "").trim();
    if (!rawKey) {
      return errorResponse("Thiếu license key", 400);
    }

    if (rawKey.toUpperCase().startsWith("OTTER-")) {
      const onlineRes = await activateOnline({
        serverUrl: body.serverUrl || DEFAULT_LICENSE_SERVER_URL,
        email: (body.email || "").trim(),
        licenseKey: rawKey
      });
      if (onlineRes.success) {
        return jsonResponse({
          success: true,
          message: "Kích hoạt bản quyền trực tuyến thành công!",
          payload: onlineRes.payload
        });
      } else {
        return errorResponse(onlineRes.error || "Kích hoạt trực tuyến thất bại", 400);
      }
    }

    const result = await activateLicense(rawKey);
    if (result.success) {
      return jsonResponse({
        success: true,
        message: "Kích hoạt bản quyền thành công!",
        payload: result.payload
      });
    } else {
      return errorResponse(result.error || "Kích hoạt bản quyền thất bại", 400);
    }
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

  // 4. Static assets (Logo, Banner)
  if (url.pathname.startsWith("/assets/")) {
    const filePath = path.join(".", url.pathname);
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
        </style>
      </head>
      <body>
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div style="display:flex; gap:8px; align-items:center;">
              <span class="badge" data-i18n="badge_online">ONLINE</span>
              <span class="${lic.licensed ? 'badge' : 'badge-warn'}">🔒 <span data-i18n="${lic.licensed ? 'lic_ok' : 'lic_no'}">${lic.licensed ? 'BẢN QUYỀN: ' + (lic.payload?.license_type?.toUpperCase() || 'OK') : 'CHƯA KÍCH HOẠT'}</span></span>
              <span class="${fullAccess ? 'badge' : 'badge-warn'}">⚡ <span>${fullAccess ? 'FULL ACCESS' : 'RESTRICTED'}</span></span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="lang-btn" id="btn-vi" onclick="setLang('vi')">🇻🇳 Tiếng Việt</button>
              <button class="lang-btn" id="btn-en" onclick="setLang('en')">🇬🇧 English</button>
            </div>
          </div>

          <h2 data-i18n="heading">🦦 Otter Pro Agent & Browser Controller</h2>
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
          }

          const savedLang = localStorage.getItem("otter_lang") || (navigator.language.startsWith("vi") ? "vi" : "en");
          setLang(savedLang);
        </script>
      </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders }
    });
  }

  return null;
}
