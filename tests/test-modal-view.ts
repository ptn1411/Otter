import * as fs from "node:fs/promises";

async function testModalInExtension() {
  const extId = "kbpmmkldignipoonenihacolibngdjhd";
  const url = `chrome-extension://${extId}/options.html`;

  const newTab = await fetch(`http://127.0.0.1:32934/json/new?${url}`, { method: "PUT" }).then(r => r.json());
  await new Promise(r => setTimeout(r, 2000));

  const ws = new WebSocket(newTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  let msgId = 1;
  const send = (method: string, params: any = {}) => new Promise<any>((resolve) => {
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

  // Switch to tasks tab and wait for tasks to load
  await send("Runtime.evaluate", {
    expression: `(() => {
      document.getElementById('tab-btn-tasks')?.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 2000));

  // Click on the first "Xem Kết Quả & Ảnh" button
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.querySelector('.opt-task-view-btn');
      if (btn) btn.click();
    })()`
  });
  await new Promise(r => setTimeout(r, 1000));

  // Capture screenshot of the modal
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(shot.data, "base64");
  const outPath = process.env.ARTIFACT_DIR ? path.join(process.env.ARTIFACT_DIR, "extension_modal_view.png") : "storage/extension_modal_view.png";
  await fs.writeFile(outPath, buf);
  console.log(`[+] Đã lưu ảnh chụp modal kết quả trong Extension: ${outPath}`);

  ws.close();
  await fetch(`http://127.0.0.1:32934/json/close/${newTab.id}`);
}

testModalInExtension().catch(console.error);

