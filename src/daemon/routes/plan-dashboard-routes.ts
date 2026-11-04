/**
 * Plan Dashboard — HTTP API + HTML page for the continuous-coding loop.
 *
 * Follows the existing route pattern: `handlePlanDashboardRoutes(req, url, db?)`
 * returns a Response or null, and is wired into the daemon's fetch chain in
 * index.ts (after the auth check, like every other route, so a configured
 * OTTER_API_KEY still protects it).
 *
 * Endpoints (all JSON except the page itself):
 * - GET  /plan-dashboard              HTML page, polls the API every 5s
 * - GET  /api/plans                   list plans with task counts
 * - GET  /api/plans/:id               full status + outbox for one plan
 * - GET  /api/plans/:id/resume-prompt resume prompt for one plan
 * - POST /api/plans/:id/pause
 * - POST /api/plans/:id/resume
 * - POST /api/plans/:id/cancel
 *
 * No external JS/CSS dependencies: the page is one self-contained HTML
 * document so it works from the daemon alone, with no build step.
 */
import { jsonResponse, errorResponse, getCorsHeaders } from "./common";
import { getDatabase } from "../db";
import {
  cancelPlan,
  getPlanStatus,
  listPlans,
  pausePlan,
  resumePlan,
} from "../plan";
import { buildResumePrompt, listPendingInjections } from "../continuous-loop";

type DbLike = ReturnType<typeof getDatabase>;

function dbQueueCounts(db: DbLike): { queued: number; running: number } {
  try {
    const rows = db.query("SELECT status, COUNT(*) AS n FROM tasks WHERE status IN ('pending', 'running') GROUP BY status").all() as { status: string; n: number }[];
    let queued = 0;
    let running = 0;
    for (const row of rows) {
      if (row.status === "pending") queued = Number(row.n);
      if (row.status === "running") running = Number(row.n);
    }
    return { queued, running };
  } catch {
    return { queued: 0, running: 0 };
  }
}

function planDetail(db: DbLike, planId: string) {
  const view = getPlanStatus(db as any, planId);
  const outbox = listPendingInjections(db as any).filter((e) => e.planId === planId);
  return {
    plan: view.plan,
    tasks: view.tasks,
    counts: view.counts,
    currentTask: view.currentTask,
    nextTask: view.nextTask,
    lastHeartbeatAt: view.lastHeartbeatAt,
    outbox: outbox.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      attemptCount: e.attemptCount,
      createdAt: e.createdAt,
      textPreview: e.text.slice(0, 300),
    })),
    queue: dbQueueCounts(db),
  };
}

export async function handlePlanDashboardRoutes(req: Request, url: URL, db?: DbLike): Promise<Response | null> {
  const database = db ?? getDatabase();
  const path = url.pathname;

  if (path === "/plan-dashboard" && req.method === "GET") {
    return new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...getCorsHeaders(req) },
    });
  }

  if (path === "/api/plans" && req.method === "GET") {
    try {
      const status = url.searchParams.get("status") as any;
      const plans = listPlans(database as any, status || undefined);
      return jsonResponse({ plans, queue: dbQueueCounts(database) }, 200, {}, req);
    } catch (err: any) {
      return errorResponse(err.message, 500, req);
    }
  }

  const match = path.match(/^\/api\/plans\/([^/]+)(?:\/(pause|resume|cancel|resume-prompt))?$/);
  if (match) {
    const planId = decodeURIComponent(match[1]);
    const action = match[2];
    try {
      if (action === "resume-prompt" && req.method === "GET") {
        const view = getPlanStatus(database as any, planId);
        return jsonResponse({ planId, prompt: buildResumePrompt(view) }, 200, {}, req);
      }
      if (action === "pause" && req.method === "POST") {
        return jsonResponse({ plan: pausePlan(database as any, planId) }, 200, {}, req);
      }
      if (action === "resume" && req.method === "POST") {
        return jsonResponse({ plan: resumePlan(database as any, planId) }, 200, {}, req);
      }
      if (action === "cancel" && req.method === "POST") {
        return jsonResponse({ plan: cancelPlan(database as any, planId) }, 200, {}, req);
      }
      if (!action && req.method === "GET") {
        return jsonResponse(planDetail(database, planId), 200, {}, req);
      }
    } catch (err: any) {
      const isNotFound = /Unknown planId/.test(err.message);
      return errorResponse(err.message, isNotFound ? 404 : 400, req);
    }
  }

  return null;
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Otter — Plan Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; color: #111; }
  h1 { font-size: 22px; }
  .muted { color: #666; font-size: 13px; }
  .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px 16px; margin: 12px 0; cursor: pointer; }
  .card.active { border-color: #2563eb; box-shadow: 0 0 0 2px #dbeafe; }
  .bar { height: 10px; background: #eee; border-radius: 5px; overflow: hidden; margin: 8px 0; }
  .bar > div { height: 100%; background: #22c55e; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eee; }
  .ok { color: #15803d; } .bad { color: #b91c1c; } .warn { color: #b45309; }
  button { padding: 6px 12px; margin-right: 8px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
  button:hover { background: #f3f4f6; }
  button.danger { border-color: #fca5a5; color: #b91c1c; }
  pre { white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 8px; font-size: 13px; }
  #error { color: #b91c1c; }
</style>
</head>
<body>
<h1>🔄 Otter — Plan Dashboard</h1>
<p class="muted">Tự làm mới mỗi 5 giây. Daemon: <span id="daemon"></span> · Queue: <span id="queue"></span></p>
<p><label><input type="checkbox" id="auto" checked> Tự làm mới</label> <button id="refresh">Làm mới ngay</button></p>
<p id="error"></p>
<h2>Plans</h2>
<div id="plans"></div>
<div id="detail"></div>
<script>
  let selected = null;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtTime = (ms) => ms ? new Date(ms).toLocaleString('vi-VN') : '—';
  const statusLabel = (s) => ({pending:'⏳ pending', running:'▶️ running', success:'✅ success', failed:'❌ failed', blocked:'⚠️ blocked', skipped:'⏭️ skipped'}[s] || s);

  async function api(path, method) {
    const res = await fetch(path, { method: method || 'GET' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function loadPlans() {
    const data = await api('/api/plans');
    $('daemon').textContent = location.host;
    $('queue').textContent = 'pending=' + data.queue.queued + ', running=' + data.queue.running;
    $('plans').innerHTML = data.plans.length === 0
      ? '<p class="muted">Chưa có plan nào. Tạo plan bằng MCP tool plan_create rồi quay lại đây.</p>'
      : data.plans.map((p) => {
          const total = p.taskTotal || 0;
          const done = (p.taskCounts.success || 0) + (p.taskCounts.skipped || 0);
          const pct = total ? Math.round(done / total * 100) : 0;
          return '<div class="card' + (selected === p.id ? ' active' : '') + '" data-id="' + esc(p.id) + '">'
            + '<b>' + esc(p.goal) + '</b> <span class="muted">' + esc(p.status) + ' · ' + esc(p.id) + '</span>'
            + '<div class="bar"><div style="width:' + pct + '%"></div></div>'
            + '<span class="muted">' + done + '/' + total + ' task xong (' + pct + '%) · ✅ ' + (p.taskCounts.success || 0)
            + ' · ❌ ' + (p.taskCounts.failed || 0) + ' · ⚠️ ' + (p.taskCounts.blocked || 0) + ' · ⏳ ' + (p.taskCounts.pending || 0) + '</span></div>';
        }).join('');
    document.querySelectorAll('#plans .card').forEach((el) => {
      el.addEventListener('click', () => { selected = el.dataset.id; loadDetail(); loadPlans(); });
    });
    if (selected && !data.plans.some((p) => p.id === selected)) selected = null;
  }

  async function loadDetail() {
    if (!selected) { $('detail').innerHTML = ''; return; }
    const d = await api('/api/plans/' + encodeURIComponent(selected));
    const rows = d.tasks.map((t) => '<tr><td>' + (t.orderIndex + 1) + '</td><td>' + esc(t.goal)
      + (t.details ? '<br><span class="muted">' + esc(t.details) + '</span>' : '')
      + '</td><td>' + statusLabel(t.status) + '</td><td>' + t.attemptCount + '/' + t.maxAttempts
      + '</td><td>' + fmtTime(t.lastHeartbeatAt) + '</td></tr>').join('');
    const outbox = d.outbox.length === 0 ? '<p class="muted">Không có prompt nào kẹt trong outbox.</p>'
      : d.outbox.map((o) => '<pre>' + esc(o.textPreview) + ' (thử ' + o.attemptCount + ' lần, lúc ' + fmtTime(o.createdAt) + ')</pre>').join('');
    $('detail').innerHTML = '<h2>Chi tiết plan</h2>'
      + '<p><b>' + esc(d.plan.goal) + '</b> · trạng thái: ' + esc(d.plan.status)
      + ' · task đang chạy: ' + esc(d.currentTask ? d.currentTask.goal : '—')
      + ' · task tiếp theo: ' + esc(d.nextTask ? d.nextTask.goal : '—')
      + ' · heartbeat cuối: ' + fmtTime(d.lastHeartbeatAt) + '</p>'
      + '<p><button id="btnPause">Tạm dừng</button><button id="btnResume">Chạy tiếp</button>'
      + '<button id="btnCancel" class="danger">Hủy plan</button><button id="btnResumePrompt">Copy resume prompt</button></p>'
      + '<table><tr><th>#</th><th>Task</th><th>Trạng thái</th><th>Lần thử</th><th>Heartbeat</th></tr>' + rows + '</table>'
      + '<h3>Outbox đang chờ gửi vào ChatGPT Web</h3>' + outbox
      + '<pre id="resumePrompt" style="display:none"></pre>';
    $('btnPause').onclick = () => doAction('pause');
    $('btnResume').onclick = () => doAction('resume');
    $('btnCancel').onclick = () => { if (confirm('Hủy plan này? Không thể hoàn tác.')) doAction('cancel'); };
    $('btnResumePrompt').onclick = async () => {
      const r = await api('/api/plans/' + encodeURIComponent(selected) + '/resume-prompt');
      const el = $('resumePrompt');
      el.style.display = 'block';
      el.textContent = r.prompt;
      try { await navigator.clipboard.writeText(r.prompt); } catch {}
    };
  }

  async function doAction(action) {
    try {
      await api('/api/plans/' + encodeURIComponent(selected) + '/' + action, 'POST');
      $('error').textContent = '';
      await loadPlans(); await loadDetail();
    } catch (e) { $('error').textContent = e.message; }
  }

  async function tick() {
    try { await loadPlans(); if (selected) await loadDetail(); $('error').textContent = ''; }
    catch (e) { $('error').textContent = 'Không kết nối được daemon: ' + e.message; }
  }
  $('refresh').onclick = tick;
  setInterval(() => { if ($('auto').checked) tick(); }, 5000);
  tick();
</script>
</body>
</html>`;
