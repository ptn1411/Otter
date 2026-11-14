import * as crypto from 'node:crypto';
import { getPublicKey } from './constants';

export interface EncryptedEnvelope {
  __encrypted: true;
  iv: string; // Base64 12 bytes
  tag: string; // Base64 16 bytes
  data: string; // Base64 ciphertext
  ts: number; // Timestamp
}

const CIPHER_ALGO = 'aes-256-gcm';
const DEFAULT_SALT = 'otter-api-payload-gcm-v1';

let cachedDerivedKey: Buffer | null = null;

/**
 * Trích xuất khóa mã hóa AES-256 từ khóa công khai Ed25519 của ứng dụng
 */
export function getPayloadCipherKey(): Buffer {
  if (cachedDerivedKey) return cachedDerivedKey;

  const envKey = process.env.OTTER_PAYLOAD_KEY;
  if (envKey && envKey.length >= 32) {
    cachedDerivedKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedDerivedKey;
  }

  // Derive từ public key của ứng dụng + salt
  const pub = getPublicKey();
  cachedDerivedKey = crypto.createHash('sha256').update(pub).update(DEFAULT_SALT).digest();
  return cachedDerivedKey;
}

/**
 * Kiểm tra xem một đối tượng có phải là Encrypted Envelope hay không
 */
export function isEncryptedEnvelope(obj: any): obj is EncryptedEnvelope {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    obj.__encrypted === true &&
    typeof obj.iv === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.data === 'string'
  );
}

/**
 * Mã hóa dữ liệu bất kỳ sang dạng Envelope AES-256-GCM (Chống xem lén gói tin)
 */
export function encryptPayload(data: any, key: Buffer = getPayloadCipherKey()): EncryptedEnvelope {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data);
  const iv = crypto.randomBytes(12); // 96-bit IV chuẩn cho GCM

  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  return {
    __encrypted: true,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted,
    ts: Date.now(),
  };
}

/**
 * Giải mã Envelope AES-256-GCM về lại dữ liệu gốc
 */
export function decryptPayload<T = any>(
  envelope: EncryptedEnvelope,
  key: Buffer = getPayloadCipherKey()
): T {
  if (!isEncryptedEnvelope(envelope)) {
    throw new Error('Dữ liệu không phải là gói tin mã hóa hợp lệ (__encrypted missing)');
  }

  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(envelope.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  try {
    return JSON.parse(decrypted) as T;
  } catch {
    return decrypted as unknown as T;
  }
}

import { isTrustedHostOrIp } from '../security';

/**
 * Kiểm tra tính hợp lệ của URL kết nối: Bắt buộc HTTPS/WSS cho các server ngoài localhost/Tailscale
 */
export function validateSecureUrl(urlStr: string): {
  secure: boolean;
  reason?: string;
  url: string;
} {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isLocalOrTrusted = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || isTrustedHostOrIp(host);

    // Nếu là host ngoài mạng tin cậy (không phải localhost hay Tailscale/LAN), bắt buộc phải dùng giao thức bảo mật SSL/TLS
    if (!isLocalOrTrusted) {
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
        return {
          secure: false,
          reason: `Truy cập bị từ chối: Máy chủ ngoài '${host}' bắt buộc phải sử dụng kết nối bảo mật HTTPS/WSS với chứng chỉ SSL hợp lệ. Giao thức '${parsed.protocol}' không được phép.`,
          url: urlStr,
        };
      }
    }

    return { secure: true, url: urlStr };
  } catch (err: any) {
    return {
      secure: false,
      reason: `Định dạng URL không hợp lệ: ${err.message}`,
      url: urlStr,
    };
  }
}

/**
 * Danh sách tên CA proxy/bắt gói tin không được phép
 */
const FORBIDDEN_CA_SIGNATURES = [
  'mitmproxy',
  'fiddler',
  'charles',
  'portswigger',
  'burp',
  'wireshark',
];

/**
 * Kiểm tra chứng chỉ SSL/TLS nhằm phát hiện proxy can thiệp (SSL Interception)
 */
export function verifyTlsCertificateAuthority(issuerString?: string): {
  valid: boolean;
  reason?: string;
} {
  if (!issuerString) return { valid: true };

  const lower = issuerString.toLowerCase();
  for (const sig of FORBIDDEN_CA_SIGNATURES) {
    if (lower.includes(sig)) {
      return {
        valid: false,
        reason: `Phát hiện chứng chỉ SSL bị giả mạo / can thiệp bởi công cụ proxy (${sig}). Kết nối bị chặn để bảo vệ dữ liệu.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Tạo HTTP Response trả về dữ liệu đã mã hóa AES-256-GCM
 */
export function encryptedJsonResponse(
  data: any,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  const envelope = encryptPayload(data);
  return Response.json(envelope, {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Otter-Encrypted': '1',
    },
  });
}

export type SecureFetchOptions = RequestInit & {
  encrypt?: boolean;
};

/**
 * secureFetch: Gọi API qua SSL/TLS bắt buộc và tự động mã hóa/giải mã payload
 */
export async function secureFetch(
  url: string,
  options: SecureFetchOptions = {}
): Promise<Response & { jsonDecrypted<T = any>(): Promise<T> }> {
  const check = validateSecureUrl(url);
  if (!check.secure) {
    throw new Error(check.reason || `URL không an toàn: ${url}`);
  }

  const { encrypt, headers: rawHeaders, body: rawBody, ...rest } = options;
  const headers = new Headers(rawHeaders || {});

  let body = rawBody;
  if (encrypt && body !== undefined && body !== null) {
    let toEncrypt = body;
    if (typeof body === 'string') {
      try {
        toEncrypt = JSON.parse(body);
      } catch {
        toEncrypt = body;
      }
    }
    const envelope = encryptPayload(toEncrypt);
    body = JSON.stringify(envelope);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Otter-Encrypted', '1');
  }

  const res = await fetch(url, {
    ...rest,
    headers,
    body,
  });

  const originalJson = res.json.bind(res);
  const decryptingJson = async <T = any>(): Promise<T> => {
    const rawData = await originalJson();
    if (isEncryptedEnvelope(rawData)) {
      return decryptPayload<T>(rawData);
    }
    return rawData as T;
  };

  (res as any).json = decryptingJson;
  (res as any).jsonDecrypted = decryptingJson;

  return res as Response & { jsonDecrypted<T = any>(): Promise<T> };
}
