// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { openSecureStore } from '../src/secureStore.js';
import { createCorrectionsStore, RuleConflictError, StoreResetRequired } from '../src/correctionsStore.js';
import { ruleLanguage, MAX_RULES } from '../src/corrections.js';
import { memoryBackend } from './helpers/memoryBackend.js';

const subtle = webcrypto.subtle;
const R = (from, to) => ({ from, to, language: ruleLanguage(from) });

function setup({ backend = memoryBackend(), channel = null, locks = null, day = '2026-10-21' } = {}) {
  const secure = openSecureStore('corrections', { backend, subtle });
  const store = createCorrectionsStore({ store: secure, channel, locks, today: () => day });
  return { backend, secure, store };
}

function channelPair() {
  const a = { onmessage: null, postMessage: (m) => queueMicrotask(() => b.onmessage?.({ data: m })) };
  const b = { onmessage: null, postMessage: (m) => queueMicrotask(() => a.onmessage?.({ data: m })) };
  return [a, b];
}

const distinctRules = (n) => Array.from({ length: n }, (_, i) => {
  const w = [...i.toString(26).padStart(3, '0')].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('');
  return R(`q${w}x`, `Q${w}y`);
});

describe('correctionsStore', () => {
  it('saves a rule with count 1 and day-precision dates', async () => {
    const { store } = setup();
    await store.saveRule(R('כהן', 'כהנא'));
    expect((await store.loadState()).rules).toEqual([
      { from: 'כהן', to: 'כהנא', language: 'he', count: 1, createdAt: '2026-10-21', lastUsedAt: '2026-10-21' },
    ]);
  });

  it('replaces a same-from rule and removes the reverse rule', async () => {
    const { store } = setup();
    await store.saveRule(R('jira', 'Jira'));
    const { replaced } = await store.saveRule(R('jira', 'JIRA'));
    expect(replaced.to).toBe('Jira');
    await store.saveRule(R('כהן', 'כהנא'));
    await store.saveRule(R('כהנא', 'כהן'));
    expect((await store.loadState()).rules.map((r) => `${r.from}→${r.to}`)).toEqual(['jira→JIRA', 'כהנא→כהן']);
  });

  it('throws RuleConflictError naming the existing rule', async () => {
    const { store } = setup();
    await store.saveRule(R('York City', 'NYC'));
    const err = await store.saveRule(R('New', 'York')).catch((e) => e);
    expect(err).toBeInstanceOf(RuleConflictError);
    expect(err.message).toBe('Conflicts with ‘York City → NYC’');
    expect(err.conflict.from).toBe('York City');
  });

  it('refuses rules that fail the shared gate', async () => {
    const { store } = setup();
    await expect(store.saveRule(R('דן', 'רן'))).rejects.toThrow();
  });

  it('evicts the least recently used rule at MAX_RULES', async () => {
    const { secure, store } = setup();
    const rules = distinctRules(MAX_RULES).map((r, i) => ({ ...r, count: 1, createdAt: '2026-01-01', lastUsedAt: i === 7 ? '2026-01-01' : '2026-05-01' }));
    await secure.set({ v: 1, rules, examples: [] });
    const { evicted, rules: after } = await store.saveRule(R('כהן', 'כהנא'));
    expect(evicted.from).toBe(rules[7].from);
    expect(after).toHaveLength(MAX_RULES);
  });

  it('counts hits only on rules still present, and never on an empty store', async () => {
    const { secure, store } = setup({ day: '2026-10-22' });
    store.recordHits([R('jira', 'Jira')]);
    await store.loadState();
    expect(await secure.get()).toBeNull();
    await store.saveRule(R('jira', 'Jira'));
    store.recordHits([R('jira', 'Jira'), R('כהן', 'כהנא')]);
    const [rule] = (await store.loadState()).rules;
    expect(rule.count).toBe(2);
    expect((await store.loadState()).rules).toHaveLength(1);
  });

  it('loses no update under concurrent writes', async () => {
    const { store } = setup();
    await Promise.all(distinctRules(6).map((r) => store.saveRule(r)));
    expect((await store.loadState()).rules).toHaveLength(6);
  });

  it('runs each write inside the cross-tab lock when one exists', async () => {
    const locks = { request: vi.fn((_name, fn) => fn()) };
    const { store } = setup({ locks });
    await store.saveRule(R('jira', 'Jira'));
    expect(locks.request).toHaveBeenCalledWith('transcriber-corrections', expect.any(Function));
  });

  it('never brings back what another tab cleared or deleted', async () => {
    const a = setup(), b = setup({ backend: memoryBackend(a.backend.shared) });
    await a.store.saveRule(R('jira', 'Jira'));
    await a.store.saveRule(R('כהן', 'כהנא'));
    await b.store.loadState();
    await a.store.deleteRule(R('jira', 'Jira'));
    b.store.recordHits([R('jira', 'Jira')]);
    await b.store.saveRule(R('ann', 'Anna'));
    expect((await a.store.loadState()).rules.map((r) => r.from).sort()).toEqual(['ann', 'כהן']);
    await a.store.clearAll();
    b.store.recordHits([R('ann', 'Anna')]);
    await b.store.saveRule(R('dan', 'Dan'));
    expect((await a.store.loadState()).rules.map((r) => r.from)).toEqual(['dan']);
  });

  it('notifies on every write, here and in the other tab', async () => {
    const [ca, cb] = channelPair();
    const a = setup({ channel: ca }), b = setup({ backend: memoryBackend(), channel: cb });
    const here = vi.fn(), there = vi.fn();
    a.store.onChange(here);
    b.store.onChange(there);
    await a.store.saveRule(R('jira', 'Jira'));
    a.store.recordHits([R('jira', 'Jira')]);
    await a.store.loadState();
    await a.store.deleteRule(R('jira', 'Jira'));
    await a.store.clearAll();
    await new Promise((r) => setTimeout(r, 0));
    expect(here).toHaveBeenCalledTimes(4);
    expect(there).toHaveBeenCalledTimes(4);
  });

  it('notifies when a blocked Clear all completes later', async () => {
    vi.useFakeTimers();
    try {
      const a = setup(), other = memoryBackend(a.backend.shared);
      await a.store.saveRule(R('jira', 'Jira'));
      await other.read('data');
      other.handle.stuck = true;
      const changed = vi.fn();
      a.store.onChange(changed);
      const cleared = a.store.clearAll().catch((e) => e.code);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await cleared).toBe('blocked');
      a.backend.shared.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(changed).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never clears or writes an unsupported (newer) document', async () => {
    const { secure, store } = setup();
    await secure.set({ v: 2, rules: [], examples: [], future: true });
    expect((await store.loadState()).unsupported).toBe(true);
    await expect(store.saveRule(R('jira', 'Jira'), { confirmReset: true })).rejects.toMatchObject({ code: 'unsupported' });
    expect((await secure.get()).value.future).toBe(true);
  });

  it('asks before replacing an unreadable store', async () => {
    const first = setup();
    await first.store.saveRule(R('jira', 'Jira'));
    first.backend.shared.map.delete('key');
    const { store } = setup({ backend: memoryBackend(first.backend.shared) });
    expect((await store.loadState()).unreadable).toBe(true);
    await expect(store.saveRule(R('כהן', 'כהנא'))).rejects.toBeInstanceOf(StoreResetRequired);
    await store.saveRule(R('כהן', 'כהנא'), { confirmReset: true });
    expect((await store.loadState()).rules.map((r) => r.from)).toEqual(['כהן']);
  });

  it('loadState never throws', async () => {
    const store = createCorrectionsStore({ store: openSecureStore('x', { backend: null, subtle }), channel: null, locks: null });
    expect(await store.loadState()).toMatchObject({ rules: [], unavailable: true });
  });

  it('drops invalid stored rules and reports them', async () => {
    const { secure, store } = setup();
    const good = { ...R('jira', 'Jira'), count: 1, createdAt: '2026-10-21', lastUsedAt: '2026-10-21' };
    await secure.set({ v: 1, rules: [good, { ...good, from: 'j', to: 'J' }], examples: [] });
    expect(await store.loadState()).toMatchObject({ rules: [good], dropped: 1 });
  });

  it('caches validation per record revision, and only for readable records', async () => {
    const { secure } = setup();
    const good = { ...R('jira', 'Jira'), count: 1, createdAt: '2026-10-21', lastUsedAt: '2026-10-21' };
    await secure.set({ v: 1, rules: [good], examples: [] });
    const first = await secure.get();
    // A store whose get() returns the same revision with a different value shows
    // whether the cached verdict was used.
    let value = first.value;
    const fake = { get: async () => ({ value, rev: first.rev }), set: async () => {}, clear: async () => {} };
    const store = createCorrectionsStore({ store: fake, channel: null, locks: null });
    expect((await store.loadState()).rules).toHaveLength(1);
    value = { v: 1, rules: [], examples: [] };
    expect((await store.loadState()).rules).toHaveLength(1);
    const broken = createCorrectionsStore({ store: { get: async () => ({ value: 'junk', rev: 'r' }) }, channel: null, locks: null });
    expect((await broken.loadState()).unreadable).toBe(true);
    expect((await broken.loadState()).unreadable).toBe(true);
  });
});

describe('saving an existing rule', () => {
  it('keeps its count and dates', async () => {
    const { store } = setup();
    await store.saveRule(R('jira', 'Jira'));
    store.recordHits([R('jira', 'Jira')]);
    const again = await store.saveRule(R('jira', 'Jira'));
    expect(again.replaced).toBeNull();
    expect((await store.loadState()).rules[0].count).toBe(2);
  });
});
