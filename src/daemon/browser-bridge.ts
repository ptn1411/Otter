/**
 * Otter Browser Bridge (100% Native Chrome DevTools Protocol — CDP)
 *
 * Điều khiển trình duyệt trực tiếp qua Chrome DevTools Protocol (CDP):
 * - Hỗ trợ Chrome desktop, Chromium, GPM Login / GPM Automate, Edge, headless trên Linux/VPS.
 * - Tự động nạp Otter Page-Agent Core (window.__otterCore) vào tab mà không cần bất kỳ extension nào.
 * - Thao tác chuột/phím phần cứng (isTrusted: true), tải file trực tiếp, tốc độ phản hồi cực nhanh.
 */
import { cdpBridge } from "./cdp-bridge";

export type BrowserEngineMode = "cdp";

export const activeSockets = new Set<any>();

export class BrowserBridge {
  private engineMode: BrowserEngineMode = "cdp";

  setEngineMode(_mode?: string): void {
    this.engineMode = "cdp";
  }

  getEngineMode(): BrowserEngineMode {
    return "cdp";
  }

  /**
   * Kiểm tra trạng thái hiện tại của động cơ CDP
   */
  async getStatus(): Promise<{
    mode: BrowserEngineMode;
    activeEngine: "cdp" | "none";
    cdp: { available: boolean; port: number; wsEndpoint?: string };
  }> {
    const cdpAvailable = await cdpBridge.isAvailable();
    return {
      mode: "cdp",
      activeEngine: cdpAvailable ? "cdp" : "none",
      cdp: {
        available: cdpAvailable,
        port: cdpBridge.getPort(),
        ...(cdpBridge.getWsEndpoint() ? { wsEndpoint: cdpBridge.getWsEndpoint()! } : {})
      }
    };
  }

  /**
   * Chạy benchmark đo tốc độ phản hồi của động cơ CDP
   */
  async benchmark(): Promise<{
    cdp: { available: boolean; latencyMs: number };
    recommendation: string;
  }> {
    const cdpBench = await cdpBridge.benchmark(3);
    const recommendation = cdpBench.available
      ? `Động cơ CDP đang phản hồi siêu tốc (${cdpBench.averageLatencyMs}ms).`
      : `Động cơ CDP chưa sẵn sàng trên cổng ${cdpBridge.getPort()}.`;

    return {
      cdp: {
        available: cdpBench.available,
        latencyMs: cdpBench.averageLatencyMs
      },
      recommendation
    };
  }

  /**
   * Gửi một hành động tới trình duyệt qua CDP
   */
  async execute(action: string, params: any = {}): Promise<any> {
    if (params?.cdpPort || params?.port) {
      const p = Number(params.cdpPort || params.port);
      if (Number.isFinite(p) && p > 0) cdpBridge.setPort(p);
    }
    if (params?.wsEndpoint) {
      cdpBridge.setWsEndpoint(String(params.wsEndpoint));
    }

    if (action === "close" || action === "close_browser") {
      return cdpBridge.closeBrowser(params?.cdpPort || params?.port || cdpBridge.getPort());
    }

    const cdpAvailable = await cdpBridge.isAvailable();

    if (cdpAvailable) {
      try {
        return await cdpBridge.execute(action, params);
      } catch (err: any) {
        // Tự phục hồi bằng ensureCdpChrome khi gặp lỗi mất kết nối lúc mở trang mới
        const msg = String(err?.message || err || "");
        const isConnErr =
          /ECONNREFUSED|fetch failed|Browser WebSocket|chưa sẵn sàng|chưa chạy|Không thể lấy danh sách tab|quá hạn|đã đóng|Không tìm thấy Browser WebSocket/i.test(msg);
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

    // Chưa mở CDP: CHỈ tự mở Chrome CDP khi người dùng chủ động mở trang web mới (action === "open" | "open_url").
    // TUYỆT ĐỐI KHÔNG tự mở Chrome cho các thao tác thụ động (read_page, click, type...) để tránh vòng lặp spawn vô tận.
    let autoLaunchAttempted = false;
    if (action === "open" || action === "open_url") {
      autoLaunchAttempted = true;
      const launched = await cdpBridge.ensureCdpChrome();
      if (launched) {
        return cdpBridge.execute(action, params);
      }
    }

    const cdpDetail = autoLaunchAttempted
      ? `Cổng CDP ${cdpBridge.getPort()} chưa mở và tự khởi động Chrome không thành công.`
      : `Trình duyệt Chrome CDP (port ${cdpBridge.getPort()}) hiện chưa chạy. Vui lòng gọi browser_open trước để khởi động Chrome CDP.`;

    throw new Error(
      `Động cơ trình duyệt CDP chưa sẵn sàng!\n` +
      `- ${cdpDetail}\n` +
      `👉 Khắc phục: Khởi động Chrome với cờ --remote-debugging-port=${cdpBridge.getPort()}, hoặc mở profile GPM Login/Automate, hoặc gọi browser_open.`
    );
  }

  /**
   * Giữ tương thích nếu có kết quả gửi qua WebSocket
   */
  handleResult(_data: any): boolean {
    return false;
  }

  /**
   * Chèn tin nhắn báo cáo vào ChatGPT Web qua CDP
   */
  injectPrompt(text: string, autoSubmit = true, injectionId?: string): boolean {
    void this.injectPromptSmart(text, autoSubmit, injectionId);
    return true;
  }

  /**
   * Chèn tin nhắn vào ChatGPT qua CDP Core
   */
  async injectPromptSmart(text: string, autoSubmit = true, _injectionId?: string): Promise<boolean> {
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
