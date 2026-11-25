/**
 * Hợp đồng dây PhoneCloud 1.2.0, đi cùng sản phẩm 1.3.0.
 *
 * Server và web vẫn chạy JavaScript. File này là kiểu chuẩn để lần nâng cấp sau
 * sửa hợp đồng trước, rồi mới sửa server/server.js, web/phonecloud.js và
 * android/.../SocketClient.kt cho khớp. Chạy `node protocol/check.js` để
 * đối chiếu các giá trị cố định với code đang chạy.
 */

export const PROTOCOL_VERSION = '1.2.0' as const;

export const QUALITIES = [360, 480, 720, 1080] as const;
export const FRAME_RATES = [15, 24, 30] as const;
export type Quality = (typeof QUALITIES)[number];
export type FrameRate = (typeof FRAME_RATES)[number];

export const KEY_NAMES = [
  'BACK',
  'HOME',
  'RECENTS',
  'NOTIFICATIONS',
  'ENTER',
  'DEL',
  'SPACE',
  'TAB',
  'ESCAPE',
  'POWER',
  'LOCK',
] as const;
export type KeyName = (typeof KEY_NAMES)[number];

export const POINTER_PHASES = ['down', 'move', 'up', 'cancel'] as const;
export type PointerPhase = (typeof POINTER_PHASES)[number];

export const APP_COMMANDS = ['start', 'stop', 'clear', 'uninstall', 'openInfo'] as const;
export type AppCommand = (typeof APP_COMMANDS)[number];

/** Lệnh web gửi trong socket event `command`. Mọi lệnh đều có taskId. */
export type Command =
  | { action: 'pointerEvent'; taskId: string; phase: PointerPhase; x: number; y: number }
  | { action: 'touchEvent' | 'clickEvent'; taskId: string; x: number; y: number }
  | { action: 'swipeEvent'; taskId: string; start_x: number; start_y: number; end_x: number; end_y: number; duration?: number }
  | { action: 'wheelEvent'; taskId: string; x: number; y: number; deltaY: number }
  | { action: 'keyEvent'; taskId: string; keyName: KeyName }
  | { action: 'setTextEvent'; taskId: string; text: string }
  | { action: 'findElements'; taskId: string; xpath: string }
  | { action: 'clickElement'; taskId: string; xpath: string }
  | { action: 'setTextElement'; taskId: string; xpath: string; text: string }
  | { action: 'appEvent'; taskId: string; command: AppCommand; packageName: string }
  | { action: 'clipboard'; taskId: string; command: 'get' | 'set'; text?: string }
  | { action: 'screenshot'; taskId: string }
  | { action: 'power'; taskId: string }
  | { action: 'onSyncIFrame'; taskId: string }
  | { action: 'timeSync'; taskId: string };

export type CommandAction = Command['action'];

export interface UiElement {
  text: string;
  contentDesc: string;
  resourceId: string;
  className: string;
  bounds: [number, number, number, number];
  clickable: boolean;
  enabled: boolean;
  checked: boolean;
  focused: boolean;
}

export interface CommandResult {
  taskId: string;
  status: boolean;
  data?: unknown;
  msg?: string;
}

/** Điện thoại gửi trong socket event `message`. */
export type PhoneMessage =
  | { action: 'orientation'; value: 'portrait' | 'landscape'; width: number; height: number }
  | { action: 'need_permission' }
  | { action: 'encoder_error'; msg: string };

export interface VideoMeta {
  width: number;
  height: number;
  sps: string;
  pps: string;
  /** Kích thước màn hình thật, dùng để quy đổi tọa độ chạm. */
  screenWidth?: number;
  screenHeight?: number;
  codec?: string;
}

/**
 * Frame socket event `screen`, nhị phân:
 * [1 byte cờ, bit 0 = keyframe][8 byte PTS micro giây, big-endian][H.264 Annex B]
 */
export interface ScreenFrameHeader {
  keyframe: boolean;
  ptsUs: number;
}

export interface StreamControl {
  status: boolean;
}

export interface SettingsPush {
  quality: Quality;
  fps: FrameRate;
}

export interface DeviceJoin {
  key: string;
  width: number;
  height: number;
}

export interface ControlJoin {
  device_id: string;
  passwd: string;
}

export interface JoinedOk {
  status: true;
  device_id?: string;
  online?: boolean;
  quality: Quality;
  fps: FrameRate;
}

export interface JoinedFail {
  status: false;
  msg: string;
}

export interface DeviceStatus {
  online: boolean;
}

export interface DeviceRecord {
  device_id: string;
  password: string;
  key: string;
  name: string;
  quality: Quality;
  fps: FrameRate;
  created_at: string;
}

export interface DevicePublic {
  device_id: string;
  name: string;
  online: boolean;
  quality: Quality;
  fps: FrameRate;
  created_at: string;
}

export interface Health {
  ok: true;
  devices: number;
  online: number;
  frames: number;
  dropped: number;
  mbps: number;
  uptimeSec: number;
}

export interface RegisterRequest {
  name?: string;
}

export interface RegisterResponse {
  status: true;
  device_id: string;
  password: string;
  key: string;
  ws_path: '/socket.io';
  quality: Quality;
  fps: FrameRate;
}

export interface DeviceConfig {
  status: true;
  quality: Quality;
  fps: FrameRate;
  ws_path: '/socket.io';
}

export interface ControlConnectRequest {
  device_id: string;
  passwd: string;
}

export interface ControlConnectResponse {
  status: true;
  online: boolean;
  ws_path: '/socket.io';
  name: string;
  quality: Quality;
  fps: FrameRate;
}

export interface SettingsRequest {
  device_id: string;
  passwd: string;
  quality: Quality;
  fps: FrameRate;
}

export interface SettingsResponse {
  status: true;
  quality: Quality;
  fps: FrameRate;
  online: boolean;
}

export interface ApiError {
  status: false;
  msg: string;
}
