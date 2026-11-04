import { openCommandModal } from "./command-palette";
import { t, onLanguageChange } from "../i18n";

/**
 * Native Project Folder & File Picker for ChatGPT Web
 * Mounts toolbar buttons beside the ChatGPT composer input that open
 * native Windows FolderBrowserDialog and OpenFileDialog.
 */

export let activeFolderPath: string | null = null;
export let activeFilePath: string | null = null;

function findPromptComposer(): HTMLElement | null {
  const primary =
    document.querySelector<HTMLElement>("#prompt-textarea") ||
    document.querySelector<HTMLElement>('[data-testid="composer-text-input"]') ||
    document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]');
  if (primary) return primary;

  const formInput = document.querySelector<HTMLElement>("form [contenteditable='true'], form textarea");
  if (formInput) return formInput;

  const allEditables = Array.from(document.querySelectorAll<HTMLElement>("[contenteditable='true']"));
  if (allEditables.length > 0) {
    return allEditables[allEditables.length - 1];
  }

  return document.querySelector<HTMLElement>("textarea[tabindex='0']");
}

function setComposerText(text: string) {
  const composer = findPromptComposer();
  if (!composer) return;

  composer.focus();

  if (composer.isContentEditable || composer.getAttribute("contenteditable") === "true") {
    const current = composer.innerText.trim();
    const insertString = current ? `\n${text}` : text;

    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(composer);
      sel.collapseToEnd();
    }

    const success = document.execCommand("insertText", false, insertString);
    if (!success) {
      composer.innerText = current ? `${current}\n${text}` : text;
      composer.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      composer.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  } else if (composer instanceof HTMLTextAreaElement) {
    const current = composer.value.trim();
    composer.value = current ? `${current}\n${text}` : text;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export async function triggerPickFolder(): Promise<string | null> {
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: "pick-folder",
      initialPath: activeFolderPath || activeFilePath
    });
    if (response?.ok && response.path) {
      activeFolderPath = response.path;
      setComposerText(`${t("picker_folder_prefix")}"${response.path}"`);
      return response.path;
    }
  } catch (err: any) {
    console.error("[Otter FolderPicker] Error:", err);
  }
  return null;
}

export async function triggerPickFile(): Promise<string[] | null> {
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: "pick-file",
      initialPath: activeFolderPath || activeFilePath,
      multiple: true
    });
    if (response?.ok && (response.path || (response.paths && response.paths.length > 0))) {
      const paths: string[] = response.paths && response.paths.length > 0 
        ? response.paths 
        : [response.path];
      
      activeFilePath = paths[0];
      const quotedPaths = paths.map((p: string) => `"${p}"`).join(", ");
      setComposerText(paths.length > 1 ? `${t("picker_files_prefix")}${quotedPaths}` : `${t("picker_file_prefix")}${quotedPaths}`);
      return paths;
    }
  } catch (err: any) {
    console.error("[Otter FilePicker] Error:", err);
  }
  return null;
}

export function initFolderPicker() {
  function cleanupLegacyBar() {
    document.querySelectorAll("#otter-folder-picker-bar, #chatmcp-folder-picker-bar").forEach(el => el.remove());
  }

  async function handlePickFolderClick(btn: HTMLButtonElement) {
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = t("picker_opening_folder");

    try {
      const response = await chrome.runtime.sendMessage({ 
        type: "pick-folder",
        initialPath: activeFolderPath || activeFilePath
      });
      if (response?.ok && response.path) {
        activeFolderPath = response.path;
        const folderName = response.path.split(/[/\\]/).filter(Boolean).pop() || response.path;
        btn.textContent = `📁 ${folderName}`;
        btn.title = `${t("picker_folder_prefix")}${response.path}`;
        btn.style.borderColor = "#10a37f";
        btn.style.color = "#10a37f";
        btn.dataset.active = "true";

        setComposerText(`${t("picker_folder_prefix")}"${response.path}"`);
      } else {
        btn.textContent = oldText;
      }
    } catch (err: any) {
      console.error("[Otter FolderPicker] Error:", err);
      btn.textContent = t("picker_error_folder");
      setTimeout(() => {
        btn.textContent = oldText;
      }, 2000);
    } finally {
      btn.disabled = false;
    }
  }

  async function handlePickFileClick(btn: HTMLButtonElement) {
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = t("picker_opening_file");

    try {
      const response = await chrome.runtime.sendMessage({ 
        type: "pick-file",
        initialPath: activeFolderPath || activeFilePath,
        multiple: true
      });
      if (response?.ok && (response.path || (response.paths && response.paths.length > 0))) {
        const paths: string[] = response.paths && response.paths.length > 0 
          ? response.paths 
          : [response.path];
        
        activeFilePath = paths[0];
        const fileName = paths[0].split(/[/\\]/).filter(Boolean).pop() || paths[0];
        btn.textContent = paths.length > 1 ? `📄 (${paths.length}) ${t("picker_files_count")}` : `📄 ${fileName}`;
        btn.title = paths.join("\n");
        btn.style.borderColor = "#10a37f";
        btn.style.color = "#10a37f";
        btn.dataset.active = "true";

        const quotedPaths = paths.map((p: string) => `"${p}"`).join(", ");
        setComposerText(paths.length > 1 ? `${t("picker_files_prefix")}${quotedPaths}` : `${t("picker_file_prefix")}${quotedPaths}`);
      } else {
        btn.textContent = oldText;
      }
    } catch (err: any) {
      console.error("[Otter FilePicker] Error:", err);
      btn.textContent = t("picker_error_file");
      setTimeout(() => {
        btn.textContent = oldText;
      }, 2000);
    } finally {
      btn.disabled = false;
    }
  }

  function createButton(label: string, title: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.title = title;
    btn.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border: 1px solid #444;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.05);
      color: #e0e0e0;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      backdrop-filter: blur(8px);
      user-select: none;
      line-height: 1.4;
    `;

    btn.onmouseenter = () => {
      btn.style.background = "rgba(255, 255, 255, 0.12)";
      btn.style.borderColor = "#666";
    };
    btn.onmouseleave = () => {
      btn.style.background = "rgba(255, 255, 255, 0.05)";
      btn.style.borderColor = btn.dataset.active === "true" ? "#10a37f" : "#444";
    };
    return btn;
  }

  function mountPickerBar() {
    // Thanh chọn thư mục và file giờ đã tích hợp trực tiếp vào Nút Tròn Tỏa Lệnh Nhanh (Radial Menu)
    cleanupLegacyBar();
  }

  function triggerMountSequence() {
    mountPickerBar();
    setTimeout(mountPickerBar, 50);
    setTimeout(mountPickerBar, 150);
    setTimeout(mountPickerBar, 300);
    setTimeout(mountPickerBar, 600);
    setTimeout(mountPickerBar, 1200);
  }

  // Sự kiện 1: Bắt sự kiện Click vào nút New Chat hoặc chuyển chat trong giao diện
  document.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const clickable = target.closest("a, button, [role='button']");
    if (!clickable) return;

    const href = clickable.getAttribute("href") || "";
    const ariaLabel = (clickable.getAttribute("aria-label") || "").toLowerCase();
    const testId = (clickable.getAttribute("data-testid") || "").toLowerCase();
    const text = (clickable.textContent || "").toLowerCase();

    const isChatNavigation =
      href === "/" ||
      href.startsWith("/c/") ||
      testId.includes("new-chat") ||
      testId.includes("create-new-chat") ||
      testId.includes("conversation") ||
      ariaLabel.includes("new chat") ||
      ariaLabel.includes("đoạn chat mới") ||
      text.includes("new chat") ||
      text.includes("đoạn chat mới");

    if (isChatNavigation) {
      triggerMountSequence();
    }
  }, true);

  // Sự kiện 2: Bắt phím tắt tạo chat mới (Ctrl+Shift+O, Ctrl+O, Cmd+Shift+O)
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "o" || e.key === "O")) {
      triggerMountSequence();
    }
  });

  // Sự kiện 3: Lắng nghe sự kiện chuyển URL do content.ts dispatch
  window.addEventListener("otter:urlchange", triggerMountSequence);
  window.addEventListener("chatmcp:urlchange", triggerMountSequence);
  window.addEventListener("popstate", triggerMountSequence);

  // Sự kiện 4: Lắng nghe khi người dùng focus vào ô nhập prompt
  document.addEventListener("focusin", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.id === "prompt-textarea" || target.getAttribute("contenteditable") === "true")) {
      mountPickerBar();
    }
  }, true);

  // Sự kiện 5: MutationObserver theo dõi thay đổi DOM của trang (có debounce 300ms nhẹ nhàng)
  let mutationTimer: any = null;
  const observer = new MutationObserver(() => {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      mountPickerBar();
    }, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Sự kiện 6: Polling định kỳ 2000ms đảm bảo thanh luôn hiển thị mà không gây lag CPU
  setInterval(mountPickerBar, 2000);

  // Sự kiện 7: Lắng nghe thay đổi ngôn ngữ i18n
  onLanguageChange(() => {
    document.querySelectorAll("#otter-folder-picker-bar, #chatmcp-folder-picker-bar").forEach(el => el.remove());
    mountPickerBar();
  });

  // Khởi động gắn thanh công cụ ngay
  triggerMountSequence();
  console.log("[Otter Folder & File Picker] Robust Event Handlers Initialized");
}
