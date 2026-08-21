"""API Integration Test for FastAPI E-Waste Classification Backend."""
import os
import sys
import io
import json
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient

# Fix console encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import config
from main import app

client = TestClient(app)

def test_all_endpoints():
    print("========================================")
    print("    FASTAPI ENDPOINT INTEGRATION TEST   ")
    print("========================================")

    # 1. Root / Frontend Static Check
    print("1. Testing GET / (Root & Static UI)...")
    res = client.get("/")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    print(f"   [PASS] GET / -> Status {res.status_code}")

    # 2. Authentication Tests
    print("\n2a. Testing POST /api/auth/login with Admin / 12345678...")
    res_login = client.post("/api/auth/login", json={"username": "Admin", "password": "12345678"})
    assert res_login.status_code == 200, f"Login failed: {res_login.text}"
    login_data = res_login.json()
    assert login_data["success"] is True
    assert login_data["user"]["username"] == "Admin"
    print(f"   [PASS] Login Success! User: {login_data['user']['username']}, Token: {login_data['token']}")

    print("2b. Testing POST /api/auth/login with case-insensitive 'admin'...")
    res_login_lower = client.post("/api/auth/login", json={"username": "admin", "password": "12345678"})
    assert res_login_lower.status_code == 200

    print("2c. Testing POST /api/auth/login with invalid password...")
    res_invalid = client.post("/api/auth/login", json={"username": "Admin", "password": "wrongpassword"})
    assert res_invalid.status_code == 401
    print("   [PASS] Invalid password correctly rejected (401 Unauthorized).")

    print("2d. Testing GET /api/auth/me...")
    res_me = client.get("/api/auth/me")
    assert res_me.status_code == 200
    assert res_me.json()["user"]["username"] == "Admin"

    # 3. System Status Check
    print("\n3. Testing GET /api/status...")
    res = client.get("/api/status")
    assert res.status_code == 200
    data = res.json()
    assert data["model_loaded"] is True
    print(f"   [PASS] Model Loaded: {data['model_loaded']}, Active Model: {data.get('active_model')}, Total Classes: {data['total_classes']}")

    # 4. Classes Database Check
    print("\n4. Testing GET /api/classes...")
    res = client.get("/api/classes")
    assert res.status_code == 200
    classes = res.json()["classes"]
    assert len(classes) >= 10
    print(f"   [PASS] Retrieved {len(classes)} e-waste classes.")

    # 5. AI Model Info & Hot-Reload Tests
    print("\n5a. Testing GET /api/model/info...")
    res_m = client.get("/api/model/info")
    assert res_m.status_code == 200
    minfo = res_m.json()
    assert minfo["loaded"] is True
    print(f"   [PASS] Active Model: {minfo['model_name']} ({minfo['size_formatted']}), Input Shape: {minfo['input_shape']}")

    print("5b. Testing POST /api/model/upload with active tflite model...")
    with open(config.MODEL_PATH, "rb") as f:
        tflite_bytes = f.read()

    res_upload_m = client.post(
        "/api/model/upload",
        files={"model_file": ("custom_e_waste_v2.tflite", io.BytesIO(tflite_bytes), "application/octet-stream")}
    )
    assert res_upload_m.status_code == 200, f"Model upload failed: {res_upload_m.text}"
    upload_res = res_upload_m.json()
    assert upload_res["success"] is True
    assert upload_res["model_info"]["model_name"] == "custom_e_waste_v2.tflite"
    print(f"   [PASS] Model Uploaded & Hot-Reloaded: {upload_res['model_info']['model_name']}")

    print("5c. Testing POST /api/model/reset...")
    res_reset = client.post("/api/model/reset")
    assert res_reset.status_code == 200
    print(f"   [PASS] Model Reset to Factory Default: {res_reset.json()['model_info']['model_name']}")

    # 6. Manual Image Upload Analysis Test (Multipart Form)
    print("\n6a. Testing POST /api/analyze-upload (Manual Multipart Upload)...")
    img_array = np.random.randint(40, 220, (224, 224, 3), dtype=np.uint8)
    img = Image.fromarray(img_array)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    raw_jpeg = buf.getvalue()

    res = client.post(
        "/api/analyze-upload",
        files={"file": ("manual_circuit_sample.jpg", io.BytesIO(raw_jpeg), "image/jpeg")}
    )
    assert res.status_code == 200, f"Error: {res.text}"
    scan_res = res.json()
    print(f"   [PASS] Manual Image Ingest: {scan_res['prediction']['name']} ({scan_res['prediction']['confidence_percent']})")

    # 6b. Direct Binary Stream Push Test
    print("\n6b. Testing POST /upload (Raw Binary Stream)...")
    res_push = client.post(
        "/upload",
        content=raw_jpeg,
        headers={"Content-Type": "image/jpeg"}
    )
    assert res_push.status_code == 200, f"Error: {res_push.text}"
    push_res = res_push.json()
    print(f"   [PASS] Raw Stream Push: {push_res['prediction']['name']} ({push_res['prediction']['confidence_percent']})")

    # 7. History & Stats Test
    print("\n7. Testing GET /api/history & GET /api/stats...")
    res_hist = client.get("/api/history")
    assert res_hist.status_code == 200
    assert len(res_hist.json()["history"]) >= 1

    res_stats = client.get("/api/stats")
    assert res_stats.status_code == 200
    stats = res_stats.json()
    print(f"   [PASS] Total Scans Logged: {stats['total_scans']}, CO2 Saved: {stats['total_co2_saved_kg']} kg")

    # 8. ESP32 URL Update Test
    print("\n8. Testing POST /api/esp32/update-url...")
    res_url = client.post("/api/esp32/update-url", json={"url": "http://10.92.50.153"})
    assert res_url.status_code == 200
    print(f"   [PASS] Current ESP32 URL: {res_url.json()['current_url']}")

    print("\n========================================")
    print("   ALL API INTEGRATION TESTS PASSED!    ")
    print("========================================")

if __name__ == "__main__":
    test_all_endpoints()
