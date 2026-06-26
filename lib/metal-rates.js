const TROY_OZ_GRAMS = 31.1034768;
const TOLA_GRAMS = 11.66;
const CACHE_MS = 5 * 60 * 1000;

const cacheByCurrency = new Map();

const METAL_CURRENCIES = ['USD', 'CAD'];

function normalizeMetalCurrency(currency) {
  const code = String(currency || 'USD').toUpperCase();
  return METAL_CURRENCIES.includes(code) ? code : 'USD';
}

function round(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(digits));
}

function getProvider() {
  return (process.env.METAL_PRICE_PROVIDER || 'gold-api').toLowerCase();
}

function buildMetalQuote(usdPerOz) {
  const perGram = usdPerOz / TROY_OZ_GRAMS;
  const perTola = perGram * TOLA_GRAMS;
  return {
    perOz: round(usdPerOz, 2),
    perGram: round(perGram, 4),
    perTola: round(perTola, 2)
  };
}

function goldApiTimestamp(value) {
  if (!value) return new Date().toISOString();
  const n = Number(value);
  if (Number.isFinite(n)) {
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString();
  }
  return String(value);
}

function buildMetalQuoteFromGoldApiIo(payload) {
  const perOz = Number(payload.price);
  if (!Number.isFinite(perOz) || perOz <= 0) {
    throw new Error('GoldAPI.io returned invalid spot price.');
  }

  const perGram24k = Number(payload.price_gram_24k);
  const perGram = Number.isFinite(perGram24k) && perGram24k > 0
    ? perGram24k
    : perOz / TROY_OZ_GRAMS;
  const perTola = perGram * TOLA_GRAMS;

  const quote = {
    perOz: round(perOz, 2),
    perGram: round(perGram, 4),
    perTola: round(perTola, 2),
    bid: payload.bid != null ? round(payload.bid, 2) : null,
    ask: payload.ask != null ? round(payload.ask, 2) : null
  };

  if (payload.price_gram_22k != null) {
    quote.karatPerGram = {
      k24: round(payload.price_gram_24k, 4),
      k22: round(payload.price_gram_22k, 4),
      k21: round(payload.price_gram_21k, 4),
      k20: round(payload.price_gram_20k, 4),
      k18: round(payload.price_gram_18k, 4)
    };
  }

  return quote;
}

function getApiKey() {
  return String(process.env.METAL_PRICE_API_KEY || process.env.GOLD_API_KEY || '').trim();
}

function usesGoldApiCom() {
  const provider = getProvider();
  return provider === 'gold-api' || provider === 'gold-api.com';
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || data.message || data.detail || res.statusText;
    throw new Error(message || `Metal API request failed (${res.status})`);
  }
  return data;
}

async function fetchFromGoldApiCom(currency = 'USD') {
  const code = normalizeMetalCurrency(currency);
  const [gold, silver] = await Promise.all([
    fetchJson(`https://api.gold-api.com/price/XAU/${code}`),
    fetchJson(`https://api.gold-api.com/price/XAG/${code}`)
  ]);

  const goldOz = Number(gold.price);
  const silverOz = Number(silver.price);
  if (!Number.isFinite(goldOz) || !Number.isFinite(silverOz)) {
    throw new Error('gold-api.com returned invalid prices.');
  }

  return {
    currency: gold.currency || silver.currency || 'USD',
    source: 'gold-api.com',
    updatedAt: gold.updatedAt || silver.updatedAt || new Date().toISOString(),
    gold: buildMetalQuote(goldOz),
    silver: buildMetalQuote(silverOz)
  };
}

async function fetchFromGoldApiIo() {
  const key = getApiKey();
  const headers = { 'x-access-token': key };

  const [gold, silver] = await Promise.all([
    fetchJson('https://www.goldapi.io/api/XAU/USD', { headers }),
    fetchJson('https://www.goldapi.io/api/XAG/USD', { headers })
  ]);

  return {
    currency: 'USD',
    source: 'goldapi.io',
    exchange: gold.exchange || silver.exchange || null,
    updatedAt: goldApiTimestamp(gold.timestamp || silver.timestamp),
    gold: buildMetalQuoteFromGoldApiIo(gold),
    silver: buildMetalQuoteFromGoldApiIo(silver)
  };
}

async function fetchFromMetalsApi() {
  const key = getApiKey();
  const url = new URL('https://metals-api.com/api/latest');
  url.searchParams.set('access_key', key);
  url.searchParams.set('base', 'USD');
  url.searchParams.set('symbols', 'XAU,XAG');

  const data = await fetchJson(url.toString());
  const goldRate = Number(data.rates?.XAU);
  const silverRate = Number(data.rates?.XAG);
  if (!Number.isFinite(goldRate) || !Number.isFinite(silverRate) || goldRate <= 0 || silverRate <= 0) {
    throw new Error('Metals-API returned invalid prices.');
  }

  return {
    currency: 'USD',
    source: 'metals-api',
    updatedAt: data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString(),
    gold: buildMetalQuote(1 / goldRate),
    silver: buildMetalQuote(1 / silverRate)
  };
}

function isMetalApiConfigured() {
  if (usesGoldApiCom()) return true;
  const key = getApiKey();
  return Boolean(key && !key.includes('your-') && key !== 'your-api-key' && key !== 'your-goldapi-key');
}

async function getLiveMetalRates(currency = 'USD') {
  if (!isMetalApiConfigured()) {
    const err = new Error('METAL_PRICE_API_KEY is not set. Use METAL_PRICE_PROVIDER=gold-api or add a GoldAPI.io key.');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const code = normalizeMetalCurrency(currency);
  const cached = cacheByCurrency.get(code);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const provider = getProvider();
  let data;
  if (provider === 'metals-api') {
    data = await fetchFromMetalsApi();
  } else if (provider === 'goldapi' || provider === 'goldapi.io') {
    data = await fetchFromGoldApiIo();
  } else {
    data = await fetchFromGoldApiCom(code);
  }

  cacheByCurrency.set(code, { data, expiresAt: Date.now() + CACHE_MS });
  return data;
}

async function getLiveMetalRatesUsd() {
  return getLiveMetalRates('USD');
}

module.exports = {
  getLiveMetalRates,
  getLiveMetalRatesUsd,
  isMetalApiConfigured,
  normalizeMetalCurrency,
  TOLA_GRAMS,
  TROY_OZ_GRAMS
};
