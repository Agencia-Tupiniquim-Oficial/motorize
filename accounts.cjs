const crypto = require('node:crypto');

const OFFICIAL_ORIGIN = 'https://motorize.agenciatupiniquim.com.br';
const ROLES = {
  owner: { label: 'Dono Administrador', manageUsers: true, assign: ['administrator', 'client', 'editor'] },
  administrator: { label: 'Administrador', manageUsers: true, assign: ['client', 'editor'] },
  client: { label: 'Cliente', manageUsers: false, assign: [] },
  editor: { label: 'Editor', manageUsers: false, assign: [] }
};
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const validEmail = (value) => typeof value === 'string' && value.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validUsername = (value) => typeof value === 'string' && /^[a-zA-Z0-9._@-]{3,100}$/.test(value);
const validPassword = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 200;
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function passwordMatches(password, user) {
  const candidate = passwordHash(String(password || '').slice(0, 300), user?.salt || 'missing');
  return Boolean(user && crypto.timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(user.hash, 'hex')));
}
function migrate(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(admins)').all().map((column) => column.name));
  for (const [name, sql] of Object.entries({
    email: "TEXT NOT NULL DEFAULT ''", name: "TEXT NOT NULL DEFAULT ''",
    role: "TEXT NOT NULL DEFAULT 'administrator'", active: 'INTEGER NOT NULL DEFAULT 1',
    created: "TEXT NOT NULL DEFAULT ''", updated: "TEXT NOT NULL DEFAULT ''"
  })) if (!columns.has(name)) db.exec(`ALTER TABLE admins ADD COLUMN ${name} ${sql};`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON admins(lower(email)) WHERE email<>'';
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_username ON admins(lower(username));
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_owner ON admins(role) WHERE role='owner';
    CREATE TABLE IF NOT EXISTS account_password_resets(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS account_audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,event TEXT NOT NULL,target TEXT NOT NULL,created TEXT NOT NULL);`);
}
function audit(db, actor, event, target) {
  return db.prepare('INSERT INTO account_audit(actor,event,target,created) VALUES(?,?,?,?)').run(actor, event, target, new Date().toISOString());
}
function bootstrapOwner(db, { username = 'Tupiniquim_Motorize', email = 'ferramentas@agenciatupiniquim.com.br', password } = {}) {
  if (!password) return false;
  if (!validUsername(username) || !validEmail(email) || !validPassword(password)) throw Error('Configuração do dono inválida. A senha precisa ter entre 12 e 200 caracteres.');
  db.exec('BEGIN IMMEDIATE;');
  try {
    if (db.prepare("SELECT username FROM admins WHERE role='owner'").get()) { db.exec('COMMIT;'); return false; }
    const credentials = passwordHash(password);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO admins(username,salt,hash,email,name,role,active,created,updated) VALUES(?,?,?,?,?,'owner',1,?,?)
      ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,email=excluded.email,name=excluded.name,role='owner',active=1,updated=excluded.updated`)
      .run(username, credentials.salt, credentials.hash, email.toLowerCase(), 'Agência Tupiniquim', now, now);
    db.prepare('DELETE FROM sessions WHERE username=?').run(username);
    audit(db, 'server-setup', 'owner.created', username);
    db.exec('COMMIT;');
    return true;
  } catch (error) { db.exec('ROLLBACK;'); throw error; }
}
function publicUser(user) {
  return { username: user.username, email: user.email, name: user.name, role: user.role,
    roleLabel: ROLES[user.role]?.label || 'Sem acesso', active: Boolean(user.active), created: user.created };
}
async function sessionUser(db, request) {
  const token = String(request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('motorize_admin='))?.slice(15);
  if (!token) return null;
  return (await db.prepare(`SELECT a.*,s.token AS session_token FROM sessions s JOIN admins a ON a.username=s.username
    WHERE s.token=? AND s.expires>? AND a.active=1`).get(digest(token), Date.now())) || null;
}
function mailConfigured() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD || !validEmail(process.env.MAIL_FROM)) return false;
  try { require.resolve('nodemailer'); return true; } catch { return false; }
}
async function sendRecoveryMail({ to, resetUrl }) {
  if (!mailConfigured()) throw Error('MAIL_UNAVAILABLE');
  const port = Number(process.env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw Error('MAIL_UNAVAILABLE');
  const transport = require('nodemailer').createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false
  });
  const result = await transport.sendMail({ from: process.env.MAIL_FROM, to,
    subject: 'Motorize+ — Recuperação de acesso',
    text: `Recebemos uma solicitação de redefinição de senha do seu painel Motorize+.\n\nAbra o link abaixo para definir uma nova senha. Ele expira em 30 minutos e só pode ser usado uma vez.\n\n${resetUrl}\n\nSe você não solicitou, ignore esta mensagem. Sua senha permanece a mesma.` });
  if (!result.accepted?.length) throw Error('MAIL_UNAVAILABLE');
}
async function invalidateUser(db, username) {
  (await db.prepare('DELETE FROM sessions WHERE username=?').run(username));
  (await db.prepare('DELETE FROM account_password_resets WHERE username=?').run(username));
}
async function handlePublic({ db, route, req, body, send, limited, mailer }) {
  if (!['/api/auth/recovery', '/api/auth/reset'].includes(route)) return false;
  if (req.method !== 'POST') { send(405, { error: 'Método não permitido.' }); return true; }
  const ip = req.socket.remoteAddress;
  if (route === '/api/auth/recovery') {
    const email = String(body.email || '').trim().toLowerCase();
    if (limited(`recovery:${ip}`, 15, 15 * 60e3) || limited(`recovery-email:${digest(email)}`, 3, 15 * 60e3)) { send(429, { error: 'Aguarde alguns minutos antes de solicitar outro link.' }); return true; }
    if (!mailer && !mailConfigured()) { send(503, { error: 'O envio de e-mail ainda não está configurado. Entre em contato com o administrador.' }); return true; }
    if (!validEmail(email)) { send(400, { error: 'Informe um e-mail válido.' }); return true; }
    const user = (await db.prepare('SELECT * FROM admins WHERE lower(email)=? AND active=1').get(email));
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = digest(token);
      (await db.prepare('DELETE FROM account_password_resets WHERE username=? OR expires<?').run(user.username, Date.now()));
      (await db.prepare('INSERT INTO account_password_resets VALUES(?,?,?,NULL,?)').run(tokenHash, user.username, Date.now() + 30 * 60e3, Date.now()));
      try {
        await (mailer || sendRecoveryMail)({ to: user.email, resetUrl: `${OFFICIAL_ORIGIN}/admin/#reset=${token}` });
        await audit(db, 'recovery', 'password.link-sent', user.username);
      } catch {
        (await db.prepare('DELETE FROM account_password_resets WHERE token_hash=?').run(tokenHash));
        // Do not expose account existence, SMTP diagnostics or recovery tokens.
        console.error('Motorize: envio de recuperação não concluído. Verifique o SMTP no servidor.');
      }
    }
    send(200, { ok: true, message: 'Se o e-mail estiver cadastrado e ativo, você receberá as instruções de recuperação.' });
    return true;
  }
  if (limited(`reset:${ip}`, 20, 15 * 60e3)) { send(429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true; }
  if (!/^[a-f0-9]{64}$/.test(body.token || '') || !validPassword(body.password)) { send(400, { error: 'Link inválido ou senha fora do limite de 12 a 200 caracteres.' }); return true; }
  (await db.exec('BEGIN IMMEDIATE;'));
  try {
    const record = (await db.prepare(`SELECT r.* FROM account_password_resets r JOIN admins a ON a.username=r.username
      WHERE r.token_hash=? AND r.used IS NULL AND r.expires>? AND a.active=1`).get(digest(body.token), Date.now()));
    if (!record) { (await db.exec('ROLLBACK;')); send(400, { error: 'Link inválido ou expirado. Solicite um novo.' }); return true; }
    const credentials = passwordHash(body.password);
    (await db.prepare('UPDATE admins SET salt=?,hash=?,updated=? WHERE username=?').run(credentials.salt, credentials.hash, new Date().toISOString(), record.username));
    await invalidateUser(db, record.username);
    await audit(db, record.username, 'password.reset', record.username);
    (await db.exec('COMMIT;'));
    send(200, { ok: true, message: 'Senha atualizada. Entre novamente no painel.' });
  } catch (error) { (await db.exec('ROLLBACK;')); throw error; }
  return true;
}
async function handlePrivate({ db, route, req, body, send, user, limited, mailer }) {
  const role = ROLES[user.role];
  if (route === '/api/admin/me' && req.method === 'GET') {
    send(200, { user: publicUser(user), permissions: { manageUsers: Boolean(role?.manageUsers), assignRoles: role?.assign || [] },
      ...(user.role === 'owner' ? { recoveryEmailConfigured: Boolean(mailer || mailConfigured()) } : {}) });
    return true;
  }
  if (route === '/api/admin/account/password' && req.method === 'POST') {
    if (limited(`password-change:${user.username}`, 6, 15 * 60e3)) { send(429, { error: 'Muitas tentativas. Aguarde alguns minutos.' }); return true; }
    if (!passwordMatches(body.currentPassword, user) || !validPassword(body.password)) { send(400, { error: 'Confira a senha atual e use uma nova senha de 12 a 200 caracteres.' }); return true; }
    const credentials = passwordHash(body.password);
    (await db.exec('BEGIN IMMEDIATE;'));
    try {
      (await db.prepare('UPDATE admins SET salt=?,hash=?,updated=? WHERE username=?').run(credentials.salt, credentials.hash, new Date().toISOString(), user.username));
      await invalidateUser(db, user.username);
      await audit(db, user.username, 'password.changed', user.username);
      (await db.exec('COMMIT;'));
    } catch (error) { (await db.exec('ROLLBACK;')); throw error; }
    send(200, { ok: true }); return true;
  }
  if (!route.startsWith('/api/admin/users')) return false;
  if (!role?.manageUsers) { send(403, { error: 'Seu perfil não permite gerenciar usuários.' }); return true; }
  if (route === '/api/admin/users' && req.method === 'GET') {
    const users = (await db.prepare(user.role === 'owner' ? 'SELECT * FROM admins ORDER BY created,username' : "SELECT * FROM admins WHERE role IN ('client','editor') ORDER BY created,username").all());
    send(200, { users: users.map(publicUser), roles: role.assign.map((key) => ({ value: key, label: ROLES[key].label })) }); return true;
  }
  if (!['/api/admin/users/create', '/api/admin/users/update'].includes(route) || req.method !== 'POST') { send(404, { error: 'Não encontrado.' }); return true; }
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const target = (await db.prepare('SELECT * FROM admins WHERE lower(username)=lower(?)').get(username));
  const creating = route.endsWith('/create');
  if (!validUsername(username) || !validEmail(email) || !name || name.length > 100 || typeof body.active !== 'boolean') { send(400, { error: 'Revise nome, usuário, e-mail e situação da conta.' }); return true; }
  if (creating && target) { send(409, { error: 'Esse usuário já está cadastrado.' }); return true; }
  if (!creating && !target) { send(404, { error: 'Usuário não encontrado.' }); return true; }
  const ownOwner = !creating && user.role === 'owner' && target.role === 'owner' && target.username === user.username;
  if (ownOwner ? (body.role !== 'owner' || !body.active) : (!role.assign.includes(body.role) || (!creating && !role.assign.includes(target.role)))) {
    send(403, { error: 'Você não pode atribuir esse perfil ou alterar esse usuário.' }); return true;
  }
  if (creating && !validPassword(body.password)) { send(400, { error: 'A senha inicial precisa ter entre 12 e 200 caracteres.' }); return true; }
  const duplicate = (await db.prepare('SELECT username FROM admins WHERE lower(email)=? AND lower(username)<>lower(?)').get(email, username));
  if (duplicate) { send(409, { error: 'Esse e-mail já pertence a outra conta.' }); return true; }
  const now = new Date().toISOString();
  (await db.exec('BEGIN IMMEDIATE;'));
  try {
    if (creating) {
      const credentials = passwordHash(body.password);
      (await db.prepare('INSERT INTO admins(username,salt,hash,email,name,role,active,created,updated) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(username, credentials.salt, credentials.hash, email, name, body.role, body.active ? 1 : 0, now, now));
    } else {
      (await db.prepare('UPDATE admins SET email=?,name=?,role=?,active=?,updated=? WHERE username=?').run(email, name, body.role, body.active ? 1 : 0, now, target.username));
      await invalidateUser(db, target.username);
    }
    await audit(db, user.username, creating ? 'user.created' : 'user.updated', target?.username || username);
    (await db.exec('COMMIT;'));
  } catch (error) { (await db.exec('ROLLBACK;')); if (error.code?.includes('CONSTRAINT')) { send(409, { error: 'Usuário ou e-mail já cadastrado.' }); return true; } throw error; }
  send(creating ? 201 : 200, { ok: true }); return true;
}
module.exports = { ROLES, passwordHash, passwordMatches, migrate, bootstrapOwner, sessionUser, publicUser, handlePublic, handlePrivate, mailConfigured };
