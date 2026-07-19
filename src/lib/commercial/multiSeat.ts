/**
 * Multi-seat license seats — admin transfer / expand max seats.
 * Seats live on activation-code vault records (see activationVault).
 */

import {
  getActivationCode,
  releaseSeat,
  setMaxSeats,
  listActivationCodes,
  type ActivationCodeRecord,
} from './activationVault';

export type SeatTransferResult = {
  ok: boolean;
  code: string;
  releasedHwid?: string;
  remainingSeats: string[];
  maxSeats: number;
  error?: string;
};

/** Release one machine from a multi-seat (or single-seat) code. */
export function transferSeat(
  rawCode: string,
  hwidToRelease: string,
): SeatTransferResult {
  const released = releaseSeat(rawCode, hwidToRelease);
  if (!released.ok || !released.record) {
    return {
      ok: false,
      code: rawCode,
      remainingSeats: [],
      maxSeats: 1,
      error: released.error || 'Transfer thất bại',
    };
  }
  const rec = released.record;
  return {
    ok: true,
    code: rec.code,
    releasedHwid: hwidToRelease.trim().toLowerCase(),
    remainingSeats: rec.seats || [],
    maxSeats: rec.maxSeats ?? 1,
  };
}

export function expandMaxSeats(
  rawCode: string,
  maxSeats: number,
): { ok: boolean; record?: ActivationCodeRecord; error?: string } {
  return setMaxSeats(rawCode, maxSeats);
}

export function findCodesByHwid(hwid: string): ActivationCodeRecord[] {
  const id = String(hwid || '').trim().toLowerCase();
  if (!id) return [];
  return listActivationCodes(500).filter((c) => {
    const seats = c.seats?.length
      ? c.seats
      : c.redeemedHwid
        ? [c.redeemedHwid]
        : [];
    return seats.some((s) => s === id);
  });
}

export function getSeatSummary(rawCode: string): {
  ok: boolean;
  code?: string;
  maxSeats?: number;
  seats?: string[];
  used?: number;
  free?: number;
  error?: string;
} {
  const rec = getActivationCode(rawCode);
  if (!rec) return { ok: false, error: 'Mã không tồn tại.' };
  const maxSeats = Math.max(1, rec.maxSeats ?? 1);
  const seats = rec.seats?.length
    ? rec.seats
    : rec.redeemedHwid
      ? [rec.redeemedHwid]
      : [];
  return {
    ok: true,
    code: rec.code,
    maxSeats,
    seats,
    used: seats.length,
    free: Math.max(0, maxSeats - seats.length),
  };
}
