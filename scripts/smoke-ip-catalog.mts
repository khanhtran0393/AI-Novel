/**
 * Smoke Phase C: IP catalog + strict online feature set + module loads.
 */
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  const cat = await import('../src/lib/commercial/ipCatalog.ts');
  assert.ok(Array.isArray(cat.IP_CATALOG) && cat.IP_CATALOG.length >= 6);
  const authority = cat.listIpByStatus('cloud_authority');
  assert.ok(authority.some((e) => e.id === 'license_one_path'));
  assert.ok(authority.some((e) => e.id === 'license_issue'));
  assert.ok(authority.some((e) => e.id === 'license_revoke'));
  assert.ok(authority.some((e) => e.id === 'youtube_psych'));
  assert.ok(authority.some((e) => e.id === 'seedance_formula'));
  assert.ok(cat.isStrictOnlineFeature('toolbox_labs'));
  assert.ok(cat.isStrictOnlineFeature('integrations_pipeline'));
  assert.ok(cat.isStrictOnlineFeature('gen_video'));
  assert.ok(cat.isStrictOnlineFeature('tts_premium'));
  assert.ok(cat.isStrictOnlineFeature('export_capcut'));
  assert.ok(cat.isStrictOnlineFeature('ship_pack'));
  assert.equal(cat.isStrictOnlineFeature('write_chapter' as never), false);
  console.log('PASS ip catalog', {
    total: cat.IP_CATALOG.length,
    cloud_authority: authority.length,
    strict: cat.STRICT_ONLINE_FEATURES,
  });

  const online = await import('../src/lib/commercial/onlineRevalidate.ts');
  assert.ok(online.strictOnlineGraceSec() >= 600);
  assert.equal(typeof online.enforceStrictOnlineForFeature, 'function');

  // Non-packaged: strict online no-op
  delete process.env.AI_NOVEL_PACKAGED;
  delete process.env.AINOVEL_PUBLISH;
  const req = new Request('http://local/test');
  await online.enforceStrictOnlineForFeature(req, 'toolbox_labs', {}, {
    is_pro: true,
    is_vip: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  console.log('PASS strict online no-op when not packaged');

  // entitlement assertFeatureAccess exports still callable shape
  const ent = await import('../src/lib/entitlement.ts');
  assert.equal(typeof ent.assertFeatureAccess, 'function');

  const psych = await import('../src/lib/commercial/ip/psychCloudBridge.ts');
  const local = psych.runPsychLocal('list_laws', {});
  assert.ok(local && typeof local === 'object');
  assert.equal(psych.shouldUseCloudPsychIp(), false); // not packaged in this smoke
  const picked = psych.runPsychLocal('pick_seo_title', {
    hook: 'Hắn siết chặt thanh sắt khi tường nứt. Không ai kịp hiểu chuyện gì đang xảy ra.',
    novelTitle: 'Smoke',
    opts: { seed: 7 },
  }) as { title?: string };
  assert.ok(picked && typeof picked.title === 'string' && picked.title.length >= 12);
  console.log('PASS psych cloud bridge local + pick_seo_title');

  console.log(JSON.stringify({ ok: true, smoke: 'ip-catalog' }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
