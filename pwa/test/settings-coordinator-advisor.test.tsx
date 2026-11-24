// Settings › Automation › Coordinator advisor (plan 2026-11-23-coordinator-advisor PR B and D; D-8967): Off, Opus or Fable,
// the daily cap and the coordinators it covers, with a summary of every coordinator the advisor touches in the session
// header's words (`advisorLineOf`). The api object is spied and the fleet store is a stub, so no fetch runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { COORDINATOR_ADVISOR_TEXT as T, type CoordinatorAdvisorView, type FleetAdvisor } from '../../shared/coordinatorAdvisor';
import type { LaneArmView } from '../../shared/lane-arm';
import { api } from '../src/lib/api';
import { CoordinatorAdvisorSection } from '../src/fleet/CoordinatorAdvisorSection';
import { advisorLineOf } from '../src/fleet/advisorWords';
import { SETTINGS_CARDS, UNCONFIRMED_TEXT } from '../src/fleet/settingsText';
import type { FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const lanes = (live: boolean): LaneArmView => ({ lanes: [{ lane: 'launch-profile', stored: live ? 'live' : 'shadow', detail: null, live,
  updatedAt: 1, imported: null, marker: null }] });
beforeEach(() => { vi.spyOn(api, 'laneArm').mockResolvedValue(lanes(false)); });

const DEFAULT = { choice: 'off', cap: 12, scope: { kind: 'all' } } as const;
const view = (setting: CoordinatorAdvisorView['setting']): CoordinatorAdvisorView & { ok: true } =>
  ({ ok: true, setting, default: DEFAULT, choices: ['off', 'opus', 'fable'], capMin: 1, capMax: 200 });
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const LIVE: FleetAdvisor = { state: 'live', model: 'fable', today: 3, cap: 12, overrun: 0, tokens: { input: 12_300, output: 900, cacheRead: 0, cacheWrite: 0 }, applies: 'roll' };
const storeWith = (sessions: unknown[]): FleetStore => ((sel: (s: { sessions: unknown[] }) => unknown) => sel({ sessions })) as unknown as FleetStore;

describe('Coordinator advisor (D-8967)', () => {
  it('offers Off, Opus and Fable with their notes, the cap and the scope, and shows the stored choice', async () => {
    vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(view(DEFAULT));
    render(<CoordinatorAdvisorSection store={storeWith([])} />);
    await settle();
    expect(screen.getByRole('heading', { level: 3, name: SETTINGS_CARDS.automation.coordinatorAdvisor.title })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([T.choices.off, T.choices.opus, T.choices.fable]);
    expect(screen.getByRole('radio', { name: T.choices.off })).toBeChecked();
    expect(screen.getByRole('spinbutton')).toHaveValue(12);
    expect(screen.getByText(T.shadow)).toBeInTheDocument();
  });

  it('choosing Fable posts the choice with the cap and a named two-coordinator scope', async () => {
    vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(view(DEFAULT));
    const stored = { choice: 'fable', cap: 8, scope: { kind: 'sessions', ids: ['lane-a-x', 'lane-b-y'] } } as const;
    const set = vi.spyOn(api, 'setCoordinatorAdvisor').mockResolvedValue(view(stored));
    render(<CoordinatorAdvisorSection store={storeWith([])} />);
    await settle();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('textbox', { name: T.scopeSessions }), { target: { value: 'lane-a-x, lane-b-y' } });
    fireEvent.click(screen.getByRole('radio', { name: T.choices.fable }));
    await settle();
    expect(set).toHaveBeenCalledWith(stored);
    expect(screen.getByRole('radio', { name: T.choices.fable })).toBeChecked();
  });

  it('a cap and a list edited under the standing choice are saved by the button, with that choice (review F7)', async () => {
    const standing = { choice: 'fable', cap: 12, scope: { kind: 'all' } } as const;
    vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(view(standing));
    const next = { choice: 'fable', cap: 6, scope: { kind: 'sessions', ids: ['lane-a-x'] } } as const;
    const set = vi.spyOn(api, 'setCoordinatorAdvisor').mockResolvedValue(view(next));
    render(<CoordinatorAdvisorSection store={storeWith([])} />);
    await settle();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '6' } });
    fireEvent.change(screen.getByRole('textbox', { name: T.scopeSessions }), { target: { value: 'lane-a-x' } });
    fireEvent.click(screen.getByRole('button', { name: T.save }));
    await settle();
    expect(set).toHaveBeenCalledWith(next);
  });

  it('the readout of an unreadable launch record has its own words', () => {
    expect(advisorLineOf({ ...LIVE, state: 'unmeasured' })!.text).toBe(`advisor Fable: ${T.states.unmeasured.toLowerCase()} · 3/12 today`);
  });

  it('a cap out of range is refused here and posts nothing', async () => {
    vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(view(DEFAULT));
    const set = vi.spyOn(api, 'setCoordinatorAdvisor');
    render(<CoordinatorAdvisorSection store={storeWith([])} />);
    await settle();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('radio', { name: T.choices.opus }));
    await settle();
    expect(set).not.toHaveBeenCalled();
  });

  it('an unread row says so; an unreadable answer is the unconfirmed line', async () => {
    vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(view(null));
    vi.spyOn(api, 'setCoordinatorAdvisor').mockResolvedValue('unreadable');
    render(<CoordinatorAdvisorSection store={storeWith([])} />);
    await settle();
    expect(screen.getByText(T.unread)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: T.choices.opus }));
    await settle();
    expect(screen.getByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
  });

  it('an answer not of the view\'s shape (an older server, a stub) is not available, and nothing throws', async () => {
    for (const bad of [{ ok: true }, { ok: true, setting: null, default: { choice: 'off' } }, { ok: true, setting: { choice: 'x' }, default: DEFAULT }]) {
      vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(bad as unknown as CoordinatorAdvisorView & { ok: true });
      const { unmount } = render(<CoordinatorAdvisorSection store={storeWith([])} />);
      await settle();
      if (bad.default === DEFAULT) expect(screen.getByText(T.unread), JSON.stringify(bad)).toBeInTheDocument();
      else expect(screen.queryByRole('radio'), JSON.stringify(bad)).toBeNull();
      unmount();
    }
  });

  it('the summary lists each coordinator the advisor touches, in the header\'s words', async () => {
    vi.spyOn(api, 'coordinatorAdvisor').mockResolvedValue(view(DEFAULT));
    render(<CoordinatorAdvisorSection store={storeWith([{ id: 'lane-a-x', advisor: LIVE }, { id: 'lane-a-plain' }])} />);
    await settle();
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toEqual([`lane-a-x: ${advisorLineOf(LIVE)!.text}`]);
  });
});

describe('advisorLineOf: the one reader of FleetSession.advisor', () => {
  it('a session with no readout has no line', () => { expect(advisorLineOf(undefined)).toBeNull(); });
  it('names the model, the state and the count; its title the overrun, the tokens and the apply path', () => {
    expect(advisorLineOf(LIVE)).toEqual({
      text: 'advisor Fable: live · 3/12 today',
      title: `${T.states.live}; advisor tokens today: 12.3k in, 900 out, 0 cache read, 0 cache write; ${T.applies.roll}`,
    });
    const capped = advisorLineOf({ ...LIVE, state: 'capped', today: 14, overrun: 2, tokens: null, applies: 'renewal' })!;
    expect(capped.text).toBe(`advisor Fable: ${T.states.capped.toLowerCase()} · 14/12 today`);
    expect(capped.title).toBe(`${T.states.capped}; 2 over the cap before its restart; ${T.applies.renewal}`);
  });
});
