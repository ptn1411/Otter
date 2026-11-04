/**
 * Page-loop watcher — trang chỉ cảm biến + báo cáo, daemon quyết định.
 * Dùng MutationObserver + polling 500ms (giống injector). Watcher chỉ
 * chạy khi daemon gửi page_loop_start cho đúng tab này, và dừng ngay
 * khi nhận page_loop_stop hoặc user bấm Dừng.
 */
import {
  readLastAssistantTurn,
  isGeneratingIn,
  classifyWatcherState,
  type AssistantTurn,
} from "./chatgpt-turn-reader";

export interface WatcherCallbacks {
  onSettledTurn: (turn: AssistantTurn) => void;
  onUnreadable: (reason: string) => void;
  onUserTyping: () => void;
}

export class ChatGPTTurnWatcher {
  private observer: MutationObserver | null = null;
  private timer: any = null;
  private seenTurnIds = new Set<string>();
  private seenHashes = new Set<string>();
  private lastDomChangeAt = Date.now();
  private generationEndedAt: number | null = null;
  private lastGenerating = false;
  private lastUserTypingAt = 0;
  private reportedForCurrentTurn = false;
  private stopped = false;

  constructor(
    private loopId: string,
    private callbacks: WatcherCallbacks,
  ) {}

  get userTypingRecently(): boolean {
    return Date.now() - this.lastUserTypingAt < 10_000;
  }

  start(): void {
    this.stopped = false;
    // User typing: hoãn gửi, không xóa chữ của user (plan §8).
    const markTyping = () => {
      this.lastUserTypingAt = Date.now();
      this.callbacks.onUserTyping();
    };
    document.addEventListener("keydown", markTyping, true);
    (this as any)._markTyping = markTyping;

    this.observer = new MutationObserver(() => {
      this.lastDomChangeAt = Date.now();
    });
    const convo = document.querySelector("main") || document.body;
    if (convo) this.observer.observe(convo, { childList: true, subtree: true, characterData: true });

    this.timer = setInterval(() => this.tick(), 500);
  }

  stop(): void {
    this.stopped = true;
    if (this.observer) { this.observer.disconnect(); this.observer = null; }
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if ((this as any)._markTyping) document.removeEventListener("keydown", (this as any)._markTyping, true);
  }

  private tick(): void {
    if (this.stopped) return;
    const now = Date.now();
    const generating = isGeneratingIn(document);
    if (this.lastGenerating && !generating) this.generationEndedAt = now;
    if (generating) this.reportedForCurrentTurn = false;
    this.lastGenerating = generating;

    const state = classifyWatcherState(
      { generating, generationEndedAt: this.generationEndedAt, lastDomChangeAt: this.lastDomChangeAt, mcpActivityAt: null },
      now,
    );
    // Daemon kiểm tra thêm MCP activity 5s trước khi quyết định (xem
    // page-loop.ts recordTurn) — watcher ở đây chỉ báo candidate settled.
    if (state !== "settled" || this.reportedForCurrentTurn) return;
    if (this.userTypingRecently) return; // chờ user idle, không gửi khi user đang gõ
    this.reportedForCurrentTurn = true;
    const { turn, reason } = readLastAssistantTurn(document, this.seenTurnIds, this.seenHashes);
    if (!turn) {
      this.callbacks.onUnreadable(reason);
      return;
    }
    if (turn.turnId) this.seenTurnIds.add(turn.turnId);
    this.seenHashes.add(turn.textHash);
    this.callbacks.onSettledTurn(turn);
  }
}
