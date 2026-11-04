/**
 * Otter Export Markdown — export the current ChatGPT conversation to a
 * Markdown document. DOM extraction reuses the selector strategy already
 * verified in chatgpt-turn-reader.ts: conversation-turn containers first,
 * then [data-message-author-role], then article as a last fallback;
 * prose via .markdown / [data-message-content] / .whitespace-pre-wrap.
 * Pure exportTurnsToMarkdown() is bun-testable without a browser.
 */
import { t, formatDate } from "../i18n";

export interface ChatTurn {
  role: string;
  content: string;
  timestamp?: string;
}

export function exportTurnsToMarkdown(turns: ChatTurn[], title = t("export_doc_title")): string {
  const dateStr = formatDate(new Date());
  const lines: string[] = [];

  lines.push(`# ${title}`);
  lines.push(`> *${t("export_exported_at")}:* ${dateStr} | *${t("export_total_turns")}:* ${turns.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const turn of turns) {
    const isUser = turn.role.toLowerCase() === "user";
    const header = isUser ? "### 👤 User" : "### 🤖 Assistant";
    lines.push(header);
    lines.push("");
    lines.push(turn.content.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  lines.push("*(Được xuất bản tự động bởi Otter — Agentic AI Suite)*");
  return lines.join("\n");
}

const PROSE_SELECTORS = [".markdown", '[data-message-content="true"]', ".whitespace-pre-wrap"];

function turnText(el: Element): string {
  for (const sel of PROSE_SELECTORS) {
    try {
      const found = el.querySelector(sel);
      const text = (found as HTMLElement | null)?.innerText || found?.textContent || "";
      if (text.trim()) return text.trim();
    } catch {}
  }
  return ((el as HTMLElement).innerText || el.textContent || "").trim();
}

function turnRole(el: Element): string {
  const own = el.getAttribute?.("data-message-author-role");
  if (own) return own;
  const inner = el.querySelector?.("[data-message-author-role]");
  return inner?.getAttribute?.("data-message-author-role") || "assistant";
}

export function extractChatTurnsFromDOM(root: Document | Element = document): ChatTurn[] {
  if (typeof document === "undefined" && !root) return [];
  const turns: ChatTurn[] = [];

  // Ordered fallbacks, same strategy as chatgpt-turn-reader.ts.
  const containerSelectors = [
    '[data-testid="conversation-turn"]',
    "[data-message-author-role]",
    "article",
  ];
  let nodes: Element[] = [];
  for (const sel of containerSelectors) {
    try {
      nodes = Array.from((root as any).querySelectorAll?.(sel) || []);
    } catch {
      nodes = [];
    }
    if (nodes.length > 0) break;
  }

  if (nodes.length === 0) {
    // New ChatGPT layout fallback: role h4 headers
    const h4s = Array.from((root as any).querySelectorAll?.("h4") || []).filter((h: any) => {
      const text = h.innerText || h.textContent || "";
      return (
        text.includes("Bạn đã nói") ||
        text.includes("ChatGPT đã nói") ||
        text.includes("You said") ||
        text.includes("ChatGPT said")
      );
    });
    for (const h4 of h4s as any[]) {
      const isUser = (h4.textContent || "").includes("Bạn đã nói") || (h4.textContent || "").includes("You said");
      const role = isUser ? "user" : "assistant";
      const container = h4.parentElement;
      if (container) {
        const clone = container.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("h4, button").forEach((el) => el.remove());
        const content = clone.innerText?.trim() || "";
        if (content) {
          turns.push({ role, content });
        }
      }
    }
    return turns;
  }

  for (const node of nodes) {
    const content = turnText(node);
    if (!content) continue;
    turns.push({ role: turnRole(node), content });
  }

  return turns;
}

export function exportCurrentChatToMarkdown(): { title: string; markdown: string } {
  if (typeof document === "undefined") {
    return { title: t("export_doc_title"), markdown: exportTurnsToMarkdown([], t("export_doc_title")) };
  }
  const title = document.title.replace(/\s*-\s*ChatGPT.*$/i, "").trim() || t("export_doc_title");
  const turns = extractChatTurnsFromDOM(document);
  const markdown = exportTurnsToMarkdown(turns, title);
  return { title, markdown };
}

export function sanitizeMarkdownFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned || "otter-chat";
}

export function downloadMarkdownFile(filename: string, content: string): void {
  const safe = sanitizeMarkdownFilename(filename);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safe.endsWith(".md") ? safe : `${safe}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function showExportToast(message?: string): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById("otter-export-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "otter-export-toast";
  toast.textContent = message || t("export_success");
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #10b981; color: #fff; padding: 10px 16px; border-radius: 8px;
    font-size: 13px; font-weight: 600; z-index: 100002;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4); font-family: system-ui, sans-serif;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
