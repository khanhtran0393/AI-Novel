/**
 * Smoke: AI Novel -> CapCut GUI -> vendored XinChao-Cut runtime.
 * Uses real project media already present on disk.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildXinChaoPack,
  isXinChaoPresent,
  resolveXinChaoRoot,
} from '../src/lib/integrations/xinchaoCut';

const root = process.cwd();
const editorRoot = resolveXinChaoRoot(root);

assert.equal(
  path.resolve(editorRoot),
  path.join(root, 'tools', 'xinchao-cut'),
  'Runtime must resolve to the vendored editor',
);
assert.equal(isXinChaoPresent(root), true, 'Vendored XinChao-Cut source is incomplete');
assert.ok(fs.existsSync(path.join(editorRoot, 'src-tauri', 'src', 'lib.rs')));
assert.ok(fs.existsSync(path.join(editorRoot, 'backend', 'app', 'main.py')));

const missingAspect = buildXinChaoPack({
  chapterNum: 1,
  aspect: '',
  videoDuration: 6,
  imageProvider: 'flow',
  videoProvider: 'flow',
  cwd: root,
});
assert.equal(missingAspect.success, false, 'Missing aspect must hard-fail');

const missingDuration = buildXinChaoPack({
  chapterNum: 1,
  aspect: '16:9',
  videoDuration: Number.NaN,
  imageProvider: 'flow',
  videoProvider: 'flow',
  cwd: root,
});
assert.equal(missingDuration.success, false, 'Missing videoDuration must hard-fail');

const missingProvider = buildXinChaoPack({
  chapterNum: 1,
  aspect: '16:9',
  videoDuration: 6,
  imageProvider: '',
  videoProvider: '',
  cwd: root,
});
assert.equal(missingProvider.success, false, 'Missing providers must hard-fail');

const unresolvedMedia = buildXinChaoPack({
  chapterNum: 1,
  aspect: '16:9',
  videoDuration: 6,
  imageProvider: 'flow',
  videoProvider: 'flow',
  generatedImages: { '1_1_0': path.join(root, 'missing-xinchao-media.png') },
  cwd: root,
});
assert.equal(unresolvedMedia.success, false, 'Unresolved disk media must hard-fail');
assert.match(unresolvedMedia.error || '', /resolve|đĩa/i);

const realImage = path.join(root, 'vendor', 'FableCut', 'media', 'shot_001.png');
const realAudio = path.join(root, 'vendor', 'FableCut', 'media', 'narration.mp3');
assert.ok(fs.statSync(realImage).size > 100_000, 'Real project image is unavailable');
assert.ok(fs.statSync(realAudio).size > 100_000, 'Real project narration is unavailable');

const pack = buildXinChaoPack({
  chapterNum: 1,
  ten_tac_pham: 'AI Novel runtime smoke',
  aspect: '16:9',
  videoDuration: 6,
  imageProvider: 'flow',
  videoProvider: 'flow',
  generatedImages: { '1_1_0': realImage },
  generatedAudioPaths: { '1_1': { path: realAudio, duration: 20 } },
  generatedPrompts: {
    '1_1': [{ timestamp: '0-75.048s', image_prompt: 'real smoke still' }],
  },
  cwd: root,
});
assert.equal(pack.success, true, pack.error);
assert.ok(fs.existsSync(pack.manifestPath), 'Pack manifest was not written');
assert.equal(fs.readdirSync(pack.mediaDir).length, 2, 'Pack did not copy both real media files');

const manifest = JSON.parse(fs.readFileSync(pack.manifestPath, 'utf8'));
assert.equal(manifest.aspect, '16:9');
assert.equal(manifest.imageProvider, 'flow');
assert.equal(manifest.videoProvider, 'flow');
assert.equal(manifest.files.length, 2);
for (const item of manifest.files) {
  assert.ok(
    fs.statSync(path.join(pack.packRoot, item.path)).size > 100_000,
    `Pack media is not a real disk artifact: ${item.path}`,
  );
}

const duplicateNarrationPack = buildXinChaoPack({
  chapterNum: 1,
  ten_tac_pham: 'AI Novel duplicate narration regression',
  aspect: '16:9',
  videoDuration: 6,
  imageProvider: 'flow',
  videoProvider: 'flow',
  generatedImages: { '1_1_0': realImage },
  generatedPrompts: {
    '1_1': [{ timestamp: '0-75.048s', image_prompt: 'real smoke still' }],
  },
  generatedAudioPaths: {
    '1_1': { path: realAudio, duration: 20 },
    '1_full': { path: realAudio, duration: 20 },
  },
  cwd: root,
});
assert.equal(duplicateNarrationPack.success, true, duplicateNarrationPack.error);
const duplicateManifest = JSON.parse(
  fs.readFileSync(duplicateNarrationPack.manifestPath, 'utf8'),
);
const duplicateAudio = duplicateManifest.suggestedTimeline.filter(
  (item: { kind?: string }) => item.kind === 'audio',
);
assert.deepEqual(
  duplicateAudio.map((item: { key: string }) => item.key),
  ['1_1'],
  'Audio full và audio từng cảnh không được cùng xuất hiện trên timeline',
);

const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
assert.match(mainJs, /launchXinChaoNative/);
assert.match(mainJs, /startXinChaoRuntimeHost/);
assert.match(mainJs, /waitForXinChaoNativeReady/);
assert.doesNotMatch(
  mainJs,
  /payload\?\.xinchaoRoot/,
  'Renderer must not override the internal runtime root',
);
assert.doesNotMatch(mainJs, /D:\\repo\\XinChao-Cut-main/i);
assert.doesNotMatch(mainJs, /AINOVEL_XINCHAO_DIR/);
assert.match(mainJs, /if \(requestedMode !== 'web'\)/);
const runtimeHost = fs.readFileSync(
  path.join(root, 'electron', 'xinchaoRuntimeHost.cjs'),
  'utf8',
);
assert.doesNotMatch(runtimeHost, /options\.(?:envDir|devFallback)/);

const button = fs.readFileSync(
  path.join(root, 'src', 'app', 'workspace', 'features', 'project', 'CapCutExportButton.tsx'),
  'utf8',
);
assert.match(button, /useCapCutExport/);
assert.doesNotMatch(button, /fetch\(/);
assert.doesNotMatch(button, /openBundledCapCutEditor/);
assert.doesNotMatch(button, /xinchaoRoot/);
const capCutHook = fs.readFileSync(
  path.join(root, 'src', 'app', 'workspace', 'hooks', 'useCapCutExport.ts'),
  'utf8',
);
assert.match(capCutHook, /exportCapCutPack/);
assert.match(capCutHook, /openBundledCapCutEditor/);
const capCutModule = fs.readFileSync(
  path.join(root, 'src', 'app', 'workspace', 'modules', 'capCutModule.ts'),
  'utf8',
);
assert.match(capCutModule, /if \(!opened\?\.editorOpened\)/);
assert.match(capCutModule, /Bridge CapCut/);
assert.match(capCutModule, /fetch\(API\.exportCapcut/);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const scriptName of [
  'build:desktop',
  'pack:commercial',
  'pack:unsigned:portable',
  'pack:unsigned:qa',
]) {
  assert.match(
    packageJson.scripts[scriptName],
    /xinchao:build:verified/,
    `${scriptName} must verify and build the native editor`,
  );
}

console.log(
  JSON.stringify({
    ok: true,
    editorRoot,
    packRoot: pack.packRoot,
    mediaFiles: manifest.files.length,
    timelineClips: manifest.suggestedTimeline.length,
  }),
);
console.log('SMOKE_OK capcut-xinchao-native-seam');
