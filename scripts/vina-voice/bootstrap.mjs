/**
 * Bootstrap independent VinaVoice environment for AI Novel.
 * Creates dirs, verifies data files, prints status.
 * Does NOT call Vina-Voice.exe.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cwd = path.resolve(__dirname, '../..');
const root = path.join(cwd, 'data', 'vina-voices');

const dirs = [
  root,
  path.join(root, 'samples'),
  path.join(root, 'user-clones'),
  path.join(root, 'session'),
  path.join(root, 'temp'),
  path.join(cwd, 'public', 'audio', 'clones'),
];

const created = [];
for (const d of dirs) {
  if (!fs.existsSync(d)) {
    fs.mkdirSync(d, { recursive: true });
    created.push(d);
  }
}

const touch = (file, content) => {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, content, 'utf8');
    created.push(file);
  }
};

touch(path.join(root, 'profiles_user.json'), '{}');
touch(
  path.join(root, 'roles.json'),
  JSON.stringify(
    {
      version: 1,
      note: 'Independent multi-role map (not Vina.exe roles.json format lock-in)',
      roles: [{ id: 0, name: 'Người kể', voice: '' }],
    },
    null,
    2,
  ),
);

const required = [
  'profiles_goc.json',
  'chunk_profiles.json',
  'session_state.json',
  'help.json',
];
const missing = required.filter((f) => !fs.existsSync(path.join(root, f)));

let samples = 0;
try {
  samples = fs
    .readdirSync(path.join(root, 'samples'))
    .filter((f) => /\.(wav|mp3)$/i.test(f)).length;
} catch {
  /* ignore */
}

const engineScript = path.join(cwd, 'tools', 'vina_voice_engine', 'engine_server.py');
const engineOk = fs.existsSync(engineScript);

console.log('=== VinaVoice Runtime Bootstrap ===');
console.log('cwd:', cwd);
console.log('data:', root);
console.log('created:', created.length ? created : '(none)');
console.log('missing required:', missing.length ? missing : '(none)');
console.log('samples WAV/MP3:', samples);
console.log('engine script:', engineOk ? engineScript : 'MISSING');
console.log('dependsOnVinaExe: false');
console.log(missing.length === 0 ? 'BOOTSTRAP_OK' : 'BOOTSTRAP_PARTIAL');
process.exit(missing.length === 0 ? 0 : 2);
