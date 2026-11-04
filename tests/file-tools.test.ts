import { describe, expect, it } from "bun:test";
import { createMcpServer } from "../src/daemon/mcp";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("File I/O Tools (read_file with ranges & edit_file surgical replacement)", () => {
  const testFile = path.resolve("scratch", "test-slice-file.ts");

  it("reads precise line ranges with line numbers using read_file", async () => {
    await fs.mkdir(path.dirname(testFile), { recursive: true });
    const content = [
      "line 1: import something;",
      "line 2: export function testFoo() {",
      "line 3:   const a = 1;",
      "line 4:   return a + 2;",
      "line 5: }",
      "line 6: // end of file"
    ].join("\n");
    await fs.writeFile(testFile, content, "utf-8");

    const mcp = createMcpServer();
    const tools = (mcp as any)._registeredTools || (mcp as any).registeredTools || {};
    const readHandler = tools["read_file"]?.handler;

    expect(readHandler).toBeDefined();

    // Đọc từ dòng 2 đến dòng 5 (trích xuất trọn vẹn function testFoo)
    const res = await readHandler({
      filePath: testFile,
      startLine: 2,
      endLine: 5,
      withLineNumbers: true
    });

    const output = res.content[0].text;
    expect(output).toContain("2: line 2: export function testFoo()");
    expect(output).toContain("5: line 5: }");
    expect(output).not.toContain("line 1: import");
    expect(output).not.toContain("line 6: // end");
  });

  it("surgically edits target code without modifying surrounding lines using edit_file", async () => {
    const mcp = createMcpServer();
    const tools = (mcp as any)._registeredTools || (mcp as any).registeredTools || {};
    const editHandler = tools["edit_file"]?.handler;

    expect(editHandler).toBeDefined();

    // Thay thế đoạn 'const a = 1;' thành 'const a = 100;'
    const editRes = await editHandler({
      filePath: testFile,
      target: "  const a = 1;",
      replacement: "  const a = 100;\n  const b = 200;"
    });

    expect(editRes.isError).toBeFalsy();

    const updatedContent = await fs.readFile(testFile, "utf-8");
    expect(updatedContent).toContain("  const a = 100;");
    expect(updatedContent).toContain("  const b = 200;");
    expect(updatedContent).toContain("line 1: import something;");
    expect(updatedContent).toContain("line 6: // end of file");

    // Clean up
    await fs.rm(testFile, { force: true });
  });

  it("returns clear error if target string is not found in edit_file", async () => {
    const mcp = createMcpServer();
    const tools = (mcp as any)._registeredTools || (mcp as any).registeredTools || {};
    const editHandler = tools["edit_file"]?.handler;

    const res = await editHandler({
      filePath: "package.json",
      target: "non_existent_target_string_12345",
      replacement: "whatever"
    });

    expect(res.isError).toBeTrue();
    expect(res.content[0].text).toContain("Lỗi: Không tìm thấy đoạn mã target");
  });
});

