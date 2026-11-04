/**
 * Otter Extension - Smart Auto-Update Checker
 * Tự động kiểm tra phiên bản mới từ máy chủ và hiển thị giao diện thông báo cập nhật thông minh trên ChatGPT Web.
 */

import { t } from "../i18n";

export async function initUpdateChecker(): Promise<void> {
  // Chỉ chạy trên frame chính (không chạy trong iframe)
  if (window !== window.top) return;

  try {
    const manifest = typeof chrome !== "undefined" && chrome.runtime?.getManifest ? chrome.runtime.getManifest() : null;
    const currentVersion = manifest?.version || "2.0.0";

    // 1. Kiểm tra thời gian hoãn nhắc lại (Snooze 24h)
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        const stored = await chrome.storage.local.get(["otter_update_snooze", "otter_dismissed_version"]);
        if (stored?.otter_update_snooze && Date.now() < stored.otter_update_snooze) {
          return;
        }
      }
    } catch {}

    // 2. Gọi API kiểm tra phiên bản mới nhất
    const apiUrl = `https://license.gpt.io.vn/api/version?component=extension&client_version=${encodeURIComponent(currentVersion)}`;
    const res = await fetch(apiUrl, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    if (!res.ok) return;
    const data = await res.json();

    // 3. Nếu có phiên bản mới hơn, hiển thị Banner gợi ý cập nhật
    if (data.update_available) {
      renderUpdateBanner(data, currentVersion);
    }
  } catch (err) {
    // Không làm gián đoạn trải nghiệm người dùng nếu có lỗi mạng
    console.debug("[Otter Update] Check error:", err);
  }
}

function renderUpdateBanner(data: { version: string; download_url: string; changelog?: string; release_date?: string }, currentVersion: string) {
  // Tránh tạo trùng banner
  if (document.getElementById("otter-update-banner")) return;

  const banner = document.createElement("div");
  banner.id = "otter-update-banner";
  banner.innerHTML = `
    <style>
      #otter-update-banner {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(56, 189, 248, 0.4);
        border-radius: 16px;
        padding: 16px 20px;
        color: #f8fafc;
        font-family: system-ui, -apple-system, sans-serif;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(56, 189, 248, 0.2);
        max-width: 380px;
        animation: otterSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes otterSlideIn {
        from { transform: translateY(30px) scale(0.95); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }
      .otter-up-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }
      .otter-up-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 750;
        color: #fff;
      }
      .otter-up-badge {
        font-size: 11px;
        background: rgba(56, 189, 248, 0.2);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.4);
        padding: 1px 7px;
        border-radius: 999px;
        font-weight: 700;
      }
      .otter-up-close {
        background: transparent;
        border: none;
        color: #94a3b8;
        font-size: 16px;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 6px;
        line-height: 1;
      }
      .otter-up-close:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
      }
      .otter-up-desc {
        font-size: 12.5px;
        line-height: 1.5;
        color: #cbd5e1;
        margin-bottom: 12px;
      }
      .otter-up-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .otter-up-btn-primary {
        background: linear-gradient(135deg, #10b981, #059669);
        color: #022c22;
        font-size: 12.5px;
        font-weight: 700;
        border: none;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        text-decoration: none;
        box-shadow: 0 2px 10px rgba(16, 185, 129, 0.3);
      }
      .otter-up-btn-primary:hover {
        background: #34d399;
      }
      .otter-up-btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        color: #94a3b8;
        font-size: 12px;
        font-weight: 600;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 8px 12px;
        border-radius: 8px;
        cursor: pointer;
      }
      .otter-up-btn-secondary:hover {
        color: #fff;
        background: rgba(255, 255, 255, 0.15);
      }
    </style>
    <div class="otter-up-header">
      <div class="otter-up-title">
        <span>🦦</span>
        <span>${t("update_title")}</span>
        <span class="otter-up-badge">v${escapeHtml(data.version)}</span>
      </div>
      <button class="otter-up-close" id="otter-up-btn-close" title="${t("update_close")}">✕</button>
    </div>
    <div class="otter-up-desc">
      ${escapeHtml(data.changelog || t("update_default_changelog"))}
      <div style="font-size:11px; color:#94a3b8; margin-top:4px;">${t("update_current_version", { version: escapeHtml(currentVersion) })}</div>
    </div>
    <div class="otter-up-actions">
      <a href="${escapeHtml(data.download_url || "https://otter.gpt.io.vn/otter-extension.zip")}" target="_blank" download class="otter-up-btn-primary" id="otter-up-btn-download">
        <span>⚡</span> <span>${t("update_download")}</span>
      </a>
      <button class="otter-up-btn-secondary" id="otter-up-btn-snooze">${t("update_snooze")}</button>
    </div>
  `;

  document.body.appendChild(banner);

  // Gắn sự kiện Đóng
  document.getElementById("otter-up-btn-close")?.addEventListener("click", () => {
    banner.remove();
  });

  // Gắn sự kiện "Nhắc lại sau" (Snooze 24h)
  document.getElementById("otter-up-btn-snooze")?.addEventListener("click", async () => {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        await chrome.storage.local.set({
          otter_update_snooze: Date.now() + 24 * 60 * 60 * 1000 // 24 giờ
        });
      }
    } catch {}
    banner.remove();
  });
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
