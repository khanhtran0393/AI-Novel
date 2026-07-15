import fs from 'fs';
import path from 'path';

export function mapVbeeSampleVoice(voiceId: string): {
  kind: 'piper' | 'edge';
  id: string;
  label: string;
} {
  const id = (voiceId || '').toLowerCase();
  const female =
    /nu|female|huyen|phuong|thao|trinh|mai|linh|my|chi/i.test(id + voiceId);
  const piperDir = path.join(process.cwd(), 'bin', 'piper_vn');
  const hasNgochuyen =
    fs.existsSync(path.join(piperDir, 'ngochuyen.onnx'));
  const hasManhdung = fs.existsSync(path.join(piperDir, 'manhdung.onnx'));

  if (/ngochuyen|huyen/i.test(id) && hasNgochuyen) {
    return { kind: 'piper', id: 'ngochuyen.onnx', label: 'VBee mẫu→Piper Ngọc Huyền' };
  }
  if (/manhdung|dung|minhhoang|minh_hoang|nam/i.test(id) && hasManhdung) {
    return { kind: 'piper', id: 'manhdung.onnx', label: 'VBee mẫu→Piper Mạnh Dũng' };
  }
  if (female && hasNgochuyen) {
    return { kind: 'piper', id: 'ngochuyen.onnx', label: 'VBee mẫu→Piper Ngọc Huyền' };
  }
  if (!female && hasManhdung) {
    return { kind: 'piper', id: 'manhdung.onnx', label: 'VBee mẫu→Piper Mạnh Dũng' };
  }
  return {
    kind: 'edge',
    id: female ? 'vi-VN-HoaiMyNeural' : 'vi-VN-NamMinhNeural',
    label: female ? 'VBee mẫu→Edge Hoài My' : 'VBee mẫu→Edge Nam Minh',
  };
}

/** Map Google Cloud voice name → Edge neural (giọng mẫu nghe thử / fallback) */
export function mapGoogleSampleVoice(voiceId: string): { id: string; label: string } {
  const v = voiceId || '';
  // English Journey / Neural2
  if (/^en-US/i.test(v) || /Journey|Neural2|Wavenet/i.test(v) && /en-/i.test(v)) {
    if (/Journey-F|Neural2-A|Neural2-C|Neural2-F|Wavenet-C|Wavenet-E|Wavenet-F|Standard-C|Standard-E|Standard-F|female|Nữ/i.test(v)) {
      return { id: 'en-US-JennyNeural', label: 'Google mẫu→Edge Jenny' };
    }
    return { id: 'en-US-GuyNeural', label: 'Google mẫu→Edge Guy' };
  }
  // Vietnamese Standard/Neural2/Wavenet A,C = nữ; B,D = nam
  if (/-A$|-C$|Neural2-A|Wavenet-A|Wavenet-C|Standard-A|Standard-C|Nữ|female/i.test(v)) {
    return { id: 'vi-VN-HoaiMyNeural', label: 'Google mẫu→Edge Hoài My' };
  }
  return { id: 'vi-VN-NamMinhNeural', label: 'Google mẫu→Edge Nam Minh' };
}
