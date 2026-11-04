/**
 * MCP Tools cho Đăng bài Video, Hình ảnh & Hàng đợi Batch Facebook
 * (Hỗ trợ Trang cá nhân, Nhóm, Fanpage; Quét thư mục; Nạp mảng; Tích hợp Muse AI)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDatabase } from "../db";
import {
  postMediaDirect,
  queueMediaFromFolder,
  queueMediaFromList,
  queueMuseVideoForPost,
  listMediaQueue,
  cancelMediaQueueItem,
  cancelAllPendingMediaPosts,
  tickMediaPostScheduler,
  FbTargetType
} from "../fb-media-post";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerFbMediaPostTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 1. Đăng ngay 1 bài viết kèm video hoặc ảnh
  mcp.tool(
    "fb_post_media",
    "Đăng ngay lập tức 1 bài viết kèm video hoặc hình ảnh lên Facebook. Hỗ trợ 3 đích đăng: 'profile' (Trang cá nhân/Bảng tin), 'group' (Nhóm Facebook), 'page' (Fanpage). Tự động tải media, điền caption và bấm Đăng.",
    {
      targetType: z.enum(["profile", "group", "page"]).default("profile").describe("Đích đăng bài: 'profile' (Trang cá nhân), 'group' (Nhóm), hoặc 'page' (Fanpage)"),
      targetUrl: z.string().optional().describe("Đường dẫn URL đích (bắt buộc với Nhóm ví dụ https://www.facebook.com/groups/..., hoặc Fanpage https://www.facebook.com/...; để trống đối với Trang cá nhân)"),
      mediaPath: z.string().optional().describe("Đường dẫn tệp video (.mp4, .mov, .mkv, .webm) hoặc ảnh (.png, .jpg, .webp) trên máy tính. Bỏ trống nếu chỉ đăng văn bản."),
      caption: z.string().describe("Nội dung bài viết (caption) đính kèm")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = await postMediaDirect(
          db,
          {
            targetType: args.targetType as FbTargetType,
            targetUrl: args.targetUrl,
            mediaPath: args.mediaPath,
            caption: args.caption
          },
          onActivity
        );

        return text({
          ok: res.ok,
          verified: res.verified,
          message: res.message,
          id: res.id
        });
      } catch (e: any) {
        return err(`Lỗi đăng bài media: ${e.message}`);
      }
    }
  );

  // 2. Cách A: Quét thư mục máy tính, lập lịch đăng từng video/ảnh
  mcp.tool(
    "fb_queue_media_folder",
    "Quét một thư mục trên máy tính (chứa các file video hoặc ảnh), tự động nạp toàn bộ danh sách vào hàng đợi và lập lịch đăng lần lượt từng bài một với khoảng cách an toàn (mặc định 3 phút/bài chống checkpoint). Hỗ trợ Trang cá nhân, Nhóm hoặc Fanpage.",
    {
      folderPath: z.string().describe("Đường dẫn thư mục chứa video/ảnh trên máy tính (ví dụ: 'C:/videos' hoặc 'storage/media/muse')"),
      targetType: z.enum(["profile", "group", "page"]).default("profile").describe("Đích đăng bài: 'profile' (Trang cá nhân), 'group' (Nhóm), hoặc 'page' (Fanpage)"),
      targetUrl: z.string().optional().describe("URL đích nếu đăng lên Nhóm hoặc Fanpage (để trống nếu đăng trang cá nhân)"),
      targetName: z.string().optional().describe("Tên gợi nhớ mục tiêu (ví dụ: 'Nhóm AI Việt Nam')"),
      defaultCaption: z.string().optional().default("{filename}").describe("Mẫu caption bài viết. Dùng {filename} để tự động điền tên tệp."),
      intervalMinutes: z.number().min(1).max(120).default(3).describe("Khoảng cách giữa các bài đăng liên tiếp tính theo phút (mặc định 3 phút)"),
      sortBy: z.enum(["name", "time", "random"]).default("name").describe("Thứ tự đăng: 'name' (theo tên file), 'time' (thời gian sửa đổi), 'random' (ngẫu nhiên)")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = await queueMediaFromFolder(db, {
          folderPath: args.folderPath,
          targetType: args.targetType as FbTargetType,
          targetUrl: args.targetUrl,
          targetName: args.targetName,
          defaultCaption: args.defaultCaption,
          intervalMinutes: args.intervalMinutes,
          sortBy: args.sortBy
        });

        onActivity?.({
          type: "fb_media_post",
          action: "folder_queued",
          total: res.total,
          folderPath: args.folderPath
        });

        return text({
          ok: true,
          total: res.total,
          intervalMinutes: args.intervalMinutes,
          message: `Đã quét và thêm ${res.total} tệp media vào hàng đợi đăng bài! Các bài viết sẽ được đăng lần lượt với giãn cách ${args.intervalMinutes} phút/bài.`,
          items: res.items.map((it) => ({
            id: it.id,
            mediaType: it.media_type,
            mediaPath: it.media_path,
            caption: it.caption,
            scheduledAt: new Date(it.scheduled_at).toLocaleString("vi-VN"),
            status: it.status
          }))
        });
      } catch (e: any) {
        return err(`Lỗi nạp thư mục media: ${e.message}`);
      }
    }
  );

  // 3. Cách B: Nạp mảng danh sách bài viết cụ thể vào hàng đợi
  mcp.tool(
    "fb_queue_media_list",
    "Nạp một danh sách mảng các bài viết (mỗi bài có thể có video/ảnh và caption riêng) vào hàng đợi tự động đăng lên Facebook.",
    {
      items: z.array(
        z.object({
          targetType: z.enum(["profile", "group", "page"]).optional().describe("Đích đăng riêng cho bài này (mặc định theo defaultTargetType)"),
          targetUrl: z.string().optional().describe("URL đích riêng cho bài này"),
          targetName: z.string().optional().describe("Tên gợi nhớ mục tiêu"),
          mediaPath: z.string().optional().describe("Đường dẫn tệp video hoặc ảnh trên máy tính"),
          caption: z.string().describe("Nội dung caption bài viết"),
          scheduledAt: z.number().optional().describe("Thời điểm bắt đầu đăng (ms timestamp, tùy chọn)")
        })
      ).describe("Mảng các bài viết cần xếp hàng đăng"),
      defaultTargetType: z.enum(["profile", "group", "page"]).default("profile").describe("Đích đăng mặc định nếu trong item không khai báo"),
      defaultTargetUrl: z.string().optional().describe("URL đích mặc định"),
      intervalMinutes: z.number().min(1).max(120).default(3).describe("Khoảng cách an toàn giữa các bài viết liên tiếp (phút)")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = queueMediaFromList(db, {
          items: args.items as any,
          defaultTargetType: args.defaultTargetType as FbTargetType,
          defaultTargetUrl: args.defaultTargetUrl,
          intervalMinutes: args.intervalMinutes
        });

        onActivity?.({
          type: "fb_media_post",
          action: "list_queued",
          total: res.total
        });

        return text({
          ok: true,
          total: res.total,
          intervalMinutes: args.intervalMinutes,
          message: `Đã thêm ${res.total} bài viết vào hàng đợi đăng bài tự động!`,
          items: res.items.map((it) => ({
            id: it.id,
            mediaType: it.media_type,
            mediaPath: it.media_path,
            caption: it.caption,
            scheduledAt: new Date(it.scheduled_at).toLocaleString("vi-VN"),
            status: it.status
          }))
        });
      } catch (e: any) {
        return err(`Lỗi nạp danh sách media: ${e.message}`);
      }
    }
  );

  // 4. Tích hợp Muse AI: Giao nhiệm vụ tạo video, tự tải về local và đưa vào hàng đợi
  mcp.tool(
    "fb_queue_muse_video",
    "Giao nhiệm vụ cho AI Agent Muse tạo video (text-to-video / animation), sau đó tự động tải video thành phẩm về máy tính và đưa vào hàng đợi đăng lên Facebook (Trang cá nhân, Nhóm hoặc Fanpage).",
    {
      task: z.string().describe("Yêu cầu/prompt tạo video gửi tới Muse AI (ví dụ: 'Tạo một video 10 giây giới thiệu sản phẩm phần mềm Otter AI')"),
      targetType: z.enum(["profile", "group", "page"]).default("profile").describe("Đích đăng bài sau khi video được tạo"),
      targetUrl: z.string().optional().describe("URL nhóm hoặc fanpage nếu đăng lên Nhóm/Fanpage"),
      targetName: z.string().optional().describe("Tên gợi nhớ mục tiêu"),
      caption: z.string().optional().describe("Nội dung caption bài viết (nếu bỏ trống sẽ dùng phản hồi từ Muse)"),
      intervalMinutes: z.number().min(1).max(120).default(3).describe("Giãn cách hẹn giờ đăng (phút)")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = await queueMuseVideoForPost(
          db,
          {
            task: args.task,
            targetType: args.targetType as FbTargetType,
            targetUrl: args.targetUrl,
            targetName: args.targetName,
            caption: args.caption,
            intervalMinutes: args.intervalMinutes
          },
          onActivity
        );

        if (!res.ok) {
          return err(res.error || "Không thể tạo video từ Muse AI");
        }

        return text({
          ok: true,
          videoPath: res.videoPath,
          item: res.item,
          message: `Muse AI đã tạo video thành công, tệp đã được tải về máy và xếp vào hàng đợi đăng bài!`
        });
      } catch (e: any) {
        return err(`Lỗi tạo và lập lịch video Muse: ${e.message}`);
      }
    }
  );

  // 5. Xem danh sách hàng đợi các bài đăng media
  mcp.tool(
    "fb_media_list_queue",
    "Xem danh sách hàng đợi các bài đăng video/ảnh lên Facebook, trạng thái từng bài (chờ đăng, đang upload, đã đăng, lỗi) và tiến độ tổng quan.",
    {
      status: z.enum(["pending", "uploading", "posted", "failed", "cancelled"]).optional().describe("Lọc theo trạng thái"),
      limit: z.number().optional().default(50).describe("Số lượng bài hiển thị tối đa")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = listMediaQueue(db, {
          status: args.status as any,
          limit: args.limit
        });

        return text({
          total: res.total,
          pendingCount: res.pendingCount,
          postedCount: res.postedCount,
          failedCount: res.failedCount,
          items: res.items.map((it) => ({
            id: it.id,
            targetType: it.target_type,
            targetUrl: it.target_url,
            targetName: it.target_name,
            mediaType: it.media_type,
            mediaPath: it.media_path,
            captionSnippet: it.caption.slice(0, 100),
            scheduledAt: new Date(it.scheduled_at).toLocaleString("vi-VN"),
            postedAt: it.posted_at ? new Date(it.posted_at).toLocaleString("vi-VN") : null,
            status: it.status,
            error: it.error_message,
            source: it.source
          }))
        });
      } catch (e: any) {
        return err(`Lỗi xem hàng đợi media: ${e.message}`);
      }
    }
  );

  // 6. Hủy bài đăng trong hàng đợi
  mcp.tool(
    "fb_media_cancel_queue",
    "Hủy một bài đăng cụ thể hoặc toàn bộ các bài đăng đang chờ trong hàng đợi media Facebook.",
    {
      id: z.string().optional().describe("ID bài đăng cần hủy (lấy từ fb_media_list_queue)"),
      cancelAll: z.boolean().optional().default(false).describe("Đặt là true nếu muốn hủy TẤT CẢ các bài đang chờ")
    },
    async (args) => {
      try {
        const db = getDatabase();
        if (args.cancelAll) {
          const count = cancelAllPendingMediaPosts(db);
          return text({
            ok: true,
            cancelledCount: count,
            message: `Đã hủy toàn bộ ${count} bài đăng đang chờ trong hàng đợi.`
          });
        }
        if (args.id) {
          const ok = cancelMediaQueueItem(db, args.id);
          return text({
            ok,
            message: ok ? `Đã hủy bài đăng [${args.id}] thành công.` : "Không tìm thấy bài đăng hoặc bài đã được đăng."
          });
        }
        return err("Vui lòng truyền 'id' của bài viết cần hủy hoặc đặt 'cancelAll: true'.");
      } catch (e: any) {
        return err(`Lỗi hủy bài đăng: ${e.message}`);
      }
    }
  );

  // 7. Kích hoạt chạy ngay bài media tiếp theo
  mcp.tool(
    "fb_media_run_now",
    "Kích hoạt kiểm tra và đăng ngay lập tức bài media tiếp theo đang chờ trong hàng đợi mà không cần chờ đến giờ hẹn.",
    {},
    async () => {
      try {
        const db = getDatabase();
        const res = await tickMediaPostScheduler(db, onActivity, true);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi kích hoạt chạy ngay: ${e.message}`);
      }
    }
  );
}

