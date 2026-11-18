import { classifyVadFrame } from './voiceStateMachine.js';

function downsampleBuffer(buffer, inputRate, targetRate = 16000) {
  if (inputRate === targetRate) return buffer;
  const ratio = inputRate / targetRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function encodeWavBase64(floatChunks, inputRate, targetRate = 16000) {
  let totalLen = 0;
  for (const c of floatChunks) totalLen += c.length;
  if (totalLen === 0) return '';

  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const c of floatChunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const resampled = downsampleBuffer(merged, inputRate, targetRate);
  const buffer = new ArrayBuffer(44 + resampled.length * 2);
  const view = new DataView(buffer);

  const writeStr = (pos, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(pos + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + resampled.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, resampled.length * 2, true);

  let idx = 44;
  for (let i = 0; i < resampled.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, resampled[i]));
    view.setInt16(idx, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    idx += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Real-time Web Audio API microphone capture + client-side VAD monitor
 * with 32-band spectrum telemetry and pre-rolled WAV utterance recording.
 */
export class LocalAudioVadCapture {
  constructor({
    onLevel,
    onSpectrum,
    onSpeechStart,
    onSpeechEnd,
    silenceMs = 850,
    threshold = 0.016,
  } = {}) {
    this.onLevel = onLevel;
    this.onSpectrum = onSpectrum;
    this.onSpeechStart = onSpeechStart;
    this.onSpeechEnd = onSpeechEnd;
    this.silenceMs = silenceMs;
    this.threshold = threshold;

    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.processor = null;
    this.rafId = null;

    this.isSpeaking = false;
    this.lastSpeechAt = 0;
    this.muted = false;
    this.paused = false;

    this.preRollChunks = [];
    this.utteranceChunks = [];
  }

  async start() {
    if (this.stream) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone capture is not supported in this browser.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContextCtor();
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    source.connect(this.analyser);

    // Record PCM chunks for local faster-whisper fallback
    this.processor = this.audioCtx.createScriptProcessor(2048, 1, 1);
    source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);

    this.processor.onaudioprocess = (event) => {
      if (this.muted || this.paused) return;
      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      if (this.isSpeaking) {
        this.utteranceChunks.push(copy);
      } else {
        this.preRollChunks.push(copy);
        if (this.preRollChunks.length > 4) this.preRollChunks.shift();
      }
    };

    const timeBuf = new Float32Array(this.analyser.fftSize);
    const freqBuf = new Uint8Array(this.analyser.frequencyBinCount);

    const loop = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(timeBuf);
      this.analyser.getByteFrequencyData(freqBuf);

      const silent = this.muted || this.paused;
      const { rms, speech } = silent
        ? { rms: 0, speech: false }
        : classifyVadFrame(timeBuf, this.threshold);

      if (this.onLevel) this.onLevel(rms, speech);
      if (this.onSpectrum) {
        const bands = [];
        const step = Math.max(1, Math.floor(freqBuf.length / 32));
        for (let i = 0; i < 32; i += 1) {
          bands.push(silent ? 0 : freqBuf[Math.min(freqBuf.length - 1, i * step)] / 255);
        }
        this.onSpectrum(bands);
      }

      if (!this.paused && !this.muted) {
        const now = performance.now();
        if (speech) {
          this.lastSpeechAt = now;
          if (!this.isSpeaking) {
            this.isSpeaking = true;
            this.utteranceChunks = [...this.preRollChunks];
            this.preRollChunks = [];
            if (this.onSpeechStart) this.onSpeechStart();
          }
        } else if (this.isSpeaking && now - this.lastSpeechAt >= this.silenceMs) {
          this.flushUtterance();
        }
      }

      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  flushUtterance() {
    if (!this.isSpeaking && this.utteranceChunks.length === 0) return;
    this.isSpeaking = false;
    const chunks = this.utteranceChunks;
    this.utteranceChunks = [];
    const rate = this.audioCtx?.sampleRate || 48000;
    const wavBase64 = encodeWavBase64(chunks, rate, 16000);
    if (this.onSpeechEnd) this.onSpeechEnd(wavBase64);
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      this.isSpeaking = false;
      this.utteranceChunks = [];
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.stream) {
      for (const track of this.stream.getAudioTracks()) {
        track.enabled = !this.muted;
      }
    }
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.analyser = null;
    this.isSpeaking = false;
    this.utteranceChunks = [];
    this.preRollChunks = [];
  }
}
