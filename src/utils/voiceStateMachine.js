export const CONVERSATION_STATES = Object.freeze({
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  TRANSCRIBING: 'TRANSCRIBING',
  THINKING: 'THINKING',
  TOOL_EXECUTING: 'TOOL_EXECUTING',
  SPEAKING: 'SPEAKING',
  INTERRUPTED: 'INTERRUPTED',
  ERROR: 'ERROR',
});

export const STATE_META = Object.freeze({
  IDLE: { label: 'Ready', hint: 'Click the microphone to start speaking', tone: 'neutral' },
  LISTENING: { label: 'Listening', hint: 'Speak naturally — pauses trigger response', tone: 'sky' },
  TRANSCRIBING: { label: 'Transcribing', hint: 'Converting speech to text locally', tone: 'sky' },
  THINKING: { label: 'Thinking', hint: 'Reasoning with assistant model', tone: 'indigo' },
  TOOL_EXECUTING: { label: 'Processing', hint: 'Processing your request', tone: 'amber' },
  SPEAKING: { label: 'Speaking', hint: 'Playing voice output — interrupt anytime', tone: 'emerald' },
  INTERRUPTED: { label: 'Interrupted', hint: 'Playback stopped — listening for new input', tone: 'amber' },
  ERROR: { label: 'Error', hint: 'Check connection or model configuration', tone: 'crimson' },
});

export const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto Detect', sttOnly: true },
  { code: 'en', name: 'English' },
  { code: 'ta', name: 'Tamil' },
  { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'kn', name: 'Kannada' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
];

const VALID_TRANSITIONS = {
  IDLE: ['LISTENING', 'TRANSCRIBING', 'THINKING', 'ERROR'],
  LISTENING: ['IDLE', 'TRANSCRIBING', 'THINKING', 'INTERRUPTED', 'ERROR'],
  TRANSCRIBING: ['LISTENING', 'THINKING', 'IDLE', 'INTERRUPTED', 'ERROR'],
  THINKING: ['TOOL_EXECUTING', 'SPEAKING', 'INTERRUPTED', 'IDLE', 'ERROR'],
  TOOL_EXECUTING: ['THINKING', 'SPEAKING', 'INTERRUPTED', 'ERROR'],
  SPEAKING: ['LISTENING', 'IDLE', 'INTERRUPTED', 'ERROR'],
  INTERRUPTED: ['LISTENING', 'IDLE', 'TRANSCRIBING', 'THINKING'],
  ERROR: ['IDLE', 'LISTENING', 'THINKING'],
};

export function transitionVoiceState(currentState, nextState) {
  if (!CONVERSATION_STATES[nextState]) {
    throw new Error(`Invalid conversation state: ${nextState}`);
  }
  if (currentState === nextState) return nextState;
  const allowed = VALID_TRANSITIONS[currentState] || [];
  if (!allowed.includes(nextState)) {
    // Allow explicit recovery to IDLE or ERROR from any state
    if (nextState === 'IDLE' || nextState === 'ERROR' || nextState === 'INTERRUPTED') {
      return nextState;
    }
    return currentState;
  }
  return nextState;
}

export function checkVoiceLanguageCompatibility(responseLanguage, activeVoice, availableVoices = []) {
  if (!responseLanguage || responseLanguage === 'auto') {
    return { compatible: true, warning: null };
  }
  if (!availableVoices.length) {
    return {
      compatible: true,
      warning: null,
    };
  }
  if (!activeVoice) {
    const hasMatch = availableVoices.some((v) =>
      String(v.lang || v.language || '').toLowerCase().startsWith(responseLanguage.toLowerCase())
    );
    if (!hasMatch) {
      return {
        compatible: false,
        warning: `No installed TTS voice matches '${responseLanguage}'. Install a matching Piper voice or switch response language.`,
      };
    }
    return { compatible: true, warning: null };
  }
  const voiceLang = String(activeVoice.lang || activeVoice.language || '').toLowerCase();
  if (!voiceLang.startsWith(responseLanguage.toLowerCase())) {
    const suggested = availableVoices.find((v) =>
      String(v.lang || v.language || '').toLowerCase().startsWith(responseLanguage.toLowerCase())
    );
    return {
      compatible: false,
      suggestedVoice: suggested || null,
      warning: suggested
        ? `Selected voice '${activeVoice.name || activeVoice.id}' speaks '${voiceLang}', not '${responseLanguage}'. Switch to '${suggested.name || suggested.id}' for accurate pronunciation.`
        : `No installed voice supports '${responseLanguage}'. Responses will be displayed in text, and spoken playback may be unavailable or accented.`,
    };
  }
  return { compatible: true, warning: null };
}

export function classifyVadFrame(samples, threshold = 0.018) {
  if (!samples || samples.length === 0) {
    return { rms: 0, speech: false };
  }
  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const s = samples[i];
    sumSq += s * s;
  }
  const rms = Math.sqrt(sumSq / samples.length);
  return {
    rms: Number(rms.toFixed(4)),
    speech: rms >= threshold,
  };
}

export function formatDurationMs(ms) {
  const num = Number(ms || 0);
  if (num < 1000) return `${Math.round(num)} ms`;
  return `${(num / 1000).toFixed(2)} s`;
}
