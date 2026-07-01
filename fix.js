import fs from 'fs';

let content = fs.readFileSync('src/app/workspace/page.tsx', 'utf8');

// 1. Add manualDuration state
content = content.replace(
  "const [mounted, setMounted] = useState(false);",
  "const [mounted, setMounted] = useState(false);\n  const [manualDuration, setManualDuration] = useState<number>(60);"
);

// 2. Fix handleGenerateTTS payload
const oldPayload = `        body: JSON.stringify({
          cookie: activeCookie,
          text: cleanScript,
          voiceName: selectedStudioVoice,
          speed: ttsSpeed,
          googleDrivePath: store.googleDrivePath,
          chapter: store.chuong_dang_chon,
          sceneIndex: sceneIndex
        })`;
const newPayload = `        body: JSON.stringify({
          cookie: activeCookie,
          sceneText: cleanScript,
          voiceName: selectedStudioVoice,
          speed: ttsSpeed,
          drivePath: store.googleDrivePath,
          chapterNum: store.chuong_dang_chon,
          sceneIndex: sceneIndex
        })`;
content = content.replace(oldPayload, newPayload);

// 3. Fix toggle tabs
const oldTabs = `<button
                                    onClick={() => { handleStopTTS(); setOpenTabInStudio('tts'); }}
                                    className={\`flex-1 py-2 font-bold uppercase tracking-wider transition-colors border-b-2 text-center cursor-pointer \${
                                      openTabInStudio === 'tts' ? 'text-sky-400 border-sky-400 bg-sky-400/5' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                    }\`}
                                  >
                                    🎙️ TTS Studio {audioAsset && '🟢'}
                                  </button>
                                  <button
                                    onClick={() => { handleStopTTS(); setOpenTabInStudio('prompts'); }}
                                    className={\`flex-1 py-2 font-bold uppercase tracking-wider transition-colors border-b-2 text-center cursor-pointer \${
                                      openTabInStudio === 'prompts' ? 'text-purple-400 border-purple-400 bg-purple-400/5' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                    }\`}
                                  >`;
const newTabs = `<button
                                    onClick={() => { handleStopTTS(); if (openTabInStudio === 'tts') setActiveSceneIndex(null); else setOpenTabInStudio('tts'); }}
                                    className={\`flex-1 py-2 font-bold uppercase tracking-wider transition-colors border-b-2 text-center cursor-pointer \${
                                      openTabInStudio === 'tts' ? 'text-sky-400 border-sky-400 bg-sky-400/5' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                    }\`}
                                  >
                                    🎙️ TTS Studio {audioAsset && '🟢'}
                                  </button>
                                  <button
                                    onClick={() => { handleStopTTS(); if (openTabInStudio === 'prompts') setActiveSceneIndex(null); else setOpenTabInStudio('prompts'); }}
                                    className={\`flex-1 py-2 font-bold uppercase tracking-wider transition-colors border-b-2 text-center cursor-pointer \${
                                      openTabInStudio === 'prompts' ? 'text-purple-400 border-purple-400 bg-purple-400/5' : 'text-zinc-500 border-transparent hover:text-zinc-300'
                                    }\`}
                                  >`;
content = content.replace(oldTabs, newTabs);

// 4. Remove `!audioAsset` block and add manual input
const orangeBlock = `                                      {!audioAsset ? (
                                        <div className="rounded-xl border border-orange-900/40 bg-orange-950/10 p-5 flex flex-col gap-3 font-sans">
                                          <div className="flex items-center gap-2 text-xs font-bold text-orange-400 uppercase tracking-wider">
                                            <AlertTriangle className="h-4 w-4 animate-pulse" />
                                            <span>⚠️ YÊU CẦU PHÁT SINH TTS TRƯỚC</span>
                                          </div>
                                          <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                                            Hiện tại bạn chưa sinh giọng nói TTS cho phân cảnh này. Thời lượng thực tế của giọng đọc (Audio Duration) là cơ sở cốt lõi để AI tự động chia nhỏ nhịp độ, số lượng và các mốc thời gian (timestamps) của chuỗi prompt ảnh minh họa.
                                          </p>
                                          <button
                                            onClick={() => setOpenTabInStudio('tts')}
                                            className="mt-2 rounded bg-orange-500 py-2 text-xs font-bold text-black hover:bg-orange-400 transition-colors text-center cursor-pointer uppercase tracking-wider font-sans border border-orange-500 hover:brightness-105"
                                          >
                                            Chuyển sang Tab TTS Voice ➔
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-4 flex flex-col gap-4">
                                          <div className="flex items-center justify-between border-b border-zinc-900 pb-2 font-sans">
                                            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                                              <Image className="h-4 w-4 text-purple-400" /> Whisk Prompter (Tạo Ảnh Bám Sát Thời Lượng Audio)
                                            </h3>
                                            <span className="text-[9px] rounded bg-purple-950/40 border border-purple-900/50 px-2.5 py-0.5 font-bold text-purple-400 uppercase font-mono">
                                              ⏱️ Audio: {audioAsset.duration} giây
                                            </span>
                                          </div>`;
const newOrangeBlock = `                                        <div className="rounded-xl border border-zinc-900 bg-zinc-900/10 p-4 flex flex-col gap-4">
                                          <div className="flex items-center justify-between border-b border-zinc-900 pb-2 font-sans">
                                            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                                              <Image className="h-4 w-4 text-purple-400" /> Whisk Prompter (Tạo Ảnh Bám Sát Thời Lượng Audio)
                                            </h3>
                                            <span className="text-[9px] rounded bg-purple-950/40 border border-purple-900/50 px-2.5 py-0.5 font-bold text-purple-400 uppercase font-mono">
                                              ⏱️ Audio: {audioAsset ? audioAsset.duration + ' giây' : 'Ước tính'}
                                            </span>
                                          </div>
                                          
                                          {!audioAsset && (
                                            <div className="rounded border border-orange-900/40 bg-orange-950/10 p-3 flex flex-col gap-2 font-sans">
                                              <div className="flex items-center gap-2 text-[10px] font-bold text-orange-400 uppercase tracking-wider">
                                                <AlertTriangle className="h-3 w-3" />
                                                <span>Chưa có TTS (Nhập thời lượng thủ công)</span>
                                              </div>
                                              <div className="flex gap-2 items-center">
                                                <input 
                                                  type="number" 
                                                  value={manualDuration} 
                                                  onChange={(e) => setManualDuration(Number(e.target.value))} 
                                                  className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-orange-500"
                                                  min="5"
                                                />
                                                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">giây (Làm căn cứ để AI tạo độ dài video)</span>
                                              </div>
                                            </div>
                                          )}`;
content = content.replace(orangeBlock, newOrangeBlock);

// 5. Fix `audioAsset.duration` to fallback to manualDuration in Prompter
content = content.replace(
  "onClick={() => handleGeneratePromptsAlignedToAudio(scene.content, idx, audioAsset.duration)}",
  "onClick={() => handleGeneratePromptsAlignedToAudio(scene.content, idx, audioAsset ? audioAsset.duration : manualDuration)}"
);

// 6. Fix `audioAsset.duration` in Video Compiler
content = content.replace(
  "onClick={() => handleGenerateAnimaticVideo(idx, audioAsset.duration)}",
  "onClick={() => handleGenerateAnimaticVideo(idx, audioAsset ? audioAsset.duration : manualDuration)}"
);

// 7. Fix `audioAsset.duration` in Timeline display
content = content.replace(
  "⏱️ 0:00 / {audioAsset.duration}s",
  "⏱️ 0:00 / {audioAsset ? audioAsset.duration : manualDuration}s"
);

// 8. Fix the closing brackets!
// Since we removed `{!audioAsset ? ( ... ) : ( <div ...> ... </div> )}`
// We need to remove the matching `)}` that closes it.
// The matching `)}` is around line 2144. It is right below `</div>` of the `<div className="rounded-xl...` block.
// Let's find it.
const closingBlock = `                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}`;
const newClosingBlock = `                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                      </div>
                                    )}
                                  </div>
                                )}`;
content = content.replace(closingBlock, newClosingBlock);

fs.writeFileSync('src/app/workspace/page.tsx', content);
console.log("Fixed!");
