const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-123';
const db = new Database(path.join(__dirname, 'shop.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT DEFAULT '',
 price INTEGER NOT NULL,
 old_price INTEGER DEFAULT 0,
 stock INTEGER DEFAULT 0,
 image TEXT DEFAULT '',
 brand TEXT DEFAULT '',
 unit TEXT DEFAULT 'шт.',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 address TEXT DEFAULT '',
 comment TEXT DEFAULT '',
 total INTEGER NOT NULL,
 status TEXT DEFAULT 'Новый',
 telegram_id TEXT DEFAULT '',
 telegram_username TEXT DEFAULT '',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 product_id INTEGER NOT NULL,
 name TEXT NOT NULL,
 price INTEGER NOT NULL,
 qty INTEGER NOT NULL
);
`);

const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
if (!count) {
  const add = db.prepare('INSERT INTO products (name,category,description,price,old_price,stock,image,brand,unit) VALUES (?,?,?,?,?,?,?,?,?)');
  const demo = [
    ['Клей для плитки Ceresit CM 14 Extra 25 кг','Чистовые материалы','Профессиональный цементный клей для керамической плитки и керамогранита.','450',520,24,'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=900&q=80','Ceresit','мешок'],
    ['Алмазный диск 125 мм по керамограниту','Расходники','Алмазный диск для чистого реза керамогранита и плитки.','1200',0,18,'https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=900&q=80','PRO','шт.'],
    ['СВП 1 мм — 500 шт.','Расходники','Клинья и зажимы для системы выравнивания плитки.','850',0,40,'https://images.unsplash.com/photo-1586864387967-d02ef85d93e8?auto=format&fit=crop&w=900&q=80','TilePro','компл.'],
    ['Коронка алмазная 68 мм','Инструмент','Алмазная коронка для отверстий под розетки и коммуникации.','1450',0,12,'https://images.unsplash.com/photo-1581147036324-c17f68d2c8c9?auto=format&fit=crop&w=900&q=80','PRO','шт.'],
    ['Грунтовка глубокого проникновения 10 л','Черновые материалы','Универсальная грунтовка для подготовки оснований.','890',0,25,'https://images.unsplash.com/photo-1599696848652-f0ff23bc911f?auto=format&fit=crop&w=900&q=80','Master','канистра'],
    ['Затирка для швов 2 кг','Чистовые материалы','Влагостойкая затирка для керамической плитки.','620',700,30,'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=900&q=80','Ceresit','пачка']
  ];
  const tx = db.transaction(() => demo.forEach(p => add.run(...p)));
  tx();
}

app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname));

function cleanInt(v){ const n=Number(v); return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0; }
function admin(req,res,next){
  const key = req.headers['x-admin-key'] || req.query.key;
  if(key !== ADMIN_KEY) return res.status(401).json({error:'Неверный ключ администратора'});
  next();
}

app.get('/api/products',(req,res)=>{
  const q = String(req.query.q||'').trim();
  const category = String(req.query.category||'').trim();
  let sql='SELECT * FROM products WHERE 1=1', args=[];
  if(q){ sql += ' AND (name LIKE ? OR description LIKE ? OR brand LIKE ?)'; const s='%'+q+'%'; args.push(s,s,s); }
  if(category){ sql += ' AND category = ?'; args.push(category); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...args));
});
app.get('/api/products/:id',(req,res)=>{
  const p=db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if(!p) return res.status(404).json({error:'Товар не найден'});
  res.json(p);
});
app.get('/api/categories',(req,res)=>res.json(db.prepare('SELECT category, COUNT(*) count FROM products GROUP BY category ORDER BY category').all()));

app.post('/api/orders',(req,res)=>{
  try{
    const {customerName,phone,address,comment,items,telegramId,telegramUsername}=req.body||{};
    if(!customerName || !phone) return res.status(400).json({error:'Укажите имя и телефон'});
    if(!Array.isArray(items) || !items.length) return res.status(400).json({error:'Корзина пуста'});
    const normalized=[]; let total=0;
    for(const item of items){
      const id=cleanInt(item.id), qty=Math.min(99,Math.max(1,cleanInt(item.qty)));
      const p=db.prepare('SELECT id,name,price,stock FROM products WHERE id=?').get(id);
      if(!p) return res.status(400).json({error:'Один из товаров не найден'});
      if(p.stock < qty) return res.status(400).json({error:`Недостаточно товара: ${p.name}`});
      total += p.price*qty; normalized.push({p,qty});
    }
    const tx=db.transaction(()=>{
      const order=db.prepare('INSERT INTO orders (customer_name,phone,address,comment,total,telegram_id,telegram_username) VALUES (?,?,?,?,?,?,?)').run(customerName,phone,address||'',comment||'',total,String(telegramId||''),String(telegramUsername||''));
      const addItem=db.prepare('INSERT INTO order_items (order_id,product_id,name,price,qty) VALUES (?,?,?,?,?)');
      const dec=db.prepare('UPDATE products SET stock=stock-? WHERE id=?');
      normalized.forEach(({p,qty})=>{addItem.run(order.lastInsertRowid,p.id,p.name,p.price,qty);dec.run(qty,p.id);});
      return Number(order.lastInsertRowid);
    });
    const orderId=tx();
    res.json({ok:true,orderId,total,message:'Заказ создан'});
  }catch(e){ console.error(e); res.status(500).json({error:'Не удалось создать заказ'}); }
});

app.get('/api/orders',admin,(req,res)=>{
  const orders=db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const items=db.prepare('SELECT * FROM order_items WHERE order_id=?');
  res.json(orders.map(o=>({...o,items:items.all(o.id)})));
});
app.patch('/api/orders/:id/status',admin,(req,res)=>{
  const statuses=['Новый','Принят','В работе','Готов','Выполнен','Отменён'];
  if(!statuses.includes(req.body.status)) return res.status(400).json({error:'Недопустимый статус'});
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,req.params.id);
  res.json({ok:true});
});
app.post('/api/products',admin,(req,res)=>{
  const p=req.body||{};
  if(!p.name || !p.category) return res.status(400).json({error:'Название и категория обязательны'});
  const r=db.prepare('INSERT INTO products (name,category,description,price,old_price,stock,image,brand,unit) VALUES (?,?,?,?,?,?,?,?,?)').run(p.name,p.category,p.description||'',cleanInt(p.price),cleanInt(p.old_price),cleanInt(p.stock),p.image||'',p.brand||'',p.unit||'шт.');
  res.json({ok:true,id:Number(r.lastInsertRowid)});
});
app.patch('/api/products/:id',admin,(req,res)=>{
  const p=req.body||{};
  db.prepare('UPDATE products SET name=?,category=?,description=?,price=?,old_price=?,stock=?,image=?,brand=?,unit=? WHERE id=?').run(p.name,p.category,p.description||'',cleanInt(p.price),cleanInt(p.old_price),cleanInt(p.stock),p.image||'',p.brand||'',p.unit||'шт.',req.params.id);
  res.json({ok:true});
});
app.delete('/api/products/:id',admin,(req,res)=>{db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);res.json({ok:true});});

app.get('/admin',(req,res)=>res.sendFile(path.join(__dirname,'admin.html')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

app.listen(PORT,()=>console.log(`Tile shop running on ${PORT}`));
