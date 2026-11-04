import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

describe("Otter CLI Subcommands", () => {
  const rootDir = process.cwd();
  const entryPath = path.join(rootDir, "src", "daemon", "index.ts");

  it("otter --help returns help text with exit code 0", () => {
    const res = spawnSync("bun", [entryPath, "--help"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Otter Agent — Agentic AI Desktop & Browser Controller");
    expect(res.stdout).toContain("otter license activate <KEY>");
    expect(res.stdout).toContain("otter license status");
  });

  it("otter version returns v2.0.0 with exit code 0", () => {
    const res = spawnSync("bun", [entryPath, "version"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("v2.0.0");
  });

  it("otter license status returns device support code and license info", () => {
    const res = spawnSync("bun", [entryPath, "license", "status"], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Mã thiết bị (Support Code):");
    expect(res.stdout).toContain("Trạng thái:");
  });

  it("otter license activate without key fails with exit code 1", () => {
    const res = spawnSync("bun", [entryPath, "license", "activate"], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("Vui lòng cung cấp License Key");
  });
});

