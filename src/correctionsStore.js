import { openSecureStore, SecureStoreError, sealWithPassphrase, openWithPassphrase } from './secureStore.js';
import { validateDocument, isLearnableRule, checkRuleSet, ruleKey, MAX_RULES } from './corrections.js';

export class RuleConflictError extends Error {
  constructor(conflict) {
    super(`Conflicts with ‘${conflict.from} → ${conflict.to}’`);
    this.name = 'RuleConflictError';
    this.conflict = conflict;
  }
}

export class StoreResetRequired extends Error {
  constructor() {
    super("Learned fixes on this device can't be read");
    this.name = 'StoreResetRequired';
  }
}

const emptyDoc = () => ({ v: 1, rules: [], examples: [] });
const MAX_COUNT = 1_000_000;
const LOCK_NAME = 'transcriber-corrections';
export const MAX_EXPORT_BYTES = 262_144;
const invalidFile = () => new Error('Not a valid learned-fixes file, or wrong passphrase');
const later = (a, b) => (a > b ? a : b);

// The learned-fixes document: { v: 1, rules: [{ from, to, language, count,
// createdAt, lastUsedAt }], examples: [] }. Every operation decrypts from storage
// (no document cache), so another tab's delete or Clear all is never undone by
// this tab writing a stale copy back.
export function createCorrectionsStore({
  store,
  today = () => new Date().toISOString().slice(0, 10),
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('transcriber-corrections') : null,
  locks = globalThis.navigator?.locks,
  subtle,
  randomBytes,
  passphrase: kdfOptions = {}, // tests only: lower PBKDF2 iteration bounds
} = {}) {
  const listeners = new Set();
  let validated = null; // { rev, result }: the stored-mode verdict for one record
  let queue = Promise.resolve();

  const notifyHere = () => listeners.forEach((cb) => { try { cb(); } catch { /* a listener's bug is not ours */ } });
  const notify = () => {
    notifyHere();
    try { channel?.postMessage('changed'); } catch { /* closed channel */ }
  };
  // The message carries no data; it only says "read again".
  if (channel) channel.onmessage = notifyHere;
  store.onDeferredClear?.(notify);

  // One read-modify-write at a time in this tab, and across tabs where the Web
  // Locks API exists.
  function serial(fn) {
    const run = queue.then(() => (locks?.request ? locks.request(LOCK_NAME, fn) : fn()));
    queue = run.catch(() => {});
    return run;
  }

  async function read() {
    let got;
    try {
      got = await store.get();
    } catch (err) {
      const status = err?.code === 'unsupported' || err?.code === 'unavailable' ? err.code : 'unreadable';
      return { status, doc: null, dropped: 0 };
    }
    if (!got) return { status: 'empty', doc: emptyDoc(), dropped: 0 };
    if (validated?.rev === got.rev) return validated.result;
    const v = validateDocument(got.value, { mode: 'stored' });
    if (!v.ok) return { status: v.unsupported ? 'unsupported' : 'unreadable', doc: null, dropped: 0 };
    const result = { status: 'ok', doc: v.doc, dropped: v.dropped };
    validated = { rev: got.rev, result };
    return result;
  }

  // The document a write starts from. An unreadable store is replaced only when
  // the user said so; an unsupported one (written by a newer version) never is.
  async function writableDoc({ confirmReset = false } = {}) {
    const r = await read();
    if (r.status === 'unsupported' || r.status === 'unavailable') throw new SecureStoreError(r.status);
    if (r.status === 'unreadable') {
      if (!confirmReset) throw new StoreResetRequired();
      await store.clear();
      return emptyDoc();
    }
    return r.doc;
  }

  async function write(rules) {
    await store.set({ v: 1, rules, examples: [] });
    notify();
  }

  return {
    async loadState() {
      // After this tab's pending writes, so a read never misses its own save.
      const r = await queue.then(read).catch(() => ({ status: 'unavailable', doc: null, dropped: 0 }));
      return {
        rules: r.doc?.rules ?? [],
        unavailable: r.status === 'unavailable',
        unreadable: r.status === 'unreadable',
        unsupported: r.status === 'unsupported',
        dropped: r.dropped,
      };
    },

    saveRule({ from, to, language }, { confirmReset = false } = {}) {
      return serial(async () => {
        if (!isLearnableRule({ from, to, language })) throw new Error('This fix cannot be learned');
        const doc = await writableDoc({ confirmReset });
        // Saving what is already there (a double tap, or another tab saving the
        // same chip) keeps the rule's count and dates.
        if (doc.rules.some((r) => r.language === language && r.from === from && r.to === to)) {
          return { rules: doc.rules, evicted: null, replaced: null };
        }
        let replaced = null;
        let rules = doc.rules.filter((r) => {
          if (r.language === language && r.from === from) { replaced = r; return false; }
          // The reverse rule: the user changed their mind.
          return !(r.from === to && r.to === from);
        });
        const day = today();
        const saved = { from, to, language, count: 1, createdAt: day, lastUsedAt: day };
        const check = checkRuleSet([...rules, saved]);
        if (!check.ok) {
          const [a, b] = check.conflicts.find(([x, y]) => x === saved || y === saved);
          throw new RuleConflictError(a === saved ? b : a);
        }
        let evicted = null;
        if (rules.length >= MAX_RULES) {
          evicted = [...rules].sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt) || a.count - b.count)[0];
          rules = rules.filter((r) => r !== evicted);
        }
        rules = [...rules, saved];
        await write(rules);
        return { rules, evicted, replaced };
      });
    },

    deleteRule({ from, language }) {
      return serial(async () => {
        const doc = await writableDoc();
        const rules = doc.rules.filter((r) => !(r.language === language && r.from === from));
        if (rules.length !== doc.rules.length) await write(rules);
        return rules;
      });
    },

    // Fire-and-forget: a hit count is never worth an error.
    recordHits(hitRules) {
      serial(async () => {
        const r = await read();
        if (r.status !== 'ok') return;
        const hits = new Map(hitRules.map((h) => [ruleKey(h), h.to]));
        const day = today();
        let changed = false;
        const rules = r.doc.rules.map((rule) => {
          if (hits.get(ruleKey(rule)) !== rule.to) return rule;
          changed = true;
          return { ...rule, count: Math.min(rule.count + 1, MAX_COUNT), lastUsedAt: day };
        });
        if (changed) await write(rules);
      }).catch(() => {});
    },

    clearAll() {
      return serial(async () => {
        await store.clear();
        validated = null;
        notify();
      });
    },

    // Always passphrase-encrypted: the file travels (AirDrop, iCloud Drive, mail).
    async exportFixes(passphrase) {
      const r = await queue.then(read);
      if (r.status !== 'ok' && r.status !== 'empty') throw new SecureStoreError(r.status);
      const envelope = await sealWithPassphrase(r.doc, passphrase, { subtle, randomBytes, ...kdfOptions });
      const json = JSON.stringify(envelope);
      if (json.length > MAX_EXPORT_BYTES) throw new Error('Too many learned fixes to export');
      return new File([json], `voicenote-learned-fixes-${today()}.json`, { type: 'application/json' });
    },

    // All-or-nothing validation, then a merge in which the local list wins.
    async importFixes(file, passphrase, { confirmReset = false, signal } = {}) {
      if (!file || file.size > MAX_EXPORT_BYTES) throw invalidFile();
      let envelope;
      try {
        envelope = JSON.parse(await file.text());
      } catch {
        throw invalidFile();
      }
      const value = await openWithPassphrase(envelope, passphrase, { subtle, ...kdfOptions });
      const incoming = validateDocument(value, { mode: 'import' });
      if (!incoming.ok) throw invalidFile();
      return serial(async () => {
        // Cancelled while decrypting: nothing is written.
        if (signal?.aborted) throw new Error('Import cancelled');
        const doc = await writableDoc({ confirmReset });
        const rules = [...doc.rules];
        const added = [], skipped = [];
        let updated = 0;
        // Highest count first, so a full list skips the least used.
        for (const rule of [...incoming.doc.rules].sort((a, b) => b.count - a.count)) {
          const i = rules.findIndex((r) => ruleKey(r) === ruleKey(rule));
          if (i >= 0) {
            const local = rules[i];
            if (local.to !== rule.to) { skipped.push({ rule, reason: 'conflict' }); continue; }
            const merged = { ...local, count: Math.max(local.count, rule.count), lastUsedAt: later(local.lastUsedAt, rule.lastUsedAt) };
            if (merged.count !== local.count || merged.lastUsedAt !== local.lastUsedAt) { rules[i] = merged; updated++; }
            continue;
          }
          if (rules.length >= MAX_RULES) { skipped.push({ rule, reason: 'full' }); continue; }
          if (!checkRuleSet([...rules, rule]).ok) { skipped.push({ rule, reason: 'conflict' }); continue; }
          rules.push(rule);
          added.push(rule);
        }
        if (added.length || updated) await write(rules);
        return { added, updated, skipped };
      });
    },

    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

let instance = null;

export function correctionsStore() {
  instance ??= createCorrectionsStore({ store: openSecureStore('corrections') });
  return instance;
}
