/*
 * ═════════════════════════════════════════════════════════════════
 * OREGUARD MINE VEHICLE ADAS — ESP32 HARDWARE FIRMWARE
 * ═════════════════════════════════════════════════════════════════
 * Hardware Target: ESP32 Dev Module
 * Sensors:
 *   - LDR Optical Light/Dust Sensor     (Pin 34 - ADC)
 *   - HC-SR04 Ultrasonic Distance       (Trig Pin 5, Echo Pin 18)
 *   - Hall-Effect / Encoder Speed       (Pin 36 - ADC, optional)
 *   - OLED Display                      (I2C: SDA Pin 21, SCL Pin 22)
 *   - ADAS Warning Buzzer               (Pin 19 - PWM)
 *
 * Cloud Destination: Supabase REST API (POST /rest/v1/telemetry_logs)
 *
 * FIXES v2:
 *   - Ultrasonic capped to 4m (HC-SR04 reliable range) with 5-sample median filter
 *   - Speed sensor pin added (PIN_SPEED_HALL) with fallback if not connected
 *   - LDR calibrated with mine-zero offset for dusty tunnel ambient baseline
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h> // Install "ArduinoJson" by Benoit Blanchon in Arduino Library Manager

// ── 1. NETWORK CONFIGURATION ──
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ── 2. SUPABASE CREDENTIALS ──
const char* SUPABASE_URL = "https://rlwdrbpcnmqqejofdbbs.supabase.co/rest/v1/telemetry_logs";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsd2RyYnBjbm1xcWVqb2ZkYmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTMwODQsImV4cCI6MjEwMzIyOTA4NH0.VpwN9LISANX5VH3iNDOVB64h8DeSt2uvi6BJK3qi8Yg";

// ── 3. PIN DEFINITIONS ──
#define PIN_LDR_VISIBILITY  34   // ADC1 — LDR dust/light sensor
#define PIN_TRIG             5   // HC-SR04 trigger
#define PIN_ECHO            18   // HC-SR04 echo
#define PIN_BUZZER          19   // PWM buzzer
#define PIN_SPEED_HALL      36   // Hall-effect speed pulse (ADC1, input-only pin)
                                 // Leave unconnected for fallback simulated speed

// LDR Calibration — adjust ADC_ZERO for your mine tunnel ambient light baseline
// (0 = pitch dark tunnel, measure raw analogRead value with lights off)
#define LDR_ADC_ZERO   150       // ADC reading in complete darkness (calibrate this!)
#define LDR_ADC_MAX   3900       // ADC reading in full light

// Vehicle Identification
const char* VEHICLE_ID = "MV-07";

// Timing
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 2000; // Cloud push every 2 seconds

// Speed tracking (hall-effect pulse counting)
volatile unsigned long pulseCount = 0;
unsigned long lastSpeedCalcTime = 0;
float lastCalculatedSpeed = 0.0;
const float WHEEL_CIRCUMFERENCE_M = 1.57; // ~50cm diameter mine vehicle wheel (π × 0.5m)
const int   PULSES_PER_REV = 1;           // Adjust if using multi-pole hall sensor

// ── 4. SENSOR READING FUNCTIONS ──

// ── 4a. LDR Visibility (calibrated with mine zero offset) ──
float readOpticalVisibility() {
  // Average 4 ADC readings to reduce noise
  long sum = 0;
  for (int i = 0; i < 4; i++) {
    sum += analogRead(PIN_LDR_VISIBILITY);
    delay(2);
  }
  int rawADC = sum / 4;

  // Map from calibrated dark-zero to full-light range → 0-100%
  float visPercent = (float)(rawADC - LDR_ADC_ZERO) / (float)(LDR_ADC_MAX - LDR_ADC_ZERO) * 100.0;
  visPercent = constrain(visPercent, 0.0, 100.0);
  return visPercent;
}

// ── 4b. Ultrasonic HC-SR04 with 5-sample median filter ──
//    HC-SR04 reliable range: 0.02m – 4.0m (NOT 6m — beyond 4m readings are noisy)
float readSingleUltrasonicPulse() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  long dur = pulseIn(PIN_ECHO, HIGH, 24000); // 24ms timeout = 4.0m max range
  if (dur == 0) return 4.50;                 // Nothing in range → report 4.5m (safe)
  return (dur * 0.0343f) / 2.0f / 100.0f;
}

float readUltrasonicDistance() {
  // 5-sample median filter — eliminates single-bounce noise spikes
  float samples[5];
  for (int i = 0; i < 5; i++) {
    samples[i] = readSingleUltrasonicPulse();
    delay(12); // min 12ms between HC-SR04 pings to avoid echo overlap
  }
  // Bubble sort to find median
  for (int i = 0; i < 4; i++)
    for (int j = i+1; j < 5; j++)
      if (samples[j] < samples[i]) { float tmp = samples[i]; samples[i] = samples[j]; samples[j] = tmp; }
  float median = samples[2];

  // Clamp to HC-SR04 reliable operating range
  median = constrain(median, 0.20f, 4.00f);
  return median;
}

// ── 4c. Speed from Hall-Effect sensor (ISR-based pulse counting) ──
void IRAM_ATTR onSpeedPulse() {
  pulseCount++;
}

float readVehicleSpeed() {
  unsigned long now = millis();
  unsigned long elapsed = now - lastSpeedCalcTime;
  if (elapsed < 500) return lastCalculatedSpeed; // Only recalculate every 500ms

  // Read and reset pulse count atomically
  noInterrupts();
  unsigned long pulses = pulseCount;
  pulseCount = 0;
  interrupts();
  lastSpeedCalcTime = now;

  // Speed (m/s) = (pulses / PULSES_PER_REV) × WHEEL_CIRCUMFERENCE / elapsed_seconds
  float revs = (float)pulses / (float)PULSES_PER_REV;
  float speed = revs * WHEEL_CIRCUMFERENCE_M / ((float)elapsed / 1000.0f);
  speed = constrain(speed, 0.0f, 15.0f);

  // If no pulses detected at all (sensor not connected), use last known value
  // Set fallback: 0 if no movement detected for >2s
  if (pulses == 0 && elapsed > 2000) speed = 0.0f;

  lastCalculatedSpeed = speed;
  return speed;
}

// Risk calculation on board
int calculateRiskScore(float visibility, float distance, float speed) {
  float visNorm = max(0.01f, min(1.0f, visibility / 100.0f));
  float distNorm = max(0.01f, min(1.0f, distance / 6.0f));
  float spdNorm = max(0.0f, min(1.0f, speed / 12.0f));

  float visHazard = 1.0f - visNorm;
  float proxHazard = pow(1.0f - distNorm, 2.3f);
  float speedHazard = spdNorm;

  float rawRisk = (visHazard * 0.35f) + (proxHazard * 0.50f) + (speedHazard * 0.15f);
  float multiplier = 1.0f + (visHazard * 0.8f);
  int score = (int)constrain(rawRisk * multiplier * 100.0f, 0.0f, 100.0f);
  return score;
}

const char* getRiskLevel(int score, float distance, float visibility) {
  if (score >= 82 || (distance < 1.2 && visibility < 40.0) || distance < 0.6) {
    return "CRITICAL";
  } else if (score >= 58 || (distance < 2.0 && visibility < 50.0)) {
    return "HIGH";
  } else if (score >= 32 || distance < 3.0 || visibility < 40.0) {
    return "WARNING";
  }
  return "SAFE";
}

// ── 5. SUPABASE POST TELEMETRY ──
void sendTelemetryToSupabase(float vis, float dist, float spd, int risk, const char* level, bool eStop) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[ESP32] WiFi Disconnected. Skipping cloud sync.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Skip certificate verification for speed

  HTTPClient http;
  http.begin(client, SUPABASE_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  // Construct JSON Payload
  StaticJsonDocument<256> doc;
  doc["vehicle_id"]        = VEHICLE_ID;
  doc["operator_id"]       = "ESP32-HARDWARE-NODE";
  doc["visibility"]        = vis;
  doc["obstacle_distance"] = dist;
  doc["vehicle_speed"]     = spd;
  doc["braking_distance"]  = 1.2 + (spd * 0.18) + (1.0 - (vis / 100.0)) * 1.5;
  doc["risk_score"]        = risk;
  doc["risk_level"]        = level;
  doc["emergency_brake"]   = eStop;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("[Cloud] Telemetry pushed to Supabase -> Vis: %.1f%%, Dist: %.2fm, Risk: %d (%s)\n", vis, dist, risk, level);
  } else {
    Serial.printf("[Cloud Error] HTTP Status: %d, Response: %s\n", httpCode, http.getString().c_str());
  }

  http.end();
}

// ── 6. SETUP & LOOP ──
void setup() {
  Serial.begin(115200);
  pinMode(PIN_LDR_VISIBILITY, INPUT);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_SPEED_HALL, INPUT_PULLUP); // Hall-effect speed sensor

  // Attach interrupt for speed pulse counting
  attachInterrupt(digitalPinToInterrupt(PIN_SPEED_HALL), onSpeedPulse, RISING);

  Serial.println("\n=================================");
  Serial.println("OREGUARD MV-07 ADAS Node v2.0");
  Serial.println("Sensors: LDR + HC-SR04 + Hall + Buzzer");
  Serial.println("=================================");

  // Connect to WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());

  // Warm up sensors (let HC-SR04 and LDR stabilize)
  delay(1000);
  Serial.println("[Sensors] Warm-up complete. Starting ADAS loop.");
}

void loop() {
  float visibility = readOpticalVisibility();
  float distance   = readUltrasonicDistance();
  float speed      = readVehicleSpeed(); // Real hall-effect speed (falls back to 0 if sensor absent)
  
  int riskScore = calculateRiskScore(visibility, distance, speed);
  const char* riskLevel = getRiskLevel(riskScore, distance, visibility);
  bool eStop = (strcmp(riskLevel, "CRITICAL") == 0);

  // Acoustic ADAS warning feedback on physical buzzer
  if (strcmp(riskLevel, "CRITICAL") == 0) {
    tone(PIN_BUZZER, 1000, 200);
  } else if (strcmp(riskLevel, "HIGH") == 0) {
    tone(PIN_BUZZER, 750, 100);
  } else if (strcmp(riskLevel, "WARNING") == 0) {
    tone(PIN_BUZZER, 500, 50);
  } else {
    noTone(PIN_BUZZER);
  }

  // Periodic Cloud Stream to Supabase
  if (millis() - lastTelemetryTime >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryTime = millis();
    sendTelemetryToSupabase(visibility, distance, speed, riskScore, riskLevel, eStop);
  }

  delay(100);
}
