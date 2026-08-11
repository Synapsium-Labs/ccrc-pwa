import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { MailSummary } from '../../shared/api';
import { MailStrip, summarizeMail } from '../src/session/MailStrip';
import { SessionScreen } from '../src/screens/SessionScreen';
import { applySessionMsg, createSessionStore } from '../src/stores/session';
import type { SessionSnapshot } from '../src/stores/session';

afterEach(cleanup);

// Fixed epoch, not Date.now(): two m() calls in the same test can otherwise
// land on the same millisecond, and `.sort((a,b)=>b.at-a.at)` over a tie is
// order-dependent on the engine's stable-sort input order — flaky in exactly
// the "newest headline" test below that needs a deterministic winner.
const T0 = 1_754_000_000_000;

const m = (over: Partial<MailSummary> = {}): MailSummary => ({
  id: 1, at: T0 - 30_000, fromId: 'coordinator', toId: 'ccrc-pwa-clear-cove',
  runId: 3, kind: 'question', subject: 'rebase before you start?',
  artifacts: [], state: 'delivered', ...over,
});

describe('the session mail strip', () => {
  it('renders NOTHING when there is no outstanding mail', () => {
    // TaskStrip's rule, and the reason: an ordinary conversation must not pay a
    // row for a feature it is not using.
    const { container } = render(<MailStrip mail={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('collapses to one headline plus a count', () => {
    render(<MailStrip mail={[m(), m({ id: 2, subject: 'findings from the review lens', at: T0 })]} />);
    expect(screen.getByText('findings from the review lens')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // No body on the wire (MailSummary has none — item 1's reconciliation),
    // so there is nothing resembling one to find in the collapsed view.
    expect(screen.queryByText(/rebase/)).not.toBeInTheDocument();
  });

  it('expands to the rows, with sender, kind and artifact paths', () => {
    render(<MailStrip mail={[m({ artifacts: ['docs/superpowers/programs/build4.md'] })]} />);
    // TaskStrip's own idiom (tasks.test.tsx): the head button's accessible
    // name is its live content (headline + count), so the door is found by
    // its collapsed state, not by a name regex the button carries no label for.
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText('coordinator')).toBeInTheDocument();
    expect(screen.getByText('question')).toBeInTheDocument();
    expect(screen.getByText('docs/superpowers/programs/build4.md')).toBeInTheDocument();
  });

  it('offers no way to answer — composing mail from the PWA is a stated non-goal', () => {
    render(<MailStrip mail={[m()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByRole('textbox')).toBeNull();
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/reply|answer|send/i);
    }
  });

  it('summarizes by kind, dropping the zero clauses', () => {
    // PLURAL walks MailKind's own declared order (shared/api.ts: finding,
    // question, answer, status, artifact, unknown) rather than inventing a
    // bespoke one, so findings lead here.
    expect(summarizeMail([m({ kind: 'question' }), m({ id: 2, kind: 'finding' }), m({ id: 3, kind: 'finding' })]))
      .toBe('2 findings · 1 question');
    expect(summarizeMail([])).toBe('');
  });
});

describe('the session store takes the mail frame', () => {
  const snap = (): SessionSnapshot => ({
    events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null,
    dialog: null, ask: null, tasks: [], mail: [], missingFile: null,
  });

  it('replaces the list, and an old client still shrugs at an unknown frame', () => {
    // applySessionMsg is a pure reducer with `msg satisfies never` in its
    // default arm — compile-time exhaustiveness here, shrug-not-corrupt for a
    // build that predates the frame.
    expect(applySessionMsg(snap(), { type: 'mail', mail: [m()] }).mail).toHaveLength(1);
  });

  it('replaces wholesale — a second frame with fewer items drops the rest', () => {
    const s = applySessionMsg(snap(), { type: 'mail', mail: [m(), m({ id: 2 })] });
    expect(applySessionMsg(s, { type: 'mail', mail: [] }).mail).toEqual([]);
  });
});

// End-to-end through the screen, not just the component — the same proof
// tasks.test.tsx runs for TaskStrip: a `mail` frame off the session stream
// must actually paint the strip above the composer.
describe('SessionScreen shows outstanding mail', () => {
  it('mounts MailStrip above TaskStrip when the stream sends mail', () => {
    const store = createSessionStore('claude:demo', {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close() {} }) as unknown as WebSocket,
      api: { prompt: async () => {} },
    });
    act(() => {
      store.getState().apply({ type: 'backlog', uuid: 'u1', events: [], offset: 0, file: '/t.jsonl', missing: false });
      store.getState().apply({ type: 'mail', mail: [m()] });
    });
    render(<SessionScreen id="claude:demo" store={store} />);
    expect(screen.getByText('rebase before you start?')).toBeInTheDocument();
  });
});
