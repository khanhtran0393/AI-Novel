/**
 * Smoke: NAV analyzer cloud bridge + local crown prompts.
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  delete process.env.AINOVEL_NAV_ANALYZER_CLOUD;

  const crown = await import('../src/lib/commercial/ip/navAnalyzerCrown.ts');
  assert.ok(crown.STYLE_PRESETS[crown.DEFAULT_STYLE_PRESET]);
  assert.ok(crown.VEO3_SHOT_TYPES.length > 5);
  const planner = crown.buildScriptPlannerPrompt({
    scriptText: 'Hai người đối thoại trong mưa.',
    numScenes: 4,
    stylePresetDesc: crown.STYLE_PRESETS[crown.DEFAULT_STYLE_PRESET],
  });
  assert.ok(planner.includes('USER SCRIPT'));
  assert.ok(planner.includes('EXACTLY 4'));
  const sb = crown.buildStoryboardPlannerPrompt('A hero rises', 6, 'cinematic');
  assert.ok(sb.includes('EXACTLY 6'));
  console.log('PASS nav analyzer crown prompts');

  const bridge = await import('../src/lib/commercial/ip/navAnalyzerCloudBridge.ts');
  assert.equal(bridge.shouldUseCloudNavAnalyzerIp(), false);

  process.env.AINOVEL_NAV_ANALYZER_CLOUD = '1';
  assert.equal(bridge.shouldUseCloudNavAnalyzerIp(), true);
  let denied = false;
  try {
    await bridge.resolveScript2Prompt(
      {
        text: 'x',
        model: 'gemini-3.6-flash',
        apiKeys: ['fake'],
        numScenes: 2,
      },
      {},
    );
  } catch (e) {
    denied = true;
    assert.ok(String((e as Error).message).length > 5);
  }
  assert.ok(denied, 'cloud mode without token must fail');
  console.log('PASS cloud mode fail-closed without token');

  delete process.env.AINOVEL_NAV_ANALYZER_CLOUD;
  assert.equal(bridge.shouldUseCloudNavAnalyzerIp(), false);
  console.log('PASS smoke-nav-analyzer-cloud');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
