// Organix Global Export — backend server
// Zero external dependencies: uses Node's built-in http, crypto, and node:sqlite only.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'organix.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const FRESH_DB = !fs.existsSync(DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('vendor','buyer','admin')),
  name TEXT,
  business_name TEXT,
  business_type TEXT,
  city TEXT,
  address TEXT,
  phone TEXT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  bank_account TEXT,
  account_title TEXT,
  verification_status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  commission_pct REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  moq INTEGER DEFAULT 1,
  stock INTEGER DEFAULT 0,
  image_emoji TEXT DEFAULT '📦',
  status TEXT DEFAULT 'live' CHECK(status IN ('live','pending','rejected')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(vendor_id) REFERENCES users(id),
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL,
  vendor_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  total_amount REAL NOT NULL,
  commission_amount REAL NOT NULL,
  payout_amount REAL NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  created_at TEXT DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- Seed data (first run only) ----------
if (FRESH_DB) {
  const cats = [
    ['Textiles & Fabric', 13],
    ['Handicrafts & Artisan', 16],
    ['Leather Goods', 15],
    ['Home Decor', 16],
    ['Food & Spices', 11],
  ];
  const insCat = db.prepare('INSERT INTO categories (name, commission_pct) VALUES (?, ?)');
  cats.forEach(c => insCat.run(c[0], c[1]));

  function hash(pw) {
    const salt = crypto.randomBytes(16).toString('hex');
    const h = crypto.scryptSync(pw, salt, 64).toString('hex');
    return { salt, h };
  }

  const insUser = db.prepare(`INSERT INTO users
    (role, name, business_name, business_type, city, address, phone, email, password_hash, salt, bank_account, account_title, verification_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Admin
  let p = hash('Admin@12345');
  insUser.run('admin', 'Platform Admin', null, null, 'Karachi', null, '0300-0000000', 'admin@organix.pk', p.h, p.salt, null, null, 'n/a');

  // Demo vendors
  p = hash('Vendor@123');
  insUser.run('vendor', 'Amjad Textiles', 'Amjad Textile Mills', 'manufacturer', 'Faisalabad', 'Industrial Area, Faisalabad', '0301-1234567', 'vendor1@organix.pk', p.h, p.salt, 'PK00-BANK-0001', 'Amjad Textile Mills', 'verified');
  p = hash('Vendor@123');
  insUser.run('vendor', 'Sindhi Handicrafts Co.', 'Sindhi Handicrafts Co.', 'artisan', 'Hyderabad', 'Old City, Hyderabad', '0302-2345678', 'vendor2@organix.pk', p.h, p.salt, 'PK00-BANK-0002', 'Sindhi Handicrafts Co.', 'pending');

  // Demo buyer
  p = hash('Buyer@123');
  insUser.run('buyer', 'John Miller', null, null, null, '221B Baker Street, London, UK', '+44-7000-000000', 'buyer1@organix.pk', p.h, p.salt, null, null, 'n/a');

  const vendor1 = db.prepare('SELECT id FROM users WHERE email = ?').get('vendor1@organix.pk').id;
  const vendor2 = db.prepare('SELECT id FROM users WHERE email = ?').get('vendor2@organix.pk').id;
  const catTextile = db.prepare('SELECT id FROM categories WHERE name = ?').get('Textiles & Fabric').id;
  const catHandi = db.prepare('SELECT id FROM categories WHERE name = ?').get('Handicrafts & Artisan').id;
  const catHome = db.prepare('SELECT id FROM categories WHERE name = ?').get('Home Decor').id;

  const insProd = db.prepare(`INSERT INTO products (vendor_id, category_id, title, description, price, moq, stock, image_emoji, status) VALUES (?,?,?,?,?,?,?,?,'live')`);
  insProd.run(vendor1, catTextile, 'Handwoven Cotton Fabric (per meter)', 'Premium 100% cotton fabric, handwoven by artisans in Faisalabad. Ideal for export-grade garments.', 4.5, 500, 12000, '🧵');
  insProd.run(vendor1, catTextile, 'Embroidered Lawn Suit Set', 'Traditional embroidered 3-piece lawn suit, export quality stitching.', 18, 100, 3000, '👗');
  insProd.run(vendor2, catHandi, 'Hand-carved Wooden Jewellery Box', 'Sindhi artisan hand-carved rosewood jewellery box with mirror inlay work.', 22, 50, 800, '🎁');
  insProd.run(vendor2, catHome, 'Ajrak Print Cushion Covers (set of 4)', 'Traditional Sindhi Ajrak block-print cushion covers, 100% cotton.', 15, 30, 1500, '🛋️');

  console.log('Seeded fresh database with demo data.');
  console.log('Admin login: admin@organix.pk / Admin@12345');
}

// ---------- Helpers ----------
function hashPassword(pw, salt) {
  return crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, salt, expectedHash) {
  const h = hashPassword(pw, salt);
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(expectedHash, 'hex'));
}
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}
function publicUser(u) {
  if (!u) return null;
  const { password_hash, salt, ...rest } = u;
  return rest;
}
function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function getUserFromReq(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
}
function requireRole(user, role) {
  return user && user.role === role;
}

// ---------- Route handlers ----------
const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}
function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const parts = r.pattern.split('/').filter(Boolean);
    const pparts = pathname.split('/').filter(Boolean);
    if (parts.length !== pparts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = pparts[i];
      else if (parts[i] !== pparts[i]) { ok = false; break; }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

// ---- Auth ----
route('POST', '/api/signup', async (req, res, params, body) => {
  const { role, name, business_name, business_type, city, address, phone, email, password, bank_account, account_title } = body;
  if (!role || !['vendor', 'buyer'].includes(role)) return sendJSON(res, 400, { error: 'Invalid role' });
  if (!email || !password) return sendJSON(res, 400, { error: 'Email and password are required' });
  if (role === 'vendor' && !business_name) return sendJSON(res, 400, { error: 'Business name is required for vendors' });
  if (role === 'buyer' && !name) return sendJSON(res, 400, { error: 'Name is required for buyers' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return sendJSON(res, 409, { error: 'An account with this email already exists' });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const verification_status = role === 'vendor' ? 'pending' : 'n/a';

  const info = db.prepare(`INSERT INTO users
    (role, name, business_name, business_type, city, address, phone, email, password_hash, salt, bank_account, account_title, verification_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    role, name || business_name, business_name || null, business_type || null, city || null, address || null,
    phone || null, email, hash, salt, bank_account || null, account_title || null, verification_status
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = makeToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  sendJSON(res, 201, { token, user: publicUser(user) });
});

route('POST', '/api/login', async (req, res, params, body) => {
  const { email, password } = body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email || '');
  if (!user || !verifyPassword(password || '', user.salt, user.password_hash)) {
    return sendJSON(res, 401, { error: 'Invalid email or password' });
  }
  const token = makeToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  sendJSON(res, 200, { token, user: publicUser(user) });
});

route('POST', '/api/logout', async (req, res) => {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.slice(7));
  }
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res) => {
  const user = getUserFromReq(req);
  if (!user) return sendJSON(res, 401, { error: 'Not logged in' });
  sendJSON(res, 200, { user: publicUser(user) });
});

// ---- Categories ----
route('GET', '/api/categories', async (req, res) => {
  sendJSON(res, 200, db.prepare('SELECT * FROM categories ORDER BY name').all());
});

// ---- Public products ----
route('GET', '/api/products', async (req, res, params, body, query) => {
  let sql = `SELECT p.*, c.name as category_name, c.commission_pct, u.business_name as vendor_name, u.city as vendor_city, u.verification_status as vendor_verification
             FROM products p JOIN categories c ON p.category_id = c.id JOIN users u ON p.vendor_id = u.id
             WHERE p.status = 'live'`;
  const args = [];
  if (query.category) { sql += ' AND c.id = ?'; args.push(query.category); }
  if (query.search) { sql += ' AND (p.title LIKE ? OR p.description LIKE ?)'; args.push(`%${query.search}%`, `%${query.search}%`); }
  if (query.sort === 'price_asc') sql += ' ORDER BY p.price ASC';
  else if (query.sort === 'price_desc') sql += ' ORDER BY p.price DESC';
  else sql += ' ORDER BY p.created_at DESC';
  sendJSON(res, 200, db.prepare(sql).all(...args));
});

route('GET', '/api/products/:id', async (req, res, params) => {
  const p = db.prepare(`SELECT p.*, c.name as category_name, c.commission_pct, u.business_name as vendor_name, u.city as vendor_city, u.verification_status as vendor_verification
                         FROM products p JOIN categories c ON p.category_id = c.id JOIN users u ON p.vendor_id = u.id
                         WHERE p.id = ?`).get(params.id);
  if (!p) return sendJSON(res, 404, { error: 'Product not found' });
  sendJSON(res, 200, p);
});

// ---- Vendor routes ----
route('GET', '/api/vendor/products', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const rows = db.prepare(`SELECT p.*, c.name as category_name FROM products p JOIN categories c ON p.category_id=c.id WHERE vendor_id = ? ORDER BY p.created_at DESC`).all(user.id);
  sendJSON(res, 200, rows);
});

route('POST', '/api/vendor/products', async (req, res, params, body) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const { category_id, title, description, price, moq, stock, image_emoji } = body;
  if (!category_id || !title || !price) return sendJSON(res, 400, { error: 'Category, title and price are required' });
  const info = db.prepare(`INSERT INTO products (vendor_id, category_id, title, description, price, moq, stock, image_emoji, status)
    VALUES (?,?,?,?,?,?,?,?, 'live')`).run(user.id, category_id, title, description || '', price, moq || 1, stock || 0, image_emoji || '📦');
  sendJSON(res, 201, db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
});

route('PUT', '/api/vendor/products/:id', async (req, res, params, body) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(params.id);
  if (!prod || prod.vendor_id !== user.id) return sendJSON(res, 404, { error: 'Product not found' });
  const fields = ['category_id', 'title', 'description', 'price', 'moq', 'stock', 'image_emoji'];
  const updates = fields.filter(f => body[f] !== undefined);
  if (updates.length) {
    const setSql = updates.map(f => `${f} = ?`).join(', ');
    db.prepare(`UPDATE products SET ${setSql} WHERE id = ?`).run(...updates.map(f => body[f]), params.id);
  }
  sendJSON(res, 200, db.prepare('SELECT * FROM products WHERE id = ?').get(params.id));
});

route('DELETE', '/api/vendor/products/:id', async (req, res, params) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(params.id);
  if (!prod || prod.vendor_id !== user.id) return sendJSON(res, 404, { error: 'Product not found' });
  db.prepare('DELETE FROM products WHERE id = ?').run(params.id);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/vendor/orders', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const rows = db.prepare(`SELECT o.*, u.name as buyer_name, u.address as buyer_address FROM orders o JOIN users u ON o.buyer_id = u.id WHERE o.vendor_id = ? ORDER BY o.created_at DESC`).all(user.id);
  sendJSON(res, 200, rows);
});

route('PUT', '/api/vendor/orders/:id', async (req, res, params, body) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order || order.vendor_id !== user.id) return sendJSON(res, 404, { error: 'Order not found' });
  if (!['in_progress', 'cancelled'].includes(body.status)) return sendJSON(res, 400, { error: 'Invalid status transition' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(body.status, params.id);no
  sendJSON(res, 200, db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id));
});

route('GET', '/api/vendor/earnings', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'vendor')) return sendJSON(res, 403, { error: 'Vendor access only' });
  const completed = db.prepare(`SELECT COALESCE(SUM(payout_amount),0) as total, COUNT(*) as count FROM orders WHERE vendor_id = ? AND status = 'completed'`).get(user.id);
  const pending = db.prepare(`SELECT COALESCE(SUM(payout_amount),0) as total, COUNT(*) as count FROM orders WHERE vendor_id = ? AND status IN ('pending','in_progress')`).get(user.id);
  sendJSON(res, 200, { paid_out: completed.total, paid_orders: completed.count, pending_payout: pending.total, pending_orders: pending.count });
});

// ---- Buyer routes ----
route('POST', '/api/orders', async (req, res, params, body) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'buyer')) return sendJSON(res, 403, { error: 'Buyer access only' });
  const { product_id, quantity } = body;
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product || product.status !== 'live') return sendJSON(res, 404, { error: 'Product not available' });
  const qty = parseInt(quantity, 10) || 1;
  if (qty < product.moq) return sendJSON(res, 400, { error: `Minimum order quantity is ${product.moq}` });
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(product.category_id);
  const total = product.price * qty;
  const commission = +(total * (category.commission_pct / 100)).toFixed(2);
  const payout = +(total - commission).toFixed(2);
  const info = db.prepare(`INSERT INTO orders (buyer_id, vendor_id, product_id, product_title, quantity, total_amount, commission_amount, payout_amount, status)
    VALUES (?,?,?,?,?,?,?,?, 'pending')`).run(user.id, product.vendor_id, product.id, product.title, qty, total, commission, payout);
  sendJSON(res, 201, db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));
});

route('GET', '/api/buyer/orders', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'buyer')) return sendJSON(res, 403, { error: 'Buyer access only' });
  const rows = db.prepare(`SELECT o.*, u.business_name as vendor_name FROM orders o JOIN users u ON o.vendor_id = u.id WHERE o.buyer_id = ? ORDER BY o.created_at DESC`).all(user.id);
  sendJSON(res, 200, rows);
});

route('POST', '/api/buyer/orders/:id/confirm', async (req, res, params) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'buyer')) return sendJSON(res, 403, { error: 'Buyer access only' });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id);
  if (!order || order.buyer_id !== user.id) return sendJSON(res, 404, { error: 'Order not found' });
  if (order.status === 'completed') return sendJSON(res, 400, { error: 'Order already completed' });
  db.prepare(`UPDATE orders SET status = 'completed', confirmed_at = datetime('now') WHERE id = ?`).run(params.id);
  sendJSON(res, 200, db.prepare('SELECT * FROM orders WHERE id = ?').get(params.id));
});

// ---- Admin routes ----
route('GET', '/api/admin/vendors', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'admin')) return sendJSON(res, 403, { error: 'Admin access only' });
  const rows = db.prepare(`SELECT id, name, business_name, business_type, city, phone, email, verification_status, created_at FROM users WHERE role = 'vendor' ORDER BY created_at DESC`).all();
  sendJSON(res, 200, rows);
});

route('POST', '/api/admin/vendors/:id/verify', async (req, res, params, body) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'admin')) return sendJSON(res, 403, { error: 'Admin access only' });
  if (!['verified', 'rejected', 'pending'].includes(body.status)) return sendJSON(res, 400, { error: 'Invalid status' });
  db.prepare("UPDATE users SET verification_status = ? WHERE id = ? AND role = 'vendor'").run(body.status, params.id);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/admin/products', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'admin')) return sendJSON(res, 403, { error: 'Admin access only' });
  const rows = db.prepare(`SELECT p.*, c.name as category_name, u.business_name as vendor_name FROM products p JOIN categories c ON p.category_id=c.id JOIN users u ON p.vendor_id=u.id ORDER BY p.created_at DESC`).all();
  sendJSON(res, 200, rows);
});

route('POST', '/api/admin/products/:id/moderate', async (req, res, params, body) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'admin')) return sendJSON(res, 403, { error: 'Admin access only' });
  if (!['live', 'rejected', 'pending'].includes(body.status)) return sendJSON(res, 400, { error: 'Invalid status' });
  db.prepare('UPDATE products SET status = ? WHERE id = ?').run(body.status, params.id);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/admin/orders', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'admin')) return sendJSON(res, 403, { error: 'Admin access only' });
  const rows = db.prepare(`SELECT o.*, b.name as buyer_name, v.business_name as vendor_name FROM orders o
    JOIN users b ON o.buyer_id = b.id JOIN users v ON o.vendor_id = v.id ORDER BY o.created_at DESC`).all();
  sendJSON(res, 200, rows);
});

route('GET', '/api/admin/stats', async (req, res) => {
  const user = getUserFromReq(req);
  if (!requireRole(user, 'admin')) return sendJSON(res, 403, { error: 'Admin access only' });
  const vendors = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='vendor'`).get().c;
  const verifiedVendors = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='vendor' AND verification_status='verified'`).get().c;
  const buyers = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role='buyer'`).get().c;
  const liveProducts = db.prepare(`SELECT COUNT(*) as c FROM products WHERE status='live'`).get().c;
  const gmv = db.prepare(`SELECT COALESCE(SUM(total_amount),0) as s FROM orders WHERE status='completed'`).get().s;
  const commission = db.prepare(`SELECT COALESCE(SUM(commission_amount),0) as s FROM orders WHERE status='completed'`).get().s;
  const ordersByStatus = db.prepare(`SELECT status, COUNT(*) as c FROM orders GROUP BY status`).all();
  sendJSON(res, 200, { vendors, verifiedVendors, buyers, liveProducts, gmv, commission, ordersByStatus });
});

// ---------- Static file serving ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback: try appending .html
      fs.readFile(filePath + '.html', (err2, data2) => {
        if (err2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const pathname = u.pathname;
  const query = Object.fromEntries(u.searchParams.entries());

  if (req.method === 'OPTIONS') {
    return sendJSON(res, 200, {});
  }

  if (pathname.startsWith('/api/')) {
    const match = matchRoute(req.method, pathname);
    if (!match) return sendJSON(res, 404, { error: 'Not found' });
    let body = {};
    if (['POST', 'PUT'].includes(req.method)) {
      try { body = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: 'Invalid JSON body' }); }
    }
    try {
      await match.handler(req, res, match.params, body, query);
    } catch (e) {
      console.error(e);
      sendJSON(res, 500, { error: 'Server error', detail: e.message });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Organix Global Export running at http://localhost:${PORT}`);
});
