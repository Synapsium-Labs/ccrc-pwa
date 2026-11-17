// D-8708 (Linear hierarchy plan, D-8182's plan sync): Linear refuses a project or initiative description over 255
// characters (INVALID_INPUT, measured live 2026-11-17), so both are fitted to LINEAR_DESCRIPTION_MAX_CHARS with the
// provenance line kept whole. Fixtures use neutral names only; no Linear call is made.
import { describe, expect, it } from 'vitest';
import type { CheckpointRow, EpicRow, StoredPlan } from '../src/coord/planStore.js';
import {
  fitLinearDescription, initiativeDescription, LINEAR_DESCRIPTION_MAX_CHARS, planSyncSteps, projectDescription, type SyncSnapshot, type SyncStep,
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

function snap(o: { epic?: Partial<EpicRow>; cps?: CheckpointRow[]; inShort?: string; doneWhen?: string[] } = {}): SyncSnapshot {
  const plan: StoredPlan = { program: 'prog', planBy: null, required: true, epics: [{ ...epic(o.epic), checkpoints: o.cps ?? [], tickets: [] }] };
  return {
    program: {
      slug: 'prog', rowid: 7, title: 'The programme', end: null, inShort: o.inShort ?? 'Short words',
      doneWhen: (o.doneWhen ?? ['It works']).map((text) => ({ text, proved: false })),
    },
    plan, bindings: [],
    workspaces: [{ workspaceId: WS, initiatives: 'on', directory, teams: [{ id: U(1), key: 'AAA' }] }],
    projects: [{ project: 'proj-a', teamKey: 'AAA', workspaceId: WS, mode: 'private', initiatives: 'on' }],
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

// Measured on main at 96bfc150b, before the fit: the fingerprint of the short epic's project create.
const SHORT_EPIC_FINGERPRINT = '1e563b359dab678b';
