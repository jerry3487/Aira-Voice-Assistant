import { useCallback, useEffect, useState } from 'react';
import { Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatDurationMs } from '../utils/voiceStateMachine.js';

export default function McpConsoleScreen() {
  const [subTab, setSubTab] = useState('tools');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [selectedTool, setSelectedTool] = useState(null);
  const [argInputs, setArgInputs] = useState({});
  const [execOutput, setExecOutput] = useState(null);
  const [executing, setExecuting] = useState(false);

  const [selectedResource, setSelectedResource] = useState(null);
  const [resourceBody, setResourceBody] = useState('');
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [promptBody, setPromptBody] = useState('');

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/mcp/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      if (!selectedTool && data.tools?.length) {
        setSelectedTool(data.tools[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP server status');
    } finally {
      setLoading(false);
    }
  }, [selectedTool]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleToggleTool = async (tool) => {
    try {
      const res = await fetch(`/api/mcp/tools/${encodeURIComponent(tool.name)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !tool.enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle tool');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  const handleExecuteTool = async (e) => {
    e.preventDefault();
    if (!selectedTool) return;
    setExecuting(true);
    setExecOutput(null);
    try {
      const props = selectedTool.inputSchema?.properties || {};
      const parsedArgs = {};
      for (const [k, schema] of Object.entries(props)) {
        const rawVal = argInputs[k];
        if (rawVal === undefined || rawVal === '') continue;
        if (schema.type === 'integer' || schema.type === 'number') {
          parsedArgs[k] = Number(rawVal);
        } else if (schema.type === 'boolean') {
          parsedArgs[k] = rawVal === 'true' || rawVal === true;
        } else if (schema.type === 'array') {
          parsedArgs[k] = String(rawVal)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        } else {
          parsedArgs[k] = rawVal;
        }
      }
      const res = await fetch(`/api/mcp/tools/${encodeURIComponent(selectedTool.name)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: parsedArgs }),
      });
      const data = await res.json();
      setExecOutput(data);
      await fetchStatus();
    } catch (err) {
      setExecOutput({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setExecuting(false);
    }
  };

  const handleReadResource = async (r) => {
    setSelectedResource(r);
    setResourceBody('Loading...');
    try {
      const res = await fetch(`/api/mcp/resources/read?uri=${encodeURIComponent(r.uri)}`);
      const data = await res.json();
      setResourceBody(data.text || JSON.stringify(data, null, 2));
    } catch (err) {
      setResourceBody(err instanceof Error ? err.message : 'Failed to read resource');
    }
  };

  const handleLoadPrompt = async (p) => {
    setSelectedPrompt(p);
    setPromptBody('Loading...');
    try {
      const res = await fetch(`/api/mcp/prompts/${encodeURIComponent(p.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: {} }),
      });
      const data = await res.json();
      setPromptBody(data?.messages?.[0]?.content?.text || JSON.stringify(data, null, 2));
    } catch (err) {
      setPromptBody(err instanceof Error ? err.message : 'Failed to load prompt');
    }
  };

  const tools = status?.tools || [];
  const filteredTools =
    categoryFilter === 'all' ? tools : tools.filter((t) => t.category === categoryFilter);
  const categories = ['all', ...Array.from(new Set(tools.map((t) => t.category)))];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Custom MCP Server Console
          </h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {status?.server?.name || 'local-voice-mcp'} · Version{' '}
            {status?.server?.version || '1.0.0'} · Transport: {status?.transport || 'stdio'} ·{' '}
            {status?.connected ? 'Connected' : 'Disconnected'}
          </p>
        </div>

        <button
          type="button"
          onClick={fetchStatus}
          className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/12 dark:bg-[#111620] dark:text-slate-200 dark:hover:bg-[#171E2C] focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh MCP State</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="mt-5 flex w-fit flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-white/8 dark:bg-[#111620]">
        {[
          { id: 'tools', label: `Tools (${tools.length})` },
          { id: 'resources', label: `Resources (${status?.resources?.length || 0})` },
          { id: 'prompts', label: `Prompts (${status?.prompts?.length || 0})` },
          { id: 'history', label: `Execution History (${status?.history?.length || 0})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`whitespace-nowrap rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 ${
              subTab === tab.id
                ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'tools' && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs capitalize transition-colors ${
                    categoryFilter === cat
                      ? 'border-sky-500/50 bg-sky-500/15 text-sky-800 dark:text-sky-200'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-white/8 dark:bg-[#111620] dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620]">
              {filteredTools.map((tool) => {
                const isSelected = selectedTool?.name === tool.name;
                return (
                  <div
                    key={tool.name}
                    className={`flex items-center justify-between gap-4 px-4 py-3 transition-colors ${
                      isSelected ? 'bg-sky-500/8' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTool(tool);
                        setArgInputs({});
                        setExecOutput(null);
                      }}
                      className="flex-1 text-left focus-visible:outline-2 focus-visible:outline-sky-500"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                        <span className="font-mono text-sky-700 dark:text-sky-300">{tool.name}</span>
                        {tool.requires_confirmation && (
                          <span className="text-xs text-amber-700 dark:text-amber-300">
                            · Requires Confirmation
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                        {tool.description}
                      </p>
                    </button>

                    <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={Boolean(tool.enabled)}
                        onChange={() => handleToggleTool(tool)}
                        aria-label={`Enable tool ${tool.name}`}
                        className="accent-sky-600 dark:accent-sky-400"
                      />
                      <span>{tool.enabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/8 dark:bg-[#111620]">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/8">
                <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Test MCP Tool
                </h2>
                <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Validated Stdio
                </span>
              </div>

              {selectedTool ? (
                <form onSubmit={handleExecuteTool} className="mt-4 space-y-4">
                  <div>
                    <p className="font-mono text-sm font-medium text-sky-700 dark:text-sky-300">
                      {selectedTool.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {selectedTool.description}
                    </p>
                  </div>

                  {Object.entries(selectedTool.inputSchema?.properties || {}).map(
                    ([key, propSchema]) => {
                      const required = (selectedTool.inputSchema?.required || []).includes(key);
                      return (
                        <div key={key}>
                          <label
                            htmlFor={`arg-${key}`}
                            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                          >
                            {key}{' '}
                            <span className="text-slate-500">
                              ({propSchema.type || 'string'}
                              {required ? ', required' : ''})
                            </span>
                          </label>
                          <input
                            id={`arg-${key}`}
                            type="text"
                            required={required}
                            value={argInputs[key] ?? ''}
                            onChange={(e) =>
                              setArgInputs((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            placeholder={propSchema.description || `Enter ${key}...`}
                            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-500"
                          />
                        </div>
                      );
                    }
                  )}

                  <button
                    type="submit"
                    disabled={executing || !selectedTool.enabled}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-sky-500"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>{executing ? 'Executing...' : `Run ${selectedTool.name}`}</span>
                  </button>

                  {execOutput && (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-900 p-3 dark:border-white/10 dark:bg-[#0A0D12]">
                      <div className="flex items-center justify-between text-xs">
                        <span className={execOutput.ok ? 'text-emerald-400' : 'text-red-400'}>
                          {execOutput.ok ? 'Execution Succeeded' : 'Execution Error'}
                        </span>
                        <span className="font-mono text-slate-400 tabular-nums">
                          {formatDurationMs(execOutput.duration_ms)}
                        </span>
                      </div>
                      <pre className="mt-2 max-h-60 overflow-auto font-mono text-[11px] text-slate-100">
                        {JSON.stringify(execOutput, null, 2)}
                      </pre>
                    </div>
                  )}
                </form>
              ) : (
                <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
                  Select a tool to inspect and execute it.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {subTab === 'resources' && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620] lg:col-span-5">
            {(status?.resources || []).map((r) => (
              <button
                key={r.uri}
                type="button"
                onClick={() => handleReadResource(r)}
                className={`block w-full px-4 py-3 text-left transition-colors ${
                  selectedResource?.uri === r.uri
                    ? 'bg-sky-500/10'
                    : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                }`}
              >
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.name}</p>
                <p className="mt-0.5 font-mono text-xs text-sky-700 dark:text-sky-300">{r.uri}</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{r.description}</p>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/8 dark:bg-[#111620] lg:col-span-7">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {selectedResource ? selectedResource.name : 'Select a Local MCP Resource'}
            </h2>
            <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-100 dark:border-white/8 dark:bg-[#0A0D12]">
              {resourceBody || 'Click any MCP resource on the left to read live JSON state.'}
            </pre>
          </div>
        </div>
      )}

      {subTab === 'prompts' && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-white/8 dark:border-white/8 dark:bg-[#111620] lg:col-span-5">
            {(status?.prompts || []).map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleLoadPrompt(p)}
                className={`block w-full px-4 py-3 text-left transition-colors ${
                  selectedPrompt?.name === p.name
                    ? 'bg-sky-500/10'
                    : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'
                }`}
              >
                <p className="font-mono text-sm font-medium text-sky-700 dark:text-sky-300">
                  {p.name}
                </p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{p.description}</p>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/8 dark:bg-[#111620] lg:col-span-7">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {selectedPrompt ? selectedPrompt.name : 'Select an MCP Prompt Template'}
            </h2>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100 dark:border-white/8 dark:bg-[#0A0D12]">
              {promptBody || 'Click any prompt template on the left to inspect its instruction text.'}
            </pre>
          </div>
        </div>
      )}

      {subTab === 'history' && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/8 dark:bg-[#111620]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-600 dark:border-white/8 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Tool</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Arguments</th>
                <th className="px-4 py-3 font-medium">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-700 dark:divide-white/8 dark:text-slate-300">
              {(status?.history || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                    No MCP tool executions logged yet.
                  </td>
                </tr>
              ) : (
                status.history.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 font-mono text-sky-700 dark:text-sky-300">
                      {row.tool_name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          row.status === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.status === 'disabled'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                      {formatDurationMs(row.duration_ms)}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400">
                      {row.error || row.arguments_json}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {new Date(row.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
