import { describe, it, expect, afterAll } from "bun:test";
import {
  findCuaDriverExe,
  isInteractiveGuiSession,
  isCuaDriverListening,
  getCuaHealth,
  ensureCuaDriver,
  stopCuaDriver,
  executeCuaTool
} from "../src/daemon/cua";
import { updateSettings, getSettings } from "../src/daemon/settings";

describe("CUA Daemon Supervision & Self-Heal", () => {
  afterAll(async () => {
    await stopCuaDriver();
  });

  it("finds the cua-driver executable in the workspace or system", async () => {
    const exe = await findCuaDriverExe();
    expect(exe).not.toBeNull();
    expect(typeof exe).toBe("string");
  });

  it("validates interactive GUI session environment", () => {
    const session = isInteractiveGuiSession();
    expect(session.ok).toBe(true);
  });

  it("checks socket listening status quickly without hanging", async () => {
    const start = Date.now();
    const listening = await isCuaDriverListening();
    const elapsed = Date.now() - start;
    expect(typeof listening).toBe("boolean");
    expect(elapsed).toBeLessThan(1000);
  });

  it("returns comprehensive health status from getCuaHealth()", async () => {
    const health = await getCuaHealth();
    expect(health.installed).toBe(true);
    expect(health.permissionMode).toBeDefined();
    expect(typeof health.running).toBe("boolean");
    expect(health.socket).toContain("cua-driver");
  });

  it("auto-starts cua-driver daemon when ensureCuaDriver() is called", async () => {
    const ready = await ensureCuaDriver();
    expect(ready).toBe(true);

    const isListening = await isCuaDriverListening();
    expect(isListening).toBe(true);
  }, 20000);

  it("deduplicates concurrent ensureCuaDriver() calls without duplicate daemon spawn", async () => {
    // Fire 3 concurrent calls
    const [r1, r2, r3] = await Promise.all([
      ensureCuaDriver(),
      ensureCuaDriver(),
      ensureCuaDriver()
    ]);
    expect(r1).toBe(true);
    expect(r2).toBe(true);
    expect(r3).toBe(true);
  });

  it("executes CUA tool call via the auto-started daemon", async () => {
    const res = await executeCuaTool("get_screen_size", {});
    expect(res).toBeDefined();
    expect(res.width).toBeGreaterThan(0);
    expect(res.height).toBeGreaterThan(0);
  }, 15000);

  it("supports configurable permission mode in settings", () => {
    const prevMode = getSettings().cuaPermissionMode;
    try {
      const updated = updateSettings({ cuaPermissionMode: "bounded" });
      expect(updated.cuaPermissionMode).toBe("bounded");

      const reverted = updateSettings({ cuaPermissionMode: "standard" });
      expect(reverted.cuaPermissionMode).toBe("standard");
    } finally {
      if (prevMode) updateSettings({ cuaPermissionMode: prevMode });
    }
  });
});
