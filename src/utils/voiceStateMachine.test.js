import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERSATION_STATES,
  transitionVoiceState,
  checkVoiceLanguageCompatibility,
  classifyVadFrame,
  formatDurationMs,
} from './voiceStateMachine.js';

test('state machine transitions through full voice turn and barge-in interruption', () => {
  let state = CONVERSATION_STATES.IDLE;
  state = transitionVoiceState(state, CONVERSATION_STATES.LISTENING);
  assert.equal(state, 'LISTENING');
  state = transitionVoiceState(state, CONVERSATION_STATES.TRANSCRIBING);
  assert.equal(state, 'TRANSCRIBING');
  state = transitionVoiceState(state, CONVERSATION_STATES.THINKING);
  assert.equal(state, 'THINKING');
  state = transitionVoiceState(state, CONVERSATION_STATES.TOOL_EXECUTING);
  assert.equal(state, 'TOOL_EXECUTING');
  state = transitionVoiceState(state, CONVERSATION_STATES.SPEAKING);
  assert.equal(state, 'SPEAKING');
  state = transitionVoiceState(state, CONVERSATION_STATES.INTERRUPTED);
  assert.equal(state, 'INTERRUPTED');
  state = transitionVoiceState(state, CONVERSATION_STATES.LISTENING);
  assert.equal(state, 'LISTENING');
});

test('language compatibility warns accurately when selected TTS voice mismatches language', () => {
  const voices = [
    { id: 'en-US', name: 'English US', lang: 'en-US' },
    { id: 'es-ES', name: 'Spanish ES', lang: 'es-ES' },
  ];
  const mismatch = checkVoiceLanguageCompatibility('ta', voices[0], voices);
  assert.equal(mismatch.compatible, false);
  assert.match(mismatch.warning, /ta/);

  const match = checkVoiceLanguageCompatibility('es', voices[1], voices);
  assert.equal(match.compatible, true);
  assert.equal(match.warning, null);
});

test('VAD classifier separates silence from speech energy frames', () => {
  const silence = new Float32Array([0.001, -0.002, 0.001, 0.0]);
  assert.equal(classifyVadFrame(silence, 0.018).speech, false);

  const speech = new Float32Array([0.12, -0.15, 0.09, -0.11]);
  const res = classifyVadFrame(speech, 0.018);
  assert.equal(res.speech, true);
  assert.ok(res.rms > 0.05);
});

test('formatDurationMs formats sub-second and multi-second durations cleanly', () => {
  assert.equal(formatDurationMs(42.4), '42 ms');
  assert.equal(formatDurationMs(1480), '1.48 s');
});
