import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function generateCapCutTTS(text: string, voiceId: string): Promise<Buffer> {
  
  // Sửa config.py của CapCut API bằng Node.js trước khi chạy
  const capcutDir = path.join(process.cwd(), 'src', 'app', 'api', 'generate-tts', 'capcut_api', 'capcut_windows');
  const configPath = path.join(capcutDir, 'config.py');
  
  if (fs.existsSync(configPath)) {
    let configContent = fs.readFileSync(configPath, 'utf8');
    // Regex replace VOICE_RESOURCE_ID or VOICE_NAME
    configContent = configContent.replace(/VOICE_RESOURCE_ID\s*=\s*['"][^'"]*['"]/, `VOICE_RESOURCE_ID = "${voiceId}"`);
    configContent = configContent.replace(/VOICE_NAME\s*=\s*['"][^'"]*['"]/, `VOICE_NAME = "Giọng CapCut"`);
    
    // Tự động dò tìm thư mục CapCut để lấy sscronet.dll
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    const capcutAppsDir = path.join(localAppData, 'CapCut', 'Apps');
    if (fs.existsSync(capcutAppsDir)) {
      const versions = fs.readdirSync(capcutAppsDir).filter(f => fs.statSync(path.join(capcutAppsDir, f)).isDirectory());
      versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // Lấy bản mới nhất
      for (const v of versions) {
         const dllPath = path.join(capcutAppsDir, v, 'sscronet.dll');
         if (fs.existsSync(dllPath)) {
            // Cập nhật đường dẫn DLL
            configContent = configContent.replace(/SSCRONET_DLL\s*=\s*r?['"][^'"]*['"]/, `SSCRONET_DLL = r"${dllPath.replace(/\\/g, '\\\\')}"`);
            break;
         }
      }
    }

    fs.writeFileSync(configPath, configContent);
  } else {
    throw new Error('Không tìm thấy config.py của CapCut TTS API.');
  }

  // Chạy python script
  try {
    const output = execSync(`python capcut_tts_ctypes.py "${text}"`, { cwd: capcutDir, encoding: 'utf8', stdio: 'pipe' });
    
    // Parse Audio URL từ stdout
    const urlMatch = output.match(/Audio URL:\s*(https?:\/\/[^\s]+)/);
    if (urlMatch && urlMatch[1]) {
      const audioUrl = urlMatch[1];
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error('Không thể tải file âm thanh từ CapCut.');
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else {
      throw new Error('CapCut TTS API không trả về URL âm thanh hợp lệ.');
    }
  } catch (error: unknown) {
    throw new Error(`CapCut TTS thất bại: ${(error as Error).message}`);
  }
}

