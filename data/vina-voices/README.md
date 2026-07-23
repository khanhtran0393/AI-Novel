# VinaVoice Runtime Data (AI Novel)

Môi trường dữ liệu **độc lập** — port hành vi Vina-Voice, **không** cần `Vina-Voice.exe`.

## Cấu trúc

```
data/vina-voices/
  profiles_goc.json      # Catalog giọng (từ Vina profiles_goc)
  profiles_user.json     # Profile clone user tạo
  chunk_profiles.json    # Chunk/pause profiles
  session_state.json     # Defaults: rules, pauses, seeds
  help.json              # Tooltip/help map
  samples/               # WAV catalog (82+)
  user-clones/           # File mẫu user upload
  session/runtime.json   # Override session runtime
  temp/                  # Scratch jobs
  roles.json             # Multi-role map
```

## Modules code

`src/lib/vinaVoice/` — paths, session, rules/text, chunking, profiles, audioPost, engine, runtime, clone API.

## Engine (optional, tembre tốt hơn)

```bat
cd tools\vina_voice_engine
RUN_ENGINE.bat
```

- Port mặc định: `http://127.0.0.1:8765`
- XTTS (tuỳ chọn): `INSTALL_XTTS.bat` — clone tembre sát sample

## API

| Endpoint | Việc |
|----------|------|
| `GET /api/vina-voice/runtime` | Status full stack |
| `POST /api/vina-voice/runtime` | `{action:"bootstrap"}` |
| `POST /api/vina-voice/runtime/synthesize` | Synth full pipeline |
| `POST /api/vina-voice/clone` | Upload MP3 → clone |
| `GET /api/vina-voice/profiles` | Catalog |
| `GET /api/vina-voice/status` | Engine probe |

## Bootstrap

```bat
node scripts/vina-voice/bootstrap.mjs
```
