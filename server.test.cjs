const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp, passwordHash } = require('./server.cjs');
const { resetAdmin } = require('./reset-admin.cjs');

function requestWithHost(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request(url, { method: options.method || 'GET', headers: options.headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          for (const entry of Array.isArray(value) ? value : [value]) if (entry !== undefined) headers.append(key, entry);
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

test('recupera administrador sem apagar leads ou alterar outros usuários', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-recovery-test-'));
  const { server, db } = createApp({ dataDir, publicOrigin: '' });
  const old = passwordHash('senha-antiga-do-teste');
  db.prepare('INSERT INTO admins(username,salt,hash) VALUES(?,?,?)').run('admin.motorize', old.salt, old.hash);
  db.prepare('INSERT INTO admins(username,salt,hash) VALUES(?,?,?)').run('outro.admin', old.salt, old.hash);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('sessao-antiga', 'admin.motorize', Date.now() + 60000);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run('outra-sessao', 'outro.admin', Date.now() + 60000);
  db.prepare('INSERT INTO leads VALUES(?,?,?,?,?,?,?,?)').run('lead-existente', 'token', 'form', 'started', '{"company":"Contato preservado"}', '2026-10-27', '2026-10-27', null);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    resolve();
  })));
  const recovered = resetAdmin({ dataDir, username: 'admin.motorize' });
  assert.equal(recovered.username, 'admin.motorize');
  assert.match(recovered.password, /^[a-zA-Z0-9_-]{32}$/);
  assert.equal(db.prepare('SELECT hash FROM admins WHERE username=?').get('outro.admin').hash, old.hash);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE username=?').get('admin.motorize').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE username=?').get('outro.admin').n, 1);
  assert.equal(db.prepare('SELECT data FROM leads WHERE id=?').get('lead-existente').data, '{"company":"Contato preservado"}');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  const response = await fetch(base + '/api/admin/login', { method: 'POST', headers, body: JSON.stringify(recovered) });
  assert.equal(response.status, 200, 'nova senha permite login');
  const rejected = await fetch(base + '/api/admin/login', { method: 'POST', headers, body: JSON.stringify({ username: recovered.username, password: 'senha-antiga-do-teste' }) });
  assert.equal(rejected.status, 401, 'senha anterior deixa de funcionar');
});

test('recuperação recusa pasta errada sem criar banco vazio', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-recovery-missing-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  assert.throws(() => resetAdmin({ dataDir }), /Banco não encontrado/);
  assert.equal(fs.existsSync(path.join(dataDir, 'motorize.sqlite')), false);
});

test('registra, qualifica e lista um lead com autenticação', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-test-'));
  const { server, db } = createApp({ dataDir });
  const credentials = passwordHash('senha-segura');
  db.prepare('INSERT INTO admins(username,salt,hash) VALUES(?,?,?)').run('admin', credentials.salt, credentials.hash);
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
  response = await fetch(`${base}/api/leads`, { method: 'POST', headers, body: JSON.stringify({ ...identity, status: 'started', data: started, attribution: { source: 'google', medium: 'cpc', campaign: 'diagnostico', referrer: 'https://google.com/search?segredo=1' } }) });
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
  assert.equal(result.leads[0].data.attribution.source, 'google', 'preserva origem ao completar sem reenviar atribuição');
  assert.equal(result.leads[0].data.attribution.referrer, 'google.com', 'não salva caminho ou parâmetros de referência');
  const dashboard = await (await fetch(`${base}/api/admin/dashboard?days=30`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(dashboard.origins, [{ label: 'Google Ads', total: 1, qualified: 1 }]);
});

test('classifica origens sem inventar atribuição de registros antigos', () => {
  const { normalize, label } = require('./dist/attribution.js');
  assert.equal(label(null), 'Origem não registrada');
  assert.equal(label(normalize({})), 'Direto / sem referência');
  assert.equal(label(normalize({ referrer: 'https://www.google.com.br/search?q=x' })), 'Google · busca orgânica');
  assert.equal(label(normalize({ referrer: 'https://google.com.evil.example' })), 'google.com.evil.example');
  assert.equal(label(normalize({ source: 'instagram', medium: 'paid_social' })), 'Instagram · anúncio');
  assert.equal(label(normalize({ googleAds: true })), 'Google Ads');
  assert.equal(normalize({ referrer: 'javascript:alert(1)' }).referrer, '');
  assert.equal(normalize({ campaign: 'x'.repeat(500) }).campaign.length, 160);
  assert.deepEqual(normalize(normalize({ referrer: 'https://www.instagram.com/path?private=1' })), normalize({ referrer: 'https://www.instagram.com/' }), 'normalização do navegador e servidor preserva domínio');
});

test('captura origem no navegador e preserva após recarga antes de salvar formulário ou chat', async () => {
  const vm = require('node:vm');
  const storage = new Map();
  const payloads = [];
  function page(search, referrer) {
    const context = {
      URL, URLSearchParams, crypto: require('node:crypto').webcrypto,
      location: { search, origin: 'https://motorize.agenciatupiniquim.com.br' },
      document: { referrer, addEventListener() {} },
      sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
      innerWidth: 1200, addEventListener() {}, setTimeout() {}, clearTimeout() {},
      fetch: async (url, options) => { payloads.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true }) }; }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'dist/attribution.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'dist/capture.js'), 'utf8'), context);
    return context;
  }
  const initial = page('?utm_source=instagram&utm_medium=paid_social&utm_campaign=oferta', 'https://instagram.com/path');
  await initial.motorizeSave('form', 'started', {});
  const reload = page('', 'https://motorize.agenciatupiniquim.com.br/');
  await reload.motorizeSave('chat', 'started', {});
  const saved = payloads.filter((item) => item.url === '/api/leads');
  assert.equal(saved.length, 2);
  assert.equal(saved[0].body.attribution.source, 'instagram');
  assert.deepEqual(saved[0].body.attribution, saved[1].body.attribution);
  assert.equal(saved[0].body.attribution.referrer, 'instagram.com');
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
  db.prepare('INSERT INTO admins(username,salt,hash) VALUES(?,?,?)').run('teste', credentials.salt, credentials.hash);
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

for (const previousOrigin of ['', 'https://rodrigoo45.sg-host.com']) {
  test(`domínio oficial funciona com PUBLIC_ORIGIN ${previousOrigin || 'ausente'}`, async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-domain-test-'));
    const { server, db } = createApp({ dataDir, publicOrigin: previousOrigin });
    const credentials = passwordHash('senha-apenas-do-teste');
    db.prepare('INSERT INTO admins(username,salt,hash) VALUES(?,?,?)').run('teste', credentials.salt, credentials.hash);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(() => {
      fs.rmSync(dataDir, { recursive: true, force: true });
      resolve();
    })));
    const url = `http://127.0.0.1:${server.address().port}`;
    const official = 'https://motorize.agenciatupiniquim.com.br';
    const headers = { Host: 'motorize.agenciatupiniquim.com.br', Origin: official, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ username: 'teste', password: 'senha-apenas-do-teste' });
    let response = await requestWithHost(url + '/api/admin/dashboard', { headers });
    assert.equal(response.status, 401, 'sem sessão pede autenticação, não rejeita o domínio');
    response = await requestWithHost(url + '/api/admin/login', { method: 'POST', headers: { ...headers, Origin: 'https://rodrigoo45.sg-host.com' }, body });
    assert.equal(response.status, 403, 'origem provisória não pode autenticar no domínio oficial');
    response = await requestWithHost(url + '/api/admin/login', { method: 'POST', headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' }, body });
    assert.equal(response.status, 403);
    response = await requestWithHost(url + '/api/admin/dashboard', { headers: { ...headers, Host: 'invasor.example', 'X-Forwarded-Host': headers.Host } });
    assert.equal(response.status, 403, 'cabeçalho encaminhado não libera um host desconhecido');
    response = await requestWithHost(url + '/api/admin/dashboard', { headers: { ...headers, Host: 'rodrigoo45.sg-host.com' } });
    assert.equal(response.status, 403, 'host provisório foi aposentado');
    response = await requestWithHost(url + '/api/admin/login', { method: 'POST', headers, body });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie');
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.doesNotMatch(cookie, /Domain=/i, 'a sessão pertence somente ao host atual');
    const authenticated = { ...headers, Cookie: cookie.split(';')[0] };
    response = await requestWithHost(url + '/api/admin/dashboard', { headers: authenticated });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-motorize-api-version'), '2026-10-27-accounts');
  });
}
