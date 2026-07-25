/**
 * Recover a real Flow video whose in-process queue state was lost after a
 * Next.js restart, then complete export and final audio/video mux.
 *
 * Required environment:
 *   AINOVEL_RUN_ROOT        Existing empirical workflow run directory
 *   AINOVEL_FLOW_MEDIA_ID   Google Flow media UUID returned by the live job
 *   AINOVEL_FLOW_ACCOUNT_ID App Flow account id that owns the media
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { localVideoFilename } from '../src/contracts/keys';
import {
  FLOW_BASE,
  FLOW_PUBLIC_API_KEY,
} from '../src/lib/flow-bridge/config';
import { extractVideoMedia } from '../src/lib/flow-bridge/payloadBuilder';

type Json = Record<string, unknown>;

const ROOT = process.cwd();
const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const FFPROBE = path.join(ROOT, 'bin', 'ffprobe.exe');
const FFMPEG = path.join(ROOT, 'bin', 'ffmpeg.exe');
const RUN_ROOT = path.resolve(String(process.env.AINOVEL_RUN_ROOT || '').trim());
const MEDIA_ID = String(process.env.AINOVEL_FLOW_MEDIA_ID || '').trim();
const ACCOUNT_ID = String(process.env.AINOVEL_FLOW_ACCOUNT_ID || '').trim();
const AUDIO_PATH_OVERRIDE = String(process.env.AINOVEL_AUDIO_PATH || '').trim();
const REUSE_RECOVERED_VIDEO =
  String(process.env.AINOVEL_REUSE_RECOVERED_VIDEO || '').trim() === '1';
const EXPECTED_RUN_PARENT = path.resolve(
  ROOT,
  'scratch',
  'empirical-production-workflow',
);

function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

requireCondition(
  RUN_ROOT.startsWith(`${EXPECTED_RUN_PARENT}${path.sep}`),
  `AINOVEL_RUN_ROOT must be inside ${EXPECTED_RUN_PARENT}`,
);
requireCondition(fs.existsSync(RUN_ROOT), `Run directory missing: ${RUN_ROOT}`);
requireCondition(
  /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(MEDIA_ID),
  'AINOVEL_FLOW_MEDIA_ID must be a Flow media UUID.',
);
requireCondition(
  /^acc_[a-z0-9_]+$/i.test(ACCOUNT_ID),
  'AINOVEL_FLOW_ACCOUNT_ID is invalid.',
);
requireCondition(fs.existsSync(FFPROBE), `Missing ffprobe: ${FFPROBE}`);
requireCondition(fs.existsSync(FFMPEG), `Missing ffmpeg: ${FFMPEG}`);

function log(message: string, details?: unknown): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
  if (details !== undefined) console.log(JSON.stringify(details));
}

async function postJson(
  route: string,
  body: Json,
  timeoutMs = 240_000,
): Promise<{ status: number; data: Json; durationMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as Json;
    return {
      status: response.status,
      data,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(
  route: string,
  timeoutMs = 45_000,
): Promise<{ status: number; data: Json; durationMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${route}`, {
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as Json;
    return {
      status: response.status,
      data,
      durationMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

function probe(file: string): Json {
  requireCondition(fs.existsSync(file), `Artifact missing: ${file}`);
  requireCondition(fs.statSync(file).size > 0, `Artifact empty: ${file}`);
  return JSON.parse(
    execFileSync(
      FFPROBE,
      [
        '-v',
        'error',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8', timeout: 120_000 },
    ),
  ) as Json;
}

function streamTypes(details: Json): string[] {
  return Array.isArray(details.streams)
    ? (details.streams as Json[])
        .map((stream) => String(stream.codec_type || ''))
        .filter(Boolean)
    : [];
}

function copyAtomic(source: string, destination: string): void {
  const temp = `${destination}.recover-${process.pid}-${Date.now()}.tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.copyFileSync(source, temp);
    probe(temp);
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    fs.renameSync(temp, destination);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

async function main(): Promise<void> {
  const statePath = path.join(RUN_ROOT, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Json;
  const stages = (state.stages || {}) as Json;
  const setup = (state.setup || {}) as Json;
  const chapterNum = Number(state.chapterNum);
  requireCondition(Number.isFinite(chapterNum), 'Run state has no chapterNum.');

  const ttsStage = (stages['3.TTS'] || {}) as Json;
  const imageStage = (stages['6.IMAGE'] || {}) as Json;
  const audioPath = AUDIO_PATH_OVERRIDE
    ? path.resolve(AUDIO_PATH_OVERRIDE)
    : String((Array.isArray(ttsStage.artifacts) ? ttsStage.artifacts[0] : '') || '');
  const imagePath = String(
    (Array.isArray(imageStage.artifacts) ? imageStage.artifacts[0] : '') || '',
  );
  const audioProbe = probe(audioPath);
  const imageProbe = probe(imagePath);
  requireCondition(
    streamTypes(audioProbe).includes('audio'),
    'Recovered workflow audio has no audio stream.',
  );
  requireCondition(
    streamTypes(imageProbe).includes('video'),
    'Recovered workflow image is not decodable.',
  );
  if (AUDIO_PATH_OVERRIDE) {
    const audioStream = (
      (Array.isArray(audioProbe.streams) ? audioProbe.streams[0] : {}) || {}
    ) as Json;
    const audioFormat = (audioProbe.format || {}) as Json;
    const verifiedDuration = Number(audioFormat.duration || 0);
    const priorArtifacts = Array.isArray(ttsStage.artifacts)
      ? ttsStage.artifacts.slice(1)
      : [];
    stages['3.TTS'] = {
      ...ttsStage,
      ok: true,
      observed: {
        ...((ttsStage.observed || {}) as Json),
        verifiedAfterContainerFix: true,
        path: audioPath,
        bytes: fs.statSync(audioPath).size,
        duration: verifiedDuration,
        routeDuration: verifiedDuration,
        probedDuration: verifiedDuration,
        format: String(audioFormat.format_name || ''),
        codec: String(audioStream.codec_name || ''),
        sampleRate: Number(audioStream.sample_rate || 0),
        channels: Number(audioStream.channels || 0),
        streamTypes: streamTypes(audioProbe),
      },
      artifacts: [audioPath, ...priorArtifacts],
    };
  }

  const health = await getJson('/api/health/runtime');
  requireCondition(health.status === 200, `Runtime health HTTP ${health.status}`);
  requireCondition(Number(health.data.fail || 0) === 0, 'Runtime health failed.');
  log('PASS RECOVERY.RUNTIME', {
    http: health.status,
    ok: health.data.ok,
    warn: health.data.warn,
    fail: health.data.fail,
  });

  const rawVideo = path.join(
    ROOT,
    'public',
    'video',
    `c${chapterNum}_s1_p0.mp4`,
  );
  const animaticPath = path.join(
    ROOT,
    'public',
    'video',
    localVideoFilename(chapterNum, 1),
  );
  fs.mkdirSync(path.dirname(rawVideo), { recursive: true });
  let upstreamHttp = 0;
  let payloadMode = 'local-verified';
  let flowModel = String(setup.videoModel || '');
  if (!REUSE_RECOVERED_VIDEO) {
    const mediaUrl = `${FLOW_BASE}/v1/media/${encodeURIComponent(MEDIA_ID)}?key=${FLOW_PUBLIC_API_KEY}`;
    const recovered = await postJson(
      '/api/flow/proxy',
      {
        action: 'proxy',
        accountId: ACCOUNT_ID,
        url: mediaUrl,
        method: 'GET',
        timeoutMs: 200_000,
      },
      240_000,
    );
    requireCondition(
      recovered.status === 200 && recovered.data.ok === true,
      `Flow media recovery HTTP ${recovered.status}: ${String(recovered.data.error || '')}`,
    );
    const media = extractVideoMedia(recovered.data.data);
    requireCondition(
      media.base64List.length > 0 || media.urls.length > 0,
      'Flow media exists but contains no downloadable video.',
    );
    upstreamHttp = recovered.status;
    payloadMode = media.base64List.length > 0 ? 'encodedVideo' : 'url';
    const upstreamVideo = (
      ((recovered.data.data || {}) as Json).video || {}
    ) as Json;
    flowModel = String(upstreamVideo.model || flowModel);
    if (media.base64List.length > 0) {
      const base64 = media.base64List[0].replace(
        /^data:[^;]+;base64,/,
        '',
      );
      fs.writeFileSync(rawVideo, Buffer.from(base64, 'base64'));
    } else {
      const download = await postJson(
        '/api/flow/proxy',
        {
          action: 'download',
          accountId: ACCOUNT_ID,
          url: media.urls[0],
          destPath: rawVideo,
        },
        300_000,
      );
      requireCondition(
        download.status === 200 && download.data.ok === true,
        `Flow media download HTTP ${download.status}: ${String(download.data.error || '')}`,
      );
    }
  } else {
    requireCondition(
      fs.existsSync(rawVideo) || fs.existsSync(animaticPath),
      'AINOVEL_REUSE_RECOVERED_VIDEO=1 but no recovered MP4 exists.',
    );
  }

  const recoveredVideoSource = fs.existsSync(rawVideo)
    ? rawVideo
    : animaticPath;
  const rawVideoProbe = probe(recoveredVideoSource);
  requireCondition(
    streamTypes(rawVideoProbe).includes('video'),
    'Recovered Flow MP4 has no video stream.',
  );
  const videoDuration = Number(
    ((rawVideoProbe.format || {}) as Json).duration || 0,
  );
  requireCondition(videoDuration > 0, 'Recovered Flow MP4 duration is invalid.');

  if (path.resolve(recoveredVideoSource) !== path.resolve(animaticPath)) {
    copyAtomic(recoveredVideoSource, animaticPath);
  }
  const mediaIndex = await postJson('/api/flow/media-id', {
    key: `${chapterNum}_1_0_video`,
    mediaId: MEDIA_ID,
  });
  requireCondition(
    mediaIndex.status === 200 && mediaIndex.data.ok === true,
    `Flow media index HTTP ${mediaIndex.status}`,
  );
  log('PASS 7.VIDEO_RECOVERED', {
    mediaId: MEDIA_ID,
    upstreamHttp,
    payloadMode,
    bytes: fs.statSync(animaticPath).size,
    duration: videoDuration,
    streamTypes: streamTypes(rawVideoProbe),
    model: flowModel,
    artifact: animaticPath,
  });

  const audioDuration = Number(((audioProbe.format || {}) as Json).duration || 0);
  const exportResult = await postJson(
    '/api/export-xinchao',
    {
      chapterNum,
      ten_tac_pham: `${String(setup.ten_tac_pham || 'AI Novel')} - empirical recovery`,
      generatedAudioPaths: {
        [`${chapterNum}_1`]: {
          path: audioPath,
          duration: audioDuration,
        },
      },
      generatedImages: {
        [`${chapterNum}_1_0`]: imagePath,
      },
      generatedVideos: {
        [`${chapterNum}_1_0_video`]: animaticPath,
      },
      imageAspectRatio: setup.aspect,
      videoAspectRatio: setup.aspect,
      aspect: setup.aspect,
      videoDuration: setup.videoDuration,
      imageProvider: setup.imageProvider,
      videoProvider: setup.videoProvider,
      mediaStylePreset: setup.visualDna,
      visualDna: setup.visualDna,
      ttsConfig: setup.ttsConfig,
      openEditor: false,
    },
    180_000,
  );
  requireCondition(
    exportResult.status === 200 && exportResult.data.success === true,
    `Export HTTP ${exportResult.status}: ${String(exportResult.data.error || '')}`,
  );
  const projectPath = String(exportResult.data.projectPath || '');
  const manifestPath = String(exportResult.data.manifestPath || '');
  requireCondition(
    projectPath && fs.existsSync(projectPath),
    `Export project missing: ${projectPath}`,
  );
  requireCondition(
    manifestPath && fs.existsSync(manifestPath),
    `Export manifest missing: ${manifestPath}`,
  );
  const exportMedia = (exportResult.data.media || {}) as Json;
  requireCondition(Number(exportMedia.images) >= 1, 'Export has no image.');
  requireCondition(Number(exportMedia.videos) >= 1, 'Export has no video.');
  requireCondition(Number(exportMedia.audios) >= 1, 'Export has no audio.');
  log('PASS 8.EXPORT_PACK', {
    http: exportResult.status,
    projectPath,
    manifestPath,
    media: exportMedia,
    criteria: exportResult.data.criteria,
  });

  const finalVideo = path.join(RUN_ROOT, 'final-production-video.mp4');
  execFileSync(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      animaticPath,
      '-i',
      audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-t',
      String(audioDuration),
      '-shortest',
      '-movflags',
      '+faststart',
      finalVideo,
    ],
    { encoding: 'utf8', timeout: 300_000 },
  );
  const finalProbe = probe(finalVideo);
  const finalTypes = streamTypes(finalProbe);
  requireCondition(finalTypes.includes('video'), 'Final MP4 has no video stream.');
  requireCondition(finalTypes.includes('audio'), 'Final MP4 has no audio stream.');
  const finalDuration = Number(((finalProbe.format || {}) as Json).duration || 0);
  requireCondition(finalDuration > 0, 'Final MP4 duration is invalid.');
  requireCondition(
    Math.abs(finalDuration - audioDuration) <= 0.5,
    `Final MP4 duration drifted from narration: video=${finalDuration}s audio=${audioDuration}s.`,
  );
  const probePath = path.join(RUN_ROOT, 'final-ffprobe.json');
  fs.writeFileSync(probePath, JSON.stringify(finalProbe, null, 2), 'utf8');
  log('PASS 9.FINAL_AV', {
    output: finalVideo,
    bytes: fs.statSync(finalVideo).size,
    duration: finalDuration,
    streamTypes: finalTypes,
    sourceVideo: animaticPath,
    sourceAudio: audioPath,
  });

  const now = new Date().toISOString();
  stages['7.VIDEO'] = {
    ok: true,
    observed: {
      recoveredAfterRuntimeRestart: true,
      mediaId: MEDIA_ID,
      upstreamHttp,
      bytes: fs.statSync(animaticPath).size,
      duration: videoDuration,
      streamTypes: streamTypes(rawVideoProbe),
    },
    artifacts: [animaticPath],
  };
  stages['8.EXPORT_PACK'] = {
    ok: true,
    observed: {
      http: exportResult.status,
      projectPath,
      manifestPath,
      media: exportMedia,
      criteria: exportResult.data.criteria,
    },
    artifacts: [projectPath, manifestPath],
  };
  stages['9.FINAL_AV'] = {
    ok: true,
    observed: {
      bytes: fs.statSync(finalVideo).size,
      duration: finalDuration,
      streamTypes: finalTypes,
      sourceVideo: animaticPath,
      sourceAudio: audioPath,
    },
    artifacts: [finalVideo, probePath],
  };
  state.stages = stages;
  state.verdict = 'MEDIA_PASS_LLM_BLOCKED';
  state.finalVideo = finalVideo;
  state.exportProject = projectPath;
  state.finishedAt = now;
  delete state.error;
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  const reportPath = path.join(RUN_ROOT, 'report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        verdict: state.verdict,
        runId: state.runId,
        finalVideo,
        finalProbe,
        exportProject: projectPath,
        recoveredFlowMediaId: MEDIA_ID,
        stages,
      },
      null,
      2,
    ),
    'utf8',
  );
  log('WORKFLOW MEDIA PASS / LLM BLOCKED', {
    finalVideo,
    reportPath,
    exportProject: projectPath,
  });
}

void main().catch((error) => {
  console.error(
    `[${new Date().toISOString()}] RECOVERY FAIL: ${
      error instanceof Error ? error.stack || error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
