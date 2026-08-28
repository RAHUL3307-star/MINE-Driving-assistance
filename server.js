const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = 5173;
const DIR = __dirname;

// ═══════════════════════════════════════════════════════════════
// ESP32 CONNECTION CONFIG
// ═══════════════════════════════════════════════════════════════
const ESP32_IP = '192.168.4.1';
const ESP32_PORT = 3333;
const RECONNECT_INTERVAL = 3000; // Try reconnecting every 3 seconds

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let esp32Socket = null;
let esp32Connected = false;
let reconnectTimer = null;
let lastSensorData = null;
let lastDashboardData = null;
const wsClients = new Set();

// ═══════════════════════════════════════════════════════════════
// MIME TYPES
// ═══════════════════════════════════════════════════════════════
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// ═══════════════════════════════════════════════════════════════
// HTTP SERVER (Static Files)
// ═══════════════════════════════════════════════════════════════
const server = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];

  // API endpoint: ESP32 connection status & latest telemetry
  if (reqUrl === '/api/esp32/status' || reqUrl === '/api/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      connected: esp32Connected,
      ip: ESP32_IP,
      port: ESP32_PORT,
      lastSensor: lastSensorData,
      dashboard: lastDashboardData,
      timestamp: Date.now()
    }));
  }

  if (reqUrl === '/' || reqUrl === '') {
    reqUrl = '/landing.html';
  }

  const filePath = path.join(DIR, reqUrl);

  // Security check
  if (!filePath.startsWith(DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end(`File not found: ${reqUrl}`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET SERVER (Browser ↔ Bridge)
// ═══════════════════════════════════════════════════════════════
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('[WS] Browser client connected');
  wsClients.add(ws);

  // Send current ESP32 status immediately
  ws.send(JSON.stringify({
    type: 'status',
    connected: esp32Connected,
    ip: ESP32_IP
  }));

  // If we have cached sensor data, send it
  if (lastSensorData) {
    ws.send(JSON.stringify({
      type: 'sensor',
      data: lastSensorData
    }));
  }

  // Receive commands from browser
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === 'command' && msg.cmd) {
        const cmd = msg.cmd.toUpperCase();
        if (['F', 'B', 'L', 'R', 'S'].includes(cmd)) {
          sendToESP32(cmd);
          // Echo command back to all browser clients
          broadcastToClients({
            type: 'command_ack',
            cmd: cmd,
            timestamp: Date.now()
          });
        }
      }

      // Manual reconnect request
      if (msg.type === 'reconnect') {
        console.log('[WS] Manual reconnect requested');
        connectToESP32();
      }

    } catch (e) {
      // Plain text command fallback (single char)
      const cmd = message.toString().trim().toUpperCase();
      if (['F', 'B', 'L', 'R', 'S'].includes(cmd)) {
        sendToESP32(cmd);
      }
    }
  });

  ws.on('close', () => {
    console.log('[WS] Browser client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error('[WS] Client error:', err.message);
    wsClients.delete(ws);
  });
});

// Broadcast JSON message to all connected browser clients
function broadcastToClients(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(msg);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// TCP CLIENT (Bridge ↔ ESP32)
// ═══════════════════════════════════════════════════════════════
let tcpBuffer = '';

function connectToESP32() {
  // Clean up existing connection
  if (esp32Socket) {
    esp32Socket.removeAllListeners();
    esp32Socket.destroy();
    esp32Socket = null;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  console.log(`[TCP] Connecting to ESP32 at ${ESP32_IP}:${ESP32_PORT}...`);

  esp32Socket = new net.Socket();
  esp32Socket.setTimeout(5000);

  esp32Socket.connect(ESP32_PORT, ESP32_IP, () => {
    esp32Connected = true;
    tcpBuffer = '';
    console.log(`[TCP] ✅ Connected to ESP32!`);

    broadcastToClients({
      type: 'status',
      connected: true,
      ip: ESP32_IP
    });
  });

  // Receive data from ESP32 (sensor readings & telemetry stream)
  esp32Socket.on('data', (data) => {
    tcpBuffer += data.toString();

    // Process complete lines (terminated by \n)
    let lines = tcpBuffer.split('\n');
    tcpBuffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let dashboardData = null;
      let sensorData = null;

      // ── FORMAT 1: Direct JSON from ESP32 ("JSON:{...}" or pure "{...}") ──
      if (trimmed.startsWith('JSON:') || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        try {
          const jsonStr = trimmed.startsWith('JSON:') ? trimmed.substring(5) : trimmed;
          const parsed = JSON.parse(jsonStr);

          const vis = parsed.visibility !== undefined ? parseFloat(parsed.visibility) : (parsed.vis_pct !== undefined ? parseFloat(parsed.vis_pct) : 80);
          const dist = parsed.obstacle_distance !== undefined ? parseFloat(parsed.obstacle_distance) : (parsed.distance !== undefined ? parseFloat(parsed.distance) : 4.0);
          const spd = parsed.vehicle_speed !== undefined ? parseFloat(parsed.vehicle_speed) : (parsed.speed !== undefined ? parseFloat(parsed.speed) : 0);
          const score = parsed.risk_score !== undefined ? parseInt(parsed.risk_score) : 17;
          const level = parsed.risk_level || (score >= 80 ? 'CRITICAL' : score >= 55 ? 'HIGH' : score >= 35 ? 'WARNING' : 'SAFE');
          const brake = parsed.emergency_brake !== undefined ? Boolean(parsed.emergency_brake) : (level === 'CRITICAL');
          const ldr = parsed.ldr !== undefined ? parseInt(parsed.ldr) : 0;
          const visStr = parsed.vis_str || parsed.vis || (vis > 70 ? 'HIGH' : vis > 40 ? 'MED' : 'LOW');
          const brakingDist = parsed.braking_distance !== undefined ? parseFloat(parsed.braking_distance) : (1.2 + (spd * 0.18) + (1.0 - (vis / 100.0)) * 1.5);

          dashboardData = {
            operator_id: parsed.operator_id || 'ESP32-HARDWARE-NODE',
            vehicle_id: parsed.vehicle_id || 'MV-07',
            visibility: parseFloat(vis.toFixed(1)),
            obstacle_distance: parseFloat(dist.toFixed(2)),
            vehicle_speed: parseFloat(spd.toFixed(1)),
            braking_distance: parseFloat(brakingDist.toFixed(2)),
            risk_score: score,
            risk_level: level,
            emergency_brake: brake,
            ldr: ldr,
            vis_str: visStr,
            created_at: new Date().toISOString()
          };

          sensorData = {
            ldr: ldr,
            distance: dist,
            visibility: visStr,
            risk: level,
            risk_score: score,
            speed: spd,
            timestamp: Date.now()
          };
        } catch (e) {
          console.warn('[TCP] JSON parse error:', e.message);
        }
      }
      // ── FORMAT 2: Compact DATA:ldr,distance,visPercent,visStr,riskLevel,riskScore,speed,emergencyBrake ──
      else if (trimmed.startsWith('DATA:')) {
        const parts = trimmed.substring(5).split(',');
        if (parts.length >= 4) {
          const ldr = parseInt(parts[0]) || 0;
          let dist = parseFloat(parts[1]) || 4.0;
          // If distance was sent in cm (> 10), convert to meters
          if (dist > 10.0) dist = dist / 100.0;

          let visPct = 80.0;
          let visStr = 'HIGH';
          let riskLevel = 'SAFE';
          let riskScore = 17;
          let speed = 0.0;
          let emergencyBrake = false;

          if (parts.length >= 8) {
            visPct = parseFloat(parts[2]) || 80.0;
            visStr = parts[3] || 'HIGH';
            riskLevel = parts[4] || 'SAFE';
            riskScore = parseInt(parts[5]) || 17;
            speed = parseFloat(parts[6]) || 0.0;
            emergencyBrake = parts[7] === '1' || parts[7] === 'true';
          } else {
            visStr = parts[2] || 'HIGH';
            riskLevel = parts[3] || 'SAFE';
            // Compute visibility % from ldr
            if (ldr < 500) visPct = 100 - (ldr / 500) * 25;
            else if (ldr < 2000) visPct = 75 - ((ldr - 500) / 1500) * 35;
            else visPct = Math.max(5, 40 - ((ldr - 2000) / 2095) * 35);

            if (dist < 0.8 || (dist < 1.2 && visStr === 'LOW') || ldr > 3500) {
              riskLevel = 'CRITICAL'; riskScore = 85; emergencyBrake = true;
            } else if (dist < 1.8 || visStr === 'LOW' || ldr > 2000) {
              riskLevel = 'HIGH'; riskScore = 65;
            } else if (dist < 2.8 || visStr === 'MED') {
              riskLevel = 'WARNING'; riskScore = 38;
            } else {
              riskLevel = 'SAFE'; riskScore = 17;
            }
          }

          sensorData = {
            ldr: ldr,
            distance: dist,
            visibility: visStr,
            risk: riskLevel,
            timestamp: Date.now()
          };

          dashboardData = {
            operator_id: 'ESP32-HARDWARE-NODE',
            vehicle_id: 'MV-07',
            visibility: parseFloat(visPct.toFixed(1)),
            obstacle_distance: parseFloat(dist.toFixed(2)),
            vehicle_speed: parseFloat(speed.toFixed(1)),
            braking_distance: parseFloat((1.2 + (speed * 0.18) + (1.0 - (visPct / 100.0)) * 1.5).toFixed(2)),
            risk_score: riskScore,
            risk_level: riskLevel,
            emergency_brake: emergencyBrake,
            ldr: ldr,
            vis_str: visStr,
            created_at: new Date().toISOString()
          };
        }
      }
      // ── FORMAT 3: Raw Serial Diagnostic line: "LDR = 1840 | VIS = MED | RISK = MED | DIST = 1.62 m" ──
      else if (trimmed.includes('LDR =') || trimmed.includes('DIST =')) {
        const ldrMatch = trimmed.match(/LDR\s*=\s*(\d+)/i);
        const visMatch = trimmed.match(/VIS\s*=\s*([A-Z]+)/i);
        const riskMatch = trimmed.match(/RISK\s*=\s*([A-Z]+)/i);
        const distMatch = trimmed.match(/DIST\s*=\s*([\d\.]+)/i);

        if (ldrMatch || distMatch) {
          const ldr = ldrMatch ? parseInt(ldrMatch[1]) : 0;
          let dist = distMatch ? parseFloat(distMatch[1]) : 4.0;
          if (dist > 10.0) dist = dist / 100.0;
          const visStr = visMatch ? visMatch[1] : 'HIGH';
          const riskStr = riskMatch ? riskMatch[1] : 'SAFE';

          let visPct = 80.0;
          if (ldr < 500) visPct = 100 - (ldr / 500) * 25;
          else if (ldr < 2000) visPct = 75 - ((ldr - 500) / 1500) * 35;
          else visPct = Math.max(5, 40 - ((ldr - 2000) / 2095) * 35);

          let riskLevel = riskStr === 'MED' ? 'WARNING' : riskStr;
          let riskScore = 17;
          let emergencyBrake = false;
          if (dist < 0.8 || riskLevel === 'CRITICAL') {
            riskLevel = 'CRITICAL'; riskScore = 85; emergencyBrake = true;
          } else if (dist < 1.8 || riskLevel === 'HIGH') {
            riskLevel = 'HIGH'; riskScore = 65;
          } else if (dist < 2.8 || riskLevel === 'WARNING') {
            riskLevel = 'WARNING'; riskScore = 38;
          }

          sensorData = { ldr: ldr, distance: dist, visibility: visStr, risk: riskLevel, timestamp: Date.now() };
          dashboardData = {
            operator_id: 'ESP32-HARDWARE-NODE',
            vehicle_id: 'MV-07',
            visibility: parseFloat(visPct.toFixed(1)),
            obstacle_distance: parseFloat(dist.toFixed(2)),
            vehicle_speed: 0.0,
            braking_distance: parseFloat((1.2 + (1.0 - (visPct / 100.0)) * 1.5).toFixed(2)),
            risk_score: riskScore,
            risk_level: riskLevel,
            emergency_brake: emergencyBrake,
            ldr: ldr,
            vis_str: visStr,
            created_at: new Date().toISOString()
          };
        }
      }

      if (dashboardData) {
        lastSensorData = sensorData || dashboardData;
        lastDashboardData = dashboardData;

        // Broadcast directly to all browser WebSocket clients
        broadcastToClients({
          type: 'sensor',
          data: lastSensorData,
          dashboard: lastDashboardData
        });
      } else {
        // Forward as raw serial output
        broadcastToClients({
          type: 'serial',
          line: trimmed
        });
      }
    }
  });

  esp32Socket.on('timeout', () => {
    console.log('[TCP] Connection timeout');
    esp32Socket.destroy();
  });

  esp32Socket.on('error', (err) => {
    if (err.code === 'ECONNREFUSED') {
      console.log('[TCP] ESP32 not reachable (connection refused)');
    } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') {
      console.log('[TCP] ESP32 network not reachable — are you on HelloESP32 WiFi?');
    } else {
      console.log(`[TCP] Error: ${err.message}`);
    }
  });

  esp32Socket.on('close', () => {
    const wasConnected = esp32Connected;
    esp32Connected = false;
    esp32Socket = null;

    if (wasConnected) {
      console.log('[TCP] Disconnected from ESP32');
    }

    broadcastToClients({
      type: 'status',
      connected: false,
      ip: ESP32_IP
    });

    // Auto-reconnect after interval
    reconnectTimer = setTimeout(() => {
      connectToESP32();
    }, RECONNECT_INTERVAL);
  });
}

// Send a command character to ESP32
function sendToESP32(cmd) {
  if (esp32Socket && esp32Connected) {
    try {
      esp32Socket.write(cmd);
      console.log(`[TCP] Sent command: ${cmd}`);
    } catch (e) {
      console.error('[TCP] Send error:', e.message);
    }
  } else {
    console.log(`[TCP] Cannot send "${cmd}" — ESP32 not connected`);
  }
}

// ═══════════════════════════════════════════════════════════════
// START EVERYTHING
// ═══════════════════════════════════════════════════════════════
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  OREGUARD MINE VEHICLE — BRIDGE SERVER');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Dashboard:   http://localhost:${PORT}/landing.html`);
  console.log(`  Control:     http://localhost:${PORT}/index.html`);
  console.log(`  WebSocket:   ws://localhost:${PORT}/ws`);
  console.log(`  ESP32 TCP:   ${ESP32_IP}:${ESP32_PORT}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log('[BRIDGE] Attempting ESP32 connection...');
  console.log('[BRIDGE] Make sure your laptop is on "HelloESP32" WiFi!');
  console.log('');

  // Start trying to connect to ESP32
  connectToESP32();
});
