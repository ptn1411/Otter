import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

describe("Extension Icons Verification", () => {
  const rootDir = process.cwd();
  const manifestPath = path.join(rootDir, "extension", "manifest.json");

  it("manifest.json defines valid icon sizes (16, 32, 48, 128)", async () => {
    const content = await fs.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(content);

    expect(manifest.icons).toBeDefined();
    expect(manifest.icons["16"]).toBe("icons/icon16.png");
    expect(manifest.icons["32"]).toBe("icons/icon32.png");
    expect(manifest.icons["48"]).toBe("icons/icon48.png");
    expect(manifest.icons["128"]).toBe("icons/icon128.png");

    expect(manifest.action.default_icon).toBeDefined();
    expect(manifest.action.default_icon["16"]).toBe("icons/icon16.png");
    expect(manifest.action.default_icon["32"]).toBe("icons/icon32.png");
    expect(manifest.action.default_icon["48"]).toBe("icons/icon48.png");
    expect(manifest.action.default_icon["128"]).toBe("icons/icon128.png");
  });

  it("all icon files exist in extension/icons and extension/dist/icons with valid PNG header", async () => {
    const dirs = ["extension/icons", "extension/dist/icons"];
    const expectedSizes: Record<string, number> = {
      "icon16.png": 16,
      "icon32.png": 32,
      "icon48.png": 48,
      "icon128.png": 128
    };

    for (const d of dirs) {
      for (const [filename, expectedDim] of Object.entries(expectedSizes)) {
        const filePath = path.join(rootDir, d, filename);
        const stat = await fs.stat(filePath);
        expect(stat.isFile()).toBe(true);
        expect(stat.size).toBeLessThan(50000); // Must be small, optimized PNG (< 50KB)

        const buf = await fs.readFile(filePath);
        // PNG Magic header: 89 50 4E 47 0D 0A 1A 0A
        expect(buf[0]).toBe(0x89);
        expect(buf[1]).toBe(0x50);
        expect(buf[2]).toBe(0x4E);
        expect(buf[3]).toBe(0x47);

        // IHDR chunk dimensions (bytes 16-19 for width, 20-23 for height in big-endian)
        const width = buf.readUInt32BE(16);
        const height = buf.readUInt32BE(20);
        expect(width).toBe(expectedDim);
        expect(height).toBe(expectedDim);
      }
    }
  });
});

