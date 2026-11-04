#!/usr/bin/env bun
/**
 * Test D4: Live RSS qua đường MCP tool (SSE client kết nối trực tiếp vào daemon)
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function main() {
  console.log("[*] Đang kết nối tới Daemon qua MCP SSE (http://127.0.0.1:1993/sse)...");
  const transport = new SSEClientTransport(new URL("http://127.0.0.1:1993/sse"));
  const client = new Client({ name: "test-fb-rss-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("[+] Đã kết nối MCP Client thành công!");

  // 1. Kiểm tra danh sách tools
  const { tools } = await client.listTools();
  const fbPostTools = tools.filter(t => t.name.startsWith("fb_post_"));
  console.log(`[+] Tìm thấy ${fbPostTools.length} FB Post tools:`, fbPostTools.map(t => t.name).join(", "));

  if (!fbPostTools.some(t => t.name === "fb_post_start") || !fbPostTools.some(t => t.name === "fb_post_fetch_news")) {
    throw new Error("Thiếu tool fb_post_start hoặc fb_post_fetch_news!");
  }

  // 2. Gọi fb_post_start qua MCP tool
  console.log("[*] Gọi tool fb_post_start...");
  const startRes: any = await client.callTool({
    name: "fb_post_start",
    arguments: {
      targetUrl: "https://www.facebook.com/?locale=vi_VN",
      maxPosts: 1,
      digestSize: 3
    }
  });

  const startText = startRes.content?.[0]?.text;
  console.log("[+] Kết quả fb_post_start:", startText);
  const startData = JSON.parse(startText);
  const runId = startData.runId;
  if (!runId) throw new Error("Không nhận được runId!");

  // 3. Gọi fb_post_fetch_news qua MCP tool (Live RSS từ VnExpress + Tuổi Trẻ)
  console.log(`[*] Gọi tool fb_post_fetch_news cho runId: ${runId}...`);
  const fetchRes: any = await client.callTool({
    name: "fb_post_fetch_news",
    arguments: {
      runId
    }
  });

  const fetchText = fetchRes.content?.[0]?.text;
  console.log("[+] Kết quả fb_post_fetch_news:", fetchText);
  const fetchData = JSON.parse(fetchText);
  console.log(`[+] Đã lấy tin thành công: ${fetchData.newItems} tin mới, tổng: ${fetchData.totalItems} tin.`);

  // 4. Gọi fb_post_next để lấy digest qua MCP tool
  console.log("[*] Gọi tool fb_post_next...");
  const nextRes: any = await client.callTool({
    name: "fb_post_next",
    arguments: {
      runId
    }
  });

  const nextText = nextRes.content?.[0]?.text;
  console.log("[+] Kết quả fb_post_next:");
  console.log(nextText);
  const nextData = JSON.parse(nextText);

  if (!nextData.digestText || !nextData.items || nextData.items.length === 0) {
    throw new Error("fb_post_next không trả về digest hợp lệ!");
  }

  // 5. Dừng phiên kiểm thử bằng fb_post_finish
  console.log("[*] Dừng phiên test bằng fb_post_finish...");
  const finishRes: any = await client.callTool({
    name: "fb_post_finish",
    arguments: {
      runId,
      reason: "Hoàn tất kiểm thử D4 live RSS qua MCP tool"
    }
  });
  console.log("[+] Kết quả fb_post_finish:", finishRes.content?.[0]?.text);

  await client.close();
  console.log("\n✅ [D4 PASS] LIVE RSS QUA ĐƯỜNG MCP TOOL ĐÃ THỰC THI THÀNH CÔNG VỚI DỮ LIỆU THẬT!");
}

main().catch(err => {
  console.error("❌ [D4 FAIL]:", err);
  process.exit(1);
});

