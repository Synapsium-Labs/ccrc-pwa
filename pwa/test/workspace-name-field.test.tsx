// The "Name or Linear ticket" field and its live preview (named workspaces S7). The field is rendered the way a sheet
// renders it: the hook owns the answer, the component draws it. Timers are faked, because the debounce is the
// behaviour: typing asks nothing, and only a pause asks.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { WorkspaceNameField, NAME_FIELD_TEXT } from '../src/fleet/WorkspaceNameField';
import { NAME_LOOKUP_DEBOUNCE_MS, useNamePreview } from '../src/fleet/useNamePreview';
import { LOOKUP_NOTE, type ResolveRead } from '../src/fleet/workspaceNameWords';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

function Harness({ initial = '', disabledReason = null, onOpenSettings }: {
  initial?: string; disabledReason?: string | null; onOpenSettings?: () => void;
}): ReactNode {
  const [value, setValue] = useState(initial);
  const preview = useNamePreview(value, { enabled: disabledReason === null });
  return (
    <WorkspaceNameField
      value={value} onChange={setValue} preview={preview} project="project-a"
      emptyHint="Leave empty for an automatic name." disabledReason={disabledReason} onOpenSettings={onOpenSettings}
    />
  );
}

const field = (): HTMLInputElement => screen.getByLabelText(NAME_FIELD_TEXT.label) as HTMLInputElement;
const type = (text: string): void => { fireEvent.change(field(), { target: { value: text } }); };
const settle = async (ms: number): Promise<void> => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

const linearAnswer: ResolveRead = { title: 'ENG-1234 - Fix the login flow', source: 'linear', note: null };

describe('the field', () => {
  it('never takes the focus when it mounts', () => {
    render(<Harness />);
    expect(document.activeElement).not.toBe(field());
    expect(field()).not.toHaveAttribute('autofocus');
  });

  it('says what an empty field means, and nothing else', () => {
    const resolve = vi.spyOn(api, 'linearResolve');
    render(<Harness />);
    expect(screen.getByText('Leave empty for an automatic name.')).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps exactly what was typed: case, spaces and all', () => {
    render(<Harness />);
    type('  Login Cleanup  ');
    expect(field().value).toBe('  Login Cleanup  ');
  });

  it('a plain name previews its title, id and branch with no request and no badge', async () => {
    const resolve = vi.spyOn(api, 'linearResolve');
    render(<Harness />);
    type('Login cleanup');
    expect(screen.getByText('Login cleanup')).toBeInTheDocument();
    expect(screen.getByText('new workspace project-a-login-cleanup · branch ws/login-cleanup')).toBeInTheDocument();
    await settle(NAME_LOOKUP_DEBOUNCE_MS * 3);
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByText(NAME_FIELD_TEXT.lookingUp)).not.toBeInTheDocument();
    expect(screen.queryByText(NAME_FIELD_TEXT.offline)).not.toBeInTheDocument();
  });

  it('a refused name shows the grammar\'s sentence, marks the field invalid and asks nothing', async () => {
    const resolve = vi.spyOn(api, 'linearResolve');
    render(<Harness />);
    type('!!');
    expect(screen.getByText('That has no letters or numbers in it.')).toBeInTheDocument();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    type('a');
    expect(screen.getByText('A name needs at least two characters.')).toBeInTheDocument();
    await settle(NAME_LOOKUP_DEBOUNCE_MS * 3);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('says that the slug was cut to fit when it was', () => {
    render(<Harness />);
    type('Investigate the flaky upload test on the staging runner');
    expect(screen.getByText(NAME_FIELD_TEXT.shortened)).toBeInTheDocument();
  });
});

describe('the lookup', () => {
  it('waits for a pause, asks once for the final text, and shows Linear\'s title', async () => {
    const resolve = vi.spyOn(api, 'linearResolve').mockResolvedValue(linearAnswer);
    render(<Harness />);
    type('E');
    type('ENG');
    type('ENG-1234');
    expect(screen.getByText(NAME_FIELD_TEXT.lookingUp)).toBeInTheDocument();
    // The offline title and the slug are on screen while it waits.
    expect(screen.getByText('ENG-1234')).toBeInTheDocument();
    expect(screen.getByText('new workspace project-a-eng-1234 · branch ws/eng-1234')).toBeInTheDocument();

    await settle(NAME_LOOKUP_DEBOUNCE_MS - 1);
    expect(resolve).not.toHaveBeenCalled();
    await settle(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('ENG-1234');

    expect(screen.getByText('ENG-1234 - Fix the login flow')).toBeInTheDocument();
    expect(screen.getByText(NAME_FIELD_TEXT.fromLinear)).toBeInTheDocument();
    expect(screen.queryByText(NAME_FIELD_TEXT.lookingUp)).not.toBeInTheDocument();
  });

  it('every keystroke restarts the wait', async () => {
    const resolve = vi.spyOn(api, 'linearResolve').mockResolvedValue(linearAnswer);
    render(<Harness />);
    type('ENG-123');
    await settle(NAME_LOOKUP_DEBOUNCE_MS - 100);
    type('ENG-1234');
    await settle(NAME_LOOKUP_DEBOUNCE_MS - 100);
    expect(resolve).not.toHaveBeenCalled();
    await settle(100);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('ENG-1234');
  });

  it('asks with the trimmed text, and a pasted link and a copied branch are asked about too', async () => {
    const resolve = vi.spyOn(api, 'linearResolve').mockResolvedValue(linearAnswer);
    render(<Harness />);
    type('  user-a/eng-1301-retry-the-upload ');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(resolve).toHaveBeenCalledWith('user-a/eng-1301-retry-the-upload');
  });

  it('drops an answer that lands for text the field no longer holds', async () => {
    let release!: (r: ResolveRead) => void;
    vi.spyOn(api, 'linearResolve').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    render(<Harness />);
    type('ENG-1');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    type('Login cleanup');
    await act(async () => { release({ title: 'ENG-1 - Late', source: 'linear', note: null }); });
    expect(screen.queryByText('ENG-1 - Late')).not.toBeInTheDocument();
    expect(screen.getByText('Login cleanup')).toBeInTheDocument();
  });

  it('an answer for the previous ticket never stands in for the next one\'s', async () => {
    vi.spyOn(api, 'linearResolve').mockResolvedValueOnce({ title: 'ENG-1 - One', source: 'linear', note: null });
    render(<Harness />);
    type('ENG-1');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(screen.getByText('ENG-1 - One')).toBeInTheDocument();
    type('ENG-2');
    expect(screen.queryByText('ENG-1 - One')).not.toBeInTheDocument();
    expect(screen.getByText(NAME_FIELD_TEXT.lookingUp)).toBeInTheDocument();
  });

  it('a slow answer for an old ticket cannot overwrite the newer ticket\'s', async () => {
    const releases: ((r: ResolveRead) => void)[] = [];
    vi.spyOn(api, 'linearResolve').mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
    render(<Harness />);
    type('ENG-1');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    type('ENG-2');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(releases).toHaveLength(2);
    await act(async () => { releases[1]?.({ title: 'ENG-2 - Two', source: 'linear', note: null }); });
    await act(async () => { releases[0]?.({ title: 'ENG-1 - One', source: 'linear', note: null }); });
    expect(screen.getByText('ENG-2 - Two')).toBeInTheDocument();
    expect(screen.queryByText(NAME_FIELD_TEXT.lookingUp)).not.toBeInTheDocument();
  });

  it('an offline answer keeps the typed title and says why, quietly', async () => {
    vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-9999', source: 'offline', note: 'not-found' });
    // A way to Settings is on offer to this door, and a missing issue is not something Settings fixes.
    render(<Harness onOpenSettings={vi.fn()} />);
    type('ENG-9999');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(screen.getByText(NAME_FIELD_TEXT.offline)).toBeInTheDocument();
    expect(screen.getByText(LOOKUP_NOTE['not-found'].hint)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a Linear that forbade the lookup says so quietly, and does not send the operator to replace a key it did not call bad', async () => {
    vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-9999', source: 'offline', note: 'forbidden' });
    render(<Harness onOpenSettings={vi.fn()} />);
    type('ENG-9999');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(screen.getByText(LOOKUP_NOTE.forbidden.hint)).toBeInTheDocument();
    expect(LOOKUP_NOTE.forbidden.hint).not.toBe(LOOKUP_NOTE.unauthorised.hint);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['a rejected request', () => Promise.reject(new ApiError(502, { ok: false }))],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an unreadable answer', () => Promise.resolve('unreadable' as const)],
  ])('%s is an offline preview with its own note, never a refusal', async (_name, answer) => {
    vi.spyOn(api, 'linearResolve').mockImplementation(answer);
    render(<Harness />);
    type('ENG-1234');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(screen.getByText(NAME_FIELD_TEXT.offline)).toBeInTheDocument();
    expect(screen.getByText(LOOKUP_NOTE['call-failed'].hint)).toBeInTheDocument();
    expect(field()).not.toHaveAttribute('aria-invalid');
    expect(screen.getByText('ENG-1234')).toBeInTheDocument();
  });
});

describe('the Settings pointer', () => {
  it.each([
    ['not-configured', 'Connect Linear in Settings'],
    ['unauthorised', 'Replace the key in Settings'],
  ] as const)('%s offers its way to Settings', async (note, label) => {
    vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-1234', source: 'offline', note });
    const open = vi.fn();
    render(<Harness onOpenSettings={open} />);
    type('ENG-1234');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('is not drawn when Linear answered, or the host gave no way to open Settings', async () => {
    vi.spyOn(api, 'linearResolve').mockResolvedValue(linearAnswer);
    const open = vi.fn();
    render(<Harness onOpenSettings={open} />);
    type('ENG-1234');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    cleanup();

    vi.spyOn(api, 'linearResolve').mockResolvedValue({ title: 'ENG-1234', source: 'offline', note: 'not-configured' });
    render(<Harness />);
    type('ENG-1234');
    await settle(NAME_LOOKUP_DEBOUNCE_MS);
    expect(screen.getByText(LOOKUP_NOTE['not-configured'].hint)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// RENAME MODE (named workspaces S9): the same field, told the slug it keeps. It must read `slug stays <slug>` where a
// create reads the new id and branch, draw no "shortened" note (a slug is not being made), and take its own placeholder.
describe('rename mode (keepSlug)', () => {
  function RenameHarness({ initial }: { initial: string }): ReactNode {
    const [value, setValue] = useState(initial);
    const preview = useNamePreview(value);
    return (
      <WorkspaceNameField
        value={value} onChange={setValue} preview={preview} project="project-a" emptyHint="Leave empty."
        keepSlug="quiet-harbor" placeholder="A title, a ticket id or a link"
      />
    );
  }

  it('says the slug stays, and never says a workspace will be made', () => {
    render(<RenameHarness initial="Upload retry spike" />);
    expect(screen.getByText('slug stays quiet-harbor')).toBeInTheDocument();
    expect(screen.queryByText(/new workspace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/branch ws\//)).not.toBeInTheDocument();
  });

  it('draws no shortened note for a name that would not fit a slug', () => {
    render(<RenameHarness initial={'a very long title that would never fit a slug '.repeat(2)} />);
    expect(screen.queryByText(NAME_FIELD_TEXT.shortened)).not.toBeInTheDocument();
    expect(screen.getByText('slug stays quiet-harbor')).toBeInTheDocument();
  });

  it('takes its own placeholder, and the create keeps its own', () => {
    render(<RenameHarness initial="" />);
    expect(field()).toHaveAttribute('placeholder', 'A title, a ticket id or a link');
    cleanup();
    render(<Harness />);
    expect(field()).toHaveAttribute('placeholder', NAME_FIELD_TEXT.placeholder);
  });

  it('a refusal reads the same in both modes', () => {
    render(<RenameHarness initial="!!" />);
    expect(screen.getByText('That has no letters or numbers in it.')).toBeInTheDocument();
    expect(screen.queryByText(/slug stays/)).not.toBeInTheDocument();
  });
});

describe('a door that cannot take a name', () => {
  it('disables the field, says why, and previews nothing', async () => {
    const resolve = vi.spyOn(api, 'linearResolve');
    render(<Harness initial="ENG-1234" disabledReason="Named workspaces start in this account's own pool." />);
    expect(field()).toBeDisabled();
    expect(screen.getByText("Named workspaces start in this account's own pool.")).toBeInTheDocument();
    expect(screen.queryByText('new workspace project-a-eng-1234 · branch ws/eng-1234')).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute('aria-invalid');
    await settle(NAME_LOOKUP_DEBOUNCE_MS * 2);
    // A disabled door must not talk to Linear on behalf of text it will never send.
    expect(resolve).not.toHaveBeenCalled();
  });
});
