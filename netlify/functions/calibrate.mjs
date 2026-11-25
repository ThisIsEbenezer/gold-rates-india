import { createStore } from '../../lib/store.mjs';
import { getConfig } from '../../lib/config.mjs';
import { fetchMetal, fetchUsdInr } from '../../lib/providers.mjs';
import { readCalibration, saveCalibration } from '../../lib/calibrate.mjs';

const json = (o, status = 200) => Response.json(o, { status, headers: { 'cache-control': 'no-store' } });
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export default async (req) => {
  const store = await createStore();
  if (req.method === 'GET') return json({ calibration: await readCalibration(store) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const pin = process.env.CALIBRATE_PIN;
  if (!pin) return json({ error: 'Set the CALIBRATE_PIN environment variable in Netlify first.' }, 503);
  let body; try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }
  if (!same(String(body.pin ?? ''), pin)) return json({ error: 'Wrong PIN.' }, 401);
  const g24 = Number(body.g24) || 0, s = Number(body.s) || 0;
  if (!(g24 > 0) && !(s > 0)) return json({ error: 'Enter the shop 24K gold price or the silver price per gram.' }, 400);
  const errors = [];
  const [xau, xag, fx] = await Promise.all([fetchMetal(fetch, 'XAU', errors), fetchMetal(fetch, 'XAG', errors), fetchUsdInr(fetch, errors)]);
  if (!xau || !xag || !fx) return json({ error: 'Live prices unavailable right now. Try again in a minute.' }, 502);
  try {
    const rec = await saveCalibration({ store, spot: { xau: xau.price, xag: xag.price }, usdInr: fx.price, cfg: getConfig(), shop: { g24, s } });
    return json({ ok: true, calibration: rec });
  } catch (e) { return json({ error: e.message }, 400); }
};
export const config = { path: '/api/calibrate' };
