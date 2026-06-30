const fs = require('fs');
const path = require('path');
const { getSupabase, isSupabaseEnabled } = require('./supabase');
const {
  isMissingTableError,
  isMissingUserIdColumnError,
  isMissingColumnError,
  missingTablesMessage,
  missingUserIdMessage,
  missingCustomersAddressMessage
} = require('./db-schema');

let customersAddressColumnSupported = true;
let customersTableAvailable = true;

function isCustomersTableMissing(error) {
  return isMissingTableError(error);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'store.json');
const LOCAL_DEV_USER_ID = 'local-dev';

function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT ||
    String(__dirname).startsWith('/var/task')
  );
}

function requireSupabaseInProduction() {
  if (!isServerlessRuntime() || isSupabaseEnabled()) return;

  const { supabaseConfigStatus } = require('./supabase');
  const status = supabaseConfigStatus();
  throw new Error(status.reason || 'Supabase is required in production. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

function rejectJsonFallback(err) {
  if (!isServerlessRuntime()) return;

  const message = String(err?.message || 'Connection failed');
  if (isMissingUserIdColumnError({ message }) || isMissingUserIdColumnError(err)) {
    throw new Error(missingUserIdMessage());
  }
  if (isMissingTableError({ message }) || isMissingTableError(err)) {
    throw new Error(missingTablesMessage([]));
  }
  throw new Error(`Database unavailable: ${message}`);
}

function throwIfError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function userJsonPath(userId) {
  return path.join(DATA_DIR, 'users', userId, 'store.json');
}

function itemToRow(item, userId) {
  return {
    id: item.id,
    user_id: userId,
    sku: item.sku,
    name: item.name,
    category: item.category,
    karat: item.karat,
    weight_grams: item.weightGrams,
    making_charge: item.makingCharge ?? 0,
    purchase_cost: item.purchaseCost ?? 0,
    sale_price: item.salePrice ?? 0,
    custom_rate_per_tola: item.customRatePerTola ?? 0,
    quantity: item.quantity ?? 0,
    status: item.status,
    location: item.location || '',
    hallmark: Boolean(item.hallmark),
    notes: item.notes || '',
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function itemFromRow(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    karat: Number(row.karat),
    weightGrams: Number(row.weight_grams),
    makingCharge: Number(row.making_charge) || 0,
    purchaseCost: Number(row.purchase_cost) || 0,
    salePrice: Number(row.sale_price) || 0,
    customRatePerTola: Number(row.custom_rate_per_tola) || 0,
    quantity: Number(row.quantity) || 0,
    status: row.status,
    location: row.location || '',
    hallmark: Boolean(row.hallmark),
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function settingsToRow(settings, userId) {
  return {
    user_id: userId,
    shop_name: settings.shopName,
    shop_address: settings.shopAddress || '',
    shop_phone: settings.shopPhone || '',
    price_mode: settings.priceMode || 'manual',
    gold_rate_per_tola: settings.goldRatePerTola ?? 0,
    gold_rate_per_gram: settings.goldRatePerGram ?? 0,
    gold_buy_rate_per_tola: settings.goldBuyRatePerTola ?? 0,
    gold_buy_rate_per_gram: settings.goldBuyRatePerGram ?? 0,
    silver_rate_per_tola: settings.silverRatePerTola ?? 0,
    silver_rate_per_gram: settings.silverRatePerGram ?? 0,
    currency: settings.currency || 'USD',
    locations: settings.locations || [],
    item_categories: settings.itemCategories || [],
    rate_history: settings.rateHistory || [],
    updated_at: settings.updatedAt
  };
}

function settingsFromRow(row) {
  if (!row) return defaultSettings();
  return {
    shopName: row.shop_name,
    shopAddress: row.shop_address || '',
    shopPhone: row.shop_phone || '',
    priceMode: row.price_mode || 'manual',
    goldRatePerTola: Number(row.gold_rate_per_tola) || 0,
    goldRatePerGram: Number(row.gold_rate_per_gram) || 0,
    goldBuyRatePerTola: Number(row.gold_buy_rate_per_tola) || 0,
    goldBuyRatePerGram: Number(row.gold_buy_rate_per_gram) || 0,
    silverRatePerTola: Number(row.silver_rate_per_tola) || 0,
    silverRatePerGram: Number(row.silver_rate_per_gram) || 0,
    currency: row.currency || 'USD',
    locations: row.locations || [],
    itemCategories: row.item_categories || [],
    rateHistory: row.rate_history || [],
    updatedAt: row.updated_at
  };
}

function transactionToRow(tx, userId) {
  return {
    id: tx.id,
    user_id: userId,
    type: tx.type,
    item_id: tx.itemId || null,
    item_name: tx.itemName || null,
    quantity: tx.quantity ?? 0,
    amount: tx.amount ?? null,
    note: tx.note || '',
    created_at: tx.createdAt
  };
}

function transactionFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    itemId: row.item_id,
    itemName: row.item_name,
    quantity: Number(row.quantity) || 0,
    amount: row.amount != null ? Number(row.amount) : undefined,
    note: row.note || '',
    createdAt: row.created_at
  };
}

function orderToRow(order, userId) {
  return {
    id: order.id,
    user_id: userId,
    order_number: order.orderNumber,
    customer_name: order.customerName,
    customer_phone: order.customerPhone || '',
    status: order.status,
    lines: order.lines || [],
    total_amount: order.totalAmount ?? 0,
    note: order.note || '',
    created_at: order.createdAt,
    updated_at: order.updatedAt
  };
}

function orderFromRow(row) {
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    status: row.status,
    lines: row.lines || [],
    totalAmount: Number(row.total_amount) || 0,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function customerToRow(customer, userId) {
  const row = {
    id: customer.id,
    user_id: userId,
    name: customer.name,
    phone: customer.phone || '',
    email: customer.email || '',
    created_at: customer.createdAt || new Date().toISOString()
  };
  if (customersAddressColumnSupported) {
    row.address = customer.address || '';
  }
  return row;
}

function customerFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    createdAt: row.created_at,
    purchases: 0
  };
}

function defaultSettings() {
  return {
    shopName: 'SubarnaPasal',
    shopAddress: '',
    shopPhone: '',
    priceMode: 'manual',
    goldRatePerTola: 0,
    goldRatePerGram: 0,
    goldBuyRatePerTola: 0,
    goldBuyRatePerGram: 0,
    silverRatePerTola: 0,
    silverRatePerGram: 0,
    currency: 'NPR',
    locations: ['Desk A', 'Desk B', 'Side Desk'],
    itemCategories: ['Gold', 'Silver', 'Other'],
    rateHistory: [],
    updatedAt: new Date().toISOString()
  };
}

function emptyStore() {
  return {
    settings: defaultSettings(),
    items: [],
    transactions: [],
    orders: [],
    customers: []
  };
}

function readJsonStore(userId = LOCAL_DEV_USER_ID) {
  const userFile = userJsonPath(userId);
  if (fs.existsSync(userFile)) {
    const data = JSON.parse(fs.readFileSync(userFile, 'utf8'));
    return {
      settings: data.settings || defaultSettings(),
      items: data.items || [],
      transactions: data.transactions || [],
      orders: data.orders || [],
      customers: data.customers || []
    };
  }

  if (userId === LOCAL_DEV_USER_ID && fs.existsSync(LEGACY_DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8'));
    return {
      settings: data.settings || defaultSettings(),
      items: data.items || [],
      transactions: data.transactions || [],
      orders: data.orders || [],
      customers: data.customers || []
    };
  }

  return emptyStore();
}

function writeJsonStore(data, userId = LOCAL_DEV_USER_ID) {
  const userFile = userJsonPath(userId);
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, JSON.stringify(data, null, 2));
}

async function syncCustomersTable(supabase, customers, userId) {
  if (!customersTableAvailable) return;

  const rows = (customers || []).map((customer) => customerToRow(customer, userId));
  const { data: existing, error: fetchError } = await supabase
    .from('customers')
    .select('id')
    .eq('user_id', userId);

  if (fetchError) {
    if (isCustomersTableMissing(fetchError)) {
      customersTableAvailable = false;
      console.warn('Customers table missing; skipping customer sync. Run supabase/schema.sql.');
      return;
    }
    throwIfError(fetchError, 'Failed to read customers');
  }

  const keepIds = new Set(rows.map((row) => row.id));
  const deleteIds = (existing || [])
    .map((row) => row.id)
    .filter((id) => !keepIds.has(id));

  if (deleteIds.length) {
    const { error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('user_id', userId)
      .in('id', deleteIds);
    throwIfError(deleteError, 'Failed to delete from customers');
  }

  if (!rows.length) return;

  let { error: upsertError } = await supabase
    .from('customers')
    .upsert(rows, { onConflict: 'user_id,id' });

  if (
    upsertError
    && customersAddressColumnSupported
    && isMissingColumnError(upsertError, 'address')
  ) {
    customersAddressColumnSupported = false;
    const rowsWithoutAddress = (customers || []).map((customer) => customerToRow(customer, userId));
    ({ error: upsertError } = await supabase
      .from('customers')
      .upsert(rowsWithoutAddress, { onConflict: 'user_id,id' }));
    console.warn(missingCustomersAddressMessage());
  }

  if (upsertError && isCustomersTableMissing(upsertError)) {
    customersTableAvailable = false;
    console.warn('Customers table missing; skipping customer sync. Run supabase/schema.sql.');
    return;
  }

  throwIfError(upsertError, 'Failed to upsert customers');
}

async function syncTable(supabase, table, rows, userId, idField = 'id') {
  const { data: existing, error: fetchError } = await supabase
    .from(table)
    .select(idField)
    .eq('user_id', userId);
  throwIfError(fetchError, `Failed to read ${table}`);

  const keepIds = new Set(rows.map((row) => row[idField]));
  const deleteIds = (existing || [])
    .map((row) => row[idField])
    .filter((id) => !keepIds.has(id));

  if (deleteIds.length) {
    const { error: deleteError } = await supabase
      .from(table)
      .delete()
      .eq('user_id', userId)
      .in(idField, deleteIds);
    throwIfError(deleteError, `Failed to delete from ${table}`);
  }

  if (!rows.length) return;

  const { error: upsertError } = await supabase
    .from(table)
    .upsert(rows, { onConflict: `user_id,${idField}` });
  throwIfError(upsertError, `Failed to upsert ${table}`);
}

async function ensureUserSettings(supabase, userId) {
  const { data: existing, error } = await supabase
    .from('settings')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  throwIfError(error, 'Failed to check settings');
  if (existing) return;

  const { error: insertError } = await supabase
    .from('settings')
    .insert(settingsToRow(defaultSettings(), userId));
  throwIfError(insertError, 'Failed to create default settings');
}

async function readSupabaseStore(userId) {
  const supabase = getSupabase();
  await ensureUserSettings(supabase, userId);

  const [
    { data: settingsRows, error: settingsError },
    { data: itemRows, error: itemsError },
    { data: txRows, error: txError },
    { data: orderRows, error: ordersError },
    { data: customerRows, error: customersError }
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('items').select('*').eq('user_id', userId),
    supabase.from('transactions').select('*').eq('user_id', userId),
    supabase.from('orders').select('*').eq('user_id', userId),
    supabase.from('customers').select('*').eq('user_id', userId)
  ]);

  throwIfError(settingsError, 'Failed to load settings');
  throwIfError(itemsError, 'Failed to load items');
  throwIfError(txError, 'Failed to load transactions');
  throwIfError(ordersError, 'Failed to load orders');
  if (customersError) {
    if (isCustomersTableMissing(customersError)) {
      customersTableAvailable = false;
      console.warn('Customers table missing; using empty customer list. Run supabase/schema.sql.');
    } else {
      throwIfError(customersError, 'Failed to load customers');
    }
  }

  return {
    settings: settingsFromRow(settingsRows),
    items: (itemRows || []).map(itemFromRow),
    transactions: (txRows || []).map(transactionFromRow),
    orders: (orderRows || []).map(orderFromRow),
    customers: (customerRows || []).map(customerFromRow)
  };
}

async function writeSupabaseStore(data, userId) {
  const supabase = getSupabase();
  await ensureUserSettings(supabase, userId);

  const { error: settingsError } = await supabase
    .from('settings')
    .upsert(settingsToRow(data.settings, userId), { onConflict: 'user_id' });
  throwIfError(settingsError, 'Failed to save settings');

  await syncTable(
    supabase,
    'items',
    data.items.map((item) => itemToRow(item, userId)),
    userId
  );
  await syncTable(
    supabase,
    'transactions',
    data.transactions.map((tx) => transactionToRow(tx, userId)),
    userId
  );
  await syncTable(
    supabase,
    'orders',
    data.orders.map((order) => orderToRow(order, userId)),
    userId
  );
  await syncCustomersTable(supabase, data.customers || [], userId);
}

const jsonFallbackUsers = new Set();

async function readStore(userId) {
  if (!userId) throw new Error('User id is required.');

  requireSupabaseInProduction();

  if (!isSupabaseEnabled()) return readJsonStore(userId);

  try {
    const data = await readSupabaseStore(userId);
    jsonFallbackUsers.delete(userId);
    return data;
  } catch (err) {
    rejectJsonFallback(err);
    if (!jsonFallbackUsers.has(userId)) {
      console.warn(`Supabase unavailable for user ${userId} (${err.message}), using local JSON.`);
    }
    jsonFallbackUsers.add(userId);
    return readJsonStore(userId);
  }
}

async function writeStore(data, userId) {
  if (!userId) throw new Error('User id is required.');

  requireSupabaseInProduction();

  if (!isSupabaseEnabled()) {
    writeJsonStore(data, userId);
    return;
  }

  if (jsonFallbackUsers.has(userId)) {
    if (isServerlessRuntime()) {
      throw new Error('Database write failed earlier. Redeploy with valid Supabase credentials.');
    }
    writeJsonStore(data, userId);
    return;
  }

  try {
    await writeSupabaseStore(data, userId);
  } catch (err) {
    rejectJsonFallback(err);
    console.warn(`Supabase write failed for user ${userId} (${err.message}), saving to local JSON.`);
    jsonFallbackUsers.add(userId);
    writeJsonStore(data, userId);
  }
}

function dataSourceLabel() {
  if (isServerlessRuntime() && isSupabaseEnabled()) return 'Supabase (per user)';
  if (!isSupabaseEnabled()) return `JSON (${DATA_DIR}/users/)`;
  if (jsonFallbackUsers.size) return `JSON (${DATA_DIR}/users/, Supabase fallback)`;
  return 'Supabase (per user)';
}

function normalizeShopName(name) {
  return String(name || '').trim().toLowerCase();
}

async function isShopNameTaken(shopName, excludeUserId) {
  const normalized = normalizeShopName(shopName);
  if (!normalized) return false;

  if (isSupabaseEnabled()) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('settings')
      .select('user_id')
      .neq('user_id', excludeUserId)
      .ilike('shop_name', normalized);
    throwIfError(error, 'Failed to check shop name');
    return (data || []).length > 0;
  }

  const usersDir = path.join(DATA_DIR, 'users');
  if (!fs.existsSync(usersDir)) return false;
  for (const uid of fs.readdirSync(usersDir)) {
    if (uid === excludeUserId) continue;
    try {
      const store = readJsonStore(uid);
      if (normalizeShopName(store.settings?.shopName) === normalized) return true;
    } catch (_) { /* skip invalid user store */ }
  }
  return false;
}

module.exports = {
  readStore,
  writeStore,
  readSupabaseStore,
  writeSupabaseStore,
  ensureUserSettings,
  isSupabaseEnabled,
  isServerlessRuntime,
  dataSourceLabel,
  readJsonStore,
  writeJsonStore,
  itemToRow,
  itemFromRow,
  settingsToRow,
  settingsFromRow,
  transactionToRow,
  transactionFromRow,
  orderToRow,
  orderFromRow,
  defaultSettings,
  emptyStore,
  LOCAL_DEV_USER_ID,
  isShopNameTaken,
  normalizeShopName
};
