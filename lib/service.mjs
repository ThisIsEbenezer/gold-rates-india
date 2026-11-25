import { getConfig } from './config.mjs';
import { marketSnapshot, istDate, tzParts, NY, nextTradingDay, addDaysIST, dowOfDateStr, formatIST, istToDate, openHoursBetween } from './market.mjs';
import { fetchMetal, fetchUsdInr, fetchDailyCloses, joinDailyInr } from './providers.mjs';
import { buildRates, applyGst, change, inrPerGram } from './pricing.mjs';
import { forecast } from './predict.mjs';
import { ingest, captureMorning, readMorning, saveForecast, readAccuracy } from './tracker.mjs';

let dailyCache = { at: 0, value: null };
const DAILY_TTL = 30 * 60 * 1000;

/** Daily history rows (oldest -> newest): { date, g24, s } in INR per gram, using the *current* duty. */
export async function getDailySeries(fetchImpl, cfg, now = new Date(), force = false) {
  if (!force && dailyCache.value && now.getTime() - dailyCache.at < DAILY_TTL) return dailyCache.value;
  try {
    const [gold, silver, fx] = await Promise.all([
      fetchDailyCloses(fetchImpl, 'GC=F'), fetchDailyCloses(fetchImpl, 'SI=F'), fetchDailyCloses(fetchImpl, 'INR=X'),
    ]);
    const G = joinDailyInr(gold, fx);
    const S = new Map(joinDailyInr(silver, fx).map((r) => [r.date, r]));
    const rows = G.filter((r) => S.has(r.date)).map((r) => ({
      date: r.date,
      g24: inrPerGram(r.usdOz, r.usdInr, cfg),
      s: inrPerGram(S.get(r.date).usdOz, S.get(r.date).usdInr, cfg, cfg.silverPremiumPct ?? cfg.premiumPct),
    }));
    dailyCache = { at: now.getTime(), value: rows };
    return rows;
  } catch (e) {
    return dailyCache.value ?? [];
  }
}

const OPEN_HOURS_PER_DAY = 23;
const EVENING_MINUTES = 23 * 60 + 30; // 11:30 PM IST, near the Indian commodity-market close

/** Projects the live price to a future instant using volatility scaled by market-open time. */
function project(live, f, w) {
  const mu = (f.muPct / 100) * w, sig = (f.sigmaPct / 100) * Math.sqrt(w);
  return { expected: live * Math.exp(mu), low: live * Math.exp(mu - sig), high: live * Math.exp(mu + sig) };
}

function buildForecast(rows, live, market, now, today, cfg) {
  const etToday = tzParts(now, NY).date;
  const base = market.globalOpen ? rows.filter((r) => r.date < etToday) : rows;
  const tomorrow = addDaysIST(today, 1);
  const tomorrowTrades = ![0, 6].includes(dowOfDateStr(tomorrow));
  const target = nextTradingDay(today);
  const morningAt = istToDate(target, cfg.morningMinutes), eveningAt = istToDate(target, EVENING_MINUTES);
  const weight = (at) => {
    let w = openHoursBetween(now, at) / OPEN_HOURS_PER_DAY;
    if (!market.globalOpen) w = Math.max(w, 0.25);  // reopening after a break/weekend can gap
    return Math.max(0.05, w);
  };
  const wM = weight(morningAt), wE = weight(eveningAt);
  const mk = (key, liveVal) => {
    const f = forecast(base.map((r) => r[key]));
    if (!f) return null;
    return { morning: project(liveVal, f, wM), evening: project(liveVal, f, wE), probUp: f.probUp, trend: f.trend, muPct: f.muPct, sigmaPct: f.sigmaPct, sample: f.sample };
  };
  const gold = mk('g24', live.gold.perGram.k24);
  const silver = mk('s', live.silver.perGram);
  return {
    tomorrow, tomorrowIsTradingDay: tomorrowTrades, targetDate: target,
    morningAt: morningAt.toISOString(), eveningAt: eveningAt.toISOString(),
    gold, silver, available: !!(gold && silver),
    method: 'Live price projected forward using recent daily volatility and heavily shrunk momentum. Statistical estimate, not advice.',
  };
}

export async function getSnapshot({ fetchImpl = fetch, store, now = new Date(), cfg = getConfig(), record = true } = {}) {
  const errors = [];
  const [xau, xag, fx] = await Promise.all([
    fetchMetal(fetchImpl, 'XAU', errors), fetchMetal(fetchImpl, 'XAG', errors), fetchUsdInr(fetchImpl, errors),
  ]);
  const market = marketSnapshot(now);
  const today = market.today;
  const warnings = [];

  let spot, usdInr, stale = false;
  if (xau && xag && fx) {
    spot = { xau: xau.price, xag: xag.price }; usdInr = fx.price;
  } else {
    const latest = store ? await store.get('latest') : null;
    if (!latest) { const err = new Error('Live price sources unavailable'); err.details = errors; throw err; }
    spot = { xau: latest.xau, xag: latest.xag }; usdInr = latest.fx; stale = true;
    warnings.push(`Live sources unreachable; showing last saved rate from ${formatIST(new Date(latest.t))}.`);
  }
  const rates = buildRates({ ...spot, usdInr }, cfg);
  const withGst = applyGst(rates, cfg.gstPct);

  const updatedAt = stale ? null : [xau.updatedAt, xag.updatedAt].sort()[0];
  if (!stale && market.globalOpen && updatedAt && now - new Date(updatedAt) > 30 * 60 * 1000)
    warnings.push('Price feed looks delayed by more than 30 minutes.');

  const rows = await getDailySeries(fetchImpl, cfg, now);
  const etToday = tzParts(now, NY).date;
  let ref = null;
  if (rows.length >= 2) ref = market.globalOpen ? rows.filter((r) => r.date < etToday).at(-1) : rows.at(-2);
  const fc = rows.length >= 8 ? buildForecast(rows, rates, market, now, today, cfg) : { available: false, targetDate: nextTradingDay(today), tomorrow: addDaysIST(today, 1), tomorrowIsTradingDay: ![0, 6].includes(dowOfDateStr(addDaysIST(today, 1))) };

  if (record && store && !stale) {
    try { await ingest({ store, rates, spot, usdInr, market, now, cfg }); } catch (e) { errors.push(`record: ${e.message}`); }
    try { await captureMorning({ store, rates, market, now, cfg }); } catch (e) { errors.push(`morning: ${e.message}`); }
    try { await saveForecast({ store, fc, now }); } catch (e) { errors.push(`forecast-save: ${e.message}`); }
  }
  let accuracy = null;
  try { if (store) accuracy = await readAccuracy({ store, now }); } catch (e) { errors.push(`accuracy: ${e.message}`); }
  let morning = null;
  try { if (store) morning = await readMorning({ store, now, cfg }); } catch (e) { errors.push(`morning-read: ${e.message}`); }

  return {
    asOf: now.toISOString(),
    asOfIST: formatIST(now),
    stale, warnings,
    market,
    spot: { ...spot, usdInr, updatedAt, sources: stale ? [] : [xau.source, xag.source, fx.source] },
    config: { importDutyPct: cfg.importDutyPct, gstPct: cfg.gstPct, premiumPct: cfg.premiumPct, silverPremiumPct: cfg.silverPremiumPct },
    rates, ratesWithGst: withGst,
    reference: ref ? {
      date: ref.date, g24: ref.g24, s: ref.s,
      gold: change(rates.gold.perGram.k24, ref.g24), silver: change(rates.silver.perGram, ref.s),
      label: market.globalOpen ? 'vs previous close' : 'last session’s move',
    } : null,
    morning,
    accuracy,
    forecast: fc,
    errors,
  };
}
