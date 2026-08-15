function clampNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SPECIAL_KEYS = new Set([
  'up', 'down', 'left', 'right',
  'backspace', 'enter', 'return', 'escape', 'esc',
  'space', 'tab', 'delete', 'del', 'home', 'end',
  'pageup', 'pagedown', 'shift', 'control', 'ctrl',
  'alt', 'meta', 'command', 'cmd'
]);

function normalizeKey(key) {
  const str = String(key || '').trim();
  if (!str) return '';
  const lower = str.toLowerCase();
  if (SPECIAL_KEYS.has(lower)) {
    return lower;
  }
  return str;
}

function createCommandRouter({ mouseController, state }) {
  if (!mouseController) {
    throw new Error('mouseController is required');
  }

  let pendingDx = 0;
  let pendingDy = 0;
  let diagServerMoves = 0;
  let diagTotalTimeMs = 0;
  let diagMaxTimeMs = 0;
  let diagLastTime = Date.now();

  async function handleMove(payload) {
    const startTime = performance.now();

    const dx = clampNumber(payload.dx);
    const dy = clampNumber(payload.dy);
    const sensitivity = clampNumber(payload.sensitivity, 1);
    const smooth = Boolean(payload.smooth);

    pendingDx += dx * sensitivity;
    pendingDy += dy * sensitivity;

    const moveX = pendingDx;
    const moveY = pendingDy;
    pendingDx = 0;
    pendingDy = 0;

    try {
      await mouseController.moveRelative(moveX, moveY, { smooth });
    } catch (err) {
      console.warn('[router] handleMove error:', err.message);
    }

    const elapsed = performance.now() - startTime;
    diagServerMoves += 1;
    diagTotalTimeMs += elapsed;
    if (elapsed > diagMaxTimeMs) {
      diagMaxTimeMs = elapsed;
    }

    const now = Date.now();
    if (now - diagLastTime >= 1000) {
      if (diagServerMoves > 0) {
        const stats = typeof mouseController.getDiagStats === 'function' ? mouseController.getDiagStats() : {};
        const avgMs = (diagTotalTimeMs / diagServerMoves).toFixed(2);
        const maxMs = diagMaxTimeMs.toFixed(2);

        const rec = stats.receivedMoves !== undefined ? stats.receivedMoves : (stats.recvMoves || diagServerMoves);
        const inj = stats.directInjected !== undefined ? stats.directInjected : (stats.injectedBatches || rec);
        const queue = stats.pendingQueue !== undefined ? stats.pendingQueue : (stats.maxQueue || 0);
        const totDx = stats.totalDx || 0;
        const totDy = stats.totalDy || 0;
        const backend = mouseController.backendName || 'Unknown';

        console.log(`[MOUSE-DIAG-SERVER] (${backend})
  Server received/sec: ${diagServerMoves}
  Direct X11 injected/sec: ${inj}
  Pending movement queue: ${queue}
  Total dx/dy injected: (${totDx}, ${totDy})
  Avg processing time: ${avgMs}ms
  Max processing time: ${maxMs}ms
`);
      }
      diagServerMoves = 0;
      diagTotalTimeMs = 0;
      diagMaxTimeMs = 0;
      diagLastTime = now;
    }

    return { ok: true };
  }

  async function handleScroll(payload) {
    const delta = clampNumber(payload.delta);
    const sensitivity = clampNumber(payload.sensitivity, 1);
    try {
      await mouseController.scroll(delta * sensitivity);
    } catch (err) {
      console.warn('[router] handleScroll error:', err.message);
    }
    return { ok: true };
  }

  async function handleClick(payload) {
    try {
      await mouseController.click(String(payload.button || 'left'));
    } catch (err) {
      console.warn('[router] handleClick error:', err.message);
    }
    return { ok: true };
  }

  async function handleDrag(payload) {
    const active = Boolean(payload.active);
    const button = String(payload.button || 'left');
    try {
      await mouseController.setDrag(active, button);
    } catch (err) {
      console.warn('[router] handleDrag error:', err.message);
    }
    return { ok: true };
  }

  async function handleKey(payload) {
    const key = normalizeKey(payload.key);
    if (!key) {
      throw new Error('Missing key payload');
    }
    try {
      await mouseController.pressKey(key);
    } catch (err) {
      console.warn('[router] handleKey error:', err.message);
    }
    return { ok: true };
  }

  async function handleType(payload) {
    const text = String(payload.text || '');
    if (!text) {
      return { ok: true };
    }
    try {
      await mouseController.typeText(text);
    } catch (err) {
      console.warn('[router] handleType error:', err.message);
    }
    return { ok: true };
  }

  async function handleVolume(payload) {
    const action = String(payload.action || 'up').toLowerCase();
    try {
      if (typeof mouseController.changeVolume === 'function') {
        await mouseController.changeVolume(action);
      } else {
        const key = action === 'up' ? 'volumeup' : 'volumedown';
        await mouseController.pressKey(key);
      }
    } catch (err) {
      console.warn('[router] handleVolume error:', err.message);
    }
    return { ok: true };
  }

  async function handle(payload, context = {}) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid packet');
    }

    const type = String(payload.type || '').toLowerCase();
    if (!type) {
      throw new Error('Packet type is required');
    }

    switch (type) {
      case 'move':
      case 'mousemove':
        return handleMove(payload, context);
      case 'scroll':
        return handleScroll(payload, context);
      case 'click':
        return handleClick(payload, context);
      case 'drag':
        return handleDrag(payload, context);
      case 'key':
      case 'keypress':
        return handleKey(payload, context);
      case 'type':
        return handleType(payload, context);
      case 'volume':
        return handleVolume(payload, context);
      case 'ping':
        if (context.socket && context.socket.open) {
          context.socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
        return { ok: true };
      case 'handshake':
        if (context.socket && context.socket.open) {
          context.socket.send(JSON.stringify({
            type: 'handshake-ack',
            serverTime: Date.now(),
            app: 'WirelessMouseKeyboardRemote'
          }));
        }
        return { ok: true };
      default:
        throw new Error(`Unsupported packet type: ${type}`);
    }
  }

  return { handle };
}

module.exports = {
  createCommandRouter
};
