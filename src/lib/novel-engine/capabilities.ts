/**
 * Capability matrix — báo rõ cái gì có / thiếu (IRON B10: không ngụ ý auto-fallback).
 */
import fs from 'fs';
import path from 'path';
import { API } from '@/contracts';
import { ALL_NAV_GATEWAY_ACTIONS } from '@/lib/nav/navPythonBridge';
import { getEngineRoot } from './store/diskStore';
import { getRunnerMeta } from './runner';

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function buildCapabilitiesReport() {
  const root = process.cwd();
  const ffmpeg = exists(path.join(root, 'bin', 'ffmpeg.exe'));
  const piper = exists(path.join(root, 'bin', 'piper', 'piper.exe'));
  const gateway = exists(path.join(root, 'python_core', 'gateway', 'nav_gateway.py'));
  const capcutDir = path.join(
    process.env.LOCALAPPDATA || '',
    'CapCut',
    'Apps',
  );
  let capcut = false;
  if (exists(capcutDir)) {
    try {
      for (const v of fs.readdirSync(capcutDir)) {
        if (exists(path.join(capcutDir, v, 'sscronet.dll'))) {
          capcut = true;
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return {
    engine: {
      mode: 'native-ts',
      independent: true,
      dependsOnAinovelGui: false,
      dependsOnPort8080: false,
      root: getEngineRoot(),
      runner: getRunnerMeta(),
    },
    media: {
      ffmpeg: { available: ffmpeg, path: 'bin/ffmpeg.exe' },
      piper: { available: piper, path: 'bin/piper/piper.exe' },
      edgeTts: {
        available: true,
        note: 'Chỉ khi user chọn platform edge_tts — không phải fallback cho engine khác',
      },
      capcutTts: {
        available: capcut,
        note: capcut
          ? 'CapCut desktop detected'
          : 'Missing — hard-fail nếu chọn CapCut TTS (không nhảy Edge)',
      },
      exportCapcutProject: {
        available: true,
        note: 'Xuất file project không cần CapCut cài để gen media',
      },
    },
    nav: {
      pythonCoreGateway: gateway,
      actions: ALL_NAV_GATEWAY_ACTIONS,
      dependsOnNavToolsExe: false,
    },
    apis: {
      generate: API.generate,
      tts: API.generateTts,
      ainovel: [
        API.ainovel.status,
        API.ainovel.start,
        API.ainovel.stop,
        API.ainovel.stream,
        API.ainovel.config,
        API.ainovel.chapters,
        API.ainovel.diag,
        API.ainovel.capabilities,
      ],
    },
  };
}
