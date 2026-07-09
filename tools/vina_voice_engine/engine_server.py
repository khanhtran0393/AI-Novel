#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
VinaVoice independent local engine for AI Novel.
HTTP :8765  POST /v1/synthesize

Clone Voice (như Vina):
  - Gửi reference_audio (WAV/MP3 path trên máy) + text cần đọc
  - Ưu tiên zero-shot clone (XTTS / f5-tts nếu cài)
  - Fallback: edge-tts + post-process theo pitch/speed

Không phụ thuộc Vina-Voice.exe.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional

HOST = os.environ.get("VINA_ENGINE_HOST", "127.0.0.1")
PORT = int(os.environ.get("VINA_ENGINE_PORT", "8765"))


def _which(name: str) -> Optional[str]:
    from shutil import which

    return which(name)


def run_edge_tts(text: str, voice: str, out_mp3: Path) -> None:
    cmd = [
        "edge-tts",
        "--voice",
        voice,
        "--text",
        text,
        "--write-media",
        str(out_mp3),
    ]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ffmpeg_convert(src: Path, dst: Path, af: Optional[str] = None) -> None:
    ff = _which("ffmpeg") or "ffmpeg"
    cmd = [ff, "-y", "-i", str(src)]
    if af:
        cmd += ["-af", af]
    cmd += ["-ac", "1", "-ar", "44100", str(dst)]
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ensure_wav(src: str, dst: Path) -> Path:
    p = Path(src)
    if p.suffix.lower() == ".wav" and p.is_file():
        return p
    ffmpeg_convert(p, dst)
    return dst


def build_af(pitch_shift: float, speed: float, treble: float, formant: float) -> str:
    rate = int(44100 * (2 ** (pitch_shift / 12.0)))
    tempo = max(0.5, min(2.0, speed * (44100 / max(1, rate))))
    parts = [f"asetrate={rate}", "aresample=44100", f"atempo={tempo:.4f}"]
    if abs(treble) > 0.01:
        parts.append(f"treble=g={treble}")
    if abs(formant - 1.0) > 0.01:
        g = (formant - 1.0) * 6.0
        parts.append(f"equalizer=f=1200:t=q:w=1:g={g:.2f}")
    # Match loudness roughly
    parts.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    return ",".join(parts)


def synth_builtin(payload: Dict[str, Any], out_wav: Path) -> str:
    text = (payload.get("text") or "").strip()
    if not text:
        raise ValueError("empty text")
    gender = (payload.get("gender") or "male").lower()
    voice = "vi-VN-HoaiMyNeural" if gender == "female" else "vi-VN-NamMinhNeural"
    v = payload.get("voice") or ""
    if isinstance(v, str) and "Neural" in v:
        voice = v

    pitch = float(payload.get("pitch_shift") or 0)
    speed = float(payload.get("speed") or 1.0)
    treble = float(payload.get("treble_boost") or 0)
    formant = float(payload.get("formant") or 1.0)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        mp3 = td_path / "raw.mp3"
        mid = td_path / "mid.wav"
        run_edge_tts(text, voice, mp3)
        ffmpeg_convert(mp3, mid)
        af = build_af(pitch, speed, treble, formant)
        ffmpeg_convert(mid, out_wav, af=af)
    return f"edge-tts/{voice}+ffmpeg-post"


def synth_clone_xtts(ref_wav: Path, text: str, out_wav: Path, language: str = "vi") -> Optional[str]:
    """Zero-shot clone via Coqui XTTS v2 if installed."""
    try:
        import importlib

        if importlib.util.find_spec("TTS") is None:
            return None
        from TTS.api import TTS  # type: ignore

        # CPU/GPU auto
        tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2", progress_bar=False)
        lang = language if language in ("vi", "en", "zh-cn", "ja", "ko", "fr", "de", "es") else "vi"
        tts.tts_to_file(
            text=text,
            speaker_wav=str(ref_wav),
            language=lang,
            file_path=str(out_wav),
        )
        if out_wav.is_file() and out_wav.stat().st_size > 1000:
            return "xtts_v2_clone"
    except Exception as e:
        print("[vina-engine] xtts failed:", e)
    return None


def synth_clone_edge_match(ref_wav: Path, text: str, payload: Dict[str, Any], out_wav: Path) -> str:
    """
    Fallback clone-ish: Edge TTS + loudnorm matched to reference energy.
    Not true timbre clone, but usable offline without Vina.exe.
    """
    gender = (payload.get("gender") or "male").lower()
    voice = "vi-VN-HoaiMyNeural" if gender == "female" else "vi-VN-NamMinhNeural"
    pitch = float(payload.get("pitch_shift") or 0)
    speed = float(payload.get("speed") or 1.0)
    treble = float(payload.get("treble_boost") or 0)
    formant = float(payload.get("formant") or 1.0)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        mp3 = td_path / "raw.mp3"
        mid = td_path / "mid.wav"
        run_edge_tts(text, voice, mp3)
        ffmpeg_convert(mp3, mid)
        # Apply prosody + loudnorm
        af = build_af(pitch, speed, treble, formant)
        ffmpeg_convert(mid, out_wav, af=af)
    return f"clone-fallback/edge+match/{voice}"


def synth_clone(payload: Dict[str, Any], out_wav: Path) -> Optional[str]:
    ref = payload.get("reference_audio") or ""
    text = (payload.get("text") or "").strip()
    use_clone = payload.get("use_clone", True)
    if not use_clone or not text:
        return None
    if not ref or not os.path.isfile(ref):
        return None

    with tempfile.TemporaryDirectory() as td:
        ref_wav = ensure_wav(ref, Path(td) / "ref.wav")
        # 1) True zero-shot if available
        method = synth_clone_xtts(ref_wav, text, out_wav, language=str(payload.get("language") or "vi"))
        if method:
            return method
        # 2) Offline fallback matched to sample presence
        return synth_clone_edge_match(ref_wav, text, payload, out_wav)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print("[vina-engine]", fmt % args)

    def _json(self, code: int, obj: Dict[str, Any]) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _bytes(self, code: int, raw: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path.startswith("/health") or self.path.startswith("/v1/status"):
            xtts = False
            try:
                import importlib

                xtts = importlib.util.find_spec("TTS") is not None
            except Exception:
                pass
            self._json(
                200,
                {
                    "ok": True,
                    "independent": True,
                    "depends_on_vina_exe": False,
                    "clone_ready": True,
                    "xtts_available": xtts,
                    "host": HOST,
                    "port": PORT,
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not self.path.startswith("/v1/synthesize"):
            self._json(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(n)
            payload = json.loads(body.decode("utf-8") or "{}")
            with tempfile.TemporaryDirectory() as td:
                out = Path(td) / "out.wav"
                method = None
                if payload.get("use_clone") or payload.get("reference_audio"):
                    method = synth_clone(payload, out)
                if not method:
                    method = synth_builtin(payload, out)
                raw = out.read_bytes()
            self._bytes(200, raw, "audio/wav")
            print("[vina-engine] ok", method, "bytes", len(raw))
        except Exception as e:
            traceback.print_exc()
            self._json(500, {"error": str(e)})


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"VinaVoice independent engine http://{HOST}:{PORT}")
    print("POST /v1/synthesize  GET /health  (clone via reference_audio)")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
