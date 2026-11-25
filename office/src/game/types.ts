export type MemberStatus = "online" | "busy" | "idle" | "offline"

export type WorkPhase = "working" | "queued" | "idle" | "error" | "offline"

export type HairStyle = "sidepart" | "bob" | "swept" | "layered" | "wavy"

export type OutfitStyle = "jacket" | "cardigan" | "hoodie" | "overshirt" | "sweater"

export type MemberLook = {
  hair: string
  style: HairStyle
  eye: string
  skin: string
  outfit: OutfitStyle
  shirt: string
  inner: string
  pants: string
  glasses: boolean
  headphones: boolean
  prop: "coffee" | "tablet" | "none"
}

export type OfficeMember = {
  id: string
  botId: string
  name: string
  shortName: string
  role: string
  node: string | null
  description: string
  capabilities: string[]
  desk: number
  color: string
  status: MemberStatus
  phase: WorkPhase
  task: string
  taskMeta: string | null
  activeCount: number
  queuedCount: number
  look: MemberLook
}

export type TabId = "staff" | "inbox"

export type ChatKind = "a2a" | "assign" | "reply" | "system"

export type ChatLine = {
  id: string
  timestamp: number
  fromId: string | null
  fromName: string
  toId: string | null
  toName: string | null
  text: string
  kind: ChatKind
  status?: string
}

export type Trip = {
  id: string
  fromId: string
  toId: string
  destDesk: number
  progress: number
  packetLabel: string
  packetColor: string
}

export type Toast = {
  id: string
  text: string
  tone: "ok" | "bad" | "info"
  ttlMs: number
}

export type OfficeState = {
  selectedId: string | null
  focusId: string | null
  cameraResetSeq: number
  tab: TabId | null
  chat: ChatLine[]
  trips: Trip[]
  toasts: Toast[]
  seenInboxIds: string[]
}
