/**
 * Otter Browser Bridge (Dual-Engine: Extension + CDP)
 * 
 * Hỗ trợ 2 động cơ điều khiển trình duyệt song song:
 * 1. Engine Extension: Kết nối qua Chrome Extension Manifest V3 (WebSocket port 1993)
 * 2. Engine CDP: Kết nối trực tiếp qua Chrome DevTools Protocol (Port 9222 / GPM Login / Chrome Remote Debugging)
 * 
 * Chế độ "auto": Tự động ưu tiên Extension nếu có, tự động chuyển sang CDP nếu Extension không cắm.
 */
import { cdpBridge } from "./cdp-bridge";

export type BrowserEngineMode = "auto" | "extension" | "cdp";

export const activeSockets = new Set<any>();

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

export class BrowserBridge {
  private pendingRequests = new Map<string, PendingRequest>();
  private engineMode: BrowserEngineMode = "auto";

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
      // auto: ưu tiên Extension nếu có socket kết nối, fallback sang CDP
      if (extConnected) activeEngine = "extension";
      else if (cdpAvailable) activeEngine = "cdp";
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
    const status = await this.getStatus();

    if (status.activeEngine === "cdp") {
      return cdpBridge.execute(action, params);
    }

    if (status.activeEngine === "extension") {
      return this.executeViaExtension(action, params, timeoutMs);
    }

    throw new Error(
      `Không có động cơ trình duyệt nào khả dụng!\n` +
      `- Động cơ 1 (Extension): Chưa phát hiện WebSocket kết nối từ Chrome Extension Otter.\n` +
      `- Động cơ 2 (CDP Port ${cdpBridge.getPort()}): Cổng CDP chưa mở.\n` +
      `👉 Khắc phục: Bật tiện ích Otter trên Chrome HOẶC khởi động trình duyệt/GPM Login kèm tham số '--remote-debugging-port=${cdpBridge.getPort()}'.`
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
   */
  injectPrompt(text: string, autoSubmit = true, injectionId?: string): boolean {
    const ws = this.getActiveSocket();
    if (!ws) return false;

    ws.send(JSON.stringify({
      type: "inject_prompt",
      text,
      autoSubmit,
      ...(injectionId ? { injectionId } : {}),
    }));
    return true;
  }
}

export const browserBridge = new BrowserBridge();
export { cdpBridge };
