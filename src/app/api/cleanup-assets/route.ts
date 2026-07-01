import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { drivePath } = body;

    const publicAudioDir = path.join(process.cwd(), 'public', 'audio');
    const publicImageDir = path.join(process.cwd(), 'public', 'images');
    const scratchDir = path.join(process.cwd(), 'scratch');

    let deletedCount = 0;

    // 1. Dọn dẹp thư mục âm thanh cục bộ
    if (fs.existsSync(publicAudioDir)) {
      const audioFiles = fs.readdirSync(publicAudioDir);
      for (const file of audioFiles) {
        if (file !== '.gitkeep') {
          const filePath = path.join(publicAudioDir, file);
          try {
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (e) {
            console.error(`Lỗi khi xóa file audio ${file}:`, e);
          }
        }
      }
    }

    // 2. Dọn dẹp thư mục ảnh cục bộ
    if (fs.existsSync(publicImageDir)) {
      const imageFiles = fs.readdirSync(publicImageDir);
      for (const file of imageFiles) {
        if (file !== '.gitkeep') {
          const filePath = path.join(publicImageDir, file);
          try {
            if (fs.statSync(filePath).isFile()) {
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (e) {
            console.error(`Lỗi khi xóa file ảnh ${file}:`, e);
          }
        }
      }
    }

    // 3. Dọn dẹp các thư mục chrome scratch profiles cũ để giải phóng dung lượng
    if (fs.existsSync(scratchDir)) {
      const scratchFiles = fs.readdirSync(scratchDir);
      for (const file of scratchFiles) {
        const filePath = path.join(scratchDir, file);
        try {
          if (fs.statSync(filePath).isDirectory() && file.startsWith('chrome-whisk-thread-')) {
            fs.rmSync(filePath, { recursive: true, force: true });
            deletedCount++;
          }
        } catch (e) {
          console.error(`Lỗi khi xóa thư mục cache ${file}:`, e);
        }
      }
    }

    console.log(`[Asset Cleaner] Đã dọn dẹp thành công ${deletedCount} tệp và thư mục kịch bản cũ.`);

    return NextResponse.json({
      success: true,
      message: `Đã dọn dẹp thành công ${deletedCount} tệp tin và bộ nhớ đệm liên quan đến kịch bản cũ để bắt đầu dự án mới!`,
      deletedCount
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi khi dọn dẹp tài nguyên cũ:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi xảy ra khi dọn dẹp tài nguyên.' },
      { status: 500 }
    );
  }
}
