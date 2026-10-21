// One encrypted JSON value per slot, in its own IndexedDB database, under a
// non-extractable AES-GCM key kept next to it. Encryption here is defence in
// depth: it stops casual inspection of browser storage, not code running on this
// origin (see the learned-corrections spec, T1/T2).

export class SecureStoreError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? code);
    this.name = 'SecureStoreError';
    this.code = code; // 'unavailable' | 'unreadable' | 'unsupported' | 'blocked'
  }
}

const MESSAGES = {
  unavailable: 'Browser storage is not available',
  unreadable: 'Stored data could not be read',
  unsupported: 'Stored data was written by a newer version',
  blocked: 'Storage is in use by another tab',
};

const VERSION = 1;
const BLOCKED_TIMEOUT_MS = 3000;
const encoder = new TextEncoder();
const isArrayBuffer = (x) => Object.prototype.toString.call(x) === '[object ArrayBuffer]';
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

export function openSecureStore(slot, options = {}) {
  const backend = 'backend' in options
    ? options.backend
    : typeof indexedDB === 'undefined' ? null : indexedDbBackend(`transcriber-secure-${slot}`);
  const subtle = 'subtle' in options ? options.subtle : globalThis.crypto?.subtle;
  const randomBytes = options.randomBytes ?? ((n) => crypto.getRandomValues(new Uint8Array(n)));
  // A record moved to another slot or version fails authentication.
  const aad = encoder.encode(`transcriber:secureStore:${slot}:v${VERSION}`);
  const deferredClear = new Set();
  let key = null; // the only cache; dropped whenever another tab deletes or upgrades
  let persistAsked = false;

  backend?.onVersionChange(() => { key = null; });

  function ready() {
    if (!backend || !subtle) throw new SecureStoreError('unavailable');
  }

  async function read(name) {
    try {
      return await backend.read(name);
    } catch (err) {
      throw err instanceof SecureStoreError ? err : new SecureStoreError('unreadable');
    }
  }

  async function getKey({ create }) {
    if (key) return key;
    let k = await read('key');
    if (!k && create) {
      // generateKey is async, so it can't run inside the IndexedDB transaction.
      // If another tab stored a key meanwhile, use theirs.
      const fresh = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      try {
        await backend.add('key', fresh);
        k = fresh;
      } catch (err) {
        if (err?.name !== 'ConstraintError') throw err instanceof SecureStoreError ? err : new SecureStoreError('unavailable');
        k = await read('key');
      }
    }
    if (k) key = k;
    return k ?? null;
  }

  return {
    async get() {
      ready();
      const rec = await read('data');
      if (rec === undefined || rec === null) return null;
      if (typeof rec !== 'object' || typeof rec.v !== 'number') throw new SecureStoreError('unreadable');
      // Checked before decrypting: a newer record's AAD would not match anyway.
      if (rec.v > VERSION) throw new SecureStoreError('unsupported');
      if (rec.v !== VERSION || !(rec.iv instanceof Uint8Array) || rec.iv.length !== 12 || !isArrayBuffer(rec.ct)) {
        throw new SecureStoreError('unreadable');
      }
      const k = await getKey({ create: false });
      if (!k) throw new SecureStoreError('unreadable');
      let value;
      try {
        const plain = await subtle.decrypt({ name: 'AES-GCM', iv: rec.iv, additionalData: aad }, k, rec.ct);
        value = JSON.parse(new TextDecoder().decode(plain));
      } catch {
        throw new SecureStoreError('unreadable');
      }
      return { value, rev: `${slot}:${toBase64(rec.iv)}:${rec.ct.byteLength}` };
    },

    async set(value) {
      ready();
      const k = await getKey({ create: true });
      const iv = randomBytes(12);
      const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, k, encoder.encode(JSON.stringify(value)));
      await backend.put('data', { v: VERSION, iv, ct });
      if (!persistAsked) {
        persistAsked = true;
        globalThis.navigator?.storage?.persist?.()?.catch?.(() => {});
      }
    },

    // Deletes the database and its key. Rejects with 'blocked' if another tab
    // holds it for 3 s; the delete still completes when that tab lets go, and
    // onDeferredClear callbacks run then.
    clear() {
      ready();
      key = null;
      return new Promise((resolve, reject) => {
        let timer = null, settled = false;
        const onBlocked = () => {
          if (timer || settled) return;
          timer = setTimeout(() => { settled = true; reject(new SecureStoreError('blocked')); }, BLOCKED_TIMEOUT_MS);
        };
        backend.destroy({ onBlocked }).then(() => {
          clearTimeout(timer);
          key = null;
          if (settled) deferredClear.forEach((cb) => cb());
          else { settled = true; resolve(); }
        }, () => {
          clearTimeout(timer);
          if (!settled) { settled = true; reject(new SecureStoreError('unavailable')); }
        });
      });
    },

    onDeferredClear(cb) {
      deferredClear.add(cb);
      return () => deferredClear.delete(cb);
    },
  };
}

// The IndexedDB side: one database, one 'kv' object store. Opened lazily, and
// closed as soon as another connection wants to delete or upgrade it, so this tab
// never blocks another tab's Clear all. Covered by manual checks, not unit tests.
export function indexedDbBackend(dbName) {
  let db = null, opening = null;
  const versionChange = new Set();

  function open() {
    if (db) return Promise.resolve(db);
    opening ??= new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(dbName, 1);
      } catch {
        reject(new SecureStoreError('unavailable'));
        return;
      }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => {
        db = req.result;
        db.onversionchange = () => {
          db.close();
          db = null;
          versionChange.forEach((cb) => cb());
        };
        resolve(db);
      };
      req.onerror = () => reject(new SecureStoreError('unavailable'));
    }).finally(() => { opening = null; });
    return opening;
  }

  const run = (mode, fn) => open().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error ?? req.error);
  }));

  return {
    read: (name) => run('readonly', (s) => s.get(name)),
    add: (name, value) => run('readwrite', (s) => s.add(value, name)),
    put: (name, value) => run('readwrite', (s) => s.put(value, name)),
    destroy({ onBlocked }) {
      if (db) { db.close(); db = null; }
      return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => onBlocked?.();
      });
    },
    onVersionChange(cb) { versionChange.add(cb); },
  };
}
