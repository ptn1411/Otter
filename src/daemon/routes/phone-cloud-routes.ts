import { Database } from "bun:sqlite";
import * as path from "node:path";
import {
  canRegisterFromIp,
  deletePhoneDevice,
  getPhoneDevice,
  getPhoneRelayHealth,
  handlePhoneSocketIoPolling,
  listPhoneDevicesAdmin,
  listPhoneDevicesPublic,
  registerPhoneDevice,
  renamePhoneDevice,
  rotatePhonePassword,
  setPhoneAllowPublicRegister,
  setSelectedLocalDeviceId,
  updatePhoneStreamSettings,
  verifyPhoneControl,
} from "../phone-cloud";
import { executePhoneTool } from "../tools/phone-tools";
import { errorResponse, getCorsHeaders, jsonResponse } from "./common";

export async function handlePhoneCloudRoutes(
  req: Request,
  url: URL,
  db: Database,
  clientIp = "unknown",
  onActivity?: (event: any) => void
): Promise<Response | null> {
  // 0. Phục vụ file client socket.io.js (nếu trang standalone yêu cầu)
  if (url.pathname === "/socket.io/socket.io.js" && req.method === "GET") {
    const sioClientPath = path.resolve("node_modules/socket.io-client/dist/socket.io.js");
    const f = Bun.file(sioClientPath);
    if (await f.exists()) {
      return new Response(f, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
          ...getCorsHeaders(req),
        },
      });
    }
  }

  // 0b. Engine.IO / Socket.IO HTTP Long-Polling (`/socket.io/*`)
  if (url.pathname === "/socket.io" || url.pathname.startsWith("/socket.io/")) {
    const pollRes = await handlePhoneSocketIoPolling(req, url, clientIp);
    if (pollRes) return pollRes;
  }

  // =========================================================================
  // 1. Dây giao thức chuẩn PhoneCloud 1.2 / 1.3 (App Android & Viewer Client)
  // =========================================================================

  // POST /api/device/register — Điện thoại Android tự đăng ký
  if (url.pathname === "/api/device/register" && req.method === "POST") {
    const gate = canRegisterFromIp(clientIp);
    if (!gate.ok) {
      return jsonResponse({ status: false, msg: gate.error }, 403, {}, req);
    }
    try {
      const body: any = await req.json().catch(() => ({}));
      const reg = registerPhoneDevice(body?.name || "", db);
      onActivity?.({ type: "phone_registered", deviceId: reg.device_id, name: reg.name });
      return jsonResponse(reg, 200, {}, req);
    } catch (err: any) {
      return jsonResponse({ status: false, msg: err.message }, 400, {}, req);
    }
  }

  // GET /api/device/config?device_id=...
  if (url.pathname === "/api/device/config" && req.method === "GET") {
    const deviceId = url.searchParams.get("device_id") || "";
    const dev = getPhoneDevice(deviceId, db);
    if (!dev) {
      return jsonResponse({ status: false, msg: "device not found" }, 404, {}, req);
    }
    return jsonResponse(
      {
        status: true,
        quality: dev.quality,
        fps: dev.fps,
        ws_path: "/socket.io",
      },
      200,
      {},
      req
    );
  }

  // POST /api/control/connect — Xác thực ID + mật khẩu 6 số trước khi mở luồng hình
  if (url.pathname === "/api/control/connect" && req.method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    const check = verifyPhoneControl(String(body?.device_id || ""), String(body?.passwd || ""), clientIp, db);
    if (!check.ok) {
      return jsonResponse({ status: false, msg: check.msg }, check.status, {}, req);
    }
    const pub = listPhoneDevicesPublic(db).find((d) => d.device_id === check.device.device_id);
    return jsonResponse(
      {
        status: true,
        online: pub?.online ?? false,
        ws_path: "/socket.io",
        name: check.device.name || "",
        quality: pub?.quality ?? 720,
        fps: pub?.fps ?? 30,
        screenWidth: pub?.screenWidth || 0,
        screenHeight: pub?.screenHeight || 0,
      },
      200,
      {},
      req
    );
  }

  // POST /api/control/settings — Đổi quality / fps (kèm mật khẩu 6 số)
  if (url.pathname === "/api/control/settings" && req.method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    const check = verifyPhoneControl(String(body?.device_id || ""), String(body?.passwd || ""), clientIp, db);
    if (!check.ok) {
      return jsonResponse({ status: false, msg: check.msg }, check.status, {}, req);
    }
    try {
      const updated = updatePhoneStreamSettings(
        check.device.device_id,
        Number(body?.quality),
        Number(body?.fps),
        db
      );
      return jsonResponse(updated, 200, {}, req);
    } catch (err: any) {
      return jsonResponse({ status: false, msg: err.message }, 400, {}, req);
    }
  }

  // GET /api/devices — Danh sách thiết bị công khai (đã qua checkAuth của Otter, không bao giờ lộ password/key)
  if (url.pathname === "/api/devices" && req.method === "GET") {
    return jsonResponse({ status: true, devices: listPhoneDevicesPublic(db) }, 200, {}, req);
  }

  // =========================================================================
  // 2. API Quản trị nâng cấp cho Otter Dashboard (`/api/phone-cloud/*`)
  // =========================================================================

  if (url.pathname === "/api/phone-cloud/status" && req.method === "GET") {
    return jsonResponse(getPhoneRelayHealth(db), 200, {}, req);
  }

  if (url.pathname === "/api/phone-cloud/config" && req.method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    if (typeof body?.allowPublicRegister === "boolean") {
      setPhoneAllowPublicRegister(body.allowPublicRegister);
    }
    if (body?.activeDeviceId !== undefined) {
      setSelectedLocalDeviceId(body.activeDeviceId ? String(body.activeDeviceId) : null);
    }
    return jsonResponse(getPhoneRelayHealth(db), 200, {}, req);
  }

  if (url.pathname === "/api/phone-cloud/devices" && req.method === "GET") {
    return jsonResponse(
      {
        ok: true,
        health: getPhoneRelayHealth(db),
        devices: listPhoneDevicesAdmin(db),
      },
      200,
      {},
      req
    );
  }

  if (url.pathname === "/api/phone-cloud/devices/register" && req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const reg = registerPhoneDevice(body?.name || "", db);
      return jsonResponse({ ok: true, device: reg }, 200, {}, req);
    } catch (err: any) {
      return errorResponse(err.message, 400, req);
    }
  }

  const renameMatch = url.pathname.match(/^\/api\/phone-cloud\/devices\/([^/]+)\/rename$/);
  if (renameMatch && req.method === "POST") {
    const body: any = await req.json().catch(() => ({}));
    const updated = renamePhoneDevice(renameMatch[1]!, String(body?.name ?? ""), db);
    if (!updated) return errorResponse("Không tìm thấy thiết bị", 404, req);
    return jsonResponse({ ok: true, device: updated }, 200, {}, req);
  }

  const rotateMatch = url.pathname.match(/^\/api\/phone-cloud\/devices\/([^/]+)\/rotate-password$/);
  if (rotateMatch && req.method === "POST") {
    const nextPass = rotatePhonePassword(rotateMatch[1]!, db);
    if (!nextPass) return errorResponse("Không tìm thấy thiết bị", 404, req);
    return jsonResponse({ ok: true, device_id: rotateMatch[1], password: nextPass }, 200, {}, req);
  }

  const adminSettingsMatch = url.pathname.match(/^\/api\/phone-cloud\/devices\/([^/]+)\/settings$/);
  if (adminSettingsMatch && req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const updated = updatePhoneStreamSettings(
        adminSettingsMatch[1]!,
        Number(body?.quality),
        Number(body?.fps),
        db
      );
      return jsonResponse({ ok: true, ...updated }, 200, {}, req);
    } catch (err: any) {
      return errorResponse(err.message, 400, req);
    }
  }

  const adminCmdMatch = url.pathname.match(/^\/api\/phone-cloud\/devices\/([^/]+)\/tool$/);
  if (adminCmdMatch && req.method === "POST") {
    try {
      const body: any = await req.json().catch(() => ({}));
      const toolName = String(body?.tool || "");
      if (!toolName.startsWith("phone_")) {
        return errorResponse("Tên công cụ phải bắt đầu bằng 'phone_'", 400, req);
      }
      const result = await executePhoneTool(
        toolName,
        { ...(body?.args || {}), device_id: adminCmdMatch[1]! },
        onActivity
      );
      return jsonResponse({ ok: true, result }, 200, {}, req);
    } catch (err: any) {
      return errorResponse(err.message, 500, req);
    }
  }

  const deleteMatch = url.pathname.match(/^\/api\/phone-cloud\/devices\/([^/]+)$/);
  if (deleteMatch && req.method === "DELETE") {
    const ok = deletePhoneDevice(deleteMatch[1]!, db);
    if (!ok) return errorResponse("Không tìm thấy thiết bị", 404, req);
    return jsonResponse({ ok: true }, 200, {}, req);
  }

  return null;
}
