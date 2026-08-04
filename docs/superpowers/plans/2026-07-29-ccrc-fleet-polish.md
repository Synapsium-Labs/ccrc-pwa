# Fleet Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the project card carries the account its sessions are *pinned* to, each
session line carries the account it is *actually on*, no row is labelled with a
machine-generated session handle, and the screen is ~18% tighter with its columns
aligned.

**Architecture:** almost entirely PWA. One small server change drops Claude
Code's derived session handles at the wire boundary so `FleetSession.name` means
what its name says; one more adds a `disabled` flag to the accounts response. The
pin is derived in `groupFleet` (pure, already the fleet's only grouping rule), so
the card stays a renderer. Everything else is component and CSS work.

**Tech Stack:** TypeScript, React 19, Fastify, vitest, @testing-library/react.

**Spec:** [`docs/superpowers/specs/2026-07-29-ccrc-fleet-polish-design.md`](../specs/2026-07-29-ccrc-fleet-polish-design.md)

## Global Constraints

- Repo `/srv/projects/OpenClawHetzner`, branch `ccrc/fleet-polish`.
- Suites run from the package dir: `cd infra/ccrc/{server,agent,pwa} && npx vitest run`. Single file: `npx vitest run test/x.test.ts`.
- **Baseline to preserve, measured 2026-07-29: server 400, agent 86, pwa 330.** Typecheck (`npx tsc --noEmit`) clean in all three.
- **Use only CSS tokens that exist in `pwa/src/styles/tokens.css`.** The real set: `--sp-1..--sp-6/8/10/12`, `--text-2xs/xs/sm/base/lg/xl/2xl`, `--ink-primary/secondary/tertiary/disabled`, `--edge-subtle/strong`, `--r-sm/md/lg/xl/full`, `--bg-page/surface/raised/well/sheet`, `--font-ui/mono`, `--status-busy-text`, `--status-attention-text`, `--status-dead-text`, `--acct-*`, `--tap-min`. There is **no** `--danger`, `--attn`, `--live`, `--line`, `--s-N` or `--fs-xs`. Inventing a token silently renders as nothing.
- **The pwa tsconfig sets `noUncheckedIndexedAccess: true` and typechecks `test/` as well as `src/`.** Every indexed read (`arr[0]`, `record[key]`, a regex capture group) is `T | undefined` there. Code in this plan is written for readability, not to satisfy that flag — where it does not compile, narrow it properly (`?.` / `??` / a guard) or use `!` only where the value provably cannot be undefined, and say which you did and why in your report. The server package does **not** set this flag.
- **The pwa package has no `globals: true`.** Any test file that renders more than once must `import { afterEach } from 'vitest'`, `import { cleanup } from '@testing-library/react'`, and call `afterEach(cleanup)`, or DOM leaks across `it` blocks.
- **Never use `userEvent.click` on anything inside a `Sheet`** (vaul). It crashes jsdom in `getTranslate` and makes vitest exit non-zero while printing "passed". Use `fireEvent.click`.
- Every new colour pair goes in `pwa/design/contrast-check.mjs`; the gate must stay at ALL PASS.
- Do not add entries to `infra/ccrc/agent/src/whitelist.ts` — no task here needs one.
- Commit after each task with a real message; no `--no-verify`.

## Deviation from the spec, and why

The spec says `nameSource` should be plumbed onto the wire as a new
`FleetSession` field and the PWA should test `nameSource !== 'derived'`.

**This plan resolves it server-side instead: `fleet.ts` sets `name` to `null`
when `nameSource === 'derived'`.** Same behaviour, three reasons:

1. `FleetSession` is built as an exhaustive object literal in ~10 test fixtures.
   A new required field is mechanical churn across every one of them, for a value
   only one consumer would ever read.
2. The judgement belongs where the raw field is. Shipping `nameSource` to the
   client invites a second consumer to re-derive the rule differently.
3. `name` is already documented as "live display name". Making it *actually* a
   display name is the smaller, truer change — the PWA's existing label chain
   (`name ?? branch ?? workspace ?? id`) then needs no edit at all, and its
   existing tests keep passing unmodified.

The spec's error-handling row *"a session has no `home` (legacy row) → excluded
from the agreement test"* also needs no code: `fleet.ts` already writes
`home: r.home ?? idHomeWrapper(r.id)` and `FleetSession.home` is typed
non-nullable, so the case cannot reach the PWA. Writing a guard for it would be
unreachable code.

## Out of this plan — two follow-up plans

The spec covers three subsystems. This plan is the first; the other two are
separate because each is independently shippable and one is blocked:

- **First-prompt titles.** Needs a new `readFileHead(path, bytes)` primitive on
  `FleetIO` with local, remote and agent implementations. Measured justification:
  the largest live transcript is **368.7 MB**, so a whole-file read is an
  OOM-class hazard, and the first real user message sits at byte offset
  **580–15,590** across the five largest transcripts — a 64 KB head read covers
  the worst case with 4× margin. Independent of this plan: the label chain here
  works without it and the title simply inserts one more rung.
- **PR state.** Blocked on a design question the spec records: `isExecAllowed`
  only checks `args[0]`, so `gh: ['pr']` would permit `pr create` and `pr merge`
  exactly as readily as `pr view`. Needs a decision before any code.

## File Structure

| file | responsibility | task |
|---|---|---|
| `server/src/livestate.ts` | read `nameSource` out of the session file | 1 |
| `server/src/fleet.ts` | drop derived names; nothing else changes | 1 |
| `server/src/limits.ts` | `disabled` on `AccountLimits` from the kill-switch file | 6 |
| `server/src/server.ts` | pass `disabled` through `/api/accounts` | 6 |
| `shared/api.ts` | `disabled: boolean` on `AccountUsage` | 6 |
| `pwa/src/fleet/groupFleet.ts` | derive `pin` per project group | 2 |
| `pwa/src/fleet/ProjectCard.tsx` | pin chip, icon-only `+`, count at 2+ | 2, 4 |
| `pwa/src/fleet/SessionLine.tsx` | away-from-home marker on the account chip | 3 |
| `pwa/src/fleet/SessionActionsSheet.tsx` | the away sentence | 3 |
| `pwa/src/fleet/AccountsStrip.tsx` | hide a disabled account | 6 |
| `pwa/src/fleet/SwapSheet.tsx` | exclude a disabled account from the picker | 6 |
| `pwa/src/fleet/fleet.css` | density, row centring, column tracks, FAB space | 4, 5 |
| `pwa/src/screens/FleetScreen.tsx` | pass `accounts` down for the disabled filter | 6 |
| `pwa/src/session/Composer.tsx` | Enter sends on a fine pointer | 7 |
| `pwa/src/session/SessionHeader.tsx` | `esc` on touch only; breadcrumb title | 7, 8 |
| `pwa/src/session/chat.css` | hide the keycap on a fine pointer | 7 |

---

### Task 1: Drop Claude Code's derived session handles at the wire

**Files:**
- Modify: `infra/ccrc/server/src/livestate.ts:5-8` (interface), `:29-40` (parse)
- Modify: `infra/ccrc/server/src/fleet.ts:43-52`
- Test: `infra/ccrc/server/test/fleet.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LiveState.nameSource: string | null`. `FleetSession.name` is now
  `null` whenever Claude Code declared the name derived — every later task and
  the whole PWA may treat a non-null `name` as worth displaying.

**Context the implementer needs.** Claude Code writes
`<configDir>/sessions/<pid>.json` for each live session, e.g.:

```json
{"pid":1713330,"sessionId":"2a57…","cwd":"/mnt/…/OpenClawHetzner",
 "name":"openclawhetzner-42","nameSource":"derived","status":"busy",
 "statusUpdatedAt":1785324429417,"version":"2.1.220"}
```

`nameSource: "derived"` means Claude Code built the string from the cwd basename
plus a counter — a session handle, not a title. Eight of the nine live sessions
say `derived`; the ninth (`add-mcp-image-attachments`) has **no `nameSource` key
at all**, an older file format, and is a name somebody chose. So the test is
`=== 'derived'` rejects, and **everything else — including absent — keeps the
name.** Testing `=== 'chosen'` would pass eight of nine and throw away the one
name that matters.

- [ ] **Step 1: Write the failing tests**

Append to `infra/ccrc/server/test/fleet.test.ts`:

```ts
describe('derived session handles', () => {
  const build = async (live: Record<string, unknown>) => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    seedSession(home, 'claude2-MekWarLive', 'claude2');
    mkdirSync(path.join(home, '.claude-personal', 'sessions'), { recursive: true });
    writeFileSync(
      path.join(home, '.claude-personal', 'sessions', '40613.json'),
      JSON.stringify({ pid: 40613, sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', ...live }),
    );
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '40613\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const fleet = await assembleFleet(localIO, loadConfig({ CCRC_HOME: home }), new Tmux(run));
    return fleet.find((s) => s.id === 'claude2-MekWarLive')!;
  };

  it('drops a name Claude Code declares derived', async () => {
    expect((await build({ name: 'mekwarlive-e7', nameSource: 'derived' })).name).toBeNull();
  });

  it('keeps a name with no nameSource at all — an older file, chosen by a human', async () => {
    // The ONE live session that carries a real name is exactly this shape.
    // An implementation testing `=== 'chosen'` passes the case above and fails here.
    expect((await build({ name: 'add-mcp-image-attachments' })).name)
      .toBe('add-mcp-image-attachments');
  });

  it('keeps a name whose nameSource is anything but derived', async () => {
    expect((await build({ name: 'refactor-auth', nameSource: 'user' })).name).toBe('refactor-auth');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/server && npx vitest run test/fleet.test.ts`
Expected: the first test FAILS with `expected 'mekwarlive-e7' to be null`. The
other two PASS already (nothing filters yet) — that is correct and expected;
they are the regression guards that stop the fix from over-reaching.

- [ ] **Step 3: Read `nameSource` in `livestate.ts`**

In the `LiveState` interface, add the field after `name`:

```ts
export interface LiveState {
  pid: number; sessionId: string; cwd: string; name: string | null;
  /** Claude Code's own account of where `name` came from. `'derived'` means it
   *  built the string from the cwd basename plus a counter — a session handle,
   *  which is not end-user information. Absent in older files: a name written
   *  before this field existed was chosen, so absent must NOT read as derived. */
  nameSource: string | null;
  status: string; statusUpdatedAt: number | null; version: string | null;
}
```

and in the returned object in `readLiveState`, after the `name` line:

```ts
      nameSource: typeof raw.nameSource === 'string' ? raw.nameSource : null,
```

- [ ] **Step 4: Drop derived names in `fleet.ts`**

In `assembleFleet`, replace the line

```ts
          name = live.name; statusUpdatedAt = live.statusUpdatedAt; version = live.version;
```

with

```ts
          // A derived name is Claude Code's session handle (`openclawhetzner-42`
          // — cwd basename plus a counter), never a description of the work, so
          // it is dropped HERE rather than shipped for the PWA to re-judge.
          // `name` on the wire therefore means "a name worth displaying", and
          // the fleet line's `name ?? branch ?? workspace ?? id` falls through
          // to the branch on its own. Only the exact string 'derived' rejects:
          // an absent nameSource is an older file whose name a human chose.
          name = live.nameSource === 'derived' ? null : live.name;
          statusUpdatedAt = live.statusUpdatedAt; version = live.version;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/ccrc/server && npx vitest run test/fleet.test.ts`
Expected: PASS, all three.

- [ ] **Step 6: Run the full server suite and typecheck**

Run: `cd infra/ccrc/server && npx vitest run && npx tsc --noEmit`
Expected: **403 passed** (400 baseline + 3), no type errors.

- [ ] **Step 7: Commit**

```bash
git add infra/ccrc/server/src/livestate.ts infra/ccrc/server/src/fleet.ts infra/ccrc/server/test/fleet.test.ts
git commit -m "fix(ccrc): drop Claude Code's derived session handles at the wire

8 of 9 live sessions carry name=<cwd-basename>-<counter> with
nameSource=derived — a session handle, not a title. The fleet line
preferred it over the branch, so every row read as a slug.

Only the exact string 'derived' rejects: the one session with a real
name has no nameSource key at all (an older file format), so absent
must not read as derived."
```

---

### Task 2: The project card's pinned account

**Files:**
- Modify: `infra/ccrc/pwa/src/fleet/groupFleet.ts`
- Modify: `infra/ccrc/pwa/src/fleet/ProjectCard.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css` (after `.proj-card-count`, ~line 696)
- Test: `infra/ccrc/pwa/test/groupFleet.test.ts`, `infra/ccrc/pwa/test/project-card.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (server-side only).
- Produces: `FleetGroup.pin: string | null` — the wrapper every session in the
  group calls home, or `null` when they disagree. Task 4 renders it beside the
  project name in the same header row it restructures.

**Context.** ccd keeps two account fields per session: `home` (where it belongs)
and `wrapper` (where it is running). `home` is `string`, never null — the server
writes `home: r.home ?? idHomeWrapper(r.id)`. Pinning is per session, so a
project has a pin only when its sessions agree; `null` therefore means exactly
"they disagree", because a group always holds at least one session.

- [ ] **Step 1: Write the failing tests for the derivation**

Append to `infra/ccrc/pwa/test/groupFleet.test.ts` (reuse that file's existing
session factory; if it is named differently, match the local name):

```ts
describe('pin', () => {
  const at = (id: string, home: string): FleetSession =>
    ({ ...s({ id, project: 'demo' }), home });

  it('is the account all of a project\'s sessions call home', () => {
    const [g] = groupFleet([at('demo-a', 'claude'), at('demo-b', 'claude')]);
    expect(g.pin).toBe('claude');
  });

  it('is null when they disagree — the card must not claim one of them', () => {
    const [g] = groupFleet([at('demo-a', 'claude'), at('demo-b', 'claude2')]);
    expect(g.pin).toBeNull();
  });

  it('is the lone session\'s home for a single-session project', () => {
    const [g] = groupFleet([at('demo-a', 'claude-corp')]);
    expect(g.pin).toBe('claude-corp');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/groupFleet.test.ts`
Expected: FAIL — `Property 'pin' does not exist on type 'FleetGroup'`.

- [ ] **Step 3: Derive the pin in `groupFleet.ts`**

Add to the `FleetGroup` interface:

```ts
  /** The account every session in this project calls home, or null when they
   *  disagree. Pinning is per session (`ccd prefer <id> <wrapper>`), so a
   *  project-level pin only exists where its sessions happen to share one.
   *  Null means DISAGREEMENT, not "unknown": a group always holds at least one
   *  session and `home` is non-nullable on the wire, so there is always at
   *  least one value to compare. */
  pin: string | null;
```

and inside the `for (const [project, members] of byProject)` loop, before
`groups.push`:

```ts
    const pin = members.every((m) => m.home === members[0].home) ? members[0].home : null;
```

then add `pin,` to the pushed object.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/groupFleet.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing render tests**

Append to `infra/ccrc/pwa/test/project-card.test.tsx`:

```ts
describe('pinned account', () => {
  it('shows the account the project is pinned to', () => {
    render(<ProjectCard group={grp({ pin: 'claude-corp' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('team·shared')).toBeInTheDocument();
  });

  it('says "mixed" when the sessions disagree rather than picking one', () => {
    render(<ProjectCard group={grp({ pin: null })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('mixed')).toBeInTheDocument();
  });

  it('names the pin for assistive tech — a bare label reads as decoration', () => {
    render(<ProjectCard group={grp({ pin: 'claude' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('pinned to team·max')).toBeInTheDocument();
  });
});
```

Add `pin: 'claude',` to that file's `grp` factory defaults so every existing test
keeps compiling.

- [ ] **Step 6: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-card.test.tsx`
Expected: FAIL — `Unable to find an element with the text: team·shared`.

- [ ] **Step 7: Render the pin**

In `ProjectCard.tsx`, inside `.proj-card-toggle`, immediately after the
`proj-card-count` span:

```tsx
          {/* The account this project is PINNED to (ccd `home`), which is not
              necessarily where any of its sessions is running — that is on the
              line. `mixed` when the sessions disagree: a header asserting one
              account while two lines show two different ones would be a lie,
              and divergent pins across one project is worth noticing. */}
          <span
            className="proj-card-pin"
            data-mixed={group.pin === null || undefined}
            aria-label={group.pin === null ? 'pinned accounts differ' : `pinned to ${accountLabel(group.pin)}`}
            style={group.pin === null ? undefined : { color: `var(${accountColorVar(group.pin)})` }}
          >
            {group.pin === null ? 'mixed' : accountLabel(group.pin)}
          </span>
```

and extend the import at the top of the file:

```ts
import { accountColorVar, accountLabel } from '../lib/accounts';
```

- [ ] **Step 8: Add the CSS**

In `fleet.css`, after the `.proj-card-attn` rule:

```css
/* Pinned account — mono like every other machine value on this screen, and
   coloured by account so the card and its lines share one identity language.
   `mixed` stays neutral: it names a disagreement, not an account. */
.proj-card-pin {
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  white-space: nowrap;
}
.proj-card-pin[data-mixed] { color: var(--ink-tertiary); }
```

- [ ] **Step 9: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-card.test.tsx test/groupFleet.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full pwa suite and typecheck**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`
Expected: **336 passed** (330 + 6), no type errors. If other test files construct
a `FleetGroup` literal, add `pin: 'claude'` to those too.

- [ ] **Step 11: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/groupFleet.ts infra/ccrc/pwa/src/fleet/ProjectCard.tsx infra/ccrc/pwa/src/fleet/fleet.css infra/ccrc/pwa/test/groupFleet.test.ts infra/ccrc/pwa/test/project-card.test.tsx
git commit -m "feat(ccrc): the project card carries its sessions' pinned account

ccd keeps home (pinned) and wrapper (actual) per session. The card
header now shows the pin its sessions share, and 'mixed' when they
disagree rather than asserting one of them."
```

---

### Task 3: The line marks a session running away from home

**Files:**
- Modify: `infra/ccrc/pwa/src/fleet/SessionLine.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/SessionActionsSheet.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css` (`.sess-acct`, ~line 599)
- Test: `infra/ccrc/pwa/test/session-line.test.tsx`, `infra/ccrc/pwa/test/session-actions-sheet.test.tsx`

**Interfaces:**
- Consumes: `FleetGroup.pin` exists (Task 2) but is not used here — the line
  compares its own two fields.
- Produces: nothing later tasks depend on.

**Context.** `_auto_swap_check` moves a session's `wrapper` off its `home` when
that account's 5h score crosses the swap threshold. Today `wrapper == home` on
all nine live sessions, so this state renders nowhere and cannot be observed from
real data — it must be tested synthetically. The line follows the rule the
hierarchy work set for the limit warning: **a marker on the line, the sentence in
the sheet.**

- [ ] **Step 1: Write the failing line tests**

Append to `infra/ccrc/pwa/test/session-line.test.tsx`:

```ts
describe('away from home', () => {
  it('marks the account chip when the session is not on its pinned account', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).toHaveAttribute('data-away');
  });

  it('does not mark it when the session is home', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude', home: 'claude' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).not.toHaveAttribute('data-away');
  });

  it('says so for assistive tech, which cannot see a colour', () => {
    render(<SessionLine session={s({ wrapper: 'claude2', home: 'claude' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('running on alt·max, pinned to team·max')).toBeInTheDocument();
  });

  it('never marks a dead session — it is not running anywhere', () => {
    const { container } = render(
      <SessionLine session={s({ wrapper: 'claude2', home: 'claude', status: 'dead' })}
                   onOpen={() => {}} onActions={() => {}} />);
    expect(container.querySelector('.sess-acct')).not.toHaveAttribute('data-away');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-line.test.tsx`
Expected: FAIL — `expected null to have attribute "data-away"` on the first test.

- [ ] **Step 3: Mark the chip**

In `SessionLine.tsx`, after the `acctStyle` block, add:

```ts
  // Running somewhere other than its pinned account — ccd's _auto_swap_check
  // moved it when `home` crossed the swap threshold. Dead sessions are exempt:
  // nothing is running, so "away" would describe a journey that ended.
  const away = !dead && session.wrapper !== session.home;
```

and replace the `.sess-acct` span with:

```tsx
      <span
        className="sess-acct"
        style={acctStyle}
        data-away={away || undefined}
        aria-label={
          away
            ? `running on ${accountLabel(session.wrapper)}, pinned to ${accountLabel(session.home)}`
            : undefined
        }
      >
        {accountLabel(session.wrapper)}
        {away && (
          <span className="sess-acct-away" aria-hidden="true">
            ↗
          </span>
        )}
      </span>
```

- [ ] **Step 4: Add the CSS**

Replace the `.sess-acct` rule in `fleet.css` with:

```css
.sess-acct {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: nowrap;
}
/* The arrow, not a colour change: the chip's colour already encodes WHICH
   account, and overloading it with "and it is the wrong one" would lose that. */
.sess-acct-away { margin-left: 2px; color: var(--status-attention-text); }
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-line.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the failing sheet test**

Append to `infra/ccrc/pwa/test/session-actions-sheet.test.tsx` (match that file's
existing session factory name):

```ts
describe('away note', () => {
  it('spells out the swap, which the line only marks', () => {
    render(<SessionActionsSheet session={sess({ wrapper: 'claude2', home: 'claude' })}
                                open onClose={() => {}} />);
    expect(screen.getByText(/Pinned to team·max, running on alt·max/)).toBeInTheDocument();
  });

  it('says nothing when the session is home', () => {
    render(<SessionActionsSheet session={sess({ wrapper: 'claude', home: 'claude' })}
                                open onClose={() => {}} />);
    expect(screen.queryByText(/Pinned to/)).not.toBeInTheDocument();
  });
});
```

If that file's `SessionActionsSheet` render needs a `fleet` store prop, pass the
same one its existing tests pass.

- [ ] **Step 7: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-actions-sheet.test.tsx`
Expected: FAIL — unable to find the text.

- [ ] **Step 8: Add the sentence**

In `SessionActionsSheet.tsx`, immediately before the existing
`{critical && (<p className="sess-sheet-note">…` block:

```tsx
          {session.status !== 'dead' && session.wrapper !== session.home && (
            <p className="sess-sheet-note">
              Pinned to {accountLabel(session.home)}, running on{' '}
              {accountLabel(session.wrapper)} — moved when its account filled up.
            </p>
          )}
```

`accountLabel` is already imported in this file; if it is not, add
`import { accountLabel } from '../lib/accounts';`.

- [ ] **Step 9: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-actions-sheet.test.tsx`
Expected: PASS.

- [ ] **Step 10: Full suite, typecheck, contrast gate**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs`
Expected: **342 passed** (336 + 6), no type errors, contrast ALL PASS.
`--status-attention-text` on `--bg-surface` is an existing gated pair; no new
pair is introduced.

- [ ] **Step 11: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/SessionLine.tsx infra/ccrc/pwa/src/fleet/SessionActionsSheet.tsx infra/ccrc/pwa/src/fleet/fleet.css infra/ccrc/pwa/test/session-line.test.tsx infra/ccrc/pwa/test/session-actions-sheet.test.tsx
git commit -m "feat(ccrc): mark a session running away from its pinned account

wrapper != home is what _auto_swap_check produces and it rendered
nowhere. Marker on the line, full sentence in the actions sheet —
the rule the limit warning already follows."
```

---

### Task 4: Card header — icon-only `+`, count at 2+, projection out of the layout

**Files:**
- Modify: `infra/ccrc/pwa/src/fleet/ProjectCard.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css` (`.proj-add-acct` ~542, `.proj-card-add` ~699)
- Test: `infra/ccrc/pwa/test/project-card.test.tsx`

**Interfaces:**
- Consumes: `FleetGroup.pin` (Task 2), already rendered.
- Produces: nothing later tasks depend on.

**Context, measured on the live page.** `.proj-card-add` is **151px of a 208px
header — 41%** — because it renders `.proj-add-acct` = `alt·max · 99% free`.
That string is identical on all nine cards (the projection is global — where the
*next* workspace lands does not vary by project), and in the desktop sidebar
(`clamp(300px, 25vw, 380px)`) it is sliced mid-character. The account and
headroom keep their place in the button's **accessible name**, where they already
are; only the visible text goes.

- [ ] **Step 1: Write the failing tests**

Append to `infra/ccrc/pwa/test/project-card.test.tsx`:

```ts
describe('the + is icon-only', () => {
  const projected = { wrapper: 'claude2', score: 9 };

  it('renders no visible projection text in the header', () => {
    const { container } = render(
      <ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                   onAddWorkspace={() => {}} projected={projected} />);
    // Structural, not CSS: the element is gone, not hidden.
    expect(container.querySelector('.proj-add-acct')).toBeNull();
    expect(screen.queryByText(/% free/)).not.toBeInTheDocument();
  });

  it('keeps the account and headroom in the accessible name', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByLabelText('New workspace on demo — alt·max, 91% free'))
      .toBeInTheDocument();
  });

  it('carries them as a tooltip too, for a pointer that can hover', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={projected} />);
    expect(screen.getByLabelText(/New workspace on demo/))
      .toHaveAttribute('title', 'New workspace on demo — alt·max, 91% free');
  });

  it('falls back to the plain name before the accounts poll lands', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}}
                        onAddWorkspace={() => {}} projected={null} />);
    expect(screen.getByLabelText('New workspace on demo')).toBeInTheDocument();
  });
});

describe('session count', () => {
  it('is absent when a project holds one — a constant badge says nothing', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });

  it('renders from two upwards', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-card.test.tsx`
Expected: FAIL — `.proj-add-acct` is found, and `1` is in the document.

- [ ] **Step 3: Make the `+` icon-only and gate the count**

In `ProjectCard.tsx`, replace the count span with:

```tsx
          {/* A badge that reads `1` on every card carries no information. Every
              project on the live fleet holds exactly one session. */}
          {group.sessions.length > 1 && (
            <span className="proj-card-count">{group.sessions.length}</span>
          )}
```

and replace the whole `onAddWorkspace &&` button with:

```tsx
        {onAddWorkspace && (
          <button
            type="button"
            className="proj-card-add"
            /* The projection lives in the accessible name and the tooltip, not
               in the layout: it is the SAME string on every card (where the
               next workspace lands is global, not per project), it was 41% of
               this header's width, and it was clipped in the desktop sidebar.
               The headroom % is dropped from the visible UI entirely — the
               accounts strip above says it, for every account, in more detail. */
            aria-label={addLabel}
            title={addLabel}
            onClick={() => onAddWorkspace(group.project)}
            disabled={adding}
          >
            <span aria-hidden="true">+</span>
          </button>
        )}
```

and above the `return`, next to `headroom`:

```ts
  const addLabel = projected
    ? `New workspace on ${group.project} — ${accountLabel(projected.wrapper)}, ${headroom}% free`
    : `New workspace on ${group.project}`;
```

- [ ] **Step 4: Delete the dead CSS**

In `fleet.css`, delete both `.proj-add-acct` rules and the comment block above
them (the block starting `/* Where this workspace will land, and how much room
is left there`). Nothing renders that class any more, and `LOW_HEADROOM` in
`ProjectCard.tsx` becomes unused — **delete that constant and its doc comment
too.** Also drop `gap: var(--sp-1);` from `.proj-card-add`, which now has a
single child.

- [ ] **Step 5: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-card.test.tsx`
Expected: PASS.

- [ ] **Step 6: Check nothing else referenced what you deleted**

Run:
```bash
cd infra/ccrc/pwa && grep -rn "proj-add-acct\|LOW_HEADROOM" src test design || echo "clean"
```
Expected: `clean`. Any hit is a test asserting the removed element — read it and
delete it deliberately, recording in your report which assertions you removed and
why. Do not leave a test asserting a class that no longer exists.

- [ ] **Step 7: Full suite and typecheck**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`
Expected: no type errors. Report the exact count and reconcile it against 342 +
6 new − (any tests removed in Step 6).

- [ ] **Step 8: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/ProjectCard.tsx infra/ccrc/pwa/src/fleet/fleet.css infra/ccrc/pwa/test/project-card.test.tsx
git commit -m "fix(ccrc): the + is icon-only; projection moves to its accessible name

.proj-card-add was 151px of a 208px header (41%) rendering a string
identical on all nine cards, clipped in the desktop sidebar. Account
and headroom stay in the aria-label and title; the headroom % leaves
the visible UI, where the accounts strip already says it better."
```

---

### Task 5: Density, row centring, column tracks, FAB clearance

**Files:**
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css`
- Modify: `infra/ccrc/pwa/src/fleet/SessionLine.tsx`
- Test: **Create** `infra/ccrc/pwa/test/fleet-css.test.ts`

**Why a new test file:** `polish.test.tsx` is a component-render file with no
CSS-text helper, and jsdom applies no stylesheet, so these rules cannot be
asserted through a render. Reading the stylesheet as text is the only assertion
available — and it is worth having, because each rule below is a fix for a
*measured* defect that would otherwise regress silently.

**Interfaces:**
- Consumes: the header is already short (Task 4).
- Produces: nothing later tasks depend on.

**Context, all measured on the live page at 390×844.** Card 118px tall; of that,
44px header + 44px line = 88px content, 24px card padding, 6px gap. The content
is at the 44px thumb-target floor, so **the honest ceiling is ~18%, not ~50%** —
an earlier estimate of "~200px per card" was eyeballed off a 2× screenshot and
was wrong. Row internals measured:

```
.sess-line     mid 257.1
.sess-lamp     mid 257.1   ✓
.sess-actions  mid 257.1   ✓
.sess-label    mid 246.3   ← 10.8px HIGH
.sess-state    mid 247.1   ← 10.0px high
```

The dot is not low; **the text is high.** `.sess-open` is `align-items: baseline`
with `min-height: 44px` — baseline lines the label and state up with each other
but does not centre the pair inside a box `min-height` made taller than its
content.

- [ ] **Step 1: Write the failing CSS-text tests**

Create `infra/ccrc/pwa/test/fleet-css.test.ts`:

```ts
// jsdom applies no stylesheet, so these rules cannot be asserted through a
// render. Each one below fixes a defect MEASURED on the live page; reading the
// stylesheet as text is what stops them regressing silently.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

/** The declarations of the first rule whose selector list starts with `sel`. */
function ruleFor(sel: string): string {
  const i = css.indexOf(`\n${sel} {`);
  if (i < 0) throw new Error(`no rule for ${sel}`);
  const open = css.indexOf('{', i);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('fleet density and alignment', () => {
  it('centres the row group instead of baselining it in a taller box', () => {
    // Measured: .sess-label sat 10.8px above .sess-line's centre, because
    // baseline alignment does not centre inside a min-height box.
    const rule = ruleFor('.sess-open');
    expect(rule).toContain('align-items: center');
    expect(rule).not.toContain('align-items: baseline');
  });

  it('keeps the 44px thumb target on the row and its label button', () => {
    // The fix is centring, NOT shrinking: these are tap surfaces.
    expect(ruleFor('.sess-line')).toContain('min-height: 44px');
    expect(ruleFor('.sess-open')).toContain('min-height: 44px');
  });

  it('has one track per always-present cell, with the tally and warn fixed', () => {
    // SEVEN cells: lamp · label · state · tally · warn · account · actions.
    // Six tracks for seven children silently collapses the last one, and an
    // `auto` tally track aligns nothing on a row whose tally is empty.
    const cols = /grid-template-columns:([^;]+);/.exec(ruleFor('.sess-line'))?.[1] ?? '';
    expect(cols).toContain('3.25rem');
    expect(cols.trim().split(/\s+(?![^(]*\))/)).toHaveLength(7);
  });

  it('reserves room under the list for the fixed 56px FAB', () => {
    expect(ruleFor('.fleet-list')).toContain('padding-bottom');
    expect(ruleFor('.fleet-list')).toContain('56px');
  });

  it('lets the card shrink below its content — the cause of the h-scroll', () => {
    // .fleet-list is display:grid, and a grid item's default min-width is auto
    // (= min-content), so .proj-card refused to go below 393px in a 312px
    // column: measured 65px of horizontal overflow on .shell-nav at 1440px.
    expect(ruleFor('.proj-card')).toContain('min-width: 0');
  });

  it('drops the STATE word in a narrow container, never the account chip', () => {
    // The old query hid .sess-acct — the session's only visible binding —
    // while keeping a projection identical on every card. Inverted: the lamp
    // already encodes status by colour and shape, so the word is the redundant
    // cell, and the account appears nowhere else on the row.
    const q = css.slice(css.indexOf('@container fleetlist'));
    expect(q).toContain('.sess-state');
    expect(q).not.toContain('.sess-acct');
  });

  it('tightens the card padding and closes the header/body gap', () => {
    const rule = ruleFor('.proj-card');
    expect(rule).toContain('padding: var(--sp-2)');
    expect(rule).toContain('gap: 0');
  });
});
```

`import.meta.dirname` requires Node 20.11+; this repo's vitest already runs on a
newer Node. If it is undefined, use
`path.dirname(new URL(import.meta.url).pathname)` instead.

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/fleet-css.test.ts`
Expected: FAIL on five of the six (the 44px guard passes already — it is a
regression guard on what must NOT change).

Also add a render test to `test/session-line.test.tsx` proving the cells are
unconditional, since the CSS test cannot see the DOM:

```ts
it('renders the tally and warn cells even when empty — the grid needs them', () => {
  // A conditional cell makes every cell to its right slide, which is what
  // made 4/5 and 65/73 float mid-row.
  const { container } = render(
    <SessionLine session={s({ tasks: null, limits: null })} onOpen={() => {}} onActions={() => {}} />);
  expect(container.querySelector('.sess-tally')).toBeInTheDocument();
  expect(container.querySelector('.sess-tally')).toHaveTextContent('');
  expect(container.querySelector('.sess-warn')).toBeInTheDocument();
});
```

- [ ] **Step 3: Centre the row group**

In `fleet.css`, in `.sess-open`, change `align-items: baseline;` to
`align-items: center;` and add a matching line-height so the two differently
sized texts still read as one line:

```css
.sess-open {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  min-height: 44px;   /* thumb target: the button is what gets tapped */
  padding: 0;
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
  /* Baseline alignment lined the 15px label and 12px state up with each other
     but left the pair flush against the top of the 44px row — measured 10.8px
     above the row's centre, which is the visible wobble on every line. Centring
     costs the shared baseline, so both children take one line-height instead. */
  line-height: var(--leading-tight);
}
```

- [ ] **Step 4: Give the trailing cells fixed tracks — and make the cells always exist**

**Two changes, and the second is what makes the first work.** Today the grid has
six children and six `auto` tracks, but **`.sess-tally` and `.sess-warn` are
conditionally rendered** — a row with no task list has five children, so every
cell to its right slides left and nothing aligns. Fixed tracks on a grid whose
child count varies per row change nothing. The cells have to be present on every
row, and the tracks that hold them have to be fixed.

In `SessionLine.tsx`, move `.sess-state` out of the button (so it gets its own
cell) and render the tally and warning cells unconditionally, empty when they
have nothing to say:

```tsx
      <button ref={labelRef} type="button" className="sess-open" onClick={open}>
        <span className="sess-label">{label}</span>
      </button>

      <span className={`sess-state sess-state--${state}`}>{state}</span>

      {/* Always rendered, empty when silent: a conditional cell makes every
          cell to its right slide, which is exactly why `4/5` and `65/73`
          floated mid-row. A fixed track only aligns if something occupies it. */}
      <span className="sess-tally">
        {!dead && session.tasks !== null ? `${session.tasks.done}/${session.tasks.total}` : ''}
      </span>

      <span className="sess-warn">
        {critical && (
          <span role="img" aria-label="account limit near">
            ⚠
          </span>
        )}
      </span>
```

Then replace `.sess-line`'s `grid-template-columns`:

```css
  /* lamp · label(flex) · state · tally · warn · account · actions — SEVEN
     cells, every one always present. The tally and warn tracks are fixed so
     they hold their column on a row that has nothing to put in them; 3.25rem
     fits `65/73` at --text-xs in tabular mono, the widest tally on the live
     fleet. The account track stays auto: wrapper labels differ by about one
     character, so a fixed width would buy ~6px of alignment at the cost of
     truncating any account name the server grows later. */
  grid-template-columns: auto minmax(0, 1fr) auto 3.25rem 1rem auto 44px;
```

and give the two new always-present cells their alignment:

```css
.sess-tally {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
  color: var(--ink-secondary);
  text-align: right;
}

.sess-warn {
  font-size: var(--text-xs);
  color: var(--status-dead-text);
  text-align: center;
}
```

- [ ] **Step 5: Tighten the padding and reserve FAB space**

```css
.fleet-list {
  display: grid;
  gap: var(--sp-2);
  container-type: inline-size;
  container-name: fleetlist;
  /* The FAB is position:fixed 56px at bottom-right and sat on top of the last
     card's content in every viewport and both themes. */
  padding-bottom: calc(56px + var(--sp-6) + var(--safe-bottom));
}
```

`container-type` and `container-name` **stay** — Step 6 replaces the query rather
than deleting it.

And on `.proj-card`, `gap: var(--sp-1)` → `gap: 0`, `padding: var(--sp-3)` →
`padding: var(--sp-2)`, plus the line that fixes the horizontal scroll:

```css
  /* .fleet-list is display:grid, and a grid item's default min-width is `auto`
     — i.e. min-content — so this card refused to shrink below the 393px its
     row's content demands, inside a 312px column. Measured on the live page at
     1440×900: .shell-nav clientWidth 344, scrollWidth 409 — 65px of horizontal
     scroll in the desktop sidebar. Horizontal scroll in that pane is a defect
     at every width, not a small-viewport concession. */
  min-width: 0;
```

- [ ] **Step 6: Invert the container query — the state word gives way, not the account**

Replace the existing `@container` block and its comment with:

```css
/* Narrow container: the STATE WORD is what goes. The lamp to its left already
   encodes status by colour and shape, so the word is the redundant cell —
   whereas .sess-acct is the only place the session's account binding appears
   on this row. The previous rule had these exactly backwards: it hid the
   binding and kept a projection that read identically on all nine cards. */
@container fleetlist (max-width: 380px) {
  .sess-state { display: none; }
}
```

Also tighten `.sess-line`'s `gap: var(--sp-2)` → `gap: var(--sp-1)`: six gaps at
8px is 48px of a ~296px row, and 24px buys back most of what the label needs.

- [ ] **Step 6b: Verify the overflow is actually gone — measured, not asserted**

jsdom does no layout, so no unit test can see this. Build the PWA and load it
headless at three widths, asserting `scrollWidth === clientWidth` on
`.shell-nav`, `.fleet` and `.fleet-list` at each:

```bash
cd infra/ccrc/pwa && npx vite build
```

Chromium is already on this box at
`~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`. Drive it over CDP
(`--headless=new --remote-debugging-port=<port>`; note `/json/new` requires a
**PUT**, not a GET) against the running server at `http://203.0.113.7:7788/`,
at viewport widths **1200, 1440 and 1920**.

Baseline to beat, measured before this task: at 1440×900, `.shell-nav`
clientWidth 344 / scrollWidth **409**, `.fleet-list` 312 / **393**.

Record every number in your report. If any width still overflows, say so and
say by how much — do not report the fix as done because one width passed.

- [ ] **Step 7: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/fleet-css.test.ts test/session-line.test.tsx`
Expected: PASS. `session-line.test.tsx` must still pass — moving `.sess-state`
out of the button changes the DOM tree, so if any existing test queried it
*through* the button, fix that test and say so in your report.

- [ ] **Step 8: Full suite, typecheck, contrast**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs`
Expected: no type errors, contrast ALL PASS. Report the count.

- [ ] **Step 9: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/fleet.css infra/ccrc/pwa/src/fleet/SessionLine.tsx infra/ccrc/pwa/test/fleet-css.test.ts
git commit -m "fix(ccrc): centre the row text, align the columns, clear the FAB

.sess-open was align-items:baseline inside min-height:44px, so the
label sat a measured 10.8px above the row's centre while the dot and
··· centred themselves. Trailing cells get fixed tracks; the list
reserves the FAB's 56px; the container query hiding the account chip
is removed, not widened — that chip is the session's real binding."
```

---

### Task 6: The disabled `gpt` lane

**Files:**
- Modify: `infra/ccrc/shared/api.ts` (`AccountUsage`)
- Modify: `infra/ccrc/server/src/limits.ts`
- Modify: `infra/ccrc/server/src/server.ts:138-152`
- Modify: `infra/ccrc/pwa/src/fleet/AccountsStrip.tsx`, `SwapSheet.tsx`, `useProjectedHome.ts`
- Test: `infra/ccrc/server/test/limits.test.ts`, `infra/ccrc/server/test/accounts-route.test.ts`,
  `infra/ccrc/pwa/test/accounts-strip.test.tsx`, `infra/ccrc/pwa/test/lifecycle-ui.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AccountUsage.disabled: boolean` on the wire;
  `AccountLimits.disabled: boolean` server-side.

**Context.** `ccd` has a kill-switch file at `~/.cc-sessions/gpt-disabled`; when
present, `ccd ls` reports that lane `DISABLED`. It has been on since 2026-07-28.
The PWA does not know: `/api/accounts` enumerates `~/.cc-limits/*.json`,
`gpt.json` exists, so the strip renders a fourth account as if available.

**Two consumers, not one.** `SwapSheet`'s `pickableWrappers` builds from
`KNOWN_WRAPPERS`, which includes `gpt` — so the swap picker offers a target that
cannot work. Fixing only the strip would fix the display and keep the broken
action.

**A flag, not an omission.** The server knows the difference between "no
telemetry for this account" and "this lane is switched off"; collapsing them
would make the two indistinguishable to any future reader.

- [ ] **Step 1: Write the failing server tests**

Append to `infra/ccrc/server/test/limits.test.ts` (match that file's existing
fixture-home helper):

```ts
describe('disabled lanes', () => {
  it('marks an account whose ccd kill-switch file is present', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'gpt.json'), JSON.stringify({ five: 10, seven: 20 }));
    writeFileSync(path.join(home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 20 }));
    writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l.gpt.disabled).toBe(true);
    expect(l.claude.disabled).toBe(false);
  });

  it('treats an absent kill-switch as enabled', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'gpt.json'), JSON.stringify({ five: 10, seven: 20 }));
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    // An account wrongly HIDDEN is worse than one wrongly shown: hidden looks
    // like the account does not exist at all.
    expect(l.gpt.disabled).toBe(false);
  });

  it('leaves a malformed limits file enabled', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-'));
    mkdirSync(path.join(home, '.cc-limits'), { recursive: true });
    writeFileSync(path.join(home, '.cc-limits', 'gpt.json'), 'not json');
    const l = await readLimits(localIO, loadConfig({ CCRC_HOME: home }));
    expect(l.gpt.disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/server && npx vitest run test/limits.test.ts`
Expected: FAIL — `Property 'disabled' does not exist on type 'AccountLimits'`.

- [ ] **Step 3: Implement the flag in `limits.ts`**

Add to the `AccountLimits` interface:

```ts
  /** ccd's per-lane kill-switch (`~/.cc-sessions/<wrapper>-disabled`) is
   *  present, so this account cannot take work. A FLAG rather than omitting
   *  the account: the server knows the difference between "no telemetry" and
   *  "switched off", and collapsing them loses it. */
  disabled: boolean;
```

In `readLimits`, before the loop:

```ts
  // One readdir, not one stat per account: the registry dir is already being
  // read on every fleet poll and this rides the same trip.
  const regNames = (await io.readdir(cfg.registryDir)) ?? [];
  const disabledLanes = new Set(
    regNames.filter((n) => n.endsWith('-disabled')).map((n) => n.slice(0, -'-disabled'.length)),
  );
```

Then add `disabled: disabledLanes.has(wrapper),` to **both** the success object
and the `catch` fallback object.

- [ ] **Step 4: Run to verify it passes**

Run: `cd infra/ccrc/server && npx vitest run test/limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Put it on the wire**

In `infra/ccrc/shared/api.ts`, add to `AccountUsage`:

```ts
  disabled: boolean;            // ccd's kill-switch for this lane is on
```

In `server/src/server.ts`, in the `/api/accounts` map, add `disabled: l.disabled,`
to the returned object.

Add to `infra/ccrc/server/test/accounts-route.test.ts`. That file already has
`seedLimits(files): string` (returns a fixture `home` with `.cc-limits` seeded)
and `getAccounts(home): Promise<AccountUsage[]>` — use both, and write the
kill-switch into the same home:

```ts
// The handler rebuilds each AccountUsage field by field, so a field it forgets
// to copy is a silent wire loss, not a type error — which is this whole file's
// reason to exist. `disabled` is exactly that shape of field.
it('carries the disabled flag onto the wire', async () => {
  const home = seedLimits({ gpt: { five: 1, seven: 1 }, claude: { five: 2, seven: 3 } });
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  writeFileSync(path.join(home, '.cc-sessions', 'gpt-disabled'), '');
  const accounts = await getAccounts(home);
  expect(accounts.find((a) => a.wrapper === 'gpt')!.disabled).toBe(true);
  expect(accounts.find((a) => a.wrapper === 'claude')!.disabled).toBe(false);
});
```

`seedLimits` appends `.json` itself, so pass bare wrapper names as keys.

- [ ] **Step 6: Write the failing PWA tests**

Append to `infra/ccrc/pwa/test/accounts-strip.test.tsx` (match its existing
`api.accounts` stub):

```ts
it('hides an account whose lane is switched off', async () => {
  // ccd will not route work there, so showing a gauge invites a tap that
  // cannot succeed.
  stubAccounts([acct({ wrapper: 'claude' }), acct({ wrapper: 'gpt', disabled: true })]);
  render(<AccountsStrip />);
  expect(await screen.findByText('team·max')).toBeInTheDocument();
  expect(screen.queryByText('gpt')).not.toBeInTheDocument();
});
```

And a `pickableWrappers` test in `infra/ccrc/pwa/test/lifecycle-ui.test.tsx`:

```ts
it('excludes a disabled account from the swap picker', () => {
  // The bug a display-only fix leaves behind: the strip stops showing gpt
  // while the picker still offers it as a swap target.
  expect(pickableWrappers([], ['gpt'])).not.toContain('gpt');
});

it('keeps every account when none is disabled', () => {
  expect(pickableWrappers([], [])).toEqual(['claude', 'claude2', 'claude-corp', 'gpt']);
});
```

- [ ] **Step 7: Run to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/accounts-strip.test.tsx test/lifecycle-ui.test.tsx`
Expected: FAIL — `pickableWrappers` takes one argument; the strip still shows gpt.

- [ ] **Step 8: Implement both consumers**

In `SwapSheet.tsx`, change the signature:

```ts
/** The accounts a session may be moved to. `disabled` names lanes ccd's
 *  kill-switch has switched off — they are excluded, because offering a swap
 *  target that cannot take work is worse than offering none. */
export function pickableWrappers(sessions: FleetSession[], disabled: readonly string[] = []): string[] {
  const all = [...KNOWN_WRAPPERS];
  for (const s of sessions) {
    if (!all.includes(s.wrapper)) all.push(s.wrapper);
  }
  return all.filter((w) => !disabled.includes(w));
}
```

The default `[]` keeps every existing call site compiling and behaving exactly as
before — but a default alone changes no behaviour, so it must actually be fed.

`SwapSheet` has no accounts data today: it reads `sessions` from the fleet store
and derives limits from them (`limitsFor`). Add a second hook beside the existing
one in `infra/ccrc/pwa/src/fleet/useProjectedHome.ts`:

```ts
/** Accounts ccd's kill-switch has switched off — swap targets that cannot take
 *  work. Its own poller rather than a prop threaded down from FleetScreen:
 *  SwapSheet mounts only while the picker is open, so this GET runs exactly
 *  when the answer is needed and stops when it closes. That is the same trade
 *  useProjectedHome already documents above — one extra GET against a local
 *  endpoint reading two small JSON files beats coupling two component trees. */
export function useDisabledWrappers(): string[] {
  const [disabled, setDisabled] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      // Silent on failure, and an empty list on error: showing an account that
      // turns out to be disabled is recoverable (ccd refuses the swap), while
      // hiding one because telemetry hiccuped looks like it does not exist.
      void api.accounts()
        .then((r) => { if (live) setDisabled(r.accounts.filter((a) => a.disabled === true).map((a) => a.wrapper)); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

  return disabled;
}
```

Then in `SwapSheet`, call it and feed it in:

```ts
  const disabledWrappers = useDisabledWrappers();
  const wrappers = pickableWrappers(sessions, disabledWrappers).filter((w) => w !== session.wrapper);
```

Add a test proving the wiring, not just the pure function — a `pickableWrappers`
unit test alone would pass against a `SwapSheet` that never calls it with a real
list:

```ts
it('does not offer a disabled account in the rendered picker', async () => {
  stubAccounts([acct({ wrapper: 'claude' }), acct({ wrapper: 'gpt', disabled: true })]);
  render(<SwapSheet session={{ id: 'demo', wrapper: 'claude', project: 'demo' }}
                    open onClose={() => {}} fleet={storeWith([])} />);
  expect(await screen.findByText('alt·max')).toBeInTheDocument();  // picker rendered
  expect(screen.queryByText('gpt')).not.toBeInTheDocument();
});
```

Use `fireEvent`, never `userEvent`, for any interaction inside this sheet.

In `AccountsStrip.tsx`, filter on render:

```tsx
  if (!accounts || accounts.length === 0) return null;
  // `disabled` is optional on the wire in the sense that an older server omits
  // it — `a.disabled === true` treats that as enabled, so the PWA never needs
  // a server upgrade to render.
  const live = accounts.filter((a) => a.disabled !== true);
  if (live.length === 0) return null;
```

and map over `live` instead of `accounts`.

- [ ] **Step 9: Run to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/accounts-strip.test.tsx test/lifecycle-ui.test.tsx`
Expected: PASS.

- [ ] **Step 10: Full suites and typechecks**

Run:
```bash
cd infra/ccrc/server && npx vitest run && npx tsc --noEmit
cd ../pwa && npx vitest run && npx tsc --noEmit
```
Expected: no type errors either side. Report both counts. Adding a required
`disabled` to `AccountUsage` will break any test fixture building that type as an
exhaustive literal — fix each by adding `disabled: false`.

- [ ] **Step 11: Commit**

```bash
git add infra/ccrc/shared/api.ts infra/ccrc/server/src/limits.ts infra/ccrc/server/src/server.ts infra/ccrc/pwa/src/fleet/AccountsStrip.tsx infra/ccrc/pwa/src/fleet/SwapSheet.tsx infra/ccrc/pwa/src/fleet/useProjectedHome.ts infra/ccrc/server/test/limits.test.ts infra/ccrc/server/test/accounts-route.test.ts infra/ccrc/pwa/test/accounts-strip.test.tsx infra/ccrc/pwa/test/lifecycle-ui.test.tsx
git commit -m "feat(ccrc): honour ccd's per-lane kill-switch in the PWA

gpt has been disabled since 2026-07-28 and the strip still rendered it,
while the swap picker still offered it as a target. Both consumers now
honour the flag; unreadable or absent means enabled, because an account
wrongly hidden looks like one that does not exist."
```

---

### Task 7: Enter sends, and `esc` becomes a touch-only control

**Files:**
- Modify: `infra/ccrc/pwa/src/session/Composer.tsx:133-139`
- Modify: `infra/ccrc/pwa/src/session/SessionHeader.tsx`
- Modify: `infra/ccrc/pwa/src/session/chat.css`
- Test: `infra/ccrc/pwa/test/compose.test.ts` or `chat.test.tsx` (whichever
  already renders `Composer` — check both and use the existing one),
  `infra/ccrc/pwa/test/header.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks depend on.

**Context.** `useMediaQuery` is at `src/lib/useMediaQuery.ts` and returns
`window.matchMedia(query).matches` via `useSyncExternalStore`, with a `false`
server snapshot — so **in jsdom, an unstubbed query defaults to `false`, i.e.
coarse/touch.** Stub `window.matchMedia` per test to drive the fine-pointer path.

The same predicate governs both changes here, which is the point: `(pointer:
fine)` means a physical keyboard exists.

**`esc` is not merely cosmetic.** The PWA binds **no** `Escape` handler anywhere
— verified by grep; the only match in the codebase is the byte `TerminalDrawer`
sends. Hiding the keycap without adding the binding would delete the ability to
interrupt, not move it.

- [ ] **Step 1: Write the failing composer tests**

In the file that already renders `Composer`, add:

```ts
const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};
afterEach(() => vi.unstubAllGlobals());

describe('Enter with a physical keyboard', () => {
  it('sends on plain Enter', async () => {
    stubPointer(true);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it.each(['altKey', 'metaKey', 'ctrlKey', 'shiftKey'] as const)(
    'inserts a newline on %s+Enter', async (mod) => {
      stubPointer(true);
      const onSend = vi.fn();
      render(<Composer onSend={onSend} />);
      const box = screen.getByRole('textbox');
      await userEvent.type(box, 'hello');
      fireEvent.keyDown(box, { key: 'Enter', [mod]: true });
      expect(onSend).not.toHaveBeenCalled();
    });
});

describe('Enter on touch', () => {
  it('inserts a newline — phone keyboards have no Alt or Cmd', async () => {
    stubPointer(false);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('still sends on Cmd+Enter, as it does today', async () => {
    stubPointer(false);
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByRole('textbox');
    await userEvent.type(box, 'hello');
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('hello');
  });
});
```

Match the real `Composer` props — read the component's signature and pass
whatever else is required.

- [ ] **Step 2: Run to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/compose.test.ts`
Expected: FAIL — plain Enter does not send.

- [ ] **Step 3: Implement the composer rule**

In `Composer.tsx`, add near the other hooks:

```ts
  // A physical keyboard exists → Enter is the send key, as in every desktop
  // chat. On glass it stays a newline: phone keyboards carry no Alt or Cmd, so
  // a blanket flip would leave no way to type one on the device this app is
  // built for. Shift+Enter is a newline in BOTH modes — near-universal, present
  // on on-screen keyboards, and free to honour where Enter already means newline.
  const finePointer = useMediaQuery('(pointer: fine)');
```

with `import { useMediaQuery } from '../lib/useMediaQuery';`, and replace
`onKeyDown`:

```ts
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      send();
      return;
    }
    if (finePointer && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/compose.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `esc` tests**

Append to `infra/ccrc/pwa/test/header.test.tsx` (reusing `stubPointer` — copy it
into this file rather than exporting from a test file):

```ts
describe('interrupt control', () => {
  it('renders the esc keycap on touch, where there is no Escape key', () => {
    stubPointer(false);
    render(<SessionHeader {...props({ status: 'busy' })} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('hides the keycap where a real keyboard exists', () => {
    stubPointer(true);
    render(<SessionHeader {...props({ status: 'busy' })} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('binds the physical Escape key in its place', () => {
    // THE test that matters. One asserting only that the cap is hidden would
    // pass a change that silently removes the ability to interrupt.
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<SessionHeader {...props({ status: 'busy', onInterrupt })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onInterrupt).toHaveBeenCalled();
  });

  it('does not interrupt an idle session, matching the keycap\'s disabled state', () => {
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<SessionHeader {...props({ status: 'idle', onInterrupt })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it('ignores Escape while typing — it dismisses, it does not interrupt', () => {
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<><textarea data-testid="box" /><SessionHeader {...props({ status: 'busy', onInterrupt })} /></>);
    const box = screen.getByTestId('box');
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onInterrupt).not.toHaveBeenCalled();
  });
});
```

`props(over)` should be a local helper returning the full `SessionHeaderProps`
with no-op callbacks — build it from the interface in `SessionHeader.tsx`.

- [ ] **Step 6: Run to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/header.test.tsx`
Expected: FAIL — the keycap renders in both modes; Escape does nothing.

- [ ] **Step 7: Implement the `esc` rule**

In `SessionHeader.tsx`, add `useEffect` to the React import, then:

```ts
  // The keycap exists because phone keyboards have no Escape key. Where one
  // exists, the key is the better control and the cap is clutter — but the
  // binding has to land in the SAME change that hides the cap, or interrupting
  // simply stops being possible. The PWA had no Escape handler at all before.
  const finePointer = useMediaQuery('(pointer: fine)');

  useEffect(() => {
    if (!finePointer || !busy) return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Escape inside a text field dismisses autocomplete or clears the draft —
      // it must not reach through and kill the turn.
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable === true) return;
      onInterrupt();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finePointer, busy, onInterrupt]);
```

with `import { useMediaQuery } from '../lib/useMediaQuery';`, and wrap the keycap:

```tsx
      {!finePointer && (
        <button
          type="button"
          className="keycap keycap--esc"
          aria-label="Stop"
          disabled={!busy}
          onClick={onInterrupt}
        >
          esc
        </button>
      )}
```

- [ ] **Step 8: Run to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/header.test.tsx`
Expected: PASS.

- [ ] **Step 9: Full suite, typecheck, contrast**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs`
Expected: no type errors, contrast ALL PASS. Report the count.

- [ ] **Step 10: Commit**

```bash
git add infra/ccrc/pwa/src/session/Composer.tsx infra/ccrc/pwa/src/session/SessionHeader.tsx infra/ccrc/pwa/test/compose.test.ts infra/ccrc/pwa/test/header.test.tsx
git commit -m "feat(ccrc): Enter sends and Escape interrupts on a real keyboard

One predicate — (pointer: fine) — for both. Enter stays a newline on
glass because phone keyboards carry no Alt or Cmd. The esc keycap
becomes touch-only, and the physical Escape binding lands in the same
change: the PWA had no Escape handler at all, so hiding the cap alone
would have removed the ability to interrupt rather than moved it."
```

---

### Task 8: The chat header names the workspace, not just the project

**Files:**
- Modify: `infra/ccrc/pwa/src/session/SessionHeader.tsx`
- Modify: `infra/ccrc/pwa/src/session/chat.css`
- Test: `infra/ccrc/pwa/test/header.test.tsx`

**Interfaces:**
- Consumes: Task 1 — `session.name` is now null whenever it was a derived
  handle, which is why the header can finally use it. The comment in this file
  saying to avoid `name` because it "reads as noise" is now stale and must go.
- Produces: nothing.

**Context.** `SessionHeader` sets `title = session.project`. Two workspaces of one
project therefore produce two identical headers with nothing to tell them apart,
while the fleet line a reader just tapped labelled them distinctly. The header
uses the **same** label rule as `SessionLine` so the two agree:
`name ?? branch ?? workspace ?? id`. On a project's main checkout there is no
second segment.

- [ ] **Step 1: Write the failing tests**

Append to `infra/ccrc/pwa/test/header.test.tsx`:

```ts
describe('breadcrumb', () => {
  it('names the workspace beside the project', () => {
    render(<SessionHeader {...props({ session: sess({
      project: 'custom-tools', workspace: 'quiet-basin', name: null, branch: 'ws/quiet-basin',
    }) })} />);
    expect(screen.getByText('custom-tools')).toBeInTheDocument();
    expect(screen.getByText('ws/quiet-basin')).toBeInTheDocument();
  });

  it('distinguishes two workspaces of one project — the whole point', () => {
    const { unmount } = render(<SessionHeader {...props({ session: sess({
      id: 'a', project: 'demo', workspace: 'quiet-basin', branch: 'ws/quiet-basin' }) })} />);
    expect(screen.getByText('ws/quiet-basin')).toBeInTheDocument();
    unmount();
    render(<SessionHeader {...props({ session: sess({
      id: 'b', project: 'demo', workspace: 'still-cove', branch: 'ws/still-cove' }) })} />);
    expect(screen.getByText('ws/still-cove')).toBeInTheDocument();
  });

  it('shows the project alone for a main checkout', () => {
    const { container } = render(<SessionHeader {...props({ session: sess({
      project: 'demo', workspace: null, name: null, branch: null, id: 'demo' }) })} />);
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(container.querySelector('.chat-crumb')).toBeNull();
  });

  it('prefers a chosen name over the branch, as the fleet line does', () => {
    render(<SessionHeader {...props({ session: sess({
      project: 'demo', workspace: 'quiet-basin', name: 'refactor-auth', branch: 'ws/quiet-basin' }) })} />);
    expect(screen.getByText('refactor-auth')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd infra/ccrc/pwa && npx vitest run test/header.test.tsx`
Expected: FAIL — `ws/quiet-basin` is not in the document.

- [ ] **Step 3: Extract the shared label rule**

Create `infra/ccrc/pwa/src/fleet/sessionLabel.ts`:

```ts
import type { FleetSession } from '../../../shared/api';

/**
 * What to call a session, everywhere. `name ?? branch ?? workspace ?? id`.
 *
 * `name` is only ever present when it is worth showing: the server drops
 * Claude Code's derived session handles (`openclawhetzner-42` — cwd basename
 * plus a counter) before they reach the wire, so a non-null name is one a
 * human chose. Branch outranks the slug because a workspace's branch gets
 * renamed to something descriptive while `workspace` keeps the slug it was
 * born with; the `id` tail keeps the rule total for legacy rows, which have
 * no workspace.
 */
export function sessionLabel(session: FleetSession): string {
  return session.name ?? session.branch ?? session.workspace ?? session.id;
}
```

In `SessionLine.tsx`, replace the inline `const label = …` (and its comment block)
with `const label = sessionLabel(session);` plus the import. Its existing tests
must keep passing untouched — that is the proof the extraction changed nothing.

- [ ] **Step 4: Use it in the header**

In `SessionHeader.tsx`, replace the `title` block:

```ts
  // The project is the ground; the second crumb is this particular workspace.
  // Without it, two workspaces of one project produce two identical headers.
  const title = session ? session.project : (fallback?.title ?? '…');
  const crumb = session && session.workspace !== null ? sessionLabel(session) : null;
```

and the title markup:

```tsx
        <h1 className="chat-title">
          {title}
          {crumb !== null && (
            <>
              <span className="chat-crumb-sep" aria-hidden="true">
                ›
              </span>
              <span className="chat-crumb">{crumb}</span>
            </>
          )}
        </h1>
```

Delete the now-stale comment above `title` that says to avoid Claude Code's
auto-derived name — Task 1 made it wrong.

- [ ] **Step 5: Add the CSS**

In `chat.css`, beside the existing `.chat-title` rule:

```css
/* The workspace crumb is secondary to the project: same line, lighter ink,
   and it truncates first when the header is tight. */
.chat-crumb-sep { margin: 0 var(--sp-1); color: var(--ink-tertiary); }
.chat-crumb {
  color: var(--ink-secondary);
  font-weight: var(--weight-regular);
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd infra/ccrc/pwa && npx vitest run test/header.test.tsx test/session-line.test.tsx`
Expected: PASS both. `session-line.test.tsx` passing **unmodified** is the check
that extracting `sessionLabel` preserved behaviour.

- [ ] **Step 7: Full suites, typechecks, contrast**

Run:
```bash
cd infra/ccrc/server && npx vitest run && npx tsc --noEmit
cd ../agent && npx vitest run && npx tsc --noEmit
cd ../pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs
```
Expected: agent **86** exactly (untouched by this plan). Report server and pwa
counts against the 400 / 330 baseline with the delta accounted for.

- [ ] **Step 8: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/sessionLabel.ts infra/ccrc/pwa/src/fleet/SessionLine.tsx infra/ccrc/pwa/src/session/SessionHeader.tsx infra/ccrc/pwa/src/session/chat.css infra/ccrc/pwa/test/header.test.tsx
git commit -m "feat(ccrc): the chat header names the workspace, not just the project

title was session.project, so two workspaces of one project produced
two identical headers. Both surfaces now share one sessionLabel rule,
which the server's derived-handle filter finally makes safe to use."
```

---

## Final verification, before the whole-branch review

- [ ] **Measure the live page against the recorded baseline.** Deploy to the
      staging build or run the dev server, load the fleet at 390×844, and record
      via headless Chromium:
      `.proj-card` height (baseline **118px**), `.fleet-list` height (baseline
      **1158px**), `.sess-label` centre vs `.sess-line` centre (baseline
      **10.8px apart**; must now agree within 1px), and whether the FAB overlaps
      any card content.
- [ ] **State plainly in the report which items were measured and which were
      tested.** Row centring, FAB overlap and the density figures **cannot** be
      asserted in jsdom, which does no layout. A report claiming a test covers
      them is false.
- [ ] Confirm the honest density result against the spec's ~18% projection. If
      it came in lower, say the real number — do not restate the projection.
