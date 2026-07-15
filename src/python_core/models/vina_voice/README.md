# Vina ONNX Brain (LOCKED CORE) — Universal Zero-Shot Engine

**Path cố định:** `src/python_core/models/vina_voice/`  
**Dung lượng:** ~1.46 GB (`model-tts_0/1/2.onnx` + `vocab.txt`)

## Role in AI Novel

Đây là **động cơ sinh giọng zero-shot duy nhất** cho platform `vina_voice`:

- **Catalog** (Nữ Trẻ 1, Nam Trầm…) = clone từ WAV studio trong `data/vina-voices/samples/`
- **User clone** = clone từ WAV user trong `user-clones/`
- **Default narrator** = profile catalog đầu tiên resolve được sample

Cùng một não A/B/C — không có engine giọng “riêng” thứ hai (silent Edge đã tắt).

## Policy

- Não **vĩnh viễn** nằm trong thư mục này.
- `vina_voice_infer.py` **bắt buộc** load từ đây (`CORE_MODELS_DIR`).
- `engine.ts` + `speakerRegistry.ts` resolve SpeakerRef → always ONNX when universal mode.
- **Không** phụ thuộc `Vina-Voice.exe`.

## Files

| File | Role |
|------|------|
| `model-tts_0.onnx` | Model A — conditioning |
| `model-tts_1.onnx` | Model B — Transformer NFE |
| `model-tts_2.onnx` | Model C — Vocoder |
| `vocab.txt` | Char vocab |
| `MANIFEST.json` | Integrity metadata |

## Speed architecture

Model A nhận **ref audio + (ref_text + câu gen)** — không tách speaker embedding độc lập
để reuse cho mọi câu (F5-style joint conditioning). Tối ưu thực tế:

| Technique | Gain |
|-----------|------|
| **Warm daemon** `vina_voice_server.py` | Bỏ load 1.46GB mỗi lần (lớn nhất) |
| **NFE 24 full / 12 preview** (`VINA_NFE_STEP`) | ~1.3–2× nhanh hơn NFE 32 |
| **GPU** `VINA_PROVIDER=cuda` hoặc `dml` | 3–10× vs CPU |
| **Preview WAV cache** `data/tts-preview-cache` | Nghe thử lần 2 tức thì |
| **ref_pcm cache** cạnh sample | Bớt librosa |

Env:
- `VINA_WARM_DAEMON=1` (default) — giữ process Python nóng
- `VINA_NFE_STEP=24` — full gen
- `VINA_NFE_PREVIEW=12` — nghe thử
- `VINA_PROVIDER=auto|cuda|dml|cpu`

## Verify

```bash
python src/python_core/vina_voice_infer.py --text "xin chao" --ref_text "..." --ref_audio path.wav --output out.wav --provider cpu
```

Log phải có: `[vina_infer] CORE_BRAIN locked=...models\vina_voice`

Warm daemon (tự bật từ Node):

```bash
python src/python_core/vina_voice_server.py
# stdin JSON lines — xem header file
```
