import { generateSupportCode } from './support-code';
import { getDeviceHash } from './fingerprint';
import { loadLicense, saveLicense, type StoredLicense } from './storage';
import { verifyLicenseWithDevice, parseLicensePayload, type VerificationResult } from './verify';
import { clearLicenseCache } from './guard';
import { secureFetch, validateSecureUrl } from './payload-cipher';
import { getLcgRoute, getLcgServerUrl } from './lcg-router';

export interface OnlineActivationParams {
  serverUrl: string;
  email: string;
  licenseKey: string;
  supportCode?: string;
  deviceHash?: string;
}

export interface ActivationResponse {
  success: boolean;
  error?: string;
  leasedToken?: string;
  expiresAt?: string;
  leasedExpiresAt?: string;
  packageType?: string;
  payload?: any;
}

export const DEFAULT_OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 ngày ân hạn (72 giờ)
export const DEFAULT_LICENSE_SERVER_URL = process.env.OTTER_LICENSE_SERVER || getLcgServerUrl('LICENSE_SERVER_URL');

/**
 * Kích hoạt bản quyền trực tuyến qua License Server
 */
export async function activateOnline(params: OnlineActivationParams): Promise<ActivationResponse> {
  const supportCode = params.supportCode || generateSupportCode();
  const deviceHash = params.deviceHash || getDeviceHash();
  const cleanServerUrl = (params.serverUrl || DEFAULT_LICENSE_SERVER_URL).replace(/\/+$/, '');

  try {
    const res = await secureFetch(`${cleanServerUrl}${getLcgRoute('ACTIVATE')}`, {
      method: 'POST',
      encrypt: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email.trim(),
        license_key: params.licenseKey.trim(),
        support_code: supportCode,
        device_hash: deviceHash,
      }),
    });

    const data = await res.json() as any;
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Kích hoạt thất bại (Mã lỗi HTTP ${res.status})`,
      };
    }

    const leasedToken = data.leased_token as string;
    if (!leasedToken || !leasedToken.includes('.')) {
      return { success: false, error: 'Định dạng leased token từ server không hợp lệ' };
    }

    const [payloadB64, sigB64] = leasedToken.split('.');
    const stored: StoredLicense = {
      payload: payloadB64!,
      signature: sigB64!,
      leased_token: leasedToken,
      server_url: cleanServerUrl,
      email: params.email.trim(),
      last_heartbeat: Date.now(),
    };

    // Kiểm tra tính hợp lệ trước khi lưu
    const verifyRes = await verifyLicenseWithDevice(stored);
    if (!verifyRes.valid) {
      return { success: false, error: verifyRes.reason || 'Token xác thực từ server không khớp với thiết bị' };
    }

    saveLicense(stored);
    clearLicenseCache();

    return {
      success: true,
      leasedToken,
      expiresAt: data.expires_at,
      leasedExpiresAt: data.leased_expires_at,
      packageType: data.package_type,
      payload: verifyRes.payload,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Không thể kết nối đến máy chủ xác thực: ${err.message || String(err)}`,
    };
  }
}

/**
 * Gửi heartbeat làm mới leased token ngầm khi có kết nối internet
 */
export async function sendHeartbeat(serverUrlOverride?: string): Promise<{
  success: boolean;
  renewed?: boolean;
  error?: string;
  leasedExpiresAt?: string;
}> {
  const stored = loadLicense();
  if (!stored || !stored.leased_token) {
    return { success: false, error: 'Chưa có leased license kích hoạt trực tuyến' };
  }

  const serverUrl = (serverUrlOverride || stored.server_url || '').replace(/\/+$/, '');
  if (!serverUrl) {
    return { success: false, error: 'Không tìm thấy địa chỉ server xác thực' };
  }

  const supportCode = generateSupportCode();

  try {
    const res = await secureFetch(`${serverUrl}${getLcgRoute('HEARTBEAT')}`, {
      method: 'POST',
      encrypt: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leased_token: stored.leased_token,
        support_code: supportCode,
      }),
    });

    const data = await res.json() as any;
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Heartbeat bị từ chối' };
    }

    const newLeasedToken = data.leased_token as string;
    if (newLeasedToken && newLeasedToken.includes('.')) {
      const [payloadB64, sigB64] = newLeasedToken.split('.');
      stored.payload = payloadB64!;
      stored.signature = sigB64!;
      stored.leased_token = newLeasedToken;
      stored.last_heartbeat = Date.now();
      saveLicense(stored);
      clearLicenseCache();
    }

    return {
      success: true,
      renewed: true,
      leasedExpiresAt: data.leased_expires_at,
    };
  } catch (err: any) {
    return { success: false, error: `Heartbeat offline: ${err.message}` };
  }
}

/**
 * Kiểm tra tính hợp lệ của license theo mô hình lai (Leased Token + Offline Grace Period)
 */
export async function verifyHybridLicense(
  options: { now?: number; gracePeriodMs?: number; checkClock?: boolean } = {}
): Promise<VerificationResult> {
  const stored = loadLicense();
  if (!stored) {
    return { valid: false, reason: 'Chưa kích hoạt bản quyền' };
  }

  const verifyRes = await verifyLicenseWithDevice(stored, {
    now: options.now,
    checkClock: options.checkClock ?? false,
  });
  if (!verifyRes.valid || !verifyRes.payload) {
    return verifyRes;
  }

  const payload = verifyRes.payload;
  const now = options.now ?? Date.now();
  const graceMs = options.gracePeriodMs ?? DEFAULT_OFFLINE_GRACE_MS;

  // Nếu đây là Leased Token từ server (có thời hạn thuê leased_expires_at)
  if (payload.leased_expires_at) {
    const leasedExpiry = new Date(payload.leased_expires_at).getTime();

    // Trường hợp 1: Còn hạn thuê trực tuyến bình thường
    if (now <= leasedExpiry) {
      return {
        ...verifyRes,
        isLeased: true,
        isGracePeriod: false,
      };
    }

    // Trường hợp 2: Quá hạn thuê nhưng còn trong thời gian ân hạn Offline (Offline Grace Period)
    if (now <= leasedExpiry + graceMs) {
      const remainingGraceHours = Math.ceil((leasedExpiry + graceMs - now) / (1000 * 60 * 60));
      return {
        ...verifyRes,
        valid: true,
        isLeased: true,
        isGracePeriod: true,
        reason: `Bản quyền đang trong thời gian ân hạn Offline (còn ${remainingGraceHours} giờ). Vui lòng kết nối mạng để tự động làm mới.`,
      };
    }

    // Trường hợp 3: Hết hạn cả thời gian ân hạn
    return {
      valid: false,
      reason: 'Hạn thuê bản quyền đã hết và vượt quá thời gian ân hạn Offline. Vui lòng kết nối mạng để tiếp tục sử dụng.',
      payload,
    };
  }

  // License vĩnh viễn hoặc offline thông thường
  return verifyRes;
}
