import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';

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
const DUMMY_BUFFER = '  ';

function toJson(payload) {
  return JSON.stringify(payload);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTouchCentroid(evt) {
  const touches = evt?.nativeEvent?.touches;
  if (!touches || touches.length === 0) {
    return null;
  }
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < touches.length; i += 1) {
    sumX += touches[i].pageX;
    sumY += touches[i].pageY;
  }
  return {
    x: sumX / touches.length,
    y: sumY / touches.length,
    count: touches.length
  };
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

function normalizeDiscoveredTarget(payload, fallbackAddress) {
  return {
    ip: payload.ip || fallbackAddress,
    wsPort: String(payload.httpPort || 41235),
    udpMovePort: String(payload.udpMovePort || 41236),
    discoveryPort: String(payload.udpDiscoveryPort || 41234)
  };
}

/**
 * Reusable Tactile Button following Apple design principles:
 * Instant touch-down feedback, critically damped scaling, and strong visual feedback.
 */
function TactileButton({ onPress, style, pressedStyle, children, activeOpacity = 0.8, scaleDown = 0.97 }) {
  return (
    <Pressable
      onPress={onPress}
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
  const queuedMessagesRef = useRef([]);
  const activeServerRef = useRef(null);
  const movedRef = useRef(false);
  const multiTouchRef = useRef(false);
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
      const saved = await safeParseSettings();
      if (mounted && saved) {
        setSettings(saved);
        setDraftSettings(saved);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(settings)).catch(() => {});
  }, [settings]);

  // Subnet Scanning HTTP Discovery for local Wi-Fi
  useEffect(() => {
    if (!discoveryEnabled || manualMode) {
      return;
    }
    let isCancelled = false;
    addDebugLog('info', 'Subnet scanning started', 'Scanning 41235/health on local subnets');

    const scanSubnets = async () => {
      const subnets = ['192.168.1', '192.168.0', '192.168.2', '10.0.0', '10.0.2'];
      const candidateIps = ['127.0.0.1', '10.0.2.2'];

      for (const prefix of subnets) {
        for (let i = 1; i <= 254; i++) {
          candidateIps.push(`${prefix}.${i}`);
        }
      }

      const foundList = [];
      const batchSize = 25;

      for (let i = 0; i < candidateIps.length; i += batchSize) {
        if (isCancelled) break;
        const batch = candidateIps.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (ip) => {
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 1200);
              const res = await fetch(`http://${ip}:41235/health`, {
                signal: controller.signal
              });
              clearTimeout(timer);
              if (res.ok) {
                const data = await res.json();
                if (data && data.app === 'WirelessMouseKeyboardRemote') {
                  const targetObj = normalizeDiscoveredTarget(data, ip);
                  if (!foundList.some((item) => item.ip === targetObj.ip)) {
                    foundList.push(targetObj);
                    if (!isCancelled) {
                      setDiscovered([...foundList]);
                      addDebugLog('info', 'Discovered PC server', `${targetObj.ip}:${targetObj.wsPort}`);
                    }
                  }
                }
              }
            } catch (_) {}
          })
        );
      }
    };

    scanSubnets();

    const interval = setInterval(scanSubnets, 10000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [discoveryEnabled, manualMode]);

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
      setConnectionStatus('connected');
      setConnectedHost(`${server.ip}:${server.wsPort}`);
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
          setConnectedHost(`${payload.serverIp || server.ip}:${payload.httpPort || server.wsPort}`);
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
      setLastError(`Unable to connect to ${wsUrl}`);
      addDebugLog('error', 'WebSocket error', event?.message || 'socket error');
    };

    socket.onclose = (event) => {
      if (connectionIdRef.current !== connectionId) {
        return;
      }
      stopReconnectLoop();
      setConnectionStatus('disconnected');
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

  function sendScroll(delta) {
    if (Math.abs(delta) > 0.1) {
      addDebugLog('info', 'Scroll', String(Math.round(delta)));
    }
    sendWs({
      type: 'scroll',
      delta,
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

  const lastTouchPosRef = useRef(null);
  const lastScrollYRef = useRef(null);

  const trackpadResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          movedRef.current = false;
          multiTouchRef.current = false;
          const centroid = getTouchCentroid(evt);
          lastTouchPosRef.current = centroid;
          if (centroid && centroid.count >= 2) {
            multiTouchRef.current = true;
          }
          pendingMoveRef.current = { x: 0, y: 0 };
        },
        onPanResponderMove: (evt, gestureState) => {
          const centroid = getTouchCentroid(evt);
          if (!centroid) {
            return;
          }

          if (centroid.count >= 2) {
            multiTouchRef.current = true;
          }

          if (!lastTouchPosRef.current || lastTouchPosRef.current.count !== centroid.count) {
            lastTouchPosRef.current = centroid;
            return;
          }

          const dx = centroid.x - lastTouchPosRef.current.x;
          const dy = centroid.y - lastTouchPosRef.current.y;
          lastTouchPosRef.current = centroid;

          if (multiTouchRef.current) {
            if (Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6) {
              movedRef.current = true;
            }
            if (Math.abs(dy) > 0.1) {
              sendScroll(-dy);
            }
            return;
          }

          if (Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4) {
            movedRef.current = true;
          }

          if (Math.abs(dx) + Math.abs(dy) > 0.1) {
            sendMove(dx, dy);
          } else {
            touchDiagRef.current.lost += 1;
          }
        },
        onPanResponderRelease: () => {
          flushPendingMove();
          lastTouchPosRef.current = null;
          if (!movedRef.current) {
            if (multiTouchRef.current) {
              sendClick('right');
            } else {
              sendClick('left');
            }
          }
        },
        onPanResponderTerminate: () => {
          flushPendingMove();
          lastTouchPosRef.current = null;
        }
      }),
    [settings.mouseSensitivity, settings.scrollSensitivity, settings.smoothAcceleration]
  );

  const scrollResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const touches = evt?.nativeEvent?.touches;
          lastScrollYRef.current = touches && touches[0] ? touches[0].pageY : null;
        },
        onPanResponderMove: (evt) => {
          const touches = evt?.nativeEvent?.touches;
          const currentY = touches && touches[0] ? touches[0].pageY : null;
          if (currentY === null || lastScrollYRef.current === null) {
            lastScrollYRef.current = currentY;
            return;
          }
          const delta = currentY - lastScrollYRef.current;
          lastScrollYRef.current = currentY;
          if (Math.abs(delta) > 0.1) {
            sendScroll(-delta);
          }
        },
        onPanResponderRelease: () => {
          lastScrollYRef.current = null;
        },
        onPanResponderTerminate: () => {
          lastScrollYRef.current = null;
        }
      }),
    [settings.scrollSensitivity]
  );

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
            <TactileButton onPress={() => sendClick('left')} style={styles.leftClickBtn}>
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
                      key={`${item.ip}:${item.wsPort}`}
                      onPress={() => connectDiscovered(index)}
                      style={styles.discoveredRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.discoveredIpText}>{item.ip}</Text>
                        <Text style={styles.discoveredMetaText}>WS {item.wsPort} | UDP {item.udpMovePort}</Text>
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
