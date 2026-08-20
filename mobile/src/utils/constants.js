export const DEFAULT_SETTINGS = {
  mouseSensitivity: 1,
  scrollSensitivity: 1,
  smoothAcceleration: false
};

export const DEFAULT_TARGET = {
  ip: '',
  wsPort: '41235',
  udpMovePort: '41236',
  discoveryPort: '41234'
};

export const STORAGE_KEY = '@wireless_mouse_settings_v1';
export const STORAGE_KEY_TARGET = '@wireless_mouse_last_target_v1';
export const DUMMY_BUFFER = '  ';

export function toJson(payload) {
  return JSON.stringify(payload);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
