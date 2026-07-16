import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { findCapCutSscronet, capCutDllMissingMessage } from './capcutDll';
import { resolveCapCutVoice, listCapCutVoicesSummary } from '@/lib/capcutVoices';

function capcutWindowsDir(): string {
  return path.join(
    process.cwd(),
    'src',
    'app',
    'api',
    'generate-tts',
    'capcut_api',
    'capcut_windows',
  );
}

function writeConfig(opts: {
  voiceName: string;
  resourceId: string;
  dllPath: string;
  rate?: string;
}): void {
  const capcutDir = capcutWindowsDir();
  const configPath = path.join(capcutDir, 'config.py');
  if (!fs.existsSync(configPath)) {
    throw new Error('Không tìm thấy config.py của CapCut TTS API.');
  }

  let configContent = fs.readFileSync(configPath, 'utf8');
  const dllEsc = opts.dllPath.replace(/\\/g, '\\\\');
  const nameEsc = opts.voiceName.replace(/"/g, '\\"');
  const ridEsc = opts.resourceId.replace(/"/g, '\\"');
  const rate = opts.rate || '1.0';

  configContent = configContent.replace(
    /SSCRONET_DLL\s*=\s*r?['"][^'"]*['"]/,
    `SSCRONET_DLL = r"${dllEsc}"`,
  );
  configContent = configContent.replace(
    /VOICE_RESOURCE_ID\s*=\s*['"][^'"]*['"]/,
    `VOICE_RESOURCE_ID = "${ridEsc}"`,
  );
  configContent = configContent.replace(
    /VOICE_NAME\s*=\s*['"][^'"]*['"]/,
    `VOICE_NAME = "${nameEsc}"`,
  );
  configContent = configContent.replace(
    /VOICE_RATE\s*=\s*['"][^'"]*['"]/,
    `VOICE_RATE = "${rate}"`,
  );
  // platform stays sami
  if (!/VOICE_PLATFORM\s*=/.test(configContent)) {
    configContent += `\nVOICE_PLATFORM = "sami"\n`;
  }

  fs.writeFileSync(configPath, configContent, 'utf8');
}

function resolvePython(): string {
  // Prefer venv / py launcher on Windows
  const candidates = [
    process.env.PYTHON || '',
    process.env.AINOVEL_PYTHON || '',
    'python',
    'py',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      execFileSync(c === 'py' ? 'py' : c, c === 'py' ? ['-3', '--version'] : ['--version'], {
        stdio: 'pipe',
        timeout: 5000,
      });
      return c;
    } catch {
      /* try next */
    }
  }
  return 'python';
}

export async function generateCapCutTTS(
  text: string,
  voiceId: string,
  rate = '1.0',
): Promise<Buffer> {
  const hit = findCapCutSscronet();
  if (!hit) {
    throw new Error(capCutDllMissingMessage('CapCut\\Apps, JianyingPro\\Apps, Program Files'));
  }

  const resolved = resolveCapCutVoice(voiceId);
  writeConfig({
    voiceName: resolved.voiceName,
    resourceId: resolved.resourceId,
    dllPath: hit.dllPath,
    rate,
  });

  const capcutDir = capcutWindowsDir();
  const py = resolvePython();
  const args =
    py === 'py'
      ? ['-3', 'capcut_tts_ctypes.py', text]
      : ['capcut_tts_ctypes.py', text];

  let output = '';
  try {
    output = execFileSync(py, args, {
      cwd: capcutDir,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120_000,
      env: {
        ...process.env,
        // Ensure DLL dir is on PATH for load
        PATH: `${hit.appDir}${path.delimiter}${process.env.PATH || ''}`,
      },
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const e = error as { message?: string; stdout?: string; stderr?: string };
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').slice(0, 800);
    throw new Error(
      `CapCut TTS thất bại (voice=${resolved.voiceName} rid=${resolved.resourceId} dll=${hit.version || hit.dllPath}): ${detail}`,
    );
  }

  const urlMatch = output.match(/Audio URL:\s*(https?:\/\/[^\s]+)/);
  if (!urlMatch?.[1]) {
    throw new Error(
      `CapCut TTS không trả URL audio. voice=${resolved.displayName} (${resolved.resourceId}). stdout: ${output.slice(0, 400)}`,
    );
  }

  const res = await fetch(urlMatch[1]);
  if (!res.ok) {
    throw new Error(`Không tải được MP3 CapCut HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Diagnostic for UI / health check */
export function diagnoseCapCutInstall(): {
  ok: boolean;
  dllPath: string | null;
  version: string | null;
  voiceCount: number;
  message: string;
} {
  const hit = findCapCutSscronet();
  const summary = listCapCutVoicesSummary();
  if (!hit) {
    return {
      ok: false,
      dllPath: null,
      version: null,
      voiceCount: summary.total,
      message: capCutDllMissingMessage(),
    };
  }
  return {
    ok: true,
    dllPath: hit.dllPath,
    version: hit.version || null,
    voiceCount: summary.total,
    message: `OK · ${hit.dllPath} · ${summary.total} giọng catalog`,
  };
}
