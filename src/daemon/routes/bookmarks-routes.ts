import { Database } from "bun:sqlite";
import { saveBookmark, searchBookmarks, listBookmarks, deleteBookmark } from "../bookmarks";
import { jsonResponse, errorResponse } from "./common";
import { matchDaemonRoute, matchDaemonSubPath } from "./lcg-routes";

export async function handleBookmarksRoutes(req: Request, url: URL, db: Database): Promise<Response | null> {
  if (matchDaemonRoute(url.pathname, "BOOKMARKS") && req.method === "GET") {
    const q = url.searchParams.get("q") || url.searchParams.get("query");
    const tag = url.searchParams.get("tag") || undefined;
    const limit = Number(url.searchParams.get("limit") || 20);
    if (q) {
      const items = searchBookmarks(db, q, limit);
      return jsonResponse({ items, total: items.length });
    } else {
      const res = listBookmarks(db, limit, 0, tag);
      return jsonResponse(res);
    }
  }

  if (matchDaemonRoute(url.pathname, "BOOKMARKS") && req.method === "POST") {
    try {
      const body: any = await req.json();
      const bm = saveBookmark(db, body);
      return jsonResponse({ ok: true, bookmark: bm });
    } catch (err: any) {
      return errorResponse(err.message, 400);
    }
  }

  const bmDeleteMatch = matchDaemonSubPath(url.pathname, "BOOKMARKS", "/([^/]+)");
  if (bmDeleteMatch && req.method === "DELETE") {
    const id = decodeURIComponent(bmDeleteMatch[1]);
    const ok = deleteBookmark(db, id);
    return jsonResponse({ ok });
  }

  return null;
}
