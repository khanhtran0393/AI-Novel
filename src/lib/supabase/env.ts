/**
 * Supabase env — graceful when not configured (local-only commercial still works).
 */

export function getSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

/** Service role — server only. Never NEXT_PUBLIC. */
export function getSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

/** Client-capable (Auth UI / browser) — needs anon/publishable key. */
export function isSupabaseConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** Server cloud ops (orders/licenses) — needs service/secret key. */
export function isSupabaseAdminConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseServiceRoleKey());
}

/** Any Supabase wire-up present (admin server and/or client). */
export function isSupabaseAnyConfigured(): boolean {
  return isSupabaseAdminConfigured() || isSupabaseConfigured();
}

export function supabaseConfigPublic() {
  return {
    configured: isSupabaseAnyConfigured(),
    clientConfigured: isSupabaseConfigured(),
    adminConfigured: isSupabaseAdminConfigured(),
    urlPresent: Boolean(getSupabaseUrl()),
    anonPresent: Boolean(getSupabaseAnonKey()),
    serviceRolePresent: Boolean(getSupabaseServiceRoleKey()),
  };
}
