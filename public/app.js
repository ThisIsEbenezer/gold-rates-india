const TZ = 'Asia/Calcutta';
const $ = (id) => document.getElementById(id);
const state = { rates: null, history: null, unit: 'trade', gst: false, metal: 'gold' };
const shown = new Map();          // element id -> last displayed number
const seenTicks = new Set();      // log rows already on screen
let lastMode = '', firstLoad = true, chartSig = '';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n, d = 0) => (d ? nf2 : nf0).format(n);
const inr = (n, d = 0) => '₹' + num(n, d);
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const tm = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
const dShort = (s) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(s + 'T00:00:00Z'));
const dDay = (s) => new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(s + 'T00:00:00Z'));

const mult = () => ({ gold: state.unit === 'trade' ? 10 : 1, silver: state.unit === 'trade' ? 1000 : 1 });
const unitTxt = () => ({ gold: state.unit === 'trade' ? 'per 10 g' : 'per 1 g', silver: state.unit === 'trade' ? 'per 1 kg' : 'per 1 g' });
const gstMul = () => (state.gst && state.rates ? 1 + state.rates.config.gstPct / 100 : 1);
const decs = () => 0;
// Shops quote a whole-rupee rate per gram and multiply it by the weight, so round per gram first.
const px = (perGram, mm) => Math.round(Math.round(perGram) * gstMul()) * mm;
// Chennai shops fix the 22K rate in steps of Rs 5, then derive 24K (x24/22) and 18K (x18/22) from it.
const goldK = (g24raw, karat) => { const k22 = Math.round(g24raw * 22 / 24 / 5) * 5; return karat === 22 ? k22 : Math.round(k22 * karat / 22); };
const pxG = (g24raw, karat, mm) => Math.round(goldK(g24raw, karat) * gstMul()) * mm;

setTimeout(() => document.body.classList.remove('intro'), 1800);

/* emoji burst on price moves */
const UP_FX = ['💚', '⬆️', '🚀', '✨', '📈', '💰'], DOWN_FX = ['🔻', '📉', '💔', '⬇️', '😬'];
function burst(el, dir) {
  if (reduceMotion || !el) return;
  const set = dir === 'up' ? UP_FX : DOWN_FX;
  for (let i = 0; i < 6; i++) {
    const f = document.createElement('span');
    f.className = 'fx ' + dir; f.textContent = set[Math.floor(Math.random() * set.length)];
    f.style.setProperty('--x', `${10 + Math.random() * 80}%`); f.style.setProperty('--dx', `${(Math.random() - 0.5) * 60}px`);
    f.style.setProperty('--r', `${(Math.random() - 0.5) * 50}deg`); f.style.setProperty('--s', `${16 + Math.random() * 14}px`);
    f.style.animationDelay = `${i * 70}ms`;
    el.appendChild(f); setTimeout(() => f.remove(), 1900);
  }
}

setInterval(() => { $('clock').textContent = clockFmt.format(new Date()); }, 1000);
$('clock').textContent = clockFmt.format(new Date());

/* ---------- animated numbers ---------- */
const raf = new Map();
function setNumber(id, value, dec, flashTarget) {
  const el = $(id); if (!el) return;
  const prev = shown.get(id);
  shown.set(id, value);
  const paint = (v) => { el.textContent = num(v, dec); };
  cancelAnimationFrame(raf.get(id));
  if (reduceMotion || prev === undefined && !firstLoad) { paint(value); return; }
  const from = prev === undefined ? value * 0.9 : prev;
  if (Math.abs(from - value) < 0.005) { paint(value); return; }
  if (flashTarget && prev !== undefined && !state.modeChanged) {
    const cls = value > prev ? 'up' : 'down';
    flashTarget.classList.remove('up', 'down'); void flashTarget.offsetWidth; flashTarget.classList.add(cls); burst(flashTarget, cls);
    setTimeout(() => flashTarget.classList.remove('up', 'down'), 1500);
  }
  const t0 = performance.now(), dur = prev === undefined ? 1100 : 800;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    paint(from + (value - from) * e);
    if (p < 1) raf.set(id, requestAnimationFrame(step)); else paint(value);
  };
  raf.set(id, requestAnimationFrame(step));
}

function setChip(id, c, m) {
  const el = $(id); if (!el) return;
  if (!c) { el.className = 'chip'; el.textContent = ''; return; }
  const cls = c.abs > 0 ? 'up' : c.abs < 0 ? 'down' : '';
  const arrow = c.abs > 0 ? '▲' : c.abs < 0 ? '▼' : '■';
  const emoji = c.abs > 0 ? '📈' : c.abs < 0 ? '📉' : '😐';
  const card = el.closest('.card'); if (card) card.dataset.t = cls;
  const amount = inr(Math.abs(c.abs * m * gstMul()), decs());
  const html = `<span class="em">${emoji}</span><span class="arr">${arrow}</span>${amount} · ${Math.abs(c.pct).toFixed(2)}%`;
  const changed = el.dataset.v !== html;
  el.dataset.v = html; el.innerHTML = html;
  el.className = 'chip ' + cls + (changed && !firstLoad ? ' bump' : '');
}

/* ---------- renderers ---------- */
function renderStatus(r) {
  const m = r.market, p = $('statusPill');
  p.textContent = m.globalOpen ? '🟢 Market open' : '😴 Market closed';
  p.className = 'pill ' + (m.globalOpen ? 'open' : '');
  $('statusText').textContent = m.globalOpen ? `Live · updated ${tm(r.asOf)} IST` : (m.changesAtLabel ? `Reopens ${m.changesAtLabel} IST` : '');
  const a = $('alert');
  if (r.warnings?.length) { a.hidden = false; a.textContent = r.warnings.join(' '); } else a.hidden = true;
  const src = r.spot.sources.length ? `Gold $${r.spot.xau.toFixed(2)}/oz · Silver $${r.spot.xag.toFixed(2)}/oz · USD/INR ${r.spot.usdInr.toFixed(2)} · ${r.config.importDutyPct}% import duty` : '';
  $('sources').textContent = src;
}

function renderBoard() {
  const r = state.rates; if (!r) return;
  const m = mult(), u = unitTxt(), g = gstMul(), d = decs();
  const mode = `${state.unit}|${state.gst}`;
  state.modeChanged = mode !== lastMode; lastMode = mode;
  const gold = r.rates.gold.perGram, ref = r.reference;
  const gc = ref?.gold, sc = ref?.silver;
  $('u-g24').textContent = u.gold; $('u-g22').textContent = u.gold; $('u-g18').textContent = u.gold; $('u-s').textContent = u.silver;
  setNumber('v-g24', pxG(gold.k24, 24, m.gold), d, $('hero-price'));
  setNumber('v-g22', pxG(gold.k24, 22, m.gold), d, $('v-g22').closest('.card'));
  setNumber('v-g18', pxG(gold.k24, 18, m.gold), d, $('v-g18').closest('.card'));
  setNumber('v-s', px(r.rates.silver.perGram, m.silver), d, $('v-s').closest('.card'));
  setChip('c-g24', gc, m.gold);
  setChip('c-g22', gc && { abs: gc.abs * 22 / 24, pct: gc.pct }, m.gold);
  setChip('c-g18', gc && { abs: gc.abs * 18 / 24, pct: gc.pct }, m.gold);
  setChip('c-s', sc, m.silver);
  renderForecast(); renderLog(); renderChart(true);
}

function renderForecast() {
  const r = state.rates, f = r?.forecast; if (!f) return;
  const m = mult(), d = decs(), u = unitTxt(), gold = r.rates.gold.perGram;
  $('fcDate').textContent = f.tomorrowIsTradingDay ? dDay(f.targetDate) : `${dDay(f.tomorrow)} · market closed`;
  if (!f.available) { $('fcBody').innerHTML = '<p class="muted">Estimate unavailable right now.</p>'; return; }
  const closedNote = f.tomorrowIsTradingDay ? '' : `<p class="fnote">Indian markets are shut tomorrow, so rates hold. These estimates are for ${dDay(f.targetDate)}.</p>`;
  // One estimate per metal for the whole day: the range spans the morning and evening ranges.
  const box = (name, emoji, x, karat, mm, nowRaw) => {
    const conv = (n) => (karat ? pxG(n, karat, mm) : px(n, mm));
    const exp = conv((x.morning.expected + x.evening.expected) / 2);
    const lo = conv(Math.min(x.morning.low, x.evening.low)), hi = conv(Math.max(x.morning.high, x.evening.high));
    const now = conv(nowRaw), diff = exp - now;
    const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const txt = diff === 0 ? '😐 about the same as now' : `${diff > 0 ? '📈 ▲' : '📉 ▼'} ${inr(Math.abs(diff), d)} vs now`;
    const pos = hi > lo ? Math.max(4, Math.min(96, ((exp - lo) / (hi - lo)) * 100)) : 50;
    return `<div class="er"><div class="er-top"><span class="er-name">${emoji} ${name}</span><span class="er-val">${inr(exp, d)}</span></div>
      <div class="er-d ${cls}">${txt}</div>
      <div class="bar-r" aria-hidden="true"><b style="--p:${pos}%"></b></div>
      <div class="bar-l"><span>Low ${inr(lo, d)}</span><span>High ${inr(hi, d)}</span></div></div>`;
  };
  const lean = (name, emoji, x) => { const c = x.trend === 'up' ? 'up' : x.trend === 'down' ? 'down' : ''; const t = x.trend === 'up' ? '📈 leaning up' : x.trend === 'down' ? '📉 leaning down' : '😐 no clear lean'; return `<span class="lean ${c}">${emoji} ${name} ${t} · ${Math.round(Math.max(x.probUp, 1 - x.probUp) * 100)}%</span>`; };
  const A = r.accuracy;
  const errs = A ? [A.goldMorningAbsPct, A.goldEveningAbsPct, A.silverMorningAbsPct, A.silverEveningAbsPct].filter((v) => v != null) : [];
  const track = errs.length ? `<p class="fnote">🎯 Track record (last ${A.days} day${A.days > 1 ? 's' : ''}): estimates were off by ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1)}% on average.</p>` : '<p class="fnote">🎯 Track record appears here after the first full day of estimates.</p>';
  $('fcBody').innerHTML = `<p class="fc-unit">Gold ${u.gold} · Silver ${u.silver} · likely range for the day</p>
    <div class="est">${box('Gold 24K', '🥇', f.gold, 24, m.gold, gold.k24)}${box('Gold 22K', '🥇', f.gold, 22, m.gold, gold.k24)}${box('Gold 18K', '🥇', f.gold, 18, m.gold, gold.k24)}${box('Silver', '🥈', f.silver, 0, m.silver, r.rates.silver.perGram)}</div>
    <div class="lean-line">${lean('Gold', '🥇', f.gold)}${lean('Silver', '🥈', f.silver)}</div>${closedNote}${track}
    <p class="fnote">Gold and silver cannot be predicted exactly. Estimates are not investment advice.</p>`;
}

function renderLog() {
  const h = state.history; if (!h) return;
  const m = mult(), g = gstMul(), d = decs();
  const rows = [...h.today.revisions].reverse();
  $('logMeta').textContent = rows.length ? `${rows.length} update${rows.length > 1 ? 's' : ''} today` : '';
  if (!rows.length) { $('log').innerHTML = '<p class="muted">😴 No changes yet today. New rates appear here as the price moves.</p>'; return; }
  const cell = (label, price, delta) => {
    const dv = delta == null ? null : delta * g;
    const cls = dv == null ? 'flat' : dv > 0 ? 'up' : dv < 0 ? 'down' : 'flat';
    const txt = dv == null ? '&nbsp;' : dv === 0 ? '➖' : `${dv > 0 ? '🟢 ▲' : '🔴 ▼'} ${inr(Math.abs(dv), d)}`;
    return `<div class="lc"><span class="k">${label}</span><span class="p">${inr(price, d)}</span><span class="dl ${cls}">${txt}</span></div>`;
  };
  const html = rows.map((x) => {
    const isNew = !firstLoad && !seenTicks.has(x.t) && seenTicks.size > 0;
    const tag = x.carried ? 'carried from last close' : x.first ? 'first rate of the day' : '';
    const dG = x.dG == null ? null : x.dG * m.gold, dS = x.dS == null ? null : x.dS * m.silver;
    return `<div class="lrow${isNew ? ' enter' : ''}" role="listitem"><div class="lt">🕘 ${tm(x.t)}${tag ? `<small>${tag}</small>` : ''}</div>
      ${cell('24K', pxG(x.g24, 24, m.gold), dG)}${cell('22K', pxG(x.g24, 22, m.gold), dG == null ? null : dG * 22 / 24)}${cell('18K', pxG(x.g24, 18, m.gold), dG == null ? null : dG * 18 / 24)}${cell('Silver', px(x.s, m.silver), dS)}</div>`;
  }).join('');
  h.today.revisions.forEach((x) => seenTicks.add(x.t));
  $('log').innerHTML = html;
}

function renderChart(animate = true) {
  const h = state.history; if (!h || !h.daily.length) return;
  const m = mult(), g = gstMul(), key = state.metal === 'gold' ? 'g24' : 's', mm = state.metal === 'gold' ? m.gold : m.silver;
  const pts = h.daily.map((x) => ({ date: x.date, v: state.metal === 'gold' ? pxG(x.g24, 24, mm) : px(x.s, mm) }));
  const box = $('chart'), W = Math.max(280, box.clientWidth || 640), H = W < 520 ? 210 : 290;
  const sig = `${state.metal}|${state.unit}|${state.gst}|${pts.length}|${pts.at(-1).v.toFixed(0)}|${W}`;
  if (sig === chartSig) return;
  const first = chartSig === '' || chartSig.split('|')[0] !== state.metal;
  chartSig = sig;
  const L = W < 520 ? 46 : 58, R = 10, T = 14, B = 26;
  const vs = pts.map((p) => p.v); let lo = Math.min(...vs), hi = Math.max(...vs); const pad = (hi - lo || hi * 0.01) * 0.15; lo -= pad; hi += pad;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const c1 = state.metal === 'gold' ? '#FFE08A' : '#DCE6F6', c2 = state.metal === 'gold' ? '#FF9F1C' : '#8FA2C4';
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1)},${H - B}L${x(0)},${H - B}Z`;
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const short = (n) => (n >= 1e5 ? (n / 1e5).toFixed(2) + 'L' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : n.toFixed(0));
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.08)"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('');
  const step = Math.ceil(pts.length / (W < 520 ? 4 : 7));
  const xl = pts.map((p, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${dShort(p.date)}</text>` : '')).join('');
  const last = pts.at(-1), isStatic = !(animate && first) || reduceMotion;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${isStatic ? 'static' : ''}"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity=".35"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient></defs>${grid}${xl}
    <path class="area" d="${area}" fill="url(#ag)"/><path class="line" d="${line}" fill="none" stroke="url(#lg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="--len:${W * 3}"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="5" fill="${c1}" stroke="#0A1A1F" stroke-width="2"/>
    <line id="xh" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.4)" stroke-dasharray="3 3" visibility="hidden"/><circle id="dot" r="5" fill="#fff" stroke="#0A1A1F" stroke-width="2" visibility="hidden"/>
    <rect id="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  box.setAttribute('aria-label', `${state.metal === 'gold' ? 'Gold 24K' : 'Silver'} daily rate for ${pts.length} days, from ${inr(pts[0].v)} to ${inr(last.v)}`);
  const svg = box.querySelector('svg'), tip = $('tip');
  const move = (e) => {
    const b = svg.getBoundingClientRect(), px = ((e.clientX - b.left) / b.width) * W;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - L) / (W - L - R)) * (pts.length - 1))));
    const p = pts[i], sx = x(i), sy = y(p.v);
    const xh = svg.querySelector('#xh'), dot = svg.querySelector('#dot');
    xh.setAttribute('x1', sx); xh.setAttribute('x2', sx); xh.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', sx); dot.setAttribute('cy', sy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.textContent = `${dShort(p.date)} · ${inr(p.v, decs())}`;
    tip.style.left = `${(sx / W) * b.width}px`; tip.style.top = `${(sy / H) * b.height}px`;
  };
  const hide = () => { tip.hidden = true; svg.querySelector('#xh').setAttribute('visibility', 'hidden'); svg.querySelector('#dot').setAttribute('visibility', 'hidden'); };
  const hit = svg.querySelector('#hit');
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', hide);
}

/* ---------- data ---------- */
async function load() {
  try {
    const [r, h] = await Promise.all([
      fetch('/api/rates').then(async (x) => { const j = await x.json(); if (!x.ok) throw new Error(j.error || 'Rates unavailable'); return j; }),
      fetch('/api/history').then((x) => (x.ok ? x.json() : null)).catch(() => null),
    ]);
    state.rates = r; if (h) state.history = h;
    renderStatus(r); renderBoard(); firstLoad = false;
  } catch (e) {
    const a = $('alert'); a.hidden = false; a.textContent = `Could not load live rates (${e.message}). Retrying…`;
    if (!state.rates) { $('statusPill').textContent = 'Offline'; $('statusPill').className = 'pill'; }
  }
}

document.querySelectorAll('input[name=unit]').forEach((el) => el.addEventListener('change', () => { state.unit = el.value; chartSig = ''; renderBoard(); }));
document.querySelectorAll('input[name=metal]').forEach((el) => el.addEventListener('change', () => { state.metal = el.value; chartSig = ''; renderChart(true); }));
$('gst').addEventListener('change', (e) => { state.gst = e.target.checked; chartSig = ''; renderBoard(); });
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => renderChart(false), 150); });

const yr = $('yr'); if (yr) yr.textContent = new Date().getFullYear();
const pollSec = Math.max(3, Number(new URLSearchParams(location.search).get('poll')) || 30);
load(); setInterval(load, pollSec * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
