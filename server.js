require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const {
  readStore,
  writeStore,
  dataSourceLabel,
  ensureUserSettings,
  isShopNameTaken,
  normalizeShopName,
  LOCAL_DEV_USER_ID
} = require('./lib/store');
const {
  readSharedRates,
  appendSharedTick,
  appendSharedTicks,
  appendSharedHistory,
  getSharedRatesForClient,
  clearSharedRates
} = require('./lib/shared-rates');
const { getSupabase, checkSupabaseConnection } = require('./lib/supabase');
const {
  normalizeUsername,
  usernameToEmail,
  isSyntheticAuthEmail,
  isValidUsername,
  isValidPhone,
  isValidEmail,
  isValidPassword,
  isAuthConfigured,
  getAnonAuthClient,
  findUserByUsername,
  resolveAuthEmail,
  getUserIdFromToken,
  displayNameFromUser,
  lookupDisplayNameFromDb
} = require('./lib/auth');
const { getLiveMetalRates, isMetalApiConfigured, normalizeMetalCurrency } = require('./lib/metal-rates');
const { captureSharedGoldRateIfChanged, recordSharedApiGoldReading, displayToNpr, localDateStr } = require('./lib/capture-shared-gold-rate');

const CRON_CAPTURE_PATH = '/api/cron/capture-gold-rate';

function isCronAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (!secret) return false;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${secret}`) return true;
  return String(req.headers['x-cron-secret'] || '') === secret;
}

const app = express();
const PORT = process.env.PORT || 3002;
const TOLA_GRAMS = 11.66;
const AANA_PER_TOLA = 16;
const LAAL_PER_AANA = 6.25;
const LAAL_PER_TOLA = AANA_PER_TOLA * LAAL_PER_AANA;
const DISPLAY_CURRENCY_NPR_PER_UNIT = { USD: 133, CAD: 98 };
const PUBLIC_API_PATHS = new Set([
  '/api/health',
  '/api/auth/config',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password'
]);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

async function attachUser(req, res, next) {
  if (req.path === CRON_CAPTURE_PATH && isCronAuthorized(req)) {
    req.isCron = true;
    return next();
  }

  if (!req.path.startsWith('/api/') || PUBLIC_API_PATHS.has(req.path)) {
    return next();
  }

  if (isAuthConfigured()) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const userId = await getUserIdFromToken(token);
    if (!userId) {
      return res.status(401).json({ error: 'Sign in required.' });
    }
    req.userId = userId;
    return next();
  }

  req.userId = LOCAL_DEV_USER_ID;
  return next();
}

app.use(attachUser);

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.message || 'Internal server error.' });
    });
  };
}

function silverRatePerTolaFromSettings(settings) {
  if (settings.silverRatePerTola != null && Number(settings.silverRatePerTola) > 0) {
    return Number(settings.silverRatePerTola);
  }
  const perGram = Number(settings.silverRatePerGram) || 0;
  return perGram > 0 ? Number((perGram * TOLA_GRAMS).toFixed(2)) : 0;
}

function normalizeSilverRates(settings) {
  const silverRatePerTola = silverRatePerTolaFromSettings(settings);
  settings.silverRatePerTola = silverRatePerTola;
  settings.silverRatePerGram = Number((silverRatePerTola / TOLA_GRAMS).toFixed(2));
  return settings;
}

function getStoreLocations(store) {
  if (Array.isArray(store.settings.locations) && store.settings.locations.length) {
    return store.settings.locations.map((l) => String(l).trim()).filter(Boolean);
  }
  const fromItems = [...new Set(store.items.map((i) => i.location).filter(Boolean))];
  if (fromItems.length) return fromItems;
  return ['Desk A', 'Desk B', 'Side Desk'];
}

const DEFAULT_ITEM_CATEGORIES = ['Ring', 'Necklace', 'Bangle', 'Earring', 'Coin', 'Bar', 'Other'];

function normalizeItemCategories(list) {
  const items = [...new Set(
    (Array.isArray(list) ? list : []).map((c) => String(c).trim()).filter(Boolean)
  )];
  if (!items.some((c) => c.toLowerCase() === 'other')) items.push('Other');
  return items;
}

function getStoreItemCategories(store) {
  if (Array.isArray(store.settings.itemCategories) && store.settings.itemCategories.length) {
    return normalizeItemCategories(store.settings.itemCategories);
  }
  return [...DEFAULT_ITEM_CATEGORIES];
}

function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function goldRateForValuation(metals) {
  if (metals.live) {
    const factor = DISPLAY_CURRENCY_NPR_PER_UNIT[metals.currency] || DISPLAY_CURRENCY_NPR_PER_UNIT.USD;
    return Math.round(metals.goldRatePerTola * factor);
  }
  return metals.goldRatePerTola;
}

async function resolveMetalRates(store) {
  const manual = {
    live: false,
    currency: null,
    goldRatePerTola: store.settings.goldRatePerTola,
    goldRatePerGram: store.settings.goldRatePerGram
      ?? Number((store.settings.goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola: store.settings.silverRatePerTola,
    silverRatePerGram: store.settings.silverRatePerGram
  };

  if (store.settings.priceMode !== 'api' || !isMetalApiConfigured()) {
    return manual;
  }

  try {
    const metalCurrency = normalizeMetalCurrency(store.settings.currency);
    const live = await getLiveMetalRates(metalCurrency);
    return {
      live: true,
      currency: live.currency || metalCurrency,
      source: live.source,
      updatedAt: live.updatedAt,
      goldRatePerTola: live.gold.perTola,
      goldRatePerGram: live.gold.perGram,
      silverRatePerTola: live.silver.perTola,
      silverRatePerGram: live.silver.perGram
    };
  } catch (err) {
    console.warn('Live metal rates:', err.message);
    return { ...manual, liveError: err.message };
  }
}

function gramsToTola(grams) {
  return Number((grams / TOLA_GRAMS).toFixed(3));
}

function normalizeRateHistoryEntry(entry) {
  const updatedAt = entry.updatedAt || new Date().toISOString();
  const goldRatePerTola = Number(entry.goldRatePerTola) || 0;
  return {
    date: entry.date || String(updatedAt).slice(0, 10),
    goldRatePerTola,
    goldRatePerGram: Number(entry.goldRatePerGram)
      || Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    priceMode: entry.priceMode === 'api' ? 'api' : 'manual',
    updatedAt
  };
}

function trimRateHistory(history) {
  const byMode = { manual: [], api: [] };
  history.forEach((row) => {
    const mode = row.priceMode === 'api' ? 'api' : 'manual';
    byMode[mode].push(row);
  });
  byMode.manual.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  byMode.api.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...byMode.manual.slice(0, 500), ...byMode.api.slice(0, 500)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function recordDailyGoldRateSnapshot(store, goldRatePerTola, goldRatePerGram, priceMode = 'manual', localDate) {
  const tola = Number(goldRatePerTola);
  if (!Number.isFinite(tola) || tola <= 0) return false;

  const mode = priceMode === 'api' ? 'api' : 'manual';
  let now = new Date().toISOString();
  const today = String(localDate || now.slice(0, 10)).slice(0, 10);
  const gram = Number(goldRatePerGram) || Number((tola / TOLA_GRAMS).toFixed(2));
  if (!Array.isArray(store.settings.rateHistory)) store.settings.rateHistory = [];

  const history = store.settings.rateHistory.map(normalizeRateHistoryEntry);
  const lastForMode = history
    .filter((row) => row.priceMode === mode)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (lastForMode
    && lastForMode.goldRatePerTola === tola
    && lastForMode.goldRatePerGram === gram) {
    return false;
  }

  if (lastForMode) {
    const lastT = new Date(lastForMode.updatedAt).getTime();
    const minT = lastT + 1000;
    if (Date.now() < minT) now = new Date(minT).toISOString();
  }

  history.push({
    date: today,
    goldRatePerTola: tola,
    goldRatePerGram: gram,
    priceMode: mode,
    updatedAt: now
  });

  store.settings.rateHistory = trimRateHistory(history);
  return true;
}

function itemValue(item, goldRatePerTola) {
  const goldValue = gramsToTola(item.weightGrams) * goldRatePerTola * (item.karat / 24);
  return Math.round(goldValue + (item.makingCharge || 0));
}

function normalizeItemRecord(item) {
  const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
  let status = String(item.status || 'in_stock');
  if (status === 'sold_out') {
    item.quantity = 0;
    item.status = 'sold_out';
  } else if (status === 'in_stock' && qty === 0) {
    item.quantity = 1;
    item.status = 'in_stock';
  } else if (qty > 0 && status === 'sold_out') {
    item.quantity = qty;
    item.status = 'in_stock';
  } else {
    item.quantity = qty;
    item.status = status;
  }
  return item;
}

function calcGoldPriceNpr(weightGrams, makingCharge, goldRatePerTola, unit = 'grams', tolaParts = null) {
  const rate = Number(goldRatePerTola) || 0;
  const making = Number(makingCharge) || 0;
  if (!rate) return 0;
  if (unit === 'tola' && tolaParts) {
    const t = Number(tolaParts.tola) || 0;
    const a = Number(tolaParts.aana) || 0;
    const l = Number(tolaParts.laal) || 0;
    if (!t && !a && !l) return 0;
    const rateAana = rate / AANA_PER_TOLA;
    const rateLaal = rate / LAAL_PER_TOLA;
    const metal = t * rate + a * rateAana + l * rateLaal;
    return Math.round(metal + making);
  }
  const grams = Number(weightGrams) || 0;
  if (grams <= 0) return 0;
  return Math.round(grams * (rate / TOLA_GRAMS) + making);
}

async function summarize(store) {
  const metals = await resolveMetalRates(store);
  const rate = goldRateForValuation(metals);
  const inStock = store.items.filter((i) => i.status === 'in_stock' && i.quantity > 0);
  const totalWeight = inStock.reduce((sum, i) => sum + i.weightGrams * i.quantity, 0);
  const totalValue = inStock.reduce((sum, i) => sum + itemValue(i, rate) * i.quantity, 0);
  const lowStock = store.items.filter((i) => i.status === 'in_stock' && i.quantity <= 1);

  return {
    shopName: store.settings.shopName,
    goldRatePerTola: metals.goldRatePerTola,
    goldRatePerTolaNpr: rate,
    metalRatesLive: metals.live,
    metalCurrency: metals.currency,
    currency: store.settings.currency,
    totalItems: inStock.reduce((sum, i) => sum + i.quantity, 0),
    uniqueSkus: inStock.length,
    totalWeightGrams: Number(totalWeight.toFixed(2)),
    totalWeightTola: gramsToTola(totalWeight),
    totalInventoryValue: totalValue,
    lowStockCount: lowStock.length,
    lowStock,
    categoryCounts: inStock.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + i.quantity;
      return acc;
    }, {}),
    recentTransactions: [...store.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
    pendingOrders: (store.orders || []).filter((o) =>
      ['pending', 'confirmed', 'progress', 'ready'].includes(o.status)
    ).length,
    recentOrders: [...(store.orders || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)
  };
}

function nextOrderNumber(store) {
  const nums = (store.orders || [])
    .map((o) => Number(String(o.orderNumber || '').replace(/\D/g, '')))
    .filter((n) => Number.isFinite(n));
  const next = (nums.length ? Math.max(...nums) : 1000) + 1;
  return `SP-${next}`;
}

function buildOrderLine(item, quantity, goldRatePerTola) {
  const qty = Math.max(1, Number(quantity));
  const unitPrice = itemValue(item, goldRatePerTola);
  return {
    itemId: item.id,
    itemName: item.name,
    sku: item.sku,
    quantity: qty,
    unitPrice,
    lineTotal: unitPrice * qty
  };
}

function applyOrderCompletion(store, order) {
  for (const line of order.lines) {
    const item = store.items.find((i) => i.id === line.itemId);
    if (!item) continue;
    if (item.quantity < line.quantity) {
      throw new Error(`Not enough stock for ${item.name}.`);
    }
    item.quantity -= line.quantity;
    if (item.quantity === 0) item.status = 'sold_out';
    item.updatedAt = new Date().toISOString();
    store.transactions.unshift({
      id: newId('tx'),
      type: 'sale',
      itemId: item.id,
      itemName: item.name,
      quantity: line.quantity,
      amount: line.lineTotal,
      note: `Order ${order.orderNumber} — ${order.customerName}`,
      createdAt: new Date().toISOString()
    });
  }
}

function revertOrderCompletion(store, order) {
  const orderRef = `Order ${order.orderNumber}`;
  for (const line of order.lines) {
    const item = store.items.find((i) => i.id === line.itemId);
    if (!item) continue;
    item.quantity += line.quantity;
    if (item.quantity > 0) item.status = 'in_stock';
    item.updatedAt = new Date().toISOString();
  }
  store.transactions = store.transactions.filter(
    (tx) => !(tx.type === 'sale' && String(tx.note || '').includes(orderRef))
  );
}

function txAmount(store, tx) {
  if (tx.amount != null && Number.isFinite(Number(tx.amount))) {
    return Number(tx.amount);
  }
  const item = store.items.find((i) => i.id === tx.itemId);
  if (!item) return 0;
  return itemValue(item, store.settings.goldRatePerTola) * Number(tx.quantity || 0);
}

function inDateRange(iso, start, end) {
  const day = String(iso || '').slice(0, 10);
  if (!day) return false;
  if (start && day < start) return false;
  if (end && day > end) return false;
  return true;
}

async function buildReports(store, start, end) {
  const metals = await resolveMetalRates(store);
  const rate = goldRateForValuation(metals);
  const inStock = store.items.filter((i) => i.status === 'in_stock' && i.quantity > 0);
  const totalWeight = inStock.reduce((sum, i) => sum + i.weightGrams * i.quantity, 0);
  const totalValue = inStock.reduce((sum, i) => sum + itemValue(i, rate) * i.quantity, 0);
  const lowStock = store.items.filter((i) => i.status === 'in_stock' && i.quantity <= 1);

  const transactions = store.transactions
    .filter((tx) => inDateRange(tx.createdAt, start, end))
    .map((tx) => ({ ...tx, amount: txAmount(store, tx) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const orders = (store.orders || [])
    .filter((o) => inDateRange(o.createdAt, start, end))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const saleTx = transactions.filter((tx) => tx.type === 'sale');
  const salesRevenue = saleTx.reduce((sum, tx) => sum + tx.amount, 0);
  const salesCount = saleTx.length;
  const completedOrders = orders.filter((o) => o.status === 'completed');
  const orderRevenue = completedOrders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
  const pendingOrders = orders.filter((o) =>
    ['pending', 'confirmed', 'progress', 'ready'].includes(o.status)
  ).length;

  const salesByDay = saleTx.reduce((acc, tx) => {
    const day = tx.createdAt.slice(0, 10);
    acc[day] = (acc[day] || 0) + tx.amount;
    return acc;
  }, {});

  const customerOrderTotals = orders.reduce((acc, order) => {
    const key = order.customerName || 'Unknown';
    if (!acc[key]) {
      acc[key] = {
        name: key,
        phone: order.customerPhone || '',
        orders: 0,
        total: 0
      };
    }
    acc[key].orders += 1;
    if (order.status === 'completed') acc[key].total += Number(order.totalAmount || 0);
    return acc;
  }, {});

  const topCustomers = Object.values(customerOrderTotals)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return {
    period: { start: start || null, end: end || null },
    goldRatePerTola: metals.goldRatePerTola,
    goldRatePerTolaNpr: rate,
    metalRatesLive: metals.live,
    metalCurrency: metals.currency,
    currency: store.settings.currency || 'USD',
    sales: {
      revenue: salesRevenue,
      salesCount,
      orderRevenue,
      completedOrders: completedOrders.length,
      pendingOrders,
      totalOrders: orders.length,
      salesByDay: Object.entries(salesByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount })),
      transactions: saleTx
    },
    inventory: {
      totalItems: inStock.reduce((sum, i) => sum + i.quantity, 0),
      uniqueSkus: inStock.length,
      totalWeightGrams: Number(totalWeight.toFixed(2)),
      totalWeightTola: gramsToTola(totalWeight),
      totalInventoryValue: totalValue,
      lowStockCount: lowStock.length,
      lowStock,
      categoryCounts: inStock.reduce((acc, i) => {
        acc[i.category] = (acc[i.category] || 0) + i.quantity;
        return acc;
      }, {}),
      movements: transactions
    },
    customers: {
      totalCustomers: topCustomers.length,
      activeBuyers: topCustomers.filter((c) => c.total > 0).length,
      topCustomers,
      recentOrders: orders.slice(0, 10)
    }
  };
}

app.get('/api/health', asyncRoute(async (req, res) => {
  const database = await checkSupabaseConnection();
  res.json({
    ok: database.ok || !database.valid,
    dataSource: dataSourceLabel(),
    database
  });
}));

app.get('/api/auth/config', (req, res) => {
  const { readEnv } = require('./lib/env');
  const url = readEnv('SUPABASE_URL');
  const anonKey =
    readEnv('SUPABASE_ANON_KEY') ||
    readEnv('SUPABASE_PUBLISHABLE_KEY') ||
    readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const placeholders = ['YOUR_PROJECT_REF', 'your-anon-key', 'your-service-role-key'];
  const valid = Boolean(
    url &&
    anonKey &&
    url.includes('supabase.co') &&
    !placeholders.some((p) => url.includes(p) || anonKey.includes(p))
  );
  res.json({
    enabled: valid,
    url: valid ? url : null,
    anonKey: valid ? anonKey : null
  });
});

app.get('/api/auth/me', asyncRoute(async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const admin = getSupabase();
  if (!admin) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = await getUserIdFromToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  const { data: loaded, error: loadError } = await admin.auth.admin.getUserById(userId);
  if (loadError || !loaded?.user) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  const user = loaded.user;
  let displayName = await lookupDisplayNameFromDb(admin, user);

  if (displayName && !displayNameFromUser(user)) {
    await admin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...user.user_metadata,
        full_name: displayName
      }
    });
  }

  res.json({
    ok: true,
    displayName,
    username: normalizeUsername(user.user_metadata?.username)
  });
}));

app.post('/api/auth/signup', asyncRoute(async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const admin = getSupabase();
  const anon = getAnonAuthClient();
  if (!admin || !anon) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const username = normalizeUsername(req.body?.username);
  const fullName = String(req.body?.full_name || '').trim();
  const email = String(req.body?.email || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const password = String(req.body?.password || '');

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3–24 characters (letters, numbers, underscore).' });
  }
  if (!fullName) {
    return res.status(400).json({ error: 'Enter your full name.' });
  }
  if (!email && !phone) {
    return res.status(400).json({ error: 'Enter an email address or mobile number.' });
  }
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (phone && !isValidPhone(phone)) {
    return res.status(400).json({ error: 'Enter a valid phone number (at least 10 digits).' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const authEmail = email ? email.toLowerCase() : usernameToEmail(username);
  const existing = await findUserByUsername(admin, username);
  if (existing) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: authEmail,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      full_name: fullName,
      phone: phone || null,
      contact_email: email || null
    }
  });

  if (createError) {
    const message = createError.message?.includes('already registered')
      ? 'That username is already taken.'
      : (createError.message || 'Could not create account.');
    return res.status(400).json({ error: message });
  }

  if (created?.user?.id) {
    try {
      await ensureUserSettings(admin, created.user.id);
    } catch (err) {
      console.warn(`Default settings not created for ${created.user.id}:`, err.message);
    }
  }

  const { data, error: signInError } = await anon.auth.signInWithPassword({
    email: authEmail,
    password
  });

  if (signInError) {
    return res.status(201).json({
      ok: true,
      session: null,
      message: 'Account created. You can log in now.'
    });
  }

  res.status(201).json({ ok: true, session: data.session });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const admin = getSupabase();
  const anon = getAnonAuthClient();
  if (!admin || !anon) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3–24 characters (letters, numbers, underscore).' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const authEmail = await resolveAuthEmail(admin, username);
  let { data, error } = await anon.auth.signInWithPassword({ email: authEmail, password });

  if (error?.message === 'Invalid login credentials' || error?.message === 'Email not confirmed') {
    const existing = await findUserByUsername(admin, username);
    if (existing && !existing.email_confirmed_at) {
      await admin.auth.admin.updateUserById(existing.id, { email_confirm: true });
      ({ data, error } = await anon.auth.signInWithPassword({ email: authEmail, password }));
    }
  }

  if (error) {
    const message = error.message === 'Invalid login credentials'
      ? 'Incorrect username or password.'
      : error.message;
    return res.status(401).json({ error: message });
  }

  res.json({ ok: true, session: data.session });
}));

function getRecoveryRedirectUrl(req) {
  const configured = process.env.APP_URL || process.env.PUBLIC_APP_URL;
  if (configured) {
    return `${String(configured).replace(/\/$/, '')}/reset-password.html`;
  }
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:3002';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}/reset-password.html`;
}

function emailMatchesAccount(user, email) {
  const provided = String(email || '').trim().toLowerCase();
  if (!provided) return false;
  const contact = String(user.user_metadata?.contact_email || '').trim().toLowerCase();
  const authEmail = String(user.email || '').trim().toLowerCase();
  return provided === contact || provided === authEmail;
}

function authErrorMessage(error) {
  if (!error) return '';
  const message = String(error.message || error.msg || '').trim();
  if (!message || message === '{}') {
    return 'Could not send reset link. Try again in a few minutes.';
  }
  if (/rate limit/i.test(message)) {
    return 'Too many reset emails sent. Please wait about an hour and try again.';
  }
  return message;
}

app.post('/api/auth/forgot-password', asyncRoute(async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const admin = getSupabase();
  const anon = getAnonAuthClient();
  if (!admin || !anon) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const username = normalizeUsername(req.body?.username);
  const email = String(req.body?.email || '').trim();

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Enter a valid username.' });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter the email on your account.' });
  }

  const user = await findUserByUsername(admin, username);
  if (!user) {
    return res.status(404).json({ error: 'No account found with that username.' });
  }
  if (!emailMatchesAccount(user, email)) {
    return res.status(400).json({ error: 'That email does not match this account.' });
  }

  const deliverTo = email.trim().toLowerCase();
  const authEmail = String(user.email || '').trim().toLowerCase();
  let resetEmail = isSyntheticAuthEmail(authEmail) ? deliverTo : authEmail;

  if (isSyntheticAuthEmail(authEmail) && deliverTo !== authEmail) {
    const { error: syncError } = await admin.auth.admin.updateUserById(user.id, {
      email: deliverTo,
      email_confirm: true
    });
    if (syncError) {
      console.warn('Forgot password email sync:', authErrorMessage(syncError));
    } else {
      resetEmail = deliverTo;
    }
  }

  let { error } = await anon.auth.resetPasswordForEmail(resetEmail, {
    redirectTo: getRecoveryRedirectUrl(req)
  });

  if (error && isSyntheticAuthEmail(authEmail) && resetEmail !== authEmail) {
    ({ error } = await anon.auth.resetPasswordForEmail(authEmail, {
      redirectTo: getRecoveryRedirectUrl(req)
    }));
  }

  if (error) {
    console.warn('Forgot password email:', authErrorMessage(error));
    return res.status(500).json({ error: authErrorMessage(error) });
  }

  return res.json({
    ok: true,
    message: 'A reset link was sent to your email. Check your inbox and spam folder.'
  });
}));

app.patch('/api/auth/profile', asyncRoute(async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const admin = getSupabase();
  if (!admin) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = await getUserIdFromToken(token);
  if (!userId) {
    return res.status(401).json({ error: 'Sign in required.' });
  }

  const fullName = String(req.body?.full_name || '').trim();
  if (!fullName) {
    return res.status(400).json({ error: 'Enter your full name.' });
  }

  const { data: existing, error: loadError } = await admin.auth.admin.getUserById(userId);
  if (loadError || !existing?.user) {
    return res.status(404).json({ error: 'Account not found.' });
  }

  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...existing.user.user_metadata,
      full_name: fullName
    }
  });
  if (error) {
    return res.status(400).json({ error: error.message || 'Could not save your name.' });
  }

  res.json({ ok: true, user: data.user });
}));

app.post('/api/auth/reset-password', asyncRoute(async (req, res) => {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const admin = getSupabase();
  if (!admin) {
    return res.status(503).json({ error: 'Sign-in is not configured yet.' });
  }

  const username = normalizeUsername(req.body?.username);
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const confirm = String(req.body?.confirm || '');

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Enter a valid username.' });
  }
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter the email on your account.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (password !== confirm) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  const user = await findUserByUsername(admin, username);
  if (!user || !emailMatchesAccount(user, email)) {
    return res.status(400).json({ error: 'Username and email do not match our records.' });
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) {
    return res.status(400).json({ error: error.message || 'Could not reset password.' });
  }

  res.json({ ok: true, message: 'Password updated. You can log in now.' });
}));

app.get('/api/cron/capture-gold-rate', asyncRoute(async (req, res) => {
  if (!req.isCron) {
    return res.status(401).json({ error: 'Cron secret required.' });
  }
  const result = await captureSharedGoldRateIfChanged({
    currency: req.query.currency
  });
  res.json(result);
}));

app.get('/api/metal-rates', asyncRoute(async (req, res) => {
  if (!isMetalApiConfigured()) {
    return res.status(503).json({
      error: 'Live metal API is not configured. Set METAL_PRICE_PROVIDER=gold-api in .env or add METAL_PRICE_API_KEY.'
    });
  }

  try {
    const currency = normalizeMetalCurrency(req.query.currency);
    const rates = await getLiveMetalRates(currency);
    const tolaNpr = displayToNpr(rates.gold.perTola, currency);
    const gramNpr = displayToNpr(rates.gold.perGram, currency)
      || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
    if (tolaNpr > 0) {
      await appendSharedHistory({
        goldRatePerTola: tolaNpr,
        goldRatePerGram: gramNpr,
        priceMode: 'api',
        localDate: localDateStr()
      });
    }
    res.json(rates);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not fetch live metal rates.' });
  }
}));

app.get('/api/shared/gold-rates', asyncRoute(async (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const priceMode = req.query.priceMode === 'api' ? 'api' : 'manual';
  const data = await getSharedRatesForClient({ date, priceMode });
  res.json(data);
}));

app.post('/api/shared/gold-rates/tick', asyncRoute(async (req, res) => {
  await appendSharedTick(req.body);
  res.json({ ok: true });
}));

app.post('/api/shared/gold-rates/ticks', asyncRoute(async (req, res) => {
  const ticks = Array.isArray(req.body.ticks) ? req.body.ticks : [];
  const result = await appendSharedTicks(ticks);
  res.json({ ok: true, count: result.count });
}));

app.post('/api/shared/gold-rates/history', asyncRoute(async (req, res) => {
  const result = await appendSharedHistory(req.body);
  res.json({ changed: result.changed, rateHistory: result.history });
}));

app.delete('/api/shared/gold-rates', asyncRoute(async (req, res) => {
  const priceMode = req.query.priceMode === 'api' ? 'api' : 'manual';
  const result = await clearSharedRates(priceMode);
  res.json({ rateHistory: result.history });
}));

app.get('/api/reports', asyncRoute(async (req, res) => {
  const start = req.query.start ? String(req.query.start).slice(0, 10) : null;
  const end = req.query.end ? String(req.query.end).slice(0, 10) : null;
  const store = await readStore(req.userId);
  res.json(await buildReports(store, start, end));
}));

app.get('/api/summary', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  res.json(await summarize(store));
}));

app.get('/api/settings', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const settings = normalizeSilverRates({ ...store.settings });
  if (settings.goldRatePerTola > 0 && settings.priceMode !== 'api') {
    await appendSharedHistory({
      goldRatePerTola: settings.goldRatePerTola,
      goldRatePerGram: settings.goldRatePerGram,
      priceMode: 'manual'
    });
  }
  const shared = await readSharedRates();
  res.json({
    ...settings,
    locations: getStoreLocations(store),
    itemCategories: getStoreItemCategories(store),
    goldRatePerGram: Number((settings.goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    rateHistory: shared.history || []
  });
}));

app.post('/api/settings/daily-gold-rate', asyncRoute(async (req, res) => {
  const tola = Number(req.body.goldRatePerTola);
  const gram = Number(req.body.goldRatePerGram)
    || Number((tola / TOLA_GRAMS).toFixed(2));
  const priceMode = req.body.priceMode === 'api' ? 'api' : 'manual';
  if (!Number.isFinite(tola) || tola < 0) {
    return res.status(400).json({ error: 'Gold rate must be a valid number.' });
  }
  const result = await appendSharedHistory({
    goldRatePerTola: tola,
    goldRatePerGram: gram,
    priceMode,
    localDate: req.body.localDate
  });
  const shared = await readSharedRates();
  res.json({ changed: result.changed, rateHistory: shared.history || [] });
}));

app.delete('/api/settings/rate-history', asyncRoute(async (req, res) => {
  const priceMode = req.query.priceMode === 'api' ? 'api' : 'manual';
  const result = await clearSharedRates(priceMode);
  res.json({ rateHistory: result.history });
}));

app.get('/api/settings/shop-name-available', asyncRoute(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.json({ available: false });
  const taken = await isShopNameTaken(name, req.userId);
  res.json({ available: !taken });
}));

app.patch('/api/settings', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const now = new Date().toISOString();

  if (req.body.goldRatePerTola != null) {
    const newRate = Number(req.body.goldRatePerTola);
    if (!Number.isFinite(newRate) || newRate < 0) {
      return res.status(400).json({ error: 'Gold rate must be a valid number.' });
    }
    store.settings.goldRatePerTola = newRate;
    await appendSharedHistory({
      goldRatePerTola: newRate,
      goldRatePerGram: Number((newRate / TOLA_GRAMS).toFixed(2)),
      priceMode: 'manual'
    });
  }

  if (req.body.shopName != null) {
    const name = String(req.body.shopName).trim();
    if (!name) return res.status(400).json({ error: 'Shop name is required.' });
    if (normalizeShopName(name) !== normalizeShopName(store.settings.shopName)) {
      if (await isShopNameTaken(name, req.userId)) {
        return res.status(409).json({ error: 'This store name is already taken. Please choose another name.' });
      }
    }
    store.settings.shopName = name;
  }

  if (req.body.shopAddress != null) {
    store.settings.shopAddress = String(req.body.shopAddress).trim();
  }

  if (req.body.shopPhone != null) {
    store.settings.shopPhone = String(req.body.shopPhone).trim();
  }

  if (req.body.priceMode != null) {
    store.settings.priceMode = req.body.priceMode === 'api' ? 'api' : 'manual';
  }

  if (req.body.silverRatePerTola != null) {
    store.settings.silverRatePerTola = Number(req.body.silverRatePerTola) || 0;
  } else if (req.body.silverRatePerGram != null) {
    const perGram = Number(req.body.silverRatePerGram) || 0;
    store.settings.silverRatePerGram = perGram;
    store.settings.silverRatePerTola = Number((perGram * TOLA_GRAMS).toFixed(2));
  }

  if (req.body.currency != null) {
    const allowed = ['USD', 'CAD'];
    const code = String(req.body.currency).toUpperCase();
    if (allowed.includes(code)) store.settings.currency = code;
  }

  if (req.body.locations != null) {
    if (!Array.isArray(req.body.locations)) {
      return res.status(400).json({ error: 'Locations must be an array.' });
    }
    store.settings.locations = [...new Set(
      req.body.locations.map((l) => String(l).trim()).filter(Boolean)
    )];
  }

  if (req.body.itemCategories != null) {
    if (!Array.isArray(req.body.itemCategories)) {
      return res.status(400).json({ error: 'Item categories must be an array.' });
    }
    store.settings.itemCategories = normalizeItemCategories(req.body.itemCategories);
  }

  store.settings.updatedAt = now;
  store.settings.goldRatePerGram = Number((store.settings.goldRatePerTola / TOLA_GRAMS).toFixed(2));
  normalizeSilverRates(store.settings);
  await writeStore(store, req.userId);
  const shared = await readSharedRates();
  res.json({
    ...store.settings,
    locations: getStoreLocations(store),
    itemCategories: getStoreItemCategories(store),
    rateHistory: shared.history || []
  });
}));

app.get('/api/items', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const { q, category, status } = req.query;
  let items = [...store.items];
  if (q) {
    const term = String(q).toLowerCase();
    items = items.filter(
      (i) =>
        i.name.toLowerCase().includes(term) ||
        i.sku.toLowerCase().includes(term) ||
        (i.location || '').toLowerCase().includes(term) ||
        (i.notes || '').toLowerCase().includes(term)
    );
  }
  if (category) items = items.filter((i) => i.category === category);
  if (status) items = items.filter((i) => i.status === status);
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const metals = await resolveMetalRates(store);
  res.json({
    items,
    goldRatePerTola: metals.goldRatePerTola,
    silverRatePerTola: metals.silverRatePerTola,
    metalRatesLive: metals.live,
    metalCurrency: metals.currency,
    metalRatesError: metals.liveError || null
  });
}));

app.get('/api/items/:id', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const item = store.items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json(item);
}));

app.post('/api/items', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const body = req.body || {};
  if (!body.name || !body.sku) {
    return res.status(400).json({ error: 'Name and SKU are required.' });
  }
  if (store.items.some((i) => i.sku === body.sku)) {
    return res.status(400).json({ error: 'SKU already exists.' });
  }
  const now = new Date().toISOString();
  const item = normalizeItemRecord({
    id: newId('sp'),
    sku: String(body.sku).trim(),
    name: String(body.name).trim(),
    category: body.category || 'other',
    karat: Number(body.karat) || 24,
    weightGrams: Number(body.weightGrams) || 0,
    makingCharge: Number(body.makingCharge) || 0,
    purchaseCost: Number(body.purchaseCost) || 0,
    salePrice: Number(body.salePrice) || 0,
    quantity: Math.max(0, Number(body.quantity) || 0),
    status: body.status || 'in_stock',
    location: String(body.location || '').trim(),
    hallmark: Boolean(body.hallmark),
    notes: String(body.notes || '').trim(),
    createdAt: now,
    updatedAt: now
  });
  store.items.unshift(item);
  await writeStore(store, req.userId);
  res.status(201).json(item);
}));

app.put('/api/items/:id', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const idx = store.items.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found.' });
  const existing = store.items[idx];
  const body = req.body || {};
  if (body.sku && body.sku !== existing.sku && store.items.some((i) => i.sku === body.sku)) {
    return res.status(400).json({ error: 'SKU already exists.' });
  }
  const name = body.name != null ? String(body.name).trim() : existing.name;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const updated = normalizeItemRecord({
    id: existing.id,
    sku: body.sku != null ? String(body.sku).trim() : existing.sku,
    name,
    category: body.category != null ? body.category : existing.category,
    karat: body.karat != null ? Number(body.karat) || existing.karat : existing.karat,
    weightGrams: body.weightGrams != null ? Number(body.weightGrams) || 0 : existing.weightGrams,
    makingCharge: body.makingCharge != null ? Number(body.makingCharge) || 0 : existing.makingCharge,
    purchaseCost: body.purchaseCost != null ? Number(body.purchaseCost) || 0 : existing.purchaseCost,
    salePrice: body.salePrice != null ? Number(body.salePrice) || 0 : existing.salePrice || 0,
    quantity: body.quantity != null ? Number(body.quantity) || 0 : existing.quantity,
    status: body.status != null ? body.status : existing.status,
    location: body.location != null ? String(body.location).trim() : existing.location || '',
    hallmark: body.hallmark != null ? Boolean(body.hallmark) : existing.hallmark,
    notes: body.notes != null ? String(body.notes).trim() : existing.notes || '',
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  });
  store.items[idx] = updated;
  await writeStore(store, req.userId);
  res.json(updated);
}));

app.delete('/api/items/:id', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const before = store.items.length;
  store.items = store.items.filter((i) => i.id !== req.params.id);
  if (store.items.length === before) {
    return res.status(404).json({ error: 'Item not found.' });
  }
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

app.get('/api/transactions', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const txs = [...store.transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ transactions: txs });
}));

app.post('/api/transactions', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const body = req.body || {};
  const { type, quantity, note } = body;

  if (body.customItem) {
    const itemName = String(body.itemName || '').trim();
    const qty = Math.max(1, Number(quantity) || 1);
    const amount = Number(body.amount);
    if (!itemName) {
      return res.status(400).json({ error: 'Item name is required for custom sales.' });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'A valid amount is required for custom sales.' });
    }
    const tx = {
      id: newId('tx'),
      type: 'sale',
      itemId: null,
      itemName,
      quantity: qty,
      amount,
      note: String(note || '').trim(),
      createdAt: new Date().toISOString()
    };
    store.transactions.unshift(tx);
    await writeStore(store, req.userId);
    return res.status(201).json({ transaction: tx });
  }

  const { itemId } = body;
  if (!type || !itemId || !quantity) {
    return res.status(400).json({ error: 'Type, item, and quantity are required.' });
  }
  const item = store.items.find((i) => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const qty = Math.max(1, Number(quantity));

  if (type === 'stock_in') {
    item.quantity += qty;
    item.status = 'in_stock';
  } else if (type === 'sale' || type === 'stock_out') {
    if (item.quantity < qty) {
      return res.status(400).json({ error: 'Not enough stock.' });
    }
    item.quantity -= qty;
    if (item.quantity === 0) item.status = 'sold_out';
  } else {
    return res.status(400).json({ error: 'Invalid transaction type.' });
  }

  item.updatedAt = new Date().toISOString();
  const amount = type === 'sale' ? itemValue(item, store.settings.goldRatePerTola) * qty : 0;
  const tx = {
    id: newId('tx'),
    type,
    itemId: item.id,
    itemName: item.name,
    quantity: qty,
    amount,
    note: String(note || '').trim(),
    createdAt: new Date().toISOString()
  };
  store.transactions.unshift(tx);
  await writeStore(store, req.userId);
  res.status(201).json({ transaction: tx, item });
}));

app.get('/api/orders', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  let orders = [...(store.orders || [])];
  const { status } = req.query;
  if (status) orders = orders.filter((o) => o.status === status);
  orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const metals = await resolveMetalRates(store);
  res.json({
    orders,
    goldRatePerTola: metals.goldRatePerTola,
    metalRatesLive: metals.live,
    metalCurrency: metals.currency
  });
}));

app.get('/api/orders/:id', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const order = (store.orders || []).find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
}));

app.post('/api/orders', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  if (!Array.isArray(store.orders)) store.orders = [];
  const body = req.body || {};
  const customerName = String(body.customerName || '').trim();
  const quantity = Math.max(1, Number(body.quantity) || 1);

  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });

  const metals = await resolveMetalRates(store);
  const goldRate = goldRateForValuation(metals);
  const now = new Date().toISOString();
  let line;

  if (body.orderItemMode === 'custom' || body.customItem) {
    const custom = body.customItem || {};
    const itemName = String(custom.name || body.customItemName || '').trim();
    const weightGrams = Number(custom.weightGrams ?? body.customWeightGrams) || 0;
    const karat = Number(custom.karat ?? body.customKarat) || 24;
    const makingCharge = Number(custom.makingCharge ?? body.customMakingCharge) || 0;
    const weightUnit = String(custom.weightUnit || body.customWeightUnit || 'grams');
    const tolaParts = weightUnit === 'tola'
      ? {
        tola: Number(custom.weightTola ?? body.customWeightTola) || 0,
        aana: Number(custom.weightAana ?? body.customWeightAana) || 0,
        laal: Number(custom.weightLaal ?? body.customWeightLaal) || 0
      }
      : null;
    if (!itemName) return res.status(400).json({ error: 'Item name is required.' });
    if (weightGrams <= 0) return res.status(400).json({ error: 'Weight is required.' });
    const unitPrice = calcGoldPriceNpr(weightGrams, makingCharge, goldRate, weightUnit, tolaParts);
    line = {
      itemId: `custom-${Date.now()}`,
      itemName,
      sku: 'CUSTOM',
      quantity,
      unitPrice,
      lineTotal: unitPrice * quantity,
      custom: true,
      weightGrams,
      karat
    };
  } else {
    const itemId = String(body.itemId || '').trim();
    if (!itemId) return res.status(400).json({ error: 'Item is required.' });
    const item = store.items.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    if (item.quantity < quantity) {
      return res.status(400).json({ error: 'Not enough stock for this order.' });
    }
    line = buildOrderLine(item, quantity, goldRate);
  }

  const order = {
    id: newId('ord'),
    orderNumber: nextOrderNumber(store),
    customerName,
    customerPhone: String(body.customerPhone || '').trim(),
    status: 'pending',
    lines: [line],
    totalAmount: line.lineTotal,
    note: String(body.note || '').trim(),
    createdAt: now,
    updatedAt: now
  };

  store.orders.unshift(order);
  await writeStore(store, req.userId);
  res.status(201).json(order);
}));

app.patch('/api/orders/:id', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const idx = (store.orders || []).findIndex((o) => o.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Order not found.' });

  const order = store.orders[idx];
  const body = req.body || {};
  const allowed = ['pending', 'confirmed', 'progress', 'ready', 'completed', 'cancelled'];
  const nextStatus = body.status || order.status;
  if (!allowed.includes(nextStatus)) {
    return res.status(400).json({ error: 'Invalid order status.' });
  }

  if (nextStatus === 'completed' && order.status !== 'completed') {
    try {
      applyOrderCompletion(store, order);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (nextStatus === 'ready' && order.status === 'completed') {
    revertOrderCompletion(store, order);
  }

  if (nextStatus === 'progress' && order.status === 'completed') {
    revertOrderCompletion(store, order);
  }

  if (body.customerName != null) order.customerName = String(body.customerName).trim();
  if (body.customerPhone != null) order.customerPhone = String(body.customerPhone).trim();
  if (body.note != null) order.note = String(body.note).trim();
  order.status = nextStatus;
  order.updatedAt = new Date().toISOString();
  store.orders[idx] = order;
  await writeStore(store, req.userId);
  res.json(order);
}));

app.delete('/api/orders/:id', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const order = (store.orders || []).find((o) => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  if (order.status === 'completed') {
    revertOrderCompletion(store, order);
  }
  store.orders = store.orders.filter((o) => o.id !== req.params.id);
  await writeStore(store, req.userId);
  res.json({ ok: true });
}));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SubarnaPasal running on http://localhost:${PORT}`);
    console.log(`Data source: ${dataSourceLabel()}`);
  });
}

module.exports = app;
