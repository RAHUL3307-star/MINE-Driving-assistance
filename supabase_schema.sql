-- ═════════════════════════════════════════════════════════════════
-- OREGUARD MINE VEHICLE ADAS — SUPABASE DATABASE SCHEMA
-- ═════════════════════════════════════════════════════════════════

-- 1. TELEMETRY LOGS (Real-time sensor streams from MV-07)
CREATE TABLE IF NOT EXISTS public.telemetry_logs (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id TEXT NOT NULL DEFAULT 'MV-07',
    operator_id TEXT,
    visibility NUMERIC(5,2) NOT NULL,
    obstacle_distance NUMERIC(5,2) NOT NULL,
    vehicle_speed NUMERIC(5,2) NOT NULL,
    braking_distance NUMERIC(5,2) NOT NULL,
    risk_score INTEGER NOT NULL,
    risk_level TEXT NOT NULL, -- 'SAFE', 'WARNING', 'HIGH', 'CRITICAL'
    emergency_brake BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast time-series queries
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON public.telemetry_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle ON public.telemetry_logs(vehicle_id);

-- 2. SAFETY INCIDENTS & AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.incidents (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id TEXT NOT NULL DEFAULT 'MV-07',
    title TEXT NOT NULL,
    detail TEXT,
    severity TEXT NOT NULL, -- 'SAFE', 'WARNING', 'HIGH', 'CRITICAL'
    obstacle_distance NUMERIC(5,2),
    visibility NUMERIC(5,2),
    speed NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents(created_at DESC);

-- 3. VEHICLE SAFETY SETTINGS & CALIBRATION
CREATE TABLE IF NOT EXISTS public.vehicle_settings (
    vehicle_id TEXT PRIMARY KEY DEFAULT 'MV-07',
    vis_threshold NUMERIC(5,2) DEFAULT 40.0,
    dist_threshold NUMERIC(5,2) DEFAULT 1.2,
    risk_multiplier NUMERIC(5,2) DEFAULT 1.8,
    audio_enabled BOOLEAN DEFAULT TRUE,
    auto_reconnect BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default row for vehicle MV-07
INSERT INTO public.vehicle_settings (vehicle_id, vis_threshold, dist_threshold, risk_multiplier, audio_enabled, auto_reconnect)
VALUES ('MV-07', 40.0, 1.2, 1.8, TRUE, TRUE)
ON CONFLICT (vehicle_id) DO NOTHING;

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.telemetry_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_settings ENABLE ROW LEVEL SECURITY;

-- Allow public reads and inserts for demo / telemetry streaming
CREATE POLICY "Allow public read telemetry" ON public.telemetry_logs FOR SELECT USING (true);
CREATE POLICY "Allow public insert telemetry" ON public.telemetry_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read incidents" ON public.incidents FOR SELECT USING (true);
CREATE POLICY "Allow public insert incidents" ON public.incidents FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read settings" ON public.vehicle_settings FOR SELECT USING (true);
CREATE POLICY "Allow public update settings" ON public.vehicle_settings FOR ALL USING (true);

-- 5. ENABLE REALTIME SUBSCRIPTIONS
ALTER PUBLICATION supabase_realtime ADD TABLE public.telemetry_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_settings;
