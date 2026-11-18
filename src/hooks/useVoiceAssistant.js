import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalAudioVadCapture } from '../utils/audioVad.js';
import {
  authFetch,
  buildVoiceWebSocketUrl,
  getFreshAuthToken,
} from '../utils/apiClient.js';
import {
  CONVERSATION_STATES,
  checkVoiceLanguageCompatibility,
  transitionVoiceState,
} from '../utils/voiceStateMachine.js';

const DEFAULT_NEURAL_VOICES = [
  { id: 'ta-IN-PallaviNeural', name: 'Tamil - Pallavi (Neural)', lang: 'ta', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'ta-IN-ValluvarNeural', name: 'Tamil - Valluvar (Neural)', lang: 'ta', gender: 'male', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'hi-IN-SwaraNeural', name: 'Hindi - Swara (Neural)', lang: 'hi', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'hi-IN-MadhurNeural', name: 'Hindi - Madhur (Neural)', lang: 'hi', gender: 'male', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'te-IN-ShrutiNeural', name: 'Telugu - Shruti (Neural)', lang: 'te', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'kn-IN-SapnaNeural', name: 'Kannada - Sapna (Neural)', lang: 'kn', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'ml-IN-SobhanaNeural', name: 'Malayalam - Sobhana (Neural)', lang: 'ml', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'en-IN-NeerjaNeural', name: 'English (India) - Neerja (Neural)', lang: 'en', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
  { id: 'en-US-AriaNeural', name: 'English (US) - Aria (Neural)', lang: 'en', gender: 'female', engine: 'edge', license: 'Microsoft Neural' },
];

export function useVoiceAssistant() {
  const [state, setStateRaw] = useState(CONVERSATION_STATES.IDLE);
  const [errorMessage, setErrorMessage] = useState('');
  const [sttNotice, setSttNotice] = useState('');
  const [conversationId, setConversationId] = useState(() => `session-${Date.now()}`);
  const [messages, setMessages] = useState([]);
  const [streamingText, setStreamingText] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [activeTool, setActiveTool] = useState(null);
  const [sessionToolEvents, setSessionToolEvents] = useState([]);
  const [lastMetrics, setLastMetrics] = useState(null);

  const [micActive, setMicActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [continuousMode, setContinuousMode] = useState(true);
  const [headphonesMode, setHeadphonesMode] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [spectrum, setSpectrum] = useState(() => new Array(32).fill(0));
  const [speechDetected, setSpeechDetected] = useState(false);
  const [sttEngineLabel, setSttEngineLabel] = useState('Standby');

  const [sttLanguage, setSttLanguage] = useState('auto');
  const [responseLanguage, setResponseLanguage] = useState('en');
  const [availableVoices, setAvailableVoices] = useState([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [wsConnected, setWsConnected] = useState(false);
  const [engineMode, setEngineMode] = useState('local-mcp-router');

  const wsRef = useRef(null);
  const pendingQueueRef = useRef([]);
  const vadRef = useRef(null);
  const recognitionRef = useRef(null);
  const audioSourceRef = useRef(null);
  const ttsWatchdogRef = useRef(null);
  const flushTimerRef = useRef(null);

  const interimTextRef = useRef('');
  const lastSubmittedRef = useRef({ text: '', at: 0 });
  const speechStartAtRef = useRef(0);
  const speechRecBrokenRef = useRef(false);

  const stateRef = useRef(state);
  const micActiveRef = useRef(micActive);
  const continuousRef = useRef(continuousMode);
  const headphonesRef = useRef(headphonesMode);
  const sttLangRef = useRef(sttLanguage);
  const respLangRef = useRef(responseLanguage);
  const voiceIdRef = useRef(selectedVoiceId);
  const voiceSpeedRef = useRef(voiceSpeed);
  const voicesRef = useRef(availableVoices);
  const convIdRef = useRef(conversationId);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { micActiveRef.current = micActive; }, [micActive]);
  useEffect(() => { continuousRef.current = continuousMode; }, [continuousMode]);
  useEffect(() => { headphonesRef.current = headphonesMode; }, [headphonesMode]);
  useEffect(() => { sttLangRef.current = sttLanguage; }, [sttLanguage]);
  useEffect(() => { respLangRef.current = responseLanguage; }, [responseLanguage]);
  useEffect(() => { voiceIdRef.current = selectedVoiceId; }, [selectedVoiceId]);
  useEffect(() => { voiceSpeedRef.current = voiceSpeed; }, [voiceSpeed]);
  useEffect(() => { voicesRef.current = availableVoices; }, [availableVoices]);
  useEffect(() => { convIdRef.current = conversationId; }, [conversationId]);

  const setState = useCallback((next) => {
    setStateRaw((prev) => transitionVoiceState(prev, next));
  }, []);

  const refreshVoices = useCallback(async () => {
    const merged = [...DEFAULT_NEURAL_VOICES];
    try {
      const res = await authFetch('/api/models/status');
      if (res.ok) {
        const data = await res.json();
        const piperVoices = data?.tts?.installed_piper_voices || [];
        for (const pv of piperVoices) {
          merged.push({
            id: pv.id,
            name: `${pv.id} (Piper Local)`,
            lang: pv.language || 'en',
            gender: pv.gender || 'neutral',
            engine: 'piper',
            license: pv.license || 'Verify .onnx.json',
          });
        }
      }
    } catch {
      // ignore if offline
    }

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const sysVoices = window.speechSynthesis.getVoices() || [];
      for (const sv of sysVoices) {
        merged.push({
          id: sv.voiceURI,
          name: `${sv.name} (System)`,
          lang: sv.lang || 'en-US',
          gender: 'system',
          engine: 'browser-tts',
          license: 'Local OS Speech',
          nativeVoice: sv,
        });
      }
    }

    setAvailableVoices(merged);
    if (merged.length > 0 && !voiceIdRef.current) {
      const eng = merged.find((v) => String(v.lang).toLowerCase().startsWith('en')) || merged[0];
      setSelectedVoiceId(eng.id);
    }
  }, []);

  const prevLangRef = useRef(responseLanguage);
  useEffect(() => {
    respLangRef.current = responseLanguage;
    if (availableVoices.length === 0) return;

    const langChanged = prevLangRef.current !== responseLanguage;
    prevLangRef.current = responseLanguage;

    if (!selectedVoiceId || langChanged) {
      if (responseLanguage !== 'auto') {
        const match = availableVoices.find((v) =>
          String(v.lang || '').toLowerCase().startsWith(responseLanguage.toLowerCase())
        );
        if (match) {
          setSelectedVoiceId(match.id);
          return;
        }
      }
      if (!selectedVoiceId && availableVoices[0]) {
        setSelectedVoiceId(availableVoices[0].id);
      }
    }
  }, [responseLanguage, availableVoices]);

  useEffect(() => {
    refreshVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
      return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
    }
  }, [refreshVoices]);

  const stopSpeechPlayback = useCallback(() => {
    if (ttsWatchdogRef.current) {
      clearInterval(ttsWatchdogRef.current);
      ttsWatchdogRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // already stopped
      }
      audioSourceRef.current = null;
    }
  }, []);

  const createAndStartRecognition = useCallback((onFinalText) => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec || speechRecBrokenRef.current) {
      setSttEngineLabel('VAD Audio Stream');
      return null;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang = sttLangRef.current === 'auto' ? 'en-US' : sttLangRef.current;

      rec.onresult = (evt) => {
        let interim = '';
        let finalStr = '';
        for (let i = evt.resultIndex; i < evt.results.length; i += 1) {
          const res = evt.results[i];
          if (res.isFinal) {
            finalStr += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }
        interimTextRef.current = interim.trim();
        setInterimTranscript(interim.trim());

        if (finalStr.trim()) {
          if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
          }
          interimTextRef.current = '';
          setInterimTranscript('');
          onFinalText(finalStr.trim());
        }
      };

      rec.onerror = (evt) => {
        if (evt.error === 'network' || evt.error === 'service-not-allowed') {
          speechRecBrokenRef.current = true;
          setSttEngineLabel('VAD -> FastAPI Whisper');
          setSttNotice(
            'Browser cloud SpeechRecognition is unavailable offline; capturing live audio via VAD for local STT.'
          );
        } else if (evt.error !== 'no-speech' && evt.error !== 'aborted') {
          setSttNotice(`Speech recognition notice: ${evt.error}`);
        }
      };

      rec.onend = () => {
        if (
          micActiveRef.current &&
          continuousRef.current &&
          !speechRecBrokenRef.current &&
          stateRef.current === CONVERSATION_STATES.LISTENING
        ) {
          setTimeout(() => {
            if (
              micActiveRef.current &&
              stateRef.current === CONVERSATION_STATES.LISTENING &&
              recognitionRef.current === rec
            ) {
              try {
                rec.start();
              } catch {
                // ignore
              }
            }
          }, 120);
        }
      };

      recognitionRef.current = rec;
      rec.start();
      setSttEngineLabel('Live Browser STT + VAD');
      return rec;
    } catch {
      setSttEngineLabel('VAD Audio Stream');
      return null;
    }
  }, []);

  const resumeListeningIfActive = useCallback(
    (sendFn) => {
      if (vadRef.current) vadRef.current.setPaused(false);
      if (micActiveRef.current && continuousRef.current) {
        setState(CONVERSATION_STATES.LISTENING);
        if (recognitionRef.current && !speechRecBrokenRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            // already running
          }
        } else if (!recognitionRef.current && sendFn) {
          createAndStartRecognition(sendFn);
        }
      } else {
        setState(CONVERSATION_STATES.IDLE);
      }
    },
    [createAndStartRecognition, setState]
  );

  const sendTextTurn = useCallback(
    (text, sttMs = 0) => {
      const clean = (text || '').trim();
      if (!clean) return;
      const now = Date.now();
      if (
        lastSubmittedRef.current.text === clean &&
        now - lastSubmittedRef.current.at < 800
      ) {
        return;
      }
      lastSubmittedRef.current = { text: clean, at: now };

      stopSpeechPlayback();
      if (vadRef.current) vadRef.current.setPaused(true);
      setStreamingText('');
      setErrorMessage('');
      setSttNotice('');
      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}`,
          role: 'user',
          content: clean,
          language: sttLangRef.current === 'auto' ? 'en' : sttLangRef.current,
          createdAt: new Date().toISOString(),
        },
      ]);

      const payload = {
        type: 'user_text',
        conversation_id: convIdRef.current,
        text: clean,
        stt_language: sttLangRef.current,
        response_language: respLangRef.current,
        voice_id: voiceIdRef.current,
        stt_ms: sttMs,
      };
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(payload));
      } else if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
        pendingQueueRef.current.push(payload);
      } else {
        setErrorMessage('WebSocket disconnected. Reconnecting...');
        setState(CONVERSATION_STATES.ERROR);
      }
    },
    [setState, stopSpeechPlayback]
  );

  const speakResponse = useCallback(
    async (text, language, wavBase64) => {
      if (!text) {
        resumeListeningIfActive((t) => sendTextTurn(t, 45));
        return;
      }

      // Prevent echo self-capture during speaker playback unless using headphones
      if (!headphonesRef.current) {
        if (vadRef.current) vadRef.current.setPaused(true);
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            // ignore
          }
        }
      } else if (vadRef.current) {
        vadRef.current.setPaused(false);
      }

      const t0 = performance.now();
      const voices = voicesRef.current;
      const chosenVoice = voices.find((v) => v.id === voiceIdRef.current) || null;
      const isBrowserVoice = chosenVoice?.engine === 'browser-tts';

      if (wavBase64 && !isBrowserVoice) {
        try {
          const binary = atob(wavBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          const audioBuf = await ctx.decodeAudioData(bytes.buffer);
          const src = ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(ctx.destination);
          audioSourceRef.current = src;
          src.onended = () => {
            audioSourceRef.current = null;
            ctx.close().catch(() => undefined);
            setLastMetrics((prev) =>
              prev ? { ...prev, tts_ms: Math.round(performance.now() - t0) } : prev
            );
            setTimeout(() => resumeListeningIfActive((t) => sendTextTurn(t, 45)), 220);
          };
          src.start(0);
          return;
        } catch {
          // Fall through to browser TTS
        }
      }

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = voicesRef.current;
        let chosenVoice = voices.find((v) => v.id === voiceIdRef.current) || null;
        const compat = checkVoiceLanguageCompatibility(language, chosenVoice, voices);
        if (!compat.compatible && compat.suggestedVoice) {
          chosenVoice = compat.suggestedVoice;
        }

        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = language === 'auto' ? 'en-US' : language;
        utter.rate = voiceSpeedRef.current;
        if (chosenVoice?.nativeVoice) {
          utter.voice = chosenVoice.nativeVoice;
        }

        let finished = false;
        const finishPlayback = () => {
          if (finished) return;
          finished = true;
          if (ttsWatchdogRef.current) {
            clearInterval(ttsWatchdogRef.current);
            ttsWatchdogRef.current = null;
          }
          setLastMetrics((prev) =>
            prev ? { ...prev, tts_ms: Math.round(performance.now() - t0) } : prev
          );
          setTimeout(() => resumeListeningIfActive((t) => sendTextTurn(t, 45)), 220);
        };

        utter.onend = finishPlayback;
        utter.onerror = finishPlayback;

        const startSpeak = () => {
          if (finished) return;
          window.speechSynthesis.resume();
          window.speechSynthesis.speak(utter);

          // Chromium TTS watchdog: keep synthesis resumed and guarantee state recovery
          const startedAt = Date.now();
          const maxWaitMs = Math.max(5000, text.split(/\s+/).length * 520);
          ttsWatchdogRef.current = setInterval(() => {
            window.speechSynthesis.resume();
            if (
              (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) ||
              Date.now() - startedAt > maxWaitMs
            ) {
              finishPlayback();
            }
          }, 1200);
        };

        if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
          window.speechSynthesis.cancel();
          setTimeout(startSpeak, 50);
        } else {
          startSpeak();
        }
      } else {
        setTimeout(() => resumeListeningIfActive((t) => sendTextTurn(t, 45)), 200);
      }
    },
    [resumeListeningIfActive, sendTextTurn]
  );

  useEffect(() => {
    let closedByUnmount = false;
    let reconnectTimer = null;

    const connect = async () => {
      const token = await getFreshAuthToken();
      if (closedByUnmount) return;
      const wsUrl = buildVoiceWebSocketUrl(
        window.location.protocol,
        window.location.host,
        token
      );
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setErrorMessage('');
        while (pendingQueueRef.current.length > 0) {
          const queued = pendingQueueRef.current.shift();
          ws.send(JSON.stringify(queued));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state') {
            setState(msg.state);
            if (msg.state === 'TOOL_EXECUTING') {
              setActiveTool({ name: msg.tool, arguments: msg.arguments || {} });
            } else if (msg.state !== 'THINKING') {
              setActiveTool(null);
            }
            if (msg.state === 'ERROR' && msg.error) {
              setErrorMessage(msg.error);
            }
          } else if (msg.type === 'transcript') {
            setMessages((prev) => [
              ...prev,
              {
                id: `u-${Date.now()}`,
                role: 'user',
                content: msg.text,
                language: msg.language || 'en',
                createdAt: new Date().toISOString(),
              },
            ]);
          } else if (msg.type === 'stt_notice') {
            setSttNotice(msg.message || '');
            if (vadRef.current) vadRef.current.setPaused(false);
          } else if (msg.type === 'assistant_token') {
            setStreamingText((prev) => prev + (msg.delta || ''));
          } else if (msg.type === 'assistant_done') {
            setStreamingText('');
            setActiveTool(null);
            if (msg.engine_mode) setEngineMode(msg.engine_mode);
            if (msg.metrics) setLastMetrics(msg.metrics);
            if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
              setSessionToolEvents((prev) => [...msg.tool_calls, ...prev].slice(0, 30));
            }
            setMessages((prev) => [
              ...prev,
              {
                id: `a-${Date.now()}`,
                role: 'assistant',
                content: msg.text,
                language: msg.language || respLangRef.current,
                toolCalls: msg.tool_calls || [],
                metrics: msg.metrics || null,
                createdAt: new Date().toISOString(),
              },
            ]);
            speakResponse(msg.text, msg.language || respLangRef.current, msg.audio_wav_base64);
          }
        } catch {
          // ignore malformed event
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedByUnmount) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };

      ws.onerror = () => {
        setWsConnected(false);
      };
    };

    connect();
    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [setState, speakResponse]);

  const interruptAssistant = useCallback(() => {
    stopSpeechPlayback();
    setStreamingText('');
    setActiveTool(null);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
    setState(CONVERSATION_STATES.INTERRUPTED);
    setTimeout(() => {
      resumeListeningIfActive((t) => sendTextTurn(t, 45));
    }, 150);
  }, [resumeListeningIfActive, sendTextTurn, setState, stopSpeechPlayback]);

  const handleVadUtteranceEnd = useCallback(
    (wavBase64) => {
      setSpeechDetected(false);
      const elapsedSpeechMs = speechStartAtRef.current
        ? Math.round(performance.now() - speechStartAtRef.current)
        : 0;

      // Path A: Browser SpeechRecognition already has interim text -> force immediate finalize!
      const pendingInterim = interimTextRef.current.trim();
      if (pendingInterim) {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            // ignore
          }
        }
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(() => {
          const stillPending = interimTextRef.current.trim();
          if (stillPending) {
            interimTextRef.current = '';
            setInterimTranscript('');
            sendTextTurn(stillPending, Math.min(250, elapsedSpeechMs || 60));
          }
        }, 220);
        return;
      }

      // Path B: If SpeechRecognition gave nothing recently (e.g. offline/unsupported), send WAV to backend
      const recentlySubmitted = Date.now() - lastSubmittedRef.current.at < 1400;
      if (!recentlySubmitted && wavBase64 && wsRef.current?.readyState === WebSocket.OPEN) {
        setState(CONVERSATION_STATES.TRANSCRIBING);
        wsRef.current.send(
          JSON.stringify({
            type: 'audio_utterance',
            conversation_id: convIdRef.current,
            wav_base64: wavBase64,
            stt_language: sttLangRef.current,
            response_language: respLangRef.current,
            voice_id: voiceIdRef.current,
          })
        );
      }
    },
    [sendTextTurn, setState]
  );

  const startVoiceSession = useCallback(async () => {
    setErrorMessage('');
    setSttNotice('');
    try {
      const vad = new LocalAudioVadCapture({
        onLevel: (rms, speech) => {
          setAudioLevel(rms);
          if (
            speech &&
            headphonesRef.current &&
            stateRef.current === CONVERSATION_STATES.SPEAKING &&
            rms > 0.055
          ) {
            interruptAssistant();
          }
        },
        onSpectrum: (bands) => setSpectrum(bands),
        onSpeechStart: () => {
          speechStartAtRef.current = performance.now();
          setSpeechDetected(true);
        },
        onSpeechEnd: handleVadUtteranceEnd,
      });

      await vad.start();
      vadRef.current = vad;
      setMicActive(true);
      setMuted(false);
      setState(CONVERSATION_STATES.LISTENING);

      createAndStartRecognition((finalText) => {
        sendTextTurn(finalText, 50);
      });
    } catch (err) {
      setMicActive(false);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not access microphone. Check browser mic permissions.'
      );
      setState(CONVERSATION_STATES.ERROR);
    }
  }, [createAndStartRecognition, handleVadUtteranceEnd, interruptAssistant, sendTextTurn, setState]);

  const stopVoiceSession = useCallback(() => {
    stopSpeechPlayback();
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (vadRef.current) {
      vadRef.current.stop();
      vadRef.current = null;
    }
    setMicActive(false);
    setAudioLevel(0);
    setSpectrum(new Array(32).fill(0));
    setSpeechDetected(false);
    setInterimTranscript('');
    interimTextRef.current = '';
    setSttEngineLabel('Standby');
    setState(CONVERSATION_STATES.IDLE);
  }, [setState, stopSpeechPlayback]);

  const flushSpeechNow = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.flushUtterance();
    } else if (interimTextRef.current.trim()) {
      const txt = interimTextRef.current.trim();
      interimTextRef.current = '';
      setInterimTranscript('');
      sendTextTurn(txt, 50);
    }
  }, [sendTextTurn]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (vadRef.current) vadRef.current.setMuted(next);
      return next;
    });
  }, []);

  const loadConversation = useCallback(async (convId) => {
    try {
      const res = await authFetch(`/api/conversations/${encodeURIComponent(convId)}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      setConversationId(convId);
      setMessages(
        (data.messages || []).map((m, idx) => ({
          id: `db-${m.id || idx}`,
          role: m.role,
          content: m.content,
          language: m.language || 'en',
          createdAt: m.created_at,
        }))
      );
    } catch {
      // ignore
    }
  }, []);

  const startNewConversation = useCallback(() => {
    stopSpeechPlayback();
    setConversationId(`session-${Date.now()}`);
    setMessages([]);
    setStreamingText('');
    setSessionToolEvents([]);
    setLastMetrics(null);
    setSttNotice('');
  }, [stopSpeechPlayback]);

  const activeVoice = availableVoices.find((v) => v.id === selectedVoiceId) || null;
  const languageWarning = checkVoiceLanguageCompatibility(
    responseLanguage,
    activeVoice,
    availableVoices
  ).warning;

  return {
    state,
    errorMessage,
    sttNotice,
    conversationId,
    messages,
    streamingText,
    interimTranscript,
    activeTool,
    sessionToolEvents,
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
    loadConversation,
    startNewConversation,
  };
}
