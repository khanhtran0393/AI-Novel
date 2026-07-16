import fs from 'fs';

function ensureApiImport(t) {
  if (t.includes("from '@/contracts'") || t.includes('from "@/contracts"')) return t;
  if (t.startsWith("'use client'") || t.startsWith('"use client"')) {
    return t.replace(/(['"]use client['"];?\r?\n)/, `$1import { API } from '@/contracts';\n`);
  }
  return `import { API } from '@/contracts';\n` + t;
}

function wire(file, pairs) {
  let t = fs.readFileSync(file, 'utf8');
  let n = 0;
  for (const [from, to] of pairs) {
    if (!t.includes(from)) {
      console.warn('MISS', file, from.slice(0, 60));
      continue;
    }
    const c = t.split(from).length - 1;
    t = t.split(from).join(to);
    n += c;
  }
  if (n > 0) {
    t = ensureApiImport(t);
    fs.writeFileSync(file, t);
    console.log('OK', file, 'x' + n);
  }
}

wire('src/app/workspace/features/ainovel/AINovelDashboard.tsx', [
  ["fetch('/api/ainovel/config'", 'fetch(API.ainovel.config'],
  ["fetch('/api/ainovel/status'", 'fetch(API.ainovel.status'],
  ["fetch('/api/ainovel/chapters'", 'fetch(API.ainovel.chapters'],
  ["fetch(`/api/ainovel/chapters/${id}`", 'fetch(`${API.ainovel.chapters}/${id}`'],
  ["fetch('/api/ainovel/capabilities'", 'fetch(API.ainovel.capabilities'],
  ["fetch('/api/ainovel/stop'", 'fetch(API.ainovel.stop'],
  ["fetch('/api/ainovel/diag'", 'fetch(API.ainovel.diag'],
]);

wire('src/app/workspace/features/media/MediaConfigModal.tsx', [
  ["fetch('/api/generate'", 'fetch(API.generate'],
]);

wire('src/app/workspace/features/settings/SettingsPanel.tsx', [
  ["fetch('/api/system-info'", 'fetch(API.systemInfo'],
  ["fetch('/api/system-info/install-gpu'", 'fetch(API.systemInfoInstallGpu'],
  ["fetch('/api/system-info/install-status'", 'fetch(API.systemInfoInstallStatus'],
]);

wire('src/app/workspace/features/project/ShipPackModal.tsx', [
  ["fetch('/api/ship-pack'", 'fetch(API.shipPack'],
]);


wire('src/app/workspace/features/project/ImportModal.tsx', [
  ["fetch('/api/generate'", 'fetch(API.generate'],
]);

// CapCut export if any
{
  const f = 'src/app/workspace/features/project/CapCutExportButton.tsx';
  if (fs.existsSync(f)) {
    let t = fs.readFileSync(f, 'utf8');
    if (t.includes("'/api/")) {
      console.log('CapCut still has raw api - check manually');
      const m = t.match(/fetch\(['\`]\/api\/[^'\`]+/g);
      console.log(m);
    }
  }
}
