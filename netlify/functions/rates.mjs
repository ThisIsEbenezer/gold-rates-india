import { createStore } from '../../lib/store.mjs';
import { getSnapshot } from '../../lib/service.mjs';

export default async () => {
  try {
    const store = await createStore();
    const data = await getSnapshot({ store });
    return Response.json(data, { headers: { 'cache-control': 'public, max-age=20', 'netlify-cdn-cache-control': 'public, s-maxage=30, stale-while-revalidate=60' } });
  } catch (e) {
    return Response.json({ error: e.message, details: e.details ?? [] }, { status: 502, headers: { 'cache-control': 'no-store' } });
  }
};
export const config = { path: '/api/rates' };
