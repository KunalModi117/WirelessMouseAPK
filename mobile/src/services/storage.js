import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEY, STORAGE_KEY_TARGET, clamp } from '../utils/constants';

export async function safeParseSettings() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return {
      mouseSensitivity: clamp(Number(parsed.mouseSensitivity) || 1, 0.5, 3),
      scrollSensitivity: clamp(Number(parsed.scrollSensitivity) || 1, 0.5, 3),
      smoothAcceleration: Boolean(parsed.smoothAcceleration)
    };
  } catch (_) {
    return null;
  }
}

export async function safeSaveSettings(settings) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (_) {}
}

export async function safeParseLastTarget() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_TARGET);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ip) {
      return null;
    }
    return {
      ip: String(parsed.ip).trim(),
      wsPort: String(parsed.wsPort || '41235'),
      udpMovePort: String(parsed.udpMovePort || '41236'),
      discoveryPort: String(parsed.discoveryPort || '41234'),
      host: parsed.host ? String(parsed.host) : '',
      platform: parsed.platform ? String(parsed.platform) : '',
      deviceId: parsed.deviceId ? String(parsed.deviceId) : ''
    };
  } catch (_) {
    return null;
  }
}

export async function safeSaveLastTarget(targetObj) {
  try {
    if (!targetObj || !targetObj.ip) return;
    await AsyncStorage.setItem(
      STORAGE_KEY_TARGET,
      JSON.stringify({
        ip: targetObj.ip,
        wsPort: targetObj.wsPort || '41235',
        udpMovePort: targetObj.udpMovePort || '41236',
        discoveryPort: targetObj.discoveryPort || '41234',
        host: targetObj.host || '',
        platform: targetObj.platform || '',
        deviceId: targetObj.deviceId || ''
      })
    );
  } catch (_) {}
}
