import { isRequestAuthorized } from "../security";

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/([a-z0-9-]+\.)?chatgpt\.com$/,
  /^chrome-extension:\/\/[a-z]{32}$/,
  /^https:\/\/otter\.gpt\.io\.vn$/
];

export function getCorsHeaders(req?: Request): Record<string, string> {
  const origin = req?.headers.get("origin") || "";
  let allowedOrigin = "*";

  if (origin) {
    const isMatched = ALLOWED_ORIGIN_PATTERNS.some(p => p.test(origin)) ||
      (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()).includes(origin));

    if (isMatched) {
      allowedOrigin = origin;
    } else {
      // Nếu origin lạ cố tình gửi từ trình duyệt khác (CSRF), không cấp quyền CORS
      allowedOrigin = "null";
    }
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-chatgpt, mcp-protocol-version, mcp-session-id",
    "Access-Control-Allow-Credentials": "true"
  };
}

export const corsHeaders = getCorsHeaders();

export function handleCorsPreflight(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  return null;
}

export function jsonResponse(data: any, status = 200, extraHeaders: Record<string, string> = {}, req?: Request): Response {
  return Response.json(data, {
    status,
    headers: { ...getCorsHeaders(req), ...extraHeaders }
  });
}

export function errorResponse(message: string, status = 500, req?: Request): Response {
  return Response.json({ error: message }, {
    status,
    headers: getCorsHeaders(req)
  });
}

export function checkAuth(req: Request, url: URL): Response | null {
  if (!isRequestAuthorized(req, url)) {
    const proto = req.headers.get("x-forwarded-proto") || (url.protocol.startsWith("https") ? "https" : (url.host.includes("localhost") || url.host.includes("127.0.0.1") ? "http" : "https"));
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
    const origin = `${proto}://${host}`;
    return new Response("Unauthorized: Yêu cầu Authorization Bearer token hợp lệ.", {
      status: 401,
      headers: {
        ...getCorsHeaders(req),
        "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      }
    });
  }
  return null;
}
