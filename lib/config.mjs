// Central configuration. Change duty via env var when the Government revises it.
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const OZ_GRAMS = 31.1034768; // grams per troy ounce

export function getConfig(env = (typeof process !== 'undefined' ? process.env : {})) {
  return {
    // Effective customs duty (10% BCD + 5% AIDC) on gold & silver imports, in force since 13 May 2026.
    importDutyPct: num(env.IMPORT_DUTY_PCT, 15),
    gstPct: 3,
    premiumPct: num(env.LOCAL_PREMIUM_PCT, 0),
    // Silver's retail premium differs from gold's. Falls back to the gold premium if not set.
    silverPremiumPct: num(env.SILVER_PREMIUM_PCT, num(env.LOCAL_PREMIUM_PCT, 0)),
    // A price "revision" is logged when the 24K gold / silver price moves by at least this much.
    revisionThresholdPct: { gold: 0.15, silver: 0.3 },
  };
}
