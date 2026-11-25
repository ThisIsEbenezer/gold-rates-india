// Market-hours logic. All user-facing times are Indian Standard Time (Asia/Kolkata, UTC+5:30, no DST).
export const IST = 'Asia/Kolkata';
export const NY = 'America/New_York';

export function tzParts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, dow, date: `${p.year}-${p.month}-${p.day}` };
}

export const istDate = (d = new Date()) => tzParts(d, IST).date;

/** Global spot gold/silver (OTC + COMEX): open Sun 18:00 ET -> Fri 17:00 ET, with a daily 17:00-18:00 ET break. */
export function isGlobalOpen(date) {
  const { dow, h } = tzParts(date, NY);
  if (dow === 6) return false;              // Saturday
  if (dow === 5 && h >= 17) return false;   // Friday after 17:00 ET
  if (dow === 0 && h < 18) return false;    // Sunday before 18:00 ET
  if (h === 17) return false;               // daily break
  return true;
}

export function nextGlobalOpen(date) {
  let t = new Date(Math.ceil(date.getTime() / 60000) * 60000);
  for (let i = 0; i < 4 * 24 * 60; i++) {
    if (isGlobalOpen(t)) return t;
    t = new Date(t.getTime() + 60000);
  }
  return null;
}

export function nextGlobalClose(date) {
  let t = new Date(Math.ceil(date.getTime() / 60000) * 60000);
  for (let i = 0; i < 4 * 24 * 60; i++) {
    if (!isGlobalOpen(t)) return t;
    t = new Date(t.getTime() + 60000);
  }
  return null;
}

/** True when New York is on standard time (EST, UTC-5) i.e. roughly November to March. */
export function isUsStandardTime(date) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: NY, timeZoneName: 'shortOffset' })
    .formatToParts(date).find((x) => x.type === 'timeZoneName').value; // "GMT-5" or "GMT-4"
  return part === 'GMT-5';
}

/** MCX (India) commodity futures: Mon-Fri 09:00 to 23:30 IST (US summer time) / 23:55 IST (US winter time). */
export function mcxStatus(date) {
  const ist = tzParts(date, IST);
  const winter = isUsStandardTime(date);
  const closeMin = winter ? 23 * 60 + 55 : 23 * 60 + 30;
  const minutes = ist.h * 60 + ist.mi;
  const open = ist.dow >= 1 && ist.dow <= 5 && minutes >= 9 * 60 && minutes < closeMin;
  return { open, hours: `Mon–Fri, 9:00 AM – ${winter ? '11:55' : '11:30'} PM IST` };
}

export function formatIST(date, opts = {}) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, weekday: 'short', ...opts,
  }).format(date);
}

export function addDaysIST(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function dowOfDateStr(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Next Indian trading day strictly after `dateStr` (Mon–Fri; exchange holidays not modelled). */
export function nextTradingDay(dateStr) {
  let d = addDaysIST(dateStr, 1);
  while ([0, 6].includes(dowOfDateStr(d))) d = addDaysIST(d, 1);
  return d;
}

export function marketSnapshot(date = new Date()) {
  const open = isGlobalOpen(date);
  const next = open ? nextGlobalClose(date) : nextGlobalOpen(date);
  const mcx = mcxStatus(date);
  const ist = tzParts(date, IST);
  const weekend = ist.dow === 0 || ist.dow === 6;
  let note;
  if (open) note = 'Global spot market is open. Rates update live.';
  else if (ist.dow === 6 || ist.dow === 0 || (ist.dow === 1 && ist.h < 5))
    note = 'Weekend break. Global gold trading is shut from Friday 5 PM to Sunday 6 PM New York time, so the last Friday rate stays in force.';
  else note = 'Short daily break in global trading (about 1 hour). Rates resume shortly.';
  return {
    globalOpen: open,
    status: open ? 'open' : 'closed',
    changesAtIST: next ? next.toISOString() : null,
    changesAtLabel: next ? formatIST(next) : null,
    mcx,
    weekend,
    note,
    today: ist.date,
  };
}

/** Converts an IST calendar date + minutes-after-midnight into a real Date (IST is UTC+5:30, no DST). */
export function istToDate(dateStr, minutes) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minutes - 330));
}

/** Hours the global gold market is open between two instants (15-minute steps). */
export function openHoursBetween(a, b) {
  let n = 0;
  for (let t = a.getTime(); t < b.getTime(); t += 15 * 60000) if (isGlobalOpen(new Date(t))) n += 0.25;
  return n;
}

/**
 * Date (New York) of the futures session that is running now. A session starts at 6 PM ET the evening before,
 * so from 6 PM ET onwards "today's" session is already tomorrow's date. Daily bars dated >= this are still in progress.
 */
export function currentSessionDateET(date) {
  const et = tzParts(date, NY);
  return et.h >= 18 ? addDaysIST(et.date, 1) : et.date;
}
