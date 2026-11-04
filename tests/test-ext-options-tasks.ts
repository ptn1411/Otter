import * as fs from "node:fs/promises";
import * as path from "node:path";

async function testExtensionOptionsPage() {
  const extId = "kbpmmkldignipoonenihacolibngdjhd";
  const url = `chrome-extension://${extId}/options.html`;

  console.log(`[*] Mở trang Options của Extension: ${url}`);
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

  // Bấm chuyển sang tab Tác Vụ Hẹn Giờ
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = document.getElementById('tab-btn-tasks');
      if (btn) btn.click();
    })()`
  });

  // Đợi 2.5s để nạp dữ liệu từ daemon qua /api/tasks
  await new Promise(r => setTimeout(r, 2500));

  // Chụp ảnh màn hình options page
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const buf = Buffer.from(shot.data, "base64");
  const outPath = process.env.ARTIFACT_DIR ? path.join(process.env.ARTIFACT_DIR, "extension_options_tasks.png") : "storage/extension_options_tasks.png";
  await fs.writeFile(outPath, buf);
  console.log(`[+] Đã lưu ảnh chụp trang Extension Options: ${outPath}`);

  // Kiểm tra DOM xem các tác vụ đã nạp thành công chưa
  const domRes = await send("Runtime.evaluate", {
    expression: `(() => {
      const activeTab = document.querySelector('.tab-btn.active')?.innerText;
      const total = document.getElementById('opt-stat-total')?.innerText;
      const completed = document.getElementById('opt-stat-completed')?.innerText;
      const tasksContainer = document.getElementById('opt-tasks-list-container')?.innerText;
      return { activeTab, total, completed, tasksCount: document.querySelectorAll('#opt-tasks-list-container > div').length, tasksText: tasksContainer?.slice(0, 300) };
    })()`,
    returnByValue: true
  });
  console.log("[+] Trạng thái DOM trang Extension:", domRes?.result?.value);

  ws.close();
  // Đóng tab sau khi chụp xong
  await fetch(`http://127.0.0.1:32934/json/close/${newTab.id}`);
}

testExtensionOptionsPage().catch(console.error);
