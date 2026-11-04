import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import {
  assertSafePath,
  registerAllowedWorkspace,
  getAllowedWorkspaces,
  isRequestAuthorized,
  setAuthToken
} from "../src/daemon/security";
import { interpolateEnvVars } from "../src/daemon/mcp-gateway";
import { getCorsHeaders } from "../src/daemon/routes/common";

describe("Security & Hardening Tests", () => {
  it("allows paths inside the current workspace root", () => {
    const safePath = path.resolve("package.json");
    expect(() => assertSafePath(safePath)).not.toThrow();
    expect(assertSafePath("src/daemon/index.ts")).toBe(path.resolve("src/daemon/index.ts"));
  });

  it("blocks path traversal outside allowed workspaces", () => {
    const outsidePath = path.resolve("..", "..", "..", "Windows", "System32", "drivers", "etc", "hosts");
    expect(() => assertSafePath(outsidePath)).toThrow(/Truy cập bị từ chối/);
  });

  it("allows newly registered workspace dynamically", () => {
    const tempWorkspace = path.resolve("scratch", "custom-workspace");
    registerAllowedWorkspace(tempWorkspace);

    expect(getAllowedWorkspaces()).toContain(tempWorkspace);
    const subFile = path.resolve(tempWorkspace, "test.txt");
    expect(() => assertSafePath(subFile)).not.toThrow();
  });

  it("strictly enforces token verification for external/tunnel hosts", () => {
    setAuthToken("secret-token-abcdef123");

    // 1. External request (otter.example.com) without token -> must be rejected
    const extReqNoToken = new Request("https://otter.example.com/api/activity/v1/terminal/exec", {
      headers: { host: "otter.example.com" }
    });
    expect(isRequestAuthorized(extReqNoToken, new URL(extReqNoToken.url))).toBe(false);

    // 2. External request with wrong token -> must be rejected
    const extReqWrongToken = new Request("https://otter.example.com/api/activity/v1/terminal/exec", {
      headers: {
        host: "otter.example.com",
        Authorization: "Bearer wrong-token"
      }
    });
    expect(isRequestAuthorized(extReqWrongToken, new URL(extReqWrongToken.url))).toBe(false);

    // 3. External request with correct Bearer header -> allowed
    const extReqValidHeader = new Request("https://otter.example.com/api/activity/v1/terminal/exec", {
      headers: {
        host: "otter.example.com",
        Authorization: "Bearer secret-token-abcdef123"
      }
    });
    expect(isRequestAuthorized(extReqValidHeader, new URL(extReqValidHeader.url))).toBe(true);

    // 4. External request with correct query parameter token -> allowed
    const extReqValidQuery = new Request("https://otter.example.com/api/activity/v1/stream?token=secret-token-abcdef123", {
      headers: { host: "otter.example.com" }
    });
    expect(isRequestAuthorized(extReqValidQuery, new URL(extReqValidQuery.url))).toBe(true);

    // Dọn dẹp token
    setAuthToken(null);
  });

  it("allows localhost requests when no token configured, but protects when token is set", () => {
    setAuthToken(null);
    const localReqNoToken = new Request("http://127.0.0.1:1993/api/bookmarks", {
      headers: { host: "127.0.0.1:1993" }
    });
    expect(isRequestAuthorized(localReqNoToken, new URL(localReqNoToken.url))).toBe(true);

    // Khi người dùng đặt token
    setAuthToken("my-super-secret-key");
    expect(isRequestAuthorized(localReqNoToken, new URL(localReqNoToken.url))).toBe(false);

    const localReqWithToken = new Request("http://127.0.0.1:1993/api/bookmarks", {
      headers: {
        host: "127.0.0.1:1993",
        Authorization: "Bearer my-super-secret-key"
      }
    });
    expect(isRequestAuthorized(localReqWithToken, new URL(localReqWithToken.url))).toBe(true);

    setAuthToken(null);
  });

  it("interpolates environment variables in MCP configuration (SEC-03)", () => {
    process.env.TEST_MCP_TOKEN = "bearer-secret-token-999";
    const rawTemplate = '{"url": "http://127.0.0.1:9495/mcp", "token": "${TEST_MCP_TOKEN}"}';
    const result = interpolateEnvVars(rawTemplate);
    expect(result).toContain('"token": "bearer-secret-token-999"');
    delete process.env.TEST_MCP_TOKEN;
  });

  it("restricts CORS origin to trusted domains and blocks arbitrary origins", () => {
    // 1. ChatGPT origin -> Cho phép
    const chatGptReq = new Request("http://localhost:1993/api/bookmarks", {
      headers: { origin: "https://chatgpt.com" }
    });
    const chatGptCors = getCorsHeaders(chatGptReq);
    expect(chatGptCors["Access-Control-Allow-Origin"]).toBe("https://chatgpt.com");

    // 2. Localhost origin -> Cho phép
    const localReq = new Request("http://localhost:1993/api/bookmarks", {
      headers: { origin: "http://localhost:3000" }
    });
    const localCors = getCorsHeaders(localReq);
    expect(localCors["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");

    // 3. Malicious third-party origin -> Bị set về "null" (Trình duyệt chặn CORS)
    const evilReq = new Request("http://localhost:1993/api/bookmarks", {
      headers: { origin: "https://evil-attacker-site.com" }
    });
    const evilCors = getCorsHeaders(evilReq);
    expect(evilCors["Access-Control-Allow-Origin"]).toBe("null");
  });
});
