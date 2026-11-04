/**
 * Phase 1 — MCP tool wrappers for the plan model (see ../plan.ts).
 * Thin wrappers only: validation and persistence live in plan.ts so the
 * same logic can be tested without an MCP server.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import {
  addPlanTask,
  cancelPlan,
  createPlan,
  getNextEligibleTask,
  getPlanStatus,
  listPlans,
  pausePlan,
  resumePlan,
  startPlan,
  type PlanTaskInput,
} from "../plan";
import { buildResumePrompt, enqueueInjection, listPendingInjections, LOOP_LIMITS } from "../continuous-loop";

const taskInputSchema = {
  goal: z.string().describe("Mục tiêu của task trong plan"),
  details: z.string().optional().describe("Mô tả chi tiết / tiêu chí hoàn thành"),
  filesHint: z.array(z.string()).optional().describe("File gợi ý cần chỉnh sửa"),
  verify: z.array(z.string()).optional().describe("Lệnh kiểm tra (build/test/lint) cho task này"),
  dependsOn: z.array(z.string()).optional().describe("Id hoặc goal chính xác của các plan task phải xong trước"),
  maxAttempts: z.number().int().min(1).optional().describe("Số lần thử tối đa cho task này (mặc định 3)"),
};

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function registerPlanTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "plan_create",
    "Tạo một plan code liên tục gồm nhiều task theo thứ tự. Plan mới ở trạng thái draft; gọi plan_resume (hoặc plan_start) để chạy.",
    {
      goal: z.string().describe("Mục tiêu tổng thể của plan"),
      tasks: z.array(z.object(taskInputSchema)).min(1).describe("Danh sách task theo thứ tự thực hiện"),
      loopPrompt: z.string().optional().describe("Hướng dẫn vòng lặp dùng khi inject task tiếp theo (Phase 4)"),
      conversationId: z.string().optional().describe("ID cuộc hội thoại (mặc định chatgpt-web)"),
    },
    async ({ goal, tasks, loopPrompt, conversationId }) => {
      const db = getDatabase();
      const result = createPlan(db, { goal, tasks: tasks as PlanTaskInput[], loopPrompt, conversationId });
      onActivity?.({ type: "plan_created", planId: result.plan.id, goal, taskCount: result.tasks.length });
      return text({ plan: result.plan, tasks: result.tasks });
    },
  );

  mcp.tool(
    "plan_add_task",
    "Thêm một task vào cuối plan (không dùng được khi plan đã done/failed/cancelled).",
    {
      planId: z.string(),
      goal: taskInputSchema.goal,
      details: taskInputSchema.details,
      filesHint: taskInputSchema.filesHint,
      verify: taskInputSchema.verify,
      dependsOn: taskInputSchema.dependsOn,
      maxAttempts: taskInputSchema.maxAttempts,
    },
    async ({ planId, goal, details, filesHint, verify, dependsOn, maxAttempts }) => {
      const db = getDatabase();
      const task = addPlanTask(db, planId, { goal, details, filesHint, verify, dependsOn, maxAttempts });
      onActivity?.({ type: "plan_task_added", planId, taskId: task.id, goal });
      return text({ task });
    },
  );

  mcp.tool(
    "plan_list",
    "Liệt kê các plan, kèm số lượng task theo trạng thái.",
    {
      status: z.enum(["draft", "running", "paused", "done", "failed", "cancelled"]).optional(),
    },
    async ({ status }) => {
      const db = getDatabase();
      return text({ plans: listPlans(db, status) });
    },
  );

  mcp.tool(
    "plan_status",
    "Xem trạng thái chi tiết của 1 plan: từng task, task đang chạy, task tiếp theo đủ điều kiện, heartbeat cuối.",
    { planId: z.string() },
    async ({ planId }) => {
      const db = getDatabase();
      return text(getPlanStatus(db, planId));
    },
  );

  const lifecycle = (
    name: string,
    description: string,
    fn: (db: ReturnType<typeof getDatabase>, planId: string) => unknown,
  ) => {
    mcp.tool(name, description, { planId: z.string() }, async ({ planId }) => {
      const db = getDatabase();
      const plan = fn(db, planId);
      onActivity?.({ type: `plan_${name.replace("plan_", "")}`, planId });
      return text({ plan });
    });
  };

  lifecycle("plan_pause", "Tạm dừng một plan đang chạy.", pausePlan);
  lifecycle("plan_resume", "Chạy tiếp một plan ở trạng thái draft hoặc paused.", resumePlan);
  lifecycle("plan_start", "Bắt đầu một plan ở trạng thái draft (alias của plan_resume).", startPlan);
  lifecycle("plan_cancel", "Hủy một plan chưa xong.", cancelPlan);

  // Phase 4: lấy task tiếp theo đủ điều kiện để worker làm.
  mcp.tool(
    "plan_next",
    "Lấy task tiếp theo của plan mà worker nên làm (chỉ khi plan đang running và không có task đang chạy). Trả về done=true khi plan đã hết task.",
    { planId: z.string() },
    async ({ planId }) => {
      const db = getDatabase();
      const view = getPlanStatus(db, planId);
      if (view.plan.status !== "running") {
        return text({
          planId,
          status: view.plan.status,
          nextTask: null,
          done: false,
          message: `Plan chưa ở trạng thái running (hiện tại: ${view.plan.status}). Gọi plan_resume để chạy tiếp, hoặc plan_status để xem tiến độ.`,
          view,
        });
      }
      if (view.currentTask) {
        return text({ planId, status: "running", currentTask: view.currentTask, nextTask: null, done: false, message: "Đã có task đang chạy, chờ task đó hoàn thành trước khi lấy task mới." });
      }
      const next = getNextEligibleTask(db, planId);
      if (!next) {
        const blocked = view.tasks.filter((t) => t.status === "blocked" || t.status === "failed");
        return text({ planId, status: "running", nextTask: null, done: view.counts.pending === 0 && view.counts.running === 0, blockedTasks: blocked, message: blocked.length > 0 ? "Không còn task đủ điều kiện; một số task đang blocked/failed, cần can thiệp." : "Plan đã hết task đủ điều kiện." });
      }
      return text({ planId, status: "running", nextTask: next, done: false });
    },
  );

  // Phase 5: prompt để ChatGPT Web tiếp tục plan sau khi mất kết nối.
  mcp.tool(
    "plan_resume_prompt",
    "Tạo prompt khôi phục plan sau khi mất kết nối (tiếp tục từ task đang chạy hoặc task tiếp theo, không làm lại task đã success).",
    { planId: z.string() },
    async ({ planId }) => {
      const db = getDatabase();
      const view = getPlanStatus(db, planId);
      return text({ planId, prompt: buildResumePrompt(view), view });
    },
  );

  // Phase 5: xem injection outbox đang chờ gửi.
  mcp.tool(
    "plan_outbox",
    "Xem các prompt đang chờ gửi vào ChatGPT Web (injection outbox) — những prompt bị kẹt khi extension mất kết nối sẽ nằm ở đây.",
    {},
    async () => {
      const db = getDatabase();
      const pending = listPendingInjections(db).map((e) => ({ id: e.id, planId: e.planId, taskId: e.taskId, attemptCount: e.attemptCount, createdAt: e.createdAt, textPreview: e.text.slice(0, 200) }));
      return text({ pending, count: pending.length, limits: { maxOutboxAttempts: LOOP_LIMITS.maxOutboxAttempts } });
    },
  );

  // Phase 5 helper: đưa một prompt vào outbox (để daemon tự gửi lại khi extension quay lại).
  mcp.tool(
    "plan_enqueue_prompt",
    "Đưa một prompt vào injection outbox (dedupe theo nội dung, không trùng lặp). Daemon sẽ gửi lại khi extension kết nối lại.",
    {
      text: z.string(),
      planId: z.string().optional(),
      taskId: z.string().optional(),
    },
    async ({ text, planId, taskId }) => {
      const db = getDatabase();
      const entry = enqueueInjection(db, { planId, taskId, text });
      onActivity?.({ type: "plan_prompt_enqueued", planId, taskId, outboxId: entry.id });
      return text({ outboxId: entry.id, status: entry.status, attemptCount: entry.attemptCount });
    },
  );
}
