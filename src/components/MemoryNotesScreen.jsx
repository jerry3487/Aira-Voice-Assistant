import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Database, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { authFetch } from '../utils/apiClient.js';
import ConfirmDialog from './ConfirmDialog.jsx';

export default function MemoryNotesScreen({ assistant, onOpenVoice }) {
  const [subTab, setSubTab] = useState('memories');
  const [data, setData] = useState({
    memories: [],
    notes: [],
    todos: [],
    conversations: [],
    storage_backend: 'sqlite',
    supabase: null,
  });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showSql, setShowSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const [memKey, setMemKey] = useState('');
  const [memContent, setMemContent] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [todoTitle, setTodoTitle] = useState('');

  const refreshData = useCallback(async (forceSupabaseCheck = false) => {
    setLoading(true);
    try {
      const endpoint = forceSupabaseCheck ? '/api/data/overview?refresh=1' : '/api/data/overview';
      const res = await authFetch(endpoint);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshData(false);
  }, [refreshData]);

  const handleCopySql = async () => {
    const sql = data.supabase?.setup_sql;
    if (!sql || !navigator.clipboard) return;
    await navigator.clipboard.writeText(sql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const handleAddMemory = async (e) => {
    e.preventDefault();
    if (!memKey.trim() || !memContent.trim()) return;
    await authFetch('/api/data/memories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: memKey.trim(), content: memContent.trim(), category: 'user' }),
    });
    setMemKey('');
    setMemContent('');
    await refreshData();
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;
    await authFetch('/api/data/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: noteTitle.trim(), content: noteContent.trim() }),
    });
    setNoteTitle('');
    setNoteContent('');
    await refreshData();
  };

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!todoTitle.trim()) return;
    await authFetch('/api/data/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: todoTitle.trim(), priority: 'medium' }),
    });
    setTodoTitle('');
    await refreshData();
  };

  const handleCycleTodo = async (todo) => {
    const nextStatus =
      todo.status === 'pending'
        ? 'in_progress'
        : todo.status === 'in_progress'
        ? 'completed'
        : 'pending';
    await authFetch(`/api/data/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    await refreshData();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    const { type, id } = pendingDelete;
    const url =
      type === 'memory'
        ? `/api/data/memories/${id}?confirmed=true`
        : type === 'note'
        ? `/api/data/notes/${id}?confirmed=true`
        : `/api/conversations/${encodeURIComponent(id)}?confirmed=true`;
    await authFetch(url, { method: 'DELETE' });
    setPendingDelete(null);
    await refreshData();
  };

  const q = query.trim().toLowerCase();
  const filteredMemories = data.memories.filter(
    (m) => !q || m.key.toLowerCase().includes(q) || m.content.toLowerCase().includes(q)
  );
  const filteredNotes = data.notes.filter(
    (n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  );
  const filteredTodos = data.todos.filter((t) => !q || t.title.toLowerCase().includes(q));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/8">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Memory, Notes & History
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium ${
                data.storage_backend === 'supabase'
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-300 bg-slate-100 text-slate-700 dark:border-white/12 dark:bg-white/5 dark:text-slate-300'
              }`}
            >
              <Database className="h-3 w-3" />
              {data.storage_backend === 'supabase'
                ? 'Supabase Connected'
                : data.supabase?.configured
                ? 'SQLite Active · Supabase Setup Pending'
                : 'Local SQLite'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {data.storage_backend === 'supabase'
              ? 'Synced privately per user in Supabase PostgreSQL · Explicit confirmation required for deletion'
              : 'Stored privately in local SQLite · Explicit confirmation required for deletion'}
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="search"
            aria-label="Search memories, notes, and todos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved records..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 dark:border-white/10 dark:bg-[#111620] dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-500"
          />
        </div>
      </div>

      {data.supabase?.configured && !data.supabase?.tables_ready && data.supabase?.setup_sql && (
        <div className="mt-5 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-100">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Create Aira tables in Supabase to enable cloud sync</p>
              <p className="mt-0.5 text-amber-800/90 dark:text-amber-200/80">
                Supabase credentials are connected, but the required tables (
                <code className="font-mono">{(data.supabase.missing_tables || []).join(', ')}</code>
                ) are not in your project yet.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSql((v) => !v)}
                className="rounded-lg border border-amber-500/40 bg-white/70 px-3 py-1.5 font-medium text-amber-900 hover:bg-white dark:bg-black/25 dark:text-amber-100 dark:hover:bg-black/40"
              >
                {showSql ? 'Hide SQL' : 'View Setup SQL'}
              </button>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-white/70 px-3 py-1.5 font-medium text-amber-900 hover:bg-white dark:bg-black/25 dark:text-amber-100 dark:hover:bg-black/40"
              >
                {copiedSql ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedSql ? 'Copied SQL' : 'Copy SQL'}</span>
              </button>
              <button
                type="button"
                onClick={() => refreshData(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-500"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Verify Tables</span>
              </button>
            </div>
          </div>
          {showSql && (
            <pre className="mt-3 max-h-60 overflow-auto rounded-lg border border-amber-500/25 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
              {data.supabase.setup_sql}
            </pre>
          )}
        </div>
      )}

      <div className="mt-5 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-white/8 dark:bg-[#111620]">
        {[
          { id: 'memories', label: `Memories (${data.memories.length})` },
          { id: 'notes', label: `Notes (${data.notes.length})` },
          { id: 'todos', label: `Todos (${data.todos.length})` },
          { id: 'conversations', label: `Conversations (${data.conversations.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors ${
              subTab === tab.id
                ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'memories' && (
        <div className="mt-6 space-y-5">
          <form
            onSubmit={handleAddMemory}
            className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620] sm:grid-cols-12"
          >
            <input
              type="text"
              placeholder="Memory key (e.g. coding_style)"
              value={memKey}
              onChange={(e) => setMemKey(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 sm:col-span-3"
            />
            <input
              type="text"
              placeholder="Memory content to remember across sessions..."
              value={memContent}
              onChange={(e) => setMemContent(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 sm:col-span-7"
            />
            <button
              type="submit"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 sm:col-span-2"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Save Memory</span>
            </button>
          </form>

          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620]">
            {loading && filteredMemories.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                Loading saved memories...
              </p>
            ) : filteredMemories.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No memories stored yet. Tell Aira “Remember that...” or add one above.
              </p>
            ) : (
              filteredMemories.map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-medium text-sky-700 dark:text-sky-300">
                        {m.key}
                      </span>
                      <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">·</span>
                      <span className="text-slate-600 dark:text-slate-400">{m.category}</span>
                      <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">·</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        Importance {m.importance}/5
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-800 dark:text-slate-200">{m.content}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete memory '${m.key}'`}
                    onClick={() =>
                      setPendingDelete({
                        type: 'memory',
                        id: m.id,
                        label: `memory "${m.key}"`,
                      })
                    }
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {subTab === 'notes' && (
        <div className="mt-6 space-y-5">
          <form
            onSubmit={handleAddNote}
            className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620] sm:grid-cols-12"
          >
            <input
              type="text"
              placeholder="Note title"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 sm:col-span-3"
            />
            <input
              type="text"
              placeholder="Note content..."
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 sm:col-span-7"
            />
            <button
              type="submit"
              className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 sm:col-span-2"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Note</span>
            </button>
          </form>

          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620]">
            {filteredNotes.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No notes saved yet.
              </p>
            ) : (
              filteredNotes.map((n) => (
                <div key={n.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{n.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {n.content}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Delete note '${n.title}'`}
                    onClick={() =>
                      setPendingDelete({ type: 'note', id: n.id, label: `note "${n.title}"` })
                    }
                    className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {subTab === 'todos' && (
        <div className="mt-6 space-y-5">
          <form
            onSubmit={handleAddTodo}
            className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620]"
          >
            <input
              type="text"
              placeholder="Add a local todo item..."
              value={todoTitle}
              onChange={(e) => setTodoTitle(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100"
            />
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Task</span>
            </button>
          </form>

          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620]">
            {filteredTodos.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No todos yet.
              </p>
            ) : (
              filteredTodos.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <button
                    type="button"
                    onClick={() => handleCycleTodo(t)}
                    className="flex items-center gap-3 text-left"
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded border ${
                        t.status === 'completed'
                          ? 'border-emerald-500 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : t.status === 'in_progress'
                          ? 'border-sky-500 bg-sky-500/20 text-sky-700 dark:text-sky-300'
                          : 'border-slate-300 dark:border-white/20'
                      }`}
                    >
                      {t.status === 'completed' && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span
                      className={`text-sm ${
                        t.status === 'completed'
                          ? 'line-through text-slate-400 dark:text-slate-500'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {t.title}
                    </span>
                  </button>
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{t.status}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {subTab === 'conversations' && (
        <div className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620]">
          {data.conversations.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No past voice sessions recorded yet.
            </p>
          ) : (
            data.conversations.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <button
                  type="button"
                  onClick={async () => {
                    await assistant.loadConversation(c.id);
                    onOpenVoice();
                  }}
                  className="flex-1 text-left"
                >
                  <p className="text-sm font-medium text-slate-900 hover:text-sky-600 dark:text-slate-100 dark:hover:text-sky-300">
                    {c.title}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-slate-500">
                    {c.language} · Updated {new Date(c.updated_at).toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={`Delete conversation '${c.title}'`}
                  onClick={() =>
                    setPendingDelete({
                      type: 'conversation',
                      id: c.id,
                      label: `conversation "${c.title}"`,
                    })
                  }
                  className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Confirm Permanent Deletion"
        message={`Are you sure you want to permanently delete ${pendingDelete?.label || 'this record'} from your ${
          data.storage_backend === 'supabase' ? 'Supabase' : 'local SQLite'
        } database?`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
