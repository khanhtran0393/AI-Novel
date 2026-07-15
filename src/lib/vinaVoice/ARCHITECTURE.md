# VinaVoice Independent Architecture (AI Novel)

## Mục tiêu

Port **toàn bộ hành vi** app tham chiếu Vina-Voice vào AI Novel theo **cấu trúc module thật**, chạy **độc lập** — không gọi `Vina-Voice.exe` khi script thiếu hoặc hành vi lệch.

## Map hành vi Vina → Module AI Novel

| Vina (UI / config) | Module AI Novel |
|--------------------|-----------------|
| MainWindow gender/area/group/emotion | `session.ts` + TTS UI filters |
| custom_rules / Good profile | `textPipeline.ts` + `session_state.json` |
| max_chars / markers / pauses | `chunking.ts` + `chunk_profiles.json` |
| profiles_goc + saved_voices | `profiles.ts` + `data/.../samples` |
| Clone Voice (ref WAV) | `clone` API + `engine` + user-clones |
| speaker_seed / style_seed | `types` + engine payload |
| pitch / speed / treble | `audioPost.ts` / engine prosody |
| multi role | `roles.json` + ProjectVoiceCast |
| session_state | `session.ts` |
| help tooltips | `help.json` |
| Synth button | `runtime.runtimeSynthesize` / TTS platform `vina_voice` |

## Luồng runtime — Universal Zero-Shot (Trái tim độc tôn)

```
bootstrap env
  → inspect ONNX brain (src/python_core/models/vina_voice ~1.46GB)
  → speakerRegistry.resolveSpeaker(profile | ad-hoc | DEFAULT_NARRATOR)
       catalog studio WAV  ==  zero-shot mồi
       user clone WAV      ==  zero-shot mồi
  → apply text rules + chunk
  → tryNativeEngine (vina_voice_infer.py, CORE_MODELS_DIR locked)
       auto EP → cpu retry → optional HTTP :8765
  → HARD-FAIL if fail (no silent Edge)
  → finalizeWithProsody (ffmpeg speed/pitch)
  → public/audio or scene path

Escape hatch ONLY:
  forceBuiltin=true  OR  VINA_EMERGENCY_EDGE=1  → labeled EMERGENCY_EDGE (not ONNX)
```

## Nguyên lý

- **Một não ONNX** cho catalog + clone + default narrator.
- **Không có** “giọng neural riêng”: mọi giọng = `(reference_audio, reference_text, seeds)`.
- Modules: `speakerRegistry.ts`, `paths.ts` (brain lock), `engine.ts` (UVE), `vina_voice_infer.py`.

## Không phụ thuộc

- `Vina-Voice.exe`
- Silent Edge as identity substitute
- pyarmor / license Vina

## Phụ thuộc runtime

- ONNX Runtime + librosa/soundfile (Python)
- `ffmpeg` (prosody)
- Optional: HTTP engine :8765 / XTTS
- Emergency only: `edge-tts`

## API surface

- `GET/POST /api/vina-voice/runtime`
- `POST /api/vina-voice/runtime/synthesize`
- `POST /api/vina-voice/clone`
- `GET /api/vina-voice/profiles`
- `GET /api/vina-voice/status`
