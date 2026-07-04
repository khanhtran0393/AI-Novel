import React, { useState } from 'react';
import { X, Save, Key, MonitorPlay, Folder, Play, RefreshCw, Plus, Trash2, Settings, Type, FileText, Image as ImageIcon, Minus, HelpCircle, FileAudio, Download } from 'lucide-react';
import { useNovelStore } from '@/store/useNovelStore';
import AudioToolsPanel from './AudioToolsPanel';
import DownloadStudioPanel from './DownloadStudioPanel';
// import AutoRenderTab from './AutoRenderTab';

export interface VideoEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CustomCheckbox = ({ checked, onChange, label }: { checked: boolean, onChange: (val: boolean) => void, label: string }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <input type="checkbox" className="hidden" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <div className={`w-[18px] h-[18px] rounded flex items-center justify-center border transition-colors ${checked ? 'bg-orange-500 border-orange-500' : 'border-slate-500 bg-slate-950'}`}>
      {checked && <Check size={14} className="text-black" strokeWidth={3} />}
    </div>
    <span className="text-xs font-medium text-slate-200">{label}</span>
  </label>
);

const OrangeTab = ({ active, children, onClick }: { active?: boolean, children: React.ReactNode, onClick?: () => void }) => (
  <button 
    onClick={onClick}
    className={`flex-1 py-1.5 rounded text-center text-[11px] font-bold border transition-colors ${active ? 'bg-orange-500 border-orange-500 text-black' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'}`}
  >
    {children}
  </button>
);

const SectionPanel = ({ title, index, children }: { title: string, index: number, children: React.ReactNode }) => (
  <div className="bg-slate-900 border border-slate-700 rounded-lg mt-4 relative pb-3 shadow-md">
    <div className="absolute -top-3 left-4 bg-orange-500 text-black text-[11px] font-bold px-3 py-1 rounded-full shadow-md z-10">
      {index}. {title}
    </div>
    <div className="px-3 pt-5 pb-2 flex flex-col gap-2.5">
      {children}
    </div>
  </div>
);

export default function VideoEditorModal({ isOpen, onClose }: VideoEditorModalProps) {
  const store = useNovelStore();
  const currentChapter = store.danh_sach_chuong.find(c => c.so_chuong === store.chuong_dang_chon);
  
  const [videoPath, setVideoPath] = useState('');
  
  // Ref để lấy content SRT nếu user chọn file
  const [srtPath, setSrtPath] = useState('');
  const [srtContent, setSrtContent] = useState('');
  
  // 1. Video
  const [zoom, setZoom] = useState('100%');
  const [speed, setSpeed] = useState('100%');
  const [mute, setMute] = useState(false);
  const [vocalFilter, setVocalFilter] = useState(false);
  const [flip, setFlip] = useState(false);
  const [gpu, setGpu] = useState(true);
  const [volume, setVolume] = useState(100);
  
  // 2. Sub
  const [enableSub, setEnableSub] = useState(true);
  const [useSrt, setUseSrt] = useState(true);
  const [enableAiVoice, setEnableAiVoice] = useState(false);
  const [font, setFont] = useState('ANTON');
  const [fontSize, setFontSize] = useState('18');
  const [delay, setDelay] = useState('0.00 s');
  const [padX, setPadX] = useState('16');
  const [padY, setPadY] = useState('6');
  const [hasBg, setHasBg] = useState(true);
  
  // 3. Blur
  const [blurW, setBlurW] = useState('576');
  const [blurH, setBlurH] = useState('40');

  // 4. Audio
  const [bgmVol, setBgmVol] = useState('0');
  const [bgmDelay, setBgmDelay] = useState('0.00');
  const [bgmDur, setBgmDur] = useState('0.00');
  const [bgmLoop, setBgmLoop] = useState(false);

  // 5. Brand
  const [logoSize, setLogoSize] = useState('');
  const [logoDelay, setLogoDelay] = useState('0.00');
  const [staticText, setStaticText] = useState('');
  const [staticSize, setStaticSize] = useState('40');
  const [staticDelay, setStaticDelay] = useState('0.00');
  const [wmText, setWmText] = useState('CapAssistant');
  const [wmDelay, setWmDelay] = useState('0.00');

  // 6. Trim
  const [enableTrim, setEnableTrim] = useState(false);

  // 7. Bypass
  const [enableFrame, setEnableFrame] = useState(false);
  const [bp1, setBp1] = useState(false);
  const [bp2, setBp2] = useState(false);
  const [bp3, setBp3] = useState(false);
  const [bp4, setBp4] = useState(false);
  const [bp5, setBp5] = useState(false);
  const [bp6, setBp6] = useState(false);
  const [bp7, setBp7] = useState(false);
  const [bpRotate, setBpRotate] = useState('0');
  
  const [outputPath, setOutputPath] = useState('C:\\Users\\Khanh\\Downloads');
  const [bypass, setBypass] = useState(false);
  
  const [isRendering, setIsRendering] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [renderLog, setRenderLog] = useState('');

  const [showAudioTools, setShowAudioTools] = useState(false);
  const [showDownloadStudio, setShowDownloadStudio] = useState(false);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (videoRef.current && duration > 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      videoRef.current.currentTime = pos * duration;
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const handleRender = async () => {
    if (!store.chuong_dang_chon) { alert("Vui lòng chọn 1 chương trước!"); return; }
    if (confirm("Xác nhận Dựng Video cho Chương này?")) {
      try {
        setIsRendering(true);
        setRenderLog("[START] Khởi chạy Engine...\n");
        const res = await fetch('/api/video-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoPath,
            outputPath,
            bypass,
            video: { zoom, speed, mute, vocalFilter, flip, gpu, volume },
            sub: { enableSub, useSrt, enableAiVoice, font, fontSize, delay, padX, padY, srtContent, hasBg },
            blur: { items: [{ x: 0, y: 0, w: blurW, h: blurH }] },
            bgm: { items: [{ path: '', vol: bgmVol, delay: bgmDelay, dur: bgmDur, loop: bgmLoop }] },
            brand: { logoSize, logoDelay, staticText, staticSize, staticDelay, wmText, wmDelay },
            trim: { enableTrim, rems: [] },
            phantom: { enableFrame, bp1, bp2, bp3, bp4, bp5, bp6, bp7, bpRotate }
          })
        });
        
        if (!res.body) throw new Error("Stream API không hoạt động");
        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let done = false;
        let fullLog = "";
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            fullLog += chunk;
            setRenderLog(prev => prev + chunk);
            if (chunk.includes('[SUCCESS]')) {
              const urlMatch = chunk.match(/\\[SUCCESS\\]\\s+(.*)/);
              if (urlMatch) {
                setTimeout(() => {
                  if (confirm("🎬 Dựng phim hoàn tất!\\nBấm OK để mở xem video kết quả.")) window.open(urlMatch[1].trim(), '_blank');
                  setIsRendering(false);
                }, 500);
              }
            } else if (chunk.includes('[ERROR]')) {
              alert("Lỗi Render! Xem log để biết chi tiết.");
            }
          }
        }
      } catch(e: any) { alert("Lỗi gọi API FFmpeg: " + e.message); setIsRendering(false); }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur p-4 font-sans text-white">
      <div className="flex flex-col w-full max-w-[1280px] h-[90vh] bg-slate-950 rounded-lg shadow-2xl border border-slate-700 overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between bg-slate-900 border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-sky-500 uppercase tracking-widest flex items-center gap-2">
              <MonitorPlay size={20} /> TRÌNH DỰNG PHIM (Video Editor)
            </h2>
            <p className="text-slate-400 text-xs mt-1">Xử lý hiệu ứng, lách bản quyền và render từng video riêng lẻ.</p>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => alert("Gọi API /api/navtools/subtitle chạy ngầm")}
              className="px-4 py-2 bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-400 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors border border-emerald-800"
              title="Sử dụng sức mạnh của NAVTools FFmpeg Subtitle"
            >
              <MonitorPlay size={14} /> LÀM SUB (NAV)
            </button>
            <button 
              onClick={() => setShowAudioTools(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors border border-slate-700"
            >
              <FileAudio size={14} /> AUDIO TOOLS
            </button>
            <button 
              onClick={() => setShowDownloadStudio(true)}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] font-bold flex items-center gap-1.5 transition-colors border border-slate-700 mr-2"
            >
              <Download size={14} /> TẢI VIDEO
            </button>
            <button onClick={onClose} className="p-2 hover:bg-red-500 hover:text-white rounded-md text-slate-400 transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="flex flex-1 overflow-x-auto overflow-y-hidden p-2 gap-2 custom-scrollbar">
          
          {/* LEFT COLUMN - SCROLLABLE SETTINGS */}
          <div 
            className="flex flex-col overflow-y-auto custom-scrollbar pr-4 pb-10"
            style={{ width: '410px', minWidth: '410px', flexShrink: 0 }}
          >
            
            {/* Top Buttons Left */}
            <div className="flex items-center gap-2 py-1 sticky top-0 bg-slate-950 z-20 pb-2">
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold rounded">
                <Save size={12} /> Lưu Cấu Hình
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-orange-500 text-[10px] font-bold rounded border border-orange-500/30">
                <Key size={12} /> Đổi Key
              </button>
              <span className="text-[10px] text-orange-500 font-bold ml-1 tracking-wider">Bản quyền: AI Novel</span>
            </div>

            {/* 1. Video */}
            <SectionPanel index={1} title="Video Tốc độ Phóng to">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => {
                  const p = prompt("Nhập đường dẫn tuyệt đối của Video cần sửa:", videoPath);
                  if (p) setVideoPath(p);
                }} className="bg-orange-500 hover:bg-orange-600 text-black rounded py-1.5 flex justify-center items-center gap-1.5 font-bold text-[11px]">
                  <Folder size={12} /> Chọn Video (Single)
                </button>
                <button className="bg-orange-500 hover:bg-orange-600 text-black rounded py-1.5 flex justify-center items-center gap-1.5 font-bold text-[11px]">
                  <ImageIcon size={12} /> Thumbnail
                </button>
              </div>
              <div className="text-slate-500 italic text-[10px] truncate" title={videoPath || "Chưa nạp video."}>
                {videoPath ? `File: ${videoPath}` : "Chưa nạp video."}
              </div>
              <div className="flex items-center gap-2 relative">
                <span className="text-[11px] font-medium text-slate-300 w-[65px]">Khung hình:</span>
                <select className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-white text-[11px] outline-none">
                  <option>Giữ nguyên Gốc</option>
                  <option>1:1 (Vuông)</option>
                  <option>16:9 (Ngang)</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-medium text-slate-300">Phóng to (Zoom %):</div>
                <div className="grid grid-cols-4 gap-1">
                  <OrangeTab active={zoom==='100%'} onClick={()=>setZoom('100%')}>100%</OrangeTab>
                  <OrangeTab active={zoom==='110%'} onClick={()=>setZoom('110%')}>110%</OrangeTab>
                  <OrangeTab active={zoom==='120%'} onClick={()=>setZoom('120%')}>120%</OrangeTab>
                  <div className="bg-slate-800 border border-slate-700 rounded flex items-center justify-center text-[10px] text-slate-400">Tùy chỉnh</div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-medium text-slate-300">Tốc độ (%):</div>
                <div className="grid grid-cols-4 gap-1">
                  <OrangeTab active={speed==='80%'} onClick={()=>setSpeed('80%')}>80%</OrangeTab>
                  <OrangeTab active={speed==='90%'} onClick={()=>setSpeed('90%')}>90%</OrangeTab>
                  <OrangeTab active={speed==='100%'} onClick={()=>setSpeed('100%')}>100%</OrangeTab>
                  <div className="bg-slate-800 border border-slate-700 rounded flex items-center justify-center text-[10px] text-slate-400">Tùy chỉnh</div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1 mt-1">
                <CustomCheckbox checked={mute} onChange={setMute} label="Mute" />
                <CustomCheckbox checked={vocalFilter} onChange={setVocalFilter} label="Lọc Vocal" />
                <CustomCheckbox checked={flip} onChange={setFlip} label="Lật Ngang" />
                <CustomCheckbox checked={gpu} onChange={setGpu} label="GPU" />
              </div>
              <div className="flex flex-col gap-1.5 mt-1">
                <div className="text-[11px] font-medium text-slate-300">Âm lượng gốc: {volume}%</div>
                <input type="range" min="0" max="200" value={volume} onChange={(e)=>setVolume(parseInt(e.target.value))} className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-orange-500" />
              </div>
            </SectionPanel>

            {/* 2. Sub */}
            <SectionPanel index={2} title="Phụ đề Âm thanh">
              <div className="grid grid-cols-2 gap-y-2">
                <CustomCheckbox checked={enableSub} onChange={setEnableSub} label="Bật Phụ đề" />
                <CustomCheckbox checked={enableAiVoice} onChange={setEnableAiVoice} label="Bật Đọc Giọng AI" />
                <CustomCheckbox checked={useSrt} onChange={setUseSrt} label="Dùng File SRT" />
              </div>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button onClick={() => {
                  const p = prompt("Nhập đường dẫn tuyệt đối của file SRT:", srtPath);
                  if (p) {
                    setSrtPath(p);
                    try {
                      // Đọc giả lập qua web API hoặc bỏ qua nếu không the read local
                      // Trong thực tế nextjs ko read được local path ngoài trình duyệt, 
                      // nên UI này chỉ để demo, API route phải tự đọc nếu ta gửi path lên!
                      setSrtContent(`1\n00:00:01,000 --> 00:00:05,000\n[Dữ liệu SRT từ UI]\n\n`);
                    } catch(e) {}
                  }
                }} className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded py-1.5 flex justify-center items-center gap-1.5 text-[11px] font-bold">
                  <FileText size={12} /> Chọn SRT
                </button>
                <button className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded py-1.5 flex justify-center items-center gap-1.5 text-[11px] font-bold">
                  <Settings size={12} /> Xem SRT
                </button>
              </div>
              <div className="text-slate-500 italic text-[10px] truncate mt-1" title={srtPath || "Chưa nạp SRT."}>
                {srtPath ? `File: ${srtPath}` : "Chưa nạp SRT."}
              </div>
              <div className="mt-2 relative border border-slate-700 p-2.5 pt-4 rounded bg-slate-800/50">
                <div className="absolute -top-2 left-2 text-orange-500 text-[10px] font-bold flex items-center gap-1 bg-slate-900 px-1 rounded">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div> Hình thức & Vị trí Phụ đề
                </div>
                <div className="flex flex-col gap-2 text-[11px] text-slate-300">
                  <div className="flex items-center gap-1">
                    <span className="w-8">Font:</span>
                    <select className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1" value={font} onChange={(e)=>setFont(e.target.value)}>
                      <option>ANTON</option>
                      <option>ROBOTO</option>
                    </select>
                    <span className="w-6 text-right text-orange-500">Size:</span>
                    <input type="number" value={fontSize} onChange={(e)=>setFontSize(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                    <span className="w-6 text-right">Trễ:</span>
                    <input type="text" value={delay} onChange={(e)=>setDelay(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14">Style Nền:</span>
                    <select className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-orange-500 font-bold"
                      value={hasBg ? "1" : "0"} onChange={(e) => setHasBg(e.target.value === "1")}>
                      <option value="1">Bật Nền Viền đen</option>
                      <option value="0">Tắt Nền</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14">Khoảng đệm:</span>
                    <span>Pad X:</span>
                    <input type="number" value={padX} onChange={(e)=>setPadX(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                    <span className="ml-1">Pad Y:</span>
                    <input type="number" value={padY} onChange={(e)=>setPadY(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14">Kích thước:</span>
                    <input type="text" className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1" />
                  </div>
                </div>
              </div>
            </SectionPanel>

            {/* 3. Blur */}
            <SectionPanel index={3} title="Che Mờ (Blur)">
              <div className="text-[11px] text-slate-300">Che mờ thủ công:</div>
              <div className="flex items-center gap-2">
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300">[+] Thêm</button>
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300">[-] Xóa</button>
                <span className="text-[11px] text-slate-300 ml-auto">W:</span>
                <input type="text" value={blurW} onChange={e=>setBlurW(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-[11px] text-center" />
                <span className="text-[11px] text-slate-300">H:</span>
                <input type="text" value={blurH} onChange={e=>setBlurH(e.target.value)} className="w-12 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-[11px] text-center" />
              </div>
            </SectionPanel>

            {/* 4. Nhạc Nền */}
            <SectionPanel index={4} title="Playlist Nhạc Nền">
              <div className="text-[11px] text-slate-300 flex items-center gap-2">🎵 Nhạc nhanh:
                <div className="flex gap-1 flex-1">
                  {['1','2','3','4'].map(i => <OrangeTab key={i}>Audio {i}</OrangeTab>)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300">[+] Chọn file</button>
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300">[-] Xóa bài</button>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span>Vol:</span>
                <input type="text" value={bgmVol} onChange={e=>setBgmVol(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>%</span>
                <span className="ml-1">Delay:</span>
                <input type="text" value={bgmDelay} onChange={e=>setBgmDelay(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>s</span>
                <span className="ml-1">Dur:</span>
                <input type="text" value={bgmDur} onChange={e=>setBgmDur(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <CustomCheckbox checked={bgmLoop} onChange={setBgmLoop} label="Loop" />
              </div>
            </SectionPanel>

            {/* 5. Thương hiệu */}
            <SectionPanel index={5} title="Thương hiệu">
              <div className="text-[11px] text-slate-300 flex items-center gap-2">🌟 Logo nhanh:
                <div className="flex gap-1 flex-1">
                  {['1','2','3','4'].map(i => <OrangeTab key={i}>Logo {i}</OrangeTab>)}
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span className="w-10">Logo:</span>
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded flex gap-1 items-center"><ImageIcon size={10}/> Duyệt</button>
                <span className="ml-auto">Size:</span>
                <input type="text" value={logoSize} onChange={e=>setLogoSize(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>Delay:</span>
                <input type="text" value={logoDelay} onChange={e=>setLogoDelay(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>s</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span className="w-10">Text:</span>
                <input type="text" value={staticText} onChange={e=>setStaticText(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1" />
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span className="w-10"></span>
                <span>Cỡ:</span>
                <input type="text" value={staticSize} onChange={e=>setStaticSize(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span className="ml-2">Delay:</span>
                <input type="text" value={staticDelay} onChange={e=>setStaticDelay(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>s</span>
              </div>
              <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-300">
                <span className="w-16">Watermark:</span>
                <input type="text" value={wmText} onChange={e=>setWmText(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1" />
                <span>Dly:</span>
                <input type="text" value={wmDelay} onChange={e=>setWmDelay(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>s</span>
              </div>
            </SectionPanel>

            {/* 6. Xóa đoạn thừa */}
            <SectionPanel index={6} title="Xóa đoạn thừa">
              <CustomCheckbox checked={enableTrim} onChange={setEnableTrim} label="Bật tính năng xóa" />
              <div className="flex items-center gap-2 mt-1">
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300">[+] Thêm</button>
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300">[-] Xóa</button>
              </div>
            </SectionPanel>

            {/* 7. Bypass */}
            <SectionPanel index={7} title="Bypass Xử lý Nâng Cao (Tích hợp Phantom-X)">
              <div className="flex items-center gap-2">
                <CustomCheckbox checked={enableFrame} onChange={setEnableFrame} label="Bật Khung Overlay (Frame)" />
                <button className="bg-slate-800 border border-slate-700 px-2 py-1 rounded text-[10px] text-slate-300 flex items-center gap-1"><ImageIcon size={10}/> Duyệt Frame PNG</button>
              </div>
              <div className="flex flex-col gap-1.5 mt-2">
                {[
                  { state: bp1, set: setBp1, label: "1. Phantom Sub-Pixel Shift (Chống băm hình pHash)" },
                  { state: bp2, set: setBp2, label: "2. Dynamic Temporal Noise (Nhiễu thời gian thực)" },
                  { state: bp3, set: setBp3, label: "3. Micro Color-Space Shift (Đổi mã màu vi mô)" },
                  { state: bp4, set: setBp4, label: "4. Tempo Shift Audio Mask (Chống băm sóng âm)" },
                  { state: bp5, set: setBp5, label: "5. Asymmetric GOP Injection (Phá cấu trúc Keyframe)" },
                  { state: bp6, set: setBp6, label: "6. Dynamic Zoom Pan (Lách AI nhận diện vật thể)" },
                  { state: bp7, set: setBp7, label: "7. Ultimate Bypass (Siêu việt - Phá vỡ toàn diện)" }
                ].map((bp, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <CustomCheckbox checked={bp.state} onChange={bp.set} label={bp.label} />
                    <HelpCircle size={12} className="text-orange-500 cursor-pointer" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-300">
                <span className="w-14">Bypass FX:</span>
                <select className="flex-1 bg-slate-950 border border-slate-700 rounded px-1 py-1"><option></option></select>
                <span>Xoay:</span>
                <input type="text" value={bpRotate} onChange={e=>setBpRotate(e.target.value)} className="w-10 bg-slate-950 border border-slate-700 rounded px-1 py-1 text-center" />
                <span>°</span>
              </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2 text-[11px] text-slate-300">
                <div className="flex flex-col gap-1"><span>Sáng:</span><input type="range" className="accent-orange-500"/></div>
                <div className="flex flex-col gap-1"><span>Tương Phản:</span><input type="range" className="accent-orange-500"/></div>
                <div className="flex flex-col gap-1"><span>Rực Màu:</span><input type="range" className="accent-orange-500"/></div>
              </div>
            </SectionPanel>
          </div>

          {/* RIGHT COLUMN - PREVIEW & CONSOLE */}
          <div 
            className="flex-1 flex flex-col gap-4 overflow-hidden pl-2 pb-10 custom-scrollbar overflow-y-auto"
            style={{ minWidth: '550px' }}
          >
            <div className="bg-black border border-slate-700 rounded-lg aspect-video relative flex items-center justify-center overflow-hidden shadow-lg group">
              {videoPath ? (
                <video 
                  ref={videoRef}
                  src={`/api/serve-local-video?path=${encodeURIComponent(videoPath)}`} 
                  className="w-full h-full object-contain"
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onEnded={() => setIsPlaying(false)}
                  onClick={togglePlay}
                />
              ) : (
                <div className="text-emerald-500 text-5xl font-black uppercase tracking-wider" style={{ textShadow: '0 0 20px rgba(16,185,129,0.3)' }}>AI NOVEL</div>
              )}
            </div>

            {/* Play controls */}
            <div className="flex items-center gap-3 bg-slate-900 p-2 rounded-lg border border-slate-700">
              <button 
                onClick={togglePlay}
                className="bg-sky-500 hover:bg-sky-600 text-white rounded px-4 py-1.5 flex items-center gap-1.5 font-bold text-[11px] w-[80px] justify-center"
              >
                {isPlaying ? <span className="font-sans">||</span> : <Play size={12} fill="currentColor" />} {isPlaying ? 'Pause' : 'Play'}
              </button>
              <div className="flex-1 h-2 bg-slate-700 rounded-full relative cursor-pointer group" onClick={handleSeek}>
                <div className="absolute left-0 top-0 bottom-0 bg-sky-500 rounded-full" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}></div>
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-md scale-0 group-hover:scale-100 transition-transform" 
                  style={{ left: `calc(${duration > 0 ? (currentTime / duration) * 100 : 0}% - 7px)` }}
                ></div>
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                {formatTime(currentTime)} / {formatTime(duration)} (Dự: {formatTime(duration)})
              </div>
            </div>

            {/* Console log */}
            <div className="flex-1 min-h-[120px] bg-black border border-slate-700 rounded p-3 font-mono text-[10px] text-emerald-500 overflow-y-auto whitespace-pre-wrap">
              {renderLog || "FFmpeg Console Output..."}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button onClick={handleRender} disabled={isRendering} className="flex-1 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-black font-black py-4 rounded text-sm uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-50 transition-all shadow-lg shadow-orange-500/20">
                {isRendering ? <RefreshCw className="animate-spin" size={18} /> : <MonitorPlay size={18} />}
                {isRendering ? 'Đang Khởi Tạo FFmpeg...' : 'Render Video'}
              </button>
              <button className="px-6 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-300 font-bold flex items-center gap-2 transition-colors">
                <Save size={18} /> Lưu Project
              </button>
            </div>
          </div>
        </div>
      </div>

      {showAudioTools && <AudioToolsPanel onClose={() => setShowAudioTools(false)} />}
      {showDownloadStudio && <DownloadStudioPanel onClose={() => setShowDownloadStudio(false)} />}
    </div>
  );
}

function Check({ size, className, strokeWidth }: { size: number, className?: string, strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth || 3} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}
