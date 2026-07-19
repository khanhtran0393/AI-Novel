/**
 * Output criteria + ship gate (Ảnh/Video · TTS · CapCut) — no live browser required.
 */
import { test, expect } from '@playwright/test';
import { createChannelProfile } from '../src/lib/channelModel';
import {
  mergeLiveSettingsIntoChannel,
  resolveOutputCriteria,
  evaluateSettingsAsCriteria,
  toCapCutAspect,
} from '../src/lib/outputCriteria';
import { buildShipPack } from '../src/lib/shipPack';
import { evaluateShipGate, healthInputFromStore } from '../src/lib/shipGate';
import { evaluateCredentialHealth } from '../src/lib/credentialHealth';
import {
  evaluateMediaDnaMatch,
  stampAudioDna,
  stampImageDna,
  liveDnaFromStoreLike,
} from '../src/lib/mediaDnaMatch';

const SCRIPT = `[CẢNH 1: A]
Một vết nứt trên tường cổ nở ra, ánh sáng lạnh tràn vào. Hàn Dực lùi nửa bước.

[CẢNH 2: B]
Liễu Yên níu cổ tay hắn. Cả hai biết cánh cửa đá sẽ khép.

[CẢNH 3: C]
Họ lao xuống giếng. Dấu khắc hình mắt mở ra ở đáy.`;

test.describe('output criteria from toolbar settings', () => {
  test('live Ảnh/Video + TTS override channel defaults', () => {
    const base = createChannelProfile('Kênh E2E', {
      defaultShipMode: 'longform',
      aspectRatio: '16:9',
    });
    const merged = mergeLiveSettingsIntoChannel(
      base,
      {
        imageProvider: 'grok',
        imageAspectRatio: '2:3',
        videoProvider: 'sora',
        videoAspectRatio: '9:16',
        videoDuration: 10,
      },
      {
        platform: 'edge_tts',
        voice: 'vi-VN-HoaiMyNeural',
        speed: 0.97,
        pitch: 1,
      },
    );
    const c = resolveOutputCriteria(merged, 'short');
    expect(c.imageAspectRatio).toBe('2:3');
    expect(c.videoAspectRatio).toBe('9:16');
    expect(c.capCutAspect).toBe('9:16');
    expect(c.imageProvider).toBe('grok');
    expect(c.videoProvider).toBe('sora');
    expect(c.videoDuration).toBe(10);
    expect(c.tts.platform).toBe('edge_tts');
    expect(c.tts.speed).toBe(0.97);
    expect(evaluateSettingsAsCriteria(c).pass).toBe(true);
  });

  test('toCapCutAspect mapping', () => {
    expect(toCapCutAspect('2:3')).toBe('9:16');
    expect(toCapCutAspect('9:16')).toBe('9:16');
    expect(toCapCutAspect('16:9')).toBe('16:9');
    expect(toCapCutAspect('1:1')).toBe('1:1');
    expect(toCapCutAspect('4:5')).toBe('4:5');
  });

  test('ship pack embeds settings_criteria + user ratios', () => {
    const ch = mergeLiveSettingsIntoChannel(
      createChannelProfile('Ship E2E', { defaultShipMode: 'short' }),
      {
        imageAspectRatio: '9:16',
        videoAspectRatio: '9:16',
        imageProvider: 'gemini',
        videoProvider: 'veo',
        videoDuration: 8,
      },
      { platform: 'edge_tts', voice: 'vi-VN-NamMinhNeural', speed: 1 },
    );
    const pack = buildShipPack({
      channel: ch,
      mode: 'short',
      ten_tac_pham: 'E2E Novel',
      chapter: {
        so_chuong: 1,
        tieu_de: 'T',
        dan_y: '',
        noi_dung: SCRIPT,
      },
      // B10: ship requires real SEO hooks (no invent) — fixture must pass product SEO gate (score ≥ 8.5)
      chapterHooks: {
        hook: 'Mở cảnh cold-open: tiếng gõ cửa lúc nửa đêm khiến cả dãy phố im bặt.',
        thumbnailLine: '3 tiếng gõ — đừng mở…',
        seoTitle:
          'Sự thật sau cửa sổ kẹt: 3 tiếng gõ nửa đêm không ai dám kể… xem đến cuối',
        seoDescription:
          '3 tiếng gõ — đừng mở… Một đêm mưa, cửa sổ kẹt cứng từ phía trong. Hàn Dực lần theo manh mối dưới lớp sơn cũ ' +
          'và phát hiện chuỗi sự kiện không thể giải thích bằng logic thường. ' +
          'Sai một bước là mất sạch manh mối. Bí mật lộ ra từng mảnh khi khung gỗ lạnh run lên. ' +
          '📌 Chapters timeline: 0:00 cold open · 0:30 cửa sổ · 1:20 chữ trên tường. ' +
          '#truyenaudio #kinhditamly #cuasoket Like và đăng ký để theo dõi chương tiếp theo trước khi cửa sổ mở lại.',
        seoTags: 'truyện short,audio,hook,e2e,kinh dị tâm lý',
        thumbnailPrompt: 'midnight door knock cinematic short vertical',
      },
      generatedAudioPaths: { '1_0': { path: 'a.mp3', duration: 5 } },
      generatedImages: { '1_0_0': 'i.png' },
    });
    const settingsFile = pack.files.find(
      (f) => f.relativePath === 'settings_criteria.json',
    );
    expect(settingsFile).toBeTruthy();
    const sc = JSON.parse(settingsFile!.content);
    expect(sc.image.aspectRatio).toBe('9:16');
    expect(sc.video.aspectRatio).toBe('9:16');
    expect(sc.capcut.aspect).toBe('9:16');
    expect(sc.tts.platform).toBe('edge_tts');
    const man = pack.manifest as {
      criteria?: { videoAspectRatio?: string };
      quality?: { settings?: { pass?: boolean } };
      stats?: { scenes?: number };
    };
    expect(man.criteria?.videoAspectRatio).toBe('9:16');
    expect(man.quality?.settings?.pass).toBe(true);
    expect(man.stats?.scenes ?? 0).toBeGreaterThanOrEqual(3);
    expect(man.stats?.scenes ?? 0).toBeLessThanOrEqual(10);
  });
});

test.describe('ship gate (credential + assets)', () => {
  test('blocks short mode without audio/images', () => {
    const ch = mergeLiveSettingsIntoChannel(
      createChannelProfile('Gate', { defaultShipMode: 'short' }),
      { imageAspectRatio: '9:16', videoAspectRatio: '9:16' },
      { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
    );
    const gate = evaluateShipGate({
      channel: ch,
      mode: 'short',
      health: healthInputFromStore({
        apiKey: 'k',
        imageProvider: 'gemini',
        videoProvider: 'veo',
        ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
      }),
      hasAudio: false,
      hasImages: false,
      hasVideos: false,
      requireVisualAssets: true,
    });
    expect(gate.blocked).toBe(true);
    expect(gate.blockers.length).toBeGreaterThan(0);
  });

  test('passes when settings + edge tts + assets ready', () => {
    const ch = mergeLiveSettingsIntoChannel(
      createChannelProfile('Gate OK', { defaultShipMode: 'short' }),
      {
        imageProvider: 'gemini',
        imageAspectRatio: '9:16',
        videoAspectRatio: '9:16',
        videoProvider: 'veo',
      },
      { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural', speed: 1 },
    );
    const gate = evaluateShipGate({
      channel: ch,
      mode: 'short',
      health: healthInputFromStore({
        apiKey: 'gemini-key',
        imageProvider: 'gemini',
        videoProvider: 'veo',
        ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
      }),
      hasAudio: true,
      hasImages: true,
      hasVideos: false,
    });
    expect(gate.settingsPass).toBe(true);
    expect(gate.healthFail).toBe(0);
    expect(gate.blocked).toBe(false);
    expect(gate.ok).toBe(true);
  });

  test('credential health fails grok image without key', () => {
    const h = evaluateCredentialHealth({
      imageProvider: 'grok',
      ttsConfig: { platform: 'edge_tts', voice: 'x' },
    });
    expect(h.fail).toBeGreaterThan(0);
    expect(h.items.some((i) => i.id === 'image' && i.level === 'fail')).toBe(
      true,
    );
  });
});

test.describe('media DNA match (toolbar vs generated assets)', () => {
  test('detects TTS platform mismatch after settings change', () => {
    const stamp = stampAudioDna({
      ttsPlatform: 'edge_tts',
      ttsVoice: 'vi-VN-HoaiMyNeural',
      ttsSpeed: 1,
      ttsPitch: 0,
    });
    const report = evaluateMediaDnaMatch({
      chapterNum: 1,
      audioKeys: ['1_0'],
      stamps: { '1_0': stamp },
      live: {
        ttsPlatform: 'vina_voice',
        ttsVoice: 'clone-A',
        ttsSpeed: 1,
        ttsPitch: 0,
      },
    });
    expect(report.hasIssues).toBe(true);
    expect(
      report.mismatches.some((m) => m.field === 'ttsPlatform'),
    ).toBe(true);
  });

  test('detects image aspect mismatch', () => {
    const stamp = stampImageDna({
      imageProvider: 'gemini',
      imageAspectRatio: '16:9',
    });
    const report = evaluateMediaDnaMatch({
      chapterNum: 1,
      imageKeys: ['1_0_0'],
      stamps: { '1_0_0': stamp },
      live: {
        imageProvider: 'gemini',
        imageAspectRatio: '9:16',
      },
    });
    expect(report.mismatches.some((m) => m.field === 'imageAspectRatio')).toBe(
      true,
    );
  });

  test('unstamped legacy assets warn re-gen', () => {
    const report = evaluateMediaDnaMatch({
      chapterNum: 1,
      audioKeys: ['1_0'],
      imageKeys: ['1_0_0'],
      stamps: {},
      live: liveDnaFromStoreLike({
        ttsConfig: { platform: 'edge_tts', voice: 'v' },
        imageProvider: 'gemini',
        imageAspectRatio: '16:9',
      }),
    });
    expect(report.unstamped).toBe(2);
    expect(report.hasIssues).toBe(true);
  });

  test('SEO rejects FOMO dialogue dump titles', async () => {
    const { scoreSeoTitle, pickBestSeoTitle } = await import(
      '../src/lib/youtube-safe/seoMeta'
    );
    const bad =
      'Đừng bỏ lỡ: Cô chỉ vào một góc màn hình, nơi Kiến vừa vẽ… Tòa nhà bay';
    expect(scoreSeoTitle(bad)).toBeLessThan(8.5);
    const picked = pickBestSeoTitle(
      'Vết nứt trên tường cổ nở ra. Hàn Dực lùi bước. Tiếng chân thứ hai vọng sau lưng.',
      'Series Test',
      { seed: 3 },
    );
    expect(picked.title.length).toBeLessThanOrEqual(100);
    expect(/đừng bỏ lỡ:\s*cô/i.test(picked.title)).toBe(false);
    expect(/["“”]/.test(picked.title)).toBe(false);
  });

  test('createBatchJob assigns correlation ids', async () => {
    const { createBatchJob, buildJobErrorReport } = await import(
      '../src/lib/jobQueue'
    );
    const job = createBatchJob({
      title: 'criteria job',
      kind: 'tts',
      items: [{ label: 'scene 0' }, { label: 'scene 1' }],
    });
    expect(job.correlationId).toMatch(/^job_/);
    expect(job.items[0].correlationId).toBeTruthy();
    job.items[0].status = 'failed';
    job.items[0].error = 'boom';
    job.items[0].correlationId = 'req_test_abc';
    const report = buildJobErrorReport(job.id);
    expect(report).toContain('jobCorrelationId=');
    expect(report).toContain('req_test_abc');
  });

  test('matched DNA has no issues', () => {
    const live = {
      ttsPlatform: 'edge_tts',
      ttsVoice: 'vi-VN-HoaiMyNeural',
      ttsSpeed: 1,
      ttsPitch: 0,
      imageProvider: 'gemini',
      imageAspectRatio: '9:16',
    };
    const report = evaluateMediaDnaMatch({
      chapterNum: 1,
      audioKeys: ['1_0'],
      imageKeys: ['1_0_0'],
      stamps: {
        '1_0': stampAudioDna(live),
        '1_0_0': stampImageDna(live),
      },
      live,
    });
    expect(report.hasIssues).toBe(false);
    expect(report.stamped).toBe(2);
  });

  test('ship gate surfaces DNA warnings without blocking soft mismatches', () => {
    const ch = mergeLiveSettingsIntoChannel(
      createChannelProfile('DNA Gate', { defaultShipMode: 'short' }),
      {
        imageProvider: 'gemini',
        imageAspectRatio: '9:16',
        videoAspectRatio: '9:16',
      },
      { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural', speed: 1 },
    );
    const oldStamp = stampAudioDna({
      ttsPlatform: 'google',
      ttsVoice: 'vi-VN-Wavenet-B',
      ttsSpeed: 1,
      ttsPitch: 0,
    });
    const gate = evaluateShipGate({
      channel: ch,
      mode: 'short',
      health: healthInputFromStore({
        apiKey: 'k',
        imageProvider: 'gemini',
        videoProvider: 'veo',
        ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural' },
      }),
      hasAudio: true,
      hasImages: true,
      chapterNum: 1,
      liveMedia: {
        ttsConfig: { platform: 'edge_tts', voice: 'vi-VN-HoaiMyNeural', speed: 1 },
        imageProvider: 'gemini',
        imageAspectRatio: '9:16',
        videoAspectRatio: '9:16',
        generatedAudioPaths: { '1_0': { path: 'a.mp3' } },
        generatedImages: { '1_0_0': 'i.png' },
        generatedAssetDna: { '1_0': oldStamp },
      },
    });
    expect(gate.blocked).toBe(false);
    expect(gate.mediaDna?.hasIssues).toBe(true);
    expect(gate.warnings.some((w) => w.includes('DNA media'))).toBe(true);
  });
});
