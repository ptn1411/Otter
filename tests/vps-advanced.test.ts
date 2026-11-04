import { describe, expect, it } from "bun:test";
import { invokeVpsSsh } from "../src/daemon/vps";

describe("Otter Advanced VPS Management & Security Engine", () => {
  it("recognizes all new actions in actions_map", async () => {
    const actions = ["audit", "cron", "install", "ssl", "sshkey", "firewall"];
    for (const action of actions) {
      const res = await invokeVpsSsh(action, { host: "127.0.0.1", port: 2222, timeout: 0.5 });
      expect(res.ok).toBe(false);
      expect(res.error).not.toContain("không hợp lệ");
    }
  }, { timeout: 45000 });

  it("validates required parameters for software install", async () => {
    const res = await invokeVpsSsh("install", { host: "127.0.0.1", packages: [] });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("packages");
  });

  it("validates required parameters for SSL setup", async () => {
    const res = await invokeVpsSsh("ssl", { host: "127.0.0.1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("domain");
  });

  it("validates required parameters for SSH key setup", async () => {
    const res = await invokeVpsSsh("sshkey", { host: "127.0.0.1" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("public_key");
  });
});
