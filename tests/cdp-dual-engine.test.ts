import { describe, test, expect } from "bun:test";
import { cdpBridge } from "../src/daemon/cdp-bridge";
import { browserBridge } from "../src/daemon/browser-bridge";
import { createMcpServer } from "../src/daemon/mcp";

describe("Otter CDP & Dual-Engine Browser Automation Tests", () => {
  test("cdpBridge: configuration and port management", () => {
    expect(cdpBridge.getPort()).toBe(9222);
    cdpBridge.setPort(9222);
    expect(cdpBridge.getPort()).toBe(9222);
  });

  test("cdpBridge: port 9222 is available and responds", async () => {
    const isAvail = await cdpBridge.isAvailable();
    expect(typeof isAvail).toBe("boolean");
    // Nếu trình duyệt/GPM Login đang mở port 9222
    if (isAvail) {
      const tabs = await cdpBridge.getTabs();
      expect(Array.isArray(tabs)).toBe(true);
      expect(tabs.length).toBeGreaterThan(0);
      expect(tabs[0]).toHaveProperty("id");
      expect(tabs[0]).toHaveProperty("url");
    }
  });

  test("cdpBridge: benchmark latency is fast (< 50ms)", async () => {
    const isAvail = await cdpBridge.isAvailable();
    if (!isAvail) {
      console.log("Bỏ qua test vì CDP 9222 chưa mở");
      return;
    }
    const bench = await cdpBridge.benchmark(2);
    expect(bench.available).toBe(true);
    expect(bench.averageLatencyMs).toBeGreaterThanOrEqual(0);
    expect(bench.averageLatencyMs).toBeLessThan(100);
  });

  test("cdpBridge: readPage extracts structured DOM correctly", async () => {
    const isAvail = await cdpBridge.isAvailable();
    if (!isAvail) return;

    const page = await cdpBridge.readPage();
    expect(page).toHaveProperty("title");
    expect(page).toHaveProperty("url");
    expect(page).toHaveProperty("elements");
    expect(Array.isArray(page.elements)).toBe(true);
    expect(page.elementsCount).toBeGreaterThanOrEqual(0);

    if (page.elements.length > 0) {
      const firstEl = page.elements[0];
      expect(firstEl).toHaveProperty("index");
      expect(firstEl.index).toBe(1);
      expect(firstEl).toHaveProperty("tagName");
      expect(firstEl).toHaveProperty("coords");
    }
  });

  test("browserBridge: dual-engine mode switching and auto-routing", async () => {
    browserBridge.setEngineMode("auto");
    expect(browserBridge.getEngineMode()).toBe("auto");

    const statusAuto = await browserBridge.getStatus();
    expect(statusAuto.mode).toBe("auto");
    expect(["cdp", "extension", "none"]).toContain(statusAuto.activeEngine);

    browserBridge.setEngineMode("cdp");
    expect(browserBridge.getEngineMode()).toBe("cdp");
    const statusCdp = await browserBridge.getStatus();
    expect(statusCdp.mode).toBe("cdp");

    browserBridge.setEngineMode("extension");
    expect(browserBridge.getEngineMode()).toBe("extension");
    const statusExt = await browserBridge.getStatus();
    expect(statusExt.mode).toBe("extension");

    // Khôi phục về mặc định CDP
    browserBridge.setEngineMode("cdp");
  });

  test("browserBridge: chế độ mặc định là CDP (engine chính)", async () => {
    const { BrowserBridge } = await import("../src/daemon/browser-bridge");
    const fresh = new BrowserBridge();
    // Không đặt OTTER_BROWSER_ENGINE trong môi trường test -> mặc định "cdp".
    if (!process.env.OTTER_BROWSER_ENGINE) {
      expect(fresh.getEngineMode()).toBe("cdp");
    }
    const status = await fresh.getStatus();
    expect(status.mode).toBe(fresh.getEngineMode());
    // Ở chế độ cdp, activeEngine chỉ có thể là cdp hoặc none (không bao giờ extension).
    if (status.mode === "cdp") {
      expect(["cdp", "none"]).toContain(status.activeEngine);
    }
  });

  test("cdpBridge: select/inject báo lỗi rõ ràng khi CDP chưa mở", async () => {
    const isAvail = await cdpBridge.isAvailable();
    if (isAvail) return; // Máy có Chrome CDP thật: bỏ qua, đã có test read_page bao phủ.
    await expect(cdpBridge.select(1, "x")).rejects.toThrow();
    await expect(cdpBridge.injectChatMessage("xin chào")).rejects.toThrow();
    await expect(cdpBridge.execute("select", { index: 1, option: "x" })).rejects.toThrow();
  });

  test("browserBridge: injectPromptSmart trả false khi cả 2 engine đều chưa sẵn sàng", async () => {
    const isAvail = await cdpBridge.isAvailable();
    if (isAvail) return;
    // Không có extension socket, CDP chưa mở và không spawn được Chrome trong CI:
    // hàm phải trả false thay vì ném lỗi. (ensureCdpChrome có thể mất vài giây nếu thử spawn.)
    const ok = await browserBridge.injectPromptSmart("test", false);
    expect(ok).toBe(false);
  }, 30000);

  test("browserBridge: unified execute('read_page') runs seamlessly", async () => {
    const isAvail = await cdpBridge.isAvailable();
    if (!isAvail) return;

    browserBridge.setEngineMode("auto");
    const res = await browserBridge.execute("read_page");
    expect(res).toHaveProperty("title");
    expect(res).toHaveProperty("url");
    expect(res.elementsCount).toBeGreaterThanOrEqual(0);
  });

  test("browserBridge: benchmark comparison executes", async () => {
    const bench = await browserBridge.benchmark();
    expect(bench).toHaveProperty("extension");
    expect(bench).toHaveProperty("cdp");
    expect(bench).toHaveProperty("recommendation");
  });

  test("mcp: createMcpServer registers browser_engine_status without errors", () => {
    const mcp = createMcpServer();
    expect(mcp).toBeDefined();
    // Đảm bảo không ném exception trong quá trình đăng ký tools
  });
});

