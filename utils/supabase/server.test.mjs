import test from 'node:test';
import assert from 'node:assert/strict';
import { getSupabaseConfigFromEnv, isMissingTableError } from './server.ts';

test('getSupabaseConfigFromEnv reads SUPABASE_URL, VITE_, and NEXT_PUBLIC_ fallbacks cleanly', () => {
  const direct = getSupabaseConfigFromEnv({
    SUPABASE_URL: ' https://demo.supabase.co ',
    SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_demo ',
  });
  assert.deepEqual(direct, {
    url: 'https://demo.supabase.co',
    key: 'sb_publishable_demo',
  });

  const nextFallback = getSupabaseConfigFromEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://next.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_next',
  });
  assert.deepEqual(nextFallback, {
    url: 'https://next.supabase.co',
    key: 'sb_publishable_next',
  });
});

test('isMissingTableError detects PostgREST PGRST205 and Postgres 42P01 codes accurately', () => {
  assert.equal(isMissingTableError({ code: 'PGRST205', message: 'Could not find the table public.todos' }), true);
  assert.equal(isMissingTableError({ code: '42P01', message: 'relation "todos" does not exist' }), true);
  assert.equal(isMissingTableError({ code: '23505', message: 'duplicate key value' }), false);
  assert.equal(isMissingTableError(null), false);
});
