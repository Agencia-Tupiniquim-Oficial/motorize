const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

const schema = [
  `CREATE TABLE IF NOT EXISTS admins (
    username VARCHAR(100) PRIMARY KEY, salt VARCHAR(64) NOT NULL, hash VARCHAR(128) NOT NULL,
    email VARCHAR(180) NOT NULL DEFAULT '', name VARCHAR(100) NOT NULL DEFAULT '',
    role VARCHAR(24) NOT NULL DEFAULT 'administrator', active TINYINT NOT NULL DEFAULT 1,
    created VARCHAR(24) NOT NULL DEFAULT '', updated VARCHAR(24) NOT NULL DEFAULT '',
    email_unique VARCHAR(180) GENERATED ALWAYS AS (NULLIF(LOWER(email),'')) STORED,
    owner_slot TINYINT GENERATED ALWAYS AS (CASE WHEN role='owner' THEN 1 ELSE NULL END) STORED,
    UNIQUE KEY accounts_email(email_unique), UNIQUE KEY accounts_single_owner(owner_slot)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (token VARCHAR(64) PRIMARY KEY, username VARCHAR(100) NOT NULL, expires BIGINT NOT NULL, INDEX sessions_user(username)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS leads (id VARCHAR(36) PRIMARY KEY, token VARCHAR(64) NOT NULL, source VARCHAR(12) NOT NULL, status VARCHAR(12) NOT NULL, data TEXT NOT NULL, created VARCHAR(24) NOT NULL, updated VARCHAR(24) NOT NULL, completed VARCHAR(24), INDEX leads_created(created)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS attempts (id VARCHAR(36) PRIMARY KEY, token VARCHAR(64) NOT NULL, source VARCHAR(12) NOT NULL, stage VARCHAR(24) NOT NULL, started VARCHAR(24) NOT NULL, updated VARCHAR(24) NOT NULL, completed VARCHAR(24), INDEX attempts_started(started)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS visits (id VARCHAR(36) PRIMARY KEY, session VARCHAR(36) NOT NULL, device VARCHAR(12) NOT NULL, created VARCHAR(24) NOT NULL, depth INT NOT NULL DEFAULT 0, INDEX visits_created(created)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS clicks (id BIGINT PRIMARY KEY AUTO_INCREMENT, visit VARCHAR(36) NOT NULL, section VARCHAR(24) NOT NULL, target VARCHAR(80) NOT NULL, x DOUBLE NOT NULL, y DOUBLE NOT NULL, created VARCHAR(24) NOT NULL, INDEX clicks_created(created), FOREIGN KEY(visit) REFERENCES visits(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS account_password_resets (token_hash VARCHAR(64) PRIMARY KEY, username VARCHAR(100) NOT NULL, expires BIGINT NOT NULL, used BIGINT, created BIGINT NOT NULL, INDEX reset_user(username)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS account_audit (id BIGINT PRIMARY KEY AUTO_INCREMENT, actor VARCHAR(100) NOT NULL, event VARCHAR(80) NOT NULL, target VARCHAR(100) NOT NULL, created VARCHAR(24) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
].map((sql) => sql.replace(/ENGINE=InnoDB(?: DEFAULT CHARSET=utf8mb4(?: COLLATE=utf8mb4_unicode_ci)?)?$/, 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'));

function translate(sql) {
  return sql.replace(/INSERT OR IGNORE/gi, 'INSERT IGNORE')
    .replace(/MAX\(depth,\?\)/g, 'GREATEST(depth,?)')
    .replace(/date\(created,'-3 hours'\)/g, "DATE_FORMAT(DATE_SUB(STR_TO_DATE(created,'%Y-%m-%dT%H:%i:%s.%fZ'), INTERVAL 3 HOUR),'%Y-%m-%d')")
    .replace(/ON CONFLICT\(id\) DO UPDATE SET stage=excluded.stage,updated=excluded.updated WHERE attempts.completed IS NULL/g,
      'ON DUPLICATE KEY UPDATE stage=IF(completed IS NULL,VALUES(stage),stage),updated=IF(completed IS NULL,VALUES(updated),updated)')
    // A reset token may only be consumed by one concurrent request.
    .replace(/(WHERE r.token_hash=\? AND r.used IS NULL AND r.expires>\? AND a.active=1)$/, '$1 FOR UPDATE');
}

function openMySQL(env = process.env, providedPool = null) {
  if (!providedPool && (!env.MYSQL_HOST || !env.MYSQL_DATABASE || !env.MYSQL_USER || !env.MYSQL_PASSWORD)) {
    throw Error('MYSQL_CONFIG_MISSING');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(env.MYSQL_HOST);
  // Remote connections require certificate-verified TLS. Local SiteGround
  // connections stay on the database host; remote access need not be enabled.
  const pool = providedPool || require('mysql2/promise').createPool({
    host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD, database: env.MYSQL_DATABASE,
    charset: 'utf8mb4', decimalNumbers: true, supportBigNumbers: true,
    connectionLimit: 5, queueLimit: 100, waitForConnections: true,
    connectTimeout: 10000, multipleStatements: false,
    ...(local ? {} : { ssl: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  });
  const scope = new AsyncLocalStorage();
  const db = {
    driver: 'mysql',
    async withRequest(callback) {
      return scope.run({ connection: null, connectionPromise: null, transaction: false }, async () => {
        const state = scope.getStore();
        try { return await callback(); }
        finally {
          if (state.connection) {
            if (state.transaction) await state.connection.rollback().catch(() => {});
            state.connection.release();
          }
        }
      });
    },
    async connection() {
      const state = scope.getStore();
      if (!state) throw Error('MYSQL_REQUEST_SCOPE_REQUIRED');
      if (!state.connectionPromise) state.connectionPromise = pool.getConnection();
      if (!state.connection) state.connection = await state.connectionPromise;
      return state.connection;
    },
    prepare(sql) {
      const execute = async (values) => {
        const connection = await db.connection();
        try { const [rows] = await connection.execute(translate(sql), values); return rows; }
        catch (error) { if (error.code === 'ER_DUP_ENTRY') error.code = 'MYSQL_CONSTRAINT'; throw error; }
      };
      return {
        get: async (...values) => (await execute(values))[0],
        all: (...values) => execute(values),
        run: async (...values) => { const result = await execute(values); return { changes: result.affectedRows, lastInsertRowid: result.insertId }; }
      };
    },
    async exec(sql) {
      const connection = await db.connection();
      const state = scope.getStore();
      if (/^BEGIN/.test(sql)) { await connection.beginTransaction(); state.transaction = true; }
      else if (/^COMMIT/.test(sql)) { await connection.commit(); state.transaction = false; }
      else if (/^ROLLBACK/.test(sql)) { await connection.rollback(); state.transaction = false; }
      else await connection.query(sql);
    },
    async initialize(owner = {}) {
      await db.withRequest(async () => {
        for (const sql of schema) await db.exec(sql);
        if (!owner.password) return;
        const accounts = require('./accounts.cjs');
        if (!/^[a-zA-Z0-9._@-]{3,100}$/.test(owner.username || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner.email || '') || owner.email.length > 180 || owner.password.length < 12 || owner.password.length > 200) throw Error('OWNER_CONFIG_INVALID');
        const lock = 'motorize-owner-' + crypto.createHash('sha256').update(env.MYSQL_DATABASE || 'test').digest('hex').slice(0, 32);
        const acquired = await db.prepare('SELECT GET_LOCK(?,10) locked').get(lock);
        if (acquired.locked !== 1) throw Error('MYSQL_SETUP_LOCK');
        try {
          if (await db.prepare("SELECT username FROM admins WHERE role='owner'").get()) return;
          await db.exec('BEGIN');
          const credentials = accounts.passwordHash(owner.password);
          const now = new Date().toISOString();
          const target = await db.prepare('SELECT username FROM admins WHERE username=?').get(owner.username);
          if (target) await db.prepare("UPDATE admins SET salt=?,hash=?,email=?,name=?,role='owner',active=1,updated=? WHERE username=?")
            .run(credentials.salt, credentials.hash, owner.email.toLowerCase(), 'Agência Tupiniquim', now, target.username);
          else await db.prepare("INSERT INTO admins(username,salt,hash,email,name,role,active,created,updated) VALUES(?,?,?,?,?,'owner',1,?,?)")
            .run(owner.username, credentials.salt, credentials.hash, owner.email.toLowerCase(), 'Agência Tupiniquim', now, now);
          await db.prepare('DELETE FROM sessions WHERE username=?').run(owner.username);
          await db.prepare('INSERT INTO account_audit(actor,event,target,created) VALUES(?,?,?,?)').run('server-setup', 'owner.created', owner.username, now);
          await db.exec('COMMIT');
        } finally { await db.prepare('SELECT RELEASE_LOCK(?)').get(lock); }
      });
    },
    close: () => pool.end()
  };
  return db;
}
module.exports = { openMySQL, translate, schema };
