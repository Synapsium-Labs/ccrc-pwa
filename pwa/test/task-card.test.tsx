// The task card — the harness's report of a finished background task.
//
// The same defect the mail card was built for, in a second lane: a structured
// record the machine wrote arrived as a `user` turn and rendered as a wall of
// its own markup filed under the operator's name. The parser fixes the
// ATTRIBUTION; this card fixes what the row SHOWS.
//
// Same design as mail, asserted rather than described: the card is DERIVED at
// render time from an event already in the store, so nothing is minted into
// `s.events` and a reconnect re-derives the same card from the same bytes.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';
import { buildChatItems, ChatListInner } from '../src/session/ChatList';

afterEach(cleanup);

const TS = '2026-09-12T02:00:00.000Z';
const NOTIF = '<task-notification>\n<task-id>w0s3mcrji</task-id>\n'
  + '<tool-use-id>toolu_01Qj6Dyd</tool-use-id>\n<status>completed</status>\n'
  + '<summary>Dynamic workflow "resolve the six design forks" completed</summary>\n'
  + '<result>{"verdict":"shippable"}</result>\n</task-notification>';

const row = (text = NOTIF, uuid = 'n1'): ChatEvent =>
  ({ kind: 'system', uuid, ts: TS, text });

describe('a finished background task renders as the record it is', () => {
  it('leads with the harness summary, and shows no markup at all', () => {
    render(<ChatListInner id="s" events={[row()]} pending={[]} />);
    expect(screen.getByText(/resolve the six design forks/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('<task-notification>');
    expect(document.body.textContent).not.toContain('</summary>');
  });

  it('shows the status as its own chip, worded exactly as the harness wrote it', () => {
    render(<ChatListInner id="s" events={[row()]} pending={[]} />);
    const chip = screen.getByText('completed');
    expect(chip).toBeInTheDocument();
    expect(chip.className).toContain('task-card-status--ok');
  });

  it('a status this code has never seen is shown AS WRITTEN, with the neutral tone', () => {
    // Guessing is exactly what loses the only fact the row carries.
    render(<ChatListInner id="s" events={[row(NOTIF.replace('completed', 'throttled'))]} pending={[]} />);
    const chip = screen.getByText('throttled');
    expect(chip.className).not.toContain('--ok');
    expect(chip.className).not.toContain('--bad');
  });

  it('keeps the machinery one tap away rather than on screen or thrown out', () => {
    render(<ChatListInner id="s" events={[row()]} pending={[]} />);
    expect(screen.queryByText('w0s3mcrji')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /3 more/ }));
    expect(screen.getByText('w0s3mcrji')).toBeInTheDocument();
    expect(screen.getByText('{"verdict":"shippable"}')).toBeInTheDocument();
  });

  it('derives from the event — nothing is minted, so a reconnect rebuilds it', () => {
    const items = buildChatItems([row()], []);
    const task = items.find((i) => i.kind === 'task');
    expect(task).toBeDefined();
    if (task?.kind !== 'task') throw new Error('not a task item');
    expect(task.event).toEqual(row());
  });

  it('a system row that is NOT one falls through to the ordinary row, never a half card', () => {
    const items = buildChatItems([row('/effort', 'x1')], []);
    expect(items.filter((i) => i.kind === 'task')).toHaveLength(0);
    expect(items.some((i) => i.kind === 'message')).toBe(true);
  });
});
