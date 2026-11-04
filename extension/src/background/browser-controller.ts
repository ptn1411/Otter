/**
 * Otter Advanced Browser Controller
 * 
 * Nâng cấp toàn diện theo chuẩn Core của Alibaba Page Agent (packages/page-controller):
 * 1. Chuỗi sự kiện Pointer/Mouse W3C đầy đủ + Hit-testing tọa độ elementFromPoint
 * 2. Thuật toán Input chuyên sâu với getNativeValueSetter (React 17/18 bypass) + ContentEditable
 * 3. Hỗ trợ thao tác Dropdown <select> (selectOption)
 * 4. Quét sâu Shadow DOM, phát hiện ARIA roles, click handlers, cursor: pointer
 * 5. Lọc Viewport & nén văn bản DOM tối ưu token cho LLM
 * 6. Visual Masking: Gắn badge số [1], [2] trực quan theo chuẩn Alibaba
 */

let controlledTabId: number | null = null;

try {
  chrome.storage?.session?.get("controlledTabId", (res: any) => {
    if (res?.controlledTabId) {
      controlledTabId = res.controlledTabId;
    }
  });
} catch {}

export class BrowserController {
  /**
   * Mở hoặc chuyển hướng tab đang điều khiển
   */
  static async openUrl(url: string): Promise<{ ok: boolean; tabId: number; title: string; url: string }> {
    let targetUrl = url.trim();
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://") && !targetUrl.startsWith("chrome-extension://") && !targetUrl.startsWith("chrome://")) {
      targetUrl = "https://" + targetUrl;
    }

    let tab: chrome.tabs.Tab | null = null;

    if (controlledTabId) {
      try {
        tab = await chrome.tabs.get(controlledTabId);
      } catch {
        controlledTabId = null;
      }
    }

    if (controlledTabId && tab) {
      tab = await chrome.tabs.update(controlledTabId, { url: targetUrl, active: true });
    } else {
      tab = await chrome.tabs.create({ url: targetUrl, active: true });
      controlledTabId = tab.id || null;
    }

    if (!controlledTabId) {
      throw new Error("Không thể khởi tạo tab điều khiển");
    }

    await this.waitForTabLoaded(controlledTabId, targetUrl);

    const updatedTab = (await chrome.tabs.get(controlledTabId).catch(() => null)) || tab;
    return {
      ok: true,
      tabId: controlledTabId,
      title: updatedTab?.title || "",
      url: updatedTab?.url || targetUrl
    };
  }

  /**
   * Đọc cấu trúc trang hiện tại theo thuật toán nén DOM của Alibaba Page Agent
   */
  static async readPage(preferredUrlPattern?: string): Promise<any> {
    const tabId = await this.ensureControlledTab(preferredUrlPattern);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // --- 1. Bộ selector nhận diện phần tử tương tác (Interactive Elements) toàn diện ---
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
          '[role="textbox"]',
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

        // --- 2. Thuật toán thu thập phần tử tương tác xuyên qua DOM và Shadow DOM (YouTube, Web Components) ---
        function collectCandidates(root: Document | ShadowRoot | Element, list: HTMLElement[] = [], depth = 0): HTMLElement[] {
          if (!root || depth > 10 || list.length >= 1000) return list;

          // 2.1. Native querySelectorAll trên root (siêu tốc Blink C++ engine, duyệt mọi độ sâu DOM)
          try {
            const matches = root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
            for (const el of matches) {
              if (list.length >= 1000) break;
              if (el instanceof HTMLElement) {
                list.push(el);
              }
            }
          } catch {}

          // 2.2. Tìm kiếm các thẻ Web Components hoặc phần tử có ShadowRoot để đệ quy vào trong Shadow DOM
          try {
            const allNodes = root.querySelectorAll('*');
            for (const node of allNodes) {
              if (list.length >= 1000) break;
              if (node.shadowRoot) {
                collectCandidates(node.shadowRoot, list, depth + 1);
              }
            }
          } catch {}

          return list;
        }

        const rawCandidates = collectCandidates(document);

        // --- 3. Lọc phần tử hợp lệ, kiểm tra hiển thị (Visibility) và loại bỏ trùng lặp con ---
        function isElementVisible(el: HTMLElement): boolean {
          if (typeof el.checkVisibility === 'function') {
            if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
              return false;
            }
          }
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          return true;
        }

        const vHeight = window.innerHeight;
        const vWidth = window.innerWidth;
        const seenElements = new Set<HTMLElement>();

        interface FilteredElement {
          el: HTMLElement;
          rect: DOMRect;
          isInView: boolean;
        }

        const inViewList: FilteredElement[] = [];
        const outViewList: FilteredElement[] = [];

        for (const el of rawCandidates) {
          if (seenElements.has(el)) continue;
          seenElements.add(el);

          // Bỏ qua các thẻ ẩn hoặc thẻ kỹ thuật
          const tag = el.tagName.toLowerCase();
          if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') continue;
          if (['script', 'style', 'noscript', 'template', 'meta', 'link'].includes(tag)) continue;

          // Bỏ qua bookmark anchor rỗng không có href và không có text/onclick
          if (tag === 'a' && !(el as HTMLAnchorElement).href && !el.innerText?.trim() && !el.getAttribute('onclick') && !el.getAttribute('role')) {
            continue;
          }

          // Tránh gắn badge trùng lặp cho các node con bên trong button / link / select đã được nhận diện
          if (el.parentElement?.closest('button, a, select')) {
            continue;
          }

          if (!isElementVisible(el)) continue;

          const rect = el.getBoundingClientRect();
          const isInView = rect.top < vHeight && rect.bottom > 0 && rect.left < vWidth && rect.right > 0;

          if (isInView) {
            inViewList.push({ el, rect, isInView: true });
          } else if (outViewList.length < 35) {
            outViewList.push({ el, rect, isInView: false });
          }
        }

        // Đảm bảo ô nhập tin nhắn Messenger luôn được nhận diện và xếp vào inViewList
        const chatInputEl = document.querySelector<HTMLElement>('div[role="textbox"][aria-label*="Viết cho"], div[role="textbox"][aria-label*="Message"]');
        if (chatInputEl && !seenElements.has(chatInputEl)) {
          seenElements.add(chatInputEl);
          inViewList.unshift({ el: chatInputEl, rect: chatInputEl.getBoundingClientRect(), isInView: true });
        }

        // Ưu tiên sắp xếp inViewList: nếu có dialog/modal hoặc khung chat Messenger đang mở thì đưa toàn bộ phần tử chat lên đầu
        const activeDialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [aria-modal="true"]:not([aria-hidden="true"]), [role="region"][aria-label*="Đoạn chat"], [data-pagelet*="ChatTab"]');
        const chatDock = chatInputEl ? (chatInputEl.closest('[role="region"], div[data-pagelet*="ChatTab"]') || chatInputEl.parentElement?.parentElement?.parentElement) : null;

        if (activeDialog || chatDock) {
          inViewList.sort((a, b) => {
            const inChatA = (activeDialog?.contains(a.el) || chatDock?.contains(a.el) || a.el === chatInputEl) ? 0 : 1;
            const inChatB = (activeDialog?.contains(b.el) || chatDock?.contains(b.el) || b.el === chatInputEl) ? 0 : 1;
            if (inChatA !== inChatB) return inChatA - inChatB;
            return a.rect.top - b.rect.top || a.rect.left - b.rect.left;
          });
        } else {
          inViewList.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
        }

        // Lấy tối đa 50 phần tử trong viewport + 15 phần tử ngoài viewport (Tổng tối đa 65 phần tử tối ưu token)
        const finalSelection = [...inViewList.slice(0, 50), ...outViewList.slice(0, 15)];
        const interactiveElements = finalSelection.map(item => item.el);

        // Lưu vào window map cho các lệnh click / type / select tiếp theo
        (window as any).__otter_elements = interactiveElements;
        (window as any).__chatmcp_elements = interactiveElements;

        // Đánh dấu data-otter-index trên DOM để thế giới MAIN world có thể truy cập trực tiếp
        try {
          document.querySelectorAll('[data-otter-index]').forEach(node => node.removeAttribute('data-otter-index'));
          finalSelection.forEach((item, idx) => {
            try { item.el.setAttribute('data-otter-index', String(idx + 1)); } catch {}
          });
        } catch {}

        // --- 4. Gắn Visual Badge chuẩn tọa độ document (kể cả sau khi cuộn trang) ---
        const CONTAINER_ID = 'otter-badges-container';
        document.getElementById(CONTAINER_ID)?.remove();
        document.getElementById('chatmcp-badges-container')?.remove();

        const badgeContainer = document.createElement('div');
        badgeContainer.id = CONTAINER_ID;
        badgeContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483647;';

        const pageScrollX = window.scrollX || window.pageXOffset || document.documentElement.scrollLeft || 0;
        const pageScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

        const elementsData = finalSelection.map((item, idx) => {
          const index = idx + 1;
          const { el, rect, isInView } = item;

          const tagName = el.tagName.toLowerCase();
          const type = (el as HTMLInputElement).type || '';
          const placeholder = (el as HTMLInputElement).placeholder || '';
          const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || '';
          const href = (el as HTMLAnchorElement).href || '';

          let text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
          if (!text && ariaLabel) text = ariaLabel;
          if (!text && (el as HTMLImageElement).alt) text = (el as HTMLImageElement).alt;
          if (!text && placeholder) text = placeholder;
          if (text.length > 70) text = text.slice(0, 67) + '...';

          let value = (el as HTMLInputElement).value || '';
          if (value.length > 40) value = value.slice(0, 37) + '...';

          // Gắn badge visual chính xác theo vị trí cuộn trang (Absolute Document Coordinates)
          const badge = document.createElement('div');
          badge.className = 'otter-alibaba-badge chatmcp-alibaba-badge';
          badge.textContent = `${index}`;
          badge.style.cssText = `
            position: absolute;
            left: ${Math.round(pageScrollX + rect.left)}px;
            top: ${Math.max(0, Math.round(pageScrollY + rect.top - 14))}px;
            background: #e11d48;
            color: #ffffff;
            font-size: 11px;
            font-family: ui-monospace, SFMono-Regular, monospace;
            font-weight: 700;
            line-height: 1;
            padding: 2px 4px;
            border-radius: 3px;
            pointer-events: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.8);
          `;
          badgeContainer.appendChild(badge);

          return {
            index,
            tagName,
            type: type || undefined,
            text: text || undefined,
            value: value || undefined,
            placeholder: placeholder || undefined,
            ariaLabel: ariaLabel || undefined,
            href: href || undefined,
            inView: isInView
          };
        });

        // Chỉ append container 1 lần duy nhất vào body
        document.body.appendChild(badgeContainer);

        // --- 5. Trích xuất nâng cao cho Facebook Feed (nếu là facebook.com) ---
        let fbSummary = '';
        let fbPosts: any[] = [];
        const isFacebook = location.hostname.includes('facebook.com');

        if (isFacebook) {
          try {
            const indexOfInteractive = (el: HTMLElement | null): number | null => {
              if (!el) return null;
              let idx = interactiveElements.indexOf(el);
              if (idx >= 0) return idx + 1;
              let p = el.parentElement;
              while (p) {
                idx = interactiveElements.indexOf(p);
                if (idx >= 0) return idx + 1;
                p = p.parentElement;
              }
              return null;
            };

            const cleanStr = (s: string): string => (s || '').trim().replace(/\s+/g, ' ');

            const likeButtons = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"]'))
              .filter(el => {
                const aria = el.getAttribute('aria-label') || '';
                return aria.startsWith('Bày tỏ cảm xúc Thích về bài viết của') ||
                       aria.startsWith('Bày tỏ cảm xúc về bài viết của') ||
                       aria.startsWith('Gỡ Thích khỏi bài viết của');
              });

            const seenAuthors = new Set<string>();

            for (const likeBtn of likeButtons) {
              const aria = likeBtn.getAttribute('aria-label') || '';
              const author = aria
                .replace(/^Bày tỏ cảm xúc Thích về bài viết của\s*/, '')
                .replace(/^Bày tỏ cảm xúc về bài viết của\s*/, '')
                .replace(/^Gỡ Thích khỏi bài viết của\s*/, '')
                .trim();

              if (!author || seenAuthors.has(author)) continue;
              seenAuthors.add(author);

              const isLiked = aria.startsWith('Gỡ Thích') || (likeBtn.innerText || '').includes('Đã thích');

              let cur = likeBtn.parentElement;
              let bestContainer: HTMLElement | null = null;
              while (cur && cur.tagName !== 'BODY' && cur.getAttribute('role') !== 'main') {
                const hasAuthor = Array.from(cur.querySelectorAll('a, strong, span')).some(s => (s.textContent || '').includes(author));
                const hasLike = cur.contains(likeBtn);
                if (hasAuthor && hasLike) {
                  bestContainer = cur;
                  const likeCount = cur.querySelectorAll('div[role="button"][aria-label*="Bày tỏ cảm xúc"]').length;
                  if (likeCount === 1) break;
                }
                cur = cur.parentElement;
              }

              if (!bestContainer) bestContainer = likeBtn.parentElement?.parentElement?.parentElement || null;

              const rawText = bestContainer ? (bestContainer.innerText || '') : '';
              const isSponsored = rawText.includes('Được tài trợ') || rawText.includes('Sponsored');

              const commentBtn = bestContainer ? bestContainer.querySelector<HTMLElement>(
                'div[role="button"][aria-label*="Bình luận"], div[role="button"][aria-label*="Comment"]'
              ) : null;

              // Lọc bỏ sạch sẽ các dòng rác (Facebook lặp lại, chỉ báo trạng thái, rác font r͏e͏p͏...)
              const textLines = rawText.split('\n')
                .map(l => cleanStr(l))
                .filter(l => {
                  if (!l || l.length < 2) return false;
                  if (l === 'Facebook' || /^Facebook(\s+Facebook)+$/i.test(l)) return false;
                  if (l.includes('Chỉ báo trạng thái') || l.startsWith('Thích:') || l.startsWith('Yêu thích:')) return false;
                  if (/[r͏|e͏|p͏|d͏|n͏|s͏|t͏]{4,}/.test(l) || /r[\s\S]{0,2}e[\s\S]{0,2}p[\s\S]{0,2}d/i.test(l)) return false;
                  return true;
                });

              // Bỏ dòng tên tác giả ở đầu nếu trùng
              const contentLines = textLines.filter(l => l !== author && l !== 'Bài viết trên Bảng feed' && !l.endsWith('phút trước') && !l.endsWith('giờ trước'));
              const textSnippet = contentLines.slice(0, 8).join('\n') || textLines.slice(0, 5).join('\n');

              const isSelf = author === 'Nhân Văn Sùng';

              const postData = {
                author,
                isSelf,
                textSnippet,
                isSponsored,
                isLiked,
                likeIndex: indexOfInteractive(likeBtn),
                commentIndex: indexOfInteractive(commentBtn)
              };
              fbPosts.push(postData);
            }

            if (fbPosts.length > 0) {
              fbSummary = '=== DANH SÁCH BÀI VIẾT FACEBOOK FEED TRÊN MÀN HÌNH ===\n' +
                fbPosts.map((p, i) => {
                  const note = p.isSelf ? ' [BÀI CỦA BẠN - KHÔNG TƯƠNG TÁC]' : p.isSponsored ? ' [QUẢNG CÁO]' : '';
                  return `[Bài ${i + 1}] Tác giả: ${p.author}${note}\n` +
                    `- Trạng thái: ${p.isLiked ? 'ĐÃ THÍCH' : 'CHƯA THÍCH'}\n` +
                    `- Thao tác: Bấm Thích -> browser_click({ index: ${p.likeIndex || 'n/a'} })${p.commentIndex ? ` | Bấm Bình luận -> browser_click({ index: ${p.commentIndex} })` : ''}\n` +
                    `- Nội dung bài viết:\n${p.textSnippet}\n`;
                }).join('\n----------------------------------------\n') + '\n\n';
            }
          } catch (fbErr) {
            console.warn('[readPage] Facebook feed extraction error:', fbErr);
          }
        }

        // --- 5.1. Trích xuất tin nhắn Messenger & Thông báo Facebook ---
        let messengerSummary = '';
        let notificationsSummary = '';
        if (isFacebook) {
          try {
            const chatBoxEl = document.querySelector<HTMLElement>('div[role="textbox"][aria-label*="Viết cho"], div[role="textbox"][aria-label*="Message"]');
            const msgLogEl = document.querySelector('[role="log"][aria-label*="Tin nhắn trong cuộc trò chuyện"]');
            if (chatBoxEl || msgLogEl) {
              const recipient = (chatBoxEl?.getAttribute('aria-label') || '').replace(/^Viết cho\s*/i, '').trim() ||
                                (msgLogEl?.getAttribute('aria-label') || '').replace(/^Tin nhắn trong cuộc trò chuyện với\s*/i, '').trim() || 'Người dùng';

              const msgArias = Array.from(document.querySelectorAll('[aria-label*="Lúc "][aria-label*=": "]'))
                .map(el => el.getAttribute('aria-label') || '')
                .filter(a => a.length > 5);

              const lastMsgs = msgArias.slice(-15).map(m =>
                m.replace(/^Lúc\s+[^,]+,\s*/i, '').replace(/^Lúc\s+\d{2}:\d{2},\s*/i, '')
              ).join('\n  ');

              const inputIdx = chatBoxEl ? (interactiveElements.indexOf(chatBoxEl) + 1 || null) : null;

              messengerSummary = `=== KHUNG CHAT TIN NHẮN MESSENGER ĐANG MỞ ===\n` +
                `- Đang nhắn tin với: ${recipient}\n` +
                `- Tin nhắn trong cuộc trò chuyện:\n  ${lastMsgs || '(Chưa có tin nhắn cũ hoặc tin chào tự động)'}\n` +
                `- Ô nhập tin nhắn trả lời: browser_type({ index: ${inputIdx || 'n/a'}, text: "..." })\n\n`;
            }

            // 5.2. Trích xuất danh sách hội thoại Messenger Dropdown (nếu đang mở)
            const messengerRows = Array.from(document.querySelectorAll<HTMLElement>('a[role="link"][href*="/messages/t/"], div[aria-label*="Đoạn chat"] [role="listitem"], div[aria-label*="Messenger"] [role="listitem"]'))
              .filter(el => (el.innerText || '').includes('Tin nhắn chưa đọc') || (el.innerText || '').includes('phút') || (el.innerText || '').includes('giờ'));

            if (messengerRows.length > 0) {
              const unreadChats = messengerRows.slice(0, 5).map((row, i) => {
                const lines = (row.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
                const name = lines[0] || 'Khách hàng';
                const msg = lines.find(l => !l.includes('Tin nhắn chưa đọc') && l !== name && !l.endsWith('phút') && !l.endsWith('giờ') && !l.startsWith('·')) || lines[1] || '';
                const clickIdx = interactiveElements.indexOf(row) + 1 || (row.querySelector('a') ? interactiveElements.indexOf(row.querySelector('a') as HTMLElement) + 1 : null);
                return `[${i + 1}] Khách: ${name} | Tin gần nhất: "${msg}" | Thao tác mở: browser_click({ index: ${clickIdx || 'n/a'} })`;
              });

              messengerSummary += `=== DANH SÁCH TIN NHẮN MESSENGER (CHỌN ĐỂ MỞ & TRẢ LỜI) ===\n` +
                unreadChats.join('\n') + '\n\n';
            }

            // 5.3. Trích xuất danh sách thông báo Facebook Notifications (nếu đang mở)
            const notifRows = Array.from(document.querySelectorAll<HTMLElement>('div[role="dialog"] a[role="link"][href*="notif_id"], div[aria-label*="Thông báo"] a[role="link"], div[aria-label*="Thông báo"] [role="listitem"]'))
              .filter(el => (el.innerText || '').length > 10);

            if (notifRows.length > 0) {
              const parsedNotifs = notifRows.slice(0, 6).map((row, i) => {
                const lines = (row.innerText || '').split('\n').map(l => l.trim()).filter(Boolean);
                const isUnread = lines.includes('Chưa đọc');
                const contentLines = lines.filter(l => l !== 'Chưa đọc' && !l.includes('phút') && !l.includes('giờ') && !l.includes('ngày') && !l.startsWith('·'));
                const timeLine = lines.find(l => l.includes('phút') || l.includes('giờ') || l.includes('ngày') || l.includes('Hôm qua')) || '';
                const summaryText = contentLines.join(' - ');
                const clickIdx = interactiveElements.indexOf(row) + 1 || (row.querySelector('a') ? interactiveElements.indexOf(row.querySelector('a') as HTMLElement) + 1 : null);
                return `[${i + 1}] [${isUnread ? 'CHƯA ĐỌC' : 'ĐÃ XEM'}] ${summaryText} (${timeLine}) | Thao tác mở bài viết: browser_click({ index: ${clickIdx || 'n/a'} })`;
              });

              notificationsSummary = `=== DANH SÁCH THÔNG BÁO FACEBOOK (NOTIFICATIONS) ===\n` +
                parsedNotifs.join('\n') + '\n\n';
            }
          } catch (mErr) {
            console.warn('[readPage] Messenger/Notif extract error:', mErr);
          }
        }

        // --- 6. Trích xuất văn bản tiêu biểu của trang (Headings & Content & Video Titles) ---
        const contentNodes = Array.from(document.querySelectorAll('h1, h2, h3, p, [role="heading"], article, #video-title, .title'));
        let textSummary = '';
        const seenSummary = new Set<string>();
        for (const n of contentNodes) {
          const t = (n.textContent || '').trim().replace(/\s+/g, ' ');
          if (t.length > 10 && !t.includes('{') && !t.includes('}') && !seenSummary.has(t)) {
            seenSummary.add(t);
            textSummary += t + '\n';
            if (textSummary.length > 2500) break;
          }
        }

        return {
          title: document.title,
          url: location.href,
          elementsCount: elementsData.length,
          elements: elementsData,
          feedPosts: isFacebook ? fbPosts : undefined,
          summaryText: (messengerSummary + notificationsSummary + fbSummary + textSummary).slice(0, 3800)
        };
      }
    });

    const res = results?.[0]?.result;
    if (res) {
      res.tabId = tabId;
    }
    return res;
  }

  /**
   * FB Reply Loop — đọc bình luận có cấu trúc của một bài Facebook.
   *
   * Dựa trên quan sát thật ngày 2026-10-31 trên bài công khai (không đăng
   * nhập, chỉ đọc): mỗi bình luận / phản hồi là một <article> riêng, nằm
   * ngang hàng nhau (không lồng nhau trong cây trợ năng), và dấu hiệu
   * phân biệt đáng tin cậy nhất là accessible name dạng:
   *   "Bình luận dưới tên <tác giả> vào <thời gian>"
   *   "Phản hồi bình luận của <tác giả cha> dưới tên <tác giả> vào <thời gian>"
   * Lưu ý đã xác minh: với phản hồi, liên kết đầu tiên trong article có
   * thể là tên người được nhắc tới (tác giả cha), KHÔNG phải tác giả
   * phản hồi — vì vậy tác giả luôn tách từ accessible name, không lấy
   * link đầu tiên một cách mù quáng.
   *
   * Giới hạn đã biết (ghi rõ, không giấu):
   * - Khi chưa đăng nhập, Facebook không hiện nút "Trả lời" dưới từng
   *   bình luận (bấm "Bình luận" ở cấp bài chỉ mở hộp thoại đăng nhập),
   *   nên replyIndex sẽ là null và replyControlsObserved = false.
   *   Muốn quan sát nút Trả lời / ô nhập thì tab điều khiển phải đang
   *   đăng nhập Facebook.
   * - Accessible name trong cây trợ năng có thể tới từ aria-label; nếu
   *   article không có aria-label khớp mẫu thì nó bị bỏ qua (không đoán),
   *   và kết quả trả về matchedByAriaLabel = false cho trường hợp đó.
   * - replyIndex chỉ có giá trị với danh sách __otter_elements mà chính
   *   lần gọi này vừa lưu (thứ tự document, không phải thứ tự viewport
   *   đã sort của readPage). Sau mỗi click/cuộn phải gọi lại
   *   fb_read_comments rồi mới dùng index mới.
   */
  static isFacebookPostMismatch(curUrl: string, targetPostUrl: string): boolean {
    if (!targetPostUrl || !targetPostUrl.trim()) return false;
    if (!curUrl) return true;

    try {
      const cur = new URL(curUrl.startsWith("http") ? curUrl : `https://${curUrl}`);
      const target = new URL(targetPostUrl.startsWith("http") ? targetPostUrl : `https://${targetPostUrl}`);

      // 1. Phải ở trên facebook.com
      if (!cur.hostname.includes("facebook.com")) return true;

      // 2. Không được là trang chủ / feed / trang điều hướng chung
      const nonPostPaths = ["/", "", "/home.php", "/watch", "/friends", "/messages", "/marketplace", "/notifications", "/bookmarks", "/groups", "/groups/feed", "/groups/feed/"];
      if (nonPostPaths.includes(cur.pathname.toLowerCase())) return true;

      // 3. Nếu là trang cá nhân profile.php mà không có story_fbid / fbid
      if (cur.pathname.toLowerCase() === "/profile.php" && !cur.searchParams.get("story_fbid") && !cur.searchParams.get("fbid")) {
        return true;
      }

      // 4. Nếu target có share ID (ví dụ: share/p/17tu5cAG8h) và cur cũng là dạng share/p/ nhưng khác ID
      const targetShare = target.pathname.match(/\/share\/p\/([a-zA-Z0-9_-]+)/i);
      const curShare = cur.pathname.match(/\/share\/p\/([a-zA-Z0-9_-]+)/i);
      if (targetShare && curShare && targetShare[1] !== curShare[1]) {
        return true;
      }

      // 5. Nếu cả 2 đều có fbid/story_fbid mà khác nhau
      const targetFbid = target.searchParams.get("story_fbid") || target.searchParams.get("fbid");
      const curFbid = cur.searchParams.get("story_fbid") || cur.searchParams.get("fbid");
      if (targetFbid && curFbid && targetFbid !== curFbid) {
        return true;
      }

      // 6. Kiểm tra xem cur có phải là trang bài viết hay không (post, story.php, permalink, share/p, photo, videos, groups)
      const postPattern = /\/(posts|story\.php|permalink|share\/|videos|photo|groups\/[0-9a-zA-Z._-]+\/(permalink|posts))/i;
      const isCurPost = postPattern.test(cur.pathname) || cur.searchParams.has("story_fbid") || cur.searchParams.has("fbid");
      if (!isCurPost) {
        // cur là trang cá nhân không có fbid (ví dụ /nguyenvana) hoặc trang khác ngoài bài viết
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  static async readComments(currentUserName?: string, postUrl?: string): Promise<any> {
    let tabId = await this.ensureControlledTab();

    // Tự động phục hồi link: nếu có postUrl và tab hiện tại bị lệch sang URL khác do nhấn nhầm, tự mở lại link bài viết gốc
    if (postUrl && postUrl.trim()) {
      try {
        const currentTab = await chrome.tabs.get(tabId).catch(() => null);
        const curUrl = currentTab?.url || "";
        if (BrowserController.isFacebookPostMismatch(curUrl, postUrl)) {
          console.log(`[readComments] Phát hiện lệch link (${curUrl} lệch khỏi ${postUrl}). Tự động mở lại link gốc...`);
          const openRes = await this.openUrl(postUrl);
          tabId = openRes.tabId;
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (recoveryErr) {
        console.warn("[readComments] Lỗi tự phục hồi link:", recoveryErr);
      }
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [currentUserName || ""],
      func: (currentUser: string) => {
        const INTERACTIVE_SELECTOR = [
          'a', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[contenteditable="true"]',
          '[contenteditable=""]', '[tabindex]:not([tabindex="-1"])', '[onclick]'
        ].join(',');

        // Danh sách phần tử tương tác theo thứ tự document, lưu vào cùng
        // biến toàn cục mà clickElement/typeElement dùng, để replyIndex
        // của lần gọi này dùng được ngay bằng browser_click.
        const interactive: HTMLElement[] = [];
        try {
          const all = document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
          const seen = new Set<HTMLElement>();
          for (const el of all) {
            if (seen.has(el)) continue;
            seen.add(el);
            if (el.parentElement?.closest('button, a, select')) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            interactive.push(el);
          }
        } catch {}
        (window as any).__otter_elements = interactive;
        (window as any).__chatmcp_elements = interactive;

        try {
          document.querySelectorAll('[data-otter-index]').forEach(node => node.removeAttribute('data-otter-index'));
          interactive.forEach((el, idx) => {
            try { el.setAttribute('data-otter-index', String(idx + 1)); } catch {}
          });
        } catch {}

        const indexOf = (el: HTMLElement | null): number | null => {
          if (!el) return null;
          let idx = interactive.indexOf(el);
          if (idx >= 0) return idx + 1;
          interactive.push(el);
          const newIdx = interactive.length;
          try { el.setAttribute('data-otter-index', String(newIdx)); } catch {}
          return newIdx;
        };

        const clean = (s: string): string => (s || '').trim().replace(/\s+/g, ' ');

        // Tách accessible name thành (parentAuthor?, author, time, strategy).
        // Dùng lần xuất hiện CUỐI của " vào " để tách thời gian, và lần
        // xuất hiện của " dưới tên " để tách tác giả cha (nếu có).
        // Logic này mirror src/daemon/fb-comment-parser.ts (bản test được);
        // sửa một bên thì phải sửa bên kia, test parser sẽ kiểm tra.
        function parseName(name: string): { parentAuthor: string | null; author: string; time: string; strategy: string } | null {
          const t = clean(name);
          if (!t) return null;
          const vnReplyPrefix = 'Phản hồi bình luận của ';
          if (t.startsWith(vnReplyPrefix)) {
            const rest = t.slice(vnReplyPrefix.length);
            const byIdx = rest.lastIndexOf(' dưới tên ');
            if (byIdx < 0) return null;
            const parentAuthor = rest.slice(0, byIdx).trim();
            const tail = rest.slice(byIdx + ' dưới tên '.length);
            const intoIdx = tail.lastIndexOf(' vào ');
            if (intoIdx < 0 || !parentAuthor) return null;
            return { parentAuthor, author: tail.slice(0, intoIdx).trim(), time: tail.slice(intoIdx + 5).trim(), strategy: 'vn-reply' };
          }
          const vnTopPrefix = 'Bình luận dưới tên ';
          if (t.startsWith(vnTopPrefix)) {
            const tail = t.slice(vnTopPrefix.length);
            const intoIdx = tail.lastIndexOf(' vào ');
            if (intoIdx < 0) return null;
            return { parentAuthor: null, author: tail.slice(0, intoIdx).trim(), time: tail.slice(intoIdx + 5).trim(), strategy: 'vn-top' };
          }
          // EN fallback (best-effort, chưa xác minh live).
          const enTopPrefix = 'Comment by ';
          if (t.startsWith(enTopPrefix)) {
            const rest = t.slice(enTopPrefix.length);
            const dotIdx = rest.lastIndexOf(' · ');
            if (dotIdx >= 0) return { parentAuthor: null, author: rest.slice(0, dotIdx).trim(), time: rest.slice(dotIdx + 3).trim(), strategy: 'en-top' };
            return { parentAuthor: null, author: rest.trim(), time: '', strategy: 'en-top' };
          }
          const enReplyPrefix = 'Reply to ';
          if (t.startsWith(enReplyPrefix)) {
            const byIdx = t.lastIndexOf("'s comment by ");
            if (byIdx < 0) return null;
            const parentAuthor = t.slice(enReplyPrefix.length, byIdx).trim();
            const author = t.slice(byIdx + "'s comment by ".length).trim();
            if (!parentAuthor || !author) return null;
            return { parentAuthor, author, time: '', strategy: 'en-reply' };
          }
          return null;
        }

        // PHẠM VI (quan trọng, rút ra từ bài nhiều bình luận 2026-10-31):
        // Cuộn trang KHÔNG load thêm bình luận của bài gốc — nó load thêm
        // các "Bài viết khác" phía dưới, mỗi bài cũng có bình luận riêng.
        // Quét toàn bộ document sẽ trộn bình luận của bài khác vào kết quả.
        // Vì vậy: nếu có dialog chứa bình luận (bài gốc thường nằm trong
        // dialog "Bài viết của ..."), chỉ quét article trong dialog đầu
        // tiên có bình luận khớp mẫu; nếu không có dialog như vậy thì
        // quét toàn trang nhưng báo scopedToDialog = false để driver biết
        // kết quả có thể lẫn bài khác và phải kiểm tra lại bằng postUrl.
        const allArticles = Array.from(document.querySelectorAll('article, [role="article"]'));
        let articles = allArticles;
        let scopedToDialog = false;
        try {
          const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
          for (const dialog of dialogs) {
            const inDialog = Array.from(dialog.querySelectorAll('article, [role="article"]'));
            const hasComment = inDialog.some((a) => {
              const label = a.getAttribute('aria-label') || '';
              return label ? parseName(label) !== null : false;
            });
            if (hasComment) {
              articles = inDialog;
              scopedToDialog = true;
              break;
            }
          }
        } catch {}
        const comments: any[] = [];
        const unmatchedSamples: string[] = [];
        let lastTopKey = '';
        let matchedByAriaLabel = false;

        for (const article of articles) {
          const ariaLabel = article.getAttribute('aria-label') || '';
          const parsed = ariaLabel ? parseName(ariaLabel) : null;
          if (!parsed) {
            // Chẩn đoán khi Facebook đổi DOM: giữ lại vài mẫu aria-label
            // không khớp (cắt 80 ký tự, không lấy nội dung bình luận) để
            // lần sau thêm strategy mới mà không cần soi lại từ đầu.
            if (ariaLabel && unmatchedSamples.length < 3) unmatchedSamples.push(ariaLabel.slice(0, 80));
            continue;
          }
          matchedByAriaLabel = true;

          // Nội dung: innerText của article, trừ tên tác giả, thời gian
          // và các chuỗi nhiễu (huy hiệu tác giả) để khỏi lẫn vào text.
          let text = clean(article.innerText || article.textContent || '');
          // Bỏ lần xuất hiện đầu của tên tác giả và thời gian ở cuối.
          if (parsed.author) text = text.replace(parsed.author, '').trim();
          if (parsed.time) {
            const ti = text.lastIndexOf(parsed.time);
            if (ti >= 0) text = text.slice(0, ti).trim();
          }
          text = text.replace(/Xem thông tin về huy hiệu danh tính/g, '').replace(/^Tác giả\s*/g, '').trim();
          if (parsed.parentAuthor) {
            // Với phản hồi, text có thể bắt đầu bằng tên người được nhắc.
            if (text.startsWith(parsed.parentAuthor)) text = text.slice(parsed.parentAuthor.length).trim();
          }
          const truncated = text.length > 1000;
          if (truncated) text = text.slice(0, 1000);

          // Nút Trả lời và Thích trong cùng article (chỉ hiện khi đã đăng nhập).
          let replyIndex: number | null = null;
          let likeIndex: number | null = null;
          let isLiked = false;
          try {
            const allElements = Array.from(article.querySelectorAll<HTMLElement>('button, [role="button"], a, div, span'));

            // 1. Nhận diện nút Thích (Like):
            // Ưu tiên 1: nút có role="button" hoặc thẻ <button> với aria-label="Thích" / "Like"
            for (const el of allElements) {
              const aria = clean(el.getAttribute('aria-label') || '');
              const txt = clean(el.innerText || el.textContent || '');
              const isBtn = el.getAttribute('role') === 'button' || el.tagName === 'BUTTON';

              if (/^(Gỡ Thích|Gỡ Yêu thích|Remove Like|Unlike)/i.test(aria) || /^(Gỡ Thích|Gỡ Yêu thích|Remove Like|Unlike)/i.test(txt) || el.getAttribute('aria-pressed') === 'true') {
                isLiked = true;
              }

              if (likeIndex === null && isBtn && /^(Thích|Like)$/i.test(aria)) {
                likeIndex = indexOf(el);
              }
            }

            // Ưu tiên 2: nếu likeIndex vẫn null, tìm theo text hoặc aria-label Thích/Like trên lá
            if (likeIndex === null) {
              for (const el of allElements) {
                if (el.children.length > 0 && el.querySelector('[role="button"], button')) continue;
                const aria = clean(el.getAttribute('aria-label') || '');
                const txt = clean(el.innerText || el.textContent || '');
                if (/^(Thích|Like)$/i.test(aria) || /^(Thích|Like)$/i.test(txt)) {
                  likeIndex = indexOf(el);
                  break;
                }
              }
            }

            // 2. Nhận diện nút Trả lời (Reply):
            // Ưu tiên 1: nút role="button" hoặc thẻ <button> có text hoặc aria-label "Trả lời" / "Reply"
            for (const el of allElements) {
              const aria = clean(el.getAttribute('aria-label') || '');
              const txt = clean(el.innerText || el.textContent || '');
              const isBtn = el.getAttribute('role') === 'button' || el.tagName === 'BUTTON';

              if (replyIndex === null && isBtn && (/^(Trả lời|Reply)$/i.test(txt) || /^(Trả lời|Reply)$/i.test(aria))) {
                replyIndex = indexOf(el);
                break;
              }
            }

            // Ưu tiên 2: nếu replyIndex vẫn null, tìm phần tử lá có text "Trả lời" / "Reply"
            if (replyIndex === null) {
              for (const el of allElements) {
                if (el.children.length > 0 && el.querySelector('[role="button"], button')) continue;
                const aria = clean(el.getAttribute('aria-label') || '');
                const txt = clean(el.innerText || el.textContent || '');
                if (/^(Trả lời|Reply)$/i.test(txt) || /^(Trả lời|Reply)$/i.test(aria)) {
                  replyIndex = indexOf(el);
                  break;
                }
              }
            }
          } catch {}

          const isReply = parsed.parentAuthor !== null;
          const key = `${parsed.author}\n${text}\n${parsed.time}`;
          if (!isReply) lastTopKey = key;
          comments.push({
            author: parsed.author,
            parentAuthor: parsed.parentAuthor,
            isReply,
            parentKey: isReply ? lastTopKey : null,
            text,
            truncated,
            time: parsed.time,
            strategy: parsed.strategy,
            replyIndex,
            likeIndex,
            isLiked,
          });
          if (comments.length >= 50) break;
        }

        // Nút load thêm (nếu có) — chỉ ghi nhãn, không bấm.
        // Bài nhiều bình luận 2026-10-31: nút bài gốc là "Xem thêm bình
        // luận" (mỗi lần bấm thêm 3 bình luận gốc, bộ đếm dạng 3/180 →
        // 6/180, nút vẫn còn khi chưa hết); nút mở phản hồi dạng
        // "Xem 1 phản hồi" / "Xem tất cả N phản hồi" — ghi riêng để
        // driver biết phải mở phản hồi thì mới thấy hết bình luận con.
        const loadMore: string[] = [];
        const replyExpansion: string[] = [];
        try {
          for (const b of document.querySelectorAll('button, [role="button"]')) {
            const label = clean((b as HTMLElement).innerText || b.getAttribute('aria-label') || '');
            if (/Xem thêm bình luận|Xem thêm phản hồi|Xem thêm câu trả lời|Tải thêm bình luận/i.test(label)) {
              if (!loadMore.includes(label)) loadMore.push(label);
            } else if (/Xem \d+ phản hồi|Xem tất cả \d+ phản hồi|Xem \d+ câu trả lời/i.test(label)) {
              if (!replyExpansion.includes(label)) replyExpansion.push(label);
            }
          }
        } catch {}

        const bodyText = clean(document.body?.innerText || '');
        const loginWall =
          bodyText.includes('Hãy đăng nhập hoặc đăng ký Facebook') ||
          !!document.querySelector('input[type="password"]');

        // hasOwnReply: chỉ tính được khi caller cho biết tên tài khoản
        // đang đăng nhập; nếu không thì để null (unknown), không đoán.
        const hasOwnReplyByKey = new Map<string, boolean>();
        if (currentUser) {
          for (const c of comments) {
            if (c.isReply && c.parentKey && c.author === currentUser) {
              hasOwnReplyByKey.set(c.parentKey, true);
            }
          }
        }

        return {
          postUrl: location.href,
          loginWall,
          replyControlsObserved: comments.some((c) => c.replyIndex !== null),
          matchedByAriaLabel,
          scopedToDialog,
          articlesFound: articles.length,
          totalArticlesInPage: allArticles.length,
          unmatchedSamples,
          loadMoreButtons: loadMore,
          replyExpansionButtons: replyExpansion,
          hasMore: loadMore.length > 0,
          totalSeen: comments.length,
          comments: comments.map((c) => ({
            ...c,
            hasOwnReply: c.isReply ? null : currentUser ? (hasOwnReplyByKey.get(`${c.author}\n${c.text}\n${c.time}`) ?? false) : null,
          })),
        };
      },
    });

    const res = results?.[0]?.result;
    if (res) res.tabId = tabId;
    return res;
  }

  /**
   * Đọc danh sách bài viết trên Bảng feed Facebook kèm các nút Thích, Bình luận
   */
  static async readFeed(): Promise<any> {
    const tabId = await this.ensureControlledTab("facebook.com");

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        // Tự động đóng tất cả các khung chat Messenger đang mở để dọn sạch viewport
        try {
          const closeBtns = Array.from(document.querySelectorAll<HTMLElement>(
            'div[role="button"][aria-label*="Đóng đoạn chat"], ' +
            'div[role="button"][aria-label*="Đóng cuộc trò chuyện"], ' +
            'div[role="button"][aria-label*="Close chat"], ' +
            'div[role="button"][aria-label*="Close conversation"]'
          ));
          for (const btn of closeBtns) {
            try { btn.click(); } catch {}
          }
        } catch {}

        const INTERACTIVE_SELECTOR = [
          'a', 'button', 'input:not([type="hidden"])', 'select', 'textarea',
          '[role="button"]', '[role="link"]', '[contenteditable="true"]', '[contenteditable=""]'
        ].join(', ');

        const interactive: HTMLElement[] = [];
        try {
          const all = document.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
          const seen = new Set<HTMLElement>();
          for (const el of all) {
            if (seen.has(el)) continue;
            seen.add(el);
            if (el.parentElement?.closest('button, a, select')) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            interactive.push(el);
          }
        } catch {}

        (window as any).__otter_elements = interactive;
        (window as any).__chatmcp_elements = interactive;

        // Đánh dấu data-otter-index trên DOM để thế giới MAIN world truy cập chuẩn xác
        try {
          document.querySelectorAll('[data-otter-index]').forEach(node => node.removeAttribute('data-otter-index'));
          interactive.forEach((el, idx) => {
            try { el.setAttribute('data-otter-index', String(idx + 1)); } catch {}
          });
        } catch {}

        const indexOf = (el: HTMLElement | null): number | null => {
          if (!el) return null;
          let idx = interactive.indexOf(el);
          if (idx >= 0) return idx + 1;
          let p = el.parentElement;
          while (p) {
            idx = interactive.indexOf(p);
            if (idx >= 0) return idx + 1;
            p = p.parentElement;
          }
          return null;
        };

        const clean = (s: string): string => (s || '').trim().replace(/\s+/g, ' ');

        const likeButtons = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"]'))
          .filter(el => {
            const aria = el.getAttribute('aria-label') || '';
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            return aria.startsWith('Bày tỏ cảm xúc Thích về bài viết của') ||
                   aria.startsWith('Bày tỏ cảm xúc về bài viết của') ||
                   aria.startsWith('Gỡ Thích khỏi bài viết của') ||
                   aria.startsWith('Gỡ Yêu thích khỏi bài viết của') ||
                   aria.includes('Thích về bài viết');
          });

        const posts: any[] = [];
        const seenAuthors = new Set<string>();

        for (const likeBtn of likeButtons) {
          const aria = likeBtn.getAttribute('aria-label') || '';
          const author = aria
            .replace(/^Bày tỏ cảm xúc Thích về bài viết của\s*/, '')
            .replace(/^Bày tỏ cảm xúc về bài viết của\s*/, '')
            .replace(/^Gỡ Thích khỏi bài viết của\s*/, '')
            .replace(/^Gỡ Yêu thích khỏi bài viết của\s*/, '')
            .replace(/^Gỡ [^k]+ khỏi bài viết của\s*/, '')
            .trim();

          if (!author || seenAuthors.has(author)) continue;
          seenAuthors.add(author);

          const isLiked = aria.startsWith('Gỡ Thích') || aria.startsWith('Gỡ Yêu thích') || aria.startsWith('Gỡ ') || likeBtn.innerText.includes('Đã thích');

          let cur = likeBtn.parentElement;
          let bestContainer: HTMLElement | null = null;
          while (cur && cur.tagName !== 'BODY' && cur.getAttribute('role') !== 'main') {
            const hasAuthor = Array.from(cur.querySelectorAll('a, strong, span')).some(s => s.innerText?.includes(author));
            const hasLike = cur.contains(likeBtn);
            if (hasAuthor && hasLike) {
              bestContainer = cur;
              const likeCount = cur.querySelectorAll('div[role="button"][aria-label*="Bày tỏ cảm xúc"], div[role="button"][aria-label*="Gỡ"]').length;
              if (likeCount >= 1) break;
            }
            cur = cur.parentElement;
          }

          if (!bestContainer) bestContainer = likeBtn.parentElement?.parentElement?.parentElement || null;

          const rawText = bestContainer ? bestContainer.innerText : '';
          const isSponsored = rawText.includes('Được tài trợ') ||
                              rawText.includes('Sponsored') ||
                              /n[\s\S]{0,5}p[\s\S]{0,5}o[\s\S]{0,5}t[\s\S]{0,5}s[\s\S]{0,5}r[\s\S]{0,5}o[\s\S]{0,5}e[\s\S]{0,5}d/i.test(rawText) ||
                              /s[\s\S]{0,5}p[\s\S]{0,5}o[\s\S]{0,5}n[\s\S]{0,5}s[\s\S]{0,5}o[\s\S]{0,5}r/i.test(rawText);

          const commentBtn = bestContainer ? bestContainer.querySelector<HTMLElement>(
            'div[role="button"][aria-label*="Bình luận"], div[role="button"][aria-label*="Comment"]'
          ) : null;

          const textLines = rawText.split('\n')
            .map(l => clean(l))
            .filter(l => l.length > 0 && l !== 'Facebook' && !l.startsWith('Thích:') && !l.startsWith('Yêu thích:'));

          const textSnippet = textLines.slice(0, 8).join('\n');

          posts.push({
            author,
            textSnippet,
            isSponsored,
            isLiked,
            likeIndex: indexOf(likeBtn),
            commentIndex: indexOf(commentBtn)
          });
        }

        return {
          totalPosts: posts.length,
          posts
        };
      }
    });

    const res = results?.[0]?.result;
    if (res) res.tabId = tabId;
    return res;
  }

  /**
   * Tương tác Like hoặc thả Reaction (Love, Care, Haha, Wow, Sad, Angry) vào bài viết Facebook
   */
  static async reactFacebook(
    index?: number,
    author?: string,
    reaction: "like" | "love" | "care" | "haha" | "wow" | "sad" | "angry" = "like"
  ): Promise<{ ok: boolean; message: string; actualReaction?: string }> {
    const tabId = await this.ensureControlledTab("facebook.com");

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [index || null, author || null, reaction || "like"],
      func: async (targetIndex: number | null, postAuthor: string | null, targetReaction: string) => {
        // 1. Tìm nút Like của bài viết
        let el: HTMLElement | null = null;
        if (typeof targetIndex === "number" && targetIndex > 0) {
          el = document.querySelector<HTMLElement>(`[data-otter-index="${targetIndex}"]`);
          if (!el) {
            const elements: HTMLElement[] = (window as any).__otter_elements || (window as any).__chatmcp_elements || [];
            el = elements[targetIndex - 1] || null;
          }
        }

        // Nếu chưa tìm thấy theo index hoặc index không trỏ vào nút like, tìm theo author
        if (!el || (!el.getAttribute('aria-label')?.includes('Thích') && !el.getAttribute('aria-label')?.includes('cảm xúc') && !el.getAttribute('aria-label')?.includes('Gỡ'))) {
          const allBtns = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"]'));
          el = allBtns.find(b => {
            const aria = b.getAttribute('aria-label') || '';
            const rect = b.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const matchesAuthor = postAuthor ? aria.includes(postAuthor) : true;
            return matchesAuthor && (
              aria.startsWith('Bày tỏ cảm xúc Thích về bài viết') ||
              aria.startsWith('Gỡ Thích khỏi bài viết') ||
              aria.startsWith('Gỡ Yêu thích khỏi bài viết') ||
              aria.startsWith('Gỡ ') ||
              aria.includes('Thích về bài viết')
            );
          }) || null;
        }

        if (!el) {
          return { ok: false, message: `Không tìm thấy nút Thích của bài viết${postAuthor ? ` (${postAuthor})` : ''}` };
        }

        // Cuộn vào trung tâm
        if (typeof (el as any).scrollIntoViewIfNeeded === 'function') {
          (el as any).scrollIntoViewIfNeeded();
        } else {
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
        }

        // Helper dispatch W3C pointer sequence
        const dispatchW3C = (targetNode: HTMLElement) => {
          const rect = targetNode.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const pOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', view: window, buttons: 1 };
          const mOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };

          targetNode.dispatchEvent(new PointerEvent('pointerover', pOpts));
          targetNode.dispatchEvent(new MouseEvent('mouseover', mOpts));
          targetNode.dispatchEvent(new PointerEvent('pointerdown', pOpts));
          targetNode.dispatchEvent(new MouseEvent('mousedown', mOpts));
          targetNode.dispatchEvent(new PointerEvent('pointerup', { ...pOpts, buttons: 0 }));
          targetNode.dispatchEvent(new MouseEvent('mouseup', { ...mOpts, buttons: 0 }));
          targetNode.click();
        };

        const currentAria = el.getAttribute('aria-label') || '';
        const isAlreadyLiked = currentAria.startsWith('Gỡ Thích') || currentAria.startsWith('Gỡ Yêu thích') || currentAria.startsWith('Gỡ');

        if (targetReaction === "none") {
          return { ok: true, message: "Bỏ qua bày tỏ cảm xúc theo yêu cầu", actualReaction: "none" };
        }

        // TH 1: Yêu cầu LIKE thông thường
        if (targetReaction === "like") {
          if (isAlreadyLiked) {
            return { ok: true, message: `Bài viết đã được thích trước đó (${currentAria})`, actualReaction: "liked" };
          }
          dispatchW3C(el);
          return { ok: true, message: `Đã Thích bài viết thành công!`, actualReaction: "liked" };
        }

        // TH 2: Yêu cầu thả REACTION đặc biệt (love, care, haha, wow, sad, angry)
        const parentBar = el.parentElement;
        const triggerBtn = parentBar?.querySelector<HTMLElement>(
          'div[role="button"][aria-label*="Bày tỏ cảm xúc về bài viết"], div[role="button"][aria-label*="Thay đổi cảm xúc"]'
        ) || el;

        // Mở toolbar
        dispatchW3C(triggerBtn);

        // Chờ 600ms để toolbar bung ra
        await new Promise(r => setTimeout(r, 600));

        // Bản đồ tên cảm xúc theo aria-label tiếng Việt & Anh
        const reactionKeywords: Record<string, string[]> = {
          love: ['yêu thích', 'love'],
          care: ['thương thương', 'care'],
          haha: ['haha'],
          wow: ['wow'],
          sad: ['buồn', 'sad'],
          angry: ['phẫn nộ', 'angry']
        };

        const targetKeywords = reactionKeywords[targetReaction] || ['yêu thích', 'love'];

        // Tìm nút reaction trong toolbar
        const reactionBtn = Array.from(document.querySelectorAll<HTMLElement>('[role="toolbar"] [role="button"], div[role="button"]')).find(b => {
          const a = (b.getAttribute('aria-label') || '').toLowerCase();
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && targetKeywords.some(kw => a === kw);
        });

        if (reactionBtn) {
          const canvasOrBtn = reactionBtn.querySelector<HTMLElement>('canvas') || reactionBtn;
          dispatchW3C(canvasOrBtn);
          return {
            ok: true,
            message: `Đã thả biểu tượng cảm xúc "${targetReaction}" thành công!`,
            actualReaction: targetReaction
          };
        }

        // Nếu không tìm thấy toolbar, fallback click Like thông thường
        if (!isAlreadyLiked) {
          dispatchW3C(el);
        }
        return {
          ok: true,
          message: `Không tìm thấy nút reaction toolbar, đã fallback Like thông thường.`,
          actualReaction: "liked"
        };
      }
    });

    return results?.[0]?.result || { ok: false, message: "Lỗi thực thi lệnh phản ứng Facebook" };
  }

  /**
   * Tương tác bình luận vào bài viết Facebook kèm quy trình thao tác trực tiếp và xác thực thực tế
   */
  static async commentFacebook(params: {
    commentIndex?: number;
    author?: string;
    commentText: string;
  }): Promise<{ ok: boolean; verified: boolean; message: string; commentSnippet?: string }> {
    const tabId = await this.ensureControlledTab("facebook.com");

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [params.commentIndex || null, params.author || null, params.commentText],
      func: async (targetIndex: number | null, postAuthor: string | null, textToType: string) => {
        // Helper dispatch W3C pointer sequence
        const dispatchW3C = (targetNode: HTMLElement) => {
          const rect = targetNode.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const pOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', view: window, buttons: 1 };
          const mOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };

          targetNode.dispatchEvent(new PointerEvent('pointerover', pOpts));
          targetNode.dispatchEvent(new MouseEvent('mouseover', mOpts));
          targetNode.dispatchEvent(new PointerEvent('pointerdown', pOpts));
          targetNode.dispatchEvent(new MouseEvent('mousedown', mOpts));
          targetNode.dispatchEvent(new PointerEvent('pointerup', { ...pOpts, buttons: 0 }));
          targetNode.dispatchEvent(new MouseEvent('mouseup', { ...mOpts, buttons: 0 }));
          targetNode.click();
        };

        // 1. Kiểm tra xem ô nhập bình luận đã mở sẵn chưa
        let tb: HTMLElement | null = document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]');

        // 2. Nếu chưa có ô nhập, tìm nút Comment để mở
        if (!tb) {
          let commentBtn: HTMLElement | null = null;
          if (typeof targetIndex === "number" && targetIndex > 0) {
            commentBtn = document.querySelector<HTMLElement>(`[data-otter-index="${targetIndex}"]`);
            if (!commentBtn) {
              const elements: HTMLElement[] = (window as any).__otter_elements || (window as any).__chatmcp_elements || [];
              commentBtn = elements[targetIndex - 1] || null;
            }
          }

          if (!commentBtn && postAuthor) {
            const allBtns = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"]'));
            commentBtn = allBtns.find(b => {
              const a = b.getAttribute('aria-label') || '';
              const rect = b.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) return false;
              return a.includes(postAuthor) && (/bình luận|comment/i.test(a));
            }) || null;

            if (!commentBtn) {
              const likeBtn = allBtns.find(b => {
                const a = b.getAttribute('aria-label') || '';
                return a.includes(postAuthor) && (a.includes('Thích') || a.includes('Gỡ'));
              });
              if (likeBtn) {
                let cur = likeBtn.parentElement;
                while (cur && cur.tagName !== 'BODY') {
                  const b = cur.querySelector<HTMLElement>('div[role="button"][aria-label*="Bình luận"], div[role="button"][aria-label*="Comment"]');
                  if (b) { commentBtn = b; break; }
                  cur = cur.parentElement;
                }
              }
            }
          }

          if (commentBtn) {
            if (typeof (commentBtn as any).scrollIntoViewIfNeeded === 'function') {
              (commentBtn as any).scrollIntoViewIfNeeded();
            } else {
              commentBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
            dispatchW3C(commentBtn);

            for (let i = 0; i < 15; i++) {
              await new Promise(r => setTimeout(r, 200));
              const tbs = Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"]'));
              if (tbs.length > 0) {
                tb = tbs[tbs.length - 1];
                break;
              }
            }
          }
        }

        if (!tb) {
          return {
            ok: false,
            verified: false,
            message: `Không tìm thấy ô nhập bình luận cho bài viết${postAuthor ? ` (${postAuthor})` : ''}.`
          };
        }

        // 3. Cuộn vào khung nhìn và focus
        if (typeof (tb as any).scrollIntoViewIfNeeded === 'function') {
          (tb as any).scrollIntoViewIfNeeded();
        } else {
          tb.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
        tb.focus();

        // 4. Ghi nhận số lượng bình luận trước khi gửi (để so sánh đối chứng)
        const countComments = () => {
          return document.querySelectorAll('div[role="article"], div[aria-label*="Bình luận"], div[aria-label*="Comment by"], div[aria-label*="Bình luận dưới tên"]').length;
        };
        const initialCommentCount = countComments();

        // 5. Nhập nội dung bình luận vào ô nhập (hỗ trợ Lexical của Meta và execCommand fallback)
        const lexicalEditor = (tb as any).__lexicalEditor || (tb.closest('[data-lexical-editor]') as any)?.__lexicalEditor;
        if (lexicalEditor && typeof lexicalEditor.parseEditorState === 'function' && typeof lexicalEditor.setEditorState === 'function') {
          try {
            const newState = {
              root: {
                children: [
                  {
                    children: [
                      {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text: textToType,
                        type: "text",
                        version: 1
                      }
                    ],
                    direction: null,
                    format: "",
                    indent: 0,
                    textFormat: 0,
                    textStyle: "",
                    type: "paragraph",
                    version: 1
                  }
                ],
                direction: null,
                format: "",
                indent: 0,
                type: "root",
                version: 1
              }
            };
            const parsed = lexicalEditor.parseEditorState(JSON.stringify(newState));
            lexicalEditor.setEditorState(parsed);
            lexicalEditor.focus();
          } catch {
            tb.innerText = textToType;
          }
        } else {
          try {
            const doc = tb.ownerDocument || document;
            const selection = (doc.defaultView || window).getSelection();
            const range = doc.createRange();
            range.selectNodeContents(tb);
            selection?.removeAllRanges();
            selection?.addRange(range);
            doc.execCommand('delete', false);
            doc.execCommand('insertText', false, textToType);
          } catch {
            tb.innerText = textToType;
          }
        }
        tb.dispatchEvent(new Event('input', { bubbles: true }));
        tb.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 600));

        // 6. Nhấn Enter và click nút Đăng bình luận
        const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
        tb.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
        tb.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
        tb.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

        let submitBtn: HTMLElement | null = null;
        let cur = tb.parentElement;
        for (let i = 0; i < 7; i++) {
          if (!cur) break;
          const found = cur.querySelector<HTMLElement>(
            'div[role="button"][aria-label="Đăng bình luận"], div[role="button"][aria-label="Comment"], div[role="button"][aria-label="Post"], div[role="button"][aria-label*="Nhấn Enter để gửi"], div[role="button"][aria-label*="Press Enter to send"]'
          );
          if (found) {
            const a = (found.getAttribute('aria-label') || '').toLowerCase();
            if (!a.startsWith('comment on') && !a.includes('comments')) {
              submitBtn = found;
              break;
            }
          }
          cur = cur.parentElement;
        }

        if (submitBtn) {
          dispatchW3C(submitBtn);
        }

        // 7. Xác thực thực tế trên Facebook (Live Verification):
        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const targetSnippet = normalize(textToType).slice(0, 35);
        let commentVerified = false;
        let verifiedSnippet = "";

        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise(r => setTimeout(r, 500));

          const currentComments = Array.from(document.querySelectorAll<HTMLElement>(
            'div[role="article"], div[aria-label*="Bình luận"], div[aria-label*="Comment by"], div[aria-label*="Bình luận dưới tên"]'
          ));

          const matched = currentComments.find(c => normalize(c.innerText).includes(targetSnippet));
          if (matched) {
            commentVerified = true;
            verifiedSnippet = matched.innerText.slice(0, 100);
            break;
          }

          const tbText = normalize(tb.innerText || '');
          if (tbText.length === 0 && countComments() > initialCommentCount) {
            commentVerified = true;
            verifiedSnippet = textToType.slice(0, 100);
            break;
          }
        }

        if (commentVerified) {
          return {
            ok: true,
            verified: true,
            message: `Đã xác nhận bình luận xuất hiện thực tế trên Facebook!`,
            commentSnippet: verifiedSnippet
          };
        } else {
          return {
            ok: false,
            verified: false,
            message: `Đã nhập và gửi bình luận, nhưng sau 6 giây Facebook chưa hiển thị bình luận trên trang.`
          };
        }
      }
    });

    return results?.[0]?.result || { ok: false, verified: false, message: "Lỗi thực thi script bình luận" };
  }

  /**
   * Tự động đăng bài viết lên một nhóm Facebook cụ thể kèm xác thực
   */
  static async postToFacebookGroup(params: {
    groupUrl: string;
    content: string;
  }): Promise<{ ok: boolean; verified: boolean; message: string; postSnippet?: string }> {
    let tabId: number;
    try {
      tabId = await this.ensureControlledTab("facebook.com");
    } catch {
      const openRes = await this.openUrl(params.groupUrl);
      tabId = openRes.tabId;
    }

    // 1. Điều hướng tới nhóm Facebook nếu chưa ở đúng URL
    try {
      const currentTab = await chrome.tabs.get(tabId);
      const normTarget = params.groupUrl.trim().replace(/\/$/, "");
      const normCurrent = (currentTab.url || "").trim().replace(/\/$/, "");

      if (!normCurrent.includes(normTarget)) {
        await chrome.tabs.update(tabId, { url: params.groupUrl });
        await new Promise<void>((resolve) => {
          const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (tid === tabId && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 10000);
        });
        await new Promise((r) => setTimeout(r, 2500));
      }
    } catch {}

    // Dọn dẹp khung Messenger nếu có
    await this.closeMessengerDocks();

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [params.content],
      func: async (textToPost: string) => {
        const dispatchW3C = (targetNode: HTMLElement) => {
          const rect = targetNode.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const pOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "mouse", view: window, buttons: 1 };
          const mOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };

          targetNode.dispatchEvent(new PointerEvent("pointerover", pOpts));
          targetNode.dispatchEvent(new MouseEvent("mouseover", mOpts));
          targetNode.dispatchEvent(new PointerEvent("pointerdown", pOpts));
          targetNode.dispatchEvent(new MouseEvent("mousedown", mOpts));
          targetNode.dispatchEvent(new PointerEvent("pointerup", { ...pOpts, buttons: 0 }));
          targetNode.dispatchEvent(new MouseEvent("mouseup", { ...mOpts, buttons: 0 }));
          targetNode.click();
        };

        // 1. Tìm nút mở khung soạn thảo nhóm
        const allCandidates = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"], span, div, h3'));
        let triggerBtn: HTMLElement | null = null;

        for (const el of allCandidates) {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const text = (el.innerText || "").toLowerCase();

          const isComposerTrigger =
            aria.includes("tạo bài viết") ||
            aria.includes("viết gì đi") ||
            aria.includes("create a post") ||
            text.includes("bạn viết gì đi") ||
            text.includes("tạo bài viết công khai") ||
            text.includes("tạo bài viết") ||
            text.includes("bạn đang nghĩ gì") ||
            text.includes("write something");

          if (isComposerTrigger) {
            triggerBtn = el;
            if (el.getAttribute("role") === "button") break;
          }
        }

        if (!triggerBtn) {
          return { ok: false, verified: false, message: "Không tìm thấy nút tạo bài viết trong nhóm Facebook này." };
        }

        if (typeof (triggerBtn as any).scrollIntoViewIfNeeded === "function") {
          (triggerBtn as any).scrollIntoViewIfNeeded();
        } else {
          triggerBtn.scrollIntoView({ behavior: "auto", block: "center" });
        }
        dispatchW3C(triggerBtn);

        // 2. Chờ modal soạn bài xuất hiện
        let tb: HTMLElement | null = null;
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const dialog = document.querySelector<HTMLElement>('div[role="dialog"]');
          if (dialog) {
            tb = dialog.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]');
            if (tb) break;
          }
          if (!tb) {
            const boxes = Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"]'));
            if (boxes.length > 0) {
              tb = boxes[boxes.length - 1];
              break;
            }
          }
        }

        if (!tb) {
          return { ok: false, verified: false, message: "Đã click tạo bài nhưng khung soạn thảo không mở ra." };
        }

        tb.focus();

        // 3. Nhập nội dung bài viết qua Lexical
        const lexicalEditor = (tb as any).__lexicalEditor || (tb.closest("[data-lexical-editor]") as any)?.__lexicalEditor;
        if (lexicalEditor && typeof lexicalEditor.parseEditorState === "function" && typeof lexicalEditor.setEditorState === "function") {
          try {
            const newState = {
              root: {
                children: [
                  {
                    children: [
                      {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text: textToPost,
                        type: "text",
                        version: 1
                      }
                    ],
                    direction: null,
                    format: "",
                    indent: 0,
                    textFormat: 0,
                    textStyle: "",
                    type: "paragraph",
                    version: 1
                  }
                ],
                direction: null,
                format: "",
                indent: 0,
                type: "root",
                version: 1
              }
            };
            const parsed = lexicalEditor.parseEditorState(JSON.stringify(newState));
            lexicalEditor.setEditorState(parsed);
            lexicalEditor.focus();
          } catch {
            tb.innerText = textToPost;
          }
        } else {
          try {
            const doc = tb.ownerDocument || document;
            const selection = (doc.defaultView || window).getSelection();
            const range = doc.createRange();
            range.selectNodeContents(tb);
            selection?.removeAllRanges();
            selection?.addRange(range);
            doc.execCommand("delete", false);
            doc.execCommand("insertText", false, textToPost);
          } catch {
            tb.innerText = textToPost;
          }
        }
        tb.dispatchEvent(new Event("input", { bubbles: true }));
        tb.dispatchEvent(new Event("change", { bubbles: true }));

        await new Promise((r) => setTimeout(r, 1000));

        // 4. Tìm nút "Đăng" / "Post"
        const dialog = tb.closest('div[role="dialog"]') || document;
        const allBtns = Array.from(dialog.querySelectorAll<HTMLElement>('div[role="button"], button'));
        let submitBtn = allBtns.find((b) => {
          const a = (b.getAttribute("aria-label") || "").trim().toLowerCase();
          const t = (b.innerText || "").trim().toLowerCase();
          const disabled = b.getAttribute("aria-disabled") === "true" || b.getAttribute("disabled") !== null;
          if (disabled) return false;
          return a === "đăng" || a === "post" || t === "đăng" || t === "post";
        });

        if (!submitBtn) {
          submitBtn = allBtns.find((b) => {
            const a = (b.getAttribute("aria-label") || "").toLowerCase();
            return (a.includes("đăng") || a.includes("post")) && b.getAttribute("aria-disabled") !== "true";
          });
        }

        if (!submitBtn) {
          return { ok: false, verified: false, message: "Không tìm thấy nút Đăng bài (hoặc nút đang bị vô hiệu hóa)." };
        }

        dispatchW3C(submitBtn);

        // 5. Xác thực thực tế: Chờ modal đóng lại hoặc bài viết xuất hiện trên nhóm (tối đa 12s)
        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        const snippet = normalize(textToPost).slice(0, 30);
        let verified = false;

        for (let i = 0; i < 24; i++) {
          await new Promise((r) => setTimeout(r, 500));

          const stillOpen = document.querySelector('div[role="dialog"]');
          if (!stillOpen) {
            verified = true;
            break;
          }

          const feedText = normalize(document.body.innerText || "");
          if (feedText.includes(snippet)) {
            verified = true;
            break;
          }
        }

        if (verified) {
          return {
            ok: true,
            verified: true,
            message: "Đã đăng bài viết thành công lên nhóm!",
            postSnippet: textToPost.slice(0, 100)
          };
        } else {
          return {
            ok: false,
            verified: false,
            message: "Đã click Đăng nhưng modal chưa đóng hoặc Facebook chưa xác nhận bài viết đã đăng."
          };
        }
      }
    });

    return results?.[0]?.result || { ok: false, verified: false, message: "Lỗi thực thi lệnh đăng nhóm" };
  }

  /**
   * Tự động đăng bài viết kèm Media (Video, Ảnh) lên Facebook (Trang cá nhân, Nhóm, Fanpage)
   */
  static async postMediaToFacebook(params: {
    targetType: "profile" | "group" | "page";
    targetUrl?: string;
    mediaPath?: string;
    mediaType?: "video" | "image" | "none";
    caption: string;
  }): Promise<{ ok: boolean; verified: boolean; message: string; postSnippet?: string }> {
    // 1. Chuẩn bị URL mục tiêu
    let destUrl = (params.targetUrl || "").trim();
    if (!destUrl) {
      if (params.targetType === "group") destUrl = "https://www.facebook.com/groups/feed/";
      else destUrl = "https://www.facebook.com/";
    }
    if (!destUrl.startsWith("http://") && !destUrl.startsWith("https://")) {
      destUrl = `https://${destUrl}`;
    }

    let tabId: number;
    try {
      tabId = await this.ensureControlledTab("facebook.com");
    } catch {
      const openRes = await this.openUrl(destUrl);
      tabId = openRes.tabId;
    }

    // 2. Điều hướng tới đúng URL nếu chưa ở đó
    try {
      const currentTab = await chrome.tabs.get(tabId);
      const normTarget = destUrl.replace(/\/$/, "");
      const normCurrent = (currentTab.url || "").trim().replace(/\/$/, "");

      if (!normCurrent.includes(normTarget)) {
        await chrome.tabs.update(tabId, { url: destUrl });
        await new Promise<void>((resolve) => {
          const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
            if (tid === tabId && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }, 12000);
        });
        await new Promise((r) => setTimeout(r, 2500));
      }
    } catch {}

    // Dọn dẹp các khung Messenger pop-up nếu có
    await this.closeMessengerDocks();

    // 3. Tải tệp media từ Daemon local nếu có
    let mediaBase64 = "";
    let mediaFileName = "";
    let mediaMimeType = params.mediaType === "video" ? "video/mp4" : "image/jpeg";

    if (params.mediaPath) {
      try {
        const fileUrl = `http://127.0.0.1:1993/api/media/file?path=${encodeURIComponent(params.mediaPath)}`;
        const resp = await fetch(fileUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          mediaMimeType = blob.type || mediaMimeType;
          mediaFileName = params.mediaPath.split(/[\/\\]/).pop() || (params.mediaType === "video" ? "video.mp4" : "image.jpg");

          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          const len = bytes.byteLength;
          for (let i = 0; i < len; i += 8192) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, len)) as any);
          }
          mediaBase64 = btoa(binary);
        } else {
          console.warn(`[Otter FB Media] Không thể nạp media qua daemon (HTTP ${resp.status}), tiếp tục đăng bài dạng text.`);
        }
      } catch (err: any) {
        console.warn(`[Otter FB Media] Lỗi đọc tệp media: ${err.message}`);
      }
    }

    // 4. Thực thi quy trình đăng bài trên tab Facebook
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [{
        targetType: params.targetType,
        caption: params.caption,
        hasMedia: !!mediaBase64,
        mediaBase64,
        fileName: mediaFileName,
        mimeType: mediaMimeType
      }],
      func: async (payload: {
        targetType: string;
        caption: string;
        hasMedia: boolean;
        mediaBase64: string;
        fileName: string;
        mimeType: string;
      }) => {
        const dispatchW3C = (targetNode: HTMLElement) => {
          const rect = targetNode.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const pOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: "mouse", view: window, buttons: 1 };
          const mOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, view: window };

          targetNode.dispatchEvent(new PointerEvent("pointerover", pOpts));
          targetNode.dispatchEvent(new MouseEvent("mouseover", mOpts));
          targetNode.dispatchEvent(new PointerEvent("pointerdown", pOpts));
          targetNode.dispatchEvent(new MouseEvent("mousedown", mOpts));
          targetNode.dispatchEvent(new PointerEvent("pointerup", { ...pOpts, buttons: 0 }));
          targetNode.dispatchEvent(new MouseEvent("mouseup", { ...mOpts, buttons: 0 }));
          targetNode.click();
        };

        // 1. Tìm nút kích hoạt khung soạn bài viết
        const allCandidates = Array.from(document.querySelectorAll<HTMLElement>('div[role="button"], span, div, h3'));
        let triggerBtn: HTMLElement | null = null;

        for (const el of allCandidates) {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const text = (el.innerText || "").toLowerCase();

          const isComposerTrigger =
            aria.includes("tạo bài viết") ||
            aria.includes("viết gì đi") ||
            aria.includes("create a post") ||
            aria.includes("ảnh/video") ||
            aria.includes("photo/video") ||
            text.includes("bạn viết gì đi") ||
            text.includes("tạo bài viết công khai") ||
            text.includes("tạo bài viết") ||
            text.includes("bạn đang nghĩ gì") ||
            text.includes("write something");

          if (isComposerTrigger) {
            triggerBtn = el;
            if (el.getAttribute("role") === "button") break;
          }
        }

        if (!triggerBtn) {
          return { ok: false, verified: false, message: "Không tìm thấy nút tạo bài viết trên trang Facebook này." };
        }

        if (typeof (triggerBtn as any).scrollIntoViewIfNeeded === "function") {
          (triggerBtn as any).scrollIntoViewIfNeeded();
        } else {
          triggerBtn.scrollIntoView({ behavior: "auto", block: "center" });
        }
        dispatchW3C(triggerBtn);

        // 2. Chờ modal soạn bài xuất hiện
        let dialog: HTMLElement | null = null;
        let tb: HTMLElement | null = null;
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 200));
          dialog = document.querySelector<HTMLElement>('div[role="dialog"]');
          if (dialog) {
            tb = dialog.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]');
            if (tb) break;
          }
          if (!tb) {
            const boxes = Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"]'));
            if (boxes.length > 0) {
              tb = boxes[boxes.length - 1];
              break;
            }
          }
        }

        if (!tb) {
          return { ok: false, verified: false, message: "Đã click tạo bài nhưng khung soạn thảo không mở ra." };
        }

        const activeContainer = dialog || tb.closest('div[role="dialog"]') || document;

        // 3. Nếu có Media (video/ảnh), nạp file vào Facebook uploader
        if (payload.hasMedia && payload.mediaBase64) {
          // Bấm nút "Ảnh/video" trong toolbar của dialog nếu khung uploader chưa mở
          const allToolBtns = Array.from(activeContainer.querySelectorAll<HTMLElement>('div[role="button"], span[role="button"]'));
          const mediaTriggerBtn = allToolBtns.find((b) => {
            const a = (b.getAttribute("aria-label") || "").toLowerCase();
            const t = (b.innerText || "").toLowerCase();
            return (
              a.includes("ảnh/video") ||
              a.includes("photo/video") ||
              a.includes("thêm ảnh/video") ||
              a.includes("add photos/videos") ||
              a.includes("chọn ảnh") ||
              t.includes("ảnh/video") ||
              t.includes("photo/video") ||
              t.includes("thêm ảnh/video")
            );
          });

          if (mediaTriggerBtn) {
            dispatchW3C(mediaTriggerBtn);
            await new Promise((r) => setTimeout(r, 800));
          }

          // Tìm thẻ <input type="file">
          let fileInput = activeContainer.querySelector<HTMLInputElement>('input[type="file"]');
          if (!fileInput) {
            const allFileInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
            if (allFileInputs.length > 0) {
              fileInput = allFileInputs[allFileInputs.length - 1];
            }
          }

          if (fileInput) {
            try {
              // Giải mã base64 thành binary buffer
              const byteChars = atob(payload.mediaBase64);
              const byteNums = new Array(byteChars.length);
              for (let i = 0; i < byteChars.length; i++) {
                byteNums[i] = byteChars.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNums);
              const blob = new Blob([byteArray], { type: payload.mimeType });
              const fileObj = new File([blob], payload.fileName, { type: payload.mimeType, lastModified: Date.now() });

              const dt = new DataTransfer();
              dt.items.add(fileObj);
              fileInput.files = dt.files;

              fileInput.dispatchEvent(new Event("input", { bubbles: true }));
              fileInput.dispatchEvent(new Event("change", { bubbles: true }));

              // Chờ Facebook tải lên và xử lý video/ảnh (tối đa 45s)
              for (let wait = 0; wait < 45; wait++) {
                await new Promise((r) => setTimeout(r, 1000));

                const hasPreview = !!activeContainer.querySelector(
                  'video, img[src*="blob:"], [aria-label*="xóa"], [aria-label*="remove"], [aria-label*="chỉnh sửa"], [aria-label*="edit"]'
                );
                const hasProgress = !!activeContainer.querySelector('[role="progressbar"]');

                if (hasPreview && !hasProgress) {
                  break; // Upload hoàn tất thành công
                }
              }
            } catch (err: any) {
              console.warn("[Otter FB Media] Lỗi inject file vào input:", err);
            }
          } else {
            console.warn("[Otter FB Media] Không tìm thấy input type='file' trên giao diện");
          }
        }

        // 4. Nhập caption vào Lexical Editor
        tb.focus();
        const lexicalEditor = (tb as any).__lexicalEditor || (tb.closest("[data-lexical-editor]") as any)?.__lexicalEditor;
        if (lexicalEditor && typeof lexicalEditor.parseEditorState === "function" && typeof lexicalEditor.setEditorState === "function") {
          try {
            const newState = {
              root: {
                children: [
                  {
                    children: [
                      {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text: payload.caption,
                        type: "text",
                        version: 1
                      }
                    ],
                    direction: null,
                    format: "",
                    indent: 0,
                    textFormat: 0,
                    textStyle: "",
                    type: "paragraph",
                    version: 1
                  }
                ],
                direction: null,
                format: "",
                indent: 0,
                type: "root",
                version: 1
              }
            };
            const parsed = lexicalEditor.parseEditorState(JSON.stringify(newState));
            lexicalEditor.setEditorState(parsed);
            lexicalEditor.focus();
          } catch {
            tb.innerText = payload.caption;
          }
        } else {
          try {
            const doc = tb.ownerDocument || document;
            const selection = (doc.defaultView || window).getSelection();
            const range = doc.createRange();
            range.selectNodeContents(tb);
            selection?.removeAllRanges();
            selection?.addRange(range);
            doc.execCommand("delete", false);
            doc.execCommand("insertText", false, payload.caption);
          } catch {
            tb.innerText = payload.caption;
          }
        }
        tb.dispatchEvent(new Event("input", { bubbles: true }));
        tb.dispatchEvent(new Event("change", { bubbles: true }));

        await new Promise((r) => setTimeout(r, 1200));

        // 5. Tìm nút "Đăng" / "Post"
        const dialogRoot = tb.closest('div[role="dialog"]') || document;
        const allBtns = Array.from(dialogRoot.querySelectorAll<HTMLElement>('div[role="button"], button'));
        let submitBtn = allBtns.find((b) => {
          const a = (b.getAttribute("aria-label") || "").trim().toLowerCase();
          const t = (b.innerText || "").trim().toLowerCase();
          const disabled = b.getAttribute("aria-disabled") === "true" || b.getAttribute("disabled") !== null;
          if (disabled) return false;
          return a === "đăng" || a === "post" || t === "đăng" || t === "post";
        });

        if (!submitBtn) {
          submitBtn = allBtns.find((b) => {
            const a = (b.getAttribute("aria-label") || "").toLowerCase();
            return (a.includes("đăng") || a.includes("post")) && b.getAttribute("aria-disabled") !== "true";
          });
        }

        if (!submitBtn) {
          return { ok: false, verified: false, message: "Không tìm thấy nút Đăng bài (hoặc nút đang bị vô hiệu hóa vì video đang tải lên)." };
        }

        dispatchW3C(submitBtn);

        // 6. Xác thực thực tế: Chờ modal đóng lại hoặc bài viết xuất hiện
        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        const snippet = normalize(payload.caption).slice(0, 30);
        let verified = false;

        for (let i = 0; i < 24; i++) {
          await new Promise((r) => setTimeout(r, 500));

          const stillOpen = document.querySelector('div[role="dialog"]');
          if (!stillOpen) {
            verified = true;
            break;
          }

          const feedText = normalize(document.body.innerText || "");
          if (snippet && feedText.includes(snippet)) {
            verified = true;
            break;
          }
        }

        if (verified) {
          return {
            ok: true,
            verified: true,
            message: `Đã đăng bài viết ${payload.hasMedia ? "kèm media (video/ảnh)" : ""} thành công lên Facebook!`,
            postSnippet: payload.caption.slice(0, 100)
          };
        } else {
          return {
            ok: false,
            verified: false,
            message: "Đã click Đăng nhưng modal chưa đóng hoặc Facebook chưa xác nhận bài viết đã đăng."
          };
        }
      }
    });

    return results?.[0]?.result || { ok: false, verified: false, message: "Lỗi thực thi lệnh đăng bài media" };
  }

  /**
   * Click phần tử với W3C Pointer Event sequence + Hit-testing elementFromPoint
   */
  static async clickElement(index: number, preferredUrlPattern?: string): Promise<{ ok: boolean; message: string }> {
    const tabId = await this.ensureControlledTab(preferredUrlPattern);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [index],
      func: (targetIndex: number) => {
        let el = document.querySelector<HTMLElement>(`[data-otter-index="${targetIndex}"]`);
        if (!el) {
          const elements: HTMLElement[] = (window as any).__otter_elements || (window as any).__chatmcp_elements || [];
          el = elements[targetIndex - 1];
        }
        if (!el) {
          return { ok: false, message: `Không tìm thấy phần tử có chỉ số [${targetIndex}]` };
        }

        // 1. Cuộn phần tử vào tâm màn hình
        if (typeof (el as any).scrollIntoViewIfNeeded === 'function') {
          (el as any).scrollIntoViewIfNeeded();
        } else {
          el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
        }

        // 2. Tính tọa độ trọng tâm (x, y)
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;

        // 3. Hit-test tìm phần tử thực sự hứng click bên trong (W3C Innermost Element)
        const doc = el.ownerDocument || document;
        const hitTarget = doc.elementFromPoint(x, y);
        const target = (hitTarget instanceof HTMLElement && el.contains(hitTarget)) ? hitTarget : el;

        const pointerOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', view: window };
        const mouseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };

        // 4. Chuỗi 9 sự kiện theo chuẩn W3C Pointer & Mouse Events của Alibaba
        target.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
        target.dispatchEvent(new PointerEvent('pointerenter', { ...pointerOpts, bubbles: false }));
        target.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
        target.dispatchEvent(new MouseEvent('mouseenter', { ...mouseOpts, bubbles: false }));

        target.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
        target.dispatchEvent(new MouseEvent('mousedown', mouseOpts));

        el.focus({ preventScroll: true });

        target.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
        target.dispatchEvent(new MouseEvent('mouseup', mouseOpts));

        target.click();

        return {
          ok: true,
          message: `Đã kích hoạt click W3C thành công trên [${targetIndex}] <${el.tagName.toLowerCase()}> "${(el.innerText || el.textContent || '').trim().slice(0, 40)}"`
        };
      }
    });

    return results?.[0]?.result || { ok: false, message: "Lỗi thực thi lệnh click" };
  }

  /**
   * Nhập văn bản chuyên sâu với getNativeValueSetter (React 17/18 bypass) + ContentEditable
   */
  static async typeElement(index: number, text: string, pressEnter = false, preferredUrlPattern?: string): Promise<{ ok: boolean; message: string }> {
    const tabId = await this.ensureControlledTab(preferredUrlPattern);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [index, text, pressEnter],
      func: (targetIndex: number, textToType: string, shouldEnter: boolean) => {
        let el = targetIndex > 0 ? document.querySelector<HTMLElement>(`[data-otter-index="${targetIndex}"]`) : null;
        if (!el && targetIndex > 0) {
          const elements: HTMLElement[] = (window as any).__otter_elements || (window as any).__chatmcp_elements || [];
          el = elements[targetIndex - 1] as HTMLElement;
        }
        if (!el) {
          // Fallback 1: document.activeElement (vừa focus sau khi click nút Trả lời)
          const active = document.activeElement as HTMLElement;
          if (active && (active.isContentEditable || active.getAttribute('role') === 'textbox' || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
            el = active;
          }
        }
        if (!el) {
          // Fallback 2: tìm ô nhập reply/comment đang mở gần nhất
          const activeBoxes = Array.from(document.querySelectorAll<HTMLElement>('[role="textbox"][contenteditable="true"], div[contenteditable="true"]'));
          if (activeBoxes.length > 0) {
            el = activeBoxes[activeBoxes.length - 1];
          }
        }
        if (!el) {
          return { ok: false, message: `Không tìm thấy phần tử có chỉ số [${targetIndex}]` };
        }

        // Cuộn và focus
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
        el.focus();

        const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
        const isInput = el.tagName.toLowerCase() === 'input';
        const isTextArea = el.tagName.toLowerCase() === 'textarea';

        if (isInput || isTextArea) {
          const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
          
          // Lấy native value setter từ prototype để vượt qua React Synthetic Events
          const proto = isInput ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

          // Xóa nội dung cũ trước
          inputEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContent' }));
          if (nativeSetter) {
            nativeSetter.call(inputEl, '');
          } else {
            inputEl.value = '';
          }
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }));

          // Gõ nội dung mới
          inputEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: textToType }));
          if (nativeSetter) {
            nativeSetter.call(inputEl, textToType);
          } else {
            inputEl.value = textToType;
          }
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: textToType }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (isContentEditable) {
          // Xử lý Rich Text / ContentEditable (Quill, Slate, ProseMirror, Lexical)
          const lexicalEditor = (el as any).__lexicalEditor || (el.closest('[data-lexical-editor]') as any)?.__lexicalEditor;
          if (lexicalEditor && typeof lexicalEditor.parseEditorState === 'function' && typeof lexicalEditor.setEditorState === 'function') {
            try {
              // Đối với Lexical (Facebook, Instagram, Threads): dùng API chuẩn để thay thế toàn bộ State, triệt tiêu hoàn toàn lỗi lặp chữ/trùng nội dung
              const newState = {
                root: {
                  children: [
                    {
                      children: [
                        {
                          detail: 0,
                          format: 0,
                          mode: "normal",
                          style: "",
                          text: textToType,
                          type: "text",
                          version: 1
                        }
                      ],
                      direction: null,
                      format: "",
                      indent: 0,
                      textFormat: 0,
                      textStyle: "",
                      type: "paragraph",
                      version: 1
                    }
                  ],
                  direction: null,
                  format: "",
                  indent: 0,
                  type: "root",
                  version: 1
                }
              };
              const parsed = lexicalEditor.parseEditorState(JSON.stringify(newState));
              lexicalEditor.setEditorState(parsed);
              lexicalEditor.focus();
            } catch {
              el.innerText = textToType;
            }
          } else {
            try {
              const doc = el.ownerDocument || document;
              const selection = (doc.defaultView || window).getSelection();
              const range = doc.createRange();
              range.selectNodeContents(el);
              selection?.removeAllRanges();
              selection?.addRange(range);

              doc.execCommand('delete', false);
              doc.execCommand('insertText', false, textToType);
            } catch {
              el.innerText = textToType;
            }
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          // Thẻ thông thường
          el.innerText = textToType;
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // Nhấn phím Enter (hoặc tự động click nút "Đăng bình luận" của Facebook)
        const ariaLabelLower = (el.getAttribute('aria-label') || '').toLowerCase();
        const isCommentBox = ariaLabelLower.includes('bình luận') ||
                             ariaLabelLower.includes('trả lời') ||
                             ariaLabelLower.includes('comment') ||
                             ariaLabelLower.includes('reply') ||
                             (el.getAttribute('role') === 'textbox' && isContentEditable);

        if (shouldEnter || isCommentBox) {
          // 1. Dispatch phím Enter
          const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
          el.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
          el.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
          el.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

          if ((el as any).form) {
            (el as any).form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }

          // 2. Tìm và click nút "Đăng bình luận" / gửi (ưu tiên tìm trong container lân cận của ô nhập)
          setTimeout(() => {
            let container: HTMLElement | null = el.parentElement;
            let sendBtn: HTMLElement | null = null;
            for (let i = 0; i < 8; i++) {
              if (!container) break;
              sendBtn = container.querySelector<HTMLElement>(
                'div[role="button"][aria-label*="Đăng bình luận"], div[role="button"][aria-label*="Comment"], div[role="button"][aria-label*="Nhấn Enter để gửi"], div[role="button"][aria-label*="Press Enter to send"]'
              );
              if (sendBtn) break;
              container = container.parentElement;
            }
            if (!sendBtn) {
              sendBtn = document.querySelector<HTMLElement>(
                'div[role="button"][aria-label*="Đăng bình luận"], div[role="button"][aria-label*="Comment"]'
              );
            }
            if (sendBtn) {
              sendBtn.click();
            }
          }, 350);
        }

        return {
          ok: true,
          message: `Đã nhập "${textToType}" vào [${targetIndex}] <${el.tagName.toLowerCase()}> thành công${shouldEnter ? ' (kèm nhấn Enter)' : ''}`
        };
      }
    });

    return results?.[0]?.result || { ok: false, message: "Lỗi thực thi lệnh gõ văn bản" };
  }

  /**
   * Chọn Option trong thẻ <select> dropdown (selectOptionElement của Alibaba)
   */
  static async selectOption(index: number, optionValueOrText: string): Promise<{ ok: boolean; message: string }> {
    const tabId = await this.ensureControlledTab();

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [index, optionValueOrText],
      func: (targetIndex: number, optionChoice: string) => {
        let el = document.querySelector<HTMLElement>(`[data-otter-index="${targetIndex}"]`);
        if (!el) {
          const elements: HTMLElement[] = (window as any).__otter_elements || (window as any).__chatmcp_elements || [];
          el = elements[targetIndex - 1];
        }
        if (!el || el.tagName.toLowerCase() !== 'select') {
          return { ok: false, message: `Phần tử [${targetIndex}] không phải là thẻ dropdown <select>` };
        }

        const selectEl = el as HTMLSelectElement;
        const options = Array.from(selectEl.options);
        const choiceLower = optionChoice.trim().toLowerCase();

        // Tìm option khớp theo text hoặc value
        const matched = options.find(opt => 
          opt.text.trim().toLowerCase() === choiceLower ||
          opt.value.trim().toLowerCase() === choiceLower ||
          opt.text.trim().toLowerCase().includes(choiceLower)
        );

        if (!matched) {
          const available = options.map(o => `"${o.text.trim()}"`).join(', ');
          return { ok: false, message: `Không tìm thấy option "${optionChoice}". Các lựa chọn có sẵn: ${available}` };
        }

        selectEl.value = matched.value;
        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));

        return {
          ok: true,
          message: `Đã chọn option "${matched.text.trim()}" (value: "${matched.value}") trên dropdown [${targetIndex}]`
        };
      }
    });

    return results?.[0]?.result || { ok: false, message: "Lỗi chọn dropdown" };
  }

  /**
   * Cuộn trang thông minh, hỗ trợ infinite scroll (Facebook Comet, YouTube, Twitter/X) và phát hiện chạm đáy
   */
  static async scrollPage(direction: "up" | "down", amount = 800): Promise<{
    ok: boolean;
    message: string;
    scrollY: number;
    scrollHeight: number;
    reachedBottom?: boolean;
  }> {
    const tabId = await this.ensureControlledTab();

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [direction, amount],
      func: (dir: "up" | "down", px: number) => {
        return new Promise((resolve) => {
          const delta = dir === "down" ? px : -px;

          // 1. Cuộn qua standard window.scrollBy
          window.scrollBy({ top: delta, behavior: "smooth" });

          // 2. Dự phòng trực tiếp trên scrollingElement
          const scroller = document.scrollingElement || document.documentElement || document.body;
          if (scroller) {
            scroller.scrollTop += delta;
          }

          // 3. Dispatch sự kiện scroll & wheel W3C để kích hoạt infinite loading
          try {
            window.dispatchEvent(new Event("scroll", { bubbles: true }));
            window.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
            document.dispatchEvent(new Event("scroll", { bubbles: true }));
          } catch {}

          // 4. Nếu cuộn xuống trên Facebook / Feed: cuộn article cuối cùng vào tầm nhìn (scrollIntoView)
          try {
            const articles = Array.from(document.querySelectorAll<HTMLElement>('[role="article"], div[role="feed"] > div'));
            if (articles.length > 0 && dir === "down") {
              const last = articles[articles.length - 1];
              last.scrollIntoView({ behavior: "smooth", block: "end" });
            }
          } catch {}

          // 5. Tự động click nút 'Thử lại' / 'Tải lại' nếu xuất hiện thông báo lỗi tải tin của Facebook
          try {
            const retryButtons = Array.from(document.querySelectorAll<HTMLElement>('[role="button"], span, div'))
              .filter(el => {
                const txt = (el.innerText || '').trim();
                return (txt === 'Thử lại' || txt === 'Tải lại' || txt.includes('thử tải lại')) && el.offsetParent !== null;
              });
            if (retryButtons.length > 0) {
              retryButtons[0].click();
            }
          } catch {}

          // 6. Chờ DOM ổn định và kiểm tra trạng thái cuộn
          setTimeout(() => {
            const currentY = Math.round(window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0);
            const currentH = document.documentElement.scrollHeight;
            const clientH = window.innerHeight || document.documentElement.clientHeight || 0;
            const reachedBottom = dir === "down" && (currentY + clientH >= currentH - 50);

            // Nếu đã chạm đáy tuyệt đối của DOM mà chưa tải thêm, thực hiện cú nhấp (bounce) nhẹ để kích hoạt IntersectionObserver
            if (reachedBottom) {
              window.scrollBy({ top: -120, behavior: "instant" });
              setTimeout(() => {
                window.scrollBy({ top: 150, behavior: "instant" });
                window.dispatchEvent(new Event("scroll", { bubbles: true }));
                window.dispatchEvent(new WheelEvent("wheel", { deltaY: 300, bubbles: true }));
              }, 100);
            }

            resolve({
              ok: true,
              message: `Đã cuộn trang ${dir === "down" ? "xuống" : "lên"} ${px}px (vị trí hiện tại: ${currentY}px, chiều cao trang: ${currentH}px${reachedBottom ? ' - Đã chạm đáy' : ''})`,
              scrollY: currentY,
              scrollHeight: currentH,
              reachedBottom
            });
          }, 600);
        });
      }
    });

    return results?.[0]?.result || { ok: false, message: "Lỗi cuộn trang", scrollY: 0, scrollHeight: 0 };
  }

  /**
   * Đóng tất cả các khung chat / hộp thoại Messenger đang mở nổi trên Facebook
   */
  static async closeMessengerDocks(): Promise<{ ok: boolean; closedCount: number; message: string }> {
    const tabId = await this.ensureControlledTab("facebook.com");

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const closeSelectors = [
          'div[role="button"][aria-label*="Đóng đoạn chat"]',
          'div[role="button"][aria-label*="Đóng cuộc trò chuyện"]',
          'div[role="button"][aria-label*="Close chat"]',
          'div[role="button"][aria-label*="Close conversation"]'
        ];
        const buttons = Array.from(document.querySelectorAll<HTMLElement>(closeSelectors.join(', ')));
        let closedCount = 0;
        for (const btn of buttons) {
          try {
            btn.click();
            closedCount++;
          } catch {}
        }
        return {
          closedCount,
          hasRemaining: document.querySelectorAll(closeSelectors.join(', ')).length > 0
        };
      }
    });

    const res = results?.[0]?.result || { closedCount: 0 };
    return {
      ok: true,
      closedCount: res.closedCount,
      message: res.closedCount > 0
        ? `Đã đóng thành công ${res.closedCount} khung chat Messenger đang mở trên màn hình.`
        : "Không có khung chat Messenger nào đang mở cần đóng."
    };
  }

  /**
   * Liệt kê danh sách tất cả các tab đang mở trên trình duyệt
   */
  static async listTabs(): Promise<{
    tabs: Array<{ id: number; title: string; url: string; active: boolean; isControlled: boolean }>;
    controlledTabId: number | null;
  }> {
    const allTabs = await chrome.tabs.query({});
    return {
      controlledTabId,
      tabs: allTabs
        .filter(t => t.id && !t.url?.startsWith("chrome-extension://"))
        .map(t => ({
          id: t.id!,
          title: t.title || "",
          url: t.url || "",
          active: !!t.active,
          isControlled: t.id === controlledTabId
        }))
    };
  }

  /**
   * Chuyển tab đang điều khiển sang một tab cụ thể
   */
  static async switchTab(tabId: number): Promise<{ ok: boolean; message: string; tabId: number; title: string }> {
    const tab = await chrome.tabs.update(tabId, { active: true });
    controlledTabId = tabId;
    return {
      ok: true,
      message: `Đã chuyển sang điều khiển tab [ID: ${tabId}] - "${tab.title || ''}"`,
      tabId,
      title: tab.title || ""
    };
  }

  /**
   * Đóng một tab trình duyệt (mặc định đóng tab đang điều khiển)
   */
  static async closeTab(tabId?: number): Promise<{ ok: boolean; message: string; closedTabId: number }> {
    const targetId = tabId || await this.ensureControlledTab();
    const tabInfo = await chrome.tabs.get(targetId).catch(() => null);
    await chrome.tabs.remove(targetId);
    if (controlledTabId === targetId) {
      controlledTabId = null;
    }
    return {
      ok: true,
      message: `Đã đóng tab [ID: ${targetId}] ("${tabInfo?.title || ''}") thành công.`,
      closedTabId: targetId
    };
  }

  /**
   * Quay lại trang trước
   */
  static async goBack(): Promise<{ ok: boolean; message: string }> {
    const tabId = await this.ensureControlledTab();
    await chrome.tabs.goBack(tabId);
    await this.waitForTabLoaded(tabId);
    return { ok: true, message: "Đã quay lại trang trước" };
  }

  /**
   * Đảm bảo tab đang điều khiển còn mở (hỗ trợ đa cửa sổ & ưu tiên tab đang xem hoặc tab theo tên miền)
   */
  private static async ensureControlledTab(preferredUrlPattern?: string): Promise<number> {
    // 0. Nếu có preferredUrlPattern (ví dụ "facebook.com"):
    if (preferredUrlPattern && preferredUrlPattern.trim()) {
      const pattern = preferredUrlPattern.trim().toLowerCase();
      try {
        const allTabs = await chrome.tabs.query({});
        const matched = allTabs.find(t => t.id && t.url && t.url.toLowerCase().includes(pattern));
        if (matched?.id) {
          controlledTabId = matched.id;
          return matched.id;
        }
      } catch {}
    }

    // 1. Nếu tab đã lưu vẫn còn mở và không phải chatgpt hay chrome:// -> tiếp tục dùng
    if (controlledTabId) {
      try {
        const tab = await chrome.tabs.get(controlledTabId);
        if (tab && tab.url && !tab.url.includes("chatgpt.com") && !tab.url.startsWith("chrome://")) {
          return controlledTabId;
        }
      } catch {
        controlledTabId = null;
      }
    }

    // 2. Tìm tab active ở cửa sổ tương tác gần nhất (lastFocusedWindow)
    try {
      const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const current = activeTabs[0];
      if (current?.id && current.url && !current.url.includes("chatgpt.com") && !current.url.startsWith("chrome://")) {
        controlledTabId = current.id;
        return controlledTabId;
      }
    } catch {}

    // 3. Tìm bất kỳ tab active nào khác trên toàn bộ các cửa sổ
    try {
      const allActiveTabs = await chrome.tabs.query({ active: true });
      const activeTarget = allActiveTabs.find(t => t.id && t.url && !t.url.includes("chatgpt.com") && !t.url.startsWith("chrome://"));
      if (activeTarget?.id) {
        controlledTabId = activeTarget.id;
        return controlledTabId;
      }
    } catch {}

    // 4. Tìm bất kỳ tab thông thường nào không phải chatgpt.com và không phải chrome://
    const allTabs = await chrome.tabs.query({});
    const targetTab = allTabs.reverse().find(t => t.id && t.url && !t.url.includes("chatgpt.com") && !t.url.startsWith("chrome://"));
    if (targetTab?.id) {
      controlledTabId = targetTab.id;
      return controlledTabId;
    }

    throw new Error("Chưa có trang web nào được mở để điều khiển. Bạn hãy mở tab trang web (ví dụ: YouTube, Google...) trên trình duyệt hoặc gọi lệnh browser_open.");
  }

  /**
   * Chờ tab load xong
   */
  private static waitForTabLoaded(tabId: number, expectedUrl?: string, timeoutMs = 8000): Promise<void> {
    return new Promise(async (resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timer);
          resolve();
        }
      };

      const timer = setTimeout(done, timeoutMs);

      // Nếu tab đã complete sẵn và URL đã đúng expectedUrl (hoặc không yêu cầu URL)
      const initial = await chrome.tabs.get(tabId).catch(() => null);
      const isUrlMatch = !expectedUrl ||
        initial?.url === expectedUrl ||
        (initial?.url && expectedUrl && initial.url.startsWith(expectedUrl));

      if (initial?.status === "complete" && isUrlMatch) {
        setTimeout(done, 500);
        return;
      }

      const listener = (id: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
        if (id === tabId && changeInfo.status === "complete") {
          const tabUrlMatch = !expectedUrl ||
            tab.url === expectedUrl ||
            (tab.url && expectedUrl && tab.url.startsWith(expectedUrl));
          if (tabUrlMatch) {
            setTimeout(done, 500);
          }
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
    });
  }

  /**
   * Inject Visual HUD + Live Hover Inspector lên trang web
   * @param tabId ID của tab
   * @param isToggle Có phải hành động toggle khi bấm icon hay không
   */
  static async injectActivationHud(tabId: number, isToggle = false): Promise<{ ok: boolean; active: boolean; title: string }> {
    controlledTabId = tabId;
    try {
      chrome.storage?.session?.set({ controlledTabId }).catch(() => {});
    } catch {}

    // Cập nhật Badge trên toolbar của Extension
    try {
      await chrome.action.setBadgeText({ text: "ON", tabId });
      await chrome.action.setBadgeBackgroundColor({ color: "#10b981", tabId });
    } catch {}

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [isToggle],
      func: (toggle: boolean) => {
        const HUD_ID = "otter-activation-hud";
        const FRAME_ID = "otter-viewport-frame";
        const INSPECTOR_ID = "otter-hover-inspector";
        const STYLE_ID = "otter-activation-styles";

        const existingHud = document.getElementById(HUD_ID);
        if (existingHud) {
          if (toggle) {
            existingHud.remove();
            document.getElementById(FRAME_ID)?.remove();
            document.getElementById(INSPECTOR_ID)?.remove();
            document.getElementById(STYLE_ID)?.remove();
            const oldHandler = (window as any).__otter_hover_handler;
            if (oldHandler) {
              document.removeEventListener("mousemove", oldHandler);
              (window as any).__otter_hover_handler = null;
            }
            try {
              chrome.runtime.sendMessage({ type: "deactivate-tab" });
            } catch {}
            return { active: false, message: "Đã hủy kích hoạt Otter trên tab này" };
          } else {
            return { active: true, message: "HUD đã tồn tại" };
          }
        }

        // --- 1. Viền sáng xung quanh Viewport báo hiệu trạng thái Active ---
        const frame = document.createElement("div");
        frame.id = FRAME_ID;
        frame.style.cssText = `
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2147483640;
          box-shadow: inset 0 0 0 3px #10b981, inset 0 0 30px rgba(16, 185, 129, 0.35);
          animation: otter-glow-pulse 2s infinite ease-in-out;
        `;

        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
          @keyframes otter-glow-pulse {
            0%, 100% { box-shadow: inset 0 0 0 3px #10b981, inset 0 0 25px rgba(16, 185, 129, 0.3); }
            50% { box-shadow: inset 0 0 0 4px #059669, inset 0 0 45px rgba(16, 185, 129, 0.55); }
          }
          @keyframes otter-slide-down {
            from { transform: translate(-50%, -100%); opacity: 0; }
            to { transform: translate(-50%, 0); opacity: 1; }
          }
          @keyframes otter-dot-pulse {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.3); opacity: 0.7; }
          }
        `;
        document.head.appendChild(style);
        document.body.appendChild(frame);

        // --- 2. Floating Pill Banner thông báo ở trên cùng ---
        const hud = document.createElement("div");
        hud.id = HUD_ID;
        hud.style.cssText = `
          position: fixed;
          top: 14px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(15, 23, 42, 0.94);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #ffffff;
          padding: 8px 18px;
          border-radius: 9999px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(16, 185, 129, 0.5);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          font-size: 13px;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 10px;
          z-index: 2147483647;
          pointer-events: auto;
          user-select: none;
          animation: otter-slide-down 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        `;

        hud.innerHTML = `
          <span style="display:inline-block; width:10px; height:10px; background:#10b981; border-radius:50%; box-shadow:0 0 10px #10b981; animation: otter-dot-pulse 1.5s infinite;"></span>
          <span style="letter-spacing: 0.3px;">🦦 <strong>Otter Active</strong> &bull; Sẵn sàng cho ChatGPT Web điều khiển</span>
          <button id="otter-hud-close" style="background:transparent; border:none; color:#94a3b8; font-size:18px; cursor:pointer; padding:0 4px; line-height:1; margin-left:6px;" title="Tắt kích hoạt">&times;</button>
        `;

        document.body.appendChild(hud);

        const closeBtn = hud.querySelector("#otter-hud-close");
        closeBtn?.addEventListener("click", () => {
          frame.remove();
          hud.remove();
          inspector.remove();
          style.remove();
          const handler = (window as any).__otter_hover_handler;
          if (handler) {
            document.removeEventListener("mousemove", handler);
            (window as any).__otter_hover_handler = null;
          }
          try {
            chrome.runtime.sendMessage({ type: "deactivate-tab" });
          } catch {}
        });

        // --- 3. Live Hover Inspector: Di chuột đến đâu hover outline đến đó ---
        const inspector = document.createElement("div");
        inspector.id = INSPECTOR_ID;
        inspector.style.cssText = `
          position: fixed;
          display: none;
          pointer-events: none;
          z-index: 2147483645;
          border: 2px dashed #10b981;
          background: rgba(16, 185, 129, 0.12);
          border-radius: 4px;
          transition: all 0.06s ease-out;
        `;

        const tooltip = document.createElement("div");
        tooltip.style.cssText = `
          position: absolute;
          bottom: calc(100% + 4px);
          left: 0;
          background: #0f172a;
          color: #34d399;
          font-family: ui-monospace, SFMono-Regular, monospace;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 4px;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          border: 1px solid rgba(16, 185, 129, 0.6);
          pointer-events: none;
        `;
        inspector.appendChild(tooltip);
        document.body.appendChild(inspector);

        let lastTarget: HTMLElement | null = null;
        const onMouseMove = (e: MouseEvent) => {
          const target = e.target as HTMLElement;
          if (!target || target === frame || target === hud || hud.contains(target) || target === inspector || inspector.contains(target)) {
            inspector.style.display = "none";
            return;
          }

          if (target === lastTarget) return;
          lastTarget = target;

          const rect = target.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            inspector.style.display = "none";
            return;
          }

          inspector.style.display = "block";
          inspector.style.top = `${rect.top}px`;
          inspector.style.left = `${rect.left}px`;
          inspector.style.width = `${rect.width}px`;
          inspector.style.height = `${rect.height}px`;

          const tag = target.tagName.toLowerCase();
          const role = target.getAttribute("role");
          const info = role ? `<${tag} [${role}]>` : `<${tag}>`;
          const text = (target.innerText || target.getAttribute("title") || target.getAttribute("aria-label") || "").trim().slice(0, 24);
          tooltip.textContent = text ? `${info} "${text}"` : info;
        };

        (window as any).__otter_hover_handler = onMouseMove;
        document.addEventListener("mousemove", onMouseMove, { passive: true });

        return { active: true, message: "Kích hoạt thành công" };
      }
    });

    const activeState = results?.[0]?.result?.active ?? true;
    if (!activeState) {
      this.clearControlledTab();
      try {
        await chrome.action.setBadgeText({ text: "", tabId });
      } catch {}
    }

    const tab = await chrome.tabs.get(tabId);
    return { ok: true, active: activeState, title: tab.title || "" };
  }

  static async activateTab(tabId: number): Promise<{ ok: boolean; active: boolean; title: string }> {
    return await this.injectActivationHud(tabId, true);
  }

  static clearControlledTab() {
    controlledTabId = null;
    try {
      chrome.storage?.session?.remove("controlledTabId").catch(() => {});
    } catch {}
  }

  static getControlledTabId(): number | null {
    return controlledTabId;
  }

  /**
   * Giao nhiệm vụ cho AI Agent Muse trên web (muse.ai) xử lý ngầm và thu thập phản hồi
   */
  static async askMuse(task: string, options?: { newThread?: boolean; timeoutMs?: number; closeTabOnDone?: boolean }): Promise<{
    ok: boolean;
    replyText: string;
    attachments: Array<{ type: string; url: string; title?: string }>;
    tabId?: number;
    error?: string;
  }> {
    const timeout = options?.timeoutMs || 180000;
    const deadline = Date.now() + timeout;

    // 1. Lưu lại tab hiện tại của người dùng (ChatGPT) để phục hồi ngay sau khi kích hoạt
    const [currentActiveTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const originalTabId = currentActiveTab?.id;

    // Tìm tab muse.ai hiện có hoặc mở mới
    const tabs = await chrome.tabs.query({});
    let museTab = tabs.find(t => t.url && t.url.includes("muse.ai"));
    let created = false;

    if (!museTab) {
      museTab = await chrome.tabs.create({
        url: "https://muse.ai/thread/new",
        active: false
      });
      created = true;
      if (museTab.id) {
        await this.waitForTabLoaded(museTab.id, "https://muse.ai/thread/new", 15000);
      }
    } else if (options?.newThread) {
      // Tái sử dụng tab Muse hiện có thay vì đẻ ra hàng loạt tab mới làm gián đoạn
      if (museTab.id) {
        await chrome.tabs.update(museTab.id, { url: "https://muse.ai/thread/new" });
        await this.waitForTabLoaded(museTab.id, "https://muse.ai/thread/new", 15000);
      }
    }

    if (!museTab?.id) {
      return { ok: false, replyText: "", attachments: [], error: "Không thể mở tab muse.ai" };
    }

    const tabId = museTab.id;

    try {
      // 2. Chờ DOM muse.ai sẵn sàng (React textarea xuất hiện, không còn 'Connecting...')
      const readyDeadline = Date.now() + 25000;
      let isReady = false;
      while (Date.now() < readyDeadline) {
        const checkRes = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Tự động đóng sạch mọi modal popup, dialog quota hay menu gợi ý trên Muse nếu có
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[class*="modal"]'));
            for (const d of dialogs) {
              const closeBtn = d.querySelector('button[aria-label*="close" i], button[aria-label*="đóng" i], [data-testid*="close" i], [data-testid="modal-close"]') as HTMLElement | null;
              if (closeBtn) {
                try { closeBtn.click(); } catch {}
              } else {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
              }
            }

            const ta = document.querySelector('textarea');
            const body = document.body ? document.body.innerText : '';
            if (body.includes("Log in") || body.includes("Sign in") || body.includes("Đăng nhập")) {
              return "login_required";
            }
            if (body.includes("Connecting...")) return "connecting";
            if (ta && !ta.disabled) return "ready";
            return "loading";
          }
        });
        const status = checkRes?.[0]?.result;
        if (status === "login_required") {
          return {
            ok: false,
            replyText: "",
            attachments: [],
            error: "Tài khoản Muse trên trình duyệt chưa đăng nhập. Vui lòng mở https://muse.ai và đăng nhập tài khoản trước."
          };
        }
        if (status === "ready") {
          isReady = true;
          break;
        }
        await new Promise(r => setTimeout(r, 600));
      }

      if (!isReady) {
        return {
          ok: false,
          replyText: "",
          attachments: [],
          error: "Trang web Muse không sẵn sàng (chưa tải xong ô nhập liệu hoặc kết nối tới gateway mạng bị timeout)."
        };
      }

      // Kích hoạt tab Muse trong 200ms để React 18 nhận DOM Focus cho input event
      await chrome.tabs.update(tabId, { active: true });
      await new Promise(r => setTimeout(r, 150));

      // 3. Inject prompt vào ô nhập và nhấn gửi (chạy trong MAIN world để gắn liền với React synthetic events)
      const sendRes = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [task],
        func: async (promptText) => {
          const ta = document.querySelector('textarea');
          if (!ta) return { ok: false, error: "Không tìm thấy khung nhập tin nhắn" };

          // Ghi lại số lượng bubble và nội dung tin nhắn cuối trước khi gửi để hỗ trợ hội thoại nhiều lượt (multi-turn)
          const oldBubbles = Array.from(document.querySelectorAll('div[class*="hatch-chat-groupable-bubble"], div[class*="hatch-agent-bubble-bg"], [class*="group/msg"]'))
            .filter(b => !b.closest('[class*="chat-user-bubble"]'));
          const oldBubbleCount = oldBubbles.length;
          const oldLastText = oldBubbleCount > 0 ? ((oldBubbles[oldBubbleCount - 1] as HTMLElement).innerText || '').trim() : '';

          ta.scrollIntoView({ block: 'center', inline: 'nearest' });
          ta.focus();

          // Kích hoạt setter prototype của HTMLTextAreaElement để React 18 cập nhật state
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(ta, promptText);
          } else {
            ta.value = promptText;
          }
          ta.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

          // Đợi React 18 render nút Gửi sang trạng thái enabled (tối đa 2.5s)
          let sendBtn: HTMLElement | null = null;
          const deadline = Date.now() + 2500;
          while (Date.now() < deadline) {
            const buttons = Array.from(document.querySelectorAll('button, [role="button"]')) as HTMLElement[];
            sendBtn = buttons.find(b => {
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              const text = (b.innerText || '').toLowerCase();
              const testId = (b.getAttribute('data-testid') || '').toLowerCase();
              return (aria.includes('send') || aria.includes('gửi') || text.includes('send') || text.includes('gửi') || testId.includes('send'));
            }) || null;

            if (sendBtn && !(sendBtn as any).disabled) {
              break;
            }
            await new Promise(r => setTimeout(r, 80));
          }

          if (sendBtn) {
            // Thực hiện chuỗi sự kiện click W3C hoàn chỉnh
            const rect = sendBtn.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const pointerOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', view: window };
            const mouseOpts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };

            sendBtn.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
            sendBtn.dispatchEvent(new PointerEvent('pointerenter', { ...pointerOpts, bubbles: false }));
            sendBtn.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
            sendBtn.dispatchEvent(new MouseEvent('mouseenter', { ...mouseOpts, bubbles: false }));
            sendBtn.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
            sendBtn.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
            sendBtn.focus();
            sendBtn.dispatchEvent(new PointerEvent('pointerup', pointerOpts));
            sendBtn.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
            sendBtn.click();

            const form = sendBtn.closest('form');
            if (form && typeof (form as any).requestSubmit === 'function') {
              try { (form as any).requestSubmit(sendBtn); } catch {}
            }
          }

          // Kiểm tra xem textarea đã gửi đi chưa (Muse xóa textarea khi gửi thành công)
          await new Promise(r => setTimeout(r, 250));
          if (ta.value && ta.value.trim().length > 0) {
            // Fallback: Dispatch Enter key
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          return { ok: true, oldBubbleCount, oldLastText };
        }
      });

      // Phục hồi lại tiêu điểm cho tab ChatGPT ban đầu của người dùng ngay lập tức
      if (originalTabId && originalTabId !== tabId) {
        await chrome.tabs.update(originalTabId, { active: true }).catch(() => {});
      }

      if (!sendRes?.[0]?.result?.ok) {
        return { ok: false, replyText: "", attachments: [], error: sendRes?.[0]?.result?.error || "Gửi prompt vào Muse thất bại" };
      }

      const { oldBubbleCount = 0, oldLastText = "" } = sendRes[0].result;

      // 4. Lắng nghe quá trình Muse hoàn thành tác vụ
      let lastText = "";
      let stableCount = 0;
      let hasStarted = false;

      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));

        const pollRes = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: () => {
            const scope = document.querySelector('main,[class*="chat-scroll"],[class*="hatch-chat-scroll"]') || document.body;
            // Lấy nội dung bubble mới nhất của Muse (loại trừ bubble câu hỏi của user)
            const agentBubbles = Array.from(scope.querySelectorAll('div[class*="hatch-chat-groupable-bubble"], div[class*="hatch-agent-bubble-bg"], [class*="group/msg"]'))
              .filter(b => !b.closest('[class*="chat-user-bubble"]'));
            const bubbleCount = agentBubbles.length;
            const lastBubble = agentBubbles[agentBubbles.length - 1] as HTMLElement | null;
            let text = lastBubble ? (lastBubble.innerText || '').trim() : '';

            // Nếu không lấy được bằng selector trên, fallback tìm trong các khối tin nhắn
            if (!text) {
              const allBubbles = Array.from(document.querySelectorAll('div[class*="agent-bubble"], [data-message-author-role="assistant"]'));
              if (allBubbles.length > 0) {
                text = ((allBubbles[allBubbles.length - 1] as HTMLElement).innerText || '').trim();
              }
            }

            // Kiểm tra nút Stop (đang sinh)
            const stopBtn = document.querySelector('[data-testid="hatch-composer-stop-button"], button[aria-label*="Stop" i], button[aria-label*="停止"], button[aria-label*="Dừng" i]');
            const hasStop = !!stopBtn;

            // Kiểm tra attachment (video, ảnh, code artifact)
            const attNodes = Array.from(document.querySelectorAll('[data-testid^="hatch-chat-attachment-presentation-"], div[class*="hatch-agent-bubble-bg"] video, div[class*="hatch-agent-bubble-bg"] img'));
            const attachments = attNodes.map(el => {
              const video = el.querySelector('video') || (el.tagName === 'VIDEO' ? el as HTMLVideoElement : null);
              const img = el.querySelector('img') || (el.tagName === 'IMG' ? el as HTMLImageElement : null);
              const src = video ? (video.currentSrc || video.src) : (img ? (img.currentSrc || img.src) : '');
              return {
                type: video ? 'video' : 'image',
                url: src
              };
            }).filter(a => !!a.url && !a.url.includes('avatar') && !a.url.includes('emoji'));

            const bodyText = document.body ? document.body.innerText : '';
            const isOutOfCredits = /out of credits|đạt giới hạn|hết hạn ngạch/i.test(bodyText);

            return {
              bubbleCount,
              text,
              hasStop,
              attachments,
              isOutOfCredits
            };
          }
        });

        const state = pollRes?.[0]?.result;
        if (!state) continue;

        if (state.isOutOfCredits) {
          return { ok: false, replyText: "", attachments: [], error: "Tài khoản Muse trên web đã hết hạn ngạch sử dụng (Out of credits)" };
        }

        // Nhận diện Muse đã bắt đầu sinh lượt mới: xuất hiện nút Stop, hoặc số bubble tăng, hoặc text khác text cũ
        const isNewBubble = state.bubbleCount > oldBubbleCount;
        const isTextUpdated = state.text !== oldLastText && state.text.length > 0;
        if (!hasStarted && (state.hasStop || isNewBubble || isTextUpdated)) {
          hasStarted = true;
        }

        if (hasStarted) {
          if (state.text === lastText && state.text.length > 0) {
            stableCount++;
            // Hoàn thành khi:
            // 1. Không còn nút Stop và văn bản giữ nguyên ít nhất 2 giây (hoặc có media attachment)
            // 2. HOẶC văn bản giữ nguyên ổn định ít nhất 5 giây (kể cả khi nút Stop/Dừng vẫn hiển thị, cơ chế tương tự muse2api chống kẹt khi Muse giữ kết nối session)
            const isFinished = (!state.hasStop && (stableCount >= 2 || (state.attachments?.length || 0) > 0)) || (stableCount >= 5);
            if (isFinished) {
              // Tự động tải blob dữ liệu của video/ảnh thành Base64 ngay trong tab đã xác thực
              const finalAtts = state.attachments || [];
              for (const a of finalAtts) {
                if (!a.url) continue;
                try {
                  const extractRes = await chrome.scripting.executeScript({
                    target: { tabId },
                    args: [a.url],
                    func: async (mediaUrl) => {
                      try {
                        const resp = await fetch(mediaUrl);
                        if (!resp.ok) return null;
                        const blob = await resp.blob();
                        return new Promise<{ base64: string; mime: string; size: number } | null>((resolve) => {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            const dataUrl = reader.result as string;
                            if (!dataUrl) return resolve(null);
                            const b64 = dataUrl.split(",")[1] || "";
                            resolve({
                              base64: b64,
                              mime: blob.type || "",
                              size: blob.size || 0
                            });
                          };
                          reader.onerror = () => resolve(null);
                          reader.readAsDataURL(blob);
                        });
                      } catch {
                        return null;
                      }
                    }
                  });
                  const extracted = extractRes?.[0]?.result;
                  if (extracted && extracted.base64) {
                    (a as any).base64 = extracted.base64;
                    (a as any).mime = extracted.mime;
                    (a as any).size = extracted.size;
                  }
                } catch (err) {
                  console.warn("[Otter Muse] Trích xuất media thất bại:", err);
                }
              }

              return {
                ok: true,
                replyText: state.text,
                attachments: finalAtts,
                tabId
              };
            }
          } else {
            lastText = state.text;
            stableCount = 0;
          }
        }
      }

      return {
        ok: false,
        replyText: lastText,
        attachments: [],
        error: `Quá thời gian chờ (${Math.round(timeout / 1000)}s) phản hồi từ Muse.`
      };
    } finally {
      if (options?.closeTabOnDone && created) {
        try {
          await chrome.tabs.remove(tabId);
        } catch {}
      }
    }
  }
}
