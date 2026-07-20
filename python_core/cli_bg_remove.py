import sys
import json
import argparse
import io
from pathlib import Path
from PIL import Image

def run_bg_remove(image_path, out_path, bg_color=None):
    try:
        import rembg

        raw = Path(image_path).read_bytes()
        fg = Image.open(io.BytesIO(rembg.remove(raw))).convert("RGBA")

        if bg_color:
            bg = Image.new("RGBA", fg.size, bg_color + "FF")
            final = Image.alpha_composite(bg, fg)
        else:
            final = fg

        ext = Path(out_path).suffix.lower()
        if ext in (".jpg", ".jpeg"):
            final = final.convert("RGB")

        final.save(out_path)

        print(json.dumps({
            "status": "success",
            "message": "Background removed successfully",
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
    parser = argparse.ArgumentParser(description="Image Background Removal (BiRefNet/rembg)")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output image path")
    parser.add_argument("--color", type=str, default="", help="Hex color for background (e.g., #FFFFFF), leave empty for transparent")

    args = parser.parse_args()
    run_bg_remove(args.image, args.output, args.color if args.color else None)
