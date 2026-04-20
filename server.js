const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { initDatabase, getDb } = require('./database');
let db;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'poran-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res, next) => {
  if (!req.session?.userId) return res.redirect('/login.html');
  next();
});

function requireAuth(req, res, next) {
  if (req.session?.userId) return next();
  res.status(401).json({ error: 'Não autorizado' });
}

// ---- AUTH ----
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password))
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (req.session?.userId) res.json({ loggedIn: true, username: req.session.username });
  else res.json({ loggedIn: false });
});

app.post('/api/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(400).json({ error: 'Senha atual incorreta' });
    const hash = bcrypt.hashSync(newPassword, 10);
    await db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.session.userId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- CLIENTS ----
app.get('/api/clients', requireAuth, async (req, res) => {
  try {
    const clients = await db.prepare('SELECT * FROM clients ORDER BY id').all();
    res.json(clients);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', requireAuth, async (req, res) => {
  try {
    const { name, code, cnpj, email, days_default, price_table } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    const result = await db.prepare(
      'INSERT INTO clients (name,code,cnpj,email,days_default,price_table) VALUES (?,?,?,?,?,?)'
    ).run(name, code||'', cnpj||'', email||'', days_default||14, price_table||'');
    const newId = result.lastInsertRowid;
    if (!newId) return res.status(500).json({ error: 'Falha ao criar cliente' });
    res.json({ id: newId, name, code: code||'', cnpj: cnpj||'', email: email||'', days_default: days_default||14, price_table: price_table||'' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    const { name, code, cnpj, email, days_default, price_table } = req.body;
    await db.prepare('UPDATE clients SET name=?,code=?,cnpj=?,email=?,days_default=?,price_table=? WHERE id=?')
      .run(name, code||'', cnpj||'', email||'', days_default||14, price_table||'', req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    await db.prepare('DELETE FROM orders WHERE client_id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- ORDERS ----
const ORDER_FIELDS = ['boi_cas','nov_cas','boi_ts','boi_tcc','boi_dtb','boi_pab','vac_cas','vac_ts','vac_tcc','vac_dtv','vac_pav','fig','rab','buc','cor','cup','san','lom','dia','ind','cfile','alcatra','maminha','filet45','filetbc','coxmole','coxduro','patinho','lagarto'];

app.get('/api/orders/:weekLabel', requireAuth, async (req, res) => {
  try {
    const orders = await db.prepare('SELECT * FROM orders WHERE week_label = ?').all(req.params.weekLabel);
    const result = {};
    orders.forEach(o => {
      const key = String(o.client_id).includes('_') ? o.client_id : parseInt(o.client_id);
      const entry = { _days: o.days };
      ORDER_FIELDS.forEach(f => entry[f] = o[f] || 0);
      result[key] = entry;
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders/:weekLabel', requireAuth, async (req, res) => {
  try {
    const { clientId, qtd } = req.body;
    const week = req.params.weekLabel;
    const vals = ORDER_FIELDS.map(f => parseFloat(qtd[f]) || 0);
    const existing = await db.prepare('SELECT id FROM orders WHERE client_id = ? AND week_label = ?').get(String(clientId), week);
    if (existing) {
      await db.prepare(`UPDATE orders SET ${ORDER_FIELDS.map(f=>f+'=?').join(',')},days=? WHERE client_id=? AND week_label=?`)
        .run(...vals, qtd._days||14, String(clientId), week);
    } else {
      await db.prepare(`INSERT INTO orders (client_id,week_label,${ORDER_FIELDS.join(',')},days) VALUES (?,?,${ORDER_FIELDS.map(()=>'?').join(',')},?)`)
        .run(String(clientId), week, ...vals, qtd._days||14);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:weekLabel/:clientId', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM orders WHERE client_id = ? AND week_label = ?')
      .run(req.params.clientId, req.params.weekLabel);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:weekLabel', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM orders WHERE week_label = ?').run(req.params.weekLabel);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- ROUTES ----
app.get('/api/route/:weekLabel', requireAuth, async (req, res) => {
  try {
    const row = await db.prepare('SELECT route_data FROM routes WHERE week_label = ?').get(req.params.weekLabel);
    res.json(row ? JSON.parse(row.route_data) : {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/route/:weekLabel', requireAuth, async (req, res) => {
  try {
    const week = req.params.weekLabel;
    const data = JSON.stringify(req.body);
    const existing = await db.prepare('SELECT id FROM routes WHERE week_label = ?').get(week);
    if (existing) {
      await db.prepare('UPDATE routes SET route_data=?,updated_at=NOW() WHERE week_label=?').run(data, week);
    } else {
      await db.prepare('INSERT INTO routes (week_label,route_data) VALUES (?,?)').run(week, data);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- SETTINGS ----
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    rows.forEach(r => {
      try { result[r.key] = JSON.parse(r.value); } catch(e) { result[r.key] = r.value; }
    });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/settings', requireAuth, async (req, res) => {
  try {
    for(const [k,v] of Object.entries(req.body)) {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=?')
        .run(k, val, val);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- PRICE TABLES ----
app.get('/api/price-table/:table', requireAuth, async (req, res) => {
  try {
    const row = await db.prepare("SELECT value FROM settings WHERE key=?").get('table'+req.params.table);
    if(!row) return res.status(404).json({ error: 'not found' });
    res.json(JSON.parse(row.value));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/price-table/:table', requireAuth, async (req, res) => {
  try {
    const key = 'table'+req.params.table;
    const val = JSON.stringify(req.body.cortes);
    await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=?')
      .run(key, val, val);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- START ----
initDatabase().then(database => {
  db = database;
  app.listen(PORT, () => {
    console.log(`Poran Carnes rodando em http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Erro ao inicializar banco:', err);
  process.exit(1);
});
