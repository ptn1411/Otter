import { Database } from "bun:sqlite";
import * as path from "node:path";
import {
  listScheduledTasks,
  getScheduledTask,
  createScheduledTask,
  deleteScheduledTask,
  executeScheduledTask,
  updateScheduledTaskStatus
} from "../scheduled-tasks";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function handleScheduledTasksRoutes(
  req: Request,
  url: URL,
  db: Database
): Promise<Response | null> {
  // 1. Phục vụ ảnh chụp màn hình bằng chứng: GET /storage/tasks/:filename
  if (url.pathname.startsWith("/storage/tasks/") && req.method === "GET") {
    const filename = path.basename(url.pathname);
    const filePath = path.resolve("storage/tasks", filename);
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=3600",
            ...corsHeaders
          }
        });
      }
    } catch {}
    return new Response("Not found", { status: 404, headers: corsHeaders });
  }

  // 2. API Lấy danh sách tasks: GET /api/tasks
  if (url.pathname === "/api/tasks" && req.method === "GET") {
    const tasks = listScheduledTasks(db);
    return new Response(JSON.stringify({ success: true, tasks }), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // 3. API Tạo task mới: POST /api/tasks
  if (url.pathname === "/api/tasks" && req.method === "POST") {
    try {
      const body = await req.json();
      if (!body.title || !body.prompt) {
        return new Response(JSON.stringify({ success: false, error: "Vui lòng nhập tiêu đề và nội dung lệnh prompt" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const task = createScheduledTask(db, {
        title: body.title,
        prompt: body.prompt,
        scheduledAt: body.scheduledAt ? Number(body.scheduledAt) : Date.now(),
        repeatMinutes: body.repeatMinutes ? Number(body.repeatMinutes) : 0
      });

      return new Response(JSON.stringify({ success: true, task }), {
        status: 201,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }

  // 4. API Chạy task ngay: POST /api/tasks/:id/run
  const matchRun = url.pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (matchRun && req.method === "POST") {
    const taskId = matchRun[1];
    const task = getScheduledTask(db, taskId);
    if (!task) {
      return new Response(JSON.stringify({ success: false, error: "Task không tồn tại" }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Cập nhật scheduled_at về hiện tại và kích hoạt chạy bất đồng bộ
    updateScheduledTaskStatus(db, taskId, { status: "pending", scheduledAt: Date.now() });
    
    // Kích hoạt chạy ngay trong background
    executeScheduledTask(db, taskId).catch(console.error);

    return new Response(JSON.stringify({ success: true, message: "Đã kích hoạt thực thi task" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  // 5. API Xóa task: DELETE /api/tasks/:id
  const matchDelete = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (matchDelete && req.method === "DELETE") {
    const taskId = matchDelete[1];
    const ok = deleteScheduledTask(db, taskId);
    return new Response(JSON.stringify({ success: ok }), {
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  return null;
}
