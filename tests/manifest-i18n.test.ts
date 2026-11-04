import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";

describe("Manifest i18n (Chrome standard)", () => {
  it("manifest có default_locale en và dùng __MSG__ cho name/description", () => {
    const manifest = JSON.parse(fs.readFileSync("extension/manifest.json", "utf8"));
    expect(manifest.default_locale).toBe("en");
    expect(manifest.name).toBe("__MSG_app_name__");
    expect(manifest.description).toBe("__MSG_app_description__");
  });

  it("_locales có app_name và app_description ở cả vi và en", () => {
    for (const lang of ["vi", "en"]) {
      const msgs = JSON.parse(fs.readFileSync(`extension/_locales/${lang}/messages.json`, "utf8"));
      expect(msgs.app_name?.message?.trim().length).toBeGreaterThan(0);
      expect(msgs.app_description?.message?.trim().length).toBeGreaterThan(0);
    }
  });

  it("mọi key trong messages.json chỉ chứa ký tự hợp lệ [a-zA-Z0-9_] theo chuẩn Chrome", () => {
    for (const lang of ["vi", "en"]) {
      const msgs = JSON.parse(fs.readFileSync(`extension/_locales/${lang}/messages.json`, "utf8"));
      for (const key of Object.keys(msgs)) {
        expect(/^[a-zA-Z0-9_]+$/.test(key)).toBeTrue();
      }
    }
  });
});
