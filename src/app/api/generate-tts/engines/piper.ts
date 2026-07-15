import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function generatePiperTTS(text: string, modelName: string, speed: number): Promise<Buffer> {
  const scratchDir = path.join(process.cwd(), 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });

  const tempText = path.join(scratchDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const tempWav = path.join(scratchDir, `piper_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  const piperExe = path.join(process.cwd(), 'bin', 'piper', 'piper.exe');
  const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', modelName);
  if (!fs.existsSync(piperExe)) throw new Error(`Piper executable not found: ${piperExe}`);
  if (!fs.existsSync(modelPath)) throw new Error(`Piper model not found: ${modelPath}`);

  fs.writeFileSync(tempText, text, 'utf8');
  try {
    const lengthScale = (1.0 / Math.max(0.1, speed || 1.0)).toFixed(3);
    execSync(`"${piperExe}" -m "${modelPath}" --length_scale ${lengthScale} -f "${tempWav}" < "${tempText}"`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    if (!fs.existsSync(tempWav)) throw new Error('Piper did not generate wav file.');
    return fs.readFileSync(tempWav);
  } finally {
    if (fs.existsSync(tempText)) fs.unlinkSync(tempText);
    if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
  }
}
