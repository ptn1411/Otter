import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

// OTTER_HOME tạm + token chủ cố định để test consent xác minh.
const prevOtterHome = process.env.OTTER_HOME;
const prevApiKey = process.env.OTTER_API_KEY;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "otter-oauth-"));
process.env.OTTER_HOME = tmpHome;
process.env.OTTER_API_KEY = "test-master-token-123";

import { handleOAuthRoutes } from "../src/daemon/routes/oauth-routes";
import { isRequestAuthorized } from "../src/daemon/security";
import { validateOAuthAccessToken, revokeOAuthClient } from "../src/daemon/oauth-store";
import { clearLicenseRateLimits } from "../src/daemon/license/rate-limit";
import { closeSharedDatabase } from "../src/daemon/db";

const BASE = "https://testuser.otter.gpt.io.vn";

function req(pathname: string, init: RequestInit = {}): Request {
  return new Request(BASE + pathname, init);
}

async function call(pathname: string, init: RequestInit = {}): Promise<Response> {
  const r = req(pathname, init);
  const res = await handleOAuthRoutes(r, new URL(r.url));
  if (!res) throw new Error(`Route không xử lý: ${pathname}`);
  return res;
}

async function registerClient(redirectUris = ["https://chatgpt.com/callback"]): Promise<string> {
  const res = await call("/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Test AI", redirect_uris: redirectUris }),
  });
  expect(res.status).toBe(201);
  const data: any = await res.json();
  return data.client_id;
}

async function authorizeAndGetCode(clientId: string, extra: Record<string, string> = {}): Promise<string> {
  const form = new URLSearchParams({
    client_id: clientId,
    redirect_uri: "https://chatgpt.com/callback",
    state: "xyz",
    scope: "all",
    auth_token: "test-master-token-123",
    ...extra,
  });
  const res = await call("/oauth/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  expect(res.status).toBe(302);
  const loc = res.headers.get("location") || "";
  const code = new URL(loc).searchParams.get("code");
  expect(code).toBeTruthy();
  return code!;
}

async function exchangeCode(code: string, extra: Record<string, string> = {}): Promise<any> {
  const res = await call("/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, ...extra }).toString(),
  });
  expect(res.status).toBe(200);
  return res.json();
}

describe("OAuth security (bản sửa 2026-11-21)", () => {
  beforeAll(() => clearLicenseRateLimits());

  test("refresh_token grant không còn trả token chủ vô điều kiện", async () => {
    // Không gửi refresh_token -> 400
    let res = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token" }).toString(),
    });
    expect(res.status).toBe(400);
    let data: any = await res.json();
    expect(data.access_token).toBeUndefined();

    // Refresh token giả -> 400 invalid_grant
    res = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "otter_rt_fakefake" }).toString(),
    });
    expect(res.status).toBe(400);
    data = await res.json();
    expect(data.error).toBe("invalid_grant");
    expect(data.access_token).toBeUndefined();
  });

  test("register từ chối redirect_uri không an toàn", async () => {
    const res = await call("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Evil", redirect_uris: ["http://evil.example.com/cb"] }),
    });
    expect(res.status).toBe(400);
  });

  test("authorize GET từ chối redirect_uri ngoài danh sách đã đăng ký", async () => {
    const clientId = await registerClient(["https://chatgpt.com/callback"]);
    const res = await call(
      `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent("https://attacker.example.com/cb")}&response_type=code`
    );
    expect(res.status).toBe(400);
  });

  test("auto_approve từ internet công khai bị bỏ qua (hiện consent, không cấp code)", async () => {
    const clientId = await registerClient();
    const res = await call(
      `/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent("https://chatgpt.com/callback")}&response_type=code&auto_approve=1`
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("auth_token");
    expect(res.headers.get("location")).toBeNull();
  });

  test("consent POST sai Auth Token -> quay lại với error, không cấp code", async () => {
    const clientId = await registerClient();
    const res = await call("/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: "https://chatgpt.com/callback",
        auth_token: "sai-token",
      }).toString(),
    });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") || "";
    expect(loc).toContain("error=invalid_token");
    expect(loc).not.toContain("code=otter_code_");
  });

  test("luồng đầy đủ: consent đúng token -> code -> cặp token riêng (không phải token chủ)", async () => {
    const clientId = await registerClient();
    const code = await authorizeAndGetCode(clientId);
    const tokens = await exchangeCode(code);
    expect(tokens.access_token.startsWith("otter_at_")).toBe(true);
    expect(tokens.refresh_token.startsWith("otter_rt_")).toBe(true);
    expect(tokens.access_token).not.toBe("test-master-token-123");

    // Access token OAuth dùng được cho API (qua isRequestAuthorized).
    expect(validateOAuthAccessToken(tokens.access_token)).toBe(true);
    const apiReq = new Request(BASE + "/mcp", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(isRequestAuthorized(apiReq, new URL(apiReq.url))).toBe(true);

    // Token giả bị từ chối.
    const badReq = new Request(BASE + "/mcp", {
      headers: { Authorization: "Bearer otter_at_khongtontai" },
    });
    expect(isRequestAuthorized(badReq, new URL(badReq.url))).toBe(false);
  });

  test("refresh xoay vòng: token cũ bị thu hồi, dùng lại bị từ chối", async () => {
    const clientId = await registerClient();
    const code = await authorizeAndGetCode(clientId);
    const first = await exchangeCode(code);

    const res = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.refresh_token }).toString(),
    });
    expect(res.status).toBe(200);
    const second: any = await res.json();
    expect(second.access_token).not.toBe(first.access_token);

    // Access token cũ đã bị thu hồi sau khi xoay vòng.
    expect(validateOAuthAccessToken(first.access_token)).toBe(false);
    expect(validateOAuthAccessToken(second.access_token)).toBe(true);

    // Dùng lại refresh token cũ -> 400.
    const reuse = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: first.refresh_token }).toString(),
    });
    expect(reuse.status).toBe(400);
  });

  test("thu hồi client -> access token mất hiệu lực ngay", async () => {
    const clientId = await registerClient();
    const code = await authorizeAndGetCode(clientId);
    const tokens = await exchangeCode(code);
    expect(validateOAuthAccessToken(tokens.access_token)).toBe(true);
    const revoked = revokeOAuthClient(clientId);
    expect(revoked).toBeGreaterThan(0);
    expect(validateOAuthAccessToken(tokens.access_token)).toBe(false);
  });

  test("PKCE S256 vẫn hoạt động", async () => {
    const clientId = await registerClient();
    const verifier = "test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const code = await authorizeAndGetCode(clientId, {
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    // Thiếu verifier -> 400
    const bad = await call("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    });
    expect(bad.status).toBe(400);
  });

  afterAll(() => {
    // Luôn khôi phục env và đóng DB trước khi xóa tmpHome để tránh EBUSY trên Windows
    // hoặc làm rò rỉ OTTER_HOME sang các file test chạy sau.
    if (prevOtterHome === undefined) delete process.env.OTTER_HOME;
    else process.env.OTTER_HOME = prevOtterHome;
    if (prevApiKey === undefined) delete process.env.OTTER_API_KEY;
    else process.env.OTTER_API_KEY = prevApiKey;
    closeSharedDatabase();
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
  });
});
