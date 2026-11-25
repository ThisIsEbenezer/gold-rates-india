# Sam’s Gold Prediction – Gold & Silver Rates (India, IST)

Static site + Netlify Functions. No build step, no API keys.

## What it shows
- Live gold (24K/22K/18K) and silver rates in ₹, trade units (10 g / 1 kg) or per gram, optional 3% GST.
- Next-day estimate with a likely range (statistical, not advice). If tomorrow is Sat/Sun it says rates stay at Friday's close and estimates Monday.
- Today's price-change log (a row is added when gold moves ≥0.15% or silver ≥0.3%), plus open/high/low/close per day and a 30-day chart.
- Everything in Indian Standard Time.

## Morning rate, estimates and track record
- **Morning rate:** captured once each weekday at the first update on/after 10:00 AM IST (change with `MORNING_RATE_TIME`, e.g. `10:30`) and held all day, like Indian rate sites do. Shown next to the live rate.
- **Tomorrow’s estimate:** projects the live price to tomorrow’s morning and end of day using recent volatility. It also stores each estimate and later compares it with the real morning rate, shown as a track record.

## How the rate is computed
`USD/oz spot ÷ 31.1035 × USD/INR × (1 + import duty) [× (1 + premium)]`
Import duty is **15%** (10% BCD + 5% AIDC, in force since 13 May 2026). When the Government changes it, set `IMPORT_DUTY_PCT` in Netlify (Site settings → Environment variables) – no redeploy of code needed. `LOCAL_PREMIUM_PCT` (default 0) lets you calibrate against your local jeweller/IBJA rate.

## Data sources (free, keyless, with fallbacks)
| Data | Primary | Fallbacks |
|---|---|---|
| Gold/silver USD/oz | api.gold-api.com | Yahoo Finance futures (GC=F, SI=F) |
| USD/INR | open.er-api.com | api.frankfurter.dev, Yahoo (INR=X) |
| Daily history (for estimate & chart seed) | Yahoo Finance daily chart | your own recorded history |
If all live sources fail, the last saved rate is shown with a warning.
To swap providers, edit `lib/providers.mjs`.

## Deploy
1. Push this folder to a GitHub repo.
2. Netlify → Add new site → Import from Git → choose the repo. Build command: empty. Publish dir: `public` (already in `netlify.toml`).
3. Done. Netlify installs `@netlify/blobs` automatically; history is stored in Netlify Blobs and a scheduled function (`record.mjs`, every 10 min) logs price changes even with no visitors.

Local: `npm install && npx netlify dev`. Tests (mocked network): `npm test`. Mock-data preview: `node test/preview.mjs`.

## Market facts built in (verified)
- Global spot gold: Sun 6 PM ET → Fri 5 PM ET, daily break 5–6 PM ET. In IST (winter): closes Sat 3:30 AM, reopens Mon 4:30 AM (one hour earlier in US summer time).
- MCX: Mon–Fri 9:00 AM to 11:55 PM IST (11:30 PM in US summer time). Exchange holidays are not modelled.
- Weekend news appears as a gap at the Sunday reopen, before India opens Monday.

## Limits
- Rates are indicative; jeweller/city/bank prices differ.
- The estimate is a simple volatility/momentum model; one-day gold moves are close to random.

## Shop rate times (Morning and Evening)

Indian shops and rate sites fix a rate in the morning and revise it later in the day (IBJA publishes a second rate around 5-6:30 PM IST). The site captures two fixed shop rates each weekday and shows them next to the live rate:

| Setting | Default | Env var |
|---|---|---|
| Morning rate | 10:00 IST | `MORNING_RATE_TIME` ("HH:MM") |
| Evening rate | 17:30 IST | `EVENING_RATE_TIME` ("HH:MM") |

Each is captured once, from the first update after the slot time, and only while the global market is open. The forecast table's Morning and Evening columns use the same times, and the track record scores each estimate against the captured rate.
