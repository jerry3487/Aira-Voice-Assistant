-- Aira Supabase PostgreSQL Schema
-- Run this once in your Supabase Dashboard -> SQL Editor

create table if not exists public.conversations (
  id text primary key,
  user_id text not null,
  title text not null,
  language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  user_id text not null,
  conversation_id text not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null,
  language text not null default 'en',
  tool_calls_json jsonb,
  metrics_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.memories (
  id bigint generated always as identity primary key,
  user_id text not null,
  key text not null,
  content text not null,
  category text not null default 'general',
  importance integer not null default 3,
  source_conversation_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id bigint generated always as identity primary key,
  user_id text not null,
  title text not null,
  content text not null,
  tags_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.todos (
  id bigint generated always as identity primary key,
  user_id text not null,
  title text not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  due_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_aira_conversations_user on public.conversations(user_id, updated_at desc);
create index if not exists idx_aira_messages_conv on public.messages(conversation_id, created_at asc);
create index if not exists idx_aira_memories_user on public.memories(user_id, updated_at desc);
create index if not exists idx_aira_notes_user on public.notes(user_id, updated_at desc);
create index if not exists idx_aira_todos_user on public.todos(user_id, updated_at desc);
