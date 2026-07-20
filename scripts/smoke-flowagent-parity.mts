import fs from 'fs';
import os from 'os';
import path from 'path';
import vm from 'vm';
import {
  buildBrowserHeaders,
  buildClientContext,
  buildImageGenerateBody,
  buildVideoFrontendTelemetryBody,
  buildVideoI2VBody,
  buildVideoT2VBody,
} from '../src/lib/flow-bridge/payloadBuilder';
import { resolveFlowImageModelName } from '../src/lib/flow-bridge/modelCatalog';
import {
  clearProfileServiceWorkerCache,
  clearProfileTabRestoreState,
} from '../src/lib/flow-bridge/chromeSession';
import { defaultOutputDna } from '../src/lib/channelModel';
import { INITIAL_STATE } from '../src/store/novelInitialState';
import { migrateFlowAgentVideoModel } from '../src/store/novelStorePersistence';

let failed = false;

function check(name: string, condition: unknown, detail?: unknown): void {
  const ok = Boolean(condition);
  console.log(
    `[flowagent-parity] ${ok ? 'PASS' : 'FAIL'} ${name}${
      detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`
    }`,
  );
  if (!ok) failed = true;
}

const client = buildClientContext('project-test');
check(
  'persisted Nano Banana 2 Lite alias resolves to FlowAgent upstream key',
  resolveFlowImageModelName('NANO_BANANA_2_LITE') === 'HARBOR_SEAL',
  resolveFlowImageModelName('NANO_BANANA_2_LITE'),
);
check(
  'persisted non-parity I2V model migrates to FlowAgent Omni Flash',
  migrateFlowAgentVideoModel('veo_3_1_i2v_lite_low_priority') === 'OMNI_FLASH',
  migrateFlowAgentVideoModel('veo_3_1_i2v_lite_low_priority'),
);
check(
  'persisted known-good model is not rewritten',
  migrateFlowAgentVideoModel('veo_3_1_t2v_fast') === 'veo_3_1_t2v_fast',
);
const channelDefaults = defaultOutputDna();
check(
  'new channel output defaults stay on Flow image generation',
  channelDefaults.imageProvider === 'flow' &&
    channelDefaults.imageModel === 'GEM_PIX_2',
  channelDefaults,
);
check(
  'new channel and fresh workspace use FlowAgent Omni Flash video model',
  channelDefaults.videoProvider === 'flow' &&
    channelDefaults.videoModel === 'OMNI_FLASH' &&
    INITIAL_STATE.videoProvider === 'flow' &&
    INITIAL_STATE.videoModel === 'OMNI_FLASH',
  {
    channel: {
      provider: channelDefaults.videoProvider,
      model: channelDefaults.videoModel,
    },
    workspace: {
      provider: INITIAL_STATE.videoProvider,
      model: INITIAL_STATE.videoModel,
    },
  },
);
check(
  'clientContext matches working FlowAgent paygate tier',
  client.userPaygateTier === 'PAYGATE_TIER_ONE',
  client.userPaygateTier,
);

const image = buildImageGenerateBody({
  projectId: 'project-test',
  prompt: 'parity prompt',
  aspectRatio: '16:9',
  imageCount: 1,
  imageModel: 'GEM_PIX_2',
  imageMediaIds: ['media-ref'],
});
const imageBody = image.body as Record<string, any>;
const imageReq = imageBody.requests?.[0] as Record<string, any>;
check(
  'image uses structuredPrompt.parts text',
  String(imageReq?.structuredPrompt?.parts?.[0]?.text || '').startsWith(
    'parity prompt',
  ),
  imageReq,
);
const browserHeaders = buildBrowserHeaders();
check(
  'image wire headers and seed match working FlowAgent',
  browserHeaders['Content-Type'] === 'text/plain;charset=UTF-8' &&
    Number.isInteger(imageReq?.seed) &&
    imageReq.seed >= 0 &&
    imageReq.seed < 1_000_000,
  { contentType: browserHeaders['Content-Type'], seed: imageReq?.seed },
);
check('image omits unsupported plain prompt field', !('prompt' in imageReq));
check(
  'image reference type matches FlowAgent',
  imageReq?.imageInputs?.[0]?.imageInputType === 'IMAGE_INPUT_TYPE_REFERENCE',
  imageReq?.imageInputs,
);
check(
  'image reference request carries mediaGenerationContext/useNewMedia',
  Boolean(imageBody.mediaGenerationContext?.batchId) && imageBody.useNewMedia === true,
  imageBody,
);

const t2v = buildVideoT2VBody({
  projectId: 'project-test',
  prompt: 'video parity prompt',
  aspectRatio: '16:9',
  videoModel: 'veo_3_1_t2v_fast',
  durationSec: 8,
});
const t2vBody = t2v.body as Record<string, any>;
const t2vReq = t2vBody.requests?.[0] as Record<string, any>;
check(
  'T2V carries mediaGenerationContext/useV2ModelConfig',
  Boolean(t2vBody.mediaGenerationContext?.batchId) &&
    t2vBody.useV2ModelConfig === true,
  t2vBody,
);
check(
  'T2V request matches FlowAgent structured prompt and seed range',
  t2vReq?.textInput?.structuredPrompt?.parts?.[0]?.text ===
    'video parity prompt' &&
    Number.isInteger(t2vReq?.seed) &&
    t2vReq.seed >= 1 &&
    t2vReq.seed <= 9_999 &&
    Object.keys(t2vReq?.metadata || {}).length === 0,
  t2vReq,
);
const telemetry = buildVideoFrontendTelemetryBody({
  projectId: 'project-test',
  prompt: 'video parity prompt',
  aspectRatio: '16:9',
  videoModelKey: String(t2vReq?.videoModelKey || ''),
});
const telemetryEvent = (telemetry.body as Record<string, any>).events?.[0];
const telemetryParams = telemetryEvent?.metadata?.additionalParams;
check(
  'T2V emits FlowAgent frontend telemetry before generation',
  telemetry.url.includes('/v1/flow:batchLogFrontendEvents') &&
    telemetryEvent?.eventType === 'MEDIA_GENERATION' &&
    telemetryParams?.MEDIA_GENERATION_TYPE?.value === 'video' &&
    String(telemetryParams?.MEDIA_GENERATION_SETTINGS?.value || '').includes(
      'video parity prompt',
    ),
  telemetryEvent,
);

const i2v = buildVideoI2VBody({
  projectId: 'project-test',
  prompt: 'i2v parity prompt',
  aspectRatio: '16:9',
  videoModel: 'abra_t2v_8s',
  startMediaId: 'media-start',
  durationSec: 8,
});
const i2vBody = i2v.body as Record<string, any>;
const i2vReq = i2vBody.requests?.[0] as Record<string, any>;
check(
  'I2V carries FlowAgent mediaGenerationContext',
  Boolean(i2vBody.mediaGenerationContext?.batchId),
  i2vBody,
);
check(
  'I2V request matches FlowAgent structured prompt and media name shape',
  i2vReq?.textInput?.structuredPrompt?.parts?.[0]?.text ===
    'i2v parity prompt' &&
    i2vReq?.startImage?.name === 'media-start' &&
    !('mediaId' in (i2vReq?.startImage || {})),
  i2vReq,
);

const omniI2v = buildVideoI2VBody({
  projectId: 'project-test',
  prompt: 'omni flash parity prompt',
  aspectRatio: '16:9',
  videoModel: 'OMNI_FLASH',
  startMediaId: 'media-start',
  durationSec: 4,
});
const omniI2vReq = (omniI2v.body as Record<string, any>).requests?.[0];
check(
  'FlowAgent Omni Flash resolves model key from explicit duration',
  omniI2vReq?.videoModelKey === 'abra_t2v_4s',
  omniI2vReq?.videoModelKey,
);

let missingDurationRejected = false;
try {
  buildVideoI2VBody({
    projectId: 'project-test',
    prompt: 'missing duration must fail',
    videoModel: 'OMNI_FLASH',
    startMediaId: 'media-start',
  });
} catch (error) {
  missingDurationRejected = String(error).includes('FLOW_DURATION_REQUIRED');
}
check(
  'video generation rejects missing duration instead of defaulting silently',
  missingDurationRejected,
);

const videoRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', 'api', 'generate-video', 'route.ts'),
  'utf8',
);
check(
  'video route contains no hidden 5s/6s generation or Seedance metadata fallback',
  !/Number\(duration\)[^\n]*:\s*5/.test(videoRouteSource) &&
    !/Number\(videoDuration\)\s*\|\|\s*6/.test(videoRouteSource) &&
    !/durationSec:\s*6\b/.test(videoRouteSource) &&
    !/videoDuration:\s*6\b/.test(videoRouteSource) &&
    !/secondsPerBeat:\s*(?:[^\n]*\|\|\s*)?6\b/.test(videoRouteSource),
);
check(
  'Seedance output context is request-scoped instead of shared across concurrent requests',
  !/\blet\s+seedanceGenCtx\b/.test(videoRouteSource) &&
    /const\s+seedanceGenCtx:\s*SeedanceGenerationContext/.test(videoRouteSource),
);

const flowStudioSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'src',
    'app',
    'workspace',
    'features',
    'toolbox',
    'FlowAgentStudioModal.tsx',
  ),
  'utf8',
);
check(
  'FlowAgent Studio does not replace missing duration/model/provider silently',
  !/Number\(store\.videoDuration\)\s*\|\|/.test(flowStudioSource) &&
    !/store\.videoProvider\s*\|\|\s*['"]flow['"]/.test(flowStudioSource) &&
    !/store\.videoModel\s*\|\|/.test(flowStudioSource),
);

const guardPath = path.join(
  process.cwd(),
  'extensions',
  'ainovel-flow',
  'tabGuard.js',
);
if (!fs.existsSync(guardPath)) {
  check('startup tab guard exists', false, guardPath);
} else {
  const context: Record<string, any> = {
    globalThis: {},
    setTimeout: (fn: () => void) => {
      fn();
      return 0;
    },
  };
  vm.runInNewContext(fs.readFileSync(guardPath, 'utf8'), context, {
    filename: guardPath,
  });
  const guard = context.globalThis.AINOVEL_FLOW_TAB_GUARD;
  let calls = 0;
  const tabs = await guard.waitForExistingFlowTabs(
    async () => {
      calls += 1;
      return calls < 3 ? [] : [{ id: 7 }];
    },
    async () => undefined,
    { attempts: 4, intervalMs: 1 },
  );
  check(
    'tab guard absorbs launcher/service-worker race without opening a second tab',
    tabs.length === 1 && calls === 3,
    { calls, tabs },
  );
}

const extensionBackgroundSource = fs.readFileSync(
  path.join(process.cwd(), 'extensions', 'ainovel-flow', 'background.js'),
  'utf8',
);
const guardedOpenCallCount = (
  extensionBackgroundSource.match(/ensureSingleFlowTab\s*\(/g) || []
).length;
check(
  'extension startup/token/open paths share one Flow-tab creator and de-duplicator',
  /async function ensureSingleFlowTab/.test(extensionBackgroundSource) &&
    /async function dedupeFlowTabs/.test(extensionBackgroundSource) &&
    /tab\.pendingUrl/.test(extensionBackgroundSource) &&
    /google flow - ai creative studio/.test(extensionBackgroundSource) &&
    /await ensureSingleFlowTab\(\{ active: false \}\)/.test(
      extensionBackgroundSource,
    ) &&
    /flowTabCount:\s*currentFlowTabs\.length/.test(extensionBackgroundSource) &&
    /init\(\)\.catch/.test(extensionBackgroundSource) &&
    guardedOpenCallCount >= 4,
  { guardedOpenCallCount },
);
check(
  'extension clears rejected Bearer, harvests a fresh token, and retries tRPC once',
  /async function refreshFlowAuthToken/.test(extensionBackgroundSource) &&
    /service-worker tRPC fetch failed; retrying in Flow page context/.test(
      extensionBackgroundSource,
    ) &&
    /world:\s*'MAIN'/.test(extensionBackgroundSource) &&
    /trpcError\?\.data\?\.httpStatus === 401/.test(extensionBackgroundSource) &&
    /refreshFlowAuthToken\('trpc_401'\)/.test(extensionBackgroundSource) &&
    /type:\s*'token_rejected'/.test(extensionBackgroundSource) &&
    /requestViaFlowPage\(\)/.test(extensionBackgroundSource) &&
    /includeAuthorization\s*=\s*false/.test(extensionBackgroundSource) &&
    /new XMLHttpRequest\(\)/.test(extensionBackgroundSource) &&
    /TRPC_PAGE_XHR_NETWORK_ERROR/.test(extensionBackgroundSource) &&
    /TRPC_CONTENT_TIMEOUT/.test(extensionBackgroundSource) &&
    /xhr\.timeout\s*=\s*12000/.test(extensionBackgroundSource) &&
    /TRPC_PAGE_XHR_TIMEOUT/.test(extensionBackgroundSource) &&
    /type:\s*'FLOW_TRPC_REQUEST'/.test(extensionBackgroundSource) &&
    /preferPageContext\s*=\s*false/.test(extensionBackgroundSource) &&
    /GOOGLE_CHALLENGE_REQUIRED/.test(extensionBackgroundSource) &&
    /challengeRequired:\s*challengeTabs\.length > 0/.test(
      extensionBackgroundSource,
    ) &&
    /GOOGLE_CHALLENGE_REQUIRED: complete verification/.test(
      extensionBackgroundSource,
    ) &&
    /now - _lastAuthReloadAt < 60_000/.test(extensionBackgroundSource) &&
    /!token\.startsWith\('ya29\.'\)/.test(extensionBackgroundSource) &&
    !/acceptBearerToken\(String\(accessToken\),\s*'auth\/session'\)/.test(
      extensionBackgroundSource,
    ) &&
    /chrome\.storage\.local\.remove\(\['flowKey'\]\)/.test(
      extensionBackgroundSource,
    ),
);

const flowAgentRouteSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'app', 'api', 'flow', 'agent', 'route.ts'),
  'utf8',
);
check(
  'Flow Agent enqueue requires an explicit supported video duration',
  /FLOW_DURATION_INVALID/.test(flowAgentRouteSource) &&
    /\[4, 6, 8\]\.includes\(durationSec\)/.test(flowAgentRouteSource) &&
    !/durationSec:\s*s\.durationSec\s*!=\s*null\s*\?[^:]+:\s*6/.test(
      flowAgentRouteSource,
    ),
);

check(
  'extension command replies use live WS with authenticated HTTP callback redundancy',
  /if \(msg\.id\)/.test(extensionBackgroundSource) &&
    /ws\.send\(JSON\.stringify\(msg\)\)/.test(extensionBackgroundSource) &&
    /'X-Callback-Secret': callbackSecret \|\| ''/.test(extensionBackgroundSource),
);
check(
  'captcha and aisandbox requests execute in the authenticated Flow MAIN world with hard timeouts',
  /direct captcha failed; trying content relay/.test(extensionBackgroundSource) &&
    /GRECAPTCHA_EXECUTE_TIMEOUT/.test(extensionBackgroundSource) &&
    /isFrontendTelemetry/.test(extensionBackgroundSource) &&
    /workerResponse = await fetch/.test(extensionBackgroundSource) &&
    /AISANDBOX_PAGE_XHR_TIMEOUT/.test(extensionBackgroundSource) &&
    /AISANDBOX_PAGE_EXEC_TIMEOUT/.test(extensionBackgroundSource) &&
    /world:\s*'MAIN'/.test(extensionBackgroundSource),
);
check(
  'Flow onboarding DOM command is restricted to known project-entry labels',
  /async function inspectFlowPage/.test(extensionBackgroundSource) &&
    /async function clickFlowOnboardingButton/.test(extensionBackgroundSource) &&
    /FLOW_CLICK_LABEL_NOT_ALLOWED/.test(extensionBackgroundSource) &&
    /'create with google flow', 'dự án mới', 'new project'/.test(
      extensionBackgroundSource,
    ),
);
check(
  'Flow project sync recovers canonical project links from the authenticated page',
  /async function listProjectsFromPage/.test(extensionBackgroundSource) &&
  /a\[href\*="\/tools\/flow\/project\/"\]/.test(
      extensionBackgroundSource,
    ) &&
    /if \(!fromPage\.length\)/.test(extensionBackgroundSource),
);

const extensionContentSource = fs.readFileSync(
  path.join(process.cwd(), 'extensions', 'ainovel-flow', 'content.js'),
  'utf8',
);
check(
  'content script relays same-origin tRPC with the authenticated Flow cookie jar',
  /msg\.type === 'FLOW_TRPC_REQUEST'/.test(extensionContentSource) &&
    /credentials:\s*'include'/.test(extensionContentSource) &&
    /cache:\s*'no-store'/.test(extensionContentSource) &&
    /new AbortController\(\)/.test(extensionContentSource) &&
    /TRPC_CONTENT_TIMEOUT/.test(extensionContentSource),
);

const bridgeServerSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'flow-bridge', 'bridgeServer.ts'),
  'utf8',
);
check(
  'project creation recovers a real DOM-observed project after an upstream response timeout',
  /async function recoverCreatedProjectFromLivePage/.test(
    bridgeServerSource,
  ) && /isPlausibleProjectId\(id\)/.test(bridgeServerSource),
);
const chromeSessionSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'flow-bridge', 'chromeSession.ts'),
  'utf8',
);
check(
  'captured login keeps one authenticated Chrome process instead of kill-relaunching it',
  /Login window retained as background/.test(chromeSessionSource) &&
    /s\.bgPid = s\.loginPid \|\| s\.bgPid/.test(chromeSessionSource) &&
    /if \(keepBg && isProfileBrowserAlive\(profileDir\)\)/.test(
      chromeSessionSource,
    ),
);
check(
  'bridge never revives a bearer rejected by upstream from SESSION_BUNDLE',
  /function clearAccountFlowKey/.test(bridgeServerSource) &&
    /msg\.type === 'token_rejected'/.test(bridgeServerSource) &&
    /const ALLOW_DURABLE_BEARER_REHYDRATION = false/.test(
      bridgeServerSource,
    ) &&
    /flowKey:\s*null/.test(bridgeServerSource) &&
    /flowKeyPresent:\s*false/.test(bridgeServerSource),
);
check(
  'Flow output capability requires a real project in addition to authenticated session',
  /const authenticated = Boolean/.test(bridgeServerSource) &&
    /const projectReady = Boolean/.test(bridgeServerSource) &&
    /const generationReady = authenticated && projectReady/.test(
      bridgeServerSource,
    ) &&
    /FLOW_ACCOUNT_UPGRADE_REQUIRED/.test(bridgeServerSource),
);
check(
  'project creation uses the authenticated Flow page before service-worker fetch',
  /preferPageContext:\s*true/.test(bridgeServerSource) &&
    /preferPageContext\s*\?\s*await requestViaFlowPage\(\)/.test(
      extensionBackgroundSource,
    ),
);
check(
  'account readiness fails closed on Google challenge and unverified live session',
  /payload\.challengeRequired === true/.test(bridgeServerSource) &&
    /payload\.ok !== false && !challengeRequired/.test(bridgeServerSource) &&
    /inheritEmail && accNow\?\.sessionVerified && finalKey/.test(
      bridgeServerSource,
    ),
);
check(
  'partial service-worker polls preserve an already verified account identity',
  /const preserveTrustedState = payloadSessionReady && !email/.test(
    bridgeServerSource,
  ) &&
    /const alreadyVerified = Boolean/.test(bridgeServerSource) &&
    /sessionVerified: alreadyVerified/.test(bridgeServerSource),
);

const accountProxySource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'flow-bridge', 'accountProxy.ts'),
  'utf8',
);
const queueEngineSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'lib', 'flow-bridge', 'queueEngine.ts'),
  'utf8',
);
check(
  'signed Flow CDN downloads omit Bearer first and canonical PNG outputs normalize their bytes',
  /flow-content\\\.google/.test(accountProxySource) &&
    /node\+signed-url/.test(accountProxySource) &&
    /writeDownloadedBytes/.test(accountProxySource) &&
    /normalizeFlowImageOutput/.test(queueEngineSource) &&
    /await normalizeFlowImageOutput\(dest\)/.test(queueEngineSource),
);

const flowImageProviderSource = fs.readFileSync(
  path.join(
    process.cwd(),
    'src',
    'app',
    'api',
    'generate-image',
    'providers',
    'flow.ts',
  ),
  'utf8',
);
check(
  'Flow image provider requires the configured concrete model',
  /FLOW_IMAGE_MODEL_REQUIRED/.test(flowImageProviderSource) &&
    /imageModel:\s*explicitFlowModel/.test(flowImageProviderSource) &&
    !/\?\s*model\s*:\s*'GEM_PIX_2'/.test(flowImageProviderSource),
);

const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'ainovel-flow-tabs-'));
try {
  const defaultDir = path.join(tempProfile, 'Default');
  fs.mkdirSync(path.join(defaultDir, 'Sessions'), { recursive: true });
  fs.writeFileSync(path.join(defaultDir, 'Sessions', 'Tabs_1'), 'restore-me');
  fs.writeFileSync(path.join(defaultDir, 'Current Tabs'), 'restore-me');
  fs.writeFileSync(path.join(defaultDir, 'Cookies'), 'preserve-me');
  fs.mkdirSync(path.join(defaultDir, 'Local Storage'), { recursive: true });
  fs.writeFileSync(
    path.join(defaultDir, 'Local Storage', 'leveldb-preserve'),
    'preserve-me',
  );
  fs.mkdirSync(
    path.join(defaultDir, 'Service Worker', 'ScriptCache'),
    { recursive: true },
  );
  fs.writeFileSync(
    path.join(defaultDir, 'Service Worker', 'ScriptCache', 'stale-worker'),
    'old-background-js',
  );
  fs.mkdirSync(path.join(defaultDir, 'Service Worker', 'Database'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(defaultDir, 'Service Worker', 'Database', 'registration'),
    'stale-registration',
  );
  const removed = clearProfileTabRestoreState(tempProfile);
  check(
    'forced relaunch clears tab restore metadata only',
    removed.length === 2 &&
      !fs.existsSync(path.join(defaultDir, 'Sessions')) &&
      !fs.existsSync(path.join(defaultDir, 'Current Tabs')) &&
      fs.existsSync(path.join(defaultDir, 'Cookies')),
    removed,
  );
  const removedWorkerCache = clearProfileServiceWorkerCache(tempProfile);
  check(
    'forced relaunch refreshes extension worker without clearing Google session storage',
    removedWorkerCache.length === 2 &&
      !fs.existsSync(path.join(defaultDir, 'Service Worker', 'ScriptCache')) &&
      !fs.existsSync(path.join(defaultDir, 'Service Worker', 'Database')) &&
      fs.existsSync(path.join(defaultDir, 'Cookies')) &&
      fs.existsSync(path.join(defaultDir, 'Local Storage', 'leveldb-preserve')),
    removedWorkerCache,
  );
} finally {
  fs.rmSync(tempProfile, { recursive: true, force: true });
}

if (failed) {
  console.error('[flowagent-parity] FAIL');
  process.exit(1);
}
console.log('[flowagent-parity] PASS');
