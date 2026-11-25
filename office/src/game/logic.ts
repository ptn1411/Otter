import type { OtterBot, OtterInboxItem, OtterLive } from "../otter/live"
import type {
  ChatLine,
  MemberLook,
  MemberStatus,
  OfficeMember,
  OfficeState,
  TabId,
  Toast,
  Trip,
  WorkPhase,
} from "./types"

let seq = 1
function uid(prefix: string) {
  seq += 1
  return `${prefix}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function formatTokens(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString("en-US")
}

export function formatTime(ts: number) {
  const d = new Date(ts || Date.now())
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function plainName(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
}

type MemberPreset = {
  botId: string
  name: string
  shortName: string
  role: string
  node: string
  description: string
  capabilities: string[]
  desk: number
  color: string
  look: MemberLook
}

// 5 thành viên chuẩn khớp 1-1 với a2a-inbox.ts của Otter
export const DEFAULT_PRESETS: MemberPreset[] = [
  {
    botId: "user_pham",
    name: "Phạm Thành Nam",
    shortName: "Phạm",
    role: "Chủ dự án · Vận hành",
    node: "nam-windows",
    description: "Điều hành chung, duyệt kế hoạch và giao tác vụ cho đội AI Otter.",
    capabilities: ["admin", "decision", "supervisor"],
    desk: 0,
    color: "#10B981",
    look: {
      hair: "#1E1B18",
      style: "sidepart",
      eye: "#3A2D24",
      skin: "#ECC2A3",
      outfit: "jacket",
      shirt: "#1E3A5F",
      inner: "#E2E8F0",
      pants: "#1E293B",
      glasses: false,
      headphones: false,
      prop: "coffee",
    },
  },
  {
    botId: "ai_sunny",
    name: "Sunny (Muse)",
    shortName: "Sunny",
    role: "Điều phối & Kiến trúc",
    node: "nam-linux",
    description: "Lập kế hoạch, phân rã tác vụ, điều phối A2A và review sản phẩm.",
    capabilities: ["planning", "coordination", "video", "review"],
    desk: 1,
    color: "#F59E0B",
    look: {
      hair: "#5C3629",
      style: "bob",
      eye: "#5A3825",
      skin: "#F4CEB4",
      outfit: "cardigan",
      shirt: "#D97706",
      inner: "#FEF3C7",
      pants: "#334155",
      glasses: false,
      headphones: false,
      prop: "tablet",
    },
  },
  {
    botId: "ai_antigravity",
    name: "Antigravity (Anti)",
    shortName: "Antigravity",
    role: "Code, CDP & CUA",
    node: "nam-windows",
    description: "Kỹ sư lập trình, tự động hóa hệ thống, Chrome CDP, CUA và MCP.",
    capabilities: ["code", "terminal", "cdp", "cua", "mcp"],
    desk: 2,
    color: "#22C55E",
    look: {
      hair: "#23272F",
      style: "swept",
      eye: "#1F5B48",
      skin: "#EFC6A8",
      outfit: "hoodie",
      shirt: "#166534",
      inner: "#0F172A",
      pants: "#1E293B",
      glasses: true,
      headphones: false,
      prop: "coffee",
    },
  },
  {
    botId: "ai_muse002",
    name: "Muse Worker 002",
    shortName: "Muse 002",
    role: "Browser & MXH",
    node: "nam-linux",
    description: "Tự động hóa trình duyệt, Facebook, Telegram và tương tác MXH.",
    capabilities: ["browser", "facebook", "telegram", "social"],
    desk: 3,
    color: "#38BDF8",
    look: {
      hair: "#1F2937",
      style: "layered",
      eye: "#1D4ED8",
      skin: "#EAC0A2",
      outfit: "overshirt",
      shirt: "#0284C7",
      inner: "#F1F5F9",
      pants: "#273449",
      glasses: false,
      headphones: true,
      prop: "none",
    },
  },
  {
    botId: "ai_muse003",
    name: "Muse Worker 003",
    shortName: "Muse 003",
    role: "Media & Worker",
    node: "hatch-vm",
    description: "Xử lý media, dựng video Remotion và thực thi tác vụ phân tán.",
    capabilities: ["media", "video", "processing", "worker"],
    desk: 4,
    color: "#A78BFA",
    look: {
      hair: "#3B2E58",
      style: "wavy",
      eye: "#5B21B6",
      skin: "#F2CBB2",
      outfit: "sweater",
      shirt: "#6D28D9",
      inner: "#EDE9FE",
      pants: "#27273A",
      glasses: false,
      headphones: false,
      prop: "none",
    },
  },
]

const CUSTOM_PALETTE = [
  { color: "#EC4899", shirt: "#BE185D", hair: "#2B211E", style: "bob" as const, outfit: "cardigan" as const, skin: "#F3CBB2" },
  { color: "#14B8A6", shirt: "#0F766E", hair: "#1F242D", style: "sidepart" as const, outfit: "overshirt" as const, skin: "#E9BF9F" },
  { color: "#FB7185", shirt: "#E11D48", hair: "#4A2F24", style: "wavy" as const, outfit: "sweater" as const, skin: "#F5D0B8" },
  { color: "#60A5FA", shirt: "#1D4ED8", hair: "#181B22", style: "swept" as const, outfit: "hoodie" as const, skin: "#E7BA9A" },
  { color: "#F97316", shirt: "#C2410C", hair: "#3B261C", style: "layered" as const, outfit: "jacket" as const, skin: "#F0C5A6" },
  { color: "#84CC16", shirt: "#3F6212", hair: "#24221F", style: "sidepart" as const, outfit: "sweater" as const, skin: "#ECC1A2" },
  { color: "#06B6D4", shirt: "#0E7490", hair: "#2D2336", style: "bob" as const, outfit: "overshirt" as const, skin: "#F4CEB4" },
]

function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function customLook(botId: string): { color: string; look: MemberLook } {
  const h = hashStr(botId)
  const idx = h % CUSTOM_PALETTE.length
  const p = CUSTOM_PALETTE[idx]
  return {
    color: p.color,
    look: {
      hair: p.hair,
      style: p.style,
      eye: "#2D3748",
      skin: p.skin,
      outfit: p.outfit,
      shirt: p.shirt,
      inner: "#F8FAFC",
      pants: "#1E293B",
      glasses: (h >> 2) % 3 === 0,
      headphones: (h >> 4) % 3 === 1,
      prop: (h >> 5) % 2 === 0 ? "coffee" : "none",
    },
  }
}

function normalizeStatus(raw: string | undefined): MemberStatus {
  if (raw === "online" || raw === "busy" || raw === "idle" || raw === "offline") return raw
  return "online"
}

export function resolveBotName(botId: string, members: OfficeMember[]): string {
  const found = members.find((m) => m.botId === botId)
  if (found) return found.shortName
  const preset = DEFAULT_PRESETS.find((p) => p.botId === botId)
  if (preset) return preset.shortName
  return botId
}

/**
 * Kết hợp danh sách Bot thật (/api/a2a/bots) + Hộp thư A2A thật (/api/a2a/messages)
 * để tạo trạng thái sống động của từng nhân vật trong phòng 3D (tối đa 8 bàn).
 */
export function resolveOfficeMembers(live: OtterLive): OfficeMember[] {
  const liveById = new Map<string, OtterBot>()
  for (const bot of live.bots) liveById.set(bot.botId, bot)

  const orderedIds: string[] = []
  const seen = new Set<string>()
  for (const p of DEFAULT_PRESETS) {
    orderedIds.push(p.botId)
    seen.add(p.botId)
  }
  for (const bot of live.bots) {
    if (!seen.has(bot.botId) && orderedIds.length < 12) {
      orderedIds.push(bot.botId)
      seen.add(bot.botId)
    }
  }

  return orderedIds.map((botId, index) => {
    const preset = DEFAULT_PRESETS.find((p) => p.botId === botId)
    const liveBot = liveById.get(botId)
    const fallback = preset ? null : customLook(botId)

    const status: MemberStatus = live.ok
      ? normalizeStatus(liveBot?.status ?? "offline")
      : preset
        ? "idle"
        : "offline"

    const forMe = live.inbox.filter((msg) => msg.recipient === botId)
    const activeItem = forMe.find((m) => m.status === "in_flight" || m.status === "leased" || m.status === "working")
    const queuedItems = forMe.filter((m) => m.status === "queued")
    const failedItem = forMe.find((m) => m.status === "failed")
    const sentActive = live.inbox.find(
      (m) => m.sender === botId && (m.status === "in_flight" || m.status === "queued"),
    )

    let phase: WorkPhase = "idle"
    let task = "Sẵn sàng · chờ tác vụ A2A"
    let taskMeta: string | null = null

    if (activeItem) {
      phase = "working"
      task = activeItem.goal
      taskMeta = `Đang chạy · từ ${activeItem.sender}`
    } else if (queuedItems.length > 0) {
      phase = "queued"
      task = queuedItems[0].goal
      taskMeta = `Chờ kéo (${queuedItems.length}) · từ ${queuedItems[0].sender}`
    } else if (failedItem && status !== "offline") {
      phase = "error"
      task = failedItem.goal
      taskMeta = "Cần xử lý lại (lỗi)"
    } else if (status === "offline") {
      phase = "offline"
      task = "Ngoại tuyến · chờ đánh thức"
      taskMeta = liveBot?.preferredNode ? `Node ${liveBot.preferredNode}` : null
    } else if (status === "busy") {
      phase = "working"
      task = sentActive ? `Điều phối: ${sentActive.goal}` : "Đang xử lý tác vụ hệ thống"
      taskMeta = "Trạng thái bận"
    } else if (sentActive) {
      phase = "working"
      task = `Theo dõi: ${sentActive.goal}`
      taskMeta = `Đã giao cho ${sentActive.recipient}`
    }

    const name = liveBot?.name || preset?.name || botId
    const shortName = preset?.shortName || name.split(" (")[0].slice(0, 14)

    return {
      id: botId,
      botId,
      name,
      shortName,
      role: preset?.role || (liveBot?.capabilities?.slice(0, 2).join(" · ") || "AI Agent"),
      node: liveBot?.preferredNode ?? preset?.node ?? null,
      description: liveBot?.description || preset?.description || "Bot tham gia mạng phối hợp Otter A2A.",
      capabilities: liveBot?.capabilities?.length ? liveBot.capabilities : (preset?.capabilities ?? []),
      desk: preset ? preset.desk : index,
      color: preset?.color ?? fallback!.color,
      status,
      phase,
      task,
      taskMeta,
      activeCount: activeItem ? 1 : 0,
      queuedCount: queuedItems.length,
      look: preset?.look ?? fallback!.look,
    }
  })
}

export function createInitialState(): OfficeState {
  return {
    selectedId: null,
    focusId: null,
    cameraResetSeq: 0,
    tab: null,
    chat: [],
    trips: [],
    toasts: [],
    seenInboxIds: [],
  }
}

export type Action =
  | { type: "select"; id: string | null; focus?: boolean }
  | { type: "resetCamera" }
  | { type: "tab"; tab: TabId }
  | { type: "close" }
  | { type: "tick"; dtMs: number }
  | { type: "syncLive"; inbox: OtterInboxItem[]; members: OfficeMember[] }
  | { type: "pushChat"; line: Omit<ChatLine, "id"> }
  | { type: "spawnTrip"; fromId: string; toId: string; destDesk: number; packetLabel: string; packetColor: string }
  | { type: "toast"; text: string; tone: Toast["tone"] }
  | { type: "dismissToast"; id: string }

function addToast(state: OfficeState, text: string, tone: Toast["tone"]): OfficeState {
  return {
    ...state,
    toasts: [{ id: uid("toast"), text, tone, ttlMs: 4200 }, ...state.toasts].slice(0, 4),
  }
}

export function reduce(state: OfficeState, action: Action): OfficeState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selectedId: action.id,
        focusId: action.focus === false ? state.focusId : action.id,
      }
    case "resetCamera":
      return { ...state, focusId: null, cameraResetSeq: state.cameraResetSeq + 1 }
    case "tab":
      return { ...state, tab: state.tab === action.tab ? null : action.tab }
    case "close":
      return { ...state, tab: null }
    case "toast":
      return addToast(state, action.text, action.tone)
    case "dismissToast":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    case "pushChat":
      return {
        ...state,
        chat: [...state.chat, { ...action.line, id: uid("chat") }].slice(-50),
      }
    case "spawnTrip": {
      const filtered = state.trips.filter((t) => t.fromId !== action.fromId)
      const trip: Trip = {
        id: uid("trip"),
        fromId: action.fromId,
        toId: action.toId,
        destDesk: action.destDesk,
        progress: 0,
        packetLabel: action.packetLabel,
        packetColor: action.packetColor,
      }
      return { ...state, trips: [...filtered, trip] }
    }
    case "syncLive": {
      const seenSet = new Set(state.seenInboxIds)
      const isFirstSync = state.seenInboxIds.length === 0
      const newItems = action.inbox.filter((item) => !seenSet.has(item.id))
      if (newItems.length === 0) return state

      const nextSeen = [...state.seenInboxIds, ...newItems.map((i) => i.id)].slice(-120)
      const chronological = [...newItems].sort((a, b) => a.createdAt - b.createdAt)
      const chatAdditions: ChatLine[] = chronological.slice(-8).map((item) => ({
        id: `inbox-${item.id}`,
        timestamp: item.updatedAt || item.createdAt || Date.now(),
        fromId: item.sender,
        fromName: resolveBotName(item.sender, action.members),
        toId: item.recipient,
        toName: resolveBotName(item.recipient, action.members),
        text: item.goal,
        kind: "a2a",
        status: item.status,
      }))

      // Kích hoạt nhân vật đi bộ bàn giao gói việc thật cho tác vụ mới (hoặc tác vụ đang hoạt động đầu tiên)
      const tripCandidates = isFirstSync
        ? newItems.filter((i) => i.status === "queued" || i.status === "in_flight").slice(0, 1)
        : newItems.filter((i) => i.status === "queued" || i.status === "in_flight").slice(0, 2)

      const nextTrips = [...state.trips]
      for (const item of tripCandidates) {
        const sender = action.members.find((m) => m.botId === item.sender)
        const recipient = action.members.find((m) => m.botId === item.recipient)
        if (!sender || !recipient || sender.botId === recipient.botId) continue
        if (nextTrips.some((t) => t.fromId === sender.botId)) continue
        nextTrips.push({
          id: uid("trip"),
          fromId: sender.botId,
          toId: recipient.botId,
          destDesk: recipient.desk,
          progress: 0,
          packetLabel: item.goal.slice(0, 28),
          packetColor: sender.color,
        })
      }

      const existingIds = new Set(state.chat.map((c) => c.id))
      const mergedChat = [
        ...state.chat,
        ...chatAdditions.filter((c) => !existingIds.has(c.id)),
      ].slice(-50)

      return {
        ...state,
        seenInboxIds: nextSeen,
        chat: mergedChat,
        trips: nextTrips,
      }
    }
    case "tick": {
      const dt = Math.min(Math.max(action.dtMs, 0), 500)
      const nextToasts = state.toasts
        .map((t) => ({ ...t, ttlMs: t.ttlMs - dt }))
        .filter((t) => t.ttlMs > 0)
      const nextTrips = state.trips
        .map((t) => ({ ...t, progress: t.progress + dt / 6200 }))
        .filter((t) => t.progress < 1)

      if (
        nextToasts.length === state.toasts.length &&
        nextTrips.length === state.trips.length &&
        state.trips.length === 0 &&
        state.toasts.length === 0
      ) {
        return state
      }
      return { ...state, toasts: nextToasts, trips: nextTrips }
    }
  }
}

export function findMentionedMember(text: string, members: OfficeMember[]): OfficeMember | null {
  const folded = plainName(text)
  for (const m of members) {
    if (
      folded.includes(`@${plainName(m.shortName)}`) ||
      folded.includes(`@${plainName(m.name)}`) ||
      folded.includes(`@${plainName(m.botId)}`)
    ) {
      return m
    }
  }
  return null
}

export function stripLeadingMention(text: string, member: OfficeMember): string {
  const candidates = [member.name, member.shortName, member.botId]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  let out = text.trim()
  for (const c of candidates) {
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`@${escaped}\\b`, "i"), "").trim()
  }
  // Fallback accent-insensitive strip for single-word @mention
  if (out === text.trim() && out.startsWith("@")) {
    const spaceIdx = out.indexOf(" ")
    if (spaceIdx > 0) out = out.slice(spaceIdx + 1).trim()
  }
  return out
}
