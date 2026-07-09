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

## Luồng runtime

```
bootstrap env
  → load session (rules, pauses, seeds)
  → apply text rules
  → chunk + pause schedule
  → synth:
       prefer tools/vina_voice_engine (:8765) [clone if ref]
       else builtin Edge + postprocess
  → concat pauses
  → public/audio/clones
```

## Không phụ thuộc

- `Vina-Voice.exe`
- `model-tts.onnx` (RAR đóng của Vina)
- pyarmor / license Vina

## Phụ thuộc tùy chọn (nâng tembre)

- `edge-tts` CLI
- Coqui TTS / XTTS v2 (zero-shot clone)
- `ffmpeg` (bắt buộc cho post + convert)

## API surface

- `GET/POST /api/vina-voice/runtime`
- `POST /api/vina-voice/runtime/synthesize`
- `POST /api/vina-voice/clone`
- `GET /api/vina-voice/profiles`
- `GET /api/vina-voice/status`
