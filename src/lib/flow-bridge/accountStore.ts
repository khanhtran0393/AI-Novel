import fs from 'fs';
import path from 'path';
import type { FlowAccount } from './types';

function accountsPath(): string {
  const root = process.env.AI_NOVEL_ROOT || process.cwd();
  const dir = path.join(root, 'data', 'flow-bridge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'accounts.json');
}

function newId(): string {
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function loadAccounts(): FlowAccount[] {
  try {
    const p = accountsPath();
    if (!fs.existsSync(p)) return [];
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((a) => ({
      id: String(a.id || newId()),
      name: String(a.name || 'Account'),
      email: a.email ? String(a.email) : '',
      projectId: a.projectId ? String(a.projectId) : '',
      engine:
        a.engine === 'mullvad'
          ? 'mullvad'
          : a.engine === 'chrome'
            ? 'chrome'
            : 'chromium',
      browserExe: a.browserExe ? String(a.browserExe) : '',
      status: (a.status as FlowAccount['status']) || 'idle',
      flowKeyPresent: Boolean(a.flowKeyPresent),
      tokenAgeMs: a.tokenAgeMs ?? null,
      credits: a.credits ?? null,
      cooldownUntil: a.cooldownUntil ?? null,
      lastError: a.lastError ?? null,
      createdAt: Number(a.createdAt) || Date.now(),
      updatedAt: Number(a.updatedAt) || Date.now(),
    }));
  } catch {
    return [];
  }
}

export function saveAccounts(accounts: FlowAccount[]): void {
  const p = accountsPath();
  // Never persist raw Bearer tokens
  const safe = accounts.map(({ ...a }) => ({
    ...a,
    // strip ephemeral secrets if any were attached
  }));
  fs.writeFileSync(p, JSON.stringify(safe, null, 2), 'utf8');
}

export function createAccount(input: {
  name: string;
  email?: string;
  engine?: 'chromium' | 'mullvad' | 'chrome';
  browserExe?: string;
}): FlowAccount {
  const list = loadAccounts();
  const acc: FlowAccount = {
    id: newId(),
    name: input.name.trim() || `Account ${list.length + 1}`,
    email: input.email || '',
    projectId: '',
    engine: input.engine || 'chromium',
    browserExe: input.browserExe || '',
    status: 'idle',
    flowKeyPresent: false,
    tokenAgeMs: null,
    credits: null,
    cooldownUntil: null,
    lastError: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.push(acc);
  saveAccounts(list);
  return acc;
}

export function updateAccount(
  id: string,
  patch: Partial<FlowAccount>,
): FlowAccount | null {
  const list = loadAccounts();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  list[i] = {
    ...list[i],
    ...patch,
    id: list[i].id,
    updatedAt: Date.now(),
  };
  saveAccounts(list);
  return list[i];
}

export function deleteAccount(id: string): boolean {
  const list = loadAccounts();
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  saveAccounts(next);
  return true;
}

export function pickReadyAccount(accounts: FlowAccount[]): FlowAccount | null {
  const now = Date.now();
  const ready = accounts.filter((a) => {
    if (a.status === 'cooldown' && a.cooldownUntil && a.cooldownUntil > now) {
      return false;
    }
    return a.status === 'active' || a.flowKeyPresent;
  });
  if (!ready.length) return null;
  // least recently updated first (simple load balance)
  ready.sort((a, b) => a.updatedAt - b.updatedAt);
  return ready[0];
}
