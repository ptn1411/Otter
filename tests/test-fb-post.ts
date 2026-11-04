#!/usr/bin/env bun
/**
 * FB Auto Post test — tracker thuần + parser RSS, no MCP server,
 * no node_modules, no network cho phần thuần (parser dùng chuỗi RSS mẫu).
 * Uses a temp SQLite file, then checks:
 *  1. start tạo run auto mặc định (1 bài, 5 tin, 60 phút), chặn URL sai,
 *     chặn mode khác auto, chặn run trùng cùng đích,
 *  2. record idempotent (ghi lại cùng link không tạo dòng mới) nhưng
 *     cùng link ở phiên khác vẫn được,
 *  3. digest: đủ 5 tin, chứa đủ title+link, không trùng, có ngày và nguồn,
 *  4. next tôn trọng giới hạn bài, khoảng cách đăng, hết thời gian,
 *     và trả lý do rõ ràng khi không còn tin pending,
 *  5. mark_posted idempotent theo bài (gọi hai lần vẫn đếm 1 bài, đủ
 *     maxPosts thì phiên done), mark_failed blocked, mark_skipped,
 *  6. pause/resume/stop transitions + stop chặn next,
 *  7. parser RSS: CDATA, entity, HTML trong description, item thiếu
 *     title/link bị bỏ, XML hỏng không crash,
 *  8. persistence: mở lại DB cùng file, run + items vẫn còn.
 *
 * Run: bun scripts/test-fb-post.ts
 * Exit 0 = all checks pass, exit 1 = any check fails.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initDatabase } from "../src/daemon/db";
import { parseRss } from "../src/daemon/fb-news";
import {
  composeDigestPost,
  finishFbPostRun,
  getFbPostItems,
  getFbPostStatus,
  getPostedDigestCount,
  markFbPostFailed,
  markFbPostPosted,
  markFbPostSkipped,
  newsItemKey,
  nextFbPostDigest,
  pauseFbPostRun,
  recordFbPostItems,
  resumeFbPostRun,
  startFbPostRun,
  stopFbPostRun,
} from "../src/daemon/fb-post";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-fbpost-"));
const dbPath = path.join(tmpDir, "test.db");
const db: any = initDatabase(dbPath);

const TARGET = "https://www.facebook.com/test-page";
const FEED = "https://vnexpress.net/rss/tin-moi-nhat.rss";

// ---------- Parser RSS (không cần DB, không cần mạng) ----------
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Tin mới nhất</title>
<item><title><![CDATA[Tin A &amp; B]]></title><link>https://example.com/a</link><pubDate>Fri, 30 Oct 2026 09:49:25 +0700</pubDate><description><![CDATA[<a href="https://example.com/a"><img src="x.jpg"></a></br>Nội dung A.]]></description></item>
<item><title>Tin thường</title><link>https://example.com/b</link><description>Mô tả B</description></item>
<item><title>Thiếu link</title><description>Không có link</description></item>
<item><link>https://example.com/no-title</link></item>
<item><title>Link lạ</title><link>ftp://example.com/c</link></item>
</channel></rss>`;

const parsed = parseRss(SAMPLE_RSS, FEED);
check("parser keeps only items with title + http link", parsed.length === 2, parsed.length);
check("parser unwraps CDATA and decodes entities", parsed[0]?.title === "Tin A & B", parsed[0]?.title);
check("parser strips HTML from description", parsed[0]?.excerpt === "Nội dung A.", parsed[0]?.excerpt);
check("parser records source hostname", parsed[0]?.source === "vnexpress.net", parsed[0]?.source);
check("parser parses pubDate to ms", typeof parsed[0]?.pubDateMs === "number" && (parsed[0]?.pubDateMs ?? 0) > 0, parsed[0]?.pubDateMs);
check("parser leaves missing pubDate as null", parsed[1]?.pubDateMs === null, parsed[1]?.pubDateMs);
check("malformed XML returns empty without throwing", parseRss("this is not xml at all <<<", FEED).length === 0);
check("empty input returns empty", parseRss("", FEED).length === 0);
check("newsItemKey is sha256 of link, stable per link", newsItemKey("https://example.com/a") === newsItemKey("https://example.com/a") && newsItemKey("https://example.com/a") !== newsItemKey("https://example.com/b"));

// ---------- Start + chặn trùng ----------
const run = startFbPostRun(db, { targetUrl: TARGET });
check(
  "start creates auto run with defaults",
  run.mode === "auto" && run.status === "running" && run.maxPosts === 1 && run.digestSize === 5 && run.maxRunMinutes === 60,
  run,
);
let badUrl = false;
try {
  startFbPostRun(db, { targetUrl: "not-a-url" });
} catch {
  badUrl = true;
}
check("invalid targetUrl is rejected", badUrl);
let badMode = false;
try {
  startFbPostRun(db, { targetUrl: TARGET, mode: "draft" as never });
} catch {
  badMode = true;
}
check("non-auto mode is rejected", badMode);
let duplicateBlocked = false;
try {
  startFbPostRun(db, { targetUrl: TARGET });
} catch {
  duplicateBlocked = true;
}
check("second running run on same target is blocked", duplicateBlocked);

// ---------- Record idempotent ----------
const mkItem = (n: number) => ({
  title: `Tin ${n}`,
  link: `https://example.com/news-${n}`,
  source: "vnexpress.net",
  pubDateMs: null as number | null,
  excerpt: `Mô tả ${n}`,
});
const items7 = [1, 2, 3, 4, 5, 6, 7].map(mkItem);
const r1 = recordFbPostItems(db, run.id, items7);
const r2 = recordFbPostItems(db, run.id, items7);
check("record 7 items then re-record adds none", r1.recorded === 7 && r2.recorded === 0 && r2.total === 7, { r1, r2 });
const itemsInRowidOrder = getFbPostItems(db, run.id).map((i) => i.title);
check("items listed in insertion (rowid) order", JSON.stringify(itemsInRowidOrder) === JSON.stringify(["Tin 1", "Tin 2", "Tin 3", "Tin 4", "Tin 5", "Tin 6", "Tin 7"]), itemsInRowidOrder);

// ---------- Digest invariants ----------
const next1: any = nextFbPostDigest(db, run.id);
check("next returns a digest of digestSize items", next1.ok === true && next1.digest.items.length === 5, next1.ok);
const digestText: string = next1.digest.digestText;
const picked = next1.digest.items;
const allTitlesLinksPresent = picked.every((it: any) => digestText.includes(it.title) && digestText.includes(it.link));
check("digest contains every picked title and link", allTitlesLinksPresent);
check("digest has no duplicate items", new Set(picked.map((it: any) => it.itemKey)).size === 5);
check("digest leaves later items out", !digestText.includes("Tin 6") && !digestText.includes("Tin 7"));
check("digest has Vietnamese date heading and source attribution", digestText.startsWith("📰 Tin mới trong ngày — ") && digestText.includes("Nguồn: vnexpress.net"), digestText.split("\n")[0]);
const digestKeys = picked.map((it: any) => it.itemKey);

// ---------- Mark posted: idempotent theo bài, đủ maxPosts thì done ----------
markFbPostPosted(db, run.id, digestKeys);
markFbPostPosted(db, run.id, digestKeys);
check("mark_posted twice still counts one digest", getPostedDigestCount(db, run.id) === 1, getPostedDigestCount(db, run.id));
const statusAfterPost = getFbPostStatus(db, run.id);
check("posted items counted, run done at maxPosts=1", statusAfterPost.counts.posted === 5 && statusAfterPost.run.status === "done", statusAfterPost);
const nextAfterDone: any = nextFbPostDigest(db, run.id);
check("next after done returns ok:false", nextAfterDone.ok === false);

// ---------- Failed (blocked) + skipped, trên phiên mới ----------
const run2 = startFbPostRun(db, { targetUrl: TARGET + "/2", maxPosts: 2, digestSize: 2 });
recordFbPostItems(db, run2.id, [mkItem(11), mkItem(12), mkItem(13)]);
const next2: any = nextFbPostDigest(db, run2.id);
check("second run digest picks first 2 pending", next2.ok === true && next2.digest.items.length === 2);
const keys2 = next2.digest.items.map((it: any) => it.itemKey);
markFbPostSkipped(db, run2.id, [keys2[0]], "tin không phù hợp");
const status2 = getFbPostStatus(db, run2.id);
check("mark_skipped counts", status2.counts.skipped === 1, status2.counts);
markFbPostFailed(db, run2.id, [keys2[1]], "Facebook tạm thời bị chặn đăng", true);
const status2b = getFbPostStatus(db, run2.id);
check("mark_failed with blocked=true blocks the run", status2b.counts.failed === 1 && status2b.run.status === "blocked", status2b);
const nextBlocked: any = nextFbPostDigest(db, run2.id);
check("next on blocked run returns ok:false", nextBlocked.ok === false);

// ---------- Pause / resume / stop ----------
const run3 = startFbPostRun(db, { targetUrl: TARGET + "/3", maxPosts: 2, digestSize: 2 });
recordFbPostItems(db, run3.id, [mkItem(21), mkItem(22), mkItem(23), mkItem(24)]);
pauseFbPostRun(db, run3.id);
const nextPaused: any = nextFbPostDigest(db, run3.id);
check("next on paused run returns ok:false", nextPaused.ok === false);
resumeFbPostRun(db, run3.id);
const next3: any = nextFbPostDigest(db, run3.id);
check("next works again after resume", next3.ok === true && next3.digest.items.length === 2);
const keys3 = next3.digest.items.map((it: any) => it.itemKey);
markFbPostPosted(db, run3.id, keys3);
const nextGap: any = nextFbPostDigest(db, run3.id);
check("next right after a post is rate-limited", nextGap.ok === false && /chờ thêm/.test(nextGap.reason), nextGap.reason);
stopFbPostRun(db, run3.id, "dừng tay");
const nextStopped: any = nextFbPostDigest(db, run3.id);
check("next on stopped run returns ok:false", nextStopped.ok === false);
let pauseStopped = false;
try {
  pauseFbPostRun(db, run3.id);
} catch {
  pauseStopped = true;
}
check("pause on stopped run throws", pauseStopped);

// ---------- Hết thời gian phiên ----------
const run4 = startFbPostRun(db, { targetUrl: TARGET + "/4" });
recordFbPostItems(db, run4.id, [mkItem(31)]);
db.run("UPDATE fb_post_runs SET created_at = ? WHERE id = ?", [Date.now() - 2 * 60 * 60 * 1000, run4.id]);
const nextExpired: any = nextFbPostDigest(db, run4.id);
const status4 = getFbPostStatus(db, run4.id);
check("expired run is blocked and next fails", nextExpired.ok === false && status4.run.status === "blocked", status4.run.status);

// ---------- Next khi không còn tin pending ----------
const run5 = startFbPostRun(db, { targetUrl: TARGET + "/5" });
const nextEmpty: any = nextFbPostDigest(db, run5.id);
check("next with no pending items returns ok:false", nextEmpty.ok === false && /Không còn tin pending/.test(nextEmpty.reason), nextEmpty.reason);
finishFbPostRun(db, run5.id);
check("finish sets done", getFbPostStatus(db, run5.id).run.status === "done");

// ---------- Cùng link ở phiên khác vẫn được ----------
const run6 = startFbPostRun(db, { targetUrl: TARGET + "/6" });
const r6 = recordFbPostItems(db, run6.id, [mkItem(1)]);
check("same link in a different run is allowed", r6.recorded === 1 && r6.total === 1, r6);

// ---------- Compose trực tiếp ----------
const direct = composeDigestPost(getFbPostItems(db, run6.id), new Date("2026-10-31T08:00:00+07:00"));
check("composeDigestPost uses Asia/Ho_Chi_Minh date", direct.includes("31/10/2026"), direct.split("\n")[0]);

// ---------- Persistence ----------
const db2: any = initDatabase(dbPath);
const persisted = getFbPostStatus(db2, run.id);
check("reopened DB still has run and items", persisted.run.id === run.id && persisted.counts.posted === 5, persisted.counts);

console.log(failures === 0 ? "\nAll fb-post checks passed." : `\n${failures} fb-post check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
