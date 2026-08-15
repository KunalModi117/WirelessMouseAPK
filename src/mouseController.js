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
  let accumulated = 0;

  return {
    add(delta) {
      const val = Number(delta) || 0;
      if (val === 0) return 0;

      if ((val > 0 && accumulated < 0) || (val < 0 && accumulated > 0)) {
        accumulated = 0;
      }

      accumulated += val;

      let ticks = 0;
      if (accumulated >= threshold) {
        ticks = Math.floor(accumulated / threshold);
        accumulated -= ticks * threshold;
      } else if (accumulated <= -threshold) {
        ticks = Math.ceil(accumulated / threshold);
        accumulated -= ticks * threshold;
      }

      return ticks;
    },
    reset() {
      accumulated = 0;
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
    async scroll(delta) {
      const ticks = scrollAccumulator.add(delta);
      if (ticks !== 0) {
        sendCmd(`S ${ticks}`);
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

  const pythonScript = `
import sys, ctypes

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
    'up': 'Up',
    'down': 'Down',
    'left': 'Left',
    'right': 'Right',
    'backspace': 'BackSpace',
    'enter': 'Return',
    'return': 'Return',
    'space': 'space',
    'tab': 'Tab',
    'escape': 'Escape',
    'esc': 'Escape',
    'delete': 'Delete',
    'del': 'Delete',
    'home': 'Home',
    'end': 'End',
    'pageup': 'Page_Up',
    'pagedown': 'Page_Down'
}

def send_key_event(key_str):
    if not display or not key_str:
        return False
    target = key_mapping.get(key_str.lower(), key_str)
    needs_shift = False
    if len(target) == 1 and target.isupper():
        needs_shift = True

    keysym = x11.XStringToKeysym(target.encode('utf-8'))
    if not keysym and len(target) == 1:
        keysym = ord(target)
    if not keysym:
        return False

    keycode = x11.XKeysymToKeycode(display, keysym)
    if not keycode:
        return False

    shift_keycode = x11.XKeysymToKeycode(display, x11.XStringToKeysym(b'Shift_L')) if needs_shift else 0
    if needs_shift and shift_keycode:
        xtst.XTestFakeKeyEvent(display, shift_keycode, True, 0)
    xtst.XTestFakeKeyEvent(display, keycode, True, 0)
    xtst.XTestFakeKeyEvent(display, keycode, False, 0)
    if needs_shift and shift_keycode:
        xtst.XTestFakeKeyEvent(display, shift_keycode, False, 0)
    x11.XFlush(display)
    return True

while True:
    line = sys.stdin.readline()
    if not line:
        break
    line_clean = line.rstrip('\\r\\n')
    if not line_clean:
        continue
    parts = line_clean.split(' ', 1)
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else ''

    if cmd == 'M' and display:
        m_parts = arg.split()
        if len(m_parts) >= 2:
            dx, dy = int(m_parts[0]), int(m_parts[1])
            x11.XWarpPointer(display, 0, 0, 0, 0, 0, 0, dx, dy)
            x11.XFlush(display)
    elif cmd == 'C' and display:
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
`;

  function initPythonWorker() {
    if (!isLinux || pythonChild) return;
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
    async scroll(delta) {
      if (!isLinux) return;
      const ticks = scrollAccumulator.add(delta);
      if (ticks === 0) return;
      if (!sendPythonCmd(`S ${ticks}`)) {
        const btn = ticks >= 0 ? '5' : '4';
        const amount = Math.abs(ticks);
        for (let i = 0; i < amount; i += 1) {
          execFile('xdotool', ['click', btn], (err) => {
            if (err) {
              console.warn('[mouse-linux] xdotool scroll failed:', err.message);
            }
          });
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
    async scroll(delta) {
      if (!isMac) return;
      const ticks = scrollAccumulator.add(delta);
      if (ticks === 0) return;
      const direction = ticks >= 0 ? 'down' : 'up';
      execFile('cliclick', [`s:${direction}:${Math.abs(ticks)}`], () => {});
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
    async scroll(delta) {
      const ticks = scrollAccumulator.add(delta);
      if (ticks === 0) return;
      const amount = Math.abs(ticks);
      if (ticks >= 0) {
        await mouse.scrollDown(amount);
        return;
      }
      await mouse.scrollUp(amount);
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
    async scroll(delta) {
      const ticks = scrollAccumulator.add(delta);
      if (ticks !== 0) {
        robot.scrollMouse(0, ticks);
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

  return createLinuxFallbackController();
}

module.exports = {
  createMouseController
};
