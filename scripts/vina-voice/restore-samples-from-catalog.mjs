/**
 * Restore Zero-Shot sample WAVs into data/vina-voices/samples/
 * from profiles_goc.json transcript text (Edge Neural → WAV via ffmpeg).
 *
 * Original studio WAVs were wiped (clean-workspace / never in git).
 * This rebuilds a working reference bank so catalog profiles hasSample=true.
 *
 * Usage: node scripts/vina-voice/restore-samples-from-catalog.mjs
 *        node scripts/vina-voice/restore-samples-from-catalog.mjs --force
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { EdgeTTS } from 'node-edge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '../..');
const gocPath = path.join(cwd, 'data', 'vina-voices', 'profiles_goc.json');
const samplesDir = path.join(cwd, 'data', 'vina-voices', 'samples');
const force = process.argv.includes('--force');

const ffmpeg =
  [
    path.join(cwd, 'bin', 'ffmpeg.exe'),
    path.join(cwd, 'python_core', 'ffmpeg', 'ffmpeg.exe'),
    'ffmpeg',
  ].find((p) => {
    if (p === 'ffmpeg') return true;
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || 'ffmpeg';

function inferGender(name) {
  const n = (name || '').normalize('NFC').toLowerCase();
  if (/nữ|nu |female|cô |chị |bà /.test(n)) return 'female';
  if (/\bnam\b|male|ông |anh |chú /.test(n)) return 'male';
  if (/đông phương bất bại|bảo - giả giọng nữ/.test(n)) return 'female';
  return 'male';
}

function isEnglish(name, text) {
  const blob = `${name || ''} ${text || ''}`;
  // Explicit catalog labels
  if (/tiếng anh|english/i.test(name || '')) return true;
  // Vietnamese diacritics present → VI
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(blob)) {
    return false;
  }
  // No VI marks: treat as EN only if name/text clearly English catalog
  return /english|en-us|en_us|\ben\b/i.test(blob);
}

function pickVoice(name, text) {
  if (isEnglish(name, text)) {
    return inferGender(name) === 'female'
      ? { voice: 'en-US-AriaNeural', lang: 'en-US' }
      : { voice: 'en-US-GuyNeural', lang: 'en-US' };
  }
  return inferGender(name) === 'female'
    ? { voice: 'vi-VN-HoaiMyNeural', lang: 'vi-VN' }
    : { voice: 'vi-VN-NamMinhNeural', lang: 'vi-VN' };
}

function toWav(mp3Path, wavPath) {
  const r = spawnSync(
    ffmpeg,
    [
      '-y',
      '-i',
      mp3Path,
      '-ac',
      '1',
      '-ar',
      '24000',
      '-sample_fmt',
      's16',
      wavPath,
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(
      `ffmpeg failed: ${(r.stderr || r.stdout || '').slice(-400)}`,
    );
  }
}

async function synthOne(text, voice, lang, outWav) {
  const tmpMp3 = outWav.replace(/\.wav$/i, '.__tmp.mp3');
  const tts = new EdgeTTS({
    voice,
    lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    timeout: 60000,
  });
  await tts.ttsPromise(text, tmpMp3);
  if (!fs.existsSync(tmpMp3) || fs.statSync(tmpMp3).size < 200) {
    throw new Error('Edge TTS empty output');
  }
  toWav(tmpMp3, outWav);
  try {
    fs.unlinkSync(tmpMp3);
  } catch {
    /* ignore */
  }
}

async function main() {
  if (!fs.existsSync(gocPath)) {
    console.error('MISSING', gocPath);
    process.exit(2);
  }
  fs.mkdirSync(samplesDir, { recursive: true });
  const goc = JSON.parse(fs.readFileSync(gocPath, 'utf8'));
  const entries = Object.entries(goc);
  console.log('=== Restore Vina samples from catalog ===');
  console.log('cwd:', cwd);
  console.log('profiles:', entries.length);
  console.log('samplesDir:', samplesDir);
  console.log('ffmpeg:', ffmpeg);
  console.log('force:', force);

  let ok = 0;
  let skip = 0;
  let fail = 0;
  const errors = [];

  for (let i = 0; i < entries.length; i++) {
    const [name, meta] = entries[i];
    const filename = String(meta?.filename || '').trim();
    const text = String(meta?.text || '').trim();
    if (!filename || !text) {
      fail++;
      errors.push({ name, error: 'missing filename/text' });
      continue;
    }
    const outWav = path.join(samplesDir, filename);
    if (!force && fs.existsSync(outWav) && fs.statSync(outWav).size > 1000) {
      skip++;
      console.log(`[${i + 1}/${entries.length}] SKIP ${filename}`);
      ok++;
      continue;
    }
    const { voice, lang } = pickVoice(name, text);
    process.stdout.write(
      `[${i + 1}/${entries.length}] GEN ${filename} (${voice}) … `,
    );
    try {
      await synthOne(text, voice, lang, outWav);
      const bytes = fs.statSync(outWav).size;
      console.log(`OK ${bytes}B`);
      ok++;
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`FAIL ${msg}`);
      errors.push({ name, filename, error: msg });
      // brief backoff on rate limit
      await new Promise((r) => setTimeout(r, 1500));
    }
    // polite delay between Edge requests
    await new Promise((r) => setTimeout(r, 350));
  }

  // rewrite profiles _dir to absolute samples path (portable-ish)
  let rewritten = 0;
  for (const meta of Object.values(goc)) {
    if (meta && typeof meta === 'object') {
      meta._dir = samplesDir;
      rewritten++;
    }
  }
  fs.writeFileSync(gocPath, JSON.stringify(goc, null, 2), 'utf8');

  const wavCount = fs
    .readdirSync(samplesDir)
    .filter((f) => /\.wav$/i.test(f) && !f.includes('.__tmp')).length;

  console.log('=== RESULT ===');
  console.log({ ok, skip, fail, wavCount, rewritten, samplesDir });
  if (errors.length) {
    console.log('errors (first 8):', errors.slice(0, 8));
  }
  if (wavCount < entries.length) {
    console.error(`RESTORE_PARTIAL ${wavCount}/${entries.length}`);
    process.exit(1);
  }
  console.log('RESTORE_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
