# Fleet Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** invert the fleet screen so a card is a *project* and each session inside it is a compact line, with fold state that survives navigation.

**Architecture:** four new PWA modules replace one. `foldState.ts` persists the collapsed set; `SessionLine.tsx` is the compact row; `SessionActionsSheet.tsx` holds the per-session actions that no longer fit on a row; `ProjectCard.tsx` is the always-present card. `FleetScreen` owns fold state and the single sheet instance, so the card and the line stay pure and testable. `ProjectGroup.tsx` and the `grouped` flag are deleted rather than left inert.

**Tech Stack:** React 19, TypeScript, vitest + @testing-library/react, jsdom, vaul (via the existing `Sheet`).

**Spec:** [`docs/superpowers/specs/2026-07-28-ccrc-fleet-hierarchy-design.md`](../specs/2026-07-28-ccrc-fleet-hierarchy-design.md)

## Scope: this is plan A of two

The spec covers two independent subsystems. This plan is the first:

- **Plan A (this one) — the hierarchy inversion and fold persistence.** PWA only. Ships a complete, working UX change on its own: the line's right-hand side is simply empty where a PR badge will later sit, which is where the spec always said that space was reserved.
- **Plan B (next) — PR state.** `gh` in `agent/src/whitelist.ts`, a new `server/src/prstate.ts`, `pr: PrState | null` on `shared/api.ts`, and the badge on the line. It spans three packages and an external API with its own fixture corpus, and it depends on this plan only for a place to render.

Splitting is not deferral: Plan B's riskiest parts (the readout table, the rollup union, the failure-is-silence rule) are pure mapping over captured fixtures and are unaffected by anything here.

## Global Constraints

- Repo `/srv/projects/OpenClawHetzner`, branch `ccrc/fleet-hierarchy`.
- Suite runs from the package dir: `cd infra/ccrc/pwa && npx vitest run`. Single file: `npx vitest run test/x.test.tsx`. Typecheck: `npx tsc --noEmit`.
- **Baseline: pwa 313 tests, 29 files, typecheck clean.** This plan *deletes* tests along with the components they cover, so the total is expected to move — see "Test accounting" below. Never invent a test to hit a number; report the counts you actually observe.
- **Contrast gate: `node infra/ccrc/pwa/design/contrast-check.mjs` → `ALL 82 PASS`.** Any new foreground/background pair must be added to that file's `pairs()` list rather than left invisible to the gate.
- Server and agent suites must be **untouched**: server 395, agent 86. Nothing in this plan reaches either package; movement there means something leaked.
- No new runtime dependencies. Use the existing `Sheet` (`components/Sheet.tsx`), `StatusDot`, `SwapSheet`, `toast`, and `api`/`apiErrorText`.
- **Every failure path uses `apiErrorText(err)`, never `err.message`.** The `runCcd` routes fail as `502 { ok, stderr }` with no `error` key, so `err.message` yields the generic `request failed (502)` and ccd's actual refusal never reaches the reader. This shipped twice in Phase 1.
- **`localStorage` is always reached via `window.localStorage`**, never the bare global: Node 22+ ships an experimental bare `localStorage` that shadows jsdom's working one under vitest. `lib/offline.ts` is the precedent.
- `FleetScreen` is also the desktop sidebar (`app.tsx:46` mounts it as `<FleetScreen selectedId={sessionId} showAccounts={!desktop} />`). A line must degrade into a narrow column. Where space is short the **account chip drops first**; the status dot, the label and the `···` are not negotiable.

## Measured facts this plan depends on

Checked in the working tree on 2026-07-29. Do not re-derive them.

| fact | evidence |
|---|---|
| contrast gate currently passes at 82 pairs | `node design/contrast-check.mjs` → `ALL 82 PASS` |
| exactly **five** test files reference the retiring card or `grouped` | `fleet-screen` (16), `session-card` (12), `project-group` (12), `polish` (11), `groupFleet` (9) |
| `chat`, `contrast` and `stores` do **not** reference them | grep over `test/` — an earlier spec draft claimed seven files and was wrong |
| the view-transition partner is `session/chat.css:60-61` | comment names the stamp set in `SessionCard` |
| `SwapSheet` takes `session: Pick<FleetSession, 'id' \| 'wrapper' \| 'project'>` | `fleet/SwapSheet.tsx:121-127` |
| `Sheet` props are `{open, onClose, children, title?, eyebrow?, full?}` | `components/Sheet.tsx` |
| `ProjectedHome` is `{ wrapper: string; score: number }` | `shared/api.ts:78-81` |
| the `+`'s projection is server-computed and must never be recomputed in the PWA | `ProjectGroup.tsx` comment; a third copy of `_ws_least_loaded` would drift from both existing ones |

## File Structure

| file | responsibility | task |
|---|---|---|
| `pwa/src/fleet/foldState.ts` | **new** — persisted collapsed-project set, pure + a hook | 1 |
| `pwa/src/fleet/SessionLine.tsx` | **new** — one session as a compact row | 2 |
| `pwa/src/fleet/SessionActionsSheet.tsx` | **new** — Restart · Swap account · Remove workspace | 3 |
| `pwa/src/fleet/ProjectCard.tsx` | **new** — always a card: header + lines | 4 |
| `pwa/src/fleet/fleet.css` | styles for each new component, added by the task that needs them | 2,3,4 |
| `pwa/src/screens/FleetScreen.tsx` | owns fold state and the single sheet instance | 5 |
| `pwa/src/fleet/groupFleet.ts` | `grouped` removed | 5 |
| `pwa/src/fleet/ProjectGroup.tsx` | **deleted** | 5 |
| `pwa/src/fleet/SessionCard.tsx` | **deleted** once nothing imports it | 6 |
| `pwa/design/contrast-check.mjs` | new pairs registered | 6 |

## Test accounting

Stated so no one has to guess whether a falling total is a regression:

| task | adds | removes | file |
|---|---|---|---|
| 1 | 8 | — | `test/foldState.test.ts` (new) |
| 2 | 11 | — | `test/session-line.test.tsx` (new) |
| 3 | 8 | — | `test/session-actions-sheet.test.tsx` (new) |
| 4 | 9 | — | `test/project-card.test.tsx` (new) |
| 5 | 0 | 12 + 2 | deletes `test/project-group.test.tsx`; drops 2 `grouped` assertions from `test/groupFleet.test.ts`; reshapes `test/fleet-screen.test.tsx` in place |
| 6 | 0 | 12 | deletes `test/session-card.test.tsx`; reshapes `test/polish.test.tsx` in place |

313 + 36 − 26 = **323 expected at the end**. Treat that as an expectation to check, not a target to hit: if reshaping `fleet-screen` or `polish` changes their counts, report the real number and say why.

---

### Task 1: `foldState.ts` — the collapsed set, persisted

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/foldState.ts`
- Test: `infra/ccrc/pwa/test/foldState.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `loadFolded(): ReadonlySet<string>`
  - `saveFolded(folded: ReadonlySet<string>): void`
  - `useFolded(): [ReadonlySet<string>, (project: string) => void]` — the set and a toggle. Task 4 receives a `collapsed: boolean` derived from the set; Task 5 calls the hook.

**Context:** fold state is `useState` in `ProjectGroup` today, so navigating into a session and back re-expands everything. It moves to `localStorage` under one key holding the collapsed project names. **Absent means expanded**, so a first run and a cleared store both open everything — the failure mode of a layout preference must never be a hidden fleet.

- [ ] **Step 1: Write the failing tests**

Create `infra/ccrc/pwa/test/foldState.test.ts`:

```ts
// Fold state is a layout preference: every failure mode must resolve to
// "everything expanded", never to a fleet the reader cannot see.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { loadFolded, saveFolded, useFolded } from '../src/fleet/foldState';

const KEY = 'ccrc.fleet-folded.v1';

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('loadFolded', () => {
  it('returns an empty set when nothing is stored — a first run opens everything', () => {
    expect([...loadFolded()]).toEqual([]);
  });

  it('reads back what saveFolded wrote', () => {
    saveFolded(new Set(['alpha', 'beta']));
    expect([...loadFolded()].sort()).toEqual(['alpha', 'beta']);
  });

  it('returns empty on unparseable JSON rather than throwing', () => {
    window.localStorage.setItem(KEY, '{not json');
    expect([...loadFolded()]).toEqual([]);
  });

  it('returns empty when the stored value is not an array', () => {
    window.localStorage.setItem(KEY, '{"alpha":true}');
    expect([...loadFolded()]).toEqual([]);
  });

  it('drops non-string members rather than admitting them to the set', () => {
    // A `folded.has(project)` against a set holding 7 or null cannot match, but
    // it would round-trip the junk back into storage on the next toggle.
    window.localStorage.setItem(KEY, '["alpha", 7, null, "beta"]');
    expect([...loadFolded()].sort()).toEqual(['alpha', 'beta']);
  });
});

describe('saveFolded', () => {
  it('swallows a storage failure — a fold that cannot be saved still folds', () => {
    // Private mode and quota walls both throw here. saveFleetSnapshot has the
    // same contract (lib/offline.ts).
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveFolded(new Set(['alpha']))).not.toThrow();
  });
});

describe('useFolded', () => {
  it('toggles a project in and out of the set', () => {
    const { result } = renderHook(() => useFolded());
    act(() => { result.current[1]('alpha'); });
    expect(result.current[0].has('alpha')).toBe(true);
    act(() => { result.current[1]('alpha'); });
    expect(result.current[0].has('alpha')).toBe(false);
  });

  it('survives a remount — this is the whole point of the module', () => {
    const first = renderHook(() => useFolded());
    act(() => { first.current[1]('alpha'); });
    first.unmount();
    const second = renderHook(() => useFolded());
    expect(second.result.current[0].has('alpha')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/foldState.test.ts`
Expected: FAIL — cannot resolve `../src/fleet/foldState`.

- [ ] **Step 3: Write the module**

Create `infra/ccrc/pwa/src/fleet/foldState.ts`:

```ts
// Which projects the reader has collapsed, persisted per browser. Absent means
// EXPANDED, so a first run, a cleared store and a corrupt store all open
// everything — the failure mode of a layout preference must never be a fleet
// the reader cannot see. lib/offline.ts is the precedent for persisted state.
//
// Per-browser, not per-account: two devices fold independently, which is the
// right default for a layout preference and needs no sync.
import { useCallback, useState } from 'react';

const KEY = 'ccrc.fleet-folded.v1';

// Always via `window.` — Node 22+ ships an experimental bare `localStorage`
// global that shadows jsdom's working one under vitest (lib/offline.ts).
const storage = (): Storage => window.localStorage;

/** The collapsed project names. Empty on an absent, corrupt or unreadable store. */
export function loadFolded(): ReadonlySet<string> {
  try {
    const raw = storage().getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    // Filter rather than trust: junk in the set would round-trip back into
    // storage on the next toggle and never wash out.
    return new Set(parsed.filter((p): p is string => typeof p === 'string'));
  } catch {
    return new Set();
  }
}

/** Best-effort persist — quota errors and private-mode walls are swallowed,
 *  exactly as saveFleetSnapshot does. A fold that cannot be saved still folds
 *  for this session. */
export function saveFolded(folded: ReadonlySet<string>): void {
  try {
    storage().setItem(KEY, JSON.stringify([...folded]));
  } catch {
    /* ignore */
  }
}

/** The collapsed set plus a toggle that persists. The initializer is lazy, so
 *  storage is read once per mount rather than on every render. */
export function useFolded(): [ReadonlySet<string>, (project: string) => void] {
  const [folded, setFolded] = useState<ReadonlySet<string>>(loadFolded);
  const toggle = useCallback((project: string): void => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      saveFolded(next);
      return next;
    });
  }, []);
  return [folded, toggle];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/foldState.test.ts && npx tsc --noEmit`
Expected: 8 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/foldState.ts infra/ccrc/pwa/test/foldState.test.ts
git commit -m "feat(pwa): persist which projects are folded"
```

---

### Task 2: `SessionLine.tsx` — one session as a compact row

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/SessionLine.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css` (append a `SessionLine` block)
- Test: `infra/ccrc/pwa/test/session-line.test.tsx`

**Interfaces:**
- Consumes: `FleetSession`, `SessionStatus` from `../../../shared/api`; `StatusDot` from `../components/StatusDot`; `accountLabel`, `accountColorVar` from `../lib/accounts`.
- Produces:

```ts
export function SessionLine({ session, onOpen, selected, onActions }: {
  session: FleetSession;
  onOpen: (id: string) => void;
  selected?: boolean;          // the open session in the desktop sidebar
  onActions: (session: FleetSession) => void;   // opens the actions sheet
}): ReactNode
```

Task 4 renders it; Task 3 receives what `onActions` hands up.

**Context:** replaces `SessionCard` in the fleet list. Three things are deliberately cut rather than relocated — the attention *sentence* ("Claude is asking you something — tap to answer") becomes the amber dot plus the word `waiting`; the limit sentence becomes a `⚠` whose full text moves into the actions sheet; the dead-card long-press becomes an explicit sheet action. There is **no `inGroup` prop**: a line is now always inside a project card, so the conditional disappears.

**The view transition is the trap in this task.** `SessionCard.tsx` stamps `viewTransitionName = 'session-title'` on the title button at tap time, pairing with `session/chat.css:61`. Nothing tests it, and this task moves the stamp to a new element — exactly when an untested invariant breaks. The test below is the net.

- [ ] **Step 1: Write the failing tests**

Create `infra/ccrc/pwa/test/session-line.test.tsx`:

```tsx
// The compact row that replaces SessionCard in the fleet list.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { SessionLine } from '../src/fleet/SessionLine';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, ...over,
});

describe('label', () => {
  // Spec order: name ?? branch ?? workspace ?? id. Branch outranks the slug
  // because Phase 2 renames the branch to something descriptive while
  // `workspace` keeps the slug it was born with.
  it('prefers the live session name', () => {
    render(<SessionLine session={s({ name: 'refactor-auth', branch: 'ws/quiet-mesa' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('refactor-auth')).toBeInTheDocument();
  });

  it('falls back to the branch', () => {
    render(<SessionLine session={s({ branch: 'ws/quiet-mesa' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('ws/quiet-mesa')).toBeInTheDocument();
  });

  it('falls back to the workspace slug', () => {
    render(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('quiet-mesa')).toBeInTheDocument();
  });

  it('falls back to the id — the tail Phase 1 shipped untested', () => {
    // Legacy rows have no workspace. A mutation proved nothing caught this.
    render(<SessionLine session={s({ workspace: null, id: 'claude-legacy' })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('claude-legacy')).toBeInTheDocument();
  });
});

describe('state', () => {
  it('reads exited when dead', () => {
    render(<SessionLine session={s({ status: 'dead' })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  it('reads waiting on a pending dialog, and outranks busy', () => {
    render(<SessionLine session={s({ status: 'busy', dialogPending: true })}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.queryByText('working')).not.toBeInTheDocument();
  });

  it('shows the task tally, and hides it on a dead session', () => {
    const tasks = { done: 4, total: 7, active: null };
    const { rerender } = render(
      <SessionLine session={s({ tasks })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('4/7')).toBeInTheDocument();
    rerender(<SessionLine session={s({ tasks, status: 'dead' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('4/7')).not.toBeInTheDocument();
  });

  it('warns when a limit window is critical, but never on a dead session', () => {
    const limits = { five: 82, seven: 10 };
    const { rerender } = render(
      <SessionLine session={s({ limits })} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByLabelText('account limit near')).toBeInTheDocument();
    rerender(<SessionLine session={s({ limits, status: 'dead' })}
                          onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByLabelText('account limit near')).not.toBeInTheDocument();
  });
});

describe('interaction', () => {
  it('opens the session on tap', async () => {
    const onOpen = vi.fn();
    render(<SessionLine session={s()} onOpen={onOpen} onActions={() => {}} />);
    await userEvent.click(screen.getByText('quiet-mesa'));
    expect(onOpen).toHaveBeenCalledWith('demo-quiet-mesa');
  });

  // THE untested invariant this restructure is most likely to break. The stamp
  // pairs the tapped label with the chat header (session/chat.css:61); without
  // it the card->chat shared-element animation silently stops working.
  it('stamps session-title on the tapped label for the view transition', async () => {
    render(<SessionLine session={s()} onOpen={() => {}} onActions={() => {}} />);
    const button = screen.getByText('quiet-mesa').closest('button')!;
    expect(button.style.viewTransitionName).toBe('');
    await userEvent.click(button);
    expect(button.style.viewTransitionName).toBe('session-title');
  });

  it('hands the session up when the actions button is pressed', async () => {
    const onActions = vi.fn();
    render(<SessionLine session={s()} onOpen={() => {}} onActions={onActions} />);
    await userEvent.click(screen.getByRole('button', { name: /actions for/i }));
    expect(onActions).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo-quiet-mesa' }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-line.test.tsx`
Expected: FAIL — cannot resolve `../src/fleet/SessionLine`.

- [ ] **Step 3: Write the component**

Create `infra/ccrc/pwa/src/fleet/SessionLine.tsx`:

```tsx
// One session as a compact row: dot · label · state · tally · ⚠ · account · ···
//
// Replaces SessionCard in the fleet list. Three things are cut rather than
// shrunk. The attention SENTENCE ("Claude is asking you something") becomes the
// amber dot plus the word `waiting` — same information at a glance, and the
// sentence earned its space on a card that was already large. The limit
// sentence becomes `⚠`, with the full text in the actions sheet where there is
// room to say what will happen. The dead-card long-press becomes an explicit
// sheet action: a hidden gesture is the wrong home for recovery, and a worse
// one for "Remove workspace".
//
// There is no `inGroup` prop. A line is always inside a project card now, so
// the conditional that made SessionCard mean two different things is gone.
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { FleetSession, SessionStatus } from '../../../shared/api';
import { accountColorVar, accountLabel } from '../lib/accounts';
import { StatusDot } from '../components/StatusDot';
import './fleet.css';

/** Routing policy calls a window critical above this. */
const CRITICAL = 75;

export function SessionLine({
  session,
  onOpen,
  selected = false,
  onActions,
}: {
  session: FleetSession;
  onOpen: (id: string) => void;
  selected?: boolean; // the open session in the desktop sidebar
  onActions: (session: FleetSession) => void;
}): ReactNode {
  const dead = session.status === 'dead';
  const attention = !dead && session.dialogPending;
  const busy = !attention && session.status === 'busy';
  const dotStatus: SessionStatus | 'dialog' = dead ? 'dead' : attention ? 'dialog' : session.status;
  const state = dead ? 'exited' : attention ? 'waiting' : busy ? 'working' : 'idle';

  // Spec order: name ?? branch ?? workspace ?? id. Branch outranks the slug
  // because Phase 2's PR flow renames the branch to something descriptive while
  // `workspace` keeps the slug it was born with — slug-first would pin the line
  // to `quiet-mesa` forever. The `id` tail keeps the rule total for legacy rows,
  // which have no workspace.
  const label = session.name ?? session.branch ?? session.workspace ?? session.id;

  // Dead sessions stay silent about limits: they are meaningless when nothing runs.
  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical = !dead && ((five !== null && five > CRITICAL) || (seven !== null && seven > CRITICAL));

  // The tapped label is the shared element of the line->chat view transition:
  // stamping the name here (only on the line being opened) pairs it with the
  // chat header's `view-transition-name: session-title` (session/chat.css:61).
  const labelRef = useRef<HTMLButtonElement>(null);
  const open = (): void => {
    if (labelRef.current) labelRef.current.style.viewTransitionName = 'session-title';
    onOpen(session.id);
  };

  // Identity stays in the name; a dead line's account drains to gray.
  const acctVar = accountColorVar(session.wrapper);
  const acctStyle: CSSProperties = dead
    ? { color: 'var(--ink-secondary)' }
    : { color: `var(${acctVar})` };

  return (
    <div className={selected ? 'sess-line sess-line--active' : 'sess-line'} data-state={state}>
      <span className="sess-lamp" data-status={dotStatus}>
        <StatusDot status={dotStatus} />
      </span>

      <button ref={labelRef} type="button" className="sess-open" onClick={open}>
        <span className="sess-label">{label}</span>
        <span className={`sess-state sess-state--${state}`}>{state}</span>
      </button>

      {!dead && session.tasks !== null && (
        <span className="sess-tally">
          {session.tasks.done}/{session.tasks.total}
        </span>
      )}

      {critical && (
        <span className="sess-warn" role="img" aria-label="account limit near">
          ⚠
        </span>
      )}

      <span className="sess-acct" style={acctStyle}>
        {accountLabel(session.wrapper)}
      </span>

      <button
        type="button"
        className="sess-actions"
        aria-label={`Actions for ${label}`}
        onClick={() => onActions(session)}
      >
        <span aria-hidden="true">···</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `infra/ccrc/pwa/src/fleet/fleet.css`:

```css
/* ── session line ─────────────────────────────────────────────────
   One session inside a project card. Grid rather than flex so the columns
   line up across sibling rows: a ragged right edge is what makes a list of
   rows read as noise. */
.sess-line {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto auto auto;
  align-items: center;
  gap: var(--s-2);
  min-height: 44px; /* thumb target — the row is a tap surface, not a label */
  padding: 0 var(--s-2);
  border-radius: var(--r-md);
}

.sess-line--active { background: var(--bg-raised); }

.sess-open {
  display: flex;
  align-items: baseline;
  gap: var(--s-2);
  min-width: 0;
  min-height: 44px;
  padding: 0;
  background: none;
  border: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.sess-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.sess-state { font-size: var(--fs-xs); color: var(--ink-secondary); }
.sess-state--waiting { color: var(--attn); }
.sess-state--working { color: var(--live); }
.sess-state--exited  { color: var(--ink-secondary); }

.sess-tally {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--ink-secondary);
}

.sess-warn { font-size: var(--fs-xs); color: var(--warn); }

.sess-acct {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
}

.sess-actions {
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  background: none;
  border: 0;
  color: var(--ink-secondary);
  cursor: pointer;
}

/* The desktop sidebar is narrow. The account chip is the first thing to go;
   the dot, the label and the ··· are not negotiable. */
@media (max-width: 1100px) and (min-width: 900px) {
  .sess-acct { display: none; }
}
```

**Before writing this block, read the top of `fleet.css` and confirm the token names it actually uses** (`--s-2`, `--r-md`, `--fs-xs`, `--ink-secondary`, `--attn`, `--live`, `--warn`, `--font-mono`, `--bg-raised`). Existing rules in that file are the source of truth — substitute the real names wherever one above does not exist, and say in your report which you changed. Inventing a token that does not exist yields a silently unstyled row.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-line.test.tsx && npx tsc --noEmit`
Expected: 11 passed, typecheck clean.

- [ ] **Step 6: Prove the view-transition test is load-bearing by mutation**

Delete the `if (labelRef.current) …` line from `open()` and re-run.

Run: `cd infra/ccrc/pwa && npx vitest run test/session-line.test.tsx`
Expected: **RED** — `'stamps session-title on the tapped label for the view transition'` must fail. If the suite stays green, that test is not testing anything; fix it before restoring the line.

Restore and re-run. Expected: 11 passed.

- [ ] **Step 7: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/SessionLine.tsx infra/ccrc/pwa/src/fleet/fleet.css \
        infra/ccrc/pwa/test/session-line.test.tsx
git commit -m "feat(pwa): SessionLine — one session as a compact row"
```

---

### Task 3: `SessionActionsSheet.tsx` — the actions a row cannot hold

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/SessionActionsSheet.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css`
- Test: `infra/ccrc/pwa/test/session-actions-sheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet` from `../components/Sheet`; `SwapSheet` from `./SwapSheet`; `api`, `apiErrorText` from `../lib/api`; `toast` from `../components/Toast`.
- Produces:

```ts
export function SessionActionsSheet({ session, open, onClose, fleet }: {
  session: FleetSession | null;      // null when nothing is selected
  open: boolean;
  onClose: () => void;
  fleet?: FleetStore;                // injectable for tests; passed through to SwapSheet
}): ReactNode
```

Task 5 mounts exactly one instance at screen level and feeds it whatever `SessionLine`'s `onActions` handed up.

**Context:** Restart · Swap account · Remove workspace. Swap **hands off to the existing `SwapSheet`** — it is not reimplemented. Remove workspace appears **only** when `session.workspace !== null`, and has no confirm dialog: `ccd ws-rm` refuses on a dirty tree, an unmerged branch or a main checkout and explains why, so the guard lives where the facts are. That makes surfacing the refusal text load-bearing rather than cosmetic — which is why every failure path uses `apiErrorText`.

**Hook ordering matters here.** `session` is nullable, so it is tempting to `if (!session) return null` first. Every `useState` must come **before** that guard or React throws on the render where session becomes null.

- [ ] **Step 1: Write the failing tests**

Create `infra/ccrc/pwa/test/session-actions-sheet.test.tsx`:

```tsx
// The per-session actions that no longer fit on a row. The failure paths are
// the point: ccd's refusals are the only explanation the reader gets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, ...over,
});

/** The REAL server failure shape: runCcd routes answer 502 with `stderr` and
 *  no `error` key. A mocked rejection would not catch an err.message regression;
 *  this does. */
const stubFetch = (body: unknown, status = 502): void => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
};

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('composition', () => {
  it('renders nothing when no session is selected', () => {
    const { container } = render(
      <SessionActionsSheet session={null} open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Remove workspace for a workspace session', () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /remove workspace/i })).toBeInTheDocument();
  });

  it('hides Remove workspace for a main checkout — ws-rm would refuse it anyway', () => {
    render(<SessionActionsSheet session={s({ workspace: null })} open onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /remove workspace/i })).not.toBeInTheDocument();
  });

  it('explains the limit consequence that the line only had room to flag', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 82, seven: 10 } })}
                                open onClose={() => {}} />);
    expect(screen.getByText(/5h limit near/i)).toBeInTheDocument();
  });

  it('says nothing about limits when neither window is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 10 } })}
                                open onClose={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });
});

describe('actions', () => {
  it('restarts through api.ensure', async () => {
    render(<SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(String(call[0])).toContain('demo-quiet-mesa');
  });

  // THE regression this project has shipped twice. The server answers
  // 502 { ok, stderr } with no `error` key, so err.message yields the generic
  // "request failed (502)" and ccd's actual refusal never reaches the reader.
  it("surfaces ccd's own refusal text when a remove fails", async () => {
    stubFetch({ ok: false, stderr: 'ccd: worktree not removed (uncommitted changes?)' });
    render(<SessionActionsSheet session={s()} open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    expect(await screen.findByText(/uncommitted changes/i)).toBeInTheDocument();
  });

  it("surfaces ccd's own refusal text when a restart fails", async () => {
    stubFetch({ ok: false, stderr: 'ccd: no such session: demo-quiet-mesa' });
    render(<SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    expect(await screen.findByText(/no such session/i)).toBeInTheDocument();
  });
});
```

**The two failure tests need a `ToastHost` mounted to assert on toast text.** Read `test/lifecycle-ui.test.tsx` — it already exercises this exact pattern against the real `502 { stderr }` shape — and mirror whatever it does to render toasts and await them. If it wraps the subject in `<ToastHost />`, do the same here rather than inventing a second approach.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-actions-sheet.test.tsx`
Expected: FAIL — cannot resolve `../src/fleet/SessionActionsSheet`.

- [ ] **Step 3: Write the component**

Create `infra/ccrc/pwa/src/fleet/SessionActionsSheet.tsx`:

```tsx
// Per-session actions, behind the line's `···`. A sheet rather than a
// long-press: discoverability beats density here, and a hidden gesture on a
// destructive action ("Remove workspace") is the wrong trade on a phone.
//
// Swap hands off to the existing SwapSheet rather than reimplementing the
// account picker, its limit gauges and its consequence confirm.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { toast } from '../components/Toast';
import { api, apiErrorText } from '../lib/api';
import { SwapSheet } from './SwapSheet';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

const CRITICAL = 75;

export function SessionActionsSheet({
  session,
  open,
  onClose,
  fleet = useFleetStore,
}: {
  session: FleetSession | null;
  open: boolean;
  onClose: () => void;
  fleet?: FleetStore;
}): ReactNode {
  // Every hook runs BEFORE the null guard below: `session` goes null whenever
  // the sheet closes, and a conditional hook would throw on that render.
  const [swapOpen, setSwapOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!session) return null;

  const restart = async (): Promise<void> => {
    if (restarting) return;
    setRestarting(true);
    try {
      await api.ensure(session.id);
      onClose();
    } catch (err) {
      // apiErrorText, never err.message: the runCcd routes fail as
      // 502 { ok, stderr } with no `error` key, so err.message yields the
      // generic "request failed (502)" and ccd's refusal never reaches anyone.
      toast(`Couldn't restart — ${apiErrorText(err)}`, 'error');
    } finally {
      setRestarting(false);
    }
  };

  // No confirm dialog: ccd ws-rm refuses a dirty tree, an unmerged branch and a
  // main checkout, and says why. The guard lives where the facts are, which is
  // what makes surfacing its text load-bearing rather than cosmetic.
  const removeWorkspace = async (): Promise<void> => {
    if (removing) return;
    setRemoving(true);
    try {
      await api.workspaceRemove(session.id);
      onClose();
    } catch (err) {
      toast(`Couldn't remove — ${apiErrorText(err)}`, 'error');
    } finally {
      setRemoving(false);
    }
  };

  const five = session.limits?.five ?? null;
  const seven = session.limits?.seven ?? null;
  const critical =
    session.status === 'dead' ? null
    : five !== null && five > CRITICAL ? '5h'
    : seven !== null && seven > CRITICAL ? '7d'
    : null;

  const label = session.name ?? session.branch ?? session.workspace ?? session.id;

  return (
    <>
      <Sheet open={open} onClose={onClose} title={label} eyebrow={session.project}>
        <div className="sess-sheet">
          <button type="button" className="btn-ghost" onClick={() => void restart()} disabled={restarting}>
            {restarting ? 'Restarting…' : 'Restart session'}
          </button>

          <button type="button" className="btn-ghost" onClick={() => setSwapOpen(true)}>
            Swap account
          </button>

          {session.workspace !== null && (
            <button
              type="button"
              className="btn-ghost sess-sheet-remove"
              onClick={() => void removeWorkspace()}
              disabled={removing}
            >
              {removing ? 'Removing…' : 'Remove workspace'}
            </button>
          )}

          {/* The line only had room for `⚠`; this is where it gets to say what
              it means and what will happen. */}
          {critical !== null && (
            <p className="sess-sheet-note">
              {critical} limit near — this session will move to another account.
            </p>
          )}
        </div>
      </Sheet>

      <SwapSheet
        session={session}
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        fleet={fleet}
      />
    </>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `infra/ccrc/pwa/src/fleet/fleet.css`:

```css
/* ── session actions sheet ────────────────────────────────────────── */
.sess-sheet {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.sess-sheet .btn-ghost {
  justify-content: flex-start;
  min-height: 44px;
}

.sess-sheet-remove { color: var(--danger); }

.sess-sheet-note {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--ink-secondary);
}
```

Same instruction as Task 2: verify each token exists in `fleet.css` or the tokens it imports before using it, and report any you had to substitute. `--danger` in particular may be named differently — check what `SessionCard`'s remove button or `QuickConfirm` uses today.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/session-actions-sheet.test.tsx && npx tsc --noEmit`
Expected: 8 passed, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/SessionActionsSheet.tsx infra/ccrc/pwa/src/fleet/fleet.css \
        infra/ccrc/pwa/test/session-actions-sheet.test.tsx
git commit -m "feat(pwa): SessionActionsSheet — restart, swap, remove behind the line's ···"
```

---

### Task 4: `ProjectCard.tsx` — the card is the project

**Files:**
- Create: `infra/ccrc/pwa/src/fleet/ProjectCard.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css`
- Test: `infra/ccrc/pwa/test/project-card.test.tsx`

**Interfaces:**
- Consumes: `FleetGroup` from `./groupFleet`; `SessionLine` from `./SessionLine` (Task 2); `ProjectedHome` from `../../../shared/api`; `accountLabel` from `../lib/accounts`.
- Produces:

```ts
export function ProjectCard({ group, onOpen, selectedId, onAddWorkspace, projected,
                              adding, collapsed, onToggle, onActions }: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  onAddWorkspace?: (project: string) => void;
  projected?: ProjectedHome | null;
  adding?: boolean;
  collapsed?: boolean;                       // owned by FleetScreen via useFolded
  onToggle?: (project: string) => void;
  onActions: (session: FleetSession) => void;
}): ReactNode
```

**Context:** replaces `ProjectGroup`. **Uniform shape at every count** — a project holding one session renders exactly like a project holding five: a card, a header, and one line beneath. No special case, no second layout to learn. That is the whole point: on the live fleet, nine sessions sit across nine distinct projects, so `ProjectGroup`'s `grouped: members.length > 1` header renders *nowhere* and the project — the thing a reader navigates by — has no container at all.

**Fold state is passed in, not owned here.** `collapsed`/`onToggle` come from `FleetScreen`'s `useFolded` (Task 1). Keeping the card pure is what lets a test assert folding without touching `localStorage`.

**A folded card still shows its urgency.** The header keeps the count and the attention dot when collapsed; only the lines hide. A fold must never be able to hide a pending dialog — that is this screen's whole job. And a collapsed project does **not** auto-expand when a session inside it needs you: the header's dot is sufficient, and auto-expanding would override an explicit choice, on a fleet where several projects can want attention at once.

- [ ] **Step 1: Write the failing tests**

Create `infra/ccrc/pwa/test/project-card.test.tsx`:

```tsx
// A card is always a project; a line is always a session. No bare path.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import type { FleetGroup } from '../src/fleet/groupFleet';
import { ProjectCard } from '../src/fleet/ProjectCard';

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w', workspace: 'quiet-mesa', name: null, status: 'idle',
  statusUpdatedAt: null, limits: null, dialogPending: false, version: null,
  model: null, effort: null, ultracode: false, branch: null, tasks: null, ...over,
});

const grp = (over: Partial<FleetGroup> = {}): FleetGroup => ({
  project: 'demo', sessions: [sess()], attention: false, busy: 0, ...over,
});

describe('uniform shape', () => {
  // The defect this whole restructure exists to fix: ProjectGroup showed a
  // header only at two-or-more members, and the live fleet is nine projects
  // holding one session each — so the header rendered nowhere at all.
  it('renders a header for a project holding ONE session', () => {
    render(<ProjectCard group={grp()} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('demo')).toBeInTheDocument();
  });

  it('renders the same shape for a project holding several', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'demo-still-cove', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(screen.getByText('quiet-mesa')).toBeInTheDocument();
    expect(screen.getByText('still-cove')).toBeInTheDocument();
  });

  it('shows the live session count', () => {
    const g = grp({ sessions: [sess(), sess({ id: 'b', workspace: 'still-cove' })] });
    render(<ProjectCard group={g} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('folding', () => {
  it('hides the lines when collapsed', () => {
    render(<ProjectCard group={grp()} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.queryByText('quiet-mesa')).not.toBeInTheDocument();
  });

  // A fold must never be able to hide the one thing this screen exists to
  // surface. The header wears the group's urgency either way.
  it('keeps the count and the attention dot while collapsed', () => {
    const g = grp({ attention: true, sessions: [sess({ dialogPending: true })] });
    render(<ProjectCard group={g} collapsed onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByLabelText('waiting on you')).toBeInTheDocument();
  });

  it('reports the toggle with its project name', async () => {
    const onToggle = vi.fn();
    render(<ProjectCard group={grp()} onToggle={onToggle} onOpen={() => {}} onActions={() => {}} />);
    await userEvent.click(screen.getByRole('button', { expanded: true }));
    expect(onToggle).toHaveBeenCalledWith('demo');
  });
});

describe('the + button', () => {
  it('names the projected account and its headroom', () => {
    render(<ProjectCard group={grp()} projected={{ wrapper: 'claude', score: 9 }}
                        onAddWorkspace={() => {}} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText(/91% free/)).toBeInTheDocument();
  });

  it('still offers a + before any projection has landed', () => {
    // /api/accounts has its own poll; the + must never wait on it.
    render(<ProjectCard group={grp()} projected={null} onAddWorkspace={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /new workspace on demo/i })).toBeEnabled();
  });

  it('disables itself while that project has an add in flight', () => {
    // ccd does not dedupe concurrent ws-adds: two calls draw two slugs and
    // create two worktrees, two branches and two systemd units.
    render(<ProjectCard group={grp()} adding onAddWorkspace={() => {}}
                        onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByRole('button', { name: /new workspace on demo/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-card.test.tsx`
Expected: FAIL — cannot resolve `../src/fleet/ProjectCard`; and `FleetGroup` still carries `grouped`, so the `grp()` helper will not typecheck until Task 5 removes it. **If that is the only typecheck error, add `grouped: false` to the helper for now and delete it in Task 5** — note it in your report so Task 5's implementer knows to remove it.

- [ ] **Step 3: Write the component**

Create `infra/ccrc/pwa/src/fleet/ProjectCard.tsx`:

```tsx
// A project's card. ALWAYS a card, at every session count — a project holding
// one renders exactly like a project holding five.
//
// ProjectGroup showed a header only at two-or-more members, and the live fleet
// is nine sessions across nine distinct projects: the header rendered nowhere,
// so the strongest element on screen was a session while the thing a reader
// navigates by had no container. Making the project the container also removes
// an ambiguity — ProjectGroup titled a lone card on `project` and a grouped one
// on the workspace, so the same component meant two things depending on a
// sibling count.
//
// Fold state is passed IN, never owned here: FleetScreen holds it (foldState.ts)
// so it survives navigation, and a pure card is what lets a test assert folding
// without touching localStorage.
import type { ReactNode } from 'react';
import type { FleetSession, ProjectedHome } from '../../../shared/api';
import { accountLabel } from '../lib/accounts';
import type { FleetGroup } from './groupFleet';
import { SessionLine } from './SessionLine';
import './fleet.css';

/** Score at which the projected landing account counts as exhausted — the same
 *  threshold the accounts strip calls `crit`. */
const LOW_HEADROOM = 75;

export function ProjectCard({
  group,
  onOpen,
  selectedId = null,
  onAddWorkspace,
  projected = null,
  adding = false,
  collapsed = false,
  onToggle,
  onActions,
}: {
  group: FleetGroup;
  onOpen: (id: string) => void;
  selectedId?: string | null;
  onAddWorkspace?: (project: string) => void;
  /** Where a new workspace would land, as the SERVER projects it (limits.ts
   *  `projectHome`, itself a mirror of ccd's `_ws_least_loaded`). Never
   *  recomputed here — a third copy of the routing rule would drift from both.
   *  Null until the first /api/accounts poll lands; the `+` never waits on it. */
  projected?: ProjectedHome | null;
  /** This project's own ws-add is in flight. ccd does not dedupe concurrent
   *  ws-adds, and the spawn window runs to minutes. */
  adding?: boolean;
  collapsed?: boolean;
  onToggle?: (project: string) => void;
  onActions: (session: FleetSession) => void;
}): ReactNode {
  // Headroom, not load: "91% free" is the question being asked ("can this
  // workspace actually run?"), and the answer stays legible when the score is
  // above the swap ceiling — which ccd's rule permits, since it returns the
  // least-loaded account even when every account is pinned.
  const headroom = projected ? 100 - projected.score : null;

  const cardClass =
    'proj-card' +
    (group.attention ? ' proj-card--attention' : group.busy > 0 ? ' proj-card--busy' : '');

  return (
    <section className={cardClass} data-collapsed={collapsed || undefined}>
      <div className="proj-card-head">
        <button
          type="button"
          className="proj-card-toggle"
          aria-expanded={!collapsed}
          onClick={() => onToggle?.(group.project)}
        >
          <span className="proj-card-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
          <span className="proj-card-name">{group.project}</span>
          <span className="proj-card-count">{group.sessions.length}</span>
          {/* Collapsed or not: a fold must never be able to hide a pending
              dialog, which is the one thing this screen exists to surface. */}
          {group.attention && (
            <span className="proj-card-attn" aria-label="waiting on you" role="img">
              ●
            </span>
          )}
        </button>

        {onAddWorkspace && (
          <button
            type="button"
            className="proj-card-add"
            aria-label={
              projected
                ? `New workspace on ${group.project} — ${accountLabel(projected.wrapper)}, ${headroom}% free`
                : `New workspace on ${group.project}`
            }
            onClick={() => onAddWorkspace(group.project)}
            disabled={adding}
          >
            <span aria-hidden="true">+</span>
            {projected && (
              <span className="proj-add-acct" data-low={projected.score >= LOW_HEADROOM || undefined}>
                {accountLabel(projected.wrapper)} · {headroom}% free
              </span>
            )}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="proj-card-body">
          {group.sessions.map((s) => (
            <SessionLine
              key={s.id}
              session={s}
              onOpen={onOpen}
              selected={s.id === selectedId}
              onActions={onActions}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `infra/ccrc/pwa/src/fleet/fleet.css`. Reuse the existing `.proj-group-*` rules as the starting point — read them first and carry across whatever the card should keep (they are being deleted in Task 5, so nothing is shared afterwards):

```css
/* ── project card ─────────────────────────────────────────────────
   The card is the project, at every session count. */
.proj-card {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  padding: var(--s-3);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-surface);
}

.proj-card--busy { border-color: var(--live); }
.proj-card--attention { border-color: var(--attn); }

.proj-card-head {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.proj-card-toggle {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  flex: 1;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.proj-card-chevron { color: var(--ink-secondary); }

.proj-card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.proj-card-count {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  color: var(--ink-secondary);
}

.proj-card-attn { color: var(--attn); }

.proj-card-add {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  min-height: 44px;
  padding: 0 var(--s-2);
  background: none;
  border: 0;
  color: var(--ink-secondary);
  cursor: pointer;
}

.proj-card-body {
  display: flex;
  flex-direction: column;
}
```

As in Tasks 2 and 3: confirm every token exists before using it, substitute the real name where one does not, and report the substitutions.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd infra/ccrc/pwa && npx vitest run test/project-card.test.tsx && npx tsc --noEmit`
Expected: 9 passed, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add infra/ccrc/pwa/src/fleet/ProjectCard.tsx infra/ccrc/pwa/src/fleet/fleet.css \
        infra/ccrc/pwa/test/project-card.test.tsx
git commit -m "feat(pwa): ProjectCard — the card is the project, at every count"
```

---

### Task 5: Wire it in; delete `ProjectGroup` and the `grouped` flag

**Files:**
- Modify: `infra/ccrc/pwa/src/screens/FleetScreen.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/groupFleet.ts`
- Delete: `infra/ccrc/pwa/src/fleet/ProjectGroup.tsx`
- Delete: `infra/ccrc/pwa/test/project-group.test.tsx`
- Modify: `infra/ccrc/pwa/test/groupFleet.test.ts`, `infra/ccrc/pwa/test/fleet-screen.test.tsx`

**Interfaces:**
- Consumes: `useFolded` (Task 1), `ProjectCard` (Task 4), `SessionActionsSheet` (Task 3).
- Produces: `FleetGroup` without `grouped`.

**Context:** `grouped: members.length > 1` existed solely to choose between the bare and headered render paths. With a uniform card there is one path, so the flag reads nowhere. **Remove it rather than leaving a field nothing consumes** — a dead flag is a trap for the next reader, and its tests would keep passing while asserting nothing anyone depends on.

The actions sheet is mounted **once, at screen level**, not per line: one sheet fed by whichever session was tapped.

- [ ] **Step 1: Remove `grouped` from the group type**

In `infra/ccrc/pwa/src/fleet/groupFleet.ts`, delete this from the `FleetGroup` interface:

```ts
  /** False for a project holding one session: it renders bare, with no header
   *  and no chevron. Most projects hold one and always will; the screen must
   *  not pay for worktrees it does not have. */
  grouped: boolean;
```

and delete this line from the object `groupFleet` pushes:

```ts
      grouped: members.length > 1,
```

- [ ] **Step 2: Drop the two assertions that covered it**

In `infra/ccrc/pwa/test/groupFleet.test.ts`, delete the two `it(...)` blocks that assert on `grouped` (they read `'leaves a one-session project ungrouped, so the screen is unchanged today'` and the sibling that expects `grouped` to be `true`). Everything they *also* asserted — grouping, ordering, membership — is covered by the remaining tests; verify that by reading them before deleting, and say in your report which assertions you confirmed were duplicated elsewhere.

If Task 4 left a `grouped: false` in `test/project-card.test.tsx`'s `grp()` helper, delete it now.

- [ ] **Step 3: Wire `FleetScreen`**

In `infra/ccrc/pwa/src/screens/FleetScreen.tsx`, replace the `ProjectGroup` import:

```ts
import { ProjectGroup } from '../fleet/ProjectGroup';
```

with:

```ts
import { ProjectCard } from '../fleet/ProjectCard';
import { SessionActionsSheet } from '../fleet/SessionActionsSheet';
import { useFolded } from '../fleet/foldState';
```

Add `FleetSession` to the type imports at the top of the file:

```ts
import type { FleetSession } from '../../../shared/api';
```

Inside the component, beside the existing `const projected = useProjectedHome();`:

```ts
  // Fold state persists across navigation (foldState.ts) — useState here would
  // re-expand every project on the way back from a session.
  const [folded, toggleFold] = useFolded();
  // One sheet for the whole screen, fed by whichever line was tapped.
  const [actionsFor, setActionsFor] = useState<FleetSession | null>(null);
```

Replace the render block:

```tsx
            {groupFleet(sessions).map((g) => (
              <ProjectGroup
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void addWorkspace(p)}
                projected={projected}
                adding={adding.has(g.project)}
              />
            ))}
```

with:

```tsx
            {groupFleet(sessions).map((g) => (
              <ProjectCard
                key={g.project}
                group={g}
                onOpen={open}
                selectedId={selectedId}
                onAddWorkspace={(p) => void addWorkspace(p)}
                projected={projected}
                adding={adding.has(g.project)}
                collapsed={folded.has(g.project)}
                onToggle={toggleFold}
                onActions={setActionsFor}
              />
            ))}
```

And mount the sheet just before the closing `</main>`, beside `<NewSessionSheet .../>`:

```tsx
      <SessionActionsSheet
        session={actionsFor}
        open={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        fleet={store}
      />
```

- [ ] **Step 4: Delete `ProjectGroup` and its suite**

```bash
git rm infra/ccrc/pwa/src/fleet/ProjectGroup.tsx infra/ccrc/pwa/test/project-group.test.tsx
```

Then confirm nothing still references it:

```bash
grep -rn "ProjectGroup" infra/ccrc/pwa/src infra/ccrc/pwa/test
```

Expected: no matches. A stale reference in `fleet.css` comments is fine to leave for now — Task 6 sweeps the CSS.

- [ ] **Step 5: Reshape `fleet-screen.test.tsx`**

Run it and read the failures:

```bash
cd infra/ccrc/pwa && npx vitest run test/fleet-screen.test.tsx
```

The screen now renders a header for **every** project, and sessions as lines — so assertions written against the old bare-card path will fail. Update each failing assertion to the new DOM. **Do not delete a test to make the file pass**: if an assertion no longer has a meaning under the new hierarchy, replace it with the equivalent assertion about the new structure and say so in your report. Add one new test to this file:

```tsx
  it('keeps a project folded across a remount', async () => {
    // The whole reason fold state left useState: navigating into a session and
    // back re-expanded everything.
    const store = /* the file's existing store helper, seeded with one session */;
    const first = render(<FleetScreen store={store} />);
    await userEvent.click(screen.getByRole('button', { expanded: true }));
    first.unmount();
    render(<FleetScreen store={store} />);
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
  });
```

Use whatever store-seeding helper that file already defines rather than building a second one, and clear `window.localStorage` in its `beforeEach` so this test cannot leak fold state into its neighbours.

- [ ] **Step 6: Run the full suite**

Run: `cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit`

Expected: green. The total should be **313 + 8 + 11 + 8 + 9 − 12 − 2 + 1 = 336**, minus any net change from reshaping `fleet-screen`. Report the number you actually see and account for any difference; do not adjust tests to reach it.

- [ ] **Step 7: Commit**

```bash
git add -A infra/ccrc/pwa
git commit -m "feat(pwa): the fleet list is project cards of session lines

ProjectGroup and FleetGroup.grouped are deleted rather than left inert: with a
uniform card there is one render path, and a flag nothing reads is a trap for
the next reader."
```

---

### Task 6: Retire `SessionCard`; close the contrast gate

**Files:**
- Delete (conditionally): `infra/ccrc/pwa/src/fleet/SessionCard.tsx`, `infra/ccrc/pwa/test/session-card.test.tsx`
- Modify: `infra/ccrc/pwa/test/polish.test.tsx`
- Modify: `infra/ccrc/pwa/src/fleet/fleet.css`
- Modify: `infra/ccrc/pwa/design/contrast-check.mjs`

**Interfaces:** none produced; this task closes the branch out.

**Context:** the spec's rule is explicit — *"If nothing else consumes `SessionCard` after the reshape, deleting it belongs to this work; if something does, it stays where it is."* Check, then act on what you find. Do not delete a component something still imports, and do not keep a dead one.

- [ ] **Step 1: Find out whether anything still consumes it**

```bash
cd infra/ccrc/pwa && grep -rn "SessionCard" src/ test/
```

Record the result in your report. Two outcomes:

- **Only `SessionCard.tsx` itself and `test/session-card.test.tsx` match** → it is dead. `git rm` both, then re-run the suite.
- **Something else imports it** → leave both files in place, name the consumer in your report, and skip to Step 3.

```bash
git rm infra/ccrc/pwa/src/fleet/SessionCard.tsx infra/ccrc/pwa/test/session-card.test.tsx
```

- [ ] **Step 2: Reshape `polish.test.tsx`**

Run: `cd infra/ccrc/pwa && npx vitest run test/polish.test.tsx`

Its card-level visual assertions now target elements that no longer exist. For each failure, decide whether the property being asserted still exists somewhere (move the assertion to `.proj-card` or `.sess-line`) or was cut by the spec (the attention sentence and the limit sentence both were — those assertions go). **Every removal must be named in your report with which spec line cut it.** A test deleted without a reason is a silently lost guarantee.

- [ ] **Step 3: Sweep the CSS**

Delete the now-unreachable rules from `infra/ccrc/pwa/src/fleet/fleet.css`: the `.proj-group-*` block, the `.proj-add-bare` rule, and any `.card-*` rule that only `SessionCard` used (`.card-attn`, `.card-limit-note`, `.card-hint`, `.card-restart`, `.card-remove`, `.card-tasks`, `.task-*`, `.status-line*`, `.lamp*`, `.card-top`, `.card-sub`, `.card-open`, `.proj`). **Check each against the rest of `src/` before deleting it** — `.card` itself is used by the skeleton block in `FleetScreen` and by other screens, and `.chip` is used by `SwapSheet`:

```bash
grep -rn "className=\"card\|className={.*card\|'card'" src/ | grep -v fleet/SessionCard
```

Keep `.proj-add-acct` — `ProjectCard` still uses it.

- [ ] **Step 4: Register the new contrast pairs**

Read `infra/ccrc/pwa/design/contrast-check.mjs` — the `pairs()` function at line 50 and the existing entry near line 74 documenting how `.proj-group-attn` sits on the bare page. Add an entry for every new foreground/background combination this branch introduced that is not already covered:

- `.sess-state--waiting` (`--attn`) on the card surface
- `.sess-state--working` (`--live`) on the card surface
- `.sess-warn` (`--warn`) on the card surface
- `.sess-acct` (each account colour) on the card surface
- `.proj-card-attn` (`--attn`) on the card surface — the existing entry describes it on the *page*, and the card surface is a different background

Update the `.proj-group-attn` comment to name `.proj-card-attn` instead.

Run: `node infra/ccrc/pwa/design/contrast-check.mjs`

Expected: `ALL <n> PASS` at a count **above 82**. If any pair fails, adjust the token used in the CSS rather than lowering the threshold, and report which pair failed and what you changed.

- [ ] **Step 5: Full non-regression across all three packages**

```bash
cd infra/ccrc/pwa && npx vitest run && npx tsc --noEmit
cd ../server && npx vitest run && npx tsc --noEmit
cd ../agent && npx vitest run
node ../pwa/design/contrast-check.mjs
```

Expected: pwa green (~324, minus whatever `polish` shed — report the real number), **server 395 and agent 86 exactly unchanged**, three clean typechecks, contrast gate all-pass.

- [ ] **Step 6: Confirm the bundle still builds**

```bash
cd infra/ccrc/pwa && npm run build
```

Expected: a clean Vite build into `../server/dist-pwa`. A test suite passing is not evidence that the app compiles — this is the check that the deleted CSS and components left no dangling import. **Do not deploy**; that is a separate decision.

- [ ] **Step 7: Commit**

```bash
git add -A infra/ccrc/pwa
git commit -m "refactor(pwa): retire SessionCard, sweep its CSS, extend the contrast gate"
```

---

## Out of scope

- **PR state on the line** — Plan B. The line's right-hand side is deliberately left with room for it.
- **Raising, merging or archiving PRs** — workspaces Phase 2/3.
- **Reordering or filtering projects.** `sortFleet`'s urgency order stands unchanged, and group order still derives from it via `Map` insertion order.
- **Auto-expanding a folded project when a session inside it needs attention.** Explicitly ruled against in the spec: the header's dot is sufficient, and auto-expansion would override a choice the reader made.
- **Syncing fold state between devices.** Per-browser is the right default for a layout preference.
