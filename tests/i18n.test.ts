import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { t, setLanguage, getLanguage } from "../extension/src/i18n";

function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))].sort();
}

describe("i18n parity (Chrome _locales source)", () => {
  it("mọi key vi đều có ở en và ngược lại, không rỗng", () => {
    const vi = JSON.parse(fs.readFileSync("extension/_locales/vi/messages.json", "utf8"));
    const en = JSON.parse(fs.readFileSync("extension/_locales/en/messages.json", "utf8"));
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(vi)) {
      expect(vi[k].message.trim().length).toBeGreaterThan(0);
      expect(en[k].message.trim().length).toBeGreaterThan(0);
    }
  });

  it("placeholder của một key phải khớp giữa vi và en", () => {
    const vi = JSON.parse(fs.readFileSync("extension/_locales/vi/messages.json", "utf8"));
    const en = JSON.parse(fs.readFileSync("extension/_locales/en/messages.json", "utf8"));
    for (const k of Object.keys(vi)) {
      expect(placeholders(en[k].message)).toEqual(placeholders(vi[k].message));
    }
  });

  it("t() đổi theo ngôn ngữ và thay tham số", () => {
    setLanguage("vi");
    expect(getLanguage()).toBe("vi");
    expect(t("cmd_close")).toBe("Đóng");
    expect(t("tpl_placeholder", { name: "url" })).toContain("url");
    setLanguage("en");
    expect(t("cmd_close")).toBe("Close");
    expect(t("tpl_placeholder", { name: "url" })).toContain("url");
    setLanguage("vi");
  });
});
