// Approvals PR 2 (plan docs/superpowers/plans/2026-11-18-overlord-approvals.md, Task 2.1; Table 2a, path 6): a subagent's
// permission menu painted after its hook returned gets the approval surface, never a bare menu. The server takes the
// envelope from the hook's per-agent list for the painted menu (`paintedApprovalOf`) and marks it `thread: 'subagent'`;
// the console shows the tool, its summary and "One of its subagents asks to run a Bash call", with Allow and Deny, and
// never the kicker "Claude needs a choice". The frames are the session stream's own.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Dialog, HookAsk, SessionStreamMsg } from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { DialogSheet } from '../src/session/DialogSheet';
import { subagentAsksLine } from '../src/session/askWords';
import { KICKER_CHOICE } from '../src/session/AskParts';
import { createSessionStore } from '../src/stores/session';
import { answerSeam } from './answerSeam';
import { served } from './wirePairing';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ID = 'lane-a-project-a';
const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** The menu Claude Code paints for a Bash permission prompt, parsed. */
const MENU: Dialog = {
  id: 'dlg-sub', title: 'Bash command', body: 'rm -rf build\nRemove the build directory\n\nDo you want to proceed?',
  selectedIndex: 1, parsed: true, raw: '❯ 1. Yes',
  options: [{ index: 1, label: 'Yes' }, { index: 2, label: 'Yes, and always allow access to this project' }, { index: 3, label: 'No' }],
};
const SUBAGENT: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf build', thread: 'subagent' } };
const MAIN: HookAsk = { approval: { tool: 'Bash', summary: 'rm -rf build' } };

function mount(frames: SessionStreamMsg[]): void {
  const store = served(createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } }));
  act(() => { for (const f of frames) store.getState().apply(f); });
  render(<><DialogSheet answers={answerSeam()} id={ID} store={store} onOpenTerminal={vi.fn()} /><ToastHost /></>);
}
const text = (): string => document.body.textContent ?? '';

describe('a subagent\'s painted permission menu (path 6)', () => {
  it('the approval surface: the tool, the subagent line, the summary, Allow and Deny; never "Claude needs a choice"', () => {
    mount([{ type: 'dialog', dialog: MENU }, { type: 'ask', ask: SUBAGENT, key: 'ask-key-sub' }]);
    expect(screen.getByRole('heading', { name: 'Bash' })).toBeInTheDocument();
    expect(screen.getByText(subagentAsksLine('Bash'))).toBeInTheDocument();
    expect(subagentAsksLine('Bash')).toBe('One of its subagents asks to run a Bash call.');
    expect(screen.getByText('rm -rf build')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Allow/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Deny/ })).toBeEnabled();
    expect(text()).not.toContain(KICKER_CHOICE);
  });
  it('the main thread\'s own approval says no subagent line', () => {
    mount([{ type: 'dialog', dialog: MENU }, { type: 'ask', ask: MAIN, key: 'ask-key-main' }]);
    expect(screen.getByRole('button', { name: /^Allow/ })).toBeEnabled();
    expect(text()).not.toContain('One of its subagents');
  });
  it('with no envelope at all (an older server, or none matched) the same menu is the bare menu, as before', () => {
    mount([{ type: 'dialog', dialog: MENU }, { type: 'ask_cleared' }]);
    expect(text()).toContain(KICKER_CHOICE);
    expect(text()).not.toContain('One of its subagents');
  });
});
