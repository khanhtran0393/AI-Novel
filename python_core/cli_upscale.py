import sys
import json
import argparse
from PIL import Image

def run_upscale(image_path, out_path, target_height):
    try:
        img = Image.open(image_path).convert('RGB')
        width, height = img.size

        target_height = int(target_height)
        if target_height <= 0:
            raise ValueError("Target height must be greater than zero")

        scale = max(1.0, float(target_height) / float(height))

        new_width = int(width * scale)
        new_height = int(height * scale)

        result = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
        result.save(out_path)

        print(json.dumps({
            "status": "success",
            "message": f"Upscaled to {new_width}x{new_height}",
            "output_path": out_path
        }))

    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": str(e)
        }))
        sys.exit(1)

if __name__ == '__main__':
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    parser = argparse.ArgumentParser(description="Image upscale with PIL resampling")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output image path")
    parser.add_argument("--height", type=int, required=True, help="Target height in pixels")

    args = parser.parse_args()
    run_upscale(args.image, args.output, args.height)
