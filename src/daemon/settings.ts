/**
 * Otter Centralized Settings & Environment Manager
 *
 * Lưu trữ bền vững các cài đặt hệ thống và biến môi trường vào ~/.otter/settings.json,
 * đồng bộ 2 chiều với process.env và các module daemon (CDP, Browser, Security, GPM).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getOtterDir } from "./db";
import { isFullAccessEnabled, setFullAccess } from "./security";

export interface OtterSettings {
  // Trình duyệt & CDP
  browserEngine: "cdp";
  cdpHeadless: boolean;
  cdpHud: boolean;
  cdpAutoClose: boolean;
  cdpPort: number;
  cdpWsEndpoint: string;
  browserPath: string;
  userDataDir: string;

  // Hệ thống & Bảo mật
  fullAccess: boolean;
  strictWorkspace: boolean;
  autoTunnel: boolean;
  apiKey: string;

  // Công cụ ngoài
  gpmApiPort: number;
  antigravityBin: string;

  // CUA Driver (Computer-Use Agent)
  cuaPermissionMode: "standard" | "bounded" | "unrestricted";
}

let cachedSettings: OtterSettings | null = null;

function settingsFilePath(): string {
  return path.join(getOtterDir(), "settings.json");
}

function getDefaultSettings(): OtterSettings {
  const browserEngine: "cdp" = "cdp";

  const headlessEnv = (process.env.OTTER_CDP_HEADLESS || "").trim().toLowerCase();
  const cdpHeadless = headlessEnv === "1" || headlessEnv === "true";

  const hudEnv = (process.env.OTTER_CDP_HUD || "").trim().toLowerCase();
  const cdpHud = hudEnv !== "0" && hudEnv !== "false" && hudEnv !== "off";

  const autoCloseEnv = (process.env.OTTER_CDP_AUTO_CLOSE || "").trim().toLowerCase();
  const cdpAutoClose = autoCloseEnv !== "0" && autoCloseEnv !== "false" && autoCloseEnv !== "off";

  const cdpPort = parseInt(process.env.OTTER_CDP_PORT || process.env.CDP_PORT || "9222", 10) || 9222;
  const cdpWsEndpoint = (process.env.OTTER_CDP_WS_ENDPOINT || "").trim();
  const browserPath = (process.env.OTTER_BROWSER_PATH || process.env.OTTER_CHROME_PATH || "").trim();
  const userDataDir = (process.env.OTTER_CHROME_USER_DATA_DIR || "").trim();

  const fullAccess = isFullAccessEnabled();
  const strictWorkspace = Boolean(process.env.OTTER_STRICT_WORKSPACE);
  const autoTunnel = process.env.NO_TUNNEL !== "1";
  const apiKey = (process.env.OTTER_API_KEY || "").trim();

  const gpmApiPort = parseInt(process.env.OTTER_GPM_PORT || "9495", 10) || 9495;
  const antigravityBin = (process.env.ANTIGRAVITY_BIN || "").trim();

  const envCuaMode = (process.env.OTTER_CUA_PERMISSION_MODE || "").trim().toLowerCase();
  const cuaPermissionMode: "standard" | "bounded" | "unrestricted" =
    envCuaMode === "bounded" || envCuaMode === "unrestricted" ? envCuaMode : "standard";

  return {
    browserEngine,
    cdpHeadless,
    cdpHud,
    cdpAutoClose,
    cdpPort,
    cdpWsEndpoint,
    browserPath,
    userDataDir,
    fullAccess,
    strictWorkspace,
    autoTunnel,
    apiKey,
    gpmApiPort,
    antigravityBin,
    cuaPermissionMode,
  };
}

function applySettingsToEnvironment(settings: OtterSettings): void {
  process.env.OTTER_BROWSER_ENGINE = settings.browserEngine;
  process.env.OTTER_CDP_HEADLESS = settings.cdpHeadless ? "1" : "0";
  process.env.OTTER_CDP_HUD = settings.cdpHud ? "1" : "0";
  process.env.OTTER_CDP_AUTO_CLOSE = settings.cdpAutoClose ? "1" : "0";
  process.env.OTTER_CDP_PORT = String(settings.cdpPort);
  process.env.CDP_PORT = String(settings.cdpPort);
  if (settings.cdpWsEndpoint) {
    process.env.OTTER_CDP_WS_ENDPOINT = settings.cdpWsEndpoint;
  } else {
    delete process.env.OTTER_CDP_WS_ENDPOINT;
  }

  if (settings.browserPath) {
    process.env.OTTER_BROWSER_PATH = settings.browserPath;
    process.env.OTTER_CHROME_PATH = settings.browserPath;
  } else {
    delete process.env.OTTER_BROWSER_PATH;
    delete process.env.OTTER_CHROME_PATH;
  }

  if (settings.userDataDir) {
    process.env.OTTER_CHROME_USER_DATA_DIR = settings.userDataDir;
  } else {
    delete process.env.OTTER_CHROME_USER_DATA_DIR;
  }

  if (settings.strictWorkspace) {
    process.env.OTTER_STRICT_WORKSPACE = "1";
  } else {
    delete process.env.OTTER_STRICT_WORKSPACE;
  }

  if (!settings.autoTunnel) {
    process.env.NO_TUNNEL = "1";
  } else {
    delete process.env.NO_TUNNEL;
  }

  if (settings.apiKey) {
    process.env.OTTER_API_KEY = settings.apiKey;
  }

  if (settings.gpmApiPort) {
    process.env.OTTER_GPM_PORT = String(settings.gpmApiPort);
  }

  if (settings.antigravityBin) {
    process.env.ANTIGRAVITY_BIN = settings.antigravityBin;
  } else {
    delete process.env.ANTIGRAVITY_BIN;
  }

  if (settings.cuaPermissionMode) {
    process.env.OTTER_CUA_PERMISSION_MODE = settings.cuaPermissionMode;
  }
}

export function loadSettings(): OtterSettings {
  const defaults = getDefaultSettings();
  try {
    const filePath = settingsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      cachedSettings = {
        ...defaults,
        ...parsed,
      };
      applySettingsToEnvironment(cachedSettings!);
      return cachedSettings!;
    }
  } catch (err) {
    console.warn("[Settings] Không thể đọc settings.json, dùng mặc định:", err);
  }

  cachedSettings = defaults;
  applySettingsToEnvironment(cachedSettings);
  return cachedSettings;
}

export function getSettings(): OtterSettings {
  if (!cachedSettings) {
    return loadSettings();
  }
  return cachedSettings;
}

export function updateSettings(partial: Partial<OtterSettings>): OtterSettings {
  const current = getSettings();
  const updated: OtterSettings = {
    ...current,
    ...partial,
  };

  // Áp dụng bảo mật Full Access
  if (typeof partial.fullAccess === "boolean" && partial.fullAccess !== current.fullAccess) {
    setFullAccess(partial.fullAccess, true);
  }

  cachedSettings = updated;
  applySettingsToEnvironment(updated);

  try {
    const filePath = settingsFilePath();
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
  } catch (err) {
    console.warn("[Settings] Không thể ghi settings.json:", err);
  }

  for (const listener of settingsChangeListeners) {
    try {
      listener(updated, current);
    } catch (e) {
      console.warn("[Settings] Listener error:", e);
    }
  }

  return updated;
}

type SettingsChangeListener = (updated: OtterSettings, previous: OtterSettings) => void;
const settingsChangeListeners: SettingsChangeListener[] = [];

export function onSettingsChange(listener: SettingsChangeListener): () => void {
  settingsChangeListeners.push(listener);
  return () => {
    const idx = settingsChangeListeners.indexOf(listener);
    if (idx !== -1) settingsChangeListeners.splice(idx, 1);
  };
}

export function initSettings(): OtterSettings {
  return loadSettings();
}
