import type { ServerConfig } from "../types";

const STORAGE_SERVERS_KEY = "activityServersV1";
const STORAGE_TAB_SERVERS_KEY = "activityTabServersV1";

export const DEFAULT_SERVERS: ServerConfig[] = [
  {
    id: "localhost",
    name: "Localhost (1993)",
    apiBase: "http://127.0.0.1:1993",
    local: true
  },
  {
    id: "otter-tunnel",
    name: "Cloudflare Tunnel (otter.gpt.io.vn)",
    apiBase: "https://otter.gpt.io.vn",
    local: false
  }
];

export async function getServers(): Promise<ServerConfig[]> {
  try {
    const data = await chrome.storage.local.get(STORAGE_SERVERS_KEY);
    const custom: ServerConfig[] = Array.isArray(data[STORAGE_SERVERS_KEY]) ? data[STORAGE_SERVERS_KEY] : [];
    const map = new Map<string, ServerConfig>();
    for (const s of DEFAULT_SERVERS) map.set(s.id, s);
    for (const s of custom) {
      if (s?.id && s?.apiBase) map.set(s.id, s);
    }
    return Array.from(map.values());
  } catch {
    return DEFAULT_SERVERS;
  }
}

export async function addServer(name: string, apiBase: string, apiKey?: string): Promise<ServerConfig> {
  const cleanBase = apiBase.replace(/\/+$/, "");
  const id = "server-" + Math.random().toString(36).slice(2, 10);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(cleanBase).hostname);
  const newServer: ServerConfig = {
    id,
    name: name.trim() || cleanBase,
    apiBase: cleanBase,
    local: isLocal,
    apiKey: apiKey ? apiKey.trim() : undefined
  };

  const servers = await getServers();
  servers.push(newServer);
  await chrome.storage.local.set({
    [STORAGE_SERVERS_KEY]: servers.filter(s => s.id !== "localhost" && s.id !== "otter-tunnel" && s.id !== "chatmcp-tunnel")
  });
  return newServer;
}

export async function updateServer(id: string, updates: Partial<ServerConfig>): Promise<void> {
  const servers = await getServers();
  const target = servers.find(s => s.id === id);
  if (target) {
    Object.assign(target, updates);
    await chrome.storage.local.set({
      [STORAGE_SERVERS_KEY]: servers.filter(s => s.id !== "localhost" && s.id !== "otter-tunnel" && s.id !== "chatmcp-tunnel")
    });
  }
}

/** Export chỉ các server tự thêm (không export 2 default) để mang sang
 *  máy/profile khác mà không lộ cấu hình mặc định. Token đi kèm trong
 *  file export — người dùng phải tự giữ file này như giữ mật khẩu, và
 *  chỉ import trên máy của chính mình. */
export async function exportServers(): Promise<{ version: 1; exportedAt: string; servers: ServerConfig[] }> {
  const data = await chrome.storage.local.get(STORAGE_SERVERS_KEY);
  const custom: ServerConfig[] = Array.isArray(data[STORAGE_SERVERS_KEY]) ? data[STORAGE_SERVERS_KEY] : [];
  return { version: 1, exportedAt: new Date().toISOString(), servers: custom.filter((s) => s?.id && s?.apiBase) };
}
export async function importServers(payload: any): Promise<{ imported: number; skipped: number }> {
  const incoming: any[] = Array.isArray(payload?.servers) ? payload.servers : Array.isArray(payload) ? payload : [];
  if (incoming.length === 0) throw new Error("File import không chứa server nào.");
  const existing = await getServers();
  const byBase = new Map(existing.map((s) => [s.apiBase, s]));
  let imported = 0; let skipped = 0;
  const toStore: ServerConfig[] = [];
  for (const raw of incoming) {
    if (!raw?.apiBase) { skipped++; continue; }
    try { new URL(raw.apiBase); } catch { skipped++; continue; }
    if (byBase.has(raw.apiBase)) { skipped++; continue; }
    const id = raw.id && !existing.some((s) => s.id === raw.id) ? raw.id : "server-" + Math.random().toString(36).slice(2, 10);
    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(raw.apiBase).hostname);
    toStore.push({ id, name: String(raw.name || raw.apiBase), apiBase: String(raw.apiBase).replace(/\/+$/, ""), local: isLocal, apiKey: raw.apiKey });
    imported++;
  }
  if (toStore.length > 0) {
    const data = await chrome.storage.local.get(STORAGE_SERVERS_KEY);
    const custom: ServerConfig[] = Array.isArray(data[STORAGE_SERVERS_KEY]) ? data[STORAGE_SERVERS_KEY] : [];
    await chrome.storage.local.set({ [STORAGE_SERVERS_KEY]: [...custom, ...toStore] });
  }
  return { imported, skipped };
}

export async function getTabServer(tabId: number): Promise<ServerConfig> {
  try {
    const data = await chrome.storage.session?.get(STORAGE_TAB_SERVERS_KEY);
    const tabMap = data?.[STORAGE_TAB_SERVERS_KEY] || {};
    const serverId = tabMap[tabId];
    if (serverId) {
      const all = await getServers();
      const found = all.find(s => s.id === serverId);
      if (found) return found;
    }
  } catch {}
  return DEFAULT_SERVERS[0];
}

export async function setTabServer(tabId: number, serverId: string): Promise<void> {
  try {
    const data = await chrome.storage.session?.get(STORAGE_TAB_SERVERS_KEY);
    const tabMap = data?.[STORAGE_TAB_SERVERS_KEY] || {};
    tabMap[tabId] = serverId;
    await chrome.storage.session?.set({ [STORAGE_TAB_SERVERS_KEY]: tabMap });
  } catch {}
}
