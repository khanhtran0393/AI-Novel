/**
 * Module quản lý Hồ sơ & Tạo hình Nhân vật AI (AI Character Profile & Portrait Art)
 */

interface GenCharPromptParams {
  char: string;
  dan_y_tong_the: string;
  lorebook: string;
  gioiTinh: string;
  quanAo: string;
  soThich: string;
  thoiQuen: string;
  apiKeys: string[];
  apiKey: string;
  useMock: boolean;
}

export async function generateCharPromptAction(params: GenCharPromptParams): Promise<{
  gioi_tinh?: string;
  quan_ao?: string;
  so_thich?: string;
  thoi_quen?: string;
  prompt?: string;
}> {
  const { char, dan_y_tong_the, lorebook, gioiTinh, quanAo, soThich, thoiQuen, apiKeys, apiKey, useMock } = params;
  
  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1200));
    return {
      gioi_tinh: 'Nam, khoảng 26 tuổi',
      quan_ao: 'Áo khoác chống thời tiết rách, áo giáp nhẹ chống va đập',
      so_thich: 'Nghiên cứu công nghệ mạng thấu cảm cổ xưa, giải mã ổ cứng',
      thoi_quen: 'Luôn vân vê ổ cứng cơ học nhỏ phát sáng neon',
      prompt: `A premium 3D character concept render of ${char}, male survivor in Neo-Veridia, wearing weather-resistant coat, post-apocalyptic cyberpunk style, highly detailed.`
    };
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('Chưa cấu hình API Key. Vui lòng nhập API Key ở góc trên bên phải.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_CHARACTER_PROMPT',
      apiKeys: keysToUse,
      payload: {
        name: char,
        dan_y_tong_the,
        lorebook,
        gioi_tinh: gioiTinh,
        quan_ao: quanAo,
        so_thich: soThich,
        thoi_quen: thoiQuen
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi sinh hồ sơ nhân vật.');
  }

  return await res.json();
}

interface RegenCharPromptParams {
  char: string;
  gioiTinh: string;
  quanAo: string;
  soThich: string;
  thoiQuen: string;
  apiKeys: string[];
  apiKey: string;
  useMock: boolean;
}

export async function regenerateCharPromptOnlyAction(params: RegenCharPromptParams): Promise<string> {
  const { char, gioiTinh, quanAo, soThich, thoiQuen, apiKeys, apiKey, useMock } = params;

  if (useMock) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return `A safe and clean cyberpunk portrait concept of ${char}, highly detailed, Unreal Engine 5 render.`;
  }

  const keysToUse = (apiKeys && apiKeys.length > 0) ? apiKeys : (apiKey ? [apiKey] : []);
  if (keysToUse.length === 0) {
    throw new Error('Chưa cấu hình API Key.');
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestType: 'GENERATE_CHARACTER_PROMPT_ONLY',
      apiKeys: keysToUse,
      payload: {
        name: char,
        gioi_tinh: gioiTinh,
        quan_ao: quanAo,
        so_thich: soThich,
        thoi_quen: thoiQuen
      }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi tạo lại prompt.');
  }

  const data = await res.json();
  return data.prompt || '';
}

interface GenCharImageParams {
  char: string;
  charPrompt: string;
  savePathCharacter: string;
  googleDrivePath: string;
  ten_tac_pham: string;
  googleStudioCookies: string[];
  googleStudioCookie: string;
  useMock: boolean;
}

export async function generateCharImageAction(params: GenCharImageParams): Promise<{ imagePath: string; projectUrl?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { char, charPrompt, savePathCharacter, googleDrivePath, ten_tac_pham, googleStudioCookies, googleStudioCookie, useMock } = params;

  if (!charPrompt) {
    throw new Error('⚠️ Vui lòng soạn thảo hoặc bấm "Gen Prompt AI" cho nhân vật trước khi sinh ảnh.');
  }

  const selectedCookie = googleStudioCookies?.[0] || googleStudioCookie;
  const drivePath = savePathCharacter || (googleDrivePath ? `${googleDrivePath.trim()}${googleDrivePath.trim().includes('/') ? '/' : '\\'}Hồ Sơ Nhân Vật` : '');

  const res = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: charPrompt,
      chapterNum: 0, // 0 cho nhân vật
      sceneIndex: 999, // 999 cho nhân vật
      promptIndex: 999,
      drivePath,
      ten_tac_pham,
      cookie: selectedCookie,
      useMock
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Lỗi không xác định từ máy chủ Google Labs Whisk.');
  }

  return await res.json();
}
