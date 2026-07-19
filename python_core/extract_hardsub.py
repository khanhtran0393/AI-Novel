"""
extract_hardsub.py — DEPRECATED

EasyOCR has been fully removed.
Hardsub extraction is now handled by VideOCR CLI (PaddleOCR / Google Lens).
See: https://github.com/timminator/VideOCR

The main app calls videocr-cli.exe directly via runVideocrForHardsub() in server.js.
"""
import sys

def main():
    print("DEPRECATED: extract_hardsub.py (EasyOCR) has been removed.")
    print("Hardsub extraction now uses VideOCR CLI (videocr-cli.exe).")
    print("Download from: https://github.com/timminator/VideOCR/releases")
    sys.exit(0)

if __name__ == "__main__":
    import ainovel_host_guard  # noqa: F401 — host-bound; no standalone CLI
    main()
