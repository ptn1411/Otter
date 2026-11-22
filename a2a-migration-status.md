# A2A Bot Coordination Migration Status

**Proposal:** Move bot coordination (A2A, inbox, task exchange) from MXH + shared folder into Otter.  
**Architecture:** Store-and-Forward + Mirroring, Otter DB as Single Source of Truth, Group 503 as Human Gateway.  
**Started:** 2026-11-22  
**Owner:** Anti (ChatMCP) / pham & Sunny (Muse)  

---

## Current Status: In Progress (Phase 1 Completed, moving to Phase 2)

### Phase 1: Hub Store-and-Forward Engine & Bot Identity Registry
- [x] Architecture design & review approved by pham & Sunny
- [x] SQLite `a2a_inbox_messages` schema & database migration
- [x] Core A2A store-and-forward engine (`src/daemon/a2a-inbox.ts`) with lease locks & retry
- [x] MCP tools: `a2a_send_message`, `a2a_pull_inbox`, `a2a_ack_message`, `a2a_inbox_status`, `a2a_list_bots`
- [x] REST / JSON-RPC endpoints in `src/daemon/routes/a2a-routes.ts` (`/api/a2a/send`, `/pull`, `/ack`, `/messages`, `/bots`, `/stats`)
- [x] Bot Identity Registry (`ai_muse002`, `ai_muse003`, `ai_sunny`, `ai_antigravity`, `user_pham`) with capabilities & OAuth
- [x] Unit & integration test suite (`tests/test-a2a-inbox.test.ts` & `tests/test-a2a-routes.test.ts` - 12/12 passing)
- [x] Git commit for Phase 1

### Phase 2: Bot Adapters & Unified Oversight Feed
- [ ] Legacy shared folder migration / watcher helper
- [ ] MXH Group 503 live mirroring in `src/daemon/social-bot.ts`
- [ ] Dashboard A2A Coordination & Inbox monitor tab in `dashboard/`
- [ ] Dashboard build & asset re-embedding
- [ ] Git commit for Phase 2

### Phase 3: Sunset, Verification & Deployment
- [ ] Shared folder deprecation & archive guidance
- [ ] Full end-to-end multi-agent test over A2A
- [ ] Binary compilation (`otter.exe` v2.3.6)
- [ ] Deployment to `%LOCALAPPDATA%\Otter` & daemon restart
- [ ] Tailscale verification (`100.66.170.39:1993`)
- [ ] Final sign-off & notification to Sunny & pham

---

## Blockers & Notes
- None. Full greenlight received.
