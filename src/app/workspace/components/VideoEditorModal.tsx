import React, { useRef, useState } from 'react';
import { X, Play } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import { getEdgePresetList } from '@/lib/voiceCatalog';

export interface VideoEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CustomCheckbox = ({ checked, onChange, label, className = "" }: { checked: boolean, onChange: (val: boolean) => void, label: string, className?: string }) => (
  <label className={`flex items-center gap-2 cursor-pointer select-none ${className}`}>
    <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <div className={`w-[16px] h-[16px] rounded flex items-center justify-center border transition-colors ${checked ? 'bg-orange-500 border-orange-500' : 'border-slate-500 bg-slate-950'}`}>
      {checked && <div className="w-2 h-2 bg-black rounded-sm" />}
    </div>
    <span className="text-[11px] font-medium text-slate-200">{label}</span>
  </label>
);

const OrangeTab = ({ active, children, onClick }: { active?: boolean, children: React.ReactNode, onClick?: () => void }) => (
  <button 
    onClick={onClick}
    className={`flex-1 py-1 rounded text-center text-[10px] font-bold border transition-colors ${active ? 'bg-orange-500 border-orange-500 text-black' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
  >
    {children}
  </button>
);

const SectionPanel = ({ title, index, children }: { title: string, index: number | string, children: React.ReactNode }) => (
  <div className="bg-[#0f172a] border border-[#334155] rounded-lg mt-3 relative pb-2 shadow-md">
    <div className="absolute -top-2.5 left-3 bg-[#1e293b] border border-[#475569] text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-sm z-10">
      {index}. {title}
    </div>
    <div className="px-3 pt-4 pb-1 flex flex-col gap-2">
      {children}
    </div>
  </div>
);

const CAPASSISTANT_TTS_VOICES = getEdgePresetList().map((p) => ({
  name: p.name,
  tiktok: p.tiktok || 'BV074_streaming',
  edge: p.edge,
  preview: p.edge.startsWith('vi-')
    ? 'Xin chào, đây là giọng đọc thử của hệ thống AI Novel.'
    : 'Hello, this is a voice preview for the AI Novel system.',
}));

type SrtEditorState = {
  open: boolean;
  title: string;
  target: 'original' | 'translated';
  text: string;
};

export default function VideoEditorModal({ isOpen, onClose }: VideoEditorModalProps) {
  const store = useNovelStore();
  const renderAbortRef = useRef<AbortController | null>(null);
  
  const [videoPath, setVideoPath] = useState('');
  const [videoList, setVideoList] = useState<string[]>([]);
  
  // 1. Video & Tốc độ & Phóng to
  const [exportRatio, setExportRatio] = useState('Giữ nguyên (Theo Video đầu tiên)');
  const [zoom, setZoom] = useState('100');
  const [speed, setSpeed] = useState('100');
  const [mute, setMute] = useState(false);
  const [vocalFilter, setVocalFilter] = useState(false);
  const [flip, setFlip] = useState(false);
  const [gpu, setGpu] = useState(true);
  const [volume, setVolume] = useState('100');
  
  // 2. Phụ đề & Âm thanh Tự động
  const [enableSub, setEnableSub] = useState(true);
  const [srtMode, setSrtMode] = useState<'translated'|'untranslated'|'auto'>('translated');
  const [srtPath, setSrtPath] = useState('');
  const [srtContent, setSrtContent] = useState('');
  const [translatedSrtContent, setTranslatedSrtContent] = useState('');
  const [audioLang, setAudioLang] = useState('Tiếng Trung (ZH)');
  const [tgtLang, setTgtLang] = useState('Tiếng Việt (VI)');
  const [masterVoice, setMasterVoice] = useState(CAPASSISTANT_TTS_VOICES[0].name);
  const [masterSpeed, setMasterSpeed] = useState('1.2');
  const [aiEngine, setAiEngine] = useState('CPU (Chậm - Ổn định)');
  const [srtFont, setSrtFont] = useState('UTM_Bebas');
  const [srtSize, setSrtSize] = useState('24');
  const [srtDelay, setSrtDelay] = useState('0.00');

  // 3. Playlist Nhạc Nền
  const [musicList, setMusicList] = useState<{path: string, vol: string, delay: string, dur: string, loop: boolean}[]>([]);
  const [selectedMusicIndex, setSelectedMusicIndex] = useState<number | null>(null);
  const [presetAudios, setPresetAudios] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['', '', '', ''];
    try {
      const parsed = JSON.parse(window.localStorage.getItem('capassistant_preset_audios') || '[]');
      return Array.from({ length: 4 }, (_, index) => String(parsed[index] || ''));
    } catch {
      return ['', '', '', ''];
    }
  });
  const [mVol, setMVol] = useState('100');
  const [mDelay, setMDelay] = useState('0.00');
  const [mDur, setMDur] = useState('0.00');
  const [mLoop, setMLoop] = useState(false);

  // 4. Kiểu Phụ Đề & Vùng Che Mờ
  const [srtStyle, setSrtStyle] = useState('Viền đen nổi bật (Mặc định)');
  const [bgPadding, setBgPadding] = useState(false);
  const [padX, setPadX] = useState('16');
  const [padY, setPadY] = useState('6');
  const [smartBlur, setSmartBlur] = useState(false);
  const [blurs, setBlurs] = useState<{x:string,y:string,w:string,h:string,start:string,dur:string}[]>([]);
  const [blurX, setBlurX] = useState('0');
  const [blurY, setBlurY] = useState('0');
  const [blurW, setBlurW] = useState('180');
  const [blurH, setBlurH] = useState('30');
  const [blurStart, setBlurStart] = useState('');
  const [blurDur, setBlurDur] = useState('');
  const [blurPower, setBlurPower] = useState('20');

  // 5. Thương hiệu
  const [useLogo, setUseLogo] = useState(false);
  const [logoPath, setLogoPath] = useState('');
  const [presetLogos, setPresetLogos] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['', '', '', ''];
    try {
      const parsed = JSON.parse(window.localStorage.getItem('capassistant_preset_logos') || '[]');
      return Array.from({ length: 4 }, (_, index) => String(parsed[index] || ''));
    } catch {
      return ['', '', '', ''];
    }
  });
  const [logoRescale, setLogoRescale] = useState('10');
  const [logoDelay, setLogoDelay] = useState('0');
  const [useStaticText, setUseStaticText] = useState(true);
  const [staticText, setStaticText] = useState('');
  const [staticFont, setStaticFont] = useState('UTM_Bebas');
  const [staticSize, setStaticSize] = useState('32');
  const [staticDelay, setStaticDelay] = useState('0');
  const [useWm, setUseWm] = useState(false);
  const [wmText, setWmText] = useState('CapAssistant');
  const [wmDelay, setWmDelay] = useState('0');
  
  // 6. Trim
  const [enableTrim, setEnableTrim] = useState(false);
  const [trims, setTrims] = useState<{start:string,end:string}[]>([]);

  // 7. Lách AI
  const [enableFrame, setEnableFrame] = useState(false);
  const [framePath, setFramePath] = useState('');
  const [bypassFx, setBypassFx] = useState('Không (None)');
  const [rotate, setRotate] = useState('0');
  const [bright, setBright] = useState('0');
  const [contrast, setContrast] = useState('100');
  const [sat, setSat] = useState('100');

  const [outputPath, setOutputPath] = useState('C:\\Users\\Khanh\\Downloads');
  
  const [isRendering, setIsRendering] = useState(false);
  const [renderLog, setRenderLog] = useState('');
  const [progress, setProgress] = useState(0);
  const [lastResultPath, setLastResultPath] = useState('');
  const [panelLog, setPanelLog] = useState('Ready.');
  const [srtEditor, setSrtEditor] = useState<SrtEditorState>({
    open: false,
    title: '',
    target: 'original',
    text: '',
  });

  if (!isOpen) return null;

  const readStreamingText = async (res: Response, onChunk: (chunk: string) => void) => {
    if (!res.body) throw new Error("Stream API khong hoat dong");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let fullText = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = decoder.decode(value, { stream: true });
      fullText += chunk;
      onChunk(chunk);
    }
    return fullText;
  };

  const appendPanelLog = (message: string) => {
    setPanelLog(prev => `${prev}\n${message}`);
  };

  const selectLocalFiles = async (kind: 'video' | 'srt' | 'audio' | 'image' | 'png', title: string, multi = false) => {
    try {
      const res = await fetch('/api/capassistant/select-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title, multi }),
      });
      const data = await res.json();
      if (data?.paths?.length) return data.paths as string[];
      return [];
    } catch {
      const p = prompt(`${title} - nhap duong dan file:`, '');
      return p ? [p] : [];
    }
  };

  const readTextFile = async (filePath: string) => {
    const res = await fetch('/api/capassistant/file-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', path: filePath }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Khong doc duoc file.');
    return String(data.content || '');
  };

  const writeTextFile = async (filePath: string, content: string) => {
    const res = await fetch('/api/capassistant/file-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write', path: filePath, content }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Khong ghi duoc file.');
  };

  const openLocalPath = async (targetPath: string) => {
    if (!targetPath) {
      alert('Chua co file de mo.');
      return;
    }
    const res = await fetch('/api/capassistant/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Khong mo duoc file: ${data.error || 'unknown error'}`);
      return;
    }
    appendPanelLog(`[OPEN] ${data.opened}`);
  };

  const syncVoiceConfig = (voiceName = masterVoice, speedValue = masterSpeed) => {
    const voice = CAPASSISTANT_TTS_VOICES.find(item => item.name === voiceName) || CAPASSISTANT_TTS_VOICES[0];
    store.updateTTSConfig({
      platform: 'edge_tts',
      language: voice.edge.startsWith('vi-') ? 'vi' : 'en',
      voice: voice.edge,
      speed: Number(speedValue) || 1,
      pitch: 0,
    });
  };

  const handleVoiceChange = (voiceName: string) => {
    setMasterVoice(voiceName);
    syncVoiceConfig(voiceName, masterSpeed);
  };

  const handleVoiceSpeedChange = (speedValue: string) => {
    setMasterSpeed(speedValue);
    syncVoiceConfig(masterVoice, speedValue);
  };

  const handleSelectVideo = async () => {
    const paths = await selectLocalFiles('video', 'Chon Video', true);
    if (paths.length === 0) return;
    setVideoPath(paths[0]);
    setVideoList(prev => Array.from(new Set([...prev, ...paths])));
    appendPanelLog(`[VIDEO] Da nap ${paths.length} file.`);
  };

  const handleSuggestThumbnail = async () => {
    const activeVideo = videoPath || videoList[0];
    if (!activeVideo) {
      alert('Vui long chon video truoc.');
      return;
    }
    const res = await fetch('/api/capassistant/thumbnail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: activeVideo, outputPath, count: 4 }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Khong tao duoc thumbnail: ${data.error || data.errors?.[0] || 'unknown error'}`);
      return;
    }
    appendPanelLog(`[THUMB] ${data.thumbnails.length} thumbnail -> ${data.outputDir}`);
    alert(`Da tao ${data.thumbnails.length} thumbnail:\n${data.thumbnails.join('\n')}`);
  };

  const handleSelectSrt = async () => {
    const paths = await selectLocalFiles('srt', 'Chon SRT Goc', false);
    if (paths.length === 0) return;
    const content = await readTextFile(paths[0]);
    setSrtPath(paths[0]);
    setSrtContent(content);
    setEnableSub(true);
    if (srtMode === 'translated') setTranslatedSrtContent(content);
    appendPanelLog(`[SRT] Da nap ${paths[0]}`);
  };

  const openSrtEditor = async (target: 'original' | 'translated') => {
    let text = target === 'original' ? srtContent : translatedSrtContent;
    if (!text && target === 'original' && srtPath) {
      text = await readTextFile(srtPath);
      setSrtContent(text);
    }
    if (!text && target === 'translated') text = srtContent;
    setSrtEditor({
      open: true,
      target,
      title: target === 'original' ? 'SRT Goc' : 'SRT Da Dich',
      text,
    });
  };

  const saveSrtEditor = async () => {
    if (srtEditor.target === 'original') {
      setSrtContent(srtEditor.text);
      if (srtPath) await writeTextFile(srtPath, srtEditor.text);
    } else {
      setTranslatedSrtContent(srtEditor.text);
    }
    setEnableSub(true);
    setSrtEditor(prev => ({ ...prev, open: false }));
    appendPanelLog(`[SRT] Da cap nhat ${srtEditor.title}.`);
  };

  const handleStepStt = async () => {
    const activeVideo = videoPath || videoList[0];
    if (!activeVideo) {
      alert('Vui long chon video truoc khi nhan dang SRT.');
      return;
    }
    setIsRendering(true);
    setRenderLog('[STT] Dang nhan dang phu de...\n');
    try {
      const baseName = activeVideo.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || `subtitle_${Date.now()}`;
      const outPath = `${outputPath.replace(/[\\/]$/, '')}\\${baseName}_auto.srt`;
      const language = audioLang.includes('Trung') || audioLang.includes('ZH') ? 'zh' : audioLang.includes('Anh') || audioLang.includes('EN') ? 'en' : 'vi';
      const res = await fetch('/api/navtools/subtitle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath: activeVideo, outPath, model: 'small', language }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || data.stderr || 'STT failed');
      const content = await readTextFile(data.outPath || outPath);
      setSrtPath(data.outPath || outPath);
      setSrtContent(content);
      setEnableSub(true);
      appendPanelLog(`[STT] Xong: ${data.outPath || outPath}`);
      setRenderLog(prev => `${prev}[SUCCESS] ${data.outPath || outPath}\n`);
    } catch (error) {
      alert(`Loi nhan dang SRT: ${(error as Error).message}`);
      setRenderLog(prev => `${prev}[ERROR] ${(error as Error).message}\n`);
    } finally {
      setIsRendering(false);
    }
  };

  const handleStepTrans = async () => {
    const source = srtContent || (srtPath ? await readTextFile(srtPath) : '');
    if (!source.trim()) {
      alert('Chua co SRT goc de dich.');
      return;
    }
    setIsRendering(true);
    setRenderLog('[TRANS] Dang dich SRT...\n');
    try {
      const res = await fetch('/api/translate-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          srtText: source,
          apiKey: store.apiKey,
          apiKeys: store.apiKeys,
          ruleId: 'modern',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.translatedSrt) throw new Error(data.error || 'Translate failed');
      setTranslatedSrtContent(data.translatedSrt);
      setSrtMode('translated');
      setEnableSub(true);
      setRenderLog(prev => `${prev}[SUCCESS] Da dich SRT (${data.translatedSrt.length} ky tu)\n`);
      appendPanelLog('[TRANS] Da dich SRT.');
    } catch (error) {
      alert(`Loi dich SRT: ${(error as Error).message}`);
      setRenderLog(prev => `${prev}[ERROR] ${(error as Error).message}\n`);
    } finally {
      setIsRendering(false);
    }
  };

  const handleStepTts = async (previewOnly = false) => {
    const activeSrt = translatedSrtContent || srtContent;
    const voice = CAPASSISTANT_TTS_VOICES.find(item => item.name === masterVoice) || CAPASSISTANT_TTS_VOICES[0];
    const text = previewOnly ? voice.preview : activeSrt;
    if (!text.trim()) {
      alert('Chua co SRT de doc.');
      return;
    }
    syncVoiceConfig(masterVoice, masterSpeed);
    setIsRendering(true);
    setRenderLog(previewOnly ? '[TTS] Dang nghe thu voice...\n' : '[TTS] Dang tao giong doc tu SRT...\n');
    try {
      const res = await fetch('/api/generate-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneText: text,
          chapterNum: 0,
          sceneIndex: Date.now(),
          drivePath: previewOnly ? '' : outputPath,
          voiceName: voice.edge,
          apiKeys: store.apiKeys,
          ten_tac_pham: 'CapAssistant',
          isPreview: previewOnly,
          ttsConfig: {
            ...store.ttsConfig,
            platform: 'edge_tts',
            voice: voice.edge,
            speed: Number(masterSpeed) || 1,
            pitch: 0,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'TTS failed');
      const audioPath = data.driveFilePath || data.audioPath;
      if (!previewOnly && audioPath) {
        setMusicList(prev => {
          setSelectedMusicIndex(prev.length);
          return [...prev, { path: audioPath, vol: '150', delay: '0', dur: '0', loop: false }];
        });
      }
      if (previewOnly && data.audioPath) {
        new Audio(data.audioPath).play();
      }
      setRenderLog(prev => `${prev}[SUCCESS] ${audioPath}\n`);
      appendPanelLog(`[TTS] ${data.method || 'done'} -> ${audioPath}`);
    } catch (error) {
      alert(`Loi TTS: ${(error as Error).message}`);
      setRenderLog(prev => `${prev}[ERROR] ${(error as Error).message}\n`);
    } finally {
      setIsRendering(false);
    }
  };

  const addMusicPath = (filePath: string) => {
    setMusicList(prev => [...prev, { path: filePath, vol: mVol, delay: mDelay, dur: mDur, loop: mLoop }]);
    setSelectedMusicIndex(musicList.length);
  };

  const handleQuickAudio = async (index: number) => {
    const existing = presetAudios[index];
    if (existing) {
      addMusicPath(existing);
      appendPanelLog(`[AUDIO] Them preset Audio ${index + 1}`);
      return;
    }
    const paths = await selectLocalFiles('audio', `Chon file cho Audio ${index + 1}`, false);
    if (paths.length === 0) return;
    const next = [...presetAudios];
    next[index] = paths[0];
    setPresetAudios(next);
    window.localStorage.setItem('capassistant_preset_audios', JSON.stringify(next));
    addMusicPath(paths[0]);
    appendPanelLog(`[AUDIO] Da gan preset Audio ${index + 1}`);
  };

  const handleQuickLogo = async (index: number) => {
    const existing = presetLogos[index];
    if (existing) {
      setLogoPath(existing);
      setUseLogo(true);
      appendPanelLog(`[LOGO] Dung preset Logo ${index + 1}`);
      return;
    }
    const paths = await selectLocalFiles('image', `Chon file cho Logo ${index + 1}`, false);
    if (paths.length === 0) return;
    const next = [...presetLogos];
    next[index] = paths[0];
    setPresetLogos(next);
    window.localStorage.setItem('capassistant_preset_logos', JSON.stringify(next));
    setLogoPath(paths[0]);
    setUseLogo(true);
    appendPanelLog(`[LOGO] Da gan preset Logo ${index + 1}`);
  };

  const handleSelectLogo = async () => {
    const paths = await selectLocalFiles('image', 'Chon Logo PNG', false);
    if (paths.length === 0) return;
    setLogoPath(paths[0]);
    setUseLogo(true);
    appendPanelLog(`[LOGO] ${paths[0]}`);
  };

  const handleSelectFrame = async () => {
    const paths = await selectLocalFiles('png', 'Chon Frame PNG', false);
    if (paths.length === 0) return;
    setFramePath(paths[0]);
    setEnableFrame(true);
    appendPanelLog(`[FRAME] ${paths[0]}`);
  };

  const handlePreviewSource = () => {
    const target = lastResultPath || videoPath || videoList[0];
    if (!target) {
      alert('Chua co video de xem truoc.');
      return;
    }
    void openLocalPath(target);
  };

  const handleStopRender = () => {
    renderAbortRef.current?.abort();
    renderAbortRef.current = null;
    setIsRendering(false);
    setRenderLog(prev => `${prev}\n[STOP] Da huy lenh dang chay tu giao dien.\n`);
    appendPanelLog('[STOP] Da huy lenh render.');
  };

  const updateSelectedMusic = (patch: Partial<{ vol: string; delay: string; dur: string; loop: boolean }>) => {
    if (selectedMusicIndex === null) return;
    setMusicList(prev => prev.map((item, index) => index === selectedMusicIndex ? { ...item, ...patch } : item));
  };

  const handleAutoMaster = async () => {
    const activeVideo = videoPath || videoList[0];
    if (!activeVideo) {
      alert('Vui lòng chọn Video trước!');
      return;
    }
    if (!confirm('Chạy Auto Master 1-Click?\nSTT → Dịch → TTS → Render (engine local, không cần CapAssistant.exe)')) {
      return;
    }

    const controller = new AbortController();
    renderAbortRef.current = controller;
    setIsRendering(true);
    setProgress(0);
    setRenderLog('[START] CapAssistant Auto Master (AI Novel independent)\n');

    try {
      const voice = CAPASSISTANT_TTS_VOICES.find((item) => item.name === masterVoice) || CAPASSISTANT_TTS_VOICES[0];
      const language =
        audioLang.includes('Trung') || audioLang.includes('ZH')
          ? 'zh'
          : audioLang.includes('Anh') || audioLang.includes('EN')
            ? 'en'
            : 'vi';
      const target =
        tgtLang.includes('Anh') || tgtLang.includes('EN')
          ? 'en'
          : tgtLang.includes('Trung') || tgtLang.includes('ZH')
            ? 'zh'
            : 'vi';

      const res = await fetch('/api/capassistant/auto-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          videoPath: activeVideo,
          videoPaths: videoList.length > 1 ? videoList : undefined,
          outputDir: outputPath,
          srtMode: srtMode === 'auto' ? 'auto' : srtMode === 'untranslated' ? 'untranslated' : srtMode === 'translated' ? 'translated' : 'auto',
          srtContent,
          translatedSrtContent,
          audioLang: language,
          targetLang: target,
          enableTts: true,
          enableRender: true,
          muteOriginal: true,
          gpu,
          zoom,
          speed,
          volume,
          flip,
          vocalFilter,
          ttsVoice: voice.edge,
          ttsSpeed: Number(masterSpeed) || 1.2,
          wmText,
          apiKey: store.apiKey,
          apiKeys: store.apiKeys,
          srtFont,
          srtSize,
          srtStyle,
          logoPath,
          useLogo,
          exportRatio,
        }),
      });

      if (!res.body) throw new Error('Streaming Auto Master API unavailable');
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        const chunk = decoder.decode(value, { stream: true });
        setRenderLog((prev) => prev + chunk);
        const pMatch = chunk.match(/PROGRESS:(\d+)/g);
        if (pMatch?.length) {
          const p = parseInt(pMatch[pMatch.length - 1].replace('PROGRESS:', ''), 10);
          if (!Number.isNaN(p)) setProgress(p);
        }
        if (chunk.includes('[SUCCESS]')) {
          setProgress(100);
          const urlMatch = chunk.match(/\[SUCCESS\]\s+(.*)/);
          if (urlMatch) {
            setLastResultPath(urlMatch[1].trim());
            appendPanelLog(`[AUTO MASTER] ${urlMatch[1].trim()}`);
          }
        }
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name === 'AbortError') {
        setRenderLog((prev) => `${prev}\n[STOP] Da huy Auto Master.\n`);
      } else {
        alert(`Loi Auto Master: ${err?.message || String(e)}`);
        setRenderLog((prev) => `${prev}\n[ERROR] ${err?.message || String(e)}\n`);
      }
    } finally {
      setIsRendering(false);
      renderAbortRef.current = null;
    }
  };

  const handleRender = async () => {
    if (!videoPath && videoList.length === 0) { alert("Vui lòng chọn Video trước!"); return; }
    if (confirm("Xác nhận Dựng Video?")) {
      const controller = new AbortController();
      renderAbortRef.current = controller;
      try {
        setIsRendering(true);
        setRenderLog("[START] Khởi chạy Engine FFmpeg...\n");
        setProgress(0);
        let sourceVideoPath = videoList.length > 0 ? videoList[0] : videoPath;
        if (videoList.length > 1) {
          const outputRoot = outputPath.replace(/[\\/]$/, '');
          const joinedOutputPath = `${outputRoot}\\Joined_${Date.now()}.mp4`;
          setRenderLog(prev => `${prev}[JOIN] SmartJoin ${videoList.length} video nguon...\n`);
          const joinRes = await fetch('/api/capassistant/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              videoPaths: videoList,
              outputPath: joinedOutputPath,
              targetRatio: exportRatio,
            }),
          });
          const joinLog = await readStreamingText(joinRes, chunk => setRenderLog(prev => prev + chunk));
          const joinMatch = joinLog.match(/\[SUCCESS\]\s+(.*)/);
          if (!joinMatch) throw new Error("SmartJoin khong tao duoc video nguon.");
          sourceVideoPath = joinMatch[1].trim();
          setRenderLog(prev => `${prev}\n[JOIN_OK] ${sourceVideoPath}\n`);
        }
        const res = await fetch('/api/video-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            videoPath: sourceVideoPath,
            outputPath,
            video: { exportRatio, zoom, speed, mute, vocalFilter, flip, gpu, volume },
            sub: {
              enableSub,
              srtMode,
              srtPath,
              srtContent: srtMode === 'translated' ? (translatedSrtContent || srtContent) : srtContent,
              translatedSrtContent,
              audioLang,
              tgtLang,
              masterVoice,
              masterSpeed,
              aiEngine,
              srtFont,
              srtSize,
              srtDelay
            },
            bgm: { items: musicList },
            style: { srtStyle, bgPadding, padX, padY },
            blur: { smartBlur, items: blurs, blurPower },
            brand: { useLogo, logoPath, logoRescale, logoDelay, useStaticText, staticText, staticFont, staticSize, staticDelay, useWm, wmText, wmDelay },
            trim: { enableTrim, items: trims },
            phantom: { enableFrame, framePath, bypassFx, rotate, bright, contrast, sat }
          })
        });
        
        if (!res.body) throw new Error("Stream API không hoạt động");
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let done = false;
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            setRenderLog(prev => prev + chunk);
            const pMatch = chunk.match(/PROGRESS:(\d+)/g);
            if (pMatch && pMatch.length > 0) {
                const lastMatch = pMatch[pMatch.length - 1];
                const p = parseInt(lastMatch.replace('PROGRESS:', ''));
                if (!isNaN(p)) setProgress(p);
            }
            if (chunk.includes('[SUCCESS]')) {
              setProgress(100);
              const urlMatch = chunk.match(/\[SUCCESS\]\s+(.*)/);
              if (urlMatch) {
                setLastResultPath(urlMatch[1].trim());
                setTimeout(() => {
                  if (confirm("🎬 Dựng phim hoàn tất!\nBấm OK để mở xem video kết quả.")) void openLocalPath(urlMatch[1].trim());
                  setIsRendering(false);
                  renderAbortRef.current = null;
                }, 500);
              } else {
                  setIsRendering(false);
                  renderAbortRef.current = null;
              }
            } else if (chunk.includes('[ERROR]')) {
              alert("Lỗi Render! Xem log để biết chi tiết.");
              setIsRendering(false);
              renderAbortRef.current = null;
            }
          }
        }
        if (renderAbortRef.current === controller) {
          renderAbortRef.current = null;
          setIsRendering(false);
        }
      } catch(e: any) {
        if (e?.name === 'AbortError') {
          setRenderLog(prev => `${prev}\n[STOP] Da huy request render.\n`);
        } else {
          alert("Lỗi gọi API FFmpeg: " + e.message);
          setRenderLog(prev => `${prev}\n[ERROR] ${e.message}\n`);
        }
        setIsRendering(false);
        renderAbortRef.current = null;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur p-2 font-sans text-white">
      <div className="flex flex-col w-full max-w-[1350px] h-[98vh] bg-[#020617] rounded shadow-2xl border border-slate-700 overflow-hidden">
        
        {/* MAIN CONTENT AREA */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* LEFT COLUMN - SIDEBAR PANELS */}
          <div 
            className="flex flex-col overflow-y-auto custom-scrollbar bg-[#0f172a]/50 border-r border-slate-800 p-3"
            style={{ width: '420px', minWidth: '420px', flexShrink: 0 }}
          >
            {/* Top Info */}
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] text-emerald-500 font-bold">Bản quyền: AI Novel Pro</span>
              <div className="flex gap-1">
                <button
                  className="px-3 py-1 bg-slate-800 text-[11px] font-bold rounded border border-slate-700"
                  onClick={() => {
                    const msg = 'AI Novel Video Editor dang dung engine CapAssistant local: /api/video-editor + /api/capassistant/join.';
                    setPanelLog(msg);
                    alert(msg);
                  }}
                >🔄 Update</button>
                <button
                  className="px-3 py-1 bg-slate-800 text-[11px] font-bold rounded border border-slate-700"
                  onClick={() => {
                    const key = prompt('Nhap Gemini/API key dung cho dich SRT:', store.apiKey || '');
                    if (key !== null) {
                      store.setApiKey(key.trim());
                      if (key.trim()) store.prioritizeApiKey(key.trim());
                      appendPanelLog('[KEY] Da cap nhat API key cho dich SRT.');
                    }
                  }}
                >🔑 Đổi Key</button>
              </div>
            </div>

            {/* 1. Video */}
            <SectionPanel index={1} title="Video & Tốc độ & Phóng to">
              <div className="flex gap-2">
                <button onClick={handleSelectVideo} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 flex justify-center items-center gap-1.5 font-bold text-[11px]">
                  🎬 Chọn Video
                </button>
                <button onClick={handleSuggestThumbnail} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded py-1.5 flex justify-center items-center gap-1.5 font-bold text-[11px]">
                  📸 Gợi Ý Thumbnail
                </button>
              </div>
              <div className="text-slate-400 italic text-[10px] truncate" title={videoPath || "Chưa nạp video."}>
                {videoPath ? videoPath : "Chưa nạp video."}
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-300 w-[100px]">Tỉ lệ xuất:</span>
                <select value={exportRatio} onChange={e=>setExportRatio(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-[11px] text-white">
                  <option>Giữ nguyên (Theo Video đầu tiên)</option>
                  <option>Ngang (16:9) - 1920x1080</option>
                  <option>Dọc (9:16) - 1080x1920</option>
                </select>
              </div>
              <div className="text-[9px] text-slate-500 italic ml-[108px]">*(Chỉ áp dụng khi ghép từ 2 video trở lên)</div>

              <div className="bg-[#020617] border border-slate-700 h-[60px] rounded mt-1 overflow-y-auto">
                {videoList.map((v, idx) => (
                  <div key={idx} className="text-[10px] p-1 border-b border-slate-800 text-slate-300 truncate">{v}</div>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-slate-300 w-[120px]">Tỉ lệ Phóng to (Zoom %):</span>
                <div className="flex flex-1 gap-1">
                  <OrangeTab active={zoom==='100'} onClick={()=>setZoom('100')}>100%</OrangeTab>
                  <OrangeTab active={zoom==='110'} onClick={()=>setZoom('110')}>110%</OrangeTab>
                  <OrangeTab active={zoom==='120'} onClick={()=>setZoom('120')}>120%</OrangeTab>
                  <input type="text" value={zoom} onChange={e=>setZoom(e.target.value)} placeholder="Tùy chỉnh" className="w-[60px] bg-slate-950 border border-slate-700 rounded text-center text-[11px]" />
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-300 w-[120px]">Tốc độ Video gốc (%):</span>
                <div className="flex flex-1 gap-1">
                  <OrangeTab active={speed==='80'} onClick={()=>setSpeed('80')}>80%</OrangeTab>
                  <OrangeTab active={speed==='90'} onClick={()=>setSpeed('90')}>90%</OrangeTab>
                  <OrangeTab active={speed==='100'} onClick={()=>setSpeed('100')}>100%</OrangeTab>
                  <input type="text" value={speed} onChange={e=>setSpeed(e.target.value)} placeholder="Tùy chỉnh" className="w-[60px] bg-slate-950 border border-slate-700 rounded text-center text-[11px]" />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1 mt-1">
                <CustomCheckbox checked={mute} onChange={setMute} label="Mute" />
                <CustomCheckbox checked={vocalFilter} onChange={setVocalFilter} label="Lọc Vocal" />
                <CustomCheckbox checked={flip} onChange={setFlip} label="Lật Ngang" />
                <CustomCheckbox checked={gpu} onChange={setGpu} label="Dùng GPU" />
              </div>
              
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-slate-300 w-[120px]">Âm lượng gốc: {volume}%</span>
                <input type="range" min="0" max="200" value={volume} onChange={(e)=>setVolume(e.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>
            </SectionPanel>

            {/* 2. Sub */}
            <SectionPanel index={2} title="Phụ đề & Âm thanh Tự động">
              <CustomCheckbox checked={enableSub} onChange={setEnableSub} label="Bật Phụ đề (Hiển thị Text trên Video)" />
              
              <div className="flex gap-3 text-[11px] mt-1">
                <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={srtMode==='translated'} onChange={()=>setSrtMode('translated')} /> SRT đã dịch</label>
                <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={srtMode==='untranslated'} onChange={()=>setSrtMode('untranslated')} /> SRT chưa dịch</label>
                <label className="flex items-center gap-1 cursor-pointer"><input type="radio" checked={srtMode==='auto'} onChange={()=>setSrtMode('auto')} /> Nhận dạng từ Audio</label>
              </div>

              <div className="flex gap-2 mt-1">
                <button onClick={handleSelectSrt} className="flex-1 bg-slate-800 border border-slate-700 py-1 rounded text-[11px] text-slate-200">📄 Chọn SRT Gốc</button>
                <button onClick={() => openSrtEditor('original')} className="flex-1 bg-slate-800 border border-slate-700 py-1 rounded text-[11px] text-slate-200">👀 Xem SRT Gốc</button>
                <button onClick={() => openSrtEditor('translated')} className="flex-1 bg-blue-600 hover:bg-blue-500 border border-blue-500 py-1 rounded text-[11px] font-bold text-white">👀 Xem SRT đã dịch</button>
              </div>

              {srtMode === 'auto' && (
                <div className="mt-2 bg-slate-900/50 p-2 rounded border border-slate-800 flex flex-col gap-1 text-[11px]">
                  <div className="flex items-center justify-between"><span className="text-slate-300">Ngôn ngữ gốc:</span><select className="bg-slate-950 border border-slate-700 rounded px-1 w-[120px]" value={audioLang} onChange={e=>setAudioLang(e.target.value)}><option>Tiếng Trung (ZH)</option><option>Tiếng Anh (EN)</option><option>Tiếng Việt (VN)</option></select></div>
                  <div className="flex items-center justify-between"><span className="text-slate-300">Ngôn ngữ Đích:</span><select className="bg-slate-950 border border-slate-700 rounded px-1 w-[120px]" value={tgtLang} onChange={e=>setTgtLang(e.target.value)}><option>Tiếng Việt (VI)</option><option>Tiếng Anh (EN)</option><option>Tiếng Trung (ZH)</option></select></div>
                  <div className="flex items-center justify-between gap-2"><span className="text-slate-300">Giọng đọc (TTS):</span><select className="bg-slate-950 border border-slate-700 rounded px-1 flex-1 min-w-0" value={masterVoice} onChange={e=>handleVoiceChange(e.target.value)}>{CAPASSISTANT_TTS_VOICES.map(voice => <option key={voice.name} value={voice.name}>{voice.name}</option>)}</select></div>
                  <div className="flex items-center justify-between"><span className="text-slate-300">Tốc độ đọc:</span><select className="bg-slate-950 border border-slate-700 rounded px-1 w-[120px]" value={masterSpeed} onChange={e=>handleVoiceSpeedChange(e.target.value)}><option>1.0</option><option>1.1</option><option>1.2</option></select></div>
                  <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-800">
                    <span className="text-slate-300">Chế độ chạy (AI):</span>
                    <select className="bg-slate-950 border border-slate-700 rounded px-1 w-[150px]" value={aiEngine} onChange={e=>setAiEngine(e.target.value)}>
                      <option>CapCut Web (Nhanh - Chưa Ổn Định)</option>
                      <option>CPU (Chậm - Ổn định)</option>
                      <option>Nvidia GPU (CUDA)</option>
                      <option>AMD GPU (OpenVINO)</option>
                      <option>AMD GPU (DirectML)</option>
                    </select>
                  </div>
                  <div className="flex gap-1 mt-1">
                    <button onClick={handleStepStt} disabled={isRendering} className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-bold py-1 rounded disabled:opacity-50">Nhận dạng SRT</button>
                    <button onClick={handleStepTrans} disabled={isRendering} className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-1 rounded disabled:opacity-50">Dịch SRT</button>
                    <button onClick={() => handleStepTts(false)} disabled={isRendering} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-1 rounded disabled:opacity-50">Đọc SRT</button>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mt-2 text-[11px]">
                <span className="text-slate-300">Font Phụ đề:</span>
                <select value={srtFont} onChange={e=>setSrtFont(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[150px]"><option>UTM_Bebas</option><option>Arial</option></select>
              </div>
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-300">Cỡ chữ SRT:</span>
                <input type="number" value={srtSize} onChange={e=>setSrtSize(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[80px] text-right" />
              </div>
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-300">Độ trễ phụ đề:</span>
                <div className="flex gap-1"><input type="number" value={srtDelay} onChange={e=>setSrtDelay(e.target.value)} step="0.1" className="bg-slate-950 border border-slate-700 rounded px-1 w-[80px] text-right" /> <span className="text-slate-400">s</span></div>
              </div>
            </SectionPanel>

            {/* 3. Playlist Nhạc Nền */}
            <SectionPanel index={3} title="Playlist Nhạc Nền">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-300">🎵 Nhạc nhanh (Bấm để thêm):</span>
                <div className="flex gap-1 flex-1">
                  {['1','2','3','4'].map((i, idx) => <button key={i} onClick={() => handleQuickAudio(idx)} title={presetAudios[idx] || 'Chua gan file, bam de chon'} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-bold py-0.5 rounded">Audio {i}</button>)}
                </div>
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  className="bg-slate-800 border border-slate-700 py-1 px-3 rounded text-[11px] text-slate-200"
                  onClick={async () => {
                    const paths = await selectLocalFiles('audio', 'Chon nhac nen', true);
                    paths.forEach(addMusicPath);
                  }}
                >[+] Chọn file</button>
                <button
                  className="bg-red-900/50 hover:bg-red-800 text-red-200 border border-red-900 py-1 px-3 rounded text-[11px]"
                  onClick={() => {
                    if (musicList.length === 0) return;
                    const removeIndex = selectedMusicIndex ?? musicList.length - 1;
                    setMusicList(musicList.filter((_, index) => index !== removeIndex));
                    setSelectedMusicIndex(null);
                  }}
                >[-] Xóa bài</button>
              </div>
              <div className="bg-[#020617] border border-slate-700 h-[60px] rounded mt-1 overflow-y-auto">
                {musicList.map((m, idx) => (
                  <button
                    key={`${m.path}-${idx}`}
                    onClick={() => {
                      setSelectedMusicIndex(idx);
                      setMVol(m.vol);
                      setMDelay(m.delay);
                      setMDur(m.dur);
                      setMLoop(m.loop);
                    }}
                    className={`block w-full truncate border-b border-slate-800 p-1 text-left text-[10px] ${selectedMusicIndex === idx ? 'bg-orange-500 text-black' : 'text-slate-300 hover:bg-slate-900'}`}
                    title={m.path}
                  >
                    {idx + 1}. {m.path} ({m.vol}% | {m.delay}s | dur {m.dur || '0'} | {m.loop ? 'loop' : 'once'})
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
                <span>V:</span>
                <input type="number" max="200" value={mVol} onChange={e=>{ setMVol(e.target.value); updateSelectedMusic({ vol: e.target.value }); }} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>%</span>
                <span className="ml-1">D:</span>
                <input type="number" value={mDelay} onChange={e=>{ setMDelay(e.target.value); updateSelectedMusic({ delay: e.target.value }); }} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>s</span>
                <span className="ml-1">Dur:</span>
                <input type="number" value={mDur} onChange={e=>{ setMDur(e.target.value); updateSelectedMusic({ dur: e.target.value }); }} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" title="Thời lượng phát (0 = Phát hết bài)" />
                <CustomCheckbox checked={mLoop} onChange={(val)=>{ setMLoop(val); updateSelectedMusic({ loop: val }); }} label="Loop" className="text-yellow-500 font-bold ml-1" />
              </div>
            </SectionPanel>

            {/* 4. Kiểu Phụ Đề & Che Mờ */}
            <SectionPanel index={4} title="Kiểu Phụ Đề & Vùng Che Mờ">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-sky-400 font-bold">Style Phụ Đề:</span>
                <CustomCheckbox checked={bgPadding} onChange={setBgPadding} label="Bật Nền" className="text-yellow-500" />
                <select value={srtStyle} onChange={e=>setSrtStyle(e.target.value)} className="bg-slate-900 font-bold text-white border border-slate-700 rounded px-1 w-[180px]">
                  <option>Viền đen nổi bật (Mặc định)</option>
                  <option>Nền Đen mờ (Netflix)</option>
                  <option>Nền Vàng chữ Đen (TikTok)</option>
                  <option>Nền Trắng chữ Đen</option>
                  <option>Nền Xanh Blue chữ Trắng</option>
                </select>
              </div>
              <div className="flex items-center gap-2 text-[11px] mb-2">
                <span className="text-emerald-300 font-bold">Đệm Dọc (Y):</span>
                <input type="number" value={padY} onChange={e=>setPadY(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
                <span className="text-emerald-300 font-bold ml-2">Đệm Ngang (X):</span>
                <input type="number" value={padX} onChange={e=>setPadX(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
              </div>

              <CustomCheckbox checked={smartBlur} onChange={setSmartBlur} label="Smart Blur (Che mờ sub gốc tự động)" className="text-yellow-500 font-bold mt-1" />
              
              <div className="h-[1px] bg-slate-700 my-2"></div>
              
              <div className="text-slate-400 italic text-[11px]">Cấu hình Che mờ thủ công (Multi-Blur):</div>
              <div className="bg-[#020617] border border-slate-700 h-[50px] rounded mt-1 overflow-y-auto">
                {blurs.map((b, idx) => (
                  <div key={idx} className="text-[10px] p-1 border-b border-slate-800 text-slate-300">X:{b.x} Y:{b.y} W:{b.w} H:{b.h} Start:{b.start} Dur:{b.dur}</div>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                <button className="bg-slate-800 border border-slate-700 py-1 px-2 rounded text-[10px] text-slate-200" onClick={() => {
                  if (blurW && blurH) setBlurs([...blurs, {x: blurX, y: blurY, w: blurW, h: blurH, start: blurStart, dur: blurDur}]);
                }}>[+] Thêm vùng</button>
                <button className="bg-red-900/50 hover:bg-red-800 border border-red-900 py-1 px-2 rounded text-[10px] text-red-200" onClick={() => setBlurs([])}>[-] Xóa vùng</button>
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
                <span>X:</span><input type="number" value={blurX} onChange={e=>setBlurX(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
                <span className="ml-1">Y:</span><input type="number" value={blurY} onChange={e=>setBlurY(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
                <span>W:</span><input type="number" value={blurW} onChange={e=>setBlurW(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
                <span className="ml-1">H:</span><input type="number" value={blurH} onChange={e=>setBlurH(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
              </div>
              <div className="flex items-center gap-1 mt-1 text-[10px] text-slate-300">
                <span>Bắt đầu:</span><input type="text" placeholder="01:20" value={blurStart} onChange={e=>setBlurStart(e.target.value)} className="w-16 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
                <span className="ml-1">Độ dài:</span><input type="text" placeholder="0=Full" value={blurDur} onChange={e=>setBlurDur(e.target.value)} className="w-16 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[11px] text-slate-300 w-[100px]">Cường độ làm mờ:</span>
                <input type="range" min="5" max="60" value={blurPower} onChange={(e)=>setBlurPower(e.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>
            </SectionPanel>

            {/* 5. Thương hiệu */}
            <SectionPanel index={5} title="Thương hiệu (Logo & Text & Watermark)">
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-300">🌟 Chọn Logo nhanh:</span>
                <div className="flex gap-1 flex-1">
                  {['1','2','3','4'].map((i, idx) => <button key={i} onClick={() => handleQuickLogo(idx)} title={presetLogos[idx] || 'Chua gan file, bam de chon'} className="flex-1 bg-blue-900 hover:bg-blue-800 text-white font-bold py-0.5 rounded">Logo {i}</button>)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <CustomCheckbox checked={useLogo} onChange={setUseLogo} label="Hiện Logo" />
                <button
                  className="bg-slate-800 border border-slate-700 py-1 px-3 rounded text-[11px] text-slate-200"
                  onClick={handleSelectLogo}
                >🖼️ Duyệt File</button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span>Kích thước:</span>
                <input type="range" min="5" max="50" value={logoRescale} onChange={e=>setLogoRescale(e.target.value)} className="w-20 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
                <span className="ml-2">Delay (s):</span>
                <input type="number" value={logoDelay} onChange={e=>setLogoDelay(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
              </div>

              <div className="flex items-center gap-2 mt-3">
                <CustomCheckbox checked={useStaticText} onChange={setUseStaticText} label="Text Tĩnh:" />
                <input type="text" placeholder="Nhập nội dung text tĩnh..." value={staticText} onChange={e=>setStaticText(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]" />
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span>Font:</span>
                <select value={staticFont} onChange={e=>setStaticFont(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[80px]"><option>UTM_Bebas</option></select>
                <span className="ml-1">Size:</span>
                <input type="number" value={staticSize} onChange={e=>setStaticSize(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
                <span className="ml-1">Delay:</span>
                <input type="number" value={staticDelay} onChange={e=>setStaticDelay(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 text-center" />
              </div>

              <div className="flex items-center gap-2 mt-3">
                <CustomCheckbox checked={useWm} onChange={setUseWm} label="Watermark (Di chuyển):" />
                <input type="text" placeholder="CapAssistant" value={wmText} onChange={e=>setWmText(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px]" />
                <span className="text-[11px] text-slate-300">Delay:</span>
                <input type="number" value={wmDelay} onChange={e=>setWmDelay(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center text-[11px]" />
              </div>
            </SectionPanel>

            {/* 6. Trim */}
            <SectionPanel index={6} title="Loại bỏ đoạn thừa (Remove Segments)">
              <CustomCheckbox checked={enableTrim} onChange={setEnableTrim} label="Bật tính năng xóa" />
              <div className="flex gap-2 mt-1">
                <button className="bg-slate-800 border border-slate-700 py-1 px-2 rounded text-[10px] text-slate-200" onClick={() => {
                  setTrims([...trims, {start: "00:00:00", end: "00:00:05"}]);
                }}>[+] Thêm đoạn xóa</button>
                <button className="bg-red-900/50 hover:bg-red-800 border border-red-900 py-1 px-2 rounded text-[10px] text-red-200" onClick={() => setTrims([])}>[-] Xóa chọn</button>
              </div>
              <div className="bg-[#020617] border border-slate-700 h-[50px] rounded mt-1 overflow-y-auto">
                {trims.map((t, idx) => (
                  <div key={idx} className="text-[10px] p-1 border-b border-slate-800 text-slate-300">Start: {t.start} - End: {t.end}</div>
                ))}
              </div>
            </SectionPanel>

            {/* 7. Lách AI */}
            <SectionPanel index={7} title="Bypass & Xử lý Nâng Cao">
              <div className="flex items-center gap-2 mb-2">
                <CustomCheckbox checked={enableFrame} onChange={setEnableFrame} label="Bật Khung Overlay (Frame)" />
                <button
                  className="bg-slate-800 border border-slate-700 py-1 px-2 rounded text-[10px] text-slate-200"
                  onClick={handleSelectFrame}
                >🖼️ Duyệt Frame PNG</button>
              </div>

              <div className="flex items-center justify-between text-[11px] mb-2">
                <span className="text-slate-300">Hiệu ứng lách (Bypass FX):</span>
                <select value={bypassFx} onChange={e=>setBypassFx(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[180px]">
                  <option>Không (None)</option>
                  <option>TEST 2: Đảo màu (Negative)</option>
                  <option>Nhiễu hạt (Fine Noise)</option>
                  <option>Viền mờ (Soft Vignette)</option>
                  <option>Tăng sắc nét (Sharpen)</option>
                  <option>Màu phim (Cinematic Tint)</option>
                  <option>Lớp phủ gương (Glass Edge)</option>
                  <option>Lách AI 1 (Motion Blur)</option>
                  <option>Lách AI 2 (Gamma Shift)</option>
                  <option>Lách AI 3 (Dynamic Hue)</option>
                  <option>Lách AI 4 (Ghost Pattern)</option>
                  <option>Lách AI 5 (Macroblock Noise)</option>
                </select>
              </div>
              
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-300">Góc Xoay (Chống quét):</span>
                <div className="flex gap-1 items-center">
                  <input type="number" value={rotate} onChange={e=>setRotate(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 w-[60px] text-center" />
                  <span className="text-slate-400">độ</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-300 w-[140px]">Độ Sáng (Color EQ):</span>
                <input type="range" min="-50" max="50" value={bright} onChange={(e)=>setBright(e.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-300 w-[140px]">Tương Phản (Color EQ):</span>
                <input type="range" min="50" max="150" value={contrast} onChange={(e)=>setContrast(e.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-300 w-[140px]">Rực Màu (Color EQ):</span>
                <input type="range" min="50" max="150" value={sat} onChange={(e)=>setSat(e.target.value)} className="flex-1 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>
            </SectionPanel>

          </div>

          {/* RIGHT COLUMN - WORKSPACE CANVAS */}
          <div className="flex-1 flex flex-col p-4 bg-[#0a0f1c]">
            <h2 className="text-[20px] font-black text-orange-500 tracking-wider mb-2">🖥️ BẢN XEM TRƯỚC (LIVE CANVAS)</h2>
            
            <div className="flex-1 bg-black border-4 border-orange-500 rounded-xl relative overflow-hidden flex items-center justify-center">
              <span className="text-slate-600 font-bold uppercase tracking-widest">Không có video</span>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button onClick={handlePreviewSource} className="bg-sky-500 hover:bg-sky-400 text-white font-black text-[14px] px-4 py-2.5 rounded-lg flex items-center gap-2">
                <Play fill="currentColor" size={16} /> Play
              </button>
              <input type="range" className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500" />
              <span className="text-slate-200 font-mono font-bold text-[13px]">00:00 / 00:00</span>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <span className="text-slate-300 text-[13px] font-bold">Thư mục xuất:</span>
              <input type="text" value={outputPath} onChange={e=>setOutputPath(e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-[13px] text-slate-300" />
              <button
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold text-[13px]"
                onClick={async () => {
                  const res = await fetch('/api/select-folder', { method: 'POST' });
                  const data = await res.json();
                  if (!data.cancelled && data.path) {
                    setOutputPath(data.path);
                    appendPanelLog(`[OUTPUT] ${data.path}`);
                  }
                }}
              >📁 Chọn Folder</button>
            </div>

            <div className="flex gap-3 mt-4">
              <button onClick={handlePreviewSource} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-black text-[14px] py-3 rounded-lg shadow-lg">👀 XEM TRƯỚC</button>
              <button onClick={handleRender} disabled={isRendering} className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-black text-[14px] py-3 rounded-lg shadow-lg disabled:opacity-50">🚀 XUẤT</button>
              <button onClick={handleAutoMaster} disabled={isRendering} className="flex-1 bg-orange-600 hover:bg-orange-500 text-white font-black text-[14px] py-3 rounded-lg shadow-lg disabled:opacity-50" title="STT → Dịch → TTS → Render">🤖 AUTO</button>
              <button onClick={handleStopRender} disabled={!isRendering} className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black text-[14px] py-3 rounded-lg shadow-lg disabled:opacity-50">🛑 STOP</button>
              <button
                className="flex-1 bg-slate-700 text-slate-200 font-black text-[14px] py-3 rounded-lg shadow-lg disabled:text-slate-500 disabled:opacity-50"
                disabled={!lastResultPath}
                onClick={() => lastResultPath && void openLocalPath(lastResultPath)}
              >🎬 XEM KẾT QUẢ</button>
            </div>

            <div className="mt-4 flex flex-col gap-1">
              <span className="text-slate-400 font-bold text-[13px]">Trạng thái: {isRendering ? 'Đang xuất video...' : 'Sẵn sàng'}</span>
              <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{width: `${progress}%`}}></div>
              </div>
            </div>

            {isRendering && (
              <div className="mt-2 h-24 bg-black border border-slate-800 rounded p-2 text-xs font-mono text-emerald-500 overflow-y-auto whitespace-pre-wrap">
                {renderLog}
              </div>
            )}
            <div className="mt-2 h-20 overflow-y-auto whitespace-pre-wrap rounded border border-slate-800 bg-black p-2 font-mono text-[11px] text-slate-400">
              {panelLog}
            </div>
          </div>

        </div>

        {srtEditor.open && (
          <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 p-6">
            <div className="flex h-[72vh] w-full max-w-[820px] flex-col rounded-lg border border-orange-500 bg-slate-950 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <div className="text-sm font-black uppercase tracking-wider text-orange-400">{srtEditor.title}</div>
                <button onClick={() => setSrtEditor(prev => ({ ...prev, open: false }))} className="rounded bg-slate-800 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-red-600">Dong</button>
              </div>
              <textarea
                value={srtEditor.text}
                onChange={e => setSrtEditor(prev => ({ ...prev, text: e.target.value }))}
                className="min-h-0 flex-1 resize-none bg-black p-4 font-mono text-xs leading-relaxed text-emerald-300 outline-none"
                spellCheck={false}
              />
              <div className="flex items-center justify-between border-t border-slate-800 px-4 py-3">
                <span className="text-xs text-slate-500">{srtEditor.text.length} ky tu</span>
                <button onClick={saveSrtEditor} className="rounded bg-orange-500 px-5 py-2 text-xs font-black uppercase tracking-wider text-black hover:bg-orange-400">Luu SRT</button>
              </div>
            </div>
          </div>
        )}
        
        {/* Close Header Top Right Abs */}
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-red-500 hover:text-white rounded-md text-slate-400 transition-colors z-50 bg-slate-900 border border-slate-700">
          <X size={20} />
        </button>

      </div>
    </div>
  );
}
