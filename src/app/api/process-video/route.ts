import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import util from 'util';

const execPromise = util.promisify(exec);

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { videoFiles, audioFile, outputName } = body;

    if (!videoFiles || !Array.isArray(videoFiles) || videoFiles.length === 0) {
      return NextResponse.json({ error: 'Thiếu danh sách các file video cần ghép.' }, { status: 400 });
    }

    const publicVideoDir = path.join(process.cwd(), 'public', 'video');
    const outputPath = path.join(publicVideoDir, outputName || 'final_rendered_output.mp4');

    // 1. Tạo file danh sách (list.txt) cho FFmpeg concat demuxer
    const listFilePath = path.join(publicVideoDir, 'concat_list.txt');
    const listContent = videoFiles.map(file => `file '${path.basename(file)}'`).join('\n');
    fs.writeFileSync(listFilePath, listContent);

    // 2. Chạy lệnh FFmpeg để ghép nối và lồng tiếng
    console.log(`[FFmpeg Service] Bắt đầu xử lý video. Output: ${outputPath}`);
    
    let ffmpegCommand = '';
    
    if (audioFile && fs.existsSync(path.join(process.cwd(), 'public', audioFile))) {
      // Ghép video và lồng audio
      const audioFullPath = path.join(process.cwd(), 'public', audioFile);
      ffmpegCommand = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -i "${audioFullPath}" -c:v copy -c:a aac -shortest "${outputPath}"`;
    } else {
      // Chỉ ghép video
      ffmpegCommand = `ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputPath}"`;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stdout, stderr } = await execPromise(ffmpegCommand);
      console.log(`[FFmpeg] Thành công. Output: ${outputPath}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (ffmpegErr: any) {
      console.error('[FFmpeg] Lỗi khi chạy lệnh:', ffmpegErr);
      // Tra ve loi that khi FFmpeg khong co trong PATH.
      if (ffmpegErr.message && ffmpegErr.message.includes('not recognized')) {
         return NextResponse.json({ 
           error: 'Không tìm thấy phần mềm FFmpeg trên hệ thống. Vui lòng cài đặt FFmpeg và thêm vào biến môi trường PATH.',
           details: ffmpegErr.message 
         }, { status: 500 });
      }
      throw ffmpegErr;
    }

    // Xoá file trung gian
    if (fs.existsSync(listFilePath)) {
      fs.unlinkSync(listFilePath);
    }

    return NextResponse.json({
      success: true,
      videoPath: `/video/${path.basename(outputPath)}`,
      message: 'Xử lý video hoàn tất thành công.'
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi API Process Video:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi xảy ra trong quá trình gọi FFmpeg.' },
      { status: 500 }
    );
  }
}
