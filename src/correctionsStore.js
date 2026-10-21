import { openSecureStore, SecureStoreError } from './secureStore.js';
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

// The learned-fixes document: { v: 1, rules: [{ from, to, language, count,
// createdAt, lastUsedAt }], examples: [] }. Every operation decrypts from storage
// (no document cache), so another tab's delete or Clear all is never undone by
// this tab writing a stale copy back.
export function createCorrectionsStore({
  store,
  today = () => new Date().toISOString().slice(0, 10),
  channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('transcriber-corrections') : null,
  locks = globalThis.navigator?.locks,
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
