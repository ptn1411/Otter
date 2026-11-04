import type { TerminalInfo, TerminalLiveOutput, ControlStatus, ActivityItem } from "../types";

export class ApiClient {
  constructor(private apiBase: string, private apiKey?: string) {
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-ChatGPT": "chatgpt-extension",
      ...(options.headers as Record<string, string> || {})
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      ...options,
      headers
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errText || res.statusText}`);
    }

    return await res.json();
  }

  // 1. Folder Picker (Native Windows GUI)
  async pickProjectFolder(initialPath?: string): Promise<{ path: string | null }> {
    return this.request<{ path: string | null }>("/api/local/system/folder-picker", {
      method: "POST",
      body: JSON.stringify({ initialPath })
    });
  }

  // 1.1 File Picker (Native Windows GUI)
  async pickFile(initialPath?: string, multiple?: boolean): Promise<{ path: string | null; paths?: string[] }> {
    return this.request<{ path: string | null; paths?: string[] }>("/api/local/system/file-picker", {
      method: "POST",
      body: JSON.stringify({ initialPath, multiple })
    });
  }

  // 2. Terminal APIs
  async listTerminals(conversationId: string): Promise<{ terminals: TerminalInfo[] }> {
    return this.request<{ terminals: TerminalInfo[] }>(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/terminals`
    );
  }

  async getTerminalLive(
    conversationId: string,
    sessionId: string,
    afterSequence: number = 0,
    waitMs: number = 5000
  ): Promise<TerminalLiveOutput> {
    return this.request<TerminalLiveOutput>(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/terminals/${encodeURIComponent(sessionId)}/live?afterSequence=${afterSequence}&waitMs=${waitMs}`
    );
  }

  async sendTerminalInput(
    conversationId: string,
    sessionId: string,
    text: string
  ): Promise<{ accepted: boolean }> {
    return this.request<{ accepted: boolean }>(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/terminals/${encodeURIComponent(sessionId)}/input`,
      {
        method: "POST",
        body: JSON.stringify({ text })
      }
    );
  }

  // 3. Control & Continuous Mode
  async getControl(conversationId: string): Promise<ControlStatus> {
    return this.request<ControlStatus>(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/control`
    );
  }

  async setContinuous(conversationId: string, enabled: boolean): Promise<any> {
    return this.request(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/continuous`,
      {
        method: "PUT",
        body: JSON.stringify({ enabled })
      }
    );
  }

  async extendContinuous(conversationId: string, seconds: number = 60): Promise<any> {
    return this.request(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/continuous/extend`,
      {
        method: "POST",
        body: JSON.stringify({ seconds })
      }
    );
  }

  // 4. Immediate Prompt Steer
  async sendImmediate(conversationId: string, content: string): Promise<{ ok: boolean; messageId: string }> {
    return this.request<{ ok: boolean; messageId: string }>(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/immediate`,
      {
        method: "POST",
        body: JSON.stringify({ content })
      }
    );
  }

  // 5. Activity Events Journal
  async getEvents(conversationId: string): Promise<{ items: ActivityItem[] }> {
    return this.request<{ items: ActivityItem[] }>(
      `/api/activity/v1/conversations/${encodeURIComponent(conversationId)}/events`
    );
  }
}
