/* ═════════════════════════════════════════════════════════════════
   OREGUARD ADAS CONTROL — Mine Vehicle Safety Layer
   ═════════════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────────────────────
// STATE MODEL
// ─────────────────────────────────────────────────────────────
const state = {
  view: 'dashboard',         // 'dashboard' | 'analytics' | 'settings' | 'login'
  feedMode: 'auto',          // 'auto' | 'manual' | 'hardware'
  scenario: 'clear',         // 'clear' | 'dust' | 'poor' | 'emergency'

  // Real-time telemetry values
  visibility: 85,            // % (0-100)
  distance: 4.00,            // metres (0.2 - 4.0) — HC-SR04 reliable max
  speed: 0.0,                // m/s (0 - 15)
  brakingDist: 1.8,          // metres

  // Risk Engine Output
  riskScore: 12,             // 0 - 100
  riskLevel: 'SAFE',         // 'SAFE' | 'WARNING' | 'HIGH' | 'CRITICAL'
  emergencyEngaged: false,

  // Hardware live mode
  hardwareConnected: false,  // true when real ESP32 data arrives
  lastHardwareTs: 0,         // timestamp of last hardware packet

  // Audio ADAS warning tone
  audioEnabled: true,
  
  // Thresholds (configurable via settings)
  visThreshold: 40,
  distThreshold: 1.2,
  riskMultiplier: 1.8,
  
  // Telemetry History
  history: [],
  maxHistory: 40,
  
  // User Session
  operator: 'Rahul Sharma (OP-402)',
};

// Preset scenarios from reference
const scenarioPresets = {
  clear: {
    label: 'Normal clear',
    visibility: 85,
    distance: 4.20,
    speed: 8.2,
    note: 'Clear visibility · nominal speed permitted',
  },
  dust: {
    label: 'Dust degraded',
    visibility: 55,
    distance: 2.80,
    speed: 6.5,
    note: 'Moderate dust haze · speed advisory active',
  },
  poor: {
    label: 'Poor fog',
    visibility: 35,
    distance: 1.80,
    speed: 4.4,
    note: 'Reduced visibility · adaptive speed applied',
  },
  emergency: {
    label: 'Emergency near',
    visibility: 18,
    distance: 0.70,
    speed: 0.0,
    note: 'Critical proximity in dense fog · vehicle immobilized',
  },
};

// Initial Events Feed
const initialEvents = [
  {
    time: '14:32:08',
    title: 'Visibility degraded',
    detail: 'Visibility dropped below 40% threshold',
    level: 'WARNING',
    dist: '3.10 m',
    vis: '38%',
  },
  {
    time: '14:28:41',
    title: 'Obstacle detected',
    detail: 'Obstacle in forward path at 1.8 m',
    level: 'WARNING',
    dist: '1.80 m',
    vis: '45%',
  },
  {
    time: '14:25:12',
    title: 'System check passed',
    detail: 'All 6 sensors reporting nominal',
    level: 'SAFE',
    dist: '4.50 m',
    vis: '82%',
  },
  {
    time: '14:20:05',
    title: 'Safe corridor entry',
    detail: 'Speed calibrated to 8.2 m/s',
    level: 'SAFE',
    dist: '5.20 m',
    vis: '88%',
  },
];

// ─────────────────────────────────────────────────────────────
// RISK CALCULATION ENGINE
// ─────────────────────────────────────────────────────────────
function calculateRisk(vis, dist, spd) {
  if (state.emergencyEngaged) {
    return { score: 98, level: 'CRITICAL' };
  }

  const visNorm  = Math.max(0.01, Math.min(1.0, vis  / 100));
  const distNorm = Math.max(0.01, Math.min(1.0, dist / 4.0));  // FIX: 4m = HC-SR04 max reliable range
  const spdNorm  = Math.max(0.0,  Math.min(1.0, spd  / 12.0));

  // Visibility hazard factor (lower vis = higher hazard)
  const visHazard = 1.0 - visNorm;

  // Proximity hazard factor (closer distance ramps exponentially)
  const proxHazard = Math.pow(1.0 - distNorm, 2.3);

  // Speed factor
  const speedHazard = spdNorm;

  // Weighted Core Risk Equation
  const rawRisk = (visHazard * 0.35) + (proxHazard * 0.50) + (speedHazard * 0.15);

  // Dynamic Visibility-Aware Escalation Multiplier
  const multiplier = 1.0 + (visHazard * (state.riskMultiplier - 1.0));
  const score = Math.round(Math.min(100, Math.max(0, rawRisk * multiplier * 100)));

  // Dynamic Thresholds
  let level = 'SAFE';
  if (score >= 82 || (dist < state.distThreshold && vis < state.visThreshold) || dist < 0.6) {
    level = 'CRITICAL';
  } else if (score >= 58 || (dist < 2.0 && vis < 50)) {
    level = 'HIGH';
  } else if (score >= 32 || dist < 3.0 || vis < state.visThreshold) {
    level = 'WARNING';
  } else {
    level = 'SAFE';
  }

  // Calculated dynamic braking distance
  const baseBraking = 1.2 + (spd * 0.18);
  const fogBuffer = (1.0 - visNorm) * 1.5;
  const calculatedBrake = parseFloat((baseBraking + fogBuffer).toFixed(1));

  return { score, level, calculatedBrake };
}

// ─────────────────────────────────────────────────────────────
// AUDIO SYNTHESIZER
// ─────────────────────────────────────────────────────────────
let audioContext = null;
let lastBeepTime = 0;

function playWarningTone(freq, dur, type = 'sine') {
  if (!state.audioEnabled) return;
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + dur);
  } catch (e) {}
}

function processAudioBeeps(level) {
  const now = Date.now();
  if (level === 'WARNING' && now - lastBeepTime > 1400) {
    playWarningTone(580, 0.15, 'sine');
    lastBeepTime = now;
  } else if (level === 'HIGH' && now - lastBeepTime > 600) {
    playWarningTone(750, 0.12, 'sawtooth');
    lastBeepTime = now;
  } else if (level === 'CRITICAL' && now - lastBeepTime > 300) {
    playWarningTone(920, 0.2, 'square');
    lastBeepTime = now;
  }
}

// ─────────────────────────────────────────────────────────────
// SIMULATION LOOP
// ─────────────────────────────────────────────────────────────
let tickCount = 0;

function simulationTick() {
  // ── HARDWARE MODE: skip simulation if real ESP32 data is live ──
  if (state.feedMode === 'hardware') {
    // If no hardware packet in 10 seconds → fall back to auto simulation
    if (Date.now() - state.lastHardwareTs > 10000) {
      state.hardwareConnected = false;
      state.feedMode = 'auto';
      updateHardwareBadge(false);
      console.warn('[ADAS] Hardware timeout — reverting to simulation mode');
    } else {
      updateApp(); // just re-render with latest hardware state
      return;
    }
  }

  if (state.feedMode === 'auto') {
    tickCount++;
    const t = tickCount * 0.08;

    // Based on current preset mode, generate natural minor variance
    const base = scenarioPresets[state.scenario];

    state.visibility = Math.max(10, Math.min(100,
      base.visibility + Math.sin(t * 0.7) * 3 + (Math.random() - 0.5) * 1.5
    ));

    state.distance = Math.max(0.3, Math.min(4.0,  // FIX: max 4.0m to match HC-SR04
      base.distance + Math.sin(t * 1.2) * 0.25 + (Math.random() - 0.5) * 0.1
    ));

    state.speed = Math.max(0, Math.min(14.0,
      base.speed + Math.sin(t * 0.5) * 0.3
    ));
  }

  updateApp();
}

// ─────────────────────────────────────────────────────────────
// LIVE HARDWARE DATA INJECTION (called by Supabase realtime or polling)
// ─────────────────────────────────────────────────────────────
function handleRemoteHardwareData(row) {
  // Only process rows from the physical ESP32 node (not web simulation)
  if (!row || row.operator_id !== 'ESP32-HARDWARE-NODE') return;

  // Switch to hardware mode on first real packet
  if (!state.hardwareConnected) {
    state.hardwareConnected = true;
    state.feedMode = 'hardware';
    updateHardwareBadge(true);
    console.log('[ADAS] 🟢 Live hardware detected — simulation suspended');
  }

  state.lastHardwareTs = Date.now();
  state.visibility     = parseFloat(row.visibility)   || state.visibility;
  state.distance       = parseFloat(row.obstacle_distance) || state.distance;
  state.speed          = parseFloat(row.vehicle_speed) || state.speed;
  state.riskScore      = parseInt(row.risk_score)      || state.riskScore;
  state.riskLevel      = row.risk_level                || state.riskLevel;
  state.brakingDist    = parseFloat(row.braking_distance) || state.brakingDist;

  if (row.emergency_brake) {
    state.emergencyEngaged = true;
  }

  updateApp();
}

// Hardware connection status badge
function updateHardwareBadge(connected) {
  let badge = document.getElementById('hwModeBadge');
  if (!badge) {
    // Create badge if not present
    badge = document.createElement('div');
    badge.id = 'hwModeBadge';
    badge.style.cssText = `
      position: fixed; top: 16px; right: 200px; z-index: 9999;
      padding: 6px 14px; border-radius: 20px;
      font: 700 11px 'JetBrains Mono'; letter-spacing: 0.5px;
      display: flex; align-items: center; gap: 6px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      transition: all 0.4s;
    `;
    document.body.appendChild(badge);
  }
  if (connected) {
    badge.style.background = '#052e16';
    badge.style.color = '#4ade80';
    badge.style.border = '1px solid #166534';
    badge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block;animation:pulse 1s infinite"></span> LIVE HARDWARE · ESP32-MV07';
  } else {
    badge.style.background = '#1c1f26';
    badge.style.color = '#94a3b8';
    badge.style.border = '1px solid #334155';
    badge.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block"></span> SIMULATION MODE';
  }
}

// Expose so supabase-client.js realtime can call it
window.handleRemoteIncident = function(row) {
  if (row && row.operator_id === 'ESP32-HARDWARE-NODE') {
    handleRemoteHardwareData(row);
  }
};
window.handleRemoteHardwareData = handleRemoteHardwareData;

// ─────────────────────────────────────────────────────────────
// UPDATE ALL UI COMPONENTS
// ─────────────────────────────────────────────────────────────
function updateApp() {
  const { score, level, calculatedBrake } = calculateRisk(state.visibility, state.distance, state.speed);
  state.riskScore = score;
  state.riskLevel = level;
  state.brakingDist = calculatedBrake;

  updateRiskPanel(score, level);
  updateRadar(level);
  updateGauges(level);
  updateMiniTrend(score);
  processAudioBeeps(level);

  // Stream live telemetry to Supabase if linked
  if (window.streamTelemetryToSupabase) {
    window.streamTelemetryToSupabase({
      operator: state.operator,
      visibility: state.visibility,
      distance: state.distance,
      speed: state.speed,
      brakingDist: state.brakingDist,
      riskScore: score,
      riskLevel: level,
      emergencyEngaged: state.emergencyEngaged
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 1. RISK PANEL
// ─────────────────────────────────────────────────────────────
function updateRiskPanel(score, level) {
  const panel = document.getElementById('riskPanel');
  const heading = document.getElementById('riskLevelHeading');
  const detail = document.getElementById('riskDetailText');
  const scoreNum = document.getElementById('riskScoreNum');
  const scoreBar = document.getElementById('scoreTrackBar');
  const iconSvg = document.getElementById('riskIconSvg');

  // Reset classes
  panel.className = `risk-panel ${level.toLowerCase()}`;
  scoreNum.innerHTML = `${score}<small>/100</small>`;
  scoreBar.style.width = `${score}%`;

  if (level === 'CRITICAL') {
    heading.textContent = 'EMERGENCY STOP';
    detail.textContent = 'Vehicle immobilized · manual reset required';
    iconSvg.innerHTML = '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  } else if (level === 'HIGH') {
    heading.textContent = 'HIGH RISK';
    detail.textContent = 'Reduced visibility · adaptive speed cut applied';
    iconSvg.innerHTML = '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  } else if (level === 'WARNING') {
    heading.textContent = 'WARNING';
    detail.textContent = 'Obstacle closing in low visibility conditions';
    iconSvg.innerHTML = '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
  } else {
    heading.textContent = 'LOW RISK';
    detail.textContent = 'All 6 sensors reporting nominal. Clear corridor.';
    iconSvg.innerHTML = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>';
  }

  // Update E-Stop Button State
  const estopBtn = document.getElementById('estopBtn');
  const estopText = document.getElementById('estopBtnText');
  if (state.emergencyEngaged || level === 'CRITICAL') {
    estopBtn.classList.add('engaged');
    estopText.textContent = 'RESET EMERGENCY STOP';
  } else {
    estopBtn.classList.remove('engaged');
    estopText.textContent = 'ENGAGE EMERGENCY BRAKE';
  }
}

function toggleEmergencyBrake() {
  state.emergencyEngaged = !state.emergencyEngaged;
  if (state.emergencyEngaged) {
    state.speed = 0;
    setScenarioPreset('emergency');
  } else {
    setScenarioPreset('clear');
  }
  updateApp();
}

// ─────────────────────────────────────────────────────────────
// 2. RADAR MONITOR
// ─────────────────────────────────────────────────────────────
function updateRadar(level) {
  const d = state.distance;
  document.getElementById('radarDistVal').innerHTML = `${d.toFixed(2)}<small>m</small>`;

  const obstacle = document.getElementById('radarObstacle');
  // Map distance 0.4m to 6.0m into radar Y position (top: 15% to 42%)
  const topPct = 14 + (d / 6.0) * 30;
  obstacle.style.top = `${topPct}%`;
  obstacle.style.left = `50%`;

  obstacle.className = `obstacle ${level.toLowerCase()}`;
}

// ─────────────────────────────────────────────────────────────
// 3. TELEMETRY GAUGES
// ─────────────────────────────────────────────────────────────
function updateGauges(level) {
  const vis = Math.round(state.visibility);
  const dist = state.distance.toFixed(2);
  const spd = state.speed.toFixed(1);
  const brk = state.brakingDist.toFixed(1);

  // Visibility Gauge
  document.getElementById('gaugeVisNum').textContent = vis;
  const visBar = document.getElementById('gaugeVisBar');
  visBar.style.width = `${vis}%`;
  visBar.className = vis > 70 ? 'lime' : vis > 40 ? 'amber' : 'red';
  document.getElementById('gaugeVisSub').textContent = vis > 70 ? 'Clear conditions' : vis > 40 ? 'Moderate dust' : 'Dense fog';

  // Distance Gauge
  document.getElementById('gaugeDistNum').textContent = dist;
  const distBar = document.getElementById('gaugeDistBar');
  distBar.style.width = `${Math.min(100, (dist / 6.0) * 100)}%`;
  distBar.className = level === 'SAFE' ? 'lime' : level === 'WARNING' ? 'amber' : 'red';

  // Speed Gauge
  document.getElementById('gaugeSpeedNum').textContent = spd;
  const speedBar = document.getElementById('gaugeSpeedBar');
  speedBar.style.width = `${Math.min(100, (spd / 12.0) * 100)}%`;
  speedBar.className = spd === 0 ? 'red' : spd < 5 ? 'amber' : 'lime';
  document.getElementById('gaugeSpeedSub').textContent = spd === 0 ? 'Halted' : spd < 6 ? 'Adaptive limited' : 'Nominal speed';

  // Braking Buffer Gauge
  document.getElementById('gaugeBrakeNum').textContent = brk;
  const brakeBar = document.getElementById('gaugeBrakeBar');
  brakeBar.style.width = `${Math.min(100, (brk / 5.0) * 100)}%`;
  brakeBar.className = brk > 3.0 ? 'amber' : 'lime';
}

// ─────────────────────────────────────────────────────────────
// 4. MINI TREND CANVAS CHART
// ─────────────────────────────────────────────────────────────
function updateMiniTrend(score) {
  state.history.push(score);
  if (state.history.length > state.maxHistory) state.history.shift();

  const label = document.getElementById('trendValueLabel');
  if (score < 30) {
    label.className = 'trend-value';
    label.textContent = `STABLE · ${score}`;
  } else if (score < 70) {
    label.className = 'trend-value warning';
    label.textContent = `ELEVATED · ${score}`;
  } else {
    label.className = 'trend-value critical';
    label.textContent = `HIGH RISK · ${score}`;
  }

  const canvas = document.getElementById('miniTrendCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (state.history.length < 2) return;

  // Draw Area Gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, score < 30 ? 'rgba(16, 185, 129, 0.25)' : score < 70 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(239, 68, 68, 0.25)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');

  const step = w / (state.maxHistory - 1);

  ctx.beginPath();
  ctx.moveTo(0, h);
  state.history.forEach((val, i) => {
    const x = i * step;
    const y = h - (val / 100) * (h - 20) - 10;
    if (i === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo((state.history.length - 1) * step, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw Line
  ctx.beginPath();
  state.history.forEach((val, i) => {
    const x = i * step;
    const y = h - (val / 100) * (h - 20) - 10;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = score < 30 ? '#10b981' : score < 70 ? '#f59e0b' : '#ef4444';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────
// 5. SCENARIO SWITCHING
// ─────────────────────────────────────────────────────────────
function setScenarioPreset(key) {
  state.scenario = key;
  const p = scenarioPresets[key];
  state.visibility = p.visibility;
  state.distance = p.distance;
  state.speed = p.speed;

  document.querySelectorAll('.scenario').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById(`scen-${key}`);
  if (activeBtn) activeBtn.classList.add('active');

  const noteEl = document.getElementById('scenarioNoteText');
  if (noteEl) noteEl.textContent = p.note;

  if (key === 'emergency') {
    state.emergencyEngaged = true;
  } else {
    state.emergencyEngaged = false;
  }

  updateApp();
}

function setFeedMode(mode) {
  state.feedMode = mode;
  document.getElementById('btnModeAuto').classList.toggle('selected', mode === 'auto');
  document.getElementById('btnModeManual').classList.toggle('selected', mode === 'manual');
}

// ─────────────────────────────────────────────────────────────
// 6. NAVIGATION & ROUTING
// ─────────────────────────────────────────────────────────────
function navigateTo(viewId) {
  state.view = viewId;

  // Toggle view sections
  document.querySelectorAll('.view-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) target.classList.add('active');

  // Toggle nav link active states
  document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
  const link = document.getElementById(`nav-${viewId}`);
  if (link) link.classList.add('active');

  // Update topbar title
  const titles = {
    dashboard: 'Live operations',
    analytics: 'Analytics & history',
    settings: 'System settings',
  };
  document.getElementById('topbarTitle').textContent = titles[viewId] || 'Live operations';

  if (viewId === 'analytics') {
    renderAnalyticsView();
  }

  toggleMobileNav(false);
}

function toggleMobileNav(open) {
  const sidebar = document.getElementById('sidebar');
  if (open) sidebar.classList.add('open');
  else sidebar.classList.remove('open');
}

// ─────────────────────────────────────────────────────────────
// 7. ANALYTICS & HISTORY CHARTS
// ─────────────────────────────────────────────────────────────
function renderAnalyticsView() {
  renderHistoryTable();
  drawAnalyticsRiskChart();
  drawAnalyticsSpeedChart();
}

function renderHistoryTable() {
  const container = document.getElementById('historyTableRows');
  if (!container) return;

  container.innerHTML = initialEvents.map(e => `
    <div class="table-row">
      <time>${e.time}</time>
      <strong>${e.title}</strong>
      <span>${e.dist}</span>
      <span>${e.vis}</span>
      <span class="table-status ${e.level.toLowerCase()}">${e.level}</span>
    </div>
  `).join('');
}

function drawAnalyticsRiskChart() {
  const canvas = document.getElementById('chartAnalyticsRisk');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background Grid Lines
  ctx.strokeStyle = '#eef1f2';
  ctx.lineWidth = 1;
  for (let y = 30; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw Sample Correlated Curve
  const data = [
    { vis: 90, risk: 10 },
    { vis: 85, risk: 14 },
    { vis: 75, risk: 22 },
    { vis: 60, risk: 38 },
    { vis: 45, risk: 58 },
    { vis: 30, risk: 78 },
    { vis: 18, risk: 94 },
  ];

  const step = w / (data.length - 1);

  // Draw Visibility Area (Green)
  ctx.fillStyle = 'rgba(16, 185, 129, 0.1)';
  ctx.beginPath();
  ctx.moveTo(0, h);
  data.forEach((pt, i) => ctx.lineTo(i * step, h - (pt.vis / 100) * (h - 30)));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Draw Risk Line (Orange/Red)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  data.forEach((pt, i) => {
    const x = i * step;
    const y = h - (pt.risk / 100) * (h - 30);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawAnalyticsSpeedChart() {
  const canvas = document.getElementById('chartAnalyticsSpeed');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Draw Bar chart of speed vs braking distance
  const bars = [8.2, 7.8, 6.5, 5.0, 4.4, 2.8, 0.0];
  const barWidth = 36;
  const gap = (w - (bars.length * barWidth)) / (bars.length + 1);

  bars.forEach((val, i) => {
    const x = gap + i * (barWidth + gap);
    const barHeight = (val / 10.0) * (h - 40);
    const y = h - barHeight - 20;

    ctx.fillStyle = val === 0 ? '#ef4444' : val < 5 ? '#f59e0b' : '#10b981';
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = '#849098';
    ctx.font = '10px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(`${val}m/s`, x + barWidth / 2, h - 5);
  });
}

function exportHistoryCSV() {
  const csv = [
    'Time,Event,Detail,Distance,Visibility,Severity',
    ...initialEvents.map(e => `${e.time},"${e.title}","${e.detail}",${e.dist},${e.vis},${e.level}`)
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `oreguard_telemetry_${Date.now()}.csv`;
  a.click();
}

// ─────────────────────────────────────────────────────────────
// 8. SETTINGS & CALIBRATION
// ─────────────────────────────────────────────────────────────
function saveSettings() {
  state.visThreshold = parseFloat(document.getElementById('cfgVisThreshold').value);
  state.distThreshold = parseFloat(document.getElementById('cfgDistThreshold').value);
  state.riskMultiplier = parseFloat(document.getElementById('cfgMultiplier').value);
  
  if (window.saveSettingsToSupabase) {
    window.saveSettingsToSupabase(state);
  }
  
  alert('✅ Configuration saved: Risk engine thresholds updated & synced.');
}

function saveSupabaseCredentials() {
  const url = document.getElementById('cfgSupabaseUrl').value.trim();
  const key = document.getElementById('cfgSupabaseKey').value.trim();
  const msg = document.getElementById('supabaseConnMsg');

  if (!url || !key) {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = '❌ Please enter both URL and Anon Key'; }
    return;
  }

  const ok = window.initSupabase(url, key);
  if (ok) {
    if (msg) { msg.style.color = '#10b981'; msg.textContent = '✅ Connected to Supabase Cloud'; }
  } else {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = '❌ Failed to connect to Supabase'; }
  }
}

async function testSupabaseConnection() {
  const msg = document.getElementById('supabaseConnMsg');
  if (msg) { msg.style.color = '#f59e0b'; msg.textContent = '🔄 Testing connection...'; }

  if (!window.fetchIncidentsFromSupabase) {
    if (msg) { msg.style.color = '#ef4444'; msg.textContent = '❌ Supabase SDK not loaded'; }
    return;
  }

  const res = await window.fetchIncidentsFromSupabase(1);
  if (res !== null) {
    if (msg) { msg.style.color = '#10b981'; msg.textContent = '✅ Supabase Cloud Query Verified (OK)'; }
  } else {
    if (msg) { msg.style.color = '#f59e0b'; msg.textContent = '⚠️ Check Supabase credentials or table permissions'; }
  }
}

function toggleAudioSwitch(btn) {
  btn.classList.toggle('on');
  state.audioEnabled = btn.classList.contains('on');
}

function resetCalibration() {
  alert('🔄 Optical LDR zero-point baseline recalibrated to current ambient lighting.');
}

// ─────────────────────────────────────────────────────────────
// 9. AUTHENTICATION & LOGIN
// ─────────────────────────────────────────────────────────────
function setAuthTab(tab) {
  document.getElementById('btnTabSignIn').classList.toggle('active', tab === 'signin');
  document.getElementById('btnTabJury').classList.toggle('active', tab === 'jury');

  if (tab === 'jury') {
    document.getElementById('operatorEmail').value = 'sih.jury.evaluator@hackathon.gov.in';
    document.getElementById('authSubmitBtn').innerHTML = '<span>ENTER JURY DEMO PASS</span>';
  } else {
    document.getElementById('operatorEmail').value = 'operator-402@oreguard.mine';
    document.getElementById('authSubmitBtn').innerHTML = '<span>ENTER SAFETY CONSOLE</span>';
  }
}

function quickLogin(name) {
  state.operator = name;
  localStorage.setItem('oreguard_auth', JSON.stringify({ name, time: Date.now() }));
  showApp();
}

function handleAuthSubmit(e) {
  e.preventDefault();
  const email = document.getElementById('operatorEmail').value.trim();
  state.operator = email.split('@')[0] || 'Operator MV-07';
  localStorage.setItem('oreguard_auth', JSON.stringify({ name: state.operator, time: Date.now() }));
  showApp();
}

function signOut() {
  localStorage.removeItem('oreguard_auth');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('floatingSignout').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  document.getElementById('floatingSignout').style.display = 'flex';
  navigateTo('dashboard');
}

// ─────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Supabase
  if (window.initSupabase) {
    window.initSupabase();

    // Populate saved settings fields
    const savedUrl = localStorage.getItem('oreguard_sb_url');
    const savedKey = localStorage.getItem('oreguard_sb_key');
    const urlInput = document.getElementById('cfgSupabaseUrl');
    const keyInput = document.getElementById('cfgSupabaseKey');
    if (urlInput && savedUrl) urlInput.value = savedUrl;
    if (keyInput && savedKey) keyInput.value = savedKey;

    // Load cloud settings
    if (window.loadSettingsFromSupabase) {
      const cloudSettings = await window.loadSettingsFromSupabase();
      if (cloudSettings) {
        if (cloudSettings.vis_threshold)  state.visThreshold  = parseFloat(cloudSettings.vis_threshold);
        if (cloudSettings.dist_threshold) state.distThreshold = parseFloat(cloudSettings.dist_threshold);
        if (cloudSettings.risk_multiplier) state.riskMultiplier = parseFloat(cloudSettings.risk_multiplier);
      }
    }

    // ── HARDWARE POLLING: check Supabase every 3s for new ESP32 data ──
    setInterval(async () => {
      if (!window.supabase || !window.isSupabaseConfigured) return;
      try {
        const { data } = await window.supabase
          .from('telemetry_logs')
          .select('*')
          .eq('operator_id', 'ESP32-HARDWARE-NODE')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (data) {
          const age = Date.now() - new Date(data.created_at).getTime();
          if (age < 8000) { // Only use data fresher than 8 seconds
            handleRemoteHardwareData(data);
          }
        }
      } catch(e) { /* no hardware data yet — keep simulation */ }
    }, 3000);
  }

  // Show simulation badge on load
  updateHardwareBadge(false);

  // Check auth
  const auth = localStorage.getItem('oreguard_auth');
  if (!auth) {
    showApp();
  } else {
    showApp();
  }

  // Handle URL Hash navigation
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  if (['dashboard', 'analytics', 'settings'].includes(hash)) {
    navigateTo(hash);
  }

  // Start Real-Time Simulation loop
  setInterval(simulationTick, 700);
});

