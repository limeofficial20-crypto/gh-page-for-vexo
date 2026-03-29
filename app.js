/* ============================================================================
   app.js — VEXO Mini App
   Связь с бэкендом: все запросы идут на FastAPI (api.py)
   initData передаётся в каждом запросе в заголовке Authorization
============================================================================ */

const tg = window.Telegram.WebApp;

// ── Конфиг ─────────────────────────────────────────────────────────────────
const API_BASE = "https://app.whitesurf.ru"; // ← тот же домен что и WEB_APP_URL в bot.py

// ── Глобальное состояние ────────────────────────────────────────────────────
const State = {
  role: null,           // "client" | "staff"
  profile: null,        // данные профиля клиента
  reviewRating: 0,      // выбранная оценка при написании отзыва
  reviewsPage: 1,       // текущая страница отзывов
  clientsPage: 1,       // текущая страница клиентов (CRM)
  prevScreen: null,     // для кнопки «назад»
  activeTab: "profile", // активный таб клиента
  activeCrmTab: "crm-main", // активный таб сотрудника
};

// ── Инициализация Telegram Web App ─────────────────────────────────────────
tg.ready();
tg.expand();
tg.enableClosingConfirmation();

// ============================================================================
// УТИЛИТЫ
// ============================================================================

/** Выполнить запрос к API с автоматической передачей initData */
async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    // Передаём initData в каждом запросе — бэкенд валидирует подпись
    "Authorization": `tma ${tg.initData}`,
    ...(options.headers || {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Ошибка сети" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

/** Показать экран по id, запомнить предыдущий для goBack() */
function showScreen(id, savePrev = true) {
  const target = document.getElementById(id);
  if (!target) {
    console.error(`Экран с id="${id}" не найден в HTML!`);
    return;
  }

  const current = document.querySelector(".screen.active");
  if (current && savePrev) State.prevScreen = current.id;

  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  target.classList.add("active");

  window.scrollTo(0, 0);
}

/** Вернуться на предыдущий экран */
function goBack() {
  if (State.prevScreen) {
    showScreen(State.prevScreen, false);
    State.prevScreen = null;
  }
}

/** Показать toast-уведомление */
function toast(text, duration = 2500) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

/** Копировать текст в буфер */
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast("✅ Скопировано!"));
}

/** Генерация строки звёзд */
function stars(n) {
  return "⭐️".repeat(n);
}

/** Иконка статуса заказа */
function statusIcon(deliveryStatus) {
  const map = { "✅": "✅", "💰": "💰", "🚚": "🚚", "📦": "📦", "❌": "❌" };
  return map[deliveryStatus] || "📦";
}

// ============================================================================
// НАВИГАЦИЯ ПО ТАБАМ
// ============================================================================

/** Переключить таб клиентского интерфейса */
function switchTab(tab) {
  State.activeTab = tab;

  document.querySelectorAll("#client-tabbar .tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  const screens = ["profile", "orders", "reviews", "support"];
  screens.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    el.classList.toggle("active", s === tab);
  });

  // Ленивая загрузка при первом переходе на таб
  if (tab === "orders" && !State.ordersLoaded) loadOrders();
  if (tab === "reviews" && !State.reviewsLoaded) loadReviews();
}

/** Переключить таб CRM-интерфейса сотрудника */
function switchCrmTab(tab) {
  State.activeCrmTab = tab;

  document.querySelectorAll("#staff-tabbar .tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });

  const screens = ["crm-main", "crm-orders", "crm-clients"];
  screens.forEach(s => {
    const el = document.getElementById(`screen-${s}`);
    el.classList.toggle("active", s === tab);
  });

  if (tab === "crm-orders" && !State.crmOrdersLoaded) loadCrmOrders();
  if (tab === "crm-clients" && !State.crmClientsLoaded) loadCrmClients();
}

// ============================================================================
// ЗАПУСК — АУТЕНТИФИКАЦИЯ И РОУТИНГ
// ============================================================================

async function init() {
  try {
    const auth = await api("/api/auth");

    if (auth.banned) {
      document.getElementById("ban-reason").textContent =
        `🚫 Аккаунт заблокирован. Причина: ${auth.reason}`;
      showScreen("screen-banned");
      return;
    }

    State.role = auth.role;

    if (auth.role === "staff") {
      // ── Сотрудник: показываем CRM ──────────────────────────────────────
      document.getElementById("client-tabbar").style.display = "none";
      document.getElementById("staff-tabbar").style.display = "flex";
      showScreen("screen-crm-main");
      loadCrmStats();
    } else {
      // ── Клиент: показываем личный кабинет ──────────────────────────────
      document.getElementById("client-tabbar").style.display = "flex";
      document.getElementById("staff-tabbar").style.display = "none";
      showScreen("screen-profile");
      loadProfile();
    }
  } catch (e) {
    // Показываем ошибку, не крашим приложение
    document.getElementById("screen-loading").innerHTML = `
      <div class="empty" style="margin-top:30vh">
        <div class="empty-icon">⚠️</div>
        <div class="empty-text">Ошибка загрузки:<br>${e.message}</div>
      </div>`;
  }
}

// ============================================================================
// ПРОФИЛЬ КЛИЕНТА
// ============================================================================

async function loadProfile() {
  try {
    const data = await api("/api/profile");
    State.profile = data;
    renderProfile(data);
  } catch (e) {
    document.getElementById("profile-content").innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
  }
}

function renderProfile(p) {
  const pct = Math.min(p.orders_count / 7, 1) * 100;

  // ── ИКОНКИ ──
  const iconCrown = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px; margin-bottom:2px;"><path d="M2 22h20v-2H2v2zm9-5.16 5-4.5 3.84 4.8A1 1 0 0 0 21.6 16l1.3-8.45a1 1 0 0 0-1.2-1.12L17 7.6 12.37 2a1 1 0 0 0-1.54 0L6.2 7.6 1.5 6.43a1 1 0 0 0-1.2 1.12L1.6 16a1 1 0 0 0 .76.8l3.84-4.8 5 4.5a1 1 0 0 0 1.35 0z"/></svg>`;
  const iconCopy = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  const iconShare = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>`;
  const iconEdit = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
  const iconBellOn = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`;
  const iconBellOff = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"></path><path d="M18.63 13A17.89 17.89 0 0 1 18 8"></path><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"></path><path d="M18 8a6 6 0 0 0-9.33-5"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
  const defaultAvatar = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

  document.getElementById("profile-content").innerHTML = `
    <div class="vip-card">
      <div class="card-gradient"></div>
      <div class="card-watermark">VEXO // AUTHENTIC</div>
      <div class="card-avatar-wrap">
        <div class="card-avatar">${defaultAvatar}</div>
      </div>
      <div class="vip-card-content">
        <div class="card-badge" style="display:inline-flex; align-items:center;">${iconCrown} ${p.status}</div>
        <div class="card-name">${p.name}</div>
        <div class="card-stats">
          <div class="stat-bubble"><div class="stat-value">${p.orders_count}</div><div class="stat-label">Заказов</div></div>
          <div class="stat-bubble"><div class="stat-value">${p.discount}%</div><div class="stat-label">Скидка</div></div>
        </div>
      </div>
    </div>

    <div class="progress-wrap card">
      <div class="progress-label">${p.goal_text}</div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Реферальная система</div>
      <div class="ref-box" id="ref-link-box">${p.ref_link}</div>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="copyText('${p.ref_link}')">${iconCopy} Копировать</button>
        <button class="btn btn-secondary" onclick="shareRef()">${iconShare} Поделиться</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Управление</div>
      <div class="list-item" onclick="openEditName()">
        <div class="list-item-icon" style="color: var(--tg-text); display:flex; align-items:center;">${iconEdit}</div>
        <div class="list-item-body"><div class="list-item-title">Изменить имя</div></div>
        <div class="list-item-arrow">›</div>
      </div>
      <div class="list-item" id="mailing-toggle" onclick="toggleMailing()">
        <div class="list-item-icon" style="color: var(--tg-text); display:flex; align-items:center;">${p.wants_mailing ? iconBellOff : iconBellOn}</div>
        <div class="list-item-body">
          <div class="list-item-title">${p.wants_mailing ? "Отписаться от рассылки" : "Подписаться на новинки"}</div>
        </div>
        <div class="list-item-arrow">›</div>
      </div>
    </div>
  `;
}

function shareRef() {
  if (!State.profile) return;
  const url = `https://t.me/share/url?url=${encodeURIComponent(State.profile.ref_link)}&text=${encodeURIComponent("Лови промокод на скидку!")}`;
  tg.openTelegramLink(url);
}

// ── Изменить имя ─────────────────────────────────────────────────────────────

function openEditName() {
  const input = document.getElementById("new-name-input");
  input.value = State.profile?.name || "";
  showScreen("screen-edit-name");
}

async function saveName() {
  const name = document.getElementById("new-name-input").value.trim();
  if (!name) { toast("⚠️ Введите имя"); return; }

  try {
    await api("/api/profile/name", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    toast("✅ Имя изменено!");
    goBack();
    loadProfile(); // обновляем профиль
  } catch (e) {
    toast(`⚠️ ${e.message}`);
  }
}

// ── Подписка на рассылку ─────────────────────────────────────────────────────

async function toggleMailing() {
  if (!State.profile) return;
  const newState = !State.profile.wants_mailing;

  try {
    await api("/api/profile/mailing", {
      method: "POST",
      body: JSON.stringify({ subscribe: newState }),
    });
    State.profile.wants_mailing = newState;
    toast(newState ? "🔔 Подписка активирована!" : "🔕 Вы отписались");
    renderProfile(State.profile); // перерисовываем кнопку
  } catch (e) {
    toast(`⚠️ ${e.message}`);
  }
}

// ============================================================================
// ЗАКАЗЫ КЛИЕНТА
// ============================================================================

async function loadOrders() {
  State.ordersLoaded = true;
  const list = document.getElementById("orders-list");

  try {
    const [activeRes, historyRes] = await Promise.all([
      api("/api/orders/active"),
      api("/api/orders/history"),
    ]);

    let html = "";

    if (activeRes.orders.length > 0) {
      html += `<div class="card-title" style="padding:0 4px 8px">Активные</div>`;
      activeRes.orders.forEach(o => {
        html += orderListItem(o, false);
      });
    }

    if (historyRes.orders.length > 0) {
      html += `<div class="card-title" style="padding:8px 4px">История</div>`;
      historyRes.orders.forEach(o => {
        html += orderListItem(o, true);
      });
    }

    if (!html) {
      html = `<div class="empty">
        <div class="empty-icon">📭</div>
        <div class="empty-text">Заказов пока нет</div>
      </div>`;
    }

    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
  }
}

function orderListItem(o, isDone) {
  const badge = isDone
    ? `<span class="status-badge done">✅ Завершён</span>`
    : `<span class="status-badge">${o.delivery_status} ${o.status_text}</span>`;

  return `
    <div class="list-item" onclick="openOrder(${o.id})">
      <div class="list-item-icon">${statusIcon(o.delivery_status)}</div>
      <div class="list-item-body">
        <div class="list-item-title">${o.title}</div>
        <div class="list-item-sub">#${o.id} · ${badge}</div>
      </div>
      <div class="list-item-arrow">›</div>
    </div>`;
}

async function openOrder(orderId) {
  showScreen("screen-order-detail");
  document.getElementById("order-detail-title").textContent = `Заказ #${orderId}`;
  document.getElementById("order-detail-content").innerHTML =
    `<div class="loader-wrap"><div class="loader"></div></div>`;

  try {
    const o = await api(`/api/orders/${orderId}`);
    renderOrderDetail(o);
  } catch (e) {
    document.getElementById("order-detail-content").innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
  }
}

function renderOrderDetail(o) {
  const steps = [
    { emoji: "✅", label: "Принят", key: "✅" },
    { emoji: "💰", label: "Выкуплен", key: "💰" },
    { emoji: "🚚", label: "В пути", key: "🚚" },
    { emoji: "📦", label: "Прибыл", key: "📦" },
  ];

  const statusOrder = ["✅", "💰", "🚚", "📦"];
  const currentIdx = o.status === "closed"
    ? 4
    : statusOrder.indexOf(o.delivery_status);

  const stepsHtml = steps.map((s, i) => {
    const cls = i < currentIdx ? "done" : (i === currentIdx ? "active" : "");
    return `
      <div class="order-step">
        <div class="order-step-dot ${cls}">${i < currentIdx ? "✓" : s.emoji}</div>
        <div class="order-step-label">${s.label}</div>
      </div>`;
  }).join("");

  const photoHtml = o.photo_id
    ? `<img src="https://your-domain.com/photo/${o.photo_id}" style="width:100%;border-radius:${12}px;margin-bottom:12px" />`
    : "";

  document.getElementById("order-detail-content").innerHTML = `
    ${photoHtml}
    <div class="card">
      <div class="card-title">Товар</div>
      <div style="font-size:17px;font-weight:600">${o.title}</div>
    </div>
    <div class="card">
      <div class="card-title">Статус доставки</div>
      <div class="order-steps">${stepsHtml}</div>
      <div style="font-size:14px;color:var(--tg-hint);text-align:center">${o.status_text}</div>
    </div>
    <div class="card">
      <div class="card-title">Информация</div>
      <div style="font-size:14px;line-height:1.6">${o.info}</div>
    </div>
  `;
}

// ============================================================================
// ОТЗЫВЫ
// ============================================================================

async function loadReviews(page = 1) {
  State.reviewsLoaded = true;
  State.reviewsPage = page;
  const list = document.getElementById("reviews-list");
  const pag = document.getElementById("reviews-pagination");

  list.innerHTML = `<div class="loader-wrap"><div class="loader"></div></div>`;

  try {
    const data = await api(`/api/reviews?page=${page}`);

    // Кнопка «написать отзыв» (только если есть телефон — проверяем через профиль)
    let writeBtn = "";
    if (State.role === "client") {
      writeBtn = `<button class="btn btn-primary" style="margin-bottom:12px" onclick="openWriteReview()">✍️ Написать отзыв</button>`;
    }

    if (data.reviews.length === 0) {
      list.innerHTML = `${writeBtn}<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Отзывов пока нет</div></div>`;
      pag.innerHTML = "";
      return;
    }

    const items = data.reviews.map(r => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="font-weight:600">${r.client_name}</div>
          <div class="stars">${stars(r.rating)}</div>
        </div>
        <div style="font-size:13px;color:var(--tg-hint);margin-bottom:8px">📦 ${r.item_name}</div>
        <div style="font-size:14px;line-height:1.5">${r.text}</div>
      </div>`).join("");

    list.innerHTML = writeBtn + items;

    // Пагинация
    pag.innerHTML = `
      <button class="page-btn" onclick="loadReviews(${page - 1})" ${page <= 1 ? "disabled" : ""}>‹</button>
      <span class="page-info">${page} / ${data.total_pages}</span>
      <button class="page-btn" onclick="loadReviews(${page + 1})" ${page >= data.total_pages ? "disabled" : ""}>›</button>
    `;
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">${e.message}</div></div>`;
  }
}

// ── Написать отзыв ───────────────────────────────────────────────────────────

function openWriteReview() {
  State.reviewRating = 0;
  document.getElementById("rev-item").value = "";
  document.getElementById("rev-name").value = State.profile?.name || "";
  document.getElementById("rev-text").value = "";
  document.querySelectorAll(".star-btn").forEach(b => b.classList.remove("active"));
  showScreen("screen-write-review");
}

function selectStar(n) {
  State.reviewRating = n;
  document.querySelectorAll(".star-btn").forEach(b => {
    b.classList.toggle("active", Number(b.dataset.v) <= n);
  });
}

async function submitReview() {
  const item = document.getElementById("rev-item").value.trim();
  const name = document.getElementById("rev-name").value.trim();
  const text = document.getElementById("rev-text").value.trim();
  const rating = State.reviewRating;

  if (!item) { toast("⚠️ Укажите название товара"); return; }
  if (!name) { toast("⚠️ Укажите имя"); return; }
  if (!text) { toast("⚠️ Напишите отзыв"); return; }
  if (!rating) { toast("⚠️ Выберите оценку"); return; }

  try {
    await api("/api/reviews/add", {
      method: "POST",
      body: JSON.stringify({ item_name: item, client_name: name, text, rating }),
    });
    toast("❤️ Отзыв опубликован!");
    State.reviewsLoaded = false; // сбрасываем кэш
    goBack();
    loadReviews(1);
  } catch (e) {
    toast(`⚠️ ${e.message}`);
  }
}

// ============================================================================
// ПОДДЕРЖКА
// ============================================================================

document.getElementById("btn-open-support").addEventListener("click", async () => {
  const btn = document.getElementById("btn-open-support");
  btn.disabled = true;
  btn.textContent = "⏳ Отправляем запрос...";

  try {
    // Вариант 1: через API (не требует закрытия Mini App)
    await api("/api/support/request", { method: "POST" });
    toast("✅ Запрос отправлен! Менеджер напишет вам в Telegram.");
    btn.textContent = "⏳ Ожидайте ответа менеджера";

  } catch (e) {
    if (e.message.includes("уже общаетесь")) {
      toast("💬 Вы уже в диалоге с менеджером");
    } else if (e.message.includes("подождите")) {
      toast(`⏳ ${e.message}`);
    } else {
      // Вариант 2 (fallback): закрываем Mini App и открываем чат через sendData
      tg.sendData(JSON.stringify({ action: "open_support" }));
    }
    btn.disabled = false;
    btn.textContent = "🛍 Оформить заказ / Задать вопрос";
  }
});

// ── FAQ ──────────────────────────────────────────────────────────────────────

const FAQ_CONTENT = {
  delivery: {
    title: "🚚 Сроки доставки",
    text: "После выкупа товара среднее время доставки до нашего склада — 24–26 дней. Далее заказ отправляется вам. Срок зависит от службы доставки. Заказ отправляется на следующий день после подтверждения.",
  },
  payment: {
    title: "💳 Способы оплаты",
    text: "Оплата на карту по системе 40% / 60%:\n• 40% — предоплата перед выкупом\n• 60% — оплата перед отправкой товара к вам.",
  },
  return: {
    title: "🔄 Условия возврата",
    text: "Возврат возможен при обнаружении производственного брака или грубого несоответствия (другой цвет/размер/модель) при проверке на пункте выдачи. Возврат по причине «не подошло» или «передумал» не предусмотрен. Внимательно сверяйте размерные сетки перед заказом.",
  },
};

function showFaq(key) {
  const item = FAQ_CONTENT[key];
  if (!item) return;
  document.getElementById("faq-title").textContent = item.title;
  document.getElementById("faq-text").textContent = item.text;
  showScreen("screen-faq");
}

// ============================================================================
// CRM — СОТРУДНИК
// ============================================================================

async function loadCrmStats() {
  const grid = document.getElementById("crm-stats");
  try {
    const s = await api("/api/staff/stats");
    grid.innerHTML = `
      <div class="crm-stat-card">
        <div class="crm-stat-value">${s.users_count}</div>
        <div class="crm-stat-label">👥 Клиентов</div>
      </div>
      <div class="crm-stat-card">
        <div class="crm-stat-value">${s.active_orders}</div>
        <div class="crm-stat-label">📦 Активных заказов</div>
      </div>
      <div class="crm-stat-card">
        <div class="crm-stat-value">${s.closed_orders}</div>
        <div class="crm-stat-label">✅ Завершено</div>
      </div>
      <div class="crm-stat-card">
        <div class="crm-stat-value">${s.reviews_count}</div>
        <div class="crm-stat-label">⭐️ Отзывов</div>
      </div>
    `;
  } catch (e) {
    grid.innerHTML = `<div class="empty"><div class="empty-text">${e.message}</div></div>`;
  }
}

async function loadCrmOrders() {
  State.crmOrdersLoaded = true;
  const list = document.getElementById("crm-orders-list");
  try {
    const data = await api("/api/staff/orders/active");

    if (data.orders.length === 0) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Активных заказов нет</div></div>`;
      return;
    }

    list.innerHTML = data.orders.map(o => `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <div style="font-weight:600;font-size:15px">${o.title}</div>
          <span class="status-badge">${o.delivery_status}</span>
        </div>
        <div style="font-size:13px;color:var(--tg-hint);margin-bottom:4px">📱 ${o.phone}</div>
        <div style="font-size:13px;line-height:1.5">${o.info}</div>
      </div>`).join("");
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="empty-text">${e.message}</div></div>`;
  }
}

async function loadCrmClients(page = 1) {
  State.crmClientsLoaded = true;
  State.clientsPage = page;
  const list = document.getElementById("crm-clients-list");
  const pag = document.getElementById("crm-clients-pagination");

  list.innerHTML = `<div class="loader-wrap"><div class="loader"></div></div>`;

  try {
    const data = await api(`/api/staff/clients?page=${page}`);

    if (data.clients.length === 0) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-text">Клиентов нет</div></div>`;
      pag.innerHTML = "";
      return;
    }

    list.innerHTML = data.clients.map(c => `
      <div class="list-item">
        <div class="list-item-icon">👤</div>
        <div class="list-item-body">
          <div class="list-item-title">${c.phone || "Без номера"}</div>
          <div class="list-item-sub">ID: ${c.user_id} · ${c.orders_count} заказов · скидка ${c.discount}%</div>
        </div>
      </div>`).join("");

    pag.innerHTML = `
      <button class="page-btn" onclick="loadCrmClients(${page - 1})" ${page <= 1 ? "disabled" : ""}>‹</button>
      <span class="page-info">${page} / ${data.total_pages}</span>
      <button class="page-btn" onclick="loadCrmClients(${page + 1})" ${page >= data.total_pages ? "disabled" : ""}>›</button>
    `;
  } catch (e) {
    list.innerHTML = `<div class="empty"><div class="empty-text">${e.message}</div></div>`;
  }
}

// ============================================================================
// СТАРТ
// ============================================================================
 init();
// ============================================================================
// ВРЕМЕННЫЙ ТЕСТОВЫЙ ЗАПУСК БЕЗ СЕРВЕРА
// ============================================================================

// Укажи "client" (клиент) или "staff" (сотрудник), чтобы смотреть разные интерфейсы
State.role = "client";

if (State.role === "staff") {
  document.getElementById("client-tabbar").style.display = "none";
  document.getElementById("staff-tabbar").style.display = "flex";
  showScreen("screen-crm-main");

  // Фейковая статистика для CRM
  document.getElementById("crm-stats").innerHTML = `
    <div class="crm-stat-card"><div class="crm-stat-value">124</div><div class="crm-stat-label">👥 Клиентов</div></div>
    <div class="crm-stat-card"><div class="crm-stat-value">12</div><div class="crm-stat-label">📦 Активных заказов</div></div>
    <div class="crm-stat-card"><div class="crm-stat-value">450</div><div class="crm-stat-label">✅ Завершено</div></div>
    <div class="crm-stat-card"><div class="crm-stat-value">89</div><div class="crm-stat-label">⭐️ Отзывов</div></div>
  `;
} else {
  document.getElementById("client-tabbar").style.display = "flex";
  document.getElementById("staff-tabbar").style.display = "none";
  showScreen("screen-profile");

  // Фейковые данные профиля клиента
  State.profile = {
    card_emoji: "👑", status: "VIP Client", name: "Тестовый Пользователь",
    promo_code: "LOCAL2026", phone_display: "+7 (999) 000-00-00",
    orders_count: 5, discount: 10, goal_text: "Остался 1 заказ до скидки 12%",
    ref_link: "https://t.me/bot?start=test1234", wants_mailing: true
  };
  renderProfile(State.profile);
}
// 1. Наш каталог товаров
const PRODUCTS = [
  { id: 1, category: 'shoes', title: 'Nike Dunk Low', price: 12400, oldPrice: 15500, img: '👟', discount: '-20%' },
  { id: 2, category: 'clothes', title: 'VEXO Zip Hoodie', price: 6900, img: '👕' },
  { id: 3, category: 'acc', title: 'Balenciaga Cap', price: 21000, oldPrice: 23500, img: '🧢', discount: '-10%' },
  { id: 4, category: 'shoes', title: 'Jordan 1 Retro', price: 18900, img: '🏀' },
  { id: 5, category: 'clothes', title: 'Street Over Tee', price: 3500, oldPrice: 4500, img: '👕', discount: '-22%' },
  { id: 6, category: 'acc', title: 'VEXO Beanie', price: 2800, img: '🧶' }
];

let currentFilter = 'all';

// 2. Функция отрисовки товаров
function renderProducts() {
  const grid = document.getElementById('products-list');
  const searchTerm = document.getElementById('product-search').value.toLowerCase();
  
  // Фильтруем список
  const filtered = PRODUCTS.filter(p => {
    const matchCategory = currentFilter === 'all' || p.category === currentFilter;
    const matchSearch = p.title.toLowerCase().includes(searchTerm);
    return matchCategory && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--tg-hint);">Ничего не найдено</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => `
    <div class="product-card" onclick="openProduct(${p.id})">
      <div class="product-img-box">
        ${p.discount ? `<div class="discount-tag">${p.discount}</div>` : ''}
        <div style="font-size:48px;">${p.img}</div>
      </div>
      <div class="product-title">${p.title}</div>
      <div class="product-prices">
        <span class="price-new">${p.price.toLocaleString()} ₽</span>
        ${p.oldPrice ? `<span class="price-old">${p.oldPrice.toLocaleString()} ₽</span>` : ''}
      </div>
    </div>
  `).join('');
}

// 3. Логика фильтров
function setFilter(category, el) {
  currentFilter = category;
  // Смена активного класса у кнопок
  document.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active'));
  el.classList.add('active');
  renderProducts();
}

// 4. Глобальный поиск
function filterProducts() {
  renderProducts();
}
renderProducts()
