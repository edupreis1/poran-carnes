const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const { Pool } = require('pg');
const { initDatabase, getDb } = require('./database');
let db;

// Separate pool for session store
const sessionPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({
    pool: sessionPool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'poran-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
    secure: false
  }
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
    // Normalize days_default: "14" → "14 Dias"
  clients.forEach(c => {
    if(c.days_default && !isNaN(String(c.days_default).trim())) {
      c.days_default = String(c.days_default).trim() + ' Dias';
    }
  });
  res.json(clients);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', requireAuth, async (req, res) => {
  try {
    const { name, code, cnpj, email, days_default, price_table } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    const result = await db.prepare('INSERT INTO clients (name,code,cnpj,email,days_default,price_table) VALUES (?,?,?,?,?,?)').run(name, code||'', cnpj||'', email||'', days_default||14, price_table||'');
    const newId = result.lastInsertRowid;
    if (!newId) return res.status(500).json({ error: 'Falha ao criar cliente' });
    res.json({ id: newId, name, code: code||'', cnpj: cnpj||'', email: email||'', days_default: days_default||14, price_table: price_table||'' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clients/:id', requireAuth, async (req, res) => {
  try {
    const { name, code, cnpj, email, days_default, price_table } = req.body;
    await db.prepare('UPDATE clients SET name=?,code=?,cnpj=?,email=?,days_default=?,price_table=?,obs_default=? WHERE id=?').run(name, code||'', cnpj||'', email||'', days_default||'14 Dias', price_table||'', obs_default||'', req.params.id);
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
const ORDER_FIELDS = ['boi_cas','nov_cas','boi_ts','boi_tcc','boi_dtb','boi_pab','vac_cas','vac_ts','vac_tcc','vac_dtv','vac_pav','fig','rab','buc','cor','cup','san','lom','dia','ind','cfile','alcatra','maminha','filet45','filetbc','coxmole','coxduro','patinho','lagarto','capafile','musculo'];

app.get('/api/orders/:weekLabel', requireAuth, async (req, res) => {
  try {
    const orders = await db.prepare('SELECT * FROM orders WHERE week_label = ?').all(req.params.weekLabel);
    const result = {};
    orders.forEach(o => {
      const key = String(o.client_id).includes('_') ? o.client_id : parseInt(o.client_id);
      // days stored as text label, handle legacy numeric values
      const daysVal = o.days || '14 Dias';
      const entry = { _days: isNaN(daysVal) ? daysVal : daysVal + ' Dias' };
      ORDER_FIELDS.forEach(f => entry[f] = o[f] || 0);
      // Restore custom prices
      try {
        const prices = JSON.parse(o.prices_json || '{}');
        Object.assign(entry, prices);
      } catch(e){}
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
    // _days can be a string label "14 Dias" or legacy number 14
    const daysRaw = qtd._days;
    const days = daysRaw 
      ? (isNaN(daysRaw) ? String(daysRaw) : daysRaw + ' Dias')
      : '14 Dias';
    // Extract custom prices and obs
    const prices = {};
    Object.keys(qtd).filter(k=>k.startsWith('_price_') || k==='_obs').forEach(k=>{ prices[k]=qtd[k]; });
    const pricesJson = JSON.stringify(prices);
    const existing = await db.prepare('SELECT id FROM orders WHERE client_id = ? AND week_label = ?').get(String(clientId), week);
    const stmt = existing
      ? db.prepare(`UPDATE orders SET ${ORDER_FIELDS.map(f=>f+'=?').join(',')},days=?,prices_json=? WHERE client_id=? AND week_label=?`)
      : db.prepare(`INSERT INTO orders (client_id,week_label,${ORDER_FIELDS.join(',')},days,prices_json) VALUES (?,?,${ORDER_FIELDS.map(()=>'?').join(',')},?,?)`);
    const runParams = existing
      ? [...vals, days, pricesJson, String(clientId), week]
      : [String(clientId), week, ...vals, days, pricesJson];
    await stmt.run(...runParams);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:weekLabel/:clientId', requireAuth, async (req, res) => {
  try {
    await db.prepare('DELETE FROM orders WHERE client_id = ? AND week_label = ?').run(req.params.clientId, req.params.weekLabel);
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
      await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=?').run(k, val, val);
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
    await db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT (key) DO UPDATE SET value=?').run(key, val, val);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- DOCX GENERATION ----
app.post('/api/generate-docx', requireAuth, async (req, res) => {
  try {
    const { trucks } = req.body; // array of {title, entries: [{header, lines, obs}]}
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');

    const FONT = 'Arial';
    const SIZE = 20; // 10pt in half-points
    const BOLD_RUN = (text, color) => new TextRun({
      text, font: FONT, size: SIZE, bold: false,
      color: color || '000000'
    });
    const OBS_RUN = (text) => new TextRun({
      text, font: FONT, size: SIZE, bold: false, color: 'CC0000'
    });

    const allChildren = [];

    trucks.forEach((truck, ti) => {
      // Truck header
      allChildren.push(new Paragraph({
        children: [BOLD_RUN(truck.title)],
        spacing: { before: ti === 0 ? 0 : 120, after: 0 },
      }));

      truck.entries.forEach((entry, ei) => {
        // Entrega number — space before each one
        allChildren.push(new Paragraph({
          children: [BOLD_RUN(`${ei+1}ª Entrega`)],
          spacing: { before: ei===0 ? 80 : 200, after: 0 },
        }));
        // Client name
        allChildren.push(new Paragraph({
          children: [BOLD_RUN(entry.clientName)],
          spacing: { before: 0, after: 0 },
        }));
        // Code - CNPJ
        if(entry.codeAndCnpj) allChildren.push(new Paragraph({
          children: [BOLD_RUN(entry.codeAndCnpj)],
          spacing: { before: 0, after: 0 },
        }));
        // Items
        entry.items.forEach(item => {
          allChildren.push(new Paragraph({
            children: [BOLD_RUN(item)],
            spacing: { before: 0, after: 0 },
          }));
        });
        // Payment
        allChildren.push(new Paragraph({
          children: [BOLD_RUN(entry.days)],
          spacing: { before: 0, after: 0 },
        }));
        // Obs in red
        if(entry.obs) allChildren.push(new Paragraph({
          children: [OBS_RUN(entry.obs)],
          spacing: { before: 0, after: 0 },
        }));
      });
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 720, right: 720, bottom: 720, left: 720 } // 1.27cm = ~720 DXA
          }
        },
        children: allChildren
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Roteiro.docx"');
    res.send(buffer);
  } catch(e) {
    console.error('DOCX error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---- DEBUG ----
app.get('/api/debug/orders', requireAuth, async (req, res) => {
  try {
    const rows = await db.prepare('SELECT client_id, week_label, boi_cas, nov_cas, days FROM orders ORDER BY created_at DESC LIMIT 20').all();
    res.json({ count: rows.length, rows, week_now: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ---- DOCX GENERATION ----
app.post('/api/generate-docx', requireAuth, async (req, res) => {
  try {
    const { trucks } = req.body; // array of {title, entries: [{header, lines, obs}]}
    const { Document, Packer, Paragraph, TextRun, AlignmentType } = require('docx');

    const FONT = 'Arial';
    const SIZE = 20; // 10pt in half-points
    const BOLD_RUN = (text, color) => new TextRun({
      text, font: FONT, size: SIZE, bold: false,
      color: color || '000000'
    });
    const OBS_RUN = (text) => new TextRun({
      text, font: FONT, size: SIZE, bold: false, color: 'CC0000'
    });

    const allChildren = [];

    trucks.forEach((truck, ti) => {
      // Truck header
      allChildren.push(new Paragraph({
        children: [BOLD_RUN(truck.title)],
        spacing: { before: ti === 0 ? 0 : 120, after: 0 },
      }));

      truck.entries.forEach((entry, ei) => {
        // Entrega number — space before each one
        allChildren.push(new Paragraph({
          children: [BOLD_RUN(`${ei+1}ª Entrega`)],
          spacing: { before: ei===0 ? 80 : 200, after: 0 },
        }));
        // Client name
        allChildren.push(new Paragraph({
          children: [BOLD_RUN(entry.clientName)],
          spacing: { before: 0, after: 0 },
        }));
        // Code - CNPJ
        if(entry.codeAndCnpj) allChildren.push(new Paragraph({
          children: [BOLD_RUN(entry.codeAndCnpj)],
          spacing: { before: 0, after: 0 },
        }));
        // Items
        entry.items.forEach(item => {
          allChildren.push(new Paragraph({
            children: [BOLD_RUN(item)],
            spacing: { before: 0, after: 0 },
          }));
        });
        // Payment
        allChildren.push(new Paragraph({
          children: [BOLD_RUN(entry.days)],
          spacing: { before: 0, after: 0 },
        }));
        // Obs in red
        if(entry.obs) allChildren.push(new Paragraph({
          children: [OBS_RUN(entry.obs)],
          spacing: { before: 0, after: 0 },
        }));
      });
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 720, right: 720, bottom: 720, left: 720 } // 1.27cm = ~720 DXA
          }
        },
        children: allChildren
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Roteiro.docx"');
    res.send(buffer);
  } catch(e) {
    console.error('DOCX error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---- DEBUG ----
app.get('/api/debug/orders', requireAuth, async (req, res) => {
  try {
    const week = req.query.week || '';
    const rows = await db.prepare('SELECT client_id, week_label, boi_cas, nov_cas, vac_cas, days FROM orders WHERE week_label LIKE ? ORDER BY created_at DESC LIMIT 20').all('%'+week+'%');
    const weeks = await db.prepare("SELECT DISTINCT week_label FROM orders ORDER BY week_label DESC LIMIT 10").all();
    res.json({ rows, weeks, currentWeek: req.query.week });
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
