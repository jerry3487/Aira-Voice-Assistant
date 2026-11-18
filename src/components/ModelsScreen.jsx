import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, RefreshCw, Terminal, XCircle } from 'lucide-react';
import { authFetch } from '../utils/apiClient.js';
import { formatDurationMs } from '../utils/voiceStateMachine.js';

export default function ModelsScreen({ assistant }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState('qwen3:1.7b');
  const [systemPrompt, setSystemPrompt] = useState(
    'You are Aira, a private local AI voice assistant running on the user device.'
  );
  const [saveFeedback, setSaveFeedback] = useState('');

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/models/status');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setSelectedModel(json.llm?.active_model || 'qwen3:1.7b');
        setSystemPrompt(json.llm?.system_prompt || '');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleSaveModelConfig = async (e) => {
    e.preventDefault();
    setSaveFeedback('');
    const res = await authFetch('/api/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, system_prompt: systemPrompt }),
    });
    if (res.ok) {
      setSaveFeedback('Saved assistant model configuration.');
      await loadModels();
    }
  };

  const llm = data?.llm || {};
  const sys = data?.system || {};
  const mem = sys.memory || {};
  const cpu = sys.cpu || {};
  const disk = sys.disk || {};
  const lastMetrics = assistant?.lastMetrics;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/8">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Local Models, Voices & Performance
          </h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Designed for 8 GB RAM CPU-only hardware · Lazy loading · Zero cloud inference
          </p>
        </div>

        <button
          type="button"
          onClick={loadModels}
          className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-white/12 dark:bg-[#111620] dark:text-slate-200 dark:hover:bg-[#171E2C] focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Hardware & Models</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620]">
          <p className="text-xs text-slate-500 dark:text-slate-400">Local CPU Utilization</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {loading && !data ? '—' : `${cpu.cpu_percent ?? 0}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {loading && !data
              ? 'Sampling /proc/stat...'
              : `${sys.cpu_cores || cpu.cpu_cores || '-'} cores · ${sys.architecture || 'x86_64'}`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620]">
          <p className="text-xs text-slate-500 dark:text-slate-400">System RAM Usage</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {loading && !data ? '—' : `${mem.percent_used ?? 0}%`}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
            {loading && !data
              ? 'Reading memory...'
              : `${mem.used_mb ?? 0} / ${mem.total_mb ?? 0} MB`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620]">
          <p className="text-xs text-slate-500 dark:text-slate-400">Local Disk Free</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
            {loading && !data ? '—' : `${disk.free_gb ?? 0} GB`}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
            {loading && !data
              ? 'Checking filesystem...'
              : `${disk.used_gb ?? 0} / ${disk.total_gb ?? 0} GB used`}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/8 dark:bg-[#111620]">
          <p className="text-xs text-slate-500 dark:text-slate-400">Last Turn End-to-End</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-sky-600 dark:text-sky-300 tabular-nums">
            {lastMetrics ? formatDurationMs(lastMetrics.total_ms) : '—'}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 tabular-nums">
            {lastMetrics
              ? `TTFT ${formatDurationMs(lastMetrics.llm_first_token_ms)} · Actions ${formatDurationMs(lastMetrics.mcp_tool_ms)}`
              : 'Run a voice or text turn to measure'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/8 dark:bg-[#111620] lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-white/8">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Ollama Local LLM Configuration
              </h2>
            </div>
            <span
              className={`flex items-center gap-1.5 text-xs font-medium ${
                llm.reachable || llm.cloud_configured
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {llm.reachable || llm.cloud_configured ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {llm.reachable
                ? 'Ollama Online'
                : llm.cloud_configured
                  ? `Cloud AI Active (${llm.cloud_model})`
                  : 'Ollama Offline (127.0.0.1:11434)'}
            </span>
          </div>

          <form onSubmit={handleSaveModelConfig} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ollama-model-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Active Local Model
                </label>
                <input
                  id="ollama-model-select"
                  type="text"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500"
                />
              </div>

              <div className="flex items-end justify-end">
                <button
                  type="submit"
                  className="whitespace-nowrap rounded-lg bg-sky-600 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-500 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-sky-500"
                >
                  Save Configuration
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="system-prompt-box" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Assistant System Prompt
              </label>
              <textarea
                id="system-prompt-box"
                rows={3}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-800 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-200 focus-visible:outline-2 focus-visible:outline-sky-500"
              />
            </div>

            {saveFeedback && <p className="text-xs text-emerald-600 dark:text-emerald-400">{saveFeedback}</p>}
          </form>

          <div className="mt-5">
            <h3 className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Installed Ollama Models ({llm.models?.length || 0})
            </h3>
            {llm.models?.length ? (
              <div className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50 dark:divide-white/8 dark:border-white/8 dark:bg-[#0A0D12]">
                {llm.models.map((m) => (
                  <div key={m.name} className="flex items-center justify-between px-3 py-2 text-xs">
                    <span className="font-mono text-sky-700 dark:text-sky-300">{m.name}</span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {(Number(m.size_bytes || 0) / 1024 ** 3).toFixed(2)} GB
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-white/8 dark:bg-[#0A0D12] dark:text-slate-400">
                <p className="flex items-center gap-2 text-slate-800 dark:text-slate-300">
                  <Terminal className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                  <span>Run locally on your machine to enable Ollama generative inference:</span>
                </p>
                <pre className="mt-2 font-mono text-[11px] text-sky-700 dark:text-sky-300">
                  ollama serve{'\n'}ollama pull qwen3:1.7b
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/8 dark:bg-[#111620]">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Speech Recognition & VAD
            </h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Python Backend Engine</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200">
                  {data?.stt?.engine || 'faster-whisper'} ({data?.stt?.model_size || 'base'})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Quantization</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200">
                  CPU {data?.stt?.compute_type || 'int8'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">VAD Pipeline</dt>
                <dd className="text-slate-800 dark:text-slate-200">
                  {data?.stt?.vad_engine || 'Silero / Web Audio VAD'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">FastAPI Audio Bridge</dt>
                <dd className={data?.stt?.fastapi_stt_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                  {data?.stt?.fastapi_stt_active ? 'Connected (port 8000)' : 'Browser SpeechRecognition + VAD'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/8 dark:bg-[#111620]">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Discovered Local Voices ({assistant?.availableVoices?.length || 0})
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Piper <code className="text-sky-700 dark:text-sky-300">.onnx</code> models from{' '}
              <code className="text-sky-700 dark:text-sky-300">backend/voices/</code> plus local OS speech voices.
            </p>
            <div className="mt-3 max-h-56 divide-y divide-slate-200 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 dark:divide-white/8 dark:border-white/8 dark:bg-[#0A0D12]">
              {(assistant?.availableVoices || []).length === 0 ? (
                <p className="p-3 text-xs text-slate-600 dark:text-slate-400">
                  No voices reported by browser or Piper yet. Run{' '}
                  <code className="text-sky-700 dark:text-sky-300">bash backend/scripts/setup_local.sh</code> to
                  install Piper <code className="text-sky-700 dark:text-sky-300">en_US-lessac-medium</code>.
                </p>
              ) : (
                assistant.availableVoices.slice(0, 20).map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800 dark:text-slate-200">{v.name}</p>
                      <p className="text-slate-500">
                        {v.lang} · {v.engine} · {v.license}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => assistant.setSelectedVoiceId(v.id)}
                      className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium ${
                        assistant.selectedVoiceId === v.id
                          ? 'bg-sky-600 text-white dark:bg-sky-500 dark:text-slate-950'
                          : 'border border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5'
                      }`}
                    >
                      {assistant.selectedVoiceId === v.id ? 'Active' : 'Use'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
