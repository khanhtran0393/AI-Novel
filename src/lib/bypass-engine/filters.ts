/**
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
