import { describe, expect, it } from "bun:test";
import { exportTurnsToMarkdown, sanitizeMarkdownFilename } from "../extension/src/content/export-markdown";

describe("Export Markdown Tests", () => {
  it("chuyển đổi danh sách các lượt chat thành tài liệu Markdown chuẩn", () => {
    const turns = [
      { role: "user", content: "Hãy viết hàm tính tổng trong Python." },
      { role: "assistant", content: "Dưới đây là hàm tính tổng:\n```python\ndef add(a, b):\n    return a + b\n```" }
    ];

    const md = exportTurnsToMarkdown(turns, "Phiên lập trình Python");

    expect(md.includes("# Phiên lập trình Python")).toBeTrue();
    expect(md.includes("### 👤 User")).toBeTrue();
    expect(md.includes("Hãy viết hàm tính tổng trong Python.")).toBeTrue();
    expect(md.includes("### 🤖 Assistant")).toBeTrue();
    expect(md.includes("def add(a, b):")).toBeTrue();
    expect(md.includes("Được xuất bản tự động bởi Otter")).toBeTrue();
  });

  it("làm sạch tên file khỏi ký tự cấm của hệ thống", () => {
    expect(sanitizeMarkdownFilename("Chat: test/file*?")).toBe("Chat- test-file-");
    expect(sanitizeMarkdownFilename("")).toBe("otter-chat");
  });
});
