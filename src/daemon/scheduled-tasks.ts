import { Database } from "bun:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface ScheduledTask {
  id: string;
  title: string;
  prompt: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  scheduled_at: number;
  repeat_minutes: number;
  chat_url: string | null;
  response_text: string | null;
  screenshot_path: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

export interface CreateScheduledTaskInput {
  title: string;
  prompt: string;
  scheduledAt?: number;
  repeatMinutes?: number;
}

export interface UpdateScheduledTaskInput {
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  chatUrl?: string | null;
  responseText?: string | null;
  screenshotPath?: string | null;
  errorMessage?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
}

// Đảm bảo bảng tồn tại (cho cả database trong bộ nhớ hoặc database đã khởi tạo từ trước)
export function ensureScheduledTasksTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS scheduled_chatgpt_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
      scheduled_at INTEGER NOT NULL,
      repeat_minutes INTEGER DEFAULT 0,
      chat_url TEXT,
      response_text TEXT,
      screenshot_path TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status ON scheduled_chatgpt_tasks(status, scheduled_at);
  `);
}

export function createScheduledTask(db: Database, input: CreateScheduledTaskInput): ScheduledTask {
  ensureScheduledTasksTable(db);
  const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const scheduledAt = input.scheduledAt || now;
  const repeatMinutes = Math.max(0, input.repeatMinutes || 0);

  const stmt = db.prepare(`
    INSERT INTO scheduled_chatgpt_tasks (
      id, title, prompt, status, scheduled_at, repeat_minutes,
      chat_url, response_text, screenshot_path, error_message,
      created_at, started_at, completed_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, NULL, NULL, NULL, NULL, ?, NULL, NULL)
  `);

  stmt.run(id, input.title.trim(), input.prompt.trim(), scheduledAt, repeatMinutes, now);

  const task = getScheduledTask(db, id);
  if (!task) throw new Error("Không thể tạo task");
  return task;
}

export function listScheduledTasks(db: Database, limit = 100): ScheduledTask[] {
  ensureScheduledTasksTable(db);
  const stmt = db.prepare(`
    SELECT * FROM scheduled_chatgpt_tasks
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit) as ScheduledTask[];
}

export function getScheduledTask(db: Database, id: string): ScheduledTask | null {
  ensureScheduledTasksTable(db);
  const stmt = db.prepare(`SELECT * FROM scheduled_chatgpt_tasks WHERE id = ?`);
  const row = stmt.get(id);
  return (row as ScheduledTask) || null;
}

export function deleteScheduledTask(db: Database, id: string): boolean {
  ensureScheduledTasksTable(db);
  const stmt = db.prepare(`DELETE FROM scheduled_chatgpt_tasks WHERE id = ?`);
  const res = stmt.run(id);
  return res.changes > 0;
}

export function findDueScheduledTasks(db: Database, now = Date.now()): ScheduledTask[] {
  ensureScheduledTasksTable(db);
  const stmt = db.prepare(`
    SELECT * FROM scheduled_chatgpt_tasks
    WHERE status = 'pending' AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `);
  return stmt.all(now) as ScheduledTask[];
}

export function updateScheduledTaskStatus(
  db: Database,
  id: string,
  update: UpdateScheduledTaskInput
): boolean {
  ensureScheduledTasksTable(db);
  const fields: string[] = [];
  const params: any[] = [];

  if (update.status !== undefined) {
    fields.push("status = ?");
    params.push(update.status);
  }
  if (update.chatUrl !== undefined) {
    fields.push("chat_url = ?");
    params.push(update.chatUrl);
  }
  if (update.responseText !== undefined) {
    fields.push("response_text = ?");
    params.push(update.responseText);
  }
  if (update.screenshotPath !== undefined) {
    fields.push("screenshot_path = ?");
    params.push(update.screenshotPath);
  }
  if (update.errorMessage !== undefined) {
    fields.push("error_message = ?");
    params.push(update.errorMessage);
  }
  if (update.startedAt !== undefined) {
    fields.push("started_at = ?");
    params.push(update.startedAt);
  }
  if (update.completedAt !== undefined) {
    fields.push("completed_at = ?");
    params.push(update.completedAt);
  }

  if (fields.length === 0) return false;

  params.push(id);
  const sql = `UPDATE scheduled_chatgpt_tasks SET ${fields.join(", ")} WHERE id = ?`;
  const stmt = db.prepare(sql);
  const res = stmt.run(...params);
  return res.changes > 0;
}

// =========================================================================
// RUNNER: TỰ ĐỘNG MỞ TRÌNH DUYỆT PROFILE & THỰC THI TRÊN CHATGPT WEB
// =========================================================================

export const DEFAULT_GPM_PROFILE_ID = process.env.GPM_PROFILE_ID || "64b20c37-715c-4f4c-897c-fbbac828e8bf";
export const DEFAULT_GPM_API_URL = process.env.GPM_API_URL || "http://127.0.0.1:9495/mcp";
export const DEFAULT_GPM_TOKEN = process.env.GPM_TOKEN || "2d15ddd85b79bebabe1ed2a6ba553480a9c320b7f8636b5de75e72d864225df6";

/**
 * Đảm bảo trình duyệt profile ChatGPT Web đã mở và lấy cổng CDP kết nối
 */
export async function ensureChatGptBrowserOpen(): Promise<{ port: number }> {
  // 1. Kiểm tra nhanh xem cổng CDP 32934 (hoặc biến môi trường CDP_PORT) đang sẵn sàng chưa
  const candidatePorts = [
    Number(process.env.CDP_PORT) || 32934,
    9222
  ];

  for (const port of candidatePorts) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        return { port };
      }
    } catch {}
  }

  // 2. Nếu chưa mở, gọi GPM API để tự động khởi động Profile ChatGPT
  console.log(`[Task Runner] 🚀 Trình duyệt chưa mở. Đang khởi động GPM Profile: ${DEFAULT_GPM_PROFILE_ID}...`);
  try {
    const extPath = path.resolve("extension/dist");
    const additionArgs = `--load-extension="${extPath}"`;

    const gpmRes = await fetch(DEFAULT_GPM_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DEFAULT_GPM_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: "start_profile",
          arguments: {
            id: DEFAULT_GPM_PROFILE_ID,
            addition_args: additionArgs
          }
        }
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (gpmRes.ok) {
      const data = await gpmRes.json();
      const contentText = data?.result?.content?.[0]?.text;
      if (contentText) {
        const parsed = JSON.parse(contentText);
        if (parsed.success && parsed.data?.remote_debugging_port) {
          const port = Number(parsed.data.remote_debugging_port);
          console.log(`[Task Runner] ✅ GPM Profile đã được khởi động thành công trên cổng CDP: ${port}`);
          // Chờ 2 giây để trình duyệt ổn định
          await new Promise(r => setTimeout(r, 2000));
          return { port };
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Task Runner] Không thể khởi động profile qua GPM API: ${err?.message || err}`);
  }

  // Thử kiểm tra lại port 32934 một lần nữa trước khi báo lỗi
  try {
    const res = await fetch("http://127.0.0.1:32934/json", { signal: AbortSignal.timeout(2000) });
    if (res.ok) return { port: 32934 };
  } catch {}

  throw new Error("Không thể kết nối hoặc khởi động trình duyệt ChatGPT Web. Vui lòng bật GPM hoặc Chrome với remote debugging.");
}

/**
 * Thực thi một tác vụ trên ChatGPT Web
 */
export async function executeScheduledTask(
  db: Database,
  taskId: string
): Promise<{ success: boolean; chatUrl?: string; responseText?: string; error?: string }> {
  const task = getScheduledTask(db, taskId);
  if (!task) return { success: false, error: "Task không tồn tại" };

  console.log(`\n=================================================`);
  console.log(`🕒 BẮT ĐẦU THỰC THI TÁC VỤ HẸN GIỜ: [${task.id}] ${task.title}`);
  console.log(`=================================================`);

  updateScheduledTaskStatus(db, taskId, {
    status: "running",
    startedAt: Date.now()
  });

  let ws: WebSocket | null = null;
  try {
    // 1. Đảm bảo trình duyệt đã mở
    const { port } = await ensureChatGptBrowserOpen();

    // 2. Tìm tab ChatGPT Web
    const tabsRes = await fetch(`http://127.0.0.1:${port}/json`);
    const tabs = await tabsRes.json();
    let chatTab = tabs.find((t: any) => t.url?.includes("chatgpt.com"));

    if (!chatTab) {
      console.log("[Task Runner] Không có tab ChatGPT nào đang mở. Đang tạo tab mới...");
      // Tạo tab mới mở ChatGPT
      const newTabRes = await fetch(`http://127.0.0.1:${port}/json/new?https://chatgpt.com`, { method: "PUT" });
      chatTab = await newTabRes.json();
      // Đợi tab load
      await new Promise(r => setTimeout(r, 5000));
    }

    if (!chatTab || !chatTab.webSocketDebuggerUrl) {
      throw new Error("Không lấy được kết nối WebSocket CDP tới tab ChatGPT");
    }

    ws = new WebSocket(chatTab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timeout kết nối WebSocket CDP")), 10000);
      ws!.onopen = () => { clearTimeout(t); resolve(true); };
      ws!.onerror = (err) => { clearTimeout(t); reject(err); };
    });

    let msgId = 1;
    const sendCdp = (method: string, params: any = {}) => new Promise<any>((resolve) => {
      const curId = msgId++;
      const handler = (evt: any) => {
        const msg = JSON.parse(evt.data);
        if (msg.id === curId) {
          ws?.removeEventListener("message", handler);
          resolve(msg.result);
        }
      };
      ws?.addEventListener("message", handler);
      ws?.send(JSON.stringify({ id: curId, method, params }));
    });

    // 3. Tự động click Always Allow / Cho phép nếu có modal Action xác nhận
    await sendCdp("Runtime.evaluate", {
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const allowBtn = buttons.find(b => {
          const t = (b.textContent || "").toLowerCase();
          return t.includes("always allow") || t.includes("luôn cho phép") || t.includes("allow") || t.includes("cho phép");
        });
        if (allowBtn) {
          allowBtn.click();
          return "Clicked Allow";
        }
        return "No modal";
      })()`,
      returnByValue: true
    });

    // 4. Nhập câu lệnh vào khung chat ChatGPT Web (ưu tiên form ở cuối trang)
    console.log(`[Task Runner] ✍️ Điền prompt: "${task.prompt.slice(0, 80)}..."`);
    const injectRes = await sendCdp("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('form');
        const ta = form ? form.querySelector('#prompt-textarea, div.ProseMirror, [contenteditable="true"], textarea') : document.querySelector('div.ProseMirror[contenteditable="true"], #prompt-textarea');
        if (!ta) return { ok: false, error: "Không tìm thấy ô nhập liệu" };

        ta.focus();
        if (ta.tagName.toLowerCase() === "textarea") {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(ta, ${JSON.stringify(task.prompt)});
          else ta.value = ${JSON.stringify(task.prompt)};
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // ProseMirror
          const p = ta.querySelector('p') || ta;
          p.textContent = ${JSON.stringify(task.prompt)};
          ta.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(task.prompt)}, inputType: 'insertText' }));
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return { ok: true };
      })()`,
      returnByValue: true
    });

    if (!injectRes?.result?.value?.ok) {
      throw new Error(injectRes?.result?.value?.error || "Không thể điền prompt vào ô chat");
    }

    // Đợi 400ms rồi bấm Gửi
    await new Promise(r => setTimeout(r, 400));
    const clickRes = await sendCdp("Runtime.evaluate", {
      expression: `(() => {
        const form = document.querySelector('form');
        const btn = form ? form.querySelector('button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="Gửi" i]') : document.querySelector('button[data-testid="send-button"]');
        if (btn && !btn.disabled) {
          btn.click();
          return { ok: true, method: "click" };
        }
        return { ok: false };
      })()`,
      returnByValue: true
    });

    // Nếu click chưa được (hoặc button dạng voice), gửi Native Enter qua CDP
    if (!clickRes?.result?.value?.ok) {
      console.log("[Task Runner] Gửi phím Enter qua CDP...");
      await sendCdp("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        macCharCode: 13,
        key: "Enter",
        code: "Enter",
        text: "\r"
      });
      await sendCdp("Input.dispatchKeyEvent", {
        type: "keyUp",
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        macCharCode: 13,
        key: "Enter",
        code: "Enter"
      });
    }

    console.log("[Task Runner] 🚀 Đã gửi prompt tới ChatGPT Web! Đang chờ ChatGPT sinh kết quả...");

    // 5. Theo dõi tiến trình thực thi của ChatGPT Web
    let lastText = "";
    let stableCount = 0;
    let chatUrl = "";
    const deadline = Date.now() + 180000; // Chờ tối đa 3 phút

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));

      // Tự động duyệt popup quyền action nếu xuất hiện
      await sendCdp("Runtime.evaluate", {
        expression: `(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const allowBtn = buttons.find(b => {
            const t = (b.textContent || "").toLowerCase();
            return t.includes("always allow") || t.includes("luôn cho phép") || t.includes("allow") || t.includes("cho phép");
          });
          if (allowBtn) allowBtn.click();
        })()`
      });

      // Lấy URL hiện tại và câu trả lời mới nhất của assistant
      const evalRes = await sendCdp("Runtime.evaluate", {
        expression: `(() => {
          const url = window.location.href;
          
          // 1. Tìm theo H4 heading của ChatGPT
          const assistantHeaders = Array.from(document.querySelectorAll('h4')).filter(h => {
            const t = (h.innerText || '').toLowerCase();
            return t.includes('chatgpt đã nói') || t.includes('chatgpt said') || t.includes('chatgpt');
          });
          
          let text = '';
          if (assistantHeaders.length > 0) {
            const lastH = assistantHeaders[assistantHeaders.length - 1];
            if (lastH && lastH.parentElement) {
              text = (lastH.parentElement.innerText || '').trim();
              text = text.replace(/^ChatGPT\\s*(đã nói|said):\\s*/i, '').trim();
            }
          }
          
          // 2. Fallback: tìm theo articles hoặc role
          if (!text) {
            const articles = Array.from(document.querySelectorAll("article, [data-message-author-role='assistant']"));
            const lastArticle = articles[articles.length - 1];
            text = lastArticle ? (lastArticle.innerText || '').trim() : '';
          }

          const stopBtn = document.querySelector("button[data-testid='stop-button'], button[aria-label*='Stop' i], button[aria-label*='Dừng' i]");
          const isGenerating = !!stopBtn;
          return { url, text, isGenerating };
        })()`,
        returnByValue: true
      });

      const state = evalRes?.result?.value;
      if (!state) continue;

      if (state.url && state.url.includes("/c/")) {
        chatUrl = state.url;
      }

      if (state.text && state.text !== lastText) {
        lastText = state.text;
        stableCount = 0;
      } else if (state.text && state.text === lastText && lastText.length > 0) {
        stableCount++;
        // Ổn định sau 2 nhịp (~4 giây) và không còn nút stop
        if (!state.isGenerating && stableCount >= 2) {
          console.log("[Task Runner] ✅ ChatGPT Web đã hoàn thành phản hồi!");
          break;
        }
      }
    }

    // 6. Chụp ảnh màn hình bằng chứng
    let screenshotPath: string | null = null;
    try {
      const storageDir = path.resolve("storage/tasks");
      await fs.mkdir(storageDir, { recursive: true });

      const shotFile = `task-${task.id}.png`;
      const fullPath = path.join(storageDir, shotFile);

      const screenshot = await sendCdp("Page.captureScreenshot", { credentials: false });
      if (screenshot?.data) {
        const buffer = Buffer.from(screenshot.data, "base64");
        await fs.writeFile(fullPath, buffer);
        screenshotPath = `storage/tasks/${shotFile}`;

        // Đồng thời copy vào thư mục artifacts nếu được cấu hình
        const artifactDir = process.env.ARTIFACT_DIR;
        if (artifactDir && await fs.stat(artifactDir).catch(() => null)) {
          const artPath = path.join(artifactDir, shotFile);
          await fs.copyFile(fullPath, artPath).catch(() => {});
        }

        console.log(`[Task Runner] 📸 Đã chụp và lưu ảnh màn hình: ${screenshotPath}`);
      }
    } catch (shotErr) {
      console.warn("[Task Runner] Lỗi chụp ảnh:", shotErr);
    }

    // 7. Cập nhật kết quả vào database
    updateScheduledTaskStatus(db, taskId, {
      status: "completed",
      chatUrl: chatUrl || "https://chatgpt.com",
      responseText: lastText || "Đã thực hiện xong.",
      screenshotPath,
      completedAt: Date.now()
    });

    console.log(`[Task Runner] 🎉 Hoàn tất tác vụ [${taskId}]. Chat URL: ${chatUrl}`);

    // 8. Nếu task có thiết lập lặp lại (repeat_minutes > 0), tự động lên lịch chạy tiếp theo
    if (task.repeat_minutes > 0) {
      const nextRun = Date.now() + task.repeat_minutes * 60 * 1000;
      createScheduledTask(db, {
        title: `${task.title} (Lặp lại)`,
        prompt: task.prompt,
        scheduledAt: nextRun,
        repeatMinutes: task.repeat_minutes
      });
      console.log(`[Task Runner] 🔁 Đã tự động hẹn giờ lượt tiếp theo sau ${task.repeat_minutes} phút`);
    }

    return {
      success: true,
      chatUrl,
      responseText: lastText
    };
  } catch (err: any) {
    console.error(`[Task Runner] ❌ Lỗi khi chạy task [${taskId}]:`, err);
    updateScheduledTaskStatus(db, taskId, {
      status: "failed",
      errorMessage: err?.message || String(err),
      completedAt: Date.now()
    });
    return { success: false, error: err?.message || String(err) };
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

// =========================================================================
// BACKGROUND TICK SCHEDULER
// =========================================================================

let schedulerTimer: any = null;
let isExecuting = false;

export function startScheduledTaskRunner(db: Database, intervalMs = 5000): void {
  if (schedulerTimer) return;
  console.log(`[Task Runner] ⏱️ Đã kích hoạt bộ lập lịch tác vụ tự động (quét mỗi ${intervalMs / 1000}s)`);

  schedulerTimer = setInterval(async () => {
    if (isExecuting) return; // Tránh chạy chồng chéo

    try {
      const now = Date.now();
      const dueTasks = findDueScheduledTasks(db, now);
      if (dueTasks.length === 0) return;

      isExecuting = true;
      const taskToRun = dueTasks[0];
      console.log(`[Task Runner] 🔔 Phát hiện tác vụ đến hạn: [${taskToRun.id}] "${taskToRun.title}"`);
      await executeScheduledTask(db, taskToRun.id);
    } catch (err) {
      console.error("[Task Runner] Lỗi trong scheduler loop:", err);
    } finally {
      isExecuting = false;
    }
  }, intervalMs);
}

export function stopScheduledTaskRunner(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
