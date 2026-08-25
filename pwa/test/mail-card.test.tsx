// The mail card — Build 4 Task 17, spec §2.1/§2.3/§2.4.
//
// Fact 2 of the spec: delivered mail is ALREADY in the transcript, as the
// operator's own words. `renderEnvelope` builds a fenced block, the delivery
// lane types it into the recipient's input box, and it lands in the JSONL as a
// `user` turn — so today it renders as a "you" bubble containing a fence.
// There is no missing mail EVENT; there is a missing ATTRIBUTION.
//
// The whole design of the fix is in one line of `buildChatItems`: the card is
// DERIVED at render time from the event already in the store. Nothing is
// minted into `s.events`, so the revival discipline (`stores/session.ts`)
// needs no new clause and a reconnect re-derives the same card from the same
// JSONL bytes. The `derives from the event` test below is that property,
// asserted rather than described.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatEvent, SessionStreamMsg } from '../../shared/api';
import { MAIL_ENVELOPE_FENCE } from '../../shared/api';
import { buildChatItems, ChatListInner } from '../src/session/ChatList';
import { applySessionMsg, type SessionSnapshot } from '../src/stores/session';
import { norm, stripComments } from './cssRule';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TS = '2026-08-13T10:00:00.000Z';
const chatCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8',
);

/** The envelope text as `server/src/coord/envelope.ts` mints it. Written out
 *  here rather than imported so this suite pins the GRAMMAR as it appears in a
 *  transcript, not as one module happens to build it — the round trip between
 *  the two is `server/test/mail-envelope-parse.test.ts`'s job. */
const envelopeText = (over: {
  id?: number; from?: string; to?: string; run?: string | null;
  kind?: string; subject?: string; artifacts?: string[]; body?: string;
} = {}): string => {
  const {
    id = 17, from = 'coordinator', to = 'ccrc-pwa-brisk-harbor',
    run = '5 (program:build4 wave 4/4)', kind = 'status', subject = 'wave-brief',
    artifacts = [], body = 'Implement Tasks 15-19 in order, red-first.',
  } = over;
  const lines = [`id: ${id}`, `from: ${from}`, `to: ${to}`];
  if (run !== null) lines.push(`run: ${run}`);
  lines.push(`kind: ${kind}`, `subject: ${subject}`);
  if (artifacts.length > 0) {
    lines.push('artifacts:');
    for (const p of artifacts) lines.push(`  ${p}`);
  }
  lines.push(
    `ack: POST /api/mail/${id}/ack with header x-ccrc-mail-token (the value in`,
    '  ~/.cc-secrets/ccrc-mail.token) and body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.',
    '  Until you ack, this message is redelivered on later sweeps, up to a bounded number of',
    '  attempts — after that the lane gives up and marks it undeliverable. Ack it promptly.',
    '--',
  );
  return '```' + MAIL_ENVELOPE_FENCE + '\n' + lines.join('\n') + '\n' + body + '\n```';
};

const mailTurn = (uuid = 'm1', over: Parameters<typeof envelopeText>[0] = {}): ChatEvent =>
  ({ kind: 'user', uuid, ts: TS, text: envelopeText(over) });

const card = (): HTMLElement | null => document.querySelector('.mail-card');
const textOf = (sel: string): string[] =>
  [...document.querySelectorAll(sel)].map((n) => n.textContent ?? '');

describe('MailCard', () => {
  it('renders a delivered envelope as a mail card attributed to its sender', () => {
    render(<ChatListInner id="s" events={[mailTurn()]} pending={[]} />);

    expect(card()).not.toBeNull();
    // The attribution is the whole point: sender AND recipient, both named.
    const from = document.querySelector('.mail-card-from')?.textContent ?? '';
    expect(from).toContain('coordinator');
    expect(from).toContain('ccrc-pwa-brisk-harbor');
  });

  it('names kind, subject and run/wave, and renders artifacts AS PATHS', () => {
    render(<ChatListInner id="s" events={[mailTurn('m1', {
      artifacts: ['docs/superpowers/plans/build4.md', '/tmp/wave4.log'],
    })]} pending={[]} />);

    expect(textOf('.mail-card-kind')).toEqual(['status']);
    expect(textOf('.mail-card-subject')).toEqual(['wave-brief']);
    const run = document.querySelector('.mail-card-run')?.textContent ?? '';
    expect(run).toContain('5');
    expect(run).toContain('build4');
    expect(run).toContain('4/4');

    // PATHS, never payloads (spec:52-53) — each on its own row, verbatim, and
    // not linkified into something a tap could fetch.
    expect(textOf('.mail-card-artifact')).toEqual([
      'docs/superpowers/plans/build4.md', '/tmp/wave4.log',
    ]);
    expect(document.querySelectorAll('.mail-card-artifact a')).toHaveLength(0);
  });

  it('renders no run line at all when the envelope carries no run', () => {
    render(<ChatListInner id="s" events={[mailTurn('m1', { run: null })]} pending={[]} />);
    expect(card()).not.toBeNull();
    expect(document.querySelector('.mail-card-run')).toBeNull();
  });

  it('folds the ack boilerplate away and shows the body', () => {
    render(<ChatListInner id="s" events={[mailTurn()]} pending={[]} />);

    const body = document.querySelector('.mail-card-body')?.textContent ?? '';
    expect(body).toBe('Implement Tasks 15-19 in order, red-first.');
    // The four-line ack instruction is the agent's protocol, not the
    // operator's reading. It is nowhere on the card.
    const all = document.body.textContent ?? '';
    expect(all).not.toContain('x-ccrc-mail-token');
    expect(all).not.toContain('~/.cc-secrets/ccrc-mail.token');
    expect(all).not.toContain('/ack');
    expect(all).not.toContain('redelivered on later sweeps');
  });

  it('does NOT render as a "you" bubble', () => {
    // The whole point. Before this build the same turn rendered through
    // `MessageBubble` as `.msg-user` — the machine's words attributed to the
    // operator.
    render(<ChatListInner id="s" events={[mailTurn()]} pending={[]} />);
    expect(document.querySelector('.msg-user')).toBeNull();
    // And the raw fence never reaches the screen.
    expect(document.body.textContent ?? '').not.toContain('```');
  });

  it('offers no ack control and no reply control', () => {
    // Negative pin, the `mail-strip.test.tsx` "offers no way to answer" idiom.
    // Ack is box-token gated and is the AGENT's act (`envelope.ts`'s own `ack:`
    // lines); a PWA control for it would be a second door on one act.
    render(<ChatListInner id="s" events={[mailTurn()]} pending={[]} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/\back\b|reply|answer/i);
  });

  it('leaves a MALFORMED envelope as an ordinary bubble, never a half-populated card', () => {
    // Text that CLAIMS to be an envelope and is not. spec §2.4: never a
    // half-populated card. `parseMailEnvelope` keeps `malformed` as its own
    // member precisely so a later reader COULD treat it differently; today it
    // renders exactly like `not-mail`, and this pins that it is a bubble.
    const broken: ChatEvent = {
      kind: 'user', uuid: 'm1', ts: TS,
      text: '```' + MAIL_ENVELOPE_FENCE + '\nid: not-a-number\nfrom: coordinator\n--\nbody\n```',
    };
    render(<ChatListInner id="s" events={[broken]} pending={[]} />);
    expect(card()).toBeNull();
    expect(document.querySelector('.msg-user')).not.toBeNull();
  });

  it('leaves a turn that is one fenced block PLUS prose as an ordinary bubble', () => {
    // The whole-turn rule, and it lives in `parseMailEnvelope` — this file
    // holds no second copy of it. An operator quoting mail back at a session
    // is the operator's own words, and must read as such.
    //
    // BOTH SIDES, and that is not symmetry for its own sake (Task 19 mutation
    // sweep). Prose ABOVE is refused by the OPENING-fence rule — line 0 is not
    // a fence — so an above-only fixture stays green with the whole-turn rule
    // deleted and pins nothing. Prose BELOW is the case only the closing-fence
    // rule can refuse, and it is what makes this test able to fail.
    for (const text of [
      `here is what I got:\n${envelopeText()}`,
      `${envelopeText()}\nand that is what it said`,
      `before\n${envelopeText()}\nafter`,
    ]) {
      cleanup();
      const quoted: ChatEvent = { kind: 'user', uuid: 'm1', ts: TS, text };
      render(<ChatListInner id="s" events={[quoted]} pending={[]} />);
      expect(card(), text.slice(0, 24)).toBeNull();
      expect(document.querySelector('.msg-user'), text.slice(0, 24)).not.toBeNull();
    }
  });

  it('an ASSISTANT turn carrying the same text is never a mail card', () => {
    // Delivered mail arrives as a `user` turn — that is what the injection
    // lane produces. An assistant turn that happens to quote an envelope is
    // the agent's own words about mail, not mail.
    const asAssistant: ChatEvent = { kind: 'assistant', uuid: 'a1', ts: TS, text: envelopeText() };
    render(<ChatListInner id="s" events={[asAssistant]} pending={[]} />);
    expect(card()).toBeNull();
  });

  it('derives from the event, minting nothing into the store — a reconnect re-derives it', () => {
    // The revival discipline needs no new clause BECAUSE of this. The store
    // holds one `user` event and nothing else; the card exists only in the
    // render model, so a reconnect that replaces the backlog with the same
    // JSONL bytes produces the same card again.
    const empty: SessionSnapshot = {
      events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null,
      dialog: null, ask: null, tasks: [], mail: [], missingFile: null,
      strandedAccount: null, searchComplete: true, file: null,
    };
    const backlog: SessionStreamMsg = {
      type: 'backlog', uuid: 'u1', events: [mailTurn()], offset: 40,
      file: '/t/u1.jsonl', missing: false,
    };

    const after = applySessionMsg(empty, backlog);
    expect(after.events).toHaveLength(1);
    expect(after.events.every((e) => e.kind === 'user')).toBe(true);
    // Nothing minted: no synthesized row of any other kind landed in the store.
    expect(after.events.map((e) => e.kind)).toEqual(['user']);

    const first = buildChatItems(after.events, []);
    expect(first.filter((i) => i.kind === 'mail')).toHaveLength(1);

    // The reconnect: the same backlog applied again over the result.
    const reconnected = applySessionMsg(after, backlog);
    const second = buildChatItems(reconnected.events, []);
    expect(second.filter((i) => i.kind === 'mail')).toHaveLength(1);
    expect(second.map((i) => i.kind)).toEqual(first.map((i) => i.kind));
    expect(second.map((i) => i.key)).toEqual(first.map((i) => i.key));
  });

  it('keys on the event uuid, so the virtual list is stable', () => {
    const items = buildChatItems([mailTurn('uuid-abc')], []);
    const mail = items.find((i) => i.kind === 'mail');
    expect(mail?.key).toBe('uuid-abc');
    // And carries the event it derived from, so nothing downstream has to go
    // looking for it again.
    expect(mail?.kind === 'mail' && mail.event.kind === 'user' && mail.event.uuid).toBe('uuid-abc');
  });

  it('goes still: no --glow, no animation, no box-shadow under .mail-card', () => {
    // No-glow governance, extended (spec §2.3): a mail card is a RECORD of
    // something that was said, not a living pane. The scan is over every rule
    // whose selector mentions `.mail-card`, so a sibling added later cannot be
    // missed by forgetting to list it — with a floor so a renamed block cannot
    // make the loop pass vacuously.
    const rules = [...stripComments(chatCss).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => (m[1] ?? '').includes('.mail-card'));
    expect(rules.length).toBeGreaterThanOrEqual(5);
    for (const m of rules) {
      const sel = norm(m[1] ?? '');
      const rule = norm(m[2] ?? '');
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });

  it('does not overlap MailStrip: the strip answers "unacted-on", the card "what was said, when"', () => {
    // Two surfaces, two questions, neither a second door on one act (spec
    // §2.4). The card renders no state chip and no count — those belong to the
    // strip, which reads the DATABASE's own outstanding rows; the card can
    // only ever show mail that was actually delivered, in the order it landed.
    render(<ChatListInner id="s" events={[mailTurn()]} pending={[]} />);
    const all = document.body.textContent ?? '';
    expect(all).not.toMatch(/queued|delivered|acked|undeliverable/i);
    expect(document.querySelector('.mail-strip')).toBeNull();
  });
});

// — W-1 / D-296 (was D-B4-23): the LIVE lane —
//
// The spec's measured fact expired mid-program. `sweepMail` no longer types
// the envelope into the pane (43b2737, an ancestor of this wave's own base);
// it types a one-line nudge, and the worker fetches the body with
// `GET /api/mail/:id`. So today's mail reaches a transcript as a
// `tool_result`, never a `user` turn, and the user-turn path above — which
// still renders real cards for waves 1-2's transcripts — became the LEGACY
// path the moment that commit landed.
describe('MailCard from the live lane: a fetched envelope', () => {
  const RAW = envelopeText();
  const WRAPPED = JSON.stringify({
    ok: true, id: 17, toId: 'ccrc-pwa-brisk-harbor', state: 'delivered', envelope: RAW,
  });

  /** The fetch as the transcript records it: a `tool_use` for the command and
   *  the `tool_result` carrying what it printed. */
  const fetchOf = (text: string, over: Partial<{ truncatedBytes: number; isError: boolean }> = {}): ChatEvent[] => ([
    { kind: 'tool_use', uuid: 'u1', ts: TS, toolId: 'toolu_01', name: 'Bash', input: 'curl -s .../api/mail/17' },
    { kind: 'tool_result', ts: TS, toolId: 'toolu_01', text, isError: over.isError ?? false,
      ...(over.truncatedBytes === undefined ? {} : { truncatedBytes: over.truncatedBytes }) },
  ]);

  it('renders a card for the RAW FENCE shape — the fetch that printed the envelope', () => {
    render(<ChatListInner id="s" events={fetchOf(RAW)} pending={[]} />);
    expect(card()).not.toBeNull();
    expect(document.querySelector('.mail-card-from')?.textContent ?? '').toContain('coordinator');
    expect(textOf('.mail-card-subject')).toEqual(['wave-brief']);
  });

  it('renders a card for the JSON-WRAPPED shape — what a bare curl leaves behind', () => {
    render(<ChatListInner id="s" events={fetchOf(WRAPPED)} pending={[]} />);
    expect(card()).not.toBeNull();
    expect(textOf('.mail-card-subject')).toEqual(['wave-brief']);
  });

  it('still files the fetch itself as a tool card — the card is ADDED, the result is not stolen', () => {
    // The tool_use must still get its result, or the fetch would render as a
    // tool still crunching, forever. The mail card joins it; it does not
    // replace it.
    render(<ChatListInner id="s" events={fetchOf(RAW)} pending={[]} />);
    expect(document.querySelectorAll('.toolcard')).toHaveLength(1);
    expect(card()).not.toBeNull();

    // NOT just "the card exists" — that is satisfied by a tool card that
    // never received its result, which is exactly the mutant this test is
    // for (M-16, W-1 sweep: a `tool.result = e` skipped for envelope-bearing
    // results left the fetch spinning forever and every other assertion here
    // green). The dot is the discriminator: `--run` while a call is in
    // flight, `--ok` once its result landed.
    expect(document.querySelector('.tool-dot--run')).toBeNull();
    expect(document.querySelector('.tool-dot--ok')).not.toBeNull();

    // And the card comes AFTER the fetch that produced it, in transcript order.
    const nodes = [...document.querySelectorAll('.toolcard, .mail-card')];
    expect(nodes[0]?.className).toContain('toolcard');
    expect(nodes[1]?.className).toContain('mail-card');
  });

  it('NEVER renders a card for a TRUNCATED result, even when the text still parses', () => {
    // The sharpest new edge. A `tool_result` the server admits it cut cannot
    // back the claim a card makes ("this is what was said"), and spec §2.4
    // forbids a half-populated card. The parse would refuse MOST truncated
    // envelopes on its own — the closing fence is the last line and the cut
    // takes the tail — but "most" is not a property a card may rest on, so the
    // guard is explicit. This fixture is the case that slips past the parse:
    // a complete envelope whose trailing bytes were cut.
    render(<ChatListInner id="s" events={fetchOf(RAW, { truncatedBytes: 900 })} pending={[]} />);
    expect(card()).toBeNull();
    expect(document.querySelectorAll('.toolcard')).toHaveLength(1);
  });

  it('renders a card at truncatedBytes 0, and when the field is absent', () => {
    // 0 = not truncated. Absent = an older server did not report, which is
    // exactly the state every transcript written before Task 16 is in — and
    // refusing those would make the live path dead for all of them.
    for (const events of [fetchOf(RAW, { truncatedBytes: 0 }), fetchOf(RAW)]) {
      cleanup();
      render(<ChatListInner id="s" events={events} pending={[]} />);
      expect(card()).not.toBeNull();
    }
  });

  it('renders no card for an ERRORED fetch', () => {
    // A non-zero exit did not return an envelope; whatever is in the buffer,
    // the fetch did not come back cleanly.
    render(<ChatListInner id="s" events={fetchOf(RAW, { isError: true })} pending={[]} />);
    expect(card()).toBeNull();
  });

  it('leaves every other kind of command output alone', () => {
    // Measured on this worker's own transcript: twelve tool_results carried
    // the characters `ccrc-mail` and not one was an envelope.
    for (const text of [
      'total 42\n-rw------- 1 you you 1453 Aug 12 20:04 ccrc-mail.token',
      "server/src/coord/token.ts:20: * `deploy/ccrc-mail.token.example` ships as a comment block",
      `here is the mail:\n${RAW}`,
      '{"ok":false,"error":"not-found"}',
      '```' + MAIL_ENVELOPE_FENCE + '\nid: not-a-number\n--\nb\n```',
    ]) {
      cleanup();
      render(<ChatListInner id="s" events={fetchOf(text)} pending={[]} />);
      expect(card(), text.slice(0, 30)).toBeNull();
    }
  });

  it('does NOT widen the legacy door — a user turn carrying a JSON response stays a bubble', () => {
    // The two doors are separate on purpose and the separation is pinned AT
    // THE CALL SITE, not only inside `shared/`: a typed envelope is never a
    // fetch's JSON output, so the older, narrower arm must keep using the
    // strict parser. Without this, "use the wider parser everywhere, it's
    // simpler" is a one-line change no test would notice.
    const asUserTurn: ChatEvent = { kind: 'user', uuid: 'm1', ts: TS, text: WRAPPED };
    render(<ChatListInner id="s" events={[asUserTurn]} pending={[]} />);
    expect(card()).toBeNull();
    expect(document.querySelector('.msg-user')).not.toBeNull();
  });

  it('keys on the toolId, so the virtual list is stable and the key cannot collide with the tool card', () => {
    const items = buildChatItems(fetchOf(RAW), []);
    const mail = items.find((i) => i.kind === 'mail');
    const tool = items.find((i) => i.kind === 'tool');
    expect(mail?.key).toBe('mail-toolu_01');
    expect(tool?.key).toBe('toolu_01');
    expect(mail?.key).not.toBe(tool?.key);
  });

  it('TWO fetches of the same delivery render TWO cards — the transcript is a record, not a set', () => {
    // The ruling, stated so it is a decision and not an accident: a card
    // answers "what was said to this session, and WHEN, relative to what it
    // did next". Two fetches are two things the session did. De-duplicating
    // would need cross-item state keyed on envelope id — the reconciliation
    // problem spec §2.2 refused a second frame over — and would break the
    // "derived from the event, mints nothing" property that lets the revival
    // discipline stay unchanged.
    const events: ChatEvent[] = [
      ...fetchOf(RAW),
      { kind: 'tool_use', uuid: 'u2', ts: TS, toolId: 'toolu_02', name: 'Bash', input: 'curl again' },
      { kind: 'tool_result', ts: TS, toolId: 'toolu_02', text: WRAPPED, isError: false },
    ];
    render(<ChatListInner id="s" events={events} pending={[]} />);
    expect(document.querySelectorAll('.mail-card')).toHaveLength(2);
    const keys = buildChatItems(events, []).filter((i) => i.kind === 'mail').map((i) => i.key);
    expect(keys).toEqual(['mail-toolu_01', 'mail-toolu_02']);
  });

  it('a legacy user turn and a fetch of the SAME mail both render — one per event, by construction', () => {
    // The same ruling seen from the other side. There is no precedence rule
    // between the two doors because there is no cross-event state to hold one
    // in; each event answers only for itself.
    const events: ChatEvent[] = [mailTurn('legacy-1'), ...fetchOf(RAW)];
    render(<ChatListInner id="s" events={events} pending={[]} />);
    expect(document.querySelectorAll('.mail-card')).toHaveLength(2);
  });

  it('mints nothing into the store on the live path either — a reconnect re-derives both cards', () => {
    const empty: SessionSnapshot = {
      events: [], offset: 0, uuid: null, status: null, statusUpdatedAt: null,
      dialog: null, ask: null, tasks: [], mail: [], missingFile: null,
      strandedAccount: null, searchComplete: true, file: null,
    };
    const backlog: SessionStreamMsg = {
      type: 'backlog', uuid: 'u1', events: fetchOf(RAW), offset: 40,
      file: '/t/u1.jsonl', missing: false,
    };
    const after = applySessionMsg(empty, backlog);
    expect(after.events.map((e) => e.kind)).toEqual(['tool_use', 'tool_result']);

    const first = buildChatItems(after.events, []);
    const second = buildChatItems(applySessionMsg(after, backlog).events, []);
    expect(first.filter((i) => i.kind === 'mail')).toHaveLength(1);
    expect(second.map((i) => i.key)).toEqual(first.map((i) => i.key));
  });
});
