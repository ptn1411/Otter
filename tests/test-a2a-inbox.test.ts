import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  ensureA2aInboxTables,
  sendInboxMessage,
  pullInbox,
  ackInboxMessage,
  cancelInboxMessage,
  getInboxMessage,
  listInboxMessages,
  getInboxStats,
  listBots,
  getBot,
  registerBot,
  reclaimExpiredLeases,
} from "../src/daemon/a2a-inbox";

describe("A2A Store-and-Forward Inbox Engine", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureA2aInboxTables(db as any);
  });

  it("should bootstrap default bot identities", () => {
    const bots = listBots(db as any);
    expect(bots.length).toBeGreaterThanOrEqual(4);
    const anti = getBot("ai_antigravity", db as any);
    expect(anti).not.toBeNull();
    expect(anti?.name).toContain("Antigravity");
    const sunny = getBot("ai_sunny", db as any);
    expect(sunny).not.toBeNull();
  });

  it("should send and queue message for offline recipient", async () => {
    const msg = await sendInboxMessage({
      senderId: "ai_sunny",
      recipientId: "ai_antigravity",
      goal: "Build A2A inbox",
      details: "Full 3-phase implementation",
      priority: 10,
    }, db as any);

    expect(msg.id).toStartWith("msg_");
    expect(msg.status).toBe("queued");
    expect(msg.recipientId).toBe("ai_antigravity");
    expect(msg.priority).toBe(10);

    const stats = getInboxStats(db as any);
    expect(stats.queued).toBe(1);
    expect(stats.inFlight).toBe(0);
  });

  it("should pull message with lease lock", async () => {
    await sendInboxMessage({
      senderId: "ai_sunny",
      recipientId: "ai_antigravity",
      goal: "Task 1",
      priority: 1,
    }, db as any);

    await sendInboxMessage({
      senderId: "ai_sunny",
      recipientId: "ai_antigravity",
      goal: "Task 2 (High Priority)",
      priority: 5,
    }, db as any);

    const pulled = pullInbox({
      recipientId: "ai_antigravity",
      workerId: "windows-anti",
      limit: 1,
      leaseMs: 60_000,
    }, db as any);

    expect(pulled.length).toBe(1);
    expect(pulled[0].goal).toBe("Task 2 (High Priority)");
    expect(pulled[0].status).toBe("in_flight");
    expect(pulled[0].leaseOwner).toBe("windows-anti");
    expect(pulled[0].attemptCount).toBe(1);

    const stats = getInboxStats(db as any);
    expect(stats.queued).toBe(1);
    expect(stats.inFlight).toBe(1);
  });

  it("should acknowledge completed task with result", async () => {
    const msg = await sendInboxMessage({
      senderId: "ai_sunny",
      recipientId: "ai_muse002",
      goal: "Scrape Facebook feed",
    }, db as any);

    pullInbox({ recipientId: "ai_muse002" }, db as any);

    const ack = ackInboxMessage({
      messageId: msg.id,
      status: "acked",
      resultSummary: "Scraped 25 posts",
      result: { count: 25 },
    }, db as any);

    expect(ack.ok).toBe(true);
    const updated = getInboxMessage(msg.id, db as any);
    expect(updated?.status).toBe("acked");
    expect(updated?.resultSummary).toBe("Scraped 25 posts");
    expect(updated?.result?.count).toBe(25);
  });

  it("should reclaim expired leases and re-queue", async () => {
    const msg = await sendInboxMessage({
      senderId: "ai_sunny",
      recipientId: "ai_muse003",
      goal: "Render video",
      maxAttempts: 2,
    }, db as any);

    // Pull with very short lease (10ms)
    pullInbox({
      recipientId: "ai_muse003",
      leaseMs: 10,
    }, db as any);

    // Manually force lease_until to past
    db.run("UPDATE a2a_inbox_messages SET lease_until = 1000 WHERE id = ?", [msg.id]);

    const reclaimed = reclaimExpiredLeases(db as any);
    expect(reclaimed).toBe(1);

    const requeued = getInboxMessage(msg.id, db as any);
    expect(requeued?.status).toBe("queued");
    expect(requeued?.leaseOwner).toBeNull();

    // Pull again (attempt 2)
    pullInbox({ recipientId: "ai_muse003", leaseMs: 10 }, db as any);
    db.run("UPDATE a2a_inbox_messages SET lease_until = 1000 WHERE id = ?", [msg.id]);

    // Second expiry hits maxAttempts (2) -> should mark failed
    reclaimExpiredLeases(db as any);
    const failed = getInboxMessage(msg.id, db as any);
    expect(failed?.status).toBe("failed");
    expect(failed?.resultSummary).toContain("max retry");
  });

  it("should cancel queued task", async () => {
    const msg = await sendInboxMessage({
      senderId: "user_pham",
      recipientId: "ai_antigravity",
      goal: "Long task",
    }, db as any);

    const res = cancelInboxMessage(msg.id, "No longer needed", db as any);
    expect(res.ok).toBe(true);

    const cancelled = getInboxMessage(msg.id, db as any);
    expect(cancelled?.status).toBe("cancelled");
  });

  it("should register and update custom bot", () => {
    const custom = registerBot({
      botId: "ai_tester",
      name: "Test Bot",
      description: "Dedicated QA runner",
      capabilities: ["testing", "validation"],
      preferredNode: "local",
    }, db as any);

    expect(custom.botId).toBe("ai_tester");
    expect(custom.capabilities).toContain("testing");
  });
});
