# A2A Bot Coordination Migration Status

**Proposal:** Move bot coordination (A2A, inbox, task exchange) from MXH + shared folder into Otter.  
**Architecture:** Store-and-Forward + Mirroring, Otter DB as Single Source of Truth, Group 503 as Human Gateway.  
**Started:** 2026-11-22  
**Owner:** Anti (ChatMCP) / pham & Sunny (Muse)  

---

## Current Status: ✅ COMPLETED (All 3 Phases Implemented & Deployed)

### Phase 1: Hub Store-and-Forward Engine & Bot Identity Registry
- [x] Architecture design & review approved by pham & Sunny
- [x] SQLite `a2a_inbox_messages` schema & database migration
- [x] Core A2A store-and-forward engine (`src/daemon/a2a-inbox.ts`) with lease locks & retry
- [x] MCP tools: `a2a_send_message`, `a2a_pull_inbox`, `a2a_ack_message`, `a2a_inbox_status`, `a2a_list_bots`
- [x] REST / JSON-RPC endpoints in `src/daemon/routes/a2a-routes.ts` (`/api/a2a/send`, `/pull`, `/ack`, `/messages`, `/bots`, `/stats`)
- [x] Bot Identity Registry (`ai_muse002`, `ai_muse003`, `ai_sunny`, `ai_antigravity`, `user_pham`) with capabilities & OAuth
- [x] Unit & integration test suite (`tests/test-a2a-inbox.test.ts` & `tests/test-a2a-routes.test.ts` - 12/12 passing)
- [x] Git commit for Phase 1 (`0c07183`)

### Phase 2: Bot Adapters & Unified Oversight Feed
- [x] Legacy shared folder migration / watcher helper (`src/daemon/a2a-folder-adapter.ts`)
- [x] MXH Group 503 live mirroring in `src/daemon/social-bot.ts` with `/a2a` command suite
- [x] Dashboard A2A Coordination & Inbox monitor tab (`dashboard/src/tabs/A2aCoordinationTab.tsx`)
- [x] Dashboard build (`pnpm build`) & asset re-embedding (`src/daemon/dashboard-assets.generated.ts`)
- [x] Unit tests for folder adapter (`tests/test-a2a-folder-adapter.test.ts` - 2/2 passing)
- [x] Git commit for Phase 2 (`27325df`)

### Phase 3: Sunset, Verification & Deployment
- [x] Version bumped to v2.3.6 in `package.json`
- [x] Full end-to-end multi-agent test (`tests/test-a2a-e2e.test.ts` - passing)
- [x] Binary compilation (`otter.exe` v2.3.6 via Bun)
- [x] Backups of previous binaries (`otter.exe.bak-pre-2.3.6`)
- [x] Deployment to `%LOCALAPPDATA%\Otter` (`otter.exe`, `bin\otter.exe`, `openapi.json`)
- [x] Daemon restart on Port 1993 with `--tunnel`
- [x] Live health check verification: Local (`127.0.0.1:1993/health`) and Tailscale (`100.66.170.39:1993/health`) both returning `v2.3.6`
- [x] Live A2A Send -> Pull -> Ack tested on running instance
- [x] Core MCP Server discovery: 58 tools connected (53 previous + 5 new A2A tools)

---

## Blockers & Notes
- None. Full 3-phase implementation completed and verified live.

