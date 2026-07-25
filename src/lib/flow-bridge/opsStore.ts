/**
 * Flow ops config (P2 agent instructions + P3 farm policy).
 * File-backed under data/flow-bridge/ops.json — no Zustand hydrate cost.
 */
import fs from 'fs';
import path from 'path';

export type FlowOpsConfig = {
  /** Persistent Agent Instructions (style / camera / cast rules) */
  agentInstructions: string;
  /** Default quality for gen tasks: 1k | hd | 2k | 4k */
  defaultQuality: string;
  /** Auto-relogin when token age > tokenRefreshMs or 401 */
  autoRelogin: boolean;
  /** Prefer accounts with healthScore >= this (0–100) */
  minHealthScore: number;
  /** Soft daily credit budget per account (null = unlimited) */
  defaultCreditBudget: number | null;
  /** Global proxy fallback host:port or http://user:pass@host:port */
  globalProxy?: string;
  /**
   * Google Flow standard: recycle Chromium profile after successful gens
   * (session drift + RAM). Soft refresh tab when N not reached.
   */
  recycleAfterSuccess: boolean;
  /** Image/edit: hard recycle every N successes (min 1) */
  recycleEveryNSuccess: number;
  /** Video/extend: hard recycle after every success when true */
  recycleEveryVideoSuccess: boolean;
  updatedAt: number;
};

const DEFAULTS: FlowOpsConfig = {
  agentInstructions: '',
  defaultQuality: 'hd',
  autoRelogin: true,
  minHealthScore: 20,
  defaultCreditBudget: null,
  globalProxy: '',
  /** Soft hygiene ON; hard-kill every video OFF (killed mid multi-gen / hung HTTP). */
  recycleAfterSuccess: true,
  recycleEveryNSuccess: 3,
  recycleEveryVideoSuccess: false,
  updatedAt: 0,
};

function opsPath(): string {
  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const dir = path.join(root, 'data', 'flow-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'ops.json');
}

export function loadFlowOps(): FlowOpsConfig {
  try {
    const p = opsPath();
    if (!fs.existsSync(p)) return { ...DEFAULTS };
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<FlowOpsConfig>;
    return {
      ...DEFAULTS,
      ...raw,
      agentInstructions: String(raw.agentInstructions || ''),
      defaultQuality: String(raw.defaultQuality || DEFAULTS.defaultQuality),
      autoRelogin: raw.autoRelogin !== false,
      minHealthScore: Number.isFinite(Number(raw.minHealthScore))
        ? Number(raw.minHealthScore)
        : DEFAULTS.minHealthScore,
      defaultCreditBudget:
        raw.defaultCreditBudget == null
          ? null
          : Number(raw.defaultCreditBudget),
      globalProxy: raw.globalProxy ? String(raw.globalProxy) : '',
      recycleAfterSuccess: raw.recycleAfterSuccess !== false,
      recycleEveryNSuccess: Number.isFinite(Number(raw.recycleEveryNSuccess))
        ? Math.max(1, Math.floor(Number(raw.recycleEveryNSuccess)))
        : DEFAULTS.recycleEveryNSuccess,
      // Default FALSE — hard kill Chrome after every video hung Electron / mid-gen.
      // Only honor explicit true from ops.json.
      recycleEveryVideoSuccess:
        raw.recycleEveryVideoSuccess === true
          ? true
          : raw.recycleEveryVideoSuccess === false
            ? false
            : DEFAULTS.recycleEveryVideoSuccess,
      updatedAt: Number(raw.updatedAt) || 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveFlowOps(patch: Partial<FlowOpsConfig>): FlowOpsConfig {
  const next: FlowOpsConfig = {
    ...loadFlowOps(),
    ...patch,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(opsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** Merge agent instructions + optional ref note into a gen prompt. */
export function applyAgentInstructions(
  prompt: string,
  instructions?: string,
): string {
  const base = String(prompt || '').trim();
  const instr = String((instructions ?? loadFlowOps().agentInstructions) || '').trim();
  if (!instr) return base;
  if (base.includes(instr.slice(0, 40))) return base;
  return `${base}\n\n[Project Agent Instructions]\n${instr}`.trim();
}
