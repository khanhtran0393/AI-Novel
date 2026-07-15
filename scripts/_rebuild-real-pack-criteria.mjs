/**
 * Rebuild real legacy ship pack script through fixed builder; assert criteria.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createChannelProfile } = await import('../src/lib/channelModel.ts');
const { buildShipPack } = await import('../src/lib/shipPack.ts');
const { evaluateWordGate, countSceneTags, getWordCount } = await import(
  '../src/lib/storyWriting.ts'
);

const legacyDir = path.join(root, 'exports', 'ship-packs');
const dirs = fs.readdirSync(legacyDir).filter((d) => !d.startsWith('_'));
const packName =
  dirs.find((d) => d.includes('short_c1')) ||
  dirs.find((d) => d.toLowerCase().includes('ch')) ||
  dirs[0];
if (!packName) {
  console.error('No legacy pack found');
  process.exit(1);
}
const packDir = path.join(legacyDir, packName);
const script = fs.readFileSync(path.join(packDir, 'script.txt'), 'utf8');
const badHooks = JSON.parse(fs.readFileSync(path.join(packDir, 'seo.json'), 'utf8'));
const hookTxt = fs.existsSync(path.join(packDir, 'hook.txt'))
  ? fs.readFileSync(path.join(packDir, 'hook.txt'), 'utf8')
  : '';

const ch = createChannelProfile('Kênh chính', {
  niche: 'Truyện / Drama',
  defaultShipMode: 'short',
  narratorVoiceId: 'vi-VN-Wavenet-B',
  ttsPlatform: 'google',
  language: 'vi',
});

const words = getWordCount(script);
const tags = countSceneTags(script);
const gate = evaluateWordGate(script, 4250);
console.log('LEGACY pack:', packName);
console.log('INPUT words=', words, 'sceneTags=', tags, 'wordGateOk=', gate.wordsOk);

const pack = buildShipPack({
  channel: ch,
  mode: 'short',
  ten_tac_pham: 'Ký Ức Ăn Mòn: Bảo Tàng Hồn Phách Đô Thị',
  chapter: {
    so_chuong: 1,
    tieu_de: 'Khởi Đầu Rạn Nứt: Tiếng Vọng Từ Bức Tường Cổ',
    dan_y: '',
    noi_dung: script,
  },
  chapterHooks: {
    hook: hookTxt.split('[Thumbnail]')[0]?.trim(),
    thumbnailLine: 'Tòa nhà này có muốn bay lên…',
    seoTitle: badHooks.title,
    seoDescription: badHooks.description,
    seoTags: (badHooks.tags || []).map((t) => '#' + t).join(' '),
  },
});

const q = pack.manifest.quality;
const seo = JSON.parse(pack.files.find((f) => f.relativePath === 'seo.json').content);

const checks = {
  TITLE_LEN_OK: seo.title.length <= 100,
  THUMB_LEN_OK: (seo.thumbnailLine || '').length <= 30,
  SCENES_SANE: pack.manifest.stats.scenes >= 3 && pack.manifest.stats.scenes <= 20,
  NO_STOP_TAGS: !(seo.tags || []).some((t) => /^(muốn|trời|không|phải)$/i.test(String(t))),
  SEO_PASS: q.seo.pass || q.seo.average >= 8,
  WORD_PASS: q.wordGate.wordsOk,
  // Bad legacy hooks MUST be rewritten (not accepted as hooks_pass)
  SELF_HEAL_META_QA: q.seo.source === 'meta_qa',
  NO_LEGACY_DIALOGUE_TITLE: !/đừng bỏ lỡ:\s*cô chỉ vào/i.test(seo.title),
};

console.log('OUTPUT scenes=', pack.manifest.stats.scenes);
console.log('OUTPUT seo source=', q.seo.source, 'avg=', q.seo.average, 'pass=', q.seo.pass);
console.log('OUTPUT title=', seo.title.slice(0, 100));
console.log('OUTPUT thumb=', seo.thumbnailLine);
console.log('OUTPUT tags=', JSON.stringify(seo.tags));
console.log('OUTPUT wordGate=', JSON.stringify(q.wordGate));
console.log('OUTPUT media (expect fail without assets)=', JSON.stringify(q.media));
console.log('CHECKS', checks);

const out = path.join(legacyDir, '_real_rebuild_criteria');
fs.mkdirSync(out, { recursive: true });
for (const f of pack.files) {
  const p = path.join(out, f.relativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, f.content, 'utf8');
}
console.log('WROTE', out);

const hardFail = Object.entries(checks).filter(([, v]) => !v);
if (hardFail.length) {
  console.error('HARD FAIL', hardFail);
  process.exit(2);
}
console.log('REAL REBUILD: HARD CRITERIA PASS');
process.exit(0);
