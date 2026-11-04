import { describe, expect, it } from "bun:test";

describe("Picker System & Path Formatting (Windows & macOS)", () => {
  it("formats folder path with double quotes for prompts on Windows and macOS", () => {
    const winPath = "C:\\Users\\User\\Pictures\\anh co gai";
    expect(`Thư mục dự án: "${winPath}"`).toBe('Thư mục dự án: "C:\\Users\\User\\Pictures\\anh co gai"');

    const macPath = "/Users/user/Pictures/anh co gai";
    expect(`Thư mục dự án: "${macPath}"`).toBe('Thư mục dự án: "/Users/user/Pictures/anh co gai"');
  });

  it("formats file path with double quotes for prompts", () => {
    const filePath = "/Users/user/Projects/app/index.ts";
    const formatted = `File: "${filePath}"`;
    expect(formatted).toBe('File: "/Users/user/Projects/app/index.ts"');
  });

  it("formats multiple file paths with double quotes", () => {
    const filePaths = [
      "/Users/user/Documents/doc1.pdf",
      "/Users/user/Documents/doc2.pdf"
    ];
    const quoted = filePaths.map(p => `"${p}"`).join(", ");
    const formatted = `Files: ${quoted}`;
    expect(formatted).toBe('Files: "/Users/user/Documents/doc1.pdf", "/Users/user/Documents/doc2.pdf"');
  });

  it("escapes quotes correctly for PowerShell scripts and AppleScript", () => {
    // Windows PowerShell
    const winInput = "C:\\Folder's Test\\file.txt";
    const winEscaped = winInput.replace(/'/g, "''");
    expect(winEscaped).toBe("C:\\Folder''s Test\\file.txt");

    // macOS AppleScript
    const macInput = '/Users/user/Project "Special"/file.txt';
    const macEscaped = macInput.replace(/"/g, '\\"');
    expect(macEscaped).toBe('/Users/user/Project \\"Special\\"/file.txt');
  });

  it("identifies new chat navigation trigger elements correctly", () => {
    const checkIsNewChat = (href: string, aria: string, testId: string, text: string) => {
      const h = href.toLowerCase();
      const a = aria.toLowerCase();
      const t = testId.toLowerCase();
      const txt = text.toLowerCase();
      return (
        h === "/" ||
        h.startsWith("/c/") ||
        t.includes("new-chat") ||
        t.includes("create-new-chat") ||
        a.includes("new chat") ||
        a.includes("đoạn chat mới") ||
        txt.includes("new chat") ||
        txt.includes("đoạn chat mới")
      );
    };

    expect(checkIsNewChat("/", "", "", "")).toBe(true);
    expect(checkIsNewChat("", "New chat", "", "")).toBe(true);
    expect(checkIsNewChat("", "Đoạn chat mới", "", "")).toBe(true);
    expect(checkIsNewChat("", "", "create-new-chat-button", "")).toBe(true);
    expect(checkIsNewChat("/settings", "Settings", "", "Settings")).toBe(false);
  });
});
