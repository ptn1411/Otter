/**
 * MCP Tools cho Đăng bài Nhóm Facebook theo Lịch hẹn (FB Scheduled Group Posting)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import {
  addGroupTarget,
  listGroupTargets,
  deleteGroupTarget,
  createGroupSchedule,
  listGroupSchedules,
  cancelGroupSchedule,
  tickGroupPostScheduler
} from "../fb-group-post";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerFbGroupPostTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 1. Thêm nhóm vào danh bạ cài trước
  mcp.tool(
    "fb_group_add_target",
    "Thêm một nhóm Facebook vào danh sách cài trước để sẵn sàng lên lịch đăng bài.",
    {
      name: z.string().describe("Tên gợi nhớ của nhóm Facebook"),
      url: z.string().describe("Đường dẫn URL của nhóm Facebook (ví dụ: https://www.facebook.com/groups/1385451906420187/)"),
      topic: z.string().optional().describe("Chủ đề/niche của nhóm (ví dụ: Lập trình, Kinh doanh, Mẹ & bé) để phục vụ chế độ AI tự sinh bài phù hợp")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const target = addGroupTarget(db, args);
        onActivity?.({ type: "fb_group", action: "add_target", target });
        return text({
          ok: true,
          message: `Đã lưu nhóm "${target.name}" vào danh sách cài trước thành công!`,
          target
        });
      } catch (e: any) {
        return err(`Lỗi thêm nhóm: ${e.message}`);
      }
    }
  );

  // 2. Liệt kê danh sách nhóm cài trước
  mcp.tool(
    "fb_group_list_targets",
    "Liệt kê tất cả các nhóm Facebook đã cài đặt trước trong hệ thống.",
    {
      enabledOnly: z.boolean().optional().default(false).describe("Chỉ lấy các nhóm đang bật hoạt động")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const targets = listGroupTargets(db, args.enabledOnly);
        return text({
          total: targets.length,
          targets
        });
      } catch (e: any) {
        return err(`Lỗi liệt kê nhóm: ${e.message}`);
      }
    }
  );

  // 3. Xóa nhóm khỏi danh bạ
  mcp.tool(
    "fb_group_delete_target",
    "Xóa một nhóm Facebook khỏi danh sách cài trước theo ID.",
    {
      targetId: z.string().describe("ID của nhóm cần xóa (lấy từ fb_group_list_targets)")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const ok = deleteGroupTarget(db, args.targetId);
        return text({
          ok,
          message: ok ? "Đã xóa nhóm thành công." : "Không tìm thấy nhóm để xóa."
        });
      } catch (e: any) {
        return err(`Lỗi xóa nhóm: ${e.message}`);
      }
    }
  );

  // 4. Lập lịch hẹn giờ đăng bài lên nhiều nhóm
  mcp.tool(
    "fb_group_schedule_post",
    "Lập lịch hẹn giờ tự động đăng bài lên nhiều nhóm Facebook. Hỗ trợ 2 chế độ: 'preset' (1 mẫu soạn sẵn dùng chung các nhóm) hoặc 'ai_generated' (tự biến tấu theo chủ đề nhóm). Tự động giãn cách an toàn 3 phút giữa mỗi nhóm (chống checkpoint spam).",
    {
      content: z.string().describe("Nội dung bài viết mẫu (nếu mode preset) hoặc thông điệp/chủ đề bài viết chung (nếu mode ai_generated)"),
      mode: z.enum(["preset", "ai_generated"]).default("preset").describe("Chế độ đăng bài: preset (mẫu dùng chung) hoặc ai_generated (tự biến tấu theo chủ đề từng nhóm)"),
      targetGroupIds: z.array(z.string()).optional().default(["*"]).describe("Danh sách ID nhóm cần đăng. Truyền ['*'] hoặc để trống để đăng tất cả các nhóm đã cài trước."),
      scheduledAt: z.number().optional().describe("Thời điểm bắt đầu đăng (timestamp ms). Bỏ trống để bắt đầu đăng ngay bây giờ."),
      intervalMinutes: z.number().min(1).max(60).default(3).describe("Khoảng thời gian giãn cách giữa 2 nhóm liên tiếp tính bằng phút (mặc định 3 phút để an toàn)")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const intervalSeconds = (args.intervalMinutes || 3) * 60;
        const schedule = createGroupSchedule(db, {
          mode: args.mode,
          content: args.content,
          targetGroupIds: args.targetGroupIds,
          scheduledAt: args.scheduledAt,
          intervalSeconds
        });

        onActivity?.({
          type: "fb_group",
          action: "scheduled",
          scheduleId: schedule.id,
          mode: schedule.mode
        });

        return text({
          ok: true,
          scheduleId: schedule.id,
          mode: schedule.mode,
          scheduledAt: new Date(schedule.scheduled_at).toLocaleString("vi-VN"),
          intervalMinutes: args.intervalMinutes,
          status: schedule.status,
          message: `Đã lên lịch hẹn đăng bài tự động 100% thành công! Các bài viết sẽ được đăng lần lượt với giãn cách ${args.intervalMinutes} phút/nhóm.`
        });
      } catch (e: any) {
        return err(`Lỗi lên lịch đăng bài: ${e.message}`);
      }
    }
  );

  // 5. Xem danh sách lịch hẹn và tiến độ hàng đợi
  mcp.tool(
    "fb_group_list_schedules",
    "Xem danh sách các lịch hẹn đăng bài nhóm, trạng thái tiến độ từng nhóm (chờ đăng, đang đăng, đã đăng, thất bại).",
    {},
    async () => {
      try {
        const db = getDatabase();
        const schedules = listGroupSchedules(db);
        return text({
          total: schedules.length,
          schedules: schedules.map(s => ({
            id: s.id,
            mode: s.mode,
            status: s.status,
            scheduledAt: new Date(s.scheduled_at).toLocaleString("vi-VN"),
            totalGroups: s.queue.length,
            postedCount: s.queue.filter(q => q.status === "posted").length,
            pendingCount: s.queue.filter(q => q.status === "pending" || q.status === "posting").length,
            failedCount: s.queue.filter(q => q.status === "failed").length,
            queue: s.queue.map(q => ({
              id: q.id,
              groupName: q.group_name,
              groupUrl: q.group_url,
              scheduledAt: new Date(q.scheduled_at).toLocaleString("vi-VN"),
              status: q.status,
              error: q.error_message,
              contentSnippet: q.content.slice(0, 80)
            }))
          }))
        });
      } catch (e: any) {
        return err(`Lỗi liệt kê lịch hẹn: ${e.message}`);
      }
    }
  );

  // 6. Hủy lịch hẹn
  mcp.tool(
    "fb_group_cancel_schedule",
    "Hủy một lịch hẹn đăng bài nhóm đang chờ.",
    {
      scheduleId: z.string().describe("ID của lịch hẹn cần hủy")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const ok = cancelGroupSchedule(db, args.scheduleId);
        return text({
          ok,
          message: ok ? `Đã hủy lịch hẹn [${args.scheduleId}] thành công.` : "Không tìm thấy lịch hẹn hoặc lịch hẹn đã kết thúc."
        });
      } catch (e: any) {
        return err(`Lỗi hủy lịch hẹn: ${e.message}`);
      }
    }
  );

  // 7. Kích hoạt chạy ngay các bài đang chờ trong hàng đợi
  mcp.tool(
    "fb_group_run_now",
    "Kích hoạt kiểm tra và thực thi ngay lập tức bài đăng tiếp theo trong hàng đợi mà không cần chờ timer định kỳ.",
    {},
    async () => {
      try {
        const db = getDatabase();
        const res = await tickGroupPostScheduler(db, onActivity);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi kích hoạt chạy ngay: ${e.message}`);
      }
    }
  );
}

