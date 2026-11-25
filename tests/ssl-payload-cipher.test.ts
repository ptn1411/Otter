import { describe, it, expect } from "bun:test";
import {
  getPayloadCipherKey,
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  validateSecureUrl,
  verifyTlsCertificateAuthority,
  encryptedJsonResponse,
} from "../src/daemon/license/payload-cipher";

describe("SSL & Payload Cipher Unit Tests (Bảo mật SSL và Mã hóa Chống Xem Dữ Liệu)", () => {

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
});
