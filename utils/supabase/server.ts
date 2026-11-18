import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const AIRA_SUPABASE_TABLES = [
  'conversations',
  'messages',
  'memories',
  'notes',
  'todos',
] as const;

export interface SupabaseStatus {
  configured: boolean;
  tables_ready: boolean;
  missing_tables: string[];
  error: string | null;
}

export function getSupabaseConfigFromEnv(env: Record<string, string | undefined> = process.env): {
  url: string;
  key: string;
} {
  const url = (
    env.SUPABASE_URL ||
    env.VITE_SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const key = (
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
  return { url, key };
}

export function isMissingTableError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === 'PGRST205' || err.code === '42P01') return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('could not find the table') || msg.includes('does not exist');
}

let cachedClient: SupabaseClient | null = null;
let cachedStatus: { value: SupabaseStatus; checkedAt: number } | null = null;

export function getSupabaseServerClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient;
  const { url, key } = getSupabaseConfigFromEnv();
  if (!url || !key) return null;
  cachedClient = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cachedClient;
}

export function getSupabaseSchemaSql(): string {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), 'supabase', 'schema.sql'), 'utf8');
  } catch {
    return '';
  }
}

export async function checkSupabaseStatus(forceRefresh = false): Promise<SupabaseStatus> {
  const client = getSupabaseServerClient();
  if (!client) {
    return {
      configured: false,
      tables_ready: false,
      missing_tables: [...AIRA_SUPABASE_TABLES],
      error: 'Supabase URL or key not configured.',
    };
  }

  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - cachedStatus.checkedAt < 15_000) {
    return cachedStatus.value;
  }

  const missing: string[] = [];
  let fatalError: string | null = null;

  const checks = await Promise.all(
    AIRA_SUPABASE_TABLES.map(async (table) => {
      const { error } = await client.from(table).select('id').limit(1);
      return { table, error };
    })
  );

  for (const { table, error } of checks) {
    if (!error) continue;
    if (isMissingTableError(error)) {
      missing.push(table);
    } else if (!fatalError) {
      fatalError = error.message || error.code || 'Supabase query error';
    }
  }

  const status: SupabaseStatus = {
    configured: true,
    tables_ready: missing.length === 0 && !fatalError,
    missing_tables: missing,
    error: fatalError,
  };
  cachedStatus = { value: status, checkedAt: now };
  return status;
}

export async function getSupabaseOverview(userId: string): Promise<{
  memories: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  todos: Array<Record<string, unknown>>;
  conversations: Array<Record<string, unknown>>;
}> {
  const client = getSupabaseServerClient();
  if (!client) throw new Error('Supabase is not configured');

  const [memRes, noteRes, todoRes, convRes] = await Promise.all([
    client.from('memories').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50),
    client.from('notes').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50),
    client.from('todos').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50),
    client.from('conversations').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(50),
  ]);

  for (const res of [memRes, noteRes, todoRes, convRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  return {
    memories: memRes.data || [],
    notes: noteRes.data || [],
    todos: todoRes.data || [],
    conversations: convRes.data || [],
  };
}

export async function searchSupabaseMemories(
  userId: string,
  limit = 5
): Promise<Array<{ key: string; content: string }>> {
  const client = getSupabaseServerClient();
  if (!client) return [];
  const { data, error } = await client
    .from('memories')
    .select('key, content')
    .eq('user_id', userId)
    .order('importance', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data || []) as Array<{ key: string; content: string }>;
}

export async function saveSupabaseMemory(
  userId: string,
  input: {
    key: string;
    content: string;
    category?: string;
    importance?: number;
    source_conversation_id?: string | null;
  }
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };

  const key = String(input.key || '').trim();
  const content = String(input.content || '').trim();
  if (!key || !content) return { ok: false, error: 'Memory key and content are required.' };

  const now = new Date().toISOString();
  const { data: existing } = await client
    .from('memories')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    const { data, error } = await client
      .from('memories')
      .update({
        content,
        category: input.category || 'general',
        importance: Number(input.importance || 3),
        updated_at: now,
      })
      .eq('id', existing.id)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: { memory: data, updated: true } };
  }

  const { data, error } = await client
    .from('memories')
    .insert({
      user_id: userId,
      key,
      content,
      category: input.category || 'general',
      importance: Number(input.importance || 3),
      source_conversation_id: input.source_conversation_id || null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: { memory: data, updated: false } };
}

export async function deleteSupabaseMemory(
  userId: string,
  memoryId: number
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };
  const { error } = await client.from('memories').delete().eq('id', memoryId).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createSupabaseNote(
  userId: string,
  input: { title: string; content: string; tags?: string[] }
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };
  const title = String(input.title || '').trim();
  const content = String(input.content || '').trim();
  if (!title || !content) return { ok: false, error: 'Note title and content are required.' };

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('notes')
    .insert({
      user_id: userId,
      title,
      content,
      tags_json: Array.isArray(input.tags) ? input.tags : [],
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: { note: data } };
}

export async function deleteSupabaseNote(
  userId: string,
  noteId: number
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };
  const { error } = await client.from('notes').delete().eq('id', noteId).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function createSupabaseTodo(
  userId: string,
  input: { title: string; priority?: string; due_date?: string | null }
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };
  const title = String(input.title || '').trim();
  if (!title) return { ok: false, error: 'Todo title is required.' };

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('todos')
    .insert({
      user_id: userId,
      title,
      status: 'pending',
      priority: input.priority || 'medium',
      due_date: input.due_date || null,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: { todo: data } };
}

export async function updateSupabaseTodoStatus(
  userId: string,
  todoId: number,
  status: string
): Promise<{ ok: boolean; result?: Record<string, unknown>; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };
  if (!['pending', 'in_progress', 'completed'].includes(status)) {
    return { ok: false, error: 'Invalid todo status.' };
  }
  const { data, error } = await client
    .from('todos')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', todoId)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: { todo: data } };
}

export async function appendSupabaseMessage(
  userId: string,
  input: {
    conversation_id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    language?: string;
    tool_calls?: unknown[];
    metrics?: Record<string, unknown>;
  }
): Promise<void> {
  const client = getSupabaseServerClient();
  if (!client) return;
  const now = new Date().toISOString();
  const language = input.language || 'en';
  const title = input.content.trim().slice(0, 64) || 'Voice session';

  const { data: existingConv } = await client
    .from('conversations')
    .select('id')
    .eq('id', input.conversation_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existingConv) {
    await client.from('conversations').insert({
      id: input.conversation_id,
      user_id: userId,
      title,
      language,
      created_at: now,
      updated_at: now,
    });
  } else {
    await client
      .from('conversations')
      .update({ updated_at: now, language })
      .eq('id', input.conversation_id)
      .eq('user_id', userId);
  }

  await client.from('messages').insert({
    user_id: userId,
    conversation_id: input.conversation_id,
    role: input.role,
    content: input.content,
    language,
    tool_calls_json: input.tool_calls || null,
    metrics_json: input.metrics || null,
    created_at: now,
  });
}

export async function getSupabaseConversationMessages(
  userId: string,
  conversationId: string,
  limit = 50
): Promise<Array<Record<string, unknown>>> {
  const client = getSupabaseServerClient();
  if (!client) return [];
  const { data, error } = await client
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return [];
  return data || [];
}

export async function deleteSupabaseConversation(
  userId: string,
  conversationId: string
): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { ok: false, error: 'Supabase is not configured' };
  const { error } = await client
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
