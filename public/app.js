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
  renderMorning(); renderForecast(); renderLog(); renderChart(true);
}

function renderMorning() {
  const r = state.rates, mo = r?.morning, ev = r?.evening, box = $('morning');
  if (!mo && !ev) { box.hidden = true; return; }
  box.hidden = false;
  const m = mult(), g = gstMul(), d = decs(), gold = r.rates.gold.perGram, u = unitTxt();
  $('mUnit').textContent = `Gold ${u.gold} · Silver ${u.silver}`;
    $('thMorn').textContent = mo ? (mo.kind === 'today' ? `Morning ${tm(mo.t)}` : mo.kind === 'first' ? `First rate ${tm(mo.t)}` : `Morning (${dDay(mo.date)})`) : 'Morning';
  $('thEve').textContent = ev ? `Evening ${tm(ev.t)}` : 'Evening';
  const rows = [
    ['Gold 24K', 'g24', gold.k24 * m.gold * g, m.gold], ['Gold 22K', 'g22', gold.k22 * m.gold * g, m.gold],
    ['Gold 18K', 'g18', gold.k18 * m.gold * g, m.gold], ['Silver', 's', r.rates.silver.perGram * m.silver * g, m.silver],
  ];
  const cell = (x, key, mm, live) => {
    if (!x) return '<td class="num"><span class="pend">not set yet</span></td>';
    const v = x[key] * mm * g, diff = live - v, cls = Math.abs(diff) < (d ? 0.01 : 0.5) ? '' : diff > 0 ? 'up' : 'down';
    return `<td class="num"><span class="v">${inr(v, d)}</span><span class="dd ${cls}">${cls ? (diff > 0 ? '▲ ' : '▼ ') + inr(Math.abs(diff), d) + ' now' : 'same as live'}</span></td>`;
  };
  $('mBody').innerHTML = rows.map(([n, key, live, mm]) =>
    `<tr><th scope="row" class="name">${n}</th>${cell(mo, key, mm, live)}${cell(ev, key, mm, live)}<td class="num"><span class="v live">${inr(live, d)}</span></td></tr>`).join('');
  const parts = ['Most Indian shops and rate sites fix a rate in the morning and revise it in the evening (IBJA publishes about 5–6:30 PM). The market moves in between.'];
  if (r.config.calibratedAt) parts.push(`Live rates are matched to shop prices as of ${new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(r.config.calibratedAt))} IST.`);
  if (mo?.kind === 'first') parts.push('The morning update was missed today, so the first recorded rate is shown.');
  if (r.config.calibratedAt) parts.unshift(`Now matches the shop rate you entered at ${tm(r.config.calibratedAt)} IST.`);
  $('mNote').textContent = parts.join(' ');
}

function renderForecast() {
  const r = state.rates, f = r?.forecast; if (!f) return;
  const m = mult(), g = gstMul(), d = decs(), u = unitTxt();
  $('fcDate').textContent = f.tomorrowIsTradingDay ? dDay(f.targetDate) : `${dDay(f.tomorrow)} · market closed`;
  if (!f.available) { $('fcBody').innerHTML = '<p class="muted">Estimate unavailable right now.</p>'; return; }
  const closedNote = f.tomorrowIsTradingDay ? '' : `<p class="ftrack">Indian markets are shut tomorrow, so rates hold. These estimates are for ${dDay(f.targetDate)}.</p>`;
  const cell = (x, k, mm) => { const v = x[k]; return `<td class="num"><span class="v">${inr(v.expected * mm * g, d)}</span><span class="r">${num(v.low * mm * g, d)} – ${num(v.high * mm * g, d)}</span></td>`; };
  const row = (name, x, ratio, mm) => `<tr><th scope="row" class="name">${name}</th>${cell(x, 'morning', mm * ratio)}${cell(x, 'evening', mm * ratio)}</tr>`;
  const lean = (name, x) => { const c = x.trend === 'up' ? 'up' : x.trend === 'down' ? 'down' : ''; const t = x.trend === 'up' ? '▲ leaning up' : x.trend === 'down' ? '▼ leaning down' : '■ no clear lean'; return `<span class="lean ${c}">${name} ${t} · ${Math.round(Math.max(x.probUp, 1 - x.probUp) * 100)}%</span>`; };
  const A = r.accuracy;
  const fmtP = (v) => (v == null ? null : v.toFixed(1) + '%');
  const track = A ? `<p class="ftrack">Track record (last ${A.days} day${A.days > 1 ? 's' : ''}): morning estimates were off by ${fmtP(A.goldMorningAbsPct)} on average for gold and ${fmtP(A.silverMorningAbsPct)} for silver${A.goldEveningAbsPct != null ? `; evening by ${fmtP(A.goldEveningAbsPct)} and ${fmtP(A.silverEveningAbsPct)}` : ''}.</p>` : '<p class="ftrack">Track record appears here after the first full day of estimates.</p>';
  $('fcBody').innerHTML = `<p class="fc-unit">Gold ${u.gold} · Silver ${u.silver}</p><div class="scroll"><table class="fc-table"><thead><tr><th scope="col"><span class="sr">Metal</span></th><th scope="col" class="num">Morning (${tm(f.morningAt)})</th><th scope="col" class="num">Evening (${tm(f.eveningAt)})</th></tr></thead><tbody>
    ${row('Gold 24K', f.gold, 1, m.gold)}${row('Gold 22K', f.gold, 22 / 24, m.gold)}${row('Gold 18K', f.gold, 18 / 24, m.gold)}${row('Silver', f.silver, 1, m.silver)}</tbody></table></div>
    <div class="lean-line">${lean('Gold', f.gold)}${lean('Silver', f.silver)}</div>${closedNote}${track}
    <p class="ftrack muted">Likely range under each value. Gold and silver cannot be predicted exactly; estimates are not investment advice.</p>`;
}

function renderLog() {
  const h = state.history; if (!h) return;
  const m = mult(), g = gstMul(), d = decs();
  const rows = [...h.today.revisions].reverse();
  $('logMeta').textContent = rows.length ? `${rows.length} update${rows.length > 1 ? 's' : ''} today` : '';
  if (!rows.length) { $('log').innerHTML = '<tr><td colspan="5" class="muted">No changes yet today. New rates appear here as the price moves.</td></tr>'; return; }
  const cellHtml = (price, delta) => {
    const dv = delta == null ? null : delta * g;
    const cls = dv == null ? 'flat' : dv > 0 ? 'up' : dv < 0 ? 'down' : 'flat';
    const txt = dv == null ? '' : `${dv > 0 ? '▲' : dv < 0 ? '▼' : ''} ${inr(Math.abs(dv), d)}`;
    return `<td class="num"><span class="p">${inr(price * g, d)}</span><span class="dl ${cls}">${txt}</span></td>`;
  };
  const html = rows.map((x) => {
    const isNew = !firstLoad && !seenTicks.has(x.t) && seenTicks.size > 0;
    const tag = x.carried ? 'Carried from last close' : x.first ? 'First rate of the day' : '';
    const g24 = x.g24 * m.gold, s = x.s * m.silver;
    const dG = x.dG == null ? null : x.dG * m.gold, dS = x.dS == null ? null : x.dS * m.silver;
    return `<tr class="${isNew ? 'enter' : ''}"><td class="t">${tm(x.t)}${tag ? `<span class="tg">${tag}</span>` : ''}</td>${cellHtml(g24, dG)}${cellHtml(g24 * 22 / 24, dG == null ? null : dG * 22 / 24)}${cellHtml(g24 * 18 / 24, dG == null ? null : dG * 18 / 24)}${cellHtml(s, dS)}</tr>`;
  }).join('');
  h.today.revisions.forEach((x) => seenTicks.add(x.t));
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
  const c1 = state.metal === 'gold' ? '#EBCB73' : '#B9C3D8', c2 = state.metal === 'gold' ? '#C9952A' : '#7C89A5';
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1)},${H - B}L${x(0)},${H - B}Z`;
  const ticks = [0, 1, 2, 3].map((k) => lo + ((hi - lo) * k) / 3);
  const short = (n) => (n >= 1e5 ? (n / 1e5).toFixed(2) + 'L' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : n.toFixed(0));
  const grid = ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(18,22,43,.08)"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${short(t)}</text>`).join('');
  const step = Math.ceil(pts.length / (W < 520 ? 4 : 7));
  const xl = pts.map((p, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${dShort(p.date)}</text>` : '')).join('');
  const last = pts.at(-1), isStatic = !(animate && first) || reduceMotion;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="${isStatic ? 'static' : ''}"><defs><linearGradient id="lg" x1="0" x2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient><linearGradient id="ag" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${c2}" stop-opacity=".35"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></linearGradient></defs>${grid}${xl}
    <path class="area" d="${area}" fill="url(#ag)"/><path class="line" d="${line}" fill="none" stroke="url(#lg)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="--len:${W * 3}"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(last.v)}" r="5" fill="${c1}" stroke="#fff" stroke-width="2"/>
    <line id="xh" y1="${T}" y2="${H - B}" stroke="rgba(18,22,43,.35)" stroke-dasharray="3 3" visibility="hidden"/><circle id="dot" r="5" fill="#12162B" stroke="#fff" stroke-width="2" visibility="hidden"/>
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
