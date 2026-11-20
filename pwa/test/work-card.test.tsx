// The Work card (programme work map WM3, D-8806; spec 2026-11-16 §5 and §5.1; R129: a stage is a phase; R130: phases lead).
// The card takes the server's answer as a prop and draws it: it reads no store and no route, and decides nothing, so every case
// hands it a `WorkAnswer` of its own. Neutral names only (`prog-a`, `Epic A`): the repository is public. Time is faked at Date
// alone, so no query or event here waits on a timer.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WORK_COUNTED_GROUPS, WORK_GROUPS, WORK_STATUSES, type WorkAnswer, type WorkEpicView, type WorkGroup, type WorkItemView, type WorkMapView, type WorkPhaseView, type WorkStatus } from '../../shared/plan';
import { WorkCard } from '../src/ledgers/WorkCard';
import {
  NOTES, carriedWords, carriedTargetsOf, doneWhenLine, epicChip, foldLabel, headline, initiativeNote, outstandingLine, phaseLine, sourceLine, statusWord,
  unreadableNote, untitledWords, wholeEpicLine,
} from '../src/ledgers/workMapWords';
import { effectiveValue, stripComments } from './cssRule';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const DAY_ONE = Date.UTC(2026, 10, 2, 12);   // 2026-11-02

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'], now: NOW }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const zero = (over: Partial<Record<WorkGroup, number>> = {}): Record<WorkGroup, number> =>
  Object.fromEntries(WORK_GROUPS.map((g) => [g, over[g] ?? 0])) as Record<WorkGroup, number>;

const GROUP_OF: Record<WorkStatus, WorkGroup> = {
  dropped: 'dropped', closed: 'closed', done: 'done', 'done-unverified': 'held', 'left-open': 'left-open', 'waiting-on-you': 'waiting-on-you',
  stuck: 'held', blocked: 'held', working: 'in-progress', 'state-unknown': 'in-progress', 'in-review': 'in-progress', merging: 'in-progress',
  queued: 'in-progress', 'not-started': 'not-started', failed: 'failed',
};
const EPIC_A = { key: 'epic-a', title: 'Epic A' };
const EPIC_B = { key: 'epic-b', title: 'Epic B' };

const item = (key: string, status: WorkStatus, over: Partial<WorkItemView> = {}): WorkItemView => ({
  key, title: `Ticket ${key}`, status, group: GROUP_OF[status], reason: null, epic: EPIC_A, phases: [], runId: null, wave: null, doneAt: null,
  itemIds: [], lastFailedRunId: null, ...over,
});
const phase = (key: string, number: number, over: Partial<WorkPhaseView> = {}): WorkPhaseView => ({
  key, number, title: `Phase title ${number}`, summary: '', finish: null, counts: zero(), carried: 0, carriedOut: [], wholeEpics: [], items: [], ...over,
});
const epic = (e: { key: string; title: string }, over: Partial<WorkEpicView> = {}): WorkEpicView => ({
  ...e, done: 0, total: 0, url: null, dropped: false, checkpointsMet: 0, checkpointsTotal: 0, checkpoints: [], items: [], ...over,
});
const view = (over: Partial<WorkMapView> = {}): WorkMapView => ({
  source: 'plan', end: null, verdicts: 'read', counts: zero(), items: [], phases: [], notInPhase: [], epics: [], initiatives: [],
  doneWhen: [], beforePlan: null, runs: null, ...over,
});

const runHref = (id: number): string => `/runs/${id}`;
const itemHref = (id: number): string | null => (id === 404 ? null : `/waiting/${id}`);
const epicHref = (key: string): string => `/programmes/prog-a/epics/${key}`;
function draw(work: WorkAnswer | (WorkAnswer & { last?: WorkMapView | null }), readAt = NOW - MIN, withEpicHref = false) {
  return render(<WorkCard work={work as WorkAnswer} readAt={readAt} runHref={runHref} itemHref={itemHref} epicHref={withEpicHref ? epicHref : undefined} />);
}

/** A phased plan: phase 1 finished, phase 2 holds an outstanding ticket and one carried to phase 3, phase 3 takes epic B whole. */
function phased(): WorkMapView {
  const t1 = item('t-1', 'done', { phases: [{ key: 'p1', number: 1, carriedTo: null, carriedFrom: [] }], doneAt: DAY_ONE });
  const t2 = item('t-2', 'working', { runId: 12, lastMoveAt: NOW - 3 * MIN, phases: [{ key: 'p2', number: 2, carriedTo: null, carriedFrom: [] }] });
  const t3 = item('t-3', 'not-started', {
    epic: EPIC_B,
    phases: [{ key: 'p2', number: 2, carriedTo: { key: 'p3', number: 3 }, carriedFrom: [] }, { key: 'p3', number: 3, carriedTo: null, carriedFrom: [{ key: 'p2', number: 2 }] }],
  });
  const t4 = item('t-4', 'waiting-on-you', { epic: EPIC_B, itemIds: [7], phases: [{ key: 'p3', number: 3, carriedTo: null, carriedFrom: [] }] });
  return view({
    counts: zero({ done: 1, 'in-progress': 1, 'waiting-on-you': 1, 'not-started': 1 }),
    items: [t1, t2, t3, t4],
    phases: [
      phase('p1', 1, { finish: { at: DAY_ONE }, counts: zero({ done: 1 }), items: ['t-1'] }),
      phase('p2', 2, { counts: zero({ 'in-progress': 1 }), carried: 1, carriedOut: ['t-3'], items: ['t-2', 't-3'] }),
      phase('p3', 3, { counts: zero({ 'waiting-on-you': 1, 'not-started': 1 }), wholeEpics: ['epic-b'], items: ['t-3', 't-4'] }),
    ],
    epics: [
      epic(EPIC_A, { done: 1, total: 2, checkpointsMet: 1, checkpointsTotal: 2, url: 'https://linear.example/epic-a', items: ['t-1', 't-2'],
        checkpoints: [
          { key: 'c-1', title: 'Guide accepted', kind: 'acceptance', state: 'met', metAt: DAY_ONE, evidence: { pr: 88 }, url: null },
          { key: 'c-2', title: 'Operator switches it on', kind: 'operator-act', state: 'open', metAt: null, evidence: null, url: null },
        ] }),
      epic(EPIC_B, { done: 0, total: 2, items: ['t-3', 't-4'] }),
    ],
    doneWhen: [{ text: 'The card shows the plan', proved: true }, { text: 'Plans are declared', proved: false }, { text: 'Live check', proved: false }],
  });
}

describe('the headline and the outstanding line', () => {
  it('the headline reads N of M done', () => {
    draw(view({ counts: zero({ done: 11, 'in-progress': 3, 'waiting-on-you': 1, held: 2, 'not-started': 6 }) }));
    expect(screen.getByText('11 of 23 done')).toBeTruthy();
  });

  it('the outstanding line names waiting on you and held apart', () => {
    draw(view({ counts: zero({ done: 11, 'in-progress': 3, 'waiting-on-you': 1, held: 2, 'not-started': 6 }) }));
    expect(screen.getByText('3 in progress · 1 waiting on you · 2 held · 6 not started')).toBeTruthy();
  });

  it('the headline carries closed and left-open counts apart, in no N of M', () => {
    draw(view({ counts: zero({ done: 2, 'not-started': 1, closed: 2 }) }));
    expect(screen.getByText('2 of 3 done · 2 closed')).toBeTruthy();
  });
});

describe('the plan states of spec 5.1', () => {
  it('the no-plan card has no M and says what remains is not known', () => {
    const runs = [item('run-1', 'done', { title: null, wave: 1, epic: null }), item('run-2', 'working', { title: 'Wave two work', wave: 2, epic: null, runId: 2 })];
    const { container } = draw(view({ source: 'runs', counts: zero({ done: 38, 'in-progress': 1, failed: 2 }), runs: { items: runs, waves: { from: 1, to: 39 } } }));
    expect(screen.getByText('38 work runs done · 2 failed')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+ of \d+ done/);
    expect(screen.getByText('No plan declared, so what remains is not known. Below is the work run so far.')).toBeTruthy();
    expect(screen.getByText('Wave two work')).toBeTruthy();
  });

  it('a no-plan run with no title reads Wave N', () => {
    draw(view({ source: 'runs', counts: zero({ 'in-progress': 1 }), runs: { items: [item('run-9', 'working', { title: null, wave: 9, epic: null, runId: 9 })], waves: { from: 9, to: 9 } } }));
    expect(screen.getByText('Wave 9')).toBeTruthy();
  });

  it('a declared empty plan says so and draws no runs', () => {
    const stray = item('run-1', 'done', { title: 'A stray run', epic: null });
    const { container } = draw(view({ source: 'declared-empty', epics: [epic(EPIC_A)], runs: { items: [stray], waves: { from: 1, to: 1 } } }));
    expect(screen.getByText('The plan is declared but lists no work yet.')).toBeTruthy();
    expect(container.querySelector('.wk-headline')).toBeNull();
    expect(screen.queryByText('A stray run')).toBeNull();
    expect(screen.queryByText(/No plan declared/)).toBeNull();
    expect(container.querySelector('.wk-runs')).toBeNull();
    expect(screen.getByRole('button', { name: /Epic A/ })).toBeTruthy();
  });

  it('an ended plan says how it ended and shows no outstanding work', () => {
    const done = item('t-1', 'done');
    const left = item('t-2', 'left-open');
    const stale = item('t-3', 'left-open', { reason: 'no evidence stored' });
    const { container } = draw(view({
      source: 'ended', end: { outcome: 'abandoned', why: 'scope changed', at: DAY_ONE }, counts: zero({ done: 1, 'left-open': 2 }),
      items: [done, left, stale], epics: [epic(EPIC_A, { done: 1, total: 1, items: ['t-1', 't-2', 't-3'] })],
    }));
    expect(container.querySelector('.wk-headline')?.textContent).toBe('Plan abandoned on 2026-11-02: scope changed · 1 done · 2 left open');
    expect(container.querySelector('.wk-outstanding')).toBeNull();
    expect(screen.getAllByText('left open').length).toBeGreaterThan(0);
  });

  it('an ended plan draws no outstanding line even when the view still counts outstanding work (review 2873 F5)', () => {
    const { container } = draw(view({
      source: 'ended', end: { outcome: 'done', why: null, at: DAY_ONE }, counts: zero({ done: 1, 'in-progress': 2, 'not-started': 1 }),
      items: [item('t-1', 'done')], epics: [epic(EPIC_A, { done: 1, total: 4, items: ['t-1'] })],
    }));
    expect(container.querySelector('.wk-outstanding')).toBeNull();
  });

  it('an ended plan\'s bar shows its left-open work, so it is never all done (D-8806 bar-shows-left-open)', () => {
    const { container } = draw(view({
      source: 'ended', end: { outcome: 'abandoned', why: null, at: DAY_ONE }, counts: zero({ done: 1, 'left-open': 3 }),
      items: [item('t-1', 'done'), item('t-2', 'left-open')], epics: [epic(EPIC_A, { done: 1, total: 1, items: ['t-1', 't-2'] })],
    }));
    expect([...container.querySelectorAll('.wk-seg')].map((el) => el.getAttribute('data-group'))).toEqual(['done', 'left-open']);
  });

  it('an ended plan words the left-open status WM2 sends for a ticket marked done whose evidence does not verify, and draws no outstanding line', () => {
    const stale = item('t-3', 'left-open', { reason: 'no evidence stored' });
    const { container } = draw(view({
      source: 'ended', end: { outcome: 'done', why: null, at: DAY_ONE }, counts: zero({ 'left-open': 1 }), items: [stale],
      epics: [epic(EPIC_A, { total: 0, items: ['t-3'] })],
    }));
    expect(screen.getByText(/^Plan closed as done on 2026-11-02/)).toBeTruthy();
    expect(screen.getByText('left open')).toBeTruthy();
    expect(screen.queryByText('marked done, but')).toBeNull();
    expect(container.querySelector('.wk-outstanding')).toBeNull();
  });

  it('an unreadable answer says so, with the reason in words for each of the two failures', () => {
    draw({ unreadable: 'read-failed' });
    expect(screen.getByRole('alert').textContent).toBe('The work could not be read: a read failed');
    cleanup();
    draw({ unreadable: 'run-unreadable' });
    expect(screen.getByRole('alert').textContent).toBe('The work could not be read: the runs could not be read');
    expect(unreadableNote('run-unreadable')).toBe('The work could not be read: the runs could not be read');
  });

  it('an unreadable answer draws its note over the view the page passes in', () => {
    draw({ unreadable: 'run-unreadable', last: phased() } as WorkAnswer);
    expect(screen.getByRole('alert').textContent).toMatch(/^The work could not be read: /);
    expect(screen.getByText('1 of 4 done')).toBeTruthy();
  });

  it('verdicts not read are named on the source line', () => {
    draw(view({ verdicts: 'not-read', counts: zero({ 'not-started': 1 }) }));
    expect(screen.getByText(/stuck and blocked not read yet/)).toBeTruthy();
  });

  it('a plan with no phases says it is grouped by epic', () => {
    const t = item('t-1', 'not-started');
    draw(view({ counts: zero({ 'not-started': 1 }), items: [t], epics: [epic(EPIC_A, { total: 1, items: ['t-1'], checkpointsTotal: 2, checkpointsMet: 1 })] }));
    expect(screen.getByText('No phases declared: grouped by epic')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Epic A/ })).toBeTruthy();
    expect(screen.getByText('Ticket t-1')).toBeTruthy();
  });

  it('a plan whose tickets are all dropped draws no no-phases note (review 2873 F12)', () => {
    draw(view({ source: 'ended', end: { outcome: 'abandoned', why: null, at: DAY_ONE }, counts: zero({ dropped: 2 }), items: [item('t-1', 'dropped'), item('t-2', 'dropped')] }));
    expect(screen.queryByText(NOTES.noPhases)).toBeNull();
  });

  it('work runs from before the plan are one folded line, in no N of M', () => {
    const { container } = draw(view({ counts: zero({ 'not-started': 1 }), beforePlan: { runs: 61 }, items: [item('t-1', 'not-started')], epics: [epic(EPIC_A, { total: 1, items: ['t-1'] })] }));
    expect(screen.getByText('Before the plan · 61 work runs')).toBeTruthy();
    expect(container.textContent).toContain('0 of 1 done');
  });
});

describe('the phases', () => {
  it('a finished phase is one line with its date', () => {
    const { container } = draw(phased());
    const first = container.querySelector('[data-phase="p1"]');
    expect(first?.querySelector('summary')?.textContent).toMatch(/Phase 1.*Phase title 1.*finished 2026-11-02/);
    expect(first?.hasAttribute('open')).toBe(false);
  });

  it('a finished phase keeps a heading inside its summary, so a heading list reaches it (review 2873 F13)', () => {
    const { container } = draw(phased());
    const h = container.querySelector('[data-phase="p1"] > summary h3');
    expect(h?.textContent).toMatch(/Phase 1.*Phase title 1/);
    expect(container.querySelectorAll('h3').length).toBeGreaterThanOrEqual(3);
  });

  it('an abandoned plan\'s phase holding only a left-open ticket says so, never "no work of its own yet" (review 2873 F1)', () => {
    const t = item('t-1', 'left-open', { phases: [{ key: 'p1', number: 1, carriedTo: null, carriedFrom: [] }] });
    const { container } = draw(view({
      source: 'ended', end: { outcome: 'abandoned', why: null, at: DAY_ONE }, counts: zero({ 'left-open': 1 }), items: [t],
      phases: [phase('p1', 1, { counts: zero({ 'left-open': 1 }), items: ['t-1'] })], epics: [epic(EPIC_A, { items: ['t-1'] })],
    }));
    const line = container.querySelector('[data-phase="p1"] .wk-phase-line')?.textContent;
    expect(line).toBe('1 left open');
    expect(container.querySelector('[data-phase="p1"]')?.tagName).toBe('SECTION');
  });

  it('an abandoned plan\'s phase holding only a closed ticket says closed, never "no work of its own yet" (review 2873 F1)', () => {
    const t = item('t-1', 'closed', { reason: 'not needed', phases: [{ key: 'p1', number: 1, carriedTo: null, carriedFrom: [] }] });
    const { container } = draw(view({
      source: 'ended', end: { outcome: 'abandoned', why: null, at: DAY_ONE }, counts: zero({ closed: 1 }), items: [t],
      phases: [phase('p1', 1, { counts: zero({ closed: 1 }), items: ['t-1'] })], epics: [epic(EPIC_A, { items: ['t-1'] })],
    }));
    expect(container.querySelector('[data-phase="p1"] .wk-phase-line')?.textContent).toBe('1 closed');
  });

  it('a closed ticket with a recorded carry reads closed in its phase and is never drawn carried (review 2873 F2, Table 6a)', () => {
    const v = phased();
    const closed = item('t-5', 'closed', {
      reason: 'dropped from scope', phases: [{ key: 'p2', number: 2, carriedTo: { key: 'p4', number: 4 }, carriedFrom: [] }],
    });
    v.items.push(closed);
    v.counts = zero({ done: 1, 'in-progress': 1, 'waiting-on-you': 1, 'not-started': 1, closed: 1 });
    // WM2 serves p2's carry count as 1 and its carried-out keys as t-3 alone: the closed ticket is in neither.
    v.phases[1] = { ...v.phases[1]!, items: ['t-2', 't-3', 't-5'], counts: zero({ 'in-progress': 1, closed: 1 }), carried: 1, carriedOut: ['t-3'] };
    const { container } = draw(v);
    const row = container.querySelector('[data-phase="p2"] [data-ticket="t-5"]') as HTMLElement;
    expect(row.getAttribute('data-status')).toBe('closed');
    expect(within(row).getByText('closed')).toBeTruthy();
    expect(within(row).queryByText('carried')).toBeNull();
    expect(row.textContent).not.toContain('carried to');
    expect(container.querySelector('[data-phase="p2"] .wk-phase-line')?.textContent).toBe('0 of 1 done · 1 closed · 1 carried to phase 3');
  });

  it('a finish with no date says date unknown', () => {
    const v = phased();
    v.phases[0] = { ...v.phases[0]!, finish: { at: 'unknown' } };
    const { container } = draw(v);
    expect(container.querySelector('[data-phase="p1"] summary')?.textContent).toMatch(/finished, date unknown/);
  });

  it('phases lead: the phases come in order before the not-in-phase group and the Done when line', () => {
    const v = phased();
    v.notInPhase = ['t-5'];
    v.items.push(item('t-5', 'not-started', { epic: EPIC_B }));
    v.counts = zero({ done: 1, 'in-progress': 1, 'waiting-on-you': 1, 'not-started': 2 });
    const { container } = draw(v);
    const order = [...container.querySelectorAll('[data-phase], .wk-nophase, .wk-donewhen')].map((el) => el.getAttribute('data-phase') ?? el.className);
    expect(order).toEqual(['p1', 'p2', 'p3', 'wk-nophase', 'wk-donewhen']);
    expect(screen.getByText('Not in a phase')).toBeTruthy();
  });

  it('a phase that takes on a whole epic says so', () => {
    draw(phased());
    expect(screen.getByText(/takes on all of Epic B/)).toBeTruthy();
  });

  it('done tickets fold into one counted line', () => {
    const v = phased();
    const more = ['t-6', 't-7', 't-8'].map((k) => item(k, 'done', { phases: [{ key: 'p2', number: 2, carriedTo: null, carriedFrom: [] }], doneAt: DAY_ONE }));
    v.items.push(...more);
    v.phases[1] = { ...v.phases[1]!, items: [...v.phases[1]!.items, 't-6', 't-7', 't-8'], counts: zero({ 'in-progress': 1, done: 3 }) };
    const { container } = draw(v);
    const fold = container.querySelector('[data-phase="p2"] details.wk-done');
    expect(fold?.querySelector('summary')?.textContent).toBe('3 done');
    expect(fold?.hasAttribute('open')).toBe(false);
  });

  it('each ticket shows its epic', () => {
    const { container } = draw(phased());
    const row = container.querySelector('[data-ticket="t-2"]');
    expect(within(row as HTMLElement).getByText('Epic A')).toBeTruthy();
    expect(within(container.querySelector('[data-phase="p3"] [data-ticket="t-4"]') as HTMLElement).getByText('Epic B')).toBeTruthy();
  });

  it('a carried ticket reads carried to its later phase and from its earlier one', () => {
    const { container } = draw(phased());
    const out = container.querySelector('[data-phase="p2"] [data-ticket="t-3"]') as HTMLElement;
    expect(within(out).getByText('carried')).toBeTruthy();
    expect(within(out).getByText('carried to phase 3')).toBeTruthy();
    const into = container.querySelector('[data-phase="p3"] [data-ticket="t-3"]') as HTMLElement;
    expect(within(into).getByText('from phase 2')).toBeTruthy();
    expect(within(into).getByText('not started')).toBeTruthy();
    expect(screen.getByText('0 of 1 done · 1 carried to phase 3')).toBeTruthy();
  });

  it('a carried-out row keeps its status now beside the carry (spec Table 6a, review 2873 F11)', () => {
    const { container } = draw(phased());
    const facts = [...(container.querySelector('[data-phase="p2"] [data-ticket="t-3"] .wk-facts') as HTMLElement).querySelectorAll('.wk-fact')].map((el) => el.textContent);
    expect(facts).toEqual(['carried to phase 3', 'now not started']);
  });

  it('a carried-out marked-done ticket reads the carry, its status now, then the reason that finishes it', () => {
    const v = phased();
    v.items[2] = { ...v.items[2]!, status: 'done-unverified', group: 'held', reason: 'no evidence stored' };
    const { container } = draw(v);
    const facts = [...(container.querySelector('[data-phase="p2"] [data-ticket="t-3"] .wk-facts') as HTMLElement).querySelectorAll('.wk-fact')].map((el) => el.textContent);
    expect(facts).toEqual(['carried to phase 3', 'now marked done, but', 'no evidence stored']);
  });

  it('a marked-done ticket carried in reads its reason first, then where it came from (review 2873 F7)', () => {
    const v = phased();
    v.items[2] = { ...v.items[2]!, status: 'done-unverified', group: 'held', reason: 'no evidence stored' };
    const { container } = draw(v);
    const row = container.querySelector('[data-phase="p3"] [data-ticket="t-3"]') as HTMLElement;
    expect(within(row).getByText('marked done, but')).toBeTruthy();
    expect([...row.querySelectorAll('.wk-fact')].map((el) => el.textContent)).toEqual(['no evidence stored', 'from phase 2']);
  });

  it('a carry from a phase dropped since reads from phase <key>, dropped', () => {
    const v = phased();
    v.items[2] = { ...v.items[2]!, phases: [{ key: 'p3', number: 3, carriedTo: null, carriedFrom: [{ key: 'p-old', number: null }] }] };
    v.phases[1] = { ...v.phases[1]!, items: ['t-2'], carried: 0, carriedOut: [] };
    draw(v);
    expect(screen.getByText('from phase p-old, dropped')).toBeTruthy();
  });

  it('outstanding tickets come first in plan order, carried ones next', () => {
    const { container } = draw(phased());
    const keys = [...container.querySelectorAll('[data-phase="p2"] [data-ticket]')].map((el) => el.getAttribute('data-ticket'));
    expect(keys).toEqual(['t-2', 't-3']);
  });
});

describe('the epic strip', () => {
  it('a chip filters to its epic, shows its checkpoints, and a second tap clears it', () => {
    const { container } = draw(phased(), NOW - MIN, true);
    const chip = screen.getByRole('button', { name: /Epic A/ });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-ticket="t-4"]')).not.toBeNull();
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-ticket="t-4"]')).toBeNull();
    expect(container.querySelector('[data-ticket="t-2"]')).not.toBeNull();
    expect(container.querySelector('[data-phase="p3"]')).toBeNull();   // a phase with nothing of the epic is hidden
    const cps = screen.getByRole('group', { name: /Checkpoints of Epic A/ });
    expect(within(cps).getByText('Guide accepted')).toBeTruthy();
    expect(within(cps).getByText(/acceptance/)).toBeTruthy();
    expect(within(cps).getByText(/met 2026-11-02/)).toBeTruthy();
    expect(within(cps).getByText(/PR #88/)).toBeTruthy();
    expect(within(cps).getByText('Operator switches it on')).toBeTruthy();
    expect(within(cps).getByRole('link', { name: 'Open the epic' }).getAttribute('href')).toBe('/programmes/prog-a/epics/epic-a');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('group', { name: /Checkpoints of/ })).toBeNull();
    expect(container.querySelector('[data-ticket="t-4"]')).not.toBeNull();
  });

  it('a chip reads its title, its count and its checkpoints', () => {
    draw(phased());
    const chip = screen.getByRole('button', { name: /Epic A/ });
    expect(chip.textContent).toContain('1 of 2 · ◇ 1 of 2');
  });

  it('without epicHref the checkpoint row draws no epic link', () => {
    draw(phased());
    fireEvent.click(screen.getByRole('button', { name: /Epic A/ }));
    expect(screen.queryByRole('link', { name: 'Open the epic' })).toBeNull();
  });
});

describe('Done when, Linear and initiatives', () => {
  it('Done when counts the proved entries', () => {
    const { container } = draw(phased());
    const fold = container.querySelector('details.wk-donewhen') as HTMLElement;
    expect(fold.querySelector('summary')?.textContent).toBe('Done when · 1 of 3 proved');
    expect(within(fold).getByText(/The card shows the plan/).closest('li')?.querySelector('.wk-proved')?.textContent).toBe('proved');
    expect(within(fold).getByText(/Plans are declared/).closest('li')?.querySelector('.wk-proved')?.textContent).toBe('not proved');
  });

  it('no url draws no Open in Linear', () => {
    const v = phased();
    v.epics = v.epics.map((e) => ({ ...e, url: null }));
    draw(v);
    fireEvent.click(screen.getByRole('button', { name: /Epic A/ }));
    expect(screen.queryByText('Open in Linear')).toBeNull();
  });

  it('a url draws Open in Linear, on the epic chip row and once for each initiative', () => {
    const v = phased();
    v.initiatives = [{ workspaceId: 'ws-a', url: 'https://linear.example/i/a', state: 'bound' }, { workspaceId: 'ws-b', url: 'https://linear.example/i/b', state: 'bound' }];
    draw(v);
    expect(screen.getAllByRole('link', { name: /Open in Linear/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Epic A/ }));
    expect(screen.getAllByRole('link', { name: /Open in Linear/ })).toHaveLength(3);
  });

  it('an initiative not bound yet draws no line and no note', () => {
    const v = phased();
    v.initiatives = [{ workspaceId: 'ws-a', url: null, state: 'none' }];
    const { container } = draw(v);
    expect(container.querySelectorAll('.wk-initiative')).toHaveLength(0);
    expect(initiativeNote('none')).toBeNull();
  });

  it('initiatives off draws its note, one per workspace', () => {
    const v = phased();
    v.initiatives = [{ workspaceId: 'ws-a', url: null, state: 'off' }, { workspaceId: 'ws-b', url: null, state: 'off' }];
    const { container } = draw(v);
    expect(container.querySelectorAll('.wk-initiative')).toHaveLength(2);
    expect(screen.getAllByText(/Initiatives are off/)).toHaveLength(2);
  });
});

describe('a row and its facts', () => {
  it('a run link opens the run', () => {
    const { container } = draw(phased());
    const a = within(container.querySelector('[data-ticket="t-2"]') as HTMLElement).getByRole('link', { name: 'Run #12' });
    expect(a.getAttribute('href')).toBe('/runs/12');
    expect(container.querySelector('[data-ticket="t-2"]')?.textContent).toContain('moved 3m ago');
  });

  it('a run whose last move was not read draws no moved fact, and one with a move draws how long ago (review 2873 F4)', () => {
    const base = { runId: 12 };
    const { container } = draw(view({
      counts: zero({ 'in-progress': 3 }), epics: [epic(EPIC_A, { total: 3, items: ['t-a', 't-b', 't-c'] })],
      items: [item('t-a', 'working', base), item('t-b', 'working', { ...base, lastMoveAt: null }), item('t-c', 'working', { ...base, lastMoveAt: NOW - 3 * MIN })],
    }));
    expect(container.querySelector('[data-ticket="t-a"]')?.textContent).not.toMatch(/moved/);
    expect(container.querySelector('[data-ticket="t-b"]')?.textContent).not.toMatch(/moved/);
    expect(container.querySelector('[data-ticket="t-c"]')?.textContent).toContain('moved 3m ago');
  });

  it('a done ticket shows the date it was done', () => {
    const { container } = draw(phased());
    expect(container.querySelector('[data-ticket="t-1"]')?.textContent).toContain('done 2026-11-02');
  });

  it('an item link opens the item', () => {
    const { container } = draw(phased());
    const a = within(container.querySelector('[data-phase="p3"] [data-ticket="t-4"]') as HTMLElement).getByRole('link', { name: 'Item #7' });
    expect(a.getAttribute('href')).toBe('/waiting/7');
  });

  it('an item the page cannot open is text, not a link', () => {
    const v = phased();
    v.items[3] = { ...v.items[3]!, itemIds: [404] };
    const { container } = draw(v);
    const row = container.querySelector('[data-phase="p3"] [data-ticket="t-4"]') as HTMLElement;
    expect(within(row).queryByRole('link', { name: 'Item #404' })).toBeNull();
    expect(row.textContent).toContain('Item #404');
  });

  it('a ticket back at not started shows its last failed run', () => {
    const v = phased();
    v.items[2] = { ...v.items[2]!, lastFailedRunId: 31 };
    const { container } = draw(v);
    const row = container.querySelector('[data-phase="p3"] [data-ticket="t-3"]') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'last run failed' }).getAttribute('href')).toBe('/runs/31');
  });

  it('a marked-done ticket shows its reason', () => {
    const v = phased();
    v.items[1] = { ...v.items[1]!, status: 'done-unverified', group: 'held', reason: 'no evidence stored', runId: null };
    const { container } = draw(v);
    const row = container.querySelector('[data-ticket="t-2"]') as HTMLElement;
    expect(within(row).getByText('marked done, but')).toBeTruthy();
    expect(row.textContent).toContain('no evidence stored');
  });

  it('a long title wraps inside the card', () => {
    const css = stripComments(readFileSync(path.join(__dirname, '../src/ledgers/ledgers.css'), 'utf8'));
    for (const sel of ['.wk-card', '.wk-card .wk-what', '.wk-card .wk-ticket-title', '.wk-card .wk-epic', '.wk-card .wk-phase-title']) {
      expect(effectiveValue(css, sel, 'overflow-wrap'), sel).toBe('anywhere');
    }
    expect(effectiveValue(css, '.wk-card', 'min-width')).toBe('0');
    const v = phased();
    v.items[1] = { ...v.items[1]!, title: 'A'.repeat(400) };
    const { container } = draw(v);
    expect(container.querySelector('[data-ticket="t-2"] .wk-ticket-title')?.textContent).toHaveLength(400);
  });
});

describe('the card writes no word the operator struck out', () => {
  it('writes neither Programme nor coordinator, and no colour of its own', () => {
    const { container } = draw(phased());
    expect(container.textContent).not.toMatch(/programme/i);
    expect(container.textContent).not.toMatch(/coordinator/i);
    expect(container.querySelector('[style*="color"]')).toBeNull();
  });
});

describe('the words', () => {
  it('every status has a word', () => {
    for (const s of WORK_STATUSES) {
      const w = statusWord(s);
      expect(typeof w, s).toBe('string');
      expect(w.trim().length, s).toBeGreaterThan(0);
    }
    expect(new Set(WORK_STATUSES.map(statusWord)).size).toBe(WORK_STATUSES.length);
  });

  it('every status word is drawn for a row of that status', () => {
    for (const s of WORK_STATUSES.filter((x) => x !== 'dropped' && x !== 'done')) {
      cleanup();
      const row = item('t-x', s, { runId: s === 'working' ? 3 : null });
      const group = row.group;
      draw(view({ counts: zero({ [group]: 1 }), items: [row], epics: [epic(EPIC_A, { total: 1, items: ['t-x'] })] }));
      expect(screen.getByText(statusWord(s)), s).toBeTruthy();
    }
  });

  it('the exact words', () => {
    expect(statusWord('waiting-on-you')).toBe('waiting on you');
    expect(statusWord('done-unverified')).toBe('marked done, but');
    expect(statusWord('left-open')).toBe('left open');
    expect(statusWord('state-unknown')).toBe('state unknown');
    expect(statusWord('in-review')).toBe('in review');
    expect(statusWord('not-started')).toBe('not started');
    expect(carriedWords.status).toBe('carried');
    expect(carriedWords.to(3)).toBe('carried to phase 3');
    expect(carriedWords.from({ key: 'p-x', number: 2 })).toBe('from phase 2');
    expect(carriedWords.from({ key: 'p-x', number: null })).toBe('from phase p-x, dropped');
    expect(foldLabel(5)).toBe('5 done');
    expect(epicChip(epic(EPIC_A, { done: 5, total: 9, checkpointsMet: 1, checkpointsTotal: 2 }))).toBe('5 of 9 · ◇ 1 of 2');
    expect(epicChip(epic(EPIC_A, { done: 5, total: 9 }))).toBe('5 of 9');
    expect(doneWhenLine([{ text: 'a', proved: true }, { text: 'b', proved: false }])).toBe('Done when · 1 of 2 proved');
    expect(wholeEpicLine([epic(EPIC_B, { checkpointsTotal: 2, checkpointsMet: 1 })])).toBe('takes on all of Epic B (◇ 1 of 2)');
    expect(phaseLine(phase('p', 2, { counts: zero({ done: 5, 'in-progress': 3 }), carried: 1 }), [3])).toBe('5 of 8 done · 1 carried to phase 3');
    expect(phaseLine(phase('p', 2, { finish: { at: DAY_ONE } }), [])).toBe('finished 2026-11-02');
    expect(phaseLine(phase('p', 2, { finish: { at: 'unknown' } }), [])).toBe('finished, date unknown');
    expect(headline(view({ counts: zero({ done: 11, 'in-progress': 10 }) }))).toBe('11 of 21 done');
    expect(outstandingLine(view({ counts: zero({ 'in-progress': 3, 'not-started': 6 }) }))).toBe('3 in progress · 6 not started');
    expect(sourceLine(view({ phases: [phase('p1', 1), phase('p2', 2), phase('p3', 3)], epics: [epic(EPIC_A), epic(EPIC_B), epic({ key: 'c', title: 'C' })] }), NOW - MIN, NOW)).toBe("From the plan · 3 phases · 3 epics · read 1m ago");
  });

  it('the phase line writes every group it holds, each apart, and "no work of its own yet" only for none (review 2873 F1)', () => {
    expect(phaseLine(phase('p', 1, { counts: zero({ 'left-open': 1 }) }), [])).toBe('1 left open');
    expect(phaseLine(phase('p', 1, { counts: zero({ closed: 1 }) }), [])).toBe('1 closed');
    expect(phaseLine(phase('p', 1, { counts: zero({ done: 3, 'left-open': 1 }) }), [])).toBe('3 of 3 done · 1 left open');
    expect(phaseLine(phase('p', 1, { counts: zero({ done: 3, closed: 1 }) }), [])).toBe('3 of 3 done · 1 closed');
    expect(phaseLine(phase('p', 1, { counts: zero({ done: 2, closed: 1, 'left-open': 2, 'not-started': 1 }), carried: 1 }), [4])).toBe('2 of 3 done · 1 closed · 2 left open · 1 carried to phase 4');
    expect(phaseLine(phase('p', 1, { carried: 2 }), [])).toBe('2 carried');
    expect(phaseLine(phase('p', 1), [])).toBe('no work of its own yet');
  });

  it('three or more carry targets read "2, 3 and 4", and a phase names only the tickets it carried out (review 2873 F11, F2)', () => {
    expect(phaseLine(phase('p', 1, { counts: zero({ done: 1 }), carried: 3 }), [2, 3, 4])).toBe('1 of 1 done · 3 carried to phases 2, 3 and 4');
    expect(phaseLine(phase('p', 1, { counts: zero({ done: 1 }), carried: 2 }), [2, 3])).toBe('1 of 1 done · 2 carried to phases 2 and 3');
    const a = item('a', 'not-started', { phases: [{ key: 'p1', number: 1, carriedTo: { key: 'p2', number: 2 }, carriedFrom: [] }] });
    const b = item('b', 'closed', { phases: [{ key: 'p1', number: 1, carriedTo: { key: 'p3', number: 3 }, carriedFrom: [] }] });
    expect(carriedTargetsOf({ key: 'p1', carriedOut: ['a'] }, [a, b])).toEqual([2]);
    expect(carriedTargetsOf({ key: 'p1', carriedOut: [] }, [a, b])).toEqual([]);
  });

  it('the headline counts exactly the groups the server counts, each of the others apart (review 2873 F3)', () => {
    for (const g of WORK_GROUPS) {
      const m = (WORK_COUNTED_GROUPS as readonly WorkGroup[]).includes(g) ? 1 : 0;
      expect(headline(view({ counts: zero({ [g]: 1 }) }))?.startsWith(`${g === 'done' ? 1 : 0} of ${m} done`), g).toBe(true);
    }
    for (const g of WORK_COUNTED_GROUPS.filter((x) => x !== 'done')) {
      expect(outstandingLine(view({ counts: zero({ [g]: 2 }) })), g).toMatch(/^2 [a-z ]+$/);
    }
  });

  it('the headline writes left-open and failed counts apart, and none for a declared-empty plan', () => {
    expect(headline(view({ counts: zero({ done: 1, 'left-open': 2, failed: 3 }) }))).toBe('1 of 1 done · 2 left open · 3 failed');
    expect(headline(view({ source: 'declared-empty' }))).toBeNull();
    expect(headline(view({ source: 'ended', end: { outcome: 'done', why: '', at: DAY_ONE }, counts: zero({ done: 2 }) }))).toBe('Plan closed as done on 2026-11-02 · 2 done');
    expect(headline(view({ source: 'runs', counts: zero({ done: 1 }) }))).toBe('1 work run done');
  });

  it('the source line spells one phase and one epic in the singular, and a row with no title falls back to its run', () => {
    expect(sourceLine(view({ phases: [phase('p1', 1)], epics: [epic(EPIC_A)] }), NOW - MIN, NOW)).toBe('From the plan · 1 phase · 1 epic · read 1m ago');
    expect(untitledWords({ wave: null, runId: 9, key: 'run-9' })).toBe('Run #9');
    expect(untitledWords({ wave: 4, runId: 9, key: 'run-9' })).toBe('Wave 4');
    expect(untitledWords({ wave: null, runId: null, key: 'k' })).toBe('k');
    expect(epicChip(epic(EPIC_A, { done: 1, total: 1, dropped: true }))).toBe('1 of 1 · dropped');
  });

  it('a day after the read reads in days', () => {
    expect(sourceLine(view(), NOW - DAY, NOW)).toContain('read 1d ago');
  });
});

describe('the layout rows of the plan table', () => {
  const css = stripComments(readFileSync(path.join(__dirname, '../src/ledgers/ledgers.css'), 'utf8'));
  it('a row is one column at 360 and 390, and one row from the wide layouts', () => {
    expect(css).toMatch(/\.wk-card \.wk-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/@container work \(min-width: 34rem\)\s*\{[^@]*\.wk-card \.wk-row\s*\{[^}]*grid-template-columns:[^}]*minmax\(0, 1fr\)/);
    expect(effectiveValue(css, '.wk-card .wk-strip', 'flex-wrap')).toBe('wrap');
  });
  it('colours are tokens only', () => {
    const own = css.slice(css.indexOf('.wk-card'));
    expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });
});
