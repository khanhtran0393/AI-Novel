/**
 * Smoke: Bypass + Translate cloud bridges (local path + fail-closed cloud).
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  delete process.env.AINOVEL_BYPASS_CLOUD;
  delete process.env.AINOVEL_TRANSLATE_CLOUD;

  const bypass = await import('../src/lib/commercial/ip/bypassCloudBridge.ts');
  assert.equal(bypass.shouldUseCloudBypassIp(), false);

  const local = bypass.compileBypassCrownLocal({
    filters: ['ultimate'],
    meta: {
      width: 1280,
      height: 720,
      fps: 30,
      duration: 5,
      hasAudio: true,
      frameCount: 150,
    },
    turbo: false,
    useOverlay: false,
  });
  assert.ok(local.fcParts.length > 0 || local.graph.videoFragments.length > 0);
  assert.ok(local.graph.params.gop > 0);
  console.log('PASS local bypass compile', {
    frags: local.graph.videoFragments.length,
    fc: local.fcParts.length,
  });

  process.env.AINOVEL_BYPASS_CLOUD = '1';
  assert.equal(bypass.shouldUseCloudBypassIp(), true);
  let denied = false;
  try {
    await bypass.resolveBypassCompile(
      {
        filters: ['ultimate'],
        meta: {
          width: 640,
          height: 360,
          fps: 24,
          duration: 2,
          hasAudio: false,
          frameCount: 48,
        },
      },
      {},
    );
  } catch {
    denied = true;
  }
  assert.ok(denied, 'bypass cloud without token must fail');
  console.log('PASS bypass cloud fail-closed');

  delete process.env.AINOVEL_BYPASS_CLOUD;

  const tr = await import('../src/lib/commercial/ip/translateCloudBridge.ts');
  assert.equal(tr.shouldUseCloudTranslateIp(), false);
  const prompt = tr.buildTranslatePromptLocal({
    langName: 'Tiếng Việt',
    ruleId: 'xianxia',
    texts: ['a', 'b'],
  });
  assert.ok(prompt.prompt.includes('Tiếng Việt'));
  assert.ok(prompt.ruleDesc.length > 10);
  console.log('PASS local translate prompt');

  process.env.AINOVEL_TRANSLATE_CLOUD = '1';
  assert.equal(tr.shouldUseCloudTranslateIp(), true);
  denied = false;
  try {
    await tr.resolveTranslateBatchPrompt(
      { langName: 'en', ruleId: 'modern', texts: ['x'] },
      {},
    );
  } catch {
    denied = true;
  }
  assert.ok(denied, 'translate cloud without token must fail');
  console.log('PASS translate cloud fail-closed');

  // toolbox_labs already in STRICT_ONLINE
  const cat = await import('../src/lib/commercial/ipCatalog.ts');
  assert.ok(cat.isStrictOnlineFeature('toolbox_labs'));
  console.log('PASS toolbox_labs strict online listed');

  console.log(JSON.stringify({ ok: true, smoke: 'toolbox-cloud-ip' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
