import { describe, expect, it } from "bun:test";
import { invokeVpsSsh } from "../src/daemon/vps";
import { createTerminalSession, sendTerminalInput, getSession } from "../src/daemon/terminal";

describe("VPS SSH & SFTP Engine (Python Paramiko Bridge)", () => {
  it("rejects invalid actions with clear error message", async () => {
    const res = await invokeVpsSsh("non_existent_action", {});
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error).toContain("không hợp lệ");
  });

  it("validates required parameters for execution", async () => {
    // Missing host
    const resHost = await invokeVpsSsh("exec", { command: "uptime" });
    expect(resHost.ok).toBe(false);
    expect(resHost.error).toContain("host");

    // Missing command
    const resCmd = await invokeVpsSsh("exec", { host: "127.0.0.1" });
    expect(resCmd.ok).toBe(false);
    expect(resCmd.error).toContain("command");
  });

  it("handles connection failure gracefully with timeout", async () => {
    // Connect to a non-routable host with 1s timeout
    const res = await invokeVpsSsh("test", {
      host: "192.0.2.1",
      timeout: 1
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
  });

  it("validates local path requirement for SFTP upload", async () => {
    const res = await invokeVpsSsh("upload", {
      host: "127.0.0.1",
      local: "c:\\path\\does\\not\\exist\\test.txt",
      remote: "/root/test.txt"
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("không tồn tại");
  });

  it("creates and manages a persistent terminal session with live stdin/stdout", async () => {
    const session = createTerminalSession("test-conv-1");
    expect(session.id).toBeDefined();
    expect(session.closed).toBe(false);

    // Send input to persistent session
    const sent = await sendTerminalInput(session.id, "Write-Output 'PERSISTENT_OK'\r\n");
    expect(sent).toBe(true);

    // Clean up
    await sendTerminalInput(session.id, "exit\r\n");
  });
});
