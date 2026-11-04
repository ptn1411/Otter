export const PRODUCT_ID = 'otter';
export const LICENSE_VERSION = 1;

export enum LicenseType {
  PERPETUAL = 'perpetual',
  SUBSCRIPTION = 'subscription',
  TRIAL = 'trial',
}

// Obfuscated Ed25519 Public Key Chunks
export const PUBLIC_KEY_CHUNKS = [
  {
    chunk: '323a8aec6bbd0853',
    xor: 224,
  },
  {
    chunk: 'df3ae92ab209ade5',
    xor: 107,
  },
  {
    chunk: '34d6929f5253de5e',
    xor: 66,
  },
  {
    chunk: '85002b438774c14e',
    xor: 118,
  },
];

export function getPublicKey(): Uint8Array {
  const hexParts: string[] = [];
  for (const { chunk, xor } of PUBLIC_KEY_CHUNKS) {
    const deobfuscated = chunk
      .match(/.{2}/g)!
      .map((byte) => {
        const val = parseInt(byte, 16);
        return (val ^ xor).toString(16).padStart(2, '0');
      })
      .join('');
    hexParts.push(deobfuscated);
  }
  const fullHex = hexParts.join('');
  const bytes = new Uint8Array(fullHex.length / 2);
  for (let i = 0; i < fullHex.length; i += 2) {
    bytes[i / 2] = parseInt(fullHex.slice(i, i + 2), 16);
  }
  return bytes;
}
