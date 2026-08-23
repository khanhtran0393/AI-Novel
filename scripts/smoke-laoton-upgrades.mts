import { getSubtitleForceStyle } from '../src/lib/ttsBatchSrt/muxFinalVideo';
import { writeEngineRoleLine } from '../src/lib/storyWriting';
import { ingestVideoToSetupContext, cleanRawVideoTranscript } from '../src/lib/videoScriptIngest';
import { getGenrePack, GENRE_PACKS } from '../src/lib/genrePacks';

console.log('====================================================');
console.log('    SMOKE TEST: LAOTON TRANS DUB UPGRADE FEATURES   ');
console.log('====================================================');

// 1. Test Style Presets
console.log('\n[1] Testing Style Presets & Genre Packs...');
const vhPack = getGenrePack('vo_hiep');
if (!vhPack || vhPack.label !== 'Võ hiệp & Giới giang hồ') {
  throw new Error('FAIL: võ hiệp genre pack missing or invalid');
}
console.log('  - Vo Hiep Pack:', vhPack.label, '->', vhPack.description);

const roleVoHiep = writeEngineRoleLine('Võ hiệp / Giang hồ', 'writer');
if (!roleVoHiep.includes('Võ hiệp')) {
  throw new Error('FAIL: Role line missing Võ hiệp guidance');
}
console.log('  - Role Line Vo Hiep:', roleVoHiep);

// 2. Test Subtitle Styles
console.log('\n[2] Testing Subtitle Force Style Presets...');
const styleCinema = getSubtitleForceStyle('cinema');
const styleTiktok = getSubtitleForceStyle('tiktok');
const styleBilingual = getSubtitleForceStyle('bilingual');

console.log('  - Cinema Style:', styleCinema);
console.log('  - TikTok Style:', styleTiktok);
console.log('  - Bilingual Style:', styleBilingual);

if (!styleTiktok.includes('PrimaryColour=&H0000FFFF') || !styleBilingual.includes('BackColour=')) {
  throw new Error('FAIL: Subtitle force_style string missing expected color codes');
}

// 3. Test Video Script Ingestion
console.log('\n[3] Testing Video Script Ingestion & SRT Cleaner...');
const sampleSRT = `
1
00:00:01,000 --> 00:00:03,500
Chưa từng có ai dám thách thức môn phái này.

2
00:00:04,000 --> 00:00:07,200
Hôm nay, ta sẽ cho ngươi thấy thế nào là kiếm đạo chân chính!
`;

const cleaned = cleanRawVideoTranscript(sampleSRT);
console.log('  - Cleaned SRT:', cleaned);

const ingestRes = ingestVideoToSetupContext(sampleSRT);
console.log('  - Ingest Result Word Count:', ingestRes.wordCount, '| Scenes:', ingestRes.estimatedScenesCount);

if (ingestRes.wordCount < 10 || !cleaned.includes('Chưa từng có ai dám thách thức')) {
  throw new Error('FAIL: Video script ingestion output incorrect');
}

console.log('\n====================================================');
console.log('   ALL 4 UPGRADE FEATURE SMOKE TESTS PASSED 100%!   ');
console.log('====================================================');
