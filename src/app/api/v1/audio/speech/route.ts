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
    const { generatePiperTTS } = await import(
      '@/app/api/generate-tts/engines/piper'
    );
    const buffer = await generatePiperTTS(text, modelName, speed);
    return { buffer, contentType: 'audio/wav' };
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

        // Resolve via piperPaths (packaged AI_NOVEL_ROOT + friendly labels)
        const { resolvePiperModelPath } = await import('@/lib/tts/piperPaths');
        const { modelName } = resolvePiperModelPath(String(voice || 'ngochuyen'));
        console.log(`[VieNeu-TTS API] Piper model: ${modelName}`);
        const result = await runPiper(textToSpeech, modelName, parsedSpeed);

        return new Response(new Uint8Array(result.buffer), {
            headers: { 'Content-Type': result.contentType },
        });
        
    } catch (err: any) {
        console.error('[VieNeu-TTS API] Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
