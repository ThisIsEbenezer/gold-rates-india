import { OZ_GRAMS } from './config.mjs';

/** USD per troy ounce -> INR per gram of 24K (99.9%) metal, including import duty and optional dealer premium. */
export function inrPerGram(usdPerOz, usdInr, cfg) {
  return (usdPerOz / OZ_GRAMS) * usdInr * (1 + cfg.importDutyPct / 100) * (1 + cfg.premiumPct / 100);
}

const r2 = (n) => Math.round(n * 100) / 100;

export function buildRates({ xau, xag, usdInr }, cfg) {
  const g24 = inrPerGram(xau, usdInr, cfg);
  const s = inrPerGram(xag, usdInr, cfg);
  return {
    gold: { perGram: { k24: r2(g24), k22: r2((g24 * 22) / 24), k18: r2((g24 * 18) / 24) } },
    silver: { perGram: r2(s), perKg: r2(s * 1000) },
  };
}

export function applyGst(rates, gstPct) {
  const m = 1 + gstPct / 100;
  return {
    gold: { perGram: Object.fromEntries(Object.entries(rates.gold.perGram).map(([k, v]) => [k, r2(v * m)])) },
    silver: { perGram: r2(rates.silver.perGram * m), perKg: r2(rates.silver.perKg * m) },
  };
}

export function change(now, prev) {
  if (!prev || !Number.isFinite(prev) || prev === 0) return null;
  return { abs: r2(now - prev), pct: r2(((now - prev) / prev) * 100) };
}
