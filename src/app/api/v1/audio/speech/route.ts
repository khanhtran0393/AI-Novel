import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import * as util from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { EdgeTTS } from 'node-edge-tts';

const execAsync = util.promisify(exec);

function cleanText(text: string) {
    if (!text) return '';
    return text.normalize('NFC').replace(/\[[^\]]*\]/g, '').trim();
}

async function runPiper(text: string, modelName: string, speed: number) {
    const cwd = process.cwd();
    const tempText = path.join(cwd, 'scratch', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.txt`);
    const tempWav = path.join(cwd, 'scratch', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.wav`);
    
    if (!fs.existsSync(path.join(cwd, 'scratch'))) {
        fs.mkdirSync(path.join(cwd, 'scratch'));
    }

    fs.writeFileSync(tempText, text, 'utf8');
    
    const piperExe = path.join(cwd, 'bin', 'piper', 'piper.exe');
    const modelPath = path.join(cwd, 'bin', 'piper_vn', modelName);
    
    const lengthScale = (1.0 / speed).toFixed(3);
    const command = `"${piperExe}" -m "${modelPath}" --length_scale ${lengthScale} -f "${tempWav}" < "${tempText}"`;
    console.log('[VieNeu-TTS API] Running piper:', command);
    
    await execAsync(command, { encoding: 'utf-8' });
    
    if (fs.existsSync(tempWav)) {
        const buffer = fs.readFileSync(tempWav);
        fs.unlinkSync(tempText);
        fs.unlinkSync(tempWav);
        return { buffer, contentType: 'audio/wav' };
    } else {
        throw new Error('Piper did not generate wav file');
    }
}

async function runEdgeTTS(text: string, voiceName: string, speed: number, pitch: number) {
    const cwd = process.cwd();
    const tts = new EdgeTTS({ 
        voice: voiceName, 
        lang: 'vi-VN', 
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
        rate: speed === 1.0 ? '+0%' : `${speed > 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%`,
        pitch: pitch === 0 ? '+0Hz' : `${pitch > 0 ? '+' : ''}${Math.round(pitch)}Hz`
    });
    const tempMp3 = path.join(cwd, 'scratch', `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`);
    
    if (!fs.existsSync(path.join(cwd, 'scratch'))) {
        fs.mkdirSync(path.join(cwd, 'scratch'));
    }

    await tts.ttsPromise(text, tempMp3);
    const buffer = fs.readFileSync(tempMp3);
    fs.unlinkSync(tempMp3);
    return { buffer, contentType: 'audio/mpeg' };
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { input, voice, speed, pitch } = body;
        const textToSpeech = cleanText(input);
        const parsedSpeed = parseFloat(speed) || 1.0;
        const parsedPitch = parseFloat(pitch) || 0;
        
        console.log(`[VieNeu-TTS API] Request received for voice: "${voice}", speed: ${parsedSpeed}, pitch: ${parsedPitch}`);
        
        if (!textToSpeech) {
            return NextResponse.json({ error: 'No text provided' }, { status: 400 });
        }

        // Chuyển đổi tên giọng đọc (VD: "Ngọc Huyền" -> "ngochuyen.onnx")
        const rawVoice = voice || 'ngochuyen';
        const modelBaseName = rawVoice.normalize('NFD')
                                      .replace(/[\u0300-\u036f]/g, '')
                                      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
                                      .toLowerCase()
                                      .replace(/\s+/g, '');
        
        const modelName = `${modelBaseName}.onnx`;
        const modelPath = path.join(process.cwd(), 'bin', 'piper_vn', modelName);
        
        let result;
        
        if (fs.existsSync(modelPath)) {
            console.log(`[VieNeu-TTS API] Found local model, routing to Piper: ${modelName}`);
            result = await runPiper(textToSpeech, modelName, parsedSpeed);
        } else {
            throw new Error(`Không tìm thấy mô hình Piper cục bộ: ${modelName} tại đường dẫn: ${modelPath}. Vui lòng tải xuống mô hình hoặc chọn platform khác.`);
        }

        return new Response(result.buffer, {
            headers: { 'Content-Type': result.contentType }
        });
        
    } catch (err: any) {
        console.error('[VieNeu-TTS API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
