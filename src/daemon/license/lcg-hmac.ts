import { LcgCipher, generateDynamicKnockPath, matchDynamicKnockPath, type LcgRouteKey } from './lcg-router';

// ============================================================================
// 1. KHÓA BÍ MẬT HMAC ĐƯỢC ẨN BẰNG LCG + PER-STRING SALT
// Chuỗi gốc: "ottr_v2_hmac_master_key_9f8e7d6c5b4a3210!"
// ============================================================================
export const OBFUSCATED_HMAC_SECRET: readonly number[] = [
  184, 71, 153, 36, 141, 160, 254, 187, 66, 166, 5, 137, 119, 32, 236, 206,
  221, 250, 30, 30, 192, 218, 93, 39, 143, 51, 249, 28, 151, 185, 113, 182,
  237, 149, 70, 137, 113, 173, 65, 111, 138, 207, 31
];

// Độ lệch thời gian tối đa cho phép giữa Client và Server (mặc định: 2 phút)
export const MAX_CLOCK_SKEW_MS = 120_000;

export interface SignedEnvelope<T> {
  payload: T;          // Dữ liệu thực tế (VD: { valid: true, plan: "pro", expiresAt: ... })
  timestamp: number;   // Thời điểm tạo gói tin (ms)
  nonce: string;       // Nonce của Client được Server phản chiếu lại để chống Replay
  signature: string;   // Chữ ký HMAC-SHA256 dạng Hex
}

/**
 * Lớp bảo mật vận chuyển (Transport Security) kết hợp LCG & HMAC-SHA256
 */
export class LcgHmacGuard {
  /**
   * Khôi phục khóa CryptoKey ngay trong bộ nhớ và xóa mảng byte tạm sau khi nạp xong
   */
  private static async getCryptoKey(customSecret?: string): Promise<CryptoKey> {
    const rawSecret = customSecret || process.env.OTTER_HMAC_SECRET || LcgCipher.deobfuscate(OBFUSCATED_HMAC_SECRET);
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(rawSecret);

    try {
      return await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'HMAC', hash: 'SHA-256' },
        false, // extractable = false: Không cho phép xuất ngược key ra khỏi WebCrypto
        ['sign', 'verify']
      );
    } finally {
      // Ghi đè vùng nhớ buffer của keyBytes bằng số 0 ngay sau khi nạp vào CryptoKey
      keyBytes.fill(0);
    }
  }

  /**
   * Sinh chuỗi Nonce ngẫu nhiên 16-byte kết hợp giữa CSPRNG và LCG
   */
  static generateNonce(): string {
    const randomBytes = new Uint8Array(16);
    crypto.getRandomValues(randomBytes);
    const lcg = new LcgCipher((Date.now() ^ 0x4f545452) >>> 0);
    return Array.from(randomBytes)
      .map((b) => ((b ^ lcg.nextByte()) & 0xff).toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Chuẩn hóa dữ liệu cần ký (Canonical String) để tránh sai lệch thứ tự key JSON
   */
  private static buildCanonicalMessage(
    routePath: string,
    nonce: string,
    timestamp: number,
    payloadJson: string
  ): Uint8Array {
    // Ghép nối chặt chẽ: Path động + Nonce + Timestamp + Nội dung JSON
    const raw = `${routePath}|${nonce}|${timestamp}|${payloadJson}`;
    return new TextEncoder().encode(raw);
  }

  /**
   * Tạo chữ ký HMAC-SHA256 (sử dụng ở cả Client khi gửi và Server khi trả về)
   */
  static async signData(
    routePath: string,
    nonce: string,
    timestamp: number,
    payloadJson: string,
    customSecret?: string
  ): Promise<string> {
    const key = await this.getCryptoKey(customSecret);
    const message = this.buildCanonicalMessage(routePath, nonce, timestamp, payloadJson);
    const sigBuffer = await crypto.subtle.sign('HMAC', key, message);

    return Array.from(new Uint8Array(sigBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Xác thực chữ ký bằng thuật toán Constant-Time của WebCrypto (chống Timing Attack)
   */
  static async verifyData(
    routePath: string,
    nonce: string,
    timestamp: number,
    payloadJson: string,
    signatureHex: string,
    maxSkewMs: number = MAX_CLOCK_SKEW_MS,
    customSecret?: string
  ): Promise<boolean> {
    // 1. Kiểm tra tính hợp lệ của định dạng chữ ký Hex (SHA-256 = 64 ký tự hex)
    if (!/^[0-9a-f]{64}$/i.test(signatureHex)) return false;

    // 2. Kiểm tra cửa sổ thời gian (chống giữ gói tin lâu ngày)
    const now = Date.now();
    if (Math.abs(now - timestamp) > maxSkewMs) {
      return false;
    }

    // 3. Chuyển hex sang Uint8Array và xác thực bằng crypto.subtle.verify
    const sigBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      sigBytes[i] = parseInt(signatureHex.slice(i * 2, i * 2 + 2), 16);
    }

    const key = await this.getCryptoKey(customSecret);
    const message = this.buildCanonicalMessage(routePath, nonce, timestamp, payloadJson);

    return await crypto.subtle.verify('HMAC', key, sigBytes, message);
  }

  /**
   * Tạo gói tin SignedEnvelope hoàn chỉnh sẵn sàng gửi trả client
   */
  static async createSignedEnvelope<T>(
    routePath: string,
    nonce: string,
    payload: T,
    customSecret?: string
  ): Promise<SignedEnvelope<T>> {
    const timestamp = Date.now();
    const payloadJson = JSON.stringify(payload);
    const signature = await this.signData(routePath, nonce, timestamp, payloadJson, customSecret);

    return {
      payload,
      timestamp,
      nonce,
      signature,
    };
  }
}

/**
 * Luồng gọi API ở phía Client (Tự động ký và kiểm tra phản hồi)
 * Nếu có bất kỳ sự can thiệp nào từ Proxy hoặc phát lại request, hàm sẽ ném lỗi ngay lập tức.
 */
export async function secureLicenseRequest<TReq, TRes>(
  baseUrl: string,
  routeKey: LcgRouteKey,
  requestData: TReq,
  fetchFn: typeof fetch = fetch
): Promise<TRes> {
  // 1. Tạo đường dẫn nhảy động theo chu kỳ 5 phút bằng LCG
  const dynamicPath = generateDynamicKnockPath(routeKey);
  const clientNonce = LcgHmacGuard.generateNonce();
  const reqTimestamp = Date.now();
  const reqBodyJson = JSON.stringify(requestData);

  // 2. Ký lên Request để Server biết Request này từ App thật gửi lên
  const reqSignature = await LcgHmacGuard.signData(
    dynamicPath,
    clientNonce,
    reqTimestamp,
    reqBodyJson
  );

  const cleanBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const response = await fetchFn(`${cleanBase}${dynamicPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ottr-Nonce': clientNonce,
      'X-Ottr-Timestamp': String(reqTimestamp),
      'X-Ottr-Signature': reqSignature,
    },
    body: reqBodyJson,
  });

  if (!response.ok) {
    throw new Error(`HTTP Error: ${response.status}`);
  }

  // 3. Đọc gói tin phản hồi từ Server
  const envelope = (await response.json()) as SignedEnvelope<TRes>;

  // 4. CHỐT CHẶN CHỐNG PROXY #1: Kiểm tra Nonce trả về có khớp với Nonce vừa gửi đi không?
  // Ngăn chặn hoàn toàn việc kẻ tấn công dùng Charles Proxy phát lại (Replay) một response cũ
  if (!envelope || envelope.nonce !== clientNonce) {
    throw new Error('SECURITY_ALERT: Phát hiện tấn công Replay gói tin bản quyền!');
  }

  // 5. CHỐT CHẶN CHỐNG PROXY #2: Kiểm tra chữ ký HMAC-SHA256 trên Payload trả về
  const resPayloadJson = JSON.stringify(envelope.payload);
  const isAuthentic = await LcgHmacGuard.verifyData(
    dynamicPath,
    envelope.nonce,
    envelope.timestamp,
    resPayloadJson,
    envelope.signature
  );

  if (!isAuthentic) {
    throw new Error('SECURITY_ALERT: Dữ liệu bản quyền đã bị chỉnh sửa qua Proxy!');
  }

  // Nếu vượt qua toàn bộ kiểm tra, dữ liệu là nguyên vẹn 100%
  return envelope.payload;
}

/**
 * Handler chuẩn cho License Server (Express / Fastify / Bun / Cloudflare Workers)
 */
export async function handleActivateLicense(
  req: {
    pathname: string;
    headers: Record<string, string | undefined>;
    rawBody: string;
  },
  onActivate?: (parsedBody: any) => Promise<any> | any
): Promise<{ status: number; body: any }> {
  // 1. Kiểm tra đường dẫn Knock động bằng LCG
  if (!matchDynamicKnockPath(req.pathname, 'ACTIVATE')) {
    return { status: 404, body: 'Not Found' }; // Giả vờ không tồn tại endpoint
  }

  const clientNonce =
    req.headers['x-ottr-nonce'] ||
    req.headers['X-Ottr-Nonce'] ||
    '';
  const reqTime = Number(
    req.headers['x-ottr-timestamp'] ||
    req.headers['X-Ottr-Timestamp'] ||
    0
  );
  const reqSig =
    req.headers['x-ottr-signature'] ||
    req.headers['X-Ottr-Signature'] ||
    '';

  // 2. Xác thực chữ ký Request từ Client
  const isValidRequest = await LcgHmacGuard.verifyData(
    req.pathname,
    clientNonce,
    reqTime,
    req.rawBody,
    reqSig
  );

  if (!isValidRequest) {
    return { status: 403, body: 'Invalid signature' };
  }

  // 3. Xử lý nghiệp vụ kiểm tra License thực tế (gọi callback nếu có, hoặc dùng cấu hình mặc định)
  let responsePayload: any;
  if (onActivate) {
    try {
      const parsed = req.rawBody ? JSON.parse(req.rawBody) : {};
      responsePayload = await onActivate(parsed);
    } catch (err: any) {
      return { status: 400, body: { success: false, error: err.message } };
    }
  } else {
    responsePayload = {
      licenseValid: true,
      tier: 'enterprise',
      expiresAt: 1798761600000,
    };
  }

  // 4. Đóng gói và ký phản hồi, gắn chặt với `clientNonce` mà Client đã gửi lên
  const signedResponse = await LcgHmacGuard.createSignedEnvelope(
    req.pathname,
    clientNonce,
    responsePayload
  );

  return { status: 200, body: signedResponse };
}
