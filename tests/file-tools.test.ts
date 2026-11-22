import { describe, expect, it } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTerminalAndFileTools } from "../src/daemon/tools/terminal";
import * as fs from "node:fs/promises";
import * as path from "node:path";

function fileTool(name: string) {
  const mcp = new McpServer({ name: "file-tools-test", version: "0" });
  registerTerminalAndFileTools(mcp);
  const tools = (mcp as any)._registeredTools || (mcp as any).registeredTools || {};
  return tools[name]?.handler;
}

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

    const readHandler = fileTool("read_file");
    expect(readHandler).toBeDefined();

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

  it("caps an unscoped read at 1000 lines and still reads a later range", async () => {
    const big = path.resolve("scratch", "test-big-read.txt");
    await fs.mkdir(path.dirname(big), { recursive: true });
    const lines = Array.from({ length: 1200 }, (_, i) => `row ${i + 1}`);
    await fs.writeFile(big, lines.join("\n"), "utf-8");

    const readHandler = fileTool("read_file");
    const res = await readHandler({ filePath: big, withLineNumbers: true });
    const output = res.content[0].text as string;
    expect(output).toContain("   1: row 1");
    expect(output).toContain("1000: row 1000");
    expect(output).not.toContain("row 1200");
    expect(output).toContain("tổng 1200 dòng");
    expect(output).toContain("startLine");

    const ranged = await readHandler({ filePath: big, startLine: 1100, endLine: 1102, withLineNumbers: true });
    const rangedText = ranged.content[0].text as string;
    expect(rangedText).toContain("1100: row 1100");
    expect(rangedText).toContain("1102: row 1102");
    expect(rangedText).not.toContain("row 1099");
    expect(rangedText).not.toContain("row 1103");
    await fs.rm(big, { force: true });
  });

  it("stops scanning a file larger than 1MB instead of loading it all", async () => {
    const huge = path.resolve("scratch", "test-huge-read.txt");
    await fs.mkdir(path.dirname(huge), { recursive: true });
    const head = Array.from({ length: 1000 }, (_, i) => `row ${i + 1}`).join("\n") + "\n";
    const body = "x".repeat(1_000_000);
    const tail = "\nTAIL-MARKER-SHOULD-NOT-APPEAR\n";
    await fs.writeFile(huge, head + body + tail, "utf-8");

    const readHandler = fileTool("read_file");
    const res = await readHandler({ filePath: huge, withLineNumbers: true });
    const output = res.content[0].text as string;
    expect(output).toContain("1000: row 1000");
    expect(output).toContain("chưa đọc hết");
    expect(output).not.toContain("TAIL-MARKER");
    await fs.rm(huge, { force: true });
  });

  it("surgically edits target code without modifying surrounding lines using edit_file", async () => {
    const editHandler = fileTool("edit_file");
    expect(editHandler).toBeDefined();

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
    await fs.rm(testFile, { force: true });
  });

  it("returns clear error if target string is not found in edit_file", async () => {
    const editHandler = fileTool("edit_file");
    const res = await editHandler({
      filePath: "package.json",
      target: "non_existent_target_string_12345",
      replacement: "whatever"
    });

    expect(res.isError).toBeTrue();
    expect(res.content[0].text).toContain("Lỗi: Không tìm thấy đoạn mã target");
  });
});
