/**
 * PhoneCloudBrowserClient — Trình giải mã H.264 WebCodecs độ trễ thấp & điều khiển cảm ứng trực tiếp
 * nối thẳng vào Otter Engine.IO v4 / Socket.IO v4 (`/socket.io/?EIO=4&transport=websocket`).
 *
 * Không cần nạp script ngoài (`window.io`), hỗ trợ cả `ws://` (Local/LAN/Tailscale) và `wss://` (Cloudflare Tunnel).
 */

export interface PhoneStreamStats {
  fps: number;
  bitrateMbps: number;
  frames: number;
  keyframes: number;
  totalMB: number;
  decodeQueue: number;
  width: number;
  height: number;
}

export interface PhoneUiNode {
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

export interface PhoneClientEvent {
  type: "video_meta" | "device_status" | "message" | "result" | "error";
  msg?: string;
  online?: boolean;
  data?: any;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function annexBToAvcc(data: Uint8Array): Uint8Array {
  const nals: Uint8Array[] = [];
  const n = data.length;
  let i = 0;
  while (i + 3 < n) {
    if (data[i] !== 0 || data[i + 1] !== 0) {
      i++;
      continue;
    }
    let scLen = 0;
    if (data[i + 2] === 1) scLen = 3;
    else if (data[i + 2] === 0 && data[i + 3] === 1) scLen = 4;
    if (!scLen) {
      i++;
      continue;
    }
    const start = i + scLen;
    let end = n;
    for (let j = start; j + 3 < n; j++) {
      if (
        data[j] === 0 &&
        data[j + 1] === 0 &&
        (data[j + 2] === 1 || (data[j + 2] === 0 && data[j + 3] === 1))
      ) {
        end = j;
        break;
      }
    }
    if (end > start) {
      const nalType = data[start]! & 0x1f;
      // Loại bỏ SEI(6), SPS(7), PPS(8), AUD(9) khi gói sang AVCC cho WebCodecs
      if (nalType !== 6 && nalType !== 7 && nalType !== 8 && nalType !== 9) {
        nals.push(data.subarray(start, end));
      }
    }
    i = end === start ? start + 1 : end;
  }

  let total = 0;
  for (const nal of nals) total += 4 + nal.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const nal of nals) {
    out[off] = (nal.length >>> 24) & 0xff;
    out[off + 1] = (nal.length >>> 16) & 0xff;
    out[off + 2] = (nal.length >>> 8) & 0xff;
    out[off + 3] = nal.length & 0xff;
    out.set(nal, off + 4);
    off += 4 + nal.length;
  }
  return out;
}

function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  const out = new Uint8Array(7 + 2 + sps.length + 1 + 2 + pps.length);
  let o = 0;
  out[o++] = 1;
  out[o++] = sps[1] || 0x64;
  out[o++] = sps[2] || 0x00;
  out[o++] = sps[3] || 0x1e;
  out[o++] = 0xff;
  out[o++] = 0xe1;
  out[o++] = (sps.length >> 8) & 0xff;
  out[o++] = sps.length & 0xff;
  out.set(sps, o);
  o += sps.length;
  out[o++] = 1;
  out[o++] = (pps.length >> 8) & 0xff;
  out[o++] = pps.length & 0xff;
  out.set(pps, o);
  return out;
}

function codecFromSps(sps: Uint8Array): string {
  const hex = (b: number) => b.toString(16).padStart(2, "0").toUpperCase();
  return `avc1.${hex(sps[1] || 0x64)}${hex(sps[2] || 0x00)}${hex(sps[3] || 0x1e)}`;
}

let clientTaskSeq = 0;

export class PhoneCloudBrowserClient {
  private baseOrigin: string;
  private deviceId: string;
  private password: string;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private onEvent: (ev: PhoneClientEvent) => void;
  private onConnect: (ok: boolean, detail?: any) => void;

  private ws: WebSocket | null = null;
  private decoder: VideoDecoder | null = null;
  private latestFrame: VideoFrame | null = null;
  private paintQueued = false;
  private waitKey = false;
  private lastKeyAsk = 0;
  private holdTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupListeners: (() => void) | null = null;

  private pendingBinaryEvent: string | null = null;
  private pending = new Map<
    string,
    { resolve: (d: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  public connected = false;
  public deviceWidth = 0;
  public deviceHeight = 0;

  private frames = 0;
  private keyframes = 0;
  private bytes = 0;
  private windowSamples: Array<{ t: number; bytes: number }> = [];

  constructor(opts: {
    api?: string;
    deviceId: string;
    password: string;
    canvas: HTMLCanvasElement;
    onEvent?: (ev: PhoneClientEvent) => void;
    onConnect?: (ok: boolean, detail?: any) => void;
  }) {
    this.baseOrigin = (opts.api || window.location.origin).replace(/\/$/, "");
    this.deviceId = String(opts.deviceId || "");
    this.password = String(opts.password || "");
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d", { alpha: false });
    this.onEvent = opts.onEvent || (() => {});
    this.onConnect = opts.onConnect || (() => {});
    this.bindCanvasInput();
  }

  async connect(): Promise<void> {
    const r = await fetch(`${this.baseOrigin}/api/control/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: this.deviceId, passwd: this.password }),
    });
    const j = await r.json();
    if (!j.status) throw new Error(j.msg || "Sai ID hoặc mật khẩu thiết bị");
    if (j.screenWidth && j.screenHeight) {
      this.deviceWidth = j.screenWidth;
      this.deviceHeight = j.screenHeight;
    }

    const wsUrl =
      this.baseOrigin.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:") +
      "/socket.io/?EIO=4&transport=websocket";

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Hết thời gian kết nối WebSocket tới PhoneCloud"));
        }
      }, 8000);

      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") {
          const evName = this.pendingBinaryEvent;
          this.pendingBinaryEvent = null;
          if (evName === "screen" && ev.data instanceof ArrayBuffer) {
            this.handleScreenBytes(new Uint8Array(ev.data));
          }
          return;
        }

        const raw = ev.data;
        if (!raw) return;

        // Engine.IO OPEN ("0{...}") -> gửi Socket.IO CONNECT "40"
        if (raw[0] === "0") {
          ws.send("40");
          return;
        }
        // Engine.IO PING ("2") -> trả PONG ("3")
        if (raw[0] === "2") {
          ws.send(`3${raw.slice(1)}`);
          return;
        }
        if (raw[0] !== "4") return;

        const sio = raw.slice(1);
        // Socket.IO CONNECT ACK ("0{...}") -> gửi join_room
        if (sio[0] === "0") {
          this.emitSio("join_room", { device_id: this.deviceId, passwd: this.password });
          return;
        }
        // Socket.IO BINARY_EVENT ("51-[...]")
        if (sio[0] === "5") {
          const bracket = sio.indexOf("[");
          if (bracket > 0) {
            try {
              const arr = JSON.parse(sio.slice(bracket));
              if (Array.isArray(arr) && typeof arr[0] === "string") {
                this.pendingBinaryEvent = arr[0];
              }
            } catch {}
          }
          return;
        }
        // Socket.IO JSON EVENT ("2[...]")
        if (sio[0] === "2") {
          const bracket = sio.indexOf("[");
          if (bracket < 0) return;
          try {
            const [eventName, payload] = JSON.parse(sio.slice(bracket));
            this.handleSioEvent(eventName, payload, (ok, detail) => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                if (ok) resolve();
                else reject(new Error(detail?.msg || "Từ chối vào phòng thiết bị"));
              }
            });
          } catch {}
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Lỗi kết nối WebSocket PhoneCloud"));
        }
      };

      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this.onConnect(false);
      };
    });
  }

  disconnect(): void {
    if (this.holdTimer) {
      clearInterval(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.cleanupListeners) {
      this.cleanupListeners();
      this.cleanupListeners = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.decoder) {
      try {
        this.decoder.close();
      } catch {}
      this.decoder = null;
    }
    if (this.latestFrame) {
      try {
        this.latestFrame.close();
      } catch {}
      this.latestFrame = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Đã ngắt kết nối"));
    }
    this.pending.clear();
    this.connected = false;
  }

  private emitSio(eventName: string, data: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(`42${JSON.stringify([eventName, data])}`);
  }

  private handleSioEvent(
    eventName: string,
    data: any,
    onInitialJoin: (ok: boolean, detail?: any) => void
  ): void {
    if (eventName === "joined") {
      this.connected = Boolean(data?.status);
      this.onConnect(this.connected, data);
      onInitialJoin(this.connected, data);
      if (this.connected) this.setStream(true);
      return;
    }
    if (eventName === "device_status") {
      this.onEvent({ type: "device_status", online: Boolean(data?.online), data });
      return;
    }
    if (eventName === "video_meta") {
      this.handleVideoMeta(data);
      return;
    }
    if (eventName === "message") {
      const msg = typeof data === "string" ? JSON.parse(data) : data;
      if (msg?.action === "orientation" && msg.width && msg.height) {
        this.deviceWidth = msg.width;
        this.deviceHeight = msg.height;
      }
      this.onEvent({ type: "message", data: msg });
      return;
    }
    if (eventName === "result") {
      const res = typeof data === "string" ? JSON.parse(data) : data;
      const p = res?.taskId ? this.pending.get(res.taskId) : undefined;
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(res.taskId);
        if (res.status) p.resolve(res.data);
        else p.reject(new Error(res.msg || "Lệnh trên điện thoại thất bại"));
      }
      this.onEvent({ type: "result", data: res });
    }
  }

  private handleVideoMeta(d: any): void {
    try {
      const meta = typeof d === "string" ? JSON.parse(d) : d;
      if (meta.screenWidth && meta.screenHeight) {
        this.deviceWidth = meta.screenWidth;
        this.deviceHeight = meta.screenHeight;
      } else if (!this.deviceWidth) {
        this.deviceWidth = meta.width || 0;
        this.deviceHeight = meta.height || 0;
      }
      if (typeof VideoDecoder === "undefined") {
        this.onEvent({ type: "error", msg: "Trình duyệt hiện tại không hỗ trợ WebCodecs (cần Chrome/Edge mới)" });
        return;
      }
      const sps = b64ToBytes(meta.sps);
      const pps = b64ToBytes(meta.pps);
      const codec = meta.codec || codecFromSps(sps);
      if (this.decoder) {
        try {
          this.decoder.close();
        } catch {}
      }
      this.waitKey = false;
      this.decoder = new VideoDecoder({
        output: (frame) => {
          if (this.latestFrame) this.latestFrame.close();
          this.latestFrame = frame;
          if (!this.paintQueued) {
            this.paintQueued = true;
            requestAnimationFrame(() => this.paintFrame());
          }
        },
        error: (e) => this.onEvent({ type: "error", msg: `WebCodecs: ${e.message}` }),
      });
      this.decoder.configure({
        codec,
        description: buildAvcC(sps, pps),
        hardwareAcceleration: "prefer-hardware",
        optimizeForLatency: true,
      });
      this.onEvent({ type: "video_meta", data: meta });
    } catch (err: any) {
      this.onEvent({ type: "error", msg: `video_meta: ${err?.message || err}` });
    }
  }

  private paintFrame(): void {
    this.paintQueued = false;
    const frame = this.latestFrame;
    this.latestFrame = null;
    if (!frame) return;
    if (this.ctx) {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this.ctx.drawImage(frame, 0, 0);
    }
    frame.close();
    if (this.latestFrame && !this.paintQueued) {
      this.paintQueued = true;
      requestAnimationFrame(() => this.paintFrame());
    }
  }

  private handleScreenBytes(data: Uint8Array): void {
    if (!this.decoder || this.decoder.state !== "configured" || data.length < 10) return;
    try {
      const isKey = (data[0]! & 1) === 1;
      const q = this.decoder.decodeQueueSize || 0;
      if (this.waitKey && !isKey) return;
      if (!isKey && q > 4) {
        this.waitKey = true;
        const now = performance.now();
        if (now - this.lastKeyAsk >= 500) {
          this.lastKeyAsk = now;
          this.requestKeyFrame();
        }
        return;
      }
      if (isKey) this.waitKey = false;
      const dv = new DataView(data.buffer, data.byteOffset + 1, 8);
      const pts = Number(dv.getBigUint64(0, false));
      const payload = annexBToAvcc(data.subarray(9));
      if (!payload.length) return;
      this.noteFrame(data.length, isKey);
      this.decoder.decode(
        new EncodedVideoChunk({
          type: isKey ? "key" : "delta",
          timestamp: pts,
          data: payload,
        })
      );
    } catch (err: any) {
      this.onEvent({ type: "error", msg: `screen: ${err?.message || err}` });
    }
  }

  private noteFrame(bytes: number, isKey: boolean): void {
    const now = performance.now();
    this.frames++;
    this.bytes += bytes;
    if (isKey) this.keyframes++;
    this.windowSamples.push({ t: now, bytes });
    const cut = now - 1000;
    while (this.windowSamples.length > 0 && this.windowSamples[0]!.t < cut) {
      this.windowSamples.shift();
    }
  }

  getStats(): PhoneStreamStats {
    const now = performance.now();
    const cut = now - 1000;
    let n = 0;
    let b = 0;
    for (const s of this.windowSamples) {
      if (s.t >= cut) {
        n++;
        b += s.bytes;
      }
    }
    return {
      fps: n,
      bitrateMbps: Math.round(((b * 8) / 1_000_000) * 100) / 100,
      frames: this.frames,
      keyframes: this.keyframes,
      totalMB: Math.round((this.bytes / 1_000_000) * 100) / 100,
      decodeQueue: this.decoder?.decodeQueueSize || 0,
      width: this.deviceWidth || this.canvas.width,
      height: this.deviceHeight || this.canvas.height,
    };
  }

  private sendCmd(action: string, extra?: Record<string, any>, volatile = false): string | null {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (volatile) return null;
      throw new Error("Chưa kết nối tới điện thoại");
    }
    const taskId = volatile ? "mv" : `ui_${++clientTaskSeq}_${Date.now()}`;
    this.emitSio("command", { action, taskId, ...(extra || {}) });
    return taskId;
  }

  private requestCmd<T = any>(action: string, extra?: Record<string, any>, timeoutMs = 10_000): Promise<T> {
    const taskId = this.sendCmd(action, extra, false)!;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(taskId);
        reject(new Error(`Hết thời gian chờ: ${action}`));
      }, timeoutMs);
      this.pending.set(taskId, { resolve, reject, timer });
    });
  }

  setStream(on: boolean): void {
    this.emitSio("stream", { status: on });
  }
  requestKeyFrame(): void {
    this.sendCmd("onSyncIFrame", undefined, true);
  }
  tap(x: number, y: number): void {
    this.sendCmd("touchEvent", { x, y });
  }
  swipe(x1: number, y1: number, x2: number, y2: number, duration = 300): void {
    this.sendCmd("swipeEvent", { start_x: x1, start_y: y1, end_x: x2, end_y: y2, duration });
  }
  wheel(x: number, y: number, deltaY: number): void {
    this.sendCmd("wheelEvent", { x, y, deltaY });
  }
  key(keyName: string): void {
    this.sendCmd("keyEvent", { keyName });
  }
  power(): void {
    this.sendCmd("power");
  }
  setText(text: string): void {
    this.sendCmd("setTextEvent", { text });
  }
  findElements(xpath: string): Promise<PhoneUiNode[]> {
    return this.requestCmd<PhoneUiNode[]>("findElements", { xpath }, 12_000);
  }
  clickElement(xpath: string): Promise<{ done: boolean }> {
    return this.requestCmd("clickElement", { xpath });
  }
  setTextElement(xpath: string, text: string): Promise<{ done: boolean }> {
    return this.requestCmd("setTextElement", { xpath, text });
  }
  appCommand(command: "start" | "stop" | "clear" | "uninstall" | "openInfo", packageName: string) {
    return this.requestCmd("appEvent", { command, packageName });
  }
  clipboardGet(): Promise<{ text?: string }> {
    return this.requestCmd("clipboard", { command: "get" });
  }
  clipboardSet(text: string): Promise<{ done: boolean }> {
    return this.requestCmd("clipboard", { command: "set", text });
  }
  screenshot(): Promise<{ pngBase64?: string }> {
    return this.requestCmd("screenshot", {}, 15_000);
  }
  canvasScreenshot(): string {
    return this.canvas.toDataURL("image/png");
  }

  private mapCanvasPoint(e: PointerEvent | WheelEvent, cachedRect?: DOMRect | null) {
    const r = cachedRect || this.canvas.getBoundingClientRect();
    const w = r.width || 1;
    const h = r.height || 1;
    const dw = this.deviceWidth || this.canvas.width || 1;
    const dh = this.deviceHeight || this.canvas.height || 1;
    return {
      x: Math.round(((e.clientX - r.left) / w) * dw),
      y: Math.round(((e.clientY - r.top) / h) * dh),
    };
  }

  private bindCanvasInput(): void {
    const cv = this.canvas;
    cv.tabIndex = 0;
    let activePointer: number | null = null;
    let rect: DOMRect | null = null;
    let last: { x: number; y: number; t: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (activePointer !== null || (e.button !== undefined && e.button !== 0)) return;
      activePointer = e.pointerId;
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {}
      try {
        cv.focus({ preventScroll: true });
      } catch {
        cv.focus();
      }
      rect = cv.getBoundingClientRect();
      const p = this.mapCanvasPoint(e, rect);
      last = { x: p.x, y: p.y, t: performance.now() };
      if (this.connected) this.sendCmd("pointerEvent", { phase: "down", x: p.x, y: p.y });
      if (this.holdTimer) clearInterval(this.holdTimer);
      this.holdTimer = setInterval(() => {
        if (activePointer === null || !last || !this.connected) return;
        if (performance.now() - last.t < 60) return;
        this.sendCmd("pointerEvent", { phase: "move", x: last.x, y: last.y }, true);
      }, 70);
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointer || !last) return;
      const p = this.mapCanvasPoint(e, rect);
      const now = performance.now();
      if (now - last.t < 16 && Math.hypot(p.x - last.x, p.y - last.y) < 2) return;
      last = { x: p.x, y: p.y, t: now };
      if (this.connected) this.sendCmd("pointerEvent", { phase: "move", x: p.x, y: p.y }, true);
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== activePointer) return;
      const p = this.mapCanvasPoint(e, rect);
      if (this.holdTimer) {
        clearInterval(this.holdTimer);
        this.holdTimer = null;
      }
      if (this.connected) this.sendCmd("pointerEvent", { phase: "up", x: p.x, y: p.y });
      activePointer = null;
      last = null;
      rect = null;
    };

    let wheelAcc = 0;
    let wheelPt: { x: number; y: number } | null = null;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent) => {
      if (!this.connected) return;
      e.preventDefault();
      wheelPt = this.mapCanvasPoint(e, null);
      wheelAcc += e.deltaY;
      if (wheelTimer) return;
      wheelTimer = setTimeout(() => {
        const dy = wheelAcc;
        const pt = wheelPt;
        wheelAcc = 0;
        wheelTimer = null;
        if (dy && pt) this.wheel(pt.x, pt.y, Math.round(dy));
      }, 40);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.connected) return;
      const keyMap: Record<string, string> = {
        Enter: "ENTER",
        Backspace: "DEL",
        Escape: "BACK",
        Tab: "TAB",
        " ": "SPACE",
      };
      if (keyMap[e.key]) {
        this.key(keyMap[e.key]!);
        e.preventDefault();
      } else if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.setText(e.key);
      }
    };

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onEnd);
    cv.addEventListener("pointercancel", onEnd);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("keydown", onKeyDown);

    this.cleanupListeners = () => {
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onEnd);
      cv.removeEventListener("pointercancel", onEnd);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("keydown", onKeyDown);
    };
  }
}
