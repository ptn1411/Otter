/**
 * Interactive Live PTY Terminal Panel for ChatGPT Web
 * Floating terminal emulator displaying real-time command output and sending keystrokes to PTY
 */

import type { TerminalInfo, TerminalEvent } from "../../types";
import { AnsiStreamParser } from "./ansi-parser";
import { t, onLanguageChange } from "../../i18n";

export class TerminalPanel {
  private container: HTMLElement;
  private preOutput: HTMLPreElement;
  private inputField: HTMLInputElement;
  private statusBadge: HTMLElement;
  private isOpen: boolean = false;
  private currentSessionId: string | null = null;
  private currentSequence: number = 0;
  private pollingActive: boolean = false;
  private ansiParser: AnsiStreamParser = new AnsiStreamParser();

  constructor(private conversationId: string) {
    this.container = document.createElement("div");
    this.container.id = "otter-terminal-panel";
    this.container.className = "chatmcp-terminal-panel";
    this.container.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 680px;
      height: 440px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
      display: none;
      flex-direction: column;
      z-index: 999999;
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      overflow: hidden;
      backdrop-filter: blur(12px);
    `;

    // 1. Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      user-select: none;
      cursor: move;
    `;

    const titleArea = document.createElement("div");
    titleArea.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    this.statusBadge = document.createElement("span");
    this.statusBadge.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #238636;
      box-shadow: 0 0 6px #238636;
    `;

    const title = document.createElement("strong");
    title.textContent = t("term_title");
    title.style.cssText = "font-size: 13px; color: #e6edf3;";

    titleArea.appendChild(this.statusBadge);
    titleArea.appendChild(title);

    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; gap: 8px;";

    const copyBtn = document.createElement("button");
    copyBtn.textContent = t("term_copy");
    copyBtn.style.cssText = `
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
    `;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(this.preOutput.innerText || "");
      copyBtn.textContent = t("term_copied");
      setTimeout(() => (copyBtn.textContent = t("term_copy")), 1500);
    };

    const clearBtn = document.createElement("button");
    clearBtn.textContent = t("term_clear");
    clearBtn.style.cssText = `
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
    `;
    clearBtn.onclick = () => {
      this.clearOutput();
    };

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #8b949e;
      font-size: 14px;
      cursor: pointer;
      padding: 2px 6px;
    `;
    closeBtn.onclick = () => this.hide();

    actions.appendChild(copyBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(closeBtn);
    header.appendChild(titleArea);
    header.appendChild(actions);

    // 2. Output
    this.preOutput = document.createElement("pre");
    this.preOutput.style.cssText = `
      flex: 1;
      margin: 0;
      padding: 12px;
      overflow-y: auto;
      color: #e6edf3;
      font-size: 12px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-all;
    `;
    this.appendOutput(`\x1b[90m${t("term_connected")}\x1b[0m`);

    // 3. Input bar
    const inputArea = document.createElement("div");
    inputArea.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: #161b22;
      border-top: 1px solid #30363d;
    `;

    const promptLabel = document.createElement("span");
    promptLabel.textContent = "$";
    promptLabel.style.color = "#7ee787";
    promptLabel.style.fontWeight = "bold";

    this.inputField = document.createElement("input");
    this.inputField.type = "text";
    this.inputField.placeholder = t("term_placeholder");

    onLanguageChange(() => {
      title.textContent = t("term_title");
      copyBtn.textContent = t("term_copy");
      clearBtn.textContent = t("term_clear");
      this.inputField.placeholder = t("term_placeholder");
    });
    this.inputField.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      color: #e6edf3;
      font-family: inherit;
      font-size: 12px;
      outline: none;
    `;

    this.inputField.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const text = this.inputField.value;
        this.inputField.value = "";
        await this.sendInput(text + "\r\n");
      }
    });

    inputArea.appendChild(promptLabel);
    inputArea.appendChild(this.inputField);

    this.container.appendChild(header);
    this.container.appendChild(this.preOutput);
    this.container.appendChild(inputArea);

    document.body.appendChild(this.container);
    this.setupDraggable(header);
  }

  private setupDraggable(header: HTMLElement) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialX = 0, initialY = 0;

    header.onmousedown = (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.container.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      const onMouseMove = (ev: MouseEvent) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        this.container.style.left = `${initialX + dx}px`;
        this.container.style.top = `${initialY + dy}px`;
        this.container.style.right = "auto";
        this.container.style.bottom = "auto";
      };

      const onMouseUp = () => {
        isDragging = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };
  }

  show() {
    this.isOpen = true;
    this.container.style.display = "flex";
    this.inputField.focus();
    this.loadTerminals();
  }

  hide() {
    this.isOpen = false;
    this.container.style.display = "none";
    this.pollingActive = false;
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  clearOutput() {
    this.preOutput.replaceChildren();
    this.ansiParser.reset();
  }

  appendOutput(text: string) {
    const html = this.ansiParser.toHtml(text);
    if (!html) return;

    const template = document.createElement("template");
    template.innerHTML = html;
    this.preOutput.appendChild(template.content);
    this.preOutput.scrollTop = this.preOutput.scrollHeight;
  }

  private async loadTerminals() {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "terminal-list",
        conversationId: this.conversationId
      });

      if (res?.ok && Array.isArray(res.terminals) && res.terminals.length > 0) {
        this.currentSessionId = res.terminals[0].id;
        this.startLivePolling();
      }
    } catch (err) {
      console.error("[Otter Terminal] Failed to load terminals:", err);
    }
  }

  private async startLivePolling() {
    if (this.pollingActive || !this.currentSessionId) return;
    this.pollingActive = true;

    while (this.isOpen && this.pollingActive && this.currentSessionId) {
      try {
        const res = await chrome.runtime.sendMessage({
          type: "terminal-output",
          conversationId: this.conversationId,
          sessionId: this.currentSessionId,
          afterSequence: this.currentSequence,
          waitMs: 5000
        });

        if (res?.ok && res.result?.events) {
          for (const ev of res.result.events as TerminalEvent[]) {
            if (ev.sequence > this.currentSequence) {
              this.currentSequence = ev.sequence;
              this.appendOutput(ev.data);
            }
          }
        }
      } catch {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    this.pollingActive = false;
  }

  private async sendInput(text: string) {
    if (!this.currentSessionId) return;
    try {
      await chrome.runtime.sendMessage({
        type: "terminal-input",
        conversationId: this.conversationId,
        sessionId: this.currentSessionId,
        text
      });
    } catch (err) {
      console.error("[Otter Terminal] Input error:", err);
    }
  }
}
