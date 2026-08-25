/**
 * ═════════════════════════════════════════════════════════════════
 * OREGUARD ADAS — SUPABASE CLIENT & CLOUD SYNC MODULE
 * ═════════════════════════════════════════════════════════════════
 */

// Supabase Configuration
const DEFAULT_SUPABASE_URL = localStorage.getItem('oreguard_sb_url') || 'https://rlwdrbpcnmqqejofdbbs.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = localStorage.getItem('oreguard_sb_key') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsd2RyYnBjbm1xcWVqb2ZkYmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTMwODQsImV4cCI6MjEwMzIyOTA4NH0.VpwN9LISANX5VH3iNDOVB64h8DeSt2uvi6BJK3qi8Yg';

let supabase = null;
let isSupabaseConfigured = false;
let realtimeChannel = null;

// Initialize Supabase Client
function initSupabase(url = DEFAULT_SUPABASE_URL, key = DEFAULT_SUPABASE_ANON_KEY) {
  if (url && key && window.supabase) {
    try {
      supabase = window.supabase.createClient(url, key);
      isSupabaseConfigured = true;
      localStorage.setItem('oreguard_sb_url', url);
      localStorage.setItem('oreguard_sb_key', key);
      updateCloudStatusUI(true);
      console.log('✅ Supabase connected successfully to:', url);
      initRealtimeSubscription();
      return true;
    } catch (e) {
      console.error('Failed to initialize Supabase:', e);
      isSupabaseConfigured = false;
      updateCloudStatusUI(false);
      return false;
    }
  } else {
    isSupabaseConfigured = false;
    updateCloudStatusUI(false);
    return false;
  }
}

// Update UI Connection Badges
function updateCloudStatusUI(connected) {
  const badge = document.getElementById('cloudStatusBadge');
  const dot = document.getElementById('cloudStatusDot');
  const text = document.getElementById('cloudStatusText');
  
  if (badge && dot && text) {
    if (connected) {
      badge.className = 'connection-badge cloud-online';
      dot.className = 'live-dot';
      text.textContent = 'Supabase Cloud Linked';
    } else {
      badge.className = 'connection-badge cloud-offline';
      dot.className = 'live-dot offline';
      text.textContent = 'Local Mode · Cloud Standby';
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 1. SUPABASE AUTHENTICATION
// ─────────────────────────────────────────────────────────────

async function supabaseSignIn(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    // Fallback local auth
    return { data: { user: { email } }, error: null };
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

async function supabaseSignUp(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: { user: { email } }, error: null };
  }
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    return { data, error };
  } catch (err) {
    return { data: null, error: err };
  }
}

async function supabaseSignOut() {
  if (isSupabaseConfigured && supabase) {
    await supabase.auth.signOut();
  }
  localStorage.removeItem('oreguard_auth');
}

// ─────────────────────────────────────────────────────────────
// 2. TELEMETRY STREAMING & LOGGING
// ─────────────────────────────────────────────────────────────

let telemetryBuffer = [];
let lastFlushTime = 0;

// Throttled logging to Supabase to prevent rate-limiting (flushes every 3 seconds)
async function streamTelemetryToSupabase(telemetry) {
  if (!isSupabaseConfigured || !supabase) return;

  telemetryBuffer.push({
    vehicle_id: 'MV-07',
    operator_id: telemetry.operator || 'Operator-402',
    visibility: parseFloat(telemetry.visibility.toFixed(2)),
    obstacle_distance: parseFloat(telemetry.distance.toFixed(2)),
    vehicle_speed: parseFloat(telemetry.speed.toFixed(2)),
    braking_distance: parseFloat(telemetry.brakingDist.toFixed(2)),
    risk_score: telemetry.riskScore,
    risk_level: telemetry.riskLevel,
    emergency_brake: telemetry.emergencyEngaged || false,
    created_at: new Date().toISOString()
  });

  const now = Date.now();
  if (now - lastFlushTime > 3000 && telemetryBuffer.length > 0) {
    const batch = [...telemetryBuffer];
    telemetryBuffer = [];
    lastFlushTime = now;

    try {
      const { error } = await supabase.from('telemetry_logs').insert(batch);
      if (error) console.warn('Supabase telemetry batch insert:', error.message);
    } catch (e) {
      console.warn('Supabase telemetry write exception:', e);
    }
  }
}

// Log a high-severity or emergency incident to Supabase
async function logIncidentToSupabase(incident) {
  if (!isSupabaseConfigured || !supabase) return;

  try {
    const { error } = await supabase.from('incidents').insert([{
      vehicle_id: 'MV-07',
      title: incident.title,
      detail: incident.detail,
      severity: incident.level,
      obstacle_distance: parseFloat(incident.dist) || null,
      visibility: parseFloat(incident.vis) || null,
      speed: incident.speed || null,
      created_at: new Date().toISOString()
    }]);
    if (error) console.warn('Supabase incident log error:', error.message);
  } catch (e) {
    console.warn('Incident log exception:', e);
  }
}

// Fetch historical incidents from Supabase
async function fetchIncidentsFromSupabase(limit = 20) {
  if (!isSupabaseConfigured || !supabase) return null;

  try {
    const { data, error } = await supabase
      .from('incidents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('Failed to fetch incidents from Supabase:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 3. SETTINGS CLOUD SYNC
// ─────────────────────────────────────────────────────────────

async function saveSettingsToSupabase(settings) {
  if (!isSupabaseConfigured || !supabase) return;

  try {
    const { error } = await supabase.from('vehicle_settings').upsert({
      vehicle_id: 'MV-07',
      vis_threshold: settings.visThreshold,
      dist_threshold: settings.distThreshold,
      risk_multiplier: settings.riskMultiplier,
      audio_enabled: settings.audioEnabled,
      auto_reconnect: settings.autoReconnect,
      updated_at: new Date().toISOString()
    });
    if (error) console.warn('Failed to sync settings to Supabase:', error.message);
    else console.log('✅ Settings synced to Supabase Cloud');
  } catch (e) {
    console.warn('Settings sync exception:', e);
  }
}

async function loadSettingsFromSupabase() {
  if (!isSupabaseConfigured || !supabase) return null;

  try {
    const { data, error } = await supabase
      .from('vehicle_settings')
      .select('*')
      .eq('vehicle_id', 'MV-07')
      .single();

    if (error) throw error;
    return data;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 4. REALTIME BROADCAST & SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────

function initRealtimeSubscription() {
  if (!isSupabaseConfigured || !supabase) return;

  try {
    if (realtimeChannel) supabase.removeChannel(realtimeChannel);

    realtimeChannel = supabase
      .channel('oreguard-telemetry-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, payload => {
        console.log('🚨 New cloud incident received:', payload.new);
        if (window.handleRemoteIncident) {
          window.handleRemoteIncident(payload.new);
        }
      })
      .subscribe();
  } catch (e) {
    console.warn('Realtime subscription error:', e);
  }
}

// Export for global access
window.initSupabase = initSupabase;
window.supabaseSignIn = supabaseSignIn;
window.supabaseSignUp = supabaseSignUp;
window.supabaseSignOut = supabaseSignOut;
window.streamTelemetryToSupabase = streamTelemetryToSupabase;
window.logIncidentToSupabase = logIncidentToSupabase;
window.fetchIncidentsFromSupabase = fetchIncidentsFromSupabase;
window.saveSettingsToSupabase = saveSettingsToSupabase;
window.loadSettingsFromSupabase = loadSettingsFromSupabase;

// Expose raw client + config flag so app.js hardware polling can use them
Object.defineProperty(window, 'supabase', {
  get: () => supabase,
  configurable: true
});
Object.defineProperty(window, 'isSupabaseConfigured', {
  get: () => isSupabaseConfigured,
  configurable: true
});
