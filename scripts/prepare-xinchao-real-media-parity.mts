import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  imageAssetKey,
  sceneAssetKey,
  videoAssetKey,
} from '../src/contracts/keys';
import { buildXinChaoPack } from '../src/lib/integrations/xinchaoCut';

type Probe = {
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    sample_rate?: string;
    channels?: number;
  }>;
  format?: {
    duration?: string;
    size?: string;
    format_name?: string;
  };
};

const root = path.resolve(import.meta.dirname, '..');
const publicImages = path.join(root, 'public', 'images');
const publicAudio = path.join(root, 'public', 'audio');
const publicVideo = path.join(root, 'public', 'video');
const evidenceDir = path.join(root, 'scratch', 'xinchao-parity');
const forbiddenFixturePattern =
  /(?:^|[\\/])(vendor|tools|fixtures?|samples?|exports)(?:[\\/]|$)|(?:smoke|mock|dummy|fixture|sample)/i;

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function probe(file: string): Probe {
  const result = spawnSync(
    'ffprobe.exe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size,format_name',
      '-show_entries',
      'stream=index,codec_type,codec_name,width,height,sample_rate,channels',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr || `ffprobe failed for ${file}`);
  return JSON.parse(result.stdout) as Probe;
}

function eligible(file: string, minimumBytes: number): boolean {
  const relative = path.relative(root, file);
  return (
    !relative.startsWith('..') &&
    !forbiddenFixturePattern.test(relative) &&
    fs.statSync(file).size >= minimumBytes
  );
}

const imageCandidates = fs
  .readdirSync(publicImages, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const match = /^chapter_(\d+)_scene_(\d+)_prompt_(\d+)\.(png|jpe?g|webp)$/i.exec(
      entry.name,
    );
    if (!match) return null;
    const file = path.join(publicImages, entry.name);
    if (!eligible(file, 10_000)) return null;
    return {
      file,
      chapter: Number(match[1]),
      scene: Number(match[2]),
      prompt: Number(match[3]),
      modified: fs.statSync(file).mtimeMs,
    };
  })
  .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  .sort((a, b) => b.modified - a.modified);

let selected:
  | {
      image: string;
      audio: string;
      video: string;
      chapter: number;
      scene: number;
      prompt: number;
    }
  | undefined;

for (const image of imageCandidates) {
  const audio = ['wav', 'mp3', 'm4a']
    .map((extension) =>
      path.join(
        publicAudio,
        `chapter_${image.chapter}_scene_${image.scene}.${extension}`,
      ),
    )
    .find((file) => fs.existsSync(file) && eligible(file, 10_000));
  const video = [
    path.join(
      publicVideo,
      `c${image.chapter}_s${image.scene}_p${image.prompt}.mp4`,
    ),
    path.join(
      publicVideo,
      `chapter_${image.chapter}_scene_${image.scene}_animatic.mp4`,
    ),
  ].find((file) => fs.existsSync(file) && eligible(file, 100_000));
  if (audio && video) {
    selected = {
      image: image.file,
      audio,
      video,
      chapter: image.chapter,
      scene: image.scene,
      prompt: image.prompt,
    };
    break;
  }
}

assert.ok(
  selected,
  'Không tìm thấy bộ ảnh/audio/video sản xuất thật cùng chương+cảnh trong public/.',
);

for (const file of [selected.image, selected.audio, selected.video]) {
  const relative = path.relative(root, file);
  assert.ok(!forbiddenFixturePattern.test(relative), `Fixture bị cấm: ${relative}`);
  assert.ok(fs.existsSync(file), `Media không tồn tại trên đĩa: ${relative}`);
}

const imageProbe = probe(selected.image);
const audioProbe = probe(selected.audio);
const videoProbe = probe(selected.video);
const audioDuration = Number(audioProbe.format?.duration);
const videoDuration = Number(videoProbe.format?.duration);
assert.ok(Number.isFinite(audioDuration) && audioDuration > 0, 'Audio duration invalid');
assert.ok(Number.isFinite(videoDuration) && videoDuration > 0, 'Video duration invalid');

const audioKey = sceneAssetKey(selected.chapter, selected.scene);
const imageKey = imageAssetKey(
  selected.chapter,
  selected.scene,
  selected.prompt,
);
const videoKey = videoAssetKey(
  selected.chapter,
  selected.scene,
  selected.prompt,
);
const pack = buildXinChaoPack({
  cwd: root,
  chapterNum: selected.chapter,
  ten_tac_pham: 'XinChao parity media thật',
  aspect: '16:9',
  videoDuration,
  imageProvider: 'flow',
  videoProvider: 'flow',
  generatedAudioPaths: {
    [audioKey]: { path: selected.audio, duration: audioDuration },
  },
  generatedImages: { [imageKey]: selected.image },
  generatedVideos: { [videoKey]: selected.video },
});
assert.equal(pack.success, true, pack.error);
assert.equal(pack.media.images, 1);
assert.equal(pack.media.audios, 1);
assert.equal(pack.media.videos, 1);

const manifest = JSON.parse(fs.readFileSync(pack.manifestPath, 'utf8')) as {
  files: Array<{ key: string; kind: 'image' | 'audio' | 'video'; path: string }>;
  imageProvider: string;
  videoProvider: string;
};
assert.equal(manifest.imageProvider, 'flow');
assert.equal(manifest.videoProvider, 'flow');

const sourceByKind = {
  image: selected.image,
  audio: selected.audio,
  video: selected.video,
};
const copied = manifest.files.map((entry) => {
  const source = sourceByKind[entry.kind];
  const destination = path.join(pack.packRoot, entry.path);
  const sourceHash = sha256(source);
  const destinationHash = sha256(destination);
  assert.equal(
    destinationHash,
    sourceHash,
    `Pack đã thay đổi bytes của ${entry.kind}`,
  );
  return {
    kind: entry.kind,
    key: entry.key,
    source: path.relative(root, source).replace(/\\/g, '/'),
    destination: path.relative(root, destination).replace(/\\/g, '/'),
    bytes: fs.statSync(source).size,
    sha256: sourceHash,
  };
});

const evidence = {
  ok: true,
  fixturePolicy: 'public project media only; vendor/smoke/mock/sample rejected',
  chapter: selected.chapter,
  scene: selected.scene,
  prompt: selected.prompt,
  packRoot: pack.packRoot,
  manifestPath: pack.manifestPath,
  sourceMedia: {
    image: {
      path: path.relative(root, selected.image).replace(/\\/g, '/'),
      probe: imageProbe,
    },
    audio: {
      path: path.relative(root, selected.audio).replace(/\\/g, '/'),
      probe: audioProbe,
    },
    video: {
      path: path.relative(root, selected.video).replace(/\\/g, '/'),
      probe: videoProbe,
    },
  },
  copied,
};

fs.mkdirSync(evidenceDir, { recursive: true });
const evidencePath = path.join(evidenceDir, 'real-media-pack.json');
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
console.log(JSON.stringify({ ...evidence, evidencePath }));
console.log('MEDIA_OK xinchao-real-project-media');
