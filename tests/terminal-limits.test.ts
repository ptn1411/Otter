import { describe, expect, it } from "bun:test";
import { COMMAND_MAX_CHARS, executeCommand } from "../src/daemon/terminal";

describe("executeCommand limits", () => {
  it("stops a command that exceeds the timeout", async () => {
    const start = Date.now();
    const res = await executeCommand("Start-Sleep -Seconds 30", undefined, { timeoutMs: 800 });
    expect(Date.now() - start).toBeLessThan(8000);
    expect(res.stderr).toContain("timed out after 800ms");
  });

  it("caps stdout past the character limit", async () => {
    const res = await executeCommand("$s='A'*250000; [Console]::Out.Write($s)", undefined, { timeoutMs: 20000, maxChars: COMMAND_MAX_CHARS });
    expect(res.stdout.length).toBeLessThan(COMMAND_MAX_CHARS + 80);
    expect(res.stdout).toContain("[stdout truncated at");
  });
});
