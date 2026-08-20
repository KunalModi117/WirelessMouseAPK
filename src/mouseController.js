const { execFile, spawn } = require('child_process');

let nutJs = null;
let robotjs = null;

function tryLoad(moduleName) {
  try {
    return require(moduleName);
  } catch (_) {
    return null;
  }
}

function createSubPixelAccumulator() {
  let accX = 0;
  let accY = 0;

  return {
    add(dx, dy) {
      accX += (Number(dx) || 0);
      accY += (Number(dy) || 0);

      const stepX = Math.trunc(accX);
      const stepY = Math.trunc(accY);

      accX -= stepX;
      accY -= stepY;

      return { stepX, stepY };
    },
    reset() {
      accX = 0;
      accY = 0;
    }
  };
}

function createScrollAccumulator(threshold = 10) {
  let accY = 0;
  let accX = 0;

  return {
    add(deltaY, deltaX = 0) {
      const valY = Number(deltaY) || 0;
      const valX = Number(deltaX) || 0;

      if ((valY > 0 && accY < 0) || (valY < 0 && accY > 0)) {
        accY = 0;
      }
      if ((valX > 0 && accX < 0) || (valX < 0 && accX > 0)) {
        accX = 0;
      }

      accY += valY;
      accX += valX;

      let ticksY = 0;
      let ticksX = 0;

      if (accY >= threshold) {
        ticksY = Math.floor(accY / threshold);
        accY -= ticksY * threshold;
      } else if (accY <= -threshold) {
        ticksY = Math.ceil(accY / threshold);
        accY -= ticksY * threshold;
      }

      if (accX >= threshold) {
        ticksX = Math.floor(accX / threshold);
        accX -= ticksX * threshold;
      } else if (accX <= -threshold) {
        ticksX = Math.ceil(accX / threshold);
        accX -= ticksX * threshold;
      }

      return { ticksY, ticksX };
    },
    reset() {
      accY = 0;
      accX = 0;
    }
  };
}

function createWindowsFallbackController() {
  const isWindows = process.platform === 'win32';
  const accumulator = createSubPixelAccumulator();
  const scrollAccumulator = createScrollAccumulator(10);
  let child = null;

  function escapeSendKeys(text) {
    return String(text)
      .replace(/\\/g, '{BACKSLASH}')
      .replace(/\+/g, '{PLUS}')
      .replace(/\^/g, '{CARET}')
      .replace(/%/g, '{PERCENT}')
      .replace(/~/g, '{TILDE}')
      .replace(/\(/g, '{(}')
      .replace(/\)/g, '{)}')
      .replace(/\{/g, '{{}')
      .replace(/\}/g, '{}}');
  }

  function mapKeyToSendKeys(key) {
    const str = String(key || '').trim();
    const normalized = str.toLowerCase();
    const map = {
      backspace: '{BACKSPACE}',
      enter: '{ENTER}',
      return: '{ENTER}',
      escape: '{ESC}',
      esc: '{ESC}',
      space: ' ',
      tab: '{TAB}',
      delete: '{DEL}',
      del: '{DEL}',
      home: '{HOME}',
      end: '{END}',
      pageup: '{PGUP}',
      pagedown: '{PGDN}',
      up: '{UP}',
      down: '{DOWN}',
      left: '{LEFT}',
      right: '{RIGHT}'
    };

    if (map[normalized]) {
      return map[normalized];
    }
    return escapeSendKeys(str);
  }

  const psScript = `
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;

public static class InputSim {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
Add-Type -AssemblyName System.Windows.Forms

while ($line = [Console]::ReadLine()) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $parts = $line.Split(' ')
    $cmd = $parts[0]
    switch ($cmd) {
        'M' {
            $dx = [int]$parts[1]
            $dy = [int]$parts[2]
            $p = New-Object InputSim+POINT
            [InputSim]::GetCursorPos([ref]$p) | Out-Null
            [InputSim]::SetCursorPos($p.X + $dx, $p.Y + $dy) | Out-Null
        }
        'C' {
            $btn = $parts[1]
            $down = if ($btn -eq 'right') { 0x0008 } else { 0x0002 }
            $up   = if ($btn -eq 'right') { 0x0010 } else { 0x0004 }
            [InputSim]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
            [InputSim]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
        }
        'S' {
            $delta = [int]$parts[1]
            $amount = [Math]::Max(1, [Math]::Abs($delta))
            $wheel = if ($delta -ge 0) { $amount * 120 } else { -$amount * 120 }
            [InputSim]::mouse_event(0x0800, 0, 0, [uint32]$wheel, [UIntPtr]::Zero)
        }
        'SH' {
            $delta = [int]$parts[1]
            $amount = [Math]::Max(1, [Math]::Abs($delta))
            $wheel = if ($delta -ge 0) { $amount * 120 } else { -$amount * 120 }
            [InputSim]::mouse_event(0x1000, 0, 0, [uint32]$wheel, [UIntPtr]::Zero)
        }
        'D' {
            $active = $parts[1] -eq '1'
            $btn = $parts[2]
            $flag = if ($btn -eq 'right') { if ($active) { 0x0008 } else { 0x0010 } } else { if ($active) { 0x0002 } else { 0x0004 } }
            [InputSim]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
        }
        'K' {
            $rawKey = $line.Substring(2)
            [System.Windows.Forms.SendKeys]::SendWait($rawKey)
        }
        'V' {
            $act = $parts[1]
            $w = New-Object -ComObject WScript.Shell
            if ($act -eq 'up') { $w.SendKeys([char]175) } else { $w.SendKeys([char]174) }
        }
    }
}
`;

  function initWorker() {
    if (!isWindows || child) return;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
        stdio: ['pipe', 'ignore', 'ignore']
      });
      child.on('exit', () => {
        child = null;
      });
      child.on('error', (err) => {
        console.warn('[mouse-win] PowerShell worker error:', err.message);
        child = null;
      });
    } catch (err) {
      console.warn('[mouse-win] Failed to spawn PowerShell worker:', err.message);
      child = null;
    }
  }

  function sendCmd(cmd) {
    if (!isWindows) return;
    if (!child) {
      initWorker();
    }
    if (child && child.stdin && child.stdin.writable) {
      try {
        child.stdin.write(cmd + '\n');
      } catch (_) {}
    }
  }

  if (isWindows) {
    initWorker();
  }

  return {
    backendName: 'Windows PowerShell Fallback',
    async moveRelative(dx, dy) {
      const { stepX, stepY } = accumulator.add(dx, dy);
      if (stepX !== 0 || stepY !== 0) {
        sendCmd(`M ${stepX} ${stepY}`);
      }
    },
    async scroll(deltaY, deltaX = 0) {
      const { ticksY, ticksX } = scrollAccumulator.add(deltaY, deltaX);
      if (ticksY !== 0) {
        sendCmd(`S ${ticksY}`);
      }
      if (ticksX !== 0) {
        sendCmd(`SH ${ticksX}`);
      }
    },
    async click(button) {
      sendCmd(`C ${String(button || 'left').toLowerCase()}`);
    },
    async setDrag(active, button) {
      sendCmd(`D ${active ? '1' : '0'} ${String(button || 'left').toLowerCase()}`);
    },
    async pressKey(key) {
      sendCmd(`K ${mapKeyToSendKeys(key)}`);
    },
    async typeText(text) {
      sendCmd(`K ${escapeSendKeys(text)}`);
    },
    async changeVolume(action) {
      sendCmd(`V ${String(action || 'up').toLowerCase()}`);
    }
  };
}

function createLinuxFallbackController() {
  const isLinux = process.platform === 'linux';
  const accumulator = createSubPixelAccumulator();
  const scrollAccumulator = createScrollAccumulator(10);
  let pythonChild = null;

  let pyDiagStats = { recvMoves: 0, injectedBatches: 0, maxQueue: 0, totalDx: 0, totalDy: 0, lastReceivedAt: 0 };

  const pythonScript = `
import sys, os, select, ctypes, time

x11 = None
xtst = None
display = None

try:
    x11 = ctypes.cdll.LoadLibrary('libX11.so.6')
    xtst = ctypes.cdll.LoadLibrary('libXtst.so.6')
    display = x11.XOpenDisplay(None)
except Exception:
    display = None

key_mapping = {
    'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
    'backspace': 'BackSpace', 'enter': 'Return', 'return': 'Return',
    'space': 'space', 'tab': 'Tab', 'escape': 'Escape', 'esc': 'Escape',
    'delete': 'Delete', 'del': 'Delete', 'home': 'Home', 'end': 'End',
    'pageup': 'Page_Up', 'pagedown': 'Page_Down'
}

def send_key_event(key_str):
    if not display or not key_str:
        return False
    target = key_mapping.get(key_str.lower(), key_str)
    needs_shift = len(target) == 1 and target.isupper()
    keysym = x11.XStringToKeysym(target.encode('utf-8'))
    if not keysym and len(target) == 1:
        keysym = ord(target)
    if not keysym:
        return False
    keycode = x11.XKeysymToKeycode(display, keysym)
    if not keycode:
        return False
    shift_kc = x11.XKeysymToKeycode(display, x11.XStringToKeysym(b'Shift_L')) if needs_shift else 0
    if needs_shift and shift_kc:
        xtst.XTestFakeKeyEvent(display, shift_kc, True, 0)
    xtst.XTestFakeKeyEvent(display, keycode, True, 0)
    xtst.XTestFakeKeyEvent(display, keycode, False, 0)
    if needs_shift and shift_kc:
        xtst.XTestFakeKeyEvent(display, shift_kc, False, 0)
    x11.XFlush(display)
    return True

stdin_fd = sys.stdin.fileno()
buffer = ""

diag_recv_moves = 0
diag_injected_batches = 0
diag_max_queue = 0
diag_total_dx = 0
diag_total_dy = 0
diag_last_time = time.time()

while True:
    try:
        chunk = os.read(stdin_fd, 8192).decode('utf-8', errors='ignore')
    except Exception:
        break
    if not chunk:
        break

    buffer += chunk
    if '\\n' not in buffer:
        continue

    lines = buffer.split('\\n')
    buffer = lines[-1]
    complete_lines = lines[:-1]

    batch_dx = 0
    batch_dy = 0
    batch_move_count = 0

    for line in complete_lines:
        line_clean = line.strip()
        if not line_clean:
            continue
        parts = line_clean.split(' ', 1)
        cmd = parts[0]
        arg = parts[1] if len(parts) > 1 else ''

        if cmd == 'M' and display:
            m_parts = arg.split()
            if len(m_parts) >= 2:
                dx, dy = int(m_parts[0]), int(m_parts[1])
                batch_dx += dx
                batch_dy += dy
                batch_move_count += 1
                diag_recv_moves += 1
                diag_total_dx += abs(dx)
                diag_total_dy += abs(dy)
        else:
            if batch_dx != 0 or batch_dy != 0:
                x11.XWarpPointer(display, 0, 0, 0, 0, 0, 0, batch_dx, batch_dy)
                x11.XFlush(display)
                diag_injected_batches += 1
                if batch_move_count > diag_max_queue:
                    diag_max_queue = batch_move_count
                batch_dx, batch_dy, batch_move_count = 0, 0, 0

            if cmd == 'C' and display:
                btn_name = arg.strip()
                btn = 3 if btn_name == 'right' else 1
                xtst.XTestFakeButtonEvent(display, btn, True, 0)
                xtst.XTestFakeButtonEvent(display, btn, False, 0)
                x11.XFlush(display)
            elif cmd == 'S' and display:
                delta = int(arg.strip())
                btn = 5 if delta >= 0 else 4
                amount = max(1, abs(delta))
                for _ in range(amount):
                    xtst.XTestFakeButtonEvent(display, btn, True, 0)
                    xtst.XTestFakeButtonEvent(display, btn, False, 0)
                x11.XFlush(display)
            elif cmd == 'SH' and display:
                delta = int(arg.strip())
                btn = 7 if delta >= 0 else 6
                amount = max(1, abs(delta))
                for _ in range(amount):
                    xtst.XTestFakeButtonEvent(display, btn, True, 0)
                    xtst.XTestFakeButtonEvent(display, btn, False, 0)
                x11.XFlush(display)
            elif cmd == 'D' and display:
                d_parts = arg.split()
                if len(d_parts) >= 2:
                    active = d_parts[0] == '1'
                    btn_name = d_parts[1]
                    btn = 3 if btn_name == 'right' else 1
                    xtst.XTestFakeButtonEvent(display, btn, active, 0)
                    x11.XFlush(display)
            elif cmd == 'K' and display:
                send_key_event(arg.strip())
            elif cmd == 'T' and display:
                for char in arg:
                    send_key_event(char)
            elif cmd == 'V' and display:
                act = arg.strip().lower()
                key_name = 'XF86AudioRaiseVolume' if act == 'up' else 'XF86AudioLowerVolume'
                send_key_event(key_name)

    if batch_dx != 0 or batch_dy != 0:
        x11.XWarpPointer(display, 0, 0, 0, 0, 0, 0, batch_dx, batch_dy)
        x11.XFlush(display)
        diag_injected_batches += 1
        if batch_move_count > diag_max_queue:
            diag_max_queue = batch_move_count
        batch_dx, batch_dy, batch_move_count = 0, 0, 0

    now = time.time()
    if now - diag_last_time >= 1.0:
        if diag_recv_moves > 0:
            sys.stdout.write(f"PDIAG {diag_recv_moves} {diag_injected_batches} {diag_max_queue} {diag_total_dx} {diag_total_dy}\\n")
            sys.stdout.flush()
        diag_recv_moves = 0
        diag_injected_batches = 0
        diag_max_queue = 0
        diag_total_dx = 0
        diag_total_dy = 0
        diag_last_time = now
`;

  function initPythonWorker() {
    if (!isLinux || pythonChild) return;
    try {
      pythonChild = spawn('python3', ['-u', '-c', pythonScript], {
        stdio: ['pipe', 'pipe', 'ignore']
      });
      pythonChild.stdout.on('data', (chunk) => {
        const lines = chunk.toString('utf8').split('\n');
        for (const l of lines) {
          if (l.startsWith('PDIAG')) {
            const parts = l.split(' ');
            if (parts.length >= 6) {
              pyDiagStats = {
                recvMoves: Number(parts[1]) || 0,
                injectedBatches: Number(parts[2]) || 0,
                maxQueue: Number(parts[3]) || 0,
                totalDx: Number(parts[4]) || 0,
                totalDy: Number(parts[5]) || 0,
                lastReceivedAt: Date.now()
              };
            }
          }
        }
      });
      pythonChild.on('exit', () => {
        pythonChild = null;
      });
      pythonChild.on('error', () => {
        pythonChild = null;
      });
    } catch (_) {
      pythonChild = null;
    }
  }

  function sendPythonCmd(cmd) {
    if (!isLinux) return false;
    if (!pythonChild) {
      initPythonWorker();
    }
    if (pythonChild && pythonChild.stdin && pythonChild.stdin.writable) {
      try {
        pythonChild.stdin.write(cmd + '\n');
        return true;
      } catch (_) {}
    }
    return false;
  }

  if (isLinux) {
    initPythonWorker();
  }

  return {
    backendName: 'Linux Python X11 / xdotool Fallback',
    getDiagStats() {
      return pyDiagStats;
    },
    async moveRelative(dx, dy) {
      if (!isLinux) return;
      const { stepX, stepY } = accumulator.add(dx, dy);
      if (stepX === 0 && stepY === 0) return;

      if (!sendPythonCmd(`M ${stepX} ${stepY}`)) {
        execFile('xdotool', ['mousemove_relative', '--', String(stepX), String(stepY)], (err) => {
          if (err) {
            console.warn('[mouse-linux] xdotool move failed:', err.message);
          }
        });
      }
    },
    async scroll(deltaY, deltaX = 0) {
      if (!isLinux) return;
      const { ticksY, ticksX } = scrollAccumulator.add(deltaY, deltaX);
      if (ticksY !== 0) {
        if (!sendPythonCmd(`S ${ticksY}`)) {
          const btn = ticksY >= 0 ? '5' : '4';
          const amount = Math.abs(ticksY);
          for (let i = 0; i < amount; i += 1) {
            execFile('xdotool', ['click', btn], (err) => {
              if (err) {
                console.warn('[mouse-linux] xdotool scroll failed:', err.message);
              }
            });
          }
        }
      }
      if (ticksX !== 0) {
        if (!sendPythonCmd(`SH ${ticksX}`)) {
          const btn = ticksX >= 0 ? '7' : '6';
          const amount = Math.abs(ticksX);
          for (let i = 0; i < amount; i += 1) {
            execFile('xdotool', ['click', btn], (err) => {
              if (err) {
                console.warn('[mouse-linux] xdotool scroll failed:', err.message);
              }
            });
          }
        }
      }
    },
    async click(button) {
      if (!isLinux) return;
      const btnName = String(button || 'left').toLowerCase();
      if (!sendPythonCmd(`C ${btnName}`)) {
        const btn = btnName === 'right' ? '3' : '1';
        execFile('xdotool', ['click', btn], (err) => {
          if (err) {
            console.warn('[mouse-linux] xdotool click failed:', err.message);
          }
        });
      }
    },
    async setDrag(active, button) {
      if (!isLinux) return;
      const btnName = String(button || 'left').toLowerCase();
      if (!sendPythonCmd(`D ${active ? '1' : '0'} ${btnName}`)) {
        const btn = btnName === 'right' ? '3' : '1';
        const action = active ? 'mousedown' : 'mouseup';
        execFile('xdotool', [action, btn], (err) => {
          if (err) {
            console.warn('[mouse-linux] xdotool drag failed:', err.message);
          }
        });
      }
    },
    async pressKey(key) {
      if (!isLinux) return;
      if (!sendPythonCmd(`K ${key}`)) {
        execFile('xdotool', ['key', String(key)], (err) => {
          if (err) {
            console.warn('[mouse-linux] xdotool key failed:', err.message);
          }
        });
      }
    },
    async typeText(text) {
      if (!isLinux) return;
      if (!sendPythonCmd(`T ${text}`)) {
        execFile('xdotool', ['type', '--', String(text)], (err) => {
          if (err) {
            console.warn('[mouse-linux] xdotool type failed:', err.message);
          }
        });
      }
    },
    async changeVolume(action) {
      if (!isLinux) return;
      const act = String(action || 'up').toLowerCase();
      if (!sendPythonCmd(`V ${act}`)) {
        const key = act === 'up' ? 'XF86AudioRaiseVolume' : 'XF86AudioLowerVolume';
        execFile('xdotool', ['key', key], (err) => {
          if (err) {
            const step = act === 'up' ? '+5%' : '-5%';
            execFile('pactl', ['set-sink-volume', '@DEFAULT_SINK@', step], () => {});
          }
        });
      }
    }
  };
}

function createMacFallbackController() {
  const isMac = process.platform === 'darwin';
  const accumulator = createSubPixelAccumulator();
  const scrollAccumulator = createScrollAccumulator(10);
  let pythonChild = null;

  const pythonScript = `
import sys, ctypes

cg = None
try:
    cg = ctypes.cdll.LoadLibrary('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
except Exception:
    cg = None

class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

while True:
    line = sys.stdin.readline()
    if not line:
        break
    parts = line.strip().split()
    if not parts:
        continue
    cmd = parts[0]
    if cmd == 'M' and cg:
        dx, dy = float(parts[1]), float(parts[2])
        # Get current pos
        evt = cg.CGEventCreate(None)
        cur = cg.CGEventGetLocation(evt)
        target = CGPoint(cur.x + dx, cur.y + dy)
        moveEvt = cg.CGEventCreateMouseEvent(None, 5, target, 0)
        cg.CGEventPost(0, moveEvt)
    elif cmd == 'C' and cg:
        btn_name = parts[1]
        evt = cg.CGEventCreate(None)
        cur = cg.CGEventGetLocation(evt)
        downType = 3 if btn_name == 'right' else 1
        upType = 4 if btn_name == 'right' else 2
        btnCode = 1 if btn_name == 'right' else 0
        dEvt = cg.CGEventCreateMouseEvent(None, downType, cur, btnCode)
        uEvt = cg.CGEventCreateMouseEvent(None, upType, cur, btnCode)
        cg.CGEventPost(0, dEvt)
        cg.CGEventPost(0, uEvt)
`;

  function initPythonWorker() {
    if (!isMac || pythonChild) return;
    try {
      pythonChild = spawn('python3', ['-u', '-c', pythonScript], {
        stdio: ['pipe', 'ignore', 'ignore']
      });
      pythonChild.on('exit', () => {
        pythonChild = null;
      });
      pythonChild.on('error', () => {
        pythonChild = null;
      });
    } catch (_) {
      pythonChild = null;
    }
  }

  function sendPythonCmd(cmd) {
    if (!isMac) return false;
    if (!pythonChild) {
      initPythonWorker();
    }
    if (pythonChild && pythonChild.stdin && pythonChild.stdin.writable) {
      try {
        pythonChild.stdin.write(cmd + '\n');
        return true;
      } catch (_) {}
    }
    return false;
  }

  if (isMac) {
    initPythonWorker();
  }

  return {
    backendName: 'macOS CoreGraphics / osascript Fallback',
    async moveRelative(dx, dy) {
      if (!isMac) return;
      const { stepX, stepY } = accumulator.add(dx, dy);
      if (stepX === 0 && stepY === 0) return;

      if (!sendPythonCmd(`M ${stepX} ${stepY}`)) {
        execFile('cliclick', [`m:+${stepX},+${stepY}`], (err) => {
          if (err) {
            console.warn('[mouse-mac] cliclick move failed:', err.message);
          }
        });
      }
    },
    async scroll(deltaY, deltaX = 0) {
      if (!isMac) return;
      const { ticksY, ticksX } = scrollAccumulator.add(deltaY, deltaX);
      if (ticksY !== 0) {
        const direction = ticksY >= 0 ? 'down' : 'up';
        execFile('cliclick', [`s:${direction}:${Math.abs(ticksY)}`], () => {});
      }
      if (ticksX !== 0) {
        const direction = ticksX >= 0 ? 'right' : 'left';
        execFile('cliclick', [`s:${direction}:${Math.abs(ticksX)}`], () => {});
      }
    },
    async click(button) {
      if (!isMac) return;
      const btnName = String(button || 'left').toLowerCase();
      if (!sendPythonCmd(`C ${btnName}`)) {
        const action = btnName === 'right' ? 'rc:.' : 'c:.';
        execFile('cliclick', [action], () => {});
      }
    },
    async setDrag(active, button) {
      if (!isMac) return;
      const btnName = String(button || 'left').toLowerCase();
      const action = active ? (btnName === 'right' ? 'dd:.' : 'dd:.') : (btnName === 'right' ? 'du:.' : 'du:.');
      execFile('cliclick', [action], () => {});
    },
    async pressKey(key) {
      if (!isMac) return;
      const str = String(key || '').trim();
      const normalized = str.toLowerCase();
      const macKeyCodes = {
        up: 126,
        down: 125,
        left: 123,
        right: 124,
        return: 36,
        enter: 36,
        backspace: 51,
        space: 49,
        tab: 48,
        escape: 53,
        esc: 53,
        delete: 117,
        home: 115,
        end: 119,
        pageup: 116,
        pagedown: 121
      };

      if (macKeyCodes[normalized]) {
        execFile('osascript', ['-e', `tell application "System Events" to key code ${macKeyCodes[normalized]}`], () => {});
      } else if (str.length > 0) {
        const escaped = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        execFile('osascript', ['-e', `tell application "System Events" to keystroke "${escaped}"`], () => {});
      }
    },
    async typeText(text) {
      if (!isMac) return;
      const escaped = String(text || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execFile('osascript', ['-e', `tell application "System Events" to keystroke "${escaped}"`], () => {});
    },
    async changeVolume(action) {
      if (!isMac) return;
      const act = String(action || 'up').toLowerCase();
      const script = act === 'up'
        ? 'set volume output volume ((output volume of (get volume settings)) + 5)'
        : 'set volume output volume ((output volume of (get volume settings)) - 5)';
      execFile('osascript', ['-e', script], () => {});
    }
  };
}

function resolveNutKey(key) {
  const str = String(key || '').trim();
  const normalized = str.toLowerCase();
  const map = {
    backspace: 'Backspace',
    enter: 'Enter',
    return: 'Return',
    escape: 'Escape',
    esc: 'Escape',
    space: 'Space',
    tab: 'Tab',
    delete: 'Delete',
    del: 'Delete',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    shift: 'LeftShift',
    control: 'LeftControl',
    ctrl: 'LeftControl',
    alt: 'LeftAlt',
    meta: 'LeftCmd',
    command: 'LeftCmd',
    cmd: 'LeftCmd'
  };

  if (map[normalized]) {
    return map[normalized];
  }

  if (str.length === 1) {
    return str;
  }

  return normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

function resolveRobotKey(key) {
  const str = String(key || '').trim();
  const normalized = str.toLowerCase();
  const map = {
    backspace: 'backspace',
    enter: 'enter',
    return: 'enter',
    escape: 'escape',
    esc: 'escape',
    space: 'space',
    tab: 'tab',
    delete: 'delete',
    del: 'delete',
    home: 'home',
    end: 'end',
    pageup: 'pageup',
    pagedown: 'pagedown',
    up: 'up',
    down: 'down',
    left: 'left',
    right: 'right',
    shift: 'shift',
    control: 'control',
    ctrl: 'control',
    alt: 'alt',
    meta: 'command',
    command: 'command',
    cmd: 'command'
  };

  if (map[normalized]) {
    return { key: map[normalized], modifier: [] };
  }

  if (str.length === 1 && str >= 'A' && str <= 'Z') {
    return { key: str.toLowerCase(), modifier: ['shift'] };
  }

  return { key: str, modifier: [] };
}

function createNutController() {
  const { mouse, keyboard, Button, Key, Point } = nutJs;
  const accumulator = createSubPixelAccumulator();
  const scrollAccumulator = createScrollAccumulator(10);
  let dragActive = false;

  return {
    backendName: 'NutJS (@nut-tree/nut-js)',
    async moveRelative(dx, dy, options = {}) {
      const { stepX, stepY } = accumulator.add(dx, dy);
      if (stepX === 0 && stepY === 0) return;

      const current = await mouse.getPosition();
      const target = new Point(current.x + stepX, current.y + stepY);
      if (options.smooth) {
        const steps = Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(stepX), Math.abs(stepY)) / 12)));
        for (let i = 1; i <= steps; i += 1) {
          const stepPoint = new Point(
            Math.round(current.x + (stepX * i) / steps),
            Math.round(current.y + (stepY * i) / steps)
          );
          await mouse.setPosition(stepPoint);
        }
        return;
      }
      await mouse.setPosition(target);
    },
    async scroll(deltaY, deltaX = 0) {
      const { ticksY, ticksX } = scrollAccumulator.add(deltaY, deltaX);
      if (ticksY !== 0) {
        const amount = Math.abs(ticksY);
        if (ticksY >= 0) await mouse.scrollDown(amount);
        else await mouse.scrollUp(amount);
      }
      if (ticksX !== 0) {
        const amount = Math.abs(ticksX);
        if (ticksX >= 0) await mouse.scrollRight(amount);
        else await mouse.scrollLeft(amount);
      }
    },
    async click(button) {
      const normalized = String(button || 'left').toLowerCase();
      if (normalized === 'right') {
        await mouse.click(Button.RIGHT);
        return;
      }
      await mouse.click(Button.LEFT);
    },
    async setDrag(active, button) {
      const normalized = String(button || 'left').toLowerCase();
      if (active && !dragActive) {
        dragActive = true;
        await mouse.pressButton(normalized === 'right' ? Button.RIGHT : Button.LEFT);
        return;
      }
      if (!active && dragActive) {
        dragActive = false;
        await mouse.releaseButton(normalized === 'right' ? Button.RIGHT : Button.LEFT);
      }
    },
    async pressKey(key) {
      const mappedName = resolveNutKey(key);
      const mapped = Key[mappedName] || mappedName;
      await keyboard.pressKey(mapped);
      await keyboard.releaseKey(mapped);
    },
    async typeText(text) {
      await keyboard.type(String(text));
    },
    async changeVolume(action) {
      const act = String(action || 'up').toLowerCase();
      const key = act === 'up' ? Key.AudioVolumeUp : Key.AudioVolumeDown;
      if (key) {
        await keyboard.pressKey(key);
        await keyboard.releaseKey(key);
      }
    }
  };
}

function createRobotController() {
  const robot = robotjs;
  const accumulator = createSubPixelAccumulator();
  const scrollAccumulator = createScrollAccumulator(10);
  let dragActive = false;

  return {
    backendName: 'RobotJS (robotjs)',
    async moveRelative(dx, dy, options = {}) {
      const { stepX, stepY } = accumulator.add(dx, dy);
      if (stepX === 0 && stepY === 0) return;

      if (options.smooth) {
        const steps = Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(stepX), Math.abs(stepY)) / 12)));
        const start = robot.getMousePos();
        for (let i = 1; i <= steps; i += 1) {
          const nextX = Math.round(start.x + (stepX * i) / steps);
          const nextY = Math.round(start.y + (stepY * i) / steps);
          robot.moveMouse(nextX, nextY);
        }
        return;
      }
      const pos = robot.getMousePos();
      robot.moveMouse(pos.x + stepX, pos.y + stepY);
    },
    async scroll(deltaY, deltaX = 0) {
      const { ticksY, ticksX } = scrollAccumulator.add(deltaY, deltaX);
      if (ticksY !== 0 || ticksX !== 0) {
        robot.scrollMouse(ticksX, ticksY);
      }
    },
    async click(button) {
      const normalized = String(button || 'left').toLowerCase();
      const resolved = normalized === 'right' ? 'right' : 'left';
      robot.mouseToggle('down', resolved);
      robot.mouseToggle('up', resolved);
    },
    async setDrag(active, button) {
      const normalized = String(button || 'left').toLowerCase();
      if (active && !dragActive) {
        dragActive = true;
        robot.mouseToggle('down', normalized === 'right' ? 'right' : 'left');
        return;
      }
      if (!active && dragActive) {
        dragActive = false;
        robot.mouseToggle('up', normalized === 'right' ? 'right' : 'left');
      }
    },
    async pressKey(key) {
      const resolved = resolveRobotKey(key);
      if (typeof resolved === 'object') {
        robot.keyTap(resolved.key, resolved.modifier);
      } else {
        robot.keyTap(resolved);
      }
    },
    async typeText(text) {
      robot.typeString(String(text));
    },
    async changeVolume(action) {
      const act = String(action || 'up').toLowerCase();
      const key = act === 'up' ? 'audio_vol_up' : 'audio_vol_down';
      robot.keyTap(key);
    }
  };
}

function createLinuxDirectController() {
  if (process.platform !== 'linux') return null;

  let display = null;
  let XWarpPointer = null;
  let XFlush = null;
  let XTestFakeButtonEvent = null;
  let XTestFakeKeyEvent = null;
  let XStringToKeysym = null;
  let XKeysymToKeycode = null;

  try {
    const koffi = require('koffi');
    const libX11 = koffi.load('libX11.so.6');
    const libXtst = koffi.load('libXtst.so.6');

    const XOpenDisplay = libX11.func('void *XOpenDisplay(const char *name)');
    XWarpPointer = libX11.func('int XWarpPointer(void *display, void *src_w, void *dest_w, int src_x, int src_y, uint src_width, uint src_height, int dest_x, int dest_y)');
    XFlush = libX11.func('int XFlush(void *display)');
    XStringToKeysym = libX11.func('ulong XStringToKeysym(const char *string)');
    XKeysymToKeycode = libX11.func('uint XKeysymToKeycode(void *display, ulong keysym)');

    XTestFakeButtonEvent = libXtst.func('int XTestFakeButtonEvent(void *display, uint button, bool is_press, ulong delay)');
    XTestFakeKeyEvent = libXtst.func('int XTestFakeKeyEvent(void *display, uint keycode, bool is_press, ulong delay)');

    display = XOpenDisplay(null);
  } catch (err) {
    console.warn('[mouse-linux-direct] Direct Koffi X11 binding failed to load:', err.message);
    display = null;
  }

  if (!display) {
    return null;
  }

  const accumulator = createSubPixelAccumulator();
  const scrollAccumulator = createScrollAccumulator(10);

  let directDiagStats = {
    receivedMoves: 0,
    directInjected: 0,
    pendingQueue: 0,
    totalDx: 0,
    totalDy: 0
  };

  const keyMapping = {
    'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
    'backspace': 'BackSpace', 'enter': 'Return', 'return': 'Return',
    'space': 'space', 'tab': 'Tab', 'escape': 'Escape', 'esc': 'Escape',
    'delete': 'Delete', 'del': 'Delete', 'home': 'Home', 'end': 'End',
    'pageup': 'Page_Up', 'pagedown': 'Page_Down'
  };

  function sendKeyEvent(keyStr) {
    if (!display || !keyStr) return false;
    const target = keyMapping[keyStr.toLowerCase()] || keyStr;
    const needsShift = target.length === 1 && target === target.toUpperCase() && target !== target.toLowerCase();
    const keysym = XStringToKeysym(target);
    if (!keysym) return false;
    const keycode = XKeysymToKeycode(display, keysym);
    if (!keycode) return false;

    const shiftKc = needsShift ? XKeysymToKeycode(display, XStringToKeysym('Shift_L')) : 0;
    if (needsShift && shiftKc) XTestFakeKeyEvent(display, shiftKc, true, 0);
    XTestFakeKeyEvent(display, keycode, true, 0);
    XTestFakeKeyEvent(display, keycode, false, 0);
    if (needsShift && shiftKc) XTestFakeKeyEvent(display, shiftKc, false, 0);
    XFlush(display);
    return true;
  }

  return {
    backendName: 'Linux Direct C-FFI X11 (Zero Latency)',
    isDirect: true,
    getDiagStats() {
      const stats = { ...directDiagStats };
      directDiagStats.receivedMoves = 0;
      directDiagStats.directInjected = 0;
      directDiagStats.pendingQueue = 0;
      directDiagStats.totalDx = 0;
      directDiagStats.totalDy = 0;
      return stats;
    },
    async moveRelative(dx, dy) {
      directDiagStats.receivedMoves += 1;
      const { stepX, stepY } = accumulator.add(dx, dy);
      if (stepX === 0 && stepY === 0) return;

      XWarpPointer(display, null, null, 0, 0, 0, 0, stepX, stepY);
      XFlush(display);

      directDiagStats.directInjected += 1;
      directDiagStats.totalDx += Math.abs(stepX);
      directDiagStats.totalDy += Math.abs(stepY);
      directDiagStats.pendingQueue = 0;
    },
    async scroll(deltaY, deltaX = 0) {
      const { ticksY, ticksX } = scrollAccumulator.add(deltaY, deltaX);
      if (ticksY !== 0) {
        const btn = ticksY >= 0 ? 5 : 4;
        const amount = Math.abs(ticksY);
        for (let i = 0; i < amount; i += 1) {
          XTestFakeButtonEvent(display, btn, true, 0);
          XTestFakeButtonEvent(display, btn, false, 0);
        }
      }
      if (ticksX !== 0) {
        const btn = ticksX >= 0 ? 7 : 6;
        const amount = Math.abs(ticksX);
        for (let i = 0; i < amount; i += 1) {
          XTestFakeButtonEvent(display, btn, true, 0);
          XTestFakeButtonEvent(display, btn, false, 0);
        }
      }
      if (ticksY !== 0 || ticksX !== 0) {
        XFlush(display);
      }
    },
    async click(button) {
      const normalized = String(button || 'left').toLowerCase();
      const btn = normalized === 'right' ? 3 : 1;
      XTestFakeButtonEvent(display, btn, true, 0);
      XTestFakeButtonEvent(display, btn, false, 0);
      XFlush(display);
    },
    async setDrag(active, button) {
      const normalized = String(button || 'left').toLowerCase();
      const btn = normalized === 'right' ? 3 : 1;
      XTestFakeButtonEvent(display, btn, Boolean(active), 0);
      XFlush(display);
    },
    async pressKey(key) {
      sendKeyEvent(key);
    },
    async typeText(text) {
      for (const char of String(text || '')) {
        sendKeyEvent(char);
      }
    },
    async changeVolume(action) {
      const act = String(action || 'up').toLowerCase();
      const keyName = act === 'up' ? 'XF86AudioRaiseVolume' : 'XF86AudioLowerVolume';
      sendKeyEvent(keyName);
    }
  };
}

function createMouseController() {
  nutJs = tryLoad('@nut-tree/nut-js');
  if (nutJs) {
    return createNutController();
  }

  robotjs = tryLoad('robotjs');
  if (robotjs) {
    return createRobotController();
  }

  if (process.platform === 'win32') {
    return createWindowsFallbackController();
  }

  if (process.platform === 'darwin') {
    return createMacFallbackController();
  }

  if (process.platform === 'linux') {
    const directController = createLinuxDirectController();
    if (directController) {
      return directController;
    }
    console.warn('[mouse] Direct Linux X11 binding unavailable, falling back to Python worker');
    return createLinuxFallbackController();
  }

  return createLinuxFallbackController();
}

module.exports = {
  createMouseController
};
