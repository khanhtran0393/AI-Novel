import fs from 'fs';

const p = 'src/app/workspace/components/TTSConfigModal.tsx';
let s = fs.readFileSync(p, 'utf8');

const bodyStart = s.indexOf('        {/* Body */}');
const footerStart = s.indexOf('        {/* Footer */}');
if (bodyStart < 0 || footerStart < 0) {
  console.error('markers missing', bodyStart, footerStart);
  process.exit(1);
}

const newBody = `        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Chọn 1 trong 2 chế độ — không hiện cả hai cùng lúc */}
          <div className="flex rounded-lg border border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => {
                store.updateTTSConfig({ platform: 'vina_voice', vinaUseClone: true });
                if (cloneProfiles[0] && !cloneProfiles.some((p) => p.name === config.voice)) {
                  applyCloneProfile(cloneProfiles[0].name);
                }
              }}
              className={\`flex-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors \${
                config.platform === 'vina_voice'
                  ? 'bg-amber-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }\`}
            >
              Clone Voice
            </button>
            <button
              type="button"
              onClick={() => {
                const next =
                  config.platform === 'vina_voice' ? 'edge_tts' : config.platform;
                const nextVoiceConfig = getDefaultVoiceConfig(
                  dynamicVoices,
                  next === 'vina_voice' ? 'edge_tts' : next,
                  config.language || 'vi',
                );
                store.updateTTSConfig({
                  platform: next === 'vina_voice' ? 'edge_tts' : next,
                  language: nextVoiceConfig.language,
                  voice: nextVoiceConfig.voice,
                  vinaUseClone: false,
                });
              }}
              className={\`flex-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition-colors border-l border-zinc-800 \${
                config.platform !== 'vina_voice'
                  ? 'bg-sky-500 text-black'
                  : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'
              }\`}
            >
              Engine khác
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 -mt-2">
            {config.platform === 'vina_voice'
              ? 'Đang dùng Clone Voice: chỉ chọn 1 giọng mẫu bên dưới.'
              : 'Đang dùng Engine khác: chọn nền tảng + giọng của engine đó.'}
          </p>

          {config.platform === 'vina_voice' ? (
            /* ===== CHỈ Clone Voice ===== */
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                    Chọn giọng
                    <span className="normal-case font-medium text-zinc-600 tracking-normal">
                      ({cloneProfiles.length || 0})
                    </span>
                  </span>
                  {config.voice && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      disabled={isPreviewing}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Nghe thử
                    </button>
                  )}
                </label>
                <select
                  value={
                    cloneProfiles.some((p) => p.name === (config.voice || ''))
                      ? config.voice
                      : cloneProfiles[0]?.name || ''
                  }
                  onChange={(e) => {
                    if (e.target.value) applyCloneProfile(e.target.value);
                  }}
                  className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/70 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-amber-500 cursor-pointer"
                >
                  {(cloneProfiles.length
                    ? cloneProfiles
                    : [{ name: 'vi-VN-NamMinhNeural', hasSample: false }]
                  ).map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.hasSample ? '🎤' : '○'} {p.name}
                    </option>
                  ))}
                </select>
                {config.voice && (
                  <p className="text-[10px] text-zinc-500 truncate" title={config.vinaReferenceAudio || ''}>
                    {config.vinaReferenceAudio
                      ? \`Mẫu: \${config.vinaReferenceAudio}\`
                      : 'Giọng builtin (không có file mẫu)'}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    Tốc độ
                  </label>
                  <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={config.speed}
                      onChange={(e) =>
                        store.updateTTSConfig({ speed: parseFloat(e.target.value) })
                      }
                      className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm font-bold text-zinc-300 w-10 text-right">
                      {Number(config.speed || 1).toFixed(1)}x
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    Pitch
                  </label>
                  <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                    <input
                      type="range"
                      min="-12"
                      max="12"
                      step="1"
                      value={config.pitch || 0}
                      onChange={(e) =>
                        store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) })
                      }
                      className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm font-bold text-zinc-300 w-12 text-right">
                      {(config.pitch || 0) > 0 ? \`+\${config.pitch}\` : config.pitch || 0}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ===== CHỈ Engine khác ===== */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  <Cpu className="h-3.5 w-3.5 text-sky-400" /> Nền tảng
                </label>
                <div className="relative w-full">
                  <select
                    value={config.platform}
                    onChange={(e) => {
                      const newPlatform = e.target.value as typeof config.platform;
                      if (newPlatform === 'vina_voice') {
                        store.updateTTSConfig({ platform: 'vina_voice', vinaUseClone: true });
                        return;
                      }
                      const nextVoiceConfig = getDefaultVoiceConfig(
                        dynamicVoices,
                        newPlatform,
                        config.language,
                      );
                      store.updateTTSConfig({
                        platform: newPlatform,
                        language: nextVoiceConfig.language,
                        voice: nextVoiceConfig.voice,
                        vinaUseClone: false,
                      });
                    }}
                    className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 pr-10 text-sm text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="edge_tts">Microsoft Edge TTS</option>
                    <option value="omnivoice_local">OmniVoice Local</option>
                    <option value="piper">Piper Local</option>
                    <option value="hotai_tts">Hotai TTS</option>
                    <option value="openai_tts">OpenAI TTS</option>
                    <option value="capcut_tts">CapCut TTS</option>
                    <option value="tiktok_tts">TikTok TTS</option>
                    <option value="gemini_tts">Google Gemini TTS</option>
                    <option value="vieneu_tts">VieNeu-TTS</option>
                    <option value="elevenlabs">ElevenLabs</option>
                    <option value="vbee">VBee Studio</option>
                    <option value="google">Google Cloud</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <Globe className="h-3.5 w-3.5 text-emerald-400" /> Ngôn ngữ
                </label>
                <div className="relative w-full">
                  <select
                    value={config.language}
                    onChange={(e) => {
                      const newLang = e.target.value;
                      const nextVoiceConfig = getDefaultVoiceConfig(
                        dynamicVoices,
                        config.platform,
                        newLang,
                      );
                      store.updateTTSConfig({
                        language: nextVoiceConfig.language,
                        voice: nextVoiceConfig.voice,
                      });
                    }}
                    className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 pr-10 text-sm text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="flex items-center justify-between gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Giọng đọc
                    <span className="normal-case font-medium text-zinc-600 tracking-normal">
                      ({currentVoices.length})
                    </span>
                  </span>
                  {config.voice && (
                    <button
                      type="button"
                      onClick={() => void handlePreviewVoice()}
                      disabled={isPreviewing}
                      className="flex items-center gap-1.5 px-3 py-1 rounded bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 disabled:opacity-50"
                    >
                      {isPreviewing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      Nghe thử
                    </button>
                  )}
                </label>
                <div className="relative w-full">
                  <select
                    value={activeVoiceId}
                    onChange={(e) => store.updateTTSConfig({ voice: e.target.value })}
                    className="w-full appearance-none rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 pr-10 text-sm text-zinc-200 outline-none focus:border-sky-500 cursor-pointer"
                  >
                    {currentVoices.length === 0 && (
                      <option value="">Không có giọng</option>
                    )}
                    {currentVoices.map((v: { id: string; name: string }) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  Tốc độ
                </label>
                <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={config.speed}
                    onChange={(e) =>
                      store.updateTTSConfig({ speed: parseFloat(e.target.value) })
                    }
                    className="w-full accent-amber-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm font-bold text-zinc-300 w-10 text-right">
                    {Number(config.speed || 1).toFixed(1)}x
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                  Pitch
                </label>
                <div className="flex items-center gap-3 bg-black/60 border border-zinc-800 rounded-lg p-2">
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="1"
                    value={config.pitch || 0}
                    onChange={(e) =>
                      store.updateTTSConfig({ pitch: parseInt(e.target.value, 10) })
                    }
                    className="w-full accent-indigo-500 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-sm font-bold text-zinc-300 w-12 text-right">
                    {(config.pitch || 0) > 0 ? \`+\${config.pitch}\` : config.pitch || 0}
                  </span>
                </div>
              </div>

              {config.platform === 'tiktok_tts' && (
                <div className="space-y-2 md:col-span-2 pt-2 border-t border-zinc-800">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    SessionID TikTok
                  </label>
                  <input
                    type="text"
                    placeholder="sessionid cookie (tuỳ chọn)"
                    value={config.tiktokSessionId}
                    onChange={(e) => store.updateTTSConfig({ tiktokSessionId: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-sky-500"
                  />
                </div>
              )}

              {config.platform === 'vieneu_tts' && (
                <div className="space-y-2 md:col-span-2 pt-2 border-t border-zinc-800">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                    VieNeu API URL
                  </label>
                  <input
                    type="text"
                    placeholder="http://localhost:3000/api/v1"
                    value={config.api_url_vieneu || ''}
                    onChange={(e) => store.updateTTSConfig({ api_url_vieneu: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-black/60 px-3 py-2.5 text-sm font-mono text-zinc-200 outline-none focus:border-emerald-500"
                  />
                </div>
              )}
            </div>
          )}
        </div>

`;

s = s.slice(0, bodyStart) + newBody + s.slice(footerStart);
fs.writeFileSync(p, s);
console.log('simplified TTS modal body OK');
