/**
 * Doctor + drain — Phase 4 của plan nâng cấp từ codex-web.
 * Logic thuần: caller (route) thu thập facts, hàm này chỉ đánh giá.
 * Không trả secret, không trả token, không trả nội dung hội thoại.
 */
import * as fs from "node:fs";

export interface DoctorFact {
  dbOk: boolean;
  activeLoops: number;
  pendingOutbox: number;
  activeLeases: number;
  staleLeases: number;
  connectedTabs: number;
  chromePath: string | null;
  browserPath: string | null;
  fleetNodesOnline: number | null; // null = không phải hub / không có fleet
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export function runDoctor(facts: DoctorFact): { ok: boolean; checks: DoctorCheck[] } {
  const checks: DoctorCheck[] = [
    { name: "database", ok: facts.dbOk, detail: facts.dbOk ? "DB đọc/ghi được." : "DB không đọc/ghi được." },
    { name: "page_loops_active", ok: true, detail: `${facts.activeLoops} phiên page-loop đang chạy.` },
    { name: "outbox_pending", ok: true, detail: `${facts.pendingOutbox} prompt đang chờ trong outbox.` },
    { name: "leases", ok: true, detail: `${facts.activeLeases} lease đang chạy, ${facts.staleLeases} lease stale.` },
    { name: "extension_tabs", ok: true, detail: `${facts.connectedTabs} tab extension đang nối WS.` },
    { name: "chrome_path", ok: !facts.chromePath || fs.existsSync(facts.chromePath), detail: facts.chromePath ? (fs.existsSync(facts.chromePath) ? `Chrome path tồn tại: ${facts.chromePath}` : `Chrome path KHÔNG tồn tại: ${facts.chromePath}`) : "Không đặt OTTER_CHROME_PATH (dùng Chrome mặc định nếu có)." },
    { name: "browser_path", ok: !facts.browserPath || fs.existsSync(facts.browserPath), detail: facts.browserPath ? (fs.existsSync(facts.browserPath) ? `Browser path tồn tại: ${facts.browserPath}` : `Browser path KHÔNG tồn tại: ${facts.browserPath}`) : "Không đặt OTTER_BROWSER_PATH." },
  ];
  if (facts.fleetNodesOnline !== null) {
    checks.push({ name: "fleet_nodes_online", ok: true, detail: `${facts.fleetNodesOnline} node fleet online theo heartbeat gần nhất.` });
  }
  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

export interface DrainState {
  activeLoops: number;
  pendingOutboxForActiveLoops: number;
}

/** Chỉ cho dừng/restart khi cả 2 counter về 0. */
export function canDrain(state: DrainState): { can: boolean; reason: string } {
  if (state.activeLoops > 0) return { can: false, reason: `Còn ${state.activeLoops} phiên page-loop đang chạy (waiting/settling/deciding/injecting).` };
  if (state.pendingOutboxForActiveLoops > 0) return { can: false, reason: `Còn ${state.pendingOutboxForActiveLoops} prompt outbox chưa gửi xong cho các phiên đang chạy.` };
  return { can: true, reason: "Không còn phiên đang chạy, không còn outbox chờ — có thể dừng/restart." };
}
