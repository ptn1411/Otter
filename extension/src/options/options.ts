import { getServers, updateServer, addServer, exportServers, importServers } from "../background/server-registry";
import { t, setLanguage, initI18n } from "../i18n";
import { applyDataI18n } from "../i18n/apply";

console.log("[Otter Options] Initializing Settings UI...");

let currentLang: "vi" | "en" = "vi";

// Helper trigger notification
function showDesktopNotification(title: string, message: string) {
  try {
    if (chrome.notifications?.create) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message,
        priority: 2
      });
    } else {
      chrome.runtime?.sendMessage({
        type: "show-notification",
        title,
        message
      });
    }
  } catch (err) {
    console.warn("[Otter Notification] Failed:", err);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // Common DOM Elements
  const serverSelect = document.getElementById("server") as HTMLSelectElement;
  const tokenInput = document.getElementById("server-token") as HTMLInputElement;
  const serverForm = document.getElementById("server-form") as HTMLFormElement;
  const statusEl = document.getElementById("status") as HTMLElement;

  // 1. Tab switching
  const tabBtns = document.querySelectorAll<HTMLButtonElement>(".tab-btn");
  const tabPanes = document.querySelectorAll<HTMLElement>(".tab-pane");

  let onTabActivated: ((tabId: string) => void) | null = null;

  function switchTab(targetId: string) {
    tabBtns.forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === targetId);
    });
    tabPanes.forEach(pane => {
      pane.classList.toggle("active", pane.id === targetId);
    });
    chrome.storage?.local?.set({ last_active_tab: targetId });
    if (onTabActivated) onTabActivated(targetId);
  }

  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      if (targetId) switchTab(targetId);
    });
  });

  const storedTab = await chrome.storage?.local?.get("last_active_tab");
  if (storedTab?.last_active_tab && document.getElementById(storedTab.last_active_tab)) {
    switchTab(storedTab.last_active_tab);
  }

  // 2. Language Switcher & Applier
  function applyLanguage(lang: "vi" | "en", reloadData = false) {
    currentLang = lang;
    setLanguage(lang);
    applyDataI18n();

    if (tokenInput) tokenInput.placeholder = t("token_placeholder");

    const pluginInput = document.getElementById("plugin-name") as HTMLInputElement;
    if (pluginInput) pluginInput.placeholder = t("plugin_placeholder");

    const slashInput = document.getElementById("opt-cmd-slash") as HTMLInputElement;
    if (slashInput) slashInput.placeholder = t("cmd_placeholder_slash");

    const titleInput = document.getElementById("opt-cmd-title") as HTMLInputElement;
    if (titleInput) titleInput.placeholder = t("cmd_placeholder_title");

    const promptInput = document.getElementById("opt-cmd-prompt") as HTMLTextAreaElement;
    if (promptInput) promptInput.placeholder = t("cmd_placeholder_prompt");

    document.documentElement.lang = lang;

    if (reloadData && serverSelect?.value) {
      const tokenVal = tokenInput?.value?.trim() || undefined;
      loadCustomCommands(serverSelect.value, tokenVal);
      loadExternalMcpServers(serverSelect.value, tokenVal);
      loadLicenseStatus(serverSelect.value, tokenVal);
      checkDaemonLiveStatus();
    }
  }

  const btnVi = document.getElementById("btn-lang-vi");
  const btnEn = document.getElementById("btn-lang-en");
  btnVi?.addEventListener("click", () => applyLanguage("vi", true));
  btnEn?.addEventListener("click", () => applyLanguage("en", true));

  const initialLang = await initI18n();
  applyLanguage(initialLang, false);

  // 3. Copy button functionality
  document.querySelectorAll<HTMLButtonElement>(".btn-copy").forEach(btn => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-target");
      let textToCopy = "";
      if (targetId) {
        const targetEl = document.getElementById(targetId);
        textToCopy = targetEl?.textContent?.trim() || "";
      }
      if (textToCopy) {
        await navigator.clipboard.writeText(textToCopy);
        const originalText = btn.textContent;
        btn.textContent = t("btn_copied");
        btn.style.color = "#10b981";
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.color = "";
        }, 2000);
      }
    });
  });

  // 4. Server selection and token inputs

  async function refreshServerList() {
    if (!serverSelect) return;
    const servers = await getServers();
    serverSelect.innerHTML = "";
    for (const s of servers) {
      const opt = document.createElement("option");
      opt.value = s.apiBase;
      opt.dataset.id = s.id;
      opt.textContent = `${s.name} (${s.apiBase})`;
      serverSelect.appendChild(opt);
    }

    if (servers.length > 0) {
      const current = servers[0];
      if (tokenInput) tokenInput.value = current.apiKey || "";
    }
  }

  // 5. Live Daemon Check on Guide Tab
  const daemonLiveDot = document.getElementById("daemon-live-dot");
  const daemonStatusText = document.getElementById("daemon-status-text");
  const tunnelInfoBox = document.getElementById("tunnel-info-box");
  const btnCheckDaemon = document.getElementById("btn-check-daemon");

  async function checkDaemonLiveStatus() {
    if (!daemonStatusText) return;
    daemonStatusText.textContent = t("checking_daemon");
    try {
      const res = await fetch("http://127.0.0.1:1993/api/system/tunnel", { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        daemonLiveDot?.classList.remove("inactive");
        daemonLiveDot?.classList.add("active");
        daemonStatusText.textContent = t("daemon_online");
        daemonStatusText.style.color = "#10b981";

        if (data && data.url && tunnelInfoBox) {
          tunnelInfoBox.style.display = "block";
          tunnelInfoBox.innerHTML = `🌐 <b>Quick Tunnel URL:</b> <code>${data.url}</code> (${t("tunnel_ready")})`;
        }
        return true;
      }
    } catch {}

    daemonLiveDot?.classList.remove("active");
    daemonLiveDot?.classList.add("inactive");
    daemonStatusText.textContent = t("daemon_offline");
    daemonStatusText.style.color = "#ef4444";
    if (tunnelInfoBox) tunnelInfoBox.style.display = "none";
    return false;
  }

  btnCheckDaemon?.addEventListener("click", () => checkDaemonLiveStatus());
  checkDaemonLiveStatus();

  // 6. License Status Management
  const licTierBadge = document.getElementById("lic-tier-badge");
  const licStatusVal = document.getElementById("lic-status-val");
  const licExpiresVal = document.getElementById("lic-expires-val");
  const licCustomerVal = document.getElementById("lic-customer-val");
  const licSupportVal = document.getElementById("lic-support-val");
  const btnRefreshLic = document.getElementById("btn-refresh-license");
  const btnCopySupport = document.getElementById("btn-copy-support");

  async function loadLicenseStatus(apiBase: string, apiKey?: string) {
    if (!licStatusVal) return;
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

      const res = await fetch(`${apiBase}/api/system/license`, { headers, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Support Code
      if (licSupportVal && data.supportCode) {
        licSupportVal.textContent = data.supportCode;
      }

      if (data.licensed) {
        licStatusVal.textContent = t("lic_active") || "🟢 Đang hoạt động (Hợp lệ)";
        licStatusVal.style.color = "#10b981";

        const p = data.payload || {};
        const tier = (p.tier || p.package || "pro").toUpperCase();

        if (licTierBadge) {
          licTierBadge.textContent = tier;
          licTierBadge.className = "badge-plan";
          if (tier.includes("TRIAL")) licTierBadge.classList.add("badge-trial");
          else if (tier.includes("ENTERPRISE") || tier.includes("VIP")) licTierBadge.classList.add("badge-enterprise");
          else licTierBadge.classList.add("badge-pro");
        }

        if (licExpiresVal) {
          licExpiresVal.textContent = p.expires_at || t("lic_lifetime") || "Vĩnh viễn (Lifetime)";
        }
        if (licCustomerVal) {
          licCustomerVal.textContent = p.customer || p.email || t("lic_customer_default");
        }
      } else {
        licStatusVal.textContent = data.reason || t("lic_unlicensed") || "🟡 Chưa kích hoạt bản quyền";
        licStatusVal.style.color = "#f59e0b";

        if (licTierBadge) {
          licTierBadge.textContent = "FREE";
          licTierBadge.className = "badge-plan badge-free";
        }
        if (licExpiresVal) licExpiresVal.textContent = "—";
        if (licCustomerVal) licCustomerVal.textContent = t("lic_not_linked");
      }
    } catch (err: any) {
      if (licStatusVal) {
        licStatusVal.textContent = t("lic_daemon_unreachable", { message: err.message });
        licStatusVal.style.color = "#ef4444";
      }
    }
  }

  btnRefreshLic?.addEventListener("click", () => {
    const url = serverSelect?.value || "http://127.0.0.1:1993";
    const token = tokenInput?.value?.trim() || undefined;
    loadLicenseStatus(url, token);
  });

  btnCopySupport?.addEventListener("click", async () => {
    const code = licSupportVal?.textContent?.trim();
    if (code && code !== "—") {
      await navigator.clipboard.writeText(code);
      btnCopySupport.textContent = t("btn_copied_short");
      btnCopySupport.style.color = "#10b981";
      setTimeout(() => {
        btnCopySupport.textContent = t("btn_copy");
        btnCopySupport.style.color = "";
      }, 2000);
    }
  });

  // 7. License Activation Form
  const licForm = document.getElementById("license-activate-form") as HTMLFormElement;
  const licInputEmail = document.getElementById("lic-input-email") as HTMLInputElement;
  const licInputKey = document.getElementById("lic-input-key") as HTMLInputElement;
  const licStatusMsg = document.getElementById("lic-activate-status");
  const btnSubmitActivate = document.getElementById("btn-submit-activate") as HTMLButtonElement;

  licForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = serverSelect?.value || "http://127.0.0.1:1993";
    const token = tokenInput?.value?.trim() || undefined;
    const email = licInputEmail?.value?.trim();
    const key = licInputKey?.value?.trim();

    if (!key) return;

    if (btnSubmitActivate) {
      btnSubmitActivate.disabled = true;
      btnSubmitActivate.textContent = t("activating");
    }
    if (licStatusMsg) {
      licStatusMsg.textContent = t("activating_request");
      licStatusMsg.style.color = "#38bdf8";
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${url}/api/system/license/activate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key, email })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (licStatusMsg) {
          licStatusMsg.textContent = `🎉 ${data.message || t("lic_activate_success")}`;
          licStatusMsg.style.color = "#10b981";
        }
        licInputKey.value = "";
        loadLicenseStatus(url, token);
        showDesktopNotification("Otter Assistant", `Kích hoạt bản quyền thành công! Cảm ơn bạn đã sử dụng Otter.`);
      } else {
        throw new Error(data.error || "Kích hoạt thất bại. Vui lòng kiểm tra lại mã key.");
      }
    } catch (err: any) {
      if (licStatusMsg) {
        licStatusMsg.textContent = `❌ ${err.message}`;
        licStatusMsg.style.color = "#ef4444";
      }
    } finally {
      if (btnSubmitActivate) {
        btnSubmitActivate.disabled = false;
        btnSubmitActivate.textContent = t("btn_activate_key");
      }
    }
  });

  // 8. Desktop Notifications Tester
  const btnTestNoti = document.getElementById("btn-test-notification");
  const notiStatusMsg = document.getElementById("noti-status-msg");

  btnTestNoti?.addEventListener("click", () => {
    showDesktopNotification(
      "Otter Assistant 🦦",
      "Hệ thống thông báo máy tính đã hoạt động hoàn hảo! Bạn sẽ nhận được thông báo khi AI hoàn tất tác vụ."
    );
    if (notiStatusMsg) {
      notiStatusMsg.style.display = "block";
      notiStatusMsg.textContent = t("noti_enabled");
      setTimeout(() => {
        notiStatusMsg.style.display = "none";
      }, 4000);
    }
  });

  // 9. Load External MCP Servers
  async function loadExternalMcpServers(apiBase: string, apiKey?: string) {
    const listEl = document.getElementById("mcp-server-list");
    if (!listEl) return;

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`${apiBase}/api/mcp/servers`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const servers: any[] = data.servers || [];

      if (servers.length === 0) {
        listEl.innerHTML = `<span style="color:var(--text-soft)">${t("mcp_none")}</span>`;
        return;
      }

      listEl.innerHTML = servers.map(s => {
        const isOk = s.status === "connected";
        const icon = isOk ? "🟢" : "🔴";
        const color = isOk ? "#10a37f" : "#f85149";
        return `
          <div style="padding:10px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>${icon} ${s.name}</strong>
              <span style="color:${color};font-weight:600">${s.status.toUpperCase()} (${s.toolsCount} tools)</span>
            </div>
            <div style="color:var(--text-soft);font-size:12px;margin-top:4px">
              URL: <code>${s.url}</code>
            </div>
            ${s.error ? `<div style="color:#f85149;font-size:12px;margin-top:4px">${s.error}</div>` : ""}
          </div>
        `;
      }).join("");
    } catch (err: any) {
      listEl.innerHTML = `<span style="color:var(--danger)">${t("load_mcp_failed", { message: err.message })}</span>`;
    }
  }

  // 10. Load Custom Commands
  async function loadCustomCommands(apiBase: string, apiKey?: string) {
    const listEl = document.getElementById("custom-commands-list");
    if (!listEl) return;

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const res = await fetch(`${apiBase}/api/commands`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const commands: any[] = data.items || [];

      if (commands.length === 0) {
        listEl.innerHTML = `<span style="color:var(--text-soft)">${t("cmd_empty")}</span>`;
        return;
      }

      listEl.innerHTML = commands.map(cmd => {
        const isPinned = Boolean(cmd.isPinned);
        return `
          <div style="padding:10px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
            <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
              <span style="font-size:18px;">${cmd.icon || "⚡"}</span>
              <div style="min-width:0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <code style="color:#34d399;font-weight:700;">${cmd.slash}</code>
                  <strong style="color:#fff;">${cmd.title}</strong>
                  ${isPinned ? `<span style="font-size:11px;color:#eab308;">${t("cmd_pinned_badge")}</span>` : ""}
                </div>
                <div style="color:var(--text-soft);font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${cmd.description || cmd.promptTemplate}
                </div>
              </div>
            </div>
            <div style="display:flex;gap:6px;">
              <button class="opt-pin-cmd-btn" data-id="${cmd.id}" data-pinned="${isPinned}" style="background:transparent;border:1px solid var(--border);color:${isPinned ? '#eab308' : '#a1a1aa'};padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;">
                ${isPinned ? (t("cmd_unpin_btn")) : (t("cmd_pin_btn"))}
              </button>
              <button class="opt-del-cmd-btn" data-id="${cmd.id}" style="background:transparent;border:1px solid var(--border);color:#ef4444;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;">
                ${t("cmd_del_btn")}
              </button>
            </div>
          </div>
        `;
      }).join("");

      listEl.querySelectorAll<HTMLButtonElement>(".opt-pin-cmd-btn").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id")!;
          const currentPinned = btn.getAttribute("data-pinned") === "true";
          await fetch(`${apiBase}/api/commands/${id}/pin`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify({ pinned: !currentPinned })
          }).catch(() => {});
          loadCustomCommands(apiBase, apiKey);
        };
      });

      listEl.querySelectorAll<HTMLButtonElement>(".opt-del-cmd-btn").forEach(btn => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id")!;
          if (confirm(t("cmd_confirm_delete"))) {
            await fetch(`${apiBase}/api/commands/${id}`, { method: "DELETE", headers }).catch(() => {});
            loadCustomCommands(apiBase, apiKey);
          }
        };
      });
    } catch (err: any) {
      listEl.innerHTML = `<span style="color:var(--danger)">${t("load_cmd_failed", { message: err.message })}</span>`;
    }
  }

  // 11. Initial data load
  await refreshServerList();
  if (serverSelect?.value) {
    const servers = await getServers();
    const current = servers.find(s => s.apiBase === serverSelect.value);
    loadExternalMcpServers(serverSelect.value, current?.apiKey);
    loadCustomCommands(serverSelect.value, current?.apiKey);
    loadLicenseStatus(serverSelect.value, current?.apiKey);
  }

  serverSelect?.addEventListener("change", async () => {
    const servers = await getServers();
    const current = servers.find(s => s.apiBase === serverSelect.value);
    if (tokenInput) tokenInput.value = current?.apiKey || "";
    if (serverSelect.value) {
      loadExternalMcpServers(serverSelect.value, current?.apiKey);
      loadCustomCommands(serverSelect.value, current?.apiKey);
      loadLicenseStatus(serverSelect.value, current?.apiKey);
    }
  });

  // 12. Save server connection form
  if (serverForm) {
    serverForm.onsubmit = async (e) => {
      e.preventDefault();
      const selectedUrl = serverSelect.value;
      const tokenVal = tokenInput?.value?.trim() || undefined;
      const servers = await getServers();
      const current = servers.find(s => s.apiBase === selectedUrl);

      if (current) {
        await updateServer(current.id, { apiKey: tokenVal });
      }

      if (statusEl) {
        statusEl.textContent = `Đang kiểm tra kết nối tới ${selectedUrl}...`;
        statusEl.style.color = "#388bfd";
      }

      try {
        const headers: Record<string, string> = {};
        if (tokenVal) headers["Authorization"] = `Bearer ${tokenVal}`;
        const res = await fetch(`${selectedUrl}/api/activity/v1/pending-bind`, { headers });
        if (res.ok) {
          if (statusEl) {
            statusEl.textContent = t("connect_auth_success");
            statusEl.style.color = "#10a37f";
          }
          loadExternalMcpServers(selectedUrl, tokenVal);
          loadCustomCommands(selectedUrl, tokenVal);
          loadLicenseStatus(selectedUrl, tokenVal);
          checkDaemonLiveStatus();
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err: any) {
        if (statusEl) {
          statusEl.textContent = t("connect_failed", { message: err.message });
          statusEl.style.color = "#f85149";
        }
      }
    };
  }

  // 13. Add command form
  const addCmdForm = document.getElementById("opt-add-cmd-form") as HTMLFormElement;
  if (addCmdForm) {
    addCmdForm.onsubmit = async (e) => {
      e.preventDefault();
      const currentUrl = serverSelect.value;
      const tokenVal = tokenInput?.value?.trim() || undefined;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (tokenVal) headers["Authorization"] = `Bearer ${tokenVal}`;

      const icon = (document.getElementById("opt-cmd-icon") as HTMLInputElement).value.trim() || "⚡";
      const slash = (document.getElementById("opt-cmd-slash") as HTMLInputElement).value.trim();
      const title = (document.getElementById("opt-cmd-title") as HTMLInputElement).value.trim();
      const promptTemplate = (document.getElementById("opt-cmd-prompt") as HTMLTextAreaElement).value.trim();

      if (!slash || !title || !promptTemplate) {
        alert(t("cmd_missing_fields"));
        return;
      }

      try {
        const res = await fetch(`${currentUrl}/api/commands`, {
          method: "POST",
          headers,
          body: JSON.stringify({ icon, slash, title, promptTemplate, isPinned: true })
        });
        const data = await res.json();
        if (data.ok) {
          (document.getElementById("opt-cmd-slash") as HTMLInputElement).value = "";
          (document.getElementById("opt-cmd-title") as HTMLInputElement).value = "";
          (document.getElementById("opt-cmd-prompt") as HTMLTextAreaElement).value = "";
          loadCustomCommands(currentUrl, tokenVal);
        } else {
          alert(t("error_prefix", { message: data.error }));
        }
      } catch (err: any) {
        alert(t("error_connect", { message: err.message }));
      }
    };
  }

  // 14. Management Center tab (plans, queue, outbox, skills, servers)
  // Uses the same selected server + token as the Settings tab, and the
  // daemon's /api/plans endpoints added with the plan dashboard.
  const managePlansEl = document.getElementById("manage-plans-list");
  const manageSkillsEl = document.getElementById("manage-skills-list");
  const manageQueueEl = document.getElementById("manage-queue");
  const manageDaemonEl = document.getElementById("manage-daemon");
  const manageStatusEl = document.getElementById("manage-status");
  const manageRefreshMsEl = document.getElementById("manage-refresh-ms") as HTMLSelectElement | null;
  const manageNotifyEl = document.getElementById("manage-notify") as HTMLInputElement | null;
  let manageTimer: any = null;
  let managePrevBlocked = new Set<string>();
  let managePrevDone = new Set<string>();
  let manageSkillsCache: any[] = [];

  function manageApi(): { apiBase: string; token?: string } {
    const apiBase = serverSelect?.value || "http://127.0.0.1:1993";
    const token = tokenInput?.value?.trim() || undefined;
    return { apiBase, token };
  }

  async function manageFetch(path: string, method = "GET", body?: any): Promise<any> {
    const { apiBase, token } = manageApi();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const opts: any = { headers, method, signal: AbortSignal.timeout(8000) };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${apiBase}${path}`, opts);
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
      } catch {}
      throw new Error(errMsg);
    }
    return res.json();
  }

  function manageEscape(s: any): string {
    return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]);
  }

  // Static MCP tool-group declaration for the Management tab. These groups
  // are registered by the daemon (src/daemon/mcp.ts) and described for the
  // agent in the otter_agent_workflow MCP prompt; the extension only lists
  // them, it does not re-implement or gate them.
  function renderManageTools(): void {
    const el = document.getElementById("manage-tools-list");
    if (!el) return;
    const groups = [
      { name: t("manage_tool_plans_name"), count: 13, tools: "plan_*", desc: t("manage_tool_plans_desc") },
      { name: t("manage_tool_code_name"), count: 5, tools: "code_*", desc: t("manage_tool_code_desc") },
      { name: t("manage_tool_loop_name"), count: 10, tools: "loop_*", desc: t("manage_tool_loop_desc") },
      { name: t("manage_tool_fb_reply_name"), count: 15, tools: "fb_reply_*, fb_read_comments", desc: t("manage_tool_fb_reply_desc") },
      { name: t("manage_tool_fb_post_name"), count: 11, tools: "fb_post_*", desc: t("manage_tool_fb_post_desc") },
      { name: t("manage_tool_db_name"), count: 10, tools: "db_*", desc: t("manage_tool_db_desc") },
      { name: t("manage_tool_ide_name"), count: 13, tools: "ide_*, giano_*", desc: t("manage_tool_ide_desc") },
    ];
    const desc = t("manage_tools_desc");
    el.innerHTML = `<div style="color:var(--text-soft);font-size:12px">${manageEscape(desc)}</div>` + groups.map((g) => `<div style="padding:8px 10px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px"><strong>${manageEscape(g.name)}</strong> <span style="color:var(--text-soft)">· ${g.count} tools · ${manageEscape(g.tools)}</span><div style="color:var(--text-soft);font-size:12px">${manageEscape(g.desc)}</div></div>`).join("");
  }

  async function loadPlansManage(): Promise<void> {
    if (!managePlansEl) return;
    try {
      const data = await manageFetch("/api/plans");
      const plans: any[] = data.plans || [];
      if (manageQueueEl) manageQueueEl.textContent = `pending=${data.queue?.queued ?? "—"}, running=${data.queue?.running ?? "—"}`;
      if (manageDaemonEl) { manageDaemonEl.textContent = "🟢 online"; manageDaemonEl.style.color = "#10b981"; }
      if (manageStatusEl) manageStatusEl.textContent = "";
      if (plans.length === 0) {
        managePlansEl.innerHTML = `<span style="color:var(--text-soft)">${t("manage_empty_plans")}</span>`;
        return;
      }
      // Notifications for newly blocked / newly done plans.
      const blockedIds = new Set(plans.filter((p) => (p.taskCounts?.blocked || 0) > 0).map((p) => p.id));
      const doneIds = new Set(plans.filter((p) => p.status === "done").map((p) => p.id));
      if (manageNotifyEl?.checked) {
        for (const id of blockedIds) {
          if (!managePrevBlocked.has(id)) showDesktopNotification("Otter — Plan bị blocked", `Plan ${id} có task bị blocked, cần can thiệp.`);
        }
        for (const id of doneIds) {
          if (!managePrevDone.has(id)) showDesktopNotification("Otter — Plan đã xong", `Plan ${id} đã hoàn thành.`);
        }
      }
      managePrevBlocked = blockedIds;
      managePrevDone = doneIds;

      managePlansEl.innerHTML = plans.map((p) => {
        const total = p.taskTotal || 0;
        const done = (p.taskCounts?.success || 0) + (p.taskCounts?.skipped || 0);
        const pct = total ? Math.round((done / total) * 100) : 0;
        return `<div style="padding:10px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <strong>${manageEscape(p.goal)}</strong><span style="color:var(--text-soft)">${manageEscape(p.status)} · ${manageEscape(p.id)}</span>
          </div>
          <div style="height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;margin:8px 0">
            <div style="height:100%;width:${pct}%;background:#10b981"></div>
          </div>
          <div style="color:var(--text-soft);font-size:12px">${done}/${total} task xong (${pct}%) · ✅ ${p.taskCounts?.success || 0} · ❌ ${p.taskCounts?.failed || 0} · ⚠️ ${p.taskCounts?.blocked || 0} · ⏳ ${p.taskCounts?.pending || 0}</div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <button type="button" class="manage-plan-action" data-action="resume" data-id="${manageEscape(p.id)}" style="padding:4px 10px;font-size:12px">▶️ Chạy tiếp</button>
            <button type="button" class="manage-plan-action" data-action="pause" data-id="${manageEscape(p.id)}" style="padding:4px 10px;font-size:12px">⏸️ Tạm dừng</button>
            <button type="button" class="manage-plan-action" data-action="cancel" data-id="${manageEscape(p.id)}" style="padding:4px 10px;font-size:12px;color:#ef4444">🛑 Hủy</button>
            <button type="button" class="manage-plan-detail" data-id="${manageEscape(p.id)}" style="padding:4px 10px;font-size:12px">🔍 Chi tiết + Outbox</button>
            <button type="button" class="manage-plan-resume-prompt" data-id="${manageEscape(p.id)}" style="padding:4px 10px;font-size:12px">📋 Copy resume prompt</button>
          </div>
          <div class="manage-plan-detail-box" data-id="${manageEscape(p.id)}" style="display:none;margin-top:8px;font-size:12px"></div>
        </div>`;
      }).join("");

      managePlansEl.querySelectorAll<HTMLButtonElement>(".manage-plan-action").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id")!;
          const action = btn.getAttribute("data-action")!;
          if (action === "cancel" && !confirm(t("manage_confirm_cancel"))) return;
          try {
            await manageFetch(`/api/plans/${encodeURIComponent(id)}/${action}`, "POST");
            await loadPlansManage();
          } catch (err: any) {
            if (manageStatusEl) manageStatusEl.textContent = `❌ ${err.message}`;
          }
        };
      });
      managePlansEl.querySelectorAll<HTMLButtonElement>(".manage-plan-detail").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id")!;
          const box = managePlansEl.querySelector<HTMLElement>(`.manage-plan-detail-box[data-id="${id}"]`);
          if (!box) return;
          if (box.style.display === "block") { box.style.display = "none"; return; }
          box.style.display = "block";
          box.textContent = t("manage_loading");
          try {
            const d = await manageFetch(`/api/plans/${encodeURIComponent(id)}`);
            const rows = (d.tasks || []).map((t: any) => `<div>• ${manageEscape(t.goal)} — ${manageEscape(t.status)} (${t.attemptCount}/${t.maxAttempts})</div>`).join("");
            const outbox = (d.outbox || []).length === 0
              ? `<div style='color:var(--text-soft)'>${t("manage_no_outbox")}</div>`
              : (d.outbox || []).map((o: any) => `<div style="background:rgba(255,255,255,0.04);padding:6px;border-radius:6px;margin-top:4px">${manageEscape(o.textPreview)} ${t("manage_outbox_attempts", { count: o.attemptCount })}</div>`).join("");
            box.innerHTML = `<div>${t("manage_current_task")} <b>${manageEscape(d.currentTask?.goal || "—")}</b> · ${t("manage_next_task")} <b>${manageEscape(d.nextTask?.goal || "—")}</b></div>${rows}<div style="margin-top:6px"><b>Outbox:</b></div>${outbox}`;
          } catch (err: any) {
            box.textContent = `❌ ${err.message}`;
          }
        };
      });
      managePlansEl.querySelectorAll<HTMLButtonElement>(".manage-plan-resume-prompt").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.getAttribute("data-id")!;
          try {
            const r = await manageFetch(`/api/plans/${encodeURIComponent(id)}/resume-prompt`);
            await navigator.clipboard.writeText(r.prompt || "");
            if (manageStatusEl) manageStatusEl.textContent = t("manage_resume_copied");
          } catch (err: any) {
            if (manageStatusEl) manageStatusEl.textContent = `❌ ${err.message}`;
          }
        };
      });
    } catch (err: any) {
      if (managePlansEl) managePlansEl.innerHTML = `<span style="color:#ef4444">${t("manage_no_daemon")} (${manageEscape(err.message)})</span>`;
      if (manageDaemonEl) { manageDaemonEl.textContent = "🔴 offline"; manageDaemonEl.style.color = "#ef4444"; }
    }
  }

  async function loadSkillsManage(): Promise<void> {
    if (!manageSkillsEl) return;
    try {
      const data = await manageFetch("/api/skills");
      manageSkillsCache = data.skills || [];
      renderSkillsManage();
    } catch (err: any) {
      manageSkillsEl.innerHTML = `<span style="color:#ef4444">${t("manage_no_daemon")} (${manageEscape(err.message)})</span>`;
    }
  }

  function renderSkillsManage(): void {
    if (!manageSkillsEl) return;
    const q = ((document.getElementById("manage-skills-search") as HTMLInputElement | null)?.value || "").toLowerCase();
    const list = manageSkillsCache.filter((s) => !q || s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q));
    if (list.length === 0) {
      manageSkillsEl.innerHTML = `<span style="color:var(--text-soft)">${t("manage_empty_skills")}</span>`;
      return;
    }
    manageSkillsEl.innerHTML = list.map((s) => `<div style="padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px">
      <strong>${manageEscape(s.name)}</strong>
      <div style="color:var(--text-soft);font-size:12px">${manageEscape((s.description || "").slice(0, 200))}</div>
    </div>`).join("");
  }

  function restartManageTimer(): void {
    if (manageTimer) clearInterval(manageTimer);
    const ms = Number(manageRefreshMsEl?.value || "5000");
    if (ms > 0) {
      manageTimer = setInterval(() => {
        const pane = document.getElementById("tab-manage");
        if (pane?.classList.contains("active")) void loadPlansManage();
      }, ms);
    }
  }

  async function loadManageSettings(): Promise<void> {
    try {
      const stored = await chrome.storage?.local?.get(["otter_manage_refresh_ms", "otter_manage_notify"]);
      if (manageRefreshMsEl && stored?.otter_manage_refresh_ms !== undefined) manageRefreshMsEl.value = String(stored.otter_manage_refresh_ms);
      if (manageNotifyEl && stored?.otter_manage_notify !== undefined) manageNotifyEl.checked = Boolean(stored.otter_manage_notify);
    } catch {}
    restartManageTimer();
  }

  manageRefreshMsEl?.addEventListener("change", async () => {
    try { await chrome.storage?.local?.set({ otter_manage_refresh_ms: Number(manageRefreshMsEl.value) }); } catch {}
    restartManageTimer();
  });
  manageNotifyEl?.addEventListener("change", async () => {
    try { await chrome.storage?.local?.set({ otter_manage_notify: manageNotifyEl.checked }); } catch {}
  });
  async function loadPageLoopsManage(): Promise<void> {
    const el = document.getElementById("manage-page-loops-list");
    if (!el) return;
    try {
      const data = await manageFetch("/api/page-loops");
      const loops: any[] = data.loops || [];
      if (loops.length === 0) { el.innerHTML = `<span style="color:var(--text-soft)">${t("manage_no_page_loops")}</span>`; return; }
      el.innerHTML = loops.slice(0, 10).map((l) => `<div style="padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px"><strong>${manageEscape(l.id)}</strong> · ${manageEscape(l.status)} · ${manageEscape(l.mode)} · ${t("manage_page_loop_turns", { turn: l.turnCount, max: l.maxTurns, epoch: l.epoch })}<div style="color:var(--text-soft);font-size:12px">${manageEscape(l.goal.slice(0, 120))}${l.blockedReason ? ` · ${t("manage_blocked_reason", { reason: manageEscape(l.blockedReason) })}` : ""}</div><div style="margin-top:6px"><button type="button" class="manage-page-loop-stop" data-id="${manageEscape(l.id)}" style="padding:4px 10px;font-size:12px;color:#ef4444">${t("manage_stop_btn")}</button> <button type="button" class="manage-page-loop-resume" data-id="${manageEscape(l.id)}" style="padding:4px 10px;font-size:12px">${t("manage_resume_btn")}</button></div></div>`).join("");
      el.querySelectorAll<HTMLButtonElement>(".manage-page-loop-stop").forEach((btn) => btn.addEventListener("click", async () => {
        const statusEl = document.getElementById("manage-page-loop-status");
        try { const { apiBase, token } = manageApi(); const headers: Record<string, string> = { "Content-Type": "application/json" }; if (token) headers["Authorization"] = `Bearer ${token}`; await fetch(`${apiBase}/api/page-loops/${btn.dataset.id}/stop`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(8000) }); if (statusEl) { statusEl.textContent = t("manage_page_stopped"); statusEl.style.color = "#10b981"; } void loadPageLoopsManage(); }
        catch (err: any) { if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; } }
      }));
      el.querySelectorAll<HTMLButtonElement>(".manage-page-loop-resume").forEach((btn) => btn.addEventListener("click", async () => {
        const statusEl = document.getElementById("manage-page-loop-status");
        try { const { apiBase, token } = manageApi(); const headers: Record<string, string> = { "Content-Type": "application/json" }; if (token) headers["Authorization"] = `Bearer ${token}`; const r = await fetch(`${apiBase}/api/page-loops/${btn.dataset.id}/resume`, { method: "POST", headers, body: "{}", signal: AbortSignal.timeout(8000) }); const data = await r.json().catch(() => ({})); if (statusEl) { statusEl.textContent = data.prompt ? t("manage_resume_prompt", { prompt: data.prompt.slice(0, 200) }) : t("manage_resumed"); statusEl.style.color = "#10b981"; } void loadPageLoopsManage(); }
        catch (err: any) { if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; } }
      }));
    } catch (err: any) { el.innerHTML = `<span style="color:#ef4444">${t("manage_page_loop_failed", { message: manageEscape(err.message) })}</span>`; }
  }
  document.getElementById("manage-page-loop-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("manage-page-loop-status");
    const goal = (document.getElementById("manage-page-loop-goal") as HTMLInputElement).value.trim();
    const planId = (document.getElementById("manage-page-loop-plan") as HTMLInputElement).value.trim() || undefined;
    const mode = (document.getElementById("manage-page-loop-mode") as HTMLSelectElement).value as "auto" | "zero_risk";
    if (!goal) { if (statusEl) { statusEl.textContent = t("manage_enter_goal"); statusEl.style.color = "#ef4444"; } return; }
    try {
      const { apiBase, token } = manageApi();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch(`${apiBase}/api/page-loops`, { method: "POST", headers, body: JSON.stringify({ goal, planId, mode }), signal: AbortSignal.timeout(8000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (statusEl) { statusEl.textContent = data.preparedPrompt ? t("manage_zero_risk_copy", { prompt: data.preparedPrompt.slice(0, 300) }) : t("manage_page_started", { id: data.loop?.id }); statusEl.style.color = "#10b981"; }
      void loadPageLoopsManage();
    } catch (err: any) { if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; } }
  });
  document.getElementById("manage-doctor-btn")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("manage-doctor-status");
    try {
      const data = await manageFetch("/api/doctor");
      if (statusEl) { statusEl.textContent = `🩺 Doctor ${data.ok ? "OK" : t("manage_doctor_fail")}: ${(data.checks || []).map((c: any) => `${c.name}:${c.ok ? "✓" : "✗"}`).join(" ")}`; statusEl.style.color = data.ok ? "#10b981" : "#ef4444"; }
    } catch (err: any) { if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; } }
  });
  document.getElementById("manage-refresh")?.addEventListener("click", () => { void loadPlansManage(); void loadSkillsManage(); void loadFleetManage(); void loadChromeProfilesManage(); void loadPageLoopsManage(); });

  // Chrome theo profile (Phase: mở Chrome từ Management): liệt kê
  // profile từ daemon đang chọn, mỗi profile một nút Mở.
  async function loadChromeProfilesManage(): Promise<void> {
    const el = document.getElementById("manage-chrome-list");
    if (!el) return;
    try {
      const data = await manageFetch("/api/chrome/profiles");
      const profiles: any[] = data.profiles || [];
      if (profiles.length === 0) {
        el.innerHTML = `<span style="color:var(--text-soft)">${t("manage_no_profiles", { dir: manageEscape(data.userDataDir || "") })}</span>`;
        return;
      }
      el.innerHTML = profiles.map((p) => `<div style="padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px;display:flex;justify-content:space-between;align-items:center;gap:10px"><span><strong>${manageEscape(p.name)}</strong> <span style="color:var(--text-soft)">· ${manageEscape(p.directory)}</span></span><button type="button" data-chrome-profile="${manageEscape(p.directory)}" style="min-height:unset;padding:5px 12px;font-size:12px;">${t("manage_open_profile_btn")}</button></div>`).join("");
      el.querySelectorAll("[data-chrome-profile]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const statusEl = document.getElementById("manage-chrome-status");
          const directory = (btn as HTMLElement).dataset.chromeProfile || "";
          try {
            const { apiBase, token } = manageApi();
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;
            const r = await fetch(`${apiBase}/api/chrome/open`, { method: "POST", headers, body: JSON.stringify({ profile: directory, url: "https://chatgpt.com" }), signal: AbortSignal.timeout(8000) });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
            if (statusEl) { statusEl.textContent = t("manage_profile_opened", { directory, pid: data.pid ?? "—" }); statusEl.style.color = "#10b981"; }
          } catch (err: any) {
            if (statusEl) { statusEl.textContent = t("manage_profile_open_failed", { directory, message: err.message }); statusEl.style.color = "#ef4444"; }
          }
        });
      });
    } catch (err: any) {
      el.innerHTML = `<span style="color:#ef4444">${t("manage_profile_failed", { message: manageEscape(err.message) })}</span>`;
    }
  }
  document.getElementById("manage-skills-search")?.addEventListener("input", renderSkillsManage);

  // Fleet (Phase 3): list nodes + dispatches from the selected hub daemon.
  async function loadFleetManage(): Promise<void> {
    const el = document.getElementById("manage-fleet-list");
    if (!el) return;
    try {
      const nodesData = await manageFetch("/api/fleet/nodes");
      const dispData = await manageFetch("/api/fleet/dispatches");
      const nodes: any[] = nodesData.nodes || [];
      const dispatches: any[] = dispData.dispatches || [];
      if (nodes.length === 0 && dispatches.length === 0) {
        el.innerHTML = `<span style="color:var(--text-soft)">${t("manage_no_workers")}</span>`;
        return;
      }
      el.innerHTML = nodes.map((n) => `<div style="padding:8px 12px;background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:8px"><strong>${manageEscape(n.name)}</strong> <span style="color:var(--text-soft)">· ${manageEscape(n.nodeId)} · ${manageEscape(n.status)} · ${manageEscape(n.apiBase)}</span><div style="color:var(--text-soft);font-size:12px">projects: ${manageEscape((n.projects || []).join(", ") || "—")}</div></div>`).join("") +
        dispatches.slice(0, 10).map((d) => `<div style="padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px">📤 ${manageEscape(d.dispatchId)} → ${manageEscape(d.nodeId)} · <strong>${manageEscape(d.status)}</strong> · ${manageEscape(d.goal.slice(0, 120))}</div>`).join("");
    } catch (err: any) {
      el.innerHTML = `<span style="color:#ef4444">${t("manage_fleet_failed", { message: manageEscape(err.message) })}</span>`;
    }
  }
  document.getElementById("manage-fleet-dispatch-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nodeId = (document.getElementById("manage-fleet-node") as HTMLInputElement).value.trim();
    const goal = (document.getElementById("manage-fleet-goal") as HTMLInputElement).value.trim();
    const tasksText = (document.getElementById("manage-fleet-tasks") as HTMLTextAreaElement).value.trim();
    const project = (document.getElementById("manage-fleet-project") as HTMLInputElement).value.trim();
    const statusEl = document.getElementById("manage-fleet-status");
    if (!nodeId || !goal || !tasksText) { if (statusEl) { statusEl.textContent = t("manage_enter_fleet"); statusEl.style.color = "#ef4444"; } return; }
    const tasks = tasksText.split("\n").map((t) => t.trim()).filter(Boolean).map((goal) => ({ goal }));
    const prompt = `Gọi fleet_dispatch với nodeId="${nodeId}", goal="${goal.replace(/"/g, '\\"')}", tasks=${JSON.stringify(tasks)}${project ? `, projectRoot="${project.replace(/"/g, '\\"')}"` : ""}. Sau đó gọi fleet_status cho dispatch đó cho đến khi done/blocked rồi tổng hợp kết quả cho tôi.`;
    try { await navigator.clipboard.writeText(prompt); if (statusEl) { statusEl.textContent = t("manage_fleet_copied"); statusEl.style.color = "#10b981"; } }
    catch { if (statusEl) { statusEl.textContent = prompt; statusEl.style.color = ""; } }
  });
  document.getElementById("manage-export-servers")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("manage-servers-io-status");
    try {
      const payload = await exportServers();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "otter_servers_export.json"; a.click(); URL.revokeObjectURL(a.href);
      if (statusEl) { statusEl.textContent = t("manage_exported", { count: payload.servers.length }); statusEl.style.color = "#10b981"; }
    } catch (err: any) { if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; } }
  });
  document.getElementById("manage-import-servers")?.addEventListener("change", async (e) => {
    const statusEl = document.getElementById("manage-servers-io-status");
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const res = await importServers(payload);
      if (statusEl) { statusEl.textContent = t("manage_imported", { imported: res.imported, skipped: res.skipped }); statusEl.style.color = "#10b981"; }
    } catch (err: any) { if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; } }
  });
  document.getElementById("manage-custom-browser-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("manage-chrome-status");
    const browserPath = (document.getElementById("manage-custom-browser-path") as HTMLInputElement).value.trim();
    const profile = (document.getElementById("manage-custom-browser-profile") as HTMLInputElement).value.trim() || undefined;
    const url = (document.getElementById("manage-custom-browser-url") as HTMLInputElement).value.trim() || "https://chatgpt.com";
    if (!browserPath) { if (statusEl) { statusEl.textContent = t("manage_enter_browser"); statusEl.style.color = "#ef4444"; } return; }
    try {
      const { apiBase, token } = manageApi();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch(`${apiBase}/api/chrome/open`, { method: "POST", headers, body: JSON.stringify({ browserPath, profile, url }), signal: AbortSignal.timeout(8000) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (statusEl) { statusEl.textContent = t("manage_browser_opened", { path: browserPath, pid: data.pid ?? "—" }); statusEl.style.color = "#10b981"; }
    } catch (err: any) {
      if (statusEl) { statusEl.textContent = t("manage_browser_open_failed", { message: err.message }); statusEl.style.color = "#ef4444"; }
    }
  });
  document.getElementById("tab-btn-manage")?.addEventListener("click", () => { renderManageTools(); void loadPlansManage(); void loadSkillsManage(); void loadFleetManage(); void loadChromeProfilesManage(); void loadPageLoopsManage(); });
  document.getElementById("manage-open-plan-dashboard")?.addEventListener("click", () => {
    const { apiBase } = manageApi();
    window.open(`${apiBase}/plan-dashboard`, "_blank", "noopener");
  });
  document.getElementById("manage-open-activity")?.addEventListener("click", () => {
    const { apiBase } = manageApi();
    window.open(`${apiBase}/activity`, "_blank", "noopener");
  });
  document.getElementById("manage-open-chatgpt")?.addEventListener("click", () => {
    window.open("https://chatgpt.com", "_blank", "noopener");
  });

  const manageAddServerForm = document.getElementById("manage-add-server-form") as HTMLFormElement | null;
  manageAddServerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = (document.getElementById("manage-server-name") as HTMLInputElement).value.trim();
    const url = (document.getElementById("manage-server-url") as HTMLInputElement).value.trim();
    const token = (document.getElementById("manage-server-token") as HTMLInputElement).value.trim() || undefined;
    const statusEl = document.getElementById("manage-server-status");
    try {
      if (!name || !url) throw new Error(t("manage_server_invalid"));
      await addServer(name, url, token);
      // Rebuild the shared server selector so the new server is pickable now.
      if (serverSelect) {
        const servers = await getServers();
        serverSelect.innerHTML = "";
        for (const s of servers) {
          const opt = document.createElement("option");
          opt.value = s.apiBase;
          opt.dataset.id = s.id;
          opt.textContent = `${s.name} (${s.apiBase})`;
          serverSelect.appendChild(opt);
        }
      }
      if (statusEl) { statusEl.textContent = t("manage_server_added"); statusEl.style.color = "#10b981"; }
    } catch (err: any) {
      if (statusEl) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = "#ef4444"; }
    }
  });

  // --- FB Sales Playbook & Messenger Auto-Listener Management ---
  async function loadFbSalesPlaybook(): Promise<void> {
    const statusEl = document.getElementById("fb-sales-status-msg");
    const listenerStatusEl = document.getElementById("fb-sales-listener-status");
    const repliedCountEl = document.getElementById("fb-sales-replied-count");
    const lastCustomerEl = document.getElementById("fb-sales-last-customer");
    const stagesContainer = document.getElementById("fb-sales-stages-container");
    const intentsContainer = document.getElementById("fb-sales-intents-container");
    const commentsContainer = document.getElementById("fb-sales-comments-container");

    try {
      // 1. Fetch listener status
      try {
        const listenData = await manageFetch("/api/activity/v1/browser/messenger/listen/status");
        if (listenerStatusEl) {
          listenerStatusEl.textContent = listenData.active ? t("listener_running") : t("listener_paused");
          listenerStatusEl.style.color = listenData.active ? "#10b981" : "#ef4444";
        }
        if (repliedCountEl) repliedCountEl.textContent = String(listenData.replyCount || 0);
        if (lastCustomerEl) lastCustomerEl.textContent = listenData.lastRepliedTo || t("listener_none");
      } catch {}

      // 2. Fetch full playbook from DB
      const data = await manageFetch("/api/activity/v1/browser/messenger/playbook");
      if (!data || !data.ok) throw new Error("Không thể tải kịch bản từ máy chủ");

      // Render Stages
      if (stagesContainer) {
        stagesContainer.innerHTML = (data.stages || []).map((stage: any) => {
          const badgeColors: Record<string, string> = {
            greeting: "#10b981",
            discovery: "#06b6d4",
            pitch: "#3b82f6",
            objection: "#f59e0b",
            closing: "#ec4899",
            support: "#8b5cf6"
          };
          const color = badgeColors[stage.stage] || "#64748b";
          const templatesText = (stage.templates || []).join("\n");
          return `
            <div class="card-box" style="border-left: 4px solid ${color}; padding: 14px 16px; margin: 0; background: var(--surface);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="background:${color}; color:#000; font-weight:700; font-size:11px; padding:3px 8px; border-radius:4px; text-transform:uppercase;">${stage.stage}</span>
                  <strong style="font-size:14px;">${manageEscape(stage.name)}</strong>
                </div>
                <button type="button" class="btn-save-stage" data-stage="${stage.stage}" style="min-height:unset; padding:6px 14px; font-size:12px; background:#10b981; color:#000; font-weight:700; border:none; border-radius:6px; cursor:pointer;">💾 Lưu bước này</button>
              </div>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Tên giai đoạn:</label>
                  <input type="text" id="stage-name-${stage.stage}" value="${manageEscape(stage.name)}" style="width:100%; box-sizing:border-box; padding:7px 10px; font-size:13px; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff;">
                </div>
                <div>
                  <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Mục tiêu chuyển đổi:</label>
                  <input type="text" id="stage-goal-${stage.stage}" value="${manageEscape(stage.goal)}" style="width:100%; box-sizing:border-box; padding:7px 10px; font-size:13px; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff;">
                </div>
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Danh sách câu thoại mẫu (Mỗi dòng 1 câu, dùng {name} để chèn tên khách):</label>
                <textarea id="stage-templates-${stage.stage}" rows="${Math.max(3, (stage.templates || []).length + 1)}" style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:12px; font-family:inherit; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff; line-height:1.4;">${manageEscape(templatesText)}</textarea>
              </div>
            </div>
          `;
        }).join("");

        stagesContainer.querySelectorAll<HTMLButtonElement>(".btn-save-stage").forEach(btn => {
          btn.addEventListener("click", async () => {
            const stage = btn.getAttribute("data-stage")!;
            const nameInput = document.getElementById(`stage-name-${stage}`) as HTMLInputElement;
            const goalInput = document.getElementById(`stage-goal-${stage}`) as HTMLInputElement;
            const templatesArea = document.getElementById(`stage-templates-${stage}`) as HTMLTextAreaElement;
            const templates = (templatesArea?.value || "").split("\n").map(s => s.trim()).filter(Boolean);

            btn.textContent = t("saving");
            try {
              const { apiBase, token } = manageApi();
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (token) headers["Authorization"] = `Bearer ${token}`;
              const res = await fetch(`${apiBase}/api/activity/v1/browser/messenger/playbook/stage`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  stage,
                  name: nameInput?.value?.trim(),
                  goal: goalInput?.value?.trim(),
                  templates
                })
              });
              const resData = await res.json();
              btn.textContent = t("saved");
              btn.style.background = "#34d399";
              if (statusEl) {
                statusEl.textContent = `✅ ${resData.message || t("save_phase_success")}`;
                statusEl.style.color = "#10b981";
              }
              setTimeout(() => { btn.textContent = t("save_phase_btn"); btn.style.background = "#10b981"; }, 2000);
            } catch (err: any) {
              btn.textContent = t("save_error");
              alert(t("error_save_phase", { message: err.message }));
            }
          });
        });
      }

      // Render Intents
      if (intentsContainer) {
        intentsContainer.innerHTML = (data.intents || []).map((intent: any) => {
          const keywordsStr = (intent.keywords || []).join(", ");
          return `
            <div class="card-box" style="border-left: 4px solid #f59e0b; padding: 14px 16px; margin: 0; background: var(--surface);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="background:#f59e0b; color:#000; font-weight:700; font-size:11px; padding:3px 8px; border-radius:4px;">${intent.intentKey}</span>
                  <strong style="font-size:14px;">${manageEscape(intent.name)}</strong>
                  <span style="font-size:12px; color:var(--text-soft); font-style:italic;">(${manageEscape(intent.description || "")})</span>
                </div>
                <button type="button" class="btn-save-intent" data-intent="${intent.intentKey}" style="min-height:unset; padding:6px 14px; font-size:12px; background:#f59e0b; color:#000; font-weight:700; border:none; border-radius:6px; cursor:pointer;">💾 Lưu ý định</button>
              </div>
              <div style="display:grid; grid-template-columns: 2fr 1fr; gap:10px; margin-bottom:10px;">
                <div>
                  <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Từ khóa kích hoạt (ngăn cách bằng dấu phẩy):</label>
                  <input type="text" id="intent-keywords-${intent.intentKey}" value="${manageEscape(keywordsStr)}" style="width:100%; box-sizing:border-box; padding:7px 10px; font-size:13px; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff;">
                </div>
                <div>
                  <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Chuyển sang giai đoạn tiếp theo:</label>
                  <select id="intent-stage-${intent.intentKey}" style="width:100%; min-height:unset; padding:7px 8px; font-size:13px; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff;">
                    ${["greeting", "discovery", "pitch", "objection", "closing", "support", "done"].map(st => `<option value="${st}" ${intent.nextStage === st ? "selected" : ""}>${st}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Câu trả lời mẫu khi khách hỏi trúng ý định (dùng {name}):</label>
                <textarea id="intent-reply-${intent.intentKey}" rows="3" style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:12px; font-family:inherit; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff; line-height:1.4;">${manageEscape(intent.replyTemplate)}</textarea>
              </div>
            </div>
          `;
        }).join("");

        intentsContainer.querySelectorAll<HTMLButtonElement>(".btn-save-intent").forEach(btn => {
          btn.addEventListener("click", async () => {
            const intentKey = btn.getAttribute("data-intent")!;
            const keywordsInput = document.getElementById(`intent-keywords-${intentKey}`) as HTMLInputElement;
            const stageSelect = document.getElementById(`intent-stage-${intentKey}`) as HTMLSelectElement;
            const replyArea = document.getElementById(`intent-reply-${intentKey}`) as HTMLTextAreaElement;
            const keywords = (keywordsInput?.value || "").split(",").map(s => s.trim()).filter(Boolean);

            btn.textContent = t("saving");
            try {
              const { apiBase, token } = manageApi();
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (token) headers["Authorization"] = `Bearer ${token}`;
              const res = await fetch(`${apiBase}/api/activity/v1/browser/messenger/playbook/intent`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  intentKey,
                  keywords,
                  replyTemplate: replyArea?.value || "",
                  nextStage: stageSelect?.value || "closing"
                })
              });
              const resData = await res.json();
              btn.textContent = t("saved");
              btn.style.background = "#34d399";
              if (statusEl) {
                statusEl.textContent = `✅ ${resData.message || t("save_intent_success")}`;
                statusEl.style.color = "#10b981";
              }
              setTimeout(() => { btn.textContent = t("save_intent_btn"); btn.style.background = "#f59e0b"; }, 2000);
            } catch (err: any) {
              btn.textContent = t("save_error");
              alert(t("error_save_intent", { message: err.message }));
            }
          });
        });
      }

      // Render Comments
      if (commentsContainer) {
        commentsContainer.innerHTML = (data.commentCategories || []).map((cat: any) => {
          const templatesText = (cat.templates || []).join("\n");
          return `
            <div class="card-box" style="border-left: 4px solid #38bdf8; padding: 14px 16px; margin: 0; background: var(--surface);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="background:#38bdf8; color:#000; font-weight:700; font-size:11px; padding:3px 8px; border-radius:4px;">${cat.category}</span>
                  <strong style="font-size:14px;">${manageEscape(cat.name)}</strong>
                </div>
                <button type="button" class="btn-save-comment" data-category="${cat.category}" style="min-height:unset; padding:6px 14px; font-size:12px; background:#38bdf8; color:#000; font-weight:700; border:none; border-radius:6px; cursor:pointer;">💾 Lưu bình luận</button>
              </div>
              <div>
                <label style="font-size:11px; color:var(--text-soft); display:block; margin-bottom:4px; font-weight:600;">Danh sách câu bình luận mẫu (Mỗi dòng 1 câu, dùng {author} để chèn tên tác giả):</label>
                <textarea id="comment-templates-${cat.category}" rows="${Math.max(3, (cat.templates || []).length + 1)}" style="width:100%; box-sizing:border-box; padding:8px 10px; font-size:12px; font-family:inherit; background:var(--field); border:1px solid var(--border); border-radius:6px; color:#fff; line-height:1.4;">${manageEscape(templatesText)}</textarea>
              </div>
            </div>
          `;
        }).join("");

        commentsContainer.querySelectorAll<HTMLButtonElement>(".btn-save-comment").forEach(btn => {
          btn.addEventListener("click", async () => {
            const category = btn.getAttribute("data-category")!;
            const templatesArea = document.getElementById(`comment-templates-${category}`) as HTMLTextAreaElement;
            const templates = (templatesArea?.value || "").split("\n").map(s => s.trim()).filter(Boolean);

            btn.textContent = t("saving");
            try {
              const { apiBase, token } = manageApi();
              const headers: Record<string, string> = { "Content-Type": "application/json" };
              if (token) headers["Authorization"] = `Bearer ${token}`;
              const res = await fetch(`${apiBase}/api/activity/v1/browser/messenger/playbook/comments`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  category,
                  templates
                })
              });
              const resData = await res.json();
              btn.textContent = t("saved");
              btn.style.background = "#34d399";
              if (statusEl) {
                statusEl.textContent = `✅ ${resData.message || t("save_comment_success")}`;
                statusEl.style.color = "#10b981";
              }
              setTimeout(() => { btn.textContent = t("save_comment_btn"); btn.style.background = "#38bdf8"; }, 2000);
            } catch (err: any) {
              btn.textContent = t("save_error");
              alert(t("error_save_comment", { message: err.message }));
            }
          });
        });
      }

    } catch (e: any) {
      if (statusEl) {
        statusEl.textContent = `❌ Lỗi kết nối daemon: ${e.message}`;
        statusEl.style.color = "#ef4444";
      }
    }
  }

  document.getElementById("fb-sales-refresh")?.addEventListener("click", () => {
    void loadFbSalesPlaybook();
  });

  document.getElementById("fb-sales-reset")?.addEventListener("click", async () => {
    if (!confirm(t("confirm_restore_all"))) return;
    try {
      const { apiBase, token } = manageApi();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch(`${apiBase}/api/activity/v1/browser/messenger/playbook/reset`, { method: "POST", headers });
      await loadFbSalesPlaybook();
      const statusEl = document.getElementById("fb-sales-status-msg");
      if (statusEl) {
        statusEl.textContent = t("restore_success");
        statusEl.style.color = "#10b981";
      }
    } catch (e: any) {
      alert(t("error_restore", { message: e.message }));
    }
  });

  document.getElementById("tab-btn-fb-sales")?.addEventListener("click", () => {
    void loadFbSalesPlaybook();
  });

  if (document.getElementById("tab-fb-sales")?.classList.contains("active")) {
    void loadFbSalesPlaybook();
  }

  // Manual Tab (Cẩm Nang Câu Lệnh Chi Tiết)
  function initManualTab() {
    const searchInput = document.getElementById("manual-search-input") as HTMLInputElement | null;
    const filterBtns = document.querySelectorAll<HTMLButtonElement>(".manual-cat-btn");
    const cards = document.querySelectorAll<HTMLElement>(".manual-cmd-card");

    let activeCat = "all";

    function applyFilter() {
      const query = (searchInput?.value || "").toLowerCase().trim();
      cards.forEach(card => {
        const cardCat = card.getAttribute("data-cat") || "all";
        const matchesCat = activeCat === "all" || cardCat === activeCat;
        const text = card.textContent?.toLowerCase() || "";
        const matchesSearch = !query || text.includes(query);

        card.style.display = matchesCat && matchesSearch ? "" : "none";
      });
    }

    searchInput?.addEventListener("input", () => {
      applyFilter();
    });

    filterBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        filterBtns.forEach(b => {
          b.classList.remove("active");
          b.style.background = "transparent";
          b.style.borderColor = "var(--border)";
          b.style.color = "var(--text-soft)";
        });
        btn.classList.add("active");
        btn.style.background = "var(--accent-soft)";
        btn.style.borderColor = "var(--accent)";
        btn.style.color = "var(--accent)";

        activeCat = btn.getAttribute("data-cat") || "all";
        applyFilter();
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".btn-copy-prompt").forEach(btn => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".manual-cmd-card");
        const promptEl = card?.querySelector(".prompt-text");
        const textToCopy = promptEl?.textContent?.trim() || "";

        if (!textToCopy) return;

        let copied = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(textToCopy);
            copied = true;
          }
        } catch {}

        if (!copied) {
          try {
            const ta = document.createElement("textarea");
            ta.value = textToCopy;
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            copied = true;
          } catch (e) {
            console.warn("Fallback copy failed:", e);
          }
        }

        const originalText = btn.innerHTML;
        const originalBg = btn.style.background;
        btn.innerHTML = t("btn_copied");
        btn.style.background = "#10b981";
        btn.style.color = "#000";

        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.style.background = originalBg;
          btn.style.color = "";
        }, 2000);
      });
    });
  }

  // =========================================================================
  // 15. SCHEDULED TASKS TAB (Tác Vụ Hẹn Giờ Tự Động)
  // =========================================================================
  let tasksPollTimer: any = null;
  let cachedTasksList: any[] = [];

  function setTaskQuickTime(minutes: number) {
    const now = new Date();
    now.setMinutes(now.getMinutes() + minutes);
    const localIso = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    const inp = document.getElementById("opt-task-scheduled-at") as HTMLInputElement;
    if (inp) inp.value = localIso;
  }

  function renderTasksList() {
    const totalEl = document.getElementById("opt-stat-total");
    const pendingEl = document.getElementById("opt-stat-pending");
    const runningEl = document.getElementById("opt-stat-running");
    const completedEl = document.getElementById("opt-stat-completed");
    const labelEl = document.getElementById("opt-tasks-count-label");
    const container = document.getElementById("opt-tasks-list-container");

    if (totalEl) totalEl.textContent = String(cachedTasksList.length);
    if (pendingEl) pendingEl.textContent = String(cachedTasksList.filter(t => t.status === "pending").length);
    if (runningEl) runningEl.textContent = String(cachedTasksList.filter(t => t.status === "running").length);
    if (completedEl) completedEl.textContent = String(cachedTasksList.filter(t => t.status === "completed").length);
    if (labelEl) labelEl.textContent = `${cachedTasksList.length} tác vụ`;

    if (!container) return;

    if (cachedTasksList.length === 0) {
      container.innerHTML = `<div style="color:var(--text-soft); font-size:13px; text-align:center; padding:30px; border:1px dashed var(--border); border-radius:10px;">Chưa có tác vụ nào được lên lịch. Hãy tạo tác vụ đầu tiên ở trên!</div>`;
      return;
    }

    container.innerHTML = cachedTasksList.map((t) => {
      const isPending = t.status === "pending";
      const isRunning = t.status === "running";
      const isCompleted = t.status === "completed";
      const isFailed = t.status === "failed";

      let badge = `<span style="padding:3px 8px; border-radius:999px; font-size:11px; font-weight:700; background:#374151; color:#9ca3af;">${t.status}</span>`;
      if (isPending) badge = `<span style="padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(245, 158, 11, 0.15); color:#fbbf24; border:1px solid rgba(245, 158, 11, 0.4);">⏳ Chờ chạy</span>`;
      if (isRunning) badge = `<span style="padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(56, 189, 248, 0.15); color:#38bdf8; border:1px solid rgba(56, 189, 248, 0.4);">🚀 Đang chạy...</span>`;
      if (isCompleted) badge = `<span style="padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(16, 185, 129, 0.15); color:#34d399; border:1px solid rgba(16, 185, 129, 0.4);">✅ Hoàn thành</span>`;
      if (isFailed) badge = `<span style="padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; background:rgba(239, 68, 68, 0.15); color:#f87171; border:1px solid rgba(239, 68, 68, 0.4);">❌ Thất bại</span>`;

      const schedTime = new Date(t.scheduled_at).toLocaleString("vi-VN");
      const compTime = t.completed_at ? new Date(t.completed_at).toLocaleTimeString("vi-VN") : "";

      return `
        <div style="background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:16px; display:grid; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:700; font-size:15px; color:#fff;">${manageEscape(t.title)}</div>
              <div style="font-size:12.5px; color:var(--text-soft); margin-top:3px; max-width:550px; line-height:1.4;">${manageEscape(t.prompt)}</div>
              ${t.repeat_minutes > 0 ? `<span style="display:inline-block; margin-top:4px; font-size:11px; color:#c084fc; background:rgba(192,132,252,0.1); padding:2px 8px; border-radius:4px; border:1px solid rgba(192,132,252,0.3);">🔁 Lặp lại mỗi ${t.repeat_minutes} phút</span>` : ""}
            </div>
            <div>${badge}</div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; border-top:1px solid rgba(255,255,255,0.06); padding-top:10px; font-size:12px;">
            <div style="color:var(--text-soft);">
              <span>🕒 Hẹn lúc: <b style="color:var(--text);">${schedTime}</b></span>
              ${compTime ? `<span style="margin-left:12px;">Xong lúc: <b style="color:#34d399;">${compTime}</b></span>` : ""}
            </div>

            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
              ${t.chat_url ? `
                <a href="${t.chat_url}" target="_blank" rel="noreferrer" style="color:#818cf8; font-weight:600; display:inline-flex; align-items:center; gap:4px; text-decoration:none; padding:4px 8px; border-radius:6px; background:rgba(129, 140, 248, 0.1);">
                  🔗 Mở Chat Gốc
                </a>
              ` : ""}

              ${(t.response_text || t.screenshot_path) ? `
                <button type="button" class="opt-task-view-btn" data-id="${t.id}" style="min-height:unset; padding:4px 10px; font-size:12px; background:rgba(255,255,255,0.08); border:1px solid var(--border); color:#fff; border-radius:6px; cursor:pointer;">
                  👁️ Xem Kết Quả & Ảnh
                </button>
              ` : ""}

              ${!isRunning ? `
                <button type="button" class="opt-task-run-btn" data-id="${t.id}" title="Chạy ngay lập tức" style="min-height:unset; padding:4px 10px; font-size:12px; background:rgba(16, 185, 129, 0.15); border:1px solid #10b981; color:#34d399; border-radius:6px; cursor:pointer;">
                  ▶️ Chạy ngay
                </button>
              ` : ""}

              <button type="button" class="opt-task-del-btn" data-id="${t.id}" title="Xóa tác vụ" style="min-height:unset; padding:4px 8px; font-size:12px; background:rgba(239, 68, 68, 0.15); border:1px solid #ef4444; color:#f87171; border-radius:6px; cursor:pointer;">
                🗑️
              </button>
            </div>
          </div>
          ${t.error_message ? `<div style="font-size:11.5px; color:#f87171; font-family:monospace; background:rgba(239,68,68,0.1); padding:6px 10px; border-radius:6px;">Lỗi: ${manageEscape(t.error_message)}</div>` : ""}
        </div>
      `;
    }).join("");

    container.querySelectorAll<HTMLButtonElement>(".opt-task-view-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const task = cachedTasksList.find(t => t.id === id);
        if (task) openTaskModal(task);
      });
    });

    container.querySelectorAll<HTMLButtonElement>(".opt-task-run-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        if (!confirm("Bạn có muốn kích hoạt chạy tác vụ này ngay trên ChatGPT Web?")) return;
        try {
          await manageFetch(`/api/tasks/${id}/run`, "POST");
          void loadTasksList();
        } catch (err: any) {
          alert("Lỗi: " + err.message);
        }
      });
    });

    container.querySelectorAll<HTMLButtonElement>(".opt-task-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        if (!confirm("Bạn chắc chắn muốn xóa tác vụ này?")) return;
        try {
          await manageFetch(`/api/tasks/${id}`, "DELETE");
          void loadTasksList();
        } catch (err: any) {
          alert("Lỗi xóa: " + err.message);
        }
      });
    });
  }

  async function loadTasksList(): Promise<void> {
    try {
      const res = await manageFetch("/api/tasks");
      if (res && res.success) {
        cachedTasksList = res.tasks || [];
        renderTasksList();
      }
    } catch (err) {
      console.warn("[Otter Tasks] Lỗi tải:", err);
    }
  }

  function startTasksPolling() {
    stopTasksPolling();
    tasksPollTimer = setInterval(() => {
      void loadTasksList();
    }, 4000);
  }

  function stopTasksPolling() {
    if (tasksPollTimer) {
      clearInterval(tasksPollTimer);
      tasksPollTimer = null;
    }
  }

  function openTaskModal(task: any) {
    const modal = document.getElementById("opt-task-modal");
    const titleEl = document.getElementById("opt-modal-title");
    const bodyEl = document.getElementById("opt-modal-body");
    if (!modal || !titleEl || !bodyEl) return;

    titleEl.textContent = task.title || "Chi Tiết Tác Vụ";

    const { apiBase } = manageApi();
    let html = `
      <div>
        <div style="font-weight:700; color:var(--text-soft); font-size:12px; margin-bottom:4px;">CÂU LỆNH ĐÃ GỬI VÀO CHATGPT WEB:</div>
        <div style="background:#0b0f17; border:1px solid var(--border); border-radius:8px; padding:12px; font-family:monospace; font-size:12.5px; color:#e2e8f0; white-space:pre-wrap;">${manageEscape(task.prompt)}</div>
      </div>
    `;

    if (task.chat_url) {
      html += `
        <div>
          <div style="font-weight:700; color:var(--text-soft); font-size:12px; margin-bottom:4px;">ĐƯỜNG DẪN CUỘC TRÒ CHUYỆN GỐC (CHAT URL):</div>
          <a href="${task.chat_url}" target="_blank" rel="noreferrer" style="color:#818cf8; font-size:12.5px; word-break:break-all; text-decoration:none;">
            🔗 ${task.chat_url}
          </a>
        </div>
      `;
    }

    if (task.response_text) {
      html += `
        <div>
          <div style="font-weight:700; color:var(--text-soft); font-size:12px; margin-bottom:4px;">KẾT QUẢ PHẢN HỒI TỪ CHATGPT WEB:</div>
          <div style="background:#0b0f17; border:1px solid var(--border); border-radius:8px; padding:14px; font-size:13px; color:#f1f5f9; white-space:pre-wrap; max-height:250px; overflow-y:auto; line-height:1.6;">${manageEscape(task.response_text)}</div>
        </div>
      `;
    }

    if (task.screenshot_path) {
      const shotUrl = `${apiBase}/${task.screenshot_path}`;
      html += `
        <div>
          <div style="font-weight:700; color:var(--text-soft); font-size:12px; margin-bottom:4px;">ẢNH CHỤP MÀN HÌNH BẰNG CHỨNG XÁC MINH:</div>
          <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; background:#000;">
            <a href="${shotUrl}" target="_blank" rel="noreferrer">
              <img src="${shotUrl}" alt="Screenshot" style="width:100%; display:block; max-height:400px; object-fit:contain;">
            </a>
          </div>
        </div>
      `;
    }

    bodyEl.innerHTML = html;
    modal.style.display = "flex";
  }

  function closeTaskModal() {
    const modal = document.getElementById("opt-task-modal");
    if (modal) modal.style.display = "none";
  }

  function initScheduledTasksTab() {
    setTaskQuickTime(0);

    document.querySelectorAll<HTMLButtonElement>(".opt-quick-time").forEach(btn => {
      btn.addEventListener("click", () => {
        const min = Number(btn.getAttribute("data-min") || "0");
        setTaskQuickTime(min);
      });
    });

    document.querySelectorAll<HTMLButtonElement>(".opt-quick-prompt").forEach(btn => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-prompt") || "";
        const ta = document.getElementById("opt-task-prompt") as HTMLTextAreaElement;
        if (ta) ta.value = text;
      });
    });

    document.getElementById("opt-tasks-refresh-btn")?.addEventListener("click", () => {
      void loadTasksList();
    });

    document.getElementById("opt-modal-close")?.addEventListener("click", closeTaskModal);
    document.getElementById("opt-modal-close-btn")?.addEventListener("click", closeTaskModal);
    document.getElementById("opt-task-modal")?.addEventListener("click", (e) => {
      if (e.target === document.getElementById("opt-task-modal")) closeTaskModal();
    });

    const taskForm = document.getElementById("opt-task-form") as HTMLFormElement;
    taskForm?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = (document.getElementById("opt-task-title") as HTMLInputElement)?.value?.trim();
      const prompt = (document.getElementById("opt-task-prompt") as HTMLTextAreaElement)?.value?.trim();
      const repeat = Number((document.getElementById("opt-task-repeat") as HTMLSelectElement)?.value || "0");
      const schedVal = (document.getElementById("opt-task-scheduled-at") as HTMLInputElement)?.value;
      const scheduledAt = schedVal ? new Date(schedVal).getTime() : Date.now();

      if (!title || !prompt) {
        alert("Vui lòng nhập tiêu đề và câu lệnh prompt");
        return;
      }

      const submitBtn = document.getElementById("opt-task-submit-btn") as HTMLButtonElement;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang lưu...";
      }

      try {
        await manageFetch("/api/tasks", "POST", {
          title,
          prompt,
          scheduledAt,
          repeatMinutes: repeat
        });
        (document.getElementById("opt-task-title") as HTMLInputElement).value = "";
        (document.getElementById("opt-task-prompt") as HTMLTextAreaElement).value = "";
        setTaskQuickTime(0);
        void loadTasksList();
      } catch (err: any) {
        alert("Lỗi tạo tác vụ: " + err.message);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "🚀 Lên Lịch Tác Vụ";
        }
      }
    });
  }

  // =========================================================================
  // 16. PLAN DASHBOARD TAB (Bảng Điều Khiển Kế Hoạch)
  // =========================================================================
  function loadDashboardIframe() {
    const iframe = document.getElementById("opt-dashboard-iframe") as HTMLIFrameElement;
    if (iframe) {
      const { apiBase } = manageApi();
      const targetUrl = `${apiBase}/dashboard`;
      if (iframe.src !== targetUrl) {
        iframe.src = targetUrl;
      }
    }
  }

  function initDashboardTab() {
    document.getElementById("opt-dashboard-open-btn")?.addEventListener("click", () => {
      const { apiBase } = manageApi();
      window.open(`${apiBase}/dashboard`, "_blank", "noopener");
    });
    document.getElementById("opt-dashboard-reload-btn")?.addEventListener("click", () => {
      const iframe = document.getElementById("opt-dashboard-iframe") as HTMLIFrameElement;
      if (iframe) {
        const { apiBase } = manageApi();
        iframe.src = `${apiBase}/dashboard?t=${Date.now()}`;
      }
    });
  }

  // Wire up tab activation
  onTabActivated = (tabId: string) => {
    if (tabId === "tab-tasks") {
      void loadTasksList();
      startTasksPolling();
    } else {
      stopTasksPolling();
    }
    if (tabId === "tab-dashboard") {
      loadDashboardIframe();
    }
    if (tabId === "tab-manage") {
      renderManageTools();
      void loadPlansManage();
      void loadSkillsManage();
    }
  };

  initScheduledTasksTab();
  initDashboardTab();
  initManualTab();

  // Load initial tab data
  if (document.getElementById("tab-tasks")?.classList.contains("active")) {
    void loadTasksList();
    startTasksPolling();
  } else if (document.getElementById("tab-dashboard")?.classList.contains("active")) {
    loadDashboardIframe();
  }

  // Load management data on first open, and when the stored tab is Manage.
  void loadManageSettings();
  if (document.getElementById("tab-manage")?.classList.contains("active")) {
    renderManageTools();
    void loadPlansManage();
    void loadSkillsManage();
  }
});
