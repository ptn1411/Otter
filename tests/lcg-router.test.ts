import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  LcgCipher,
  LCG_DEFAULT_SEED,
  getLcgProtectedDomains,
  getLcgRoute,
  getLcgServerUrl,
  matchLcgRoute,
  matchAnyLcgRoute,
  generateDynamicKnockPath,
  matchDynamicKnockPath,
  OBFUSCATED_ROUTES,
} from "../src/daemon/license/lcg-router";
import {
  checkHostsFileContent,
  getProtectedDomains,
} from "../src/daemon/license/hosts-guard";
import {
  initLicenseDatabase,
  issueLicense,
  startLicenseServer,
} from "../src/server/license-server";
import { activateOnline, sendHeartbeat } from "../src/daemon/license/hybrid-client";

const TEST_DB_PATH = path.join(process.cwd(), "data", "test-lcg-server.sqlite");
const TEST_PORT = 1997;

describe("Linear Congruential Generator (LCG) Domain & Router Obfuscation Tests", () => {
  let db: Database;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
    db = initLicenseDatabase(TEST_DB_PATH);
    server = startLicenseServer(TEST_PORT, TEST_DB_PATH);
  });

  afterEach(() => {
    server.stop(true);
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
  });

  describe("1. Thuật toán LCG PRNG Stream Cipher (X_{n+1} = (a*X_n + c) mod 2^32)", () => {
    it("generates deterministic pseudo-random byte stream for a fixed seed", () => {
      const lcg1 = new LcgCipher(0x12345678);
      const stream1 = [lcg1.nextByte(), lcg1.nextByte(), lcg1.nextByte(), lcg1.nextByte()];

      const lcg2 = new LcgCipher(0x12345678);
      const stream2 = [lcg2.nextByte(), lcg2.nextByte(), lcg2.nextByte(), lcg2.nextByte()];

      expect(stream1).toEqual(stream2);
    });

    it("generates completely different streams with different seeds", () => {
      const lcg1 = new LcgCipher(0x11111111);
      const lcg2 = new LcgCipher(0x22222222);

      const stream1 = [lcg1.nextByte(), lcg1.nextByte(), lcg1.nextByte(), lcg1.nextByte()];
      const stream2 = [lcg2.nextByte(), lcg2.nextByte(), lcg2.nextByte(), lcg2.nextByte()];

      expect(stream1).not.toEqual(stream2);
    });

    it("accurately obfuscates and deobfuscates arbitrary strings with 16-bit salt header", () => {
      const original = "https://sensitive-backend-domain.internal/secret/api";
      const obfuscated = LcgCipher.obfuscate(original, LCG_DEFAULT_SEED);

      expect(Array.isArray(obfuscated)).toBe(true);
      // v2 có thêm 2 byte Salt ở đầu
      expect(obfuscated.length).toBe(original.length + 2);

      // Mảng byte xáo trộn không chứa byte ASCII thô của chuỗi
      const asString = String.fromCharCode(...obfuscated.slice(2));
      expect(asString.includes("sensitive")).toBe(false);
      expect(asString.includes("backend")).toBe(false);

      // Giải mã LCG
      const recovered = LcgCipher.deobfuscate(obfuscated, LCG_DEFAULT_SEED);
      expect(recovered).toBe(original);
    });

    it("produces distinct ciphertexts for identical text due to per-string random salt (chống Two-Time Pad)", () => {
      const text = "/api/v1/identical/prefix";
      const enc1 = LcgCipher.obfuscate(text, LCG_DEFAULT_SEED);
      const enc2 = LcgCipher.obfuscate(text, LCG_DEFAULT_SEED);

      // Khác biệt 2 byte Salt ở đầu
      const salt1 = [enc1[0], enc1[1]];
      const salt2 = [enc2[0], enc2[1]];
      expect(enc1).not.toEqual(enc2);

      // Cả hai đều giải mã hoàn hảo về chuỗi gốc
      expect(LcgCipher.deobfuscate(enc1, LCG_DEFAULT_SEED)).toBe(text);
      expect(LcgCipher.deobfuscate(enc2, LCG_DEFAULT_SEED)).toBe(text);
    });
  });

  describe("2. Ẩn Tên Miền Hệ Thống (Domain Masking via LCG)", () => {
    it("deobfuscates all protected official domains correctly at runtime", () => {
      const domains = getLcgProtectedDomains();
      expect(domains).toContain("license.gpt.io.vn");
      expect(domains).toContain("otter.gpt.io.vn");
      expect(domains).toContain("gpt.io.vn");
      expect(domains).toContain("license.otter.ai");
      expect(domains).toContain("api.otter.ai");
      expect(domains).toContain("auth.otter.ai");
      expect(domains).toContain("otter.ai");
    });

    it("integrates seamlessly with hosts-guard for spoofing detection", () => {
      const protectedDomains = getProtectedDomains();
      expect(protectedDomains).toContain("license.gpt.io.vn");

      // Giả lập hacker chuyển hướng license.gpt.io.vn trong hosts
      const check = checkHostsFileContent("127.0.0.1 license.gpt.io.vn");
      expect(check.valid).toBe(false);
      expect(check.tamperedDomain).toBe("license.gpt.io.vn");
      expect(check.mappedIp).toBe("127.0.0.1");
    });

    it("recovers protected server URLs from LCG tables", () => {
      const licenseServerUrl = getLcgServerUrl("LICENSE_SERVER_URL");
      expect(licenseServerUrl).toBe("https://license.gpt.io.vn");

      const otterServerUrl = getLcgServerUrl("OTTER_SERVER_URL");
      expect(otterServerUrl).toBe("https://otter.gpt.io.vn");
    });
  });

  describe("3. Ẩn Đường Dẫn Router (Router Masking via LCG)", () => {
    it("deobfuscates all core API routes without plain literals in code", () => {
      expect(getLcgRoute("ACTIVATE")).toBe("/api/v1/license/activate");
      expect(getLcgRoute("HEARTBEAT")).toBe("/api/v1/license/heartbeat");
      expect(getLcgRoute("ISSUE")).toBe("/api/v1/packages/issue");
      expect(getLcgRoute("REVOKE")).toBe("/api/v1/license/revoke");
      expect(getLcgRoute("STATUS")).toBe("/api/v1/license/status");
    });

    it("matches route path accurately using matchLcgRoute and matchAnyLcgRoute", () => {
      expect(matchLcgRoute("/api/v1/license/activate", "ACTIVATE")).toBe(true);
      expect(matchLcgRoute("/api/v1/license/activate", "HEARTBEAT")).toBe(false);
      expect(matchLcgRoute("/api/v1/unknown", "ACTIVATE")).toBe(false);

      expect(matchAnyLcgRoute("/api/v1/packages/issue")).toBe("ISSUE");
      expect(matchAnyLcgRoute("/api/v1/license/heartbeat")).toBe("HEARTBEAT");
      expect(matchAnyLcgRoute("/api/v1/license/revoke")).toBe("REVOKE");
      expect(matchAnyLcgRoute("/random/endpoint")).toBeNull();
    });

    it("verifies that OBFUSCATED_ROUTES stores pure integer byte arrays", () => {
      for (const [key, bytes] of Object.entries(OBFUSCATED_ROUTES)) {
        expect(Array.isArray(bytes)).toBe(true);
        for (const b of bytes) {
          expect(typeof b).toBe("number");
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(255);
        }
      }
    });
  });

  describe("4. Dynamic Router Knocking (Router Luân Chuyển Động)", () => {
    it("generates time-windowed dynamic knock path for routes", () => {
      const knockPath = generateDynamicKnockPath("ACTIVATE");
      expect(knockPath.startsWith("/api/v1/license/activate/_k_")).toBe(true);
      expect(knockPath.length).toBeGreaterThan("/api/v1/license/activate/_k_".length);
    });

    it("validates dynamic knock path for the active time window", () => {
      const knockPath = generateDynamicKnockPath("HEARTBEAT", 60000); // 1 phút
      expect(matchDynamicKnockPath(knockPath, "HEARTBEAT", 60000)).toBe(true);
      expect(matchDynamicKnockPath(knockPath, "ACTIVATE", 60000)).toBe(false);
      expect(matchDynamicKnockPath("/api/v1/license/heartbeat/_k_deadbeef", "HEARTBEAT", 60000)).toBe(false);
    });
  });

  describe("5. End-to-End Client & Server Integration với Router Ẩn", () => {
    it("executes online activation and heartbeat seamlessly using masked routes", async () => {
      const testEmail = "lcg-user@domain.vn";
      const issueRes = await issueLicense(db, {
        email: testEmail,
        package_type: "pro",
        duration_days: 30,
        send_email: false,
      });

      const serverUrl = `http://127.0.0.1:${TEST_PORT}`;

      // Kích hoạt qua hybrid-client (sử dụng getLcgRoute('ACTIVATE') ngầm)
      const actRes = await activateOnline({
        serverUrl,
        email: testEmail,
        licenseKey: issueRes.license_key,
      });

      expect(actRes.success).toBe(true);
      expect(actRes.leasedToken).toBeDefined();

      // Gửi heartbeat qua hybrid-client (sử dụng getLcgRoute('HEARTBEAT') ngầm)
      const hbRes = await sendHeartbeat(serverUrl);
      expect(hbRes.success).toBe(true);
      expect(hbRes.renewed).toBe(true);
    });
  });
});
