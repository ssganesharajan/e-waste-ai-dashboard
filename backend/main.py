import os
import sys
import io
import time
import json
import base64
from typing import Optional, List, Dict, Any
from pathlib import Path

# Fix Windows console UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import requests
import numpy as np
import tensorflow as tf
from PIL import Image

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config


# ==================================================
# App Initialization
# ==================================================

app = FastAPI(
    title="IoT E-Waste Classification AI",
    description="ESP32-CAM + MobileNetV2 TensorFlow Lite Intelligent E-Waste Sorting & Recommendation System",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================================================
# Global Runtime State
# ==================================================

current_esp32_url = config.ESP32_CAM_URL
scan_history: List[Dict[str, Any]] = []
MAX_HISTORY = 100


# ==================================================
# Load Classes & Knowledge Base
# ==================================================

def load_classes() -> List[Dict[str, Any]]:
    try:
        with open(config.CLASSES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("classes", [])
    except Exception as e:
        print(f"Error loading classes from {config.CLASSES_PATH}: {e}")
        # Default fallback classes
        return [
            {"id": i, "name": f"E-Waste Item #{i+1}", "hazard_level": "Low", "category": "Electronics"}
            for i in range(10)
        ]

CLASSES_DB = load_classes()
CLASS_MAP = {c["id"]: c for c in CLASSES_DB}


# ==================================================
# TensorFlow Lite Model Dynamic Management & State
# ==================================================

interpreter = None
input_details = None
output_details = None
input_height = 224
input_width = 224
input_dtype = np.float32

active_model_path = config.MODEL_PATH
active_model_name = Path(config.MODEL_PATH).name
model_loaded_time = time.strftime("%Y-%m-%d %H:%M:%S")


def initialize_tflite_model(model_path: str):
    """Dynamically loads and validates a TFLite model into memory without server restart."""
    global interpreter, input_details, output_details, input_height, input_width, input_dtype
    global active_model_path, active_model_name, model_loaded_time

    print(f"Loading TFLite model from {model_path}...")
    try:
        new_interpreter = tf.lite.Interpreter(model_path=model_path)
        new_interpreter.allocate_tensors()
        new_input_details = new_interpreter.get_input_details()
        new_output_details = new_interpreter.get_output_details()

        shape = new_input_details[0]["shape"]
        h = int(shape[1]) if len(shape) >= 3 else 224
        w = int(shape[2]) if len(shape) >= 3 else 224
        dtype = new_input_details[0]["dtype"]

        interpreter = new_interpreter
        input_details = new_input_details
        output_details = new_output_details
        input_height = h
        input_width = w
        input_dtype = dtype
        active_model_path = str(model_path)
        active_model_name = Path(model_path).name
        model_loaded_time = time.strftime("%Y-%m-%d %H:%M:%S")

        print("[OK] Model loaded successfully!")
        print(f"   Active model: {active_model_name}")
        print(f"   Input shape: {shape} ({input_width}x{input_height}), dtype: {input_dtype}")
        print(f"   Output shape: {output_details[0]['shape']}, dtype: {output_details[0]['dtype']}")
        return True, "Model loaded successfully"
    except Exception as e:
        print(f"[ERROR] Failed to load TFLite model from {model_path}: {e}")
        return False, str(e)


# Initial model load on startup
initialize_tflite_model(config.MODEL_PATH)



# ==================================================
# Image Preprocessing & Inference Helper
# ==================================================

def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """Preprocess image bytes into normalized numpy array for MobileNetV2."""
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image = image.resize((input_width, input_height), Image.Resampling.BILINEAR)
    image_array = np.array(image, dtype=np.float32)

    if input_dtype == np.float32:
        # Standard MobileNetV2 normalization: scale [0, 255] -> [-1, 1] or [0, 1]
        # Most Keras MobileNetV2 models expect [-1, 1] or [0, 1]
        image_array = image_array / 255.0
    elif input_dtype in [np.uint8, np.int8]:
        scale, zero_point = input_details[0]["quantization"]
        if scale != 0:
            image_array = (image_array / 255.0 / scale) + zero_point
        image_array = np.clip(image_array, np.iinfo(input_dtype).min, np.iinfo(input_dtype).max)
        image_array = image_array.astype(input_dtype)

    # Add batch dimension: (1, 224, 224, 3)
    return np.expand_dims(image_array, axis=0)


def softmax(x: np.ndarray) -> np.ndarray:
    """Compute softmax values for logits array."""
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum(axis=-1, keepdims=True)


def run_classification(image_bytes: bytes, source: str = "upload") -> Dict[str, Any]:
    """Runs inference on image bytes and enriches with e-waste recommendations."""
    if interpreter is None:
        raise HTTPException(
            status_code=500,
            detail="TFLite model interpreter is not initialized."
        )

    start_time = time.time()

    # Preprocess
    input_data = preprocess_image(image_bytes)

    # Run inference
    interpreter.set_tensor(input_details[0]["index"], input_data)
    interpreter.invoke()

    # Retrieve output
    raw_output = interpreter.get_tensor(output_details[0]["index"])
    logits = raw_output[0].flatten()

    # If logits don't sum to ~1.0, apply softmax
    if not (0.99 <= float(np.sum(logits)) <= 1.01 and np.all(logits >= 0)):
        probabilities = softmax(logits)
    else:
        probabilities = logits

    inference_time_ms = round((time.time() - start_time) * 1000, 2)

    # Top prediction
    top_class_id = int(np.argmax(probabilities))
    top_confidence = float(probabilities[top_class_id])

    # Top-3 predictions
    top_indices = np.argsort(probabilities)[::-1][:3]
    top_predictions = []
    for idx in top_indices:
        class_meta = CLASS_MAP.get(int(idx), {"name": f"Class {idx}", "icon": "📦", "hazard_level": "Low"})
        top_predictions.append({
            "id": int(idx),
            "name": class_meta.get("name", f"Class {idx}"),
            "icon": class_meta.get("icon", "📦"),
            "confidence": round(float(probabilities[idx]), 4),
            "confidence_percent": f"{round(float(probabilities[idx]) * 100, 1)}%",
            "hazard_level": class_meta.get("hazard_level", "Low")
        })

    # Get rich metadata for top prediction
    item_info = CLASS_MAP.get(top_class_id, {
        "id": top_class_id,
        "name": f"E-Waste Class {top_class_id}",
        "category": "General Electronics",
        "icon": "♻️",
        "hazard_level": "Low",
        "hazard_color": "#22c55e",
        "description": "Electronic device or component.",
        "recyclable_materials": ["Plastics", "Metals"],
        "hazardous_substances": ["Standard electronic components"],
        "recycling_steps": ["Deliver to designated e-waste drop-off."],
        "co2_savings_kg": 1.0,
        "material_recovery_rate": "90%",
        "reuse_potential": "Recycling"
    })

    # Generate thumbnail base64
    try:
        thumb = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        thumb.thumbnail((320, 240))
        thumb_buffer = io.BytesIO()
        thumb.save(thumb_buffer, format="JPEG", quality=75)
        thumb_b64 = "data:image/jpeg;base64," + base64.b64encode(thumb_buffer.getvalue()).decode("utf-8")
    except Exception:
        thumb_b64 = ""

    scan_result = {
        "id": f"scan_{int(time.time() * 1000)}",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": source,
        "inference_time_ms": inference_time_ms,
        "prediction": {
            "class_id": top_class_id,
            "name": item_info["name"],
            "category": item_info["category"],
            "icon": item_info["icon"],
            "confidence": round(top_confidence, 4),
            "confidence_percent": f"{round(top_confidence * 100, 1)}%",
            "hazard_level": item_info["hazard_level"],
            "hazard_color": item_info["hazard_color"],
            "description": item_info["description"],
            "recyclable_materials": item_info["recyclable_materials"],
            "hazardous_substances": item_info["hazardous_substances"],
            "recycling_steps": item_info["recycling_steps"],
            "co2_savings_kg": item_info.get("co2_savings_kg", 1.0),
            "material_recovery_rate": item_info.get("material_recovery_rate", "90%"),
            "reuse_potential": item_info.get("reuse_potential", "Standard Recycling")
        },
        "top_predictions": top_predictions,
        "thumbnail": thumb_b64
    }

    # Store in history
    scan_history.insert(0, scan_result)
    if len(scan_history) > MAX_HISTORY:
        scan_history.pop()

    return scan_result


# ==================================================
# ESP32-CAM Fetch Helper
# ==================================================

def fetch_esp32_image(timeout: int = 6) -> bytes:
    """Attempts to fetch snapshot from ESP32-CAM endpoint."""
    base = current_esp32_url.rstrip("/")
    candidate_urls = [
        f"{base}/capture",
        f"{base}/",
        f"{base}/cam-hi.jpg",
        f"{base}/jpg"
    ]

    last_err = None
    for url in candidate_urls:
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code == 200 and resp.content:
                # Verify it is an image
                try:
                    img = Image.open(io.BytesIO(resp.content))
                    img.verify()
                    return resp.content
                except Exception:
                    continue
        except requests.RequestException as e:
            last_err = e
            continue

    raise HTTPException(
        status_code=503,
        detail=f"Unable to connect to ESP32-CAM at {current_esp32_url}. Check if camera is powered on and connected to the same WiFi network. Error: {str(last_err)}"
    )


# ==================================================
# API Endpoints
# ==================================================

# --------------------------------------------------
# Authentication Endpoints
# --------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(creds: LoginRequest):
    """
    Authenticate user.
    Configured Credentials:
    User ID: Admin (or admin)
    Password: 12345678
    """
    user_clean = creds.username.strip()
    if user_clean.lower() == config.ADMIN_USER.lower() and creds.password == config.ADMIN_PASSWORD:
        return {
            "success": True,
            "token": config.AUTH_TOKEN,
            "user": {
                "id": "Admin",
                "username": "Admin",
                "role": "System Administrator",
                "permissions": ["all", "telemetry", "ai_inference", "model_upload", "cloud_config"]
            },
            "message": "Authentication successful"
        }
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid User ID or Password. Default is User: Admin / Pass: 12345678"
    )


@app.get("/api/auth/me")
def get_current_user():
    """Returns current active user session profile."""
    return {
        "authenticated": True,
        "user": {
            "id": "Admin",
            "username": "Admin",
            "role": "System Administrator",
            "permissions": ["all", "telemetry", "ai_inference", "model_upload", "cloud_config"]
        }
    }


@app.post("/api/auth/logout")
def logout():
    """Logs out session."""
    return {"success": True, "message": "Logged out successfully"}


# --------------------------------------------------
# AI Model Management Endpoints (Hot-Reloading)
# --------------------------------------------------

@app.get("/api/model/info")
def get_model_info():
    """Retrieve detailed metadata about currently active neural network model."""
    file_size_bytes = 0
    if os.path.exists(active_model_path):
        file_size_bytes = os.path.getsize(active_model_path)

    size_mb = round(file_size_bytes / (1024 * 1024), 2)
    in_shape = [int(x) for x in input_details[0]["shape"]] if input_details else [1, int(input_height), int(input_width), 3]
    out_shape = [int(x) for x in output_details[0]["shape"]] if output_details else []

    return {
        "model_name": active_model_name,
        "model_path": str(active_model_path),
        "size_bytes": int(file_size_bytes),
        "size_formatted": f"{size_mb} MB" if size_mb >= 1 else f"{round(file_size_bytes / 1024, 1)} KB",
        "loaded": interpreter is not None,
        "loaded_time": model_loaded_time,
        "input_shape": in_shape,
        "input_dtype": str(input_dtype),
        "output_shape": out_shape,
        "output_dtype": str(output_details[0]["dtype"]) if output_details else "",
        "architecture": "MobileNetV2 / TFLite Neural Classifier",
        "total_classes": len(CLASSES_DB)
    }



@app.post("/api/model/upload")
async def upload_model_file(
    model_file: UploadFile = File(...),
    classes_file: Optional[UploadFile] = File(None)
):
    """
    Upload and hot-reload a TensorFlow Lite (.tflite) model without server restart.
    Validates model tensors in memory before replacing active interpreter.
    """
    global CLASSES_DB, CLASS_MAP
    if not model_file.filename.lower().endswith(".tflite"):
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only TensorFlow Lite (.tflite) models are supported."
        )

    model_bytes = await model_file.read()
    if len(model_bytes) < 1000:
        raise HTTPException(
            status_code=400,
            detail="Uploaded model file is too small or corrupted."
        )

    # Ensure model directory exists
    os.makedirs(config.MODEL_DIR, exist_ok=True)
    clean_filename = "".join(c for c in model_file.filename if c.isalnum() or c in "._-")
    target_path = os.path.join(config.MODEL_DIR, clean_filename)

    # First write to a temporary file to validate
    temp_path = target_path + ".tmp"
    with open(temp_path, "wb") as f:
        f.write(model_bytes)

    # Validate model by instantiating test interpreter
    try:
        test_interpreter = tf.lite.Interpreter(model_path=temp_path)
        test_interpreter.allocate_tensors()
        test_interpreter.get_input_details()
        test_interpreter.get_output_details()
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(
            status_code=400,
            detail=f"TFLite model validation failed: {str(e)}"
        )

    # Backup prior model file if it existed
    if os.path.exists(target_path):
        backup_path = target_path + ".bak"
        try:
            if os.path.exists(backup_path):
                os.remove(backup_path)
            os.rename(target_path, backup_path)
        except Exception:
            pass

    os.rename(temp_path, target_path)

    # Handle optional classes JSON file
    if classes_file is not None:
        try:
            classes_bytes = await classes_file.read()
            classes_data = json.loads(classes_bytes.decode("utf-8"))
            if "classes" in classes_data:
                CLASSES_DB = classes_data["classes"]
                CLASS_MAP = {c["id"]: c for c in CLASSES_DB}
                with open(config.CLASSES_PATH, "w", encoding="utf-8") as f:
                    json.dump(classes_data, f, indent=2)
        except Exception as e:
            print(f"Warning: Failed to parse uploaded classes JSON: {e}")

    # Hot-reload model interpreter
    success, msg = initialize_tflite_model(target_path)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to hot-reload model: {msg}")

    return {
        "success": True,
        "message": f"TFLite model '{clean_filename}' uploaded and active in memory!",
        "model_info": get_model_info()
    }


@app.post("/api/model/reset")
def reset_default_model():
    """Restore default MobileNetV2 e-waste classification model."""
    success, msg = initialize_tflite_model(config.DEFAULT_MODEL_PATH)
    if not success:
        raise HTTPException(status_code=500, detail=f"Failed to restore default model: {msg}")
    return {
        "success": True,
        "message": "Default MobileNetV2 model restored successfully.",
        "model_info": get_model_info()
    }


# --------------------------------------------------
# System Status & Catalog Endpoints
# --------------------------------------------------

@app.get("/api/status")
def get_system_status():
    """System health and hardware status."""
    return {
        "status": "online",
        "service": "IoT E-Waste Classification AI",
        "esp32_cam_url": current_esp32_url,
        "model_loaded": interpreter is not None,
        "active_model": active_model_name,
        "input_shape": [input_height, input_width, 3],
        "total_classes": len(CLASSES_DB),
        "total_scans": len(scan_history)
    }


@app.get("/api/classes")
def get_classes():
    """Get all registered e-waste classes and their recycling guides."""
    return {"classes": CLASSES_DB}


# --------------------------------------------------
# ESP32 Management Endpoints
# --------------------------------------------------

class ESP32Config(BaseModel):
    url: str

@app.post("/api/esp32/update-url")
def update_esp32_url(config_data: ESP32Config):
    """Dynamically update ESP32-CAM URL."""
    global current_esp32_url
    new_url = config_data.url.strip()
    if not new_url.startswith("http://") and not new_url.startswith("https://"):
        new_url = f"http://{new_url}"
    current_esp32_url = new_url
    return {
        "success": True,
        "message": f"ESP32-CAM URL updated to {current_esp32_url}",
        "current_url": current_esp32_url
    }


@app.get("/api/esp32/ping")
def ping_esp32():
    """Test ping to ESP32-CAM."""
    start = time.time()
    try:
        img_bytes = fetch_esp32_image(timeout=3)
        latency = round((time.time() - start) * 1000, 1)
        return {
            "online": True,
            "latency_ms": latency,
            "url": current_esp32_url,
            "message": "ESP32-CAM is connected and responding!"
        }
    except Exception as e:
        return {
            "online": False,
            "url": current_esp32_url,
            "error": str(e),
            "message": "ESP32-CAM is unreachable."
        }


@app.get("/api/esp32/camera")
@app.get("/camera")
def get_esp32_camera_snapshot():
    """Fetch live camera frame from ESP32."""
    image_bytes = fetch_esp32_image()
    return Response(content=image_bytes, media_type="image/jpeg")


# --------------------------------------------------
# Classification Endpoints
# --------------------------------------------------

@app.post("/api/analyze-esp32")
@app.post("/analyze")
def analyze_from_esp32():
    """Captures snapshot directly from ESP32-CAM URL (Pull mode) and runs AI classification."""
    image_bytes = fetch_esp32_image()
    result = run_classification(image_bytes, source="ESP32-CAM (Pull)")
    return result


@app.post("/api/analyze-upload")
@app.post("/upload")
@app.post("/predict")
@app.post("/api/predict")
async def analyze_from_upload(
    request: Request,
    file: Optional[UploadFile] = File(None)
):
    """
    Handles both Multipart Form Uploads and Direct Binary Body streams from ESP32-CAM.
    Allows ESP32 to push images directly via POST /upload or POST /predict.
    """
    image_bytes = None

    if file is not None:
        image_bytes = await file.read()
    else:
        body = await request.body()
        if body and len(body) > 100:
            image_bytes = body

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="No image data provided. Send either multipart form file or raw JPEG body."
        )

    # Verify image integrity
    try:
        test_img = Image.open(io.BytesIO(image_bytes))
        test_img.verify()
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image format: {str(e)}"
        )

    result = run_classification(image_bytes, source="ESP32-CAM (Push) / Web Upload")
    return result


class Base64ImageRequest(BaseModel):
    image: str
    source: Optional[str] = "Webcam Stream"

@app.post("/api/analyze-base64")
def analyze_from_base64(req: Base64ImageRequest):
    """Analyzes Base64 encoded image string (e.g. from canvas / browser webcam)."""
    try:
        raw_b64 = req.image
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(raw_b64)
        result = run_classification(image_bytes, source=req.source or "Webcam")
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process base64 image: {str(e)}")


# --------------------------------------------------
# History & Statistics Endpoints
# --------------------------------------------------

@app.get("/api/history")
def get_history(limit: int = 20):
    """Retrieve scan history."""
    return {"history": scan_history[:limit], "total_recorded": len(scan_history)}


@app.post("/api/history/clear")
def clear_history():
    """Clear in-memory scan history."""
    global scan_history
    scan_history = []
    return {"success": True, "message": "Scan history cleared."}


@app.get("/api/stats")
def get_stats():
    """Calculate aggregate sustainability and recycling impact stats."""
    total_scans = len(scan_history)
    total_co2 = sum(item["prediction"].get("co2_savings_kg", 0) for item in scan_history)
    
    hazard_counts = {"High": 0, "Moderate": 0, "Low": 0}
    category_counts = {}

    for item in scan_history:
        hazard = item["prediction"].get("hazard_level", "Low")
        hazard_counts[hazard] = hazard_counts.get(hazard, 0) + 1

        name = item["prediction"].get("name", "Unknown")
        category_counts[name] = category_counts.get(name, 0) + 1

    return {
        "total_scans": total_scans,
        "total_co2_saved_kg": round(total_co2, 2),
        "hazard_distribution": hazard_counts,
        "top_item": max(category_counts, key=category_counts.get) if category_counts else "None",
        "category_counts": category_counts
    }


# ==================================================
# Mount Static Frontend
# ==================================================

frontend_path = Path(config.FRONTEND_DIR)

# Mount /static directory if directory exists
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=str(frontend_path)), name="static")


@app.get("/")
def serve_frontend_root():
    """Serves the main EcoSort IoT Dashboard UI."""
    index_file = frontend_path / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    
    # Check alternate locations
    alt_index = Path("frontend/index.html")
    if alt_index.exists():
        return FileResponse(str(alt_index))

    return {
        "status": "online",
        "service": "IoT E-Waste Classification AI",
        "message": "EcoSort AI Backend is running. Frontend index.html not located at expected path.",
        "searched_path": str(frontend_path),
        "api_docs": "/docs",
        "esp32_cam": current_esp32_url
    }



# ==================================================
# Main Execution Entrypoint
# ==================================================

if __name__ == "__main__":
    import uvicorn
    print(f"Starting E-Waste AI Backend on http://{config.HOST}:{config.PORT}")
    uvicorn.run("main:app", host=config.HOST, port=config.PORT, reload=True)