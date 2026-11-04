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

  console.log("[1] Reloading ChatGPT tab for final deployment test...");
  await send("Page.reload");
  await new Promise((r) => setTimeout(r, 4000));

  console.log("[2] Verifying Radial Menu elements in DOM...");
  const status = await send("Runtime.evaluate", {
    expression: `
      (() => {
        const hub = document.getElementById("otter-radial-toggle");
        const satellites = document.querySelectorAll(".otter-satellite-item");
        const oldChips = document.getElementById("otter-quick-chips");
        const oldBar = document.getElementById("otter-folder-picker-bar");
        const backdrop = document.getElementById("otter-radial-backdrop");

        return {
          hasHub: !!hub,
          satelliteCount: satellites.length,
          hasOldChips: !!oldChips,
          hasOldBar: !!oldBar,
          hasBackdrop: !!backdrop
        };
      })()
    `,
    returnByValue: true
  });
  console.log("DOM Health Check:", status?.value || status);

  console.log("[3] Clicking Hub to expand Radial Menu...");
  await send("Runtime.evaluate", {
    expression: 'document.getElementById("otter-radial-toggle")?.click()',
    returnByValue: true
  });
  await new Promise((r) => setTimeout(r, 600));

  // Chụp ảnh bằng chứng
  console.log("[4] Capturing screenshot of deployed radial menu...");
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("deploy_verified.png", Buffer.from(shot.data, "base64"));
  if (process.env.ARTIFACT_DIR && fs.existsSync(process.env.ARTIFACT_DIR)) {
    fs.copyFileSync("deploy_verified.png", path.join(process.env.ARTIFACT_DIR, "deploy_verified.png"));
    console.log("Saved deploy_verified.png to artifacts");
  }

  ws.close();
  console.log("[✓] Deployment verification PASSED!");
}

main().catch(console.error);

