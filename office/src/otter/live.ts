import { useCallback, useEffect, useRef, useState } from "react"

export type OtterGroup = {
  id: string
  name: string
  tokens: number
  toolCount: number
  enabled: boolean
}

export type OtterBot = {
  botId: string
  name: string
  description: string
  capabilities: string[]
  preferredNode: string | null
  status: "online" | "busy" | "idle" | "offline" | string
  lastSeenAt: string | number | null
}

export type OtterA2a = {
  queued: number
  inFlight: number
  acked: number
  failed: number
  total: number
}

export type OtterInboxItem = {
  id: string
  sender: string
  recipient: string
  status: string
  type: string
  priority: number
  goal: string
  details: string | null
  resultSummary: string | null
  createdAt: number
  updatedAt: number
}

export type OtterLive = {
  ok: boolean
  loading: boolean
  error: string | null
  base: string
  version: string
  uptime: number
  tokens: number
  totalTokens: number
  tools: number
  totalTools: number
  sessions: number
  groups: OtterGroup[]
  bots: OtterBot[]
  a2a: OtterA2a | null
  inbox: OtterInboxItem[]
}

const EMPTY: OtterLive = {
  ok: false,
  loading: true,
  error: null,
  base: "",
  version: "",
  uptime: 0,
  tokens: 0,
  totalTokens: 0,
  tools: 0,
  totalTools: 0,
  sessions: 0,
  groups: [],
  bots: [],
  a2a: null,
  inbox: [],
}

const TOKEN_KEY = "otter_dashboard_token"

export function resolveToken(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get("token")
    if (fromUrl) {
      sessionStorage.setItem(TOKEN_KEY, fromUrl)
      params.delete("token")
      const q = params.toString()
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (q ? `?${q}` : "") + window.location.hash,
      )
      return fromUrl
    }
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function candidateBases(): string[] {
  if (location.pathname.startsWith("/dashboard/phong")) {
    return [location.origin, `${location.origin}/otter`]
  }
  return [`${location.origin}/otter`, `http://${location.hostname}:1993`]
}

async function fetchJson(url: string, init?: RequestInit) {
  const headers: Record<string, string> = {}
  const token = resolveToken()
  if (token) headers["Authorization"] = `Bearer ${token}`
  if (init?.body) headers["Content-Type"] = "application/json"
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  })
  if (!response.ok) throw new Error(String(response.status))
  return response.json() as Promise<Record<string, unknown>>
}

const INBOX_RANK: Record<string, number> = {
  in_flight: 0,
  leased: 0,
  working: 0,
  queued: 1,
  failed: 2,
  acked: 3,
  completed: 4,
  cancelled: 5,
  canceled: 5,
}

export function formatUptime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function inboxStatusLabel(status: string) {
  if (status === "queued") return "Chờ kéo"
  if (status === "in_flight" || status === "leased" || status === "working") return "Đang làm"
  if (status === "acked") return "Đã ack"
  if (status === "completed") return "Hoàn tất"
  if (status === "failed") return "Lỗi"
  if (status === "cancelled" || status === "canceled") return "Đã hủy"
  return status
}

export function inboxTypeLabel(type: string) {
  if (type === "task") return "Tác vụ"
  if (type === "message") return "Tin nhắn"
  if (type === "query") return "Tra cứu"
  if (type === "ack") return "Xác nhận"
  return "Tin"
}

export function statusLabel(status: string) {
  if (status === "online") return "Trực tuyến"
  if (status === "busy") return "Đang bận"
  if (status === "idle") return "Đang rảnh"
  if (status === "offline") return "Ngoại tuyến"
  return status
}

async function pull(base: string): Promise<OtterLive> {
  const [health, groups, stats, bots, messages] = await Promise.all([
    fetchJson(`${base}/api/health`),
    fetchJson(`${base}/api/tool-groups`),
    fetchJson(`${base}/api/a2a/stats`),
    fetchJson(`${base}/api/a2a/bots`),
    fetchJson(`${base}/api/a2a/messages?limit=40`),
  ])
  const rawGroups = Array.isArray(groups.groups) ? groups.groups : []
  const rawBots = Array.isArray(bots.bots) ? bots.bots : []
  const rawMessages = Array.isArray(messages.messages) ? messages.messages : []
  const a2a = (stats.stats ?? null) as OtterA2a | null
  const inbox: OtterInboxItem[] = rawMessages
    .map((item) => {
      const m = item as Record<string, unknown>
      const goal = String(m.goal ?? "").replace(/\s+/g, " ").trim()
      return {
        id: String(m.id ?? ""),
        sender: String(m.senderId ?? ""),
        recipient: String(m.recipientId ?? ""),
        status: String(m.status ?? ""),
        type: String(m.messageType ?? "task"),
        priority: Number(m.priority ?? 0),
        goal: goal.length > 160 ? `${goal.slice(0, 159)}…` : goal,
        details: m.details ? String(m.details) : null,
        resultSummary: m.resultSummary ? String(m.resultSummary) : null,
        createdAt: Number(m.createdAt ?? 0),
        updatedAt: Number(m.updatedAt ?? 0),
      }
    })
    .filter((item) => item.id && item.goal)
    .sort((a, b) => (INBOX_RANK[a.status] ?? 9) - (INBOX_RANK[b.status] ?? 9) || b.updatedAt - a.updatedAt)

  return {
    ok: true,
    loading: false,
    error: null,
    base,
    version: String(health.version ?? ""),
    uptime: Number(health.uptime ?? 0),
    tokens: Number(groups.enabledEstTokens ?? 0),
    totalTokens: Number(groups.totalEstTokens ?? 0),
    tools: Number(groups.enabledTools ?? 0),
    totalTools: Number(groups.totalTools ?? 0),
    sessions: Number(groups.liveSessions ?? 0),
    groups: rawGroups.map((item) => {
      const g = item as Record<string, unknown>
      return {
        id: String(g.id ?? ""),
        name: String(g.nameVi ?? g.nameEn ?? g.id ?? ""),
        tokens: Number(g.estTokens ?? 0),
        toolCount: Number(g.toolCount ?? 0),
        enabled: Boolean(g.enabled),
      }
    }),
    bots: rawBots.map((item) => {
      const b = item as Record<string, unknown>
      return {
        botId: String(b.botId ?? ""),
        name: String(b.name ?? b.botId ?? ""),
        description: String(b.description ?? ""),
        capabilities: Array.isArray(b.capabilities) ? b.capabilities.map(String) : [],
        preferredNode: b.preferredNode ? String(b.preferredNode) : null,
        status: String(b.status ?? "offline"),
        lastSeenAt: (b.lastSeenAt as string | number | null) ?? null,
      }
    }),
    a2a,
    inbox,
  }
}

export async function sendA2aTask(
  base: string,
  params: {
    senderId: string
    recipientId: string
    goal: string
    messageType?: "task" | "message" | "query"
    priority?: number
  },
): Promise<{ ok: boolean; error?: string }> {
  const resolvedBase = base || candidateBases()[0]
  try {
    const res = await fetchJson(`${resolvedBase}/api/a2a/send`, {
      method: "POST",
      body: JSON.stringify({
        senderId: params.senderId,
        recipientId: params.recipientId,
        goal: params.goal,
        messageType: params.messageType ?? "task",
        priority: params.priority ?? 1,
      }),
    })
    return { ok: Boolean(res.ok), error: res.error ? String(res.error) : undefined }
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown"
    return {
      ok: false,
      error: code === "401" ? "Cần Auth Token để gửi lệnh A2A" : `Gửi A2A thất bại (${code})`,
    }
  }
}

export async function cancelA2aTask(base: string, messageId: string): Promise<{ ok: boolean; error?: string }> {
  const resolvedBase = base || candidateBases()[0]
  try {
    const res = await fetchJson(`${resolvedBase}/api/a2a/cancel`, {
      method: "POST",
      body: JSON.stringify({ messageId, reason: "Hủy từ Phòng ban 3D" }),
    })
    return { ok: Boolean(res.ok), error: res.error ? String(res.error) : undefined }
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown"
    return { ok: false, error: `Không hủy được (${code})` }
  }
}

export async function createA2aBot(
  base: string,
  params: {
    botId: string
    name: string
    description?: string
    capabilities?: string[]
    preferredNode?: string
    status?: "online" | "busy" | "idle" | "offline"
  },
): Promise<{ ok: boolean; error?: string }> {
  const resolvedBase = base || candidateBases()[0]
  try {
    const res = await fetchJson(`${resolvedBase}/api/a2a/bots`, {
      method: "POST",
      body: JSON.stringify({
        botId: params.botId,
        name: params.name,
        description: params.description ?? "",
        capabilities: params.capabilities ?? ["agent"],
        preferredNode: params.preferredNode || "nam-windows",
        status: params.status ?? "online",
      }),
    })
    return { ok: Boolean(res.ok), error: res.error ? String(res.error) : undefined }
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown"
    return { ok: false, error: code === "401" ? "Cần Auth Token để thêm Agent" : `Thêm Agent thất bại (${code})` }
  }
}

export async function deleteA2aBot(base: string, botId: string): Promise<{ ok: boolean; error?: string }> {
  const resolvedBase = base || candidateBases()[0]
  try {
    const res = await fetchJson(`${resolvedBase}/api/a2a/bots/${encodeURIComponent(botId)}`, {
      method: "DELETE",
    })
    return { ok: Boolean(res.ok), error: res.error ? String(res.error) : undefined }
  } catch (err) {
    const code = err instanceof Error ? err.message : "unknown"
    return { ok: false, error: `Xóa Agent thất bại (${code})` }
  }
}

export function useOtterLive() {
  const [live, setLive] = useState<OtterLive>(EMPTY)
  const mountedRef = useRef(true)

  const refresh = useCallback(async () => {
    const bases = candidateBases()
    let saw401 = false
    for (const base of bases) {
      try {
        const next = await pull(base)
        if (mountedRef.current) setLive(next)
        return
      } catch (err) {
        if (err instanceof Error && err.message === "401") saw401 = true
      }
    }
    if (mountedRef.current) {
      const error = saw401 ? "Cần Auth Token để kết nối Otter" : "Otter chưa phản hồi"
      setLive((current) =>
        current.ok
          ? { ...current, loading: false, error }
          : { ...EMPTY, loading: false, error },
      )
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    const boot = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, 4000)
    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      mountedRef.current = false
      window.clearTimeout(boot)
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [refresh])

  return { live, refresh }
}
