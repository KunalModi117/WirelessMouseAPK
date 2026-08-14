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

function createWindowsFallbackController() {
  const isWindows = process.platform === 'win32';
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
    const normalized = String(key || '').trim().toLowerCase();
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
    if (normalized.length === 1) {
      return escapeSendKeys(normalized);
    }
    return escapeSendKeys(normalized);
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
      child.on('error', () => {
        child = null;
      });
    } catch (_) {
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
    async moveRelative(dx, dy) {
      sendCmd(`M ${Math.round(dx)} ${Math.round(dy)}`);
    },
    async scroll(delta) {
      sendCmd(`S ${Math.round(delta)}`);
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
    }
  };
}

function createLinuxFallbackController() {
  const isLinux = process.platform === 'linux';

  return {
    async moveRelative(dx, dy) {
      if (!isLinux) return;
      execFile('xdotool', ['mousemove_relative', '--', String(Math.round(dx)), String(Math.round(dy))], () => {});
    },
    async scroll(delta) {
      if (!isLinux) return;
      const btn = delta >= 0 ? '5' : '4';
      execFile('xdotool', ['click', btn], () => {});
    },
    async click(button) {
      if (!isLinux) return;
      const btn = String(button || 'left').toLowerCase() === 'right' ? '3' : '1';
      execFile('xdotool', ['click', btn], () => {});
    },
    async setDrag(active, button) {
      if (!isLinux) return;
      const btn = String(button || 'left').toLowerCase() === 'right' ? '3' : '1';
      const action = active ? 'mousedown' : 'mouseup';
      execFile('xdotool', [action, btn], () => {});
    },
    async pressKey(key) {
      if (!isLinux) return;
      execFile('xdotool', ['key', String(key)], () => {});
    },
    async typeText(text) {
      if (!isLinux) return;
      execFile('xdotool', ['type', '--', String(text)], () => {});
    }
  };
}

function resolveNutKey(key) {
  const normalized = String(key || '').trim().toLowerCase();
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

  if (normalized.length === 1) {
    return normalized.toUpperCase();
  }

  return normalized
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

function resolveRobotKey(key) {
  const normalized = String(key || '').trim().toLowerCase();
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
    return map[normalized];
  }

  return normalized;
}

function createNutController() {
  const { mouse, keyboard, Button, Key, Point } = nutJs;
  let dragActive = false;

  return {
    async moveRelative(dx, dy, options = {}) {
      const current = await mouse.getPosition();
      const target = new Point(Math.round(current.x + dx), Math.round(current.y + dy));
      if (options.smooth) {
        const steps = Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 12)));
        for (let i = 1; i <= steps; i += 1) {
          const stepPoint = new Point(
            Math.round(current.x + (dx * i) / steps),
            Math.round(current.y + (dy * i) / steps)
          );
          await mouse.setPosition(stepPoint);
        }
        return;
      }
      await mouse.setPosition(target);
    },
    async scroll(delta) {
      const amount = Math.max(1, Math.round(Math.abs(delta)));
      if (delta >= 0) {
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
    }
  };
}

function createRobotController() {
  const robot = robotjs;
  let dragActive = false;

  return {
    async moveRelative(dx, dy, options = {}) {
      if (options.smooth) {
        const steps = Math.max(1, Math.min(8, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 12)));
        const start = robot.getMousePos();
        for (let i = 1; i <= steps; i += 1) {
          const nextX = Math.round(start.x + (dx * i) / steps);
          const nextY = Math.round(start.y + (dy * i) / steps);
          robot.moveMouse(nextX, nextY);
        }
        return;
      }
      const pos = robot.getMousePos();
      robot.moveMouse(Math.round(pos.x + dx), Math.round(pos.y + dy));
    },
    async scroll(delta) {
      robot.scrollMouse(0, Math.round(delta));
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
      const normalized = resolveRobotKey(key);
      robot.keyTap(normalized);
    },
    async typeText(text) {
      robot.typeString(String(text));
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

  return createLinuxFallbackController();
}

module.exports = {
  createMouseController
};
