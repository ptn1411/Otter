import { getTabServer, setTabServer, getServers, DEFAULT_SERVERS } from "./server-registry";
import { ApiClient } from "./api-client";
import { DaemonWebSocketClient } from "./websocket-client";
import { BrowserController } from "./browser-controller";

console.log("[Otter Background] Service Worker Initialized");

// Kết nối WebSocket trực tiếp và thường trực 24/7 từ Service Worker tới Daemon
let globalWsClient: DaemonWebSocketClient | null = null;

async function initGlobalDaemonConnection() {
  if (globalWsClient) {
    if (!globalWsClient.isConnected()) {
      globalWsClient.connect();
    }
    return;
  }

  let apiBase = "http://127.0.0.1:1993";
  let apiKey: string | undefined = undefined;

  try {
    const servers = await getServers();
    const local = servers.find(s => s.id === "localhost") || DEFAULT_SERVERS[0];
    if (local?.apiBase) apiBase = local.apiBase;
    if (local?.apiKey) apiKey = local.apiKey;
  } catch {}

  globalWsClient = new DaemonWebSocketClient(
    apiBase,
    "global-background-worker",
    {
      onStatusChange: (state, statusMsg) => {
        console.log(`[Otter Global WS] ${state}: ${statusMsg || ""}`);
      },
      onActivityPage: () => {},
      onTerminalOutput: () => {},
      onInjectPrompt: async (text, autoSubmit, injectionId) => {
        try {
          const tabs = await chrome.tabs.query({ url: "*://chatgpt.com/*" });
          const targetTab = tabs.find(t => t.active) || tabs[0];
          if (targetTab?.id) {
            sendToTab(targetTab.id, {
              type: "inject-prompt",
              text,
              autoSubmit: autoSubmit !== false,
              injectionId
            });
            console.log(`[Otter Global WS] Đã chuyển tiếp inject-prompt tới tab ChatGPT [ID: ${targetTab.id}]`);
          } else {
            console.warn("[Otter Global WS] Không tìm thấy tab ChatGPT nào để chuyển tiếp inject-prompt.");
          }
        } catch (err) {
          console.error("[Otter Global WS] Lỗi chuyển tiếp inject-prompt:", err);
        }
      },
      onBrowserAction: async (action, params) => {
        switch (action) {
          case "open":
            return await BrowserController.openUrl(params.url);
          case "read_page":
            return await BrowserController.readPage(params.urlPattern);
          case "click":
            return await BrowserController.clickElement(params.index, params.urlPattern);
          case "type":
            return await BrowserController.typeElement(params.index, params.text, params.pressEnter, params.urlPattern);
          case "select":
            return await BrowserController.selectOption(params.index, params.option);
          case "scroll":
            return await BrowserController.scrollPage(params.direction, params.amount);
          case "back":
            return await BrowserController.goBack();
          case "read_comments":
            return await BrowserController.readComments(params.currentUserName, params.postUrl);
          case "read_feed":
            return await BrowserController.readFeed();
          case "fb_react":
            return await BrowserController.reactFacebook(params.index, params.author, params.reaction);
          case "fb_comment":
            return await BrowserController.commentFacebook({
              commentIndex: params.commentIndex,
              author: params.author,
              commentText: params.commentText
            });
          case "fb_post_to_group":
            return await BrowserController.postToFacebookGroup({
              groupUrl: params.groupUrl,
              content: params.content
            });
          case "fb_post_media":
            return await BrowserController.postMediaToFacebook({
              targetType: params.targetType || "profile",
              targetUrl: params.targetUrl,
              mediaPath: params.mediaPath,
              mediaType: params.mediaType,
              caption: params.caption
            });
          case "close_messenger_docks":
            return await BrowserController.closeMessengerDocks();
          case "close_tab":
            return await BrowserController.closeTab(params.tabId);
          case "list_tabs":
            return await BrowserController.listTabs();
          case "switch_tab":
            return await BrowserController.switchTab(params.tabId);
          case "ask_muse":
            return await BrowserController.askMuse(params.task, {
              newThread: params.newThread,
              timeoutMs: params.timeoutMs,
              closeTabOnDone: params.closeTabOnDone
            });
          case "reload_extension":
            setTimeout(() => chrome.runtime.reload(), 150);
            return { ok: true, message: "Đang nạp lại tiện ích mở rộng Otter..." };
          default:
            throw new Error(`Hành động trình duyệt không xác định: ${action}`);
        }
      }
    },
    apiKey
  );

  globalWsClient.connect();
}

initGlobalDaemonConnection();

// Watchdog định kỳ giữ Service Worker thức và tự phục hồi kết nối WebSocket nếu daemon restart
try {
  chrome.alarms?.create("otter-ws-watchdog", { periodInMinutes: 0.5 });
  chrome.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === "otter-ws-watchdog") {
      initGlobalDaemonConnection();
    }
  });
} catch {}

const activeWsClients = new Map<number, DaemonWebSocketClient>();

function sendToTab(tabId: number, message: any) {
  chrome.tabs.sendMessage(tabId, message).catch(async (err) => {
    console.warn(`[Otter Background] sendToTab [${tabId}] failed: ${err?.message}. Đang tự động nạp lại content script...`);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, message).catch(() => {});
      }, 300);
    } catch {}
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId && message.type !== "options" && message.type !== "show-notification") return false;

  (async () => {
    try {
      const server = tabId ? await getTabServer(tabId) : null;
      const client = server ? new ApiClient(server.apiBase, server.apiKey) : null;

      switch (message.type) {
        case "show-notification": {
          chrome.notifications?.create({
            type: "basic",
            iconUrl: "icons/icon128.png",
            title: message.title || "Otter Assistant",
            message: message.message || "",
            priority: 2
          });
          sendResponse({ ok: true });
          break;
        }

        case "options": {
          await chrome.runtime.openOptionsPage();
          sendResponse({ ok: true });
          break;
        }

        case "submit-chatgpt-main-world": {
          if (tabId) {
            await chrome.scripting.executeScript({
              target: { tabId },
              world: "MAIN",
              func: () => {
                const form = document.querySelector("form");
                const submitBtn = (form ? form.querySelector('button[type="submit"]') : null)
                  || document.querySelector('button[aria-label*="Gửi"]')
                  || document.querySelector('button[aria-label*="Send"]')
                  || document.querySelector('button[data-testid*="send"]');

                if (submitBtn && !(submitBtn as HTMLButtonElement).disabled) {
                  const btn = submitBtn as HTMLButtonElement;
                  btn.focus();
                  btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
                  btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
                  btn.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true }));
                  btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
                  btn.click();
                  if (form && typeof form.requestSubmit === "function") {
                    try { form.requestSubmit(btn); } catch {}
                  }
                  return true;
                }

                const composer = document.querySelector("#prompt-textarea") || document.querySelector(".ProseMirror");
                if (composer) {
                  (composer as HTMLElement).focus();
                  composer.dispatchEvent(new KeyboardEvent("keydown", {
                    key: "Enter",
                    code: "Enter",
                    keyCode: 13,
                    which: 13,
                    bubbles: true,
                    cancelable: true
                  }));
                  return true;
                }
                return false;
              }
            }).catch((err) => console.warn("[Otter BG] Lỗi executeScript submit:", err));
          }
          sendResponse({ ok: true });
          break;
        }

        case "chatgpt_turn":
        case "page_loop_status":
        case "lease_heartbeat": {
          // Page-loop: content script báo lượt settle / trạng thái / heartbeat
          // -> forward về daemon qua WS của tab đó (không qua HTTP).
          const wsClient = tabId ? activeWsClients.get(tabId) : undefined;
          if (wsClient) wsClient.sendGeneric(message);
          sendResponse({ ok: true });
          break;
        }

        case "inject-result": {
          // Phase 5 ack: content script báo kết quả inject -> forward về daemon
          // qua WS của tab đó để daemon đánh dấu outbox entry.
          const wsClient = tabId ? activeWsClients.get(tabId) : undefined;
          if (wsClient && message.injectionId) {
            wsClient.sendInjectResult(message.injectionId, message.ok === true, message.error);
          }
          sendResponse({ ok: true });
          break;
        }

        case "get-servers": {
          sendResponse({ ok: true, servers: await getServers(), current: server ? server.id : null });
          break;
        }

        case "set-tab-server": {
          if (!tabId || !message.serverId) { sendResponse({ ok: false }); break; }
          await setTabServer(tabId, message.serverId);
          activeWsClients.get(tabId)?.dispose();
          activeWsClients.delete(tabId);
          sendResponse({ ok: true });
          break;
        }

        case "tab-connect": {
          if (!server || !tabId) break;
          // Đóng websocket cũ của tab nếu có
          activeWsClients.get(tabId)?.dispose();

          const wsClient = new DaemonWebSocketClient(
            server.apiBase,
            message.conversationUrl,
            {
              onStatusChange: (state, statusMsg) => {
                sendToTab(tabId, {
                  type: "server-status",
                  serverName: server.name,
                  state,
                  message: statusMsg
                });
              },
              onActivityPage: (page) => {
                sendToTab(tabId, {
                  type: "activity-page",
                  conversationId: page.conversationId,
                  items: page.items
                });
              },
              onTerminalOutput: (output) => {
                sendToTab(tabId, {
                  type: "terminal-broadcast",
                  output
                });
              },
              onInjectPrompt: (text, autoSubmit, injectionId) => {
                sendToTab(tabId, {
                  type: "inject-prompt",
                  text,
                  autoSubmit: autoSubmit !== false,
                  injectionId
                });
              },
              onPageLoopStart: (loopId) => {
                sendToTab(tabId, { type: "page_loop_start", loopId });
              },
              onPageLoopStop: (loopId, reason) => {
                sendToTab(tabId, { type: "page_loop_stop", loopId, reason });
              },
              onBrowserAction: async (action, params) => {
                switch (action) {
                  case "open":
                    return await BrowserController.openUrl(params.url);
                  case "read_page":
                    return await BrowserController.readPage(params.urlPattern);
                  case "click":
                    return await BrowserController.clickElement(params.index, params.urlPattern);
                  case "type":
                    return await BrowserController.typeElement(params.index, params.text, params.pressEnter, params.urlPattern);
                  case "select":
                    return await BrowserController.selectOption(params.index, params.option);
                  case "scroll":
                    return await BrowserController.scrollPage(params.direction, params.amount);
                  case "back":
                    return await BrowserController.goBack();
                  case "read_comments":
                    return await BrowserController.readComments(params.currentUserName, params.postUrl);
                  case "read_feed":
                    return await BrowserController.readFeed();
                  case "fb_react":
                    return await BrowserController.reactFacebook(params.index, params.author, params.reaction);
                  case "fb_post_media":
                    return await BrowserController.postMediaToFacebook({
                      targetType: params.targetType || "profile",
                      targetUrl: params.targetUrl,
                      mediaPath: params.mediaPath,
                      mediaType: params.mediaType,
                      caption: params.caption
                    });
                  case "ask_muse":
                    return await BrowserController.askMuse(params.task, {
                      newThread: params.newThread,
                      timeoutMs: params.timeoutMs,
                      closeTabOnDone: params.closeTabOnDone
                    });
                  case "reload_extension":
                    setTimeout(() => chrome.runtime.reload(), 150);
                    return { ok: true, message: "Đang nạp lại tiện ích mở rộng Otter..." };
                  default:
                    throw new Error(`Hành động trình duyệt không xác định: ${action}`);
                }
              }
            },
            server.apiKey
          );

          activeWsClients.set(tabId, wsClient);
          wsClient.connect();
          sendResponse({ ok: true });
          break;
        }

        case "pick-folder": {
          if (!client) throw new Error("No active server client");
          const result = await client.pickProjectFolder(message.initialPath);
          sendResponse({ ok: true, path: result.path });
          break;
        }

        case "pick-file": {
          if (!client) throw new Error("No active server client");
          const result = await client.pickFile(message.initialPath, message.multiple);
          sendResponse({ ok: true, path: result.path, paths: result.paths });
          break;
        }

        case "terminal-list": {
          if (!client) throw new Error("No active server client");
          const res = await client.listTerminals(message.conversationId);
          sendResponse({ ok: true, terminals: res.terminals });
          break;
        }

        case "terminal-output": {
          if (!client) throw new Error("No active server client");
          const res = await client.getTerminalLive(
            message.conversationId,
            message.sessionId,
            message.afterSequence,
            message.waitMs
          );
          sendResponse({ ok: true, result: res });
          break;
        }

        case "terminal-input": {
          if (!client) throw new Error("No active server client");
          const res = await client.sendTerminalInput(
            message.conversationId,
            message.sessionId,
            message.text
          );
          sendResponse({ ok: true, accepted: res.accepted });
          break;
        }

        case "control-status": {
          if (!client) throw new Error("No active server client");
          const res = await client.getControl(message.conversationId);
          sendResponse({ ok: true, result: res });
          break;
        }

        case "continuous-set": {
          if (!client) throw new Error("No active server client");
          const res = await client.setContinuous(message.conversationId, message.enabled);
          sendResponse({ ok: true, result: res });
          break;
        }

        case "continuous-extend": {
          if (!client) throw new Error("No active server client");
          const res = await client.extendContinuous(message.conversationId, message.seconds);
          sendResponse({ ok: true, result: res });
          break;
        }

        case "immediate-send": {
          if (!client) throw new Error("No active server client");
          const res = await client.sendImmediate(message.conversationId, message.content);
          sendResponse({ ok: true, result: res });
          break;
        }

        case "deactivate-tab": {
          if (tabId && tabId === BrowserController.getControlledTabId()) {
            BrowserController.clearControlledTab();
            chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (err: any) {
      console.error("[Otter Background] Error handling message:", message.type, err);
      sendResponse({ ok: false, error: err.message });
    }
  })();

  return true; // Giữ kênh sendResponse async
});

// Dọn dẹp khi tab đóng
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === BrowserController.getControlledTabId()) {
    BrowserController.clearControlledTab();
  }
  activeWsClients.get(tabId)?.dispose();
  activeWsClients.delete(tabId);
});

// Tự động duy trì HUD & viền xanh khi trang reload (F5) hoặc chuyển URL mới
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tabId === BrowserController.getControlledTabId()) {
    if (tab.url && !tab.url.startsWith("chrome://") && !tab.url.startsWith("edge://") && !tab.url.includes("chatgpt.com")) {
      try {
        await BrowserController.injectActivationHud(tabId, false);
      } catch (err) {
        console.error("[Otter Background] Lỗi duy trì HUD sau khi reload:", err);
      }
    }
  }
});

// Folderloom Task 4 (bản sửa): phím tắt mở Side Panel, qua Chrome Side Panel API.
// Đây là listener onCommand mới — trước đó background.ts chưa có handler nào.
chrome.commands?.onCommand.addListener((command) => {
  if (command === "open-side-panel") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id && (chrome as any).sidePanel) {
        (chrome as any).sidePanel.open({ tabId: activeTab.id }).catch((err: any) => {
          console.error("[Otter Background] sidePanel.open failed:", err);
        });
      }
    });
  }
});

// Khi người dùng bấm vào icon Extension trên toolbar: Kích hoạt / Hủy kích hoạt tab hiện tại
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  // Nếu bấm trên tab ChatGPT Web (tab Não)
  if (tab.url?.includes("chatgpt.com")) {
    await chrome.action.setBadgeText({ text: "AI", tabId: tab.id });
    await chrome.action.setBadgeBackgroundColor({ color: "#3b82f6", tabId: tab.id });
    return;
  }

  // Không can thiệp trang nội bộ của Chrome
  if (tab.url?.startsWith("chrome://") || tab.url?.startsWith("edge://")) {
    return;
  }

  try {
    await BrowserController.activateTab(tab.id);
  } catch (err) {
    console.error("[Otter Background] Lỗi khi kích hoạt tab qua extension click:", err);
  }
});


