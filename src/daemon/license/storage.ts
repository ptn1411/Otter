import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import os from 'node:os';

export interface StoredLicense {
  payload: string;
  signature: string;
  leased_token?: string;
  server_url?: string;
  email?: string;
  last_heartbeat?: number;
}

export function getLocalProjectLicensePath(): string {
  return join(process.cwd(), 'data', 'license.json');
}

export function getSystemLicensePath(): string {
  const platform = os.platform();
  const homedir = os.homedir();
  switch (platform) {
    case 'darwin':
      return join(homedir, 'Library', 'Application Support', 'Otter', 'license.json');
    case 'win32': {
      const localAppdata = process.env.LOCALAPPDATA || join(homedir, 'AppData', 'Local');
      return join(localAppdata, 'Otter', 'license.json');
    }
    default: {
      const configHome = process.env.XDG_CONFIG_HOME || join(homedir, '.config');
      return join(configHome, 'otter', 'license.json');
    }
  }
}

export function getActiveLicensePath(): string {
  const local = getLocalProjectLicensePath();
  if (existsSync(local)) return local;
  const sys = getSystemLicensePath();
  if (existsSync(sys)) return sys;
  return local;
}

export function saveLicense(license: StoredLicense): void {
  // CHỈ lưu vào thư mục hệ thống (AppData / Application Support), quyền 0600.
  // Trước đây còn lưu thêm bản copy vào data/license.json trong project —
  // bản đó rất dễ bị commit nhầm lên git và làm lộ leased_token + email.
  // loadLicense vẫn đọc cả hai nơi để tương thích với license đã lưu trước
  // đây (lần save tiếp theo sẽ chỉ còn bản hệ thống).
  const sysPath = getSystemLicensePath();
  const sysDir = dirname(sysPath);
  try {
    if (!existsSync(sysDir)) {
      mkdirSync(sysDir, { recursive: true });
    }
    const content = JSON.stringify(license, null, 2);
    const tempPath = `${sysPath}.tmp`;
    writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    try { chmodSync(tempPath, 0o600); } catch {}
    renameSync(tempPath, sysPath);
    try { chmodSync(sysPath, 0o600); } catch {}
  } catch {}
}

export function loadLicense(): StoredLicense | null {
  // 1. Kiểm tra qua biến môi trường
  const envKey = process.env.OTTER_LICENSE_KEY || process.env.LICENSE_KEY;
  if (envKey) {
    if (envKey.includes('.')) {
      const parts = envKey.split('.');
      if (parts.length === 2 && parts[0] && parts[1]) {
        return { payload: parts[0], signature: parts[1] };
      }
    }
    try {
      const parsed = JSON.parse(envKey);
      if (parsed.payload && parsed.signature) return parsed;
    } catch {}
  }

  // 2. Kiểm tra thư mục hệ thống (AppData/Local/Otter)
  const sysPath = getSystemLicensePath();
  if (existsSync(sysPath)) {
    try {
      const content = readFileSync(sysPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.payload && parsed.signature) return parsed;
    } catch {}
  }

  // 3. Kiểm tra file cục bộ dự án (data/license.json)
  const localPath = getLocalProjectLicensePath();
  if (existsSync(localPath)) {
    try {
      const content = readFileSync(localPath, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed.payload && parsed.signature) return parsed;
    } catch {}
  }

  return null;
}

export function deleteLicense(): void {
  const localPath = getLocalProjectLicensePath();
  if (existsSync(localPath)) {
    try { unlinkSync(localPath); } catch {}
  }
  const sysPath = getSystemLicensePath();
  if (existsSync(sysPath)) {
    try { unlinkSync(sysPath); } catch {}
  }
}

export function hasLicense(): boolean {
  return loadLicense() !== null;
}
