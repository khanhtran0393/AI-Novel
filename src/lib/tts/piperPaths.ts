/**
 * Piper runtime + VN ONNX model roots.
 * Packaged Electron: AI_NOVEL_ROOT = process.resourcesPath (extraResources/bin/…).
 * Dev: process.cwd() / project root.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** DLLs next to piper.exe required for load (Windows). */
export const PIPER_REQUIRED_DLLS = [
  'espeak-ng.dll',
  'onnxruntime.dll',
  'onnxruntime_providers_shared.dll',
  'piper_phonemize.dll',
] as const;

export function resolveNovelRoot(): string {
  const env = String(process.env.AI_NOVEL_ROOT || '').trim();
  if (env && fs.existsSync(env)) return env;
  return process.cwd();
}

/** bin/piper — piper.exe + onnxruntime + espeak data */
export function resolvePiperBinDir(root = resolveNovelRoot()): string {
  return path.join(root, 'bin', 'piper');
}

/** bin/piper_vn — *.onnx voice models */
export function resolvePiperModelsDir(root = resolveNovelRoot()): string {
  return path.join(root, 'bin', 'piper_vn');
}

export function resolvePiperExe(root = resolveNovelRoot()): string {
  return path.join(resolvePiperBinDir(root), 'piper.exe');
}

export function resolvePiperEspeakDataDir(root = resolveNovelRoot()): string {
  return path.join(resolvePiperBinDir(root), 'espeak-ng-data');
}

/**
 * Writable scratch for piper wav (avoid writing into read-only Program Files resources).
 * Prefer userData → os.tmpdir → project scratch.
 */
export function resolvePiperScratchDir(root = resolveNovelRoot()): string {
  const candidates = [
    process.env.AI_NOVEL_USER_DATA
      ? path.join(String(process.env.AI_NOVEL_USER_DATA).trim(), 'scratch', 'piper-multi')
      : '',
    path.join(os.tmpdir(), 'ainovel-piper-multi'),
    path.join(root, 'scratch', 'piper-multi'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.w_${process.pid}`);
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      /* try next */
    }
  }
  // Last resort — may throw later
  const fallback = path.join(os.tmpdir(), 'ainovel-piper-multi');
  fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function listPiperOnnxModels(root = resolveNovelRoot()): string[] {
  const dir = resolvePiperModelsDir(root);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.onnx'));
  } catch {
    return [];
  }
}

/** Voice id format: `model.onnx` or `model.onnx#speakerId` (multi-speaker). */
export type PiperVoiceRef = {
  modelName: string;
  modelPath: string;
  /** Integer speaker id for multi-speaker models; omit/0 for single-speaker */
  speakerId: number;
};

export type PiperVoiceOption = {
  id: string;
  name: string;
  gender?: 'male' | 'female' | 'neutral';
  modelName: string;
  speakerId: number;
};

/** Friendly labels for known ship / rhasspy models */
const PIPER_MODEL_LABELS: Record<string, { name: string; gender?: PiperVoiceOption['gender'] }> = {
  'ngochuyen.onnx': { name: 'Ngọc Huyền (Nữ)', gender: 'female' },
  'manhdung.onnx': { name: 'Mạnh Dũng (Nam)', gender: 'male' },
  'vi_VN-25hours_single-low.onnx': {
    name: 'Thu Hà · 25h Single (Low)',
    gender: 'female',
  },
  'vi_VN-vais1000-medium.onnx': {
    name: 'Lan Hương · VAIS 1000 (Medium)',
    gender: 'female',
  },
  'vi_VN-vivos-x_low.onnx': {
    name: 'Vivos (đa giọng)',
  },
};

/**
 * Tên hiển thị ổn định cho 65 speaker VIVOS (rhasspy vi_VN-vivos-x_low).
 * Index = speaker_id trong model (0…64). Corpus gốc chỉ có mã VIVOSSPK — gán tên VN dễ chọn.
 */
const VIVOS_SPEAKER_NAMES: ReadonlyArray<{
  name: string;
  gender: 'male' | 'female';
}> = [
  { name: 'An Nhiên', gender: 'female' }, // 0
  { name: 'Bảo Châu', gender: 'female' }, // 1
  { name: 'Cát Tường', gender: 'female' }, // 2
  { name: 'Diễm My', gender: 'female' }, // 3
  { name: 'Én Nhỏ', gender: 'female' }, // 4
  { name: 'Phương Anh', gender: 'female' }, // 5
  { name: 'Gia Hân', gender: 'female' }, // 6
  { name: 'Hồng Nhung', gender: 'female' }, // 7
  { name: 'Khánh Linh', gender: 'female' }, // 8
  { name: 'Lâm Chi', gender: 'female' }, // 9
  { name: 'Mai Phương', gender: 'female' }, // 10
  { name: 'Ngọc Bích', gender: 'female' }, // 11
  { name: 'Oanh Vũ', gender: 'female' }, // 12
  { name: 'Phương Thảo', gender: 'female' }, // 13
  { name: 'Quỳnh Anh', gender: 'female' }, // 14
  { name: 'Rạng Đông', gender: 'female' }, // 15
  { name: 'Sương Mai', gender: 'female' }, // 16
  { name: 'Thanh Hà', gender: 'female' }, // 17
  { name: 'Uyên Nhi', gender: 'female' }, // 18
  { name: 'Vân Anh', gender: 'female' }, // 19
  { name: 'Xuân Mai', gender: 'female' }, // 20
  { name: 'Yến Nhi', gender: 'female' }, // 21
  { name: 'An Khang', gender: 'male' }, // 22 VIVOSSPK01
  { name: 'Bảo Long', gender: 'male' }, // 23
  { name: 'Công Minh', gender: 'male' }, // 24
  { name: 'Đức Anh', gender: 'male' }, // 25
  { name: 'Gia Bảo', gender: 'male' }, // 26
  { name: 'Hoàng Nam', gender: 'male' }, // 27
  { name: 'Khôi Nguyên', gender: 'male' }, // 28
  { name: 'Lâm Phong', gender: 'male' }, // 29
  { name: 'Minh Quân', gender: 'male' }, // 30
  { name: 'Nhật Huy', gender: 'male' }, // 31
  { name: 'Phúc Khang', gender: 'male' }, // 32
  { name: 'Quang Dũng', gender: 'male' }, // 33
  { name: 'Sơn Tùng', gender: 'male' }, // 34
  { name: 'Thành Đạt', gender: 'male' }, // 35
  { name: 'Việt Hoàng', gender: 'male' }, // 36
  { name: 'Xuân Trường', gender: 'male' }, // 37
  { name: 'Yên Bình', gender: 'male' }, // 38
  { name: 'Bình An', gender: 'male' }, // 39
  { name: 'Hải Đăng', gender: 'male' }, // 40
  { name: 'Tuấn Kiệt', gender: 'male' }, // 41
  { name: 'Đăng Khoa', gender: 'male' }, // 42
  { name: 'Hữu Phước', gender: 'male' }, // 43
  { name: 'Trọng Nghĩa', gender: 'male' }, // 44
  { name: 'Văn Kiên', gender: 'male' }, // 45
  { name: 'Ái Vy', gender: 'female' }, // 46 DEV
  { name: 'Bích Ngọc', gender: 'female' }, // 47
  { name: 'Cẩm Tú', gender: 'female' }, // 48
  { name: 'Dạ Thảo', gender: 'female' }, // 49
  { name: 'Hà My', gender: 'female' }, // 50
  { name: 'Kim Ngân', gender: 'female' }, // 51
  { name: 'Lệ Quyên', gender: 'female' }, // 52
  { name: 'Mỹ Duyên', gender: 'female' }, // 53
  { name: 'Nhã Phương', gender: 'female' }, // 54
  { name: 'Phương Uyên', gender: 'female' }, // 55
  { name: 'Quế Chi', gender: 'female' }, // 56
  { name: 'Thùy Dương', gender: 'female' }, // 57
  { name: 'Tuyết Nhung', gender: 'female' }, // 58
  { name: 'Vũ Hà', gender: 'female' }, // 59
  { name: 'Ánh Dương', gender: 'male' }, // 60
  { name: 'Bá Duy', gender: 'male' }, // 61
  { name: 'Chí Dũng', gender: 'male' }, // 62
  { name: 'Đình Phong', gender: 'male' }, // 63
  { name: 'Gia Huy', gender: 'male' }, // 64
];

function vivosDisplayName(
  speakerId: number,
  corpusCode: string,
): { name: string; gender?: 'male' | 'female' } {
  const row = VIVOS_SPEAKER_NAMES[speakerId];
  if (row) {
    const gioi = row.gender === 'female' ? 'Nữ' : 'Nam';
    return {
      name: `${row.name} (Vivos · ${gioi})`,
      gender: row.gender,
    };
  }
  // Fallback nếu map thiếu id
  return {
    name: `Giọng Vivos ${String(speakerId + 1).padStart(2, '0')} (${corpusCode})`,
  };
}

/** Preferred list order (ship quality first). */
const PIPER_MODEL_ORDER = [
  'ngochuyen.onnx',
  'manhdung.onnx',
  'vi_VN-vais1000-medium.onnx',
  'vi_VN-25hours_single-low.onnx',
  'vi_VN-vivos-x_low.onnx',
];

export function parsePiperVoiceId(voice: string): {
  modelFile: string;
  speakerId: number | null;
  raw: string;
} {
  const raw = String(voice || '').trim();
  if (!raw) return { modelFile: '', speakerId: null, raw: '' };
  // model.onnx#12  |  model.onnx:12  |  model#12
  const hash = raw.match(/^(.+?)[#:](\d+)\s*$/);
  if (hash) {
    let modelFile = hash[1].trim();
    if (!modelFile.toLowerCase().endsWith('.onnx')) modelFile = `${modelFile}.onnx`;
    return {
      modelFile,
      speakerId: Number(hash[2]),
      raw,
    };
  }
  let modelFile = raw;
  if (!modelFile.toLowerCase().endsWith('.onnx')) modelFile = `${modelFile}.onnx`;
  return { modelFile, speakerId: null, raw };
}

function readPiperModelConfig(
  modelFile: string,
  root = resolveNovelRoot(),
): {
  numSpeakers: number;
  speakerIdMap: Record<string, number>;
} {
  // Piper ships config as `voice.onnx.json` beside `voice.onnx`
  const beside = path.join(resolvePiperModelsDir(root), `${modelFile}.json`);
  if (!fs.existsSync(beside)) {
    return { numSpeakers: 1, speakerIdMap: {} };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(beside, 'utf8')) as {
      num_speakers?: number;
      speaker_id_map?: Record<string, number>;
    };
    return {
      numSpeakers: Number(raw.num_speakers) || 1,
      speakerIdMap:
        raw.speaker_id_map && typeof raw.speaker_id_map === 'object'
          ? raw.speaker_id_map
          : {},
    };
  } catch {
    return { numSpeakers: 1, speakerIdMap: {} };
  }
}

function friendlyModelLabel(modelFile: string): {
  name: string;
  gender?: PiperVoiceOption['gender'];
} {
  if (PIPER_MODEL_LABELS[modelFile]) return PIPER_MODEL_LABELS[modelFile];
  let name = modelFile.replace(/\.onnx$/i, '');
  name = name.replace(/_/g, ' ');
  name = name.charAt(0).toUpperCase() + name.slice(1);
  let gender: PiperVoiceOption['gender'] | undefined;
  if (/nu|female|girl|huyen|chi|linh|huong/i.test(modelFile)) gender = 'female';
  if (/nam|male|boy|dung|minh|hung/i.test(modelFile)) gender = gender || 'male';
  return { name, gender };
}

/**
 * Disk catalog for UI: single-speaker models + expanded multi-speaker entries
 * (`model.onnx#speakerId`) so preview/gen can select real voices.
 */
export function listPiperVoiceOptions(root = resolveNovelRoot()): PiperVoiceOption[] {
  const files = listPiperOnnxModels(root);
  const ordered = [
    ...PIPER_MODEL_ORDER.filter((f) => files.includes(f)),
    ...files.filter((f) => !PIPER_MODEL_ORDER.includes(f)).sort((a, b) => a.localeCompare(b)),
  ];
  const out: PiperVoiceOption[] = [];
  for (const modelFile of ordered) {
    const meta = readPiperModelConfig(modelFile, root);
    const base = friendlyModelLabel(modelFile);
    const mapEntries = Object.entries(meta.speakerIdMap);
    if (meta.numSpeakers > 1 && mapEntries.length > 0) {
      mapEntries
        .map(([spkName, sid]) => ({ spkName, sid: Number(sid) }))
        .filter((x) => Number.isFinite(x.sid) && x.sid >= 0)
        .sort((a, b) => a.sid - b.sid || a.spkName.localeCompare(b.spkName))
        .forEach(({ spkName, sid }) => {
          const label = vivosDisplayName(sid, spkName);
          out.push({
            id: `${modelFile}#${sid}`,
            name: label.name,
            gender: label.gender,
            modelName: modelFile,
            speakerId: sid,
          });
        });
      continue;
    }
    out.push({
      id: modelFile,
      name: base.name,
      gender: base.gender,
      modelName: modelFile,
      speakerId: 0,
    });
  }
  return out;
}

export function resolvePiperModelPath(
  voice: string,
  root = resolveNovelRoot(),
): PiperVoiceRef {
  const available = listPiperOnnxModels(root);
  const parsed = parsePiperVoiceId(voice);
  let name = parsed.modelFile;
  if (!name) {
    throw new Error(
      'Piper: chưa chọn model .onnx. Chọn Ngọc Huyền / Mạnh Dũng / Piper VAIS… trong Engine → Piper.',
    );
  }
  // Friendly labels → file names
  const lower = name.toLowerCase();
  if (/ngọc|ngoc|huyền|huyen/.test(lower) && !available.includes(name)) {
    if (available.includes('ngochuyen.onnx')) name = 'ngochuyen.onnx';
  }
  if (/mạnh|manh|dũng|dung/.test(lower) && !available.includes(name)) {
    if (available.includes('manhdung.onnx')) name = 'manhdung.onnx';
  }
  if (/vais1000|vais/.test(lower) && !available.includes(name)) {
    if (available.includes('vi_VN-vais1000-medium.onnx')) {
      name = 'vi_VN-vais1000-medium.onnx';
    }
  }
  if (/25hours|25h/.test(lower) && !available.includes(name)) {
    if (available.includes('vi_VN-25hours_single-low.onnx')) {
      name = 'vi_VN-25hours_single-low.onnx';
    }
  }
  if (/vivos/.test(lower) && !available.includes(name)) {
    if (available.includes('vi_VN-vivos-x_low.onnx')) {
      name = 'vi_VN-vivos-x_low.onnx';
    }
  }
  const hit =
    available.find((f) => f === name) ||
    available.find((f) => f.toLowerCase() === name.toLowerCase());
  if (!hit) {
    const modelsDir = resolvePiperModelsDir(root);
    throw new Error(
      `Piper: model «${voice}» không tồn tại trong ${modelsDir}. ` +
        `Có sẵn: ${available.join(', ') || '(trống — gói thiếu bin/piper_vn; cài lại bản ship có Piper hoặc copy model .onnx vào thư mục đó)'}.`,
    );
  }
  let speakerId = parsed.speakerId ?? 0;
  if (!Number.isFinite(speakerId) || speakerId < 0) speakerId = 0;
  const cfg = readPiperModelConfig(hit, root);
  if (cfg.numSpeakers > 1 && speakerId >= cfg.numSpeakers) {
    throw new Error(
      `Piper: speaker #${speakerId} ngoài phạm vi model «${hit}» (0…${cfg.numSpeakers - 1}).`,
    );
  }
  return {
    modelName: hit,
    modelPath: path.join(resolvePiperModelsDir(root), hit),
    speakerId,
  };
}

export function listMissingPiperRuntimeFiles(root = resolveNovelRoot()): string[] {
  const bin = resolvePiperBinDir(root);
  const missing: string[] = [];
  const exe = resolvePiperExe(root);
  if (!fs.existsSync(exe)) missing.push(exe);
  for (const dll of PIPER_REQUIRED_DLLS) {
    const p = path.join(bin, dll);
    if (!fs.existsSync(p)) missing.push(p);
  }
  const espeak = resolvePiperEspeakDataDir(root);
  if (!fs.existsSync(espeak)) missing.push(espeak);
  return missing;
}

/** Windows NTSTATUS as unsigned exit from CreateProcess failures. */
export function formatPiperExitCode(code: number | null): string {
  if (code === null || code === undefined) return 'null';
  const u = code < 0 ? code + 0x100000000 : code;
  const hex = `0x${u.toString(16).toUpperCase()}`;
  // STATUS_DLL_NOT_FOUND
  if (u === 0xc0000135 || code === 3221225781) {
    return (
      `${code} (${hex} STATUS_DLL_NOT_FOUND) — thiếu DLL phụ thuộc cạnh piper.exe ` +
      `(espeak-ng / onnxruntime / piper_phonemize) hoặc thiếu Visual C++ Redistributable (x64). ` +
      `Cài «Microsoft Visual C++ Redistributable 2015–2022 x64», đóng app khác đang giữ onnxruntime.dll, rồi thử lại.`
    );
  }
  // STATUS_ACCESS_VIOLATION
  if (u === 0xc0000005) {
    return `${code} (${hex} ACCESS_VIOLATION) — piper crash (model/onnx hỏng hoặc xung đột DLL).`;
  }
  // STATUS_ENTRYPOINT_NOT_FOUND
  if (u === 0xc0000139) {
    return `${code} (${hex} ENTRYPOINT_NOT_FOUND) — DLL onnxruntime không khớp phiên bản piper.exe.`;
  }
  return `${code}${u > 255 ? ` (${hex})` : ''}`;
}

export function assertPiperRuntime(root = resolveNovelRoot()): {
  piperExe: string;
  modelsDir: string;
  models: string[];
  binDir: string;
  espeakDataDir: string;
} {
  const piperExe = resolvePiperExe(root);
  const binDir = resolvePiperBinDir(root);
  const modelsDir = resolvePiperModelsDir(root);
  const espeakDataDir = resolvePiperEspeakDataDir(root);
  const models = listPiperOnnxModels(root);
  if (!fs.existsSync(piperExe)) {
    throw new Error(
      `Piper: không thấy piper.exe tại ${piperExe}. Gói desktop cần extraResources bin/piper.`,
    );
  }
  const missing = listMissingPiperRuntimeFiles(root);
  if (missing.length) {
    throw new Error(
      `Piper: thiếu file runtime (${missing.length}): ${missing
        .map((p) => path.basename(p))
        .join(', ')}. ` +
        `Thư mục: ${binDir}. Cài lại bản ship có Piper hoặc copy DLL + espeak-ng-data vào bin/piper.`,
    );
  }
  if (!models.length) {
    throw new Error(
      `Piper: thư mục model trống (${modelsDir}). Cần file .onnx trong bin/piper_vn (Ngọc Huyền / Mạnh Dũng / rhasspy vi_VN…).`,
    );
  }
  return { piperExe, modelsDir, models, binDir, espeakDataDir };
}
