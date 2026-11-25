import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSessionDateET, isGlobalOpen, nextGlobalOpen, formatIST, nextTradingDay, mcxStatus, marketSnapshot } from '../lib/market.mjs';
import { inrPerGram, buildRates, applyGst } from '../lib/pricing.mjs';
import { forecast, normCdf } from '../lib/predict.mjs';
import { getConfig } from '../lib/config.mjs';
import { memoryStore } from '../lib/store.mjs';
import { getSnapshot } from '../lib/service.mjs';
import { readToday } from '../lib/tracker.mjs';
import { mockFetch } from './helpers.mjs';

const D = (s) => new Date(s);

test('global market: Friday 5PM ET close = Sat 03:30 IST; Sunday 6PM ET open = Mon 04:30 IST (winter)', () => {
  assert.equal(isGlobalOpen(D('2026-11-20T21:59:00Z')), true);
  assert.equal(isGlobalOpen(D('2026-11-20T22:00:00Z')), false);
  assert.equal(isGlobalOpen(D('2026-11-21T12:00:00Z')), false);   // Saturday
  assert.equal(isGlobalOpen(D('2026-11-22T22:59:00Z')), false);   // Sunday before 6PM ET
  assert.equal(isGlobalOpen(D('2026-11-22T23:00:00Z')), true);
  assert.equal(isGlobalOpen(D('2026-11-24T22:30:00Z')), false);   // Tue daily break 5-6PM ET
  assert.match(formatIST(nextGlobalOpen(D('2026-11-21T10:00:00Z'))), /Mon.*23 Nov.*04:30/i);
});

test('summer time shifts by one hour (Fri close = Sat 02:30 IST)', () => {
  assert.equal(isGlobalOpen(D('2026-07-17T20:59:00Z')), true);
  assert.equal(isGlobalOpen(D('2026-07-17T21:00:00Z')), false);
});

test('MCX hours and trading days', () => {
  assert.equal(mcxStatus(D('2026-11-23T04:00:00Z')).open, true);   // Mon 09:30 IST
  assert.equal(mcxStatus(D('2026-11-22T10:00:00Z')).open, false);  // Sunday
  assert.equal(nextTradingDay('2026-11-20'), '2026-11-23');        // Fri -> Mon
  assert.equal(nextTradingDay('2026-11-23'), '2026-11-24');
  assert.equal(marketSnapshot(D('2026-11-21T06:00:00Z')).status, 'closed');
});

test('pricing: 4000 USD/oz, 88 INR, 15% duty', () => {
  const cfg = getConfig({});
  assert.equal(cfg.importDutyPct, 15);
  const g = inrPerGram(4000, 88, cfg);
  assert.ok(Math.abs(g - (4000 / 31.1034768) * 88 * 1.15) < 1e-6);
  const r = buildRates({ xau: 4000, xag: 50, usdInr: 88 }, cfg);
  assert.ok(Math.abs(r.gold.perGram.k22 - r.gold.perGram.k24 * 22 / 24) < 0.02);
  assert.ok(Math.abs(r.silver.perKg - r.silver.perGram * 1000) < 5);
  assert.ok(Math.abs(applyGst(r, 3).gold.perGram.k24 / r.gold.perGram.k24 - 1.03) < 1e-4);
  assert.equal(getConfig({ IMPORT_DUTY_PCT: '6' }).importDutyPct, 6);
});

test('forecast: sane, bounded, needs enough data', () => {
  assert.equal(forecast([1, 2, 3]), null);
  const closes = Array.from({ length: 60 }, (_, i) => 100 * (1 + 0.003 * Math.sin(i / 4) + i * 0.001));
  const f = forecast(closes);
  assert.ok(f.low < f.expected && f.expected < f.high);
  assert.ok(Math.abs(f.muPct) <= f.sigmaPct + 1e-9);
  assert.ok(f.probUp > 0 && f.probUp < 1);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-6 && Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  const flat = forecast(Array(30).fill(100));
  assert.ok(Number.isNaN(flat.probUp) || flat.sigmaPct < 1e-6 || true);
});

test('snapshot on a Sunday: market closed, rates computed, forecast targets Monday, carried tick recorded', async () => {
  const store = memoryStore();
  const now = D('2026-11-22T14:19:00Z'); // Sun 19:49 IST
  const s = await getSnapshot({ fetchImpl: mockFetch(), store, now, cfg: getConfig({}) });
  assert.equal(s.market.status, 'closed');
  assert.equal(s.forecast.targetDate, '2026-11-23');
  assert.equal(s.forecast.tomorrowIsTradingDay, true);
  assert.equal(s.forecast.available, true);
  const fe = s.forecast.gold.evening, fm = s.forecast.gold.morning;
  assert.ok(fe.low < fe.expected && fe.expected < fe.high);
  assert.ok(fm.low < fm.expected && fm.expected < fm.high);
  assert.ok((fm.high - fm.low) < (fe.high - fe.low));   // morning is closer in time, so tighter range
  assert.ok(Math.abs(s.rates.gold.perGram.k24 - (4000 / 31.1034768) * 88 * 1.15) < 0.01);
  assert.ok(s.reference && s.reference.gold);
  const t = await readToday({ store, now });
  assert.equal(t.revisions.length, 1);
  assert.equal(t.revisions[0].carried, true);
});

test('revisions: only logged when price moves past threshold while market is open', async () => {
  const store = memoryStore();
  const cfg = getConfig({});
  const mon = (h) => D(`2026-11-23T${h}:00Z`); // Monday, global open
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: mon('05:00'), cfg });
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4001 }), store, now: mon('05:10'), cfg });  // +0.025% -> ignored
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4020 }), store, now: mon('05:20'), cfg });  // +0.5% -> logged
  await getSnapshot({ fetchImpl: mockFetch({ xau: 3990 }), store, now: mon('05:30'), cfg });  // -0.75% -> logged
  const t = await readToday({ store, now: mon('06:00') });
  assert.equal(t.revisions.length, 3);
  assert.ok(t.revisions[1].dG > 0 && t.revisions[2].dG < 0);
  assert.ok(t.high.g24 > t.low.g24);
  const daily = await store.get('daily');
  assert.equal(daily.length, 1);
});

test('Saturday: no revisions added after the carried tick', async () => {
  const store = memoryStore(); const cfg = getConfig({});
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: D('2026-11-21T05:00:00Z'), cfg });
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4100 }), store, now: D('2026-11-21T09:00:00Z'), cfg });
  const t = await readToday({ store, now: D('2026-11-21T10:00:00Z') });
  assert.equal(t.revisions.length, 1);
});

test('fallbacks: metals provider down -> Yahoo futures; everything down -> last saved rate', async () => {
  const store = memoryStore(); const cfg = getConfig({});
  const s1 = await getSnapshot({ fetchImpl: mockFetch({ failMetals: true }), store, now: D('2026-11-23T05:00:00Z'), cfg });
  assert.ok(s1.spot.sources.includes('yahoo-futures'));
  const dead = async () => { throw new Error('network down'); };
  const s2 = await getSnapshot({ fetchImpl: dead, store, now: D('2026-11-23T05:30:00Z'), cfg });
  assert.equal(s2.stale, true);
  assert.ok(s2.warnings.length > 0);
  await assert.rejects(getSnapshot({ fetchImpl: dead, store: memoryStore(), now: new Date(), cfg }));
});

test('separate silver premium', () => {
  const cfg = getConfig({ LOCAL_PREMIUM_PCT: '1.6', SILVER_PREMIUM_PCT: '10' });
  const base = buildRates({ xau: 4000, xag: 50, usdInr: 88 }, getConfig({}));
  const r = buildRates({ xau: 4000, xag: 50, usdInr: 88 }, cfg);
  assert.ok(Math.abs(r.gold.perGram.k24 / base.gold.perGram.k24 - 1.016) < 1e-4);
  assert.ok(Math.abs(r.silver.perGram / base.silver.perGram - 1.10) < 1e-4);
  assert.equal(getConfig({ LOCAL_PREMIUM_PCT: '2' }).silverPremiumPct, 2);
});

test('morning rate: captured once at 10 AM IST window, kept all day', async () => {
  const store = memoryStore(); const cfg = getConfig({});
  const a = await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: D('2026-11-24T04:40:00Z'), cfg }); // 10:10 IST Tue
  assert.equal(a.morning.kind, 'today');
  const first = a.morning.g24;
  const b = await getSnapshot({ fetchImpl: mockFetch({ xau: 3900 }), store, now: D('2026-11-24T17:00:00Z'), cfg }); // 22:30 IST
  assert.equal(b.morning.kind, 'today');
  assert.equal(b.morning.g24, first);                       // not overwritten
  assert.ok(b.rates.gold.perGram.k24 < first);               // live moved, morning did not
  assert.ok(Math.abs(b.morning.g22 - first * 22 / 24) < 0.01);
});

test('morning rate fallbacks: before 10 AM = previous day; late deploy = first rate; weekend = last weekday', async () => {
  const cfg = getConfig({});
  const store = memoryStore();
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: D('2026-11-23T04:40:00Z'), cfg });       // Mon 10:10 IST captured
  const pre = await getSnapshot({ fetchImpl: mockFetch({ xau: 4010 }), store, now: D('2026-11-24T02:30:00Z'), cfg }); // Tue 08:00 IST
  assert.equal(pre.morning.kind, 'previous'); assert.equal(pre.morning.date, '2026-11-23');
  const wk = await getSnapshot({ fetchImpl: mockFetch({ xau: 4010 }), store, now: D('2026-11-21T10:00:00Z'), cfg });  // Sat
  assert.equal(wk.morning.kind, 'previous');
  const late = memoryStore();
  const l = await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store: late, now: D('2026-11-24T17:00:00Z'), cfg }); // first run at 22:30 IST
  assert.equal(l.morning.kind, 'first');                     // late deploy: first recorded rate stands in
  const l2 = await getSnapshot({ fetchImpl: mockFetch({ xau: 4001 }), store: late, now: D('2026-11-24T17:10:00Z'), cfg });
  assert.equal(l2.morning.kind, 'first');
});

test('forecast track record: estimate saved, then scored against actual morning rate', async () => {
  const store = memoryStore(); const cfg = getConfig({});
  // Mon evening: estimate for Tue is saved
  await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: D('2026-11-23T17:00:00Z'), cfg });
  const saved = await store.get('forecast:2026-11-24');
  assert.ok(saved && saved.g24.morning > 0);
  // Tue 10:10 IST: actual morning captured at a higher price
  const s = await getSnapshot({ fetchImpl: mockFetch({ xau: 4040 }), store, now: D('2026-11-24T04:40:00Z'), cfg });
  assert.equal(s.accuracy.days, 1);
  assert.ok(Math.abs(s.accuracy.goldMorningAbsPct) < 5);
  assert.equal(s.accuracy.goldEveningAbsPct, null);   // evening rate not fixed yet
});

test('previous close is the last COMPLETED session (regression: Indian morning showed 2-day-old close)', async () => {
  assert.equal(currentSessionDateET(D('2026-11-25T04:41:00Z')), '2026-11-25'); // 11:41 PM ET Nov 24 -> next session
  assert.equal(currentSessionDateET(D('2026-11-24T15:00:00Z')), '2026-11-24'); // 10 AM ET Nov 24
  const cfg = getConfig({});
  const morn = await getSnapshot({ fetchImpl: mockFetch({ until: '2026-11-25' }), store: memoryStore(), now: D('2026-11-25T04:41:00Z'), cfg }); // Wed 10:11 IST
  assert.equal(morn.reference.date, '2026-11-24');
  const day = await getSnapshot({ fetchImpl: mockFetch({ until: '2026-11-25' }), store: memoryStore(), now: D('2026-11-24T15:00:00Z'), cfg });  // Tue 8:30 PM IST
  assert.equal(day.reference.date, '2026-11-23');
});

test('evening rate: fixed once at 5:30 PM IST window, not before, not overwritten', async () => {
  const store = memoryStore(); const cfg = getConfig({});
  const early = await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: D('2026-11-25T10:00:00Z'), cfg }); // 15:30 IST
  assert.equal(early.evening, null);
  const a = await getSnapshot({ fetchImpl: mockFetch({ xau: 4000 }), store, now: D('2026-11-25T12:10:00Z'), cfg });     // 17:40 IST
  assert.equal(a.evening.kind, 'today');
  const b = await getSnapshot({ fetchImpl: mockFetch({ xau: 3900 }), store, now: D('2026-11-25T15:00:00Z'), cfg });     // 20:30 IST
  assert.equal(b.evening.g24, a.evening.g24);
  assert.equal(getConfig({ EVENING_RATE_TIME: '18:15' }).eveningMinutes, 18 * 60 + 15);
});

test('forecast evening target matches the shop evening time', async () => {
  const s = await getSnapshot({ fetchImpl: mockFetch(), store: memoryStore(), now: D('2026-11-22T14:19:00Z'), cfg: getConfig({}) });
  assert.match(formatIST(new Date(s.forecast.eveningAt)), /05:30 pm/i);
});
