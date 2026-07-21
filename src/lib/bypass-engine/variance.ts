/**
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
