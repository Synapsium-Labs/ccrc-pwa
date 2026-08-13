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
  MAIL_ENVELOPE_FENCE, parseMailEnvelope,
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
