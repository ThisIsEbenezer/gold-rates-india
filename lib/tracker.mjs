// Records price "revisions" during the day (history) and daily open/high/low/close.
import { istDate, tzParts, IST } from './market.mjs';

const pct = (a, b) => Math.abs((a - b) / b) * 100;
const MAX_TICKS = 250;
const MAX_DAYS = 120;

export async function ingest({ store, rates, spot, usdInr, market, now = new Date(), cfg }) {
  const date = istDate(now);
  const key = `day:${date}`;
  const day = (await store.get(key)) ?? { date, ticks: [], high: {}, low: {}, updatedAt: 0 };
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

  if (pushed || now.getTime() - day.updatedAt > 5 * 60 * 1000) {
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
  return { date: day.date, high: day.high ?? null, low: day.low ?? null, revisions: rows };
}
