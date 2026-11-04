import { initAutoApproval } from "./approval-auto";
import { initFolderPicker } from "./folder-picker";
import { initCommandPalette } from "./command-palette";
import { TerminalPanel } from "./terminal/terminal-panel";
import { PlanOverlay } from "./plan/plan-overlay";
import { ActivityPanel } from "./panel/activity-panel";
import { injectPromptToChatGPT } from "./chatgpt-injector";
import { ChatGPTTurnWatcher } from "./chatgpt-turn-watcher";
import { isDoneMarker, isCheckpointMarker } from "./chatgpt-turn-reader";
import { initI18n } from "../i18n";
import { initUpdateChecker } from "./update-checker";
import { initTabCoordinator } from "./tab-coordinator";

console.log("[Otter Content] Injecting into ChatGPT Web...");

// Chặn triệt để lỗi "Extension context invalidated" trên toàn bộ trang
window.addEventListener("unhandledrejection", (event) => {
  if (event.reason?.message?.includes("Extension context invalidated") || String(event.reason).includes("Extension context invalidated")) {
    event.preventDefault();
  }
});

function getConversationId(): string {
  const match = location.pathname.match(/\/c\/([a-f0-9-]+)/i);
  return match ? match[1] : "default";
}

function safeSendMessage(message: any): Promise<any> {
  if (!chrome.runtime?.id) {
    return Promise.resolve(null);
  }
  try {
    return chrome.runtime.sendMessage(message).catch((err) => {
      return null;
    });
  } catch (err) {
    return Promise.resolve(null);
  }
}

async function bootstrap() {
  await initI18n();
  const convId = getConversationId();
  const convUrl = location.href;

  // 1. Kích hoạt Auto Approval cho Tool
  initAutoApproval();

  // 2. Kích hoạt Nút chọn Thư mục Dự án
  initFolderPicker();

  // 2.1 Kích hoạt Danh mục Lệnh Mẫu & Slash Commands (/)
  initCommandPalette();

  // 2.2 Điều phối đa tab (Folderloom Task 2, bản sửa): chỉ bầu leader,
  // không gate palette, timer URL, turn watcher hay thao tác người dùng.
  // Tác vụ tự động/lặp trong tương lai dùng isLeaderTab()/runIfLeader().
  initTabCoordinator(() => {
    console.log("[Otter] Leader tab activated.");
  });

  // 3. Khởi tạo Terminal Panel
  const terminal = new TerminalPanel(convId);

  // 4. Khởi tạo Plan Overlay
  const planOverlay = new PlanOverlay();

  // 5. Khởi tạo Activity Sidebar Panel
  const activityPanel = new ActivityPanel(convId, () => {
    terminal.show();
  });

  // 5.1 Tự động kiểm tra phiên bản mới & gợi ý cập nhật
  initUpdateChecker();

  // 5.2 Page-loop watcher: chỉ chạy khi daemon gửi page_loop_start
  // cho tab này (explicit opt-in từng phiên, mặc định tắt).
  let turnWatcher: ChatGPTTurnWatcher | null = null;
  const startTurnWatcher = (loopId: string) => {
    turnWatcher?.stop();
    turnWatcher = new ChatGPTTurnWatcher(loopId, {
      onSettledTurn: (turn) => {
        safeSendMessage({
          type: "chatgpt_turn",
          loopId,
          conversationId: convId,
          turnId: turn.turnId,
          turnHash: turn.textHash,
          excerpt: turn.excerpt,
          isDoneMarker: isDoneMarker(turn.text),
          isCheckpointMarker: isCheckpointMarker(turn.text),
          selectorUsed: turn.selectorUsed,
          uiVariants: turn.uiVariants,
          settledAt: Date.now(),
        });
      },
      onUnreadable: (reason) => {
        safeSendMessage({ type: "page_loop_status", loopId, status: "blocked", reason: `turn_${reason}` });
      },
      onUserTyping: () => {
        safeSendMessage({ type: "page_loop_status", loopId, status: "paused_user_typing" });
      },
    });
    turnWatcher.start();
  };

  // 6. Kết nối Tab với background service worker an toàn
  safeSendMessage({
    type: "tab-connect",
    conversationUrl: convUrl,
    conversationId: convId
  });

  // 7. Lắng nghe thông báo từ Background
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "server-status":
          activityPanel.updateStatus(msg.state, msg.serverName, msg.message);
          break;

        case "activity-page":
          activityPanel.setEvents(msg.items);
          break;

        case "terminal-broadcast":
          terminal.appendOutput(msg.output);
          break;

        case "inject-prompt": {
          // Phase 5: inject có retry + ack về daemon. Trước đây inject thất
          // bại là mất prompt; giờ thử lại tối đa 3 lần (cách nhau 5s) rồi
          // mới báo thất bại để daemon giữ prompt trong outbox.
          (async () => {
            let ok = false;
            let lastError = "";
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                ok = await injectPromptToChatGPT(msg.text, msg.autoSubmit ?? true, msg.generationTimeoutMs ? { generationTimeoutMs: msg.generationTimeoutMs } : undefined);
              } catch (err: any) {
                lastError = err?.message ?? String(err);
                ok = false;
              }
              if (ok) break;
              if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
            }
            if (msg.injectionId) {
              safeSendMessage({
                type: "inject-result",
                injectionId: msg.injectionId,
                ok,
                error: ok ? undefined : lastError || "inject failed after 3 attempts",
              });
            }
          })();
          break;
        }

        case "page_loop_start": {
          if (msg.loopId) startTurnWatcher(msg.loopId);
          break;
        }

        case "page_loop_stop": {
          turnWatcher?.stop();
          turnWatcher = null;
          break;
        }

        case "plan-show":
          planOverlay.showQuestion(msg.plan, (choice) => {
            safeSendMessage({
              type: "immediate-send",
              conversationId: convId,
              content: `User selected choice: ${choice}`
            });
          });
          break;
      }
    });
  } catch {}

  // Tự động kết nối lại khi URL chuyển trang (SPA router) & thông báo sự kiện chuyển chat
  let lastUrl = location.href;
  const urlCheckTimer = setInterval(() => {
    // Dừng timer nếu extension bị reload/update (context invalidated)
    if (!chrome.runtime?.id) {
      clearInterval(urlCheckTimer);
      return;
    }

    if (location.href !== lastUrl) {
      lastUrl = location.href;
      window.dispatchEvent(new CustomEvent("otter:urlchange", { detail: { url: location.href } }));
      window.dispatchEvent(new CustomEvent("chatmcp:urlchange", { detail: { url: location.href } }));
      safeSendMessage({
        type: "tab-connect",
        conversationUrl: location.href,
        conversationId: getConversationId()
      });
    }
  }, 300);

  console.log("[Otter Content] ✅ Fully booted & running with TypeScript architecture");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
