// Tiny key-value store: Netlify Blobs in production, in-memory fallback (local tests / blobs unavailable).
const mem = (globalThis.__goldMem ??= new Map());

export async function createStore() {
  let blob = null;
  try {
    const { getStore } = await import('@netlify/blobs');
    blob = getStore({ name: 'gold-rates', consistency: 'strong' });
  } catch { blob = null; }
  return {
    async get(key) {
      if (blob) { try { return await blob.get(key, { type: 'json' }); } catch { /* fall through */ } }
      return mem.get(key) ?? null;
    },
    async set(key, value) {
      if (blob) { try { await blob.setJSON(key, value); return; } catch { /* fall through */ } }
      mem.set(key, value);
    },
  };
}

export function memoryStore() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, structuredClone(v)); } };
}
