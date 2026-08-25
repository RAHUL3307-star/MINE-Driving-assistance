# 🛡️ OREGUARD — Mine Vehicle ADAS & Safety Layer

**Visibility-Aware Collision Prevention System for Underground & Surface Mine Vehicles**  
*Built for Smart India Hackathon (SIH 2025)*

---

## 📌 Overview

Underground and surface mining vehicles (e.g. **MV-07**) operate in extreme dust, fog, and low-visibility conditions where conventional driver perception is severely compromised. 

**OREGUARD** provides an intelligent safety layer that continuously calculates dynamic collision risk based on real-time atmospheric visibility and obstacle proximity, autonomously triggering warnings and adaptive vehicle interventions before an incident occurs.

---

## 🚀 Key Features

- **Real-Time Sensor Fusion**: 6 ultrasonic proximity sensors + optical LDR visibility stream.
- **Dynamic Risk Engine**: Weighted algorithm that automatically recalculates risk and escalates warning thresholds as visibility drops.
- **Active Radar Sweep**: Interactive radar monitor with live obstacle tracking and sector alerts.
- **Acoustic ADAS Warning**: Web Audio API-synthesized tones that escalate in pitch and urgency based on threat severity.
- **Analytics & Incident Audit**: Timestamped telemetry history, correlation curves, and CSV export.
- **Operator Safety Console**: Configurable risk multipliers, emergency stop override, and calibration settings.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 (Modern Design System), JavaScript (ES6+ Web APIs)
- **Audio Engine**: Web Audio API (real-time synthesized ADAS alarm tones)
- **Data Visualization**: HTML5 Canvas (real-time trend curves & telemetry metrics)
- **Hardware Integration**: ESP32 Microcontroller telemetry protocol

---

## 🏃 Quick Start

### 1. Run with Node.js
```bash
node server.js
```
Open **[http://localhost:5173/landing.html](http://localhost:5173/landing.html)** or **[http://localhost:5173/index.html](http://localhost:5173/index.html)** in your browser.

### 2. Run with Python
```bash
python -m http.server 5173
```

---

## 📁 Project Structure

```
├── landing.html       # Public landing page with live telemetry HUD preview
├── index.html         # Main operator safety console & live operations dashboard
├── login.html         # Standalone operator authentication page
├── app.js             # Core application state, risk engine calculation & simulation
├── style.css          # Design tokens, typography, responsive styling & radar animations
├── server.js          # Lightweight local static server
└── README.md          # Project documentation
```

---

## 🏆 Smart India Hackathon (SIH 2025)
- **Vehicle Unit**: MV-07 (Pit 03)
- **Core Principle**: *"See the risk before it arrives."*
