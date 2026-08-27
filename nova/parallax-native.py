# -*- coding: utf-8 -*-
# parallax-native.py — Ảnh tĩnh → clip 3D PARALLAX (tách lớp theo depth, gần dịch nhiều/xa dịch ít).
# Dùng: python parallax-native.py <image> <durSec> <out.mp4> [fps=30] [w=1280] [h=720]
# Cần venv có torch + transformers (Depth-Anything V2) + PIL + numpy. In tiến độ ra stderr dạng "P:<0-100>".
import sys, os, math, json, subprocess, shutil, tempfile
def log(p, m=""):
    sys.stderr.write(f"P:{int(p)} {m}\n"); sys.stderr.flush()
try:
    import numpy as np, torch
    import torch.nn.functional as F
    from PIL import Image
    from transformers import pipeline
except Exception as e:
    sys.stderr.write("ERR import: " + str(e) + "\n"); sys.exit(2)

def main():
    img_path = sys.argv[1]; dur = float(sys.argv[2]); out = sys.argv[3]
    fps = int(sys.argv[4]) if len(sys.argv) > 4 else 30
    W   = int(sys.argv[5]) if len(sys.argv) > 5 else 1280
    H   = int(sys.argv[6]) if len(sys.argv) > 6 else 720
    N   = max(2, int(round(dur * fps)))
    dev = "mps" if torch.backends.mps.is_available() else "cpu"

    log(5, "load depth model")
    try:
        pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=dev)
    except Exception:
        pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device="cpu"); dev = "cpu"

    src = Image.open(img_path).convert("RGB")
    # cover-fit về khung W×H
    sw, sh = src.size; k = max(W / sw, H / sh)
    src = src.resize((max(W, int(sw*k)+1), max(H, int(sh*k)+1)), Image.LANCZOS)
    l = (src.width - W)//2; t = (src.height - H)//2
    src = src.crop((l, t, l+W, t+H))

    log(30, "estimate depth")
    depth = pipe(src)["depth"].resize((W, H))
    im = torch.from_numpy(np.asarray(src).copy()).float().permute(2,0,1).unsqueeze(0)/255.
    d  = torch.from_numpy(np.asarray(depth).copy()).float()/255.
    d  = F.avg_pool2d(d[None,None], 11, stride=1, padding=5).squeeze()   # mượt depth
    pivot = d.median()
    im = im.to(dev); dmap = d.to(dev)
    ys, xs = torch.meshgrid(torch.linspace(-1,1,H,device=dev), torch.linspace(-1,1,W,device=dev), indexing='ij')
    disp = (dmap - pivot)                    # gần > 0, xa < 0
    ampx, ampy = 0.030, 0.018

    tmp = tempfile.mkdtemp(prefix="nova-parallax-")
    try:
        for i in range(N):
            p = i/(N-1); camx = math.sin(p*2*math.pi); camy = math.sin(p*2*math.pi + 1.2)
            zoom = 1.0 + 0.06*p
            gx = xs/zoom + disp*camx*ampx
            gy = ys/zoom + disp*camy*ampy
            grid = torch.stack([gx, gy], dim=-1).unsqueeze(0)
            o = F.grid_sample(im, grid, mode='bilinear', padding_mode='border', align_corners=True)
            arr = (o.squeeze().permute(1,2,0).clamp(0,1).cpu().numpy()*255).astype('uint8')
            Image.fromarray(arr).save(os.path.join(tmp, f"f{i:04d}.png"))
            if i % 10 == 0: log(30 + int(55*i/N), "render frames")
        log(88, "encode mp4")
        ff = _ffmpeg()
        subprocess.run([ff, "-y", "-framerate", str(fps), "-i", os.path.join(tmp, "f%04d.png"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-movflags", "+faststart", out],
                       check=True, stderr=subprocess.DEVNULL)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    log(100, "done")
    print(json.dumps({"ok": True, "path": out, "frames": N, "device": dev, "duration": dur}))

def _ffmpeg():
    for p in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"):
        if p == "ffmpeg" or os.path.exists(p): return p
    return "ffmpeg"

if __name__ == "__main__":
    try: main()
    except Exception as e:
        sys.stderr.write("ERR: " + str(e) + "\n"); sys.exit(1)
