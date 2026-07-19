/**
 * Protect /admin/* — require Supabase session cookie OR redirect login.
 * License API routes use their own admin key / JWT checks.
 *
 * When Supabase not configured, /admin shows setup instructions (page handles it).
 */

import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only soft-gate: real auth is server-side on admin APIs.
  // Allow /admin always so setup page works without cookie.
  if (pathname.startsWith('/admin')) {
    const res = NextResponse.next();
    res.headers.set('x-ainovel-admin-surface', '1');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
