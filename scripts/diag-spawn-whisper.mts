import { spawn } from 'child_process';
import path from 'path';

const script = path.join(process.cwd(), 'src/python_core/fetch_youtube_audio_transcript.py');
const bins = ['python', 'py'];
for (const bin of bins) {
  console.log('--- try', bin);
  const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(bin, [script, 'jNQXAC9IVRw', 'en', 'tiny'], {
      windowsHide: true,
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
    });
    child.stderr?.on('data', (d) => {
      err += String(d);
    });
    child.on('error', (e) => resolve({ code: null, out, err: e.message }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
  console.log('code', result.code);
  console.log('stdout head', result.out.slice(0, 400));
  console.log('stderr head', result.err.slice(0, 400));
  const line = result.out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
  try {
    const j = JSON.parse(line);
    console.log('parsed ok', j.ok, 'words', j.word_count, 'src', j.source);
    if (j.ok) process.exit(0);
  } catch (e) {
    console.log('parse fail', e instanceof Error ? e.message : e);
  }
}
process.exit(1);
