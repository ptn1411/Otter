/**
 * Auto Approval Module for ChatGPT Web
 * Automatically detects MCP tool permission dialogs and approves them for the current conversation.
 */

export function initAutoApproval() {
  const processedAlerts = new WeakSet<Element>();

  function normalize(str: string | null | undefined): string {
    return (str || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findToolName(container: Element): string | null {
    const text = (container.textContent || "").replace(/\s+/g, " ").trim();

    // Tiếng Việt: "cho phép ChatGPT sử dụng browser_read_page?"
    const matchVi = /(?:cho phép|yêu cầu sử dụng) chatgpt sử dụng\s+([a-zA-Z0-9_\-\.]+)/i.exec(text);
    if (matchVi?.[1]) return matchVi[1].trim();

    // Tiếng Anh: "Allow ChatGPT to use browser_read_page?"
    const matchEn = /(?:allow|permission for) chatgpt to use\s+([a-zA-Z0-9_\-\.]+)/i.exec(text);
    if (matchEn?.[1]) return matchEn[1].trim();

    // Mẫu tổng quát: "Cho phép browser_read_page?"
    const matchGeneric = /(?:allow|cho phép)\s+([a-zA-Z0-9_\-\.]+)\?/i.exec(text);
    if (matchGeneric?.[1]) return matchGeneric[1].trim();

    return null;
  }

  function findAllowOption(toolName: string): HTMLElement | null {
    const candidates = document.querySelectorAll<HTMLElement>(
      '[role^="menuitem"], [role="option"], [data-radix-collection-item], button'
    );
    const targetTool = normalize(toolName);

    for (const el of candidates) {
      if (!el.isConnected || el.offsetParent === null) continue;
      const text = normalize(el.getAttribute("aria-label") || el.textContent);

      const isAllowForConv =
        text.includes("allow " + targetTool + " for this conversation") ||
        text.includes("cho phép " + targetTool + " cho cuộc trò chuyện này") ||
        text.includes("cho phép " + targetTool + " trong cuộc trò chuyện này") ||
        text.includes("cho phép " + targetTool + " cho cuộc hội thoại này") ||
        text.includes("always allow") ||
        text.includes("luôn cho phép") ||
        (text.includes(targetTool) && (text.includes("for this conversation") || text.includes("cho cuộc trò chuyện này")));

      if (isAllowForConv) return el;
    }
    return null;
  }

  async function tryAutoApprove(alertEl: Element) {
    if (processedAlerts.has(alertEl)) return;

    const text = (alertEl.textContent || "").replace(/\s+/g, " ").trim();
    const toolName = findToolName(alertEl);
    const isActionOrToolDialog = !!toolName ||
      /(?:cho phép|allow|always allow|luôn cho phép|nói chuyện với|talk to|otter\.gpt\.io\.vn)/i.test(text);

    if (!isActionOrToolDialog) return;

    processedAlerts.add(alertEl);
    console.log(`[Otter Auto-Approval] Detected tool/action confirmation: "${toolName || text.slice(0, 50)}"`);

    // 1. Tìm nút dropdown mở menu lựa chọn quyền (nếu có toolName cụ thể)
    const dropdownTrigger = alertEl.querySelector<HTMLElement>('button[aria-haspopup="menu"], button[data-state]');
    if (dropdownTrigger && toolName) {
      dropdownTrigger.click();
      await new Promise(r => setTimeout(r, 120));

      const option = findAllowOption(toolName);
      if (option) {
        option.click();
        console.log(`[Otter Auto-Approval] ✅ Auto-approved "${toolName}" for this conversation.`);
        return;
      }
    }

    // 2. Tìm nút "Luôn cho phép" / "Always allow" trực tiếp trước (để không bị hỏi lại làm gián đoạn)
    const directButtons = Array.from(alertEl.querySelectorAll<HTMLButtonElement>("button"));
    for (const btn of directButtons) {
      const txt = normalize(btn.textContent);
      if (txt.includes("always allow") || txt.includes("luôn cho phép")) {
        btn.click();
        console.log(`[Otter Auto-Approval] ✅ Clicked "Always allow" button to prevent future interruptions.`);
        return;
      }
    }

    // 3. Nếu không có "Luôn cho phép", tìm nút "Cho phép" / "Allow" thông thường
    for (const btn of directButtons) {
      const txt = normalize(btn.textContent);
      if (
        txt === "cho phép" ||
        txt === "allow" ||
        txt.includes("cho phép lần này") ||
        txt.includes("allow this time")
      ) {
        btn.click();
        console.log(`[Otter Auto-Approval] ✅ Clicked allow button directly.`);
        return;
      }
    }
  }

  function scanAndApprove() {
    const dialogs = document.querySelectorAll(
      '[role="alert"], [role="dialog"], [role="alertdialog"], [data-radix-dialog-content], [data-state="open"]'
    );
    for (const d of dialogs) {
      tryAutoApprove(d);
    }
  }

  // Giám sát DOM bằng MutationObserver có debounce để tránh nghẽn thread khi ChatGPT đang stream tin nhắn
  let debounceTimer: any = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      scanAndApprove();
    }, 150);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Quét ngay lập tức khi khởi tạo
  scanAndApprove();

  console.log("[Otter Auto-Approval] Active & listening for tool permission modals");
}
