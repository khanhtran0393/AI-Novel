import { NextResponse } from 'next/server';
import {
  listPiperOnnxModels,
  listPiperVoiceOptions,
  resolvePiperModelsDir,
  resolveNovelRoot,
} from '@/lib/tts/piperPaths';

export async function GET() {
  try {
    const root = resolveNovelRoot();
    const files = listPiperOnnxModels(root);
    const voices = listPiperVoiceOptions(root);
    const models = voices.map((v) => ({
      id: v.id,
      name: v.name,
      gender: v.gender,
      modelName: v.modelName,
      speakerId: v.speakerId,
    }));
    return NextResponse.json({
      models,
      /** Raw ONNX files on disk (not expanded multi-speaker) */
      onnxFiles: files,
      voiceCount: models.length,
      modelsDir: resolvePiperModelsDir(root),
      ok: true,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
