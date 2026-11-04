import { describe, expect, it } from "bun:test";
import { formatDate, formatNumber, formatCurrency, plural } from "../extension/src/i18n";

describe("i18n Intl formatting", () => {
  it("formatDate theo locale, không hardcode vi-VN khi lang=en", () => {
    const d = new Date(2026, 0, 15, 10, 30, 0);
    const vi = formatDate(d, undefined, "vi");
    const en = formatDate(d, undefined, "en");
    expect(vi).toContain("2026");
    expect(en).toContain("2026");
    expect(vi).not.toBe(en);
  });

  it("formatNumber theo locale", () => {
    expect(formatNumber(1234567.89, undefined, "vi")).toContain("1.234.567");
    expect(formatNumber(1234567.89, undefined, "en")).toContain("1,234,567");
  });

  it("formatCurrency luôn VND cho cả vi và en", () => {
    expect(formatCurrency(100000, "VND", "vi")).toContain("₫");
    expect(formatCurrency(100000, "VND", "en")).toContain("₫");
  });

  it("plural: vi chỉ có other, en phân biệt one/other", () => {
    expect(plural(1, { one: "1 file", other: "files" }, "vi")).toBe("files");
    expect(plural(5, { one: "1 file", other: "files" }, "vi")).toBe("files");
    expect(plural(1, { one: "1 file", other: "files" }, "en")).toBe("1 file");
    expect(plural(5, { one: "1 file", other: "files" }, "en")).toBe("files");
  });
});
