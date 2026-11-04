/**
 * Live test A1: Xác minh selector lượt assistant và nút stop trên ChatGPT thật có đăng nhập.
 * Chạy: bun scripts/test-a1-live-turn.ts
 */
async function main() {
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const chatTab = tabs.find((t: any) => t.url?.includes("chatgpt.com") && t.type === "page");
  if (!chatTab) throw new Error("Không tìm thấy tab ChatGPT");

  const ws = new WebSocket(chatTab.webSocketDebuggerUrl);
  await new Promise((resolve) => { ws.onopen = resolve; });

  let idCounter = 1;
  function evaluate(expr: string): Promise<any> {
    const id = idCounter++;
    return new Promise((resolve) => {
      const handler = (evt: any) => {
        const d = JSON.parse(evt.data as string);
        if (d.id === id) {
          ws.removeEventListener("message", handler);
          resolve(d.result?.result?.value);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
    });
  }

  console.log("[A1 Live Test] Đang chuẩn bị chèn prompt vào ChatGPT...");
  const promptText = "Chào bạn! Hãy trả lời ngắn gọn: 'Otter selector test A1 thành công.' kèm một dòng cuối cùng đúng là OTTER-DONE";

  const injectResult = await evaluate(`(() => {
    const promptInput = document.querySelector('div.ProseMirror[contenteditable="true"]') || document.querySelector('[contenteditable="true"]');
    if (!promptInput) return { ok: false, error: "Không tìm thấy input" };
    promptInput.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, ${JSON.stringify(promptText)});
    promptInput.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: ${JSON.stringify(promptText)} }));
    promptInput.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ${JSON.stringify(promptText)} }));

    // Tìm nút gửi
    const submitBtn = document.querySelector('button[type="submit"]') ||
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Gửi"]') ||
      document.querySelector('button[aria-label*="Send"]');

    if (!submitBtn) return { ok: false, error: "Không tìm thấy submit button" };
    submitBtn.click();
    return { ok: true, submitBtnHtml: submitBtn.outerHTML.slice(0, 100) };
  })()`);

  console.log("[A1 Live Test] Kết quả bấm gửi:", injectResult);
  if (!injectResult?.ok) {
    ws.close();
    process.exit(1);
  }

  console.log("[A1 Live Test] Đã bấm gửi! Đang theo dõi quá trình sinh câu trả lời (stop button & streaming)...");

  let foundStopSelector = "";
  let isGenerating = true;
  let attempts = 0;

  while (isGenerating && attempts < 40) { // chờ tối đa 20s
    await new Promise(r => setTimeout(r, 500));
    attempts++;

    const status = await evaluate(`(() => {
      const stopSelectors = [
        'button[data-testid="stop-button"]',
        '[data-testid="stop-button"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="Dừng"]',
        'button[aria-label*="dừng"]'
      ];
      let stopFound = null;
      for (const sel of stopSelectors) {
        const el = document.querySelector(sel);
        if (el) { stopFound = { selector: sel, ariaLabel: el.getAttribute('aria-label') }; break; }
      }
      const isStreaming = !!document.querySelector('.result-streaming');
      return { stopFound, isStreaming };
    })()`);

    if (status?.stopFound && !foundStopSelector) {
      foundStopSelector = status.stopFound.selector;
      console.log(`[A1 Live Test] ✅ Phát hiện nút Stop đang hoạt động: ${status.stopFound.selector} (aria-label: ${status.stopFound.ariaLabel})`);
    }

    if (attempts > 4 && !status?.stopFound && !status?.isStreaming) {
      console.log("[A1 Live Test] Sinh câu trả lời đã kết thúc! Chờ 2s để DOM ổn định...");
      isGenerating = false;
    }
  }

  await new Promise(r => setTimeout(r, 2000));

  console.log("[A1 Live Test] Đang phân tích DOM để tìm selector của Assistant Turn...");

  const domAnalysis = await evaluate(`(() => {
    const turnSelectors = [
      '[data-message-author-role="assistant"]',
      'article[data-message-author-role="assistant"]',
      '[data-testid="conversation-turn"] [data-message-author-role="assistant"]',
      '[data-testid="conversation-turn"]',
      'article',
      '.agent-turn'
    ];

    const turnResults = turnSelectors.map(sel => {
      const nodes = Array.from(document.querySelectorAll(sel));
      return {
        selector: sel,
        count: nodes.length,
        turns: nodes.map(n => ({
          turnId: n.getAttribute('data-turn-id') || n.closest('[data-turn-id]')?.getAttribute('data-turn-id') || null,
          role: n.getAttribute('data-message-author-role'),
          textSnippet: (n.innerText || n.textContent || '').trim().slice(0, 150)
        }))
      };
    });

    const proseSelectors = [
      '.markdown',
      '[data-message-content="true"]',
      '.prose'
    ].map(sel => ({ selector: sel, count: document.querySelectorAll(sel).length }));

    return {
      turnResults,
      proseSelectors,
      lastTurnText: document.querySelector('[data-message-author-role="assistant"]')?.innerText ||
                    document.querySelector('article:last-of-type')?.innerText || ""
    };
  })()`);

  console.log("=======================================================");
  console.log("       KẾT QUẢ XÁC MINH SELECTOR TRÊN CHATGPT THẬT");
  console.log("=======================================================");
  console.log(JSON.stringify(domAnalysis, null, 2));

  ws.close();
}

main().catch(console.error);

