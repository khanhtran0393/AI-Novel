/**
 * CapAssist Draft Injection (BypassRender / a_render_bypass_):
 *
 * Ghi thẳng timeline vào draft CapCut PC — KHÔNG hard-render MP4.
 * Giống Cap: mỗi cue TTS (.mp3) đặt đúng startMs trên track audio + caption text.
 * Budget: ~0.2–2s. User mở CapCut → Export (render do CapCut).
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  createAndRenderDraft,
  type ClipSpec,
  type DraftSpec,
  type TrackSpec,
} from 'cutsdk';
import { resolveFfmpegPath } from '@/lib/capassistant/core';
import { parseSrt } from './parseSrt';
import { resolveCapCutDraftsDir } from './capcutDraftPath';

export type CapCutCueAudio = {
  /** Absolute path to cue mp3/wav */
  path: string;
  startMs: number;
  endMs?: number;
  text?: string;
  index?: number;
};

export type InjectCapCutDraftInput = {
  videoPath: string;
  /**
   * CapAssist primary: per-cue TTS files on timeline at startMs.
   * If empty, falls back to single voiceoverPath.
   */
  cueAudios?: CapCutCueAudio[];
  /** Full timeline-aligned voiceover (fallback / optional second track) */
  voiceoverPath?: string;
  /** SRT đã dịch (captions) */
  srtText?: string;
  /** true = volume video audio 0 */
  muteOriginal?: boolean;
  /** 0–1 volume for original video audio when not muted (Cap slider_vol_orig) */
  originalVolume?: number;
  draftName?: string;
  draftsDir?: string;
  workDir?: string;
};

export type InjectCapCutDraftResult = {
  ok: true;
  draftId: string;
  filePath: string;
  draftsDir: string;
  displayName?: string;
  captionCount: number;
  audioClipCount: number;
  method: 'capcut_draft_inject';
};

function probeDurationSec(filePath: string): number {
  try {
    const ffprobe = resolveFfmpegPath().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    const candidates = [
      ffprobe,
      path.join(process.cwd(), 'bin', 'ffprobe.exe'),
      'ffprobe',
    ];
    for (const bin of candidates) {
      const res = spawnSync(
        bin,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          filePath,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
      );
      if (res.status === 0) {
        const n = parseFloat(String(res.stdout || '').trim());
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  } catch {
    /* ignore */
  }
  return 0;
}

function copyMaterial(src: string, workDir: string, name: string): string {
  if (!workDir || !fs.existsSync(src)) return src;
  const dest = path.join(workDir, name);
  try {
    if (path.resolve(src) !== path.resolve(dest)) {
      fs.copyFileSync(src, dest);
    }
    return dest;
  } catch {
    return src;
  }
}

/**
 * CapAssist: video + N audio cues @ timestamps + captions.
 */
export async function injectCapCutDraft(
  input: InjectCapCutDraftInput,
): Promise<InjectCapCutDraftResult> {
  const videoPath = path.resolve(String(input.videoPath || '').trim());
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Draft inject: video không tồn tại: ${videoPath}`);
  }

  const cues = (input.cueAudios || []).filter(
    (c) => c && c.path && fs.existsSync(c.path),
  );
  const voiceoverPath = input.voiceoverPath
    ? path.resolve(String(input.voiceoverPath).trim())
    : '';
  const hasVoiceover = Boolean(voiceoverPath && fs.existsSync(voiceoverPath));

  if (!cues.length && !hasVoiceover) {
    throw new Error(
      'Draft inject: cần cue TTS (per-cue) hoặc voiceover full. Không có audio.',
    );
  }

  const workDir = input.workDir
    ? path.resolve(input.workDir)
    : path.dirname(cues[0]?.path || voiceoverPath);
  fs.mkdirSync(workDir, { recursive: true });

  const videoLocal = copyMaterial(
    videoPath,
    workDir,
    `05_src_video${path.extname(videoPath) || '.mp4'}`,
  );
  const videoDur = probeDurationSec(videoLocal);

  // CapAssist: place each TTS segment at cue start
  const audioClips: ClipSpec[] = [];
  let maxAudioEnd = 0;

  if (cues.length > 0) {
    const cuesDir = path.join(workDir, 'cues_for_draft');
    fs.mkdirSync(cuesDir, { recursive: true });
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      const ext = path.extname(c.path) || '.mp3';
      const local = copyMaterial(
        c.path,
        cuesDir,
        `cue_${String(c.index ?? i + 1).padStart(4, '0')}${ext}`,
      );
      const dur = probeDurationSec(local) || Math.max(0.1, ((c.endMs || 0) - c.startMs) / 1000);
      const startSec = Math.max(0, c.startMs / 1000);
      audioClips.push({
        type: 'audio',
        src: local,
        start: startSec,
        duration: Math.max(0.05, dur),
        volume: 1,
      });
      maxAudioEnd = Math.max(maxAudioEnd, startSec + dur);
    }
  } else if (hasVoiceover) {
    // Fallback: single full track from 0
    const audioLocal = copyMaterial(voiceoverPath, workDir, '03_voiceover.mp3');
    const audioDur = probeDurationSec(audioLocal);
    audioClips.push({
      type: 'audio',
      src: audioLocal,
      start: 0,
      duration: Math.max(audioDur, 0.1),
      volume: 1,
    });
    maxAudioEnd = Math.max(audioDur, 0.1);
  }

  const totalDur = Math.max(videoDur, maxAudioEnd, 1);
  const muteOriginal = input.muteOriginal === true;
  const origVol = muteOriginal
    ? 0
    : Math.max(0, Math.min(1, Number(input.originalVolume ?? 1)));

  const srtText = String(input.srtText || '').trim();
  const captionClips: ClipSpec[] = [];
  if (srtText) {
    const parsed = parseSrt(srtText);
    for (const c of parsed) {
      const startSec = Math.max(0, c.startMs / 1000);
      const endSec = Math.max(startSec + 0.05, c.endMs / 1000);
      captionClips.push({
        type: 'caption',
        text: c.text.replace(/\n+/g, ' ').trim() || '…',
        start: startSec,
        end: endSec,
        fontSize: 8,
        position: 'bottom',
      });
    }
  } else {
    // Captions from cue text if no SRT
    for (const c of cues) {
      if (!c.text?.trim()) continue;
      const startSec = Math.max(0, c.startMs / 1000);
      const endSec = Math.max(
        startSec + 0.05,
        (c.endMs != null ? c.endMs : c.startMs + 2000) / 1000,
      );
      captionClips.push({
        type: 'caption',
        text: c.text.replace(/\n+/g, ' ').trim(),
        start: startSec,
        end: endSec,
        fontSize: 8,
        position: 'bottom',
      });
    }
  }

  const tracks: TrackSpec[] = [
    {
      type: 'visual',
      clips: [
        {
          type: 'video',
          src: videoLocal,
          start: 0,
          duration: totalDur,
          volume: origVol,
        },
      ],
    },
    {
      type: 'audio',
      clips: audioClips,
    },
  ];

  if (captionClips.length > 0) {
    tracks.push({ type: 'text', clips: captionClips });
  }

  const draftSpec: DraftSpec = {
    version: '1.0',
    canvas: { width: 1920, height: 1080, fps: 30 },
    duration: totalDur,
    tracks,
  };

  const draftsDir = resolveCapCutDraftsDir(input.draftsDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name =
    String(input.draftName || 'AINovel_TTS_Batch')
      .replace(/[^\w\- ()\u00C0-\u024F]+/g, '_')
      .slice(0, 60) || 'AINovel_TTS_Batch';

  const result = await createAndRenderDraft({
    draft: draftSpec,
    output: {
      draftsDir,
      name: `${name}_${stamp}`,
    },
    render: false,
  });

  const d = result.draft;
  try {
    const manifest = {
      draftId: d.draftId,
      filePath: d.filePath,
      actualPath: d.actualPath,
      draftsDir,
      videoPath: videoLocal,
      cueCount: cues.length,
      audioClipCount: audioClips.length,
      captionCount: captionClips.length,
      muteOriginal,
      originalVolume: origVol,
      method: cues.length
        ? 'per_cue_timeline'
        : 'full_voiceover_fallback',
      createdAt: new Date().toISOString(),
      note:
        'CapAssist-style: TTS cues on CapCut timeline. Mở CapCut PC → Export. Không hard-render trong AI Novel.',
    };
    fs.writeFileSync(
      path.join(workDir, '05_capcut_draft.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    draftId: d.draftId,
    filePath: d.filePath || d.actualPath || draftsDir,
    draftsDir,
    displayName: d.displayName || d.draftFolderName,
    captionCount: captionClips.length,
    audioClipCount: audioClips.length,
    method: 'capcut_draft_inject',
  };
}
