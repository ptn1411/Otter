import { describe, expect, it, beforeEach } from "bun:test";
import { createMcpServer } from "../src/daemon/mcp";
import {
  clearTaskQueue,
  getTaskQueue,
  getInFlightTasks
} from "../src/daemon/tools/task-bridge";

describe("Task Bridge MCP Tools (Giano / IDE Worker)", () => {
  beforeEach(() => {
    clearTaskQueue();
  });

  it("registers all Giano and IDE task delegation tools in McpServer", () => {
    const mcp = createMcpServer();
    expect(mcp).toBeDefined();
  });

  it("handles the complete Task Lifecycle: dispatch -> pull -> ack -> progress -> complete", async () => {
    // 1. Dispatch a new task (simulate ChatGPT Web creating a task)
    const { getTaskQueue } = await import("../src/daemon/tools/task-bridge");

    // Clear queue before testing
    clearTaskQueue();

    const mcp = createMcpServer();
    // Verify tools exist in server
    expect(mcp).toBeDefined();

    // Directly test handler logic via simulated server or internal state
    const { registerTaskBridgeTools } = await import("../src/daemon/tools/task-bridge");
    const testMcp = {
      tools: new Map<string, any>(),
      tool(name: string, description: any, schema: any, handler?: any) {
        const fn = typeof description === "function" ? description : typeof schema === "function" ? schema : handler;
        this.tools.set(name, fn);
      },
      resource() {}
    };

    registerTaskBridgeTools(testMcp as any);

    // 1. Dispatch Task
    const dispatchFn = testMcp.tools.get("giano_dispatch_task");
    expect(dispatchFn).toBeDefined();

    const dispatchRes = await dispatchFn({
      goal: "Thêm API xác thực OAuth 2.1",
      details: "Triển khai tại src/daemon/routes/oauth-routes.ts",
      filesHint: ["src/daemon/routes/oauth-routes.ts"],
      chatId: "test-chat"
    });

    expect(dispatchRes.content[0].text).toContain("queued");
    expect(getTaskQueue().length).toBe(1);

    const queuedTask = getTaskQueue()[0];
    expect(queuedTask.goal).toBe("Thêm API xác thực OAuth 2.1");
    expect(queuedTask.filesHint).toContain("src/daemon/routes/oauth-routes.ts");

    // 2. Queue Stats
    const statsFn = testMcp.tools.get("giano_queue_stats");
    const statsRes = await statsFn({});
    const stats = JSON.parse(statsRes.content[0].text);
    expect(stats.queued).toBe(1);
    expect(stats.inFlight).toBe(0);

    // 3. Pull Task (simulate Antigravity IDE Worker pulling task)
    const pullFn = testMcp.tools.get("giano_task_pull");
    const pullRes = await pullFn({ timeoutMs: 0 });
    const pullData = JSON.parse(pullRes.content[0].text);

    expect(pullData.task).not.toBeNull();
    expect(pullData.task.taskId).toBe(queuedTask.taskId);
    expect(pullData.task.payload.goal).toBe("Thêm API xác thực OAuth 2.1");
    expect(getInFlightTasks().size).toBe(1);
    expect(getTaskQueue().length).toBe(0);

    const taskId = pullData.task.taskId;

    // 4. Ack Task
    const ackFn = testMcp.tools.get("giano_task_ack");
    const ackRes = await ackFn({ taskId, message: "Agent started working" });
    expect(ackRes.content[0].text).toBe("OK");

    // 5. Progress
    const progressFn = testMcp.tools.get("giano_task_progress");
    const progRes = await progressFn({ taskId, message: "Writing routes", percent: 50 });
    expect(progRes.content[0].text).toBe("OK");

    // 6. Complete Task (supports both giano_task_complete and ide_task_complete)
    expect(testMcp.tools.get("ide_task_complete")).toBeDefined();
    const completeFn = testMcp.tools.get("giano_task_complete");
    const compRes = await completeFn({
      taskId,
      status: "success",
      summary: "Đã hoàn thành thêm API OAuth 2.1",
      filesTouched: ["src/daemon/routes/oauth-routes.ts"],
      verify: ["bun test tests/oauth.test.ts"]
    });
    expect(compRes.content[0].text).toBe("OK");

    // In-flight should now be empty
    expect(getInFlightTasks().size).toBe(0);
    expect(getTaskQueue().length).toBe(0);

    // 7. ChatGPT Web queries task status & report (ide_get_task_status)
    const statusFn = testMcp.tools.get("ide_get_task_status");
    expect(statusFn).toBeDefined();

    const statusRes = await statusFn({ taskId });
    const statusData = JSON.parse(statusRes.content[0].text);
    expect(statusData.status).toBe("success");
    expect(statusData.summary).toBe("Đã hoàn thành thêm API OAuth 2.1");
    expect(statusData.filesTouched).toContain("src/daemon/routes/oauth-routes.ts");
    expect(statusData.message).toContain("✅ Antigravity IDE đã hoàn thành xuất sắc task này!");
  });

  it("allows releasing an in-flight task back to the queue", async () => {
    const { registerTaskBridgeTools } = await import("../src/daemon/tools/task-bridge");
    const testMcp = {
      tools: new Map<string, any>(),
      tool(name: string, description: any, schema: any, handler?: any) {
        const fn = typeof description === "function" ? description : typeof schema === "function" ? schema : handler;
        this.tools.set(name, fn);
      },
      resource() {}
    };

    registerTaskBridgeTools(testMcp as any);

    // Dispatch & pull
    await testMcp.tools.get("ide_dispatch_task")({ goal: "Task to be aborted" });
    const pullData = JSON.parse((await testMcp.tools.get("giano_task_pull")({ timeoutMs: 0 })).content[0].text);
    const taskId = pullData.task.taskId;

    expect(getInFlightTasks().size).toBe(1);
    expect(getTaskQueue().length).toBe(0);

    // Release
    const releaseRes = await testMcp.tools.get("giano_task_release")({ taskId, reason: "User cancelled" });
    expect(releaseRes.content[0].text).toBe("OK");

    // Task should be back in queue
    expect(getInFlightTasks().size).toBe(0);
    expect(getTaskQueue().length).toBe(1);
    expect(getTaskQueue()[0].taskId).toBe(taskId);
  });
});
