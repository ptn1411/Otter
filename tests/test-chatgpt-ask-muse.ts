/**
 * Script đóng vai người dùng ra lệnh cho ChatGPT Web gọi tool ask_muse_agent
 */
async function sendPromptToChatGPT() {
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const chatTab = tabs.find((t: any) => t.url?.includes("chatgpt.com") && t.type === "page");
  if (!chatTab) {
    console.error("[-] Không tìm thấy tab ChatGPT!");
    process.exit(1);
  }

  const ws = new WebSocket(chatTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  const promptText = `Otter ơi, hãy gọi công cụ ask_muse_agent để nhờ AI đối tác Muse sáng tác một câu châm ngôn ngắn gọn, ý nghĩa về lòng kiên trì của lập trình viên, sau đó báo cáo lại kết quả cho tôi nhé!`;

  console.log("[*] Đang đóng vai người dùng gửi lệnh tới ChatGPT Web:", promptText);

  const injectScript = `(() => {
    // 1. Tự động bấm Allow / Always allow nếu có popup cấp quyền tool MCP
    const buttons = Array.from(document.querySelectorAll("button"));
    const allowBtn = buttons.find(b => {
      const t = b.textContent?.toLowerCase() || "";
      return t.includes("always allow") || t.includes("luôn cho phép") || t.includes("allow") || t.includes("cho phép");
    });
    if (allowBtn) {
      allowBtn.click();
      console.log("[Test] Clicked allow button");
    }

    // 2. Tìm input của ChatGPT
    const editor = document.querySelector("#prompt-textarea, div[contenteditable='true'], textarea");
    if (!editor) return { ok: false, error: "Editor not found" };

    if (editor.tagName.toLowerCase() === "textarea") {
      (editor as HTMLTextAreaElement).value = ${JSON.stringify(promptText)};
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      (editor as HTMLElement).focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, ${JSON.stringify(promptText)});
    }

    // 3. Đợi 500ms rồi bấm Send
    setTimeout(() => {
      const sendBtn = document.querySelector("button[data-testid='send-button'], button[aria-label='Gửi lời nhắc'], button[aria-label='Send prompt']");
      if (sendBtn && !(sendBtn as HTMLButtonElement).disabled) {
        (sendBtn as HTMLElement).click();
      } else {
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      }
    }, 500);

    return { ok: true };
  })()`;

  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: injectScript, returnByValue: true } }));
  ws.onmessage = async (e) => {
    const data = JSON.parse(e.data as string);
    console.log("[+] Đã gửi prompt thành công vào ChatGPT Web:", data.result?.result?.value);
    
    // Đợi 5 giây theo dõi
    await new Promise(r => setTimeout(r, 5000));
    ws.close();
    process.exit(0);
  };
}

sendPromptToChatGPT().catch(console.error);

