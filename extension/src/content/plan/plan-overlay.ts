/**
 * Agent Plan & Question Overlay Dialog
 * Shadow DOM floating modal presenting Agent steps, questions, and audio alerts
 */

import type { PlanQuestion } from "../../types";
import { t } from "../../i18n";

export class PlanOverlay {
  private host: HTMLElement;
  private shadow: ShadowRoot;

  constructor() {
    this.host = document.createElement("div");
    this.host.id = "otter-plan-overlay";
    this.shadow = this.host.attachShadow({ mode: "closed" });

    document.body.appendChild(this.host);
  }

  showQuestion(plan: PlanQuestion, onSelect: (choice: string) => void) {

    this.shadow.innerHTML = `
      <style>
        .overlay {
          position: fixed;
          top: 80px;
          right: 32px;
          width: 360px;
          background: #1c2128;
          border: 1px solid #388bfd;
          border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
          padding: 16px;
          z-index: 1000000;
          font-family: system-ui, sans-serif;
          color: #f0f6fc;
          animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          color: #58a6ff;
          font-weight: 600;
          font-size: 13px;
        }
        .question {
          font-size: 14px;
          margin-bottom: 14px;
          line-height: 1.5;
        }
        .options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .btn {
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 12px;
          color: #c9d1d9;
          font-size: 12px;
          cursor: pointer;
          text-align: left;
          transition: all 0.2s;
        }
        .btn:hover {
          background: #30363d;
          border-color: #58a6ff;
          color: #fff;
        }
        .dismiss {
          position: absolute;
          top: 10px;
          right: 10px;
          background: none;
          border: none;
          color: #8b949e;
          cursor: pointer;
          font-size: 14px;
        }
      </style>
      <div class="overlay">
        <button class="dismiss" id="dismiss-btn">✕</button>
        <div class="header">
          <span>${t("plan_title")}</span>
        </div>
        <div class="question">${plan.question}</div>
        <div class="options" id="options-container"></div>
      </div>
    `;

    const optContainer = this.shadow.getElementById("options-container")!;
    const dismissBtn = this.shadow.getElementById("dismiss-btn")!;

    dismissBtn.onclick = () => this.hide();

    const options = plan.options || [t("plan_continue"), t("plan_cancel")];
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.className = "btn";
      btn.textContent = opt;
      btn.onclick = () => {
        onSelect(opt);
        this.hide();
      };
      optContainer.appendChild(btn);
    }
  }

  hide() {
    this.shadow.innerHTML = "";
  }
}
