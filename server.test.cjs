const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, passwordHash } = require('./server.cjs');

test('registra, qualifica e lista um lead com autenticação', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-test-'));
  const { server, db } = createApp({ dataDir });
  const credentials = passwordHash('senha-segura');
  db.prepare('INSERT INTO admins VALUES(?,?,?)').run('admin', credentials.salt, credentials.hash);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(() => { fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); })));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  const attempt = { id: crypto.randomUUID(), token: 'a'.repeat(64), source: 'form', stage: 'business' };
  let response = await fetch(`${base}/api/funnel`, { method: 'POST', headers, body: JSON.stringify(attempt) });
  assert.equal(response.status, 200);
  const identity = { id: crypto.randomUUID(), token: 'b'.repeat(64), source: 'form', attemptId: attempt.id, attemptToken: attempt.token };
  const started = { name: 'Ana', email: 'ana@grupo.com.br', phone: '(11) 99999-9999' };
  response = await fetch(`${base}/api/leads`, { method: 'POST', headers, body: JSON.stringify({ ...identity, status: 'started', data: started }) });
  assert.equal(response.status, 200);
  const completed = { ...started, company: 'Grupo Avenida', role: 'Diretor(a)', city: 'Campinas, SP', stores: '2 a 5 lojas', budget: 'R$ 30 mil a R$ 80 mil', challenge: 'Gerar mais leads qualificados', timeline: 'Nos próximos 30 dias', details: 'Meta de expansão.' };
  response = await fetch(`${base}/api/leads`, { method: 'POST', headers, body: JSON.stringify({ ...identity, status: 'completed', data: completed }) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/api/admin/login`, { method: 'POST', headers, body: JSON.stringify({ username: 'admin', password: 'senha-segura' }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  response = await fetch(`${base}/api/admin/leads?days=30`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].data.company, 'Grupo Avenida');
  assert.equal(result.leads[0].status, 'completed');
});

test('rejeita qualificação B2B incompleta', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-test-'));
  const { server } = createApp({ dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(() => { fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); })));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  const attempt = { id: crypto.randomUUID(), token: 'c'.repeat(64), source: 'chat', stage: 'company' };
  await fetch(`${base}/api/funnel`, { method: 'POST', headers, body: JSON.stringify(attempt) });
  const response = await fetch(`${base}/api/leads`, {
    method: 'POST', headers,
    body: JSON.stringify({ id: crypto.randomUUID(), token: 'd'.repeat(64), source: 'chat', status: 'completed', attemptId: attempt.id, attemptToken: attempt.token, data: { name: 'Bia', email: 'bia@grupo.com', phone: '11999999999', company: 'Grupo B' } })
  });
  assert.equal(response.status, 400);
});

test('domínio público, cookie seguro e arquivos de migração', async (t) => {
  // http.request preserves the Host header used by a reverse proxy.
  const fetch = (url, options = {}) => new Promise((resolve, reject) => {
    const req = require('node:http').request(url, { method: options.method || 'GET', headers: options.headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          for (const entry of Array.isArray(value) ? value : [value]) if (entry !== undefined) responseHeaders.append(key, entry);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: responseHeaders }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(options.body);
  });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-public-test-'));
  const publicOrigin = 'https://concessionarias.exemplo.com.br';
  const { server, db } = createApp({ dataDir, publicOrigin });
  const credentials = passwordHash('senha-de-teste');
  db.prepare('INSERT INTO admins VALUES(?,?,?)').run('teste', credentials.salt, credentials.hash);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(() => { fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: new URL(publicOrigin).host, Origin: publicOrigin, 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/')).status, 403);
  for (const file of ['/', '/admin/', '/assets/hero-dealership.png', '/capture.js']) {
    assert.equal((await fetch(base + file, { headers })).status, 200, file);
  }
  assert.equal((await fetch(base + '/api/admin/dashboard', { headers })).status, 401);
  assert.equal((await fetch(base + '/api/admin/login', { method: 'POST', headers: { ...headers, Origin: 'https://outro.exemplo' }, body: '{}' })).status, 403);
  const login = await fetch(base + '/api/admin/login', { method: 'POST', headers, body: JSON.stringify({ username: 'teste', password: 'senha-de-teste' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /; Secure/);
  const authHeaders = { ...headers, Cookie: cookie.split(';')[0] };
  for (const route of ['/api/admin/dashboard', '/api/admin/leads', '/api/admin/heatmap']) {
    assert.equal((await fetch(base + route, { headers: authHeaders })).status, 200, route);
  }
  assert.equal((await fetch(base + '/api/admin/logout', { method: 'POST', headers: authHeaders, body: '{}' })).status, 200);
  assert.equal((await fetch(base + '/api/admin/dashboard', { headers: authHeaders })).status, 401);
});
