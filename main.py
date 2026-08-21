"""Root entrypoint proxy for cloud deployment (Render, Railway, Heroku, etc.)."""
import os
import sys
from pathlib import Path

# Ensure backend directory is in python path
BASE_DIR = Path(__file__).resolve().parent
backend_dir = str(BASE_DIR / "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from backend.main import app

if __name__ == "__main__":
    import uvicorn
    import config
    port = int(os.environ.get("PORT", config.PORT))
    print(f"Starting server on port {port}...")
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=False)
