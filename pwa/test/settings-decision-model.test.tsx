// Settings › Overlord's decision model (Overlord W2 Settings, plan `w2-settings.md` Task 2): the host card and the rows card, both
// drawn from ONE read of `GET /api/decision-model`. The console sends and the door decides: a move lands in one tap when the door
// asks nothing and shows the section's step when the door answers `step-up-required`, so every case here stubs the DOOR and holds
// the console to following it. A row is drawn from the read (its checked mode is the stored one, never a tap's); the key lives
// only in the accounts' secret field and is never in the markup, a store or a console call. The api object is spied; neutral
// names and a synthetic key only: the repository is public.
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  DECISION_QUESTIONS, DECISION_ROW_IDS, readDecisionModelView, type DecisionHeldCause, type DecisionModelView, type DecisionRowId,
  type DecisionRowSide, type DecisionRowView,
} from '../../shared/decisionModel';
import type { DesignationView } from '../../shared/overlord-designation';
import { ApiError, DECISION_MODEL_REFUSAL_TEXT, OVERLORD_SETTINGS_REFUSAL_TEXT, api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { DECISION_HELD_TEXT, DECISION_WORDS as W, rowAnswerWords } from '../src/overlord/decisionModelWords';
import type { ReadState } from '../src/overlord/readState';
import { OverlordSection } from '../src/screens/settings/OverlordSection';
import { useFleetStore } from '../src/stores/fleet';
import { useOverlordStore } from '../src/stores/overlord';
import { allFibers, fiberHolds } from './helpers/fiberWalk';

const AT = 1_700_000_000_000;
/** A synthetic value that looks like no provider's key. It is never in a test name. */
const KEY = 'zz-test-key-0123456789abcdef';
const ENDPOINT = 'https://host-a.example/v1/ask';
const HOST = { kind: 'local' as const, endpoint: ENDPOINT, origin: 'https://host-a.example', modelId: 'model-a' };
const designation: ReadState<DesignationView | null> = { state: 'answered', value: null, at: AT };
const stepUpRequired = (): ApiError => new ApiError(403, { ok: false, error: 'step-up-required' });
const refused = (status: number, error: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(status, { ok: false, error, ...extra });
/** An older server's 404 for the section's other reads, so their cards draw nothing here. */
const BACKSTOP = { absent: true } as const;

const sideOf = (over: Partial<DecisionRowSide> = {}): DecisionRowSide => ({ mode: 'off', ceiling: 600, armedLine: null, held: false, ...over });
const rowOf = (id: DecisionRowId, over: Partial<DecisionRowView> = {}): DecisionRowView => ({
  id, side: sideOf(), heldWhy: null, direction: DECISION_QUESTIONS[id].direction, privateState: DECISION_QUESTIONS[id].privateState,
  today: { serve: 3, maintenance: 1, reserved: 0, total: 4 }, line: null, offered: null, ...over,
});
const viewOf = (over: Partial<DecisionModelView> = {}): DecisionModelView => ({
  rows: [rowOf('programme.pick')], fleetToday: 4, fleetCap: 3000, host: HOST, key: { setAt: AT, masked: true }, ...over,
});
/** A row door's answer, as the server sends it: ok and the side it installed. */
const answerOf = (id: DecisionRowId, side: DecisionRowSide): Record<string, unknown> => ({ ok: true, row: id, side });
const OK = answerOf('programme.pick', sideOf());

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const client = () => ({
  stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }),
  stepUpFinish: vi.fn(),
  stepUpPassphrase: vi.fn().mockResolvedValue({ stepUpFreshUntil: Date.now() + 300_000 }),
});
let stepClient: ReturnType<typeof client>;
let refresh: Mock<() => Promise<void>>;
const spyDecision = () => vi.spyOn(api, 'decisionModel');
let decisionSpy: ReturnType<typeof spyDecision>;
let consoleSpies: ReturnType<typeof vi.spyOn>[];

function show(): ReturnType<typeof render> {
  act(() => useOverlordStore.setState({ caps: { state: 'answered', value: ['overlord-v1'], at: AT }, designation, refresh }));
  return render(<OverlordSection stepUpDeps={{ client: stepClient }} />);
}
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
/** Mounts the section over a read and lets it land. */
async function open(view: DecisionModelView | { absent: true } = viewOf()): Promise<void> {
  decisionSpy.mockResolvedValue(view);
  show();
  await settle();
}
const card = (name: string): HTMLElement => document.querySelector<HTMLElement>(`[data-settings-card="${name}"]`)!;
const rowEl = (id: DecisionRowId): HTMLElement => document.querySelector<HTMLElement>(`[data-decision-row="${id}"]`)!;
const pick = (id: DecisionRowId, label: 'Off' | 'Shadow' | 'Armed'): void => { fireEvent.click(within(rowEl(id)).getByRole('radio', { name: label })); };
const checkedOf = (id: DecisionRowId): string[] =>
  within(rowEl(id)).getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked).map((r) => r.closest('label')!.textContent!);
const ceilingField = (id: DecisionRowId): HTMLInputElement => rowEl(id).querySelector<HTMLInputElement>('[data-settings-input="decision-ceiling"]')!;
const ceilingSave = (id: DecisionRowId): HTMLButtonElement => rowEl(id).querySelector<HTMLButtonElement>('[data-settings-control="decision-ceiling-save"]')!;
const typeCeiling = (id: DecisionRowId, n: number | string): void => { fireEvent.change(ceilingField(id), { target: { value: String(n) } }); };
const control = (scope: HTMLElement, name: string): HTMLButtonElement => scope.querySelector<HTMLButtonElement>(`[data-settings-control="${name}"]`)!;
const confirmStep = async (): Promise<void> => {
  fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a passphrase' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
};
const keyField = (): HTMLInputElement => within(card('decision-host')).getByLabelText(W.keyLabel) as HTMLInputElement;
const typeKey = (): void => { fireEvent.input(keyField(), { target: { value: KEY } }); };
const hostSave = (): HTMLButtonElement => control(card('decision-host'), 'decision-host-save');
const dateOf = (ms: number): string => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const argsText = (calls: readonly (readonly unknown[])[]): string => calls.map((args) => args.map((a) => {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
  try { return JSON.stringify(a) ?? String(a); } catch { return String(a); }
}).join(' ')).join('\n');

/** The key is nowhere a page could keep it: not the markup, a store, a console call or browser storage. */
function nowhere(when: string): void {
  expect(document.documentElement.outerHTML, `${when}: markup`).not.toContain(KEY);
  expect(JSON.stringify(useOverlordStore.getState()), `${when}: the overlord store`).not.toContain(KEY);
  expect(JSON.stringify(useFleetStore.getState()), `${when}: the fleet store`).not.toContain(KEY);
  for (const s of [localStorage, sessionStorage]) {
    for (let k = 0; k < s.length; k += 1) {
      const name = s.key(k)!;
      expect(name + (s.getItem(name) ?? ''), `${when}: browser storage`).not.toContain(KEY);
    }
  }
  for (const spy of consoleSpies) expect(argsText(spy.mock.calls), `${when}: a console call`).not.toContain(KEY);
}

beforeEach(() => {
  refresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  stepClient = client();
  vi.spyOn(api, 'renewalBackstop').mockResolvedValue(BACKSTOP);
  vi.spyOn(api, 'responseRetention').mockResolvedValue(BACKSTOP);
  vi.spyOn(api, 'accountHolds').mockResolvedValue(BACKSTOP);
  vi.spyOn(api, 'privateNameList').mockResolvedValue({ absent: true });
  decisionSpy = spyDecision().mockResolvedValue(viewOf());
  consoleSpies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m));
  act(() => {
    useFleetStore.setState({ roster: [], accountsHeard: true, refreshAccounts: vi.fn().mockResolvedValue('ok') });
    navigate('/settings/overlord');
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

/** The page hidden or shown again: the key field's own rule empties it on hidden. */
const setVisibility = (state: 'hidden' | 'visible'): void => {
  act(() => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
};
const hostFinal = (): HTMLElement | null => card('decision-host').querySelector<HTMLElement>('[data-settings-refusal="decision-host-final"]');
const hostInputs = (): HTMLElement[] => ['decision-kind', 'decision-endpoint', 'decision-model-id']
  .map((n) => card('decision-host').querySelector<HTMLElement>(`[data-settings-input="${n}"]`)!);

// The key is never in React props or state: the shared fiber walk (`helpers/fiberWalk.ts`), over every fiber of the tree. The walk
// skips functions, so it cannot see a value kept in a closure; what the retry's closure may hold is pinned by source in
// `settings-retry-census.test.ts` (review 4167 F1, F6).
/** Every control of the host card a press or a keystroke reaches: the three host inputs, the key field, Save and Remove. */
const hostHeldControls = (): HTMLElement[] => [
  ...hostInputs(), keyField(), hostSave(), control(card('decision-host'), 'decision-key-remove'),
];
const allHeld = (els: readonly HTMLElement[], held: boolean, when: string): void => {
  for (const el of els) {
    const name = el.getAttribute('data-settings-input') ?? el.getAttribute('data-settings-control') ?? el.getAttribute('aria-label') ?? el.tagName;
    expect((el as HTMLInputElement).disabled, `${when}: ${name}`).toBe(held);
  }
};

describe('the rows card: a row is drawn from the read', () => {
  it('1a. each row\'s checked radio is the read\'s mode: off, shadow and armed', async () => {
    await open(viewOf({
      rows: [
        rowOf('programme.pick', { side: sideOf({ mode: 'off' }) }),
        rowOf('programme.any', { side: sideOf({ mode: 'shadow' }) }),
        rowOf('scope.widens', { side: sideOf({ mode: 'armed', armedLine: { id: 4, line: 0.9 } }) }),
      ],
    }));
    expect(checkedOf('programme.pick')).toEqual(['Off']);
    expect(checkedOf('programme.any')).toEqual(['Shadow']);
    expect(checkedOf('scope.widens')).toEqual(['Armed']);
  });

  it('1b. the checked radio stays the read\'s mode after a tap while the door is pending, and changes only once the read is read again', async () => {
    const door = deferred<unknown>();
    const arm = vi.spyOn(api, 'armDecisionRow').mockReturnValue(door.promise);
    decisionSpy.mockResolvedValueOnce(viewOf()).mockResolvedValue(viewOf({ rows: [rowOf('programme.pick', { side: sideOf({ mode: 'shadow' }) })] }));
    show();
    await settle();
    expect(checkedOf('programme.pick')).toEqual(['Off']);
    pick('programme.pick', 'Shadow');
    await settle();
    expect(arm).toHaveBeenCalledTimes(1);
    expect(checkedOf('programme.pick')).toEqual(['Off']);
    expect(decisionSpy).toHaveBeenCalledTimes(1);
    await act(async () => { door.resolve(answerOf('programme.pick', sideOf({ mode: 'shadow' }))); });
    await waitFor(() => expect(decisionSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(checkedOf('programme.pick')).toEqual(['Shadow']));
  });

  it('10. every row of the read is drawn with its state as given, never a default', async () => {
    const states: { mode: DecisionRowSide['mode']; ceiling: number; held: boolean }[] = [
      { mode: 'off', ceiling: 50, held: false }, { mode: 'shadow', ceiling: 777, held: false }, { mode: 'armed', ceiling: 5000, held: true },
      { mode: 'shadow', ceiling: 51, held: true }, { mode: 'off', ceiling: 4999, held: true }, { mode: 'armed', ceiling: 1234, held: false },
      { mode: 'shadow', ceiling: 600, held: false },
    ];
    expect(DECISION_ROW_IDS).toHaveLength(7);
    const rows = DECISION_ROW_IDS.map((id, i) => {
      const s = states[i]!;
      return rowOf(id, { side: sideOf({ ...s, armedLine: s.mode === 'armed' ? { id: i + 1, line: 0.9 } : null }), heldWhy: s.held ? 'drift' : null });
    });
    await open(viewOf({ rows }));
    expect(document.querySelectorAll('[data-decision-row]')).toHaveLength(7);
    DECISION_ROW_IDS.forEach((id, i) => {
      const s = states[i]!;
      expect(rowEl(id).getAttribute('data-decision-mode'), id).toBe(s.mode);
      expect(rowEl(id).getAttribute('data-decision-held'), id).toBe(s.held ? 'yes' : 'no');
      expect(ceilingField(id).value, id).toBe(String(s.ceiling));
      expect(checkedOf(id), id).toEqual([s.mode === 'off' ? 'Off' : s.mode === 'shadow' ? 'Shadow' : 'Armed']);
    });
  });
});

describe('the rows card: what each move sends', () => {
  it('2. shadow and armed call the arm door and off the off door, each with the row\'s side exactly as read; the checked radio calls nothing', async () => {
    const armed = sideOf({ mode: 'armed', ceiling: 1200, armedLine: { id: 4, line: 0.9 }, held: false });
    const off = sideOf({ mode: 'off', ceiling: 600 });
    const shadow = sideOf({ mode: 'shadow', ceiling: 700 });
    const arm = vi.spyOn(api, 'armDecisionRow').mockResolvedValue(OK);
    const offDoor = vi.spyOn(api, 'offDecisionRow').mockResolvedValue(OK);
    await open(viewOf({ rows: [rowOf('programme.pick', { side: off }), rowOf('programme.any', { side: shadow }), rowOf('scope.widens', { side: armed })] }));
    pick('programme.pick', 'Shadow');
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(1));
    expect(arm).toHaveBeenLastCalledWith('programme.pick', { mode: 'shadow', expected: off });
    await settle();
    pick('programme.pick', 'Armed');
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(2));
    expect(arm).toHaveBeenLastCalledWith('programme.pick', { mode: 'armed', expected: off });
    await settle();
    pick('programme.any', 'Off');
    await waitFor(() => expect(offDoor).toHaveBeenCalledTimes(1));
    expect(offDoor).toHaveBeenLastCalledWith('programme.any', { expected: shadow });
    await settle();
    pick('scope.widens', 'Shadow');
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(3));
    expect(arm).toHaveBeenLastCalledWith('scope.widens', { mode: 'shadow', expected: armed });
    await settle();
    // The radio that is already checked: nothing is sent.
    pick('programme.pick', 'Off');
    pick('programme.any', 'Shadow');
    pick('scope.widens', 'Armed');
    await settle();
    expect(arm).toHaveBeenCalledTimes(3);
    expect(offDoor).toHaveBeenCalledTimes(1);
  });

  it('2. the ceiling Save calls the ceiling door with the field\'s number and the row\'s side as read; it is off until the field is a different whole number', async () => {
    const side = sideOf({ mode: 'shadow', ceiling: 700 });
    const ceiling = vi.spyOn(api, 'setDecisionCeiling').mockResolvedValue(OK);
    await open(viewOf({ rows: [rowOf('programme.any', { side })] }));
    expect(ceilingSave('programme.any').disabled).toBe(true);
    typeCeiling('programme.any', 'abc');
    expect(ceilingSave('programme.any').disabled).toBe(true);
    typeCeiling('programme.any', 700);
    expect(ceilingSave('programme.any').disabled).toBe(true);
    typeCeiling('programme.any', 900);
    expect(ceilingSave('programme.any').disabled).toBe(false);
    fireEvent.click(ceilingSave('programme.any'));
    await waitFor(() => expect(ceiling).toHaveBeenCalledTimes(1));
    expect(ceiling).toHaveBeenCalledWith('programme.any', { ceiling: 900, expected: side });
    expect(typeof ceiling.mock.calls[0]![1].ceiling).toBe('number');
  });

  it('3. a send goes once: two clicks on Save ceiling inside one render call the door once', async () => {
    const door = deferred<unknown>();
    const ceiling = vi.spyOn(api, 'setDecisionCeiling').mockReturnValue(door.promise);
    await open();
    typeCeiling('programme.pick', 900);
    const save = ceilingSave('programme.pick');
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    await settle();
    expect(ceiling).toHaveBeenCalledTimes(1);
    await act(async () => { door.resolve(OK); });
    expect(ceiling).toHaveBeenCalledTimes(1);
  });
});

describe('the rows card: the console follows the door', () => {
  interface Move { name: string; id: DecisionRowId; act: () => void; spy: () => Mock }
  const MOVES: Move[] = [
    { name: 'shadow from off (a widening)', id: 'programme.pick', act: () => pick('programme.pick', 'Shadow'), spy: () => vi.spyOn(api, 'armDecisionRow') as unknown as Mock },
    { name: 'armed from off (a widening)', id: 'scope.widens', act: () => pick('scope.widens', 'Armed'), spy: () => vi.spyOn(api, 'armDecisionRow') as unknown as Mock },
    { name: 'off from shadow (a narrowing)', id: 'programme.any', act: () => pick('programme.any', 'Off'), spy: () => vi.spyOn(api, 'offDecisionRow') as unknown as Mock },
    { name: 'off from armed (a widening: an armed gate switched off)', id: 'readback.omits', act: () => pick('readback.omits', 'Off'), spy: () => vi.spyOn(api, 'offDecisionRow') as unknown as Mock },
    { name: 'Resume on a held row', id: 'relay.method', act: () => fireEvent.click(control(rowEl('relay.method'), 'decision-resume')), spy: () => vi.spyOn(api, 'armDecisionRow') as unknown as Mock },
    { name: 'Approve on an armed gate offered a newer line', id: 'readback.omits', act: () => fireEvent.click(control(rowEl('readback.omits'), 'decision-approve')), spy: () => vi.spyOn(api, 'armDecisionRow') as unknown as Mock },
    { name: 'a raised ceiling', id: 'programme.pick', act: () => { typeCeiling('programme.pick', 900); fireEvent.click(ceilingSave('programme.pick')); }, spy: () => vi.spyOn(api, 'setDecisionCeiling') as unknown as Mock },
    { name: 'a lowered ceiling', id: 'programme.pick', act: () => { typeCeiling('programme.pick', 300); fireEvent.click(ceilingSave('programme.pick')); }, spy: () => vi.spyOn(api, 'setDecisionCeiling') as unknown as Mock },
  ];
  const THREE = (): DecisionModelView => viewOf({
    rows: [
      rowOf('programme.pick'), rowOf('programme.any', { side: sideOf({ mode: 'shadow' }) }), rowOf('scope.widens'),
      rowOf('relay.method', { side: sideOf({ mode: 'shadow', held: true }), heldWhy: 'drift' }),
      rowOf('readback.omits', { side: sideOf({ mode: 'armed', armedLine: { id: 4, line: 0.85 } }), offered: { id: 9, line: 0.9 } }),
    ],
  });
  /** The move's second press: the ceiling's Save again (its field kept the number), a radio's tap again. */
  const again = (m: Move): void => {
    if (m.name.includes('ceiling')) fireEvent.click(ceilingSave(m.id));
    else m.act();
  };

  it.each(MOVES)('4. $name: the door asks the step, so it shows in THAT row only, and pressing the same control again calls the door a second time (twice in all)', async (m) => {
    const spy = m.spy().mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    await open(THREE());
    m.act();
    await waitFor(() => expect(rowEl(m.id).querySelector('[data-step-up]')).not.toBeNull());
    expect(document.querySelectorAll('[data-step-up]')).toHaveLength(1);
    for (const other of DECISION_ROW_IDS.filter((i) => i !== m.id)) expect(rowEl(other)?.querySelector('[data-step-up]') ?? null, other).toBeNull();
    // The step draws its field once its methods load (`data-step-up="loading"` first), so the case waits for the field.
    expect(await within(rowEl(m.id)).findByLabelText('Passphrase')).toBeTruthy();
    expect(card('decision-host').querySelector('[data-step-up]')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
    await settle();
    again(m);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it.each(MOVES)('4. $name: a door that answers at once lands it in one tap, with no step and one call', async (m) => {
    const spy = m.spy().mockResolvedValue(OK);
    await open(THREE());
    m.act();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await settle();
    expect(document.querySelector('[data-step-up]')).toBeNull();
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    expect(stepClient.stepUpStart).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('5. the section mounts with no step showing, and no step-up is fetched until a door asks', async () => {
    await open();
    expect(screen.queryByLabelText('Passphrase')).toBeNull();
    expect(document.querySelector('[data-step-up]')).toBeNull();
    expect(stepClient.stepUpStart).not.toHaveBeenCalled();
  });
});

describe('the rows card: a held row, an offered line and the answers', () => {
  it('6. a held armed row draws Resume and the cause\'s sentence; Resume is the arm door with the stored mode, the side as read and no line', async () => {
    const side = sideOf({ mode: 'armed', armedLine: { id: 4, line: 0.9 }, held: true });
    const arm = vi.spyOn(api, 'armDecisionRow').mockResolvedValue(OK);
    await open(viewOf({ rows: [rowOf('scope.widens', { side, heldWhy: 'canary' })] }));
    expect(rowEl('scope.widens').querySelector('[data-decision-hold]')!.textContent).toContain(DECISION_HELD_TEXT.canary);
    fireEvent.click(control(rowEl('scope.widens'), 'decision-resume'));
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(1));
    expect(arm).toHaveBeenCalledWith('scope.widens', { mode: 'armed', expected: side });
    expect(Object.keys(arm.mock.calls[0]![1]).sort()).toEqual(['expected', 'mode']);
  });

  it('6. every held cause names its own sentence', async () => {
    const causes: DecisionHeldCause[] = ['drift', 'line-key', 'canary', 'bound', 'no-key', 'off-refused'];
    const ids: DecisionRowId[] = ['programme.pick', 'programme.any', 'scope.widens', 'relay.method', 'readback.omits', 'readback.adds'];
    await open(viewOf({ rows: causes.map((c, i) => rowOf(ids[i]!, { side: sideOf({ mode: 'shadow', held: true }), heldWhy: c })) }));
    causes.forEach((c, i) => expect(rowEl(ids[i]!).querySelector('[data-decision-hold]')!.textContent, c).toContain(DECISION_HELD_TEXT[c]));
  });

  it('6. a held shadow row\'s Resume sends mode shadow; a row that is not held draws no Resume', async () => {
    const held = sideOf({ mode: 'shadow', held: true });
    const arm = vi.spyOn(api, 'armDecisionRow').mockResolvedValue(OK);
    await open(viewOf({ rows: [rowOf('programme.any', { side: held, heldWhy: 'drift' }), rowOf('programme.pick', { side: sideOf({ mode: 'shadow' }) })] }));
    expect(rowEl('programme.pick').querySelector('[data-settings-control="decision-resume"]')).toBeNull();
    expect(rowEl('programme.pick').querySelector('[data-decision-hold]')).toBeNull();
    fireEvent.click(control(rowEl('programme.any'), 'decision-resume'));
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(1));
    expect(arm).toHaveBeenCalledWith('programme.any', { mode: 'shadow', expected: held });
    expect(Object.keys(arm.mock.calls[0]![1])).not.toContain('line');
  });

  it('6. (pinned) a held row that is off says why it is held but draws no Resume', async () => {
    await open(viewOf({ rows: [rowOf('programme.pick', { side: sideOf({ mode: 'off', held: true }), heldWhy: 'off-refused' })] }));
    expect(rowEl('programme.pick').querySelector('[data-decision-hold]')!.textContent).toContain(DECISION_HELD_TEXT['off-refused']);
    expect(rowEl('programme.pick').querySelector('[data-settings-control="decision-resume"]')).toBeNull();
  });

  it('7. an armed gate offered a newer line draws Approve, which is the arm door with that line and the side as read', async () => {
    const side = sideOf({ mode: 'armed', armedLine: { id: 4, line: 0.85 } });
    const arm = vi.spyOn(api, 'armDecisionRow').mockResolvedValue(OK);
    await open(viewOf({ rows: [rowOf('scope.widens', { side, offered: { id: 9, line: 0.9 } }), rowOf('programme.pick')] }));
    expect(rowEl('programme.pick').querySelector('[data-settings-control="decision-approve"]')).toBeNull();
    expect(rowEl('scope.widens').querySelector('[data-decision-offered]')!.textContent).toContain('#9');
    fireEvent.click(control(rowEl('scope.widens'), 'decision-approve'));
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(1));
    expect(arm).toHaveBeenCalledWith('scope.widens', { mode: 'armed', line: 9, expected: side });
  });

  it('8. an off the journal refused draws "Held, not off" with the guard\'s cause', async () => {
    const side = sideOf({ mode: 'shadow', held: true });
    const body = { ok: true, row: 'programme.any', side, heldWhy: 'off-refused', state: 'held', offRefused: true, cause: 'journal incoherent' };
    vi.spyOn(api, 'offDecisionRow').mockResolvedValue(body);
    await open(viewOf({ rows: [rowOf('programme.any', { side: sideOf({ mode: 'shadow' }) })] }));
    pick('programme.any', 'Off');
    const said = await within(rowEl('programme.any')).findByText(/Held, not off/);
    expect(said.textContent).toBe(rowAnswerWords(body)[0]);
    expect(said.textContent).toContain('journal incoherent');
    expect(within(rowEl('programme.any')).queryByText(W.saved)).toBeNull();
  });

  it('8. an ordinary answer draws "Saved."', async () => {
    vi.spyOn(api, 'offDecisionRow').mockResolvedValue(answerOf('programme.any', sideOf()));
    await open(viewOf({ rows: [rowOf('programme.any', { side: sideOf({ mode: 'shadow' }) })] }));
    pick('programme.any', 'Off');
    expect(await within(rowEl('programme.any')).findByText(W.saved)).toBeTruthy();
  });

  it.each(['row-changed', 'line-not-admitted', 'canary-unmet', 'private-state-host', 'key-unset'] as const)('9. %s draws its own sentence', async (word) => {
    vi.spyOn(api, 'armDecisionRow').mockRejectedValue(refused(409, word));
    await open();
    pick('programme.pick', 'Shadow');
    expect(await within(rowEl('programme.pick')).findByText(DECISION_MODEL_REFUSAL_TEXT[word])).toBeTruthy();
    expect(rowEl('programme.pick').querySelector('[data-settings-refusal]')!.textContent).toBe(DECISION_MODEL_REFUSAL_TEXT[word]);
  });

  it('9. row-changed reads the view again', async () => {
    vi.spyOn(api, 'armDecisionRow').mockRejectedValue(refused(409, 'row-changed'));
    decisionSpy.mockResolvedValueOnce(viewOf()).mockResolvedValue(viewOf({ rows: [rowOf('programme.pick', { side: sideOf({ mode: 'shadow' }) })] }));
    show();
    await settle();
    expect(decisionSpy).toHaveBeenCalledTimes(1);
    pick('programme.pick', 'Shadow');
    await within(rowEl('programme.pick')).findByText(DECISION_MODEL_REFUSAL_TEXT['row-changed']);
    await waitFor(() => expect(decisionSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(checkedOf('programme.pick')).toEqual(['Shadow']));
  });

  it('9. a word this build does not know is drawn "Refused: <word>"', async () => {
    vi.spyOn(api, 'armDecisionRow').mockRejectedValue(refused(409, 'zz-unknown-word'));
    await open();
    pick('programme.pick', 'Shadow');
    expect(await within(rowEl('programme.pick')).findByText('Refused: zz-unknown-word')).toBeTruthy();
  });

  it('9. auth-off draws the decision model\'s sign-in sentence', async () => {
    vi.spyOn(api, 'armDecisionRow').mockRejectedValue(refused(403, 'auth-off'));
    await open();
    pick('programme.pick', 'Shadow');
    expect(await within(rowEl('programme.pick')).findByText(OVERLORD_SETTINGS_REFUSAL_TEXT['decision-auth-off'])).toBeTruthy();
  });

  it('9. a refusal of the ceiling door is drawn in its own row only', async () => {
    vi.spyOn(api, 'setDecisionCeiling').mockRejectedValue(refused(400, 'bad-ceiling'));
    await open(viewOf({ rows: [rowOf('programme.pick'), rowOf('programme.any')] }));
    typeCeiling('programme.pick', 99999);
    fireEvent.click(ceilingSave('programme.pick'));
    expect(await within(rowEl('programme.pick')).findByText(DECISION_MODEL_REFUSAL_TEXT['bad-ceiling'])).toBeTruthy();
    expect(rowEl('programme.any').querySelector('[data-settings-refusal]')).toBeNull();
  });

  it('9. a bad ceiling draws the door\'s detail beside its sentence in that row\'s refusal line', async () => {
    vi.spyOn(api, 'setDecisionCeiling').mockRejectedValue(refused(400, 'bad-ceiling', { detail: 'the ceiling is 1 to 100000' }));
    await open();
    typeCeiling('programme.pick', 99999);
    fireEvent.click(ceilingSave('programme.pick'));
    await waitFor(() => expect(rowEl('programme.pick').querySelector('[data-settings-refusal]')).not.toBeNull());
    const line = rowEl('programme.pick').querySelector('[data-settings-refusal]')!.textContent!;
    expect(line).toContain(DECISION_MODEL_REFUSAL_TEXT['bad-ceiling']);
    expect(line).toContain('the ceiling is 1 to 100000');
  });

  it('8. the answer is installed: the row shows the mode the door answered, though the read that follows fails', async () => {
    const answer = { ok: true, row: 'programme.pick', side: sideOf({ mode: 'shadow' }), heldWhy: null };
    vi.spyOn(api, 'armDecisionRow').mockResolvedValue(answer);
    decisionSpy.mockResolvedValueOnce(viewOf()).mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    show();
    await settle();
    expect(checkedOf('programme.pick')).toEqual(['Off']);
    pick('programme.pick', 'Shadow');
    await waitFor(() => expect(decisionSpy).toHaveBeenCalledTimes(2));
    await settle();
    expect(checkedOf('programme.pick')).toEqual(['Shadow']);
    expect(rowEl('programme.pick').getAttribute('data-decision-mode')).toBe('shadow');
  });

  it('8. an answer whose side is held draws its cause\'s sentence, though the read that follows fails', async () => {
    const answer = { ok: true, row: 'programme.pick', side: sideOf({ mode: 'shadow', held: true }), heldWhy: 'canary' };
    vi.spyOn(api, 'armDecisionRow').mockResolvedValue(answer);
    decisionSpy.mockResolvedValueOnce(viewOf()).mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    show();
    await settle();
    pick('programme.pick', 'Shadow');
    await waitFor(() => expect(decisionSpy).toHaveBeenCalledTimes(2));
    await settle();
    expect(rowEl('programme.pick').querySelector('[data-decision-hold]')!.textContent).toContain(DECISION_HELD_TEXT.canary);
  });
});

describe('the cards\' reads', () => {
  it('11. a 404 read draws neither decision card', async () => {
    await open({ absent: true });
    expect(card('decision-host')).toBeNull();
    expect(card('decision-rows')).toBeNull();
  });

  it('11. a failed read draws the host card with its unread sentence and Read again, and no rows card; Read again reads once more', async () => {
    decisionSpy.mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'not-configured' })).mockResolvedValue(viewOf());
    show();
    await settle();
    expect(card('decision-rows')).toBeNull();
    expect(card('decision-host').querySelector('[data-settings-unread="decision-host"]')!.textContent).toContain(W.unread('HTTP 503'));
    expect(card('decision-host').querySelector('[data-settings-input]')).toBeNull();
    expect(decisionSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(within(card('decision-host')).getByRole('button', { name: 'Read again' }));
    await waitFor(() => expect(decisionSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card('decision-rows')).not.toBeNull());
    expect(card('decision-host').querySelector('[data-settings-unread]')).toBeNull();
  });

  it('11. an answer the one reader refuses is an unread read, not a partial card', async () => {
    await open({ rows: 'not a list' } as unknown as DecisionModelView);
    expect(card('decision-rows')).toBeNull();
    // Review 4139 F4: the shared reader's own detail, and the reload a console older than its server needs.
    expect(card('decision-host').querySelector('[data-settings-unread="decision-host"]')!.textContent).toContain(W.unreadable('rows'));
  });

  const UNREADABLE = { ...viewOf(), rows: [{ ...rowOf('programme.pick'), id: 'zz.unknown' }] };
  const detailOf = (body: unknown): string => {
    const r = readDecisionModelView(body);
    if (r.ok) throw new Error('the fixture must be refused by the shared reader');
    return r.detail;
  };

  it('11. a view the shared reader refuses draws its detail and a Reload control, and no Read again, Save, Remove or rows card', async () => {
    await open(UNREADABLE as unknown as DecisionModelView);
    const host = card('decision-host');
    expect(host.querySelector('[data-settings-unread="decision-host"]')!.textContent).toContain(W.unreadable(detailOf(UNREADABLE)));
    expect(control(host, 'decision-host-reload').textContent).toBe(W.reload);
    expect(within(host).queryByRole('button', { name: 'Read again' })).toBeNull();
    expect(control(host, 'decision-host-save')).toBeNull();
    expect(control(host, 'decision-key-remove')).toBeNull();
    expect(card('decision-rows')).toBeNull();
  });

  it('11. a view refused after a good one: the rows stay drawn from the first view, beside the unreadable sentence and its Reload', async () => {
    vi.spyOn(api, 'offDecisionRow').mockResolvedValue(answerOf('programme.any', sideOf()));
    decisionSpy.mockResolvedValueOnce(viewOf({ rows: [rowOf('programme.any', { side: sideOf({ mode: 'shadow' }) })] })).mockResolvedValue(UNREADABLE as unknown as DecisionModelView);
    show();
    await settle();
    pick('programme.any', 'Off');
    await waitFor(() => expect(decisionSpy).toHaveBeenCalledTimes(2));
    await settle();
    const host = card('decision-host');
    expect(host.querySelector('[data-settings-unread="decision-host"]')!.textContent).toContain(W.unreadable(detailOf(UNREADABLE)));
    expect(control(host, 'decision-host-reload').textContent).toBe(W.reload);
    expect(rowEl('programme.any')).not.toBeNull();
    expect(card('decision-rows')).not.toBeNull();
  });

  it('11. a view with no rows says so, and the host card still draws', async () => {
    await open(viewOf({ rows: [] }));
    expect(card('decision-rows').querySelector('[data-decision-empty]')!.textContent).toBe(W.noRows);
    expect(document.querySelectorAll('[data-decision-row]')).toHaveLength(0);
    expect(card('decision-host').querySelector('[data-settings-input="decision-endpoint"]')).not.toBeNull();
  });

  it('11. the fleet\'s count is drawn from the read', async () => {
    await open(viewOf({ fleetToday: 17, fleetCap: 3000 }));
    expect(card('decision-rows').querySelector('[data-decision-fleet]')!.textContent).toBe(W.fleet(17, 3000));
  });
});

describe('the host card', () => {
  it('12. the endpoint and the model id are filled from the read, and a Save that changes only the model id sends the stored endpoint and no key', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockResolvedValue({ ok: true });
    await open();
    const host = card('decision-host');
    const endpoint = host.querySelector<HTMLInputElement>('[data-settings-input="decision-endpoint"]')!;
    const model = host.querySelector<HTMLInputElement>('[data-settings-input="decision-model-id"]')!;
    expect(endpoint.value).toBe(ENDPOINT);
    expect(model.value).toBe('model-a');
    expect(host.querySelector<HTMLSelectElement>('[data-settings-input="decision-kind"]')!.value).toBe('local');
    expect(hostSave().disabled).toBe(true);
    fireEvent.change(model, { target: { value: 'model-b' } });
    expect(hostSave().disabled).toBe(false);
    fireEvent.click(hostSave());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ kind: 'local', endpoint: ENDPOINT, modelId: 'model-b' });
    expect(Object.keys(save.mock.calls[0]![0]).sort()).toEqual(['endpoint', 'kind', 'modelId']);
  });

  it('13. it says when the key was set, or that there is none, and never any key text', async () => {
    await open();
    expect(card('decision-host').querySelector('[data-decision-key-state]')!.textContent).toBe(W.keySet(dateOf(AT)));
    expect(card('decision-host').querySelector('[data-decision-key-unmasked]')).toBeNull();
    expect(keyField().value).toBe('');
    cleanup();
    await open(viewOf({ key: null }));
    expect(card('decision-host').querySelector('[data-decision-key-state]')!.textContent).toBe(W.noKey);
    expect(card('decision-host').querySelector('[data-decision-key-unmasked]')).toBeNull();
    expect(keyField().value).toBe('');
  });

  it('13. the short-key line appears only when the key is not masked', async () => {
    await open(viewOf({ key: { setAt: AT, masked: false } }));
    expect(card('decision-host').querySelector('[data-decision-key-unmasked]')!.textContent).toBe(W.keyNotMasked);
    cleanup();
    await open(viewOf({ key: { setAt: AT, masked: true } }));
    expect(card('decision-host').querySelector('[data-decision-key-unmasked]')).toBeNull();
    cleanup();
    await open(viewOf({ key: null }));
    expect(card('decision-host').querySelector('[data-decision-key-unmasked]')).toBeNull();
  });

  it('14. a typed key is sent with Save, and the field is empty after an ok answer', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockResolvedValue({ ok: true, held: [] });
    await open();
    expect(hostSave().disabled).toBe(true);
    typeKey();
    expect(keyField().value).toBe(KEY);
    expect(hostSave().disabled).toBe(false);
    nowhere('typed');
    fireEvent.click(hostSave());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ kind: 'local', endpoint: ENDPOINT, modelId: 'model-a', key: KEY });
    await waitFor(() => expect(keyField().value).toBe(''));
    expect(await within(card('decision-host')).findByText(W.saved)).toBeTruthy();
    nowhere('after an ok answer');
  });

  it('14. the field is empty after a final refusal, and the refusal is worded with the door\'s detail', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValue(refused(400, 'bad-endpoint', { detail: 'endpoint must be a URL' }));
    await open();
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const line = await within(card('decision-host')).findByText(`${DECISION_MODEL_REFUSAL_TEXT['bad-endpoint']} (endpoint must be a URL)`);
    expect(line.getAttribute('data-settings-refusal')).toBe('decision-host');
    await waitFor(() => expect(keyField().value).toBe(''));
    nowhere('after a final refusal');
  });

  it('15. a step-up keeps the key and locks the host; the confirm sends the same key again by itself, and only that ok answer empties the field', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    await open();
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    expect(document.querySelectorAll('[data-step-up]')).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].key).toBe(KEY);
    expect(keyField().value).toBe(KEY);
    // The whole card is held while its step shows (review 4167 F2, F3): the key field and Remove as well as Save and the host.
    allHeld(hostHeldControls(), true, 'the step showing');
    nowhere('the step showing');
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0].key).toBe(KEY);
    await waitFor(() => expect(keyField().value).toBe(''));
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-step-up]')).toBeNull();
    allHeld([...hostInputs(), keyField(), control(card('decision-host'), 'decision-key-remove')], false, 'after the retry');
    nowhere('after the retry');
  });

  it("16. a host-only Save's step holds the key field: no key can be typed while it shows, so the retry sends the host alone and discards nothing", async () => {
    // Review 4167 F2 (a). The field's only handler is its presence report (`onInput`), which sends nothing; the hold is its
    // `disabled` attribute, so a browser delivers no keystroke to it while the step shows.
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    await open();
    fireEvent.change(card('decision-host').querySelector('[data-settings-input="decision-model-id"]')!, { target: { value: 'model-b' } });
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    expect(keyField().disabled).toBe(true);
    allHeld(hostHeldControls(), true, 'a host-only step showing');
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0]).toEqual({ kind: 'local', endpoint: ENDPOINT, modelId: 'model-b' });
    await waitFor(() => expect(keyField().disabled).toBe(false));
    expect(hostFinal()).toBeNull();
  });

  it('16. a second step-up-required on the retry is final: the field is empty, no step shows and the sentence says so', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValue(stepUpRequired());
    await open();
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    expect(keyField().value).toBe(KEY);
    expect(hostFinal()).toBeNull();
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(keyField().value).toBe(''));
    await waitFor(() => expect(hostFinal()).not.toBeNull());
    expect(hostFinal()!.textContent).toBe(W.stepUpFinal);
    expect(document.querySelector('[data-step-up]')).toBeNull();
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    nowhere('after a final step-up');
  });

  it('16. with the step showing, Save and Remove are disabled and a click on either sends nothing and opens nothing', async () => {
    // The hold is by attribute: a disabled button gets no click, so neither handler is reached (no form, no key handler).
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValue(stepUpRequired());
    const remove = vi.spyOn(api, 'removeDecisionKey').mockResolvedValue({ ok: true, held: [] });
    await open();
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    expect(hostSave().disabled).toBe(true);
    expect(control(card('decision-host'), 'decision-key-remove').disabled).toBe(true);
    fireEvent.click(hostSave());
    fireEvent.click(control(card('decision-host'), 'decision-key-remove'));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it('16. another card\'s answer hides the step; Save again is a first send, and the confirm after it retries by itself', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    const off = vi.spyOn(api, 'offDecisionRow').mockResolvedValue({ ok: true, row: 'programme.any', side: sideOf({ mode: 'off' }), heldWhy: null });
    await open(viewOf({ rows: [rowOf('programme.any', { side: sideOf({ mode: 'shadow' }) })] }));
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    allHeld(hostHeldControls(), true, 'the step showing');
    pick('programme.any', 'Off');
    await waitFor(() => expect(off).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).toBeNull());
    expect(keyField().value).toBe(KEY);
    // Another card's answer frees the whole card (review 4167 F2): every control is enabled, and Save is a first send.
    allHeld(hostHeldControls(), false, 'freed by another card');
    fireEvent.click(hostSave());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    expect(hostFinal()).toBeNull();
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save.mock.calls[2]![0].key).toBe(KEY);
    await waitFor(() => expect(keyField().value).toBe(''));
    expect(hostFinal()).toBeNull();
    await settle();
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('16. a retry never sends less than the first send: a key lost while the step showed is not retried, and its sentence says so', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    await open();
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    setVisibility('hidden');
    expect(keyField().value).toBe('');
    setVisibility('visible');
    await confirmStep();
    await waitFor(() => expect(hostFinal()).not.toBeNull());
    expect(hostFinal()!.textContent).toBe(W.keyGone);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('16. a host-only Save has no key to lose: the retry after the page was hidden is sent, with no key', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    await open();
    fireEvent.change(card('decision-host').querySelector('[data-settings-input="decision-model-id"]')!, { target: { value: 'model-b' } });
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    setVisibility('hidden');
    setVisibility('visible');
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]![0]).toEqual({ kind: 'local', endpoint: ENDPOINT, modelId: 'model-b' });
    expect(Object.keys(save.mock.calls[1]![0])).not.toContain('key');
  });

  it('16. a host-only Save whose retry is answered step-up again is final in the host\'s own words', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValue(stepUpRequired());
    await open();
    fireEvent.change(card('decision-host').querySelector('[data-settings-input="decision-model-id"]')!, { target: { value: 'model-b' } });
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hostFinal()).not.toBeNull());
    expect(hostFinal()!.textContent).toBe(W.stepUpFinalHost);
    expect(hostFinal()!.textContent).not.toBe(W.stepUpFinal);
  });

  it('16. no fiber of the tree holds the key: typed, with the step showing, after the automatic retry and after the ok answer', async () => {
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    await open();
    typeKey();
    await settle();
    expect(keyField().value).toBe(KEY);
    expect(allFibers(keyField()).length).toBeGreaterThan(20);
    expect(fiberHolds(keyField(), KEY), 'typed').toBe(false);
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    expect(fiberHolds(keyField(), KEY), 'the step showing').toBe(false);
    await confirmStep();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(fiberHolds(keyField(), KEY), 'after the retry').toBe(false);
    await waitFor(() => expect(keyField().value).toBe(''));
    await settle();
    expect(fiberHolds(keyField(), KEY), 'after the ok answer').toBe(false);
  });

  it('16. the fiber walk sees a key mirrored into state (a control for the case above)', () => {
    function Mirrored(): ReactNode {
      const [t, setT] = useState('');
      return <input aria-label="mirrored" value={t} onChange={(e) => setT(e.currentTarget.value)} />;
    }
    render(<Mirrored />);
    fireEvent.change(screen.getByLabelText('mirrored'), { target: { value: KEY } });
    expect(fiberHolds(screen.getByLabelText('mirrored'), KEY)).toBe(true);
  });

  it('17. the key is never in the markup, a store, a console call or a refusal line, from typing to a refusal that follows a retried step-up', async () => {
    const save = vi.spyOn(api, 'setDecisionKey')
      .mockRejectedValueOnce(stepUpRequired())
      .mockRejectedValueOnce(refused(400, 'bad-endpoint', { detail: 'endpoint must be a URL' }))
      .mockRejectedValueOnce(refused(409, 'key-required'))
      .mockResolvedValue({ ok: true, held: ['programme.pick'] });
    await open();
    nowhere('mounted');
    typeKey();
    nowhere('typed');
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    nowhere('step showing');
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await settle();
    nowhere('confirmed');
    await within(card('decision-host')).findByText(/The server refused that endpoint/);
    nowhere('refused');
    expect(keyField().value).toBe('');
    typeKey();
    fireEvent.click(hostSave());
    await within(card('decision-host')).findByText(DECISION_MODEL_REFUSAL_TEXT['key-required']);
    nowhere('refused again');
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(4));
    await within(card('decision-host')).findByText('Held: programme.pick.');
    nowhere('answered');
    for (const i of document.querySelectorAll('input')) expect(i.value).not.toContain(KEY);
  });

  it('18. Remove is drawn only when the read has a key', async () => {
    await open(viewOf({ key: null }));
    expect(card('decision-host').querySelector('[data-settings-control="decision-key-remove"]')).toBeNull();
    cleanup();
    await open();
    expect(card('decision-host').querySelector('[data-settings-control="decision-key-remove"]')).not.toBeNull();
  });

  it('18. Remove asks first: Cancel calls nothing, and confirming calls the door once and says what it held', async () => {
    const remove = vi.spyOn(api, 'removeDecisionKey').mockResolvedValue({ ok: true, held: ['scope.widens'] });
    await open();
    fireEvent.click(control(card('decision-host'), 'decision-key-remove'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(W.removeTitle)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText(W.removeTitle)).toBeNull());
    fireEvent.click(control(card('decision-host'), 'decision-key-remove'));
    const again = await screen.findByRole('dialog');
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(within(again).getByRole('button', { name: W.removeKey }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(await within(card('decision-host')).findByText(W.keyRemoved)).toBeTruthy();
    expect(within(card('decision-host')).getByText('Held: scope.widens.')).toBeTruthy();
    await settle();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("18. another card's step drops Save's retry: a row asked for the step after Save did, so the confirm sends no Save", async () => {
    // Review 4139 F1 (d): any other ask drops a retry not yet sent. The host card is held whole while its step shows (review 4167
    // F2), so the other ask is a row's: the row hands no retry, so after its confirm nothing is sent, and the host card is free.
    const save = vi.spyOn(api, 'setDecisionKey').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true });
    const arm = vi.spyOn(api, 'armDecisionRow').mockRejectedValueOnce(stepUpRequired()).mockResolvedValue(OK);
    const remove = vi.spyOn(api, 'removeDecisionKey');
    await open(viewOf({ rows: [rowOf('programme.pick')] }));
    typeKey();
    fireEvent.click(hostSave());
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    pick('programme.pick', 'Shadow');
    await waitFor(() => expect(arm).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rowEl('programme.pick').querySelector('[data-step-up]')).not.toBeNull());
    expect(card('decision-host').querySelector('[data-step-up]')).toBeNull();
    allHeld(hostHeldControls(), false, 'the step moved to a row');
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(arm).toHaveBeenCalledTimes(1);
    expect(keyField().value).toBe(KEY);
    // The dropped retry stays dropped: Remove's own step in the host card, confirmed, sends no Save (Remove hands no retry).
    remove.mockRejectedValueOnce(stepUpRequired()).mockResolvedValue({ ok: true, held: [] });
    fireEvent.click(control(card('decision-host'), 'decision-key-remove'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: W.removeKey }));
    await waitFor(() => expect(card('decision-host').querySelector('[data-step-up]')).not.toBeNull());
    await confirmStep();
    await waitFor(() => expect(document.querySelector('[data-step-up]')).toBeNull());
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('18. a refused removal is worded by its own sentence', async () => {
    vi.spyOn(api, 'removeDecisionKey').mockRejectedValue(refused(503, 'removed-not-held', { detail: 'hold not written' }));
    await open();
    fireEvent.click(control(card('decision-host'), 'decision-key-remove'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: W.removeKey }));
    expect(await within(card('decision-host')).findByText(`${DECISION_MODEL_REFUSAL_TEXT['removed-not-held']} (hold not written)`)).toBeTruthy();
  });

  it('19. the hosted kind says each question is paid for and seen; a local kind does not', async () => {
    await open();
    const kind = card('decision-host').querySelector<HTMLSelectElement>('[data-settings-input="decision-kind"]')!;
    expect(within(card('decision-host')).queryByText(W.hosted)).toBeNull();
    fireEvent.change(kind, { target: { value: 'hosted' } });
    expect(within(card('decision-host')).getByText(W.hosted)).toBeTruthy();
    fireEvent.change(kind, { target: { value: 'zero-retention' } });
    expect(within(card('decision-host')).queryByText(W.hosted)).toBeNull();
    fireEvent.change(kind, { target: { value: 'local' } });
    expect(within(card('decision-host')).queryByText(W.hosted)).toBeNull();
  });

  it('19. a host read as hosted shows the sentence at once', async () => {
    await open(viewOf({ host: { ...HOST, kind: 'hosted' } }));
    expect(within(card('decision-host')).getByText(W.hosted)).toBeTruthy();
  });
});
