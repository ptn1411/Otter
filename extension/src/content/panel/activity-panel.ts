/**
 * Activity Panel Sidebar for ChatGPT Web
 * Shows real-time connection status, tool call history, and agent continuous controls
 */

import type { ActivityItem } from "../../types";
import { t, onLanguageChange } from "../../i18n";

export class ActivityPanel {
  private panel: HTMLElement;
  private triggerBtn: HTMLElement;
  private statusDot: HTMLElement;
  private statusText: HTMLElement;
  private serverLabel: HTMLElement;
  private eventsList: HTMLElement;
  private continuousToggle: HTMLInputElement;
  private isOpen: boolean = false;
  private apiBase: string = "http://127.0.0.1:1993";
  private mcpSection!: HTMLElement;
  private mcpBadge!: HTMLElement;
  private mcpServerListContainer!: HTMLElement;
  private isMcpSectionOpen: boolean = false;
  private currentState: "connected" | "connecting" | "offline" = "offline";
  private currentServerName: string = "Localhost (1993)";

  constructor(
    private conversationId: string,
    private onOpenTerminal: () => void
  ) {
    // 1. Nút mở nhanh thanh Activity ở góc dưới bên phải
    this.triggerBtn = document.createElement("button");
    this.triggerBtn.id = "otter-activity-trigger";
    this.triggerBtn.className = "chatmcp-activity-trigger";
    this.triggerBtn.textContent = "⚡ Otter";
    this.triggerBtn.title = "Mở bảng hoạt động & điều khiển Otter";
    this.triggerBtn.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      background: #10a37f;
      color: #000;
      font-weight: 600;
      font-size: 12px;
      padding: 8px 14px;
      border-radius: 9999px;
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(16, 163, 127, 0.4);
      transition: all 0.2s ease;
      font-family: system-ui, sans-serif;
    `;
    this.triggerBtn.onclick = () => this.toggle();
    document.body.appendChild(this.triggerBtn);

    // 2. Sidebar Panel
    this.panel = document.createElement("div");
    this.panel.id = "otter-activity-panel";
    this.panel.className = "chatmcp-activity-panel";
    this.panel.style.cssText = `
      position: fixed;
      top: 0;
      right: -380px;
      width: 380px;
      height: 100vh;
      background: #171717;
      border-left: 1px solid #333;
      box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);
      z-index: 100000;
      display: flex;
      flex-direction: column;
      font-family: system-ui, sans-serif;
      color: #fff;
      transition: right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(16px);
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      padding: 16px;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1e1e1e;
    `;

    const statusGroup = document.createElement("div");
    statusGroup.style.cssText = "display: flex; align-items: center; gap: 8px;";

    this.statusDot = document.createElement("span");
    this.statusDot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10a37f;
    `;

    const titleBox = document.createElement("div");
    this.statusText = document.createElement("strong");
    this.statusText.textContent = `🦦 ${t("activity_title")}`;
    this.statusText.style.cssText = "font-size: 13px; display: block;";

    this.serverLabel = document.createElement("span");
    this.serverLabel.textContent = "Localhost (1993)";
    this.serverLabel.style.cssText = "font-size: 11px; color: #888;";

    titleBox.appendChild(this.statusText);
    titleBox.appendChild(this.serverLabel);

    statusGroup.appendChild(this.statusDot);
    statusGroup.appendChild(titleBox);

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #888;
      font-size: 16px;
      cursor: pointer;
      padding: 4px;
    `;
    closeBtn.onclick = () => this.hide();

    header.appendChild(statusGroup);
    header.appendChild(closeBtn);

    // Control bar
    const controls = document.createElement("div");
    controls.style.cssText = `
      padding: 12px 16px;
      border-bottom: 1px solid #2a2a2a;
      background: #141414;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;

    // Continuous mode toggle
    const contRow = document.createElement("label");
    contRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; font-size: 12px; cursor: pointer;";
    contRow.innerHTML = `<span>${t("activity_continuous")}</span>`;

    this.continuousToggle = document.createElement("input");
    this.continuousToggle.type = "checkbox";
    this.continuousToggle.onchange = () => this.toggleContinuous(this.continuousToggle.checked);
    contRow.appendChild(this.continuousToggle);

    // Node picker theo tab (Phase 0 fleet): trước đây setTabServer
    // tồn tại nhưng không có UI nào gọi nó, nên mọi tab ChatGPT đều
    // mặc định về localhost. Giờ tab này chọn node nào thì tab đó
    // nối daemon đó, tab khác không bị ảnh hưởng.
    const nodeRow = document.createElement("label");
    nodeRow.style.cssText = "display: flex; align-items: center; justify-content: space-between; font-size: 12px; gap: 8px;";
    nodeRow.innerHTML = `<span>${t("panel_node_label")}</span>`;
    const nodeSelect = document.createElement("select");
    nodeSelect.style.cssText = "background: #252525; border: 1px solid #3a3a3a; color: #fff; border-radius: 6px; padding: 5px; font-size: 12px; max-width: 220px;";
    nodeSelect.onchange = async () => {
      try {
        await chrome.runtime.sendMessage({ type: "set-tab-server", serverId: nodeSelect.value });
        await chrome.runtime.sendMessage({ type: "tab-connect", conversationUrl: location.href, conversationId: this.conversationId });
      } catch (err) { console.error("[Otter ActivityPanel] Failed to switch node:", err); }
    };
    nodeRow.appendChild(nodeSelect);
    controls.appendChild(nodeRow);
    void (async () => {
      try {
        const res: any = await chrome.runtime.sendMessage({ type: "get-servers" });
        const servers = res?.servers || [];
        for (const s of servers) {
          const opt = document.createElement("option");
          opt.value = s.id; opt.textContent = `${s.name} (${s.apiBase})`;
          if (s.id === res?.current) opt.selected = true;
          nodeSelect.appendChild(opt);
        }
      } catch {}
    })();

    // Button mở terminal
    const terminalBtn = document.createElement("button");
    terminalBtn.textContent = t("activity_open_term");
    terminalBtn.style.cssText = `
      background: #252525;
      border: 1px solid #3a3a3a;
      color: #58a6ff;
      border-radius: 6px;
      padding: 7px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    `;
    terminalBtn.onclick = () => {
      this.onOpenTerminal();
      this.hide();
    };

    // Button mở cấu hình MCP Servers
    const mcpConfigBtn = document.createElement("button");
    mcpConfigBtn.style.cssText = `
      background: #252525;
      border: 1px solid #3a3a3a;
      color: #10a37f;
      border-radius: 6px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    mcpConfigBtn.innerHTML = `<span>${t("activity_mcp_config")}</span>`;
    this.mcpBadge = document.createElement("span");
    this.mcpBadge.textContent = "0";
    this.mcpBadge.style.cssText = "font-size: 10px; padding: 2px 7px; border-radius: 10px; background: rgba(16, 163, 127, 0.2); color: #10a37f; font-weight: 600;";
    mcpConfigBtn.appendChild(this.mcpBadge);
    mcpConfigBtn.onclick = () => this.toggleMcpSection();

    onLanguageChange(() => {
      this.statusText.textContent = `🦦 ${t("activity_title")}`;
      this.updateStatus(this.currentState, this.currentServerName);
      terminalBtn.textContent = t("activity_open_term");
      const spanConfig = mcpConfigBtn.querySelector("span");
      if (spanConfig) spanConfig.textContent = t("activity_mcp_config");
      const spanCont = contRow.querySelector("span");
      if (spanCont) spanCont.textContent = t("activity_continuous");
    });

    controls.appendChild(contRow);
    controls.appendChild(terminalBtn);
    controls.appendChild(mcpConfigBtn);

    // Section Cấu hình MCP Servers (Accordion / Dropdown)
    this.mcpSection = document.createElement("div");
    this.mcpSection.style.cssText = `
      display: none;
      background: #191919;
      border-bottom: 1px solid #2a2a2a;
      padding: 12px 14px;
      font-size: 12px;
      flex-direction: column;
      gap: 10px;
      max-height: 340px;
      overflow-y: auto;
    `;

    // Header của MCP section
    const mcpHeader = document.createElement("div");
    mcpHeader.style.cssText = "display: flex; justify-content: space-between; align-items: center; font-weight: 600; color: #ccc;";
    mcpHeader.innerHTML = `<span>${t("panel_mcp_header")}</span>`;
    const reloadBtn = document.createElement("button");
    reloadBtn.textContent = t("panel_refresh");
    reloadBtn.style.cssText = "background: none; border: none; color: #58a6ff; font-size: 11px; cursor: pointer; padding: 2px 4px;";
    reloadBtn.onclick = () => this.fetchMcpServers(true);
    mcpHeader.appendChild(reloadBtn);
    this.mcpSection.appendChild(mcpHeader);

    // Container danh sách servers
    this.mcpServerListContainer = document.createElement("div");
    this.mcpServerListContainer.style.cssText = "display: flex; flex-direction: column; gap: 6px;";
    this.mcpSection.appendChild(this.mcpServerListContainer);

    // Form thêm server mới
    const addBox = document.createElement("div");
    addBox.style.cssText = `
      background: #141414;
      border: 1px solid #2a2a2a;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    `;
    addBox.innerHTML = `<span style="font-size: 11px; font-weight: 600; color: #aaa;">${t("panel_add_server")}</span>`;

    const nameInput = document.createElement("input");
    nameInput.placeholder = t("panel_server_name_placeholder");
    nameInput.style.cssText = "background: #202020; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px;";

    const urlInput = document.createElement("input");
    urlInput.placeholder = t("panel_server_url_placeholder");
    urlInput.style.cssText = "background: #202020; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px;";

    const tokenInput = document.createElement("input");
    tokenInput.placeholder = t("panel_token_placeholder");
    tokenInput.style.cssText = "background: #202020; border: 1px solid #333; color: #fff; padding: 6px 8px; border-radius: 4px; font-size: 11px;";

    const addBtn = document.createElement("button");
    addBtn.textContent = t("panel_save_connect");
    addBtn.style.cssText = "background: #10a37f; border: none; color: #000; font-weight: 600; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; margin-top: 2px;";

    const msgEl = document.createElement("div");
    msgEl.style.cssText = "font-size: 11px; min-height: 14px;";

    addBtn.onclick = async () => {
      const name = nameInput.value.trim();
      const url = urlInput.value.trim();
      const token = tokenInput.value.trim();
      if (!name || !url) {
        msgEl.style.color = "#f85149";
        msgEl.textContent = t("panel_enter_name_url");
        return;
      }
      addBtn.disabled = true;
      msgEl.style.color = "#58a6ff";
      msgEl.textContent = t("panel_connecting");
      await this.addMcpServer(name, url, token, msgEl);
      addBtn.disabled = false;
      nameInput.value = "";
      urlInput.value = "";
      tokenInput.value = "";
    };

    addBox.appendChild(nameInput);
    addBox.appendChild(urlInput);
    addBox.appendChild(tokenInput);
    addBox.appendChild(addBtn);
    addBox.appendChild(msgEl);
    this.mcpSection.appendChild(addBox);

    // Body: Timeline Events
    this.eventsList = document.createElement("div");
    this.eventsList.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
    this.eventsList.innerHTML = `<p style="color: #666; font-size: 12px; text-align: center; margin-top: 40px;">${t("activity_empty")}</p>`;

    this.panel.appendChild(header);
    this.panel.appendChild(controls);
    this.panel.appendChild(this.mcpSection);
    this.panel.appendChild(this.eventsList);

    document.body.appendChild(this.panel);

    // Lấy dữ liệu MCP ban đầu
    this.fetchMcpServers();
  }

  private toggleMcpSection() {
    this.isMcpSectionOpen = !this.isMcpSectionOpen;
    this.mcpSection.style.display = this.isMcpSectionOpen ? "flex" : "none";
    if (this.isMcpSectionOpen) {
      this.fetchMcpServers();
    }
  }

  private async fetchMcpServers(forceReload = false) {
    try {
      if (forceReload) {
        await fetch(`${this.apiBase}/api/mcp/reload`, { method: "POST" }).catch(() => {});
      }
      const res = await fetch(`${this.apiBase}/api/mcp/servers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const servers: any[] = data.servers || [];

      let totalTools = 0;
      for (const s of servers) {
        totalTools += (s.toolsCount || 0);
      }

      this.mcpBadge.textContent = `${servers.length} (${totalTools} tools)`;
      if (servers.length > 0) {
        this.mcpBadge.style.background = "rgba(16, 163, 127, 0.25)";
        this.mcpBadge.style.color = "#10a37f";
      } else {
        this.mcpBadge.style.background = "#333";
        this.mcpBadge.style.color = "#888";
      }

      if (servers.length === 0) {
        this.mcpServerListContainer.innerHTML = `<span style="color:#777;font-size:11px;">${t("panel_no_servers")}</span>`;
        return;
      }

      this.mcpServerListContainer.innerHTML = "";
      for (const s of servers) {
        const isConnected = s.status === "connected";
        const item = document.createElement("div");
        item.style.cssText = `
          background: #202020;
          border: 1px solid #2d2d2d;
          border-radius: 6px;
          padding: 8px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        `;

        const info = document.createElement("div");
        info.style.cssText = "overflow: hidden; padding-right: 6px;";
        info.innerHTML = `
          <div style="font-weight: 600; color: #fff; display: flex; align-items: center; gap: 6px;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${isConnected ? '#10a37f' : '#f85149'};"></span>
            ${s.name}
            <span style="font-size: 10px; color: ${isConnected ? '#10a37f' : '#f85149'}; font-weight: normal;">
              ${isConnected ? `(${s.toolsCount} tools)` : '(Lỗi kết nối)'}
            </span>
          </div>
          <div style="font-size: 10px; color: #777; margin-top: 2px; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">
            ${s.url}
          </div>
        `;

        const delBtn = document.createElement("button");
        delBtn.textContent = "🗑️";
        delBtn.title = `Xóa máy chủ ${s.name}`;
        delBtn.style.cssText = "background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; padding: 2px 4px;";
        delBtn.onmouseenter = () => { delBtn.style.opacity = "1"; };
        delBtn.onmouseleave = () => { delBtn.style.opacity = "0.6"; };
        delBtn.onclick = async () => {
          if (confirm(t("panel_confirm_delete_server", { name: s.name }))) {
            await this.deleteMcpServer(s.name);
          }
        };

        item.appendChild(info);
        item.appendChild(delBtn);
        this.mcpServerListContainer.appendChild(item);
      }
    } catch (err: any) {
      this.mcpBadge.textContent = t("panel_offline");
      this.mcpBadge.style.color = "#f85149";
      this.mcpServerListContainer.innerHTML = `<span style="color:#f85149;font-size:11px;">${t("panel_daemon_unreachable", { base: this.apiBase })}</span>`;
    }
  }

  private async addMcpServer(name: string, url: string, token: string, msgEl: HTMLElement) {
    try {
      const res = await fetch(`${this.apiBase}/api/mcp/servers/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, token })
      });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        msgEl.style.color = "#10a37f";
        msgEl.textContent = t("panel_added_success", { name });
        await this.fetchMcpServers();
        setTimeout(() => { msgEl.textContent = ""; }, 3000);
      } else {
        throw new Error(data.error || "Thêm server thất bại");
      }
    } catch (err: any) {
      msgEl.style.color = "#f85149";
      msgEl.textContent = t("panel_error_prefix", { message: err.message });
    }
  }

  private async deleteMcpServer(name: string) {
    try {
      await fetch(`${this.apiBase}/api/mcp/servers/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      await this.fetchMcpServers();
    } catch (err: any) {
      console.error("[Otter ActivityPanel] Failed to delete server:", err);
    }
  }

  show() {
    this.isOpen = true;
    this.panel.style.right = "0";
  }

  hide() {
    this.isOpen = false;
    this.panel.style.right = "-380px";
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  updateStatus(state: "connected" | "connecting" | "offline", serverName: string, msg?: string) {
    this.currentState = state;
    this.currentServerName = serverName;
    this.serverLabel.textContent = serverName;
    if (state === "connected") {
      this.statusDot.style.background = "#10a37f";
      this.statusText.textContent = t("activity_connected");
    } else if (state === "connecting") {
      this.statusDot.style.background = "#e3b341";
      this.statusText.textContent = t("activity_connecting");
    } else {
      this.statusDot.style.background = "#f85149";
      this.statusText.textContent = t("activity_offline");
    }
  }

  setEvents(items: ActivityItem[]) {
    if (!items || items.length === 0) {
      this.eventsList.innerHTML = `<p style="color: #666; font-size: 12px; text-align: center; margin-top: 40px;">${t("activity_empty")}</p>`;
      return;
    }

    this.eventsList.innerHTML = "";
    for (const item of items) {
      const card = document.createElement("div");
      card.style.cssText = `
        background: #202020;
        border: 1px solid #2d2d2d;
        border-radius: 8px;
        padding: 10px;
        font-size: 12px;
      `;
      card.innerHTML = `
        <div style="font-weight: 600; color: #10a37f; margin-bottom: 4px;">${item.title || item.type}</div>
        <div style="color: #aaa; word-break: break-all;">${item.description || JSON.stringify(item.payload || "")}</div>
      `;
      this.eventsList.appendChild(card);
    }
  }

  private async toggleContinuous(enabled: boolean) {
    try {
      await chrome.runtime.sendMessage({
        type: "continuous-set",
        conversationId: this.conversationId,
        enabled
      });
    } catch (err) {
      console.error("[Otter ActivityPanel] Failed to toggle continuous:", err);
    }
  }
}
