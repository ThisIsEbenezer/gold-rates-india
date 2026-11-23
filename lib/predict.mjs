// Short-horizon statistical estimate. Deliberately simple and honest: daily gold/silver moves are
// close to a random walk, so we shrink momentum heavily and show a volatility range instead of a point "call".

const erf = (x) => {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
};
export const normCdf = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

/** closes: oldest -> newest daily closes (INR). Returns estimate for the NEXT trading day. */
export function forecast(closes, { shrink = 0.25, lambda = 0.94 } = {}) {
  const c = closes.filter((x) => Number.isFinite(x) && x > 0);
  if (c.length < 8) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));

  // EWMA volatility (RiskMetrics style)
  let v = mean(rets.slice(0, Math.min(10, rets.length)).map((r) => r * r));
  for (const r of rets) v = lambda * v + (1 - lambda) * r * r;
  const sigma = Math.sqrt(v);

  // Blend of short and medium momentum, shrunk toward zero
  const short = mean(rets.slice(-5));
  const medium = mean(rets.slice(-20));
  let mu = shrink * (0.5 * short + 0.5 * medium);
  mu = Math.max(-sigma, Math.min(sigma, mu)); // never claim more than 1 sigma of drift

  const last = c[c.length - 1];
  const at = (z) => last * Math.exp(mu + z * sigma);
  const probUp = normCdf(mu / sigma);
  const trend = probUp > 0.55 ? 'up' : probUp < 0.45 ? 'down' : 'flat';
  return {
    last,
    expected: at(0),
    low: at(-1),   // ~68% range
    high: at(1),
    muPct: mu * 100,
    sigmaPct: sigma * 100,
    probUp,
    trend,
    sample: c.length,
  };
}
