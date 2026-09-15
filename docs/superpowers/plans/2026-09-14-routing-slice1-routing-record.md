# Routing slice 1 — the routing record: fields, settle, relaunch argv, subagent env, the `route` verb and its journal act — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every supervised session a routing record (class, effort, subagent class, workflow mode, compaction threshold, plus ccd's own `degraded` and `inert` stamps) that ccd validates by shape, applies at every settle, carries across resumes and account swaps, and that a coordinator or the server can write through one whitelisted verb — with no behaviour change for a session that has no record.

**Architecture:** Seven ordinary registry fields per session (`$REG/<id>.<field>`, `_reg_set`/`_reg_get`, purged with the row) read only through a validating reader whose failure direction is stated: an unrecognised value behaves as absent and leaves a journal note naming the field and the byte count, never the bytes. `_spawn_start` composes `--model`, the `--settings` JSON for ultracode/workflows and the `CLAUDE_CODE_SUBAGENT_MODEL` env once above both spawn lines, so a swap relaunch carries the record for free and a record-less session's argv stays byte-identical to today's. `_inject_spawn_effort` reads the record instead of the global `SPAWN_EFFORT` — on the lever the slice's own measurement picks. A new `ccd route --session <id> --set <field>=<value>` verb (no `--apply` in this slice) is the only writer besides ccd itself, journalled as a new `route` lifecycle act, advertised by a `route-v1` caps token, and granted to the agent as the two-token prefix `['route','--session']`.

**Tech Stack:** bash (`ccd/ccd`, `ccd/ccrc-doctor-checks`), TypeScript (`shared/api.ts`, `shared/generate.mjs`, `server/src/ccdargv.ts`, `agent/src/whitelist.ts`), vitest, Claude Code 2.1.270 (`--model`, `--settings`, `/effort`).

**Spec:** `docs/superpowers/specs/2026-09-14-effort-model-routing-design.md` — §5.1 (the record), §5.2 (levers), §5.3 (the verb, the audit trail, typers), §5.4 last paragraph (relaunch from the fields), §7 slice 1, §8 rows 1, 2, 4, 8, 9, 10, 14. Slice 0's plan (`2026-09-14-routing-slice0-measurement.md`) is independent; the two may land in either order.

## Global Constraints

- **No behaviour change without fields.** A session with no routing field at all gets today's behaviour: `SPAWN_EFFORT` typed at settle, no `--model`, no `--settings`, no subagent env; its spawn argv is byte-identical to the string `server/test/ccd-spawn-split.test.ts`'s `expectedCommand` pins. Spec §5.1 first condition.
- **Three conditions, three answers** (spec §5.1): no field at all → today's behaviour; a field absent while others exist → its `default` / `auto` / `off` / `COMPACT_THRESHOLD` meaning; an unrecognised value → as absent, plus a journal note naming the field and the rejected bytes' LENGTH, never the bytes. Nothing unrecognised reaches an argv or a keystroke.
- **Closed vocabularies**, verbatim from §5.1: `class` ∈ {fable, opus, sonnet, haiku, default}; `effort` ∈ {auto, low, medium, high, xhigh, max, ultracode}, refused with `class: haiku`; `subagent` ∈ the PROJECTED spelling of `shared/models.mjs`'s `SUBAGENT_CLASSES` (haiku, sonnet) — never a third hand-written copy (`single-definition.test.ts:1607` pins exactly two languages); `workflow` ∈ {on, off}, implied `on` by `effort: ultracode`; `compact` a percentage 10–100 or absent; `degraded` a class or absent; `inert` a comma list of FIELD NAMES (`effort`, `workflow`) or absent — never a value such as `ultracode`. `degraded` and `inert` are written by ccd only.
- **Never `CLAUDE_CODE_EFFORT_LEVEL`** in any spawn env composer (spec §5.2, §8). The only occurrence allowed in shipped bash is the doctor check that refuses it.
- **The coordinator never types into another session's pane** (coordinator clause 11, worker clause 13). This slice's verb has NO `--apply`: it writes fields; ccd applies them at the next settle. Slice 4 adds `--apply` for the server's picker path only.
- **`route` is a lifecycle act in EVERY vocabulary in ONE commit** (`shared/api.ts` `LifecycleAct` + `LIFECYCLE_ACT_MAP`, `ccd/ccd` `_LC_ACTS`, `pwa/src/session/journalWords.ts` `ACT_WORD` which is total over the union, `lifecycle-vocabulary.test.ts` count). `_lc_emit` rewrites an unlisted act to `unknown` — the suite is red in between. The row's who/what/from/to/why ride keys `_lc_json` ADMITS: `dec.actor`, `dec.reason` and `detail` — no new `dec.` key, because `ccd-lifecycle-contain.test.ts:260` pins the dec vocabulary at exactly four in both directions.
- **`route-v1` is a caps token** (`/^[a-z][a-z0-9-]*$/`), printed by `cmd_caps` as a bare `echo route-v1`, listed in `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS`, spelled once in `server/src` as `ROUTE_CAP`; the `route` verb is in `cmd_caps`'s heredoc so `verbSupported` sees it.
- **The grant is two tokens** `['route','--session']` with `REQUIRED_VERB_FLAG['route'] = '--session'`, for `coord-pause`'s reason; a one-token grant is a compile failure (`agent/test/types/bypasses/g11-…`).
- **`--model` on BOTH relaunch argvs**, computed once above them like `$rcflag` (`ccd/ccd:14722-14725`); the retry line is pinned on its own.
- **Measure before a lever ships.** Task 7's live probes decide whether `_inject_spawn_effort` may type a plain `/effort <level>` (Task 8 carries every branch) AND whether `ultracode`/`enableWorkflows` are `--settings` keys at all (ccd's own comment at `SPAWN_EFFORT` records that ultracode has no settings key) — so Task 6 composes `--model` and the subagent env only, and Task 8 composes exactly the `--settings` form Task 7 confirmed. Spec §5.2 "persistence hazard", §7 slice 1, §9.
- **AGENT-FIRST** for everything under `ccd/`; **FIXTURE HOMEs only** in tests; suites from inside the package, foreground, `timeout ≥ 600000`, never bare `npx vitest`; **D-numbers are issued** by the allocator, never looked up; **no account names** in shipped source (fixtures use `claude`, `zeta`, `gpt`).
- **Never touch the live fleet's tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units by hand.** Task 7's probes run on a PRIVATE tmux server (`tmux -L routeprobe`) against a scratch `CLAUDE_CONFIG_DIR`, never a lane's; credentials are sourced from `~/.cc-secrets/<lane>-oauth.env` with `set -a; . <file>; set +a` and are never printed.

---

## File structure

| File | Responsibility |
|---|---|
| `shared/generate.mjs` | projects `CCRC_SUBAGENT_CLASSES=(haiku sonnet)` into `~/.ccrc/accounts.sh` from `SUBAGENT_CLASSES` |
| `ccd/ccd` | `ROUTE_FIELDS` + vocabularies (`ROUTE_INERTABLE`), `_route_any`, `_route_valid`, `_route_get`, `_route_effort_for`, `_route_reject_note` (per-field floor), `_route_pair_note`; `_LC_ACTS` gains `route`; `cmd_route` + dispatcher arm + usage; `cmd_caps` gains `route` and `route-v1`; `_spawn_start` composes `launchflags`/`routeenv` (Task 6) and the measured `--settings` form (Task 8); `_inject_spawn_effort` reads the record |
| `shared/api.ts` | `LifecycleAct` gains `'route'` |
| `pwa/src/session/journalWords.ts` | `ACT_WORD.route` (the union is total there) |
| `server/src/ccdargv.ts` | `CCD_ARGV.route`, `ROUTE_CAP` |
| `agent/src/whitelist.ts` | grant `['route','--session']`, `REQUIRED_VERB_FLAG.route` |
| `agent/test/types/bypasses/g11-route-without-session.ts` | the compile-failure fixture |
| `ccd/ccrc-doctor-checks` | `_check_routing` + table entry |
| tests | `server/test/gen-accounts.test.ts`, `ccd-route-fields.test.ts` (new), `lifecycle-vocabulary.test.ts`, `pwa/test/journal-words.test.ts`, `ccd-route-verb.test.ts` (new), `ccd-archive.test.ts`, `caps-token-shape.test.ts`, `whitelist-subset.test.ts` (both maps), `agent/test/whitelist-structural.test.ts`, `ccd-route-spawn.test.ts` (new), `ccd-route-settle.test.ts` (new), `ccd-redrive.test.ts`, `ccrc-doctor.test.ts`, `routing-env-census.test.ts` (new) |
| `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` | §6 rows for Task 7's measurements |

---

### Task 1: Project the subagent class list into `accounts.sh`

**Files:**
- Modify: `shared/generate.mjs` (`generateAccountsSh`, the template at lines 264-296)
- Test: `server/test/gen-accounts.test.ts`

**Interfaces:**
- Consumes: `SUBAGENT_CLASSES` (`shared/models.mjs:70`, `Object.freeze(['haiku', 'sonnet'])`), `idArray` (already in `generate.mjs`).
- Produces: one more line in every generated `~/.ccrc/accounts.sh`: `CCRC_SUBAGENT_CLASSES=(haiku sonnet)`, directly after `CCRC_ANTHROPIC_BACKEND=…`. ccd reads it as a bash array (Task 2).

- [ ] **Step 1: Write the failing test**

In `server/test/gen-accounts.test.ts`, inside the describe that holds `'the two shipped rosters still project exactly as they did'` (line 600), add:

```ts
  it('projects SUBAGENT_CLASSES as CCRC_SUBAGENT_CLASSES — derived, not respelled (routing slice 1)', () => {
    const sh = generateAccountsSh(parseRoster(DEFAULT_TEST_ROSTER));
    expect(sh).toContain(`CCRC_SUBAGENT_CLASSES=(${SUBAGENT_CLASSES.join(' ')})`);
    expect(sh).toContain('CCRC_SUBAGENT_CLASSES=(haiku sonnet)');
    // ordered directly after the backend array, where ccd's header comment says the roster's arrays live
    expect(sh.indexOf('CCRC_SUBAGENT_CLASSES=')).toBeGreaterThan(sh.indexOf('CCRC_ANTHROPIC_BACKEND='));
  });
```

Add `import { SUBAGENT_CLASSES } from '../../shared/models.mjs';` beside the file's existing imports (it already imports `generateAccountsSh` and `parseRoster`).

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts`
Expected: FAIL — the projection has no `CCRC_SUBAGENT_CLASSES` line.

- [ ] **Step 3: Implement**

In `shared/generate.mjs`, at the top of the file add:

```js
import { SUBAGENT_CLASSES } from './models.mjs';
```

and amend the file's header comment (its lines 13-14 say the file imports nothing because there is no build step): it now imports ONE sibling under `shared/*.mjs`, and the constraint that survives is "no dependency outside `shared/*.mjs`, because `deploy/gen-accounts.mjs` runs it with a bare `node` from the checkout". A header that contradicts the first line of code below it is the kind of comment this repo treats as a request, not a fact.

In the template returned by `generateAccountsSh`, after the line `CCRC_ANTHROPIC_BACKEND=${idArray(anthropicIds)}` add:

```js
CCRC_SUBAGENT_CLASSES=${idArray(SUBAGENT_CLASSES)}
```

with this comment directly above the template's `return`:

```js
  // `CCRC_SUBAGENT_CLASSES` — the two classes a session's `subagent` routing
  // field may name (routing spec 2026-09-14 §5.1), PROJECTED from
  // `shared/models.mjs`'s `SUBAGENT_CLASSES` so ccd validates against the one
  // definition instead of holding a third spelling (`single-definition.test.ts`
  // pins exactly two: the node list and ccrc's usage-text copy).
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts test/single-definition.test.ts test/roster-generate.test.ts`
Expected: PASS. If `single-definition.test.ts`'s enumeration scan reds on the new line, read its message: it must accept a DERIVED spelling (`idArray(SUBAGENT_CLASSES)` is not a literal list); do not add a literal.

- [ ] **Step 5: Commit**

```bash
git add shared/generate.mjs server/test/gen-accounts.test.ts
git commit -m "feat(roster): project CCRC_SUBAGENT_CLASSES into accounts.sh (routing slice 1, Task 1)"
```

---

### Task 2: The routing fields and their validating reader

**Files:**
- Modify: `ccd/ccd` — new block directly below `COMPACT_LANDING_WALL` (`ccd/ccd:1006-1038` region) for the constants; new functions beside `_compact_note` (`ccd/ccd:14063`)
- Test: `server/test/ccd-route-fields.test.ts` (new)

**Interfaces:**
- Consumes: `_reg_get`/`_reg_set` (`ccd/ccd:1915, 1994`), `$REG`, `CCRC_SUBAGENT_CLASSES` from `accounts.sh` (Task 1), `swap.log`.
- Produces (bash):
  - `ROUTE_FIELDS=(class effort subagent workflow compact degraded inert)`, `ROUTE_CLASSES`, `ROUTE_EFFORTS`, `ROUTE_WORKFLOWS`, `ROUTE_NOTE_FLOOR=1800`
  - `_route_any <id>` → 0 iff any routing field file exists
  - `_route_valid <field> <value>` → 0 iff `value` is in `field`'s vocabulary
  - `_route_get <id> <field>` → stdout the validated value or nothing; always 0; an invalid value is noted
  - `_route_effort_for <id> <class>` → stdout the effort to apply; empty for `class: haiku` (noted as a PAIR refusal, not as an unrecognised value)
  - `_route_reject_note <id> <field> <len>` → one `swap.log` line `route-reject <id>: field <f> holds an unrecognised value (<len> bytes) — treated as absent`, floored PER FIELD through the registry field `routenote<field>` (dotless, so `_reg_purge` reaps it)
  - `_route_pair_note <id>` → one `swap.log` line `route-refuse <id>: class haiku takes no effort level — the effort field is ignored`, floored through `routenotepair`

- [ ] **Step 1: Write the failing test**

```ts
// server/test/ccd-route-fields.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-fields-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-a';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`); };
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const get = (field: string): string => h.sh(`_route_get ${ID} ${field}; echo "|rc=$?"`);

describe('the routing record (routing spec 2026-09-14 §5.1)', () => {
  it('_route_any: no field → 1; any one field → 0', () => {
    seed();
    expect(h.sh(`_route_any ${ID} && echo yes || echo no`)).toBe('no');
    h.sh(`_reg_set ${ID} compact 40`);
    expect(h.sh(`_route_any ${ID} && echo yes || echo no`)).toBe('yes');
  });

  it('_route_get: absent → empty, rc 0; a vocabulary value → itself', () => {
    seed();
    expect(get('class')).toBe('|rc=0');
    h.sh(`_reg_set ${ID} class opus`);
    expect(get('class')).toBe('opus|rc=0');
  });

  it.each([
    ['class', 'fable', true], ['class', 'default', true], ['class', 'gemini', false], ['class', 'Opus', false],
    ['effort', 'ultracode', true], ['effort', 'auto', true], ['effort', 'max', true], ['effort', 'extreme', false],
    ['subagent', 'haiku', true], ['subagent', 'sonnet', true], ['subagent', 'opus', false], ['subagent', 'fable', false],
    ['workflow', 'on', true], ['workflow', 'off', true], ['workflow', 'yes', false],
    ['compact', '10', true], ['compact', '50', true], ['compact', '100', true], ['compact', '9', false], ['compact', '101', false], ['compact', '50%', false],
    ['degraded', 'opus', true], ['degraded', 'default', false],
    ['inert', 'effort,workflow', true], ['inert', 'effort', true], ['inert', 'ultracode', false], ['inert', 'effort workflow', false],
    ['colour', 'blue', false],
  ])('_route_valid %s=%s → %s', (field, value, ok) => {
    expect(h.sh(`_route_valid ${field} '${value}' && echo yes || echo no`)).toBe(ok ? 'yes' : 'no');
  });

  it('the closed-vocabulary table has a mechanism: an unknown field is refused by the default arm', () => {
    // the control for the table above — if `_route_valid`'s `*)` arm ever returned 0, every "false" row would still be red here
    expect(h.sh(`_route_valid nosuchfield anything && echo yes || echo no`)).toBe('no');
  });

  it('an unrecognised value reads as ABSENT and leaves a note naming the field and the byte count, never the bytes', () => {
    seed();
    h.sh(`_reg_set ${ID} class 'gemini'`);
    expect(get('class')).toBe('|rc=0');
    const log = swapLog();
    expect(log).toMatch(/route-reject demo-a: field class holds an unrecognised value \(6 bytes\) — treated as absent/);
    expect(log).not.toContain('gemini');
  });

  it('the note is floored PER FIELD: two invalid fields read alternately write one line each per floor window', () => {
    seed();
    h.sh(`_reg_set ${ID} class gemini; _reg_set ${ID} effort extreme`);
    h.sh(`for i in 1 2 3; do _route_get ${ID} class; _route_get ${ID} effort; done`);
    expect(swapLog().match(/route-reject demo-a: field class/g)).toHaveLength(1);
    expect(swapLog().match(/route-reject demo-a: field effort/g)).toHaveLength(1);
    // the floor is time, not count: an old stamp lets that field speak again, and only that field
    h.sh(`_reg_set ${ID} routenoteclass 1; _route_get ${ID} class; _route_get ${ID} effort`);
    expect(swapLog().match(/route-reject demo-a: field class/g)).toHaveLength(2);
    expect(swapLog().match(/route-reject demo-a: field effort/g)).toHaveLength(1);
    // the floor markers are dotless registry fields, so _reg_purge reaps them with the row
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-a.routenoteclass'))).toBe(true);
    h.sh(`_reg_purge ${ID}`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', 'demo-a.routenoteclass'))).toBe(false);
  });

  it('subagent is validated against the PROJECTED list; a projection that predates it rejects every value', () => {
    seed();
    h.sh(`_reg_set ${ID} subagent sonnet`);
    expect(get('subagent')).toBe('sonnet|rc=0');
    const sh = path.join(h.home, '.ccrc', 'accounts.sh');
    fs.writeFileSync(sh, fs.readFileSync(sh, 'utf8').split('\n').filter((l) => !l.startsWith('CCRC_SUBAGENT_CLASSES=')).join('\n'));
    expect(get('subagent')).toBe('|rc=0');
    expect(swapLog()).toMatch(/route-reject demo-a: field subagent/);
  });

  it('_route_effort_for refuses the haiku+effort PAIR with its own note — the value was valid, the pair is not — and passes it on any other class', () => {
    seed();
    h.sh(`_reg_set ${ID} effort high`);
    expect(h.sh(`_route_effort_for ${ID} haiku; echo "|rc=$?"`)).toBe('|rc=0');
    expect(swapLog()).toMatch(/route-refuse demo-a: class haiku takes no effort level — the effort field is ignored/);
    expect(swapLog()).not.toMatch(/route-reject demo-a: field effort/);
    h.sh(`_route_effort_for ${ID} haiku`);
    expect(swapLog().match(/route-refuse demo-a/g)).toHaveLength(1);   // floored through routenotepair
    expect(h.sh(`_route_effort_for ${ID} opus`)).toBe('high');
    expect(h.sh(`_route_effort_for ${ID} ''`)).toBe('high');
  });

  it('ROUTE_FIELDS is the seven-field record, in the spec\'s order', () => {
    expect(h.sh('printf "%s " "${ROUTE_FIELDS[@]}"').trim()).toBe('class effort subagent workflow compact degraded inert');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-fields.test.ts`
Expected: FAIL — `_route_any: command not found`.

- [ ] **Step 3: Implement**

In `ccd/ccd`, after `COMPACT_LANDING_WALL=…` (line 1009 region) add:

```bash
# ── The routing record (routing spec 2026-09-14 §5.1) ───────────────────────
# Seven ordinary registry fields per session, written by `cmd_route` and by ccd
# itself (`degraded`, `inert`), read ONLY through `_route_get` below. The fields
# are a byte channel into an argv and a pane — any session on the box can write
# them (one UNIX user; attribution, not authentication) — so every value is
# validated BY SHAPE at the read, against these closed vocabularies, and the
# failure direction is stated: an unrecognised value behaves as ABSENT and
# leaves a `swap.log` note naming the field and the byte COUNT, never the bytes.
# `subagent` has no list here on purpose: it is validated against
# `CCRC_SUBAGENT_CLASSES`, the roster projection of `shared/models.mjs`'s
# `SUBAGENT_CLASSES`, so this file never holds a third spelling of that list.
# `inert` is a comma list of FIELD NAMES a lane could not apply (`effort`,
# `workflow`), never a value.
ROUTE_FIELDS=(class effort subagent workflow compact degraded inert)
ROUTE_CLASSES="fable opus sonnet haiku default"
ROUTE_EFFORTS="auto low medium high xhigh max ultracode"
ROUTE_WORKFLOWS="on off"
ROUTE_INERTABLE="effort workflow"
ROUTE_NOTE_FLOOR=1800           # seconds between route-reject / route-refuse notes for one id+field
```

Beside `_compact_note` (directly above `_compact_note() {`, line 14063) add:

```bash
_route_word_in() {   # word list — 0 iff word is one of the space-separated list
  local w="$1" x
  for x in $2; do [[ "$x" == "$w" ]] && return 0; done
  return 1
}
_route_any() {   # id — 0 iff ANY routing field file exists (spec §5.1: a session with
  # no field at all is a pre-slice-1 session and gets today's behaviour).
  local f
  for f in "${ROUTE_FIELDS[@]}"; do [[ -e "$REG/$1.$f" ]] && return 0; done
  return 1
}
_route_valid() {   # field value — 0 iff value is in the field's closed vocabulary
  local f="$1" v="$2" x
  case "$f" in
    class)    _route_word_in "$v" "$ROUTE_CLASSES" ;;
    effort)   _route_word_in "$v" "$ROUTE_EFFORTS" ;;
    subagent) declare -p CCRC_SUBAGENT_CLASSES >/dev/null 2>&1 \
                && _route_word_in "$v" "${CCRC_SUBAGENT_CLASSES[*]}" ;;
    workflow) _route_word_in "$v" "$ROUTE_WORKFLOWS" ;;
    compact)  [[ "$v" =~ ^[0-9]{2,3}$ ]] && (( 10#$v >= 10 && 10#$v <= 100 )) ;;
    degraded) _route_word_in "$v" "fable opus sonnet haiku" ;;
    inert)    [[ "$v" =~ ^[a-z]+(,[a-z]+)*$ ]] || return 1
              for x in ${v//,/ }; do _route_word_in "$x" "$ROUTE_INERTABLE" || return 1; done ;;
    *)        return 1 ;;
  esac
}
_route_note_floored() {   # id marker — 0 iff a note under this marker was written inside the floor
  local id="$1" m="$2" now nts
  now=$(date +%s)
  nts=$(_reg_get "$id" "$m" 2>/dev/null)
  [[ "$nts" =~ ^[0-9]+$ && $((now - nts)) -lt "$ROUTE_NOTE_FLOOR" ]] && return 0
  _reg_set "$id" "$m" "$now"
  return 1
}
_route_reject_note() {   # id field len — journal an unrecognised value: the FIELD and the
  # byte COUNT, never the bytes (they are the untrusted input). Floored PER FIELD
  # through `routenote<field>` (a dotless suffix, so `_reg_purge` reaps it): two
  # invalid fields read alternately each get their own line per window, which
  # a single shared marker would flap on (the `_compact_note` reason-change
  # shape ccd measured and removed).
  local id="$1" f="$2" len="$3"
  _route_note_floored "$id" "routenote$f" && return 0
  echo "$(date '+%F %T') route-reject $id: field $f holds an unrecognised value ($len bytes) — treated as absent" >> "$REG/swap.log"
  return 0
}
_route_pair_note() {   # id — the haiku+effort PAIR: both values are valid, the pairing is not
  _route_note_floored "$1" routenotepair && return 0
  echo "$(date '+%F %T') route-refuse $1: class haiku takes no effort level — the effort field is ignored" >> "$REG/swap.log"
  return 0
}
_route_get() {   # id field -> stdout the VALIDATED value, or nothing. Always 0.
  local id="$1" f="$2" v
  v=$(_reg_get "$id" "$f") || return 0
  if _route_valid "$f" "$v"; then printf '%s' "$v"; else _route_reject_note "$id" "$f" "${#v}"; fi
  return 0
}
_route_effort_for() {   # id class -> stdout the effort to apply. Haiku 4.5 takes no effort
  # level (the served catalogue gives it `thinking.type: none`), so the PAIR is
  # refused here with its own note and nothing is typed.
  local id="$1" cls="$2" e
  e=$(_route_get "$id" effort)
  if [[ "$cls" == haiku && -n "$e" ]]; then _route_pair_note "$id"; e=""; fi
  printf '%s' "$e"
  return 0
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-fields.test.ts`
Expected: PASS.

- [ ] **Step 5: Measure the mutation rows — each named with what it reds**

1. Replace the body of `_route_get` with `printf '%s' "$(_reg_get "$1" "$2")"` (delete the validator): the "unrecognised value reads as ABSENT" test and the "subagent … projection that predates it" test must FAIL (the `_route_valid` table does NOT go through `_route_get` and stays green — that is expected). Restore.
2. Make `_route_valid`'s `*)` arm `return 0`: the "closed-vocabulary table has a mechanism" control and the `colour=blue` row must FAIL. Restore.
3. Widen `subagent)` to `_route_word_in "$v" "haiku sonnet opus fable"`: the `subagent=opus → false` and `subagent=fable → false` rows must FAIL. Restore.

Record all three in the commit body.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-route-fields.test.ts
git commit -m "feat(ccd): the routing record — seven fields, shape validation, per-field noted rejection (routing slice 1, Task 2)"
```

---

### Task 3: `route` becomes a lifecycle act — every vocabulary, one commit

**Files:**
- Modify: `shared/api.ts:5478-5531` (`LifecycleAct`, `LIFECYCLE_ACT_MAP`)
- Modify: `ccd/ccd:2559-2561` (`_LC_ACTS`)
- Modify: `pwa/src/session/journalWords.ts:27` (`ACT_WORD: Record<LifecycleAct, string>` — TOTAL over the union, so the PWA stops compiling without a cell)
- Test: `server/test/lifecycle-vocabulary.test.ts:149` (`toBe(22)` → `toBe(23)`), `pwa/test/journal-words.test.ts`

**Interfaces:**
- Produces: `'route'` in `LifecycleAct` and `LIFECYCLE_ACTS`; `route` in `_LC_ACTS`; `ACT_WORD.route`; a `route` row is admissible through `_lc_done route <id> "" dec.actor … dec.reason … detail "<field>: <from> -> <to>"`. The who/what/from/to/why the spec asks for ride the keys `_lc_json` ADMITS (`ccd/ccd:3057-3072`): `dec.actor` and `dec.reason` are two of the four declared `LifecycleDec` keys (`server/test/ccd-lifecycle-contain.test.ts:260` pins that count at exactly four, in both directions), so the field, from and to go in `detail`, a TOP key, as one rendered string. No new `dec.` key.

- [ ] **Step 1: Change the test's count**

In `server/test/lifecycle-vocabulary.test.ts:149` change `.toBe(22)` to `.toBe(23)` and extend its message: `'guards the guard: an empty want passes everything (23 = 22 + route, routing slice 1)'`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts`
Expected: FAIL on the count (22 ≠ 23).

- [ ] **Step 3: Add the act on every side**

`shared/api.ts`, in the `LifecycleAct` union after the `'spawn'` member:

```ts
  | 'route'         // a routing field written (routing spec 2026-09-14 §5.3):
                    // `cmd_route` is the one emitter; dec.actor / dec.reason
                    // carry who and why, `detail` carries "<field>: <from> ->
                    // <to>" (no new dec key — the dec vocabulary is pinned at
                    // four). Additive on the wire, as every act is.
```

and in `LIFECYCLE_ACT_MAP` add `route: true,` after `spawn: true,`.

`ccd/ccd:2559-2561`:

```bash
_LC_ACTS=(archive attic-drop claim create destroy enable ensure forget gc
          hold purge reap rehome release rename restore route spawn start stop
          supervise swap unsupervise)
```

`pwa/src/session/journalWords.ts:27-33`, in `ACT_WORD` beside `spawn: 'respawned'`: `route: 'routing written',`.

- [ ] **Step 4: Run the tests to verify they pass — three packages**

Run: `cd server && ./node_modules/.bin/vitest run test/lifecycle-vocabulary.test.ts test/lifecycle-wire.test.ts test/ccd-lifecycle-contain.test.ts` and `cd pwa && ./node_modules/.bin/vitest run test/journal-words.test.ts && npm run build`
Expected: PASS. If `lifecycle-wire.test.ts` or `journalparse.ts` carries its own act list, the failure names it — add `route` there in this same commit.

- [ ] **Step 5: Commit — one commit, every side**

```bash
git add shared/api.ts ccd/ccd pwa/src/session/journalWords.ts server/test/lifecycle-vocabulary.test.ts
git commit -m "feat(lifecycle): route is an act in every vocabulary — shared, ccd, pwa (routing slice 1, Task 3)"
```

---

### Task 4: The `route` verb, its dispatcher arm and its caps

**Files:**
- Modify: `ccd/ccd` — `cmd_route` beside `cmd_project_pool` (`ccd/ccd:6480`), dispatcher arm and usage string (`ccd/ccd:17524-17558`), `cmd_caps` (`ccd/ccd:5927-6076`: `route` in the heredoc after `project-pool`; `echo route-v1` after `echo pools-v1`)
- Test: `server/test/ccd-route-verb.test.ts` (new); `server/test/ccd-archive.test.ts:154` (`KNOWN_CAPABILITY_TOKENS`); `server/test/caps-token-shape.test.ts`

**Interfaces:**
- Consumes: Task 2's reader and vocabularies, `_lc_done` (Task 3's act), `_reg_set`.
- Produces: `ccd route --session <id> --set <field>=<value> [--set …]… [--actor <text>] [--reason <text>]` → stdout one `set <id> <field>=<value>` line per field; exit 1 with a `die` message and NO write on any bad argument; per field written, one `swap.log` line and one `route` journal row. `ccd caps` prints `route` (verb) and `route-v1` (token). The PREVIOUS value is read through `_route_get` (validated): an unrecognised old value is rendered as `<N bytes>`, never its bytes, in both the log line and the journal — any session on the box can write the file, and a multi-line value would otherwise forge log lines.

- [ ] **Step 1: Write the failing tests**

`die` is `exit 1`, which ends the shell `h.sh` sources ccd into, so a refusal can only be observed through a runner that catches the non-zero exit — `ccd-spawn-split.test.ts:31-42`'s `shStatus` shape, copied here verbatim:

```ts
// server/test/ccd-route-verb.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-verb-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh` throws on a non-zero exit, and `cmd_route` refuses through `die`
 *  (exit 1), so refusals are observed through this runner — the
 *  `ccd-spawn-split.test.ts` `shStatus` shape. `exec 2>&1` merges stderr into
 *  the captured text; no `$( )` or `( )` around the snippet, which would
 *  demote the fatal and make the assertion pass either way. */
const shStatus = (snippet: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }, { systemd: true, tmux: true }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

const ID = 'demo-a';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`); };
const route = (args: string): { status: number; out: string } => shStatus(`cmd_route ${args}`);
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

describe('ccd route (routing spec 2026-09-14 §5.3)', () => {
  it('writes one field and says so', () => {
    seed();
    expect(route(`--session ${ID} --set effort=high`)).toEqual({ status: 0, out: `set ${ID} effort=high\n` });
    expect(h.reg(ID, 'effort')).toBe('high');
    expect(swapLog()).toMatch(/route demo-a: effort ∅ -> high/);
  });

  it('writes several fields in one call, recording from and to, actor and reason', () => {
    seed(); h.sh(`_reg_set ${ID} class opus`);
    const r = route(`--session ${ID} --set class=sonnet --set subagent=haiku --actor coordinator:demo-c --reason 'wave 2 is bulk'`);
    expect(r).toEqual({ status: 0, out: `set ${ID} class=sonnet\nset ${ID} subagent=haiku\n` });
    expect(h.reg(ID, 'class')).toBe('sonnet');
    expect(h.reg(ID, 'subagent')).toBe('haiku');
    expect(swapLog()).toMatch(/route demo-a: class opus -> sonnet \[actor=coordinator:demo-c\] \(wave 2 is bulk\)/);
  });

  it('an unrecognised PREVIOUS value is rendered as a byte count, never its bytes (the log is not a channel)', () => {
    seed(); h.sh(`printf '%s' 'gemini\nfake route-reject line' > "$HOME/.cc-sessions/${ID}.class"`);
    expect(route(`--session ${ID} --set class=opus`).status).toBe(0);
    const log = swapLog();
    expect(log).toMatch(/route demo-a: class <29 bytes, unrecognised> -> opus/);
    expect(log).not.toContain('gemini');
    expect(log).not.toContain('fake route-reject');
  });

  it.each([
    ['a value outside the vocabulary', `--session ${ID} --set class=gemini`, /bad value for class \(6 bytes\)/],
    ['an unknown field', `--session ${ID} --set colour=blue`, /unknown routing field 'colour'/],
    ['a ccd-only field', `--session ${ID} --set degraded=opus`, /'degraded' is written by ccd only/],
    ['a --set with no =', `--session ${ID} --set effort`, /bad --set 'effort'/],
    ['no --set at all', `--session ${ID}`, /usage: ccd route/],
    ['no such session', `--session nobody --set effort=high`, /no such session: nobody/],
    ['a bad session id', `--session 'a b' --set effort=high`, /bad session id/],
    ['--apply, which this slice does not have', `--session ${ID} --set effort=high --apply`, /usage: ccd route/],
  ])('%s: refuses with rc 1 and writes NOTHING', (_l, args, msg) => {
    seed();
    const r = route(args);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(msg);
    for (const f of ['class', 'effort', 'subagent', 'degraded', 'colour']) expect(h.reg(ID, f)).toBeNull();
  });

  it('refuses the haiku+effort PAIR whether it arrives in one call or across two, and the earlier field stays', () => {
    seed();
    let r = route(`--session ${ID} --set class=haiku --set effort=high`);
    expect(r.status).toBe(1); expect(r.out).toMatch(/class haiku takes no effort level/);
    expect(h.reg(ID, 'class')).toBeNull();
    expect(route(`--session ${ID} --set class=haiku`).status).toBe(0);
    r = route(`--session ${ID} --set effort=high`);
    expect(r.status).toBe(1); expect(r.out).toMatch(/class haiku takes no effort level/);
    expect(h.reg(ID, 'effort')).toBeNull();
    expect(h.reg(ID, 'class')).toBe('haiku');
  });

  it('a multi-field call is all-or-nothing on validation: one bad value and no field is written', () => {
    seed();
    expect(route(`--session ${ID} --set class=opus --set effort=extreme`).status).toBe(1);
    expect(h.reg(ID, 'class')).toBeNull();
  });

  it('the dispatcher reaches it, and caps advertise the verb and the token', () => {
    seed();
    const r = shStatus(`bash "${CCD}" route --session ${ID} --set workflow=on`);
    expect(r).toEqual({ status: 0, out: `set ${ID} workflow=on\n` });
    expect(h.reg(ID, 'workflow')).toBe('on');
    const caps = h.sh('cmd_caps').split('\n');
    expect(caps).toContain('route');
    expect(caps).toContain('route-v1');
  });
});
```

In `server/test/ccd-archive.test.ts:154` change the list to
`['account-v1', 'actor-flags-v1', 'lifecycle-v1', 'pools-v1', 'route-v1', 'stop-surface']` and add `expect(KNOWN_CAPABILITY_TOKENS).toContain(ROUTE_CAP);` beside the `POOLS_CAP` line (import `ROUTE_CAP` from `../src/ccdargv.js` — Task 5 defines it; land this one assertion in Task 5's commit if Task 4 runs first).

In `server/test/caps-token-shape.test.ts`, the test `'keeps the two versioned capability tokens by name'` becomes three: `parseCcdCaps('lifecycle-v1\nactor-flags-v1\nroute-v1\nstop-surface\n')` → `['lifecycle-v1', 'actor-flags-v1', 'route-v1', 'stop-surface']`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-verb.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts`
Expected: FAIL — `cmd_route: command not found` (status 127 in the runner); caps parity reds on the missing verb/token.

- [ ] **Step 3: Implement the verb**

In `ccd/ccd`, directly above `cmd_project_pool() {` (line 6480):

```bash
cmd_route() {   # ccd route --session <id> --set <field>=<value> [--set ...] [--actor <text>] [--reason <text>]
  # Routing spec 2026-09-14 §5.3. WRITES THE RECORD, NEVER A KEYSTROKE: this
  # slice has no --apply (slice 4 adds it for the server's picker path only),
  # so a coordinator running this against a worker types nothing into that
  # worker's pane — ccd applies the fields at the next settle. Every value is
  # validated BEFORE anything is written, so a bad call is a `die` the caller
  # sees and an unchanged record, never a silently-absent field. The PREVIOUS
  # value is read VALIDATED: an unrecognised one is rendered as a byte count in
  # the log and the journal, never its bytes — the file is writable by any
  # session on the box and a multi-line value would forge log lines.
  local usage="usage: ccd route --session <id> --set <field>=<value> [--set <field>=<value>]... [--actor <text>] [--reason <text>]"
  local id="" actor="" reason="" kv f v cls eff old raw
  local -a sets=()
  while (( $# )); do
    case "$1" in
      --session) [[ $# -ge 2 ]] || die "$usage"; id="$2"; shift 2 ;;
      --set)     [[ $# -ge 2 ]] || die "$usage"; sets+=("$2"); shift 2 ;;
      --actor)   [[ $# -ge 2 ]] || die "$usage"; actor="$2"; shift 2 ;;
      --reason)  [[ $# -ge 2 ]] || die "$usage"; reason="$2"; shift 2 ;;
      *)         die "$usage" ;;
    esac
  done
  [[ -n "$id" && ${#sets[@]} -gt 0 ]] || die "$usage"
  [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
  [[ -f "$REG/$id.uuid" ]] || die "no such session: $id"
  for kv in "${sets[@]}"; do
    [[ "$kv" == *=* ]] || die "bad --set '$kv' (want <field>=<value>)"
    f="${kv%%=*}"; v="${kv#*=}"
    _route_word_in "$f" "${ROUTE_FIELDS[*]}" || die "unknown routing field '$f' (want one of: ${ROUTE_FIELDS[*]})"
    [[ "$f" == degraded || "$f" == inert ]] && die "'$f' is written by ccd only"
    _route_valid "$f" "$v" || die "bad value for $f (${#v} bytes) — not in its vocabulary"
  done
  # Haiku takes no effort level: the PAIR is refused whether it arrives in one
  # call or across two (the record on disk is half of the pair).
  cls=$(_route_get "$id" class); eff=$(_route_get "$id" effort)
  for kv in "${sets[@]}"; do
    f="${kv%%=*}"; v="${kv#*=}"
    [[ "$f" == class ]] && cls="$v"
    [[ "$f" == effort ]] && eff="$v"
  done
  [[ "$cls" == haiku && -n "$eff" ]] && die "class haiku takes no effort level — clear effort or pick another class"
  for kv in "${sets[@]}"; do
    f="${kv%%=*}"; v="${kv#*=}"
    raw=$(_reg_get "$id" "$f" 2>/dev/null) || raw=""
    old=$(_route_get "$id" "$f")
    if [[ -n "$raw" && -z "$old" ]]; then old="<${#raw} bytes, unrecognised>"; fi
    _reg_set "$id" "$f" "$v" || die "could not write $f for $id — the record is unchanged from this field on"
    _lc_done route "$id" "" dec.actor "$actor" dec.reason "$reason" detail "$f: ${old:-∅} -> $v"
    echo "$(date '+%F %T') route $id: $f ${old:-∅} -> $v${actor:+ [actor=$actor]}${reason:+ ($reason)}" >> "$REG/swap.log"
    echo "set $id $f=$v"
  done
}
```

Dispatcher (`ccd/ccd:17524-17558`): add `  route)       shift; cmd_route "$@" ;;` directly after the `project-pool)` arm, and add `route` to the `usage: ccd {…}` string in the `*)` arm between `project-pool` and `pr-open`.

`cmd_caps`: add a `route` line to the heredoc directly after `project-pool`; after `echo pools-v1` add:

```bash
  # route-v1 — this ccd implements `ccd route --session <id> --set <field>=<value>`
  # and reads the routing record at every settle (routing spec 2026-09-14
  # §5.3). A server that sees this token may write routing fields through the
  # verb; a server that does not sees no route verb and passes nothing.
  echo route-v1
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-verb.test.ts test/ccd-archive.test.ts test/caps-token-shape.test.ts test/ccd-route-fields.test.ts test/ccd-lifecycle-contain.test.ts`
Expected: PASS — `ccd-lifecycle-contain` included, because the row uses only declared dec keys.

- [ ] **Step 5: Measure the mutation**

Delete the `_route_valid "$f" "$v" || die …` line: the "value outside the vocabulary" row must FAIL. Restore. Add `--apply) shift ;;` to the option loop: the "--apply, which this slice does not have" row must FAIL. Restore. Replace `old=$(_route_get "$id" "$f")` with `old="$raw"`: the "unrecognised PREVIOUS value" test must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-route-verb.test.ts server/test/ccd-archive.test.ts server/test/caps-token-shape.test.ts
git commit -m "feat(ccd): route verb, dispatcher arm, route/route-v1 caps (routing slice 1, Task 4)"
```

---

### Task 5: The argv builder, the capability constant and the agent grant

**Files:**
- Modify: `server/src/ccdargv.ts` — `CCD_ARGV.route`, `ROUTE_CAP` beside `POOLS_CAP` (line 396)
- Modify: `agent/src/whitelist.ts` — `REQUIRED_VERB_FLAG` (line 252), the `ccd` grant list (after `['project-pool', '--project']`, line 397)
- Create: `agent/test/types/bypasses/g11-route-without-session.ts`
- Test: `server/test/whitelist-subset.test.ts` (BOTH maps: `SAMPLES` at lines 55-75 AND layer 4's `EXPECTED: Record<keyof typeof CCD_ARGV, string[]>` at line 325 — the second is total over `CCD_ARGV`, so a new entry is a TS2741 there until listed), `agent/test/whitelist-structural.test.ts` (`EXPECTED`, line 81), `server/test/ccd-archive.test.ts` (from Task 4)

**Interfaces:**
- Produces: `CCD_ARGV.route(id: string, field: string, value: string): CcdArgv` → `['route', '--session', id, '--set', \`${field}=${value}\`]`; `export const ROUTE_CAP = 'route-v1'`; `EXEC_WHITELIST.ccd` gains `['route', '--session']`; `REQUIRED_VERB_FLAG` gains `'route': '--session'`.

- [ ] **Step 1: Write the failing tests**

`server/test/whitelist-subset.test.ts`, in `SAMPLES` after `projectPoolClear: ['demo'],`:

```ts
  // Routing slice 1: the record's one writer besides ccd. The sample carries
  // a real field=value so layer 2 proves the flagged shape is reachable under
  // the granted `['route','--session']` prefix.
  route: ['demo-quiet-basin', 'effort', 'high'],
```

and in layer 4's `EXPECTED` (line 325) after `projectPoolClear: ['project-pool', '--project', 'demo', '--clear'],`:

```ts
    route: ['route', '--session', 'demo-quiet-basin', '--set', 'effort=high'],
```

`agent/test/whitelist-structural.test.ts`, in `EXPECTED` after the `g10` entry:

```ts
  // ROUTING slice 1, g10's shape one verb over: `['route','--session']` ->
  // `['route']` keeps the verb and drops the flag that is its whole argument
  // surface; the enrolment in `REQUIRED_VERB_FLAG` is what makes it TS2322.
  'g11-route-without-session.ts': {
    what: 'the routing verb granted without --session',
    codes: ['TS2322'],
  },
```

`agent/test/types/bypasses/g11-route-without-session.ts`:

```ts
// BYPASS FIXTURE — MUST NOT COMPILE.
//
// ROUTING slice 1: `['route', '--session']` -> `['route']`, a grant that keeps
// the verb and drops the flag that is its entire argument surface. g9 and g10's
// shape one verb over: `isExecAllowed` is PREFIX-matching, so `['route']`
// admits `ccd route --session <id> --set <anything>` exactly as the two-token
// grant does and every subset test stays green. What refuses is the ENROLMENT
// in `REQUIRED_VERB_FLAG`: a TS2322 on the proof line here, and a boot refusal
// at module load. The verb WRITES a session's routing record — a byte channel
// into that session's next spawn argv — from a route the PWA reaches with no
// token of any kind, which is why the grant is exactly as narrow as the flag.
import type { ExecWhitelist, LawfulGrants } from '../../../src/whitelist.js';

const table = {
  tmux: [['has-session']],
  ccd: [['start'], ['route']],
} as const satisfies ExecWhitelist;

export const proven: LawfulGrants<typeof table> = table;
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts` and `cd agent && ./node_modules/.bin/vitest run test/whitelist-structural.test.ts`
Expected: the subset suite FAILS twice — `has a sample for every CCD_ARGV entry` (a sample with no entry) and layer 4's `EXPECTED` no longer typechecks against `keyof typeof CCD_ARGV` until the entry exists; the structural suite FAILS because `g11` compiles cleanly (the verb is not yet enrolled).

- [ ] **Step 3: Implement**

`server/src/ccdargv.ts`, after `projectPoolClear`:

```ts
  /** The routing record's writer (routing spec 2026-09-14 §5.3). ONE field per
   *  argv: the route that will call it (slice 4's picker, the wave N≥2 dispatch)
   *  picks a field and a value, and `field`/`value` reach ccd UNVALIDATED —
   *  `_route_valid` on the box is the authority and refuses before writing.
   *  No `--apply` form exists in this slice: the coordinator never types into
   *  another session's pane, and the server's own apply path is slice 4's. */
  route: (id: string, field: string, value: string) =>
           argv(['route', '--session', id, '--set', `${field}=${value}`]),
```

After `POOLS_CAP`:

```ts
/** The `ccd caps` token that says this box implements `ccd route` and reads
 *  the routing record at settle (routing spec 2026-09-14 §5.3). Spelled ONCE
 *  in `server/src`, for `ACTOR_FLAGS_CAP`'s reason; ccd's `echo route-v1` and
 *  `ccd-archive.test.ts`'s `KNOWN_CAPABILITY_TOKENS` are the other two
 *  spellings, held equal by that test's `toContain` line. It gates ONE
 *  decision, in slice 4: whether dispatch may pass a wave's routing on the
 *  `ws-add` argv — absent, the flag is OMITTED, the actor-flags-v1 shape. */
export const ROUTE_CAP = 'route-v1';
```

`agent/src/whitelist.ts:252-256`:

```ts
export const REQUIRED_VERB_FLAG = {
  'ws-reap': '--expect', 'ws-rename': '--session', 'coord-pause': '--state',
  'project-pool': '--project', 'route': '--session',
} as const;
```

and in the `ccd` grant list after `['project-pool', '--project'],`:

```ts
    // The routing record's writer (routing spec 2026-09-14 §5.3), granted on
    // `coord-pause`'s terms: `$REG/<id>.<field>` writes, non-destructive,
    // nothing server-side can perform them (`FleetIO` writes only
    // `~/.cc-clips`). ENROLLED in `REQUIRED_VERB_FLAG` for the same reason —
    // prefix matching leaves the tail unconstrained, so an unenrolled
    // `['route']` would admit every positional form the verb might grow, from
    // a route with no token of any kind. No `--apply` token in this slice.
    ['route', '--session'],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/whitelist-subset.test.ts test/ccd-archive.test.ts` and `cd agent && npm run test`
Expected: PASS (the agent suite's module-load self-audit and the structural fixtures included).

- [ ] **Step 5: Commit**

```bash
git add server/src/ccdargv.ts agent/src/whitelist.ts agent/test/types/bypasses/g11-route-without-session.ts agent/test/whitelist-structural.test.ts server/test/whitelist-subset.test.ts server/test/ccd-archive.test.ts
git commit -m "feat(whitelist): route grant, REQUIRED_VERB_FLAG, CCD_ARGV.route, ROUTE_CAP (routing slice 1, Task 5)"
```

---

### Task 6: The relaunch argv carries the record — `--model` and the subagent env on both spawn lines, swap continuity, `inert`

**Files:**
- Modify: `ccd/ccd` — `_spawn_start` (`ccd/ccd:14666-14798`): compose `launchflags` and extend `resenv` after `resenv=$(_resume_env)` (line 14732); both `_tmux_new_session` lines (14739-14740, 14780-14781) use `$launchflags` where they use `$rcflag`
- Test: `server/test/ccd-route-spawn.test.ts` (new); `server/test/ccd-spawn-split.test.ts` and `server/test/ccd-rc-flag.test.ts` (must stay green byte-for-byte)

**Interfaces:**
- Consumes: Task 2's readers, `_is_anthropic_backend`, `_resume_env`, `$rcflag`.
- Produces: with a record, both spawn lines carry `--model <class>` (unless `default`) and, on an Anthropic lane, `CLAUDE_CODE_SUBAGENT_MODEL=<class>` inside the `env` assignments. NOT in this task: `--settings` for ultracode/workflows — ccd's own comment at `SPAWN_EFFORT` (`ccd/ccd:975-977`) records that ultracode has no settings key, and the spec makes slice 1 MEASURE whether `--settings` carries it before anything ships; Task 7's arm 3 measures, Task 8 composes what arm 3 confirms. On a non-Anthropic lane `--model` still passes (it maps through the lane's materialiser), no env is composed (the lane's `settings.json` materialiser owns the subagent there, spec §5.2 "Non-Anthropic lanes"), and the fields the lane cannot apply are stamped `inert` as FIELD NAMES: `effort` (any level — the settle's keystroke is gated to Anthropic lanes at `ccd/ccd:14872` and slice 4's tick is what will type it there; until then the field is unapplied and the record says so) and `workflow`. Without a record: today's argv, byte-identical.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/ccd-route-spawn.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-spawn-'); });
afterEach(() => { h.cleanup(); });

/** The substrate `ccd-spawn-split.test.ts` uses to make `_spawn_start` emit
 *  BOTH spawn lines: the `--resume` new-session leaves no pane, the
 *  `--session-id` retry does. */
const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const seed = (id: string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid ${UUID}`);
};
const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));
const composed = (line: string): string => {
  const m = /^tmux new-session -d -s \S+ -x \d+ -y \d+ (.*)$/.exec(line);
  expect(m, line).not.toBeNull();
  return m![1]!;
};
const spawnBoth = (id: string): string[] => {
  h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start ${id} resume 2>/dev/null`);
  const lines = newSessions();
  expect(lines).toHaveLength(2);
  return lines.map(composed);
};
/** Today's argv, spelled from ccd's own `_resume_env` (one definition, read twice —
 *  the `ccd-spawn-split.test.ts` rule). */
const today = (sidflag: string): string =>
  `cd '${h.home}' && exec env COLORTERM=truecolor ${h.sh('_resume_env')} '${h.home}/.local/bin/claude'  ${sidflag} --dangerously-skip-permissions`;

describe('_spawn_start carries the routing record (routing spec 2026-09-14 §5.2, §5.4)', () => {
  it('NO record: both lines are byte-identical to today\'s', () => {
    seed('myid');
    const [primary, retry] = spawnBoth('myid');
    expect(primary).toBe(today(`--resume '${UUID}'`));
    expect(retry).toBe(today(`--session-id '${UUID}'`));
  });

  it('class and subagent: --model and the env on BOTH lines, the retry pinned on its own; effort is not an argv matter here', () => {
    seed('myid');
    h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet`);
    const [primary, retry] = spawnBoth('myid');
    const env = h.sh('_resume_env');
    const expected = (sidflag: string): string =>
      `cd '${h.home}' && exec env COLORTERM=truecolor ${env} CLAUDE_CODE_SUBAGENT_MODEL=sonnet '${h.home}/.local/bin/claude' `
      + `--model opus ${sidflag} --dangerously-skip-permissions`;
    expect(primary).toBe(expected(`--resume '${UUID}'`));
    expect(retry).toBe(expected(`--session-id '${UUID}'`));
    expect(primary).not.toContain('--settings');   // Task 8's, after Task 7 measures the key
    expect(h.reg('myid', 'inert')).toBeNull();
  });

  it('class default passes no --model; an unrecognised class passes none and is noted', () => {
    seed('myid'); h.sh(`_reg_set myid class default; _reg_set myid subagent haiku`);
    const [a] = spawnBoth('myid');
    expect(a).not.toContain('--model');
    expect(a).toContain('CLAUDE_CODE_SUBAGENT_MODEL=haiku ');
    h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"; _reg_set myid class gemini`);
    const [b] = spawnBoth('myid');
    expect(b).not.toContain('--model');
    expect(fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8')).toMatch(/route-reject myid: field class/);
  });

  it('the effort override env is never composed, whatever the record says', () => {
    seed('myid'); h.sh(`_reg_set myid class opus; _reg_set myid effort max`);
    const [a] = spawnBoth('myid');
    expect(a).not.toMatch(/CLAUDE_CODE_EFFORT/);
    expect(a).not.toContain('--effort');
  });

  it('a swap landing (lastswap within 300s) carries every field — the continuity the operator ruled', () => {
    seed('myid');
    h.sh(`_reg_set myid class fable; _reg_set myid effort xhigh; _reg_set myid subagent sonnet; _reg_set myid workflow off
          _reg_set myid lastswap $(( $(date +%s) - 10 ))`);
    const [primary, retry] = spawnBoth('myid');
    for (const l of [primary, retry]) {
      expect(l).toContain('--model fable');
      expect(l).toContain('CLAUDE_CODE_SUBAGENT_MODEL=sonnet');
    }
    expect(h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null; echo "[$SPAWN_FROMSWAP]"`)).toBe('[1]');
  });

  it('a non-Anthropic lane: --model passes, no env, effort and workflow stamped inert, nothing else reaches the argv', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    seed('myid', 'gpt');
    h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode; _reg_set myid subagent sonnet`);
    const [primary] = spawnBoth('myid');
    expect(primary).toContain(`'${h.home}/.local/bin/gpt' --model opus --resume`);
    expect(primary).not.toContain('--settings');
    expect(primary).not.toContain('CLAUDE_CODE_SUBAGENT_MODEL');
    expect(h.reg('myid', 'inert')).toBe('effort,workflow');
  });

  it('a non-Anthropic lane with a plain effort and no workflow stamps inert=effort only', () => {
    seedAccountsSh(h.home, {
      version: 1, accounts: [
        { id: 'claude', label: 'a', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
        { id: 'gpt', label: 'g', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: true, hue: 'magenta', telemetry: 'none' },
      ],
    });
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\n', { mode: 0o755 });
    seed('myid', 'gpt'); h.sh(`_reg_set myid effort high`);
    spawnBoth('myid');
    expect(h.reg('myid', 'inert')).toBe('effort');
  });

  it('inert is CLEARED again on an Anthropic lane (a rehome back)', () => {
    seed('myid'); h.sh(`_reg_set myid inert effort,workflow; _reg_set myid effort ultracode`);
    spawnBoth('myid');
    expect(h.reg('myid', 'inert')).toBeNull();
  });
});
```

If the `gpt` roster entry needs an `exec.kind` the parser accepts differently (the statusline test's roster uses `{ kind: 'external' }`), copy that test's `gpt` entry verbatim.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-spawn.test.ts`
Expected: the "NO record" test and the "effort override env" test PASS already (they pin today); every other test FAILS.

- [ ] **Step 3: Implement**

In `_spawn_start`, replace the line `resenv=$(_resume_env)` (14732) with:

```bash
  resenv=$(_resume_env)
  # THE ROUTING RECORD (routing spec 2026-09-14 §5.2, §5.4 last paragraph):
  # `--model` from `class`, and the subagent floor into the SAME `env` line
  # `_resume_env` composes. Computed ONCE, here, above BOTH spawn lines —
  # exactly as `$rcflag` is, and for the same reason: the retry may not spawn a
  # differently-shaped pane than the attempt it replaces. EMPTY when the
  # session has no record, so a pre-slice-1 session's argv is byte-identical
  # to today's (`ccd-spawn-split.test.ts` pins that string;
  # `ccd-route-spawn.test.ts` pins this one). `default` passes no flag — the
  # lane's settings.json decides. Effort is NOT an argv matter here: the
  # settle types it (`_inject_spawn_effort`), and the one env variable that
  # would pin it is the override `_check_routing` refuses — never composed.
  # `--settings` for ultracode/workflows lands only once the slice's own
  # measurement has said the keys are honoured (see the settle function).
  local routeflags="" routeenv="" rclass rsub rwf reff inert=""
  if _route_any "$id"; then
    rclass=$(_route_get "$id" class); reff=$(_route_effort_for "$id" "$rclass")
    rsub=$(_route_get "$id" subagent); rwf=$(_route_get "$id" workflow)
    [[ "$reff" == ultracode ]] && rwf=on
    [[ -n "$rclass" && "$rclass" != default ]] && routeflags="--model $rclass"
    # BACKEND, not placement: the subagent env is Claude Code's own; on another
    # backend the lane's settings.json materialiser owns the subagent (spec
    # §5.2 "Non-Anthropic lanes"), the settle's keystroke is gated to Anthropic
    # lanes (`_spawn_settle`), and workflows have no switch — so on such a lane
    # `effort` and `workflow` are stamped INERT by field name, and the record
    # says what was not applied rather than pretending.
    if _is_anthropic_backend "$wrapper"; then
      [[ -n "$rsub" ]] && routeenv="CLAUDE_CODE_SUBAGENT_MODEL=$rsub"
    else
      [[ -n "$reff" ]] && inert="effort"
      [[ "$rwf" == on ]] && inert="${inert:+$inert,}workflow"
    fi
    if [[ -n "$inert" ]]; then _reg_set "$id" inert "$inert"; else rm -f -- "$REG/$id.inert"; fi
  fi
  resenv="$resenv${routeenv:+ $routeenv}"
  local launchflags="$rcflag${routeflags:+${rcflag:+ }$routeflags}"
```

Then in BOTH `_tmux_new_session` lines (14739-14740 and 14780-14781) replace `$rcflag` with `$launchflags`. Update the retry line's comment ("`$rcflag`, the SAME value…") to name `$launchflags` and say it carries `$rcflag` plus the record. Nothing else in the two lines changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-spawn.test.ts test/ccd-spawn-split.test.ts test/ccd-rc-flag.test.ts test/ccd-backend-vs-placement.test.ts test/ccd-session-state.test.ts`
Expected: PASS, `ccd-spawn-split`'s byte-exact `expectedCommand` included. (`ccd-session-state` is a known load flake; isolate before calling it real.)

- [ ] **Step 5: Measure the mutation rows**

Change the retry line back to `$rcflag`: the "BOTH lines … retry pinned on its own" test must FAIL on `retry`. Restore. Add `CLAUDE_CODE_EFFORT_LEVEL=$reff` to `routeenv` (in the shell only, never committed): the "effort override env is never composed" test must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-route-spawn.test.ts
git commit -m "feat(ccd): relaunch argv carries --model and the subagent env on both spawn lines; inert on other backends (routing slice 1, Task 6)"
```

---

### Task 7: The measurements — keystroke persistence for `/effort` AND `/model`, the session-only form, `--settings`, the pinned lanes, cache safety

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 — one row per question below
- Modify: this plan's `## Deviations found` — the decisions Task 8 branches on, as numbered entries
- No source changes.

**Interfaces:**
- Consumes: `~/.local/bin/claude` (2.1.270), one Anthropic lane's OAuth env file (`ls ~/.cc-secrets/` to find the name; never print it), scratch `CLAUDE_CONFIG_DIR`s under the session scratchpad, a PRIVATE tmux server (`tmux -L routeprobe`), and — for arm 4's second half only — READ-ONLY use of the two really-pinned lanes' config dirs.
- Produces: seven answers, each a research-note row with the exact procedure and the observed strings:
  1. Does a plain `/effort <level>` persist into the config dir's `settings.json` (`effortLevel` or `modelSettings.<id>.effortLevel`)? Does `/effort auto` delete a saved level?
  1b. The same two questions for `/model <alias>` (slice 4's picker lever depends on it; spec §5.2 "class, live").
  2. Can the session-only form be driven by keystrokes (the picker's "for this session only" confirmation — which keys), for `/effort` and for `/model`?
  3. Is `ultracode` a `--settings` key at all, and is `enableWorkflows`? Does `--settings '{"enableWorkflows":true,"ultracode":true}'` put the session in ultracode (the status line's `ultracode` divider word)? Does an unrecognised key make the process refuse to start? Is `enableWorkflows` readable back anywhere (settings file, `/config`, the pane)?
  4. On a lane whose `settings.json` pins `modelSettings.<id>.effortLevel`: does a keystroke `/effort <other>` take, and does it survive a relaunch — measured first on a synthetic pin (the control), then read-only against each of the two really-pinned lanes the spec names.
  5. Does an effort change mid-session on Opus 5 re-write the cached prefix; the same on Fable 5.1.

- [ ] **Step 1: Build the scratch config dirs and the private tmux server**

Everything lives under the session scratchpad — the directory the harness names in its environment block ("Scratchpad directory: …") — never inside the checkout:

```bash
S="${CLAUDE_SCRATCHPAD:?set this to the session scratchpad path from the environment block}/route-probe"
mkdir -p "$S/cfg-plain" "$S/cfg-pinned"
printf '%s\n' '{"effortLevel":"xhigh"}' > "$S/cfg-plain/settings.json"
printf '%s\n' '{"effortLevel":"xhigh","modelSettings":{"claude-opus-5":{"effortLevel":"high"}}}' > "$S/cfg-pinned/settings.json"
ls ~/.cc-secrets/ | grep -- '-oauth.env$'          # pick ONE Anthropic lane's file name; never cat it
```

Each arm below runs as:

```bash
set -a; . ~/.cc-secrets/<lane>-oauth.env; set +a
tmux -L routeprobe new-session -d -s probe -x 200 -y 50 \
  "cd '$S' && exec env CLAUDE_CONFIG_DIR='$S/cfg-plain' $HOME/.local/bin/claude --model opus --dangerously-skip-permissions"
sleep 20; tmux -L routeprobe capture-pane -t probe -p | tail -5     # wait for the ❯ prompt
```

and ends with `tmux -L routeprobe kill-server`. Every `capture-pane` output is saved under `$S/arm-<n>.txt`; the settings file is diffed before and after with `diff "$S/before.json" "$S/cfg-plain/settings.json"`.

- [ ] **Step 2: Arm 1 — plain `/effort high`, then `/effort auto`; Arm 1b — plain `/model sonnet`, then `/model default`**

Type `tmux -L routeprobe send-keys -t probe -l '/effort high'; sleep 1; tmux -L routeprobe send-keys -t probe Enter`, wait 3s, capture. If a picker appears, capture its rows verbatim (the strings "saved as your default for new sessions" / "for this session only" are what to look for), choose NOTHING yet, capture, then press Escape. Then read `cfg-plain/settings.json`. Repeat with `/effort auto`. Then, on a fresh launch, the same for `/model sonnet` and `/model default` (the keys to look for are `model` in `settings.json` and the picker's confirmation text). Record: the confirmation text, which key confirms which form, and the settings file before/after each.

- [ ] **Step 3: Arm 2 — the session-only form by keystroke, for `/effort` and `/model`**

Same launch. `/effort medium` + Enter; when the confirmation shows, drive the "for this session only" choice by the keys arm 1 found (arrow + Enter, or a letter). Capture the acknowledgement line; read settings.json (must be unchanged); type a one-word prompt (`Reply ok`) and read the status line's `🤖 … · medium`. Repeat with `/model sonnet` and the status line's model segment. Record both.

- [ ] **Step 4: Arm 3 — `--settings` at launch, key by key**

Launch with `--settings '{"enableWorkflows":true}'` only; capture the first 20 lines (a refused key shows here), type `/config`, capture the workflows row; Escape; kill. Launch with `--settings '{"enableWorkflows":true,"ultracode":true}'`; capture the status line's divider word `ultracode`, and `/effort` with no argument (its answer names the level). Kill. Launch with `--settings '{"nosuchkey":true}'` and capture whether the process starts (this is the "does an unrecognised key exit the process" control — if it does, an `ultracode` key that does not exist would kill every routed spawn). Record whether each key is honoured, whether an unknown key is fatal, and where `enableWorkflows` is readable back (the settings file is NOT changed by `--settings` — confirm by diff).

- [ ] **Step 5: Arm 4 — the pinned lane, synthetic then real**

Control: launch with `CLAUDE_CONFIG_DIR=$S/cfg-pinned` and `--model opus`. Read the status line's effort (expected `high`, the pin). `/effort xhigh` session-only (arm 2's keys). Capture the status line. Kill and relaunch with `--resume <uuid>` (the uuid is the transcript filename under `$S/cfg-pinned/projects/`). Capture the status line after the resume. Then the real thing, READ-ONLY: for each of the two lanes whose `settings.json` carries `modelSettings.<id>.effortLevel` today (`grep -l modelSettings ~/.claude*/settings.json` names them; do not edit them), launch the probe with `CLAUDE_CONFIG_DIR` pointed at that lane's dir on the private tmux server, repeat the keystroke and the resume, capture, kill. (The lane's own live sessions are untouched: this is one more process on the same config dir, the shape every `claude -p` on the box already has.) Record whether the keystroke took and survived on each.

- [ ] **Step 6: Arm 5 — cache safety**

Launch interactively as in arm 2 on `cfg-plain`; turn A: `Reply ok`; turn B: `Reply ok` (control — read `cache_creation_input_tokens` and `cache_read_input_tokens` from the last two `assistant` lines of the transcript); `/effort medium` session-only; turn C: `Reply ok`; read the same two fields. A cache-safe change shows turn C's creation tokens comparable to turn B's (tens to hundreds), an unsafe one shows the full prefix re-written (thousands). Repeat once on `--model fable`. Record both.

- [ ] **Step 7: Record, then decide — every branch spelled**

Add one research-note §6 row per arm, verbatim strings included. Then mint deviations (`ccrc-api ledger allocate` — or `D-TBD-<slug>` if unreachable) that state:

- **The effort lever** (Task 8 branches on it):
  - **Lever A (keystroke):** arm 2 showed the session-only form is drivable by keystroke and arm 1 showed the plain form persists → Task 8 types the level and then the session-only confirmation keys.
  - **Lever A′ (plain keystroke):** arm 1 showed a plain `/effort <level>` does NOT persist → Task 8 types it plain, as today.
  - **Lever B (launch pin):** the session-only form cannot be driven, or the plain form persists and no confirmation is reachable → Task 8 types ONLY `ultracode` (session-only by construction) and every other level goes on the argv as `--effort <level>` from `_spawn_start`'s `routeflags`; a live effort change is then a relaunch.
- **The `--settings` keys** (Task 8 composes only what this says):
  - arm 3 honours `enableWorkflows` and `ultracode` → Task 8 composes `--settings '{"enableWorkflows":true,"ultracode":true}'` for `effort: ultracode` and `--settings '{"enableWorkflows":true}'` for `workflow: on` at another effort.
  - arm 3 honours `enableWorkflows` only → Task 8 composes the `enableWorkflows` form for `workflow: on`; ultracode stays the settle's keystroke.
  - arm 3 honours neither, or an unknown key is fatal → Task 8 composes NO `--settings`; ultracode stays the settle's keystroke; `workflow` has no lever in this slice and is stamped `inert=workflow` on every lane until one is found — recorded as the observer gap spec §6 names.
- **The pinned lanes:** if arm 4 shows the keystroke does not survive on a really-pinned lane, the consequent the spec states ("removes the pins if not") is an operator-approved edit of those two lanes' `settings.json` (remove `modelSettings.<id>.effortLevel`), recorded before/after — asked, never done silently.
- **The `/model` lever** (slice 4's, recorded now): which form persists and which keys drive the session-only form.

- [ ] **Step 8: Commit the note**

```bash
git add docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md docs/superpowers/plans/2026-09-14-routing-slice1-routing-record.md
git commit -m "docs(research): slice 1 keystroke, /model, --settings, pinned-lane and cache measurements; the levers ruled (routing slice 1, Task 7)"
```

---

### Task 8: The settle reads the record; `--settings` per the measurement

**Files:**
- Modify: `ccd/ccd` — `_inject_spawn_effort` (`ccd/ccd:14905-14926`); the `SPAWN_EFFORT` comment (975-977); `_spawn_start`'s record block from Task 6 (the `--settings` composition, per Task 7's `--settings` ruling; plus `--effort` under Lever B)
- Test: `server/test/ccd-route-settle.test.ts` (new); `server/test/ccd-route-spawn.test.ts` (the `--settings` expectations, per the ruling); `server/test/ccd-redrive.test.ts`, `server/test/ccd-backend-vs-placement.test.ts:126` (the literal `_inject_spawn_effort "$tname"` call stays), `server/test/ccd-pane-box-draft.test.ts`, `server/test/ccd-login-screen.test.ts` (all stay green)

**Interfaces:**
- Consumes: Task 2's `_route_any`, `_route_get`, `_route_effort_for`; Task 7's rulings; `_pane_auto_continue_armed`, `_pane_box_has_content`.
- Produces: `_inject_spawn_effort <tmuxname>` (signature unchanged — `ccd-backend-vs-placement` pins the call line) derives the id as `${1#cc-}` and types the RECORD's effort; with no record, `SPAWN_EFFORT` as today; `auto` types nothing; a Haiku class types nothing. `_spawn_start` composes exactly the `--settings` form Task 7 confirmed.

- [ ] **Step 1: Write the failing tests**

```ts
// server/test/ccd-route-settle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-route-settle-'); });
afterEach(() => { h.cleanup(); });

/** tmux, RECORDING: `capture-pane` answers `$PANE_TEXT` (the `ccd-redrive.test.ts` stub). */
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
const READY = '? for shortcuts\n❯ ';
const typed = (): string[] => h.calls().filter((l) => l.includes('send-keys') && l.includes('-l '));
const settle = (): void => { h.sh(`${STUBS} _inject_spawn_effort cc-myid`, { PANE_TEXT: READY }); };
const seed = (): void => { h.sh('_reg_set myid wrapper claude; _reg_set myid uuid deadbeef-0000-4000-8000-000000000000'); };

describe('_inject_spawn_effort reads the routing record (routing spec 2026-09-14 §5.2)', () => {
  it('no record: SPAWN_EFFORT, as today', () => {
    seed(); settle();
    expect(typed()).toEqual(['tmux send-keys -t cc-myid -l /effort ultracode']);
  });
  it('a record with effort high: types the record\'s level, never the global', () => {
    seed(); h.sh('_reg_set myid class opus; _reg_set myid effort high'); settle();
    expect(typed()).toEqual(['tmux send-keys -t cc-myid -l /effort high']);
  });
  it('a record with effort auto: types nothing — the lane decides', () => {
    seed(); h.sh('_reg_set myid effort auto'); settle();
    expect(typed()).toEqual([]);
  });
  it('a record with no effort field at all (only class): types nothing — absent means auto', () => {
    seed(); h.sh('_reg_set myid class sonnet'); settle();
    expect(typed()).toEqual([]);
  });
  it('class haiku with an effort on disk: types nothing and notes the PAIR', () => {
    seed(); h.sh('_reg_set myid class haiku; _reg_set myid effort high'); settle();
    expect(typed()).toEqual([]);
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log"')).toMatch(/route-refuse myid: class haiku takes no effort level/);
  });
  it('an unrecognised effort: types nothing and notes it — nothing unrecognised reaches a keystroke', () => {
    seed(); h.sh("_reg_set myid effort 'extreme; rm -rf /'"); settle();
    expect(typed()).toEqual([]);
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log"')).toMatch(/route-reject myid: field effort holds an unrecognised value \(17 bytes\)/);
    expect(h.sh('cat "$HOME/.cc-sessions/swap.log"')).not.toContain('rm -rf');
  });
  it('the existing guards still hold: an armed auto-continue and a drafted box type nothing', () => {
    seed(); h.sh('_reg_set myid effort high');
    h.sh(`${STUBS} _inject_spawn_effort cc-myid`, { PANE_TEXT: 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ' });
    h.sh(`${STUBS} _inject_spawn_effort cc-myid`, { PANE_TEXT: READY, BOX_DRAFT: 'half a sentence' });
    expect(typed()).toEqual([]);
  });
});
```

Under **Lever A** (Task 7), extend the second test to expect the session-only confirmation keys after the level, exactly as arm 2 recorded them (for example `['tmux send-keys -t cc-myid -l /effort high', 'tmux send-keys -t cc-myid Down', 'tmux send-keys -t cc-myid Enter']` — use the keys measured, not these). Under **Lever B**, the second test expects `[]` (nothing typed for `high`), a new test expects `ultracode` to be typed, and `ccd-route-spawn.test.ts` gains a test expecting `--effort high` on both lines.

For `--settings`, add to `server/test/ccd-route-spawn.test.ts` ONE of these, per Task 7's ruling (the other forms are not written):

```ts
  // arm 3 honoured both keys:
  it('effort ultracode composes --settings with both keys on BOTH lines; workflow on alone composes enableWorkflows only', () => {
    seed('myid'); h.sh(`_reg_set myid class opus; _reg_set myid effort ultracode`);
    const [p1, r1] = spawnBoth('myid');
    for (const l of [p1, r1]) expect(l).toContain(`--model opus --settings '{"enableWorkflows":true,"ultracode":true}' --`);
    h.sh(`rm -f "$HOME/ccd-calls" "$HOME/pane-up"; _reg_set myid effort high; _reg_set myid workflow on`);
    const [p2] = spawnBoth('myid');
    expect(p2).toContain(`--model opus --settings '{"enableWorkflows":true}' --`);
  });
  // arm 3 honoured enableWorkflows only: the same test with the first expectation reading
  //   `--model opus --settings '{"enableWorkflows":true}' --` for effort ultracode too.
  // arm 3 honoured neither: a test asserting no `--settings` for any record, and
  //   `expect(h.reg('myid', 'inert')).toBe('workflow')` on an Anthropic lane with workflow on.
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-settle.test.ts test/ccd-route-spawn.test.ts`
Expected: FAIL from the second settle test on (today's function types `SPAWN_EFFORT` regardless); the new spawn test FAILS (no `--settings` composed yet).

- [ ] **Step 3: Implement (Lever A′ shown; A adds the confirmation keys after the level's Enter; B is described below)**

Replace `_inject_spawn_effort` (`ccd/ccd:14905-14926`) with:

```bash
_inject_spawn_effort() {   # tmuxname — apply the session's effort once the TUI is up.
  # The id is the tmux name with `cc-` stripped (`_tmux`), so the signature the
  # settle calls with stays (`ccd-backend-vs-placement.test.ts` pins the call).
  # THE RECORD DECIDES (routing spec 2026-09-14 §5.2): a session with any
  # routing field types its `effort` — `auto` and an absent field type NOTHING,
  # the lane decides — and a session with no record at all is a pre-slice-1
  # session and gets SPAWN_EFFORT as before. Nothing unrecognised reaches a
  # keystroke: `_route_effort_for` returns only vocabulary words, and refuses
  # the pair with class haiku.
  local t="$1" id="${1#cc-}" level
  if _route_any "$id"; then
    level=$(_route_effort_for "$id" "$(_route_get "$id" class)")
    [[ "$level" == auto ]] && level=""
  else
    level="$SPAWN_EFFORT"
  fi
  [[ -n "$level" ]] || return 0
  if _pane_auto_continue_armed "$(tmux capture-pane -t "$t" -p 2>/dev/null)"; then
    echo "ccd: auto-continue armed, skipped /effort $level (D-2229)" >&2; return 0
  fi
  # Only type into an EMPTY input box — a restored draft would swallow the slash
  # command. `-e` for the same reason the auto-compact guard passes it: without
  # the escape codes a dim ghost-suggestion reads as a draft and /effort is
  # skipped on every fresh session that shows one.
  if _pane_box_has_content "$(tmux capture-pane -t "$t" -p -e 2>/dev/null)"; then
    echo "ccd: input box not empty, skipped /effort $level" >&2; return 0
  fi
  sleep 1
  tmux send-keys -t "$t" -l "/effort $level"; sleep 1; tmux send-keys -t "$t" Enter
  # Sessions with cached history confirm the switch ("full history gets re-read") — accept.
  sleep 2
  if tmux capture-pane -t "$t" -p 2>/dev/null | grep -q "Yes, switch"; then
    tmux send-keys -t "$t" Enter
  fi
  return 0
}
```

Update the `SPAWN_EFFORT` comment (975-977) to: `# /effort sent at settle to a session with NO routing record ("" disables). A session with a record types its own effort field instead (routing spec §5.2). Whether ultracode also rides --settings is Task 7's measured answer, composed in _spawn_start.`

**Lever A:** after the `Enter` that submits the level, wait `sleep 2`, capture, and if the confirmation the probe recorded is on screen, send the keys arm 2 measured for "for this session only"; if it is not on screen (an older or newer build), send Escape and journal `route-skip <id>: /effort confirmation not recognised` to `swap.log` so the field stays intended and nothing persists.

**Lever B:** `level` other than `ultracode` is NOT typed here (`[[ "$level" == ultracode ]] || return 0` after the record read, with the same journal line), and Task 6's block in `_spawn_start` gains `[[ -n "$reff" && "$reff" != ultracode && "$reff" != auto ]] && routeflags="${routeflags:+$routeflags }--effort $reff"` on Anthropic lanes; `ccd-route-spawn.test.ts` is updated in the same commit.

**`--settings`:** in `_spawn_start`'s record block (Task 6), inside the `_is_anthropic_backend` arm, add exactly the form Task 7 ruled — for the both-keys ruling:

```bash
      if [[ "$rwf" == on ]]; then
        if [[ "$reff" == ultracode ]]; then
          routeflags="${routeflags:+$routeflags }--settings '{\"enableWorkflows\":true,\"ultracode\":true}'"
        else
          routeflags="${routeflags:+$routeflags }--settings '{\"enableWorkflows\":true}'"
        fi
      fi
```

(for the enableWorkflows-only ruling, the single `enableWorkflows` form in both branches; for the neither ruling, no `--settings` and `inert="${inert:+$inert,}workflow"` on the Anthropic arm when `rwf == on`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-route-settle.test.ts test/ccd-route-spawn.test.ts test/ccd-spawn-split.test.ts test/ccd-redrive.test.ts test/ccd-backend-vs-placement.test.ts test/ccd-pane-box-draft.test.ts test/ccd-login-screen.test.ts test/ccd-authdead.test.ts`
Expected: PASS.

- [ ] **Step 5: Measure the mutation**

Replace `level=$(_route_effort_for …)` with `level="$SPAWN_EFFORT"` inside the record branch: the "effort high" and "effort auto" tests must FAIL. Restore.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-route-settle.test.ts server/test/ccd-route-spawn.test.ts
git commit -m "feat(ccd): the settle types the record's effort; --settings per the measured keys (routing slice 1, Task 8)"
```

---

### Task 9: The doctor check and the env census

**Files:**
- Modify: `ccd/ccrc-doctor-checks` — `_check_routing` beside `_check_memory` (line 4243); `routing` appended to `CCRC_DOCTOR_CHECKS` (166-198)
- Test: `server/test/ccrc-doctor.test.ts` (the `accounts` describe's helpers, line 6227-6234); `server/test/routing-env-census.test.ts` (new)

**Interfaces:**
- Produces: `ccrc doctor` line `PASS routing: <n> Anthropic lane(s): no settings.json overrides the routing record's spawn env` / `FAIL routing: … CLAUDE_CODE_SUBAGENT_MODEL or CLAUDE_CODE_EFFORT_LEVEL … : <ids>` / `WARN routing: could not read …`. A box with NO roster projection, or one declaring no Anthropic-backend account, answers `PASS routing: 0 Anthropic lane(s) …` — vacuously true and said so — NOT a SKIP: the doctor suite's `healthy()` fixture deliberately writes no projection and pins its skip count (`HEALTHY_SKIPS`, `ccrc-doctor.test.ts:1059-1070`), so a SKIP here would red every counting assertion in that file for a box that has nothing to contradict. A source-scan test that `CLAUDE_CODE_EFFORT_LEVEL` appears in no shipped bash or JS except the doctor check, with a vacuity control, and that `CLAUDE_CODE_SUBAGENT_MODEL=` appears in `ccd/ccd` exactly once (Task 6's composer).

- [ ] **Step 1: Write the failing tests**

`server/test/routing-env-census.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const count = (s: string, needle: string): number => s.split(needle).length - 1;
const under = (dir: string, ext: string): string[] =>
  readdirSync(path.join(root, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => path.relative(root, path.join(e.parentPath ?? e.path, e.name)));

describe('routing env census (routing spec 2026-09-14 §5.2, §8)', () => {
  it('CLAUDE_CODE_EFFORT_LEVEL is set NOWHERE — the only shipped mention is the doctor check that refuses it', () => {
    const shipped = ['ccd/ccd', 'ccd/ccrc', 'ccd/session-hook.sh', 'ccd/statusline-command.sh', 'ccd/ccd-usage-sweep',
      ...under('shared', '.mjs'), ...under('shared', '.ts'), ...under('deploy', '.mjs'), ...under('server/src', '.ts'), ...under('agent/src', '.ts')]
      .filter((f) => existsSync(path.join(root, f)));
    expect(shipped.length, 'the census must have a corpus').toBeGreaterThan(20);   // vacuity control
    const holders = shipped.filter((f) => count(read(f), 'CLAUDE_CODE_EFFORT_LEVEL') > 0);
    expect(holders).toEqual([]);
    expect(count(read('ccd/ccrc-doctor-checks'), 'CLAUDE_CODE_EFFORT_LEVEL'), 'the doctor check names it').toBeGreaterThan(0);
  });
  it('ccd composes CLAUDE_CODE_SUBAGENT_MODEL in exactly one place, from the routing record', () => {
    const ccd = read('ccd/ccd');
    expect(count(ccd, 'CLAUDE_CODE_SUBAGENT_MODEL=')).toBe(1);
    expect(ccd).toContain('routeenv="CLAUDE_CODE_SUBAGENT_MODEL=$rsub"');
  });
});
```

(`ccd/ccd-usage-sweep` exists only once slice 0 has landed; the `existsSync` filter tolerates its absence. Task 6's comment in `ccd/ccd` deliberately does not spell the effort key — it says "the one env variable that would pin it is the override `_check_routing` refuses" — so this census holds after Task 6.)

`server/test/ccrc-doctor.test.ts`, inside `describe('ccrc doctor: accounts', …)` (line 6227). The check reads the roster PROJECTION (`~/.ccrc/accounts.sh`), which `healthy()` deliberately never writes (its comment at line 1035) and `writeRoster` (line 313) does not regenerate — so the lane-bearing tests seed it with `seedAccountsSh`, the helper the `pools` describe already imports from `./ccdWsHelpers.js` and calls as `seedAccountsSh(home, POOLED_TEST_ROSTER)` (line 3839):

```ts
  const ROUTING_ROSTER = { version: 1, accounts: [
    { id: 'claude', label: 'team·max', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'gpt', label: 'gpt', configDirSuffix: '.gpt-cfg', exec: { kind: 'external' }, homeAble: false, hue: 'magenta', telemetry: 'none' },
  ] };
  const routingBox = (prefix: string): string => {
    const home = healthy(prefix);
    seedAccountsSh(home, ROUTING_ROSTER);
    return home;
  };

  it('routing: PASSES when no Anthropic lane\'s settings.json names a routing env key', () => {
    const home = routingBox('ccrc-doctor-routing-pass-');
    writeSettingsEnv(home, '.claude', { ANTHROPIC_MODEL: '' });
    writeSettingsEnv(home, '.gpt-cfg', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });   // a non-Anthropic lane is not this check's subject
    const line = lineFor(runDoctor(home).stdout, 'routing');
    expect(line).toMatch(/^PASS routing: 1 Anthropic lane\(s\)/);
  });
  it('routing: FAILS naming the lane whose settings.json sets CLAUDE_CODE_SUBAGENT_MODEL', () => {
    const home = routingBox('ccrc-doctor-routing-fail-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'routing');
    expect(line, out).toMatch(/^FAIL routing: /);
    expect(line).toContain('claude');
    expect(out).toContain('remedy: remove the key');
  });
  it('routing: FAILS on CLAUDE_CODE_EFFORT_LEVEL too', () => {
    const home = routingBox('ccrc-doctor-routing-effort-');
    writeSettingsEnv(home, '.claude', { CLAUDE_CODE_EFFORT_LEVEL: 'high' });
    expect(lineFor(runDoctor(home).stdout, 'routing')).toMatch(/^FAIL routing: /);
  });
  it('routing: a box with no projection PASSES vacuously and says so — never a SKIP, which the healthy fixture\'s counts forbid', () => {
    const home = healthy('ccrc-doctor-routing-noroster-');
    expect(lineFor(runDoctor(home).stdout, 'routing')).toMatch(/^PASS routing: 0 Anthropic lane\(s\).*no roster projection/);
  });
```

If `writeSettingsEnv` is scoped inside the `accounts` describe (it is declared at line 6228), put these tests in that describe; `seedAccountsSh` must be in the file's import from `./ccdWsHelpers.js` (add it if the `pools` describe imports it under a different path).

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/routing-env-census.test.ts test/ccrc-doctor.test.ts -t routing`
Expected: the census test PASSES already (the tree has no `CLAUDE_CODE_EFFORT_LEVEL` and Task 6's composer exists); the doctor tests FAIL: no `routing` line.

- [ ] **Step 3: Implement the check**

In `ccd/ccrc-doctor-checks`, append `  routing` to `CCRC_DOCTOR_CHECKS` after `memory`, and beside `_check_memory` add:

```bash
_check_routing() {
  # Routing spec 2026-09-14 §5.2 / §8: on an Anthropic lane the subagent floor
  # rides the spawn PROCESS ENV (`CLAUDE_CODE_SUBAGENT_MODEL`, composed by ccd
  # from the routing record), which a `settings.json` env key would override
  # silently; and CLAUDE_CODE_EFFORT_LEVEL overrides every effort control and
  # must appear nowhere. A text scan, like `_check_memory`: presence is the
  # fact. A box with no projection or no Anthropic lane has nothing that could
  # contradict the rule and PASSES vacuously, in those words — not a SKIP: the
  # doctor's own healthy fixture has no projection, and a check that skips
  # there is a check that cannot be counted.
  local sh="$HOME/.ccrc/accounts.sh" raw="" bad="" unread="" a d f line n=0
  if [ ! -r "$sh" ]; then
    _dr_pass routing "0 Anthropic lane(s): no roster projection at \$HOME/.ccrc/accounts.sh, so no settings.json can override the routing record's spawn env (the wrappers check owns the roster's health)"
    return 0
  fi
  raw="$( . "$sh" 2>/dev/null && declare -p CCRC_ANTHROPIC_BACKEND >/dev/null 2>&1 \
        && for a in "${CCRC_ANTHROPIC_BACKEND[@]}"; do printf '%s\t%s\n' "$a" "$(_ccrc_cfg_dir "$a")"; done )" || raw=""
  if [ -z "$raw" ]; then
    _dr_pass routing "0 Anthropic lane(s): the roster declares no Anthropic-backend account, so no settings.json can override the routing record's spawn env"
    return 0
  fi
  while IFS=$'\t' read -r a d; do
    [ -n "$a" ] || continue
    n=$((n + 1)); f="$d/settings.json"
    [ -e "$f" ] || continue
    [ -r "$f" ] || { unread="${unread:+$unread }$a"; continue; }
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        *CLAUDE_CODE_SUBAGENT_MODEL*|*CLAUDE_CODE_EFFORT_LEVEL*) bad="${bad:+$bad }$a"; break ;;
      esac
    done < "$f"
  done <<<"$raw"
  if [ -n "$bad" ]; then
    _dr_fail routing "an Anthropic lane's settings.json names CLAUDE_CODE_SUBAGENT_MODEL or CLAUDE_CODE_EFFORT_LEVEL, which would override the routing record's spawn env: $bad" \
      "remove the key from that lane's settings.json — the routing record (ccd route) is the one writer of the subagent floor, and the effort override must not exist"
    return 1
  fi
  if [ -n "$unread" ]; then
    _dr_warn routing "could not read settings.json for: $unread" "chmod u+r <home>/settings.json, or check by hand for CLAUDE_CODE_SUBAGENT_MODEL and CLAUDE_CODE_EFFORT_LEVEL"
    return 2
  fi
  _dr_pass routing "$n Anthropic lane(s): no settings.json overrides the routing record's spawn env"
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest run test/routing-env-census.test.ts test/ccrc-doctor.test.ts`
Expected: PASS — the whole doctor suite, its `HEALTHY_SKIPS` and verdict-count pins included (the new check adds one PASS to a healthy box, which the count assertions derive from the table rather than pin by number; if one pins a literal total, raise it by one with the reason in the same commit).

- [ ] **Step 5: Measure the mutation**

Delete `|*CLAUDE_CODE_EFFORT_LEVEL*` from the `case`: the third doctor test must FAIL. Restore. Change the no-projection arm to `_dr_skip`: the fourth doctor test AND the suite's healthy-box count pins must FAIL — that red is the reason the arm is a PASS. Restore.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts server/test/routing-env-census.test.ts
git commit -m "feat(doctor): routing check — no settings.json override of the spawn env; env census (routing slice 1, Task 9)"
```

---

### Task 10: Ship agent-first and measure the gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md` §6 (one row: a swap carrying every field)

- [ ] **Step 1: The full suites, in chunks**

From `server/`, foreground, `timeout 600000` each: `./node_modules/.bin/vitest run --maxWorkers=2 test/[a-c]*.test.ts`, `test/[d-l]*.test.ts`, `test/[m-r]*.test.ts`, `test/[s-z]*.test.ts`; then `cd agent && npm run test`, `cd pwa && npm run test`. Known load flakes re-run in isolation before being called real.

- [ ] **Step 2: PR, review, merge**

`gh pr create` from `ws/ccrc-token-optimization-strategy` against `main`; body ends with the attribution line the session reminder specifies; merge after the operator's approval.

- [ ] **Step 3: Deploy, agent lane first**

`bash deploy/deploy.sh agent` from the box holding `~/.ccrc/deploy.env` (ships `ccd`, `ccrc`, `ccrc-doctor-checks`, `accounts.sh` regenerated with `CCRC_SUBAGENT_CLASSES`), then `bash deploy/deploy.sh` (server; `/health` reports the shipped sha). Then on the fleet host: `ccrc doctor | grep routing` → `PASS routing`.

- [ ] **Step 4: Measure — a swap carrying every field**

On the fleet host, on the coordinator's OWN session id (the one running this plan, so no other session's pane is touched), write a record whose effect is nil today: `ccd route --session <own id> --set class=default --set subagent=sonnet --set workflow=on --set effort=ultracode --actor operator --reason 'slice 1 gate'`. Read `swap.log` for the four `route` lines and the lifecycle journal for the four `route` acts (`ccrc-api` or `GET /api/feed`). Then wait for the next NATURAL resume or swap of that session (never force one) and read: the spawn line in the session's unit journal (`journalctl --user -u claude-session@<id> --no-pager | grep new-session`) carries `CLAUDE_CODE_SUBAGENT_MODEL=sonnet`, no `--model` (class `default`), and exactly the `--settings` form Task 7 ruled (or none, with `inert=workflow` stamped if it ruled none); the status line shows `ultracode` (typed by the settle, or carried by `--settings`); slice 0's sidecar (if landed) shows the model unchanged. Record the id, the timestamps and the argv in the research note §6 as "A swap carrying every field, measured".

- [ ] **Step 5: Commit the row**

```bash
git add docs/superpowers/specs/2026-09-13-effort-model-orchestration-research.md
git commit -m "docs(research): slice 1 gate — a swap measured carrying every routing field (routing slice 1, Task 10)"
```

---

## Deviations found

Numbers are ISSUED by `POST /api/ledger/deviations` (`ccrc-api ledger allocate`) and defined in the same act. A session that cannot reach the allocator writes `D-TBD-<slug>` and reports it (worker clause 11). Task 7's lever ruling is the first entry this plan expects.

- **D-2808 (2026-09-14)** — **The effort lever: `--effort <level>` on the spawn argv; the session-only keystroke
  for live changes.** Measured on Claude Code 2.1.270 (research note §6/§6.1 ruling 1): a plain `/effort <level>`
  PERSISTS as `modelSettings.<model-id>.effortLevel` in the config dir (`/effort auto` deletes it); the session-only
  form is keystroke-drivable (bare `/effort`, ←/→, `s`) but does NOT survive `--resume` — which is what a rescue swap
  does; `--effort <level>` on the argv is session-scoped, writes nothing, overrides both pins, covers `ultracode`, and
  is re-applied on every relaunch; an effort change mid-session re-writes the Opus 5 cache prefix (cc 35 → 8109) but
  not Fable 5.1's. The plan's branch table had Lever A/A′/B; the measurement picks Lever B for the record at spawn and
  Lever A (session-only) for a live change in slice 5. Task 8 composes `--effort` from the record on both spawn lines
  and `_inject_spawn_effort` types nothing when the record carries an effort; a record-less session keeps today's
  plain `/effort ultracode` because `ultracode` was measured NOT to persist (see D-2810).
- **D-2809 (2026-09-14)** — **`--settings` honours both `enableWorkflows` and `ultracode`.** Arm 3 (§6.1 ruling 2):
  both keys take effect at launch, an unknown key is not fatal, and `--settings` never writes the settings file —
  contradicting ccd's own `SPAWN_EFFORT` comment that ultracode has no settings key. Task 8 composes
  `--settings '{"enableWorkflows":true,"ultracode":true}'` for `effort: ultracode` and
  `--settings '{"enableWorkflows":true}'` for `workflow: on` with another effort.
- **D-2810 (2026-09-14)** — **The pinned lanes: four config dirs pin a per-model effort, not two; ccd's settle is
  not the writer; no operator edit.** The census (read-only) found FOUR dirs with `modelSettings.<id>.effortLevel`
  (three on Fable 5.1, one on Opus 5), not the spec's two. The fix round measured the candidate writer: `/effort
  ultracode` on a fresh dir leaves settings.json byte-identical ("this session only"), while `/effort high` writes the
  per-model pin — so `_inject_spawn_effort`'s plain `ultracode` keystroke does not pollute lane settings and non-
  ultracode levels must go through the argv or the session-only keys. On a pinned dir the keystroke takes and a
  `--resume` reverts to the pin; `--effort` overrides it. The spec's consequent ("remove the pins") is not entered.
- **D-2811 (2026-09-14)** — **The `/model` lever, recorded for slice 4.** `/model <alias>` persists top-level `model`
  (`/model default` deletes it); the session-only form is drivable (bare `/model`, ↓, `s`) with the trap that ←/→
  inside the model picker moves EFFORT; `--model` on the argv stays the relaunch lever (Task 6).
- **D-2813 (2026-09-14)** — **`route` refuses control characters in `--actor`/`--reason`.** Task 4's verbatim
  `cmd_route` interpolated both free-form arguments into the swap.log line unescaped, so a newline in either
  forged a second, plausible log line — the threat the function's own byte-count rendering of the OLD value
  exists to stop. Now any control character in either argument dies before any write; a negative row pins it.
  Ruling S1-R4.
- **D-2814 (2026-09-14)** — **`auto` is the escape from the haiku+effort refusal.** The verb had no way to
  produce absence and treated `auto` as a set level, so a session that had ever had `effort` written could
  never be routed to `class=haiku` (the refusal named a "clear effort" no verb performs). Spec §5.1 gives
  `auto` the absent meaning: the pair refusal now fires only for a LEVEL other than `auto`, in `cmd_route` and
  in `_route_effort_for`, and the message says "set effort=auto or pick another class". No `--clear` in this
  slice. Ruling S1-R5.
- **D-2815 (2026-09-14)** — **`inert=effort` is not stamped for `effort=auto`.** Task 6's non-Anthropic arm
  stamped `inert=effort` for any non-empty effort, `auto` included — a record claiming a field was not applied
  when nothing was requested. The guard excludes `auto`; a gpt-lane case pins it. Ruling S1-R6. Carried to the
  slice 4 plan (ruling S1-R7): the stamp covers ANY level today because ccd's settle keystroke is
  Anthropic-gated, which is honest now and narrower than spec §5.2's "ultracode and workflow only" — slice 4
  narrows the stamp when its tick types on those lanes, and the spec paragraph is amended then.
- **D-2816 (2026-09-14)** — **The doctor's routing check WARNs on an unsourceable projection.** Task 9's
  verbatim `_check_routing` folded "the roster declares no Anthropic lane", "accounts.sh failed to source" and
  "the projection predates the array" into one vacuous PASS — green having measured nothing. A source/declare
  failure is its own WARN with the remedy; the PASS is kept for an array declared with zero elements. The two
  unpinned arms gained tests and the env census corpus is derived from every shipped script under `ccd/`.
  Ruling S1-R9.
- **D-2817 (2026-09-14)** — **The act vocabulary is pinned by six suites, not two.** Task 3's one commit red
  three more suites the plan never named (`ccd-lifecycle-emit` 22→23, `lifecycle-acts`' exhaustive record and
  counts, `single-definition`'s `LIFECYCLE_ACTS.length`); the fix round updated them. Task 1 likewise had to add
  `shared/models.mjs` to the enumerated install fixture tree (`installTreeFixture.ts`) — the new sibling import
  reds 120 install tests otherwise — and Task 2 had to widen `single-definition`'s four-class-names holder list
  with `ccd/ccd` (`ROUTE_CLASSES`, a legitimate seventh holder because `_route_word_in` walks it).
- **D-2818 (2026-09-14)** — **Task 8 departs from the brief's draft text on three points, per ruling S1-R8.**
  `--effort` is composed for `ultracode` too (the ruling's Lever B covers every non-auto level); `--settings`
  is ordered before `--effort` inside `routeflags`; and the settle test exercises the record-less path, since
  under Lever B a record short-circuits before the legacy guards. Task 9's brief-mandated
  `e.parentPath ?? e.path` became `e.parentPath` (a TS2339 on this `@types/node`; the Node floor is ≥22.13). The final
  wave implemented ruling S1-R2 (the rejection note counts BYTES) through a `_route_bytes` helper with a
  function-local `LC_ALL=C` rather than `local LC_ALL=C` inside `cmd_route`, which would have changed what
  `[[:cntrl:]]` matches and silently weakened D-2813's guard.
- **D-2819 (2026-09-14)** — **The marker gate, again.** Task 8's in-workflow fix round (a comment-only edit to
  `ccd/ccd`) shipped without the provenance re-stamp D-2788 requires, because the loop's fix prompt did not
  carry the gate; the controller re-stamped (ea5ea703) and every later dispatch carries the step explicitly.
- **D-2820 (2026-09-14)** — **A missing subagent vocabulary is not a bad value.** `_route_valid`'s subagent arm folded
  "this box's roster projection carries no `CCRC_SUBAGENT_CLASSES`" into "the value is not haiku or sonnet", so a
  legal `haiku` died as `bad value` and a stored one journalled as unrecognised; and the doctor's routing check
  probed only the older `CCRC_ANTHROPIC_BACKEND` array. Now the validator answers three ways (in vocabulary / bad
  value / vocabulary unavailable), `cmd_route` and the journal say which, a pure `_route_peek` serves the
  decide-then-die reads, and `_check_routing` probes the new array too. Whole-branch review finding #1.
- **D-2821 (2026-09-14)** — **`--model <alias>` on a non-Anthropic lane is composed on an unmeasured claim.** Spec
  §5.2's parenthetical ("maps onto the lane's tiers through its materialiser") was never measured; the tree's own
  materialiser resolves those lanes by model ID. The composer stays as the spec says (inert has no word for
  `class`), its comment names the gap, and the slice 4 plan opens with the headless probe before any writer
  targets such a lane. Ruling S1-R10.
- **D-2822 (2026-09-14)** — **Two record semantics fixed before slice 3 and slice 4 lean on them.** (a) The settle
  keys "has a record" on the EFFORT field's presence, not on any of the seven files — otherwise slice 3's
  `degraded` stamp alone would switch off the `SPAWN_EFFORT` default (ruling S1-R11). (b) On an Anthropic lane
  `workflow=off` stamps `inert=workflow` and composes nothing, because `{"enableWorkflows":false}` is unmeasured;
  slice 4 measures it and clears the stamp (ruling S1-R12).
- **D-2823 (2026-09-14)** — **Slice-0 residuals landed on their own PR.** The F7 docstring returned above
  `runHealth`; `FleetSession.usage`'s docstring names the reviver's carried `stale`; `session-hook.sh`'s per-event
  `tmux display-message` is bounded like the statusline's. The sweep's census-on-refusal stays deferred to its own
  task with a reader.
- **D- (2026-09-15)** — **Task 10 shipped code the brief did not name, because the tip was red.** The
  suites at the tip found two reds: the settle keyed "has an effort field" on `_reg_get`'s exit code, which a
  present-but-unreadable file also returns, so presence is now the filesystem's answer (`[[ -e ]]`, the same
  question `_route_any` asks) and an unreadable effort field journals why the default was suppressed;
  `cmd_route`'s `|| raw=""` swallowed the same distinction and is gone; and `ccd-crosspool.test.ts`'s guard, which
  pinned "no call site can see that rc", now enumerates the two sanctioned readers (`_route_get`, `_route_peek`)
  — a property rewrite whose two enumerated lines are byte-identical, so it proves a count, not a location
  (disclosed). Commit 9fbd70a0; three mutations measured.
- **D- (2026-09-15)** — **The routing check's subagent-key arm is a WARN, not a FAIL.** The live gate found three
  Anthropic lanes carrying `CLAUDE_CODE_SUBAGENT_MODEL` in settings.json — the operator's own 2026-09-07
  subagent-routing floor, older than the record — and the shipped FAIL aborted `ccrc update` before its supervisor
  sweep (`cmd_doctor` returns 1 on any FAIL; `cmd_install` ends with doctor; update dies on that rc). Ruling
  S1-R13: that key WARNs, naming the lanes and the consequence (the record's `subagent` field is overridden there
  until the key is removed); `CLAUDE_CODE_EFFORT_LEVEL` stays a FAIL (none on the fleet). The operator removes the
  three keys once every session carries a record (slice 2/4), and the arm flips back to FAIL then. The same round gave a present-but-unreadable routing field its own
  journal line (`route-unmeasured … could not be read`), so a suppressed default is never silent.

## Self-review against the spec

- §5.1 seven fields, closed vocabularies, three conditions, byte-length note: Task 2 (reader), Task 4 (writer refuses before writing), Task 8 (nothing unrecognised reaches a keystroke), Task 6 (nothing unrecognised reaches an argv). `subagent` from the projected spelling: Task 1.
- §5.2 levers: `--model` on both argvs (Task 6), `/effort` from the record with the persistence hazard measured first (Tasks 7–8, every branch spelled), `--effort` only as Lever B, `--settings` for ultracode/workflows composed only in the form Task 7's arm 3 confirms (Task 8), `CLAUDE_CODE_SUBAGENT_MODEL` in the spawn env on Anthropic lanes (Task 6), never the effort override env (Task 9's census, with a vacuity control), non-Anthropic lanes stamp `inert` by field name — `effort` (unapplied until slice 4's tick) and `workflow` (Task 6); `subagent` there is the lane materialiser's, as §5.2 says. `/model`'s persistence is measured too (Task 7 arm 1b) for slice 4. `compact` is read in slice 6, not here.
- §5.3 the verb, its grant, its journal act, the caps token: Tasks 3, 4, 5. No `--apply`; the coordinator's path types nothing; the previous value is rendered validated or as a byte count, never raw (the log is not a channel). Dispatch and picker writers are slice 4.
- §5.4 relaunch from the fields, never the global constant: Tasks 6 and 8; serviceability and `degraded` are slice 3 (the `degraded` vocabulary is validated here so the field is readable the day slice 3 writes it).
- §7 slice 1 row: fields + validation, settle reads, `--model` both argvs, subagent env, verb + act, caps token + verb list, the five measurements, swap continuity — Tasks 1–10 in that order; gate in Task 10.
- §8 rows: validator (Task 2 Step 5, three mutations each named with what it reds), `subagent`/haiku refusals (Task 2 Step 5, Task 4 Step 5), the grant (Task 5's g11), no `--apply` (Task 4 Step 5), `route` in every vocabulary (Task 3), no effort override env (Task 9), the doctor check (Task 9 Step 5, including the SKIP-versus-PASS reason), `--model` on the retry line (Task 6 Step 5). The `route-v1` omit-on-no-evidence row and `_route_apply_check` rows belong to slice 4.
