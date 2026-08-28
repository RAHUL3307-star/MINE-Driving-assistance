/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  OREGUARD MV-07 — UNIFIED ALL-IN-ONE ESP32 FIRMWARE (I2C 16x2 LCD VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 *  Hardware Modules:
 *    1. MPU6050 6-Axis IMU (Accelerometer & Gyro) -> I2C (SDA Pin 21, SCL Pin 22)
 *    2. LDR Visibility Sensor                     -> Pin 34 (ADC1)
 *    3. Active ADAS Alarm Buzzer                  -> Pin 19
 *    4. HC-SR04 Ultrasonic Distance Sensor        -> Trig Pin 5, Echo Pin 18
 *    5. L298N Dual Motor Driver                    -> IN1:25, IN2:26, IN3:27, IN4:14
 *    6. 16x2 I2C LCD Display (0x27)               -> I2C (SDA Pin 21, SCL Pin 22)
 *    7. Dual-Mode Wi-Fi:
 *       - SoftAP ("HelloESP32", Port 3333) for Real-Time Direction Driving
 *       - Station Mode (Home/Hotspot Wi-Fi) for Live Web Dashboard Cloud Sync
 * ═══════════════════════════════════════════════════════════════════════════
 */

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>          // Library: "ArduinoJson" by Benoit Blanchon
#include <LiquidCrystal_I2C.h>    // Library: "LiquidCrystal I2C" by Frank de Brabander

// ─────────────────────────────────────────────────────────────
// 1. PIN DEFINITIONS & HARDWARE ADDRESSES
// ─────────────────────────────────────────────────────────────
// I2C Pins (Shared between LCD & MPU6050)
#define SDA_PIN 21
#define SCL_PIN 22
#define MPU_ADDR 0x68

// 16x2 I2C LCD Object (Address 0x27, 16 columns, 2 rows)
LiquidCrystal_I2C lcd(0x27, 16, 2);

// LDR Visibility Sensor & Buzzer
#define LDR_PIN 34
#define BUZZER_PIN 19
#define DARK_THRESHOLD 2000

// Ultrasonic HC-SR04 Sensor
#define TRIG_PIN 5
#define ECHO_PIN 18

// L298N Motor Driver Pins
#define IN1 25
#define IN2 26
#define IN3 27
#define IN4 14

// ─────────────────────────────────────────────────────────────
// 2. NETWORK & SUPABASE CLOUD CONFIGURATION
// ─────────────────────────────────────────────────────────────
// SoftAP Settings for Direction Joystick Controller
const char* AP_SSID = "HelloESP32";
const char* AP_PASS = "12345678";
WiFiServer server(3333);

// Station Wi-Fi Settings (Connects to Internet to stream real data to your website)
// 👉 Enter your home Wi-Fi or Mobile Hotspot credentials here:
const char* STA_SSID = "YOUR_WIFI_SSID";
const char* STA_PASS = "YOUR_WIFI_PASSWORD";

// Supabase Real-Time Database Endpoint
const char* SUPABASE_URL = "https://rlwdrbpcnmqqejofdbbs.supabase.co/rest/v1/telemetry_logs";
const char* SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJsd2RyYnBjbm1xcWVqb2ZkYmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTMwODQsImV4cCI6MjEwMzIyOTA4NH0.VpwN9LISANX5VH3iNDOVB64h8DeSt2uvi6BJK3qi8Yg";

// Vehicle Identifier
const char* VEHICLE_ID = "MV-07";

// ─────────────────────────────────────────────────────────────
// 3. GLOBAL VARIABLES & STATE
// ─────────────────────────────────────────────────────────────
// Sensor Variables
int ldrValue = 0;
String vis = "HIGH";
String risk = "LOW";
float visibilityPercent = 87.0;
float distance = 4.0;
float vehicleSpeed = 0.0;
int riskScore = 17;
String riskLevel = "SAFE";
bool emergencyBrake = false;

// MPU6050 Accelerometer Variables
int16_t ax = 0, ay = 0, az = 0;

// Motor state ('S'=Stop, 'F'=Forward, 'B'=Back, 'L'=Left, 'R'=Right)
char currentCommand = 'S';
unsigned long lastCommand = 0;

// Loop Timers
unsigned long lastSensorRead = 0;
unsigned long lastLCDUpdate = 0;
unsigned long lastTelemetrySync = 0;
const unsigned long TELEMETRY_INTERVAL = 2000; // Cloud sync every 2 seconds

// ─────────────────────────────────────────────────────────────
// 4. MOTOR CONTROL FUNCTIONS (L298N)
// ─────────────────────────────────────────────────────────────
void stopMotors() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  currentCommand = 'S';
}

void forward() {
  // Safety Stop if obstacle is too close (< 0.6m)
  if (distance < 0.60 || emergencyBrake) {
    stopMotors();
    Serial.println("[SAFETY] Forward blocked - Obstacle in path!");
    return;
  }
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  currentCommand = 'F';
}

void backward() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  currentCommand = 'B';
}

void left() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  currentCommand = 'L';
}

void right() {
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  currentCommand = 'R';
}

// ─────────────────────────────────────────────────────────────
// 5. SENSOR DRIVERS
// ─────────────────────────────────────────────────────────────

// ── 5a. MPU6050 Driver ──
void initMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0); // Wake up MPU6050
  byte err = Wire.endTransmission();
  if (err == 0) {
    Serial.println("MPU6050 Movement Sensor Ready");
  } else {
    Serial.printf("MPU6050 not responding at 0x%02X\n", MPU_ADDR);
  }
}

void readMPU6050() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6);

  if (Wire.available() == 6) {
    ax = Wire.read() << 8 | Wire.read();
    ay = Wire.read() << 8 | Wire.read();
    az = Wire.read() << 8 | Wire.read();

    // Calculate dynamic vehicle speed based on movement
    if (currentCommand == 'F') {
      float accelMag = abs((float)ax / 16384.0);
      vehicleSpeed = 6.0 + (accelMag * 3.5);
    } else if (currentCommand == 'B' || currentCommand == 'L' || currentCommand == 'R') {
      vehicleSpeed = 4.0;
    } else {
      vehicleSpeed = 0.0;
    }
  }
}

// ── 5b. LDR Visibility Sensor ──
void readVisibilitySensor() {
  ldrValue = analogRead(LDR_PIN);

  // Exact logic from tested code:
  // LOW ADC = BRIGHT LIGHT = HIGH VISIBILITY
  if (ldrValue < 500) {
    vis = "HIGH";
    risk = "LOW";
    visibilityPercent = map(ldrValue, 0, 500, 100, 75);
  }
  // MEDIUM ADC = MEDIUM VISIBILITY
  else if (ldrValue < 2000) {
    vis = "MED";
    risk = "MED";
    visibilityPercent = map(ldrValue, 500, 2000, 75, 40);
  }
  // HIGH ADC = DARK = LOW VISIBILITY
  else {
    vis = "LOW";
    risk = "HIGH";
    visibilityPercent = map(constrain(ldrValue, 2000, 4095), 2000, 4095, 40, 5);
  }

  // Active Buzzer on Low Visibility / Dark Threshold
  if (ldrValue > DARK_THRESHOLD || risk == "HIGH") {
    digitalWrite(BUZZER_PIN, HIGH);  // Buzzer ON
  } else {
    digitalWrite(BUZZER_PIN, LOW);   // Buzzer OFF
  }
}

// ── 5c. Ultrasonic HC-SR04 Sensor ──
void readUltrasonicSensor() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    distance = 4.0; // Clear path / No obstacle
  } else {
    distance = (duration * 0.0343 / 2.0) / 100.0; // Distance in metres
    distance = constrain(distance, 0.20, 4.00);
  }
}

// ─────────────────────────────────────────────────────────────
// 6. ADAS RISK FUSION
// ─────────────────────────────────────────────────────────────
void computeADASRisk() {
  readVisibilitySensor();
  readUltrasonicSensor();
  readMPU6050();

  // Dynamic Risk Evaluation for Cloud & ADAS Safety
  if (distance < 0.80 || (distance < 1.20 && vis == "LOW") || ldrValue > 3500) {
    riskLevel = "CRITICAL";
    riskScore = 85;
    emergencyBrake = true;
    digitalWrite(BUZZER_PIN, HIGH); // Alarm ON
    stopMotors();                   // Emergency Brake
  } else if (distance < 1.80 || vis == "LOW" || ldrValue > DARK_THRESHOLD) {
    riskLevel = "HIGH";
    riskScore = 65;
    emergencyBrake = false;
  } else if (distance < 2.80 || vis == "MED") {
    riskLevel = "WARNING";
    riskScore = 38;
    emergencyBrake = false;
  } else {
    riskLevel = "SAFE";
    riskScore = 17;
    emergencyBrake = false;
  }
}

// ─────────────────────────────────────────────────────────────
// 7. 16x2 LCD DISPLAY REFRESH
// ─────────────────────────────────────────────────────────────
void updateLCD() {
  lcd.clear();

  // Line 1: VIS status + Obstacle Distance
  lcd.setCursor(0, 0);
  lcd.print("VIS: ");
  lcd.print(vis);
  lcd.setCursor(9, 0);
  lcd.print("D:");
  lcd.print(distance, 1);
  lcd.print("m");

  // Line 2: RISK status + Vehicle Speed
  lcd.setCursor(0, 1);
  lcd.print("RISK:");
  lcd.print(risk);
  lcd.setCursor(9, 1);
  lcd.print("S:");
  lcd.print(vehicleSpeed, 1);
  lcd.print("m/s");

  // Serial Diagnostic Output
  Serial.print("LDR = ");
  Serial.print(ldrValue);
  Serial.print(" | VIS = ");
  Serial.print(vis);
  Serial.print(" | RISK = ");
  Serial.print(risk);
  Serial.print(" | DIST = ");
  Serial.print(distance);
  Serial.println(" m");
}

// ─────────────────────────────────────────────────────────────
// 8. TCP & CLOUD TELEMETRY SYNC (Sends Real Sensor Data to Website)
// ─────────────────────────────────────────────────────────────
unsigned long lastTCPTelemetry = 0;
const unsigned long TCP_TELEMETRY_INTERVAL = 100; // 100ms (10Hz) ultra-responsive stream

void sendTCPTelemetry(WiFiClient &tcpClient) {
  if (!tcpClient || !tcpClient.connected()) return;

  float brakingDist = 1.2 + (vehicleSpeed * 0.18) + (1.0 - (visibilityPercent / 100.0)) * 1.5;

  // 1. JSON Payload for Web Dashboard & Bridge Server
  tcpClient.printf("JSON:{\"operator_id\":\"ESP32-HARDWARE-NODE\",\"vehicle_id\":\"%s\",\"visibility\":%.1f,\"obstacle_distance\":%.2f,\"vehicle_speed\":%.1f,\"braking_distance\":%.2f,\"risk_score\":%d,\"risk_level\":\"%s\",\"emergency_brake\":%s,\"ldr\":%d,\"vis_str\":\"%s\"}\n",
    VEHICLE_ID, visibilityPercent, distance, vehicleSpeed, brakingDist, riskScore, riskLevel.c_str(), emergencyBrake ? "true" : "false", ldrValue, vis.c_str());

  // 2. Compact DATA Stream
  tcpClient.printf("DATA:%d,%.2f,%.1f,%s,%s,%d,%.1f,%d\n",
    ldrValue, distance, visibilityPercent, vis.c_str(), riskLevel.c_str(), riskScore, vehicleSpeed, emergencyBrake ? 1 : 0);
}

void syncTelemetryToWebsiteCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    return; // Pushes automatically once Station Wi-Fi is connected
  }

  WiFiClientSecure client;
  client.setInsecure(); // Fast TLS handshake for ESP32

  HTTPClient http;
  http.begin(client, SUPABASE_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Prefer", "return=minimal");

  // JSON payload structure matching OREGUARD web dashboard
  StaticJsonDocument<300> doc;
  doc["vehicle_id"]        = VEHICLE_ID;
  doc["operator_id"]       = "ESP32-HARDWARE-NODE"; // Tells website this is REAL hardware!
  doc["visibility"]        = visibilityPercent;
  doc["obstacle_distance"] = distance;
  doc["vehicle_speed"]     = vehicleSpeed;
  doc["braking_distance"]  = 1.2 + (vehicleSpeed * 0.18) + (1.0 - (visibilityPercent / 100.0)) * 1.5;
  doc["risk_score"]        = riskScore;
  doc["risk_level"]        = riskLevel;
  doc["emergency_brake"]   = emergencyBrake;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("☁️ [Website Cloud Sync] Vis: %.1f%% (%s) | Dist: %.2fm | Risk: %s (%d)\n",
                  visibilityPercent, vis.c_str(), distance, riskLevel.c_str(), riskScore);
  } else {
    Serial.printf("⚠️ [Cloud Push Failed] Code: %d\n", httpCode);
  }

  http.end();
}

// ─────────────────────────────────────────────────────────────
// 9. SETUP FUNCTION
// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  // 1. Motor Pins
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  stopMotors();

  // 2. Ultrasonic Pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  // 3. Buzzer Pin
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  // 4. Initialize I2C Bus on SDA 21 & SCL 22
  Wire.begin(SDA_PIN, SCL_PIN);

  // 5. Initialize 16x2 I2C LCD Display
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("OREGUARD MV-07");
  lcd.setCursor(0, 1);
  lcd.print("SYSTEM READY...");
  Serial.println("LCD 16x2 Initialized");

  // 6. Initialize MPU6050
  initMPU6050();

  // 7. Initialize Dual WiFi: SoftAP for Joystick + STA for Website
  WiFi.mode(WIFI_AP_STA);

  // Start Vehicle Control SoftAP
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.println("Vehicle Wi-Fi started");
  Serial.print("Vehicle IP: ");
  Serial.println(WiFi.softAPIP());
  server.begin();

  // Connect to Router/Hotspot to stream real data to your website
  if (String(STA_SSID) != "YOUR_WIFI_SSID") {
    Serial.printf("Connecting to %s ...\n", STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);
  } else {
    Serial.println("ℹ️ Enter your STA_SSID & STA_PASS to stream real data to the website.");
  }

  lastCommand = millis();
  delay(1000);
}

// ─────────────────────────────────────────────────────────────
// 10. MAIN LOOP
// ─────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // 1. Handle Joystick TCP Client Commands & Live Telemetry Stream
  WiFiClient client = server.available();
  if (client) {
    Serial.println("Bridge / Joystick connected!");

    while (client.connected()) {
      now = millis();

      if (client.available()) {
        char command = client.read();

        if (command == 'F') forward();
        else if (command == 'B') backward();
        else if (command == 'L') left();
        else if (command == 'R') right();
        else if (command == 'S') stopMotors();

        lastCommand = now;
      }

      // Safety: stop if communication is lost (> 500ms)
      if (now - lastCommand > 500) {
        stopMotors();
      }

      // Update Sensors & ADAS Risk while driving
      if (now - lastSensorRead >= 80) {
        lastSensorRead = now;
        computeADASRisk();
      }

      // Update 16x2 LCD Display
      if (now - lastLCDUpdate >= 300) {
        lastLCDUpdate = now;
        updateLCD();
      }

      // Stream Live Real-Time Telemetry over TCP (100ms / 10Hz)
      if (now - lastTCPTelemetry >= TCP_TELEMETRY_INTERVAL) {
        lastTCPTelemetry = now;
        sendTCPTelemetry(client);
      }

      // Stream Real Data to Cloud Supabase (if STA internet is connected)
      if (now - lastTelemetrySync >= TELEMETRY_INTERVAL) {
        lastTelemetrySync = now;
        syncTelemetryToWebsiteCloud();
      }

      delay(5);
    }

    stopMotors();
    client.stop();
    Serial.println("Bridge / Joystick disconnected - STOP");
  }

  // 2. Autonomous Background Sensor Reading & ADAS Risk Loop (when no TCP client connected)
  if (now - lastSensorRead >= 100) {
    lastSensorRead = now;
    computeADASRisk();
  }

  // 3. Update 16x2 LCD Display (every 300ms)
  if (now - lastLCDUpdate >= 300) {
    lastLCDUpdate = now;
    updateLCD();
  }

  // 4. Stream Real Data to Cloud Supabase (every 2000ms, if connected)
  if (now - lastTelemetrySync >= TELEMETRY_INTERVAL) {
    lastTelemetrySync = now;
    syncTelemetryToWebsiteCloud();
  }

  delay(10);
}
