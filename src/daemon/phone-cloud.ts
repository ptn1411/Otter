/**
 * Otter PhoneCloud Engine (v2.4 — Upgraded & Unified from PhoneCloud 1.3.0)
 *
 * - Tương thích 100% dây giao thức PhoneCloud 1.2/1.3 (Engine.IO v4 + Socket.IO v4 tại `/socket.io`,
 *   hỗ trợ cả HTTP long-polling + WebSocket upgrade cho Android `io.socket:socket.io-client:2.1.0`
 *   lẫn pure WebSocket cho WebCodecs viewer).
 * - Lưu trữ bền vững trong SQLite (`phone_devices`), so sánh mật khẩu hằng thời gian (`timingSafeEqual`),
 *   giới hạn tốc độ chống dò mật khẩu / spam đăng ký.
 * - Điều khiển trực tiếp In-Process (Zero-Hop, không cần nhập lại mật khẩu khi AI trên Otter điều khiển máy nội bộ)
 *   ĐỒNG THỜI hỗ trợ nối tới Relay PhoneCloud từ xa qua `socket.io-client` (`PHONECLOUD_API` / tham số `api`).
 */

import { Database } from "bun:sqlite";
import * as crypto from "node:crypto";
import { io as createRemoteSocket, type Socket as RemoteSocket } from "socket.io-client";
import { getDatabase } from "./db";
import { isTrustedHostOrIp } from "./security";

export const PHONE_QUALITIES = [360, 480, 720, 1080] as const;
export const PHONE_FRAME_RATES = [15, 24, 30] as const;
export type PhoneQuality = (typeof PHONE_QUALITIES)[number];
export type PhoneFrameRate = (typeof PHONE_FRAME_RATES)[number];

const ALLOWED_QUALITY = new Set<number>(PHONE_QUALITIES);
const ALLOWED_FPS = new Set<number>(PHONE_FRAME_RATES);
const WS_DROP_BUFFERED_BYTES = 256 * 1024; // Bỏ delta frame nếu người xem nghẽn >256KB
const PING_INTERVAL_MS = 25_000;
const PING_TIMEOUT_MS = 20_000;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const AUTH_DEADLINE_MS = 12_000;
const MAX_DEVICES = 100;

export interface PhoneDeviceRow {
  device_id: string;
  password: string;
  device_key: string;
  name: string;
  quality: number;
  fps: number;
  screen_width: number;
  screen_height: number;
  orientation: string;
  last_seen_at: number | null;
  created_at: number;
}

export interface PhoneDevicePublic {
  device_id: string;
  name: string;
  online: boolean;
  quality: PhoneQuality;
  fps: PhoneFrameRate;
  screenWidth: number;
  screenHeight: number;
  orientation: string;
  lastSeenAt: number | null;
  created_at: string;
}

export interface PhoneDeviceAdmin extends PhoneDevicePublic {
  password: string;
  viewers: number;
  hasKeyframe: boolean;
}

export interface PhoneUiElement {
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  className?: string;
  bounds?: [number, number, number, number];
  clickable?: boolean;
  enabled?: boolean;
  checked?: boolean;
  focused?: boolean;
}

// ---------------------------------------------------------------------------
// Rate Limiting & Config
// ---------------------------------------------------------------------------

let allowPublicRegister = process.env.PHONECLOUD_PUBLIC_REGISTER !== "0";
let selectedLocalDeviceId: string | null = null;

const authFailuresByIp = new Map<string, { count: number; resetAt: number }>();
const registerByIp = new Map<string, { count: number; resetAt: number }>();

function checkRateBucket(
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const slot = map.get(key);
  if (!slot || now >= slot.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (slot.count >= limit) return false;
  slot.count += 1;
  return true;
}

export function getPhoneAllowPublicRegister(): boolean {
  return allowPublicRegister;
}

export function setPhoneAllowPublicRegister(allow: boolean): void {
  allowPublicRegister = allow;
}

export function getSelectedLocalDeviceId(): string | null {
  return selectedLocalDeviceId;
}

export function setSelectedLocalDeviceId(deviceId: string | null): void {
  selectedLocalDeviceId = deviceId;
}

function randomDigits(n: number): string {
  let s = "";
  while (s.length < n) {
    const b = crypto.randomBytes(1)[0]!;
    if (b < 250) s += String(b % 10);
  }
  return s;
}

function safeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function normalizeQuality(q: number): PhoneQuality {
  return (ALLOWED_QUALITY.has(q) ? q : 720) as PhoneQuality;
}

function normalizeFps(f: number): PhoneFrameRate {
  return (ALLOWED_FPS.has(f) ? f : 30) as PhoneFrameRate;
}

// ---------------------------------------------------------------------------
// Meter (FPS / Dropped / Bitrate)
// ---------------------------------------------------------------------------

const meter = {
  frames: 0,
  dropped: 0,
  bytes: 0,
  windowStart: Date.now(),
  rate: { frames: 0, dropped: 0, mbps: 0 },
};

function rollMeter(now = Date.now()) {
  const dt = (now - meter.windowStart) / 1000;
  if (dt < 1) return meter.rate;
  meter.rate = {
    frames: Math.round(meter.frames / dt),
    dropped: Math.round(meter.dropped / dt),
    mbps: Math.round(((meter.bytes * 8) / dt / 1e4)) / 100,
  };
  meter.frames = 0;
  meter.dropped = 0;
  meter.bytes = 0;
  meter.windowStart = now;
  return meter.rate;
}

function noteFrame(bytes: number, dropped: boolean) {
  rollMeter(Date.now());
  if (dropped) meter.dropped += 1;
  else {
    meter.frames += 1;
    meter.bytes += bytes;
  }
}

// ---------------------------------------------------------------------------
// Engine.IO v4 + Socket.IO v4 Relay State
// ---------------------------------------------------------------------------

interface PendingBinaryPacket {
  event: string;
  args: any[];
  expected: number;
  buffers: Uint8Array[];
}

interface EioSession {
  sid: string;
  sioSid: string;
  ws: any | null;
  probeWs: any | null;
  upgraded: boolean;
  pollQueue: string[];
  pollWaiter: ((payload: string) => void) | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  pendingBinary: PendingBinaryPacket | null;
  role: "device" | "control" | null;
  deviceId: string | null;
  clientIp: string;
  createdAt: number;
  lastPongAt: number;
  authTimer: ReturnType<typeof setTimeout> | null;
}

interface DeviceStreamSlot {
  meta?: any;
  keyframe?: Uint8Array;
  lastMessage?: any;
}

const eioSessions = new Map<string, EioSession>();
const deviceSessions = new Map<string, EioSession>(); // device_id -> active phone session
const streamCache = new Map<string, DeviceStreamSlot>();

// In-process pending command requests (Otter MCP / Admin -> Phone)
let localCmdSeq = 0;
const localPendingCmds = new Map<
  string,
  {
    deviceId: string;
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

// Periodic Engine.IO Ping & Stale Session Reaper
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeatLoop() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [, session] of eioSessions) {
      if (now - session.lastPongAt > PING_INTERVAL_MS + PING_TIMEOUT_MS + 5000) {
        destroySession(session);
        continue;
      }
      sendEioRaw(session, "2");
    }
  }, PING_INTERVAL_MS);
  if (typeof (heartbeatInterval as any).unref === "function") {
    (heartbeatInterval as any).unref();
  }
}

export function shutdownPhoneCloud(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  for (const [, p] of localPendingCmds) {
    clearTimeout(p.timer);
    p.reject(new Error("PhoneCloud đang đóng"));
  }
  localPendingCmds.clear();
  for (const [, s] of eioSessions) {
    destroySession(s);
  }
  eioSessions.clear();
  deviceSessions.clear();
  streamCache.clear();
  remoteSession.disconnect();
}

// ---------------------------------------------------------------------------
// SQLite CRUD & Auth
// ---------------------------------------------------------------------------

export function canRegisterFromIp(clientIp?: string): { ok: boolean; error?: string } {
  const ip = clientIp || "unknown";
  const trusted = ip === "unknown" || isTrustedHostOrIp(ip);
  if (!trusted && !allowPublicRegister) {
    return {
      ok: false,
      error: "Đăng ký thiết bị từ Internet đang khóa. Hãy mở khóa trong Dashboard -> PhoneCloud.",
    };
  }
  const limit = trusted ? 30 : 6;
  if (!checkRateBucket(registerByIp, ip, limit, 60_000)) {
    return { ok: false, error: "Quá nhiều yêu cầu đăng ký, vui lòng thử lại sau 1 phút." };
  }
  return { ok: true };
}

export function registerPhoneDevice(name = "", db: Database = getDatabase()) {
  const countRow = db.query("SELECT COUNT(*) as cnt FROM phone_devices").get() as { cnt: number };
  if ((countRow?.cnt ?? 0) >= MAX_DEVICES) {
    throw new Error(`Đã đạt giới hạn tối đa ${MAX_DEVICES} thiết bị.`);
  }

  let deviceId = randomDigits(8);
  while (db.query("SELECT 1 FROM phone_devices WHERE device_id = ?").get(deviceId)) {
    deviceId = randomDigits(8);
  }

  const password = randomDigits(6);
  const key = crypto.randomUUID();
  const cleanName = String(name || "").trim().slice(0, 80);
  const now = Date.now();

  db.query(
    `INSERT INTO phone_devices (device_id, password, device_key, name, quality, fps, screen_width, screen_height, orientation, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, 720, 30, 0, 0, 'portrait', NULL, ?)`
  ).run(deviceId, password, key, cleanName, now);

  if (!selectedLocalDeviceId) selectedLocalDeviceId = deviceId;

  return {
    status: true as const,
    device_id: deviceId,
    password,
    key,
    name: cleanName,
    ws_path: "/socket.io" as const,
    quality: 720 as PhoneQuality,
    fps: 30 as PhoneFrameRate,
    created_at: new Date(now).toISOString(),
  };
}

export function getPhoneDevice(deviceId: string, db: Database = getDatabase()): PhoneDeviceRow | null {
  if (!deviceId) return null;
  return (db.query("SELECT * FROM phone_devices WHERE device_id = ?").get(String(deviceId)) as PhoneDeviceRow) || null;
}

function getPhoneDeviceByKey(key: string, db: Database = getDatabase()): PhoneDeviceRow | null {
  if (!key) return null;
  return (db.query("SELECT * FROM phone_devices WHERE device_key = ?").get(String(key)) as PhoneDeviceRow) || null;
}

function viewersCountOf(deviceId: string): number {
  let n = 0;
  for (const s of eioSessions.values()) {
    if (s.role === "control" && s.deviceId === deviceId) n++;
  }
  return n;
}

function toPublicDevice(row: PhoneDeviceRow): PhoneDevicePublic {
  return {
    device_id: row.device_id,
    name: row.name,
    online: deviceSessions.has(row.device_id),
    quality: normalizeQuality(row.quality),
    fps: normalizeFps(row.fps),
    screenWidth: row.screen_width || 0,
    screenHeight: row.screen_height || 0,
    orientation: row.orientation || "portrait",
    lastSeenAt: row.last_seen_at ?? null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export function listPhoneDevicesPublic(db: Database = getDatabase()): PhoneDevicePublic[] {
  const rows = db.query("SELECT * FROM phone_devices ORDER BY created_at DESC").all() as PhoneDeviceRow[];
  return rows.map(toPublicDevice);
}

export function listPhoneDevicesAdmin(db: Database = getDatabase()): PhoneDeviceAdmin[] {
  const rows = db.query("SELECT * FROM phone_devices ORDER BY created_at DESC").all() as PhoneDeviceRow[];
  return rows.map((row) => ({
    ...toPublicDevice(row),
    password: row.password,
    viewers: viewersCountOf(row.device_id),
    hasKeyframe: Boolean(streamCache.get(row.device_id)?.keyframe),
  }));
}

export function renamePhoneDevice(deviceId: string, name: string, db: Database = getDatabase()): PhoneDeviceAdmin | null {
  const row = getPhoneDevice(deviceId, db);
  if (!row) return null;
  const cleanName = String(name || "").trim().slice(0, 80);
  db.query("UPDATE phone_devices SET name = ? WHERE device_id = ?").run(cleanName, deviceId);
  const updated = getPhoneDevice(deviceId, db)!;
  return {
    ...toPublicDevice(updated),
    password: updated.password,
    viewers: viewersCountOf(deviceId),
    hasKeyframe: Boolean(streamCache.get(deviceId)?.keyframe),
  };
}

export function rotatePhonePassword(deviceId: string, db: Database = getDatabase()): string | null {
  const row = getPhoneDevice(deviceId, db);
  if (!row) return null;
  let nextPass = randomDigits(6);
  while (nextPass === row.password) nextPass = randomDigits(6);
  db.query("UPDATE phone_devices SET password = ? WHERE device_id = ?").run(nextPass, deviceId);
  // Ngắt các phiên viewer cũ đang dùng mật khẩu cũ
  for (const s of [...eioSessions.values()]) {
    if (s.role === "control" && s.deviceId === deviceId) {
      destroySession(s);
    }
  }
  return nextPass;
}

export function deletePhoneDevice(deviceId: string, db: Database = getDatabase()): boolean {
  const row = getPhoneDevice(deviceId, db);
  if (!row) return false;
  db.query("DELETE FROM phone_devices WHERE device_id = ?").run(deviceId);
  streamCache.delete(deviceId);
  if (selectedLocalDeviceId === deviceId) selectedLocalDeviceId = null;
  for (const s of [...eioSessions.values()]) {
    if (s.deviceId === deviceId) destroySession(s);
  }
  return true;
}

export function verifyPhoneControl(
  deviceId: string,
  passwd: string,
  clientIp = "unknown",
  db: Database = getDatabase()
): { ok: true; device: PhoneDeviceRow } | { ok: false; status: number; msg: string } {
  const bucketKey = `${clientIp}:${deviceId}`;
  const slot = authFailuresByIp.get(bucketKey);
  if (slot && Date.now() < slot.resetAt && slot.count >= 8) {
    return { ok: false, status: 429, msg: "Nhập sai quá nhiều lần, vui lòng chờ 1 phút" };
  }

  const row = getPhoneDevice(String(deviceId || ""), db);
  if (!row || !safeEqualStr(row.password, String(passwd || ""))) {
    checkRateBucket(authFailuresByIp, bucketKey, 999, 60_000);
    return { ok: false, status: 401, msg: "sai ID hoặc mật khẩu" };
  }

  authFailuresByIp.delete(bucketKey);
  return { ok: true, device: row };
}

export function updatePhoneStreamSettings(
  deviceId: string,
  quality: number,
  fps: number,
  db: Database = getDatabase()
): { status: true; quality: PhoneQuality; fps: PhoneFrameRate; online: boolean } {
  if (!ALLOWED_QUALITY.has(quality) || !ALLOWED_FPS.has(fps)) {
    throw new Error("quality phải là 360, 480, 720 hoặc 1080; fps phải là 15, 24 hoặc 30");
  }
  const row = getPhoneDevice(deviceId, db);
  if (!row) throw new Error("Không tìm thấy thiết bị");

  db.query("UPDATE phone_devices SET quality = ?, fps = ? WHERE device_id = ?").run(quality, fps, deviceId);
  const q = quality as PhoneQuality;
  const f = fps as PhoneFrameRate;

  const devSession = deviceSessions.get(deviceId);
  if (devSession) {
    emitSioEvent(devSession, "settings", { quality: q, fps: f });
    return { status: true, quality: q, fps: f, online: true };
  }
  return { status: true, quality: q, fps: f, online: false };
}

export function getPhoneRelayHealth(db: Database = getDatabase()) {
  const countRow = db.query("SELECT COUNT(*) as cnt FROM phone_devices").get() as { cnt: number };
  const rate = rollMeter(Date.now());
  let viewers = 0;
  for (const s of eioSessions.values()) {
    if (s.role === "control") viewers++;
  }
  return {
    ok: true,
    devices: countRow?.cnt ?? 0,
    online: deviceSessions.size,
    viewers,
    frames: rate.frames,
    dropped: rate.dropped,
    mbps: rate.mbps,
    allowPublicRegister,
    activeDeviceId: resolveDefaultLocalDeviceId(db),
    remoteSession: remoteSession.isConnected() ? remoteSession.info() : null,
    uptimeSec: Math.round(process.uptime()),
  };
}

// ---------------------------------------------------------------------------
// Engine.IO v4 + Socket.IO v4 Framing & Transport Handlers
// ---------------------------------------------------------------------------

function createEioSession(clientIp: string, directWs: any | null): EioSession {
  ensureHeartbeatLoop();
  const sid = crypto.randomUUID().replace(/-/g, "");
  const sioSid = crypto.randomUUID().replace(/-/g, "");
  const session: EioSession = {
    sid,
    sioSid,
    ws: directWs,
    probeWs: null,
    upgraded: Boolean(directWs),
    pollQueue: [],
    pollWaiter: null,
    pollTimer: null,
    pendingBinary: null,
    role: null,
    deviceId: null,
    clientIp,
    createdAt: Date.now(),
    lastPongAt: Date.now(),
    authTimer: null,
  };
  session.authTimer = setTimeout(() => {
    if (!session.role) destroySession(session);
  }, AUTH_DEADLINE_MS);
  if (typeof (session.authTimer as any).unref === "function") {
    (session.authTimer as any).unref();
  }
  eioSessions.set(sid, session);
  return session;
}

function flushPollWaiter(session: EioSession, fallbackPacket?: string) {
  if (!session.pollWaiter) return;
  const waiter = session.pollWaiter;
  session.pollWaiter = null;
  if (session.pollTimer) {
    clearTimeout(session.pollTimer);
    session.pollTimer = null;
  }
  if (session.pollQueue.length > 0) {
    waiter(session.pollQueue.splice(0).join("\x1e"));
  } else if (fallbackPacket) {
    waiter(fallbackPacket);
  }
}

function sendEioRaw(session: EioSession, packet: string, binaryAttachments?: Uint8Array[]) {
  if (session.upgraded && session.ws) {
    try {
      session.ws.send(packet);
      if (binaryAttachments) {
        for (const bin of binaryAttachments) {
          session.ws.send(bin);
        }
      }
    } catch {}
    return;
  }

  session.pollQueue.push(packet);
  if (binaryAttachments) {
    for (const bin of binaryAttachments) {
      session.pollQueue.push("b" + Buffer.from(bin).toString("base64"));
    }
  }
  flushPollWaiter(session);
}

function isOutboundBusy(session: EioSession): boolean {
  if (session.upgraded && session.ws) {
    try {
      if (typeof session.ws.getBufferedAmount === "function") {
        return session.ws.getBufferedAmount() > WS_DROP_BUFFERED_BYTES;
      }
    } catch {}
    return false;
  }
  return session.pollQueue.length > 6;
}

function emitSioEvent(session: EioSession, eventName: string, payload: any) {
  if (payload instanceof Uint8Array || Buffer.isBuffer(payload) || payload instanceof ArrayBuffer) {
    const bytes =
      payload instanceof Uint8Array
        ? payload
        : new Uint8Array(payload as ArrayBuffer);
    const header = `451-${JSON.stringify([eventName, { _placeholder: true, num: 0 }])}`;
    sendEioRaw(session, header, [bytes]);
    return;
  }
  sendEioRaw(session, `42${JSON.stringify([eventName, payload])}`);
}

function relayToViewers(deviceId: string, eventName: string, payload: any, droppable: boolean) {
  let sent = 0;
  let dropped = 0;
  for (const s of eioSessions.values()) {
    if (s.role !== "control" || s.deviceId !== deviceId) continue;
    if (droppable && isOutboundBusy(s)) {
      dropped += 1;
      continue;
    }
    emitSioEvent(s, eventName, payload);
    sent += 1;
  }
  return { sent, dropped };
}

function destroySession(session: EioSession) {
  if (!eioSessions.has(session.sid)) return;
  eioSessions.delete(session.sid);
  if (session.authTimer) {
    clearTimeout(session.authTimer);
    session.authTimer = null;
  }
  flushPollWaiter(session, "1");
  try {
    session.probeWs?.close();
  } catch {}
  try {
    session.ws?.close();
  } catch {}
  session.probeWs = null;
  session.ws = null;

  if (session.role === "device" && session.deviceId) {
    if (deviceSessions.get(session.deviceId) === session) {
      deviceSessions.delete(session.deviceId);
      try {
        getDatabase()
          .query("UPDATE phone_devices SET last_seen_at = ? WHERE device_id = ?")
          .run(Date.now(), session.deviceId);
      } catch {}
      relayToViewers(session.deviceId, "device_status", { online: false }, false);
      // Hủy ngay các lệnh đang chờ phản hồi từ máy vừa rớt mạng
      for (const [taskId, pending] of localPendingCmds) {
        if (pending.deviceId === session.deviceId) {
          clearTimeout(pending.timer);
          localPendingCmds.delete(taskId);
          pending.reject(new Error("Điện thoại vừa mất kết nối"));
        }
      }
    }
  }
}

function replaceBinaryPlaceholders(val: any, buffers: Uint8Array[]): any {
  if (!val) return val;
  if (typeof val === "object" && val._placeholder === true && typeof val.num === "number") {
    return buffers[val.num] ?? new Uint8Array(0);
  }
  if (Array.isArray(val)) {
    return val.map((item) => replaceBinaryPlaceholders(item, buffers));
  }
  if (typeof val === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = replaceBinaryPlaceholders(v, buffers);
    }
    return out;
  }
  return val;
}

function handleSioEvent(session: EioSession, event: string, data: any) {
  const db = getDatabase();

  if (event === "join_room") {
    const payload = data && typeof data === "object" ? data : {};

    // 1. Điện thoại Android gia nhập bằng UUID key bí mật
    if (payload.key) {
      const dev = getPhoneDeviceByKey(String(payload.key), db);
      if (!dev) {
        emitSioEvent(session, "joined", { status: false, msg: "key không hợp lệ" });
        return;
      }
      const prev = deviceSessions.get(dev.device_id);
      session.role = "device";
      session.deviceId = dev.device_id;
      if (session.authTimer) {
        clearTimeout(session.authTimer);
        session.authTimer = null;
      }
      deviceSessions.set(dev.device_id, session);
      if (prev && prev !== session) {
        destroySession(prev);
      }

      const w = Number(payload.width) || 0;
      const h = Number(payload.height) || 0;
      db.query(
        `UPDATE phone_devices
         SET screen_width = CASE WHEN ? > 0 THEN ? ELSE screen_width END,
             screen_height = CASE WHEN ? > 0 THEN ? ELSE screen_height END,
             last_seen_at = ?
         WHERE device_id = ?`
      ).run(w, w, h, h, Date.now(), dev.device_id);

      if (!selectedLocalDeviceId) selectedLocalDeviceId = dev.device_id;

      const quality = normalizeQuality(dev.quality);
      const fps = normalizeFps(dev.fps);
      emitSioEvent(session, "joined", {
        status: true,
        device_id: dev.device_id,
        quality,
        fps,
      });
      relayToViewers(dev.device_id, "device_status", { online: true }, false);
      // Nếu đang có viewer xem trực tiếp, tự bật luồng hình ngay
      if (viewersCountOf(dev.device_id) > 0) {
        emitSioEvent(session, "stream", { status: true });
      }
      return;
    }

    // 2. Web Viewer / Controller gia nhập bằng device_id + passwd
    if (payload.device_id) {
      const check = verifyPhoneControl(
        String(payload.device_id),
        String(payload.passwd || ""),
        session.clientIp,
        db
      );
      if (!check.ok) {
        emitSioEvent(session, "joined", { status: false, msg: check.msg });
        return;
      }
      const dev = check.device;
      session.role = "control";
      session.deviceId = dev.device_id;
      if (session.authTimer) {
        clearTimeout(session.authTimer);
        session.authTimer = null;
      }

      emitSioEvent(session, "joined", {
        status: true,
        online: deviceSessions.has(dev.device_id),
        quality: normalizeQuality(dev.quality),
        fps: normalizeFps(dev.fps),
      });

      // Phát lại ngay video_meta + keyframe cuối cho viewer vừa vào
      const cached = streamCache.get(dev.device_id);
      if (cached?.meta) emitSioEvent(session, "video_meta", cached.meta);
      if (cached?.keyframe) emitSioEvent(session, "screen", cached.keyframe);
      return;
    }

    emitSioEvent(session, "joined", { status: false, msg: "thiếu thông tin xác thực" });
    return;
  }

  if (session.role === "device" && session.deviceId) {
    const devId = session.deviceId;

    if (event === "video_meta") {
      const meta = typeof data === "string" ? JSON.parse(data) : data;
      const slot = streamCache.get(devId) || {};
      slot.meta = meta;
      slot.keyframe = undefined;
      streamCache.set(devId, slot);

      const sw = Number(meta?.screenWidth || meta?.width || 0);
      const sh = Number(meta?.screenHeight || meta?.height || 0);
      if (sw > 0 && sh > 0) {
        try {
          db.query(
            "UPDATE phone_devices SET screen_width = ?, screen_height = ?, last_seen_at = ? WHERE device_id = ?"
          ).run(sw, sh, Date.now(), devId);
        } catch {}
      }
      relayToViewers(devId, "video_meta", meta, false);
      return;
    }

    if (event === "screen") {
      const bytes =
        data instanceof Uint8Array
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : Buffer.isBuffer(data)
              ? new Uint8Array(data)
              : null;
      if (!bytes || bytes.length < 1) return;
      const isKey = (bytes[0]! & 1) === 1;
      if (isKey) {
        const slot = streamCache.get(devId) || {};
        slot.keyframe = new Uint8Array(bytes);
        streamCache.set(devId, slot);
      }
      const res = relayToViewers(devId, "screen", bytes, !isKey);
      noteFrame(bytes.length, false);
      if (res.dropped > 0) noteFrame(0, true);
      return;
    }

    if (event === "message") {
      const msg = typeof data === "string" ? JSON.parse(data) : data;
      const slot = streamCache.get(devId) || {};
      slot.lastMessage = msg;
      streamCache.set(devId, slot);

      if (msg?.action === "orientation" && msg.width && msg.height) {
        try {
          db.query(
            "UPDATE phone_devices SET orientation = ?, screen_width = ?, screen_height = ?, last_seen_at = ? WHERE device_id = ?"
          ).run(String(msg.value || "portrait"), Number(msg.width), Number(msg.height), Date.now(), devId);
        } catch {}
      }
      relayToViewers(devId, "message", msg, false);
      return;
    }

    if (event === "result") {
      const resObj = typeof data === "string" ? JSON.parse(data) : data;
      const taskId = resObj?.taskId ? String(resObj.taskId) : "";
      if (taskId && localPendingCmds.has(taskId)) {
        const pending = localPendingCmds.get(taskId)!;
        clearTimeout(pending.timer);
        localPendingCmds.delete(taskId);
        if (resObj.status) pending.resolve(resObj.data);
        else pending.reject(new Error(resObj.msg || "Lệnh trên điện thoại thất bại"));
      }
      relayToViewers(devId, "result", resObj, false);
      return;
    }
    return;
  }

  if (session.role === "control" && session.deviceId) {
    const phoneSession = deviceSessions.get(session.deviceId);
    if (!phoneSession) return;

    if (event === "command") {
      const droppable = data?.action === "pointerEvent" && data?.phase === "move";
      if (droppable && isOutboundBusy(phoneSession)) return;
      emitSioEvent(phoneSession, "command", data);
      return;
    }

    if (event === "stream") {
      emitSioEvent(phoneSession, "stream", data);
      // Nếu người xem tắt stream nhưng vẫn còn người xem khác đang mở thì giữ nguyên
      return;
    }
  }
}

function handleEioIncomingFrame(session: EioSession, raw: string | Uint8Array, wsSource?: any) {
  session.lastPongAt = Date.now();

  if (typeof raw !== "string") {
    const pending = session.pendingBinary;
    if (!pending) return;
    pending.buffers.push(raw);
    if (pending.buffers.length >= pending.expected) {
      session.pendingBinary = null;
      const reconstructedArgs = replaceBinaryPlaceholders(pending.args, pending.buffers);
      try {
        handleSioEvent(session, pending.event, reconstructedArgs[0]);
      } catch (err) {
        console.warn("[PhoneCloud] Binary event error:", err);
      }
    }
    return;
  }

  if (!raw) return;
  const eioType = raw[0];

  // Engine.IO PING
  if (eioType === "2") {
    const suffix = raw.slice(1);
    if (wsSource && wsSource === session.probeWs) {
      // Probe trên WS đang nâng cấp: trả "3probe" và đánh thức polling GET bằng NOOP "6"
      try {
        wsSource.send(`3${suffix}`);
      } catch {}
      if (session.pollQueue.length === 0) {
        flushPollWaiter(session, "6");
      }
    } else {
      sendEioRaw(session, `3${suffix}`);
    }
    return;
  }

  // Engine.IO PONG
  if (eioType === "3") {
    return;
  }

  // Engine.IO UPGRADE ("5")
  if (eioType === "5") {
    if (wsSource) {
      session.ws = wsSource;
      session.probeWs = null;
      session.upgraded = true;
      flushPollWaiter(session, "6");
      // Xả các gói còn tồn trong hàng đợi polling sang WebSocket mới nâng cấp
      if (session.pollQueue.length > 0) {
        const leftover = session.pollQueue.splice(0);
        for (const pkt of leftover) {
          try {
            if (pkt.startsWith("b")) {
              session.ws.send(Buffer.from(pkt.slice(1), "base64"));
            } else {
              session.ws.send(pkt);
            }
          } catch {}
        }
      }
    }
    return;
  }

  // Engine.IO CLOSE ("1")
  if (eioType === "1") {
    destroySession(session);
    return;
  }

  // Engine.IO MESSAGE ("4" + Socket.IO v4 packet)
  if (eioType === "4") {
    const sio = raw.slice(1);
    if (!sio) return;
    const sioType = sio[0];

    // Socket.IO CONNECT ("0" hoặc "0{...}")
    if (sioType === "0") {
      sendEioRaw(session, `40${JSON.stringify({ sid: session.sioSid })}`);
      return;
    }

    // Socket.IO DISCONNECT ("1")
    if (sioType === "1") {
      destroySession(session);
      return;
    }

    // Socket.IO EVENT ("2[...]")
    if (sioType === "2") {
      const bracketIdx = sio.indexOf("[");
      if (bracketIdx < 0) return;
      try {
        const arr = JSON.parse(sio.slice(bracketIdx));
        if (Array.isArray(arr) && typeof arr[0] === "string") {
          handleSioEvent(session, arr[0], arr[1]);
        }
      } catch {}
      return;
    }

    // Socket.IO BINARY_EVENT ("51-[...]")
    if (sioType === "5") {
      const dashIdx = sio.indexOf("-");
      const bracketIdx = dashIdx > 0 ? sio.indexOf("[", dashIdx) : -1;
      if (dashIdx < 0 || bracketIdx < 0) return;
      const expected = Number(sio.slice(1, dashIdx));
      if (!Number.isInteger(expected) || expected < 1 || expected > 8) return;
      try {
        const arr = JSON.parse(sio.slice(bracketIdx));
        if (Array.isArray(arr) && typeof arr[0] === "string") {
          session.pendingBinary = {
            event: arr[0],
            args: arr.slice(1),
            expected,
            buffers: [],
          };
        }
      } catch {}
    }
  }
}

function buildHandshakePacket(sid: string, upgrades: string[]): string {
  return (
    "0" +
    JSON.stringify({
      sid,
      upgrades,
      pingInterval: PING_INTERVAL_MS,
      pingTimeout: PING_TIMEOUT_MS,
      maxPayload: MAX_PAYLOAD_BYTES,
    })
  );
}

const SIO_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Thử nâng cấp WebSocket cho `/socket.io/*` (`transport=websocket`).
 * Trả về `undefined` nếu đã upgrade thành công, `Response` nếu lỗi, hoặc `null` nếu không phải WS upgrade.
 */
export function tryUpgradePhoneSocketIo(req: Request, url: URL, server: any): Response | undefined | null {
  if (url.pathname !== "/socket.io" && !url.pathname.startsWith("/socket.io/")) {
    return null;
  }
  const transport = url.searchParams.get("transport");
  if (transport !== "websocket" || req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return null;
  }

  const sid = url.searchParams.get("sid");
  const clientIp = server.requestIP?.(req)?.address || "unknown";

  if (sid) {
    const existing = eioSessions.get(sid);
    if (!existing) {
      return new Response(JSON.stringify({ code: 1, message: "Session ID unknown" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...SIO_CORS_HEADERS },
      });
    }
    const ok = server.upgrade(req, {
      data: { kind: "phonecloud", sid: existing.sid, isUpgrade: true, clientIp },
    });
    return ok ? undefined : new Response("WebSocket Upgrade Failed", { status: 400 });
  }

  const session = createEioSession(clientIp, null);
  const ok = server.upgrade(req, {
    data: { kind: "phonecloud", sid: session.sid, isUpgrade: false, clientIp },
  });
  if (!ok) {
    destroySession(session);
    return new Response("WebSocket Upgrade Failed", { status: 400 });
  }
  return undefined;
}

/**
 * Xử lý HTTP Long-Polling cho `/socket.io/*` (`transport=polling`).
 */
export async function handlePhoneSocketIoPolling(
  req: Request,
  url: URL,
  clientIp = "unknown"
): Promise<Response | null> {
  if (url.pathname !== "/socket.io" && !url.pathname.startsWith("/socket.io/")) {
    return null;
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: SIO_CORS_HEADERS });
  }
  const transport = url.searchParams.get("transport") || "polling";
  if (transport !== "polling") return null;

  const sid = url.searchParams.get("sid");

  // 1. Mở phiên polling mới
  if (!sid && req.method === "GET") {
    const session = createEioSession(clientIp, null);
    const body = buildHandshakePacket(session.sid, ["websocket"]);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "Cache-Control": "no-store",
        ...SIO_CORS_HEADERS,
      },
    });
  }

  const session = sid ? eioSessions.get(sid) : undefined;
  if (!session) {
    return new Response(JSON.stringify({ code: 1, message: "Session ID unknown" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...SIO_CORS_HEADERS },
    });
  }

  // 2. Client đẩy gói tin lên qua POST
  if (req.method === "POST") {
    const text = await req.text();
    const parts = text.split("\x1e");
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith("b")) {
        const bytes = new Uint8Array(Buffer.from(part.slice(1), "base64"));
        handleEioIncomingFrame(session, bytes);
      } else {
        handleEioIncomingFrame(session, part);
      }
    }
    return new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=UTF-8", ...SIO_CORS_HEADERS },
    });
  }

  // 3. Client kéo gói tin về qua GET long-polling
  if (req.method === "GET") {
    if (session.upgraded) {
      return new Response("6", {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=UTF-8", ...SIO_CORS_HEADERS },
      });
    }
    if (session.pollQueue.length > 0) {
      const payload = session.pollQueue.splice(0).join("\x1e");
      return new Response(payload, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "Cache-Control": "no-store",
          ...SIO_CORS_HEADERS,
        },
      });
    }
    const payload = await new Promise<string>((resolve) => {
      flushPollWaiter(session, "6");
      session.pollWaiter = resolve;
      session.pollTimer = setTimeout(() => {
        if (session.pollWaiter === resolve) {
          session.pollWaiter = null;
          session.pollTimer = null;
          resolve("6");
        }
      }, 18_000);
    });
    return new Response(payload, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
        "Cache-Control": "no-store",
        ...SIO_CORS_HEADERS,
      },
    });
  }

  return null;
}

export function onPhoneWsOpen(ws: any): void {
  const sid = ws.data?.sid;
  const session = sid ? eioSessions.get(sid) : undefined;
  if (!session) {
    try {
      ws.close();
    } catch {}
    return;
  }
  if (ws.data?.isUpgrade) {
    session.probeWs = ws;
  } else {
    session.ws = ws;
    session.upgraded = true;
    try {
      ws.send(buildHandshakePacket(session.sid, []));
    } catch {}
  }
}

export function onPhoneWsMessage(ws: any, msg: string | Buffer | Uint8Array): void {
  const sid = ws.data?.sid;
  const session = sid ? eioSessions.get(sid) : undefined;
  if (!session) return;
  if (typeof msg === "string") {
    handleEioIncomingFrame(session, msg, ws);
  } else {
    const bytes = msg instanceof Uint8Array ? msg : new Uint8Array(msg);
    handleEioIncomingFrame(session, bytes, ws);
  }
}

export function onPhoneWsClose(ws: any): void {
  const sid = ws.data?.sid;
  const session = sid ? eioSessions.get(sid) : undefined;
  if (!session) return;
  if (session.probeWs === ws) {
    session.probeWs = null;
    return;
  }
  if (session.ws === ws) {
    destroySession(session);
  }
}

// ---------------------------------------------------------------------------
// Remote Relay Bridge (Optional: khi điều khiển máy nối tới Relay ngoài)
// ---------------------------------------------------------------------------

class RemotePhoneSession {
  api = "";
  deviceId = "";
  password = "";
  name = "";
  quality = 720;
  fps = 30;
  phoneOnline = false;
  screenW = 0;
  screenH = 0;
  socket: RemoteSocket | null = null;
  pending = new Map<string, { resolve: (d: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  seq = 0;

  isConnected(): boolean {
    return Boolean(this.socket && this.socket.connected);
  }

  async connect(opts: { api: string; deviceId: string; password: string }) {
    this.api = String(opts.api || "").replace(/\/$/, "");
    this.deviceId = String(opts.deviceId || "");
    this.password = String(opts.password || "");
    if (!this.api || !this.deviceId || !this.password) {
      throw new Error("Kết nối Relay ngoài cần đủ api, device_id và password");
    }

    const r = await fetch(`${this.api}/api/control/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: this.deviceId, passwd: this.password }),
    });
    const info: any = await r.json();
    if (!info.status) throw new Error(info.msg || "Không kết nối được Relay ngoài");

    this.phoneOnline = Boolean(info.online);
    this.quality = info.quality || 720;
    this.fps = info.fps || 30;
    this.name = info.name || "";

    this.disconnect();
    const s = createRemoteSocket(this.api, {
      path: "/socket.io",
      transports: ["websocket"],
      timeout: 8000,
    });
    this.socket = s;

    s.on("device_status", (d: any) => {
      this.phoneOnline = Boolean(d?.online);
    });
    s.on("video_meta", (d: any) => {
      try {
        const m = typeof d === "string" ? JSON.parse(d) : d;
        this.screenW = m.screenWidth || m.width || this.screenW;
        this.screenH = m.screenHeight || m.height || this.screenH;
      } catch {}
    });
    s.on("result", (d: any) => {
      const res = typeof d === "string" ? JSON.parse(d) : d;
      const p = res?.taskId ? this.pending.get(res.taskId) : undefined;
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(res.taskId);
      if (res.status) p.resolve(res.data);
      else p.reject(new Error(res.msg || "Lệnh thất bại"));
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Hết thời gian nối Socket.IO tới Relay ngoài")), 8000);
      s.on("connect_error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      s.on("connect", () => {
        s.emit("join_room", { device_id: this.deviceId, passwd: this.password });
      });
      s.on("joined", (d: any) => {
        clearTimeout(timer);
        if (!d?.status) reject(new Error(d?.msg || "Relay ngoài từ chối vào phòng"));
        else resolve();
      });
    });

    return this.info();
  }

  info() {
    return {
      mode: "remote" as const,
      api: this.api,
      deviceId: this.deviceId,
      name: this.name,
      online: this.phoneOnline,
      quality: this.quality,
      fps: this.fps,
      screenWidth: this.screenW || null,
      screenHeight: this.screenH || null,
      connected: this.isConnected(),
    };
  }

  disconnect() {
    if (this.socket) {
      try {
        this.socket.disconnect();
      } catch {}
      this.socket = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Đã ngắt kết nối Relay ngoài"));
    }
    this.pending.clear();
  }

  fire(action: string, extra?: Record<string, any>) {
    if (!this.socket || !this.socket.connected) throw new Error("Chưa kết nối Relay ngoài");
    this.socket.emit("command", { action, taskId: `rm_${++this.seq}`, ...(extra || {}) });
  }

  request(action: string, extra?: Record<string, any>, timeoutMs = 8000): Promise<any> {
    if (!this.socket || !this.socket.connected) throw new Error("Chưa kết nối Relay ngoài");
    const taskId = `rm_${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        reject(new Error(`Hết thời gian chờ lệnh: ${action}`));
      }, timeoutMs);
      this.pending.set(taskId, { resolve, reject, timer });
      this.socket!.emit("command", { action, taskId, ...(extra || {}) });
    });
  }
}

const remoteSession = new RemotePhoneSession();

// ---------------------------------------------------------------------------
// Unified Controller API (Local Direct In-Process + Remote Fallback)
// ---------------------------------------------------------------------------

function resolveDefaultLocalDeviceId(db: Database = getDatabase()): string | null {
  if (selectedLocalDeviceId && getPhoneDevice(selectedLocalDeviceId, db)) {
    return selectedLocalDeviceId;
  }
  // Tự chọn máy đang online đầu tiên
  for (const devId of deviceSessions.keys()) {
    selectedLocalDeviceId = devId;
    return devId;
  }
  // Hoặc máy duy nhất đã đăng ký
  const rows = db.query("SELECT device_id FROM phone_devices ORDER BY created_at DESC LIMIT 2").all() as {
    device_id: string;
  }[];
  if (rows.length === 1) {
    selectedLocalDeviceId = rows[0]!.device_id;
    return selectedLocalDeviceId;
  }
  return null;
}

function resolveLocalTarget(explicitDeviceId?: string, db: Database = getDatabase()): PhoneDeviceRow {
  const id = explicitDeviceId || resolveDefaultLocalDeviceId(db);
  if (!id) {
    throw new Error(
      "Chưa chọn hoặc chưa có thiết bị Android nào đăng ký. Gọi phone_list_devices / phone_connect hoặc đăng ký trên app PhoneCloud Agent."
    );
  }
  const row = getPhoneDevice(id, db);
  if (!row) throw new Error(`Không tìm thấy thiết bị ID '${id}'`);
  return row;
}

export async function phoneConnect(opts: {
  api?: string;
  deviceId: string;
  password?: string;
}) {
  const extApi = (opts.api || process.env.PHONECLOUD_API || "").trim();
  if (extApi) {
    if (!opts.password) {
      throw new Error("Khi nối Relay ngoài (api), cần cung cấp cả password 6 chữ số của thiết bị.");
    }
    return remoteSession.connect({ api: extApi, deviceId: opts.deviceId, password: opts.password });
  }

  // Chế độ tích hợp trực tiếp trên Otter: không cần socket trung gian
  remoteSession.disconnect();
  const db = getDatabase();
  const row = getPhoneDevice(opts.deviceId, db);
  if (!row) throw new Error(`Thiết bị '${opts.deviceId}' chưa đăng ký trên Otter.`);
  if (opts.password && !safeEqualStr(row.password, String(opts.password))) {
    throw new Error("Mật khẩu thiết bị không khớp.");
  }
  selectedLocalDeviceId = row.device_id;
  return phoneGetDeviceInfo(row.device_id);
}

export function phoneDisconnect() {
  const hadRemote = remoteSession.isConnected();
  remoteSession.disconnect();
  selectedLocalDeviceId = null;
  return { disconnected: true, hadRemote };
}

export function phoneGetDeviceInfo(deviceId?: string) {
  if (!deviceId && remoteSession.isConnected()) {
    return remoteSession.info();
  }
  const db = getDatabase();
  const row = resolveLocalTarget(deviceId, db);
  const slot = streamCache.get(row.device_id);
  return {
    mode: "local" as const,
    deviceId: row.device_id,
    name: row.name,
    online: deviceSessions.has(row.device_id),
    quality: normalizeQuality(row.quality),
    fps: normalizeFps(row.fps),
    screenWidth: row.screen_width || slot?.meta?.screenWidth || slot?.meta?.width || null,
    screenHeight: row.screen_height || slot?.meta?.screenHeight || slot?.meta?.height || null,
    orientation: row.orientation || "portrait",
    lastSeenAt: row.last_seen_at,
    connected: deviceSessions.has(row.device_id),
  };
}

export function phoneFireCommand(action: string, extra?: Record<string, any>, deviceId?: string) {
  if (!deviceId && remoteSession.isConnected()) {
    remoteSession.fire(action, extra);
    return { sent: true, mode: "remote", deviceId: remoteSession.deviceId };
  }
  const row = resolveLocalTarget(deviceId);
  const session = deviceSessions.get(row.device_id);
  if (!session) {
    throw new Error(`Điện thoại '${row.name || row.device_id}' (${row.device_id}) hiện đang offline.`);
  }
  const taskId = `ot_${++localCmdSeq}`;
  emitSioEvent(session, "command", { action, taskId, ...(extra || {}) });
  return { sent: true, mode: "local", deviceId: row.device_id, taskId };
}

export function phoneRequestCommand(
  action: string,
  extra?: Record<string, any>,
  timeoutMs = 8000,
  deviceId?: string
): Promise<any> {
  if (!deviceId && remoteSession.isConnected()) {
    return remoteSession.request(action, extra, timeoutMs);
  }
  const row = resolveLocalTarget(deviceId);
  const session = deviceSessions.get(row.device_id);
  if (!session) {
    return Promise.reject(
      new Error(`Điện thoại '${row.name || row.device_id}' (${row.device_id}) hiện đang offline.`)
    );
  }
  const taskId = `ot_${++localCmdSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      localPendingCmds.delete(taskId);
      reject(new Error(`Hết thời gian chờ điện thoại phản hồi lệnh: ${action}`));
    }, timeoutMs);
    localPendingCmds.set(taskId, { deviceId: row.device_id, resolve, reject, timer });
    emitSioEvent(session, "command", { action, taskId, ...(extra || {}) });
  });
}

// ---------------------------------------------------------------------------
// Semantic Selector & UI Tree Formatting Helpers
// ---------------------------------------------------------------------------

export interface PhoneSelectorCriteria {
  xpath?: string;
  text?: string;
  id?: string;
  className?: string;
  contentDescription?: string;
}

export function buildPhoneSelector(c: PhoneSelectorCriteria): string {
  const conds: string[] = [];
  const clean = (s: string) => String(s).replace(/"/g, "");
  if (c.text) conds.push(`contains(@text,"${clean(c.text)}")`);
  if (c.id) conds.push(`contains(@resource-id,"${clean(c.id)}")`);
  if (c.contentDescription) conds.push(`contains(@content-desc,"${clean(c.contentDescription)}")`);
  const cls = c.className ? String(c.className).trim() : "*";
  if (!conds.length) return `//${cls}`;
  return `//${cls}[${conds.join(" and ")}]`;
}

export function resolvePhoneSelector(c: PhoneSelectorCriteria): string {
  if (c.xpath && c.xpath.trim()) return c.xpath.trim();
  if (c.text || c.id || c.className || c.contentDescription) return buildPhoneSelector(c);
  throw new Error("Cần truyền xpath hoặc ít nhất một tiêu chí: text, id, className, contentDescription");
}

export function formatPhoneElements(list: PhoneUiElement[] | unknown): string {
  if (!Array.isArray(list) || list.length === 0) return "Không tìm thấy phần tử nào.";
  return list
    .map((el: PhoneUiElement, i: number) => {
      const b = el.bounds || [0, 0, 0, 0];
      const cx = Math.round((b[0] + b[2]) / 2);
      const cy = Math.round((b[1] + b[3]) / 2);
      const cls = (el.className || "").split(".").pop() || "*";
      const parts = [`#${i}`, cls, `center=(${cx},${cy})`, `bounds=[${b.join(",")}]`];
      if (el.text) parts.push(`text="${el.text}"`);
      if (el.contentDesc) parts.push(`desc="${el.contentDesc}"`);
      if (el.resourceId) parts.push(`id=${el.resourceId}`);
      if (el.clickable) parts.push("clickable");
      if (el.focused) parts.push("FOCUSED");
      return parts.join(" ");
    })
    .join("\n");
}

export function isRemotePhoneSessionActive(): boolean {
  return remoteSession.isConnected();
}

export async function setRemoteOrLocalQuality(quality: number, fps: number, deviceId?: string) {
  if (!deviceId && remoteSession.isConnected()) {
    if (!ALLOWED_QUALITY.has(quality) || !ALLOWED_FPS.has(fps)) {
      throw new Error("quality phải là 360, 480, 720 hoặc 1080; fps phải là 15, 24 hoặc 30");
    }
    const r = await fetch(`${remoteSession.api}/api/control/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id: remoteSession.deviceId,
        passwd: remoteSession.password,
        quality,
        fps,
      }),
    });
    const j: any = await r.json();
    if (!j.status) throw new Error(j.msg || "Đổi chất lượng trên Relay ngoài thất bại");
    remoteSession.quality = j.quality;
    remoteSession.fps = j.fps;
    return j;
  }

  const row = resolveLocalTarget(deviceId);
  return updatePhoneStreamSettings(row.device_id, quality, fps);
}
