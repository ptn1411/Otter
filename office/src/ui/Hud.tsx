import { useEffect, useRef, useState } from "react"
import type { Dispatch, ReactNode } from "react"
import {
  Activity,
  Briefcase,
  Cpu,
  Crosshair,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Action } from "../game/logic"
import {
  DEFAULT_PRESETS,
  findMentionedMember,
  formatTime,
  formatTokens,
  plainName,
  resolveBotName,
  stripLeadingMention,
} from "../game/logic"
import type { OfficeMember, OfficeState, TabId, WorkPhase } from "../game/types"
import type { OtterLive } from "../otter/live"
import {
  cancelA2aTask,
  createA2aBot,
  deleteA2aBot,
  formatUptime,
  inboxStatusLabel,
  inboxTypeLabel,
  sendA2aTask,
  statusLabel,
} from "../otter/live"

type Props = {
  state: OfficeState
  members: OfficeMember[]
  live: OtterLive
  dispatch: Dispatch<Action>
  onRefresh: () => Promise<void>
}

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "staff", label: "Đội ngũ", icon: Users },
  { id: "inbox", label: "Hộp thư A2A", icon: Briefcase },
]

const GLASS =
  "border border-white/12 bg-[#0F1622]/90 text-[#F8FAFC] shadow-[0_18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl"

const DEFAULT_BOT_IDS = new Set(DEFAULT_PRESETS.map((p) => p.botId))

function phaseDotClass(phase: WorkPhase): string {
  if (phase === "working") return "bg-emerald-400 shadow-[0_0_8px_#34D399]"
  if (phase === "queued") return "bg-sky-400"
  if (phase === "error") return "bg-rose-400"
  if (phase === "idle") return "bg-amber-400"
  return "bg-slate-500"
}

function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>{children}</span>
}

function HubCard({
  live,
  membersCount,
  hasFocus,
  onResetCamera,
}: {
  live: OtterLive
  membersCount: number
  hasFocus: boolean
  onResetCamera: () => void
}) {
  return (
    <div className={`pointer-events-auto flex w-fit max-w-full items-center gap-2.5 rounded-2xl px-3 py-2 sm:px-3.5 ${GLASS}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/40">
        <span className={`h-2.5 w-2.5 rounded-full ${live.ok ? "bg-emerald-400 shadow-[0_0_10px_#34D399]" : "bg-rose-400"}`} />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold tracking-tight">Otter Command Office</p>
          {live.version && (
            <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
              v{live.version}
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          {live.ok ? `${membersCount} thành viên · đồng bộ A2A trực tiếp` : (live.error ?? "Đang nối Otter daemon…")}
        </p>
      </div>
      {hasFocus && (
        <button
          type="button"
          onClick={onResetCamera}
          title="Về góc nhìn toàn phòng"
          className="ml-1 flex items-center gap-1 rounded-xl bg-white/8 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/15"
        >
          <Crosshair className="h-3.5 w-3.5 text-emerald-400" />
          <span className="hidden sm:inline">Toàn phòng</span>
        </button>
      )}
    </div>
  )
}

function TelemetryBar({ live, members }: { live: OtterLive; members: OfficeMember[] }) {
  const [open, setOpen] = useState(false)
  const onlineCount = members.filter((m) => m.status !== "offline").length
  const activeJobs = (live.a2a?.queued ?? 0) + (live.a2a?.inFlight ?? 0)
  const waiting = live.loading && !live.ok
  const tokenText = live.ok ? formatTokens(live.tokens) : waiting ? "…" : "—"

  return (
    <div className="pointer-events-auto relative min-w-0 flex-1 sm:flex-none">
      <div className={`flex items-center gap-2 overflow-x-auto rounded-2xl px-2.5 py-1.5 sm:gap-3.5 sm:px-4 sm:py-2 ${GLASS}`}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`flex shrink-0 items-center gap-2 rounded-xl px-2 py-1 text-left transition ${
            open ? "bg-emerald-500/20 ring-1 ring-emerald-400/30" : "hover:bg-white/8"
          }`}
        >
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <span>
            <span className="block text-sm font-bold tabular-nums text-emerald-400">{tokenText}</span>
            <span className="block text-[10px] text-slate-400">Token MCP</span>
          </span>
        </button>
        <Stat icon={<Cpu className="h-4 w-4 text-emerald-400" />} value={live.ok ? String(live.tools) : waiting ? "…" : "—"} label="Công cụ" />
        <Stat icon={<Activity className="h-4 w-4 text-sky-400" />} value={live.ok ? String(live.sessions) : waiting ? "…" : "—"} label="Phiên" />
        <Stat icon={<Users className="h-4 w-4 text-emerald-400" />} value={live.ok ? `${onlineCount}/${members.length}` : waiting ? "…" : "—"} label="Trực tuyến" />
        <Stat icon={<Briefcase className="h-4 w-4 text-amber-400" />} value={live.ok ? String(activeJobs) : waiting ? "…" : "—"} label="A2A đang mở" />
      </div>

      {open && (
        <div className={`panel-scroll absolute top-full right-0 left-0 z-40 mt-2 max-h-[min(60dvh,520px)] overflow-y-auto rounded-2xl p-3.5 sm:left-auto sm:w-[350px] ${GLASS}`}>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Nhóm MCP Tools đang bật</h2>
            <span className="text-xs font-bold tabular-nums text-emerald-400">{tokenText} tokens</span>
          </div>
          {live.error && <p className="mb-2 text-xs text-rose-300">{live.error}</p>}
          <div className="space-y-1.5">
            {live.groups.map((group) => {
              const share = live.tokens > 0 ? Math.round((group.tokens / live.tokens) * 100) : 0
              return (
                <div key={group.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-2.5 py-1.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${group.enabled ? "bg-emerald-400" : "bg-slate-600"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{group.name}</span>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-slate-800">
                      <span className="block h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, share)}%` }} />
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block text-xs font-bold">{formatTokens(group.tokens)}</span>
                    <span className="block text-[10px] text-slate-400">{group.enabled ? "bật" : "tắt"}</span>
                  </span>
                </div>
              )
            })}
          </div>
          {live.ok && (
            <p className="mt-3 border-t border-white/10 pt-2 text-[11px] text-slate-400">
              Otter v{live.version} · uptime {formatUptime(live.uptime)} · {live.tools}/{live.totalTools} tools
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {icon}
      <div>
        <div className="text-sm font-bold tabular-nums leading-4">{value}</div>
        <div className="text-[10px] text-slate-400">{label}</div>
      </div>
    </div>
  )
}

function DepartmentRoster({
  members,
  selectedId,
  onSelect,
}: {
  members: OfficeMember[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const working = members.filter((m) => m.phase === "working" || m.phase === "queued").length

  return (
    <aside className={`pointer-events-auto hidden w-[308px] rounded-2xl p-3 lg:block ${GLASS}`}>
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-sm font-semibold">Đội ngũ ({members.length})</span>
        <span className="text-[11px] text-slate-400">
          {working > 0 ? `${working} đang xử lý` : "Đang sẵn sàng"} · {collapsed ? "Mở" : "Thu gọn"}
        </span>
      </button>
      {!collapsed && (
        <div className="panel-scroll mt-2 max-h-[28vh] space-y-1 overflow-y-auto pr-1">
          {members.map((m) => {
            const selected = selectedId === m.botId
            return (
              <button
                key={m.botId}
                type="button"
                onClick={() => onSelect(m.botId)}
                className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                  selected ? "bg-emerald-500/20 ring-1 ring-emerald-400/40" : "hover:bg-white/[0.05]"
                }`}
              >
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${phaseDotClass(m.phase)}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span className="truncate">{m.shortName}</span>
                    <span className="shrink-0 text-[10px] font-normal text-slate-400">Bàn {m.desk + 1}</span>
                  </span>
                  <span className="block truncate text-[11px] text-slate-300">{m.task}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </aside>
  )
}

function StaffPane({
  members,
  selectedId,
  live,
  dispatch,
  onRefresh,
  onPrefillMention,
}: {
  members: OfficeMember[]
  selectedId: string | null
  live: OtterLive
  dispatch: Dispatch<Action>
  onRefresh: () => Promise<void>
  onPrefillMention: (name: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState("")
  const [role, setRole] = useState("Worker AI")
  const [node, setNode] = useState("nam-windows")
  const [busy, setBusy] = useState(false)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return
    const slug = plainName(cleanName).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `agent_${Date.now().toString(36)}`
    const botId = slug.startsWith("ai_") ? slug : `ai_${slug}`
    setBusy(true)
    const res = await createA2aBot(live.base, {
      botId,
      name: cleanName,
      description: role.trim() || "Agent phối hợp A2A",
      capabilities: role
        .split(/[,·/]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      preferredNode: node.trim() || "nam-windows",
      status: "online",
    })
    setBusy(false)
    if (res.ok) {
      setName("")
      setAdding(false)
      dispatch({ type: "toast", text: `Đã thêm ${cleanName} vào phòng (A2A Registry).`, tone: "ok" })
      await onRefresh()
      dispatch({ type: "select", id: botId, focus: true })
    } else {
      dispatch({ type: "toast", text: res.error ?? "Không thêm được Agent.", tone: "bad" })
    }
  }

  async function handleRemove(botId: string, label: string) {
    const res = await deleteA2aBot(live.base, botId)
    if (res.ok) {
      dispatch({ type: "toast", text: `Đã gỡ ${label} khỏi phòng.`, tone: "info" })
      await onRefresh()
    } else {
      dispatch({ type: "toast", text: res.error ?? "Không gỡ được Agent.", tone: "bad" })
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Tối đa 12 bàn 3D. Bấm nhân vật để xoay camera tới bàn.</p>
        {members.length < 12 && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500"
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm Agent
          </button>
        )}
      </div>

      {adding && (
        <form onSubmit={(e) => void handleAdd(e)} className="space-y-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/8 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tên Agent (vd: QA Reviewer, DevOps Bot)"
            className="w-full rounded-xl border border-white/10 bg-[#0B1019] px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-400/50"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Kỹ năng (code, qa, media)"
              className="rounded-xl border border-white/10 bg-[#0B1019] px-2.5 py-1.5 text-xs text-white outline-none"
            />
            <input
              value={node}
              onChange={(e) => setNode(e.target.value)}
              placeholder="Node (nam-windows)"
              className="rounded-xl border border-white/10 bg-[#0B1019] px-2.5 py-1.5 text-xs text-white outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-xl px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10">
              Hủy
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Đang tạo…" : "Xếp vào bàn"}
            </button>
          </div>
        </form>
      )}

      {members.map((m) => {
        const selected = selectedId === m.botId
        const isCustom = !DEFAULT_BOT_IDS.has(m.botId)
        return (
          <div
            key={m.botId}
            className={`rounded-2xl border p-3 transition ${
              selected ? "border-emerald-400/50 bg-emerald-500/12" : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => dispatch({ type: "select", id: m.botId, focus: true })}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${phaseDotClass(m.phase)}`} />
                  <span className="truncate text-sm font-semibold">{m.name}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Bàn {m.desk + 1} · {statusLabel(m.status)}
                  {m.node ? ` · ${m.node}` : ""}
                </p>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onPrefillMention(m.shortName)}
                  className="rounded-lg bg-white/8 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                >
                  Giao việc
                </button>
                {isCustom && (
                  <button
                    type="button"
                    aria-label={`Xóa ${m.shortName}`}
                    onClick={() => void handleRemove(m.botId, m.shortName)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-200">{m.task}</p>
            {m.capabilities.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {m.capabilities.slice(0, 5).map((cap) => (
                  <span key={cap} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-slate-300">
                    {cap}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InboxPane({
  live,
  members,
  dispatch,
  onRefresh,
}: {
  live: OtterLive
  members: OfficeMember[]
  dispatch: Dispatch<Action>
  onRefresh: () => Promise<void>
}) {
  const [filter, setFilter] = useState<"all" | "active" | "acked" | "failed">("all")
  const [recipient, setRecipient] = useState(() => members.find((m) => m.botId !== "user_pham")?.botId ?? "ai_sunny")
  const [goal, setGoal] = useState("")
  const [sending, setSending] = useState(false)

  const filtered = live.inbox.filter((item) => {
    if (filter === "active") return item.status === "queued" || item.status === "in_flight" || item.status === "leased" || item.status === "working"
    if (filter === "acked") return item.status === "acked" || item.status === "completed"
    if (filter === "failed") return item.status === "failed"
    return true
  })

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const clean = goal.trim()
    if (!clean || !recipient) return
    setSending(true)
    const res = await sendA2aTask(live.base, {
      senderId: "user_pham",
      recipientId: recipient,
      goal: clean,
      messageType: "task",
      priority: 1,
    })
    setSending(false)
    if (res.ok) {
      const target = members.find((m) => m.botId === recipient)
      if (target) {
        dispatch({
          type: "spawnTrip",
          fromId: "user_pham",
          toId: target.botId,
          destDesk: target.desk,
          packetLabel: clean.slice(0, 28),
          packetColor: "#10B981",
        })
      }
      setGoal("")
      dispatch({ type: "toast", text: `Đã gửi tác vụ tới ${target?.shortName ?? recipient}.`, tone: "ok" })
      await onRefresh()
    } else {
      dispatch({ type: "toast", text: res.error ?? "Không gửi được tác vụ A2A.", tone: "bad" })
    }
  }

  async function handleCancel(id: string) {
    const res = await cancelA2aTask(live.base, id)
    if (res.ok) {
      dispatch({ type: "toast", text: "Đã hủy tác vụ trong hàng đợi.", tone: "info" })
      await onRefresh()
    } else {
      dispatch({ type: "toast", text: res.error ?? "Không hủy được tác vụ.", tone: "bad" })
    }
  }

  return (
    <div className="space-y-3">
      {live.a2a && (
        <div className="grid grid-cols-4 gap-1.5 text-center">
          <InboxCount value={live.a2a.queued} label="Chờ kéo" tone="text-sky-300" />
          <InboxCount value={live.a2a.inFlight} label="Đang làm" tone="text-emerald-400" />
          <InboxCount value={live.a2a.acked} label="Đã ack" tone="text-slate-200" />
          <InboxCount value={live.a2a.failed} label="Lỗi" tone="text-rose-300" />
        </div>
      )}

      <form onSubmit={(e) => void handleSend(e)} className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
        <div className="flex items-center gap-2">
          <select
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="rounded-xl border border-white/10 bg-[#0B1019] px-2.5 py-1.5 text-xs text-slate-100 outline-none"
          >
            {members.map((m) => (
              <option key={m.botId} value={m.botId}>
                Giao → {m.shortName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={sending || !goal.trim()}
            className="ml-auto flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Send className="h-3 w-3" />
            {sending ? "Gửi…" : "Gửi A2A"}
          </button>
        </div>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Nhập mục tiêu tác vụ A2A thật…"
          className="w-full rounded-xl border border-white/10 bg-[#0B1019] px-3 py-1.5 text-xs text-white outline-none focus:border-emerald-400/50"
        />
      </form>

      <div className="flex gap-1">
        {(
          [
            ["all", "Tất cả"],
            ["active", "Đang mở"],
            ["acked", "Hoàn tất"],
            ["failed", "Lỗi"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
              filter === id ? "bg-emerald-600 text-white" : "bg-white/[0.05] text-slate-300 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!live.ok && <p className="text-xs text-slate-400">{live.error ?? "Đang đọc hộp thư A2A…"}</p>}
      {live.ok && filtered.length === 0 && <p className="text-xs text-slate-400">Không có tác vụ nào trong mục này.</p>}

      {filtered.slice(0, 16).map((item) => (
        <article key={item.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-xs font-semibold leading-5 text-slate-100">{item.goal}</h3>
            <Badge
              className={
                item.status === "failed"
                  ? "bg-rose-500/20 text-rose-200"
                  : item.status === "queued"
                    ? "bg-sky-500/20 text-sky-200"
                    : "bg-emerald-500/20 text-emerald-300"
              }
            >
              {inboxStatusLabel(item.status)}
            </Badge>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span>
              {resolveBotName(item.sender, members)} → {resolveBotName(item.recipient, members)} · {inboxTypeLabel(item.type)}
            </span>
            {item.status === "queued" && (
              <button
                type="button"
                onClick={() => void handleCancel(item.id)}
                className="text-rose-300 hover:underline"
              >
                Hủy
              </button>
            )}
          </div>
          {item.resultSummary && <p className="mt-1.5 rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300">{item.resultSummary}</p>}
        </article>
      ))}
    </div>
  )
}

function InboxCount({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-1 py-2">
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] text-slate-400">{label}</div>
    </div>
  )
}

function ChatDock({
  state,
  members,
  live,
  dispatch,
  onRefresh,
  draft,
  setDraft,
}: Props & { draft: string; setDraft: (v: string) => void }) {
  const [open, setOpen] = useState(() => window.matchMedia("(min-width: 640px)").matches)
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const lines = state.chat

  useEffect(() => {
    const node = box.current
    if (node) node.scrollTop = node.scrollHeight
  }, [lines.length, open])

  const token = draft.match(/@([^\s@]*)$/)
  const query = token ? plainName(token[1]) : null
  const suggestions =
    query === null
      ? []
      : members.filter((m) => plainName(m.shortName).includes(query) || plainName(m.name).includes(query)).slice(0, 6)

  async function send() {
    const value = draft.trim()
    if (!value || sending) return
    const mentioned = findMentionedMember(value, members)
    const target =
      mentioned ??
      members.find((m) => m.botId === state.selectedId && m.botId !== "user_pham") ??
      members.find((m) => m.botId !== "user_pham") ??
      members[0]
    if (!target) return

    const body = mentioned ? stripLeadingMention(value, mentioned) : value
    setDraft("")

    const isQuery = !body || /[?？]/.test(body) || /^(tiến độ|trạng thái|đang làm gì)\b/i.test(body)
    if (isQuery) {
      dispatch({
        type: "pushChat",
        line: {
          timestamp: Date.now(),
          fromId: "user_pham",
          fromName: "Bạn",
          toId: target.botId,
          toName: target.shortName,
          text: body || `Kiểm tra trạng thái ${target.shortName}`,
          kind: "assign",
        },
      })
      dispatch({
        type: "pushChat",
        line: {
          timestamp: Date.now(),
          fromId: target.botId,
          fromName: target.shortName,
          toId: "user_pham",
          toName: "Bạn",
          text: `${statusLabel(target.status)} · ${target.task}${target.taskMeta ? ` (${target.taskMeta})` : ""}.`,
          kind: "reply",
        },
      })
      dispatch({ type: "select", id: target.botId, focus: true })
      return
    }

    // Giao việc THẬT vào A2A Inbox của Otter!
    setSending(true)
    const res = await sendA2aTask(live.base, {
      senderId: "user_pham",
      recipientId: target.botId,
      goal: body,
      messageType: "task",
      priority: 1,
    })
    setSending(false)

    if (res.ok) {
      dispatch({
        type: "spawnTrip",
        fromId: "user_pham",
        toId: target.botId,
        destDesk: target.desk,
        packetLabel: body.slice(0, 28),
        packetColor: "#10B981",
      })
      dispatch({ type: "select", id: target.botId, focus: true })
      dispatch({ type: "toast", text: `Đã giao việc A2A cho ${target.shortName}.`, tone: "ok" })
      await onRefresh()
    } else {
      dispatch({ type: "toast", text: res.error ?? "Không gửi được vào A2A Inbox.", tone: "bad" })
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`pointer-events-auto absolute left-2 z-20 rounded-full px-3.5 py-2 text-xs font-semibold bottom-[calc(4.6rem+env(safe-area-inset-bottom))] sm:bottom-20 sm:left-4 ${state.tab ? "max-sm:hidden" : ""} ${GLASS}`}
      >
        Điều phối A2A · {lines.length}
      </button>
    )
  }

  return (
    <section
      className={`pointer-events-auto absolute inset-x-2 z-20 flex max-h-[min(42dvh,360px)] flex-col overflow-hidden rounded-2xl bottom-[calc(4.6rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-20 sm:left-4 sm:max-h-none sm:w-[356px] ${state.tab ? "max-sm:hidden" : ""} ${GLASS}`}
    >
      <button type="button" onClick={() => setOpen(false)} className="flex items-center justify-between px-3.5 py-2.5 text-left">
        <span className="text-xs font-semibold tracking-wide uppercase text-slate-200">Luồng điều phối A2A</span>
        <span className="text-[11px] text-slate-400">Thu gọn</span>
      </button>
      <div ref={box} className="panel-scroll max-h-[24vh] space-y-1.5 overflow-y-auto px-3 pb-2.5">
        {lines.length === 0 && (
          <p className="text-xs leading-5 text-slate-400">
            Gõ <span className="font-semibold text-emerald-300">@Sunny</span> hoặc <span className="font-semibold text-emerald-300">@Antigravity</span> để giao tác vụ A2A thật. Nhân vật sẽ đứng dậy bàn giao trực tiếp trong phòng 3D.
          </p>
        )}
        {lines.map((line) => (
          <article key={line.id} className="rounded-xl bg-white/[0.04] px-2.5 py-1.5">
            <p className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
              <span>
                {formatTime(line.timestamp)} · <strong className="text-slate-200">{line.fromName}</strong>
                {line.toName ? ` → ${line.toName}` : ""}
              </span>
              {line.status && <span className="text-emerald-300">{inboxStatusLabel(line.status)}</span>}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-slate-100">{line.text}</p>
          </article>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-1.5">
          {suggestions.map((m) => (
            <button
              key={m.botId}
              type="button"
              className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/35"
              onClick={() => setDraft(draft.replace(/@([^\s@]*)$/, `@${m.shortName} `))}
            >
              @{m.shortName}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-1.5 border-t border-white/10 p-2"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="@Sunny kiểm tra tiến độ…"
          className="min-w-0 flex-1 rounded-xl bg-[#090D16] px-3 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/10 focus:ring-emerald-400/50"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {sending ? "…" : "Gửi"}
        </button>
      </form>
    </section>
  )
}

export default function Hud({ state, members, live, dispatch, onRefresh }: Props) {
  const [draft, setDraft] = useState("")
  const selected = members.find((m) => m.botId === state.selectedId) ?? null

  function prefillMention(shortName: string) {
    setDraft(`@${shortName} `)
    dispatch({ type: "close" })
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Top bar */}
      <div className="absolute inset-x-2 top-[max(0.5rem,env(safe-area-inset-top))] z-20 flex flex-col gap-2 sm:inset-x-4 sm:top-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <HubCard
            live={live}
            membersCount={members.length}
            hasFocus={Boolean(state.focusId)}
            onResetCamera={() => dispatch({ type: "resetCamera" })}
          />
          {/* Mobile member chips */}
          <div className="pointer-events-auto flex gap-1.5 overflow-x-auto lg:hidden">
            {members.map((m) => (
              <button
                key={m.botId}
                type="button"
                onClick={() => dispatch({ type: "select", id: m.botId, focus: true })}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border border-white/12 px-3 py-1.5 text-xs font-semibold ${
                  state.selectedId === m.botId ? "bg-emerald-600 text-white" : "bg-[#0F1622]/90 text-slate-100"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${phaseDotClass(m.phase)}`} />
                {m.shortName}
              </button>
            ))}
          </div>
          <DepartmentRoster
            members={members}
            selectedId={state.selectedId}
            onSelect={(id) => dispatch({ type: "select", id, focus: true })}
          />
        </div>
        <TelemetryBar live={live} members={members} />
      </div>

      {/* Selected member floating pill */}
      {selected && (
        <div
          className={`pointer-events-auto absolute bottom-20 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-2 xl:flex ${GLASS}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${phaseDotClass(selected.phase)}`} />
          <span className="text-xs">
            <strong className="text-slate-100">{selected.name}</strong>
            <span className="text-slate-400"> · Bàn {selected.desk + 1} · </span>
            <span className="text-slate-200">{selected.task}</span>
          </span>
          <button
            type="button"
            onClick={() => prefillMention(selected.shortName)}
            className="rounded-lg bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/30"
          >
            Giao việc
          </button>
          <button
            type="button"
            aria-label="Bỏ chọn"
            onClick={() => {
              dispatch({ type: "select", id: null, focus: false })
              dispatch({ type: "resetCamera" })
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Bottom Dock */}
      <nav
        className={`pointer-events-auto absolute inset-x-2 z-30 flex gap-1 rounded-2xl p-1 bottom-[max(0.5rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:p-1.5 ${GLASS}`}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon
          const active = state.tab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => dispatch({ type: "tab", tab: tab.id })}
              className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition sm:flex-none ${
                active ? "bg-emerald-600 text-white shadow-sm" : "text-slate-300 hover:bg-white/8"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Right Drawer */}
      {state.tab && (
        <section
          className={`pointer-events-auto absolute inset-x-2 z-30 flex max-h-[min(62dvh,calc(100dvh-8.5rem))] flex-col overflow-hidden rounded-2xl bottom-[calc(4.6rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:top-20 sm:right-4 sm:bottom-20 sm:w-[390px] sm:max-h-none ${GLASS}`}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-semibold">{state.tab === "inbox" ? "Hộp thư A2A Otter" : "Đội ngũ & Bot 3D"}</h2>
            <button
              type="button"
              aria-label="Đóng"
              onClick={() => dispatch({ type: "close" })}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <div className="panel-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {state.tab === "staff" && (
              <StaffPane
                members={members}
                selectedId={state.selectedId}
                live={live}
                dispatch={dispatch}
                onRefresh={onRefresh}
                onPrefillMention={prefillMention}
              />
            )}
            {state.tab === "inbox" && <InboxPane live={live} members={members} dispatch={dispatch} onRefresh={onRefresh} />}
          </div>
        </section>
      )}

      <ChatDock
        state={state}
        members={members}
        live={live}
        dispatch={dispatch}
        onRefresh={onRefresh}
        draft={draft}
        setDraft={setDraft}
      />

      {/* Toasts */}
      <div className="pointer-events-none absolute top-20 left-1/2 z-40 flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
        {state.toasts.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => dispatch({ type: "dismissToast", id: item.id })}
            className={`pointer-events-auto rounded-xl border px-3.5 py-2 text-left text-xs font-medium shadow-xl backdrop-blur-md ${
              item.tone === "ok"
                ? "border-emerald-400/30 bg-[#052e24]/95 text-emerald-100"
                : item.tone === "bad"
                  ? "border-rose-400/30 bg-[#3f0a16]/95 text-rose-100"
                  : "border-white/12 bg-[#141C2B]/95 text-slate-100"
            }`}
          >
            {item.text}
          </button>
        ))}
      </div>
    </div>
  )
}
