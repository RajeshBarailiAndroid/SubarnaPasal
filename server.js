require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { readStore, writeStore, dataSourceLabel, ensureUserSettings, LOCAL_DEV_USER_ID } = require('./lib/store');
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

const app = express();
const PORT = process.env.PORT || 3002;
const TOLA_GRAMS = 11.664;
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

function itemValue(item, goldRatePerTola) {
  const goldValue = gramsToTola(item.weightGrams) * goldRatePerTola * (item.karat / 24);
  return Math.round(goldValue + (item.makingCharge || 0));
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

app.get('/api/metal-rates', asyncRoute(async (req, res) => {
  if (!isMetalApiConfigured()) {
    return res.status(503).json({
      error: 'Live metal API is not configured. Set METAL_PRICE_PROVIDER=gold-api in .env or add METAL_PRICE_API_KEY.'
    });
  }

  try {
    const currency = normalizeMetalCurrency(req.query.currency);
    const rates = await getLiveMetalRates(currency);
    res.json(rates);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not fetch live metal rates.' });
  }
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
  res.json({
    ...settings,
    locations: getStoreLocations(store),
    goldRatePerGram: Number((settings.goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    rateHistory: settings.rateHistory || []
  });
}));

app.patch('/api/settings', asyncRoute(async (req, res) => {
  const store = await readStore(req.userId);
  const now = new Date().toISOString();

  if (req.body.goldRatePerTola != null) {
    const newRate = Number(req.body.goldRatePerTola);
    if (!Number.isFinite(newRate) || newRate < 0) {
      return res.status(400).json({ error: 'Gold rate must be a valid number.' });
    }
    if (newRate !== store.settings.goldRatePerTola) {
      if (!Array.isArray(store.settings.rateHistory)) store.settings.rateHistory = [];
      store.settings.rateHistory.unshift({
        goldRatePerTola: newRate,
        goldRatePerGram: Number((newRate / TOLA_GRAMS).toFixed(2)),
        updatedAt: now
      });
      store.settings.rateHistory = store.settings.rateHistory.slice(0, 30);
    }
    store.settings.goldRatePerTola = newRate;
  }

  if (req.body.shopName != null) {
    const name = String(req.body.shopName).trim();
    if (!name) return res.status(400).json({ error: 'Shop name is required.' });
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

  store.settings.updatedAt = now;
  store.settings.goldRatePerGram = Number((store.settings.goldRatePerTola / TOLA_GRAMS).toFixed(2));
  normalizeSilverRates(store.settings);
  await writeStore(store, req.userId);
  res.json({
    ...store.settings,
    locations: getStoreLocations(store)
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
  const item = {
    id: newId('sp'),
    sku: String(body.sku).trim(),
    name: String(body.name).trim(),
    category: body.category || 'other',
    karat: Number(body.karat) || 22,
    weightGrams: Number(body.weightGrams) || 0,
    makingCharge: Number(body.makingCharge) || 0,
    purchaseCost: Number(body.purchaseCost) || 0,
    quantity: Math.max(0, Number(body.quantity) || 0),
    status: body.status || 'in_stock',
    location: String(body.location || '').trim(),
    hallmark: Boolean(body.hallmark),
    notes: String(body.notes || '').trim(),
    createdAt: now,
    updatedAt: now
  };
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
  const updated = {
    ...existing,
    ...body,
    id: existing.id,
    location: body.location != null ? String(body.location).trim() : existing.location || '',
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };
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
  const itemId = String(body.itemId || '').trim();
  const quantity = Math.max(1, Number(body.quantity) || 1);

  if (!customerName) return res.status(400).json({ error: 'Customer name is required.' });
  if (!itemId) return res.status(400).json({ error: 'Item is required.' });

  const item = store.items.find((i) => i.id === itemId);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (item.quantity < quantity) {
    return res.status(400).json({ error: 'Not enough stock for this order.' });
  }

  const metals = await resolveMetalRates(store);
  const line = buildOrderLine(item, quantity, goldRateForValuation(metals));
  const now = new Date().toISOString();
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
