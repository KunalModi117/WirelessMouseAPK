const crypto = require('crypto');
const { EventEmitter } = require('events');

function acceptKey(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(`${secWebSocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const length = data.length;
  let header;

  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 0x10000) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const fin = (byte1 & 0x80) !== 0;
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let length = byte2 & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const bigLength = buffer.readBigUInt64BE(offset + 2);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('WebSocket frame too large');
      }
      length = Number(bigLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (offset + frameLength > buffer.length) break;

    let payloadOffset = offset + headerLength;
    let payload = buffer.slice(payloadOffset + maskLength, payloadOffset + maskLength + length);

    if (masked) {
      const mask = buffer.slice(payloadOffset, payloadOffset + 4);
      const unmasked = Buffer.alloc(length);
      for (let i = 0; i < length; i += 1) {
        unmasked[i] = payload[i] ^ mask[i % 4];
      }
      payload = unmasked;
    }

    frames.push({ fin, opcode, payload });
    offset += frameLength;
  }

  return { frames, rest: buffer.slice(offset) };
}

class SimpleWebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this.alive = true;
    this.isAlive = true;
    this._buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => this._handleData(chunk));
    socket.on('close', () => this._closeFromSocket());
    socket.on('end', () => this._closeFromSocket());
    socket.on('error', (error) => this.emit('error', error));
  }

  _handleData(chunk) {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    let parsed;

    try {
      parsed = decodeFrames(this._buffer);
    } catch (error) {
      this.emit('error', error);
      this.terminate();
      return;
    }

    this._buffer = parsed.rest;
    for (const frame of parsed.frames) {
      switch (frame.opcode) {
        case 0x1:
          this.alive = true;
          this.isAlive = true;
          this.emit('message', frame.payload.toString('utf8'));
          break;
        case 0x8:
          this.close();
          break;
        case 0x9:
          this.pong(frame.payload);
          break;
        case 0xA:
          this.alive = true;
          this.isAlive = true;
          this.emit('pong');
          break;
        default:
          break;
      }
    }
  }

  _closeFromSocket() {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.emit('close');
  }

  send(text) {
    if (!this.open) {
      return;
    }
    this.socket.write(encodeFrame(text, 0x1));
  }

  ping(payload = '') {
    if (!this.open) {
      return;
    }
    this.socket.write(encodeFrame(payload, 0x9));
  }

  pong(payload = '') {
    if (!this.open) {
      return;
    }
    this.socket.write(encodeFrame(payload, 0xA));
  }

  close(code = 1000, reason = '') {
    if (!this.open) {
      return;
    }
    this.open = false;
    const reasonBuffer = Buffer.from(String(reason));
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    this.socket.write(encodeFrame(payload, 0x8), () => this.socket.end());
    this.emit('close');
  }

  terminate() {
    this.open = false;
    this.socket.destroy();
    this.emit('close');
  }
}

function attachWebSocketServer(httpServer, { onConnection } = {}) {
  httpServer.on('upgrade', (req, socket) => {
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    const connection = String(req.headers.connection || '').toLowerCase();
    const secWebSocketKey = req.headers['sec-websocket-key'];

    if (upgrade !== 'websocket' || !connection.includes('upgrade') || !secWebSocketKey) {
      socket.destroy();
      return;
    }

    const accept = acceptKey(secWebSocketKey);
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`
    ];
    socket.write(`${headers.join('\r\n')}\r\n\r\n`);

    const ws = new SimpleWebSocketConnection(socket);
    if (typeof onConnection === 'function') {
      onConnection(ws, req);
    }
  });
}

module.exports = {
  attachWebSocketServer,
  SimpleWebSocketConnection
};
