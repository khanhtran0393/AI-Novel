/**
 * Protect /admin/* — API routes still perform the authoritative auth checks.
 * When Supabase is not configured, /admin remains visible for setup guidance.
 */

import { NextResponse, type NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const res = NextResponse.next();
    res.headers.set('x-ainovel-admin-surface', '1');
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
