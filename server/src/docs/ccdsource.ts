// The native Docs reader's L3 ccd adapter (design 2026-10-01: section 1's ccdsource row, section 2 (a) The gate,
// section 2 (b) Server classification). It implements the two consumer-declared ports of `ports.ts` over the one ccd
// capability the server already holds, `CcdRunner` (`lifecycle.ts`). It answers words; `policy.ts` (L1) decides what
// each word means over HTTP, and W3's routes apply that verdict.
//
// Ring, checked by imports (M7.10): it may import `../ccdargv.js`, `../lifecycle.js`, `../exec.js`,
// `../fleetstate.js` (type), `node:crypto`, `./policy.js`, `./ports.js` (type) and `../../../shared/docs.js`. No
// fastify, no reply, no timer.
//
// The rules it keeps:
// - THE GATE comes first, inside each of the two functions that build a docs argv (`readDocs`, `fetchDocs`), and both
//   of its answers are decided before any exec. `verb-gate.test.ts` reads the nearest enclosing function of every
//   `CCD_ARGV.docs*(` call for a literal `capSupported(`, which is why one shared gate helper would read as ungated
//   (refinement (c)), and why each function head stays on one line with a named return type.
// - IT NEVER NARROWS a distinction it received. The checks run in section 2 (b)'s order and the first match wins.
//   ccd's words and every context key ride through verbatim: absent stays absent and `null` stays `null` (D-4157's
//   `unwalked`, D-4158's `lockAgeMs`, contract F4's `branch`). A word outside ccd's set is `unknown-failure {word}`,
//   never mapped onto a known word.
// - `killed` and `signal` are read through `ccdEnding` (`lifecycle.ts`) alone: one reader for the two halves.
// - A server-made string carrying ccd's untrusted text (`cause`, `stderrHead`, check 7's `word`) is redacted BEFORE it
//   is cut to 512 bytes, so a cut cannot split a secret past the redactor and no such string rides in unbounded.
// - A show answer is held to the bytes it encodes and to the pin it was asked for (check 8), and every answer that
//   reaches check 9 is held to its job's declared wire bound.
// - ONE EXIT: every failure body leaves through `settle`, which runs the redactor a second time over each of its string
//   leaves but `failure`, at any depth (refinement (k)). An ok answer is never rewritten.
// Inherited from W1's ledger, carried and not fixed here: MT-2 (ccd cuts its own stderr before it redacts, so nothing
// here can recover a secret that cut split) and SEC-3 (an externally killed helper orphans git's process group; this
// wave's lever is the runner budget invariant that `docs-budget.test.ts` holds, so the agent never kills ccd first).
import { createHash } from 'node:crypto';
import { CCD_ARGV, DOCS_CAP, capSupported } from '../ccdargv.js';
import { ccdEnding, type CcdResult, type CcdRunner } from '../lifecycle.js';
import type { FleetState } from '../fleetstate.js';
import {
  DOCS_CCD_FAILURES, docsRefText, redactDocsText,
  type DocPin, type DocsFailure, type DocsFailureBody, type DocsFetchOk, type DocsIndexOk, type DocsRefSpec,
  type DocsShowOk, type DocsTreeOk, type DocsVerb,
} from '../../../shared/docs.js';
import { LISTING_JOB, type DocsJob } from './policy.js';
import type { DocsFetchRun, DocsFetcher, DocsReader, DocsShowAsk, DocsShowRead } from './ports.js';

/** What both adapters are built from. `fleetState` is the server's live fleet state, read at each call (the server
 *  refreshes `ccdVerbs` from `ccd caps`); `undefined` means only "this server holds no fleet state object", which
 *  the gate answers exactly as it answers a `null` list: `caps-unknown`. */
export interface CcdDocsDeps { runCcd: CcdRunner; fleetState: Pick<FleetState, 'ccdVerbs'> | undefined }

/** The agent's refusal of an argv its exec whitelist does not grant (`agent/src/server.ts`'s `fail(req.id, ...)` on
 *  the `isExecAllowed(` line), relayed by the client as the rejection's message and by the runner's catch as stderr.
 *  Module-private, never shared across packages (R14): `docs-source.test.ts` extracts the agent's literal from source
 *  and drives this adapter with it, so a renamed word on either side reds that test. */
const AGENT_EXEC_REFUSAL = 'forbidden';

/** The client's own wait expiring (`server/src/remote/client.ts`'s timer: `reject(new Error(...))`). Module-private
 *  for `AGENT_EXEC_REFUSAL`'s reason, and extracted from source by the same test. */
const LINK_WAIT_EXPIRED = 'timeout';

/** The most bytes of redacted untrusted text a server-made body carries (`ccd-fault`'s `stderrHead`, `link-failed`'s
 *  `cause`, `unknown-failure`'s `word`), cut at a UTF-8 boundary. */
const STDERR_HEAD_BYTES = 512;

/** ccd's words, as a set for a membership test on an untrusted string (check 7). Derived from L0, never listed. */
const CCD_WORDS: ReadonlySet<string> = new Set(DOCS_CCD_FAILURES);

/** The three envelope keys a ccd failure line carries and a failure body does not (refinement (j)). */
const ENVELOPE_ONLY_KEYS: ReadonlySet<string> = new Set(['v', 'verb', 'elapsedMs']);

/** The three words a committed show answer's `onRef` may carry (section 3.5), keyed by the L0 type, so a word added
 *  there is a compile error here until it is listed. An answer without one, or with any other, is `{why:'schema'}`. */
const ON_REF_WORDS: Readonly<Record<NonNullable<DocsShowOk['onRef']>, true>> =
  { contains: true, 'not-contained': true, unmeasured: true };

/** A read call, one arm per argv shape `readDocs` builds. `ref: null` is the default view (no `--ref`). */
type DocsReadCall =
  | { verb: 'docs-index' }
  | { verb: 'docs-tree'; project: string; ref: DocsRefSpec | null }
  | { verb: 'docs-show'; project: string; pin: DocPin; ask: DocsShowAsk };

/** What a gated executor hands back: the run's raw result, or the gate's own failure body. */
type DocsRan = { ok: true; res: CcdResult } | DocsFailureBody;

/** A line that passed checks 6 and 7, as parsed: ccd's ok line (its shape is the verb's ok type; only the envelope
 *  was checked) or ccd's failure line carrying a word of ccd's set, told apart by the line's own `ok`. Or the
 *  failure body an earlier check made. */
type DocsLine = { ok: true; line: Readonly<Record<string, unknown>> } | DocsFailureBody;

/** What one port operation checks of ccd's ok line beyond the envelope, and what it answers: check 8 and the decoded
 *  bytes for a show (`checkShow`), the line as the verb's ok type for the others. */
type DocsAccept<T extends { ok: true }> = (line: Readonly<Record<string, unknown>>) => T | DocsFailureBody;

/** A failure body the adapter makes itself, with that word's context. */
function fail(failure: DocsFailure, context: Omit<DocsFailureBody, 'ok' | 'failure'> = {}): DocsFailureBody {
  return { ok: false, failure, ...context };
}

/** The first `maxBytes` bytes of `s`'s UTF-8, cut back to the start of the character the cut would split. */
function utf8Head(s: string, maxBytes: number): string {
  const bytes = Buffer.from(s, 'utf8');
  if (bytes.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/** ccd's untrusted text as a server-made body carries it: redacted first, then cut (`STDERR_HEAD_BYTES`). */
function stderrHeadOf(s: string): string {
  return utf8Head(redactDocsText(s), STDERR_HEAD_BYTES);
}

/**
 * The gated read executor: the gate, then ONE `switch` that builds and runs each read argv (refinement (c)). The two
 * gate lines are section 2 (a)'s, literally, and both answers are decided before any exec:
 * - no list, or a list without the token `caps`, measured nothing (an agent whose boot read of `ccd caps` failed
 *   seeds `[]`): `caps-unknown` (C1);
 * - a measured list without `docs-v1`: `unsupported`. `capSupported`, never `verbSupported`: a box can echo the four
 *   verb names without the token, and `verbSupported` would permit it.
 */
async function readDocs(deps: CcdDocsDeps, call: DocsReadCall): Promise<DocsRan> {
  const verbs = deps.fleetState?.ccdVerbs ?? null;
  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');
  if (!capSupported(deps.fleetState, DOCS_CAP)) return fail('unsupported');
  switch (call.verb) {
    case 'docs-index':
      return { ok: true, res: await deps.runCcd(CCD_ARGV.docsIndex()) };
    case 'docs-tree':
      return {
        ok: true,
        res: await deps.runCcd(CCD_ARGV.docsTree(call.project, call.ref === null ? null : docsRefText(call.ref))),
      };
    case 'docs-show':
      return {
        ok: true,
        res: await deps.runCcd(call.pin.kind === 'committed'
          ? CCD_ARGV.docsShowCommitted(call.project, call.pin.commit, call.pin.servedRef, call.pin.section, call.pin.path,
            call.ask.maxBytes)
          : CCD_ARGV.docsShowDraft(call.project, call.pin.branch, call.pin.head, call.pin.section, call.pin.path,
            call.pin.fp, call.ask.maxBytes)),
      };
  }
}

/** The gated fetch executor: the same two gate lines, then the ONE `CCD_ARGV.docsFetch(` in `server/src`. */
async function fetchDocs(deps: CcdDocsDeps, project: string, branch: string | null): Promise<DocsRan> {
  const verbs = deps.fleetState?.ccdVerbs ?? null;
  if (verbs === null || !verbs.includes('caps')) return fail('caps-unknown');
  if (!capSupported(deps.fleetState, DOCS_CAP)) return fail('unsupported');
  return { ok: true, res: await deps.runCcd(CCD_ARGV.docsFetch(project, branch)) };
}

/**
 * Checks 1-7 of section 2 (b), in order; the first match wins.
 * 1. Both halves unmeasured, not ok, empty stdout: the runner's transport catch (`{code:1, stdout:'', stderr:msg}`).
 *    The agent's refusal is `not-granted`, the client's own wait `link-timeout`, anything else `link-failed {cause}`.
 *    An ok answer whose halves are unmeasured (an agent older than both fields) is NOT this: it goes on to parsing.
 * 2. The runner's deadline fired: `ccd-timeout`.
 * 3. A measured signal ended ccd: `ccd-killed {signal}`.
 * 4. Not ok with stdout: a cut answer (maxBuffer), which the exit contract makes detectable: `answer-overflow`.
 * 5. Not ok, empty stdout: `ccd-fault {stderrHead}` (a `die`, an old ccd's usage line, ENOENT). No `code`: the
 *    `CcdResult` carries none, and absent means unmeasured (refinement (f)).
 * 6-7. `parseLine`.
 * 8. An ok line goes through `accept` (for a show, `checkShow`); a failure there wins over check 9.
 * 9. Every answer that reached here, an ok line that passed check 8 or a ccd failure line, is held to `job.wire`
 *    (`checkBound`). A body that checks 1-7 made never reaches it: the first match wins.
 */
function classify<T extends { ok: true }>(verb: DocsVerb, res: CcdResult, job: DocsJob, accept: DocsAccept<T>):
  T | DocsFailureBody {
  const ending = ccdEnding(res);
  if (ending.kind === 'unmeasured' && !res.ok && res.stdout === '') {
    if (res.stderr === AGENT_EXEC_REFUSAL) return fail('not-granted');
    if (res.stderr === LINK_WAIT_EXPIRED) return fail('link-timeout');
    return fail('link-failed', { cause: stderrHeadOf(res.stderr) });
  }
  if (ending.kind === 'deadline') return fail('ccd-timeout');
  if (ending.kind === 'signal') return fail('ccd-killed', { signal: ending.signal });
  if (!res.ok && res.stdout !== '') return fail('answer-overflow');
  if (!res.ok) return fail('ccd-fault', { stderrHead: stderrHeadOf(res.stderr) });
  const read = parseLine(verb, res.stdout);
  if (!read.ok) return read;
  if (read.line.ok !== true) return checkBound(ccdFailureBody(read.line), res.stdout, job);
  const accepted = accept(read.line);
  return accepted.ok ? checkBound(accepted, res.stdout, job) : accepted;
}

/** Check 9 (section 6.2): a stdout over the job's declared wire bound is `malformed-answer {why:'oversize'}`, logged
 *  once. The framed bound is ccd's own contract, pinned by ccd's tests; this is the server's backstop for a ccd that
 *  broke it. `>`, never `>=`: an answer of exactly `job.wire` bytes is within its bound. */
function checkBound<A>(answer: A, stdout: string, job: DocsJob): A | DocsFailureBody {
  if (Buffer.byteLength(stdout) > job.wire) {
    console.warn('ccrc-server: docs answer over its declared bound');
    return fail('malformed-answer', { why: 'oversize' });
  }
  return answer;
}

/**
 * Checks 6 and 7.
 * 6. stdout is exactly one JSON text and exactly one `\n`, its last character (an empty stdout reaches `JSON.parse`
 *    as `''` and fails there): otherwise `malformed-answer {why:'parse'}`. The text is an object, `v` is 1, `verb` is
 *    the verb asked, `ok` is a boolean, and a failure line's `failure` is a string: otherwise `{why:'schema'}`.
 * 7. A word outside ccd's set (a server-only word included) is `unknown-failure {word}`, the word via `stderrHeadOf`;
 *    a line carrying a ccd word is handed back as parsed, for check 9 and then `ccdFailureBody` (`classify`).
 */
function parseLine(verb: DocsVerb, stdout: string): DocsLine {
  if (stdout.indexOf('\n') !== stdout.length - 1) return fail('malformed-answer', { why: 'parse' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(0, -1));
  } catch {
    return fail('malformed-answer', { why: 'parse' });
  }
  if (typeof parsed !== 'object' || parsed === null) return fail('malformed-answer', { why: 'schema' });
  const line = parsed as Readonly<Record<string, unknown>>;
  if (line.v !== 1 || line.verb !== verb || typeof line.ok !== 'boolean') return fail('malformed-answer', { why: 'schema' });
  if (line.ok) return { ok: true, line };
  if (typeof line.failure !== 'string') return fail('malformed-answer', { why: 'schema' });
  if (!CCD_WORDS.has(line.failure)) return fail('unknown-failure', { word: stderrHeadOf(line.failure) });
  return { ok: true, line };
}

/** A ccd failure line as a failure body (refinement (j)): exactly `v`, `verb` and `elapsedMs` dropped, every other key
 *  carried as ccd wrote it. No hand-kept list of context keys, so no context key can be dropped or defaulted.
 *  `Object.fromEntries` defines each key as an own property, so a `__proto__` key in the line stays a plain key. */
function ccdFailureBody(line: Readonly<Record<string, unknown>>): DocsFailureBody {
  const carried = Object.fromEntries(Object.entries(line).filter(([key]) => !ENVELOPE_ONLY_KEYS.has(key)));
  return { ...carried, ok: false } as unknown as DocsFailureBody;
}

/** The content bytes a show answer encodes, decoded once: `text` as UTF-8, or `b64` as base64. An answer whose
 *  encoding names no field it carries is `malformed-answer {why:'schema'}`. */
function decodeShowBytes(ans: DocsShowOk): { ok: true; bytes: Uint8Array } | DocsFailureBody {
  if (ans.encoding === 'utf8' && typeof ans.text === 'string') return { ok: true, bytes: Buffer.from(ans.text, 'utf8') };
  if (ans.encoding === 'base64' && typeof ans.b64 === 'string') return { ok: true, bytes: Buffer.from(ans.b64, 'base64') };
  return fail('malformed-answer', { why: 'schema' });
}

/** Check 8's word: `malformed-answer` with the named `why`. */
function showFault(why: 'integrity' | 'pin' | 'schema'): DocsFailureBody {
  return fail('malformed-answer', { why });
}

/**
 * Check 8 (show only), over an ok answer that passed checks 1-7, in this order; the first match wins.
 * - The bytes, decoded once (`decodeShowBytes`): an encoding naming no field it carries is `{why:'schema'}`.
 * - Integrity, `{why:'integrity'}`: a base64 answer is canonical (its bytes re-encode to exactly `b64`, so no missing
 *   padding, stray character or stray bits ride along), the bytes are `size` long, and their sha256 is `sha256`.
 * - Pins, `{why:'pin'}`: `source` is the request's mode, and the answer echoes `section` and `path`; for a draft pin
 *   `branch`, `head` and `fp`, with `fp` equal to `sha256`; for a committed pin `commit`, and `blob` equal to the
 *   listing's when the server holds one (`ask.listedBlob`, whose `null` means only that it holds none).
 * - A committed answer's `onRef` is one of `ON_REF_WORDS`: absent or any other value is `{why:'schema'}`.
 */
function checkShow(ans: DocsShowOk, pin: DocPin, ask: DocsShowAsk): { ok: true; bytes: Uint8Array } | DocsFailureBody {
  const decoded = decodeShowBytes(ans);
  if (!decoded.ok) return decoded;
  const bytes = decoded.bytes;
  if (ans.encoding === 'base64' && Buffer.from(bytes).toString('base64') !== ans.b64) return showFault('integrity');
  if (bytes.length !== ans.size) return showFault('integrity');
  if (createHash('sha256').update(bytes).digest('hex') !== ans.sha256) return showFault('integrity');
  if (ans.source !== pin.kind || ans.section !== pin.section || ans.path !== pin.path) return showFault('pin');
  if (pin.kind === 'draft') {
    if (ans.branch !== pin.branch || ans.head !== pin.head || ans.fp !== pin.fp) return showFault('pin');
    return ans.fp === ans.sha256 ? { ok: true, bytes } : showFault('pin');
  }
  if (ans.commit !== pin.commit) return showFault('pin');
  if (ask.listedBlob !== null && ans.blob !== ask.listedBlob) return showFault('pin');
  if (!Object.hasOwn(ON_REF_WORDS, ans.onRef ?? '')) return showFault('schema');
  return { ok: true, bytes };
}

/** `v` with every string leaf passed through the redactor: arrays and plain objects are rebuilt (`Object.fromEntries`
 *  defines each key as an own property), numbers, booleans and `null` are kept as they are. */
function redactLeaves(v: unknown): unknown {
  if (typeof v === 'string') return redactDocsText(v);
  if (Array.isArray(v)) return v.map(redactLeaves);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactLeaves(x)]));
  return v;
}

/**
 * The second redaction pass (section 2 (b) "One redactor", refinement (k)): a new body whose every string leaf but
 * `failure` has been through `redactDocsText`, at any depth (`candidates`, `tried`), server-made bodies included. ccd
 * ran the same rules over what it derived from stderr; this pass covers whatever it missed or did not derive from
 * stderr, and changes nothing already redacted (the redactor is idempotent). Absent stays absent, `null` stays `null`.
 */
function redactBody(body: DocsFailureBody): DocsFailureBody {
  const out = Object.fromEntries(Object.entries(body).map(([key, v]) => [key, key === 'failure' ? v : redactLeaves(v)]));
  return out as unknown as DocsFailureBody;
}

/**
 * THE ONE EXIT of every port operation: the gate's body, or checks 1-9 over the run (`classify`), with any failure
 * body, whatever made it, through `redactBody`. An ok answer is returned exactly as checked, never rewritten.
 */
function settle<T extends { ok: true }>(ran: DocsRan, verb: DocsVerb, job: DocsJob, accept: DocsAccept<T>):
  T | DocsFailureBody {
  const out = ran.ok ? classify(verb, ran.res, job, accept) : ran;
  return out.ok ? out : redactBody(out);
}

/** The read port over ccd. Bound to the node whose `CcdRunner` it holds; `index`'s `at` names that node. A listing
 *  answer is held to `LISTING_JOB`, a show answer to its own `ask.job` (check 9). */
export function ccdDocsReader(deps: CcdDocsDeps): DocsReader {
  return {
    index: async () => settle(await readDocs(deps, { verb: 'docs-index' }), 'docs-index', LISTING_JOB,
      (line) => ({ ok: true, answer: line as unknown as DocsIndexOk })),
    tree: async (src, ref) => settle(await readDocs(deps, { verb: 'docs-tree', project: src.project, ref }), 'docs-tree',
      LISTING_JOB, (line) => ({ ok: true, answer: line as unknown as DocsTreeOk })),
    show: async (src, pin, ask): Promise<DocsShowRead> => settle(
      await readDocs(deps, { verb: 'docs-show', project: src.project, pin, ask }), 'docs-show', ask.job, (line) => {
        const answer = line as unknown as DocsShowOk;
        const shown = checkShow(answer, pin, ask);
        return shown.ok ? { ok: true, answer, bytes: shown.bytes } : shown;
      }),
  };
}

/** The fetch port over ccd: the one docs operation that writes, built apart from the reader (section 2 (g)'s wall 1).
 *  Its answer is under 1 KiB, held to `LISTING_JOB` (refinement (e): the spec names no fetch job). */
export function ccdDocsFetcher(deps: CcdDocsDeps): DocsFetcher {
  return {
    fetch: async (src, branch): Promise<DocsFetchRun> => settle(await fetchDocs(deps, src.project, branch), 'docs-fetch',
      LISTING_JOB, (line) => ({ ok: true, answer: line as unknown as DocsFetchOk })),
  };
}
