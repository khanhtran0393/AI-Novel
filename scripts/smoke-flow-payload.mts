import {
  FACE_LOCK_SYSTEM_PROMPT,
  injectFaceLockPrompt,
} from '../src/lib/flow-bridge/promptInjector';
import { buildImageGenerateBody } from '../src/lib/flow-bridge/payloadBuilder';

const raw = 'Hàn Dực đứng trong mưa acid, áo rách.';
const locked = injectFaceLockPrompt(raw, {
  hasReference: true,
  mediaId: 'media_abc',
});

if (!locked.includes(FACE_LOCK_SYSTEM_PROMPT)) {
  console.error('FAIL: face-lock missing');
  process.exit(1);
}
if (!locked.includes(raw)) {
  console.error('FAIL: user prompt lost');
  process.exit(1);
}

const body = buildImageGenerateBody({
  projectId: 'proj-test',
  prompt: raw,
  aspectRatio: '16:9',
  imageCount: 1,
  imageMediaIds: ['media_abc'],
  faceLock: true,
});

const req0 = (body.body.requests as Record<string, unknown>[])[0];
const p = String(req0.prompt || '');
if (!p.includes(FACE_LOCK_SYSTEM_PROMPT)) {
  console.error('FAIL: payload prompt no face-lock');
  process.exit(1);
}
if (!body.captchaAction || body.captchaAction !== 'IMAGE_GENERATION') {
  console.error('FAIL: captchaAction');
  process.exit(1);
}
const ctx = body.body.clientContext as { recaptchaContext?: { token?: string } };
if (!ctx?.recaptchaContext || ctx.recaptchaContext.token === undefined) {
  console.error('FAIL: recaptchaContext placeholder missing');
  process.exit(1);
}

console.log('[smoke-payload] PASS face-lock + clientContext + captchaAction');
console.log('  prompt bytes', p.length);
console.log('  url', body.url.slice(0, 80) + '…');
process.exit(0);
