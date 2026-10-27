const path = require('node:path');
const crypto = require('node:crypto');
const { openDB, passwordHash } = require('./server.cjs');

const db = openDB(process.env.DATA_DIR || path.join(__dirname, 'data'));
const username = process.env.MOTORIZE_ADMIN_USER || 'admin';
if (db.prepare('SELECT username FROM admins WHERE username=?').get(username)) {
  console.log('Administrador já cadastrado. Nenhuma senha foi alterada.');
  db.close();
  process.exit(0);
}
const password = crypto.randomBytes(15).toString('base64url');
const credentials = passwordHash(password);
db.prepare('INSERT INTO admins VALUES(?,?,?)').run(username, credentials.salt, credentials.hash);
db.close();
console.log(`Usuário: ${username}\nSenha inicial: ${password}`);
