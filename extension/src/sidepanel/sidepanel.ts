/**
 * Otter Side Panel (Folderloom Task 4, revised scope).
 * Shell + tab switching + real daemon status via GET /activity
 * (public status page; ok = daemon reachable, otherwise offline).
 * Terminal PTY and FB scheduler are NOT faked here: their buttons open
 * the real surfaces (in-page Live Terminal on chatgpt.com, and the
 * Options Management Center / Plan Dashboard). See revised plan.
 */
import { initI18n, t, formatDate } from "../i18n";
import { applyDataI18n } from "../i18n/apply";

const DAEMON_BASE = "http://127.0.0.1:1993";

function openUrl(url: string): void {
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url });
      return;
    }
  } catch {}
  window.open(url, "_blank", "noopener");
}

async function updateDaemonStatus(): Promise<void> {
  const badge = document.getElementById("daemon-badge");
  const logs = document.getElementById("daemon-logs");
  if (!badge) return;
  badge.textContent = t("sidepanel_checking");
  try {
    const res = await fetch(`${DAEMON_BASE}/activity`, { method: "GET" });
    if (res.ok) {
      badge.textContent = t("sidepanel_online");
      badge.style.background = "#a6e3a1";
      if (logs) logs.textContent = `${t("sidepanel_online")} — ${DAEMON_BASE}/activity (${res.status}) — ${formatDate(new Date())}`;
    } else {
      badge.textContent = t("sidepanel_offline");
      badge.style.background = "#f38ba8";
      if (logs) logs.textContent = `${t("sidepanel_offline")} — ${DAEMON_BASE}/activity (${res.status}) — ${formatDate(new Date())}`;
    }
  } catch (err: any) {
    badge.textContent = t("sidepanel_offline");
    badge.style.background = "#f38ba8";
    if (logs) logs.textContent = `${t("sidepanel_offline")} — ${err?.message || String(err)} — ${formatDate(new Date())}`;
  }
}

async function loadSidepanelTasks(): Promise<void> {
  const listEl = document.getElementById("sidepanel-tasks-list");
  if (!listEl) return;
  listEl.innerHTML = "<div style='color:#a6adc8;'>Đang nạp tác vụ...</div>";

  try {
    const res = await fetch(`${DAEMON_BASE}/api/tasks`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const tasks = data.tasks || [];

    if (tasks.length === 0) {
      listEl.innerHTML = "<div style='color:#a6adc8; padding:12px; text-align:center;'>Chưa có tác vụ nào. Bấm 'Quản Lý Đặt Lịch' để tạo!</div>";
      return;
    }

    listEl.innerHTML = tasks.slice(0, 10).map((t: any) => {
      let badgeColor = "#9ca3af";
      if (t.status === "pending") badgeColor = "#fbbf24";
      if (t.status === "running") badgeColor = "#38bdf8";
      if (t.status === "completed") badgeColor = "#a6e3a1";
      if (t.status === "failed") badgeColor = "#f38ba8";

      const timeStr = new Date(t.scheduled_at).toLocaleTimeString("vi-VN");

      return `
        <div style="background:#181825; border:1px solid #313244; border-radius:8px; padding:10px; display:grid; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b style="color:#cdd6f4; font-size:12.5px;">${t.title}</b>
            <span style="font-size:10.5px; font-weight:700; color:${badgeColor};">${t.status}</span>
          </div>
          <div style="font-size:11px; color:#a6adc8;">🕒 ${timeStr}</div>
          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
            ${t.chat_url ? `<a href="${t.chat_url}" target="_blank" style="font-size:11px; color:#89b4fa; text-decoration:none;">🔗 Chat</a>` : ""}
            <button class="panel-btn sp-run-btn" data-id="${t.id}" style="min-height:unset; padding:2px 8px; font-size:11px;">▶️ Chạy</button>
          </div>
        </div>
      `;
    }).join("");

    listEl.querySelectorAll(".sp-run-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        try {
          await fetch(`${DAEMON_BASE}/api/tasks/${id}/run`, { method: "POST" });
          void loadSidepanelTasks();
        } catch {}
      });
    });
  } catch (err: any) {
    listEl.innerHTML = `<div style='color:#f38ba8;'>Lỗi kết nối daemon: ${err?.message || err}</div>`;
  }
}

async function init(): Promise<void> {
  await initI18n();
  applyDataI18n();
  console.log("[Otter SidePanel] Initialized");

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const tabName = btn.getAttribute("data-tab");
      document.querySelectorAll(".content").forEach((c) => ((c as HTMLElement).style.display = "none"));
      const activeContent = document.getElementById(`tab-${tabName}`);
      if (activeContent) activeContent.style.display = "block";
      if (tabName === "tasks") void loadSidepanelTasks();
    });
  });

  document.getElementById("sidepanel-tasks-refresh")?.addEventListener("click", () => void loadSidepanelTasks());
  document.getElementById("sidepanel-open-tasks-btn")?.addEventListener("click", () => {
    try {
      chrome.storage?.local?.set({ last_active_tab: "tab-tasks" }, () => {
        chrome.runtime?.openOptionsPage?.();
      });
    } catch {
      openUrl("options.html");
    }
  });
  document.getElementById("sidepanel-open-plan-btn")?.addEventListener("click", () => {
    try {
      chrome.storage?.local?.set({ last_active_tab: "tab-dashboard" }, () => {
        chrome.runtime?.openOptionsPage?.();
      });
    } catch {
      openUrl("options.html");
    }
  });

  document.getElementById("open-chatgpt-btn")?.addEventListener("click", () => openUrl("https://chatgpt.com/"));
  document.getElementById("open-activity-btn")?.addEventListener("click", () => openUrl(`${DAEMON_BASE}/activity`));
  document.getElementById("open-plan-dashboard-btn")?.addEventListener("click", () => openUrl(`${DAEMON_BASE}/plan-dashboard`));
  document.getElementById("open-options-btn")?.addEventListener("click", () => {
    try {
      chrome.runtime?.openOptionsPage?.();
    } catch {
      openUrl("options.html");
    }
  });
  document.getElementById("refresh-status-btn")?.addEventListener("click", () => updateDaemonStatus());

  await updateDaemonStatus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
