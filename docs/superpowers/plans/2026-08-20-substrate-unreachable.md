# `substrate-unreachable` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fleet whose tmux cannot be reached survives it, reports it accurately (a `.substrate` decision record per supervisor, an additive `FleetSession.substrate` axis, a chip + one derived banner in the PWA), and disables every destructive affordance for the duration — per the approved spec `docs/superpowers/specs/2026-08-19-substrate-unreachable-design.md` (v2).

**Architecture:** ccd's `cmd_supervise` loop becomes verdict-driven with a deadline-bounded probe and matched backoff; the registry gains one flat file (`$REG/<id>.substrate`, `<epoch-seconds> <text>`); the server reads it in `buildRecord` with the `.hold` listed-vs-readable ladder and projects it through `assembleFleet` (seconds→ms at that seam, like `stoppedBy`); the PWA reads it through a shared tolerant helper and renders the `sess-unmeasured` chip idiom, a rows-derived banner, and disabled+title gates. `SessionLifecycle`, `SessionStatus`, buckets, and `FLEET_PROTO` are all untouched.

**Tech Stack:** bash (ccd), TypeScript (server/shared/pwa), vitest, React.

## Global Constraints

- **Wire discipline:** additive-only; `FLEET_PROTO` stays 1 (`fleet-protocol.test.ts` must stay green untouched). Absence-permits through ONE reader.
- **Timebase:** registry stamps are epoch SECONDS; the wire is epoch MS (`archivedAt` is the sole exception). Conversion happens in `fleet.ts` only, like `stoppedBy` (`fleet.ts:370`).
- **Never a masking state:** `SessionLifecycle`, `SessionStatus`, `SessionBucket` gain no member. The axis rides beside them (spec §3; M10 discipline).
- **Fail-shut polarity (D-B8-12/13):** only tmux's own `can't find session` means death; everything else refuses. No new classifier — `_session_verdict` is the one bash classifier, `classifyHasSession` the one TS classifier.
- **Marker text is never empty** — a killed probe gets a synthesized reason.
- **Every commit touching `ccd/ccd` re-stamps the provenance marker in that commit** (command in Task 1, from `ownership.test.ts:131-138`).
- **Suites:** `./node_modules/.bin/vitest run <file>` from inside the package, foreground, timeout ≥600000ms. NEVER bare `npx vitest`.
- **Fixture HOMEs only** for ccd tests (`makeCcdHarness`); never the live `$HOME`.
- **Mutation-table discipline:** each guard ships with a mutation measured red (record before/after counts in the task).
- **ccd constants are plain assignments, deliberately NOT env-overridable** (pinned by `ccd-spawn-split.test.ts:317-324`); tests shorten them by reassigning AFTER sourcing (`h.sh('CONST=1; fn …')` — the `ccd-supervised-start.test.ts:364` idiom).
- **Deploy is AGENT-FIRST** (this slice touches `ccd/`).

---

### Task 1: `_session_probe` — the deadline-bounded probe primitive (ccd)

**Files:**
- Modify: `ccd/ccd` (constants block near `ccd:111`; `_session_verdict` at `ccd:328-340`)
- Test: `server/test/ccd-session-verdict.test.ts` (extend)

**Interfaces:**
- Produces: bash `_session_probe <id>` — sets globals `PROBE_VERDICT` (`live|gone|unknown`) and `PROBE_DETAIL` (non-empty iff unknown), always rc 0. Called DIRECTLY (never in `$(…)` — the globals must survive). `_session_verdict` re-derived from it (still echoes the word; callers unchanged). Constant `SUBSTRATE_PROBE_DEADLINE_S=8`.
- Consumes: `_tmux` (`ccd:311`), the existing classifier arms.

- [ ] **Step 1: Write the failing tests** — append to `ccd-session-verdict.test.ts`:

```ts
describe('_session_probe — the verdict plus its diagnosis, without a subshell (spec §1)', () => {
  it('sets PROBE_VERDICT and a verbatim PROBE_DETAIL for unknown', () => {
    expect(h.sh(`${tmuxSaying('protocol version mismatch (client 8, server 7)')}
      _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim())
      .toBe('unknown|protocol version mismatch (client 8, server 7)');
  });
  it('live and gone carry no detail', () => {
    expect(h.sh(`${TMUX_LIVE} _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim()).toBe('live|');
    expect(h.sh(`${tmuxSaying("can't find session: cc-demo")} _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim()).toBe('gone|');
  });
  it('_session_verdict still answers through the probe — one classifier, not two', () => {
    // Delete/duplicate guard: shadowing _session_probe must change _session_verdict's answer.
    expect(h.sh(`_session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=; }; _session_verdict demo`).trim()).toBe('gone');
  });
  it('a WEDGED tmux is bounded by the deadline and answers unknown with a synthesized, non-empty reason', () => {
    // The wedge shape (spec §1): an EXECUTABLE stub that never answers — timeout(1) can kill a
    // binary, not a bash function, so this test plants a real file on PATH.
    const bin = path.join(h.home, 'wedge-bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'tmux'), '#!/usr/bin/env bash\nsleep 60\n', { mode: 0o755 });
    const out = h.sh(`export PATH="${bin}:$PATH"; SUBSTRATE_PROBE_DEADLINE_S=1
      _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim();
    expect(out).toMatch(/^unknown\|tmux did not answer within 1s$/);
  });
  it('the deadline applies ONLY to a real binary — function stubs keep working undeadlined', () => {
    // The largest test-compat hazard, pinned: `timeout` execs, so every `tmux() { … }` stub in
    // this suite would be invisible if the deadline wrapped them. `_session_probe` must detect
    // the function and call it directly.
    expect(h.sh(`${TMUX_LIVE} _session_probe demo; echo "$PROBE_VERDICT"`).trim()).toBe('live');
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `cd server && ./node_modules/.bin/vitest run test/ccd-session-verdict.test.ts` → FAIL (`_session_probe: command not found`). The wedge test MUST be bounded: `h.sh` runs under `execFileSync` — add `{ timeout: 15000 }` if the harness supports it, else rely on the 1 s deadline; confirm the failing run does not hang.

- [ ] **Step 3: Implement.** Constant beside `TMUX_SERVER_LOCK_WAIT` (`ccd:111`), same column style:

```bash
SUBSTRATE_PROBE_DEADLINE_S=8    # bound on ONE has-session probe. Healthy answer: ~8ms (measured
                                # 2026-08-19); a SIGSTOPped server blocks the client FOREVER, so
                                # an unbounded probe turns a wedge into a silent supervisor hang.
```

Replace `_session_verdict` (`ccd:328-335`) with the probe + a re-derivation (keep the polarity comment block; extend it with the probe rationale):

```bash
_session_probe() {   # id -> PROBE_VERDICT=live|gone|unknown, PROBE_DETAIL (unknown only); rc 0
  # Direct call, never $( ) — the whole point is returning TWO facts without a subshell
  # eating them. The deadline applies ONLY when tmux is a real executable: `timeout` execs
  # its argv, so a test's `tmux() { … }` function stub would be invisible behind it — and a
  # stubbed substrate needs no deadline, it cannot wedge.
  local out rc
  if [[ $(type -t tmux) == function ]]; then
    out=$(tmux has-session -t "$(_tmux "$1")" 2>&1); rc=$?
  else
    out=$(timeout "$SUBSTRATE_PROBE_DEADLINE_S" tmux has-session -t "$(_tmux "$1")" 2>&1); rc=$?
  fi
  if (( rc == 0 )); then PROBE_VERDICT=live; PROBE_DETAIL=""; return 0; fi
  # rc 124 is timeout's own kill: tmux printed nothing, so the reason is SYNTHESIZED —
  # an empty marker reason is the one shape a maintainer can do nothing with (spec §1).
  if (( rc == 124 )) && [[ -z "$out" ]]; then
    PROBE_VERDICT=unknown; PROBE_DETAIL="tmux did not answer within ${SUBSTRATE_PROBE_DEADLINE_S}s"; return 0
  fi
  case "$out" in
    *"can't find session"*) PROBE_VERDICT=gone;    PROBE_DETAIL="" ;;
    *)                      PROBE_VERDICT=unknown; PROBE_DETAIL="${out:-tmux exited $rc with no message}" ;;
  esac
}
_session_verdict() {   # id -> live|gone|unknown on stdout; always rc 0 (derived; one classifier)
  _session_probe "$1"; echo "$PROBE_VERDICT"
}
```

- [ ] **Step 4: Re-stamp the provenance marker** (from repo root, EVERY time ccd/ccd changes):

```bash
node --input-type=module -e "import { readFileSync, writeFileSync } from 'node:fs'; const { markGenerated } = await import('./shared/mark.mjs'); writeFileSync('ccd/ccd', markGenerated(readFileSync('ccd/ccd', 'utf8')))"
```

- [ ] **Step 5: Run** `test/ccd-session-verdict.test.ts` (all green, fixture rows still driving the classifier) and `test/ownership.test.ts` (marker). Also run `test/ccd-session-state.test.ts` — its `_alive` stubs must be unaffected (they shadow `_alive`, which no longer matters for the classifier path only if a test shadows `_session_verdict`/`_session_probe`; verify no red).
- [ ] **Step 6: Mutation table** (edit, run the suite, restore, record counts): (a) deadline deleted (call tmux bare in the binary branch) → wedge test red; (b) rc-124 synthesized reason deleted → wedge test red (empty detail); (c) `_session_verdict` re-implemented standalone (not via probe) → one-classifier test red.
- [ ] **Step 7: Commit** `feat(ccd): _session_probe — the verdict plus its diagnosis, deadline-bounded (D-B8-14)`.

---

### Task 2: `.substrate` — the marker's writer, remover, and inventory slot (ccd)

**Files:**
- Modify: `ccd/ccd` (helpers near `_reg_set` `ccd:341`; `_reg_purge` field inventory comment `ccd:379-401`)
- Test: `server/test/ccd-substrate.test.ts` (create)

**Interfaces:**
- Produces: `_substrate_mark <id>` (writes `$REG/<id>.substrate` = `"$(date +%s) $PROBE_DETAIL"`, and on FIRST write appends the skew record `" (client <tmux -V>; server <version-or-unreachable>)"`); `_substrate_clear <id>` (`rm -f`, silent when absent). File format: `<epoch-seconds> <text>`, text never empty.
- Consumes: `PROBE_DETAIL` (Task 1), `_reg_set`/`$REG`.

- [ ] **Step 1: Write the failing tests** (`ccd-substrate.test.ts`, `makeCcdHarness('ccrc-ccd-substrate-')`):

```ts
describe('the substrate marker — one writer, epoch + verbatim reason (spec §2)', () => {
  it('mark writes "<epoch> <detail>", clear removes it, absent clear is silent', () => {
    h.sh(`PROBE_DETAIL='no server running on /tmp/x'; date() { [[ "$1" == +%s ]] && echo 1755620112 || command date "$@"; }
          tmux() { echo 'tmux 3.4' ; }
          _substrate_mark demo`);
    expect(h.reg('demo', 'substrate')).toMatch(/^1755620112 no server running on \/tmp\/x/);
    h.sh('_substrate_clear demo');
    expect(existsSync(path.join(h.home, '.cc-sessions', 'demo.substrate'))).toBe(false);
    h.sh('_substrate_clear demo');   // absent: no error
  });
  it('the FIRST write records the skew comparison; later writes do not repeat it', () => {
    const stub = `date() { [[ "$1" == +%s ]] && echo 100 || command date "$@"; }
      tmux() { case "$1" in -V) echo 'tmux 3.5'; return 0 ;; display-message) echo 'protocol version mismatch' >&2; return 1 ;; esac; }`;
    h.sh(`${stub} PROBE_DETAIL='x'; _substrate_mark demo`);
    const first = h.reg('demo', 'substrate');
    expect(first).toContain('client tmux 3.5');
    expect(first).toContain('server unreachable');
    h.sh(`${stub} PROBE_DETAIL='y'; _substrate_mark demo`);
    expect(h.reg('demo', 'substrate')).toBe('100 y');   // refresh, no second skew suffix
  });
  it('the reason is NEVER empty — an empty PROBE_DETAIL is refused with a synthesized text', () => {
    h.sh(`PROBE_DETAIL=''; tmux() { echo 'tmux 3.4'; }; _substrate_mark demo`);
    expect(h.reg('demo', 'substrate')).toMatch(/^\d+ .+/);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`_substrate_mark: command not found`).
- [ ] **Step 3: Implement** beside `_reg_claim` (`ccd:357`):

```bash
_substrate_mark() {   # id — record "this supervisor could not reach tmux" ($REG/<id>.substrate)
  # ONE writer per file: this row's supervisor. The fleet-wide statement is DERIVED by the
  # reader, never written (spec §2). Text is never empty; the skew comparison rides on the
  # FIRST write only — that is the moment the answer is wanted, one bounded call per fault.
  local id="$1" why="${PROBE_DETAIL:-tmux gave no reason}" f="$REG/$1.substrate"
  if [[ ! -e "$f" ]]; then
    local client server
    client=$(tmux -V 2>&1 || true)
    # Same function-vs-binary split as _session_probe, same reason: `timeout` execs.
    if [[ $(type -t tmux) == function ]]; then
      server=$(tmux display-message -p '#{version}' 2>/dev/null) || server="unreachable"
    else
      server=$(timeout "$SUBSTRATE_PROBE_DEADLINE_S" tmux display-message -p '#{version}' 2>/dev/null) || server="unreachable"
    fi
    why="$why (client ${client:-unknown}; server ${server:-unreachable})"
  fi
  printf '%s %s' "$(date +%s)" "$why" > "$f"
}
_substrate_clear() { rm -f -- "$REG/$1.substrate"; }
```

Add `substrate` to `_reg_purge`'s field inventory comment (`ccd:379-401`) so a purge provably covers it.

- [ ] **Step 4: Re-stamp the marker** (Task 1 Step 4 command). **Step 5: Run** the new suite + `ownership.test.ts` → green.
- [ ] **Step 6: Mutation:** (a) skew suffix on every write → second-write test red; (b) empty-reason guard deleted → never-empty test red.
- [ ] **Step 7: Commit** `feat(ccd): the substrate marker — one writer, epoch + verbatim reason (D-B8-14)`.

---

### Task 3: `cmd_supervise` — verdict-driven, backed off, heartbeat kept honest (ccd)

**Files:**
- Modify: `ccd/ccd` (constants; the loop at `ccd:8613-8619`)
- Test: `server/test/ccd-substrate.test.ts` (extend)

**Interfaces:**
- Consumes: `_session_probe` (Task 1), `_substrate_mark`/`_substrate_clear` (Task 2).
- Produces: constants `SUBSTRATE_BACKOFF_S=30`, `SUBSTRATE_BACKOFF_AFTER=3`. Loop contract: `gone` is the ONLY exit; `unknown` marks + stamps EVERY tick + backs off; `live` clears a marker if one exists.

- [ ] **Step 1: Write the failing tests** — drive the loop with the `ccd-session-state.test.ts:250-262` counter idiom (`spawnSync` runner with `timeout: 15000`; stub `sleep`, `cmd_ensure`, `systemctl`, the three tick helpers; sequence the probe):

```ts
// Sequenced probe: answers from an array, then 'gone' forever — the loop's only exit.
// Elements are single-quoted: a detail with a SPACE must stay one array element.
const seq = (...v: string[]): string =>
  `_i=0; _seq=(${v.map((x) => `'${x}'`).join(' ')}); _session_probe() {
     local x="\${_seq[$_i]:-gone}"; _i=$((_i+1))
     PROBE_VERDICT="\${x%%:*}"; PROBE_DETAIL="\${x#*:}"; [[ "$PROBE_DETAIL" == "$x" ]] && PROBE_DETAIL=""; }`;
const LOOP_STUBS = `systemctl() { :; }; sleep() { echo "sleep \${1:-}" >> "$HOME/ccd-calls"; }
  cmd_ensure() { :; }; _sync_uuid() { :; }; _auto_swap_check() { :; }; _auto_compact_check() { :; }`;

describe('cmd_supervise under a substrate fault (spec §1)', () => {
  it('unknown does NOT exit, marks the row, and stamps the heartbeat EVERY unknown tick', () => {
    run(`${LOOP_STUBS} ${seq('unknown:protocol mismatch', 'unknown:protocol mismatch', 'gone')}
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    expect(h.calls().filter((l) => l === 'stamp supervised').length).toBeGreaterThanOrEqual(3); // pre-ensure + 2 unknown ticks
    expect(h.reg(ID, 'substrate')).toContain('protocol mismatch');
  });
  it('the FIRST live after unknown clears the marker; a STALE marker from a dead supervisor clears too', () => {
    run(`${LOOP_STUBS} ${seq('unknown:x', 'live', 'gone')} cmd_supervise ${ID}`);
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.substrate`))).toBe(false);
    h.sh(`printf '1 stale' > "$REG/${ID}.substrate"`);
    run(`${LOOP_STUBS} ${seq('live', 'gone')} cmd_supervise ${ID}`);
    expect(existsSync(path.join(h.home, '.cc-sessions', `${ID}.substrate`))).toBe(false);
  });
  it('backs off 5s -> 30s after SUBSTRATE_BACKOFF_AFTER consecutive unknowns, and 5s again on live', () => {
    run(`${LOOP_STUBS} ${seq('unknown:x', 'unknown:x', 'unknown:x', 'unknown:x', 'live', 'unknown:x', 'gone')}
      cmd_supervise ${ID}`);
    const sleeps = h.calls().filter((l) => l.startsWith('sleep ')).map((l) => l.slice(6));
    // unknown_run 1,2 sleep 5; run 3 REACHES the threshold so the sleep AFTER the third
    // unknown is already 30 (and stays 30); live resets to 5; a fresh unknown starts at 5.
    expect(sleeps).toEqual(['5', '5', '30', '30', '5', '5']);
  });
  it('gone stays the ONLY exit — an unknown-only run is bounded by the seq fallback, not by exiting', () => {
    const r = run(`${LOOP_STUBS} ${seq('unknown:x', 'gone')} cmd_supervise ${ID}`);
    expect(r.status).toBe(1);   // the gone exit, systemd's restart signal, unchanged
  });
  it('the three tick helpers are SKIPPED on an unknown tick — each would shell into the dead tmux', () => {
    run(`${LOOP_STUBS} ${seq('unknown:x', 'gone')}
      _sync_uuid() { echo tickhelper >> "$HOME/ccd-calls"; }
      cmd_supervise ${ID}`);
    expect(h.calls().filter((l) => l === 'tickhelper')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL** (today `unknown` exits the loop: sleeps/marker/stamps all wrong). Confirm no hang — every sequence ends in `gone` and `run()` carries the 15 s spawnSync timeout.
- [ ] **Step 3: Implement.** Constants beside `SUBSTRATE_PROBE_DEADLINE_S`:

```bash
SUBSTRATE_BACKOFF_S=30          # unknown-tick interval once the fault is established
SUBSTRATE_BACKOFF_AFTER=3       # consecutive unknowns before backing off 5s -> 30s
```

Replace the loop body (`ccd:8613-8619`; keep the surrounding comment, extend it):

```bash
  local beat=0 unknown_run=0 tick=5
  while :; do
    _session_probe "$id"
    case "$PROBE_VERDICT" in
      gone) break ;;   # the ONLY exit — a session tmux itself pronounced dead (D-B8-14)
      live)
        [[ -e "$REG/$id.substrate" ]] && _substrate_clear "$id"
        unknown_run=0; tick=5
        _sync_uuid "$id"; _auto_swap_check "$id"; _auto_compact_check "$id"
        beat=$((beat + tick))
        (( beat >= 30 )) && { _reg_set "$id" supervised "$(date +%s)"; beat=0; }
        ;;
      unknown)
        # Not death — refusal to guess (spec §1). Mark, keep the heartbeat honest EVERY
        # tick (beat counts ASSUMED seconds; a 30s sleep against beat+=5 stamps every 180
        # real seconds and ages all 17 rows into orphan mid-fault — the false dead by a
        # slower route), skip the tick helpers (each shells into the tmux that just did
        # not answer), and back off: 17 supervisors hammering a wedged server every 5s is
        # a thundering herd against a component already unwell.
        unknown_run=$((unknown_run + 1))
        _substrate_mark "$id"
        _reg_set "$id" supervised "$(date +%s)"; beat=0
        tick=5; (( unknown_run >= SUBSTRATE_BACKOFF_AFTER )) && tick=$SUBSTRATE_BACKOFF_S
        ;;
    esac
    sleep "$tick"
  done
```

- [ ] **Step 4: Re-stamp; run** the new suite + `ccd-session-state.test.ts` + `ccd-supervised-start.test.ts` + `ownership.test.ts`. `ccd-session-state.test.ts:236-262` stubs `_alive` to drive this loop — the loop no longer calls `_alive`, so those stubs go dark: REWRITE those two tests to stub `_session_probe` instead (loud, like D-B8-12's 231; the `_session_state` table still stubs `_alive` legitimately — `_session_state` keeps calling it).
- [ ] **Step 5: Mutation:** (a) every-tick stamp on unknown removed → stamp-count test red; (b) `unknown` exits (old world) → non-exit test red; (c) backoff deleted → sleeps test red; (d) marker clear on live deleted → clear test red; (e) helpers not skipped → skip test red. Record counts.
- [ ] **Step 6: Commit** `feat(ccd): cmd_supervise stops treating silence as death (D-B8-14)`.

---

### Task 4: `SessionRecord.substrate` — the registry read, on the `.hold` ladder (server)

**Files:**
- Modify: `server/src/registry.ts` (SessionRecord `:22-170`; `buildRecord` `:396-528`; the 21-read pin's prose at `:114`, `:191`, `:379`, `:659`, `:673`)
- Test: `server/test/registry.test.ts`

**Interfaces:**
- Produces: `SessionRecord.substrate: { at: number; text: string } | null` (**epoch seconds**, registry-native). Constants `SUBSTRATE_UNREADABLE = '<substrate marker unreadable>'`, `SUBSTRATE_NO_REASON = '<substrate marker empty — reason lost>'` (the `HOLD_UNREADABLE`/`HOLD_NO_REASON` idiom, `registry.ts:225/:238`).
- Consumes: `packedStamp` (`registry.ts:270-277`), `names` (already a `buildRecord` param).

- [ ] **Step 1: Failing tests** (`registry.test.ts`, alongside the held ladder tests):

```ts
describe('SessionRecord.substrate — presence from the LISTING, never from a non-null read (spec §2)', () => {
  it('absent file -> null; well-formed "<epoch> <text>" -> {at, text}', async () => { /* seed a row; expect null.
    Then write `${id}.substrate` = '1755620112 protocol version mismatch'; expect {at: 1755620112, text: 'protocol version mismatch'} */ });
  it('LISTED but unreadable -> SUBSTRATE_UNREADABLE, never null — "no fault recorded" and "the marker
      would not read" are opposite answers', async () => { /* io whose readFile nulls only `${id}.substrate`;
    expect {at: 0, text: SUBSTRATE_UNREADABLE} */ });
  it('empty or unstamped content degrades loudly, not silently', async () => { /* '' -> {at: 0, text: SUBSTRATE_NO_REASON};
    'no epoch here' -> {at: 0, text: 'no epoch here'} (packedStamp rest-carrying) */ });
  it('the read count is 22 — the substrate file joined the sweep', async () => { /* update the 21 pin */ });
});
```

- [ ] **Step 2: Run → FAIL** (no field). The 21-read pin (`registry.test.ts:373-399`) is ALSO red — that is expected fallout, fixed in Step 3.
- [ ] **Step 3: Implement:** add the field + doc to `SessionRecord`; add `path.join(dir, `${id}.substrate`)` to the `Promise.all` (`:399-413`); `const substrateListed = names.includes(`${id}.substrate`);` beside `holdListed` (`:438`); assembly beside `held` (`:526`):

```ts
substrate: substrateRaw === null
  ? (substrateListed ? { at: 0, text: SUBSTRATE_UNREADABLE } : null)
  : substrateRaw === ''
    ? { at: 0, text: SUBSTRATE_NO_REASON }
    : (() => { const p = packedStamp(substrateRaw); return { at: p.at, text: p.rest || substrateRaw }; })(),
```

(If `packedStamp`'s exact return shape differs, follow it — the contract is: numeric leading stamp → `at`, remainder → `text`, and a stampless string lands whole in `text` with `at: 0`.) Update the 21→22 pin and every "21"/"~505" prose site listed above.
- [ ] **Step 4: Run** the full server suite (`./node_modules/.bin/vitest run`) — `SessionRecord` is server-internal, so the only fallout is server-test fixtures that build complete `SessionRecord` literals; add `substrate: null` to each until `typecheck-tests` and the suite are green. (`FleetSession` is untouched until Task 5, so nothing outside `server/` moves.)
- [ ] **Step 5: Mutation:** unreadable-arm → null (fail-open) → red; listing check removed → red.
- [ ] **Step 6: Commit** `feat(server): the registry reads the supervisor's substrate record (D-B8-14)`.

---### Task 5: The wire — `FleetSession.substrate`, revived and helpered (shared)

**Files:**
- Modify: `shared/api.ts` (interface `:33-161` beside `swapBlocked`; `reviveFleetSession` literal `:1517-1560`; a `reviveSubstrate` beside `reviveSwapBlocked` `:1356-1361`; a `substrateFault` helper beside `unmeasuredFields` `:185-187`)
- Test: `server/test/fleetstate.test.ts`

**Interfaces:**
- Produces: `FleetSession.substrate: { readonly at: number; readonly text: string } | null` (**epoch MS**); `reviveSubstrate` (absent/null → null; malformed → reject session — the `reviveSwapBlocked` contract: free text, no vocabulary to degrade onto); `substrateFault(s: { substrate?: { at: number; text: string } | null }): { at: number; text: string } | null` — the ONE tolerant reader both PWA surfaces use (guards `typeof at === 'number' && Number.isFinite(at)` and `typeof text === 'string' && text !== ''`; a half-valid object degrades per-half like `stampParts`, `lifecycleWords.ts:53-59`: bad `at` → keep text with `at: 0`; bad text → `'substrate fault (reason unreadable)'`).

- [ ] **Step 1: Failing tests** in `fleetstate.test.ts`, cloning the `unmeasured` model block (`:305-328`): absent → `null`; `{at, text}` survives a round trip; `{at: 'x'}` rejects the session (MalformedSnapshot → null file); plus `substrateFault` unit rows (missing key, null, valid, NaN at, empty text).
- [ ] **Step 2: Run → FAIL** (field missing → compile error in the fixture factories `fleetstate.test.ts:13-21`, `fleet-health.test.ts:38-46` — add `substrate: null` there in the same step so ONLY the new assertions are red).
- [ ] **Step 3: Implement** interface field (doc comment: the axis, spec §3, M10 — "a new FIELD, not a new status/bucket/lifecycle member"), `reviveSubstrate`, the literal line, and `substrateFault`.
- [ ] **Step 4: Run** `fleetstate.test.ts` + `typecheck-tests.test.ts` green (fix any remaining server-test FleetSession literals with `substrate: null`).
- [ ] **Step 5: Mutation:** revive line dropped from the literal → compile error (state it, no runtime mutation needed); `substrateFault` empty-text guard dropped → helper test red.
- [ ] **Step 6: Commit** `feat(shared): the substrate axis rides the wire — additive, revived, one reader (D-B8-14)`.

---

### Task 6: `assembleFleet` projects the axis (server)

**Files:**
- Modify: `server/src/fleet.ts` (the literal `:308-382`)
- Test: `server/test/fleet-lifecycle.test.ts` (the model: `:45-131`)

**Interfaces:**
- Consumes: `r.substrate` (Task 4, seconds), produces wire MS: `substrate: r.substrate === null ? null : { at: r.substrate.at * 1000, text: r.substrate.text }` — conversion HERE only, like `stoppedBy` (`:370`); an unreadable marker's `at: 0` stays `0` (a lie of `1970` is avoided in the PWA by rendering text-only when `at === 0`).

- [ ] **Step 1: Failing tests**, cloning `fleet-lifecycle.test.ts:102-110`: a seeded `.substrate` file reaches the session as `{at: seconds*1000, text}`; a row without one ships `substrate: null` and NEVER undefined (`Object.keys` arrayContaining); the field **moves neither `status` nor `bucket`** (the M10 pin, copied verbatim in spirit).
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** the one literal line. **Step 4: Green.**
- [ ] **Step 5: Mutation:** seconds→MS conversion dropped → red (assert the exact MS value).
- [ ] **Step 6: Commit** `feat(server): assembleFleet ships the substrate axis (D-B8-14)`.

---

### Task 7: PWA fixture wave + the chip (pwa)

**Files:**
- Modify: every full-literal `FleetSession` factory in `pwa/test/*` (the ~22 files inventoried in the plan's research — each `s()` base gains `substrate: null`); `pwa/src/fleet/SessionLine.tsx` (beside the unmeasured chip `:367-375`); `pwa/src/fleet/fleet.css` (`:1124` region + the achromatic override group `:761-764`); `pwa/test/fleet-css.test.ts` membership list (`:303-320`)
- Test: `pwa/test/session-line.test.tsx`

**Interfaces:**
- Consumes: `substrateFault` (Task 5).
- Produces: the `sess-substrate` chip.

- [ ] **Step 1: Failing tests** (clone the unmeasured block `session-line.test.tsx:582-629`):

```tsx
describe('substrate chip — the console cannot see this session, and says so (spec §4)', () => {
  it('no chip when substrate is null', () => { /* queryByText + [data-substrate] both null */ });
  it('chip with the verbatim reason in title', () => {
    render(<SessionLine session={s({ substrate: { at: 1755620112000, text: 'protocol version mismatch' } })} …/>);
    const chip = screen.getByText('unreachable tmux');
    expect(chip).toHaveClass('sess-substrate');
    expect(chip.getAttribute('title')).toContain('protocol version mismatch');
    expect(chip.getAttribute('title')).toMatch(/tmux unreachable since/);
  });
  it('a row LACKING the key at runtime renders without throwing — cast, not revived', () => { /* delete raw['substrate'] idiom, :611-629 */ });
  it('at === 0 (unreadable marker) renders the reason without a fabricated 1970 timestamp', () => { /* title lacks 'since' */ });
});
```

- [ ] **Step 2:** add `substrate: null` to EVERY full-literal factory (the compile-red wave — `cd pwa && ./node_modules/.bin/vitest run` typecheck drives the list; loud, like `unmeasured`'s landing), then confirm ONLY the new chip tests are red.
- [ ] **Step 3: Implement** the chip after the unmeasured block (same register — grey, generic words `unreachable tmux`, `data-substrate="true"`, reason verbatim in `title`, never parsed); CSS clone of `.sess-unmeasured` (`:1124-1132`) + join the `.sess-line--active` achromatic group AND its `fleet-css.test.ts` membership list.
- [ ] **Step 4: Green** (`session-line.test.tsx`, `fleet-css.test.ts`, full pwa suite).
- [ ] **Step 5: Mutation:** chip reads `session.substrate.text` directly (not via `substrateFault`) → the missing-key test red.
- [ ] **Step 6: Commit** `feat(pwa): the substrate chip — a row the console cannot see says so (D-B8-14)`.

---

### Task 8: The destructive-affordance gates (pwa)

**Files:**
- Modify: `pwa/src/fleet/SessionActionsSheet.tsx` (Restart `:265-267`, Swap `:349-351`, Archive `:353-358`, Reap `:434-439`, Forget `:448-453`), `pwa/src/screens/SessionScreen.tsx` (dead-banner Restart `:296-303`, Stop confirm path `:397-404`), `pwa/src/session/SessionHeader.tsx` (Stop menu item `:331-337`)
- Test: `pwa/test/session-actions-sheet.test.tsx`, `pwa/test/header.test.tsx`

**Interfaces:**
- Consumes: `substrateFault(session)`.
- Produces: one derived constant per component render: `const fault = substrateFault(session);` — every listed control gets `disabled={… || fault !== null}` + `title={fault !== null ? `tmux unreachable — ${fault.text}` : undefined}` (the `PrSheet.tsx:172` disabled+title idiom; the reason is THE SAME string the chip shows, never a second copy).

- [ ] **Step 1: Failing tests:** for each control, render with `s({ substrate: { at: 1, text: 'x' } })` → `expect(getByRole('button', {name: …})).toBeDisabled()` + title contains `'x'` + `fireEvent.click` does NOT call the api spy (the `header.test.tsx:99-105` idiom); one control asserted enabled again on `substrate: null`.
- [ ] **Step 2: RED. Step 3: implement. Step 4: GREEN** (+ full pwa suite).
- [ ] **Step 5: Mutation:** one gate dropped (Restart) → its test red — measure each control's test actually kills its own gate, not a neighbour's.
- [ ] **Step 6: Commit** `feat(pwa): destructive affordances refuse a session nobody can see (D-B8-14)`.

---

### Task 9: One fault, one banner (pwa)

**Files:**
- Create: `pwa/src/fleet/SubstrateBanner.tsx`
- Modify: `pwa/src/screens/FleetScreen.tsx` (mount beside `<FleetHostBanner />` `:244`), `pwa/src/fleet/fleet.css`
- Test: `pwa/test/substrate-banner.test.tsx` (create)

**Interfaces:**
- Consumes: the fleet store rows via an injectable `store = useFleetStore` prop — the `CoordBanner` pattern (`CoordBanner.tsx:57-163`), NOT FleetHostBanner's health poll (the banner is derived from rows, never its own wire fact — spec §4).
- Produces: banner iff `running = sessions.filter(s => (s.lifecycle ?? null) === 'running')` is non-empty AND every member has `substrateFault(s) !== null`; body: `tmux unreachable on the fleet host — N sessions report it; sessions are still running unattached. Remedy: restart tmux or reboot.` with the most-common fault text shown once. Amber (`--warn` register, `fleet.css:253-257`), no button (recovery is a human terminal action — spec §1 no-escalation).

- [ ] **Step 1: Failing tests** (CoordBanner harness idiom): all-running-faulted → banner once, naming the text; one running row unfaulted → NO banner (chips only); zero running rows → no banner; rows lacking the key → no throw.
- [ ] **Step 2: RED. Step 3: implement. Step 4: GREEN.**
- [ ] **Step 5: Mutation:** condition loosened to `some` → partial-case test red.
- [ ] **Step 6: Commit** `feat(pwa): one substrate fault is one banner, derived from the rows (D-B8-14)`.

---

### Task 10: The doctor learns to see the loaded gun (ccd, no marker re-stamp needed)

**Files:**
- Modify: `ccd/ccrc-doctor-checks` (table `:165-183`; new `_check_tmux_skew` beside `_check_tmux` `:386-390`)
- Test: `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Produces: table entry `tmux_skew`; `_check_tmux_skew`: client from `tmux -V`, server from `timeout "${CCRC_DOCTOR_GH_TIMEOUT}" tmux display-message -p '#{version}'` (this file's knobs ARE `: "${X:=N}"` env-overridable — the opposite of ccd, deliberately); PASS names both versions (a PASS must name a measurement); versions differ → WARN with remedy "a tmux upgrade landed under the running server — restart the tmux server at the next quiet moment or the next new client will be refused"; no server running → SKIP (nothing to skew against); tmux absent → SKIP (`_check_tmux` already FAILs).
- [ ] Steps: RED tests (the `ccrc-doctor.test.ts` per-check idiom; the MISSING/ORPHAN scan at `:604-618` enforces the table/function pairing; the healthy-box sweep at `:620-626` needs the check to SKIP cleanly with no server) → implement → GREEN → mutation (equal-versions forced → WARN test red) → commit `feat(doctor): tmux client/server skew check (D-B8-14)`.

---

### Task 11: Ledger, suites, review, ship

- [ ] **D-B8-14 ledger entry** in `docs/superpowers/plans/2026-08-15-fleet-robustness-build8.md`: what shipped, the mutation tables from every task, the loud-fallout counts (rewritten supervise-loop stubs, the PWA fixture wave), the `.substrate` field joining `_reg_purge`'s inventory.
- [ ] **Full suites, foreground:** server, agent, pwa (`./node_modules/.bin/vitest run` in each). Known load-flakes list applies; re-run in isolation before calling a break.
- [ ] **Adversarial review workflow** over the whole branch diff (the D-B8-13 review script shape: ≥4 lenses — bash correctness incl. `set -e`/subshell hazards in the new loop, wire/revive discipline, PWA a11y+gating completeness, test-integrity incl. "could the loop hang a suite") → fix confirmed findings.
- [ ] **PR** with evidence; verify CI `headSha` == PR head; merge.
- [ ] **Deploy AGENT-FIRST** (`CCRC_SSH_KEY=~/.ssh/<your-key> bash deploy/deploy.sh agent you@<fleet-host>`, then the server lane; `/health` sha gate; `fleet/health` agreed/agreed). The new supervise loop reaches each session only as its unit restarts — note in the PR that the fleet adopts it lazily; do NOT restart live units to force it.

## Deviations found

*(the global ledger entry, with the full mutation tables and the review findings, is D-B8-14 in
`2026-08-15-fleet-robustness-build8.md`.)*

- **D-B8-14.1** — Task 2's marker refreshed per tick as this plan specified; the branch review
  confirmed that shape destroys the onset epoch and the skew record. First write wins now
  (`_substrate_mark` early-returns on an existing file), and the task's pin was rewritten from
  "refresh, no second suffix" to byte-identical persistence under a moved clock.
- **D-B8-14.2** — `cmd_supervise` gained a PRE-FLIGHT probe this plan did not have: `cmd_ensure` is
  skipped when the substrate does not answer, because its spawn path (`tmux list-sessions` /
  `new-session`) carries no deadline and a supervisor (re)started mid-wedge hung before the loop
  could mark. Every supervise-loop test sequence carries one leading element for it.
- **D-B8-14.3** — Task 9's banner population (`lifecycle === 'running'`) was wrong on the wire:
  during the fault every faulted row classifies `restarting` (the server's own probes read
  unknown). The population is now watched = running OR restarting, and the fixtures are wire-true.
- **D-B8-14.4** — Task 8's inventory missed two doors: SessionHeader's Move (swap) item and
  PrSheet's Archive-now/Clean-up. Both gated with the same derived fault and named reason.
- **D-B8-14.5** — Task 10's fixture reached the HOST's tmux from the install suite's doctor tail;
  `healthyDoctorBox` now plants a 9.9/9.9 version stub and `tmux` joined `FIXTURE_BINS`.
- **D-B8-14.6** — line anchors in Tasks 2-4 had drifted by the time their implementers arrived
  (`_reg_claim` at ccd:382 not :357; the loop at ccd:8655 not :8613; six count-prose sites not
  five); the code was followed per the anchors-are-snapshots rule.
- **D-B8-14.7** — the plan's `seq`/stub sketches carried two bash syntax errors (unquoted
  space-bearing array elements; a function's closing brace followed by a word) and one
  wrong-shaped runner return (`r.status` vs the harness's `{code}`); fixed in place by the
  implementers, noted here because the plan is otherwise executable verbatim.
