import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { TTSProvider } from '../ttsTypes';
import { resolvePythonExe } from '@/app/api/self-heal/media/mediaHelpers';
import { hostBindingChildEnv } from '@/lib/nav/hostBinding';

const execFileAsync = promisify(execFile);

/**
 * Owner: TTS platform `vieneu_tts` — real VieNeu SDK via python_core.
 * B10: no silent remap to Piper under the VieNeu name. Use platform `piper` for Piper.
 */
export const provider_vieneu_tts: TTSProvider = {
  name: 'VieNeu TTS',
  supportsNativeSpeed: true,
  supportsNativePitch: false,
  generate: async (text, opts) => {
    const clean = String(text || '').trim();
    if (!clean) throw new Error('VieNeu: text rỗng.');

    const rawVoice = (opts.voice || '').trim().toLowerCase();
    // Map UI / cast names → bundled refs in tts_vieneu.VOICES
    const VOICE_ALIAS: Record<string, string> = {
      female: 'female',
      male: 'male',
      nu: 'female',
      nam: 'male',
      ngochuyen: 'female',
      chichi: 'female',
      minhquan: 'male',
      manhdung: 'male',
      adam1: 'male',
      adam2: 'male',
      adam3: 'male',
      adam4: 'male',
    };
    const key = rawVoice
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/\.onnx$/i, '')
      .replace(/\s+/g, '');
    const voiceId = VOICE_ALIAS[key];
    if (!voiceId) {
      throw new Error(
        `VieNeu: voice "${opts.voice || ''}" không hợp lệ. ` +
          `Chọn một voice có trong Cấu Hình Giọng Đọc Toàn Cục. Không fallback sang female/male.`,
      );
    }

    const scratchDir = path.join(process.cwd(), 'scratch', 'vieneu');
    fs.mkdirSync(scratchDir, { recursive: true });
    const tag = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const outWav = path.join(scratchDir, `vn_${tag}.wav`);
    // UTF-8 text file avoids Windows argv mojibake for Vietnamese
    const textPath = path.join(scratchDir, `txt_${tag}.txt`);
    fs.writeFileSync(textPath, clean, 'utf8');

    const py = resolvePythonExe();
    const core = path.join(process.cwd(), 'python_core');
    const binding = hostBindingChildEnv({
      action: 'vieneu_tts',
      timeoutMs: 300_000,
    });

    const runnerPath = path.join(scratchDir, `run_${tag}.py`);
    fs.writeFileSync(
      runnerPath,
      `
import json, sys, os
core = r${JSON.stringify(core)}
sys.path.insert(0, core)
os.chdir(core)
from services import tts_vieneu as v
text_path, out, voice = sys.argv[1], sys.argv[2], sys.argv[3]
with open(text_path, "r", encoding="utf-8") as f:
    text = f.read()
ok = v.synth_to_file(text, out, voice=voice)
print(json.dumps({"ok": bool(ok), "out": out, "voice": voice}, ensure_ascii=False))
sys.exit(0 if ok else 2)
`.trim(),
      'utf8',
    );

    try {
      const { stdout, stderr } = await execFileAsync(
        py,
        [runnerPath, textPath, outWav, voiceId],
        {
          cwd: core,
          env: {
            ...process.env,
            ...binding,
            PYTHONPATH: core,
            PYTHONIOENCODING: 'utf-8',
          },
          timeout: 300_000,
          maxBuffer: 20 * 1024 * 1024,
          windowsHide: true,
        },
      );

      if (!fs.existsSync(outWav) || fs.statSync(outWav).size < 100) {
        throw new Error(
          `VieNeu synth khong tao file wav. stderr=${(stderr || '').slice(0, 400)} stdout=${(stdout || '').slice(0, 200)}`,
        );
      }

      const buffer = fs.readFileSync(outWav);
      const speed = Number(opts.speed) || 1;
      const nativeSpeed = Math.abs(speed - 1) < 0.05;

      for (const p of [outWav, textPath, runnerPath]) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }

      return {
        buffer,
        method: `VieNeu-SDK (voice=${voiceId})`,
        nativePitchApplied: false,
        nativeSpeedApplied: nativeSpeed,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `VieNeu SDK that bai: ${msg}. ` +
          `Chay: node scripts/install-vieneu.mjs  (hoac pip install vieneu). ` +
          `Neu can Piper .onnx, chon platform "piper" (khong dung label VieNeu).`,
      );
    }
  },
};
