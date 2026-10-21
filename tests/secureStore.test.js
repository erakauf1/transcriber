// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { openSecureStore, SecureStoreError, sealWithPassphrase, openWithPassphrase } from '../src/secureStore.js';
import { memoryBackend } from './helpers/memoryBackend.js';

const subtle = webcrypto.subtle;
const open = (backend = memoryBackend(), slot = 'corrections') => openSecureStore(slot, { backend, subtle });
const code = async (p) => { try { await p; return 'ok'; } catch (err) { return err instanceof SecureStoreError ? err.code : err; } };

afterEach(() => vi.useRealTimers());

describe('openSecureStore', () => {
  it('round-trips a JSON value', async () => {
    const store = open();
    await store.set({ rules: ['רעננה'] });
    expect((await store.get()).value).toEqual({ rules: ['רעננה'] });
  });

  it('stores no plaintext and a non-extractable key', async () => {
    const backend = memoryBackend();
    await open(backend).set({ secret: 'kohen-kahana' });
    const rec = backend.shared.map.get('data');
    expect(Object.keys(rec).sort()).toEqual(['ct', 'iv', 'v']);
    expect(Buffer.from(rec.ct).toString('latin1')).not.toContain('kohen');
    expect(backend.shared.map.get('key').extractable).toBe(false);
  });

  it('uses a fresh IV for every write, and rev follows the record', async () => {
    const backend = memoryBackend();
    const store = open(backend);
    await store.set({ n: 1 });
    const iv1 = backend.shared.map.get('data').iv;
    const rev1 = (await store.get()).rev;
    expect((await store.get()).rev).toBe(rev1);
    await store.set({ n: 1 });
    expect(backend.shared.map.get('data').iv).not.toEqual(iv1);
    expect((await store.get()).rev).not.toBe(rev1);
  });

  it('reads null when nothing is stored, including a key without data', async () => {
    const backend = memoryBackend();
    expect(await open(backend).get()).toBeNull();
    backend.shared.map.set('key', await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    expect(await open(backend).get()).toBeNull();
  });

  it.each([
    ['a flipped ciphertext byte', (m) => { const r = m.get('data'); const ct = new Uint8Array(r.ct.slice(0)); ct[0] ^= 1; m.set('data', { ...r, ct: ct.buffer }); }],
    ['a flipped IV byte', (m) => { const r = m.get('data'); const iv = r.iv.slice(); iv[0] ^= 1; m.set('data', { ...r, iv }); }],
    ['a missing key', (m) => m.delete('key')],
    ['a malformed record', (m) => m.set('data', { v: 1, iv: 'x', ct: 'y' })],
  ])('reports %s as unreadable', async (_label, tamper) => {
    const backend = memoryBackend();
    await open(backend).set({ n: 1 });
    tamper(backend.shared.map);
    expect(await code(open(backend).get())).toBe('unreadable');
  });

  it('reports a key that fails to deserialise as unreadable', async () => {
    const backend = memoryBackend();
    await open(backend).set({ n: 1 });
    const again = memoryBackend(backend.shared);
    again.handle.failRead = (name) => name === 'key';
    expect(await code(open(again).get())).toBe('unreadable');
  });

  it("rejects another slot's record (AAD)", async () => {
    const backend = memoryBackend();
    await open(backend, 'apikeys').set({ n: 1 });
    expect(await code(open(backend, 'corrections').get())).toBe('unreadable');
  });

  it('reports a newer record version as unsupported', async () => {
    const backend = memoryBackend();
    await open(backend).set({ n: 1 });
    backend.shared.map.set('data', { ...backend.shared.map.get('data'), v: 2 });
    expect(await code(open(backend).get())).toBe('unsupported');
  });

  it('is unavailable without a backend or WebCrypto', async () => {
    expect(await code(openSecureStore('x', { backend: null, subtle }).get())).toBe('unavailable');
    expect(await code(openSecureStore('x', { backend: memoryBackend(), subtle: undefined }).set({}))).toBe('unavailable');
  });

  it('reuses the key another tab stored first', async () => {
    const a = memoryBackend();
    const b = memoryBackend(a.shared);
    await Promise.all([open(a).set({ from: 'a' }), open(b).set({ from: 'b' })]);
    const value = (await open(memoryBackend(a.shared)).get()).value;
    expect(['a', 'b']).toContain(value.from);
  });

  it('clear() closes its own connection, then deletes key and data', async () => {
    const backend = memoryBackend();
    const store = open(backend);
    await store.set({ n: 1 });
    await store.clear();
    expect(backend.handle.destroyCalls).toBe(1);
    expect(backend.shared.map.size).toBe(0);
    expect(await store.get()).toBeNull();
    await store.set({ n: 2 });
    expect((await store.get()).value).toEqual({ n: 2 });
  });

  it("drops its key when another tab deletes the database, so it never reuses it", async () => {
    const a = memoryBackend(), b = memoryBackend(a.shared);
    const storeA = open(a), storeB = open(b);
    await storeA.set({ n: 1 });
    expect((await storeB.get()).value).toEqual({ n: 1 });
    await storeA.clear();
    expect(await storeB.get()).toBeNull();
    await storeB.set({ n: 2 });
    expect((await storeA.get()).value).toEqual({ n: 2 });
  });

  it("rejects 'blocked' after 3 s, then reports the deferred delete", async () => {
    vi.useFakeTimers();
    const a = memoryBackend(), b = memoryBackend(a.shared);
    const storeA = open(a);
    await storeA.set({ n: 1 });
    await b.read('data');
    b.handle.stuck = true;
    const deferred = vi.fn();
    storeA.onDeferredClear(deferred);
    const result = code(storeA.clear());
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe('blocked');
    expect(deferred).not.toHaveBeenCalled();
    a.shared.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(deferred).toHaveBeenCalledOnce();
    expect(a.shared.map.size).toBe(0);
  });
});

describe('key cache across a clear', () => {
  it('never re-caches a key read before a clear that finished first', async () => {
    const backend = memoryBackend();
    await open(backend).set({ n: 1 });
    const store = open(backend);
    // Hold the key read until the clear has run.
    let release;
    const gate = new Promise((r) => { release = r; });
    const read = backend.read.bind(backend);
    backend.read = async (name) => { const v = await read(name); if (name === 'key') { await gate; backend.read = read; } return v; };
    const pending = store.get().catch(() => null);
    await new Promise((r) => setTimeout(r, 0));
    await store.clear();
    release();
    await pending;
    await store.set({ n: 2 });
    expect(backend.shared.map.has('key')).toBe(true);
    expect((await open(backend).get()).value).toEqual({ n: 2 });
  });
});

describe('passphrase envelope', () => {
  const fast = { subtle, iterations: 1000 };
  const bounds = { subtle, minIterations: 1000, maxIterations: 5000 };

  it('round-trips with the right passphrase', async () => {
    const env = await sealWithPassphrase({ rules: ['כהן'] }, 'correct horse battery', fast);
    expect(Object.keys(env).sort()).toEqual(['ct', 'format', 'iv', 'kdf', 'salt', 'v']);
    expect(await openWithPassphrase(env, 'correct horse battery', bounds)).toEqual({ rules: ['כהן'] });
  });

  it('fails with the same error for a wrong passphrase and a tampered file', async () => {
    const env = await sealWithPassphrase({ n: 1 }, 'correct horse battery', fast);
    const wrong = await openWithPassphrase(env, 'wrong horse battery', bounds).catch((e) => e.message);
    const ct = Buffer.from(env.ct, 'base64'); ct[0] ^= 1;
    const tampered = await openWithPassphrase({ ...env, ct: ct.toString('base64') }, 'correct horse battery', bounds).catch((e) => e.message);
    expect(wrong).toBe('Not a valid learned-fixes file, or wrong passphrase');
    expect(tampered).toBe(wrong);
  });

  it('defaults to 600,000 iterations and refuses fewer', async () => {
    const env = await sealWithPassphrase({ n: 1 }, 'correct horse battery', { subtle });
    expect(env.kdf).toEqual({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 });
    const weak = await sealWithPassphrase({ n: 1 }, 'correct horse battery', fast);
    await expect(openWithPassphrase(weak, 'correct horse battery', { subtle })).rejects.toThrow();
  });

  it('checks the iteration bounds before running the KDF', async () => {
    const env = await sealWithPassphrase({ n: 1 }, 'pw-pw-pw-pw', fast);
    const spy = { ...subtle, importKey: vi.fn(subtle.importKey.bind(subtle)), deriveKey: vi.fn(), decrypt: subtle.decrypt.bind(subtle) };
    const huge = { ...env, kdf: { ...env.kdf, iterations: 1e9 } };
    await expect(openWithPassphrase(huge, 'pw-pw-pw-pw', { subtle: spy })).rejects.toThrow();
    expect(spy.deriveKey).not.toHaveBeenCalled();
  });

  it.each([
    ['an extra key', (e) => ({ ...e, extra: 1 })],
    ['a wrong format', (e) => ({ ...e, format: 'other' })],
    ['a wrong kdf', (e) => ({ ...e, kdf: { ...e.kdf, hash: 'SHA-1' } })],
    ['an extra kdf key', (e) => ({ ...e, kdf: { ...e.kdf, salt: 'x' } })],
    ['a short salt', (e) => ({ ...e, salt: 'AAAA' })],
    ['a 16-byte IV', (e) => ({ ...e, iv: Buffer.alloc(16).toString('base64') })],
    ['non-canonical base64', (e) => ({ ...e, iv: e.iv.replace(/=*$/, '') + '!' })],
    ['a too-short ciphertext', (e) => ({ ...e, ct: Buffer.alloc(8).toString('base64') })],
    ['not an object', () => 'nope'],
  ])('rejects %s', async (_label, mutate) => {
    const env = await sealWithPassphrase({ n: 1 }, 'pw-pw-pw-pw', fast);
    await expect(openWithPassphrase(mutate(env), 'pw-pw-pw-pw', bounds)).rejects.toThrow('Not a valid learned-fixes file');
  });
});
