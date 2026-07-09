/**
 * Empirical unit checks for Role Casting Studio (no TTS network).
 * Run: node scripts/cast-unit-check.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Dynamic import of compiled TS via tsx is ideal; for plain node we re-implement
// critical pure functions inline by importing from dist if available.
// Prefer running through npx tsx when available.

async function load() {
  try {
    const { register } = await import('node:module');
    // try tsx
  } catch {
    /* ignore */
  }
  const tsx = await import('tsx/esm/api').catch(() => null);
  if (tsx?.register) {
    tsx.register();
  }
  const voiceCastUrl = pathToFileURL(path.join(root, 'src/lib/voiceCast.ts')).href;
  const castSeedUrl = pathToFileURL(path.join(root, 'src/lib/castSeed.ts')).href;
  const castModuleUrl = pathToFileURL(
    path.join(root, 'src/app/workspace/modules/castModule.ts'),
  ).href;
  const castDialogueUrl = pathToFileURL(path.join(root, 'src/lib/castDialogue.ts')).href;
  const castExportUrl = pathToFileURL(path.join(root, 'src/lib/castExport.ts')).href;

  return {
    voiceCast: await import(voiceCastUrl),
    castSeed: await import(castSeedUrl),
    castModule: await import(castModuleUrl),
    castDialogue: await import(castDialogueUrl),
    castExport: await import(castExportUrl),
  };
}

async function main() {
  const { voiceCast, castSeed, castModule, castDialogue, castExport } = await load();
  const {
    hash12,
    makeSegmentId,
    normalizeVoiceCast,
    shouldUseCastMulti,
    EMPTY_VOICE_CAST,
    isCastActive,
  } = voiceCast;
  const { seedRolesFromProject } = castSeed;
  const { applyBulkRoleRule, resolveSceneCast } = castModule;
  const { parseCastDialogue, buildSceneCastSegments } = castDialogue;
  const { exportVinaRolesJson, exportVinaRoleProfile } = castExport;

  // hash stable
  assert.equal(hash12('abc'), hash12('abc'));
  assert.notEqual(hash12('abc'), hash12('abd'));

  // segment ids stable by content not order
  const id1 = makeSegmentId({
    chapter: 1,
    sceneIndex: 0,
    text: 'Đứng lại!',
    speakerGuess: 'Hàn Dực',
  });
  const id2 = makeSegmentId({
    chapter: 1,
    sceneIndex: 0,
    text: 'Đứng lại!',
    speakerGuess: 'Hàn Dực',
  });
  assert.equal(id1, id2);

  // shouldUseCastMulti Case A: same voice, empty emotion → false
  assert.equal(
    shouldUseCastMulti(
      [
        { voice: 'v1', speed: 1, pitch: 0, emotion: '' },
        { voice: 'v1', speed: 1, pitch: 0, emotion: '' },
      ],
      { voice: 'v1', speed: 1, pitch: 0 },
    ),
    false,
  );
  // multi voices
  assert.equal(
    shouldUseCastMulti(
      [
        { voice: 'v1', speed: 1, pitch: 0 },
        { voice: 'v2', speed: 1, pitch: 0 },
      ],
      { voice: 'v1', speed: 1, pitch: 0 },
    ),
    true,
  );
  // prosody differ
  assert.equal(
    shouldUseCastMulti(
      [
        { voice: 'v1', speed: 0.9, pitch: 0 },
        { voice: 'v1', speed: 1.1, pitch: 0 },
      ],
      { voice: 'v1', speed: 1, pitch: 0 },
    ),
    true,
  );

  // seed roles sticky indices
  const roles = seedRolesFromProject({
    nhan_vat: ['Hàn Dực', 'Liễu Yên', 'Lão Vương'],
    nhan_vat_prompts: {
      'Hàn Dực': { gioi_tinh: 'nam', tts_voice: '' },
      'Liễu Yên': { gioi_tinh: 'nữ', tts_voice: '' },
      'Lão Vương': { gioi_tinh: 'nam', tts_voice: '' },
    },
    ttsConfig: {
      platform: 'edge_tts',
      language: 'vi',
      voice: 'vi-VN-NamMinhNeural',
      speed: 1,
      pitch: 0,
    },
    voiceCast: EMPTY_VOICE_CAST,
  });
  assert.ok(roles.some((r) => r.id === 'narrator'));
  const chars = roles.filter((r) => r.kind === 'character');
  assert.equal(chars.length, 3);
  assert.deepEqual(
    chars.map((c) => c.vinaRoleIndex).sort((a, b) => a - b),
    [1, 2, 3],
  );

  // delete #2 sticky hole: bulk missing
  const without2 = roles.filter((r) => r.vinaRoleIndex !== 2);
  const bulk = applyBulkRoleRule({
    segments: [
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
    ],
    selectedOrders: [0, 1],
    rule: '#1-#2',
    roles: without2,
  });
  assert.ok(bulk.errors.some((e) => /#2/.test(e)));
  assert.equal(bulk.updates.length, 1);

  // parse dialogue
  const lines = parseCastDialogue({
    sceneText: `Gió thổi.\nHàn Dực: Đứng lại!\nLiễu Yên nói: Sao vậy?`,
    characterNames: ['Hàn Dực', 'Liễu Yên'],
  });
  assert.ok(lines.some((l) => l.speaker === 'Hàn Dực'));
  assert.ok(lines.some((l) => l.speaker === 'Liễu Yên'));

  const cast = normalizeVoiceCast({
    version: 1,
    enabled: true,
    roles,
    segmentOverrides: {},
  });
  assert.equal(isCastActive(cast), true);

  const resolved = resolveSceneCast({
    sceneText: `Hàn Dực: A\nLiễu Yên: B`,
    chapter: 1,
    sceneIndex: 0,
    cast,
    characterNames: ['Hàn Dực', 'Liễu Yên'],
    nhanVatPrompts: {},
    defaultVoice: 'vi-VN-NamMinhNeural',
    platform: 'edge_tts',
    globalSpeed: 1,
    globalPitch: 0,
  });
  // May or may not multi depending on suggested voices
  assert.ok(resolved.segments.length >= 2);

  const vinaRoles = exportVinaRolesJson(cast, undefined, {
    'Liễu Yên': { gioi_tinh: 'nữ' },
    'Hàn Dực': { gioi_tinh: 'nam' },
  });
  assert.ok(Object.keys(vinaRoles).every((k) => Number(k) >= 1));
  // gender from profile, not default male for nữ
  const lieuSlot = Object.values(vinaRoles).find((r) => r.name === 'Liễu Yên');
  if (lieuSlot) assert.equal(lieuSlot.gender, 'female');
  const profile = exportVinaRoleProfile(cast, ['Hàn Dực', 'Liễu Yên', 'Lão Vương']);
  assert.equal(typeof profile['Hàn Dực'], 'string');
  assert.ok(!('Người kể' in profile));

  // empty cast not active
  assert.equal(isCastActive(EMPTY_VOICE_CAST), false);
  assert.equal(isCastActive(normalizeVoiceCast({ enabled: true, roles: [] })), false);

  // mapGender helper if exported
  if (typeof castExport.mapGenderToVina === 'function') {
    assert.equal(castExport.mapGenderToVina('Nữ'), 'female');
    assert.equal(castExport.mapGenderToVina('nam'), 'male');
  }

  // multi partial fingerprint helpers
  const partialUrl = pathToFileURL(path.join(root, 'src/lib/multiTtsPartialCache.ts')).href;
  const partial = await import(partialUrl);
  const fp1 = partial.fingerprintSeg({
    text: 'Xin chào',
    voice: 'a',
    speed: 1,
    pitch: 0,
    emotion: '',
  });
  const fp2 = partial.fingerprintSeg({
    text: 'Xin chào',
    voice: 'a',
    speed: 1,
    pitch: 0,
    emotion: '',
  });
  const fp3 = partial.fingerprintSeg({
    text: 'Xin chào',
    voice: 'b',
    speed: 1,
    pitch: 0,
    emotion: '',
  });
  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);
  assert.equal(partial.countPartialParts(null), 0);
  assert.equal(
    partial.countPartialParts({
      parts: { 0: { path: '/a', fp: 'x' }, 1: { path: '/b', fp: 'y' } },
    }),
    2,
  );

  // chapter preflight module loads
  const preflightUrl = pathToFileURL(
    path.join(root, 'src/app/workspace/modules/castPreflight.ts'),
  ).href;
  const preflight = await import(preflightUrl);
  const chPf = preflight.runChapterCastPreflight({
    jobs: [
      { sceneIndex: 0, text: 'A: Xin chào.\nB: Ừ.', title: 'C1' },
      { sceneIndex: 1, text: '', title: 'Empty' },
    ],
    chapter: 1,
    cast: {
      version: 1,
      enabled: true,
      roles: [
        { id: 'narrator', label: 'Kể', kind: 'narrator', voiceId: 'v0' },
        {
          id: 'char_A',
          label: 'A',
          kind: 'character',
          characterName: 'A',
          voiceId: 'v1',
          vinaRoleIndex: 1,
        },
        {
          id: 'char_B',
          label: 'B',
          kind: 'character',
          characterName: 'B',
          voiceId: 'v2',
          vinaRoleIndex: 2,
        },
      ],
      segmentOverrides: {},
    },
    characterNames: ['A', 'B'],
    nhanVatPrompts: {},
    defaultVoice: 'v0',
    platform: 'edge_tts',
    globalSpeed: 1,
    globalPitch: 0,
  });
  assert.ok(chPf.blocked.some((b) => b.job.title === 'Empty'));
  assert.ok(chPf.runnable.some((j) => j.title === 'C1'));
  const report = preflight.formatChapterPreflightConfirm(chPf);
  assert.ok(report.includes('Block') || report.includes('block') || report.includes('🚫'));

  console.log('PASS cast-unit-check: all assertions ok');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
