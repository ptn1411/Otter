/**
 * Facebook Notifications & Comment Auto-Responder Module
 * 
 * Tự động đọc danh sách thông báo Facebook, mở bài viết có bình luận mới/tương tác,
 * và tự động soạn thảo, gửi câu trả lời bình luận bám sát kịch bản.
 */
import type { Database } from "bun:sqlite";
import { browserBridge } from "./browser-bridge";
import { generateSalesComment, recordMessage, getOrCreateConversation } from "./fb-sales";

export interface FacebookNotification {
  index: number;
  author: string;
  actionText: string;
  type: "comment" | "reply" | "reaction" | "mention" | "other";
  isUnread: boolean;
  time: string;
  href: string | null;
  elementIndex?: number;
}

/**
 * Đọc danh sách thông báo Facebook (tự động click icon Thông báo nếu chưa mở)
 */
export async function readFacebookNotifications(): Promise<{
  ok: boolean;
  count: number;
  notifications: FacebookNotification[];
}> {
  // 1. Đọc trạng thái trang hiện tại
  let page = await browserBridge.execute("read_page");
  let elements: any[] = page?.elements || [];

  // 2. Tìm nút Thông báo trên header nếu dialog chưa mở
  const hasNotifDialog = (page?.summaryText || "").includes("=== DANH SÁCH THÔNG BÁO FACEBOOK");
  if (!hasNotifDialog) {
    let notifBtn = elements.find((e: any) => {
      const a = (e.ariaLabel || "").toLowerCase();
      return a.includes("thông báo") && !a.includes("cài đặt");
    });

    if (!notifBtn) {
      // Điều hướng về Facebook nếu đang ở trang không có nút Thông báo (như modal bài viết)
      await browserBridge.execute("open", { url: "https://www.facebook.com/" });
      await new Promise(r => setTimeout(r, 1500));
      page = await browserBridge.execute("read_page");
      elements = page?.elements || [];
      notifBtn = elements.find((e: any) => {
        const a = (e.ariaLabel || "").toLowerCase();
        return a.includes("thông báo") && !a.includes("cài đặt");
      });
    }

    if (notifBtn) {
      await browserBridge.execute("click", { index: notifBtn.index });
      // Đợi 1.2s cho dropdown render
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  // 3. Đọc lại danh sách phần tử sau khi menu mở
  const freshPage = await browserBridge.execute("read_page");
  const freshElements: any[] = freshPage.elements || [];

  // Lọc các thẻ thông báo (link hoặc div chứa notif_id hoặc text thông báo)
  const notifElements = freshElements.filter((e: any) => {
    const href = e.href || "";
    const text = e.text || "";
    return href.includes("notif_id") ||
           (text.includes("thích bình luận") || text.includes("bình luận về") || text.includes("nhắc đến bạn") || text.includes("đã trả lời"));
  });

  const parsedNotifications: FacebookNotification[] = notifElements.map((el: any, i: number) => {
    const rawText = el.text || "";
    const lines = rawText.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const isUnread = lines.includes("Chưa đọc") || rawText.includes("Chưa đọc");

    // Lọc bỏ nhãn trạng thái và thời gian
    const cleanLines = lines.filter((l: string) => l !== "Chưa đọc" && !l.includes("phút") && !l.includes("giờ") && !l.includes("ngày") && !l.startsWith("·"));
    const timeLine = lines.find((l: string) => l.includes("phút") || l.includes("giờ") || l.includes("ngày") || l.includes("Hôm qua")) || "";

    const fullSummary = cleanLines.join(" - ") || rawText;

    let type: FacebookNotification["type"] = "other";
    const lower = fullSummary.toLowerCase();
    if (lower.includes("bình luận") || lower.includes("comment")) type = "comment";
    else if (lower.includes("trả lời")) type = "reply";
    else if (lower.includes("thích") || lower.includes("bày tỏ cảm xúc") || lower.includes("like")) type = "reaction";
    else if (lower.includes("nhắc đến") || lower.includes("tag") || lower.includes("gắn thẻ")) type = "mention";

    // Tách tên tác giả nếu có
    const colonIdx = fullSummary.indexOf(":");
    let author = "Người dùng Facebook";
    if (colonIdx > 0) {
      const beforeColon = fullSummary.slice(0, colonIdx);
      const words = beforeColon.split(/\s+(?:đã|thích|nhắc|bình luận|trả lời)\s+/i);
      author = (words[0] || "Người dùng Facebook").trim();
    }

    return {
      index: i + 1,
      author,
      actionText: fullSummary,
      type,
      isUnread,
      time: timeLine,
      href: el.href || null,
      elementIndex: el.index
    };
  });

  return {
    ok: true,
    count: parsedNotifications.length,
    notifications: parsedNotifications
  };
}

/**
 * Mở thông báo và tự động vào trả lời bình luận của bài đăng
 */
export async function openNotificationAndReplyComment(
  db: Database,
  target: { notificationIndex?: number; href?: string; customReply?: string },
  onActivity?: (ev: any) => void
): Promise<{ ok: boolean; message: string; details?: any }> {
  // 1. Xác định URL hoặc index cần mở
  let targetHref = target.href;
  let authorName = "Khách hàng";

  if (!targetHref && target.notificationIndex) {
    const list = await readFacebookNotifications();
    const notif = list.notifications.find(n => n.index === target.notificationIndex);
    if (!notif || !notif.href) {
      return { ok: false, message: `Không tìm thấy thông báo số [${target.notificationIndex}] hoặc thông báo không có liên kết bài viết.` };
    }
    targetHref = notif.href;
    authorName = notif.author;
  }

  if (!targetHref) {
    return { ok: false, message: "Cần cung cấp notificationIndex hoặc href để mở bài viết." };
  }

  // 2. Điều hướng vào URL bài viết
  await browserBridge.execute("open", { url: targetHref });
  await new Promise(r => setTimeout(r, 3000));

  // 3. Đọc bình luận có cấu trúc từ bài viết
  let commentsData: any = await browserBridge.execute("read_comments", {}).catch(() => null);
  let comments: any[] = commentsData?.comments || [];

  // Nếu chưa thấy bình luận, đọc lại read_page để tìm ô bình luận
  const page = await browserBridge.execute("read_page");
  const elements: any[] = page.elements || [];

  // 4. Tìm ô nhập bình luận hoặc nút Trả lời
  // Ưu tiên 1: Đã có ô nhập trả lời cụ thể đang mở (ví dụ: ariaLabel "Trả lời [Tên]…")
  let replyBox = elements.find((e: any) => {
    const a = (e.ariaLabel || "").toLowerCase();
    const p = (e.placeholder || "").toLowerCase();
    return (a.includes("trả lời ") || a.includes("viết câu trả lời")) && e.inView !== false;
  });

  // Nếu tìm thấy ô "Trả lời [Tên]…", bóc tách tên tác giả thực tế nếu authorName chưa rõ ràng
  if (replyBox && replyBox.ariaLabel) {
    const nameMatch = replyBox.ariaLabel.match(/trả lời\s+([^…\.\n]+)/i);
    if (nameMatch && nameMatch[1] && (authorName === "Khách hàng" || authorName === "Người dùng Facebook")) {
      authorName = nameMatch[1].trim();
    }
  }

  // Ưu tiên 2: Nếu chưa có ô trả lời mở sẵn, tìm và click nút "Trả lời" của bình luận
  if (!replyBox) {
    const replyBtnIndex = (comments.length > 0 && comments[0].replyIndex) ||
      elements.find((e: any) => {
        const t = (e.text || "").trim();
        const a = (e.ariaLabel || "").toLowerCase();
        return (t === "Trả lời" || a === "trả lời" || a.includes("trả lời bình luận")) && e.inView !== false;
      })?.index;

    if (replyBtnIndex) {
      await browserBridge.execute("click", { index: replyBtnIndex }).catch(() => null);
      await new Promise(r => setTimeout(r, 800));

      // Đọc lại để tìm ô nhập câu trả lời vừa xuất hiện
      const freshPage = await browserBridge.execute("read_page");
      const freshElements: any[] = freshPage.elements || [];
      replyBox = freshElements.find((e: any) => {
        const a = (e.ariaLabel || "").toLowerCase();
        const p = (e.placeholder || "").toLowerCase();
        return (a.includes("trả lời") || p.includes("trả lời") || a.includes("viết") || p.includes("viết") || e.role === "textbox") && e.inView !== false;
      });

      if (replyBox && replyBox.ariaLabel) {
        const nameMatch = replyBox.ariaLabel.match(/trả lời\s+([^…\.\n]+)/i);
        if (nameMatch && nameMatch[1] && (authorName === "Khách hàng" || authorName === "Người dùng Facebook")) {
          authorName = nameMatch[1].trim();
        }
      }
    }
  }

  // Ưu tiên 3: Nếu vẫn chưa có, fall back sang ô nhập bình luận chung của bài viết
  if (!replyBox) {
    replyBox = elements.find((e: any) => {
      const a = (e.ariaLabel || "").toLowerCase();
      const p = (e.placeholder || "").toLowerCase();
      return (a.includes("bình luận") || p.includes("bình luận") || e.role === "textbox") && e.inView !== false;
    });
  }

  if (!replyBox) {
    return { ok: false, message: "Không tìm thấy ô nhập bình luận hoặc nút Trả lời trên bài viết." };
  }

  // 5. Soạn câu trả lời bình luận theo kịch bản
  const commentContext = comments[0]?.text || targetHref;
  const replyText = target.customReply || generateSalesComment(authorName, commentContext);

  // 6. Gõ và gửi bình luận
  await browserBridge.execute("type", {
    index: replyBox.index,
    text: replyText,
    pressEnter: true
  });

  // Chờ 800ms để kiểm tra xem bình luận đã gửi đi chưa. Nếu ô nhập vẫn còn nội dung, bấm nút Đăng bình luận dự phòng
  await new Promise(r => setTimeout(r, 800));
  const postPage = await browserBridge.execute("read_page").catch(() => null);
  const currentBox = (postPage?.elements || []).find((e: any) => e.index === replyBox.index || (e.ariaLabel || "").toLowerCase().includes("trả lời"));
  const stillHasText = currentBox && currentBox.text && currentBox.text.trim().length > 0 && !currentBox.text.includes("Viết") && !currentBox.text.includes("…");

  if (stillHasText) {
    const submitBtn = (postPage?.elements || []).find((e: any) => {
      const a = (e.ariaLabel || "").toLowerCase();
      const t = (e.text || "").toLowerCase();
      return (a.includes("đăng bình luận") || a.includes("comment") || a.includes("gửi") || t.includes("đăng")) && e.inView !== false;
    });
    if (submitBtn) {
      await browserBridge.execute("click", { index: submitBtn.index }).catch(() => null);
    }
  }

  // 7. Ghi nhận vào SQLite
  const conv = getOrCreateConversation(db, authorName);
  recordMessage(db, conv.id, "customer", commentContext, "discovery");
  recordMessage(db, conv.id, "bot", replyText, "discovery");

  onActivity?.({
    type: "fb_notification_reply",
    author: authorName,
    postUrl: targetHref,
    replyText
  });

  return {
    ok: true,
    message: `Đã mở bài viết từ thông báo của '${authorName}', trả lời bình luận: "${replyText}" và lưu SQLite thành công!`,
    details: {
      author: authorName,
      postUrl: targetHref,
      replyText
    }
  };
}
