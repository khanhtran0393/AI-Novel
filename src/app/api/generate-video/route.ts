import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { localVideoFilename } from '@/contracts';
import { BrowserAgent } from '@/lib/agents/BrowserAgent';
import { assertProAccess } from '@/lib/entitlement';
import { correlationIdFromRequest, slog } from '@/lib/requestContext';
import { httpStatusFromError, toErrorJson } from '@/lib/errors';

// Hàm tìm kiếm đường dẫn Chrome
function findChromePath(): string | null {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export const runtime = 'nodejs';
/** Flow Veo can take several minutes (upload + captcha + poll). */
export const maxDuration = 600;

function getApiKeyPath(): string {
  return path.join(process.cwd(), 'apikey.txt');
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

// Helper function to upload local image to a temporary public host (tmpfiles.org)
async function uploadToPublicTempHost(localFilePath: string): Promise<string | null> {
  try {
    if (!fs.existsSync(localFilePath)) {
      console.warn(`[Temp Host] File does not exist: ${localFilePath}`);
      return null;
    }
    const buffer = fs.readFileSync(localFilePath);
    const blob = new Blob([buffer], { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', blob, path.basename(localFilePath));

    console.log(`[Temp Host] Uploading file to tmpfiles.org: ${path.basename(localFilePath)}...`);
    const resp = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: formData
    });

    if (resp.ok) {
      const json = await resp.json();
      const url = json.data?.url;
      if (url) {
        // Convert to direct download link
        const directUrl = url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
        console.log(`[Temp Host] Upload successful! Direct URL: ${directUrl}`);
        return directUrl;
      }
    } else {
      console.error(`[Temp Host] Upload failed: ${resp.status} ${resp.statusText}`);
    }
  } catch (err: any) {
    console.error(`[Temp Host] Exception during upload: ${err.message}`);
  }
  return null;
}

function resolveLocalImagePath(imageRef?: string): string | null {
  if (!imageRef) return null;
  if (/^https?:\/\//i.test(imageRef)) return null;
  if (path.isAbsolute(imageRef) && fs.existsSync(imageRef)) return imageRef;

  let fileName = '';
  try {
    const url = new URL(imageRef, 'http://local.app');
    fileName = url.searchParams.get('file') || '';
  } catch {}

  if (!fileName && imageRef.includes('file=')) {
    fileName = imageRef.split('file=')[1].split('&')[0];
  }
  if (!fileName && imageRef.startsWith('/images/')) {
    fileName = imageRef.replace('/images/', '');
  }
  if (!fileName && imageRef.startsWith('/api/serve-image/')) {
    fileName = path.basename(imageRef);
  }

  if (!fileName) return null;
  fileName = decodeURIComponent(fileName).split('?')[0].split('#')[0];
  const localImagePath = path.join(process.cwd(), 'public', 'images', path.basename(fileName));
  return fs.existsSync(localImagePath) ? localImagePath : null;
}

function runwayRatioFromAspect(aspectRatio: string): string {
  if (aspectRatio === '9:16') return '768:1280';
  if (aspectRatio === '1:1') return '960:960';
  if (aspectRatio === '4:5') return '768:960';
  return '1280:768';
}

function quoteCmdArg(arg: string): string {
  return /[\s"]/u.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function appendProcessOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  return next.length > 6000 ? next.slice(-6000) : next;
}

async function runFfmpegProcess(executable: string, args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        child.kill('SIGKILL');
        reject(new Error(`FFmpeg timeout sau ${Math.round(timeoutMs / 1000)}s. ${stderr || stdout}`.trim()));
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendProcessOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendProcessOutput(stderr, chunk);
    });
    child.on('error', (err) => {
      finish(() => reject(err));
    });
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}. ${stderr || stdout}`.trim()));
        }
      });
    });
  });
}

export async function POST(req: Request) {
  const correlationId = correlationIdFromRequest(req);
  // Pro gate (open mode = desktop allow-all)
  try {
    assertProAccess(req);
  } catch (err) {
    return NextResponse.json(toErrorJson(err, correlationId), {
      status: httpStatusFromError(err),
      headers: { 'x-correlation-id': correlationId },
    });
  }
  slog({
    level: 'info',
    msg: 'video_start',
    correlationId,
    route: '/api/generate-video',
  });
  try {
    const body = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { chapterNum, sceneIndex, promptIndex, prompt, drivePath, duration, model, startImage, endImage } = body;

    if (chapterNum === undefined || sceneIndex === undefined) {
      return NextResponse.json({ error: 'Thiếu thông tin chương hoặc phân cảnh.' }, { status: 400 });
    }

    let promptText = typeof prompt === 'string' ? prompt.trim() : '';
    if (!promptText) {
      return NextResponse.json({ error: '[Video API] Thieu prompt video thuc te. He thong khong tu chen prompt mau.' }, { status: 400 });
    }

    // Seedance director — always applied at generation core (I2V-aware)
    try {
      const { compileSeedancePrompt } = await import('@/lib/integrations/seedance');
      const directed = compileSeedancePrompt({
        sceneText: promptText,
        characterHints: Array.isArray(body.characterHints) ? body.characterHints : undefined,
        environmentHint: typeof body.environmentHint === 'string' ? body.environmentHint : undefined,
        genre: typeof body.genre === 'string' ? body.genre : 'dark survival / mạt thế',
        hasStartImage: Boolean(startImage),
        hasEndImage: Boolean(endImage),
        durationSec: Number(duration) > 0 ? Number(duration) : 5,
      });
      promptText = directed.prompt;
      console.log(`[Video API] Seedance mode=${directed.mode} fn=${directed.function}`);
    } catch (e) {
      console.warn('[Video API] Seedance compile skipped:', e);
    }

    const videoDuration = Number(duration);
    if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
      return NextResponse.json({ error: '[Video API] Thieu thoi luong video hop le.' }, { status: 400 });
    }

    const filename = localVideoFilename(chapterNum, sceneIndex);
    const videoProvider = typeof body.videoProvider === 'string' ? body.videoProvider.trim() : '';
    const supportedVideoProviders = ['flow', 'sora', 'veo', 'grok', 'luma', 'runway', 'ffmpeg'];
    if (!videoProvider) {
      return NextResponse.json({ error: '[Video API] Thieu videoProvider. He thong khong tu chay provider mac dinh.' }, { status: 400 });
    }
    if (!supportedVideoProviders.includes(videoProvider)) {
      return NextResponse.json({ error: `[Video API] Provider ${videoProvider} khong duoc ho tro trong che do production.` }, { status: 400 });
    }

    const videoApiKey = body.videoApiKey || '';
    const videoAspectRatio = body.videoAspectRatio || '16:9';

    console.log(`[Video API] Bắt đầu sinh video cho Cảnh ${sceneIndex} | Provider: ${videoProvider} | Duration: ${videoDuration}s`);

    // Tạo thư mục video
    const publicVideoDir = path.join(process.cwd(), 'public', 'video');
    if (!fs.existsSync(publicVideoDir)) fs.mkdirSync(publicVideoDir, { recursive: true });
    const localSavePath = path.join(publicVideoDir, filename);
    const sourceImagePath = resolveLocalImagePath(startImage);
    const publicImageUrl = /^https?:\/\//i.test(startImage || '')
      ? startImage
      : (sourceImagePath && ['luma', 'runway'].includes(videoProvider) ? await uploadToPublicTempHost(sourceImagePath) : null);

    const providerKeysToTry: string[] = [];
    if (videoApiKey) providerKeysToTry.push(videoApiKey);
    if (Array.isArray(body.apiKeys)) {
      body.apiKeys.forEach((k: string) => {
        if (k && !providerKeysToTry.includes(k)) providerKeysToTry.push(k);
      });
    }

    // --- MULTI-PROVIDER ROUTING (NO FALLBACK) ---

    // 0. GOOGLE FLOW (extension bridge — Imagen/Veo via labs.google)
    if (videoProvider === 'flow') {
      try {
        const {
          ensureBridgeStarted,
          getBridgeSnapshotAsync,
          bootstrapFlow,
          runGenerateOne,
        } = await import('@/lib/flow-bridge');
        await ensureBridgeStarted();
        let snap = await getBridgeSnapshotAsync();
        if (!snap.flowKeyPresent || !snap.extensionConnected) {
          console.log('[Flow Video] Session incomplete — auto bootstrap…');
          await bootstrapFlow({
            forceChrome: !snap.extensionConnected,
            engine: 'auto',
            waitExtensionMs: 35000,
            waitLoginMs: 15000,
          });
          snap = await getBridgeSnapshotAsync();
        }
        if (!snap.flowKeyPresent) {
          return NextResponse.json(
            {
              error:
                '[Google Flow Video] Chưa có token. Ảnh/Video → Engine Auto → Đăng nhập Google.',
            },
            { status: 503 },
          );
        }
        const result = await runGenerateOne({
          kind: 'video',
          prompt: promptText,
          chapterNum,
          sceneIndex,
          promptIndex: body.promptIndex != null ? Number(body.promptIndex) : 0,
          aspectRatio: videoAspectRatio,
          durationSec: videoDuration,
          videoModel: typeof body.model === 'string' ? body.model : undefined,
          startImagePath: sourceImagePath || undefined,
          endImagePath: resolveLocalImagePath(endImage) || undefined,
          referenceImagePath: sourceImagePath || undefined,
          quality:
            typeof body.quality === 'string'
              ? body.quality
              : typeof body.videoQuality === 'string'
                ? body.videoQuality
                : 'hd',
        });
        if (!result.ok || !result.resultPaths?.length) {
          return NextResponse.json(
            {
              error: `[Google Flow Video] ${result.error || 'Sinh video thất bại. Kiểm tra extension + đăng nhập Flow.'}`,
            },
            { status: 500 },
          );
        }
        const src = result.resultPaths[0];
        try {
          fs.mkdirSync(path.dirname(localSavePath), { recursive: true });
          if (src !== localSavePath) fs.copyFileSync(src, localSavePath);
        } catch {
          /* ignore */
        }
        return createSuccessResponse(
          localSavePath,
          filename,
          videoDuration,
          drivePath,
          chapterNum,
          'flow',
        );
      } catch (e: unknown) {
        return NextResponse.json(
          {
            error: `[Google Flow Video] ${e instanceof Error ? e.message : String(e)}`,
          },
          { status: 500 },
        );
      }
    }

    // 1. LUMA DREAM MACHINE
    if (videoProvider === 'luma') {
      if (providerKeysToTry.length === 0) {
        return NextResponse.json({ error: '[Luma Error] Vui lòng cấu hình Luma API Key để sinh video.' }, { status: 400 });
      }
      let lastError = '';
      for (const currentKey of providerKeysToTry) {
        try {
          const payload: any = {
            prompt: promptText,
            aspect_ratio: videoAspectRatio
          };
          if (publicImageUrl) {
            payload.keyframes = {
              frame0: {
                type: 'image',
                url: publicImageUrl
              }
            };
          }
          const res = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const data = await res.json();
            console.log(`[Video API] Luma job created: ${data.id}`);
            return NextResponse.json({ success: true, message: `Luma job created: ${data.id}`, jobId: data.id });
          } else {
            lastError = await res.text();
            try { lastError = JSON.parse(lastError).detail || lastError; } catch {}
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      return NextResponse.json({ error: `[Luma Dream Machine Error] ${lastError}` }, { status: 500 });
    }

    // 2. RUNWAY GEN-3
    else if (videoProvider === 'runway') {
      if (providerKeysToTry.length === 0) {
        return NextResponse.json({ error: '[Runway Error] Vui lòng cấu hình Runway API Key để sinh video.' }, { status: 400 });
      }
      let lastError = '';
      for (const currentKey of providerKeysToTry) {
        try {
          const res = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentKey}`,
              'X-Runway-Version': '2024-09-13',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gen3a_turbo',
              promptText: promptText,
              promptImage: publicImageUrl || undefined,
              ratio: runwayRatioFromAspect(videoAspectRatio)
            })
          });
          if (res.ok) {
            const data = await res.json();
            console.log(`[Video API] Runway job created: ${data.id}`);
            return NextResponse.json({ success: true, message: `Runway job created: ${data.id}`, jobId: data.id });
          } else {
            lastError = await res.text();
            try { lastError = JSON.parse(lastError).error || lastError; } catch {}
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      return NextResponse.json({ error: `[Runway Gen-3 Error] ${lastError}` }, { status: 500 });
    }

    // 3. xAI GROK IMAGINE VIDEO
    else if (videoProvider === 'grok') {
      if (providerKeysToTry.length === 0) {
        return NextResponse.json({ error: '[Grok Imagine Video Error] Vui long cau hinh xAI Grok API Key.' }, { status: 400 });
      }
      if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
        return NextResponse.json({ error: '[Grok Imagine Video Error] Can sinh anh truoc de chay image-to-video.' }, { status: 400 });
      }

      const imageUrl = imageDataUriFromLocalFile(sourceImagePath);
      const requestDuration = Math.max(1, Math.min(15, Number(videoDuration) || 6));
      let lastError = '';
      for (const currentKey of providerKeysToTry) {
        try {
          const res = await fetch('https://api.x.ai/v1/videos/generations', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${currentKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'grok-imagine-video-1.5',
              prompt: promptText,
              image_url: imageUrl,
              duration: requestDuration,
              aspect_ratio: videoAspectRatio,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && data.request_id) {
            const videoData = await pollXaiVideo(data.request_id, currentKey, 180000);
            if (videoData) {
              fs.writeFileSync(localSavePath, videoData);
              return createSuccessResponse(localSavePath, filename, requestDuration, drivePath, chapterNum, 'Grok Imagine Video 1.5');
            }
            lastError = 'Timeout while waiting for Grok Imagine video result.';
          } else {
            lastError = data.error?.message || JSON.stringify(data) || `xAI error ${res.status}`;
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      return NextResponse.json({ error: `[Grok Imagine Video Error] ${lastError}` }, { status: 500 });
    }

    // 3. OPENAI SORA
    else if (videoProvider === 'sora') {
      if (providerKeysToTry.length === 0) {
        return NextResponse.json({ error: '[OpenAI Sora Error] Vui lòng cấu hình OpenAI API Key để sinh video.' }, { status: 400 });
      }
      let lastError = '';
      for (const currentKey of providerKeysToTry) {
        try {
          const res = await fetch('https://api.openai.com/v1/videos/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${currentKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: "sora-1.0",
              prompt: promptText,
              resolution: videoAspectRatio === '16:9' ? '1920x1080' : '1080x1920'
            })
          });
          if (res.ok) {
            const data = await res.json();
            return NextResponse.json({ success: true, data });
          } else {
            lastError = await res.text();
            try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }
      return NextResponse.json({ error: `[OpenAI Sora Error] ${lastError}` }, { status: 500 });
    }

    // 4. GOOGLE VEO
    else if (videoProvider === 'veo') {
      const apiKeys = providerKeysToTry.length > 0 ? providerKeysToTry : loadApiKeys();
      if (apiKeys.length === 0) {
        return NextResponse.json({ error: '[Google Veo Error] Vui lòng cấu hình Google Studio API Key cho Veo.' }, { status: 400 });
      }

      let lastError = '';
      for (let ki = 0; ki < apiKeys.length; ki++) {
        const key = apiKeys[ki];
        for (const veoModel of VEO_MODELS) {
          console.log(`[Video API] [Key ${ki+1}/${apiKeys.length}] [Model: ${veoModel}] Đang gửi request...`);
          try {
            const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${veoModel}:generateContent?key=${key}`;
            const requestBody = {
              contents: [{
                role: 'user',
                parts: [{ text: `Generate a video (Aspect ratio: ${videoAspectRatio}): ${promptText}` }]
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
              signal: AbortSignal.timeout(120000)
            });

            if (resp.ok) {
              const data = await resp.json();
              if (data.name && data.name.includes('operations/')) {
                const videoData = await pollOperation(data.name, key, 120000);
                if (videoData) {
                  fs.writeFileSync(localSavePath, videoData);
                  return createSuccessResponse(localSavePath, filename, videoDuration, drivePath, chapterNum, veoModel);
                }
              }
              if (data.candidates) {
                for (const candidate of data.candidates) {
                  if (candidate.content?.parts) {
                    for (const part of candidate.content.parts) {
                      if (part.inlineData?.mimeType?.startsWith('video/')) {
                        const videoBuffer = Buffer.from(part.inlineData.data, 'base64');
                        fs.writeFileSync(localSavePath, videoBuffer);
                        return createSuccessResponse(localSavePath, filename, videoDuration, drivePath, chapterNum, veoModel);
                      }
                    }
                  }
                }
              }
            } else {
              lastError = await resp.text();
              try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
            }
          } catch (err: any) {
            lastError = err.message;
          }
        }
      }
      return NextResponse.json({ error: `[Google Veo Error] ${lastError}` }, { status: 500 });
    }

    // 5. FFMPEG VIDEO BUILDER (Ken Burns)
    else if (videoProvider === 'ffmpeg') {
      return createFfmpegVideoResponse(localSavePath, filename, videoDuration, drivePath, chapterNum, body.useGpuAcceleration, sourceImagePath);
    }

    else {
      return NextResponse.json({ error: `[Video API Error] Provider ${videoProvider} không được hỗ trợ.` }, { status: 400 });
    }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    console.error('Lỗi API Generate Video:', err);
    return NextResponse.json(
      { error: err.message || 'Lỗi xảy ra trong quá trình sinh video.' },
      { status: 500 }
    );
  }
}

function imageDataUriFromLocalFile(localFilePath: string): string {
  const ext = path.extname(localFilePath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png';
  const base64 = fs.readFileSync(localFilePath).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

function isSvgLikeFile(localFilePath: string) {
  try {
    const header = fs.readFileSync(localFilePath, { encoding: 'utf8', flag: 'r' }).slice(0, 256).trimStart().toLowerCase();
    return header.startsWith('<svg') || header.includes('<svg');
  } catch {
    return false;
  }
}

async function pollXaiVideo(requestId: string, apiKey: string, timeoutMs: number): Promise<Buffer | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`https://api.x.ai/v1/videos/${requestId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error?.message || `xAI video poll failed: ${response.status}`);
    }
    if (data.status === 'done' && data.video?.url) {
      const videoResponse = await fetch(data.video.url);
      if (!videoResponse.ok) {
        throw new Error(`xAI video download failed: ${videoResponse.statusText}`);
      }
      return Buffer.from(await videoResponse.arrayBuffer());
    }
    if (data.status === 'failed' || data.status === 'error') {
      throw new Error(data.error?.message || 'xAI video generation failed.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return null;
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

// Tạo response bằng FFmpeg từ ảnh đã gen
async function createFfmpegVideoResponse(localSavePath: string, filename: string, duration: number, drivePath: string, chapterNum: number, useGpu = false, sourceImagePath?: string | null) {
  try {
    const publicVideoDir = path.dirname(localSavePath);
    let tempImagePath = path.join(publicVideoDir, `temp_${Date.now()}.jpg`);

    if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
      return NextResponse.json(
        { error: '[FFmpeg Video Builder] Cần sinh ảnh trước. FFmpeg sẽ dùng đúng ảnh đã gen, không tự tải ảnh mới từ prompt.' },
        { status: 400 }
      );
    }
    console.log(`[FFmpeg Video Builder] Using existing generated image: ${sourceImagePath}`);
    if (isSvgLikeFile(sourceImagePath)) {
      return NextResponse.json(
        { error: '[FFmpeg Video Builder] Ảnh đầu vào không hợp lệ hoặc là định dạng vector. Vui lòng sử dụng ảnh raster thực tế để tạo video.' },
        { status: 400 }
      );
    }
    fs.copyFileSync(sourceImagePath, tempImagePath);

    console.log(`[FFmpeg Video Builder] 2. Xác định đường dẫn FFmpeg...`);
    const localFfmpeg = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
    const ffmpegExecutable = fs.existsSync(localFfmpeg) ? localFfmpeg : 'ffmpeg';

    console.log(`[FFmpeg Video Builder] 3. Tạo video pan/zoom chất lượng cao bằng FFmpeg...`);
    const frameCount = Math.max(1, Math.ceil(duration * 25));
    const filterComplex = `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.0015,1.5)':d=${frameCount}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1280x720,framerate=25,format=yuv420p[v]`;
    
    let codec = 'libx264';
    if (useGpu) {
      const codecsToTry = ['h264_nvenc', 'h264_amf', 'h264_qsv'];
      const { execSync } = require('child_process');
      const ffmpegTestExecutable = quoteCmdArg(ffmpegExecutable);
      let gpuCodec = '';
      for (const c of codecsToTry) {
        try {
          execSync(`${ffmpegTestExecutable} -y -f lavfi -i nullsrc=s=64x64:d=1 -c:v ${c} -f null -`, { stdio: 'ignore' });
          gpuCodec = c;
          console.log(`[FFmpeg Video Builder] GPU acceleration (${c}) enabled successfully.`);
          break;
        } catch {}
      }
      if (!gpuCodec) {
        throw new Error('[FFmpeg Video Builder] GPU encoder requested but no supported GPU codec is available.');
      }
      codec = gpuCodec;
    }
    
    const encodeOptions = codec === 'libx264' ? ['-preset', 'veryfast', '-crf', '20'] : [];
    const ffmpegArgs = [
      '-y',
      '-framerate', '25',
      '-i', tempImagePath,
      '-filter_complex', filterComplex,
      '-map', '[v]',
      '-c:v', codec,
      ...encodeOptions,
      '-frames:v', String(frameCount),
      '-pix_fmt', 'yuv420p',
      localSavePath,
    ];
    const ffmpegCmd = [ffmpegExecutable, ...ffmpegArgs].map(quoteCmdArg).join(' ');
    
    console.log(`[FFmpeg Video Builder] Chạy lệnh: ${ffmpegCmd}`);
    try {
      await runFfmpegProcess(ffmpegExecutable, ffmpegArgs, Math.max(300000, duration * 120000));
    } finally {
      try {
        if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
      } catch (cleanupErr) {
        console.warn(`[FFmpeg Video Builder] Khong the xoa anh tam ${tempImagePath}:`, (cleanupErr as Error).message);
      }
      tempImagePath = '';
    }
    console.log(`[FFmpeg Video Builder] ✅ Đã tạo file video thật sắc nét: ${localSavePath}`);

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
      method: 'Generated Image + FFmpeg Ken Burns'
    });
  } catch (err: unknown) {
    console.error(`[FFmpeg Video Builder] Lỗi:`, (err as Error).message);
    return NextResponse.json(
      { error: `[Video Generation Error] ${(err as Error).message || 'Lỗi sinh video qua FFmpeg.'}` },
      { status: 500 }
    );
  }
}
