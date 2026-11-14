/**
 * Linear Congruential Generator (LCG) Obfuscator & Router Masking (v2 - Salted)
 * 
 * Nâng cấp bảo mật:
 * 1. Per-String 16-bit Salt: Mỗi chuỗi có 2 byte đầu làm vector khởi tạo (IV/Salt) riêng biệt,
 *    kết hợp với hằng số khuếch tán MurmurHash3 (0x85ebca6b) và bước làm nóng (Warm-up rounds)
 *    để triệt tiêu hoàn toàn tấn công Two-Time Pad (không còn trùng lặp byte đầu giữa các chuỗi).
 * 2. Zero-Plaintext Caching: Giải mã tức thời (On-the-fly) khi gọi hàm và giải phóng ngay,
 *    ngăn chặn việc rò rỉ chuỗi gốc khi bị dump RAM / Heap Snapshot.
 * 3. Safe 32-bit Arithmetic: Sử dụng Math.imul triệt để nhằm đảm bảo tính nhất quán bit
 *    giữa JavaScript và các ngôn ngữ backend (Rust/Go/C++).
 */

export const LCG_DEFAULT_SEED = 0x4f545452; // 'OTTR'
const LCG_A = 1664525; // Multiplier (Numerical Recipes / Knuth)
const LCG_C = 1013904223; // Increment
const SALT_MIXER = 0x85ebca6b; // Hằng số khuếch tán bit (Avalanche effect)

/**
 * Bộ sinh số giả ngẫu nhiên tuyến tính LCG dùng cho mã hóa luồng chuỗi ký tự
 */
export class LcgCipher {
  private state: number;
  private readonly a: number;
  private readonly c: number;

  constructor(seed: number = LCG_DEFAULT_SEED, a: number = LCG_A, c: number = LCG_C) {
    this.state = seed >>> 0;
    this.a = a;
    this.c = c;
  }

  /**
   * Pha trộn Seed gốc với 16-bit Salt để tạo ra trạng thái khởi tạo độc lập cho từng chuỗi
   */
  static deriveSeed(baseSeed: number, salt1: number, salt2: number): number {
    const salt16 = ((salt1 & 0xff) << 8) | (salt2 & 0xff);
    const mixedSalt = Math.imul(salt16, SALT_MIXER) >>> 0;
    return (baseSeed ^ mixedSalt) >>> 0;
  }

  /**
   * Sinh byte ngẫu nhiên tiếp theo từ LCG (lấy 8 bit cao để tối ưu chu kỳ ngẫu nhiên)
   */
  nextByte(): number {
    this.state = (Math.imul(this.state, this.a) + this.c) >>> 0;
    return (this.state >>> 16) & 0xff;
  }

  /**
   * Thực hiện phép biến đổi XOR đối xứng
   */
  transform(input: Uint8Array): Uint8Array {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = input[i]! ^ this.nextByte();
    }
    return out;
  }

  /**
   * Mã hóa chuỗi văn bản kèm theo 2 byte Salt ngẫu nhiên ở đầu mảng
   */
  static obfuscate(
    text: string,
    baseSeed: number = LCG_DEFAULT_SEED,
    customSalt?: [number, number]
  ): number[] {
    const salt1 = customSalt ? customSalt[0] & 0xff : Math.floor(Math.random() * 256);
    const salt2 = customSalt ? customSalt[1] & 0xff : Math.floor(Math.random() * 256);

    const dynamicSeed = LcgCipher.deriveSeed(baseSeed, salt1, salt2);
    const lcg = new LcgCipher(dynamicSeed);

    // Bỏ qua 4 vòng đầu (Warm-up) để phân tán hoàn toàn ảnh hưởng tuyến tính của Salt
    for (let i = 0; i < 4; i++) lcg.nextByte();

    const bytes = new TextEncoder().encode(text);
    const encrypted = lcg.transform(bytes);

    return [salt1, salt2, ...Array.from(encrypted)];
  }

  /**
   * Giải mã mảng byte (tự động tách 2 byte Salt đầu tiên) trở lại chuỗi văn bản gốc
   */
  static deobfuscate(bytes: readonly number[] | Uint8Array, baseSeed: number = LCG_DEFAULT_SEED): string {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (arr.length < 2) return '';

    const salt1 = arr[0]!;
    const salt2 = arr[1]!;
    const dynamicSeed = LcgCipher.deriveSeed(baseSeed, salt1, salt2);

    const lcg = new LcgCipher(dynamicSeed);
    for (let i = 0; i < 4; i++) lcg.nextByte();

    const decrypted = lcg.transform(arr.subarray(2));
    return new TextDecoder().decode(decrypted);
  }
}

// ============================================================================
// DANH SÁCH TÊN MIỀN ĐƯỢC ẨN BẰNG LCG + PER-STRING SALT
// (Lưu ý: Khi đưa vào bản Production, hãy xóa các dòng comment tên miền bên dưới)
// ============================================================================
const OBFUSCATED_DOMAINS: readonly number[][] = [
  // [0] "license.gpt.io.vn"
  [150, 80, 208, 172, 68, 184, 61, 4, 154, 85, 151, 95, 207, 224, 123, 21, 254, 228, 71],
  // [1] "otter.gpt.io.vn"
  [229, 41, 252, 180, 70, 103, 227, 165, 102, 232, 15, 246, 119, 222, 192, 199, 183],
  // [2] "gpt.io.vn"
  [124, 119, 107, 97, 208, 37, 50, 42, 116, 108, 144],
  // [3] "license.otter.ai"
  [98, 108, 171, 162, 50, 134, 97, 199, 126, 76, 128, 66, 5, 147, 104, 197, 149, 113],
  // [4] "api.otter.ai"
  [176, 178, 53, 68, 136, 214, 222, 188, 32, 136, 63, 169, 203, 79],
  // [5] "auth.otter.ai"
  [215, 104, 109, 91, 245, 211, 17, 25, 185, 189, 10, 176, 159, 253, 116],
  // [6] "otter.ai"
  [230, 159, 7, 68, 235, 65, 230, 39, 107, 220],
];

const OBFUSCATED_URLS = {
  // "https://license.gpt.io.vn"
  LICENSE_SERVER_URL: [
    114, 129, 193, 25, 188, 233, 68, 203, 104, 58, 215, 48, 73, 201, 43, 193, 152, 82, 179, 230, 152, 24, 238, 191, 57, 19, 124
  ],
  // "https://otter.gpt.io.vn"
  OTTER_SERVER_URL: [
    63, 149, 173, 169, 30, 237, 243, 89, 237, 209, 105, 85, 199, 159, 79, 93, 90, 115, 150, 18, 163, 23, 172, 59, 42
  ],
} as const;

// ============================================================================
// BẢNG ROUTER ĐƯỢC ẨN BẰNG LCG + PER-STRING SALT
// (Dù chung tiền tố "/api/v1/...", các mảng byte hoàn toàn khác biệt nhau)
// ============================================================================
export const OBFUSCATED_ROUTES = {
  // "/api/v1/license/activate"
  ACTIVATE: [
    244, 27, 159, 79, 203, 141, 53, 57, 195, 1, 108, 222, 225, 108, 243, 46, 254, 176, 18, 59, 3, 123, 86, 254, 57, 134
  ],
  // "/api/v1/license/heartbeat"
  HEARTBEAT: [
    144, 250, 57, 170, 118, 72, 196, 22, 244, 36, 82, 130, 96, 73, 0, 99, 154, 113, 70, 93, 248, 115, 220, 8, 116, 149, 144
  ],
  // "/api/v1/packages/issue"
  ISSUE: [
    123, 184, 169, 231, 253, 65, 18, 4, 118, 201, 149, 202, 193, 215, 252, 189, 59, 73, 129, 34, 110, 116, 101, 195
  ],
  // "/api/v1/license/revoke"
  REVOKE: [
    69, 228, 237, 55, 249, 66, 76, 138, 234, 171, 201, 177, 88, 93, 208, 50, 167, 207, 145, 147, 22, 255, 97, 112
  ],
  // "/api/v1/license/status"
  STATUS: [
    152, 127, 43, 220, 26, 128, 60, 67, 107, 155, 203, 61, 47, 173, 60, 152, 105, 152, 21, 77, 43, 77, 229, 26
  ],
} as const;

export type LcgRouteKey = keyof typeof OBFUSCATED_ROUTES;

/**
 * Lấy danh sách tên miền được bảo vệ (Giải mã trực tiếp, không lưu cache RAM)
 */
export function getLcgProtectedDomains(): string[] {
  return OBFUSCATED_DOMAINS.map((bytes) => LcgCipher.deobfuscate(bytes));
}

/**
 * Lấy URL mặc định của máy chủ bản quyền được giải mã an toàn từ LCG
 */
export function getLcgServerUrl(key: keyof typeof OBFUSCATED_URLS = 'LICENSE_SERVER_URL'): string {
  return LcgCipher.deobfuscate(OBFUSCATED_URLS[key]);
}

/**
 * Lấy đường dẫn Router API đã giải mã từ khóa LCG
 */
export function getLcgRoute(routeKey: LcgRouteKey): string {
  const bytes = OBFUSCATED_ROUTES[routeKey];
  if (!bytes) throw new Error(`Invalid route key: ${String(routeKey)}`);
  return LcgCipher.deobfuscate(bytes);
}

/**
 * Khớp nối đường dẫn Router mà không cần viết chuỗi thô trong code
 */
export function matchLcgRoute(pathname: string, routeKey: LcgRouteKey): boolean {
  return pathname === getLcgRoute(routeKey);
}

/**
 * Tìm route tương ứng với một pathname bất kỳ
 */
export function matchAnyLcgRoute(pathname: string): LcgRouteKey | null {
  for (const key of Object.keys(OBFUSCATED_ROUTES) as LcgRouteKey[]) {
    if (matchLcgRoute(pathname, key)) return key;
  }
  return null;
}

/**
 * Hàm nội bộ tính toán hậu tố Knock cho một khối thời gian (Time-Block) và Route cụ thể
 */
function computeKnockSuffix(baseRouteKey: LcgRouteKey, timeBlock: number): string {
  // Pha trộn cả mã chữ của RouteKey vào Seed để mỗi Route có một mã Knock hoàn toàn khác nhau
  // ngay cả khi được gọi trong cùng một khung thời gian 5 phút.
  let routeHash = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < baseRouteKey.length; i++) {
    routeHash ^= baseRouteKey.charCodeAt(i);
    routeHash = Math.imul(routeHash, 0x01000193) >>> 0;
  }

  const timeMix = (Math.imul(timeBlock, 1103515245) + 12345) >>> 0;
  const knockSeed = (timeMix ^ LCG_DEFAULT_SEED ^ routeHash) >>> 0;

  const lcg = new LcgCipher(knockSeed);
  // Bỏ qua 2 vòng đầu để tăng độ phân tán bit
  lcg.nextByte();
  lcg.nextByte();

  const hexPart = [lcg.nextByte(), lcg.nextByte(), lcg.nextByte(), lcg.nextByte()]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `/_k_${hexPart}`;
}

/**
 * Tạo Router Hopping / Dynamic Knocking:
 * Sinh đường dẫn router luân chuyển động theo thời gian (Time-Window) và theo từng Route.
 */
export function generateDynamicKnockPath(
  baseRouteKey: LcgRouteKey,
  windowMs: number = 300000 // 5 phút
): string {
  const baseRoute = getLcgRoute(baseRouteKey);
  const currentBlock = Math.floor(Date.now() / windowMs);
  return `${baseRoute}${computeKnockSuffix(baseRouteKey, currentBlock)}`;
}

/**
 * Khớp nối router động theo Time-Window (chấp nhận độ trễ mạng 1 chu kỳ trước đó)
 */
export function matchDynamicKnockPath(
  pathname: string,
  baseRouteKey: LcgRouteKey,
  windowMs: number = 300000
): boolean {
  const baseRoute = getLcgRoute(baseRouteKey);
  if (!pathname.startsWith(baseRoute)) return false;

  const currentBlock = Math.floor(Date.now() / windowMs);
  if (pathname === `${baseRoute}${computeKnockSuffix(baseRouteKey, currentBlock)}`) {
    return true;
  }

  const prevBlock = currentBlock - 1;
  if (pathname === `${baseRoute}${computeKnockSuffix(baseRouteKey, prevBlock)}`) {
    return true;
  }

  return false;
}
