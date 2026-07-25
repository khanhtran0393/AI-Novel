/**
 * Smoke: character bible structure for gen prompt / sheet image.
 * Verifies profile fields + composeCharacterReferenceSheetPrompt layout
 * (8 expressions, 7 poses, height, tools, style from Setup — not sample styles).
 */
import {
  CHAR_EMOTIONS,
  CHAR_POSES,
  composeCharacterReferenceSheetPrompt,
  composePosePrompt,
  emptyNhanVatProfile,
  getCharacterProfileSetupStatus,
  normalizeNhanVatProfile,
} from '../src/lib/characterProfile.ts';

const p = normalizeNhanVatProfile({
  ...emptyNhanVatProfile(),
  gioi_tinh: 'Nữ',
  tuoi: '24',
  dang_nguoi: 'cao thanh mảnh',
  chieu_cao: '168 cm',
  vai_tro: 'Nhân vật chính',
  quan_ao: 'lab coat rách + tech jumpsuit',
  phu_kien: 'atomic orb, belt pack, tablet nứt',
  so_thich: 'lab ban đêm',
  thoi_quen: 'soi dụng cụ, đi qua lại khi nghĩ',
  dong_co: 'tìm sự thật',
  giong_thoai: 'cộc, câu ngắn',
  tts_voice: 'vi-VN-HoaiMyNeural',
  ngoai_hinh: 'tóc đen, mắt nâu, vết nứt sáng má',
  dac_diem_nhan_dang: 'circuit cracks on cheeks',
  khuet_tat: 'workaholic, cô đơn',
  mau_sac: 'Lab White #F0F0F0; Glow Cyan #CFFFFF',
  prompt: 'young woman scientist identity lock portrait',
});

const sheet = composeCharacterReferenceSheetPrompt(p, 'AIRA', {
  styleHint: 'semi-realistic digital painting game concept art',
  genre: 'khoa học viễn tưởng / cyber noir',
});

const checks: Array<[string, boolean]> = [
  ['EXPRESSIONS exactly 8', /exactly 8 headshot/i.test(sheet)],
  ['8 emotion keys listed', CHAR_EMOTIONS.every((e) => sheet.includes(e))],
  ['7 action poses', /exactly 7 full-body poses/i.test(sheet)],
  ['7 pose keys listed', CHAR_POSES.every((x) => sheet.includes(x))],
  ['height in sheet', sheet.includes('168 cm')],
  ['signature tools', sheet.includes('atomic orb')],
  ['style from Setup', sheet.includes('semi-realistic digital painting')],
  ['anti beach sample style', sheet.includes('do NOT invent beach-kid')],
  ['turnaround min 6', /minimum 6 angles/i.test(sheet)],
  ['color palette section', sheet.includes('COLOR PALETTE')],
  ['accessories section', sheet.includes('ACCESSORIES')],
  ['height reference bar', /height bar/i.test(sheet)],
];

const pose = composePosePrompt(p, 'holding_prop');
checks.push([
  'pose includes tools lock',
  pose.includes('atomic orb') || pose.includes('Signature props'),
]);

const status = getCharacterProfileSetupStatus(p, { hasReferenceImage: true });
checks.push(['setup complete with new fields', status.complete === true]);
checks.push(['no missing fields', status.missing.length === 0]);

// Incomplete without chieu_cao/phu_kien/mau_sac should flag missing
const incomplete = getCharacterProfileSetupStatus(
  normalizeNhanVatProfile({
    ...p,
    chieu_cao: '',
    phu_kien: '',
    mau_sac: '',
  }),
  { hasReferenceImage: true },
);
checks.push([
  'missing flags chieu_cao/phu_kien/mau_sac',
  incomplete.missing.some((m) => /chiều cao/i.test(m)) &&
    incomplete.missing.some((m) => /phụ kiện/i.test(m)) &&
    incomplete.missing.some((m) => /màu/i.test(m)),
]);

let fail = 0;
for (const [name, ok] of checks) {
  // eslint-disable-next-line no-console
  console.log(ok ? 'PASS' : 'FAIL', '·', name);
  if (!ok) fail += 1;
}
// eslint-disable-next-line no-console
console.log(`[smoke-character-bible-sheet] sheet_len=${sheet.length} fail=${fail}`);
if (fail > 0) process.exit(1);
// eslint-disable-next-line no-console
console.log('[smoke-character-bible-sheet] OK');
