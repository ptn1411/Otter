/**
 * Xoay master key ký license (Ed25519).
 *
 * Làm gì:
 *  1. Sinh keypair Ed25519 mới.
 *  2. Ghi private key (hex 64 ký tự) vào file NGOÀI repo, quyền 0600
 *     (mặc định ~/.otter/master-private-key.txt). File này KHÔNG BAO GIỜ
 *     được commit, sync sang nam, hay dán vào chat/log.
 *  3. Cập nhật PUBLIC_KEY_CHUNKS trong src/daemon/license/constants.ts
 *     theo đúng scheme XOR cũ (public key thì công khai, ghi vào repo được).
 *
 * KHÔNG in private key ra stdout. Chỉ in public key + đường dẫn file.
 *
 * Hệ quả (đọc kỹ trước khi chạy): token cũ ký bằng key cũ sẽ KHÔNG
 * verify được nữa với client mới — đó chính là "thu hồi key cũ".
 * Khách hàng phải kích hoạt lại (cùng license_key + email) sau khi:
 *   (a) server bản quyền đã cài private key mới (env MASTER_PRIVATE_KEY
 *       hoặc MASTER_PRIVATE_KEY_FILE) và redeploy,
 *   (b) client đã cập nhật constants.ts mới.
 * Thứ tự đúng: server trước, client sau, rồi khách kích hoạt lại.
 * Nếu làm ngược (client trước, server chưa đổi), activation mới vẫn ký
 * bằng key cũ và client mới sẽ từ chối.
 *
 * Chạy: bun scripts/rotate-license-key.ts [--out <path>] [--force]
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const XOR_VALUES = [224, 107, 66, 118];

function parseArgs() {
  const args = process.argv.slice(2);
  let out = path.join(os.homedir(), ".otter", "master-private-key.txt");
  let force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) out = args[++i];
    else if (args[i] === "--force") force = true;
    else {
      console.error(`Tham số không rõ: ${args[i]}. Dùng: [--out <path>] [--force]`);
      process.exit(2);
    }
  }
  return { out, force };
}

function toChunks(publicHex: string): { chunk: string; xor: number }[] {
  const chunks: { chunk: string; xor: number }[] = [];
  for (let c = 0; c < 4; c++) {
    const part = publicHex.slice(c * 16, c * 16 + 16);
    const xor = XOR_VALUES[c]!;
    const obfuscated = part
      .match(/.{2}/g)!
      .map((byte) => (parseInt(byte, 16) ^ xor).toString(16).padStart(2, "0"))
      .join("");
    chunks.push({ chunk: obfuscated, xor });
  }
  return chunks;
}

const { out, force } = parseArgs();
if (fs.existsSync(out) && !force) {
  console.error(`File private key đã tồn tại: ${out}\nDùng --force để ghi đè (key cũ trong file sẽ mất).`);
  process.exit(1);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const jwk = privateKey.export({ format: "jwk" }) as any;
const publicJwk = publicKey.export({ format: "jwk" }) as any;
const privateHex = Buffer.from(jwk.d, "base64url").toString("hex");
const publicHex = Buffer.from(publicJwk.x, "base64url").toString("hex");
if (privateHex.length !== 64 || publicHex.length !== 64) {
  console.error("Keypair sinh ra không đúng 32 byte, dừng lại.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, privateHex + "\n", { mode: 0o600 });
try { fs.chmodSync(out, 0o600); } catch {}
const mode = (fs.statSync(out).mode & 0o777).toString(8);
if (mode !== "600") {
  console.warn(`Cảnh báo: quyền file private key là ${mode}, không phải 600 — hãy chmod 600 ${out} ngay.`);
}

const constantsPath = path.join(process.cwd(), "src", "daemon", "license", "constants.ts");
const constants = fs.readFileSync(constantsPath, "utf8");
const chunks = toChunks(publicHex);
const block = `export const PUBLIC_KEY_CHUNKS = [\n${chunks
  .map((c) => `  {\n    chunk: '${c.chunk}',\n    xor: ${c.xor},\n  },`)
  .join("\n")}\n];`;
const updated = constants.replace(/export const PUBLIC_KEY_CHUNKS = \[[\s\S]*?\];/, block);
if (updated === constants) {
  console.error("Không thay được PUBLIC_KEY_CHUNKS trong constants.ts, dừng lại (private key đã ghi, public key chưa đổi).");
  process.exit(1);
}
fs.writeFileSync(constantsPath, updated);

const fingerprint = crypto.createHash("sha256").update(publicHex, "hex").digest("hex").slice(0, 16);
console.log("Đã xoay master key ký license.");
console.log(`Public key (hex): ${publicHex}`);
console.log(`Public fingerprint (sha256, 16 ký tự đầu): ${fingerprint}`);
console.log(`Private key đã ghi vào: ${out} (quyền ${mode}) — KHÔNG commit, KHÔNG sync, KHÔNG dán vào chat.`);
console.log("Bước tiếp theo, theo đúng thứ tự:");
console.log("  1. Trên server bản quyền: đặt MASTER_PRIVATE_KEY_FILE=" + out + " (hoặc MASTER_PRIVATE_KEY=<nội dung file>) rồi redeploy server.");
console.log("  2. Deploy client mới (constants.ts đã đổi) lên máy khách.");
console.log("  3. Khách kích hoạt lại bằng license_key + email cũ — token mới sẽ ký bằng key mới.");
console.log("Token cũ ký bằng key cũ sẽ bị client mới từ chối ngay (đã thu hồi).");
