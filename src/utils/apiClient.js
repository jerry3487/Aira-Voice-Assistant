let tokenProvider = null;

export function setTokenProvider(fn) {
  tokenProvider = typeof fn === 'function' ? fn : null;
}

export async function getFreshAuthToken() {
  if (!tokenProvider) return '';
  try {
    const token = await tokenProvider();
    return token || '';
  } catch {
    return '';
  }
}

export function buildVoiceWebSocketUrl(protocol, host, token) {
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:';
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${wsProto}//${host}/ws/voice${qs}`;
}

export async function authFetch(url, options = {}) {
  const token = await getFreshAuthToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
}
