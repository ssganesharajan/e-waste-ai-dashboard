# EcoSort AI: IoT-Based E-Waste Classification & Recycling Guide

An intelligent IoT and AI-driven Electronic Waste Classification platform powered by **ESP32-CAM**, **MobileNetV2 (TensorFlow Lite)**, **FastAPI**, and a modern ThingsBoard-style dark dashboard.

---

## 🌟 Key Features

1. **Secure Admin Authentication**:
   - Protected cloud telemetry & model management.
   - **Default Credentials**:
     - **User ID**: `Admin`
     - **Password**: `12345678`
   - Persistent session storage, user profile badge, and one-click demo credentials auto-fill.

2. **AI-Powered E-Waste Classification**:
   - Classifies 10 core electronic waste categories with MobileNetV2 TensorFlow Lite (`e_waste_classifier.tflite`).
   - Computes multi-class confidence scores, top-3 candidates, and inference execution latency.

3. **Dynamic AI Model Uploader & Hot-Reloading**:
   - Upload new `.tflite` models directly from the UI without restarting the server.
   - Automatic in-memory tensor validation, input shape detection, and hot-swap.
   - One-click factory default model reset.

4. **Multi-Input Ingestion & Manual Image Uploader**:
   - **Manual Image Upload Hub**: Drag & drop or browse image files (JPEG, PNG, WebP, BMP) with instant preview and classification.
   - **ESP32-CAM Live Feed & Capture**: Queries snapshot stream directly from `http://10.92.50.153/capture` or receives POST push streams at `/upload`.
   - **Local Web Camera**: Direct frame capture from laptop or mobile webcam.

5. **Comprehensive E-Waste Recommendations & Knowledge Engine**:
   - **Hazard Rating**: 🔴 High, 🟡 Moderate, 🟢 Low.
   - **Valuable Materials**: Gold, Silver, Palladium, Copper, Lithium, Cobalt, Neodymium, Aluminum.
   - **Hazardous Toxins Alert**: Lead, Mercury, Cadmium, BFRs, Sulfuric Acid.
   - **Actionable Steps**: Step-by-step disassembly, safety precautions, and recycling facility routing.
   - **Environmental Impact**: Real-time estimated $\text{CO}_2$ emissions prevented and material recovery percentages.

6. **Interactive Industrial Telemetry Dashboard**:
   - Real-time KPI ribbons, sustainability analytics, 10-class catalog, scan history with CSV export, and ESP32 hardware manager.

---

## 🗂️ Project Structure

```
e-waste-ai-dashboard/
├── backend/
│   ├── config.py             # Server, Auth & IoT configuration
│   ├── classes.json          # 10 E-Waste classes knowledge base & recycling guides
│   ├── main.py               # FastAPI backend, Auth & TFLite inference engine
│   ├── requirements.txt      # Python dependencies
│   ├── test_inference.py     # Unit test for model inference
│   ├── test_api.py           # Integration tests for FastAPI endpoints
│   └── model/
│       └── e_waste_classifier.tflite # Trained MobileNetV2 model
├── frontend/
│   ├── index.html            # ThingsBoard-style Dashboard UI & Admin Login
│   ├── css/
│   │   └── style.css         # Industrial dark theme & responsive layout
│   └── js/
│       └── app.js            # Client logic (Auth, Model Hub, Uploads, ESP32 stream, Charts)
└── esp32/
    └── esp32_cam_firmware.ino # Arduino C++ firmware for AI-Thinker ESP32-CAM
```

---

## 🚀 Getting Started

### 1. Install Backend Dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Start the FastAPI Server
```bash
python main.py
```
*Or using uvicorn:*
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:8000
```
Log in using:
- **User ID**: `Admin`
- **Password**: `12345678`

---

## 📷 Setting up ESP32-CAM

1. Open `esp32/esp32_cam_firmware.ino` in Arduino IDE.
2. Select Board: `AI Thinker ESP32-CAM`.
3. Update your WiFi credentials:
   ```cpp
   const char* ssid     = "YOUR_WIFI_SSID";
   const char* password = "YOUR_WIFI_PASSWORD";
   ```
4. Flash the code to ESP32-CAM.
5. Note the IP assigned (e.g. `10.92.50.153`) and enter it in the dashboard under the **Device & AI Setup** tab.

---

## 🔬 Supported E-Waste Classes

| # | Item Name | Hazard Level | Key Recyclable Materials |
|---|---|---|---|
| 0 | **Battery** | 🔴 High | Lithium, Cobalt, Nickel, Copper |
| 1 | **Cable & Wires** | 🟢 Low | High-purity Copper, Aluminum |
| 2 | **Circuit Board / PCB** | 🟡 Moderate | Gold, Silver, Palladium, Tantalum, Copper |
| 3 | **Mobile Phone & Tablet** | 🟡 Moderate | Gold, Rare Earths, Lithium, Aluminum |
| 4 | **Laptop & Computer** | 🟡 Moderate | Aluminum, Copper heat pipes, Gold, Silicon |
| 5 | **Keyboard & Mouse** | 🟢 Low | ABS Plastics, Copper switches, Silicone |
| 6 | **Monitor & Display** | 🔴 High | Indium Tin Oxide, Optical Glass, Aluminum |
| 7 | **Charger & Power Adapter** | 🟢 Low | Copper transformers, Ferrite cores |
| 8 | **Headphones & Audio Gear** | 🟢 Low | Neodymium magnets, Voice coils, Steel |
| 9 | **Storage Devices (HDD/SSD/CD)** | 🟢 Low | Aluminum platters, Neodymium magnets, Silicon |
