const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApp, openDB, passwordHash } = require('./server.cjs');
const accounts = require('./accounts.cjs');

const owner = { username: 'Dono_Teste', email: 'dono@example.com', password: 'Senha-ficticia-owner-2026!' };
async function fixture(t, { mailer } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-accounts-'));
  const app = createApp({ dataDir, publicOrigin: '', ownerConfig: owner, mailer });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(() => { fs.rmSync(dataDir, { recursive: true, force: true }); resolve(); })));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (route, body, cookie = '') => {
    const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: {
      Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {})
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = async (username = owner.username, password = owner.password) => {
    const result = await request('/api/admin/login', { username, password });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.cookie;
  };
  const createUser = (cookie, username, role, extra = {}) => request('/api/admin/users/create', {
    name: `Pessoa ${username}`, username, email: `${username.toLowerCase()}@example.com`,
    role, active: true, password: 'Senha-ficticia-user-2026!', ...extra
  }, cookie);
  return { ...app, request, login, createUser };
}

test('migração preserva administradores legados e dados comerciais', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motorize-legacy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const legacy = new DatabaseSync(path.join(dir, 'motorize.sqlite'));
  legacy.exec('CREATE TABLE admins(username TEXT PRIMARY KEY,salt TEXT NOT NULL,hash TEXT NOT NULL);');
  legacy.prepare('INSERT INTO admins VALUES(?,?,?)').run('antigo', 'salt-preservado', 'hash-preservado');
  legacy.close();
  const db = openDB(dir);
  const user = db.prepare('SELECT * FROM admins WHERE username=?').get('antigo');
  assert.equal(user.salt, 'salt-preservado'); assert.equal(user.hash, 'hash-preservado');
  assert.equal(user.role, 'administrator'); assert.equal(user.active, 1);
  accounts.migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM admins').get().n, 1);
  db.close();
});

test('dono é único e o bootstrap não regrava sua senha a cada reinício', async (t) => {
  const f = await fixture(t);
  const before = f.db.prepare('SELECT hash FROM admins WHERE username=?').get(owner.username).hash;
  assert.equal(accounts.bootstrapOwner(f.db, { ...owner, password: 'Outra-senha-ficticia-2026!' }), false);
  assert.equal(f.db.prepare('SELECT hash FROM admins WHERE username=?').get(owner.username).hash, before);
  const cookie = await f.login(owner.email.toUpperCase());
  const me = await f.request('/api/admin/me', undefined, cookie);
  assert.equal(me.body.user.role, 'owner');
  assert.equal(me.body.permissions.manageUsers, true);
  assert.equal('hash' in me.body.user, false); assert.equal('salt' in me.body.user, false);
});

test('perfis são verificados na API e usuários ficam separados dos leads', async (t) => {
  const f = await fixture(t), ownerCookie = await f.login();
  assert.equal((await f.createUser(ownerCookie, 'gestor', 'administrator')).status, 201);
  const adminCookie = await f.login('gestor', 'Senha-ficticia-user-2026!');
  assert.equal((await f.createUser(adminCookie, 'cliente', 'client')).status, 201);
  assert.equal((await f.createUser(adminCookie, 'editor', 'editor')).status, 201);
  assert.equal((await f.createUser(adminCookie, 'escalada', 'administrator')).status, 403);
  assert.equal((await f.createUser(ownerCookie, 'segundo-dono', 'owner')).status, 403);
  const ownerChange = { ...owner, name: 'Nome alterado', active: true, role: 'administrator' };
  assert.equal((await f.request('/api/admin/users/update', ownerChange, adminCookie)).status, 403);
  assert.equal((await f.request('/api/admin/users/update', ownerChange, ownerCookie)).status, 403);
  for (const username of ['cliente', 'editor']) {
    const cookie = await f.login(username, 'Senha-ficticia-user-2026!');
    for (const route of ['/api/admin/dashboard', '/api/admin/leads', '/api/admin/heatmap']) assert.equal((await f.request(route, undefined, cookie)).status, 200, route);
    assert.equal((await f.request('/api/admin/users', undefined, cookie)).status, 403);
    assert.equal((await f.createUser(cookie, 'intruso', 'client')).status, 403);
    const identity = await f.request('/api/admin/me', undefined, cookie);
    assert.equal(identity.body.permissions.manageUsers, false);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM leads').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM admins').get().n, 4);
  const list = await f.request('/api/admin/users', undefined, adminCookie);
  assert.deepEqual(list.body.users.map((u) => u.role).sort(), ['client', 'editor']);
  assert.doesNotMatch(JSON.stringify(list.body), /salt|hash|password/);
});

test('desativação encerra sessões e proíbe login; e-mail duplicado é recusado', async (t) => {
  const f = await fixture(t), ownerCookie = await f.login();
  await f.createUser(ownerCookie, 'cliente', 'client');
  const clientCookie = await f.login('cliente', 'Senha-ficticia-user-2026!');
  const updated = { username: 'cliente', name: 'Cliente', email: 'cliente@example.com', role: 'client', active: false };
  assert.equal((await f.request('/api/admin/users/update', updated, ownerCookie)).status, 200);
  assert.equal((await f.request('/api/admin/dashboard', undefined, clientCookie)).status, 401);
  assert.equal((await f.request('/api/admin/login', { username: 'cliente', password: 'Senha-ficticia-user-2026!' })).status, 401);
  assert.equal((await f.createUser(ownerCookie, 'duplicado', 'editor', { email: owner.email })).status, 409);
  assert.equal((await f.request('/api/admin/users/update', { ...owner, name: 'Dono', role: 'owner', active: false }, ownerCookie)).status, 403);
});

test('recuperação envia token pessoal, não o retorna na API e não revela contas existentes', async (t) => {
  const sent = [], f = await fixture(t, { mailer: async (message) => sent.push(message) });
  const ownerCookie = await f.login();
  await f.createUser(ownerCookie, 'cliente', 'client');
  const clientCookie = await f.login('cliente', 'Senha-ficticia-user-2026!');
  const recovery = await f.request('/api/auth/recovery', { email: 'CLIENTE@example.com' });
  const unknown = await f.request('/api/auth/recovery', { email: 'nao-cadastrado@example.com' });
  assert.equal(recovery.status, 200); assert.deepEqual(recovery.body, unknown.body);
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'cliente@example.com');
  assert.ok(sent[0].resetUrl.startsWith('https://motorize.agenciatupiniquim.com.br/admin/#reset='));
  const token = new URLSearchParams(new URL(sent[0].resetUrl).hash.slice(1)).get('reset');
  assert.equal(JSON.stringify(recovery.body).includes(token), false);
  const record = f.db.prepare('SELECT * FROM account_password_resets').get();
  assert.equal(record.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.notEqual(record.token_hash, token);
  assert.equal((await f.request('/api/auth/reset', { token, password: 'curta' })).status, 400);
  assert.equal((await f.request('/api/auth/reset', { token, password: 'Nova-senha-ficticia-2026!' })).status, 200);
  assert.equal((await f.request('/api/admin/dashboard', undefined, clientCookie)).status, 401);
  assert.equal((await f.request('/api/admin/dashboard', undefined, ownerCookie)).status, 200);
  assert.equal((await f.request('/api/auth/reset', { token, password: 'Outra-senha-ficticia-2026!' })).status, 400);
  await f.login('cliente', 'Nova-senha-ficticia-2026!');
});

test('link expirado ou cancelado por edição não redefine senha', async (t) => {
  const sent = [], f = await fixture(t, { mailer: async (message) => sent.push(message) });
  const cookie = await f.login();
  await f.createUser(cookie, 'cliente', 'client');
  await f.request('/api/auth/recovery', { email: 'cliente@example.com' });
  const token = new URLSearchParams(new URL(sent[0].resetUrl).hash.slice(1)).get('reset');
  f.db.prepare('UPDATE account_password_resets SET expires=?').run(Date.now() - 1000);
  assert.equal((await f.request('/api/auth/reset', { token, password: 'Nova-senha-ficticia-2026!' })).status, 400);
  await f.request('/api/auth/recovery', { email: 'cliente@example.com' });
  const next = new URLSearchParams(new URL(sent[1].resetUrl).hash.slice(1)).get('reset');
  await f.request('/api/admin/users/update', { username: 'cliente', name: 'Cliente', email: 'novo@example.com', role: 'client', active: true }, cookie);
  assert.equal((await f.request('/api/auth/reset', { token: next, password: 'Nova-senha-ficticia-2026!' })).status, 400);
});

test('troca da própria senha exige senha atual e encerra sessões', async (t) => {
  const f = await fixture(t), cookie = await f.login();
  assert.equal((await f.request('/api/admin/account/password', { currentPassword: 'errada', password: 'Nova-senha-ficticia-2026!' }, cookie)).status, 400);
  assert.equal((await f.request('/api/admin/account/password', { currentPassword: owner.password, password: 'Nova-senha-ficticia-2026!' }, cookie)).status, 200);
  assert.equal((await f.request('/api/admin/dashboard', undefined, cookie)).status, 401);
  await f.login(owner.username, 'Nova-senha-ficticia-2026!');
});

test('limita pedidos repetidos de recuperação', async (t) => {
  const f = await fixture(t, { mailer: async () => {} });
  for (let i = 0; i < 3; i += 1) assert.equal((await f.request('/api/auth/recovery', { email: owner.email })).status, 200);
  assert.equal((await f.request('/api/auth/recovery', { email: owner.email })).status, 429);
});
