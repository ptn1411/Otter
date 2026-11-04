import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Options Page & i18n Integrity Tests", () => {
  const optionsHtmlPath = path.resolve("extension/options.html");
  const optionsTsPath = path.resolve("extension/src/options/options.ts");
  const optionsJsPath = path.resolve("extension/options.js");

  it("ensures options.html and options.ts exist", () => {
    expect(fs.existsSync(optionsHtmlPath)).toBeTrue();
    expect(fs.existsSync(optionsTsPath)).toBeTrue();
  });

  it("ensures every data-i18n in options.html is mapped in i18n messages", () => {
    const html = fs.readFileSync(optionsHtmlPath, "utf-8");
    const messages = JSON.parse(fs.readFileSync(path.resolve("extension/_locales/vi/messages.json"), "utf-8"));

    const matches = Array.from(html.matchAll(/data-i18n="([^"]+)"/g));
    const keysInHtml = new Set(matches.map(m => m[1]));

    expect(keysInHtml.size).toBeGreaterThan(10);

    for (const key of keysInHtml) {
      expect(Boolean(messages[key])).toBeTrue();
    }
  });

  it("triggers DOMContentLoaded without throwing ReferenceError: loadCustomCommands is not defined", async () => {
    const js = fs.readFileSync(optionsJsPath, "utf-8");

    let domContentLoadedCallback: (() => Promise<void>) | null = null;
    const clickHandlers = new Map<string, Function>();

    const createMockElement = (id: string = ""): any => ({
      value: "http://127.0.0.1:1993",
      dataset: {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
      getAttribute: () => "tab-guide",
      setAttribute: () => {},
      addEventListener: (evt: string, fn: Function) => {
        if (evt === "click" && id) clickHandlers.set(id, fn);
      },
      appendChild: () => {},
      textContent: "",
      style: {}
    });

    const mockDocument = {
      addEventListener: (event: string, cb: any) => {
        if (event === "DOMContentLoaded") {
          domContentLoadedCallback = cb;
        }
      },
      createElement: () => createMockElement(),
      querySelectorAll: () => [createMockElement()],
      getElementById: (id: string) => {
        return createMockElement(id);
      },
      documentElement: { lang: "vi" }
    };

    const mockChrome = {
      storage: {
        local: {
          get: async () => ({ language: "vi" }),
          set: async () => {}
        }
      },
      runtime: { sendMessage: () => {} }
    };

    const testFn = new Function(
      "document",
      "chrome",
      "window",
      "navigator",
      "fetch",
      "AbortSignal",
      js
    );

    // Load bundle
    testFn(
      mockDocument,
      mockChrome,
      globalThis,
      { language: "vi" },
      async () => ({ ok: true, json: async () => ({}) }),
      { timeout: () => ({}) }
    );

    expect(domContentLoadedCallback).not.toBeNull();
    // Running DOMContentLoaded callback should not throw ReferenceError
    await domContentLoadedCallback!();

    // Verify clicking language buttons works without ReferenceError
    const langViHandler = clickHandlers.get("btn-lang-vi");
    const langEnHandler = clickHandlers.get("btn-lang-en");
    expect(langViHandler).toBeDefined();
    expect(langEnHandler).toBeDefined();
    expect(() => langViHandler()).not.toThrow();
    expect(() => langEnHandler()).not.toThrow();
  });
});
