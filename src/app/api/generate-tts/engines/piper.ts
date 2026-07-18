/**
 * Piper TTS engine — multi-process safe (same model, parallel requests).
 * Each call spawns piper.exe with unique temp files (no shell stdin race).
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

function uniqueTag(): string {
  return `${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

function runPiperProcess(opts: {
  piperExe: string;
  modelPath: string;
  lengthScale: string;
  text: string;
  outWav: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const { piperExe, modelPath, lengthScale, text, outWav } = opts;
    const child = spawn(
      piperExe,
      ['-m', modelPath, '--length_scale', lengthScale, '-f', outWav],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outWav)) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Piper exit ${code}${stderr.trim() ? `: ${stderr.trim().slice(0, 400)}` : ''}`,
        ),
      );
    });
    // Feed text via stdin (concurrent-safe, no shell redirect)
    try {
      child.stdin?.write(text, 'utf8');
      child.stdin?.end();
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export async function generatePiperTTS(
  text: string,
  modelName: string,
  speed: number,
): Promise<Buffer> {
  const scratchDir = path.join(process.cwd(), 'scratch', 'piper-multi');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const tag = uniqueTag();
  const tempWav = path.join(scratchDir, `out_${tag}.wav`);
  const piperExe = path.join(process.cwd(), 'bin', 'piper', 'piper.exe');
  let name = (modelName || '').trim();
  if (!name) throw new Error('Piper: chưa chọn model .onnx.');
  if (!name.endsWith('.onnx')) name = `${name}.onnx`;
  const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', name);

  if (!fs.existsSync(piperExe)) {
    throw new Error(`Piper executable not found: ${piperExe}`);
  }
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Piper model not found: ${modelPath}`);
  }

  const clean = String(text || '').trim();
  if (!clean) throw new Error('Piper: text rỗng.');

  const lengthScale = (1.0 / Math.max(0.1, speed || 1.0)).toFixed(3);

  try {
    await runPiperProcess({
      piperExe,
      modelPath,
      lengthScale,
      text: clean,
      outWav: tempWav,
    });
    if (!fs.existsSync(tempWav)) {
      throw new Error('Piper did not generate wav file.');
    }
    return fs.readFileSync(tempWav);
  } finally {
    try {
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
    } catch {
      /* ignore */
    }
  }
}
