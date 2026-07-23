/**
 * Clone Voice API — auto-optimize sample + engine + profile + synthesize.
 * Independent of Vina-Voice.exe.
 */
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { synthesizeVinaVoice, probeVinaEngine } from '@/lib/vinaVoice';
import {
  optimizeCloneSample,
  stableSeedFromString,
  assessRefTextAlignment,
  probeDuration,
} from '@/lib/vinaVoice/sampleOptimize';
import { inspectTtsAudioFile } from '@/lib/tts/audioQuality';
import { requireFeature } from '@/lib/commercial/apiGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

export async function POST(req: Request) {
  const optimizeLog: string[] = [];
  try {
    // Token from header; form body is multipart (not JSON claims)
    const denied = await requireFeature(req, 'tts_premium');
    if (denied) return denied;
    const form = await req.formData();
    const text = String(form.get('text') || '').trim();
    const refText = String(form.get('ref_text') || form.get('reference_text') || '').trim();
    let gender = String(form.get('gender') || 'auto').toLowerCase();
    let speed = parseFloat(String(form.get('speed') || '1'));
    let pitch = parseFloat(String(form.get('pitch') || '0'));
    const autoOptimize = String(form.get('auto_optimize') || '1') !== '0';
    const assignTarget = String(form.get('assign_target') || 'global').trim();
    const charQuirk = String(form.get('char_quirk') || '').trim();
    const charGender = String(form.get('char_gender') || '').trim();
    let speakerSeed = parseInt(String(form.get('speaker_seed') || '0'), 10) || 0;
    let styleSeed = parseInt(String(form.get('style_seed') || '0'), 10) || 0;
    const engineUrl = String(
      form.get('engine_url') || process.env.VINA_ENGINE_URL || 'http://127.0.0.1:8765',
    );

    if (!text) {
      return NextResponse.json({ error: 'Thiếu nội dung cần đọc (text).' }, { status: 400 });
    }
    if (!refText) {
      return NextResponse.json(
        {
          error:
            'Thiếu transcript mẫu (ref_text). Hãy nhập chính xác câu đang được nói trong file MP3/WAV để clone bám đúng người.',
        },
        { status: 400 },
      );
    }

    const file = form.get('audio') || form.get('file') || form.get('reference');
    if (!file || typeof file === 'string') {
      return NextResponse.json(
        {
          error:
            'Thiếu file mẫu giọng (MP3/WAV). Clone Voice cần audio mẫu giống app Vina.',
        },
        { status: 400 },
      );
    }

    const blob = file as File;
    const name = (blob.name || 'sample.mp3').replace(/[^\w.\-() ]+/g, '_');
    const ext = path.extname(name).toLowerCase() || '.mp3';
    if (!['.mp3', '.wav', '.m4a', '.ogg', '.flac', '.webm'].includes(ext)) {
      return NextResponse.json(
        { error: 'Định dạng không hỗ trợ. Dùng MP3, WAV, M4A, OGG, FLAC.' },
        { status: 400 },
      );
    }

    const id = `${Date.now()}_${randomBytes(4).toString('hex')}`;
    const userDir = path.join(process.cwd(), 'data', 'vina-voices', 'user-clones');
    const publicDir = path.join(process.cwd(), 'public', 'audio', 'clones');
    ensureDir(userDir);
    ensureDir(publicDir);

    const rawPath = path.join(userDir, `${id}_raw${ext}`);
    const refWav = path.join(userDir, `${id}_ref.wav`);
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length < 1000) {
      return NextResponse.json({ error: 'File mẫu quá nhỏ / rỗng.' }, { status: 400 });
    }
    if (buf.length > 40 * 1024 * 1024) {
      return NextResponse.json({ error: 'File mẫu tối đa 40MB.' }, { status: 400 });
    }
    fs.writeFileSync(rawPath, buf);

    // —— Tự tối ưu mẫu ——
    // Identity-first: do NOT auto-nudge pitch/speed from char quirks during clone.
    // Quirk-based pitch (±2 st) was a common reason clone F0 sounded far from source.
    let sampleDurSec = 0;
    if (autoOptimize) {
      const opt = optimizeCloneSample(rawPath, refWav, { maxSec: 12 });
      optimizeLog.push(...(opt.steps || []));
      if (!opt.ok) {
        return NextResponse.json(
          { error: `Tối ưu mẫu thất bại: ${opt.error}`, optimize: optimizeLog },
          { status: 500 },
        );
      }
      sampleDurSec = opt.durationHintSec || 0;
      if (sampleDurSec) {
        optimizeLog.push(`dur≈${sampleDurSec.toFixed(1)}s`);
      }
      // Seed ổn định từ tên file + text
      if (!speakerSeed) {
        speakerSeed = stableSeedFromString(name + refText, 1);
        optimizeLog.push(`speaker_seed=${speakerSeed}`);
      }
      if (!styleSeed) {
        styleSeed = stableSeedFromString(text.slice(0, 80), 2);
        optimizeLog.push(`style_seed=${styleSeed}`);
      }
      // Gender auto từ form char / filename (metadata only — ONNX does not use gender)
      if (gender === 'auto' || !gender) {
        const blob = `${charGender} ${charQuirk} ${name} ${refText}`.toLowerCase();
        if (/(nữ|nu |female|cô |chị |bà |girl|woman)/i.test(blob)) {
          gender = 'female';
          optimizeLog.push('gender=female(auto)');
        } else if (/(nam|male|anh |ông |boy|man)/i.test(blob)) {
          gender = 'male';
          optimizeLog.push('gender=male(auto)');
        } else {
          gender = 'male';
          optimizeLog.push('gender=male(default)');
        }
      }
      if (charQuirk) {
        optimizeLog.push('char_quirk_ignored_for_pitch_identity');
      }
    } else {
      // plain convert only
      const opt = optimizeCloneSample(rawPath, refWav, { maxSec: 30 });
      optimizeLog.push('manual_mode', ...(opt.steps || []));
      if (!opt.ok) {
        return NextResponse.json(
          { error: opt.error || 'convert mẫu fail' },
          { status: 500 },
        );
      }
      sampleDurSec = opt.durationHintSec || 0;
      if (!speakerSeed) speakerSeed = 2336;
      if (!styleSeed) styleSeed = 4125;
      if (gender === 'auto') gender = 'male';
    }

    if (!Number.isFinite(speed)) speed = 1;
    if (!Number.isFinite(pitch)) pitch = 0;
    // Clone identity default: speed=1, pitch=0 unless user explicitly moved sliders
    speed = Math.max(0.5, Math.min(2, speed));
    pitch = Math.max(-12, Math.min(12, pitch));

    // Hard-fail when transcript does not match kept sample length (F0 drift root cause)
    if (!sampleDurSec || sampleDurSec < 0.5) {
      sampleDurSec = probeDuration(refWav);
    }
    const align = assessRefTextAlignment(refText, sampleDurSec || 8);
    if (!align.ok) {
      return NextResponse.json(
        {
          error: align.error,
          optimize: optimizeLog,
          align: { charsPerSec: align.charsPerSec, durationSec: sampleDurSec },
        },
        { status: 400 },
      );
    }
    if (align.warning) {
      optimizeLog.push(`align_warn:${align.charsPerSec.toFixed(1)}cps`);
    } else {
      optimizeLog.push(`align_ok:${align.charsPerSec.toFixed(1)}cps`);
    }

    const referenceQuality = inspectTtsAudioFile(refWav);
    if (!referenceQuality.ok) {
      return NextResponse.json(
        {
          error:
            `File mẫu không đạt kiểm định giọng người: ${referenceQuality.reasons.join('; ')}. ` +
            'Hãy dùng đoạn nói rõ, không nhạc nền và không nhiễu.',
          quality: referenceQuality,
        },
        { status: 400 },
      );
    }
    // Probe engine (không block nếu offline)
    const engine = await probeVinaEngine(engineUrl, 2000);
    optimizeLog.push(
      engine.online
        ? engine.xtts_available
          ? 'engine=xtts'
          : 'engine=online_http'
        : 'engine=offline_onnx_only',
    );

    // Persist profile
    const profilesUserPath = path.join(
      process.cwd(),
      'data',
      'vina-voices',
      'profiles_user.json',
    );
    let userProfiles: Record<string, unknown> = {};
    try {
      if (fs.existsSync(profilesUserPath)) {
        userProfiles = JSON.parse(fs.readFileSync(profilesUserPath, 'utf8'));
      }
    } catch {
      userProfiles = {};
    }
    const profileName = `USER Clone ${id.slice(-6)}`;
    userProfiles[profileName] = {
      filename: path.basename(refWav),
      text: refText,
      speed: Math.max(0.5, Math.min(2, speed)),
      speaker_seed: speakerSeed,
      style_seed: styleSeed,
      pitch_shift: pitch,
      _source: 'user_upload',
      _dir: userDir,
      createdAt: new Date().toISOString(),
      autoOptimized: autoOptimize,
      optimizeSteps: optimizeLog,
    };
    fs.writeFileSync(profilesUserPath, JSON.stringify(userProfiles, null, 2), 'utf8');

    const rollbackProfile = () => {
      try {
        delete userProfiles[profileName];
        fs.writeFileSync(
          profilesUserPath,
          JSON.stringify(userProfiles, null, 2),
          'utf8',
        );
      } catch (rollbackError) {
        console.error('[vina-voice/clone] rollback profile failed', rollbackError);
      }
    };

    try {
      const samplesDir = path.join(process.cwd(), 'data', 'vina-voices', 'samples');
      ensureDir(samplesDir);
      const alias = path.join(samplesDir, path.basename(refWav));
      if (!fs.existsSync(alias)) fs.copyFileSync(refWav, alias);
    } catch {
      /* ignore */
    }

    // Full NFE for clone create (not preview-16): better pitch/timbre lock to sample.
    // Identity prosody: emotion=neutral so post-FX does not shift F0 vs reference.
    const result = await synthesizeVinaVoice(
      {
        text,
        profileName,
        forceBuiltin: false,
        isPreview: false,
        isChapter: false,
        settings: {
          gender: gender === 'female' ? 'female' : 'male',
          area: 'southern',
          emotion: 'neutral',
          speed,
          pitch_shift: pitch,
          speaker_seed: speakerSeed,
          style_seed: styleSeed,
          formant: 1.0,
          treble_boost: 0,
          use_clone: true,
          reference_audio: refWav,
          reference_text: refText,
          engine_url: engineUrl,
          samples_dir: userDir,
        },
      },
      {
        outDir: path.join(process.cwd(), 'scratch', 'vina-clone', id),
      },
    );

    if (!result.ok || !result.audioPath || !fs.existsSync(result.audioPath)) {
      rollbackProfile();
      return NextResponse.json(
        {
          error: result.error || 'Clone synthesize thất bại',
          warnings: result.warnings,
          method: result.method,
          refWav,
          optimize: optimizeLog,
          engine,
        },
        { status: 500 },
      );
    }

    const outputQuality = inspectTtsAudioFile(result.audioPath);
    if (!outputQuality.ok) {
      rollbackProfile();
      return NextResponse.json(
        {
          error:
            `Giọng clone sinh ra bị từ chối vì nhiễu/hỏng: ${outputQuality.reasons.join('; ')}. ` +
            'Không lưu profile lỗi này.',
          quality: outputQuality,
          method: result.method,
        },
        { status: 502 },
      );
    }

    const publicName = `clone_${id}.wav`;
    const publicPath = path.join(publicDir, publicName);
    fs.copyFileSync(result.audioPath, publicPath);

    console.log(
      `[vina-voice/clone] OK ${profileName} method=${result.method} opt=${optimizeLog.join(',')}`,
    );

    return NextResponse.json({
      success: true,
      ok: true,
      method: result.method,
      chunks: result.chunks,
      warnings: result.warnings,
      audioPath: `/audio/clones/${publicName}`,
      refPath: refWav,
      profileName,
      mimeType: 'audio/wav',
      optimized: {
        auto: autoOptimize,
        steps: optimizeLog,
        speed,
        pitch,
        gender: gender === 'female' ? 'female' : 'male',
        speakerSeed,
        styleSeed,
        assignTarget,
      },
      quality: outputQuality,
      engine,
    });
  } catch (e) {
    console.error('[vina-voice/clone]', e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        optimize: optimizeLog,
      },
      { status: 500 },
    );
  }
}
