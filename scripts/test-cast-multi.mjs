import { parseCastDialogue } from '../src/lib/castDialogue.ts';
import { shouldUseCastMulti, NARRATOR_ROLE_ID } from '../src/lib/voiceCast.ts';
import { diversifyRoleVoices, resolveSceneCast } from '../src/app/workspace/modules/castModule.ts';
import { characterRoleId } from '../src/lib/voiceCast.ts';

const names = ['Kiến', 'Khánh Ân'];
const sample = `Kiến cau mày. "Không. Không phải. Mình... mình hơi mệt." "Mệt hả? Mấy ngày nay cậu cứ như người mất hồn ấy." Khánh Ân khoanh tay. "Lẩm bẩm tiếng gì đó, rồi vẽ mấy thứ quái dị này."`;

const lines = parseCastDialogue({ sceneText: sample, characterNames: names });
console.log(
  'parsed',
  lines.map((l) => ({ s: l.speaker, t: l.text.slice(0, 40) })),
);
const speakers = new Set(lines.map((l) => l.speaker).filter(Boolean));
console.log('speakers', [...speakers], 'segs', lines.length);

const roles = [
  {
    id: NARRATOR_ROLE_ID,
    label: 'Người kể',
    kind: 'narrator',
    voiceId: 'vi-VN-NamMinhNeural',
  },
  {
    id: characterRoleId('Kiến'),
    label: 'Kiến',
    kind: 'character',
    characterName: 'Kiến',
    voiceId: 'vi-VN-NamMinhNeural',
    vinaRoleIndex: 1,
  },
  {
    id: characterRoleId('Khánh Ân'),
    label: 'Khánh Ân',
    kind: 'character',
    characterName: 'Khánh Ân',
    voiceId: 'vi-VN-NamMinhNeural',
    vinaRoleIndex: 2,
  },
];

const div = diversifyRoleVoices(
  roles,
  'edge_tts',
  'vi',
  {
    Kiến: { gioi_tinh: 'Nam' },
    'Khánh Ân': { gioi_tinh: 'Nữ' },
  },
  'vi-VN-NamMinhNeural',
);
console.log(
  'diversified',
  div.map((r) => ({ id: r.id, v: r.voiceId })),
);

const resolved = resolveSceneCast({
  sceneText: sample,
  chapter: 1,
  sceneIndex: 0,
  cast: {
    version: 1,
    enabled: true,
    roles,
    segmentOverrides: {},
  },
  characterNames: names,
  nhanVatPrompts: {
    Kiến: { gioi_tinh: 'Nam' },
    'Khánh Ân': { gioi_tinh: 'Nữ' },
  },
  defaultVoice: 'vi-VN-NamMinhNeural',
  platform: 'edge_tts',
  language: 'vi',
  globalSpeed: 1,
  globalPitch: 0,
});

console.log('useMulti', resolved.useMulti, 'segs', resolved.segments.length);
console.log(
  resolved.segments.map((s) => ({
    speaker: s.speaker,
    voice: s.voice,
    pitch: s.pitch,
    t: s.text.slice(0, 30),
  })),
);

const multiGate = shouldUseCastMulti(
  resolved.segments.map((s) => ({
    voice: s.voice,
    pitch: s.pitch,
    speakerRoleId: s.speakerRoleId,
  })),
  { voice: 'vi-VN-NamMinhNeural', speed: 1, pitch: 0 },
);
console.log('gate', multiGate);

if (!resolved.useMulti || speakers.size < 2) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
