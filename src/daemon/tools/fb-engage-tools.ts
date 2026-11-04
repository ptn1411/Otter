/**
 * MCP Tool Wrappers cho Facebook Feed Engagement (Tương tác tự động Bảng feed Facebook)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserBridge } from "../browser-bridge";
import { getDatabase } from "../db";
import {
  decideEngagement,
  hashPostKey,
  isPostEngaged,
  listFeedEngagements,
  recordFeedEngagement,
  scanFacebookFeed,
  engageFacebookPost,
  autoEngageFacebookFeed
} from "../fb-engage";
import {
  getOrCreateConversation,
  nextSalesReply,
  getConversationMessages,
  generateSalesComment,
  startMessengerListener,
  stopMessengerListener,
  getMessengerListenerStatus,
  checkAndReplyMessengerOnce,
  getFullPlaybookOverview,
  updatePlaybookStepInDb,
  updateIntentInDb,
  updateCommentTemplatesInDb,
  resetSalesPlaybookInDb
} from "../fb-sales";
import {
  readFacebookNotifications,
  openNotificationAndReplyComment
} from "../fb-notifications";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerFbEngageTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 0. Tool Đóng các khung chat Messenger đang mở
  mcp.tool(
    "fb_close_chat_tabs",
    "Đóng tất cả các khung chat / hộp thoại Messenger đang mở nổi trên màn hình Facebook để giải phóng tầm nhìn và tránh bị che khuất khi lướt feed.",
    {},
    async () => {
      try {
        const res = await browserBridge.execute("close_messenger_docks");
        return text(res);
      } catch (e: any) {
        return err(`Lỗi đóng khung chat Messenger: ${e.message}`);
      }
    }
  );

  // 1. Tool Quét Feed
  mcp.tool(
    "fb_feed_scan",
    "Quét các bài viết trên Bảng feed Facebook, tự động lọc an toàn (bỏ bài quảng cáo, bài của mình, bài đã tương tác) và đề xuất cảm xúc + câu bình luận tiếng Việt phù hợp ngữ cảnh.",
    {},
    async () => {
      try {
        const res = await scanFacebookFeed(onActivity);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi quét Feed: ${e.message}`);
      }
    }
  );

  // 2. Tool Tương tác bài viết (Like + Comment)
  mcp.tool(
    "fb_feed_engage_post",
    "Thực thi tương tác (Thích/Thả tim và Bình luận) vào một bài viết cụ thể trên Facebook qua Extension, sau đó lưu lịch sử SQLite chống trùng.",
    {
      author: z.string().describe("Tên tác giả / fanpage của bài viết"),
      postSnippet: z.string().describe("Đoạn trích nội dung bài viết"),
      likeIndex: z.number().optional().describe("Chỉ số phần tử nút Thích trên trang"),
      commentIndex: z.number().optional().describe("Chỉ số phần tử nút Bình luận trên trang"),
      reaction: z.enum(["like", "love", "care", "haha", "wow", "sad", "angry", "none"]).default("like").describe("Cảm xúc cần bày tỏ (like, love, care, haha, wow, sad, angry)"),
      commentText: z.string().optional().describe("Nội dung câu bình luận bằng tiếng Việt")
    },
    async (args) => {
      try {
        const res = await engageFacebookPost(args, onActivity);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi tương tác bài viết: ${e.message}`);
      }
    }
  );

  // 3. Tool Xem lịch sử tương tác
  mcp.tool(
    "fb_feed_history",
    "Xem danh sách các bài viết trên Feed Facebook đã được tương tác gần đây từ SQLite.",
    {
      limit: z.number().int().min(1).max(100).default(20).describe("Số lượng bản ghi tối đa cần lấy")
    },
    async ({ limit }) => {
      try {
        const db = getDatabase();
        const records = listFeedEngagements(db, limit);
        return text({
          count: records.length,
          records
        });
      } catch (e: any) {
        return err(`Lỗi lấy lịch sử: ${e.message}`);
      }
    }
  );

  // 3.1 Tool Tự động lướt Bảng tin (Feed) và bình luận giới thiệu nhóm
  mcp.tool(
    "fb_feed_auto_engage",
    "Tự động cuộn lướt Bảng tin Facebook, lọc bài viết phù hợp (bỏ qua bài của mình/quảng cáo), Thích bài và Bình luận tự động kèm lời giới thiệu khéo léo vào nhóm Facebook của bạn.",
    {
      maxPosts: z.number().int().min(1).max(10).default(2).describe("Số lượng bài viết tối đa cần tương tác trong phiên"),
      groupName: z.string().default("Vibe Code kiếm cơm").describe("Tên nhóm cần giới thiệu"),
      groupUrl: z.string().default("https://www.facebook.com/groups/1385451906420187").describe("Đường dẫn (URL) nhóm cần giới thiệu"),
      customIntro: z.string().optional().describe("Lời dẫn tùy chỉnh nếu không muốn dùng câu mẫu tự động"),
      intervalSeconds: z.number().int().min(5).max(120).default(15).describe("Khoảng cách nghỉ an toàn giữa các bài (giây, chống checkpoint)"),
      dryRun: z.boolean().default(false).describe("Chế độ chạy thử không click/gõ thật")
    },
    async (args) => {
      try {
        const res = await autoEngageFacebookFeed(args, onActivity);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi tự động tương tác feed: ${e.message}`);
      }
    }
  );

  // 4. Tool Mở danh sách tin nhắn Messenger (Messenger Dropdown / Inbox)
  mcp.tool(
    "fb_messenger_open_list",
    "Nhấp chuột vào nút biểu tượng Messenger trên thanh điều hướng Facebook để mở danh sách tin nhắn / hội thoại gần đây.",
    {},
    async () => {
      try {
        const pageData = await browserBridge.execute("read_page");
        const elements: any[] = pageData.elements || [];
        const msgBtn = elements.find((e: any) => {
          const a = (e.ariaLabel || '').toLowerCase();
          const t = (e.text || '').toLowerCase();
          return a.includes('messenger') || t.includes('messenger');
        });

        if (!msgBtn) {
          return err("Không tìm thấy nút Messenger trên giao diện Facebook.");
        }

        await browserBridge.execute("click", { index: msgBtn.index });
        return text({
          ok: true,
          message: `Đã mở danh sách tin nhắn Messenger (click index ${msgBtn.index}).`,
          indexUsed: msgBtn.index
        });
      } catch (e: any) {
        return err(`Lỗi mở danh sách tin nhắn: ${e.message}`);
      }
    }
  );

  // 5. Tool Trả lời tin nhắn Messenger bám sát Kịch bản Bán hàng (Sales Playbook)
  mcp.tool(
    "fb_messenger_sales_reply",
    "Tự động đọc tin nhắn của khách hàng, đối chiếu kịch bản bán hàng theo phễu chuyển đổi (Greeting -> Discovery -> Pitch -> Objection -> Closing), tự động soạn thảo và gõ câu trả lời vào ô chat, sau đó lưu vết vào SQLite.",
    {
      recipientName: z.string().describe("Tên khách hàng / người nhận tin nhắn (ví dụ 'Phạm Thành Nam')"),
      customerMessage: z.string().describe("Nội dung tin nhắn khách hàng vừa gửi đến"),
      inputIndex: z.number().optional().describe("Chỉ số phần tử ô nhập tin nhắn 'Viết cho [Tên]'"),
      customReply: z.string().optional().describe("Nội dung câu trả lời tùy chỉnh nếu không muốn dùng câu mẫu kịch bản")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const salesStep = nextSalesReply(db, args.recipientName, args.customerMessage);
        const replyText = args.customReply || salesStep.replyText;

        // Nếu có inputIndex, gõ trực tiếp qua Extension
        if (args.inputIndex) {
          await browserBridge.execute("type", {
            index: args.inputIndex,
            text: replyText,
            pressEnter: true
          });
        }

        onActivity?.({
          type: "fb_messenger",
          action: "reply",
          recipient: args.recipientName,
          stage: salesStep.currentStage,
          nextStage: salesStep.nextStage,
          replyText
        });

        return text({
          ok: true,
          recipient: args.recipientName,
          customerMessage: args.customerMessage,
          currentStage: salesStep.currentStage,
          nextStage: salesStep.nextStage,
          replyText,
          message: `Đã phản hồi khách hàng '${args.recipientName}' theo kịch bản [${salesStep.currentStage} -> ${salesStep.nextStage}] và lưu lịch sử SQLite!`
        });
      } catch (e: any) {
        return err(`Lỗi xử lý kịch bản bán hàng Messenger: ${e.message}`);
      }
    }
  );

  // 6. Tool Xem lịch sử tin nhắn và giai đoạn phễu bán hàng của khách hàng
  mcp.tool(
    "fb_messenger_history",
    "Tra cứu toàn bộ lịch sử tin nhắn trò chuyện và giai đoạn kịch bản bán hàng hiện tại của khách hàng trong SQLite.",
    {
      recipientName: z.string().describe("Tên khách hàng cần tra cứu (ví dụ 'Phạm Thành Nam')"),
      limit: z.number().int().min(1).max(50).default(20).describe("Số lượng tin nhắn tối đa")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const conv = getOrCreateConversation(db, args.recipientName);
        const messages = getConversationMessages(db, conv.id, args.limit);

        return text({
          ok: true,
          conversation: conv,
          messageCount: messages.length,
          messages
        });
      } catch (e: any) {
        return err(`Lỗi tra cứu lịch sử tin nhắn: ${e.message}`);
      }
    }
  );

  // 7. Tool Bật Chế Độ Lắng Nghe Tin Nhắn Mới Tự Động (Auto-Listener Background Loop)
  mcp.tool(
    "fb_messenger_listen_start",
    "Bật tiến trình chạy ngầm liên tục lắng nghe tin nhắn mới trên Facebook Messenger. Mặc định ở chế độ 'chatgpt' sẽ tự động chuyển tin nhắn mới của khách lên ChatGPT Web để AI đọc và trả lời thông minh theo ngữ cảnh.",
    {
      intervalSeconds: z.number().int().min(2).max(60).default(5).describe("Chu kỳ kiểm tra tin nhắn mới (giây, mặc định 5s)"),
      mode: z.enum(["chatgpt", "playbook"]).default("chatgpt").describe("Chế độ xử lý: 'chatgpt' (chuyển tin nhắn cho ChatGPT Web tự sinh câu trả lời AI) hoặc 'playbook' (tự động trả lời offline bằng các câu mẫu có sẵn)")
    },
    async ({ intervalSeconds, mode }) => {
      try {
        const db = getDatabase();
        const res = startMessengerListener(db, onActivity, intervalSeconds * 1000, mode);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi khởi động Messenger Listener: ${e.message}`);
      }
    }
  );

  // 8. Tool Tắt Chế Độ Lắng Nghe Tin Nhắn Mới
  mcp.tool(
    "fb_messenger_listen_stop",
    "Dừng tiến trình chạy ngầm lắng nghe tin nhắn Facebook Messenger.",
    {},
    async () => {
      try {
        const res = stopMessengerListener();
        return text(res);
      } catch (e: any) {
        return err(`Lỗi dừng Messenger Listener: ${e.message}`);
      }
    }
  );

  // 9. Tool Xem Trạng Thái Messenger Listener
  mcp.tool(
    "fb_messenger_listen_status",
    "Kiểm tra xem tiến trình lắng nghe tin nhắn tự động có đang chạy không, đã trả lời bao nhiêu tin và thông tin khách hàng gần nhất.",
    {},
    async () => {
      try {
        const status = getMessengerListenerStatus();
        return text(status);
      } catch (e: any) {
        return err(`Lỗi lấy trạng thái Messenger Listener: ${e.message}`);
      }
    }
  );

  // 10. Tool Đọc Thông Báo Facebook (Notifications)
  mcp.tool(
    "fb_notifications_read",
    "Mở menu thông báo Facebook, trích xuất danh sách thông báo mới nhất (ai thích, ai bình luận, ai nhắc đến bạn, thời gian, liên kết bài viết và index để mở).",
    {},
    async () => {
      try {
        const res = await readFacebookNotifications();
        return text(res);
      } catch (e: any) {
        return err(`Lỗi đọc thông báo Facebook: ${e.message}`);
      }
    }
  );

  // 11. Tool Mở Bài Viết Từ Thông Báo & Tự Động Trả Lời Bình Luận
  mcp.tool(
    "fb_notification_open_and_reply",
    "Mở bài viết từ một thông báo cụ thể (theo notificationIndex hoặc liên kết href), đọc nội dung bình luận của bài viết, tự động soạn thảo câu trả lời thân thiện bám sát kịch bản và gửi bình luận trả lời ngay lập tức, sau đó lưu vết vào SQLite.",
    {
      notificationIndex: z.number().int().optional().describe("Chỉ số thứ tự thông báo trong danh sách (1, 2, 3...)"),
      href: z.string().optional().describe("Liên kết bài viết cần mở nếu không dùng notificationIndex"),
      customReply: z.string().optional().describe("Nội dung câu trả lời tùy chỉnh nếu không muốn dùng câu mẫu kịch bản")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = await openNotificationAndReplyComment(db, args, onActivity);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi mở thông báo và trả lời bình luận: ${e.message}`);
      }
    }
  );

  // 12. Tool Tra Cứu Toàn Bộ Kịch Bản Bán Hàng & Bình Luận Trong Database
  mcp.tool(
    "fb_sales_get_playbook",
    "Xem toàn bộ kịch bản bán hàng Messenger (từng bước phễu greeting -> discovery -> pitch -> objection -> closing -> support), danh sách ý định intent nhận diện câu hỏi thường gặp (hỏi danh tính, tính năng, giá, khen ngợi...) và kịch bản bình luận dạo đang lưu trong SQLite.",
    {},
    async () => {
      try {
        const db = getDatabase();
        const overview = getFullPlaybookOverview(db);
        return text({
          ok: true,
          overview
        });
      } catch (e: any) {
        return err(`Lỗi lấy kịch bản bán hàng: ${e.message}`);
      }
    }
  );

  // 13. Tool Cập Nhật Bước Trong Phễu Bán Hàng
  mcp.tool(
    "fb_sales_update_stage",
    "Cập nhật hoặc thêm mới các câu mẫu trả lời cho một giai đoạn trong phễu kịch bản bán hàng (greeting, discovery, pitch, objection, closing, support). Dùng {name} trong câu mẫu để tự động chèn tên khách.",
    {
      stage: z.enum(["greeting", "discovery", "pitch", "objection", "closing", "support"]).describe("Giai đoạn phễu cần cập nhật"),
      name: z.string().optional().describe("Tên gợi nhớ của giai đoạn (ví dụ 'Chào hỏi & Kết nối thiện cảm')"),
      goal: z.string().optional().describe("Mục tiêu chuyển đổi của giai đoạn này"),
      templates: z.array(z.string()).min(1).describe("Danh sách các câu thoại mẫu (ví dụ: ['Chào {name} nhé!', 'Dạ em chào {name}...'])")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = updatePlaybookStepInDb(db, args);
        onActivity?.({
          type: "fb_sales_playbook_update",
          stage: args.stage,
          templateCount: args.templates.length
        });
        return text(res);
      } catch (e: any) {
        return err(`Lỗi cập nhật bước kịch bản: ${e.message}`);
      }
    }
  );

  // 14. Tool Cập Nhật Ý Định Intent Phản Hồi Tức Thì
  mcp.tool(
    "fb_sales_update_intent",
    "Cập nhật hoặc thêm mới câu trả lời khi khách hàng hỏi các câu hỏi thường gặp theo ý định (intent): hỏi danh tính (identity), hỏi tính năng (features), hỏi giá (pricing), khen ngợi (praise), lo ngại bảo mật/checkpoint (objection_safety), hỗ trợ chung (general_support) hoặc intent tùy chỉnh.",
    {
      intentKey: z.string().describe("Mã định danh ý định (ví dụ: identity, features, pricing, praise, objection_safety, general_support)"),
      name: z.string().optional().describe("Tên hiển thị của ý định"),
      description: z.string().optional().describe("Mô tả ngữ cảnh"),
      keywords: z.array(z.string()).min(1).describe("Danh sách từ khóa kích hoạt ý định này (ví dụ: ['giá', 'bao nhiêu', 'chi phí', 'báo giá'])"),
      replyTemplate: z.string().describe("Câu trả lời mẫu khi khách hỏi trúng ý định (dùng {name} để tự động chèn tên khách)"),
      nextStage: z.enum(["greeting", "discovery", "pitch", "objection", "closing", "support", "done"]).default("closing").describe("Giai đoạn tiếp theo sau câu trả lời này")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = updateIntentInDb(db, args);
        onActivity?.({
          type: "fb_sales_intent_update",
          intentKey: args.intentKey
        });
        return text(res);
      } catch (e: any) {
        return err(`Lỗi cập nhật ý định: ${e.message}`);
      }
    }
  );

  // 15. Tool Cập Nhật Kịch Bản Bình Luận Mẫu
  mcp.tool(
    "fb_sales_update_comments",
    "Cập nhật danh sách các câu bình luận mẫu khi tương tác bài viết trên Facebook theo chủ đề (travel: du lịch, shop: bán hàng, general: chung tạo thiện cảm). Dùng {author} trong câu mẫu để tự động chèn tên tác giả bài viết.",
    {
      category: z.string().describe("Mã chủ đề: travel, shop, general hoặc danh mục tùy chỉnh"),
      name: z.string().optional().describe("Tên hiển thị của chủ đề"),
      templates: z.array(z.string()).min(1).describe("Danh sách các câu bình luận mẫu (ví dụ: ['Bài viết của {author} hay quá!'])")
    },
    async (args) => {
      try {
        const db = getDatabase();
        const res = updateCommentTemplatesInDb(db, args.category, args.templates, args.name);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi cập nhật danh mục bình luận: ${e.message}`);
      }
    }
  );

  // 16. Tool Khôi Phục Kịch Bản Về Mặc Định Ban Đầu
  mcp.tool(
    "fb_sales_reset_playbook",
    "Khôi phục toàn bộ kịch bản bán hàng Messenger và kịch bản bình luận về mặc định ban đầu của Otter trong SQLite.",
    {},
    async () => {
      try {
        const db = getDatabase();
        const res = resetSalesPlaybookInDb(db);
        return text(res);
      } catch (e: any) {
        return err(`Lỗi khôi phục kịch bản: ${e.message}`);
      }
    }
  );
}
