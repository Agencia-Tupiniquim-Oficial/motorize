const test = require('node:test');
const assert = require('node:assert/strict');
const { openMySQL, translate, schema } = require('./mysql-db.cjs');

test('MySQL exige configuração completa, sem voltar ao SQLite', () => {
  assert.throws(() => openMySQL({}), /MYSQL_CONFIG_MISSING/);
});

test('dialeto MySQL preserva máximo de rolagem, fuso horário e tentativas concluídas', () => {
  assert.equal(translate('UPDATE visits SET depth=MAX(depth,?) WHERE id=?'), 'UPDATE visits SET depth=GREATEST(depth,?) WHERE id=?');
  assert.match(translate("SELECT date(created,'-3 hours') day FROM visits"), /INTERVAL 3 HOUR/);
  assert.equal(translate('INSERT OR IGNORE INTO visits VALUES(?)'), 'INSERT IGNORE INTO visits VALUES(?)');
  assert.match(translate('ON CONFLICT(id) DO UPDATE SET stage=excluded.stage,updated=excluded.updated WHERE attempts.completed IS NULL'), /IF\(completed IS NULL/);
  assert.match(translate('WHERE r.token_hash=? AND r.used IS NULL AND r.expires>? AND a.active=1'), /FOR UPDATE$/);
  assert.equal(schema.length, 8);
  assert.ok(schema.every((sql) => sql.endsWith('COLLATE=utf8mb4_unicode_ci')));
});

test('conexão MySQL pertence à requisição, com rollback e liberação garantidos', async () => {
  let connections = 0, releases = 0, rollbacks = 0;
  const connection = {
    execute: async () => [[{ n: 1 }]], query: async () => {}, beginTransaction: async () => {},
    rollback: async () => { rollbacks++; }, commit: async () => {}, release: () => { releases++; }
  };
  const db = openMySQL({}, { getConnection: async () => { connections++; return connection; }, end: async () => {} });
  await assert.rejects(db.prepare('SELECT 1').get(), /MYSQL_REQUEST_SCOPE_REQUIRED/);
  await assert.rejects(db.withRequest(async () => {
    await Promise.all([db.prepare('SELECT 1').get(), db.prepare('SELECT 1').all()]);
    await db.exec('BEGIN IMMEDIATE;');
    throw Error('falha simulada');
  }), /falha simulada/);
  assert.equal(connections, 1, 'consultas paralelas compartilham uma conexão');
  assert.equal(rollbacks, 1);
  assert.equal(releases, 1);
  await db.withRequest(async () => { await db.exec('BEGIN'); await db.exec('COMMIT'); });
  assert.equal(rollbacks, 1, 'transação confirmada não sofre rollback');
  assert.equal(releases, 2);
});
