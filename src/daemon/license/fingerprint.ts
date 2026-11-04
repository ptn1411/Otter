import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { canonicalJSON, sha256Hash } from './crypto';

export interface DeviceComponents {
  platform_uuid: string;
  cpu_model: string;
  total_memory_gb: number;
  platform: string;
  os_version: string;
}

function getPlatformUUID(): string {
  const platform = os.platform();
  try {
    switch (platform) {
      case 'darwin':
        return getMacOSUUID();
      case 'linux':
        return getLinuxMachineId();
      case 'win32':
        return getWindowsMachineGuid();
      default:
        return getFallbackUUID();
    }
  } catch {
    return getFallbackUUID();
  }
}

function getMacOSUUID(): string {
  const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  }).toString();
  const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('IOPlatformUUID not found');
  }
  return match[1];
}

function getLinuxMachineId(): string {
  try {
    return readFileSync('/etc/machine-id', 'utf8').trim();
  } catch {
    return readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
  }
}

function getWindowsMachineGuid(): string {
  const output = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  }).toString();
  const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
  if (!match?.[1]) {
    throw new Error('MachineGuid not found');
  }
  return match[1];
}

function getFallbackUUID(): string {
  const hostname = os.hostname();
  const username = os.userInfo().username;
  return `${hostname}-${username}`;
}

function roundMemoryGB(bytes: number): number {
  const gb = bytes / 1024 ** 3;
  return Math.pow(2, Math.round(Math.log2(gb)));
}

export function getDeviceComponents(): DeviceComponents {
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  return {
    platform_uuid: getPlatformUUID(),
    cpu_model: cpus[0]?.model || 'unknown',
    total_memory_gb: roundMemoryGB(totalMemory),
    platform: os.platform(),
    os_version: os.release().split('.').slice(0, 2).join('.'),
  };
}

export function getDeviceHash(): string {
  const components = getDeviceComponents();
  const canonical = canonicalJSON(components);
  return sha256Hash(canonical);
}
