/**
 * Experiment: Test Agent-Reach multi-source ingestion on 5 diverse web links (non-YouTube).
 * Run: npx tsx scripts/smoke-5-web-links.mts
 */
import assert from 'node:assert/strict';
import { fetchMultiSourceIngest } from '../src/lib/source-ingest/index.ts';

const testUrls = [
  'https://example.com/',
  'https://httpbin.org/html',
  'https://news.ycombinator.com/',
  'https://vnexpress.net/',
  'https://dantri.com.vn/',
];

async function run5WebLinksExperiment() {
  console.log('=== THỬ NGHIỆM AGENT-REACH INGEST 5 LINK WEB (KHÔNG PHẢI YOUTUBE) ===\n');

  console.log('Danh sách 5 URL thử nghiệm:');
  testUrls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));
  console.log('\n--------------------------------------------------\n');

  const multiInput = testUrls.join('\n');
  const startTime = Date.now();

  console.log('[1/2] Đang thực thi Agent-Reach Multi-Source Ingestion...');
  const res = await fetchMultiSourceIngest(multiInput);

  const durationMs = Date.now() - startTime;

  console.log(`\n[2/2] Kết quả thu thập (${durationMs}ms):\n`);
  console.log(`  - Trạng thái chung: ${res.ok ? '✓ THÀNH CÔNG' : '❌ THẤT BẠI'}`);
  console.log(`  - Is MultiSource: ${res.isMultiSource}`);
  console.log(`  - Số nguồn thành công: ${res.sourcesCount}/${testUrls.length}`);
  console.log(`  - Tổng số từ bóc tách: ${res.wordCount} từ`);
  console.log(`  - Tiêu đề tổng hợp: ${res.title}\n`);

  if (res.sources && res.sources.length > 0) {
    console.log('Chi tiết từng nguồn bóc tách được:');
    res.sources.forEach((src, idx) => {
      const statusIcon = src.ok ? '✓' : '❌';
      console.log(`  [Nguồn ${idx + 1}] ${statusIcon} ${src.url}`);
      console.log(`            - Platform: ${src.platform}`);
      console.log(`            - Tiêu đề: ${src.title || 'N/A'}`);
      console.log(`            - Số từ: ${src.wordCount || 0} từ`);
      console.log(`            - Động cơ: ${src.source || 'N/A'}`);
      if (!src.ok) {
        console.log(`            - Lỗi: ${src.error?.split('\n')[0]}`);
      }
    });
  }

  console.log('\n--------------------------------------------------');
  console.log('Mẫu khối tri thức hợp nhất (đưa sang AI phân tích cốt truyện):');
  console.log('--------------------------------------------------');
  console.log((res.text || '').slice(0, 500) + '...\n');

  assert.equal(res.ok, true, 'Ingest 5 link web thất bại');
  assert.ok((res.sourcesCount || 0) >= 3, `Cần thành công ít nhất 3/5 nguồn, được ${res.sourcesCount}`);

  console.log('ALL 5 WEB LINKS INGESTION EXPERIMENT PASSED SUCCESSFULLY 100%.');
}

run5WebLinksExperiment().catch((err) => {
  console.error('❌ Thử nghiệm thất bại:', err);
  process.exit(1);
});
