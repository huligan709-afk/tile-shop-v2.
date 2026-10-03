const tg=window.Telegram?.WebApp; if(tg){tg.ready();tg.expand();}
const state={page:'home',products:[],cart:JSON.parse(localStorage.getItem('tile_cart')||'{}'),selected:null,search:''};
const app=document.getElementById('app');
const cats=[['🧱','Черновые материалы'],['🎨','Чистовые материалы'],['💿','Расходники'],['🛠️','Инструмент']];
const money=n=>new Intl.NumberFormat('ru-RU').format(n)+' ₽';
function save(){localStorage.setItem('tile_cart',JSON.stringify(state.cart));}
function cartCount(){return Object.values(state.cart).reduce((a,b)=>a+b,0)}
function cartItems(){return Object.entries(state.cart).map(([id,qty])=>{const p=state.products.find(x=>x.id==id);return p?{p,qty}:null}).filter(Boolean)}
async function api(url,opt){const r=await fetch(url,opt);const d=await r.json();if(!r.ok)throw Error(d.error||'Ошибка');return d}
async function load(){state.products=await api('/api/products');render();}
function header(){return `<header class="top"><div class="brand"><span>🧱</span>Всё для плиточника</div><div class="sub">Материалы · расходники · инструмент</div></header>`}
function nav(){const items=[['⌂','Главная','home'],['⌕','Каталог','catalog'],['🛒','Корзина','cart'],['▣','Заказы','orders'],['♙','Профиль','profile']];return `<nav class="nav">${items.map(([i,t,p])=>`<button class="${state.page===p?'active':''}" onclick="go('${p}')"><b>${i}${p==='cart'&&cartCount()?`<sup>${cartCount()}</sup>`:''}</b>${t}</button>`).join('')}</nav>`}
function home(){return `<main class="wrap"><section class="hero"><h1>Всё для плиточника</h1><p>Материалы, расходники и инструмент в одном месте</p></section><input class="search" placeholder="🔎 Поиск по товарам, категориям, брендам…" value="${state.search}" oninput="search(this.value)"><div class="cats">${cats.map(([i,t])=>`<button class="cat" onclick="go('catalog','${t}')"><div class="ico">${i}</div><h3>${t}</h3><small>Перейти в каталог →</small></button>`).join('')}</div><section class="section"><div class="section-head"><h2>Популярное</h2><button class="back" onclick="go('catalog')">Все товары →</button></div><div class="products">${state.products.slice(0,4).map(card).join('')}</div></section></main>`}
function card(p){return `<article class="product"><div class="pimg">${p.image?`<img src="${p.image}" alt="">`:'🧱'}</div><div class="pbody"><div class="pname">${p.name}</div><div class="price">${money(p.price)} ${p.old_price?`<span class="old">${money(p.old_price)}</span>`:''}</div><button class="add" onclick="openProduct(${p.id})">Подробнее</button></div></article>`}
function catalog(){const list=state.products.filter(p=>!state.search||`${p.name} ${p.brand} ${p.category}`.toLowerCase().includes(state.search.toLowerCase()));return `<main class="wrap"><h1 class="page-title">Каталог</h1><input class="search" placeholder="🔎 Поиск…" value="${state.search}" oninput="search(this.value)"><div class="products">${list.map(card).join('')}</div></main>`}
function detail(){const p=state.selected;return `<main class="wrap"><button class="back" onclick="go('catalog')">‹ Каталог</button><div class="detail"><div class="detail-img">${p.image?`<img src="${p.image}">`:'🧱'}</div><div class="detail-body"><h1>${p.name}</h1><p class="desc">${p.description}</p><div class="price">${money(p.price)} ${p.old_price?`<span class="old">${money(p.old_price)}</span>`:''}</div><p class="desc">В наличии: ${p.stock} ${p.unit}</p><div class="buyrow"><div class="qty"><button onclick="changeQty(-1)">−</button><span id="q">1</span><button onclick="changeQty(1)">+</button></div><button class="buy" onclick="addToCart(${p.id})">🛒 В корзину</button></div></div></div></main>`}
let detailQty=1;function changeQty(d){detailQty=Math.max(1,detailQty+d);document.getElementById('q').textContent=detailQty}
function cart(){const items=cartItems();const total=items.reduce((s,x)=>s+x.p.price*x.qty,0);return `<main class="wrap"><h1 class="page-title">Корзина</h1>${items.length?items.map(x=>`<div class="cartrow"><img src="${x.p.image}"><div class="cartinfo"><b>${x.p.name}</b><div>${money(x.p.price)} × ${x.qty}</div></div><div><button onclick="cartMinus(${x.p.id})">−</button> ${x.qty} <button onclick="cartPlus(${x.p.id})">+</button></div></div>`).join('')+`<div class="form"><h2>Итого: ${money(total)}</h2><button class="submit" onclick="go('checkout')">Перейти к оформлению</button></div>`:`<div class="empty">🛒<br><br>Корзина пока пуста<br><button class="back" onclick="go('catalog')">Перейти в каталог</button></div>`}</main>`}
function checkout(){const total=cartItems().reduce((s,x)=>s+x.p.price*x.qty,0);return `<main class="wrap"><button class="back" onclick="go('cart')">‹ Корзина</button><h1 class="page-title">Оформление заказа</h1><div class="notice">Оплата пока не подключена. После оформления менеджер свяжется с вами для подтверждения и оплаты.</div><form class="form" onsubmit="submitOrder(event)"><label>Имя</label><input id="name" required placeholder="Ваше имя"><label>Телефон</label><input id="phone" required placeholder="+7 900 000-00-00" inputmode="tel"><label>Адрес доставки</label><input id="address" placeholder="Город, улица, дом"><label>Комментарий</label><textarea id="comment" rows="3" placeholder="Дополнительные пожелания"></textarea><button class="submit">📦 Подтвердить заказ · ${money(total)}</button></form></main>`}
function orders(){return `<main class="wrap orders"><h1 class="page-title">Заказы</h1><div class="empty">История заказов будет отображаться здесь после оформления.</div></main>`}
function profile(){return `<main class="wrap"><h1 class="page-title">Профиль</h1><div class="form"><b>Telegram</b><p class="desc">${tg?.initDataUnsafe?.user?.first_name||'Гость'}</p><p class="desc">Магазин работает и при обычном открытии ссылки — подтверждение заказа больше не требует запуска только из Telegram.</p></div></main>`}
function render(){app.innerHTML=header()+(state.page==='home'?home():state.page==='catalog'?catalog():state.page==='detail'?detail():state.page==='cart'?cart():state.page==='checkout'?checkout():state.page==='orders'?orders():profile())+nav()}
window.go=(p,cat)=>{state.page=p;if(cat){state.search=cat}if(p!=='detail')detailQty=1;render()};window.search=v=>{state.search=v;state.page='catalog';render()};window.openProduct=id=>{state.selected=state.products.find(p=>p.id===id);state.page='detail';detailQty=1;render()};window.addToCart=id=>{state.cart[id]=(state.cart[id]||0)+detailQty;save();toast('Товар добавлен в корзину');render()};window.cartPlus=id=>{state.cart[id]=(state.cart[id]||0)+1;save();render()};window.cartMinus=id=>{state.cart[id]=Math.max(0,(state.cart[id]||0)-1);if(!state.cart[id])delete state.cart[id];save();render()};window.submitOrder=async e=>{e.preventDefault();const items=cartItems().map(x=>({id:x.p.id,qty:x.qty}));try{const u=tg?.initDataUnsafe?.user;const d=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerName:document.getElementById('name').value,phone:document.getElementById('phone').value,address:document.getElementById('address').value,comment:document.getElementById('comment').value,items,telegramId:u?.id||'',telegramUsername:u?.username||''})});state.cart={};save();state.page='orders';render();toast(`Заказ №${d.orderId} принят. Менеджер свяжется с вами.`)}catch(err){toast(err.message)}};
function toast(t){const x=document.createElement('div');x.className='toast';x.textContent=t;document.body.appendChild(x);setTimeout(()=>x.remove(),2800)}
load();
// История заказов в магазине.
const orderEsc = v => String(v ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

state.myOrders = [];
state.ordersLoading = false;
state.ordersError = '';

let orderRequest = 0;
let orderSubmitting = false;

orders = function () {
  return `<main class="wrap orders">
    <h1 class="page-title">Заказы</h1>

    <button class="back" onclick="loadMyOrders()"
      ${state.ordersLoading ? 'disabled' : ''}>
      Обновить историю
    </button>

    ${state.ordersLoading
      ? '<p class="notice">Загрузка заказов…</p>'
      : ''}

    ${state.ordersError
      ? `<p class="notice">${orderEsc(state.ordersError)}</p>`
      : ''}

    ${state.myOrders.map(o => `
      <article class="order">
        <h2>Заказ №${orderEsc(o.id)} · ${money(o.total)}</h2>
        <span class="status">${orderEsc(o.status)}</span>

        <p class="desc">${
          orderEsc(new Date(o.created_at).toLocaleString('ru-RU'))
        }</p>

        ${(o.items || []).map(i => `
          <p>${orderEsc(i.name)} —
            ${orderEsc(i.qty)} × ${money(i.price)}</p>
        `).join('')}

        ${o.address
          ? `<p>Доставка: ${orderEsc(o.address)}</p>`
          : ''}

        ${o.comment
          ? `<p>Комментарий: ${orderEsc(o.comment)}</p>`
          : ''}
      </article>
    `).join('')}

    ${!state.myOrders.length &&
      !state.ordersLoading &&
      !state.ordersError
      ? '<div class="empty">У вас пока нет заказов.</div>'
      : ''}
  </main>`;
};

window.loadMyOrders = async () => {
  const request = ++orderRequest;
  state.ordersError = '';

  if (!tg?.initData) {
    state.myOrders = [];
    state.ordersLoading = false;
    state.ordersError =
      'Чтобы увидеть историю, откройте магазин через кнопку «Магазин» в Telegram-боте.';

    if (state.page === 'orders') render();
    return;
  }

  state.ordersLoading = true;
  if (state.page === 'orders') render();

  try {
    const rows = await api('/api/my-orders', {
      headers: {
        'X-Telegram-Init-Data': tg.initData
      },
      cache: 'no-store'
    });

    if (!Array.isArray(rows)) {
      throw Error('Не удалось загрузить историю заказов.');
    }

    if (request === orderRequest) {
      state.myOrders = rows;
    }
  } catch (e) {
    if (request === orderRequest) {
      state.ordersError = e.message;
    }
  } finally {
    if (request === orderRequest) {
      state.ordersLoading = false;
      if (state.page === 'orders') render();
    }
  }
};

const goBeforeOrders = window.go;

window.go = (page, category) => {
  goBeforeOrders(page, category);
  if (page === 'orders') window.loadMyOrders();
};

window.submitOrder = async e => {
  e.preventDefault();
  if (orderSubmitting) return;

  const form = e.target;
  const button = form.querySelector('button.submit');
  const items = cartItems().map(x => ({
    id: x.p.id,
    qty: x.qty
  }));

  if (!items.length) {
    toast('Корзина пуста');
    return;
  }

  const body = {
    customerName: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    address: document.getElementById('address').value,
    comment: document.getElementById('comment').value,
    items
  };

  orderSubmitting = true;
  if (button) button.disabled = true;

  let result;

  try {
    result = await api('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tg?.initData
          ? { 'X-Telegram-Init-Data': tg.initData }
          : {})
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    toast(err.message);
    return;
  } finally {
    orderSubmitting = false;
    if (button) button.disabled = false;
  }

  state.cart = {};
  try { save(); } catch (_) {}

  for (const item of items) {
    const p = state.products.find(p => p.id === item.id);
    if (p) p.stock = Math.max(0, p.stock - item.qty);
  }

  state.myOrders = [{
    id: result.orderId,
    total: result.total,
    status: 'Новый',
    created_at: new Date().toISOString(),
    address: body.address,
    comment: body.comment,
    items: items.map(i => {
      const p = state.products.find(p => p.id === i.id);
      return {
        name: p?.name || '',
        price: p?.price || 0,
        qty: i.qty
      };
    })
  }, ...state.myOrders];

  state.page = 'orders';
  state.ordersError = '';
  render();

  toast(
    `Заказ №${result.orderId} принят. Менеджер свяжется с вами.`
  );

  if (tg?.initData) window.loadMyOrders();
};
