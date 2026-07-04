const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'app', 'workspace', 'components', 'TTSConfigModal.tsx');
let code = fs.readFileSync(filePath, 'utf8');

// 1. Remove vieneu_tts from VOICES
const vieneuStart = code.indexOf('vieneu_tts: {');
if (vieneuStart !== -1) {
  // Find the end of vieneu_tts block. It ends before `vbee:`
  const vbeeStart = code.indexOf('vbee: {', vieneuStart);
  if (vbeeStart !== -1) {
    code = code.substring(0, vieneuStart) + code.substring(vbeeStart);
  }
}

// 2. Remove <option value="vieneu_tts">...
code = code.replace(/<option value="vieneu_tts">VieNeu-TTS \(Local AI\)<\/option>\s*/g, '');

// 3. Add fetching for Piper models
// We'll inject it into the useEffect that fetches omnivoice-library.json
const useEffectStart = code.indexOf('// Load OmniVoice Library');
if (useEffectStart !== -1) {
  const insertCode = `
  // Load dynamic Piper models
  useEffect(() => {
    fetch('/api/piper-models')
      .then(r => r.json())
      .then(data => {
        if (data.models && Array.isArray(data.models)) {
          setDynamicVoices(prev => ({
            ...prev,
            piper: {
              ...prev.piper,
              vi: data.models // We overwrite the hardcoded ones with the dynamically found ones
            }
          }));
        }
      })
      .catch(err => console.error("Failed to load Piper models", err));
  }, []);
`;
  code = code.substring(0, useEffectStart) + insertCode + '\n  ' + code.substring(useEffectStart);
}

fs.writeFileSync(filePath, code);
console.log('Successfully updated TTSConfigModal.tsx');
