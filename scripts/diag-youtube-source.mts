import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fetchYoutubeSource } from '../src/lib/youtubeSource.ts';
import { resolvePythonExe } from '../src/app/api/self-heal/media/mediaHelpers.ts';

const py = resolvePythonExe();
const script = path.join(process.cwd(), 'src/python_core/fetch_youtube_transcript.py');
console.log('preferred', py, 'exists', fs.existsSync(py));
console.log('script', script, fs.existsSync(script));

function run(bin: string) {
  return new Promise<Record<string, unknown>>((resolve) => {
    const child = spawn(bin, [script, 'jNQXAC9IVRw', 'en,vi'], {
      windowsHide: true,
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
    });
    child.stderr?.on('data', (d) => {
      err += String(d);
    });
    child.on('error', (e) => resolve({ bin, spawnError: e.message }));
    child.on('close', (code) =>
      resolve({ bin, code, out: out.slice(0, 400), err: err.slice(0, 300) }),
    );
  });
}

console.log('run preferred', await run(py));
console.log('run python', await run('python'));

const r = await fetchYoutubeSource(
  'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  { preferredLangs: ['en', 'vi'] },
);
console.log(
  'fetch',
  JSON.stringify(
    {
      ok: r.ok,
      code: r.errorCode,
      source: r.source,
      title: r.title,
      len: r.transcript?.length || 0,
      errHead: (r.error || '').slice(0, 600),
    },
    null,
    2,
  ),
);
