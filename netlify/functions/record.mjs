// Scheduled function: records price revisions every 10 minutes even when nobody is visiting the site.
import { createStore } from '../../lib/store.mjs';
import { getSnapshot } from '../../lib/service.mjs';

export default async () => {
  const store = await createStore();
  try {
    const s = await getSnapshot({ store });
    return new Response(`ok ${s.asOf}`);
  } catch (e) {
    return new Response(`failed: ${e.message}`, { status: 500 });
  }
};
export const config = { schedule: '*/10 * * * *' };
