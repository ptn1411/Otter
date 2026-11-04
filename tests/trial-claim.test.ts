import { describe, it, expect } from "bun:test";
import { initLicenseDatabase, claimTrialLicense } from "../src/server/license-server";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Google Sign-In 30-Day Trial Claims", () => {
  const testDbPath = path.join(process.cwd(), "data", "test-trial-server.sqlite");

  // Cleanup old test db if exists
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const db = initLicenseDatabase(testDbPath);

  it("cho phép email nhận 30 ngày dùng thử lần đầu tiên", async () => {
    const res = await claimTrialLicense(db, {
      email: "tester.trial@example.com",
      name: "Test User",
      ip_address: "127.0.0.1",
    });

    expect(res.success).toBe(true);
    expect(res.duration_days).toBe(30);
    expect(res.license_key).toStartWith("OTTER-TRIAL-30D-");
    expect(res.expires_at).toBeDefined();

    // Kiểm tra trong DB
    const claim = db.query("SELECT * FROM trial_claims WHERE email = ?").get("tester.trial@example.com") as any;
    expect(claim).toBeDefined();
    expect(claim.license_key).toBe(res.license_key);
  });

  it("cho phép email yêu cầu tạo lại key 30 ngày dùng thử (không giới hạn 1 email 1 lần)", async () => {
    // Thử lại chính xác email đó
    const res2 = await claimTrialLicense(db, {
      email: "tester.trial@example.com",
      name: "Test User Duplicate",
      ip_address: "127.0.0.1",
    });

    expect(res2.success).toBe(true);
    expect(res2.duration_days).toBe(30);
    expect(res2.license_key).toStartWith("OTTER-TRIAL-30D-");
  });

  it("chuẩn hóa chữ hoa chữ thường: TESTER.TRIAL@EXAMPLE.COM cũng thành công", async () => {
    const res3 = await claimTrialLicense(db, {
      email: "TESTER.TRIAL@EXAMPLE.COM",
      name: "Uppercase Test",
      ip_address: "127.0.0.1",
    });

    expect(res3.success).toBe(true);
    expect(res3.duration_days).toBe(30);
    expect(res3.license_key).toStartWith("OTTER-TRIAL-30D-");
  });

  it("từ chối email không hợp lệ", async () => {
    const resInvalid = await claimTrialLicense(db, {
      email: "invalid-email-string",
    });

    expect(resInvalid.success).toBe(false);
    expect(resInvalid.error).toContain("không hợp lệ");
  });

  it("verifyFirebaseIdToken từ chối token rỗng hoặc token giả mạo", async () => {
    const { verifyFirebaseIdToken } = await import("../src/server/license-server");
    const emptyRes = await verifyFirebaseIdToken("");
    expect(emptyRes.valid).toBe(false);

    const fakeRes = await verifyFirebaseIdToken("fake.invalid.jwt_token_here");
    expect(fakeRes.valid).toBe(false);
  });
});
