import { describe, expect, it } from "bun:test";
import { STANDARD_COMMANDS } from "../extension/src/content/command-palette";

describe("Command Palette & Slash Commands Tests", () => {
  it("contains all core categories of Otter MCP", () => {
    const categories = new Set(STANDARD_COMMANDS.map(c => c.category));
    expect(categories.has("Trình duyệt Web")).toBeTrue();
    expect(categories.has("Dòng lệnh & Terminal")).toBeTrue();
    expect(categories.has("Desktop & CUA")).toBeTrue();
    expect(categories.has("Codebase Memory")).toBeTrue();
    expect(categories.has("Video & Âm thanh")).toBeTrue();
    expect(categories.has("Quản trị VPS SSH")).toBeTrue();
    expect(categories.has("Kho Bookmark Cá Nhân")).toBeTrue();
  });

  it("ensures each command has unique slash command name and non-empty prompt template", () => {
    const slashes = new Set<string>();
    for (const cmd of STANDARD_COMMANDS) {
      expect(cmd.slash.startsWith("/")).toBeTrue();
      expect(slashes.has(cmd.slash)).toBeFalse();
      slashes.add(cmd.slash);

      expect(cmd.title.trim().length).toBeGreaterThan(0);
      expect(cmd.promptTemplate.trim().length).toBeGreaterThan(5);
    }
  });

  it("filters commands correctly by slash prefix or keyword query", () => {
    const matchBrowse = STANDARD_COMMANDS.filter(c => c.slash.startsWith("/b"));
    expect(matchBrowse.some(c => c.slash === "/browse")).toBeTrue();

    const matchVps = STANDARD_COMMANDS.filter(c => c.slash.startsWith("/v"));
    expect(matchVps.some(c => c.slash === "/vps")).toBeTrue();
    expect(matchVps.some(c => c.slash === "/voice")).toBeTrue();
    expect(matchVps.some(c => c.slash === "/video")).toBeTrue();

    const matchCodebase = STANDARD_COMMANDS.filter(c => c.title.toLowerCase().includes("codebase"));
    expect(matchCodebase.length).toBeGreaterThan(0);
  });

  it("merges custom commands and prioritizes pinned commands first in getAllCommands", () => {
    const { getAllCommands, customCommands, pinnedStandardIds } = require("../extension/src/content/command-palette");

    customCommands.length = 0;
    customCommands.push({
      id: "custom-1",
      slash: "/mycustom",
      icon: "⚡",
      category: "Tập lệnh của tôi",
      title: "My Custom Command",
      description: "Custom test",
      promptTemplate: "Do custom work",
      isPinned: true,
      isCustom: true
    });

    const all = getAllCommands();
    expect(all.length).toBeGreaterThan(STANDARD_COMMANDS.length);
    // Pinned custom command must be at the very top
    expect(all[0].slash).toBe("/mycustom");
    expect(all[0].isPinned).toBeTrue();
  });

  it("supports full bilingual internationalization (vi & en)", () => {
    const { getStandardCommands } = require("../extension/src/content/command-palette");
    const { t, setLanguage, getLanguage } = require("../extension/src/i18n");

    // Vietnamese verification
    setLanguage("vi");
    expect(getLanguage()).toBe("vi");
    expect(t("cmd_quick_chips_label")).toBe("⚡ LỆNH NHANH:");
    expect(t("picker_folder_btn")).toBe("📁 Chọn thư mục dự án");
    expect(t("term_copy")).toBe("Sao chép");

    const viCommands = getStandardCommands("vi");
    const viCats = new Set(viCommands.map(c => c.category));
    expect(viCats.has("Trình duyệt Web")).toBeTrue();
    expect(viCats.has("Quản trị VPS SSH")).toBeTrue();
    expect(viCommands.find(c => c.slash === "/browse")?.title).toBe("Đọc trang web đang mở");

    // English verification
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(t("cmd_quick_chips_label")).toBe("⚡ QUICK ACTIONS:");
    expect(t("picker_folder_btn")).toBe("📁 Select Project Folder");
    expect(t("term_copy")).toBe("Copy Output");

    const enCommands = getStandardCommands("en");
    const enCats = new Set(enCommands.map(c => c.category));
    expect(enCats.has("Web Browser Automation")).toBeTrue();
    expect(enCats.has("Remote VPS SSH Management")).toBeTrue();
    expect(enCommands.find(c => c.slash === "/browse")?.title).toBe("Read active web page");

    // Parameter substitution test
    const formatted = t("cmd_delete_confirm", { slash: "/my-command" });
    expect(formatted).toContain("/my-command");

    // Restore to vi
    setLanguage("vi");
  });
});

