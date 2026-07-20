/**
 * Load Phantom-X crown formulas from AES seal (pack) or live modules (dev).
 */
import { crownSealExists } from '@/lib/ip-seal/paths';
import { loadSealedCjsModule } from '@/lib/ip-seal/loadSealedCjs';

export type BypassFormulasApi = {
  BYPASS_FILTER_CATALOG: ReadonlyArray<{ id: string; label: string; master?: boolean }>;
  GRID_LAYOUT_OPTIONS: ReadonlyArray<{
    id: string;
    label: string;
    cols: number;
    rows: number;
  }>;
  BYPASS_DEFAULTS: Record<string, unknown>;
  VARIANCE_RECOMMENDED: Record<string, number>;
  OVERLAY_FILTER?: string;
  resolveActiveFilters: (...args: unknown[]) => Set<string>;
  normalizeGridLayout: (...args: unknown[]) => string;
  normalizeVariance: (...args: unknown[]) => unknown;
  resolveBypassParams: (...args: unknown[]) => unknown;
  buildBypassGraph: (...args: unknown[]) => unknown;
  buildVideoFragmentsForCell: (...args: unknown[]) => string[];
  buildPostGridPhantomChain: (...args: unknown[]) => string | null;
  buildGridCells: (...args: unknown[]) => unknown;
  buildCellVideoCore: (...args: unknown[]) => string;
  buildGridVideoFilterParts: (...args: unknown[]) => unknown;
  buildAudioMaskComplexParts: (...args: unknown[]) => { parts: string[]; outLabel: string };
  turboWorkSize: (...args: unknown[]) => unknown;
  joinVideoChain: (fragments: string[]) => string;
  scaleFlagsForMode: (turbo?: boolean) => string;
  PHANTOM_PRESETS: unknown[];
  getPhantomPreset: (...args: unknown[]) => unknown;
  recommendPcForSelection: (...args: unknown[]) => unknown;
};

let cached: BypassFormulasApi | null = null;

/**
 * Prefer sealed crown when present (customer pack / sealed build).
 * Dev without seal: dynamic import of live formula modules.
 */
export function getBypassFormulas(): BypassFormulasApi {
  if (cached) return cached;

  if (crownSealExists('bypass-formulas')) {
    cached = loadSealedCjsModule<BypassFormulasApi>('bypass-formulas');
    return cached;
  }

  // Live dev path — only when plain modules are present (not stubbed)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const filters = require('@/lib/bypass-engine/filters') as BypassFormulasApi;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const presets = require('@/lib/bypass-engine/presets') as Pick<
    BypassFormulasApi,
    'PHANTOM_PRESETS' | 'getPhantomPreset' | 'recommendPcForSelection'
  >;
  cached = { ...filters, ...presets };
  return cached;
}

export function resetBypassFormulasCache(): void {
  cached = null;
}
