# Attention UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One server-computed attention bucket drives every fleet surface and its counts; the operator can see what is unseen, answer an ask from a push notification, and rescue a swallowed Enter with one tap.

**Architecture:** A pure `sessionBucket()` on the server assigns each session one of seven buckets plus the timestamp it entered (derived from evidence already on the record — never a watcher's memory), and both ride the fleet wire. The PWA deletes its three independent re-derivations and reads that field, layering a per-device `localStorage` unseen watermark on top. Two new fail-shut routes (`/ask`, `/submit`) reuse `inject/send.ts`'s proven echo-and-verify machinery, and a seq+epoch notification log written as one atomic JSON value lets a reconnecting client learn what it missed. Three PRs: D (server + wire), E (PWA fleet surfaces), F (push actions + client catch-up).

**Tech Stack:** TypeScript ESM (Fastify server, React 19 PWA), vitest (`server/test/**/*.test.ts`, `pwa/test/**/*.test.tsx`), node:crypto, Web Push (`web-push` + `pwa/public/push-sw.js`).

## Global Constraints

Every task's requirements implicitly include these. Values are copied verbatim from `docs/superpowers/specs/2026-08-06-attention-ux-design.md`.

- **`status` derivation stays frozen and hook-blind.** Build 1 pinned this with a test asserting identical `status` with and without hookstate present. That test stays green; `bucket` is the only field allowed to move.
- **Zero new agent whitelist grants, zero new argv surfaces, zero new destructive verbs.** No card ever runs `ws-rm`/`ws-reap`/`ws-gc --prune`/`ws-archive`/`ws-restore`; the `cleanup` bucket surfaces candidates and the operator retires them through the existing sheet.
- **No fleet-wide `ws-audit`.** Cards claim only what the wire already carries (`pr.number`, `archivedBytes`); the audit runs on demand in the actions sheet, as today.
- **Every refusal is named.** Each distinct hazard gets its own error token and its own sentence, and the sentence lives beside the classifier that decided it (analysis Tier-1 #4: "a message that tells the user to force-delete while the UI hides the button is the same dead end").
- **One writer per derived fact.** After Task 6 there is exactly one place that decides a session's bucket (the server) and exactly one that decides whether it is unseen (`pwa/src/lib/seen.ts`). Adding a second is the drift these fields exist to end.
- **All new PWA copy must pass the existing contrast suite** (`pwa/test/contrast.test.ts`), and colour alone never carries a distinction.
- Suites must be run **foreground** and reported with real counts: `cd server && npx vitest run`, `cd pwa && npx vitest run`, plus `npx tsc --noEmit` in `server`, `pwa` and `agent`.

**Branch structure:** PR D `feat/bucket-authority` (Tasks 1–4), PR E `feat/attention-ui` (Tasks 5–7), PR F `feat/push-actions` (Tasks 8–9). Open each PR when its tasks are complete; **the orchestrator merges, not the implementer.**

---

### Task 1: The bucket authority

**Files:**
- Create: `server/src/bucket.ts`
- Modify: `shared/api.ts` (add `SessionBucket`; add two fields to `FleetSession`)
- Modify: `server/src/fleet.ts:136-160` (the return object in `assembleFleet`)
- Test: `server/test/bucket.test.ts`

**Interfaces:**
- Consumes: `FleetSession`, `HookState` (from `server/src/hookstate.ts`).
- Produces: `sessionBucket(s: BucketInput, hookUpdatedAt: number | null): { bucket: SessionBucket; bucketSince: number | null }`, and the wire fields `bucket: SessionBucket` / `bucketSince: number | null` that Tasks 5–7 read.

- [ ] **Step 1: Write the failing test**

Create `server/test/bucket.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sessionBucket, type BucketInput } from '../src/bucket.js';

const base: BucketInput = {
  status: 'idle', statusUpdatedAt: 1000, dialogPending: false,
  hookState: null, archivedAt: null, pr: null,
};

describe('sessionBucket', () => {
  it('routes a merged archived workspace to cleanup, not dead', () => {
    // ws-archive STOPS the session, so every cleanup candidate is also dead.
    // Testing dead first would empty this bucket permanently.
    const r = sessionBucket(
      { ...base, status: 'dead', statusUpdatedAt: 9000, archivedAt: 1700, pr: { phase: 'merged' } as never },
      null,
    );
    expect(r).toEqual({ bucket: 'cleanup', bucketSince: 1_700_000 });
  });

  it('routes an archived workspace with no merged PR to archived', () => {
    const r = sessionBucket({ ...base, status: 'dead', archivedAt: 1700, pr: null }, null);
    expect(r.bucket).toBe('archived');
  });

  it('routes a live dead session to dead', () => {
    expect(sessionBucket({ ...base, status: 'dead', statusUpdatedAt: 42 }, null))
      .toEqual({ bucket: 'dead', bucketSince: 42 });
  });

  it('uses the hook timestamp for a waiting session', () => {
    const r = sessionBucket({ ...base, status: 'busy', hookState: 'waiting' }, 5555);
    expect(r).toEqual({ bucket: 'attention', bucketSince: 5555 });
  });

  it('falls back to statusUpdatedAt when the pane scrape is the reason', () => {
    const r = sessionBucket({ ...base, status: 'busy', dialogPending: true }, 5555);
    expect(r).toEqual({ bucket: 'attention', bucketSince: 1000 });
  });

  it('does NOT use the hook timestamp for working — it bumps on every PostToolUse', () => {
    const r = sessionBucket({ ...base, status: 'busy', hookState: 'working' }, 8888);
    expect(r).toEqual({ bucket: 'working', bucketSince: 1000 });
  });

  it('routes a finished turn to done with the hook timestamp', () => {
    expect(sessionBucket({ ...base, hookState: 'done' }, 7777))
      .toEqual({ bucket: 'done', bucketSince: 7777 });
  });

  it('leaves a hookless idle session in idle — no hook evidence, no done claim', () => {
    expect(sessionBucket(base, null)).toEqual({ bucket: 'idle', bucketSince: 1000 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/bucket.test.ts`
Expected: FAIL — cannot resolve `../src/bucket.js`.

- [ ] **Step 3: Add the wire types**

In `shared/api.ts`, above `FleetSession`:

```ts
/** Which attention bucket a session belongs to. THE authority: the fleet
 *  screen's sections, its counts and the row's own state word all read this one
 *  field, so they cannot disagree. Computed server-side in `bucket.ts`. */
export type SessionBucket =
  | 'attention' | 'working' | 'done' | 'idle' | 'cleanup' | 'archived' | 'dead';
```

and inside `FleetSession`, after `subagents`:

```ts
  bucket: SessionBucket;
  /** Epoch ms this session ENTERED `bucket`, as evidenced by the underlying
   *  record — never a watcher's memory of when it noticed, which would reset on
   *  every restart and paint the whole fleet as freshly-unseen after a deploy.
   *  Null when no evidence exists. Drives the PWA's unseen watermark. */
  bucketSince: number | null;
```

- [ ] **Step 4: Write the implementation**

Create `server/src/bucket.ts`:

```ts
import type { FleetSession, SessionBucket } from '../../shared/api.js';

export type BucketInput = Pick<
  FleetSession,
  'status' | 'statusUpdatedAt' | 'dialogPending' | 'hookState' | 'archivedAt' | 'pr'
>;

/**
 * One session → one bucket, plus when it entered.
 *
 * Pure, and deliberately memory-free: every branch below reads a timestamp that
 * is ALREADY on the record and already means "when this began", so the function
 * survives a server restart with identical answers. A `Map<id, since>` held by
 * the watcher would reset on every deploy — and ccrc deploys several times a
 * day — training the operator to ignore the unseen badge within a week.
 *
 * Order is load-bearing. The archived rows come first because `ws-archive`
 * stops the session: every cleanup candidate is ALSO `status: 'dead'`, so a
 * dead-first ladder would leave the cleanup bucket permanently empty.
 */
export function sessionBucket(
  s: BucketInput,
  hookUpdatedAt: number | null,
): { bucket: SessionBucket; bucketSince: number | null } {
  // `archivedAt` is epoch SECONDS (ccd writes `$REG/<id>.archived` as an epoch);
  // every other timestamp on this record is epoch ms.
  if (s.archivedAt !== null) {
    return {
      bucket: s.pr?.phase === 'merged' ? 'cleanup' : 'archived',
      bucketSince: s.archivedAt * 1000,
    };
  }
  if (s.status === 'dead') return { bucket: 'dead', bucketSince: s.statusUpdatedAt };
  if (s.dialogPending || s.hookState === 'waiting') {
    // The hook's timestamp is the honest episode start ONLY when the hook is
    // why we are here; a pane-scraped dialog has no hook write behind it.
    const since = s.hookState === 'waiting' ? hookUpdatedAt ?? s.statusUpdatedAt : s.statusUpdatedAt;
    return { bucket: 'attention', bucketSince: since };
  }
  // NOT the hook's timestamp: the hook rewrites `updatedAt` on every
  // PostToolUse, so a busy session would report a continuously-refreshed
  // "since" — permanently new, and permanently badged.
  if (s.status === 'busy') return { bucket: 'working', bucketSince: s.statusUpdatedAt };
  // `done` requires hook EVIDENCE: a hookless busy→idle transition never proves
  // a turn finished rather than never starting. It also decays for free —
  // hookstate.ts's 30-minute freshness gate nulls `hookState`, so an
  // unacknowledged `done` falls back to `idle` instead of accumulating.
  if (s.hookState === 'done') return { bucket: 'done', bucketSince: hookUpdatedAt ?? s.statusUpdatedAt };
  return { bucket: 'idle', bucketSince: s.statusUpdatedAt };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run test/bucket.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 6: Wire it into `assembleFleet`**

In `server/src/fleet.ts`, the return object currently ends:

```ts
      hookState: hs?.state ?? null,
      askSummary: hookAskSummary(hs),
      subagents: hs?.subagents ?? null,
    };
```

Replace the whole `return {...}` with a build-then-augment so the bucket sees the
final field values rather than a second copy of their expressions:

```ts
    const session: FleetSession = {
      /* …every existing field, unchanged, ending with… */
      hookState: hs?.state ?? null,
      askSummary: hookAskSummary(hs),
      subagents: hs?.subagents ?? null,
      bucket: 'idle', bucketSince: null,   // replaced immediately below
    };
    // Computed FROM the assembled session, never from a second copy of the
    // same expressions: `dialogPending` in particular is an OR of two sources
    // and must be read once. STATUS IS STILL FROZEN — `sessionBucket` reads
    // `status`, it never writes it.
    return { ...session, ...sessionBucket(session, hs?.updatedAt ?? null) };
```

Add the import: `import { sessionBucket } from './bucket.js';`

- [ ] **Step 7: Pin the freeze and fix the factories**

Add to `server/test/bucket.test.ts`:

```ts
it('assembleFleet ships the bucket without moving status', async () => {
  // The Build 1 freeze test asserts status is identical with and without
  // hookstate. This is its sibling: with hookstate present, `bucket` is the
  // field that moved.
});
```

Fill it in against the existing `assembleFleet` fixtures used by `server/test/fleet-hookstate.test.ts` (copy that file's harness verbatim — it already builds an `io`/`tmux` pair with a hookstate file present) and assert: same `status`, `bucket === 'attention'` when the hookstate says waiting, `bucket === 'idle'` when the hookstate file is absent.

Then update every `FleetSession` factory that fails to compile. Find them with:

```bash
cd server && npx tsc --noEmit 2>&1 | head -40
cd ../pwa && npx tsc --noEmit 2>&1 | head -40
```

Give each factory `bucket: 'idle', bucketSince: null` as its default unless the
test is about the bucket.

- [ ] **Step 8: Run the full suites and commit**

Run, foreground, and report the counts:
```bash
cd server && npx vitest run && npx tsc --noEmit
cd ../pwa && npx vitest run && npx tsc --noEmit
cd ../agent && npx tsc --noEmit
```
Expected: all green; server count is the previous count + 9.

```bash
git add -A shared server pwa
git commit -m "feat(server): one server-computed attention bucket on the fleet wire"
```

---

### Task 2: The ask-answer route

**Files:**
- Create: `server/src/askkey.ts`
- Create: `server/src/inject/ask.ts`
- Modify: `shared/api.ts` (the `ask` stream message gains `key`)
- Modify: `server/src/sessionws.ts:207-222` (`checkHookAsk` sends the key)
- Modify: `server/src/server.ts` (register `POST /api/sessions/:id/ask` beside the existing `/dialog` route at line 274)
- Test: `server/test/ask-route.test.ts`

**Interfaces:**
- Consumes: `sessionBucket` is unrelated; this uses `readHookState` (`server/src/hookstate.ts`) and `SendDeps`/`d.queue` (`server/src/inject/send.ts`).
- Produces: `askKey(ask: HookAsk | null): string | null`; `answerAsk(d: AskDeps, id: string, key: string, indexes: readonly number[]): Promise<AskResult>`; the wire field `{ type: 'ask'; ask: HookAsk; key: string | null }` that Tasks 7–9 read.

- [ ] **Step 1: Write the failing test for the key**

Create `server/test/ask-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { askKey } from '../src/askkey.js';

const ask = (question: string, labels: string[]) => ({
  questions: [{ question, options: labels.map((label) => ({ label })) }],
});

describe('askKey', () => {
  it('is stable across re-reads of the same envelope', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .toBe(askKey(ask('Which colour?', ['Red', 'Blue'])));
  });

  it('changes when the question changes', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which shape?', ['Red', 'Blue'])));
  });

  it('changes when an option label changes', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which colour?', ['Red', 'Green'])));
  });

  it('changes when options are reordered — position is part of the answer', () => {
    expect(askKey(ask('Which colour?', ['Red', 'Blue'])))
      .not.toBe(askKey(ask('Which colour?', ['Blue', 'Red'])));
  });

  it('has no key for an approval envelope — those answer through the pane path', () => {
    expect(askKey({ approval: { tool: 'Bash', summary: 'rm -rf /tmp/x' } })).toBeNull();
  });

  it('has no key for a null ask or an empty questions array', () => {
    expect(askKey(null)).toBeNull();
    expect(askKey({ questions: [] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run test/ask-route.test.ts`
Expected: FAIL — cannot resolve `../src/askkey.js`.

- [ ] **Step 3: Implement the key**

Create `server/src/askkey.ts`:

```ts
import { createHash } from 'node:crypto';
import type { HookAsk } from '../../shared/api.js';

/**
 * Stable digest of a questions envelope's CONTENT — the first question's text
 * and its option labels, in order.
 *
 * This is the server-side twin of the correspondence gate `DialogSheet` got in
 * Build 1's fix wave: a client answers the question it was SHOWN, or it does
 * not answer. Content, not coordinates, so a re-render cannot forge it and a
 * reordered menu cannot silently redirect an answer to a different option.
 *
 * Approval envelopes deliberately have no key: they are answered through the
 * pane dialog path, where the rendered rows are the truth.
 */
export function askKey(ask: HookAsk | null): string | null {
  if (ask === null || !('questions' in ask)) return null;
  const q = ask.questions[0];
  if (q === undefined) return null;
  const material = JSON.stringify([q.question, q.options.map((o) => o.label)]);
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run test/ask-route.test.ts`
Expected: PASS, 6/6.

- [ ] **Step 5: Write the failing test for the route logic**

Append to `server/test/ask-route.test.ts`:

```ts
import { answerAsk } from '../src/inject/ask.js';
import { KeyedQueue } from '../src/inject/queue.js';

function deps(overrides: Partial<Parameters<typeof answerAsk>[0]> = {}) {
  const keys: string[] = [];
  return {
    keys,
    d: {
      queue: new KeyedQueue(),
      tmux: {
        capture: async () => 'pane',
        captureAnsi: async () => 'pane',
        sendKey: async (_id: string, k: string) => { keys.push(k); },
        sendLiteral: async (_id: string, t: string) => { keys.push(`lit:${t}`); },
      } as never,
      readAsk: async () => ({ ask: ask('Which colour?', ['Red', 'Blue']), state: 'waiting' as const }),
      sleep: async () => {},
      ...overrides,
    },
  };
}

describe('answerAsk', () => {
  it('sends the digit alone for a single-select answer', async () => {
    const { keys, d } = deps();
    const r = await answerAsk(d as never, 'cc-x', askKey(ask('Which colour?', ['Red', 'Blue']))!, [1]);
    expect(r).toEqual({ ok: true });
    expect(keys).toEqual(['2']);   // 0-based index 1 → the digit 2; it selects AND confirms
  });

  it('refuses a key that does not match the current envelope', async () => {
    const { keys, d } = deps();
    const r = await answerAsk(d as never, 'cc-x', 'deadbeefdeadbeef', [0]);
    expect(r).toEqual({ ok: false, error: 'ask-mismatch' });
    expect(keys).toEqual([]);      // nothing was pressed
  });

  it('refuses when the hook is not waiting', async () => {
    const { d } = deps({ readAsk: async () => ({ ask: null, state: 'working' as const }) });
    expect(await answerAsk(d as never, 'cc-x', 'k', [0])).toEqual({ ok: false, error: 'not-waiting' });
  });

  it('refuses an out-of-range index', async () => {
    const { d } = deps();
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [7])).toEqual({ ok: false, error: 'range' });
  });

  it('refuses multiple indexes when the question is not multiSelect', async () => {
    const { d } = deps();
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [0, 1])).toEqual({ ok: false, error: 'multiselect' });
  });

  it('sends every digit then Enter for a multiSelect answer', async () => {
    const multi = { questions: [{ question: 'Pick some', multiSelect: true,
      options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] }] };
    const { keys, d } = deps({ readAsk: async () => ({ ask: multi, state: 'waiting' as const }) });
    const r = await answerAsk(d as never, 'cc-x', askKey(multi)!, [0, 2]);
    expect(r).toEqual({ ok: true });
    expect(keys).toEqual(['1', '3', 'Enter']);
  });

  it('refuses an approval envelope — those are the pane path', async () => {
    const { d } = deps({ readAsk: async () => ({ ask: { approval: { tool: 'Bash', summary: '' } }, state: 'waiting' as const }) });
    expect(await answerAsk(d as never, 'cc-x', 'k', [0])).toEqual({ ok: false, error: 'ask-mismatch' });
  });

  it('refuses a dead pane', async () => {
    const { d } = deps();
    (d.tmux as { capture: () => Promise<string | null> }).capture = async () => null;
    const key = askKey(ask('Which colour?', ['Red', 'Blue']))!;
    expect(await answerAsk(d as never, 'cc-x', key, [0])).toEqual({ ok: false, error: 'not-alive' });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd server && npx vitest run test/ask-route.test.ts`
Expected: FAIL — cannot resolve `../src/inject/ask.js`.

- [ ] **Step 7: Implement the route logic**

Create `server/src/inject/ask.ts`:

```ts
import type { SendDeps } from './send.js';
import type { HookAsk } from '../../../shared/api.js';
import { askKey } from '../askkey.js';

export interface AskDeps extends SendDeps {
  /** The session's CURRENT hook state, re-read at answer time — never the copy
   *  the client was shown. This is what makes the key check meaningful. */
  readAsk: (id: string) => Promise<{ ask: HookAsk | null; state: 'working' | 'waiting' | 'done' } | null>;
}

export type AskResult =
  | { ok: true }
  | { ok: false; error: 'not-alive' | 'not-waiting' | 'stale-ask' | 'ask-mismatch' | 'range' | 'multiselect' };

/**
 * Answer a hook-reported AskUserQuestion by option index, without the pane
 * coordinates `answerDialog` needs.
 *
 * MEASURED, Build 1 live probe against Claude Code 2.1.222: a DIGIT ALONE both
 * selects and confirms a single-select question — no Enter, and sending one
 * would submit the NEXT thing. Multi-select is the opposite: each digit toggles
 * and Enter commits, which is why it is this route's acceptance test.
 *
 * Fail-shut, in order, each hazard with its own name (analysis Tier-1 #4).
 */
export async function answerAsk(
  d: AskDeps,
  id: string,
  key: string,
  indexes: readonly number[],
): Promise<AskResult> {
  return d.queue.run(id, async (): Promise<AskResult> => {
    if ((await d.tmux.capture(id)) === null) return { ok: false, error: 'not-alive' };

    const hs = await d.readAsk(id);
    if (hs === null) return { ok: false, error: 'stale-ask' };
    if (hs.state !== 'waiting') return { ok: false, error: 'not-waiting' };

    // An approval envelope keys to null, so it can never match a client key —
    // the mismatch branch below is its refusal, and it is the right one.
    const current = askKey(hs.ask);
    if (current === null || current !== key) return { ok: false, error: 'ask-mismatch' };

    const q = (hs.ask as { questions: { multiSelect?: boolean; options: unknown[] }[] }).questions[0]!;
    if (indexes.length === 0) return { ok: false, error: 'range' };
    if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= q.options.length)) {
      return { ok: false, error: 'range' };
    }
    // Digits are the transport, so an option past the ninth has no keystroke.
    if (indexes.some((i) => i > 8)) return { ok: false, error: 'range' };
    if (indexes.length > 1 && q.multiSelect !== true) return { ok: false, error: 'multiselect' };

    for (const i of indexes) await d.tmux.sendKey(id, String(i + 1));
    // Single-select needs NO Enter — the digit already confirmed. Pressing one
    // would land on whatever the TUI showed next.
    if (indexes.length > 1) await d.tmux.sendKey(id, 'Enter');
    return { ok: true };
  });
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd server && npx vitest run test/ask-route.test.ts`
Expected: PASS, 15/15.

- [ ] **Step 9: Ship the key on the stream and register the route**

In `shared/api.ts`, change the stream message:

```ts
  | { type: 'ask'; ask: HookAsk; key: string | null }   // key: answerable via POST /api/sessions/:id/ask; null for approval envelopes
```

In `server/src/sessionws.ts`, in `checkHookAsk`, change the send to:

```ts
    this.send(ask === null ? { type: 'ask_cleared' } : { type: 'ask', ask, key: askKey(ask) });
```

with `import { askKey } from './askkey.js';`. **Leave `lastAskJson`'s change gate exactly as it is** — it hashes the ask, and the key is a function of the ask, so it cannot disagree.

In `server/src/server.ts`, immediately after the `/dialog` route:

```ts
  app.post('/api/sessions/:id/ask', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const body = (req.body ?? {}) as { askKey?: unknown; optionIndexes?: unknown };
    if (typeof body.askKey !== 'string' ||
        !Array.isArray(body.optionIndexes) ||
        !body.optionIndexes.every((n) => typeof n === 'number')) {
      return reply.code(400).send({ ok: false, error: 'bad-request' });
    }
    const res = await answerAsk(askDeps, id, body.askKey, body.optionIndexes);
    return res.ok ? res : reply.code(409).send(res);
  });
```

Build `askDeps` beside the existing `sendDeps`, adding:

```ts
    readAsk: async (id: string) => {
      const rec = (await readRegistry(deps.io, deps.cfg)).find((r) => r.id === id) ?? null;
      if (rec === null) return null;
      const hs = await readHookState(deps.io, deps.cfg.registryDir, id, rec.uuid, Date.now());
      return hs === null ? null : { ask: hs.ask, state: hs.state };
    },
```

- [ ] **Step 10: Run the full suites and commit**

```bash
cd server && npx vitest run && npx tsc --noEmit
cd ../pwa && npx vitest run && npx tsc --noEmit
```
Expected: green. Fix any `{ type: 'ask' }` factory in the PWA suite that now needs `key`.

```bash
git add -A shared server pwa
git commit -m "feat(server): answer a hook-reported ask by index, gated on a content key"
```

---

### Task 3: The submit route — an affordance for the swallowed Enter

**Files:**
- Modify: `server/src/inject/send.ts` (add `submitEnter`, exported beside `sendPrompt`)
- Modify: `server/src/server.ts` (register `POST /api/sessions/:id/submit`)
- Test: `server/test/submit-route.test.ts`

**Interfaces:**
- Consumes: `SendDeps`, `draftOf`, `submitted`, `hasMenu` — all already in `send.ts`.
- Produces: `submitEnter(d: SendDeps, id: string): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'dialog-open' | 'nothing-to-submit' | 'enter-ignored' }>`, consumed by Task 9's toast action.

**Background the implementer needs:** `sendPrompt` already polls up to 12 × 200 ms for the box to echo the text, presses Enter, proves *our text left the box* via `submitted()`, and presses a second Enter if it didn't. `enter-ignored` is the path where **both** Enters were swallowed and the text was deliberately left in the box. This task does not add a settle — it adds the one-tap rescue the operator currently has to open a terminal for. Do **not** add a server-side retry loop: two Enters already failed, and a third blind one carries no new information.

- [ ] **Step 1: Write the failing test**

Create `server/test/submit-route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { submitEnter } from '../src/inject/send.js';
import { KeyedQueue } from '../src/inject/queue.js';

const BOX = (text: string) => `some scrollback\n❯ ${text}\n`;
const EMPTY_BOX = '❯ \n';
const MENU = 'Do you want to proceed?\n❯ 1. Yes\n  2. No\n';

function deps(frames: string[]) {
  const keys: string[] = [];
  let i = 0;
  return {
    keys,
    d: {
      queue: new KeyedQueue(),
      sleep: async () => {},
      tmux: {
        capture: async () => frames[Math.min(i, frames.length - 1)] ?? null,
        captureAnsi: async () => frames[Math.min(i++, frames.length - 1)] ?? null,
        sendKey: async (_id: string, k: string) => { keys.push(k); },
        sendLiteral: async () => {},
      } as never,
    },
  };
}

describe('submitEnter', () => {
  it('presses Enter once and reports ok when the text leaves the box', async () => {
    const { keys, d } = deps([BOX('hello there'), EMPTY_BOX]);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: true });
    expect(keys).toEqual(['Enter']);
  });

  it('refuses an empty box — there is nothing to send', async () => {
    const { keys, d } = deps([EMPTY_BOX]);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'nothing-to-submit' });
    expect(keys).toEqual([]);
  });

  it('refuses while a menu owns the keyboard', async () => {
    const { keys, d } = deps([MENU]);
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'dialog-open' });
    expect(keys).toEqual([]);
  });

  it('refuses a dead pane', async () => {
    const d = { queue: new KeyedQueue(), sleep: async () => {},
      tmux: { captureAnsi: async () => null, sendKey: async () => {} } as never };
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'not-alive' });
  });

  it('reports enter-ignored when the text is still there, and does NOT press again', async () => {
    const { keys, d } = deps([BOX('hello there')]);   // every frame identical
    expect(await submitEnter(d as never, 'cc-x')).toEqual({ ok: false, error: 'enter-ignored' });
    expect(keys).toEqual(['Enter']);   // exactly one — no blind retry loop
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run test/submit-route.test.ts`
Expected: FAIL — `submitEnter` is not exported.

- [ ] **Step 3: Implement it**

Append to `server/src/inject/send.ts`:

```ts
/**
 * Press Enter once on a box that already holds text.
 *
 * The rescue for `sendPrompt`'s `enter-ignored`: the text is verified present
 * and the operator's only remedy today is the sentence "open the terminal to
 * check". A message that tells the user to do something the UI could do is the
 * same dead end as a hidden force-delete button.
 *
 * ONE Enter, verified. `sendPrompt` already spent two on this box; a third
 * fired in a loop would carry no information the first two didn't. A human tap
 * does: they looked at the pane first.
 */
export function submitEnter(
  d: SendDeps,
  id: string,
): Promise<{ ok: true } | { ok: false; error: 'not-alive' | 'dialog-open' | 'nothing-to-submit' | 'enter-ignored' }> {
  const sleep = d.sleep ?? defaultSleep;
  return d.queue.run(id, async () => {
    const pane = await d.tmux.captureAnsi(id);
    if (pane === null) return { ok: false, error: 'not-alive' as const };
    // Same reasoning as sendPrompt's own guard: with a menu up the only `❯` on
    // screen is the cursor on the selected OPTION, so draftOf would read a menu
    // row as a draft and this would press Enter on somebody's question.
    if (hasMenu(pane.replace(SGR, ''))) return { ok: false, error: 'dialog-open' as const };
    const draft = draftOf(pane);
    if (draft === '') return { ok: false, error: 'nothing-to-submit' as const };

    await d.tmux.sendKey(id, 'Enter');
    // The same proof sendPrompt uses: OUR TEXT left the box, not "the box is
    // empty" — a busy session swaps the row for its queue hint instead.
    const needle = draft.slice(0, ECHO_NEEDLE);
    return (await submitted(d, id, sleep, needle))
      ? { ok: true as const }
      : { ok: false, error: 'enter-ignored' as const };
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd server && npx vitest run test/submit-route.test.ts`
Expected: PASS, 5/5.

- [ ] **Step 5: Register the route**

In `server/src/server.ts`, after the `/interrupt` route:

```ts
  app.post('/api/sessions/:id/submit', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await knownId(id))) return reply.code(404).send({ ok: false, error: 'unknown-session' });
    const res = await submitEnter(sendDeps, id);
    return res.ok ? res : reply.code(409).send(res);
  });
```

- [ ] **Step 6: Run the full suites and commit**

```bash
cd server && npx vitest run && npx tsc --noEmit
```

```bash
git add -A server
git commit -m "feat(server): POST /submit — one verified Enter for a swallowed send"
```

---

### Task 4: Notification log (seq + epoch) and copy discipline

**Files:**
- Create: `server/src/notifylog.ts`
- Create: `server/src/presence.ts`
- Modify: `server/src/push.ts` (`PushPayload` gains `actions?`)
- Modify: `server/src/watch.ts:179-186, 385-392, 430-439` (the three push sites)
- Modify: `server/src/server.ts` (the `/ws/session/:id` handler accepts a `visible` message; a `GET /api/notifications/catchup` route)
- Modify: `shared/api.ts` (`NotifyEvent`, `CatchUp`, and the session-stream client message)
- Test: `server/test/notifylog.test.ts`, `server/test/push-copy.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces: `class NotifyLog { record(e): NotifyEvent; catchUp(epoch: string | null, seq: number): CatchUp; readonly epoch: string; readonly seq: number }`, `class Presence { setVisible(token: symbol, id: string | null): void; drop(token: symbol): void; isVisible(id: string): boolean }`, and `PushPayload.actions?: { action: string; title: string }[]` consumed by Task 8.

- [ ] **Step 1: Write the failing test for the log**

Create `server/test/notifylog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NotifyLog } from '../src/notifylog.js';

const dir = async () => mkdtemp(path.join(tmpdir(), 'notifylog-'));

describe('NotifyLog', () => {
  it('persists epoch and seq as ONE atomic JSON value', async () => {
    const p = path.join(await dir(), 'n.json');
    const log = new NotifyLog(p);
    await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: 't', body: 'b' });
    await log.flush();
    const raw = JSON.parse(await readFile(p, 'utf8')) as { epoch: string; seq: number };
    // ONE object. A seq without its counter's lifetime is meaningless: written
    // separately, a death between the two writes forges a valid-looking pair
    // and silently drops real notifications.
    expect(Object.keys(raw).sort()).toEqual(['epoch', 'seq']);
    expect(raw.seq).toBe(1);
  });

  it('keeps its epoch across a reload, so a client seq stays trustworthy', async () => {
    const p = path.join(await dir(), 'n.json');
    const a = new NotifyLog(p); await a.load();
    a.record({ kind: 'ask', sessionId: 'cc-a', title: 't', body: 'b' });
    await a.flush();
    const b = new NotifyLog(p); await b.load();
    expect(b.epoch).toBe(a.epoch);
    expect(b.seq).toBe(1);
  });

  it('mints a NEW epoch when the file is missing, unreadable or malformed', async () => {
    const d = await dir();
    const a = new NotifyLog(path.join(d, 'a.json')); await a.load();
    const p = path.join(d, 'b.json');
    await writeFile(p, '{ this is not json');
    const b = new NotifyLog(p); await b.load();
    expect(b.epoch).not.toBe(a.epoch);
    expect(b.seq).toBe(0);
  });

  it('returns the events strictly after the client seq', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: '1', body: '' });
    log.record({ kind: 'done', sessionId: 'cc-b', title: '2', body: '' });
    const r = log.catchUp(log.epoch, 1);
    expect(r).toMatchObject({ resync: false });
    expect(r.events.map((e) => e.title)).toEqual(['2']);
  });

  it('demands a resync when the epoch differs — the seq means nothing', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    log.record({ kind: 'ask', sessionId: 'cc-a', title: '1', body: '' });
    expect(log.catchUp('some-other-epoch', 0)).toMatchObject({ resync: true, events: [] });
  });

  it('demands a resync when the client seq predates the ring', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json'), 3); await log.load();
    for (let i = 0; i < 5; i++) log.record({ kind: 'done', sessionId: 'cc-a', title: String(i), body: '' });
    // seq 1 was evicted, so "everything after 1" cannot be proven complete.
    expect(log.catchUp(log.epoch, 1)).toMatchObject({ resync: true });
    expect(log.catchUp(log.epoch, 3)).toMatchObject({ resync: false });
  });

  it('demands a resync for a client that has never seen an epoch', async () => {
    const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
    expect(log.catchUp(null, 0)).toMatchObject({ resync: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && npx vitest run test/notifylog.test.ts`
Expected: FAIL — cannot resolve `../src/notifylog.js`.

- [ ] **Step 3: Add the wire types**

In `shared/api.ts`:

```ts
/** One notification the server actually fired. The log is a record of what was
 *  PUSHED, so it can never claim more than push did. */
export interface NotifyEvent {
  seq: number; at: number;
  kind: 'ask' | 'done' | 'merged';
  sessionId: string; title: string; body: string;
}

/** `resync: true` means "I cannot prove you saw everything" — the epoch moved,
 *  or the client's seq predates what is still retained. The client's answer is
 *  to drop its watermark and trust the fleet snapshot, never to fabricate
 *  badges for events it cannot enumerate. */
export interface CatchUp { epoch: string; seq: number; resync: boolean; events: NotifyEvent[] }
```

and extend the session-stream client message union (add it if none exists):

```ts
/** PWA → server, on the per-session socket. `visible` is the operator's own
 *  report that this session is on screen and focused; the server suppresses
 *  pushes for it while any client says so. */
export type SessionClientMsg = { type: 'visible'; visible: boolean };
```

- [ ] **Step 4: Implement the log**

Create `server/src/notifylog.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CatchUp, NotifyEvent } from '../../shared/api.js';

const RING = 200;

/**
 * The notifications this server fired, with a seq the client can watermark
 * against — and the epoch that makes the seq mean anything.
 *
 * Orca's torn-write reasoning, adopted whole: a seq is meaningless without the
 * counter's LIFETIME. Written as two values, a death between the two writes
 * forges a valid-looking pair, and the client silently drops real
 * notifications believing it has already seen them. So {epoch, seq} is ONE
 * JSON object in ONE file, written tmp + rename — the same discipline
 * `push.ts` already uses for the subscription store.
 *
 * A new epoch is not an error path. It is the signal that says "stop trusting
 * your seq", and it is minted whenever continuity cannot be PROVEN: no file, an
 * unreadable one, a malformed one.
 */
export class NotifyLog {
  private events: NotifyEvent[] = [];
  private _epoch = '';
  private _seq = 0;

  constructor(private readonly storePath: string, private readonly ring = RING) {}

  get epoch(): string { return this._epoch; }
  get seq(): number { return this._seq; }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.storePath, 'utf8')) as unknown;
      if (raw !== null && typeof raw === 'object' &&
          typeof (raw as { epoch?: unknown }).epoch === 'string' &&
          typeof (raw as { seq?: unknown }).seq === 'number' &&
          Number.isInteger((raw as { seq: number }).seq) && (raw as { seq: number }).seq >= 0) {
        this._epoch = (raw as { epoch: string }).epoch;
        this._seq = (raw as { seq: number }).seq;
        return;
      }
    } catch { /* missing or unreadable — fall through to a fresh epoch */ }
    this._epoch = randomUUID();
    this._seq = 0;
  }

  record(e: Omit<NotifyEvent, 'seq' | 'at'>): NotifyEvent {
    const ev: NotifyEvent = { ...e, seq: ++this._seq, at: Date.now() };
    this.events.push(ev);
    if (this.events.length > this.ring) this.events.splice(0, this.events.length - this.ring);
    return ev;
  }

  /** Never rejects: a failed flush costs at most a re-minted epoch on the next
   *  boot, which is exactly the conservative answer. */
  async flush(): Promise<void> {
    try {
      await mkdir(path.dirname(this.storePath), { recursive: true });
      const tmp = `${this.storePath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ epoch: this._epoch, seq: this._seq }));
      await rename(tmp, this.storePath);
    } catch { /* best effort, by design */ }
  }

  catchUp(epoch: string | null, seq: number): CatchUp {
    const oldest = this.events[0]?.seq ?? this._seq + 1;
    // Both branches mean the same thing: I cannot PROVE you saw everything.
    const resync = epoch !== this._epoch || seq < oldest - 1;
    return {
      epoch: this._epoch, seq: this._seq, resync,
      events: resync ? [] : this.events.filter((e) => e.seq > seq),
    };
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd server && npx vitest run test/notifylog.test.ts`
Expected: PASS, 7/7.

- [ ] **Step 6: Write the failing test for copy discipline**

Create `server/test/push-copy.test.ts`, copying the `deps` builder from the
existing `server/test/watch*.test.ts` harness verbatim and adding a fake push
that records payloads plus a real `Presence`:

```ts
const sent: PushPayload[] = [];
const push = { notify: async (p: PushPayload) => { sent.push(p); } };
const presence = new Presence();

it('omits the project from the title when only one project is active', async () => {
  // Two sessions, ONE project, both transitioning busy→idle.
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a', 'ccrc-pwa/cc-b'] });
  await w.tick();                    // priming tick — notifies nothing
  markIdle('cc-a');
  await w.tick();
  expect(sent).toHaveLength(1);
  expect(sent[0]!.title).toBe('✓ Finished');       // no ' · ccrc-pwa'
});

it('names the project when more than one is active', async () => {
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a', 'rp-llm/cc-b'] });
  await w.tick();
  markIdle('cc-a');
  await w.tick();
  expect(sent[0]!.title).toBe('✓ Finished · ccrc-pwa');
});

it('fires nothing for a session a client reports visible', async () => {
  const token = Symbol('t');
  presence.setVisible(token, 'cc-a');
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
  await w.tick();
  markIdle('cc-a');
  await w.tick();
  expect(sent).toEqual([]);
});

it('fires again once every client has disconnected', async () => {
  const token = Symbol('t');
  presence.setVisible(token, 'cc-a');
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'] });
  await w.tick();
  presence.drop(token);
  markIdle('cc-a');
  await w.tick();
  expect(sent).toHaveLength(1);
});

it('records into the log only what was actually sent', async () => {
  const token = Symbol('t');
  presence.setVisible(token, 'cc-a');
  const log = new NotifyLog(path.join(await dir(), 'n.json')); await log.load();
  const w = watcher({ push, presence, notifyLog: log, sessions: ['ccrc-pwa/cc-a'] });
  await w.tick(); markIdle('cc-a'); await w.tick();
  // Suppressed by presence, so the catch-up must not claim it happened.
  expect(log.seq).toBe(0);
});
```

- [ ] **Step 7: Implement presence and the copy rules**

Create `server/src/presence.ts`:

```ts
/**
 * Which sessions a human is currently LOOKING AT.
 *
 * Keyed by a per-connection token rather than by session id, so a socket that
 * dies without a close frame takes its own claim with it and cannot leave a
 * session permanently un-notifiable. Nothing here is persisted: presence is
 * true only while someone is connected and saying so, and a server that just
 * restarted correctly believes nobody is watching.
 */
export class Presence {
  private byToken = new Map<symbol, string>();
  setVisible(token: symbol, id: string | null): void {
    if (id === null) this.byToken.delete(token);
    else this.byToken.set(token, id);
  }
  drop(token: symbol): void { this.byToken.delete(token); }
  isVisible(id: string): boolean {
    for (const v of this.byToken.values()) if (v === id) return true;
    return false;
  }
}
```

In `server/src/watch.ts`, add `notifyLog?: NotifyLog` and `presence?: Presence`
to `Deps`, and route all three push sites through one helper:

```ts
  /**
   * Every push goes through here, so the copy rules are stated once.
   *
   *  - Project context ONLY when more than one project is active. The server
   *    knows the whole fleet at push time, so it can tell — and "✓ ccrc-pwa"
   *    on a fleet running one project is noise dressed as information.
   *  - NOTHING fires for a session the operator is looking at right now. A
   *    notification for the pane on your screen trains you to dismiss
   *    notifications.
   *  - The log records what was actually SENT, after both gates, so a
   *    reconnecting client's catch-up can never claim more than push did.
   */
  private pushOne(e: { kind: NotifyEvent['kind']; sessionId: string; project: string; title: string; body: string; actions?: PushPayload['actions'] }, projects: Set<string>): void {
    if (this.deps.presence?.isVisible(e.sessionId)) return;
    const title = projects.size > 1 ? `${e.title} · ${e.project}` : e.title;
    this.deps.notifyLog?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body });
    void this.deps.notifyLog?.flush();
    void this.deps.push?.notify({ title, body: e.body, sessionId: e.sessionId, tag: `${e.kind}-${e.sessionId}`, ...(e.actions ? { actions: e.actions } : {}) });
  }
```

`projects` is `new Set(sessions.filter(s => s.status !== 'dead').map(s => s.project))`,
computed once per tick and passed in. Rewrite the three existing `push.notify`
calls to build `{kind, sessionId, project, title, body}` and call `pushOne`.
Keep every existing edge gate (`prevStatus` busy→idle, `dialogIds` changed,
`already archived`) exactly as it is.

In `server/src/push.ts`, extend the payload:

```ts
export interface PushPayload {
  title: string;
  body: string;
  sessionId?: string;
  tag?: string;
  /** Up to TWO — the platform ceiling on Android, and the reason the ask push
   *  sends the first two option labels and deep-links for the rest. Ignored by
   *  an older service worker, which simply shows the notification. */
  actions?: { action: string; title: string }[];
}
```

and pass `actions` through to `showNotification` by including it in the JSON
body (no change needed in `notify()` — it already stringifies the whole payload).

- [ ] **Step 8: Wire presence, the log and the catch-up route**

In `server/src/server.ts`:

```ts
  app.get('/ws/session/:id', { websocket: true }, (socket, req) => {
    /* …existing stream setup… */
    const token = Symbol('viewer');
    socket.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type?: unknown; visible?: unknown };
        if (m.type === 'visible' && typeof m.visible === 'boolean') {
          presence.setVisible(token, m.visible ? id : null);
        }
      } catch { /* a client that sends garbage simply isn't reporting presence */ }
    });
    socket.on('close', () => { presence.drop(token); stream.stop(); });
  });

  app.get('/api/notifications/catchup', async (req) => {
    const q = req.query as { epoch?: string; seq?: string };
    const seq = Number(q.seq);
    return notifyLog.catchUp(q.epoch ?? null, Number.isFinite(seq) ? seq : 0);
  });
```

Construct `notifyLog` where `PushService` is constructed (same directory as the
subscription store) and `await notifyLog.load()` before the server listens.

- [ ] **Step 9: Run the full suites and commit**

```bash
cd server && npx vitest run && npx tsc --noEmit
cd ../pwa && npx tsc --noEmit
```

```bash
git add -A shared server
git commit -m "feat(server): seq+epoch notification log, presence suppression, push copy discipline"
```

- [ ] **Step 10: Open PR D**

```bash
git push -u origin feat/bucket-authority
gh pr create --title "feat: bucket authority, ask/submit routes, notification log" --body "Build 2 PR D — server half of docs/superpowers/specs/2026-08-06-attention-ux-design.md (Tasks 1–4)."
```
Do **not** merge; report the PR number.

---

### Task 5: The unseen watermark

**Files:**
- Create: `pwa/src/lib/seen.ts`
- Test: `pwa/test/seen.test.ts`

**Interfaces:**
- Consumes: `FleetSession` (`bucket`, `bucketSince` from Task 1).
- Produces: `loadAcks(): Acks`, `isUnseen(s: FleetSession, acks: Acks): boolean`, `ack(id: string, at: number): Acks`, `ackAll(sessions: readonly FleetSession[], at: number): Acks`, `prune(live: ReadonlySet<string>): Acks` — all consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Create `pwa/test/seen.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadAcks, isUnseen, ack, prune, ackAll } from '../src/lib/seen';
import type { FleetSession } from '../../shared/api';

const s = (over: Partial<FleetSession>): FleetSession =>
  ({ id: 'cc-a', bucket: 'attention', bucketSince: 1000, ...over } as FleetSession);

beforeEach(() => localStorage.clear());

describe('seen watermark', () => {
  it('is unseen when the bucket started after the ack', () => {
    expect(isUnseen(s({}), { 'cc-a': 999 })).toBe(true);
  });

  it('is seen when the ack is at or after the bucket start', () => {
    expect(isUnseen(s({}), { 'cc-a': 1000 })).toBe(false);
    expect(isUnseen(s({}), { 'cc-a': 1001 })).toBe(false);
  });

  it('is unseen with no ack at all', () => {
    expect(isUnseen(s({}), {})).toBe(true);
  });

  it('never badges working or idle — nothing is being asked of you', () => {
    expect(isUnseen(s({ bucket: 'working' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'idle' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'dead' }), {})).toBe(false);
    expect(isUnseen(s({ bucket: 'archived' }), {})).toBe(false);
  });

  it('badges attention, done and cleanup', () => {
    for (const bucket of ['attention', 'done', 'cleanup'] as const) {
      expect(isUnseen(s({ bucket }), {})).toBe(true);
    }
  });

  it('is seen when there is no evidence of when the bucket began', () => {
    // A null bucketSince cannot prove anything is new; badging it would fire on
    // every render forever.
    expect(isUnseen(s({ bucketSince: null }), {})).toBe(false);
  });

  it('round-trips through localStorage', () => {
    ack('cc-a', 4242);
    expect(loadAcks()).toEqual({ 'cc-a': 4242 });
  });

  it('survives a corrupt store by starting empty', () => {
    localStorage.setItem('ccrc:seen:v1', 'not json');
    expect(loadAcks()).toEqual({});
  });

  it('prune drops ids that are no longer in the fleet', () => {
    ack('cc-a', 1); ack('cc-gone', 1);
    expect(prune(new Set(['cc-a']))).toEqual({ 'cc-a': 1 });
  });

  it('ackAll marks every given session seen at the given time', () => {
    const acks = ackAll([s({ id: 'cc-a' }), s({ id: 'cc-b' })], 5000);
    expect(acks).toEqual({ 'cc-a': 5000, 'cc-b': 5000 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pwa && npx vitest run test/seen.test.ts`
Expected: FAIL — cannot resolve `../src/lib/seen`.

- [ ] **Step 3: Implement it**

Create `pwa/src/lib/seen.ts`:

```ts
import type { FleetSession } from '../../../shared/api';

const KEY = 'ccrc:seen:v1';

export type Acks = Record<string, number>;

/** The buckets that WANT a human. `working` and `idle` are never badged:
 *  nothing is being asked of you, and a badge that fires for ordinary progress
 *  is a badge you learn to ignore. */
const BADGED: ReadonlySet<FleetSession['bucket']> = new Set(['attention', 'done', 'cleanup']);

/**
 * Per-DEVICE, not per-fleet. ccrc has no user accounts and the server has no
 * notion of a viewer, so "seen" is a property of the person holding the phone —
 * storing it server-side would let the desktop mark the phone's badge read.
 */
export function loadAcks(): Acks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Acks = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function save(acks: Acks): Acks {
  try { localStorage.setItem(KEY, JSON.stringify(acks)); } catch { /* private mode / quota */ }
  return acks;
}

/** THE comparison. Every surface — bucket header counts, row badge, the bell —
 *  calls this one function; a second implementation is the drift it exists to
 *  end. */
export function isUnseen(s: FleetSession, acks: Acks): boolean {
  if (!BADGED.has(s.bucket)) return false;
  if (s.bucketSince === null) return false;
  return s.bucketSince > (acks[s.id] ?? 0);
}

export function ack(id: string, at: number): Acks {
  const acks = loadAcks();
  acks[id] = at;
  return save(acks);
}

export function ackAll(sessions: readonly FleetSession[], at: number): Acks {
  const acks = loadAcks();
  for (const s of sessions) acks[s.id] = at;
  return save(acks);
}

export function prune(live: ReadonlySet<string>): Acks {
  const acks = loadAcks();
  let changed = false;
  for (const id of Object.keys(acks)) if (!live.has(id)) { delete acks[id]; changed = true; }
  return changed ? save(acks) : acks;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd pwa && npx vitest run test/seen.test.ts`
Expected: PASS, 10/10.

- [ ] **Step 5: Commit**

```bash
git add pwa/src/lib/seen.ts pwa/test/seen.test.ts
git commit -m "feat(pwa): per-device unseen watermark keyed on bucketSince"
```

---

### Task 6: The fleet screen reads one bucket

**Files:**
- Modify: `pwa/src/fleet/sortFleet.ts` (delete its private `bucket()`)
- Modify: `pwa/src/fleet/groupFleet.ts` (`attention`/`busy` become reads of `s.bucket`; add `unseen`)
- Modify: `pwa/src/fleet/SessionLine.tsx` (delete its `attention`/`busy`/`state` locals)
- Modify: `pwa/src/components/StatusDot.tsx` (keyed by bucket; `done` gets a check)
- Modify: `pwa/src/components/primitives.css`, `pwa/src/fleet/fleet.css`
- Modify: `pwa/src/screens/FleetScreen.tsx` (bucket sections + counts + "mark all seen")
- Test: `pwa/test/sort-fleet.test.ts`, `pwa/test/group-fleet.test.ts`, `pwa/test/session-line.test.tsx`, `pwa/test/fleet-screen.test.tsx` (all exist — extend them), `pwa/test/contrast.test.ts` (extend)

**Interfaces:**
- Consumes: `s.bucket`, `s.bucketSince` (Task 1); `isUnseen`, `ack`, `ackAll`, `prune`, `loadAcks` (Task 5).
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing tests**

Add to `pwa/test/sort-fleet.test.ts`:

```ts
it('orders by the SERVER bucket, not by a local re-derivation', () => {
  // A session the server calls `attention` sorts first even when its status
  // says idle — the server is the authority and the client no longer guesses.
  const out = sortFleet([
    f({ id: 'b', status: 'busy', bucket: 'working', bucketSince: 2 }),
    f({ id: 'a', status: 'idle', bucket: 'attention', bucketSince: 1 }),
  ]);
  expect(out.map((s) => s.id)).toEqual(['a', 'b']);
});
```

Add to `pwa/test/group-fleet.test.ts`:

```ts
it('counts from the server bucket, so the head cannot contradict its rows', () => {
  const g = groupFleet([
    f({ id: 'a', bucket: 'attention' }), f({ id: 'b', bucket: 'working' }),
  ])[0]!;
  expect(g.attention).toBe(true);
  expect(g.busy).toBe(1);
});

it('reports how many members are unseen', () => {
  const g = groupFleet([f({ id: 'a', bucket: 'attention', bucketSince: 10 })], { 'a': 5 })[0]!;
  expect(g.unseen).toBe(1);
});
```

Add to `pwa/test/session-line.test.tsx`:

```ts
it('renders a check for done, distinct from idle', () => {
  render(<SessionLine session={f({ bucket: 'done' })} onOpen={() => {}} onActions={() => {}} />);
  expect(screen.getByText('done')).toBeTruthy();
  expect(screen.getByRole('img', { name: 'finished' })).toBeTruthy();
});

it('renders the cleanup bucket with its merge facts and no destructive control', () => {
  render(<SessionLine session={f({ bucket: 'cleanup', archivedBytes: 1_288_490_188,
    pr: { phase: 'merged', number: 157 } as never })} onOpen={() => {}} onActions={() => {}} />);
  expect(screen.getByText(/#157/)).toBeTruthy();
  expect(screen.getByText(/1\.2 GB/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /remove|delete/i })).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && npx vitest run test/sort-fleet.test.ts test/group-fleet.test.ts test/session-line.test.tsx`
Expected: FAIL — the components still compute their own state.

- [ ] **Step 3: Delete the re-derivations**

`sortFleet.ts` becomes:

```ts
import type { FleetSession, SessionBucket } from '../../../shared/api';

/** Bucket priority for the LIST — not a re-derivation of which bucket a session
 *  is in (the server decided that), only of what order the buckets read in. */
const RANK: Record<SessionBucket, number> = {
  attention: 0, done: 1, idle: 2, working: 3, cleanup: 4, archived: 5, dead: 6,
};

export function sortFleet(sessions: FleetSession[]): FleetSession[] {
  return [...sessions].sort((a, b) => {
    const r = RANK[a.bucket] - RANK[b.bucket];
    if (r !== 0) return r;
    const ta = a.statusUpdatedAt ?? -Infinity;
    const tb = b.statusUpdatedAt ?? -Infinity;
    if (ta !== tb) return tb - ta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
```

In `groupFleet.ts`: `attention: live.some((m) => m.bucket === 'attention')`,
`busy: live.filter((m) => m.bucket === 'working').length`, and a new
`unseen: live.filter((m) => isUnseen(m, acks)).length` with `acks: Acks = {}` as
a second parameter. **Replace the long "KEEP the `&& !m.dialogPending` clause"
comment** — that clause existed to keep two client-side derivations in
agreement, and both are now one server field; say so, so the next reader
doesn't restore it.

In `SessionLine.tsx`, delete `attention`, `busy`, `dotStatus`, `state` and
derive everything from `session.bucket`:

```ts
const WORD: Record<SessionBucket, string> = {
  attention: 'waiting', working: 'working', done: 'done', idle: 'idle',
  cleanup: 'merged', archived: 'archived', dead: 'exited',
};
const state = WORD[session.bucket];
```

Keep the `dead` guard on the limit warning and the account hue exactly as-is.

- [ ] **Step 4: Two glyphs**

`StatusDot` is keyed by bucket and carries a glyph, not just a colour:

```tsx
const DOT: Record<SessionBucket, { className: string; label: string; glyph: string }> = {
  attention: { className: 'dot dot--attention', label: 'waiting on you', glyph: '●' },
  working:   { className: 'dot dot--busy',      label: 'working',        glyph: '◐' },
  done:      { className: 'dot dot--done',      label: 'finished',       glyph: '✓' },
  idle:      { className: 'dot dot--idle',      label: 'idle',           glyph: '○' },
  cleanup:   { className: 'dot dot--cleanup',   label: 'merged, ready to clean up', glyph: '♻' },
  archived:  { className: 'dot dot--idle',      label: 'archived',       glyph: '○' },
  dead:      { className: 'dot dot--dead',      label: 'not running',    glyph: '✕' },
};
```

Colour alone never carries the distinction — `done` and `idle` were both "not
amber, not busy" before this, which is exactly the fusion Orca's two-glyph rule
names. Keep the existing `role="img"` + `aria-label`; add the glyph as the
element's text content with the animation classes untouched.

Update `pwa/test/contrast.test.ts` for the new `dot--done` / `dot--cleanup`
tokens.

- [ ] **Step 5: Bucket sections on the fleet screen**

In `FleetScreen.tsx`, above the project cards, render one section header per
non-empty bucket in `RANK` order, each showing its count and — when
`unseen > 0` — an unseen badge and a **"Mark all seen"** button calling
`ackAll(sectionSessions, Date.now())`. Counts come from the same array the rows
render; there is no second count. Call `prune(new Set(sessions.map(s => s.id)))`
on every fleet snapshot, and `ack(id, Date.now())` when a session screen opens
(add it to the `/s/<id>` mount in `pwa/src/screens/SessionScreen.tsx`).

The `cleanup` section's rows show `merged #<n>` and the archived size from
`archivedBytes`, and **no destructive control** — the actions sheet keeps that,
with its audit, exactly as today.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd pwa && npx vitest run`
Expected: green, including the extended contrast suite.

- [ ] **Step 7: Commit**

```bash
git add -A pwa
git commit -m "feat(pwa): fleet surfaces read one server bucket; two-glyph vocabulary; unseen badges"
```

---

### Task 7: Subagent rows and the ask envelope's descriptions

**Files:**
- Modify: `pwa/src/fleet/SessionLine.tsx` (the `⑂ N` tally becomes a disclosure)
- Modify: `pwa/src/fleet/fleet.css`
- Modify: `pwa/src/session/DialogSheet.tsx` (render option descriptions)
- Test: `pwa/test/session-line.test.tsx`, `pwa/test/dialog-sheet.test.tsx`

**Interfaces:**
- Consumes: `session.subagents` (already on the wire from Build 1), the `ask` stream envelope.
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing tests**

```tsx
it('expands the subagent tally into named rows with elapsed time', async () => {
  const now = Date.now();
  render(<SessionLine session={f({ bucket: 'working',
    subagents: [{ name: 'code-reviewer', startedAt: now - 65_000 }] })} onOpen={() => {}} onActions={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /1 subagent/ }));
  expect(screen.getByText('code-reviewer')).toBeTruthy();
  expect(screen.getByText(/1m/)).toBeTruthy();
});

it('shows no subagent disclosure when the hook reported an empty set', () => {
  // `[]` is a MEASUREMENT — fresh hook data, nothing running — and `null` is
  // no hook data. Both render nothing; neither is an error.
  render(<SessionLine session={f({ subagents: [] })} onOpen={() => {}} onActions={() => {}} />);
  expect(screen.queryByRole('button', { name: /subagent/ })).toBeNull();
});

it('renders each option description under its label', () => {
  /* envelope with options [{label:'Blue', description:'cool'}] → 'cool' visible */
});

it('offers no rows for a free-text question, only the terminal CTA', () => {
  /* envelope whose question has options: [] → no option buttons,
     'Open terminal to answer' present */
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && npx vitest run test/session-line.test.tsx test/dialog-sheet.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

The tally becomes a `<button aria-expanded>` toggling an indented list of
`{name, elapsed}` rows. **No invented state**: Claude's `SubagentStart/Stop`
hooks give a name and a start time and nothing else, so the row shows a name and
an elapsed time and nothing else — an Orca-style working/blocked glyph here
would be a claim we cannot source. The list is capped by the hook's own 32.

In `DialogSheet.tsx`, render `option.description` under each label (it has been
in the envelope since Build 1 and we were dropping it — this is the "preview"
half of I2). A question whose `options` array is **empty** is free text: render
the question, no rows, and the existing "Open terminal to answer" CTA. Do not
add a text input — typing free text blind is the send-race with worse
consequences, and §4.2's rescue only exists because the text is verified
present.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd pwa && npx vitest run`
Expected: green.

- [ ] **Step 5: Commit and open PR E**

```bash
git add -A pwa
git commit -m "feat(pwa): subagent disclosure rows; ask envelope shows option descriptions"
git push -u origin feat/attention-ui
gh pr create --title "feat: attention UI — buckets, unseen badges, two glyphs" --body "Build 2 PR E (Tasks 5–7)."
```
Do **not** merge; report the PR number.

---

### Task 8: Push-actionable asks

**Files:**
- Modify: `server/src/watch.ts` (the ask push site fills `actions`)
- Modify: `pwa/public/push-sw.js`
- Test: `server/test/push-copy.test.ts` (extend), `pwa/test/push-sw.test.ts` (create)

**Interfaces:**
- Consumes: `askKey` (Task 2), `PushPayload.actions` (Task 4), `POST /api/sessions/:id/ask` (Task 2).
- Produces: nothing later tasks import.

- [ ] **Step 1: Write the failing tests**

Append to `server/test/push-copy.test.ts`:

```ts
it('attaches the first two option labels as actions, carrying the key', async () => {
  const ask = { questions: [{ question: 'Which colour?', options:
    [{ label: 'Red' }, { label: 'Blue' }, { label: 'Green' }] }] };
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'], hookAsk: { 'cc-a': ask } });
  await w.tick(); raiseAsk('cc-a'); await w.tick();
  const key = askKey(ask)!;
  expect(sent[0]!.actions).toEqual([
    { action: `ask:${key}:0`, title: 'Red' },
    { action: `ask:${key}:1`, title: 'Blue' },   // exactly two — the Android ceiling
  ]);
});

it('attaches NO actions to an approval envelope — it has no key', async () => {
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'],
    hookAsk: { 'cc-a': { approval: { tool: 'Bash', summary: 'rm -rf /tmp/x' } } } });
  await w.tick(); raiseAsk('cc-a'); await w.tick();
  expect(sent[0]!.actions).toBeUndefined();
});

it('attaches no actions when the ask came from the pane scrape, not the hook', async () => {
  const w = watcher({ push, presence, sessions: ['ccrc-pwa/cc-a'], hookAsk: {} });
  await w.tick(); raisePaneDialog('cc-a'); await w.tick();
  expect(sent[0]!.actions).toBeUndefined();   // no envelope ⇒ no key ⇒ nothing to answer blind
});
```

Create `pwa/test/push-sw.test.ts`, loading `push-sw.js` into a fake `self` with
stub `registration` / `clients` / `fetch`:

```ts
const shown: { title: string; opts: Record<string, unknown> }[] = [];
const fakeSelf = () => ({
  listeners: {} as Record<string, (e: unknown) => void>,
  addEventListener(t: string, fn: (e: unknown) => void) { this.listeners[t] = fn; },
  registration: { showNotification: async (title: string, opts: Record<string, unknown>) => { shown.push({ title, opts }); } },
  clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); } },
});
const click = (self: ReturnType<typeof fakeSelf>, action: string, data: unknown, actions: unknown[] = []) => {
  const waits: Promise<unknown>[] = [];
  self.listeners['notificationclick']!({ action, notification: { close() {}, data, actions, tag: 't' },
    waitUntil: (p: Promise<unknown>) => waits.push(p) });
  return Promise.all(waits);
};

it('POSTs the answer for the tapped action and confirms', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) }) as never;
  const self = load();
  await click(self, 'ask:abc123:1', { sessionId: 'cc-a' }, [{ action: 'ask:abc123:1', title: 'Blue' }]);
  expect(posted).toEqual([{ url: '/api/sessions/cc-a/ask', body: { askKey: 'abc123', optionIndexes: [1] } }]);
  expect(shown.at(-1)!.title).toBe('Answered');
  expect(shown.at(-1)!.opts.body).toBe('Blue');
});

it("shows the refusal's own sentence and keeps the deep-link on a 409", async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: 'ask-mismatch' }) }) as never;
  const self = load();
  await click(self, 'ask:abc123:0', { sessionId: 'cc-a' });
  expect(shown.at(-1)!.title).toBe("Couldn't answer");
  expect(shown.at(-1)!.opts.body).toBe('The question changed — open the session and read it.');
  expect((shown.at(-1)!.opts.data as { sessionId: string }).sessionId).toBe('cc-a');
});

it('never silently drops on a network failure', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  const self = load();
  await click(self, 'ask:abc123:0', { sessionId: 'cc-a' });
  expect(shown.at(-1)!.title).toBe('Still unanswered');
});

it('deep-links unchanged when the notification carries no action', async () => {
  const self = load();
  await click(self, '', { sessionId: 'cc-a' });
  expect(opened).toEqual(['/s/cc-a']);
  expect(posted).toEqual([]);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && npx vitest run test/push-copy.test.ts` and `cd pwa && npx vitest run test/push-sw.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the server half**

At the ask push site, when a **fresh hook envelope with questions** exists, take
the first question's first two options and attach:

```ts
      actions: q.options.slice(0, 2).map((o, i) => ({ action: `ask:${key}:${i}`, title: o.label })),
```

Two, because that is the platform ceiling on Android; everything else is reached
by tapping the notification body, which deep-links as it always has. An approval
envelope keys to `null` and gets no actions — it is answered on the pane path.

- [ ] **Step 4: Implement the service worker half**

In `pwa/public/push-sw.js`: pass `actions` to `showNotification`, keep them in
`notification.data`, and handle `event.action`:

```js
self.addEventListener('notificationclick', (event) => {
  const action = event.action || '';
  const sid = (event.notification.data && event.notification.data.sessionId) || null;
  // "ask:<key>:<index>" — the key is minted by the same code that computed it
  // server-side and is carried verbatim. The SW never derives an index from a
  // label: a relabelled option would silently answer a different question.
  const m = /^ask:([^:]+):(\d+)$/.exec(action);
  if (!m || !sid) { /* …existing deep-link path, unchanged… */ return; }
  event.notification.close();
  event.waitUntil((async () => {
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sid)}/ask`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ askKey: m[1], optionIndexes: [Number(m[2])] }),
      });
      if (r.ok) {
        await self.registration.showNotification('Answered', { body: event.notification.actions?.find?.((a) => a.action === action)?.title || '', tag: event.notification.tag, icon: '/icons/icon-192.png' });
        return;
      }
      const b = await r.json().catch(() => ({}));
      // The state moved while the notification sat there. Say which hazard it
      // was and put the human in front of the session — never silently drop.
      await self.registration.showNotification("Couldn't answer", { body: REFUSAL[b.error] || 'The session moved on.', tag: event.notification.tag, data: { sessionId: sid }, icon: '/icons/icon-192.png' });
    } catch {
      await self.registration.showNotification('Still unanswered', { body: 'No connection — tap to open the session.', tag: event.notification.tag, data: { sessionId: sid }, icon: '/icons/icon-192.png' });
    }
  })());
});
```

with the refusal sentences co-located in the same file:

```js
const REFUSAL = {
  'stale-ask': 'That question is gone.',
  'ask-mismatch': 'The question changed — open the session and read it.',
  'not-waiting': 'The session moved on.',
  'range': 'That option no longer exists.',
  'multiselect': 'This one takes more than one answer — open the session.',
  'not-alive': 'That session is no longer running.',
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd server && npx vitest run` and `cd pwa && npx vitest run`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add -A server pwa
git commit -m "feat: answer an ask from the notification itself"
```

---

### Task 9: Reconnect catch-up and the "Send it" rescue

**Files:**
- Modify: `pwa/src/lib/api.ts` (`submit()`, `catchUp()`, refusal sentences)
- Modify: `pwa/src/stores/session.ts` (report visibility; surface the rescue)
- Modify: `pwa/src/session/ChatList.tsx` (the `enter-ignored` toast gains its action)
- Modify: `pwa/src/stores/fleet.ts` (catch-up on connect)
- Test: `pwa/test/api.test.ts`, `pwa/test/session-store.test.ts`, `pwa/test/fleet-store.test.ts`

**Interfaces:**
- Consumes: `POST /api/sessions/:id/submit` (Task 3), `GET /api/notifications/catchup` (Task 4), `SessionClientMsg` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Write the failing tests**

```ts
it('offers "Send it" on enter-ignored and calls POST /submit', async () => {
  server.use(http.post('/api/sessions/cc-a/prompt', () =>
    HttpResponse.json({ ok: false, error: 'enter-ignored' }, { status: 409 })));
  render(<ChatList sessionId="cc-a" />);
  await sendPrompt('hello');
  const btn = await screen.findByRole('button', { name: 'Send it' });
  await userEvent.click(btn);
  expect(posted).toContainEqual({ url: '/api/sessions/cc-a/submit', body: {} });
});

it('shows the submit refusal when the box turned out to be empty', async () => {
  server.use(http.post('/api/sessions/cc-a/submit', () =>
    HttpResponse.json({ ok: false, error: 'nothing-to-submit' }, { status: 409 })));
  /* …same arrange as above… */
  expect(await screen.findByText('The box is empty — it went through after all.')).toBeTruthy();
});

it('reports visibility on the session socket', async () => {
  const sock = openSessionStore('cc-a');
  expect(sock.sent).toContainEqual({ type: 'visible', visible: true });
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(sock.sent.at(-1)).toEqual({ type: 'visible', visible: false });
});

it('sends its stored {epoch, seq} on connect and stores what comes back', async () => {
  localStorage.setItem('ccrc:notify:v1', JSON.stringify({ epoch: 'e1', seq: 7 }));
  server.use(http.get('/api/notifications/catchup', ({ request }) => {
    const u = new URL(request.url);
    expect(u.searchParams.get('epoch')).toBe('e1');
    expect(u.searchParams.get('seq')).toBe('7');
    return HttpResponse.json({ epoch: 'e1', seq: 9, resync: false, events: [] });
  }));
  await connectFleet();
  expect(JSON.parse(localStorage.getItem('ccrc:notify:v1')!)).toEqual({ epoch: 'e1', seq: 9 });
});

it('drops the watermark and badges nothing retroactively on resync', async () => {
  localStorage.setItem('ccrc:notify:v1', JSON.stringify({ epoch: 'old', seq: 7 }));
  server.use(http.get('/api/notifications/catchup', () =>
    HttpResponse.json({ epoch: 'new', seq: 3, resync: true, events: [] })));
  await connectFleet();
  expect(JSON.parse(localStorage.getItem('ccrc:notify:v1')!)).toEqual({ epoch: 'new', seq: 3 });
  // A fabricated badge is worse than a missed one: the snapshot already shows
  // every session that currently wants you.
  expect(store.getState().retroBadges).toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd pwa && npx vitest run`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `pwa/src/lib/api.ts`: add `submit(id)` and `catchUp(epoch, seq)`; change the
  `enter-ignored` entry from *"open the terminal to check"* to
  *"Typed it, but the session didn't accept it."* — the sentence no longer sends
  the operator somewhere else, because the button now does the work.
- `ChatList.tsx`: the `enter-ignored` toast gains a **"Send it"** action calling
  `submit(id)`; on its own 409 show that refusal's sentence
  (`nothing-to-submit` → *"The box is empty — it went through after all."*,
  `dialog-open` → *"A question is up; answer that first."*).
- `session.ts`: send `{type:'visible', visible}` on connect and on every
  `visibilitychange`, and `{visible:false}` on unmount.
- `fleet.ts`: on connect, read `{epoch, seq}` from `localStorage`
  (`ccrc:notify:v1`, ONE JSON value — the same torn-write reasoning as the
  server's), call `catchUp`, store the returned pair. On `resync: true`, clear
  the local watermark and take the snapshot as ground truth — **badge nothing
  retroactively**: a fabricated badge is worse than a missed one, and the
  snapshot already shows every session that currently wants you.

- [ ] **Step 4: Run the full suite**

Run: `cd pwa && npx vitest run && npx tsc --noEmit`
Expected: green.

- [ ] **Step 5: Commit and open PR F**

```bash
git add -A pwa
git commit -m "feat(pwa): notification catch-up watermark and a one-tap rescue for a swallowed Enter"
git push -u origin feat/push-actions
gh pr create --title "feat: push actions, catch-up watermark, Send it" --body "Build 2 PR F (Tasks 8–9)."
```
Do **not** merge; report the PR number.

---

## Deploy gate

PR F changes `pwa/public/push-sw.js`, which is **precached by workbox** — a
client holding the old service worker will not show actions until it updates.
That is a degradation, not a break (an old SW simply renders the notification
without buttons, and the body still deep-links), so no ordering constraint
binds server-vs-PWA here. Nothing in Build 2 touches `ccd/` or the fleet host,
so **`deploy.sh agent` is not required** — unlike Build 1, this is a
server+PWA-only deploy.

Verify after deploying, on the live fleet:

1. `/health` returns `{"ok":true}` and the served asset hash matches the build.
2. `/api/fleet` carries `bucket` and `bucketSince` on every session, and at
   least one session sits in a bucket other than `idle`.
3. A session with a live AskUserQuestion reads `bucket: "attention"` with a
   `bucketSince` equal to its hookstate's `updatedAt`.
4. An archived merged workspace reads `bucket: "cleanup"` — **not** `dead`.
5. `GET /api/notifications/catchup?epoch=nope&seq=0` returns `resync: true`;
   a second call with the returned epoch and seq returns `resync: false`.
6. The fleet screen shows bucket sections whose counts equal their row counts.
