import { Database } from "bun:sqlite";
import {
  saveCustomCommand,
  listCustomCommands,
  getCustomCommand,
  deleteCustomCommand,
  togglePinCustomCommand,
  incrementCommandUsage
} from "../custom-commands";
import { jsonResponse, errorResponse } from "./common";
import { matchDaemonRoute, matchDaemonSubPath } from "./lcg-routes";

export async function handleCustomCommandsRoutes(req: Request, url: URL, db: Database): Promise<Response | null> {
  // 1. Lấy danh sách lệnh
  if (matchDaemonRoute(url.pathname, "COMMANDS") && req.method === "GET") {
    const pinnedOnly = url.searchParams.get("pinned") === "true";
    const items = listCustomCommands(db, pinnedOnly);
    return jsonResponse({ items, total: items.length });
  }

  // 2. Thêm hoặc cập nhật lệnh
  if (matchDaemonRoute(url.pathname, "COMMANDS") && req.method === "POST") {
    try {
      const body: any = await req.json();
      const cmd = saveCustomCommand(db, body);
      return jsonResponse({ ok: true, command: cmd });
    } catch (err: any) {
      return errorResponse(err.message, 400);
    }
  }

  // 3. Ghim hoặc bỏ ghim lệnh: POST /api/commands/:id/pin
  const pinMatch = matchDaemonSubPath(url.pathname, "COMMANDS", "/([^/]+)/pin");
  if (pinMatch && req.method === "POST") {
    const id = decodeURIComponent(pinMatch[1]);
    let pinned: boolean | undefined = undefined;
    try {
      const body: any = await req.json();
      if (typeof body.pinned === "boolean") {
        pinned = body.pinned;
      }
    } catch {}
    const cmd = togglePinCustomCommand(db, id, pinned);
    if (!cmd) {
      return errorResponse("Không tìm thấy tập lệnh với ID: " + id, 404);
    }
    return jsonResponse({ ok: true, command: cmd });
  }

  // 4. Ghi nhận lượt sử dụng: POST /api/commands/:id/use
  const useMatch = matchDaemonSubPath(url.pathname, "COMMANDS", "/([^/]+)/use");
  if (useMatch && req.method === "POST") {
    const id = decodeURIComponent(useMatch[1]);
    incrementCommandUsage(db, id);
    return jsonResponse({ ok: true });
  }

  // 5. Lấy chi tiết lệnh: GET /api/commands/:id
  const getMatch = matchDaemonSubPath(url.pathname, "COMMANDS", "/([^/]+)");
  if (getMatch && req.method === "GET") {
    const id = decodeURIComponent(getMatch[1]);
    const cmd = getCustomCommand(db, id);
    if (!cmd) {
      return errorResponse("Không tìm thấy tập lệnh với ID: " + id, 404);
    }
    return jsonResponse({ ok: true, command: cmd });
  }

  // 6. Xóa lệnh: DELETE /api/commands/:id
  const deleteMatch = matchDaemonSubPath(url.pathname, "COMMANDS", "/([^/]+)");
  if (deleteMatch && req.method === "DELETE") {
    const id = decodeURIComponent(deleteMatch[1]);
    const ok = deleteCustomCommand(db, id);
    return jsonResponse({ ok });
  }

  return null;
}
