import WebSocket from "ws";

async function main() {
  const tabsRes = await fetch("http://127.0.0.1:32934/json");
  const tabs = await tabsRes.json();
  const chatTab = tabs.find((t: any) => t.url.includes("chatgpt.com"));
  if (!chatTab) return;

  const ws = new WebSocket(chatTab.webSocketDebuggerUrl);
  await new Promise((r) => ws.once("open", r));

  let reqId = 1;
  const send = (method: string, params: any = {}) =>
    new Promise<any>((resolve) => {
      const id = reqId++;
      const h = (d: any) => {
        const m = JSON.parse(d.toString());
        if (m.id === id) {
          ws.off("message", h);
          resolve(m.result);
        }
      };
      ws.on("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });

  console.log("[1] Checking if menu is currently open or closed...");
  // Click vào nút vệ tinh thứ 5 (ví dụ một lệnh prompt)
  const clickSat = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const sats = Array.from(document.querySelectorAll(".otter-satellite-item"));
        // Tìm nút có title chứa fb-feed hoặc tương tự
        const feedSat = sats.find(s => s.getAttribute("title")?.includes("Quét Feed")) || sats[4];
        if (feedSat) {
          feedSat.click();
          return { clicked: true, title: feedSat.getAttribute("title") };
        }
        return { clicked: false };
      })()
    `,
    returnByValue: true
  });

  console.log("Satellite click result:", clickSat?.result?.value);

  // Đợi 400ms để menu đóng và prompt được chèn
  await new Promise((r) => setTimeout(r, 500));

  // Kiểm tra nội dung trong composer và trạng thái menu
  const verifyRes = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const composer = document.querySelector("#prompt-textarea") || document.querySelector('[contenteditable="true"]');
        const hub = document.getElementById("otter-radial-toggle");
        const backdrop = document.getElementById("otter-radial-backdrop");
        const sat = document.querySelector(".otter-satellite-item");
        
        return {
          composerText: composer?.innerText || (composer ? composer.value : "") || "",
          hubText: hub?.textContent?.trim(),
          isMenuClosed: sat ? window.getComputedStyle(sat).opacity === "0" : false,
          backdropClosed: backdrop ? window.getComputedStyle(backdrop).display === "none" : true
        };
      })()
    `,
    returnByValue: true
  });

  console.log("verifyRes raw:", JSON.stringify(verifyRes, null, 2));
  ws.close();
}

main().catch(console.error);
