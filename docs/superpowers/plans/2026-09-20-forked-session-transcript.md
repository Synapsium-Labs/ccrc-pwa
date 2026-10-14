# A session that forks keeps its chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Claude Code forks a live session into a new sessionId, the PWA keeps showing the conversation and keeps showing the operator's own message.

**Architecture:** Claude Code writes `{"type":"continued-in",…,"continuedInSessionId":"<new>"}` as the last line of the transcript it abandons. One parser for that line, shared by every TypeScript reader; the server follows the pointer **inside** transcript resolution so the two-second tick cannot flap it back; `ccd` follows the same pointer to fix the registry, which is the authority; the PWA stops deleting its own optimistic bubble on a five-second timer; and `ccrc doctor` counts sessions still reading a superseded transcript, which must read zero.

**Tech Stack:** TypeScript (Node ≥22.13.0, ESM, vitest), React + zustand (PWA), bash (`ccd`, `session-hook.sh`, `ccrc-doctor-checks`).

**Spec:** `docs/superpowers/specs/2026-09-20-forked-session-transcript-design.md`

## Global Constraints

- **Node floor `>=22.13.0`**, identical across the three engines. Never lower `engines` to make a test green.
- **Run suites cd'd into the package, in the FOREGROUND, timeout ≥600000ms**, with `./node_modules/.bin/vitest run test/<file>`. **Never bare `npx vitest`** — it resolves a global copy with no jsdom and falsely reports "no tests".
- **Fixture HOMEs only.** Never run `ccd` against the live `$HOME`. Harness: `makeCcdHarness(prefix)` from `server/test/ccdWsHelpers.ts`; `h.cleanup()` in `afterEach`.
- **Never run `ws-rm`, `ws-reap`, `ws-gc --prune`, `ws-archive`, `ws-restore`** against anything. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units directly.
- **Wire discipline:** frames are ADDITIVE. Do NOT bump `FLEET_PROTO`. A new field needs a single reader.
- **No overloaded null at a seam.** Two conditions a caller handles differently must not collapse to one value.
- **Mutation-table discipline:** every new guard ships with a test that goes RED when the guard is deleted, measured before and after — not asserted in a comment.
- **Single source of truth:** a value spelled twice is a defect `server/test/single-definition.test.ts` fails the build on. Where a second spelling is unavoidable (bash cannot import TypeScript), it ships with a parity test.
- **AGENT-FIRST for anything under `ccd/`** (Tasks 6–8): fleet box first, then the server box, and only through `ccrc rollout` / `ccrc update`. Every deploy step needs the operator's explicit approval at the time. Implementing these tasks does not deploy them.
- **Known load flakes** — `ccd-*`, `session-hook`, `typecheck-tests` — re-run IN ISOLATION before calling a real break.

## Review Focus

Five input classes the spec implies but that no task's happy path exercises. Each has its test named in the owning task.

1. **A transcript whose last line is a half-written JSON object.** Claude Code appends a line at a time; a reader can land mid-write. Expected: no throw, no follow, the reader keeps the file it has. (Task 1)
2. **A continuation chain that loops — A points at B, B points back at A.** Expected: the walk stops and answers a real file, never spins. (Task 2)
3. **A successor that exists but is zero bytes** — the fork announced itself before writing anything. Expected: not followed yet. Swapping a full conversation for an empty one is worse than the freeze this fixes. (Task 2)
4. **A last line longer than the 8 KiB tail window.** Expected: "no marker", never a truncated parse that follows a uuid assembled from half a line. (Task 1)
5. **Re-sending a pending that has already been marked queued.** `resolve()` — the draft-conflict re-send — is the one path with no state guard, so it is the reachable route; `retry()` acts only on `failed`, which a queued pending reaches solely by being re-sent and failing. Expected: the flag clears on both, so a re-sent message does not inherit the previous attempt's state. (Task 5)

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `server/src/transcript/parse.ts` | what a transcript line MEANS — gains `continuationOf` | 1 |
| `server/src/transcript/resolve.ts` | which file to open — gains the follow and the memo stamp | 2, 3 |
| `server/src/sessionws.ts` | `shouldRepoint` learns that a different uuid is a different thing | 4 |
| `pwa/src/stores/session.ts` | the optimistic-send lifecycle | 5 |
| `ccd/ccd` | `_sync_uuid` — the registry is the authority | 6 |
| `ccd/session-hook.sh` | attribution for a session with no pane | 7 |
| `ccd/ccrc-doctor-checks` | the operator's signal | 8 |

---

### Task 1: The marker parser

One function decides what a `continued-in` line is. Every TypeScript reader calls it; the two bash readers (Tasks 6, 8) ship with a parity test in Task 8.

**Files:**
- Modify: `server/src/transcript/parse.ts`
- Test: `server/test/transcript-parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `continuationOf(line: string, ofUuid: string): string | null` and `CONTINUATION_TAIL_BYTES: number`, both exported from `server/src/transcript/parse.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/transcript-parse.test.ts`:

```ts
import { continuationOf, CONTINUATION_TAIL_BYTES } from '../src/transcript/parse.js';

const OLD = 'a'.repeat(36);
const NEW = 'b'.repeat(36);

describe('continuationOf', () => {
  const marker = (from: string, to: string): string =>
    JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to });

  it('answers the successor uuid for the session that wrote the line', () => {
    expect(continuationOf(marker(OLD, NEW), OLD)).toBe(NEW);
  });

  it('answers null for every other record type', () => {
    expect(continuationOf(JSON.stringify({ type: 'user', message: {} }), OLD)).toBeNull();
  });

  // Review Focus 1: a line caught mid-write is not a marker and is not a throw.
  it('answers null for a half-written line rather than throwing', () => {
    expect(continuationOf(marker(OLD, NEW).slice(0, 40), OLD)).toBeNull();
    expect(continuationOf('', OLD)).toBeNull();
    expect(continuationOf('{', OLD)).toBeNull();
  });

  it('refuses a marker another session wrote', () => {
    expect(continuationOf(marker('c'.repeat(36), NEW), OLD)).toBeNull();
  });

  // absence-permits: a record with no sessionId is still that file's marker.
  it('accepts a marker that names no sessionId', () => {
    expect(continuationOf(JSON.stringify({ type: 'continued-in', continuedInSessionId: NEW }), OLD))
      .toBe(NEW);
  });

  it('refuses a successor that is not a uuid, and refuses itself', () => {
    expect(continuationOf(marker(OLD, 'nope'), OLD)).toBeNull();
    expect(continuationOf(marker(OLD, OLD), OLD)).toBeNull();
  });

  // Review Focus 4: the window is the contract, so the constant is the contract.
  it('declares a tail window big enough for a marker line', () => {
    expect(CONTINUATION_TAIL_BYTES).toBeGreaterThanOrEqual(marker(OLD, NEW).length * 4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/transcript-parse.test.ts
```

Expected: FAIL — `continuationOf` is not exported by `../src/transcript/parse.js`.

- [ ] **Step 3: Implement**

Append to `server/src/transcript/parse.ts`:

```ts
/** How many bytes of a transcript's tail a reader needs to see its last line.
 *  Every reader of the marker uses this one window — the server here, `ccd`'s
 *  `_sync_uuid` and `ccrc doctor`'s `transcripts` check, whose bash copies are
 *  held equal to this number by `server/test/continued-in-parity.test.ts`. */
export const CONTINUATION_TAIL_BYTES = 8192;

const UUID_RE = /^[0-9a-f-]{36}$/;

/**
 * The session this transcript CONTINUES IN, or null.
 *
 * Claude Code 2.1.278 forks a live session into a daemon-hosted background PTY
 * under a new sessionId and writes, as the last line of the file it abandons:
 *
 *     {"type":"continued-in","sessionId":"<old>","continuedInSessionId":"<new>"}
 *
 * This is the harness's own statement about itself, so it is read rather than
 * inferred — but it is also data off a disk other processes write, so every
 * field is checked before it is believed.
 *
 * `ofUuid` is the uuid of the file the line came from. A marker naming a
 * DIFFERENT `sessionId` is not this file's marker and is refused; a marker
 * naming no `sessionId` at all is accepted (absence-permits — an older or
 * newer harness may not write the field, and the line's position at the end of
 * this file is already evidence enough). A successor that is not a uuid, or is
 * this file's own uuid, is refused: the first is unusable and the second is a
 * one-element cycle.
 *
 * Never throws. A caller reading a file's tail can land on a half-written line,
 * and a parse failure there means "not a marker", not "the session is broken".
 */
export function continuationOf(line: string, ofUuid: string): string | null {
  let raw: unknown;
  try { raw = JSON.parse(line); } catch { return null; }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r['type'] !== 'continued-in') return null;
  const from = r['sessionId'];
  if (typeof from === 'string' && from !== ofUuid) return null;
  const to = r['continuedInSessionId'];
  if (typeof to !== 'string' || !UUID_RE.test(to) || to === ofUuid) return null;
  return to;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/transcript-parse.test.ts
```

Expected: PASS.

- [ ] **Step 5: Measure the mutation table**

For each guard, break it, run the suite, confirm RED, restore it, confirm GREEN. Record the result in the commit body.

| Mutation | Must go red |
|---|---|
| delete the `try/catch` around `JSON.parse` | "answers null for a half-written line" |
| drop the `from !== ofUuid` refusal | "refuses a marker another session wrote" |
| drop the `to === ofUuid` refusal | "refuses a successor that is not a uuid, and refuses itself" |
| drop `UUID_RE.test(to)` | same test |

- [ ] **Step 6: Commit**

```bash
git add server/src/transcript/parse.ts server/test/transcript-parse.test.ts
git commit -m "feat(transcript): read Claude Code's own continued-in pointer

One parser for the record a forked session leaves behind, checked field by
field because it is data off a disk other processes write, and never throwing
because a tail read can land mid-line.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Resolution follows the pointer

**Files:**
- Modify: `server/src/transcript/resolve.ts`
- Test: `server/test/transcript-ladder.test.ts`

**Interfaces:**
- Consumes: `continuationOf`, `CONTINUATION_TAIL_BYTES` (Task 1); `FleetIO.statMeasured`, `FleetIO.readFileFrom` (`server/src/io.ts`).
- Produces: `TranscriptResolution`'s `found` arm gains `readonly uuid: string`; `MAX_CONTINUATION_HOPS: number` is exported.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/transcript-ladder.test.ts`. `box()` and `mkTmp` are already in that file; `plantChain` below is new.

```ts
/** Write `<cfg>/projects/<munge(dir)>/<uuid>.jsonl` with the given body. */
const plant = (b: Box, uuid: string, body: string): string => {
  const p = transcriptPath(b.cfg, b.livePhys, uuid);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, body, 'utf8');
  return p;
};
const marker = (from: string, to: string): string =>
  `${JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to })}\n`;
const turn = (text: string): string =>
  `${JSON.stringify({ type: 'user', uuid: text, message: { role: 'user', content: text } })}\n`;

const opts = (b: Box, uuid: string): ResolveOpts =>
  ({ configDir: b.cfg, dir: b.livePhys, registryWorkdir: b.livePhys, uuid });

const A = 'a'.repeat(36), B = 'b'.repeat(36), C = 'c'.repeat(36);

describe('continuation follow', () => {
  it('answers the successor path and uuid when the requested file is superseded', async () => {
    const b = box();
    plant(b, A, turn('one') + marker(A, B));
    const to = plant(b, B, turn('two'));
    const r = await resolveTranscript(localIO, opts(b, A));
    expect(r).toMatchObject({ kind: 'found', path: to, uuid: B });
  });

  it('carries the requested uuid when nothing was followed', async () => {
    const b = box();
    const own = plant(b, A, turn('one'));
    const r = await resolveTranscript(localIO, opts(b, A));
    expect(r).toMatchObject({ kind: 'found', path: own, uuid: A });
  });

  it('walks a two-hop chain to its end', async () => {
    const b = box();
    plant(b, A, marker(A, B));
    plant(b, B, marker(B, C));
    const to = plant(b, C, turn('three'));
    expect(await resolveTranscript(localIO, opts(b, A))).toMatchObject({ path: to, uuid: C });
  });

  // Review Focus 2: a cycle must stop at a real file, not spin.
  //
  // THE CYCLE IS ODD-LENGTH AND THE ASSERTION NAMES THE EXACT FILE, and both
  // halves are load-bearing. A two-node cycle walked with the visited set
  // removed bounces A->B->A->B for the whole hop bound and lands back on A —
  // the same answer a correct implementation gives immediately — so a
  // two-node fixture, or an assertion that accepts either file, cannot tell
  // "stopped because the cycle was caught" from "stopped because the bound ran
  // out on the same file". Measured: that weaker fixture stayed green with the
  // visited check deleted.
  it('stops on a chain that loops back', async () => {
    const b = box();
    plant(b, A, turn('one') + marker(A, B));
    plant(b, B, turn('two') + marker(B, C));
    const third = plant(b, C, turn('three') + marker(C, A));
    // A -> B -> C, and C names A, which is visited: the walk stops at C.
    // Without the visited set the bound alone lets it run A->B->C->A->B.
    expect(await resolveTranscript(localIO, opts(b, A)))
      .toMatchObject({ kind: 'found', path: third, uuid: C });
  });

  it('stops at the hop bound and answers the last good file', async () => {
    const b = box();
    // THE CHAIN LENGTH IS A LITERAL, NOT MAX_CONTINUATION_HOPS + 3. Deriving it
    // from the constant makes the fixture move whenever the constant does: at a
    // mutated bound of 400 the id scheme `String(i).repeat(36).slice(0, 36)`
    // collides (i = 1, 11, 111 all spell the same 36 characters), the plant loop
    // overwrites its own earlier markers, and the walk then stops at a corrupted
    // chain end rather than at the bound. Measured: the test still went red, but
    // for the wrong reason — and it would break the SHIPPED test too if the
    // bound were ever raised past 7.
    const ids = Array.from({ length: 10 }, (_, i) => String(i).padStart(2, '0').repeat(18));
    for (let i = 0; i < ids.length - 1; i += 1) plant(b, ids[i]!, marker(ids[i]!, ids[i + 1]!));
    plant(b, ids[ids.length - 1]!, turn('end'));
    const r = await resolveTranscript(localIO, opts(b, ids[0]!));
    // The bound is the contract, so it is asserted as one: four hops from
    // ids[0] lands on ids[4], and the chain runs to ids[9] so a raised bound
    // lands somewhere else. Asserting merely "not ids[0]" holds for ANY bound
    // and pins nothing — measured: it stayed green at a bound of 400.
    expect(MAX_CONTINUATION_HOPS).toBe(4);
    expect(r).toMatchObject({ kind: 'found', uuid: ids[4] });
  });

  // Review Focus 3: an announced-but-empty successor is not an improvement.
  it('does not follow to a zero-byte successor', async () => {
    const b = box();
    const own = plant(b, A, turn('one') + marker(A, B));
    plant(b, B, '');
    expect(await resolveTranscript(localIO, opts(b, A))).toMatchObject({ path: own, uuid: A });
  });

  it('does not follow a marker whose successor does not exist', async () => {
    const b = box();
    const own = plant(b, A, turn('one') + marker(A, B));
    expect(await resolveTranscript(localIO, opts(b, A))).toMatchObject({ path: own, uuid: A });
  });

  it('leaves a fallback alone — there is no file to read a marker from', async () => {
    const b = box();
    expect((await resolveTranscript(localIO, opts(b, A))).kind).toBe('fallback');
  });

  // Review Focus 4: a last line bigger than the window is not a marker. The
  // tail starts mid-line, the JSON parse fails, and the answer is the honest
  // "no marker" — never a uuid assembled from half a record.
  it('answers no marker when the last line exceeds the tail window', async () => {
    const b = box();
    const fat = JSON.stringify({
      type: 'continued-in', sessionId: A, continuedInSessionId: B,
      pad: 'x'.repeat(CONTINUATION_TAIL_BYTES * 2),
    });
    const own = plant(b, A, turn('one') + `${fat}\n`);
    plant(b, B, turn('two'));
    expect(await resolveTranscript(localIO, opts(b, A))).toMatchObject({ path: own, uuid: A });
  });
});
```

Add `MAX_CONTINUATION_HOPS` to this file's existing import from `../src/transcript/resolve.js`, `CONTINUATION_TAIL_BYTES` from `../src/transcript/parse.js`, and `appendFileSync` to its `node:fs` import (Task 3 uses it).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts
```

Expected: FAIL — `MAX_CONTINUATION_HOPS` is not exported, and `uuid` is not on the `found` arm.

- [ ] **Step 3: Implement**

In `server/src/transcript/resolve.ts`:

1. Import the parser:

```ts
import { continuationOf, CONTINUATION_TAIL_BYTES } from './parse.js';
```

2. Add `uuid` to the `found` arm of `TranscriptResolution`:

```ts
export type TranscriptResolution =
  | { readonly kind: 'found'; readonly path: string; readonly rung: TranscriptRung;
      readonly account: string | null;
      /** The uuid the answered PATH holds — equal to the requested uuid unless
       *  a `continued-in` pointer was followed. It travels in the outcome
       *  because a caller parsing it back out of the path's basename would be
       *  an adapter re-deriving a distinction it was already handed, and
       *  because `shouldRepoint` needs it: supersession is not a better
       *  address for the same thing, it is a different thing. */
      readonly uuid: string }
  | { readonly kind: 'fallback'; readonly path: string; readonly complete: boolean };
```

3. Rename today's `resolveTranscript` body to a module-private `ladder`, and add `uuid: o.uuid` to each of its three `kind: 'found'` returns. Then add the follow:

```ts
/** How many `continued-in` hops one resolution may walk. A fork of a fork is
 *  real; a chain this long is a disk telling a story, and the walk stops
 *  rather than believing it. */
export const MAX_CONTINUATION_HOPS = 4;

/** The successor named by the last line of `file`, or null. */
async function continuationAt(io: FleetIO, file: string, uuid: string): Promise<string | null> {
  const st = await io.statMeasured(file);
  if (!st.ok || st.size === 0) return null;
  const start = Math.max(0, st.size - CONTINUATION_TAIL_BYTES);
  const res = await io.readFileFrom(file, start);
  if (res === null) return null;
  const lines = res.data.split('\n').filter((l) => l.trim() !== '');
  // A window that starts mid-file starts mid-line, and its FIRST line is the
  // only one that can be partial; the marker is the LAST line, so a truncated
  // head costs nothing. A last line longer than the window parses as garbage
  // and answers null, which is the honest "no marker" rather than a uuid
  // assembled from half a record.
  const last = lines[lines.length - 1];
  return last === undefined ? null : continuationOf(last, uuid);
}

/**
 * The transcript a reader should open, following Claude Code's own
 * `continued-in` pointer to the end of the chain.
 *
 * THE FOLLOW LIVES HERE, not in the stream. `SessionStream`'s two-second tick
 * compares the registry's uuid against the one it is tailing; a stream that
 * switched uuid on its own would be flapped back by the next tick. Resolution
 * is the one place that answers "which file", so it is the one place that can
 * answer it with the fork included.
 *
 * FOLLOWING MAY ONLY EVER IMPROVE THE ANSWER. A successor that does not
 * resolve, or resolves to an empty file (the fork announced itself before
 * writing anything), is not followed: swapping a full conversation for an
 * empty one is worse than the staleness this fixes. A visited set and a hop
 * bound stop a chain that loops or that goes on too long, and the walk keeps
 * the last GOOD answer rather than unwinding to a fallback.
 */
export async function resolveTranscript(io: FleetIO, o: ResolveOpts): Promise<TranscriptResolution> {
  let best = await ladder(io, o);
  const visited = new Set<string>([o.uuid]);
  for (let hop = 0; hop < MAX_CONTINUATION_HOPS; hop += 1) {
    if (best.kind !== 'found') return best;
    const next = await continuationAt(io, best.path, best.uuid);
    if (next === null || visited.has(next)) return best;
    visited.add(next);
    const onward = await ladder(io, { ...o, uuid: next });
    if (onward.kind !== 'found') return best;
    const st = await io.stat(onward.path);
    if (st === null || st.size === 0) return best;
    best = onward;
  }
  return best;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts
```

Expected: PASS — after you fix the fallout. `TranscriptResolution.found` gained a REQUIRED field, so two sets of sites move:

- the three `kind: 'found'` returns inside `ladder` (`resolve.ts:291`, `:297`, `:352`), which the implementation above already covers;
- roughly fifteen `toEqual({ kind: 'found', path, rung, account })` assertions already in `transcript-ladder.test.ts`. `toEqual` is exact, so each needs `uuid` added — the requested uuid in every one of them, because none of those fixtures carries a marker. Find them with `grep -n "kind: 'found'" server/test/transcript-ladder.test.ts`.

Then the whole server suite:

```bash
cd server && ./node_modules/.bin/vitest run
```

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| drop the `visited` check | "stops on a chain that loops back" (hangs or exceeds the bound) |
| raise `MAX_CONTINUATION_HOPS` past the fixture length | "stops at the hop bound…" |
| drop the `st.size === 0` refusal | "does not follow to a zero-byte successor" |
| `return best` -> `return onward` when `onward.kind !== 'found'` | "does not follow a marker whose successor does not exist" |
| hardcode `uuid: o.uuid` on the found arms | "answers the successor path and uuid…" |

- [ ] **Step 6: Commit**

```bash
git add server/src/transcript/resolve.ts server/test/transcript-ladder.test.ts
git commit -m "feat(transcript): resolution follows a superseded transcript to its successor

The resolver answers the file the conversation actually continued in, and says
which uuid that file holds. Following may only improve the answer: a missing or
empty successor, a loop and an over-long chain all keep the last good file.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The memo stops serving a pre-fork answer

`TranscriptResolver` revalidates a cached answer with one question — does the file still exist? A file that gains a marker while a stream is open still exists, so without this task a stream that was open at the moment of the fork keeps the pre-fork answer for its whole life.

**Files:**
- Modify: `server/src/transcript/resolve.ts` (the `TranscriptResolver` class only)
- Test: `server/test/transcript-ladder.test.ts`

**Interfaces:**
- Consumes: `resolveTranscript` (Task 2).
- Produces: no new exports. `TranscriptResolver.resolve` keeps its signature.

- [ ] **Step 1: Write the failing test**

```ts
describe('TranscriptResolver and the fork', () => {
  it('re-ladders when the answered file gains a marker under an open stream', async () => {
    const b = box();
    const own = plant(b, A, turn('one'));
    const to = plant(b, B, turn('two'));
    const r = new TranscriptResolver(localIO);
    expect(await r.resolve(opts(b, A))).toMatchObject({ path: own, uuid: A });
    appendFileSync(own, marker(A, B), 'utf8');
    // ONE POLL IS NOT ENOUGH, deliberately: the poll that SEES the change only
    // records it. A file still being written cannot carry a terminal marker,
    // and re-reading it every tick is a bill `watch.ts` already pays once.
    expect(await r.resolve(opts(b, A))).toMatchObject({ path: own, uuid: A });
    expect(await r.resolve(opts(b, A))).toMatchObject({ path: to, uuid: B });
  });

  it('never re-ladders a transcript that is still growing', async () => {
    const b = box();
    const own = plant(b, A, turn('one'));
    plant(b, B, turn('two'));
    let reads = 0;
    const counting: FleetIO = {
      ...localIO,
      readFileFrom: async (p, o) => { reads += 1; return localIO.readFileFrom(p, o); },
    };
    const r = new TranscriptResolver(counting);
    await r.resolve(opts(b, A));
    const afterFirst = reads;
    for (let i = 0; i < 5; i += 1) {
      appendFileSync(own, turn(`more ${i}`), 'utf8');
      await r.resolve(opts(b, A));
    }
    // Five polls, five growth events, zero extra tail reads — the file never
    // stood still, so the ladder never re-ran. This is the invariant
    // `name-sweep.test.ts`'s stat gate measures from the other side.
    expect(reads).toBe(afterFirst);
  });

  it('still serves the memo when nothing changed', async () => {
    const b = box();
    plant(b, A, turn('one'));
    let stats = 0;
    const counting: FleetIO = { ...localIO, stat: async (p) => { stats += 1; return localIO.stat(p); } };
    const r = new TranscriptResolver(counting);
    await r.resolve(opts(b, A));
    const afterFirst = stats;
    await r.resolve(opts(b, A));
    expect(stats - afterFirst).toBe(1);   // one revalidating stat, no ladder
  });
});
```

Add `appendFileSync` to the `node:fs` import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts -t 'gains a marker'
```

Expected: FAIL — the second resolve answers the pre-fork path.

- [ ] **Step 3: Implement**

In `TranscriptResolver`, carry a stamp with the answer and make the revalidation ask about change as well as existence:

```ts
  private readonly memo = new Map<
    string, { answer: TranscriptResolution; at: number; stamp: string | null }
  >();
```

In `resolve`, replace the revalidation block:

```ts
    const held = this.memo.get(key);
    if (held !== undefined && !this.staleByBackoff(held)) {
      const st = await this.io.stat(held.answer.path);
      // THREE STATES, NOT TWO — and the third is what keeps this class cheap.
      //
      // Existence alone was never the question: a transcript that gains a
      // `continued-in` marker still exists, and a memo that asked only about
      // existence served the pre-fork answer for the life of the stream, which
      // is the freeze this work is for moved one layer in.
      //
      // But "changed" is not the question either. A transcript that is being
      // WRITTEN cannot carry a terminal marker — the marker is the last line a
      // file ever gets — so re-laddering a growing file buys a tail read that
      // can learn nothing. It is not free: `watch.ts`'s name sweep already pays
      // its own read for a grown transcript through `claimTitleRead`, so this
      // class re-reading the same file doubles that bill on every tick of every
      // busy session. Measured: it broke `name-sweep.test.ts`'s own stat-gate
      // tests, 4 reads where the invariant pins 3.
      //
      // So: unchanged since the answer -> serve it (the quiet case, one stat).
      // Changed and still changing -> serve it and remember what was seen (the
      // busy case, one stat). Changed and now STILL -> re-ladder, because a
      // file that stopped is a file that may have been superseded. A fork is
      // therefore followed on the second poll after it happens, not the first;
      // four seconds against a chat that used to freeze for ever.
      //
      // A `fallback` is unchanged: it stays true while its path still does NOT
      // exist.
      if (held.answer.kind === 'fallback') {
        if (st === null) return held.answer;
      } else if (st !== null) {
        const cur = stampOf(st);
        if (cur === held.stamp) return held.answer;
        if (cur !== held.seen) { held.seen = cur; return held.answer; }
      }
    }
    const answer = await resolveTranscript(this.io, o);
    this.remember(key, answer, answer.kind === 'found' ? await this.io.stat(answer.path) : null);
    return answer;
```

The memo entry carries both stamps and `seen` is mutable:

```ts
  private readonly memo = new Map<
    string, { answer: TranscriptResolution; at: number; readonly stamp: string | null; seen: string | null }
  >();
```

With, at module scope:

```ts
/** A file's identity for "has this changed since I read it". `FleetIO.stat`
 *  carries no inode on this seam, and `collapseHits` already treats
 *  `(size, mtimeMs)` as identity for the same reason. */
const stampOf = (st: { size: number; mtimeMs: number } | null): string | null =>
  st === null ? null : `${st.size}:${st.mtimeMs}`;
```

and `remember` taking the stamp:

```ts
  private remember(
    key: string, answer: TranscriptResolution, st: { size: number; mtimeMs: number } | null,
  ): void {
    this.memo.delete(key);                       // re-insert so Map order is recency
    const stamp = stampOf(st);
    this.memo.set(key, { answer, at: this.now(), stamp, seen: stamp });
    while (this.memo.size > MEMO_MAX) {
      const oldest = this.memo.keys().next();
      if (oldest.done === true) break;
      this.memo.delete(oldest.value);
    }
  }
```

**Cost, stated:** a file that has not changed costs one stat and no read, exactly as today. A file that HAS changed re-runs the ladder, which reads the last 8 KiB. That duplicates bytes the backlog and tailer read anyway; the duplication is accepted deliberately, because the alternative — the tailer reporting the marker upward — puts transcript knowledge in the delivery layer and creates a second place where "what is a marker" is decided.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts
cd server && ./node_modules/.bin/vitest run test/name-sweep.test.ts
```

`name-sweep.test.ts` is not optional here and it is the suite this task can break: `sweepNames` resolves the transcript AND runs its own `claimTitleRead` stat gate, so a resolver that re-reads a grown file doubles a read the sweep already pays. Its "the stat gate" block is the pin.

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| drop the `cur === held.stamp` arm | "still serves the memo when nothing changed" |
| drop the `cur !== held.seen` arm (re-ladder on any change) | "never re-ladders a transcript that is still growing", and `name-sweep.test.ts`'s three stat-gate tests |
| revalidate on existence alone (`st !== null`) | "re-ladders when the answered file gains a marker" |

- [ ] **Step 6: Commit**

```bash
git add server/src/transcript/resolve.ts server/test/transcript-ladder.test.ts
git commit -m "fix(transcript): the resolver memo no longer serves a pre-fork answer

Existence alone was never the question — a transcript that gains a continued-in
marker still exists. The memo now carries the answer's (size, mtime) and
re-ladders when it moves.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: A different uuid is a different thing

`shouldRepoint` declines a same-rung path change while the old file still exists — and a superseded transcript is exactly that shape: same rung, different path, old file frozen but present. Without this clause a fork that happens while the operator is watching is never picked up.

**Files:**
- Modify: `server/src/sessionws.ts` (the `shouldRepoint` function only)
- Test: `server/test/sessionws.test.ts`

**Interfaces:**
- Consumes: `TranscriptResolution.uuid` (Task 2).
- Produces: `shouldRepoint` keeps its signature `(cur, next, tailedExists) => boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
const found = (p: string, uuid: string, rung: TranscriptRung = 'registry-raw'): TranscriptResolution =>
  ({ kind: 'found', path: p, rung, account: null, uuid });

describe('shouldRepoint and supersession', () => {
  it('re-points to a successor at the same rung while the old file still exists', () => {
    expect(shouldRepoint(found('/a.jsonl', A), found('/b.jsonl', B), true)).toBe(true);
  });

  it('still declines a same-rung, same-uuid, same-path answer', () => {
    expect(shouldRepoint(found('/a.jsonl', A), found('/a.jsonl', A), true)).toBe(false);
  });

  it('declines a worse rung for the same uuid', () => {
    expect(shouldRepoint(found('/a.jsonl', A, 'live-raw'), found('/c.jsonl', A, 'foreign-glob'), true))
      .toBe(false);
  });
});
```

Also add, in the stream-level describe that already owns the repoint branch:

```ts
  it('sends a fresh backlog and never `rotated` when it follows a fork', async () => {
    // Build the stream the way this file's existing repoint cases do (read the
    // "follows a SAME-RUNG answer to a different path once the tailed file is
    // gone" case and copy its setup verbatim), with one change: instead of
    // deleting the tailed file, APPEND a continued-in marker to it and plant
    // the successor beside it. Then let one tick run.
    appendFileSync(tailed, marker(A, B), 'utf8');
    writeFileSync(successor, turn('after the fork'), 'utf8');
    await stream.tickOnce();          // whatever this file already calls to advance one poll
    const types = sent.map((m) => m.type);
    expect(types).toContain('backlog');
    // `rotated` paints "Session context reset" in the chat. Nothing was reset —
    // the conversation continued — and the tick's own repoint branch refuses
    // that frame for exactly this reason.
    expect(types).not.toContain('rotated');
    expect(sent.find((m) => m.type === 'backlog')).toMatchObject({ file: successor });
  });
```

`sessionws.test.ts` is a different file from Task 2's, so it needs its own `marker`/`turn` helpers and `A`/`B` constants — three lines, copied, because a shared fixture module for two literals would be the heavier thing.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/sessionws.test.ts -t 'supersession'
```

Expected: FAIL — the first case answers `false`.

- [ ] **Step 3: Implement**

```ts
/**
 * §5.3's re-point decision, pure: re-point when the answer CHANGED and either
 * it names a different transcript session, the new rung is strictly better, or
 * the file being tailed is gone.
 *
 * "Better" is §5.1's rung order, which is why the rung travels in the union
 * rather than being recomputed here. A same-rung, same-path answer changes
 * nothing — the common case every tick.
 *
 * THE UUID CLAUSE IS NOT A RUNG QUESTION. A transcript that Claude Code
 * superseded (`continued-in`) resolves at the SAME rung, to a DIFFERENT path,
 * while the old file is still on disk — frozen, not deleted — so all three of
 * the original clauses decline it and the stream would tail a dead file for
 * ever. Supersession is not a better ADDRESS for the same thing; it is a
 * different thing, and rung order was never asked to rank it. A fallback
 * carries no uuid and needs none: it always ranks last, so a fallback on
 * either side is already decided by rank.
 */
export function shouldRepoint(
  cur: TranscriptResolution, next: TranscriptResolution, tailedExists: boolean,
): boolean {
  if (cur.kind === 'found' && next.kind === 'found' && cur.uuid !== next.uuid) return true;
  if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;
  if (rungRank(next) < rungRank(cur)) return true;
  return !tailedExists;
}
```

`repointNeeded` needs no change: its pre-filter short-circuits only on a same-path answer, and a followed answer always has a different path.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/sessionws.test.ts
cd server && ./node_modules/.bin/vitest run
```

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| delete the uuid clause | "re-points to a successor at the same rung" |
| move the uuid clause to the END, after `return !tailedExists` | it becomes unreachable — "re-points to a successor at the same rung" goes red, which is the point: the clause is only correct ahead of that return |
| make the repoint send `rotated` | "sends a fresh backlog and never `rotated`" |

- [ ] **Step 6: Commit**

```bash
git add server/src/sessionws.ts server/test/sessionws.test.ts
git commit -m "fix(sessionws): a resolution naming a different session re-points

shouldRepoint declined the one shape a fork produces — same rung, different
path, old file still on disk — so a session that forked under an open stream
was tailed to a dead file for ever. The frame stays `backlog`: nothing was
reset, the conversation continued.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The PWA stops erasing the operator's message

**Files:**
- Modify: `pwa/src/stores/session.ts`
- Test: `pwa/test/stores.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this lane is independent.
- Produces: `PendingSend.queued?: boolean`; `SessionStoreDeps.queuedTimeoutMs?: number`.

Do NOT touch `pwa/src/session/ChatList.tsx`, `MessageBubble.tsx`, `chat.css` or `pwa/test/chat.test.tsx` — open PR #152 owns them. `PendingBubble` renders anything that is not `state === 'sending'` as a red failure, which is why this is a FLAG beside the state and not a third state token.

- [ ] **Step 1: Write the failing tests**

```ts
describe('a queued send', () => {
  it('marks the pending queued instead of deleting it', async () => {
    vi.useFakeTimers();
    const store = createSessionStore('s1', { api: okApi, confirmTimeoutMs: 50, queuedTimeoutMs: 5_000 });
    await store.getState().send('hello');
    vi.advanceTimersByTime(60);
    expect(store.getState().pending).toHaveLength(1);
    expect(store.getState().pending[0]).toMatchObject({ state: 'sending', queued: true });
  });

  it('still retires the bubble at the long deadline, revoking its object URLs', async () => {
    vi.useFakeTimers();
    const revoked: string[] = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => { revoked.push(u); });
    const store = createSessionStore('s2', { api: okApi, confirmTimeoutMs: 50, queuedTimeoutMs: 5_000 });
    await store.getState().send('hi', { attachments: [{ path: '/tmp/a.png', previewUrl: 'blob:a' }] });
    vi.advanceTimersByTime(60);
    expect(store.getState().pending).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(store.getState().pending).toHaveLength(0);
    expect(revoked).toContain('blob:a');
  });

  it('clears a queued pending when its echo arrives in a fresh backlog', async () => {
    vi.useFakeTimers();
    const store = createSessionStore('s3', { api: okApi, confirmTimeoutMs: 50, queuedTimeoutMs: 5_000 });
    await store.getState().send('hello');
    vi.advanceTimersByTime(60);
    store.getState().apply({
      type: 'backlog', uuid: 'u1', events: [user('a', 'hello')], offset: 40,
      file: '/t/u1.jsonl', missing: false,
    });
    expect(store.getState().pending).toHaveLength(0);
  });

  it('cancels the long deadline when the echo lands', async () => {
    vi.useFakeTimers();
    const store = createSessionStore('s4', { api: okApi, confirmTimeoutMs: 50, queuedTimeoutMs: 5_000 });
    await store.getState().send('hello');
    vi.advanceTimersByTime(60);
    store.getState().apply({ type: 'events', uuid: 'u1', events: [user('a', 'hello')], offset: 40 });
    expect(vi.getTimerCount()).toBe(0);
  });

  // Review Focus 5. `resolve()` is the reachable route: it is the one re-send
  // with no state guard, so it can act on a pending that is still `sending`.
  // `retry()` guards `state !== 'failed'` and a queued pending is `sending`, so
  // it is reached only after a re-send has failed — covered by the second case.
  it('clears the queued flag when the pending is re-sent', async () => {
    vi.useFakeTimers();
    const store = createSessionStore('s5', { api: okApi, confirmTimeoutMs: 50, queuedTimeoutMs: 5_000 });
    await store.getState().send('hello');
    vi.advanceTimersByTime(60);
    const key = store.getState().pending[0]!.key;
    expect(store.getState().pending[0]?.queued).toBe(true);
    store.getState().resolve(key, 'hello again', { replaceDraft: true });
    expect(store.getState().pending[0]?.queued).toBeUndefined();
  });

  it('clears the queued flag on retry after a failed re-send', async () => {
    vi.useFakeTimers();
    const store = createSessionStore('s6', { api: okThenFail, confirmTimeoutMs: 50, queuedTimeoutMs: 5_000 });
    await store.getState().send('hello');
    vi.advanceTimersByTime(60);
    const key = store.getState().pending[0]!.key;
    store.getState().resolve(key, 'hello', { replaceDraft: true });   // this one fails
    await vi.runAllTicks?.();
    expect(store.getState().pending[0]).toMatchObject({ state: 'failed', queued: true });
    store.getState().retry(key);
    expect(store.getState().pending[0]?.queued).toBeUndefined();
  });
});
```

This file already has `user(id, text)` for a user event and drives the store with `store.getState().apply(<frame>)`; reuse those and its existing api fake rather than inventing new ones — `okApi` and `failThenOk` above are placeholders for whatever that file already calls them. Read it first.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd pwa && ./node_modules/.bin/vitest run test/stores.test.ts -t 'queued'
```

Expected: FAIL — `queuedTimeoutMs` is not a dep and the pending is gone after 60 ms.

- [ ] **Step 3: Implement**

1. The field, on `PendingSend`:

```ts
  /** The API accepted this send and the session has not echoed it back yet —
   *  which is the ordinary fate of a message typed while the session is busy:
   *  the pane QUEUES it ("Press up to edit queued messages") and echoes it only
   *  when it gets to it.
   *
   *  A FLAG, NOT A STATE, deliberately. `ChatList`'s `PendingBubble` branches
   *  `state === 'sending'` against everything else, and everything else renders
   *  as the red "not sent" failure — so a third state token would paint a
   *  perfectly healthy queued message as an error. The renderer needs no change
   *  to stay correct today, and showing "queued" instead of "sending" is one
   *  line in it whenever that file is next open. */
  queued?: boolean;
```

2. The knob, on `SessionStoreDeps`:

```ts
  /** How long a QUEUED pending survives before it is retired. The five-second
   *  `confirmTimeoutMs` used to delete it, which is the defect: a busy session
   *  cannot echo inside five seconds, so the operator watched their own message
   *  vanish. The deletion is not removed — a slash command's echo parses as a
   *  `system` event and `clearConfirmed` matches only `user`, so this timer is
   *  the ONLY terminal condition those bubbles have — it is moved to a horizon
   *  where a bubble quietly retiring is no longer a surprise. */
  queuedTimeoutMs?: number;
```

3. In `createSessionStore`:

```ts
  const queuedTimeoutMs = deps.queuedTimeoutMs ?? 10 * 60_000;
```

4. Split the deadline in two:

```ts
    // Api accepted the prompt and the echo has not arrived. STAGE ONE: say so.
    const markQueued = (key: string): void => {
      timers.delete(key);
      set((s) => {
        const p = s.pending.find((x) => x.key === key);
        if (!p || p.state !== 'sending') return {};
        return { pending: s.pending.map((x) => (x.key === key ? { ...x, queued: true } : x)) };
      });
      if (get().pending.some((x) => x.key === key && x.state === 'sending')) {
        timers.set(key, setTimeout(() => expireConfirmed(key), queuedTimeoutMs));
      }
    };
```

and in `dispatch`, replace the timer it sets:

```ts
        timers.set(key, setTimeout(() => markQueued(key), confirmTimeoutMs));
```

`expireConfirmed` keeps its body unchanged — it is stage two now.

5. Cancel the timer when the echo lands. `clearConfirmed` is a pure function outside the closure, so it has to say which keys it dropped:

```ts
function clearConfirmed(
  pending: PendingSend[], msg: SessionStreamMsg,
): { pending: PendingSend[]; cleared: string[] } {
  if (msg.type !== 'events' && msg.type !== 'backlog') return { pending, cleared: [] };
  let next = pending;
  const cleared: string[] = [];
  for (const e of msg.events) {
    if (e.kind !== 'user') continue;
    const i = next.findIndex(
      (p) => p.state === 'sending' && composePrompt(p.text, pathsOf(p) ?? []) === e.text,
    );
    if (i >= 0) {
      revoke(next[i]);
      cleared.push(next[i]!.key);
      next = [...next.slice(0, i), ...next.slice(i + 1)];
    }
  }
  return { pending: next, cleared };
}
```

and at its call site (the `events`/`backlog` branch of the stream handler), clear those timers:

```ts
        const confirmed = clearConfirmed(s.pending, msg);
        for (const key of confirmed.cleared) {
          const t = timers.get(key);
          if (t !== undefined) { clearTimeout(t); timers.delete(key); }
        }
        // … { pending: confirmed.pending, … }
```

A dangling five-second timer was harmless; a dangling ten-minute one per message is not, and the timer is now the thing that ends the bubble, so it has to end when the bubble does.

6. `retry` and `resolve` both reset the failure fields — add `queued: undefined` to each, in the same spread.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd pwa && ./node_modules/.bin/vitest run test/stores.test.ts
cd pwa && ./node_modules/.bin/vitest run
```

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| restore `expireConfirmed` as the stage-one callback | "marks the pending queued instead of deleting it" |
| drop the stage-two timer in `markQueued` | "still retires the bubble at the long deadline" |
| drop the `clearTimeout` loop at the `clearConfirmed` call site | "cancels the long deadline when the echo lands" |
| drop `queued: undefined` from `retry` | NOTHING — measured. `resolve` clears the flag synchronously before its dispatch can fail, and `send` arms no timer until the api has accepted, so no path produces a pending that is both `failed` and `queued`, and `retry`'s own reset is unreachable. The reset stays, for consistency with the sibling resets beside it, but the row is replaced by a test that pins the invariant making it unnecessary: "a failed pending never carries the queued flag". If a later change makes that state reachable, the test reds and the reset earns its place back. |

- [ ] **Step 6: Commit**

```bash
git add pwa/src/stores/session.ts pwa/test/stores.test.ts
git commit -m "fix(chat): a message typed into a busy session stops vanishing

The optimistic bubble was deleted five seconds after the API accepted it, which
a busy session cannot possibly beat — it queues the message and echoes it later.
Five seconds now marks the pending queued; the deletion moves to a ten-minute
horizon so a slash command, whose echo never matches, still has a terminal
condition. A flag rather than a state, because ChatList renders anything that is
not 'sending' as a failure and that file belongs to #152.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `ccd` learns the fork

The registry uuid is the authority — it is what `--resume` reads after a restart, and what the hookstate gate compares against. `_sync_uuid` reads the PANE pid's sessions file, and the fork publishes its own under a different pid, so the registry never learns.

**Files:**
- Modify: `ccd/ccd` (inside `_sync_uuid`, plus two new helpers immediately above it)
- Test: Create `server/test/ccd-sync-uuid.test.ts`

**Interfaces:**
- Consumes: `_cfg_dir`, `_reg_get`, `_reg_set`, `_ws_realpath` (all existing in `ccd/ccd`).
- Produces: `_continued_in_of <file> <uuid>` printing a successor uuid or nothing; `_sync_uuid` unchanged in signature.

**Refinement of the spec, recorded as `D-4935`:** the spec says `ccd` walks the chain with a hop bound and a visited set. `ccd` follows **one hop per supervise tick** instead. The read budget below is what forces it — each hop's quiescence has to be observed before its file may be read — and the effect is the same: the chain converges over a few ticks, the per-stamp memo IS the visited set, and a cycle cannot be re-read because its stamps are already in it. The ledger allocator (`POST /api/ledger/deviations`) answered 401 from this box, which holds no box token, so this carries a `D-TBD-` slug and must be reported rather than guessed at.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-sync-uuid.test.ts`, modelled on `server/test/ccd-acct-pool-state.test.ts`:

```ts
// `_sync_uuid` learns the fork. Claude Code 2.1.278 forks a live session into a
// daemon-hosted bg PTY under a NEW sessionId and leaves the pane process
// publishing the OLD one, so the pane-pid read this function has always done
// cannot see it. The registry is the authority — `--resume` reads it — so it
// follows the transcript's own `continued-in` pointer as well.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { mkdirSync, writeFileSync, utimesSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('sync-uuid'); });
afterEach(() => { h.cleanup(); });

const A = 'a'.repeat(36), B = 'b'.repeat(36);
const marker = (from: string, to: string): string =>
  `${JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to })}\n`;
const turnLine = (text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

/** A `tail` stub on PATH that records every invocation — the read budget is a
 *  claim about how often this function reads, so the test measures the reads
 *  rather than trusting the comment. Plant it in the harness's own bin dir, the
 *  way the other ccd suites plant stubs, and read the log back here. */
function plantCountingTail(): void {
  const bin = path.join(h.home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'tail'),
    `#!/bin/sh\necho "$@" >> "${path.join(h.home, 'tail-calls')}"\nexec /usr/bin/tail "$@"\n`,
    { mode: 0o755 });
}
const tailCalls = (): string[] => {
  const f = path.join(h.home, 'tail-calls');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
};

const W = 'claude';               // a home-able wrapper from the fixture roster —
                                  // read ccd-acct-pool-state.test.ts for the constant
const ID = 'demo-quiet-basin';

/** The registry row, written through ccd's own setter so this test encodes no
 *  registry layout of its own. */
function row(workdir: string, uuid: string): void {
  h.sh(`_reg_set ${ID} wrapper ${W}; _reg_set ${ID} workdir ${workdir}; _reg_set ${ID} uuid ${uuid}`);
}

/** The project directory Claude Code would write under, asked of ccd rather
 *  than re-derived here — `_munge_wd` is the one spelling of that rule. */
function projectDir(workdir: string): string {
  const cfg = h.sh(`_cfg_dir ${W}`);
  return path.join(cfg, 'projects', h.sh(`_munge_wd "$(_ws_realpath "${workdir}")"`));
}

/** Plant a transcript and age it, so a single tick sees a file that is not
 *  growing. `utimesSync` alone is what makes quiescence testable without
 *  sleeping. */
function plant(workdir: string, uuid: string, body: string): string {
  const d = projectDir(workdir);
  mkdirSync(d, { recursive: true });
  const f = path.join(d, `${uuid}.jsonl`);
  writeFileSync(f, body, 'utf8');
  const old = Date.now() / 1000 - 600;
  utimesSync(f, old, old);
  return f;
}

/** BOTH TICKS IN ONE PROCESS. The quiescence memo lives in shell variables,
 *  and `ccd supervise` is one long-lived process per session — two separate
 *  `h.sh` calls are two processes and would never see a second tick at all. */
const ticks = (n: number): string =>
  h.sh(Array.from({ length: n }, () => `_sync_uuid ${ID}`).join('; '));

describe('_continued_in_of', () => {
  it('prints the successor named by the last line', () => {
    const f = plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe(B);
  });

  it('prints nothing for a file whose last line is another record', () => {
    const f = plant('/w', A, `${marker(A, B)}${turnLine('after')}`);
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('prints nothing for a marker another session wrote', () => {
    const f = plant('/w', A, marker('c'.repeat(36), B));
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('prints nothing for a half-written last line', () => {
    const f = plant('/w', A, marker(A, B).slice(0, 40));
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });

  it('prints nothing when the successor is the file\u2019s own uuid', () => {
    const f = plant('/w', A, marker(A, A));
    expect(h.sh(`_continued_in_of ${f} ${A}`)).toBe('');
  });
});

describe('_sync_uuid follows a fork', () => {
  it('leaves the registry alone on the first sight of a transcript', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    ticks(1);
    expect(h.reg(ID, 'uuid')).toBe(A);    // the first tick only records the stamp
  });

  it('writes the successor uuid on the second tick, once the file has proven quiescent', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(B);
  });

  it('never follows a transcript that is still growing', () => {
    row('/w', A);
    const f = plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, turnLine('two'));
    // One tick, then the file moves, then another: the stamps never match, so
    // the tail is never read and the registry never moves.
    h.sh(`_sync_uuid ${ID}; touch -m "${f}"; _sync_uuid ${ID}`);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('writes nothing when the successor transcript does not exist', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('writes nothing when the successor exists but is empty', () => {
    row('/w', A);
    plant('/w', A, `${turnLine('one')}${marker(A, B)}`);
    plant('/w', B, '');
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('writes nothing when the registry names a uuid with no transcript at all', () => {
    row('/w', A);
    ticks(2);
    expect(h.reg(ID, 'uuid')).toBe(A);
  });

  it('reads one tail per quiescence, not one per tick', () => {
    row('/w', A);
    plant('/w', A, turnLine('one'));       // no marker: nothing to follow, ever
    plantCountingTail();
    ticks(4);                               // four ticks, one quiescence, one read
    expect(tailCalls()).toHaveLength(1);
  });

  it('still mirrors the pane pid\u2019s sessionId first, as it always did', () => {
    // The existing /clear-rotation behaviour must be untouched: plant a
    // sessions/<pid>.json naming a THIRD uuid and assert the registry takes it,
    // with the follow running afterwards and finding nothing to do.
  });
});

`h.sh('<bash>')` sources `ccd` and runs the snippet inside the fixture HOME; `h.reg(id, field)` reads a registry field. Read `ccd-acct-pool-state.test.ts:44-50` for how a case captures rc as well as stdout, and this file's own `makeCcdHarness` header for why every test gets a fresh harness rather than a shared one with a reset.

The last case above is the only one left as prose, because its fixture is the existing pane-pid path this task must not disturb: plant `$(_cfg_dir claude)/sessions/<pid>.json` naming a third uuid, point the tmux stub at the row, and assert the registry takes THAT uuid — the follow runs after it and finds nothing to do. Copy the sessions-file fixture from whichever existing ccd suite already plants one.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-sync-uuid.test.ts
```

Expected: FAIL — `_continued_in_of` is not a function.

- [ ] **Step 3: Implement**

First, single-source the munge. `_transcript_path` spells it
`munged=$(printf '%s' "$workdir" | tr './_' '---')` (`ccd/ccd:4954`) and the new
follow needs the same answer, so extract it rather than writing a second copy —
`server/test/single-definition.test.ts` fails the build on a second spelling of
a value like this, and the test in Step 1 calls the helper by name:

```bash
_munge_wd() {   # workdir -> the project directory name Claude Code writes under
  # The same munge `server/src/munge.ts` applies, spelled once. `_transcript_path`
  # and `_follow_continued_in` both ask this question and must not answer it
  # twice: a session whose transcript is looked up under one spelling and
  # followed under another is a session this fix cannot see.
  printf '%s' "$1" | tr './_' '---'
}
```

and replace `_transcript_path`'s own line with `munged=$(_munge_wd "$workdir")`.

Then, immediately above `_sync_uuid` in `ccd/ccd`:

```bash
# The tail window every reader of the marker uses. Held equal to the server's
# CONTINUATION_TAIL_BYTES (`server/src/transcript/parse.ts`) by
# `server/test/continued-in-parity.test.ts` — three readers, one window, or the
# three disagree about what the last line even is.
CONTINUED_IN_TAIL_BYTES=8192

# Stamps, per session id, for the read budget below. `ccd supervise` is one
# long-lived process per session, so these are already per-session state and
# need no registry file; a supervisor restart forgets them and costs one extra
# read, never a wrong answer.
declare -A _CI_LAST=()   # id -> the stamp seen on the PREVIOUS tick
declare -A _CI_READ=()   # id -> the stamp whose tail has already been read

_continued_in_of() {   # file uuid -> the successor uuid on the file's LAST line, or nothing
  # Claude Code's own statement about itself, checked field by field because it
  # is data off a disk other processes write. `sessionId` is checked when
  # present and ignored when absent (absence-permits); a successor that is not
  # a uuid, or is this file's own uuid, is refused.
  local f="$1" uuid="$2" last claims next
  last=$(tail -c "$CONTINUED_IN_TAIL_BYTES" -- "$f" 2>/dev/null \
         | grep -v '^[[:space:]]*$' | tail -1) || return 0
  [[ "$last" == *'"type":"continued-in"'* ]] || return 0
  claims=$(printf '%s' "$last" | grep -oE '"sessionId":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4)
  [[ -z "$claims" || "$claims" == "$uuid" ]] || return 0
  next=$(printf '%s' "$last" | grep -oE '"continuedInSessionId":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4)
  [[ -n "$next" && "$next" != "$uuid" ]] || return 0
  printf '%s' "$next"
}

_follow_continued_in() {   # id cfg — one hop per tick, on a quiescence-gated read budget
  # WHY ONE HOP AND WHY GATED (D-4935). `_transcript_path` costs
  # ~36 ms — D-2444 measured it at ~14x the pane classifier and stopped paying
  # it every five seconds across the fleet — so this stats the direct address
  # instead and reads nothing at all in the common case. The marker can only be
  # the final line of a file that will never be appended to again, so the tail
  # read waits for the file to STOP changing: one stat per tick, and one 8 KiB
  # read per quiescence. A busy session pays nothing; a frozen one pays once.
  # A chain of forks therefore converges over a few ticks rather than in one
  # call, and the per-stamp memo IS the visited set — a cycle cannot be
  # re-read, because its stamps are already in it.
  local id="$1" cfg="$2" wd uuid munged f st prev next
  wd=$(_reg_get "$id" workdir); [[ -n "$wd" ]] || return 0
  uuid=$(_reg_get "$id" uuid); [[ -n "$uuid" ]] || return 0
  wd=$(_ws_realpath "$wd")
  munged=$(_munge_wd "$wd")
  f="$cfg/projects/$munged/$uuid.jsonl"
  [[ -f "$f" ]] || return 0
  st=$(stat -c '%s:%Y' -- "$f" 2>/dev/null) || return 0
  prev="${_CI_LAST[$id]:-}"
  _CI_LAST["$id"]="$st"
  [[ "$st" == "$prev" ]] || return 0                 # still growing — look again next tick
  [[ "$st" == "${_CI_READ[$id]:-}" ]] && return 0    # this exact file has already been read
  _CI_READ["$id"]="$st"
  next=$(_continued_in_of "$f" "$uuid")
  [[ -n "$next" ]] || return 0
  [[ -s "$cfg/projects/$munged/$next.jsonl" ]] || return 0   # announced but not yet written
  _reg_set "$id" uuid "$next"
  return 0
}
```

Then in `_sync_uuid`, keep the pane read exactly as it is but stop returning early from it, and follow afterwards:

```bash
_sync_uuid() {   # id — mirror the live process's CURRENT sessionId into the registry.
  # … existing comment block, plus:
  #
  # TWO SOURCES, IN THIS ORDER. The pane pid's sessions file is what catches a
  # `/clear` rotation and stays first. The transcript's own `continued-in`
  # pointer is what catches a FORK — Claude Code 2.1.278 forks a live session
  # into a daemon-hosted bg PTY under a new sessionId and leaves the pane
  # process publishing the old one, so the pane file cannot see it, and the
  # registry then names a transcript nobody will ever write to again.
  local id="$1" cfg pid sid
  cfg=$(_cfg_dir "$(_reg_get "$id" wrapper)"); [[ -n "$cfg" ]] || return 0
  pid=$(tmux list-panes -t "$(_tmux "$id")" -F '#{pane_pid}' 2>/dev/null | head -1)
  if [[ -n "$pid" && -f "$cfg/sessions/$pid.json" ]]; then
    sid=$(grep -oE '"sessionId":"[0-9a-f-]{36}"' "$cfg/sessions/$pid.json" | head -1 | cut -d'"' -f4)
    [[ -n "$sid" && "$sid" != "$(_reg_get "$id" uuid)" ]] && _reg_set "$id" uuid "$sid"
  fi
  _follow_continued_in "$id" "$cfg"
  return 0
}
```

`_munge_wd` is the only spelling of the munge in this file after this task, and its body is pure bash (no `tr` fork on a path walked every tick by every session): confirm with `grep -n "tr './_'" ccd/ccd`, which must return ZERO lines, and with a scan for the character class, which must appear exactly once.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccd-sync-uuid.test.ts
cd server && ./node_modules/.bin/vitest run test/ccd-bounded-reads.test.ts test/ccd-session-state.test.ts
```

Re-run any red one IN ISOLATION before calling it a break — both are on the known-flake list.

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| drop the `[[ "$st" == "$prev" ]]` gate | "never reads the tail of a transcript that is still growing" |
| drop the `_CI_READ` gate | "re-reads nothing on a third tick" |
| drop the `-s` check on the successor | "writes nothing when the successor transcript does not exist" |
| drop the `claims` check in `_continued_in_of` | "prints nothing for a marker another session wrote" |
| move `_follow_continued_in` above the pane read | "the pane's stale sessionId does not undo a chain the follow just wrote" — the ONLY fixture that discriminates order, because in every other shape both orders answer the same uuid. Measured: without it the mutation reds nothing. |

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-sync-uuid.test.ts
git commit -m "fix(ccd): _sync_uuid follows a forked session to its new transcript

The pane pid's sessions file cannot see a fork — the fork publishes its own,
under its own pid — so the registry kept naming a transcript nobody would write
to again, and --resume time-travelled the session to the pre-fork point. It now
also follows the transcript's own continued-in pointer, one hop per tick, on a
read budget that costs a busy session nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The hook attributes a session with no pane

`ccd/session-hook.sh` exits immediately for a forked session, so the ask card, the subagent list and the compaction card all go dark for exactly the sessions that need them. It learns WHICH ccd session it is from the tmux session name, and a fork has no pane to ask — so widening the guard alone changes nothing.

**Files:**
- Modify: `ccd/session-hook.sh` (the guard at line ~2741 and the identity block below it)
- Test: `server/test/session-hook.test.ts`

**Interfaces:**
- Consumes: Task 6's registry, which must already know the new uuid.
- Produces: no new exports.

**Ordering:** this task lands after Task 6. Until the registry knows the new uuid there is nothing to match against, and for the few seconds between a fork and the next supervise tick the hook writes nothing — the same honest silence it has today.

- [ ] **Step 1: Write the failing tests**

This file's `run(payload, env)` already defaults `TMUX_PANE: '%1'` and
`CLAUDE_CODE_SESSION_ID: 'uuid-1'`, and its `beforeEach` plants a `tmux` stub
answering `cc-demo-quiet-basin`. A pane-less session is `run(…, { TMUX_PANE: '' })`
— `${TMUX_PANE:-}` reads an empty value exactly as it reads an unset one.

```ts
const REG = (): string => path.join(home, '.cc-sessions');
const hookstate = (id: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(REG(), `${id}.hookstate.json`), 'utf8'));
const planted = (id: string, uuid: string): void =>
  fs.writeFileSync(path.join(REG(), `${id}.uuid`), uuid);

describe('a session with no pane', () => {
  it('writes hookstate when the registry names its session id as its own', () => {
    planted('demo-quiet-basin', 'uuid-1');
    run({ hook_event_name: 'UserPromptSubmit' }, { TMUX_PANE: '' });
    expect(hookstate('demo-quiet-basin')).toMatchObject({ sessionId: 'uuid-1', state: 'working' });
  });

  // The guard, stated in the other direction. This is what the TMUX_PANE check
  // was protecting: a Claude session on this box that ccd does not own must
  // still be attributed to nobody.
  it('writes nothing when no registry row names its session id', () => {
    planted('demo-quiet-basin', 'uuid-someone-else');
    run({ hook_event_name: 'UserPromptSubmit' }, { TMUX_PANE: '' });
    expect(fs.existsSync(path.join(REG(), 'demo-quiet-basin.hookstate.json'))).toBe(false);
  });

  it('writes nothing when it has no session id to be attributed by', () => {
    planted('demo-quiet-basin', 'uuid-1');
    run({ hook_event_name: 'UserPromptSubmit' }, { TMUX_PANE: '', CLAUDE_CODE_SESSION_ID: '' });
    expect(fs.existsSync(path.join(REG(), 'demo-quiet-basin.hookstate.json'))).toBe(false);
  });

  it('still prefers the pane when there is one', () => {
    // Two rows: the pane names one, the session id matches the OTHER. The pane
    // wins, so the fallback can never quietly re-attribute a live session.
    planted('demo-quiet-basin', 'uuid-pane');
    planted('other-row', 'uuid-1');
    run({ hook_event_name: 'UserPromptSubmit' });
    expect(fs.existsSync(path.join(REG(), 'demo-quiet-basin.hookstate.json'))).toBe(true);
    expect(fs.existsSync(path.join(REG(), 'other-row.hookstate.json'))).toBe(false);
  });

  it('is silent on both streams, and exits 0, with no pane and no match', () => {
    // The file's own header contract. Use this suite's stdout+stderr runner
    // (the one its comment calls out as asserting exit 0 once) rather than `run`.
    expect(runBoth({ hook_event_name: 'UserPromptSubmit' }, { TMUX_PANE: '' }))
      .toMatchObject({ stdout: '', stderr: '' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts -t 'pane-less'
```

Expected: FAIL — nothing is written.

Note: five `session-hook.test.ts` failures on this box are environmental (the `strace` family; `strace`, `make` and `gcc` are absent). Confirm the baseline before and after so an environmental red is not read as a break.

- [ ] **Step 3: Implement**

Replace the bare guard with a two-source identity block. Keep the tmux path first and unchanged — it is the common case and it costs one bounded call:

```bash
# TWO SOURCES FOR ONE QUESTION: which ccd session is this?
#
# The pane is the ordinary answer and stays first. It is not the only one: a
# session that Claude Code has FORKED into a daemon-hosted background PTY has
# no TMUX and no TMUX_PANE at all (measured via /proc/<pid>/environ), so this
# hook exited at once for exactly the sessions whose ask card, subagent list
# and compaction card matter most — a real session wrote its last hookstate
# two minutes before its fork and then nothing for three hours of active
# work.
#
# The fallback is the session's OWN id, matched against the registry. That
# keeps the guard's whole purpose intact: attribution stays POSITIVE and
# measured — this hook writes for a session only when the registry itself names
# that uuid as its own — so a stranger's Claude session on this box exits 0
# exactly as it does today. What it must never become is the registry's WRITER.
# `ccd` decides the uuid (`_sync_uuid`); this only reports against it.
id=""
if [[ -n "${TMUX_PANE:-}" ]]; then
  # … today's bounded `tmux display-message -p '#S'` block, unchanged …
  [[ "$tname" == cc-?* ]] && id="${tname#cc-}"
fi
if [[ -z "$id" && -n "${CLAUDE_CODE_SESSION_ID:-}" && -d "$REG" ]]; then
  for u in "$REG"/*.uuid; do
    [[ -e "$u" ]] || continue
    [[ "$(cat "$u" 2>/dev/null)" == "$CLAUDE_CODE_SESSION_ID" ]] || continue
    id=$(basename "$u" .uuid)
    break
  done
fi
[[ -n "$id" ]] || exit 0
[[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || exit 0
[[ -d "$REG" ]] || exit 0
```

The scan is ~20 small files and runs only on the path that has no pane, so the hot path — every tool call in every live session — pays nothing new.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts
```

Expected: the four new cases PASS; the environmental `strace` family is unchanged from the baseline.

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| drop the registry match (attribute on `CLAUDE_CODE_SESSION_ID` alone) | "writes nothing for a pane-less session no registry row names" |
| put the fallback before the tmux path | "still prefers the pane when there is one" |
| drop the `[[ -n "$id" ]] || exit 0` | "writes nothing when the registry is unreadable" |

- [ ] **Step 6: Commit**

```bash
git add ccd/session-hook.sh server/test/session-hook.test.ts
git commit -m "fix(hook): a forked session is attributed by uuid, not by its pane

A session Claude Code forks into a background PTY has no TMUX_PANE, so the hook
exited at once and the ask card, subagent list and compaction card went dark for
exactly the sessions that needed them. It now falls back to matching its own
session id against the registry — positive, measured attribution, so a
stranger's session still writes nothing. The hook reports; ccd decides.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The operator's signal, and the parity that keeps three readers honest

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (one table entry, one function)
- Test: `server/test/ccrc-doctor.test.ts`
- Create: `server/test/continued-in-parity.test.ts`

**Interfaces:**
- Consumes: `CONTINUATION_TAIL_BYTES` (Task 1) as the number the parity test holds all three readers to. NOT `_continued_in_of` — `ccrc` does not source `ccd`, so this file needs its own reader.
- Produces: `_check_transcripts`, and `transcripts` in `CCRC_DOCTOR_CHECKS`.

- [ ] **Step 1: Write the failing tests**

In `server/test/ccrc-doctor.test.ts`:

```ts
  it('passes on a registry whose sessions all read a live transcript', () => {
    // fixture HOME, two sessions, no markers -> "PASS transcripts:"
  });

  it('warns and names the session reading a superseded transcript', () => {
    // plant a marker on one -> "WARN transcripts:" and the id in the line
  });

  it('passes vacuously on a box with no sessions', () => {
    // the doctor's own healthy fixture has no registry; a SKIP there is a check
    // that cannot be counted (`_check_routing`'s rule)
  });

  it('fails when the registry cannot be searched', () => {
    // chmod 000 -> FAIL, matching `_check_pools`' verdict for the same fact
  });
```

Create `server/test/continued-in-parity.test.ts`:

```ts
// THREE READERS, ONE MARKER. `continuationOf` (TypeScript), `_continued_in_of`
// (ccd) and the doctor check each decide what a `continued-in` line is, and
// bash cannot import TypeScript. So the constants and the literals are pinned
// equal here — the same shape `pool-name-parity.test.ts` uses for the pools
// directory name, and for the same reason: a drift in one of three spellings
// is a reader that disagrees with the thing it exists to agree with.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CONTINUATION_TAIL_BYTES } from '../src/transcript/parse.js';

const ccd = readFileSync(new URL('../../ccd/ccd', import.meta.url), 'utf8');
const doctor = readFileSync(new URL('../../ccd/ccrc-doctor-checks', import.meta.url), 'utf8');

describe('continued-in parity', () => {
  it('ccd uses the same tail window as the server', () => {
    const m = /^CONTINUED_IN_TAIL_BYTES=(\d+)$/m.exec(ccd);
    expect(m?.[1]).toBe(String(CONTINUATION_TAIL_BYTES));
  });

  it('every reader matches the same record type and field', () => {
    for (const src of [ccd, doctor]) {
      expect(src).toContain('"type":"continued-in"');
      expect(src).toContain('continuedInSessionId');
    }
  });

  it('the doctor check reads the marker through ccd’s own reader, not a third copy', () => {
    expect(doctor).toContain('_continued_in_of');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/continued-in-parity.test.ts
```

Expected: FAIL — the check table and the functions disagree (`ccrc-doctor.test.ts`'s first case), and the parity file finds no `CONTINUED_IN_TAIL_BYTES`.

- [ ] **Step 3: Implement**

Add `transcripts` to `CCRC_DOCTOR_CHECKS`, after `pool-sync`, and:

```bash
# THE THIRD READER OF THE MARKER, and it has to be its own. This file is
# sourced by `ccrc`, which does not source `ccd`, so `_continued_in_of` is not
# in scope here — the same constraint that makes this file spell
# `$HOME/.cc-sessions` rather than borrow `$REG`. It asks a narrower question
# than ccd's reader (is the last line this file's own continued-in marker?) and
# answers by exit code, and `server/test/continued-in-parity.test.ts` holds its
# literals and its window equal to the other two.
CONTINUED_IN_TAIL_BYTES=8192
_dr_continued_in() {   # file uuid -> 0 when the file's last line supersedes it
  local f="$1" uuid="$2" last claims
  last=$(tail -c "$CONTINUED_IN_TAIL_BYTES" -- "$f" 2>/dev/null \
         | grep -v '^[[:space:]]*$' | tail -1) || return 1
  case "$last" in *'"type":"continued-in"'*) ;; *) return 1 ;; esac
  case "$last" in *'"continuedInSessionId":"'*) ;; *) return 1 ;; esac
  claims=$(printf '%s' "$last" | grep -oE '"sessionId":"[0-9a-f-]{36}"' | head -1 | cut -d'"' -f4)
  [ -z "$claims" ] || [ "$claims" = "$uuid" ] || return 1
  return 0
}

_check_transcripts() {
  # THE MEASUREMENT THIS WHOLE FIX IS ACCOUNTABLE TO. Claude Code forks a live
  # session into a background PTY under a new sessionId and writes a
  # `continued-in` pointer as the last line of the transcript it abandons; a
  # registry that has not followed it names a file nobody will write to again,
  # and the operator's chat freezes. Two of fourteen sessions were in that state
  # on 2026-09-20. This counts them, and it must read 0.
  #
  # SILENT IN THE CHAT, VISIBLE HERE (operator's choice, 2026-09-20). The chat
  # says nothing because there is nothing to say — the conversation continued
  # and the operator is reading it. This is where the drift shows.
  #
  # `$HOME/.cc-sessions` is spelled out, not taken from another tool's variable:
  # this file is sourced under `set -u` by things that are not `ccrc`. Same rule
  # `_check_pools` states for the pools directory.
  local reg="$HOME/.cc-sessions" sh="$HOME/.ccrc/accounts.sh" u id uuid cfg wd munged f stale="" n=0
  # `_ccrc_cfg_dir` is NOT in this file's scope by default — it comes from the
  # roster projection, which `_check_routing` and the `skills` check both source
  # before they use it, each guarding with `declare -F`. Same idiom here.
  # An unreadable projection WARNs rather than FAILs: a broken roster is the
  # `wrappers` check's subject, and this one has simply not measured anything.
  # shellcheck disable=SC1090
  . "$sh" 2>/dev/null
  if ! declare -F _ccrc_cfg_dir >/dev/null 2>&1; then
    _dr_warn transcripts "could not read the roster projection at \$HOME/.ccrc/accounts.sh, so no session's config dir can be resolved" \
      "re-run ccrc install to regenerate it — the wrappers check owns the roster's health"
    return 2
  fi
  if [ -e "$reg" ] && [ ! -x "$reg" ]; then
    _dr_fail transcripts "$reg is not a searchable directory, so no session's transcript can be reached" \
      "fix its mode (chmod 700 $reg) — until then nothing on this box can measure which session reads what"
    return 1
  fi
  for u in "$reg"/*.uuid; do
    [ -e "$u" ] || continue
    id=$(basename "$u" .uuid)
    uuid=$(cat "$u" 2>/dev/null) || continue
    [ -n "$uuid" ] || continue
    n=$((n + 1))
    # This check runs OUTSIDE ccd — it is sourced under `set -u` by things that
    # are not `ccrc` — so it reads the row's own fields rather than calling
    # ccd's helpers, and it asks ccd for nothing it can read itself.
    cfg=$(_ccrc_cfg_dir "$(cat "$reg/$id.wrapper" 2>/dev/null)" 2>/dev/null) || continue
    [ -n "$cfg" ] || continue
    wd=$(cat "$reg/$id.workdir" 2>/dev/null) || continue
    [ -n "$wd" ] || continue
    munged=$(printf '%s' "$wd" | tr './_' '---')
    f="$cfg/projects/$munged/$uuid.jsonl"
    [ -f "$f" ] || continue
    if _dr_continued_in "$f" "$uuid"; then stale="$stale $id"; fi
  done
  if [ -n "$stale" ]; then
    # shellcheck disable=SC2086 -- the ids are registry basenames, matched by
    # ccd's own `^[A-Za-z0-9._-]+$` shape, so the split is the interface.
    _dr_warn transcripts "$(_dr_join $stale) read a transcript Claude Code has superseded ($n session(s) measured)" \
      "a session that forked in the last few seconds is a real transient and clears itself on the next supervise tick; if it persists, this box's ccd is not following the pointer — check ccrc version and roll the fleet box forward"
    return 2
  fi
  _dr_pass transcripts "$n session(s): every registry uuid names a transcript Claude Code has not superseded"
  return 0
}
```

A registry with no sessions reaches the final line with `n=0` and passes in those words — vacuously, never a SKIP.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts test/continued-in-parity.test.ts
cd server && ./node_modules/.bin/vitest run
```

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| remove `transcripts` from the table but keep the function | `ccrc-doctor.test.ts`'s table/function agreement case |
| make the stale arm `_dr_pass` | "warns and names the session reading a superseded transcript" |
| make the empty registry a `_dr_skip` | "passes vacuously on a box with no sessions" |
| change `CONTINUED_IN_TAIL_BYTES` in `ccd/ccd` only | `continued-in-parity.test.ts` |
| change it in `ccrc-doctor-checks` only | same file, the doctor case |
| add a fourth reader in any tracked file | "exactly three readers exist" |

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/continued-in-parity.test.ts
git commit -m "feat(doctor): count the sessions reading a superseded transcript

Two of fourteen were, on 2026-09-20, one of them for eight days. The check must
read 0, and the parity suite holds the three readers of the marker — TypeScript,
ccd and this check — to one window and one record shape.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deviations found

(Numbers are ISSUED by the allocator and defined here in the same act — the block `D-4935`…`D-4939` was minted for this project on 2026-10-13, as the THIRD block (both earlier ones collided; see below). Review round 1 added `D-4940`…`D-4954`, issued the same way; review round 2 allocated nothing and amends those definitions in place, each amendment marked "Review round 2" inside the bullet it changes. Bullets, not a table: `deviation-refs.test.ts`'s high-water reads a definition line, and a table cell is not one.)

- **D-4935** — The spec has `ccd` walk the continuation chain with a hop bound and a visited set within one call; Task 6 follows **one hop per supervise tick** instead, because each hop's quiescence must be observed before its file may be read. Same end state, and the per-stamp memo is the visited set. The resume path is the exception (D-4944): at a spawn or a carry the pane, the only writer of those files, is dead, so `_ci_chain_end` takes every hop in one call.
- **D-4936** — The brief's own `_continued_in_of` piped `tail -c` into `grep` into a second `tail -1`, which invokes `tail` TWICE per examination and so fails the read-budget test the same task ships. The last non-empty line is taken with bash parameter expansion instead — one `tail` per quiescence, which is what the budget actually promises. Found by the Task 6 implementer while measuring. Mechanism superseded by D-4940 (re-review DOC-4): `_continued_in_of` now pipes the `tail -c` window straight into jq and has no last-line step at all. The budget it protected, one `tail` per examination, still holds and is still pinned ("reads one tail per quiescence, not one per tick").
- **D-4937** — The mutation "move `_follow_continued_in` above the pane read" went red nowhere, because no fixture combined a live pane-pid answer with a live continuation chain. It is not cosmetic: with the chain first, a pane still publishing the OLD id overwrites the successor the chain just wrote, every tick, and the registry never converges. Pinned by a fixture where the pane's sessions file still names the pre-fork uuid. Review round 2 (re-review DOC-3): the order stopped being load-bearing once the pane-novelty guard landed, and on this tree that guard is D-4943's `_ci_pane_refused`: the pane's pre-fork id is refused while its transcript is measured superseded, whichever of the two statements runs first. The mutation that moves the chain above the pane read is green again, the fixture's own comment says the order is redundant, and the fixture now pins the guard, not the order. Pane read first is kept because a `/clear` is the ordinary case.
- **D-4938** — Pre-existing, found by Task 5's review and reproduced empirically: `dispatch` replaces the `timers` MAP ENTRY without clearing the old `setTimeout`, so a re-send through `resolve`/`retry` leaves the superseded cycle's deadline armed and it later deletes a pending that is legitimately back in flight — the "message vanishes while waiting" defect through the rescue path. The five-second horizon made it rare, not absent. Fixed by one `arm()` helper both arming sites go through.
- **D-4939** — Pre-existing: `clearConfirmed` drops a pending without cancelling its timer. Harmless at five seconds, a real per-message leak at the ten-minute horizon Task 5 introduces, and the timer is now the thing that ends the bubble — so Task 5 makes `clearConfirmed` report the keys it dropped and cancels them.

**All five were ISSUED, never guessed at.** `POST /api/ledger/deviations` minted the contiguous block `D-4935`…`D-4939` for this project on 2026-10-13, and the bullets above DEFINE each in the same act — allocate-and-define, as D13 requires.

**THE FIRST BLOCK COLLIDED, AND THE COLLISION IS THE POINT.** On 2026-09-20 this plan was
issued `D-3164`…`D-3168`. On 2026-09-22 `docs/superpowers/plans/2026-09-22-gpt-lane-ownership-2b1-placement.md`
DEFINED the same five numbers, from a different contributor's registry. Neither side did anything wrong by the
documented rule: each was ISSUED its block by an allocator, and both allocators seed their floor from the same
merged tree, so both minted the same next block. `deviation-refs.test.ts` caught it on the merge with `main` —
BEFORE the merge, which is the whole reason that scan compares against `origin/main` without merging — and this
plan renumbered, because the other block was already on `main` and this one was not. The first five are burned:
they were allocated, never landed, and the floor they raised never comes back down.

**Renumbering is not a fix, and this note exists so the next reader does not mistake it for one.** The two
registries are still seeded from one tree and will still agree on the next free number. What the maintainer said
when this was put to him (2026-09-20) was that `CLAUDE.md` needs amending so the ids are not used this way; that
amendment has not landed, and the paragraph above it still claims ONE global namespace. Until it does, a branch
that holds numbers for more than a few days should expect to renumber, and the cheap guard is to allocate LATE
and merge PROMPTLY.

The allocator's route had answered 401 until the first block was issued (2026-09-20), and the reason is worth keeping, because the next box to hit it will read the same 401 and reach the same wrong conclusion this plan did. **Nothing was missing from another box.** The box token is minted LOCALLY (`openssl rand -hex 32`), one per box, and none existed here: the server reads `~/.ccrc/mail.token`, `ccrc-api` reads `~/.cc-secrets/ccrc-mail.token`, and on a `--role both` box those two paths must hold the SAME secret. `ccrc-api` also refuses rather than guessing a host, so `~/.ccrc/agent.env` has to name `CCRC_SERVER_URL`. The server reads the token once at boot, so it takes a restart to see one.

The floor the first block was cut from is **3164**, and it read **1847** until the box's own main checkout was pulled. That is not a broken ledger: `sweepLedgerFloor` seeds from the working tree at `projectsRoot/<project>`, that checkout stood two weeks behind `origin/main`, and its highest `D-<n>` was exactly the 1797 the 50-number gap sat on top of. A stale checkout is a low floor, and a low floor is the one thing that can re-issue a number.

**There is no project-wide registry and none is needed.** Each fleet's server holds its own — `deploy/ccrc-agent.env.example` says "this fleet's ccrc server", and the project's other contributor confirmed the same independently. What catches two branches that each took the same number is `server/test/deviation-refs.test.ts`, which compares this branch against `origin/main` WITHOUT merging, before the merge that would otherwise decide it. Take numbers late and merge promptly; that, not a shared allocator, is the anti-collision mechanism.

**AND THE SECOND BLOCK COLLIDED TOO (2026-10-13).** The block above was first issued as `D-3562`…`D-3566` on
2026-09-27. While this branch waited for review, `docs/superpowers/plans/2026-09-29-worker-stall-watch-w1.md`
DEFINED the same five numbers on `main`, and `deviation-refs.test.ts`'s cross-tree scan caught it again at the
review-round merge. The block was renumbered to `D-4935`…`D-4939`, issued by the allocator on 2026-10-13, with the
meanings unchanged — exactly what the paragraph above predicts for a branch that holds its numbers for weeks.

### Review round 1 (2026-10-13)

(An adversarial review of the merged tree found five major and eleven minor defects; each fix that departs from the
spec or the tasks is a deviation. The allocator issued `D-4940`…`D-4954` on 2026-10-13 as one block, defined here in
the same act.)

- **D-4940** — The spec required one marker parser, so "two readers can never disagree about what counts as a marker"; the three readers shipped three rules. ccd's `_continued_in_of` and the doctor's `_dr_continued_in` matched substrings anywhere on the LAST line, so a marker-shaped object in a tool call's input read as a marker and ccd moved the registry onto a session the operator was not in while the server refused it (review F1); and all three read only the last line, while Claude Code re-stamps metadata after the marker at exit, so a real marker read as absent and a supervisor restart let the stale pane id back (review ccd-last-line-only-marker). The rule is now Claude Code 2.1.296's own reader (`Txn`/`I`/`d8e`, read from the binary and confirmed on the fleet's build): the 8 KiB window newest line first behind its three compact literal prefilters; a top-level `continued-in` record with a string successor decides, naming it only when its `sessionId` is absent or this file's and the successor is a lowercase uuid other than the file's own; a FINISHED turn decides "none" — an assistant record with a string `stop_reason` that is not an API error, or a user record that is a prompt (not meta, not a compact summary, no tool result, a text that is not empty, a command echo, a leading tag or an interruption notice); everything else is stepped over. It lives in `tailRecordOf`/`continuationInTail` (TypeScript) and one jq program, `CONTINUED_IN_JQ`, byte-equal in `ccd/ccd` and `ccd/ccrc-doctor-checks`; `continued-in-parity.test.ts` runs all three readers over one table, and the jq program over the same table on every jq it finds. The review of the first cut found two defects in it, both fixed here: on jq 1.6 (this codebase's floor) a `try` inside `first()` swallowed its break, so an older marker behind a user turn won (now collected, never `first()`, pinned by spelling and by the jq 1.6 run); and stopping at ANY user/assistant record declined follows Claude Code makes, past exactly the records most likely to land after a fork. Recorded divergences from Claude Code, each a declined follow: a text holding a `<pasted_content>` literal is a prompt without being unwrapped; a present `sessionId` must be the file's own; uppercase successors are refused; the window is 8 KiB, not 64. Recorded divergence between the readers: on jq before 1.8 a line nested deeper than 256 does not parse, so a finished turn that deep after a marker stops the server but not ccd or the doctor. Lone surrogate escapes, which every jq refuses and `JSON.stringify` writes, are rewritten and re-parsed. ccd gains its first jq call, once per quiescence; a read that fails is retried on D-4942's backoff. Review round 2: `parse.ts` gains `finishedTurnDecides` (D-4946), which runs the same newest-first scan to ask the stream's un-follow question (is the deciding line a finished turn?). It is not a fourth reader of the marker: `continuationInTail` and `tailRecordOf` are unchanged, and so are the parity tables. `continuationOf`, one line's verdict, is a thin wrapper over `tailRecordOf` that only its own unit test calls; no live reader uses it.
- **D-4941** — The doctor's `transcripts` check claimed measurements it had not made, or prescribed remedies that could not work. A failed tail read (unreadable file, EIO, no `tail`/`jq`) answered like "not superseded" and was counted inside the clean PASS (review F2); `_dr_continued_in` now answers 2 for "not measured", counted and explained apart. The unlistable-registry guard tested only `-x`, so a registry at 0300 globbed to nothing and took the vacuous PASS (review F3); it now uses the file's own `-e||-L` and `!-d||!-r||!-x` idiom — and a registry path that is not a directory at all (a file, a dangling symlink) gets a remedy that can clear the FAIL instead of a `chmod`. The WARN remedy told a stopped or archived row it "clears itself on the next supervise tick", though nothing ticks such a row; parked rows are now named apart, with a remedy saying ccd follows them at their next resume (D-4944). Review round 2 (DR1, DR2): the check opened each row's `.uuid`, `.wrapper` and `.workdir` with only an `[ -e ]` on the `.uuid` and in the `< f 2>/dev/null` order, so a FIFO or a device node at any of them blocked the doctor in open(2) — and with it `ccrc install` and `ccrc update`, which run the doctor at their tail — and an unreadable or vanished field printed bash's error on stderr and was then explained as the account-swap miss. The three reads now use the file's own idiom (`[ -f ]` first, `{ IFS= read -r x || :; } 2>/dev/null < f`, D-2380's), and a row whose own fields cannot be read or are empty — a `.uuid` that is a dangling symlink included, which the loop's old `-e` guard dropped from the count altogether — or whose wrapper names no account the roster knows, is counted apart with its own reason, never under the account-swap sentence. And a row was called superseded whenever its transcript ended in a valid marker, whether or not ccd would take the hop. ccd follows only to a successor whose transcript is a non-empty file at one of the row workdir's two spellings (the first of them that is a file, resolved first: `_ci_addrs`, `_ci_extant`, then `-s`), so a marker naming a successor that was never written — a background job that failed, was killed before its first line, or was queued and never ran (2.1.296 appends the marker on its queued path too) — got remedies that could not clear it. Such a row is now named apart ("a successor never written here", with the successor), and its remedy says what does clear it: the job's first line, or the first prompt the session answers on its own transcript (a finished turn after the marker, D-4940).
- **D-4942** — The review found that a hop `_follow_continued_in` declined (successor absent or empty) was never retried. `_CI_DONE` was committed before the successor checks, and a marked transcript does not change while its fork runs, so every later tick returned at "already examined". Measured: 20 more ticks still on the pre-fork id after the successor was written. The brief asked for a retry "with a bounded backoff so a quiescent marked file is not tail-read every 5 s forever". The fix for a DECLINE is not a backoff, and the deviation is deliberate. The decline now remembers the successor and its two candidate addresses (`_CI_PEND`, `_CI_PENDNEXT`, `_CI_PENDADDRS`, one entry per id), and `_CI_DONE` stays committed. Later ticks on the same stamp re-ask only the successor, with `[[ -f ]]`/`[[ -s ]]` builtins, so the marked file is read once per stamp, never per tick; the retry costs less than the `stat` the gate already pays. The review's own suggested fix (un-commit `_CI_DONE`) is pinned red by the read-budget test. Review round 2 (RR-4): a read that FAILED is not a verdict either. `_continued_in_of` answered "no marker" when its own read failed — `tail` or `jq` exiting non-zero: a fork refused under memory pressure, a jq the OOM killer took, an EIO, no jq on PATH — because the pipeline's status was never asked and `_CI_DONE` was committed before the read, so one failed read lost the follow for the life of the supervisor (reproduced: a jq that failed once, 20 ticks on the pre-fork id). It now answers rc 2 from `PIPESTATUS`, both sides of the pipe — the doctor's and the server's three-way shape. `_follow_continued_in` commits `_CI_DONE` only after a read that measured something: after a failed one the next quiescent tick reads again, and a read that keeps failing on one stamp is put off on a doubling backoff (the n-th consecutive failure skips 2^(n-1)−1 ticks, capped at 63; `_CI_UNREAD`, one entry per reader and row), so a box with no jq reads a quiescent row about once per five minutes rather than every tick. The backoff is keyed by the stamp both ways: a changed file is read at once, not after the old file's countdown, and its first failure counts from one. The pane id's read (D-4943) is put off on the same backoff. `_ci_pane_refused` refuses the pane's id for that tick without remembering anything (D-4943), and `_ci_chain_end` stops at the last id it measured (`_CI_END_UNREAD`); the supervisor reads such a chain again, for up to three ticks, before it resumes (D-4944), because resuming an unread pre-fork id that does carry a marker appends a finished turn after it and cancels it for good.
- **D-4943** — The restart guard is the pane's own record, not either of the brief's two options. There are two on-disk refusals, both read out of what Claude Code 2.1.296 writes. (1) `parkedJobId`: a left-arrow fork stamps it on the pane's record (`markSessionParked`), and Claude Code's live-holder listing skips a parked interactive record, so a parked pane's id is never new information — across a supervisor restart, and after the pre-fork transcript has gone. (2) An unparked pane whose id has no non-empty transcript under the row's workdir and whose record's `updatedAt` is older than 600 s (`_ci_pane_stale`, second verifier round): 2.1.296 stamps `updatedAt: Date.now()` on every write of the record, a rotation included, so the id a `/clear` mints is named by a fresh record and is never refused. The verifier found the path (1) misses: the left-arrow fork's `claude agents` fallback clears the stamp when it returns. Why not the brief's options: the first ("no transcript, not new information") holds the registry on the cleared conversation through every `/clear`'s first-write window — measured, it reds the existing pane-rotation pin; the second (persist the walk origin) needs a new registry field and stays blind when the stale id is not the origin. Fails open: a record without `updatedAt` is not judged, so the review's literal P2 fixture (`{sessionId, status}`) is still written — it is indistinguishable from an older build's fresh `/clear`. Review round 2 (RR-3): the verdict, not memory. Under D-4940 a finished turn after a marker cancels it, and Claude Code writes one whenever a session goes on in the pre-fork id (an explicit `--resume` does no continued-in check; the `claude agents` fallback hands the pane back unparked). ccd still refused that id for the life of the supervisor — through the walk's origin and visited set, and a `_CI_PANE_DEAD` memo keyed by the id alone — while a restarted supervisor wrote it at once, so the registry depended on how long the supervisor had been up. The pane's id is now judged by `_ci_pane_refused` on the current verdict of its own transcript: `_CI_PANE_DEAD` is keyed by the transcript's stamp (size:mtime), so a changed file is read again; an id the walk remembers is refused while its transcript is measured superseded or is gone (F5: a chain head reaped away has no marker left, and memory is the only witness), and is written once it is measured not superseded — the pane is writing it; a failed read refuses for that tick and keeps no verdict, and a read that keeps failing on one stamp is put off on D-4942's backoff, still refused meanwhile (measured on a box whose jq never works: one tail-and-jq attempt per tick before, about one per five minutes after). Residual: on such a box an unparked pane that disagrees with the registry stays refused until a read of its id succeeds, so a pane `/resume X` there reaches the registry only once jq works again; the chain is not followed on that box either, and `ccrc doctor` FAILs a missing jq. Order and cost: `_ci_pane_parked` first, with builtins, then the stamp-keyed verdict, and a pane that agrees with the registry reaches neither. Measured with PATH shims over 20 ticks: idle and parked rows unchanged at 9.05 execs per tick; a row whose UNPARKED pane sits on a superseded id pays one stat pair more (11.05, was 9.05) — the price of re-measuring instead of remembering.
- **D-4944** — Every resume follows the continued-in chain before it resumes. `_spawn_start` is the only `--resume` builder, and `cmd_swap` follows before its carry, in the source account. Unlike D-4935's one hop per tick, `_ci_chain_end` takes every hop in one call, with no quiescence gate — at a spawn or a carry the pane, the only writer of those files, is dead — within the supervise walk's bounds: `_CI_WALK_CAP` hops, a visited set, and a successor that exists, non-empty, under the row's workdir. A holder is live by Claude Code's own rule (`Dw`): `kill -0`, plus the recorded `procStart` equal to `ps -o lstart=` under `LC_ALL=C TZ=UTC` when both exist, so a recycled pid is not a holder. Review round 2 (RR-1): the registry only ever names a written id. The second verifier round (P3/P3b) took a successor not yet written as the walk's end when its job held it — a live `kind:"bg"` record naming it by id or by `jobId == successor[0:8]`, or `<cfg>/jobs/<short>/state.json` not over and written within 120 s (measured on a real handoff: the state file predates the marker by about 0.5 s and the worker's record trails it by about 1 s) — and wrote it into the registry. A job that then failed or died before its first line left every later spawn resuming a conversation that never existed, the real one orphaned; and a second spawn while the job was still starting walked from the persisted id, found no worker record, and took the `--session-id` retry — a second writer under the id the worker was about to write. The walk now stops BEFORE an unwritten successor and reports who holds it (`_CI_END_HELD`, `_CI_END_HID`); `_CI_END` is always the last written id. So no unwritten fork successor ever reaches the registry — every writer of a successor (this walk, the per-tick hop, `_ci_bg_follow`) requires a transcript with a line in it — and neither the hook's pane-less fallback nor the server's stream can be pointed at one (which moots the server's SV-2 window); every walk re-asks the job's real fate. The id a `/clear` mints in the pane is still written before its first line, by design: it is a rotation the pane announced, not a successor (D-4943). Review round 2 (RR-2): a held conversation is waited for, not spawned into. Measured in the 2.1.296 binary: an interactive `--resume <id>` that a live background job holds is refused for any launch carrying `--dangerously-skip-permissions`, which every ccd spawn does; and the in-process agents view, once closed, exits the pane process unconditionally — so every left-arrow fork, not only the exit dialog's "background", ends with the row's pane gone and its conversation in a job whose worker stays up, idle, for hours (measured on a real fork). The refused respawn spent `StartLimitBurst` (5 in 120 s) and left the unit failed, with nothing to revive it when the job ended; resuming the pre-fork id instead would have been the time travel this PR removes. Now `_spawn_start` spawns nothing for a held conversation (rc 7, `_CI_HELD_RC`, asked before the expiry gate and the archive stamp), and `cmd_supervise`, before it calls `cmd_ensure` on a dead pane, waits (`_ci_held_wait`): no respawn; its heartbeat kept fresh, so the row reads `restarting`; the wait recorded once on entry and once on exit in `$REG/<id>.bgwait` (`state= job= id= since= wrapper= sup= supst=`, then `until= end=`) and in swap.log (`bgwait` / `bgwait-end`), as a rescue wait is; and `ccd start`/`ccd ensure` say so at once instead of timing out — but only while the supervisor the record names (`sup`, its pid; `supst`, its `/proc` start time where there is one) still runs and its heartbeat is fresh. A heartbeat alone was not enough (the verifier's PR4): `ccd stop` mid-wait SIGTERMs the supervisor, which leaves the record open, and the next supervisor stamps its heartbeat at its first line, before its pre-flight has asked whether the job still holds anything, so `ccd start` reported a wait for a job that had already ended. A supervisor restarted mid-wait takes the record over, keeping its onset, and the close names the supervisor that closed it. Each tick costs builtins on Linux — `kill -0`, plus the worker's start time from `/proc/<pid>/stat` pinned when the wait began, which a pid handed to another process cannot match; without `/proc`, the record's `procStart` against `ps`. Measured: 0.15 execs per wait tick (the heartbeat's own write, every sixth tick), 1.15 without `/proc`. A job still starting is watched by a builtin scan for its worker and one stat of its state file. While it waits, the registry keeps following the fork through the worker's own record (D-4945's `_ci_bg_follow`, which `_sync_uuid` runs only while a pane lives): the unwritten successor's first line, or a `/clear` inside the background session, moves the registry during the wait, so the resume takes the id the job ended on, not the one it started from. When the holder is gone the walk is taken again from the last written id: its successor written is resumed, and the registry follows it; the job over with nothing written resumes the pre-fork id. Running `claude attach <job>` in the pane instead was considered and not taken: it is a different command, so `_spawn_settle`'s TUI gate, `--remote-control`, the routing flags and the generation env would all meet a process none of them was written for; what sessions record an attach client publishes is unmeasured; and an operator's detach would be answered by an immediate re-attach. It needs a live fork to verify against. The wait never writes, never doubles and never spends the start limit, and the operator keeps both doors: `<wrapper> attach <job>` opens the conversation where it runs, and `<wrapper> stop <job>` ends the job so the row resumes it in the pane. A `ws-restore` of a held row supervises it anyway: the restore has removed the archive stamps before the spawn declines, and the row used to end unarchived, paneless and unsupervised, with nothing to revive it when the job ended; now the wait takes over, and the journal's failure line says the row is supervised and which job holds it. `cmd_swap` refuses such a conversation before teardown, matched by id or job short, `--force` included, because the holder check cannot see across config dirs; the refusal names the id the job holds and no longer offers `--force` (`_swap_refuse`'s optional hint). Open: a worker that stays up holds the row's pane for as long as it lives; the server does not read `.bgwait` yet, so a fleet-board reason is a follow-up; a fork started inside `cmd_swap`'s one-second teardown window is carried at its last written id.
- **D-4945** — `_sync_uuid` gains a third source between the pane and the chain: the forked session's own background worker record (`_ci_bg_track`, `_ci_bg_follow`, `_ci_bg_scan`). A `/clear` inside the background session writes no `continued-in` record, and the pane keeps the pre-fork id, so nothing told the registry. The review's hook lens H1 and the registry lens's second missed item both found this. The worker is found once: at a hop, by successor id or job short, or from a parked pane's `parkedJobId`, which covers restarts. It is then re-read with builtins by pid, rescanned by job if its pid record moves, and let go after 12 missed ticks (`_CI_BGGONE`). A new id is written only when its transcript exists, non-empty, under the row's own workdir, and a pane that wins a genuine rotation ends the following. The common path is unchanged, measured with PATH shims: 9 execs and about 11 subshells per tick before and after. Its guards are pinned (second verifier round): the non-empty check, the let-go and `_CI_BGGONE`, the walked-id refusal, the `_CI_EXPECT` placement, and `kill -0` on the per-tick read. Residuals: a `/clear` inside the background session reaches the registry only at the new id's first transcript line, so that session's own `SessionStart(clear)` hook event is not attributed (it needs a hook-side lookup by `CLAUDE_JOB_DIR` against a per-row job short ccd would publish); the walked-id refusal here is still memory, unlike the pane's (D-4943), so an explicit `/resume <an id the walk left>` inside the background session is not followed; and a followed worker sitting on a rotated id with no transcript yet pays one `_reg_get` per tick (measured 10.15 against 9.15 execs).
- **D-4946** — An unmeasured continuation keeps looking, and the follow never re-points backwards, except onto a predecessor measured as resumed past its marker. The plan's Task 2 had `continuationAt` answer `null` for a failed stat or a failed tail read, which is the same value as "the last line is not a marker". Task 4 had `shouldRepoint`'s uuid clause fire on any uuid difference. Together, one agent RPC timing out during a re-ladder from the registry's pre-fork uuid gave a clean answer on the predecessor. The stream then re-pointed back to the frozen pre-fork file, and the memo served it for the life of the socket (#189 review, S1, reproduced). A failed stat of the successor did the same, both inside the walk and in `repointNeeded`'s folded `stat`. The rung clause left a third door open: in a symlinked workdir, a `<pid>.json` read that fails changes the memo key, and under that key the predecessor resolves at a better rung, either served stale from an earlier blip or answered fresh when its tail read fails. That gave a one-tick flap of the whole chat to the pre-fork backlog on every such blip (#189 fix-forward, probes E2/E2b). The registry-move branch was a fourth door (#189 re-review, SV-1). `ccd` advances the registry one hop per quiescence, so a stream that followed A->B->C sees it land on B, and a walk from B that could not read B's tail answered B. The branch sent B's backlog whenever the move was a continuation, and the chat sat on the frozen intermediate file for the back-off. - The walk reads through the measured io and answers a third verdict, `tailUnmeasured`, which is a keep-looking answer on the back-off. - The uuid clause fires only when the new answer was followed through the tailed uuid (`followedFrom`). - A new clause refuses to re-point to a uuid the tailed answer was followed FROM while the tailed file still exists. - `repointNeeded` treats only a proven ENOENT as "gone". - A registry move the stream calls a continuation keeps the open tailer when the new answer is a link the tailed file was followed from, as long as the tailed file is not proven gone (`keepsTailer`). An unreadable stat of the tailed file is not "gone" there either; that guard has its own test. - The refusal yields to a predecessor RESUMED past its marker (#189 re-review, server lens: following a fork could never be undone while the socket was open). Claude Code 2.1.296's `claude --resume <id>` never checks the marker. So a supervisor not yet on this build, or one resuming a head `ccd` cannot see, puts the operator's prompts in the predecessor while the stream shows the fork, which is the original report's symptom. Claude Code's own reader (`Txn`) reads the last 64 KiB newest line first and answers "not continued" at the first finished turn after a marker; `/resume` then drops the session's `superseded` flag (read in the binary). So the stream re-points back only when its own read of the predecessor's tail, taken at the moment of the decision (`resumedPastMarker`), finds a FINISHED TURN as the newest deciding line (`finishedTurnDecides`). That is the line `Txn` stops at, over the same newest lines. A window with no deciding line is not a resume. The walk answers the predecessor there (the shared 8 KiB rule, a declined follow), but Claude Code reads further back, still finds the marker and says "continued". aa43554e un-followed on it and sent the open stream back to the frozen pre-fork file (#189 re-review verifier, probe FALSE-UNFOLLOW). The answer alone cannot say a predecessor was resumed, because a stale memo entry serves a clean predecessor too (E2b). An unmeasured read never re-points back. An answer already flagged `tailUnmeasured` or `declinedTo` is not re-read. A measured "not shown" is remembered for that answer object (`notResumed`), so a predecessor the memo serves clean tick after tick is read once, not every tick. A followed answer is now a keep-looking answer on the back-off: the memo stamped it by the successor's stat alone, so a frozen successor was served for the life of the socket while the predecessor changed. - Cost, measured with a counting io over transcript paths, per 2 s tick: the healthy tick is unchanged at one stat. While the registry still names a followed fork's predecessor, there is one walk per back-off (+0.2 stats and +0.13 tail reads per tick, averaged over 60 s). A clean predecessor answer costs one tail read per answer. After a keep onto a link behind, there is one more stat of the tailed file per tick for at most the back-off (30 s). While the predecessor's window decides nothing and the registry names it, there is one more stat of the tailed file per tick; `ccd` sees no marker either, so that state can last the life of the socket. - Residual: - A predecessor resumed and then forked AGAIN before the stream noticed keeps the stream on the old fork until the registry moves onto the new fork (a rotation) or the client reconnects. - A resume is noticed when the memo re-walks the predecessor: on the next back-off while the fork is the answer, or once the predecessor's file has held still for one poll when it is served clean. - In the undecided-window state, an open stream stays on the fork while a fresh connect shows the predecessor: the 8 KiB declined follow already recorded at `CONTINUATION_TAIL_BYTES`.
- **D-4947** — A registry catch-up is a continuation, not a reset, and it never trades the file on screen for less. F2's guard ("the registry naming the file already being tailed is not a rotation") only saw the order where the server follows first. - Shapes that still sent `rotated` and a false "Session context reset": - ccd moving the registry onto a successor that the server's re-ladder had declined and was waiting out its back-off on (#189 review, S2); - a chain longer than `MAX_CONTINUATION_HOPS`, where the server stops hops ahead of the registry; - a decline learned and then lost when a later re-walk could not read the file's tail (fix-forward, R1); - the registry moving before the stream's own re-ladder read the marker at all, on a delayed tick (fix-forward, P2early); - the registry moving two hops in one gap. - The fix: - The found answer names the successor it declined (`declinedTo`, which replaces the bare `followDeclined`) and the uuids it was followed from (`followedFrom`). - `registryCaughtUp` treats a registry move onto either one, onto the tailed uuid, or onto the tailed path as caught up. Each clause has a table row no other clause satisfies. - `tailed` is refreshed for the same file and rung. A decline learned from a measured read is kept across a later failed read. - When none of that explains a move, the stream reads the tailed file's own marker chain (`continuesInto`, within the hop bound) before announcing a rotation. - A file resumed past its marker has measurably stopped naming the fork, and a move onto the fork is still a rotation. - Calling a move a continuation used to open whatever the registry's new uuid resolved to (#189 re-review, SV-2). The registry could name a successor with nothing written yet (ccd's resume path took a held, unwritten end, D-4944), and the branch sent the backlog of an absent or zero-byte file. The whole conversation became an empty chat, which broke the walk's own rule that following may only improve the answer. `keepsTailer` now keeps the open tailer when the new answer is a fallback, or a file with no measured content (empty, or a stat that failed), as long as the tailed file is not proven gone. When the registry's uuid is downstream of the tailed file, it records that uuid as the kept answer's `declinedTo`. `shouldRepoint` counts a declined successor as downstream and re-points once its file measures non-empty, never onto it empty and never on an unreadable stat. The keep is asked ONLY for a move already called a continuation: a move that is not one is a rotation as before (`rotated`, then the new uuid's backlog), even onto a uuid with nothing written yet. That is `/clear`'s ordinary shape, and it has its own test. - Cost while waiting: one stat of the tailed file per tick, plus one of the successor once it exists. Nothing on a healthy tick. - Residual: a reconnect while the registry names an unwritten successor has nothing measured to keep, so it shows the empty successor until its first line. ccd no longer writes such a registry (RR-1). The stream's frames keep the uuid the tailer was opened under until its next backlog, so a reconnect in that window is answered with a backlog, never a stitched offset.
- **D-4948** — The memo is stamped from the walk's own stat. Task 3 stamped the memo with a separate `io.stat` taken after `resolveTranscript` returned. A marker appended between the walk's tail read and that stat was counted in the stamp while the answer was computed without it, so the terminal file was never looked at again (#189 review, S3, reproduced). - The walk now returns the stat it took before reading the answered file, or, at the hop bound, the successor's existence stat. The memo stamps with that. A write after the read can only move the file past the stamp. This also saves one stat per re-ladder.
- **D-4949** — The successor is resolved where ccd resolves it. The spec (§1, "resolves the successor uuid through the same ladder") had the walk resolve the successor through the full ladder, including the uuid glob and other accounts' config dirs. So a marker naming a uuid in another project, or in another account, was followed by the server and never by ccd, whose `_ci_transcript_path` looks only at the session's own registry workdir under its own config dir. The two authorities disagreed for good and the doctor WARNed indefinitely (#189 review, F4, reproduced as `foreign-glob`). - The first fix, the sibling only, over-corrected. ccd's `_ci_addrs` also accepts the successor under the OTHER spelling of a symlinked registry workdir, so a fork written there was declined by the server alone. Without ccd moving the registry, the chat stayed on the pre-fork file, a regression against the full-ladder follow (fix-forward, F4-spelling). - The rule now matches ccd address for address: - a file in one of the registry workdir's two project dirs looks for its successor in both, resolved first; - any other file (a uuid-glob or foreign-glob head, or one under the live cwd's munge) looks only beside itself; - the first existing file wins, a zero-byte one is declined, and a stat that fails declines rather than guessing. - A successor beside its predecessor inherits the predecessor's rung and account. One at the other spelling wears that address's rung. - `continued-in-successor-parity.test.ts` drives ccd's `_sync_uuid` and the server's walk over the same fixture HOME: a sibling, another project dir, another account, both spellings, and a successor at both.
- **D-4950** — The spec assumes a queued message comes back as a `user` event that `clearConfirmed` matches. On current Claude Code, a message sent to a busy session is usually **absorbed mid-turn** instead. The transcript then gets `queue-operation` enqueue/remove (`reason:"absorbed_mid_turn"`) and a `type:"attachment"` record whose `attachment` is `{type:"queued_command", prompt, commandMode:"prompt", origin:{kind:"human"}}`, and never a `type:"user"` record. Measured over the fleet's 25 most recent transcripts: 467 absorbed removes against 578 dequeues. The parser dropped every attachment, so the chat never showed the message, and the bubble sat under Claude's answer for the full ten-minute horizon before vanishing: the reported symptom, delayed. `parseTranscriptLine` now reads that one attachment as a user event (the prompt verbatim, under the record's uuid and timestamp). It requires both `origin.kind === "human"` and `commandMode === "prompt"`, because the same queue carries peer-agent messages, task notifications and bash-mode items. The message renders once: of 44 queued `prompt` records, only a one-letter answer also appeared as a user record. Found by the PR #189 review (PWA-1). Review round 2 (a missed item of the re-review): the event carries the attachment's own `timestamp`, which is the ENQUEUE time, while the record is written where the model took the message, after records stamped up to minutes later (measured on the fleet: an attachment stamped 10:01:56 written after a tool result stamped 10:06:06). `ChatList`'s quiet-gap divider measured each gap from the previous event's time, so it rewound to the enqueue time and drew a timestamp divider under a turn that never went quiet whenever the message had waited ten minutes or more. The divider now measures from the newest time seen, never rewound, and a test pins it.
- **D-4951** — A PWA-sent slash command echoes as a `system` row naming the command (`harnessEnvelope` reads `<command-name>`; the arguments never come back), and `clearConfirmed` matched only `user` rows. So once Task 5 moved retirement to ten minutes, every PWA-sent command left a non-dismissible "sending /cmd" bubble under the command it had visibly run. That was a regression against `main`'s 5 s. A `system` row now clears a `sending` pending whose composed text starts with `/` and whose first word equals the row's text. Prose never matches a system row, because a command's stdout is one too. The timer stays as the fallback for a command that echoes nothing. Found by the PR #189 review (PWA-2).
- **D-4952** — `clearConfirmed` treated every `user` row in a `backlog` frame as a fresh echo, but a backlog replays up to fifty events of history. With pendings living ten minutes, and this PR adding backlogs on fork follow, repoint and registry catch-up, an old "yes" cleared a new, undelivered "yes". `PendingSend.sentAfter` now records the newest **transcript** timestamp on screen at `send()`, and only an event strictly newer than it can be the echo. The box's clock is compared with the box's clock: a phone-clock stamp would let any skew between phone and box decide the answer, and a uuid seen-set misses history the store never saw. The `[bg]` successor's copied history keeps its original timestamps. This is read in the 2.1.296 binary, not measured, because no fork pair survives in the corpus: the fork snapshots the parent transcript byte for byte and resumes with `--fork-session`, and the successor's recorder spreads each loaded record under the new `sessionId` without stamping a `timestamp` (the `forkedFrom`-carrying copy is `/branch`, a different path). So a successor's replay is refused too. The bar is the MAX over the events on screen, because transcript order is not time order. Found by the PR #189 review (PWA-3). Review round 2 (re-review R189-PWA-A, PIN-1, and a missed item of the PWA lens) corrected two claims this entry made. (1) It said the only error mode was the box clock stepping backwards, which falls back to the timer and "never clears an undelivered message". But the bar is the newest event THIS STORE had seen, not the box's state at the send: a screen that was stale when the operator pressed send (the socket down, a reconnect's backlog not yet in) has a low bar, and a same-text message written in that gap passes it and clears the bubble early. That errs the way `main` did for every replay, the message itself still shows once it is delivered, and a uuid seen-set has the same hole; both error modes are now stated in `session.ts`. (2) It said the bar was "stamped once and kept across `retry`/`resolve`, because a re-send is the same message", and no test went red without the keeping. Kept, the bar let through a same-text message that landed while the pending sat failed (one the operator had already been shown before pressing Retry) on any later replay, and that cleared a re-send not yet delivered: the re-review's reproduction. A re-send now RAISES the bar to the newest event on screen at the re-send and never lowers it (`reSendBar`): right after a `rotated`, with nothing from a transcript on screen, the first send's bar stays. The cost is an echo of an earlier attempt that was delivered after all (a failure reported on a send that landed) and is no newer than the re-send's bar: it no longer clears the bubble, and the re-send's own echo does. Six tests pin it: the bar is kept, raised and never lowered, through `retry` and through `resolve`. Residual (re-review R189-PWA-B): every backlog the server sends after the file on screen changed (a reconnect whose `sinceFile` no longer matches, a fork follow, a repoint, a registry catch-up, any of them delayed by the resolver's back-off) carries only the newest fifty events (`BACKLOG_N`). An echo written while the store was not receiving, and pushed out of that window by fifty later events, is never seen: the bubble stays `sending`, truthfully, and retires at the ten-minute horizon. The fix is server-side and not built: widen a backlog back to the first event newer than the client's oldest pending `sentAfter`, within a cap, after which `isFresh` and the echo match clear it with no store change. `queuedTimeoutMs`'s comment and the README's session section say so.
- **D-4953** — The pane-less fallback is for forked sessions only. Task 7 matched `$CLAUDE_CODE_SESSION_ID` against `$REG/*.uuid` for any process whose pane named no `cc-*` session, and claimed "a stranger's Claude session on this box exits 0 exactly as it does today". That was false for a stranger that resumes a registry uuid. A plain `claude --resume <uuid>` keeps the id, and its hooks carry it (measured on 2.1.296). So a hand-run resume outside tmux, or in a tmux session not named `cc-*`, wrote that row's hookstate with the row's own uuid, which the server reads as current while the real pane is mid-turn (review H2). The fallback is now an `elif` on the pane test, and it requires `CLAUDE_JOB_DIR`. - Why that variable and not the one the review suggested: 2.1.296 builds every hook's environment from a copy scrubbed of its background-identity list, so `CLAUDE_CODE_SESSION_KIND=bg`, `CLAUDE_BG_BACKEND` and `CLAUDE_BG_SOURCE` never reach a hook. `CLAUDE_JOB_DIR` does. This was measured on a 2.1.296 process given that identity, and confirmed in the hook-env builder. A real daemon-hosted fork has not yet been observed. - The non-empty session-id conjunct had no test that went red without it (review H4). It is now pinned by an empty row beside an empty id, and by an unset id under `set -u`. - The residual the marker cannot refuse: `CLAUDE_JOB_DIR` is INHERITED. Claude Code's child-environment builder keeps it (its prompt for a forked session even tells the model to use `$CLAUDE_JOB_DIR/tmp`), so a `claude --resume <registry uuid>` run from a forked session's own shell still matches that row and writes its state. No variable separates it from the fork's own hook, because every Claude process sets its own hooks' `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION` and `CLAUDE_PID` afresh. It needs a forked session to start it, so it is far narrower than the hole the gate closes. The hook's prose names it, and a test pins that prose. - Found by the PR #189 adversarial review. - Review round 2: the same stranger has a uuid-less spelling, a bare `claude --continue` run from the fork's own shell, which takes the newest transcript in that directory, usually the fork's own (re-review, hook lens; read, not observed). The hook's prose now names both spellings, and its pin asserts both. - Residual (re-review HG1; read in the binary, not observed on a live fork): a forked job's environment is the background daemon's, built from the environment of whichever pane first started that daemon, so its `CCRC_SESSION_GENERATION` is that pane's row's, not the forked row's. The fallback then writes as the forked row with another row's generation: every spool line it writes carries that generation, and the compaction arms' `_hook_generation_ok` fails closed for every fork but the daemon-starter's own, so a fork gets no compaction card (one of the cards spec §4 names) until a per-row generation source exists. The named fix, ignoring the inherited value on the fallback branch so spool lines go out without a generation and the compaction arms fail closed explicitly, waits on the same evidence `CLAUDE_JOB_DIR` does: `/proc/<job pid>/environ` of the first real fork after deploy.
- **D-4954** — The fallback reads registry rows safely. Task 7's walk tested `-e` and then ran an unbounded `read -r < "$u" 2>/dev/null`. Unlike the pane path, it opens EVERY row, so one bad node anywhere in the registry reached every forked session's every event: - A FIFO blocked the hook in open(2), and a symlink to `/dev/zero` read forever. Each lasted until Claude Code killed the hook at `HOOK_TIMEOUT_S`, on every tool call (review, hook lens, missed item). - The redirection order printed the open error of an unreadable row, or of one unlinked mid-walk, on stderr. That broke the D-1691 rule (review H3). Each row now passes `-f` and is read with the brace form `{ IFS= read -r -n "$CCRC_ID_MAX" x < f; } 2>/dev/null`. There is no `-r`: the braces already make an unreadable row fail silently, so `-r` could not be pinned. It is not `_ct_read` itself, because its `-N` read plus trim measured 2.9-3.4 ms per 200-row walk against 1.8-2.5 ms, on the path every tool call of a forked session takes. Rows compare exactly, so a row with stray whitespace fails closed. Five tests pin it: a mode-000 row, a DEBUG-trap unlink race, a FIFO, a device symlink, and a 300-character row for the bound. What remains is the race D-4418 names: a node swapped in after `-f` is still opened.

### Review round 2 (2026-10-14)

(A re-review of the integrated tree, `b54586a7`, found three major and twenty minor defects. Every fix departs from a
deviation this plan already defines, so the allocator was not asked for numbers: each is recorded inside the bullet it
amends, marked "Review round 2", and the definitions above describe the shipped behaviour on this tree.)

- The registry never names an unwritten fork successor, and a conversation a live background job holds is waited
  for, never spawned into (RR-1, its likelier twin, RR-2): D-4944, and the README's "When a background job holds
  the conversation".
- The pane's id is judged on its transcript's current verdict, not on memory (RR-3): D-4943.
- A failed read is not a verdict, in ccd as in the doctor and the server (RR-4): D-4942, with its effect on the
  pane check (D-4943) and on the resume walk (D-4944).
- The doctor reads registry rows FIFO-safely and names a successor never written apart (DR1, DR2): D-4941, and a
  `transcripts` row in the README's doctor table.
- The stream keeps the file on screen when the registry lands behind it or on a successor with nothing in it
  (SV-1, SV-2), and a fork follow can be undone, by a finished turn only: D-4946, D-4947.
- A re-send raises its echo bar, and the two error modes of the bar are stated (R189-PWA-A, PIN-1); the
  fifty-event backlog window is a named residual (R189-PWA-B): D-4952. An absorbed message's enqueue time no
  longer draws a false divider: D-4950.
- `claude --continue` joins the stranger D-4953 names, and a fork's inherited generation is its residual (HG1).
- Documents: D-4943, D-4944 and D-4945 carry the registry lane's revised text (DOC-1); D-4936 and D-4937 say what
  changed under them (DOC-4, DOC-3); the renumber narrative above runs in order (DOC-5); the spec carries a dated
  "Review rounds" note (DOC-6); the retracted "a marker is the last line" premise is gone from the comments in ccd
  and the server (DOC-7); live session names are out of the spec and this plan, and account names out of the
  ladder's fixtures (PUB-1, PUB-2).
- Accepted residuals, each stated in its bullet: a background worker that stays up holds its row's pane for as long
  as it lives, the fleet board does not read `.bgwait` yet, and a fork started inside `cmd_swap`'s one-second
  teardown window is carried at its last written id (D-4944); on a box whose jq never works, an unparked pane that
  disagrees with the registry stays refused (D-4943); `_ci_bg_follow`'s walked-id refusal is still memory (D-4945);
  a predecessor resumed and forked again before the stream noticed keeps the stream on the old fork until the
  registry moves or the client reconnects (D-4946); a reconnect while the registry names an unwritten successor
  shows it empty until its first line, a registry ccd no longer writes (D-4947); the fifty-event backlog window
  (D-4952); a fork's inherited generation (D-4953).

## Rollout

Tasks 1–5 are ordinary server and PWA deploys and depend on nothing under `ccd/`.

Tasks 6–8 are AGENT-FIRST: fleet box first, then the server box, and they take effect only once the `claude-session@*` supervisors restart — `ccrc update`'s step-4 sweep behind its mandatory `KillMode=process` preflight, the one scoped exception to "never touch those units". Each step needs the operator's explicit approval at the time.

**Live-fleet caution, until Task 6 ships:** do not restart or swap a session whose registry uuid still names a pre-fork transcript (the spec's census finds them; two did on 2026-09-20). A `--resume` would time-travel it.

Review round 2's ccd changes (the background-job wait, the swap refusal, the read backoff, the doctor's row reads) ship the same way, AGENT-FIRST, and take effect at the same supervisor restart.
