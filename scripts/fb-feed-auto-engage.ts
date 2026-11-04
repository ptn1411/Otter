#!/usr/bin/env bun
/**
 * Quy trình Tự Động Tương Tác Like & Bình Luận Bảng Feed Facebook (Smart Feed Engagement)
 *
 * Chức năng:
 * - Tự động quét các bài viết trên Feed tab Facebook đang mở.
 * - Lọc an toàn: Bỏ qua bài quảng cáo "Được tài trợ", bài của chính mình, bài đã tương tác.
 * - AI Context Analysis: Phân tích nội dung để quyết định cảm xúc (Thích / Thả tim) và câu bình luận tiếng Việt tự nhiên, phù hợp chủ đề.
 * - Thực thi trực tiếp qua Otter Extension & MCP Daemon.
 * - Ghi sổ SQLite chống tương tác trùng vĩnh viễn.
 * - Hỗ trợ giới hạn số bài (--max), thời gian giãn cách an toàn (--interval) và chế độ xem trước (--dry-run).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { buildGroupIntroComment } from "../src/daemon/fb-engage";

interface Args {
  max: number;
  intervalSec: number;
  dryRun: boolean;
  groupName: string;
  groupUrl: string;
  customIntro?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let max = 2; // Mặc định tương tác 2 bài / lần chạy để an toàn tài khoản
  let intervalSec = 15;
  let dryRun = false;
  let groupName = "Vibe Code kiếm cơm";
  let groupUrl = "https://www.facebook.com/groups/1385451906420187";
  let customIntro: string | undefined = undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max" && argv[i + 1]) {
      max = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--interval" && argv[i + 1]) {
      intervalSec = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === "--group-name" && argv[i + 1]) {
      groupName = argv[i + 1];
      i++;
    } else if (argv[i] === "--group-url" && argv[i + 1]) {
      groupUrl = argv[i + 1];
      i++;
    } else if (argv[i] === "--custom-intro" && argv[i + 1]) {
      customIntro = argv[i + 1];
      i++;
    } else if (argv[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { max, intervalSec, dryRun, groupName, groupUrl, customIntro };
}

async function main() {
  const args = parseArgs();
  console.log("================================================================================");
  console.log("🚀 QUY TRÌNH TỰ ĐỘNG TƯƠNG TÁC LIKE & BÌNH LUẬN FEED FACEBOOK (SMART ENGAGE)");
  console.log("================================================================================");
  console.log(`- Mục tiêu tương tác tối đa: ${args.max} bài`);
  console.log(`- Giãn cách an toàn: ${args.intervalSec}s`);
  console.log(`- Chế độ: ${args.dryRun ? "🔍 XEM TRƯỚC (Dry Run - Không click/gõ)" : "⚡ THỰC THI THẬT (Live Engagement)"}`);
  console.log("--------------------------------------------------------------------------------");

  const transport = new SSEClientTransport(new URL("http://127.0.0.1:1993/sse"));
  const client = new Client({ name: "fb-feed-auto-engage", version: "1.0.0" }, { capabilities: {} });

  console.log("[*] Đang kết nối tới Otter Daemon MCP...");
  await client.connect(transport);
  console.log("[+] Đã kết nối MCP Server thành công!\n");

  let engagedCount = 0;
  let scanRounds = 0;
  const maxRounds = 5;

  while (engagedCount < args.max && scanRounds < maxRounds) {
    scanRounds++;
    console.log(`\n--- VÒNG QUÉT THỨ ${scanRounds} ---`);

    // Dọn sạch màn hình: Đóng mọi khung chat Messenger đang mở nếu có
    try {
      const closeRes: any = await client.callTool({
        name: "fb_close_chat_tabs",
        arguments: {}
      });
      const closeText = closeRes.content?.[0]?.text;
      if (closeText && !closeText.includes("Không có khung")) {
        console.log(`[*] ${closeText}`);
      }
    } catch {}

    console.log("[*] Đang quét cấu trúc bài viết trên Feed...");
    const scanRes: any = await client.callTool({
      name: "fb_feed_scan",
      arguments: {}
    });

    const scanText = scanRes.content?.[0]?.text;
    if (!scanText) {
      console.log("[-] Không nhận được dữ liệu từ fb_feed_scan.");
      break;
    }

    const scanData = JSON.parse(scanText);
    const posts: any[] = scanData.posts || [];
    console.log(`[+] Tìm thấy tổng cộng ${posts.length} bài viết trên trang (Khả dụng: ${scanData.eligibleCount} bài).`);

    for (const post of posts) {
      if (engagedCount >= args.max) break;

      console.log(`\n📌 Tác giả: ${post.author}`);
      console.log(`   Nội dung: "${post.snippet.replace(/\n+/g, " ")}"`);

      if (!post.decision.shouldEngage) {
        console.log(`   ⏭️  BỎ QUA: ${post.decision.skipReason || (post.alreadyEngaged ? "Đã tương tác trong DB" : "Đã thích trước đó")}`);
        continue;
      }

      console.log(`   🎯 ĐÁNH GIÁ NGỮ CẢNH: [Chủ đề: ${post.decision.category}]`);
      console.log(`   ❤️  Cảm xúc chọn: ${post.decision.reaction.toUpperCase()}`);

      const commentText = buildGroupIntroComment(
        post.snippet,
        args.groupName,
        args.groupUrl,
        args.customIntro
      );
      console.log(`   💬 Bình luận giới thiệu nhóm: "${commentText}"`);

      if (args.dryRun) {
        console.log("   [Dry Run] Bỏ qua bước click thực tế.");
        engagedCount++;
        continue;
      }

      console.log("   ⚡ Đang thực thi Like & Bình luận thật qua Extension...");
      const engageRes: any = await client.callTool({
        name: "fb_feed_engage_post",
        arguments: {
          author: post.author,
          postSnippet: post.snippet,
          likeIndex: post.likeIndex,
          commentIndex: post.commentIndex,
          reaction: post.decision.reaction,
          commentText
        }
      });

      const resText = engageRes.content?.[0]?.text;
      console.log(`   [+] Kết quả: ${resText}`);
      engagedCount++;

      if (engagedCount < args.max) {
        console.log(`   ⏳ Nghỉ an toàn ${args.intervalSec} giây chống checkpoint Facebook...`);
        await new Promise(r => setTimeout(r, args.intervalSec * 1000));
      }
    }

    if (engagedCount < args.max) {
      console.log("\n📜 Đang cuộn trang xuống để tải thêm bài viết mới...");
      await client.callTool({
        name: "browser_scroll",
        arguments: { direction: "down", amount: 900 }
      });
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log("\n================================================================================");
  console.log(`🎉 HOÀN THÀNH QUY TRÌNH TƯƠNG TÁC FEED: ĐÃ TƯƠNG TÁC ${engagedCount}/${args.max} BÀI.`);
  console.log("================================================================================");

  // Hiển thị lịch sử tương tác
  const historyRes: any = await client.callTool({
    name: "fb_feed_history",
    arguments: { limit: 5 }
  });
  console.log("[*] Lịch sử tương tác gần nhất trong SQLite:");
  console.log(historyRes.content?.[0]?.text);

  await client.close();
}

main().catch(err => {
  console.error("❌ Lỗi quy trình:", err);
  process.exit(1);
});

