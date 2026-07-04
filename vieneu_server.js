const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EdgeTTS } = require('node-edge-tts');

const app = express();
app.use(express.json());

const PORT = 23333;

function cleanText(text) {
    if (!text) return '';
    return text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
}

async function runPiper(text, modelName) {
    const tempText = path.join(__dirname, 'scratch', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tempWav = path.join(__dirname, 'scratch', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`);
    
    if (!fs.existsSync(path.join(__dirname, 'scratch'))) {
        fs.mkdirSync(path.join(__dirname, 'scratch'));
    }

    fs.writeFileSync(tempText, text, 'utf8');
    
    const piperExe = path.join(__dirname, 'bin', 'piper', 'piper.exe');
    const modelPath = path.join(__dirname, 'bin', 'piper_vn', modelName);
    
    const command = `"${piperExe}" -m "${modelPath}" -f "${tempWav}" < "${tempText}"`;
    console.log('[VieNeu-TTS Proxy] Running piper:', command);
    
    execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    
    if (fs.existsSync(tempWav)) {
        const buffer = fs.readFileSync(tempWav);
        fs.unlinkSync(tempText);
        fs.unlinkSync(tempWav);
        return { buffer, contentType: 'audio/wav' };
    } else {
        throw new Error('Piper did not generate wav file');
    }
}

async function runEdgeTTS(text, voiceName) {
    const tts = new EdgeTTS({ voice: voiceName, lang: 'vi-VN', outputFormat: 'audio-24khz-48kbitrate-mono-mp3' });
    const tempMp3 = path.join(__dirname, 'scratch', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
    await tts.ttsPromise(text, tempMp3);
    const buffer = fs.readFileSync(tempMp3);
    fs.unlinkSync(tempMp3);
    return { buffer, contentType: 'audio/mpeg' };
}

app.post('/v1/audio/speech', async (req, res) => {
    try {
        const { input, voice } = req.body;
        const textToSpeech = cleanText(input);
        
        console.log(`[VieNeu-TTS Proxy] Request received for voice: "${voice}"`);
        
        if (!textToSpeech) {
            return res.status(400).send('No text provided');
        }

        let result;

        const v = (voice || '').toLowerCase();

        // Nữ
        if (v.includes('ngọc huyền') || v.includes('chi chi') || v.includes('vy') || v.includes('mai') || v.includes('vân') || v.includes('thảo') || v.includes('dung')) {
            console.log('[VieNeu-TTS Proxy] Routing to Piper: ngochuyen.onnx');
            result = await runPiper(textToSpeech, 'ngochuyen.onnx');
        } 
        // Nam
        else if (v.includes('adam') || v.includes('mạnh dũng') || v.includes('trung') || v.includes('sơn') || v.includes('anh') || v.includes('khôi') || v.includes('quân') || v.includes('an')) {
            console.log('[VieNeu-TTS Proxy] Routing to Piper: manhdung.onnx');
            result = await runPiper(textToSpeech, 'manhdung.onnx');
        } 
        // Fallback Nam
        else if (v.includes('nam')) {
            console.log('[VieNeu-TTS Proxy] Routing to Edge: NamMinh');
            result = await runEdgeTTS(textToSpeech, 'vi-VN-NamMinhNeural');
        }
        // Fallback Nữ mặc định
        else {
            console.log('[VieNeu-TTS Proxy] Routing to Edge: HoaiMy');
            result = await runEdgeTTS(textToSpeech, 'vi-VN-HoaiMyNeural');
        }

        res.setHeader('Content-Type', result.contentType);
        return res.send(result.buffer);
        
    } catch (err) {
        console.error('[VieNeu-TTS Proxy] Error:', err);
        res.status(500).send(err.message);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VieNeu-TTS Proxy] Server is running on port ${PORT} - Mapped to ALL Voices!`);
});
