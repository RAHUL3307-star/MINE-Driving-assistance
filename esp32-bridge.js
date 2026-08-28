/**
 * ═════════════════════════════════════════════════════════════════
 * OREGUARD — ESP32 WebSocket Bridge Client
 * ═════════════════════════════════════════════════════════════════
 * Connects browser to Node.js bridge server via WebSocket.
 * Sends joystick commands to ESP32, receives live sensor data.
 */

'use strict';

(function () {

  // ─────────────────────────────────────────────────────────────
  // CONFIG
  // ─────────────────────────────────────────────────────────────
  const WS_URL = `ws://${window.location.host}/ws`;
  const RECONNECT_DELAY = 2000;
  const HEARTBEAT_INTERVAL = 5000;

  // ─────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────
  let ws = null;
  let isConnected = false;
  let esp32Connected = false;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let currentCommand = 'S';
  let lastCommandTime = 0;

  // ─────────────────────────────────────────────────────────────
  // WEBSOCKET CONNECTION
  // ─────────────────────────────────────────────────────────────
  function connect() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.warn('[Bridge] WebSocket creation failed:', e.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      isConnected = true;
      console.log('[Bridge] ✅ Connected to bridge server');
      updateBridgeStatusUI('bridge-connected');

      // Start heartbeat
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(function () {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, HEARTBEAT_INTERVAL);
    };

    ws.onmessage = function (event) {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {

          case 'status':
            esp32Connected = msg.connected;
            if (msg.connected) {
              updateBridgeStatusUI('esp32-live');
              // Switch dashboard to hardware mode
              if (window.handleRemoteHardwareData && msg.connected) {
                console.log('[Bridge] ESP32 is live — hardware mode enabled');
              }
            } else {
              updateBridgeStatusUI('bridge-connected');
            }
            break;

          case 'sensor':
            // Feed real sensor data into the dashboard
            if (window.handleRemoteHardwareData) {
              window.handleRemoteHardwareData(msg.dashboard || msg.data);
            }
            // Update raw sensor display
            updateRawSensorUI(msg.data || msg.dashboard);
            break;

          case 'command_ack':
            currentCommand = msg.cmd;
            updateJoystickUI(msg.cmd);
            break;

          case 'serial':
            // Optional: log ESP32 serial output
            console.log('[ESP32]', msg.line);
            break;
        }
      } catch (e) {
        console.warn('[Bridge] Message parse error:', e);
      }
    };

    ws.onclose = function () {
      isConnected = false;
      esp32Connected = false;
      console.log('[Bridge] Disconnected from bridge server');
      updateBridgeStatusUI('disconnected');

      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      scheduleReconnect();
    };

    ws.onerror = function (err) {
      console.warn('[Bridge] WebSocket error');
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(function () {
      console.log('[Bridge] Reconnecting...');
      connect();
    }, RECONNECT_DELAY);
  }

  // ─────────────────────────────────────────────────────────────
  // SEND COMMANDS TO ESP32
  // ─────────────────────────────────────────────────────────────
  function sendCommand(cmd) {
    cmd = cmd.toUpperCase();
    if (!['F', 'B', 'L', 'R', 'S'].includes(cmd)) return;

    // Throttle: don't send same command more than every 80ms
    const now = Date.now();
    if (cmd === currentCommand && now - lastCommandTime < 80) return;

    currentCommand = cmd;
    lastCommandTime = now;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', cmd: cmd }));
    }

    updateJoystickUI(cmd);
  }

  function requestReconnect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'reconnect' }));
    }
  }

  // ─────────────────────────────────────────────────────────────
  // KEYBOARD CONTROLS (W/A/S/D + Arrow Keys)
  // ─────────────────────────────────────────────────────────────
  const keyMap = {
    'w': 'F', 'arrowup': 'F',
    's': 'B', 'arrowdown': 'B',
    'a': 'L', 'arrowleft': 'L',
    'd': 'R', 'arrowright': 'R',
    ' ': 'S'  // Spacebar = emergency stop
  };

  const keysDown = new Set();

  document.addEventListener('keydown', function (e) {
    const key = e.key.toLowerCase();
    if (keyMap[key] && !keysDown.has(key)) {
      keysDown.add(key);
      sendCommand(keyMap[key]);
      e.preventDefault();

      // Visual feedback on D-pad
      highlightDpadButton(keyMap[key], true);
    }
  });

  document.addEventListener('keyup', function (e) {
    const key = e.key.toLowerCase();
    if (keyMap[key]) {
      keysDown.delete(key);
      // If no keys held, stop
      if (keysDown.size === 0) {
        sendCommand('S');
      }
      e.preventDefault();
      highlightDpadButton(keyMap[key], false);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // UI UPDATES
  // ─────────────────────────────────────────────────────────────

  function updateBridgeStatusUI(status) {
    // Update the existing hardware badge
    const badge = document.getElementById('hwModeBadge');

    if (status === 'esp32-live') {
      if (typeof window.updateHardwareBadge === 'function') {
        // Not exposed — manually update
      }
      if (badge) {
        badge.style.background = '#052e16';
        badge.style.color = '#4ade80';
        badge.style.border = '1px solid #166534';
        badge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;animation:pulse 1s infinite"></span> LIVE HARDWARE · ESP32-MV07';
      }
    } else if (status === 'bridge-connected') {
      if (badge) {
        badge.style.background = '#1a1a2e';
        badge.style.color = '#60a5fa';
        badge.style.border = '1px solid #1e40af';
        badge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#60a5fa;display:inline-block;animation:pulse 2s infinite"></span> BRIDGE ONLINE · Waiting for ESP32...';
      }
    } else {
      if (badge) {
        badge.style.background = '#1c1f26';
        badge.style.color = '#94a3b8';
        badge.style.border = '1px solid #334155';
        badge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block"></span> SIMULATION MODE';
      }
    }

    // Update connection indicator in joystick panel
    const espDot = document.getElementById('espStatusDot');
    const espText = document.getElementById('espStatusText');
    if (espDot && espText) {
      if (status === 'esp32-live') {
        espDot.style.background = '#4ade80';
        espDot.style.boxShadow = '0 0 8px #4ade80';
        espText.textContent = 'ESP32 CONNECTED · 192.168.4.1';
      } else if (status === 'bridge-connected') {
        espDot.style.background = '#60a5fa';
        espDot.style.boxShadow = '0 0 8px #60a5fa';
        espText.textContent = 'Bridge Online · Searching ESP32...';
      } else {
        espDot.style.background = '#ef4444';
        espDot.style.boxShadow = '0 0 8px #ef4444';
        espText.textContent = 'Disconnected · Start server.js';
      }
    }
  }

  function updateJoystickUI(cmd) {
    const labels = { F: 'FWD', B: 'REV', L: 'LEFT', R: 'RIGHT', S: 'STOP' };
    const speeds = { F: '100%', B: '100%', L: '75%', R: '75%', S: '0%' };
    const widths = { F: '100%', B: '100%', L: '75%', R: '75%', S: '0%' };

    // Update the existing motor gauge in the dashboard
    const joyNum = document.getElementById('gaugeJoyNum');
    const joySpeed = document.getElementById('gaugeJoySpeed');
    const joyBar = document.getElementById('gaugeJoyBar');
    const joySub = document.getElementById('gaugeJoySub');

    if (joyNum) joyNum.textContent = labels[cmd] || 'STOP';
    if (joySpeed) joySpeed.textContent = ' ' + (speeds[cmd] || '0%');
    if (joyBar) joyBar.style.width = widths[cmd] || '0%';
    if (joySub) {
      if (esp32Connected) {
        joySub.textContent = cmd === 'S' ? 'Motors Idle · Hardware Live' : 'L298N Motors Active · Live';
      } else {
        joySub.textContent = 'Simulation Mode · No Hardware';
      }
    }

    // Update D-pad active state
    document.querySelectorAll('.dpad-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.cmd === cmd);
    });

    // Update current command display
    const cmdDisplay = document.getElementById('dpadCurrentCmd');
    if (cmdDisplay) {
      cmdDisplay.textContent = labels[cmd] || 'STOP';
      cmdDisplay.className = 'dpad-cmd ' + (cmd === 'S' ? 'cmd-stop' : 'cmd-active');
    }
  }

  function highlightDpadButton(cmd, pressed) {
    const btn = document.querySelector(`.dpad-btn[data-cmd="${cmd}"]`);
    if (btn) {
      btn.classList.toggle('pressed', pressed);
    }
  }

  function updateRawSensorUI(data) {
    if (!data) return;

    // Update sensor matrix values if elements exist
    const ldrEl = document.getElementById('sensorLdrValue');
    const distEl = document.getElementById('sensorDistValue');
    const visEl = document.getElementById('sensorVisValue');
    const riskEl = document.getElementById('sensorRiskValue');

    if (ldrEl && data.ldr !== undefined) ldrEl.textContent = data.ldr;
    if (distEl) {
      const d = data.obstacle_distance !== undefined ? data.obstacle_distance : data.distance;
      if (d !== undefined && d > 0) {
        distEl.textContent = d < 10 ? d.toFixed(2) + ' m' : d.toFixed(1) + ' cm';
      }
    }
    if (visEl) {
      visEl.textContent = data.vis_str || (typeof data.visibility === 'string' ? data.visibility : (data.visibility + '%'));
    }
    if (riskEl) riskEl.textContent = data.risk_level || data.risk || '--';
  }

  // Fallback HTTP polling if WebSocket is offline
  setInterval(async function () {
    if (isConnected) return; // WebSocket is already handling live data
    try {
      const res = await fetch('/api/telemetry');
      if (res.ok) {
        const payload = await res.json();
        if (payload.dashboard && window.handleRemoteHardwareData) {
          window.handleRemoteHardwareData(payload.dashboard);
          updateRawSensorUI(payload.dashboard);
        }
        if (payload.connected) {
          updateBridgeStatusUI('esp32-live');
        }
      }
    } catch (e) {}
  }, 2500);

  // ─────────────────────────────────────────────────────────────
  // EXPOSE GLOBAL API
  // ─────────────────────────────────────────────────────────────
  window.esp32Bridge = {
    sendCommand: sendCommand,
    reconnect: requestReconnect,
    isConnected: function () { return isConnected; },
    isESP32Live: function () { return esp32Connected; },
    getCurrentCommand: function () { return currentCommand; }
  };

  // ─────────────────────────────────────────────────────────────
  // INIT — Connect when DOM is ready
  // ─────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }

})();
