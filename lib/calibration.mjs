import { inrPerGram } from './pricing.mjs';

const KEY = 'calibration';

export async function readCalibration(store) {
  try { return store ? await store.get(KEY) : null; } catch { return null; }
}

/** Overlay a saved calibration on the env config. */
export function withCalibration(cfg, calib) {
  if (!calib || !Number.isFinite(calib.goldPct)) return cfg;
  return {
    ...cfg,
    premiumPct: calib.goldPct,
    silverPremiumPct: Number.isFinite(calib.silverPct) ? calib.silverPct : cfg.silverPremiumPct,
    calibratedAt: calib.at,
  };
}

/** Premium (%) that makes the formula hit a shop rate, given live spot. */
export function premiumFor(shopPerGram, usdPerOz, usdInr, cfg) {
  const base = inrPerGram(usdPerOz, usdInr, cfg, 0);
  return Math.round(((shopPerGram / base - 1) * 100) * 1000) / 1000;
}

export async function saveCalibration(store, { goldPct, silverPct, gold24, silver, now = new Date() }) {
  const rec = { goldPct, silverPct: silverPct ?? null, gold24, silver: silver ?? null, at: now.toISOString() };
  await store.set(KEY, rec);
  return rec;
}
