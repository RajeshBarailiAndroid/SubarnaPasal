const TOLA_GRAMS = 11.664;
const fmt = new Intl.NumberFormat('en-NP');

const CURRENCIES = {
  USD: { code: 'USD', label: 'US Dollar ($)', nprPerUnit: 133, locale: 'en-US' },
  CAD: { code: 'CAD', label: 'Canadian Dollar (CA$)', nprPerUnit: 98, locale: 'en-CA' }
};

let displayCurrency = 'USD';
const moneyFormatters = {};

function getCurrency() {
  return CURRENCIES[displayCurrency] || CURRENCIES.USD;
}

function currencyCode() {
  return getCurrency().code;
}

function nprToDisplay(npr) {
  return Number(npr) / getCurrency().nprPerUnit;
}

function displayToNpr(amount) {
  return Number(amount) * getCurrency().nprPerUnit;
}

function inputMoneyToNpr(amount) {
  const value = Number(amount) || 0;
  return displayCurrency === 'NPR' ? value : displayToNpr(value);
}

function formatMoney(npr) {
  const c = getCurrency();
  if (!moneyFormatters[c.code]) {
    moneyFormatters[c.code] = new Intl.NumberFormat(c.locale, {
      style: 'currency',
      currency: c.code,
      maximumFractionDigits: c.code === 'NPR' ? 0 : 2,
      minimumFractionDigits: c.code === 'NPR' ? 0 : 2
    });
  }
  return moneyFormatters[c.code].format(nprToDisplay(npr));
}

function formatMoneyPlain(npr) {
  const amount = nprToDisplay(npr);
  return currencyCode() === 'NPR' ? fmt.format(amount) : amount.toFixed(2);
}

function labelWithCurrency(key) {
  return `${t(key)} (${currencyCode()})`;
}

function setDisplayCurrency(code) {
  displayCurrency = CURRENCIES[code] ? code : 'USD';
}

function initCurrencySelect() {
  const sel = document.getElementById('currency-select');
  if (!sel) return;
  sel.innerHTML = Object.entries(CURRENCIES)
    .map(([code, c]) => `<option value="${code}">${c.label}</option>`)
    .join('');
  sel.value = displayCurrency;
}

function parseMoneyField(value) {
  return parseRateInput(value);
}

function formatMoneyField(npr) {
  return formatRateInput(npr);
}

function refreshDisplayPrices() {
  renderPosCatalog();
  renderInventoryTable();
  renderCart();
  populateOrderItemSelect();
  updateOrderTotalPreview();
  updateCustomItemPricePreview();
  renderRateHistoryTable();
  if (reportCache && activeView === 'reports') {
    const expenses = expensesInRange(reportCache.period?.start, reportCache.period?.end);
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const netProfit = reportCache.sales.revenue - expenseTotal;
    updateReportSectionTitle();
    if (reportTab === 'inventory') renderInventoryReport(reportCache);
    else if (reportTab === 'customer') renderCustomerReport(reportCache);
    else renderSalesReport(reportCache, expenseTotal, netProfit);
  }
}

function renderRateHistoryTable() {
  const historyEl = document.getElementById('rate-history');
  if (!historyEl) return;
  historyEl.innerHTML = rateHistoryCache.length
    ? `<table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('perTolaCol')}</th><th>${t('perGramCol')}</th></tr></thead><tbody>
      ${rateHistoryCache.map((row) => `<tr>
        <td>${new Date(row.updatedAt).toLocaleString()}</td>
        <td>${formatMoney(row.goldRatePerTola)}</td>
        <td>${formatMoney(row.goldRatePerGram)}</td>
      </tr>`).join('')}
    </tbody></table>`
    : `<p class="empty">${t('noRateHistory')}</p>`;
}

async function refreshAfterCurrencyChange() {
  refreshCurrencyLabels();
  if (settingsPriceMode === 'api') {
    await updateMetalRates({ priceMode: 'api' });
  } else {
    await updateMetalRates({
      priceMode: 'manual',
      goldRatePerTola: goldRateCache,
      goldRatePerGram: Number((goldRateCache / TOLA_GRAMS).toFixed(2)),
      silverRatePerTola: silverRateCache,
      silverRatePerGram: Number((silverRateCache / TOLA_GRAMS).toFixed(2))
    });
    refreshMetalPriceFields();
  }
  refreshDisplayPrices();
  if (activeView === 'reports') {
    await loadReports().catch((err) => toast(err.message));
  }
}
function refreshCurrencyLabels() {
  document.querySelectorAll('[data-currency-field]').forEach((el) => {
    const key = el.dataset.currencyField;
    if (key) el.textContent = labelWithCurrency(key);
  });
  const metalTitle = document.querySelector('.metal-rates h3');
  if (metalTitle) metalTitle.textContent = `${t('liveMetalRates')} (${currencyCode()})`;
  updateOrderTotalPreview();
  updateCustomItemPricePreview();
}

function formatRateInput(npr) {
  const amount = nprToDisplay(npr);
  return currencyCode() === 'NPR' ? Math.round(amount) : Number(amount.toFixed(2));
}

function parseRateInput(value) {
  return displayToNpr(Number(value) || 0);
}

function formatGramRateFromTola(tolaNpr) {
  return formatRateInput((tolaNpr || 0) / TOLA_GRAMS);
}

function parseTolaFromGramInput(gramValue) {
  return Number((parseRateInput(gramValue) * TOLA_GRAMS).toFixed(2));
}

function refreshMetalPriceFields() {
  const priceForm = document.getElementById('settings-form');
  if (!priceForm) return;
  const goldGramField = priceForm.goldRatePerGram;
  const silverGramField = priceForm.silverRatePerGram;
  if (goldGramField) {
    goldGramField.value = formatGramRateFromTola(goldRateCache);
    goldGramField.step = currencyCode() === 'NPR' ? '1' : '0.01';
  }
  if (silverGramField) {
    silverGramField.value = formatGramRateFromTola(silverRateCache);
    silverGramField.step = currencyCode() === 'NPR' ? '0.01' : '0.01';
  }
  updateMetalRatePreviews();
  refreshCurrencyLabels();
}

function sortIcon() {
  return '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>';
}

function cartIcon() {
  return '<svg class="order-cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
}

function shopLogoHtml(className = 'shop-logo') {
  return `<img src="logo.svg" class="${className}" width="88" height="88" alt="Suvarnapasal" />`;
}

function inventoryTableHead() {
  return `<thead><tr>
    <th><input type="checkbox" aria-label="Select all" /></th>
    <th class="sortable">${t('name')}${sortIcon()}</th>
    <th>${t('sku')}</th>
    <th>${t('category')}</th>
    <th>${t('location')}</th>
    <th>${t('weightGramsCol')}</th>
    <th>${t('purity')}</th>
    <th>${t('stock')}</th>
    <th>${t('status')}</th>
    <th class="sortable">${t('priceInfo')}${sortIcon()}</th>
  </tr></thead>`;
}

function ordersTableHead() {
  return `<thead><tr>
    <th><input type="checkbox" aria-label="Select all" /></th>
    <th class="sortable">${t('receiptNo')}${sortIcon()}</th>
    <th class="sortable">${t('orderDate')}${sortIcon()}</th>
    <th class="sortable">${t('dueDate')}${sortIcon()}</th>
    <th>${t('customer')}</th>
    <th>${t('itemsCol')}</th>
    <th class="sortable">${t('totalCol')}${sortIcon()}</th>
    <th>${t('status')}</th>
    <th>${t('options')}</th>
  </tr></thead>`;
}

function ordersEmptyTable() {
  return `<table class="data-table">${ordersTableHead()}<tbody><tr class="empty-row"><td colspan="9">${t('noResults')}</td></tr></tbody></table>`;
}

const ORDER_STATUS_RANK = {
  pending: 0,
  confirmed: 1,
  progress: 2,
  ready: 3,
  completed: 4,
  cancelled: 5
};

const ORDER_GROUPS = [
  {
    id: 'progress',
    labelKey: 'orderProgress',
    statuses: ['pending', 'confirmed', 'progress']
  },
  { id: 'ready', labelKey: 'orderReady', statuses: ['ready'] },
  { id: 'completed', labelKey: 'orderCompleted', statuses: ['completed'] }
];

function orderGroupIdForStatus(status) {
  return ORDER_GROUPS.find((g) => g.statuses.includes(status))?.id || null;
}

function sortOrdersForDisplay(orders) {
  return [...orders].sort((a, b) => {
    const rankA = ORDER_STATUS_RANK[a.status] ?? 99;
    const rankB = ORDER_STATUS_RANK[b.status] ?? 99;
    if (rankA !== rankB) return rankA - rankB;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

const views = {
  pos: { showAddItem: false, posMode: true },
  inventory: { showAddItem: true, posMode: false },
  orders: { showAddItem: false, posMode: false },
  customers: { showAddItem: false, posMode: false },
  reports: { showAddItem: false, posMode: false },
  expenses: { showAddItem: false, posMode: false },
  users: { showAddItem: false, posMode: false },
  settings: { showAddItem: false, posMode: false }
};

let editingId = null;
let itemsCache = [];
let ordersAllCache = [];
let orderItemsCache = [];
let posItemsCache = [];
let goldRateCache = 0;
let silverRateCache = 0;
let settingsPriceMode = 'manual';
let locationsCache = [];
let settingsCache = {
  shopName: 'Suvarnapasal',
  shopAddress: '',
  shopPhone: '',
  priceMode: 'manual',
  currency: 'USD',
  goldRatePerTola: 0,
  silverRatePerTola: 0
};
let rateHistoryCache = [];
let lastSaleBill = null;
let activeView = 'pos';
let posCart = [];
let reportTab = 'sales';
let orderGroup = 'progress';
let reportCache = null;
let selectedCustomer = null;

function rowCountLabel(selected, total) {
  return t('rowsSelectedFmt').replace('{s}', selected).replace('{n}', total);
}

function requireSignedInSync() {
  if (typeof isAuthRequired === 'function' && isAuthRequired()) {
    if (typeof isSignedInSync === 'function' && !isSignedInSync()) {
      if (typeof redirectToLogin === 'function') redirectToLogin();
      throw new Error(t('signInRequired'));
    }
  }
}

async function requireSignedIn() {
  if (typeof waitForAuthReady === 'function') await waitForAuthReady();
  requireSignedInSync();
}

function localData(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  if (fallback) {
    const canSeed = !(typeof isAuthRequired === 'function' && isAuthRequired()
      && typeof isSignedInSync === 'function' && !isSignedInSync());
    if (canSeed) localStorage.setItem(key, JSON.stringify(fallback));
  }
  return fallback || [];
}

function saveLocalData(key, data) {
  requireSignedInSync();
  localStorage.setItem(key, JSON.stringify(data));
}

function getOrdersSearchQuery() {
  return document.getElementById('search-orders')?.value.trim().toLowerCase() || '';
}

function filterOrdersBySearch(orders, search = getOrdersSearchQuery()) {
  if (!search) return orders;
  return orders.filter((o) => {
    const hay = `${o.orderNumber} ${o.customerName} ${o.status} ${orderItemsSummary(o)}`.toLowerCase();
    return hay.includes(search);
  });
}

function selectOrderGroupForSearch(matches, search) {
  if (!matches.length) return;

  for (const group of ORDER_GROUPS) {
    const label = t(group.labelKey).toLowerCase();
    const statusHit = group.statuses.some((s) => search.includes(s) || label.includes(search) || search.includes(label));
    if (statusHit && matches.some((o) => group.statuses.includes(o.status))) {
      orderGroup = group.id;
      return;
    }
  }

  const counts = ORDER_GROUPS.map((group) => ({
    id: group.id,
    count: matches.filter((o) => group.statuses.includes(o.status)).length
  }));
  const best = counts.reduce((a, b) => (b.count > a.count ? b : a), counts[0]);
  if (best.count > 0) orderGroup = best.id;
  else if (matches[0]) orderGroup = orderGroupIdForStatus(matches[0].status) || orderGroup;
}

function updateOrderGroupTabsUI() {
  const search = getOrdersSearchQuery();
  const matches = search ? filterOrdersBySearch(ordersAllCache, search) : ordersAllCache;
  document.querySelectorAll('.order-group-tab').forEach((tab) => {
    const groupId = tab.dataset.orderGroup;
    const group = ORDER_GROUPS.find((g) => g.id === groupId);
    const label = t(group.labelKey);
    const count = matches.filter((o) => group.statuses.includes(o.status)).length;
    tab.textContent = count > 0 ? `${label} (${count})` : label;
    tab.classList.toggle('has-search-matches', Boolean(search && count > 0));
    tab.classList.toggle('is-active', groupId === orderGroup);
  });
}

function applyOrdersSearch() {
  const search = getOrdersSearchQuery();
  if (search) {
    const matches = filterOrdersBySearch(ordersAllCache, search);
    selectOrderGroupForSearch(matches, search);
  }
  renderOrdersView();
}

function orderDueDate(order) {
  const d = new Date(order.createdAt);
  d.setDate(d.getDate() + 14);
  return d;
}

function orderItemsSummary(order) {
  return (order.lines || []).map((l) => `${l.itemName} × ${l.quantity}`).join(', ') || '—';
}

function gramsToTola(g) {
  return (g / TOLA_GRAMS).toFixed(3);
}

function itemMarketValue(item, rate) {
  const gold = (Number(item.weightGrams) / TOLA_GRAMS) * rate * (item.karat / 24);
  return Math.round(gold + (Number(item.makingCharge) || 0));
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.classList.remove('toast-error');
  el.classList.toggle('toast-error', type === 'error');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, type === 'error' ? 4000 : 2600);
}

function errorToast(title, msg) {
  const el = document.getElementById('toast');
  el.classList.add('toast-error');
  el.innerHTML = `<strong>${title}</strong><span>${msg}</span>`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 4000);
}

let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshAll().catch((err) => {
      if (typeof toast === 'function') toast(err.message);
    });
  }, 150);
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };

  const method = String(opts.method || 'GET').toUpperCase();
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const isAuth = path.startsWith('/api/auth');

  if (isMutation && !isAuth) await requireSignedIn();

  if (typeof getAuthAccessToken === 'function') {
    const token = await getAuthAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...opts,
    headers
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (typeof redirectToLogin === 'function') redirectToLogin();
    throw new Error(data.error || 'Sign in required.');
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  if (isMutation && !isAuth) scheduleRefresh();
  return data;
}

function formatCurrencyAmount(amount) {
  const c = getCurrency();
  if (!moneyFormatters[c.code]) {
    moneyFormatters[c.code] = new Intl.NumberFormat(c.locale, {
      style: 'currency',
      currency: c.code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    });
  }
  return moneyFormatters[c.code].format(Number(amount) || 0);
}

function applyMetalRatesFromResponse(payload) {
  if (settingsPriceMode === 'api' && payload.metalRatesLive) {
    if (payload.goldRatePerTola != null) goldRateCache = displayToNpr(payload.goldRatePerTola);
    if (payload.silverRatePerTola != null) silverRateCache = displayToNpr(payload.silverRatePerTola);
    return;
  }
  if (payload.goldRatePerTola != null) goldRateCache = payload.goldRatePerTola;
  if (payload.silverRatePerTola != null) silverRateCache = payload.silverRatePerTola;
}

function itemStockStatusBadge(item) {
  if (!item || item.quantity === 0) return `<span class="badge sold">${t('soldOut')}</span>`;
  return `<span class="badge">${t('inStock')}</span>`;
}

function txTypeLabel(type) {
  if (type === 'stock_in') return t('stockIn');
  if (type === 'sale') return t('sale');
  return t('stockOut');
}

function orderStatusBadge(status) {
  const map = {
    pending: ['orderPending', 'pending'],
    confirmed: ['orderConfirmed', 'confirmed'],
    progress: ['orderProgress', 'progress'],
    ready: ['orderReady', 'ready'],
    completed: ['orderCompleted', 'completed'],
    cancelled: ['orderCancelled', 'cancelled']
  };
  const [key, cls] = map[status] || ['orderPending', 'pending'];
  return `<span class="badge order-${cls}">${t(key)}</span>`;
}

function orderActionButtons(order) {
  const actions = [];
  const id = order.id;
  if (order.status === 'completed') {
    actions.push(`<button type="button" class="order-cart-btn" data-order-cart="${id}" title="${t('addCart')}" aria-label="${t('addCart')}">${cartIcon()}</button>`);
  }
  if (order.status === 'pending') {
    actions.push(`<button type="button" class="link-btn" data-order-action="confirmed" data-order-id="${id}">${t('confirmOrder')}</button>`);
    actions.push(`<button type="button" class="link-btn" data-order-action="progress" data-order-id="${id}">${t('markProgress')}</button>`);
  }
  if (order.status === 'confirmed') {
    actions.push(`<button type="button" class="link-btn" data-order-action="progress" data-order-id="${id}">${t('markProgress')}</button>`);
    actions.push(`<button type="button" class="link-btn" data-order-action="ready" data-order-id="${id}">${t('markReady')}</button>`);
  }
  if (order.status === 'progress') {
    actions.push(`<button type="button" class="link-btn" data-order-action="ready" data-order-id="${id}">${t('markReady')}</button>`);
  }
  if (order.status === 'ready') {
    actions.push(`<button type="button" class="link-btn" data-order-action="progress" data-order-id="${id}">${t('orderProgress')}</button>`);
  }
  if (['pending', 'confirmed', 'progress', 'ready'].includes(order.status)) {
    actions.push(`<button type="button" class="link-btn" data-order-action="completed" data-order-id="${id}">${t('completeOrder')}</button>`);
    actions.push(`<button type="button" class="link-btn danger" data-order-action="cancelled" data-order-id="${id}">${t('cancelOrder')}</button>`);
    actions.push(`<button type="button" class="link-btn danger" data-order-delete="${id}">${t('delete')}</button>`);
  }
  if (order.status === 'completed') {
    actions.push(`<button type="button" class="link-btn order-option-btn" data-order-action="ready" data-order-revert="completed" data-order-id="${id}">${t('orderReady')}</button>`);
    actions.push(`<button type="button" class="link-btn order-option-btn" data-order-action="progress" data-order-revert="completed" data-order-id="${id}">${t('orderProgress')}</button>`);
  }
  return actions.join('');
}

async function updateMetalRates(settings) {
  const goldEl = document.getElementById('metal-rate-gold');
  const silverEl = document.getElementById('metal-rate-silver');
  const bodyEl = document.getElementById('metal-rates-body');
  const rateEdit = document.querySelector('.rate-edit');
  const priceMode = settings.priceMode || 'manual';
  settingsPriceMode = priceMode;
  const goldPerGram = settings.goldRatePerGram ?? Number((settings.goldRatePerTola / TOLA_GRAMS).toFixed(2));
  const silverPerTola = settings.silverRatePerTola ?? silverRateCache ?? 0;
  const silverPerGram = settings.silverRatePerGram ?? Number((silverPerTola / TOLA_GRAMS).toFixed(2));

  if (priceMode === 'api') {
    try {
      const live = await api(`/api/metal-rates?currency=${encodeURIComponent(currencyCode())}`);
      goldRateCache = displayToNpr(live.gold.perTola);
      silverRateCache = displayToNpr(live.silver.perTola);
      if (bodyEl) bodyEl.hidden = true;
      if (goldEl) {
        goldEl.hidden = false;
        goldEl.textContent =
          `Gold: ${formatCurrencyAmount(live.gold.perTola)}/tola · ${formatCurrencyAmount(live.gold.perGram)}/g`;
      }
      if (silverEl) {
        silverEl.hidden = false;
        silverEl.textContent =
          `Silver: ${formatCurrencyAmount(live.silver.perTola)}/tola · ${formatCurrencyAmount(live.silver.perGram)}/g`;
      }
    } catch (err) {
      if (bodyEl) {
        bodyEl.hidden = false;
        bodyEl.innerHTML = `<span class="metal-rates-warning">${err.message}</span>`;
      }
      if (goldEl) goldEl.hidden = true;
      if (silverEl) silverEl.hidden = true;
    }
    if (rateEdit) rateEdit.hidden = false;
    refreshMetalPriceFields();
    return;
  }

  if (bodyEl) bodyEl.hidden = true;
  if (goldEl) {
    goldEl.hidden = false;
    goldEl.textContent =
      `Gold: ${formatMoney(settings.goldRatePerTola)}/tola · ${formatMoney(goldPerGram)}/g`;
  }
  if (silverEl) {
    silverEl.hidden = false;
    silverEl.textContent =
      `Silver: ${formatMoney(silverPerTola)}/tola · ${formatMoney(silverPerGram)}/g`;
  }
  if (rateEdit) rateEdit.hidden = false;
  refreshMetalPriceFields();
}

function updateMetalRatePreviews() {
  const goldGramInput = document.querySelector('#settings-form [name="goldRatePerGram"]');
  const goldTolaEl = document.getElementById('gold-rate-tola');
  if (goldGramInput && goldTolaEl) {
    const gramRate = Number(goldGramInput.value);
    const tola = Number((gramRate * TOLA_GRAMS).toFixed(currencyCode() === 'NPR' ? 2 : 4));
    goldTolaEl.value = Number.isFinite(tola) ? tola : '';
  }

  const silverGramInput = document.querySelector('#settings-form [name="silverRatePerGram"]');
  const silverTolaEl = document.getElementById('silver-rate-tola');
  if (silverGramInput && silverTolaEl) {
    const gramRate = Number(silverGramInput.value);
    const tola = Number((gramRate * TOLA_GRAMS).toFixed(currencyCode() === 'NPR' ? 2 : 4));
    silverTolaEl.value = Number.isFinite(tola) ? tola : '';
  }
}

function renderLocationDatalist() {
  const list = document.getElementById('location-options');
  if (!list) return;
  list.innerHTML = '';
  locationsCache.forEach((loc) => {
    const opt = document.createElement('option');
    opt.value = loc;
    list.appendChild(opt);
  });
}

function renderLocationsManager() {
  const list = document.getElementById('locations-list');
  if (!list) return;
  if (!locationsCache.length) {
    list.innerHTML = `<li class="location-empty">${t('noLocations')}</li>`;
    return;
  }
  list.innerHTML = locationsCache.map((loc, idx) => `
    <li class="location-tag">
      <span>${loc}</span>
      <button type="button" class="location-remove" data-remove-location="${idx}" title="${t('delete')}" aria-label="${t('delete')}">×</button>
    </li>`).join('');
}

async function saveStoreLocations() {
  const snapshot = [...locationsCache];
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ locations: snapshot })
  });
  renderLocationDatalist();
  renderLocationsManager();
}

async function addStoreLocation(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    toast(t('locationNameRequired'));
    return;
  }
  if (locationsCache.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
    toast(t('locationExists'));
    return;
  }
  const previous = [...locationsCache];
  locationsCache = [...locationsCache, trimmed];
  renderLocationsManager();
  try {
    await saveStoreLocations();
    toast(t('locationAdded'));
    const input = document.getElementById('new-location-input');
    if (input) input.value = '';
  } catch (err) {
    locationsCache = previous;
    renderLocationsManager();
    toast(err.message);
  }
}

async function removeStoreLocation(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= locationsCache.length) return;
  const previous = [...locationsCache];
  locationsCache = locationsCache.filter((_, i) => i !== idx);
  renderLocationsManager();
  try {
    await saveStoreLocations();
    toast(t('locationRemoved'));
  } catch (err) {
    locationsCache = previous;
    renderLocationsManager();
    toast(err.message);
  }
}

async function loadSettings() {
  const settings = await api('/api/settings');
  settingsCache = {
    shopName: settings.shopName || 'Suvarnapasal',
    shopAddress: settings.shopAddress || '',
    shopPhone: settings.shopPhone || '',
    priceMode: settings.priceMode || 'manual',
    currency: settings.currency || 'USD',
    goldRatePerTola: settings.goldRatePerTola,
    silverRatePerTola: settings.silverRatePerTola
  };
  setDisplayCurrency(settings.currency || 'USD');
  initCurrencySelect();
  const storeForm = document.getElementById('settings-store-form');
  const priceForm = document.getElementById('settings-form');
  if (storeForm) {
    storeForm.shopName.value = settings.shopName || 'Suvarnapasal';
    storeForm.shopAddress.value = settings.shopAddress || '';
    storeForm.shopPhone.value = settings.shopPhone || '';
  }
  if (priceForm) {
    const mode = settings.priceMode || 'manual';
    priceForm.querySelectorAll('[name="priceMode"]').forEach((r) => {
      r.checked = r.value === mode;
    });
  }
  goldRateCache = settings.goldRatePerTola;
  silverRateCache = settings.silverRatePerTola
    || (settings.silverRatePerGram
      ? Number((settings.silverRatePerGram * TOLA_GRAMS).toFixed(2))
      : 0);
  refreshMetalPriceFields();
  await updateMetalRates(settings);

  locationsCache = settings.locations || [];
  renderLocationDatalist();
  renderLocationsManager();

  document.getElementById('settings-updated').textContent = settings.updatedAt
    ? `${t('lastSaved')} ${new Date(settings.updatedAt).toLocaleString()}`
    : '';

  rateHistoryCache = settings.rateHistory || [];
  renderRateHistoryTable();
}

function showView(name) {
  if (name === 'users' && typeof isAdminUser === 'function' && !isAdminUser()) {
    name = 'pos';
  }
  activeView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = true; });
  const viewEl = document.getElementById(`view-${name}`);
  if (viewEl) viewEl.hidden = false;

  document.querySelectorAll('.nav-btn, .settings-nav-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === name);
  });

  const meta = views[name] || views.pos;
  const addBtn = document.getElementById('add-item-btn');
  if (addBtn) addBtn.hidden = !meta.showAddItem;

  document.title = name === 'inventory'
    ? 'Suvarnapasal — Inventory'
    : name === 'pos'
      ? 'Suvarnapasal — POS'
      : `Suvarnapasal — ${name.charAt(0).toUpperCase() + name.slice(1)}`;

  if (name === 'orders') {
    if (ordersAllCache.length) renderOrdersView();
    else loadOrders().catch(() => {});
  }
  if (name === 'reports') {
    loadReports().catch((e) => toast(e.message));
  }
}

function cartLineName(line) {
  return line.name || line.itemName || line.sku || t('item');
}

function getSaleCustomerName() {
  return document.getElementById('pos-customer-name')?.value.trim()
    || selectedCustomer?.name
    || document.getElementById('pos-customer-search')?.value.trim()
    || '';
}

function getSaleCustomerPhone() {
  return document.getElementById('pos-customer-phone')?.value.trim()
    || selectedCustomer?.phone
    || '';
}

function clearPosCustomerNameError() {
  const input = document.getElementById('pos-customer-name');
  const error = document.getElementById('pos-customer-name-error');
  const wrap = document.getElementById('pos-customer-name-wrap');
  if (input) input.classList.remove('is-invalid');
  if (wrap) wrap.classList.remove('has-error');
  if (error) {
    error.hidden = true;
    error.textContent = '';
  }
}

function showPosCustomerNameError() {
  const input = document.getElementById('pos-customer-name');
  const error = document.getElementById('pos-customer-name-error');
  const wrap = document.getElementById('pos-customer-name-wrap');
  if (input) {
    input.classList.add('is-invalid');
    input.focus();
  }
  if (wrap) wrap.classList.add('has-error');
  if (error) {
    error.textContent = t('customerNamePrompt');
    error.hidden = false;
  }
}

function ensurePosCustomerName() {
  const name = getSaleCustomerName();
  if (name) {
    clearPosCustomerNameError();
    return true;
  }
  showPosCustomerNameError();
  return false;
}

function applyPosCustomer(customer) {
  selectedCustomer = customer;
  const nameInput = document.getElementById('pos-customer-name');
  const phoneInput = document.getElementById('pos-customer-phone');
  const input = document.getElementById('pos-customer-search');
  const badge = document.getElementById('selected-customer');
  const box = document.getElementById('customer-suggestions');
  if (nameInput) nameInput.value = customer.name || '';
  if (phoneInput) phoneInput.value = customer.phone || '';
  if (input) input.value = customer.name || '';
  clearPosCustomerNameError();
  if (box) { box.hidden = true; box.innerHTML = ''; }
  if (badge) {
    badge.hidden = false;
    badge.innerHTML = `<strong>${customer.name}</strong>${customer.phone ? ` · ${customer.phone}` : ''}`;
  }
  renderSaleCustomer();
}

function getSaleTotals() {
  const subtotal = posCart.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = inputMoneyToNpr(document.getElementById('cart-discount')?.value);
  const afterDiscount = Math.max(0, subtotal - discount);
  const taxType = document.getElementById('cart-tax-type')?.value || 'percent';
  const taxValue = Number(document.getElementById('cart-tax-value')?.value) || 0;
  let taxAmount = 0;
  if (taxValue > 0) {
    taxAmount = taxType === 'percent'
      ? Math.round(afterDiscount * taxValue / 100)
      : Math.max(0, inputMoneyToNpr(taxValue));
  }
  const total = afterDiscount + taxAmount;
  const taxLabel = taxType === 'percent' && taxValue > 0
    ? t('taxPercentLabel').replace('{rate}', taxValue)
    : t('tax');
  return { subtotal, discount, afterDiscount, taxType, taxValue, taxAmount, taxLabel, total };
}

function updateTaxInputUi() {
  const type = document.getElementById('cart-tax-type')?.value;
  const input = document.getElementById('cart-tax-value');
  if (!input) return;
  if (type === 'percent') {
    input.step = '0.1';
    input.max = '100';
  } else {
    input.removeAttribute('max');
    input.step = '100';
  }
}

function resetSaleTaxAndDiscount() {
  const discount = document.getElementById('cart-discount');
  const taxValue = document.getElementById('cart-tax-value');
  const taxType = document.getElementById('cart-tax-type');
  if (discount) discount.value = 0;
  if (taxValue) taxValue.value = 0;
  if (taxType) taxType.value = 'percent';
  updateTaxInputUi();
}

function renderSaleCustomer() {
  const el = document.getElementById('sale-customer');
  if (!el) return;
  const name = getSaleCustomerName();
  const phone = getSaleCustomerPhone();
  if (!name) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<span class="sale-customer-label">${t('customer')}</span><strong>${name}</strong>${phone ? `<span class="sale-customer-phone">${phone}</span>` : ''}`;
}

function renderCart() {
  const linesEl = document.getElementById('cart-lines');
  if (!linesEl) return;

  if (!posCart.length) {
    linesEl.innerHTML = `<p class="cart-empty">${t('cartEmpty')}</p>`;
  } else {
    linesEl.innerHTML = posCart.map((line, idx) => {
      const meta = line.custom
        ? `${line.sku} · ${line.karat || '—'}K · ${line.weightGrams || '—'}g × ${line.qty}`
        : `${line.sku || '—'} × ${line.qty}`;
      return `
      <div class="cart-line">
        <div class="cart-line-info">
          <strong class="cart-line-name">${cartLineName(line)}</strong>
          <span>${meta}</span>
        </div>
        <div class="cart-line-actions">
          <span>${formatMoney(line.price * line.qty)}</span>
          <button type="button" class="cart-remove" data-cart-remove="${idx}">${t('delete')}</button>
        </div>
      </div>`;
    }).join('');
  }

  const totals = getSaleTotals();
  document.getElementById('cart-subtotal').textContent = `${formatMoney(totals.subtotal)}`;
  document.getElementById('cart-total').textContent = `${formatMoney(totals.total)}`;

  const taxRow = document.getElementById('cart-tax-applied-row');
  const taxLabelEl = document.getElementById('cart-tax-applied-label');
  const taxAmountEl = document.getElementById('cart-tax-applied');
  if (taxRow && taxLabelEl && taxAmountEl) {
    if (totals.taxAmount > 0) {
      taxRow.hidden = false;
      taxLabelEl.textContent = totals.taxLabel;
      taxAmountEl.textContent = `${formatMoney(totals.taxAmount)}`;
    } else {
      taxRow.hidden = true;
    }
  }

  renderSaleCustomer();
  refreshStockDisplays();
}

function refreshStockDisplays() {
  renderPosCatalog();
  renderInventoryTable();
}

function renderPosCatalog() {
  const grid = document.getElementById('pos-product-grid');
  if (!grid) return;

  const sort = document.getElementById('pos-sort')?.value || 'name';
  let visible = [...posItemsCache].filter((item) => Number(item.quantity) > 0);
  if (sort === 'price') {
    visible.sort((a, b) => itemMarketValue(a, goldRateCache) - itemMarketValue(b, goldRateCache));
  } else {
    visible.sort((a, b) => a.name.localeCompare(b.name));
  }

  const inStock = visible.filter((item) => availableQuantity(item) > 0);
  const countEl = document.getElementById('pos-item-count');
  if (countEl) {
    countEl.textContent = inStock.length
      ? t('posItemCountFmt').replace('{n}', inStock.length)
      : '';
  }

  if (!inStock.length) {
    grid.classList.remove('has-products');
    grid.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12"/></svg>
      <p>${t('noProducts')}</p>
    </div>`;
    return;
  }

  grid.classList.add('has-products');
  grid.innerHTML = `
    <div class="table-wrap pos-catalog-table-wrap">
      <table class="data-table pos-item-list">
        <thead>
          <tr>
            <th>${t('name')}</th>
            <th>${t('sku')}</th>
            <th>${t('category')}</th>
            <th>${t('stock')}</th>
            <th>${t('status')}</th>
            <th>${t('priceInfo')}</th>
            <th class="pos-list-action-col"></th>
          </tr>
        </thead>
        <tbody>
          ${inStock.map((item) => {
            const qty = availableQuantity(item);
            const displayItem = itemStockStatusForDisplay(item);
            return `
            <tr class="pos-item-row">
              <td class="pos-item-name-cell">
                <strong>${item.name}</strong>
                <span class="pos-item-meta">${item.karat}K · ${item.weightGrams}g${item.location ? ` · ${item.location}` : ''}</span>
              </td>
              <td>${item.sku}</td>
              <td>${categoryLabel(item.category)}</td>
              <td><span class="product-stock product-stock-inline">${qty}</span></td>
              <td>${itemStockStatusBadge(displayItem)}</td>
              <td class="pos-item-price">${formatMoney(itemMarketValue(item, goldRateCache))}</td>
              <td class="pos-list-action-col">
                <button type="button" class="product-cart-btn" data-pos-add-cart="${item.id}" title="${t('addToCart')}" aria-label="${t('addToCart')}">${cartIcon()}</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderInventoryTable() {
  const tableEl = document.getElementById('inventory-table');
  if (!tableEl) return;

  if (!itemsCache.length) {
    tableEl.innerHTML = `<table class="data-table">${inventoryTableHead()}<tbody><tr class="empty-row"><td colspan="10">${t('noResults')}</td></tr></tbody></table>`;
    return;
  }

  const goldRatePerTola = goldRateCache;
  tableEl.innerHTML = `<table class="data-table">${inventoryTableHead()}<tbody>
    ${itemsCache.map((i) => {
      const qty = availableQuantity(i);
      const displayItem = itemStockStatusForDisplay(i);
      return `<tr>
        <td><input type="checkbox" aria-label="Select row" /></td>
        <td class="name-cell">
          <strong>${i.name}</strong>
          <span class="row-actions">
            <button type="button" class="link-btn" data-edit="${i.id}">${t('edit')}</button>
            <button type="button" class="link-btn danger" data-delete="${i.id}">${t('delete')}</button>
          </span>
        </td>
        <td>${i.sku}</td><td>${categoryLabel(i.category)}</td>
        <td>${i.location || '—'}</td>
        <td>${i.weightGrams}</td><td>${i.karat}K</td><td>${qty}</td>
        <td>${itemStockStatusBadge(displayItem)}</td>
        <td>${formatMoney(itemMarketValue(i, goldRatePerTola))}</td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

function customItemPriceFromFields(form) {
  const weightGrams = Number(form.weightGrams.value);
  const karat = Number(form.karat.value);
  const makingCharge = parseMoneyField(form.makingCharge.value) || 0;
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
  return itemMarketValue({ weightGrams, karat, makingCharge }, goldRateCache);
}

function updateCustomItemPricePreview() {
  const form = document.getElementById('custom-item-form');
  const preview = document.getElementById('custom-item-price-preview');
  if (!form || !preview) return;
  const calculated = customItemPriceFromFields(form);
  preview.value = calculated != null ? formatMoney(calculated) : '—';
  const salePriceInput = form.salePrice;
  if (salePriceInput && !salePriceInput.value && calculated != null) {
    salePriceInput.placeholder = formatMoneyPlain(calculated);
  }
}

function renderCustomItemCustomerSuggestions() {
  const input = document.getElementById('custom-item-customer-search');
  const box = document.getElementById('custom-item-customer-suggestions');
  const form = document.getElementById('custom-item-form');
  if (!input || !box || !form) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const matches = localData('subarnapasal.customers', []).filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    form.customerName.value = input.value.trim();
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-custom-item-customer-pick="${c.id}">
      ${c.name}
      <span class="suggestion-meta">${c.phone || c.email || ''}</span>
    </button>`).join('');
}

function fillCustomItemCustomerFields(customer) {
  const form = document.getElementById('custom-item-form');
  const search = document.getElementById('custom-item-customer-search');
  const box = document.getElementById('custom-item-customer-suggestions');
  if (!form) return;
  form.customerName.value = customer.name || '';
  form.customerPhone.value = customer.phone || '';
  if (search) search.value = customer.name || '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

function openCustomItemModal() {
  if (!ensurePosCustomerName()) return;
  const form = document.getElementById('custom-item-form');
  const modal = document.getElementById('custom-item-modal');
  if (!form || !modal) return;
  form.reset();
  form.quantity.value = 1;
  form.makingCharge.value = 0;
  form.hallmark.checked = true;

  const currentName = getSaleCustomerName();
  const currentPhone = selectedCustomer?.phone || '';
  form.customerName.value = currentName;
  form.customerPhone.value = currentPhone;
  const search = document.getElementById('custom-item-customer-search');
  if (search) search.value = currentName;

  updateCustomItemPricePreview();
  modal.showModal();
}

function addCustomItemToCart(data) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  const itemName = String(data.name || '').trim();
  const qty = Math.max(1, Number(data.quantity) || 1);
  const calculated = itemMarketValue({
    weightGrams: Number(data.weightGrams),
    karat: Number(data.karat),
    makingCharge: parseMoneyField(data.makingCharge) || 0
  }, goldRateCache);
  const manualPrice = data.salePrice !== '' && data.salePrice != null
    ? parseMoneyField(data.salePrice)
    : null;
  const unitPrice = manualPrice != null && Number.isFinite(manualPrice) && manualPrice >= 0
    ? manualPrice
    : calculated;

  if (!itemName) {
    toast(t('customItemNameRequired'));
    return;
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    toast(t('customItemPriceRequired'));
    return;
  }

  const customerName = String(data.customerName || '').trim();
  const customerPhone = String(data.customerPhone || '').trim();
  if (customerName) {
    applyPosCustomer({ name: customerName, phone: customerPhone });
  }

  const sku = String(data.sku || '').trim() || `CUSTOM-${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const karat = Number(data.karat) || 22;
  const weightGrams = Number(data.weightGrams) || 0;

  posCart.push({
    itemId: `custom-${Date.now()}`,
    custom: true,
    sku,
    name: itemName,
    category: data.category || 'other',
    karat,
    weightGrams,
    location: String(data.location || '').trim(),
    notes: String(data.notes || '').trim(),
    hallmark: Boolean(data.hallmark),
    qty,
    price: unitPrice
  });
  renderCart();
  toast(t('customItemAdded'));
}

function addToCart(item) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  if (!ensurePosCustomerName()) return;
  if (!canAddItemToPosCart(item)) {
    toast(t('noStock'));
    return;
  }
  const existing = posCart.find((l) => l.itemId === item.id);
  if (existing) {
    existing.qty += 1;
  } else {
    posCart.push({
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      qty: 1,
      price: itemMarketValue(item, goldRateCache)
    });
  }
  renderCart();
}

function addOrderToCart(order) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  if (!order?.lines?.length) {
    toast(t('noItemsInOrder'));
    return;
  }

  for (const line of order.lines) {
    const item = itemsCache.find((i) => i.id === line.itemId)
      || orderItemsCache.find((i) => i.id === line.itemId)
      || posItemsCache.find((i) => i.id === line.itemId);
    const qty = Math.max(1, Number(line.quantity) || 1);
    if (item && cartQtyForItem(item.id) + qty > Number(item.quantity)) {
      toast(t('noStock'));
      return;
    }
    const price = Number(line.unitPrice)
      || (item ? itemMarketValue(item, goldRateCache) : 0);
    const existing = posCart.find((l) => l.itemId === line.itemId);

    if (existing) {
      existing.qty += qty;
      if (price) existing.price = price;
      if (!existing.name) existing.name = line.itemName || item?.name || existing.sku;
    } else {
      posCart.push({
        itemId: line.itemId,
        sku: line.sku || item?.sku || '—',
        name: line.itemName || item?.name || t('item'),
        qty,
        price
      });
    }
  }

  if (order.customerName) {
    applyPosCustomer({
      name: order.customerName,
      phone: order.customerPhone || ''
    });
  }

  renderCart();
  showView('pos');
  toast(t('orderAddedToCart'));
}

function renderCustomerSuggestions() {
  const input = document.getElementById('pos-customer-search');
  const box = document.getElementById('customer-suggestions');
  if (!input || !box) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const matches = localData('subarnapasal.customers', []).filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-customer-pick="${c.id}">
      ${c.name}
      <span class="suggestion-meta">${c.phone || c.email || ''}</span>
    </button>`).join('');
}

function selectPosCustomer(customer) {
  applyPosCustomer(customer);
}

function cartQtyForItem(itemId) {
  if (!itemId || String(itemId).startsWith('custom-')) return 0;
  return posCart
    .filter((line) => line.itemId === itemId && !line.custom)
    .reduce((sum, line) => sum + line.qty, 0);
}

function getItemFromCaches(itemId) {
  return itemsCache.find((i) => i.id === itemId)
    || posItemsCache.find((i) => i.id === itemId);
}

function availableQuantity(itemOrId) {
  const item = typeof itemOrId === 'string' ? getItemFromCaches(itemOrId) : itemOrId;
  if (!item) return 0;
  return Math.max(0, Number(item.quantity) - cartQtyForItem(item.id));
}

function mergeItemsIntoCache(items) {
  items.forEach((item) => {
    const idx = itemsCache.findIndex((i) => i.id === item.id);
    if (idx >= 0) itemsCache[idx] = { ...itemsCache[idx], ...item };
    else itemsCache.push(item);
  });
}

function canAddItemToPosCart(item) {
  return availableQuantity(item) > 0;
}

function itemStockStatusForDisplay(item) {
  return { ...item, quantity: availableQuantity(item) };
}

async function loadPOS() {
  const q = document.getElementById('pos-search')?.value.trim() || '';
  const category = document.getElementById('pos-filter-category')?.value || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);

  const payload = await api(`/api/items?${params}`);
  applyMetalRatesFromResponse(payload);
  const { items } = payload;
  mergeItemsIntoCache(items);
  posItemsCache = items.filter((item) => Number(item.quantity) > 0);

  renderPosCatalog();
}

function reportDateRange() {
  const start = document.getElementById('report-start')?.value || '';
  const end = document.getElementById('report-end')?.value || '';
  return { start, end };
}

function expensesInRange(start, end) {
  return localData('subarnapasal.expenses', []).filter((e) => {
    if (start && e.date < start) return false;
    if (end && e.date > end) return false;
    return true;
  });
}

function renderBarChart(rows, emptyText) {
  if (!rows.length) return `<p class="empty">${emptyText}</p>`;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="category-chart">${rows.map((row) => {
    const pct = Math.round((row.value / max) * 100);
    return `<div class="bar-row"><span>${row.label}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div><span>${row.display ?? row.value}</span></div>`;
  }).join('')}</div>`;
}

function renderReportTable(headers, rows, emptyText) {
  if (!rows.length) return `<p class="empty">${emptyText}</p>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr>
    ${headers.map((h) => `<th>${h}</th>`).join('')}
  </tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function updateReportSectionTitle() {
  const titleEl = document.getElementById('report-section-title');
  if (!titleEl) return;
  const key = reportTab === 'inventory'
    ? 'inventoryOverview'
    : reportTab === 'customer'
      ? 'customerOverview'
      : 'salesOverview';
  titleEl.textContent = t(key);
}

function renderSalesReport(report, expenseTotal, netProfit) {
  document.getElementById('stats-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalRevenue')}</span><strong>${formatMoney(report.sales.revenue)}</strong><span class="kpi-sub">${t('totalRevenueSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalOrdersKpi')}</span><strong>${report.sales.totalOrders}</strong><span class="kpi-sub">${t('totalOrdersSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalExpensesKpi')}</span><strong>${formatMoney(expenseTotal)}</strong><span class="kpi-sub">${t('totalExpensesSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('netProfit')}</span><strong class="${netProfit >= 0 ? 'profit' : 'loss'}">${formatMoney(netProfit)}</strong><span class="kpi-sub">${t('netProfitSub')}</span></div></div></div>`;

  const salesChart = renderBarChart(
    report.sales.salesByDay.map((row) => ({
      label: new Date(row.date).toLocaleDateString(),
      value: row.amount,
      display: formatMoney(row.amount)
    })),
    t('noSalesInPeriod')
  );

  const salesRows = report.sales.transactions.map((tx) => `<tr>
    <td>${new Date(tx.createdAt).toLocaleDateString()}</td>
    <td>${tx.itemName}</td>
    <td>${tx.quantity}</td>
    <td>${formatMoney(tx.amount)}</td>
    <td>${tx.note || '—'}</td>
  </tr>`);

  document.getElementById('report-body').innerHTML = `
    <div class="panel-grid">
      <article class="panel"><h2>${t('salesByDay')}</h2>${salesChart}</article>
      <article class="panel"><h2>${t('orderSummary')}</h2>
        <ul class="simple-list report-summary-list">
          <li><span>${t('completedOrdersKpi')}</span><strong>${report.sales.completedOrders}</strong></li>
          <li><span>${t('pendingOrders')}</span><strong>${report.sales.pendingOrders}</strong></li>
          <li><span>${t('orderRevenueKpi')}</span><strong>${formatMoney(report.sales.orderRevenue)}</strong></li>
        </ul>
      </article>
    </div>
    <article class="panel"><h2>${t('recentSales')}</h2>
      ${renderReportTable([t('date'), t('item'), t('qty'), t('amount'), t('note')], salesRows, t('noSalesInPeriod'))}
    </article>`;
}

function renderInventoryReport(report) {
  const inv = report.inventory;
  document.getElementById('stats-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalPieces')}</span><strong>${inv.totalItems}</strong><span class="kpi-sub">${t('inStock')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('uniqueSkus')}</span><strong>${inv.uniqueSkus}</strong><span class="kpi-sub">${t('uniqueSkus')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalWeight')}</span><strong>${inv.totalWeightGrams}g</strong><span class="kpi-sub">${inv.totalWeightTola} ${t('perTola')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('inventoryValue')}</span><strong>${formatMoney(inv.totalInventoryValue)}</strong><span class="kpi-sub">${t('atCurrentGoldRate')}</span></div></div></div>`;

  const categoryChart = renderBarChart(
    Object.entries(inv.categoryCounts).map(([cat, count]) => ({
      label: categoryLabel(cat),
      value: count
    })),
    t('noStock')
  );

  const lowStock = inv.lowStock.length
    ? inv.lowStock.map((i) => `<li><strong>${i.name}</strong> — ${i.quantity} ${t('left')} (${i.sku})</li>`).join('')
    : `<li class="empty">${t('allWellStocked')}</li>`;

  const movementRows = inv.movements.map((tx) => `<tr>
    <td>${new Date(tx.createdAt).toLocaleDateString()}</td>
    <td>${txTypeLabel(tx.type)}</td>
    <td>${tx.itemName}</td>
    <td>${tx.quantity}</td>
    <td>${tx.type === 'sale' ? `${formatMoney(tx.amount)}` : '—'}</td>
    <td>${tx.note || '—'}</td>
  </tr>`);

  document.getElementById('report-body').innerHTML = `
    <div class="panel-grid">
      <article class="panel"><h2>${t('stockByCategory')}</h2>${categoryChart}</article>
      <article class="panel"><h2>${t('lowStockAlerts')}</h2><ul class="simple-list">${lowStock}</ul></article>
    </div>
    <article class="panel"><h2>${t('recentActivity')}</h2>
      ${renderReportTable([t('date'), t('type'), t('item'), t('qty'), t('amount'), t('note')], movementRows, t('noTransactions'))}
    </article>`;
}

function renderCustomerReport(report) {
  const customers = localData('subarnapasal.customers', []);
  const merged = report.customers.topCustomers.map((row) => {
    const saved = customers.find((c) => c.name === row.name);
    return { ...row, email: saved?.email || '—', purchases: saved?.purchases || row.orders };
  });
  const avgOrder = merged.length
    ? Math.round(merged.reduce((sum, c) => sum + c.total, 0) / Math.max(merged.filter((c) => c.total > 0).length, 1))
    : 0;

  document.getElementById('stats-grid').innerHTML = `
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('totalCustomersKpi')}</span><strong>${Math.max(customers.length, merged.length)}</strong><span class="kpi-sub">${t('totalCustomersSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('activeBuyersKpi')}</span><strong>${report.customers.activeBuyers}</strong><span class="kpi-sub">${t('activeBuyersSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('avgOrderValue')}</span><strong>${formatMoney(avgOrder)}</strong><span class="kpi-sub">${t('avgOrderValueSub')}</span></div></div></div>
    <div class="kpi-card"><div class="kpi-card-head"><div><span class="label">${t('completedOrdersKpi')}</span><strong>${report.sales.completedOrders}</strong><span class="kpi-sub">${t('completedOrdersSub')}</span></div></div></div>`;

  const customerRows = merged.map((c) => `<tr>
    <td><strong>${c.name}</strong></td>
    <td>${c.phone || '—'}</td>
    <td>${c.email}</td>
    <td>${c.orders}</td>
    <td>${formatMoney(c.total)}</td>
  </tr>`);

  const orderRows = report.customers.recentOrders.map((o) => `<tr>
    <td>${o.orderNumber}</td>
    <td>${new Date(o.createdAt).toLocaleDateString()}</td>
    <td>${o.customerName}</td>
    <td>${orderStatusBadge(o.status)}</td>
    <td>${formatMoney(o.totalAmount)}</td>
  </tr>`);

  document.getElementById('report-body').innerHTML = `
    <article class="panel"><h2>${t('topCustomers')}</h2>
      ${renderReportTable([t('name'), t('customerPhone'), t('email'), t('totalOrdersKpi'), t('total')], customerRows, t('noCustomersInPeriod'))}
    </article>
    <article class="panel"><h2>${t('recentOrders')}</h2>
      ${renderReportTable([t('receiptNo'), t('orderDate'), t('customer'), t('status'), t('total')], orderRows, t('noOrdersInPeriod'))}
    </article>`;
}

function exportReportSummary() {
  if (!reportCache) return;
  const { start, end } = reportDateRange();
  const expenses = expensesInRange(start, end);
  const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netProfit = reportCache.sales.revenue - expenseTotal;
  const lines = [
    'Suvarnapasal Financial Summary',
    `Period,${start || 'All'},${end || 'All'}`,
    `Report Type,${reportTab}`,
    `Total Revenue (${currencyCode()}),${formatMoneyPlain(reportCache.sales.revenue)}`,
    `Total Expenses (${currencyCode()}),${formatMoneyPlain(expenseTotal)}`,
    `Net Profit (${currencyCode()}),${formatMoneyPlain(netProfit)}`,
    `Total Orders,${reportCache.sales.totalOrders}`,
    `Completed Orders,${reportCache.sales.completedOrders}`,
    `Inventory Value (${currencyCode()}),${formatMoneyPlain(reportCache.inventory.totalInventoryValue)}`,
    ''
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `suvarnapasal-report-${start || 'all'}-${end || 'all'}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast(t('reportExported'));
}

async function loadReports() {
  const { start, end } = reportDateRange();
  const params = new URLSearchParams();
  if (start) params.set('start', start);
  if (end) params.set('end', end);

  const report = await api(`/api/reports?${params}`);
  applyMetalRatesFromResponse(report);
  reportCache = report;
  const expenses = expensesInRange(start, end);
  const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const netProfit = report.sales.revenue - expenseTotal;

  await updateMetalRates({
    priceMode: settingsPriceMode,
    goldRatePerTola: goldRateCache,
    goldRatePerGram: Number((goldRateCache / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola: silverRateCache,
    silverRatePerGram: Number((silverRateCache / TOLA_GRAMS).toFixed(2))
  });

  updateReportSectionTitle();
  if (reportTab === 'inventory') renderInventoryReport(report);
  else if (reportTab === 'customer') renderCustomerReport(report);
  else renderSalesReport(report, expenseTotal, netProfit);
}

async function loadInventory() {
  const q = document.getElementById('search-items')?.value.trim() || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const payload = await api(`/api/items?${params}`);
  applyMetalRatesFromResponse(payload);
  itemsCache = payload.items;

  const countEl = document.getElementById('inventory-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, payload.items.length);

  renderInventoryTable();
}

function renderOrderRows(orders) {
  return orders.map((o) => `<tr>
    <td><input type="checkbox" aria-label="Select row" /></td>
    <td><strong>${o.orderNumber}</strong></td>
    <td>${new Date(o.createdAt).toLocaleDateString()}</td>
    <td>${orderDueDate(o).toLocaleDateString()}</td>
    <td>${o.customerName}</td>
    <td>${orderItemsSummary(o)}</td>
    <td>${formatMoney(o.totalAmount)}</td>
    <td>${orderStatusBadge(o.status)}</td>
    <td class="options-cell order-actions-cell">${orderActionButtons(o) || '—'}</td>
  </tr>`).join('');
}

function renderOrdersTable(orders) {
  if (!orders.length) return ordersEmptyTable();
  return `<div class="table-wrap"><table class="data-table">${ordersTableHead()}<tbody>${renderOrderRows(orders)}</tbody></table></div>`;
}

function ordersForActiveGroup() {
  const search = getOrdersSearchQuery();
  let list = ordersAllCache;
  if (search) list = filterOrdersBySearch(list, search);
  const statuses = ORDER_GROUPS.find((g) => g.id === orderGroup)?.statuses || [];
  return sortOrdersForDisplay(list.filter((o) => statuses.includes(o.status)));
}

function renderOrdersView() {
  const countEl = document.getElementById('orders-row-count');
  const contentEl = document.getElementById('orders-content');
  if (!contentEl) return;

  const search = getOrdersSearchQuery();
  const group = ORDER_GROUPS.find((g) => g.id === orderGroup) || ORDER_GROUPS[0];
  const filtered = ordersForActiveGroup();
  updateOrderGroupTabsUI();

  const headerTitle = search
    ? `${t('searchResults')} · ${t(group.labelKey)}`
    : t(group.labelKey);

  contentEl.innerHTML = `
    <header class="order-group-head order-group-head-single">
      <div class="order-group-title">
        <span class="order-group-dot order-group-dot-${group.id}"></span>
        <h3>${headerTitle}</h3>
      </div>
      <span class="order-group-count">${filtered.length}</span>
    </header>
    ${filtered.length ? renderOrdersTable(filtered) : ordersEmptyTable()}`;

  if (countEl) countEl.textContent = rowCountLabel(0, filtered.length);
}

function setOrderGroup(groupId) {
  orderGroup = groupId;
  renderOrdersView();
}

async function loadOrders() {
  const countEl = document.getElementById('orders-row-count');
  const contentEl = document.getElementById('orders-content');

  try {
    const [ordersPayload, itemsPayload] = await Promise.all([
      api('/api/orders'),
      api('/api/items')
    ]);
    ordersAllCache = ordersPayload.orders;
    orderItemsCache = itemsPayload.items.filter((i) => i.quantity > 0);
    applyMetalRatesFromResponse(ordersPayload);
    applyMetalRatesFromResponse(itemsPayload);

    const select = document.getElementById('order-item-select');
    if (select) populateOrderItemSelect();

    applyOrdersSearch();
  } catch (err) {
    ordersAllCache = [];
    if (countEl) countEl.textContent = rowCountLabel(0, 0);
    if (contentEl) contentEl.innerHTML = ordersEmptyTable();
    errorToast(t('errorTitle'), t('ordersLoadError'));
  }
}

function loadCustomers() {
  const search = document.getElementById('search-customers')?.value.trim().toLowerCase() || '';
  const filter = document.getElementById('filter-customers')?.value.trim().toLowerCase() || '';
  let customers = localData('subarnapasal.customers', []);
  customers = customers.filter((c) => {
    const hay = `${c.name} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (filter && !c.name.toLowerCase().includes(filter)) return false;
    return true;
  });
  const countEl = document.getElementById('customers-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, customers.length);
  document.getElementById('customers-table').innerHTML = customers.length
    ? `<table class="data-table"><thead><tr>
        <th><input type="checkbox" disabled /></th>
        <th>${t('name')}</th><th>${t('customerPhone')}</th><th>${t('email')}</th>
        <th>${t('address')}</th><th>${t('purchaseActivity')}</th><th></th>
      </tr></thead><tbody>
      ${customers.map((c) => `<tr>
        <td><input type="checkbox" /></td>
        <td><strong>${c.name}</strong></td>
        <td>${c.phone || '—'}</td><td>${c.email || '—'}</td><td>${c.address || '—'}</td>
        <td>${c.purchases || 0} ${t('sale').toLowerCase()}(s)</td>
        <td><button type="button" class="link-btn danger" data-customer-delete="${c.id}">${t('delete')}</button></td>
      </tr>`).join('')}
    </tbody></table>`
    : `<table class="data-table"><tbody><tr class="empty-row"><td colspan="7">${t('noResults')}</td></tr></tbody></table>`;
}

function loadExpenses() {
  const filter = document.getElementById('filter-expenses')?.value.trim().toLowerCase() || '';
  const start = document.getElementById('expense-start')?.value;
  const end = document.getElementById('expense-end')?.value;
  let expenses = localData('subarnapasal.expenses', []);
  expenses = expenses.filter((e) => {
    if (filter && !`${e.category} ${e.description}`.toLowerCase().includes(filter)) return false;
    if (start && e.date < start) return false;
    if (end && e.date > end) return false;
    return true;
  });
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  document.getElementById('expense-total').textContent = `${formatMoney(total)}`;
  const countEl = document.getElementById('expenses-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, expenses.length);
  document.getElementById('expenses-table').innerHTML = expenses.length
    ? `<table class="data-table"><thead><tr>
        <th>${t('date')}</th><th>${t('category')}</th><th>${t('description')}</th><th>${t('amount')}</th><th></th>
      </tr></thead><tbody>
      ${expenses.map((e) => `<tr>
        <td>${e.date}</td><td>${e.category}</td><td>${e.description}</td>
        <td>${formatMoney(Number(e.amount))}</td>
        <td><button type="button" class="link-btn danger" data-expense-delete="${e.id}">${t('delete')}</button></td>
      </tr>`).join('')}
    </tbody></table>`
    : `<table class="data-table"><tbody><tr class="empty-row"><td colspan="5">${t('noResults')}</td></tr></tbody></table>`;
}

function loadUsers() {
  const defaults = [
    { name: 'Admin User', email: 'admin@suvarnapasal.com', registeredAt: '2026-01-15', status: 'active', role: 'admin' },
    { name: 'Staff Member', email: 'staff@suvarnapasal.com', registeredAt: '2026-03-20', status: 'pending', role: 'staff' }
  ];
  const search = document.getElementById('search-users')?.value.trim().toLowerCase() || '';
  const filter = document.getElementById('filter-users')?.value.trim().toLowerCase() || '';
  let users = localData('subarnapasal.users', defaults);
  users = users.filter((u) => {
    const hay = `${u.name} ${u.email}`.toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (filter && !u.name.toLowerCase().includes(filter)) return false;
    return true;
  });
  const countEl = document.getElementById('users-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, users.length);
  document.getElementById('users-table').innerHTML = users.length
    ? `<table class="data-table"><thead><tr>
        <th><input type="checkbox" disabled /></th>
        <th>${t('name')}</th><th>${t('email')}</th><th>${t('registrationDate')}</th>
        <th>${t('status')}</th><th>${t('adminRole')}</th>
      </tr></thead><tbody>
      ${users.map((u) => `<tr>
        <td><input type="checkbox" /></td>
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td>${new Date(u.registeredAt).toLocaleDateString()}</td>
        <td><span class="badge ${u.status === 'active' ? 'order-ready' : 'order-pending'}">${u.status === 'active' ? t('active') : t('pending')}</span></td>
        <td>${u.role === 'admin' ? t('admin') : t('staff')}</td>
      </tr>`).join('')}
    </tbody></table>`
    : `<table class="data-table"><tbody><tr class="empty-row"><td colspan="6">${t('noResults')}</td></tr></tbody></table>`;
}

function updateOrderTotalPreview() {
  const form = document.getElementById('order-form');
  if (!form) return;
  const item = orderItemsCache.find((i) => i.id === form.itemId.value);
  const totalEl = document.getElementById('order-total-preview');
  if (!item || !totalEl) { if (totalEl) totalEl.value = ''; return; }
  totalEl.value = formatMoney(itemMarketValue(item, goldRateCache) * (Number(form.quantity.value) || 1));
}

async function updateOrderStatus(orderId, status) {
  await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  toast(t('orderUpdated'));
}

function openItemModal(item) {
  editingId = item?.id || null;
  document.getElementById('modal-title').textContent = item ? t('editItemTitle') : t('addItemTitle');
  const form = document.getElementById('item-form');
  form.reset();
  if (item) {
    Object.entries(item).forEach(([k, v]) => {
      const field = form.elements[k];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = Boolean(v);
      else if (['makingCharge', 'purchaseCost'].includes(k)) field.value = formatMoneyField(v);
      else field.value = v;
    });
  }
  document.getElementById('item-modal').showModal();
}

function nextBillNumber() {
  return `BILL-${Date.now().toString().slice(-8)}`;
}

function getBillOptions() {
  return {
    showSign: document.getElementById('bill-show-sign')?.checked !== false,
    showStamp: document.getElementById('bill-show-stamp')?.checked !== false,
    signatoryName: document.getElementById('bill-signatory-name')?.value.trim()
      || settingsCache.shopName
      || 'Suvarnapasal'
  };
}

function billSignatureBlock(options) {
  if (!options.showSign) return '';
  return `
    <div class="bill-signatures">
      <div class="bill-sign-block">
        <div class="bill-sign-line">
          <svg class="bill-sign-scribble" viewBox="0 0 120 36" aria-hidden="true">
            <path d="M4 28 C18 8, 34 32, 48 18 S 78 6, 96 22 S 108 30, 116 14" fill="none" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </div>
        <span class="bill-sign-label">${t('customerSignature')}</span>
      </div>
      <div class="bill-sign-block">
        <div class="bill-sign-line">
          <span class="bill-sign-name">${options.signatoryName}</span>
        </div>
        <span class="bill-sign-label">${t('authorizedSignatory')}</span>
      </div>
    </div>`;
}

function billStampBlock(options) {
  if (!options.showStamp) return '';
  const shopShort = (options.signatoryName || 'SP').split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return `
    <div class="bill-stamp" aria-hidden="true">
      <div class="bill-stamp-ring">
        <span class="bill-stamp-top">${shopShort}</span>
        <strong class="bill-stamp-center">${t('billStampPaid')}</strong>
        <span class="bill-stamp-bottom">${new Date().getFullYear()}</span>
      </div>
    </div>`;
}

function buildBillHtml(sale, options = getBillOptions()) {
  const lineRows = sale.lines.map((line, i) => {
    const meta = [line.sku, line.karat ? `${line.karat}K` : '', line.weightGrams ? `${line.weightGrams}g` : '']
      .filter(Boolean)
      .join(' · ');
    return `<tr>
      <td class="bill-num">${i + 1}</td>
      <td>
        <strong class="bill-item-name">${cartLineName(line)}</strong>
        ${meta ? `<span class="bill-line-meta">${meta}</span>` : ''}
      </td>
      <td>${line.qty}</td>
      <td>${formatMoney(line.price)}</td>
      <td>${formatMoney(line.price * line.qty)}</td>
    </tr>`;
  }).join('');

  return `
    <article class="bill-receipt bill-receipt-premium">
      <div class="bill-frame">
        <div class="bill-corner bill-corner-tl"></div>
        <div class="bill-corner bill-corner-tr"></div>
        <div class="bill-corner bill-corner-bl"></div>
        <div class="bill-corner bill-corner-br"></div>

        <header class="bill-header">
          <div class="bill-logo-wrap">
            ${shopLogoHtml('bill-logo')}
          </div>
          <div class="bill-shop">
            <strong>${sale.shopName}</strong>
            ${sale.shopAddress ? `<p>${sale.shopAddress}</p>` : ''}
            ${sale.shopPhone ? `<p>${sale.shopPhone}</p>` : ''}
          </div>
          <p class="bill-receipt-type">${t('saleReceipt')}</p>
        </header>

        <div class="bill-meta-grid">
          <div class="bill-meta-cell">
            <span class="bill-label">${t('receiptNo')}</span>
            <strong>${sale.billNumber}</strong>
          </div>
          <div class="bill-meta-cell">
            <span class="bill-label">${t('date')}</span>
            <strong>${sale.date}</strong>
          </div>
          <div class="bill-meta-cell bill-meta-wide">
            <span class="bill-label">${t('customer')}</span>
            <strong>${sale.customer}</strong>
            ${sale.customerPhone ? `<span class="bill-meta-sub">${sale.customerPhone}</span>` : ''}
          </div>
        </div>

        <div class="bill-table-wrap">
          <table class="bill-table bill-table-premium">
            <thead>
              <tr>
                <th>#</th>
                <th>${t('name')}</th>
                <th>${t('qty')}</th>
                <th>${t('unitPrice')}</th>
                <th>${t('total')}</th>
              </tr>
            </thead>
            <tbody>${lineRows}</tbody>
          </table>
        </div>

        <div class="bill-footer-row">
          <div class="bill-totals bill-totals-premium">
            <div class="bill-total-line"><span>${t('subtotal')}</span><span>${formatMoney(sale.subtotal)}</span></div>
            ${sale.discount > 0 ? `<div class="bill-total-line bill-discount-line"><span>${t('discount')}</span><span>- ${formatMoney(sale.discount)}</span></div>` : ''}
            ${sale.taxAmount > 0 ? `<div class="bill-total-line"><span>${sale.taxLabel}</span><span>${formatMoney(sale.taxAmount)}</span></div>` : ''}
            <div class="bill-total-line bill-grand-total"><span>${t('total')}</span><strong>${formatMoney(sale.total)}</strong></div>
          </div>
          ${billStampBlock(options)}
        </div>

        ${billSignatureBlock(options)}

        <p class="bill-thanks">${t('thankYou')}</p>
        <p class="bill-footer-note">${t('saleReceipt')} · ${sale.billNumber}</p>
      </div>
    </article>`;
}

function renderSaleBill(sale) {
  lastSaleBill = sale;
  const modal = document.getElementById('bill-modal');
  const content = document.getElementById('bill-content');
  if (!modal || !content) return;
  const signatory = document.getElementById('bill-signatory-name');
  if (signatory && !signatory.value) signatory.value = sale.shopName || settingsCache.shopName || '';
  content.innerHTML = buildBillHtml(sale, getBillOptions());
  modal.showModal();
}

function refreshBillPreview() {
  if (!lastSaleBill) return;
  const content = document.getElementById('bill-content');
  if (content) content.innerHTML = buildBillHtml(lastSaleBill, getBillOptions());
}

async function checkoutSale() {
  try { await requireSignedIn(); } catch (err) { toast(err.message); return; }
  if (!posCart.length) return;
  if (!ensurePosCustomerName()) return;
  const customer = getSaleCustomerName();
  const customerPhone = getSaleCustomerPhone();
  const cartSnapshot = posCart.map((line) => ({ ...line }));
  const totals = getSaleTotals();

  for (const line of cartSnapshot) {
    if (line.custom) {
      await api('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'sale',
          customItem: true,
          itemName: line.name,
          quantity: line.qty,
          amount: line.price * line.qty,
          note: `POS — ${customer} · ${line.sku || 'CUSTOM'}${line.karat ? ` · ${line.karat}K` : ''}${line.weightGrams ? ` · ${line.weightGrams}g` : ''}${line.notes ? ` · ${line.notes}` : ''}`
        })
      });
    } else {
      await api('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'sale',
          itemId: line.itemId,
          quantity: line.qty,
          note: `POS — ${customer}`
        })
      });
    }
  }

  const sale = {
    billNumber: nextBillNumber(),
    date: new Date().toLocaleString(),
    customer,
    customerPhone,
    lines: cartSnapshot,
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxType: totals.taxType,
    taxValue: totals.taxValue,
    taxAmount: totals.taxAmount,
    taxLabel: totals.taxLabel,
    total: totals.total,
    shopName: settingsCache.shopName,
    shopAddress: settingsCache.shopAddress,
    shopPhone: settingsCache.shopPhone
  };

  posCart = [];
  resetSaleTaxAndDiscount();
  renderCart();
  renderSaleBill(sale);
}

async function refreshAll() {
  if (typeof getAuthAccessToken === 'function' && !(await getAuthAccessToken())) {
    return;
  }
  applyStaticI18n();
  showView(activeView);
  await loadSettings();
  refreshCurrencyLabels();
  await loadPOS();
  await loadInventory();
  await loadOrders();
  await loadReports();
  loadCustomers();
  loadExpenses();
  if (typeof isAdminUser === 'function' && isAdminUser()) loadUsers();
  updateTaxInputUi();
  renderCart();
}

function populateOrderItemSelect() {
  const select = document.getElementById('order-item-select');
  const submitBtn = document.getElementById('order-submit-btn');
  if (!select) return;
  select.innerHTML = orderItemsCache.length
    ? orderItemsCache.map((i) => {
      const price = formatMoney(itemMarketValue(i, goldRateCache));
      return `<option value="${i.id}">${i.sku} — ${i.name} · ${price} (${i.quantity} ${t('inStockCount')})</option>`;
    }).join('')
    : `<option value="">${t('noStock')}</option>`;
  select.disabled = !orderItemsCache.length;
  if (submitBtn) submitBtn.disabled = !orderItemsCache.length;
  updateOrderTotalPreview();
}

function renderOrderCustomerSuggestions() {
  const input = document.getElementById('order-customer-search');
  const box = document.getElementById('order-customer-suggestions');
  const form = document.getElementById('order-form');
  if (!input || !box || !form) return;
  const q = input.value.trim().toLowerCase();
  if (!q) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const matches = localData('subarnapasal.customers', []).filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    form.customerName.value = input.value.trim();
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-order-customer-pick="${c.id}">
      ${c.name}
      <span class="suggestion-meta">${c.phone || c.email || ''}</span>
    </button>`).join('');
}

function fillOrderCustomerFields(customer) {
  const form = document.getElementById('order-form');
  const search = document.getElementById('order-customer-search');
  const box = document.getElementById('order-customer-suggestions');
  if (!form) return;
  form.customerName.value = customer.name || '';
  form.customerPhone.value = customer.phone || '';
  if (search) search.value = customer.name || '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
}

async function openOrderModal() {
  const form = document.getElementById('order-form');
  const modal = document.getElementById('order-modal');
  if (!form || !modal) return;
  form.reset();
  form.quantity.value = 1;
  const search = document.getElementById('order-customer-search');
  if (search) search.value = '';

  if (!orderItemsCache.length) {
    try {
      const payload = await api('/api/items?status=in_stock');
      orderItemsCache = payload.items.filter((i) => i.quantity > 0);
      applyMetalRatesFromResponse(payload);
    } catch (_) { /* ignore */ }
  }
  populateOrderItemSelect();
  modal.showModal();
}

function openCustomerModal() {
  document.getElementById('customer-form').reset();
  document.getElementById('customer-modal').showModal();
}

function initDateDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const start = monthAgo.toISOString().slice(0, 10);
  ['report-start', 'expense-start'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = start;
  });
  ['report-end', 'expense-end'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
  const expenseDate = document.querySelector('#expense-form [name="date"]');
  if (expenseDate && !expenseDate.value) expenseDate.value = today;
}

function changeLanguage(lang) {
  setLanguage(lang);
  refreshAll().then(() => toast(t('languageSaved'))).catch((err) => toast(err.message));
}

document.querySelectorAll('.nav-btn, .settings-nav-btn, .rate-edit').forEach((btn) => {
  btn.addEventListener('click', () => { if (btn.dataset.view) showView(btn.dataset.view); });
});

document.getElementById('add-item-btn')?.addEventListener('click', () => openItemModal(null));
document.getElementById('refresh-inventory')?.addEventListener('click', () => loadInventory().catch((e) => toast(e.message)));
document.getElementById('add-order-btn')?.addEventListener('click', () => openOrderModal().catch(() => {}));
document.getElementById('refresh-orders')?.addEventListener('click', () => loadOrders().catch((e) => toast(e.message)));
document.getElementById('order-add-customer')?.addEventListener('click', openCustomerModal);
document.getElementById('order-customer-search')?.addEventListener('input', renderOrderCustomerSuggestions);
document.getElementById('order-customer-search')?.addEventListener('focus', renderOrderCustomerSuggestions);
document.getElementById('order-customer-suggestions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-order-customer-pick]');
  if (!btn) return;
  const customer = localData('subarnapasal.customers', []).find((c) => c.id === btn.dataset.orderCustomerPick);
  if (customer) fillOrderCustomerFields(customer);
});
document.getElementById('order-form')?.addEventListener('input', (e) => {
  if (e.target.name === 'customerName') {
    const search = document.getElementById('order-customer-search');
    if (search) search.value = e.target.value;
  }
});
document.getElementById('refresh-reports')?.addEventListener('click', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('export-report-btn')?.addEventListener('click', exportReportSummary);
document.getElementById('report-start')?.addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('report-end')?.addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('refresh-customers')?.addEventListener('click', loadCustomers);
document.getElementById('add-customer-page-btn')?.addEventListener('click', openCustomerModal);
document.getElementById('add-customer-btn')?.addEventListener('click', openCustomerModal);
document.getElementById('add-custom-item')?.addEventListener('click', openCustomItemModal);
document.getElementById('close-custom-item-modal')?.addEventListener('click', () => document.getElementById('custom-item-modal')?.close());
document.getElementById('cancel-custom-item-modal')?.addEventListener('click', () => document.getElementById('custom-item-modal')?.close());
document.getElementById('custom-item-add-customer')?.addEventListener('click', openCustomerModal);
document.getElementById('custom-item-customer-search')?.addEventListener('input', renderCustomItemCustomerSuggestions);
document.getElementById('custom-item-customer-search')?.addEventListener('focus', renderCustomItemCustomerSuggestions);
document.getElementById('custom-item-customer-suggestions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-custom-item-customer-pick]');
  if (!btn) return;
  const customer = localData('subarnapasal.customers', []).find((c) => c.id === btn.dataset.customItemCustomerPick);
  if (customer) fillCustomItemCustomerFields(customer);
});
document.getElementById('custom-item-form')?.addEventListener('input', (e) => {
  if (['weightGrams', 'karat', 'makingCharge'].includes(e.target.name)) {
    updateCustomItemPricePreview();
  }
  if (e.target.name === 'customerName') {
    const search = document.getElementById('custom-item-customer-search');
    if (search) search.value = e.target.value;
  }
});
document.getElementById('custom-item-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  addCustomItemToCart({
    customerName: fd.get('customerName'),
    customerPhone: fd.get('customerPhone'),
    sku: fd.get('sku'),
    category: fd.get('category'),
    name: fd.get('name'),
    karat: fd.get('karat'),
    weightGrams: fd.get('weightGrams'),
    makingCharge: fd.get('makingCharge'),
    purchaseCost: fd.get('purchaseCost'),
    quantity: fd.get('quantity'),
    location: fd.get('location'),
    hallmark: fd.get('hallmark') === 'on',
    notes: fd.get('notes'),
    salePrice: fd.get('salePrice')
  });
  document.getElementById('custom-item-modal')?.close();
});
document.getElementById('refresh-expenses')?.addEventListener('click', loadExpenses);
document.getElementById('refresh-users')?.addEventListener('click', loadUsers);

document.getElementById('close-order-modal')?.addEventListener('click', () => document.getElementById('order-modal').close());
document.getElementById('cancel-order-modal')?.addEventListener('click', () => document.getElementById('order-modal').close());
document.getElementById('close-customer-modal')?.addEventListener('click', () => document.getElementById('customer-modal').close());
document.getElementById('cancel-customer-modal')?.addEventListener('click', () => document.getElementById('customer-modal').close());
document.getElementById('close-modal')?.addEventListener('click', () => document.getElementById('item-modal').close());
document.getElementById('cancel-modal')?.addEventListener('click', () => document.getElementById('item-modal').close());

document.getElementById('item-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  body.hallmark = fd.get('hallmark') === 'on';
  body.karat = Number(body.karat);
  body.weightGrams = Number(body.weightGrams);
  body.makingCharge = parseMoneyField(body.makingCharge || 0);
  body.purchaseCost = parseMoneyField(body.purchaseCost || 0);
  body.quantity = Number(body.quantity);
  try {
    if (editingId) {
      await api(`/api/items/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast(t('itemUpdated'));
    } else {
      await api('/api/items', { method: 'POST', body: JSON.stringify(body) });
      toast(t('itemAdded'));
    }
    document.getElementById('item-modal').close();
  } catch (err) { toast(err.message); }
});

document.getElementById('inventory-table')?.addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  if (editId) {
    const item = itemsCache.find((i) => i.id === editId);
    if (item) openItemModal(item);
  }
  if (deleteId && confirm(t('deleteConfirm'))) {
    try {
      await api(`/api/items/${deleteId}`, { method: 'DELETE' });
      toast(t('itemDeleted'));
    } catch (err) { toast(err.message); }
  }
});

document.getElementById('search-items')?.addEventListener('input', () => loadInventory());
document.getElementById('search-orders')?.addEventListener('input', applyOrdersSearch);
document.getElementById('order-group-tabs')?.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-order-group]');
  if (!tab) return;
  setOrderGroup(tab.dataset.orderGroup);
});
document.getElementById('search-customers')?.addEventListener('input', loadCustomers);
document.getElementById('filter-customers')?.addEventListener('input', loadCustomers);
document.getElementById('filter-expenses')?.addEventListener('input', loadExpenses);
document.getElementById('expense-start')?.addEventListener('change', loadExpenses);
document.getElementById('expense-end')?.addEventListener('change', loadExpenses);
document.getElementById('search-users')?.addEventListener('input', loadUsers);
document.getElementById('filter-users')?.addEventListener('input', loadUsers);

document.querySelectorAll('.report-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    reportTab = tab.dataset.tab;
    document.querySelectorAll('.report-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
    if (reportCache) {
      updateReportSectionTitle();
      const { start, end } = reportDateRange();
      const expenses = expensesInRange(start, end);
      const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const netProfit = reportCache.sales.revenue - expenseTotal;
      if (reportTab === 'inventory') renderInventoryReport(reportCache);
      else if (reportTab === 'customer') renderCustomerReport(reportCache);
      else renderSalesReport(reportCache, expenseTotal, netProfit);
      return;
    }
    loadReports().catch((e) => toast(e.message));
  });
});
document.getElementById('pos-customer-search')?.addEventListener('input', () => {
  renderCustomerSuggestions();
});
document.getElementById('pos-customer-search')?.addEventListener('focus', renderCustomerSuggestions);
document.getElementById('pos-customer-name')?.addEventListener('input', () => {
  if (getSaleCustomerName()) clearPosCustomerNameError();
  selectedCustomer = {
    name: getSaleCustomerName(),
    phone: getSaleCustomerPhone()
  };
  renderSaleCustomer();
});
document.getElementById('pos-customer-phone')?.addEventListener('input', () => {
  if (selectedCustomer) selectedCustomer.phone = getSaleCustomerPhone();
  renderSaleCustomer();
});
document.getElementById('customer-suggestions')?.addEventListener('click', (e) => {
  const id = e.target.closest('[data-customer-pick]')?.dataset.customerPick;
  if (!id) return;
  const customer = localData('subarnapasal.customers', []).find((c) => c.id === id);
  if (customer) selectPosCustomer(customer);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-field')) {
    const box = document.getElementById('customer-suggestions');
    if (box) box.hidden = true;
  }
});
document.getElementById('pos-theme-toggle')?.addEventListener('click', () => toast(t('comingSoon')));
document.getElementById('inv-theme-toggle')?.addEventListener('click', () => toast(t('comingSoon')));
document.getElementById('pos-search')?.addEventListener('input', () => loadPOS());
document.getElementById('pos-filter-category')?.addEventListener('change', () => loadPOS());
document.getElementById('pos-sort')?.addEventListener('change', () => {
  renderPosCatalog();
});

document.getElementById('pos-product-grid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-pos-add-cart]');
  if (!btn) return;
  const item = posItemsCache.find((i) => i.id === btn.dataset.posAddCart);
  if (item) addToCart(item);
});

document.getElementById('cart-lines')?.addEventListener('click', (e) => {
  const idx = e.target.dataset.cartRemove;
  if (idx == null) return;
  posCart.splice(Number(idx), 1);
  renderCart();
});

document.getElementById('cart-discount')?.addEventListener('input', renderCart);
document.getElementById('cart-tax-type')?.addEventListener('change', () => {
  updateTaxInputUi();
  renderCart();
});
document.getElementById('cart-tax-value')?.addEventListener('input', renderCart);
document.getElementById('cancel-sale')?.addEventListener('click', () => {
  posCart = [];
  resetSaleTaxAndDiscount();
  renderCart();
});
document.getElementById('checkout-btn')?.addEventListener('click', () => checkoutSale().catch((e) => toast(e.message)));
document.getElementById('close-bill-modal')?.addEventListener('click', () => document.getElementById('bill-modal')?.close());
document.getElementById('bill-done-btn')?.addEventListener('click', () => document.getElementById('bill-modal')?.close());
document.getElementById('print-bill-btn')?.addEventListener('click', () => window.print());
['bill-show-sign', 'bill-show-stamp'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshBillPreview);
});
document.getElementById('bill-signatory-name')?.addEventListener('input', refreshBillPreview);

document.getElementById('order-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/orders', { method: 'POST', body: JSON.stringify(Object.fromEntries(fd.entries())) });
    toast(t('orderCreated'));
    document.getElementById('order-modal').close();
    e.target.reset();
    e.target.quantity.value = 1;
    orderGroup = 'progress';
    setOrderGroup('progress');
  } catch (err) { toast(err.message); }
});

document.getElementById('customer-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const customers = localData('subarnapasal.customers', []);
  customers.unshift({
    id: `c-${Date.now()}`,
    name: fd.get('name'),
    phone: fd.get('phone'),
    email: fd.get('email'),
    address: fd.get('address'),
    purchases: 0
  });
  saveLocalData('subarnapasal.customers', customers);
  document.getElementById('customer-modal').close();
  toast(t('customerSaved'));
  selectPosCustomer(customers[0]);
  if (document.getElementById('custom-item-modal')?.open) {
    fillCustomItemCustomerFields(customers[0]);
  }
  if (document.getElementById('order-modal')?.open) {
    fillOrderCustomerFields(customers[0]);
  }
  scheduleRefresh();
});

document.getElementById('expense-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const expenses = localData('subarnapasal.expenses', []);
  expenses.unshift({
    id: `e-${Date.now()}`,
    date: fd.get('date'),
    category: fd.get('category'),
    description: fd.get('description'),
    amount: parseMoneyField(fd.get('amount'))
  });
  saveLocalData('subarnapasal.expenses', expenses);
  e.target.reset();
  initDateDefaults();
  toast(t('expenseSaved'));
  scheduleRefresh();
});

document.getElementById('customers-table')?.addEventListener('click', (e) => {
  const id = e.target.dataset.customerDelete;
  if (!id) return;
  const customers = localData('subarnapasal.customers', []).filter((c) => c.id !== id);
  saveLocalData('subarnapasal.customers', customers);
  scheduleRefresh();
});

document.getElementById('expenses-table')?.addEventListener('click', (e) => {
  const id = e.target.dataset.expenseDelete;
  if (!id) return;
  const expenses = localData('subarnapasal.expenses', []).filter((e) => e.id !== id);
  saveLocalData('subarnapasal.expenses', expenses);
  scheduleRefresh();
});

document.getElementById('orders-content')?.addEventListener('click', async (e) => {
  const cartBtn = e.target.closest('[data-order-cart]');
  if (cartBtn) {
    const order = ordersAllCache.find((o) => o.id === cartBtn.dataset.orderCart);
    if (order) addOrderToCart(order);
    return;
  }
  const actionBtn = e.target.closest('[data-order-action]');
  const deleteBtn = e.target.closest('[data-order-delete]');
  if (actionBtn?.dataset.orderId && actionBtn.dataset.orderAction) {
    if (actionBtn.dataset.orderRevert === 'completed' && !confirm(t('orderStatusRevertConfirm'))) return;
    try { await updateOrderStatus(actionBtn.dataset.orderId, actionBtn.dataset.orderAction); } catch (err) { toast(err.message); }
  }
  if (deleteBtn?.dataset.orderDelete && confirm(t('deleteOrderConfirm'))) {
    try {
      await api(`/api/orders/${deleteBtn.dataset.orderDelete}`, { method: 'DELETE' });
      toast(t('orderDeleted'));
    } catch (err) { toast(err.message); }
  }
});

document.getElementById('settings-store-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        shopName: fd.get('shopName'),
        shopAddress: fd.get('shopAddress'),
        shopPhone: fd.get('shopPhone')
      })
    });
    toast(t('settingsSaved'));
  } catch (err) { toast(err.message); }
});

document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        goldRatePerTola: parseTolaFromGramInput(fd.get('goldRatePerGram')),
        silverRatePerTola: parseTolaFromGramInput(fd.get('silverRatePerGram') || 0),
        priceMode: fd.get('priceMode')
      })
    });
    toast(t('settingsSaved'));
  } catch (err) { toast(err.message); }
});

document.querySelector('#settings-form [name="goldRatePerGram"]')?.addEventListener('input', () => {
  updateMetalRatePreviews();
});

document.querySelector('#settings-form [name="silverRatePerGram"]')?.addEventListener('input', () => {
  updateMetalRatePreviews();
});

document.getElementById('language-select')?.addEventListener('change', (e) => {
  changeLanguage(e.target.value);
});

document.getElementById('currency-select')?.addEventListener('change', async (e) => {
  setDisplayCurrency(e.target.value);
  try {
    await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ currency: displayCurrency })
    });
    settingsCache.currency = displayCurrency;
    await refreshAfterCurrencyChange();
  } catch (err) {
    toast(err.message);
    await loadSettings();
  }
});

document.getElementById('order-item-select')?.addEventListener('change', updateOrderTotalPreview);
document.querySelector('#order-form [name="quantity"]')?.addEventListener('input', updateOrderTotalPreview);

document.getElementById('view-settings')?.addEventListener('click', (e) => {
  if (e.target.closest('#add-location-btn')) {
    e.preventDefault();
    const input = document.getElementById('new-location-input');
    addStoreLocation(input?.value).catch((err) => toast(err.message));
    return;
  }
  const removeBtn = e.target.closest('[data-remove-location]');
  if (removeBtn) {
    e.preventDefault();
    removeStoreLocation(removeBtn.dataset.removeLocation).catch((err) => toast(err.message));
  }
});

document.getElementById('new-location-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addStoreLocation(e.target.value).catch((err) => toast(err.message));
  }
});

document.getElementById('theme-toggle')?.addEventListener('click', () => toast(t('comingSoon')));

async function initApp() {
  initDateDefaults();
  setLanguage(currentLang);
  if (typeof waitForAuthReady === 'function') await waitForAuthReady();
  if (typeof getAuthAccessToken === 'function' && !(await getAuthAccessToken())) {
    if (typeof revealAppShell === 'function') revealAppShell();
    if (typeof redirectToLogin === 'function') redirectToLogin();
    return;
  }
  try {
    await refreshAll();
  } finally {
    if (typeof revealAppShell === 'function') revealAppShell();
  }
}

initApp().catch((err) => toast(err.message));
