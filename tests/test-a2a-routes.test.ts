import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { handleA2aRoutes } from "../src/daemon/routes/a2a-routes";
import { ensureA2aInboxTables } from "../src/daemon/a2a-inbox";

describe("A2A Routes REST & JSON-RPC", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureA2aInboxTables(db as any);
  });

  it("should return public agent card", async () => {
    const req = new Request("http://localhost:1993/.well-known/agent-card.json");
    const url = new URL(req.url);
    const res = await handleA2aRoutes(req, url, db as any);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const card = await res?.json();
    expect(card.name).toContain("Otter");
  });

  it("should send message via POST /api/a2a/send", async () => {
    const req = new Request("http://localhost:1993/api/a2a/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: "ai_sunny",
        recipientId: "ai_antigravity",
        goal: "Deploy new feature",
        priority: 5,
      }),
    });
    const url = new URL(req.url);
    const res = await handleA2aRoutes(req, url, db as any);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(201);
    const body = await res?.json();
    expect(body.ok).toBe(true);
    expect(body.message.goal).toBe("Deploy new feature");
    expect(body.message.status).toBe("queued");
  });

  it("should pull tasks via POST /api/a2a/pull", async () => {
    // Send 1 task first
    const sendReq = new Request("http://localhost:1993/api/a2a/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: "ai_sunny",
        recipientId: "ai_muse002",
        goal: "Scrape links",
      }),
    });
    await handleA2aRoutes(sendReq, new URL(sendReq.url), db as any);

    // Pull
    const pullReq = new Request("http://localhost:1993/api/a2a/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: "ai_muse002",
        workerId: "node-hatch",
      }),
    });
    const res = await handleA2aRoutes(pullReq, new URL(pullReq.url), db as any);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    expect(body.tasks[0].status).toBe("in_flight");
    expect(body.tasks[0].leaseOwner).toBe("node-hatch");
  });

  it("should ack task via POST /api/a2a/ack", async () => {
    const sendReq = new Request("http://localhost:1993/api/a2a/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderId: "ai_sunny",
        recipientId: "ai_muse003",
        goal: "Video render",
      }),
    });
    const sendRes = await handleA2aRoutes(sendReq, new URL(sendReq.url), db as any);
    const sendBody = await sendRes?.json();
    const taskId = sendBody.message.id;

    // Ack
    const ackReq = new Request("http://localhost:1993/api/a2a/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: taskId,
        status: "acked",
        resultSummary: "Rendered in 4.2s",
      }),
    });
    const res = await handleA2aRoutes(ackReq, new URL(ackReq.url), db as any);
    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("acked");
    expect(body.task.resultSummary).toBe("Rendered in 4.2s");
  });

  it("should list bots via GET /api/a2a/bots", async () => {
    const req = new Request("http://localhost:1993/api/a2a/bots");
    const res = await handleA2aRoutes(req, new URL(req.url), db as any);
    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.ok).toBe(true);
    expect(body.bots.length).toBeGreaterThanOrEqual(4);
  });
});
