import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function getApiKeyPath(): string {
  return path.join(process.cwd(), 'apikey.txt');
}
const APIKEY_PATH = getApiKeyPath();

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, newKey } = body;

    if (action === 'add-key' && newKey) {
      // Thêm key mới vào file apikey.txt
      const trimmedKey = newKey.trim();
      if (!trimmedKey.startsWith('AIzaSy')) {
        return NextResponse.json({ error: 'API Key không hợp lệ. Key phải bắt đầu bằng AIzaSy...' }, { status: 400 });
      }

      let existing = '';
      if (fs.existsSync(APIKEY_PATH)) {
        existing = fs.readFileSync(APIKEY_PATH, 'utf8');
      }

      // Kiểm tra trùng lặp
      const existingKeys = existing.split('\n').map(l => l.trim()).filter(Boolean);
      if (existingKeys.includes(trimmedKey)) {
        return NextResponse.json({ error: 'Key này đã tồn tại trong file.' }, { status: 400 });
      }

      // Thêm key mới
      existingKeys.push(trimmedKey);
      fs.writeFileSync(APIKEY_PATH, existingKeys.join('\n') + '\n', 'utf8');

      console.log(`[API Key Manager] ✅ Đã thêm key mới: ${trimmedKey.substring(0, 15)}...`);
      return NextResponse.json({ success: true, totalKeys: existingKeys.length });
    }

    if (action === 'list') {
      // Liệt kê các key hiện có (ẩn bớt)
      if (!fs.existsSync(APIKEY_PATH)) {
        return NextResponse.json({ keys: [], totalKeys: 0 });
      }
      const content = fs.readFileSync(APIKEY_PATH, 'utf8');
      const keys = content.split('\n').map(l => l.trim()).filter(l => l.startsWith('AIzaSy'));
      const maskedKeys = keys.map(k => k.substring(0, 15) + '...' + k.substring(k.length - 4));
      return NextResponse.json({ keys: maskedKeys, totalKeys: keys.length });
    }

    if (action === 'open-aistudio') {
      // Mở Google AI Studio trong trình duyệt mặc định
      exec('start https://aistudio.google.com/apikey');
      return NextResponse.json({ success: true, message: 'Đã mở Google AI Studio. Hãy tạo API Key mới và dán vào ô bên dưới.' });
    }

    return NextResponse.json({ error: 'Action không hợp lệ. Dùng: add-key, list, open-aistudio' }, { status: 400 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
