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
  it('stops on a chain that loops back', async () => {
    const b = box();
    const first = plant(b, A, turn('one') + marker(A, B));
    plant(b, B, turn('two') + marker(B, A));
    const r = await resolveTranscript(localIO, opts(b, A));
    expect(r.kind).toBe('found');
    expect([first, transcriptPath(b.cfg, b.livePhys, B)]).toContain((r as { path: string }).path);
  });

  it('stops at the hop bound and answers the last good file', async () => {
    const b = box();
    const ids = Array.from({ length: MAX_CONTINUATION_HOPS + 3 }, (_, i) => String(i).repeat(36).slice(0, 36));
    for (let i = 0; i < ids.length - 1; i += 1) plant(b, ids[i]!, marker(ids[i]!, ids[i + 1]!));
    plant(b, ids[ids.length - 1]!, turn('end'));
    const r = await resolveTranscript(localIO, opts(b, ids[0]!));
    expect(r.kind).toBe('found');
    expect((r as { uuid: string }).uuid).not.toBe(ids[0]);
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
    expect(await r.resolve(opts(b, A))).toMatchObject({ path: to, uuid: B });
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
      // A `found` stays true while its file exists AND has not changed since we
      // read it. Existence alone is not enough any more: a transcript that gains
      // a `continued-in` marker still exists, and a memo that asked only about
      // existence would serve the pre-fork answer for the life of the stream —
      // which is exactly the freeze this work is for, moved one layer in.
      // A `fallback` stays true while its path still does NOT exist.
      const stillTrue = held.answer.kind === 'found'
        ? st !== null && stampOf(st) === held.stamp
        : st === null;
      if (stillTrue) return held.answer;
    }
    const answer = await resolveTranscript(this.io, o);
    this.remember(key, answer, answer.kind === 'found' ? await this.io.stat(answer.path) : null);
    return answer;
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
    this.memo.set(key, { answer, at: this.now(), stamp: stampOf(st) });
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
cd server && ./node_modules/.bin/vitest run
```

- [ ] **Step 5: Measure the mutation table**

| Mutation | Must go red |
|---|---|
| revert `stillTrue` to `st !== null` | "re-ladders when the answered file gains a marker" |
| always re-ladder (drop the memo hit) | "still serves the memo when nothing changed" |

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
| drop `queued: undefined` from `retry` | "clears the queued flag on retry" |

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

**Refinement of the spec, recorded as `D-TBD-ccd-one-hop`:** the spec says `ccd` walks the chain with a hop bound and a visited set. `ccd` follows **one hop per supervise tick** instead. The read budget below is what forces it — each hop's quiescence has to be observed before its file may be read — and the effect is the same: the chain converges over a few ticks, the per-stamp memo IS the visited set, and a cycle cannot be re-read because its stamps are already in it. The ledger allocator (`POST /api/ledger/deviations`) answered 401 from this box, which holds no box token, so this carries a `D-TBD-` slug and must be reported rather than guessed at.

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
  # WHY ONE HOP AND WHY GATED (D-TBD-ccd-one-hop). `_transcript_path` costs
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

`_munge_wd` is the only spelling of the munge in this file after this task; confirm with `grep -n "tr './_'" ccd/ccd`, which must return exactly one line.

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
| move `_follow_continued_in` above the pane read | a `/clear` rotation test in the existing suite |

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
# and compaction card matter most — `ccrc-pwa-bright-canyon` wrote its last
# hookstate two minutes before its fork and then nothing for three hours of
# active work.
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

| id | what |
|---|---|
| `D-TBD-ccd-one-hop` | The spec has `ccd` walk the continuation chain with a hop bound and a visited set within one call; Task 6 follows **one hop per supervise tick** instead, because each hop's quiescence must be observed before its file may be read. Same end state, and the per-stamp memo is the visited set. |
| `D-TBD-clearconfirmed-timer` | Pre-existing: `clearConfirmed` drops a pending without cancelling its timer. Harmless at five seconds, a real per-message leak at the ten-minute horizon Task 5 introduces, and the timer is now the thing that ends the bubble — so Task 5 makes `clearConfirmed` report the keys it dropped and cancels them. |

**Both carry `D-TBD-` slugs and must be reported, not guessed at.** `POST /api/ledger/deviations` is the only thing that may mint a number, and it answered 401 from this box — no box token lives at `~/.ccrc/mail.token` or `~/.cc-secrets/ccrc-mail.token` here. Allocate and DEFINE in the same act from a box that holds one, before the branch is merged.

## Rollout

Tasks 1–5 are ordinary server and PWA deploys and depend on nothing under `ccd/`.

Tasks 6–8 are AGENT-FIRST: fleet box first, then the server box, and they take effect only once the `claude-session@*` supervisors restart — `ccrc update`'s step-4 sweep behind its mandatory `KillMode=process` preflight, the one scoped exception to "never touch those units". Each step needs the operator's explicit approval at the time.

**Live-fleet caution, until Task 6 ships:** do not restart or swap `ccrc-pwa-bright-canyon` or `application-swift-hollow`. Their registry uuid still names the pre-fork transcript, so a `--resume` would time-travel them.
