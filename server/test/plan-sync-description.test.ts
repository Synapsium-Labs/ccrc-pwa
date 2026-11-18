// D-8708 (Linear hierarchy plan, D-8182's plan sync): Linear refuses a project or initiative description over 255
// characters (INVALID_INPUT, measured live 2026-11-17), so both are fitted to LINEAR_DESCRIPTION_MAX_CHARS with the
// provenance line kept whole. Fixtures use neutral names only; no Linear call is made.
import { describe, expect, it } from 'vitest';
import type { CheckpointRow, EpicRow, StoredPlan } from '../src/coord/planStore.js';
import {
  fitLinearDescription, initiativeDescription, LINEAR_DESCRIPTION_MAX_CHARS, milestoneDescription, plannedFingerprint, planSyncSteps, projectDescription,
  type ProgrammeSnapshot, type SyncSnapshot, type SyncStep,
} from '../src/linear/planSyncPolicy.js';
import { withCcrcProvenance } from '../src/linear/hierarchyOps.js';
import { LINEAR_CCRC_PROVENANCE_LINE } from '../src/linear/ops.js';

const U = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const WS = 'ws-a';
const PROVENANCE_TAIL = `\n\n${LINEAR_CCRC_PROVENANCE_LINE}`;

const epic = (o: Partial<EpicRow> = {}): EpicRow => ({
  id: 1, program: 'prog', project: 'proj-a', waves: [1], key: 'e1', ordinal: 0, title: 'Epic one', summary: 'The summary', state: 'active',
  droppedWhy: null, putBackAt: null, openedAt: null, doneAt: null, ...o,
});
const cp = (n: number, title: string): CheckpointRow => ({
  id: n, epicId: 1, key: `c${n}`, ordinal: n, title, kind: 'acceptance', proves: [], state: 'open', droppedWhy: null,
  putBackAt: null, metAt: null, evidence: null, itemId: null,
});
const directory = {
  viewerId: U(9), labels: [], projects: [], users: [], initiatives: 'on' as const,
  states: [{ id: U(21), name: 'Todo', type: 'unstarted', teamKey: 'AAA' }],
  projectStatuses: [{ id: U(31), name: 'P', type: 'planned' }, { id: U(32), name: 'S', type: 'started' },
    { id: U(33), name: 'C', type: 'completed' }, { id: U(34), name: 'X', type: 'canceled' }],
};

function snap(o: {
  epic?: Partial<EpicRow>; cps?: CheckpointRow[]; inShort?: string; doneWhen?: string[]; mode?: 'public' | 'private'; paused?: boolean;
  initiatives?: 'on' | 'off';
} = {}): ProgrammeSnapshot {
  const plan: StoredPlan = { program: 'prog', planBy: null, required: true, epics: [{ ...epic(o.epic), checkpoints: o.cps ?? [], tickets: [] }] };
  return {
    program: {
      slug: 'prog', rowid: 7, title: 'The programme', end: null, inShort: o.inShort ?? 'Short words',
      doneWhen: (o.doneWhen ?? ['It works']).map((text) => ({ text, proved: false })), ...(o.paused === undefined ? {} : { paused: o.paused }),
    },
    plan, bindings: [],
    workspaces: [{ workspaceId: WS, initiatives: 'on', directory, teams: [{ id: U(1), key: 'AAA' }] }],
    projects: [{ project: 'proj-a', teamKey: 'AAA', workspaceId: WS, mode: o.mode ?? 'private', initiatives: o.initiatives ?? 'on' }],
    privateTrackerKeys: [],
  };
}
type Create = Extract<SyncStep, { kind: 'create' }>;
const createOf = (s: SyncSnapshot, op: string): Create => {
  const step = planSyncSteps(s).steps.find((x): x is Create => x.kind === 'create' && x.op === op);
  if (step === undefined) throw new Error(`no ${op}`);
  return step;
};
const descriptionOf = (step: Create): string => (step.input as { description: string }).description;

// An epic whose description came to 474 characters before the fit: the longest that failed live.
const LONG_SUMMARY = 'This epic carries the work that brings the plan sync to a steady state across every workspace, '
  + 'so that each epic, checkpoint and ticket keeps one Linear object and one fingerprint.';
const LONG_CPS = [
  cp(1, 'Every epic of the programme is bound to one Linear project'),
  cp(2, 'Every checkpoint of every epic is bound to one milestone.'),
  cp(3, 'Every open ticket is bound to one issue in its planned team'),
  cp(4, 'A second pass over an unchanged plan sends no step to Linear.'),
];
const longSnap = (): SyncSnapshot => snap({ epic: { summary: LONG_SUMMARY }, cps: LONG_CPS });

describe('fitLinearDescription (D-8708)', () => {
  it('the long epic fixture measures 474 characters unfitted', () => {
    const e = longSnap().plan.epics[0]!;
    const unfitted = withCcrcProvenance([e.summary, e.checkpoints.map((c) => `- [ ] ${c.title}`).join('\n')].join('\n\n'));
    expect(unfitted.length).toBe(474);
  });

  it('a 474-character epic description is sent at 255 or less and ends with the provenance line', () => {
    const d = descriptionOf(createOf(longSnap(), 'projectCreate'));
    expect(d.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect(d.endsWith(PROVENANCE_TAIL)).toBe(true);
    expect(d.startsWith('This epic carries the work')).toBe(true);
  });

  it('a long inShort gives an initiative description of 255 or less', () => {
    const s = snap({ inShort: 'The programme in short: '.repeat(20), doneWhen: ['The first thing is proved', 'The second thing is proved'] });
    expect(initiativeDescription(s).length).toBeGreaterThan(0);
    const d = descriptionOf(createOf(s, 'initiativeCreate'));
    expect(d.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect(d.endsWith(PROVENANCE_TAIL)).toBe(true);
    expect(d).toBe(initiativeDescription(s));
  });

  it('a description that already fits is sent unchanged, and its fingerprint is unchanged', () => {
    const s = snap({ cps: [cp(1, 'Checkpoint one')] });
    const step = createOf(s, 'projectCreate');
    // The text and the fingerprint wave 3 (#2941) wrote for this epic, measured before the fit existed.
    expect(descriptionOf(step)).toBe(`The summary\n\n- [ ] Checkpoint one${PROVENANCE_TAIL}`);
    expect(step.fingerprint).toBe(SHORT_EPIC_FINGERPRINT);
    const fits = 'Body that fits.\n\nWith a second paragraph.';
    expect(fitLinearDescription(fits)).toBe(withCcrcProvenance(fits));
  });

  it('a body exactly at the bound is unchanged, and one more character cuts it', () => {
    const room = LINEAR_DESCRIPTION_MAX_CHARS - PROVENANCE_TAIL.length;
    const atBound = 'a'.repeat(room);
    expect(fitLinearDescription(atBound)).toBe(`${atBound}${PROVENANCE_TAIL}`);
    expect(fitLinearDescription(atBound).length).toBe(LINEAR_DESCRIPTION_MAX_CHARS);
    const over = fitLinearDescription(`${atBound}b`);
    expect(over.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect(over.endsWith(`…${PROVENANCE_TAIL}`)).toBe(true);
  });

  it('a cut body ends with … before the provenance line, its trailing whitespace trimmed', () => {
    const d = projectDescription({ ...epic({ summary: LONG_SUMMARY }), checkpoints: LONG_CPS }, 'The programme', false);
    expect(d.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    const body = d.slice(0, -PROVENANCE_TAIL.length);
    expect(body.endsWith('…')).toBe(true);
    expect(body.slice(0, -1)).toBe(body.slice(0, -1).trimEnd());
    // The cut falls just after two spaces: they are trimmed before the `…`.
    const room = LINEAR_DESCRIPTION_MAX_CHARS - `…${PROVENANCE_TAIL}`.length;
    const spaced = fitLinearDescription(`${'x'.repeat(room - 2)}  ${'y'.repeat(50)}`);
    expect(spaced).toBe(`${'x'.repeat(room - 2)}…${PROVENANCE_TAIL}`);
  });

  it('a body of astral characters is never cut inside a surrogate pair', () => {
    for (const lead of ['', 'x']) {
      const d = fitLinearDescription(`${lead}${'𝔸'.repeat(200)}`);
      expect(d.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
      expect(d.endsWith(PROVENANCE_TAIL)).toBe(true);
      // In `u` mode a whole pair is one code point outside this range, so only a lone surrogate matches.
      expect(d).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(d.slice(0, -PROVENANCE_TAIL.length).endsWith('𝔸…')).toBe(true);
    }
  });
});

// Fix round 1 of the review (run 2364), each case seen red first.
const ROOM = LINEAR_DESCRIPTION_MAX_CHARS - `…${PROVENANCE_TAIL}`.length;
/** A tracker id the public-text gate refuses, placed so the fit's cut leaves only `AA…` of it in the sent text. */
const STRADDLE = `${'w'.repeat(ROOM - 3)} AAA-123 is the ticket`;
type Skip = Extract<SyncStep, { kind: 'skip' }>;
const skipOf = (s: SyncSnapshot, kind: string): Skip | undefined =>
  planSyncSteps(s).steps.find((x): x is Skip => x.kind === 'skip' && x.local.kind === kind);

describe('F1: the public-text gate judges the unfitted text as well as the sent one', () => {
  it('the straddling fixture is cut inside the id', () => {
    const d = fitLinearDescription(STRADDLE);
    expect(d).toContain(' AA…');
    expect(d).not.toContain('AAA-123');
  });

  it('an initiative whose In short carries an id across the cut is refused text-public', () => {
    const s = snap({ mode: 'public', inShort: STRADDLE });
    expect(skipOf(s, 'programme')).toMatchObject({ why: 'text-public' });
    expect(planSyncSteps(s).steps.some((x) => x.kind === 'create' && x.op === 'initiativeCreate')).toBe(false);
  });

  it('a project whose summary carries an id across the cut is refused text-public', () => {
    const s = snap({ mode: 'public', epic: { summary: STRADDLE } });
    expect(skipOf(s, 'epic')).toMatchObject({ why: 'text-public' });
  });

  it('a project whose title carries an id across the name cut is refused text-public', () => {
    const s = snap({ mode: 'public', epic: { title: `${'w'.repeat(76)} AAA-123` } });
    expect(skipOf(s, 'epic')).toMatchObject({ why: 'text-public' });
  });

  it('a milestone whose dropped reason carries an id across the cut is refused text-public', () => {
    const dropped: CheckpointRow = { ...cp(1, 'Checkpoint one'), state: 'dropped', droppedWhy: STRADDLE };
    const s = snap({ mode: 'public', cps: [dropped] });
    const bound = createOf(snap({ mode: 'public' }), 'projectCreate');
    const withProject: SyncSnapshot = { ...s, bindings: [{
      id: 111, workspaceId: WS, teamKey: 'AAA', localKind: 'epic', localId: 1, linearId: U(501), identifier: null, fingerprint: bound.fingerprint,
      syncedAt: 1, state: 'bound', failedAt: null, failedWord: null, failedInputs: null, driftCount: 0, driftSince: null, heldItemId: null,
    }, {
      id: 121, workspaceId: WS, teamKey: 'AAA', localKind: 'checkpoint', localId: 1, linearId: U(601), identifier: null, fingerprint: 'stale',
      syncedAt: 1, state: 'bound', failedAt: null, failedWord: null, failedInputs: null, driftCount: 0, driftSince: null, heldItemId: null,
    }] };
    expect(skipOf(withProject, 'checkpoint')).toMatchObject({ why: 'text-public' });
  });
});

describe('F2: the status notes come first, so the cut never takes one', () => {
  const LONG = 'v'.repeat(240);
  it('a Paused note on a long initiative changes the sent text and its fingerprint, and is in it', () => {
    const plain = createOf(snap({ inShort: LONG }), 'initiativeCreate');
    const paused = createOf(snap({ inShort: LONG, paused: true }), 'initiativeCreate');
    expect(descriptionOf(paused)).toContain('Paused: this programme is paused in ccrc.');
    expect(descriptionOf(paused)).not.toBe(descriptionOf(plain));
    expect(paused.fingerprint).not.toBe(plain.fingerprint);
    expect(descriptionOf(paused).length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
  });

  it('an Abandoned note on a long initiative is in the sent text', () => {
    const s = snap({ inShort: LONG });
    s.program.end = { outcome: 'abandoned', why: 'the work moved', at: Date.UTC(2026, 10, 3) };
    expect(initiativeDescription(s)).toContain('Abandoned on 2026-11-03: the work moved');
  });

  it('a Dropped note on a long project changes the sent text and its fingerprint, and is in it', () => {
    const e = { ...epic({ summary: LONG }), checkpoints: [] };
    const plain = projectDescription(e, 'The programme', false);
    const dropped = projectDescription({ ...e, state: 'dropped', droppedWhy: 'not needed now' }, 'The programme', false);
    expect(dropped).toContain('Dropped: not needed now');
    expect(dropped).not.toBe(plain);
    expect(plannedFingerprint({ description: dropped })).not.toBe(plannedFingerprint({ description: plain }));
  });

  it('a Part of note on a long project (initiatives off) changes the sent text and its fingerprint, and is in it', () => {
    const plain = createOf(snap({ epic: { summary: LONG }, initiatives: 'on' }), 'projectCreate');
    const partOf = createOf(snap({ epic: { summary: LONG }, initiatives: 'off' }), 'projectCreate');
    expect(descriptionOf(partOf)).toContain('Part of The programme.');
    expect(descriptionOf(partOf)).not.toBe(descriptionOf(plain));
    expect(partOf.fingerprint).not.toBe(plain.fingerprint);
  });

  it('a note longer than the room is itself cut, with the ellipsis and the provenance line kept', () => {
    const e = { ...epic({ summary: 'The summary' }), checkpoints: [], state: 'dropped' as const, droppedWhy: 'r'.repeat(400) };
    const d = projectDescription(e, 'The programme', false);
    expect(d.length).toBe(LINEAR_DESCRIPTION_MAX_CHARS);
    expect(d.startsWith('Dropped: rrr')).toBe(true);
    expect(d.endsWith(`r…${PROVENANCE_TAIL}`)).toBe(true);
  });
});

describe('A1, A2, A3, A7: the fitter\'s edges', () => {
  it('A1: a body ending with the provenance line and trailing whitespace is never doubled', () => {
    const body = `x${PROVENANCE_TAIL}${' '.repeat(250)}`;
    expect(fitLinearDescription(body)).toBe(`x${PROVENANCE_TAIL}`);
  });

  it('A2: a non-ASCII body (em dashes, ellipses, an astral character) is bounded in UTF-16 units and in code points', () => {
    // The astral character (two UTF-16 units, one code point) makes the two counts differ, so each bound means something
    // (the review of #2973, run 2368).
    const d = fitLinearDescription('A step — then another… \u{1F680} '.repeat(20));
    expect(d.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect([...d].length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect([...d].length).toBeLessThan(d.length);
    expect(d).toContain('\u{1F680}');
    expect(d).toContain('—');
    expect(d.endsWith(`…${PROVENANCE_TAIL}`)).toBe(true);
  });

  it('A3: the cap is the literal 255: a text that would be 256 is cut to 255 or less', () => {
    const body = 'q'.repeat(256 - PROVENANCE_TAIL.length);
    expect(withCcrcProvenance(body).length).toBe(256);
    expect(fitLinearDescription(body).length).toBeLessThanOrEqual(255);
    expect(fitLinearDescription('q'.repeat(255 - PROVENANCE_TAIL.length)).length).toBe(255);
  });

  it('A7: a milestone description is fitted, Kind first and the dropped reason cut', () => {
    const c: CheckpointRow = { ...cp(1, 'Checkpoint one'), state: 'dropped', droppedWhy: 'r'.repeat(500) };
    const d = milestoneDescription(c);
    expect(d.length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    expect(d.startsWith('Kind: acceptance\n\nDropped: rrr')).toBe(true);
    expect(d.endsWith(`…${PROVENANCE_TAIL}`)).toBe(true);
    expect(milestoneDescription(cp(1, 'Checkpoint one'))).toBe(`Kind: acceptance${PROVENANCE_TAIL}`);
  });
});

// Measured on main at 96bfc150b, before the fit: the fingerprint of the short epic's project create.
const SHORT_EPIC_FINGERPRINT = '1e563b359dab678b';

// The review of #2973 (run 2368), carried to wave 4 (D-8183): what the fix left untested.
describe('the fitter is stable, and a fitted note reads current', () => {
  it('fitting is idempotent: a fitted text fits to itself', () => {
    for (const body of ['short', LONG_SUMMARY.repeat(3), '\u{1F680}'.repeat(300), `x${PROVENANCE_TAIL}`]) {
      const once = fitLinearDescription(body);
      expect(fitLinearDescription(once)).toBe(once);
    }
  });

  it('a bound description carrying a note takes one update, then none on the next pass', () => {
    const s = snap({ epic: { summary: LONG_SUMMARY.repeat(3), state: 'dropped', droppedWhy: 'not needed now' }, initiatives: 'off' });
    const bound = {
      id: 40, localKind: 'epic' as const, localId: 1, workspaceId: WS, teamKey: 'AAA', linearId: U(40), identifier: null,
      fingerprint: 'stored-before-the-fit', syncedAt: 1, state: 'bound' as const, failedAt: null, failedWord: null, failedInputs: null,
      driftCount: 0, driftSince: null, heldItemId: null,
    };
    s.bindings = [bound];
    const first = planSyncSteps(s).steps.filter((x) => x.kind === 'update' && x.bindingId === 40);
    expect(first).toHaveLength(1);
    const update = first[0] as Extract<SyncStep, { kind: 'update' }>;
    expect(String(update.input['description'])).toContain('Dropped: not needed now');
    expect(String(update.input['description']).length).toBeLessThanOrEqual(LINEAR_DESCRIPTION_MAX_CHARS);
    s.bindings = [{ ...bound, fingerprint: update.fingerprint }];
    expect(planSyncSteps(s).steps.filter((x) => 'bindingId' in x && x.bindingId === 40)).toEqual([]);
  });
});
