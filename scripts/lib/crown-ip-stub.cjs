/**
 * Swap crown formula sources with thin runtime stubs for production Next build.
 * Plain sources never land in .next / app.asar; logic runs from resources/crown/*.seal
 *
 * Usage:
 *   node scripts/lib/crown-ip-stub.cjs apply
 *   node scripts/lib/crown-ip-stub.cjs restore
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { sealJsCrowns, CROWN_OUT } = require('./crown-ip-seal.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKUP_DIR = path.join(ROOT, 'build', '.crown-src-backup');

/** Files replaced during sealed production build. */
const STUB_TARGETS = [
  {
    rel: 'src/lib/bypass-engine/filters.ts',
    stub: `/**
 * CROWN STUB — Phantom-X formulas load from resources/crown/bypass-formulas.seal
 * Restored after production build. Do not edit this stub by hand.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBypassFormulas } from '@/lib/ip-seal/bypassFormulasRuntime';
export type {
  BypassFilterId,
  GridLayoutMode,
  BypassVarianceOpts,
  BypassParams,
  BypassProbeMeta,
  BypassGraphBuild,
  VideoFragmentOpts,
  GridBuildOptions,
} from './formulaTypes';
// Public labels stay typed/plain (client + API metadata)
export {
  BYPASS_FILTER_CATALOG,
  GRID_LAYOUT_OPTIONS,
  VARIANCE_RECOMMENDED,
} from './publicCatalog';

const F = () => getBypassFormulas() as any;

export const BYPASS_DEFAULTS = F().BYPASS_DEFAULTS;
export const OVERLAY_FILTER: string = String(F().OVERLAY_FILTER || '');

export function resolveActiveFilters(...a: any[]) {
  return F().resolveActiveFilters(...a);
}
export function normalizeGridLayout(...a: any[]) {
  return F().normalizeGridLayout(...a);
}
export function normalizeVariance(...a: any[]) {
  return F().normalizeVariance(...a);
}
export function resolveBypassParams(...a: any[]) {
  return F().resolveBypassParams(...a);
}
export function buildBypassGraph(...a: any[]) {
  return F().buildBypassGraph(...a);
}
export function buildVideoFragmentsForCell(...a: any[]) {
  return F().buildVideoFragmentsForCell(...a);
}
export function buildPostGridPhantomChain(...a: any[]) {
  return F().buildPostGridPhantomChain(...a);
}
export function buildGridCells(...a: any[]) {
  return F().buildGridCells(...a);
}
export function buildCellVideoCore(...a: any[]) {
  return F().buildCellVideoCore(...a);
}
export function buildGridVideoFilterParts(...a: any[]) {
  return F().buildGridVideoFilterParts(...a);
}
export function buildAudioMaskComplexParts(...a: any[]) {
  return F().buildAudioMaskComplexParts(...a);
}
export function turboWorkSize(...a: any[]) {
  return F().turboWorkSize(...a);
}
export function joinVideoChain(fragments: string[]) {
  return F().joinVideoChain(fragments);
}
export function scaleFlagsForMode(turbo?: boolean) {
  return F().scaleFlagsForMode(turbo);
}
`,
  },
  {
    rel: 'src/lib/bypass-engine/variance.ts',
    stub: `/**
 * CROWN STUB — variance kernel in bypass-formulas.seal
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getBypassFormulas } from '@/lib/ip-seal/bypassFormulasRuntime';
export type { BypassParams, BypassVarianceOpts } from './formulaTypes';
export { VARIANCE_RECOMMENDED } from './publicCatalog';

const F = () => getBypassFormulas() as any;
export const BYPASS_DEFAULTS = F().BYPASS_DEFAULTS;
export function normalizeVariance(...a: any[]) {
  return F().normalizeVariance(...a);
}
export function resolveBypassParams(...a: any[]) {
  return F().resolveBypassParams(...a);
}
`,
  },
  {
    rel: 'src/lib/bypass-engine/presets.ts',
    stub: `/**
 * CROWN STUB — UI presets from publicCatalog; heavy logic stays sealed.
 */
export type {
  PhantomPreset,
  PhantomPresetId,
  PhantomPcRecommendation,
  BypassFilterId,
  GridLayoutMode,
} from './formulaTypes';
export {
  PHANTOM_PRESETS,
  getPhantomPreset,
  recommendPcForSelection,
} from './publicCatalog';
`,
  },
  {
    rel: 'src/lib/ttsBatchSrt/translateRules.ts',
    stub: `/**
 * CROWN STUB — rule descriptions from translate-crown.seal; chunk UX public.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getTranslateCrown } from '@/lib/ip-seal/translateCrownRuntime';
export {
  DEFAULT_TRANSLATE_CHUNK,
  MIN_TRANSLATE_CHUNK,
  MAX_TRANSLATE_CHUNK,
  clampTranslateChunk,
} from './publicTranslateCatalog';

const T = () => getTranslateCrown() as any;
export type TranslateRuleOption = { id: string; label: string; description: string };
export const TRANSLATE_RULE_OPTIONS: TranslateRuleOption[] = T().TRANSLATE_RULE_OPTIONS;
export function resolveTranslateRuleDescription(ruleId?: string): string {
  return String(T().resolveTranslateRuleDescription(ruleId));
}
`,
  },
  {
    rel: 'src/lib/ttsBatchSrt/translatePromptCrown.ts',
    stub: `/**
 * CROWN STUB — prompt kernel in translate-crown.seal
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getTranslateCrown } from '@/lib/ip-seal/translateCrownRuntime';

const T = () => getTranslateCrown() as any;
export const TRANSLATE_ANCHOR = T().TRANSLATE_ANCHOR;
export const translateSoftSplitPatternSource = T().translateSoftSplitPatternSource;
export function buildTranslateBatchPrompt(...a: any[]) {
  return T().buildTranslateBatchPrompt(...a);
}
`,
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function applyStubs() {
  ensureDir(BACKUP_DIR);
  for (const t of STUB_TARGETS) {
    const abs = path.join(ROOT, t.rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Crown stub target missing: ${t.rel}`);
    }
    const bak = path.join(BACKUP_DIR, t.rel);
    ensureDir(path.dirname(bak));
    if (!fs.existsSync(bak)) {
      fs.copyFileSync(abs, bak);
    }
    fs.writeFileSync(abs, t.stub, 'utf8');
    console.log(JSON.stringify({ ok: true, step: 'crown-stub-apply', rel: t.rel }));
  }
  fs.writeFileSync(
    path.join(BACKUP_DIR, '_active.json'),
    JSON.stringify({ at: Date.now(), files: STUB_TARGETS.map((t) => t.rel) }, null, 2),
  );
}

function restoreStubs() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log(JSON.stringify({ ok: true, step: 'crown-stub-restore', restored: 0 }));
    return { restored: [] };
  }
  const restored = [];
  for (const t of STUB_TARGETS) {
    const abs = path.join(ROOT, t.rel);
    const bak = path.join(BACKUP_DIR, t.rel);
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, abs);
      restored.push(t.rel);
    }
  }
  const marker = path.join(BACKUP_DIR, '_active.json');
  if (fs.existsSync(marker)) {
    try {
      fs.unlinkSync(marker);
    } catch {
      /* ignore */
    }
  }
  // Clean leftover backup files so next apply re-copies fresh sources
  for (const t of STUB_TARGETS) {
    const bak = path.join(BACKUP_DIR, t.rel);
    if (fs.existsSync(bak)) {
      try {
        fs.unlinkSync(bak);
      } catch {
        /* ignore */
      }
    }
  }
  console.log(
    JSON.stringify({ ok: true, step: 'crown-stub-restore', restored: restored.length, files: restored }),
  );
  return { restored };
}

async function main() {
  const cmd = process.argv[2] || 'help';
  if (cmd === 'apply') {
    restoreStubs();
    await sealJsCrowns();
    if (!fs.existsSync(path.join(CROWN_OUT, 'bypass-formulas.seal'))) {
      throw new Error('bypass-formulas.seal missing after seal');
    }
    if (!fs.existsSync(path.join(CROWN_OUT, 'translate-crown.seal'))) {
      throw new Error('translate-crown.seal missing after seal');
    }
    applyStubs();
    return;
  }
  if (cmd === 'restore') {
    restoreStubs();
    return;
  }
  if (cmd === 'seal-only') {
    restoreStubs();
    await sealJsCrowns();
    return;
  }
  console.log('Usage: node scripts/lib/crown-ip-stub.cjs <apply|restore|seal-only>');
  process.exit(cmd === 'help' ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[crown-stub]', err?.stack || err);
    try {
      restoreStubs();
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
}

module.exports = {
  applyStubs,
  restoreStubs,
  STUB_TARGETS,
  BACKUP_DIR,
};
