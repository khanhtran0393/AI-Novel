/**
 * Alias API — cùng engine với /api/export-capcut (GUI tên CapCut).
 * Next.js cấm re-export `runtime` — giữ POST wrapper + runtime local.
 */
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { POST: exportCapcut } = await import('../export-capcut/route');
  return exportCapcut(req);
}
