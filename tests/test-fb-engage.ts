#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import {
  decideEngagement,
  hashPostKey,
  isPostEngaged,
  listFeedEngagements,
  recordFeedEngagement
} from "../src/daemon/fb-engage";

console.log("[*] Chạy bài kiểm thử đơn vị FB Feed Engagement...");

// 1. Test hash consistency
const key1 = hashPostKey("SoulFlowers - Tiệm Hoa Tươi Đà Nẵng", "Một món quà chẳng cần dịp – nhưng luôn mang theo sự ấm áp chân thành.");
const key2 = hashPostKey("SoulFlowers - Tiệm Hoa Tươi Đà Nẵng", "Một món quà chẳng cần dịp – nhưng luôn mang theo sự ấm áp chân thành.");
const key3 = hashPostKey("SoulFlowers - Tiệm Hoa Tươi Đà Nẵng", "Nội dung bài viết khác hoàn toàn");

if (key1 !== key2) throw new Error("Hash phải nhất quán cho cùng tác giả và nội dung!");
if (key1 === key3) throw new Error("Hash phải khác nhau khi nội dung khác nhau!");
console.log("  [+] Test hashPostKey: PASS");

// 2. Test safety filters
const sponsoredDec = decideEngagement({
  author: "Có Thể Bạn Thừa Biết",
  text: "Quảng cáo được tài trợ nội dung này",
  isSponsored: true
});
if (sponsoredDec.shouldEngage !== false || !sponsoredDec.skipReason?.includes("quảng cáo")) {
  throw new Error("Phải bỏ qua bài quảng cáo!");
}

const ownPostDec = decideEngagement({
  author: "Nhân Văn Sùng",
  text: "Chúc mọi người cuối tuần vui vẻ!"
}, "Nhân Văn Sùng");
if (ownPostDec.shouldEngage !== false || !ownPostDec.skipReason?.includes("chính mình")) {
  throw new Error("Phải bỏ qua bài viết của chính mình!");
}
console.log("  [+] Test safety filters (Sponsored + Own Post): PASS");

// 3. Test contextual decision
const flowerDec = decideEngagement({
  author: "SoulFlowers - Tiệm Hoa Tươi Đà Nẵng",
  text: "Một bó hoa tươi trao gửi sự ấm áp chân thành ngày cuối tuần."
});
if (flowerDec.shouldEngage !== true || flowerDec.reaction !== "love" || flowerDec.category !== "flowers_gifts") {
  throw new Error("Ngữ cảnh tiệm hoa phải chọn love và category flowers_gifts!");
}
if (!flowerDec.commentText || flowerDec.commentText.length < 10) {
  throw new Error("Comment cho tiệm hoa không hợp lệ!");
}

const sportDec = decideEngagement({
  author: "FC Bayern Munich",
  text: "Trận đấu bóng đá kinh điển với chiến thắng ngoạn mục!"
});
if (sportDec.shouldEngage !== true || sportDec.reaction !== "like" || sportDec.category !== "sports") {
  throw new Error("Ngữ cảnh thể thao phải chọn like và category sports!");
}
console.log("  [+] Test contextual decisions (Flowers + Sports): PASS");

// 4. Test SQLite storage & duplicate prevention
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE fb_feed_engagements (
    id TEXT PRIMARY KEY,
    post_key TEXT NOT NULL UNIQUE,
    author TEXT NOT NULL,
    post_snippet TEXT,
    reaction TEXT CHECK(reaction IN ('like', 'love', 'none')) NOT NULL DEFAULT 'like',
    comment_text TEXT,
    status TEXT CHECK(status IN ('liked', 'commented', 'both', 'skipped', 'failed')) NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_fb_feed_engagements_key ON fb_feed_engagements(post_key);
`);

const initialCheck = isPostEngaged(db, key1);
if (initialCheck !== false) throw new Error("Chưa tương tác phải trả về false!");

recordFeedEngagement(db, {
  id: "eng-1",
  postKey: key1,
  author: "SoulFlowers - Tiệm Hoa Tươi Đà Nẵng",
  postSnippet: "Một món quà chẳng cần dịp...",
  reaction: "love",
  commentText: flowerDec.commentText,
  status: "both",
  createdAt: Date.now()
});

const afterCheck = isPostEngaged(db, key1);
if (afterCheck !== true) throw new Error("Sau khi ghi sổ phải trả về true!");

const history = listFeedEngagements(db);
if (history.length !== 1 || history[0].postKey !== key1 || history[0].reaction !== "love") {
  throw new Error("Lịch sử tương tác trả về không khớp!");
}
console.log("  [+] Test SQLite persistence & duplicate prevention: PASS");

console.log("\n✅ [ALL 4/4 PASS] BỘ TEST ĐƠN VỊ FB FEED ENGAGEMENT HOÀN TOÀN THÀNH CÔNG!");

