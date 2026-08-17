# Stage 2c — The Roster Writes the Wrappers: `ccrc wrappers` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `~/.ccrc/accounts.json` the thing that PRODUCES `~/.local/bin/<id>`, not merely the thing that describes it. Ship `ccrc wrappers` — a converger that writes the wrappers ccrc owns, refuses to damage the ones it does not, and can prove on every run that what it writes is exactly what `ccrc doctor` and `ccrc adopt` read back.

**Architecture:** The wrapper shape already has one READER — `_wrap_parse_shape` in `ccd/ccrc-wrapper-shape`, shared by `ccrc adopt` and `ccrc doctor`. This stage adds the WRITER, and the single most important structural decision is that the writer is never allowed to state the shape a second time in a way that could drift from the reader. So: node emits the text (`shared/wrapper.mjs`), bash judges every file on disk through the reader it already has, and a round-trip test runs the real bash reader over the real node writer's output on every suite run. Ownership is decided by `shared/mark.mjs`'s provenance marker — written in Stage 2a with the note "`verifyMarker` has no caller yet — it exists now because 2b's installer needs it". This is that caller.

**Tech Stack:** bash (`ccd/ccrc`, `ccd/ccrc-wrapper-shape`), dependency-free ESM run by a bare `node` (`shared/*.mjs`, `deploy/*.mjs`), TypeScript (`shared/roster.ts`), vitest (`server/test/`).

## Global Constraints

- **Node floor `>=22.13.0`**, identical across all three engines. Never lower an engines pin to make a suite green.
- **`shared/*.ts` imports NOTHING**, not even `node:*` — the PWA bundles it. `shared/*.mjs` is deploy-side tooling the PWA never imports and MAY import `node:*` (see `shared/mark.mjs`'s header).
- **`shared/*.mjs` and `deploy/*.mjs` must run under a bare `node`**: no build step, no `tsx`, no compiled `dist/`, no npm dependency.
- **No overloaded null at a seam.** Two conditions a caller handles differently must never collapse to one value. Every classification in this plan is explicitly N-valued and every value has its own branch.
- **An adapter may not narrow a distinction it received.**
- **Mutation-table discipline.** A new guard ships WITH a test that goes RED when the guard is deleted or mutated, and the implementer MEASURES that red before/after — a comment claiming a guard is pinned is not evidence. Doctrine: "A comment is a request; a red suite is a mechanism."
- **TDD, red first.** Write the failing test, run it, see it fail for the stated reason, then implement.
- **Wire discipline: additive-only.** Do NOT bump `FLEET_PROTO` (=1). Nothing in this plan touches the wire.
- **Single source of truth.** `server/test/single-definition.test.ts` text-scans four roots and fails the build on a second copy of an enumerated list. Sanctioned duplication (the "two independent locks on one door" pattern — see `shared/generate.mjs`'s `dqEscape` comment) is permitted ONLY when each copy carries a comment naming the others and stating which is stricter.
- **SAFETY — tests use FIXTURE HOMEs only.** No test may read, write, stat or glob the real `$HOME/.local/bin`, `$HOME/.ccrc`, `$HOME/.cc-secrets`, `$HOME/.cc-sessions` or `$HOME/.cc-limits`. `HOME` is the single isolation boundary the whole suite relies on. Harness: `makeCcdHarness(prefix)` (`server/test/ccdWsHelpers.ts`); cleanup in `tmpHelpers.ts`.
- **SAFETY — never read a secret.** Nothing in this stage may open, read, source, stat or hash any file a `secretsFile` names. A `secretsFile` is a PATH that gets embedded in generated text and nothing else. `_wrap_parse_shape`'s header states this rule for the reader; it binds the writer identically. Doctor output is what an operator pastes into a ticket.
- **Run suites in the FOREGROUND, timeout ≥600000ms.** `cd server && ./node_modules/.bin/vitest run test/foo.test.ts`. NEVER bare `npx vitest`.
- **Known load flakes** — re-run IN ISOLATION before calling a real break: `ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`.
- **Deviation ledger.** New deviations continue from D-73 (the last one recorded, in the Stage 2b plan). Number them D-74 onward, globally monotonic. Record each in this plan's `## Deviations found` section AND as a `D-N` comment at the site in source.

---

## Design decisions (settled before Task 1 — implementers do not re-litigate these)

### D1. The writer never restates the shape

`_wrap_parse_shape` (`ccd/ccrc-wrapper-shape:144`) is the one reader. `shared/wrapper.mjs` is the one writer. They are in different languages and cannot share code, so what stops them drifting is Task 3: a test that runs the REAL bash reader over the REAL node writer's output, for every account of a production-shaped roster, and asserts the reader returns exactly the fields the roster put in. If either side changes shape, that test goes red. This is the same mechanism `server/test/gen-accounts.test.ts` uses to keep `deploy/gen-accounts.mjs` in step with `parseRoster`.

### D2. Ownership is the provenance marker, and it is three-valued

`shared/mark.mjs`'s `verifyMarker(text)` answers `'foreign' | 'ccrc-edited' | 'ccrc-unmodified'`. Those three plus `absent` and `unreadable` are the five states a wrapper path can be in, and each gets its own branch. Collapsing `ccrc-edited` into `ccrc-unmodified` would silently destroy an operator's edit; collapsing `foreign` into either would destroy a launcher ccrc never wrote.

### D3. The decision table

Applies ONLY to roster accounts with `exec.kind === "generated"`. **`upstream` and `external` accounts are never written, backed up, moved or removed — by any verb, under any flag.** That is absolute: `upstream` is a 304 MB ELF and `external` is somebody else's launcher.

| on-disk state | default | `--adopt` | `--force` |
|---|---|---|---|
| absent | write | write | write |
| `ccrc-unmodified`, text == staged | no-op (converged) | no-op | no-op |
| `ccrc-unmodified`, text != staged | rewrite (backup first) | rewrite | rewrite |
| `ccrc-edited` | REFUSE | REFUSE | rewrite (backup first) |
| `foreign`, **equivalent** (see D4) | REFUSE, reported as adoptable | rewrite (backup first) | rewrite (backup first) |
| `foreign`, not equivalent | REFUSE | REFUSE | rewrite (backup first) |
| `unreadable` | REFUSE | REFUSE | REFUSE |

**The remedy printed for a non-equivalent `foreign` file must NOT mention `--force`.** Its remedy is "move it aside, or set `exec.kind` to `external` in the roster". Suggesting a clobber is how a mechanical operator destroys a 142-line hand-written launcher; `gpt` on the reference box is exactly that file. This is a guard and Task 6 pins it with a mutation.

`unreadable` refuses even under `--force` because "I could not read it" is not "I know what it is".

### D4. "Equivalent" is judged by the reader, on both sides

For a `foreign` file, bash runs `_wrap_parse_shape` over the ON-DISK file AND over the STAGED file, and compares the two `(target, suffix, secrets)` triples. It does NOT compare the on-disk parse against roster fields. Two reasons: one reader answers for both sides, so there is no second opinion to drift; and the staged file is what would actually be installed, which is the thing the operator is being asked about.

A `foreign` file that `_wrap_parse_shape` rejects outright is never equivalent.

### D5. Node stages, bash mutates

`deploy/gen-wrappers.mjs` validates the roster, writes each generated account's finished text into a STAGING directory bash created, and prints a manifest. It never touches `~/.local/bin`. Every mutation of `~/.local/bin` — write, chmod, backup, rename — happens in `ccd/ccrc`, because that is where the shape reader lives and where the refusals have to be enforced.

### D6. Manifest format

Tab-separated, on stdout, in this order:

```
summary	<total>	<generated>	<upstream>	<external>
wrapper	<id>	<classify>	<equal>
wrapper	<id>	<classify>	<equal>
orphan	<id>
```

- `<classify>` ∈ `absent | unreadable | foreign | ccrc-edited | ccrc-unmodified`
- `<equal>` ∈ `yes | no` — staged text vs on-disk text, byte for byte. Always `no` when the file is absent or unreadable.
- `orphan` — a file in the bin dir that carries a ccrc marker but whose id is not a `generated` roster account. Reported, **never removed** (removal is `ccrc uninstall`'s job, Stage 4).

**EVERY FIELD IS NON-EMPTY BY CONSTRUCTION**, which is what makes `IFS=$'\t' read` safe here. D-71 bans that idiom for records that can carry an empty field — a tab is IFS whitespace, so bash collapses runs of them and every later field shifts left. There is no such field in this record: `id` matched `ID_RE`, and `classify`/`equal`/the record type are literals from closed sets. **If a future field can be empty, split by hand** the way `_check_wrappers`'s roster reader does (`ccd/ccrc-doctor-checks:826`). Bash also asserts it read exactly `<generated>` `wrapper` records, so a truncated manifest is loud.

### D7. `deploy/deploy.sh` does NOT run this

`shared/` and `deploy/` and `ccd/` are already rsynced into `~/ccrc/` on both boxes (`deploy/deploy.sh:345`, `:615`), so the new files ship with no deploy change. But the deploy must NOT generate wrappers: it would mutate `~/.local/bin` on a live fleet host as a side effect of shipping a server build. `ccrc wrappers` is a verb an operator runs, and later a step `ccrc install` calls. Out of scope, deliberately.

### D8. Scope boundary

In scope: the emitter, the validator extraction, the staging CLI, the `ccrc wrappers` verb, doctor's remedy text. **Out of scope** (later Stage 2 slices): `ccrc install`, the single-box installer script, `CCRC_REMOTE_CONTROL` config, the first-run spawn fixes. Do not build them.

---

## File structure

**Create:**
- `shared/wrapper.mjs` — the one emitter. Pure text, no filesystem.
- `shared/wrapper.d.mts` — hand-written types, as `generate.d.mts`/`mark.d.mts` are.
- `shared/roster-json.mjs` — `rosterFromJson`, moved out of `deploy/gen-accounts.mjs` so there is one validator, not two.
- `shared/roster-json.d.mts`
- `deploy/gen-wrappers.mjs` — validate → stage → manifest.
- `server/test/wrapper-generate.test.ts`
- `server/test/wrapper-roundtrip.test.ts` — the anti-drift pin.
- `server/test/gen-wrappers.test.ts`
- `server/test/ccrc-wrappers.test.ts`

**Modify:**
- `shared/roster.ts` — validate `exec.secretsFile` as a path, not merely a string.
- `deploy/gen-accounts.mjs` — mirror that validation; then shrink to a CLI shell around `shared/roster-json.mjs`.
- `ccd/ccrc` — `cmd_wrappers`, its usage line, its dispatch arm.
- `ccd/ccrc-doctor-checks` — remedy text now names real verbs.
- `README.md` — the `ccrc` verb table.
- `server/test/roster.test.ts`, `server/test/gen-accounts.test.ts` — new cases.

---

## Task 1: `secretsFile` becomes a validated path

**Why:** `parseRoster` accepts any string. That string is about to be embedded inside `[ -r "$HOME/<path>" ] && . "$HOME/<path>"`. A `secretsFile` of `x" ; rm -rf ~ ; :"` is a valid roster today and would produce a wrapper that is both an injection and unparseable by `_wrap_parse_shape`. The writer must not be the only thing standing between a roster and that line.

**Files:**
- Modify: `shared/roster.ts:263-271` (the `generated` branch of the exec parser)
- Modify: `deploy/gen-accounts.mjs:157-161` (its mirror of the same check)
- Test: `server/test/roster.test.ts`, `server/test/gen-accounts.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `parseRoster` now rejects an unsafe `secretsFile`. Tasks 2 and 4 rely on a `secretsFile` that reaches them being path-safe — but each keeps its own guard anyway (see Global Constraints, two independent locks).

- [ ] **Step 1: Write the failing tests**

In `server/test/roster.test.ts`, beside the existing `configDirSuffix` rejection cases:

```ts
describe('exec.secretsFile is a path, not merely a string', () => {
  // The value is embedded inside a double-quoted bash string in the generated
  // wrapper (`[ -r "$HOME/<path>" ] && . "$HOME/<path>"`), so the same
  // conservative gate configDirSuffix carries applies here. parseRoster used
  // to require only `typeof === "string"`.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['a double quote', '.cc-secrets/a"b.env'],
    ['a dollar sign', '.cc-secrets/$USER.env'],
    ['a backtick', '.cc-secrets/`id`.env'],
    ['a backslash', '.cc-secrets/a\\b.env'],
    ['a newline', '.cc-secrets/a\nb.env'],
    ['a parent-directory hop', '../.ssh/id_ed25519'],
    ['an absolute path', '/etc/shadow'],
    ['the empty string', ''],
    ['a trailing slash', '.cc-secrets/'],
    ['a space', '.cc-secrets/a b.env'],
  ];
  for (const [what, secretsFile] of cases) {
    it(`rejects ${what}`, () => {
      expect(() => parseRoster(rosterWithSecrets(secretsFile)))
        .toThrow(/exec\.secretsFile/);
    });
  }

  it('accepts the shape every real account uses', () => {
    const r = parseRoster(rosterWithSecrets('.cc-secrets/claude2-oauth.env'));
    const acct = r.accounts.find((a) => a.id === 'claude2');
    expect(acct?.exec).toEqual({ kind: 'generated', secretsFile: '.cc-secrets/claude2-oauth.env' });
  });

  it('still accepts a generated account with no secretsFile at all', () => {
    const r = parseRoster(rosterWithSecrets(undefined));
    expect(r.accounts.find((a) => a.id === 'claude2')?.exec).toEqual({ kind: 'generated' });
  });
});
```

Write `rosterWithSecrets(secretsFile: string | undefined)` as a local helper that returns a minimal valid two-account roster (one `upstream` `claude`, one `generated` `claude2` whose `exec` carries `secretsFile` when it is not `undefined`). Follow the file's existing fixture idiom rather than inventing a new one.

In `server/test/gen-accounts.test.ts`, add the same rejection list to whichever existing case asserts "every roster `parseRoster` rejects is rejected here too" — that test already exists and is the mirror-agreement mechanism; extend its table rather than writing a parallel one.

- [ ] **Step 2: Run them and watch them fail**

```bash
cd server && ./node_modules/.bin/vitest run test/roster.test.ts test/gen-accounts.test.ts
```

Expected: the ten rejection cases fail (no throw); the two acceptance cases pass.

- [ ] **Step 3: Implement in `shared/roster.ts`**

Beside `LABEL_UNSAFE_RE` (`shared/roster.ts:201`):

```ts
/** The conservative gate on `exec.secretsFile`, mirroring the one
 *  `configDirSuffix` carries and for the same reason: the value is embedded
 *  inside a double-quoted bash string in the wrapper `shared/wrapper.mjs`
 *  writes (`[ -r "$HOME/<path>" ] && . "$HOME/<path>"`), where `$`, `` ` ``,
 *  `"` and `\` are all still live to the shell. Letters, digits, `.`, `-`,
 *  `_` and `/` only. Copies of this rule live in `deploy/gen-accounts.mjs`
 *  (which may be stricter than this file, never laxer — see its header) and
 *  in `shared/wrapper.mjs` (the writer's own lock, which protects it against
 *  a caller that never went through this parser). */
const SECRETS_SAFE_RE = /^[A-Za-z0-9._/-]+$/;
```

Replace the body of the `generated` branch (`shared/roster.ts:263-271`):

```ts
    const secretsFile = raw['secretsFile'];
    if (secretsFile !== undefined && typeof secretsFile !== 'string') {
      throw rosterInvalid(
        `account "${id}" has a non-string exec.secretsFile.`,
        `Set exec.secretsFile for account "${id}" in ${ROSTER_PATH} to a string path relative to ` +
        '$HOME, or remove it.',
      );
    }
    // A path, not merely a string. `""` and a trailing "/" both resolve to a
    // directory rather than a file; ".." escapes $HOME; a leading "/" ignores
    // it. Each is rejected by name so the remedy can say which one happened.
    if (
      secretsFile !== undefined
      && (secretsFile === '' || secretsFile.startsWith('/') || secretsFile.endsWith('/')
        || secretsFile.includes('..') || !SECRETS_SAFE_RE.test(secretsFile))
    ) {
      throw rosterInvalid(
        `account "${id}" has an invalid exec.secretsFile ${JSON.stringify(secretsFile)}.`,
        `Set exec.secretsFile for account "${id}" in ${ROSTER_PATH} to a path relative to $HOME ` +
        '(e.g. ".cc-secrets/' + id + '-oauth.env") using only letters, digits, ".", "-", "_" and ' +
        '"/" — never absolute, never containing "..", never ending in "/".',
      );
    }
    return secretsFile !== undefined ? { kind: 'generated', secretsFile } : { kind: 'generated' };
```

The file's throw helper is `throw new RosterError(message, remedy)` — read the surrounding cases (`shared/roster.ts:247`, `:255`, `:265`) and match that call shape exactly; `rosterInvalid` above stands in for it.

- [ ] **Step 4: Mirror it in `deploy/gen-accounts.mjs`**

At `deploy/gen-accounts.mjs:77`, beside `SUFFIX_SAFE_RE`:

```js
/** Mirrors `shared/roster.ts`'s `SECRETS_SAFE_RE`. Kept here rather than
 *  imported for the reason this file's header gives for every other copy: a
 *  bare `node` cannot import the TypeScript. This file may be STRICTER than
 *  `parseRoster`, never laxer. */
const SECRETS_SAFE_RE = /^[A-Za-z0-9._/-]+$/;
```

and extend the `exec.secretsFile` check at `:157-161` with the same four conditions and a `bad(...)` carrying the same remedy shape.

- [ ] **Step 5: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/roster.test.ts test/gen-accounts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Measure the mutation**

Delete the new `if` in `shared/roster.ts`, re-run, and record in your report which test names went red and how many. Restore it. Do the same for the `gen-accounts.mjs` half. If either mutation leaves the suite green, the guard is not pinned and the task is not done.

- [ ] **Step 7: Full suite, then commit**

```bash
cd server && npm run test
git add shared/roster.ts deploy/gen-accounts.mjs server/test/roster.test.ts server/test/gen-accounts.test.ts
git commit -m "fix(roster): a secretsFile is a path, and the parser now says so"
```

---

## Task 2: `shared/wrapper.mjs` — the one emitter

**Files:**
- Create: `shared/wrapper.mjs`, `shared/wrapper.d.mts`
- Test: `server/test/wrapper-generate.test.ts`

**Interfaces:**
- Consumes: Task 1's guarantee that a parsed roster's `secretsFile` is path-safe (but keeps its own lock).
- Produces:
  ```js
  /** @throws {WrapperInvalid} */
  export function generateWrapperBody(account, upstreamId)
  // account: { id, configDirSuffix, execKind, secretsFile }  (secretsFile optional)
  // returns: the UNMARKED wrapper text, ending in exactly one "\n"
  export class WrapperInvalid extends Error {}   // carries `.remedy`
  ```
  Task 5 calls `markGenerated(generateWrapperBody(a, upstreamId))`. Task 3 pins the output against the bash reader.

- [ ] **Step 1: Write the failing test**

`server/test/wrapper-generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { generateWrapperBody, WrapperInvalid } from '../../shared/wrapper.mjs';

const CLAUDE2 = { id: 'claude2', configDirSuffix: '.claude-personal', execKind: 'generated',
  secretsFile: '.cc-secrets/claude2-oauth.env' };
const NOSECRETS = { id: 'plain', configDirSuffix: '.claude-plain', execKind: 'generated' };

describe('generateWrapperBody', () => {
  it('writes the three-line shape when the account has a secrets file', () => {
    expect(generateWrapperBody(CLAUDE2, 'claude')).toBe(
      '#!/usr/bin/env bash\n'
      + '# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.\n'
      + 'export CLAUDE_CONFIG_DIR="$HOME/.claude-personal"\n'
      + '[ -r "$HOME/.cc-secrets/claude2-oauth.env" ] && . "$HOME/.cc-secrets/claude2-oauth.env"\n'
      + 'exec "$HOME/.local/bin/claude" "$@"\n',
    );
  });

  it('omits the secrets line entirely when there is no secrets file', () => {
    const text = generateWrapperBody(NOSECRETS, 'claude');
    expect(text).toBe(
      '#!/usr/bin/env bash\n'
      + '# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.\n'
      + 'export CLAUDE_CONFIG_DIR="$HOME/.claude-plain"\n'
      + 'exec "$HOME/.local/bin/claude" "$@"\n',
    );
    // Not "an empty guard line" — an absent one. A `[ -r "$HOME/" ]` line
    // would parse as a secrets guard naming $HOME itself.
    expect(text).not.toContain('[ -r');
  });

  it('refuses to write anything for an account ccrc does not own', () => {
    for (const execKind of ['upstream', 'external']) {
      expect(() => generateWrapperBody({ ...NOSECRETS, execKind }, 'claude'))
        .toThrow(WrapperInvalid);
    }
  });

  it('refuses a suffix, secrets path or upstream id that could break out of its quoting', () => {
    const hostile = ['a"b', 'a$b', 'a`b', 'a\\b', 'a\nb'];
    for (const h of hostile) {
      expect(() => generateWrapperBody({ ...NOSECRETS, configDirSuffix: `.${h}` }, 'claude'))
        .toThrow(WrapperInvalid);
      expect(() => generateWrapperBody({ ...NOSECRETS, secretsFile: `.cc-secrets/${h}` }, 'claude'))
        .toThrow(WrapperInvalid);
    }
    expect(() => generateWrapperBody(NOSECRETS, 'not a legal id')).toThrow(WrapperInvalid);
    // The account's own id is never embedded in the text, but an emitter that
    // cannot name the account it refused is useless in a manifest.
    expect(() => generateWrapperBody({ ...NOSECRETS, id: 'NOT-AN-ID' }, 'claude'))
      .toThrow(/NOT-AN-ID/);
  });

  it('never escapes its way past the reader', () => {
    // The alternative to refusing is escaping, and escaping is the bug: a
    // backslash-escaped suffix produces a line `_wrap_parse_shape` rejects, so
    // the writer would emit files the reader calls foreign. Refusal is the
    // only answer that keeps the two in step.
    expect(() => generateWrapperBody({ ...NOSECRETS, configDirSuffix: '.a"b' }, 'claude'))
      .toThrow(WrapperInvalid);
  });

  it('carries a remedy on every refusal', () => {
    try {
      generateWrapperBody({ ...NOSECRETS, execKind: 'external' }, 'claude');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(WrapperInvalid);
      expect(typeof (e as { remedy?: unknown }).remedy).toBe('string');
      expect((e as { remedy: string }).remedy.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/wrapper-generate.test.ts
```

Expected: FAIL — cannot resolve `../../shared/wrapper.mjs`.

- [ ] **Step 3: Implement `shared/wrapper.mjs`**

```js
// shared/wrapper.mjs — THE ACCOUNT WRAPPER WRITER. One account in, the exact
// text of `~/.local/bin/<id>` out. Its counterpart is the READER,
// `_wrap_parse_shape` in `ccd/ccrc-wrapper-shape`, and the two are in
// different languages with no way to share code — so what keeps them in step
// is `server/test/wrapper-roundtrip.test.ts`, which runs the real bash reader
// over this function's real output on every suite run. Read that test before
// changing a single byte of the template below; a change here that the reader
// does not accept turns every wrapper on every box into a file ccrc calls
// foreign and refuses to touch.
//
// Plain, dependency-free ESM, like `shared/generate.mjs` and `shared/mark.mjs`
// and for the same reason: a bare `node` runs this, with no build step.
//
// ── WHY IT REFUSES RATHER THAN ESCAPES ────────────────────────────────────
// `shared/generate.mjs` escapes (`dqEscape`) because its output is bash that
// only bash reads. This file's output is bash that a PARSER also reads, and
// that parser (`_wrap_parse_shape`) matches by reconstructing the exact line
// it expects and comparing strings whole. A backslash-escaped suffix produces
// a line the reader rejects — so escaping here would emit a file ccrc itself
// classifies as foreign and then refuses to manage. Refusal is the only
// answer that keeps writer and reader in agreement, and it is loud.
//
// ── IT NEVER READS A SECRET ───────────────────────────────────────────────
// `secretsFile` is a PATH that gets embedded and nothing else. This module
// does not open, stat, source or hash the file it names. Same rule the reader
// states in its own header, for the same reason: doctor's output is what an
// operator pastes into a ticket.

/** `shared/roster.ts`'s `ID_RE`. A third copy (roster.ts, gen-accounts.mjs,
 *  ccrc-wrapper-shape's WRAPPER_ID_RE) and a deliberate one — this function
 *  consumes its argument STRUCTURALLY, exactly as `generateAccountsSh` does,
 *  with no runtime proof it ever passed through `parseRoster`. This is the
 *  writer's own lock on its own door. */
const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** `shared/roster.ts`'s `SUFFIX_SAFE_RE`, and `ccrc-wrapper-shape`'s
 *  `WRAPPER_SUFFIX_SAFE_RE` — the reader's copy is the one that matters here,
 *  because a suffix this accepts and the reader does not is a wrapper ccrc
 *  writes and then disowns. They are the same expression on purpose. */
const SUFFIX_SAFE_RE = /^\.[A-Za-z0-9._-]+$/;

/** `shared/roster.ts`'s `SECRETS_SAFE_RE` (Task 1). */
const SECRETS_SAFE_RE = /^[A-Za-z0-9._/-]+$/;

export class WrapperInvalid extends Error {}

/** @param {string} message @param {string} remedy @returns {never} */
function bad(message, remedy) {
  const e = new WrapperInvalid(message);
  e.remedy = remedy;
  throw e;
}

/**
 * The finished, UNMARKED text of one generated account's wrapper. The caller
 * runs it through `markGenerated` (shared/mark.mjs) to stamp ownership;
 * keeping the two apart is what lets the round-trip test check the body and
 * the marked file separately.
 *
 * Ends in exactly one newline — a shell script whose last line has no
 * terminator is legal but every tool that reads it line-wise has to special-
 * case the tail, `_wrap_parse_shape`'s `mapfile` included.
 *
 * @param {{id: string, configDirSuffix: string, execKind: string, secretsFile?: string}} account
 * @param {string} upstreamId
 * @returns {string}
 */
export function generateWrapperBody(account, upstreamId) {
  const id = account.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    bad(`cannot write a wrapper for an account whose id ${JSON.stringify(id)} is not a legal id.`,
      'Rename it to match ^[a-z][a-z0-9-]{0,31}$ — it becomes a filename under ~/.local/bin.');
  }
  // The ONE kind ccrc owns. `upstream` is the Claude Code binary and
  // `external` is somebody else's launcher; writing either is data loss, so
  // this function cannot be talked into producing text for them at all.
  if (account.execKind !== 'generated') {
    bad(`account "${id}" has exec.kind ${JSON.stringify(account.execKind)}, and ccrc writes a `
      + 'wrapper only for "generated".',
      `Leave $HOME/.local/bin/${id} alone — ccrc never writes an upstream or external account.`);
  }
  if (typeof upstreamId !== 'string' || !ID_RE.test(upstreamId)) {
    bad(`the roster's upstream account id ${JSON.stringify(upstreamId)} is not a legal id, so `
      + `"${id}"'s wrapper has nothing to exec.`,
      'Fix the id of the account whose exec.kind is "upstream" in ~/.ccrc/accounts.json.');
  }
  const suffix = account.configDirSuffix;
  if (typeof suffix !== 'string' || suffix === '.' || !SUFFIX_SAFE_RE.test(suffix)) {
    bad(`account "${id}" has a configDirSuffix ${JSON.stringify(suffix)} that cannot be written `
      + 'into a double-quoted bash string.',
      `Set configDirSuffix for "${id}" to a dot-prefixed name under $HOME (e.g. ".${id}") using `
      + 'only letters, digits, ".", "-" and "_".');
  }
  const secrets = account.secretsFile;
  if (secrets !== undefined) {
    if (typeof secrets !== 'string' || secrets === '' || secrets.startsWith('/')
      || secrets.endsWith('/') || secrets.includes('..') || !SECRETS_SAFE_RE.test(secrets)) {
      bad(`account "${id}" has an exec.secretsFile ${JSON.stringify(secrets)} that cannot be `
        + 'written into a double-quoted bash string.',
        `Set exec.secretsFile for "${id}" to a path relative to $HOME (e.g. `
        + `".cc-secrets/${id}-oauth.env") using only letters, digits, ".", "-", "_" and "/".`);
    }
  }

  // EVERY LINE BELOW IS MATCHED BYTE FOR BYTE BY `_wrap_parse_shape`. The
  // comment line is the one exception: the reader strips blank and
  // comment-only lines before counting, which is what lets a generated
  // wrapper carry both this notice and the provenance marker.
  const secretsLine = secrets === undefined
    ? ''
    : `[ -r "$HOME/${secrets}" ] && . "$HOME/${secrets}"\n`;
  return '#!/usr/bin/env bash\n'
    + '# Generated from ~/.ccrc/accounts.json. Do not edit — `ccrc wrappers` rewrites it.\n'
    + `export CLAUDE_CONFIG_DIR="$HOME/${suffix}"\n`
    + secretsLine
    + `exec "$HOME/.local/bin/${upstreamId}" "$@"\n`;
}
```

- [ ] **Step 4: Write `shared/wrapper.d.mts`**

Match the style of `shared/generate.d.mts` and `shared/mark.d.mts` exactly — read both first.

- [ ] **Step 5: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/wrapper-generate.test.ts
```

Expected: PASS.

- [ ] **Step 6: Measure the mutations**

One at a time, restoring between each; record which tests went red and how many:
1. Change `execKind !== 'generated'` to `execKind === 'nonsense'`.
2. Delete the `SUFFIX_SAFE_RE` check.
3. Delete the `SECRETS_SAFE_RE` check.
4. Emit the secrets line unconditionally (with an empty path when absent).

Any mutation that leaves the suite green means that guard is not pinned — add the case before moving on.

- [ ] **Step 7: Typecheck, full suite, commit**

```bash
cd server && npm run test
git add shared/wrapper.mjs shared/wrapper.d.mts server/test/wrapper-generate.test.ts
git commit -m "feat(wrapper): the roster can state a wrapper's text, and refuses to state a broken one"
```

---

## Task 3: the round-trip pin — the bash reader accepts exactly what the writer writes

**Why:** This is the mechanism the whole stage rests on. Without it, `shared/wrapper.mjs` and `ccd/ccrc-wrapper-shape` are two independent statements of one shape, and the first divergence ships silently as "ccrc refuses to manage the wrappers ccrc wrote".

**Files:**
- Create: `server/test/wrapper-roundtrip.test.ts`

**Interfaces:**
- Consumes: `generateWrapperBody` (Task 2), `markGenerated` (`shared/mark.mjs`), `ccd/ccrc-wrapper-shape`'s `_wrap_parse_shape`.
- Produces: nothing importable. It is a gate.

- [ ] **Step 1: Write the test**

`server/test/wrapper-roundtrip.test.ts`. It must run the REAL bash file, not a re-implementation:

```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { markGenerated } from '../../shared/mark.mjs';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SHAPE_LIB = new URL('../../ccd/ccrc-wrapper-shape', import.meta.url).pathname;

/** Runs the real `_wrap_parse_shape` over `text` and returns the four fields
 *  it prints. Sourcing the shipped library rather than restating its rules is
 *  the entire point of this file. */
function parseShape(text: string): { ok: string; target: string; suffix: string; secrets: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ccrc-roundtrip-'));
  try {
    const f = join(dir, 'w');
    writeFileSync(f, text);
    const out = execFileSync('bash', ['-c',
      `. "$1" && _wrap_parse_shape "$2"`, 'bash', SHAPE_LIB, f], { encoding: 'utf8' });
    const [ok = '', target = '', suffix = '', secrets = ''] = out.replace(/\n$/, '').split('\t');
    return { ok, target, suffix, secrets };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A production-shaped roster: the reference box's real spread of accounts —
// with and without a secrets file, ids that are strict prefixes of one another,
// and a suffix that is not derived from the id.
const ACCOUNTS = [
  { id: 'claude2', configDirSuffix: '.claude-personal', execKind: 'generated',
    secretsFile: '.cc-secrets/claude2-oauth.env' },
  { id: 'claude-corp', configDirSuffix: '.claude-corp', execKind: 'generated',
    secretsFile: '.cc-secrets/claude-corp-oauth.env' },
  { id: 'claude-dev0', configDirSuffix: '.claude-dev0', execKind: 'generated',
    secretsFile: '.cc-secrets/claude-dev0-oauth.env' },
  { id: 'plain', configDirSuffix: '.claude-plain', execKind: 'generated' },
  { id: 'x', configDirSuffix: '.x_1-2.3', execKind: 'generated', secretsFile: 'a/b/c.env' },
] as const;

describe('the wrapper the writer writes is the wrapper the reader reads', () => {
  for (const a of ACCOUNTS) {
    it(`round-trips ${a.id} unmarked`, () => {
      const r = parseShape(generateWrapperBody(a, 'claude'));
      expect(r.ok).toBe('ok');
      expect(r.target).toBe('claude');
      expect(r.suffix).toBe(a.configDirSuffix);
      expect(r.secrets).toBe((a as { secretsFile?: string }).secretsFile ?? '');
    });

    it(`round-trips ${a.id} once the provenance marker is stamped on`, () => {
      // The marker is a comment line inserted at line 2, and the reader strips
      // comment lines before counting significant ones. If that ever stops
      // being true, every wrapper ccrc installs becomes foreign to ccrc.
      const r = parseShape(markGenerated(generateWrapperBody(a, 'claude')));
      expect(r.ok).toBe('ok');
      expect(r.target).toBe('claude');
      expect(r.suffix).toBe(a.configDirSuffix);
      expect(r.secrets).toBe((a as { secretsFile?: string }).secretsFile ?? '');
    });
  }

  it('the marked text still verifies as ccrc-unmodified', async () => {
    const { verifyMarker } = await import('../../shared/mark.mjs');
    expect(verifyMarker(markGenerated(generateWrapperBody(ACCOUNTS[0], 'claude'))))
      .toBe('ccrc-unmodified');
  });

  it('a wrapper for a DIFFERENT upstream is read back with that upstream', () => {
    // The reader captures the exec target without judging it; the writer must
    // put the roster's upstream there and nothing else.
    expect(parseShape(generateWrapperBody(ACCOUNTS[3], 'cc')).target).toBe('cc');
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd server && ./node_modules/.bin/vitest run test/wrapper-roundtrip.test.ts
```

Expected: PASS on the first run, because Tasks 2's template was written against the reader. **If it does not pass, the template is wrong and the template is what changes — never the reader.** Report any discrepancy in your report as a deviation.

- [ ] **Step 3: Measure that it is a real pin**

Make each of these one-character-class changes to `shared/wrapper.mjs`'s template, run this file, record the result, restore:
1. `export CLAUDE_CONFIG_DIR=` → `export CLAUDE_CONFIG_DIR =`
2. `exec "$HOME/.local/bin/...` → `exec "$HOME/bin/...`
3. `[ -r "$HOME/...` → `[ -f "$HOME/...`
4. drop the trailing newline

All four must go red here. A mutation that stays green means this file is decorative — say so in your report rather than moving on.

- [ ] **Step 4: Commit**

```bash
git add server/test/wrapper-roundtrip.test.ts
git commit -m "test(wrapper): the reader and the writer are pinned to one shape, in bash and in node"
```

---

## Task 4: `shared/roster-json.mjs` — one validator, two callers

**Why:** Task 5 needs a validated roster from JSON under a bare `node`. That validator exists once, inside `deploy/gen-accounts.mjs`, un-exported, with a header explaining that importing the module RUNS it. Copying it is the exact drift Stage 2a was fought to kill; the alternative is to move it.

**Files:**
- Create: `shared/roster-json.mjs`, `shared/roster-json.d.mts`
- Modify: `deploy/gen-accounts.mjs` — becomes the CLI shell
- Test: `server/test/gen-accounts.test.ts` (existing; must stay green — it IS the protection for this move)

**Interfaces:**
- Consumes: Task 1's `SECRETS_SAFE_RE` mirror, which moves with the code.
- Produces:
  ```js
  export class RosterInvalid extends Error {}   // carries `.remedy`
  /** @throws {RosterInvalid} */
  export function rosterFromJson(json)
  // returns { version, accounts, homeAble, byIdLengthDesc, upstreamId }
  // each account: { id, label, configDirSuffix, homeAble, telemetry, hue, execKind, secretsFile }
  ```
  `secretsFile` is `undefined` when absent. Task 5 reads `execKind` and `secretsFile`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/gen-accounts.test.ts` (do not create a new file — this belongs beside the mirror-agreement cases it depends on):

```ts
describe('rosterFromJson is importable, and carries the fields the wrapper writer needs', () => {
  it('returns execKind and secretsFile per account', async () => {
    const { rosterFromJson } = await import('../../shared/roster-json.mjs');
    const r = rosterFromJson(JSON.parse(readFileSync(MIGRATION_ROSTER, 'utf8')));
    const byId = new Map(r.accounts.map((a: { id: string }) => [a.id, a]));
    expect(byId.get('claude')?.execKind).toBe('upstream');
    expect(byId.get('claude')?.secretsFile).toBeUndefined();
    expect(byId.get('claude2')?.execKind).toBe('generated');
    expect(byId.get('claude2')?.secretsFile).toBe('.cc-secrets/claude2-oauth.env');
    expect(byId.get('gpt')?.execKind).toBe('external');
    expect(r.upstreamId).toBe('claude');
  });

  it('importing it does NOT run a CLI', async () => {
    // deploy/gen-accounts.mjs sets process.exitCode on import by design. The
    // extracted module must not, or every consumer inherits its exit status.
    const before = process.exitCode;
    await import('../../shared/roster-json.mjs');
    expect(process.exitCode).toBe(before);
  });
});
```

The file has no `MIGRATION_ROSTER` constant today; it spells the path inline at `server/test/gen-accounts.test.ts:198` as `path.join(ccrcRoot, 'deploy', 'accounts.migration.json')`, using the existing `ccrcRoot`. Either reuse that expression or lift it to a constant both sites share — but do not introduce a second, differently-rooted spelling of the path.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts
```

Expected: FAIL — cannot resolve `../../shared/roster-json.mjs`.

- [ ] **Step 3: Move the code**

Create `shared/roster-json.mjs` holding, MOVED VERBATIM and not rewritten: `ID_RE`, `SUFFIX_SAFE_RE`, `SECRETS_SAFE_RE`, `LABEL_UNSAFE_RE`, `EXEC_KINDS`, `HUES`, `RosterInvalid`, `bad`, `isPlainObject`, `checkAccount`, `assignHues`, `rosterFromJson`. Export `RosterInvalid` and `rosterFromJson`.

Two changes only, both required and both stated in the new file's header:
1. `checkAccount` also returns `secretsFile: exec['secretsFile']` (today it validates the field and drops it — the emitter needs it).
2. `deploy/gen-accounts.mjs`'s long header paragraphs explaining WHY the validator exists and why it may be stricter than `parseRoster` but never laxer move WITH the code. They are the file's contract, not decoration for its old location. Leave a short pointer behind in `gen-accounts.mjs`.

`deploy/gen-accounts.mjs` keeps only: the import block, `main(argv)`, and `process.exitCode = main(process.argv)`.

- [ ] **Step 4: Write `shared/roster-json.d.mts`**

Match `shared/generate.d.mts`'s style.

- [ ] **Step 5: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/gen-accounts.test.ts test/roster.test.ts
```

Expected: PASS, **including every pre-existing case**. The existing byte-agreement and rejection-parity cases are what prove the move changed no behaviour; if any of them changed, the move was not a move.

- [ ] **Step 6: Check `single-definition`**

```bash
cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts
```

Expected: PASS. If it fails, a moved constant now reads as a second copy — resolve by deleting the copy that no longer has a caller, never by loosening the scan.

- [ ] **Step 7: Full suite, commit**

```bash
cd server && npm run test
git add shared/roster-json.mjs shared/roster-json.d.mts deploy/gen-accounts.mjs server/test/gen-accounts.test.ts
git commit -m "refactor(roster): the JSON validator moves where a second reader can use it"
```

---

## Task 5: `deploy/gen-wrappers.mjs` — validate, stage, report

**Files:**
- Create: `deploy/gen-wrappers.mjs`
- Test: `server/test/gen-wrappers.test.ts`

**Interfaces:**
- Consumes: `rosterFromJson` (Task 4), `generateWrapperBody` (Task 2), `markGenerated`/`verifyMarker` (`shared/mark.mjs`).
- Produces the CLI Task 6 drives:
  ```
  node deploy/gen-wrappers.mjs <accounts.json> <bin-dir> <staging-dir>
  ```
  Writes `<staging-dir>/<id>` (mode 0755) for every `generated` account; prints the D6 manifest to stdout; diagnostics to stderr. Exit 0 = manifest is complete; 1 = the roster is invalid or a staged write failed (NOTHING is printed to stdout in that case); 2 = usage.

- [ ] **Step 1: Write the failing test**

`server/test/gen-wrappers.test.ts`. Drive the CLI as a subprocess, exactly as `gen-accounts.test.ts` does, and build every fixture under a `mkdtemp` directory. **No test in this file may reference `process.env.HOME` or any path under the real home.**

Cases, each its own `it`:

1. **A fresh box.** Bin dir empty. Manifest: `summary\t5\t3\t1\t1` for the migration roster (5 accounts: 1 upstream, 3 generated, 1 external), then three `wrapper` records all `absent\tno`, no `orphan` records. Each staged file exists, is mode 0755, and its text equals `markGenerated(generateWrapperBody(...))` computed in-process.
2. **A converged box.** Pre-write each staged text into the bin dir. Every record is `ccrc-unmodified\tyes`.
3. **A roster change.** Pre-write a marked wrapper generated for a DIFFERENT suffix. Record is `ccrc-unmodified\tno`.
4. **A hand-edited ccrc file.** Pre-write a marked wrapper, then append a line. Record is `ccrc-edited\tno`.
5. **A hand-written file.** Pre-write a wrapper with no marker line. Record is `foreign\tno`.
6. **An unreadable file.** Pre-write one and `chmodSync(f, 0o000)`. Record is `unreadable\tno`. Skip this case when the test runs as root (root reads anything) — detect with `process.getuid?.() === 0` and `it.skipIf`.
7. **An orphan.** Put a marked, generated-shape file at `<bin>/leftover` with no roster entry. Manifest carries `orphan\tleftover`, and `leftover` is still on disk afterwards.
8. **Not an orphan.** An UNMARKED file at `<bin>/somethingelse` produces no `orphan` record — ccrc only claims what it marked.
9. **`upstream` and `external` are never staged.** `<staging>/claude` and `<staging>/gpt` do not exist. Assert by listing the staging directory and comparing the whole set, not by checking two names.
10. **An invalid roster.** A roster with two upstream accounts: exit 1, stdout EMPTY, stderr names the problem and carries a `remedy:` line.
11. **An unwritable staging dir.** exit 1, stdout empty.
12. **Usage.** No args / four args: exit 2.
13. **The manifest has no empty fields.** Split every line on `\t` and assert no field is the empty string — the property D6 says makes `IFS=$'\t' read` safe in Task 6.
14. **A control byte in a roster id** cannot reach the manifest: such a roster is rejected by `rosterFromJson` at exit 1 (assert it, so the manifest's "id is `ID_RE`-shaped" premise is a measured fact and not an assumption).

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/gen-wrappers.test.ts
```

- [ ] **Step 3: Implement**

Header must state: what it writes and where; that it NEVER touches the bin dir; that stdout is the manifest and stderr is diagnostics; the manifest grammar from D6 including the no-empty-field property and what to do if that ever stops holding; and that a `secretsFile` is a path it embeds and never opens.

Shape:

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { rosterFromJson, RosterInvalid } from '../shared/roster-json.mjs';
import { generateWrapperBody, WrapperInvalid } from '../shared/wrapper.mjs';
import { markGenerated, verifyMarker } from '../shared/mark.mjs';

/** Reads an existing wrapper. FIVE outcomes, never four: `absent` and
 *  `unreadable` are different facts about the box and an operator does
 *  different things about them, so they do not share a value. */
function classify(path, staged) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { classify: e && e.code === 'ENOENT' ? 'absent' : 'unreadable', equal: 'no' };
  }
  return { classify: verifyMarker(text), equal: text === staged ? 'yes' : 'no' };
}
```

`main(argv)`:
1. Arity check → 2.
2. Read + `JSON.parse` + `rosterFromJson` → 1 on failure, printing `e.message` and, for a `RosterInvalid`/`WrapperInvalid`, `gen-wrappers: remedy: ${e.remedy}`.
3. For each account with `execKind === 'generated'`: `markGenerated(generateWrapperBody(a, roster.upstreamId))`, write to `<staging>/<id>`, `chmodSync(0o755)`. Any throw → 1.
4. Classify each against `<bin-dir>/<id>`.
5. Scan `<bin-dir>` for orphans: a regular file whose name matches `ID_RE`, is not a `generated` roster id, is readable, and whose text `verifyMarker` does not call `'foreign'`. A file that cannot be read is NOT an orphan — silence beats a claim about a file nobody read.
6. Build the whole manifest string, then write it once. Nothing reaches stdout until every stage has succeeded — `deploy/gen-accounts.mjs`'s own rule, and for the same reason: a half-written manifest is worse than none.

- [ ] **Step 4: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/gen-wrappers.test.ts
```

- [ ] **Step 5: Measure the mutations**

Restore between each; record which tests went red:
1. `classify` returns `'absent'` for every read failure (collapses `unreadable`).
2. `equal` is computed as `text.trim() === staged.trim()`.
3. The orphan scan drops its `verifyMarker` gate (every file becomes an orphan).
4. Stage the `external` accounts too.
5. The manifest is written incrementally instead of at the end (assert case 10 catches it: stdout must be empty on a failed run).

- [ ] **Step 6: Full suite, commit**

```bash
cd server && npm run test
git add deploy/gen-wrappers.mjs server/test/gen-wrappers.test.ts
git commit -m "feat(wrappers): a box can state, without touching anything, what its wrappers should be"
```

---

## Task 6: `ccrc wrappers` — the converger

**Files:**
- Modify: `ccd/ccrc` — `cmd_wrappers`, `usage()`, the dispatch `case`
- Modify: `README.md` — the `ccrc` verb list
- Test: `server/test/ccrc-wrappers.test.ts`

**Interfaces:**
- Consumes: `deploy/gen-wrappers.mjs` (Task 5), `_wrap_parse_shape` / `WRAPPER_BIN_DIR` / `WRAPPER_ID_RE` (`ccd/ccrc-wrapper-shape`), `_ccrc_die` / `_ccrc_usage_die` / `CCRC_HERE` (`ccd/ccrc`).
- Produces: `ccrc wrappers [--dry-run] [--adopt] [--force]`. Exit 0 = converged, nothing refused. 1 = something was refused, or a write failed. 2 = usage.

- [ ] **Step 1: Write the failing test**

`server/test/ccrc-wrappers.test.ts`, modelled on `server/test/ccrc-cli.test.ts`'s harness (read it first — it already knows how to run `ccd/ccrc` against a fixture HOME). **Every case sets `HOME` to a `mkdtemp` directory. No case may touch the real home.**

Cases:

1. **Fresh box writes.** Empty `$HOME/.local/bin`, roster with 3 generated accounts → exit 0; three files exist, each mode 0755, each byte-identical to `markGenerated(generateWrapperBody(...))`; stdout names each as written.
2. **`$HOME/.local/bin` does not exist at all** → created, mode 0755, then written. (ccrc is the installer here; a missing bin dir is a fresh box, not an error.)
3. **Second run is a no-op.** Re-run case 1 → exit 0, stdout says converged, and every file's mtime is unchanged. Assert on mtime, not on the message — the message is what a rewrite would also print.
4. **Roster changed, ccrc-owned file rewritten.** Change a suffix in the roster → exit 0, file rewritten, and a backup exists matching `<id>.pre-ccrc-*` whose content is the OLD text.
5. **`ccrc-edited` refuses.** Append a line to an owned wrapper → exit 1, file byte-unchanged, stdout names it and prints a remedy.
6. **`--force` rewrites an edited file, after a backup.** exit 0, backup holds the edited text.
7. **`foreign` + equivalent refuses by default, and says it is adoptable.** Hand-write a wrapper with the same `(target, suffix, secrets)` but a different comment → exit 1, file unchanged, stdout mentions `--adopt`.
8. **`--adopt` takes it over.** exit 0, file is now the staged text, backup holds the hand-written original.
9. **`foreign` + NOT equivalent refuses under `--adopt` too.** A wrapper pointing at a different suffix → exit 1 with and without `--adopt`, file unchanged.
10. **THE GUARD: the remedy for a non-equivalent foreign file must not mention `--force`.** Assert `expect(stdout).not.toMatch(/--force/)` for case 9's run. A separate `it`, named so the reason survives.
11. **A bespoke launcher is never clobbered by default.** Put a 40-line script that sets `CLAUDE_CONFIG_DIR` in an unrecognised shape at `<bin>/<generated-id>` → exit 1, file byte-identical afterwards.
12. **`upstream` and `external` are never touched, under any flag.** Put a sentinel file at `<bin>/claude` and `<bin>/gpt`; run with `--force --adopt`; assert both are byte-identical and no backup of either exists. Run this for all three flag combinations.
13. **`--dry-run` writes nothing.** Against case 1's fresh box: exit 0, no file created, no backup created, and stdout describes what it would do.
14. **`--dry-run` still refuses.** Against case 5's edited file: exit 1.
15. **Orphans are reported, never removed.** exit 0 (an orphan is a WARN-class fact, not a refusal), the file still exists, stdout names it.
16. **A truncated manifest is loud.** Stub `gen-wrappers.mjs` on the resolved path with one that prints a `summary` claiming 3 and only one `wrapper` record → exit 1 naming the mismatch. (If stubbing the sibling is impractical in the harness, drive the same condition through a roster whose node run is made to fail, and say so in your report.)
17. **Node absent** → exit 1 with a remedy naming node, not a bash syntax error.
18. **Usage:** an unknown flag → exit 2.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts
```

- [ ] **Step 3: Implement `cmd_wrappers`**

Place it after `cmd_status` and before `cmd_adopt`, matching the file's existing shape. Requirements, each of which has a test above:

- Parse flags with `ccrc-adopt:95-103`'s idiom: `--dry-run`, `--adopt`, `--force`, `-h|--help`, anything else → `_ccrc_usage_die`.
- Source `ccrc-wrapper-shape` through `$CCRC_HERE` and die with the same "is this a complete ccrc install?" wording `cmd_adopt` uses if it is missing.
- Require `node`; `_ccrc_die` with a remedy naming it if absent.
- `mkdir -p "$WRAPPER_BIN_DIR"` (mode 0755) — a fresh box has no `~/.local/bin`.
- `STAGING="$(mktemp -d)"`, with `trap 'rm -rf "$STAGING"' EXIT` set BEFORE anything is written into it.
- Run `node "$CCRC_HERE/../deploy/gen-wrappers.mjs" "$HOME/.ccrc/accounts.json" "$WRAPPER_BIN_DIR" "$STAGING"`, capturing stdout. Non-zero exit → `_ccrc_die`, passing node's stderr through; the roster's own remedy is the useful message and must not be swallowed.
- Read the manifest with `IFS=$'\t' read -r kind a b c`, safe because D6 guarantees no empty field. **Put D6's reasoning in a comment at the read site, in the register `ccrc-adopt:239-253` and `ccrc-doctor-checks:945-960` already use, and say what to do if a future field can be empty.**
- Assert the `wrapper` record count equals the summary's generated count; mismatch → `_ccrc_die`.
- Apply D3's table. For the `foreign` branch, compute equivalence per D4: `_wrap_parse_shape "$WRAPPER_BIN_DIR/$id"` and `_wrap_parse_shape "$STAGING/$id"`, compare the two triples; a `no` from either side means not equivalent.
- Backup before any overwrite: `cp -p` to `$WRAPPER_BIN_DIR/<id>.pre-ccrc-<UTC>` where `<UTC>` is `date -u +%Y%m%dT%H%M%SZ`. A `.` in the name keeps the backup out of `WRAPPER_ID_RE`, so neither adopt nor doctor ever mistakes it for an account — say so in a comment; that is load-bearing, not tidy.
- Write atomically: staged file → `$WRAPPER_BIN_DIR/.<id>.tmp.$$` → `chmod 0755` → `mv -f`. `deploy/deploy.sh`'s `install_atomic` discipline; a wrapper that is half-written is an account that cannot start a session.
- Print one line per account, plus a final summary counting written / converged / refused / orphaned. Every refusal prints its own `remedy:` line on the NEXT line, matching doctor's contract (`ccd/ccrc:52-61`).
- Return 1 if anything was refused, else 0.

- [ ] **Step 4: Run the tests**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-wrappers.test.ts
```

- [ ] **Step 5: Wire up usage and dispatch**

Add `wrappers` to `usage()` and to the `case "$VERB"` block at `ccd/ccrc:990-996`. Check whether `server/test/ccrc-cli.test.ts` pins the usage text or the verb list — if it does, extend that assertion in the same commit rather than leaving it stale.

- [ ] **Step 6: Measure the mutations**

Restore between each; record which tests went red and how many:
1. Delete the `upstream`/`external` skip so every roster account is written.
2. Make `ccrc-edited` fall through to the rewrite branch.
3. Make `--adopt` also accept a non-equivalent foreign file.
4. Add `--force` to the non-equivalent foreign remedy text (case 10 must go red).
5. Drop the backup before an overwrite.
6. Replace the atomic write with a direct `>` redirect (case: assert on the tmp-then-rename by checking no `.tmp.` file survives — if no test catches this, add one).
7. Drop the manifest record-count assertion.

- [ ] **Step 7: README**

Add `wrappers` to the README's `ccrc` verb table, one line, in the register the surrounding entries use. State the one thing an operator most needs: it writes only what ccrc marked as its own, and refuses everything else.

- [ ] **Step 8: Full suite, commit**

```bash
cd server && npm run test
git add ccd/ccrc README.md server/test/ccrc-wrappers.test.ts server/test/ccrc-cli.test.ts
git commit -m "feat(ccrc): the roster writes the wrappers, and refuses to write over anything else"
```

---

## Task 7: doctor's remedies name verbs that exist

**Why:** `_check_wrappers` tells an operator to run `bash ccd/ccrc-adopt`, which assumes a git checkout. On a deployed box there is none, and `ccrc adopt` has been a real verb since Stage 2b. Now that `ccrc wrappers` exists, the remedy for a missing wrapper is a command rather than a paragraph. Carried as a deferred minor from Stage 2b; this is where it is paid.

**Files:**
- Modify: `ccd/ccrc-doctor-checks` — every `bash ccd/ccrc-adopt` occurrence, and the remedy at `:864-865` and `:1011`
- Test: `server/test/ccrc-doctor.test.ts`

**Interfaces:**
- Consumes: `ccrc wrappers` and `ccrc adopt` exist as verbs.
- Produces: nothing importable.

- [ ] **Step 1: Find every occurrence**

```bash
grep -n "ccd/ccrc-adopt" ccd/ccrc-doctor-checks ccd/ccrc
```

- [ ] **Step 2: Write the failing test**

In `server/test/ccrc-doctor.test.ts`, beside the existing remedy-text assertions:

```ts
it('never tells a deployed box to run a script from a checkout it does not have', () => {
  const text = readFileSync(CHECKS_SRC, 'utf8');
  // `ccrc adopt` execs ccrc-adopt where it ships; a remedy naming a repo-
  // relative path is an instruction only a developer can follow, and doctor's
  // whole job is the box that is not a developer's.
  expect(text).not.toMatch(/bash ccd\/ccrc-adopt/);
});

it('tells an operator with a missing wrapper which verb writes one', () => {
  // The a-only side of the roster/disk difference used to end in a paragraph
  // about what an account is. It is now a command.
  expect(readFileSync(DOCTOR_CHECKS, 'utf8')).toMatch(/ccrc wrappers/);
});
```

`CHECKS_SRC` is the file's existing constant for `ccd/ccrc-doctor-checks` (`server/test/ccrc-doctor.test.ts:47`); do not add a second spelling of that path.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
```

- [ ] **Step 4: Rewrite the remedies**

- `bash ccd/ccrc-adopt --out /tmp/accounts.json` → `ccrc adopt --out /tmp/accounts.json` throughout.
- `:864-865` (no `~/.local/bin` at all) → name `ccrc wrappers`.
- `:1011` (the hard-findings remedy) keeps its "the roster is the source of truth and nothing here edits it for you" sentence — that is still exactly right — and swaps the adopt invocation.
- Where a remedy is for a MISSING generated wrapper, say `ccrc wrappers`. Where it is for a roster and a wrapper that DISAGREE, keep pointing at the roster: `ccrc wrappers` refuses a foreign file by design, so telling an operator to run it would be advice that does not work.

That last distinction is the point of the task. Do not collapse the two remedies into one.

- [ ] **Step 5: Run the doctor suite**

```bash
cd server && ./node_modules/.bin/vitest run test/ccrc-doctor.test.ts
```

Expected: PASS, including every pre-existing remedy assertion. Several pin exact strings; update them in this commit.

- [ ] **Step 6: Full suite, commit**

```bash
cd server && npm run test
git add ccd/ccrc-doctor-checks server/test/ccrc-doctor.test.ts
git commit -m "fix(doctor): the remedies name verbs a deployed box actually has"
```

---

## Deviations found

Numbered from D-74, continuing the global ledger (D-73 was the last, in the Stage 2b plan). Add entries here as they are discovered; cite each at its site in source with a `D-N` comment.

- **D-74** — `parseRoster` validated `exec.secretsFile` as "a string" only, while the value's one consumer embeds it inside a double-quoted bash string. Closed by Task 1.
- **D-75** — `deploy/gen-accounts.mjs`'s `checkAccount` validated `exec.secretsFile` and then dropped it from its return value, so the only bare-`node` reader of the roster could not tell a caller which secrets file an account uses. Closed by Task 4.
