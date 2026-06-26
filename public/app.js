const TOLA_GRAMS = 11.66;
const AANA_PER_TOLA = 16;
const LAAL_PER_AANA = 6.25;
const LAAL_PER_TOLA = AANA_PER_TOLA * LAAL_PER_AANA;
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

function displayToNprAt(amount, currency) {
  const c = CURRENCIES[currency] || CURRENCIES.USD;
  return Number(amount) * c.nprPerUnit;
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
  renderRateHistoryChart();
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

function formatRateHistoryDate(row) {
  const raw = row.date || String(row.updatedAt || '').slice(0, 10);
  if (!raw) return '—';
  const [y, m, d] = raw.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? raw : dt.toLocaleDateString();
}

function localDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayDateStr() {
  return localDateStr();
}

function rowLocalDateStr(row) {
  if (row.updatedAt) return localDateStr(new Date(row.updatedAt));
  return row.date || String(row.updatedAt || '').slice(0, 10);
}

function isRowToday(row) {
  return rowLocalDateStr(row) === todayDateStr();
}

function localDayStartIso(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).toISOString();
}

function isLiveDailyApiMode() {
  return currentRateHistoryPriceMode() === 'api';
}

const DAILY_CHART_MIN_GAP_MS = 1000;
const DAY_SECONDS = 86400;
const LIVE_DAILY_MAX_TICKS_PER_DAY = 86400;

function daySecondFromIso(iso) {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 0;
  return dt.getHours() * 3600 + dt.getMinutes() * 60 + dt.getSeconds();
}

function format24HourClock(daySecond) {
  const sec = Math.max(0, Math.min(DAY_SECONDS - 1, Math.floor(daySecond)));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function resetLiveDailySecondSeries() {
  liveDailySecondSeries = [];
  liveDailySecondSeq = 0;
}

function pushLiveDailySecondTick(tolaNpr, gramNpr, saved = false) {
  if (!tolaNpr || tolaNpr <= 0) return;
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  const now = new Date();
  const updatedAt = now.toISOString();
  const daySecond = daySecondFromIso(updatedAt);
  liveDailySecondSeq += 1;
  const entry = {
    date: todayDateStr(),
    updatedAt,
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gram,
    daySecond,
    secondNum: liveDailySecondSeq,
    value: nprToDisplay(tolaNpr),
    saved: !!saved,
    priceMode: 'api'
  };
  const sameSlot = liveDailySecondSeries.findIndex(
    (row) => row.date === entry.date && row.daySecond === daySecond
  );
  if (sameSlot >= 0) liveDailySecondSeries[sameSlot] = entry;
  else liveDailySecondSeries.push(entry);
  liveDailySecondSeries.sort((a, b) => a.daySecond - b.daySecond || a.updatedAt.localeCompare(b.updatedAt));
  const today = todayDateStr();
  liveDailySecondSeries = liveDailySecondSeries
    .filter((row) => row.date === today)
    .slice(-LIVE_DAILY_MAX_TICKS_PER_DAY);
}

function chartRowTimeMs(row) {
  if (row.chartTime != null) return row.chartTime;
  return new Date(row.updatedAt || row.date).getTime();
}

function nextChartTimeAfter(lastRow, minGapMs = DAILY_CHART_MIN_GAP_MS) {
  const now = Date.now();
  if (!lastRow) return now;
  const lastT = new Date(lastRow.updatedAt).getTime();
  return Math.max(now, lastT + minGapMs);
}

function spreadDailyChartTimestamps(rows) {
  if (!rows.length) return rows;
  const out = rows.map((row) => ({
    ...row,
    chartTime: chartRowTimeMs(row)
  }));
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    const curr = out[i];
    const minT = prev.chartTime + DAILY_CHART_MIN_GAP_MS;
    if (curr.value !== prev.value || curr.chartTime <= prev.chartTime) {
      if (curr.chartTime < minT) curr.chartTime = minT;
    }
    const spreadIso = new Date(curr.chartTime).toISOString();
    if (spreadIso !== curr.updatedAt) {
      curr.label = formatRateHistoryIntradayLabel(spreadIso);
    }
  }
  return out;
}

function normalizeRateHistoryRow(row) {
  const updatedAt = row.updatedAt
    || (row.date ? `${row.date}T12:00:00.000Z` : new Date().toISOString());
  return {
    ...row,
    date: row.date || String(updatedAt).slice(0, 10),
    updatedAt,
    priceMode: row.priceMode === 'api' ? 'api' : 'manual'
  };
}

function formatRateHistoryIntradayLabel(updatedAt) {
  if (!updatedAt) return '—';
  const dt = new Date(updatedAt);
  if (Number.isNaN(dt.getTime())) return updatedAt;
  return dt.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatRateHistoryTableWhen(row) {
  if (isRowToday(row)) {
    return `${formatRateHistoryDate(row)} · ${formatRateHistoryIntradayLabel(row.updatedAt)}`;
  }
  return formatRateHistoryDate(row);
}

function todaySavedRateRows() {
  const mode = currentRateHistoryPriceMode();
  return liveDailyReadings
    .filter((row) => row.priceMode === mode && isRowToday(row))
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));
}

function rowToDailyChartPoint(row, opts = {}) {
  return {
    date: row.date || String(row.updatedAt || '').slice(0, 10),
    updatedAt: row.updatedAt || null,
    goldRatePerTola: row.goldRatePerTola,
    value: nprToDisplay(row.goldRatePerTola),
    bucket: row.updatedAt || row.date,
    label: formatRateHistoryIntradayLabel(row.updatedAt),
    liveTick: !!opts.liveTick,
    saved: !!opts.saved,
    flatAnchor: !!opts.flatAnchor
  };
}

function ensureLiveDailyFlatAnchor(tolaNpr, gramNpr) {
  const saved = todaySavedRateRows();
  if (saved.length) {
    liveDailyFlatAnchor = null;
    return;
  }
  if (!tolaNpr || tolaNpr <= 0) return;
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  if (!liveDailyFlatAnchor) {
    liveDailyFlatAnchor = normalizeRateHistoryRow({
      date: todayDateStr(),
      updatedAt: localDayStartIso(),
      goldRatePerTola: tolaNpr,
      goldRatePerGram: gram,
      priceMode: 'api',
      flatAnchor: true
    });
  }
}

function buildDailyChartSeries() {
  const historyRows = rateHistoryForDisplay()
    .filter(isRowToday)
    .filter((row) => Number(row.goldRatePerTola) > 0)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));

  const fromRateHistory = () => {
    if (!historyRows.length) return [];
    const spread = spreadDailyChartTimestamps(historyRows.map((row, i) => ({
      ...rowToDailyChartPoint(row, { saved: true }),
      secondNum: i + 1,
      daySecond: daySecondFromIso(row.updatedAt),
      label: formatRateHistoryIntradayLabel(row.updatedAt)
    })));
    return attachRateHistoryComparisons(spread);
  };

  if (isLiveDailyApiMode() && liveDailySecondSeries.length) {
    return attachRateHistoryComparisons(liveDailySecondSeries.map((row, i) => ({
      ...rowToDailyChartPoint(row, {
        liveTick: i === liveDailySecondSeries.length - 1,
        saved: !!row.saved
      }),
      daySecond: row.daySecond ?? daySecondFromIso(row.updatedAt),
      secondNum: row.secondNum,
      label: format24HourClock(row.daySecond ?? daySecondFromIso(row.updatedAt))
    })));
  }

  return fromRateHistory();
}

function padSinglePointSeries(sorted, period) {
  if (sorted.length !== 1) return sorted;
  const only = sorted[0];
  if (period === 'daily') {
    const dayStart = localDayStartIso();
    const now = new Date().toISOString();
    return [
      {
        ...only,
        updatedAt: dayStart,
        bucket: dayStart,
        daySecond: 0,
        label: '00:00:00',
        chartTime: new Date(dayStart).getTime()
      },
      {
        ...only,
        updatedAt: now,
        bucket: now,
        daySecond: daySecondFromIso(now),
        label: formatRateHistoryIntradayLabel(now),
        chartTime: Date.now()
      }
    ];
  }
  return [{ ...only }, { ...only, chartPadEnd: true }];
}

function chartPointsFrom24Hour(sorted, pad, innerW, innerH, minV, span) {
  return sorted.map((row) => {
    const sec = row.daySecond ?? daySecondFromIso(row.updatedAt);
    const x = pad.left + (sec / DAY_SECONDS) * innerW;
    const y = pad.top + innerH - ((row.value - minV) / span) * innerH;
    return { x, y, row };
  });
}

function buildStepLinePath(points) {
  if (!points.length) return '';
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    d += ` H${points[i].x.toFixed(1)} V${points[i].y.toFixed(1)}`;
  }
  return d;
}

function buildStepAreaPath(points, baseY) {
  if (!points.length) return '';
  const line = buildStepLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x.toFixed(1)},${baseY} L${first.x.toFixed(1)},${baseY} Z`;
}

function buildStockLinePath(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function build24HourXGrid(pad, innerW, innerH, h) {
  const hours = [0, 4, 8, 12, 16, 20, 24];
  return hours.map((hour) => {
    const x = pad.left + ((hour * 3600) / DAY_SECONDS) * innerW;
    const label = hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`;
    return `<line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${pad.top + innerH}" class="gp-vgrid"/>
      <text x="${x.toFixed(1)}" y="${h - 10}" class="gp-x-label" text-anchor="middle">${label}</text>`;
  }).join('');
}

function renderGoldPriceOrgHeader(sorted, mode, period) {
  const open = sorted[0];
  const latest = sorted[sorted.length - 1];
  const values = sorted.map((r) => r.value);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const sessionChange = Number((latest.value - open.value).toFixed(4));
  const sessionPct = open.value
    ? Number(((sessionChange / open.value) * 100).toFixed(2))
    : 0;
  const dir = stockSessionDirection(sorted);
  const sign = sessionChange > 0 ? '+' : '';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  const periodLabel = ratePeriodLabel(period);
  const isLive = period === 'daily' && isLiveDailyApiMode();
  const updatedLabel = isLive && liveDailyCurrentTick
    ? formatRateHistoryTableWhen(liveDailyCurrentTick)
    : formatRateHistoryTableWhen(latest);
  return `
    <div class="goldprice-chart-header">
      <div class="goldprice-header-main">
        <div class="goldprice-brand">
          <span class="goldprice-icon" aria-hidden="true">●</span>
          <div>
            <h4 class="goldprice-title">${t('goldSpotPrice')}</h4>
            <span class="goldprice-sub">${periodLabel} · ${rateHistoryModeLabel(mode)}</span>
          </div>
        </div>
        <div class="goldprice-quote is-${dir}">
          <span class="goldprice-value">${formatCurrencyAmount(latest.value)}</span>
          <span class="goldprice-unit">/ ${t('tolaUnit')}</span>
          <span class="goldprice-change">
            <span class="goldprice-arrow" aria-hidden="true">${arrow}</span>
            ${sign}${formatCurrencyAmount(sessionChange)}
            <span class="goldprice-pct">(${sign}${sessionPct}%)</span>
          </span>
        </div>
      </div>
      <div class="goldprice-stats">
        <span class="goldprice-stat"><em>${t('chartOpen')}</em> ${formatCurrencyAmount(open.value)}</span>
        <span class="goldprice-stat"><em>${t('chartHigh')}</em> ${formatCurrencyAmount(high)}</span>
        <span class="goldprice-stat"><em>${t('chartLow')}</em> ${formatCurrencyAmount(low)}</span>
        <span class="goldprice-stat goldprice-updated"><em>${t('chartUpdated')}</em> ${updatedLabel}</span>
      </div>
    </div>`;
}

function goldPriceOrgSvgDefs() {
  return `<defs>
    <linearGradient id="goldPriceArea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(212,175,55,0.5)"/>
      <stop offset="45%" stop-color="rgba(201,162,39,0.18)"/>
      <stop offset="100%" stop-color="rgba(201,162,39,0)"/>
    </linearGradient>
    <filter id="goldPriceGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;
}

function buildGoldPriceAreaPath(points, baseY, useStep) {
  if (points.length < 2) return '';
  const line = useStep ? buildStepLinePath(points) : buildStockLinePath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last.x.toFixed(1)},${baseY} L${first.x.toFixed(1)},${baseY} Z`;
}

function buildGoldPriceLinePath(points, useStep) {
  return useStep ? buildStepLinePath(points) : buildStockLinePath(points);
}

function buildGoldPriceXGrid(pad, innerW, innerH, h, period) {
  if (period === 'daily' && isLiveDailyApiMode()) {
    return build24HourXGrid(pad, innerW, innerH, h);
  }
  return '';
}

function renderGoldPriceOrgChart(el, sorted, mode, period, intradayList) {
  const isDailyLive = period === 'daily' && isLiveDailyApiMode();
  const useStep = isDailyLive;
  const w = 900;
  const h = isDailyLive ? 360 : 300;
  const pad = { top: 16, right: 78, bottom: 40, left: 12 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const values = sorted.map((r) => r.value);
  const { minV, maxV } = chartValueBounds(values);
  const span = maxV - minV || 1;
  const points = isDailyLive
    ? chartPointsFrom24Hour(sorted, pad, innerW, innerH, minV, span)
    : chartPointsFromSeries(sorted, pad, innerW, innerH, minV, span, period);
  const baseY = pad.top + innerH;
  const sessionDir = stockSessionDirection(sorted);
  const linePath = buildGoldPriceLinePath(points, useStep);
  const areaPath = buildGoldPriceAreaPath(points, baseY, useStep);
  const latest = sorted[sorted.length - 1];
  const lastPt = points[points.length - 1];

  const yTicks = 5;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = minV + (span * i) / yTicks;
    const y = pad.top + innerH - (i / yTicks) * innerH;
    return `<text x="${w - 8}" y="${y + 4}" class="gp-y-label" text-anchor="end">${formatChartAxisAmount(v)}</text>
      <line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" class="gp-hgrid"/>`;
  }).join('');

  let xLabels = buildGoldPriceXGrid(pad, innerW, innerH, h, period);
  if (!xLabels && points.length) {
    const n = points.length;
    const indices = n <= 5 ? points.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
    xLabels = indices.map((i) => {
      const label = sorted[i].liveTick ? t('liveRateNow') : sorted[i].label;
      return `<text x="${points[i].x}" y="${h - 8}" class="gp-x-label" text-anchor="middle">${label}</text>`;
    }).join('');
  }

  const lastDot = lastPt
    ? `<g transform="translate(${lastPt.x.toFixed(1)},${lastPt.y.toFixed(1)})">
        <circle r="9" class="gp-live-pulse is-${sessionDir}"/>
        <circle r="5" class="gp-live-dot is-${sessionDir}">
          <title>${formatCurrencyAmount(latest.value)}</title>
        </circle>
      </g>`
    : '';

  el.innerHTML = `
    <div class="goldprice-chart">
      ${renderGoldPriceOrgHeader(sorted, mode, period)}
      <div class="goldprice-canvas-wrap">
        <svg class="goldprice-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${t('goldRateChart')}" preserveAspectRatio="xMidYMid meet">
          ${goldPriceOrgSvgDefs()}
          <rect x="0" y="0" width="${w}" height="${h}" class="gp-bg"/>
          ${yLabels}
          ${xLabels}
          ${areaPath ? `<path d="${areaPath}" class="gp-area" fill="url(#goldPriceArea)"/>` : ''}
          ${linePath ? `<path d="${linePath}" class="gp-line" filter="url(#goldPriceGlow)"/>` : ''}
          ${lastDot}
        </svg>
      </div>
      <div class="goldprice-footer">
        <span>${ratePeriodHint(period)}</span>
        <span class="goldprice-powered">${t('goldChartPowered')}</span>
      </div>
      ${intradayList}
    </div>`;
  const liveBanner = document.getElementById('live-daily-rate-now');
  if (liveBanner) liveBanner.hidden = true;
  updateRateHistoryClearBtn();
}

function stockSessionDirection(sorted) {
  if (sorted.length < 2) return 'flat';
  const change = sorted[sorted.length - 1].value - sorted[0].value;
  if (change > 0) return 'up';
  if (change < 0) return 'down';
  return 'flat';
}

function chartPointsFromSeries(sorted, pad, innerW, innerH, minV, span, period) {
  const useTimeAxis = period === 'daily';
  let minT = 0;
  let maxT = 1;
  if (useTimeAxis) {
    const times = sorted.map((row) => chartRowTimeMs(row));
    const dayStart = new Date(localDayStartIso()).getTime();
    const now = Date.now();
    minT = Math.min(...times, dayStart);
    maxT = Math.max(...times, now);
    if (maxT <= minT) maxT = minT + 60000;
  }
  const n = sorted.length;
  return sorted.map((row, i) => {
    const x = useTimeAxis
      ? pad.left + ((chartRowTimeMs(row) - minT) / (maxT - minT)) * innerW
      : pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = pad.top + innerH - ((row.value - minV) / span) * innerH;
    return { x, y, row };
  });
}

function updateLiveDailyTick(tolaNpr, gramNpr, priceMode) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  liveDailyCurrentTick = normalizeRateHistoryRow({
    date: todayDateStr(),
    updatedAt: new Date().toISOString(),
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2)),
    priceMode: mode,
    liveTick: true
  });
}

function renderLiveDailyRateNow() {
  const el = document.getElementById('live-daily-rate-now');
  if (!el) return;
  const chartEl = document.getElementById('rate-history-chart');
  const chartHasData = chartEl?.querySelector('.goldprice-chart');
  const show = activeView === 'settings'
    && currentRateHistoryPeriod() === 'daily'
    && isLiveDailyApiMode()
    && liveDailyCurrentTick
    && !chartHasData;
  if (!show) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'live-daily-rate-now goldprice-live-banner';
  const open = liveDailySecondSeries[0];
  const latest = liveDailyCurrentTick;
  const openVal = open ? nprToDisplay(open.goldRatePerTola) : nprToDisplay(latest.goldRatePerTola);
  const latestVal = nprToDisplay(latest.goldRatePerTola);
  const change = Number((latestVal - openVal).toFixed(4));
  const pct = openVal ? Number(((change / openVal) * 100).toFixed(2)) : 0;
  const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  const sign = change > 0 ? '+' : '';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
  el.innerHTML = `
    <span class="live-daily-rate-badge">${t('liveRateNow')}</span>
    <strong class="live-daily-rate-price stock-live-price is-${dir}">${formatMoney(latest.goldRatePerTola)}/tola</strong>
    <span class="stock-chart-change is-${dir} stock-live-change">
      <span class="stock-chart-arrow" aria-hidden="true">${arrow}</span>
      ${sign}${formatCurrencyAmount(change)} (${sign}${pct}%)
    </span>
    <span class="live-daily-rate-time">${formatRateHistoryTableWhen(latest)}</span>
    <span class="live-daily-rate-hint">${t('liveRateNotSaved')}</span>`;
}

function todayRateHistoryRows() {
  if (currentRateHistoryPeriod() === 'daily') {
    return buildDailyChartSeries();
  }
  return rateHistoryForDisplay()
    .filter(isRowToday)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));
}

function hydrateLiveDailyReadingsFromCache() {
  liveDailyReadings = rateHistoryForDisplay()
    .filter(isRowToday)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));
}

function hydrateLiveDailySecondSeriesFromTicks(ticks) {
  liveDailySecondSeries = (ticks || []).map((row) => ({
    date: row.date || todayDateStr(),
    updatedAt: row.updatedAt,
    goldRatePerTola: row.goldRatePerTola,
    goldRatePerGram: row.goldRatePerGram,
    daySecond: row.daySecond ?? daySecondFromIso(row.updatedAt),
    secondNum: row.secondNum,
    value: nprToDisplay(row.goldRatePerTola),
    saved: !!row.saved,
    priceMode: row.priceMode === 'api' ? 'api' : 'manual'
  })).sort((a, b) => a.daySecond - b.daySecond || a.updatedAt.localeCompare(b.updatedAt));
  liveDailySecondSeq = liveDailySecondSeries.length
    ? Math.max(...liveDailySecondSeries.map((r) => r.secondNum || 0))
    : 0;
}

async function loadSharedGoldRates() {
  const mode = currentRateHistoryPriceMode();
  try {
    const payload = await api(
      `/api/shared/gold-rates?date=${encodeURIComponent(todayDateStr())}&priceMode=${encodeURIComponent(mode)}`
    );
    rateHistoryCache = (payload.history || []).map(normalizeRateHistoryRow);
    hydrateLiveDailyReadingsFromCache();
    hydrateLiveDailySecondSeriesFromTicks(payload.ticks || []);
  } catch (_) { /* background load */ }
}

const SHARED_TICK_FLUSH_MS = 10000;
let sharedTickQueue = new Map();
let sharedTickFlushTimer = null;

function sharedTickKey(row) {
  const mode = row.priceMode === 'api' ? 'api' : 'manual';
  return `${row.date}|${mode}|${row.daySecond}`;
}

function rowToSharedTickPayload(row) {
  return {
    date: row.date || todayDateStr(),
    updatedAt: row.updatedAt,
    daySecond: row.daySecond ?? daySecondFromIso(row.updatedAt),
    secondNum: row.secondNum,
    goldRatePerTola: row.goldRatePerTola,
    goldRatePerGram: row.goldRatePerGram,
    priceMode: row.priceMode || (isLiveDailyApiMode() ? 'api' : 'manual'),
    saved: !!row.saved
  };
}

function queueSharedGraphTick(row) {
  if (!row?.goldRatePerTola) return;
  sharedTickQueue.set(sharedTickKey(row), rowToSharedTickPayload(row));
  if (row.saved) {
    flushSharedGraphTicks();
    return;
  }
  scheduleSharedGraphTickFlush();
}

function scheduleSharedGraphTickFlush() {
  if (sharedTickFlushTimer) return;
  sharedTickFlushTimer = setTimeout(() => {
    sharedTickFlushTimer = null;
    flushSharedGraphTicks();
  }, SHARED_TICK_FLUSH_MS);
}

async function flushSharedGraphTicks() {
  if (!sharedTickQueue.size) return;
  const ticks = [...sharedTickQueue.values()];
  sharedTickQueue.clear();
  if (sharedTickFlushTimer) {
    clearTimeout(sharedTickFlushTimer);
    sharedTickFlushTimer = null;
  }
  try {
    await api('/api/shared/gold-rates/ticks', {
      method: 'POST',
      body: JSON.stringify({ ticks })
    });
  } catch (_) { /* background save */ }
}

function sameGoldRateReading(a, tolaNpr, gramNpr) {
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  return Number(a.goldRatePerTola) === Number(tolaNpr)
    && Number(a.goldRatePerGram) === Number(gram);
}

function pushLiveDailyReading(tolaNpr, gramNpr, priceMode) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  if (!tolaNpr || tolaNpr <= 0) return false;
  const gram = gramNpr || Number((tolaNpr / TOLA_GRAMS).toFixed(2));
  const last = liveDailyReadings[liveDailyReadings.length - 1];
  if (last && sameGoldRateReading(last, tolaNpr, gram)) return false;
  const updatedAt = new Date(nextChartTimeAfter(last, DAILY_CHART_MIN_GAP_MS)).toISOString();
  const entry = normalizeRateHistoryRow({
    date: todayDateStr(),
    updatedAt,
    goldRatePerTola: tolaNpr,
    goldRatePerGram: gram,
    priceMode: mode
  });
  liveDailyReadings.push(entry);
  if (liveDailyReadings.length > 500) liveDailyReadings.shift();
  return true;
}

function updateMetalRateHeaderFromLive(live) {
  const goldEl = document.getElementById('metal-rate-gold');
  const silverEl = document.getElementById('metal-rate-silver');
  const bodyEl = document.getElementById('metal-rates-body');
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
}

async function captureLiveDailyRate() {
  const mode = effectivePriceMode() === 'api' ? 'api' : 'manual';
  let tolaNpr = goldRateCache;
  let gramNpr = Number((tolaNpr / TOLA_GRAMS).toFixed(2));

  if (mode === 'api') {
    try {
      const live = await api(`/api/metal-rates?currency=${encodeURIComponent(currencyCode())}`);
      tolaNpr = displayToNpr(live.gold.perTola);
      gramNpr = displayToNpr(live.gold.perGram);
      goldRateCache = tolaNpr;
      silverRateCache = displayToNpr(live.silver.perTola);
      updateMetalRateHeaderFromLive(live);
      refreshMetalPriceFields();
      updateGoldCalculator();
      updateOrderTotalPreview();
    } catch (err) {
      if (tolaNpr <= 0) throw err;
    }
  } else if (tolaNpr <= 0) {
    return;
  }

  if (mode === 'api') {
    const added = pushLiveDailyReading(tolaNpr, gramNpr, mode);
    pushLiveDailySecondTick(tolaNpr, gramNpr, added);
    updateLiveDailyTick(tolaNpr, gramNpr, mode);
    const daySecond = daySecondFromIso(new Date().toISOString());
    const tick = liveDailySecondSeries.find((r) => r.daySecond === daySecond)
      || liveDailySecondSeries[liveDailySecondSeries.length - 1];
    if (tick) queueSharedGraphTick(tick);
    if (added) {
      persistDailyGoldRateSnapshot(mode, { goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr });
    }
  } else {
    const added = pushLiveDailyReading(tolaNpr, gramNpr, mode);
    if (added) {
      persistDailyGoldRateSnapshot(mode, { goldRatePerTola: tolaNpr, goldRatePerGram: gramNpr });
    }
  }

  if (activeView === 'settings' && currentRateHistoryPeriod() === 'daily') {
    renderLiveDailyRateNow();
    renderRateHistoryChart();
    renderRateHistoryTable();
  }
}

function renderRateIntradayReadingsHtml(rows, period) {
  if (period !== 'daily' || !rows.length) return '';
  const compared = attachRateHistoryComparisons(rows);
  return `
    <div class="rate-intraday-readings">
      <h4 class="rate-intraday-title">${t('rateHistoryToday')}</h4>
      <div class="table-wrap">
        <table class="data-table rate-intraday-table">
          <thead><tr>
            <th>${t('date')}</th>
            <th>${t('perTolaCol')}</th>
            <th>${t('changeCol')}</th>
          </tr></thead>
          <tbody>
            ${compared.map((row) => {
              const changeHtml = row.change == null
                ? '—'
                : `<span class="rate-chart-compare ${rateHistoryChangeClass(row.change)}">${formatRateHistoryChange(row, 'daily')}</span>`;
              return `<tr>
                <td>${formatRateHistoryTableWhen(row)}</td>
                <td>${formatMoney(row.goldRatePerTola)}</td>
                <td>${changeHtml}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function currentRateHistoryPeriod() {
  const active = document.querySelector('.rate-history-period [data-rate-period].is-active');
  const period = active?.dataset.ratePeriod;
  if (period === 'weekly' || period === 'monthly' || period === 'yearly') return period;
  return 'daily';
}

function ratePeriodLabel(period) {
  const keys = {
    daily: 'ratePeriodDaily',
    weekly: 'ratePeriodWeekly',
    monthly: 'ratePeriodMonthly',
    yearly: 'ratePeriodYearly'
  };
  return t(keys[period] || keys.daily);
}

function ratePeriodHint(period) {
  const keys = {
    daily: 'ratePeriodDailyHint',
    weekly: 'ratePeriodWeeklyHint',
    monthly: 'ratePeriodMonthlyHint',
    yearly: 'ratePeriodYearlyHint'
  };
  return t(keys[period] || keys.daily);
}

function rateCompareVsPrevLabel(period) {
  const keys = {
    daily: 'rateCompareVsPrevReading',
    weekly: 'rateCompareVsPrevWeek',
    monthly: 'rateCompareVsPrevMonth',
    yearly: 'rateCompareVsPrevMonth'
  };
  return t(keys[period] || keys.daily);
}

function getRateHistoryBucketKey(dateStr, period) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (period === 'monthly' || period === 'yearly') {
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  if (period === 'weekly') {
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(dt);
    monday.setDate(diff);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  }
  return dateStr;
}

function formatRateHistoryBucketLabel(bucket, period) {
  if (period === 'daily') return formatRateHistoryDate({ date: bucket });
  if (period === 'monthly' || period === 'yearly') {
    const [y, m] = bucket.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  const [y, m, d] = bucket.split('-').map(Number);
  const weekStart = new Date(y, m - 1, d);
  return weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function attachRateHistoryComparisons(rows) {
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const change = prev ? Number((row.value - prev.value).toFixed(4)) : null;
    const changePct = prev && prev.value
      ? Number(((change / prev.value) * 100).toFixed(2))
      : null;
    return { ...row, change, changePct };
  });
}

function formatRateHistoryChange(row, period) {
  if (row.change == null) return '';
  const sign = row.change > 0 ? '+' : '';
  const amount = formatCurrencyAmount(row.change);
  const pct = row.changePct != null ? ` (${sign}${row.changePct}%)` : '';
  return `${sign}${amount}${pct} ${rateCompareVsPrevLabel(period)}`;
}

function rateHistoryChangeClass(change) {
  if (change == null) return '';
  if (change > 0) return 'is-up';
  if (change < 0) return 'is-down';
  return 'is-flat';
}

function aggregateRateHistoryForChart(rows, period) {
  const sorted = [...rows]
    .map((row) => ({
      date: row.date || String(row.updatedAt || '').slice(0, 10),
      updatedAt: row.updatedAt || null,
      goldRatePerTola: row.goldRatePerTola,
      value: nprToDisplay(row.goldRatePerTola)
    }))
    .filter((row) => row.date && row.value > 0)
    .sort((a, b) => (a.updatedAt || a.date).localeCompare(b.updatedAt || b.date));

  let source = sorted;
  if (period === 'yearly') {
    const year = new Date().getFullYear();
    source = sorted.filter((row) => Number(row.date.slice(0, 4)) === year);
  }

  if (period === 'daily') {
    const intraday = source.filter((row) => isRowToday(row));
    return attachRateHistoryComparisons(intraday.map((row) => ({
      ...row,
      bucket: row.updatedAt || row.date,
      label: formatRateHistoryIntradayLabel(row.updatedAt)
    })));
  }

  const bucketPeriod = period === 'yearly' ? 'yearly' : period;
  const buckets = new Map();
  source.forEach((row) => {
    const bucket = getRateHistoryBucketKey(row.date, bucketPeriod);
    const sortKey = row.updatedAt || row.date;
    const existing = buckets.get(bucket);
    if (!existing || sortKey > (existing.updatedAt || existing.date)) {
      buckets.set(bucket, {
        ...row,
        bucket,
        label: formatRateHistoryBucketLabel(bucket, bucketPeriod)
      });
    }
  });
  return attachRateHistoryComparisons(
    [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))
  );
}

function currentRateHistoryPriceMode() {
  const checked = document.querySelector('#settings-form [name="priceMode"]:checked');
  if (checked) return checked.value === 'api' ? 'api' : 'manual';
  return settingsPriceMode === 'api' ? 'api' : 'manual';
}

function effectivePriceMode() {
  return currentRateHistoryPriceMode();
}

function readManualRatesFromForm() {
  const priceForm = document.getElementById('settings-form');
  if (!priceForm) {
    return {
      goldRatePerTola: goldRateCache,
      goldRatePerGram: Number((goldRateCache / TOLA_GRAMS).toFixed(2)),
      silverRatePerTola: silverRateCache,
      silverRatePerGram: Number((silverRateCache / TOLA_GRAMS).toFixed(2))
    };
  }
  const goldRatePerTola = parseTolaRateInput(priceForm.goldRatePerTola?.value)
    || parseTolaFromGramInput(priceForm.goldRatePerGram?.value)
    || goldRateCache;
  const silverRatePerTola = parseTolaRateInput(priceForm.silverRatePerTola?.value)
    || parseTolaFromGramInput(priceForm.silverRatePerGram?.value)
    || silverRateCache;
  return {
    goldRatePerTola,
    goldRatePerGram: Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola,
    silverRatePerGram: Number((silverRatePerTola / TOLA_GRAMS).toFixed(2))
  };
}

function resolveManualMetalRates(settings = null) {
  const fromForm = readManualRatesFromForm();
  const goldRatePerTola = Number(settings?.goldRatePerTola ?? fromForm.goldRatePerTola) || 0;
  const silverRatePerTola = Number(settings?.silverRatePerTola ?? fromForm.silverRatePerTola) || 0;
  return {
    goldRatePerTola,
    goldRatePerGram: Number(settings?.goldRatePerGram)
      ?? Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
    silverRatePerTola,
    silverRatePerGram: Number(settings?.silverRatePerGram)
      ?? Number((silverRatePerTola / TOLA_GRAMS).toFixed(2))
  };
}

function applyManualRatesToApp(metal) {
  goldRateCache = metal.goldRatePerTola;
  silverRateCache = metal.silverRatePerTola;
  const goldEl = document.getElementById('metal-rate-gold');
  const silverEl = document.getElementById('metal-rate-silver');
  const bodyEl = document.getElementById('metal-rates-body');
  if (bodyEl) bodyEl.hidden = true;
  if (goldEl) {
    goldEl.hidden = false;
    goldEl.textContent =
      `Gold: ${formatMoney(metal.goldRatePerTola)}/tola · ${formatMoney(metal.goldRatePerGram)}/g`;
  }
  if (silverEl) {
    silverEl.hidden = false;
    silverEl.textContent =
      `Silver: ${formatMoney(metal.silverRatePerTola)}/tola · ${formatMoney(metal.silverRatePerGram)}/g`;
  }
}

function syncManualRatesFromForm() {
  if (effectivePriceMode() !== 'manual') return;
  applyManualRatesToApp(readManualRatesFromForm());
  updateGoldCalculator();
  updateOrderTotalPreview();
  refreshDisplayPrices();
}

function rateHistoryForDisplay() {
  const mode = currentRateHistoryPriceMode();
  return rateHistoryCache
    .map(normalizeRateHistoryRow)
    .filter((row) => row.priceMode === mode);
}

function rateHistoryModeLabel(mode) {
  return mode === 'api' ? t('useLiveApi') : t('useManualPrice');
}

function updateRateHistoryClearBtn() {
  const btn = document.getElementById('clear-rate-history-btn');
  if (!btn) return;
  const hasData = currentRateHistoryPeriod() === 'daily'
    ? (isLiveDailyApiMode() ? liveDailySecondSeries.length > 0 : todayRateHistoryRows().length > 0)
    : rateHistoryForDisplay().length > 0;
  btn.hidden = !hasData;
  btn.title = t('clearRateHistory');
  btn.setAttribute('aria-label', t('clearRateHistory'));
}

function formatChartAxisAmount(amount) {
  const n = Number(amount) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return formatCurrencyAmount(n);
}

function chartValueBounds(values) {
  const RATE_CHART_Y_FLOOR = 1000;
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const range = dataMax - dataMin;

  if (range <= 0) {
    const padAmt = Math.max(dataMin * 0.001, 1);
    return { minV: dataMin - padAmt, maxV: dataMax + padAmt };
  }

  if (dataMin >= RATE_CHART_Y_FLOOR && range < dataMax * 0.08) {
    const padAmt = Math.max(range * 0.25, 1);
    return { minV: dataMin - padAmt, maxV: dataMax + padAmt };
  }

  const minV = Math.min(dataMin, RATE_CHART_Y_FLOOR);
  const maxV = dataMax + range * 0.08;
  return { minV, maxV };
}

function renderRateHistoryChart() {
  const el = document.getElementById('rate-history-chart');
  if (!el) return;
  const periodList = document.querySelector('.rate-history-period');
  if (periodList) periodList.setAttribute('aria-label', t('ratePeriodAria'));
  const mode = currentRateHistoryPriceMode();
  const period = currentRateHistoryPeriod();
  const useLiveSecondChart = period === 'daily' && isLiveDailyApiMode() && liveDailySecondSeries.length > 0;
  const todayRows = period === 'daily'
    ? todaySavedRateRows()
    : rateHistoryForDisplay().sort((a, b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date));
  let sorted = period === 'daily'
    ? buildDailyChartSeries()
    : aggregateRateHistoryForChart(rateHistoryForDisplay(), period);
  if (sorted.length === 1) sorted = padSinglePointSeries(sorted, period);
  const intradayList = sorted.length < 2 && !useLiveSecondChart
    ? renderRateIntradayReadingsHtml(todayRows, period)
    : '';

  if (!sorted.length) {
    const emptyMsg = period === 'daily'
      ? (todayRows.length ? t('rateIntradayCollecting') : t('noRateHistoryChartDaily'))
      : t('noRateHistoryChart');
    el.innerHTML = `<p class="empty rate-chart-empty">${emptyMsg} (${ratePeriodLabel(period)} · ${rateHistoryModeLabel(mode)})</p>
      ${intradayList}`;
    if (period === 'daily' && isLiveDailyApiMode()) {
      renderLiveDailyRateNow();
    }
    updateRateHistoryClearBtn();
    return;
  }

  renderGoldPriceOrgChart(el, sorted, mode, period, intradayList);
}

function renderRateHistoryTable() {
  const historyEl = document.getElementById('rate-history');
  if (!historyEl) return;
  const period = currentRateHistoryPeriod();
  const saved = period === 'daily'
    ? [...todaySavedRateRows()].sort((a, b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date))
    : [...rateHistoryForDisplay()].sort((a, b) => (b.updatedAt || b.date).localeCompare(a.updatedAt || a.date));
  const title = period === 'daily' ? t('rateHistoryToday') : t('rateHistory');
  const liveRow = period === 'daily' && isLiveDailyApiMode() && liveDailyCurrentTick
    ? `<tr class="rate-row-live">
        <td>${formatRateHistoryTableWhen(liveDailyCurrentTick)} · ${t('liveRateNow')}</td>
        <td>${formatMoney(liveDailyCurrentTick.goldRatePerTola)}</td>
        <td>${formatMoney(liveDailyCurrentTick.goldRatePerGram)}</td>
      </tr>`
    : '';
  historyEl.innerHTML = saved.length || liveRow
    ? `<h4 class="rate-history-table-title">${title}</h4>
      <table class="data-table"><thead><tr><th>${t('date')}</th><th>${t('perTolaCol')}</th><th>${t('perGramCol')}</th></tr></thead><tbody>
      ${liveRow}
      ${saved.map((row) => `<tr>
        <td>${formatRateHistoryTableWhen(row)}</td>
        <td>${formatMoney(row.goldRatePerTola)}</td>
        <td>${formatMoney(row.goldRatePerGram)}</td>
      </tr>`).join('')}
    </tbody></table>`
    : `<p class="empty">${period === 'daily' ? t('noRateHistoryToday') : t('noRateHistory')}</p>`;
  updateRateHistoryClearBtn();
}

async function clearRateHistoryForCurrentMode() {
  const mode = currentRateHistoryPriceMode();
  if (!rateHistoryForDisplay().length && !liveDailyReadings.length) return;
  if (!confirm(t('clearRateHistoryConfirm'))) return;
  try {
    const payload = await api(`/api/settings/rate-history?priceMode=${encodeURIComponent(mode)}`, {
      method: 'DELETE'
    });
    rateHistoryCache = (payload.rateHistory || []).map(normalizeRateHistoryRow);
    liveDailyReadings = liveDailyReadings.filter((row) => row.priceMode !== mode);
    resetLiveDailySecondSeries();
    liveDailyFlatAnchor = null;
    renderRateHistoryChart();
    renderRateHistoryTable();
    toast(t('clearRateHistoryDone'));
  } catch (err) {
    toast(err.message);
  }
}

async function persistDailyGoldRateSnapshot(priceMode = settingsPriceMode, rates = null) {
  const tola = Number(rates?.goldRatePerTola ?? goldRateCache);
  if (!tola || tola <= 0) return false;
  const gram = Number(rates?.goldRatePerGram)
    || Number((tola / TOLA_GRAMS).toFixed(2));
  const mode = priceMode === 'api' ? 'api' : 'manual';
  try {
    const payload = await api('/api/settings/daily-gold-rate', {
      method: 'POST',
      body: JSON.stringify({
        goldRatePerTola: tola,
        goldRatePerGram: gram,
        priceMode: mode,
        localDate: todayDateStr()
      })
    });
    if (Array.isArray(payload.rateHistory)) {
      rateHistoryCache = payload.rateHistory.map(normalizeRateHistoryRow);
      hydrateLiveDailyReadingsFromCache();
    }
    return Boolean(payload.changed);
  } catch (_) { /* background save */ }
  return false;
}

function hasTodayRateReading(priceMode) {
  const mode = priceMode === 'api' ? 'api' : 'manual';
  const today = todayDateStr();
  return rateHistoryForDisplay().some((row) =>
    row.priceMode === mode && String(row.date || '').slice(0, 10) === today);
}

async function ensureTodayGoldRateInDatabase() {
  const mode = effectivePriceMode() === 'api' ? 'api' : 'manual';
  if (goldRateCache <= 0 || hasTodayRateReading(mode)) return;
  await persistDailyGoldRateSnapshot(mode);
}

function stopMetalRatePolling() {
  if (metalRatePollTimer) {
    clearInterval(metalRatePollTimer);
    metalRatePollTimer = null;
  }
  flushSharedGraphTicks();
}

function syncMetalRatePolling() {
  stopMetalRatePolling();
  if (activeView !== 'settings' || currentRateHistoryPeriod() !== 'daily') return;
  if (!isLiveDailyApiMode()) return;
  loadSharedGoldRates().then(() => {
    renderRateHistoryChart();
    renderRateHistoryTable();
    captureLiveDailyRate().catch(() => {});
  }).catch(() => {
    captureLiveDailyRate().catch(() => {});
  });
  metalRatePollTimer = setInterval(() => {
    captureLiveDailyRate().catch(() => {});
  }, METAL_RATE_POLL_MS);
}

async function seedTodayRateReading() {
  await captureLiveDailyRate();
}

async function refreshAfterCurrencyChange(prevCurrency) {
  refreshCurrencyLabels();
  if (effectivePriceMode() === 'api') {
    await updateMetalRates({ priceMode: 'api' });
  } else {
    const metal = resolveManualMetalRates(settingsCache);
    applyManualRatesToApp(metal);
    refreshMetalPriceFields();
    await updateMetalRates({ priceMode: 'manual', ...metal });
  }
  if (prevCurrency && prevCurrency !== displayCurrency) {
    refreshGoldCalcForCurrency(prevCurrency);
  }
  updateGoldCalcRateLabel();
  updateGoldCalculator();
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

function formatTolaRateInput(tolaNpr) {
  return formatRateInput(tolaNpr || 0);
}

function parseTolaRateInput(value) {
  return parseRateInput(value);
}

function parseTolaFromGramInput(gramValue) {
  return Number((parseRateInput(gramValue) * TOLA_GRAMS).toFixed(2));
}

let metalRateSyncLock = false;

function syncSettingsGoldRateFromGram() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="goldRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="goldRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaFromGramInput(gramInput.value);
  tolaInput.value = formatTolaRateInput(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsGoldRateFromTola() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="goldRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="goldRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaRateInput(tolaInput.value);
  gramInput.value = formatGramRateFromTola(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsSilverRateFromGram() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="silverRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="silverRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaFromGramInput(gramInput.value);
  tolaInput.value = formatTolaRateInput(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function syncSettingsSilverRateFromTola() {
  if (metalRateSyncLock) return;
  const gramInput = document.querySelector('#settings-form [name="silverRatePerGram"]');
  const tolaInput = document.querySelector('#settings-form [name="silverRatePerTola"]');
  if (!gramInput || !tolaInput) return;
  metalRateSyncLock = true;
  const tolaNpr = parseTolaRateInput(tolaInput.value);
  gramInput.value = formatGramRateFromTola(tolaNpr);
  metalRateSyncLock = false;
  syncManualRatesFromForm();
}

function refreshMetalPriceFields() {
  const priceForm = document.getElementById('settings-form');
  if (!priceForm) return;
  const metal = effectivePriceMode() === 'manual'
    ? readManualRatesFromForm()
    : {
      goldRatePerTola: goldRateCache,
      silverRatePerTola: silverRateCache
    };
  const goldGramField = priceForm.goldRatePerGram;
  const goldTolaField = priceForm.goldRatePerTola;
  const silverGramField = priceForm.silverRatePerGram;
  const silverTolaField = priceForm.silverRatePerTola;
  const rateStep = currencyCode() === 'NPR' ? '1' : '0.01';
  if (goldGramField) {
    goldGramField.value = formatGramRateFromTola(metal.goldRatePerTola);
    goldGramField.step = rateStep;
  }
  if (goldTolaField) {
    goldTolaField.value = formatTolaRateInput(metal.goldRatePerTola);
    goldTolaField.step = rateStep;
  }
  if (silverGramField) {
    silverGramField.value = formatGramRateFromTola(metal.silverRatePerTola);
    silverGramField.step = '0.01';
  }
  if (silverTolaField) {
    silverTolaField.value = formatTolaRateInput(metal.silverRatePerTola);
    silverTolaField.step = rateStep;
  }
  refreshCurrencyLabels();
}

function sortIcon() {
  return '<svg class="sort-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>';
}

function cartIcon() {
  return '<svg class="order-cart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
}

function shopLogoHtml(className = 'shop-logo') {
  const alt = settingsCache.shopName || 'Suvarnapasal';
  return `<img src="logo.svg" class="${className}" width="88" height="88" alt="${alt.replace(/"/g, '&quot;')}" />`;
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
    <th>${t('options')}</th>
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
  calculator: { showAddItem: false, posMode: false },
  settings: { showAddItem: false, posMode: false }
};

let editingId = null;
let itemsCache = [];
let ordersAllCache = [];
let orderItemsCache = [];
let posItemsCache = [];
let goldRateCache = 0;
let silverRateCache = 0;
const calcRateDraftNpr = { gold: null, silver: null };
let settingsPriceMode = 'manual';
let locationsCache = [];
let itemCategoriesCache = [...DEFAULT_ITEM_CATEGORIES];
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
let liveDailyReadings = [];
let liveDailyCurrentTick = null;
let liveDailyFlatAnchor = null;
let liveDailySecondSeries = [];
let liveDailySecondSeq = 0;
let metalRatePollTimer = null;
const METAL_RATE_POLL_MS = 1000;
let lastSaleBill = null;
let activeView = 'pos';
let posCart = [];
let reportTab = 'sales';
let orderGroup = 'progress';
let reportCache = null;
let selectedCustomer = null;
let customersCache = [];
let customersPollTimer = null;
const CUSTOMERS_POLL_MS = 15000;
let localCustomersMigrated = false;

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

function truncateWeight(value, decimals = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.floor(n * factor + 1e-10) / factor;
}

function normalizeWeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1e6) / 1e6;
}

function formatWeightQty(value, decimals = 4) {
  const t = truncateWeight(value, decimals);
  if (Number.isInteger(t)) return String(t);
  const fixed = t.toFixed(decimals);
  return fixed.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}

function weightFieldNames(prefix = '') {
  if (!prefix) {
    return {
      prefix,
      unitName: 'weightUnit',
      gramsName: 'weightGrams',
      tolaName: 'weightTola',
      aanaName: 'weightAana',
      laalName: 'weightLaal'
    };
  }
  return {
    prefix,
    unitName: `${prefix}WeightUnit`,
    gramsName: `${prefix}WeightGrams`,
    tolaName: `${prefix}WeightTola`,
    aanaName: `${prefix}WeightAana`,
    laalName: `${prefix}WeightLaal`
  };
}

function tolaPartsToGrams(tola = 0, aana = 0, laal = 0) {
  const t = Number(tola) || 0;
  const a = Number(aana) || 0;
  const l = Number(laal) || 0;
  if (t <= 0 && a <= 0 && l <= 0) return 0;
  const totalLaal = t * LAAL_PER_TOLA + a * LAAL_PER_AANA + l;
  return (totalLaal * TOLA_GRAMS) / LAAL_PER_TOLA;
}

function totalLaalToTolaParts(totalLaal) {
  const tl = Math.max(0, Math.floor(totalLaal));
  const tola = Math.floor(tl / LAAL_PER_TOLA);
  const remLaal = tl - tola * LAAL_PER_TOLA;
  const aana = Math.floor(remLaal / LAAL_PER_AANA);
  const laal = remLaal - aana * LAAL_PER_AANA;
  return { tola, aana, laal };
}

function laalPartToAanaLaal(remainderLaal) {
  const aana = Math.floor(remainderLaal / LAAL_PER_AANA);
  const laal = remainderLaal - aana * LAAL_PER_AANA;
  return { aana, laal };
}

const LAAL_SNAP_GRAMS = 0.015;
const TOLA_CENTIGRAMS = 1166;

function gramsToCentigrams(grams) {
  return Math.round(normalizeWeight(grams) * 100);
}

function centigramsToGrams(cg) {
  return normalizeWeight(cg / 100);
}

function formatLaalQty(value) {
  return formatWeightQty(value, 2);
}

function remainderCgToLaal(remainderCg) {
  const numer = remainderCg * LAAL_PER_TOLA;
  const denom = TOLA_GRAMS * 100;
  return Math.floor((numer / denom) * 10000 + 1e-9) / 10000;
}

function gramsToTolaParts(grams) {
  const g = normalizeWeight(grams);
  if (!Number.isFinite(g) || g <= 0) {
    return { tola: '', aana: '', laal: '', remainderGrams: 0, remainderLaal: 0 };
  }
  const totalLaalFloat = (g * LAAL_PER_TOLA) / TOLA_GRAMS;
  const totalLaalRounded = Math.round(totalLaalFloat);
  const gramsFromLaal = (totalLaalRounded * TOLA_GRAMS) / LAAL_PER_TOLA;
  if (Math.abs(g - gramsFromLaal) < LAAL_SNAP_GRAMS) {
    return { ...totalLaalToTolaParts(totalLaalRounded), remainderGrams: 0, remainderLaal: 0 };
  }
  const cg = gramsToCentigrams(g);
  const tola = Math.floor(cg / TOLA_CENTIGRAMS);
  const remainderCg = cg - tola * TOLA_CENTIGRAMS;
  if (remainderCg <= 0) {
    return { tola, aana: 0, laal: 0, remainderGrams: 0, remainderLaal: 0 };
  }
  const remainderLaal = remainderCgToLaal(remainderCg);
  const { aana, laal } = laalPartToAanaLaal(remainderLaal);
  const remainderGrams = centigramsToGrams(remainderCg);
  return { tola, aana, laal, remainderGrams, remainderLaal };
}

function buildWeightFormStub(root, prefix = '') {
  const names = weightFieldNames(prefix);
  const stub = {
    querySelector: (sel) => root.querySelector(sel),
    elements: {}
  };
  Object.values(names).forEach((name) => {
    if (name) stub.elements[name] = root.querySelector(`[name="${name}"]`);
  });
  return stub;
}

function formatWeightFromForm(form, prefix = '') {
  const grams = getWeightGramsFromForm(form, prefix);
  if (grams <= 0) return '—';
  const gramsDisplay = formatWeightQty(grams, 4);
  if (getWeightUnit(form, prefix) === 'tola') {
    const names = weightFieldNames(prefix);
    const tola = form.elements[names.tolaName]?.value ?? '';
    const aana = form.elements[names.aanaName]?.value ?? '';
    const laal = form.elements[names.laalName]?.value ?? '';
    if (!Number(tola) && !Number(aana) && !Number(laal)) return '—';
    const tolaText = tola === '' ? '0' : tola;
    const aanaText = aana === '' ? '0' : aana;
    const laalText = laal === '' ? '0' : laal;
    return `${tolaText} ${t('weightTolaShort')} · ${aanaText} ${t('weightAanaShort')} · ${laalText} ${t('weightLaalShort')} = ${gramsDisplay} g`;
  }
  return formatWeightParts(grams);
}

function formatWeightParts(grams) {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return '—';
  const parts = gramsToTolaParts(g);
  const bits = [`${formatWeightQty(g, 3)} g`];
  if (parts.tola !== '' || parts.aana !== '' || parts.laal !== '') {
    bits.push(`${parts.tola || 0} ${t('weightTolaShort')} · ${parts.aana || 0} ${t('weightAanaShort')} · ${formatWeightQty(parts.laal, 4)} ${t('weightLaalShort')}`);
  }
  return bits.join(' · ');
}

function getWeightEntryEl(form, prefix = '') {
  if (!form) return null;
  return form.querySelector(`.weight-entry[data-weight-prefix="${prefix}"]`)
    || form.querySelector('.weight-entry');
}

function getWeightUnit(form, prefix = '') {
  const entry = getWeightEntryEl(form, prefix);
  const names = weightFieldNames(prefix);
  const unitEl = entry?.querySelector(`[name="${names.unitName}"]`) || form?.elements[names.unitName];
  return unitEl?.value === 'tola' ? 'tola' : 'grams';
}

function getWeightGramsFromForm(form, prefix = '') {
  if (!form) return 0;
  const names = weightFieldNames(prefix);
  if (getWeightUnit(form, prefix) === 'tola') {
    return tolaPartsToGrams(
      form.elements[names.tolaName]?.value,
      form.elements[names.aanaName]?.value,
      form.elements[names.laalName]?.value
    );
  }
  return Number(form.elements[names.gramsName]?.value) || 0;
}

function getTolaPartsFromForm(form, prefix = '') {
  const names = weightFieldNames(prefix);
  return {
    tola: Number(form.elements[names.tolaName]?.value) || 0,
    aana: Number(form.elements[names.aanaName]?.value) || 0,
    laal: Number(form.elements[names.laalName]?.value) || 0
  };
}

function calcGoldMetalNpr({ grams = 0, unit = 'grams', tolaParts = null, ratePerTolaNpr = goldRateCache } = {}) {
  const rate = Number(ratePerTolaNpr) || 0;
  if (!rate) return 0;
  if (unit === 'tola' && tolaParts) {
    const t = Number(tolaParts.tola) || 0;
    const a = Number(tolaParts.aana) || 0;
    const l = Number(tolaParts.laal) || 0;
    if (!t && !a && !l) return 0;
    const rateAana = rate / AANA_PER_TOLA;
    const rateLaal = rate / LAAL_PER_TOLA;
    return t * rate + a * rateAana + l * rateLaal;
  }
  const g = Number(grams) || 0;
  if (g <= 0) return 0;
  return g * (rate / TOLA_GRAMS);
}

function formatGoldWeightPriceBreakdown(tolaParts, ratePerTolaNpr, makingChargeNpr = 0) {
  const rate = Number(ratePerTolaNpr) || 0;
  if (!rate || !tolaParts) return '';
  const rateAana = rate / AANA_PER_TOLA;
  const rateLaal = rate / LAAL_PER_TOLA;
  const bits = [];
  const t = Number(tolaParts.tola) || 0;
  const a = Number(tolaParts.aana) || 0;
  const l = Number(tolaParts.laal) || 0;
  if (t) bits.push(`${t} ${t('calcTola')} × ${formatMoney(rate)}`);
  if (a) bits.push(`${a} ${t('calcAana')} × ${formatMoney(rateAana)}`);
  if (l) bits.push(`${formatWeightQty(l, 4)} ${t('calcLaal')} × ${formatMoney(rateLaal)}`);
  if (!bits.length) return '';
  const metal = calcGoldMetalNpr({ unit: 'tola', tolaParts, ratePerTolaNpr: rate });
  const making = Number(makingChargeNpr) || 0;
  const total = metal + making;
  return `${bits.join(' + ')}${making ? ` + ${t('calcMakingCharge')} ${formatMoney(making)}` : ''} = ${formatMoney(total)}`;
}

function renderOrderPriceBreakdown({ weightUnit, weightGrams, tolaParts, makingChargeNpr, qty = 1, ratePerTolaNpr = getGoldRatePerTolaNpr() }) {
  const rate = Number(ratePerTolaNpr) || 0;
  if (!rate) return '';
  const making = Number(makingChargeNpr) || 0;
  let metalNpr = 0;
  let weightRows = '';

  if (weightUnit === 'tola' && tolaParts && (tolaParts.tola || tolaParts.aana || tolaParts.laal)) {
    const rateAana = rate / AANA_PER_TOLA;
    const rateLaal = rate / LAAL_PER_TOLA;
    const rows = [];
    if (tolaParts.tola) {
      const sub = tolaParts.tola * rate;
      metalNpr += sub;
      rows.push(`<tr><th>${t('calcTola')}</th><td>${tolaParts.tola} × ${formatMoney(rate)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.aana) {
      const sub = tolaParts.aana * rateAana;
      metalNpr += sub;
      rows.push(`<tr><th>${t('calcAana')}</th><td>${tolaParts.aana} × ${formatMoney(rateAana)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.laal) {
      const sub = tolaParts.laal * rateLaal;
      metalNpr += sub;
      rows.push(`<tr><th>${t('calcLaal')}</th><td>${formatWeightQty(tolaParts.laal, 4)} × ${formatMoney(rateLaal)} = ${formatMoney(sub)}</td></tr>`);
    }
    weightRows = rows.join('');
  } else if (weightGrams > 0) {
    const rateGram = rate / TOLA_GRAMS;
    metalNpr = weightGrams * rateGram;
    weightRows = `<tr><th>${t('calcGrams')}</th><td>${formatWeightQty(weightGrams, 4)} g × ${formatMoney(rateGram)} = ${formatMoney(metalNpr)}</td></tr>`;
  } else {
    return '';
  }

  const unitTotal = metalNpr + making;
  const orderTotal = unitTotal * qty;
  const qtyRow = qty > 1
    ? `<tr><th>${t('quantity')}</th><td>${formatMoney(unitTotal)} × ${qty} = ${formatMoney(orderTotal)}</td></tr>`
    : '';

  return `
    <table class="gold-calc-table gold-price-summary">
      <tbody>
        ${weightRows}
        <tr><th>${t('calcMakingCharge')}</th><td>${formatMoney(making)}</td></tr>
        ${qtyRow}
        <tr class="gold-calc-total-row"><th>${t('calcTotalPrice')}</th><td><strong>${formatMoney(orderTotal)}</strong></td></tr>
      </tbody>
    </table>`;
}

function updateWeightEntryHint(entry) {
  if (!entry) return;
  const hint = entry.querySelector('.weight-conversion-hint');
  if (!hint) return;
  const prefix = entry.dataset.weightPrefix || '';
  const form = entry.closest('form') || buildWeightFormStub(entry.closest('#view-calculator') || entry, prefix);
  const grams = getWeightGramsFromForm(form, prefix);
  if (grams > 0) {
    hint.hidden = false;
    hint.textContent = formatWeightFromForm(form, prefix);
  } else {
    hint.hidden = true;
    hint.textContent = '';
  }
}

function setWeightEntryPanels(entry, unit) {
  if (!entry) return;
  const isTola = unit === 'tola';
  entry.dataset.weightMode = isTola ? 'tola' : 'grams';
  entry.querySelectorAll('.weight-panel-grams').forEach((el) => el.toggleAttribute('hidden', isTola));
  entry.querySelectorAll('.weight-panel-tola').forEach((el) => el.toggleAttribute('hidden', !isTola));
  entry.querySelectorAll('.weight-panel-aana').forEach((el) => el.toggleAttribute('hidden', !isTola));
  entry.querySelectorAll('.weight-panel-laal').forEach((el) => el.toggleAttribute('hidden', !isTola));
}

function setWeightFieldsFromGrams(form, grams, prefix = '') {
  if (!form) return;
  const entry = getWeightEntryEl(form, prefix);
  if (!entry) return;
  const names = weightFieldNames(prefix);
  const g = Number(grams);
  const unitEl = form.elements[names.unitName];
  const gramsEl = form.elements[names.gramsName];
  const tolaEl = form.elements[names.tolaName];
  const aanaEl = form.elements[names.aanaName];
  const laalEl = form.elements[names.laalName];
  if (!Number.isFinite(g) || g <= 0) {
    if (gramsEl) gramsEl.value = '';
    if (tolaEl) tolaEl.value = '';
    if (aanaEl) aanaEl.value = '';
    if (laalEl) laalEl.value = '';
    updateWeightEntryHint(entry);
    return;
  }
  const parts = gramsToTolaParts(g);
  if (gramsEl) gramsEl.value = g;
  if (tolaEl) tolaEl.value = parts.tola;
  if (aanaEl) aanaEl.value = parts.aana;
  if (laalEl) laalEl.value = formatWeightQty(parts.laal, 4);
  if (unitEl) unitEl.value = 'grams';
  setWeightEntryPanels(entry, 'grams');
  updateWeightEntryHint(entry);
}

function initWeightEntry(entry) {
  if (!entry || entry.dataset.weightBound) return;
  entry.dataset.weightBound = '1';
  const form = entry.closest('form');
  const prefix = entry.dataset.weightPrefix || '';
  const names = weightFieldNames(prefix);
  const unitEl = entry.querySelector(`[name="${names.unitName}"]`) || form?.elements[names.unitName];
  if (unitEl) {
    unitEl.addEventListener('change', () => {
      const isTola = unitEl.value === 'tola';
      const gramsEl = entry.querySelector(`[name="${names.gramsName}"]`);
      const tolaEl = entry.querySelector(`[name="${names.tolaName}"]`);
      const aanaEl = entry.querySelector(`[name="${names.aanaName}"]`);
      const laalEl = entry.querySelector(`[name="${names.laalName}"]`);
      if (isTola) {
        if (gramsEl) gramsEl.value = '';
      } else {
        if (tolaEl) tolaEl.value = '';
        if (aanaEl) aanaEl.value = '';
        if (laalEl) laalEl.value = '';
      }
      setWeightEntryPanels(entry, unitEl.value);
      updateWeightEntryHint(entry);
      entry.dispatchEvent(new CustomEvent('weight-updated', { bubbles: true }));
    });
    setWeightEntryPanels(entry, unitEl.value || 'grams');
  }
  entry.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', () => {
      updateWeightEntryHint(entry);
      entry.dispatchEvent(new CustomEvent('weight-updated', { bubbles: true }));
    });
  });
}

function initAllWeightEntries() {
  document.querySelectorAll('.weight-entry').forEach(initWeightEntry);
}

function syncWeightEntryPanels(form, prefix = '') {
  const entry = getWeightEntryEl(form, prefix);
  if (!entry) return;
  initWeightEntry(entry);
  setWeightEntryPanels(entry, getWeightUnit(form, prefix));
  updateWeightEntryHint(entry);
}

function getGoldRatePerTolaNpr() {
  return Number(goldRateCache) || 0;
}

function getCalcMetal() {
  return document.getElementById('calc-metal')?.value === 'silver' ? 'silver' : 'gold';
}

function getCalcMetalRateCache() {
  return getCalcMetal() === 'silver' ? silverRateCache : goldRateCache;
}

function getCalcUseGram() {
  const view = document.getElementById('view-calculator');
  const stub = view ? buildWeightFormStub(view, 'conv') : null;
  return stub ? getWeightUnit(stub, 'conv') !== 'tola' : true;
}

function getCalcRateLabelKey(useGram) {
  const metal = getCalcMetal();
  if (metal === 'silver') return useGram ? 'silverRateGram' : 'silverRateTola';
  return useGram ? 'goldRateGram' : 'goldRateTola';
}

function persistCalcRateDraft() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput || rateInput.dataset.userEdited !== '1' || !rateInput.value) return;
  calcRateDraftNpr[getCalcMetal()] = parseMoneyField(rateInput.value);
}

function applyCalcRateField() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput) return;
  const metal = getCalcMetal();
  const useGram = getCalcUseGram();
  const draft = calcRateDraftNpr[metal];
  if (draft != null && draft > 0) {
    rateInput.value = useGram ? formatRateInput(draft) : formatMoneyField(draft);
    rateInput.dataset.userEdited = '1';
    return;
  }
  rateInput.dataset.userEdited = '';
  syncGoldCalcRateField();
}

function syncGoldCalcRateUnitFromWeight() {
  const view = document.getElementById('view-calculator');
  const rateUnitEl = document.getElementById('gold-calc-rate-unit');
  const rateInput = document.getElementById('gold-calc-rate');
  if (!view || !rateUnitEl) return;
  const stub = buildWeightFormStub(view, 'conv');
  const weightUnit = getWeightUnit(stub, 'conv');
  const nextRateUnit = weightUnit === 'tola' ? 'tola' : 'gram';
  const prevRateUnit = rateUnitEl.value === 'gram' ? 'gram' : 'tola';
  if (prevRateUnit !== nextRateUnit) {
    const currentRate = parseMoneyField(rateInput?.value) || 0;
    if (currentRate > 0 && rateInput?.dataset.userEdited === '1') {
      if (prevRateUnit === 'tola' && nextRateUnit === 'gram') {
        rateInput.value = formatGramRateFromTola(currentRate);
      } else if (prevRateUnit === 'gram' && nextRateUnit === 'tola') {
        rateInput.value = formatMoneyField(currentRate * TOLA_GRAMS);
      }
      persistCalcRateDraft();
    } else if (rateInput) {
      rateInput.dataset.userEdited = '';
    }
  }
  rateUnitEl.value = nextRateUnit;
}

function getGoldCalcPriceWeight(ctx) {
  if (!ctx || ctx.grams <= 0) return { qty: 0, label: '' };
  if (ctx.unit === 'tola') {
    const tola = ctx.grams / TOLA_GRAMS;
    const roundedTola = Math.round(tola * 10000) / 10000;
    const qtyLabel = Number.isInteger(roundedTola)
      ? String(roundedTola)
      : formatWeightQty(tola, 4);
    return {
      qty: tola,
      label: qtyLabel
    };
  }
  return {
    qty: ctx.grams,
    label: `${formatWeightQty(ctx.grams, 4)} g`
  };
}

function updateGoldCalcRateLabel() {
  const useGram = getCalcUseGram();
  const label = document.getElementById('gold-calc-rate-label');
  if (label) {
    const key = getCalcRateLabelKey(useGram);
    label.textContent = labelWithCurrency(key);
    label.dataset.currencyField = key;
  }
}

function refreshGoldCalcForCurrency(prevCurrency) {
  const rateInput = document.getElementById('gold-calc-rate');
  const makingInput = document.getElementById('gold-calc-making-charge');
  const useGram = getCalcUseGram();

  if (rateInput) {
    if (rateInput.dataset.userEdited === '1' && rateInput.value) {
      const rateNpr = displayToNprAt(rateInput.value, prevCurrency);
      calcRateDraftNpr[getCalcMetal()] = rateNpr;
      rateInput.value = useGram ? formatRateInput(rateNpr) : formatMoneyField(rateNpr);
    } else {
      rateInput.dataset.userEdited = '';
      syncGoldCalcRateField();
    }
  }
  if (makingInput?.value) {
    const makingNpr = displayToNprAt(makingInput.value, prevCurrency);
    makingInput.value = formatMoneyField(makingNpr);
  }
}

function getGoldConvContext() {
  const view = document.getElementById('view-calculator');
  if (!view) return null;
  const stub = buildWeightFormStub(view, 'conv');
  const names = weightFieldNames('conv');
  return {
    unit: getWeightUnit(stub, 'conv'),
    grams: getWeightGramsFromForm(stub, 'conv'),
    form: stub,
    tolaInput: stub.elements[names.tolaName]?.value ?? '',
    aanaInput: stub.elements[names.aanaName]?.value ?? '',
    laalInput: stub.elements[names.laalName]?.value ?? ''
  };
}

function renderGoldConversionResults() {
  const box = document.getElementById('gold-conversion-results');
  if (!box) return;
  const ctx = getGoldConvContext();
  if (!ctx || ctx.grams <= 0) {
    box.innerHTML = `<p class="gold-calc-empty">${t('calcEnterWeight')}</p>`;
    return;
  }
  const { unit, grams, tolaInput, aanaInput, laalInput } = ctx;
  const parts = gramsToTolaParts(grams);
  const laalDisplay = formatWeightQty(parts.laal, 4);
  const laalBreakdown = formatLaalQty(parts.laal);
  const remainderDisplay = formatWeightQty(parts.remainderGrams, 2);
  const gramsDisplay = formatWeightQty(grams, 4);
  const totalTola = formatWeightQty(grams / TOLA_GRAMS, 4);
  const tolaText = tolaInput === '' ? '0' : tolaInput;
  const aanaText = aanaInput === '' ? '0' : aanaInput;
  const laalText = laalInput === '' ? '0' : laalInput;
  if (unit === 'grams') {
    const remainderLine = parts.remainderGrams > 1e-9
      ? `<p class="gold-conv-breakdown">${parts.tola || 0} ${t('calcTola')} (${TOLA_GRAMS} g) + ${remainderDisplay} g = ${parts.aana || 0} ${t('calcAana')} · ${laalBreakdown} ${t('calcLaal')}</p>`
      : '';
    box.innerHTML = `
      <div class="gold-conv-output">
        <h4 class="gold-results-title">${t('calcConvertedTo')}</h4>
        <div class="gold-conv-output-grid">
          <div class="gold-conv-output-item"><span>${t('calcTola')}</span><strong>${parts.tola || 0}</strong></div>
          <div class="gold-conv-output-item"><span>${t('calcAana')}</span><strong>${parts.aana || 0}</strong></div>
          <div class="gold-conv-output-item"><span>${t('calcLaal')}</span><strong>${laalDisplay}</strong></div>
        </div>
        ${remainderLine}
        <p class="gold-conv-detail">${gramsDisplay} ${t('calcGrams')} = ${parts.tola || 0} ${t('weightTolaShort')} · ${parts.aana || 0} ${t('weightAanaShort')} · ${laalDisplay} ${t('weightLaalShort')}</p>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="gold-conv-output">
      <h4 class="gold-results-title">${t('calcEqualsGrams')}</h4>
      <div class="gold-conv-grams-value"><strong>${gramsDisplay}</strong><span>g</span></div>
      <p class="gold-conv-detail">${tolaText} ${t('weightTolaShort')} · ${aanaText} ${t('weightAanaShort')} · ${laalText} ${t('weightLaalShort')} = ${gramsDisplay} g</p>
      <p class="gold-conv-sub">${totalTola} ${t('calcTola')} (${t('calcAllUnits')})</p>
    </div>`;
}

function renderGoldPriceResult() {
  const box = document.getElementById('gold-price-result');
  if (!box) return;
  const ctx = getGoldConvContext();
  const rateNpr = parseMoneyField(document.getElementById('gold-calc-rate')?.value) || 0;
  const makingNpr = parseMoneyField(document.getElementById('gold-calc-making-charge')?.value) || 0;
  if (!ctx || ctx.grams <= 0 || rateNpr <= 0) {
    box.innerHTML = `<p class="gold-calc-empty">${t('calcEnterWeightCost')}</p>`;
    return;
  }
  let weightRows = '';
  let goldValueNpr = 0;
  if (ctx.unit === 'tola') {
    const tolaParts = {
      tola: Number(ctx.tolaInput) || 0,
      aana: Number(ctx.aanaInput) || 0,
      laal: Number(ctx.laalInput) || 0
    };
    const rateAana = rateNpr / AANA_PER_TOLA;
    const rateLaal = rateNpr / LAAL_PER_TOLA;
    const rows = [];
    if (tolaParts.tola) {
      const sub = tolaParts.tola * rateNpr;
      goldValueNpr += sub;
      rows.push(`<tr><th>${t('calcTola')}</th><td>${tolaParts.tola} × ${formatMoney(rateNpr)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.aana) {
      const sub = tolaParts.aana * rateAana;
      goldValueNpr += sub;
      rows.push(`<tr><th>${t('calcAana')}</th><td>${tolaParts.aana} × ${formatMoney(rateAana)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (tolaParts.laal) {
      const sub = tolaParts.laal * rateLaal;
      goldValueNpr += sub;
      rows.push(`<tr><th>${t('calcLaal')}</th><td>${formatWeightQty(tolaParts.laal, 4)} × ${formatMoney(rateLaal)} = ${formatMoney(sub)}</td></tr>`);
    }
    if (!rows.length) {
      const { qty: weightQty, label: weightLabel } = getGoldCalcPriceWeight(ctx);
      goldValueNpr = weightQty * rateNpr;
      weightRows = `<tr><th>${t('calcWeightTimesRate')}</th><td>${weightLabel} × ${formatMoney(rateNpr)} = ${formatMoney(goldValueNpr)}</td></tr>`;
    } else {
      weightRows = rows.join('');
    }
  } else {
    const { qty: weightQty, label: weightLabel } = getGoldCalcPriceWeight(ctx);
    goldValueNpr = weightQty * rateNpr;
    weightRows = `<tr><th>${t('calcWeightTimesRate')}</th><td>${weightLabel} × ${formatMoney(rateNpr)} = ${formatMoney(goldValueNpr)}</td></tr>`;
  }
  const totalNpr = goldValueNpr + makingNpr;
  box.innerHTML = `
    <table class="gold-calc-table gold-price-summary">
      <tbody>
        ${weightRows}
        <tr><th>${t('calcMakingCharge')}</th><td>${formatMoney(makingNpr)}</td></tr>
        <tr class="gold-calc-total-row"><th>${t('calcTotalPrice')}</th><td><strong>${formatMoney(totalNpr)}</strong></td></tr>
      </tbody>
    </table>`;
}

function syncGoldCalcRateField() {
  const rateInput = document.getElementById('gold-calc-rate');
  if (!rateInput || rateInput.dataset.userEdited === '1') return;
  const useGram = getCalcUseGram();
  const rateCache = getCalcMetalRateCache();
  if (!rateCache) {
    rateInput.value = '';
    return;
  }
  rateInput.value = useGram
    ? formatGramRateFromTola(rateCache)
    : formatMoneyField(rateCache);
}

function updateGoldCalculator() {
  syncGoldCalcRateUnitFromWeight();
  updateGoldCalcRateLabel();
  syncGoldCalcRateField();
  renderGoldConversionResults();
  renderGoldPriceResult();
}

function initGoldCalculator() {
  const view = document.getElementById('view-calculator');
  if (!view || view.dataset.goldCalcBound) return;
  view.dataset.goldCalcBound = '1';
  const bindWeightEntry = (entry) => {
    initWeightEntry(entry);
    entry.addEventListener('weight-updated', updateGoldCalculator);
    entry.addEventListener('input', updateGoldCalculator);
  };
  view.querySelectorAll('.weight-entry').forEach(bindWeightEntry);
  const rateInput = document.getElementById('gold-calc-rate');
  rateInput?.addEventListener('input', () => {
    if (rateInput) rateInput.dataset.userEdited = '1';
    persistCalcRateDraft();
    updateGoldCalculator();
  });
  document.getElementById('gold-calc-making-charge')?.addEventListener('input', updateGoldCalculator);
  document.getElementById('calc-metal')?.addEventListener('change', () => {
    applyCalcRateField();
    updateGoldCalculator();
  });
  updateGoldCalculator();
}

const quickCalcState = {
  display: '0',
  accumulator: null,
  operator: null,
  fresh: true
};

function resetQuickCalc() {
  quickCalcState.display = '0';
  quickCalcState.accumulator = null;
  quickCalcState.operator = null;
  quickCalcState.fresh = true;
  renderQuickCalcDisplay();
}

function renderQuickCalcDisplay() {
  const el = document.getElementById('quick-calc-display');
  if (el) el.textContent = quickCalcState.display;
}

function formatQuickCalcResult(value) {
  if (!Number.isFinite(value)) return 'Error';
  const rounded = Math.round(value * 1e10) / 1e10;
  const text = String(rounded);
  return text.length > 14 ? rounded.toPrecision(12).replace(/\.?0+$/, '') : text;
}

function applyQuickCalcOp(a, b, op) {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function quickCalcInputDigit(digit) {
  if (quickCalcState.display === 'Error') resetQuickCalc();
  if (quickCalcState.fresh) {
    quickCalcState.display = digit === '.' ? '0.' : digit;
    quickCalcState.fresh = false;
  } else if (digit === '.') {
    if (!quickCalcState.display.includes('.')) quickCalcState.display += '.';
  } else if (quickCalcState.display === '0') {
    quickCalcState.display = digit;
  } else {
    quickCalcState.display += digit;
  }
  renderQuickCalcDisplay();
}

function quickCalcSetOperator(op) {
  if (quickCalcState.display === 'Error') return;
  const current = Number(quickCalcState.display);
  if (quickCalcState.operator != null && quickCalcState.accumulator != null && !quickCalcState.fresh) {
    const result = applyQuickCalcOp(quickCalcState.accumulator, current, quickCalcState.operator);
    quickCalcState.display = formatQuickCalcResult(result);
    quickCalcState.accumulator = Number(quickCalcState.display);
  } else if (quickCalcState.accumulator == null || quickCalcState.fresh) {
    quickCalcState.accumulator = current;
  }
  quickCalcState.operator = op;
  quickCalcState.fresh = true;
  renderQuickCalcDisplay();
}

function quickCalcEquals() {
  if (quickCalcState.display === 'Error') return;
  if (quickCalcState.operator == null || quickCalcState.accumulator == null) return;
  const current = Number(quickCalcState.display);
  const result = applyQuickCalcOp(quickCalcState.accumulator, current, quickCalcState.operator);
  quickCalcState.display = formatQuickCalcResult(result);
  quickCalcState.accumulator = null;
  quickCalcState.operator = null;
  quickCalcState.fresh = true;
  renderQuickCalcDisplay();
}

function quickCalcBackspace() {
  if (quickCalcState.fresh || quickCalcState.display === 'Error') return;
  quickCalcState.display = quickCalcState.display.length <= 1
    ? '0'
    : quickCalcState.display.slice(0, -1);
  renderQuickCalcDisplay();
}

function handleQuickCalcPadClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'digit') quickCalcInputDigit(btn.dataset.digit);
  else if (action === 'op') quickCalcSetOperator(btn.dataset.op);
  else if (action === 'equals') quickCalcEquals();
  else if (action === 'clear') resetQuickCalc();
  else if (action === 'backspace') quickCalcBackspace();
}

function handleQuickCalcKeydown(e) {
  const modal = document.getElementById('quick-calc-modal');
  if (!modal?.open) return;
  if (e.key >= '0' && e.key <= '9') {
    e.preventDefault();
    quickCalcInputDigit(e.key);
  } else if (e.key === '.') {
    e.preventDefault();
    quickCalcInputDigit('.');
  } else if (e.key === '+') {
    e.preventDefault();
    quickCalcSetOperator('+');
  } else if (e.key === '-') {
    e.preventDefault();
    quickCalcSetOperator('-');
  } else if (e.key === '*') {
    e.preventDefault();
    quickCalcSetOperator('*');
  } else if (e.key === '/') {
    e.preventDefault();
    quickCalcSetOperator('/');
  } else if (e.key === 'Enter' || e.key === '=') {
    e.preventDefault();
    quickCalcEquals();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    quickCalcBackspace();
  } else if (e.key === 'Escape') {
    modal.close();
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    resetQuickCalc();
  }
}

function openQuickCalcModal() {
  const modal = document.getElementById('quick-calc-modal');
  if (!modal) return;
  resetQuickCalc();
  modal.showModal();
}

function initQuickCalculator() {
  document.getElementById('open-quick-calc-btn')?.addEventListener('click', openQuickCalcModal);
  document.getElementById('close-quick-calc-modal')?.addEventListener('click', () => {
    document.getElementById('quick-calc-modal')?.close();
  });
  document.getElementById('quick-calc-pad')?.addEventListener('click', handleQuickCalcPadClick);
  document.getElementById('quick-calc-modal')?.addEventListener('cancel', (e) => {
    e.preventDefault();
    e.target.close();
  });
  document.addEventListener('keydown', handleQuickCalcKeydown);
}

let orderModalContext = 'order';

function updateOrderModalChrome() {
  const isPos = orderModalContext === 'pos';
  const title = document.getElementById('order-modal-title');
  const submitBtn = document.getElementById('order-submit-btn');
  const segment = document.querySelector('#order-modal .order-item-mode');
  if (title) title.textContent = t(isPos ? 'addCustomItemTitle' : 'addOrderTitle');
  if (submitBtn) submitBtn.textContent = t(isPos ? 'addToCart' : 'createOrder');
  if (segment) segment.hidden = isPos;
}

function isOrderCustomItemMode(form) {
  const mode = form?.elements.orderItemMode?.value;
  return mode === 'custom';
}

function setOrderItemMode(form, mode) {
  if (!form) return;
  const inventoryFields = document.getElementById('order-inventory-fields');
  const customFields = document.getElementById('order-custom-fields');
  const itemSelect = form.elements.itemId;
  const modeInput = form.elements.orderItemMode;
  const isCustom = mode === 'custom';
  if (modeInput) modeInput.value = isCustom ? 'custom' : 'inventory';
  if (inventoryFields) inventoryFields.hidden = isCustom;
  if (customFields) customFields.hidden = !isCustom;
  form.querySelectorAll('[data-order-item-mode]').forEach((btn) => {
    const active = btn.dataset.orderItemMode === (isCustom ? 'custom' : 'inventory');
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (itemSelect) itemSelect.required = !isCustom;
  const customName = form.elements.customItemName;
  if (customName) customName.required = isCustom;
  const customWeightEntry = getWeightEntryEl(form, 'custom');
  if (customWeightEntry) {
    customWeightEntry.querySelectorAll('input').forEach((input) => {
      input.required = isCustom && (input.name === 'customWeightGrams' || getWeightUnit(form, 'custom') === 'tola');
    });
  }
  updateOrderTotalPreview();
  updateOrderItemWeightPreview();
}

function itemMarketValue(item, rate) {
  const gold = (Number(item.weightGrams) / TOLA_GRAMS) * rate * (item.karat / 24);
  return Math.round(gold + (Number(item.makingCharge) || 0));
}

function calcGoldPriceNpr(weightGrams, makingChargeNpr = 0, unit = 'grams', tolaParts = null, ratePerTolaNpr = getGoldRatePerTolaNpr()) {
  const metal = calcGoldMetalNpr({ grams: weightGrams, unit, tolaParts, ratePerTolaNpr });
  if (metal <= 0) return 0;
  return metal + (Number(makingChargeNpr) || 0);
}

function itemPriceFromForm(form, prefix = '') {
  const weightGrams = getWeightGramsFromForm(form, prefix);
  const weightUnit = getWeightUnit(form, prefix);
  const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, prefix) : null;
  const makingCharge = parseMoneyField(form.makingCharge?.value) || 0;
  if (!Number.isFinite(weightGrams) || weightGrams <= 0) return null;
  return calcGoldPriceNpr(weightGrams, makingCharge, weightUnit, tolaParts);
}

function getItemCalculatedPriceNpr(item) {
  return calcGoldPriceNpr(item.weightGrams, item.makingCharge || 0, 'grams');
}

function getItemDisplayPrice(item) {
  const manual = Number(item.salePrice);
  if (Number.isFinite(manual) && manual > 0) return manual;
  return getItemCalculatedPriceNpr(item);
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
  const skipRefresh = path.includes('/api/settings/daily-gold-rate')
    || path.includes('/api/shared/gold-rates')
    || path.includes('/api/customers');
  if (isMutation && !isAuth && !skipRefresh) scheduleRefresh();
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
  if (effectivePriceMode() === 'manual') {
    applyManualRatesToApp(resolveManualMetalRates());
    return;
  }
  if (payload.metalRatesLive) {
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

async function updateMetalRates(settings = {}) {
  const goldEl = document.getElementById('metal-rate-gold');
  const silverEl = document.getElementById('metal-rate-silver');
  const bodyEl = document.getElementById('metal-rates-body');
  const rateEdit = document.querySelector('.rate-edit');
  const priceMode = settings.priceMode || effectivePriceMode();
  settingsPriceMode = priceMode;

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
      const onDailySettings = activeView === 'settings' && currentRateHistoryPeriod() === 'daily';
      if (!onDailySettings) {
        await persistDailyGoldRateSnapshot('api', {
          goldRatePerTola: goldRateCache,
          goldRatePerGram: Number((goldRateCache / TOLA_GRAMS).toFixed(2))
        });
      }
    } catch (err) {
      const message = err.message || t('metalApiWarning');
      if (bodyEl) {
        bodyEl.hidden = false;
        bodyEl.innerHTML = `<span class="metal-rates-warning">${message}</span>`;
      }
      if (goldRateCache > 0 && goldEl) {
        goldEl.hidden = false;
        goldEl.textContent =
          `Gold: ${formatMoney(goldRateCache)}/tola · ${formatMoney(Number((goldRateCache / TOLA_GRAMS).toFixed(2)))}/g`;
      } else if (goldEl) {
        goldEl.hidden = true;
      }
      if (silverRateCache > 0 && silverEl) {
        silverEl.hidden = false;
        silverEl.textContent =
          `Silver: ${formatMoney(silverRateCache)}/tola · ${formatMoney(Number((silverRateCache / TOLA_GRAMS).toFixed(2)))}/g`;
      } else if (silverEl) {
        silverEl.hidden = true;
      }
    }
    if (rateEdit) rateEdit.hidden = false;
    refreshMetalPriceFields();
    updateGoldCalculator();
    updateOrderTotalPreview();
    return;
  }

  if (bodyEl) bodyEl.hidden = true;
  const metal = resolveManualMetalRates(settings);
  applyManualRatesToApp(metal);
  if (rateEdit) rateEdit.hidden = false;
  refreshMetalPriceFields();
  updateGoldCalculator();
  updateOrderTotalPreview();
}

function updateMetalRatePreviews() {
  syncSettingsGoldRateFromGram();
  syncSettingsSilverRateFromGram();
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
  locationsCache = [...locationsCache, trimmed];
  renderLocationsManager();
  toast(t('locationAdded'));
  const input = document.getElementById('new-location-input');
  if (input) input.value = '';
}

async function removeStoreLocation(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= locationsCache.length) return;
  locationsCache = locationsCache.filter((_, i) => i !== idx);
  renderLocationsManager();
  toast(t('locationRemoved'));
}

async function persistStoreLocations() {
  const previous = [...locationsCache];
  try {
    await saveStoreLocations();
    toast(t('locationsSaved'));
  } catch (err) {
    locationsCache = previous;
    renderLocationsManager();
    toast(err.message);
  }
}

function generateSku(prefix = 'SKU') {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

function renderCategorySelect(select, { includeAll = false, defaultValue = 'other' } = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';
  if (includeAll) {
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = t('allCategories');
    select.appendChild(allOpt);
  }
  itemCategoriesCache.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = categorySlug(name);
    opt.textContent = categoryOptionLabel(name);
    select.appendChild(opt);
  });
  if (previous && [...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  } else if (!includeAll && [...select.options].some((o) => o.value === defaultValue)) {
    select.value = defaultValue;
  }
}

function ensureCategoryOption(select, value) {
  if (!select || !value) return;
  if ([...select.options].some((o) => o.value === value)) return;
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = categoryLabel(value);
  select.appendChild(opt);
}

function renderAllCategorySelects() {
  renderCategorySelect(document.getElementById('pos-filter-category'), { includeAll: true });
  renderCategorySelect(document.querySelector('#item-form select[name="category"]'));
  renderCategorySelect(document.querySelector('#custom-item-form select[name="category"]'));
}

function renderItemCategoriesManager() {
  const list = document.getElementById('item-categories-list');
  if (!list) return;
  if (!itemCategoriesCache.length) {
    list.innerHTML = `<li class="location-empty">${t('noCategories')}</li>`;
    return;
  }
  list.innerHTML = itemCategoriesCache.map((cat, idx) => {
    const isOther = categorySlug(cat) === 'other';
    const removeBtn = isOther
      ? ''
      : `<button type="button" class="location-remove" data-remove-category="${idx}" title="${t('delete')}" aria-label="${t('delete')}">×</button>`;
    return `
    <li class="location-tag">
      <span>${categoryOptionLabel(cat)}</span>
      ${removeBtn}
    </li>`;
  }).join('');
}

async function saveStoreItemCategories() {
  const snapshot = [...itemCategoriesCache];
  await api('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify({ itemCategories: snapshot })
  });
  setItemCategoryNames(snapshot);
  renderAllCategorySelects();
  renderItemCategoriesManager();
}

async function addStoreCategory(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    toast(t('categoryNameRequired'));
    return;
  }
  if (itemCategoriesCache.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
    toast(t('categoryExists'));
    return;
  }
  itemCategoriesCache = [...itemCategoriesCache, trimmed];
  renderItemCategoriesManager();
  toast(t('categoryAdded'));
  const input = document.getElementById('new-category-input');
  if (input) input.value = '';
}

async function removeStoreCategory(index) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= itemCategoriesCache.length) return;
  if (categorySlug(itemCategoriesCache[idx]) === 'other') return;
  itemCategoriesCache = itemCategoriesCache.filter((_, i) => i !== idx);
  renderItemCategoriesManager();
  toast(t('categoryRemoved'));
}

async function persistStoreItemCategories() {
  const previous = [...itemCategoriesCache];
  try {
    await saveStoreItemCategories();
    toast(t('categoriesSaved'));
  } catch (err) {
    itemCategoriesCache = previous;
    setItemCategoryNames(previous);
    renderAllCategorySelects();
    renderItemCategoriesManager();
    toast(err.message);
  }
}

let shopNameCheckTimer = null;

function renderShopNameStatus({ available, checking, unchanged } = {}) {
  const el = document.getElementById('shop-name-status');
  const input = document.getElementById('settings-shop-name');
  if (!el || !input) return;
  if (unchanged) {
    el.hidden = true;
    el.textContent = '';
    input.setCustomValidity('');
    return;
  }
  if (checking) {
    el.hidden = false;
    el.textContent = '…';
    el.className = 'form-hint shop-name-status';
    input.setCustomValidity('');
    return;
  }
  if (available) {
    el.hidden = false;
    el.textContent = t('shopNameAvailable');
    el.className = 'form-hint shop-name-status is-available';
    input.setCustomValidity('');
  } else {
    el.hidden = false;
    el.textContent = t('shopNameTaken');
    el.className = 'form-hint shop-name-status is-taken';
    input.setCustomValidity(t('shopNameTaken'));
  }
}

async function checkShopNameAvailability(name) {
  const trimmed = String(name || '').trim();
  const current = String(settingsCache.shopName || '').trim();
  if (!trimmed || trimmed.toLowerCase() === current.toLowerCase()) {
    renderShopNameStatus({ unchanged: true });
    return true;
  }
  renderShopNameStatus({ checking: true });
  try {
    const payload = await api(`/api/settings/shop-name-available?name=${encodeURIComponent(trimmed)}`);
    renderShopNameStatus({ available: Boolean(payload.available) });
    return Boolean(payload.available);
  } catch (_) {
    renderShopNameStatus({ unchanged: true });
    return true;
  }
}

function scheduleShopNameCheck(name) {
  clearTimeout(shopNameCheckTimer);
  shopNameCheckTimer = setTimeout(() => {
    checkShopNameAvailability(name).catch(() => renderShopNameStatus({ unchanged: true }));
  }, 350);
}

function updateShopBranding(view = activeView) {
  const shop = settingsCache.shopName || 'Suvarnapasal';
  const brandEl = document.getElementById('brand-shop-name');
  if (brandEl) brandEl.textContent = shop;
  const brandLogo = document.querySelector('.brand .brand-logo');
  if (brandLogo) brandLogo.alt = shop;

  const viewTitles = {
    pos: t('navPOS'),
    inventory: t('navInventory'),
    orders: t('navOrders'),
    customers: t('navCustomers'),
    reports: t('navReports'),
    expenses: t('navExpenses'),
    calculator: t('navCalculator'),
    settings: t('viewSettingsTitle')
  };
  const section = viewTitles[view] || view;
  document.title = `${shop} — ${section}`;
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
    renderShopNameStatus({ unchanged: true });
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
  settingsCache.goldRatePerTola = goldRateCache;
  settingsCache.silverRatePerTola = silverRateCache;
  rateHistoryCache = (settings.rateHistory || []).map(normalizeRateHistoryRow);
  await loadSharedGoldRates();
  refreshMetalPriceFields();
  await updateMetalRates(settings);
  await ensureTodayGoldRateInDatabase();

  locationsCache = settings.locations || [];
  renderLocationDatalist();
  renderLocationsManager();

  itemCategoriesCache = settings.itemCategories?.length
    ? settings.itemCategories
    : [...DEFAULT_ITEM_CATEGORIES];
  setItemCategoryNames(itemCategoriesCache);
  renderAllCategorySelects();
  renderItemCategoriesManager();

  document.getElementById('settings-updated').textContent = settings.updatedAt
    ? `${t('lastSaved')} ${new Date(settings.updatedAt).toLocaleString()}`
    : '';

  renderRateHistoryChart();
  renderRateHistoryTable();
  renderLiveDailyRateNow();
  syncMetalRatePolling();
  updateShopBranding();
}

function showView(name) {
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

  updateShopBranding(name);

  if (name !== 'calculator') document.getElementById('quick-calc-modal')?.close();

  if (name === 'orders') {
    if (ordersAllCache.length) renderOrdersView();
    else loadOrders().catch(() => {});
  }
  if (name === 'reports') {
    loadReports().catch((e) => toast(e.message));
  }
  if (name === 'calculator') {
    initGoldCalculator();
    updateGoldCalculator();
  }
  if (name === 'customers') {
    loadCustomers().catch(() => {});
  }
  syncMetalRatePolling();
  syncCustomersPolling();
}

function cartLineName(line) {
  return line.name || line.itemName || line.sku || t('item');
}

function getSaleCustomerName() {
  return String(selectedCustomer?.name || '').trim();
}

function getSaleCustomerPhone() {
  return String(selectedCustomer?.phone || '').trim();
}

function renderPosCustomerDisplay() {
  const box = document.getElementById('pos-customer-display');
  const nameEl = document.getElementById('pos-customer-display-name');
  const phoneEl = document.getElementById('pos-customer-display-phone');
  const emailEl = document.getElementById('pos-customer-display-email');
  const addressEl = document.getElementById('pos-customer-display-address');
  const name = getSaleCustomerName();
  const phone = getSaleCustomerPhone();
  const email = String(selectedCustomer?.email || '').trim();
  const address = String(selectedCustomer?.address || '').trim();
  if (!box) return;
  if (!name) {
    box.hidden = true;
    if (nameEl) nameEl.textContent = '';
    if (phoneEl) phoneEl.textContent = '—';
    if (emailEl) emailEl.textContent = '—';
    if (addressEl) addressEl.textContent = '—';
    return;
  }
  box.hidden = false;
  if (nameEl) nameEl.textContent = name;
  if (phoneEl) phoneEl.textContent = phone || '—';
  if (emailEl) emailEl.textContent = email || '—';
  if (addressEl) addressEl.textContent = address || '—';
}

function ensurePosCustomerName() {
  if (getSaleCustomerName()) return true;
  toast(t('customerNamePrompt'));
  return false;
}

function resetPosCustomer() {
  selectedCustomer = null;
  const search = document.getElementById('pos-customer-search');
  if (search) search.value = '';
  const box = document.getElementById('customer-suggestions');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderPosCustomerDisplay();
  renderSaleCustomer();
}

function applyPosCustomer(customer) {
  selectedCustomer = {
    name: String(customer?.name || '').trim(),
    phone: String(customer?.phone || '').trim(),
    email: String(customer?.email || '').trim(),
    address: String(customer?.address || '').trim()
  };
  const search = document.getElementById('pos-customer-search');
  const box = document.getElementById('customer-suggestions');
  if (search) search.value = '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderPosCustomerDisplay();
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
    visible.sort((a, b) => getItemDisplayPrice(a) - getItemDisplayPrice(b));
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
              <td class="pos-item-price">${formatMoney(getItemDisplayPrice(item))}</td>
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
    tableEl.innerHTML = `<table class="data-table">${inventoryTableHead()}<tbody><tr class="empty-row"><td colspan="11">${t('noResults')}</td></tr></tbody></table>`;
    return;
  }

  const goldRatePerTola = goldRateCache;
  tableEl.innerHTML = `<table class="data-table">${inventoryTableHead()}<tbody>
    ${itemsCache.map((i) => {
      const qty = availableQuantity(i);
      const displayItem = itemStockStatusForDisplay(i);
      return `<tr>
        <td><input type="checkbox" aria-label="Select row" /></td>
        <td class="name-cell"><strong>${i.name}</strong></td>
        <td>${i.sku}</td><td>${categoryLabel(i.category)}</td>
        <td>${i.location || '—'}</td>
        <td>${i.weightGrams}</td><td>${i.karat}K</td><td>${qty}</td>
        <td>${itemStockStatusBadge(displayItem)}</td>
        <td>${formatMoney(getItemDisplayPrice(i))}</td>
        <td class="options-cell inventory-actions-cell">
          ${isItemSoldOut(i)
    ? '<span class="inventory-no-edit">—</span>'
    : `<button type="button" class="link-btn" data-edit="${i.id}">${t('edit')}</button>`}
          <button type="button" class="link-btn danger" data-delete="${i.id}">${t('delete')}</button>
        </td>
      </tr>`;
    }).join('')}
  </tbody></table>`;
}

function customItemPriceFromFields(form) {
  return itemPriceFromForm(form, '');
}

function updateItemPricePreview() {
  const form = document.getElementById('item-form');
  const preview = document.getElementById('item-price-preview');
  const breakdownEl = document.getElementById('item-price-breakdown');
  if (!form || !preview) return;
  const calculated = itemPriceFromForm(form, '');
  preview.value = calculated != null ? formatMoney(calculated) : '—';
  const salePriceInput = form.salePrice;
  if (salePriceInput && !salePriceInput.value && calculated != null) {
    salePriceInput.placeholder = formatMoneyPlain(calculated);
  }
  if (breakdownEl) {
    const weightGrams = getWeightGramsFromForm(form, '');
    const weightUnit = getWeightUnit(form, '');
    const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, '') : null;
    const makingCharge = parseMoneyField(form.makingCharge?.value) || 0;
    const html = renderOrderPriceBreakdown({
      weightUnit,
      weightGrams,
      tolaParts,
      makingChargeNpr: makingCharge,
      qty: 1
    });
    breakdownEl.innerHTML = html;
    breakdownEl.hidden = !html;
  }
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
  const matches = customersCache.filter((c) => {
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
  openOrderModal({ context: 'pos' }).catch(() => {});
}

function addCustomItemToCart(data) {
  try { requireSignedInSync(); } catch (err) { toast(err.message); return; }
  const itemName = String(data.name || '').trim();
  const qty = Math.max(1, Number(data.quantity) || 1);
  const calculated = data.weightUnit === 'tola' && data.tolaParts
    ? calcGoldPriceNpr(
      Number(data.weightGrams),
      parseMoneyField(data.makingCharge) || 0,
      'tola',
      data.tolaParts
    )
    : data.weightUnit
      ? calcGoldPriceNpr(
        Number(data.weightGrams),
        parseMoneyField(data.makingCharge) || 0,
        data.weightUnit
      )
      : itemMarketValue({
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

  const sku = generateSku('CUSTOM');
  const karat = Number(data.karat) || 24;
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
      price: getItemDisplayPrice(item)
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

  order.lines.forEach((line, index) => {
    const item = getItemFromCaches(line.itemId);
    const qty = Math.max(1, Number(line.quantity) || 1);
    const price = Number(line.unitPrice)
      || (item ? getItemDisplayPrice(item) : 0);
    const cartKey = `order-${order.id}-${line.itemId || index}`;
    const existing = posCart.find((l) => l.cartKey === cartKey);

    if (existing) {
      existing.qty += qty;
      if (price) existing.price = price;
      if (!existing.name) existing.name = line.itemName || item?.name || existing.sku;
      return;
    }

    posCart.push({
      cartKey,
      itemId: cartKey,
      fromOrder: order.id,
      orderNumber: order.orderNumber,
      custom: true,
      sku: line.sku || item?.sku || '—',
      name: line.itemName || item?.name || t('item'),
      qty,
      price
    });
  });

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
  const matches = customersCache.filter((c) => {
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

function isNonInventoryCartLine(line) {
  return Boolean(line?.custom || line?.fromOrder);
}

function cartQtyForItem(itemId) {
  if (!itemId) return 0;
  const id = String(itemId);
  if (id.startsWith('custom-') || id.startsWith('order-')) return 0;
  return posCart
    .filter((line) => line.itemId === itemId && !isNonInventoryCartLine(line))
    .reduce((sum, line) => sum + line.qty, 0);
}

function getItemFromCaches(itemId) {
  return itemsCache.find((i) => i.id === itemId)
    || orderItemsCache.find((i) => i.id === itemId)
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

function isItemSoldOut(item) {
  return Boolean(item && (item.status === 'sold_out' || Number(item.quantity) <= 0));
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
  const customers = customersCache;
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
    if (activeView === 'customers') loadCustomers().catch(() => {});
  } catch (err) {
    ordersAllCache = [];
    if (countEl) countEl.textContent = rowCountLabel(0, 0);
    if (contentEl) contentEl.innerHTML = ordersEmptyTable();
    errorToast(t('errorTitle'), t('ordersLoadError'));
  }
}

function renderCustomersTable() {
  const search = document.getElementById('search-customers')?.value.trim().toLowerCase() || '';
  const filter = document.getElementById('filter-customers')?.value.trim().toLowerCase() || '';
  const customers = customersCache.filter((c) => {
    const hay = `${c.name} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
    if (search && !hay.includes(search)) return false;
    if (filter && !c.name.toLowerCase().includes(filter)) return false;
    return true;
  });
  const countEl = document.getElementById('customers-row-count');
  if (countEl) countEl.textContent = rowCountLabel(0, customers.length);
  const tableEl = document.getElementById('customers-table');
  if (!tableEl) return;
  tableEl.innerHTML = customers.length
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

async function migrateLocalCustomersOnce() {
  if (localCustomersMigrated) return;
  localCustomersMigrated = true;
  const legacy = localData('subarnapasal.customers', []);
  if (!legacy.length) return;
  for (const row of legacy) {
    try {
      await api('/api/customers/upsert', {
        method: 'POST',
        body: JSON.stringify({
          name: row.name,
          phone: row.phone || '',
          email: row.email || '',
          address: row.address || ''
        })
      });
    } catch (_) { /* skip failed legacy row */ }
  }
  try { localStorage.removeItem('subarnapasal.customers'); } catch (_) { /* ignore */ }
}

async function upsertCustomerActivity(customer) {
  const name = String(customer?.name || '').trim();
  if (!name) return;
  try {
    const payload = await api('/api/customers/upsert', {
      method: 'POST',
      body: JSON.stringify({
        name,
        phone: customer.phone || '',
        email: customer.email || '',
        address: customer.address || ''
      })
    });
    if (Array.isArray(payload.customers)) {
      customersCache = payload.customers;
      if (activeView === 'customers') renderCustomersTable();
    }
  } catch (_) { /* background save */ }
}

async function loadCustomers() {
  try {
    await migrateLocalCustomersOnce();
    const payload = await api('/api/customers');
    customersCache = payload.customers || [];
    renderCustomersTable();
  } catch (_) {
    customersCache = localData('subarnapasal.customers', []);
    renderCustomersTable();
  }
}

function stopCustomersPolling() {
  if (customersPollTimer) {
    clearInterval(customersPollTimer);
    customersPollTimer = null;
  }
}

function syncCustomersPolling() {
  stopCustomersPolling();
  if (activeView !== 'customers') return;
  loadCustomers().catch(() => {});
  customersPollTimer = setInterval(() => {
    loadCustomers().catch(() => {});
  }, CUSTOMERS_POLL_MS);
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

function updateOrderItemWeightPreview() {
  const form = document.getElementById('order-form');
  const preview = document.getElementById('order-item-weight-preview');
  if (!form || !preview || isOrderCustomItemMode(form)) {
    if (preview) preview.hidden = true;
    return;
  }
  const item = orderItemsCache.find((i) => i.id === form.itemId?.value);
  if (!item?.weightGrams) {
    preview.hidden = true;
    return;
  }
  preview.hidden = false;
  preview.textContent = formatWeightParts(item.weightGrams);
}

function updateOrderTotalPreview() {
  const form = document.getElementById('order-form');
  if (!form) return;
  const totalEl = document.getElementById('order-total-preview');
  const qty = Number(form.quantity.value) || 1;
  if (isOrderCustomItemMode(form)) {
    const weightGrams = getWeightGramsFromForm(form, 'custom');
    const weightUnit = getWeightUnit(form, 'custom');
    const tolaParts = weightUnit === 'tola' ? getTolaPartsFromForm(form, 'custom') : null;
    const makingCharge = parseMoneyField(form.customMakingCharge?.value) || 0;
    const breakdownEl = document.getElementById('order-price-breakdown');
    const hasWeight = weightUnit === 'tola'
      ? Boolean(tolaParts && (tolaParts.tola || tolaParts.aana || tolaParts.laal))
      : weightGrams > 0;
    if (!hasWeight) {
      if (totalEl) totalEl.value = '';
      if (breakdownEl) {
        breakdownEl.hidden = true;
        breakdownEl.innerHTML = '';
      }
      return;
    }
    const rateNpr = getGoldRatePerTolaNpr();
    if (!rateNpr) {
      if (totalEl) totalEl.value = '—';
      if (breakdownEl) {
        breakdownEl.hidden = true;
        breakdownEl.innerHTML = '';
      }
      return;
    }
    const unitTotal = calcGoldPriceNpr(weightGrams, makingCharge, weightUnit, tolaParts, rateNpr);
    if (totalEl) totalEl.value = formatMoney(unitTotal * qty);
    if (breakdownEl) {
      const html = renderOrderPriceBreakdown({
        weightUnit,
        weightGrams,
        tolaParts,
        makingChargeNpr: makingCharge,
        qty,
        ratePerTolaNpr: rateNpr
      });
      breakdownEl.innerHTML = html;
      breakdownEl.hidden = !html;
    }
    return;
  }
  const breakdownEl = document.getElementById('order-price-breakdown');
  if (breakdownEl) {
    breakdownEl.hidden = true;
    breakdownEl.innerHTML = '';
  }
  const item = orderItemsCache.find((i) => i.id === form.itemId?.value);
  if (!item || !totalEl) {
    if (totalEl) totalEl.value = '';
    updateOrderItemWeightPreview();
    return;
  }
  totalEl.value = formatMoney(getItemDisplayPrice(item) * qty);
  updateOrderItemWeightPreview();
}

async function updateOrderStatus(orderId, status) {
  await api(`/api/orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  toast(t('orderUpdated'));
}

function itemPayloadFromForm(form, fd) {
  const quantity = Math.max(0, Number(fd.get('quantity')) || 0);
  const status = fd.get('status') || 'in_stock';
  return {
    sku: String(fd.get('sku') || '').trim() || generateSku(),
    name: String(fd.get('name') || '').trim(),
    category: fd.get('category') || 'other',
    karat: Number(fd.get('karat')) || 24,
    weightGrams: getWeightGramsFromForm(form, ''),
    makingCharge: parseMoneyField(fd.get('makingCharge') || 0),
    purchaseCost: parseMoneyField(fd.get('purchaseCost') || 0),
    salePrice: fd.get('salePrice') ? parseMoneyField(fd.get('salePrice')) : 0,
    quantity: status === 'sold_out' ? 0 : quantity,
    status,
    location: String(fd.get('location') || '').trim(),
    hallmark: fd.get('hallmark') === 'on',
    notes: String(fd.get('notes') || '').trim()
  };
}

function openItemModal(item) {
  if (item && isItemSoldOut(item)) {
    toast(t('soldOutItemNotEditable'));
    return;
  }
  editingId = item?.id || null;
  document.getElementById('modal-title').textContent = item ? t('editItemTitle') : t('addItemTitle');
  const form = document.getElementById('item-form');
  form.reset();
  renderCategorySelect(form.category, { defaultValue: 'other' });
  if (item) {
    Object.entries(item).forEach(([k, v]) => {
      if (k === 'weightGrams') return;
      const field = form.elements[k];
      if (!field) return;
      if (field.type === 'checkbox') field.checked = Boolean(v);
      else if (['makingCharge', 'purchaseCost', 'salePrice'].includes(k)) field.value = formatMoneyField(v);
      else field.value = v;
    });
    ensureCategoryOption(form.category, item.category);
    form.category.value = item.category || 'other';
    form.sku.value = item.sku || generateSku();
    setWeightFieldsFromGrams(form, item.weightGrams, '');
    syncWeightEntryPanels(form, '');
  } else {
    form.category.value = 'other';
    form.sku.value = generateSku();
    form.karat.value = '24';
    form.makingCharge.value = 0;
    form.quantity.value = 1;
    form.hallmark.checked = true;
    if (form.elements.weightUnit) form.elements.weightUnit.value = 'grams';
    syncWeightEntryPanels(form, '');
    setWeightFieldsFromGrams(form, '', '');
  }
  updateItemPricePreview();
  document.getElementById('item-modal').showModal();
}

function nextBillNumber() {
  return `BILL-${Date.now().toString().slice(-8)}`;
}

function getBillOptions() {
  return {
    showSign: document.getElementById('bill-show-sign')?.checked !== false,
    showCustomerSign: document.getElementById('bill-show-customer-sign')?.checked !== false,
    showStamp: document.getElementById('bill-show-stamp')?.checked !== false,
    signatoryName: document.getElementById('bill-signatory-name')?.value.trim()
      || settingsCache.shopName
      || 'Suvarnapasal'
  };
}

function billSignaturesBlock(sale, options) {
  if (!options.showSign && !options.showCustomerSign) return '';
  const blocks = [];
  if (options.showCustomerSign) {
    blocks.push(`
      <div class="bill-sign-block bill-sign-block-customer">
        <div class="bill-sign-line bill-sign-line-blank" aria-hidden="true"></div>
        <span class="bill-sign-label">${t('customerSignature')}</span>
      </div>`);
  }
  if (options.showSign) {
    blocks.push(`
      <div class="bill-sign-block bill-sign-block-authorized">
        <div class="bill-sign-line">
          <span class="bill-sign-name">${options.signatoryName}</span>
        </div>
        <span class="bill-sign-label">${t('authorizedSignatory')}</span>
      </div>`);
  }
  return `<div class="bill-signatures bill-signatures-dual">${blocks.join('')}</div>`;
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

        ${billSignaturesBlock(sale, options)}

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
    if (isNonInventoryCartLine(line)) {
      const orderRef = line.orderNumber || line.fromOrder;
      const note = line.fromOrder
        ? `Order ${orderRef} — ${customer}${line.sku ? ` · ${line.sku}` : ''}`
        : `POS — ${customer} · ${line.sku || 'CUSTOM'}${line.karat ? ` · ${line.karat}K` : ''}${line.weightGrams ? ` · ${line.weightGrams}g` : ''}${line.notes ? ` · ${line.notes}` : ''}`;
      await api('/api/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: 'sale',
          customItem: true,
          itemName: line.name,
          quantity: line.qty,
          amount: line.price * line.qty,
          note
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
  resetPosCustomer();
  renderCart();
  renderSaleBill(sale);
  await upsertCustomerActivity({ name: customer, phone: customerPhone });
  scheduleRefresh();
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
  await loadCustomers();
  loadExpenses();
  initGoldCalculator();
  updateGoldCalculator();
  updateTaxInputUi();
  renderCart();
}

function populateOrderItemSelect() {
  const select = document.getElementById('order-item-select');
  const submitBtn = document.getElementById('order-submit-btn');
  if (!select) return;
  select.innerHTML = orderItemsCache.length
    ? orderItemsCache.map((i) => {
      const price = formatMoney(getItemDisplayPrice(i));
      return `<option value="${i.id}">${i.sku} — ${i.name} · ${price} (${i.quantity} ${t('inStockCount')})</option>`;
    }).join('')
    : `<option value="">${t('noStock')}</option>`;
  select.disabled = !orderItemsCache.length;
  if (submitBtn) submitBtn.disabled = false;
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
  const matches = customersCache.filter((c) => {
    const hay = `${c.name} ${c.phone || ''}`.toLowerCase();
    return hay.includes(q);
  }).slice(0, 6);
  if (!matches.length) {
    box.hidden = true;
    box.innerHTML = '';
    const name = input.value.trim();
    if (name) {
      form.customerName.value = name;
      form.customerPhone.value = '';
      renderOrderCustomerDisplay({ name, phone: '', email: '' });
    } else {
      form.customerName.value = '';
      form.customerPhone.value = '';
      renderOrderCustomerDisplay(null);
    }
    return;
  }
  box.hidden = false;
  box.innerHTML = matches.map((c) => `
    <button type="button" data-order-customer-pick="${c.id}">
      ${c.name}
      <span class="suggestion-meta">${c.phone || c.email || ''}</span>
    </button>`).join('');
}

function renderOrderCustomerDisplay(customer) {
  const box = document.getElementById('order-customer-display');
  const nameEl = document.getElementById('order-customer-display-name');
  const phoneEl = document.getElementById('order-customer-display-phone');
  const emailEl = document.getElementById('order-customer-display-email');
  const name = String(customer?.name || '').trim();
  if (!box) return;
  if (!name) {
    box.hidden = true;
    if (nameEl) nameEl.textContent = '';
    if (phoneEl) phoneEl.textContent = '—';
    if (emailEl) emailEl.textContent = '—';
    return;
  }
  box.hidden = false;
  if (nameEl) nameEl.textContent = name;
  if (phoneEl) phoneEl.textContent = String(customer?.phone || '').trim() || '—';
  if (emailEl) emailEl.textContent = String(customer?.email || '').trim() || '—';
}

function clearOrderCustomer() {
  const form = document.getElementById('order-form');
  if (form) {
    form.customerName.value = '';
    form.customerPhone.value = '';
  }
  const search = document.getElementById('order-customer-search');
  if (search) search.value = '';
  const box = document.getElementById('order-customer-suggestions');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderOrderCustomerDisplay(null);
}

function fillOrderCustomerFields(customer) {
  const form = document.getElementById('order-form');
  const search = document.getElementById('order-customer-search');
  const box = document.getElementById('order-customer-suggestions');
  if (!form) return;
  form.customerName.value = customer.name || '';
  form.customerPhone.value = customer.phone || '';
  if (search) search.value = '';
  if (box) { box.hidden = true; box.innerHTML = ''; }
  renderOrderCustomerDisplay(customer);
}

async function openOrderModal({ context = 'order' } = {}) {
  const form = document.getElementById('order-form');
  const modal = document.getElementById('order-modal');
  if (!form || !modal) return;
  orderModalContext = context;
  form.reset();
  form.quantity.value = 1;
  if (form.customMakingCharge) form.customMakingCharge.value = 0;
  if (form.customKarat) form.customKarat.value = '24';
  syncWeightEntryPanels(form, 'custom');
  setOrderItemMode(form, 'custom');
  clearOrderCustomer();
  updateOrderModalChrome();

  if (context === 'pos' && selectedCustomer?.name) {
    fillOrderCustomerFields(selectedCustomer);
  }

  try {
    const payload = await api('/api/items?status=in_stock');
    orderItemsCache = payload.items.filter((i) => i.quantity > 0);
    applyMetalRatesFromResponse(payload);
  } catch (_) { /* ignore */ }
  populateOrderItemSelect();
  updateOrderTotalPreview();
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
document.getElementById('clear-order-customer-btn')?.addEventListener('click', clearOrderCustomer);
document.getElementById('order-customer-search')?.addEventListener('input', renderOrderCustomerSuggestions);
document.getElementById('order-customer-search')?.addEventListener('focus', renderOrderCustomerSuggestions);
document.getElementById('order-customer-suggestions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-order-customer-pick]');
  if (!btn) return;
  const customer = customersCache.find((c) => c.id === btn.dataset.orderCustomerPick);
  if (customer) fillOrderCustomerFields(customer);
});
document.getElementById('order-form')?.addEventListener('click', (e) => {
  const modeBtn = e.target.closest('[data-order-item-mode]');
  if (modeBtn) {
    e.preventDefault();
    setOrderItemMode(modeBtn.closest('form'), modeBtn.dataset.orderItemMode);
  }
});
document.getElementById('order-form')?.addEventListener('input', (e) => {
  if (['itemId', 'quantity', 'customItemName', 'customKarat', 'customMakingCharge', 'customWeightUnit'].includes(e.target.name)
    || e.target.closest('#order-custom-fields .weight-entry')) {
    updateOrderTotalPreview();
  }
});
document.getElementById('order-form')?.addEventListener('weight-updated', () => {
  updateOrderTotalPreview();
});
document.getElementById('order-form')?.addEventListener('change', (e) => {
  if (e.target.name === 'itemId' || e.target.name === 'customWeightUnit') {
    updateOrderTotalPreview();
  }
});
document.getElementById('refresh-reports')?.addEventListener('click', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('export-report-btn')?.addEventListener('click', exportReportSummary);
document.getElementById('report-start')?.addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('report-end')?.addEventListener('change', () => loadReports().catch((e) => toast(e.message)));
document.getElementById('refresh-customers')?.addEventListener('click', loadCustomers);
document.getElementById('add-customer-page-btn')?.addEventListener('click', openCustomerModal);
document.getElementById('add-customer-btn')?.addEventListener('click', openCustomerModal);
document.getElementById('clear-pos-customer-btn')?.addEventListener('click', resetPosCustomer);
document.getElementById('add-custom-item')?.addEventListener('click', openCustomItemModal);
document.getElementById('close-custom-item-modal')?.addEventListener('click', () => document.getElementById('custom-item-modal')?.close());
document.getElementById('cancel-custom-item-modal')?.addEventListener('click', () => document.getElementById('custom-item-modal')?.close());
document.getElementById('custom-item-add-customer')?.addEventListener('click', openCustomerModal);
document.getElementById('custom-item-customer-search')?.addEventListener('input', renderCustomItemCustomerSuggestions);
document.getElementById('custom-item-customer-search')?.addEventListener('focus', renderCustomItemCustomerSuggestions);
document.getElementById('custom-item-customer-suggestions')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-custom-item-customer-pick]');
  if (!btn) return;
  const customer = customersCache.find((c) => c.id === btn.dataset.customItemCustomerPick);
  if (customer) fillCustomItemCustomerFields(customer);
});
document.getElementById('custom-item-form')?.addEventListener('input', (e) => {
  if (e.target.closest('.weight-entry') || ['karat', 'makingCharge'].includes(e.target.name)) {
    updateCustomItemPricePreview();
  }
  if (e.target.name === 'customerName') {
    const search = document.getElementById('custom-item-customer-search');
    if (search) search.value = e.target.value;
  }
});
document.getElementById('custom-item-form')?.addEventListener('weight-updated', () => {
  updateCustomItemPricePreview();
});
document.getElementById('custom-item-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const form = e.target;
  const weightGrams = getWeightGramsFromForm(form, '');
  if (weightGrams <= 0) {
    toast(t('weightRequired'));
    return;
  }
  addCustomItemToCart({
    customerName: fd.get('customerName'),
    customerPhone: fd.get('customerPhone'),
    category: fd.get('category') || 'other',
    name: fd.get('name'),
    karat: fd.get('karat'),
    weightGrams,
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

document.getElementById('close-order-modal')?.addEventListener('click', () => document.getElementById('order-modal').close());
document.getElementById('cancel-order-modal')?.addEventListener('click', () => document.getElementById('order-modal').close());
document.getElementById('close-customer-modal')?.addEventListener('click', () => document.getElementById('customer-modal').close());
document.getElementById('cancel-customer-modal')?.addEventListener('click', () => document.getElementById('customer-modal').close());
document.getElementById('close-modal')?.addEventListener('click', () => document.getElementById('item-modal').close());
document.getElementById('cancel-modal')?.addEventListener('click', () => document.getElementById('item-modal').close());
document.getElementById('item-modal')?.addEventListener('close', () => { editingId = null; });
document.getElementById('item-form')?.addEventListener('input', (e) => {
  if (['karat', 'makingCharge', 'salePrice', 'weightUnit'].includes(e.target.name)
    || e.target.closest('#item-form .weight-entry')) {
    updateItemPricePreview();
  }
});
document.getElementById('item-form')?.addEventListener('weight-updated', updateItemPricePreview);
document.getElementById('item-form')?.addEventListener('change', (e) => {
  if (e.target.name === 'weightUnit') updateItemPricePreview();
  if (e.target.name === 'status') {
    const form = e.target.form;
    const qtyEl = form?.elements?.quantity;
    if (!qtyEl) return;
    if (e.target.value === 'sold_out') qtyEl.value = 0;
  }
});

document.getElementById('item-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const body = itemPayloadFromForm(form, fd);
  if (!body.name) {
    toast(t('customItemNameRequired'));
    return;
  }
  if (body.weightGrams <= 0) {
    toast(t('weightRequired'));
    return;
  }
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
  const editBtn = e.target.closest('[data-edit]');
  const deleteBtn = e.target.closest('[data-delete]');
  if (editBtn?.dataset.edit) {
    const item = itemsCache.find((i) => i.id === editBtn.dataset.edit);
    if (item) openItemModal(item);
    return;
  }
  if (deleteBtn?.dataset.delete && confirm(t('deleteConfirm'))) {
    try {
      await api(`/api/items/${deleteBtn.dataset.delete}`, { method: 'DELETE' });
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
document.getElementById('customer-suggestions')?.addEventListener('click', (e) => {
  const id = e.target.closest('[data-customer-pick]')?.dataset.customerPick;
  if (!id) return;
  const customer = customersCache.find((c) => c.id === id);
  if (customer) selectPosCustomer(customer);
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-field')) {
    const box = document.getElementById('customer-suggestions');
    if (box) box.hidden = true;
  }
});
document.getElementById('pos-theme-toggle')?.addEventListener('click', () => toast(t('comingSoon')));
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
['bill-show-sign', 'bill-show-stamp', 'bill-show-customer-sign'].forEach((id) => {
  document.getElementById(id)?.addEventListener('change', refreshBillPreview);
});
document.getElementById('bill-signatory-name')?.addEventListener('input', refreshBillPreview);

document.getElementById('order-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  if (!String(form.customerName.value || '').trim()) {
    toast(t('customerNamePrompt'));
    return;
  }
  const fd = new FormData(form);
  const body = Object.fromEntries(fd.entries());
  body.quantity = Number(body.quantity) || 1;

  if (orderModalContext === 'pos' || body.orderItemMode === 'custom') {
    const weightGrams = getWeightGramsFromForm(form, 'custom');
    if (!String(body.customItemName || '').trim()) {
      toast(t('customItemNameRequired'));
      return;
    }
    if (weightGrams <= 0) {
      toast(t('weightRequired'));
      return;
    }
    if (orderModalContext === 'pos') {
      addCustomItemToCart({
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        category: 'other',
        name: body.customItemName,
        karat: body.customKarat,
        weightGrams,
        weightUnit: getWeightUnit(form, 'custom'),
        tolaParts: getWeightUnit(form, 'custom') === 'tola' ? getTolaPartsFromForm(form, 'custom') : null,
        makingCharge: body.customMakingCharge,
        quantity: body.quantity,
        location: '',
        hallmark: true,
        notes: body.note || '',
        salePrice: ''
      });
      document.getElementById('order-modal').close();
      form.reset();
      form.quantity.value = 1;
      if (form.customKarat) form.customKarat.value = '24';
      syncWeightEntryPanels(form, 'custom');
      clearOrderCustomer();
      return;
    }
    body.customItem = {
      name: String(body.customItemName || '').trim(),
      karat: Number(body.customKarat) || 24,
      weightGrams,
      weightUnit: getWeightUnit(form, 'custom'),
      weightTola: Number(form.customWeightTola?.value) || 0,
      weightAana: Number(form.customWeightAana?.value) || 0,
      weightLaal: Number(form.customWeightLaal?.value) || 0,
      makingCharge: parseMoneyField(body.customMakingCharge || 0)
    };
    delete body.itemId;
  }
  try {
    await api('/api/orders', { method: 'POST', body: JSON.stringify(body) });
    toast(t('orderCreated'));
    document.getElementById('order-modal').close();
    e.target.reset();
    e.target.quantity.value = 1;
    syncWeightEntryPanels(e.target, 'custom');
    clearOrderCustomer();
    orderGroup = 'progress';
    setOrderGroup('progress');
    await upsertCustomerActivity({
      name: body.customerName,
      phone: body.customerPhone
    });
    scheduleRefresh();
  } catch (err) { toast(err.message); }
});

document.getElementById('customer-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const payload = await api('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        phone: fd.get('phone'),
        email: fd.get('email') || '',
        address: fd.get('address') || ''
      })
    });
    customersCache = payload.customers || customersCache;
    const customer = payload.customer || customersCache[0];
    document.getElementById('customer-modal').close();
    toast(t('customerSaved'));
    renderCustomersTable();
    if (customer) {
      selectPosCustomer(customer);
      if (document.getElementById('order-modal')?.open) {
        fillOrderCustomerFields(customer);
      }
    }
  } catch (err) { toast(err.message); }
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

document.getElementById('customers-table')?.addEventListener('click', async (e) => {
  const id = e.target.dataset.customerDelete;
  if (!id) return;
  try {
    const payload = await api(`/api/customers/${encodeURIComponent(id)}`, { method: 'DELETE' });
    customersCache = payload.customers || [];
    renderCustomersTable();
  } catch (err) { toast(err.message); }
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
  const shopName = String(fd.get('shopName') || '').trim();
  if (!shopName) {
    toast(t('shopNameRequired'));
    return;
  }
  const available = await checkShopNameAvailability(shopName);
  if (!available) {
    toast(t('shopNameTaken'));
    return;
  }
  try {
    const updated = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        shopName,
        shopAddress: fd.get('shopAddress'),
        shopPhone: fd.get('shopPhone')
      })
    });
    settingsCache.shopName = updated.shopName || shopName;
    settingsCache.shopAddress = String(updated.shopAddress || fd.get('shopAddress') || '').trim();
    settingsCache.shopPhone = String(updated.shopPhone || fd.get('shopPhone') || '').trim();
    updateShopBranding();
    const signatory = document.getElementById('bill-signatory-name');
    if (signatory && (!signatory.value || signatory.value === 'Suvarnapasal' || signatory.value === 'SubarnaPasal')) {
      signatory.value = settingsCache.shopName;
    }
    renderShopNameStatus({ unchanged: true });
    toast(t('settingsSaved'));
  } catch (err) { toast(err.message); }
});

document.getElementById('settings-shop-name')?.addEventListener('input', (e) => {
  scheduleShopNameCheck(e.target.value);
});

document.getElementById('settings-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const goldRatePerTola = parseTolaRateInput(fd.get('goldRatePerTola'))
      || parseTolaFromGramInput(fd.get('goldRatePerGram'));
    const silverRatePerTola = parseTolaRateInput(fd.get('silverRatePerTola'))
      || parseTolaFromGramInput(fd.get('silverRatePerGram') || 0);
    const priceMode = fd.get('priceMode');
    const saved = await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ goldRatePerTola, silverRatePerTola, priceMode })
    });
    if (Array.isArray(saved.rateHistory)) {
      rateHistoryCache = saved.rateHistory;
      renderRateHistoryChart();
      renderRateHistoryTable();
    }
    settingsPriceMode = priceMode === 'api' ? 'api' : 'manual';
    settingsCache.priceMode = settingsPriceMode;
    settingsCache.goldRatePerTola = goldRatePerTola;
    settingsCache.silverRatePerTola = silverRatePerTola;
    goldRateCache = goldRatePerTola;
    silverRateCache = silverRatePerTola;
    if (settingsPriceMode === 'api') {
      await updateMetalRates({ priceMode: 'api' });
    } else {
      const metal = resolveManualMetalRates({
        goldRatePerTola,
        goldRatePerGram: Number((goldRatePerTola / TOLA_GRAMS).toFixed(2)),
        silverRatePerTola,
        silverRatePerGram: Number((silverRatePerTola / TOLA_GRAMS).toFixed(2))
      });
      await updateMetalRates({ priceMode: 'manual', ...metal });
    }
    syncMetalRatePolling();
    refreshDisplayPrices();
    toast(t('settingsSaved'));
  } catch (err) { toast(err.message); }
});

document.querySelector('#settings-form [name="goldRatePerGram"]')?.addEventListener('input', syncSettingsGoldRateFromGram);
document.querySelector('#settings-form [name="goldRatePerTola"]')?.addEventListener('input', syncSettingsGoldRateFromTola);
document.querySelector('#settings-form [name="silverRatePerGram"]')?.addEventListener('input', syncSettingsSilverRateFromGram);
document.querySelector('#settings-form [name="silverRatePerTola"]')?.addEventListener('input', syncSettingsSilverRateFromTola);
document.getElementById('clear-rate-history-btn')?.addEventListener('click', clearRateHistoryForCurrentMode);
document.querySelectorAll('.rate-history-period [data-rate-period]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.rate-history-period [data-rate-period]').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    if (btn.dataset.ratePeriod === 'daily') {
      loadSharedGoldRates().then(() => {
        renderRateHistoryChart();
        renderRateHistoryTable();
      }).catch(() => {});
      syncMetalRatePolling();
    } else {
      stopMetalRatePolling();
      liveDailyCurrentTick = null;
      resetLiveDailySecondSeries();
      liveDailyFlatAnchor = null;
    }
    renderLiveDailyRateNow();
    renderRateHistoryChart();
  });
});
document.querySelectorAll('#settings-form [name="priceMode"]').forEach((radio) => {
  radio.addEventListener('change', async () => {
    settingsPriceMode = effectivePriceMode();
    stopMetalRatePolling();
    if (!isLiveDailyApiMode()) {
      liveDailyCurrentTick = null;
      resetLiveDailySecondSeries();
      liveDailyFlatAnchor = null;
    }
    if (settingsPriceMode === 'manual') {
      const metal = resolveManualMetalRates(settingsCache);
      applyManualRatesToApp(metal);
      refreshMetalPriceFields();
      await updateMetalRates({ priceMode: 'manual', ...metal });
    } else {
      await updateMetalRates({ priceMode: 'api', ...settingsCache });
    }
    loadSharedGoldRates().then(() => {
      renderRateHistoryChart();
      renderRateHistoryTable();
    }).catch(() => {});
    renderLiveDailyRateNow();
    renderRateHistoryChart();
    renderRateHistoryTable();
    syncMetalRatePolling();
  });
});

document.getElementById('language-select')?.addEventListener('change', (e) => {
  changeLanguage(e.target.value);
});

document.getElementById('currency-select')?.addEventListener('change', async (e) => {
  const prevCurrency = displayCurrency;
  setDisplayCurrency(e.target.value);
  try {
    await api('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ currency: displayCurrency })
    });
    settingsCache.currency = displayCurrency;
    await refreshAfterCurrencyChange(prevCurrency);
  } catch (err) {
    toast(err.message);
    await loadSettings();
  }
});

setItemCategoryNames(itemCategoriesCache);
renderAllCategorySelects();
initAllWeightEntries();
initGoldCalculator();
initQuickCalculator();
document.getElementById('order-item-select')?.addEventListener('change', updateOrderTotalPreview);
document.querySelector('#order-form [name="quantity"]')?.addEventListener('input', updateOrderTotalPreview);

document.getElementById('save-locations-btn')?.addEventListener('click', () => {
  persistStoreLocations().catch((err) => toast(err.message));
});
document.getElementById('save-categories-btn')?.addEventListener('click', () => {
  persistStoreItemCategories().catch((err) => toast(err.message));
});

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
    return;
  }
  if (e.target.closest('#add-category-btn')) {
    e.preventDefault();
    const input = document.getElementById('new-category-input');
    addStoreCategory(input?.value).catch((err) => toast(err.message));
    return;
  }
  const removeCategoryBtn = e.target.closest('[data-remove-category]');
  if (removeCategoryBtn) {
    e.preventDefault();
    removeStoreCategory(removeCategoryBtn.dataset.removeCategory).catch((err) => toast(err.message));
  }
});

document.getElementById('new-location-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addStoreLocation(e.target.value).catch((err) => toast(err.message));
  }
});

document.getElementById('new-category-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addStoreCategory(e.target.value).catch((err) => toast(err.message));
  }
});

document.getElementById('theme-toggle')?.addEventListener('click', () => toast(t('comingSoon')));

window.addEventListener('beforeunload', () => { flushSharedGraphTicks(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSharedGraphTicks();
});

async function initApp() {
  initDateDefaults();
  setLanguage(currentLang);
  if (typeof waitForAuthReady === 'function') await waitForAuthReady();

  const authRequired = typeof isAuthRequired === 'function' && isAuthRequired();
  const token = typeof getAuthAccessToken === 'function' ? await getAuthAccessToken() : null;
  if (authRequired && !token) {
    if (typeof redirectToLogin === 'function') redirectToLogin();
    return;
  }

  const revealFailsafe = window.setTimeout(() => {
    if (typeof revealAppShell === 'function') revealAppShell();
  }, 12000);

  let shouldReveal = true;
  try {
    await refreshAll();
  } catch (err) {
    if (/sign in required/i.test(err.message)) {
      shouldReveal = false;
    } else if (typeof toast === 'function') {
      toast(err.message);
    }
  } finally {
    window.clearTimeout(revealFailsafe);
    if (shouldReveal && typeof revealAppShell === 'function') revealAppShell();
  }
}

initApp().catch((err) => toast(err.message));
