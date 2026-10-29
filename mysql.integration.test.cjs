const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('./server.cjs');
const { openMySQL } = require('./mysql-db.cjs');

test('MySQL real: usuários, leads, métricas, recuperação e persistência após reinício', { skip: !process.env.MYSQL_TEST_DATABASE }, async (t) => {
  // This suite runs only against an explicitly named disposable test database.
  const name = process.env.MYSQL_TEST_DATABASE;
  assert.match(name, /^motorize_test_[a-f0-9]+$/);
  const env = { MYSQL_HOST: '127.0.0.1', MYSQL_PORT: process.env.MYSQL_TEST_PORT || '3306', MYSQL_DATABASE: name, MYSQL_USER: 'root', MYSQL_PASSWORD: process.env.MYSQL_TEST_PASSWORD };
  const mysql = require('mysql2/promise');
  const control = await mysql.createConnection({ host: env.MYSQL_HOST, port: env.MYSQL_PORT, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD });
  await control.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  t.after(async () => { await control.query(`DROP DATABASE \`${name}\``); await control.end(); });
  const owner = { username: 'OwnerTeste', email: 'owner@example.com', password: 'Senha-ficticia-Teste-2026!' };
  const sent = [];
  let app;
  async function start() {
    app = createApp({ database: openMySQL(env), publicOrigin: '', ownerConfig: owner, mailer: async (mail) => sent.push(mail) });
    await app.ready;
    await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${app.server.address().port}`;
  }
  async function stop() {
    if (!app) return;
    if (app.server.listening) await new Promise((resolve) => app.server.close(resolve));
    if (!app.db.closed) app.db.closed = app.db.close();
    await app.db.closed;
  }
  t.after(stop);
  let base = await start();
  async function api(route, body, cookie) {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  }
  let login = await api('/api/admin/login', { username: owner.username, password: owner.password });
  assert.equal(login.status, 200);
  let cookie = login.cookie;
  assert.equal((await api('/api/admin/users/create', { username: 'ClienteTeste', email: 'client@example.com', name: 'Cliente de teste', role: 'client', active: true, password: owner.password }, cookie)).status, 201);
  const client = await api('/api/admin/login', { username: 'client@example.com', password: owner.password });
  assert.equal((await api('/api/admin/users', null, client.cookie)).status, 403);
  assert.equal((await api('/api/admin/dashboard', null, client.cookie)).status, 200);
  const attempt = { id: crypto.randomUUID(), token: 'a'.repeat(64), source: 'form', stage: 'contact' };
  assert.equal((await api('/api/funnel', attempt)).status, 200);
  const identity = { id: crypto.randomUUID(), token: 'b'.repeat(64), source: 'form', attemptId: attempt.id, attemptToken: attempt.token };
  const contact = { name: 'Contato fictício', email: 'lead@example.com', phone: '11999999999', company: 'Empresa fictícia' };
  assert.equal((await api('/api/leads', { ...identity, status: 'started', data: contact, attribution: { source: 'google', medium: 'cpc' } })).status, 200);
  const qualified = { ...contact, role: 'Diretor(a)', city: 'São Paulo', stores: '1 loja', budget: 'Até R$ 10 mil', challenge: 'Gerar leads qualificados', timeline: 'Imediatamente' };
  assert.equal((await api('/api/leads', { ...identity, status: 'completed', data: qualified })).status, 200);
  assert.equal((await api('/api/funnel', { ...attempt, stage: 'business' })).status, 200);
  const visit = crypto.randomUUID();
  assert.equal((await api('/api/analytics', { type: 'view', visit, session: crypto.randomUUID(), device: 'desktop' })).status, 200);
  assert.equal((await api('/api/analytics', { type: 'depth', visit, depth: 100 })).status, 200);
  assert.equal((await api('/api/analytics', { type: 'depth', visit, depth: 25 })).status, 200);
  assert.equal((await api('/api/analytics', { type: 'click', visit, section: 'inicio', target: 'Diagnóstico', x: .4, y: .6 })).status, 200);
  const dashboard = await api('/api/admin/dashboard', null, cookie);
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.data.depth.d100, 1);
  assert.deepEqual(dashboard.data.origins, [{ label: 'Google Ads', total: 1, qualified: 1 }]);
  assert.equal(dashboard.data.funnel[0].completed, 1);
  assert.equal(dashboard.data.daily[0].n, 1);
  assert.equal((await api('/api/admin/heatmap?section=inicio', null, cookie)).data.points.length, 1);
  await stop();
  base = await start();
  login = await api('/api/admin/login', { username: owner.email, password: owner.password });
  assert.equal(login.status, 200);
  cookie = login.cookie;
  assert.equal((await api('/api/admin/leads', null, cookie)).data.leads.length, 1, 'lead sobrevive ao reinício');
  assert.equal((await api('/api/admin/users', null, cookie)).data.users.length, 2, 'usuários persistem');
  assert.equal((await api('/api/admin/dashboard', null, cookie)).data.views.n, 1, 'métricas persistem');
  assert.equal((await api('/api/auth/recovery', { email: owner.email })).status, 200);
  const token = sent[0].resetUrl.split('#reset=')[1];
  const results = await Promise.all([api('/api/auth/reset', { token, password: 'Outra-senha-ficticia-2026!' }), api('/api/auth/reset', { token, password: 'Outra-senha-ficticia-2026!' })]);
  assert.deepEqual(results.map((item) => item.status).sort(), [200, 400], 'token consumido apenas uma vez mesmo com concorrência');
});
