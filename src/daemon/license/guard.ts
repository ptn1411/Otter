import { loadLicense, saveLicense, deleteLicense, hasLicense } from './storage';
import { verifyLicenseWithDevice, type VerificationResult } from './verify';
import { verifyHybridLicense } from './hybrid-client';
import { generateSupportCode } from './support-code';
import { getPublicKey } from './constants';
import { checkHostsIntegrity } from './hosts-guard';

let licenseCheckCache: boolean | null = null;
let lastCheckTime = 0;
const CACHE_TTL = 60000; // 60 seconds

export function clearLicenseCache(): void {
  licenseCheckCache = null;
  lastCheckTime = 0;
}

export async function checkIntegrity(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const pub = getPublicKey();
    if (pub.length !== 32) {
      return { ok: false, reason: 'Toàn vẹn khóa công khai bị vi phạm' };
    }
    const hostsCheck = checkHostsIntegrity();
    if (!hostsCheck.valid) {
      return { ok: false, reason: hostsCheck.reason || 'Can thiệp tệp hosts bị phát hiện' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'Toàn vẹn hệ thống bị vi phạm' };
  }
}

export async function getLicenseStatus(): Promise<{
  licensed: boolean;
  reason?: string;
  payload?: VerificationResult['payload'];
  supportCode: string;
  isLeased?: boolean;
  isGracePeriod?: boolean;
}> {
  const supportCode = generateSupportCode();

  const integrity = await checkIntegrity();
  if (!integrity.ok) {
    return { licensed: false, reason: integrity.reason || 'Toàn vẹn hệ thống bị vi phạm', supportCode };
  }

  const stored = loadLicense();
  if (!stored) {
    return { licensed: false, reason: 'Chưa có bản quyền trên thiết bị', supportCode };
  }

  // Dùng mô hình lai: kiểm tra cả leased_expires_at + ân hạn offline 3 ngày,
  // và bật lại clock-guard (trước đây verifyHybridLicense được gọi với
  // checkClock=false, tức bỏ qua chống lùi giờ). Lưu ý chu trình import
  // guard <-> hybrid-client: cả hai chỉ gọi nhau lúc runtime, sau khi
  // module đã nạp xong, nên an toàn (đã kiểm chứng bằng test).
  const result = await verifyHybridLicense({ checkClock: true });
  return {
    licensed: result.valid,
    reason: result.reason,
    payload: result.payload,
    supportCode,
    isLeased: result.isLeased,
    isGracePeriod: result.isGracePeriod,
  };
}

export async function isLicensed(): Promise<boolean> {
  const now = Date.now();
  if (licenseCheckCache !== null && now - lastCheckTime < CACHE_TTL) {
    return licenseCheckCache;
  }

  const status = await getLicenseStatus();
  licenseCheckCache = status.licensed;
  lastCheckTime = now;
  return status.licensed;
}

export async function activateLicense(key: string): Promise<{
  success: boolean;
  error?: string;
  payload?: VerificationResult['payload'];
}> {
  let stored: { payload: string; signature: string };

  const trimmed = key.trim();
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    if (parts.length !== 2) {
      return { success: false, error: 'Định dạng khóa không hợp lệ. Cần: payload.signature' };
    }
    stored = { payload: parts[0]!, signature: parts[1]! };
  } else {
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed.payload || !parsed.signature) {
        return { success: false, error: 'Dữ liệu JSON thiếu trường payload hoặc signature' };
      }
      stored = parsed;
    } catch {
      return { success: false, error: 'Khóa không đúng định dạng payload.signature hoặc JSON' };
    }
  }

  const result = await verifyLicenseWithDevice(stored);
  if (!result.valid) {
    return { success: false, error: result.reason || 'Kích hoạt không thành công' };
  }

  saveLicense(stored);
  clearLicenseCache();

  return { success: true, payload: result.payload };
}

export function printLicenseLockBanner(supportCode: string): void {
  const line = '═'.repeat(66);
  console.log(`\n\x1b[31m╔${line}╗`);
  console.log(`║                  🔒 BẢN QUYỀN CHƯA ĐƯỢC KÍCH HOẠT               ║`);
  console.log(`╠${line}╣`);
  console.log(`║  Thiết bị này chưa được cấp phép sử dụng Otter Agent.           ║`);
  console.log(`║                                                                  ║`);
  console.log(`║  👉 Mã thiết bị (Device Support Code):                           ║`);
  console.log(`║     \x1b[33m\x1b[1m${supportCode}\x1b[0m\x1b[31m                        ║`);
  console.log(`║                                                                  ║`);
  console.log(`║  Vui lòng gửi mã này cho tác giả/nhà phân phối để nhận License.  ║`);
  console.log(`║  Sau khi có License Key, bạn có thể:                            ║`);
  console.log(`║  1. Gọi API: \x1b[36mPOST http://127.0.0.1:1993/api/system/license/activate\x1b[0m\x1b[31m  ║`);
  console.log(`║  2. Hoặc chạy: \x1b[36motter license activate <key>\x1b[0m\x1b[31m                     ║`);
  console.log(`║  3. Hoặc mở giao diện Chrome Extension để kích hoạt.             ║`);
  console.log(`╚${line}╝\x1b[0m\n`);
}
