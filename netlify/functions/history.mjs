import { createStore } from '../../lib/store.mjs';
import { getConfig } from '../../lib/config.mjs';
import { getDailySeries } from '../../lib/service.mjs';
import { readToday } from '../../lib/tracker.mjs';
import { tzParts, IST } from '../../lib/market.mjs';

export default async () => {
  try {
    const store = await createStore();
    const today = await readToday({ store });
    const stored = (await store.get('daily')) ?? [];
    const seed = await getDailySeries(fetch, getConfig());
    const byDate = new Map();
    for (const r of seed) {
      const dow = tzParts(new Date(`${r.date}T12:00:00Z`), IST).dow;
      if (dow >= 1 && dow <= 5) byDate.set(r.date, { date: r.date, g24: r.g24, s: r.s, source: 'market-data' });
    }
    for (const r of stored) byDate.set(r.date, { date: r.date, g24: r.close.g24, s: r.close.s, high: r.high, low: r.low, source: 'recorded' });
    const daily = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
    return Response.json({ today, daily }, { headers: { 'cache-control': 'public, max-age=30', 'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=120' } });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
};
export const config = { path: '/api/history' };
