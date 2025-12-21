#!/usr/bin/env python3
"""
Patch det_10g.onnx model to fix ceil_mode=1 in AveragePool nodes.

ONNX Runtime Web doesn't support AveragePool with ceil_mode=1.
This script changes all ceil_mode attributes from 1 to 0.

Usage:
    python patch_det10g.py [input_path] [output_path]

If no arguments provided, downloads from HuggingFace and saves to current directory.
"""

import sys
import os

try:
    import onnx
except ImportError:
    print("Please install onnx: pip install onnx")
    sys.exit(1)


def patch_ceil_mode(model_path: str, output_path: str) -> int:
    """
    Patch AveragePool nodes to remove ceil_mode attribute.
    ONNX defaults ceil_mode to 0 when not specified.

    Returns the number of nodes patched.
    """
    print(f"Loading model from {model_path}...")
    model = onnx.load(model_path)

    patch_count = 0

    for node in model.graph.node:
        if node.op_type == "AveragePool":
            # Find and remove ceil_mode attribute
            for i, attr in enumerate(node.attribute):
                if attr.name == "ceil_mode":
                    print(f"  Removing ceil_mode from node '{node.name}' (was {attr.i})")
                    del node.attribute[i]
                    patch_count += 1
                    break

    if patch_count > 0:
        print(f"Saving patched model to {output_path}...")
        onnx.save(model, output_path)
        print(f"Done! Removed ceil_mode from {patch_count} AveragePool node(s).")
    else:
        print("No AveragePool nodes with ceil_mode found.")

    return patch_count


def download_model(url: str, output_path: str):
    """Download model from URL."""
    try:
        import requests
    except ImportError:
        print("Please install requests: pip install requests")
        sys.exit(1)

    print(f"Downloading model from {url}...")
    response = requests.get(url, stream=True)
    response.raise_for_status()

    total_size = int(response.headers.get('content-length', 0))
    downloaded = 0

    with open(output_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
            downloaded += len(chunk)
            if total_size > 0:
                pct = (downloaded / total_size) * 100
                print(f"\r  Downloaded: {downloaded / 1024 / 1024:.1f} MB / {total_size / 1024 / 1024:.1f} MB ({pct:.1f}%)", end="")

    print("\n  Download complete!")


def main():
    MODEL_URL = "https://huggingface.co/fofr/comfyui/resolve/main/insightface/models/buffalo_l/det_10g.onnx"

    if len(sys.argv) >= 3:
        input_path = sys.argv[1]
        output_path = sys.argv[2]
    elif len(sys.argv) == 2:
        input_path = sys.argv[1]
        output_path = input_path.replace(".onnx", "_patched.onnx")
    else:
        # Download from HuggingFace
        input_path = "det_10g.onnx"
        output_path = "det_10g_patched.onnx"

        if not os.path.exists(input_path):
            download_model(MODEL_URL, input_path)

    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)

    patch_count = patch_ceil_mode(input_path, output_path)

    if patch_count > 0:
        print(f"\nPatched model saved to: {output_path}")
        print("Upload this file to your hosting and update DET_10G_MODEL_URL in faceSwapper.worker.ts")


if __name__ == "__main__":
    main()
