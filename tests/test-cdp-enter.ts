async function testCdpEnter() {
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const fbTab = tabs.find((t: any) => t.url?.includes("facebook.com") && t.type === "page");
  if (!fbTab) return;
  const ws = new WebSocket(fbTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  // Focus ô bình luận
  ws.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: `(() => {
        const inp = document.querySelector('div[role="textbox"][aria-label*="Viết bình luận"]');
        if (inp) {
          inp.focus();
          return true;
        }
        return false;
      })()`,
      returnByValue: true
    }
  }));

  await new Promise(r => setTimeout(r, 500));

  // Gửi Enter qua CDP Native Key Event
  ws.send(JSON.stringify({
    id: 2,
    method: "Input.dispatchKeyEvent",
    params: {
      type: "rawKeyDown",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      macCharCode: 13,
      key: "Enter",
      code: "Enter",
      text: "\r"
    }
  }));

  ws.send(JSON.stringify({
    id: 3,
    method: "Input.dispatchKeyEvent",
    params: {
      type: "keyUp",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      macCharCode: 13,
      key: "Enter",
      code: "Enter"
    }
  }));

  await new Promise(r => setTimeout(r, 1500));
  console.log("Dispatched native Enter via CDP successfully!");
  ws.close();
  process.exit(0);
}
testCdpEnter().catch(console.error);

