const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { Writable } = require('node:stream');
const { openDB } = require('./server.cjs');
const { bootstrapOwner } = require('./accounts.cjs');

async function main() {
  const username = process.env.MOTORIZE_OWNER_USER || 'Tupiniquim_Motorize';
  const email = process.env.MOTORIZE_OWNER_EMAIL || 'ferramentas@agenciatupiniquim.com.br';
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(path.join(dataDir, 'motorize.sqlite'))) throw Error('Banco não encontrado. Use o mesmo DATA_DIR da aplicação em produção.');
  const db = openDB(dataDir);
  try {
    if (db.prepare("SELECT username FROM admins WHERE role='owner'").get()) {
      console.log('O dono já está configurado. Use a recuperação de senha para alterar o acesso.');
      return;
    }
    let password = process.env.MOTORIZE_OWNER_PASSWORD;
    if (!password) {
      if (!process.stdin.isTTY) throw Error('Execute em um terminal interativo ou configure MOTORIZE_OWNER_PASSWORD como segredo no servidor.');
      const muted = new Writable({ write(chunk, encoding, done) { done(); } });
      const terminal = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
      const ask = (message) => { process.stdout.write(message); return new Promise((resolve) => terminal.question('', (value) => { process.stdout.write('\n'); resolve(value); })); };
      try {
        password = await ask('Senha do dono (entrada oculta): ');
        const confirm = await ask('Confirme a senha (entrada oculta): ');
        if (password !== confirm) throw Error('As senhas não coincidem.');
      } finally { terminal.close(); }
    }
    bootstrapOwner(db, { username, email, password });
    console.log(`Dono configurado: ${username}\nE-mail: ${email}\nEntre no painel com a senha informada. Ela não foi exibida nem gravada em arquivos de configuração.`);
  } finally { db.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
