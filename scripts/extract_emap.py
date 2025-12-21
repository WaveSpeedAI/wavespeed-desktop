#!/usr/bin/env python3
"""
Extract EMAP matrix from inswapper_128.onnx model.

The EMAP matrix is stored as an initializer and is used to transform
ArcFace embeddings before feeding to the inswapper model.

Usage:
    python extract_emap.py [input_path] [output_path]

If no arguments provided, downloads from HuggingFace and saves emap.bin to current directory.
"""

import sys
import os
import struct
import numpy as np

try:
    import onnx
except ImportError:
    print("Please install onnx: pip install onnx")
    sys.exit(1)


def extract_emap(model_path: str) -> np.ndarray:
    """
    Extract EMAP matrix from inswapper ONNX model.
    Returns the emap matrix as a numpy array.
    """
    print(f"Loading model from {model_path}...")
    model = onnx.load(model_path)

    # List all initializers to help debug
    print(f"\nFound {len(model.graph.initializer)} initializers:")
    for ini in model.graph.initializer:
        shape = list(ini.dims)
        # Look for 512x512 matrices that could be emap
        if len(shape) == 2 and shape[0] == 512 and shape[1] == 512:
            print(f"  ** {ini.name}: {shape} (POTENTIAL EMAP)")
        elif 'emap' in ini.name.lower():
            print(f"  ** {ini.name}: {shape} (NAME MATCH)")
        else:
            # Only print first few for brevity
            pass

    # Find emap initializer - check various possible names
    emap_names = ['emap', 'Emap', 'EMAP', 'e_map', 'embedding_map']

    for initializer in model.graph.initializer:
        # Check by name
        if initializer.name in emap_names or 'emap' in initializer.name.lower():
            print(f"\nFound EMAP by name: {initializer.name}")
            emap = onnx.numpy_helper.to_array(initializer)
            print(f"  Shape: {emap.shape}, Dtype: {emap.dtype}")
            return emap

        # Check by shape (512x512 matrix)
        shape = list(initializer.dims)
        if len(shape) == 2 and shape[0] == 512 and shape[1] == 512:
            print(f"\nFound 512x512 matrix: {initializer.name}")
            emap = onnx.numpy_helper.to_array(initializer)
            print(f"  Shape: {emap.shape}, Dtype: {emap.dtype}")
            print(f"  Min: {emap.min():.6f}, Max: {emap.max():.6f}")
            return emap

    # Print all initializer names for debugging
    print("\nAll initializer names:")
    for ini in model.graph.initializer[:20]:  # First 20
        print(f"  {ini.name}: {list(ini.dims)}")
    if len(model.graph.initializer) > 20:
        print(f"  ... and {len(model.graph.initializer) - 20} more")

    raise ValueError("EMAP initializer not found in model")


def save_binary(emap: np.ndarray, output_path: str):
    """Save emap as raw binary float32 file."""
    # Ensure float32
    emap_f32 = emap.astype(np.float32)

    with open(output_path, 'wb') as f:
        f.write(emap_f32.tobytes())

    print(f"Saved EMAP to {output_path}")
    print(f"  Size: {os.path.getsize(output_path)} bytes")


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
    # Use the non-fp16 version which contains the emap initializer
    MODEL_URL = "https://huggingface.co/ezioruan/inswapper_128.onnx/resolve/main/inswapper_128.onnx"

    if len(sys.argv) >= 3:
        input_path = sys.argv[1]
        output_path = sys.argv[2]
    elif len(sys.argv) == 2:
        input_path = sys.argv[1]
        output_path = "emap.bin"
    else:
        # Download from HuggingFace
        input_path = "inswapper_128.onnx"
        output_path = "emap.bin"

        if not os.path.exists(input_path):
            download_model(MODEL_URL, input_path)

    if not os.path.exists(input_path):
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)

    emap = extract_emap(input_path)
    save_binary(emap, output_path)

    print(f"\nEMAP matrix extracted successfully!")
    print(f"Upload {output_path} to your hosting and update EMAP_URL in faceSwapper.worker.ts")


if __name__ == "__main__":
    main()
