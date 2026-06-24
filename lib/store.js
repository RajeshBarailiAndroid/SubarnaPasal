const fs = require('fs');
const path = require('path');
const { getSupabase, isSupabaseEnabled } = require('./supabase');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'store.json');
const LOCAL_DEV_USER_ID = 'local-dev';

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
    silver_rate_per_tola: settings.silverRatePerTola ?? 0,
    silver_rate_per_gram: settings.silverRatePerGram ?? 0,
    currency: settings.currency || 'USD',
    locations: settings.locations || [],
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
    silverRatePerTola: Number(row.silver_rate_per_tola) || 0,
    silverRatePerGram: Number(row.silver_rate_per_gram) || 0,
    currency: row.currency || 'USD',
    locations: row.locations || [],
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

function defaultSettings() {
  return {
    shopName: 'SubarnaPasal',
    shopAddress: '',
    shopPhone: '',
    priceMode: 'manual',
    goldRatePerTola: 0,
    goldRatePerGram: 0,
    silverRatePerTola: 0,
    silverRatePerGram: 0,
    currency: 'USD',
    locations: ['Desk A', 'Desk B', 'Side Desk'],
    rateHistory: [],
    updatedAt: new Date().toISOString()
  };
}

function emptyStore() {
  return {
    settings: defaultSettings(),
    items: [],
    transactions: [],
    orders: []
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
      orders: data.orders || []
    };
  }

  if (userId === LOCAL_DEV_USER_ID && fs.existsSync(LEGACY_DATA_FILE)) {
    const data = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8'));
    return {
      settings: data.settings || defaultSettings(),
      items: data.items || [],
      transactions: data.transactions || [],
      orders: data.orders || []
    };
  }

  return emptyStore();
}

function writeJsonStore(data, userId = LOCAL_DEV_USER_ID) {
  const userFile = userJsonPath(userId);
  fs.mkdirSync(path.dirname(userFile), { recursive: true });
  fs.writeFileSync(userFile, JSON.stringify(data, null, 2));
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
    { data: orderRows, error: ordersError }
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('items').select('*').eq('user_id', userId),
    supabase.from('transactions').select('*').eq('user_id', userId),
    supabase.from('orders').select('*').eq('user_id', userId)
  ]);

  throwIfError(settingsError, 'Failed to load settings');
  throwIfError(itemsError, 'Failed to load items');
  throwIfError(txError, 'Failed to load transactions');
  throwIfError(ordersError, 'Failed to load orders');

  return {
    settings: settingsFromRow(settingsRows),
    items: (itemRows || []).map(itemFromRow),
    transactions: (txRows || []).map(transactionFromRow),
    orders: (orderRows || []).map(orderFromRow)
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
}

const jsonFallbackUsers = new Set();

async function readStore(userId) {
  if (!userId) throw new Error('User id is required.');

  if (!isSupabaseEnabled()) return readJsonStore(userId);

  try {
    const data = await readSupabaseStore(userId);
    jsonFallbackUsers.delete(userId);
    return data;
  } catch (err) {
    if (!jsonFallbackUsers.has(userId)) {
      console.warn(`Supabase unavailable for user ${userId} (${err.message}), using local JSON.`);
    }
    jsonFallbackUsers.add(userId);
    return readJsonStore(userId);
  }
}

async function writeStore(data, userId) {
  if (!userId) throw new Error('User id is required.');

  if (!isSupabaseEnabled() || jsonFallbackUsers.has(userId)) {
    writeJsonStore(data, userId);
    return;
  }

  try {
    await writeSupabaseStore(data, userId);
  } catch (err) {
    console.warn(`Supabase write failed for user ${userId} (${err.message}), saving to local JSON.`);
    jsonFallbackUsers.add(userId);
    writeJsonStore(data, userId);
  }
}

function dataSourceLabel() {
  if (!isSupabaseEnabled()) return `JSON (${DATA_DIR}/users/)`;
  if (jsonFallbackUsers.size) return `JSON (${DATA_DIR}/users/, Supabase fallback)`;
  return 'Supabase (per user)';
}

module.exports = {
  readStore,
  writeStore,
  readSupabaseStore,
  writeSupabaseStore,
  ensureUserSettings,
  isSupabaseEnabled,
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
  LOCAL_DEV_USER_ID
};
