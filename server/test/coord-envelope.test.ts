// `renderEnvelope`/`fenceFor` — fix-round finding 7 / D-43. Before this file,
// `grep -rn 'renderEnvelope' server/test/` had no hits: no test anywhere read
// `mail_deliveries.envelope`, so the entire module — every header line, the
// `run:`/`artifacts:` conditionals, the three-line ack instruction, and the
// fence-escape arithmetic that keeps a body's own code fence from closing the
// envelope early — was unverified output. `mail-routes.test.ts`'s happy-path
// test now asserts SOME of this at the route-integration level; this file
// pins the function directly, including the one case that route test cannot
// reach (a body that itself contains a fenced code block).
import { describe, it, expect } from 'vitest';
import { renderEnvelope, renderMailNudge, type EnvelopeInput } from '../src/coord/envelope.js';

const BASE: EnvelopeInput = {
  id: 7, fromId: 'demo-quiet-mesa', toId: 'demo-coordinator',
  runId: null, program: null, wave: null, waveOf: null,
  kind: 'finding', subject: 'a finding', body: 'the body', artifacts: [],
};

/** The envelope's own opening fence — the run of backticks up to the first
 *  newline, minus the `ccrc-mail` language tag. */
const openingFence = (envelope: string): string =>
  /^(`+)ccrc-mail\n/.exec(envelope)?.[1] ?? '';

describe('renderEnvelope: the header', () => {
  it('carries id/from/to/kind/subject, each on its own line', () => {
    const env = renderEnvelope(BASE);
    expect(env).toContain('id: 7');
    expect(env).toContain('from: demo-quiet-mesa');
    // `to: ${m.toId}`, never `m.fromId` — the mutant fix-round finding 7
    // names by name (swap `to:` for `fromId`).
    expect(env).toContain('to: demo-coordinator');
    expect(env).not.toContain('to: demo-quiet-mesa');
    expect(env).toContain('kind: finding');
    expect(env).toContain('subject: a finding');
  });

  it('omits the run: line entirely when runId is null', () => {
    const env = renderEnvelope(BASE);
    expect(env).not.toContain('run:');
  });

  it('renders run:/program/wave only when runId is given, with the wave/waveOf shape spec:120-123 names', () => {
    const withRun = renderEnvelope({ ...BASE, runId: 42, program: 'build4', wave: 2, waveOf: 5 });
    expect(withRun).toContain('run: 42 (program:build4 wave 2/5)');

    // runId given but program/wave unknown (a run row this build cannot
    // fully resolve) still names the run id, without inventing the rest.
    const bareRun = renderEnvelope({ ...BASE, runId: 42, program: null, wave: null, waveOf: null });
    expect(bareRun).toContain('run: 42');
    expect(bareRun).not.toContain('program:');
    expect(bareRun).not.toContain('wave');

    // A wave with no `waveOf` (a program whose total wave count is unknown)
    // renders the wave number alone, no dangling slash.
    const waveNoOf = renderEnvelope({ ...BASE, runId: 42, program: 'build4', wave: 2, waveOf: null });
    expect(waveNoOf).toContain('run: 42 (program:build4 wave 2)');
    expect(waveNoOf).not.toContain('wave 2/');
  });

  it('omits the artifacts: block when artifacts is empty, and renders one indented line PER ENTRY otherwise', () => {
    expect(renderEnvelope(BASE)).not.toContain('artifacts:');

    const withArtifacts = renderEnvelope({ ...BASE, artifacts: ['/a/one.png', '/b/two.log'] });
    expect(withArtifacts).toContain('artifacts:');
    expect(withArtifacts).toContain('  /a/one.png');
    expect(withArtifacts).toContain('  /b/two.log');
    // Each path is its OWN line — this is the line count the round-trip cost
    // (envelope.ts's own COST paragraph, and fix-round finding 8) scales with.
    const lines = withArtifacts.split('\n');
    expect(lines).toContain('  /a/one.png');
    expect(lines).toContain('  /b/two.log');
  });

  it('carries the four-line ack instruction, naming THIS id — deleting any one of the four lines is a live mutant otherwise', () => {
    const env = renderEnvelope({ ...BASE, id: 99 });
    expect(env).toContain('ack: POST /api/mail/99/ack with header x-ccrc-mail-token');
    expect(env).toContain('~/.cc-secrets/ccrc-mail.token');
    expect(env).toContain('"fromId":"<your ccd id>"');
    expect(env).toContain('"fromUuid":"<your uuid>"');
    // Review finding 2: this used to promise unconditional replay-until-ack —
    // false past `watch.ts`'s own `MAIL_REPLAY_MAX_ATTEMPTS` — so the wording
    // now names the bound instead of a promise the lane cannot keep.
    expect(env).toContain('Until you ack, this message is redelivered on later sweeps, up to a bounded number of');
    expect(env).toContain('attempts — after that the lane gives up and marks it undeliverable. Ack it promptly.');
    expect(env).not.toContain('this message will be delivered to you again');
  });

  it('carries the body verbatim, after the header', () => {
    const env = renderEnvelope({ ...BASE, body: 'line one\nline two' });
    expect(env).toContain('line one\nline two');
    // The body comes AFTER the header block (id/from/to/…/ack/--), never
    // before it — the receiving agent reads the envelope top to bottom.
    expect(env.indexOf('--\n')).toBeLessThan(env.indexOf('line one'));
  });
});

describe('renderEnvelope/fenceFor: the fence cannot be closed by the body\'s own content', () => {
  it('uses a plain 3-backtick fence when nothing inside the envelope has any backticks at all', () => {
    const env = renderEnvelope(BASE);
    expect(openingFence(env)).toBe('```');
  });

  it('grows the fence to one MORE than the longest run of backticks in the body — Markdown\'s own closing rule', () => {
    // A body that itself contains an ordinary ``` fenced code block — by far
    // the most likely body for a `kind: 'finding'` or `kind: 'artifact'`
    // message — must not be able to close the envelope's own fence early.
    const env = renderEnvelope({ ...BASE, kind: 'finding', body: 'see:\n```ts\ncode\n```\nmore text' });
    const fence = openingFence(env);
    expect(fence.length).toBeGreaterThan(3);
    expect(fence).toBe('````');   // longest run inside is 3 -> fence is 4

    // The SAME fence closes the envelope at the end, not the body's own run.
    expect(env.endsWith(`\n${fence}`)).toBe(true);
    // And the body's own fence line survives inside, untouched — a reader
    // parsing only on the OUTER (4-backtick) fence sees the whole message,
    // including the inner ``` lines, as one block.
    expect(env).toContain('```ts\ncode\n```');
  });

  it('keeps growing past a longer run — a 5-backtick run inside forces a 6-backtick outer fence', () => {
    const env = renderEnvelope({ ...BASE, body: 'weird: ````` (five backticks, nested markdown)' });
    const fence = openingFence(env);
    expect(fence.length).toBe(6);   // longest run inside is 5 -> 5 + 1
  });

  it('a run of backticks in the HEADER (subject/artifacts) is covered too — fenceFor runs over head+body together', () => {
    // `renderEnvelope` computes the fence from `${head}\n${m.body}`, not the
    // body alone — a mutant that fenced only the body would still be
    // escapable by a subject line carrying its own long backtick run.
    const env = renderEnvelope({ ...BASE, subject: 'contains ```` four ticks' });
    expect(openingFence(env).length).toBe(5);
  });
});

// `renderMailNudge` — the reference-nudge lane (robust-mail-delivery spec §1.1):
// the ONLY thing the delivery lane ever types now. Every invariant here is
// load-bearing for `sendPrompt`'s echo/submit discipline downstream — a
// regression in any one of them reopens the exact F7/F6b failure modes the
// nudge exists to close.
describe('renderMailNudge', () => {
  it('is a single line — no \\n anywhere — so composePrompt never splits it and the M-Enter loop is a no-op', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).not.toContain('\n');
  });

  it('starts with a CONSTANT 24-char head, identical across different toId values — the sendPrompt echo needle', () => {
    const a = renderMailNudge('demo-coordinator');
    const b = renderMailNudge('a-completely-different-session-id');
    const head = 'ccrc-mail: you have new ';
    expect(head.length).toBe(24);
    expect(a.slice(0, 24)).toBe(head);
    expect(b.slice(0, 24)).toBe(head);
    expect(a.slice(0, 24)).toBe(b.slice(0, 24));
  });

  it('embeds toId — the listing endpoint it points at, not one delivery', () => {
    const nudge = renderMailNudge('demo-quiet-mesa');
    expect(nudge).toContain('GET /api/mail?to=demo-quiet-mesa');
    // ID-AGNOSTIC by design: no per-delivery id anywhere in the nudge — it
    // points at the LISTING endpoint so one nudge drains all outstanding mail.
    expect(nudge).not.toMatch(/\bid: \d+/);
  });

  // Blocking review finding, re-opened D-41: the listing (`GET /api/mail?to=`)
  // returns rows carrying BOTH `id` (`mail.id`) and `deliveryId`
  // (`mail_deliveries.id`) — two independent sequences that only agree while
  // every mail resolves to exactly one delivery. Both `GET /api/mail/:id` and
  // `POST /api/mail/:id/ack` key on the DELIVERY id, so the nudge must send
  // the worker to `deliveryId`, never bare `id`, and say so explicitly.
  it('names the full read+ack protocol using deliveryId, NOT id — with the token location', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).toContain('GET /api/mail?to=demo-coordinator');
    expect(nudge).toContain('deliveryId');
    expect(nudge).toContain('NOT id');
    expect(nudge).toContain('GET /api/mail/<deliveryId>');
    expect(nudge).toContain('POST /api/mail/<deliveryId>/ack');
    expect(nudge).not.toContain('/api/mail/<id>');
    expect(nudge).not.toContain('/api/mail/<id>/ack');
    expect(nudge).toContain('~/.cc-secrets/ccrc-mail.token');
    expect(nudge).toContain('x-ccrc-mail-token');
  });

  it('is short — well under a kilobyte, the whole point of a "tiny" nudge', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge.length).toBeLessThan(300);
  });
});
