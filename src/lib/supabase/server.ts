/**
 * Server-only Supabase clients (Vercel / Next Route Handlers).
 * service_role bypasses RLS — only after auth checks in application code.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/errors';
import {
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
} from './env';

export function createServiceSupabase(): SupabaseClient {
  if (!isSupabaseAdminConfigured()) {
    throw new AppError(
      'Supabase admin chưa cấu hình (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
      { code: 'INFRA', status: 503 },
    );
  }
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** User-scoped client from Bearer JWT (respects RLS). */
export function createUserSupabase(accessToken: string): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new AppError('Supabase chưa cấu hình (URL + anon key).', {
      code: 'INFRA',
      status: 503,
    });
  }
  const token = accessToken.trim();
  if (!token) {
    throw new AppError('Thiếu access token.', { code: 'AUTH', status: 401 });
  }
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() || null;
}

export async function requireUserFromRequest(req: Request): Promise<{
  userId: string;
  email: string | null;
  client: SupabaseClient;
}> {
  const token = extractBearer(req);
  if (!token) {
    throw new AppError('Cần đăng nhập (Bearer access_token).', {
      code: 'AUTH',
      status: 401,
    });
  }
  const client = createUserSupabase(token);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new AppError('Session không hợp lệ hoặc hết hạn.', {
      code: 'AUTH',
      status: 401,
    });
  }
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    client,
  };
}

export async function requireAdminFromRequest(req: Request): Promise<{
  userId: string;
  email: string | null;
  service: SupabaseClient;
}> {
  // Prefer admin HTTP key for seller tooling
  const adminKey = (process.env.AINOVEL_ENTITLEMENT_ADMIN_KEY || '').trim();
  const headerKey =
    req.headers.get('x-ainovel-admin-key') ||
    req.headers.get('x-admin-key') ||
    '';
  if (adminKey && headerKey && headerKey === adminKey) {
    return {
      userId: 'admin-key',
      email: null,
      service: createServiceSupabase(),
    };
  }

  const { userId, email, client } = await requireUserFromRequest(req);
  const { data: profile, error } = await client
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    throw new AppError(`Không đọc profile: ${error.message}`, {
      code: 'INFRA',
      status: 502,
    });
  }
  if (!profile || profile.role !== 'admin') {
    throw new AppError('Forbidden: cần admin.', { code: 'AUTH', status: 403 });
  }
  return { userId, email, service: createServiceSupabase() };
}
