#include <WiFi.h>

const char* ssid = "HelloESP32";
const char* password = "12345678";

const char* vehicleIP = "192.168.4.1";
const int vehiclePort = 3333;

// Joystick pins
#define VRX 34
#define VRY 35
#define SW 32

WiFiClient client;

// Joystick center
int centerX;
int centerY;

// Smaller deadzone = easier movement
const int DEADZONE = 300;

unsigned long lastSend = 0;


// =====================================================
// CONNECT TO VEHICLE
// =====================================================

void connectVehicle() {

  while (!client.connected()) {

    Serial.println("Connecting to vehicle...");

    client.stop();

    if (client.connect(vehicleIP, vehiclePort)) {

      Serial.println("VEHICLE CONNECTED");

      // Start safely
      client.write('S');

    } else {

      Serial.println("Connection failed");
      delay(500);
    }
  }
}


// =====================================================
// SETUP
// =====================================================

void setup() {

  Serial.begin(115200);

  pinMode(SW, INPUT_PULLUP);

  delay(1000);


  // Read joystick center
  centerX = analogRead(VRX);
  centerY = analogRead(VRY);

  Serial.print("CENTER X = ");
  Serial.println(centerX);

  Serial.print("CENTER Y = ");
  Serial.println(centerY);


  // WiFi
  WiFi.mode(WIFI_STA);

  WiFi.begin(ssid, password);

  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.println("WiFi Connected");


  connectVehicle();
}


// =====================================================
// LOOP
// =====================================================

void loop() {

  // Check WiFi
  if (WiFi.status() != WL_CONNECTED) {

    Serial.println("WiFi LOST");

    WiFi.disconnect();
    WiFi.begin(ssid, password);

    delay(500);

    return;
  }


  // Check vehicle connection
  if (!client.connected()) {

    Serial.println("VEHICLE CONNECTION LOST");

    connectVehicle();

    return;
  }


  // Read joystick
  int x = analogRead(VRX);
  int y = analogRead(VRY);

  int button = digitalRead(SW);

  char command = 'S';


  // ===================================================
  // JOYSTICK MOVEMENT
  // ===================================================

  if (button == LOW) {

    command = 'S';
  }

  // Forward
  else if (y > centerY + DEADZONE) {

    command = 'F';
  }

  // Backward
  else if (y < centerY - DEADZONE) {

    command = 'B';
  }

  // Left
  else if (x < centerX - DEADZONE) {

    command = 'L';
  }

  // Right
  else if (x > centerX + DEADZONE) {

    command = 'R';
  }

  // Center
  else {

    command = 'S';
  }


  // ===================================================
  // SEND CONTINUOUSLY
  // ===================================================

  if (millis() - lastSend >= 50) {

    client.write(command);

    lastSend = millis();

    Serial.print("X=");
    Serial.print(x);

    Serial.print(" Y=");
    Serial.print(y);

    Serial.print(" COMMAND=");

    Serial.println(command);
  }
}
