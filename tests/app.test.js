import { afterEach, describe, expect, it } from 'vitest';
import app from '../src/app.js';

let server;

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = undefined;
  await new Promise((resolve, reject) => {
    closing.close((err) => (err ? reject(err) : resolve()));
  });
});

function listen() {
  return new Promise((resolve, reject) => {
    server = app.listen(0, () => resolve(server.address().port));
    server.once('error', reject);
  });
}

describe('app', () => {
  it('serves the Finch Sandbox page at /', async () => {
    const port = await listen();
    const response = await fetch('http://127.0.0.1:' + port + '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Finch Sandbox');
    expect(html).toContain('js/main.js');
  });

  it('answers the health check with the store kind', async () => {
    const port = await listen();
    const response = await fetch('http://127.0.0.1:' + port + '/health');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(['pg', 'memory']).toContain(body.store);
  });

  it('keeps the page and the health check public but asks for a session on /api data routes (d-29)', async () => {
    const port = await listen();
    const origin = 'http://127.0.0.1:' + port;
    expect((await fetch(origin + '/')).status).toBe(200);
    expect((await fetch(origin + '/health')).status).toBe(200);
    expect((await fetch(origin + '/api/template')).status).toBe(200);
    const profiles = await fetch(origin + '/api/profiles');
    expect(profiles.status).toBe(401);
    expect((await profiles.json()).error).toBe('no session');
    const session = await fetch(origin + '/api/session', { method: 'POST' });
    expect(session.status).toBe(200);
    const cookie = session.headers.get('set-cookie');
    expect(cookie).toMatch(/^finch_session=[A-Za-z0-9_-]{43}; /);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});
