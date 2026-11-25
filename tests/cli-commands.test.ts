import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { OTTER_VERSION } from "../src/daemon/version";

describe("Otter CLI Subcommands", () => {
  const rootDir = process.cwd();
  const entryPath = path.join(rootDir, "src", "daemon", "index.ts");

  it("otter --help returns help text with exit code 0", () => {
    const res = spawnSync("bun", [entryPath, "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Otter Agent — Agentic AI Desktop & Browser Controller");
    expect(res.stdout).toContain(`v${OTTER_VERSION}`);
    expect(res.stdout).toContain("otter cua");
    expect(res.stdout).toContain("otter version");
  });

  it("otter version returns current OTTER_VERSION with exit code 0", () => {
    const res = spawnSync("bun", [entryPath, "version"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`v${OTTER_VERSION}`);
  });

  it("otter license status returns open-source MIT notice with exit code 0", () => {
    const res = spawnSync("bun", [entryPath, "license", "status"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("MIT");
  });

  it("otter license activate returns open-source MIT notice with exit code 0", () => {
    const res = spawnSync("bun", [entryPath, "license", "activate"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("MIT");
  });
});

