/**
 * Otter CDP Bridge (Chrome DevTools Protocol)
 * 
 * Động cơ điều khiển trình duyệt trực tiếp qua CDP (Port 9222 / GPM Login / Chrome Remote Debugging):
 * - Không phụ thuộc vào Chrome Extension hay Service Worker Manifest V3.
 * - Chạy trực tiếp qua WebSocket của Chromium C++ Core.
 * - Tương thích 100% với profile trình duyệt thật (GPM Login, Antidetect, Chrome User Data).
 * - Cung cấp chuẩn dữ liệu { title, url, tabId, elements, elementsCount, summaryText } đồng nhất với BrowserController.
 */

export interface CdpTab {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
  devtoolsFrontendUrl?: string;
}

export class CdpBridge {
  private defaultPort: number;

  constructor(defaultPort = 9222) {
    this.defaultPort = process.env.OTTER_CDP_PORT ? Number(process.env.OTTER_CDP_PORT) : defaultPort;
  }

  /**
   * Cổng CDP hiện tại
   */
  getPort(): number {
    return this.defaultPort;
  }

  /**
   * Đặt cổng CDP tùy chỉnh
   */
  setPort(port: number): void {
    this.defaultPort = port;
  }

  /**
   * Kiểm tra xem cổng CDP có đang mở và sẵn sàng không
   */
  async isAvailable(port?: number): Promise<boolean> {
    const targetPort = port || this.defaultPort;
    try {
      const res = await fetch(`http://127.0.0.1:${targetPort}/json/version`, {
        signal: AbortSignal.timeout(1500)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Tự động khởi động đúng profile GPM Login nếu cổng CDP chưa mở
   */
  async ensureProfileRunning(profileId?: string, port?: number): Promise<boolean> {
    const targetPort = port || this.defaultPort;
    if (await this.isAvailable(targetPort)) return true;

    const targetProfile = profileId || process.env.OTTER_GPM_PROFILE_ID || "64b20c37-715c-4f4c-897c-fbbac828e8bf";
    const gpmPort = process.env.OTTER_GPM_PORT ? Number(process.env.OTTER_GPM_PORT) : 9495;

    try {
      console.log(`[CDP Bridge] Cổng ${targetPort} chưa mở. Đang tự động gọi GPM Login API để khởi động profile ${targetProfile}...`);
      const res = await fetch(`http://127.0.0.1:${gpmPort}/api/v1/profiles/start/${targetProfile}?remote_debugging_port=${targetPort}`, {
        signal: AbortSignal.timeout(12000)
      });
      const data = await res.json() as any;
      if (data.success || data.message === "ProfileInUse") {
        await new Promise(r => setTimeout(r, 2000));
        return await this.isAvailable(targetPort);
      }
    } catch (err: any) {
      console.warn(`[CDP Bridge] Không thể tự động bật profile qua GPM API: ${err.message}`);
    }

    return false;
  }

  /**
   * Lấy danh sách tất cả các tab đang mở
   */
  async getTabs(port?: number): Promise<CdpTab[]> {
    const targetPort = port || this.defaultPort;
    if (!(await this.isAvailable(targetPort))) {
      await this.ensureProfileRunning(undefined, targetPort);
    }
    const res = await fetch(`http://127.0.0.1:${targetPort}/json`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) throw new Error(`Không thể lấy danh sách tab từ CDP port ${targetPort}`);
    return (await res.json()) as CdpTab[];
  }

  /**
   * Tìm tab phù hợp (ưu tiên theo urlPattern hoặc tab page đầu tiên)
   */
  async findTargetTab(urlPattern?: string, port?: number): Promise<CdpTab> {
    const tabs = await this.getTabs(port);
    const pageTabs = tabs.filter(t => t.type === "page" && t.webSocketDebuggerUrl);

    if (pageTabs.length === 0) {
      throw new Error("Không tìm thấy tab trang web (type=page) nào đang mở trong trình duyệt CDP.");
    }

    if (urlPattern) {
      const matched = pageTabs.find(t => t.url.toLowerCase().includes(urlPattern.toLowerCase()) || t.title.toLowerCase().includes(urlPattern.toLowerCase()));
      if (matched) return matched;
    }

    return pageTabs[0];
  }

  /**
   * Gửi một lệnh CDP qua WebSocket tới một tab cụ thể và nhận kết quả
   */
  async sendCommand(wsUrl: string, method: string, params: any = {}, timeoutMs = 20000): Promise<any> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket | null = null;
      let timer: any = null;
      const cmdId = Math.floor(Math.random() * 1000000) + 1;

      timer = setTimeout(() => {
        if (ws) {
          try { ws.close(); } catch { }
        }
        reject(new Error(`Lệnh CDP '${method}' bị quá hạn (timeout sau ${timeoutMs / 1000}s)`));
      }, timeoutMs);

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          ws!.send(JSON.stringify({
            id: cmdId,
            method,
            params
          }));
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.id === cmdId) {
              clearTimeout(timer);
              ws!.close();
              if (data.error) {
                reject(new Error(`Lỗi CDP [${method}]: ${data.error.message || JSON.stringify(data.error)}`));
              } else {
                resolve(data.result);
              }
            }
          } catch (err) {
            clearTimeout(timer);
            ws?.close();
            reject(err);
          }
        };

        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Chạy biểu thức JavaScript trong ngữ cảnh của tab
   */
  async evaluateJs(wsUrl: string, expression: string, awaitPromise = true, timeoutMs = 20000): Promise<any> {
    const res = await this.sendCommand(wsUrl, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise
    }, timeoutMs);

    const val = res?.result?.value;
    if (res?.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
      throw new Error(`Lỗi JS thực thi trên trang: ${desc}`);
    }
    return val;
  }

  /**
   * Mở URL mới hoặc điều hướng tab hiện tại
   */
  async openUrl(url: string, port?: number): Promise<{ ok: boolean; tabId: string; title: string; url: string }> {
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl) && !/^chrome:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    const targetPort = port || this.defaultPort;
    let targetTab: CdpTab | null = null;
    try {
      targetTab = await this.findTargetTab(undefined, targetPort);
    } catch { }

    if (targetTab && targetTab.webSocketDebuggerUrl) {
      await this.sendCommand(targetTab.webSocketDebuggerUrl, "Page.navigate", { url: targetUrl });
      // Chờ trang tải sơ bộ
      await new Promise(r => setTimeout(r, 1500));
      return {
        ok: true,
        tabId: targetTab.id,
        title: targetTab.title,
        url: targetUrl
      };
    }

    // Nếu chưa có tab, mở tab mới qua CDP REST API
    const newTabRes = await fetch(`http://127.0.0.1:${targetPort}/json/new?${encodeURIComponent(targetUrl)}`, {
      method: "PUT"
    });
    const newTab = (await newTabRes.json()) as CdpTab;
    await new Promise(r => setTimeout(r, 1500));
    return {
      ok: true,
      tabId: newTab.id,
      title: newTab.title,
      url: newTab.url || targetUrl
    };
  }

  /**
   * Đọc cấu trúc trang hiện tại (Trích xuất interactive elements, đánh số [1], [2]...)
   */
  async readPage(urlPattern?: string, port?: number): Promise<any> {
    const tab = await this.findTargetTab(urlPattern, port);
    if (!tab.webSocketDebuggerUrl) throw new Error("Tab không có webSocketDebuggerUrl hợp lệ");

    const extractionScript = `(() => {
      const INTERACTIVE_SELECTOR = [
        'a', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
        '[role="switch"]', '[role="tab"]', '[role="menuitem"]', '[role="combobox"]',
        '[role="option"]', '[role="searchbox"]', '[role="textbox"]', '[role="treeitem"]',
        '[contenteditable="true"]', '[contenteditable=""]', '[tabindex]:not([tabindex="-1"])',
        '[onclick]', '[data-action]', 'summary', '[class*="btn"]', '[class*="button"]'
      ].join(',');

      function collectCandidates(root, list = [], depth = 0) {
        if (!root || depth > 8 || list.length >= 500) return list;
        try {
          const matches = root.querySelectorAll(INTERACTIVE_SELECTOR);
          for (const el of matches) {
            if (list.length >= 500) break;
            if (el instanceof HTMLElement) list.push(el);
          }
        } catch (e) {}

        try {
          const allNodes = root.querySelectorAll('*');
          for (const node of allNodes) {
            if (list.length >= 500) break;
            if (node.shadowRoot) collectCandidates(node.shadowRoot, list, depth + 1);
          }
        } catch (e) {}
        return list;
      }

      function isElementVisible(el) {
        if (typeof el.checkVisibility === 'function') {
          if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }

      const vHeight = window.innerHeight;
      const vWidth = window.innerWidth;
      const rawCandidates = collectCandidates(document);
      const seen = new Set();
      const inView = [];
      const outView = [];

      for (const el of rawCandidates) {
        if (seen.has(el)) continue;
        seen.add(el);

        const tag = el.tagName.toLowerCase();
        if (tag === 'input' && el.type === 'hidden') continue;
        if (['script', 'style', 'noscript', 'template', 'meta', 'link'].includes(tag)) continue;
        if (el.parentElement && el.parentElement.closest('button, a, select')) continue;
        if (!isElementVisible(el)) continue;

        const rect = el.getBoundingClientRect();
        const isInView = rect.top < vHeight && rect.bottom > 0 && rect.left < vWidth && rect.right > 0;
        if (isInView) {
          inView.push({ el, rect, isInView: true });
        } else if (outView.length < 25) {
          outView.push({ el, rect, isInView: false });
        }
      }

      const finalSelection = [...inView.slice(0, 45), ...outView.slice(0, 15)];
      window.__otter_elements = finalSelection.map(item => item.el);

      const elementsData = finalSelection.map((item, idx) => {
        const index = idx + 1;
        const { el, rect, isInView } = item;
        const tagName = el.tagName.toLowerCase();
        const type = el.type || '';
        const placeholder = el.placeholder || '';
        const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
        const href = el.href || '';
        let text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
        if (!text && ariaLabel) text = ariaLabel;
        if (!text && placeholder) text = placeholder;
        if (text.length > 70) text = text.slice(0, 67) + '...';

        return {
          index,
          tagName,
          type,
          text,
          value: el.value || '',
          placeholder,
          ariaLabel,
          href: href && !href.startsWith('javascript:') ? href : '',
          inView: isInView,
          coords: {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2)
          }
        };
      });

      let summaryText = (document.body?.innerText || '')
        .replace(/\\n{3,}/g, '\\n\\n')
        .slice(0, 1200)
        .trim();

      return {
        title: document.title,
        url: location.href,
        elements: elementsData,
        elementsCount: elementsData.length,
        summaryText
      };
    })()`;

    const res = await this.evaluateJs(tab.webSocketDebuggerUrl, extractionScript);
    return {
      ...res,
      tabId: tab.id
    };
  }

  /**
   * Bấm vào phần tử theo index
   */
  async click(index: number, urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);
    if (!tab.webSocketDebuggerUrl) throw new Error("Tab không có webSocketDebuggerUrl hợp lệ");

    const clickScript = `(() => {
      const idx = ${index} - 1;
      const elements = window.__otter_elements || [];
      const target = elements[idx] || document.querySelector('[data-otter-index="${index}"]');
      if (!target) return { ok: false, error: 'Không tìm thấy phần tử index [' + ${index} + ']' };

      target.scrollIntoView({ behavior: 'instant', block: 'center' });
      target.focus();

      ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(evtType => {
        target.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window }));
      });
      return { ok: true, text: (target.innerText || target.value || target.tagName).slice(0, 30) };
    })()`;

    const res = await this.evaluateJs(tab.webSocketDebuggerUrl, clickScript);
    if (!res.ok) throw new Error(res.error || `Click thất bại tại index [${index}]`);
    return {
      ok: true,
      message: `Đã click vào phần tử [${index}] (${res.text}) qua CDP thành công`
    };
  }

  /**
   * Nhập văn bản vào ô input theo index
   */
  async type(index: number, text: string, pressEnter = false, urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);
    if (!tab.webSocketDebuggerUrl) throw new Error("Tab không có webSocketDebuggerUrl hợp lệ");

    const safeText = JSON.stringify(text);
    const typeScript = `(() => {
      const idx = ${index} - 1;
      const elements = window.__otter_elements || [];
      const target = elements[idx] || document.querySelector('[data-otter-index="${index}"]');
      if (!target) return { ok: false, error: 'Không tìm thấy phần tử index [' + ${index} + ']' };

      target.scrollIntoView({ behavior: 'instant', block: 'center' });
      target.focus();

      if ('value' in target) {
        target.value = ${safeText};
      } else {
        target.innerText = ${safeText};
      }

      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));

      if (${pressEnter}) {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      }

      return { ok: true };
    })()`;

    const res = await this.evaluateJs(tab.webSocketDebuggerUrl, typeScript);
    if (!res.ok) throw new Error(res.error || `Nhập văn bản thất bại tại index [${index}]`);
    return {
      ok: true,
      message: `Đã nhập "${text}" vào phần tử [${index}]${pressEnter ? " và ấn Enter" : ""} qua CDP thành công`
    };
  }

  /**
   * Cuộn trang
   */
  async scroll(direction: "up" | "down", amount = 600, urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);
    if (!tab.webSocketDebuggerUrl) throw new Error("Tab không có webSocketDebuggerUrl hợp lệ");

    const scrollY = direction === "up" ? -amount : amount;
    await this.evaluateJs(tab.webSocketDebuggerUrl, `window.scrollBy({ top: ${scrollY}, behavior: 'smooth' })`);
    return {
      ok: true,
      message: `Đã cuộn trang sang hướng ${direction} ${amount}px qua CDP`
    };
  }

  /**
   * Quay lại trang trước
   */
  async back(urlPattern?: string, port?: number): Promise<{ ok: boolean; message: string }> {
    const tab = await this.findTargetTab(urlPattern, port);
    if (!tab.webSocketDebuggerUrl) throw new Error("Tab không có webSocketDebuggerUrl hợp lệ");

    await this.evaluateJs(tab.webSocketDebuggerUrl, `window.history.back()`);
    return {
      ok: true,
      message: `Đã quay lại trang trước qua CDP`
    };
  }

  /**
   * Liệt kê danh sách tabs
   */
  async listTabs(port?: number): Promise<{ ok: boolean; tabs: any[] }> {
    const tabs = await this.getTabs(port);
    const pages = tabs.filter(t => t.type === "page").map(t => ({
      id: t.id,
      title: t.title,
      url: t.url,
      isControlled: true,
      active: true
    }));
    return { ok: true, tabs: pages };
  }

  /**
   * Đóng một tab
   */
  async closeTab(tabId?: string | number, port?: number): Promise<{ ok: boolean; message: string }> {
    const targetPort = port || this.defaultPort;
    const targetId = tabId ? String(tabId) : (await this.findTargetTab(undefined, targetPort)).id;
    const res = await fetch(`http://127.0.0.1:${targetPort}/json/close/${targetId}`, { method: "PUT" });
    return {
      ok: res.ok,
      message: res.ok ? `Đã đóng tab [${targetId}] qua CDP thành công` : `Không thể đóng tab [${targetId}] qua CDP`
    };
  }

  /**
   * Chuyển tab điều khiển (bring to front)
   */
  async switchTab(tabId: string | number, port?: number): Promise<{ ok: boolean; message: string }> {
    const targetPort = port || this.defaultPort;
    const res = await fetch(`http://127.0.0.1:${targetPort}/json/activate/${tabId}`, { method: "PUT" });
    return {
      ok: res.ok,
      message: res.ok ? `Đã kích hoạt tab [${tabId}] qua CDP thành công` : `Không thể kích hoạt tab [${tabId}] qua CDP`
    };
  }

  /**
   * Đo đạc độ trễ phản hồi của CDP (Benchmark latency)
   */
  async benchmark(rounds = 3, port?: number): Promise<{ available: boolean; averageLatencyMs: number; error?: string }> {
    const targetPort = port || this.defaultPort;
    if (!(await this.isAvailable(targetPort))) {
      return { available: false, averageLatencyMs: -1, error: `Cổng CDP ${targetPort} không phản hồi` };
    }

    try {
      const tab = await this.findTargetTab(undefined, targetPort);
      if (!tab.webSocketDebuggerUrl) return { available: false, averageLatencyMs: -1, error: "Không có WebSocket URL" };

      const latencies: number[] = [];
      for (let i = 0; i < rounds; i++) {
        const start = performance.now();
        await this.evaluateJs(tab.webSocketDebuggerUrl, "1 + 1", false, 3000);
        latencies.push(performance.now() - start);
      }

      const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      return { available: true, averageLatencyMs: avg };
    } catch (err: any) {
      return { available: false, averageLatencyMs: -1, error: err.message };
    }
  }

  /**
   * Unified dispatcher thực thi các lệnh hành động giống như BrowserBridge
   */
  async execute(action: string, params: any = {}): Promise<any> {
    switch (action) {
      case "open":
        return this.openUrl(params.url);
      case "read_page":
        return this.readPage(params.urlPattern);
      case "click":
        return this.click(params.index, params.urlPattern);
      case "type":
        return this.type(params.index, params.text, params.pressEnter, params.urlPattern);
      case "scroll":
        return this.scroll(params.direction, params.amount, params.urlPattern);
      case "back":
        return this.back(params.urlPattern);
      case "list_tabs":
        return this.listTabs();
      case "switch_tab":
        return this.switchTab(params.tabId);
      case "close_tab":
        return this.closeTab(params.tabId);
      case "reload_extension":
        return { ok: true, message: "CDP không sử dụng Chrome Extension nên không cần reload." };
      default:
        throw new Error(`Hành động '${action}' chưa được hỗ trợ bởi CDP Bridge.`);
    }
  }
}

export const cdpBridge = new CdpBridge();

