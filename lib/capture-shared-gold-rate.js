const {
  getLiveMetalRates,
  isMetalApiConfigured,
  normalizeMetalCurrency,
  TOLA_GRAMS
} = require('./metal-rates');
const { appendSharedHistory, appendSharedTick } = require('./shared-rates');

const NPR_PER_UNIT = { USD: 133, CAD: 98 };

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daySecondFromDate(date) {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

function displayToNpr(amount, currency) {
  const code = normalizeMetalCurrency(currency);
  const factor = NPR_PER_UNIT[code] || NPR_PER_UNIT.USD;
  return Number(amount) * factor;
}

/**
 * Fetch live metal API and write to shared Supabase/JSON store only when price changes.
 */
async function captureSharedGoldRateIfChanged(options = {}) {
  if (!isMetalApiConfigured()) {
    return { ok: false, skipped: true, reason: 'api_not_configured' };
  }

  const currency = normalizeMetalCurrency(
    options.currency || process.env.CRON_METAL_CURRENCY || 'USD'
  );
  const live = await getLiveMetalRates(currency);
  const tolaNpr = displayToNpr(live.gold.perTola, currency);
  const gramNpr = displayToNpr(live.gold.perGram, currency)
    || Number((tolaNpr / TOLA_GRAMS).toFixed(2));

  if (!tolaNpr || tolaNpr <= 0) {
    return { ok: false, skipped: true, reason: 'invalid_rate' };
  }

  const now = new Date();
  const result = await recordSharedApiGoldReading(tolaNpr, gramNpr, {
    localDate: options.localDate || localDateStr(now),
    now
  });

  return {
    ok: true,
    changed: result.changed,
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gramNpr,
    currency,
    source: live.source,
    liveUpdatedAt: live.updatedAt
  };
}

async function recordSharedApiGoldReading(tolaNpr, gramNpr, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const result = await appendSharedHistory({
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gramNpr,
    priceMode: 'api',
    localDate: options.localDate || localDateStr(now)
  });

  await appendSharedTick({
    date: localDateStr(now),
    updatedAt: now.toISOString(),
    daySecond: daySecondFromDate(now),
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gramNpr,
    priceMode: 'api',
    saved: result.changed
  });

  return result;
}

module.exports = {
  captureSharedGoldRateIfChanged,
  recordSharedApiGoldReading,
  localDateStr,
  daySecondFromDate,
  displayToNpr
};
