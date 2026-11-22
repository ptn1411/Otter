import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ensureA2aInboxTables,
  sendInboxMessage,
  pullInbox,
  ackInboxMessage,
  getInboxStats,
  getInboxMessage,
  listBots,
  a2aInboxEvents,
} from "../src/daemon/a2a-inbox";

describe("A2A Multi-Agent Coordination E2E", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureA2aInboxTables(db as any);
  });

  it("should execute full multi-agent task exchange: Sunny -> Anti -> Ack", async () => {
    const events: string[] = [];
    const unsubSent = a2aInboxEvents.on("message_sent", () => events.push("sent"));
    const unsubPulled = a2aInboxEvents.on("message_pulled", () => events.push("pulled"));
    const unsubAcked = a2aInboxEvents.on("message_acked", () => events.push("acked"));

    // 1. Verify registered bots
    const bots = listBots(db as any);
    expect(bots.some(b => b.botId === "ai_sunny")).toBe(true);
    expect(bots.some(b => b.botId === "ai_antigravity")).toBe(true);

    // 2. Sunny sends task to Antigravity (Store-and-Forward)
    const task = await sendInboxMessage({
      senderId: "ai_sunny",
      recipientId: "ai_antigravity",
      goal: "Implement A2A store-and-forward",
      details: "Ensure offline durability and lease locks",
      priority: 8,
      payload: { releaseVersion: "2.3.6" },
    }, db as any);

    expect(task.status).toBe("queued");
    expect(task.priority).toBe(8);

    let stats = getInboxStats(db as any);
    expect(stats.queued).toBe(1);
    expect(stats.inFlight).toBe(0);

    // 3. Antigravity wakes up and pulls task with lease
    const pulled = pullInbox({
      recipientId: "ai_antigravity",
      workerId: "windows-anti-worker-1",
      limit: 1,
      leaseMs: 120_000,
    }, db as any);

    expect(pulled.length).toBe(1);
    expect(pulled[0].id).toBe(task.id);
    expect(pulled[0].status).toBe("in_flight");
    expect(pulled[0].leaseOwner).toBe("windows-anti-worker-1");

    stats = getInboxStats(db as any);
    expect(stats.queued).toBe(0);
    expect(stats.inFlight).toBe(1);

    // 4. Antigravity executes task and sends completion ack
    const ackRes = ackInboxMessage({
      messageId: task.id,
      workerId: "windows-anti-worker-1",
      status: "acked",
      resultSummary: "Successfully built and tested 3 phases of A2A migration",
      result: { testsPassed: 15, buildReady: true },
      artifacts: [{ name: "a2a-migration-status.md", mimeType: "text/markdown" }],
    }, db as any);

    expect(ackRes.ok).toBe(true);

    const completed = getInboxMessage(task.id, db as any);
    expect(completed?.status).toBe("acked");
    expect(completed?.resultSummary).toContain("Successfully built and tested");
    expect(completed?.artifacts?.length).toBe(1);

    stats = getInboxStats(db as any);
    expect(stats.queued).toBe(0);
    expect(stats.inFlight).toBe(0);
    expect(stats.acked).toBe(1);

    // Verify events were emitted
    expect(events).toContain("sent");
    expect(events).toContain("pulled");
    expect(events).toContain("acked");
  });
});
