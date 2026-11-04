import { getDeviceHash } from './fingerprint';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Uint8Array): string {
  let bits = '';
  let result = '';
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    const index = parseInt(chunk, 2);
    result += BASE32_ALPHABET[index];
  }
  return result;
}

export function decodeBase32ToHexPrefix(code: string): string {
  const cleaned = code.replace(/[^A-Za-z2-7]/g, '').toUpperCase();
  if (cleaned.length !== 24) {
    throw new Error('Support code phải có đúng 24 ký tự chữ cái/số (Base32).');
  }
  let bitString = '';
  for (const char of cleaned) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) throw new Error(`Ký tự Base32 không hợp lệ: ${char}`);
    bitString += val.toString(2).padStart(5, '0');
  }

  // 24 * 5 = 120 bits = 15 bytes = 30 hex characters
  let hex = '';
  for (let i = 0; i < 15 * 8; i += 8) {
    const byte = parseInt(bitString.slice(i, i + 8), 2);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function generateSupportCodeFromHash(hash: string): string {
  const bytes = new Uint8Array(15);
  for (let i = 0; i < 15; i++) {
    bytes[i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  }
  const encoded = encodeBase32(bytes);
  const code = encoded.slice(0, 24);
  return code.match(/.{1,4}/g)!.join('-');
}

export function generateSupportCode(): string {
  const deviceHash = getDeviceHash();
  return generateSupportCodeFromHash(deviceHash);
}
