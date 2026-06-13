require('dotenv').config();
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const PgSession = connectPgSimple(session);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'ecommerce-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  next();
}

// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) { res.status(400).json({ error: 'username, email, and password are required' }); return; }
  const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
  if (existing.rows.length) { res.status(409).json({ error: 'Email already registered' }); return; }
  const hash = await bcrypt.hash(password, 10);
  const { rows: [user] } = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id, username, email',
    [username, email, hash]
  );
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: 'Session error' }); return; }
    res.status(201).json({ id: user.id, username: user.username, email: user.email });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: 'email and password are required' }); return; }
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' }); return;
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.save((err) => {
    if (err) { res.status(500).json({ error: 'Session error' }); return; }
    res.json({ id: user.id, username: user.username, email: user.email });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) { res.status(401).json({ error: 'Not authenticated' }); return; }
  res.json({ id: req.session.userId, username: req.session.username });
});

// ── Products ──────────────────────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM products ORDER BY created_at');
  res.json(rows);
});

app.get('/api/products/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [product] } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json(product);
});

app.post('/api/products', requireAuth, async (req, res) => {
  const { name, description, price, image_url, stock } = req.body;
  if (!name || !price) { res.status(400).json({ error: 'name and price are required' }); return; }
  const { rows: [product] } = await pool.query(
    'INSERT INTO products (name, description, price, image_url, stock) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [name, description || '', price, image_url || '', stock || 0]
  );
  res.status(201).json(product);
});

// ── Cart ──────────────────────────────────────────────────────────────────────
app.get('/api/cart', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ci.id, ci.quantity,
       json_build_object('id',p.id,'name',p.name,'price',p.price,'image_url',p.image_url,'stock',p.stock) AS product
     FROM cart_items ci JOIN products p ON p.id=ci.product_id
     WHERE ci.user_id=$1`,
    [req.session.userId]
  );
  res.json(rows);
});

app.post('/api/cart', requireAuth, async (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId) { res.status(400).json({ error: 'productId is required' }); return; }
  const qty = quantity || 1;
  const { rows: [existing] } = await pool.query(
    'SELECT * FROM cart_items WHERE user_id=$1 AND product_id=$2', [req.session.userId, productId]
  );
  if (existing) {
    const { rows: [updated] } = await pool.query(
      'UPDATE cart_items SET quantity=$1 WHERE id=$2 RETURNING *',
      [existing.quantity + qty, existing.id]
    );
    res.json(updated); return;
  }
  const { rows: [item] } = await pool.query(
    'INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1,$2,$3) RETURNING *',
    [req.session.userId, productId, qty]
  );
  res.status(201).json(item);
});

app.delete('/api/cart/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  await pool.query('DELETE FROM cart_items WHERE id=$1 AND user_id=$2', [id, req.session.userId]);
  res.sendStatus(204);
});

// ── Orders ────────────────────────────────────────────────────────────────────
app.post('/api/orders', requireAuth, async (req, res) => {
  const { rows: cartItems } = await pool.query(
    `SELECT ci.quantity, p.id AS product_id, p.price FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.user_id=$1`,
    [req.session.userId]
  );
  if (!cartItems.length) { res.status(400).json({ error: 'Cart is empty' }); return; }
  const total = cartItems.reduce((sum, i) => sum + parseFloat(i.price) * i.quantity, 0);
  const { rows: [order] } = await pool.query(
    'INSERT INTO orders (user_id, total, status) VALUES ($1,$2,$3) RETURNING *',
    [req.session.userId, total.toFixed(2), 'confirmed']
  );
  for (const item of cartItems) {
    await pool.query(
      'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1,$2,$3,$4)',
      [order.id, item.product_id, item.quantity, item.price]
    );
  }
  await pool.query('DELETE FROM cart_items WHERE user_id=$1', [req.session.userId]);
  res.status(201).json(order);
});

app.get('/api/orders', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at', [req.session.userId]
  );
  res.json(rows);
});

app.get('/api/orders/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }
  const { rows: [order] } = await pool.query(
    'SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, req.session.userId]
  );
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  const { rows: items } = await pool.query(
    `SELECT oi.quantity, oi.price, json_build_object('id',p.id,'name',p.name) AS product
     FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1`,
    [id]
  );
  res.json({ ...order, items });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`E-commerce server running on http://localhost:${PORT}`));
