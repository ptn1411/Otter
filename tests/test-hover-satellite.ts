import WebSocket from "ws";
import fs from "fs";

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
          resolve(msgResult(m));
        }
      };
      ws.on("message", h);
      ws.send(JSON.stringify({ id, method, params }));
    });

  function msgResult(m: any) {
    return m.result;
  }

  // Trigger mouseenter vào nút Thư mục và nút Browse
  await send("Runtime.evaluate", {
    expression: `
      (() => {
        const sats = document.querySelectorAll(".otter-satellite-item");
        if (sats.length > 0) {
          const target = sats[0]; // Nút 📁 Thư mục
          target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        }
      })()
    `,
    returnByValue: true
  });

  await new Promise((r) => setTimeout(r, 200));

  const rectRes = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const el = document.getElementById("otter-radial-menu-container");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })()
    `,
    returnByValue: true
  });

  const rect = rectRes?.result?.value;
  console.log("Hover test rect:", rect);
  if (!rect) {
    ws.close();
    return;
  }

  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: {
      x: Math.max(0, rect.x - 200),
      y: Math.max(0, rect.y - 250),
      width: 700,
      height: 400,
      scale: 1
    }
  });

  fs.writeFileSync("radial_menu_hover.png", Buffer.from(shot.data, "base64"));
  if (process.env.ARTIFACT_DIR && fs.existsSync(process.env.ARTIFACT_DIR)) {
    fs.copyFileSync("radial_menu_hover.png", path.join(process.env.ARTIFACT_DIR, "radial_menu_hover.png"));
    console.log("Saved radial_menu_hover.png to artifacts");
  }

  ws.close();
}

main().catch(console.error);
