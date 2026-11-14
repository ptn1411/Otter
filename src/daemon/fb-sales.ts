/**
 * Facebook Sales Playbook & Messenger Conversation Engine
 *
 * Quản lý kịch bản bán hàng qua Messenger & chiến lược bình luận (seeding/tương tác)
 * bám sát phễu chuyển đổi (State Machine: Greeting -> Discovery -> Pitch -> Objection -> Closing -> Support).
 * Toàn bộ kịch bản được lưu và quản lý trực tiếp trong SQLite (fb_sales_playbook, fb_sales_intents, fb_sales_comments)
 * và có thể tra cứu / chỉnh sửa nóng qua ChatGPT Web MCP Tool mà không cần khởi động lại.
 */
import type { Database } from "bun:sqlite";
import { browserBridge } from "./browser-bridge";

export type SalesStage = "greeting" | "discovery" | "pitch" | "objection" | "closing" | "support" | "done";

export interface SalesPlaybookStep {
  stage: SalesStage;
  name: string;
  goal: string;
  templates: string[];
}

export interface SalesIntentRule {
  intentKey: string;
  name: string;
  description?: string;
  keywords: string[];
  replyTemplate: string;
  nextStage: SalesStage;
}

export interface CommentTemplateCategory {
  category: string;
  name: string;
  templates: string[];
}

export const DEFAULT_SALES_PLAYBOOK: SalesPlaybookStep[] = [
  {
    stage: "greeting",
    name: "Chào hỏi & Kết nối thiện cảm",
    goal: "Phản hồi lời chào ấm áp, cảm ơn thiện chí và khéo léo mở đầu câu chuyện.",
    templates: [
      "Chào {name} nhé! Cảm ơn lời chúc tốt đẹp của bạn nha, chúc {name} một ngày mới thật nhiều năng lượng, niềm vui và công việc thuận lợi nhé! 😊",
      "Dạ chào {name}! Thấy {name} nhắn tin chúc mình vui quá, chúc bạn hôm nay làm việc thật suôn sẻ và gặt hái nhiều kết quả tốt nhé! ✨"
    ]
  },
  {
    stage: "discovery",
    name: "Thăm dò nhu cầu & Lắng nghe nỗi đau",
    goal: "Hỏi thăm công việc, nhận diện xem khách có nhu cầu tối ưu hóa / tự động hóa không.",
    templates: [
      "Dạo này công việc bên {name} thế nào rồi ạ? Bạn có đang tìm kiếm giải pháp tự động hóa để tiết kiệm thời gian chăm sóc khách hàng và bán hàng không?",
      "Cảm ơn {name} nhiều nha! À nhân tiện {name} cho mình hỏi chút là bên bạn hiện tại quản lý tin nhắn và tương tác mạng xã hội thủ công hay đã dùng công cụ tự động nào hỗ trợ chưa?"
    ]
  },
  {
    stage: "pitch",
    name: "Giới thiệu giải pháp phù hợp",
    goal: "Trình bày giải pháp Otter Agentic AI giải quyết đúng nhu cầu của khách hàng.",
    templates: [
      "Bật mí với {name} là bên mình đang phát triển Otter Agent - trợ lý AI có thể tự động đọc feed, phân tích nội dung bài viết và nhắn tin chăm sóc khách hàng 24/7 trực tiếp trên trình duyệt. Giúp tiết kiệm 80% thời gian trực tin nhắn luôn đó!",
      "Nếu {name} muốn giải phóng thời gian thì giải pháp Otter bên mình là chuẩn bài luôn: AI tự hiểu ngữ cảnh khách hàng, trả lời chuẩn kịch bản bán hàng và không bao giờ sót tin nhắn!"
    ]
  },
  {
    stage: "objection",
    name: "Xử lý thắc mắc & Cam kết tin cậy",
    goal: "Giải tỏa lo lắng về độ an toàn, chi phí hoặc tính dễ dùng.",
    templates: [
      "{name} hoàn toàn yên tâm nhé! Hệ thống chạy trực tiếp trên profile trình duyệt cá nhân của bạn, không cần cấp token nguy hiểm và có cơ chế giãn cách an toàn tuyệt đối chống checkpoint.",
      "Bạn cứ trải nghiệm thử miễn phí hoàn toàn nhé, có đội ngũ kỹ thuật hỗ trợ cài đặt 1-1 cho {name} bất cứ lúc nào luôn!"
    ]
  },
  {
    stage: "closing",
    name: "Kêu gọi hành động & Chốt trải nghiệm",
    goal: "Mời dùng thử, xin thông tin Zalo/Telegram hoặc kích hoạt tài khoản.",
    templates: [
      "{name} có muốn mình setup bản dùng thử miễn phí để trải nghiệm ngay trong hôm nay không? Bạn cho mình xin số Zalo hoặc kết nối để mình gửi tài liệu hướng dẫn nhanh nhé! 🚀",
      "Hôm nay bên mình đang có chương trình hỗ trợ trải nghiệm sớm cho các bạn nhiệt tình, {name} gửi mình thông tin mình kích hoạt dùng ngay nhé!"
    ]
  },
  {
    stage: "support",
    name: "Hỗ trợ & Đồng hành khách hàng",
    goal: "Sẵn sàng giải đáp mọi thắc mắc thêm của khách hàng mà không bị lặp lại chào hỏi.",
    templates: [
      "Dạ mình đây ạ! {name} cần hỗ trợ thêm thông tin gì về phần mềm hay cách thức cài đặt cứ thoải mái nhắn mình nhé, mình luôn ở đây sẵn sàng hỗ trợ bạn! 😊",
      "Nếu {name} cần xem video demo thực tế hoặc hỗ trợ kết nối trực tiếp thì cứ nhắn mình nhé, bên mình luôn có người trực để hỗ trợ bạn ngay!"
    ]
  }
];

export const DEFAULT_SALES_INTENTS: SalesIntentRule[] = [
  {
    intentKey: "identity",
    name: "Hỏi danh tính / Bạn là ai",
    description: "Khách hỏi bạn là ai, người hay bot, ai đấy...",
    keywords: ["bạn là ai", "ai vậy", "ai đấy", "bot à", "là ai", "người hay bot", "mày là ai"],
    replyTemplate: "Chào {name} nhé! Mình là Otter - trợ lý AI tự động hóa bán hàng & chăm sóc khách hàng 24/7 trực tiếp trên trình duyệt. Mình giúp tự động đọc tin nhắn, trả lời khách và tư vấn chốt đơn bám sát kịch bản để bạn không lo sót khách hàng nào nhé! 😊 {name} có đang tìm giải pháp tự động hóa tương tự không?",
    nextStage: "discovery"
  },
  {
    intentKey: "features",
    name: "Hỏi tính năng / Công dụng",
    description: "Khách hỏi sản phẩm làm được gì, tính năng, công dụng...",
    keywords: ["làm gì", "làm được gì", "tính năng", "công dụng", "tác dụng", "giúp gì", "dùng làm gì"],
    replyTemplate: "Dạ Otter Agent có 4 khả năng vượt trội giúp bạn bán hàng và tương tác:\n1. 💬 Tự động lắng nghe & trả lời tin nhắn Messenger 24/7 theo phễu bán hàng.\n2. 📝 Tự động đọc bài viết và bình luận thông minh, tự nhiên như người thật.\n3. 🔒 Chạy trực tiếp trên trình duyệt cá nhân (Chrome/GPM), an toàn tuyệt đối không lo checkpoint hay mất nick.\n4. 🚀 Tiết kiệm 80% thời gian trực chat và không bao giờ bỏ sót khách hàng tiềm năng!\n{name} có muốn mình setup bản dùng thử miễn phí để trải nghiệm ngay không?",
    nextStage: "closing"
  },
  {
    intentKey: "pricing",
    name: "Hỏi giá / Chi phí",
    description: "Khách hỏi giá, bao nhiêu tiền, chi phí...",
    keywords: ["giá", "bao nhiêu", "chi phí", "báo giá", "mua thế nào", "tiền"],
    replyTemplate: "Dạ hiện tại bên mình đang hỗ trợ bản dùng thử MIỄN PHÍ 100% để {name} trải nghiệm đầy đủ tính năng trước ạ! Chi phí chính thức sau này cũng cực kỳ tiết kiệm, chỉ bằng vài ly cafe mỗi tháng thôi. {name} gửi mình số Zalo để mình gửi bảng tính năng chi tiết và kích hoạt dùng thử ngay nhé! 🚀",
    nextStage: "closing"
  },
  {
    intentKey: "praise",
    name: "Khen ngợi / Đồng thuận",
    description: "Khách khen hay đó, ok, tuyệt, quan tâm...",
    keywords: ["hay đó", "hay quá", "tuyệt", "ok", "oke", "được", "tốt", "quan tâm", "uhm", "ừ"],
    replyTemplate: "Dạ cảm ơn {name} nhiều nha! Hôm nay bên mình đang có chương trình hỗ trợ cài đặt và kích hoạt bản dùng thử miễn phí 1-1. Bạn cho mình xin số Zalo hoặc kết nối để mình gửi bản trải nghiệm nhanh nhé! ✨",
    nextStage: "closing"
  },
  {
    intentKey: "objection_safety",
    name: "Lo ngại an toàn / Checkpoint",
    description: "Khách sợ khóa nick, sợ mất an toàn...",
    keywords: ["sợ", "khóa", "an toàn", "checkpoint", "bị ban", "mất nick"],
    replyTemplate: "{name} hoàn toàn yên tâm nhé! Otter không yêu cầu cung cấp cookie/token nguy hiểm, mà chạy mô phỏng thao tác người thật trực tiếp trên profile Chrome của bạn với cơ chế giãn cách tự nhiên, đảm bảo an toàn tuyệt đối chống checkpoint! Bạn trải nghiệm thử sẽ thấy rất mượt mà. {name} nhắn mình số Zalo mình kích hoạt thử nhé! 🛡️",
    nextStage: "closing"
  },
  {
    intentKey: "general_support",
    name: "Hỗ trợ khách hàng sau khi hoàn tất phễu",
    description: "Khách hỏi thêm thông tin chung khi đã ở giai đoạn sau...",
    keywords: ["hỗ trợ", "giúp", "ở đây không", "hỏi thêm"],
    replyTemplate: "Dạ mình đây ạ! {name} cần hỗ trợ thêm thông tin gì về phần mềm hay cách thức cài đặt cứ thoải mái nhắn mình nhé, mình luôn ở đây sẵn sàng hỗ trợ bạn! 😊",
    nextStage: "support"
  }
];

export const DEFAULT_COMMENT_TEMPLATES: CommentTemplateCategory[] = [
  {
    category: "travel",
    name: "Bài viết du lịch & phong cảnh",
    templates: [
      "Góc nhìn và chia sẻ của bạn hay quá! Chúc trang ngày càng có thêm nhiều hành trình truyền cảm hứng như thế này nhé! 🌿",
      "Hình ảnh đẹp và thông tin hữu ích quá ạ, nhìn thôi là muốn xách ba lô lên và đi ngay! Chúc bạn luôn tràn đầy năng lượng!",
      "Nội dung rất ý nghĩa, cảm ơn bạn đã chia sẻ để mọi người có thêm động lực khám phá cảnh đẹp Việt Nam! ✨"
    ]
  },
  {
    category: "shop",
    name: "Bài viết bán hàng & cửa hàng",
    templates: [
      "Sản phẩm đẹp và bài viết rất tâm huyết ạ! Chúc shop luôn đắt hàng và buôn may bán đắt nha! 🌸",
      "Thông tin rõ ràng và chuyên nghiệp quá! Chúc shop ngày càng phát triển và bùng nổ doanh số nhé!",
      "Rất thích cách phục vụ chu đáo của shop. Chúc cửa hàng luôn là điểm đến tin cậy của đông đảo khách hàng!"
    ]
  },
  {
    category: "general",
    name: "Bình luận chung tạo thiện cảm",
    templates: [
      "Rất thích năng lượng tích cực từ bài viết của {author}! Chúc bạn luôn nhiều niềm vui và thành công nhé! 🚀",
      "Góc nhìn thú vị và rất thực tế ạ. Mong sẽ được theo dõi thêm nhiều bài chia sẻ hữu ích như thế này từ bạn! ✨",
      "Bài viết truyền cảm hứng tuyệt vời quá! Chúc {author} một tuần mới ngập tràn may mắn và hiệu quả nha! ❤️"
    ]
  }
];

/**
 * Đảm bảo bảng kịch bản bán hàng và intent được khởi tạo sẵn trong SQLite nếu rỗng
 */
export function ensureSalesPlaybookInDb(db: Database): void {
  try {
    const pCount = (db.query("SELECT COUNT(*) as c FROM fb_sales_playbook").get() as any)?.c || 0;
    if (pCount === 0) {
      const stmt = db.prepare("INSERT OR REPLACE INTO fb_sales_playbook (id, stage, name, goal, templates_json, rules_json, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?)");
      const now = Date.now();
      for (const step of DEFAULT_SALES_PLAYBOOK) {
        stmt.run(step.stage, step.stage, step.name, step.goal, JSON.stringify(step.templates), now);
      }
    }

    const iCount = (db.query("SELECT COUNT(*) as c FROM fb_sales_intents").get() as any)?.c || 0;
    if (iCount === 0) {
      const stmt = db.prepare("INSERT OR REPLACE INTO fb_sales_intents (id, intent_key, name, description, keywords_json, reply_template, next_stage, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const now = Date.now();
      for (const rule of DEFAULT_SALES_INTENTS) {
        stmt.run(rule.intentKey, rule.intentKey, rule.name, rule.description || "", JSON.stringify(rule.keywords), rule.replyTemplate, rule.nextStage, now);
      }
    }

    const cCount = (db.query("SELECT COUNT(*) as c FROM fb_sales_comments").get() as any)?.c || 0;
    if (cCount === 0) {
      const stmt = db.prepare("INSERT OR REPLACE INTO fb_sales_comments (id, category, name, templates_json, updated_at) VALUES (?, ?, ?, ?, ?)");
      const now = Date.now();
      for (const cat of DEFAULT_COMMENT_TEMPLATES) {
        stmt.run(cat.category, cat.category, cat.name, JSON.stringify(cat.templates), now);
      }
    }
  } catch (err) {
    console.warn("[fb-sales] Error ensuring playbook in db:", err);
  }
}

/**
 * Lấy danh sách các bước kịch bản bán hàng từ DB
 */
export function getPlaybookFromDb(db: Database): SalesPlaybookStep[] {
  try {
    ensureSalesPlaybookInDb(db);
    const rows = db.query<any, []>("SELECT stage, name, goal, templates_json FROM fb_sales_playbook ORDER BY rowid ASC").all();
    if (!rows || rows.length === 0) return DEFAULT_SALES_PLAYBOOK;
    return rows.map(r => ({
      stage: r.stage as SalesStage,
      name: r.name,
      goal: r.goal,
      templates: JSON.parse(r.templates_json || "[]")
    }));
  } catch {
    return DEFAULT_SALES_PLAYBOOK;
  }
}

/**
 * Lấy danh sách các Intent từ DB
 */
export function getIntentsFromDb(db: Database): SalesIntentRule[] {
  try {
    ensureSalesPlaybookInDb(db);
    const rows = db.query<any, []>("SELECT intent_key, name, description, keywords_json, reply_template, next_stage FROM fb_sales_intents ORDER BY rowid ASC").all();
    if (!rows || rows.length === 0) return DEFAULT_SALES_INTENTS;
    return rows.map(r => ({
      intentKey: r.intent_key,
      name: r.name,
      description: r.description,
      keywords: JSON.parse(r.keywords_json || "[]"),
      replyTemplate: r.reply_template,
      nextStage: r.next_stage as SalesStage
    }));
  } catch {
    return DEFAULT_SALES_INTENTS;
  }
}

/**
 * Lấy danh sách danh mục bình luận mẫu từ DB
 */
export function getCommentTemplatesFromDb(db: Database): CommentTemplateCategory[] {
  try {
    ensureSalesPlaybookInDb(db);
    const rows = db.query<any, []>("SELECT category, name, templates_json FROM fb_sales_comments ORDER BY rowid ASC").all();
    if (!rows || rows.length === 0) return DEFAULT_COMMENT_TEMPLATES;
    return rows.map(r => ({
      category: r.category,
      name: r.name,
      templates: JSON.parse(r.templates_json || "[]")
    }));
  } catch {
    return DEFAULT_COMMENT_TEMPLATES;
  }
}

/**
 * Cập nhật một bước trong phễu bán hàng
 */
export function updatePlaybookStepInDb(
  db: Database,
  step: { stage: SalesStage; name?: string; goal?: string; templates: string[] }
): { ok: boolean; message: string; step: any } {
  ensureSalesPlaybookInDb(db);
  const existing = db.query<any, [string]>("SELECT * FROM fb_sales_playbook WHERE stage = ?").get(step.stage);
  const now = Date.now();
  const name = step.name || existing?.name || step.stage;
  const goal = step.goal || existing?.goal || "";
  const templatesJson = JSON.stringify(step.templates);

  db.query(`
    INSERT INTO fb_sales_playbook (id, stage, name, goal, templates_json, rules_json, updated_at)
    VALUES (?, ?, ?, ?, ?, '[]', ?)
    ON CONFLICT(stage) DO UPDATE SET
      name = excluded.name,
      goal = excluded.goal,
      templates_json = excluded.templates_json,
      updated_at = excluded.updated_at
  `).run(step.stage, step.stage, name, goal, templatesJson, now);

  return {
    ok: true,
    message: `Đã cập nhật kịch bản giai đoạn '${step.stage}' thành công với ${step.templates.length} câu mẫu.`,
    step: { stage: step.stage, name, goal, templates: step.templates }
  };
}

/**
 * Cập nhật một Intent trong DB
 */
export function updateIntentInDb(
  db: Database,
  intent: { intentKey: string; name?: string; description?: string; keywords?: string[]; replyTemplate: string; nextStage?: SalesStage }
): { ok: boolean; message: string; intent: any } {
  ensureSalesPlaybookInDb(db);
  const existing = db.query<any, [string]>("SELECT * FROM fb_sales_intents WHERE intent_key = ?").get(intent.intentKey);
  const now = Date.now();
  const name = intent.name || existing?.name || intent.intentKey;
  const description = intent.description ?? existing?.description ?? "";
  const keywords = intent.keywords || (existing?.keywords_json ? JSON.parse(existing.keywords_json) : []);
  const nextStage = intent.nextStage || existing?.next_stage || "closing";

  db.query(`
    INSERT INTO fb_sales_intents (id, intent_key, name, description, keywords_json, reply_template, next_stage, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(intent_key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      keywords_json = excluded.keywords_json,
      reply_template = excluded.reply_template,
      next_stage = excluded.next_stage,
      updated_at = excluded.updated_at
  `).run(intent.intentKey, intent.intentKey, name, description, JSON.stringify(keywords), intent.replyTemplate, nextStage, now);

  return {
    ok: true,
    message: `Đã cập nhật ý định '${intent.intentKey}' thành công!`,
    intent: { intentKey: intent.intentKey, name, keywords, replyTemplate: intent.replyTemplate, nextStage }
  };
}

/**
 * Cập nhật danh sách câu bình luận theo chủ đề
 */
export function updateCommentTemplatesInDb(
  db: Database,
  category: string,
  templates: string[],
  name?: string
): { ok: boolean; message: string; category: string; count: number } {
  ensureSalesPlaybookInDb(db);
  const existing = db.query<any, [string]>("SELECT * FROM fb_sales_comments WHERE category = ?").get(category);
  const now = Date.now();
  const catName = name || existing?.name || category;

  db.query(`
    INSERT INTO fb_sales_comments (id, category, name, templates_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category) DO UPDATE SET
      name = excluded.name,
      templates_json = excluded.templates_json,
      updated_at = excluded.updated_at
  `).run(category, category, catName, JSON.stringify(templates), now);

  return {
    ok: true,
    message: `Đã cập nhật danh mục bình luận '${category}' thành công với ${templates.length} câu mẫu.`,
    category,
    count: templates.length
  };
}

/**
 * Khôi phục lại toàn bộ kịch bản bán hàng & bình luận về mặc định
 */
export function resetSalesPlaybookInDb(db: Database): { ok: boolean; message: string } {
  db.query("DELETE FROM fb_sales_playbook").run();
  db.query("DELETE FROM fb_sales_intents").run();
  db.query("DELETE FROM fb_sales_comments").run();
  ensureSalesPlaybookInDb(db);
  return {
    ok: true,
    message: "Đã khôi phục toàn bộ kịch bản bán hàng, ý định (intents) và câu bình luận về mặc định của Otter!"
  };
}

/**
 * Lấy toàn bộ tổng quan kịch bản bán hàng và bình luận hiện tại trong DB
 */
export function getFullPlaybookOverview(db: Database): {
  stages: SalesPlaybookStep[];
  intents: SalesIntentRule[];
  commentCategories: CommentTemplateCategory[];
} {
  return {
    stages: getPlaybookFromDb(db),
    intents: getIntentsFromDb(db),
    commentCategories: getCommentTemplatesFromDb(db)
  };
}

export interface ConversationRecord {
  id: string;
  recipientName: string;
  stage: SalesStage;
  productInterest?: string;
  notes?: string;
  lastMessageText?: string;
  lastMessageAt: number;
}

/**
 * Tìm hoặc khởi tạo cuộc hội thoại của khách hàng trong DB
 */
export function getOrCreateConversation(db: Database, recipientName: string, profileUrl?: string): ConversationRecord {
  const cleanName = (recipientName || "").trim();
  const id = "conv-" + cleanName.toLowerCase().replace(/[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/g, "-");

  const existing = db.query<any, [string]>("SELECT * FROM fb_conversations WHERE id = ?").get(id);
  const now = Date.now();

  if (existing) {
    return {
      id: existing.id,
      recipientName: existing.recipient_name,
      stage: existing.stage as SalesStage,
      productInterest: existing.product_interest,
      notes: existing.notes,
      lastMessageText: existing.last_message_text,
      lastMessageAt: existing.last_message_at
    };
  }

  db.query(
    `INSERT INTO fb_conversations (id, recipient_name, profile_url, stage, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, 'greeting', ?, ?, ?)`
  ).run(id, cleanName, profileUrl || null, now, now, now);

  return {
    id,
    recipientName: cleanName,
    stage: "greeting",
    lastMessageAt: now
  };
}

/**
 * Ghi lại tin nhắn gửi hoặc nhận vào lịch sử
 */
export function recordMessage(
  db: Database,
  conversationId: string,
  sender: "customer" | "bot",
  text: string,
  stage?: SalesStage
): void {
  const id = "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  const now = Date.now();

  db.query(
    `INSERT INTO fb_messages (id, conversation_id, sender, text, stage_at_send, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, conversationId, sender, text, stage || null, now);

  db.query(
    `UPDATE fb_conversations SET last_message_text = ?, last_message_at = ?, updated_at = ? WHERE id = ?`
  ).run(text, now, now, conversationId);
}

/**
 * Cập nhật giai đoạn phễu bán hàng của khách hàng
 */
export function updateConversationStage(db: Database, conversationId: string, nextStage: SalesStage): void {
  db.query(
    `UPDATE fb_conversations SET stage = ?, updated_at = ? WHERE id = ?`
  ).run(nextStage, Date.now(), conversationId);
}

/**
 * Lấy lịch sử tin nhắn gần nhất
 */
export function getConversationMessages(db: Database, conversationId: string, limit = 10): any[] {
  return db.query<any, [string, number]>(
    `SELECT * FROM (
       SELECT * FROM fb_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?
     ) ORDER BY created_at ASC`
  ).all(conversationId, limit);
}

/**
 * Lấy gợi ý câu trả lời theo kịch bản bán hàng & ý định động (chỉ tính toán, không ghi DB)
 */
export function getSuggestedSalesReply(
  db: Database,
  recipientName: string,
  customerMessage: string
): { replyText: string; currentStage: SalesStage; nextStage: SalesStage } {
  ensureSalesPlaybookInDb(db);
  const conv = getOrCreateConversation(db, recipientName);
  const msgLower = (customerMessage || "").toLowerCase().trim();

  let nextStage: SalesStage = conv.stage;
  let replyText = "";

  // 1. Kiểm tra nếu khách để lại Số điện thoại / Zalo (Lead capture tự động)
  const phoneMatch = customerMessage.match(/(0[3|5|7|8|9]\d{8})/);
  if (phoneMatch) {
    const phone = phoneMatch[0];
    replyText = `Tuyệt vời quá! Mình đã lưu lại số điện thoại/Zalo ${phone} của ${recipientName} rồi nhé. Đội ngũ kỹ thuật bên mình sẽ chủ động kết nối để gửi tài liệu và hỗ trợ bạn kích hoạt bản dùng thử miễn phí ngay trong ít phút tới nha. Chúc ${recipientName} một ngày ngập tràn niềm vui và kinh doanh bùng nổ! 🎉`;
    nextStage = "done";
  } else {
    // 2. Tra cứu động các Intent từ SQLite
    const dynamicIntents = getIntentsFromDb(db);
    for (const intent of dynamicIntents) {
      const isMatched = (intent.keywords || []).some(kw => {
        const kwLower = kw.toLowerCase().trim();
        if (kwLower.length <= 3) {
          return msgLower === kwLower || msgLower.startsWith(kwLower + " ") || msgLower.endsWith(" " + kwLower);
        }
        return msgLower.includes(kwLower);
      });

      if (isMatched) {
        replyText = intent.replyTemplate.replace(/\{name\}/g, conv.recipientName);
        nextStage = intent.nextStage;
        break;
      }
    }

    // 3. Nếu không trúng intent nào, đi theo phễu bán hàng trong DB
    if (!replyText) {
      const dynamicStages = getPlaybookFromDb(db);

      if (conv.stage === "greeting") {
        nextStage = "discovery";
      } else if (conv.stage === "discovery") {
        nextStage = "pitch";
      } else if (conv.stage === "pitch") {
        nextStage = "closing";
      } else if (conv.stage === "objection") {
        nextStage = "closing";
      } else if (conv.stage === "closing") {
        nextStage = "support";
      } else {
        nextStage = "support";
      }

      const activeStage = (conv.stage === "done" ? "support" : conv.stage);
      const stageConfig = dynamicStages.find(s => s.stage === activeStage) || dynamicStages[0];
      const templates = stageConfig?.templates || [];

      if (templates.length > 0) {
        const template = templates[Math.floor(Math.random() * templates.length)];
        replyText = template.replace(/\{name\}/g, conv.recipientName);
      } else {
        replyText = `Dạ mình đây ạ! ${recipientName} cần hỗ trợ thêm thông tin gì về sản phẩm hay cách thức đặt hàng cứ thoải mái nhắn mình nhé! 😊`;
      }
    }
  }

  return {
    replyText,
    currentStage: conv.stage,
    nextStage
  };
}

/**
 * Quyết định câu trả lời tiếp theo bám sát kịch bản bán hàng & nhận diện ý định động từ DB
 */
export function nextSalesReply(
  db: Database,
  recipientName: string,
  customerMessage: string
): { replyText: string; currentStage: SalesStage; nextStage: SalesStage } {
  const conv = getOrCreateConversation(db, recipientName);
  const suggestion = getSuggestedSalesReply(db, recipientName, customerMessage);

  // Lưu lịch sử tin nhắn khách và bot
  recordMessage(db, conv.id, "customer", customerMessage, conv.stage);
  recordMessage(db, conv.id, "bot", suggestion.replyText, conv.stage);
  updateConversationStage(db, conv.id, suggestion.nextStage);

  return suggestion;
}

/**
 * Kịch bản bình luận Facebook (Comment Seeding Playbook) tra cứu động từ DB
 */
export function generateSalesComment(author: string, postSnippet: string, db?: Database): string {
  const snippetLower = (postSnippet || "").toLowerCase();
  let categories: CommentTemplateCategory[] = DEFAULT_COMMENT_TEMPLATES;
  if (db) {
    try {
      categories = getCommentTemplatesFromDb(db);
    } catch {}
  }

  const findTemplates = (catKey: string): string[] => {
    const cat = categories.find(c => c.category === catKey);
    return cat?.templates || [];
  };

  // 1. Du lịch, ẩm thực, phong cảnh
  if (snippetLower.includes("du lịch") || snippetLower.includes("cảnh") || snippetLower.includes("điểm đến") || snippetLower.includes("chuyến đi")) {
    const list = findTemplates("travel");
    if (list.length > 0) return list[Math.floor(Math.random() * list.length)];
  }

  // 2. Shop, bán hàng, sản phẩm
  if (snippetLower.includes("shop") || snippetLower.includes("sản phẩm") || snippetLower.includes("khách") || snippetLower.includes("giá") || snippetLower.includes("mua")) {
    const list = findTemplates("shop");
    if (list.length > 0) return list[Math.floor(Math.random() * list.length)];
  }

  // 3. Chung
  const generalList = findTemplates("general");
  if (generalList.length > 0) {
    const t = generalList[Math.floor(Math.random() * generalList.length)];
    return t.replace(/\{author\}/g, author);
  }

  return `Rất thích bài viết của ${author}! Chúc bạn luôn nhiều niềm vui và may mắn nhé! ✨`;
}

/**
 * Messenger Background Listener & Auto-Responder
 * Lắng nghe tin nhắn mới liên tục và tự động phản hồi bám sát kịch bản bán hàng
 */
export interface MessengerListenerStatus {
  active: boolean;
  intervalMs: number;
  mode: "chatgpt" | "playbook";
  lastCheckAt: number | null;
  lastRepliedTo: string | null;
  replyCount: number;
  forwardCount: number;
  lastForwardedTo: string | null;
  lastForwardedPrompt: string | null;
  lastError: string | null;
}

let listenerTimer: any = null;
let listenerStatus: MessengerListenerStatus = {
  active: false,
  intervalMs: 5000,
  mode: "chatgpt",
  lastCheckAt: null,
  lastRepliedTo: null,
  replyCount: 0,
  forwardCount: 0,
  lastForwardedTo: null,
  lastForwardedPrompt: null,
  lastError: null
};

// Bộ nhớ đệm chống spam lặp trong lúc chờ UI render tin nhắn của bot (debounce 15 giây cho cùng 1 câu nói của khách)
const lastRepliedTurns = new Map<string, { text: string; at: number }>();

/**
 * Kiểm tra 1 lượt xem có tin nhắn mới cần trả lời hay không
 */
export async function checkAndReplyMessengerOnce(
  db: Database,
  onActivity?: (ev: any) => void
): Promise<{ action: string; details?: any; recipient?: string; index?: number; error?: string }> {
  try {
    listenerStatus.lastCheckAt = Date.now();
    listenerStatus.lastError = null;
    const page = await browserBridge.execute("read_page", { urlPattern: "facebook.com" });
    if (!page || !page.summaryText) return { action: "no_page_data" };

    const summary: string = page.summaryText;

    // 1. Kiểm tra nếu có khung chat Messenger đang mở (từ page.messenger hoặc summary regex)
    const hasStructuredMessenger = Boolean(page.messenger?.isOpen);
    const chatDockMatch = summary.match(/=== KHUNG CHAT TIN NHẮN MESSENGER ĐANG MỞ ===\n- Đang nhắn tin với: ([^\n]+)/);

    if (hasStructuredMessenger || chatDockMatch) {
      const recipientName = (page.messenger?.recipient || chatDockMatch?.[1] || "Khách hàng").trim();

      // Hỗ trợ cả 2 thứ tự của ô nhập (trước hoặc sau danh sách tin nhắn)
      const inputIndexMatch = summary.match(/- Ô nhập tin nhắn trả lời: browser_type\(\{\s*index:\s*(\d+)/);
      const inputIndex = page.messenger?.inputIndex ?? (inputIndexMatch ? Number(inputIndexMatch[1]) : 30);

      // Trích xuất danh sách tin nhắn: ưu tiên page.messenger.messages
      let rawLines: string[] = [];
      if (Array.isArray(page.messenger?.messages) && page.messenger.messages.length > 0) {
        rawLines = page.messenger.messages.map((m: any) => `${m.sender}: ${m.text}`);
      } else {
        // Fallback regex hỗ trợ cả ô nhập ở trước lẫn ở sau
        const msgSectionMatch = summary.match(/- Tin nhắn trong cuộc trò chuyện:\n([\s\S]*?)(?:\n- Ô nhập tin nhắn trả lời:|\n===|$)/);
        if (msgSectionMatch) {
          rawLines = msgSectionMatch[1].split("\n").map(l => l.trim()).filter(Boolean);
        }
      }

      if (rawLines.length > 0) {
        const lastLine = rawLines[rawLines.length - 1] || "";

        // Nếu tin nhắn cuối cùng là từ khách (không bắt đầu bằng "Bạn:" hoặc "Shop:")
        if (lastLine && !lastLine.startsWith("Bạn:") && !lastLine.startsWith("Shop:")) {
          const colonIdx = lastLine.indexOf(":");
          const customerText = colonIdx > 0 ? lastLine.slice(colonIdx + 1).trim() : lastLine;

          const lastTurn = lastRepliedTurns.get(recipientName);
          const isDebounced = lastTurn && lastTurn.text === customerText && (Date.now() - lastTurn.at < 15000);

          if (!isDebounced && customerText.length > 0) {
            lastRepliedTurns.set(recipientName, { text: customerText, at: Date.now() });

            // Lưu tin nhắn của khách vào SQLite để lưu giữ ngữ cảnh hội thoại
            const conv = getOrCreateConversation(db, recipientName);
            recordMessage(db, conv.id, "customer", customerText, conv.stage);

            // Tự động đồng bộ các lượt chat trước đó từ khung chat Facebook vào SQLite (nếu chưa có)
            for (const prevLine of rawLines.slice(0, -1)) {
              const isShop = prevLine.startsWith("Bạn:");
              const colonIdx = prevLine.indexOf(":");
              const textContent = isShop ? prevLine.replace(/^Bạn:\s*/i, "").trim() : (colonIdx > 0 ? prevLine.slice(colonIdx + 1).trim() : prevLine).trim();
              if (textContent) {
                const exists = db.query<any, [string, string]>("SELECT 1 FROM fb_messages WHERE conversation_id = ? AND text = ? LIMIT 1").get(conv.id, textContent);
                if (!exists) {
                  recordMessage(db, conv.id, isShop ? "bot" : "customer", textContent, conv.stage);
                }
              }
            }

            // Lấy tối đa 10 tin nhắn gần nhất để tạo ngữ cảnh hội thoại đầy đủ cho AI
            const historyTurns = rawLines.slice(0, -1).slice(-10);
            let historyFormatted = "";
            if (historyTurns.length > 0) {
              historyFormatted = historyTurns.map((turn, i) => {
                if (turn.startsWith("Bạn:")) {
                  return `  ${i + 1}. [Shop/Bạn]: ${turn.replace(/^Bạn:\s*/i, "")}`;
                } else {
                  const cIdx = turn.indexOf(":");
                  const senderName = cIdx > 0 ? turn.slice(0, cIdx).trim() : recipientName;
                  const cText = cIdx > 0 ? turn.slice(cIdx + 1).trim() : turn;
                  return `  ${i + 1}. [Khách - ${senderName}]: ${cText}`;
                }
              }).join("\n");
            } else {
              const dbMsgs = getConversationMessages(db, conv.id, 10);
              if (dbMsgs.length > 1) {
                historyFormatted = dbMsgs.slice(0, -1).map((m, i) =>
                  `  ${i + 1}. [${m.sender === "bot" ? "Shop/Bạn" : `Khách - ${recipientName}`}]: ${m.text}`
                ).join("\n");
              } else {
                historyFormatted = "  (Chưa có lịch sử trao đổi trước đó - đây là tin mở đầu cuộc trò chuyện)";
              }
            }

            const suggestion = getSuggestedSalesReply(db, recipientName, customerText);

            // CHẾ ĐỘ 1 (MẶC ĐỊNH): Chuyển tin nhắn của khách lên cho ChatGPT Web tự động trả lời bằng AI
            if (listenerStatus.mode === "chatgpt") {
              const prompt = [
                `🔔 [TIN NHẮN FACEBOOK MESSENGER MỚI TỪ KHÁCH HÀNG]`,
                `- Khách hàng: "${recipientName}"`,
                `- Giai đoạn hội thoại hiện tại: ${conv.stage}`,
                ``,
                `📜 LỊCH SỬ 10 ĐOẠN CHAT GẦN NHẤT (ĐỂ NẮM RÕ TOÀN BỘ NGỮ CẢNH):`,
                historyFormatted,
                ``,
                `💬 NỘI DUNG TIN NHẮN MỚI NHẤT KHÁCH VỪA GỬI:`,
                `👉 "${customerText}"`,
                ``,
                `💡 Gợi ý phản hồi theo kịch bản mẫu (${suggestion.nextStage}):`,
                `"${suggestion.replyText}"`,
                `- Ô nhập tin nhắn trên Facebook: [index: ${inputIndex}]`,
                ``,
                `👉 YÊU CẦU CHO CHATGPT:`,
                `1. Đọc kỹ toàn bộ LỊCH SỬ CHAT ở trên để hiểu rõ khách đang hỏi tiếp điều gì hoặc có nhu cầu gì.`,
                `2. Đưa ra câu trả lời AI thông minh, tự nhiên, đúng trọng tâm và liền mạch với các câu đã trao đổi trước đó.`,
                `3. GỬI CÂU TRẢ LỜI CHO KHÁCH bằng lệnh sau:`,
                `browser_type({ index: ${inputIndex}, text: "<nội dung câu trả lời của bạn>", pressEnter: true, urlPattern: "facebook.com" })`
              ].join("\n");

              const injected = browserBridge.injectPrompt(prompt, true);

              listenerStatus.lastForwardedTo = recipientName;
              listenerStatus.lastForwardedPrompt = prompt;
              listenerStatus.forwardCount++;

              onActivity?.({
                type: "fb_messenger_forward_chatgpt",
                recipient: recipientName,
                customerMessage: customerText,
                injected,
                prompt
              });

              return {
                action: "forwarded_to_chatgpt",
                details: {
                  recipient: recipientName,
                  customerMessage: customerText,
                  injected,
                  suggestion: suggestion.replyText
                }
              };
            }

            // CHẾ ĐỘ 2: Tự động trả lời nhanh bằng câu mẫu có sẵn (Playbook Offline)
            const salesStep = nextSalesReply(db, recipientName, customerText);
            recordMessage(db, conv.id, "bot", salesStep.replyText, salesStep.nextStage);

            // Tự động gõ và gửi vào ô chat
            await browserBridge.execute("type", {
              index: inputIndex,
              text: salesStep.replyText,
              pressEnter: true,
              urlPattern: "facebook.com"
            });

            // Tự động click nút "Nhấn Enter để gửi" nếu Facebook Lexical chặn KeyboardEvent Enter
            await new Promise(r => setTimeout(r, 400));
            const freshPage = await browserBridge.execute("read_page", { urlPattern: "facebook.com" }).catch(() => null);
            const sendBtn = (freshPage?.elements || []).find((e: any) =>
              (e.ariaLabel || "").toLowerCase().includes("nhấn enter để gửi") ||
              (e.ariaLabel || "").toLowerCase().includes("press enter to send")
            );
            if (sendBtn) {
              await browserBridge.execute("click", { index: sendBtn.index, urlPattern: "facebook.com" }).catch(() => null);
            }

            listenerStatus.lastRepliedTo = recipientName;
            listenerStatus.replyCount++;

            onActivity?.({
              type: "fb_messenger_auto_reply",
              recipient: recipientName,
              customerMessage: customerText,
              stage: salesStep.currentStage,
              nextStage: salesStep.nextStage,
              replyText: salesStep.replyText
            });

            return {
              action: "replied_playbook",
              details: {
                recipient: recipientName,
                customerMessage: customerText,
                replyText: salesStep.replyText,
                stage: `${salesStep.currentStage} -> ${salesStep.nextStage}`
              }
            };
          }
        }
      }
    }

    // 2. Nếu khung chat chưa mở, kiểm tra xem Dropdown danh sách tin nhắn có đang mở và chứa tin chưa đọc không
    const dropdownMatch = summary.match(/\[(\d+)\] Khách: ([^|]+) \| Tin gần nhất: "[^"]*" \| Thao tác mở: browser_click\(\{\s*index:\s*(\d+)\s*\}\)/);
    if (dropdownMatch) {
      const clickIdx = Number(dropdownMatch[3]);
      await browserBridge.execute("click", { index: clickIdx, urlPattern: "facebook.com" });
      return { action: "opened_chat_dock_from_dropdown", recipient: dropdownMatch[2].trim(), index: clickIdx };
    }

    // 3. Nếu dropdown cũng chưa mở, kiểm tra nút Messenger trên thanh điều hướng có tin nhắn chưa đọc không
    const elements: any[] = page.elements || [];
    const unreadMsgBtn = elements.find((e: any) => {
      const a = (e.ariaLabel || "").toLowerCase();
      return a.includes("messenger") && (a.includes("chưa đọc") || a.includes("unread") || /\d+/.test(a));
    });

    if (unreadMsgBtn) {
      await browserBridge.execute("click", { index: unreadMsgBtn.index, urlPattern: "facebook.com" });
      return { action: "opened_messenger_dropdown", index: unreadMsgBtn.index };
    }

    return { action: "idle" };
  } catch (err: any) {
    listenerStatus.lastError = err.message;
    return { action: "error", error: err.message };
  }
}

/**
 * Bắt đầu vòng lặp lắng nghe tin nhắn tự động
 */
export function startMessengerListener(
  db: Database,
  onActivity?: (ev: any) => void,
  intervalMs = 5000,
  mode: "chatgpt" | "playbook" = "chatgpt"
): { ok: boolean; message: string; mode: string } {
  if (listenerStatus.active) {
    listenerStatus.mode = mode;
    return {
      ok: true,
      message: `Messenger Listener đang chạy sẵn (chu kỳ ${listenerStatus.intervalMs}ms, chế độ: ${mode})`,
      mode
    };
  }

  listenerStatus.active = true;
  listenerStatus.intervalMs = intervalMs;
  listenerStatus.mode = mode;
  listenerStatus.lastError = null;

  listenerTimer = setInterval(async () => {
    try {
      await checkAndReplyMessengerOnce(db, onActivity);
    } catch (e: any) {
      listenerStatus.lastError = e.message;
    }
  }, intervalMs);

  return {
    ok: true,
    message: `Đã kích hoạt Messenger Auto-Listener (chu kỳ: ${intervalMs}ms, chế độ: ${mode === "chatgpt" ? "Chuyển tin nhắn cho ChatGPT Web trả lời bằng AI" : "Tự động trả lời bằng câu mẫu Playbook"})`,
    mode
  };
}

/**
 * Dừng vòng lặp lắng nghe tin nhắn
 */
export function stopMessengerListener(): { ok: boolean; message: string } {
  if (listenerTimer) {
    clearInterval(listenerTimer);
    listenerTimer = null;
  }
  listenerStatus.active = false;
  return { ok: true, message: "Đã dừng Messenger Auto-Listener" };
}

/**
 * Lấy trạng thái hiện tại của Messenger Listener
 */
export function getMessengerListenerStatus(): MessengerListenerStatus {
  return { ...listenerStatus };
}
