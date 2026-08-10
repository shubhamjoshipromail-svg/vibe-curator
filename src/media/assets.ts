/**
 * Binary generated/uploaded assets belong in IndexedDB, not localStorage.
 * Presets only retain small metadata plus the asset id.
 */

const DB_NAME = 'vibe-media-v1';
const STORE = 'assets';
const urls = new Map<string, string>();

interface StoredAsset {
  id: string;
  blob: Blob;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function storeAsset(blob: Blob, prefix = 'asset'): Promise<string> {
  const id = `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, blob, createdAt: new Date().toISOString() } satisfies StoredAsset);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return id;
}

export async function getAsset(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  const result = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as StoredAsset | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result?.blob;
}

export async function assetUrl(id: string): Promise<string | undefined> {
  const cached = urls.get(id);
  if (cached) return cached;
  const blob = await getAsset(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function deleteAsset(id: string): Promise<void> {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
