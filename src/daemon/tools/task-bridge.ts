/**
 * Task Bridge & Delegation Tools (Giano / IDE Worker Integration)
 * Extracted and optimized directly from mcp-giano-bridge.
 * Provides a clean MCP task queue layer connecting ChatGPT Web (PM) and Antigravity IDE (Worker).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as crypto from "node:crypto";
import { getDatabase } from "../db";
import {
  getPlan,
  getPlanStatus,
  getPlanTask,
  getPlanTasks,
  recordPlanTaskHeartbeat,
  refreshPlanStatus,
  setPlanTaskStatus,
} from "../plan";
import {
  buildContinuationPrompt,
  buildFinalPrompt,
  isRiskyTask,
  recoverBridgeTasks,
  runVerifyGate,
  sweepStaleTasks,
} from "../continuous-loop";

export interface BridgeTaskItem {
  taskId: string;
  chatId: string;
  messageId: string;
  replyToId: string;
  fromUserId: string;
  receivedAt: string;
  rawText: string;
  goal: string;
  details?: string;
  filesHint?: string[];
  planId?: string;
  planTaskId?: string;
  /** ISO timestamp of the last heartbeat, for the Phase 3 sweeper. */
  heartbeatAt?: string;
  payload: {
    version: "v2";
    taskId: string;
    goal: string;
    details?: string;
    filesHint?: string[];
    planId?: string;
    planTaskId?: string;
  };
}

// In-memory queue & in-flight tracking
const taskQueue: BridgeTaskItem[] = [];
const inFlightTasks = new Map<string, BridgeTaskItem>();

export interface CompletedTaskRecord {
  taskId: string;
  chatId: string;
  goal: string;
  status: "success" | "failed" | "blocked";
  summary: string;
  filesTouched?: string[];
  verify?: string[];
  completedAt: string;
}

const completedTasks = new Map<string, CompletedTaskRecord>();

export function getTaskQueue(): BridgeTaskItem[] {
  return [...taskQueue];
}

export function getInFlightTasks(): Map<string, BridgeTaskItem> {
  return new Map(inFlightTasks);
}

export function getCompletedTasks(): Map<string, CompletedTaskRecord> {
  return new Map(completedTasks);
}

export function clearTaskQueue(): void {
  taskQueue.length = 0;
  inFlightTasks.clear();
  completedTasks.clear();
}

function toBridgeItem(row: {
  id: string;
  conversationId: string;
  title: string;
  details: string | null;
  filesHint: string[];
  verify: string[];
  planId: string | null;
  planTaskId: string | null;
}): BridgeTaskItem {
  return {
    taskId: row.id,
    chatId: row.conversationId,
    messageId: `msg_${row.id}`,
    replyToId: "",
    fromUserId: "chatgpt",
    receivedAt: new Date().toISOString(),
    rawText: row.details ? `${row.title}\n\nChi tiết:\n${row.details}` : row.title,
    goal: row.title,
    details: row.details ?? undefined,
    filesHint: row.filesHint,
    planId: row.planId ?? undefined,
    planTaskId: row.planTaskId ?? undefined,
    payload: {
      version: "v2",
      taskId: row.id,
      goal: row.title,
      details: row.details ?? undefined,
      filesHint: row.filesHint,
      planId: row.planId ?? undefined,
      planTaskId: row.planTaskId ?? undefined,
    },
  };
}

/**
 * Phase 2 — rebuild the in-memory queue from SQLite after a daemon restart.
 * Pending rows go back to the queue (in creation order, deduplicated against
 * what is already queued/in-flight). Running rows with a recent heartbeat
 * are restored to in-flight so a live worker can ack/complete them; stale
 * running rows are already moved to pending by recoverBridgeTasks().
 * Safe to call repeatedly; second calls are no-ops for already-restored rows.
 */
export function recoverTaskQueue(db: ReturnType<typeof getDatabase>): { queued: number; inFlight: number } {
  const { pending, stillRunning } = recoverBridgeTasks(db as any);
  let queued = 0;
  for (const row of pending) {
    if (taskQueue.some((t) => t.taskId === row.id) || inFlightTasks.has(row.id)) continue;
    taskQueue.push(toBridgeItem(row));
    queued += 1;
  }
  let restored = 0;
  for (const row of stillRunning) {
    if (inFlightTasks.has(row.id) || taskQueue.some((t) => t.taskId === row.id)) continue;
    inFlightTasks.set(row.id, toBridgeItem(row));
    restored += 1;
  }
  return { queued, inFlight: restored };
}

/**
 * Phase 3 — sweep stale in-flight tasks (DB + in-memory). Returns the ids
 * that were recovered to pending or blocked, so the daemon can log/notify.
 */
export function sweepStaleBridgeTasks(db: ReturnType<typeof getDatabase>): ReturnType<typeof sweepStaleTasks> {
  const result = sweepStaleTasks(db as any);
  for (const id of [...result.bridgeRecovered, ...result.bridgeBlocked]) {
    const item = inFlightTasks.get(id);
    if (!item) continue;
    inFlightTasks.delete(id);
    if (result.bridgeRecovered.includes(id)) taskQueue.unshift(item);
  }
  // Plan tasks have no in-memory bridge queue; their DB state is the truth.
  return result;
}

function touchHeartbeat(db: ReturnType<typeof getDatabase>, task: BridgeTaskItem): void {
  const nowMs = Date.now();
  task.heartbeatAt = new Date(nowMs).toISOString();
  try {
    db.run("UPDATE tasks SET last_heartbeat_at = ? WHERE id = ?", [nowMs, task.taskId]);
    if (task.planTaskId) {
      try {
        recordPlanTaskHeartbeat(db as any, task.planTaskId);
      } catch {}
    }
  } catch {}
}

/**
 * Đăng ký bộ công cụ Task Bridge (Giano / IDE Worker) vào McpServer
 */
export function registerTaskBridgeTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 1. Tool giao việc từ ChatGPT Web (Dispatch Task)
  const dispatchToolHandler = async ({
    goal,
    details,
    filesHint,
    verify,
    chatId = "chatgpt-web",
    planId,
    planTaskId,
    orderIndex,
    dependsOn,
  }: {
    goal: string;
    details?: string;
    filesHint?: string[];
    verify?: string[];
    chatId?: string;
    planId?: string;
    planTaskId?: string;
    orderIndex?: number;
    dependsOn?: string[];
  }) => {
    // Phase 1: liên kết task lẻ với plan nếu caller cung cấp planId/planTaskId.
    // Không có planId thì hành vi y như cũ. Việc đổi trạng thái plan task
    // (pending -> running -> success) thuộc về Phase 2/4, không làm ở đây.
    let resolvedPlanId = planId;
    let resolvedPlanTaskId = planTaskId;
    if (planId || planTaskId || orderIndex !== undefined) {
      const dbForPlan = getDatabase();
      if (planTaskId) {
        const planTask = getPlanTask(dbForPlan, planTaskId);
        if (!planTask) throw new Error(`Unknown planTaskId: ${planTaskId}`);
        if (planId && planTask.planId !== planId) {
          throw new Error(`planTaskId ${planTaskId} does not belong to planId ${planId}.`);
        }
        resolvedPlanId = planTask.planId;
        resolvedPlanTaskId = planTask.id;
      } else if (planId) {
        const plan = getPlan(dbForPlan, planId);
        if (!plan) throw new Error(`Unknown planId: ${planId}`);
        if (plan.status === "done" || plan.status === "cancelled") {
          throw new Error(`Cannot dispatch a task for a ${plan.status} plan: ${planId}`);
        }
        if (orderIndex !== undefined) {
          const planTask = getPlanTasks(dbForPlan, planId).find((t) => t.orderIndex === orderIndex);
          if (!planTask) throw new Error(`No plan task with orderIndex ${orderIndex} in plan ${planId}.`);
          resolvedPlanTaskId = planTask.id;
        }
      }
    }

    const taskId = `task_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const rawText = details ? `${goal}\n\nChi tiết:\n${details}` : goal;

    // Phase 6 safety: refuse to queue a task that looks destructive, rather
    // than discovering it after a worker has already started it.
    const risk = isRiskyTask({ goal, details, filesHint });
    if (risk.risky) {
      throw new Error(`Task bị từ chối vì dấu hiệu nguy hiểm: ${risk.reasons.join("; ")}`);
    }

    const item: BridgeTaskItem = {
      taskId,
      chatId,
      messageId: `msg_${Date.now()}`,
      replyToId: "",
      fromUserId: "chatgpt",
      receivedAt: new Date().toISOString(),
      rawText,
      goal: goal.trim(),
      details,
      filesHint,
      planId: resolvedPlanId,
      planTaskId: resolvedPlanTaskId,
      payload: {
        version: "v2",
        taskId,
        goal: goal.trim(),
        details,
        filesHint,
        planId: resolvedPlanId,
        planTaskId: resolvedPlanTaskId,
      },
    };

    taskQueue.push(item);

    // Lưu trạng thái vào SQLite
    try {
      const db = getDatabase();
      db.run(
        "INSERT OR REPLACE INTO tasks (id, conversation_id, title, status, created_at, plan_id, plan_task_id, attempt_count, last_heartbeat_at, details, files_hint_json, verify_json) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)",
        [taskId, chatId, goal, "pending", Date.now(), resolvedPlanId ?? null, resolvedPlanTaskId ?? null, details ?? null, JSON.stringify(filesHint ?? []), JSON.stringify(verify ?? [])],
      );
      db.run(
        "INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
        [chatId, "task_dispatched", JSON.stringify({ taskId, goal, details, filesHint, planId: resolvedPlanId ?? null, planTaskId: resolvedPlanTaskId ?? null, orderIndex: orderIndex ?? null, dependsOn: dependsOn ?? [] }), Date.now()],
      );
    } catch {}

    onActivity?.({
      type: "ide_task_dispatched",
      taskId,
      goal,
      queuedCount: taskQueue.length,
      planId: resolvedPlanId,
      planTaskId: resolvedPlanTaskId,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "queued",
              taskId,
              planId: resolvedPlanId ?? null,
              planTaskId: resolvedPlanTaskId ?? null,
              message: `Đã đưa task '${goal}' vào hàng đợi cho Antigravity IDE.`,
              queuePosition: taskQueue.length
            },
            null,
            2
          )
        }
      ]
    };
  };

  mcp.tool(
    "giano_dispatch_task",
    "Giao việc từ ChatGPT Web cho Antigravity IDE Worker thực thi.",
    {
      goal: z.string().describe("Mục tiêu của task (ví dụ: 'Thêm endpoint /api/user', 'Sửa bug login')"),
      details: z.string().optional().describe("Mô tả chi tiết các bước hoặc tiêu chí hoàn thành"),
      filesHint: z.array(z.string()).optional().describe("Danh sách các file gợi ý cần chỉnh sửa"),
      verify: z.array(z.string()).optional().describe("Lệnh kiểm thử cho task này (Phase 6 verify gate, chỉ áp dụng khi task thuộc plan)"),
      chatId: z.string().optional().describe("ID định danh cuộc hội thoại"),
      planId: z.string().optional().describe("Phase 1: id của plan mà task này thuộc về (không bắt buộc, task lẻ cũ không cần)"),
      planTaskId: z.string().optional().describe("Phase 1: id của plan task tương ứng (ưu tiên hơn orderIndex)"),
      orderIndex: z.number().int().min(0).optional().describe("Phase 1: vị trí task trong plan, dùng để suy ra planTaskId khi không truyền planTaskId"),
      dependsOn: z.array(z.string()).optional().describe("Phase 1: id các plan task phải xong trước (ghi vào timeline, chưa dùng để chặn dispatch ở Phase 1)"),
    },
    dispatchToolHandler
  );

  mcp.tool(
    "ide_dispatch_task",
    "Giao việc từ ChatGPT Web cho Antigravity IDE Worker thực thi (Alias).",
    {
      goal: z.string().describe("Mục tiêu của task"),
      details: z.string().optional().describe("Mô tả chi tiết các bước"),
      filesHint: z.array(z.string()).optional().describe("Danh sách các file gợi ý cần chỉnh sửa"),
      verify: z.array(z.string()).optional().describe("Lệnh kiểm thử cho task này (Phase 6 verify gate, chỉ áp dụng khi task thuộc plan)"),
      chatId: z.string().optional().describe("ID định danh cuộc hội thoại"),
      planId: z.string().optional().describe("Phase 1: id của plan mà task này thuộc về (không bắt buộc)"),
      planTaskId: z.string().optional().describe("Phase 1: id của plan task tương ứng (ưu tiên hơn orderIndex)"),
      orderIndex: z.number().int().min(0).optional().describe("Phase 1: vị trí task trong plan, dùng để suy ra planTaskId khi không truyền planTaskId"),
      dependsOn: z.array(z.string()).optional().describe("Phase 1: id các plan task phải xong trước (ghi vào timeline)"),
    },
    dispatchToolHandler
  );

  // 2. Tool lấy task cho Antigravity IDE (giano_task_pull)
  mcp.tool(
    "giano_task_pull",
    "Pull the next pending task sent to the Giano bot / IDE queue. Returns {task:null} if none.",
    {
      timeoutMs: z.number().int().min(0).default(0).describe("Thời gian chờ tính bằng mili-giây (cho long polling)")
    },
    async ({ timeoutMs }) => {
      const started = Date.now();

      const tryPop = () => {
        const item = taskQueue.shift();
        if (!item) return null;
        inFlightTasks.set(item.taskId, item);

        try {
          const db = getDatabase();
          db.run("UPDATE tasks SET status = 'running', last_heartbeat_at = ? WHERE id = ?", [Date.now(), item.taskId]);
          // Phase 4: pulling a plan-linked bridge task starts its plan task.
          if (item.planTaskId) {
            try {
              setPlanTaskStatus(db as any, item.planTaskId, "running");
              recordPlanTaskHeartbeat(db as any, item.planTaskId);
            } catch {}
          }
          item.heartbeatAt = new Date().toISOString();
        } catch {}

        onActivity?.({
          type: "ide_task_started",
          taskId: item.taskId,
          goal: item.goal
        });

        return item;
      };

      let item = tryPop();
      while (!item && timeoutMs > 0 && Date.now() - started < timeoutMs) {
        await new Promise((r) => setTimeout(r, 200));
        item = tryPop();
      }

      const response = {
        version: "v2",
        task: item
          ? {
              taskId: item.taskId,
              chatId: item.chatId,
              messageId: item.messageId,
              replyToId: item.replyToId,
              fromUserId: item.fromUserId,
              receivedAt: item.receivedAt,
              payload: item.payload,
              rawText: item.rawText
            }
          : null
      };

      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }]
      };
    }
  );

  // 3. Tool xác nhận đã bắt đầu làm task (giano_task_ack)
  mcp.tool(
    "giano_task_ack",
    "Acknowledge that the IDE agent started working on the task.",
    {
      taskId: z.string().describe("Mã taskId đang thực hiện"),
      message: z.string().default("Agent started.").describe("Thông điệp thông báo"),
      silent: z.boolean().default(false).describe("Bỏ qua log thông báo nếu true")
    },
    async ({ taskId, message }) => {
      const task = inFlightTasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown taskId: ${taskId}`);
      }

      try {
        const db = getDatabase();
        touchHeartbeat(db, task);
        db.run(
          "INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
          [task.chatId, "task_ack", JSON.stringify({ taskId, message }), Date.now()]
        );
      } catch {}

      onActivity?.({
        type: "ide_task_ack",
        taskId,
        message
      });

      return { content: [{ type: "text", text: "OK" }] };
    }
  );

  // 3b. Tool heartbeat (Phase 3) — worker gọi mỗi ~60s để chứng minh còn sống.
  // Không có heartbeat trong 5 phút, sweeper sẽ nhả task về pending/blocked.
  mcp.tool(
    "giano_task_heartbeat",
    "Heartbeat for a task in flight. Call every ~60s while working; stale tasks are released after 5 minutes without a heartbeat.",
    { taskId: z.string().describe("Mã taskId đang thực hiện") },
    async ({ taskId }) => {
      const task = inFlightTasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown taskId: ${taskId}`);
      }
      const db = getDatabase();
      touchHeartbeat(db, task);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, taskId, heartbeatAt: task.heartbeatAt }, null, 2) }] };
    },
  );

  // 4. Tool báo cáo tiến độ (giano_task_progress)
  mcp.tool(
    "giano_task_progress",
    "Send progress update back for a task.",
    {
      taskId: z.string(),
      message: z.string(),
      percent: z.number().int().min(0).max(100).optional(),
      phase: z.string().optional()
    },
    async ({ taskId, message, percent, phase }) => {
      const task = inFlightTasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown taskId: ${taskId}`);
      }

      try {
        const db = getDatabase();
        touchHeartbeat(db, task);
        db.run(
          "INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
          [task.chatId, "task_progress", JSON.stringify({ taskId, message, percent, phase }), Date.now()]
        );
      } catch {}

      onActivity?.({
        type: "ide_task_progress",
        taskId,
        message,
        percent,
        phase
      });

      return { content: [{ type: "text", text: "OK" }] };
    }
  );

  // 5. Tool báo cáo hoàn thành task (giano_task_complete / ide_task_complete)
  const completeHandler = async ({
    taskId,
    status = "success",
    summary,
    filesTouched,
    verify,
    autoNotifyWeb = true
  }: {
    taskId: string;
    status?: "success" | "failed" | "blocked";
    summary: string;
    filesTouched?: string[];
    verify?: string[];
    silent?: boolean;
    autoNotifyWeb?: boolean;
  }) => {
    const task = inFlightTasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown taskId: ${taskId}`);
    }

    inFlightTasks.delete(taskId);

    const dbStatus = status === "success" ? "completed" : status === "blocked" ? "waiting_approval" : "failed";
    let continuationPrompt: string | undefined;
    let retryPrompt: string | undefined;
    let planId: string | undefined;
    let nextTask: any = null;
    let planDone = false;
    try {
      const db = getDatabase();
      db.run("UPDATE tasks SET status = ? WHERE id = ?", [dbStatus, taskId]);
      db.run(
        "INSERT INTO timeline_events (conversation_id, event_type, payload, created_at) VALUES (?, ?, ?, ?)",
        [task.chatId, "task_complete", JSON.stringify({ taskId, status, summary, filesTouched, verify }), Date.now()]
      );

      // Phases 4 + 6: plan-linked completion drives the loop.
      if (task.planTaskId && task.planId) {
        planId = task.planId;
        const planTask = getPlanTask(db as any, task.planTaskId);
        if (planTask) {
          if (status === "success" && planTask.verify && planTask.verify.length > 0) {
            // Verify gate: run the plan task's verify commands before
            // declaring success. A failed gate sends the task back to
            // pending (or blocked at max attempts) with the failure output.
            const gate = await runVerifyGate(planTask.verify);
            if (!gate.pass) {
              const failedCmd = gate.results.find((r) => !r.ok);
              if (planTask.attemptCount + 1 >= planTask.maxAttempts) {
                setPlanTaskStatus(db as any, task.planTaskId, "blocked");
                const view0 = getPlanStatus(db as any, task.planId);
                retryPrompt = `⚠️ [Otter Loop — verify thất bại, task bị blocked] Task "${planTask.goal}" đã hết ${planTask.maxAttempts} lần thử. Lệnh thất bại: ${failedCmd?.command}\nOutput: ${failedCmd?.output}\nPlan đã tạm dừng. Người dùng cần can thiệp trước khi chạy tiếp.`;
                void view0;
              } else {
                setPlanTaskStatus(db as any, task.planTaskId, "pending", { incrementAttempt: true });
                retryPrompt = `🔁 [Otter Loop — verify thất bại, làm lại task] Task "${planTask.goal}" báo xong nhưng kiểm thử thất bại.\nLệnh thất bại: ${failedCmd?.command}\nOutput: ${failedCmd?.output}\nHãy sửa lỗi và làm lại đúng task này, không chuyển sang task khác.`;
              }
              // Do not advance the plan on a failed verify gate.
              completedTasks.set(taskId, {
                taskId,
                chatId: task.chatId,
                goal: task.goal,
                status: "failed",
                summary: `Verify gate failed: ${failedCmd?.command}`,
                filesTouched,
                verify,
                completedAt: new Date().toISOString(),
              });
              onActivity?.({
                type: "ide_task_verify_failed",
                taskId,
                goal: task.goal,
                planId: task.planId,
                planTaskId: task.planTaskId,
                retryPrompt,
                autoNotifyWeb,
              });
              return { content: [{ type: "text", text: JSON.stringify({ status: "verify_failed", retry: true, taskId }, null, 2) }] };
            }
          }

          const planTaskStatus = status === "success" ? "success" : status === "blocked" ? "blocked" : "failed";
          setPlanTaskStatus(db as any, task.planTaskId, planTaskStatus);
          const view = getPlanStatus(db as any, task.planId);
          const refreshed = refreshPlanStatus(db as any, task.planId);
          planDone = refreshed.status === "done";
          if (planDone) {
            continuationPrompt = buildFinalPrompt({ planGoal: refreshed.goal, planId: refreshed.id, view });
          } else if (status === "success") {
            const next = view.nextTask;
            if (next) {
              nextTask = next;
              const completedList = view.tasks.filter((t) => t.status === "success" || t.status === "skipped");
              continuationPrompt = buildContinuationPrompt({
                planGoal: refreshed.goal,
                planId: refreshed.id,
                completedTask: { goal: task.goal, summary, filesTouched, verify },
                nextTask: next,
                completedTasks: completedList,
                remainingCount: view.tasks.filter((t) => t.status === "pending" || t.status === "running").length,
              });
            }
          }
        }
      }
    } catch (err: any) {
      // Plan bookkeeping must not break the core complete flow for a
      // single task; log and fall through to the generic report.
      console.warn("[Task Bridge] Plan bookkeeping failed:", err?.message ?? err);
    }

    completedTasks.set(taskId, {
      taskId,
      chatId: task.chatId,
      goal: task.goal,
      status,
      summary,
      filesTouched,
      verify,
      completedAt: new Date().toISOString()
    });

    // Giữ tối đa 500 task gần nhất trong RAM, toàn bộ lịch sử đã lưu vĩnh viễn trong SQLite
    if (completedTasks.size > 500) {
      const oldestKey = completedTasks.keys().next().value;
      if (oldestKey) completedTasks.delete(oldestKey);
    }

    onActivity?.({
      type: "ide_task_completed",
      taskId,
      goal: task.goal,
      status,
      summary,
      filesTouched,
      verify,
      autoNotifyWeb,
      planId,
      planTaskId: task.planTaskId,
      continuationPrompt,
      retryPrompt,
      nextTask,
      planDone,
    });

    return { content: [{ type: "text", text: "OK" }] };
  };

  mcp.tool(
    "giano_task_complete",
    "Mark task complete and send final summary back.",
    {
      taskId: z.string(),
      status: z.enum(["success", "failed", "blocked"]).default("success"),
      summary: z.string(),
      filesTouched: z.array(z.string()).optional(),
      verify: z.array(z.string()).optional(),
      silent: z.boolean().default(false),
      autoNotifyWeb: z.boolean().default(true).describe("Tự động gửi báo cáo vào khung chat ChatGPT Web qua Chrome Extension")
    },
    completeHandler
  );

  mcp.tool(
    "ide_task_complete",
    "Báo cáo hoàn thành task cho Antigravity IDE Worker (Alias của giano_task_complete).",
    {
      taskId: z.string(),
      status: z.enum(["success", "failed", "blocked"]).default("success"),
      summary: z.string(),
      filesTouched: z.array(z.string()).optional(),
      verify: z.array(z.string()).optional(),
      silent: z.boolean().default(false),
      autoNotifyWeb: z.boolean().default(true).describe("Tự động gửi báo cáo vào khung chat ChatGPT Web qua Chrome Extension")
    },
    completeHandler
  );

  // 6. Tool lấy báo cáo kết quả task cho ChatGPT Web (ide_get_task_status)
  const getTaskStatusHandler = async ({ taskId }: { taskId?: string }) => {
    let result: CompletedTaskRecord | undefined;
    if (taskId) {
      result = completedTasks.get(taskId);
    } else {
      const all = Array.from(completedTasks.values());
      result = all.length > 0 ? all[all.length - 1] : undefined;
    }

    // Fallback: Tra cứu từ SQLite nếu server vừa khởi động lại hoặc task đã bị dọn khỏi RAM
    if (!result && taskId) {
      try {
        const db = getDatabase();
        const row = db.query("SELECT * FROM tasks WHERE id = ?").get(taskId) as any;
        if (row && (row.status === "completed" || row.status === "failed")) {
          const event = db.query(
            "SELECT payload FROM timeline_events WHERE event_type = 'task_complete' AND conversation_id = ? ORDER BY id DESC LIMIT 1"
          ).get(row.conversation_id) as any;
          if (event) {
            const p = JSON.parse(event.payload);
            result = {
              taskId,
              chatId: row.conversation_id || "default",
              goal: row.title,
              status: p.status || "success",
              summary: p.summary || "",
              filesTouched: p.filesTouched || [],
              verify: p.verify || [],
              completedAt: new Date(row.created_at || Date.now()).toISOString()
            };
          }
        }
      } catch {}
    }

    if (!result) {
      if (taskId) {
        const inFlight = inFlightTasks.get(taskId);
        if (inFlight) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                taskId,
                status: "running",
                message: "Antigravity IDE đang tích cực thực hiện task này...",
                goal: inFlight.goal
              }, null, 2)
            }]
          };
        }
        const inQueue = taskQueue.find(t => t.taskId === taskId);
        if (inQueue) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                taskId,
                status: "pending",
                message: "Task đang chờ trong hàng đợi để Antigravity IDE lấy về làm.",
                goal: inQueue.goal
              }, null, 2)
            }]
          };
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "not_found",
            message: taskId ? `Không tìm thấy thông tin cho taskId: ${taskId}` : "Chưa có task nào được hoàn thành gần đây."
          }, null, 2)
        }]
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          status: result.status,
          taskId: result.taskId,
          goal: result.goal,
          summary: result.summary,
          filesTouched: result.filesTouched || [],
          verify: result.verify || [],
          completedAt: result.completedAt,
          message: result.status === "success" 
            ? "✅ Antigravity IDE đã hoàn thành xuất sắc task này!" 
            : result.status === "blocked"
            ? "⚠️ Antigravity IDE đang bị chặn và cần bạn giải đáp thêm."
            : "❌ Antigravity IDE gặp lỗi trong quá trình thực hiện."
        }, null, 2)
      }]
    };
  };

  mcp.tool(
    "ide_get_task_status",
    "Kiểm tra kết quả và báo cáo chi tiết của task do Antigravity IDE hoàn thành (để trống taskId để lấy báo cáo mới nhất).",
    {
      taskId: z.string().optional().describe("Mã taskId cần kiểm tra (để trống sẽ lấy báo cáo mới nhất)")
    },
    getTaskStatusHandler
  );

  mcp.tool(
    "giano_get_task_result",
    "Lấy kết quả báo cáo của task (Alias của ide_get_task_status).",
    {
      taskId: z.string().optional().describe("Mã taskId cần kiểm tra")
    },
    getTaskStatusHandler
  );

  // 6. Tool nhả task lại hàng đợi nếu agent hủy (giano_task_release)
  mcp.tool(
    "giano_task_release",
    "Release an in-flight task back into the queue (e.g. if agent aborted).",
    {
      taskId: z.string(),
      reason: z.string().default("released")
    },
    async ({ taskId, reason }) => {
      const task = inFlightTasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown taskId: ${taskId}`);
      }

      inFlightTasks.delete(taskId);
      taskQueue.unshift(task);

      try {
        const db = getDatabase();
        db.run("UPDATE tasks SET status = 'pending', attempt_count = attempt_count + 1 WHERE id = ?", [taskId]);
        if (task.planTaskId) {
          try {
            setPlanTaskStatus(db as any, task.planTaskId, "pending");
          } catch {}
        }
      } catch {}

      onActivity?.({
        type: "ide_task_released",
        taskId,
        reason
      });

      return { content: [{ type: "text", text: "OK" }] };
    }
  );

  // 7. Tool thống kê hàng đợi (giano_queue_stats)
  const queueStatsHandler = async () => {
    const stats = {
      queued: taskQueue.length,
      inFlight: inFlightTasks.size,
      version: "0.2.0-otter-bridge"
    };
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }]
    };
  };

  mcp.tool("giano_queue_stats", "Get queue size and in-flight count.", {}, queueStatsHandler);
  mcp.tool("ide_queue_stats", "Get queue size and in-flight count (Alias).", {}, queueStatsHandler);

  // 8. Resource truy vấn danh sách task
  mcp.resource("queue", "giano://queue", async (uri) => {
    const data = {
      queue: taskQueue.map((t) => ({
        taskId: t.taskId,
        goal: t.goal,
        receivedAt: t.receivedAt
      })),
      inFlight: Array.from(inFlightTasks.values()).map((t) => ({
        taskId: t.taskId,
        goal: t.goal,
        startedAt: t.receivedAt
      }))
    };
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(data, null, 2)
        }
      ]
    };
  });
}
