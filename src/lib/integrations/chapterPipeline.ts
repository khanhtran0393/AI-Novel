/**
 * End-to-end chapter pipeline: Seedance enhance prompts → FableCut timeline from real assets.
 */
import fs from 'fs';
import path from 'path';
import { chapterAssetPrefix, imageAssetKey } from '@/contracts';
import { persistSeedanceCompile, type SeedanceCompileResult } from './seedance';
import { resolveCompileSeedancePrompt } from '@/lib/commercial/ip/seedanceCloudBridge';
import {
  buildFromChapterAssets,
  buildFableCutProject,
  startFableCutServer,
  type FableProjectBuildResult,
} from './fablecut';
import {
  collectChapterAudioDiskPaths,
  collectChapterImageDiskPaths,
  collectChapterVideoDiskPaths,
} from './mediaPaths';
import { ensureWorkDirs, getIntegrationPaths } from './paths';

export interface ChapterPipelineInput {
  chapterNum: number;
  title?: string;
  ten_tac_pham?: string;
  sceneTexts?: string[];
  characterNames?: string[];
  genre?: string;
  styleHint?: string;
  generatedImages?: Record<string, string>;
  generatedAudioPaths?: Record<string, { path: string; duration: number }>;
  generatedVideos?: Record<string, string>;
  generatedPrompts?: Record<string, Array<{ prompt?: string; image_prompt?: string; video_prompt?: string; sentence?: string }>>;
  /** Enhance all prompts with Seedance */
  runSeedance?: boolean;
  /** Packaged cloud IP token for Seedance compile */
  entitlementToken?: string | null;
  /** Build FableCut project from chapter images */
  runFableCut?: boolean;
  liveEditor?: boolean;
  autoStartFableCut?: boolean;
  aspect?: '16:9' | '9:16' | '1:1' | '4:5';
  secondsPerImage?: number;
}

export interface ChapterPipelineResult {
  success: boolean;
  chapterNum: number;
  imagesResolved: number;
  audioResolved: number;
  videosResolved: number;
  seedance?: {
    count: number;
    savedPath?: string;
    samples: Array<SeedanceCompileResult & { id: string }>;
  };
  fablecut?: FableProjectBuildResult & { server?: ReturnType<typeof startFableCutServer> };
  enhancedPrompts?: Record<string, Array<{ video_prompt: string; intention?: string }>>;
  assetIndexPath?: string;
  error?: string;
  logs: string[];
}

export async function runChapterPipeline(
  input: ChapterPipelineInput,
): Promise<ChapterPipelineResult> {
  const logs: string[] = [];
  const chapterNum = input.chapterNum;
  const cwd = process.cwd();
  const paths = getIntegrationPaths(cwd);
  ensureWorkDirs(paths);

  try {
    const images = collectChapterImageDiskPaths(chapterNum, input.generatedImages, cwd);
    const audios = collectChapterAudioDiskPaths(chapterNum, input.generatedAudioPaths, cwd);
    const videos = collectChapterVideoDiskPaths(chapterNum, input.generatedVideos, cwd);
    logs.push(`images_disk=${images.length} audio_disk=${audios.length} video_disk=${videos.length}`);

    const result: ChapterPipelineResult = {
      success: true,
      chapterNum,
      imagesResolved: images.length,
      audioResolved: audios.length,
      videosResolved: videos.length,
      logs,
    };

    // Asset index for debugging
    const assetIndex = {
      chapterNum,
      title: input.title,
      images,
      audios,
      videos,
      at: new Date().toISOString(),
    };
    const assetIndexPath = path.join(
      paths.workRoot,
      `chapter_${chapterNum}_assets_${Date.now()}.json`,
    );
    fs.writeFileSync(assetIndexPath, JSON.stringify(assetIndex, null, 2), 'utf8');
    result.assetIndexPath = assetIndexPath;

    // --- Seedance ---
    if (input.runSeedance !== false) {
      const samples: Array<SeedanceCompileResult & { id: string }> = [];
      const enhancedPrompts: Record<string, Array<{ video_prompt: string; intention?: string }>> = {};

      const sceneTexts = input.sceneTexts || [];
      if (sceneTexts.length > 0) {
        for (let i = 0; i < sceneTexts.length; i++) {
          const text = sceneTexts[i];
          const compiled = await resolveCompileSeedancePrompt(
            {
              sceneText: text,
              characterHints: input.characterNames,
              genre: input.genre,
              styleHint: input.styleHint,
              hasStartImage: images.length > 0,
              durationSec: (() => {
                const d = Number(input.secondsPerImage);
                if (!Number.isFinite(d) || d <= 0) {
                  throw new Error(
                    'Thieu secondsPerImage hop le cho Seedance chapter pipeline. App khong tu gan 5s.',
                  );
                }
                return d;
              })(),
            },
            { entitlementToken: input.entitlementToken },
          );
          samples.push({ id: `scene_${i}`, ...compiled });
        }
      }

      // Also enhance existing generated prompts' video_prompt fields
      if (input.generatedPrompts) {
        const chPrefix = chapterAssetPrefix(chapterNum);
        for (const [assetKey, list] of Object.entries(input.generatedPrompts)) {
          if (!assetKey.startsWith(chPrefix)) continue;
          const nextList: Array<{ video_prompt: string; intention?: string }> = [];
          for (let pi = 0; pi < (list || []).length; pi++) {
            const p = list[pi];
            const base =
              p.video_prompt ||
              p.image_prompt ||
              p.prompt ||
              p.sentence ||
              '';
            if (!base.trim()) {
              nextList.push({ video_prompt: '', intention: undefined });
              continue;
            }
            const sec = Number(input.secondsPerImage);
            if (!Number.isFinite(sec) || sec <= 0) {
              throw new Error(
                'Thieu secondsPerImage hop le cho Seedance enhance prompts. App khong tu gan 5s.',
              );
            }
            const compiled = await resolveCompileSeedancePrompt(
              {
                sceneText: base,
                characterHints: input.characterNames,
                genre: input.genre,
                styleHint: input.styleHint,
                hasStartImage: true,
                durationSec: sec,
              },
              { entitlementToken: input.entitlementToken },
            );
            const [chStr, scStr] = assetKey.split('_');
            const sampleId =
              Number.isFinite(Number(chStr)) && Number.isFinite(Number(scStr))
                ? imageAssetKey(Number(chStr), Number(scStr), pi)
                : `${assetKey}_${pi}`;
            samples.push({ id: sampleId, ...compiled });
            nextList.push({
              video_prompt: compiled.prompt,
              intention: compiled.intention,
            });
          }
          enhancedPrompts[assetKey] = nextList;
        }
      }

      if (samples.length === 0 && images.length === 0) {
        logs.push('seedance: no scenes or prompts to compile');
      } else {
        const savedPath = persistSeedanceCompile(samples, `chapter_${chapterNum}`);
        result.seedance = {
          count: samples.length,
          savedPath,
          samples: samples.slice(0, 5),
        };
        result.enhancedPrompts = enhancedPrompts;
        logs.push(`seedance:compiled=${samples.length}`);
      }
    }

    // --- FableCut ---
    if (input.runFableCut !== false) {
      if (images.length === 0 && videos.length === 0) {
        logs.push('fablecut: skipped — no resolved image/video files on disk');
        result.fablecut = {
          success: false,
          projectPath: '',
          mediaDir: '',
          project: {},
          clipCount: 0,
          mediaCount: 0,
          error:
            'Không resolve được file ảnh/video trên đĩa. Cần gen ảnh trước (public/images). Store URL dạng /api/serve-image?file=... sẽ được map sang public/images/.',
        };
      } else {
        // Prefer video clips if available, else image slideshow + audio
        const imagePaths = images.map((i) => i.disk);
        const videoPaths = videos.map((v) => v.disk);
        const useVideos = videoPaths.length > 0;

        let audioPath: string | undefined;
        let audioDurationSec = 0;
        let secondsPerImage =
          Number(input.secondsPerImage) > 0 ? Number(input.secondsPerImage) : 0;

        if (audios.length > 0) {
          const sorted = [...audios].sort((a, b) => b.duration - a.duration);
          audioPath = sorted[0].disk;
          audioDurationSec = Number(sorted[0].duration) || 0;
          if (audioDurationSec <= 0 && audioPath) {
            try {
              const { probeDurationSec } = require('@/lib/audioStudio') as typeof import('@/lib/audioStudio');
              audioDurationSec = probeDurationSec(audioPath);
            } catch {
              /* ignore */
            }
          }
          if (audioDurationSec > 0 && imagePaths.length > 0 && !useVideos) {
            secondsPerImage = Math.max(1.5, audioDurationSec / imagePaths.length);
          }
        }

        // Probe video durations when building video timeline (no hardcode 5s)
        let probeVideoDur: (p: string) => number = () => 0;
        try {
          const { probeDurationSec } = require('@/lib/audioStudio') as typeof import('@/lib/audioStudio');
          probeVideoDur = (p: string) => probeDurationSec(p);
        } catch {
          /* optional */
        }

        if (useVideos) {
          let t = 0;
          const clips: Parameters<typeof buildFableCutProject>[0]['clips'] = videoPaths.map(
            (vp, i) => {
              const d = probeVideoDur(vp);
              const durationSec =
                d > 0
                  ? d
                  : secondsPerImage > 0
                    ? secondsPerImage
                    : 0;
              if (!(durationSec > 0)) {
                throw new Error(
                  `FableCut: khong probe duoc duration video ${vp}. App khong tu gan 5s.`,
                );
              }
              const c = {
                mediaPath: vp,
                kind: 'video' as const,
                track: 0,
                startSec: t,
                durationSec,
                label: `vid_${i + 1}`,
                titleText: i === 0 ? input.title || `Chương ${chapterNum}` : undefined,
              };
              t += durationSec;
              return c;
            },
          );
          if (audioPath) {
            const aDur = audioDurationSec > 0 ? audioDurationSec : t;
            clips.push({
              mediaPath: audioPath,
              kind: 'audio',
              track: 4,
              startSec: 0,
              durationSec: aDur,
              label: 'narration',
            });
          }
          const fc = buildFableCutProject({
            name: `${input.ten_tac_pham || 'AI-Novel'}_c${chapterNum}`,
            clips,
            aspect: input.aspect || '9:16',
            liveEditor: input.liveEditor !== false,
          });
          result.fablecut = fc;
          logs.push(
            fc.success
              ? `fablecut:videos=${videoPaths.length} totalSec=${t.toFixed(1)} audioSec=${audioDurationSec || 0}`
              : `fablecut:fail=${fc.error}`,
          );
        } else {
          if (!(secondsPerImage > 0) && !(audioDurationSec > 0)) {
            throw new Error(
              'FableCut: thieu TTS duration / secondsPerImage. Gen TTS truoc de dong bo timeline.',
            );
          }
          const fc = buildFromChapterAssets({
            name: `${input.ten_tac_pham || 'AI-Novel'}_c${chapterNum}`,
            imagePaths,
            audioPath,
            audioDurationSec: audioDurationSec > 0 ? audioDurationSec : undefined,
            secondsPerImage: secondsPerImage > 0 ? secondsPerImage : undefined,
            aspect: input.aspect || '9:16',
            liveEditor: input.liveEditor !== false,
            title: input.title || `Chương ${chapterNum}`,
          });
          result.fablecut = fc;
          logs.push(
            fc.success
              ? `fablecut:images=${imagePaths.length} clips=${fc.clipCount} audioSec=${audioDurationSec || 0} sec/img=${secondsPerImage.toFixed?.(2) ?? secondsPerImage}`
              : `fablecut:fail=${fc.error}`,
          );
        }

        if (input.autoStartFableCut && result.fablecut?.success) {
          const server = startFableCutServer();
          result.fablecut.server = server;
          logs.push(server.success ? `fablecut:server=${server.url}` : `fablecut:server:fail=${server.error}`);
        }
      }
    }

    result.success =
      (result.seedance?.count ?? 0) > 0 ||
      Boolean(result.fablecut?.success) ||
      images.length > 0;

    if (!result.success && !result.error) {
      result.error =
        'Pipeline không tạo được seedance/fablecut — gen ảnh chương trước hoặc truyền sceneTexts.';
    }

    return result;
  } catch (err) {
    return {
      success: false,
      chapterNum,
      imagesResolved: 0,
      audioResolved: 0,
      videosResolved: 0,
      logs,
      error: (err as Error).message,
    };
  }
}
