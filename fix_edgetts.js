const fs = require('fs');
const path = require('path');

const filePath = path.join('src', 'app', 'api', 'generate-tts', 'route.ts');
let code = fs.readFileSync(filePath, 'utf8');

const oldEdgeTTS = `async function generateEdgeTTS(text: string, voiceName: string, speed: number = 1.0, pitch: number = 0): Promise<Buffer> {
  const ratePercent = Math.round((speed - 1.0) * 100);
  const rateStr = ratePercent >= 0 ? \`+\${ratePercent}%\` : \`\${ratePercent}%\`;
  const pitchPercent = Math.round(pitch * 10); // pitch range roughly -10 to +10, multiply by 10%
  const pitchStr = pitchPercent >= 0 ? \`+\${pitchPercent}%\` : \`\${pitchPercent}%\`;

  const tts = new EdgeTTS({
    voice: voiceName,
    lang: 'vi-VN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate: rateStr,
    pitch: pitchStr
  });`;

const newEdgeTTS = `async function generateEdgeTTS(text: string, voiceName: string, speed: number = 1.0, pitch: number = 0): Promise<Buffer> {
  const options: any = {
    voice: voiceName,
    lang: 'vi-VN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
  };

  if (speed !== 1.0) {
    const ratePercent = Math.round((speed - 1.0) * 100);
    options.rate = ratePercent >= 0 ? \`+\${ratePercent}%\` : \`\${ratePercent}%\`;
  }
  
  if (pitch !== 0) {
    const pitchPercent = Math.round(pitch * 10);
    options.pitch = pitchPercent >= 0 ? \`+\${pitchPercent}%\` : \`\${pitchPercent}%\`;
  }

  const tts = new EdgeTTS(options);`;

if (code.includes(oldEdgeTTS)) {
  code = code.replace(oldEdgeTTS, newEdgeTTS);
  fs.writeFileSync(filePath, code);
  console.log("Fixed EdgeTTS logic!");
} else {
  console.log("Could not find the old EdgeTTS block.");
}
