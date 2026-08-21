"""Test script for verifying E-Waste TFLite model inference and recommendation pipeline."""
import sys
import io
import json
import numpy as np
from PIL import Image

# Fix Windows console UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import config
from main import run_classification, CLASSES_DB

def create_synthetic_test_image():
    """Generates a dummy 224x224 RGB image for testing inference pipeline."""
    img_array = np.random.randint(50, 200, (224, 224, 3), dtype=np.uint8)
    img = Image.fromarray(img_array)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()

def run_tests():
    print("========================================")
    print("  E-WASTE AI CLASSIFIER INFERENCE TEST  ")
    print("========================================")
    print(f"Total Registered Classes: {len(CLASSES_DB)}")
    for c in CLASSES_DB:
        print(f" - [{c['id']}] {c['name']} (Hazard: {c['hazard_level']})")

    print("\nGenerating synthetic image and running classification...")
    image_bytes = create_synthetic_test_image()
    
    result = run_classification(image_bytes, source="Synthetic Test Image")
    
    print("\n[SUCCESS] Classification Successful!")
    print(f"  Prediction       : {result['prediction']['name']}")
    print(f"  Category         : {result['prediction']['category']}")
    print(f"  Confidence       : {result['prediction']['confidence_percent']}")
    print(f"  Hazard Level     : {result['prediction']['hazard_level']}")
    print(f"  Inference Time   : {result['inference_time_ms']} ms")
    print(f"  Recyclable Metals: {', '.join(result['prediction']['recyclable_materials'][:3])}")
    print(f"  CO2 Offset       : {result['prediction']['co2_savings_kg']} kg")
    print("\nTop 3 Predictions:")
    for p in result['top_predictions']:
        print(f"  - {p['name']}: {p['confidence_percent']}")

    print("\nAll verification tests passed successfully!")

if __name__ == "__main__":
    run_tests()
