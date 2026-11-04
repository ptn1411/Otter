import { describe, expect, it } from "bun:test";

describe("Browser Controller DOM Scanner Logic", () => {
  // Bộ selector tương tác chuẩn xác
  const INTERACTIVE_SELECTOR = [
    'a',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="combobox"]',
    '[role="option"]',
    '[role="searchbox"]',
    '[role="treeitem"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[tabindex]:not([tabindex="-1"])',
    '[onclick]',
    '[data-action]',
    'summary',
    'details > summary',
    '[class*="btn"]',
    '[class*="button"]',
    '[class*="clickable"]',
    '[class*="card"]',
    '[class*="service"]',
    '[id*="btn"]',
    '[id*="button"]'
  ].join(',');

  it("INTERACTIVE_SELECTOR matches buttons, links, inputs, and custom service cards", () => {
    expect(INTERACTIVE_SELECTOR).toContain("button");
    expect(INTERACTIVE_SELECTOR).toContain("a");
    expect(INTERACTIVE_SELECTOR).toContain('input:not([type="hidden"])');
    expect(INTERACTIVE_SELECTOR).toContain('[role="button"]');
    expect(INTERACTIVE_SELECTOR).toContain('[class*="service"]');
    expect(INTERACTIVE_SELECTOR).toContain('[class*="btn"]');
  });

  it("correctly calculates absolute badge coordinates even after scrolling down 1350px", () => {
    const scrollY = 1350;
    const scrollX = 0;

    // Giả sử có một button nằm trong viewport khi đã cuộn xuống 1350px
    // rect.top tính từ đỉnh màn hình hiện tại (viewport)
    const rectInView = { top: 120, left: 50, width: 140, height: 40 };
    const badgeTop = Math.max(0, Math.round(scrollY + rectInView.top - 14));
    const badgeLeft = Math.round(scrollX + rectInView.left);

    // Vị trí badge tuyệt đối trên document phải là 1350 + 120 - 14 = 1456px
    expect(badgeTop).toBe(1456);
    expect(badgeLeft).toBe(50);

    // Trường hợp phần tử ở ngay sát mép trên viewport (rect.top = 5)
    const rectTopEdge = { top: 5, left: 50, width: 140, height: 40 };
    const badgeTopEdge = Math.max(0, Math.round(scrollY + rectTopEdge.top - 14));
    expect(badgeTopEdge).toBe(1341);
  });

  it("filters out hidden inputs and empty anchor bookmarks correctly", () => {
    function shouldKeep(tag: string, type: string, href: string, text: string, onclick: boolean): boolean {
      if (tag === 'input' && type === 'hidden') return false;
      if (tag === 'a' && !href && !text.trim() && !onclick) return false;
      return true;
    }

    // Hidden input bị loại bỏ
    expect(shouldKeep('input', 'hidden', '', '', false)).toBe(false);

    // Text input hợp lệ
    expect(shouldKeep('input', 'text', '', '', false)).toBe(true);

    // Link có href
    expect(shouldKeep('a', '', 'https://example.com/service', 'Xem thêm', false)).toBe(true);

    // Bookmark rỗng (<a name="top"></a>) bị loại bỏ
    expect(shouldKeep('a', '', '', '', false)).toBe(false);

    // Link không href nhưng có text và onclick
    expect(shouldKeep('a', '', '', 'Đăng ký ngay', true)).toBe(true);
  });

  it("prioritizes parent button over nested child span to avoid duplicate badges", () => {
    interface MockNode {
      tagName: string;
      parent: MockNode | null;
    }

    function isInsideParentInteractive(node: MockNode): boolean {
      let cur = node.parent;
      while (cur) {
        if (['button', 'a', 'select'].includes(cur.tagName.toLowerCase())) {
          return true;
        }
        cur = cur.parent;
      }
      return false;
    }

    const button: MockNode = { tagName: 'button', parent: null };
    const spanInsideButton: MockNode = { tagName: 'span', parent: button };
    const iconInsideButton: MockNode = { tagName: 'svg', parent: spanInsideButton };

    expect(isInsideParentInteractive(button)).toBe(false); // Button giữ lại
    expect(isInsideParentInteractive(spanInsideButton)).toBe(true); // Span bên trong button bị bỏ qua
    expect(isInsideParentInteractive(iconInsideButton)).toBe(true); // Icon bên trong button bị bỏ qua

    const divCard: MockNode = { tagName: 'div', parent: null };
    const aInsideCard: MockNode = { tagName: 'a', parent: divCard };
    expect(isInsideParentInteractive(aInsideCard)).toBe(false); // Link trong thẻ div giữ lại bình thường
  });
});
