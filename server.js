'use strict';

const express = require('express');
const path = require('path');
const https = require('https');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = (process.env.ADMIN_CHAT_ID || '').trim();

// Notification failures must never undo an already saved order.
function sendOrderNotification(order) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.error('Telegram: задайте BOT_TOKEN и ADMIN_CHAT_ID; заказ сохранён.');
    return Promise.resolve(false);
  }
  const short = value => String(value || '').slice(0, 300);
  const lines = [
    `Новый заказ №${order.id}`, `Клиент: ${short(order.name)}`,
    `Телефон: ${short(order.phone)}`, `Адрес: ${short(order.address) || 'Не указан'}`,
    `Комментарий: ${short(order.comment) || 'Нет'}`, '',
    ...order.items.map(p => `${short(p.name)} — ${p.qty} × ${p.price} ₽`),
    '', `Итого: ${order.total} ₽`,
    'Обработка заказа: https://tile-shop-z99g.onrender.com/admin'
  ];
  const message = lines.join('\n');
  const payload = JSON.stringify({ chat_id: ADMIN_CHAT_ID,
    text: message.length > 4000 ? message.slice(0, 3800) + `\n… Полный состав в админке.\nИтого: ${order.total} ₽` : message });
  return new Promise(resolve => {
    let settled = false;
    let request;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(ok);
    };
    const deadline = setTimeout(() => {
      console.error('Telegram: время ожидания истекло; заказ сохранён.');
      finish(false);
      if (request) request.destroy();
    }, 10000);
    try {
      request = https.request({ hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendMessage`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { if (data.length < 65536) data += chunk; });
        response.on('error', () => finish(false));
        response.on('end', () => {
          try {
            const result = JSON.parse(data);
            const ok = response.statusCode === 200 && result.ok === true;
            if (!ok) console.error('Telegram: уведомление не отправлено; код', result.error_code || response.statusCode);
            finish(ok);
          } catch (_) { console.error('Telegram: некорректный ответ; заказ сохранён.'); finish(false); }
        });
      });
      request.on('error', () => { console.error('Telegram: ошибка соединения; заказ сохранён.'); finish(false); });
      request.end(payload);
    } catch (_) { console.error('Telegram: ошибка отправки; заказ сохранён.'); finish(false); }
  });
}
if (!ADMIN_KEY || !DATABASE_URL) {
  console.error('Задайте ADMIN_KEY и DATABASE_URL в Environment на Render.');
  process.exit(1);
}
const pool = new Pool({ connectionString: DATABASE_URL, max: 5, connectionTimeoutMillis: 15000 });
pool.on('error', err => console.error('Ошибка подключения к базе:', err.code || 'unknown'));

const demo = [
  ['Клей для плитки Ceresit CM 14 Extra 25 кг','Чистовые материалы','Профессиональный цементный клей для керамической плитки и керамогранита.',450,520,24,'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=900&q=80','Ceresit','мешок'],
  ['Алмазный диск 125 мм по керамограниту','Расходники','Алмазный диск для чистого реза керамогранита и плитки.',1200,0,18,'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=80','PRO','шт.'],
  ['СВП 1 мм — 500 шт.','Расходники','Клинья и зажимы для системы выравнивания плитки.',850,0,40,'https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?auto=format&fit=crop&w=900&q=80','TilePro','компл.'],
  ['Коронка алмазная 68 мм','Инструмент','Алмазная коронка для отверстий под розетки и коммуникации.',1450,0,12,'https://images.unsplash.com/photo-1581147036324-c17f68d2c8c9?auto=format&fit=crop&w=900&q=80','PRO','шт.'],
  ['Грунтовка глубокого проникновения 10 л','Черновые материалы','Универсальная грунтовка для подготовки оснований.',890,0,25,'https://images.unsplash.com/photo-1599696848652-f0ff23bc911f?auto=format&fit=crop&w=900&q=80','Master','канистра'],
  ['Затирка для швов 2 кг','Чистовые материалы','Влагостойкая затирка для керамической плитки.',620,700,30,'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=900&q=80','Ceresit','пачка']
];

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Prevent concurrent deployments from creating duplicate demo products.
    await client.query('SELECT pg_advisory_xact_lock(824173)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
        description TEXT DEFAULT '', price INTEGER NOT NULL CHECK (price >= 0),
        old_price INTEGER DEFAULT 0, stock INTEGER DEFAULT 0 CHECK (stock >= 0),
        image TEXT DEFAULT '', brand TEXT DEFAULT '', unit TEXT DEFAULT 'шт.',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
        address TEXT DEFAULT '', comment TEXT DEFAULT '', total INTEGER NOT NULL,
        status TEXT DEFAULT 'Новый', telegram_id TEXT DEFAULT '',
        telegram_username TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL, name TEXT NOT NULL, price INTEGER NOT NULL,
        qty INTEGER NOT NULL CHECK (qty > 0)
      );
     CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS stock_released BOOLEAN NOT NULL DEFAULT FALSE;
   ALTER TABLE products
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    `);
    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM products');
    // Only seed a brand new database; never refill a deliberately emptied catalog.
    const orders = await client.query('SELECT COUNT(*)::int AS count FROM orders');
    const sequence = await client.query('SELECT is_called FROM products_id_seq');
    if (!rows[0].count && !orders.rows[0].count && !sequence.rows[0].is_called) {
      for (const product of demo) {
        await client.query('INSERT INTO products (name,category,description,price,old_price,stock,image,brand,unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', product);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}
app.post(
  '/api/products/import',
  admin,
  express.raw({
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    limit: '2mb'
  })
);
app.use(express.json({ limit: '1mb' }));
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const cleanInt = v => Number.isSafeInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 2147483647 ? Number(v) : 0;
const text = v => typeof v === 'string' ? v.trim() : '';
function admin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: 'Неверный ключ администратора' });
  next();
}
function fail(message) { const err = new Error(message); err.status = 400; throw err; }

app.get('/api/products', route(async (req, res) => {
  const args = [];
  const isAdmin =
  (req.headers['x-admin-key'] || req.query.key) === ADMIN_KEY;

let sql = 'SELECT * FROM products WHERE ' +
  (isAdmin ? '1=1' : 'is_active=TRUE');
  const q = text(req.query.q), category = text(req.query.category);
  if (q) {
    args.push('%' + q + '%');
    sql += ` AND (name ILIKE $${args.length} OR description ILIKE $${args.length} OR brand ILIKE $${args.length})`;
  }
  if (category) { args.push(category); sql += ` AND category = $${args.length}`; }
  const { rows } = await pool.query(sql + ' ORDER BY id DESC', args);
  res.json(rows);
}));
app.get('/api/products/:id', route(async (req, res) => {
  const isAdmin =
  (req.headers['x-admin-key'] || req.query.key) === ADMIN_KEY;

const { rows } = await pool.query(
  'SELECT * FROM products WHERE id=$1 AND (is_active=TRUE OR $2::boolean)',
  [cleanInt(req.params.id), isAdmin]
);
  if (!rows.length) return res.status(404).json({ error: 'Товар не найден' });
  res.json(rows[0]);
}));
app.get('/api/categories', route(async (req, res) => {
  const { rows } = await pool.query(
  'SELECT category, COUNT(*)::int AS count FROM products WHERE is_active=TRUE GROUP BY category ORDER BY category'
);
  res.json(rows);
}));
// История заказов покупателя и проверка Telegram.
function telegramCustomer(req) {
  const raw = req.get('X-Telegram-Init-Data');

  if (
    !BOT_TOKEN ||
    typeof raw !== 'string' ||
    raw.length > 16000
  ) return null;

  try {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash') || '';

    if (!/^[a-f0-9]{64}$/i.test(hash)) return null;

    const seen = new Set();
    for (const [name] of params) {
      if (seen.has(name)) return null;
      seen.add(name);
    }

    params.delete('hash');
    params.sort();

    const check = [...params]
      .map(([name, value]) => name + '=' + value)
      .join('\n');

    const c = require('crypto');
    const secret = c.createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    const expected = c.createHmac('sha256', secret)
      .update(check)
      .digest();

    if (!c.timingSafeEqual(
      expected,
      Buffer.from(hash, 'hex')
    )) return null;

    const age = Date.now() / 1000 -
      Number(params.get('auth_date'));

    if (
      !Number.isFinite(age) ||
      age < -60 ||
      age > 86400
    ) return null;

    const user = JSON.parse(params.get('user') || 'null');

    return Number.isSafeInteger(user?.id) && user.id > 0
      ? user
      : null;
  } catch (_) {
    return null;
  }
}

app.get('/api/my-orders', route(async (req, res) => {
  res.set('Cache-Control', 'no-store');

  const user = telegramCustomer(req);

  if (!user) {
    return res.status(401).json({
      error: 'Закройте магазин и откройте его снова через кнопку в боте.'
    });
  }

  const { rows: orders } = await pool.query(
    'SELECT id,total,status,address,comment,created_at ' +
    'FROM orders WHERE telegram_id=$1 ' +
    'ORDER BY id DESC LIMIT 100',
    [String(user.id)]
  );

  if (!orders.length) return res.json([]);

  const { rows: items } = await pool.query(
    'SELECT order_id,name,price,qty FROM order_items ' +
    'WHERE order_id=ANY($1::int[]) ORDER BY id',
    [orders.map(o => o.id)]
  );

  res.json(orders.map(o => ({
    ...o,
    items: items.filter(i => i.order_id === o.id)
  })));
}));

app.post('/api/orders', (req, res, next) => {
  const user = telegramCustomer(req);

  if (req.get('X-Telegram-Init-Data') && !user) {
    return res.status(401).json({
      error: 'Закройте магазин и откройте его снова через кнопку в боте.'
    });
  }

  req.body = req.body || {};
  req.body.telegramId = user ? user.id : '';
  req.body.telegramUsername = user ? user.username || '' : '';

  next();
});
app.post('/api/orders', route(async (req, res) => {
  const body = req.body || {};
  const customerName = text(body.customerName), phone = text(body.phone);
  if (!customerName || !phone) fail('Укажите имя и телефон');
  if (!Array.isArray(body.items) || !body.items.length) fail('Корзина пуста');
  if (body.items.length > 100) fail('Слишком много товаров в корзине');
  const quantities = new Map();
  for (const item of body.items) {
    const id = cleanInt(item && item.id), qty = cleanInt(item && item.qty);
    if (!id || !qty || qty > 99) fail('Недопустимое количество товара');
    const sum = (quantities.get(id) || 0) + qty;
    if (sum > 99) fail('Максимум 99 единиц одного товара');
    quantities.set(id, sum);
  }
  const client = await pool.connect();
  let savedOrder;
  try {
    await client.query('BEGIN');
    // Lock products in the same order so simultaneous orders cannot oversell stock.
    const ids = [...quantities.keys()].sort((a, b) => a - b);
    const { rows: products } = await client.query(
  'SELECT id,name,price,stock,is_active FROM products WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
  [ids]
);
    if (products.length !== ids.length) fail('Один из товаров не найден');
    let total = 0;
    for (const p of products) {
      if (!p.is_active) fail('Товар снят с продажи: ' + p.name);
      const qty = quantities.get(p.id);
      if (p.stock < qty) fail(`Недостаточно товара: ${p.name}`);
      total += p.price * qty;
    }
    if (!Number.isSafeInteger(total) || total > 2147483647) fail('Сумма заказа слишком велика');
    const { rows } = await client.query('INSERT INTO orders (customer_name,phone,address,comment,total,telegram_id,telegram_username) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [customerName, phone, text(body.address), text(body.comment), total, String(body.telegramId || ''), text(body.telegramUsername)]);
    const orderId = rows[0].id;
    for (const p of products) {
      const qty = quantities.get(p.id);
      await client.query('INSERT INTO order_items (order_id,product_id,name,price,qty) VALUES ($1,$2,$3,$4,$5)', [orderId, p.id, p.name, p.price, qty]);
      await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2', [qty, p.id]);
    }
    await client.query('COMMIT');
    savedOrder = { id: orderId, total, name: customerName, phone,
      address: text(body.address), comment: text(body.comment),
      items: products.map(p => ({ ...p, qty: quantities.get(p.id) })) };
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
  const notificationSent = await sendOrderNotification(savedOrder);
  res.json({ ok: true, orderId: savedOrder.id, total: savedOrder.total,
    message: 'Заказ создан', notificationSent });
}));

app.get('/api/orders', admin, route(async (req, res) => {
  const { rows: orders } = await pool.query('SELECT * FROM orders ORDER BY id DESC');
  const { rows: items } = await pool.query('SELECT * FROM order_items ORDER BY id');
  const byOrder = new Map();
  for (const item of items) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
    byOrder.get(item.order_id).push(item);
  }
  res.json(orders.map(o => ({ ...o, items: byOrder.get(o.id) || [] })));
}));
app.patch('/api/orders/:id/status', admin, route(async (req, res) => {
  const statuses = [
    'Новый', 'Принят', 'В работе',
    'Готов', 'Выполнен', 'Отменён'
  ];
  const status = (req.body || {}).status;
  if (!statuses.includes(status)) fail('Недопустимый статус');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: orders } = await client.query(
      'SELECT id,status,stock_released,telegram_id FROM orders WHERE id=$1 FOR UPDATE',
      [cleanInt(req.params.id)]
    );

    if (!orders.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Заказ не найден' });
    }

    const order = orders[0];
    const releaseStock = status === 'Отменён';

    if (releaseStock !== order.stock_released) {
      const { rows: items } = await client.query(
        'SELECT product_id,SUM(qty)::bigint AS qty FROM order_items ' +
        'WHERE order_id=$1 GROUP BY product_id ORDER BY product_id',
        [order.id]
      );

      const ids = items.map(i => i.product_id);
      const { rows: products } = await client.query(
        'SELECT id,name,stock FROM products ' +
        'WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE',
        [ids]
      );
      const byId = new Map(products.map(p => [p.id, p]));

      for (const item of items) {
        const product = byId.get(item.product_id);
        const qty = Number(item.qty);

        if (!Number.isSafeInteger(qty) || qty <= 0) {
          fail('Некорректное количество товара в заказе');
        }

        if (!product) {
          if (!releaseStock) {
            fail('Нельзя вернуть заказ в работу: один из товаров удалён');
          }
          continue;
        }

        if (releaseStock) {
          if (product.stock + qty > 2147483647) {
            fail('Слишком большой остаток: ' + product.name);
          }
        } else if (product.stock < qty) {
          fail('Недостаточно товара: ' + product.name);
        }
      }

      for (const item of items) {
        if (!byId.has(item.product_id)) continue;
        const qty = Number(item.qty);
        await client.query(
          'UPDATE products SET stock=stock+$1 WHERE id=$2',
          [releaseStock ? qty : -qty, item.product_id]
        );
      }
    }

    await client.query(
      'UPDATE orders SET status=$1,stock_released=$2 WHERE id=$3',
      [status, releaseStock, order.id]
    );
await client.query('COMMIT');

if (
  order.status !== status &&
  /^[1-9]\d*$/.test(String(order.telegram_id || ''))
) {
  telegramApi('sendMessage', {
    chat_id: order.telegram_id,
    text: '📦 Заказ №' + order.id +
      '\nНовый статус: ' + status
  }).catch(() => {
    console.error(
      'Telegram: уведомление о статусе не отправлено; статус сохранён.'
    );
  });
}

res.json({ ok: true });
    
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));
app.patch('/api/products/:id/visibility', admin, route(async (req, res) => {
  const isActive = (req.body || {}).isActive;
  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: 'Некорректное значение' });
  }

  const result = await pool.query(
    'UPDATE products SET is_active=$1 WHERE id=$2',
    [isActive, cleanInt(req.params.id)]
  );

  if (!result.rowCount) {
    return res.status(404).json({ error: 'Товар не найден' });
  }
  res.json({ ok: true });
}));
app.post('/api/products/import', admin, route(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    fail('Выберите файл Excel .xlsx');
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.body);
  } catch {
    fail('Не удалось прочитать файл .xlsx');
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) fail('В файле нет листа');
  if (sheet.rowCount > 501) fail('Максимум 500 строк товаров');

  const headers = new Map();
  sheet.getRow(1).eachCell((cell, column) => {
    const title = cell.text.trim().toLowerCase();
    if (headers.has(title)) fail('Повтор колонки: ' + title);
    headers.set(title, column);
  });

  const titles = ['название', 'категория', 'цена', 'остаток'];
  for (const title of titles) {
    if (!headers.has(title)) fail('Нет колонки: ' + title);
  }

  const rows = [];
  for (let number = 2; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    const values = titles.map(title =>
      row.getCell(headers.get(title)).value
    );
    if (values.every(v => v == null || String(v).trim() === '')) {
      continue;
    }

    if (values.some(v =>
      v != null && typeof v !== 'string' && typeof v !== 'number'
    )) {
      fail('Строка ' + number + ': используйте значения без формул');
    }

    const [name, category, rawPrice, rawStock] =
      values.map(v => String(v == null ? '' : v).trim());

    if (!name || !category || name.length > 250 || category.length > 100) {
      fail('Строка ' + number + ': проверьте название и категорию');
    }

    const validNumber = v =>
      /^\d+$/.test(v) && Number(v) <= 2147483647;

    if (!validNumber(rawPrice) || !validNumber(rawStock)) {
      fail('Строка ' + number + ': цена и остаток должны быть целыми числами от 0');
    }

    rows.push([name, category, Number(rawPrice), Number(rawStock)]);
  }

  if (!rows.length) fail('В таблице нет товаров');

  const client = await pool.connect();
  let added = 0;
  let skipped = 0;
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE');

    for (const values of rows) {
      const existing = await client.query(
        'SELECT id FROM products WHERE LOWER(name)=LOWER($1) AND LOWER(category)=LOWER($2)',
        values.slice(0, 2)
      );

      if (existing.rowCount) {
        skipped++;
        continue;
      }

      await client.query(
        'INSERT INTO products (name,category,price,stock) VALUES ($1,$2,$3,$4)',
        values
      );
      added++;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ ok: true, added, skipped });
}));
function productValues(p) {
  if (!text(p.name) || !text(p.category)) fail('Название и категория обязательны');
  return [text(p.name), text(p.category), text(p.description), cleanInt(p.price), cleanInt(p.old_price), cleanInt(p.stock), text(p.image), text(p.brand), text(p.unit) || 'шт.'];
}
app.post('/api/products', admin, route(async (req, res) => {
  const { rows } = await pool.query('INSERT INTO products (name,category,description,price,old_price,stock,image,brand,unit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', productValues(req.body || {}));
  res.json({ ok: true, id: rows[0].id });
}));
app.patch('/api/products/:id', admin, route(async (req, res) => {
  const values = [...productValues(req.body || {}), cleanInt(req.params.id)];
  const result = await pool.query('UPDATE products SET name=$1,category=$2,description=$3,price=$4,old_price=$5,stock=$6,image=$7,brand=$8,unit=$9 WHERE id=$10', values);
  if (!result.rowCount) return res.status(404).json({ error: 'Товар не найден' });
  res.json({ ok: true });
}));
// Delete catalog rows only; order_items keeps historical names, prices and quantities.
app.delete('/api/products', admin, route(async (req, res) => {
  const { confirmation, expectedCount } = req.body || {};
  if (confirmation !== 'УДАЛИТЬ') fail('Для удаления всех товаров введите УДАЛИТЬ');
  if (!Number.isInteger(expectedCount) || expectedCount < 0) fail('Обновите список товаров');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE products IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM products');
    if (rows[0].count !== expectedCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Количество товаров изменилось. Обновите список и повторите удаление.' });
    }
    const result = await client.query('DELETE FROM products');
    // Do not reset the sequence: old order product IDs must never be reused.
    await client.query('COMMIT');
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}));
app.delete('/api/products/:id', admin, route(async (req, res) => {
  const result = await pool.query('DELETE FROM products WHERE id=$1', [cleanInt(req.params.id)]);
  if (!result.rowCount) return res.status(404).json({ error: 'Товар не найден' });
  res.json({ ok: true });
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'API не найден' }));

// Serve only browser files, never server.js, shop.db or configuration files.
for (const file of ['index.html','app.js','style.css','admin.html']) {
  app.get('/' + file, (req, res) => res.sendFile(path.join(__dirname, file)));
}
for (const directory of ['assets','images']) {
  app.use('/' + directory, express.static(path.join(__dirname, directory), { dotfiles: 'deny' }));
}
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('*', (req, res) => {
  if (req.path.includes('.') || req.path.startsWith('/assets/') || req.path.startsWith('/images/')) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status === 400) return res.status(400).json({ error: err.type === 'entity.parse.failed' ? 'Некорректный JSON' : err.message });
  if (err.status === 413) return res.status(413).json({ error: 'Запрос слишком большой' });
  console.error('Ошибка запроса:', err.code || 'unknown');
  res.status(500).json({ error: 'Не удалось выполнить запрос' });
});

// Telegram: команды, кнопки и подключение webhook.
const crypto = require('crypto');
const SHOP_URL = 'https://tile-shop-z99g.onrender.com';
const WEBHOOK_SECRET = crypto.createHash('sha256')
  .update('tile-shop-webhook:' + BOT_TOKEN).digest('hex');

function telegramApi(method, body) {
  if (!BOT_TOKEN) return Promise.reject(new Error('BOT_TOKEN не задан'));
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let request;
    const timer = setTimeout(() => {
      if (request) request.destroy();
      reject(new Error('Telegram: время ожидания истекло'));
    }, 12000);

    const finish = (err, result) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result);
    };

    request = https.request({
      hostname: 'api.telegram.org',
      path: '/bot' + BOT_TOKEN + '/' + method,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, response => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        if (data.length < 100000) data += chunk;
      });
      response.on('error', () =>
        finish(new Error('Telegram: ошибка ответа'))
      );
      response.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (!result.ok) {
            return finish(new Error(
              'Telegram: код ' + result.error_code
            ));
          }
          finish(null, result.result);
        } catch (_) {
          finish(new Error('Telegram: некорректный ответ'));
        }
      });
    });

    request.on('error', () =>
      finish(new Error('Telegram: ошибка соединения'))
    );
    request.end(payload);
  });
}

const botKeyboard = {
  resize_keyboard: true,
  keyboard: [
    [{ text: '🛍 Магазин' }],
    [{ text: '📦 Мои заказы' }, { text: '🛒 Корзина' }],
    [{ text: '🔥 Акции' }, { text: '☎️ Связаться с менеджером' }]
  ]
};

const openShopButton = {
  inline_keyboard: [[{
    text: '🛍 Открыть магазин',
    web_app: { url: SHOP_URL }
  }]]
};

function botReply(chatId, message, markup = botKeyboard) {
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text: message.slice(0, 3900),
    reply_markup: markup
  });
}

async function handleBotMessage(message) {
  if (
    !message ||
    message.chat?.type !== 'private' ||
    !message.from?.id
  ) return;

  const chatId = message.chat.id;
  const value = String(message.text || '').trim();
  const command = value.split(/\s/)[0]
    .split('@')[0].toLowerCase();

  if (command === '/start' || command === '/help') {
    return botReply(chatId,
      'Добро пожаловать в «Всё для плиточника»! 🧱\n\n' +
      'Материалы, расходники и инструмент в одном месте.\n' +
      'Нажмите «🛍 Магазин», чтобы открыть каталог.'
    );
  }

  if (command === '/shop' || /магазин/i.test(value)) {
    return botReply(
      chatId,
      'Откройте магазин по кнопке ниже.',
      openShopButton
    );
  }

  if (command === '/cart' || /корзина/i.test(value)) {
    return botReply(
      chatId,
      'Откройте магазин и нажмите «Корзина» в нижнем меню.',
      openShopButton
    );
  }

  if (command === '/orders' || /мои заказы/i.test(value)) {
    const { rows } = await pool.query(
      'SELECT id,total,status FROM orders ' +
      'WHERE telegram_id=$1 ORDER BY id DESC LIMIT 10',
      [String(message.from.id)]
    );

    const answer = rows.length
      ? 'Ваши последние заказы:\n\n' + rows.map(o =>
          '№' + o.id + ' · ' + o.total + ' ₽ · ' + o.status
        ).join('\n')
      : 'Заказов, привязанных к вашему Telegram, пока нет.\n' +
        'Заказы, оформленные в обычном браузере, ' +
        'могут отображаться только в магазине.';

    return botReply(chatId, answer);
  }

  if (command === '/sales' || /акции/i.test(value)) {
    const { rows } = await pool.query(
      'SELECT name,price,old_price FROM products ' +
     'WHERE old_price>price AND stock>0 AND is_active=TRUE ' +
      'ORDER BY id DESC LIMIT 8'
    );

    return botReply(chatId, rows.length
      ? '🔥 Товары со скидкой:\n\n' + rows.map(p =>
          String(p.name).slice(0, 250) + '\n' +
          p.price + ' ₽ вместо ' + p.old_price + ' ₽'
        ).join('\n\n') +
        '\n\nОткройте магазин для оформления заказа.'
      : 'Сейчас товаров со скидкой в наличии нет.',
      openShopButton
    );
  }

  if (command === '/contact' || /менеджер/i.test(value)) {
    if (!/^\d+$/.test(ADMIN_CHAT_ID)) {
      return botReply(
        chatId,
        'Контакт менеджера пока не настроен.'
      );
    }

    return botReply(
      chatId,
      'Нажмите кнопку, чтобы открыть профиль менеджера.',
      {
        inline_keyboard: [[{
          text: '☎️ Менеджер',
          url: 'tg://user?id=' + ADMIN_CHAT_ID
        }]]
      }
    );
  }

  return botReply(chatId, 'Выберите действие в меню ниже.');
}

const handledUpdates = new Map();

app.post('/telegram/webhook', async (req, res) => {
  if (
    !BOT_TOKEN ||
    req.get('X-Telegram-Bot-Api-Secret-Token') !== WEBHOOK_SECRET
  ) {
    return res.sendStatus(403);
  }

  const update = req.body || {};
  if (!Number.isSafeInteger(update.update_id)) {
    return res.sendStatus(400);
  }

  try {
    let work = handledUpdates.get(update.update_id);
    if (!work) {
      work = handleBotMessage(update.message);
      handledUpdates.set(update.update_id, work);
    }
    await work;

    while (handledUpdates.size > 1000) {
      handledUpdates.delete(
        handledUpdates.keys().next().value
      );
    }

    res.sendStatus(200);
  } catch (_) {
    handledUpdates.delete(update.update_id);
    console.error('Telegram: не удалось обработать команду');
    res.sendStatus(503);
  }
});

async function connectBot(attempt = 0) {
  if (!BOT_TOKEN) {
    return console.error('Telegram: задайте BOT_TOKEN');
  }

  try {
    await telegramApi('setWebhook', {
      url: SHOP_URL + '/telegram/webhook',
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ['message'],
      max_connections: 2
    });

    console.log('Telegram: webhook подключён');

    await telegramApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Магазин',
        web_app: { url: SHOP_URL }
      }
    });
  } catch (_) {
    console.error(
      'Telegram: ошибка настройки, попытка ' + (attempt + 1)
    );
    if (attempt < 4) {
      setTimeout(() => connectBot(attempt + 1), 15000);
    }
  }
}

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(
      `Tile shop running on ${PORT}; database: PostgreSQL`
    );
    connectBot();
  });
}).catch(err => {
  console.error(
    'Не удалось запустить базу. Проверьте DATABASE_URL:',
    err.code || 'unknown'
  );
  pool.end().finally(() => process.exit(1));
});
