// Records price "revisions" during the day (history) and daily open/high/low/close.
import { istDate, tzParts, IST, addDaysIST as addDays, nextTradingDay, istToDate } from './market.mjs';

const pct = (a, b) => Math.abs((a - b) / b) * 100;
const MAX_TICKS = 250;
const MAX_TRACE = 300;           // intraday points for the live graph
const TRACE_GAP_MS = 4.5 * 60 * 1000;
const MAX_DAYS = 120;

export async function ingest({ store, rates, spot, usdInr, market, now = new Date(), cfg }) {
  const date = istDate(now);
  const key = `day:${date}`;
  const day = (await store.get(key)) ?? { date, ticks: [], high: {}, low: {}, updatedAt: 0 };
  day.trace ??= [];
  const g = rates.gold.perGram.k24;
  const s = rates.silver.perGram;
  const tick = { t: now.toISOString(), g24: g, s, xau: spot.xau, xag: spot.xag, fx: usdInr };
  const last = day.ticks.at(-1);
  const th = cfg.revisionThresholdPct;

  let pushed = false;
  if (!last) {
    day.ticks.push(market.globalOpen ? tick : { ...tick, carried: true });
    pushed = true;
  } else if (market.globalOpen && (pct(g, last.g24) >= th.gold || pct(s, last.s) >= th.silver)) {
    day.ticks.push(tick);
    pushed = true;
  }
  if (day.ticks.length > MAX_TICKS) day.ticks.splice(1, day.ticks.length - MAX_TICKS);

  day.high = { g24: Math.max(day.high.g24 ?? g, g), s: Math.max(day.high.s ?? s, s) };
  day.low = { g24: Math.min(day.low.g24 ?? g, g), s: Math.min(day.low.s ?? s, s) };
  day.close = { g24: g, s };

  // Intraday trace for the live graph: one point about every 5 minutes while the market is open.
  const lt = day.trace.at(-1);
  let traced = false;
  if (market.globalOpen && (!lt || now.getTime() - new Date(lt.t).getTime() >= TRACE_GAP_MS)) {
    day.trace.push({ t: now.toISOString(), g24: Math.round(g * 100) / 100, s: Math.round(s * 100) / 100 });
    if (day.trace.length > MAX_TRACE) day.trace.splice(0, day.trace.length - MAX_TRACE);
    traced = true;
  }

  if (pushed || traced || now.getTime() - day.updatedAt > 5 * 60 * 1000) {
    day.updatedAt = now.getTime();
    await store.set(key, day);
    await store.set('latest', tick);

    const dow = tzParts(now, IST).dow;
    if (dow >= 1 && dow <= 5) {
      const daily = (await store.get('daily')) ?? [];
      const row = {
        date, open: { g24: day.ticks[0].g24, s: day.ticks[0].s },
        high: day.high, low: day.low, close: day.close,
      };
      const i = daily.findIndex((r) => r.date === date);
      if (i >= 0) daily[i] = row; else daily.push(row);
      daily.sort((a, b) => a.date.localeCompare(b.date));
      await store.set('daily', daily.slice(-MAX_DAYS));
    }
  }
  return { pushed, ticks: day.ticks.length };
}

export async function readToday({ store, now = new Date() }) {
  const day = (await store.get(`day:${istDate(now)}`)) ?? { date: istDate(now), ticks: [] };
  const rows = day.ticks.map((t, i) => {
    const prev = day.ticks[i - 1];
    return {
      t: t.t, g24: t.g24, s: t.s, carried: !!t.carried, first: i === 0,
      dG: prev ? +(t.g24 - prev.g24).toFixed(2) : null,
      dS: prev ? +(t.s - prev.s).toFixed(2) : null,
    };
  });
  return { date: day.date, high: day.high ?? null, low: day.low ?? null, revisions: rows, trace: day.trace ?? [] };
}

const MORNING_WINDOW_MIN = 120;

/** Saves a fixed "shop rate" once per weekday: first update at/after the slot time (within a 2-hour window). */
async function captureSlot({ store, rates, market, now = new Date(), kind, startMin }) {
  const ist = tzParts(now, IST);
  if (ist.dow < 1 || ist.dow > 5 || !market.globalOpen) return false;
  const mins = ist.h * 60 + ist.mi;
  if (mins < startMin || mins >= startMin + MORNING_WINDOW_MIN) return false;
  const key = `${kind}:${ist.date}`;
  if (await store.get(key)) return false;
  const g = rates.gold.perGram;
  const row = { date: ist.date, t: now.toISOString(), g24: g.k24, g22: g.k22, g18: g.k18, s: rates.silver.perGram };
  await store.set(key, row);
  await store.set(`${kind}:latest`, row);
  return true;
}
export const captureMorning = (a) => captureSlot({ ...a, kind: 'morning', startMin: a.cfg.morningMinutes });
/** The afternoon rate is a revision: only saved if the price moved enough since the morning rate. */
export async function captureEvening(a) {
  const ist = tzParts(a.now ?? new Date(), IST);
  const ref = (await a.store.get(`morning:${ist.date}`)) ?? (await a.store.get('evening:latest')) ?? (await a.store.get('morning:latest'));
  if (!ref) return false;
  const g = a.rates.gold.perGram.k24;
  if (Math.abs((g - ref.g24) / ref.g24) * 100 < a.cfg.eveningRevisionPct) return false;
  return captureSlot({ ...a, kind: 'evening', startMin: a.cfg.eveningMinutes });
}

/** Today's evening rate, if it has been fixed yet. */
export async function readEvening({ store, now = new Date() }) {
  const row = await store.get(`evening:${istDate(now)}`);
  return row ? { ...row, kind: 'today' } : null;
}

/** Returns the morning rate to display: today's, else the closest sensible fallback (labelled via `kind`). */
export async function readMorning({ store, now = new Date(), cfg }) {
  const ist = tzParts(now, IST);
  const weekday = ist.dow >= 1 && ist.dow <= 5;
  const today = await store.get(`morning:${ist.date}`);
  if (today) return { ...today, kind: 'today' };
  const latest = await store.get('morning:latest');
  const beforeMorning = ist.h * 60 + ist.mi < cfg.morningMinutes;
  if (weekday && !beforeMorning) {
    const day = await store.get(`day:${ist.date}`);
    const t = day?.ticks?.[0];
    if (t && !t.carried) return { date: ist.date, t: t.t, g24: t.g24, g22: t.g24 * 22 / 24, g18: t.g24 * 18 / 24, s: t.s, kind: 'first' };
  }
  return latest ? { ...latest, kind: 'previous' } : null;
}

/** Remembers the latest estimate for the next trading day (overwritten every 30 min until that day starts). */
export async function saveForecast({ store, fc, now = new Date() }) {
  if (!fc?.available) return false;
  const key = `forecast:${fc.targetDate}`;
  const ex = await store.get(key);
  if (ex && now.getTime() - ex.madeAt < 30 * 60 * 1000) return false;
  await store.set(key, {
    targetDate: fc.targetDate, madeAt: now.getTime(),
    g24: { morning: fc.gold.morning.expected, evening: fc.gold.evening.expected },
    s: { morning: fc.silver.morning.expected, evening: fc.silver.evening.expected },
  });
  return true;
}

const pctErr = (pred, actual) => ((pred - actual) / actual) * 100;
const avgAbs = (a) => (a.length ? a.reduce((x, y) => x + Math.abs(y), 0) / a.length : null);

/** Compares past estimates with what actually happened. Cached in the store for 10 minutes. */
export async function readAccuracy({ store, now = new Date() }) {
  const cached = await store.get('accuracy');
  if (cached && now.getTime() - cached.at < 10 * 60 * 1000) return cached.value;
  const today = istDate(now);
  const rows = [];
  let d = today;
  for (let i = 0; i < 21 && rows.length < 7; i++, d = addDays(d, -1)) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const fcst = await store.get(`forecast:${d}`);
    const mor = await store.get(`morning:${d}`);
    if (!fcst || !mor) continue;
    const row = { date: d, gMorning: pctErr(fcst.g24.morning, mor.g24), sMorning: pctErr(fcst.s.morning, mor.s) };
    const eve = await store.get(`evening:${d}`);
    if (eve) { row.gEvening = pctErr(fcst.g24.evening, eve.g24); row.sEvening = pctErr(fcst.s.evening, eve.s); }
    rows.push(row);
  }
  const value = rows.length ? {
    days: rows.length,
    goldMorningAbsPct: avgAbs(rows.map((r) => r.gMorning)),
    silverMorningAbsPct: avgAbs(rows.map((r) => r.sMorning)),
    goldEveningAbsPct: avgAbs(rows.filter((r) => r.gEvening != null).map((r) => r.gEvening)),
    silverEveningAbsPct: avgAbs(rows.filter((r) => r.sEvening != null).map((r) => r.sEvening)),
    rows: rows.slice(0, 5),
  } : null;
  await store.set('accuracy', { at: now.getTime(), value });
  return value;
}

/**
 * The shop-style rate: it only changes when a fixed rate is captured (morning and evening).
 * Returns the latest and previous fixed rates, today's updates (each with the rate before it), and the next update time.
 */
export async function readShop({ store, now = new Date(), cfg }) {
  const ist = tzParts(now, IST);
  const entries = [];
  for (let i = 8; i >= 0; i--) {
    const d = addDays(ist.date, -i);
    for (const slot of ['morning', 'evening']) {
      const row = await store.get(`${slot}:${d}`);
      if (row && new Date(row.t) <= now) entries.push({ slot, date: d, t: row.t, g24: row.g24, s: row.s });
    }
  }
  entries.sort((a, b) => a.t.localeCompare(b.t));
  const withPrev = entries.map((e, i) => ({ ...e, prevG24: entries[i - 1]?.g24 ?? null, prevS: entries[i - 1]?.s ?? null }));
  const wd = ist.dow >= 1 && ist.dow <= 5, mins = ist.h * 60 + ist.mi;
  let next;
  if (wd && mins < cfg.morningMinutes) next = { slot: 'morning', at: istToDate(ist.date, cfg.morningMinutes) };
  else if (wd && mins < cfg.eveningMinutes) next = { slot: 'evening', at: istToDate(ist.date, cfg.eveningMinutes) };
  else next = { slot: 'morning', at: istToDate(nextTradingDay(ist.date), cfg.morningMinutes) };
  const phase = !wd || mins < cfg.eveningMinutes ? 'before' : mins < cfg.eveningMinutes + MORNING_WINDOW_MIN ? 'window' : 'closed';
  return {
    eveningPhase: wd ? phase : 'closed',
    latest: withPrev.at(-1) ?? null,
    today: withPrev.filter((e) => e.date === ist.date),
    next: { slot: next.slot, at: next.at.toISOString() },
  };
}
