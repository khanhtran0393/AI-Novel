import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

export type GpuType = 'nvidia' | 'amd' | null;

export interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  duration: number;
  hasAudio: boolean;
}

export interface CapAssistantBuildResult {
  ffmpegPath: string;
  ffmpegArgs: string[];
  commandLine: string;
  outputPath: string;
  tempFiles: string[];
  metadata: VideoMetadata;
  filterComplex: string;
}

/**
 * CapAssistant parity engine — fully independent of CapAssistant install path.
 * All tools resolve from AI Novel project root: bin/, fonts/, output/.
 * Also supports Electron packaged layout (resources/bin).
 */
function electronResourcesPath(): string {
  const maybe = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof maybe === 'string' ? maybe : '';
}

function resolveProjectRoot(): string {
  const candidates = [
    process.env.AI_NOVEL_ROOT,
    process.env.INIT_CWD,
    process.cwd(),
    electronResourcesPath(),
    path.join(process.cwd(), '..'),
  ].filter(Boolean) as string[];

  for (const root of candidates) {
    if (fs.existsSync(path.join(root, 'bin', 'ffmpeg.exe'))) return root;
    if (fs.existsSync(path.join(root, 'package.json')) && fs.existsSync(path.join(root, 'bin'))) return root;
  }
  return process.cwd();
}

const PROJECT_ROOT = resolveProjectRoot();
const LOCAL_FFMPEG = path.join(PROJECT_ROOT, 'bin', 'ffmpeg.exe');
const LOCAL_FFPROBE = path.join(PROJECT_ROOT, 'bin', 'ffprobe.exe');
const LOCAL_FFPLAY = path.join(PROJECT_ROOT, 'bin', 'ffplay.exe');
const FONTS_DIR = path.join(PROJECT_ROOT, 'fonts');
const DEFAULT_FONT = path.join(FONTS_DIR, 'Anton-Regular.ttf');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');

export function resolveFfmpegPath(): string {
  const roots = [PROJECT_ROOT, process.cwd(), electronResourcesPath()].filter(Boolean) as string[];
  for (const root of roots) {
    const p = path.join(root, 'bin', 'ffmpeg.exe');
    if (fs.existsSync(p)) return p;
  }
  if (fs.existsSync(LOCAL_FFMPEG)) return LOCAL_FFMPEG;
  return 'ffmpeg';
}

export function resolveFfprobePath(): string {
  const roots = [PROJECT_ROOT, process.cwd(), electronResourcesPath()].filter(Boolean) as string[];
  for (const root of roots) {
    const p = path.join(root, 'bin', 'ffprobe.exe');
    if (fs.existsSync(p)) return p;
  }
  if (fs.existsSync(LOCAL_FFPROBE)) return LOCAL_FFPROBE;
  return 'ffprobe';
}

export function resolveFfplayPath(): string {
  const roots = [PROJECT_ROOT, process.cwd(), electronResourcesPath()].filter(Boolean) as string[];
  for (const root of roots) {
    const p = path.join(root, 'bin', 'ffplay.exe');
    if (fs.existsSync(p)) return p;
  }
  if (fs.existsSync(LOCAL_FFPLAY)) return LOCAL_FFPLAY;
  return 'ffplay';
}

/** @deprecated use resolveFfmpegPath() — kept for compatibility */
const FFMPEG_PATH = resolveFfmpegPath();
/** @deprecated use resolveFfprobePath() */
const FFPROBE_PATH = resolveFfprobePath();

export const CAPASSISTANT_BYPASS_FX: Record<string, string> = {
  'Không (None)': '',
  'Khong (None)': '',
  'TEST 2: Dao mau (Negative)': 'negate',
  'TEST 2: Đảo màu (Negative)': 'negate',
  'Nhieu hat (Fine Noise)': 'noise=alls=7:allf=t',
  'Nhiễu hạt (Fine Noise)': 'noise=alls=7:allf=t',
  'Vien mo (Soft Vignette)': 'vignette=angle=PI/4',
  'Viền mờ (Soft Vignette)': 'vignette=angle=PI/4',
  'Tang sac net (Sharpen)': 'unsharp=3:3:1.5:3:3:0.5',
  'Tăng sắc nét (Sharpen)': 'unsharp=3:3:1.5:3:3:0.5',
  'Mau phim (Cinematic Tint)': 'curves=preset=vintage',
  'Màu phim (Cinematic Tint)': 'curves=preset=vintage',
  'Lop phu guong (Glass Edge)': 'boxblur=10:5',
  'Lớp phủ gương (Glass Edge)': 'boxblur=10:5',
  'Lach AI 1 (Motion Blur)': 'minterpolate=mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=30',
  'Lách AI 1 (Motion Blur)': 'minterpolate=mi_mode=mci:mc_mode=aobmc:vsbmc=1:fps=30',
  'Lach AI 2 (Gamma Shift)': 'eq=gamma=1.05:gamma_weight=0.9',
  'Lách AI 2 (Gamma Shift)': 'eq=gamma=1.05:gamma_weight=0.9',
  'Lach AI 3 (Dynamic Hue)': "hue='h=1*sin(2*PI*t/5):s=1.05'",
  'Lách AI 3 (Dynamic Hue)': "hue='h=1*sin(2*PI*t/5):s=1.05'",
  'Lach AI 4 (Ghost Pattern)': 'drawgradients=c1=000000@0.01:c2=ffffff@0.01:x1=w/2:y1=h/2:r1=w:r2=w:t=radial',
  'Lách AI 4 (Ghost Pattern)': 'drawgradients=c1=000000@0.01:c2=ffffff@0.01:x1=w/2:y1=h/2:r1=w:r2=w:t=radial',
  'Lach AI 5 (Macroblock Noise)': 'cas=0.5,addnoise=1:1:1:1:1:1',
  'Lách AI 5 (Macroblock Noise)': 'cas=0.5,addnoise=1:1:1:1:1:1',
};

function shellQuote(value: string) {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function displayCommand(ffmpegPath: string, args: string[]) {
  return [ffmpegPath, ...args].map(arg => /[\s"'&()[\]{};!]/.test(arg) ? shellQuote(arg) : arg).join(' ');
}

export function escapeFfmpegText(text: string) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,');
}

export function escapeFilterPath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function parsePercent(value: unknown, defaultValue = 100) {
  if (typeof value === 'number') return value;
  const parsed = parseFloat(String(value ?? defaultValue).replace('%', ''));
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseNumber(value: unknown, defaultValue = 0) {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseTimeInput(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (!raw.includes(':')) return parseNumber(raw, 0);
  const parts = raw.split(':').map(part => parseFloat(part));
  if (parts.some(part => !Number.isFinite(part))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function parseFps(rate: string) {
  const clean = String(rate || '').trim();
  if (clean.includes('/')) {
    const [num, den] = clean.split('/').map(Number);
    return den ? num / den : 30;
  }
  const parsed = parseFloat(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

export function detectGpu(): GpuType {
  const nvidia = spawnSync('nvidia-smi', [], { windowsHide: true, encoding: 'utf8', timeout: 2500 });
  if (nvidia.status === 0) return 'nvidia';

  const wmic = spawnSync('wmic', ['path', 'win32_VideoController', 'get', 'name'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 2500,
  });
  const output = `${wmic.stdout || ''} ${wmic.stderr || ''}`.toUpperCase();
  if (output.includes('AMD') || output.includes('RADEON')) return 'amd';
  return null;
}

export function probeVideo(videoPath: string): VideoMetadata {
  const ffprobe = resolveFfprobePath();
  const metadata: VideoMetadata = {
    width: 1920,
    height: 1080,
    fps: 30,
    frameCount: 0,
    duration: 0,
    hasAudio: false,
  };

  const videoProbe = spawnSync(
    ffprobe,
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,nb_frames,duration',
      '-of', 'json',
      videoPath,
    ],
    { windowsHide: true, encoding: 'utf8' },
  );

  try {
    const stream = JSON.parse(videoProbe.stdout || '{}')?.streams?.[0];
    if (stream) {
      metadata.width = Number(stream.width) || metadata.width;
      metadata.height = Number(stream.height) || metadata.height;
      metadata.fps = parseFps(stream.r_frame_rate);
      metadata.duration = parseFloat(stream.duration) || metadata.duration;
      metadata.frameCount = Number(stream.nb_frames) || Math.round(metadata.duration * metadata.fps) || 0;
    }
  } catch {
    // Keep defaults when ffprobe output is not JSON.
  }

  const formatProbe = spawnSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', videoPath],
    { windowsHide: true, encoding: 'utf8' },
  );
  metadata.duration = parseFloat(formatProbe.stdout || '') || metadata.duration;
  if (!metadata.frameCount && metadata.duration > 0) metadata.frameCount = Math.round(metadata.duration * metadata.fps);

  const audioProbe = spawnSync(
    ffprobe,
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoPath],
    { windowsHide: true, encoding: 'utf8' },
  );
  metadata.hasAudio = (audioProbe.stdout || '').toLowerCase().includes('audio');

  return metadata;
}

/** Chain atempo filters for speeds outside FFmpeg's 0.5–2.0 per-stage range (CapAssistant parity + fix). */
export function buildAtempoChain(speed: number): string {
  let remaining = speed;
  const parts: string[] = [];
  // Clamp extreme values
  remaining = Math.max(0.05, Math.min(100, remaining));
  while (remaining > 2.0001) {
    parts.push('atempo=2.0');
    remaining /= 2;
  }
  while (remaining < 0.4999) {
    parts.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.001) {
    parts.push(`atempo=${remaining.toFixed(4)}`);
  }
  return parts.join(',');
}

function shiftSrtTimestamp(timestamp: string, delayMs: number) {
  if (!delayMs) return timestamp;
  const match = timestamp.trim().match(/^(\d+):(\d+):(\d+),(\d+)$/);
  if (!match) return timestamp;
  let totalMs =
    Number(match[1]) * 3600000 +
    Number(match[2]) * 60000 +
    Number(match[3]) * 1000 +
    Number(match[4]) +
    delayMs;
  totalMs = Math.max(0, totalMs);
  const h = Math.floor(totalMs / 3600000);
  totalMs %= 3600000;
  const m = Math.floor(totalMs / 60000);
  totalMs %= 60000;
  const s = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function processSrtForCapAssistant(input: string, options: {
  delaySec?: number;
  styleIndex?: number;
  padX?: number;
  padY?: number;
  usePadding?: boolean;
}) {
  const delayMs = Math.round((options.delaySec || 0) * 1000);
  const styleIndex = options.styleIndex || 0;
  const usePadding = Boolean(options.usePadding);
  const padX = usePadding ? Math.max(0, options.padX ?? 16) : 0;
  const padY = usePadding ? Math.max(0, options.padY ?? 6) : 0;
  const extraX = Math.max(0, padX - padY);
  const hStr = '\\h'.repeat(Math.floor(extraX / 8) + 1);
  const assTags = styleIndex !== 0 ? `{\\xbord${padX}\\ybord${padY}}` : '';

  return input
    .split(/\r?\n\r?\n/)
    .map(block => {
      const lines = block.split(/\r?\n/);
      const timeIndex = lines.findIndex(line => line.includes('-->'));
      if (timeIndex === -1) return block;
      const [startRaw, endRaw] = lines[timeIndex].split('-->').map(part => part.trim());
      lines[timeIndex] = `${shiftSrtTimestamp(startRaw, delayMs)} --> ${shiftSrtTimestamp(endRaw, delayMs)}`;
      for (let i = timeIndex + 1; i < lines.length; i++) {
        const clean = lines[i].replace(/[\r\n]+/g, ' ').trim();
        if (!clean) continue;
        lines[i] = `${assTags}${hStr}${clean}${hStr}`;
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function getSubtitleStyle(styleValue: unknown) {
  const raw = String(styleValue ?? '');
  const normalized = raw.toLowerCase();
  let index = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  if (normalized.includes('netflix') || normalized.includes('đen mờ') || normalized.includes('den mo')) index = 1;
  if (normalized.includes('tiktok') || normalized.includes('vàng') || normalized.includes('vang')) index = 2;
  if (normalized.includes('trắng') || normalized.includes('trang')) index = 3;
  if (normalized.includes('xanh') || normalized.includes('blue')) index = 4;

  if (index === 1) {
    return 'PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,WrapStyle=2';
  }
  if (index === 2) {
    return 'PrimaryColour=&H00000000,OutlineColour=&H0000FFFF,BackColour=&H0000FFFF,BorderStyle=3,Outline=1,Shadow=0,WrapStyle=2';
  }
  if (index === 3) {
    return 'PrimaryColour=&H00000000,OutlineColour=&H00FFFFFF,BackColour=&H00FFFFFF,BorderStyle=3,Outline=1,Shadow=0,WrapStyle=2';
  }
  if (index === 4) {
    return 'PrimaryColour=&H00FFFFFF,OutlineColour=&H00FF0000,BackColour=&H00FF0000,BorderStyle=3,Outline=1,Shadow=0,WrapStyle=2';
  }
  return 'PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=0';
}

function getBypassFilter(payload: any) {
  const direct = payload?.phantom?.bypassFx || payload?.phantom?.fx || payload?.style?.bypassFx || payload?.bypassFx;
  if (!direct) return '';
  const raw = String(direct).toLowerCase();
  const normalized = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd');
  if (raw.includes('none') || normalized.includes('khong')) return '';
  if (raw.includes('negative') || normalized.includes('dao mau')) return CAPASSISTANT_BYPASS_FX['TEST 2: Dao mau (Negative)'];
  if (raw.includes('fine noise') || normalized.includes('nhieu hat')) return CAPASSISTANT_BYPASS_FX['Nhieu hat (Fine Noise)'];
  if (raw.includes('soft vignette') || normalized.includes('vien mo')) return CAPASSISTANT_BYPASS_FX['Vien mo (Soft Vignette)'];
  if (raw.includes('sharpen') || normalized.includes('tang sac net')) return CAPASSISTANT_BYPASS_FX['Tang sac net (Sharpen)'];
  if (raw.includes('cinematic tint') || normalized.includes('mau phim')) return CAPASSISTANT_BYPASS_FX['Mau phim (Cinematic Tint)'];
  if (raw.includes('glass edge') || normalized.includes('lop phu guong')) return CAPASSISTANT_BYPASS_FX['Lop phu guong (Glass Edge)'];
  if (raw.includes('motion blur') || normalized.includes('lach ai 1')) return CAPASSISTANT_BYPASS_FX['Lach AI 1 (Motion Blur)'];
  if (raw.includes('gamma shift') || normalized.includes('lach ai 2')) return CAPASSISTANT_BYPASS_FX['Lach AI 2 (Gamma Shift)'];
  if (raw.includes('dynamic hue') || normalized.includes('lach ai 3')) return CAPASSISTANT_BYPASS_FX['Lach AI 3 (Dynamic Hue)'];
  if (raw.includes('ghost pattern') || normalized.includes('lach ai 4')) return CAPASSISTANT_BYPASS_FX['Lach AI 4 (Ghost Pattern)'];
  if (raw.includes('macroblock noise') || normalized.includes('lach ai 5')) return CAPASSISTANT_BYPASS_FX['Lach AI 5 (Macroblock Noise)'];
  return CAPASSISTANT_BYPASS_FX[String(direct)] || '';
}

function normalizeTrimItems(trim: any) {
  const rawItems = trim?.items || trim?.rems || [];
  return rawItems
    .map((item: any) => ({ start: parseTimeInput(item.start), end: parseTimeInput(item.end) }))
    .filter((item: { start: number; end: number }) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((a: { start: number }, b: { start: number }) => a.start - b.start);
}

export function buildCapAssistantCommand(payload: any): CapAssistantBuildResult {
  const videoPath = String(payload.videoPath || '');
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const outputDir = String(payload.outputPath || path.join(PROJECT_ROOT, 'output'));
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = String(payload.finalOutputPath || path.join(outputDir, `Output_${Date.now()}.mp4`));
  const metadata = payload.metadata || probeVideo(videoPath);
  const previewW = Number(payload.previewWidth || payload.preview_w || 1024);
  const previewH = Number(payload.previewHeight || payload.preview_h || 768);
  const mapX = (x: unknown) => Math.floor(parseNumber(x, 0) * metadata.width / previewW);
  const mapY = (y: unknown) => Math.floor(parseNumber(y, 0) * metadata.height / previewH);

  const inputsRaw = ['-y'];
  if (video.loop || payload.loopVideo) inputsRaw.push('-stream_loop', '-1');
  inputsRaw.push('-i', videoPath.replace(/\\/g, '/'));
  const vFilters: string[] = [];
  const aFilters: string[] = [];
  const tempFiles: string[] = [];
  let currV = '0:v';
  let currA = '0:a';
  let ptr = 1;

  const video = payload.video || {};
  const sub = payload.sub || {};
  const bgm = payload.bgm || {};
  const brand = payload.brand || {};
  const trim = payload.trim || {};
  const phantom = payload.phantom || {};

  const speedFactor = parsePercent(video.speed ?? payload.speed, 100) / 100;
  if (speedFactor !== 1 && speedFactor > 0) {
    vFilters.push(`[${currV}]setpts=${1 / speedFactor}*PTS[vspd]`);
    currV = 'vspd';
    if (metadata.hasAudio) {
      const atempo = buildAtempoChain(speedFactor);
      if (atempo) {
        aFilters.push(`[${currA}]${atempo}[aspd]`);
        currA = 'aspd';
      }
    }
  }

  const trimItems = normalizeTrimItems(trim);
  if ((trim.enableTrim || trim.enabled) && trimItems.length > 0) {
    const totalDuration = speedFactor > 0 ? metadata.duration / speedFactor : metadata.duration;
    const keeps: Array<{ start: number; end: number }> = [];
    let lastTime = 0;
    for (const rem of trimItems) {
      if (rem.start > lastTime) keeps.push({ start: lastTime, end: rem.start });
      lastTime = Math.max(lastTime, rem.end);
    }
    if (totalDuration > lastTime) keeps.push({ start: lastTime, end: totalDuration });

    if (keeps.length > 0) {
      const splitVTags = keeps.map((_, i) => `[sv${i}]`).join('');
      const vParts: string[] = [];
      const aParts: string[] = [];
      vFilters.push(`[${currV}]split=${keeps.length}${splitVTags}`);
      if (metadata.hasAudio) {
        const splitATags = keeps.map((_, i) => `[sa${i}]`).join('');
        aFilters.push(`[${currA}]asplit=${keeps.length}${splitATags}`);
      }
      keeps.forEach((keep, i) => {
        vFilters.push(`[sv${i}]trim=${keep.start}:${keep.end},setpts=PTS-STARTPTS[v${i}]`);
        vParts.push(`[v${i}]`);
        if (metadata.hasAudio) {
          aFilters.push(`[sa${i}]atrim=${keep.start}:${keep.end},asetpts=PTS-STARTPTS[a${i}]`);
          aParts.push(`[a${i}]`);
        }
      });
      vFilters.push(`${vParts.join('')}concat=n=${keeps.length}:v=1:a=0[vt]`);
      currV = 'vt';
      if (metadata.hasAudio && aParts.length) {
        aFilters.push(`${aParts.join('')}concat=n=${keeps.length}:v=0:a=1[at]`);
        currA = 'at';
      }
    }
  }

  const zoom = parsePercent(video.zoom ?? payload.zoom, 100);
  if (zoom > 100) {
    const z = zoom / 100;
    vFilters.push(`[${currV}]crop=iw/${z}:ih/${z}:(iw-iw/${z})/2:(ih-ih/${z})/2,scale=${metadata.width}:${metadata.height}[vz]`);
    currV = 'vz';
  }

  if (video.flip || payload.flip) {
    vFilters.push(`[${currV}]hflip[vf]`);
    currV = 'vf';
  }

  const rotate = parseNumber(phantom.bpRotate ?? phantom.rotate, 0);
  if (rotate !== 0) {
    vFilters.push(`[${currV}]rotate=${rotate}*PI/180:ow=iw:oh=ih[vrot]`);
    currV = 'vrot';
  }

  const brightness = parseNumber(phantom.brightness ?? phantom.bright, 0) / 100;
  const contrast = parseNumber(phantom.contrast, 100) / 100;
  const saturation = parseNumber(phantom.saturation ?? phantom.sat, 100) / 100;
  if (brightness !== 0 || contrast !== 1 || saturation !== 1 || phantom.bp3) {
    const b = phantom.bp3 && brightness === 0 ? 0.01 : brightness;
    const c = phantom.bp3 && contrast === 1 ? 1.02 : contrast;
    const s = phantom.bp3 && saturation === 1 ? 1.03 : saturation;
    vFilters.push(`[${currV}]eq=brightness=${b}:contrast=${c}:saturation=${s}[veq]`);
    currV = 'veq';
  }

  const bypassFilter = getBypassFilter(payload);
  if (bypassFilter) {
    vFilters.push(`[${currV}]${bypassFilter}[vfx]`);
    currV = 'vfx';
  }

  const blurItems = (payload.blur?.items || []).filter((item: any) => item && item.visible !== false);
  if (blurItems.length > 0) {
    const splitTags = blurItems.map((_: any, i: number) => `[tb${i}]`).join('');
    vFilters.push(`[${currV}]split=${blurItems.length + 1}${splitTags}[bgc]`);
    let currentBg = 'bgc';
    const blurPower = parseNumber(payload.blur?.power ?? payload.blur?.blurPower, 20);
    blurItems.forEach((item: any, i: number) => {
      let cx = Math.max(0, mapX(item.x));
      let cy = Math.max(0, mapY(item.y));
      let cw = Math.max(2, mapX(item.w));
      let ch = Math.max(2, mapY(item.h));
      cx = Math.floor(cx / 2) * 2;
      cy = Math.floor(cy / 2) * 2;
      if (cx + cw >= metadata.width - 15) cw = metadata.width - cx;
      if (cy + ch >= metadata.height - 15) ch = metadata.height - cy;
      cw = Math.max(2, Math.floor(cw / 2) * 2);
      ch = Math.max(2, Math.floor(ch / 2) * 2);
      const luma = Math.floor(Math.max(1, Math.min(blurPower, 20, (cw - 2) / 4, (ch - 2) / 4)));
      const start = parseTimeInput(item.start);
      const dur = parseTimeInput(item.dur ?? item.duration);
      const enableStr = dur > 0 ? `:enable='between(t,${start},${start + dur})'` : '';
      vFilters.push(`[tb${i}]crop=${cw}:${ch}:${cx}:${cy},boxblur=${luma}:2[bl${i}]`);
      vFilters.push(`[${currentBg}][bl${i}]overlay=${cx}:${cy}${enableStr}[bs${i}]`);
      currentBg = `bs${i}`;
    });
    currV = currentBg;
  }

  if (phantom.enableFrame && phantom.framePath && fs.existsSync(phantom.framePath)) {
    inputsRaw.push('-i', String(phantom.framePath).replace(/\\/g, '/'));
    vFilters.push(`[${ptr}:v]scale=${metadata.width}:${metadata.height}[frm]`);
    vFilters.push(`[${currV}][frm]overlay=0:0[vfr]`);
    ptr += 1;
    currV = 'vfr';
  }

  if ((brand.useLogo ?? true) && brand.logoPath && fs.existsSync(brand.logoPath)) {
    inputsRaw.push('-i', String(brand.logoPath).replace(/\\/g, '/'));
    const logoPercent = parseNumber(brand.logoRescale ?? brand.logoSize, 12);
    const logoWidth = logoPercent > 50 ? Math.max(16, logoPercent) : Math.max(16, Math.round(metadata.width * logoPercent / 100));
    const logoDelay = parseNumber(brand.logoDelay, 0);
    const enableStr = logoDelay > 0 ? `:enable='gte(t,${logoDelay})'` : '';
    const logoX = mapX(brand.logoX ?? 24);
    const logoY = mapY(brand.logoY ?? 24);
    vFilters.push(`[${ptr}:v]scale=${logoWidth}:-1[lsc]`);
    vFilters.push(`[${currV}][lsc]overlay=${logoX}:${logoY}${enableStr}[vl]`);
    ptr += 1;
    currV = 'vl';
  }

  if ((brand.useText ?? true) && brand.staticText) {
    const font = brand.staticFontPath && fs.existsSync(brand.staticFontPath) ? brand.staticFontPath : DEFAULT_FONT;
    const tx = brand.staticX !== undefined ? mapX(brand.staticX) : '(w-text_w)/2';
    const ty = brand.staticY !== undefined ? mapY(brand.staticY) : 'h-th-20';
    const textDelay = parseNumber(brand.staticDelay, 0);
    const enableStr = textDelay > 0 ? `:enable='gte(t,${textDelay})'` : '';
    vFilters.push(
      `[${currV}]drawtext=text='${escapeFfmpegText(brand.staticText)}':fontfile='${escapeFilterPath(font)}':fontcolor=white:fontsize=${parseNumber(brand.staticSize, 32)}:x=${tx}:y=${ty}${enableStr}[vst]`,
    );
    currV = 'vst';
  }

  if ((brand.useWatermark ?? brand.useWm ?? true) && brand.wmText) {
    const wmDelay = parseNumber(brand.wmDelay, 0);
    const enableStr = wmDelay > 0 ? `:enable='gte(t,${wmDelay})'` : '';
    const xExpr = 'abs(mod(t*15, 2*(w-tw)) - (w-tw))';
    const yExpr = 'abs(mod(t*10, 2*(h-th)) - (h-th))';
    const font = fs.existsSync(DEFAULT_FONT) ? DEFAULT_FONT : '';
    const fontFile = font ? `:fontfile='${escapeFilterPath(font)}'` : '';
    vFilters.push(
      `[${currV}]drawtext=text='${escapeFfmpegText(brand.wmText)}'${fontFile}:fontcolor=white@0.5:fontsize=${parseNumber(brand.wmSize, 16)}:x='${xExpr}':y='${yExpr}'${enableStr}[vwm]`,
    );
    currV = 'vwm';
  }

  let activeSrtContent = String(sub.srtContent || sub.translatedSrtContent || '');
  if (!activeSrtContent && sub.srtPath && fs.existsSync(sub.srtPath)) {
    activeSrtContent = fs.readFileSync(sub.srtPath, 'utf8');
  }

  if (sub.enableSub && activeSrtContent.trim()) {
    const styleIndex = Number.isFinite(Number(sub.styleIndex))
      ? Number(sub.styleIndex)
      : Number.isFinite(Number(payload.style?.srtStyleIndex))
        ? Number(payload.style.srtStyleIndex)
        : 0;
    // CapAssistant style index from combo text (Netflix/TikTok/...)
    const styleFromName = payload.style?.srtStyle ?? sub.srtStyle ?? styleIndex;
    const processedSrt = processSrtForCapAssistant(activeSrtContent, {
      delaySec: parseNumber(sub.delay ?? sub.srtDelay, 0),
      styleIndex: Number.isFinite(Number(styleFromName)) ? Number(styleFromName) : styleIndex,
      padX: parseNumber(sub.padX ?? payload.style?.padX, 16),
      padY: parseNumber(sub.padY ?? payload.style?.padY, 6),
      usePadding: Boolean(sub.hasBg || sub.usePadding || payload.style?.bgPadding || payload.style?.usePadding),
    });
    fs.mkdirSync(outputDir, { recursive: true });
    const tempSrtPath = path.join(outputDir, `temp_render_active_${Date.now()}_${Math.round(Math.random() * 100000)}.srt`);
    fs.writeFileSync(tempSrtPath, processedSrt, 'utf8');
    tempFiles.push(tempSrtPath);

    const assStyle = getSubtitleStyle(styleFromName);
    const fontName = sub.srtFont || sub.font || 'Anton';
    // CapAssistant: margin_v = dist_from_bottom / preview_h * 288
    let marginV = Math.max(0, Math.round(parseNumber(sub.marginV, 40)));
    if (sub.proxyY !== undefined || sub.srtY !== undefined) {
      const proxyY = parseNumber(sub.proxyY ?? sub.srtY, previewH * 0.85);
      const proxyH = parseNumber(sub.proxyH ?? sub.srtH, 40);
      const distFromBottom = previewH - (proxyY + proxyH);
      marginV = Math.max(0, Math.round((distFromBottom / previewH) * 288));
    }
    const syncSize = Math.round(parseNumber(sub.srtSize ?? sub.fontSize, 24) * 1.25);
    const fontsDir = fs.existsSync(FONTS_DIR) ? `:fontsdir='${escapeFilterPath(FONTS_DIR)}'` : '';
    const forceStyle = `FontName=${fontName},FontSize=${syncSize},Alignment=2,MarginV=${marginV},${assStyle}`;
    vFilters.push(`[${currV}]subtitles=filename='${escapeFilterPath(tempSrtPath)}'${fontsDir}:force_style='${forceStyle}'[vsrt]`);
    currV = 'vsrt';
  }

  vFilters.push(`[${currV}]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vf]`);
  currV = 'vf';

  const audioMix: string[] = [];
  if (metadata.hasAudio) {
    const muted = Boolean(video.mute);
    const vol = muted ? 0 : parseNumber(video.volume, 100) / 100;
    const vocalFilter = Boolean(video.vocalFilter);
    const vmod = vocalFilter ? 'equalizer=f=1000:width_type=o:width=3:g=-18,' : '';
    aFilters.push(`[${currA}]${vmod}volume=${vocalFilter ? vol * 0.15 : vol}[bga]`);
    audioMix.push('[bga]');
  }

  const musicItems = bgm.items || [];
  musicItems.forEach((entry: any, i: number) => {
    if (!entry?.path || !fs.existsSync(entry.path)) return;
    if (entry.loop) inputsRaw.push('-stream_loop', '-1');
    inputsRaw.push('-i', String(entry.path).replace(/\\/g, '/'));
    const delayMs = Math.floor(parseNumber(entry.delay, 0) * 1000);
    const volume = parseNumber(entry.vol ?? entry.volume, 100) / 100;
    const playDur = parseNumber(entry.dur ?? entry.playDur, 0);
    const trimFilter = playDur > 0 ? `,atrim=0:${playDur}` : '';
    aFilters.push(`[${ptr}:a]adelay=${delayMs}|${delayMs}${trimFilter},volume=${volume}[m${i}]`);
    audioMix.push(`[m${i}]`);
    ptr += 1;
  });

  if (audioMix.length > 1) {
    aFilters.push(`${audioMix.join('')}amix=inputs=${audioMix.length}:duration=longest:dropout_transition=99999,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[af]`);
    currA = 'af';
  } else if (audioMix.length === 1) {
    aFilters.push(`${audioMix[0]}aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[af]`);
    currA = 'af';
  }

  const ffmpegPath = resolveFfmpegPath();
  const ffmpegArgs = ['-hide_banner', '-loglevel', 'error', ...inputsRaw];
  const filterComplex = [...vFilters, ...aFilters].join(';');
  if (filterComplex) {
    ffmpegArgs.push('-filter_complex', filterComplex, '-map', `[${currV}]`);
    if (audioMix.length > 0) ffmpegArgs.push('-map', `[${currA}]`);
  } else {
    ffmpegArgs.push('-map', '0:v');
    if (metadata.hasAudio && !video.mute) ffmpegArgs.push('-map', '0:a?');
  }

  if (musicItems.length > 0 || trimItems.length > 0 || video.loop || payload.loopVideo) ffmpegArgs.push('-shortest');

  const wantsGpu = Boolean(video.gpu);
  const gpuType = wantsGpu ? (payload.gpuType ?? detectGpu()) : null;
  if (wantsGpu && gpuType === 'nvidia') {
    ffmpegArgs.push('-c:v', 'h264_nvenc', '-preset', 'fast', '-cq', '19', '-b:v', '0');
  } else if (wantsGpu && gpuType === 'amd') {
    ffmpegArgs.push('-c:v', 'h264_amf', '-quality', 'quality', '-qp_i', '19');
  } else {
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19');
  }
  ffmpegArgs.push('-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outputPath);

  return {
    ffmpegPath,
    ffmpegArgs,
    commandLine: displayCommand(ffmpegPath, ffmpegArgs),
    outputPath,
    tempFiles,
    metadata,
    filterComplex,
  };
}

export function buildSmartJoinCommand(videoPaths: string[], outputPath: string, targetRatio = 'Giữ nguyên') {
  if (videoPaths.length === 0) throw new Error('No videos provided');
  videoPaths.forEach(videoPath => {
    if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let targetW = 1920;
  let targetH = 1080;
  const ratioLower = targetRatio.toLowerCase();
  if (targetRatio.includes('9:16') || ratioLower.includes('doc') || ratioLower.includes('dọc')) {
    targetW = 1080;
    targetH = 1920;
  } else if (ratioLower.includes('giữ') || ratioLower.includes('giu') || ratioLower.includes('nguyên') || ratioLower.includes('nguyen') || (!targetRatio.includes('16:9') && !ratioLower.includes('ngang'))) {
    const firstMeta = probeVideo(videoPaths[0]);
    targetW = Math.floor((firstMeta.width || 1920) / 2) * 2;
    targetH = Math.floor((firstMeta.height || 1080) / 2) * 2;
  }

  const ffmpegPath = resolveFfmpegPath();
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const vFilters: string[] = [];
  const aFilters: string[] = [];
  const concatV: string[] = [];
  const concatA: string[] = [];

  videoPaths.forEach((videoPath, i) => {
    const meta = probeVideo(videoPath);
    const duration = Math.max(0.1, meta.duration || 1);
    args.push('-i', videoPath.replace(/\\/g, '/'));
    vFilters.push(
      `[${i}:v]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v${i}]`,
    );
    concatV.push(`[v${i}]`);
    if (meta.hasAudio) {
      aFilters.push(`[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,aresample=async=1[a${i}]`);
    } else {
      // CapAssistant SmartJoin parity: silent audio matching real clip duration.
      aFilters.push(`aevalsrc=0:d=${duration.toFixed(3)}:sample_rate=44100:channel_layout=stereo[a${i}]`);
    }
    concatA.push(`[a${i}]`);
  });

  const filterComplex = [
    ...vFilters,
    ...aFilters,
    `${concatV.join('')}concat=n=${videoPaths.length}:v=1:a=0[outv]`,
    `${concatA.join('')}concat=n=${videoPaths.length}:v=0:a=1[outa]`,
  ].join(';');

  args.push(
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  );

  return {
    ffmpegPath,
    ffmpegArgs: args,
    commandLine: displayCommand(ffmpegPath, args),
    outputPath,
    filterComplex,
  };
}

/** CapAssistant VideoJoinerWorker parity: stream-copy concat demuxer. */
export function buildSimpleJoinCommand(videoPaths: string[], outputPath: string) {
  if (videoPaths.length === 0) throw new Error('No videos provided');
  videoPaths.forEach(videoPath => {
    if (!fs.existsSync(videoPath)) throw new Error(`Video file not found: ${videoPath}`);
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const listPath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
  const listBody = videoPaths
    .map(vp => `file '${vp.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listPath, listBody, 'utf8');

  const ffmpegPath = resolveFfmpegPath();
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    outputPath,
  ];

  return {
    ffmpegPath,
    ffmpegArgs: args,
    commandLine: displayCommand(ffmpegPath, args),
    outputPath,
    tempFiles: [listPath],
    filterComplex: '',
  };
}

export function getCapAssistantRuntimeInfo() {
  return {
    projectRoot: PROJECT_ROOT,
    ffmpeg: resolveFfmpegPath(),
    ffprobe: resolveFfprobePath(),
    ffplay: resolveFfplayPath(),
    fontsDir: FONTS_DIR,
    defaultFont: DEFAULT_FONT,
    outputDir: OUTPUT_DIR,
    independent: true,
    source: 'AI Novel local CapAssistant engine (no CapAssistant.exe dependency)',
  };
}

