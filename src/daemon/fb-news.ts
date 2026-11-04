/**
 * FB Auto Post — lấy tin mới từ RSS (daemon).
 *
 * Không thêm dependency: dùng fetch có sẵn của Bun (kèm timeout) và
 * parse RSS bằng regex. Chỉ lấy tiêu đề + link + ngày phát hành từ feed,
 * KHÔNG tự bịa thêm nội dung — bài đăng chỉ gồm đúng những gì feed đưa.
 *
 * Feed mặc định đã kiểm chứng live ngày 2026-10-31 (xem doc
 * docs/plans/2026-10-31-fb-auto-post.md):
 * - VnExpress: https://vnexpress.net/rss/tin-moi-nhat.rss (HTTP 200, 45 item)
 * - Tuổi Trẻ: https://tuoitre.vn/rss/tin-moi-nhat.rss trả 301 về
 *   https://tuoitre.vn/home.rss (HTTP 200, 50 item) nên mặc định dùng
 *   luôn URL đích home.rss để khỏi phụ thuộc redirect.
 * Feed có thể override theo từng phiên qua tool fb_post_start/fetch_news.
 */

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDateMs: number | null;
  excerpt: string;
}

export interface FeedResult {
  url: string;
  ok: boolean;
  count: number;
  error?: string;
}

export interface FeedFetchResult {
  items: NewsItem[];
  feeds: FeedResult[];
}

export interface DefaultFeed {
  name: string;
  url: string;
}

export const DEFAULT_FEEDS: DefaultFeed[] = [
  { name: "VnExpress", url: "https://vnexpress.net/rss/tin-moi-nhat.rss" },
  { name: "TuoiTre", url: "https://tuoitre.vn/home.rss" },
];

export const FB_NEWS_LIMITS = {
  /** Timeout mỗi feed (ms). */
  fetchTimeoutMs: 15_000,
  /** Số item tối đa lấy từ một feed (feed đã sắp mới nhất trước). */
  maxItemsPerFeed: 30,
} as const;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      try {
        return String.fromCodePoint(parseInt(dec, 10));
      } catch {
        return "";
      }
    })
    .replace(/&amp;/g, "&");
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function cleanText(value: string, max = 300): string {
  const clean = decodeEntities(unwrapCdata(value)).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function tagContent(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1]!.trim() : null;
}

/**
 * Parse RSS bằng regex. Chịu được feed hỏng từng phần: item thiếu
 * title hoặc link thì bỏ qua item đó, XML rác thì trả về mảng rỗng,
 * KHÔNG bao giờ throw vì một feed hỏng (phiên chạy không được crash).
 */
export function parseRss(xml: string, feedUrl: string): NewsItem[] {
  if (!xml || typeof xml !== "string") return [];
  const items: NewsItem[] = [];
  const source = hostnameOf(feedUrl);
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  for (const block of blocks) {
    const rawTitle = tagContent(block, "title");
    const rawLink = tagContent(block, "link");
    const rawDate = tagContent(block, "pubDate");
    const rawDesc = tagContent(block, "description");
    if (!rawTitle || !rawLink) continue;
    const title = cleanText(rawTitle, 500);
    const link = decodeEntities(unwrapCdata(rawLink)).trim();
    if (!title || !link || !/^https?:\/\//.test(link)) continue;
    let pubDateMs: number | null = null;
    if (rawDate) {
      const parsed = Date.parse(decodeEntities(unwrapCdata(rawDate)).trim());
      if (Number.isFinite(parsed)) pubDateMs = parsed;
    }
    items.push({
      title,
      link,
      source,
      pubDateMs,
      excerpt: rawDesc ? cleanText(stripHtml(unwrapCdata(rawDesc))) : "",
    });
    if (items.length >= FB_NEWS_LIMITS.maxItemsPerFeed) break;
  }
  return items;
}

export async function fetchFeed(feedUrl: string, timeoutMs = FB_NEWS_LIMITS.fetchTimeoutMs): Promise<NewsItem[]> {
  const res = await fetch(feedUrl, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 (Otter FB Auto Post RSS reader)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Feed trả HTTP ${res.status}`);
  const xml = await res.text();
  return parseRss(xml, feedUrl);
}

/**
 * Lấy tin từ nhiều feed. Mỗi feed hỏng chỉ ghi vào kết quả của feed đó,
 * không làm hỏng cả lần fetch. Không throw vì lỗi feed.
 */
export async function fetchFeeds(feedUrls: string[]): Promise<FeedFetchResult> {
  const items: NewsItem[] = [];
  const feeds: FeedResult[] = [];
  for (const url of feedUrls) {
    try {
      const found = await fetchFeed(url);
      items.push(...found);
      feeds.push({ url, ok: true, count: found.length });
    } catch (e: any) {
      feeds.push({ url, ok: false, count: 0, error: e?.message ?? String(e) });
    }
  }
  return { items, feeds };
}
