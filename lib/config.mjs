// Central configuration. Change duty via env var when the Government revises it.
const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const OZ_GRAMS = 31.1034768; // grams per troy ounce

function parseMinutes(v, d) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : d;
}

export function getConfig(env = (typeof process !== 'undefined' ? process.env : {})) {
  return {
    // Effective customs duty (10% BCD + 5% AIDC) on gold & silver imports, in force since 13 May 2026.
    importDutyPct: num(env.IMPORT_DUTY_PCT, 15),
    gstPct: 3,
    premiumPct: num(env.LOCAL_PREMIUM_PCT, 2.1),
    // Silver's retail premium differs from gold's. Falls back to the gold premium if not set.
    silverPremiumPct: num(env.SILVER_PREMIUM_PCT, 17),
    // A price "revision" is logged when the 24K gold / silver price moves by at least this much.
    // Morning rate is captured once per weekday, at the first update on/after this IST time (within a 2-hour window).
    morningMinutes: parseMinutes(env.MORNING_RATE_TIME, 9 * 60 + 45),
    // MJDTA says it publishes at 9:30 AM and 3:30 PM; in practice the morning rate shows up around 9:45-9:56 AM.
    // The afternoon rate is a revision: it only changes on volatile days (see eveningRevisionPct).
    eveningMinutes: parseMinutes(env.EVENING_RATE_TIME, 15 * 60 + 30),
    // The evening slot is only recorded when the price has moved at least this much since the morning rate.
    eveningRevisionPct: num(env.EVENING_REVISION_PCT, 1),
    revisionThresholdPct: { gold: 0.1, silver: 0.2 },
  };
}
