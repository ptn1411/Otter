import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";

describe("Side Panel Manifest Config Tests", () => {
  it("đảm bảo manifest.json khai báo quyền sidePanel và đường dẫn side_panel", () => {
    const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));

    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
    expect(manifest.commands?.["open-side-panel"]).toBeDefined();
  });

  it("giữ nguyên các quyền cũ và manifest_version 3", () => {
    const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
    expect(manifest.manifest_version).toBe(3);
    for (const perm of ["storage", "alarms", "tabs", "scripting", "clipboardWrite", "notifications"]) {
      expect(manifest.permissions).toContain(perm);
    }
  });
});
