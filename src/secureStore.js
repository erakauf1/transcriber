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

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Strict: canonical alphabet and padding only, so a crafted file can't smuggle
// anything past the length checks.
function fromBase64(text) {
  if (typeof text !== 'string' || text.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

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
  let generation = 0; // bumped on every drop, so a read that straddles one can't re-cache a dead key
  let persistAsked = false;
  const dropKey = () => { key = null; generation++; };

  backend?.onVersionChange(dropKey);

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
    const gen = generation;
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
    // A clear or another tab's delete happened meanwhile: what was read may be a
    // dead key, so read again from the database as it is now.
    if (gen !== generation) return getKey({ create });
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
      dropKey();
      return new Promise((resolve, reject) => {
        let timer = null, settled = false;
        const onBlocked = () => {
          if (timer || settled) return;
          timer = setTimeout(() => { settled = true; reject(new SecureStoreError('blocked')); }, BLOCKED_TIMEOUT_MS);
        };
        backend.destroy({ onBlocked }).then(() => {
          clearTimeout(timer);
          dropKey();
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

// ---------- passphrase envelope (export files) ----------

export const ENVELOPE_FORMAT = 'transcriber.learned-fixes';
const MAX_CIPHERTEXT = 256 * 1024;
const invalidFile = () => new Error('Not a valid learned-fixes file, or wrong passphrase');

async function passphraseKey(subtle, passphrase, salt, iterations) {
  const base = await subtle.importKey('raw', encoder.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const envelopeAad = (iterations) => encoder.encode(`${ENVELOPE_FORMAT}:1:${iterations}`);

export async function sealWithPassphrase(value, passphrase, {
  subtle = globalThis.crypto?.subtle,
  randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n)),
  iterations = 600_000,
} = {}) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await passphraseKey(subtle, passphrase, salt, iterations);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: envelopeAad(iterations) }, key, encoder.encode(JSON.stringify(value)));
  return {
    format: ENVELOPE_FORMAT,
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations },
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ct)),
  };
}

// Every failure (shape, bounds, wrong passphrase, tampering) is the same error:
// a wrong passphrase and a tampered file are deliberately indistinguishable.
export async function openWithPassphrase(envelope, passphrase, {
  subtle = globalThis.crypto?.subtle,
  minIterations = 600_000,
  maxIterations = 2_000_000,
} = {}) {
  const exact = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join() === keys;
  if (!exact(envelope, 'ct,format,iv,kdf,salt,v') || envelope.format !== ENVELOPE_FORMAT || envelope.v !== 1) throw invalidFile();
  const { kdf } = envelope;
  if (!exact(kdf, 'hash,iterations,name') || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') throw invalidFile();
  // Bounded before the KDF runs, so a crafted file can't hang the page.
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < minIterations || kdf.iterations > maxIterations) throw invalidFile();
  const salt = fromBase64(envelope.salt), iv = fromBase64(envelope.iv), ct = fromBase64(envelope.ct);
  if (salt?.length !== 16 || iv?.length !== 12 || !ct || ct.length < 16 || ct.length > MAX_CIPHERTEXT) throw invalidFile();
  if (typeof passphrase !== 'string') throw invalidFile();
  try {
    const key = await passphraseKey(subtle, passphrase, salt, kdf.iterations);
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: envelopeAad(kdf.iterations) }, key, ct);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw invalidFile();
  }
}
