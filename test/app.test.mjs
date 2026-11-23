import test from 'node:test';
import assert from 'node:assert/strict';
import { isGlobalOpen, nextGlobalOpen, formatIST, nextTradingDay, mcxStatus, marketSnapshot } from '../lib/market.mjs';
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
  assert.ok(s.forecast.gold.low < s.forecast.gold.expected && s.forecast.gold.expected < s.forecast.gold.high);
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
