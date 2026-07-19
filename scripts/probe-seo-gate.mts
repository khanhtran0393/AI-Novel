import { scoreYoutubeMetaFields } from '../src/lib/youtubeSafe.ts';

const fixtures = {
  seoTitle:
    'Sự thật sau cửa sổ kẹt: 3 tiếng gõ nửa đêm không ai dám kể… xem đến cuối',
  thumbnailLine: '3 tiếng gõ — đừng mở…',
  seoDescription:
    '3 tiếng gõ — đừng mở… ' +
    'Một đêm mưa, cửa sổ kẹt cứng từ phía trong. Hàn Dực lần theo manh mối dưới lớp sơn cũ ' +
    'và phát hiện chuỗi sự kiện không thể giải thích bằng logic thường. ' +
    'Sai một bước là mất sạch manh mối. Bí mật lộ ra từng mảnh khi khung gỗ lạnh run lên. ' +
    '📌 Chapters timeline: 0:00 cold open · 0:30 cửa sổ · 1:20 chữ trên tường. ' +
    '#truyenaudio #kinhditamly #cuasoket ' +
    'Like và đăng ký để theo dõi chương tiếp theo trước khi cửa sổ mở lại.',
  seoTags: 'truyện audio,kinh dị tâm lý,cửa sổ kẹt,đêm mưa,manh mối',
};

const scores = scoreYoutubeMetaFields(fixtures);
console.log(
  JSON.stringify(
    {
      ...fixtures,
      titleLen: fixtures.seoTitle.length,
      thumbLen: fixtures.thumbnailLine.length,
      descLen: fixtures.seoDescription.length,
      scores,
      lengthGate:
        fixtures.seoTitle.length >= 28 &&
        fixtures.seoTitle.length <= 100 &&
        fixtures.thumbnailLine.length >= 8 &&
        fixtures.thumbnailLine.length <= 30 &&
        fixtures.seoDescription.length >= 80,
    },
    null,
    2,
  ),
);
