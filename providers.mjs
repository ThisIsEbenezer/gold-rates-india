// Data providers. Each call is wrapped with a timeout and falls back to the next source.
// No API keys required. Metal prices are quoted in USD per troy ounce.
import { tzParts } from './market.mjs';

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; GoldRatesIndia/1.0)', accept: 'application/json' };

async function getJson(fetchImpl, url, timeoutMs = 7000) {
  const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function firstOk(attempts, errors) {
  for (const [name, fn] of attempts) {
    try {
      const v = await fn();
      if (v) return { ...v, source: name };
    } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  return null;
}

const yahooBase = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export async function fetchMetal(fetchImpl, symbol /* 'XAU' | 'XAG' */, errors = []) {
  const futures = symbol === 'XAU' ? 'GC=F' : 'SI=F';
  return firstOk([
    ['gold-api.com', async () => {
      const j = await getJson(fetchImpl, `https://api.gold-api.com/price/${symbol}`);
      if (!(j.price > 0)) throw new Error('bad payload');
      return { price: Number(j.price), updatedAt: j.updatedAt ? new Date(j.updatedAt).toISOString() : new Date().toISOString() };
    }],
    ['yahoo-futures', async () => {
      const j = await getJson(fetchImpl, `${yahooBase}${encodeURIComponent(futures)}?range=1d&interval=1m`);
      const m = j.chart.result[0].meta;
      if (!(m.regularMarketPrice > 0)) throw new Error('bad payload');
      return { price: Number(m.regularMarketPrice), updatedAt: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString() };
    }],
  ], errors);
}

export async function fetchUsdInr(fetchImpl, errors = []) {
  return firstOk([
    ['open.er-api.com', async () => {
      const j = await getJson(fetchImpl, 'https://open.er-api.com/v6/latest/USD');
      if (!(j.rates?.INR > 0)) throw new Error('bad payload');
      return { price: Number(j.rates.INR), updatedAt: j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString() : new Date().toISOString() };
    }],
    ['frankfurter', async () => {
      const j = await getJson(fetchImpl, 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
      if (!(j.rates?.INR > 0)) throw new Error('bad payload');
      return { price: Number(j.rates.INR), updatedAt: new Date(`${j.date}T00:00:00Z`).toISOString() };
    }],
    ['yahoo-fx', async () => {
      const j = await getJson(fetchImpl, `${yahooBase}INR%3DX?range=1d&interval=1m`);
      const m = j.chart.result[0].meta;
      if (!(m.regularMarketPrice > 0)) throw new Error('bad payload');
      return { price: Number(m.regularMarketPrice), updatedAt: new Date((m.regularMarketTime || Date.now() / 1000) * 1000).toISOString() };
    }],
  ], errors);
}

/** Daily closes from Yahoo Finance: returns Map<'YYYY-MM-DD', close>. */
export async function fetchDailyCloses(fetchImpl, symbol, range = '6mo') {
  const j = await getJson(fetchImpl, `${yahooBase}${encodeURIComponent(symbol)}?range=${range}&interval=1d`, 9000);
  const r = j.chart.result[0];
  const tz = r.meta.exchangeTimezoneName || 'America/New_York';
  const closes = r.indicators.quote[0].close;
  const out = new Map();
  r.timestamp.forEach((t, i) => {
    if (Number.isFinite(closes[i])) out.set(tzParts(new Date(t * 1000), tz).date, closes[i]);
  });
  return out;
}

/** Join gold (or silver) USD/oz series with USDINR into INR-per-gram-24K-equivalent closes (before duty). */
export function joinDailyInr(metal, fx) {
  const fxDates = [...fx.keys()].sort();
  const rows = [];
  for (const d of [...metal.keys()].sort()) {
    let rate = null;
    for (const fd of fxDates) { if (fd <= d) rate = fx.get(fd); else break; }
    if (rate) rows.push({ date: d, usdOz: metal.get(d), usdInr: rate });
  }
  return rows;
}
