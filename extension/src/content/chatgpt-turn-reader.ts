/**
 * ChatGPT turn reader — Phase 0/1 của plan nâng cấp từ codex-web.
 *
 * QUAN TRỌNG: các selector dưới đây là FALLBACK THEO THỨ TỰ, dựa trên
 * plan page-loop cũ (data-message-author-role, .markdown) và hợp đồng
 * DOM theo component của codex-web. CHƯA được xác minh trên trang
 * ChatGPT thật có đăng nhập trong lần code này (VM không có Chrome,
 * không có tab ChatGPT thật). Khi chạy Phase 0 trên trang thật, ghi
 * selector nào match vào docs/plans/2026-10-31-chatgpt-page-loop-dom-notes.md
 * và sửa danh sách này — logic quyết định ở daemon KHÔNG đổi theo selector.
 *
 * Nguyên tắc (lấy từ codex-web):
 * - Gắn lượt bằng data-turn-id logic, KHÔNG dùng chỉ số hiển thị
 *   conversation-turn-N (chỉ số đổi khi render lại).
 * - Lượt remount lại (ID cũ xuất hiện lại) không phải lượt mới.
 * - Không đọc được chắc chắn thì trả unreadable/ambiguous, KHÔNG đoán.
 * - Diagnostic chỉ đếm variant, không copy nội dung/label/ID tài khoản.
 */

export interface UiVariant {
  component: string;
  matched: number;
  total: number;
}

export interface AssistantTurn {
  turnId: string | null;
  /** "prose" = văn bản trả lời ổn định; "reasoning" = chỉ còn thinking; "mixed" = cả hai. */
  kind: "prose" | "reasoning" | "mixed";
  text: string;
  textHash: string;
  excerpt: string;
  selectorUsed: string;
  uiVariants: UiVariant[];
}

/** Hash không mật mã, chỉ để dedupe lượt (không dùng cho token/bảo mật). */
export function hashTurnText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return `turn_${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
}

export function excerptOf(text: string): string {
  return text.trim().slice(0, 500);
}

export function isDoneMarker(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && (lines[lines.length - 1] === "OTTER-DONE" || lines[lines.length - 1].endsWith("OTTER-DONE"));
}

export function isCheckpointMarker(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && (lines[lines.length - 1] === "OTTER-CHECKPOINT" || lines[lines.length - 1].endsWith("OTTER-CHECKPOINT"));
}

/** Thứ tự selector cho lượt assistant — đã xác minh trên ChatGPT thật (2026-10-31). */
export const TURN_SELECTORS = [
  '[data-chatgpt-search-unit-key*="assistant"] > div:not([data-conversation-role])',
  '[data-content-search-unit-key*="assistant"] > div:not([data-conversation-role])',
  '[data-conversation-role="assistant"] ~ div',
  '[data-message-author-role="assistant"]',
  'article[data-message-author-role="assistant"]',
  '[data-testid="conversation-turn"] [data-message-author-role="assistant"]',
  "article",
];

export const PROSE_SELECTORS = [".markdown", '[data-message-content="true"]', ".prose"];
export const REASONING_SELECTORS = ['[data-testid*="reasoning"]', '[class*="reasoning"]', '[class*="thinking"]'];
export const STOP_SELECTORS = [
  'button[aria-label*="Dừng"]',
  'button[aria-label*="dừng"]',
  'button[aria-label*="Stop"]',
  'button[data-testid="stop-button"]',
  '[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
];

export interface TurnCandidate {
  turnId: string | null;
  text: string;
  kind: "prose" | "reasoning" | "mixed";
  selectorUsed: string;
}

type El = { getAttribute?: (n: string) => string | null; textContent?: string | null; querySelector?: (s: string) => any; querySelectorAll?: (s: string) => any };

function elText(el: any): string {
  return (el?.innerText || el?.textContent || "").trim();
}

function pickText(el: any, selectors: string[]): string {
  for (const sel of selectors) {
    try {
      const found = el?.querySelector?.(sel);
      const t = found ? elText(found) : "";
      if (t) return t;
    } catch {}
  }
  return "";
}

/**
 * Pure-ish: nhận danh sách candidate đã trích từ DOM (để test không cần
 * trình duyệt) và trả lượt cuối chưa từng thấy. Daemon/extension dùng
 * readLastAssistantTurn() ở dưới cho DOM thật.
 */
export function selectLastUnseenTurn(
  candidates: TurnCandidate[],
  seenTurnIds: Set<string>,
  seenHashes: Set<string>,
): { turn: TurnCandidate | null; reason: "ok" | "no_new_turn" | "ambiguous_no_id" } {
  const unseen = candidates.filter((c) => {
    if (c.turnId && seenTurnIds.has(c.turnId)) return false;
    if (!c.turnId && seenHashes.has(hashTurnText(c.text))) return false;
    return true;
  });
  if (unseen.length === 0) return { turn: null, reason: "no_new_turn" };
  const last = unseen[unseen.length - 1];
  // Không có turnId mà có nhiều hơn 1 candidate chưa thấy và text khác nhau
  // thì không chắc đâu là lượt cuối -> ambiguous, không đoán.
  if (!last.turnId && unseen.length > 1) {
    const distinct = new Set(unseen.map((c) => hashTurnText(c.text)));
    if (distinct.size > 1) return { turn: null, reason: "ambiguous_no_id" };
  }
  return { turn: last, reason: "ok" };
}

export function readLastAssistantTurn(
  root: Document | Element,
  seenTurnIds: Set<string>,
  seenHashes: Set<string>,
): { turn: AssistantTurn | null; reason: "ok" | "no_new_turn" | "ambiguous_no_id" | "unreadable"; uiVariants: UiVariant[] } {
  const uiVariants: UiVariant[] = [];
  let candidates: TurnCandidate[] = [];
  let selectorUsed = "";
  for (const sel of TURN_SELECTORS) {
    try {
      const nodes = Array.from((root as any).querySelectorAll?.(sel) || []);
      uiVariants.push({ component: `turn:${sel}`, matched: nodes.length, total: nodes.length });
      if (nodes.length === 0) continue;
      selectorUsed = sel;
      candidates = nodes.map((node: any) => {
        const prose = pickText(node, PROSE_SELECTORS);
        const reasoning = pickText(node, REASONING_SELECTORS);
        const full = prose || elText(node);
        const kind: TurnCandidate["kind"] = prose && reasoning ? "mixed" : prose ? "prose" : "reasoning";
        return {
          turnId: node.getAttribute?.("data-turn-id") ||
            node.closest?.("[data-turn-id]")?.getAttribute?.("data-turn-id") ||
            node.closest?.("[data-chatgpt-search-message-ids]")?.getAttribute?.("data-chatgpt-search-message-ids")?.split(" ")[0] ||
            node.closest?.("[data-turn-key]")?.getAttribute?.("data-turn-key") ||
            null,
          text: full,
          kind,
          selectorUsed: sel,
        };
      }).filter((c: TurnCandidate) => c.text.length > 0);
      if (candidates.length > 0) break;
    } catch {}
  }
  if (candidates.length === 0) return { turn: null, reason: "unreadable", uiVariants };
  const picked = selectLastUnseenTurn(candidates, seenTurnIds, seenHashes);
  if (!picked.turn) return { turn: null, reason: picked.reason, uiVariants };
  const t = picked.turn;
  return {
    turn: {
      turnId: t.turnId,
      kind: t.kind,
      text: t.text,
      textHash: hashTurnText(t.text),
      excerpt: excerptOf(t.text),
      selectorUsed: t.selectorUsed,
      uiVariants: uiVariants.slice(0, 40),
    },
    reason: "ok",
    uiVariants: uiVariants.slice(0, 40),
  };
}

export function isGeneratingIn(root: Document | Element): boolean {
  for (const sel of STOP_SELECTORS) {
    try {
      const el = (root as any).querySelector?.(sel) as HTMLElement | null;
      if (el && (el.offsetWidth || el.offsetHeight)) return true;
    } catch {}
  }
  try {
    if ((root as any).querySelector?.(".result-streaming")) return true;
  } catch {}
  return false;
}

export function countUiVariants(root: Document | Element): UiVariant[] {
  const out: UiVariant[] = [];
  for (const sel of [...TURN_SELECTORS, ...PROSE_SELECTORS, ...STOP_SELECTORS]) {
    try {
      const n = (root as any).querySelectorAll?.(sel)?.length || 0;
      out.push({ component: sel, matched: n, total: n });
    } catch {}
  }
  return out.slice(0, 40);
}

// ---------------------------------------------------------------------------
// Settle — thuần, test được không cần trình duyệt (plan §5.2)
// ---------------------------------------------------------------------------

export interface SettleSignals {
  generating: boolean;
  /** thời điểm (ms) generate dừng lần cuối, null = chưa từng generate */
  generationEndedAt: number | null;
  /** thời điểm (ms) DOM thay đổi lần cuối trong vùng hội thoại */
  lastDomChangeAt: number;
  /** thời điểm (ms) có MCP activity lần cuối, null = không có (daemon kiểm tra thêm) */
  mcpActivityAt: number | null;
}

export type WatcherState = "generating" | "tool_paused" | "settled" | "waiting";

/**
 * - generating: đang generate.
 * - tool_paused: hết generate nhưng MCP activity trong 5s gần nhất
 *   (ChatGPT có thể đang chờ tool) -> KHÔNG tính là settled, không nudge.
 * - settled: hết generate liên tục 5s + DOM yên 2s cuối + không MCP
 *   activity 5s.
 * - waiting: chưa đủ dữ liệu (chưa từng generate trong phiên này).
 */
export function classifyWatcherState(signals: SettleSignals, now: number): WatcherState {
  if (signals.generating) return "generating";
  if (signals.generationEndedAt === null) return "waiting";
  if (signals.mcpActivityAt !== null && now - signals.mcpActivityAt < 5000) return "tool_paused";
  if (now - signals.generationEndedAt >= 5000 && now - signals.lastDomChangeAt >= 2000) return "settled";
  return "waiting";
}

export function shouldSettle(signals: SettleSignals, now: number): boolean {
  return classifyWatcherState(signals, now) === "settled";
}
