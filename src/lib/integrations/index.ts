/**
 * Unified integrations hub for D:\repo packages:
 *  - seedance-2.0-main
 *  - FableCut-main
 *  - claude-video-main (/watch)
 *  - MiroFish-main
 */
import { API } from '@/contracts';
import {
  getIntegrationPaths,
  probeIntegration,
  ensureWorkDirs,
  type IntegrationId,
} from './paths';
import {
  seedanceRepoReady,
  compileSeedancePrompt,
  compileSeedanceBatch,
  persistSeedanceCompile,
  compileDirectedClip,
} from './seedance';
import {
  ensureSeedanceProject,
  loadSeedanceProject,
  saveSeedanceProject,
  listSeedanceProjects,
} from './seedancePersist';
import {
  reviewTake,
  buildContinuationPrompt,
  markClipGenerated,
} from './seedanceTakeReview';
import {
  applySequenceToVideoPrompts,
  resolveVideoPromptWithSequence,
  autoEnsureChapterProject,
} from './seedanceAuto';
import {
  fableCutStatus,
  buildFableCutProject,
  buildFromChapterAssets,
  startFableCutServer,
  stopFableCutServer,
  isFableCutServerUp,
} from './fablecut';
import { watchRepoReady, runWatch, runWatchSetupCheck, buildWatchQcBrief } from './watchVideo';
import { mirofishRepoReady, mirofishStatus, runNativeWhatIf, probeMirofishBackend } from './mirofish';
import { runChapterPipeline } from './chapterPipeline';
import {
  resolveMediaToDisk,
  collectChapterImageDiskPaths,
  collectChapterAudioDiskPaths,
} from './mediaPaths';

export * from './paths';
export * from './seedance';
export * from './seedancePersist';
export * from './seedanceTakeReview';
export * from './seedanceAuto';
export * from './fablecut';
export * from './watchVideo';
export * from './mirofish';
export * from './mediaPaths';
export * from './chapterPipeline';

export interface IntegrationsStatus {
  ok: boolean;
  repoRoot: string;
  workRoot: string;
  integrations: Record<
    IntegrationId,
    {
      ready: boolean;
      path: string;
      detail?: Record<string, unknown>;
    }
  >;
  pipeline: string[];
}

export async function getIntegrationsStatus(): Promise<IntegrationsStatus> {
  const paths = getIntegrationPaths();
  ensureWorkDirs(paths);

  const seedance = probeIntegration('seedance', paths);
  const fablecut = probeIntegration('fablecut', paths);
  const watch = probeIntegration('watch', paths);
  const mirofish = probeIntegration('mirofish', paths);

  const fable = fableCutStatus();
  const fableUp = fable.ready ? await isFableCutServerUp(fable.port) : false;
  const miro = mirofishStatus();
  const miroProbe = await probeMirofishBackend();

  return {
    ok: seedance.ready || fablecut.ready || watch.ready || mirofish.ready,
    repoRoot: paths.repoRoot,
    workRoot: paths.workRoot,
    integrations: {
      seedance: {
        ready: seedance.ready && seedanceRepoReady(),
        path: seedance.path,
        detail: {
          bridge: 'seedance-bridge-v2',
          api: API.integrations.seedance,
          features: [
            'directing-engine',
            'anti-slop',
            'multishot-grammar',
            'clip-contract',
            'project-state-lite',
            'prompt-spec',
          ],
        },
      },
      fablecut: {
        ready: fablecut.ready,
        path: fablecut.path,
        detail: { ...fable, serverUp: fableUp },
      },
      watch: {
        ready: watch.ready && watchRepoReady(),
        path: watch.path,
        detail: { api: API.integrations.watch },
      },
      mirofish: {
        // Repo optional; native swarm always available when Gemini key is supplied
        ready: mirofish.ready,
        path: miro.path,
        detail: {
          ...miro,
          backend: miroProbe,
          nativeSwarm: true,
        },
      },
    },
    pipeline: [
      '1. Write chapter (AI Novel engine)',
      '2. Seedance compile → directed video prompts',
      '3. Gen images / I2V (existing generators)',
      '4. TTS audio (existing)',
      '5. FableCut timeline export + optional editor :7777',
      '6. Watch QC on reference or rendered clip',
      '7. MiroFish what-if → plot hooks back into outline',
    ],
  };
}

export const integrationsApi = {
  status: getIntegrationsStatus,
  seedance: {
    compile: compileSeedancePrompt,
    batch: compileSeedanceBatch,
    persist: persistSeedanceCompile,
    directedClip: compileDirectedClip,
    ensureProject: ensureSeedanceProject,
    loadProject: loadSeedanceProject,
    saveProject: saveSeedanceProject,
    listProjects: listSeedanceProjects,
    reviewTake,
    continue: buildContinuationPrompt,
    markGenerated: markClipGenerated,
    applySequenceToVideoPrompts,
    resolveVideoPromptWithSequence,
    autoEnsureChapterProject,
  },
  fablecut: {
    build: buildFableCutProject,
    fromChapter: buildFromChapterAssets,
    start: startFableCutServer,
    stop: stopFableCutServer,
    isUp: isFableCutServerUp,
    status: fableCutStatus,
  },
  watch: { run: runWatch, setup: runWatchSetupCheck, qcBrief: buildWatchQcBrief },
  mirofish: { whatIf: runNativeWhatIf, probe: probeMirofishBackend, status: mirofishStatus },
  chapter: {
    pipeline: runChapterPipeline,
    resolveImage: resolveMediaToDisk,
    collectImages: collectChapterImageDiskPaths,
    collectAudio: collectChapterAudioDiskPaths,
  },
};
