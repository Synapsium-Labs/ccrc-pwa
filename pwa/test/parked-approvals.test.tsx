// The parked-approvals group of the Waiting screen (approvals PR 3). Neutral names only: the repository is public.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ParkedApprovalView } from '../../shared/approval-park';
import { WaitingScreen } from '../src/ledgers/WaitingScreen';
import {
  PARKED_DEFAULT_REFUSAL, PARKED_HEADING, PARKED_REFUSAL_TEXT, parkedOldestFirst, parkedRefusalText, parkedRowLine, ruledLine,
} from '../src/ledgers/parkedApprovalWords';
import { ApiError, api } from '../src/lib/api';
import { NOW, waitingView } from './ledgersFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const parked = (over: Partial<ParkedApprovalView> = {}): ParkedApprovalView => ({
  id: 1, childId: 'project-a-quiet-basin', parentId: 'project-a-calm-mesa', runId: null, agentId: 'agent-a', tool: 'Bash',
  input: 'ls <b>-la</b>', class: 'write', denyCurrent: false, askAt: NOW - 60_000, horizon: null, holder: 'coordinator', ruled: null, ...over,
});

const open = (approvals?: ParkedApprovalView[]) =>
  render(<WaitingScreen view={waitingView(approvals === undefined ? {} : { approvals })} sessions={[]} runs={[]} now={NOW}
    onOpenItem={vi.fn()} onOpenSession={vi.fn()} />);

describe('the parked approvals group', () => {
  it('draws a row per parked approval with its child and tool, oldest first, the input as text', () => {
    open([parked({ id: 2, childId: 'project-a-calm-mesa', askAt: NOW }), parked({ id: 1 })]);
    expect(screen.getByRole('region', { name: PARKED_HEADING })).toBeTruthy();
    const rows = document.querySelectorAll('[data-parked-approval]');
    expect([...rows].map((r) => r.getAttribute('data-parked-approval'))).toEqual(['1', '2']);
    expect(screen.getByText(/project-a-quiet-basin asks to run Bash/)).toBeTruthy();
    expect(screen.getAllByText('ls <b>-la</b>').length).toBe(2);
    expect(document.querySelector('pre b')).toBeNull();
  });

  it('draws no group when approvals is absent or empty', () => {
    open();
    expect(screen.queryByText(PARKED_HEADING)).toBeNull();
    cleanup();
    open([]);
    expect(screen.queryByText(PARKED_HEADING)).toBeNull();
  });

  it('a ruled row shows its sentence and no buttons', () => {
    open([parked({ ruled: { verdict: 'allow', authority: 'operator' } })]);
    expect(screen.getByText('Allowed by the operator: waiting for the child to run it again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('Allow calls the client with the id and the verdict, then says Recorded', async () => {
    const rule = vi.spyOn(api, 'ruleParkedApproval').mockResolvedValue({});
    open([parked({ id: 7 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByText('Recorded')).toBeTruthy());
    expect(rule).toHaveBeenCalledWith(7, 'allow');
  });

  it('a park-ruled refusal shows its sentence', async () => {
    vi.spyOn(api, 'ruleParkedApproval').mockRejectedValue(new ApiError(409, { ok: false, error: 'park-ruled' }));
    open([parked()]);
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(screen.getByText(PARKED_REFUSAL_TEXT['park-ruled']!)).toBeTruthy());
  });

  it('an unlisted refusal says the default sentence, never a crash', async () => {
    vi.spyOn(api, 'ruleParkedApproval').mockRejectedValue(new ApiError(400, { ok: false, error: 'kind-mismatch' }));
    open([parked()]);
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => expect(screen.getByText(PARKED_DEFAULT_REFUSAL)).toBeTruthy());
  });
});

describe('parkedApprovalWords', () => {
  it('says each sentence', () => {
    expect(parkedRowLine({ childId: 'c', tool: 'Bash' })).toBe('c asks to run Bash. The command did not run and waits for a ruling.');
    expect(ruledLine({ verdict: 'deny', authority: 'coordinator' })).toMatch(/^Denied by your coordinator: /);
    expect(parkedRefusalText(new ApiError(409, { error: 'hook-gone' }))).toBe(PARKED_REFUSAL_TEXT['hook-gone']);
    expect(parkedRefusalText(new Error('x'))).toBe(PARKED_DEFAULT_REFUSAL);
    for (const w of ['park-ruled', 'hook-gone', 'coordinator-denied', 'auth-off']) expect(PARKED_REFUSAL_TEXT[w]).toBeTruthy();
  });

  it('orders oldest first without mutating', () => {
    const a = [parked({ id: 2, askAt: 5 }), parked({ id: 1, askAt: 1 })];
    expect(parkedOldestFirst(a).map((r) => r.id)).toEqual([1, 2]);
    expect(a[0]!.id).toBe(2);
  });
});
