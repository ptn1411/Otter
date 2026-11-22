# Task: Integrate agent-desktop MCP into Otter (parallel with CUA, toggleable, agent-desktop-first with CUA fallback) + fix CUA daemon self-heal

Written by Sunny on 2026-11-22 at pham's request. Target repo: chatmcp (Otter daemon). Reference write-up (Vietnamese, on nam): /home/nam/muse-shared/notes/task-cua-otter-2026-11-22.md — this file is self-contained; you do not need it to start.

## Context

Otter currently has two desktop-control paths:

1. **Built-in `desktop_*` tools** (screenshot, mouse, keyboard, list_windows) — run inside the daemon, always available, but coordinate-based and screenshot-heavy.
2. **CUA toolset** (`cua_get_inventory`, `cua_execute_tool`) — talks to a separate `cua-driver` daemon over a socket (Windows named pipe `\\.\pipe\cua-driver`). Today Otter does NOT auto-start that daemon, so CUA calls fail with "daemon is not running" unless someone starts it manually.

On 2026-11-22 Sunny spiked **agent-desktop** (github.com/vercel-labs/agent-desktop, v1.3.1, already installed globally via npm on this Windows machine) and verified live:

- Headless (no pointer/focus theft): `status`, `snapshot` (Notepad 98–105 refs, Explorer 70 refs; `--skeleton --compact` ≈ 5.8k chars), `get` (read field values), `click` on refs — all work.
- Limits: raw `press` keys need the target app foreground, and `focus-window` could not force foreground from the daemon context (Windows foreground lock). `type` into Explorer's address bar returned POLICY_DENIED. `launch` by bare name fails for UWP apps (Calculator) — needs an absolute path or a System32 name.
- agent-desktop ships an MCP server: `agent-desktop mcp` (stdio). Its tools are named after its commands (`desktop_snapshot`, `desktop_click`, ...).

Pham's decision: **agent-desktop becomes the preferred desktop backend, running in parallel with CUA, with an on/off toggle; hard cases fall back to CUA. Also fix CUA so its daemon self-heals.**

## Goals

1. Otter can use agent-desktop tools through MCP, toggleable like other tool groups.
2. agent-desktop is tried first for desktop observation and semantic actions; CUA (or built-in desktop_*) is the fallback for cases agent-desktop cannot do.
3. CUA stops failing with "daemon is not running": Otter auto-starts and supervises cua-driver.
4. Clear, actionable errors everywhere (missing binary, missing permission, no GUI session) — no hangs, no misleading messages.

## Part A — agent-desktop integration

1. **New tool group** `agent-desktop` in the existing tool-groups system (same mechanism as the other 16 groups: persisted in ~/.otter/tool-groups.json, exposed via GET/POST /api/tool-groups and the Dashboard toggles). Default: **enabled**. Turning it off must remove its tools from discovery immediately, like other groups.
2. **MCP bridge:** the daemon spawns `agent-desktop mcp` as a child stdio MCP server (lazy-start on first use of any of its tools, not at daemon boot). Bridge its tools into Otter's tool list with a distinct prefix (e.g. `adesktop_snapshot`, `adesktop_click`) so there are zero name collisions with the existing `desktop_*` tools. Keep the argument schemas faithful to agent-desktop's.
3. **Lifecycle:** health-check the child (e.g. `agent-desktop status` semantics via the MCP `desktop_status` tool or process liveness); restart it on crash with a cooldown and an in-flight guard (mirror the `ensureCdpChrome` pattern); shut it down cleanly with the daemon. No orphan processes.
4. **Install detection:** if `agent-desktop` is not on PATH, tool calls must return a clear error telling the user to install it (`npm install -g agent-desktop`) instead of a raw spawn failure. Optionally add a setup helper next to `tools/cua/setup-cua.ts` (e.g. `tools/agent-desktop/setup-agent-desktop.ts`) — keep it minimal.
5. **Platforms:** Windows first (this machine), but structure the spawn/health code so macOS works the same way (binary name and args identical; macOS needs the Accessibility grant, which `agent-desktop permissions --guide` walks the user through — Otter only reports the state, never grants it).

## Part B — Priority and fallback policy

1. **Preferred path:** agent-desktop for: reading UI state (snapshot/get/list), semantic click/type/select on refs, app/window management.
2. **Fallback triggers:** agent-desktop returns POLICY_DENIED, or ACTION_FAILED caused by foreground requirements (raw key presses, foreground-only input), or the task needs CUA-only capability (browser mutation routes, background Chromium input, elevated targets where CUA is proven).
3. **Fallback behavior:**
   - Read-only operations: automatic fallback to the CUA/desktop equivalent is allowed.
   - Mutating operations: retry through CUA only where a safe equivalent exists; otherwise return a structured error that names the fallback tool to use. Never silently perform a *different* action than requested.
   - Log which backend served each call (agent-desktop / cua / desktop) at info level, so behavior is auditable.
4. Document the policy in the tool descriptions themselves, so calling AIs pick the right tool first.

## Part C — CUA daemon self-heal (the fix)

Per trycua's official docs (github.com/trycua/cua, libs/cua-driver/README.md):

1. **Auto-start:** when a `cua_*` tool is called and the driver socket is not listening, Otter starts the daemon itself:
   - Windows: `cua-driver serve --socket \\.\pipe\cua-driver`.
   - macOS: only via the supported standalone (CuaDriver.app daemon) or embedded host paths — **never** raw-spawn the bare binary on macOS (no stable bundle identity for TCC grants). If neither is available, return a clear error.
   - In-flight guard + failure cooldown, mirroring `ensureCdpChrome`.
2. **Health check** before CUA calls; distinguish and report: driver not installed, driver not running (and auto-start failed), missing OS permission (macOS Accessibility/Screen Recording), no interactive GUI session.
3. **Permission mode** (`standard` default / `bounded` / `unrestricted`) configurable in Otter settings; it is fixed at daemon launch, so changing it restarts the driver.
4. **Session correctness:** the driver must run in the user's interactive GUI session (Windows console/RDP session, not session 0). If Otter cannot spawn it there, say so in the error.
5. Reuse/refresh `tools/cua/setup-cua.ts` for the install step; keep it aligned with trycua's current official installers.

## Rules

- Work on a **separate branch** (suggested: `feat/agent-desktop-cua`), never commit straight to main. Report to pham **before** deploying — do not deploy on your own.
- No tokens/passwords/keys in files, commits, or logs.
- Run the existing test suite; add tests for: tool-group toggle behavior, MCP bridge lifecycle (start/health/restart), fallback routing decisions, CUA auto-start guard/cooldown. Follow the repo's checklist for adding MCP tools (AGENTS.md).
- Verify live on this Windows machine after building (smoke on a spare port first, like previous deploys), and report concrete results.

## Acceptance criteria

1. With the `agent-desktop` group ON: its tools appear in discovery; `adesktop_snapshot` on Notepad returns refs; `adesktop_click` on a ref works; turning the group OFF removes the tools.
2. Killing the `agent-desktop mcp` child process → next call restarts it automatically (no orphan processes after daemon shutdown).
3. With cua-driver stopped: first `cua_*` call auto-starts it and succeeds; second call does not spawn a duplicate.
4. A foreground-dependent action that agent-desktop cannot do returns the documented fallback behavior (CUA retry where safe, else a structured error naming the fallback tool) — never a hang or a raw stack trace.
5. Existing tests still pass; new tests cover the areas listed in Rules.
6. Report back with: branch name, commit(s), test results, and live-verification evidence. Deploy only after pham approves.

— Sunny
