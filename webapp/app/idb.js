// A key–value store in IndexedDB for what is worth keeping between visits
// (the list of every track). Every failure — private mode, storage turned
// off, a full disk — reads as "nothing kept": callers fetch as before.
const DB = 'mstream-player';
const STORE = 'kv';
let opened = null;

function open() {
  if (!opened) {
    opened = new Promise((resolve) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
        r.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  return opened;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve) => {
    if (!db) { resolve(undefined); return; }
    try {
      const tx = db.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(r?.result);
      tx.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch (_) { resolve(undefined); }
  }));
}

export const idbGet = (key) => run('readonly', (s) => s.get(key));
export const idbSet = (key, value) => run('readwrite', (s) => s.put(value, key));
export const idbDelete = (key) => run('readwrite', (s) => s.delete(key));
