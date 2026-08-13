// `parseMailEnvelope` — Build 4 Task 15, spec §2.2's wire-additions table.
//
// The point of this file is a PROPERTY OF THE SYSTEM, not of two files
// agreeing: the grammar is minted server-side by `renderEnvelope`
// (`server/src/coord/envelope.ts`) and parsed back by `parseMailEnvelope`
// (`shared/api.ts`, L0), and every round-trip case below feeds the renderer's
// own output straight into the parser. A change to either side that the other
// does not follow turns this red, which is the only reason the PWA is allowed
// to render a mail card at all — "the PWA holds no rule the server does not
// also hold" (Global Constraints).
//
// The refusals are two, deliberately: `not-mail` (an ordinary message) and
// `malformed` (text that CLAIMS to be an envelope and is not). They render
// identically today — an ordinary bubble — and collapsing them into one
// member would be the overloaded null `architecture:99-100` bans. The last
// describe pins the union's totality directly, so a future "simplification"
// back to `MailEnvelope | null` cannot pass.
import { describe, it, expect } from 'vitest';
import { renderEnvelope, type EnvelopeInput } from '../src/coord/envelope.js';
import {
  MAIL_ENVELOPE_FENCE, parseFetchedMailEnvelope, parseMailEnvelope,
  type MailEnvelope, type MailEnvelopeParse,
} from '../../shared/api.js';

const BASE: EnvelopeInput = {
  id: 7, fromId: 'demo-quiet-mesa', toId: 'demo-coordinator',
  runId: null, program: null, wave: null, waveOf: null,
  kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
};

/** `EnvelopeInput` and `MailEnvelope` carry the same ten fields; the input's
 *  `artifacts` is `readonly`, so the expected value is spread into a mutable
 *  copy rather than compared by identity. */
const expectedFrom = (m: EnvelopeInput): MailEnvelope => ({
  id: m.id, fromId: m.fromId, toId: m.toId,
  runId: m.runId, program: m.program, wave: m.wave, waveOf: m.waveOf,
  kind: m.kind, subject: m.subject, artifacts: [...m.artifacts], body: m.body,
});

/** parse(render(x)) === x, asserted as ONE object comparison so a field the
 *  parser silently drops cannot hide behind a passing sibling assertion. */
const roundTrip = (m: EnvelopeInput): void => {
  const parsed = parseMailEnvelope(renderEnvelope(m));
  expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.envelope).toEqual(expectedFrom(m));
};

describe('parseMailEnvelope: parse(render(x)) === x', () => {
  it('round-trips every header field: parse(render(x)) === x, artifact-bearing', () => {
    roundTrip({
      ...BASE,
      id: 4242, fromId: 'coordinator', toId: 'ccrc-pwa-brisk-harbor',
      runId: 5, program: 'build4', wave: 4, waveOf: 4,
      kind: 'status', subject: 'wave-brief',
      artifacts: ['docs/superpowers/plans/2026-08-11-build4.md', '/tmp/out.log'],
      body: 'line one\nline two\nline three',
    });
  });

  it('round-trips the artifact-FREE shape', () => {
    // `renderEnvelope` omits the `artifacts:` marker line entirely when the
    // list is empty; the parser must answer `[]`, never `['']`.
    roundTrip({ ...BASE, artifacts: [] });
  });

  it('round-trips the run-less shape (runId null: no run: line at all)', () => {
    roundTrip({ ...BASE, runId: null, program: null, wave: null, waveOf: null });
  });

  it('round-trips a run with a program but no wave, and a wave with no waveOf', () => {
    roundTrip({ ...BASE, runId: 42, program: 'build4', wave: null, waveOf: null });
    roundTrip({ ...BASE, runId: 42, program: 'build4', wave: 2, waveOf: null });
    // A run id with no program at all — the row this build cannot fully
    // resolve. The parenthetical is absent and all three stay null.
    roundTrip({ ...BASE, runId: 42, program: null, wave: null, waveOf: null });
  });

  it("round-trips a body containing backticks, exercising fenceFor's longer fence", () => {
    roundTrip({ ...BASE, body: 'see:\n```ts\ncode\n```\nmore text' });
    roundTrip({ ...BASE, body: 'weird: ````` (five backticks, nested markdown)' });
    // A backtick run in the HEADER moves the fence too — the parser reads the
    // fence it was given rather than assuming three.
    roundTrip({ ...BASE, subject: 'contains ```` four ticks' });
  });

  it('round-trips an EMPTY body', () => {
    roundTrip({ ...BASE, body: '' });
  });

  it('round-trips a body whose own lines look like header lines', () => {
    // Everything after `--` is body, verbatim. A body that opens with
    // `id: 1` must not be re-parsed as a second header.
    roundTrip({ ...BASE, body: 'id: 1\nfrom: someone\n--\nnot a header' });
  });

  it('round-trips a multi-line body with a trailing blank line', () => {
    roundTrip({ ...BASE, body: 'a\n' });
  });

  it('round-trips every MailKind the renderer can emit', () => {
    for (const kind of ['finding', 'question', 'answer', 'status', 'artifact', 'unknown'] as const) {
      roundTrip({ ...BASE, kind });
    }
  });
});

describe('parseMailEnvelope: not-mail — this text is an ordinary message', () => {
  const notMail = (text: string): void => {
    const parsed = parseMailEnvelope(text);
    expect(parsed.ok, text.slice(0, 40)).toBe(false);
    if (parsed.ok) return;
    expect(parsed.why).toBe('not-mail');
  };

  it('answers not-mail for an ordinary message', () => {
    notMail('please rebase onto main and re-run the suite');
    notMail('');
    notMail('   \n  \n');
  });

  it('answers not-mail for a fenced block with a DIFFERENT info string', () => {
    notMail('```ts\nconst x = 1;\n```');
    notMail('```\nplain fenced text\n```');
    // A near-miss on the info string is still someone else's fence.
    notMail('```ccrc-mailbox\nid: 1\n```');
  });

  it('answers not-mail when the fence is not the whole text (prose above or below)', () => {
    const env = renderEnvelope(BASE);
    notMail(`here is the mail I got:\n${env}`);
    notMail(`${env}\nand that is what it said`);
    notMail(`before\n${env}\nafter`);
  });

  it('tolerates surrounding whitespace only — a turn is trimmed before it is judged', () => {
    const env = renderEnvelope(BASE);
    const parsed = parseMailEnvelope(`\n\n  ${env}\n  \n`);
    expect(parsed.ok).toBe(true);
  });

  it('answers not-mail when the closing fence is shorter than the opener', () => {
    // Markdown's own rule: a block closes only on a fence at least as long.
    notMail(`\`\`\`\`${MAIL_ENVELOPE_FENCE}\nid: 1\n\`\`\``);
  });
});

describe('parseMailEnvelope: malformed — this text CLAIMS to be an envelope and is not', () => {
  /** Build an envelope-shaped text from explicit header lines, so a test can
   *  delete or corrupt exactly one of them. Line 0 is the opening fence, which
   *  is the index base `at` counts from. */
  const envelopeOf = (headerLines: string[], body = 'the body'): string =>
    ['```' + MAIL_ENVELOPE_FENCE, ...headerLines, '--', body, '```'].join('\n');

  const ACK = [
    'ack: POST /api/mail/7/ack with header x-ccrc-mail-token (the value in',
    '  ~/.cc-secrets/ccrc-mail.token) and body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.',
    '  Until you ack, this message is redelivered on later sweeps, up to a bounded number of',
    '  attempts — after that the lane gives up and marks it undeliverable. Ack it promptly.',
  ];
  const FULL = ['id: 7', 'from: a', 'to: b', 'kind: finding', 'subject: s', ...ACK];

  const malformedAt = (text: string, at: number): void => {
    const parsed = parseMailEnvelope(text);
    expect(parsed.ok, text.slice(0, 60)).toBe(false);
    if (parsed.ok) return;
    expect(parsed.why).toBe('malformed');
    if (parsed.why !== 'malformed') return;
    expect(parsed.at).toBe(at);
  };

  it('the control: the hand-built full header parses, so every case below differs by ONE line', () => {
    const parsed = parseMailEnvelope(envelopeOf(FULL));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  });

  it('answers malformed, with `at`, for a missing id: line', () => {
    malformedAt(envelopeOf(FULL.slice(1)), 1);
  });

  it('answers malformed, with `at`, for a missing from: line', () => {
    malformedAt(envelopeOf(['id: 7', 'to: b', 'kind: finding', 'subject: s', ...ACK]), 2);
  });

  it('answers malformed, with `at`, for a missing to: line', () => {
    malformedAt(envelopeOf(['id: 7', 'from: a', 'kind: finding', 'subject: s', ...ACK]), 3);
  });

  it('answers malformed, with `at`, for a missing kind: line', () => {
    malformedAt(envelopeOf(['id: 7', 'from: a', 'to: b', 'subject: s', ...ACK]), 4);
  });

  it('answers malformed, with `at`, for a missing subject: line', () => {
    malformedAt(envelopeOf(['id: 7', 'from: a', 'to: b', 'kind: finding', ...ACK]), 5);
  });

  it('answers malformed for a non-numeric id and for an unknown kind', () => {
    malformedAt(envelopeOf(['id: seven', ...FULL.slice(1)]), 1);
    malformedAt(envelopeOf(['id: 7', 'from: a', 'to: b', 'kind: gossip', 'subject: s', ...ACK]), 4);
    // `unknown` IS a MailKind (the read-side degradation member) and parses.
    const ok = parseMailEnvelope(envelopeOf(['id: 7', 'from: a', 'to: b', 'kind: unknown', 'subject: s', ...ACK]));
    expect(ok.ok).toBe(true);
  });

  it('answers malformed for a run: line that is not the shape the renderer emits', () => {
    malformedAt(envelopeOf(['id: 7', 'from: a', 'to: b', 'run: later', 'kind: finding', 'subject: s', ...ACK]), 4);
  });

  it('answers malformed for an artifacts: marker with no indented paths under it', () => {
    malformedAt(
      envelopeOf(['id: 7', 'from: a', 'to: b', 'kind: finding', 'subject: s', 'artifacts:', ...ACK]),
      6,
    );
  });

  it('answers malformed when the ack block or the -- terminator is missing', () => {
    // No `--` at all: the header runs into the closing fence.
    const noTerminator = ['```' + MAIL_ENVELOPE_FENCE, ...FULL, 'the body', '```'].join('\n');
    const parsed = parseMailEnvelope(noTerminator);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.why).toBe('malformed');

    // Header stops after `subject:` — the `ack:` line the renderer always
    // emits is gone.
    malformedAt(envelopeOf(['id: 7', 'from: a', 'to: b', 'kind: finding', 'subject: s']), 6);
  });

  it('answers malformed for an empty from: or to: value', () => {
    malformedAt(envelopeOf(['id: 7', 'from: ', 'to: b', 'kind: finding', 'subject: s', ...ACK]), 2);
    malformedAt(envelopeOf(['id: 7', 'from: a', 'to: ', 'kind: finding', 'subject: s', ...ACK]), 3);
  });

  it('an EMPTY subject is legal — a subject line with nothing after it is not malformed', () => {
    const parsed = parseMailEnvelope(envelopeOf(['id: 7', 'from: a', 'to: b', 'kind: finding', 'subject: ', ...ACK]));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.subject).toBe('');
  });
});

describe('parseMailEnvelope: the union is total, and never a bare null', () => {
  it('never returns a bare null, and never a half-populated envelope', () => {
    const texts = [
      renderEnvelope(BASE),
      'an ordinary message',
      '```ts\ncode\n```',
      '```' + MAIL_ENVELOPE_FENCE + '\nnonsense\n```',
      '',
    ];
    for (const t of texts) {
      const parsed: MailEnvelopeParse = parseMailEnvelope(t);
      // Not null, not undefined — the seam this build refuses to overload.
      expect(parsed, t.slice(0, 30)).not.toBeNull();
      expect(parsed, t.slice(0, 30)).not.toBeUndefined();
      expect(typeof parsed.ok).toBe('boolean');
      if (parsed.ok) {
        // Every field present — a half-populated envelope is the failure a
        // caller cannot see coming.
        for (const k of ['id', 'fromId', 'toId', 'runId', 'program', 'wave',
          'waveOf', 'kind', 'subject', 'artifacts', 'body'] as const) {
          expect(Object.hasOwn(parsed.envelope, k), k).toBe(true);
        }
      } else {
        // A refusal carries NO envelope at all — not an empty one.
        expect(Object.hasOwn(parsed, 'envelope')).toBe(false);
        expect(parsed.why === 'not-mail' || parsed.why === 'malformed').toBe(true);
      }
    }
  });

  it("keeps 'not-mail' and 'malformed' as two members a caller could branch on", () => {
    // The distinction the renderer does not yet need. If a later change
    // collapses them, this is what goes red — the seam, not the rendering.
    const ordinary = parseMailEnvelope('just a message');
    const claimed = parseMailEnvelope('```' + MAIL_ENVELOPE_FENCE + '\nnot a header\n```');
    expect(ordinary.ok).toBe(false);
    expect(claimed.ok).toBe(false);
    if (ordinary.ok || claimed.ok) return;
    expect(ordinary.why).not.toBe(claimed.why);
    expect(ordinary.why).toBe('not-mail');
    expect(claimed.why).toBe('malformed');
  });

  it('the fence constant is what the renderer emits — one definition, imported', () => {
    // Not "the strings match" but "the renderer's output opens with THE
    // constant": a second copy in `envelope.ts` would pass a string-equality
    // test and fail this one only if it drifted, so this pairs with
    // `single-definition.test.ts`'s literal scan rather than replacing it.
    expect(renderEnvelope(BASE).startsWith('```' + MAIL_ENVELOPE_FENCE + '\n')).toBe(true);
  });
});

// — `parseFetchedMailEnvelope` (W-1, the live lane) —
//
// THE SPEC'S MEASURED FACT EXPIRED MID-PROGRAM. Spec §2.1 fact 2 was measured
// on 2026-08-11 against a lane that typed the whole envelope into the
// recipient's pane, so it landed in the JSONL as a `user` turn. Commit
// 43b2737 — shipped 2026-08-12, EARLIER IN THIS SAME PROGRAM, and an ancestor
// of wave 4's base — replaced that with the one-line reference nudge
// (`renderMailNudge`). `watch.ts` says so in its own words: "the lane no
// longer types the whole stored envelope into the pane."
//
// So today an envelope reaches a transcript only as the OUTPUT of the
// worker's own `GET /api/mail/:id`, which the transcript parser maps to
// `tool_result`. Two shapes occur in real transcripts and both must work:
// the raw fence (a fetch that piped through and printed `envelope`) and the
// JSON response the route actually sends (a bare curl).
//
// The strict `parseMailEnvelope` above is UNCHANGED and stays the legacy
// user-turn path's parser. This is a separate, wider door, and the width is
// stated rather than assumed.
describe('parseFetchedMailEnvelope: the envelope as a fetch returns it', () => {
  const FETCHED: EnvelopeInput = {
    ...BASE, id: 17, fromId: 'coordinator', toId: 'ccrc-pwa-brisk-harbor',
    runId: 5, program: 'build4', wave: 4, waveOf: 4,
    kind: 'status', subject: 'wave-brief', body: 'Implement Tasks 15-19.',
  };

  it('takes the RAW FENCE shape — a fetch that printed the envelope field', () => {
    const parsed = parseFetchedMailEnvelope(renderEnvelope(FETCHED));
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope).toEqual(expectedFrom(FETCHED));
  });

  it('takes the JSON-WRAPPED shape — the response `GET /api/mail/:id` actually sends', () => {
    // The exact literal `coord/routes.ts` sends: {ok, id, toId, state, envelope}.
    const body = JSON.stringify({
      ok: true, id: 17, toId: 'ccrc-pwa-brisk-harbor', state: 'delivered',
      envelope: renderEnvelope(FETCHED),
    });
    const parsed = parseFetchedMailEnvelope(body);
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope).toEqual(expectedFrom(FETCHED));
  });

  it('tolerates the response being pretty-printed, as a piped fetch leaves it', () => {
    const body = JSON.stringify({ ok: true, envelope: renderEnvelope(FETCHED) }, null, 2);
    expect(parseFetchedMailEnvelope(body).ok).toBe(true);
  });

  it('answers not-mail for ordinary command output — including output that MENTIONS the fence', () => {
    // Measured on this worker's own transcript: twelve tool_results carried
    // the characters `ccrc-mail` (greps, file reads, the README) and not one
    // of them is an envelope. The whole-turn rule is what refuses them, and
    // widening the door to tool_results does not widen that rule.
    for (const t of [
      'total 42\ndrwx------ 2 you you',
      "server/src/coord/token.ts:20: * `deploy/ccrc-mail.token.example` ships as a comment block",
      '84:  return `${fence}${MAIL_ENVELOPE_FENCE}\\n${head}\\n${m.body}\\n${fence}`;',
      'ack: POST /api/mail/17/ack with header x-ccrc-mail-token (the value in',
      `here is the mail:\n${renderEnvelope(FETCHED)}`,
      '{"ok":false,"error":"not-found"}',
      '{"error":"Bad Request","message":"Client Error","statusCode":400}',
    ]) {
      const parsed = parseFetchedMailEnvelope(t);
      expect(parsed.ok, t.slice(0, 40)).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.why, t.slice(0, 40)).toBe('not-mail');
    }
  });

  it('answers not-mail for JSON whose envelope field is missing or not a string', () => {
    for (const body of [
      JSON.stringify({ ok: true, id: 17 }),
      JSON.stringify({ ok: true, envelope: 42 }),
      JSON.stringify({ ok: true, envelope: null }),
      JSON.stringify([renderEnvelope(FETCHED)]),
      '{"ok":true,"envelope":"unterminated',
    ]) {
      const parsed = parseFetchedMailEnvelope(body);
      expect(parsed.ok, body.slice(0, 40)).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.why, body.slice(0, 40)).toBe('not-mail');
    }
  });

  it('keeps `malformed` distinct through BOTH doors — the seam is not lost on the way in', () => {
    const broken = '```' + MAIL_ENVELOPE_FENCE + '\nid: not-a-number\nfrom: a\n--\nb\n```';
    const direct = parseFetchedMailEnvelope(broken);
    expect(direct.ok).toBe(false);
    if (direct.ok) return;
    expect(direct.why).toBe('malformed');

    const wrapped = parseFetchedMailEnvelope(JSON.stringify({ ok: true, envelope: broken }));
    expect(wrapped.ok).toBe(false);
    if (wrapped.ok) return;
    expect(wrapped.why).toBe('malformed');
  });

  it('does not widen the STRICT parser — parseMailEnvelope still refuses the JSON shape', () => {
    // The legacy user-turn path must not start accepting a JSON response. A
    // user turn is an envelope that was typed into the box; it is never a
    // fetch's output, and keeping the two doors separate is what stops this
    // fix from quietly widening the older one.
    const body = JSON.stringify({ ok: true, envelope: renderEnvelope(FETCHED) });
    const parsed = parseMailEnvelope(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.why).toBe('not-mail');
  });
});
