import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { verifyClockIntegrity, setClockGuardForTesting } from "../src/daemon/license/clock-guard";
import { verifyLicenseWithDevice } from "../src/daemon/license/verify";
import { generateSupportCode } from "../src/daemon/license/support-code";
import {
  initLicenseDatabase,
  issueLicense,
  activateDevice,
  heartbeatDevice,
  startLicenseServer,
} from "../src/server/license-server";
import { activateOnline, sendHeartbeat, verifyHybridLicense } from "../src/daemon/license/hybrid-client";
import { saveLicense } from "../src/daemon/license/storage";

const TEST_DB_PATH = path.join(process.cwd(), "data", "test-license-hybrid.sqlite");
const TEST_PORT = 1996;

describe("Otter License Hardening & Hybrid Server Tests", () => {
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

  describe("1. Clock Rollback Defense (Chống lùi ngày giờ hệ thống)", () => {
    it("allows progressive time timestamps and updates tracker", () => {
      const now = 1700000000000;
      setClockGuardForTesting(now);

      const check1 = verifyClockIntegrity(now + 10000);
      expect(check1.valid).toBe(true);

      const check2 = verifyClockIntegrity(now + 20000);
      expect(check2.valid).toBe(true);
    });

    it("detects and rejects clock rollback (lùi thời gian về quá khứ)", () => {
      const futureTime = 1750000000000;
      setClockGuardForTesting(futureTime);

      // Thử lùi thời gian về trước 1 ngày (86,400,000 ms)
      const rolledBackTime = futureTime - 86400000;
      const check = verifyClockIntegrity(rolledBackTime);

      expect(check.valid).toBe(false);
      expect(check.reason).toContain("Clock Rollback");
    });
  });

  describe("2. Package Issuance & Email Notification", () => {
    it("issues a 30-day Pro license and sends email token", async () => {
      const result = await issueLicense(db, {
        email: "khachhang@example.com",
        package_type: "pro",
        duration_days: 30,
        max_devices: 2,
        send_email: true,
      });

      expect(result.success).toBe(true);
      expect(result.license_key).toStartWith("OTTER-PRO-30D-");
      expect(result.email).toBe("khachhang@example.com");
      expect(result.duration_days).toBe(30);
      expect(result.max_devices).toBe(2);
      expect(result.expires_at).toBeTruthy();
      expect(result.email_sent).toBe(true);

      // Kiểm tra lưu trong database
      const row = db.query("SELECT * FROM licenses WHERE license_key = ?").get(result.license_key) as any;
      expect(row).toBeTruthy();
      expect(row.package_type).toBe("pro");
    });
  });

  describe("3. Online Activation API & Device Locking", () => {
    it("activates device successfully with email, license key and support code", async () => {
      const lic = await issueLicense(db, {
        email: "nam@company.com",
        package_type: "pro",
        duration_days: 60,
        max_devices: 1,
      });

      const actResult = await activateDevice(db, {
        email: "nam@company.com",
        license_key: lic.license_key,
        support_code: generateSupportCode(),
      });

      expect(actResult.success).toBe(true);
      expect(actResult.leased_token).toBeTruthy();
      expect(actResult.leased_token).toContain(".");
      expect(actResult.package_type).toBe("pro");

      // Xác thực Ed25519 token trả về
      const [payloadB64, sigB64] = actResult.leased_token!.split(".");
      const verifyRes = await verifyLicenseWithDevice({
        payload: payloadB64!,
        signature: sigB64!,
      }, { checkClock: false });

      expect(verifyRes.valid).toBe(true);
      expect(verifyRes.payload?.customer).toBe("nam@company.com");
      expect(verifyRes.entitlements?.tier).toBe("pro");
    });

    it("rejects activation when max_devices limit is exceeded", async () => {
      const lic = await issueLicense(db, {
        email: "single@user.com",
        package_type: "trial",
        duration_days: 7,
        max_devices: 1, // Chỉ cho 1 máy
      });

      // Máy 1 kích hoạt -> Thành công
      const act1 = await activateDevice(db, {
        email: "single@user.com",
        license_key: lic.license_key,
        support_code: "DEVICE-1111-2222-3333-4444-5555",
      });
      expect(act1.success).toBe(true);

      // Máy 2 kích hoạt -> Bị chặn vượt quá số lượng thiết bị
      const act2 = await activateDevice(db, {
        email: "single@user.com",
        license_key: lic.license_key,
        support_code: "DEVICE-AAAA-BBBB-CCCC-DDDD-EEEE",
      });
      expect(act2.success).toBe(false);
      expect(act2.error).toContain("vượt quá giới hạn thiết bị");
    });

    it("allows re-activation on the same device without consuming extra slots", async () => {
      const lic = await issueLicense(db, {
        email: "reinstall@user.com",
        package_type: "pro",
        duration_days: 30,
        max_devices: 1,
      });

      // Lần đầu kích hoạt
      const act1 = await activateDevice(db, {
        email: "reinstall@user.com",
        license_key: lic.license_key,
        support_code: "DEVICE-SAME-CODE-1234-5678-9999",
      });
      expect(act1.success).toBe(true);

      // Tái kích hoạt lại trên cùng máy (ví dụ sau khi cài lại app)
      const act2 = await activateDevice(db, {
        email: "reinstall@user.com",
        license_key: lic.license_key,
        support_code: "DEVICE-SAME-CODE-1234-5678-9999",
      });
      expect(act2.success).toBe(true);
    });
  });

  describe("4. Heartbeat Renewal & Offline Grace Period", () => {
    it("renews leased token via heartbeat API", async () => {
      const lic = await issueLicense(db, {
        email: "hb@user.com",
        package_type: "enterprise",
        duration_days: 365,
      });

      const act = await activateDevice(db, {
        email: "hb@user.com",
        license_key: lic.license_key,
        support_code: "DEVICE-HB-1234-5678-9999-0000",
      });

      expect(act.leased_token).toBeTruthy();

      const hbRes = await heartbeatDevice(db, act.leased_token!, "DEVICE-HB-1234-5678-9999-0000");
      expect(hbRes.success).toBe(true);
      expect(hbRes.leased_token).toBeTruthy();
      expect(hbRes.leased_expires_at).toBeTruthy();
    });

    it("supports offline grace period when leased token expired within 3 days", async () => {
      const lic = await issueLicense(db, {
        email: "grace@user.com",
        package_type: "pro",
        duration_days: 30,
      });

      const act = await activateDevice(db, {
        email: "grace@user.com",
        license_key: lic.license_key,
        support_code: generateSupportCode(),
      });

      // Lưu leased token vào storage cục bộ
      const [payloadB64, sigB64] = act.leased_token!.split(".");
      saveLicense({
        payload: payloadB64!,
        signature: sigB64!,
        leased_token: act.leased_token,
      });

      const leasedExpiryMs = new Date(act.leased_expires_at!).getTime();

      // Kiểm tra khi vừa hết hạn leased token 12 tiếng (trong 3 ngày grace period)
      const checkGrace = await verifyHybridLicense({
        now: leasedExpiryMs + 12 * 60 * 60 * 1000,
        gracePeriodMs: 72 * 60 * 60 * 1000,
      });

      expect(checkGrace.valid).toBe(true);
      expect(checkGrace.isGracePeriod).toBe(true);
      expect(checkGrace.reason).toContain("thời gian ân hạn Offline");

      // Kiểm tra khi vượt quá 3 ngày grace period (ví dụ 4 ngày = 96 giờ)
      const checkExpired = await verifyHybridLicense({
        now: leasedExpiryMs + 96 * 60 * 60 * 1000,
        gracePeriodMs: 72 * 60 * 60 * 1000,
      });

      expect(checkExpired.valid).toBe(false);
      expect(checkExpired.reason).toContain("vượt quá thời gian ân hạn");
    });
  });

  describe("5. End-to-End HTTP Client Activation", () => {
    it("performs complete client-to-server online activation over HTTP", async () => {
      const lic = await issueLicense(db, {
        email: "e2e@tester.com",
        package_type: "pro",
        duration_days: 30,
      });

      const clientRes = await activateOnline({
        serverUrl: `http://127.0.0.1:${TEST_PORT}`,
        email: "e2e@tester.com",
        licenseKey: lic.license_key,
      });

      expect(clientRes.success).toBe(true);
      expect(clientRes.leasedToken).toBeTruthy();
      expect(clientRes.packageType).toBe("pro");

      // Test gửi heartbeat qua client
      const hbClientRes = await sendHeartbeat(`http://127.0.0.1:${TEST_PORT}`);
      expect(hbClientRes.success).toBe(true);
      expect(hbClientRes.renewed).toBe(true);
    });
  });
});
