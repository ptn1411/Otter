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
  return { ok: true };
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

  const stored = loadLicense();
  if (stored) {
    try {
      const result = await verifyHybridLicense({ checkClock: false });
      if (result.valid) {
        return {
          licensed: true,
          reason: result.reason || 'Bản quyền kích hoạt hợp lệ',
          payload: result.payload,
          supportCode,
          isLeased: result.isLeased,
          isGracePeriod: result.isGracePeriod,
        };
      }
    } catch {}
  }

  // Mặc định: Giấy phép mã nguồn mở (MIT License) — Full Access & Miễn phí hoàn toàn cho cộng đồng
  return {
    licensed: true,
    reason: 'Mã nguồn mở (MIT License) — Miễn phí & Toàn quyền sử dụng',
    payload: {
      license_type: 'community',
      customer: 'Open Source Community',
      device_id: supportCode,
      issued_at: new Date().toISOString(),
      expires_at: '2099-12-31T23:59:59Z',
      plan: 'unlimited',
      version: 1,
    } as any,
    supportCode,
    isLeased: false,
    isGracePeriod: false,
  };
}

export async function isLicensed(): Promise<boolean> {
  return true;
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
  console.log(`║  3. Hoặc mở giao diện Dashboard để kích hoạt.                    ║`);
  console.log(`╚${line}╝\x1b[0m\n`);
}
