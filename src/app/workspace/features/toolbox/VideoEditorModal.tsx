import { useRef, useState } from 'react';

import { API } from '@/contracts';
import { useNovelStore } from '@/store/useNovelStore';
import { toast } from '@/lib/toastBus';
import VideoEditorLeftColumn from './video-editor/VideoEditorLeftColumn';
import VideoEditorRightCanvas from './video-editor/VideoEditorRightCanvas';
import { CAPASSISTANT_TTS_VOICES } from './video-editor/constants';
import {
  openLocalPath as openCapAssistantPath,
  readStreamingText,
  readTextFile,
  selectLocalFiles,
  writeTextFile,
} from './video-editor/io';
import type { SrtEditorState } from './video-editor/types';

export interface VideoEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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

  const appendPanelLog = (message: string) => {
    setPanelLog(prev => `${prev}\n${message}`);
  };

  const openLocalPath = (targetPath: string) => openCapAssistantPath(targetPath, appendPanelLog);

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
      toast.info('Notice', 'Vui long chon video truoc.');
      return;
    }
    const res = await fetch(API.capassistant.thumbnail, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoPath: activeVideo, outputPath, count: 4 }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      toast.info('Notice', `Khong tao duoc thumbnail: ${data.error || data.errors?.[0] || 'unknown error'}`);
      return;
    }
    appendPanelLog(`[THUMB] ${data.thumbnails.length} thumbnail -> ${data.outputDir}`);
    toast.info('Notice', `Da tao ${data.thumbnails.length} thumbnail:\n${data.thumbnails.join('\n')}`);
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
      toast.info('Notice', 'Vui long chon video truoc khi nhan dang SRT.');
      return;
    }
    setIsRendering(true);
    setRenderLog('[STT] Dang nhan dang phu de...\n');
    try {
      const baseName = activeVideo.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || `subtitle_${Date.now()}`;
      const outPath = `${outputPath.replace(/[\\/]$/, '')}\\${baseName}_auto.srt`;
      const language = audioLang.includes('Trung') || audioLang.includes('ZH') ? 'zh' : audioLang.includes('Anh') || audioLang.includes('EN') ? 'en' : 'vi';
      const res = await fetch(API.navtools.subtitle, {
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
      toast.info('Notice', `Loi nhan dang SRT: ${(error as Error).message}`);
      setRenderLog(prev => `${prev}[ERROR] ${(error as Error).message}\n`);
    } finally {
      setIsRendering(false);
    }
  };

  const handleStepTrans = async () => {
    const source = srtContent || (srtPath ? await readTextFile(srtPath) : '');
    if (!source.trim()) {
      toast.info('Notice', 'Chua co SRT goc de dich.');
      return;
    }
    setIsRendering(true);
    setRenderLog('[TRANS] Dang dich SRT...\n');
    try {
      const res = await fetch(API.translateSrt, {
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
      toast.info('Notice', `Loi dich SRT: ${(error as Error).message}`);
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
      toast.info('Notice', 'Chua co SRT de doc.');
      return;
    }
    syncVoiceConfig(masterVoice, masterSpeed);
    setIsRendering(true);
    setRenderLog(previewOnly ? '[TTS] Dang nghe thu voice...\n' : '[TTS] Dang tao giong doc tu SRT...\n');
    try {
      const res = await fetch(API.generateTts, {
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
      toast.info('Notice', `Loi TTS: ${(error as Error).message}`);
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
      toast.info('Notice', 'Chua co video de xem truoc.');
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
      toast.info('Notice', 'Vui lòng chọn Video trước!');
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

      const res = await fetch(API.capassistant.autoMaster, {
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
        toast.info('Notice', `Loi Auto Master: ${err?.message || String(e)}`);
        setRenderLog((prev) => `${prev}\n[ERROR] ${err?.message || String(e)}\n`);
      }
    } finally {
      setIsRendering(false);
      renderAbortRef.current = null;
    }
  };

  const handleRender = async () => {
    if (!videoPath && videoList.length === 0) { toast.info('Notice', "Vui lòng chọn Video trước!"); return; }
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
          const joinRes = await fetch(API.capassistant.join, {
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
        const res = await fetch(API.videoEditor, {
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
              toast.info('Notice', "Lỗi Render! Xem log để biết chi tiết.");
              setIsRendering(false);
              renderAbortRef.current = null;
            }
          }
        }
        if (renderAbortRef.current === controller) {
          renderAbortRef.current = null;
          setIsRendering(false);
        }
      } catch(e: unknown) {
        const err = e as { name?: string; message?: string };
        if (err?.name === 'AbortError') {
          setRenderLog(prev => `${prev}\n[STOP] Da huy request render.\n`);
        } else {
          toast.info('Notice', "Lỗi gọi API FFmpeg: " + (err.message || String(e)));
          setRenderLog(prev => `${prev}\n[ERROR] ${err.message || String(e)}\n`);
        }
        setIsRendering(false);
        renderAbortRef.current = null;
      }
    }
  };

  const leftPanelProps = {
    store,
    toast,
    appendPanelLog,
    setPanelLog,
    selectLocalFiles,
    addMusicPath,
    updateSelectedMusic,
    openSrtEditor,
    CAPASSISTANT_TTS_VOICES,
    videoPath,
    videoList,
    exportRatio,
    setExportRatio,
    zoom,
    setZoom,
    speed,
    setSpeed,
    mute,
    setMute,
    vocalFilter,
    setVocalFilter,
    flip,
    setFlip,
    gpu,
    setGpu,
    volume,
    setVolume,
    enableSub,
    setEnableSub,
    srtMode,
    setSrtMode,
    audioLang,
    setAudioLang,
    tgtLang,
    setTgtLang,
    masterVoice,
    masterSpeed,
    aiEngine,
    setAiEngine,
    srtFont,
    setSrtFont,
    srtSize,
    setSrtSize,
    srtDelay,
    setSrtDelay,
    isRendering,
    handleVoiceChange,
    handleVoiceSpeedChange,
    handleSelectVideo,
    handleSuggestThumbnail,
    handleSelectSrt,
    handleStepStt,
    handleStepTrans,
    handleStepTts,
    musicList,
    setMusicList,
    selectedMusicIndex,
    setSelectedMusicIndex,
    presetAudios,
    mVol,
    setMVol,
    mDelay,
    setMDelay,
    mDur,
    setMDur,
    mLoop,
    setMLoop,
    handleQuickAudio,
    srtStyle,
    setSrtStyle,
    bgPadding,
    setBgPadding,
    padX,
    setPadX,
    padY,
    setPadY,
    smartBlur,
    setSmartBlur,
    blurs,
    setBlurs,
    blurX,
    setBlurX,
    blurY,
    setBlurY,
    blurW,
    setBlurW,
    blurH,
    setBlurH,
    blurStart,
    setBlurStart,
    blurDur,
    setBlurDur,
    blurPower,
    setBlurPower,
    presetLogos,
    handleQuickLogo,
    useLogo,
    setUseLogo,
    handleSelectLogo,
    logoRescale,
    setLogoRescale,
    logoDelay,
    setLogoDelay,
    useStaticText,
    setUseStaticText,
    staticText,
    setStaticText,
    staticFont,
    setStaticFont,
    staticSize,
    setStaticSize,
    staticDelay,
    setStaticDelay,
    useWm,
    setUseWm,
    wmText,
    setWmText,
    wmDelay,
    setWmDelay,
    enableTrim,
    setEnableTrim,
    trims,
    setTrims,
    enableFrame,
    setEnableFrame,
    handleSelectFrame,
    bypassFx,
    setBypassFx,
    rotate,
    setRotate,
    bright,
    setBright,
    contrast,
    setContrast,
    sat,
    setSat,
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur p-2 font-sans text-white">
      <div className="flex flex-col w-full max-w-[1350px] h-[98vh] bg-[#020617] rounded shadow-2xl border border-slate-700 overflow-hidden">
        
        {/* MAIN CONTENT AREA */}
        <div className="flex flex-1 overflow-hidden">
          
          <VideoEditorLeftColumn {...leftPanelProps} />

          <VideoEditorRightCanvas
            outputPath={outputPath}
            setOutputPath={setOutputPath}
            isRendering={isRendering}
            progress={progress}
            renderLog={renderLog}
            panelLog={panelLog}
            lastResultPath={lastResultPath}
            handlePreviewSource={handlePreviewSource}
            handleRender={handleRender}
            handleAutoMaster={handleAutoMaster}
            handleStopRender={handleStopRender}
            openLocalPath={openLocalPath}
            appendPanelLog={appendPanelLog}
            srtEditor={srtEditor}
            setSrtEditor={setSrtEditor}
            saveSrtEditor={saveSrtEditor}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
