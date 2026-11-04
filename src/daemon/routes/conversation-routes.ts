import { Database } from "bun:sqlite";
import { getSessionsForConversation, readTerminalOutput, sendTerminalInput } from "../terminal";
import { jsonResponse, errorResponse } from "./common";
import { matchDaemonRoute, matchDaemonRoutePrefix, getDaemonRoute } from "./lcg-routes";

export async function handleConversationRoutes(
  req: Request,
  url: URL,
  db: Database,
  broadcast: (event: any) => void
): Promise<Response | null> {
  // 1. Pending Bind Status
  if (matchDaemonRoute(url.pathname, "ACT_PENDING_BIND") && req.method === "GET") {
    return jsonResponse({
      status: "ready",
      codes: ["OTTER1", "CHATMCP1"]
    });
  }

  // 2. Bind Conversation
  if (matchDaemonRoute(url.pathname, "ACT_BIND") && req.method === "POST") {
    const body: any = await req.json();
    const convId = body.conversationId || "conv-" + Date.now();
    db.query(
      "INSERT OR REPLACE INTO conversation_scopes (conversation_id, conversation_url, bound_at, status) VALUES (?, ?, ?, 'bound')"
    ).run(convId, body.conversationUrl || "", Date.now());

    broadcast({
      type: "bound",
      conversationId: convId
    });

    return jsonResponse({ ok: true, conversationId: convId });
  }

  // 3. Conversation APIs: /api/activity/v1/conversations/:id/...
  if (matchDaemonRoutePrefix(url.pathname, "ACT_CONV_PREFIX")) {
    const convPrefix = getDaemonRoute("ACT_CONV_PREFIX");
    const remainder = url.pathname.slice(convPrefix.length);
    const slashIdx = remainder.indexOf("/");
    const convId = decodeURIComponent(slashIdx === -1 ? remainder : remainder.slice(0, slashIdx));
    const subPath = slashIdx === -1 ? "" : remainder.slice(slashIdx);

    // 3.1 Terminals List: GET /conversations/:id/terminals
    if (subPath === "/terminals" && req.method === "GET") {
      const sessions = getSessionsForConversation(convId);
      return jsonResponse({
        terminals: sessions.map(s => ({
          id: s.id,
          shell: s.shell,
          busy: s.busy,
          inputAllowed: s.inputAllowed
        }))
      });
    }

    // 3.2 Terminal Live Output: GET /conversations/:id/terminals/:sessionId/live
    const terminalLiveMatch = subPath.match(/^\/terminals\/([0-9a-f-]+)\/live$/);
    if (terminalLiveMatch && req.method === "GET") {
      const sessionId = terminalLiveMatch[1];
      const afterSequence = Number(url.searchParams.get("afterSequence") || 0);
      const waitMs = Number(url.searchParams.get("waitMs") || 5000);
      const res = await readTerminalOutput(sessionId, afterSequence, waitMs);
      return jsonResponse(res);
    }

    // 3.3 Terminal Input: POST /conversations/:id/terminals/:sessionId/input
    const terminalInputMatch = subPath.match(/^\/terminals\/([0-9a-f-]+)\/input$/);
    if (terminalInputMatch && req.method === "POST") {
      const sessionId = terminalInputMatch[1];
      const body: any = await req.json();
      const accepted = await sendTerminalInput(sessionId, body.text || "");
      return jsonResponse({ accepted });
    }

    // 3.4 Control Status: GET /conversations/:id/control
    if (subPath === "/control" && req.method === "GET") {
      const row: any = db.query(
        "SELECT continuous_enabled, mcp_usage_enabled FROM conversation_settings WHERE conversation_id = ?"
      ).get(convId);

      const continuous = row ? Boolean(row.continuous_enabled) : false;
      const mcpUsage = row ? Boolean(row.mcp_usage_enabled) : true;

      return jsonResponse({
        conversationId: convId,
        bound: true,
        continuousInteraction: {
          enabled: continuous,
          status: continuous ? "active" : "idle"
        },
        mcpUsage: {
          enabled: mcpUsage
        },
        serverNowMs: Date.now()
      });
    }

    // 3.5 Continuous Set: PUT /conversations/:id/continuous
    if (subPath === "/continuous" && req.method === "PUT") {
      const body: any = await req.json();
      const enabled = Boolean(body.enabled);
      db.query(`
        INSERT INTO conversation_settings (conversation_id, continuous_enabled, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          continuous_enabled = excluded.continuous_enabled,
          updated_at = excluded.updated_at
      `).run(convId, enabled ? 1 : 0, Date.now());

      return jsonResponse({
        continuousInteraction: {
          enabled,
          status: enabled ? "active" : "idle"
        },
        serverNowMs: Date.now()
      });
    }

    // 3.6 Continuous Extend: POST /conversations/:id/continuous/extend
    if (subPath === "/continuous/extend" && req.method === "POST") {
      const body: any = await req.json();
      return jsonResponse({ ok: true, extended: true, seconds: body.seconds || 60 });
    }

    // 3.7 MCP Usage Set: PUT /conversations/:id/mcp-usage
    if (subPath === "/mcp-usage" && req.method === "PUT") {
      const body: any = await req.json();
      const enabled = Boolean(body.enabled);
      db.query(`
        INSERT INTO conversation_settings (conversation_id, mcp_usage_enabled, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET
          mcp_usage_enabled = excluded.mcp_usage_enabled,
          updated_at = excluded.updated_at
      `).run(convId, enabled ? 1 : 0, Date.now());

      return jsonResponse({
        mcpUsage: { enabled }
      });
    }

    // 3.8 Immediate Steer
    if (subPath === "/immediate") {
      if (req.method === "GET") {
        const messages = db.query(
          "SELECT id as messageId, content, created_at as createdAt FROM immediate_messages WHERE conversation_id = ? ORDER BY created_at ASC"
        ).all(convId);
        return jsonResponse({ conversationId: convId, messages });
      }
      if (req.method === "POST") {
        const body: any = await req.json();
        const msgId = "imm-" + Date.now();
        db.query(
          "INSERT INTO immediate_messages (id, conversation_id, content, created_at) VALUES (?, ?, ?, ?)"
        ).run(msgId, convId, body.content || "", Date.now());
        return jsonResponse({ ok: true, messageId: msgId });
      }
    }

    const immDeleteMatch = subPath.match(/^\/immediate\/([^\/]+)$/);
    if (immDeleteMatch && req.method === "DELETE") {
      const msgId = decodeURIComponent(immDeleteMatch[1]);
      db.query("DELETE FROM immediate_messages WHERE id = ?").run(msgId);
      return jsonResponse({ ok: true });
    }

    // 3.9 Activity Events List
    if (subPath === "/events") {
      if (req.method === "GET") {
        const rows = db.query(
          "SELECT id as sequence, event_type as type, payload, created_at as timestamp FROM timeline_events WHERE conversation_id = ? ORDER BY id ASC LIMIT 50"
        ).all(convId) as any[];

        const items = rows.map(r => {
          try { return JSON.parse(r.payload); } catch { return { title: r.type, description: r.payload }; }
        });

        return jsonResponse({
          conversationId: convId,
          items
        });
      }

      if (req.method === "DELETE") {
        db.query("DELETE FROM timeline_events WHERE conversation_id = ?").run(convId);
        return jsonResponse({ ok: true });
      }
    }

    // 3.10 Delete single event
    const eventDeleteMatch = subPath.match(/^\/events\/(\d+)$/);
    if (eventDeleteMatch && req.method === "DELETE") {
      const seq = Number(eventDeleteMatch[1]);
      db.query("DELETE FROM timeline_events WHERE conversation_id = ? AND id = ?").run(convId, seq);
      return jsonResponse({ ok: true });
    }

    // 3.11 User Turn & Lifecycle
    if (subPath === "/user-turn" && req.method === "POST") {
      return jsonResponse({ ok: true });
    }
    if (subPath === "/stop" && req.method === "POST") {
      return jsonResponse({ ok: true, status: "stopped" });
    }
    if (subPath === "/reopen" && req.method === "POST") {
      return jsonResponse({ ok: true, status: "active" });
    }
  }

  return null;
}
