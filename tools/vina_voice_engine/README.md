# VinaVoice Independent Engine (AI Novel) — tích hợp full

Engine giọng **độc lập** cho tab **Tạo giọng đọc / Clone Voice**.  
**Không** gọi `Vina-Voice.exe`, **không** cần `model-tts.onnx` đóng của Vina.

## Luồng tích hợp trong app

```
[UI Tạo giọng đọc]
  → POST /api/vina-voice/clone  (upload MP3/WAV + text)
  → lưu data/vina-voices/user-clones/*.wav
  → profiles_user.json + samples/
  → synthesizeVinaVoice()
       ├─ engine http://127.0.0.1:8765  (XTTS zero-shot nếu cài)
       └─ fallback Edge + ffmpeg post (speed/pitch)
  → public/audio/clones/*.wav (nghe thử)
  → ttsConfig.vinaReferenceAudio (gen cảnh / Role Cast)
```

| API | Việc |
|-----|------|
| `GET /api/vina-voice/status` | profiles + ffmpeg + engine health |
| `POST /api/vina-voice/engine/start` | spawn `engine_server.py` |
| `GET /api/vina-voice/profiles` | catalog goc + user clones |
| `POST /api/vina-voice/clone` | tạo giọng từ mẫu |
| `POST /api/generate-tts` platform=`vina_voice` | gen TTS cảnh |

## Chạy engine

### Nhanh (Windows)

```bat
RUN_ENGINE.bat
```

### Thủ công

```bat
pip install -r requirements.txt
python engine_server.py
```

Health: http://127.0.0.1:8765/health

### Clone tembre thật (XTTS)

```bat
INSTALL_XTTS.bat
```

Cần GPU NVIDIA khuyến nghị. Sau khi cài, `/health` → `xtts_available: true`.

## So với Vina-Voice V5.4

| | Vina Pro | AI Novel (stack này) |
|--|----------|----------------------|
| Workflow mẫu→text→clone | Có | Có (tab Tạo giọng đọc) |
| model-tts.onnx | Có | Không |
| Zero-shot tembre | ONNX Vina | Coqui XTTS (optional) |
| Fallback | — | Edge + pitch/speed |
| Role / multi-voice | Role Tab | Role Casting Studio |

## Env

- `VINA_ENGINE_URL` (mặc định `http://127.0.0.1:8765`)
- `VINA_SAMPLES_DIR`
- `PYTHON_PATH` / `VINA_PYTHON` (khi start engine từ Next)
