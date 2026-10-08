// `_WS_NORMALISE_WHY` is cut to ONE line a journal row can carry (child
// reclamation spec §5.5, rung 8's permission pass): printable ASCII, 300 bytes,
// the cut marked "…", through wave 6's one cutter `_ws_leaf_why_line`. It can
// carry a name the SESSION chose — the entry still unreadable after the pass —
// and raw, a long or non-UTF-8 name grows six-fold at the journal's encoder,
// which then drops `detail`, `verb` and every `dec.*` but the surface to fit
// its line cap. No token reads it, so no token changes.
// FIXTURE HOMEs ONLY: every ccd call runs through the harness, never against $HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { decOf, eventsOf } from './lifecycleHelpers.js';
import { CHILD_ID, childReclaimVerb, makeChild } from './childReclaimFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-child-reclaim-why-cap-'); });
afterEach(() => { h.cleanup(); });

/** A name the session chose: control bytes, and 240 bytes that are no UTF-8 (each reaches the encoder as six). */
const NAME = Buffer.concat([Buffer.from('evil\t\x1b\x7f\x01'), Buffer.alloc(120, 0x80), Buffer.alloc(120, 0xff)]);
/** A `chmod` that exits 0 and changes nothing — the shape of an entry another uid owns, which this uid cannot fix
 *  (`ccd-child-reclaim-ladder.test.ts`'s own shim). `find -exec` resolves chmod on PATH. */
const shimChmod = (): string => {
  const shim = path.join(h.home, 'shim');
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, 'chmod'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return `PATH="${shim}:$PATH";`;
};
/** A mode-000 directory under `dir` named NAME; returns its path, as bytes. */
const lockedUnder = (dir: string): Buffer => {
  const p = Buffer.concat([Buffer.from(`${dir}/`), NAME]);
  fs.mkdirSync(p);
  fs.writeFileSync(Buffer.concat([p, Buffer.from('/x')]), 'x');
  fs.chmodSync(p, 0o000);
  return p;
};
const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
const printableThenMark = (s: string): void => {
  expect(s.endsWith('…'), 'a cut is marked').toBe(true);
  expect(s.slice(0, -1), 'printable ASCII only').toMatch(/^[\x20-\x7e]*$/);
};

describe('_ws_reclaim_normalise: every reason it sets is one capped line', () => {
  it('rc 1 (an entry still unreadable after the pass) — the session-chosen name is cut, the rc unchanged', () => {
    const { wt } = makeChild(h);
    const locked = lockedUnder(wt);
    try {
      const out = h.sh(`${shimChmod()} _ws_reclaim_normalise "${wt}"; printf '%s\\x1f%s' "$?" "$_WS_NORMALISE_WHY"`);
      const [rc = '', why = ''] = out.split('\x1f');
      expect(rc).toBe('1');
      expect(bytes(why), why).toBeLessThanOrEqual(303);
      expect(why.startsWith(`${fs.realpathSync(wt)}/evil?`) || why.startsWith(`${wt}/evil?`), why).toBe(true);
      printableThenMark(why);
    } finally { fs.chmodSync(locked, 0o755); }
  }, 60_000);

  it.each([
    ['the pass ran out of time (124)', 124],
    ['the pass did not run to the end (125)', 125],
  ] as const)('rc 2, %s — a long directory path is cut too', (_what, code) => {
    const long = Buffer.concat([Buffer.from(`${h.home}/`), NAME]);
    fs.mkdirSync(long);
    const out = h.sh(`_plat_timeout() { return ${code}; }; d=$(printf '%s' "$HOME"/evil*);`
      + ` _ws_reclaim_normalise "$d"; printf '%s\\x1f%s' "$?" "$_WS_NORMALISE_WHY"`);
    const [rc = '', why = ''] = out.split('\x1f');
    expect(rc).toBe('2');
    expect(why.startsWith('the permission pass over '), why).toBe(true);
    expect(bytes(why), why).toBeLessThanOrEqual(303);
    printableThenMark(why);
  }, 30_000);
});

describe('the ladder’s refusal row keeps its verb and its decision (spec §5.9)', () => {
  it('tree-unreadable over a session-chosen name: verb, dec.actor and detail survive, uncut by the encoder', () => {
    const { wt } = makeChild(h);
    const locked = lockedUnder(wt);
    try {
      const r = childReclaimVerb(h, '0'.repeat(64), {
        pre: shimChmod(), extra: "--surface agent --actor 'run:7 reclaim close' --reason why-cap",
      });
      expect(r.code, r.stderr).toBe(0);
      const doc = JSON.parse(r.stdout) as { refused: string; detail: string };
      expect(doc.refused).toBe('tree-unreadable');
      const row = eventsOf(h.home, 'reclaim').filter((e) => e['outcome'] === 'refused').pop()!;
      expect(row['refusal']).toBe('tree-unreadable');
      expect(row['truncated'], 'the row was never cut down to fit').toBeUndefined();
      expect(row['verb']).toBe('ws-reclaim');
      expect(decOf(row)['actor']).toBe('run:7 reclaim close');
      expect(decOf(row)['reason']).toBe('why-cap');
      expect(row['detail'], 'the journal and the document carry one detail').toBe(doc.detail);
      expect(doc.detail.startsWith(`${wt} cannot be read: `), doc.detail).toBe(true);
      printableThenMark(doc.detail);
    } finally { fs.chmodSync(locked, 0o755); }
    expect(h.reg(CHILD_ID, 'reaping'), 'a refusal starts nothing').toBeNull();
  }, 90_000);
});
