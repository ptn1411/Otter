/**
 * Test xoay key bản quyền + các fix đi kèm (chạy local, cần mạng? KHÔNG —
 * mọi thứ chạy offline với key mới và DB tạm).
 *
 * Chuẩn bị: chạy bun scripts/rotate-license-key.ts trước để có key mới,
 * rồi chạy test với MASTER_PRIVATE_KEY_FILE trỏ tới file private key đó.
 * Test KHÔNG BAO GIỜ in private key. Chạy với HOME tạm để không đụng
 * tới license.json thật của máy:
 *
 *   HOME=/tmp/lic-test-home MASTER_PRIVATE_KEY_FILE=$HOME/.otter/master-private-key.txt \
 *     bun scripts/test-license-rotation.ts
 *
 * Kiểm tra:
 *  1. Token ký bằng key mới + đúng máy -> verify hợp lệ.
 *  2. Token ký bằng key lạ (đại diện key cũ đã thu hồi) -> verify FAIL.
 *  3. Heartbeat với token mới + activation tồn tại -> gia hạn thành công,
 *     token mới cũng verify được.
 *  4. Heartbeat với token giả mạo chữ ký -> từ chối.
 *  5. Heartbeat với token đã hết hạn thuê -> từ chối (phải kích hoạt lại).
 *  6. Heartbeat sau khi xóa activation (thu hồi) -> từ chối.
 *  7. Token wildcard device_hash '*' -> verify FAIL.
 *  8. Daemon routes ISSUE / REVOKE / STATUS không có admin -> 401.
 *  9. saveLicense chỉ ghi file hệ thống, quyền 0600, không ghi data/license.json.
 * 10. Rate limit: quá limit -> false.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const keyFile = process.env.MASTER_PRIVATE_KEY_FILE || path.join(os.homedir(), ".otter", "master-private-key.txt");
if (!fs.existsSync(keyFile)) {
  console.error(`Thiếu file private key mới: ${keyFile}\nChạy bun scripts/rotate-license-key.ts trước.`);
  process.exit(2);
}
process.env.MASTER_PRIVATE_KEY_FILE = keyFile;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lic-test-"));
const tmpHome = path.join(tmpRoot, "home");
const tmpCwd = path.join(tmpRoot, "cwd");
fs.mkdirSync(tmpHome, { recursive: true });
fs.mkdirSync(tmpCwd, { recursive: true });
process.chdir(tmpCwd);
process.env.HOME = tmpHome;

const { initLicenseDatabase, signLicenseToken, activateDevice, heartbeatDevice } =
  await import("../src/server/license-server.ts");
const { verifyLicenseWithDevice } = await import("../src/daemon/license/verify.ts");
const { getDeviceHash } = await import("../src/daemon/license/fingerprint.ts");
const { generateSupportCode } = await import("../src/daemon/license/support-code.ts");
const { saveLicense, loadLicense, getSystemLicensePath } = await import("../src/daemon/license/storage.ts");
const { getLicenseStatus } = await import("../src/daemon/license/guard.ts");
const { handleLicenseRoutes } = await import("../src/daemon/routes/license-routes.ts");
const { getLcgRoute } = await import("../src/daemon/license/lcg-router.ts");
const { allowLicenseRequest, clearLicenseRateLimits } = await import("../src/daemon/license/rate-limit.ts");
const { signPayload, canonicalJSON, bytesToBase64 } = await import("../src/daemon/license/crypto.ts");

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra = "") {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${extra}`); }
}

const db = initLicenseDatabase(path.join(tmpRoot, "license-server.sqlite"));
const email = "test-rotation@example.com";
const licenseKey = `OTTER-ENTERPRISE-365D-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
const packageExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
db.run(
  `INSERT INTO licenses (id, license_key, email, package_type, duration_days, max_devices, issued_at, expires_at, status, note)
   VALUES (?, ?, ?, 'enterprise', 365, 2, ?, ?, 'active', 'test rotation')`,
  [crypto.randomUUID(), licenseKey, email, new Date().toISOString(), packageExpires]
);

const deviceHash = getDeviceHash();
const supportCode = generateSupportCode();
const now = Date.now();
function makeToken(overrides: Record<string, unknown> = {}) {
  return signLicenseToken({
    product_id: "otter",
    version: 1,
    license_type: "enterprise",
    issued_at: new Date(now).toISOString(),
    expires_at: packageExpires,
    leased_expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    device_hash: deviceHash,
    customer: email,
    tier: "enterprise",
    license_key: licenseKey,
    ...overrides,
  });
}
function forgeToken(payload: Record<string, unknown>): string {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" }) as any;
  const seed = Buffer.from(jwk.d, "base64url");
  const bytes = new TextEncoder().encode(canonicalJSON(payload));
  const sig = signPayload(new Uint8Array(bytes), new Uint8Array(seed));
  return `${bytesToBase64(new Uint8Array(bytes))}.${bytesToBase64(sig)}`;
}

const token = makeToken();
const [payloadB64, sigB64] = token.split(".");

// 1. Token key mới verify OK
const v1 = await verifyLicenseWithDevice({ payload: payloadB64!, signature: sigB64! });
ok("token key mới verify hợp lệ", v1.valid === true, v1.reason || "");

// 2. Token key lạ (key cũ / giả mạo) verify FAIL
const forged = forgeToken({
  product_id: "otter", version: 1, license_type: "enterprise",
  issued_at: new Date(now).toISOString(), expires_at: packageExpires,
  leased_expires_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  device_hash: deviceHash, customer: email, tier: "enterprise", license_key: licenseKey,
});
const [fPayload, fSig] = forged.split(".");
const v2 = await verifyLicenseWithDevice({ payload: fPayload!, signature: fSig! });
ok("token key lạ verify FAIL", v2.valid === false);

// 7. Wildcard FAIL (chạy trước heartbeat để khỏi nhiễu activation)
const wild = makeToken({ device_hash: "*" });
const [wPayload, wSig] = wild.split(".");
const vWild = await verifyLicenseWithDevice({ payload: wPayload!, signature: wSig! });
ok("token wildcard device_hash '*' verify FAIL", vWild.valid === false);

// 3. Heartbeat thành công với activation tồn tại
db.run(
  `INSERT INTO activations (id, license_key, device_hash, support_code, activated_at, last_heartbeat, leased_expires_at, ip_address)
   VALUES (?, ?, ?, ?, ?, ?, ?, '127.0.0.1')`,
  [crypto.randomUUID(), licenseKey, deviceHash, supportCode, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString()]
);
const hb1 = await heartbeatDevice(db, token, supportCode);
ok("heartbeat token mới thành công", hb1.success === true, hb1.error || "");
if (hb1.leased_token) {
  const [rp, rs] = hb1.leased_token.split(".");
  const vr = await verifyLicenseWithDevice({ payload: rp!, signature: rs! });
  ok("token sau heartbeat verify được", vr.valid === true, vr.reason || "");
} else {
  ok("token sau heartbeat verify được", false, "không có leased_token trả về");
}

// 4. Heartbeat token giả mạo chữ ký -> từ chối
const hbForged = await heartbeatDevice(db, forged, supportCode);
ok("heartbeat token giả mạo bị từ chối", hbForged.success === false);

// 5. Heartbeat token đã hết hạn thuê -> từ chối
const expired = makeToken({ leased_expires_at: new Date(now - 60_000).toISOString() });
const hbExpired = await heartbeatDevice(db, expired, supportCode);
ok("heartbeat token hết hạn thuê bị từ chối", hbExpired.success === false, hbExpired.error || "");

// 6. Heartbeat sau khi xóa activation -> từ chối
db.run("DELETE FROM activations WHERE license_key = ?", [licenseKey]);
const hbRevoked = await heartbeatDevice(db, token, supportCode);
ok("heartbeat sau thu hồi activation bị từ chối", hbRevoked.success === false);

// 8. Daemon routes không admin -> 401
const issuePath = getLcgRoute("ISSUE");
const statusPath = getLcgRoute("STATUS");
const revokePath = getLcgRoute("REVOKE");
const rIssue = await handleLicenseRoutes(
  new Request(`http://127.0.0.1${issuePath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@y.zz" }) }),
  new URL(`http://127.0.0.1${issuePath}`)
);
ok("daemon ISSUE không admin -> 401", rIssue?.status === 401, `status=${rIssue?.status}`);
const rStatus = await handleLicenseRoutes(
  new Request(`http://127.0.0.1${statusPath}?key=${licenseKey}`, { method: "GET" }),
  new URL(`http://127.0.0.1${statusPath}?key=${licenseKey}`)
);
ok("daemon STATUS không admin -> 401", rStatus?.status === 401, `status=${rStatus?.status}`);
const rRevoke = await handleLicenseRoutes(
  new Request(`http://127.0.0.1${revokePath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ license_key: licenseKey }) }),
  new URL(`http://127.0.0.1${revokePath}`)
);
ok("daemon REVOKE không admin -> 401", rRevoke?.status === 401, `status=${rRevoke?.status}`);

// 9. Storage: chỉ file hệ thống, quyền 0600, không ghi data/license.json
saveLicense({ payload: payloadB64!, signature: sigB64!, leased_token: token, email, last_heartbeat: Date.now() });
const sysPath = getSystemLicensePath();
// Lưu ý: os.homedir() đọc HOME lúc process khởi động (HOME shell), không
// phải HOME gán lại trong script — nên chỉ khẳng định file tồn tại, nằm
// ngoài home thật (/home/hatch) và ngoài repo, chứ không khẳng định tmpHome.
const sysOk = fs.existsSync(sysPath) && !sysPath.startsWith("/home/hatch") && !sysPath.startsWith(tmpCwd);
const modeOk = sysOk && (process.platform === "win32" || (fs.statSync(sysPath).mode & 0o777) === 0o600);
ok("saveLicense ghi file hệ thống quyền 0600", sysOk && modeOk, `path=${sysPath}`);
ok("saveLicense không ghi data/license.json trong project", !fs.existsSync(path.join(tmpCwd, "data", "license.json")));
const loaded = loadLicense();
ok("loadLicense đọc lại được token đã lưu", !!loaded && loaded.leased_token === token);
const status = await getLicenseStatus();
ok("getLicenseStatus (hybrid) báo licensed với token mới", status.licensed === true, status.reason || "");

// 10. Rate limit
clearLicenseRateLimits();
const rl1 = allowLicenseRequest("test-rl", 2);
const rl2 = allowLicenseRequest("test-rl", 2);
const rl3 = allowLicenseRequest("test-rl", 2);
ok("rate limit chặn lần thứ 3 vượt limit 2", rl1 && rl2 && !rl3);

// Bonus: activateDevice từ chối wildcard
const actWild = await activateDevice(db, { email, license_key: licenseKey, support_code: "*" } as any);
ok("activateDevice từ chối support_code '*'", actWild.success === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
