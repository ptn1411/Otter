import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getLcgProtectedDomains } from './lcg-router';

export interface HostsCheckResult {
  valid: boolean;
  reason?: string;
  tamperedDomain?: string;
  mappedIp?: string;
  hostsPath?: string;
}

/**
 * Danh sách tên miền máy chủ bản quyền cần bảo vệ khỏi can thiệp DNS / hosts
 * (Được ẩn và giải mã qua thuật toán LCG - không để lộ chuỗi thô trong mã nguồn)
 */
export const DEFAULT_PROTECTED_DOMAINS: string[] = getLcgProtectedDomains();

/**
 * Lấy danh sách tên miền cần bảo vệ, bao gồm cả biến môi trường nếu có
 */
export function getProtectedDomains(): string[] {
  const domains = new Set<string>(getLcgProtectedDomains());
  const envDomain = process.env.OTTER_LICENSE_DOMAIN || process.env.LICENSE_SERVER_DOMAIN;
  if (envDomain) {
    domains.add(envDomain.trim().toLowerCase());
  }
  const customServer = process.env.OTTER_LICENSE_SERVER;
  if (customServer) {
    try {
      const parsed = new URL(customServer);
      if (parsed.hostname && !parsed.hostname.includes('127.0.0.1') && parsed.hostname !== 'localhost') {
        domains.add(parsed.hostname.toLowerCase());
      }
    } catch { }
  }
  return Array.from(domains);
}

/**
 * Lấy đường dẫn tệp hosts chuẩn theo từng hệ điều hành (Windows, macOS, Linux)
 */
export function getSystemHostsPath(): string {
  const platform = os.platform();
  if (platform === 'win32') {
    const sysRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return path.join(sysRoot, 'System32', 'drivers', 'etc', 'hosts');
  }
  // macOS và Linux đều lưu tại /etc/hosts
  return '/etc/hosts';
}

/**
 * Kiểm tra xem một IP có phải là IP chuyển hướng cục bộ hoặc sinkhole hay không
 */
function isLocalOrSinkholeIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();
  if (
    trimmed === '127.0.0.1' ||
    trimmed === '0.0.0.0' ||
    trimmed === '::1' ||
    trimmed === 'localhost' ||
    trimmed.startsWith('127.')
  ) {
    return true;
  }
  return false;
}

/**
 * Phân tích nội dung tệp hosts và phát hiện can thiệp chuyển hướng tên miền server về local
 */
export function checkHostsFileContent(
  content: string,
  protectedDomains: string[] = getProtectedDomains()
): HostsCheckResult {
  const lines = content.split(/\r?\n/);
  const normalizedTargets = protectedDomains.map((d) => d.toLowerCase());

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let line = lines[lineIndex]!;
    // Loại bỏ phần comment bắt đầu bằng '#'
    const hashIndex = line.indexOf('#');
    if (hashIndex !== -1) {
      line = line.substring(0, hashIndex);
    }
    line = line.trim();
    if (!line) continue;

    // Phân tách các trường theo khoảng trắng (IP hostname1 hostname2 ...)
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const mappedIp = parts[0]!;
    const hostnames = parts.slice(1);

    if (isLocalOrSinkholeIp(mappedIp)) {
      for (const host of hostnames) {
        const cleanHost = host.toLowerCase().trim();
        for (const targetDomain of normalizedTargets) {
          if (cleanHost === targetDomain || cleanHost.endsWith(`.${targetDomain}`)) {
            return {
              valid: false,
              reason: `Phát hiện can thiệp tệp hosts: Tên miền máy chủ bản quyền '${cleanHost}' bị chuyển hướng trái phép về '${mappedIp}' (Dòng ${lineIndex + 1})`,
              tamperedDomain: cleanHost,
              mappedIp,
            };
          }
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Kiểm tra tính toàn vẹn của tệp hosts trên hệ thống hiện tại
 */
export function checkHostsIntegrity(
  customPath?: string,
  protectedDomains?: string[]
): HostsCheckResult {
  const hostsPath = customPath || getSystemHostsPath();

  if (!fs.existsSync(hostsPath)) {
    // Nếu tệp hosts không tồn tại (rất hiếm gặp), coi như không có chuyển hướng độc hại
    return { valid: true, hostsPath };
  }

  try {
    const content = fs.readFileSync(hostsPath, 'utf8');
    const result = checkHostsFileContent(content, protectedDomains);
    result.hostsPath = hostsPath;
    return result;
  } catch (err: any) {
    // Không thể đọc tệp hosts do phân quyền, tiếp tục nhưng ghi log cảnh báo
    return {
      valid: true,
      hostsPath,
      reason: `Không thể đọc tệp hosts (${err.message})`,
    };
  }
}

/**
 * In thông báo cảnh báo can thiệp tệp hosts nổi bật
 */
export function printHostsTamperedBanner(reason: string, hostsPath: string): void {
  const line = '═'.repeat(74);
  console.error(`\n${line}`);
  console.error(`🚨 CẢNH BÁO BẢO MẬT: PHÁT HIỆN CAN THIỆP TỆP HOSTS / DNS SPOOFING!`);
  console.error(`${line}`);
  console.error(`❌ Chi tiết: ${reason}`);
  console.error(`📁 Vị trí tệp hosts: ${hostsPath}`);
  console.error(`\n⚠️  Hệ thống phát hiện bạn hoặc một phần mềm bên thứ 3 đã chỉnh sửa tệp hosts`);
  console.error(`   để chuyển hướng tên miền máy chủ bản quyền Otter về máy cục bộ (Localhost).`);
  console.error(`   Để đảm bảo tính toàn vẹn, Otter TỪ CHỐI KHỞI ĐỘNG.`);
  console.error(`\n👉 Khắc phục:`);
  console.error(`   1. Mở tệp hosts bằng quyền Quản trị viên (Administrator / sudo).`);
  console.error(`   2. Xóa các dòng chuyển hướng liên quan đến otter.ai hoặc domain server.`);
  console.error(`   3. Lưu lại và khởi động lại Otter.`);
  console.error(`${line}\n`);
}

/**
 * Đảm bảo tính toàn vẹn của tệp hosts. Nếu phát hiện bị can thiệp sẽ từ chối khởi động app.
 */
export function assertHostsIntegrity(): void {
  const check = checkHostsIntegrity();
  if (!check.valid) {
    printHostsTamperedBanner(check.reason || 'Hosts file tampered', check.hostsPath || getSystemHostsPath());
    process.exit(1);
  }
}
