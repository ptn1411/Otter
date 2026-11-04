import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

async function main() {
  const tabs = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
  const fbTab = tabs.find((t: any) => t.url?.includes("facebook.com") && t.type === "page");
  const ws = new WebSocket(fbTab.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);

  // Cuộn xuống 1200px để qua bài viết của chính mình
  const scrollExpr = `(() => {
    window.scrollBy({ top: 1200, behavior: "smooth" });
    return { scrollY: window.scrollY };
  })()`;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: scrollExpr, returnByValue: true } }));
  await new Promise(r => setTimeout(r, 2000));

  // Trích xuất các bài viết trên feed hiện tại
  const extractFeedExpr = `(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { error: "No feed" };

    const children = Array.from(feed.children).map((c, i) => ({
      index: i,
      tagName: c.tagName,
      role: c.getAttribute('role'),
      innerTextSnippet: c.innerText?.slice(0, 200)
    }));

    return {
      childrenCount: children.length,
      children
    };
  })()`;

  ws.send(JSON.stringify({ id: 2, method: "Runtime.evaluate", params: { expression: extractFeedExpr, returnByValue: true } }));
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data as string);
    if (data.id === 2) {
      console.log("=== DANH SÁCH BÀI VIẾT TRÊN FEED ===");
      console.log(JSON.stringify(data.result?.result?.value, null, 2));
      ws.close();
    }
  };
}

main().catch(console.error);
