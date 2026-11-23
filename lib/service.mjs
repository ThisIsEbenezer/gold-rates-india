import { getConfig } from './config.mjs';
import { marketSnapshot, istDate, tzParts, NY, nextTradingDay, addDaysIST, dowOfDateStr, formatIST } from './market.mjs';
import { fetchMetal, fetchUsdInr, fetchDailyCloses, joinDailyInr } from './providers.mjs';
import { buildRates, applyGst, change, inrPerGram } from './pricing.mjs';
import { forecast } from './predict.mjs';
import { ingest } from './tracker.mjs';

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

function buildForecast(rows, live, market, now, today) {
  const etToday = tzParts(now, NY).date;
  const base = market.globalOpen ? rows.filter((r) => r.date < etToday) : rows;
  const tomorrow = addDaysIST(today, 1);
  const tomorrowTrades = ![0, 6].includes(dowOfDateStr(tomorrow));
  const target = nextTradingDay(today);
  const mk = (key, liveVal) => {
    const f = forecast(base.map((r) => r[key]));
    if (!f) return null;
    const k = liveVal / f.last; // anchor to the live price
    return { expected: f.expected * k, low: f.low * k, high: f.high * k, probUp: f.probUp, trend: f.trend, muPct: f.muPct, sigmaPct: f.sigmaPct, sample: f.sample };
  };
  const gold = mk('g24', live.gold.perGram.k24);
  const silver = mk('s', live.silver.perGram);
  return {
    tomorrow, tomorrowIsTradingDay: tomorrowTrades,
    targetDate: target,
    gold, silver,
    available: !!(gold && silver),
    method: 'EWMA volatility with heavily shrunk 5/20-day momentum on daily closes. Statistical estimate, not advice.',
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
  const fc = rows.length >= 8 ? buildForecast(rows, rates, market, now, today) : { available: false, targetDate: nextTradingDay(today), tomorrow: addDaysIST(today, 1), tomorrowIsTradingDay: ![0, 6].includes(dowOfDateStr(addDaysIST(today, 1))) };

  if (record && store && !stale) {
    try { await ingest({ store, rates, spot, usdInr, market, now, cfg }); } catch (e) { errors.push(`record: ${e.message}`); }
  }

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
    forecast: fc,
    errors,
  };
}
