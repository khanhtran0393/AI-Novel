/**
 * Smoke: external video API auto-detect + catalog (HeyGen / Luma / Runway).
 * No live key required for heuristic path (skipProbe).
 */
import {
  VIDEO_API_CATALOG,
  SUPPORTED_GENERATE_VIDEO_PROVIDERS,
  getVideoApiCatalogEntry,
} from '../src/lib/video-api/catalog.ts';
import { detectVideoApiPlatform } from '../src/lib/video-api/detect.ts';
import { newExternalVideoApiId } from '../src/lib/video-api/index.ts';

const checks: Array<[string, boolean]> = [];

checks.push([
  'catalog has heygen',
  VIDEO_API_CATALOG.some((c) => c.id === 'heygen' && c.generateSupported),
]);
checks.push([
  'supported generate includes heygen',
  (SUPPORTED_GENERATE_VIDEO_PROVIDERS as readonly string[]).includes('heygen'),
]);
checks.push([
  'supported generate includes luma+runway',
  (SUPPORTED_GENERATE_VIDEO_PROVIDERS as readonly string[]).includes('luma') &&
    (SUPPORTED_GENERATE_VIDEO_PROVIDERS as readonly string[]).includes('runway'),
]);

const byHost = await detectVideoApiPlatform({
  apiKey: 'dummy-key-not-real',
  baseUrl: 'https://api.heygen.com',
  skipProbe: true,
});
checks.push(['detect heygen by baseUrl', byHost.providerId === 'heygen']);
checks.push(['heygen default model video-agent', byHost.defaultModel === 'video-agent']);
checks.push(['heygen auth x-api-key', byHost.authStyle === 'x-api-key']);

const byLumaHost = await detectVideoApiPlatform({
  apiKey: 'lumakey',
  baseUrl: 'https://api.lumalabs.ai/dream-machine',
  skipProbe: true,
});
checks.push(['detect luma by baseUrl', byLumaHost.providerId === 'luma']);

const byRunwayHost = await detectVideoApiPlatform({
  apiKey: 'key',
  baseUrl: 'https://api.dev.runwayml.com',
  skipProbe: true,
});
checks.push(['detect runway by baseUrl', byRunwayHost.providerId === 'runway']);

const byVeoKey = await detectVideoApiPlatform({
  apiKey: 'AIzaSyDummyNotRealKey1234567890',
  skipProbe: true,
});
checks.push(['detect veo by AIzaSy key', byVeoKey.providerId === 'veo']);

const bySk = await detectVideoApiPlatform({
  apiKey: 'sk-proj-dummyopenai',
  skipProbe: true,
});
checks.push(['detect sora by sk- key', bySk.providerId === 'sora']);

const unknown = await detectVideoApiPlatform({
  apiKey: 'zzzz-no-hint-key-xyz',
  skipProbe: true,
});
checks.push(['unknown without hints', unknown.providerId === 'unknown']);

const id = newExternalVideoApiId();
checks.push(['new id prefix', id.startsWith('vap_')]);

const hg = getVideoApiCatalogEntry('heygen');
checks.push(['heygen catalog entry', !!hg && hg.defaultBaseUrl.includes('heygen.com')]);

let fail = 0;
for (const [name, ok] of checks) {
  console.log(ok ? 'PASS' : 'FAIL', '·', name);
  if (!ok) fail += 1;
}
console.log(`[smoke-video-api-detect] fail=${fail}`);
if (fail > 0) process.exit(1);
console.log('[smoke-video-api-detect] OK');
