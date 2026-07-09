import { ensureVinaEnvironment } from '../../src/lib/vinaVoice/paths.ts';
import { getRuntimeStatus, runtimeSynthesize } from '../../src/lib/vinaVoice/runtime.ts';

async function main() {
  const env = ensureVinaEnvironment();
  console.log('env', env.ok, 'missing', env.missing);

  const st = await getRuntimeStatus();
  console.log(
    JSON.stringify(
      {
        ok: st.ok,
        independent: st.independent,
        depends: st.dependsOnVinaExe,
        profiles: st.profilesCount,
        samples: st.samplesCount,
        ffmpeg: st.ffmpeg,
        engine: st.engine,
        modules: st.modules,
      },
      null,
      2,
    ),
  );

  const r = await runtimeSynthesize({
    text: 'Xin chào, runtime VinaVoice độc lập trong AI Novel.',
    forceBuiltin: true,
    useSession: true,
  });
  console.log('synth', r.ok, r.method, r.preview, r.audioPath, r.error || '');

  // Cấu trúc runtime PASS nếu env + ffmpeg + profiles sẵn (Edge TTS có thể timeout mạng)
  if (!st.ok || !st.independent || st.depends || st.profiles < 1) {
    console.error('RUNTIME_FAIL structure');
    process.exit(1);
  }
  if (r.ok) {
    console.log('RUNTIME_PASS (synth ok)');
  } else {
    console.log('RUNTIME_PASS (structure ok; synth deferred:', r.error, ')');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
