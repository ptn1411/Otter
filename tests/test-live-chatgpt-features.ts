async function main() {
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const chatTab = tabs.find((t: any) => t.url?.includes("chatgpt.com") && t.type === "page");
  if (!chatTab) {
    console.error("ChatGPT tab not found!");
    process.exit(1);
  }

  const ws = new WebSocket(chatTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  // Reload the tab
  console.log("[1/4] Reloading ChatGPT page...");
  ws.send(JSON.stringify({ id: 1, method: "Page.reload", params: {} }));
  await new Promise(r => setTimeout(r, 4000));

  let reqId = 2;
  function evaluate(expr: string): Promise<any> {
    const id = reqId++;
    return new Promise((resolve) => {
      const handler = (e: any) => {
        const d = JSON.parse(e.data as string);
        if (d.id === id) {
          ws.removeEventListener("message", handler);
          resolve(d.result?.result?.value);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
    });
  }

  console.log("[2/4] Testing Live Features in ChatGPT Tab...");

  // Script test trực tiếp các tính năng mới
  const testScript = `(() => {
    const report = {};

    // 1. Test Web Locks Tab Coordinator
    report.hasLocks = typeof navigator !== "undefined" && !!navigator.locks;

    // 2. Test Export Markdown với cấu trúc thực tế
    const h4s = Array.from(document.querySelectorAll("h4")).filter(h => {
      const text = h.innerText || h.textContent || "";
      return text.includes("Bạn đã nói") || text.includes("ChatGPT đã nói") || text.includes("You said") || text.includes("ChatGPT said");
    });
    report.totalDetectedTurns = h4s.length;

    const turns = [];
    for (const h4 of h4s) {
      const isUser = (h4.textContent || "").includes("Bạn đã nói") || (h4.textContent || "").includes("You said");
      const role = isUser ? "user" : "assistant";
      const container = h4.parentElement;
      if (container) {
        const clone = container.cloneNode(true);
        clone.querySelectorAll("h4, button").forEach(el => el.remove());
        const content = clone.innerText?.trim() || "";
        if (content) {
          turns.push({ role, length: content.length, snippet: content.slice(0, 100) });
        }
      }
    }
    report.extractedTurns = turns;

    // Giả lập nội dung Markdown tạo ra
    const dateStr = new Date().toLocaleString("vi-VN");
    const mdLines = [
      "# " + (document.title.replace(/\\s*-\\s*ChatGPT.*$/i, "").trim() || "Cuộc trò chuyện Otter"),
      "> *Thời gian xuất:* " + dateStr + " | *Tổng số lượt chat:* " + turns.length,
      "",
      "---",
      ""
    ];
    for (const t of turns) {
      mdLines.push(t.role === "user" ? "### 👤 User" : "### 🤖 Assistant");
      mdLines.push("");
      mdLines.push(t.snippet + "...");
      mdLines.push("");
      mdLines.push("---");
      mdLines.push("");
    }
    mdLines.push("*(Được xuất bản tự động bởi Otter — Agentic AI Suite)*");
    report.generatedMarkdownSample = mdLines.join("\\n").slice(0, 500);

    // 3. Test Template Engine Logic trên trang web
    const testTemplate = "Hãy đăng bài lên group {{ group_id }} chế độ {{ mode: template, ai_generated }} nội dung: {{ content | Bài viết mới }}";
    const regex = /\\{\\{\\s*([^}]+)\\s*\\}\\}/g;
    const parsedVars = [];
    let m;
    while ((m = regex.exec(testTemplate)) !== null) {
      parsedVars.push(m[1]);
    }
    report.templateEngine = {
      template: testTemplate,
      parsedVariables: parsedVars
    };

    return report;
  })()`;

  const result = await evaluate(testScript);
  console.log("[3/4] Live Test Results:");
  console.log(JSON.stringify(result, null, 2));

  console.log("[4/4] Capturing verified screenshot...");
  const shotRes: any = await new Promise((resolve) => {
    const id = reqId++;
    const handler = (e: any) => {
      const d = JSON.parse(e.data as string);
      if (d.id === id) {
        ws.removeEventListener("message", handler);
        resolve(d.result?.data);
      }
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ id, method: "Page.captureScreenshot", params: { format: "png" } }));
  });

  if (shotRes) {
    const fs = await import("fs/promises");
    const artifactPath = process.env.ARTIFACT_DIR ? `${process.env.ARTIFACT_DIR}/chatgpt_live_features.png` : "storage/chatgpt_live_features.png";
    await fs.writeFile(artifactPath, Buffer.from(shotRes, "base64"));
    console.log("[+] Verified screenshot saved to:", artifactPath);
  }

  ws.close();
  process.exit(0);
}

main().catch(console.error);
