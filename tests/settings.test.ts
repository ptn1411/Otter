import { describe, it, expect, beforeEach } from "bun:test";
import { getSettings, updateSettings, loadSettings } from "../src/daemon/settings";

describe("Settings Module", () => {
  it("loads default settings correctly", () => {
    const s = getSettings();
    expect(s).toBeDefined();
    expect(typeof s.browserEngine).toBe("string");
    expect(typeof s.cdpHeadless).toBe("boolean");
    expect(typeof s.cdpHud).toBe("boolean");
    expect(typeof s.cdpAutoClose).toBe("boolean");
    expect(typeof s.cdpPort).toBe("number");
  });

  it("updates and persists settings into process.env", () => {
    updateSettings({ cdpHeadless: true, cdpHud: false, cdpAutoClose: false, cdpPort: 9333 });
    expect(process.env.OTTER_CDP_HEADLESS).toBe("1");
    expect(process.env.OTTER_CDP_HUD).toBe("0");
    expect(process.env.OTTER_CDP_AUTO_CLOSE).toBe("0");
    expect(process.env.OTTER_CDP_PORT).toBe("9333");

    const s = getSettings();
    expect(s.cdpHeadless).toBe(true);
    expect(s.cdpHud).toBe(false);
    expect(s.cdpAutoClose).toBe(false);
    expect(s.cdpPort).toBe(9333);

    // Rollback for clean test state
    updateSettings({ cdpHeadless: false, cdpHud: true, cdpAutoClose: true, cdpPort: 9222 });
    expect(process.env.OTTER_CDP_HEADLESS).toBe("0");
    expect(process.env.OTTER_CDP_HUD).toBe("1");
    expect(process.env.OTTER_CDP_AUTO_CLOSE).toBe("1");
    expect(process.env.OTTER_CDP_PORT).toBe("9222");
  });

  it("handles GET and POST /api/system/settings route correctly", async () => {
    const { handleSystemRoutes } = await import("../src/daemon/routes/system-routes");
    const getReq = new Request("http://127.0.0.1:1993/api/system/settings", { method: "GET" });
    const getRes = await handleSystemRoutes(getReq, new URL(getReq.url), 1993);
    expect(getRes).not.toBeNull();
    const data = await getRes!.json();
    expect(data.browserEngine).toBeDefined();

    const postReq = new Request("http://127.0.0.1:1993/api/system/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cdpHeadless: true, gpmApiPort: 9999 }),
    });
    const postRes = await handleSystemRoutes(postReq, new URL(postReq.url), 1993);
    expect(postRes).not.toBeNull();
    const postData = await postRes!.json();
    expect(postData.success).toBe(true);
    expect(postData.settings.cdpHeadless).toBe(true);
    expect(postData.settings.gpmApiPort).toBe(9999);

    // Rollback
    updateSettings({ cdpHeadless: false, gpmApiPort: 9495 });
  });

  it("handles browser/engine route with headless & hud parameters", async () => {
    const { handleActivityRoutes } = await import("../src/daemon/routes/activity-routes");
    const postReq = new Request("http://127.0.0.1:1993/api/activity/v1/browser/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "auto", headless: true, hud: false, autoClose: false }),
    });
    const postRes = await handleActivityRoutes(postReq, new URL(postReq.url), "activity/v1");
    expect(postRes).not.toBeNull();
    const data = await postRes!.json();
    // Otter hiện dùng CDP gốc duy nhất, mọi mode truyền vào được chuẩn hóa về "cdp".
    expect(data.mode).toBe("cdp");
    expect(data.headless).toBe(true);
    expect(data.hud).toBe(false);
    expect(data.autoClose).toBe(false);

    // Rollback
    updateSettings({ browserEngine: "cdp", cdpHeadless: false, cdpHud: true, cdpAutoClose: true });
  });
});
