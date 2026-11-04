/**
 * Chrome HTTP routes — cho tab Management của extension gọi trực tiếp
 * (cùng pattern manageFetch, sau global auth check, không public).
 * - GET  /api/chrome/profiles
 * - POST /api/chrome/open   { profile?, url?, userDataDir?, createIfMissing? }
 * MCP tools chrome_* vẫn là đường chính cho ChatGPT; route này chỉ
 * là nút bấm tiện tay trong extension.
 */
import { jsonResponse, errorResponse } from "./common";
import { listChromeProfiles, openChromeProfile } from "../chrome-profile";

async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return {}; }
}

export async function handleChromeRoutes(req: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/chrome/profiles" && req.method === "GET") {
    try {
      const res = listChromeProfiles(url.searchParams.get("userDataDir") || undefined);
      return jsonResponse(res, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }
  if (url.pathname === "/api/chrome/open" && req.method === "POST") {
    try {
      const body = await readJson(req);
      const res = openChromeProfile(body);
      return jsonResponse(res, 200, {}, req);
    } catch (e: any) { return errorResponse(e.message, 400, req); }
  }
  return null;
}
