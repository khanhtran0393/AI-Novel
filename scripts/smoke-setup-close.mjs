/**
 * Contract smoke: Setup X close path is wired correctly.
 * Run: node scripts/smoke-setup-close.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const setup = read('src/app/workspace/features/script/SetupPhase.tsx');
const yt = read('src/app/workspace/features/script/YoutubeSetupPhase.tsx');
const close = read('src/app/workspace/features/script/closeSetupModal.ts');
const page = read('src/app/workspace/page.tsx');

const checks = [];
const ok = (name, cond) => {
  checks.push({ name, ok: Boolean(cond) });
  if (!cond) console.error('FAIL:', name);
};

ok('Setup: createPortal', setup.includes('createPortal'));
ok('Setup: document.body portal', setup.includes('document.body'));
ok('Setup: close button id', setup.includes('setup-modal-close-x'));
ok('Setup: onPointerDown', setup.includes('onPointerDown'));
ok('Setup: closeSetupModal call', setup.includes('closeSetupModal(onClose)'));
ok('Setup: no extra footer close label', !setup.includes('Đóng · Vào workspace'));
ok('Setup: z-9999', setup.includes('z-[9999]'));
ok('Setup: pointer-events-none icon', setup.includes('pointer-events-none'));

ok('YT: createPortal', yt.includes('createPortal'));
ok('YT: close id', yt.includes('yt-setup-modal-close-x'));
ok('YT: onPointerDown', yt.includes('onPointerDown'));
ok('YT: no extra footer close', !yt.includes('Đóng · Vào workspace'));

ok('close: setState giai_doan 2', /setState\(\{\s*giai_doan:\s*2\s*\}/.test(close));
ok('close: setGiaiDoan(2)', close.includes('setGiaiDoan?.(2)') || close.includes('setGiaiDoan(2)'));

ok('page: giaiDoan selector', page.includes('useNovelStore((s) => s.giai_doan)'));
ok('page: gate giaiDoan === 1', page.includes('giaiDoan === 1'));
ok('page: SetupPhase mounted', page.includes('<SetupPhase'));

const fail = checks.filter((c) => !c.ok);
console.log(
  JSON.stringify(
    {
      ok: fail.length === 0,
      pass: checks.length - fail.length,
      fail: fail.length,
      checks,
    },
    null,
    2,
  ),
);
process.exit(fail.length ? 1 : 0);
