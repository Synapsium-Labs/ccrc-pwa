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
  artifacts: [], state: 'delivered',
  attempts: 0, lastError: null,
  // D-792: no gate is holding this fixture — the shape of a delivery nothing
  // has refused. A test that wants a wedged one overrides these four.
  lastGate: null, gateCount: 0, gateSince: null, gateAt: null,
  ...over,
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

// TASK 412 — a delivery the lane is still retrying but cannot hand over.
//
// This is an EXTENSION of a shipped shape, not a new variant: the strip already
// renders exactly one distinct status line (`.mail-strip-abandoned`, keyed on
// `state === 'rejected'`), and this is a third `flex-basis: 100%` span of the
// same kind inside the SAME `<li>`.
//
// The copy is written for the reader actually looking at it. The spec's
// sender-side wording ("the recipient's input box") is wrong here: this strip
// renders mail addressed TO the session whose screen you are on, so the
// recipient IS this session. It names the box by WHOSE it is and points at
// nothing — the box with the unsent text in it is the session's own, not the
// PWA composer under this strip (see the tooltip test below).
describe('a blocked delivery is named before it is lost', () => {
  const blocked = (over: Partial<MailSummary> = {}) =>
    m({ state: 'queued', attempts: 3, lastError: 'draft-present', ...over });

  it('names the block, the attempt and the CEILING', () => {
    render(<MailStrip mail={[blocked()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(
      "blocked · attempt 3 of 6 — this session's input box has unsent text",
    )).toBeInTheDocument();
  });

  it('is a span inside the EXISTING row, not a second row', () => {
    const { container } = render(<MailStrip mail={[blocked()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelectorAll('li.mail-strip-row')).toHaveLength(1);
    expect(container.querySelector('li.mail-strip-row .mail-strip-blocked')).not.toBeNull();
  });

  // MEASURED, AND DISCLOSED: the exclusion has TWO defences and this test can
  // only red one of them. `isBlocked`'s `state === 'queued'` limb already makes
  // "rejected AND blocked" unconstructible, so restoring the two independent
  // guards the ternary replaced leaves the whole file green — verified by
  // mutation, not assumed. The ternary is therefore belt to that braces: it is
  // what keeps the exclusion true if anyone ever widens `isBlocked` past
  // `queued`, and this test is what catches it if the `queued` limb goes. Both
  // are worth having; only one of them is a mechanism, and this is which.
  // THE TOOLTIPS SAY WHAT THE LINE SAYS (review, W4c finding 3). Both hover
  // titles read "the input box below" while the copy they hover over was
  // deliberately written NOT to point anywhere: the box holding the unsent
  // text is the SESSION's own input box — the one `sendPrompt` types into and
  // reads back `draft-present` from — and the control below this strip is the
  // PWA's composer, which is a different box and is empty. An operator who
  // followed the tooltip would look at the wrong thing and find nothing wrong
  // with it.
  //
  // Asserted as "names the same box", not as byte-equality with the visible
  // line: a tooltip is allowed to be its own sentence, it is not allowed to
  // name a different box.
  it('names the same box in both tooltips as in the visible line', () => {
    const { container } = render(<MailStrip mail={[blocked()]} />);
    const mark = container.querySelector('.mail-strip-blocked-mark')!;
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const line = container.querySelector('.mail-strip-blocked')!;
    expect(line.textContent).toContain("this session's input box");
    for (const el of [mark, line]) {
      expect(el.getAttribute('title')).toContain("this session's input box");
      expect(el.getAttribute('title')).not.toMatch(/below/);
    }
  });

  it('never renders alongside the abandoned line — one status line per row', () => {
    const { container } = render(<MailStrip mail={[blocked({ state: 'rejected' })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-abandoned')).not.toBeNull();
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
  });

  // THE MAINLINE PATH, and the reason `state === 'queued'` is a guard rather
  // than belt-and-braces: `markDelivered` writes `state='delivered'` and does
  // NOT clear `lastError` (server/src/coord/store.ts) — so a delivery that was
  // blocked once and landed on the next tick keeps the word 'draft-present' in
  // that column forever. Reading `lastError` alone would leave a permanent
  // "blocked" line on a message that demonstrably arrived.
  it('says nothing about a delivery that WAS blocked and then landed', () => {
    const { container } = render(
      <MailStrip mail={[blocked({ state: 'delivered' })]} />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
    expect(container.querySelector('.mail-strip-blocked-mark')).toBeNull();
  });

  it('renders nothing for a queued delivery that is merely waiting', () => {
    const { container } = render(<MailStrip mail={[m({ state: 'queued', attempts: 0, lastError: null })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
  });

  it('reads lastError as a RAW string — an unrecognised value renders nothing, never a crash', () => {
    const { container } = render(<MailStrip mail={[blocked({ lastError: 'some-future-server-word' })]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelector('.mail-strip-blocked')).toBeNull();
  });

  // …and it is not shown to the operator either. The two halves of the wire
  // rule (never a Record key, never rendered raw) are scanned for structurally
  // further down this file; this is the same rule measured through the DOM, on
  // the one component that now reads the field.
  it('never puts the raw server word on screen', () => {
    render(<MailStrip mail={[blocked()]} />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.queryByText(/draft-present/)).toBeNull();
  });

  // ONLY the blocked row is flagged. Without this the feature could be a
  // per-STRIP flag painted on every row, which would name the wrong message.
  it('flags the blocked delivery and not its neighbour', () => {
    const { container } = render(
      <MailStrip mail={[blocked(), m({ id: 2, state: 'delivered', attempts: 1, lastError: null })]} />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(container.querySelectorAll('.mail-strip-blocked')).toHaveLength(1);
  });

  // THE STRIP OPENS CLOSED. Without this the whole feature is invisible in its
  // default state, which is the state it is in whenever the operator has not
  // already gone looking.
  it('the COLLAPSED head carries the flag', () => {
    const { container } = render(<MailStrip mail={[blocked()]} />);
    expect(container.querySelector('.mail-strip-head .mail-strip-blocked-mark')).not.toBeNull();
  });

  it('the head carries NO flag when nothing is blocked', () => {
    const { container } = render(<MailStrip mail={[m()]} />);
    expect(container.querySelector('.mail-strip-blocked-mark')).toBeNull();
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
