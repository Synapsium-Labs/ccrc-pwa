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
    // The instruction names the CLIENT, not a route and a header. The token
    // stopped being the reader's business — `ccrc-api` reads it — and a session
    // on a repo that denies `Bash(curl:*)` could not follow the old wording at
    // all. What the line must still do is name THIS delivery id, which is the
    // only way a recipient learns which id to ack, and say plainly that it is
    // the delivery id: the mail row's own id is a different sequence.
    expect(env).toContain('ack: ccrc-api mail ack 99 --json -');
    expect(env).toContain('99 is this DELIVERY id');
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

  it('embeds toId — the listing verb it points at, not one delivery', () => {
    const nudge = renderMailNudge('demo-quiet-mesa');
    expect(nudge).toContain('mail list --to demo-quiet-mesa');
    // ID-AGNOSTIC by design: no per-delivery id anywhere in the nudge — it
    // points at the LISTING verb so one nudge drains all outstanding mail.
    expect(nudge).not.toMatch(/\bid: \d+/);
  });

  // Blocking review finding, re-opened D-41: the listing (`GET /api/mail?to=`)
  // returns rows carrying BOTH `id` (`mail.id`) and `deliveryId`
  // (`mail_deliveries.id`) — two independent sequences that only agree while
  // every mail resolves to exactly one delivery. Both `GET /api/mail/:id` and
  // `POST /api/mail/:id/ack` key on the DELIVERY id, so the nudge must send
  // the worker to `deliveryId`, never bare `id`, and say so explicitly.
  it('names the full read+ack protocol using deliveryId, NOT id', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).toContain('mail list --to demo-coordinator');
    expect(nudge).toContain('deliveryId');
    expect(nudge).toContain('NOT id');
    expect(nudge).toContain('mail fetch <deliveryId>');
    expect(nudge).toContain('mail ack <deliveryId>');
    expect(nudge).not.toContain('mail fetch <id>');
    expect(nudge).not.toContain('mail ack <id>');
  });

  // THE THIRD LIVE WEDGE this line has caused, and the reason it names a client
  // rather than routes. A repo may legitimately deny `Bash(curl:*)`; one does.
  // Its worker got this nudge every ten minutes for hours and refused every one
  // — correctly, because raw HTTP was the only thing the nudge taught it. The
  // sibling `renderEnvelope` was converted in D-738 and THIS function, twelve
  // lines below it, was missed in the same change.
  it('teaches the client, never curl or a raw route — the nudge must work in a repo that denies curl', () => {
    const nudge = renderMailNudge('demo-coordinator');
    // curl may be NAMED (the line says it works where curl is denied) but never
    // USED: no invocation, and no bare HTTP method + path for a reader to copy.
    // An earlier draft of this test built its own matcher out of the nudge it
    // was checking, which made it a tautology that could not fail. Deleted.
    expect(nudge).not.toMatch(/\bcurl\s+-/);
    expect(nudge).not.toMatch(/\b(GET|POST|PUT|DELETE)\s+\/api\//);
    expect(nudge).toContain('~/.local/bin/ccrc-api');
  });

  // RELOCATED, not dropped. These two teachings used to live in this line
  // because the reader had to perform them. The client performs them now, so a
  // second copy here would be a second thing to rot — and the nudge must say
  // plainly that the reader is responsible for neither, or a stale reader will
  // go looking for the token anyway.
  it('hands the reader no token job at all, and says so', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).not.toContain('~/.cc-secrets/ccrc-mail.token');
    expect(nudge).not.toContain('x-ccrc-mail-token');
    expect(nudge).toMatch(/reads the box token itself/);
    expect(nudge).toMatch(/handle neither/);
  });

  it('invokes the client by explicit path — ~/.local/bin is not on the unit PATH', () => {
    // Measured 2026-08-26: the `claude-session@` units run with systemd's
    // default PATH, so a bare `ccrc-api` would teach a call that cannot run.
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).toContain('~/.local/bin/ccrc-api mail list');
    expect(nudge).toMatch(/not on this unit's PATH/);
  });

  // Live incident 2026-08-25 (a worker on one of the fleet's projects): this
  // nudge is the ONLY
  // protocol text guaranteed CURRENT in a recipient's pane — a skill loaded
  // into a session's context goes stale across deploys, and a peer-mail
  // recipient may have no skill loaded at all. The old line named the routes
  // and the token PATH but not the server ADDRESS (the worker guessed a wrong
  // host) nor the EXTRACTION rule (`cat` sends the token file's `#`-comment
  // preamble as the header value — not a legal header, so every call answers
  // a socket-level 400 before any route runs; `coord/token.ts`'s
  // `extractToken` is the documented shape). The next three tests pin the two
  // teachings that close those failure modes.
  it('carries no second copy of the address derivation — the client owns it', () => {
    // The live lesson that put the derivation here is unchanged: a worker once
    // GUESSED a host. What changed is who performs it. `ccrc-api` refuses
    // `no-server-url` rather than falling back (pinned in ccrc-api.test.ts), so
    // repeating the recipe here would be a second spelling to drift.
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).not.toContain('CCRC_SERVER_URL');
    expect(nudge).not.toContain('~/.ccrc/agent.env');
    expect(nudge).toMatch(/resolves the server address/);
  });

  // NEGATIVE: the address is DERIVED, never BAKED. A literal http(s)://host
  // in this line would go stale the day the server is re-exposed under a new
  // name (`ccrc expose` regenerates the exposure at will) — and unlike a
  // skill, nothing redeploys a stored envelope. No scheme://, ever.
  it('bakes no literal URL — no http(s):// or ws(s):// anywhere in the line', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge).not.toMatch(/https?:\/\//);
    expect(nudge).not.toMatch(/wss?:\/\//);
  });

  it('is short — still well under a kilobyte, the whole point of a "tiny" nudge', () => {
    const nudge = renderMailNudge('demo-coordinator');
    expect(nudge.length).toBeLessThan(600);
  });
});
