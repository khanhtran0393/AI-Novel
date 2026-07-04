const fs = require('fs');
const path = require('path');

// 1. useNovelStore.ts
const storePath = path.join('src', 'store', 'useNovelStore.ts');
let storeCode = fs.readFileSync(storePath, 'utf8');
storeCode = storeCode.replace(
  "platform: 'tiktok_tts' | 'edge_tts' | 'vbee' | 'google' | 'elevenlabs' | 'capcut_tts' | 'piper' | 'gemini_tts' | 'omnivoice_local' | 'openai_tts' | 'hotai_tts';",
  "platform: 'tiktok_tts' | 'edge_tts' | 'vbee' | 'google' | 'elevenlabs' | 'capcut_tts' | 'piper' | 'gemini_tts' | 'omnivoice_local' | 'openai_tts' | 'hotai_tts' | 'vieneu_tts';"
);
fs.writeFileSync(storePath, storeCode);

// 2. TTSConfigModal.tsx
const modalPath = path.join('src', 'app', 'workspace', 'components', 'TTSConfigModal.tsx');
let modalCode = fs.readFileSync(modalPath, 'utf8');

// Insert VOICES block back
const vbeeIndex = modalCode.indexOf('  vbee: {');
const vieneuVoices = `  vieneu_tts: {
    vi: [
      { id: 'Adam 1', name: 'Adam 1' },
      { id: 'Adam 2', name: 'Adam 2' },
      { id: 'Adam 3', name: 'Adam 3' },
      { id: 'Adam 4', name: 'Adam Trí Dũng' },
      { id: 'Ngọc Huyền', name: 'Ngọc Huyền (Truyện Audio)' },
      { id: 'Đức Trung', name: 'Đức Trung' },
      { id: 'Quang Anh', name: 'Quang Anh' },
      { id: 'Trung Quân', name: 'Trung Quân' },
      { id: 'Trường An', name: 'Trường An (Phật Pháp)' },
      { id: 'Chi Chi', name: 'Chi Chi' },
      { id: 'Vy Tin Tức', name: 'Vy Tin Tức' },
      { id: 'My Review', name: 'My Review' },
      { id: 'Dung Lồng Tiếng', name: 'Dung Lồng Tiếng' },
      { id: 'Hùng Dung', name: 'Hùng Dung' },
      { id: 'Thanh Vân', name: 'Thanh Vân' },
      { id: 'Phương Thảo', name: 'Phương Thảo' },
      { id: 'Thanh Mai', name: 'Thanh Mai' },
      { id: 'Tùng Sơn', name: 'Tùng Sơn' },
      { id: 'Minh Khôi', name: 'Minh Khôi' }
    ],
    en: [
      { id: 'Bình An', name: 'Bình An (Bilingual)' }
    ]
  },
`;
if (vbeeIndex !== -1 && !modalCode.includes('vieneu_tts: {')) {
  modalCode = modalCode.substring(0, vbeeIndex) + vieneuVoices + modalCode.substring(vbeeIndex);
}

// Insert option back
const geminiIndex = modalCode.indexOf('<option value="gemini_tts">Google Gemini TTS</option>');
if (geminiIndex !== -1 && !modalCode.includes('value="vieneu_tts"')) {
  modalCode = modalCode.substring(0, geminiIndex + 55) + '\n                  <option value="vieneu_tts">VieNeu-TTS (Local AI)</option>' + modalCode.substring(geminiIndex + 55);
}

// Insert input field back
const vipNotifierIndex = modalCode.indexOf('{/* VIP Settings Notifier */}');
const vieneuInput = `            {/* VieNeu-TTS API URL */}
            {config.platform === 'vieneu_tts' && (
              <div className="space-y-2 md:col-span-2 mt-2 pt-4 border-t border-zinc-800">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    VieNeu-TTS Server API (Ví dụ: http://localhost:3000/api/v1)
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="http://localhost:3000/api/v1"
                  value={config.api_url_vieneu || 'http://localhost:3000/api/v1'}
                  onChange={(e) => store.updateTTSConfig({ api_url_vieneu: e.target.value })}
                  className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
            )}
            
`;
if (vipNotifierIndex !== -1 && !modalCode.includes('config.platform === \'vieneu_tts\'')) {
  modalCode = modalCode.substring(0, vipNotifierIndex) + vieneuInput + modalCode.substring(vipNotifierIndex);
}

fs.writeFileSync(modalPath, modalCode);
console.log('Restored TTSConfigModal.tsx and useNovelStore.ts');
