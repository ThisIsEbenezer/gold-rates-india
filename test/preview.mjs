// Local preview with MOCK data (no network): node test/preview.mjs  -> http://localhost:8888
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { memoryStore } from '../lib/store.mjs';
import { getSnapshot, getDailySeries } from '../lib/service.mjs';
import { readToday } from '../lib/tracker.mjs';
import { getConfig } from '../lib/config.mjs';
import { mockFetch } from './helpers.mjs';
const store = memoryStore(); const cfg = getConfig({}); const f = mockFetch({ xau: 4000 });
const now0 = new Date(process.env.NOW || Date.now());
// seed a few revisions on a "Monday"
if (process.env.NOW) { for (const [h, x] of [['05:00', 4000], ['07:10', 4030], ['09:40', 4012], ['12:20', 4055]]) await getSnapshot({ fetchImpl: mockFetch({ xau: x }), store, now: new Date(`${process.env.NOW.slice(0, 10)}T${h}:00Z`), cfg }); }
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  const send = (j) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j)); };
  if (req.url === '/api/rates') return send(await getSnapshot({ fetchImpl: f, store, now: now0, cfg }));
  if (req.url === '/api/history') { const seed = await getDailySeries(f, cfg, now0); return send({ today: await readToday({ store, now: now0 }), daily: seed.filter((r) => ![0, 6].includes(new Date(r.date + 'T12:00Z').getUTCDay())).slice(-30) }); }
  const p = path.join('public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', mime[path.extname(p)] || 'text/plain'); res.end(fs.readFileSync(p));
}).listen(8888, () => console.log('http://localhost:8888'));
