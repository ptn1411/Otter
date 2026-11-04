/**
 * FB Feed Engagement — Bộ điều khiển và ghi sổ tương tác Bảng feed Facebook (Daemon side).
 *
 * Nhiệm vụ:
 * 1. Phân tích ngữ cảnh bài viết trên Feed (tác giả, nội dung, chủ đề, cảm xúc).
 * 2. Lọc an toàn: Bỏ qua bài quảng cáo "Được tài trợ", bài của chính mình, bài đã tương tác.
 * 3. AI / Rule-based Context Decision:
 *    - Quyết định cảm xúc: Like (Thích) hoặc Love (Thả tim).
 *    - Soạn câu bình luận ngắn gọn (1–2 câu) tự nhiên, chân thành, phù hợp ngữ cảnh tiếng Việt.
 * 4. Quản lý ghi sổ SQLite chống trùng lặp vĩnh viễn (post_key hash).
 */
import * as crypto from "node:crypto";
import { browserBridge } from "./browser-bridge";
import { getDatabase } from "./db";

export interface FeedEngagementEntry {
  id: string;
  postKey: string;
  author: string;
  postSnippet: string;
  reaction: "like" | "love" | "none";
  commentText?: string;
  status: "liked" | "commented" | "both" | "skipped" | "failed";
  createdAt: number;
}

export interface EngagementDecision {
  shouldEngage: boolean;
  skipReason?: string;
  reaction: "like" | "love" | "none";
  commentText?: string;
  category: "flowers_gifts" | "sports" | "tech_code" | "life_chill" | "general";
}

/**
 * Tạo hash duy nhất cho bài viết dựa vào tác giả và nội dung trích xuất
 */
export function hashPostKey(author: string, snippet: string): string {
  const normAuthor = (author || "").trim().toLowerCase();
  const normSnippet = (snippet || "").slice(0, 150).trim().toLowerCase().replace(/\s+/g, " ");
  return crypto.createHash("sha256").update(`${normAuthor}::${normSnippet}`).digest("hex").slice(0, 24);
}

/**
 * Kiểm tra xem bài viết đã từng được tương tác trong DB chưa
 */
export function isPostEngaged(db: any, postKey: string): boolean {
  const row = db.query(`SELECT id FROM fb_feed_engagements WHERE post_key = ?`).get(postKey);
  return !!row;
}

/**
 * Ghi nhận một lần tương tác vào SQLite
 */
export function recordFeedEngagement(db: any, entry: FeedEngagementEntry): void {
  db.query(`
    INSERT OR REPLACE INTO fb_feed_engagements (
      id, post_key, author, post_snippet, reaction, comment_text, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.postKey,
    entry.author,
    entry.postSnippet,
    entry.reaction,
    entry.commentText || null,
    entry.status,
    entry.createdAt
  );
}

/**
 * Lấy lịch sử tương tác gần nhất
 */
export function listFeedEngagements(db: any, limit = 20): FeedEngagementEntry[] {
  const rows = db.query(`
    SELECT id, post_key as postKey, author, post_snippet as postSnippet,
           reaction, comment_text as commentText, status, created_at as createdAt
    FROM fb_feed_engagements
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  return rows;
}

/**
 * Bộ phân tích ngữ cảnh và quyết định tương tác thông minh
 */
export function decideEngagement(
  post: { author: string; text: string; isSponsored?: boolean },
  currentUserName = "Nhân Văn Sùng"
): EngagementDecision {
  const text = (post.text || "").toLowerCase();
  const author = (post.author || "").trim();

  // 1. Kiểm tra an toàn: Quảng cáo
  if (post.isSponsored || text.includes("được tài trợ") || text.includes("sponsored")) {
    return {
      shouldEngage: false,
      skipReason: "Bài quảng cáo được tài trợ (Sponsored)",
      reaction: "none",
      category: "general"
    };
  }

  // 2. Kiểm tra an toàn: Bài viết của chính mình
  if (author.toLowerCase().includes(currentUserName.toLowerCase())) {
    return {
      shouldEngage: false,
      skipReason: "Bài viết của chính mình",
      reaction: "none",
      category: "general"
    };
  }

  // 3. Nội dung quá ngắn hoặc rỗng
  if (text.length < 15 && author.length < 3) {
    return {
      shouldEngage: false,
      skipReason: "Nội dung bài viết quá ngắn hoặc không rõ ràng",
      reaction: "none",
      category: "general"
    };
  }

  // 4. Phân loại ngữ cảnh theo từ khóa chuyên biệt

  // Nhóm A: Hoa tươi, quà tặng, nghệ thuật thủ công, làm đẹp
  if (
    /hoa\s*tươi|tiệm\s*hoa|vườn\s*hoa|bó\s*hoa|quà\s*tặng|ấm\s*áp|chân\s*thành|xinh\s*quá|đẹp\s*quá|nước\s*hoa|mỹ\s*phẩm/i.test(text) ||
    /tiệm\s*hoa|flower|flowershop/i.test(author)
  ) {
    const comments = [
      "Hoa đẹp và thông điệp ý nghĩa quá shop ơi! Chúc tiệm luôn đông khách nha 🌸",
      "Mẫu hoa này nhìn xinh và tinh tế ghê! Chúc shop ngày mới thật nhiều đơn nhé 💐",
      "Tone hoa nhìn nhẹ nhàng và ấm áp quá, chúc tiệm buôn may bán đắt nha!",
      "Nhìn tươi tắn và nhiều năng lượng tích cực quá, chúc shop luôn đắt khách nhé 🌺"
    ];
    return {
      shouldEngage: true,
      reaction: "love",
      commentText: comments[Math.floor(Math.random() * comments.length)],
      category: "flowers_gifts"
    };
  }

  // Nhóm B: Thể thao, bóng đá, thể hình
  if (
    /bóng\s*đá|thể\s*thao|fc\s*bayern|munich|trận\s*đấu|bàn\s*thắng|vô\s*địch|cầu\s*thủ|chiến\s*thắng/i.test(text) ||
    /fc\s*bayern|bóng\s*đá|football/i.test(author)
  ) {
    const comments = [
      "Trận đấu hay và tinh thần thi đấu rất tuyệt vời! Tiếp tục phát huy nhé!",
      "Phong độ đỉnh cao thật sự, chúc đội tuyển gặt hái thêm nhiều thắng lợi mới!",
      "Hình ảnh năng lượng và tinh thần thể thao rất ấn tượng!"
    ];
    return {
      shouldEngage: true,
      reaction: "like",
      commentText: comments[Math.floor(Math.random() * comments.length)],
      category: "sports"
    };
  }

  // Nhóm C: Công nghệ, Lập trình, AI, Sách, Kiến thức
  if (
    /lập\s*trình|công\s*nghệ|trí\s*tuệ\s*nhân\s*tạo|kiến\s*thức|phần\s*mềm|developer|coding/i.test(text)
  ) {
    const comments = [
      "Chia sẻ rất thực tế và hữu ích, cảm ơn bạn nhiều nhé!",
      "Góc nhìn rất hay và đáng suy ngẫm, chúc bạn luôn giữ vững đam mê!",
      "Bài viết chất lượng quá, cảm ơn tác giả đã lan tỏa thông tin giá trị!"
    ];
    return {
      shouldEngage: true,
      reaction: "like",
      commentText: comments[Math.floor(Math.random() * comments.length)],
      category: "tech_code"
    };
  }

  // Nhóm D: Đời sống, Chúc ngày mới, Cuối tuần, Du lịch, Thư giãn
  if (
    /cuối\s*tuần|ngày\s*mới|buổi\s*sáng|bình\s*yên|chill|thư\s*giãn|du\s*lịch|cà\s*phê|thảnh\s*thơi/i.test(text)
  ) {
    const comments = [
      "Chúc bạn có một ngày thật nhiều niềm vui và bình an nhé!",
      "Không gian nhìn thích quá, chúc bạn cuối tuần an lành và nạp đầy năng lượng nha!",
      "Bình yên và nhẹ nhàng quá, chúc bạn luôn ngập tràn niềm vui trong cuộc sống!"
    ];
    return {
      shouldEngage: true,
      reaction: "love",
      commentText: comments[Math.floor(Math.random() * comments.length)],
      category: "life_chill"
    };
  }

  // Nhóm E: Tương tác tích cực mặc định (General Positive)
  const defaultComments = [
    "Bài viết rất hay và ý nghĩa, chúc bạn một ngày tốt lành và nhiều may mắn nhé!",
    "Tuyệt vời quá, chúc bạn luôn tràn đầy năng lượng tích cực nha!",
    "Rất thích năng lượng tích cực từ bài viết của bạn, chúc bạn ngày càng thành công!"
  ];

  return {
    shouldEngage: true,
    reaction: "like",
    commentText: defaultComments[Math.floor(Math.random() * defaultComments.length)],
    category: "general"
  };
}

export interface EngagePostArgs {
  author: string;
  postSnippet: string;
  likeIndex?: number;
  commentIndex?: number;
  reaction?: "like" | "love" | "care" | "haha" | "wow" | "sad" | "angry" | "none";
  commentText?: string;
  category?: string;
}

/**
 * Thực thi quét feed, lọc bài và đánh giá ngữ cảnh tự động
 */
export async function scanFacebookFeed(onActivity?: (event: any) => void) {
  const feedRes = await browserBridge.execute("read_feed");
  const db = getDatabase();

  const rawPosts = feedRes?.posts || [];
  const evaluatedPosts = rawPosts.map((p: any) => {
    const postKey = hashPostKey(p.author, p.textSnippet);
    const alreadyEngaged = isPostEngaged(db, postKey);
    const decision = decideEngagement(p, "Nhân Văn Sùng");

    return {
      author: p.author,
      isSponsored: p.isSponsored,
      isLiked: p.isLiked,
      alreadyEngaged,
      postKey,
      likeIndex: p.likeIndex,
      commentIndex: p.commentIndex,
      decision: {
        ...decision,
        shouldEngage: decision.shouldEngage && !alreadyEngaged && !p.isLiked
      },
      snippet: (p.textSnippet || "").slice(0, 200)
    };
  });

  onActivity?.({
    type: "fb_feed",
    action: "scan",
    total: evaluatedPosts.length,
    eligible: evaluatedPosts.filter((p: any) => p.decision.shouldEngage).length
  });

  return {
    totalFound: evaluatedPosts.length,
    eligibleCount: evaluatedPosts.filter((p: any) => p.decision.shouldEngage).length,
    posts: evaluatedPosts
  };
}

/**
 * Thực thi tương tác thả cảm xúc và bình luận vào bài viết cụ thể
 */
export async function engageFacebookPost(args: EngagePostArgs, onActivity?: (event: any) => void) {
  const db = getDatabase();
  const postKey = hashPostKey(args.author, args.postSnippet);

  if (isPostEngaged(db, postKey)) {
    return { ok: false, message: "Bài viết này đã được tương tác trước đó trong cơ sở dữ liệu." };
  }

  let didLike = false;
  let didComment = false;
  let commentVerified = false;
  let commentMessage = "";

  // 1. Thực hiện Like hoặc Reaction chuyên sâu (chỉ khi reaction !== "none")
  if (args.reaction && args.reaction !== "none" && (typeof args.likeIndex === "number" || args.author)) {
    try {
      const reactRes: any = await browserBridge.execute("fb_react", {
        index: args.likeIndex,
        author: args.author,
        reaction: args.reaction || "like"
      });
      if (reactRes?.ok && reactRes?.actualReaction !== "none") {
        didLike = true;
      } else if (typeof args.likeIndex === "number" && args.reaction !== "none") {
        // Fallback click trực tiếp
        const clickRes: any = await browserBridge.execute("click", { index: args.likeIndex });
        if (clickRes?.ok) didLike = true;
      }
    } catch {
      if (typeof args.likeIndex === "number" && args.reaction !== "none") {
        try {
          const clickRes: any = await browserBridge.execute("click", { index: args.likeIndex });
          if (clickRes?.ok) didLike = true;
        } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // 2. Thực hiện Comment chuyên sâu kèm quy trình thao tác trực tiếp và xác thực thực tế
  if (args.commentText && (typeof args.commentIndex === "number" || args.author)) {
    try {
      const commentRes: any = await browserBridge.execute("fb_comment", {
        commentIndex: args.commentIndex,
        author: args.author,
        commentText: args.commentText
      });

      if (commentRes?.verified) {
        didComment = true;
        commentVerified = true;
        commentMessage = commentRes.message || "Bình luận đã được xác nhận xuất hiện thực tế trên Facebook.";
      } else {
        didComment = false;
        commentVerified = false;
        commentMessage = commentRes?.message || "Không thể xác nhận bình luận đã hiển thị trên Facebook sau khi gửi.";
      }
    } catch (e: any) {
      didComment = false;
      commentVerified = false;
      commentMessage = `Lỗi gửi bình luận: ${e.message}`;
    }
  }

  // Đánh giá trạng thái chính xác: chỉ tính là commented khi ĐÃ XÁC NHẬN thực tế trên Facebook (không báo khống)
  const status = didLike && didComment ? "both" : didLike ? "liked" : didComment ? "commented" : "failed";

  if (status !== "failed") {
    recordFeedEngagement(db, {
      id: "eng-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      postKey,
      author: args.author,
      postSnippet: args.postSnippet,
      reaction: didLike ? (args.reaction || "like") : "none",
      commentText: didComment ? args.commentText : undefined,
      status,
      createdAt: Date.now()
    });
  }

  onActivity?.({
    type: "fb_feed",
    action: "engage",
    author: args.author,
    reaction: args.reaction,
    status,
    commentVerified
  });

  return {
    ok: status !== "failed",
    status,
    author: args.author,
    reaction: didLike ? args.reaction : "none",
    commentText: didComment ? args.commentText : undefined,
    commentVerified,
    message: status === "both"
      ? `Đã Thích và xác nhận Bình luận thành công vào bài viết của ${args.author}!`
      : status === "commented"
      ? `Đã xác nhận Bình luận thành công vào bài viết của ${args.author}!`
      : status === "liked"
      ? `Đã Thích bài viết của ${args.author} (Lưu ý: ${commentMessage || "chưa bình luận"}).`
      : `Chưa thể tương tác bài viết của ${args.author}: ${commentMessage}`
  };
}

/**
 * Soạn câu bình luận giới thiệu nhóm Facebook khéo léo theo ngữ cảnh bài viết
 */
export function buildGroupIntroComment(
  snippet: string,
  groupName: string,
  groupUrl: string,
  customIntro?: string
): string {
  if (customIntro && customIntro.trim()) {
    return `${customIntro.trim()} ${groupUrl}`.trim();
  }
  const text = (snippet || "").toLowerCase();

  // Nhóm Công nghệ / AI / Lập trình / Automation
  if (/ai|agent|code|docker|lập trình|python|developer|it|tool|bot|máy chủ|linux|cloud|software|phần mềm|tech/i.test(text)) {
    return `Bài viết chia sẻ rất hay và thiết thực cho anh em làm công nghệ! Bên mình cũng có cộng đồng "${groupName}" (${groupUrl}) chuyên chia sẻ kinh nghiệm AI agent, automation và mẹo code thực chiến, rất mong được đón tiếp bạn và mọi người cùng giao lưu nhé! 🚀`;
  }

  // Nhóm Kiếm tiền / MMO / Marketing / Sales / Kinh doanh
  if (/kiếm tiền|kinh doanh|marketing|sales|bán hàng|mmo|traffic|doanh thu|khách hàng|đơn hàng/i.test(text)) {
    return `Góc nhìn rất thực tế và giá trị! Mời bạn và mọi người ghé nhóm "${groupName}" (${groupUrl}) cùng trao đổi thêm về các giải pháp tự động hóa và kinh nghiệm thực chiến nhé! ✨`;
  }

  // Nhóm Đời sống / Du lịch / Thư giãn / Chung
  return `Cảm ơn chia sẻ giá trị của bạn! Tiện đây mời mọi người ghé thăm nhóm "${groupName}" (${groupUrl}) cùng kết nối và giao lưu kinh nghiệm nhé! 👍`;
}

/**
 * Quy trình tự động lướt Bảng tin (Feed), quét bài viết, thả Thích và bình luận giới thiệu nhóm
 */
export async function autoEngageFacebookFeed(
  input: {
    maxPosts?: number;
    groupName?: string;
    groupUrl?: string;
    customIntro?: string;
    intervalSeconds?: number;
    dryRun?: boolean;
  },
  onActivity?: (event: any) => void
): Promise<{
  ok: boolean;
  totalEngaged: number;
  maxTarget: number;
  items: Array<{
    author: string;
    snippet: string;
    reaction: string;
    comment: string;
    status: string;
  }>;
  message: string;
}> {
  const maxPosts = Math.min(Math.max(input.maxPosts || 2, 1), 10);
  const groupName = input.groupName || "Vibe Code kiếm cơm";
  const groupUrl = input.groupUrl || "https://www.facebook.com/groups/1385451906420187";
  const intervalSec = input.intervalSeconds || 15;
  const dryRun = !!input.dryRun;

  try {
    await browserBridge.execute("close_messenger_docks");
  } catch {}

  let engagedCount = 0;
  let scanRounds = 0;
  const maxRounds = 5;
  const engagedItems: Array<{
    author: string;
    snippet: string;
    reaction: string;
    comment: string;
    status: string;
  }> = [];

  while (engagedCount < maxPosts && scanRounds < maxRounds) {
    scanRounds++;
    const scanRes = await scanFacebookFeed(onActivity);
    const posts: any[] = scanRes.posts || [];

    for (const post of posts) {
      if (engagedCount >= maxPosts) break;
      if (!post.decision.shouldEngage) continue;

      const commentText = buildGroupIntroComment(
        post.snippet,
        groupName,
        groupUrl,
        input.customIntro
      );

      const reaction = post.decision.reaction || "like";

      if (dryRun) {
        engagedCount++;
        engagedItems.push({
          author: post.author,
          snippet: post.snippet,
          reaction,
          comment: commentText,
          status: "dry_run"
        });
        continue;
      }

      const res = await engageFacebookPost(
        {
          author: post.author,
          postSnippet: post.snippet,
          likeIndex: post.likeIndex,
          commentIndex: post.commentIndex,
          reaction,
          commentText
        },
        onActivity
      );

      engagedCount++;
      engagedItems.push({
        author: post.author,
        snippet: post.snippet,
        reaction,
        comment: commentText,
        status: res.status || "completed"
      });

      if (engagedCount < maxPosts) {
        await new Promise((r) => setTimeout(r, intervalSec * 1000));
      }
    }

    if (engagedCount < maxPosts) {
      try {
        await browserBridge.execute("scroll", { direction: "down", amount: 900 });
        await new Promise((r) => setTimeout(r, 3000));
      } catch {}
    }
  }

  return {
    ok: true,
    totalEngaged: engagedCount,
    maxTarget: maxPosts,
    items: engagedItems,
    message: `Đã hoàn thành phiên tự động lướt Bảng tin và tương tác giới thiệu nhóm (${engagedCount}/${maxPosts} bài).`
  };
}


