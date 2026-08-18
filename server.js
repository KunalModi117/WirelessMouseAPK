const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const dgram = require('dgram');

const { createMouseController } = require('./src/mouseController');
const { createCommandRouter } = require('./src/protocol');
const { attachWebSocketServer } = require('./src/simpleWebSocket');

const APP_NAME = 'WirelessMouseKeyboardRemote';
const VERSION = '0.1.0';

const PORTS = {
  http: Number(process.env.HTTP_PORT || 41235),
  udpMove: Number(process.env.UDP_MOVE_PORT || 41236),
  udpDiscovery: Number(process.env.UDP_DISCOVERY_PORT || 41234)
};

const DISCOVERY_INTERVAL_MS = Number(process.env.DISCOVERY_INTERVAL_MS || 2000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 3000);
const MOVE_THROTTLE_MS = Number(process.env.MOVE_THROTTLE_MS || 8);

const serverState = {
  startedAt: new Date().toISOString(),
  clients: new Set(),
  lastDiscoverySentAt: null,
  lastMoveAt: 0,
  moveThrottleMs: MOVE_THROTTLE_MS
};

function getConfigDir() {
  const home = os.homedir();
  const platform = os.platform();
  if (platform === 'win32') {
    return process.env.APPDATA || path.join(home, 'AppData', 'Roaming', 'wireless-mouse-remote');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'wireless-mouse-remote');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    return path.join(xdgConfig, 'wireless-mouse-remote');
  }
}

function getOrCreateDeviceId() {
  try {
    const configDir = getConfigDir();
    const filePath = path.join(configDir, 'device-id.json');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);
      if (data && data.deviceId) {
        return data.deviceId;
      }
    }
    fs.mkdirSync(configDir, { recursive: true });
    const newId = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    fs.writeFileSync(filePath, JSON.stringify({ deviceId: newId, createdAt: new Date().toISOString() }, null, 2), 'utf8');
    return newId;
  } catch (err) {
    console.warn('[device-id] failed to read/write config file, using fallback id:', err.message);
    return `device-fallback-${os.hostname()}`;
  }
}

function getPrimaryIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const entry of interfaces[name] || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return '127.0.0.1';
}

function createUdpDiscoveryServer(deviceId) {
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const raw = msg.toString('utf8').trim();
    console.log(`[DISCOVERY-SERVER] Request received: "${raw}" from ${rinfo.address}:${rinfo.port}`);

    const responsePayload = JSON.stringify({
      type: 'wifi-mouse-discovery',
      version: 1,
      deviceId: deviceId,
      name: os.hostname(),
      host: os.hostname(),
      platform: os.platform(),
      httpPort: PORTS.http,
      wsPort: PORTS.http
    });

    const buf = Buffer.from(responsePayload);
    socket.send(buf, 0, buf.length, rinfo.port, rinfo.address, (err) => {
      if (err) {
        console.warn(`[DISCOVERY-SERVER] Send error to ${rinfo.address}:${rinfo.port}:`, err.message);
      } else {
        console.log(`[DISCOVERY-SERVER] Response sent to ${rinfo.address}:${rinfo.port} | Device ID: ${deviceId} | Platform: ${os.platform()}`);
      }
    });
  });

  socket.on('error', (err) => {
    console.error('[DISCOVERY-SERVER] Listener error:', err.message);
  });

  socket.bind(PORTS.udpDiscovery, '0.0.0.0', () => {
    console.log(`[DISCOVERY-SERVER] UDP discovery server listening on 0.0.0.0:${PORTS.udpDiscovery}`);
  });

  return {
    close() {
      try { socket.close(); } catch (_) {}
    }
  };
}

function createUdpMoveListener(router) {
  const socket = dgram.createSocket('udp4');

  socket.on('message', async (msg, rinfo) => {
    try {
      const payload = JSON.parse(msg.toString('utf8'));
      await router.handle(payload, {
        transport: 'udp',
        remoteAddress: rinfo.address,
        remotePort: rinfo.port
      });
    } catch (error) {
      console.warn('[udp] invalid packet:', error.message);
    }
  });

  socket.on('error', (err) => {
    console.error('[udp] listener error:', err);
  });

  socket.bind(PORTS.udpMove, '0.0.0.0', () => {
    console.log(`[udp] listening on 0.0.0.0:${PORTS.udpMove}`);
  });

  return {
    close() {
      socket.close();
    }
  };
}

function createHeartbeat(ws, socketId) {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const interval = setInterval(() => {
    if (!ws.open) {
      clearInterval(interval);
      return;
    }
    if (!ws.isAlive) {
      console.warn(`[ws] terminating stale client ${socketId}`);
      ws.terminate();
      clearInterval(interval);
      return;
    }
    ws.isAlive = false;
    ws.ping();
  }, 15000);

  ws.on('close', () => clearInterval(interval));
  ws.on('error', () => clearInterval(interval));
}

async function main() {
  const deviceId = getOrCreateDeviceId();
  console.log(`[device] Stable Device ID: ${deviceId}`);

  const mouseController = createMouseController();
  console.log(`[mouse] Active controller backend: ${mouseController.backendName || 'Default'}`);

  const router = createCommandRouter({
    mouseController,
    state: serverState
  });

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        app: APP_NAME,
        version: VERSION,
        deviceId: deviceId,
        host: os.hostname(),
        platform: os.platform(),
        startedAt: serverState.startedAt,
        discoveryLastSentAt: serverState.lastDiscoverySentAt,
        clients: serverState.clients.size,
        httpPort: PORTS.http,
        wsPort: PORTS.http,
        udpMovePort: PORTS.udpMove,
        udpDiscoveryPort: PORTS.udpDiscovery
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      app: APP_NAME,
      version: VERSION,
      deviceId: deviceId,
      status: 'running',
      endpoints: {
        ws: `ws://${getPrimaryIPv4()}:${PORTS.http}`,
        udpDiscovery: PORTS.udpDiscovery,
        udpMove: PORTS.udpMove
      }
    }));
  });

  const discovery = createUdpDiscoveryServer(deviceId);
  const udpListener = createUdpMoveListener(router);

  attachWebSocketServer(httpServer, {
    onConnection(ws, req) {
    const socketId = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    serverState.clients.add(ws);
    console.log(`[ws] client connected: ${socketId}`);

    ws.send(JSON.stringify({
      type: 'welcome',
      app: APP_NAME,
      version: VERSION,
      deviceId: deviceId,
      serverIp: getPrimaryIPv4(),
      httpPort: PORTS.http,
      wsPort: PORTS.http,
      udpMovePort: PORTS.udpMove,
      udpDiscoveryPort: PORTS.udpDiscovery,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      host: os.hostname(),
      platform: os.platform()
    }));

    createHeartbeat(ws, socketId);

    ws.on('message', async (data) => {
      try {
        const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        const payload = JSON.parse(raw);
        await router.handle(payload, {
          transport: 'ws',
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
          socket: ws
        });
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message
        }));
      }
    });

    ws.on('close', () => {
      serverState.clients.delete(ws);
      console.log(`[ws] client disconnected: ${socketId}`);
    });
    }
  });

  httpServer.listen(PORTS.http, '0.0.0.0', () => {
    console.log(`[http] server listening on 0.0.0.0:${PORTS.http}`);
    console.log(`[http] local IP: ${getPrimaryIPv4()}`);
    console.log(`[http] health: http://${getPrimaryIPv4()}:${PORTS.http}/health`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    discovery.close();
    udpListener.close();
    for (const client of serverState.clients) {
      try {
        client.close();
      } catch (_) {
        // ignore close errors during shutdown
      }
    }
    await new Promise((resolve) => httpServer.close(resolve));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
