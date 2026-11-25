// Mock network: gold 4000 USD/oz, silver 50, USDINR 88, 120 days of synthetic daily history.
export function mockFetch({ xau = 4000, xag = 50, fx = 88, failMetals = false, failYahoo = false, until = '2026-11-20' } = {}) {
  const dayTs = [];
  const start = Date.UTC(2026, 6, 1, 5); // 1 Jul 2026 05:00 UTC
  for (let i = 0; i < 170; i++) { const t = new Date(start + i * 86400000); if (![0, 6].includes(t.getUTCDay()) && t.toISOString().slice(0, 10) <= until) dayTs.push(t.getTime() / 1000); }
  const series = (base) => dayTs.map((_, i) => base * (1 + 0.002 * Math.sin(i / 3) + i * 0.0004));
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const ok = (j) => ({ ok: true, status: 200, json: async () => j });
    const bad = () => ({ ok: false, status: 500, json: async () => ({}) });
    if (u.includes('api.gold-api.com')) return failMetals ? bad() : ok({ price: u.endsWith('XAU') ? xau : xag, updatedAt: new Date().toISOString() });
    if (u.includes('open.er-api.com')) return ok({ rates: { INR: fx }, time_last_update_unix: Math.floor(Date.now() / 1000) });
    if (u.includes('yahoo')) {
      if (failYahoo) return bad();
      const sym = decodeURIComponent(u.split('/chart/')[1].split('?')[0]);
      if (u.includes('interval=1m')) return ok({ chart: { result: [{ meta: { regularMarketPrice: sym === 'GC=F' ? xau : sym === 'SI=F' ? xag : fx, regularMarketTime: Date.now() / 1000 } }] } });
      const base = sym === 'GC=F' ? xau : sym === 'SI=F' ? xag : fx;
      return ok({ chart: { result: [{ meta: { exchangeTimezoneName: sym === 'INR=X' ? 'Europe/London' : 'America/New_York' }, timestamp: dayTs, indicators: { quote: [{ close: series(base) }] } }] } });
    }
    return bad();
  };
  fn.calls = calls;
  return fn;
}
