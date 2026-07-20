import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Prefer portable/embedded Python (fixed version for Nuitka .pyd),
 * then venv / Windows installs / PATH.
 *
 * Drop embed at: resources/python-runtime/python.exe (Electron extraResources).
 */
export function resolvePythonExe(): string {
  const envOverride =
    process.env.AINOVEL_PYTHON_EXE ||
    process.env.OMNIVOICE_PYTHON ||
    process.env.PYTHON_PATH ||
    process.env.PYTHON;
  if (envOverride && fs.existsSync(envOverride)) return envOverride;

  const resourcesPath =
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '';
  const cwd = process.cwd();

  const portableCandidates = [
    resourcesPath
      ? path.join(resourcesPath, 'python-runtime', 'python.exe')
      : '',
    resourcesPath ? path.join(resourcesPath, 'python', 'python.exe') : '',
    path.join(cwd, 'resources', 'python-runtime', 'python.exe'),
    path.join(cwd, 'python-runtime', 'python.exe'),
    path.join(cwd, 'python_core', 'runtime', 'python.exe'),
    path.join(cwd, 'vendor', 'python', 'python.exe'),
  ].filter(Boolean);

  for (const c of portableCandidates) {
    if (fs.existsSync(c)) return c;
  }

  const customPath = 'D:\\SuperAudioTools\\omnivoice-python\\python.exe';
  if (fs.existsSync(customPath)) return customPath;

  const venvPath = path.join(cwd, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPath)) return venvPath;

  const localAppData = process.env.LOCALAPPDATA || '';
  const userProfile = process.env.USERPROFILE || '';

  const candidates = [
    path.join(localAppData, 'Programs', 'Python', 'Python314', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(localAppData, 'Programs', 'Python', 'Python310', 'python.exe'),
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Python314', 'python.exe'),
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    'C:\\Python314\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  return 'python';
}

/**
 * Tìm kiếm ffmpeg.exe cục bộ
 */
export function findFfmpegPath(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'python_core', 'ffmpeg', 'ffmpeg.exe'),
    path.join(process.cwd(), 'python_core', 'ffmpeg', 'bin', 'ffmpeg.exe'),
    path.join(process.cwd(), 'bin', 'ffmpeg.exe'),
    'ffmpeg'
  ];
  for (const p of possiblePaths) {
    if (p === 'ffmpeg') continue;
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

/**
 * Tìm kiếm ffprobe.exe cục bộ
 */
export function findFfprobePath(): string {
  const possiblePaths = [
    path.join(process.cwd(), 'python_core', 'ffmpeg', 'ffprobe.exe'),
    path.join(process.cwd(), 'python_core', 'ffmpeg', 'bin', 'ffprobe.exe'),
    path.join(process.cwd(), 'bin', 'ffprobe.exe'),
    'ffprobe'
  ];
  for (const p of possiblePaths) {
    if (p === 'ffprobe') continue;
    if (fs.existsSync(p)) return p;
  }
  return 'ffprobe';
}

/**
 * Nén audio sang MP3 chất lượng thấp bằng FFmpeg để sẵn sàng gửi lên Cloud API
 */
export async function compressAudioToMp3(inputPath: string, outputPath: string): Promise<boolean> {
  const ffmpeg = findFfmpegPath();
  try {
    const args = [
      '-y',
      '-i', inputPath,
      '-acodec', 'libmp3lame',
      '-b:a', '48k', // Tối giản bitrate xuống 48kbps để file siêu nhẹ
      '-ar', '16000',
      '-ac', '1',
      outputPath
    ];
    await execFileAsync(ffmpeg, args, { windowsHide: true });
    return fs.existsSync(outputPath);
  } catch (err) {
    console.error('[compressAudioToMp3] Error:', err);
    return false;
  }
}

/**
 * Gemini API: Gọi Gemini API nhận diện giọng nói và sinh ra phụ đề SRT sạch
 */
export async function transcribeAudioViaGemini(audioMp3Path: string, language: string = 'vi'): Promise<string> {
  // Lấy API key từ env hoặc apikey.txt
  let apiKey = process.env.GEMINI_KEY_1 || '';
  if (!apiKey) {
    const apikeyFile = path.join(process.cwd(), 'apikey.txt');
    if (fs.existsSync(apikeyFile)) {
      const keys = fs.readFileSync(apikeyFile, 'utf8').split('\n').map(l => l.trim()).filter(l => l.startsWith('AIzaSy'));
      if (keys.length > 0) apiKey = keys[0];
    }
  }

  if (!apiKey) {
    throw new Error('Không tìm thấy API Key của Gemini để chạy Gemini online. Vui lòng cấu hình apikey.txt hoặc API Key trong Cài đặt.');
  }

  // Đọc file âm thanh dưới dạng Base64
  const audioData = fs.readFileSync(audioMp3Path).toString('base64');
  const mimeType = 'audio/mp3';

  const prompt = `
Bạn là một AI trích xuất phụ đề cực kỳ chính xác.
Nhiệm vụ: Nghe file âm thanh này và tạo ra một file phụ đề SRT tiếng Việt hoàn chỉnh.
Yêu cầu bắt buộc:
1. Định dạng xuất ra phải chuẩn cấu trúc file phụ đề SRT (mỗi segment gồm index, start --> end, và text).
2. Viết phụ đề bằng ngôn ngữ: ${language === 'vi' ? 'Tiếng Việt' : 'Tiếng Anh/Tự động'}.
3. CHỈ TRẢ VỀ mã code SRT thuần túy. KHÔNG có tag code markdown \`\`\`srt, không mô tả thêm, không giới thiệu. Chỉ xuất trực tiếp text SRT.
  `.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: audioData
            }
          }
        ]
      }
    ]
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini transcription call failed: ${errorText}`);
  }

  const result = await response.json();
  let text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  
  // Clean markdown blocks if any
  text = text.replace(/```(srt|text)?/g, '').trim();
  
  return text;
}

