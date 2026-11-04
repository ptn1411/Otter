import { getPublicKey, LICENSE_VERSION, PRODUCT_ID } from './constants';
import { base64ToBytes, verifySignature } from './crypto';
import { getDeviceHash } from './fingerprint';
import { verifyClockIntegrity } from './clock-guard';

export interface LicenseEntitlements {
  max_agents: number;
  allow_vps: boolean;
  allow_video: boolean;
  tier: 'trial' | 'pro' | 'enterprise';
  features: string[];
}

export interface LicensePayload {
  product_id: string;
  version: number;
  license_type: string;
  issued_at: string;
  expires_at?: string | null;
  device_hash: string;
  customer?: string;
  note?: string;
  tier?: 'trial' | 'pro' | 'enterprise';
  max_agents?: number;
  features?: string[];
  leased_expires_at?: string | null;
  [key: string]: unknown;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
  entitlements?: LicenseEntitlements;
  isLeased?: boolean;
  isGracePeriod?: boolean;
}

export function parseLicensePayload(payloadBase64: string): LicensePayload | null {
  try {
    const bytes = base64ToBytes(payloadBase64);
    const jsonStr = new TextDecoder().decode(bytes);
    const payload = JSON.parse(jsonStr) as LicensePayload;

    if (!payload.device_hash || !payload.product_id || !payload.issued_at || !payload.license_type) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function extractEntitlements(payload: LicensePayload): LicenseEntitlements {
  const type = (payload.license_type || 'trial').toLowerCase();
  const tier: 'trial' | 'pro' | 'enterprise' = 
    payload.tier || (type === 'perpetual' || type === 'pro' ? 'pro' : type === 'enterprise' ? 'enterprise' : 'trial');

  if (tier === 'enterprise') {
    return {
      max_agents: payload.max_agents ?? 20,
      allow_vps: true,
      allow_video: true,
      tier: 'enterprise',
      features: payload.features ?? ['all', 'vps_ssh', 'remotion_video', 'cloud_sync', 'multi_agent'],
    };
  }

  if (tier === 'pro') {
    return {
      max_agents: payload.max_agents ?? 5,
      allow_vps: true,
      allow_video: true,
      tier: 'pro',
      features: payload.features ?? ['vps_ssh', 'remotion_video', 'bookmarks_search'],
    };
  }

  // Trial / Starter tier
  return {
    max_agents: payload.max_agents ?? 1,
    allow_vps: true,
    allow_video: false,
    tier: 'trial',
    features: payload.features ?? ['basic_agent', 'bookmarks_search'],
  };
}

export async function verifyLicense(
  license: string | { payload: string; signature: string },
  options: { checkClock?: boolean; now?: number } = { checkClock: true }
): Promise<VerificationResult> {
  try {
    // 1. Kiểm tra Clock Rollback Defense (Chống lùi ngày giờ hệ thống)
    if (options.checkClock !== false) {
      const clockCheck = verifyClockIntegrity(options.now ?? Date.now());
      if (!clockCheck.valid) {
        return {
          valid: false,
          reason: clockCheck.reason || 'Lỗi thời gian hệ thống (Clock Rollback detected)',
        };
      }
    }

    let payloadBase64: string;
    let signatureBase64: string;

    if (typeof license === 'string') {
      const parts = license.trim().split('.');
      if (parts.length !== 2) {
        return { valid: false, reason: 'Định dạng khóa không hợp lệ (cần: payload.signature)' };
      }
      payloadBase64 = parts[0]!;
      signatureBase64 = parts[1]!;
    } else {
      payloadBase64 = license.payload;
      signatureBase64 = license.signature;
    }

    const payload = parseLicensePayload(payloadBase64);
    if (!payload) {
      return { valid: false, reason: 'Cấu trúc dữ liệu license không hợp lệ' };
    }

    if (payload.product_id !== PRODUCT_ID) {
      return { valid: false, reason: `Sai mã sản phẩm (cần: ${PRODUCT_ID}, nhận: ${payload.product_id})` };
    }

    if (payload.version !== LICENSE_VERSION) {
      return { valid: false, reason: 'Phiên bản license không được hỗ trợ' };
    }

    const currentTimestamp = options.now ?? Date.now();

    // 2. Kiểm tra ngày hết hạn gói tổng
    if (payload.expires_at) {
      const expiresAt = new Date(payload.expires_at).getTime();
      if (expiresAt < currentTimestamp) {
        return { valid: false, reason: 'Bản quyền đã hết hạn', payload };
      }
    }

    // 3. Kiểm tra chữ ký số Ed25519
    const payloadBytes = base64ToBytes(payloadBase64);
    const signatureBytes = base64ToBytes(signatureBase64);
    const publicKey = getPublicKey();

    const signatureValid = await verifySignature(payloadBytes, signatureBytes, publicKey);
    if (!signatureValid) {
      return { valid: false, reason: 'Chữ ký số Ed25519 không hợp lệ hoặc bị giả mạo' };
    }

    const entitlements = extractEntitlements(payload);
    return { valid: true, payload, entitlements };
  } catch (error: any) {
    return {
      valid: false,
      reason: `Lỗi xác thực: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function verifyLicenseWithDevice(
  license: string | { payload: string; signature: string },
  options: { checkClock?: boolean; now?: number } = { checkClock: true }
): Promise<VerificationResult> {
  const result = await verifyLicense(license, options);
  if (!result.valid || !result.payload) {
    return result;
  }

  // Wildcard device_hash ('*' / 'all') KHÔNG còn được chấp nhận.
  // Token wildcard trước đây chạy trên mọi máy; key cũ đã thu hồi nên
  // mọi token wildcard cũ đều chết theo, và server mới cũng không cấp
  // token wildcard nữa (xem activateDevice).
  if (result.payload.device_hash === '*' || result.payload.device_hash === 'all') {
    return {
      valid: false,
      reason: 'Token wildcard không còn được phép — vui lòng kích hoạt lại cho đúng máy',
      payload: result.payload,
    };
  }

  const currentDeviceHash = getDeviceHash();
  const licenseDeviceHash = result.payload.device_hash;

  const matches =
    currentDeviceHash.startsWith(licenseDeviceHash) ||
    licenseDeviceHash.startsWith(currentDeviceHash);

  if (!matches) {
    return {
      valid: false,
      reason: 'Bản quyền này được cấp cho thiết bị/máy chủ khác',
      payload: result.payload,
    };
  }

  return result;
}
