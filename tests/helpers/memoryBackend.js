// A Map-backed stand-in for indexedDbBackend. Two handles on one `shared` act as
// two tabs: a destroy from one fires versionchange in the other, and a handle
// marked `stuck` ignores it, which blocks the delete until `release()`.
export function memoryBackend(shared = createShared()) {
  const handle = { open: false, stuck: false, onVersionChange: new Set(), failRead: null, destroyCalls: 0 };
  shared.handles.add(handle);
  const touch = () => { handle.open = true; };
  return {
    shared,
    handle,
    async read(name) {
      touch();
      if (handle.failRead?.(name)) throw new Error('DataError');
      return shared.map.get(name);
    },
    async add(name, value) {
      touch();
      if (shared.map.has(name)) {
        const err = new Error('Key already exists');
        err.name = 'ConstraintError';
        throw err;
      }
      shared.map.set(name, value);
    },
    async put(name, value) {
      touch();
      shared.map.set(name, value);
    },
    destroy({ onBlocked }) {
      handle.destroyCalls++;
      handle.open = false;
      const others = [...shared.handles].filter((h) => h !== handle && h.open);
      for (const h of others) {
        if (h.stuck) continue;
        h.open = false;
        h.onVersionChange.forEach((cb) => cb());
      }
      const finish = () => { shared.map.clear(); };
      if (others.some((h) => h.stuck)) {
        onBlocked?.();
        return new Promise((resolve) => { shared.pending.push(() => { finish(); resolve(); }); });
      }
      finish();
      return Promise.resolve();
    },
    onVersionChange(cb) { handle.onVersionChange.add(cb); },
  };
}

function createShared() {
  const shared = { map: new Map(), handles: new Set(), pending: [] };
  // The stuck tab finally closes: run any delete it was blocking.
  shared.release = () => {
    shared.handles.forEach((h) => { h.stuck = false; h.open = false; });
    shared.pending.splice(0).forEach((run) => run());
  };
  return shared;
}
