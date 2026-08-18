import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
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
  id: 1, deliveryId: 1, at: T0 - 30_000, fromId: 'coordinator', toId: 'ccrc-pwa-clear-cove',
  runId: 3, kind: 'question', subject: 'rebase before you start?',
  artifacts: [], state: 'delivered', attempts: 0, lastError: null, ...over,
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

  it('flags a delivery the lane abandoned, distinct from an ordinary pending row (review finding 2)', () => {
    // `outstandingMailFor` now also carries a `state:'rejected'` delivery the
    // lane gave up retrying past its own replay ceiling — never acked, never
    // acted on, so it must not read as an ordinary in-flight message.
    render(<MailStrip mail={[m({ state: 'rejected' }), m({ id: 2, state: 'delivered' })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/undeliverable/i)).toBeInTheDocument();
    // Only ONE of the two rows is flagged — the ordinary `delivered` one is
    // not.
    expect(screen.getAllByText(/undeliverable/i)).toHaveLength(1);
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
    strandedAccount: null, searchComplete: true, file: null,
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

// TASK 408 — the rule that comes attached to `MailSummary.lastError`.
//
// The field is the delivery lane's last failure, RAW. Four writers put four
// different kinds of thing in that column: a typed `sendPrompt` error code,
// `'recipient not in registry'`, `'run closed'`, and a whole English sentence
// (`MAIL_REPLAY_CEILING_ERROR`). Putting it on the wire makes this client a
// consumer of free text, and free text has exactly two ways of going wrong in
// a UI — being keyed as if it were a vocabulary, and being shown to a human as
// if it were a sentence written for them. So:
//
//   BRANCH on the one literal token there is a surface for (`=== 'draft-present'`);
//   never key a `Record` off it — a value a newer server writes renders `undefined`;
//   never display it raw.
//
// A TRIPWIRE, ARMED EARLY, and honestly labelled as such: `pwa/src` has no
// `lastError` reader yet, so this scan passes today by finding nothing. It
// exists so the FIRST reader has to be written in the permitted shape rather
// than discovered in review — the paragraph above stops being a request the
// moment either forbidden shape is typed. Verified by mutation: pasting
// `MAP[m.lastError]` or `<p>{m.lastError}</p>` into `MailStrip.tsx` reds it.
//
// The Record-key half tolerates an intervening cast — `MAP[m.lastError as string]`
// reds exactly as `MAP[m.lastError]` does — and that is not a nicety: `lastError`
// is `string | null`, so it CANNOT index a `Record<string, …>` without a cast or
// a narrowing, which means the cast is the shape the type actively pushes a
// developer toward. A tripwire blind to the likeliest spelling of the mistake
// would be one of this build's "tests that cannot fail" (review finding, W4b).
//
// Its LIMIT, stated rather than left to be found: it matches on `X.lastError`,
// so a value destructured into a bare local first (`const { lastError } = m`)
// is invisible to it. That is a scan, not a type system; what it buys is that
// the obvious way to write the wrong thing is a red suite.
describe('lastError is consumed as free text, or not at all', () => {
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return srcFiles(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });

  const noComments = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const scan = (re: RegExp): string[] =>
    srcFiles(path.join(import.meta.dirname, '..', 'src'))
      .filter((f) => re.test(noComments(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(path.join(import.meta.dirname, '..'), f));

  it('is never used as a Record key — a new server value must not render undefined', () => {
    expect(scan(/\[\s*[\w$]+(?:\.[\w$]+)*\.lastError(?:\s+as\s+[^\]]+)?\s*\]/)).toEqual([]);
  });

  it('is never rendered raw — it is a maintainer’s grep target, not operator copy', () => {
    expect(scan(/\{\s*[\w$]+(?:\.[\w$]+)*\.lastError\s*\}/)).toEqual([]);
  });

  // The POSITIVE half, and the reason the type is `string | null` rather than a
  // union of the codes anyone has seen so far: an arbitrary sentence is a legal
  // value, and a client that assumed otherwise would be wrong about a column
  // nothing validates on the way in. Type-checked by `npm run build`.
  it('accepts an arbitrary sentence, because the column does', () => {
    const row = m({ lastError: 'the recipient acknowledged nothing for three hours', attempts: 4 });
    expect(row.lastError).toBe('the recipient acknowledged nothing for three hours');
    expect(row.attempts).toBe(4);
    // And absence is a distinct value: never attempted is not "failed with ''".
    expect(m().lastError).toBeNull();
  });
});
