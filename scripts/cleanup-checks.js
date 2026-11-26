const tail = (s) => JSON.stringify(s.trimEnd().slice(-20));

const CHECKS = {
  endsWithPeriod: (out, on) => (on ? [{
    name: 'endsWithPeriod',
    ok: /[.!?]$/.test(out.trimEnd()),
    detail: `ends with ${tail(out)}`,
  }] : []),
  mustInclude: (out, strings) => strings.map((s) => ({
    name: `mustInclude ${JSON.stringify(s)}`, ok: out.includes(s), detail: '',
  })),
  mustExclude: (out, strings) => strings.map((s) => ({
    name: `mustExclude ${JSON.stringify(s)}`, ok: !out.includes(s), detail: '',
  })),
  hasNumberedList: (out, on) => (on ? [{
    name: 'hasNumberedList',
    ok: /^\s*1\.\s/m.test(out) && /^\s*2\.\s/m.test(out),
    detail: '',
  }] : []),
  noLeadingOpener: (out, openers) => {
    const start = out.trimStart();
    const hit = openers.find((o) => start.startsWith(o));
    return [{ name: `noLeadingOpener ${JSON.stringify(openers)}`, ok: !hit, detail: hit ? `starts with ${JSON.stringify(hit)}` : '' }];
  },
};

export const CHECK_NAMES = Object.keys(CHECKS);

export function runChecks(output, checks) {
  return Object.entries(checks).flatMap(([key, arg]) => {
    if (!CHECKS[key]) throw new Error(`Unknown check "${key}"`);
    return CHECKS[key](output, arg);
  });
}
