// AI handlers cho Editor Pro. Text→cli-bridge (Claude), TTS→macOS say (offline, giọng Việt), clip→yt-dlp.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const FFMPEG_BIN = require('./ff-path').FFMPEG;   // đường dẫn đã gỡ khỏi app.asar (spawn được)
const TTS_TMP = path.join(os.tmpdir(), 'nova-editor-pro');
try { fs.mkdirSync(TTS_TMP, { recursive: true }); } catch (_) {}
function _run(bin, args) { return new Promise((res, rej) => { const p = spawn(bin, args, { windowsHide: true }); let e = ''; p.stderr.on('data', d => e += d); p.on('error', rej); p.on('close', c => c === 0 ? res() : rej(new Error(e.slice(-200)))); }); }
// macOS say → mp3 (offline TTS, không cần key)
async function sayToMp3(text, voice) {
  const base = path.join(TTS_TMP, `voice_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const aiff = base + '.aiff', mp3 = base + '.mp3';
  const txtFile = base + '.txt'; fs.writeFileSync(txtFile, String(text || ''));
  await _run('say', ['-v', voice || 'Linh', '-o', aiff, '-f', txtFile]);
  await _run(FFMPEG_BIN, ['-i', aiff, '-codec:a', 'libmp3lame', '-qscale:a', '2', '-y', mp3]);
  try { fs.unlinkSync(aiff); fs.unlinkSync(txtFile); } catch (_) {}
  return mp3;
}

function registerEditorProAI(ipcMain, opts = {}) {
  const emptyFind = async () => ({ ok: true, results: [], items: [] });
  const emptyList = async () => [];

  // Điểm gọi AI TRUNG TÂM của "Tạo với AI" (script/cảnh) → route sang cli-bridge Nova (Claude/Codex CLI).
  const CLI_BRIDGE = { claude: 'http://127.0.0.1:8790/chat/completions', codex: 'http://127.0.0.1:8791/chat/completions' };
  async function runPromptViaCliBridge({ system = '', user = '', model = '', json = false }) {
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: String(user || '') + (json ? '\n\nCHỈ trả về JSON hợp lệ, KHÔNG giải thích, KHÔNG ```.' : '') });
    const engine = String(model || '').toLowerCase().includes('codex') || String(model || '').toLowerCase().includes('gpt') ? 'codex' : 'claude';
    const url = CLI_BRIDGE[engine] || CLI_BRIDGE.claude;
    const m = (model === 'opus' || model === 'sonnet') ? model : 'sonnet';
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, model: m }) });
    if (!resp.ok) throw new Error('cli-bridge HTTP ' + resp.status);
    const data = await resp.json();
    const content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (!content) throw new Error((data && data.error && data.error.message) || 'cli-bridge không trả nội dung (Claude CLI đã đăng nhập chưa?)');
    return content;
  }

  const H = {
    // AI text trung tâm (script, chia cảnh, gợi ý...) → Claude/Codex CLI
    'mcp:videoCreator:runPrompt': async (_e, payload = {}) => {
      try { return { ok: true, content: await runPromptViaCliBridge(payload) }; }
      catch (e) { return { ok: false, error: 'AI (cli-bridge Nova): ' + String(e && e.message || e) }; }
    },
    // TTS / voiceover — dùng macOS say (offline, giọng Việt "Linh", không cần key)
    'ai:ttsGenerate': async (_e, payload = {}) => {
      try {
        const text = String(payload.text || payload.script || payload.content || '').trim();
        if (!text) return { ok: false, error: 'Thiếu văn bản' };
        const voice = payload.voiceId || payload.voice || 'Linh';
        const mp3 = await sayToMp3(text, voice);
        return { ok: true, path: mp3, file: mp3 };
      } catch (e) { return { ok: false, error: 'TTS (macOS say): ' + String(e.message || e) }; }
    },
    'ai:listVoices': async () => ([
      { id: 'Linh', name: 'Linh (Tiếng Việt)', language: 'vi' },
      { id: 'Samantha', name: 'Samantha (English)', language: 'en' },
      { id: 'Alex', name: 'Alex (English)', language: 'en' },
      { id: 'Daniel', name: 'Daniel (English UK)', language: 'en' },
    ]),
    'ai:cleanupVoiceover': async () => ({ ok: true }),
    // Transcribe — Phase 3 đấu Whisper local của Nova. Tạm rỗng.
    'ai:transcribe': async () => ({ ok: true, text: '', segments: [], language: '' }),
    // Tìm media — Phase 3 đấu yt-dlp/pexels. Tạm rỗng để UI không lỗi.
    'ai:findVideos': emptyFind, 'ai:findImages': emptyFind, 'ai:findYoutubeVideos': emptyFind,
    'ai:findPexelsImages': emptyFind, 'ai:findPexelsVideos': emptyFind, 'ai:findFacebookVideos': emptyFind,
    'ai:findDailymotionVideos': emptyFind, 'ai:findYarnClips': emptyFind, 'ai:downloadImages': emptyFind,
    'ai:downloadVideos': emptyFind, 'ai:suggestYoutubeLinks': emptyFind,
    // Gợi ý text — Phase 3 đấu cli-bridge. Tạm rỗng.
    'ai:suggestTitle': async () => ({ ok: true, title: '' }),
    'ai:suggestTitles': async () => ({ ok: true, titles: [] }),
    'ai:suggestAngle': async () => ({ ok: true, angle: '' }),
    'ai:randomTopic': async () => ({ ok: true, topic: '' }),
    'ai:research': async () => ({ ok: true, text: '', sources: [] }),
    'ai:granularBreakdown': async () => ({ ok: true, sections: [] }),
    'ai:generateMusic': async () => ({ ok: false, error: 'Nhạc AI: Phase 3' }),
    'ai:generateThumbnailFromScript': async () => ({ ok: false, error: 'Thumbnail AI: Phase 3' }),
    'ai:motionGraphicsFromImage': async () => ({ ok: false, error: 'Phase 3' }),
    'ai:promptFromImage': async () => ({ ok: true, prompt: '' }),
    'ai:ideaPlannerExploreTopic': async () => ({ ok: true, ideas: [] }),
    'ai:ideaPlannerSuggestIdeas': async () => ({ ok: true, ideas: [] }),
    'ai:ensureHandlers': async () => ({ ok: true }),
    // Render Remotion — Phase 3 (cần @remotion/renderer + bundle). Báo rõ.
    'renderRemotionVideo': async () => ({ ok: false, error: 'Render Remotion: Phase 3 (chưa nối @remotion/renderer)' }),
    'aiVideoGenerate': async () => ({ ok: false, error: 'Gen video AI: Phase 3' }),
  };
  for (const [ch, fn] of Object.entries(H)) {
    try { ipcMain.removeHandler(ch); } catch (_) {}
    ipcMain.handle(ch, fn);
  }
  return Object.keys(H);
}

module.exports = { registerEditorProAI };
