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
      // IRON B10: model=whisk → chỉ Whisk+cookie; Imagen → chỉ API key. Không nhảy model ngầm.
      if (model === 'whisk') {
        if (!cookie || cookie.trim().length === 0) {
          return NextResponse.json(
            {
              error:
                '[Google Whisk Error] Thiếu Cookie Google Studio. Không fallback Imagen API. Thêm cookie hoặc chọn model Imagen tường minh.',
            },
            { status: 400 },
          );
        }
        console.log('[Image API] Whisk Automation (model=whisk + cookie)...');
      } else if (keysToTry.length === 0) {
        return NextResponse.json(
          {
            error:
              '[Google Imagen Error] Thiếu Gemini/Imagen API Key. Không fallback Whisk cookie khi model≠whisk. Thêm key hoặc chọn model whisk + cookie.',
          },
          { status: 400 },
        );
      } else {
    
         const imageModelIds = ['imagen-3.0-generate-002', 'imagen-3.0-fast-generate-002'];
         let lastError = '';
         const {
           assertPoolHasCapacity,
           filterAvailableKeys,
           isKeyAvailable,
           markKeyAttempt,
           markKeyLimited,
           markKeySuccess,
         } = await import('@/lib/apiKeyRotate');
         try {
           assertPoolHasCapacity(keysToTry);
         } catch (waitErr) {
           return NextResponse.json(
             {
               error:
                 waitErr instanceof Error
                   ? waitErr.message
                   : 'Pool API key chạm trần — vui lòng chờ.',
               code: 'QUOTA',
             },
             { status: 429 },
           );
         }
         const keysLive = filterAvailableKeys(keysToTry);
         for (const currentKey of keysLive) {
           let keyExhausted = false;
           for (const apiModelId of imageModelIds) {
             if (keyExhausted) break;
             if (!isKeyAvailable(currentKey)) {
               keyExhausted = true;
               break;
             }
             const url = `https://generativelanguage.googleapis.com/v1beta/models/${apiModelId}:predict?key=${currentKey}`;
             try {
               const geminiPrompt = referenceImageB64
                 ? `${providerPrompt} [identity sheet attached server-side; match face exactly]`
                 : characterPrompt
                   ? `${prompt}, subject: ${characterPrompt}`
                   : prompt;
               const controller = new AbortController();
               const timeoutId = setTimeout(() => controller.abort(), 60000);
               if (!markKeyAttempt(currentKey)) {
                 keyExhausted = true;
                 clearTimeout(timeoutId);
                 break;
               }
               // Imagen predict is text-only; face binary is already encoded into providerPrompt lock text.
               // When face-ref exists, prefer gemini-2.0-flash-preview-image-generation multimodal if available.
               // IRON B10: có face-ref → bắt buộc multimodal; không Imagen text-only mất identity
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
                       markKeySuccess(currentKey);
                       return saveImage(
                         Buffer.from(imgPart.inlineData.data, 'base64'),
                         'Google Gemini multimodal face-ref',
                         currentKey,
                       );
                     }
                     lastError = 'multimodal ok nhưng không có image part';
                   } else {
                     lastError = await multiRes.text().catch(() => `HTTP ${multiRes.status}`);
                   }
                 } catch (multiErr) {
                   lastError =
                     multiErr instanceof Error ? multiErr.message : String(multiErr);
                 }
                 clearTimeout(timeoutId);
                 // Thử key/model kế — không rơi xuống Imagen text-only
                 continue;
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
                   markKeySuccess(currentKey);
                   return saveImageBuffers(imageBuffers, `Google Gemini Image API (${apiModelId})`, currentKey);
                 }
               } else {
                 lastError = await response.text();
                 try { lastError = JSON.parse(lastError).error?.message || lastError; } catch {}
                 const kind = markKeyLimited(
                   currentKey,
                   lastError,
                   response.status,
                 );
                 // 400 payload: do not burn remaining keys with same body
                 if (kind === 'payload') {
                   return NextResponse.json(
                     {
                       error: `[Google Imagen 400] ${lastError} — lỗi request/model, không phải RPM/RPD. Không xoay hết pool key.`,
                     },
                     { status: 400 },
                   );
                 }
                 if (kind === 'rpm' || kind === 'rpd' || kind === 'auth') {
                   keyExhausted = true;
                 }
               }
             } catch (err: any) {
               lastError = err.message;
               const kind = markKeyLimited(currentKey, lastError);
               if (kind === 'rpm' || kind === 'rpd' || kind === 'auth') {
                 keyExhausted = true;
               }
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
