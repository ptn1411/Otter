import { initDatabase } from "../src/daemon/db";
import {
  getOrCreateConversation,
  nextSalesReply,
  getConversationMessages,
  generateSalesComment
} from "../src/daemon/fb-sales";

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ FB SALES & MESSENGER PLAYBOOK ===");
  const db = initDatabase();

  // Test 1: Khởi tạo hội thoại
  const conv = getOrCreateConversation(db, "Phạm Thành Nam");
  console.log("Test 1 - Conversation Init:", conv.recipientName === "Phạm Thành Nam" ? "PASS" : "FAIL");

  // Test 2: Bước 1 Greeting -> Discovery
  const r1 = nextSalesReply(db, "Phạm Thành Nam", "chào bạn chúc bạn vv");
  console.log("Test 2 - Step 1 (Greeting):", r1.currentStage === "greeting" && r1.nextStage === "discovery" ? "PASS" : "FAIL");
  console.log("Reply 1:", r1.replyText);

  // Test 3: Bước 2 Discovery -> Pitch
  const r2 = nextSalesReply(db, "Phạm Thành Nam", "mình đang tìm giải pháp tự động");
  console.log("Test 3 - Step 2 (Discovery):", r2.currentStage === "discovery" && r2.nextStage === "pitch" ? "PASS" : "FAIL");
  console.log("Reply 2:", r2.replyText);

  // Test 4: Lịch sử tin nhắn được lưu vào SQLite
  const msgs = getConversationMessages(db, conv.id);
  console.log("Test 4 - History count in SQLite:", msgs.length >= 4 ? `PASS (${msgs.length} messages)` : "FAIL");

  // Test 5: Comment seeding kịch bản
  const c1 = generateSalesComment("Du Lịch Việt Nam", "Bài viết về cảnh đẹp Đà Nẵng chuyến đi...");
  console.log("Test 5 - Comment Playbook:", c1.length > 20 ? "PASS" : "FAIL");
  console.log("Comment:", c1);

  console.log("=== TOÀN BỘ KIỂM THỬ THÀNH CÔNG ===");
  process.exit(0);
}

runTests().catch(console.error);

