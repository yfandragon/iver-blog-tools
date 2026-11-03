import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { createServer } from 'vite';
import { createApplication } from './app.js';

function request(port: number, pathname: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port, path: pathname, method: options.method ?? 'GET',
      headers: { host: `localhost:${port}`, ...options.headers },
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('requires the same-origin local session and an explicit publish confirmation', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false } });
  const app = await createApplication({ vite });
  try {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    const root = await request(port, '/');
    assert.equal(root.status, 200);
    const cookie = root.headers['set-cookie']?.[0]?.split(';', 1)[0];
    assert.ok(cookie?.startsWith('local_session='));

    const unauthorized = await request(port, '/api/providers');
    assert.equal(unauthorized.status, 401);
    const origin = `http://localhost:${port}`;
    const providers = await request(port, '/api/providers', { headers: { cookie: cookie!, origin } });
    assert.equal(providers.status, 200);
    assert.match(providers.body, /"antigravity"/);

    const noConfirmation = await request(port, '/api/tasks/missing/publish', {
      method: 'POST', headers: { cookie: cookie!, origin, 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(noConfirmation.status, 403);
    const wrongOrigin = await request(port, '/api/providers', { headers: { cookie: cookie!, origin: 'http://evil.test' } });
    assert.equal(wrongOrigin.status, 403);
  } finally {
    await app.close();
    await vite.close();
  }
});
