/**
 * Piper TTS engine — multi-process safe (same model, parallel requests).
 * Each call spawns piper.exe with unique temp files (no shell stdin race).
 *
 * Windows hardening:
 * - cwd = bin/piper (DLL side-by-side)
 * - PATH prepend piper bin (avoid foreign onnxruntime from PATH)
 * - ESPEAK_DATA_PATH → espeak-ng-data
 * - scratch under userData/tmpdir (writable when resources is locked)
 * - decode NTSTATUS exit (0xC0000135 DLL_NOT_FOUND) + one retry
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import {
  resolveNovelRoot,
  resolvePiperModelPath,
  resolvePiperScratchDir,
  assertPiperRuntime,
  formatPiperExitCode,
} from '@/lib/tts/piperPaths';

function uniqueTag(): string {
  return `${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

function buildPiperChildEnv(binDir: string, espeakDataDir: string): NodeJS.ProcessEnv {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  // Prefer both cases for Windows spawn
  const prev =
    process.env.Path || process.env.PATH || process.env.path || '';
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const system32 = path.join(systemRoot, 'System32');
  const pathParts = [
    binDir,
    system32,
    ...prev.split(path.delimiter).filter((p) => {
      if (!p) return false;
      const lower = p.toLowerCase();
      // Drop other onnxruntime homes that can shadow piper DLLs
      if (lower.includes('la-studio') && lower.includes('onnx')) return false;
      if (lower.includes('vieneu')) return false;
      if (lower.includes('onnxruntime') && !lower.includes(binDir.toLowerCase())) {
        return false;
      }
      return true;
    }),
  ];
  const merged = pathParts.join(path.delimiter);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [pathKey]: merged,
    PATH: merged,
    Path: merged,
    // espeak-ng data (phonemes VI)
    ESPEAK_DATA_PATH: espeakDataDir,
    ESPEAKNG_DATA_PATH: espeakDataDir,
  };
  // Avoid partial CUDA EP from parent env (missing provider DLL → STATUS_DLL_NOT_FOUND)
  delete env.CUDA_PATH;
  delete env.CUDA_PATH_V11_8;
  delete env.CUDA_PATH_V12_0;
  delete env.CUDA_VISIBLE_DEVICES;
  return env;
}

function runPiperProcess(opts: {
  piperExe: string;
  binDir: string;
  espeakDataDir: string;
  modelPath: string;
  lengthScale: string;
  text: string;
  outWav: string;
  speakerId?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const {
      piperExe,
      binDir,
      espeakDataDir,
      modelPath,
      lengthScale,
      text,
      outWav,
      speakerId,
    } = opts;

    // Absolute paths — spaces in "My app" safe with argv array
    const absExe = path.resolve(piperExe);
    const absModel = path.resolve(modelPath);
    const absOut = path.resolve(outWav);

    const args = ['-m', absModel, '--length_scale', lengthScale, '-f', absOut];
    // Multi-speaker models (e.g. vivos) — only pass when non-zero or explicitly set
    if (typeof speakerId === 'number' && Number.isFinite(speakerId) && speakerId >= 0) {
      args.push('--speaker', String(Math.floor(speakerId)));
    }

    const child = spawn(
      absExe,
      args,
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: binDir,
        env: buildPiperChildEnv(binDir, espeakDataDir),
        shell: false,
      },
    );
    let stderr = '';
    let stdout = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.on('error', (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      reject(
        new Error(
          `Piper không khởi động được (${absExe}): ${msg}. ` +
            `Kiểm tra bin/piper (piper.exe + DLL) và quyền thực thi.`,
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(absOut) && fs.statSync(absOut).size > 44) {
        resolve();
        return;
      }
      const detail = formatPiperExitCode(code);
      const errTail = stderr.trim() || stdout.trim();
      reject(
        new Error(
          `Piper exit ${detail}` +
            (errTail ? `: ${errTail.slice(0, 400)}` : '') +
            ` [exe=${absExe}; model=${path.basename(absModel)}; cwd=${binDir}]`,
        ),
      );
    });
    try {
      child.stdin?.write(text, 'utf8');
      child.stdin?.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function generatePiperTTS(
  text: string,
  modelName: string,
  speed: number,
  speakerId?: number,
): Promise<Buffer> {
  const root = resolveNovelRoot();
  const { piperExe, binDir, espeakDataDir } = assertPiperRuntime(root);
  // modelName may be `file.onnx` or `file.onnx#speaker`
  const resolved = resolvePiperModelPath(
    speakerId != null && Number.isFinite(speakerId) && !String(modelName).includes('#')
      ? `${modelName}#${Math.floor(speakerId)}`
      : modelName,
    root,
  );
  const { modelPath } = resolved;
  const sid = resolved.speakerId;

  const scratchDir = resolvePiperScratchDir(root);
  const tag = uniqueTag();
  const tempWav = path.join(scratchDir, `out_${tag}.wav`);

  const clean = String(text || '').trim();
  if (!clean) throw new Error('Piper: text rỗng.');

  const lengthScale = (1.0 / Math.max(0.1, speed || 1.0)).toFixed(3);

  const runOnce = () =>
    runPiperProcess({
      piperExe,
      binDir,
      espeakDataDir,
      modelPath,
      lengthScale,
      text: clean,
      outWav: tempWav,
      speakerId: sid,
    });

  try {
    try {
      await runOnce();
    } catch (first) {
      const msg = first instanceof Error ? first.message : String(first);
      // One retry on DLL_NOT_FOUND / transient AV lock of onnxruntime.dll
      if (/3221225781|C0000135|STATUS_DLL_NOT_FOUND|DLL_NOT_FOUND/i.test(msg)) {
        await sleep(350);
        try {
          if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
        } catch {
          /* ignore */
        }
        await runOnce();
      } else {
        throw first;
      }
    }

    if (!fs.existsSync(tempWav)) {
      throw new Error('Piper không tạo được file wav.');
    }
    const buf = fs.readFileSync(tempWav);
    if (buf.length < 44) {
      throw new Error(`Piper wav quá nhỏ (${buf.length}B) — synth thất bại.`);
    }
    return buf;
  } finally {
    try {
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
    } catch {
      /* ignore */
    }
  }
}
