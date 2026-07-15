/**
 * Extract Whisk automation from gemini.ts → whisk.ts
 * Leave Imagen API path in gemini.ts; call runWhiskAutomation when needed.
 */
import fs from 'fs';

const geminiPath = 'src/app/api/generate-image/providers/gemini.ts';
const lines = fs.readFileSync(geminiPath, 'utf8').split(/\r?\n/);

// Find whisk start: LUỒNG AUTOMATION
const whiskStart = lines.findIndex((l) => l.includes('LUỒNG AUTOMATION THẬT'));
if (whiskStart < 0) throw new Error('whisk start not found');

// Body from whisk start to just before outer catch (} catch (err: unknown) at function level)
// Structure: try { imagen... whisk... return } catch { diagnostics } finally { cleanup }
const catchIdx = lines.findIndex(
  (l, i) => i > whiskStart && l.trim() === '} catch (err: unknown) {',
);
if (catchIdx < 0) throw new Error('catch not found');

// Whisk body is lines whiskStart .. catchIdx-1 (includes returns)
// Also need diagnostics+finally for whisk-only - keep in whisk wrapper

const whiskBodyLines = lines.slice(whiskStart, catchIdx);
// unindent 4 spaces if present
const whiskBody = whiskBodyLines
  .map((l) => (l.startsWith('    ') ? l.slice(4) : l))
  .join('\n');

const catchAndFinally = lines.slice(catchIdx).join('\n');
// Parse catch/finally from original - they close generateWithGemini

// Build whisk.ts with full browser lifecycle
const whiskFile = `import { NextResponse } from 'next/server';
import { addExtra } from 'puppeteer-extra';
import puppeteerCore from 'puppeteer';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { BrowserAgent } from '@/lib/agents/BrowserAgent';
import { findChromePath } from '../chromePath';
import type { ImageProviderCtx } from '../imageTypes';

/**
 * Owner: Google Labs Whisk headless automation ONLY.
 * Does not call OpenAI/Grok/Imagen REST.
 */
export async function runWhiskAutomation(
  ctx: ImageProviderCtx,
): Promise<NextResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  let userDataDirPath = '';

  const {
    body,
    providerPrompt,
    providerKeysToTry,
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
    chapterNum,
    sceneIndex,
    promptIndex,
    drivePath,
    ten_tac_pham,
    filename,
    localSavePath,
    publicImageDir,
  } = ctx;

  const aiMasterApiKey =
    typeof body.aiMasterApiKey === 'string' ? body.aiMasterApiKey : '';

  try {
${whiskBody
  .split('\n')
  .map((l) => '    ' + l)
  .join('\n')}
  } catch (err: unknown) {
    console.error('[Whisk Automation] Lỗi tiến trình:', (err as Error).message);

    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const currentPage = pages[0];
          const currentUrl = currentPage.url();
          console.log(\`[Whisk Diagnostics] URL tại thời điểm lỗi: "\${currentUrl}"\`);
          try {
            const bodyText = await currentPage.evaluate(() =>
              document.body ? document.body.innerText : 'Empty Body',
            );
            console.log(
              \`[Whisk Diagnostics] Nội dung trang lỗi (500 ký tự đầu): "\${bodyText.substring(0, 500).replace(/\\n/g, ' ')}"\`,
            );
          } catch {
            /* ignore */
          }

          const publicImgDir = path.join(process.cwd(), 'public', 'images');
          if (!fs.existsSync(publicImgDir)) {
            fs.mkdirSync(publicImgDir, { recursive: true });
          }
          const diagPath = path.join(publicImgDir, 'whisk_error_screenshot.png');
          await currentPage.screenshot({ path: diagPath });
          console.log(\`[Whisk Diagnostics] Đã chụp màn hình lỗi tại: \${diagPath}\`);
        }
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json(
      {
        error: \`[Whisk Error] \${(err as Error).message || 'Lỗi kết nối Google Labs Whisk.'} Vui lòng cập nhật Cookie Google Studio hoặc kiểm tra tài khoản.\`,
      },
      { status: 500 },
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    if (userDataDirPath && fs.existsSync(userDataDirPath)) {
      try {
        fs.rmSync(userDataDirPath, { recursive: true, force: true });
        console.log(
          \`[Whisk Thread Cleanup] Đã dọn dẹp thư mục sandbox đa luồng: \${userDataDirPath}\`,
        );
      } catch (cleanErr: unknown) {
        console.warn(
          \`[Whisk Thread Cleanup] Cảnh báo - không thể dọn dẹp thư mục sandbox: \${(cleanErr as Error).message}\`,
        );
      }
    }
  }

  return NextResponse.json(
    { error: '[Whisk] Không tạo được ảnh.' },
    { status: 500 },
  );
}
`;

fs.writeFileSync(
  'src/app/api/generate-image/providers/whisk.ts',
  whiskFile,
);
console.log('wrote whisk.ts', whiskFile.split('\n').length);

// Slim gemini.ts: keep header + imagen path, then call runWhiskAutomation
const headEnd = lines.findIndex((l) => l.includes('aiMasterApiKey'));
// Build new gemini from start to before whisk, replace whisk with call

const beforeWhisk = lines.slice(0, whiskStart).join('\n');
// Remove puppeteer imports from gemini if only used by whisk
let slim = beforeWhisk
  .replace(
    /import \{ addExtra \} from 'puppeteer-extra';\nimport puppeteerCore from 'puppeteer';\nimport StealthPlugin from 'puppeteer-extra-plugin-stealth';\n/,
    '',
  )
  .replace(/import \{ BrowserAgent \} from '@\/lib\/agents\/BrowserAgent';\n/, '')
  .replace(/import \{ findChromePath \} from '\\.\\.\/chromePath';\n/, '');

// Remove browser/userDataDir locals if present
slim = slim.replace(
  /  \/\/ eslint-disable-next-line @typescript-eslint\/no-explicit-any\n  let browser: any;\n  let userDataDirPath = '';\n\n/,
  '',
);

// After imagen error return, add whisk call instead of whisk body
// Close the try that was wrapping everything - imagen path may still be in try
// Original: try { if whisk cookie... else { imagen }  WHISK  } catch finally

// Replace trailing of beforeWhisk - ensure we call whisk
// beforeWhisk ends with return imagen error and blank line before whisk comment

const geminiNew = `${slim}
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
`;

// Fix import runWhiskAutomation
const withImport = geminiNew.replace(
  "import type { ImageProviderCtx } from '../imageTypes';",
  "import type { ImageProviderCtx } from '../imageTypes';\nimport { runWhiskAutomation } from './whisk';",
);

// Remove unused browser vars from destructuring usage of aiMaster in gemini imagen only
// Remove finally-only vars

fs.writeFileSync(geminiPath, withImport);
console.log('rewrote gemini', withImport.split('\n').length);
