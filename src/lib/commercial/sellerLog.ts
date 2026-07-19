/**
 * Seller order log — append-only local JSONL for daily sales audit.
 * Path: data/licenses/seller-orders.jsonl
 */

import fs from 'fs';
import path from 'path';

export type SellerOrderLogEntry = {
  at: string;
  kind: 'code' | 'token' | 'transfer' | 'webhook' | 'note';
  plan?: string;
  code?: string;
  hwid?: string;
  orderId?: string;
  note?: string;
  meta?: Record<string, unknown>;
};

function logPath(): string {
  const root =
    process.env.AI_NOVEL_ROOT ||
    process.env.AINOVEL_DATA_ROOT ||
    process.cwd();
  return path.join(root, 'data', 'licenses', 'seller-orders.jsonl');
}

export function appendSellerLog(entry: SellerOrderLogEntry): void {
  try {
    const p = logPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const line = JSON.stringify({
      ...entry,
      at: entry.at || new Date().toISOString(),
    });
    fs.appendFileSync(p, line + '\n', 'utf8');
  } catch {
    /* non-fatal */
  }
}

export function readSellerLog(limit = 100): SellerOrderLogEntry[] {
  try {
    const p = logPath();
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    const slice = lines.slice(-Math.max(1, Math.min(1000, limit)));
    return slice
      .map((l) => {
        try {
          return JSON.parse(l) as SellerOrderLogEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is SellerOrderLogEntry => !!x)
      .reverse();
  } catch {
    return [];
  }
}
