/**
 * HWID rebind / fingerprint challenge cache (packaged).
 *
 * On each successful paid access, compare current HWID candidates with last stamp.
 * Large drift (none of previous candidates match) → require re-activate online once.
 * Soft: stores candidates hash; does not invent new HWID algorithms.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { getHwid, getHwidCandidates } from '@/lib/entitlement';
import { isPackagedCustomerRuntime } from '@/lib/commercial/packagedAttestation';
import { AppError } from '@/lib/errors';

type RebindFile = {
  tokenHash: string;
  candidates: string[];
  preferred: string;
  updatedAt: number;
  /** True after a hard drift until next successful activate/online stamp */
  needsRebind?: boolean;
};

function rebindPath(): string {
  const base =
    process.env.AI_NOVEL_USER_DATA ||
    process.env.AINOVEL_DATA_ROOT ||
    path.join(os.homedir(), '.ainovel-license');
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(base, 'hwid-rebind.json');
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32);
}

function readFile(): RebindFile | null {
  try {
    const j = JSON.parse(fs.readFileSync(rebindPath(), 'utf8')) as RebindFile;
    if (!j || !Array.isArray(j.candidates)) return null;
    return j;
  } catch {
    return null;
  }
}

function writeFile(data: RebindFile): void {
  try {
    fs.writeFileSync(rebindPath(), JSON.stringify(data), 'utf8');
  } catch {
    /* ignore */
  }
}

/**
 * After token+HWID verify OK: track fingerprint set.
 * If previous stamp for same token shares zero candidates → hard drift.
 */
export function enforceHwidRebind(token: string): void {
  if (!isPackagedCustomerRuntime()) return;
  if (
    process.env.AINOVEL_HWID_REBIND === '0' ||
    process.env.AINOVEL_HWID_REBIND === 'false'
  ) {
    return;
  }
  if (!token) return;

  const th = tokenHash(token);
  const cands = getHwidCandidates().map((c) => c.toLowerCase());
  const preferred = getHwid().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const prev = readFile();

  if (!prev || prev.tokenHash !== th) {
    writeFile({
      tokenHash: th,
      candidates: cands,
      preferred,
      updatedAt: now,
      needsRebind: false,
    });
    return;
  }

  if (prev.needsRebind) {
    // Allow if any current candidate still in previous set after user re-auth
    // (activate clears by rewriting stamp without needsRebind)
    const overlap = cands.some((c) => prev.candidates.includes(c));
    if (!overlap) {
      throw new AppError(
        'HWID đã đổi mạnh so với lần kích hoạt — mở Bản quyền và kích hoạt lại key trên máy này.',
        { code: 'AUTH', status: 403 },
      );
    }
  }

  const overlap = cands.some((c) => prev.candidates.includes(c));
  if (!overlap && prev.candidates.length > 0) {
    writeFile({
      tokenHash: th,
      candidates: cands,
      preferred,
      updatedAt: now,
      needsRebind: true,
    });
    throw new AppError(
      'Phát hiện HWID drift (không còn khớp fingerprint cũ). Kích hoạt lại license trên máy này.',
      { code: 'AUTH', status: 403 },
    );
  }

  // Merge candidates over time (machine upgrades)
  const merged = Array.from(new Set([...prev.candidates, ...cands])).slice(0, 12);
  writeFile({
    tokenHash: th,
    candidates: merged,
    preferred,
    updatedAt: now,
    needsRebind: false,
  });
}

/** Call after successful activate to clear rebind lock. */
export function clearHwidRebindLock(): void {
  try {
    fs.unlinkSync(rebindPath());
  } catch {
    /* ignore */
  }
}
