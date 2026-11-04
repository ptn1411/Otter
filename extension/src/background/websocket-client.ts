export interface WebSocketCallbacks {
  onStatusChange: (status: "connected" | "connecting" | "offline", message?: string) => void;
  onActivityPage: (page: { conversationId: string; items: any[] }) => void;
  onTerminalOutput: (output: string) => void;
  onInjectPrompt?: (text: string, autoSubmit?: boolean, injectionId?: string) => void;
  onBrowserAction?: (action: string, params: any) => Promise<any>;
  onPageLoopStart?: (loopId: string) => void;
  onPageLoopStop?: (loopId: string, reason?: string) => void;
}

export class DaemonWebSocketClient {
  private socket: WebSocket | null = null;
  private keepaliveTimer: any = null;
  private reconnectTimer: any = null;
  private isDisposed: boolean = false;
  // Phase 5: exponential backoff for reconnects (3s -> 6s -> 12s ... -> 60s cap),
  // instead of a fixed 3s retry that hammers a daemon that is still down.
  private reconnectAttempts: number = 0;

  /** Phase 5: report an inject result back to the daemon (outbox ack). */
  isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendInjectResult(injectionId: string, ok: boolean, error?: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "inject_result", injectionId, ok, error }));
    }
  }

  /** Page-loop: gửi message tùy ý (chatgpt_turn, page_loop_status, lease_heartbeat) về daemon. */
  sendGeneric(payload: any): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private scheduleReconnect(): void {
    if (this.isDisposed) return;
    const delay = Math.min(60_000, 3000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.callbacks.onStatusChange("offline", `Mất kết nối. Đang thử lại sau ${Math.round(delay / 1000)}s...`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  constructor(
    private apiBase: string,
    private conversationUrl: string,
    private callbacks: WebSocketCallbacks,
    private apiKey?: string
  ) {}

  connect() {
    if (this.isDisposed) return;
    this.close();

    let wsUrl = this.apiBase.replace(/^http/, "ws") + "/api/activity/v1/stream";
    if (this.apiKey) {
      wsUrl += (wsUrl.includes("?") ? "&" : "?") + `token=${encodeURIComponent(this.apiKey)}`;
    }
    this.callbacks.onStatusChange("connecting", "Đang kết nối tới máy chủ daemon...");

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        if (this.isDisposed || !this.socket) return;
        this.reconnectAttempts = 0;
        this.callbacks.onStatusChange("connected", "Đã kết nối máy chủ");

        // Gửi bản tin subscribe
        this.socket.send(JSON.stringify({
          type: "subscribe",
          conversationUrl: this.conversationUrl,
          after: 0
        }));

        // Bật heartbeat ping
        this.keepaliveTimer = setInterval(() => {
          if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 10000);
      };

      this.socket.onmessage = async (event) => {
        if (this.isDisposed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "activity.ready") {
            this.callbacks.onStatusChange("connected", `Sẵn sàng (${data.conversationId})`);
          } else if (data.type === "activity.page") {
            this.callbacks.onActivityPage(data.page);
          } else if (data.type === "terminal_output") {
            this.callbacks.onTerminalOutput(data.output);
          } else if (data.type === "inject_prompt") {
            this.callbacks.onInjectPrompt?.(data.text, data.autoSubmit, data.injectionId);
          } else if (data.type === "page_loop_start") {
            this.callbacks.onPageLoopStart?.(data.loopId);
          } else if (data.type === "page_loop_stop") {
            this.callbacks.onPageLoopStop?.(data.loopId, data.reason);
          } else if (data.type === "browser_action") {
            // Yêu cầu thao tác trình duyệt từ ChatGPT Web qua Daemon
            if (this.callbacks.onBrowserAction) {
              try {
                const result = await this.callbacks.onBrowserAction(data.action, data.params);
                this.socket?.send(JSON.stringify({
                  type: "browser_action_result",
                  id: data.id,
                  ok: true,
                  result
                }));
              } catch (err: any) {
                this.socket?.send(JSON.stringify({
                  type: "browser_action_result",
                  id: data.id,
                  ok: false,
                  error: err.message
                }));
              }
            }
          }
        } catch {}
      };

      this.socket.onclose = () => {
        this.cleanup();
        if (!this.isDisposed) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        // Lỗi kết nối sẽ kích hoạt onclose
      };
    } catch (err: any) {
      this.callbacks.onStatusChange("offline", err.message);
      this.scheduleReconnect();
    }
  }

  private cleanup() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  close() {
    this.cleanup();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
  }

  dispose() {
    this.isDisposed = true;
    this.close();
  }
}
