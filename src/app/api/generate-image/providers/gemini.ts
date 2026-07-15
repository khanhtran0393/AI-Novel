import { NextResponse } from 'next/server';
import type { ImageProviderCtx } from '../imageTypes';
import { runWhiskAutomation } from './whisk';

/**
 * Owner: Google Imagen REST path; Whisk delegated to whisk.ts.
 */
export async function generateWithGemini(
  ctx: ImageProviderCtx,
): Promise<NextResponse> {
  const {
    providerPrompt,
    keysToTry,
    imageAspectRatio,
    imageCount,
    referenceImageB64,
    referenceMime,
    saveImage,
    saveImageBuffers,
    model,
    cookie,
    prompt,
    characterPrompt,
  } = ctx;

  try {
      // Nếu không có API Key nhưng có cookie -> Chuyển sang Whisk Automation (Headless Browser)
      if (model === 'whisk' && (!cookie || cookie.trim().length === 0)) {
        return NextResponse.json({ error: '[Google Whisk Error] Vui long cau hinh Cookie Google Studio de chay Whisk.' }, { status: 400 });
      }
      if ((model === 'whisk' || keysToTry.length === 0) && cookie && cookie.trim().length > 0) {
         console.log(`[Image API] Không có API Key. Kích hoạt luồng Google Labs Whisk Automation bằng Cookie...`);
      } else {
         if (keysToTry.length === 0) {
           return NextResponse.json({ error: '[Google Imagen Error] Vui lòng cấu hình Google Studio API Key hoặc Cookie để sinh ảnh.' }, { status: 400 });
         }
    
         const imageModelIds = ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-002'];
         let lastError = '';
         for (const currentKey of keysToTry) {
           for (const apiModelId of imageModelIds) {
             const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predict?key=${currentKey}`;
             try {
               const geminiPrompt = referenceImageB64
                 ? `${providerPrompt} [identity sheet attached server-side; match face exactly]`
                 : characterPrompt
                   ? `${prompt}, subject: ${characterPrompt}`
                   : prompt;
               const controller = new AbortController();
               const timeoutId = setTimeout(() => controller.abort(), 60000);
               // Imagen predict is text-only; face binary is already encoded into providerPrompt lock text.
               // When face-ref exists, prefer gemini-2.0-flash-preview-image-generation multimodal if available.
               if (referenceImageB64 && apiModelId.includes('imagen')) {
                 try {
                   const multiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${currentKey}`;
                   const multiRes = await fetch(multiUrl, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({
                       contents: [
                         {
                           role: 'user',
                           parts: [
                             {
                               inlineData: {
                                 mimeType: referenceMime,
                                 data: referenceImageB64,
                               },
                             },
                             {
                               text: `Using this face/identity reference image, generate a new storyboard still: ${geminiPrompt}. Preserve exact facial identity.`,
                             },
                           ],
                         },
                       ],
                       generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
                     }),
                     signal: controller.signal,
                   });
                   if (multiRes.ok) {
                     const multiData = (await multiRes.json()) as {
                       candidates?: Array<{
                         content?: {
                           parts?: Array<{ inlineData?: { data?: string } }>;
                         };
                       }>;
                     };
                     const parts = multiData.candidates?.[0]?.content?.parts || [];
                     const imgPart = parts.find((p) => p.inlineData?.data);
                     if (imgPart?.inlineData?.data) {
                       clearTimeout(timeoutId);
                       return saveImage(
                         Buffer.from(imgPart.inlineData.data, 'base64'),
                         'Google Gemini multimodal face-ref',
                         currentKey,
                       );
                     }
                   }
                 } catch (multiErr) {
                   console.warn('[generate-image] Gemini multimodal face-ref skip', multiErr);
                 }
               }
               const response = await fetch(url, {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({
                   instances: [{ prompt: geminiPrompt }],
                   parameters: {
                     sampleCount: imageCount,
                     aspectRatio: imageAspectRatio,
                     outputMimeType: "image/jpeg"
                   }
                 }),
                 signal: controller.signal
               });
               clearTimeout(timeoutId);
    
               if (response.ok) {
                 const data = await response.json() as any;
                 const imageBuffers = (data.predictions || [])
                   .map((prediction: { bytesBase64Encoded?: string }) => prediction.bytesBase64Encoded)
                   .filter(Boolean)
                   .slice(0, imageCount)
                   .map((base64Data: string) => Buffer.from(base64Data, 'base64'));
                 if (imageBuffers.length > 0) {
                   return saveImageBuffers(imageBuffers, `Google Gemini Image API (${apiModelId})`, currentKey);
                 }
               } else {
                 lastError = await response.text();
                 try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
               }
             } catch (err: any) {
               lastError = err.message;
             }
           }
         }
         return NextResponse.json({ error: `[Google Imagen 3 Error] ${lastError}` }, { status: 500 });
      }

    // Cookie / whisk path — delegated (browser lifecycle owned by whisk.ts)
    return runWhiskAutomation(ctx);
  } catch (err: unknown) {
    console.error('[Gemini Image] unexpected:', err);
    return NextResponse.json(
      {
        error:
          (err as Error).message ||
          'Có lỗi xảy ra trong quá trình sinh ảnh Gemini.',
      },
      { status: 500 },
    );
  }
}
