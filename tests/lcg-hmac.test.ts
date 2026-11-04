import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  LcgHmacGuard,
  secureLicenseRequest,
  handleActivateLicense,
  type SignedEnvelope,
  MAX_CLOCK_SKEW_MS,
  OBFUSCATED_HMAC_SECRET
} from "../src/daemon/license/lcg-hmac";
import {
  LcgCipher,
  generateDynamicKnockPath,
  matchDynamicKnockPath
} from "../src/daemon/license/lcg-router";
import { startLicenseServer, issueLicense, initLicenseDatabase } from "../src/server/license-server";
import * as path from "node:path";
import * as fs from "node:fs";

describe("LCG + HMAC-SHA256 Transport Security & Anti-Proxy Tests", () => {
  const TEST_ROUTE = "/api/v1/license/activate";
  const TEST_PORT = 1998;
  const TEST_DB_PATH = path.join(process.cwd(), "data", "test-hmac-license.sqlite");
  let serverInstance: any;
  let issuedKey: string = "";

  beforeAll(async () => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
    const db = initLicenseDatabase(TEST_DB_PATH);
    const issueRes = await issueLicense(db, {
      email: "hmac-user@example.com",
      package_type: "pro",
      duration_days: 30,
      note: "HMAC Transport Security Test"
    });
    issuedKey = issueRes.license_key;
    serverInstance = startLicenseServer(TEST_PORT, TEST_DB_PATH);
  }, 30000);

  afterAll(() => {
    if (serverInstance && typeof serverInstance.stop === "function") {
      serverInstance.stop();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch {}
    }
  });

  describe("1. LcgHmacGuard Cryptographic Integrity & Nonce Generation", () => {
    it("deobfuscates master HMAC secret cleanly with zero plain string exposure", () => {
      const secret = LcgCipher.deobfuscate(OBFUSCATED_HMAC_SECRET);
      expect(secret).toBe("ottr_v2_hmac_master_key_9f8e7d6c5b4a3210!");
      expect(Array.isArray(OBFUSCATED_HMAC_SECRET)).toBe(true);
    });

    it("generates 32-character hex nonces with high entropy", () => {
      const n1 = LcgHmacGuard.generateNonce();
      const n2 = LcgHmacGuard.generateNonce();
      expect(n1).toMatch(/^[0-9a-f]{32}$/);
      expect(n2).toMatch(/^[0-9a-f]{32}$/);
      expect(n1).not.toBe(n2);
    });

    it("signs and verifies canonical message successfully using WebCrypto", async () => {
      const nonce = LcgHmacGuard.generateNonce();
      const ts = Date.now();
      const payload = JSON.stringify({ device: "win32-hash", plan: "pro" });

      const sig = await LcgHmacGuard.signData(TEST_ROUTE, nonce, ts, payload);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);

      const isValid = await LcgHmacGuard.verifyData(TEST_ROUTE, nonce, ts, payload, sig);
      expect(isValid).toBe(true);
    });

    it("detects and rejects any modification to route, nonce, timestamp, or payload", async () => {
      const nonce = LcgHmacGuard.generateNonce();
      const ts = Date.now();
      const payload = JSON.stringify({ licenseValid: true });

      const sig = await LcgHmacGuard.signData(TEST_ROUTE, nonce, ts, payload);

      // 1. Modifying payload
      const tamperedPayload = JSON.stringify({ licenseValid: false });
      expect(await LcgHmacGuard.verifyData(TEST_ROUTE, nonce, ts, tamperedPayload, sig)).toBe(false);

      // 2. Modifying route
      expect(await LcgHmacGuard.verifyData("/api/v1/license/tampered", nonce, ts, payload, sig)).toBe(false);

      // 3. Modifying nonce
      expect(await LcgHmacGuard.verifyData(TEST_ROUTE, "tampered-nonce", ts, payload, sig)).toBe(false);

      // 4. Modifying timestamp
      expect(await LcgHmacGuard.verifyData(TEST_ROUTE, nonce, ts + 1000, payload, sig)).toBe(false);

      // 5. Corrupt signature
      const corruptedSig = sig.slice(0, -2) + (sig.endsWith("00") ? "11" : "00");
      expect(await LcgHmacGuard.verifyData(TEST_ROUTE, nonce, ts, payload, corruptedSig)).toBe(false);
    });

    it("rejects expired timestamps outside MAX_CLOCK_SKEW_MS", async () => {
      const nonce = LcgHmacGuard.generateNonce();
      const expiredTs = Date.now() - (MAX_CLOCK_SKEW_MS + 5000); // 2m 5s ago
      const payload = JSON.stringify({ ping: true });

      const sig = await LcgHmacGuard.signData(TEST_ROUTE, nonce, expiredTs, payload);
      const isValid = await LcgHmacGuard.verifyData(TEST_ROUTE, nonce, expiredTs, payload, sig);
      expect(isValid).toBe(false);
    });
  });

  describe("2. Server-side handleActivateLicense (Standalone Handler)", () => {
    it("handles dynamic knock activation request and returns signed response", async () => {
      const dynamicKnock = generateDynamicKnockPath("ACTIVATE");
      const clientNonce = LcgHmacGuard.generateNonce();
      const reqTime = Date.now();
      const rawBody = JSON.stringify({ email: "user@test.com" });

      const reqSig = await LcgHmacGuard.signData(dynamicKnock, clientNonce, reqTime, rawBody);

      const res = await handleActivateLicense({
        pathname: dynamicKnock,
        headers: {
          "x-ottr-nonce": clientNonce,
          "x-ottr-timestamp": String(reqTime),
          "x-ottr-signature": reqSig,
        },
        rawBody,
      });

      expect(res.status).toBe(200);
      const envelope = res.body as SignedEnvelope<any>;
      expect(envelope.nonce).toBe(clientNonce);
      expect(envelope.payload.licenseValid).toBe(true);

      // Verify the returned server signature
      const isResponseValid = await LcgHmacGuard.verifyData(
        dynamicKnock,
        envelope.nonce,
        envelope.timestamp,
        JSON.stringify(envelope.payload),
        envelope.signature
      );
      expect(isResponseValid).toBe(true);
    });

    it("rejects forged or unsigned requests with 403 Forbidden", async () => {
      const dynamicKnock = generateDynamicKnockPath("ACTIVATE");
      const clientNonce = LcgHmacGuard.generateNonce();

      const res = await handleActivateLicense({
        pathname: dynamicKnock,
        headers: {
          "x-ottr-nonce": clientNonce,
          "x-ottr-timestamp": String(Date.now()),
          "x-ottr-signature": "0000000000000000000000000000000000000000000000000000000000000000",
        },
        rawBody: "{}",
      });

      expect(res.status).toBe(403);
    });

    it("rejects requests to non-existent or invalid knock paths with 404", async () => {
      const res = await handleActivateLicense({
        pathname: "/invalid/path",
        headers: {},
        rawBody: "{}",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("3. Client-side secureLicenseRequest & Anti-Proxy Hardening", () => {
    it("successfully sends signed knock request and unpacks verified payload from real server", async () => {
      const serverUrl = `http://127.0.0.1:${TEST_PORT}`;
      const payload = {
        email: "hmac-user@example.com",
        license_key: issuedKey,
        device_hash: "device-123456",
        support_code: "ABCDE-12345",
      };

      const result = await secureLicenseRequest<any, any>(
        serverUrl,
        "ACTIVATE",
        payload
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.leased_token).toBeDefined();
    });

    it("detects and aborts on Replay Attack when server/proxy returns a mismatched nonce", async () => {
      const mockFetch: typeof fetch = async () => {
        const fakeEnvelope: SignedEnvelope<any> = {
          payload: { licenseValid: true },
          timestamp: Date.now(),
          nonce: "replayed-attacker-nonce-99999999", // Mismatched nonce
          signature: "some-sig",
        };
        return new Response(JSON.stringify(fakeEnvelope), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      expect(
        secureLicenseRequest("http://mock-server", "ACTIVATE", { foo: "bar" }, mockFetch)
      ).rejects.toThrow("Replay");
    });

    it("detects and aborts on Man-in-the-Middle Proxy response tampering", async () => {
      const clientNonce = "0123456789abcdef0123456789abcdef";
      const ts = Date.now();
      const dynamicPath = generateDynamicKnockPath("ACTIVATE");

      // Attacker signs payload { plan: "trial" }
      const legitimatePayload = { plan: "trial" };
      const sig = await LcgHmacGuard.signData(
        dynamicPath,
        clientNonce,
        ts,
        JSON.stringify(legitimatePayload)
      );

      // Proxy intercepts and modifies payload to { plan: "enterprise" } without re-signing
      const tamperedEnvelope: SignedEnvelope<any> = {
        payload: { plan: "enterprise" }, // Tampered!
        timestamp: ts,
        nonce: clientNonce,
        signature: sig,
      };

      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(tamperedEnvelope), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      // Since secureLicenseRequest generates its own clientNonce, we mock generateNonce
      const origNonceGen = LcgHmacGuard.generateNonce;
      LcgHmacGuard.generateNonce = () => clientNonce;

      try {
        await expect(
          secureLicenseRequest("http://mock-server", "ACTIVATE", {}, mockFetch)
        ).rejects.toThrow("Proxy");
      } finally {
        LcgHmacGuard.generateNonce = origNonceGen;
      }
    });

    it("throws HTTP Error on server error status", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response("Server error", { status: 500 });
      };

      expect(
        secureLicenseRequest("http://mock-server", "ACTIVATE", {}, mockFetch)
      ).rejects.toThrow("HTTP Error: 500");
    });
  });
});
