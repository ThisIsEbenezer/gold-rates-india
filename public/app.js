const TZ = 'Asia/Kolkata';
const $ = (id) => document.getElementById(id);
const state = { rates: null, history: null, unit: 'trade', gst: false, metal: 'gold' };

const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n, d = 0) => '₹' + (d ? inr2 : inr0).format(n);
const time = (iso, o = {}) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true, ...o }).format(new Date(iso));
const dateLong = (s) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(s + 'T00:00:00Z'));
const dateShort = (s) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(s + 'T00:00:00Z'));

// Unit multipliers: gold trades per 10 g, silver per kg in India.
const mult = () => ({ gold: state.unit === 'trade' ? 10 : 1, silver: state.unit === 'trade' ? 1000 : 1 });
const unitLabel = () => ({ gold: state.unit === 'trade' ? '10 g' : '1 g', silver: state.unit === 'trade' ? '1 kg' : '1 g' });
const gstMul = () => (state.gst && state.rates ? 1 + state.rates.config.gstPct / 100 : 1);
const d2 = (n) => (state.unit === 'trade' ? 0 : 2);

function clock() {
  $('clock').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date());
}
setInterval(clock, 1000); clock();

function chgHtml(c, m = 1) {
  if (!c) return '<span class="chg flat">–</span>';
  const cls = c.abs > 0 ? 'up' : c.abs < 0 ? 'down' : 'flat';
  const arrow = c.abs > 0 ? '▲' : c.abs < 0 ? '▼' : '■';
  return `<span class="chg ${cls}">${arrow} ${fmt(Math.abs(c.abs * m * gstMul()), state.unit === 'trade' ? 0 : 2)} (${Math.abs(c.pct).toFixed(2)}%)</span>`;
}

function renderStatus(r) {
  const m = r.market;
  const pill = $('statusPill');
  pill.textContent = m.globalOpen ? 'Market open' : 'Market closed';
  pill.className = 'pill ' + (m.globalOpen ? 'pill-open' : 'pill-closed');
  const next = m.changesAtLabel ? (m.globalOpen ? ` Next break: ${m.changesAtLabel} IST.` : ` Reopens ${m.changesAtLabel} IST.`) : '';
  $('statusText').textContent = m.note + next;
  const alert = $('alert');
  if (r.warnings?.length) { alert.hidden = false; alert.textContent = r.warnings.join(' '); } else alert.hidden = true;
  $('updated').textContent = `Updated ${time(r.asOf, { second: '2-digit' })} IST`;
  $('sources').textContent = r.spot.sources.length ? `Data: ${[...new Set(r.spot.sources)].join(', ')}. USD/INR ${r.spot.usdInr.toFixed(2)}, gold $${r.spot.xau.toFixed(2)}/oz, silver $${r.spot.xag.toFixed(2)}/oz.` : '';
}

function renderBoard() {
  const r = state.rates; if (!r) return;
  const m = mult(), u = unitLabel(), g = gstMul(), dec = d2();
  const gold = r.rates.gold.perGram, ref = r.reference;
  const row = (cls, dot, name, sub, val, ch, hero) => `<tr class="${hero ? 'hero' : ''}"><th scope="row" class="metal" style="font-size:1rem;color:inherit;padding:14px 0;border-bottom:1px solid var(--line)"><span class="${dot}"></span>${name}<small>${sub}</small></th><td class="num"><span class="big">${fmt(val, dec)}</span></td><td class="num">${ch}</td></tr>`;
  const goldChg = ref?.gold;
  $('ratesBody').innerHTML =
    row('', 'gold-dot', 'Gold 24K', `per ${u.gold} · 99.9% pure`, gold.k24 * m.gold * g, chgHtml(goldChg, m.gold), true) +
    row('', 'gold-dot', 'Gold 22K', `per ${u.gold} · 91.6%`, gold.k22 * m.gold * g, chgHtml(goldChg && { abs: goldChg.abs * 22 / 24, pct: goldChg.pct }, m.gold)) +
    row('', 'gold-dot', 'Gold 18K', `per ${u.gold} · 75%`, gold.k18 * m.gold * g, chgHtml(goldChg && { abs: goldChg.abs * 18 / 24, pct: goldChg.pct }, m.gold)) +
    row('', 'silver-dot', 'Silver', `per ${u.silver} · 99.9%`, r.rates.silver.perGram * m.silver * g, chgHtml(ref?.silver, m.silver), true);
  const duty = r.config.importDutyPct;
  $('basis').textContent = `Includes ${duty}% import duty${r.config.premiumPct ? ` and ${r.config.premiumPct}% dealer premium` : ''}. ${state.gst ? `GST ${r.config.gstPct}% included.` : `GST ${r.config.gstPct}% not included.`}${ref ? ` Change shown ${ref.label}.` : ''}`;
  $('thG').textContent = `Gold 24K / ${u.gold}`; $('thS').textContent = `Silver / ${u.silver}`;
  renderForecast(); renderToday(); renderHistory();
}

function rangeBar(low, exp, high) {
  const pad = (high - low) * 0.25, lo = low - pad, hi = high + pad, p = (v) => ((v - lo) / (hi - lo)) * 100;
  return `<div class="range-bar" aria-hidden="true"><b style="left:${p(low)}%;width:${p(high) - p(low)}%"></b><i style="left:calc(${p(exp)}% - 1px)"></i></div>`;
}

function renderForecast() {
  const r = state.rates; if (!r) return;
  const f = r.forecast, m = mult(), u = unitLabel(), g = gstMul(), dec = d2();
  if (!f.available) { $('fcBody').innerHTML = '<p class="muted">Not enough price history to make an estimate right now. Try again shortly.</p>'; return; }
  const tomorrowName = dateLong(f.tomorrow);
  const head = f.tomorrowIsTradingDay
    ? `<p class="fc-date"><strong>${tomorrowName}</strong>, expected closing rate</p>`
    : `<p class="fc-date"><strong>${tomorrowName}</strong>: Indian markets are closed, so the rate stays at the last close. First estimate is for <strong>${dateLong(f.targetDate)}</strong>.</p>`;
  const block = (title, d, mm, unit) => {
    const exp = d.expected * mm * g, lo = d.low * mm * g, hi = d.high * mm * g;
    const dir = d.trend === 'up' ? '▲ Leaning up' : d.trend === 'down' ? '▼ Leaning down' : '■ No clear lean';
    const cls = d.trend === 'up' ? 'up' : d.trend === 'down' ? 'down' : 'flat';
    return `<div class="fc-row"><h3>${title} <span class="muted" style="font-weight:400">per ${unit}</span> <span class="badge ${cls}">${dir} · ${Math.round(d.probUp * 100)}% chance higher</span></h3>
      <div class="fc-val">${fmt(exp, dec)}</div>${rangeBar(lo, exp, hi)}
      <div class="fc-range">Likely range ${fmt(lo, dec)} to ${fmt(hi, dec)}</div></div>`;
  };
  $('fcBody').innerHTML = head + block('Gold 24K', f.gold, m.gold, u.gold) + block('Silver', f.silver, m.silver, u.silver) +
    `<p class="fc-note">Statistical estimate from recent daily closes. The range covers roughly two out of three outcomes. Not investment advice.</p>`;
}

function renderToday() {
  const h = state.history, r = state.rates; if (!h) return;
  const m = mult(), g = gstMul(), dec = d2();
  const rows = h.today.revisions;
  $('todayMeta').textContent = h.today.high ? `High ${fmt(h.today.high.g24 * m.gold * g, dec)} · Low ${fmt(h.today.low.g24 * m.gold * g, dec)} (gold 24K)` : '';
  if (!rows.length) { $('logBody').innerHTML = '<tr><td colspan="5" class="muted">No changes recorded yet today. New rows appear whenever the rate moves meaningfully.</td></tr>'; return; }
  const d = (v, mm) => v == null ? '<span class="flat">–</span>' : `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${fmt(Math.abs(v * mm * g), dec)}</span>`;
  $('logBody').innerHTML = [...rows].reverse().map((x) => `<tr><td>${time(x.t)}${x.carried ? '<span class="tag">carried from last close</span>' : x.first ? '<span class="tag">first rate of the day</span>' : ''}</td><td class="num">${fmt(x.g24 * m.gold * g, dec)}</td><td class="num">${d(x.dG, m.gold)}</td><td class="num">${fmt(x.s * m.silver * g, dec)}</td><td class="num">${d(x.dS, m.silver)}</td></tr>`).join('');
}

function renderHistory() {
  const h = state.history; if (!h || !h.daily.length) return;
  const m = mult(), g = gstMul(), key = state.metal === 'gold' ? 'g24' : 's', mm = state.metal === 'gold' ? m.gold : m.silver;
  const pts = h.daily.map((d) => ({ date: d.date, v: d[key] * mm * g }));
  $('histBody').innerHTML = [...h.daily].reverse().map((d) => `<tr><td>${dateShort(d.date)}</td><td class="num">${fmt(d.g24 * m.gold * g, d2())}</td><td class="num">${fmt(d.s * m.silver * g, d2())}</td></tr>`).join('');
  drawChart(pts);
}

function drawChart(pts) {
  const W = 960, H = 320, L = 64, R = 16, T = 16, B = 30;
  const vs = pts.map((p) => p.v); let lo = Math.min(...vs), hi = Math.max(...vs); const pad = (hi - lo || hi * 0.01) * 0.12; lo -= pad; hi += pad;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const color = state.metal === 'gold' ? '#8F6200' : '#516173';
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#E3E7EC"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${inr0.format(t)}</text>`).join('');
  const step = Math.ceil(pts.length / 6);
  const xl = pts.map((p, i) => (i % step === 0 || i === pts.length - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${dateShort(p.date)}</text>` : '').join('');
  const last = pts.at(-1);
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${grid}${xl}<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="5" fill="${color}" stroke="#fff" stroke-width="2"/><line id="xh" y1="${T}" y2="${H - B}" stroke="#9AA5B1" stroke-dasharray="3 3" visibility="hidden"/><circle id="dot" r="5" fill="${color}" stroke="#fff" stroke-width="2" visibility="hidden"/><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="hit"/></svg>`;
  $('chart').setAttribute('aria-label', `${state.metal === 'gold' ? 'Gold 24K' : 'Silver'} daily rate, ${pts.length} days, from ${fmt(pts[0].v)} to ${fmt(last.v)}`);
  const svg = $('chart').querySelector('svg'), tip = $('tip');
  const move = (e) => {
    const b = svg.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1))));
    const p = pts[i], sx = x(i), sy = y(p.v);
    const xh = svg.querySelector('#xh'), dot = svg.querySelector('#dot');
    xh.setAttribute('x1', sx); xh.setAttribute('x2', sx); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', sx); dot.setAttribute('cy', sy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.textContent = `${dateShort(p.date)}: ${fmt(p.v, d2())}`;
    tip.style.left = `${(sx / W) * b.width}px`; tip.style.top = `${(sy / H) * b.height}px`;
  };
  const hit = svg.querySelector('#hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => { tip.hidden = true; svg.querySelector('#xh').setAttribute('visibility', 'hidden'); svg.querySelector('#dot').setAttribute('visibility', 'hidden'); });
}

async function load() {
  try {
    const [r, h] = await Promise.all([fetch('/api/rates').then((x) => x.json().then((j) => { if (!x.ok) throw new Error(j.error || 'Rates unavailable'); return j; })), fetch('/api/history').then((x) => x.ok ? x.json() : null).catch(() => null)]);
    state.rates = r; if (h) state.history = h;
    renderStatus(r); renderBoard();
  } catch (e) {
    const a = $('alert'); a.hidden = false;
    a.textContent = `Could not load live rates (${e.message}). Retrying automatically.`;
    if (!state.rates) { $('statusPill').textContent = 'Offline'; $('statusPill').className = 'pill pill-closed'; }
  }
}

document.querySelectorAll('input[name=unit]').forEach((el) => el.addEventListener('change', () => { state.unit = el.value; renderBoard(); }));
document.querySelectorAll('input[name=metal]').forEach((el) => el.addEventListener('change', () => { state.metal = el.value; renderHistory(); }));
$('gst').addEventListener('change', (e) => { state.gst = e.target.checked; renderBoard(); });
load(); setInterval(load, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
