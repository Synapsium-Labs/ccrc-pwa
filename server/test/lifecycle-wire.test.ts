// The three identity families as they travel, and the ONE assertion that
// matters about them: they never merge. Three objects, three nullabilities,
// nothing that computes a single "who" (D2 / operator ruling R3).
//
// TWO INDEPENDENT MECHANISMS, because an interface cannot be red at runtime.
// The literals below are typed `LifecycleEvent` etc., so a field ADDED to an
// interface makes the literal missing a property (TS2739) and a field REMOVED
// makes it an excess property (TS2353) — caught by `typecheck-tests.test.ts`,
// which compiles this directory. The `Object.keys` assertions then pin the
// intended shape at runtime, so a reviewer reading only the test still sees
// the whole field list.
import { describe, it, expect } from 'vitest';
import type {
  LifecycleObs, LifecycleDec, LifecycleMeas, LifecycleEvent, MirroredLifecycleEvent,
} from '../../shared/api.js';
import { corroboration, isLifecycleAct, isLifecycleOutcome } from '../../shared/api.js';

const LINE =
  '{"v":1,"uid":"1755000000123456789.4242.1","atNs":"1755000000123456789",'
  + '"at":1755000000,"act":"destroy","outcome":"intent","id":"ccrc-pwa-still-river"}';

const OBS: LifecycleObs = {
  cg: 'pane', cgraw: '0::/app.slice/tmux-spawn-72be9ee2.scope',
  pid: 4242, ppid: 4100, pane: 'ccrc-pwa-still-river', paneWhy: 'matched',
  tty: false, ssh: null,
};
const DEC: LifecycleDec = { surface: 'cli', actor: 'still-river', reason: 'wave 3 cleanup' };
const MEAS: LifecycleMeas = {
  project: 'ccrc-pwa', workspace: 'still-river', branch: 'ws/still-river',
  uuid: '72be9ee2-0000-4bcc-b60b-0cfc0dc3d199', wrapper: 'claude-corp',
  tip: 'a'.repeat(40), attic: 201, atticsrc: 'worktree', archivedAt: null,
  archivedReason: null, manifestBytes: null, held: null,
  workdir: '/home/you/worktrees/ccrc-pwa/still-river', base: 'main', old: null,
  rc: 0, mode: 'resume', inUnit: 1, from: null, dropped: null, registered: 0,
  state: null, bytes: null, resumed: null, tombstone: null,
};
const EVENT: LifecycleEvent = {
  uid: '1755000000123456789.4242.1', at: 1_755_000_000_123,
  act: 'destroy', badact: null, outcome: 'intent', badoutcome: null,
  id: 'ccrc-pwa-still-river', tx: '1755000000123456789.4242.1',
  verb: 'ws-rm', refusal: null, detail: null, truncated: false,
  obs: OBS, dec: DEC, meas: MEAS, raw: LINE,
};
const MIRRORED: MirroredLifecycleEvent = {
  ...EVENT, gen: '1755000000123456789', ingestedAt: 1_755_000_000_456,
};

describe('LifecycleObs — kernel-observed, unforgeable by env', () => {
  it('carries exactly D2`s eight fields', () => {
    expect(Object.keys(OBS).sort()).toEqual(
      ['cg', 'cgraw', 'paneWhy', 'pane', 'pid', 'ppid', 'ssh', 'tty'].sort());
  });

  it('keeps the raw cgroup path even when the class is unknown — never dropped', () => {
    const weird: LifecycleObs = { ...OBS, cg: 'unknown', cgraw: '0::/some.slice/new-shape.scope' };
    expect(weird.cgraw).toBe('0::/some.slice/new-shape.scope');
    // A fifth cgroup shape this build cannot name is still recoverable from
    // the record, which is what makes the mirror a re-measurement (D8).
  });

  it('tells an unread cgroup from an unclassifiable one', () => {
    const unread: LifecycleObs = { ...OBS, cg: null, cgraw: null };
    expect(corroboration(unread.cg, 'cli')).toBe('unmeasured');
    expect(corroboration('unknown', 'cli')).toBe('not-comparable');
  });
});

describe('LifecycleDec — declared, self-asserted', () => {
  it('carries exactly D2`s three fields', () => {
    expect(Object.keys(DEC).sort()).toEqual(['actor', 'reason', 'surface']);
  });

  it('says `none` when no flag was passed — not a default laundered into a claim', () => {
    const silent: LifecycleDec = { surface: 'none', actor: null, reason: null };
    expect(corroboration('pane', silent.surface)).toBe('unmeasured');
  });
});

describe('LifecycleMeas — measured about the SUBJECT, before any destruction', () => {
  it('carries exactly D2`s ten plus wave 2`s thirteen plus wave 3`s two — twenty-five fields', () => {
    // FIX ROUND 1 (Task 24 fix round 1): `atticsrc` and `manifestBytes`
    // rejoin the list — see the inverted test below and
    // `ccd-lifecycle-contain.test.ts` for why.
    expect(Object.keys(MEAS).sort()).toEqual(
      ['archivedAt', 'archivedReason', 'attic', 'atticsrc', 'base', 'branch',
       'bytes', 'dropped', 'from', 'held', 'inUnit', 'manifestBytes', 'mode',
       'old', 'project', 'rc', 'registered', 'resumed', 'state', 'tip',
       'tombstone', 'uuid', 'workdir', 'workspace', 'wrapper'].sort());
  });

  it('every field is nullable — null means NOT MEASURED, never zero or empty', () => {
    const nothing: LifecycleMeas = {
      project: null, workspace: null, branch: null, uuid: null, wrapper: null,
      tip: null, attic: null, atticsrc: null, archivedAt: null,
      archivedReason: null, manifestBytes: null, held: null,
      workdir: null, base: null, old: null, rc: null, mode: null, inUnit: null,
      from: null, dropped: null, registered: null, state: null, bytes: null,
      resumed: null, tombstone: null,
    };
    expect(Object.values(nothing).every((v) => v === null)).toBe(true);
    // `attic: 0` is "the pin ran and created no refs"; `attic: null` is "no
    // pin was taken". `archivedReason: ''` would be a reason that is blank;
    // null is a row that was never archived. Different facts, different values.
  });

  it('is a NAMED twenty-five, not an index signature — a 26th key is a compile error', () => {
    // Task 21's ruling, replacing the wave-1 "closed ten, the rest lives in
    // raw" draft: `reviveMeas` (wave 4) reads `meas.*` through THIS
    // interface's own key list, so a key not modelled here is not merely
    // deferred to `raw` — it is silently dropped from the mirror's typed
    // shape. Widening (now with fifteen NAMED members beyond the original
    // ten, not an index signature) keeps the vocabulary closed: an emit ccd
    // does not yet have is still a TS2739/TS2740 here, exactly like the
    // original ten.
    //
    // FIX ROUND 1 (Task 24 fix round 1): `manifestBytes` and `atticsrc` — the
    // two keys a prior draft speculated on — were deliberately NOT members
    // through wave 2 and wave 3's first pass, pinned here as an absence,
    // because neither was emitted anywhere in `ccd/ccd` at that HEAD. Wave 3
    // supplied the missing wire evidence (`cmd_ws_rm`'s attic pin emits
    // `meas.atticsrc`, `cmd_ws_restore`'s supersede emits
    // `meas.manifestBytes`; both verified by `ccd-lifecycle-contain.test.ts`,
    // which derives ccd's side by scanning the file rather than a second
    // hand-written list), so this assertion is INVERTED rather than deleted:
    // it now pins their PRESENCE, the same way it pinned their absence
    // before — a guard that has served one purpose gets turned around to
    // hold the line from the other side, not discarded.
    expect(Object.keys(MEAS), 'atticsrc rejoined the wire').toContain('atticsrc');
    expect(Object.keys(MEAS), 'manifestBytes rejoined the wire').toContain('manifestBytes');
    expect(EVENT.raw.length, 'raw still holds the line verbatim on every path').toBeGreaterThan(0);
  });
});

describe('LifecycleEvent — the line', () => {
  it('carries exactly the sixteen fields, and the three families are three fields', () => {
    // The assertion R3 is actually about: no `who`, no `actorResolved`, no
    // `identity`. Nothing merges the three. Runs BEFORE the broad shape
    // check below: none of these banned names is in the canonical list, so
    // the `toEqual` below is a strict superset of this loop and would throw
    // first and mask it if left in the original order — making the named
    // assertion for R3's own mutant unreachable on failure.
    for (const banned of ['who', 'actor', 'identity', 'actorResolved', 'addressable']) {
      expect(Object.keys(EVENT), banned).not.toContain(banned);
    }
    expect(Object.keys(EVENT).sort()).toEqual(
      ['act', 'at', 'badact', 'badoutcome', 'dec', 'detail', 'id', 'meas', 'obs',
       'outcome', 'raw', 'refusal', 'truncated', 'tx', 'uid', 'verb'].sort());
  });

  it('spells the refusal field `refusal` and NEVER `refused`', () => {
    // D15's ruling. `server/test/wsaudit.test.ts:57` scans ccd's TEXT with
    // /"refused":"([a-zA-Z0-9-]+)"/ and holds the result set-equal to
    // wsaudit.ts`s SENTENCES in both directions. An emitter whose format
    // string read `"refused":"%s"` would poison that scan; naming the field
    // here is the L0 half of keeping it green with no edit.
    expect(Object.keys(EVENT)).toContain('refusal');
    expect(Object.keys(EVENT)).not.toContain('refused');
  });

  it('degrades an unmodellable act AND an unmodellable outcome, keeping both tokens (D6)', () => {
    const line = '{"act":"quarantine","outcome":"observed"}';
    const degraded: LifecycleEvent = {
      ...EVENT, act: 'unknown', badact: 'quarantine',
      outcome: 'unknown', badoutcome: 'observed',
      obs: null, dec: null, meas: null, raw: line,
    };
    expect(isLifecycleAct(degraded.act)).toBe(true);
    expect(degraded.badact).toBe('quarantine');
    expect(degraded.badoutcome).toBe('observed');
    expect(degraded.raw).toBe(line);
    // Three different facts, three different fields: what we could model,
    // what we could not, and the bytes we saw. A byte we saw and could not
    // model is a different fact from a byte that was never there — and both
    // halves of the vocabulary get the same treatment, so `badoutcome` is not
    // an afterthought a reader has to go to `raw` for.
  });

  it('a modelled act carries NULL bad-tokens — a token and its degrade cannot both be set', () => {
    expect(EVENT.badact).toBeNull();
    expect(EVENT.badoutcome).toBeNull();
    expect(isLifecycleAct(EVENT.act) && isLifecycleOutcome(EVENT.outcome)).toBe(true);
  });

  it('`truncated` is a MODELLED fact, so a dropped field is not a silence', () => {
    // The emitter drops `dec.reason`, then `obs.cgraw`, then `meas` when a
    // line would exceed LC_LINE_MAX, and says so. Without this field a
    // `meas: null` from truncation and a `meas: null` from "nothing was
    // measured" are one value for two conditions a reader handles
    // differently — the overloaded-null defect, at the seam that exists to
    // record what happened.
    const cut: LifecycleEvent = { ...EVENT, truncated: true, meas: null };
    expect(cut.truncated).toBe(true);
    expect(EVENT.truncated, 'absent on the wire reads as false, never undefined').toBe(false);
  });

  it('uid and at are NULLABLE, raw is NOT — an unparseable line is still a row', () => {
    // A line the parser could not read has no uid and no clock, and it is
    // still ingested (D8): dropping it would make "we saw bytes we could not
    // model" indistinguishable from "there were no bytes". `raw` is therefore
    // present on EVERY path — which is also what makes wave 4's replay drill
    // byte equality rather than resemblance.
    const unparseable: LifecycleEvent = {
      ...EVENT, uid: null, at: null, act: 'unknown', badact: null,
      outcome: 'unknown', badoutcome: null, id: null, tx: null, verb: null,
      refusal: null, detail: null, obs: null, dec: null, meas: null,
      raw: '{"act":"destroy",',
    };
    expect(unparseable.uid).toBeNull();
    expect(unparseable.at).toBeNull();
    expect(unparseable.raw).toBe('{"act":"destroy",');
    expect(typeof EVENT.raw).toBe('string');
  });
});

describe('MirroredLifecycleEvent — the mirror`s own two facts, kept off the line', () => {
  it('is the line PLUS `gen` and `ingestedAt`, and the line has neither', () => {
    // Runs BEFORE the broad shape check below, same reasoning as
    // LifecycleEvent's field-list test above: `gen`/`ingestedAt` are not in
    // EVENT's own canonical list, so the `toEqual` below is a strict
    // superset of these two checks and would throw first and mask them if
    // left in the original order.
    expect(Object.keys(EVENT)).not.toContain('gen');
    expect(Object.keys(EVENT)).not.toContain('ingestedAt');
    expect(Object.keys(MIRRORED).sort())
      .toEqual([...Object.keys(EVENT), 'gen', 'ingestedAt'].sort());
  });

  it('every mirrored event IS a LifecycleEvent — the extension is one-way', () => {
    const asLine: LifecycleEvent = MIRRORED;   // widening compiles
    expect(asLine.uid).toBe(EVENT.uid);
    // And the reverse does not: `const back: MirroredLifecycleEvent = EVENT;`
    // is TS2739. `gen` is which generation FILE the line was read from and
    // `ingestedAt` is the SERVER's clock; neither is a fact about the act, so
    // neither may travel as one. The replay drill's byte equality excludes
    // exactly `ingestedAt` for this reason.
    expect(MIRRORED.gen).toBe('1755000000123456789');
    expect(MIRRORED.ingestedAt).not.toBe(MIRRORED.at);
  });
});

// ── wave 4's additions ────────────────────────────────────────────────────
// The mirror's own vocabulary, pinned the way every other L0 enum in this file
// is: derived from the union, guarded by an `isX` that casts the CONSTANT and
// never the input, and carrying a designated we-do-not-know member on every
// token that is READ BACK OUT OF A COLUMN.
import {
  LIFECYCLE_GAP_REASONS, LIFECYCLE_HEALTH_STATES, LC_ACT_UNKNOWN, LC_OUTCOME_UNKNOWN,
  isLifecycleGapReason, isLifecycleHealthState,
} from '../../shared/api.js';
import type { LifecycleGapReason, LifecycleHealthState } from '../../shared/api.js';
// `MirroredLifecycleEvent` is already imported in the type-only import block
// at the top of this file (wave 1, Task 4) — not re-imported here, which
// would be a duplicate identifier.

const GAP_REASONS: Record<LifecycleGapReason, true> =
  { 'rotated-away': true, shrank: true, unknown: true };
const HEALTH_STATES: Record<LifecycleHealthState, true> =
  { ok: true, stale: true, unavailable: true, unknown: true };

describe('LifecycleGapReason', () => {
  it('derives its runtime list from the union, in both directions', () => {
    expect([...LIFECYCLE_GAP_REASONS].sort()).toEqual(Object.keys(GAP_REASONS).sort());
  });
  it('carries a we-do-not-know member, because `lifecycle_gaps.reason` is a column read back', () => {
    expect(isLifecycleGapReason('unknown')).toBe(true);
    expect(isLifecycleGapReason('vacuumed')).toBe(false);
    expect(isLifecycleGapReason(7)).toBe(false);
  });
});

describe('LifecycleHealthState', () => {
  it('derives its runtime list from the union, in both directions', () => {
    expect([...LIFECYCLE_HEALTH_STATES].sort()).toEqual(Object.keys(HEALTH_STATES).sort());
  });
  it('tells "no evidence" from "the box does not write a journal" — the two must not share a word', () => {
    // `unavailable` = ccd advertised its caps and `lifecycle-v1` was not among
    // them. `unknown` = nothing has been measured yet. An old ccd's silence
    // must not read as a quiet fleet, and neither may read as `ok`.
    expect(isLifecycleHealthState('unavailable')).toBe(true);
    expect(isLifecycleHealthState('unknown')).toBe(true);
    expect(LIFECYCLE_HEALTH_STATES).not.toContain('none');
  });
});

describe('the degrade tokens are named once each', () => {
  it('names the act degrade and the outcome degrade separately, and both are `unknown`', () => {
    // ONE NAME PER DEGRADE, in L0. Eight files in wave 4 read a column back
    // through a guard and fall to one of these two; a bare `'unknown'` literal
    // in any of them would be a second home for the value.
    expect(LC_ACT_UNKNOWN).toBe('unknown');
    expect(LC_OUTCOME_UNKNOWN).toBe('unknown');
  });
});

describe('MirroredLifecycleEvent — a journal LINE plus what only the MIRROR knows', () => {
  it('adds exactly gen and ingestedAt to the wire event — truncated already travels on the line', () => {
    // `gen` is the FILENAME's, `ingestedAt` is THE SERVER'S clock. Neither
    // belongs on `LifecycleEvent`, which is what ccd wrote; both are facts
    // about the row a reader must be able to see. `truncated` is already one
    // of `LifecycleEvent`'s own sixteen fields (wave 1, Task 4) — ccd's own
    // admission that `_lc_json` shed fields to fit — so it is not a THIRD
    // addition here, only carried through.
    //
    // DEVIATION from the brief's literal Step 1 sample: that sample's
    // `mirrored` object and its expected-keys array both omit `badoutcome`,
    // which is a required field on `LifecycleEvent` (badact's twin — "Both
    // halves of the vocabulary degrade the same way", :4008-4011). Omitting
    // it does not typecheck against the shipped `MirroredLifecycleEvent`.
    // Restored here, `null`, matching the sibling "unparseable line" case
    // above (`badact: null, outcome: 'unknown', badoutcome: null`).
    const mirrored: MirroredLifecycleEvent = {
      uid: null, at: null, act: LC_ACT_UNKNOWN, badact: null, outcome: LC_OUTCOME_UNKNOWN,
      badoutcome: null, id: null, tx: null, verb: null, refusal: null, detail: null,
      obs: null, dec: null, meas: null, raw: 'ws-rm demo  # not json',
      gen: '1755780000000000000', ingestedAt: 1_060_000, truncated: false,
    };
    expect(Object.keys(mirrored).sort()).toEqual(
      ['act', 'at', 'badact', 'badoutcome', 'dec', 'detail', 'gen', 'id', 'ingestedAt', 'meas',
       'obs', 'outcome', 'raw', 'refusal', 'truncated', 'tx', 'uid', 'verb'].sort());
    // The nullability wave 4 needs and wave 1 declared too narrowly: the mirror
    // genuinely holds rows whose line carried no `uid` and no readable `at` —
    // that is what `lifecycle_raw_uid` exists for.
    expect(mirrored.uid).toBeNull();
    expect(mirrored.at).toBeNull();
  });
});
