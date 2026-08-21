// D2's one sanctioned bridge between the kernel-observed and declared identity
// families, and the four-rung ladder that keeps it honest. PURE and clock-free
// by construction — `sessionBucket`/`sessionLifecycle`/`spawnVerdict` are the
// precedents, and like them this is testable with no timers and no fixture.
//
// The ladder's ORDER is the whole design, so every rung has its own `it` and
// its own named mutant: three of the four answers are reachable only because a
// rung above the table caught them, and collapsing any one of them turns a
// "we cannot compare these" into a "you lied", which is a divergence an
// operator would be shown.
import { describe, it, expect } from 'vitest';
import {
  corroboration, isActorClass, ACTOR_CLASSES, isDecSurface,
  isCorroboration, CORROBORATIONS, type ActorClass, type Corroboration,
} from '../../shared/api.js';

const ALL_CLASSES: Record<ActorClass, true> = {
  agent: true, pane: true, supervisor: true, login: true, unknown: true,
};
const CLASSES = Object.keys(ALL_CLASSES) as ActorClass[];

const ALL_VERDICTS: Record<Corroboration, true> = {
  agrees: true, disagrees: true, 'not-comparable': true, unmeasured: true,
};

describe('the two vocabularies', () => {
  it.each(CLASSES)('isActorClass(%s)', (c) => { expect(isActorClass(c)).toBe(true); });

  it('ActorClass is exactly the five cgroup shapes D2 names', () => {
    expect(CLASSES.length).toBe(5);
    expect([...ACTOR_CLASSES].sort()).toEqual([...CLASSES].sort());
    for (const v of ['systemd', 'human', 'pwa', '', null, 0]) {
      expect(isActorClass(v), String(v)).toBe(false);
    }
  });

  it('Corroboration is exactly four answers', () => {
    expect([...CORROBORATIONS].sort()).toEqual([...Object.keys(ALL_VERDICTS)].sort());
    expect(isCorroboration('mismatch')).toBe(false);
  });

  it('DecSurface is ccd`s closed set PLUS `none` — and nothing else', () => {
    // `none` is what the journal writes when NO flag was passed. It is NOT a
    // fifth surface word: `StopSurface` is unchanged (spec §2), and
    // `isDecSurface` derives from `isStopSurface` rather than restating it.
    for (const s of ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none']) {
      expect(isDecSurface(s), s).toBe(true);
    }
    for (const s of ['none ', 'CLI', '', null, undefined, 0]) {
      expect(isDecSurface(s), String(s)).toBe(false);
    }
  });
});

describe('rung 1 — an unobserved caller is UNMEASURED, never a disagreement', () => {
  it('answers unmeasured for every declared surface when obs is null', () => {
    // null = no cgroup was read at all (the `/proc` read failed). Distinct
    // from `'unknown'`, which is a cgroup that WAS read and matched none of
    // the four shapes — two conditions a caller handles differently must not
    // collapse to one value.
    for (const s of ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const) {
      expect(corroboration(null, s), s).toBe('unmeasured');
    }
  });
});

describe('rung 2 — no flag is UNMEASURED, for every observed class', () => {
  it.each(CLASSES)('%s + none', (c) => {
    expect(corroboration(c, 'none')).toBe('unmeasured');
  });

  it('and `none` beats an unclassifiable cgroup — nothing was declared to compare', () => {
    expect(corroboration('unknown', 'none')).toBe('unmeasured');
  });
});

describe('rung 3 — an unrecognised word on EITHER side is NOT-COMPARABLE', () => {
  it('an unclassifiable cgroup cannot disagree with anything', () => {
    expect(corroboration('unknown', 'cli')).toBe('not-comparable');
    expect(corroboration('unknown', 'pwa')).toBe('not-comparable');
  });

  it('a surface word ccd itself rejected cannot disagree either', () => {
    // `ccd:619` maps an out-of-set word to `unknown`. Something WAS declared;
    // it just cannot be lined up.
    expect(corroboration('pane', 'unknown')).toBe('not-comparable');
    expect(corroboration('agent', 'unknown')).toBe('not-comparable');
  });
});

describe('rung 4 — `ccd` names a LAYER, not a host, so it corroborates nothing', () => {
  it.each(CLASSES)('%s + ccd', (c) => {
    expect(corroboration(c, 'ccd')).toBe('not-comparable');
  });
});

describe('the table — the only place `agrees` and `disagrees` come from', () => {
  it('agrees where the observed host is the one the declaration implies', () => {
    expect(corroboration('agent', 'pwa')).toBe('agrees');   // PWA -> server -> agent -> ccd
    expect(corroboration('agent', 'agent')).toBe('agrees');
    expect(corroboration('pane', 'cli')).toBe('agrees');    // a session`s own Bash tool
    expect(corroboration('login', 'cli')).toBe('agrees');   // a human at a shell
  });

  it('disagrees where it does not — the fact an operator is shown', () => {
    expect(corroboration('pane', 'pwa')).toBe('disagrees');   // a session claiming to be the PWA
    expect(corroboration('pane', 'agent')).toBe('disagrees');
    expect(corroboration('login', 'pwa')).toBe('disagrees');
    expect(corroboration('agent', 'cli')).toBe('disagrees');
    expect(corroboration('supervisor', 'pwa')).toBe('disagrees');
    expect(corroboration('supervisor', 'cli')).toBe('disagrees');
  });

  it('answers one of the four for EVERY input pair — total, no undefined', () => {
    const inputs: (ActorClass | null)[] = [...CLASSES, null];
    const surfaces = ['cli', 'pwa', 'agent', 'ccd', 'unknown', 'none'] as const;
    let n = 0;
    for (const o of inputs) {
      for (const s of surfaces) {
        expect(isCorroboration(corroboration(o, s)), `${String(o)} + ${s}`).toBe(true);
        n++;
      }
    }
    expect(n, 'the whole input space, 6 classes x 6 surfaces').toBe(36);
  });
});
