import { createClient as createSupabaseClient } from '@supabase/supabase-js';

let cachedClient = null;

export function getSupabaseEnv() {
  const url =
    import.meta.env.VITE_SUPABASE_URL ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
    '';
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    '';
  return { url: url.trim(), key: key.trim() };
}

export function isSupabaseConfigured() {
  const { url, key } = getSupabaseEnv();
  return Boolean(url && key);
}

export function createClient() {
  if (cachedClient) return cachedClient;
  const { url, key } = getSupabaseEnv();
  if (!url || !key) return null;
  cachedClient = createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}
