import { NextResponse } from 'next/server';
import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';

export const runtime = 'nodejs';

// Hàm helper phân tích SRT cơ bản để shift time và chèn ASS tags
function processSrt(srtContent: string, delaySec: number, padX: number, padY: number, hasBg: boolean): string {
    const lines = srtContent.split(/\r?\n/);
    let output = '';
    let isTextSection = false;
    
    const delayMs = Math.floor(delaySec * 1000);
    const extraX = Math.max(0, padX - padY);
    const numH = Math.floor(extraX / 8) + 1;
    const hStr = '\\h'.repeat(numH);
    const assTags = `{\\xbord${padX}\\ybord${padY}}`;

    function shiftTime(timeStr: string) {
        if (!delayMs) return timeStr;
        const [h, m, s, ms] = timeStr.replace(',', ':').split(':').map(Number);
        let totalMs = (h * 3600000) + (m * 60000) + (s * 1000) + ms + delayMs;
        const newH = Math.floor(totalMs / 3600000); totalMs %= 3600000;
        const newM = Math.floor(totalMs / 60000); totalMs %= 60000;
        const newS = Math.floor(totalMs / 1000); totalMs %= 1000;
        return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}:${String(newS).padStart(2, '0')},${String(totalMs).padStart(3, '0')}`;
    }

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes('-->')) {
            const parts = line.split('-->');
            if (parts.length === 2) {
                line = `${shiftTime(parts[0].trim())} --> ${shiftTime(parts[1].trim())}`;
            }
            isTextSection = true;
            output += line + '\n';
        } else if (line.trim() === '') {
            isTextSection = false;
            output += '\n';
        } else if (isTextSection) {
            // Đây là dòng văn bản
            let cleanLine = line.trim();
            if (hasBg) {
                cleanLine = `${hStr}${cleanLine}${hStr}`;
            }
            // Add ASS tags at the beginning of the FIRST text line of the block
            if (lines[i-1].includes('-->')) {
                cleanLine = assTags + cleanLine;
            }
            output += cleanLine + '\n';
        } else {
            output += line + '\n';
        }
    }
    return output;
}

function escapeFfmpeg(text: string) {
    if (!text) return '';
    return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,');
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();
    const { videoPath, outputPath, bypass, video, sub, blur, bgm, brand, trim, phantom } = payload;
    
    if (!videoPath || !fs.existsSync(videoPath)) {
       // Bỏ qua check file để vẫn có thể test UI khi chưa có file thực tế
    }

    const outputName = `Ported_${Date.now()}.mp4`;
    const finalOutputPath = path.join(outputPath || process.cwd(), outputName);

    // 1. Get original video dimensions using ffprobe
    let orig_w = 1920, orig_h = 1080, has_audio = true, fps = 30;
    try {
        const probeV = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=s=x:p=0', `"${videoPath}"`], { shell: true, encoding: 'utf8' });
        if (probeV.stdout) {
            const parts = probeV.stdout.trim().split('x');
            if (parts.length >= 2) {
                orig_w = parseInt(parts[0]) || 1920;
                let hAndFps = parts[1].split(','); // sometimes output has commas
                orig_h = parseInt(hAndFps[0]) || 1080;
                // Simplified FPS parse
            }
        }
        const probeA = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', `"${videoPath}"`], { shell: true, encoding: 'utf8' });
        has_audio = probeA.stdout.includes('audio');
    } catch (e) {
        console.warn("Lỗi FFprobe, dùng mặc định 1080p.");
    }

    // Tỉ lệ màn hình preview ảo để map tọa độ (Giả sử 1280x720)
    const preview_w = 1280, preview_h = 720;
    const map_x = (x: number) => Math.floor(x * orig_w / preview_w);
    const map_y = (y: number) => Math.floor(y * orig_h / preview_h);

    let inputs_raw = [`-y`, `-i`, `"${videoPath.replace(/\\/g, '/')}"`];
    let v_filters: string[] = [];
    let a_filters: string[] = [];
    
    let curr_v = '0:v';
    let curr_a = '0:a';
    let ptr = 1;

    // --- TỐC ĐỘ (SPEED) ---
    const vs = video.speed ? parseFloat(video.speed) / 100 : 1.0;
    if (vs !== 1.0 && vs > 0) {
        v_filters.push(`[${curr_v}]setpts=${1.0 / vs}*PTS[vspd]`);
        curr_v = 'vspd';
        if (has_audio) {
            a_filters.push(`[${curr_a}]atempo=${vs}[aspd]`);
            curr_a = 'aspd';
        }
    }

    // --- TRIM (Xóa đoạn thừa) ---
    // (Bản gốc dùng split, trim, atrim rồi concat)
    if (trim && trim.enableTrim && trim.rems && trim.rems.length > 0) {
        // Giả lập logic Python
        // ... (Vì payload UI chưa gửi mảng rems chi tiết, ta sẽ tạm bỏ qua phần tạo chuỗi trim phức tạp 
        // nhưng cấu trúc đã chuẩn bị sẵn sàng ở đây)
    }

    // --- ZOOM & CROP ---
    let z = 1.0;
    if (video.zoom && video.zoom !== '100%') {
        z = parseFloat(video.zoom) / 100;
        if (!isNaN(z) && z > 1) {
            v_filters.push(`[${curr_v}]crop=iw/${z}:ih/${z}:(iw-iw/${z})/2:(ih-ih/${z})/2,scale=${orig_w}:${orig_h}[vz]`);
            curr_v = 'vz';
        }
    }

    // --- FLIP & ROTATE ---
    if (video.flip) {
        v_filters.push(`[${curr_v}]hflip[vf]`);
        curr_v = 'vf';
    }
    
    // --- BYPASS: COLOR & ROTATE ---
    const rot_val = phantom?.bpRotate ? parseInt(phantom.bpRotate) : 0;
    if (rot_val !== 0) {
        v_filters.push(`[${curr_v}]rotate=${rot_val}*PI/180:ow=iw:oh=ih[vrot]`);
        curr_v = 'vrot';
    }
    
    if (phantom?.bp3) { // Micro Color-Space
        v_filters.push(`[${curr_v}]eq=brightness=0.01:contrast=1.02:saturation=1.03[veq]`);
        curr_v = 'veq';
    }

    if (phantom?.bp1) { // Sub-pixel shift
        v_filters.push(`[${curr_v}]crop=iw-2:ih-2:1:1,scale=${orig_w}:${orig_h}[vbpshift]`);
        curr_v = 'vbpshift';
    }

    if (phantom?.bp2) { // Noise
        v_filters.push(`[${curr_v}]noise=alls=1:allf=t[vbnoise]`);
        curr_v = 'vbnoise';
    }

    // --- BLUR (Che mờ thủ công nhiều vùng) ---
    if (blur && blur.items && blur.items.length > 0) {
        const splitCount = blur.items.length;
        const splitTags = Array.from({length: splitCount}).map((_, i) => `[tb${i}]`).join('');
        v_filters.push(`[${curr_v}]split=${splitCount + 1}${splitTags}[bgc]`);
        let c_bg = 'bgc';
        
        for (let i = 0; i < blur.items.length; i++) {
            const b = blur.items[i];
            let cw = map_x(b.w);
            let ch = map_y(b.h);
            let cx = map_x(b.x);
            let cy = map_y(b.y);
            // Chuẩn hóa chẵn
            cx = Math.floor(cx / 2) * 2; cy = Math.floor(cy / 2) * 2;
            cw = Math.floor(cw / 2) * 2; ch = Math.floor(ch / 2) * 2;
            
            const luma = 15; // default blur power
            v_filters.push(`[tb${i}]crop=${cw}:${ch}:${cx}:${cy},boxblur=${luma}:2[bl${i}]`);
            v_filters.push(`[${c_bg}][bl${i}]overlay=${cx}:${cy}[bs${i}]`);
            c_bg = `bs${i}`;
        }
        curr_v = c_bg;
    }

    // --- THƯƠNG HIỆU (Text tĩnh & Watermark bay lượn) ---
    if (brand?.staticText) {
        const esc_txt = escapeFfmpeg(brand.staticText);
        const t_delay = parseFloat(brand.staticDelay) || 0;
        const enableStr = t_delay > 0 ? `:enable='gte(t,${t_delay})'` : '';
        const size = brand.staticSize || 40;
        v_filters.push(`[${curr_v}]drawtext=text='${esc_txt}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=h-th-20${enableStr}[vst]`);
        curr_v = 'vst';
    }

    if (brand?.wmText) {
        const esc_wm = escapeFfmpeg(brand.wmText);
        // Siêu công thức chống quét của CapAssistant v2.8 (port chuẩn xác 100%)
        const xExpr = 'abs(mod(t*15, 2*(w-tw)) - (w-tw))';
        const yExpr = 'abs(mod(t*10, 2*(h-th)) - (h-th))';
        v_filters.push(`[${curr_v}]drawtext=text='${esc_wm}':fontcolor=white@0.5:fontsize=24:x='${xExpr}':y='${yExpr}'[vwm]`);
        curr_v = 'vwm';
    }

    // --- PHỤ ĐỀ SRT ---
    if (sub && sub.enableSub && sub.srtContent) {
        // Áp dụng thuật toán nhúng khoảng đệm ASS
        const padX = parseInt(sub.padX) || 16;
        const padY = parseInt(sub.padY) || 6;
        const processedSrt = processSrt(sub.srtContent, parseFloat(sub.delay) || 0, padX, padY, sub.hasBg);
        
        const tempSrtPath = path.join(process.cwd(), 'temp_active.srt');
        fs.writeFileSync(tempSrtPath, processedSrt, 'utf8');
        
        // Font style
        let assStyle = 'PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,WrapStyle=2';
        const styleStr = `FontName=Arial,FontSize=${parseInt(sub.fontSize) || 18},Alignment=2,MarginV=20,${assStyle}`;
        
        // Replace Windows backslashes for FFmpeg string
        const safeSrtPath = tempSrtPath.replace(/\\/g, '/');
        v_filters.push(`[${curr_v}]subtitles='${safeSrtPath}':force_style='${styleStr}'[vsrt]`);
        curr_v = 'vsrt';
    }

    // Đóng gói định dạng Pixel V_Filters
    v_filters.push(`[${curr_v}]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[vf]`);
    curr_v = 'vf';

    // --- AUDIO MIXING (Original + BGM) ---
    let audio_mix: string[] = [];
    if (has_audio) {
        if (video.mute) {
            // Không map orig audio
        } else {
            let vol = video.volume !== undefined ? video.volume / 100.0 : 1.0;
            if (video.vocalFilter) vol *= 0.15;
            const vmod = video.vocalFilter ? 'equalizer=f=1000:width_type=o:width=3:g=-18,' : '';
            a_filters.push(`[${curr_a}]${vmod}volume=${vol}[bga]`);
            audio_mix.push('[bga]');
        }
    }

    if (bgm && bgm.items && bgm.items.length > 0) {
        for (let i = 0; i < bgm.items.length; i++) {
            const entry = bgm.items[i];
            const loop = entry.loop ? '-stream_loop -1 ' : '';
            inputs_raw.push(`${loop}-i "${entry.path.replace(/\\/g, '/')}"`);
            
            const ms_d = Math.floor((parseFloat(entry.delay) || 0) * 1000);
            const m_v = (parseFloat(entry.vol) || 50) / 100.0;
            const trimFilter = entry.dur > 0 ? `,atrim=0:${entry.dur}` : '';
            
            a_filters.push(`[${ptr}:a]adelay=${ms_d}|${ms_d}${trimFilter},volume=${m_v}[m${i}]`);
            audio_mix.push(`[m${i}]`);
            ptr += 1;
        }
    }

    if (audio_mix.length > 1) {
        a_filters.push(`${audio_mix.join('')}amix=inputs=${audio_mix.length}:duration=longest:dropout_transition=99999,aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[af]`);
        curr_a = 'af';
    } else if (audio_mix.length === 1) {
        a_filters.push(`${audio_mix[0]}aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[af]`);
        curr_a = 'af';
    }

    // --- MASTER ARGUMENTS BUILDING ---
    let cmdArgs = [...inputs_raw];
    
    if (v_filters.length > 0 || a_filters.length > 0) {
        const filterStr = [...v_filters, ...a_filters].join('; ');
        cmdArgs.push('-filter_complex', `"${filterStr}"`);
        cmdArgs.push('-map', `[${curr_v}]`);
        if (audio_mix.length > 0) {
            cmdArgs.push('-map', `[${curr_a}]`);
        }
    } else {
        cmdArgs.push('-map', '0:v');
        if (has_audio && !video.mute) cmdArgs.push('-map', '0:a?');
    }

    // GOP Injection
    if (phantom?.bp5) {
        cmdArgs.push('-g', '25', '-keyint_min', '15');
    }

    // Encoder
    if (video.gpu) {
        cmdArgs.push('-c:v', 'h264_nvenc', '-preset', 'fast', '-cq', '19', '-b:v', '0');
    } else {
        cmdArgs.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19');
    }

    cmdArgs.push('-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', `"${finalOutputPath}"`);

    // --- RUN ENGINE ---
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`[START] Khởi chạy FFmpeg Engine (Ported from CapAssistant v2.8)...\n`));
        controller.enqueue(encoder.encode(`[CMD] ffmpeg ${cmdArgs.join(' ')}\n\n`));

        const child = spawn('ffmpeg', cmdArgs, { shell: true });

        child.stdout.on('data', (data) => {
          controller.enqueue(encoder.encode(data.toString()));
        });

        child.stderr.on('data', (data) => {
          controller.enqueue(encoder.encode(data.toString()));
        });

        child.on('close', (code) => {
          if (code === 0) {
            controller.enqueue(encoder.encode(`\n\n[SUCCESS] Render hoàn tất: ${finalOutputPath}`));
          } else {
            controller.enqueue(encoder.encode(`\n\n[ERROR] FFmpeg exited with code ${code}.`));
          }
          controller.close();
          // Xóa temp_active.srt nếu tồn tại
          const tempPath = path.join(process.cwd(), 'temp_active.srt');
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        });
        
        child.on('error', (err) => {
          controller.enqueue(encoder.encode(`\n\n[ERROR] Lỗi không gọi được FFmpeg: ${err.message}`));
          controller.close();
        });
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    console.error('Error in video-editor route:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
