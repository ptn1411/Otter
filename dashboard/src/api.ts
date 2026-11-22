/**
 * Lớp gọi API của Otter daemon cho Dashboard.
 *
 * Xác thực: daemon miễn trừ mạng tin cậy (localhost/LAN/Tailscale) khi chưa đặt
 * OTTER_API_KEY; truy cập từ Internet qua tunnel cần token. Dashboard nhận token
 * qua tham số ?token= trên URL, lưu vào sessionStorage và gửi kèm mọi request.
 */

const TOKEN_KEY = "otter_dashboard_token";

export function initTokenFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const t = params.get("token");
  if (t) {
    sessionStorage.setItem(TOKEN_KEY, t);
    params.delete("token");
    const q = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (q ? `?${q}` : "") + window.location.hash
    );
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers || {}) } });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = String(data.error);
      else if (data?.message) msg = String(data.message);
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const apiGet = <T = any>(path: string) => api<T>(path);
export const apiPost = <T = any>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const apiDelete = <T = any>(path: string) => api<T>(path, { method: "DELETE" });

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);
}

export function fmtUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}

export function fmtDate(ts: number | string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString("vi-VN");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* ── Kiểu dữ liệu theo API daemon ─────────────────────────────── */

export interface HealthInfo {
  status: string;
  service: string;
  version: string;
  platform: string;
  uptime: number;
  port: number;
  tailscaleIp: string | null;
  tunnelStatus: string;
  socialBotConnected: boolean;
  externalMcpServers: { total: number; connected: number };
}

export interface TunnelInfo {
  status: string;
  url: string | null;
  mcpUrl: string | null;
  sseUrl: string | null;
  error: string | null;
}

export interface LicenseInfo {
  licensed: boolean;
  reason?: string;
  payload?: {
    license_type?: string;
    tier?: string;
    package?: string;
    expires_at?: string;
    customer?: string;
    email?: string;
  } | null;
  supportCode: string;
  isLeased?: boolean;
  isGracePeriod?: boolean;
}

export interface ToolGroupInfo {
  id: string;
  nameVi: string;
  nameEn: string;
  descVi: string;
  descEn: string;
  toolCount: number;
  estTokens: number;
  enabled: boolean;
  liveToolCount: number;
}

export interface ToolGroupsResponse {
  groups: ToolGroupInfo[];
  totalTools: number;
  enabledTools: number;
  totalEstTokens: number;
  enabledEstTokens: number;
  liveSessions: number;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  mandatory: boolean;
  downloadUrl: string | null;
  sha256: string | null;
  changelog: string | null;
  lastCheckedAt: string | null;
  autoUpdateEnabled: boolean;
  isCompiledBinary: boolean;
  lastError: string | null;
}

export interface OAuthClientInfo {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
  activeTokens: number;
  lastIssuedAt: number | null;
}

export interface ExternalMcpServer {
  name: string;
  status: string;
  toolsCount: number;
  url?: string;
  error?: string;
}

export interface CustomCommandItem {
  id: string;
  icon?: string;
  slash: string;
  title: string;
  description?: string;
  promptTemplate: string;
  isPinned?: boolean;
}

export interface OtterSettings {
  browserEngine: "cdp" | "auto" | "extension";
  cdpHeadless: boolean;
  cdpHud: boolean;
  cdpAutoClose: boolean;
  cdpPort: number;
  browserPath: string;
  userDataDir: string;
  fullAccess: boolean;
  strictWorkspace: boolean;
  autoTunnel: boolean;
  apiKey: string;
  gpmApiPort: number;
  antigravityBin: string;
}

export interface BrowserEngineInfo {
  mode: "cdp" | "auto" | "extension";
  activeEngine?: "extension" | "cdp" | "none";
  extension?: { connected: boolean; socketsCount: number };
  cdp?: { available: boolean; port: number };
  headless?: boolean;
  hud?: boolean;
  autoClose?: boolean;
  port?: number;
  browserPath?: string;
  userDataDir?: string;
  benchmark?: {
    extension?: { latencyMs: number };
    cdp?: { latencyMs: number };
    recommendation?: string;
  };
}

export interface ChromeProfileItem {
  name: string;
  directory: string;
}

export interface GpmStatusInfo {
  gpmLogin: boolean;
  gpmAutomate: boolean;
}

export interface GpmProfileItem {
  id: string;
  name: string;
  raw_proxy?: string;
  is_running?: boolean;
  remote_debugging_port?: number;
}

export interface PlanSummary {
  id: string;
  goal: string;
  status: string;
  taskTotal?: number;
  taskCounts?: {
    success?: number;
    skipped?: number;
    failed?: number;
    blocked?: number;
    pending?: number;
  };
}

export interface PlanDetail {
  currentTask?: { goal: string } | null;
  nextTask?: { goal: string } | null;
  tasks?: Array<{ goal: string; status: string; attemptCount: number; maxAttempts: number }>;
  outbox?: Array<{ textPreview: string; attemptCount: number }>;
}

export interface PageLoopItem {
  id: string;
  status: string;
  mode: string;
  turnCount: number;
  maxTurns: number;
  epoch: number;
  goal: string;
  blockedReason?: string;
}

export interface FleetNodeItem {
  nodeId: string;
  name: string;
  status: string;
  apiBase: string;
  projects?: string[];
}

export interface FleetDispatchItem {
  dispatchId: string;
  nodeId: string;
  status: string;
  goal: string;
}

export interface SkillItem {
  name: string;
  description?: string;
}

export interface ScheduledTaskItem {
  id: string;
  title: string;
  prompt: string;
  status: string;
  scheduled_at: number | string;
  completed_at?: number | string | null;
  repeat_minutes?: number;
  chat_url?: string | null;
  response_text?: string | null;
  screenshot_path?: string | null;
  error_message?: string | null;
}

export interface FbSalesStage {
  stage: string;
  name: string;
  goal: string;
  templates: string[];
}

export interface FbSalesIntent {
  intentKey: string;
  name: string;
  description?: string;
  keywords: string[];
  nextStage: string;
  replyTemplate: string;
}

export interface FbSalesCommentCat {
  category: string;
  name: string;
  templates: string[];
}

export interface FbListenerStatus {
  active: boolean;
  replyCount?: number;
  lastRepliedTo?: string | null;
}
