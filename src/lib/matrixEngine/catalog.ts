/**
 * Setup catalog — single source for 30 Chủ đề × 30 Phong cách (900 combos).
 * UI (SetupPhase) and matrix vectors share these labels (NFC exact match).
 */

export type CatalogItem = { name: string; desc: string };

/** 30 chủ đề (Theme / Topic axis) */
export const MATRIX_THEMES: readonly CatalogItem[] = [
  { name: 'Xuyên Không', desc: 'Vượt không gian & thời gian' },
  { name: 'Trùng Sinh', desc: 'Bắt đầu lại, báo thù' },
  { name: 'Hệ Thống', desc: 'Nhiệm vụ & thăng cấp' },
  { name: 'Sinh Tồn', desc: 'Sống sót khắc nghiệt' },
  { name: 'Võ Hiệp', desc: 'Ân oán giang hồ' },
  { name: 'Trinh Thám', desc: 'Phá án bí ẩn' },
  { name: 'Dị Năng', desc: 'Siêu năng lực đột biến' },
  { name: 'Linh Khí Khôi Phục', desc: 'Linh khí trỗi dậy' },
  { name: 'Kinh Dị', desc: 'Tâm linh rùng rợn' },
  { name: 'Hài Hước', desc: 'Tấu hài giải trí' },
  { name: 'Cơ Giáp / Mecha', desc: 'Robot chiến đấu' },
  { name: 'Ngôn Tình', desc: 'Tình cảm lãng mạn' },
  { name: 'Báo Thù', desc: 'Trả nợ máu, lật bàn' },
  { name: 'Phản Công', desc: 'Từ đáy vực trỗi dậy' },
  { name: 'Nông Trường', desc: 'Xây dựng, tích lũy' },
  { name: 'Thương Chiến', desc: 'Kinh doanh thôn tính' },
  { name: 'Quân Sự', desc: 'Chiến trường, binh pháp' },
  { name: 'Cung Đấu', desc: 'Hậu cung, mưu kế' },
  { name: 'Học Đường', desc: 'Thanh xuân, cạnh tranh' },
  { name: 'Thể Thao', desc: 'Đấu trường, kỷ lục' },
  { name: 'Ẩm Thực', desc: 'Nấu nướng, vị giác' },
  { name: 'Y Học', desc: 'Cứu người, y đạo' },
  { name: 'Game / Vô Hạn Lưu', desc: 'Sảnh game, ải chết' },
  { name: 'Kỳ Ảo Mạo Hiểm', desc: 'Bí cảnh, bảo vật' },
  { name: 'Thần Thoại', desc: 'Thần linh, huyền sử' },
  { name: 'Đồng Nhân', desc: 'Phóng tác IP khác' },
  { name: 'Đạo Tặc / Heist', desc: 'Cướp bóc, kế hoạch' },
  { name: 'Chính Trị', desc: 'Quyền lực, mưu sâu' },
  { name: 'Tình Báo', desc: 'Gián điệp, bí mật' },
  { name: 'Du Hành / Di Cư', desc: 'Hành trình, đất mới' },
] as const;

/** 30 phong cách (Style axis) */
export const MATRIX_STYLES: readonly CatalogItem[] = [
  { name: 'Tu Tiên / Tiên Hiệp', desc: 'Đạo quả, tiên môn' },
  { name: 'Huyền Huyễn', desc: 'Thần thú, huyết mạch' },
  { name: 'Đô Thị', desc: 'Chiến ngầm phố thị' },
  { name: 'Viễn Tưởng', desc: 'Khoa học siêu tưởng' },
  { name: 'Dystopia', desc: 'Xã hội áp chế, phản kháng' },
  { name: 'Cổ Đại', desc: 'Lịch sử, cổ kính' },
  { name: 'Cyberpunk', desc: 'Công nghệ cao' },
  { name: 'Steampunk', desc: 'Máy móc hơi nước' },
  { name: 'Hắc Ám', desc: 'Đen tối, tàn khốc' },
  { name: 'Đồng Nhân', desc: 'Phóng tác IP' },
  { name: 'Kiếm Hiệp', desc: 'Giang hồ, võ lâm' },
  { name: 'Huyền Nghi', desc: 'Bí ẩn, giải mã' },
  { name: 'Tâm Lý Tội Phạm', desc: 'Tội ác, bóng tối' },
  { name: 'Siêu Anh Hùng', desc: 'Anh hùng đô thị' },
  { name: 'Western', desc: 'Biên giới, súng' },
  { name: 'Hải Tặc', desc: 'Biển cả, kho báu' },
  { name: 'Không Gian', desc: 'Hạm đội, hành tinh' },
  { name: 'Xây Dựng Thế Giới', desc: 'Colony, society rebuild' },
  { name: 'Đông Phương Kỳ Ảo', desc: 'Yêu ma, sơn hải' },
  { name: 'Phương Tây Kỳ Ảo', desc: 'Phù thủy, rồng' },
  { name: 'LitRPG', desc: 'Level, skill, dungeon' },
  { name: 'Isekai', desc: 'Dị giới chuyển sinh' },
  { name: 'Noir', desc: 'Thám tử, u ám' },
  { name: 'Slice of Life', desc: 'Đời thường nhẹ' },
  { name: 'Epic / Sử Thi', desc: 'Vận mệnh thế giới' },
  { name: 'Gothic', desc: 'Lâu đài, u sầu' },
  { name: 'Thriller', desc: 'Căng thẳng, đuổi bắt' },
  { name: 'Military Sci-Fi', desc: 'Quân sự tương lai' },
  { name: 'Romantasy', desc: 'Lãng mạn kỳ ảo' },
  { name: 'Hard Sci-Fi', desc: 'Khoa học nghiêm' },
] as const;

export const MATRIX_THEME_COUNT = MATRIX_THEMES.length;
export const MATRIX_STYLE_COUNT = MATRIX_STYLES.length;
export const MATRIX_COMBO_COUNT = MATRIX_THEME_COUNT * MATRIX_STYLE_COUNT;

export function nfcLabel(s: string): string {
  return (s || '').normalize('NFC').trim();
}

export function normKey(s: string): string {
  return nfcLabel(s).toLowerCase().replace(/\s+/g, ' ');
}
