import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initDatabase } from "../src/daemon/db";
import {
  createScheduledTask,
  listScheduledTasks,
  getScheduledTask,
  deleteScheduledTask,
  findDueScheduledTasks,
  updateScheduledTaskStatus
} from "../src/daemon/scheduled-tasks";

describe("Scheduled ChatGPT Tasks Tests", () => {
  let db: Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("creates a new scheduled task and retrieves it", () => {
    const task = createScheduledTask(db, {
      title: "Tổng hợp tin tức thị trường",
      prompt: "Hãy dùng ask_muse_agent để tìm kiếm tin tức công nghệ mới nhất hôm nay",
      scheduledAt: Date.now() + 60000,
      repeatMinutes: 0
    });

    expect(task.id.startsWith("task-")).toBeTrue();
    expect(task.title).toBe("Tổng hợp tin tức thị trường");
    expect(task.status).toBe("pending");
    expect(task.repeat_minutes).toBe(0);

    const fetched = getScheduledTask(db, task.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.title).toBe(task.title);
    expect(fetched?.prompt).toBe(task.prompt);
  });

  it("finds tasks that are due for execution", () => {
    const now = Date.now();
    // Task 1: Due now (scheduled in the past)
    const task1 = createScheduledTask(db, {
      title: "Task Quá Hạn",
      prompt: "Lệnh 1",
      scheduledAt: now - 5000,
      repeatMinutes: 0
    });

    // Task 2: In the future
    createScheduledTask(db, {
      title: "Task Tương Lai",
      prompt: "Lệnh 2",
      scheduledAt: now + 3600000,
      repeatMinutes: 0
    });

    const dueTasks = findDueScheduledTasks(db, now);
    expect(dueTasks.length).toBe(1);
    expect(dueTasks[0].id).toBe(task1.id);
  });

  it("updates task progress and completion results", () => {
    const task = createScheduledTask(db, {
      title: "Viết kịch bản video",
      prompt: "Kịch bản AI",
      scheduledAt: Date.now()
    });

    // Mark running
    updateScheduledTaskStatus(db, task.id, {
      status: "running",
      startedAt: Date.now()
    });

    let current = getScheduledTask(db, task.id);
    expect(current?.status).toBe("running");
    expect(current?.started_at).not.toBeNull();

    // Mark completed with results
    updateScheduledTaskStatus(db, task.id, {
      status: "completed",
      chatUrl: "https://chatgpt.com/c/6ae802b0-bfbc-83ec-bf46-47abd3d81e0b",
      responseText: "Đây là kịch bản video chi tiết của bạn...",
      screenshotPath: "storage/tasks/task-123.png",
      completedAt: Date.now()
    });

    current = getScheduledTask(db, task.id);
    expect(current?.status).toBe("completed");
    expect(current?.chat_url).toBe("https://chatgpt.com/c/6ae802b0-bfbc-83ec-bf46-47abd3d81e0b");
    expect(current?.response_text).toContain("kịch bản video");
    expect(current?.screenshot_path).toBe("storage/tasks/task-123.png");
  });

  it("deletes a scheduled task", () => {
    const task = createScheduledTask(db, {
      title: "Task Cần Xóa",
      prompt: "Prompt",
      scheduledAt: Date.now()
    });

    expect(getScheduledTask(db, task.id)).not.toBeNull();
    const ok = deleteScheduledTask(db, task.id);
    expect(ok).toBeTrue();
    expect(getScheduledTask(db, task.id)).toBeNull();
  });
});

