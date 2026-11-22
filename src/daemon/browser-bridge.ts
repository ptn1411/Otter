/**
 * Otter Browser Bridge (Dual-Engine: CDP chính + Extension dự phòng)
 *
 * 1. Engine CDP (MẶC ĐỊNH): Chrome DevTools Protocol (Port 9222 / GPM Login /
 *    Chrome tự spawn với profile ~/.otter/cdp-profile). Dễ quản lý, không cần
 *    cài extension, chạy được headless/trên VPS.
 * 2. Engine Extension: Chrome Extension Manifest V3 (WebSocket port 1993) —
 *    giữ cho tích hợp sâu vào ChatGPT Web (HUD, sidepanel, chèn/đọc chat).
 *
 * Chế độ "cdp" (mặc định): chỉ CDP, tự mở Chrome CDP khi chưa có.
 * Chế độ "auto": ưu tiên CDP, fallback Extension nếu CDP không sẵn sàng.
 * Chế độ "extension": chỉ Extension như trước.
 * Đổi mặc định qua biến môi trường OTTER_BROWSER_ENGINE=cdp|auto|extension.
 */
import { cdpBridge } from "./cdp-bridge";

export type BrowserEngineMode = "auto" | "extension" | "cdp";

function defaultEngineMode(): BrowserEngineMode {
  const env = (process.env.OTTER_BROWSER_ENGINE || "").trim().toLowerCase();
  if (env === "extension" || env === "auto" || env === "cdp") return env;
  return "cdp";
}

export const activeSockets = new Set<any>();

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

export class BrowserBridge {
  private pendingRequests = new Map<string, PendingRequest>();
  private engineMode: BrowserEngineMode = defaultEngineMode();

  /**
   * Đặt chế độ động cơ: 'auto' | 'extension' | 'cdp'
   */
  setEngineMode(mode: BrowserEngineMode): void {
    this.engineMode = mode;
  }

  getEngineMode(): BrowserEngineMode {
    return this.engineMode;
  }

  /**
   * Lấy socket extension đang kết nối (ưu tiên service worker nền bền vững)
   */
  private getActiveSocket(): any {
    for (const ws of activeSockets) {
      if (ws.readyState === 1 && ws.data?.conversationUrl === "global-background-worker") {
        return ws;
      }
    }
    for (const ws of activeSockets) {
      if (ws.readyState === 1) { // WebSocket.OPEN
        return ws;
      }
    }
    return null;
  }

  /**
   * Kiểm tra trạng thái hiện tại của cả 2 động cơ
   */
  async getStatus(): Promise<{
    mode: BrowserEngineMode;
    activeEngine: "extension" | "cdp" | "none";
    extension: { connected: boolean; socketsCount: number };
    cdp: { available: boolean; port: number };
  }> {
    const extConnected = this.getActiveSocket() !== null;
    const cdpAvailable = await cdpBridge.isAvailable();

    let activeEngine: "extension" | "cdp" | "none" = "none";
    if (this.engineMode === "extension") {
      activeEngine = extConnected ? "extension" : "none";
    } else if (this.engineMode === "cdp") {
      activeEngine = cdpAvailable ? "cdp" : "none";
    } else {
      // auto: ưu tiên CDP (engine chính), fallback sang Extension
      if (cdpAvailable) activeEngine = "cdp";
      else if (extConnected) activeEngine = "extension";
      else activeEngine = "none";
    }

    return {
      mode: this.engineMode,
      activeEngine,
      extension: {
        connected: extConnected,
        socketsCount: activeSockets.size
      },
      cdp: {
        available: cdpAvailable,
        port: cdpBridge.getPort()
      }
    };
  }

  /**
   * Chạy benchmark so sánh tốc độ giữa Extension và CDP
   */
  async benchmark(): Promise<{
    extension: { connected: boolean; latencyMs: number };
    cdp: { available: boolean; latencyMs: number };
    recommendation: string;
  }> {
    const cdpBench = await cdpBridge.benchmark(3);
    const extSocket = this.getActiveSocket();
    let extLatency = -1;

    if (extSocket) {
      try {
        const start = performance.now();
        await this.executeViaExtension("list_tabs", {}, 5000);
        extLatency = Math.round(performance.now() - start);
      } catch {
        extLatency = -1;
      }
    }

    let recommendation = "";
    if (cdpBench.available && extSocket) {
      if (cdpBench.averageLatencyMs <= extLatency) {
        recommendation = `CDP nhanh hơn (${cdpBench.averageLatencyMs}ms vs ${extLatency}ms). Khuyên dùng CDP cho tốc độ và tính ổn định cao.`;
      } else {
        recommendation = `Extension phản hồi nhanh (${extLatency}ms vs ${cdpBench.averageLatencyMs}ms).`;
      }
    } else if (cdpBench.available) {
      recommendation = `Động cơ CDP đang phản hồi siêu tốc (${cdpBench.averageLatencyMs}ms). Extension hiện chưa kết nối.`;
    } else if (extSocket) {
      recommendation = `Extension đang kết nối (${extLatency}ms). Cổng CDP 9222 hiện chưa mở.`;
    } else {
      recommendation = "Cả 2 động cơ đều chưa sẵn sàng.";
    }

    return {
      extension: {
        connected: Boolean(extSocket),
        latencyMs: extLatency
      },
      cdp: {
        available: cdpBench.available,
        latencyMs: cdpBench.averageLatencyMs
      },
      recommendation
    };
  }

  /**
   * Thực thi hành động qua Extension
   */
  private async executeViaExtension(action: string, params: any = {}, timeoutMs = 30000): Promise<any> {
    const ws = this.getActiveSocket();
    if (!ws) {
      throw new Error("Extension Otter chưa kết nối. Vui lòng kiểm tra extension Otter đã được bật trên trình duyệt.");
    }

    const id = "act-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Thao tác '${action}' trên trình duyệt bị timeout sau ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        ws.send(JSON.stringify({
          type: "browser_action",
          id,
          action,
          params
        }));
      } catch (err: any) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Gửi một hành động tới trình duyệt (Tự động định tuyến sang Extension hoặc CDP)
   */
  async execute(action: string, params: any = {}, timeoutMs = 30000): Promise<any> {
    if (action === "close" || action === "close_browser") {
      return cdpBridge.closeBrowser();
    }

    const status = await this.getStatus();

    if (status.activeEngine === "cdp") {
      try {
        return await cdpBridge.execute(action, params);
      } catch (err: any) {
        // Trạng thái vừa báo CDP sẵn sàng nhưng kết nối đã chết/bị từ chối giữa chừng
        // (ví dụ người dùng bấm Huỷ ở hộp thoại gỡ lỗi, hoặc Chrome vừa đóng):
        // tự phục hồi bằng ensureCdpChrome rồi thử lại đúng một lần khi người dùng mở trang mới.
        const msg = String(err?.message || err || "");
        const isConnErr =
          /ECONNREFUSED|fetch failed|Browser WebSocket|chưa sẵn sàng|Không thể lấy danh sách tab|quá hạn|đã đóng|Không tìm thấy Browser WebSocket/i.test(msg);
        if (isConnErr && (action === "open" || action === "open_url")) {
          console.warn(`[BrowserBridge] CDP lỗi kết nối (${msg}), thử tự phục hồi...`);
          const launched = await cdpBridge.ensureCdpChrome();
          if (launched) {
            return await cdpBridge.execute(action, params);
          }
        }
        throw err;
      }
    }

    if (status.activeEngine === "extension") {
      return this.executeViaExtension(action, params, timeoutMs);
    }

    // Chưa có engine nào: CHỈ tự mở Chrome CDP khi người dùng chủ động mở trang web mới (action === "open" | "open_url").
    // TUYỆT ĐỐI KHÔNG tự mở Chrome cho các thao tác thụ động (read_page, click, type...) để tránh vòng lặp spawn vô tận.
    if (this.engineMode !== "extension" && (action === "open" || action === "open_url")) {
      const launched = await cdpBridge.ensureCdpChrome();
      if (launched) {
        return cdpBridge.execute(action, params);
      }
    }

    throw new Error(
      `Không có động cơ trình duyệt nào khả dụng!\n` +
      `- Động cơ chính (CDP Port ${cdpBridge.getPort()}): Cổng CDP chưa mở và tự khởi động Chrome không thành công.\n` +
      `- Động cơ dự phòng (Extension): Chưa phát hiện WebSocket kết nối từ Chrome Extension Otter.\n` +
      `👉 Khắc phục: Cài Google Chrome/Chromium trên máy này, HOẶC mở GPM Login, HOẶC bật tiện ích Otter trên Chrome.`
    );
  }

  /**
   * Xử lý kết quả trả về từ Extension qua WebSocket
   */
  handleResult(data: { id: string; ok: boolean; result?: any; error?: string }): boolean {
    const pending = this.pendingRequests.get(data.id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pendingRequests.delete(data.id);

    if (data.ok) {
      pending.resolve(data.result);
    } else {
      pending.reject(new Error(data.error || "Lỗi không xác định từ Extension"));
    }
    return true;
  }

  /**
   * Gửi nội dung inject thẳng vào ô nhập của ChatGPT Web.
   * Nếu có WebSocket Extension thì gửi qua Extension; nếu không thì tự động gửi qua CDP.
   */
  injectPrompt(text: string, autoSubmit = true, injectionId?: string): boolean {
    const ws = this.getActiveSocket();
    if (ws) {
      try {
        ws.send(JSON.stringify({
          type: "inject_prompt",
          text,
          autoSubmit,
          ...(injectionId ? { injectionId } : {}),
        }));
        return true;
      } catch {}
    }

    // Tự động chuyển sang CDP khi không dùng Chrome Extension
    void this.injectPromptSmart(text, autoSubmit, injectionId);
    return true;
  }

  /**
   * Chèn tin nhắn vào ChatGPT: ưu tiên Extension (nếu đang kết nối),
   * tự động chuyển sang CDP (mở Chrome CDP / nạp Page-Agent Core) khi không có Extension.
   */
  async injectPromptSmart(text: string, autoSubmit = true, injectionId?: string): Promise<boolean> {
    const ws = this.getActiveSocket();
    if (ws) {
      try {
        ws.send(JSON.stringify({
          type: "inject_prompt",
          text,
          autoSubmit,
          ...(injectionId ? { injectionId } : {}),
        }));
        return true;
      } catch {}
    }

    // CHỈ inject qua CDP nếu CDP ĐÃ ĐANG MỞ SẴN và có tab ChatGPT!
    // TUYỆT ĐỐI KHÔNG tự tiện spawn Chrome mới nếu người dùng không mở ChatGPT Web!
    try {
      if (await cdpBridge.isAvailable()) {
        const tabs = await cdpBridge.getTabs();
        const hasChat = tabs.some((t) => t.url.toLowerCase().includes("chatgpt.com"));
        if (hasChat) {
          const res = await cdpBridge.injectChatMessage(text, autoSubmit);
          return Boolean(res.ok);
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const browserBridge = new BrowserBridge();
export { cdpBridge };
