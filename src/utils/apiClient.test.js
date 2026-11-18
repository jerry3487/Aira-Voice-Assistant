import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVoiceWebSocketUrl,
  getFreshAuthToken,
  setTokenProvider,
} from './apiClient.js';

test('setTokenProvider supplies fresh Clerk session tokens cleanly', async () => {
  setTokenProvider(null);
  assert.equal(await getFreshAuthToken(), '');

  setTokenProvider(async () => 'clerk_jwt_123');
  assert.equal(await getFreshAuthToken(), 'clerk_jwt_123');

  setTokenProvider(async () => {
    throw new Error('token error');
  });
  assert.equal(await getFreshAuthToken(), '');

  setTokenProvider(null);
});

test('buildVoiceWebSocketUrl encodes token and matches HTTP/HTTPS protocol', () => {
  assert.equal(
    buildVoiceWebSocketUrl('http:', 'localhost:3000', 'abc.def+1'),
    'ws://localhost:3000/ws/voice?token=abc.def%2B1'
  );
  assert.equal(
    buildVoiceWebSocketUrl('https:', 'aira.example.com', ''),
    'wss://aira.example.com/ws/voice'
  );
});
