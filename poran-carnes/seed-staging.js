// Preenche o ambiente de TESTE com uma semana de pedidos de exemplo.
// Uso (no Railway, serviço do ambiente staging): npm run seed:staging
// Só roda com APP_ENV=staging. Nunca roda em produção.

const { isStaging, assertSafeDatabase } = require('./env');

if (!isStaging) {
  console.error('seed-staging só roda com APP_ENV=staging. Nada foi feito.');
  process.exit(1);
}
assertSafeDatabase();

const { initDatabase } = require('./database');
const { Pool } = require('pg');

const QTD_CLIENTES = 25;
const CAMPOS = ['boi_cas', 'nov_cas', 'vac_cas', 'boi_ts', 'vac_ts', 'fig', 'cup', 'alcatra', 'patinho', 'lagarto'];

function aleatorio(min, max) {
  return Math.round((min + Math.random() * (max - min)) / 5) * 5;
}

(async () => {
  await initDatabase(); // garante que as tabelas existem
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });

  const { rows: clientes } = await pool.query(
    'SELECT id, days_default FROM clients ORDER BY id LIMIT $1', [QTD_CLIENTES]
  );
  const colunas = CAMPOS.join(',');
  const params = CAMPOS.map((_, i) => '$' + (i + 2)).join(',');
  const update = CAMPOS.map(f => f + '=EXCLUDED.' + f).join(',');
  const sql =
    'INSERT INTO orders (client_id, week_label, ' + colunas + ', days, prices_json) ' +
    "VALUES ($1, 'active', " + params + ', $' + (CAMPOS.length + 2) + ", '{}') " +
    'ON CONFLICT (client_id, week_label) DO UPDATE SET ' + update;

  for (const c of clientes) {
    const vals = CAMPOS.map((f, i) =>
      i < 3 ? aleatorio(100, 900) : (Math.random() < 0.4 ? aleatorio(20, 200) : 0)
    );
    await pool.query(sql, [String(c.id), ...vals, c.days_default || '14 Dias']);
  }
  console.log('Pedidos de exemplo criados/atualizados para ' + clientes.length + ' clientes na semana ativa.');
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('Erro no seed:', e); process.exit(1); });
