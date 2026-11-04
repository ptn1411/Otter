import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { PRODUCT_ID, LICENSE_VERSION } from './constants';
import { bytesToBase64, canonicalJSON, signPayload } from './crypto';
import { getDeviceHash } from './fingerprint';
import { generateSupportCode } from './support-code';
import { saveLicense } from './storage';
import { activateLicense, getLicenseStatus } from './guard';

// Master Private Key — KHÔNG còn fallback ghi cứng trong source.
// Keygen nội bộ chỉ chạy khi có MASTER_PRIVATE_KEY (hex 64 ký tự) hoặc
// MASTER_PRIVATE_KEY_FILE. Không có key -> throw (fail closed).
// Key cũ đã bị thu hồi (xem scripts/rotate-license-key.ts).
function getMasterPrivateKey(): string {
  let hex = (process.env.MASTER_PRIVATE_KEY || "").trim();
  const defaultKeyPath = path.join(os.homedir(), ".otter", "master-private-key.txt");
  const keyFile = process.env.MASTER_PRIVATE_KEY_FILE || (fs.existsSync(defaultKeyPath) ? defaultKeyPath : "");
  if (!hex && keyFile) {
    try {
      hex = fs.readFileSync(keyFile, "utf8").trim();
    } catch (err: any) {
      throw new Error(`Không đọc được MASTER_PRIVATE_KEY_FILE: ${err.message}`);
    }
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "MASTER_PRIVATE_KEY chưa cấu hình hoặc sai định dạng (cần hex 64 ký tự). " +
      "Chạy bun scripts/rotate-license-key.ts để sinh key mới."
    );
  }
  return hex;
}

export interface GenerateLicenseOptions {
  deviceHash?: string;
  supportCode?: string;
  licenseType?: 'perpetual' | 'subscription' | 'trial';
  durationDays?: number;
  customer?: string;
  note?: string;
}

/**
 * Giải mã Base32 24 ký tự support code về lại 15 bytes đầu của device hash
 */
function decodeBase32ToHexPrefix(code: string): string {
  const cleaned = code.replace(/[^A-Za-z2-7]/g, '').toUpperCase();
  if (cleaned.length !== 24) {
    throw new Error('Support code phải có đúng 24 ký tự chữ cái/số (Base32).');
  }
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bitString = '';
  for (const char of cleaned) {
    const val = ALPHABET.indexOf(char);
    if (val === -1) throw new Error(`Ký tự Base32 không hợp lệ: ${char}`);
    bitString += val.toString(2).padStart(5, '0');
  }

  // 24 * 5 = 120 bits = 15 bytes
  let hex = '';
  for (let i = 0; i < 15 * 8; i += 8) {
    const byte = parseInt(bitString.slice(i, i + 8), 2);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function generateLicenseKey(options: GenerateLicenseOptions): {
  key: string;
  payload: Record<string, unknown>;
  signature: string;
} {
  let targetDeviceHash = options.deviceHash;
  if (!targetDeviceHash && options.supportCode) {
    targetDeviceHash = decodeBase32ToHexPrefix(options.supportCode);
  }
  if (!targetDeviceHash) {
    targetDeviceHash = getDeviceHash();
  }

  const now = new Date();
  const issuedAt = now.toISOString();
  let expiresAt: string | null = null;

  if (options.durationDays !== undefined && options.durationDays !== null) {
    const exp = new Date(now.getTime() + options.durationDays * 24 * 60 * 60 * 1000);
    expiresAt = exp.toISOString();
  }

  const payloadObj = {
    product_id: PRODUCT_ID,
    version: LICENSE_VERSION,
    license_type: options.licenseType || (expiresAt ? 'subscription' : 'perpetual'),
    device_hash: targetDeviceHash,
    issued_at: issuedAt,
    expires_at: expiresAt,
    customer: options.customer || undefined,
    note: options.note || undefined,
  };

  const payloadCanonical = canonicalJSON(payloadObj);
  const payloadBytes = new TextEncoder().encode(payloadCanonical);
  const payloadBase64 = bytesToBase64(payloadBytes);

  const privateKeyBytes = Buffer.from(getMasterPrivateKey(), 'hex');
  const signatureBytes = signPayload(payloadBytes, privateKeyBytes);
  const signatureBase64 = bytesToBase64(signatureBytes);

  const key = `${payloadBase64}.${signatureBase64}`;

  return {
    key,
    payload: payloadObj,
    signature: signatureBase64,
  };
}

// Thực thi qua dòng lệnh CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  let code: string | undefined;
  let type: 'perpetual' | 'subscription' | 'trial' = 'perpetual';
  let days: number | undefined;
  let customer: string | undefined;
  let note: string | undefined;
  let isSelf = false;
  let activateKey: string | undefined;
  let checkStatus = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--code' || a === '-c') code = args[++i];
    else if (a === '--type' || a === '-t') type = args[++i] as any;
    else if (a === '--days' || a === '-d') days = Number(args[++i]);
    else if (a === '--customer') customer = args[++i];
    else if (a === '--note') note = args[++i];
    else if (a === '--self' || a === '-s') isSelf = true;
    else if (a === '--activate' || a === '-a') activateKey = args[++i];
    else if (a === '--status') checkStatus = true;
  }

  console.log('\n🔑 OTTER AGENT — LICENSE GENERATOR (ED25519)\n');

  if (checkStatus) {
    const status = await getLicenseStatus();
    console.log(`- Mã thiết bị (Support Code): \x1b[33m${status.supportCode}\x1b[0m`);
    console.log(`- Trạng thái bản quyền: ${status.licensed ? '\x1b[32mĐÃ KÍCH HOẠT\x1b[0m' : '\x1b[31mCHƯA KÍCH HOẠT\x1b[0m'}`);
    if (status.reason) console.log(`- Lý do: ${status.reason}`);
    if (status.payload) {
      console.log(`- Loại: ${status.payload.license_type}`);
      console.log(`- Hạn dùng: ${status.payload.expires_at || 'Vĩnh viễn'}`);
      if (status.payload.customer) console.log(`- Khách hàng: ${status.payload.customer}`);
    }
    console.log('');
    process.exit(0);
  }

  if (activateKey) {
    console.log(`[*] Đang kích hoạt license key...`);
    const act = await activateLicense(activateKey);
    if (act.success) {
      console.log('\x1b[32m[✓] KÍCH HOẠT BẢN QUYỀN THÀNH CÔNG!\x1b[0m');
      console.log(`- Khách hàng: ${act.payload?.customer || 'N/A'}`);
      console.log(`- Loại: ${act.payload?.license_type}`);
      console.log(`- Hạn: ${act.payload?.expires_at || 'Vĩnh viễn'}\n`);
    } else {
      console.log(`\x1b[31m[!] Kích hoạt thất bại: ${act.error}\x1b[0m\n`);
    }
    process.exit(act.success ? 0 : 1);
  }

  if (isSelf) {
    console.log('📌 Đang tạo bản quyền VĨNH VIỄN cho thiết bị hiện tại...');
    const result = generateLicenseKey({
      deviceHash: getDeviceHash(),
      licenseType: 'perpetual',
      customer: customer || 'Local Owner / Developer',
      note: 'Auto generated for self',
    });
    saveLicense({
      payload: result.key.split('.')[0]!,
      signature: result.key.split('.')[1]!,
    });
    console.log('\x1b[32m✅ Đã kích hoạt bản quyền vĩnh viễn thành công cho máy tính này!\x1b[0m');
    console.log(`Support Code: \x1b[33m${generateSupportCode()}\x1b[0m`);
    console.log(`License Key:\n\x1b[36m${result.key}\x1b[0m\n`);
    process.exit(0);
  }

  if (!code) {
    console.log('Cách sử dụng:');
    console.log('  1. Tự kích hoạt cho máy hiện tại:');
    console.log('     bun run license:self');
    console.log('  2. Xem mã thiết bị và trạng thái bản quyền:');
    console.log('     bun run license:status');
    console.log('  3. Tạo key cho khách theo mã thiết bị (Support Code):');
    console.log('     bun run license:keygen --code <MÃ_SUPPORT_CODE> [--type perpetual|subscription|trial] [--days 30] [--customer "Tên khách"]');
    console.log('  4. Kích hoạt bằng key:');
    console.log('     bun run license:activate <LICENSE_KEY>\n');
    console.log(`Mã thiết bị hiện tại của bạn: \x1b[33m${generateSupportCode()}\x1b[0m\n`);
    process.exit(0);
  }

  const result = generateLicenseKey({
    supportCode: code,
    licenseType: type,
    durationDays: days,
    customer,
    note,
  });

  console.log('✅ Đã tạo License Key thành công:');
  console.log(`- Mã thiết bị: ${code}`);
  console.log(`- Loại bản quyền: ${result.payload.license_type}`);
  console.log(`- Hạn sử dụng: ${result.payload.expires_at || 'Vĩnh viễn (Perpetual)'}`);
  if (customer) console.log(`- Khách hàng: ${customer}`);
  console.log('\n👉 LICENSE KEY (Gửi chuỗi dưới đây cho khách hàng):');
  console.log('\x1b[36m' + result.key + '\x1b[0m\n');
}
