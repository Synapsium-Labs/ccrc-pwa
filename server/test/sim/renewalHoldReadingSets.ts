// The launch profile's oracles and mutant sets (Overlord W1, plan `w1-renewal-readings.md`, PR H: Task 11; spec §3.6). Each
// decider's cases are written ONCE here, as suite cases over a module: `continuity-renewal-holds.test.ts` runs them against the
// real modules, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors). The expected
// answers are written out, never read from the code they judge. The plan's Step 5 mutants are named: H1 (hold on an unmeasured
// property), H2 (hold on a workspace-loaded property), L1 (drop the empty-list arm) and I1 (read skew as agreement).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { SANDBOX_PROPERTIES, type SandboxProperty } from '../../../shared/overlord-sandbox.js';
import type { PropertyState, SandboxVerdict } from '../../src/continuity/sandboxCheck.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const READINGS = path.join(ROOT, 'server/src/continuity/renewalReadings.ts');
const SHARED = path.join(ROOT, 'shared/renewal-readings.ts');

type RenewalReadingsModule = typeof import('../../src/continuity/renewalReadings.js');
type SharedModule = typeof import('../../../shared/renewal-readings.js');

const measured = <T>(value: T) => ({ kind: 'measured' as const, value });
const unmeasured = (why: string) => ({ kind: 'unmeasured' as const, why });
const T = measured(true);
const F = measured(false);
const U = unmeasured('u');

/** A verdict with every property held, then `over` laid on it: `[state, fromAccount]` per property. */
const verdict = (over: Partial<Record<SandboxProperty, readonly [PropertyState, boolean]>> = {}): SandboxVerdict => {
  const properties = SANDBOX_PROPERTIES.map((property) => {
    const [state, fromAccount] = over[property] ?? ['held', false];
    return { property, state, detail: 'x', fromAccount };
  });
  return { engaged: properties.every((p) => p.state === 'held'), properties };
};

// ---------------------------------------------------------------------------------------------------------------- holdOfStart

export function holdOfStartCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'no verdict yet holds nothing and asks again': () => {
      expect(m.holdOfStart('unmeasured', 'lane-a')).toEqual({ kind: 'unmeasured', why: 'no verdict for the start yet' });
    },
    'a pass settles the start, and holds nothing': () => {
      expect(m.holdOfStart(verdict(), 'lane-a')).toEqual({ kind: 'settled' });
    },
    'something the account\'s config loaded holds the account the start ran on': () => {
      for (const p of ['tools', 'tool-servers', 'instructions', 'skills', 'agents', 'hooks'] as const) {
        expect(m.holdOfStart(verdict({ [p]: ['failed', true] }), 'lane-a'), p).toEqual({ kind: 'hold', lane: 'lane-a' });
      }
    },
    'a property the workspace loaded, a missing load or the launch\'s own composition never holds an account (H2)': () => {
      for (const p of SANDBOX_PROPERTIES) expect(m.holdOfStart(verdict({ [p]: ['failed', false] }), 'lane-a'), p).toEqual({ kind: 'settled' });
    },
    'an unmeasured property never holds an account, and the start is asked again (H1)': () => {
      expect(m.holdOfStart(verdict({ skills: ['unmeasured', false] }), 'lane-a')).toEqual({ kind: 'unmeasured', why: 'skills unmeasured' });
      // an unmeasured property beside a workspace failure: still asked again, never settled
      expect(m.holdOfStart(verdict({ workspace: ['failed', false], hooks: ['unmeasured', false] }), 'lane-a').kind).toBe('unmeasured');
    },
    'a measured account load holds even beside an unmeasured property': () => {
      expect(m.holdOfStart(verdict({ agents: ['failed', true], tools: ['unmeasured', false] }), 'lane-a')).toEqual({ kind: 'hold', lane: 'lane-a' });
    },
    'an account load on a start whose account is unknown holds nothing and asks again': () => {
      expect(m.holdOfStart(verdict({ hooks: ['failed', true] }), null)).toEqual({ kind: 'unmeasured', why: 'the account the start ran on is unknown' });
    },
  };
}

const HOLD_OF_START_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: READINGS,
  mutants: [
    { id: 'H1 hold on an unmeasured property', old: "p.state === 'failed' && p.fromAccount)) {", new: "p.state !== 'held' && p.fromAccount) || verdict.properties.some((p) => p.state === 'unmeasured')) {" },
    { id: 'H2 hold on a workspace-loaded property', old: "p.state === 'failed' && p.fromAccount)) {", new: "p.state === 'failed')) {" },
    { id: 'H3 an unmeasured property settles', old: "  if (open !== undefined) return { kind: 'unmeasured', why: `${open.property} unmeasured` };\n", new: '' },
    { id: 'H4 no verdict settles', old: "if (verdict === 'unmeasured') return { kind: 'unmeasured', why: 'no verdict for the start yet' };", new: "if (verdict === 'unmeasured') return { kind: 'settled' };" },
    { id: 'H5 an unknown account settles', old: "return lane === null ? { kind: 'unmeasured', why: 'the account the start ran on is unknown' } : { kind: 'hold', lane };", new: "return lane === null ? { kind: 'settled' } : { kind: 'hold', lane };" },
  ],
  suite: holdOfStartCases,
};

// ------------------------------------------------------------------------------------------------------------- heldOutOfList

export function heldOutOfListCases(m: SharedModule): Record<string, SuiteCase> {
  return {
    'every held account is left out, the order kept': () => {
      expect(m.heldOutOfList(['lane-b', 'lane-a', 'lane-c'], ['lane-a'])).toEqual({ list: ['lane-b', 'lane-c'], overridden: false });
    },
    'no holds, or holds on accounts not listed, leave the list as it is': () => {
      expect(m.heldOutOfList(['lane-a', 'lane-b'], [])).toEqual({ list: ['lane-a', 'lane-b'], overridden: false });
      expect(m.heldOutOfList(['lane-a', 'lane-b'], ['lane-z'])).toEqual({ list: ['lane-a', 'lane-b'], overridden: false });
    },
    'holds that would leave none keep the list as it was, overridden, never empty (L1)': () => {
      expect(m.heldOutOfList(['lane-a', 'lane-b'], ['lane-b', 'lane-a'])).toEqual({ list: ['lane-a', 'lane-b'], overridden: true });
    },
    'an empty list stays empty and is not overridden': () => {
      expect(m.heldOutOfList([], ['lane-a'])).toEqual({ list: [], overridden: false });
    },
  };
}

const HELD_OUT_SET: MutantSet<SharedModule> = {
  modulePath: SHARED,
  mutants: [
    { id: 'L1 drop the empty-list arm', old: '  if (kept.length === 0 && list.length > 0) return { list, overridden: true };\n', new: '' },
    { id: 'L2 an empty list is overridden', old: 'if (kept.length === 0 && list.length > 0)', new: 'if (kept.length === 0)' },
    { id: 'L3 the holds kept instead of left out', old: 'list.filter((id) => !holds.includes(id))', new: 'list.filter((id) => holds.includes(id))' },
    { id: 'L4 an override that empties', old: 'return { list, overridden: true };', new: 'return { list: kept, overridden: true };' },
  ],
  suite: heldOutOfListCases,
};

// -------------------------------------------------------------------------------------------------- overlordInstallBehindOf

export function installBehindCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  return {
    'every combination: builds that differ or are unknown read build skew, else Kleene\'s or of behind and the digest': () => {
      const rs = [T, F, U] as const;
      for (const behind of rs) for (const digest of rs) for (const builds of rs) {
        const got = m.overlordInstallBehindOf(behind, digest, builds);
        const label = `${behind.kind}:${'value' in behind ? behind.value : ''} ${digest.kind}:${'value' in digest ? digest.value : ''} ${builds.kind}:${'value' in builds ? builds.value : ''}`;
        if (builds !== T) { expect(got, label).toEqual(unmeasured('build skew')); continue; }
        if (behind === T || digest === T) expect(got, label).toEqual(T);
        else if (behind === F && digest === F) expect(got, label).toEqual(F);
        else expect(got, label).toEqual(U);
      }
    },
    'an unmeasured behind keeps its own reason; so does an unmeasured digest': () => {
      expect(m.overlordInstallBehindOf(unmeasured('install record unreadable'), F, T)).toEqual(unmeasured('install record unreadable'));
      expect(m.overlordInstallBehindOf(F, unmeasured('no loads report'), T)).toEqual(unmeasured('no loads report'));
    },
    'the digest reads from the newest start\'s own report against the server\'s; anything unread is unmeasured': () => {
      const r = (profileDigest: string | null) => ({ ok: true as const, newest: { report: { profileDigest } } });
      expect(m.startDigestDiffersOf(r('d1'), 'd1')).toEqual(F);
      expect(m.startDigestDiffersOf(r('d0'), 'd1')).toEqual(T);
      expect(m.startDigestDiffersOf(r(null), 'd1')).toEqual(unmeasured('no digest reported'));
      expect(m.startDigestDiffersOf({ ok: true, newest: { report: null } }, 'd1')).toEqual(unmeasured('no loads report'));
      expect(m.startDigestDiffersOf({ ok: true, newest: null }, 'd1')).toEqual(unmeasured('no start'));
      expect(m.startDigestDiffersOf({ ok: false, detail: 'locked' }, 'd1')).toEqual(unmeasured('start loads unread: locked'));
    },
    'the build agreement: agreed true, skewed false, unknown unmeasured': () => {
      expect(m.buildsAgreeOf('agreed')).toEqual(T);
      expect(m.buildsAgreeOf('skewed')).toEqual(F);
      expect(m.buildsAgreeOf('unknown')).toEqual(unmeasured('builds unknown'));
    },
  };
}

const INSTALL_BEHIND_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: READINGS,
  mutants: [
    { id: 'I1 read skew as agreement', old: "if (buildsAgree.kind === 'unmeasured' || !buildsAgree.value) return unmeasured('build skew');", new: "if (buildsAgree.kind === 'unmeasured') return unmeasured('build skew');" },
    { id: 'I2 unknown builds read as agreement', old: "if (buildsAgree.kind === 'unmeasured' || !buildsAgree.value) return unmeasured('build skew');", new: "if (buildsAgree.kind === 'measured' && !buildsAgree.value) return unmeasured('build skew');" },
    { id: 'I3 the digest ignored', old: " || (digestDiffers.kind === 'measured' && digestDiffers.value)) return", new: ') return' },
    { id: 'I4 an unmeasured digest read as no', old: "  if (digestDiffers.kind === 'unmeasured') return digestDiffers;\n", new: '' },
    { id: 'I5 and for or', old: "if ((behind.kind === 'measured' && behind.value) || (digestDiffers", new: "if ((behind.kind === 'measured' && behind.value) && (digestDiffers" },
    { id: 'D1 an equal digest differs', old: "return { kind: 'measured', value: digest !== serverDigest };", new: "return { kind: 'measured', value: true };" },
    { id: 'D2 no digest read as equal', old: "  if (digest === null) return unmeasured(", new: "  if (digest === null) return { kind: 'measured', value: false }; if (digest === null) return unmeasured(" },
    { id: 'B1 skewed read as agreed', old: "{ kind: 'measured', value: b === 'agreed' }", new: "{ kind: 'measured', value: true }" },
  ],
  suite: installBehindCases,
};

// ------------------------------------------------------------------------------------------------------------- holdTargetOf

export function holdTargetCases(m: RenewalReadingsModule): Record<string, SuiteCase> {
  const view = { bound: { sessionId: 'lane-a-overlord', generation: 'g1' }, pending: null, term: 2, designatedTerm: 2, model: 'opus',
    accountPools: { pools: ['pool-a'], untagged: false }, pastIds: [], actor: 'flag-off', lastAttempt: null, stopsOwed: [] } as const;
  const bound = { kind: 'designated', sessionId: 'lane-a-overlord', term: 2, row: view } as const;
  const g = (sessionId: string, role = 'overlord') => ({ role, sessionId });
  const rows = [g('lane-b-overlord'), g('lane-a-overlord', 'coordinator'), g('lane-a-overlord')];
  return {
    'the bound session\'s Overlord generation is the target': () => {
      expect(m.holdTargetOf(bound as never, rows)).toBe(rows[2]);
    },
    'nobody designated, a pending row or an unreadable one: no target': () => {
      expect(m.holdTargetOf({ kind: 'not-designated', row: null }, rows)).toBeNull();
      expect(m.holdTargetOf({ kind: 'not-designated', row: { ...view, bound: null } } as never, rows)).toBeNull();
      expect(m.holdTargetOf({ kind: 'unmeasured', why: 'locked' }, rows)).toBeNull();
    },
    'another session\'s generation, or a coordinator generation of the bound session, is never the target': () => {
      expect(m.holdTargetOf(bound as never, [rows[0]!, rows[1]!])).toBeNull();
    },
  };
}

const HOLD_TARGET_SET: MutantSet<RenewalReadingsModule> = {
  modulePath: READINGS,
  mutants: [
    { id: 'T1 any role', old: "return g.role === 'overlord' && b !== false && b.kind === 'designated';", new: "return b !== false && b.kind === 'designated';" },
    { id: 'T2 an unreadable row binds', old: "return g.role === 'overlord' && b !== false && b.kind === 'designated';", new: "return g.role === 'overlord' && b !== false;" },
    { id: 'T3 any Overlord generation', old: "return g.role === 'overlord' && b !== false && b.kind === 'designated';", new: "return g.role === 'overlord';" },
  ],
  suite: holdTargetCases,
};

export const RENEWAL_HOLD_READING_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/renewalReadings.ts#holdTargetOf': HOLD_TARGET_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#holdOfStart': HOLD_OF_START_SET as MutantSet<never>,
  'shared/renewal-readings.ts#heldOutOfList': HELD_OUT_SET as MutantSet<never>,
  'server/src/continuity/renewalReadings.ts#overlordInstallBehindOf': INSTALL_BEHIND_SET as MutantSet<never>,
};
