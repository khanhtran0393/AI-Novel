/**
 * GENERATE_OUTLINE youtube rewrite only (after captions+plot verified).
 * Retries once on 429.
 *   GEMINI_API_KEY=... npx tsx scripts/smoke-youtube-outline-only.mts
 */
const BASE = process.env.AINOVEL_SMOKE_BASE || 'http://127.0.0.1:3000';
const key = process.env.GEMINI_API_KEY || process.env.GEMINI_KEY_1 || '';
if (!key || key.length < 10) {
  console.error('[FAIL] missing GEMINI_API_KEY');
  process.exit(2);
}

const mo_ta =
  'Trong lòng siêu đô thị Zenith, nhân vật chính bị đánh dấu ngoại lệ dữ liệu sau hành động nhỏ. ' +
  'Xung đột: hệ thống tối ưu hóa đô thị đẩy anh ra khỏi mạng xã hội. Ba hồi: mở / leo thang / cao trào tìm cách xóa dấu vết.';

async function once() {
  const res = await fetch(`${BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_OUTLINE',
      apiKeys: [key],
      model: 'gemini',
      payload: {
        chu_de: 'Viết lại từ YouTube',
        phong_cach: 'Trùng ý tưởng mẫu ~80%',
        mo_ta,
        so_chuong: 2,
        so_tu_chuong: 1200,
        ngon_ngu: 'Tiếng Việt',
        youtube_rewrite: true,
        similarity_target: 80,
        youtube_title: 'Me at the zoo',
        youtube_captions_excerpt:
          'All right, so here we are, in front of the elephants the cool thing about these guys is that they have really long trunks',
        rewrite_source_kind: 'youtube',
        scriptMode: 'chuyen_sau',
      },
    }),
  });
  const j = (await res.json()) as {
    tieu_de?: string;
    dan_y_tong_the?: string;
    danh_sach_chuong?: Array<{ so_chuong?: number; tieu_de?: string; dan_y?: string }>;
    error?: string;
  };
  return { res, j };
}

let { res, j } = await once();
if (res.status === 429) {
  console.warn('[WAIT] 429 — sleep 35s and retry');
  await new Promise((r) => setTimeout(r, 35_000));
  ({ res, j } = await once());
}

console.log(
  JSON.stringify(
    {
      status: res.status,
      error: j.error || null,
      title: j.tieu_de?.slice(0, 80) || null,
      chapters: Array.isArray(j.danh_sach_chuong) ? j.danh_sach_chuong.length : 0,
      outlineLen: j.dan_y_tong_the?.length || 0,
      ch1: j.danh_sach_chuong?.[0]
        ? {
            so: j.danh_sach_chuong[0].so_chuong,
            title: String(j.danh_sach_chuong[0].tieu_de || '').slice(0, 40),
            dan_y_len: String(j.danh_sach_chuong[0].dan_y || '').length,
          }
        : null,
    },
    null,
    2,
  ),
);

if (
  !res.ok ||
  !j.tieu_de ||
  !j.dan_y_tong_the ||
  !Array.isArray(j.danh_sach_chuong) ||
  j.danh_sach_chuong.length !== 2
) {
  console.error('[smoke-youtube-outline-only] FAIL');
  process.exit(1);
}
console.log('[smoke-youtube-outline-only] PASS');
