const DB_NAME = 'hvat-training';
const DB_VERSION = 1;
const STORES = ['templates', 'workouts', 'manualRecords', 'meta'];

let dbPromise;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

async function request(storeName, method, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, method === 'getAll' || method === 'get' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore(storeName);
    const operation = store[method](value);
    let result;
    operation.onsuccess = () => { result = operation.result; };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export const getAll = (store) => request(store, 'getAll');
export const put = (store, value) => request(store, 'put', value);
export const remove = (store, id) => request(store, 'delete', id);
export async function getMeta(id, fallback = null) {
  return (await request('meta', 'get', id))?.value ?? fallback;
}
export const setMeta = (id, value) => put('meta', { id, value });

export async function finishWorkout(workout) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['workouts', 'meta'], 'readwrite');
    tx.objectStore('workouts').put(workout);
    tx.objectStore('meta').put({ id: 'active', value: null });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function readAll() {
  const [templates, workouts, manualRecords, active, settings] = await Promise.all([
    getAll('templates'), getAll('workouts'), getAll('manualRecords'),
    getMeta('active'), getMeta('settings', { sound: true }),
  ]);
  return { templates, workouts, manualRecords, active, settings };
}

export async function mergeBackup(data) {
  const local = await readAll();
  const storedSettings = await getMeta('settings');
  const incoming = {};
  const counts = {};
  for (const store of ['templates', 'workouts', 'manualRecords']) {
    const seen = new Set(local[store].map((item) => item.id));
    incoming[store] = data[store].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    counts[store] = incoming[store].length;
  }
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');
    for (const store of ['templates', 'workouts', 'manualRecords']) {
      for (const item of incoming[store]) tx.objectStore(store).add(item);
    }
    if (!local.active && data.active) tx.objectStore('meta').put({ id: 'active', value: data.active });
    if (!storedSettings) tx.objectStore('meta').put({ id: 'settings', value: data.settings });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return { ...counts, active: !local.active && !!data.active };
}
