/*
 * ═════════════════════════════════════════════════════════════════
 * OREGUARD MINE VEHICLE ADAS — ESP32 HARDWARE FIRMWARE
 * ═════════════════════════════════════════════════════════════════
 * Hardware Target: ESP32 Dev Module
 * Sensors: 
 *   - LDR Optical Light/Dust Sensor (Pin 34 - ADC)
 *   - HC-SR04 Ultrasonic Distance Sensor (Trig Pin 5, Echo Pin 18)
 *   - ADAS Warning Buzzer (Pin 19 - PWM)
 * 
 * Cloud Destination: Supabase REST API (POST /rest/v1/telemetry_logs)
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
#define PIN_LDR_VISIBILITY 34
#define PIN_TRIG 5
#define PIN_ECHO 18
#define PIN_BUZZER 19

// Vehicle Identification
const char* VEHICLE_ID = "MV-07";

// Timing
unsigned long lastTelemetryTime = 0;
const unsigned long TELEMETRY_INTERVAL_MS = 2000; // Send telemetry every 2 seconds

// ── 4. SENSOR READING FUNCTIONS ──

// Read visibility % from optical LDR sensor
float readOpticalVisibility() {
  int rawADC = analogRead(PIN_LDR_VISIBILITY); // 0 - 4095
  // Map ADC to 0-100% (Calibrate based on your mining tunnel ambient zero point)
  float visPercent = (float)rawADC / 4095.0 * 100.0;
  if (visPercent > 100.0) visPercent = 100.0;
  if (visPercent < 0.0) visPercent = 0.0;
  return visPercent;
}

// Read obstacle distance in metres from Ultrasonic HC-SR04
float readUltrasonicDistance() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 30000); // 30ms timeout (~5m range)
  if (duration == 0) return 5.50; // No obstacle in range

  float distanceMeters = (duration * 0.0343) / 2.0 / 100.0;
  if (distanceMeters < 0.2) distanceMeters = 0.2;
  if (distanceMeters > 6.0) distanceMeters = 6.0;
  return distanceMeters;
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

  Serial.println("\n=================================");
  Serial.println("OREGUARD MV-07 ADAS Node Starting");
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
}

void loop() {
  float visibility = readOpticalVisibility();
  float distance   = readUltrasonicDistance();
  float speed      = 8.2; // Connect vehicle CAN-bus/hall-effect sensor here for actual speed
  
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
