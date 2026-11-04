import crypto from 'node:crypto';

// Standard Ed25519 SPKI DER prefix (12 bytes)
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
// Standard Ed25519 PKCS8 DER prefix (16 bytes)
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export async function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const spkiDer = Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]);
    const keyObject = crypto.createPublicKey({
      key: spkiDer,
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(message), keyObject, Buffer.from(signature));
  } catch {
    return false;
  }
}

export function signPayload(
  message: Uint8Array,
  privateKey: Uint8Array,
): Uint8Array {
  const pkcs8Der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(privateKey)]);
  const keyObject = crypto.createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8',
  });
  const sig = crypto.sign(null, Buffer.from(message), keyObject);
  return new Uint8Array(sig);
}

export function sha256Hash(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function canonicalJSON(obj: any): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((sorted: any, key) => {
          sorted[key] = value[key];
          return sorted;
        }, {});
    }
    return value;
  });
}
