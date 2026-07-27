import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildXinChaoPack } from '../src/lib/integrations/xinchaoCut';

type TimelineClip = {
  key: string;
  slotId?: string;
  kind: 'audio' | 'image' | 'video';
  path: string;
  startSec: number;
  durationSec: number;
};

type PackManifest = {
  name?: string;
  ten_tac_pham?: string;
  chapterNum?: number;
  aspect?: string;
  imageProvider?: string;
  videoProvider?: string;
  files?: Array<{
    key: string;
    kind: 'audio' | 'image' | 'video';
    path: string;
    durationSec?: number | null;
  }>;
  suggestedTimeline?: TimelineClip[];
  timelineReservation?: {
    scenes?: Array<{ sceneIndex: number; startSec: number; endSec: number }>;
    slots?: Array<{
      slotId?: string;
      sceneIndex: number;
      promptIndex: number;
      startSec: number;
      endSec: number;
    }>;
  };
};

function argValue(name: string): string {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || '' : '';
}

function latestManifest(): string {
  const root = path.join(process.cwd(), 'exports', 'integrations', 'capcut');
  assert.ok(fs.existsSync(root), `Không tìm thấy thư mục pack CapCut: ${root}`);
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'ainovel-xinchao-pack.json'))
    .filter((candidate) => fs.existsSync(candidate))
    .sort(
      (left, right) =>
        fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs,
    );
  assert.ok(candidates[0], 'Không tìm thấy ainovel-xinchao-pack.json để kiểm tra');
  return candidates[0];
}

function probeAudio(filePath: string): {
  durationSec: number;
  maxVolumeDb: number;
} {
  const ffprobe = path.join(process.cwd(), 'bin', 'ffprobe.exe');
  const ffmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
  assert.ok(fs.existsSync(ffprobe), `Thiếu FFprobe: ${ffprobe}`);
  assert.ok(fs.existsSync(ffmpeg), `Thiếu FFmpeg: ${ffmpeg}`);

  const probe = spawnSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(probe.status, 0, probe.stderr || `FFprobe lỗi: ${filePath}`);
  const durationSec = Number(String(probe.stdout).trim());
  assert.ok(
    Number.isFinite(durationSec) && durationSec > 0,
    `Duration audio không hợp lệ: ${filePath}`,
  );

  const volume = spawnSync(
    ffmpeg,
    ['-hide_banner', '-nostats', '-i', filePath, '-af', 'volumedetect', '-f', 'null', 'NUL'],
    { encoding: 'utf8' },
  );
  assert.equal(volume.status, 0, volume.stderr || `FFmpeg lỗi: ${filePath}`);
  const volumeLog = `${volume.stdout}\n${volume.stderr}`;
  const maxMatch = volumeLog.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);
  assert.ok(maxMatch, `Không đọc được max_volume: ${filePath}`);
  const maxVolumeDb = Number(maxMatch[1]);
  assert.ok(
    maxVolumeDb > -45,
    `Audio gần như im lặng: ${path.basename(filePath)} max=${maxVolumeDb} dB`,
  );
  return { durationSec, maxVolumeDb };
}

let manifestPath = path.resolve(argValue('--manifest') || latestManifest());
assert.ok(fs.existsSync(manifestPath), `Manifest không tồn tại: ${manifestPath}`);
let packRoot = path.dirname(manifestPath);
let manifest = JSON.parse(
  fs.readFileSync(manifestPath, 'utf8'),
) as PackManifest;

if (process.argv.includes('--rebuild')) {
  const videoDuration = Number(argValue('--video-duration'));
  assert.ok(
    Number.isFinite(videoDuration) && videoDuration > 0,
    '--rebuild yêu cầu --video-duration hợp lệ',
  );
  assert.ok(manifest.chapterNum, 'Manifest nguồn thiếu chapterNum');
  assert.ok(manifest.aspect, 'Manifest nguồn thiếu aspect');
  assert.ok(manifest.imageProvider, 'Manifest nguồn thiếu imageProvider');
  assert.ok(manifest.videoProvider, 'Manifest nguồn thiếu videoProvider');
  assert.ok(manifest.files?.length, 'Manifest nguồn thiếu files');

  const generatedImages: Record<string, string> = {};
  const generatedVideos: Record<string, string> = {};
  const generatedPrompts: Record<
    string,
    Array<{ timestamp: string; image_prompt: string }>
  > = {};
  const generatedAudioPaths: Record<
    string,
    { path: string; duration: number }
  > = {};
  for (const item of manifest.files || []) {
    const disk = path.resolve(packRoot, item.path);
    if (item.kind === 'image') generatedImages[item.key] = disk;
    if (item.kind === 'video') generatedVideos[item.key] = disk;
    if (item.kind === 'audio') {
      generatedAudioPaths[item.key] = {
        path: disk,
        duration: Number(item.durationSec) || 0,
      };
    }
  }
  const sceneByIndex = new Map(
    (manifest.timelineReservation?.scenes || []).map((scene) => [
      scene.sceneIndex,
      scene,
    ]),
  );
  for (const slot of manifest.timelineReservation?.slots || []) {
    const scene = sceneByIndex.get(slot.sceneIndex);
    assert.ok(scene, `Reservation thiếu scene ${slot.sceneIndex}`);
    const key = `${manifest.chapterNum}_${slot.sceneIndex}`;
    const list = generatedPrompts[key] || [];
    list[slot.promptIndex] = {
      timestamp: `${slot.startSec - scene.startSec}-${slot.endSec - scene.startSec}s`,
      image_prompt: `reserved ${slot.sceneIndex}/${slot.promptIndex}`,
    };
    generatedPrompts[key] = list;
  }
  const rebuilt = buildXinChaoPack({
    chapterNum: Number(manifest.chapterNum),
    ten_tac_pham: `${manifest.ten_tac_pham || manifest.name || 'AI Novel'} timeline fixed`,
    generatedAudioPaths,
    generatedPrompts,
    generatedImages,
    generatedVideos,
    aspect: manifest.aspect!,
    videoDuration,
    imageProvider: manifest.imageProvider!,
    videoProvider: manifest.videoProvider!,
  });
  assert.equal(rebuilt.success, true, rebuilt.error);
  manifestPath = rebuilt.manifestPath;
  packRoot = rebuilt.packRoot;
  manifest = JSON.parse(
    fs.readFileSync(manifestPath, 'utf8'),
  ) as PackManifest;
}

const timeline = manifest.suggestedTimeline || [];
assert.ok(timeline.length > 0, 'Pack không có suggestedTimeline');

for (const clip of timeline) {
  assert.ok(
    Number.isFinite(clip.startSec) && clip.startSec >= 0,
    `startSec không hợp lệ: ${clip.key}`,
  );
  assert.ok(
    Number.isFinite(clip.durationSec) && clip.durationSec > 0,
    `durationSec không hợp lệ: ${clip.key}`,
  );
  const disk = path.resolve(packRoot, clip.path);
  assert.ok(
    disk.startsWith(`${packRoot}${path.sep}`) && fs.existsSync(disk),
    `Media timeline không tồn tại trong pack: ${clip.key} -> ${disk}`,
  );
}

const audio = timeline
  .filter((clip) => clip.kind === 'audio')
  .sort((left, right) => left.startSec - right.startSec);
assert.ok(audio.length > 0, 'Pack không có TTS trên timeline');
const fullAudio = audio.filter((clip) => /(?:^|_)full(?:_|$)/i.test(clip.key));
const segmentAudio = audio.filter(
  (clip) => !/(?:^|_)full(?:_|$)/i.test(clip.key),
);
assert.ok(
  fullAudio.length === 0 || segmentAudio.length === 0,
  `Timeline đang cộng trùng audio full và ${segmentAudio.length} audio từng cảnh`,
);

const audioEvidence = audio.map((clip) => {
  const disk = path.resolve(packRoot, clip.path);
  const probed = probeAudio(disk);
  assert.ok(
    clip.durationSec <= probed.durationSec + 0.25,
    `Clip audio dài hơn file thật: ${clip.key} clip=${clip.durationSec}s file=${probed.durationSec}s`,
  );
  return {
    key: clip.key,
    startSec: clip.startSec,
    timelineSec: clip.durationSec,
    fileSec: probed.durationSec,
    maxVolumeDb: probed.maxVolumeDb,
  };
});

for (let index = 1; index < audio.length; index += 1) {
  const previous = audio[index - 1];
  const current = audio[index];
  const previousEnd = previous.startSec + previous.durationSec;
  assert.ok(
    Math.abs(current.startSec - previousEnd) <= 0.1,
    `TTS không liền mạch: ${previous.key} kết thúc ${previousEnd}s, ${current.key} bắt đầu ${current.startSec}s`,
  );
}

const visuals = timeline.filter(
  (clip) => clip.kind === 'image' || clip.kind === 'video',
);

const reservationBySlot = new Map(
  (manifest.timelineReservation?.slots || []).map((slot) => [
    slot.slotId ||
      `${manifest.chapterNum}_${slot.sceneIndex}_${slot.promptIndex}`,
    slot,
  ]),
);
assert.ok(
  reservationBySlot.size > 0,
  'Pack thiếu timelineReservation để khóa vị trí media sinh sau',
);
for (const clip of visuals) {
  const slotId = clip.slotId || clip.key.replace(/_video$/, '');
  const slot = reservationBySlot.get(slotId);
  assert.ok(slot, `Visual không có slot đặt trước: ${clip.key}`);
  assert.ok(
    Math.abs(clip.startSec - slot.startSec) <= 0.001 &&
      Math.abs(clip.startSec + clip.durationSec - slot.endSec) <= 0.001,
    `Visual ${clip.key} lệch slot ${slotId}: clip=${clip.startSec}-${clip.startSec + clip.durationSec}s slot=${slot.startSec}-${slot.endSec}s`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    manifestPath,
    name: manifest.name,
    timelineClips: timeline.length,
    audioClips: audio.length,
    visualClips: visuals.length,
    durationSec: Math.max(
      ...timeline.map((clip) => clip.startSec + clip.durationSec),
    ),
    audioEvidence,
  }),
);
console.log('MEDIA_OK capcut-pack-timeline');
