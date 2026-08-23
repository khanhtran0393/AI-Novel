import { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { DEFAULT_GEMINI_TEXT_MODEL } from '@/lib/geminiModels';
import crypto from 'crypto';

export interface AgentResult {
  success: boolean;
  message?: string;
  data?: string; // Ví dụ URL tải về
}

interface AgentAction {
  action: 'click' | 'type' | 'wait' | 'done' | 'fail';
  coords?: [number, number];
  text?: string;
  milliseconds?: number;
  reason?: string;
  data?: string;
}

export class BrowserAgent {
  private page: Page;
  private apiKey: string;
  private maxSteps: number;
  private model: string;
  private cachePath: string;

  constructor(page: Page, apiKey: string, model: string = DEFAULT_GEMINI_TEXT_MODEL, maxSteps: number = 10) {
    this.page = page;
    this.apiKey = apiKey;
    this.model = model;
    this.maxSteps = maxSteps;
    this.cachePath = path.join(process.cwd(), 'scratch', 'agent_cache.json');
    if (!fs.existsSync(path.dirname(this.cachePath))) {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
    }
  }

  public async runAgenticWorkflow(goal: string, cacheKey?: string): Promise<AgentResult> {
    if (!this.apiKey) {
      return { success: false, message: 'Missing Gemini API Key for Agentic Workflow' };
    }

    console.log(`[BrowserAgent] Bắt đầu workflow tự trị. Mục tiêu: "${goal}" | Model: ${this.model}`);

    let cachedActions: AgentAction[] | null = null;
    let cacheKeyHash = '';
    if (cacheKey) {
      cacheKeyHash = crypto.createHash('md5').update(cacheKey).digest('hex');
      try {
        if (fs.existsSync(this.cachePath)) {
          const cacheData = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
          if (cacheData[cacheKeyHash]) {
            cachedActions = cacheData[cacheKeyHash];
            console.log(`[BrowserAgent] ⚡ Đã tìm thấy Cache RPA cho tác vụ này. Đang chạy chế độ Fast-playback...`);
          }
        }
      } catch (err) {
        console.warn(`[BrowserAgent] Không thể đọc cache: ${err}`);
      }
    }

    const executedActions: AgentAction[] = [];
    let isUsingCache = !!cachedActions;
    let cacheStep = 0;

    for (let step = 1; step <= this.maxSteps; step++) {
      console.log(`[BrowserAgent] --- Bước ${step}/${this.maxSteps} ---`);
      
      let action: AgentAction | null = null;

      if (isUsingCache && cachedActions && cacheStep < cachedActions.length) {
        action = cachedActions[cacheStep];
        cacheStep++;
        console.log(`[BrowserAgent] ⚡ Dùng Cache: [${action.action.toUpperCase()}]`);
      } else {
        if (isUsingCache) {
          console.log(`[BrowserAgent] ⚠️ Cache hết lệnh hoặc không phù hợp, chuyển sang hỏi AI...`);
          isUsingCache = false;
        }

        // 1. Observe (Chụp màn hình)
        const screenshotBuffer = await this.page.screenshot({ type: 'jpeg', quality: 70 });
        const base64Image = Buffer.from(screenshotBuffer).toString('base64');

        const htmlSnippet = await this.page.evaluate(() => {
          const clone = document.body.cloneNode(true) as HTMLElement;
          const scripts = clone.querySelectorAll('script, style, link, noscript, svg, path');
          scripts.forEach(s => s.remove());
          return clone.innerHTML.substring(0, 5000); 
        });

        // 2. Think (Hỏi Gemini)
        action = await this.askGeminiForAction(base64Image, htmlSnippet, goal, step);
      }
      
      if (!action) {
        console.warn(`[BrowserAgent] Không nhận được phản hồi hợp lệ. Thử lại sau 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!isUsingCache) {
        console.log(`[BrowserAgent] 🤖 AI Quyết định: [${action.action.toUpperCase()}] Lý do: ${action.reason || 'Không có lý do'}`);
        executedActions.push(action);
      }

      // 3. Act (thao tac browser that theo quyet dinh cua AI)
      try {
        switch (action.action) {
          case 'click':
            if (action.coords && action.coords.length === 2) {
              const [x, y] = action.coords;
              console.log(`[BrowserAgent] Di chuột (Ghost cursor) và Click tại X=${x}, Y=${y}`);
              
              // Human-like mouse movement
              await this.page.mouse.move(x + (Math.random()*10 - 5), y + (Math.random()*10 - 5), { steps: 10 });
              await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
              await this.page.mouse.click(x, y);
              
              await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000)); // Chờ UI phản hồi
            } else {
              console.warn('[BrowserAgent] Hành động click thiếu toạ độ.');
            }
            break;

          case 'type':
            if (action.text) {
              console.log(`[BrowserAgent] Gõ văn bản (Human-speed): "${action.text.substring(0, 30)}..."`);
              // Random gõ phím từ 30-100ms mỗi ký tự
              for (const char of action.text) {
                await this.page.keyboard.type(char, { delay: Math.random() * 70 + 30 });
              }
              await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
            }
            break;

          case 'wait':
            const ms = action.milliseconds || 2000;
            console.log(`[BrowserAgent] Chờ đợi ${ms}ms...`);
            await new Promise(r => setTimeout(r, ms));
            break;

          case 'done':
            console.log(`[BrowserAgent] 🎉 AI đã hoàn thành mục tiêu!`);
            
            // Lưu cache nếu luồng chạy thành công bằng AI (không phải từ cache cũ)
            if (!isUsingCache && cacheKeyHash && executedActions.length > 0) {
              try {
                let cacheData: any = {};
                if (fs.existsSync(this.cachePath)) {
                  cacheData = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
                }
                cacheData[cacheKeyHash] = executedActions;
                fs.writeFileSync(this.cachePath, JSON.stringify(cacheData, null, 2));
                console.log(`[BrowserAgent] 💾 Đã lưu chuỗi hành động vào Cache (Key: ${cacheKey}).`);
              } catch (e) {
                console.warn(`[BrowserAgent] Lỗi khi lưu Cache: ${e}`);
              }
            }

            return { success: true, message: 'Hoàn thành', data: action.data };

          case 'fail':
            console.error(`[BrowserAgent] ❌ AI báo cáo thất bại: ${action.reason}`);
            // Xoá cache nếu có lỗi để lần sau chạy lại AI
            if (isUsingCache && cacheKeyHash) {
               console.log(`[BrowserAgent] 🗑️ Xoá cache hỏng để lần sau chạy lại AI...`);
               isUsingCache = false;
               try {
                 const cacheData = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
                 delete cacheData[cacheKeyHash];
                 fs.writeFileSync(this.cachePath, JSON.stringify(cacheData, null, 2));
               } catch (e) {}
            }
            return { success: false, message: action.reason || 'AI không thể hoàn thành mục tiêu.' };
            
          default:
            console.warn(`[BrowserAgent] Hành động không xác định: ${action.action}`);
        }
      } catch (err: any) {
        console.error(`[BrowserAgent] Lỗi khi thực thi hành động: ${err.message}`);
        isUsingCache = false; // Rơi khỏi cache nếu lỗi ném ra từ puppeteer
      }
    }

    return { success: false, message: 'Vượt quá số bước tối đa (maxSteps).' };
  }

  private async askGeminiForAction(base64Image: string, htmlSnippet: string, goal: string, step: number): Promise<AgentAction | null> {
    const prompt = `You are an expert Autonomous Browser RPA Agent. 
Current Goal: "${goal}"
Current Step: ${step}

I have attached a screenshot of the current web page.
Below is a simplified HTML snippet of the body (for reference to text/links):
\`\`\`html
${htmlSnippet}
\`\`\`

Analyze the current screen state. Determine the ONE NEXT ACTION required to progress towards the goal.
Return ONLY a valid JSON object matching this schema. Do not include markdown tags like \`\`\`json.
{
  "action": "click" | "type" | "wait" | "done" | "fail",
  "reason": "Brief explanation of why you chose this action based on what you see",
  "coords": [x, y], // ONLY if action is 'click'. Provide integer X, Y coordinates representing the center of the target element.
  "text": "text to type", // ONLY if action is 'type'
  "milliseconds": 2000, // ONLY if action is 'wait'
  "data": "any extracted string data like an image URL" // ONLY if action is 'done' and you need to return something
}

If the goal is fully accomplished, return action="done" and put any required output in "data".
If you are completely stuck or encounter an error page, return action="fail".
If you are waiting for a loading spinner or generation process, return action="wait" with milliseconds (e.g. 5000).`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: "image/jpeg", data: base64Image } }
            ]
          }],
          generationConfig: { temperature: 0.1 }
        })
      });

      if (!res.ok) {
        console.error(`[BrowserAgent] API Lỗi: ${res.statusText}`);
        return null;
      }

      const data = await res.json();
      let textObj = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      textObj = textObj.replace(/```json/g, '').replace(/```/g, '').trim();

      try {
        return JSON.parse(textObj) as AgentAction;
      } catch (e) {
        console.error(`[BrowserAgent] Không thể parse JSON từ AI: ${textObj}`);
        return null;
      }
    } catch (err: any) {
      console.error(`[BrowserAgent] Lỗi kết nối API: ${err.message}`);
      return null;
    }
  }
}
