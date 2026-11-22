/**
 * Otter CDP Bridge × Extension Page-Agent Core
 *
 * Kết hợp toàn bộ lõi điều khiển trang mạnh mẽ của Chrome Extension (Alibaba Page-Agent DOM,
 * Shadow DOM + iframe, React/Lexical typing, W3C Pointer click, Facebook Feed/Comments/Messenger,
 * Group/Media Post, Muse AI, Visual Activation HUD) trực tiếp vào Chrome DevTools Protocol (CDP):
 * - Tự động nạp `window.__otterCore` ngay khi CDP mở/kết nối tab (qua Page.addScriptToEvaluateOnNewDocument)
 *   -> Không cần cài Chrome Extension!
 * - Kết hợp sức mạnh phần cứng chỉ CDP mới có:
 *   1. `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` (sự kiện thật `isTrusted: true`)
 *   2. `DOM.setFileInputFiles` (tải ảnh/video trực tiếp từ ổ đĩa, không cần Base64)
 *   3. Chạy được cả Chrome desktop (có HUD trực quan) lẫn headless trên VPS Linux.
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { findChromeExecutable, getChromeUserDataDir } from "./chrome-profile";
import { getOtterDir } from "./db";
import {
  OTTER_CORE_VERSION,
  OTTER_PAGE_CORE_SCRIPT,
  isFacebookPostMismatch,
} from "./cdp-page-core";

export interface CdpTab {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
  devtoolsFrontendUrl?: string;
  /** True khi tab đến từ Chrome 144+ DevToolsActivePort (browser-level WS + Target.attachToTarget) */
  viaBrowserWs?: boolean;
}

export interface DevToolsActivePortInfo {
  port: number;
  wsPath: string;
  browserWsUrl: string;
}

/**
 * Đọc file DevToolsActivePort của Chrome mặc định (Chrome 144+ bật tại chrome://inspect/#remote-debugging).
 */
export function readDefaultChromeActivePort(userDataDir?: string): DevToolsActivePortInfo | null {
  try {
    const dir = getChromeUserDataDir(userDataDir);
    const file = path.join(dir, "DevToolsActivePort");
    if (!fs.existsSync(file)) return null;
    const lines = fs
      .readFileSync(file, "utf-8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return null;
    const port = Number(lines[0]);
    const wsPath = lines[1].startsWith("/") ? lines[1] : `/${lines[1]}`;
    if (!Number.isFinite(port) || port <= 0) return null;
    return {
      port,
      wsPath,
      browserWsUrl: `ws://127.0.0.1:${port}${wsPath}`,
    };
  } catch {
    return null;
  }
}

type CdpSendFn = (method: string, params?: any, timeoutMs?: number) => Promise<any>;

export class CdpBridge {
  private defaultPort: number;
  private defaultChromeUserDataDir?: string;
  private controlledTabId: string | null = null;
  private preloadedTabIds = new Set<string>();
  private spawnedChrome: ChildProcess | null = null;
  private idleTimer: any = null;
  private idleTimeoutMs = 60000;

  resetIdleTimer() {
    this.clearIdleTimer();
    const autoCloseEnv = (process.env.OTTER_CDP_AUTO_CLOSE || "").trim().toLowerCase();
    if (autoCloseEnv === "0" || autoCloseEnv === "false" || autoCloseEnv === "off") return;

    if (this.spawnedChrome && !this.spawnedChrome.killed) {
      this.idleTimer = setTimeout(() => {
        console.log("[CDP Bridge] ⏳ Không có thao tác duyệt web trong 60s, tự động đóng Chrome CDP để trả tài nguyên...");
        void this.closeBrowser();
      }, this.idleTimeoutMs);
      if (this.idleTimer?.unref) {
        this.idleTimer.unref();
      }
    }
  }

  clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // Kết nối Browser-level WebSocket bền vững cho Chrome 144+ mặc định (DevToolsActivePort)
  // Giữ 1 kết nối duy nhất để người dùng chỉ phải bấm "Allow" 1 lần trong Chrome.
  private browserWs: WebSocket | null = null;
  private browserWsUrl: string | null = null;
  private browserWsNextId = 1;
  private browserWsPending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: any }>();
  private browserWsConnectPromise: Promise<void> | null = null;
  private attachedSessions = new Map<string, string>(); // targetId -> sessionId
  // Khi người dùng bấm "Huỷ" ở hộp thoại gỡ lỗi từ xa của Chrome, kết nối WS bị từ chối.
  // Ghi lại thời điểm bị từ chối để tạm ngưng thử lại đường browser-WS trong vài phút,
  // tránh hộp thoại hiện lại liên tục và để đường dự phòng (Chrome CDP riêng) được dùng.
  private browserWsDeniedUntil = 0;
  private static readonly BROWSER_WS_DENIED_COOLDOWN_MS = 5 * 60 * 1000;
  // Chống chạy trùng ensureCdpChrome (getTabs -> ensureCdpChrome -> preload -> getTabs)
  private ensureCdpInFlight: Promise<boolean> | null = null;

  constructor(defaultPort = 9222, defaultChromeUserDataDir?: string) {
    this.defaultPort = process.env.OTTER_CDP_PORT ? Number(process.env.OTTER_CDP_PORT) : defaultPort;
    this.defaultChromeUserDataDir = defaultChromeUserDataDir;
  }

  private getPreferredDefaultChromeInfo(port?: number): DevToolsActivePortInfo | null {
    if (port) return null;
    if (
      !this.defaultChromeUserDataDir &&
      !process.env.OTTER_CHROME_USER_DATA_DIR &&
      process.env.OTTER_CDP_USE_DEFAULT_CHROME !== "1"
    ) {
      return null;
    }
    return readDefaultChromeActivePort(this.defaultChromeUserDataDir || process.env.OTTER_CHROME_USER_DATA_DIR);
  }

  private isTcpPortListening(port: number, timeoutMs = 400): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        try { socket.destroy(); } catch {}
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish(true));
      socket.once("timeout", () => finish(false));
      socket.once("error", () => finish(false));
    });
  }

  private async shouldUseBrowserWs(port?: number): Promise<boolean> {
    const info = this.getPreferredDefaultChromeInfo(port);
    if (!info) return false;
    if (this.browserWs && this.browserWs.readyState === WebSocket.OPEN && this.browserWsUrl === info.browserWsUrl) {
      return true;
    }
    // Vừa bị từ chối quyền gỡ lỗi (người dùng bấm Huỷ): không thử lại ngay để tránh popup lặp.
    if (Date.now() < this.browserWsDeniedUntil) return false;
    return this.isTcpPortListening(info.port);
  }

  private isUsablePageTab(tab: CdpTab): boolean {
    return tab.type === "page" && Boolean(tab.webSocketDebuggerUrl || tab.viaBrowserWs);
  }

  /**
   * Đóng kết nối persistent Browser WebSocket (nếu có).
   */
  close(): void {
    this.resetBrowserWs();
  }

  private resetBrowserWs(err?: Error): void {
    if (this.browserWs) {
      try { this.browserWs.close(); } catch {}
    }
    this.browserWs = null;
    this.browserWsUrl = null;
    this.browserWsConnectPromise = null;
    this.attachedSessions.clear();
    if (err) {
      for (const [, p] of this.browserWsPending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this.browserWsPending.clear();
    }
  }

  private async ensureBrowserWs(wsUrl: string, timeoutMs = 3000): Promise<void> {
    if (this.browserWs && this.browserWs.readyState === WebSocket.OPEN && this.browserWsUrl === wsUrl) {
      return;
    }
    if (this.browserWsConnectPromise && this.browserWsUrl === wsUrl) {
      return this.browserWsConnectPromise;
    }
    this.resetBrowserWs();
    this.browserWsUrl = wsUrl;

    this.browserWsConnectPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.browserWsDeniedUntil = Date.now() + CdpBridge.BROWSER_WS_DENIED_COOLDOWN_MS;
          this.resetBrowserWs();
          reject(new Error("Kết nối Browser WebSocket Chrome mặc định quá hạn (hãy kiểm tra hộp thoại Allow trong Chrome)"));
        }
      }, timeoutMs);

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        clearTimeout(timer);
        this.resetBrowserWs();
        reject(err);
        return;
      }

      ws.onopen = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.browserWsDeniedUntil = 0;
          this.browserWs = ws;
          this.browserWsConnectPromise = null;
          resolve();
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
          if (data.id && this.browserWsPending.has(data.id)) {
            const p = this.browserWsPending.get(data.id)!;
            this.browserWsPending.delete(data.id);
            clearTimeout(p.timer);
            if (data.error) {
              p.reject(new Error(`Lỗi CDP: ${data.error.message || JSON.stringify(data.error)}`));
            } else {
              p.resolve(data.result);
            }
          } else if (data.method === "Target.detachedFromTarget" && data.params?.targetId) {
            this.attachedSessions.delete(data.params.targetId);
            this.preloadedTabIds.delete(data.params.targetId);
          }
        } catch {}
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.browserWsDeniedUntil = Date.now() + CdpBridge.BROWSER_WS_DENIED_COOLDOWN_MS;
          this.resetBrowserWs();
          reject(new Error("Không thể kết nối Browser WebSocket của Chrome mặc định"));
        }
      };

      ws.onclose = () => {
        const closeErr = new Error("Browser WebSocket Chrome mặc định đã đóng");
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.browserWsDeniedUntil = Date.now() + CdpBridge.BROWSER_WS_DENIED_COOLDOWN_MS;
          reject(closeErr);
        }
        this.resetBrowserWs(closeErr);
      };
    });

    return this.browserWsConnectPromise;
  }

  private async sendOnBrowserWs(method: string, params: any = {}, sessionId?: string, timeoutMs = 25000): Promise<any> {
    const info = this.getPreferredDefaultChromeInfo();
    const targetWsUrl = this.browserWsUrl || info?.browserWsUrl;
    if (!targetWsUrl) throw new Error("Không tìm thấy Browser WebSocket của Chrome mặc định");
    await this.ensureBrowserWs(targetWsUrl);
    if (!this.browserWs || this.browserWs.readyState !== WebSocket.OPEN) {
      throw new Error("Browser WebSocket chưa sẵn sàng");
    }

    return new Promise((resolve, reject) => {
      const id = this.browserWsNextId++;
      const timer = setTimeout(() => {
        this.browserWsPending.delete(id);
        reject(new Error(`Lệnh CDP '${method}' quá hạn sau ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.browserWsPending.set(id, { resolve, reject, timer });
      try {
        const payload: any = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.browserWs!.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.browserWsPending.delete(id);
        reject(err);
      }
    });
  }

  private async attachTargetSession(targetId: string): Promise<string> {
    const existing = this.attachedSessions.get(targetId);
    if (existing) return existing;
    const res = await this.sendOnBrowserWs("Target.attachToTarget", { targetId, flatten: true }, undefined, 10000);
    const sessionId = res?.sessionId;
    if (!sessionId) throw new Error(`Không thể gắn vào tab ${targetId}`);
    this.attachedSessions.set(targetId, sessionId);
    return sessionId;
  }

  /**
   * Thực thi chuỗi lệnh trên 1 tab cụ thể (tự động dùng persistent Browser WS nếu là Chrome 144+ mặc định,
   * hoặc tab WebSocket chuẩn nếu là cổng 9222 / GPM Login).
   */
  async withTabSession<T>(tab: CdpTab, fn: (send: CdpSendFn) => Promise<T>, defaultTimeoutMs = 25000): Promise<T> {
    if (tab.viaBrowserWs) {
      const sessionId = await this.attachTargetSession(tab.id);
      const send: CdpSendFn = (method, params = {}, timeoutMs = defaultTimeoutMs) =>
        this.sendOnBrowserWs(method, params, sessionId, timeoutMs);
      try {
        return await fn(send);
      } catch (err: any) {
        // Nếu session cũ bị detach (tab vừa đóng/reload), xóa cache để lần sau attach lại
        if (String(err?.message || "").includes("Session with given id not found")) {
          this.attachedSessions.delete(tab.id);
        }
        throw err;
      }
    }
    if (!tab.webSocketDebuggerUrl) {
      throw new Error("Tab không có webSocketDebuggerUrl hợp lệ");
    }
    return this.withSession(tab.webSocketDebuggerUrl, fn, defaultTimeoutMs);
  }

  getPort(): number {
    return this.defaultPort;
  }

  setPort(port: number): void {
    this.defaultPort = port;
  }

  /**
   * Kiểm tra xem cổng CDP có đang mở và sẵn sàng không
   * (Ưu tiên Chrome 144+ mặc định qua DevToolsActivePort nếu đang bật, dùng TCP probe để không gây popup).
   */
  async isAvailable(port?: number, _profileId?: string): Promise<boolean> {
    const targetPort = port || this.defaultPort;
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/json/version`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.ok) return true;
    } catch {}

    if (await this.shouldUseBrowserWs(port)) return true;

    if (!port) {
      const candidatePorts = [
        process.env.OTTER_CDP_PORT ? Number(process.env.OTTER_CDP_PORT) : null,
        Number(process.env.CDP_PORT) || null,
        32934,
      ].filter(Boolean) as number[];

      for (const p of candidatePorts) {
        if (p === targetPort) continue;
        try {
          const res = await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(500) });
          if (res.ok) {
            this.defaultPort = p;
            return true;
          }
        } catch {}
      }

      // Chỉ dò cổng READ-ONLY từ danh sách GPM Login (TUYỆT ĐỐI KHÔNG gọi /profiles/start trong isAvailable!)
      try {
        const gpmPort = process.env.OTTER_GPM_PORT ? Number(process.env.OTTER_GPM_PORT) : 9495;
        const profRes = await fetch(`http://127.0.0.1:${gpmPort}/api/v1/profiles?page=1&page_size=20`, {
          signal: AbortSignal.timeout(1500),
        });
        if (profRes.ok) {
          const profData = (await profRes.json()) as any;
          const profiles = profData?.data?.data || profData?.data || [];
          for (const p of profiles) {
            const testPort = Number(p?.remote_debugging_port);
            if (!testPort) continue;
            try {
              const testRes = await fetch(`http://127.0.0.1:${testPort}/json/version`, {
                signal: AbortSignal.timeout(800),
              });
              if (testRes.ok) {
                console.log(`[CDP Bridge] Tự phát hiện cổng CDP từ GPM Profile "${p.name}": Port ${testPort}`);
                this.defaultPort = testPort;
                return true;
              }
            } catch {}
          }
        }
      } catch {}
    }

    return false;
  }

  /**
   * Chỉ khởi động profile GPM Login khi người dùng chỉ định rõ profileId hoặc cấu hình OTTER_GPM_PROFILE_ID.
   * Không tự ý mở profile mặc định nào khi không được yêu cầu.
   */
  async ensureProfileRunning(profileId?: string, port?: number): Promise<boolean> {
    const targetPort = port || this.defaultPort;
    if (await this.isAvailable(targetPort)) return true;

    const targetProfile = (profileId || process.env.OTTER_GPM_PROFILE_ID || "").trim();
    if (!targetProfile) return false;

    const gpmPort = process.env.OTTER_GPM_PORT ? Number(process.env.OTTER_GPM_PORT) : 9495;

    try {
      const res = await fetch(
        `http://127.0.0.1:${gpmPort}/api/v1/profiles/start/${encodeURIComponent(targetProfile)}?remote_debugging_port=${targetPort}`,
        { signal: AbortSignal.timeout(12000) }
      );
      const data = (await res.json()) as any;
      if (data.success || data.message === "ProfileInUse") {
        await new Promise((r) => setTimeout(r, 2000));
        return await this.isAvailable(targetPort);
      }
    } catch {}

    return false;
  }

  /**
   * Lấy danh sách tất cả các tab đang mở
   */
  async getTabs(port?: number): Promise<CdpTab[]> {
    const targetPort = port || this.defaultPort;

    // 1. Nếu cổng targetPort (mặc định 9222) đang mở và có danh sách tab qua HTTP /json, dùng ngay lập tức (< 5ms)
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/json`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) {
        return (await res.json()) as CdpTab[];
      }
    } catch {}

    // 2. Thử qua persistent Browser WebSocket (DevToolsActivePort Chrome 144+)
    if (await this.shouldUseBrowserWs(port)) {
      try {
        const res = await this.sendOnBrowserWs("Target.getTargets", {}, undefined, 3000);
        const infos = Array.isArray(res?.targetInfos) ? res.targetInfos : [];
        return infos.map((t: any) => ({
          id: String(t.targetId || ""),
          title: String(t.title || ""),
          url: String(t.url || ""),
          type: String(t.type || "other"),
          viaBrowserWs: true,
        }));
      } catch (err: any) {
        console.warn(`[CDP Bridge] Không đọc được tab từ Chrome mặc định (${err.message}), thử cổng dự phòng...`);
      }
    }

    if (!(await this.isAvailable(targetPort))) {
      await this.ensureProfileRunning(undefined, targetPort);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/json`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`Không thể lấy danh sách tab từ CDP port ${targetPort}`);
      return (await res.json()) as CdpTab[];
    } catch (err: any) {
      if (!(await this.isAvailable(targetPort))) {
        throw new Error(
          `Trình duyệt Chrome CDP (port ${targetPort}) hiện chưa chạy. Vui lòng gọi browser_open trước để khởi động Chrome CDP.`
        );
      }
      throw err;
    }
  }

  /**
   * Tìm tab mục tiêu: ưu tiên urlPattern -> controlledTabId -> tab page đầu tiên
   */
  async findTargetTab(urlPattern?: string, port?: number): Promise<CdpTab> {
    const tabs = await this.getTabs(port);
    const pageTabs = tabs.filter((t) => this.isUsablePageTab(t));

    if (pageTabs.length === 0) {
      throw new Error("Không tìm thấy tab trang web (type=page) nào đang mở trong trình duyệt CDP.");
    }

    if (urlPattern) {
      const q = urlPattern.toLowerCase();
      const matched = pageTabs.find(
        (t) => t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
      );
      if (matched) return matched;
      throw new Error(`Không tìm thấy tab nào phù hợp với pattern '${urlPattern}'`);
    }

    if (this.controlledTabId) {
      const sticky = pageTabs.find((t) => t.id === this.controlledTabId);
      if (sticky) return sticky;
    }

    this.controlledTabId = pageTabs[0].id;
    return pageTabs[0];
  }

  /**
   * Mở 1 phiên WebSocket CDP duy nhất để thực thi nhiều lệnh liên tiếp (nhanh gấp 3-5x).
   */
  async withSession<T>(wsUrl: string, fn: (send: CdpSendFn) => Promise<T>, defaultTimeoutMs = 25000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let ws: WebSocket;
      let nextId = 1;
      const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; timer: any }>();

      const failAll = (err: any) => {
        for (const [, p] of pending) {
          clearTimeout(p.timer);
          p.reject(err);
        }
        pending.clear();
      };

      const send: CdpSendFn = (method: string, params: any = {}, timeoutMs = defaultTimeoutMs) => {
        return new Promise((res, rej) => {
          if (ws.readyState !== WebSocket.OPEN) {
            return rej(new Error(`WebSocket CDP chưa mở khi gọi '${method}'`));
          }
          const id = nextId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`Lệnh CDP '${method}' quá hạn sau ${timeoutMs / 1000}s`));
          }, timeoutMs);
          pending.set(id, { resolve: res, reject: rej, timer });
          try {
            ws.send(JSON.stringify({ id, method, params }));
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            rej(err);
          }
        });
      };

      const connectTimer = setTimeout(() => {
        try { ws?.close(); } catch {}
        reject(new Error("Kết nối WebSocket CDP quá hạn sau 8s"));
      }, 8000);

      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        clearTimeout(connectTimer);
        reject(err);
        return;
      }

      ws.onopen = () => {
        clearTimeout(connectTimer);
        fn(send)
          .then((result) => {
            try { ws.close(); } catch {}
            resolve(result);
          })
          .catch((err) => {
            try { ws.close(); } catch {}
            reject(err);
          });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
          if (data.id && pending.has(data.id)) {
            const p = pending.get(data.id)!;
            pending.delete(data.id);
            clearTimeout(p.timer);
            if (data.error) {
              p.reject(new Error(`Lỗi CDP: ${data.error.message || JSON.stringify(data.error)}`));
            } else {
              p.resolve(data.result);
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        clearTimeout(connectTimer);
        const err = new Error("Lỗi kết nối WebSocket CDP");
        failAll(err);
        reject(err);
      };

      ws.onclose = () => {
        clearTimeout(connectTimer);
        if (pending.size > 0) {
          failAll(new Error("WebSocket CDP đã đóng trước khi nhận phản hồi"));
        }
      };
    });
  }

  /**
   * Gửi một lệnh CDP đơn lẻ qua WebSocket
   */
  async sendCommand(wsUrl: string, method: string, params: any = {}, timeoutMs = 20000): Promise<any> {
    return this.withSession(wsUrl, (send) => send(method, params, timeoutMs), timeoutMs);
  }

  /**
   * Chạy biểu thức JavaScript trong ngữ cảnh MAIN world của tab
   */
  async evaluateJs(wsUrl: string, expression: string, awaitPromise = true, timeoutMs = 20000): Promise<any> {
    const res = await this.sendCommand(
      wsUrl,
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise },
      timeoutMs
    );
    if (res?.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Lỗi JS thực thi trên trang: ${desc}`);
    }
    return res?.result?.value;
  }

  private async evalInSession(
    send: CdpSendFn,
    expression: string,
    awaitPromise = true,
    timeoutMs = 25000,
    includeCommandLineAPI = false
  ): Promise<any> {
    const res = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise, ...(includeCommandLineAPI ? { includeCommandLineAPI: true } : {}) },
      timeoutMs
    );
    if (res?.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Lỗi JS thực thi trên trang: ${desc}`);
    }
    return res?.result?.value;
  }

  /**
   * Nạp tự động Otter Page-Agent Core (`window.__otterCore`) vào tab CDP:
   * - Đăng ký `Page.addScriptToEvaluateOnNewDocument` để MỌI lần điều hướng / F5 đều có sẵn core ngay từ đầu.
   * - Đảm bảo trang hiện tại cũng đã có `window.__otterCore` ngay lập tức (idempotent).
   */
  async ensureCoreInSession(send: CdpSendFn, tabId: string): Promise<void> {
    if (!this.preloadedTabIds.has(tabId)) {
      try {
        await send("Page.enable", {}, 5000);
        await send("Page.addScriptToEvaluateOnNewDocument", { source: OTTER_PAGE_CORE_SCRIPT }, 5000);
        this.preloadedTabIds.add(tabId);
      } catch {}
    }
    const loaded = await this.evalInSession(
      send,
      `Boolean(window.__otterCore && window.__otterCore.version === ${JSON.stringify(OTTER_CORE_VERSION)})`,
      false,
      5000
    ).catch(() => false);
    if (!loaded) {
      await this.evalInSession(send, OTTER_PAGE_CORE_SCRIPT, false, 10000);
    }
  }

  /**
   * Nạp sẵn Otter Page-Agent Core vào tất cả các tab page đang mở ngay khi CDP vừa kết nối/khởi chạy.
   */
  async preloadCoreOnAllTabs(port?: number): Promise<number> {
    try {
      const tabs = await this.getTabs(port);
      const pageTabs = tabs.filter((t) => this.isUsablePageTab(t));
      let count = 0;
      for (const tab of pageTabs) {
        try {
          await this.withTabSession(tab, async (send) => {
            await this.ensureCoreInSession(send, tab.id);
          });
          count++;
        } catch {}
      }
      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Chờ trang hoàn tất tải (document.readyState === 'complete')
   */
  private async waitForPageReady(tab: CdpTab, timeoutMs = 12000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    try {
      await this.withTabSession(tab, async (send) => {
        while (Date.now() < deadline) {
          try {
            const state = await this.evalInSession(send, "document.readyState", false, 2000);
            if (state === "complete") return;
          } catch {}
          await new Promise((r) => setTimeout(r, 300));
        }
      }, timeoutMs + 2000);
    } catch {}
  }

  private async createTab(url: string, port?: number): Promise<CdpTab> {
    if (await this.shouldUseBrowserWs(port)) {
      try {
        const res = await this.sendOnBrowserWs("Target.createTarget", { url }, undefined, 10000);
        if (res?.targetId) {
          return {
            id: String(res.targetId),
            title: "",
            url,
            type: "page",
            viaBrowserWs: true,
          };
        }
      } catch {}
    }
    const targetPort = port || this.defaultPort;
    try {
      const newTabRes = await fetch(`http://127.0.0.1:${targetPort}/json/new?${encodeURIComponent(url)}`, {
        method: "PUT",
      });
      if (!newTabRes.ok) {
        throw new Error(`Không thể tạo tab mới trên CDP port ${targetPort}`);
      }
      return (await newTabRes.json()) as CdpTab;
    } catch (err: any) {
      if (!(await this.isAvailable(targetPort))) {
        throw new Error(
          `Trình duyệt Chrome CDP (port ${targetPort}) hiện chưa chạy. Vui lòng gọi browser_open trước để khởi động Chrome CDP.`
        );
      }
      throw err;
    }
  }

  private shouldAutoHud(): boolean {
    const env = (process.env.OTTER_CDP_HUD || "").trim().toLowerCase();
    if (env === "0" || env === "false" || env === "off") return false;
    if (env === "1" || env === "true" || env === "on") return true;
    // Tự động bật HUD trực quan trên desktop có màn hình; tắt khi chạy headless Linux
    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
    return process.env.OTTER_CDP_HEADLESS !== "1";
  }

  /**
   * Mở URL mới hoặc điều hướng tab đang điều khiển (tự nạp sẵn Otter Core ngay khi load!)
   */
  async openUrl(url: string, port?: number): Promise<{ ok: boolean; tabId: string; title: string; url: string }> {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl) && !/^chrome:\/\//i.test(targetUrl) && !/^about:/i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    let targetTab: CdpTab | null = null;
    try {
      targetTab = await this.findTargetTab(undefined, port);
    } catch {}

    if (targetTab && this.isUsablePageTab(targetTab)) {
      this.controlledTabId = targetTab.id;
      await this.withTabSession(targetTab, async (send) => {
        await this.ensureCoreInSession(send, targetTab!.id);
        await send("Page.navigate", { url: targetUrl });
      });
      await this.waitForPageReady(targetTab, 10000);
      await new Promise((r) => setTimeout(r, 400));

      const meta = await this.withTabSession(targetTab, async (send) => {
        await this.ensureCoreInSession(send, targetTab!.id);
        if (this.shouldAutoHud()) {
          await this.evalInSession(send, "window.__otterCore.injectHud(false)", false, 4000).catch(() => {});
        }
        return this.evalInSession(send, "({ title: document.title, url: location.href })", false, 4000);
      }).catch(() => ({ title: targetTab!.title, url: targetUrl }));

      return {
        ok: true,
        tabId: targetTab.id,
        title: meta?.title || targetTab.title,
        url: meta?.url || targetUrl,
      };
    }

    const newTab = await this.createTab(targetUrl, port);
    this.controlledTabId = newTab.id;
    if (this.isUsablePageTab(newTab)) {
      await this.waitForPageReady(newTab, 10000);
      await this.withTabSession(newTab, async (send) => {
        await this.ensureCoreInSession(send, newTab.id);
        if (this.shouldAutoHud()) {
          await this.evalInSession(send, "window.__otterCore.injectHud(false)", false, 4000).catch(() => {});
        }
      }).catch(() => {});
    }
    return {
      ok: true,
      tabId: newTab.id,
      title: newTab.title,
      url: newTab.url || targetUrl,
    };
  }

  /**
   * Đọc cấu trúc trang với lõi Alibaba Page-Agent đầy đủ (Shadow DOM + iframe + Visual Badges + FB/Messenger)
   */
  async readPage(urlPattern?: string, port?: number): Promise<any> {
    const tab = await this.findTargetTab(urlPattern, port);

    const res = await this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      if (this.shouldAutoHud()) {
        await this.evalInSession(send, "window.__otterCore.injectHud(false)", false, 4000).catch(() => {});
      }
      return this.evalInSession(
        send,
        `window.__otterCore.readPage({ showBadges: ${this.shouldAutoHud()} })`,
        false,
        15000
      );
    });

    return { ...res, tabId: tab.id, coreVersion: OTTER_CORE_VERSION };
  }

  /**
   * Click kết hợp 2 tầng:
   * - Tầng 1 (CDP Hardware): Input.dispatchMouseEvent (mouseMoved -> mousePressed -> mouseReleased, isTrusted=true)
   * - Tầng 2 (Extension W3C Core): Fallback chuỗi 9 sự kiện Pointer/Mouse + elementFromPoint nếu ngoài viewport
   */
  async click(index: number, urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);

    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      const prep = await this.evalInSession(send, `window.__otterCore.prepClick(${Number(index)})`, false, 8000);
      if (!prep?.ok) {
        throw new Error(prep?.error || `Không tìm thấy phần tử index [${index}]`);
      }

      if (prep.inViewport) {
        try {
          await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: prep.x, y: prep.y, button: "none" });
          await send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: prep.x,
            y: prep.y,
            button: "left",
            clickCount: 1,
          });
          await send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: prep.x,
            y: prep.y,
            button: "left",
            clickCount: 1,
          });
          return {
            ok: true,
            message: `Đã click phần cứng CDP (isTrusted) vào [${index}] <${prep.tag}> "${prep.text}" thành công`,
          };
        } catch {
          // Fallback sang W3C Click của Extension Core nếu CDP Input lỗi
        }
      }

      const fallback = await this.evalInSession(send, `window.__otterCore.w3cClick(${Number(index)})`, false, 8000);
      if (!fallback?.ok) throw new Error(fallback?.message || `Click thất bại tại index [${index}]`);
      return fallback;
    });
  }

  /**
   * Nhập văn bản kết hợp Extension Core (React 17/18 Native Setter + Meta Lexical + ContentEditable)
   * và CDP Hardware Enter (`Input.dispatchKeyEvent`, isTrusted=true).
   */
  async type(
    index: number,
    text: string,
    pressEnter = false,
    urlPattern?: string,
    port?: number
  ): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);

    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      const res = await this.evalInSession(
        send,
        `window.__otterCore.typeElement(${Number(index)}, ${JSON.stringify(text)}, ${Boolean(pressEnter)})`,
        false,
        10000
      );
      if (!res?.ok) throw new Error(res?.message || `Nhập văn bản thất bại tại index [${index}]`);

      if (pressEnter) {
        try {
          await send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          });
          await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            nativeVirtualKeyCode: 13,
          });
        } catch {}
      }

      return { ok: true, message: res.message };
    });
  }

  async select(index: number, option: string, urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);

    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      const res = await this.evalInSession(
        send,
        `window.__otterCore.selectOption(${Number(index)}, ${JSON.stringify(option)})`,
        false,
        8000
      );
      if (!res?.ok) throw new Error(res?.message || `Chọn tùy chọn thất bại tại index [${index}]`);
      return res;
    });
  }

  async scroll(direction: "up" | "down", amount = 800, urlPattern?: string, port?: number): Promise<any> {
    const tab = await this.findTargetTab(urlPattern, port);

    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(
        send,
        `window.__otterCore.scrollPage(${JSON.stringify(direction)}, ${Number(amount) || 800})`,
        true,
        10000
      );
    });
  }

  async back(urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);
    await this.withTabSession(tab, (send) => this.evalInSession(send, "window.history.back()", false, 5000));
    return { ok: true, message: "Đã quay lại trang trước qua CDP" };
  }

  async listTabs(port?: number): Promise<{ ok: boolean; tabs: any[] }> {
    const tabs = await this.getTabs(port);
    const pages = tabs
      .filter((t) => t.type === "page")
      .map((t, idx) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        isControlled: this.controlledTabId ? t.id === this.controlledTabId : idx === 0,
        active: idx === 0,
      }));
    return { ok: true, tabs: pages };
  }

  async closeTab(tabId?: string | number, port?: number): Promise<{ ok: boolean; message: string }> {
    const targetId = tabId ? String(tabId) : (await this.findTargetTab(undefined, port)).id;
    let ok = false;
    if (await this.shouldUseBrowserWs(port)) {
      try {
        const res = await this.sendOnBrowserWs("Target.closeTarget", { targetId }, undefined, 8000);
        ok = res?.success !== false;
        this.attachedSessions.delete(targetId);
      } catch {}
    }
    if (!ok) {
      const targetPort = port || this.defaultPort;
      const res = await fetch(`http://127.0.0.1:${targetPort}/json/close/${targetId}`, { method: "PUT" });
      ok = res.ok;
    }
    this.preloadedTabIds.delete(targetId);
    if (this.controlledTabId === targetId) this.controlledTabId = null;
    return {
      ok,
      message: ok ? `Đã đóng tab [${targetId}] qua CDP thành công` : `Không thể đóng tab [${targetId}] qua CDP`,
    };
  }

  async switchTab(tabId: string | number, port?: number): Promise<{ ok: boolean; message: string }> {
    const idStr = String(tabId);
    let ok = false;
    if (await this.shouldUseBrowserWs(port)) {
      try {
        await this.sendOnBrowserWs("Target.activateTarget", { targetId: idStr }, undefined, 8000);
        ok = true;
      } catch {}
    }
    if (!ok) {
      const targetPort = port || this.defaultPort;
      const res = await fetch(`http://127.0.0.1:${targetPort}/json/activate/${idStr}`, { method: "PUT" });
      ok = res.ok;
    }
    if (ok) this.controlledTabId = idStr;
    return {
      ok,
      message: ok ? `Đã kích hoạt tab [${idStr}] qua CDP thành công` : `Không thể kích hoạt tab [${idStr}] qua CDP`,
    };
  }

  async closeMessengerDocks(port?: number): Promise<any> {
    const tab = await this.findTargetTab("facebook.com", port);
    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(send, "window.__otterCore.closeMessengerDocks()", false, 8000);
    });
  }

  async readComments(currentUserName?: string, postUrl?: string, port?: number): Promise<any> {
    let tab = await this.findTargetTab("facebook.com", port);
    if (postUrl && postUrl.trim() && isFacebookPostMismatch(tab.url || "", postUrl)) {
      await this.openUrl(postUrl, port);
      await new Promise((r) => setTimeout(r, 1500));
      tab = await this.findTargetTab("facebook.com", port);
    }

    const res = await this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(
        send,
        `window.__otterCore.readComments(${JSON.stringify(currentUserName || "")})`,
        false,
        15000
      );
    });
    if (res) res.tabId = tab.id;
    return res;
  }

  async readFeed(port?: number): Promise<any> {
    const tab = await this.findTargetTab("facebook.com", port);
    const res = await this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(send, "window.__otterCore.readFeed()", false, 15000);
    });
    if (res) res.tabId = tab.id;
    return res;
  }

  async reactFacebook(
    index?: number,
    author?: string,
    reaction: "like" | "love" | "care" | "haha" | "wow" | "sad" | "angry" = "like",
    port?: number
  ): Promise<any> {
    const tab = await this.findTargetTab("facebook.com", port);
    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(
        send,
        `window.__otterCore.reactFacebook(${index ? Number(index) : "null"}, ${JSON.stringify(author || null)}, ${JSON.stringify(reaction || "like")})`,
        true,
        15000
      );
    });
  }

  async commentFacebook(
    params: { commentIndex?: number; author?: string; commentText: string },
    port?: number
  ): Promise<any> {
    const tab = await this.findTargetTab("facebook.com", port);
    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(
        send,
        `window.__otterCore.commentFacebook(${params.commentIndex ? Number(params.commentIndex) : "null"}, ${JSON.stringify(params.author || null)}, ${JSON.stringify(params.commentText)})`,
        true,
        25000
      );
    }, 30000);
  }

  async postToFacebookGroup(params: { groupUrl: string; content: string }, port?: number): Promise<any> {
    const targetUrl = params.groupUrl.trim();
    let tab = await this.findTargetTab("facebook.com", port).catch(() => null);
    const normTarget = targetUrl.replace(/\/$/, "");
    const normCur = (tab?.url || "").trim().replace(/\/$/, "");
    if (!tab || !normCur.includes(normTarget)) {
      await this.openUrl(targetUrl, port);
      await new Promise((r) => setTimeout(r, 2000));
      tab = await this.findTargetTab("facebook.com", port);
    }

    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab!.id);
      await this.evalInSession(send, "window.__otterCore.closeMessengerDocks()", false, 5000).catch(() => {});
      const openRes = await this.evalInSession(send, "window.__otterCore.openFbComposer(false)", true, 15000);
      if (!openRes?.ok) return { ok: false, verified: false, message: openRes?.message || "Không mở được khung soạn bài nhóm" };
      return this.evalInSession(send, `window.__otterCore.finishFbPost(${JSON.stringify(params.content)}, false)`, true, 30000);
    }, 35000);
  }

  /**
   * Đăng bài kèm Ảnh / Video lên Facebook sử dụng CDP `DOM.setFileInputFiles` trực tiếp từ ổ đĩa
   * (nhanh hơn nhiều so với Base64 và hỗ trợ video dung lượng lớn).
   */
  async postMediaToFacebook(
    params: {
      targetType: "profile" | "group" | "page";
      targetUrl?: string;
      mediaPath?: string;
      mediaType?: "video" | "image" | "none";
      caption: string;
    },
    port?: number
  ): Promise<any> {
    let destUrl = (params.targetUrl || "").trim();
    if (!destUrl) {
      destUrl = params.targetType === "group" ? "https://www.facebook.com/groups/feed/" : "https://www.facebook.com/";
    }
    if (!/^https?:\/\//i.test(destUrl)) destUrl = `https://${destUrl}`;

    let tab = await this.findTargetTab("facebook.com", port).catch(() => null);
    const normTarget = destUrl.replace(/\/$/, "");
    const normCur = (tab?.url || "").trim().replace(/\/$/, "");
    if (!tab || !normCur.includes(normTarget)) {
      await this.openUrl(destUrl, port);
      await new Promise((r) => setTimeout(r, 2000));
      tab = await this.findTargetTab("facebook.com", port);
    }

    const resolvedMedia = params.mediaPath ? path.resolve(params.mediaPath) : "";
    const hasMedia = Boolean(resolvedMedia && fs.existsSync(resolvedMedia));

    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab!.id);
      await this.evalInSession(send, "window.__otterCore.closeMessengerDocks()", false, 5000).catch(() => {});

      const openRes = await this.evalInSession(
        send,
        `window.__otterCore.openFbComposer(${hasMedia})`,
        true,
        15000
      );
      if (!openRes?.ok) {
        return { ok: false, verified: false, message: openRes?.message || "Không mở được khung soạn bài Facebook" };
      }

      if (hasMedia && openRes.hasFileInput) {
        // Dùng CDP DOM.setFileInputFiles nạp file trực tiếp từ ổ đĩa (không cần Base64)
        await send("DOM.enable", {}, 5000);
        const doc = await send("DOM.getDocument", { depth: 1 }, 5000);
        const query = await send(
          "DOM.querySelector",
          { nodeId: doc.root.nodeId, selector: 'input[type="file"][data-otter-file-target="1"]' },
          5000
        );
        if (query?.nodeId) {
          await send("DOM.setFileInputFiles", { nodeId: query.nodeId, files: [resolvedMedia] }, 15000);
        }
      }

      return this.evalInSession(
        send,
        `window.__otterCore.finishFbPost(${JSON.stringify(params.caption)}, ${hasMedia})`,
        true,
        70000
      );
    }, 75000);
  }

  /**
   * Giao nhiệm vụ cho Muse AI trên web (muse.ai) qua CDP
   */
  async askMuse(
    task: string,
    options?: { newThread?: boolean; timeoutMs?: number; closeTabOnDone?: boolean },
    port?: number
  ): Promise<{ ok: boolean; replyText: string; attachments: any[]; tabId?: string; error?: string }> {
    const timeout = options?.timeoutMs || 180000;
    const deadline = Date.now() + timeout;

    const tabs = await this.getTabs(port);
    let museTab = tabs.find((t) => this.isUsablePageTab(t) && t.url?.includes("muse.ai"));
    let created = false;

    if (!museTab) {
      museTab = await this.createTab("https://muse.ai/thread/new", port);
      created = true;
      if (this.isUsablePageTab(museTab)) await this.waitForPageReady(museTab, 15000);
    } else if (options?.newThread) {
      await this.withTabSession(museTab, (send) => send("Page.navigate", { url: "https://muse.ai/thread/new" }));
      await this.waitForPageReady(museTab, 15000);
    }

    if (!museTab || !this.isUsablePageTab(museTab)) {
      return { ok: false, replyText: "", attachments: [], error: "Không thể mở tab muse.ai qua CDP" };
    }

    const tabId = museTab.id;

    try {
      // Chờ trang Muse sẵn sàng
      const readyDeadline = Date.now() + 25000;
      let ready = false;
      while (Date.now() < readyDeadline) {
        const status = await this.withTabSession(museTab, async (send) => {
          await this.ensureCoreInSession(send, tabId);
          return this.evalInSession(send, "window.__otterCore.museCheckReady()", false, 5000);
        });
        if (status === "login_required") {
          return { ok: false, replyText: "", attachments: [], error: "Tài khoản Muse chưa đăng nhập trên Chrome CDP." };
        }
        if (status === "ready") {
          ready = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      if (!ready) return { ok: false, replyText: "", attachments: [], error: "Trang Muse chưa sẵn sàng sau 25s." };

      const sendRes = await this.withTabSession(museTab, async (send) => {
        await this.ensureCoreInSession(send, tabId);
        return this.evalInSession(send, `window.__otterCore.museSend(${JSON.stringify(task)})`, true, 10000);
      });
      if (!sendRes?.ok) return { ok: false, replyText: "", attachments: [], error: sendRes?.error || "Gửi prompt vào Muse thất bại" };

      const { oldBubbleCount = 0, oldLastText = "" } = sendRes;
      let lastText = "";
      let stableCount = 0;
      let hasStarted = false;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const state = await this.withTabSession(museTab, async (send) => {
          await this.ensureCoreInSession(send, tabId);
          return this.evalInSession(send, "window.__otterCore.musePoll()", false, 8000);
        }).catch(() => null);
        if (!state) continue;
        if (state.isOutOfCredits) return { ok: false, replyText: "", attachments: [], error: "Tài khoản Muse đã hết hạn ngạch." };

        if (!hasStarted && (state.hasStop || state.bubbleCount > oldBubbleCount || (state.text && state.text !== oldLastText))) {
          hasStarted = true;
        }
        if (hasStarted) {
          if (state.text === lastText && state.text.length > 0) {
            stableCount++;
            const finished = (!state.hasStop && (stableCount >= 2 || (state.attachments?.length || 0) > 0)) || stableCount >= 5;
            if (finished) {
              const finalAtts = state.attachments || [];
              for (const a of finalAtts) {
                if (!a.url) continue;
                const extracted = await this.withTabSession(museTab, async (send) => {
                  await this.ensureCoreInSession(send, tabId);
                  return this.evalInSession(send, `window.__otterCore.museExtractBlob(${JSON.stringify(a.url)})`, true, 30000);
                }).catch(() => null);
                if (extracted?.base64) {
                  a.base64 = extracted.base64;
                  a.mime = extracted.mime;
                  a.size = extracted.size;
                }
              }
              return { ok: true, replyText: state.text, attachments: finalAtts, tabId };
            }
          } else {
            lastText = state.text;
            stableCount = 0;
          }
        }
      }
      return { ok: false, replyText: lastText, attachments: [], error: `Quá thời gian chờ (${Math.round(timeout / 1000)}s) phản hồi từ Muse.` };
    } finally {
      if (options?.closeTabOnDone && created) {
        await this.closeTab(tabId, port).catch(() => {});
      }
    }
  }

  /**
   * Bật / tắt Visual Activation HUD + Live Hover Inspector trên tab CDP hiện tại
   */
  async injectHud(toggle = false, urlPattern?: string, port?: number): Promise<any> {
    const tab = await this.findTargetTab(urlPattern, port);
    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(send, `window.__otterCore.injectHud(${Boolean(toggle)})`, false, 6000);
    });
  }

  /**
   * Thực thi JS tùy ý trên tab CDP (bật includeCommandLineAPI để hỗ trợ $0/$1/$$ khi đang mở DevTools)
   */
  async evaluateOnTab(script: string, urlPattern?: string, port?: number): Promise<any> {
    const tab = await this.findTargetTab(urlPattern, port);
    return this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      const value = await this.evalInSession(send, script, true, 25000, true);
      return { ok: true, result: value, tabId: tab.id };
    });
  }

  /**
   * Đo đạc độ trễ phản hồi của CDP (Benchmark latency)
   */
  async benchmark(rounds = 3, port?: number): Promise<{ available: boolean; averageLatencyMs: number; error?: string }> {
    const targetPort = port || this.defaultPort;
    if (!(await this.isAvailable(port))) {
      return { available: false, averageLatencyMs: -1, error: `Cổng CDP ${targetPort} không phản hồi` };
    }

    try {
      const tab = await this.findTargetTab(undefined, port);

      const latencies: number[] = [];
      await this.withTabSession(tab, async (send) => {
        await this.ensureCoreInSession(send, tab.id);
        for (let i = 0; i < rounds; i++) {
          const start = performance.now();
          await this.evalInSession(send, "1 + 1", false, 3000);
          latencies.push(performance.now() - start);
        }
      });

      const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      return { available: true, averageLatencyMs: avg };
    } catch (err: any) {
      return { available: false, averageLatencyMs: -1, error: err.message };
    }
  }

  /**
   * Chèn tin nhắn vào ô nhập của ChatGPT Web qua CDP (không cần Extension).
   */
  async injectChatMessage(text: string, autoSubmit = true, port?: number): Promise<{ ok: boolean; message: string }> {
    let tab: CdpTab;
    try {
      const tabs = await this.getTabs(port);
      const pageTabs = tabs.filter((t) => this.isUsablePageTab(t));
      const chatTab = pageTabs.find((t) => t.url.toLowerCase().includes("chatgpt.com"));
      if (chatTab) {
        tab = chatTab;
      } else if (pageTabs.length > 0) {
        tab = pageTabs[0];
      } else {
        tab = await this.createTab("https://chatgpt.com", port);
        await new Promise((r) => setTimeout(r, 3500));
      }
    } catch {
      tab = await this.findTargetTab("chatgpt.com", port);
    }

    const res = await this.withTabSession(tab, async (send) => {
      await this.ensureCoreInSession(send, tab.id);
      return this.evalInSession(
        send,
        `window.__otterCore.injectChatMessage(${JSON.stringify(text)}, ${Boolean(autoSubmit)})`,
        true,
        35000
      );
    });
    if (!res?.ok) throw new Error(res?.error || "Chèn tin nhắn vào ChatGPT thất bại");
    return {
      ok: true,
      message: autoSubmit
        ? "Đã chèn và gửi tin nhắn vào ChatGPT qua CDP Core thành công"
        : "Đã chèn tin nhắn vào ô soạn thảo ChatGPT qua CDP Core (chưa gửi)",
    };
  }

  /**
   * Đảm bảo có Chrome mở cổng CDP và tự động nạp sẵn Otter Core vào tất cả tab ngay khi load!
   * Có khóa chống chạy trùng: nhiều lời gọi đồng thời dùng chung một lần khởi động.
   */
  async ensureCdpChrome(port?: number): Promise<boolean> {
    if (this.ensureCdpInFlight) return this.ensureCdpInFlight;
    const run = this.doEnsureCdpChrome(port);
    this.ensureCdpInFlight = run;
    try {
      return await run;
    } finally {
      if (this.ensureCdpInFlight === run) this.ensureCdpInFlight = null;
    }
  }

  private async doEnsureCdpChrome(port?: number): Promise<boolean> {
    if (await this.isAvailable(port)) {
      return true;
    }
    const targetPort = port || this.defaultPort;
    if (await this.ensureProfileRunning(undefined, targetPort)) {
      return true;
    }

    const chromePath = findChromeExecutable();
    if (!chromePath) {
      console.warn("[CDP Bridge] Không tìm thấy Chrome/Chromium để tự khởi động CDP.");
      return false;
    }

    const profileDir = path.join(getOtterDir(), "cdp-profile");
    fs.mkdirSync(profileDir, { recursive: true });

    const headlessEnv = process.env.OTTER_CDP_HEADLESS;
    const headless =
      headlessEnv === "1" ||
      (headlessEnv !== "0" &&
        process.platform === "linux" &&
        !process.env.DISPLAY &&
        !process.env.WAYLAND_DISPLAY);

    const args = [
      `--remote-debugging-port=${targetPort}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...(headless ? ["--headless=new"] : []),
      "about:blank",
    ];

    try {
      console.log(
        `[CDP Bridge] Đang tự khởi động Chrome CDP (cổng ${targetPort}, profile ${profileDir}${headless ? ", headless" : ""})...`
      );
      const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
      child.on("error", () => {});
      child.on("exit", () => {
        if (this.spawnedChrome === child) {
          this.spawnedChrome = null;
          this.clearIdleTimer();
        }
      });
      child.unref();
      this.spawnedChrome = child;
    } catch (err: any) {
      console.warn(`[CDP Bridge] Không khởi động được Chrome: ${err.message}`);
      return false;
    }

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await this.isAvailable(targetPort)) {
        const preloaded = await this.preloadCoreOnAllTabs(targetPort);
        console.log(`[CDP Bridge] Đã nạp sẵn Otter Page-Agent Core (${OTTER_CORE_VERSION}) vào ${preloaded} tab.`);
        this.resetIdleTimer();
        return true;
      }
    }
    console.warn(`[CDP Bridge] Chrome đã spawn nhưng cổng ${targetPort} chưa sẵn sàng sau 10 giây.`);
    return false;
  }

  /**
   * Đóng trình duyệt Chrome CDP và giải phóng toàn bộ tài nguyên
   */
  async closeBrowser(port?: number): Promise<{ ok: boolean; message: string }> {
    this.clearIdleTimer();
    let closed = false;
    const targetPort = port || this.defaultPort;

    // 1. Gửi lệnh Browser.close qua Browser WebSocket nếu cổng đang mở
    try {
      const versionRes = await fetch(`http://127.0.0.1:${targetPort}/json/version`, {
        signal: AbortSignal.timeout(1500),
      });
      if (versionRes.ok) {
        const vData = await versionRes.json();
        if (vData?.webSocketDebuggerUrl) {
          await new Promise<void>((resolve) => {
            const ws = new WebSocket(vData.webSocketDebuggerUrl);
            const timer = setTimeout(() => {
              try { ws.close(); } catch {}
              resolve();
            }, 2500);

            ws.onopen = () => {
              try {
                ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
              } catch {}
            };
            ws.onmessage = () => {
              clearTimeout(timer);
              try { ws.close(); } catch {}
              resolve();
            };
            ws.onclose = () => {
              clearTimeout(timer);
              resolve();
            };
            ws.onerror = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          closed = true;
        }
      }
    } catch {}

    // 2. Kill spawned child process nếu có
    if (this.spawnedChrome) {
      try {
        if (!this.spawnedChrome.killed) {
          this.spawnedChrome.kill();
        }
        closed = true;
      } catch {}
      this.spawnedChrome = null;
    }

    this.resetBrowserWs();
    this.attachedSessions.clear();
    this.preloadedTabIds.clear();
    this.controlledTabId = null;

    return {
      ok: closed,
      message: closed ? "Đã đóng trình duyệt Chrome CDP thành công" : "Không tìm thấy phiên Chrome CDP nào đang mở",
    };
  }

  /**
   * Unified dispatcher — đầy đủ 100% hành động của Extension BrowserController chạy trực tiếp trên CDP!
   */
  async execute(action: string, params: any = {}): Promise<any> {
    this.resetIdleTimer();
    switch (action) {
      case "close":
      case "close_browser":
        return this.closeBrowser();
      case "open":
        return this.openUrl(params.url);
      case "read_page":
        return this.readPage(params.urlPattern);
      case "click":
        return this.click(params.index, params.urlPattern);
      case "type":
        return this.type(params.index, params.text, params.pressEnter, params.urlPattern);
      case "select":
        return this.select(params.index, params.option, params.urlPattern);
      case "scroll":
        return this.scroll(params.direction || "down", params.amount, params.urlPattern);
      case "back":
        return this.back(params.urlPattern);
      case "list_tabs":
        return this.listTabs();
      case "switch_tab":
        return this.switchTab(params.tabId);
      case "close_tab":
        return this.closeTab(params.tabId);
      case "inject_chat_message":
        return this.injectChatMessage(params.text ?? params.message ?? "", params.autoSubmit !== false);
      case "evaluate_js":
        return this.evaluateOnTab(params.script || params.code || "", params.urlPattern);
      case "close_messenger_docks":
        return this.closeMessengerDocks();
      case "read_comments":
        return this.readComments(params.currentUserName, params.postUrl);
      case "read_feed":
        return this.readFeed();
      case "fb_react":
        return this.reactFacebook(params.index, params.author, params.reaction);
      case "fb_comment":
        return this.commentFacebook({
          commentIndex: params.commentIndex,
          author: params.author,
          commentText: params.commentText,
        });
      case "fb_post_to_group":
        return this.postToFacebookGroup({
          groupUrl: params.groupUrl,
          content: params.content,
        });
      case "fb_post_media":
        return this.postMediaToFacebook({
          targetType: params.targetType || "profile",
          targetUrl: params.targetUrl,
          mediaPath: params.mediaPath,
          mediaType: params.mediaType,
          caption: params.caption,
        });
      case "ask_muse":
        return this.askMuse(params.task, {
          newThread: params.newThread,
          timeoutMs: params.timeoutMs,
          closeTabOnDone: params.closeTabOnDone,
        });
      case "inject_hud":
        return this.injectHud(Boolean(params.toggle), params.urlPattern);
      case "reload_extension":
        this.preloadedTabIds.clear();
        const count = await this.preloadCoreOnAllTabs();
        return {
          ok: true,
          message: `Đã nạp lại Otter Page-Agent Core (${OTTER_CORE_VERSION}) vào ${count} tab Chrome CDP (không cần Extension).`,
        };
      default:
        throw new Error(`Hành động '${action}' chưa được hỗ trợ bởi CDP Bridge.`);
    }
  }
}

export const cdpBridge = new CdpBridge();
