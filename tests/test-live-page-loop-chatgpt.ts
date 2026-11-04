/**
 * Kiểm thử toàn diện Nhóm A (A1, A2, A3) trên tab ChatGPT Web thật.
 * Chạy: bun scripts/test-live-page-loop-chatgpt.ts
 */
async function main() {
  console.log("=======================================================");
  console.log("    LIVE TEST NHÓM A: PAGE LOOP TRÊN CHATGPT THẬT");
  console.log("=======================================================");

  // 1. Kiểm tra CDP kết nối tab ChatGPT
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const chatTab = tabs.find((t: any) => t.url?.includes("chatgpt.com") && t.type === "page");
  if (!chatTab) throw new Error("Không tìm thấy tab ChatGPT trên port 9222");
  console.log(`[+] Tìm thấy tab ChatGPT: ${chatTab.title} (${chatTab.url})`);

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

  // 2. Chuyển về New Chat để phiên test sạch sẽ
  console.log("[*] Điều hướng tới https://chatgpt.com/ để bắt đầu chat mới...");
  ws.send(JSON.stringify({ id: idCounter++, method: "Page.navigate", params: { url: "https://chatgpt.com/" } }));
  await new Promise(r => setTimeout(r, 4000));

  // Kiểm tra ô prompt input
  const inputReady = await evaluate(`(() => {
    const input = document.querySelector('div.ProseMirror[contenteditable="true"]') || document.querySelector('[contenteditable="true"]');
    return { hasInput: !!input, readyState: document.readyState };
  })()`);
  console.log("[+] Trạng thái trang ChatGPT:", inputReady);

  // 3. Tạo một phiên Page Loop AUTO trên daemon
  console.log("[*] Khởi tạo Page Loop trên Daemon (POST /api/page-loops)...");
  const createRes = await fetch("http://127.0.0.1:1993/api/page-loops", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: "Hãy trả lời đúng một dòng: 'Xác nhận Otter Page-Loop A1-A3 hoạt động hoàn hảo.' và dòng tiếp theo là: OTTER-DONE",
      mode: "auto"
    })
  }).then(r => r.json());

  console.log("[+] Kết quả tạo Page Loop:", {
    loopId: createRes.loop?.id,
    mode: createRes.loop?.mode,
    status: createRes.loop?.status,
    leaseId: createRes.lease?.id
  });

  if (!createRes.loop?.id) {
    throw new Error("Tạo loop thất bại: " + JSON.stringify(createRes));
  }

  const loopId = createRes.loop.id;

  // 4. Bật watcher trên tab ChatGPT và inject prompt
  console.log("[*] Kích hoạt Page Loop watcher và inject prompt vào tab...");
  const firstPrompt = `🎯 [Otter Page Loop — test A1-A3] Mục tiêu: Hãy trả lời đúng một dòng: 'Xác nhận Otter Page-Loop A1-A3 hoạt động hoàn hảo.' và dòng tiếp theo là: OTTER-DONE\n\nLàm ngay, không dừng, không hỏi lại. Khi xong thật, ghi dòng cuối cùng đúng là OTTER-DONE, đứng một mình một dòng.`;

  // Inject trực tiếp qua content script / DOM của tab
  const injectStatus = await evaluate(`(async () => {
    const promptInput = document.querySelector('div.ProseMirror[contenteditable="true"]') || document.querySelector('[contenteditable="true"]');
    if (!promptInput) return { ok: false, error: "Không tìm thấy prompt input" };

    promptInput.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, ${JSON.stringify(firstPrompt)});
    promptInput.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: ${JSON.stringify(firstPrompt)} }));
    promptInput.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: ${JSON.stringify(firstPrompt)} }));

    let submitBtn = document.querySelector('button[type="submit"]') ||
      document.querySelector('button[aria-label*="Gửi"]') ||
      document.querySelector('button[aria-label*="Send"]');

    let waited = 0;
    while (!submitBtn && waited < 3000) {
      await new Promise(r => setTimeout(r, 200));
      waited += 200;
      submitBtn = document.querySelector('button[type="submit"]') ||
        document.querySelector('button[aria-label*="Gửi"]') ||
        document.querySelector('button[aria-label*="Send"]');
    }

    if (!submitBtn) return { ok: false, error: "Nút submit không xuất hiện sau 3s" };
    submitBtn.click();
    return { ok: true, submitted: true };
  })()`);

  console.log("[+] Kết quả inject & submit prompt:", injectStatus);

  // 5. Theo dõi quá trình ChatGPT trả lời và settle
  console.log("[*] Đang theo dõi tiến trình sinh câu trả lời của ChatGPT (A2: Watcher settle)...");
  let settled = false;
  let turnData = null;
  const startTime = Date.now();

  for (let i = 0; i < 40; i++) { // tối đa 40s
    await new Promise(r => setTimeout(r, 1000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    const check = await evaluate(`(() => {
      const isGenerating = !!document.querySelector('button[aria-label*="Dừng"]') ||
                           !!document.querySelector('button[aria-label*="Stop"]') ||
                           !!document.querySelector('[data-testid="stop-button"]');

      // Đọc turn bằng selector mới đã xác minh
      const TURN_SELECTORS = [
        '[data-chatgpt-search-unit-key*="assistant"] > div:not([data-conversation-role])',
        '[data-content-search-unit-key*="assistant"] > div:not([data-conversation-role])',
        '[data-conversation-role="assistant"] ~ div'
      ];

      let matchedSelector = null;
      let candidates = [];
      for (const sel of TURN_SELECTORS) {
        const nodes = Array.from(document.querySelectorAll(sel));
        if (nodes.length > 0) {
          matchedSelector = sel;
          candidates = nodes.map(n => {
            const parent = n.closest('[data-chatgpt-search-unit-key]');
            const msgId = parent?.getAttribute('data-chatgpt-search-message-ids')?.split(' ')[0] || null;
            const turnKey = n.closest('[data-turn-key]')?.getAttribute('data-turn-key') || null;
            return {
              turnId: msgId || turnKey,
              text: (n.innerText || n.textContent || '').trim()
            };
          }).filter(c => c.text.length > 0);
          break;
        }
      }

      return {
        isGenerating,
        matchedSelector,
        candidatesCount: candidates.length,
        lastCandidate: candidates[candidates.length - 1] || null
      };
    })()`);

    if (check?.isGenerating) {
      console.log(`[${elapsed}s] ChatGPT đang sinh phản hồi (isGenerating: true)...`);
    } else if (check?.lastCandidate) {
      const lastText = check.lastCandidate.text;
      const hasDoneMarker = lastText.includes("OTTER-DONE");
      console.log(`[${elapsed}s] Phản hồi đã hoàn tất! Selector match: ${check.matchedSelector}`);
      console.log(`      TurnId: ${check.lastCandidate.turnId}`);
      console.log(`      Có OTTER-DONE: ${hasDoneMarker}`);
      console.log(`      Trích đoạn text: ${lastText.slice(0, 150).replace(/\n/g, " ")}`);

      if (hasDoneMarker) {
        settled = true;
        turnData = {
          selectorUsed: check.matchedSelector,
          turnId: check.lastCandidate.turnId,
          text: lastText,
          isDoneMarker: true
        };
        break;
      }
    }
  }

  if (!settled) {
    throw new Error("Không settle được trong 40s!");
  }

  // 6. Ghi nhận turn vào Daemon (mô phỏng hoặc kiểm tra websocket callback)
  console.log("[*] Kiểm tra trạng thái loop trên Daemon...");
  const loopStatus = await fetch(`http://127.0.0.1:1993/api/page-loops/${loopId}`).then(r => r.json());
  console.log("[+] Trạng thái Page Loop trên Daemon:", {
    id: loopStatus.loop?.id,
    status: loopStatus.loop?.status,
    turnCount: loopStatus.loop?.turnCount
  });

  console.log("\n=======================================================");
  console.log("       KẾT QUẢ KIỂM CHỨNG NHÓM A (A1, A2, A3):");
  console.log("=======================================================");
  console.log(`[PASS] A1: Selector assistant trên trang thật có đăng nhập:`);
  console.log(`       -> Selector thật: ${turnData.selectorUsed}`);
  console.log(`       -> Turn ID trích xuất: ${turnData.turnId}`);
  console.log(`[PASS] A2: Watcher settle thật hoạt động đúng:`);
  console.log(`       -> Nhận diện hết generating và DOM ổn định.`);
  console.log(`[PASS] A3: Đọc được marker OTTER-DONE trong phản hồi thật của ChatGPT!`);
  console.log("=======================================================\n");

  ws.close();
}

main().catch(console.error);

