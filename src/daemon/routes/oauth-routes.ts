/**
 * OAuth 2.0 / 2.1 Provider Routes for OpenAI Plugins & ChatGPT Custom GPT Actions
 * Complies with RFC 6749, RFC 7636 (PKCE S256), RFC 8414, RFC 9207 (iss), RFC 9728
 *
 * Bản sửa bảo mật 2026-11-21:
 * - Refresh token bắt buộc đối chiếu hash + xoay vòng (trước đây trả token chủ vô điều kiện).
 * - Access token sinh riêng từng client, lưu hash, thu hồi được (không dùng token chủ).
 * - Consent bắt buộc nhập Auth Token của chủ máy; auto_approve chỉ còn cho mạng tin cậy.
 * - Validate redirect_uri (https hoặc localhost; khớp danh sách đã đăng ký nếu có).
 * - Rate limit cho /oauth/authorize (POST) và /oauth/token.
 */
import * as crypto from "node:crypto";
import { getAuthToken, isTrustedHostOrIp } from "../security";
import { getCorsHeaders, jsonResponse } from "./common";
import { matchDaemonRoute } from "./lcg-routes";
import { allowLicenseRequest } from "../license/rate-limit";
import {
  registerOAuthClient,
  isRedirectUriAllowed,
  isValidRedirectUri,
  issueOAuthTokens,
  rotateOAuthRefreshToken,
  revokeOAuthClient,
  listOAuthClients,
} from "../oauth-store";

export interface AuthCodeRecord {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  scope?: string;
  expiresAt: number;
}

// In-memory store for authorization codes (TTL 10 minutes)
const authCodeStore = new Map<string, AuthCodeRecord>();

export function clearExpiredAuthCodes(): void {
  const now = Date.now();
  for (const [code, record] of authCodeStore.entries()) {
    if (record.expiresAt <= now) {
      authCodeStore.delete(code);
    }
  }
}

export function saveAuthCode(record: AuthCodeRecord): void {
  clearExpiredAuthCodes();
  authCodeStore.set(record.code, record);
}

export function getAuthCode(code: string): AuthCodeRecord | undefined {
  clearExpiredAuthCodes();
  return authCodeStore.get(code);
}

export function consumeAuthCode(code: string): AuthCodeRecord | undefined {
  const record = getAuthCode(code);
  if (record) {
    authCodeStore.delete(code);
  }
  return record;
}

export function getCanonicalOrigin(req: Request, url: URL): string {
  const proto = req.headers.get("x-forwarded-proto") ||
    (url.protocol.startsWith("https") ? "https" : (url.host.includes("localhost") || url.host.includes("127.0.0.1") ? "http" : "https"));
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

/** Request đến từ mạng tin cậy (localhost/Tailscale/LAN) — cùng logic với isRequestAuthorized. */
function isTrustedRequest(req: Request, url: URL): boolean {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const ip = getClientIp(req);
  const isHostTrusted = isTrustedHostOrIp(host);
  const isClientTrusted = ip !== "unknown" ? isTrustedHostOrIp(ip) : isHostTrusted;
  return isHostTrusted && isClientTrusted;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Xử lý các routes OAuth và Discovery Metadata
 */
export async function handleOAuthRoutes(req: Request, url: URL): Promise<Response | null> {
  const origin = getCanonicalOrigin(req, url);

  // 1. Protected Resource Metadata (RFC 9728 - MCP Authorization Spec)
  if (url.pathname === "/.well-known/oauth-protected-resource" && req.method === "GET") {
    return jsonResponse({
      resource: origin,
      authorization_servers: [origin],
      scopes_supported: ["all"],
      resource_documentation: `${origin}/`
    }, 200, {}, req);
  }

  // 2. Authorization Server Metadata (RFC 8414 & OpenID Connect Discovery)
  if ((url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration") && req.method === "GET") {
    return jsonResponse({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      code_challenge_methods_supported: ["S256"],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      scopes_supported: ["all"]
    }, 200, {}, req);
  }

  // 3. Dynamic Client Registration (RFC 7591 - DCR Endpoint)
  if (url.pathname === "/oauth/register" && req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const clientName = body.client_name || "ChatGPT Client";
    const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const tokenEndpointAuthMethod = body.token_endpoint_auth_method || "none";

    // Chỉ chấp nhận redirect_uri https hoặc http://localhost (RFC 8252).
    const invalidUri = redirectUris.find((u) => !isValidRedirectUri(u));
    if (invalidUri) {
      return jsonResponse(
        { error: "invalid_redirect_uri", error_description: `redirect_uri không hợp lệ (chỉ https hoặc http://localhost): ${invalidUri}` },
        400, {}, req
      );
    }

    const client = registerOAuthClient(clientName, redirectUris);

    return jsonResponse({
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      client_id_issued_at: Math.floor(client.createdAt / 1000)
    }, 201, {}, req);
  }

  // 4. OAuth Authorize (GET: Hiển thị Consent Screen hoặc auto-approve)
  if (url.pathname === "/oauth/authorize" && req.method === "GET") {
    const clientId = url.searchParams.get("client_id") || "chatgpt";
    const redirectUri = url.searchParams.get("redirect_uri") || "";
    const responseType = url.searchParams.get("response_type") || "code";
    const state = url.searchParams.get("state") || "";
    const codeChallenge = url.searchParams.get("code_challenge") || undefined;
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") || undefined;
    const scope = url.searchParams.get("scope") || "all";
    const autoApprove = url.searchParams.get("auto_approve") === "1" || url.searchParams.get("auto_approve") === "true";

    if (!redirectUri) {
      return new Response("Missing redirect_uri parameter", { status: 400, headers: getCorsHeaders(req) });
    }

    if (!isRedirectUriAllowed(clientId, redirectUri)) {
      return new Response("redirect_uri không hợp lệ hoặc không nằm trong danh sách đã đăng ký của client", {
        status: 400,
        headers: getCorsHeaders(req),
      });
    }

    // auto_approve chỉ còn hiệu lực với request từ mạng tin cậy (localhost/Tailscale/LAN).
    // Từ internet công khai bắt buộc qua consent + nhập Auth Token.
    if (autoApprove && isTrustedRequest(req, url)) {
      const code = "otter_code_" + crypto.randomBytes(20).toString("hex");
      saveAuthCode({
        code,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        state,
        scope,
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 phút
      });

      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);
      redirectUrl.searchParams.set("iss", origin);

      return Response.redirect(redirectUrl.toString(), 302);
    }

    // Hiển thị Consent Screen giao diện hiện đại
    const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ủy quyền truy cập Otter MCP</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --danger: #ef4444;
      --radius: 14px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      width: 100%;
      max-width: 480px;
      padding: 32px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border);
    }
    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      background: #2563eb;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
    }
    .title { font-size: 20px; font-weight: 700; }
    .subtitle { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .notice {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      line-height: 1.5;
      color: #93c5fd;
      margin-bottom: 20px;
    }
    .permissions {
      list-style: none;
      margin-bottom: 28px;
    }
    .permissions li {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    .actions {
      display: flex;
      gap: 12px;
    }
    button {
      flex: 1;
      padding: 12px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
    }
    .btn-approve {
      background: var(--primary);
      color: white;
    }
    .btn-approve:hover {
      background: var(--primary-hover);
    }
    .btn-deny {
      background: transparent;
      color: var(--text-muted);
      border: 1px solid var(--border);
    }
    .btn-deny:hover {
      color: var(--danger);
      border-color: var(--danger);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="avatar">🦦</div>
      <div>
        <div class="title">Cấp quyền kết nối Otter AI</div>
        <div class="subtitle">Client ID: <code>${escapeHtml(clientId)}</code></div>
      </div>
    </div>

    <div class="notice">
      Ứng dụng ChatGPT đang yêu cầu ủy quyền kết nối với máy tính của bạn qua Otter Daemon.
    </div>

    <ul class="permissions">
      <li><span>⚡</span><span>Thực thi các lệnh terminal console trong workspace an toàn</span></li>
      <li><span>📂</span><span>Đọc và ghi tệp tin dự án khi có sự yêu cầu từ bạn</span></li>
      <li><span>🌐</span><span>Tự động hóa tác vụ duyệt web qua Chrome CDP</span></li>
    </ul>

    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="scope" value="${escapeHtml(scope)}">
      ${codeChallenge ? `<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">` : ""}
      ${codeChallengeMethod ? `<input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">` : ""}

      ${url.searchParams.get("error") === "invalid_token" ? `<div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.4); color:#fca5a5; padding:10px 14px; border-radius:10px; font-size:13px; margin-bottom:14px;">Auth Token không đúng. Vui lòng kiểm tra lại trong Dashboard Otter hoặc file ~/.otter/auth.token.</div>` : ""}

      <label style="display:block; font-size:13px; color:var(--text-muted); margin-bottom:6px;">Nhập Auth Token của Otter để xác nhận bạn là chủ máy này (xem trong Dashboard hoặc file ~/.otter/auth.token):</label>
      <input type="password" name="auth_token" required autocomplete="off" placeholder="otter_..." style="width:100%; padding:11px 12px; border-radius:10px; border:1px solid var(--border); background:#0f172a; color:var(--text); font-size:14px; margin-bottom:16px;">

      <div class="actions">
        <button type="button" class="btn-deny" onclick="window.history.back()">Hủy bỏ</button>
        <button type="submit" class="btn-approve">Cho phép & Kết nối</button>
      </div>
    </form>
  </div>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        ...getCorsHeaders(req)
      }
    });
  }

  // 4. OAuth Authorize (POST: Người dùng bấm Chấp thuận từ Consent Screen)
  if (url.pathname === "/oauth/authorize" && req.method === "POST") {
    if (!allowLicenseRequest(`oauth-authorize:${getClientIp(req)}`, 10, 60_000)) {
      return jsonResponse({ error: "rate_limited", error_description: "Quá nhiều lần thử. Vui lòng đợi 1 phút." }, 429, {}, req);
    }

    let clientId = "chatgpt";
    let redirectUri = "";
    let state = "";
    let scope = "all";
    let codeChallenge: string | undefined;
    let codeChallengeMethod: string | undefined;
    let authTokenInput = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const form = new URLSearchParams(text);
      clientId = form.get("client_id") || clientId;
      redirectUri = form.get("redirect_uri") || "";
      state = form.get("state") || "";
      scope = form.get("scope") || scope;
      codeChallenge = form.get("code_challenge") || undefined;
      codeChallengeMethod = form.get("code_challenge_method") || undefined;
      authTokenInput = form.get("auth_token") || "";
    } else {
      try {
        const body = await req.json();
        clientId = body.client_id || clientId;
        redirectUri = body.redirect_uri || "";
        state = body.state || "";
        scope = body.scope || scope;
        codeChallenge = body.code_challenge || undefined;
        codeChallengeMethod = body.code_challenge_method || undefined;
        authTokenInput = body.auth_token || "";
      } catch {}
    }

    if (!redirectUri) {
      return new Response("Missing redirect_uri", { status: 400, headers: getCorsHeaders(req) });
    }

    if (!isRedirectUriAllowed(clientId, redirectUri)) {
      return new Response("redirect_uri không hợp lệ hoặc không nằm trong danh sách đã đăng ký của client", {
        status: 400,
        headers: getCorsHeaders(req),
      });
    }

    // Xác minh chủ máy: bắt buộc nhập đúng Auth Token mới được cấp code.
    const expectedToken = getAuthToken();
    if (!expectedToken || !authTokenInput || !timingSafeEqualStr(authTokenInput.trim(), expectedToken)) {
      const back = new URL(`${origin}/oauth/authorize`);
      back.searchParams.set("client_id", clientId);
      back.searchParams.set("redirect_uri", redirectUri);
      back.searchParams.set("response_type", "code");
      if (state) back.searchParams.set("state", state);
      back.searchParams.set("scope", scope);
      if (codeChallenge) back.searchParams.set("code_challenge", codeChallenge);
      if (codeChallengeMethod) back.searchParams.set("code_challenge_method", codeChallengeMethod);
      back.searchParams.set("error", "invalid_token");
      return Response.redirect(back.toString(), 302);
    }

    const code = "otter_code_" + crypto.randomBytes(20).toString("hex");
    saveAuthCode({
      code,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      state,
      scope,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 phút
    });

    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);
    redirectUrl.searchParams.set("iss", origin);

    return Response.redirect(redirectUrl.toString(), 302);
  }

  // 5. OAuth Token Endpoint (POST: ChatGPT backend đổi code lấy Access Token)
  if (url.pathname === "/oauth/token" && req.method === "POST") {
    if (!allowLicenseRequest(`oauth-token:${getClientIp(req)}`, 20, 60_000)) {
      return jsonResponse({ error: "rate_limited", error_description: "Quá nhiều lần thử. Vui lòng đợi 1 phút." }, 429, {}, req);
    }

    let grantType = "";
    let code = "";
    let redirectUri = "";
    let clientId = "";
    let codeVerifier = "";
    let refreshTokenInput = "";

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const form = new URLSearchParams(text);
      grantType = form.get("grant_type") || "";
      code = form.get("code") || "";
      redirectUri = form.get("redirect_uri") || "";
      clientId = form.get("client_id") || "";
      codeVerifier = form.get("code_verifier") || "";
      refreshTokenInput = form.get("refresh_token") || "";
    } else {
      try {
        const body = await req.json();
        grantType = body.grant_type || "";
        code = body.code || "";
        redirectUri = body.redirect_uri || "";
        clientId = body.client_id || "";
        codeVerifier = body.code_verifier || "";
        refreshTokenInput = body.refresh_token || "";
      } catch {}
    }

    // Refresh token: bắt buộc đối chiếu hash + xoay vòng. Không còn trả token chủ vô điều kiện.
    if (grantType === "refresh_token") {
      if (!refreshTokenInput) {
        return jsonResponse({
          error: "invalid_request",
          error_description: "Thiếu tham số refresh_token"
        }, 400, {}, req);
      }
      const rotated = rotateOAuthRefreshToken(refreshTokenInput);
      if (!rotated) {
        return jsonResponse({
          error: "invalid_grant",
          error_description: "Refresh token không hợp lệ, đã hết hạn hoặc đã bị thu hồi"
        }, 400, {}, req);
      }
      return jsonResponse({
        access_token: rotated.accessToken,
        token_type: "Bearer",
        expires_in: rotated.expiresIn,
        refresh_token: rotated.refreshToken,
        scope: "all"
      }, 200, {
        "Cache-Control": "no-store",
        "Pragma": "no-cache"
      }, req);
    }

    if (grantType !== "authorization_code") {
      return jsonResponse({
        error: "unsupported_grant_type",
        error_description: "Chỉ hỗ trợ grant_type=authorization_code hoặc refresh_token"
      }, 400, {}, req);
    }

    if (!code) {
      return jsonResponse({
        error: "invalid_request",
        error_description: "Thiếu tham số code"
      }, 400, {}, req);
    }

    const record = consumeAuthCode(code);
    if (!record) {
      return jsonResponse({
        error: "invalid_grant",
        error_description: "Mã code ủy quyền không hợp lệ hoặc đã hết hạn"
      }, 400, {}, req);
    }

    // Xác thực PKCE (nếu client đã gửi code_challenge)
    if (record.codeChallenge) {
      if (!codeVerifier) {
        return jsonResponse({
          error: "invalid_request",
          error_description: "Yêu cầu code_verifier cho luồng PKCE S256"
        }, 400, {}, req);
      }

      const computedChallenge = crypto
        .createHash("sha256")
        .update(codeVerifier)
        .digest("base64url");

      if (computedChallenge !== record.codeChallenge) {
        return jsonResponse({
          error: "invalid_grant",
          error_description: "PKCE verification failed: code_verifier không khớp với code_challenge"
        }, 400, {}, req);
      }
    }

    // Cấp cặp token riêng cho client (không dùng token chủ — thu hồi riêng được)
    const issued = issueOAuthTokens(record.clientId, record.scope || "all");

    return jsonResponse({
      access_token: issued.accessToken,
      token_type: "Bearer",
      expires_in: issued.expiresIn,
      refresh_token: issued.refreshToken,
      scope: record.scope || "all"
    }, 200, {
      "Cache-Control": "no-store",
      "Pragma": "no-cache"
    }, req);
  }

  // 6. Quản trị client OAuth đã kết nối (Dashboard — KHÔNG public, qua checkAuth)
  if (matchDaemonRoute(url.pathname, "OAUTH_CLIENTS") && req.method === "GET") {
    return jsonResponse({ clients: listOAuthClients() }, 200, {}, req);
  }

  if (matchDaemonRoute(url.pathname, "OAUTH_REVOKE") && req.method === "POST") {
    let body: any = {};
    try {
      body = await req.json();
    } catch {}
    const clientId = String(body.client_id || body.clientId || "").trim();
    if (!clientId) {
      return jsonResponse({ error: "Thiếu client_id" }, 400, {}, req);
    }
    const revoked = revokeOAuthClient(clientId);
    return jsonResponse({ ok: true, revoked }, 200, {}, req);
  }

  return null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
