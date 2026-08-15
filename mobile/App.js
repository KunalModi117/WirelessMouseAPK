import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Slider from '@react-native-community/slider';
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

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [connectionStatus, setConnectionStatus] = useState('searching');
  const [connectedHost, setConnectedHost] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(DEFAULT_TARGET);
  const [draftSettings, setDraftSettings] = useState(DEFAULT_SETTINGS);
  const [discovered, setDiscovered] = useState([]);
  const [manualMode, setManualMode] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [inputValue, setInputValue] = useState(DUMMY_BUFFER);
  const [lastError, setLastError] = useState('');
  const [debugOpen, setDebugOpen] = useState(false);
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
  const moveAccumulatorRef = useRef({ x: 0, y: 0 });
  const scrollAccumulatorRef = useRef(0);
  const movedRef = useRef(false);
  const multiTouchRef = useRef(false);
  const dragActiveRef = useRef(false);
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
        connectToServer({
          ip: target.ip,
          wsPort: target.wsPort,
          udpMovePort: target.udpMovePort,
          discoveryPort: target.discoveryPort
        }, true);
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

  const pendingMoveRef = useRef({ x: 0, y: 0 });
  const flushTimerRef = useRef(null);

  function flushPendingMove() {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (Math.abs(pendingMoveRef.current.x) > 0.001 || Math.abs(pendingMoveRef.current.y) > 0.001) {
      const moveX = pendingMoveRef.current.x;
      const moveY = pendingMoveRef.current.y;
      pendingMoveRef.current = { x: 0, y: 0 };
      const scaledDx = moveX * settings.mouseSensitivity;
      const scaledDy = moveY * settings.mouseSensitivity;
      sendWs({
        type: 'move',
        dx: scaledDx,
        dy: scaledDy,
        sensitivity: 1,
        smooth: settings.smoothAcceleration
      });
    }
  }

  function scheduleFlush() {
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushPendingMove();
      }, 8);
    }
  }

  function sendMove(dx, dy) {
    const server = activeServerRef.current || target;
    if (!server || !server.ip) {
      return;
    }

    pendingMoveRef.current.x += dx;
    pendingMoveRef.current.y += dy;

    const now = Date.now();
    if (now - lastMoveAtRef.current < 8) {
      scheduleFlush();
      return;
    }
    lastMoveAtRef.current = now;
    flushPendingMove();
  }

  function sendClick(button) {
    addDebugLog('info', 'Click', button);
    sendWs({ type: 'click', button });
  }

  function sendDrag(active) {
    addDebugLog('info', active ? 'Drag start' : 'Drag end');
    sendWs({ type: 'drag', active, button: 'left' });
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

  const trackpadResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          movedRef.current = false;
          multiTouchRef.current = false;
          const touches = evt.nativeEvent.touches ? evt.nativeEvent.touches.length : 1;
          if (touches >= 2) {
            multiTouchRef.current = true;
          }
          moveAccumulatorRef.current = { x: 0, y: 0 };
          scrollAccumulatorRef.current = 0;
          pendingMoveRef.current = { x: 0, y: 0 };
        },
        onPanResponderMove: (evt, gestureState) => {
          const touches = evt.nativeEvent.touches ? evt.nativeEvent.touches.length : gestureState.numberActiveTouches;
          if (touches >= 2) {
            multiTouchRef.current = true;
          }

          if (multiTouchRef.current) {
            const dy = gestureState.dy - scrollAccumulatorRef.current;
            scrollAccumulatorRef.current = gestureState.dy;
            if (Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6) {
              movedRef.current = true;
            }
            if (Math.abs(dy) > 0.1) {
              sendScroll(-dy);
            }
            return;
          }

          const dx = gestureState.dx - moveAccumulatorRef.current.x;
          const dy = gestureState.dy - moveAccumulatorRef.current.y;
          moveAccumulatorRef.current = { x: gestureState.dx, y: gestureState.dy };

          if (Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4) {
            movedRef.current = true;
          }

          if (Math.abs(dx) + Math.abs(dy) > 0.1) {
            sendMove(dx, dy);
          }
        },
        onPanResponderRelease: () => {
          flushPendingMove();
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
        }
      }),
    [settings.mouseSensitivity, settings.scrollSensitivity, settings.smoothAcceleration]
  );

  const scrollResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          scrollAccumulatorRef.current = 0;
        },
        onPanResponderMove: (_, gestureState) => {
          const delta = gestureState.dy - scrollAccumulatorRef.current;
          scrollAccumulatorRef.current = gestureState.dy;
          if (Math.abs(delta) > 0.1) {
            sendScroll(-delta);
          }
        },
        onPanResponderRelease: () => {
          scrollAccumulatorRef.current = 0;
        },
        onPanResponderTerminate: () => {
          scrollAccumulatorRef.current = 0;
        }
      }),
    [settings.scrollSensitivity]
  );

  function openManual() {
    setManualDraft(target.ip ? target : DEFAULT_TARGET);
    setManualOpen(true);
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
    setManualOpen(false);
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
    connectToServer(next);
  }

  function renderButton(label, onPress, styleType = 'primary') {
    return (
      <Pressable
        key={label}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          styleType === 'ghost' && styles.buttonGhost,
          pressed && styles.buttonPressed
        ]}
      >
        <Text style={[styles.buttonText, styleType === 'ghost' && styles.buttonTextGhost]}>{label}</Text>
      </Pressable>
    );
  }

  function openDebugPanel() {
    setDebugOpen(true);
    if (logsRef.current.length === 0) {
      addDebugLog('info', 'Diagnostics opened', 'No logs yet');
    }
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        <View style={styles.shell}>
          <View style={styles.topBar}>
            <View>
              <Text style={styles.title}>Wireless Remote</Text>
              <Text style={styles.subtitle}>
                {connectionStatus === 'connected'
                  ? `Connected to ${connectedHost}`
                  : connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : discoveryEnabled
                      ? 'Discovering PCs on local network'
                      : 'Manual connect mode'}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={openDebugPanel} style={({ pressed }) => [styles.bugButton, pressed && styles.buttonPressed]}>
                <Text style={styles.bugButtonText}>🐞</Text>
              </Pressable>
              <View style={styles.statusPillWrap}>
                <View
                  style={[
                    styles.statusDot,
                    connectionStatus === 'connected' ? styles.statusGreen : styles.statusRed
                  ]}
                />
                <Text style={styles.statusText}>{connectionStatus}</Text>
              </View>
            </View>
          </View>

          <View style={styles.volumeBar}>
            <Pressable
              onPress={() => sendVolume('down')}
              style={({ pressed }) => [styles.volumeButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.volumeButtonText}>🔉 Vol -</Text>
            </Pressable>
            <Pressable
              onPress={() => sendVolume('up')}
              style={({ pressed }) => [styles.volumeButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.volumeButtonText}>🔊 Vol +</Text>
            </Pressable>
          </View>

          {!!lastError && <Text style={styles.errorBanner}>{lastError}</Text>}

          <View style={styles.discoveryCard}>
            <View style={styles.discoveryHeader}>
              <Text style={styles.sectionLabel}>Discovered</Text>
              {renderButton('Manual', openManual, 'ghost')}
            </View>
            {discovered.length === 0 ? (
              <Text style={styles.hintText}>
                {discoveryEnabled
                  ? 'Waiting for the desktop server broadcast...'
                  : 'Discovery unavailable in this build. Enter the PC IP manually.'}
              </Text>
            ) : (
              discovered.map((item, index) => (
                <Pressable
                  key={`${item.ip}:${item.wsPort}`}
                  onPress={() => connectDiscovered(index)}
                  style={styles.discoveryItem}
                >
                  <Text style={styles.discoveryItemTitle}>{item.ip}</Text>
                  <Text style={styles.discoveryItemMeta}>WS {item.wsPort} | UDP {item.udpMovePort}</Text>
                </Pressable>
              ))
            )}
          </View>

          <View style={styles.trackpadRow}>
            <View style={styles.trackpadShell} {...trackpadResponder.panHandlers}>
              <Text style={styles.trackpadHint}>Trackpad: drag to move, tap to click</Text>
              <Text style={styles.trackpadSubhint}>Two fingers: tap for right click, drag to scroll</Text>
              <View style={styles.trackpadGlow} />
            </View>

            <View style={styles.scrollStrip} {...scrollResponder.panHandlers}>
              <Text style={styles.scrollStripLabel}>Scroll</Text>
            </View>
          </View>

          <View style={styles.bottomBar}>
            {renderButton('Left Click', () => sendClick('left'))}
            {renderButton('Right Click', () => sendClick('right'))}
          </View>

          <View style={styles.dPad}>
            <View style={styles.dPadRow}>
              {renderButton('↑', () => sendKey('Up'), 'ghost')}
            </View>
            <View style={styles.dPadRow}>
              {renderButton('←', () => sendKey('Left'), 'ghost')}
              {renderButton('↓', () => sendKey('Down'), 'ghost')}
              {renderButton('→', () => sendKey('Right'), 'ghost')}
            </View>
          </View>

          <View style={styles.footer}>
            {renderButton(keyboardVisible ? 'Hide Keyboard' : 'Keyboard', () => setKeyboardVisible((value) => !value))}
            {renderButton('Settings', () => {
              setDraftSettings(settings);
              setSettingsOpen(true);
            }, 'ghost')}
          </View>

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
              placeholder="Type here"
              placeholderTextColor="#94a3b8"
            />
          )}
        </View>
      </SafeAreaView>

      <Modal visible={manualOpen} animationType="slide" transparent onRequestClose={() => setManualOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Manual Connect</Text>
            <TextInput
              value={manualDraft.ip}
              onChangeText={(value) => setManualDraft((current) => ({ ...current, ip: value }))}
              placeholder="PC IP address"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              value={manualDraft.wsPort}
              onChangeText={(value) => setManualDraft((current) => ({ ...current, wsPort: value }))}
              placeholder="WebSocket Port"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              style={styles.input}
            />
            <TextInput
              value={manualDraft.udpMovePort}
              onChangeText={(value) => setManualDraft((current) => ({ ...current, udpMovePort: value }))}
              placeholder="UDP Move Port"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
              style={styles.input}
            />
            <View style={styles.modalActions}>
              {renderButton('Cancel', () => setManualOpen(false), 'ghost')}
              {renderButton('Connect', saveManual)}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={settingsOpen} animationType="fade" transparent onRequestClose={() => setSettingsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Settings</Text>
            <Text style={styles.sliderLabel}>Mouse sensitivity: {draftSettings.mouseSensitivity.toFixed(1)}x</Text>
            <Slider
              minimumValue={0.5}
              maximumValue={3}
              step={0.1}
              value={draftSettings.mouseSensitivity}
              onValueChange={(value) => setDraftSettings((current) => ({ ...current, mouseSensitivity: value }))}
              minimumTrackTintColor="#38bdf8"
              maximumTrackTintColor="#334155"
            />
            <Text style={styles.sliderLabel}>Scroll sensitivity: {draftSettings.scrollSensitivity.toFixed(1)}x</Text>
            <Slider
              minimumValue={0.5}
              maximumValue={3}
              step={0.1}
              value={draftSettings.scrollSensitivity}
              onValueChange={(value) => setDraftSettings((current) => ({ ...current, scrollSensitivity: value }))}
              minimumTrackTintColor="#38bdf8"
              maximumTrackTintColor="#334155"
            />
            <View style={styles.toggleRow}>
              <Text style={styles.sliderLabel}>Smooth acceleration</Text>
              <Switch
                value={draftSettings.smoothAcceleration}
                onValueChange={(value) => setDraftSettings((current) => ({ ...current, smoothAcceleration: value }))}
              />
            </View>
            <View style={styles.modalActions}>
              {renderButton('Close', () => setSettingsOpen(false), 'ghost')}
              {renderButton('Save', () => {
                setSettings(draftSettings);
                setSettingsOpen(false);
              })}
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={debugOpen} animationType="slide" transparent onRequestClose={() => setDebugOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, styles.debugCard]}>
            <View style={styles.debugHeader}>
              <Text style={styles.modalTitle}>Connection Logs</Text>
              <Text style={styles.debugCount}>{debugLogs.length} entries</Text>
            </View>
            <View style={styles.debugActions}>
              <Pressable onPress={copyDebugLogs} style={({ pressed }) => [styles.debugActionButton, pressed && styles.buttonPressed]}>
                <Text style={styles.debugActionText}>Copy Logs</Text>
              </Pressable>
              <Pressable onPress={() => setDebugOpen(false)} style={({ pressed }) => [styles.debugActionButton, styles.debugActionButtonGhost, pressed && styles.buttonPressed]}>
                <Text style={styles.debugActionText}>Close</Text>
              </Pressable>
            </View>
            <View style={styles.debugList}>
              {debugLogs.length === 0 ? (
                <Text style={styles.debugEmpty}>No logs yet. Tap connect again and come back here.</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {debugLogs.map((entry) => (
                    <View key={entry.id} style={styles.debugLogRow}>
                      <Text style={styles.debugLogTs}>{entry.ts}</Text>
                      <Text style={styles.debugLogMsg}>{entry.level.toUpperCase()} {entry.message}</Text>
                      {!!entry.details && <Text style={styles.debugLogDetails}>{entry.details}</Text>}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a'
  },
  safe: {
    flex: 1
  },
  shell: {
    flex: 1,
    padding: 16,
    gap: 14
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8
  },
  volumeBar: {
    flexDirection: 'row',
    gap: 12
  },
  volumeButton: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  volumeButtonText: {
    color: '#38bdf8',
    fontSize: 15,
    fontWeight: '700'
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '800'
  },
  subtitle: {
    color: '#94a3b8',
    marginTop: 4
  },
  statusPillWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5
  },
  statusGreen: {
    backgroundColor: '#22c55e'
  },
  statusRed: {
    backgroundColor: '#ef4444'
  },
  statusText: {
    color: '#e2e8f0',
    textTransform: 'capitalize'
  },
  bugButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#334155'
  },
  bugButtonText: {
    fontSize: 18
  },
  errorBanner: {
    color: '#fef2f2',
    backgroundColor: '#7f1d1d',
    padding: 10,
    borderRadius: 12
  },
  discoveryCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  discoveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  sectionLabel: {
    color: '#cbd5e1',
    fontWeight: '700',
    letterSpacing: 0.5
  },
  hintText: {
    color: '#64748b'
  },
  discoveryItem: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 12
  },
  discoveryItemTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700'
  },
  discoveryItemMeta: {
    color: '#94a3b8',
    marginTop: 2
  },
  trackpadShell: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: '#172554',
    borderWidth: 1,
    borderColor: '#1d4ed8',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 280
  },
  trackpadRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 280
  },
  trackpadHint: {
    color: '#bfdbfe',
    zIndex: 2
  },
  trackpadSubhint: {
    color: '#93c5fd',
    zIndex: 2,
    marginTop: 6,
    fontSize: 12
  },
  trackpadGlow: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(56, 189, 248, 0.18)'
  },
  scrollStrip: {
    width: 54,
    borderRadius: 24,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center'
  },
  scrollStripLabel: {
    color: '#cbd5e1',
    fontWeight: '700',
    transform: [{ rotate: '-90deg' }],
    letterSpacing: 0.5
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 12
  },
  dPad: {
    gap: 10
  },
  dPadRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center'
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12
  },
  button: {
    flex: 1,
    backgroundColor: '#38bdf8',
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonGhost: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155'
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }]
  },
  buttonText: {
    color: '#082f49',
    fontSize: 16,
    fontWeight: '800'
  },
  buttonTextGhost: {
    color: '#e2e8f0'
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    height: 1,
    width: 1,
    bottom: -1000
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.8)',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '800'
  },
  debugCard: {
    maxHeight: '85%'
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  debugCount: {
    color: '#94a3b8'
  },
  debugActions: {
    flexDirection: 'row',
    gap: 12
  },
  debugActionButton: {
    flex: 1,
    backgroundColor: '#38bdf8',
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center'
  },
  debugActionButtonGhost: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155'
  },
  debugActionText: {
    color: '#082f49',
    fontWeight: '800'
  },
  debugList: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#020617',
    padding: 12
  },
  debugEmpty: {
    color: '#64748b'
  },
  debugLogRow: {
    gap: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  debugLogTs: {
    color: '#64748b',
    fontSize: 11
  },
  debugLogMsg: {
    color: '#e2e8f0',
    fontWeight: '700'
  },
  debugLogDetails: {
    color: '#94a3b8'
  },
  input: {
    backgroundColor: '#111827',
    color: '#f8fafc',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12
  },
  sliderLabel: {
    color: '#cbd5e1',
    fontWeight: '600'
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  }
});
