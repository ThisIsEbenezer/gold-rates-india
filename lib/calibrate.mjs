import { inrPerGram } from './pricing.mjs';

const KEY = 'premium';

/** Premium (%) that makes the formula hit a shop price at the current spot. */
export function impliedPremiumPct(usdPerOz, usdInr, cfg, shopPerGram) {
  const base = inrPerGram(usdPerOz, usdInr, cfg, 0);
  return Math.round((shopPerGram / base - 1) * 100 * 100) / 100;
}

export async function readCalibration(store) {
  try { return store ? await store.get(KEY) : null; } catch { return null; }
}

/** Returns cfg with premiums taken from the latest saved calibration, if any. */
export async function withCalibration(cfg, store) {
  const c = await readCalibration(store);
  if (!c) return cfg;
  return {
    ...cfg,
    premiumPct: Number.isFinite(c.goldPct) ? c.goldPct : cfg.premiumPct,
    silverPremiumPct: Number.isFinite(c.silverPct) ? c.silverPct : cfg.silverPremiumPct,
    calibratedAt: c.t,
  };
}

export async function saveCalibration({ store, spot, usdInr, cfg, shop, now = new Date() }) {
  const prev = (await readCalibration(store)) ?? {};
  const rec = { ...prev, t: now.toISOString(), shop };
  if (shop.g24 > 0) rec.goldPct = impliedPremiumPct(spot.xau, usdInr, cfg, shop.g24);
  if (shop.s > 0) rec.silverPct = impliedPremiumPct(spot.xag, usdInr, cfg, shop.s);
  for (const k of ['goldPct', 'silverPct']) if (rec[k] != null && (rec[k] < -10 || rec[k] > 60)) throw new Error(`Calibrated premium ${rec[k]}% looks wrong. Check the numbers you entered.`);
  await store.set(KEY, rec);
  return rec;
}
