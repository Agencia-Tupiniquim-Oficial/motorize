const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { passwordHash } = require('./server.cjs');

function resetAdmin({
  username = process.env.MOTORIZE_ADMIN_USER || 'admin.motorize',
  dataDir = process.env.DATA_DIR || path.join(__dirname, 'data')
} = {}) {
  if (!/^[a-zA-Z0-9._@-]{3,100}$/.test(username)) throw Error('Usuário inválido.');
  const databaseFile = path.resolve(dataDir, 'motorize.sqlite');
  if (!fs.existsSync(databaseFile)) {
    throw Error('Banco não encontrado. Defina DATA_DIR com a mesma pasta usada pelo servidor. Nenhum banco foi criado.');
  }
  const db = new DatabaseSync(databaseFile);
  let inTransaction = false;
  try {
    db.exec('PRAGMA busy_timeout=5000;');
    const password = crypto.randomBytes(24).toString('base64url');
    const credentials = passwordHash(password);
    db.exec('BEGIN IMMEDIATE;');
    inTransaction = true;
    db.prepare(`INSERT INTO admins(username,salt,hash) VALUES(?,?,?)
      ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,hash=excluded.hash`)
      .run(username, credentials.salt, credentials.hash);
    db.prepare('DELETE FROM sessions WHERE username=?').run(username);
    db.exec('COMMIT;');
    inTransaction = false;
    return { username, password };
  } catch (error) {
    if (inTransaction) db.exec('ROLLBACK;');
    throw error;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    const result = resetAdmin({ username: process.argv[2] || process.env.MOTORIZE_ADMIN_USER || 'admin.motorize' });
    console.log(`Usuário: ${result.username}\nNova senha: ${result.password}\nGuarde a senha em local seguro. As sessões anteriores deste usuário foram encerradas.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { resetAdmin };
