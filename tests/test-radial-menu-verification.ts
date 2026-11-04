import WebSocket from "ws";
import fs from "fs";

async function main() {
  const tabsRes = await fetch("http://127.0.0.1:32934/json");
  const tabs = await tabsRes.json();
  const chatTab = tabs.find((t: any) => t.url.includes("chatgpt.com"));
  if (!chatTab) {
    console.error("No ChatGPT tab found!");
    process.exit(1);
  }

  const ws = new WebSocket(chatTab.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.once("open", resolve));

  let reqId = 1;
  const sendCmd = (method: string, params: any = {}) => {
    return new Promise<any>((resolve) => {
      const id = reqId++;
      const handler = (data: any) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === id) {
          ws.off("message", handler);
          resolve(msg.result);
        }
      };
      ws.on("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  console.log("[1] Reloading ChatGPT tab to apply newly built content script...");
  await sendCmd("Page.reload");
  await new Promise((r) => setTimeout(r, 4000));

  console.log("[2] Checking if Radial Menu Hub is rendered in DOM...");
  let checks = 0;
  let hubFound = false;
  while (checks < 15) {
    const res = await sendCmd("Runtime.evaluate", {
      expression: `
        (() => {
          const hub = document.getElementById("otter-radial-toggle");
          const oldChips = document.getElementById("otter-quick-chips");
          const oldFolderBar = document.getElementById("otter-folder-picker-bar");
          const satellites = document.querySelectorAll(".otter-satellite-item");
          return {
            hasHub: !!hub,
            hasOldChips: !!oldChips,
            hasOldFolderBar: !!oldFolderBar,
            satelliteCount: satellites.length
          };
        })()
      `,
      returnByValue: true
    });
    if (res?.result?.value?.hasHub) {
      console.log("Hub status:", res.result.value);
      hubFound = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
    checks++;
  }

  if (!hubFound) {
    console.error("Radial menu hub not found after reload!");
    ws.close();
    process.exit(1);
  }

  // Chụp ảnh trạng thái đóng (gọn gàng, chỉ có 1 nút tròn)
  console.log("[3] Capturing screenshot of closed state (clean single round button)...");
  const shotClosed = await sendCmd("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("radial_menu_closed.png", Buffer.from(shotClosed.data, "base64"));
  console.log("Saved radial_menu_closed.png");

  // Click vào nút Hub để mở menu tỏa
  console.log("[4] Clicking Radial Toggle to expand circular menu...");
  const clickRes = await sendCmd("Runtime.evaluate", {
    expression: `
      (() => {
        const hub = document.getElementById("otter-radial-toggle");
        if (hub) {
          hub.click();
          return true;
        }
        return false;
      })()
    `,
    returnByValue: true
  });
  console.log("Hub clicked:", clickRes?.result?.value);

  // Đợi animation bung tỏa hoàn tất (400ms)
  await new Promise((r) => setTimeout(r, 500));

  // Kiểm tra trạng thái bung tỏa
  const stateRes = await sendCmd("Runtime.evaluate", {
    expression: `
      (() => {
        const hub = document.getElementById("otter-radial-toggle");
        const backdrop = document.getElementById("otter-radial-backdrop");
        const satellites = Array.from(document.querySelectorAll(".otter-satellite-item")).map(el => {
          const rect = el.getBoundingClientRect();
          return {
            title: el.getAttribute("title"),
            x: el.getAttribute("data-x"),
            y: el.getAttribute("data-y"),
            opacity: window.getComputedStyle(el).opacity,
            transform: window.getComputedStyle(el).transform,
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          };
        });
        return {
          hubText: hub?.textContent?.trim(),
          backdropDisplay: backdrop ? window.getComputedStyle(backdrop).display : null,
          satellites
        };
      })()
    `,
    returnByValue: true
  });

  console.log("Expanded state info:", JSON.stringify(stateRes?.result?.value, null, 2));

  // Chụp ảnh trạng thái mở (các nút tròn lệnh nhanh bung nở tỏa xung quanh)
  console.log("[5] Capturing screenshot of expanded circular radial speed-dial...");
  const shotOpen = await sendCmd("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("radial_menu_open.png", Buffer.from(shotOpen.data, "base64"));
  console.log("Saved radial_menu_open.png");

  ws.close();
  console.log("[✓] Test and verification completed successfully!");
}

main().catch(console.error);

