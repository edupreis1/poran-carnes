const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

function toPostgres(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  prepare(sql) {
    return {
      async get(...p) {
        const params = (p.length===1 && Array.isArray(p[0])) ? p[0] : p;
        const res = await pool.query(toPostgres(sql), params);
        return res.rows[0] || undefined;
      },
      async all(...p) {
        const params = (p.length===1 && Array.isArray(p[0])) ? p[0] : p;
        const res = await pool.query(toPostgres(sql), params);
        return res.rows;
      },
      async run(...p) {
        const params = (p.length===1 && Array.isArray(p[0])) ? p[0] : p;
        let pgSql = toPostgres(sql);
        const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
        // Only add RETURNING id for tables that have an id column (not settings)
        const noIdTables = ['settings'];
        const hasNoId = noIdTables.some(t => pgSql.toLowerCase().includes('into '+t));
        if(isInsert && !pgSql.toUpperCase().includes('RETURNING') && !hasNoId) {
          pgSql += ' RETURNING id';
        }
        const res = await pool.query(pgSql, params);
        return { lastInsertRowid: res.rows[0]?.id || 0 };
      }
    };
  },
  async exec(sql) { await pool.query(sql); }
};

async function initDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS clients (
    id SERIAL PRIMARY KEY, code TEXT DEFAULT '', name TEXT NOT NULL,
    cnpj TEXT DEFAULT '', email TEXT DEFAULT '',
    days_default TEXT DEFAULT '14 Dias', price_table TEXT DEFAULT '', obs_default TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY, client_id TEXT, week_label TEXT,
    boi_cas REAL DEFAULT 0, nov_cas REAL DEFAULT 0,
    boi_ts REAL DEFAULT 0, boi_tcc REAL DEFAULT 0, boi_dtb REAL DEFAULT 0, boi_pab REAL DEFAULT 0,
    vac_cas REAL DEFAULT 0, vac_ts REAL DEFAULT 0, vac_tcc REAL DEFAULT 0,
    vac_dtv REAL DEFAULT 0, vac_pav REAL DEFAULT 0,
    fig REAL DEFAULT 0, rab REAL DEFAULT 0, buc REAL DEFAULT 0, cor REAL DEFAULT 0,
    cup REAL DEFAULT 0, san REAL DEFAULT 0, lom REAL DEFAULT 0, dia REAL DEFAULT 0, ind REAL DEFAULT 0,
    cfile REAL DEFAULT 0, alcatra REAL DEFAULT 0, maminha REAL DEFAULT 0,
    filet45 REAL DEFAULT 0, filetbc REAL DEFAULT 0,
    coxmole REAL DEFAULT 0, coxduro REAL DEFAULT 0, patinho REAL DEFAULT 0, lagarto REAL DEFAULT 0,
    capafile REAL DEFAULT 0, musculo REAL DEFAULT 0,
    days TEXT DEFAULT '14 Dias', prices_json TEXT DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS routes (
    id SERIAL PRIMARY KEY, week_label TEXT NOT NULL,
    route_data TEXT NOT NULL, updated_at TIMESTAMP DEFAULT NOW())`);

  await pool.query(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  // Default user
  const u = await pool.query("SELECT id FROM users WHERE username='beto'");
  if(!u.rows.length) {
    const hash = bcrypt.hashSync('poran2024', 10);
    await pool.query("INSERT INTO users (username,password) VALUES ('beto',$1)", [hash]);
    console.log('Usuário criado: beto / poran2024');
  }

  // Seed clients
  const cnt = await pool.query('SELECT COUNT(*) FROM clients');
  if(parseInt(cnt.rows[0].count) === 0) {
    console.log('Carregando clientes...');
    const CLIENT_DATA = require('./clients_seed');
    for(const [code,name,cnpj,days] of CLIENT_DATA) {
      await pool.query(
        'INSERT INTO clients (code,name,cnpj,days_default) VALUES ($1,$2,$3,$4)',
        [code, name, cnpj, days]
      );
    }
    console.log(`${CLIENT_DATA.length} clientes carregados.`);
  }

  // Migrate: add new columns and fix days column type
  try {
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS prices_json TEXT DEFAULT '{}'");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS capafile REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS musculo REAL DEFAULT 0");
    // Migrate days from REAL to TEXT if needed
    await pool.query("ALTER TABLE orders ALTER COLUMN days TYPE TEXT USING days::TEXT");
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS obs_default TEXT DEFAULT ''");
    // Migrate clients.days_default from INTEGER to TEXT if needed  
    await pool.query("ALTER TABLE clients ALTER COLUMN days_default TYPE TEXT USING days_default::TEXT");
  } catch(e) { /* columns may already exist or already TEXT */ }

  // Default settings
  await pool.query(`INSERT INTO settings VALUES ('trucks','3') ON CONFLICT (key) DO NOTHING`);
  await pool.query(`INSERT INTO settings VALUES ('min_kg','12000') ON CONFLICT (key) DO NOTHING`);
  await pool.query(`INSERT INTO settings VALUES ('max_kg','17000') ON CONFLICT (key) DO NOTHING`);

  return db;
}

module.exports = { initDatabase, getDb: () => db };
