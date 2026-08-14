function clampNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeKey(key) {
  return String(key || '').trim().toLowerCase();
}

function createCommandRouter({ mouseController, state }) {
  if (!mouseController) {
    throw new Error('mouseController is required');
  }

  async function handleMove(payload) {
    const dx = clampNumber(payload.dx);
    const dy = clampNumber(payload.dy);
    const sensitivity = clampNumber(payload.sensitivity, 1);
    const smooth = Boolean(payload.smooth);

    const now = Date.now();
    const throttleMs = clampNumber(state.moveThrottleMs, 0);
    if (throttleMs > 0 && now - state.lastMoveAt < throttleMs) {
      return { ok: true, skipped: true };
    }
    state.lastMoveAt = now;

    await mouseController.moveRelative(dx * sensitivity, dy * sensitivity, {
      smooth
    });
    return { ok: true };
  }

  async function handleScroll(payload) {
    const delta = clampNumber(payload.delta);
    const sensitivity = clampNumber(payload.sensitivity, 1);
    await mouseController.scroll(delta * sensitivity);
    return { ok: true };
  }

  async function handleClick(payload) {
    await mouseController.click(String(payload.button || 'left'));
    return { ok: true };
  }

  async function handleDrag(payload) {
    const active = Boolean(payload.active);
    const button = String(payload.button || 'left');
    await mouseController.setDrag(active, button);
    return { ok: true };
  }

  async function handleKey(payload) {
    const key = normalizeKey(payload.key);
    if (!key) {
      throw new Error('Missing key payload');
    }
    await mouseController.pressKey(key);
    return { ok: true };
  }

  async function handleType(payload) {
    const text = String(payload.text || '');
    if (!text) {
      return { ok: true };
    }
    await mouseController.typeText(text);
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
