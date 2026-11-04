/**
 * ChatGPT Web Prompt Injector
 * 
 * Tự động chèn văn bản báo cáo vào ô nhập prompt của ChatGPT và bấm gửi.
 * Dựa trên cơ chế Clipboard DataTransfer từ HiveMind nhằm tương thích ProseMirror.
 */

const PROMPT_SELECTORS = [
  '#prompt-textarea',
  'div#prompt-textarea',
  '[data-testid="composer-text-input"]',
  '[data-id="prompt-textarea"]',
  '[data-testid="prompt-textarea"]',
  '[data-testid="composer-input"]',
  'div.ProseMirror',
  '.ProseMirror',
  'form [contenteditable="true"]',
  'form [role="textbox"]',
  '#composer-background [contenteditable="true"]',
  '[data-testid="composer-container"] [contenteditable="true"]',
  'div[class*="composer"] [contenteditable="true"]',
  'textarea[data-id="prompt-textarea"]',
  'textarea[placeholder*="Send a message"]',
  'textarea[aria-label*="Message ChatGPT"]',
  'textarea[tabindex="0"]'
];

const SUBMIT_SELECTORS = [
  'form button[type="submit"]',
  'button[type="submit"]',
  'button[aria-label*="Gửi"]',
  'button[aria-label*="Send"]',
  'button[data-testid="send-button"]',
  'button[data-testid*="send"]',
  'button[data-testid*="composer-send"]',
  '[data-testid="send-button"]'
];

const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  '[data-testid="stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label*="Ngừng"]',
  'button[aria-label*="Dừng"]',
  'button[aria-label*="Stop"]'
];

export function isGenerating(): boolean {
  for (const sel of STOP_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && el.isConnected) {
        if (!document.hidden && !((el as HTMLElement).offsetWidth || (el as HTMLElement).offsetHeight)) {
          continue;
        }
        return true;
      }
    } catch {}
  }
  return !!document.querySelector(".result-streaming");
}

export function findPromptComposer(): HTMLElement | null {
  for (const sel of PROMPT_SELECTORS) {
    try {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && el.isConnected) {
        return el;
      }
    } catch {}
  }

  // Fallback: Tìm contenteditable cuối cùng trên trang (không phải overlay popup của extension)
  const allEditables = Array.from(
    document.querySelectorAll<HTMLElement>("[contenteditable='true'], [role='textbox']")
  ).filter(e => !e.closest("#otter-command-palette-overlay") && !e.closest("#otter-radial-menu-container"));

  if (allEditables.length > 0) {
    return allEditables[allEditables.length - 1];
  }

  // Fallback: Textarea
  return document.querySelector<HTMLElement>("form textarea, textarea[tabindex='0'], textarea");
}

export const findPromptInput = findPromptComposer;

function findSubmitButton(): HTMLButtonElement | null {
  const form = document.querySelector<HTMLFormElement>("form");
  if (form) {
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) return btn;
  }
  for (const sel of SUBMIT_SELECTORS) {
    try {
      const el = document.querySelector<HTMLButtonElement>(sel);
      if (el) return el;
    } catch {}
  }
  return null;
}

/**
 * Tự động tìm và bấm nút Send (gửi) của ChatGPT Web.
 * Hỗ trợ các thuộc tính tiếng Việt ("Gửi"), tiếng Anh ("Send"),
 * dispatch đủ chuỗi pointerdown/mousedown/pointerup/mouseup/click,
 * gọi form.requestSubmit() và có fallback KeyboardEvent Enter.
 */
export async function submitChatGPTComposer(timeoutMs = 4000): Promise<boolean> {
  const promptInput = findPromptInput();
  const form = promptInput?.closest("form") || document.querySelector("form");

  const isBtnDisabled = (btn: HTMLButtonElement | null) => {
    if (!btn) return true;
    return (
      btn.hasAttribute("disabled") ||
      btn.getAttribute("aria-disabled") === "true" ||
      btn.getAttribute("data-disabled") === "true" ||
      btn.classList.contains("disabled")
    );
  };

  const start = Date.now();
  let submitBtn: HTMLButtonElement | null = null;

  while (Date.now() - start < timeoutMs) {
    submitBtn = (form ? form.querySelector<HTMLButtonElement>('button[type="submit"]') : null) || findSubmitButton();

    if (submitBtn && !isBtnDisabled(submitBtn)) {
      await new Promise((r) => setTimeout(r, 100));

      // 1. Thử gửi qua background script với world: "MAIN" (bắt buộc đối với React 18/19 của ChatGPT Web)
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        try {
          const resp = await chrome.runtime.sendMessage({ type: "submit-chatgpt-main-world" }).catch(() => null);
          if (resp?.ok) {
            console.log("[Otter Injector] ✅ Đã kích hoạt lệnh gửi thành công qua Main World!");
            return true;
          }
        } catch {}
      }

      // 2. Fallback trực tiếp trong isolated DOM
      try {
        submitBtn.focus();
        submitBtn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
        submitBtn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        submitBtn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
        submitBtn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        submitBtn.click();
      } catch {}

      if (form && typeof form.requestSubmit === "function") {
        try {
          form.requestSubmit(submitBtn);
        } catch {}
      }

      console.log("[Otter Injector] ✅ Đã tự động kích hoạt gửi (Send) vào ChatGPT!");
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Fallback: Dispatch phím Enter trên ô nhập
  if (promptInput) {
    console.warn("[Otter Injector] Không thấy nút Send bật sáng sau timeout, fallback gửi phím Enter...");
    promptInput.focus();
    promptInput.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
    return true;
  }

  return false;
}

export async function injectPromptToChatGPT(
  text: string,
  shouldSubmit = true,
  options?: { generationTimeoutMs?: number },
): Promise<boolean> {
  console.log("[Otter Injector] Đang chuẩn bị chèn prompt vào ChatGPT...", { textLength: text.length, shouldSubmit });

  // 1. Chờ tới khi hết generate, hoặc tới timeout của session.
  // Page-loop cũ cap mù 30s -> lượt dài bị chèn chồng. Mặc định mới
  // 10 phút cho một lượt (theo plan page-loop §Phase 3); caller
  // (page-loop session) có thể truyền timeout ngắn hơn.
  const generationTimeoutMs = options?.generationTimeoutMs ?? 600_000;
  let waitStream = 0;
  while (isGenerating() && waitStream < generationTimeoutMs) {
    await new Promise((r) => setTimeout(r, 500));
    waitStream += 500;
  }
  if (isGenerating()) {
    console.error("[Otter Injector] Hết timeout chờ generate, không chèn chồng prompt.");
    return false;
  }

  // 2. Chờ ô nhập liệu xuất hiện
  let promptInput = findPromptInput();
  let waitInput = 0;
  while (!promptInput && waitInput < 10000) {
    await new Promise((r) => setTimeout(r, 500));
    waitInput += 500;
    promptInput = findPromptInput();
  }

  if (!promptInput) {
    console.error("[Otter Injector] Không tìm thấy ô nhập liệu prompt của ChatGPT");
    return false;
  }

  // Focus ô nhập
  promptInput.focus();
  await new Promise((r) => setTimeout(r, 50));

  // 3. Chèn văn bản
  if (promptInput.tagName.toLowerCase() === "textarea") {
    // Kịch bản textarea truyền thống
    const textarea = promptInput as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, text);
    } else {
      textarea.value = text;
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    // Kịch bản ProseMirror contenteditable
    let inserted = false;

    // Chiến lược 1: Clipboard DataTransfer paste (chuẩn nhất cho ProseMirror)
    try {
      promptInput.focus();
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
      const pasteEvent = new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      });
      promptInput.dispatchEvent(pasteEvent);
      await new Promise((r) => setTimeout(r, 50));

      const inner = promptInput.innerText || promptInput.textContent || "";
      if (inner.trim().length > 0) {
        inserted = true;
      }
    } catch {
      inserted = false;
    }

    // Chiến lược 2: execCommand insertText
    if (!inserted) {
      try {
        promptInput.focus();
        inserted = document.execCommand("insertText", false, text);
        await new Promise((r) => setTimeout(r, 30));
      } catch {
        inserted = false;
      }
    }

    // Chiến lược 3: beforeinput + InputEvent
    if (!inserted) {
      try {
        promptInput.dispatchEvent(new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text
        }));
        promptInput.innerText = text;
        promptInput.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        }));
        inserted = true;
      } catch {
        inserted = false;
      }
    }

    // Dispatch các event báo cho React
    promptInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
    promptInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  console.log("[Otter Injector] Đã chèn văn bản thành công vào editor");

  // 4. Tự động bấm gửi nếu được yêu cầu
  if (shouldSubmit) {
    return await submitChatGPTComposer();
  }

  return true;
}
