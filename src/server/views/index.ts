import * as fs from "node:fs";
import * as path from "node:path";
import type { Database } from "bun:sqlite";
import { getLcgRoute } from "../../daemon/license/lcg-router";

// Đọc và cache template HTML
let cachedLoginHtml: string | null = null;
let cachedDashboardHtml: string | null = null;

function getViewsDir(): string {
  return path.join(import.meta.dir);
}

/**
 * Hàm mã hóa ký tự HTML an toàn chống XSS tuyệt đối
 */
export function escapeHtml(str: any): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render trang Đăng nhập Quản Trị Viên (Google Firebase & Master Key)
 */
export function renderAdminLoginPage(): string {
  if (!cachedLoginHtml || process.env.NODE_ENV !== "production") {
    const file = path.join(getViewsDir(), "login.html");
    cachedLoginHtml = fs.readFileSync(file, "utf-8");
  }
  return cachedLoginHtml;
}

/**
 * Render Bảng Điều Khiển Quản Trị Toàn Quyền
 */
export function renderAdminDashboard(db: Database, port: number, adminUser: string = "Admin Master"): string {
  if (!cachedDashboardHtml || process.env.NODE_ENV !== "production") {
    const file = path.join(getViewsDir(), "dashboard.html");
    cachedDashboardHtml = fs.readFileSync(file, "utf-8");
  }

  const totalLicenses = (db.query("SELECT COUNT(*) as c FROM licenses").get() as any)?.c || 0;
  const activeLicenses = (db.query("SELECT COUNT(*) as c FROM licenses WHERE status = 'active'").get() as any)?.c || 0;
  const totalActivations = (db.query("SELECT COUNT(*) as c FROM activations").get() as any)?.c || 0;
  const totalTrials = (db.query("SELECT COUNT(*) as c FROM trial_claims").get() as any)?.c || 0;
  const pendingOrdersCount = (db.query("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get() as any)?.c || 0;
  let totalAffOrders = 0;
  try {
    totalAffOrders = (db.query("SELECT COUNT(*) as c FROM orders WHERE aff_code IS NOT NULL AND aff_code != ''").get() as any)?.c || 0;
  } catch {}
  
  const recentLicenses = db.query("SELECT * FROM licenses ORDER BY rowid DESC LIMIT 15").all() as any[];
  const recentOrders = db.query("SELECT * FROM orders ORDER BY rowid DESC LIMIT 30").all() as any[];

  const orderRows = recentOrders.length === 0
    ? '<tr><td colspan="8" style="text-align:center; color:#64748b; padding:24px;">Hiện chưa có đơn hàng nào trong hệ thống</td></tr>'
    : recentOrders.map(o => `
      <tr id="order-row-${escapeHtml(o.id)}">
        <td>
          <small style="color:#94a3b8;">${escapeHtml(new Date(o.created_at).toLocaleString('vi-VN'))}</small><br>
          <code style="font-size:11px; color:#64748b;">#${escapeHtml(String(o.id).slice(0, 8))}</code>
        </td>
        <td>
          <strong>${escapeHtml(o.email)}</strong>
        </td>
        <td>
          ${o.aff_code
            ? `<span class="badge" style="background:rgba(244,63,94,0.15); color:#fb7185; border:1px solid rgba(244,63,94,0.4); font-weight:700;">🏷️ ${escapeHtml(o.aff_code)}</span>`
            : `<span style="color:#64748b; font-size:12px;">Trực tiếp</span>`
          }
        </td>
        <td>
          <span class="badge" style="background:#1e293b; color:#10b981;">${escapeHtml(o.package_title || o.package_type)}</span><br>
          <strong style="color:#f59e0b; font-size:12px;">${Number(o.amount).toLocaleString('vi-VN')} đ</strong>
        </td>
        <td>
          <code style="color:#38bdf8; font-weight:600;">${escapeHtml(o.memo)}</code>
        </td>
        <td>
          <div style="font-size:11px; line-height:1.4;">
            ${o.fp ? `<span>FP: <code style="color:#a78bfa;">${escapeHtml(String(o.fp).slice(0, 10))}...</code></span><br>` : ''}
            ${o.webrtc_ip ? `<span>WebRTC: <code>${escapeHtml(o.webrtc_ip)}</code></span><br>` : ''}
            <span style="color:#64748b;">IP: ${escapeHtml(o.client_ip || 'N/A')}</span>
          </div>
        </td>
        <td>
          <span class="badge ${o.status === 'approved' ? 'badge-active' : (o.status === 'pending' ? 'badge-pending' : 'badge-revoked')}">
            ${escapeHtml(String(o.status).toUpperCase())}
          </span>
          ${o.license_key ? `<br><code style="font-size:11px; color:#34d399;">${escapeHtml(o.license_key)}</code>` : ''}
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            ${o.status === 'pending' ? `
              <button class="btn-action btn-approve" onclick="approveOrder('${escapeHtml(o.id)}', '${escapeHtml(o.email)}', '${escapeHtml(o.package_type)}')">⚡ Duyệt</button>
            ` : ''}
            <button class="btn-action btn-delete" onclick="deleteOrder('${escapeHtml(o.id)}')">🗑️ Xóa</button>
          </div>
        </td>
      </tr>
    `).join('');

  const tableRows = recentLicenses.length === 0
    ? '<tr><td colspan="7" style="text-align:center; color:#64748b; padding:24px;">Chưa có license nào được cấp</td></tr>'
    : recentLicenses.map(l => `
      <tr id="license-row-${escapeHtml(l.license_key)}">
        <td><code>${escapeHtml(l.license_key)}</code></td>
        <td><strong>${escapeHtml(l.email)}</strong></td>
        <td><span class="badge" style="background:#1e293b; color:#38bdf8;">${escapeHtml(String(l.package_type).toUpperCase())}</span></td>
        <td>${Number(l.duration_days) > 0 ? Number(l.duration_days) + ' ngày' : 'Vĩnh viễn'}</td>
        <td>Tối đa ${Number(l.max_devices) || 1} máy</td>
        <td><span class="badge ${l.status === 'active' ? 'badge-active' : 'badge-revoked'}">${escapeHtml(String(l.status).toUpperCase())}</span></td>
        <td>
          <div style="display:flex; gap:6px;">
            ${l.status === 'active' ? `
              <button class="btn-action btn-delete" onclick="revokeLicense('${escapeHtml(l.license_key)}')">🚫 Thu Hồi</button>
            ` : `
              <button class="btn-action btn-approve" onclick="reactivateLicense('${escapeHtml(l.license_key)}')">♻️ Khôi Phục</button>
            `}
          </div>
        </td>
      </tr>
    `).join('');

  let versionsList: any[] = [];
  try {
    versionsList = db.query("SELECT * FROM app_versions").all() as any[];
  } catch {}
  const extVer = versionsList.find(v => v.component === 'extension')?.version || '2.0.0';
  const daemonVer = versionsList.find(v => v.component === 'daemon')?.version || '2.0.0';

  return cachedDashboardHtml
    .replace(/\{\{PORT\}\}/g, escapeHtml(String(port)))
    .replace(/\{\{ADMIN_USER\}\}/g, escapeHtml(adminUser))
    .replace(/\{\{EXT_VERSION\}\}/g, escapeHtml(extVer))
    .replace(/\{\{DAEMON_VERSION\}\}/g, escapeHtml(daemonVer))
    .replace(/\{\{TOTAL_LICENSES\}\}/g, escapeHtml(String(totalLicenses)))
    .replace(/\{\{ACTIVE_LICENSES\}\}/g, escapeHtml(String(activeLicenses)))
    .replace(/\{\{TOTAL_ACTIVATIONS\}\}/g, escapeHtml(String(totalActivations)))
    .replace(/\{\{TOTAL_TRIALS\}\}/g, escapeHtml(String(totalTrials)))
    .replace(/\{\{TOTAL_AFF_ORDERS\}\}/g, escapeHtml(String(totalAffOrders)))
    .replace(/\{\{PENDING_ORDERS_COUNT\}\}/g, escapeHtml(String(pendingOrdersCount)))
    .replace(/\{\{ORDER_ROWS\}\}/g, orderRows)
    .replace(/\{\{TABLE_ROWS\}\}/g, tableRows)
    .replace(/\{\{ROUTE_ISSUE\}\}/g, escapeHtml(getLcgRoute("ISSUE")))
    .replace(/\{\{ROUTE_ACTIVATE\}\}/g, escapeHtml(getLcgRoute("ACTIVATE")));
}
