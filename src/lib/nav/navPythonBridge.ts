import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { resolvePythonExe } from '@/app/api/self-heal/media/mediaHelpers';
import { hostBindingChildEnv } from '@/lib/nav/hostBinding';

const execFileAsync = promisify(execFile);

/** All gateway actions — bound to AI Novel host (no standalone CLI / no NAVTools.exe). */
export type NavGatewayAction =
  | 'ping'
  | 'version'
  | 'capabilities'
  | 'list_presets'
  | 'script2prompt'
  | 'storyboard'
  | 'youtube_seo'
  | 'youtube_analyze'
  | 'subtitle'
  | 'upscale'
  | 'bg_remove'
  | 'suggest_channels'
  | 'split_video'
  | 'download_video'
  | 'isolate_vocals'
  | 'watermark_audio'
  | 'transcribe'
  | 'probe_video'
  | 'color_grade'
  | 'delogo'
  | 'remove_logo'
  | 'extract_frames'
  | 'make_gif'
  | 'concat_videos'
  | 'video_join'
  | 'resize_video'
  | 'compose_timeline'
  | 'flow_status'
  | 'scheduler_list'
  | 'scheduler_save'
  | 'scheduler_delete';

export const ALL_NAV_GATEWAY_ACTIONS: NavGatewayAction[] = [
  'ping',
  'version',
  'capabilities',
  'list_presets',
  'script2prompt',
  'storyboard',
  'youtube_seo',
  'youtube_analyze',
  'subtitle',
  'upscale',
  'bg_remove',
  'suggest_channels',
  'split_video',
  'download_video',
  'isolate_vocals',
  'watermark_audio',
  'transcribe',
  'probe_video',
  'color_grade',
  'delogo',
  'remove_logo',
  'extract_frames',
  'make_gif',
  'concat_videos',
  'video_join',
  'resize_video',
  'compose_timeline',
  'flow_status',
  'scheduler_list',
  'scheduler_save',
  'scheduler_delete',
];

export interface NavGatewayRequest {
  action: NavGatewayAction;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface NavGatewayResponse<T = unknown> {
  success: boolean;
  error?: string;
  result?: T;
  stdout?: string;
  stderr?: string;
  [key: string]: unknown;
}

const PYTHON_CORE = path.join(process.cwd(), 'python_core');
const GATEWAY_SCRIPT = path.join(PYTHON_CORE, 'gateway', 'nav_gateway.py');

function parseGatewayStdout(stdout: string): NavGatewayResponse {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') || line.startsWith('['));

  if (lines.length === 0) {
    return { success: false, error: 'Gateway returned no JSON output', stdout };
  }

  const parsed = JSON.parse(lines[lines.length - 1]) as NavGatewayResponse;
  if (!parsed.stdout) {
    parsed.stdout = stdout;
  }
  return parsed;
}

export async function callNavGateway<T = unknown>(
  request: NavGatewayRequest,
): Promise<NavGatewayResponse<T>> {
  if (!fs.existsSync(GATEWAY_SCRIPT)) {
    return {
      success: false,
      error: `NAV gateway not found: ${GATEWAY_SCRIPT}. AI Novel requires python_core inside the project (host-bound — no NAVTools.exe, no standalone CLI).`,
    };
  }

  const pythonExe = resolvePythonExe();
  const payloadJson = JSON.stringify(request.payload ?? {});
  const timeout = request.timeoutMs ?? 600_000;
  const bindingEnv = hostBindingChildEnv({
    action: request.action,
    timeoutMs: timeout,
  });

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonExe,
      [GATEWAY_SCRIPT, request.action, payloadJson],
      {
        cwd: PYTHON_CORE,
        env: {
          ...process.env,
          ...bindingEnv,
          PYTHONPATH: PYTHON_CORE,
          PYTHONIOENCODING: 'utf-8',
          TORCH_COMPILE_DISABLE: '1',
        },
        timeout,
        maxBuffer: 100 * 1024 * 1024,
        windowsHide: true,
      },
    );

    const parsed = parseGatewayStdout(stdout);
    if (!parsed.stderr && stderr) {
      parsed.stderr = stderr;
    }
    return parsed as NavGatewayResponse<T>;
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    if (err.stdout) {
      try {
        return parseGatewayStdout(err.stdout) as NavGatewayResponse<T>;
      } catch {
        // fall through
      }
    }
    return {
      success: false,
      error: err.message,
      stdout: err.stdout,
      stderr: err.stderr,
    };
  }
}

export function getNavCoreVersion(): Promise<NavGatewayResponse> {
  return callNavGateway({ action: 'ping', timeoutMs: 30_000 });
}
