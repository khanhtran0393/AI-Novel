import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

function getApiKeyPath(): string {
  const localPath = path.join(process.cwd(), 'apikey.txt');
  if (fs.existsSync(localPath)) return localPath;
  const fallbackPath = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026\\apikey.txt';
  const fallbackDir = 'C:\\Users\\Khanh\\Downloads\\tool sua\\CREATE VIDEO PRO 12052026\\CREATE VIDEO PRO 12052026';
  if (fs.existsSync(fallbackDir)) return fallbackPath;
  return localPath;
}
const APIKEY_PATH = getApiKeyPath();

// Đọc tất cả API keys từ file
function loadApiKeys(): string[] {
  try {
    if (fs.existsSync(APIKEY_PATH)) {
      const content = fs.readFileSync(APIKEY_PATH, 'utf8');
      return content.split('\n').map(l => l.trim()).filter(l => l.startsWith('AIzaSy'));
    }
  } catch {}
  return [];
}

// Các model Veo để thử (từ mới nhất đến cũ)
const VEO_MODELS = [
  'veo-3.0-generate-preview',
  'veo-2.0-generate-001',
  'gemini-2.5-flash-preview-video',
];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { chapterNum, sceneIndex, promptIndex, prompt, drivePath, duration, model } = body;

    if (chapterNum === undefined || sceneIndex === undefined) {
      return NextResponse.json({ error: 'Thiếu thông tin chương hoặc phân cảnh.' }, { status: 400 });
    }

    const promptText = prompt || 'Beautiful cinematic shot';
    const videoDuration = duration || 5;
    const filename = `chapter_${chapterNum}_scene_${sceneIndex}_animatic.mp4`;

    console.log(`[Video API] Bắt đầu sinh video cho Cảnh ${sceneIndex} | Prompt: "${promptText.substring(0, 80)}..." | Duration: ${videoDuration}s`);

    // Tạo thư mục video
    const publicVideoDir = path.join(process.cwd(), 'public', 'video');
    if (!fs.existsSync(publicVideoDir)) fs.mkdirSync(publicVideoDir, { recursive: true });
    const localSavePath = path.join(publicVideoDir, filename);

    // Đọc API keys
    const apiKeys = loadApiKeys();
    if (apiKeys.length === 0) {
      console.log('[Video API] Không tìm thấy API key. Chuyển sang mock.');
      return createMockResponse(localSavePath, filename, videoDuration, drivePath, chapterNum);
    }

    // Thử từng key + model để sinh video
    let lastError = '';
    for (let ki = 0; ki < apiKeys.length; ki++) {
      const key = apiKeys[ki];
      for (const veoModel of VEO_MODELS) {
        console.log(`[Video API] [Key ${ki+1}/${apiKeys.length}] [Model: ${veoModel}] Đang gửi request...`);

        try {
          // Bước 1: Gửi request tạo video (async operation)
          const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${veoModel}:generateContent?key=${key}`;
          
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const requestBody: any = {
            contents: [{
              role: 'user',
              parts: [{ text: `Generate a video: ${promptText}` }]
            }],
            generationConfig: {
              responseModalities: ['VIDEO', 'TEXT'],
              ...(videoDuration && { videoDuration: `${videoDuration}s` }),
            },
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          };

          const resp = await fetch(generateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(120000) // 2 phút timeout
          });

          if (!resp.ok) {
            const errText = await resp.text();
            let errMsg = '';
            try { errMsg = JSON.parse(errText)?.error?.message || errText; } catch { errMsg = errText; }
            console.log(`[Video API] Key ${ki+1} / ${veoModel} failed (${resp.status}): ${errMsg.substring(0, 150)}`);
            lastError = errMsg;
            
            if (resp.status === 429 || resp.status === 400) continue; // Thử key/model tiếp
            if (resp.status === 404) continue; // Model không tồn tại, thử model tiếp
            continue;
          }

          const data = await resp.json();
          console.log(`[Video API] Response received from ${veoModel}`);

          // Kiểm tra nếu là long-running operation (Veo thường trả operation)
          if (data.name && data.name.includes('operations/')) {
            console.log(`[Video API] Long-running operation: ${data.name}`);
            // Poll operation status
            const videoData = await pollOperation(data.name, key, 120000);
            if (videoData) {
              fs.writeFileSync(localSavePath, videoData);
              console.log(`[Video API] ✅ Video saved: ${localSavePath}`);
              return createSuccessResponse(localSavePath, filename, videoDuration, drivePath, chapterNum, veoModel);
            }
          }

          // Kiểm tra response trực tiếp (generateContent style)
          if (data.candidates) {
            for (const candidate of data.candidates) {
              if (candidate.content?.parts) {
                for (const part of candidate.content.parts) {
                  if (part.inlineData?.mimeType?.startsWith('video/')) {
                    const videoBuffer = Buffer.from(part.inlineData.data, 'base64');
                    fs.writeFileSync(localSavePath, videoBuffer);
                    console.log(`[Video API] ✅ Video saved (inline): ${localSavePath} (${videoBuffer.length} bytes)`);
                    return createSuccessResponse(localSavePath, filename, videoDuration, drivePath, chapterNum, veoModel);
                  }
                  if (part.fileData?.fileUri) {
                    // Download video from fileUri
                    const videoResp = await fetch(part.fileData.fileUri);
                    if (videoResp.ok) {
                      const videoBuffer = Buffer.from(await videoResp.arrayBuffer());
                      fs.writeFileSync(localSavePath, videoBuffer);
                      console.log(`[Video API] ✅ Video saved (fileUri): ${localSavePath} (${videoBuffer.length} bytes)`);
                      return createSuccessResponse(localSavePath, filename, videoDuration, drivePath, chapterNum, veoModel);
                    }
                  }
                }
              }
            }
            // Nếu có candidates nhưng không có video
            console.log(`[Video API] Response có candidates nhưng không có video data. Model có thể không hỗ trợ video.`);
            continue;
          }

          // Nếu response không có gì hữu ích
          console.log(`[Video API] Response không chứa video: ${JSON.stringify(data).substring(0, 300)}`);
          continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (fetchErr: any) {
          console.log(`[Video API] Lỗi fetch: ${fetchErr.message}`);
          lastError = fetchErr.message;
          continue;
        }
      }
    }

    // Tất cả đều thất bại → fallback mock
    console.log(`[Video API] Tất cả keys/models đều thất bại. Lỗi cuối: ${lastError}. Chuyển sang mock.`);
    return createMockResponse(localSavePath, filename, videoDuration, drivePath, chapterNum);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi API Generate Video:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi xảy ra trong quá trình sinh video.' },
      { status: 500 }
    );
  }
}

// Poll long-running operation
async function pollOperation(operationName: string, apiKey: string, timeoutMs: number): Promise<Buffer | null> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 giây

  while (Date.now() - startTime < timeoutMs) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (data.done) {
        console.log(`[Video API] Operation hoàn tất!`);
        if (data.response?.candidates) {
          for (const candidate of data.response.candidates) {
            for (const part of candidate.content?.parts || []) {
              if (part.inlineData?.data) {
                return Buffer.from(part.inlineData.data, 'base64');
              }
              if (part.fileData?.fileUri) {
                const videoResp = await fetch(part.fileData.fileUri);
                if (videoResp.ok) {
                  return Buffer.from(await videoResp.arrayBuffer());
                }
              }
            }
          }
        }
        return null;
      }

      console.log(`[Video API] Operation đang chạy... (${Math.round((Date.now() - startTime)/1000)}s)`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      console.log(`[Video API] Poll error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, pollInterval));
  }

  console.log(`[Video API] Operation timeout sau ${timeoutMs/1000}s`);
  return null;
}

// Tạo response thành công
function createSuccessResponse(localSavePath: string, filename: string, duration: number, drivePath: string, chapterNum: number, method: string) {
  // Lưu vào Drive nếu có
  let driveSaved = false;
  let driveFilePath = '';
  if (drivePath && drivePath.trim().length > 0) {
    try {
      const driveFolder = path.join(drivePath.trim(), `Chương ${chapterNum}`);
      if (!fs.existsSync(driveFolder)) fs.mkdirSync(driveFolder, { recursive: true });
      driveFilePath = path.join(driveFolder, filename);
      fs.copyFileSync(localSavePath, driveFilePath);
      driveSaved = true;
    } catch {}
  }

  return NextResponse.json({
    success: true,
    videoPath: `/video/${filename}`,
    driveSaved,
    driveFilePath,
    filename,
    duration,
    method
  });
}

// Tạo mock video response
function createMockResponse(localSavePath: string, filename: string, duration: number, drivePath: string, chapterNum: number) {
  // Tạo file MP4 giả (tiny valid MP4)
  const publicVideoDir = path.dirname(localSavePath);
  const dummyVideoPath = path.join(publicVideoDir, 'scene1.mp4');
  
  if (fs.existsSync(dummyVideoPath)) {
    fs.copyFileSync(dummyVideoPath, localSavePath);
  } else {
    // Tạo MP4 tối thiểu
    const minMp4 = Buffer.from([
      0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70, // ftyp box
      0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00,
      0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32,
      0x6D, 0x70, 0x34, 0x31,
      0x00, 0x00, 0x00, 0x08, 0x6D, 0x6F, 0x6F, 0x76, // moov box (empty)
    ]);
    fs.writeFileSync(localSavePath, minMp4);
  }

  // Lưu vào Drive nếu có
  let driveSaved = false;
  let driveFilePath = '';
  if (drivePath && drivePath.trim().length > 0) {
    try {
      const driveFolder = path.join(drivePath.trim(), `Chương ${chapterNum}`);
      if (!fs.existsSync(driveFolder)) fs.mkdirSync(driveFolder, { recursive: true });
      driveFilePath = path.join(driveFolder, filename);
      fs.copyFileSync(localSavePath, driveFilePath);
      driveSaved = true;
    } catch {}
  }

  return NextResponse.json({
    success: true,
    videoPath: `/video/${filename}`,
    driveSaved,
    driveFilePath,
    filename,
    duration,
    method: 'Mock (API keys expired/unavailable)'
  });
}
