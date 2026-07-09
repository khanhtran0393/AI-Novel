import fs from 'fs';

const p = 'src/app/workspace/components/TTSConfigModal.tsx';
let s = fs.readFileSync(p, 'utf8');

const dnaStart = s.indexOf('          {/* Voice DNA / YouTube-safe */}');
const gridStart = s.indexOf(
  '          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">',
  dnaStart,
);
if (dnaStart < 0 || gridStart < 0) {
  console.error('DNA markers fail', dnaStart, gridStart);
  process.exit(1);
}

const cloneBlock = `          {/* ========== CLONE VOICE (toàn bộ catalog Vina) ========== */}
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/10 p-4 space-y-4">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Clone Voice — Toàn bộ giọng mẫu
                </div>
                <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed">
                  Catalog Vina profiles_goc · {cloneProfiles.length || cloneStatus?.profilesCount || 0} profile
                  {cloneStatus?.samplesResolved != null
                    ? \` · \${cloneStatus.samplesResolved} mẫu WAV sẵn\`
                    : ''}
                  . Độc lập — không cần Vina-Voice.exe.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded border border-zinc-800 bg-black/40 px-2.5 py-1.5 text-[10px] font-bold uppercase text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-amber-500 h-3.5 w-3.5"
                  checked={config.vinaUseClone !== false}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      platform: 'vina_voice',
                      vinaUseClone: e.target.checked,
                    })
                  }
                />
                Bật Clone Voice
              </label>
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between gap-1.5 text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="h-3.5 w-3.5 text-amber-400" /> Chọn giọng Clone
                </span>
                {config.voice && (
                  <button
                    type="button"
                    onClick={() => {
                      if (config.platform !== 'vina_voice') {
                        store.updateTTSConfig({ platform: 'vina_voice' });
                      }
                      void handlePreviewVoice();
                    }}
                    disabled={isPreviewing}
                    className="flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  >
                    {isPreviewing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Nghe Thử
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
                  const name = e.target.value;
                  if (!name) return;
                  applyCloneProfile(name);
                }}
                size={10}
                className="w-full rounded-lg border border-zinc-800 bg-black/70 px-2 py-2 text-[12px] text-zinc-200 outline-none focus:border-amber-500 cursor-pointer font-sans leading-relaxed"
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
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Giới tính</label>
                <select
                  value={config.vinaGender || 'male'}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      platform: 'vina_voice',
                      vinaGender: e.target.value as 'male' | 'female',
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-200"
                >
                  <option value="male">Nam</option>
                  <option value="female">Nữ</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Vùng miền</label>
                <select
                  value={config.vinaArea || 'southern'}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      platform: 'vina_voice',
                      vinaArea: e.target.value as 'northern' | 'central' | 'southern',
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-200"
                >
                  <option value="northern">Bắc</option>
                  <option value="central">Trung</option>
                  <option value="southern">Nam</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Phong cách</label>
                <select
                  value={config.vinaGroup || 'story'}
                  onChange={(e) =>
                    store.updateTTSConfig({ platform: 'vina_voice', vinaGroup: e.target.value })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-200"
                >
                  <option value="story">Kể chuyện</option>
                  <option value="news">Tin tức</option>
                  <option value="audiobook">Sách nói</option>
                  <option value="ads">Quảng cáo</option>
                  <option value="dubbing">Lồng tiếng</option>
                  <option value="review">Review</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Cảm xúc</label>
                <select
                  value={config.vinaEmotion || 'neutral'}
                  onChange={(e) =>
                    store.updateTTSConfig({ platform: 'vina_voice', vinaEmotion: e.target.value })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-200"
                >
                  <option value="neutral">Trung tính</option>
                  <option value="happy">Vui</option>
                  <option value="sad">Buồn</option>
                  <option value="angry">Giận</option>
                  <option value="fear">Sợ</option>
                  <option value="gentle">Dịu dàng</option>
                  <option value="tired">Mệt</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">File mẫu (WAV/MP3)</label>
                <input
                  type="text"
                  placeholder="Đường dẫn file mẫu hoặc để trống = profile"
                  value={config.vinaReferenceAudio || ''}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      platform: 'vina_voice',
                      vinaReferenceAudio: e.target.value,
                      vinaUseClone: true,
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] font-mono text-zinc-300 outline-none focus:border-amber-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Text mẫu (ref text)</label>
                <input
                  type="text"
                  placeholder="Câu đã nói trong file mẫu…"
                  value={config.vinaReferenceText || ''}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      platform: 'vina_voice',
                      vinaReferenceText: e.target.value,
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-300 outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Speaker seed</label>
                <input
                  type="number"
                  value={config.vinaSpeakerSeed ?? 2336}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      vinaSpeakerSeed: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-200"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Style seed</label>
                <input
                  type="number"
                  value={config.vinaStyleSeed ?? 4125}
                  onChange={(e) =>
                    store.updateTTSConfig({
                      vinaStyleSeed: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] text-zinc-200"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-[9px] font-bold uppercase text-zinc-500">Engine URL (optional)</label>
                <input
                  type="text"
                  placeholder="http://127.0.0.1:8765"
                  value={config.vinaEngineUrl || ''}
                  onChange={(e) => store.updateTTSConfig({ vinaEngineUrl: e.target.value })}
                  className="w-full rounded border border-zinc-800 bg-black/60 px-2 py-1.5 text-[11px] font-mono text-zinc-300"
                />
              </div>
            </div>
          </div>

`;

s = s.slice(0, dnaStart) + cloneBlock + s.slice(gridStart);

// Remove platform Voice DNA confirm
s = s.replace(
  /if \(store\.youtubeSafe\?\.lockSeriesVoice && newPlatform !== config\.platform\) \{[\s\S]*?if \(!ok\) return;\s*\}\s*/m,
  '',
);

// Remove voice Voice DNA confirm
s = s.replace(
  /if \(\s*store\.youtubeSafe\?\.lockSeriesVoice &&\s*nextVoice &&\s*nextVoice !== config\.voice\s*\) \{[\s\S]*?if \(!ok\) return;\s*\}\s*/m,
  '',
);

// Remove Sync Mode block
const syncStart = s.indexOf('            {/* Chế độ đồng bộ Timestamp (Sync Mode) */}');
const tiktokStart = s.indexOf('            {/* TikTok Session ID */}', syncStart);
if (syncStart > 0 && tiktokStart > syncStart) {
  s = s.slice(0, syncStart) + s.slice(tiktokStart);
  console.log('removed sync mode');
} else {
  console.log('sync markers', syncStart, tiktokStart);
}

s = s.replace(
  '<option value="vina_voice">VinaVoice (Clone độc lập — AI Novel)</option>',
  '<option value="vina_voice">VinaVoice / Clone Voice (mặc định)</option>',
);

// When platform is vina_voice, hide redundant voice dropdown is optional —
// wrap non-vina voice selector: leave as-is for other platforms.

fs.writeFileSync(p, s);
console.log('OK patched', p);
