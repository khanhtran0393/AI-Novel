/**
 * Browser / Electron renderer Supabase client (anon + RLS only).
 * Optional — only when NEXT_PUBLIC_SUPABASE_* set.
 */

'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl, isSupabaseConfigured } from './env';

let singleton: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  if (typeof window === 'undefined') return null;
  if (!isSupabaseConfigured()) return null;
  if (singleton) return singleton;
  singleton = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'ainovel.supabase.auth',
    },
  });
  return singleton;
}
