import fs from 'fs';

function ensureApiImport(t) {
  if (t.includes("from '@/contracts'") || t.includes('from "@/contracts"')) {
    return t;
  }
  if (/^['"]use client['"]/.test(t.trimStart()) || t.startsWith("'use client'") || t.startsWith('"use client"')) {
    return t.replace(/(['"]use client['"];?\r?\n)/, `$1import { API } from '@/contracts';\n`);
  }
  return `import { API } from '@/contracts';\n` + t;
}

function replaceAll(file, pairs) {
  let t = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const [from, to] of pairs) {
    if (!t.includes(from)) {
      console.warn('MISS', file, from.slice(0, 50));
      continue;
    }
    t = t.split(from).join(to);
    changed = true;
  }
  if (changed) {
    t = ensureApiImport(t);
    fs.writeFileSync(file, t);
    console.log('OK', file);
  }
}

// persistStorage
{
  let t = fs.readFileSync('src/store/persistStorage.ts', 'utf8');
  t = ensureApiImport(t);
  t = t.split("fetch('/api/persist-store'").join('fetch(API.persistStore');
  t = t.replace(
    /fetch\(`\/api\/persist-store\?name=/g,
    'fetch(`${API.persistStore}?name=',
  );
  fs.writeFileSync('src/store/persistStorage.ts', t);
  console.log('persistStorage');
}

replaceAll('src/app/workspace/utils/mediaSelfRepair.ts', [
  ["fetch('/api/self-heal/media'", 'fetch(API.selfHealMedia'],
]);
replaceAll('src/lib/nav/navApi.ts', [
  ["fetch('/api/navtools/gateway'", 'fetch(API.navtools.gateway'],
]);
replaceAll('src/app/workspace/features/youtube/YoutubeSafeChecklist.tsx', [
  ["fetch('/api/navtools/youtube-seo'", 'fetch(API.navtools.youtubeSeo'],
]);
replaceAll('src/app/workspace/features/youtube/YoutubePromptModal.tsx', [
  ["fetch('/api/navtools/youtube-seo'", 'fetch(API.navtools.youtubeSeo'],
]);
replaceAll('src/app/workspace/hooks/useImagePromptActions.ts', [
  ["fetch('/api/integrations/seedance'", 'fetch(API.integrations.seedance'],
]);
replaceAll('src/app/workspace/hooks/useFileActions.ts', [
  ["fetch('/api/open-folder'", 'fetch(API.openFolder'],
]);
replaceAll('src/app/workspace/hooks/useCookieActions.ts', [
  ["fetch('/api/get-tiktok-session'", 'fetch(API.getTiktokSession'],
]);
replaceAll('src/app/workspace/features/tts/TTSConfigModal.tsx', [
  ["fetch('/api/generate-tts'", 'fetch(API.generateTts'],
  ["fetch('/api/vina-voice/clone'", 'fetch(API.vinaVoiceClone'],
]);
replaceAll('src/app/workspace/features/tts/tabs/EngineVoiceTab.tsx', [
  ["fetch('/api/omnivoice/status'", 'fetch(API.omnivoiceStatus'],
]);
replaceAll('src/app/workspace/features/tts/RoleCastStudioModal.tsx', [
  ["fetch('/api/cast/auto-tag'", 'fetch(API.castAutoTag'],
]);

// voiceCatalogPrep
{
  let t = fs.readFileSync('src/lib/voiceCatalogPrep.ts', 'utf8');
  t = ensureApiImport(t);
  const before = t;
  t = t.replace(
    /fetch\(`\/api\/tts\/voices\$\{qs\}`/g,
    'fetch(`${API.ttsVoices}${qs}`',
  );
  if (t === before) console.warn('MISS voiceCatalogPrep pattern');
  else console.log('voiceCatalogPrep');
  fs.writeFileSync('src/lib/voiceCatalogPrep.ts', t);
}
