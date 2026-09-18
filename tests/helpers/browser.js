// One browser for API tests (not a suite: vitest only collects *.test.js). It keeps the session
// cookie the server sets — including a cleared one — and starts a session before its first data
// call, the way public/js/profiles.js does on boot. Two browsers are two people; one browser
// registering, signing in or splitting changes who it is, exactly as in the app.
export function makeBrowser(base) {
  let cookie = '';
  let lastSetCookie = null;
  let started = false;
  async function raw(method, path, body) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    const response = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = response.headers.get('set-cookie');
    if (set) {
      lastSetCookie = set;
      cookie = set.split(';')[0];
    }
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }
  const client = async (method, path, body) => {
    if (!started) {
      started = true;
      if (path !== '/api/session') await raw('POST', '/api/session', {});
    }
    return raw(method, path, body);
  };
  Object.defineProperty(client, 'cookie', { get: () => cookie });
  Object.defineProperty(client, 'lastSetCookie', { get: () => lastSetCookie });
  return client;
}
