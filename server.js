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

function buildDiscoveryPayload() {
  return JSON.stringify({
    type: 'discover',
    app: APP_NAME,
    version: VERSION,
    host: os.hostname(),
    ip: getPrimaryIPv4(),
    httpPort: PORTS.http,
    udpMovePort: PORTS.udpMove,
    udpDiscoveryPort: PORTS.udpDiscovery,
    timestamp: Date.now()
  });
}

function createDiscoveryBroadcaster() {
  const socket = dgram.createSocket('udp4');
  socket.bind(() => {
    socket.setBroadcast(true);
  });

  const sendBroadcast = () => {
    const payload = Buffer.from(buildDiscoveryPayload());
    socket.send(payload, 0, payload.length, PORTS.udpDiscovery, '255.255.255.255', (err) => {
      serverState.lastDiscoverySentAt = new Date().toISOString();
      if (err) {
        console.warn('[discovery] broadcast failed:', err.message);
      }
    });
  };

  const interval = setInterval(sendBroadcast, DISCOVERY_INTERVAL_MS);
  sendBroadcast();

  return {
    close() {
      clearInterval(interval);
      socket.close();
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
  const mouseController = createMouseController();
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
        startedAt: serverState.startedAt,
        discoveryLastSentAt: serverState.lastDiscoverySentAt,
        clients: serverState.clients.size
      }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      app: APP_NAME,
      version: VERSION,
      status: 'running',
      endpoints: {
        ws: `ws://${getPrimaryIPv4()}:${PORTS.http}`,
        udpDiscovery: PORTS.udpDiscovery,
        udpMove: PORTS.udpMove
      }
    }));
  });

  const discovery = createDiscoveryBroadcaster();
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
      serverIp: getPrimaryIPv4(),
      httpPort: PORTS.http,
      udpMovePort: PORTS.udpMove,
      udpDiscoveryPort: PORTS.udpDiscovery,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS
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
