import { NativeModules } from 'react-native';

export function normalizeDiscoveredTarget(payload, fallbackAddress) {
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

export async function runUdpDiscovery(logFn) {
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

export async function detectLocalSubnetPrefixes(activeTargetIp = '', manualDraftIp = '') {
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
