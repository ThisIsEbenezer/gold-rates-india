import { timingSafeEqual } from 'node:crypto';
import { createStore } from '../../lib/store.mjs';
import { getSnapshot } from '../../lib/service.mjs';
import { getConfig } from '../../lib/config.mjs';
import { readCalibration, premiumFor, saveCalibration } from '../../lib/calibration.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export default async (req) => {
  const store = await createStore();
  if (req.method === 'GET') return json({ calibration: await readCalibration(store) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const pin = process.env.CALIBRATE_PIN;
  if (!pin) return json({ error: 'Set the CALIBRATE_PIN environment variable in Netlify first.' }, 503);
  let b; try { b = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!same(b.pin ?? '', pin)) return json({ error: 'Wrong PIN' }, 401);
  const gold24 = Number(b.gold24), silver = b.silver ? Number(b.silver) : null;
  if (!(gold24 > 1000 && gold24 < 100000) || (silver !== null && !(silver > 10 && silver < 2000))) return json({ error: 'Enter 24K gold per gram and silver per gram in rupees.' }, 400);
  const cfg = getConfig();
  const snap = await getSnapshot({ store, cfg, record: false, useCalibration: false });
  if (snap.stale) return json({ error: 'Live prices are unavailable right now. Try again in a minute.' }, 502);
  const goldPct = premiumFor(gold24, snap.spot.xau, snap.spot.usdInr, cfg);
  const silverPct = silver ? premiumFor(silver, snap.spot.xag, snap.spot.usdInr, cfg) : null;
  if (goldPct < -10 || goldPct > 15) return json({ error: `That rate implies a ${goldPct}% premium, which looks wrong. Check the number.` }, 400);
  const rec = await saveCalibration(store, { goldPct, silverPct, gold24, silver });
  return json({ ok: true, calibration: rec });
};
export const config = { path: '/api/calibrate' };
