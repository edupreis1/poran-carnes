const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
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
  // Retry logic — tries up to 10 times with 3s delay
  for(let attempt = 1; attempt <= 10; attempt++) {
    try {
      await pool.query('SELECT 1'); // test connection
      console.log(`DB connected on attempt ${attempt}`);
      break;
    } catch(e) {
      console.error(`DB attempt ${attempt}/10 failed: ${e.message}`);
      if(attempt === 10) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }

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
    lingua REAL DEFAULT 0,
    cfile REAL DEFAULT 0, alcatra REAL DEFAULT 0, maminha REAL DEFAULT 0,
    filet45 REAL DEFAULT 0, filetbc REAL DEFAULT 0,
    coxmole REAL DEFAULT 0, coxduro REAL DEFAULT 0, patinho REAL DEFAULT 0, lagarto REAL DEFAULT 0,
    capafile REAL DEFAULT 0, musculo REAL DEFAULT 0,
    days TEXT DEFAULT '14 Dias', prices_json TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW())`);

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
        [code, name, cnpj, days||'14 Dias']
      );
    }
    console.log(`Clientes carregados.`);
  }

  // Migrations
  try {
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS prices_json TEXT DEFAULT '{}'");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS capafile REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS musculo REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS lingua REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS musc_mole REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS musc_duro REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS picanha_r REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS diaf_bloco REAL DEFAULT 0");
    await pool.query("ALTER TABLE orders ALTER COLUMN days TYPE TEXT USING days::TEXT");
    await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS obs_default TEXT DEFAULT ''");
    await pool.query("UPDATE clients SET days_default = regexp_replace(days_default, '[^0-9]', '', 'g') || ' Dias' WHERE days_default !~ '[A-Za-z].*[A-Za-z]'");
    await pool.query("UPDATE clients SET days_default = '14 Dias' WHERE days_default IS NULL OR days_default = '' OR days_default = ' Dias'");
    await pool.query("UPDATE orders SET days = days || ' Dias' WHERE days ~ '^[0-9]+(\\.[0-9]+)?$'");
    await pool.query("ALTER TABLE orders ADD CONSTRAINT IF NOT EXISTS orders_client_week_unique UNIQUE (client_id, week_label)").catch(()=>{});
  } catch(e) { console.log('Migration note:', e.message); }

  // Default settings
  await pool.query(`INSERT INTO settings VALUES ('trucks','3') ON CONFLICT (key) DO NOTHING`);
  await pool.query(`INSERT INTO settings VALUES ('min_kg','12000') ON CONFLICT (key) DO NOTHING`);
  await pool.query(`INSERT INTO settings VALUES ('max_kg','17000') ON CONFLICT (key) DO NOTHING`);

  return db;
}

module.exports = { initDatabase, getDb: () => db };
