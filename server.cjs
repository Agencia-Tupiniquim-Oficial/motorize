const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const accounts = require('./accounts.cjs');
const attribution = require('./dist/attribution.js');

const OFFICIAL_ORIGIN = 'https://motorize.agenciatupiniquim.com.br';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function openDB(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'motorize.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS admins(username TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS leads(id TEXT PRIMARY KEY, token TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, completed TEXT);
    CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, token TEXT NOT NULL, source TEXT NOT NULL, stage TEXT NOT NULL, started TEXT NOT NULL, updated TEXT NOT NULL, completed TEXT);
    CREATE INDEX IF NOT EXISTS attempts_started ON attempts(started);
    CREATE TABLE IF NOT EXISTS visits(id TEXT PRIMARY KEY, session TEXT NOT NULL, device TEXT NOT NULL, created TEXT NOT NULL, depth INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS clicks(id INTEGER PRIMARY KEY, visit TEXT NOT NULL REFERENCES visits(id), section TEXT NOT NULL, target TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, created TEXT NOT NULL);`);
  accounts.migrate(db);
  return db;
}

const funnelStages = {
  form: ['contact', 'business', 'profile', 'goal', 'review'],
  chat: ['name', 'email', 'phone', 'company', 'role', 'stores', 'challenge', 'budget', 'timeline', 'review']
};
const sections = ['inicio', 'diagnostico', 'metodo', 'especialistas', 'solucoes', 'faq', 'contato', 'rodape', 'cabecalho'];
const choices = {
  role: ['Proprietário(a) / Sócio(a)', 'Diretor(a)', 'Gerente de marketing', 'Gerente comercial', 'Analista / Coordenador(a)', 'Outro', 'Marketing', 'Comercial'],
  stores: ['1 loja', '2 a 5 lojas', '6 a 15 lojas', '16 ou mais lojas'],
  budget: ['Até R$ 10 mil', 'R$ 10 mil a R$ 30 mil', 'R$ 30 mil a R$ 80 mil', 'Acima de R$ 80 mil'],
  challenge: ['Gerar mais leads qualificados', 'Vender veículos parados no estoque', 'Melhorar conversão e atendimento', 'Fortalecer marca e presença digital', 'Gerar leads qualificados', 'Girar estoque parado', 'Melhorar conversão', 'Fortalecer a marca'],
  timeline: ['Imediatamente', 'Nos próximos 30 dias', 'Em 2 a 3 meses']
};

const validPhone = (value) => /^(?:55)?[1-9][0-9]{9,10}$/.test(String(value).replace(/\D/g, ''));
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
const text = (value, max) => String(value || '').trim().slice(0, max + 1);

function cleanLead(raw, complete) {
  const data = raw || {};
  const out = {
    name: text(data.name, 100),
    email: text(data.email, 180).toLowerCase(),
    phone: text(data.phone, 22),
    company: text(data.company, 160)
  };
  if (!out.name || out.name.length > 100 || !validEmail(out.email) || out.email.length > 180 || !validPhone(out.phone) || out.company.length > 160) {
    throw Error('Informe nome, e-mail corporativo e telefone válidos.');
  }
  if (!complete) return out;
  out.role = text(data.role, 80);
  out.city = text(data.city, 120);
  out.stores = text(data.stores, 60);
  out.budget = text(data.budget, 80);
  out.challenge = text(data.challenge, 120);
  out.timeline = text(data.timeline, 80);
  out.details = text(data.details, 800);
  if (!out.company || !choices.role.includes(out.role) || !choices.stores.includes(out.stores) || !choices.budget.includes(out.budget) || !choices.challenge.includes(out.challenge) || !choices.timeline.includes(out.timeline) || out.city.length > 120 || out.details.length > 800) {
    throw Error('Revise os dados de qualificação antes de continuar.');
  }
  return out;
}

function createApp({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'data'), publicOrigin = process.env.PUBLIC_ORIGIN || '', mailer = null, ownerConfig = null } = {}) {
  const db = openDB(dataDir);
  accounts.bootstrapOwner(db, ownerConfig || {
    username: process.env.MOTORIZE_OWNER_USER || 'Tupiniquim_Motorize',
    email: process.env.MOTORIZE_OWNER_EMAIL || 'ferramentas@agenciatupiniquim.com.br',
    password: process.env.MOTORIZE_OWNER_PASSWORD
  });
  const configuredOrigin = publicOrigin ? new URL(publicOrigin).origin : '';
  // Keep the official domain usable when an old deployment variable still
  // points at SiteGround's temporary hostname. Never trust forwarded headers.
  const originsByHost = new Map();
  if (configuredOrigin && !new URL(configuredOrigin).hostname.endsWith('.sg-host.com')) {
    originsByHost.set(new URL(configuredOrigin).host, configuredOrigin);
  }
  originsByHost.set(new URL(OFFICIAL_ORIGIN).host, OFFICIAL_ORIGIN);
  const root = path.join(__dirname, 'dist');
  const limits = new Map();
  function limited(key, max, milliseconds) {
    const now = Date.now();
    let record = limits.get(key);
    if (!record || record.until < now) {
      record = { count: 0, until: now + milliseconds };
      limits.set(key, record);
    }
    if (limits.size > 5000) for (const [item, value] of limits) if (value.until < now) limits.delete(item);
    return ++record.count > max;
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Motorize-API-Version', '2026-10-27-accounts');
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      const port = server.address().port;
      const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      const base = originsByHost.get(req.headers.host)
        || (!configuredOrigin && localHosts.includes(req.headers.host) ? `http://${req.headers.host}` : '');
      if (!base) return send(403, { error: 'Host não autorizado.' });
      const url = new URL(req.url, base);
      const route = url.pathname;
      const origin = req.headers.origin;
      if (!['GET', 'HEAD'].includes(req.method) && (origin !== new URL(base).origin || req.headers['sec-fetch-site'] === 'cross-site')) return send(403, { error: 'Origem não autorizada.' });

      let body = {};
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'Formato inválido.' });
        let bytes = 0;
        const chunks = [];
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 32768) return send(413, { error: 'Pedido muito grande.' });
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch (_) { return send(400, { error: 'Dados inválidos.' }); }
      }

      const ip = req.socket.remoteAddress;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Dados inválidos.' });
      if (await accounts.handlePublic({ db, route, req, body, send, limited, mailer })) return;
      if (route === '/api/admin/login' && req.method === 'POST') {
        if (limited(`login:${ip}`, 12, 15 * 60e3)) return send(429, { error: 'Muitas tentativas. Tente novamente em 15 minutos.' });
        const login = String(body.username || '').trim().toLowerCase();
        const user = db.prepare('SELECT * FROM admins WHERE lower(username)=? OR (email<>\'\' AND lower(email)=?)').get(login, login);
        const candidate = passwordHash(String(body.password || '').slice(0, 300), user?.salt || 'missing');
        if (!user || !user.active || !accounts.ROLES[user.role] || !crypto.timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(user.hash, 'hex'))) return send(401, { error: 'Usuário ou senha incorretos.' });
        const token = crypto.randomBytes(32).toString('hex');
        db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
        db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), user.username, Date.now() + 8 * 3600e3);
        res.setHeader('Set-Cookie', `motorize_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${base.startsWith('https://') || req.socket.encrypted ? '; Secure' : ''}`);
        return send(200, { ok: true });
      }

      if (route.startsWith('/api/admin/')) {
        const session = accounts.sessionUser(db, req);
        if (!session) return send(401, { error: 'Faça login para acessar o painel.' });
        if (!accounts.ROLES[session.role]) return send(403, { error: 'Perfil sem permissão.' });
        if (route === '/api/admin/logout' && req.method === 'POST') {
          db.prepare('DELETE FROM sessions WHERE token=?').run(session.session_token);
          res.setHeader('Set-Cookie', 'motorize_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
          return send(200, { ok: true });
        }
        if (await accounts.handlePrivate({ db, route, req, body, send, user: session, limited, mailer })) return;
        if (req.method !== 'GET') return send(405, { error: 'Método não permitido.' });
        const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
        const since = new Date(Date.now() - days * 864e5).toISOString();

        if (route === '/api/admin/dashboard') {
          const views = db.prepare('SELECT COUNT(*) n, COUNT(DISTINCT session) sessions FROM visits WHERE created>=?').get(since);
          const counts = db.prepare('SELECT source,status,COUNT(*) n FROM leads WHERE created>=? GROUP BY source,status').all(since);
          const daily = db.prepare("SELECT date(created,'-3 hours') day,COUNT(*) n FROM visits WHERE created>=? GROUP BY day ORDER BY day").all(since);
          const depth = db.prepare('SELECT COUNT(*) n,SUM(depth>=25) d25,SUM(depth>=50) d50,SUM(depth>=75) d75,SUM(depth>=90) d90,SUM(depth>=100) d100 FROM visits WHERE created>=?').get(since);
          const cutoff = new Date(Date.now() - 30 * 60e3).toISOString();
          const funnel = ['form', 'chat'].map((source) => {
            const totals = db.prepare('SELECT COUNT(*) started,SUM(completed IS NOT NULL) completed,SUM(completed IS NULL AND updated<=?) abandoned,SUM(completed IS NULL AND updated>?) active FROM attempts WHERE source=? AND started>=?').get(cutoff, cutoff, source, since);
            const stages = db.prepare('SELECT stage,COUNT(*) n FROM attempts WHERE source=? AND started>=? AND completed IS NULL AND updated<=? GROUP BY stage ORDER BY n DESC,stage').all(source, since, cutoff);
            const completed = totals.completed || 0;
            const abandoned = totals.abandoned || 0;
            return { source, started: totals.started, completed, abandoned, active: totals.active || 0, rate: completed + abandoned ? Math.round(abandoned / (completed + abandoned) * 1000) / 10 : null, stages };
          });
          const origins = new Map();
          for (const lead of db.prepare('SELECT data,status FROM leads WHERE created>=?').all(since)) {
            const label = attribution.label(JSON.parse(lead.data).attribution);
            const item = origins.get(label) || { label, total: 0, qualified: 0 };
            item.total++;
            if (lead.status === 'completed') item.qualified++;
            origins.set(label, item);
          }
          return send(200, { views, counts, daily, depth, days, funnel, origins: [...origins.values()].sort((a, b) => b.total - a.total), abandonmentMinutes: 30 });
        }
        if (route === '/api/admin/leads') {
          const rows = db.prepare('SELECT id,source,status,data,created,updated FROM leads WHERE created>=? ORDER BY created DESC LIMIT 1000').all(since);
          return send(200, { leads: rows.map((row) => ({ ...row, data: JSON.parse(row.data) })), limit: 1000 });
        }
        if (route === '/api/admin/heatmap') {
          const section = sections.includes(url.searchParams.get('section')) ? url.searchParams.get('section') : 'inicio';
          const device = url.searchParams.get('device') === 'mobile' ? 'mobile' : 'desktop';
          const points = db.prepare('SELECT c.x,c.y,c.target FROM clicks c JOIN visits v ON v.id=c.visit WHERE c.created>=? AND c.section=? AND v.device=? ORDER BY c.id DESC LIMIT 5000').all(since, section, device);
          const targets = db.prepare('SELECT c.target,COUNT(*) n FROM clicks c JOIN visits v ON v.id=c.visit WHERE c.created>=? AND c.section=? AND v.device=? GROUP BY c.target ORDER BY n DESC LIMIT 10').all(since, section, device);
          return send(200, { points, targets, section, device, limit: 5000 });
        }
        return send(404, { error: 'Não encontrado.' });
      }

      if (route === '/api/leads' && req.method === 'POST') {
        if (limited(`lead:${ip}`, 180, 3600e3)) return send(429, { error: 'Muitos contatos. Tente novamente mais tarde.' });
        if (!/^[a-f0-9-]{36}$/.test(body.id || '') || !/^[a-f0-9]{64}$/.test(body.token || '') || !['form', 'chat'].includes(body.source) || !['started', 'completed'].includes(body.status)) return send(400, { error: 'Contato inválido.' });
        if (body.attemptId) {
          const attempt = db.prepare('SELECT token,source FROM attempts WHERE id=?').get(body.attemptId);
          if (!attempt || attempt.token !== hash(String(body.attemptToken || '')) || attempt.source !== body.source) return send(400, { error: 'Tentativa de preenchimento inválida.' });
        }
        let data;
        try { data = cleanLead(body.data, body.status === 'completed'); } catch (error) { return send(400, { error: error.message }); }
        const existing = db.prepare('SELECT token,source,status,data FROM leads WHERE id=?').get(body.id);
        if (existing && (existing.token !== hash(body.token) || existing.source !== body.source)) return send(403, { error: 'Contato não autorizado.' });
        const savedOrigin = existing ? JSON.parse(existing.data).attribution : null;
        data.attribution = savedOrigin || attribution.normalize(body.attribution);
        const now = new Date().toISOString();
        if (existing) {
          if (existing.status === 'completed' && body.status === 'started') return send(200, { ok: true });
          db.prepare("UPDATE leads SET status=?,data=?,updated=?,completed=CASE WHEN ?='completed' THEN COALESCE(completed,?) ELSE completed END WHERE id=?").run(body.status, JSON.stringify(data), now, body.status, now, body.id);
        } else {
          db.prepare('INSERT INTO leads VALUES(?,?,?,?,?,?,?,?)').run(body.id, hash(body.token), body.source, body.status, JSON.stringify(data), now, now, body.status === 'completed' ? now : null);
        }
        if (body.status === 'completed' && body.attemptId) db.prepare("UPDATE attempts SET completed=COALESCE(completed,?),updated=?,stage='review' WHERE id=?").run(now, now, body.attemptId);
        return send(200, { ok: true });
      }

      if (route === '/api/funnel' && req.method === 'POST') {
        if (limited(`funnel:${ip}`, 600, 60000)) return send(429, { error: 'Limite de eventos.' });
        if (!/^[a-f0-9-]{36}$/.test(body.id || '') || !/^[a-f0-9]{64}$/.test(body.token || '') || !funnelStages[body.source]?.includes(body.stage) || body.stage === 'review') return send(400, { error: 'Etapa inválida.' });
        const existing = db.prepare('SELECT token,source FROM attempts WHERE id=?').get(body.id);
        if (existing && (existing.token !== hash(body.token) || existing.source !== body.source)) return send(403, { error: 'Tentativa não autorizada.' });
        const now = new Date().toISOString();
        db.prepare('INSERT INTO attempts(id,token,source,stage,started,updated) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET stage=excluded.stage,updated=excluded.updated WHERE attempts.completed IS NULL').run(body.id, hash(body.token), body.source, body.stage, now, now);
        return send(200, { ok: true });
      }

      if (route === '/api/analytics' && req.method === 'POST') {
        if (limited(`analytics:${ip}`, 1200, 60000)) return send(429, { error: 'Limite de eventos.' });
        const now = new Date().toISOString();
        if (!/^[a-f0-9-]{36}$/.test(body.visit || '')) return send(400, { error: 'Visita inválida.' });
        if (body.type === 'view') {
          if (!/^[a-f0-9-]{36}$/.test(body.session || '')) return send(400, { error: 'Sessão inválida.' });
          db.prepare('INSERT OR IGNORE INTO visits(id,session,device,created) VALUES(?,?,?,?)').run(body.visit, body.session, body.device === 'mobile' ? 'mobile' : 'desktop', now);
          return send(200, { ok: true });
        }
        const visit = db.prepare('SELECT id FROM visits WHERE id=?').get(body.visit);
        if (!visit) return send(400, { error: 'Visita desconhecida.' });
        if (body.type === 'depth') {
          const depth = Math.round(Number(body.depth));
          if (!Number.isFinite(depth) || depth < 0 || depth > 100) return send(400, { error: 'Profundidade inválida.' });
          db.prepare('UPDATE visits SET depth=MAX(depth,?) WHERE id=?').run(depth, body.visit);
          return send(200, { ok: true });
        }
        if (body.type === 'click' && sections.includes(body.section) && Number.isFinite(body.x) && Number.isFinite(body.y) && body.x >= 0 && body.x <= 1 && body.y >= 0 && body.y <= 1) {
          const target = String(body.target || 'Área da página').slice(0, 80);
          db.prepare('INSERT INTO clicks(visit,section,target,x,y,created) VALUES(?,?,?,?,?,?)').run(body.visit, body.section, target, body.x, body.y, now);
          return send(200, { ok: true });
        }
        return send(400, { error: 'Evento inválido.' });
      }

      if (route.startsWith('/api/')) return send(404, { error: 'Não encontrado.' });
      if (!['GET', 'HEAD'].includes(req.method)) return send(405, { error: 'Método não permitido.' });
      let filePath = route === '/' ? '/index.html' : route === '/admin' || route === '/admin/' ? '/admin/index.html' : decodeURIComponent(route);
      const file = path.resolve(root, `.${filePath}`);
      if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(404, { error: 'Não encontrado.' });
      const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)];
      if (!type) return send(404, { error: 'Não encontrado.' });
      res.writeHead(200, { 'Content-Type': type });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    } catch (error) {
      console.error('Request failed:', error.code || error.name);
      if (!res.headersSent) send(500, { error: 'Não foi possível concluir. Tente novamente.' }); else res.end();
    }
  });
  server.on('close', () => db.close());
  return { server, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4179);
  const host = process.env.HOST || '127.0.0.1';
  createApp().server.listen(port, host, () => console.log(`Motorize+: ${process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`} | Painel: /admin/`));
}

module.exports = { createApp, openDB, passwordHash, cleanLead };
