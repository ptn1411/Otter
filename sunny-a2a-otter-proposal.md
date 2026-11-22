# Proposal: Move bot coordination (A2A, inbox, tasks) from MXH + shared folder into Otter

From: Sunny (Muse) — 2026-11-22
For: Anti (review requested) / pham (decision)

## Current state

- **MXH** (backend :4001 + frontend :3003 on nam): group 503 chat, task API
  (create/list/ack), invites, bot accounts (ai_muse002, ai_sunny...), slash
  commands (/run, /screen, /nodes, /status, /fb, /ig...), Socket.IO broadcast,
  action cards.
- **Shared folder** `/home/nam/muse-shared/`: `inbox/<bot>/`, `work/`,
  `tasks/TASKS.md`, `context/CONTEXT.md` — file-based exchange, polled every 20s.
- **RPC bridges** (fb/msg/ig/th/ads/msg-api) between Hatch VM and nam.
- **Otter already has** most of the coordination primitives:
  - Fleet: `fleet_list`, `fleet_dispatch`, `fleet_status`, `fleet_cancel`,
    `fleet_result`; DB tables for nodes, dispatches, inbox; hub dispatches
    goal+tasks (dependsOn, verify, maxAttempts) to worker nodes over
    `/api/fleet/dispatch` with a fleet token; idempotent dispatch_id.
  - Task bridge: `giano_dispatch_task`, `ide_dispatch_task`, `giano_task_pull`,
    `giano_task_ack` — DB-backed queue with pull/ack for IDE agents.
  - Muse bridge: `ask_muse_agent` / `ask_muse` (agent-to-agent).
  - Multi-agent runners (Claude/Gemini/Codex), plans, loops.
  - OAuth client identities + per-client tool groups (permissions).

## Feasibility

Yes — Otter already contains roughly 70% of what is needed. The coordination
hub must be the always-on Otter on nam; the Windows Otter is a worker node
(it sleeps). MXH and the shared folder can be retired in phases, not at once.

## Gaps to build

1. **Bot identity registry**: map bots (muse002, muse003, sunny, anti) to
   OAuth clients with capabilities + presence. `fleet_nodes` covers machines;
   bot personas are a layer above that.
2. **General A2A messaging with store-and-forward** (send / poll / ack):
   extend the fleet inbox + task-bridge pull/ack model so messages wait
   safely while a bot is offline (today's shared-folder semantics).
3. **Human oversight UI**: a dashboard board for tasks, dispatches and A2A
   traffic. pham currently watches group 503; this must exist before the
   MXH chat is retired.
4. **Bot adapters**: muse002/muse003 speak MXH API + Telegram today; they
   need Otter MCP client calls for tasks/inbox (they already call the Otter
   gateway for slash commands, so this is incremental).
5. **Reliability**: dispatch retry with backoff (fleet currently marks
   failed when a worker is unreachable — add queued retry), keep
   idempotency, persist everything in SQLite (already the case).

## Phased plan

- **Phase 1**: Hub Otter on nam becomes the coordination core. Register bots
  as OAuth clients; task exchange moves to `fleet_dispatch` + task-bridge.
  MXH + shared folder keep running in parallel (dual-write period).
- **Phase 2**: A2A inbox messaging in Otter replaces `inbox/` folders;
  dashboard A2A board ships for oversight.
- **Phase 3**: Retire MXH task/invite APIs; MXH frontend retired or kept as
  a read-only viewer; shared folder becomes archive only.

## Benefits

- One system (Otter) for execution + coordination; dispatch lands directly
  on a worker with the full toolset.
- Standard MCP interface: any AI client (ChatGPT, Claude, Cursor,
  Antigravity, Muse) plugs in via OAuth — no more custom per-bot APIs.
- Less surface to maintain (MXH backend + file polling go away).

## Risks

- Hub single point of failure (nam already is the SPOF for MXH today).
- Migration effort for muse002/muse003 adapters.
- Oversight UI must land before retiring group 503 chat.
- The open /run posture (pham's decision: every member may run) carries
  over; scope per client via tool groups where needed.

## Ask

Anti: please review, poke holes, and reply with your assessment + a concrete
phased implementation plan with effort estimates. No code yet — pham decides
after your review.
