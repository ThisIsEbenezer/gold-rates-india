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
const decs = () => (state.unit === 'trade' ? 0 : 2);

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
    flashTarget.classList.remove('up', 'down'); void flashTarget.offsetWidth; flashTarget.classList.add(cls);
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
  const amount = inr(Math.abs(c.abs * m * gstMul()), decs());
  const html = `<span class="arr">${arrow}</span>${amount} · ${Math.abs(c.pct).toFixed(2)}%`;
  const changed = el.dataset.v !== html;
  el.dataset.v = html; el.innerHTML = html;
  el.className = 'chip ' + cls + (changed && !firstLoad ? ' bump' : '');
}

/* ---------- renderers ---------- */
function renderStatus(r) {
  const m = r.market, p = $('statusPill');
  p.textContent = m.globalOpen ? 'Market open' : 'Market closed';
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
  setNumber('v-g24', gold.k24 * m.gold * g, d, $('hero-price'));
  setNumber('v-g22', gold.k22 * m.gold * g, d, $('v-g22').parentElement);
  setNumber('v-g18', gold.k18 * m.gold * g, d, $('v-g18').parentElement);
  setNumber('v-s', r.rates.silver.perGram * m.silver * g, d, $('v-s').parentElement);
  setChip('c-g24', gc, m.gold);
  setChip('c-g22', gc && { abs: gc.abs * 22 / 24, pct: gc.pct }, m.gold);
  setChip('c-g18', gc && { abs: gc.abs * 18 / 24, pct: gc.pct }, m.gold);
  setChip('c-s', sc, m.silver);
  renderForecast(); renderLog(); renderChart(true);
}

function renderForecast() {
  const r = state.rates, f = r?.forecast; if (!f) return;
  const m = mult(), g = gstMul(), d = decs(), u = unitTxt();
  $('fcDate').textContent = f.tomorrowIsTradingDay ? dDay(f.targetDate) : `${dDay(f.tomorrow)} · closed`;
  if (!f.available) { $('fcBody').innerHTML = '<p class="muted">Estimate unavailable right now.</p>'; return; }
  const note = f.tomorrowIsTradingDay ? '' : `<p class="fc-range" style="margin:10px 0 0">Markets are shut tomorrow, so rates hold. Estimate is for ${dDay(f.targetDate)}.</p>`;
  const row = (name, x, mm, unit) => {
    const exp = x.expected * mm * g, lo = x.low * mm * g, hi = x.high * mm * g, pad = (hi - lo) * 0.35, a = lo - pad, b = hi + pad, p = (v) => ((v - a) / (b - a)) * 100;
    const lean = x.trend === 'up' ? ['up', '▲ Up'] : x.trend === 'down' ? ['down', '▼ Down'] : ['', '■ Flat'];
    return `<div class="fc-row"><div class="fc-top"><span class="fc-name">${name} <span class="unit">${unit}</span></span><span class="lean ${lean[0]}">${lean[1]} ${Math.round(Math.max(x.probUp, 1 - x.probUp) * 100)}%</span></div>
      <div class="fc-val">${inr(exp, d)}</div>
      <div class="range" aria-hidden="true"><b style="left:${p(lo)}%;width:${p(hi) - p(lo)}%"></b><i style="left:calc(${p(exp)}% - 1px)"></i></div>
      <div class="fc-range">Likely ${inr(lo, d)} – ${inr(hi, d)}</div></div>`;
  };
  $('fcBody').innerHTML = row('Gold 24K', f.gold, m.gold, u.gold) + row('Silver', f.silver, m.silver, u.silver) + note;
}

function renderLog() {
  const h = state.history; if (!h) return;
  const m = mult(), g = gstMul(), d = decs();
  const rows = [...h.today.revisions].reverse().slice(0, 6);
  if (!rows.length) { $('log').innerHTML = '<li class="muted">No changes yet today. New rates appear here as the price moves.</li>'; return; }
  const html = rows.map((x) => {
    const isNew = !firstLoad && !seenTicks.has(x.t) && seenTicks.size > 0;
    const dv = x.dG == null ? null : x.dG * m.gold * g;
    const cls = dv == null ? 'flat' : dv > 0 ? 'up' : dv < 0 ? 'down' : 'flat';
    const delta = dv == null ? '–' : `${dv > 0 ? '▲' : dv < 0 ? '▼' : ''} ${inr(Math.abs(dv), d)}`;
    const tag = x.carried ? 'Carried from last close' : x.first ? 'First rate of the day' : '';
    return `<li class="${isNew ? 'enter' : ''}"><span class="t">${tm(x.t)}</span><span class="g">${inr(x.g24 * m.gold * g, d)}</span><span class="d ${cls}">${delta}</span><span class="tag">${tag ? tag + ' · ' : ''}Silver ${inr(x.s * m.silver * g, d)}</span></li>`;
  }).join('');
  [...h.today.revisions].forEach((x) => seenTicks.add(x.t));
  $('log').innerHTML = html;
}

function renderChart(animate = true) {
  const h = state.history; if (!h || !h.daily.length) return;
  const m = mult(), g = gstMul(), key = state.metal === 'gold' ? 'g24' : 's', mm = state.metal === 'gold' ? m.gold : m.silver;
  const pts = h.daily.map((x) => ({ date: x.date, v: x[key] * mm * g }));
  const box = $('chart'), W = Math.max(280, box.clientWidth || 640), H = W < 520 ? 210 : 290;
  const sig = `${state.metal}|${state.unit}|${state.gst}|${pts.length}|${pts.at(-1).v.toFixed(0)}|${W}`;
  if (sig === chartSig) return;
  const first = chartSig === '' || chartSig.split('|')[0] !== state.metal;
  chartSig = sig;
  const L = W < 520 ? 46 : 58, R = 10, T = 14, B = 26;
  const vs = pts.map((p) => p.v); let lo = Math.min(...vs), hi = Math.max(...vs); const pad = (hi - lo || hi * 0.01) * 0.15; lo -= pad; hi += pad;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, pts.length - 1), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const c1 = state.metal === 'gold' ? '#F6DD94' : '#E3EAF6', c2 = state.metal === 'gold' ? '#E0B24A' : '#AAB8D0';
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1)},${H - B}L${x(0)},${H - B}Z`;
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const short = (n) => (n >= 1e5 ? (n / 1e5).toFixed(2) + 'L' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : n.toFixed(0));
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.07)"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('');
  const step = Math.ceil(pts.length / (W < 520 ? 4 : 7));
  const xl = pts.map((p, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${dShort(p.date)}</text>` : '')).join('');
  const last = pts.at(-1), isStatic = !(animate && first) || reduceMotion;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${isStatic ? 'static' : ''}"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity=".35"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient></defs>${grid}${xl}
    <path class="area" d="${area}" fill="url(#ag)"/><path class="line" d="${line}" fill="none" stroke="url(#lg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="--len:${W * 3}"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="5" fill="${c1}" stroke="#0A0F1E" stroke-width="2"/>
    <line id="xh" y1="${T}" y2="${H - B}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3" visibility="hidden"/><circle id="dot" r="5" fill="#fff" stroke="#0A0F1E" stroke-width="2" visibility="hidden"/>
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

const pollSec = Math.max(3, Number(new URLSearchParams(location.search).get('poll')) || 30);
load(); setInterval(load, pollSec * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
