import 'dotenv/config';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { WebSocketServer, type WebSocket } from 'ws';

import fs from 'node:fs';
import { clerkMiddleware, getAuth, verifyToken } from '@clerk/express';
import {
  appendSupabaseMessage,
  checkSupabaseStatus,
  createSupabaseNote,
  createSupabaseTodo,
  deleteSupabaseConversation,
  deleteSupabaseMemory,
  deleteSupabaseNote,
  getSupabaseConversationMessages,
  getSupabaseOverview,
  getSupabaseSchemaSql,
  saveSupabaseMemory,
  searchSupabaseMemories,
  updateSupabaseTodoStatus,
} from './utils/supabase/server.ts';

const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const FASTAPI_URL = (process.env.LOCALVOX_FASTAPI_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const LLM_API_URL = (process.env.LLM_API_URL || '').replace(/\/$/, '');
const LLM_API_KEY = process.env.LLM_API_KEY || '';
const LLM_API_MODEL = process.env.LLM_API_MODEL || 'qwen/qwen3.8-27b';
const CLERK_PUBLISHABLE_KEY =
  process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY || '';
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || '';

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

async function verifyWsClerkToken(req: {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}): Promise<string | null> {
  if (!CLERK_SECRET_KEY) return null;
  let token = '';

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }
  if (!token && req.url && req.url.includes('token=')) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      token = parsed.searchParams.get('token') || '';
    } catch {
      // ignore invalid URL
    }
  }
  if (!token) {
    const cookieHeader = typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined;
    const cookies = parseCookies(cookieHeader);
    token = cookies.__session || '';
  }
  if (!token) return null;

  try {
    const claims = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
    return claims.sub || null;
  } catch {
    return null;
  }
}

function requireClerkAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!CLERK_SECRET_KEY) {
    res.status(503).json({ error: 'Clerk authentication is not configured on the server.' });
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: 'Authentication required. Please sign in with Clerk.' });
    return;
  }
  next();
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

class PythonMcpBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private reqId = 0;
  private pending = new Map<number, PendingRpc>();
  public connected = false;
  public serverInfo: Record<string, unknown> = { name: 'local-voice-mcp', version: '1.0.0' };
  private queue: Promise<unknown> = Promise.resolve();

  async start(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) return;
    const serverScript = path.resolve(process.cwd(), 'backend', 'app', 'mcp', 'server.py');
    const venvPython = path.resolve(process.cwd(), 'backend', '.venv', 'bin', 'python3');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';
    const proc = spawn(pythonCmd, [serverScript], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: path.resolve(process.cwd(), 'backend') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof msg.id === 'number') {
          const item = this.pending.get(msg.id);
          if (item) {
            clearTimeout(item.timer);
            this.pending.delete(msg.id);
            if (msg.error) {
              item.reject(new Error(msg.error.message || 'MCP error'));
            } else {
              item.resolve(msg.result);
            }
          }
        }
      } catch (err) {
        console.error('[MCP Bridge] Failed to parse stdout line:', err);
      }
    });

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error('[MCP Python stderr]', text);
    });

    proc.on('exit', () => {
      this.connected = false;
      for (const [, item] of this.pending) {
        clearTimeout(item.timer);
        item.reject(new Error('MCP server exited'));
      }
      this.pending.clear();
    });

    const init = (await this.request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'localvox-node-bridge', version: '1.0.0' },
      capabilities: {},
    })) as { serverInfo?: Record<string, unknown> };
    if (init?.serverInfo) this.serverInfo = init.serverInfo;
    this.notify('notifications/initialized', {});
    this.connected = true;
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.proc || this.proc.exitCode !== null) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 10000): Promise<unknown> {
    const run = async () => {
      if (!this.proc || this.proc.exitCode !== null) {
        await this.start();
      }
      if (!this.proc) throw new Error('MCP server unavailable');
      const id = ++this.reqId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`MCP request '${method}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        this.proc!.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
        );
      });
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async listTools(): Promise<Array<Record<string, unknown>>> {
    const res = (await this.request('tools/list')) as { tools?: Array<Record<string, unknown>> };
    return res.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text: string }>;
    };
    const text = res.content?.[0]?.text;
    if (!text) return { ok: false, error: 'Empty MCP response' };
    return JSON.parse(text) as Record<string, unknown>;
  }

  async setToolEnabled(name: string, enabled: boolean): Promise<Record<string, unknown>> {
    return (await this.request('tools/set_enabled', { name, enabled })) as Record<string, unknown>;
  }

  async listResources(): Promise<Array<Record<string, unknown>>> {
    const res = (await this.request('resources/list')) as { resources?: Array<Record<string, unknown>> };
    return res.resources || [];
  }

  async readResource(uri: string): Promise<Record<string, unknown>> {
    const res = (await this.request('resources/read', { uri })) as {
      contents?: Array<Record<string, unknown>>;
    };
    return res.contents?.[0] || {};
  }

  async listPrompts(): Promise<Array<Record<string, unknown>>> {
    const res = (await this.request('prompts/list')) as { prompts?: Array<Record<string, unknown>> };
    return res.prompts || [];
  }

  async getPrompt(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return (await this.request('prompts/get', { name, arguments: args })) as Record<string, unknown>;
  }
}

const mcp = new PythonMcpBridge();

const runtimeConfig = {
  activeModel: process.env.LOCALVOX_LLM_MODEL || 'qwen3:1.7b',
  systemPrompt:
    'You are Aira, a helpful multilingual AI voice assistant. Speak naturally and concisely without markdown formatting clutter. Only invoke tools when memory, notes, files, system diagnostics, or calculations are genuinely needed.',
  sttModel: 'base',
  sttComputeType: 'int8',
  autoDetectLanguage: true,
  ttsEngine: 'piper',
  activeVoiceId: 'browser-default',
  voiceSpeed: 1.0,
  maxToolCallsPerTurn: 4,
};

async function checkOllamaStatus(): Promise<{
  reachable: boolean;
  url: string;
  active_model: string;
  models: Array<Record<string, unknown>>;
  error?: string;
}> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<Record<string, unknown>> };
    return {
      reachable: true,
      url: OLLAMA_URL,
      active_model: runtimeConfig.activeModel,
      models: (data.models || []).map((m) => ({
        name: m.name,
        size_bytes: m.size || 0,
        modified_at: m.modified_at,
        details: m.details || {},
      })),
    };
  } catch (err) {
    return {
      reachable: false,
      url: OLLAMA_URL,
      active_model: runtimeConfig.activeModel,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkFastApiStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${FASTAPI_URL}/api/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function synthesizePiperSpeech(
  text: string,
  responseLanguage: string,
  preferredVoiceId?: string
): Promise<{ wavBase64?: string; ttsMs: number }> {
  const t0 = performance.now();
  try {
    const voiceId =
      preferredVoiceId ||
      (runtimeConfig.activeVoiceId && runtimeConfig.activeVoiceId !== 'browser-default'
        ? runtimeConfig.activeVoiceId
        : undefined);
    const res = await fetch(`${FASTAPI_URL}/api/tts/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(6000),
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        response_language: responseLanguage,
        speed: runtimeConfig.voiceSpeed,
      }),
    });
    if (!res.ok) return { ttsMs: 0 };
    const data = (await res.json()) as { ok?: boolean; wav_base64?: string };
    if (data.ok && data.wav_base64) {
      return { wavBase64: data.wav_base64, ttsMs: Math.round(performance.now() - t0) };
    }
  } catch {
    // FastAPI or Piper voice unavailable; browser speechSynthesis handles playback
  }
  return { ttsMs: 0 };
}

function formatToolResultHuman(toolName: string, outcome: Record<string, unknown>): string {
  if (!outcome.ok) {
    return `I tried running ${toolName}, but it returned an error: ${outcome.error || 'Unknown error'}.`;
  }
  const r = (outcome.result || {}) as Record<string, unknown>;
  switch (toolName) {
    case 'save_memory':
      return `Got it. I saved that to your local memory under "${r.key}": ${r.content}.`;
    case 'search_memory': {
      const mems = (r.memories || []) as Array<{ key: string; content: string }>;
      if (!mems.length) return 'I searched your local memory, but nothing matched yet.';
      const top = mems.slice(0, 3).map((m) => `${m.key}: ${m.content}`).join('; ');
      return `I found ${mems.length} saved ${mems.length === 1 ? 'memory' : 'memories'}: ${top}.`;
    }
    case 'get_system_information': {
      const mem = (r.memory || {}) as Record<string, unknown>;
      const disk = (r.disk || {}) as Record<string, unknown>;
      return `This machine is running ${r.os} ${r.release} (${r.architecture}) with ${r.cpu_cores} CPU cores, ${mem.used_mb} MB of ${mem.total_mb} MB RAM used (${mem.percent_used}%), and ${disk.free_gb} GB free disk space.`;
    }
    case 'get_cpu_usage':
      return `Current CPU usage is ${r.cpu_percent}% across ${r.cpu_cores} cores.`;
    case 'get_memory_usage':
      return `RAM usage is ${r.used_mb} MB out of ${r.total_mb} MB (${r.percent_used}% used, ${r.available_mb} MB available).`;
    case 'get_disk_usage':
      return `Disk usage at ${r.path} is ${r.used_gb} GB used out of ${r.total_gb} GB, with ${r.free_gb} GB free.`;
    case 'get_running_processes': {
      const procs = (r.processes || []) as Array<{ name: string; pid: number }>;
      const names = procs.slice(0, 5).map((p) => `${p.name} (PID ${p.pid})`).join(', ');
      return `Top running processes right now include ${names}.`;
    }
    case 'get_current_date_time':
      return `The current local date and time is ${r.local_readable}.`;
    case 'perform_calculation':
      return `${r.expression} equals ${r.result}.`;
    case 'convert_units':
      return `${r.value} ${r.from_unit} is ${r.result} ${r.to_unit}.`;
    case 'create_note':
      return `I created a local note titled "${r.title}".`;
    case 'list_notes':
    case 'search_notes': {
      const notes = (r.notes || []) as Array<{ title: string; content: string }>;
      if (!notes.length) return 'You do not have any matching notes saved yet.';
      const preview = notes.slice(0, 3).map((n) => `"${n.title}": ${n.content}`).join('; ');
      return `You have ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}: ${preview}.`;
    }
    case 'create_todo':
      return `Added "${r.title}" to your local todo list with ${r.priority} priority.`;
    case 'list_todos': {
      const todos = (r.todos || []) as Array<{ id: number; title: string; status: string }>;
      if (!todos.length) return 'Your todo list is currently empty.';
      const preview = todos.slice(0, 4).map((t) => `#${t.id} ${t.title} (${t.status})`).join('; ');
      return `Here are your todos: ${preview}.`;
    }
    case 'update_todo_status':
      return `Updated task #${r.id} ("${r.title}") to ${r.todo_status}.`;
    case 'inspect_project_structure': {
      const dirs = (r.directories || []) as string[];
      const files = (r.files || []) as string[];
      return `Top-level project directories are ${dirs.join(', ') || 'none'}, and top-level files include ${files.slice(0, 8).join(', ')}.`;
    }
    case 'list_project_files':
    case 'search_local_files': {
      const files = (r.files || []) as Array<string | { path: string }>;
      if (!files.length) return 'No matching project files were found.';
      const paths = files.slice(0, 6).map((f) => (typeof f === 'string' ? f : f.path)).join(', ');
      return `Found ${r.count} files, including ${paths}.`;
    }
    case 'search_code': {
      const matches = (r.matches || []) as Array<{ file: string; line: number }>;
      if (!matches.length) return `No code matches found for "${r.pattern}".`;
      const summary = matches.slice(0, 4).map((m) => `${m.file}:${m.line}`).join(', ');
      return `Found ${r.count} matches for "${r.pattern}" in ${summary}.`;
    }
    case 'read_text_file':
      return `Read ${r.returned_lines} lines from ${r.path} (total ${r.total_lines} lines). First snippet: ${String(r.content || '').slice(0, 180).replace(/\s+/g, ' ')}`;
    case 'summarize_text':
      return `Summary: ${r.summary}`;
    default:
      return JSON.stringify(r);
  }
}

interface IntentPlan {
  tool?: string;
  args?: Record<string, unknown>;
  directReply?: string;
}

function planLocalMcpIntent(userText: string, responseLang: string): IntentPlan {
  const raw = userText.trim();
  const lower = raw.toLowerCase();

  // Memory save
  const memSaveMatch = raw.match(/^(?:remember|save(?: a)? memory|don't forget|keep in mind)(?:\s+that)?\s+(.+)$/i);
  if (memSaveMatch) {
    const content = memSaveMatch[1].trim();
    const key = content.split(/\s+/).slice(0, 4).join('_').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'user_note';
    return { tool: 'save_memory', args: { key, content, category: 'preference', importance: 4 } };
  }

  // Memory recall / search
  if (/(?:what did i (?:say|tell you)|search (?:my )?memor|recall|what do you remember|my memories)/i.test(lower)) {
    const qMatch = raw.match(/(?:about|for)\s+(.+)$/i);
    return { tool: 'search_memory', args: { query: qMatch ? qMatch[1].replace(/[?.!]+$/, '') : '', limit: 10 } };
  }

  // Notes & todos
  const createNoteMatch = raw.match(/^(?:create|add|take|save)\s+(?:a\s+)?note(?:\s+(?:titled|called|about))?\s*:?\s*(.+)$/i);
  if (createNoteMatch) {
    const body = createNoteMatch[1].trim();
    const colonIdx = body.indexOf(':');
    const title = colonIdx > 0 ? body.slice(0, colonIdx).trim() : body.split(/\s+/).slice(0, 5).join(' ');
    const content = colonIdx > 0 ? body.slice(colonIdx + 1).trim() : body;
    return { tool: 'create_note', args: { title: title || 'Voice Note', content: content || body } };
  }
  if (/(?:list|show|read|what are)\s+(?:my\s+)?notes/i.test(lower)) {
    return { tool: 'list_notes', args: { limit: 10 } };
  }
  const searchNoteMatch = raw.match(/search\s+notes\s+(?:for\s+)?(.+)$/i);
  if (searchNoteMatch) {
    return { tool: 'search_notes', args: { query: searchNoteMatch[1].replace(/[?.!]+$/, '') } };
  }

  const addTodoMatch = raw.match(/^(?:add|create)\s+(?:a\s+)?(?:todo|task)\s*:?\s*(.+)$/i);
  if (addTodoMatch) {
    return { tool: 'create_todo', args: { title: addTodoMatch[1].trim(), priority: 'medium' } };
  }
  if (/(?:list|show|what are)\s+(?:my\s+)?(?:todos|tasks)/i.test(lower)) {
    return { tool: 'list_todos', args: { limit: 20 } };
  }
  const doneTodoMatch = raw.match(/(?:complete|finish|mark done)\s+(?:todo|task)\s*#?(\d+)/i);
  if (doneTodoMatch) {
    return { tool: 'update_todo_status', args: { todo_id: Number(doneTodoMatch[1]), status: 'completed' } };
  }

  // System diagnostics
  if (/(?:cpu|processor)/i.test(lower) && /(?:ram|memory)/i.test(lower)) {
    return { tool: 'get_system_information', args: {} };
  }
  if (/(?:cpu usage|processor usage|how busy is the cpu)/i.test(lower)) {
    return { tool: 'get_cpu_usage', args: {} };
  }
  if (/(?:ram usage|memory usage|how much ram|how much memory)/i.test(lower)) {
    return { tool: 'get_memory_usage', args: {} };
  }
  if (/(?:disk usage|disk space|storage space|free space)/i.test(lower)) {
    return { tool: 'get_disk_usage', args: { path: '.' } };
  }
  if (/(?:running processes|active processes|top processes)/i.test(lower)) {
    return { tool: 'get_running_processes', args: { limit: 8 } };
  }
  if (/(?:system info|system information|hardware specs|machine status)/i.test(lower)) {
    return { tool: 'get_system_information', args: {} };
  }

  // Local files
  if (/(?:project structure|workspace structure|top level files)/i.test(lower)) {
    return { tool: 'inspect_project_structure', args: { directory: '.' } };
  }
  if (/(?:list project files|list files|show files)/i.test(lower)) {
    return { tool: 'list_project_files', args: { directory: '.', max_depth: 3 } };
  }
  const searchFilesMatch = raw.match(/(?:search|find)\s+(?:local\s+)?files\s+(?:for|named|matching)?\s*(.+)$/i);
  if (searchFilesMatch) {
    return { tool: 'search_local_files', args: { query: searchFilesMatch[1].replace(/[?.!]+$/, ''), limit: 15 } };
  }
  const searchCodeMatch = raw.match(/search\s+code\s+(?:for\s+)?(.+)$/i);
  if (searchCodeMatch) {
    return { tool: 'search_code', args: { pattern: searchCodeMatch[1].replace(/[?.!]+$/, ''), max_results: 15 } };
  }
  const readFileMatch = raw.match(/(?:read|inspect|open)\s+(?:file\s+)?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)$/i);
  if (readFileMatch) {
    return { tool: 'read_text_file', args: { file_path: readFileMatch[1], max_lines: 60 } };
  }

  // Date & Time
  if (/(?:what time|current time|what date|today's date|date and time)/i.test(lower)) {
    return { tool: 'get_current_date_time', args: {} };
  }

  // Unit conversion
  const convMatch = raw.match(/convert\s+([-+]?\d*\.?\d+)\s+([a-zA-Z]+)\s+(?:to|in)\s+([a-zA-Z]+)/i);
  if (convMatch) {
    return {
      tool: 'convert_units',
      args: { value: Number(convMatch[1]), from_unit: convMatch[2], to_unit: convMatch[3] },
    };
  }

  // Math calculation
  const calcMatch = raw.match(/^(?:calculate|compute|what is|evaluate)\s+([0-9+\-*/().^\s%sqrtincoagl]+)\??$/i);
  if (calcMatch) {
    return { tool: 'perform_calculation', args: { expression: calcMatch[1].trim() } };
  }
  if (/^[0-9+\-*/().^\s]+$/.test(raw)) {
    return { tool: 'perform_calculation', args: { expression: raw } };
  }

  // Summarize text
  const sumMatch = raw.match(/^summarize(?:\s+this)?\s*:\s*(.+)$/is);
  if (sumMatch) {
    return { tool: 'summarize_text', args: { text: sumMatch[1].trim(), max_sentences: 3 } };
  }

  // Multilingual greeting / status direct reply (no unnecessary MCP call!)
  const greetings: Record<string, string> = {
    ta: 'வணக்கம்! நான் உங்கள் உள்ளூர் குரல் உதவியாளர். நினைவகம், குறிப்புகள், கணினி தகவல் அல்லது கோப்பு தேடலுக்கு என்னிடம் கேட்கலாம்.',
    hi: 'नमस्ते! मैं आपका स्थानीय वॉयस असिस्टेंट हूँ। आप मुझसे मेमोरी, नोट्स, सिस्टम जानकारी या गणना के बारे में पूछ सकते हैं।',
    te: 'నమస్కారం! నేను మీ లోకల్ వాయిస్ అసిస్టెంట్‌ని. మెమరీ, నోట్స్ లేదా సిస్టమ్ సమాచారం కోసం నన్ను అడగండి.',
    ml: 'നമസ്കാരം! ഞാൻ നിങ്ങളുടെ ലോക്കൽ വോയ്‌സ് അസിസ്റ്റന്റാണ്. മെമ്മറി, നോട്ടുകൾ, അല്ലെങ്കിൽ സിസ്റ്റം വിവരങ്ങൾ എന്നോട് ചോദിക്കാം.',
    kn: 'ನಮಸ್ಕಾರ! ನಾನು ನಿಮ್ಮ ಸ್ಥಳೀಯ ವಾಯ್ಸ್ ಅಸಿಸ್ಟೆಂಟ್. ಮೆಮೊರಿ, ನೋಟ್ಸ್ ಅಥವಾ ಸಿಸ್ಟಮ್ ಮಾಹಿತಿಗಾಗಿ ಕೇಳಿ.',
    es: 'Hola, soy tu asistente de voz local. Puedo guardar recuerdos, tomar notas, revisar el sistema o calcular valores localmente.',
    fr: 'Bonjour, je suis votre assistant vocal local. Je peux enregistrer des souvenirs, créer des notes, vérifier le système ou faire des calculs localement.',
  };
  if (/^(hi|hello|hey|vanakkam|namaste|hola|bonjour)\b/i.test(lower)) {
    return {
      directReply:
        greetings[responseLang] ||
        'Hello! I am Aira, your voice assistant. Ask me to remember something, check CPU or RAM usage, inspect project files, take a note, or solve math.',
    };
  }

  return {
    directReply:
      'No generative LLM is connected yet (Ollama is offline and LLM_API_URL is unset). Meanwhile, I can help with CPU or RAM usage, current time, math calculations, saving memories, creating notes, or searching project files.',
  };
}

async function mirrorToolOutcomeToSupabase(
  userId: string | undefined,
  conversationId: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
  outcomeOk: boolean
): Promise<void> {
  if (!userId || !outcomeOk) return;
  try {
    const sbStatus = await checkSupabaseStatus();
    if (!sbStatus.tables_ready) return;
    if (toolName === 'save_memory') {
      await saveSupabaseMemory(userId, {
        key: String(toolArgs.key || ''),
        content: String(toolArgs.content || ''),
        category: typeof toolArgs.category === 'string' ? toolArgs.category : 'general',
        importance: typeof toolArgs.importance === 'number' ? toolArgs.importance : 3,
        source_conversation_id: conversationId,
      });
    } else if (toolName === 'create_note') {
      await createSupabaseNote(userId, {
        title: String(toolArgs.title || ''),
        content: String(toolArgs.content || ''),
        tags: Array.isArray(toolArgs.tags) ? (toolArgs.tags as string[]) : [],
      });
    } else if (toolName === 'create_todo') {
      await createSupabaseTodo(userId, {
        title: String(toolArgs.title || ''),
        priority: typeof toolArgs.priority === 'string' ? toolArgs.priority : 'medium',
        due_date: typeof toolArgs.due_date === 'string' ? toolArgs.due_date : null,
      });
    }
  } catch {
    // Non-fatal background Supabase sync
  }
}

async function runAssistantTurn(params: {
  conversationId: string;
  userId?: string;
  userText: string;
  sttLanguage: string;
  responseLanguage: string;
  preferredVoiceId?: string;
  sttMs?: number;
  ws: WebSocket;
  signal: AbortSignal;
}): Promise<void> {
  const { conversationId, userId, userText, sttLanguage, responseLanguage, preferredVoiceId, sttMs = 0, ws, signal } = params;
  const turnStart = performance.now();

  const send = (payload: Record<string, unknown>) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  await mcp.request('db/append_message', {
    conversation_id: conversationId,
    role: 'user',
    content: userText,
    language: sttLanguage,
  });

  if (userId) {
    const sbStatus = await checkSupabaseStatus().catch(() => null);
    if (sbStatus?.tables_ready) {
      await appendSupabaseMessage(userId, {
        conversation_id: conversationId,
        role: 'user',
        content: userText,
        language: sttLanguage,
      }).catch(() => {});
    }
  }

  send({ type: 'state', state: 'THINKING', conversation_id: conversationId });

  const ollamaStatus = await checkOllamaStatus();
  const toolRecords: Array<Record<string, unknown>> = [];
  let llmFirstTokenMs = 0;
  let llmTotalMs = 0;
  let mcpToolMs = 0;
  let finalText = '';
  let engineMode = 'local-mcp-router';

  if (ollamaStatus.reachable && ollamaStatus.models.length > 0) {
    engineMode = 'ollama';
    const toolsMeta = await mcp.listTools();
    const enabledTools = toolsMeta.filter((t) => t.enabled);
    const ollamaTools = enabledTools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const memRes = await mcp.callTool('search_memory', { query: '', limit: 5 });
    const memories = ((memRes.result as { memories?: Array<{ key: string; content: string }> })?.memories || []);
    const memPrompt = memories.length
      ? `\nSaved user memories:\n${memories.map((m) => `- ${m.key}: ${m.content}`).join('\n')}`
      : '';

    const histRes = await mcp.callTool('retrieve_conversation_history', {
      conversation_id: conversationId,
      limit: 10,
    });
    const histMsgs = ((histRes.result as { messages?: Array<{ role: string; content: string }> })?.messages || []);

    const chatMessages: Array<Record<string, unknown>> = [
      {
        role: 'system',
        content: `${runtimeConfig.systemPrompt}\nRespond in language '${responseLanguage}'.${memPrompt}`,
      },
      ...histMsgs.map((m) => ({ role: m.role, content: m.content })),
    ];

    for (let step = 0; step <= runtimeConfig.maxToolCallsPerTurn; step++) {
      if (signal.aborted) break;
      const llmStart = performance.now();
      let gotFirstToken = false;
      let stepContent = '';
      const pendingCalls: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }> = [];

      const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: runtimeConfig.activeModel,
          messages: chatMessages,
          tools: step < runtimeConfig.maxToolCallsPerTurn ? ollamaTools : undefined,
          stream: true,
          options: { temperature: 0.4, num_ctx: 4096 },
        }),
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`Ollama returned HTTP ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        if (signal.aborted) {
          await reader.cancel();
          break;
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as {
            message?: {
              content?: string;
              tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>;
            };
          };
          const delta = chunk.message?.content || '';
          if (delta) {
            if (!gotFirstToken) {
              llmFirstTokenMs = performance.now() - llmStart;
              gotFirstToken = true;
            }
            stepContent += delta;
            send({ type: 'assistant_token', delta });
          }
          if (chunk.message?.tool_calls?.length) {
            pendingCalls.push(...chunk.message.tool_calls);
          }
        }
      }
      llmTotalMs += performance.now() - llmStart;

      if (!pendingCalls.length) {
        finalText = stepContent.trim();
        break;
      }

      chatMessages.push({
        role: 'assistant',
        content: stepContent,
        tool_calls: pendingCalls,
      });

      for (const call of pendingCalls) {
        if (signal.aborted) break;
        const toolName = call.function?.name || '';
        const toolArgs = call.function?.arguments || {};
        send({ type: 'state', state: 'TOOL_EXECUTING', tool: toolName, arguments: toolArgs });

        const t0 = performance.now();
        const outcome = await mcp.callTool(toolName, toolArgs);
        const dur = performance.now() - t0;
        mcpToolMs += dur;
        toolRecords.push({
          tool_name: toolName,
          arguments: toolArgs,
          result: outcome.result || null,
          error: outcome.error || null,
          duration_ms: Math.round(dur * 10) / 10,
          status: outcome.ok ? 'success' : 'error',
        });
        chatMessages.push({
          role: 'tool',
          content: JSON.stringify(outcome.result || outcome.error || {}),
        });
      }

      send({ type: 'state', state: 'THINKING', conversation_id: conversationId });
    }
  } else if (LLM_API_URL) {
    engineMode = 'openai-compat';
    const toolsMeta = await mcp.listTools();
    const enabledTools = toolsMeta.filter((t) => t.enabled);
    const compatTools = enabledTools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const sbStatus = userId ? await checkSupabaseStatus().catch(() => null) : null;
    const memories =
      sbStatus?.tables_ready && userId
        ? await searchSupabaseMemories(userId, 5)
        : ((
            (await mcp.callTool('search_memory', { query: '', limit: 5 })).result as {
              memories?: Array<{ key: string; content: string }>;
            }
          )?.memories || []);
    const memPrompt = memories.length
      ? `\nSaved user memories:\n${memories.map((m) => `- ${m.key}: ${m.content}`).join('\n')}`
      : '';

    const histMsgs =
      sbStatus?.tables_ready && userId
        ? ((await getSupabaseConversationMessages(userId, conversationId, 10)) as Array<{
            role: string;
            content: string;
          }>)
        : ((
            (
              await mcp.callTool('retrieve_conversation_history', {
                conversation_id: conversationId,
                limit: 10,
              })
            ).result as { messages?: Array<{ role: string; content: string }> }
          )?.messages || []);

    const chatMessages: Array<Record<string, unknown>> = [
      {
        role: 'system',
        content: `${runtimeConfig.systemPrompt}\nRespond in language '${responseLanguage}'.${memPrompt}`,
      },
      ...histMsgs.map((m) => ({ role: m.role, content: m.content })),
    ];

    const endpoint = LLM_API_URL.endsWith('/chat/completions')
      ? LLM_API_URL
      : `${LLM_API_URL}/chat/completions`;

    for (let step = 0; step <= runtimeConfig.maxToolCallsPerTurn; step++) {
      if (signal.aborted) break;
      const llmStart = performance.now();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (LLM_API_KEY) headers.Authorization = `Bearer ${LLM_API_KEY}`;

      let resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: LLM_API_MODEL,
          messages: chatMessages,
          tools: step < runtimeConfig.maxToolCallsPerTurn ? compatTools : undefined,
          temperature: 0.4,
        }),
      });
      if (resp.status === 400 && step < runtimeConfig.maxToolCallsPerTurn) {
        // Retry without tool schemas if provider (e.g. Groq Llama 3.1 8B) rejects tool formatting
        resp = await fetch(endpoint, {
          method: 'POST',
          headers,
          signal,
          body: JSON.stringify({
            model: LLM_API_MODEL,
            messages: chatMessages,
            temperature: 0.4,
          }),
        });
      }
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`LLM endpoint returned HTTP ${resp.status}${errBody ? `: ${errBody.slice(0, 160)}` : ''}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string | Record<string, unknown> };
            }>;
          };
        }>;
      };
      const elapsed = performance.now() - llmStart;
      if (llmFirstTokenMs === 0) llmFirstTokenMs = elapsed;
      llmTotalMs += elapsed;

      const choiceMsg = data.choices?.[0]?.message;
      const pendingCalls = choiceMsg?.tool_calls || [];
      const content = (choiceMsg?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      if (!pendingCalls.length) {
        finalText = content || 'Done.';
        send({ type: 'assistant_token', delta: finalText });
        break;
      }

      chatMessages.push({
        role: 'assistant',
        content: choiceMsg?.content || null,
        tool_calls: pendingCalls,
      });

      for (const call of pendingCalls) {
        if (signal.aborted) break;
        const toolName = call.function?.name || '';
        let toolArgs: Record<string, unknown> = {};
        if (typeof call.function?.arguments === 'string') {
          try {
            toolArgs = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            toolArgs = {};
          }
        } else if (call.function?.arguments && typeof call.function.arguments === 'object') {
          toolArgs = call.function.arguments;
        }
        send({ type: 'state', state: 'TOOL_EXECUTING', tool: toolName, arguments: toolArgs });

        const t0 = performance.now();
        const outcome = await mcp.callTool(toolName, toolArgs);
        const dur = performance.now() - t0;
        mcpToolMs += dur;
        await mirrorToolOutcomeToSupabase(userId, conversationId, toolName, toolArgs, Boolean(outcome.ok));
        toolRecords.push({
          tool_name: toolName,
          arguments: toolArgs,
          result: outcome.result || null,
          error: outcome.error || null,
          duration_ms: Math.round(dur * 10) / 10,
          status: outcome.ok ? 'success' : 'error',
        });
        chatMessages.push({
          role: 'tool',
          tool_call_id: call.id || toolName,
          content: JSON.stringify(outcome.result || outcome.error || {}),
        });
      }

      send({ type: 'state', state: 'THINKING', conversation_id: conversationId });
    }
  } else {
    // Deterministic Local MCP Router when Ollama & LLM_API_URL are not running
    const planStart = performance.now();
    const plan = planLocalMcpIntent(userText, responseLanguage);
    llmFirstTokenMs = performance.now() - planStart;

    if (plan.tool) {
      send({
        type: 'state',
        state: 'TOOL_EXECUTING',
        tool: plan.tool,
        arguments: plan.args || {},
      });
      const t0 = performance.now();
      const outcome = await mcp.callTool(plan.tool, plan.args || {});
      const dur = performance.now() - t0;
      mcpToolMs += dur;
      await mirrorToolOutcomeToSupabase(
        userId,
        conversationId,
        plan.tool,
        (plan.args || {}) as Record<string, unknown>,
        Boolean(outcome.ok)
      );
      toolRecords.push({
        tool_name: plan.tool,
        arguments: plan.args || {},
        result: outcome.result || null,
        error: outcome.error || null,
        duration_ms: Math.round(dur * 10) / 10,
        status: outcome.ok ? 'success' : 'error',
      });
      finalText = formatToolResultHuman(plan.tool, outcome);
    } else {
      finalText = plan.directReply || 'Ready.';
    }
    llmTotalMs = performance.now() - planStart;
    send({ type: 'assistant_token', delta: finalText });
  }

  if (signal.aborted) {
    send({ type: 'state', state: 'INTERRUPTED' });
    return;
  }

  const piperTts = await synthesizePiperSpeech(finalText, responseLanguage, preferredVoiceId);
  const totalMs = sttMs + (performance.now() - turnStart);
  const metrics = {
    stt_ms: Math.round(sttMs * 10) / 10,
    llm_first_token_ms: Math.round(llmFirstTokenMs * 10) / 10,
    llm_total_ms: Math.round(llmTotalMs * 10) / 10,
    mcp_tool_ms: Math.round(mcpToolMs * 10) / 10,
    tts_ms: piperTts.ttsMs,
    total_ms: Math.round(totalMs * 10) / 10,
    tool_calls_count: toolRecords.length,
  };

  await mcp.request('db/append_message', {
    conversation_id: conversationId,
    role: 'assistant',
    content: finalText,
    language: responseLanguage,
    tool_calls: toolRecords,
    metrics,
  });

  if (userId) {
    const sbStatus = await checkSupabaseStatus().catch(() => null);
    if (sbStatus?.tables_ready) {
      await appendSupabaseMessage(userId, {
        conversation_id: conversationId,
        role: 'assistant',
        content: finalText,
        language: responseLanguage,
        tool_calls: toolRecords,
        metrics,
      }).catch(() => {});
    }
  }

  send({ type: 'state', state: 'SPEAKING', language: responseLanguage });
  send({
    type: 'assistant_done',
    conversation_id: conversationId,
    text: finalText,
    language: responseLanguage,
    engine_mode: engineMode,
    audio_wav_base64: piperTts.wavBase64 || null,
    tool_calls: toolRecords,
    metrics,
  });
}

async function ensureFastApiRunning(): Promise<void> {
  const isUp = await checkFastApiStatus();
  if (isUp) return;
  const venvPython = path.resolve(process.cwd(), 'backend', '.venv', 'bin', 'python3');
  const backendDir = path.resolve(process.cwd(), 'backend');
  if (fs.existsSync(venvPython)) {
    console.log('[LocalVox] Auto-launching Python FastAPI backend on http://127.0.0.1:8000...');
    const fastProc = spawn(venvPython, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'], {
      cwd: backendDir,
      env: { ...process.env, PYTHONPATH: backendDir },
      stdio: 'ignore',
      detached: true,
    });
    fastProc.unref();
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await checkFastApiStatus()) {
        console.log('[LocalVox] Python FastAPI backend is ready!');
        break;
      }
    }
  }
}

async function bootstrap() {
  await ensureFastApiRunning();
  await mcp.start();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  if (CLERK_SECRET_KEY && CLERK_PUBLISHABLE_KEY) {
    app.use(
      '/api',
      clerkMiddleware({
        publishableKey: CLERK_PUBLISHABLE_KEY,
        secretKey: CLERK_SECRET_KEY,
      })
    );
  }

  app.get('/api/health', async (_req, res) => {
    const [fastapiUp, sbStatus] = await Promise.all([
      checkFastApiStatus(),
      checkSupabaseStatus(),
    ]);
    res.json({
      status: 'ok',
      assistant: 'Aira',
      auth_provider: 'clerk',
      clerk_configured: Boolean(CLERK_SECRET_KEY && CLERK_PUBLISHABLE_KEY),
      supabase_configured: sbStatus.configured,
      supabase_ready: sbStatus.tables_ready,
      fastapi_bridge: fastapiUp,
      llm_compat_configured: Boolean(LLM_API_URL),
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const auth = CLERK_SECRET_KEY ? getAuth(req) : null;
    res.json({
      authenticated: Boolean(auth?.userId),
      userId: auth?.userId || null,
    });
  });

  app.use('/api/mcp', requireClerkAuth);
  app.use('/api/models', requireClerkAuth);
  app.use('/api/voices', requireClerkAuth);
  app.use('/api/data', requireClerkAuth);
  app.use('/api/conversations', requireClerkAuth);

  app.get('/api/mcp/status', async (_req, res) => {
    try {
      const [tools, resources, prompts, dbMeta] = await Promise.all([
        mcp.listTools(),
        mcp.listResources(),
        mcp.listPrompts(),
        mcp.request('db/list_conversations') as Promise<{ logs?: unknown[]; conversations?: unknown[] }>,
      ]);
      res.json({
        connected: mcp.connected,
        transport: 'stdio',
        server: mcp.serverInfo,
        tools,
        resources,
        prompts,
        history: dbMeta.logs || [],
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/tools/:toolName/toggle', async (req, res) => {
    try {
      const result = await mcp.setToolEnabled(req.params.toolName, Boolean(req.body?.enabled));
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/tools/:toolName/execute', async (req, res) => {
    try {
      const outcome = await mcp.callTool(req.params.toolName, req.body?.arguments || {});
      res.json(outcome);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/mcp/resources/read', async (req, res) => {
    try {
      const uri = String(req.query.uri || '');
      const content = await mcp.readResource(uri);
      res.json(content);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/mcp/prompts/:name', async (req, res) => {
    try {
      const prompt = await mcp.getPrompt(req.params.name, req.body?.arguments || {});
      res.json(prompt);
    } catch (err) {
      res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/models/status', async (_req, res) => {
    try {
      const [ollama, sysOutcome, cpuOutcome, memOutcome, diskOutcome, voicesRes, langsRes, fastapiUp] =
        await Promise.all([
          checkOllamaStatus(),
          mcp.callTool('get_system_information'),
          mcp.callTool('get_cpu_usage'),
          mcp.callTool('get_memory_usage'),
          mcp.callTool('get_disk_usage'),
          mcp.readResource('localvox://voices/tts'),
          mcp.readResource('localvox://config/languages'),
          checkFastApiStatus(),
        ]);

      const voicesParsed = voicesRes.text ? JSON.parse(String(voicesRes.text)) : { installed_voices: [] };
      const langsParsed = langsRes.text ? JSON.parse(String(langsRes.text)) : { languages: [] };

      res.json({
        llm: {
          ...ollama,
          cloud_configured: Boolean(LLM_API_URL),
          cloud_model: LLM_API_URL ? LLM_API_MODEL : null,
          system_prompt: runtimeConfig.systemPrompt,
          recommended_models: [
            { name: 'qwen3:1.7b', size_label: '~1.4 GB Q4_K_M', tool_calling: 'Native', ram_fit: '8 GB CPU OK' },
            { name: 'gemma3:1b', size_label: '~0.9 GB Q4_K_M', tool_calling: 'Prompt Fallback', ram_fit: '8 GB CPU Fast' },
            { name: 'qwen2.5:3b', size_label: '~2.0 GB Q4_K_M', tool_calling: 'Native', ram_fit: '8 GB CPU Tight' },
          ],
        },
        stt: {
          engine: 'faster-whisper',
          model_size: runtimeConfig.sttModel,
          compute_type: runtimeConfig.sttComputeType,
          auto_detect_language: runtimeConfig.autoDetectLanguage,
          vad_engine: 'silero-vad / Web Audio RMS VAD',
          fastapi_stt_active: fastapiUp,
        },
        tts: {
          engine: runtimeConfig.ttsEngine,
          installed_piper_voices: voicesParsed.installed_voices || [],
          active_voice_id: runtimeConfig.activeVoiceId,
          speed: runtimeConfig.voiceSpeed,
          fastapi_tts_active: fastapiUp,
        },
        languages: langsParsed.languages || [],
        system: {
          ...(sysOutcome.result as Record<string, unknown> || {}),
          cpu: cpuOutcome.result || {},
          memory: memOutcome.result || {},
          disk: diskOutcome.result || {},
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/models/select', (req, res) => {
    if (typeof req.body?.model === 'string' && req.body.model.trim()) {
      runtimeConfig.activeModel = req.body.model.trim();
    }
    if (typeof req.body?.system_prompt === 'string') {
      runtimeConfig.systemPrompt = req.body.system_prompt;
    }
    if (typeof req.body?.stt_model === 'string') {
      runtimeConfig.sttModel = req.body.stt_model;
    }
    if (typeof req.body?.auto_detect_language === 'boolean') {
      runtimeConfig.autoDetectLanguage = req.body.auto_detect_language;
    }
    res.json({ ok: true, config: runtimeConfig });
  });

  app.post('/api/models/test-tools', async (req, res) => {
    const model = String(req.body?.model || runtimeConfig.activeModel);
    const t0 = performance.now();
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: 'user', content: 'What is the current local date and time? Call the tool.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: 'get_current_date_time',
                description: 'Get current local date and time.',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        }),
      });
      if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
      const data = (await resp.json()) as { message?: { tool_calls?: unknown[] } };
      const calls = data.message?.tool_calls || [];
      res.json({
        model,
        reachable: true,
        native_tool_calling: calls.length > 0,
        tool_calls: calls,
        latency_ms: Math.round((performance.now() - t0) * 10) / 10,
      });
    } catch (err) {
      res.json({
        model,
        reachable: false,
        native_tool_calling: false,
        error: err instanceof Error ? err.message : String(err),
        latency_ms: Math.round((performance.now() - t0) * 10) / 10,
      });
    }
  });

  app.post('/api/voices/config', (req, res) => {
    if (typeof req.body?.voice_id === 'string') {
      runtimeConfig.activeVoiceId = req.body.voice_id;
    }
    if (typeof req.body?.speed === 'number') {
      runtimeConfig.voiceSpeed = Math.max(0.5, Math.min(2.0, req.body.speed));
    }
    res.json({ ok: true, voice_id: runtimeConfig.activeVoiceId, speed: runtimeConfig.voiceSpeed });
  });

  app.get('/api/data/overview', async (req, res) => {
    try {
      const userId = getAuth(req).userId || '';
      const forceCheck = req.query.refresh === '1';
      const sbStatus = await checkSupabaseStatus(forceCheck);

      if (sbStatus.tables_ready && userId) {
        const sbData = await getSupabaseOverview(userId);
        res.json({
          ...sbData,
          storage_backend: 'supabase',
          supabase: sbStatus,
        });
        return;
      }

      const [memRes, noteRes, todoRes, dbMeta] = await Promise.all([
        mcp.callTool('search_memory', { query: '', limit: 50 }),
        mcp.callTool('list_notes', { limit: 50 }),
        mcp.callTool('list_todos', { limit: 50 }),
        mcp.request('db/list_conversations') as Promise<{ conversations?: unknown[] }>,
      ]);
      res.json({
        memories: (memRes.result as { memories?: unknown[] })?.memories || [],
        notes: (noteRes.result as { notes?: unknown[] })?.notes || [],
        todos: (todoRes.result as { todos?: unknown[] })?.todos || [],
        conversations: dbMeta.conversations || [],
        storage_backend: 'sqlite',
        supabase: {
          ...sbStatus,
          setup_sql: sbStatus.configured && !sbStatus.tables_ready ? getSupabaseSchemaSql() : null,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/conversations/:id/messages', async (req, res) => {
    try {
      const userId = getAuth(req).userId || '';
      const sbStatus = await checkSupabaseStatus();
      if (sbStatus.tables_ready && userId) {
        const messages = await getSupabaseConversationMessages(userId, req.params.id, 50);
        res.json({ messages });
        return;
      }
      const hist = await mcp.callTool('retrieve_conversation_history', {
        conversation_id: req.params.id,
        limit: 50,
      });
      res.json(hist.result || { messages: [] });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.delete('/api/conversations/:id', async (req, res) => {
    if (req.query.confirmed !== 'true') {
      res.status(400).json({ error: 'Explicit confirmation required before deleting conversation.' });
      return;
    }
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const result = await deleteSupabaseConversation(userId, req.params.id);
      res.status(result.ok ? 200 : 400).json(result);
      return;
    }
    const result = await mcp.request('db/delete_conversation', { conversation_id: req.params.id });
    res.json(result);
  });

  app.post('/api/data/memories', async (req, res) => {
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const out = await saveSupabaseMemory(userId, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }
    const out = await mcp.callTool('save_memory', req.body || {});
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.delete('/api/data/memories/:id', async (req, res) => {
    if (req.query.confirmed !== 'true') {
      res.status(400).json({ error: 'Explicit confirmation required before deleting memory.' });
      return;
    }
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const out = await deleteSupabaseMemory(userId, Number(req.params.id));
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }
    const out = await mcp.callTool('delete_memory', {
      memory_id: Number(req.params.id),
      confirmed: true,
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.post('/api/data/notes', async (req, res) => {
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const out = await createSupabaseNote(userId, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }
    const out = await mcp.callTool('create_note', req.body || {});
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.delete('/api/data/notes/:id', async (req, res) => {
    if (req.query.confirmed !== 'true') {
      res.status(400).json({ error: 'Explicit confirmation required before deleting note.' });
      return;
    }
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const out = await deleteSupabaseNote(userId, Number(req.params.id));
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }
    const out = await mcp.callTool('delete_note', {
      note_id: Number(req.params.id),
      confirmed: true,
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.post('/api/data/todos', async (req, res) => {
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const out = await createSupabaseTodo(userId, req.body || {});
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }
    const out = await mcp.callTool('create_todo', req.body || {});
    res.status(out.ok ? 200 : 400).json(out);
  });

  app.patch('/api/data/todos/:id', async (req, res) => {
    const userId = getAuth(req).userId || '';
    const sbStatus = await checkSupabaseStatus();
    if (sbStatus.tables_ready && userId) {
      const out = await updateSupabaseTodoStatus(userId, Number(req.params.id), req.body?.status);
      res.status(out.ok ? 200 : 400).json(out);
      return;
    }
    const out = await mcp.callTool('update_todo_status', {
      todo_id: Number(req.params.id),
      status: req.body?.status,
    });
    res.status(out.ok ? 200 : 400).json(out);
  });

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws/voice' });

  wss.on('connection', async (ws, req) => {
    const clerkUserId = await verifyWsClerkToken({
      headers: req.headers as Record<string, string | string[] | undefined>,
      url: req.url,
    });
    if (!clerkUserId) {
      ws.send(JSON.stringify({ type: 'auth_error', error: 'Unauthorized' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    let currentAbort: AbortController | null = null;
    const defaultConvId = `session-${Date.now()}`;
    ws.send(JSON.stringify({ type: 'state', state: 'IDLE', conversation_id: defaultConvId }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const mtype = String(msg.type || '');

        if (mtype === 'interrupt') {
          if (currentAbort) {
            currentAbort.abort();
            currentAbort = null;
          }
          ws.send(JSON.stringify({ type: 'state', state: 'INTERRUPTED' }));
          return;
        }

        if (mtype === 'audio_utterance') {
          const wavBase64 = String(msg.wav_base64 || '');
          const sttLang = String(msg.stt_language || 'auto');
          const respLang = String(msg.response_language || 'en');
          const convId = String(msg.conversation_id || defaultConvId);
          if (!wavBase64) return;

          ws.send(JSON.stringify({ type: 'state', state: 'TRANSCRIBING' }));
          try {
            const sttRes = await fetch(`${FASTAPI_URL}/api/stt/transcribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(15000),
              body: JSON.stringify({ wav_base64: wavBase64, language: sttLang }),
            });
            if (!sttRes.ok) throw new Error(`FastAPI STT returned HTTP ${sttRes.status}`);
            const sttJson = (await sttRes.json()) as {
              text?: string;
              language?: string;
              duration_ms?: number;
            };
            const transcript = String(sttJson.text || '').trim();
            if (!transcript) {
              ws.send(JSON.stringify({ type: 'state', state: 'LISTENING' }));
              return;
            }
            ws.send(
              JSON.stringify({
                type: 'transcript',
                text: transcript,
                language: sttJson.language || 'en',
                stt_ms: sttJson.duration_ms || 0,
              })
            );

            if (currentAbort) currentAbort.abort();
            currentAbort = new AbortController();
            await runAssistantTurn({
              conversationId: convId,
              userId: clerkUserId,
              userText: transcript,
              sttLanguage: sttJson.language || 'en',
              responseLanguage: respLang,
              preferredVoiceId: typeof msg.voice_id === 'string' ? msg.voice_id : undefined,
              sttMs: Number(sttJson.duration_ms || 0),
              ws,
              signal: currentAbort.signal,
            });
          } catch {
            ws.send(
              JSON.stringify({
                type: 'stt_notice',
                message:
                  'Live speech audio was captured by VAD, but offline FastAPI faster-whisper (port 8000) is not running and browser SpeechRecognition returned no transcript. Use Chrome/Edge online STT, start FastAPI faster-whisper locally, or type below.',
              })
            );
            ws.send(JSON.stringify({ type: 'state', state: 'LISTENING' }));
          }
          return;
        }

        if (mtype === 'user_text') {
          const text = String(msg.text || '').trim();
          if (!text) return;
          if (currentAbort) currentAbort.abort();
          currentAbort = new AbortController();
          const convId = String(msg.conversation_id || defaultConvId);
          const sttLang = String(msg.stt_language || 'en');
          const respLang = String(msg.response_language || 'en');
          const sttMs = Number(msg.stt_ms || 0);

          try {
            await runAssistantTurn({
              conversationId: convId,
              userId: clerkUserId,
              userText: text,
              sttLanguage: sttLang,
              responseLanguage: respLang,
              preferredVoiceId: typeof msg.voice_id === 'string' ? msg.voice_id : undefined,
              sttMs,
              ws,
              signal: currentAbort.signal,
            });
          } catch (err) {
            if (!currentAbort.signal.aborted) {
              ws.send(
                JSON.stringify({
                  type: 'state',
                  state: 'ERROR',
                  error: err instanceof Error ? err.message : String(err),
                })
              );
            }
          }
        }
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: 'state',
            state: 'ERROR',
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
    });

    ws.on('close', () => {
      if (currentAbort) currentAbort.abort();
    });
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (!fs.existsSync(distDir)) {
      console.warn('[LocalVox] dist/ not found in production mode. Run `npm run build` first.');
    }
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Aira MCP server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap Aira server:', err);
  process.exit(1);
});
