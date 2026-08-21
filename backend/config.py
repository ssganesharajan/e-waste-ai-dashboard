import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

ADMIN_USER = os.getenv("ADMIN_USER", "Admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "12345678")
AUTH_TOKEN = os.getenv("AUTH_TOKEN", "ecosort_admin_token_2026")

ESP32_CAM_URL = os.getenv("ESP32_CAM_URL", "http://10.92.50.153")
MODEL_DIR = BASE_DIR / "model"
MODEL_PATH = str(MODEL_DIR / "e_waste_classifier.tflite")
DEFAULT_MODEL_PATH = str(MODEL_DIR / "e_waste_classifier.tflite")
CLASSES_PATH = str(BASE_DIR / "classes.json")
def find_frontend_dir() -> Path:
    candidates = [
        BASE_DIR.parent / "frontend",
        BASE_DIR / "frontend",
        Path.cwd() / "frontend",
        Path.cwd()
    ]
    for p in candidates:
        if p.exists() and (p / "index.html").exists():
            return p
    return BASE_DIR.parent / "frontend"

FRONTEND_DIR = str(find_frontend_dir())

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))


