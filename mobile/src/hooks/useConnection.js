import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { DEFAULT_TARGET, DUMMY_BUFFER, toJson } from '../utils/constants';
import { safeParseLastTarget, safeSaveLastTarget } from '../services/storage';
import { detectLocalSubnetPrefixes, normalizeDiscoveredTarget, runUdpDiscovery } from '../services/discovery';

export function useConnection({ settings }) {
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [connectionStatus, setConnectionStatus] = useState('searching');
  const [connectedHost, setConnectedHost] = useState('');
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);
  const [bugModalOpen, setBugModalOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(DEFAULT_TARGET);
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
    packetGaps: [],
    maxGap: 0,
    lastPacketTime: 0,
    lastDiagAt: Date.now()
  });

  function flushPendingMove() {
    if (Math.abs(pendingMoveRef.current.x) > 0.0001 || Math.abs(pendingMoveRef.current.y) > 0.0001) {
      const moveX = pendingMoveRef.current.x;
      const moveY = pendingMoveRef.current.y;
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

    const scaledDx = dx * settings.mouseSensitivity;
    const scaledDy = dy * settings.mouseSensitivity;

    if (Math.abs(scaledDx) > 0.0001 || Math.abs(scaledDy) > 0.0001) {
      const sent = sendWs({
        type: 'move',
        dx: scaledDx,
        dy: scaledDy,
        sensitivity: 1,
        smooth: settings.smoothAcceleration
      });

      if (sent) {
        touchDiagRef.current.wsSent += 1;
        if (touchDiagRef.current.lastPacketTime > 0) {
          const gap = now - touchDiagRef.current.lastPacketTime;
          touchDiagRef.current.packetGaps.push(gap);
          if (gap > touchDiagRef.current.maxGap) {
            touchDiagRef.current.maxGap = gap;
          }
        }
        touchDiagRef.current.lastPacketTime = now;
      }
    }

    if (now - touchDiagRef.current.lastDiagAt >= 1000) {
      if (touchDiagRef.current.touchEvents > 0) {
        const gaps = touchDiagRef.current.packetGaps;
        const avgGap = gaps.length > 0 ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : '0.0';
        const maxGap = touchDiagRef.current.maxGap;

        addDebugLog(
          'diag',
          '[MOUSE-LATENCY]',
          `Touch events: ${touchDiagRef.current.touchEvents}/s | Move packets sent: ${touchDiagRef.current.wsSent}/s | Avg gap: ${avgGap}ms | Max gap: ${maxGap}ms`
        );
      }
      touchDiagRef.current = {
        touchEvents: 0,
        wsSent: 0,
        packetGaps: [],
        maxGap: 0,
        lastPacketTime: 0,
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

  function connectDiscovered(index) {
    const item = discovered[index];
    if (!item) return;
    setManualMode(true);
    setConnectionModalOpen(false);
    connectToServer(item);
  }

  function saveManual() {
    if (!manualDraft.ip) {
      setLastError('Enter a valid IP address.');
      addDebugLog('warn', 'Manual connect blocked', 'missing IP');
      return;
    }

    const manualTarget = {
      ip: manualDraft.ip.trim(),
      wsPort: manualDraft.wsPort ? manualDraft.wsPort.trim() : '41235',
      udpMovePort: manualDraft.udpMovePort ? manualDraft.udpMovePort.trim() : '41236',
      discoveryPort: manualDraft.discoveryPort ? manualDraft.discoveryPort.trim() : '41234'
    };

    setManualMode(true);
    setConnectionModalOpen(false);
    connectToServer(manualTarget);
  }

  function openConnectionModal() {
    setManualDraft(target.ip ? target : DEFAULT_TARGET);
    setConnectionModalOpen(true);
  }

  return {
    target,
    setTarget,
    connectionStatus,
    setConnectionStatus,
    connectedHost,
    connectionModalOpen,
    setConnectionModalOpen,
    bugModalOpen,
    setBugModalOpen,
    manualDraft,
    setManualDraft,
    discovered,
    manualMode,
    keyboardVisible,
    setKeyboardVisible,
    inputValue,
    lastError,
    debugLogs,
    addDebugLog,
    copyDebugLogs,
    connectToServer,
    connectDiscovered,
    disconnectSocket,
    saveManual,
    openConnectionModal,
    flushPendingMove,
    sendMove,
    sendClick,
    sendDrag,
    sendScroll,
    sendVolume,
    sendKey,
    handleHiddenKeyPress,
    handleTextChange,
    hiddenInputRef,
    pendingMoveRef,
    touchDiagRef
  };
}
