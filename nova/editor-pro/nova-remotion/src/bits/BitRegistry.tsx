// ══ KHO BIT ĐANG RỖNG — xoá sạch 2026-08-20 theo yêu cầu ══════════════════
// Bản cũ bê từ dự án "videoshuffle" (MIT) — đã gỡ toàn bộ, kèm thư mục
// components/ và design-system.ts. Bản sao lưu nằm ở _backup-hieu-ung-*/.
//
// Thêm bit mới theo khuôn:
//   import MyBit from './components/MyBit';
//   export const BIT_REGISTRY = { [TEN]: { id: TEN, component: MyBit, defaultProps: {} } };
//   (đặt TEN = chuỗi id của bit — KHÔNG viết id dạng chuỗi thẳng trong comment,
//    vì IPC nova:sceneBits quét file bằng regex và sẽ đếm nhầm ví dụ thành bit thật)
//
// NovaScene.js tra cứu bằng L.bit rồi dựng def.component với def.defaultProps
// trộn L.props. Tên không có trong kho → engine vẽ ô cảnh báo, không crash.
// ⚠️ Sửa file này xong phải chạy lại `node editor-pro/nova-remotion/build.js`,
//    vì phần xuất video và khung xem trước iframe dùng bundle/ đã build sẵn.

export const BIT_REGISTRY: Record<string, any> = {};

export default BIT_REGISTRY;
