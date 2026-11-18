import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Headphones,
  Mic,
  MicOff,
  Send,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import VoiceOrb from './VoiceOrb.jsx';
import {
  CONVERSATION_STATES,
  SUPPORTED_LANGUAGES,
  formatDurationMs,
} from '../utils/voiceStateMachine.js';

export default function VoiceScreen({ assistant, theme }) {
  const [textInput, setTextInput] = useState('');
  const transcriptEndRef = useRef(null);

  const {
    state,
    errorMessage,
    sttNotice,
    messages,
    streamingText,
    interimTranscript,
    lastMetrics,
    micActive,
    muted,
    continuousMode,
    setContinuousMode,
    headphonesMode,
    setHeadphonesMode,
    audioLevel,
    spectrum,
    speechDetected,
    sttEngineLabel,
    sttLanguage,
    setSttLanguage,
    responseLanguage,
    setResponseLanguage,
    availableVoices,
    selectedVoiceId,
    setSelectedVoiceId,
    voiceSpeed,
    setVoiceSpeed,
    wsConnected,
    engineMode,
    languageWarning,
    startVoiceSession,
    stopVoiceSession,
    flushSpeechNow,
    toggleMute,
    interruptAssistant,
    stopSpeechPlayback,
    sendTextTurn,
  } = assistant;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const isBusy =
    state === CONVERSATION_STATES.THINKING ||
    state === CONVERSATION_STATES.TOOL_EXECUTING ||
    state === CONVERSATION_STATES.SPEAKING;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    sendTextTurn(textInput);
    setTextInput('');
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
      {/* Top Calibration Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 text-xs text-slate-600 dark:border-white/8 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Input</span>
            <select
              aria-label="Speech recognition language"
              value={sttLanguage}
              onChange={(e) => setSttLanguage(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-white/10 dark:bg-[#111620] dark:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={`stt-${lang.code}`} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Response</span>
            <select
              aria-label="Response language"
              value={responseLanguage}
              onChange={(e) => {
                const nextLang = e.target.value;
                setResponseLanguage(nextLang);
                const matchingVoice = availableVoices.find((v) =>
                  String(v.lang || '').toLowerCase().startsWith(nextLang.toLowerCase())
                );
                if (matchingVoice) {
                  setSelectedVoiceId(matchingVoice.id);
                }
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-white/10 dark:bg-[#111620] dark:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              {SUPPORTED_LANGUAGES.filter((l) => !l.sttOnly).map((lang) => (
                <option key={`resp-${lang.code}`} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Voice</span>
            <select
              aria-label="TTS Voice"
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              className="max-w-48 truncate rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-white/10 dark:bg-[#111620] dark:text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              {availableVoices.length === 0 ? (
                <option value="">System Default</option>
              ) : (
                availableVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.lang})
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Speed</span>
            <input
              type="range"
              aria-label="Voice playback speed"
              min="0.75"
              max="1.5"
              step="0.05"
              value={voiceSpeed}
              onChange={(e) => setVoiceSpeed(Number(e.target.value))}
              className="w-20 accent-sky-600 dark:accent-sky-400"
            />
            <span className="font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
              {voiceSpeed.toFixed(2)}x
            </span>
          </label>
        </div>
      </div>

      {/* Notices & Errors */}
      {languageWarning && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-200"
        >
          {languageWarning}
        </div>
      )}
      {sttNotice && (
        <div
          role="status"
          className="mt-4 rounded-lg border border-sky-500/35 bg-sky-500/10 px-4 py-2.5 text-xs text-sky-900 dark:text-sky-200"
        >
          {sttNotice}
        </div>
      )}
      {errorMessage && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-2.5 text-xs text-red-800 dark:text-red-200"
        >
          {errorMessage}
        </div>
      )}

      {/* Split Acoustic Studio Stage */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Acoustic Resonance Deck */}
        <section
          aria-label="Acoustic Resonance Deck"
          className="flex flex-col items-center justify-between rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/8 dark:bg-[#111620] lg:col-span-5"
        >
          <div className="flex w-full items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Acoustic Field · {sttEngineLabel}</span>
            <span className="font-mono tabular-nums">
              {micActive ? (muted ? 'Mic Muted' : 'Mic Armed') : 'Standby'}
            </span>
          </div>

          <div className="my-5 flex flex-col items-center">
            <VoiceOrb
              state={state}
              audioLevel={audioLevel}
              spectrum={spectrum}
              speechDetected={speechDetected}
              theme={theme}
              onClick={() => (micActive ? stopVoiceSession() : startVoiceSession())}
            />

            <div className="mt-4 min-h-6 text-center">
              {interimTranscript ? (
                <p className="max-w-sm text-sm font-medium text-sky-700 dark:text-sky-300">
                  “{interimTranscript}”
                </p>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-500">
                  {micActive
                    ? 'Live speech auto-submits when you pause (~0.8s).'
                    : 'Tap the resonator or Start Voice to begin.'}
                </p>
              )}
            </div>
          </div>

          {/* Hardware-Inspired Control Dock */}
          <div className="w-full space-y-4 border-t border-slate-200 pt-4 sm:pt-5 dark:border-white/8">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
              <button
                type="button"
                onClick={() => (micActive ? stopVoiceSession() : startVoiceSession())}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm focus-visible:outline-2 focus-visible:outline-sky-500 ${
                  micActive
                    ? 'bg-sky-600 text-white hover:bg-sky-500 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400'
                    : 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white'
                }`}
              >
                {micActive ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                <span>{micActive ? 'Stop Voice' : 'Start Voice'}</span>
              </button>

              {micActive && (
                <button
                  type="button"
                  onClick={flushSpeechNow}
                  title="Send current speech utterance immediately without waiting for silence pause"
                  className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-800 hover:bg-sky-500/20 sm:px-3.5 sm:py-2.5 sm:text-sm dark:text-sky-200 focus-visible:outline-2 focus-visible:outline-sky-500"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  <span>Reply Now</span>
                </button>
              )}

              <button
                type="button"
                onClick={toggleMute}
                disabled={!micActive}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:px-3.5 sm:py-2.5 sm:text-sm dark:border-white/12 dark:bg-[#0A0D12] dark:text-slate-200 dark:hover:bg-[#171E2C] focus-visible:outline-2 focus-visible:outline-sky-500"
              >
                {muted ? <VolumeX className="h-4 w-4 text-amber-500" /> : <Volume2 className="h-4 w-4" />}
                <span>{muted ? 'Unmute' : 'Mute'}</span>
              </button>

              <button
                type="button"
                onClick={interruptAssistant}
                disabled={!isBusy}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-2 sm:px-3.5 sm:py-2.5 sm:text-sm dark:text-red-200 focus-visible:outline-2 focus-visible:outline-red-400"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>Interrupt</span>
              </button>

              {state === CONVERSATION_STATES.SPEAKING && (
                <button
                  type="button"
                  onClick={stopSpeechPlayback}
                  className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:px-3.5 sm:py-2.5 sm:text-sm dark:border-white/12 dark:bg-[#0A0D12] dark:text-slate-200"
                >
                  Stop Audio
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-5 text-xs text-slate-600 dark:text-slate-400">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={continuousMode}
                  onChange={(e) => setContinuousMode(e.target.checked)}
                  className="accent-sky-600 dark:accent-sky-400"
                />
                <span>Continuous listening</span>
              </label>

              <label
                className="flex cursor-pointer items-center gap-2"
                title="Enable full-duplex voice barge-in while wearing headphones to avoid speaker echo"
              >
                <input
                  type="checkbox"
                  checked={headphonesMode}
                  onChange={(e) => setHeadphonesMode(e.target.checked)}
                  className="accent-sky-600 dark:accent-sky-400"
                />
                <Headphones className="h-3.5 w-3.5" />
                <span>Headphones barge-in</span>
              </label>
            </div>
          </div>
        </section>

        {/* Right: Live Dialogue Feed */}
        <section
          aria-label="Conversation Transcript"
          className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/8 dark:bg-[#111620] lg:col-span-7"
        >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3 text-xs text-slate-500 dark:border-white/8 dark:text-slate-400">
            <span className="truncate">
              Dialogue · {wsConnected ? 'Live' : 'Reconnecting'} ·{' '}
              {engineMode === 'ollama'
                ? 'Local Ollama'
                : engineMode === 'openai-compat'
                  ? 'Cloud AI'
                  : 'Built-in Assistant'}
            </span>
            {lastMetrics && (
              <span className="shrink-0 whitespace-nowrap font-mono tabular-nums">
                Last turn: {formatDurationMs(lastMetrics.total_ms)}
              </span>
            )}
          </div>

          <div
            className="my-4 h-[380px] space-y-5 overflow-y-auto pr-1"
            data-testid="transcript-list"
          >
            {messages.length === 0 && !streamingText ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-500 dark:text-slate-400">
                <p className="font-medium text-slate-700 dark:text-slate-300">
                  Ready for live conversation
                </p>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-500">
                  Click Start Voice and speak naturally, or try typing below: “What is my CPU and memory usage?”, “Remember that I prefer concise replies”, or “Calculate 42 * 18”.
                </p>
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="border-b border-slate-100 pb-4 last:border-b-0 dark:border-white/6">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span
                      className={`font-display font-semibold ${
                        m.role === 'user'
                          ? 'text-sky-700 dark:text-sky-300'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {m.role === 'user' ? 'You' : 'Aira'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{m.language}</span>
                    {m.metrics && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatDurationMs(m.metrics.total_ms)}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                    {m.content}
                  </p>
                </div>
              ))
            )}

            {streamingText && (
              <div className="pb-2">
                <div className="mb-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                  Aira · Streaming
                </div>
                <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                  {streamingText}
                </p>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-slate-200 pt-4 dark:border-white/8"
          >
            <label htmlFor="voice-text-input" className="sr-only">
              Type a message to the voice assistant
            </label>
            <input
              id="voice-text-input"
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Speak or type a message..."
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-white/10 dark:bg-[#0A0D12] dark:text-slate-100 dark:placeholder:text-slate-500 focus-visible:outline-2 focus-visible:outline-sky-500"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              aria-label="Send message"
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400 focus-visible:outline-2 focus-visible:outline-sky-500"
            >
              <Send className="h-4 w-4" />
              <span>Send</span>
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
