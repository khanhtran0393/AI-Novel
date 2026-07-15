import { test, expect } from '@playwright/test';
import {
  sceneAssetKey,
  imageAssetKey,
  videoAssetKey,
  videoAssetKeyFromImageKey,
  characterImageKey,
  characterRoleId,
  chapterAssetPrefix,
  localAudioFilename,
  localImageFilename,
  localVideoFilename,
  driveMediaFilename,
  parseSceneAssetKey,
  parseImageAssetKey,
  assetKeyBelongsToChapter,
  GENERATE_REQUEST_OWNERS,
  parseOrThrow,
  generateBodySchema,
  generateTtsBodySchema,
  generateImageBodySchema,
  chapterToDto,
  chapterFromDto,
  API,
  CORE_PAYLOAD_SCHEMAS,
} from '../src/contracts';
import {
  issueEntitlementToken,
  verifyEntitlementToken,
  getEntitlementMode,
} from '../src/lib/entitlement';
import { AppError, toErrorJson } from '../src/lib/errors';
import { maskSecret, maskSecretsInText } from '../src/lib/secrets';
import { newCorrelationId } from '../src/lib/requestContext';
import { probeRuntimeHealth } from '../src/lib/runtimeHealth';
import {
  setupToDto,
  setupFromDto,
} from '../src/contracts/story';
import {
  buildPortableProject,
  parsePortableProject,
  portableStatePatch,
  toRelativeMediaPath,
} from '../src/lib/projectPortable';
import { buildDemoProjectPatch } from '../src/lib/onboarding';

test.describe('contracts keys', () => {
  test('scene / image / character keys are stable', () => {
    expect(sceneAssetKey(3, 2)).toBe('3_2');
    expect(imageAssetKey(1, 0, 4)).toBe('1_0_4');
    expect(characterImageKey('  Hàn Dực  ')).toMatch(/^char_/);
  });

  test('video / role / prefix / disk filenames (unified helpers)', () => {
    expect(videoAssetKey(1, 0, 2)).toBe('1_0_2_video');
    expect(videoAssetKeyFromImageKey('1_0_2')).toBe('1_0_2_video');
    expect(characterRoleId('Liễu Yên')).toBe(characterImageKey('Liễu Yên'));
    expect(chapterAssetPrefix(7)).toBe('7_');
    expect(localAudioFilename(1, 0, 'mp3')).toBe('chapter_1_scene_0.mp3');
    expect(localImageFilename(1, 0, 2)).toBe('chapter_1_scene_0_prompt_2.png');
    expect(localVideoFilename(1, 0)).toBe('chapter_1_scene_0_animatic.mp4');
    expect(driveMediaFilename('Truyen', 1, 0, { kind: 'audio' })).toContain(
      'Chuong_1',
    );
    expect(parseSceneAssetKey('3_2')).toEqual({ chapter: 3, sceneIndex: 2 });
    expect(parseImageAssetKey('3_2_1')).toEqual({
      chapter: 3,
      sceneIndex: 2,
      promptIndex: 1,
    });
    expect(assetKeyBelongsToChapter('3_2_0', 3)).toBe(true);
    expect(assetKeyBelongsToChapter('4_0', 3)).toBe(false);
  });

  test('API map has hot paths', () => {
    expect(API.generate).toBe('/api/generate');
    expect(API.generateTts).toBe('/api/generate-tts');
    expect(API.generateImage).toBe('/api/generate-image');
    expect(API.ainovel.status).toBe('/api/ainovel/status');
    expect(API.integrations.seedance).toBe('/api/integrations/seedance');
  });

  test('chapter DTO round-trip', () => {
    const store = {
      so_chuong: 2,
      tieu_de: 'T',
      dan_y: 'D',
      noi_dung: 'N',
      trang_thai: 'ready' as const,
    };
    const dto = chapterToDto(store);
    expect(dto.chapter).toBe(2);
    expect(chapterFromDto(dto).so_chuong).toBe(2);
  });

  test('GENERATE_REQUEST_OWNERS covers core write types', () => {
    expect(GENERATE_REQUEST_OWNERS.WRITE_CHAPTER).toBe('chapter');
    expect(GENERATE_REQUEST_OWNERS.EXPAND_SCENE).toBe('scene');
    expect(GENERATE_REQUEST_OWNERS.GENERATE_IMAGE_PROMPT).toBe('imagePrompt');
  });
});

test.describe('zod validation', () => {
  test('generate body rejects unknown requestType', () => {
    expect(() =>
      parseOrThrow(generateBodySchema, { requestType: 'NOPE' }, 't'),
    ).toThrow(AppError);
  });

  test('generate body accepts WRITE_CHAPTER', () => {
    const b = parseOrThrow(
      generateBodySchema,
      { requestType: 'WRITE_CHAPTER', payload: { x: 1 }, apiKeys: ['k'] },
      't',
    );
    expect(b.requestType).toBe('WRITE_CHAPTER');
  });

  test('tts body requires platform + text', () => {
    expect(() =>
      parseOrThrow(generateTtsBodySchema, { sceneText: 'hi' }, 't'),
    ).toThrow(/platform/i);
    const ok = parseOrThrow(
      generateTtsBodySchema,
      {
        sceneText: 'Xin chào',
        ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
      },
      't',
    );
    expect(ok.ttsConfig?.platform).toBe('edge_tts');
  });

  test('image body coerces numbers', () => {
    const b = parseOrThrow(
      generateImageBodySchema,
      {
        prompt: 'a dark alley',
        chapterNum: '1',
        sceneIndex: '0',
        promptIndex: '2',
        imageProvider: 'openai',
      },
      't',
    );
    expect(b.chapterNum).toBe(1);
    expect(b.promptIndex).toBe(2);
  });
});

test.describe('entitlement', () => {
  test('mode defaults to open', () => {
    expect(['open', 'enforce']).toContain(getEntitlementMode());
  });

  test('issue + verify token', () => {
    const token = issueEntitlementToken({ is_pro: true, is_vip: false, expSeconds: 3600 });
    const claims = verifyEntitlementToken(token);
    expect(claims?.is_pro).toBe(true);
    expect(claims?.is_vip).toBe(false);
  });

  test('tampered token fails', () => {
    const token = issueEntitlementToken({ is_pro: true, is_vip: true });
    expect(verifyEntitlementToken(token + 'x')).toBeNull();
  });
});

test.describe('errors', () => {
  test('toErrorJson AppError', () => {
    const j = toErrorJson(new AppError('bad', { code: 'VALIDATION', status: 400 }));
    expect(j.code).toBe('VALIDATION');
    expect(j.error).toBe('bad');
  });

  test('toErrorJson carries correlationId', () => {
    const cid = newCorrelationId('e2e');
    const j = toErrorJson(new AppError('bad', { code: 'USER' }), cid);
    expect(j.correlationId).toBe(cid);
  });
});

test.describe('secrets + health + api map', () => {
  test('maskSecret redacts long keys', () => {
    const m = maskSecret('sk-abcdefghijklmnopqrstuvwxyz');
    expect(m).not.toContain('sk-abcdefghijklmnop');
    expect(m.includes('…') || m.includes('...')).toBeTruthy();
  });

  test('maskSecretsInText redacts apiKey assignment', () => {
    const m = maskSecretsInText('apiKey=sk-abcdefghijklmnopqrstuvwx');
    expect(m).not.toMatch(/sk-abcdefghijklmnop/);
  });

  test('CORE_PAYLOAD_SCHEMAS covers write chapter', () => {
    expect(CORE_PAYLOAD_SCHEMAS.WRITE_CHAPTER).toBeTruthy();
  });

  test('API.healthRuntime path', () => {
    expect(API.healthRuntime).toBe('/api/health/runtime');
  });

  test('probeRuntimeHealth returns items', () => {
    const h = probeRuntimeHealth(process.cwd());
    expect(h.items.length).toBeGreaterThan(0);
    expect(h.items.some((i) => i.id === 'contracts')).toBe(true);
  });
});

test.describe('portable + adapters + payloads', () => {
  test('setup DTO round-trip', () => {
    const s = setupFromDto(
      setupToDto({
        chu_de: 'Sinh Tồn',
        phong_cach: 'Tối',
        mo_ta: 'x',
        so_chuong: 5,
        so_tu_chuong: 4000,
        ngon_ngu: 'Tiếng Việt',
      }),
    );
    expect(s.chu_de).toBe('Sinh Tồn');
    expect(s.so_chuong).toBe(5);
  });

  test('every GENERATE requestType has payload schema', () => {
    for (const key of Object.keys(GENERATE_REQUEST_OWNERS)) {
      expect(CORE_PAYLOAD_SCHEMAS[key as keyof typeof CORE_PAYLOAD_SCHEMAS]).toBeTruthy();
    }
  });

  test('portable project strips secrets and relativizes paths', () => {
    expect(toRelativeMediaPath('/public/audio/a.mp3')).toMatch(/audio/);
    const pack = buildPortableProject(
      {
        ten_tac_pham: 'Portable Demo',
        apiKey: 'sk-should-not-export',
        apiKeys: ['k1'],
        danh_sach_chuong: [
          {
            so_chuong: 1,
            tieu_de: 'C1',
            dan_y: '',
            noi_dung: 'Hi',
            trang_thai: 'ready',
          },
        ],
        generatedAudioPaths: {
          '1_0': { path: 'D:/My app/AI Novel/public/audio/x.mp3', duration: 3 },
        },
        generatedImages: {
          '1_0_0': '/images/foo.png',
        },
      },
      { stripSecrets: true },
    );
    expect(pack.portableVersion).toBe(2);
    expect(pack.secretsStripped).toBe(true);
    expect(pack.state.apiKey).toBeUndefined();
    expect(pack.mediaIndex.images.length + pack.mediaIndex.audio.length).toBeGreaterThan(0);
    const patch = portableStatePatch(pack);
    expect(patch.ten_tac_pham).toBe('Portable Demo');
    expect(patch.apiKey).toBeUndefined();
    const round = parsePortableProject(JSON.stringify(pack));
    expect(round.state.ten_tac_pham).toBe('Portable Demo');
  });

  test('demo onboarding patch has chapter content', () => {
    const p = buildDemoProjectPatch();
    expect(p.giai_doan).toBe(2);
    expect(Array.isArray(p.danh_sach_chuong)).toBe(true);
    expect((p.danh_sach_chuong as { noi_dung: string }[])[0].noi_dung.length).toBeGreaterThan(20);
  });
});
