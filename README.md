# 🛡️ OREGUARD — Mine Vehicle ADAS & Safety Layer

> **Visibility-Aware Collision Prevention & Intelligent ADAS Layer for Underground & Surface Mine Vehicles**
> *Developed for Smart India Hackathon (SIH 2025)*

---

## 📖 Overview

In underground mining environments, thick dust clouds, heavy fog, and near-zero visibility conditions create critical collision risks for heavy mining machinery. Standard collision detection systems rely on static distance thresholds, which fail to compensate for the delayed human reaction times and longer braking distances required in degraded atmospheric conditions.

**OREGUARD** is a dynamic, visibility-aware **Advanced Driver Assistance System (ADAS)** and safety layer. It fuses optical visibility sensors with multi-sector ultrasonic telemetry and real-time speed data through an intelligent dynamic risk engine, automatically recalculating safety thresholds, providing graded acoustic warnings, and enforcing emergency braking interventions when hazard thresholds are breached.

---

## ✨ Key Features

- **🌐 Dynamic Risk Calculation Engine**:
  - Dynamically weights atmospheric visibility attenuation with obstacle proximity and vehicle speed.
  - Escalates risk scores faster under dense dust/fog conditions ($Multiplier = 1.0 + visHazard \times 1.8$).
- **📡 Active Sensor Radar Monitor**:
  - 360° forward optical and ultrasonic sweep visualization with live target tracking.
- **⚡ 4-Level ADAS Intervention Model**:
  - `SAFE`: Full nominal travel speed permitted.
  - `WARNING`: Visual alerts and pulsing acoustic tone advisory.
  - `HIGH RISK`: Adaptive speed governor automatically cuts speed.
  - `CRITICAL / E-STOP`: Autonomous emergency brake intervention immobilizes vehicle.
- **📊 Real-Time Analytics & Audit Trail**:
  - Interactive canvas trend charts for telemetry correlation (Risk vs. Visibility, Speed vs. Braking Buffer).
  - Timestamped incident logging with instant CSV export for safety audits.
- **🎮 4 Operational Demo Scenarios**:
  - *Normal Clear* (85% vis · 4.2m dist · Nominal speed)
  - *Dust Degraded* (55% vis · 2.8m dist · Advisory slowdown)
  - *Poor Fog* (35% vis · 1.8m dist · Speed cut applied)
  - *Emergency Near* (18% vis · 0.7m dist · E-stop intervention)
- **🔧 Configurable Thresholds**:
  - Adjust visibility sensitivity, emergency stop distances, and fog risk multipliers on the fly.
  - Recalibrate optical sensor zero-points directly through the UI.

---

## 🛠️ Tech Stack & Architecture

- **Frontend**: HTML5, Vanilla JavaScript (ES6+), Modern Responsive CSS (Design Tokens, Glassmorphism)
- **Visuals & Charts**: Custom HTML5 Canvas rendering engine for real-time risk timelines & distribution bars
- **Audio Engine**: Web Audio API synthesizer for variable-frequency acoustic ADAS collision beeps
- **Hardware Telemetry Node**: ESP32 Microcontroller (Optical LDR Attenuation Sensor + Ultrasonic Sensor Array)
- **Server**: Lightweight Node.js / Python static HTTP server

---

## 🚀 Quick Start & Local Run

### Prerequisites
- Node.js (v16+) or Python 3.8+
- Any modern web browser (Chrome, Edge, Firefox, Safari)

### Running Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/RAHUL3307-star/Mine-Driving-Assistance.git
   cd Mine-Driving-Assistance
   ```

2. **Start the local server**:
   Using Node.js:
   ```bash
   node server.js
   ```
   *Or using Python:*
   ```bash
   python server.py
   ```

3. **Open in browser**:
   - **Landing Page**: [http://localhost:5173/landing.html](http://localhost:5173/landing.html)
   - **ADAS Safety Console**: [http://localhost:5173/index.html](http://localhost:5173/index.html)

---

## 📐 Mathematical Formulation

The dynamic risk score is calculated in real-time according to:

$$\text{RawRisk} = (H_{vis} \times 0.35) + (H_{prox}^{2.3} \times 0.50) + (H_{spd} \times 0.15)$$

$$\text{DynamicMultiplier} = 1.0 + \left(H_{vis} \times (\mu - 1.0)\right)$$

$$\text{RiskScore} = \min(100, \text{RawRisk} \times \text{DynamicMultiplier} \times 100)$$

Dynamic braking buffer includes an adaptive fog margin:
$$\text{BrakingDistance} = 1.2 + (V \times 0.18) + (1.0 - \text{Vis}_{norm}) \times 1.5$$

---

## 👨‍💻 Author

- **Rahul J** ([@RAHUL3307-star](https://github.com/RAHUL3307-star))
- Smart India Hackathon (SIH 2025)

---

## 📄 License
This project is licensed under the MIT License.
