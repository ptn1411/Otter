import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getPayloadCipherKey,
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  validateSecureUrl,
  verifyTlsCertificateAuthority,
  secureFetch,
  encryptedJsonResponse,
} from "../src/daemon/license/payload-cipher";
import {
  initLicenseDatabase,
  issueLicense,
  startLicenseServer,
} from "../src/server/license-server";
import { activateOnline, sendHeartbeat } from "../src/daemon/license/hybrid-client";
import { generateSupportCode } from "../src/daemon/license/support-code";
import { getDeviceHash } from "../src/daemon/license/fingerprint";

const TEST_DB_PATH = path.join(process.cwd(), "data", "test-cipher-server.sqlite");
const TEST_PORT = 1999;

describe("SSL & Payload Cipher End-to-End Tests (Bảo mật SSL và Mã hóa Chống Xem Dữ Liệu)", () => {
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

  describe("1. AES-256-GCM Envelope Encryption (Mã hóa gói tin)", () => {
    it("derives a 32-byte (256-bit) encryption key", () => {
      const key = getPayloadCipherKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it("encrypts and decrypts complex JSON objects accurately", () => {
      const secretData = {
        email: "customer@domain.com",
        license_key: "OTTER-PRO-30D-XYZ12345",
        device_hash: "a1b2c3d4e5f60718",
        support_code: "7K9M-2P4Q-8R1S",
        timestamp: Date.now(),
        nested: { role: "admin", flags: [1, 2, 3] },
      };

      const envelope = encryptPayload(secretData);
      expect(envelope.__encrypted).toBe(true);
      expect(envelope.iv).toBeDefined();
      expect(envelope.tag).toBeDefined();
      expect(envelope.data).toBeDefined();
      expect(typeof envelope.data).toBe("string");

      // Dữ liệu mã hóa không được chứa văn bản thô
      expect(envelope.data.includes("customer@domain.com")).toBe(false);
      expect(envelope.data.includes("OTTER-PRO-30D")).toBe(false);

      // Giải mã
      const decrypted = decryptPayload<typeof secretData>(envelope);
      expect(decrypted).toEqual(secretData);
    });

    it("produces distinct ciphertexts for identical plaintext due to random IV", () => {
      const payload = { test: "confidential" };
      const env1 = encryptPayload(payload);
      const env2 = encryptPayload(payload);

      expect(env1.iv).not.toBe(env2.iv);
      expect(env1.data).not.toBe(env2.data);

      expect(decryptPayload(env1)).toEqual(payload);
      expect(decryptPayload(env2)).toEqual(payload);
    });

    it("detects ciphertext tampering and rejects with authentication error", () => {
      const payload = { amount: 1000 };
      const env = encryptPayload(payload);

      // Sửa đổi dữ liệu data
      const tamperedBytes = Buffer.from(env.data, "base64");
      tamperedBytes[0] = tamperedBytes[0]! ^ 0xff;
      env.data = tamperedBytes.toString("base64");

      expect(() => decryptPayload(env)).toThrow();
    });

    it("accurately validates encrypted envelope structure", () => {
      expect(isEncryptedEnvelope(null)).toBe(false);
      expect(isEncryptedEnvelope("string")).toBe(false);
      expect(isEncryptedEnvelope({})).toBe(false);
      expect(isEncryptedEnvelope({ __encrypted: true, iv: "a", tag: "b", data: "c" })).toBe(true);
    });
  });

  describe("2. SSL/TLS Protocol & Proxy Interception Guard", () => {
    it("allows HTTPS and WSS protocols for remote servers", () => {
      const res1 = validateSecureUrl("https://license.gpt.io.vn");
      expect(res1.secure).toBe(true);

      const res2 = validateSecureUrl("https://otter.gpt.io.vn/api/v1/status");
      expect(res2.secure).toBe(true);

      const res3 = validateSecureUrl("wss://api.domain.com/feed");
      expect(res3.secure).toBe(true);
    });

    it("allows localhost and 127.0.0.1 for local daemon communication", () => {
      const res1 = validateSecureUrl("http://localhost:1993");
      expect(res1.secure).toBe(true);

      const res2 = validateSecureUrl("http://127.0.0.1:1994/api/v1");
      expect(res2.secure).toBe(true);
    });

    it("blocks insecure HTTP cleartext for non-localhost remote servers", () => {
      const res = validateSecureUrl("http://license.gpt.io.vn/api/v1/activate");
      expect(res.secure).toBe(false);
      expect(res.reason).toContain("bắt buộc phải sử dụng kết nối bảo mật HTTPS/WSS");
    });

    it("detects and blocks proxy/packet sniffing CA certificates (mitmproxy, Fiddler, Charles, Burp)", () => {
      const badCAs = [
        "CN=mitmproxy, O=mitmproxy",
        "CN=DO_NOT_TRUST_FiddlerRoot, O=DO_NOT_TRUST",
        "CN=Charles Proxy CA, OU=XK72 Ltd",
        "PortSwigger CA",
        "Burp Suite Intermediate Certificate",
        "Wireshark Test CA",
      ];

      for (const ca of badCAs) {
        const check = verifyTlsCertificateAuthority(ca);
        expect(check.valid).toBe(false);
        expect(check.reason).toContain("bị giả mạo / can thiệp bởi công cụ proxy");
      }

      // Hợp lệ với các CA chính thống
      const goodCAs = [
        "Let's Encrypt Authority X3",
        "DigiCert Global Root CA",
        "Cloudflare Inc ECC CA-3",
        "Google Trust Services LLC",
      ];

      for (const ca of goodCAs) {
        const check = verifyTlsCertificateAuthority(ca);
        expect(check.valid).toBe(true);
      }
    });
  });

  describe("3. End-to-End Encrypted API Communication (Mã hóa toàn diện Client - Server)", () => {
    it("activates license via encrypted POST request and receives encrypted response", async () => {
      const testEmail = "secure-user@domain.vn";
      const issueRes = await issueLicense(db, {
        email: testEmail,
        package_type: "pro",
        duration_days: 30,
        send_email: false,
      });

      const serverUrl = `http://127.0.0.1:${TEST_PORT}`;
      const supportCode = generateSupportCode();
      const deviceHash = getDeviceHash();

      // 1. Gửi request mã hóa trực tiếp qua secureFetch
      const res = await secureFetch(`${serverUrl}/api/v1/license/activate`, {
        method: "POST",
        encrypt: true,
        body: JSON.stringify({
          email: testEmail,
          license_key: issueRes.license_key,
          support_code: supportCode,
          device_hash: deviceHash,
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Otter-Encrypted")).toBe("1");

      // res.json() tự động giải mã
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.leased_token).toBeDefined();
      expect(data.package_type).toBe("pro");
    });

    it("activates and heartbeats seamlessly via hybrid client with automatic encryption", async () => {
      const testEmail = "client-user@domain.vn";
      const issueRes = await issueLicense(db, {
        email: testEmail,
        package_type: "enterprise",
        duration_days: 60,
        send_email: false,
      });

      const serverUrl = `http://127.0.0.1:${TEST_PORT}`;

      // Kích hoạt qua hybrid-client (tự động bật mã hóa và kiểm tra SSL)
      const actRes = await activateOnline({
        serverUrl,
        email: testEmail,
        licenseKey: issueRes.license_key,
      });

      expect(actRes.success).toBe(true);
      expect(actRes.leasedToken).toBeDefined();
      expect(actRes.packageType).toBe("enterprise");

      // Gửi heartbeat ngầm qua hybrid-client (mã hóa 2 chiều)
      const hbRes = await sendHeartbeat(serverUrl);
      expect(hbRes.success).toBe(true);
      expect(hbRes.renewed).toBe(true);
      expect(hbRes.leasedExpiresAt).toBeDefined();
    });

    it("blocks activation attempt to insecure remote HTTP server", async () => {
      const insecureUrl = "http://fake-remote-server.com";
      const actRes = await activateOnline({
        serverUrl: insecureUrl,
        email: "any@domain.com",
        licenseKey: "OTTER-PRO-30D-FAKE1234",
      });

      expect(actRes.success).toBe(false);
      expect(actRes.error).toContain("bắt buộc phải sử dụng kết nối bảo mật HTTPS/WSS");
    });
  });
});
