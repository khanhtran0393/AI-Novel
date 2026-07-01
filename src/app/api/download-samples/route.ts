import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

const VOICE_PREVIEWS = [
  {
    id: 'puck',
    text: 'Xin chào, đây là mẫu giọng đọc Puck. Một giọng nam đĩnh đạc, trầm ấm và sắc nét từ hệ thống Google AI Studio.',
    tl: 'vi'
  },
  {
    id: 'charon',
    text: 'Chào bạn, đây là mẫu giọng đọc Charon. Giọng nam trầm buồn, mộc mạc và chậm rãi từ Google AI Studio.',
    tl: 'vi'
  },
  {
    id: 'kore',
    text: 'Chào bạn, mình là Kore. Một giọng nữ thanh tao, trong sáng, tràn đầy năng lượng từ Google AI Studio.',
    tl: 'vi'
  },
  {
    id: 'fenrir',
    text: 'Xin chào, đây là mẫu giọng đọc Fenrir. Giọng nam trầm hùng, mạnh mẽ và đầy sự bí ẩn từ Google AI Studio.',
    tl: 'vi'
  },
  {
    id: 'aoede',
    text: 'Chào bạn, mình là Aoede. Giọng nữ dịu dàng, quyến rũ, ma mị và đầy cảm xúc từ Google AI Studio.',
    tl: 'vi'
  }
];

async function generateSampleAudio(text: string, tl: string): Promise<Buffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${tl}&client=tw-ob&q=${encodeURIComponent(text)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch preview from Translate TTS: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST() {
  try {
    const samplesDir = path.join(process.cwd(), 'public', 'audio', 'samples');
    if (!fs.existsSync(samplesDir)) {
      fs.mkdirSync(samplesDir, { recursive: true });
    }

    const results = [];

    for (const preview of VOICE_PREVIEWS) {
      const filename = `${preview.id}.mp3`;
      const savePath = path.join(samplesDir, filename);

      // Nếu tệp đã tồn tại, bỏ qua không tải lại để tiết kiệm băng thông
      if (fs.existsSync(savePath)) {
        results.push({ id: preview.id, status: 'exists', path: `/audio/samples/${filename}` });
        continue;
      }

      console.log(`[Samples Downloader] Đang tải mẫu giọng đọc: ${preview.id}...`);
      const buffer = await generateSampleAudio(preview.text, preview.tl);
      fs.writeFileSync(savePath, buffer);
      
      results.push({ id: preview.id, status: 'downloaded', path: `/audio/samples/${filename}` });
    }

    return NextResponse.json({
      success: true,
      message: 'Đã đồng bộ hóa toàn bộ các mẫu giọng đọc AI Studio về máy cục bộ!',
      results
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi khi tải trước các mẫu giọng đọc:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi xảy ra trong quá trình đồng bộ các mẫu giọng đọc.' },
      { status: 500 }
    );
  }
}
