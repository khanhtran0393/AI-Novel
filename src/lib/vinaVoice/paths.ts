/**
 * Data layout for independent VinaVoice runtime inside AI Novel.
 * Mirrors Vina app folders without depending on Vina-Voice.exe.
 *
 * data/vina-voices/
 *   profiles_goc.json      — catalog giọng gốc
 *   profiles_user.json     — profile user clone
 *   chunk_profiles.json    — chiến lược chunk/pause
 *   session_state.json     — defaults session (rules, pauses)
 *   help.json              — tooltips/help (từ Vina)
 *   samples/               — WAV mẫu catalog
 *   user-clones/           — WAV user upload
 *   session/               — runtime session override
 *   temp/                  — scratch TTS
 *   roles.json             — multi-role (optional)
 */
import fs from 'fs';
import path from 'path';

export function getVinaRoot(cwd = process.cwd()): string {
  return path.join(cwd, 'data', 'vina-voices');
}

export function vinaPaths(cwd = process.cwd()) {
  const root = getVinaRoot(cwd);
  return {
    root,
    profilesGoc: path.join(root, 'profiles_goc.json'),
    profilesUser: path.join(root, 'profiles_user.json'),
    chunkProfiles: path.join(root, 'chunk_profiles.json'),
    sessionState: path.join(root, 'session_state.json'),
    sessionRuntime: path.join(root, 'session', 'runtime.json'),
    help: path.join(root, 'help.json'),
    samples: path.join(root, 'samples'),
    userClones: path.join(root, 'user-clones'),
    temp: path.join(root, 'temp'),
    roles: path.join(root, 'roles.json'),
    publicClones: path.join(cwd, 'public', 'audio', 'clones'),
    engineDir: path.join(cwd, 'tools', 'vina_voice_engine'),
    engineScript: path.join(cwd, 'tools', 'vina_voice_engine', 'engine_server.py'),
  };
}

export function ensureVinaEnvironment(cwd = process.cwd()): {
  ok: boolean;
  created: string[];
  missing: string[];
  paths: ReturnType<typeof vinaPaths>;
} {
  const p = vinaPaths(cwd);
  const created: string[] = [];
  const missing: string[] = [];

  const dirs = [
    p.root,
    p.samples,
    p.userClones,
    path.dirname(p.sessionRuntime),
    p.temp,
    p.publicClones,
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      created.push(d);
    }
  }

  // Touch empty user profiles if missing
  if (!fs.existsSync(p.profilesUser)) {
    fs.writeFileSync(p.profilesUser, '{}', 'utf8');
    created.push(p.profilesUser);
  }
  if (!fs.existsSync(p.roles)) {
    fs.writeFileSync(
      p.roles,
      JSON.stringify(
        {
          version: 1,
          roles: [{ id: 0, name: 'Người kể', voice: '', notes: 'narrator' }],
        },
        null,
        2,
      ),
      'utf8',
    );
    created.push(p.roles);
  }

  const requiredFiles = [p.profilesGoc, p.chunkProfiles, p.sessionState, p.help];
  for (const f of requiredFiles) {
    if (!fs.existsSync(f)) missing.push(f);
  }

  return {
    ok: missing.length === 0,
    created,
    missing,
    paths: p,
  };
}
