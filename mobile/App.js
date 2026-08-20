import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  NativeModules,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import { useTrackpadGesture } from './src/gestures/useTrackpadGesture';

const DEFAULT_SETTINGS = {
  mouseSensitivity: 1,
  scrollSensitivity: 1,
  smoothAcceleration: false
};

const DEFAULT_TARGET = {
  ip: '',
  wsPort: '41235',
  udpMovePort: '41236',
  discoveryPort: '41234'
};

const STORAGE_KEY = '@wireless_mouse_settings_v1';
const STORAGE_KEY_TARGET = '@wireless_mouse_last_target_v1';
const DUMMY_BUFFER = '  ';

function toJson(payload) {
  return JSON.stringify(payload);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


async function safeParseSettings() {
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

async function safeParseLastTarget() {
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

async function safeSaveLastTarget(targetObj) {
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

function normalizeDiscoveredTarget(payload, fallbackAddress) {
  return {
    ip: payload.ip || fallbackAddress,
    wsPort: String(payload.httpPort || payload.wsPort || 41235),
    udpMovePort: String(payload.udpMovePort || 41236),
    discoveryPort: String(payload.udpDiscoveryPort || payload.discoveryPort || 41234),
    host: payload.host || payload.name || '',
    platform: payload.platform || '',
    deviceId: payload.deviceId || ''
  };
}

async function runUdpDiscovery(logFn) {
  const startTime = Date.now();

  const { UdpDiscoveryModule } = NativeModules;
  if (!UdpDiscoveryModule || typeof UdpDiscoveryModule.discoverServers !== 'function') {
    return { success: false, servers: [], mode: 'UDP_UNAVAILABLE' };
  }

  try {
    const rawResults = await UdpDiscoveryModule.discoverServers(41234, 1500);
    if (logFn) logFn('info', '[MOUSE-DISCOVERY]', 'Socket closed');
    const discoveryElapsed = Date.now() - startTime;
    const rawCount = Array.isArray(rawResults) ? rawResults.length : 0;

    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      return { success: false, servers: [], mode: 'UDP_NO_RESPONSES' };
    }

    const validServers = [];
    const seenDeviceIds = new Set();

    await Promise.all(
      rawResults.map(async (raw) => {
        const candidateIp = raw.ip;
        if (!candidateIp) return;

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 1000);
          const res = await fetch(`http://${candidateIp}:${raw.httpPort || raw.port || 41235}/health`, {
            signal: controller.signal
          });
          clearTimeout(timer);

          if (res.ok) {
            const healthData = await res.json();
            if (healthData && healthData.app === 'WirelessMouseKeyboardRemote') {
              const deviceId = healthData.deviceId || raw.deviceId || candidateIp;
              if (!seenDeviceIds.has(deviceId)) {
                seenDeviceIds.add(deviceId);
                const targetObj = {
                  ip: candidateIp,
                  wsPort: String(healthData.wsPort || raw.wsPort || raw.httpPort || 41235),
                  udpMovePort: String(healthData.udpMovePort || raw.udpMovePort || 41236),
                  discoveryPort: String(healthData.udpDiscoveryPort || raw.discoveryPort || 41234),
                  host: healthData.host || raw.name || raw.host || 'Wi-Fi Mouse PC',
                  platform: healthData.platform || raw.platform || 'unknown',
                  deviceId: deviceId
                };
                validServers.push(targetObj);
              }
            }
          }
        } catch (_) {
          // Reject invalid health check candidate
        }
      })
    );

    return {
      success: validServers.length > 0,
      servers: validServers,
      mode: 'UDP'
    };
  } catch (err) {
    if (logFn) logFn('error', '[MOUSE-DISCOVERY]', `UDP discovery error: ${err?.message || String(err)}`);
    return { success: false, servers: [], mode: 'UDP_ERROR' };
  }
}

async function detectLocalSubnetPrefixes(activeTargetIp = '', manualDraftIp = '') {
  const prefixes = new Set();

  [activeTargetIp, manualDraftIp].forEach((ipStr) => {
    if (ipStr && typeof ipStr === 'string') {
      const trimmed = ipStr.trim();
      const parts = trimmed.split('.');
      if (parts.length === 4 && parts[0] !== '127') {
        prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
      }
    }
  });

  try {
    const PeerConn = globalThis.RTCPeerConnection || globalThis.webkitRTCPeerConnection;
    if (PeerConn) {
      await new Promise((resolve) => {
        let settled = false;
        let pc = null;
        const finish = () => {
          if (!settled) {
            settled = true;
            if (pc) {
              try { pc.close(); } catch (_) {}
            }
            resolve();
          }
        };
        setTimeout(finish, 600);
        try {
          pc = new PeerConn({ iceServers: [] });
          pc.createDataChannel('');
          pc.onicecandidate = (evt) => {
            if (!evt || !evt.candidate) {
              finish();
              return;
            }
            const candStr = evt.candidate.candidate || '';
            const match = candStr.match(/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
            if (match && match[1] && !match[1].startsWith('127.')) {
              const parts = match[1].split('.');
              if (parts.length === 4) {
                prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
              }
            }
          };
          pc.createOffer().then((offer) => pc.setLocalDescription(offer)).catch(finish);
        } catch (_) {
          finish();
        }
      });
    }
  } catch (_) {}

  const defaultSubnets = ['192.168.1', '192.168.0', '192.168.2', '10.0.0', '10.0.2', '172.16.0', '192.168.50'];
  defaultSubnets.forEach((prefix) => prefixes.add(prefix));

  return Array.from(prefixes);
}

/**
 * Reusable Tactile Button following Apple design principles:
 * Instant touch-down feedback, critically damped scaling, and strong visual feedback.
 */
function TactileButton({ onPress, onPressIn, onPressOut, style, pressedStyle, children, activeOpacity = 0.8, scaleDown = 0.97 }) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => [
        style,
        pressed && [
          styles.tactilePressed,
          { transform: [{ scale: scaleDown }], opacity: activeOpacity },
          pressedStyle
        ]
      ]}
    >
      {children}
    </Pressable>
  );
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [connectionStatus, setConnectionStatus] = useState('searching');
  const [connectedHost, setConnectedHost] = useState('');
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugModalOpen, setBugModalOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(DEFAULT_TARGET);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);
  const [discovered, setDiscovered] = useState([]);
  const [manualMode, setManualMode] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [inputValue, setInputValue] = useState(DUMMY_BUFFER);
  const [lastError, setLastError] = useState('');
  const [debugLogs, setDebugLogs] = useState([]);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const pingTimerRef = useRef(null);
  const lastPongAtRef = useRef(0);
  const lastMoveAtRef = useRef(0);
  const connectionIdRef = useRef(0);
  const hiddenInputRef = useRef(null);
  const logsRef = useRef([]);

  const discoveryEnabled = true;

  function addDebugLog(level, message, details = '') {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: new Date().toISOString(),
      level,
      message,
      details: details ? String(details) : ''
    };
    logsRef.current = [entry, ...logsRef.current].slice(0, 80);
    setDebugLogs(logsRef.current);
  }

  function formatLogLine(entry) {
    const suffix = entry.details ? ` | ${entry.details}` : '';
    return `[${entry.ts}] ${entry.level.toUpperCase()}: ${entry.message}${suffix}`;
  }

  async function copyDebugLogs() {
    const text = logsRef.current.map(formatLogLine).join('\n');
    await Clipboard.setStringAsync(text || 'No logs captured yet.');
    Alert.alert('Copied', 'Diagnostics copied to clipboard.');
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const savedSettings = await safeParseSettings();
      if (mounted && savedSettings) {
        setSettings(savedSettings);
        setDraftSettings(savedSettings);
      }
      const savedTarget = await safeParseLastTarget();
      if (mounted && savedTarget && savedTarget.ip) {
        setTarget(savedTarget);
        setManualDraft(savedTarget);
        addDebugLog(
          'info',
          'Loaded saved PC target',
          `${savedTarget.host ? `${savedTarget.host} (${savedTarget.ip})` : savedTarget.ip}:${savedTarget.wsPort}`
        );
        connectToServer(savedTarget, true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  const discoveryStateRef = useRef('IDLE');
  const isDiscoveryRunningRef = useRef(false);

  // Connection Discovery Manager Effect (Primary: UDP Discovery, Fallback: HTTP Subnet Scan)
  useEffect(() => {
    if (!discoveryEnabled || manualMode || connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED') {
      if (connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED') {
        addDebugLog('info', '[MOUSE-DISCOVERY]', 'Stopped: connected');
      }
      return;
    }
    let isCancelled = false;

    const performDiscovery = async () => {
      if (isCancelled || connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED' || isDiscoveryRunningRef.current) {
        return;
      }
      isDiscoveryRunningRef.current = true;
      discoveryStateRef.current = 'DISCOVERING';
      addDebugLog('info', '[MOUSE-DISCOVERY]', 'Started');

      try {
        // Step 1: Run Primary UDP Discovery
        const udpResult = await runUdpDiscovery(addDebugLog);

        if (isCancelled || connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED') {
          addDebugLog('info', '[MOUSE-DISCOVERY]', 'Stopped: connected');
          return;
        }

        if (udpResult.success && udpResult.servers.length > 0) {
          const first = udpResult.servers[0];
          addDebugLog('info', '[MOUSE-DISCOVERY]', `Server discovered: ${first.ip}`);
          setDiscovered(udpResult.servers);

          // Check if saved target has deviceId matching a discovered server at a new IP
          if (target && target.deviceId) {
            const match = udpResult.servers.find((s) => s.deviceId === target.deviceId);
            if (match && match.ip !== target.ip) {
              if (connectionStatus !== 'connected' && discoveryStateRef.current !== 'CONNECTED') {
                safeSaveLastTarget(match);
                setTarget(match);
                connectToServer(match);
              }
              return;
            }
          }
          return;
        }

        // Step 2: Fallback to HTTP Subnet Scan if UDP Discovery found nothing
        if (isCancelled || connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED') {
          addDebugLog('info', '[MOUSE-DISCOVERY]', 'Stopped: connected');
          return;
        }

        const subnets = await detectLocalSubnetPrefixes(target?.ip, manualDraft?.ip);
        const candidateIps = ['127.0.0.1', '10.0.2.2'];
        for (const prefix of subnets) {
          for (let i = 1; i <= 254; i++) {
            candidateIps.push(`${prefix}.${i}`);
          }
        }

        const foundList = [];
        const batchSize = 50;

        for (let i = 0; i < candidateIps.length; i += batchSize) {
          if (isCancelled || connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED') {
            break;
          }
          const batch = candidateIps.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (ip) => {
              if (isCancelled || connectionStatus === 'connected' || discoveryStateRef.current === 'CONNECTED') return;
              try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 700);
                const res = await fetch(`http://${ip}:41235/health`, {
                  signal: controller.signal
                });
                clearTimeout(timer);

                if (res.ok) {
                  const data = await res.json();
                  if (data && data.app === 'WirelessMouseKeyboardRemote') {
                    const targetObj = normalizeDiscoveredTarget(data, ip);
                    if (!foundList.some((item) => (item.deviceId && item.deviceId === targetObj.deviceId) || item.ip === targetObj.ip)) {
                      foundList.push(targetObj);
                      if (!isCancelled && connectionStatus !== 'connected' && discoveryStateRef.current !== 'CONNECTED') {
                        setDiscovered([...foundList]);
                        addDebugLog('info', '[MOUSE-DISCOVERY]', `Server discovered: ${targetObj.ip}`);
                      }
                    }
                  }
                }
              } catch (_) {}
            })
          );
        }
      } finally {
        isDiscoveryRunningRef.current = false;
        if (discoveryStateRef.current !== 'CONNECTED') {
          discoveryStateRef.current = 'IDLE';
        }
      }
    };

    performDiscovery();

    const interval = setInterval(performDiscovery, 12000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [discoveryEnabled, manualMode, connectionStatus, target?.ip, target?.deviceId]);

  useEffect(() => {
    return () => {
      stopReconnectLoop();
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    if (!keyboardVisible) {
      Keyboard.dismiss();
    } else if (hiddenInputRef.current) {
      hiddenInputRef.current.focus();
    }
  }, [keyboardVisible]);

  useEffect(() => {
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
    });
    return () => {
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!manualMode && discovered.length > 0 && connectionStatus !== 'connected') {
      const best = discovered[0];
      addDebugLog('info', 'Auto-connect candidate', `${best.ip}:${best.wsPort}`);
      connectToServer(best);
    }
  }, [discovered, manualMode, connectionStatus]);

  function stopReconnectLoop() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }

  function disconnectSocket() {
    connectionIdRef.current += 1;
    try {
      if (wsRef.current) {
        wsRef.current.close();
      }
    } catch (_) {}
    wsRef.current = null;
    activeServerRef.current = null;
  }

  function scheduleReconnect() {
    stopReconnectLoop();
    addDebugLog('info', 'Reconnect scheduled', 'retrying in 3.5s');
    reconnectTimerRef.current = setTimeout(() => {
      const next = activeServerRef.current || discovered[0];
      if (next) {
        addDebugLog('info', 'Reconnect attempt', `${next.ip}:${next.wsPort}`);
        connectToServer(next, true);
      } else if (target.ip) {
        addDebugLog('info', 'Reconnect attempt', `${target.ip}:${target.wsPort}`);
        connectToServer(
          {
            ip: target.ip,
            wsPort: target.wsPort,
            udpMovePort: target.udpMovePort,
            discoveryPort: target.discoveryPort
          },
          true
        );
      }
    }, 3500);
  }

  function sendWs(payload) {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== 1) {
      queuedMessagesRef.current.push(payload);
      return false;
    }
    socket.send(toJson(payload));
    return true;
  }

  function flushQueue() {
    const socket = wsRef.current;
    if (!socket || socket.readyState !== 1) {
      return;
    }
    const queued = queuedMessagesRef.current.splice(0);
    queued.forEach((payload) => {
      socket.send(toJson(payload));
    });
  }

  function connectToServer(server, silent = false) {
    if (!server || !server.ip) {
      if (!silent) {
        setLastError('Enter a valid IP address first.');
        addDebugLog('warn', 'Connect blocked', 'missing IP address');
      }
      return;
    }

    stopReconnectLoop();
    disconnectSocket();
    setConnectionStatus('connecting');
    setLastError('');
    setTarget(server);
    activeServerRef.current = server;
    addDebugLog('info', 'Connecting', `ws://${server.ip}:${server.wsPort}`);

    const wsUrl = `ws://${server.ip}:${server.wsPort}`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;
    const connectionId = Date.now() + Math.random();
    connectionIdRef.current = connectionId;

    socket.onopen = () => {
      if (connectionIdRef.current !== connectionId) {
        return;
      }
      discoveryStateRef.current = 'CONNECTED';
      setConnectionStatus('connected');
      addDebugLog('info', '[MOUSE-DISCOVERY]', 'Stopped: connected');
      const initialHostLabel = server.host
        ? `🖥️ ${server.host} (${server.ip}:${server.wsPort})`
        : `${server.ip}:${server.wsPort}`;
      setConnectedHost(initialHostLabel);
      safeSaveLastTarget(server);
      lastPongAtRef.current = Date.now();
      addDebugLog('info', 'WebSocket connected', wsUrl);
      flushQueue();
      sendWs({ type: 'handshake', client: 'expo-android' });
      pingTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - lastPongAtRef.current;
        if (elapsed > 25000) {
          setLastError('Connection timed out. Reconnecting...');
          addDebugLog('warn', 'Heartbeat timeout', `last pong ${elapsed}ms ago`);
          setConnectionStatus('disconnected');
          if (discoveryStateRef.current === 'CONNECTED') {
            discoveryStateRef.current = 'IDLE';
          }
          try {
            socket.close();
          } catch (_) {}
          scheduleReconnect();
          return;
        }
        sendWs({ type: 'ping', timestamp: Date.now() });
      }, 5000);
    };

    socket.onmessage = (event) => {
      if (connectionIdRef.current !== connectionId) {
        return;
      }
      try {
        const payload = JSON.parse(event.data);
        lastPongAtRef.current = Date.now();
        if (payload.type === 'welcome' || payload.type === 'handshake-ack') {
          const updatedHost = payload.host || server.host || '';
          const updatedPlatform = payload.platform || server.platform || '';
          const updatedDeviceId = payload.deviceId || server.deviceId || '';
          const updatedServer = {
            ...server,
            host: updatedHost,
            platform: updatedPlatform,
            deviceId: updatedDeviceId
          };
          setTarget(updatedServer);
          const finalHostLabel = updatedHost
            ? `🖥️ ${updatedHost} (${payload.serverIp || server.ip}:${payload.httpPort || server.wsPort})`
            : `${payload.serverIp || server.ip}:${payload.httpPort || server.wsPort}`;
          setConnectedHost(finalHostLabel);
          safeSaveLastTarget(updatedServer);
          addDebugLog('info', 'Handshake received', JSON.stringify(payload));
        }
      } catch (_) {
        lastPongAtRef.current = Date.now();
      }
    };

    socket.onerror = (event) => {
      if (connectionIdRef.current !== connectionId) {
        return;
      }
      setConnectionStatus('disconnected');
      if (discoveryStateRef.current === 'CONNECTED') {
        discoveryStateRef.current = 'IDLE';
      }
      setLastError(`Unable to connect to ${wsUrl}`);
      addDebugLog('error', 'WebSocket error', event?.message || 'socket error');
    };

    socket.onclose = (event) => {
      if (connectionIdRef.current !== connectionId) {
        return;
      }
      stopReconnectLoop();
      setConnectionStatus('disconnected');
      if (discoveryStateRef.current === 'CONNECTED') {
        discoveryStateRef.current = 'IDLE';
      }
      addDebugLog(
        'warn',
        'WebSocket closed',
        `code=${event?.code ?? 'unknown'} reason=${event?.reason || 'none'} clean=${String(Boolean(event?.wasClean))}`
      );
      scheduleReconnect();
    };
  }

  const pendingMoveRef = useRef({ x: 0, y: 0, touchCount: 0 });
  const touchDiagRef = useRef({
    touchEvents: 0,
    wsSent: 0,
    coalesced: 0,
    lost: 0,
    lastDiagAt: Date.now()
  });

  function flushPendingMove() {
    if (Math.abs(pendingMoveRef.current.x) > 0.0001 || Math.abs(pendingMoveRef.current.y) > 0.0001) {
      const moveX = pendingMoveRef.current.x;
      const moveY = pendingMoveRef.current.y;
      const count = pendingMoveRef.current.touchCount || 1;
      if (count > 1) {
        touchDiagRef.current.coalesced += count - 1;
      }
      pendingMoveRef.current = { x: 0, y: 0, touchCount: 0 };

      const scaledDx = moveX * settings.mouseSensitivity;
      const scaledDy = moveY * settings.mouseSensitivity;
      const sent = sendWs({
        type: 'move',
        dx: scaledDx,
        dy: scaledDy,
        sensitivity: 1,
        smooth: settings.smoothAcceleration
      });
      if (sent) {
        touchDiagRef.current.wsSent += 1;
      }
    }
  }

  function sendMove(dx, dy) {
    const server = activeServerRef.current || target;
    if (!server || !server.ip) {
      return;
    }

    const now = Date.now();
    touchDiagRef.current.touchEvents += 1;
    pendingMoveRef.current.touchCount = (pendingMoveRef.current.touchCount || 0) + 1;
    pendingMoveRef.current.x += dx;
    pendingMoveRef.current.y += dy;

    if (now - lastMoveAtRef.current >= 8) {
      lastMoveAtRef.current = now;
      flushPendingMove();
    }

    if (now - touchDiagRef.current.lastDiagAt >= 1000) {
      if (touchDiagRef.current.touchEvents > 0) {
        addDebugLog(
          'diag',
          'Mobile Diag (1s window)',
          `Touch: ${touchDiagRef.current.touchEvents}/s | WS Sent: ${touchDiagRef.current.wsSent}/s | Coalesced: ${touchDiagRef.current.coalesced} | Lost: ${touchDiagRef.current.lost}`
        );
      }
      touchDiagRef.current = {
        touchEvents: 0,
        wsSent: 0,
        coalesced: 0,
        lost: 0,
        lastDiagAt: now
      };
    }
  }

  function sendClick(button) {
    addDebugLog('info', 'Click', button);
    sendWs({ type: 'click', button });
  }

  function sendDrag(active, button) {
    addDebugLog('info', 'Drag', `${active ? 'Down' : 'Up'} ${button}`);
    sendWs({ type: 'drag', active, button });
  }

  function sendScroll(deltaY, deltaX = 0) {
    if (Math.abs(deltaY) > 0.1 || Math.abs(deltaX) > 0.1) {
      addDebugLog('info', 'Scroll', `Y:${Math.round(deltaY)} X:${Math.round(deltaX)}`);
    }
    sendWs({
      type: 'scroll',
      delta: deltaY,
      deltaX: deltaX,
      sensitivity: settings.scrollSensitivity,
      smooth: false
    });
  }

  function sendVolume(action) {
    addDebugLog('info', 'Volume', action);
    sendWs({ type: 'volume', action });
  }

  function sendKey(key) {
    addDebugLog('info', 'Key', key);
    sendWs({ type: 'key', key });
  }

  function handleHiddenKeyPress(event) {
    const key = event.nativeEvent.key;
    if (!key) {
      return;
    }
    if (key === 'Enter' || key === 'return') {
      sendKey('Enter');
      return;
    }
    const specialKeyMap = {
      ArrowUp: 'Up',
      ArrowDown: 'Down',
      ArrowLeft: 'Left',
      ArrowRight: 'Right',
      Up: 'Up',
      Down: 'Down',
      Left: 'Left',
      Right: 'Right',
      Tab: 'Tab',
      Escape: 'Escape'
    };
    if (specialKeyMap[key]) {
      sendKey(specialKeyMap[key]);
    }
  }

  function handleTextChange(text) {
    if (text === DUMMY_BUFFER) {
      return;
    }

    if (text.length > DUMMY_BUFFER.length) {
      const added = text.slice(DUMMY_BUFFER.length);
      for (let i = 0; i < added.length; i += 1) {
        const char = added[i];
        if (char === '\n' || char === '\r') {
          sendKey('Enter');
        } else if (char === ' ') {
          sendKey('Space');
        } else {
          sendKey(char);
        }
      }
    } else if (text.length < DUMMY_BUFFER.length) {
      const deleteCount = DUMMY_BUFFER.length - text.length;
      for (let i = 0; i < deleteCount; i += 1) {
        sendKey('Backspace');
      }
    }

    setInputValue(DUMMY_BUFFER);
  }

  const { trackpadResponder, scrollResponder } = useTrackpadGesture({
    onMove: sendMove,
    onFlushMove: flushPendingMove,
    onResetMoveCount: (count) => {
      pendingMoveRef.current = { x: 0, y: 0, touchCount: count };
    },
    onIncrementLostTouch: () => {
      touchDiagRef.current.lost += 1;
    },
    onClick: sendClick,
    onScroll: sendScroll,
    onDrag: sendDrag,
    onLog: addDebugLog
  });

  function openConnectionModal() {
    setManualDraft(target.ip ? target : DEFAULT_TARGET);
    setConnectionModalOpen(true);
  }

  function saveManual() {
    if (!manualDraft.ip.trim()) {
      Alert.alert('Missing IP', 'Enter the PC IP address to connect.');
      return;
    }
    const next = {
      ip: manualDraft.ip.trim(),
      wsPort: String(manualDraft.wsPort || '41235'),
      udpMovePort: String(manualDraft.udpMovePort || '41236'),
      discoveryPort: String(manualDraft.discoveryPort || '41234')
    };
    setManualMode(true);
    setTarget(next);
    setConnectionModalOpen(false);
    addDebugLog('info', 'Manual connect submitted', `${next.ip}:${next.wsPort}`);
    connectToServer(next);
  }

  function connectDiscovered(index) {
    const next = discovered[index];
    if (!next) {
      return;
    }
    setManualMode(false);
    setTarget(next);
    setConnectionModalOpen(false);
    connectToServer(next);
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <View style={styles.shell}>
            {/* 1. HEADER (Minimal, Icon-only) */}
            <View style={styles.header}>
              <TactileButton onPress={openConnectionModal} style={styles.headerIconBtn}>
                <View
                  style={[
                    styles.statusDot,
                    connectionStatus === 'connected'
                      ? styles.statusDotGreen
                      : connectionStatus === 'connecting'
                        ? styles.statusDotYellow
                        : styles.statusDotRed
                  ]}
                />
              </TactileButton>

              <View style={styles.headerRightActions}>
                <TactileButton
                  onPress={() => {
                    setKeyboardVisible(true);
                    if (hiddenInputRef.current) {
                      hiddenInputRef.current.focus();
                    }
                  }}
                  style={styles.headerIconBtn}
                >
                  <Text style={styles.headerIconText}>⌨</Text>
                </TactileButton>

              <TactileButton
                onPress={() => {
                  setDraftSettings(settings);
                  setSettingsOpen(true);
                }}
                style={styles.headerIconBtn}
              >
                <Text style={styles.headerIconText}>⚙</Text>
              </TactileButton>
            </View>
          </View>

          {/* 2. COMPACT VOLUME CONTROLS */}
          <View style={styles.volumeGroup}>
            <TactileButton onPress={() => sendVolume('down')} style={styles.volumeBtn}>
              <Text style={styles.volumeBtnIcon}>🔉</Text>
              <Text style={styles.volumeBtnSign}>−</Text>
            </TactileButton>
            <View style={styles.volumeDivider} />
            <TactileButton onPress={() => sendVolume('up')} style={styles.volumeBtn}>
              <Text style={styles.volumeBtnIcon}>🔊</Text>
              <Text style={styles.volumeBtnSign}>+</Text>
            </TactileButton>
          </View>

          {/* ERROR BANNER IF ANY */}
          {!!lastError && (
            <TactileButton onPress={() => setLastError('')} style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{lastError}</Text>
            </TactileButton>
          )}

          {/* 3. MAIN TRACKPAD AREA (~60-70% Height Focus) & INTEGRATED SCROLL STRIP */}
          <View style={styles.trackpadContainer}>
            <View style={styles.trackpadSurface} {...trackpadResponder.panHandlers}>
              {/* Clean Precision Surface (No Clutter, No Hints) */}
              <View style={styles.trackpadInnerBorder} />
            </View>

            {/* Scroll Strip integrated on right inner edge */}
            <View style={styles.integratedScrollStrip} {...scrollResponder.panHandlers}>
              <Text style={styles.scrollChevron}>▲</Text>
              <View style={styles.scrollBarLine} />
              <Text style={styles.scrollChevron}>▼</Text>
            </View>
          </View>

          {/* 4. LEFT / RIGHT CLICK BUTTONS */}
          <View style={styles.clickBar}>
            <TactileButton 
              onPressIn={() => sendDrag(true, 'left')} 
              onPressOut={() => sendDrag(false, 'left')} 
              style={styles.leftClickBtn}>
              <View style={styles.clickIconIndicatorLeft} />
            </TactileButton>
            <View style={styles.clickDivider} />
            <TactileButton onPress={() => sendClick('right')} style={styles.rightClickBtn}>
              <View style={styles.clickIconIndicatorRight} />
            </TactileButton>
          </View>

          {/* 5. BOTTOM DIRECTIONAL & FUNCTION CONTROLS (3 EQUAL COLUMNS) */}
          <View style={styles.bottomPadGrid}>
            {/* Column 1: Left Arrow + Keyboard */}
            <TactileButton onPress={() => sendKey('Left')} style={styles.dPadLargeBtn}>
              <Text style={styles.dPadArrowText}>◀</Text>
              <Text style={styles.dPadSubIcon}>⌨</Text>
            </TactileButton>

            {/* Column 2: Up Arrow stacked over Down Arrow */}
            <View style={styles.dPadCenterCol}>
              <TactileButton onPress={() => sendKey('Up')} style={styles.dPadHalfBtnTop}>
                <Text style={styles.dPadArrowText}>▲</Text>
              </TactileButton>
              <View style={styles.dPadCenterDivider} />
              <TactileButton onPress={() => sendKey('Down')} style={styles.dPadHalfBtnBottom}>
                <Text style={styles.dPadArrowText}>▼</Text>
              </TactileButton>
            </View>

            {/* Column 3: Right Arrow + Keyboard */}
            <TactileButton onPress={() => sendKey('Right')} style={styles.dPadLargeBtn}>
              <Text style={styles.dPadArrowText}>▶</Text>
              <Text style={styles.dPadSubIcon}>⌨</Text>
            </TactileButton>
          </View>

          {/* HIDDEN INPUT FOR KEYBOARD FORWARDING */}
          {keyboardVisible && (
            <TextInput
              ref={hiddenInputRef}
              value={inputValue}
              onChangeText={handleTextChange}
              onKeyPress={handleHiddenKeyPress}
              onSubmitEditing={() => sendKey('Enter')}
              returnKeyType="send"
              style={styles.hiddenInput}
              autoCapitalize="none"
              autoCorrect={false}
              blurOnSubmit={false}
              placeholder=""
            />
          )}
        </View>
      </SafeAreaView>

      {/* CONNECTION MODAL / SHEET */}
      <Modal
        visible={connectionModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setConnectionModalOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Connection</Text>
              <TactileButton onPress={() => setConnectionModalOpen(false)} style={styles.sheetCloseBtn}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TactileButton>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              {/* CURRENT STATUS */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionHeading}>Current Status</Text>
                <View style={styles.statusCard}>
                  <View style={styles.statusRow}>
                    <View
                      style={[
                        styles.statusDot,
                        connectionStatus === 'connected'
                          ? styles.statusDotGreen
                          : connectionStatus === 'connecting'
                            ? styles.statusDotYellow
                            : styles.statusDotRed
                      ]}
                    />
                    <Text style={styles.statusStateText}>
                      {connectionStatus === 'connected'
                        ? `Connected`
                        : connectionStatus === 'connecting'
                          ? 'Connecting...'
                          : 'Disconnected'}
                    </Text>
                  </View>
                  {connectionStatus === 'connected' && !!connectedHost && (
                    <Text style={styles.statusHostText}>{connectedHost}</Text>
                  )}
                  {connectionStatus === 'connected' && (
                    <TactileButton
                      onPress={() => {
                        disconnectSocket();
                        setConnectionStatus('disconnected');
                      }}
                      style={styles.disconnectBtn}
                    >
                      <Text style={styles.disconnectBtnText}>Disconnect</Text>
                    </TactileButton>
                  )}
                </View>
              </View>

              {/* DISCOVERED DEVICES */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionHeading}>Discovered PCs</Text>
                {discovered.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyCardText}>
                      {discoveryEnabled
                        ? 'Scanning local Wi-Fi subnet for PC server...'
                        : 'Discovery disabled. Enter IP below.'}
                    </Text>
                  </View>
                ) : (
                  discovered.map((item, index) => (
                    <TactileButton
                      key={`${item.deviceId || item.ip}:${item.wsPort}`}
                      onPress={() => connectDiscovered(index)}
                      style={styles.discoveredRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.discoveredIpText}>
                          {item.host ? `🖥️ ${item.host}` : item.ip}
                        </Text>
                        <Text style={styles.discoveredMetaText}>
                          {item.platform ? `${item.platform} · Available` : 'Available'}
                        </Text>
                      </View>
                      <View style={styles.connectPill}>
                        <Text style={styles.connectPillText}>Connect</Text>
                      </View>
                    </TactileButton>
                  ))
                )}
              </View>

              {/* MANUAL ENTRY */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionHeading}>Manual Connection</Text>
                <View style={styles.manualCard}>
                  <Text style={styles.fieldLabel}>PC IP Address</Text>
                  <TextInput
                    value={manualDraft.ip}
                    onChangeText={(val) => setManualDraft((curr) => ({ ...curr, ip: val }))}
                    placeholder="e.g. 192.168.1.100"
                    placeholderTextColor="#475569"
                    keyboardType="numeric"
                    style={styles.inputField}
                  />

                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>WS Port</Text>
                      <TextInput
                        value={manualDraft.wsPort}
                        onChangeText={(val) => setManualDraft((curr) => ({ ...curr, wsPort: val }))}
                        placeholder="41235"
                        placeholderTextColor="#475569"
                        keyboardType="numeric"
                        style={styles.inputField}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fieldLabel}>UDP Port</Text>
                      <TextInput
                        value={manualDraft.udpMovePort}
                        onChangeText={(val) => setManualDraft((curr) => ({ ...curr, udpMovePort: val }))}
                        placeholder="41236"
                        placeholderTextColor="#475569"
                        keyboardType="numeric"
                        style={styles.inputField}
                      />
                    </View>
                  </View>

                  <TactileButton onPress={saveManual} style={styles.primaryActionBtn}>
                    <Text style={styles.primaryActionText}>Connect to IP</Text>
                  </TactileButton>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* SETTINGS MODAL / SHEET */}
      <Modal
        visible={settingsOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Settings</Text>
              <TactileButton onPress={() => setSettingsOpen(false)} style={styles.sheetCloseBtn}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TactileButton>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              {/* GROUP: CONNECTION */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionHeading}>Connection</Text>
                <View style={styles.groupedContainer}>
                  <View style={styles.groupedRow}>
                    <Text style={styles.groupedLabel}>Status</Text>
                    <Text style={styles.groupedValue}>
                      {connectionStatus === 'connected' ? `Connected (${target.ip || 'PC'})` : 'Disconnected'}
                    </Text>
                  </View>
                  <View style={styles.groupedDivider} />
                  <TactileButton
                    onPress={() => {
                      setSettingsOpen(false);
                      openConnectionModal();
                    }}
                    style={styles.groupedActionRow}
                  >
                    <Text style={styles.groupedActionText}>Manage Connection</Text>
                    <Text style={styles.groupedChevron}>›</Text>
                  </TactileButton>
                </View>
              </View>

              {/* GROUP: INPUT */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionHeading}>Input</Text>
                <View style={styles.groupedContainer}>
                  {/* Mouse Sensitivity */}
                  <View style={styles.groupedRow}>
                    <Text style={styles.groupedLabel}>Mouse Sensitivity</Text>
                    <View style={styles.stepperRow}>
                      <TactileButton
                        onPress={() =>
                          setDraftSettings((curr) => ({
                            ...curr,
                            mouseSensitivity: Math.max(0.5, Math.round((curr.mouseSensitivity - 0.1) * 10) / 10)
                          }))
                        }
                        style={styles.stepperBtn}
                      >
                        <Text style={styles.stepperBtnText}>−</Text>
                      </TactileButton>
                      <Text style={styles.stepperVal}>{draftSettings.mouseSensitivity.toFixed(1)}x</Text>
                      <TactileButton
                        onPress={() =>
                          setDraftSettings((curr) => ({
                            ...curr,
                            mouseSensitivity: Math.min(3.0, Math.round((curr.mouseSensitivity + 0.1) * 10) / 10)
                          }))
                        }
                        style={styles.stepperBtn}
                      >
                        <Text style={styles.stepperBtnText}>+</Text>
                      </TactileButton>
                    </View>
                  </View>

                  <View style={styles.groupedDivider} />

                  {/* Scroll Sensitivity */}
                  <View style={styles.groupedRow}>
                    <Text style={styles.groupedLabel}>Scroll Sensitivity</Text>
                    <View style={styles.stepperRow}>
                      <TactileButton
                        onPress={() =>
                          setDraftSettings((curr) => ({
                            ...curr,
                            scrollSensitivity: Math.max(0.5, Math.round((curr.scrollSensitivity - 0.1) * 10) / 10)
                          }))
                        }
                        style={styles.stepperBtn}
                      >
                        <Text style={styles.stepperBtnText}>−</Text>
                      </TactileButton>
                      <Text style={styles.stepperVal}>{draftSettings.scrollSensitivity.toFixed(1)}x</Text>
                      <TactileButton
                        onPress={() =>
                          setDraftSettings((curr) => ({
                            ...curr,
                            scrollSensitivity: Math.min(3.0, Math.round((curr.scrollSensitivity + 0.1) * 10) / 10)
                          }))
                        }
                        style={styles.stepperBtn}
                      >
                        <Text style={styles.stepperBtnText}>+</Text>
                      </TactileButton>
                    </View>
                  </View>

                  <View style={styles.groupedDivider} />

                  {/* Smooth Acceleration */}
                  <View style={styles.groupedRow}>
                    <Text style={styles.groupedLabel}>Smooth Acceleration</Text>
                    <Switch
                      value={draftSettings.smoothAcceleration}
                      onValueChange={(val) => setDraftSettings((curr) => ({ ...curr, smoothAcceleration: val }))}
                      trackColor={{ false: '#334155', true: '#0a84ff' }}
                      thumbColor="#ffffff"
                    />
                  </View>
                </View>
              </View>

              {/* GROUP: SUPPORT */}
              <View style={styles.modalSection}>
                <Text style={styles.sectionHeading}>Support</Text>
                <View style={styles.groupedContainer}>
                  <TactileButton
                    onPress={() => {
                      setSettingsOpen(false);
                      setBugModalOpen(true);
                    }}
                    style={styles.groupedActionRow}
                  >
                    <Text style={styles.groupedActionText}>Report a Bug</Text>
                    <Text style={styles.groupedChevron}>›</Text>
                  </TactileButton>
                </View>
              </View>

              {/* SAVE SETTINGS BUTTON */}
              <TactileButton
                onPress={() => {
                  setSettings(draftSettings);
                  setSettingsOpen(false);
                }}
                style={styles.primaryActionBtn}
              >
                <Text style={styles.primaryActionText}>Save Settings</Text>
              </TactileButton>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* REPORT A BUG / CONNECTION LOGS MODAL */}
      <Modal
        visible={bugModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setBugModalOpen(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheetContainer, { maxHeight: '88%' }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <View>
                <Text style={styles.sheetTitle}>Report a Bug</Text>
                <Text style={styles.sheetSubtitle}>Diagnostic & Connection Logs</Text>
              </View>
              <TactileButton onPress={() => setBugModalOpen(false)} style={styles.sheetCloseBtn}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TactileButton>
            </View>

            <View style={styles.logContainer}>
              <ScrollView contentContainerStyle={styles.logScrollContent}>
                {debugLogs.length === 0 ? (
                  <Text style={styles.logEmptyText}>No diagnostic logs captured yet.</Text>
                ) : (
                  debugLogs.map((entry) => (
                    <View key={entry.id} style={styles.logRow}>
                      <Text style={styles.logTime}>{entry.ts}</Text>
                      <Text
                        style={[
                          styles.logMsg,
                          entry.level === 'error'
                            ? styles.logMsgError
                            : entry.level === 'warn'
                              ? styles.logMsgWarn
                              : styles.logMsgInfo
                        ]}
                      >
                        {entry.level.toUpperCase()} {entry.message}
                      </Text>
                      {!!entry.details && <Text style={styles.logDetails}>{entry.details}</Text>}
                    </View>
                  ))
                )}
              </ScrollView>
            </View>

            <View style={styles.logFooterRow}>
              <TactileButton onPress={copyDebugLogs} style={styles.secondaryActionBtn}>
                <Text style={styles.secondaryActionText}>Copy Logs</Text>
              </TactileButton>
              <TactileButton onPress={() => setBugModalOpen(false)} style={styles.primaryActionBtnSmall}>
                <Text style={styles.primaryActionText}>Done</Text>
              </TactileButton>
            </View>
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#07090e'
  },
  safe: {
    flex: 1
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10
  },

  /* HEADER */
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 4
  },
  headerIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#131926',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  headerIconBtnActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.25)',
    borderColor: '#0a84ff'
  },
  headerIconText: {
    color: '#f8fafc',
    fontSize: 18
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6
  },
  statusDotGreen: {
    backgroundColor: '#34c759',
    shadowColor: '#34c759',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6
  },
  statusDotYellow: {
    backgroundColor: '#ff9500'
  },
  statusDotRed: {
    backgroundColor: '#ff3b30'
  },

  /* COMPACT VOLUME CONTROLS */
  volumeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    backgroundColor: '#121824',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  volumeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 6
  },
  volumeBtnIcon: {
    fontSize: 15
  },
  volumeBtnSign: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '600'
  },
  volumeDivider: {
    width: 1,
    height: '60%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },

  /* ERROR BANNER */
  errorBanner: {
    backgroundColor: 'rgba(255, 59, 48, 0.18)',
    borderWidth: 1,
    borderColor: '#ff3b30',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  errorBannerText: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '500'
  },

  /* MAIN TRACKPAD SURFACE */
  trackpadContainer: {
    flex: 1,
    minHeight: 260,
    borderRadius: 24,
    backgroundColor: '#0c111c',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
    position: 'relative'
  },
  trackpadSurface: {
    flex: 1,
    width: '100%',
    height: '100%'
  },
  trackpadInnerBorder: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 24,
    pointerEvents: 'none'
  },
  integratedScrollStrip: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 42,
    zIndex: 10,
    elevation: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255, 255, 255, 0.05)',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20
  },
  scrollChevron: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700'
  },
  scrollBarLine: {
    width: 2,
    height: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 1
  },

  /* CLICK BAR */
  clickBar: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: '#121824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  leftClickBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rightClickBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  clickDivider: {
    width: 1,
    height: '60%',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },
  clickIconIndicatorLeft: {
    width: 24,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#475569',
    borderLeftWidth: 3
  },
  clickIconIndicatorRight: {
    width: 24,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#475569',
    borderRightWidth: 3
  },

  /* BOTTOM DIRECTIONAL & KEYBOARD CONTROLS */
  bottomPadGrid: {
    flexDirection: 'row',
    height: 110,
    gap: 8
  },
  dPadLargeBtn: {
    flex: 1,
    backgroundColor: '#121824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4
  },
  dPadCenterCol: {
    flex: 1,
    backgroundColor: '#121824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  dPadHalfBtnTop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dPadHalfBtnBottom: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dPadCenterDivider: {
    height: 1,
    width: '70%',
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)'
  },
  dPadArrowText: {
    color: '#cbd5e1',
    fontSize: 18,
    fontWeight: '600'
  },
  dPadSubIcon: {
    color: '#64748b',
    fontSize: 13
  },

  tactilePressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)'
  },

  /* HIDDEN INPUT */
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
    bottom: -1000
  },

  /* MODALS / SHEETS */
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end'
  },
  sheetContainer: {
    backgroundColor: '#161b26',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)'
  },
  sheetHandle: {
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginBottom: 16
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  sheetTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4
  },
  sheetSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 2
  },
  sheetCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sheetCloseText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600'
  },
  sheetBody: {
    gap: 20,
    paddingBottom: 20
  },

  modalSection: {
    gap: 8
  },
  sectionHeading: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: 4
  },

  /* STATUS CARD */
  statusCard: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  statusStateText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600'
  },
  statusHostText: {
    color: '#94a3b8',
    fontSize: 14
  },
  disconnectBtn: {
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)'
  },
  disconnectBtnText: {
    color: '#ff6b6b',
    fontWeight: '600'
  },

  /* DISCOVERED PC LIST */
  emptyCard: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  emptyCardText: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center'
  },
  discoveredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  discoveredIpText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '600'
  },
  discoveredMetaText: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2
  },
  connectPill: {
    backgroundColor: '#0a84ff',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20
  },
  connectPillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600'
  },

  /* MANUAL ENTRY CARD */
  manualCard: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)'
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '500'
  },
  inputField: {
    backgroundColor: '#161b26',
    color: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  primaryActionBtn: {
    backgroundColor: '#0a84ff',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600'
  },

  /* GROUPED SETTINGS */
  groupedContainer: {
    backgroundColor: '#0d111a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden'
  },
  groupedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  groupedLabel: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '500'
  },
  groupedValue: {
    color: '#94a3b8',
    fontSize: 14
  },
  groupedDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginLeft: 16
  },
  groupedActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  groupedActionText: {
    color: '#0a84ff',
    fontSize: 15,
    fontWeight: '500'
  },
  groupedChevron: {
    color: '#64748b',
    fontSize: 18
  },

  /* STEPPERS */
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#161b26',
    borderRadius: 10,
    padding: 4
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#222b3d',
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepperBtnText: {
    color: '#0a84ff',
    fontSize: 18,
    fontWeight: '600'
  },
  stepperVal: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    minWidth: 32,
    textAlign: 'center'
  },

  /* DIAGNOSTIC LOGS */
  logContainer: {
    flex: 1,
    backgroundColor: '#090d14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 12,
    marginVertical: 12
  },
  logScrollContent: {
    gap: 8
  },
  logEmptyText: {
    color: '#64748b',
    fontSize: 14
  },
  logRow: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    paddingBottom: 6
  },
  logTime: {
    color: '#475569',
    fontSize: 11
  },
  logMsg: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2
  },
  logMsgInfo: {
    color: '#cbd5e1'
  },
  logMsgWarn: {
    color: '#ff9500'
  },
  logMsgError: {
    color: '#ff3b30'
  },
  logDetails: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2
  },
  logFooterRow: {
    flexDirection: 'row',
    gap: 12
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  secondaryActionText: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600'
  },
  primaryActionBtnSmall: {
    flex: 1,
    backgroundColor: '#0a84ff',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
