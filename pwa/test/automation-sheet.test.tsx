// The editor sheet (spec §11) had NO test of any kind: 282 lines carrying the
// cadence picker, the `"HH:MM"` parse, the local `next fire:` preview and the
// whole create/edit round trip, imported by no suite. These are the tests that
// would have driven it, plus the four defects that shipped because nothing
// measured it:
//
//  - THE EDIT BRANCH HAD NO CALLER. `editing`, `editAutomation` and
//    `POST /api/automations/:id` all existed; nothing on the phone ever passed
//    `editing`, so an automation could be created and never changed.
//  - THE SHEET IS MOUNTED ONCE. Its `useState` initialisers run on mount, so a
//    second open re-showed the first open's half-typed form — and, once the
//    edit door existed, one row's values under another row's title.
//  - A SECOND SENTENCE TABLE. The preview carried its own copy of the three
//    schedule-error sentences under a docstring asserting it used the shared
//    one, and the two had already drifted.
//  - THE 409 DROPPED ITS `scheduleError`. Three conditions with three
//    different fixes rendered as one sentence.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AutomationSummary } from '../../shared/api';
import { AutomationSheet } from '../src/auto/AutomationSheet';
import { SCHEDULE_ERROR_SENTENCE } from '../src/auto/autoWords';
import { ApiError } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const NOW = Date.UTC(2026, 8, 7, 10, 0, 0);

const auto = (over: Partial<AutomationSummary> = {}): AutomationSummary => ({
  id: 1, name: 'nightly', state: 'paused', project: 'ccrc-pwa', prompt: 'go',
  cadenceKind: 'wall-clock', cadenceDays: 0b0111110, cadenceMinute: 540,
  cadenceEvery: null, tz: 'UTC',
  graceMs: 1_800_000, createdAt: 0, updatedAt: 0, provedAt: null,
  nextRunAt: null, scheduleError: null,
  lastFireAt: null, lastOutcome: null, lastRefusal: null,
  consecutiveFailures: 0, runsEvicted: 0,
  ...over,
} as AutomationSummary);

describe('the editor sheet composes a cadence and saves it', () => {
  it('sends the picker\'s own cadence, and no state field at all', async () => {
    const bodies: unknown[] = [];
    render(
      <AutomationSheet
        open
        onClose={() => { /* the caller closes on save */ }}
        onSaved={() => { /* ditto */ }}
        now={() => NOW}
        defaultTz="UTC"
        createAutomation={async (b) => { bodies.push(b); return { automation: auto() }; }}
      />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'nightly' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'ccrc-pwa' } });
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: 'weekdays' }));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '07:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(bodies.length).toBe(1); });
    expect(bodies[0]).toEqual({
      name: 'nightly', project: 'ccrc-pwa', prompt: 'go',
      // Mon..Fri, 07:30, the zone the field shows — and NO `state`: the create
      // route reads none, because §7's arm gate decides that server-side.
      cadence: { kind: 'wall-clock', days: 0b0111110, minuteOfDay: 450, tz: 'UTC' },
    });
  });

  it('previews the next fire from the SAME arithmetic the sweep runs', async () => {
    render(
      <AutomationSheet
        open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC"
      />,
    );
    // 09:00 daily, and "now" is 10:00 UTC — so the next one is tomorrow.
    expect(screen.getByText(/next fire: 2026-09-08 09:00 UTC/)).toBeInTheDocument();
  });

  it('renders an unschedulable cadence through the ONE sentence table', async () => {
    // The preview used to carry its own copy of these three sentences, and
    // the copies had drifted. Asserting the shared table's own string is what
    // makes a second copy a red suite rather than a cosmetic difference.
    render(
      <AutomationSheet
        open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="Not/AZone"
      />,
    );
    expect(screen.getByText(new RegExp(SCHEDULE_ERROR_SENTENCE['unknown-timezone'])))
      .toBeInTheDocument();
  });

  it('a 409 bad-schedule names WHICH schedule error, not just "refused"', async () => {
    render(
      <AutomationSheet
        open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC"
        createAutomation={async () => {
          throw new ApiError(409, { ok: false, error: 'bad-schedule', scheduleError: 'no-future-occurrence' });
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const err = await screen.findByRole('alert');
    expect(err.textContent, 'three conditions with three different fixes must not read as one')
      .toContain(SCHEDULE_ERROR_SENTENCE['no-future-occurrence']);
  });
});

describe('the sheet opens FRESH, and opens on the row it was asked for', () => {
  it('a second open does not re-show the first open\'s typing', async () => {
    const { rerender } = render(
      <AutomationSheet open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC" />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'half-typed thought' } });
    rerender(
      <AutomationSheet open={false} onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC" />,
    );
    rerender(
      <AutomationSheet open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC" />,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value,
      'a sheet mounted once keeps its state for ever; an operator who closed it expects a blank one')
      .toBe('');
  });

  it('follows a change of TARGET while it is open', async () => {
    // The other half of "fresh on every open", and the half the close/reopen
    // case cannot measure: the drawer unmounts its children when it closes,
    // so a reopen is already a fresh form — but a sheet whose `editing` prop
    // changes while it STAYS open keeps the old row's values without a key,
    // and then shows one automation's prompt under another's title.
    const a = auto({ id: 4, name: 'weekly-audit' });
    const b = auto({ id: 9, name: 'hourly-sweep' });
    const { rerender } = render(
      <AutomationSheet open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC" editing={a} />,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('weekly-audit');
    rerender(
      <AutomationSheet open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC" editing={b} />,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value,
      'the form must be the row it was asked for').toBe('hourly-sweep');
  });

  it('opens on the automation it is editing, and sends the EDIT call', async () => {
    const row = auto({ id: 4, name: 'weekly-audit', project: 'ccrc', prompt: 'audit', cadenceMinute: 450 });
    const edits: [number, unknown][] = [];
    render(
      <AutomationSheet
        open onClose={() => {}} onSaved={() => {}} now={() => NOW} defaultTz="UTC"
        editing={row}
        editAutomation={async (id, b) => { edits.push([id, b]); return { automation: row }; }}
      />,
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('weekly-audit');
    expect((screen.getByLabelText('Time') as HTMLInputElement).value).toBe('07:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(edits.length).toBe(1); });
    expect(edits[0]![0]).toBe(4);
    // No `graceMs` — and that ABSENCE now means "leave the stored one alone"
    // on the route, rather than the create default.
    expect(edits[0]![1]).not.toHaveProperty('graceMs');
  });
});
