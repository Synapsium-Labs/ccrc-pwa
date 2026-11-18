// "Renew now" in the session screen's ⋯ menu (Overlord W1a hand-offs): offered for a coordinator only, gated on the
// substrate fault like Move, and its outcome said in a toast.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { sessionMenu } from '../src/session/sessionMenu';
import { renewNowText } from '../src/lib/refusalWords';
import { SessionFlows } from '../src/session/SessionFlows';
import { CommandLayer } from '../src/command/CommandLayer';
import { fleetSession } from './fleetFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ids = (s: Parameters<typeof sessionMenu>[0]): string[] => sessionMenu(s).map((e) => e.id);
const actions = {
  changeModel: () => {}, changeEffort: () => {}, openBrowser: () => {}, openHistory: () => {}, moveAccount: () => {},
  archive: () => {}, restore: () => {}, openTerminal: () => {}, reapWorkspace: () => {},
};
const coordinator = fleetSession({ id: 'lane-a-project-a', role: 'coordinator' });

describe('the Renew now menu entry', () => {
  it('is offered for a coordinator, between Move and Archive, and not for other roles', () => {
    const list = ids(coordinator);
    expect(list.indexOf('session-renew')).toBe(list.indexOf('session-swap') + 1);
    expect(list.indexOf('session-renew')).toBeLessThan(list.indexOf('session-archive'));
    expect(sessionMenu(coordinator).find((e) => e.id === 'session-renew')).toEqual(
      { id: 'session-renew', label: 'Renew now', enabled: true, title: undefined });
    for (const role of ['child', 'plain', null] as const) {
      expect(ids(fleetSession({ role: role as never }))).not.toContain('session-renew');
    }
    expect(ids(null)).not.toContain('session-renew');
  });

  it('is disabled under a substrate fault, with the fault title', () => {
    const e = sessionMenu({ ...coordinator, substrate: { at: 1, text: 'tmux socket gone' } }).find((x) => x.id === 'session-renew');
    expect(e).toMatchObject({ enabled: false, title: 'tmux unreachable — tmux socket gone' });
  });
});

describe('the sentences', () => {
  it('a refusal word reads as its sentence; an unknown one falls back to the generic text', () => {
    expect(renewNowText(new ApiError(409, { ok: false, error: 'renew-not-long-lived' }))).toBe('This session has no long-lived conversation to renew.');
    expect(renewNowText(new ApiError(409, { ok: false, error: 'renew-pending' }))).toBe('A Renew now for this session is already waiting.');
    expect(renewNowText(new ApiError(502, { ok: false, error: 'unmeasured' }))).not.toBe('');
  });
});

function mount(): void {
  render(
    <>
      <ToastHost />
      <CommandLayer openNewSession={() => {}} />
      <SessionFlows session={coordinator} title="project-a" actions={actions}>{null}</SessionFlows>
    </>,
  );
}
const choose = async (): Promise<void> => {
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  fireEvent.click(screen.getByRole('option', { name: /Renew now/ }));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe('choosing Renew now', () => {
  it('calls renewNow with the session id and says it was recorded', async () => {
    const spy = vi.spyOn(api, 'renewNow').mockResolvedValue({ ok: true, id: 1, shadow: false });
    mount();
    await choose();
    expect(spy).toHaveBeenCalledWith('lane-a-project-a');
    expect(await screen.findByText('Renew now recorded: the session renews once its turn ends.')).toBeInTheDocument();
  });

  it('says a press while continuity is shadow renews nothing (review 2312 F1)', async () => {
    vi.spyOn(api, 'renewNow').mockResolvedValue({ ok: true, id: 1, shadow: true });
    mount();
    await choose();
    expect(await screen.findByText('Renew now recorded in shadow: no renewal happens while continuity is in shadow.')).toBeInTheDocument();
  });

  it('says the refusal\'s sentence for renew-pending', async () => {
    vi.spyOn(api, 'renewNow').mockRejectedValue(new ApiError(409, { ok: false, error: 'renew-pending' }));
    mount();
    await choose();
    expect(await screen.findByText('A Renew now for this session is already waiting.')).toBeInTheDocument();
  });
});
