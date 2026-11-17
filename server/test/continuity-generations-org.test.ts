// Account organization, PR D (plan 2026-11-16-account-organization.md §4, Tasks D1 and D2): the generation row keeps the
// previous generation's account (`prevLane`, written by the mint alone, as `prevModel` is), and the Overlord renews after a
// start that resumed its conversation in another organization (`resumed-other-org`, a hard row read from `startOtherOrg`
// apart from `startResumed`). An unknown relation makes the row blind, never "same" (`unknown-org-is-no-preference`).
// Fixture labels are `org-a` and `org-b`; no organization id is ever stored or shown.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import { loadConfig } from '../src/config.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { genExpectOf, type GenRow, type MintInput } from '../src/continuity/continuityStore.js';
import { renewalInputsOf } from '../src/continuity/generationsLane.js';
import { RENEWAL_ROWS, TRIGGER_CLASS, renewalDue, type Reading, type RenewalInputs } from '../src/continuity/renewalDue.js';
import { isRenewalTrigger } from '../../shared/continuity.js';
import type { FleetRole } from '../../shared/fleetRoles.js';
import { DEFAULT_TEST_ROSTER, seedRoster, testDeps } from './helpers.js';
import { quietWatcher } from './laneQuiet.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ID = 'lane-a-project-a';
const store = (dir = mkTmp('ccrc-gens-org-')): CoordStore => new CoordStore(openCoordDb(path.join(dir, '.ccrc', 'coord.db')));

let reports = 0;
const startOf = (s: CoordStore, at = NOW): number => {
  reports += 1;
  const r = s.insertStart({ sessionId: ID, reportId: `r-org-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'resume',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: at, receivedAt: at });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};
const mintIn = (startId: number, over: Partial<MintInput> = {}): MintInput => ({
  identity: ID, sessionId: ID, role: 'overlord', term: 1, rowIncarnation: null, startId, startReportedAt: NOW,
  resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: NOW, ...over,
});
const live = (s: CoordStore): GenRow[] => { const r = s.liveGenerations(); if (!r.ok) throw new Error(r.detail); return r.rows; };
const only = (s: CoordStore): GenRow => { const rows = live(s); expect(rows).toHaveLength(1); return rows[0]!; };

/** Mint `lanes` in order on one identity; every mint after the first resumes when `resumed` says so. */
function minted(lanes: readonly (string | null)[], over: Partial<MintInput> = {}): { s: CoordStore; g: GenRow } {
  const s = store();
  let prev: GenRow | null = null;
  for (const lane of lanes) {
    const r = s.mintGeneration(mintIn(startOf(s), { lane, ...over }), prev === null ? null : genExpectOf(prev), false);
    if (!r.ok) throw new Error(`mint ${r.kind}`);
    prev = only(s);
  }
  return { s, g: prev! };
}

describe('Task D1: the generation row keeps the previous generation\'s account (`prevLane`)', { timeout: 60_000 }, () => {
  it('the migration that adds it is a single ALTER on continuity_generations, after the table\'s own', () => {
    const slot = MIGRATIONS.findIndex((m) => m.includes('ADD COLUMN prevLane'));
    expect(slot).toBeGreaterThan(MIGRATIONS.findIndex((m) => m.includes('CREATE TABLE continuity_generations')));
    expect(MIGRATIONS[slot]).toMatch(/ALTER TABLE continuity_generations ADD COLUMN prevLane TEXT;/);
  });

  it('the first mint records null', () => {
    expect(minted(['lane-a']).g).toMatchObject({ lane: 'lane-a', prevLane: null });
  });

  it('a mint over an existing generation records that generation\'s lane', () => {
    expect(minted(['lane-a', 'lane-b']).g).toMatchObject({ lane: 'lane-b', prevLane: 'lane-a' });
  });

  it('a mint whose previous generation had no lane records null, and one over the same lane records it', () => {
    expect(minted([null, 'lane-b']).g).toMatchObject({ lane: 'lane-b', prevLane: null });
    expect(minted(['lane-a', 'lane-a']).g).toMatchObject({ lane: 'lane-a', prevLane: 'lane-a' });
  });

  it('a row an older build wrote (it never names the column) reads null', () => {
    const s = store();
    s.db.prepare('INSERT INTO continuity_generations (identity, sessionId, role, term, rowIncarnation, n, state, shadowState, walk, '
      + 'enteredAt, deadlineAt, shadowDeadlineAt, proven, resumed, startId, startReportedAt, model, prevModel, lane, host, observed, '
      + "mintedObservedMs) VALUES (?, ?, 'overlord', 1, NULL, 1, 'active', NULL, NULL, ?, NULL, NULL, 0, 1, ?, ?, NULL, NULL, 'lane-b', NULL, ?, 0)")
      .run(ID, ID, NOW, startOf(s), NOW, JSON.stringify({ ms: 0, mono: 1_000, proc: 'p1' }));
    expect(only(s)).toMatchObject({ lane: 'lane-b', prevLane: null });
  });
});

// ------------------------------------------------------------------------------------------------- Task D2: the reading

const ORG_LABEL_OF: Readonly<Record<string, string>> = { 'lane-a': 'org-a', 'lane-b': 'org-a', 'lane-c': 'org-b' };
const orgOf = (account: string): string | null => ORG_LABEL_OF[account] ?? null;
const inputsOf = (g: GenRow, of: (account: string) => string | null = orgOf): RenewalInputs =>
  renewalInputsOf(g, undefined, { kind: 'unmeasured', why: 'not a coordinator' }, NOW, { kind: 'measured', value: false }, of);
const unmeasured = (why: string): Reading<boolean> => ({ kind: 'unmeasured', why });
const measured = (value: boolean): Reading<boolean> => ({ kind: 'measured', value });

describe('Task D2: `startOtherOrg` is read from lane, prevLane and the roster (Table 3)', { timeout: 60_000 }, () => {
  it('not resumed: measured false, whatever the accounts', () => {
    expect(inputsOf(minted(['lane-a', 'lane-c']).g).startOtherOrg).toEqual(measured(false));
  });
  it('resumed, previous account unknown: unmeasured `previous account unknown`', () => {
    expect(inputsOf(minted(['lane-a'], { resumed: true }).g).startOtherOrg).toEqual(unmeasured('previous account unknown'));
    expect(inputsOf(minted([null, 'lane-c'], { resumed: true }).g).startOtherOrg).toEqual(unmeasured('previous account unknown'));
  });
  it('resumed on an account whose own lane is unknown: unmeasured, never "same"', () => {
    expect(inputsOf(minted(['lane-a', null], { resumed: true }).g).startOtherOrg).toEqual(unmeasured('account unknown'));
  });
  it('resumed, relation `same` (two accounts, one label): measured false', () => {
    expect(inputsOf(minted(['lane-a', 'lane-b'], { resumed: true }).g).startOtherOrg).toEqual(measured(false));
  });
  it('resumed on the same account, labelled or not: measured false (`same-account-is-same-org`)', () => {
    expect(inputsOf(minted(['lane-a', 'lane-a'], { resumed: true }).g).startOtherOrg).toEqual(measured(false));
    expect(inputsOf(minted(['lane-z', 'lane-z'], { resumed: true }).g).startOtherOrg).toEqual(measured(false));
  });
  it('resumed, relation `other`: measured true', () => {
    expect(inputsOf(minted(['lane-a', 'lane-c'], { resumed: true }).g).startOtherOrg).toEqual(measured(true));
  });
  it('resumed, relation `unknown` (either side unlabelled): unmeasured `organization unknown` (`unknown-org-is-no-preference`)', () => {
    expect(inputsOf(minted(['lane-a', 'lane-z'], { resumed: true }).g).startOtherOrg).toEqual(unmeasured('organization unknown'));
    expect(inputsOf(minted(['lane-z', 'lane-c'], { resumed: true }).g).startOtherOrg).toEqual(unmeasured('organization unknown'));
    // No roster labels at all: every pair of distinct accounts is unknown.
    expect(inputsOf(minted(['lane-a', 'lane-c'], { resumed: true }).g, () => null).startOtherOrg).toEqual(unmeasured('organization unknown'));
    // No `orgOf` passed at all (`org-of-absent-is-unlabelled`): the default reads every account unlabelled.
    const g = minted(['lane-a', 'lane-c'], { resumed: true }).g;
    expect(renewalInputsOf(g, undefined, { kind: 'unmeasured', why: 'not a coordinator' }, NOW, { kind: 'measured', value: false })
      .startOtherOrg).toEqual(unmeasured('organization unknown'));
  });
  it('`startResumed` keeps its shape: an unknown organization never blinds it (`other-org-reading-apart`)', () => {
    const i = inputsOf(minted(['lane-a', 'lane-z'], { resumed: true }).g);
    expect(i.startResumed).toEqual({ kind: 'measured', value: { resumed: true, otherClass: false } });
  });
});

describe('Task D2: `resumed-other-org`, a hard row for the Overlord only', { timeout: 60_000 }, () => {
  // A measured context well under every threshold, so `resumed-long` is decided rather than blind on its context part.
  const due = (role: FleetRole, lanes: readonly (string | null)[]) => renewalDue({ ...inputsOf(minted(lanes, { resumed: true, role }).g),
    role, contextTokens: { kind: 'measured', value: 0 }, windowTokens: { kind: 'measured', value: 1_000_000 } });

  it('the row is hard, sits after `resumed-other-class` in the Overlord\'s list, and is absent from the coordinator\'s', () => {
    expect(TRIGGER_CLASS['resumed-other-org']).toBe('hard');
    const o = RENEWAL_ROWS.overlord;
    expect(o.indexOf('resumed-other-org')).toBe(o.indexOf('resumed-other-class') + 1);
    expect(RENEWAL_ROWS.coordinator).not.toContain('resumed-other-org');
    for (const [role, rows] of Object.entries(RENEWAL_ROWS)) if (role !== 'overlord') expect(rows, role).not.toContain('resumed-other-org');
  });

  it('a resume into another organization makes the Overlord due hard, `resumed-other-org`', () => {
    expect(due('overlord', ['lane-a', 'lane-c'])).toMatchObject({ due: true, cls: 'hard', why: 'resumed-other-org' });
  });

  it('a resume into the same organization does not', () => {
    const d = due('overlord', ['lane-a', 'lane-b']);
    expect(d.due ? d.why : null).not.toBe('resumed-other-org');
    expect(d.blind).not.toContain('resumed-other-org');
  });

  it('the coordinator never fires it and never names it blind', () => {
    for (const lanes of [['lane-a', 'lane-c'], ['lane-a', 'lane-z']]) {
      const d = due('coordinator', lanes);
      expect(d.due ? d.why : null).not.toBe('resumed-other-org');
      expect(d.blind).not.toContain('resumed-other-org');
    }
  });

  it('an unmeasured `startOtherOrg` makes the row blind, and leaves `resumed-other-class` and `resumed-long` measured', () => {
    const d = due('overlord', ['lane-a', 'lane-z']);
    expect(d.blind).toContain('resumed-other-org');
    expect(d.blind).not.toContain('resumed-other-class');
    expect(d.blind).not.toContain('resumed-long');
    expect(d.due ? d.why : null).not.toBe('resumed-other-org');
  });

  it('the feed names it: the word is in the trigger vocabulary, and a recorded due reads back as `resumed-other-org`', () => {
    expect(isRenewalTrigger('resumed-other-org')).toBe(true);
    const { s, g } = minted(['lane-a', 'lane-c'], { resumed: true });
    expect(s.setGenerationDue(g.id, genExpectOf(g), { due: true, why: 'resumed-other-org', cls: 'hard', at: NOW, observedMs: 0 }, [])).toEqual({ changed: true });
    expect(only(s)).toMatchObject({ dueWhy: 'resumed-other-org', dueClass: 'hard' });
  });
});

describe('the watcher reads the labels from the roster it holds', { timeout: 60_000 }, () => {
  async function sweep(labels: Readonly<Record<string, string>>): Promise<GenRow> {
    const home = mkTmp('ccrc-gens-org-tick-');
    seedRoster(home, { ...DEFAULT_TEST_ROSTER,
      accounts: DEFAULT_TEST_ROSTER.accounts.map((a) => (labels[a.id] === undefined ? a : { ...a, org: labels[a.id] })) });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const cfg = loadConfig({ CCRC_HOME: home, CCRC_PROJECTS_ROOT: mkTmp('ccrc-projects-') } as never);
    const coord = store(home);
    const deps = { ...testDeps(home, async () => ({ ran: true, code: 1, stdout: '', stderr: '' })), cfg, coord };
    const w = new FleetWatcher(deps as never, new Bus(), 10_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let prev: GenRow | null = null;
      for (const lane of ['claude-a', 'claude-b']) {
        const r = coord.mintGeneration(mintIn(startOf(coord), { lane, resumed: true }), prev === null ? null : genExpectOf(prev), false);
        if (!r.ok) throw new Error(`mint ${r.kind}`);
        prev = only(coord);
      }
      await w.sweepGenerations([], Date.now());
      return only(coord);
    } finally {
      warn.mockRestore();
      await quietWatcher(w);
      coord.db.close();
    }
  }

  it('two accounts labelled apart: the sweep records `resumed-other-org` on the Overlord\'s generation', async () => {
    expect(await sweep({ 'claude-a': 'org-a', 'claude-b': 'org-b' })).toMatchObject({ dueWhy: 'resumed-other-org', dueClass: 'hard' });
  });

  it('one label: not due on it; no labels: blind on it', async () => {
    const same = await sweep({ 'claude-a': 'org-a', 'claude-b': 'org-a' });
    expect(same.dueWhy).not.toBe('resumed-other-org');
    expect(same.blind ?? []).not.toContain('resumed-other-org');
    const none = await sweep({});
    expect(none.dueWhy).not.toBe('resumed-other-org');
    expect(none.blind).toContain('resumed-other-org');
  });
});
