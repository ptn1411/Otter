import * as fs from "node:fs/promises";

async function testCleanPromptSend() {
  const tabs = await fetch("http://127.0.0.1:32934/json").then(r => r.json());
  const chatTab = tabs.find((t: any) => t.url?.includes("chatgpt.com"));
  if (!chatTab) {
    console.error("No ChatGPT tab found!");
    return;
  }

  const ws = new WebSocket(chatTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 1;
  const sendCdp = (method: string, params: any = {}) => new Promise<any>((resolve) => {
    const curId = msgId++;
    const handler = (evt: any) => {
      const msg = JSON.parse(evt.data);
      if (msg.id === curId) {
        ws.removeEventListener("message", handler);
        resolve(msg.result);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id: curId, method, params }));
  });

  const promptText = "Chào bạn! Hãy cho tôi biết 3 ưu điểm của tự động hóa trình duyệt trong 30 từ.";

  // 1. Target exactly the bottom chat input
  const injectRes = await sendCdp("Runtime.evaluate", {
    expression: `(() => {
      // Tìm form ở cuối trang
      const form = document.querySelector('form');
      const ta = form ? form.querySelector('#prompt-textarea, div.ProseMirror, [contenteditable=\"true\"], textarea') : document.querySelector('div.ProseMirror[contenteditable=\"true\"], #prompt-textarea');
      if (!ta) return { ok: false, error: 'Không tìm thấy ô nhập liệu' };

      ta.focus();
      if (ta.tagName.toLowerCase() === 'textarea') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(ta, ${JSON.stringify(promptText)});
        else ta.value = ${JSON.stringify(promptText)};
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // ProseMirror
        const p = ta.querySelector('p') || ta;
        p.textContent = ${JSON.stringify(promptText)};
        ta.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(promptText)}, inputType: 'insertText' }));
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: true, tag: ta.tagName, className: ta.className };
    })()`,
    returnByValue: true
  });

  console.log("Inject result:", injectRes?.result?.value);

  // 2. Click send button or send Enter via CDP
  await new Promise(r => setTimeout(r, 400));

  // Thử click button trước
  const clickRes = await sendCdp("Runtime.evaluate", {
    expression: `(() => {
      const form = document.querySelector('form');
      const btn = form ? form.querySelector('button[data-testid=\"send-button\"], button[aria-label*=\"Send\" i], button[aria-label*=\"Gửi\" i]') : document.querySelector('button[data-testid=\"send-button\"]');
      if (btn && !btn.disabled) {
        btn.click();
        return { clicked: true, method: 'button' };
      }
      return { clicked: false };
    })()`,
    returnByValue: true
  });

  console.log("Click result:", clickRes?.result?.value);

  // Nếu nút bấm chưa được click hoặc chưa gửi, dùng CDP Native Enter Key Event
  if (!clickRes?.result?.value?.clicked) {
    console.log("Dispatching Native Enter via CDP...");
    await sendCdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      macCharCode: 13,
      key: "Enter",
      code: "Enter",
      text: "\r"
    });
    await sendCdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      macCharCode: 13,
      key: "Enter",
      code: "Enter"
    });
  }

  // Chờ 3s xem ChatGPT bắt đầu trả lời chưa
  await new Promise(r => setTimeout(r, 3000));
  const checkRes = await sendCdp("Runtime.evaluate", {
    expression: `(() => {
      const stopBtn = document.querySelector(\"button[data-testid='stop-button'], button[aria-label*='Stop' i], button[aria-label*='Dừng' i]\");
      const articles = Array.from(document.querySelectorAll(\"article, [data-message-author-role='assistant']\"));
      const last = articles[articles.length - 1];
      return {
        isGenerating: !!stopBtn,
        articleCount: articles.length,
        lastText: last ? (last.innerText || '').slice(0, 150) : ''
      };
    })()`,
    returnByValue: true
  });

  console.log("State after sending:", checkRes?.result?.value);
  ws.close();
}

testCleanPromptSend().catch(console.error);

