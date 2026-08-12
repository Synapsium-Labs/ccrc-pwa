# A swap carries the whole conversation, a start restores supervision, and a dead row says why it is dead — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four defects that made the 2026-08-11 incident — a swap that loses history, a start that mints an unsupervised pane, a dead row that cannot say why it is dead, and a chat that renders "No messages yet" over a transcript that exists — with tests that fail first and a mutation sweep over the whole diff.

**Architecture:** Four independent moves that share one idea, *measure instead of guess*: (1) `cmd_swap` locates transcripts by uuid across every project directory under the source account, dedupes by inode, carries sidecars as a hardlink tree, and refuses rather than completing a carry it could not make; (2) `ccd start`/`ccd ensure` go through the systemd unit and wait on observables instead of spawning around it; (3) every deliberate unsupervise stamps the registry and every supervisor heartbeats into it, so one pure function classifies each row in both TypeScript and bash from a single fixture; (4) the PWA's transcript resolver becomes an existence-first ladder returning a typed outcome, memoized so it stays cheap at a 2-second tick.

**Tech Stack:** bash (ccd, ~7,270 lines, `set -uo pipefail`, no `-e`), systemd user units, TypeScript (Fastify server, agent, React PWA), vitest. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-12-swap-transcript-defect-family-design.md`

**Baseline for every anchor:** `605f16a` on `ws/fix-swap-transcript-defect-family`. Every `ccd:NNNN` and `file.ts:NN` below was measured at that commit. An anchor is a snapshot at plan-writing time, not a live index — reconcile against the tree, and if a cited line says something else, read around it and follow what is actually there.

## Global Constraints

- **No new ccd verb.** This whole design costs exactly one enrolment: the `--surface` argv in `whitelist-subset.test.ts`'s `EXPECTED` table. `cmd_caps`' list must not move, and `ccd-archive.test.ts`'s caps↔dispatcher parity test is what proves it.
- **No new `SessionStatus` or `SessionBucket` member**, and no change to `sessionBucket`'s ladder. An unknown bucket reaches an older PWA's `DOT[status].cls` and throws. Lifecycle is a new nullable field on `FleetSession`.
- **No widening of the agent's read whitelist.** `checkPath` (`agent/src/whitelist.ts:64-92`) stays as it is; every fact this plan needs is under `~/.cc-sessions` or `~/.claude*`, both already permitted.
- **Never run ccd against the live HOME.** ccd executes only against fixture HOMEs via `makeCcdHarness` (`server/test/ccdWsHelpers.ts`). No tmux, no `~/.cc-sessions`, no `systemctl`, no `git push`, no `gh` in worker context.
- **ccd runs under `set -uo pipefail` with no `-e`.** A failing command does not abort the script; every failure that matters must be branched on explicitly.
- **Verification is FOREGROUND**, in single blocking calls, with `timeout: 600000` ms, using the literal `cd <pkg> && ./node_modules/.bin/vitest run <files>` — never `npm test`, never `npx`, never backgrounded. Report REAL printed counts.
- **Node floor `>=22.13.0`**; no new dependencies in `server/`, `agent/` or `pwa/`.
- **Rollout order is part of the contract:** ccd (fleet host) → server + shared → PWA. A PWA rendering a field the box does not write yet is merely empty; a server requiring a verb the box lacks is broken.
- **Read the code before you write it.** Every code block below is **shape-authoritative, not text-authoritative** — the tree wins. The per-suite harness authorities are: `server/test/ccdWsHelpers.ts` (the ccd fixture HOME, and the only place `CCD`'s path is spelled), `server/test/ccd-forget.test.ts` (the copyable ccd-verb exemplar), `server/test/ccd-login-screen.test.ts` (pane-text classifiers), `server/test/wrapper-roster-fixture.test.ts` (the cross-language fixture idiom), `server/test/transcript-parse.test.ts` (real symlink chains against `localIO`), `server/test/sessionws.test.ts` (`FleetIO` spread-fakes), `server/test/helpers.ts` (`testDeps`), `server/test/tmpHelpers.ts` (fixture lifetimes), `pwa/test/cssRule.ts` (stylesheet-as-text).

## Measured filesystem behavior (this box, coreutils 9.4, 2026-08-12)

Four of D1's rules exist because of these results. They were run, not reasoned about; re-run them if
you doubt a step, and if your box answers differently, stop and say so rather than adapting the code
to a machine the fleet does not use.

| What was run | Result | Which rule it forces |
|---|---|---|
| `cp -p srcB dstX` where `dstX` and `dstY` are hardlinks | **both** names became `srcB`'s content, inode unchanged | every destination write is `cp -p --remove-destination`, or a re-swap silently rewrites the sibling names a previous swap created |
| `cp -p --remove-destination srcB dstX` | `dstX` got a new inode and `srcB`'s content; `dstY` kept its inode and content | the fix works, and it is the only one that does |
| `ln src dstY` where `dstY` exists | `rc=1`, `File exists` — and ccd has no `set -e`, so the script would continue and report success | `ln -f`, plus a test that asserts the link actually moved |
| `cp -al sc dstSC` with `dstSC` **absent** | hardlinked tree, same inodes | the sidecar carry is near-free |
| `cp -al sc dstSC` with `dstSC` **present** | nested: `dstSC/sc/` appeared beside `dstSC/sub/` | an existing destination sidecar is left alone, never merged — the "leave it" rule is a correctness requirement, not tidiness |

## File Structure

```
Create:
  shared/lifecycle.ts                        (SessionLifecycle, sessionLifecycle(), the fixture table)
  server/test/lifecycle.test.ts              (the TypeScript half of the cross-language pin)
  server/test/ccd-session-state.test.ts      (the bash half: _session_state over the same fixture)
  server/test/ccd-swap-carry.test.ts         (Tasks 1-2: locator + carry)
  server/test/ccd-swap-refuse.test.ts        (Task 3)
  server/test/ccd-spawn-verdict.test.ts      (Task 4)
  server/test/ccd-supervised-start.test.ts   (Task 5)
  server/test/ccd-start-id.test.ts           (Task 6)
  server/test/ccd-stop-intent.test.ts        (Task 7)
  server/test/transcript-ladder.test.ts      (Task 10)
Modify:
  ccd/ccd                                    (the locator, cmd_swap, _spawn, cmd_start/ensure/
                                              supervise/stop/ls, _ws_supervise/_ws_unsupervise,
                                              _auto_swap_check, _session_state, _transcript_path)
  server/test/ccd-archive.test.ts             (Task 13 extends its _transcript_path describe block)
  ccd/claude-session@.service                (StartLimitIntervalSec / StartLimitBurst)
  shared/api.ts                              (FleetSession: lifecycle, stoppedBy, swapBlocked;
                                              snapshot revival for all three)
  server/src/registry.ts                     (buildRecord reads the four new fields)
  server/src/fleet.ts                        (assembleFleet computes lifecycle)
  server/src/transcript/resolve.ts           (the ladder, the outcome union, TranscriptResolver)
  server/src/sessionws.ts                    (re-point rule, since-carries-file)
  server/src/watch.ts                        (name sweep uses the resolver, no foreign rung)
  server/src/commands.ts                     (slash-command listing uses the resolver)
  server/src/ccdargv.ts                      (stopId gains the --surface token)
  server/test/whitelist-subset.test.ts       (EXPECTED table gains the --surface argv)
  server/test/transcript-parse.test.ts       (existing resolveTranscriptFile cases move to the union)
  server/test/registry.test.ts               (the four new field reads)
  server/test/bucket.test.ts                 (negative pin: a stopped/orphan row is still `dead`)
  pwa/src/session/SessionHeader.tsx          (lifecycle qualifier, stranded-history banner)
  pwa/src/fleet/SessionLine.tsx              (row qualifier)
  pwa/src/stores/session.ts                  (resume carries the resolved file)
  README.md                                  (the sentences that describe the old behavior)
```

## Task order and why it is this order

1. The uuid locator and the carry helpers — pure functions, testable with no `cmd_swap` in the way.
2. `cmd_swap` uses them, sidecars included.
3. `cmd_swap` refuses what it cannot carry — needs 1 and 2 to have somewhere to refuse from.
4. Spawn verdicts — independent of the swap work, and Task 5 needs the `spawn` stamp to wait on.
5. The supervised start path — consumes Task 4's stamp.
6. The one-arg id form — small, and it is the verb Task 7's `ccd ls` tells the operator to run.
7. Stop intent, the heartbeat, `_session_state`, the `ccd ls` STATE column. Ends the ccd half.
8. The shared classifier and the cross-language fixture — pins Task 7's bash against one table.
9. The fleet row carries lifecycle. Ends the server-state half.
10. The resolver ladder, the outcome union, the memo — independent of everything above.
11. The three callers move onto it, and the stream follows a changed answer.
12. The PWA renders what 9 and 11 now make available.
13. `_transcript_path` stops recording an unchecked guess into archive manifests and reap
    tombstones (spec §2.5). It belongs to the **ccd half** and may be executed any time after
    Task 1, whose `_transcript_matches` it consumes; it is numbered here only because it was ruled
    into scope after Tasks 1-12 had their numbers, and stable numbers are worth more than a tidy
    ordering.
14. Gates: the mutation sweep, the full suites, the drift pins, the README, the deploy note.

Tasks 1-7 and 13 ship as one deployable unit (the fleet host), 8-11 as the second (the server), 12
as the third (the PWA). Task 14 gates the lot.

---

### Task 1: the swap finds every transcript by uuid instead of one guessed directory

Implements spec §2.1 (*the locator: find by uuid, not by path*) and §2.2 (*what lands at the destination*). This kills D1's root cause: `cmd_swap` computes `mdir` once (ccd:7033) as the munge of the resolved registry workdir and copies exactly `$srccfg/projects/$mdir/$uuid.jsonl` (ccd:7037-7039), while Claude Code writes under the munge of *its* cwd — the two diverge the moment the session moves (M8), and on 2026-08-11 the guess missed, one `>&2` line went into a log nobody reads, and the swap completed with no history at all.

This is the **pure-locator** task. It does not touch `cmd_swap`, so every behavior is tested in isolation by sourcing ccd and calling the helpers against a fixture HOME with hand-planted config dirs. Task 2 rewires `cmd_swap` to call them.

**Files:**
- Modify: `ccd/ccd` (insert `_transcript_matches`, `_sidecar_matches`, `_swap_carry_jsonl` between `_sanitize_anthropic`'s closing brace at ccd:7010 and `cmd_swap` at ccd:7012)
- Test: `server/test/ccd-swap-carry.test.ts` (create)

**Interfaces:**
- Consumes: `_sanitize_anthropic` (ccd:6988, unchanged), `$REG` (ccd:6).
- Produces: `_transcript_matches <cfgdir> <uuid>`, `_sidecar_matches <cfgdir> <uuid>`, `_swap_carry_jsonl <srccfg> <dstcfg> <uuid> <mdir> <sanitize 0|1>` (rc 0 = at least one jsonl carried, rc 1 = zero matches). Task 2 calls all three plus builds `_swap_carry_sidecars` on `_sidecar_matches`; Task 3's pre-flight refusal calls `_transcript_matches` before the teardown.

- [ ] **Step 1: Write the failing test(s)**

Create `server/test/ccd-swap-carry.test.ts`:

```ts
/**
 * D1's locator, tested with no `cmd_swap` in sight.
 *
 * A session uuid is globally unique, so the transcript can be FOUND rather
 * than guessed — which is the whole fix. Today's swap munges the registry
 * workdir into one directory name and copies exactly that path; on 2026-08-11
 * the session had moved into a worktree, the guess missed, and a rate-limit
 * rescue traded 70MB of conversation for a reprieve.
 *
 * Everything below runs the REAL ccd functions against a fixture HOME whose
 * `.claude*` config dirs are planted by hand (spec §1's measured shapes: M1's
 * one-inode-three-names, M3's sidecar with no `.jsonl` sibling). ccd runs
 * under `set -uo pipefail` with NO `-e`, so a non-zero rc is something a test
 * must ASSERT — never something that shows up as a thrown exception.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-carry-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-1111-4bcc-b60b-0cfc0dc3d199';
const SRC = '.claude';        // the `claude` account's config dir
const DST = '.claude-dev0';   // the `claude-dev0` account's config dir

/** A transcript at <cfg>/projects/<pdir>/<uuid>.jsonl. `mtime` in whole
 *  seconds, because §2.2's newest-wins rule reads `stat -c %Y`. */
const plant = (cfg: string, pdir: string, body: string, mtime?: number): string => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  fs.writeFileSync(f, body);
  if (mtime !== undefined) fs.utimesSync(f, mtime, mtime);
  return f;
};

/** A second NAME for an existing inode — M1's production shape, verbatim. */
const linkAt = (from: string, cfg: string, pdir: string): string => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, `${UUID}.jsonl`);
  fs.linkSync(from, to);
  return to;
};

/** A sidecar file at <cfg>/projects/<pdir>/<uuid>/<rel>. */
const sidecar = (cfg: string, pdir: string, rel: string, body: string): string => {
  const f = path.join(h.home, cfg, 'projects', pdir, UUID, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
};

const dst = (pdir: string): string =>
  path.join(h.home, DST, 'projects', pdir, `${UUID}.jsonl`);
const read = (p: string): string => fs.readFileSync(p, 'utf8');

/** Every transcript body the DESTINATION account holds, wherever it landed —
 *  the assertion that a superseded inode was not filed somewhere else. */
const dstBodies = (): string[] => {
  const root = path.join(h.home, DST, 'projects');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((d) => path.join(root, d, `${UUID}.jsonl`))
    .filter((p) => fs.existsSync(p))
    .map(read);
};

/** `_swap_carry_jsonl` with its rc made visible as text. */
const carry = (mdir: string, sanitize = 0): string =>
  h.sh(`_swap_carry_jsonl "$HOME/${SRC}" "$HOME/${DST}" ${UUID} '${mdir}' ${sanitize} `
    + '&& echo RC0 || echo RC$?');

describe('_transcript_matches', () => {
  it('finds every match, in every project directory, not one guessed dir', () => {
    // Kills the "munge one directory and look there" mutant — i.e. today's
    // cmd_swap, and the 2026-08-11 incident.
    plant(SRC, '-data-projects-demo', 'A\n');
    plant(SRC, '-data-projects-demo--claude-worktrees-quiet-mesa', 'B\n');
    const out = h.sh(`_transcript_matches "$HOME/${SRC}" ${UUID}`).split('\n');
    expect(out).toHaveLength(2);
    expect(out.map((p) => path.basename(path.dirname(p))).sort()).toEqual([
      '-data-projects-demo',
      '-data-projects-demo--claude-worktrees-quiet-mesa',
    ]);
  });

  it('answers nothing — never a literal `*` path — when the uuid is absent', () => {
    // Kills the missing-nullglob mutant: without it the glob yields the
    // uninterpolated "<cfg>/projects/*/<uuid>.jsonl", which `[[ -f ]]` quietly
    // answers no to, so "found nothing" and "wrote nothing" become the same
    // silent shrug. §2.1: zero matches must be a TESTABLE state.
    fs.mkdirSync(path.join(h.home, SRC, 'projects'), { recursive: true });
    expect(h.sh(`_transcript_matches "$HOME/${SRC}" ${UUID}; echo END`)).toBe('END');
  });

  it('is scoped to the source config dir — never a sweep across accounts', () => {
    // M2: the incident uuid exists in FIVE config dirs at five different
    // sizes. A locator allowed to cross accounts would carry a stale copy.
    plant(SRC, '-data-projects-demo', 'MINE\n');
    plant('.claude-personal', '-data-projects-demo', 'STALE\n');
    const out = h.sh(`_transcript_matches "$HOME/${SRC}" ${UUID}`).split('\n');
    expect(out).toHaveLength(1);
    expect(out[0]).toContain(`/${SRC}/projects/`);
  });
});

describe('_sidecar_matches', () => {
  it('globs sidecars in their own right, including one with no .jsonl sibling', () => {
    // M3: two of the incident's sidecars sat in project dirs holding no
    // transcript at all. "Beside each jsonl" would carry neither.
    plant(SRC, '-data-projects-demo', 'A\n');
    sidecar(SRC, '-data-projects-demo', 'tool-results/r.json', 'R\n');
    sidecar(SRC, '-lonely-worktree', 'subagents/s.jsonl', 'S\n');
    const out = h.sh(`_sidecar_matches "$HOME/${SRC}" ${UUID}`).split('\n');
    expect(out).toHaveLength(2);
    expect(out.map((p) => path.basename(path.dirname(p))).sort())
      .toEqual(['-data-projects-demo', '-lonely-worktree']);
  });

  it('returns the directory with NO trailing slash', () => {
    // §2.3: `cp -a src/ dst` onto a directory a previous attempt half-created
    // nests the sidecar inside itself. The stripped slash is the fix, and it
    // belongs to the locator so no caller has to remember it.
    sidecar(SRC, '-data-projects-demo', 'tool-results/r.json', 'R\n');
    const out = h.sh(`_sidecar_matches "$HOME/${SRC}" ${UUID}`);
    expect(out.endsWith('/')).toBe(false);
    expect(out.endsWith(UUID)).toBe(true);
  });

  it('never returns the .jsonl file as if it were a sidecar', () => {
    // Kills the mutant that drops the trailing slash from the glob (and the
    // -d test with it): `<projects>/*/<uuid>` alone matches nothing here, but
    // `<projects>/*/<uuid>*` would match the transcript.
    plant(SRC, '-data-projects-demo', 'A\n');
    expect(h.sh(`_sidecar_matches "$HOME/${SRC}" ${UUID}; echo END`)).toBe('END');
  });
});

describe('_swap_carry_jsonl', () => {
  it('mirrors every match at its own relative dir, and covers mdir with the newest', () => {
    // Two distinct inodes, neither of them at mdir: both are genuinely
    // different files (a startup-directory transcript and the relocated one),
    // and §2.2 keeps them wherever keeping them costs nothing.
    plant(SRC, '-data-projects-demo', 'OLD\n', 1000);
    plant(SRC, '-w-quiet-mesa', 'NEW\n', 2000);
    expect(carry('-mdir-elsewhere')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('OLD\n');
    expect(read(dst('-w-quiet-mesa'))).toBe('NEW\n');
    // mdir is claimed by EVERY match — it is the address the resumed process
    // reads first — and the newest wins it.
    expect(read(dst('-mdir-elsewhere'))).toBe('NEW\n');
  });

  it('resolves a destination collision by newest source mtime, and drops the loser', () => {
    // The incident replayed WITH a full carry: the stale startup transcript
    // still sits at the old munge, which for many rows IS mdir. Copy both
    // while preserving directories and the stale one lands at mdir. Kills the
    // "last writer wins" and "mirror beats mdir" mutants.
    plant(SRC, '-data-projects-demo', 'OLD\n', 1000);
    plant(SRC, '-w-quiet-mesa', 'NEW\n', 2000);
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('NEW\n');
    expect(read(dst('-w-quiet-mesa'))).toBe('NEW\n');
    // "strictly superseded history for the same session, at the same address":
    // the older inode's only slot was one the newer match also claimed, so it
    // is not copied at all rather than filed where it was never written.
    expect(dstBodies()).not.toContain('OLD\n');
  });

  it('one inode wearing three names costs one copy and three links', () => {
    // M1, in production right now: `8828232 3 70906385` — one inode, three
    // names, 70MB. Without the inode grouping one recovered session costs
    // 210MB per swap.
    const a = plant(SRC, '-data-projects-x', `${'X'.repeat(70)}\n`);
    linkAt(a, SRC, '-mnt-projects-x');
    linkAt(a, SRC, '-w-x');
    expect(carry('-data-projects-x')).toBe('RC0');
    const inos = ['-data-projects-x', '-mnt-projects-x', '-w-x']
      .map((d) => fs.statSync(dst(d)).ino);
    expect(new Set(inos).size, 'three names must share ONE destination inode').toBe(1);
    expect(fs.statSync(dst('-data-projects-x')).nlink,
      'three destination names, one content copy').toBe(3);
    // And the destination is a COPY across config dirs, never a link back into
    // the source account: the transcript is APPENDED to, so an aliased source
    // would grow a conversation that account never had.
    expect(inos[0]).not.toBe(fs.statSync(a).ino);
    expect(read(a)).toBe(`${'X'.repeat(70)}\n`);
  });

  it('preserves the source mtime — two of this design\'s own rules read it', () => {
    // Kills the `cp` (no -p) mutant. A plain copy stamps every destination
    // with the time of the swap, so the OLDEST carried transcript looks like
    // the freshest thing in the account the moment it lands — which breaks
    // newest-wins here and the resolver's rung ordering in §5.1.
    plant(SRC, '-data-projects-demo', 'A\n', 1700000000);
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(Math.floor(fs.statSync(dst('-data-projects-demo')).mtimeMs / 1000))
      .toBe(1700000000);
  });

  it('unlinks the destination first, so a previous swap\'s sibling name is not rewritten', () => {
    // THE subtlest requirement in D1, measured on this box (coreutils 9.4).
    // Swapping back to an account a session lived on before is ordinary (M2:
    // 17 of 23 rows have residue elsewhere), and a previous swap left that
    // account's names HARDLINKED to each other. A plain `cp` onto one of them
    // writes THROUGH the shared inode and every sibling changes with it.
    const previous = plant(DST, '-data-projects-demo', 'PREVIOUS\n');
    linkAt(previous, DST, '-w-quiet-mesa');
    plant(SRC, '-data-projects-demo', 'CURRENT\n');
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe('CURRENT\n');
    expect(read(dst('-w-quiet-mesa')),
      'the write went through a shared inode and rewrote a name this swap never claimed')
      .toBe('PREVIOUS\n');
  });

  it('links over a destination name that already exists', () => {
    // `ln` onto an existing name fails EEXIST, and ccd runs without `set -e`:
    // the script would sail past it and report success, leaving the residue
    // in place. Kills the missing `-f`.
    const a = plant(SRC, '-data-projects-demo', 'CURRENT\n');
    linkAt(a, SRC, '-w-quiet-mesa');
    plant(DST, '-w-quiet-mesa', 'RESIDUE\n');
    expect(carry('-data-projects-demo')).toBe('RC0');
    expect(read(dst('-w-quiet-mesa'))).toBe('CURRENT\n');
    expect(fs.statSync(dst('-w-quiet-mesa')).ino)
      .toBe(fs.statSync(dst('-data-projects-demo')).ino);
  });

  it('answers rc 1 and writes nothing at all when the uuid has no transcript', () => {
    // §2.4's precondition: an empty glob must not read as an empty copy, and
    // the refusal Task 3 builds on top of this needs a destination account
    // that was never touched. Kills "mkdir the slots first, decide later".
    fs.mkdirSync(path.join(h.home, SRC, 'projects'), { recursive: true });
    expect(carry('-data-projects-demo')).toBe('RC1');
    expect(fs.existsSync(path.join(h.home, DST, 'projects'))).toBe(false);
  });

  it('sanitizes the copy BEFORE the links are made, so every name is the sanitized file', () => {
    // _sanitize_anthropic rewrites through open(f+".tmp") + os.replace, which
    // gives the replaced name a NEW inode. Sanitize after linking and every
    // sibling keeps the unsanitized file — i.e. the empty-text-block 400 the
    // sanitize exists to prevent, on whichever name the CLI happens to open.
    const empty = '{"message":{"content":[{"type":"text","text":""}]}}';
    const a = plant(SRC, '-data-projects-demo', `${empty}\n`);
    linkAt(a, SRC, '-w-quiet-mesa');
    expect(carry('-data-projects-demo', 1)).toBe('RC0');
    for (const d of ['-data-projects-demo', '-w-quiet-mesa']) {
      expect(read(dst(d)), `${d} is not the sanitized file`).toContain('"..."');
    }
    expect(fs.statSync(dst('-data-projects-demo')).ino)
      .toBe(fs.statSync(dst('-w-quiet-mesa')).ino);
    // No move, ever: the source account keeps its own, untouched.
    expect(read(a)).toBe(`${empty}\n`);
  });

  it('leaves the transcript alone when sanitize is 0', () => {
    // The contract is unchanged from ccd:7044 — only `gpt` -> Anthropic
    // rewrites anything. Kills "sanitize everything, it is harmless".
    const empty = '{"message":{"content":[{"type":"text","text":""}]}}';
    plant(SRC, '-data-projects-demo', `${empty}\n`);
    expect(carry('-data-projects-demo', 0)).toBe('RC0');
    expect(read(dst('-data-projects-demo'))).toBe(`${empty}\n`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts` (`timeout: 600000`)

Expected: FAIL — every case dies on a missing function. The `_transcript_matches` / `_sidecar_matches` cases throw out of `h.sh` with `line 1: _transcript_matches: command not found`; the `_swap_carry_jsonl` cases report `expected 'RC127' to be 'RC0'` (127 is bash's command-not-found, caught by the `|| echo RC$?` the helper wraps every call in). Confirm the text before proceeding — an ENOENT from a fixture path means the plant helpers are wrong, not the implementation.

- [ ] **Step 3: Add the three locator helpers to ccd**

In `ccd/ccd`, insert the block below between `_sanitize_anthropic`'s closing `}` (ccd:7010) and `cmd_swap` (ccd:7012). This code is **shape-authoritative, not text-authoritative**: reconcile the surrounding blank lines and the exact `_sanitize_anthropic` call name against the live tree before pasting.

```bash
_transcript_matches() {   # cfgdir uuid -> every <cfgdir>/projects/*/<uuid>.jsonl, one per line.
  # A session uuid is globally UNIQUE, so the transcript can be found instead of
  # guessed. cmd_swap used to munge one directory and copy exactly that path;
  # Claude Code writes under the munge of ITS cwd, which diverges the moment the
  # session moves (a /cd relocates the transcript, a worktree tool does not), and
  # on 2026-08-11 the guess missed and the swap completed with no history.
  # Deliberately scoped to ONE config dir: the same uuid exists under five
  # accounts at five different sizes, and a cross-account sweep would carry
  # whichever stale copy sorted first.
  # The glob runs in a subshell so `nullglob` — which is what makes "no matches"
  # an empty list rather than a literal `*`-bearing path that `[[ -f ]]` quietly
  # answers no to — cannot leak into the caller's shell.
  # rc is ALWAYS 0, found or not: "no matches" is empty output, not a nonzero
  # rc. A caller deciding whether to refuse (Task 3) must count output lines —
  # `_transcript_matches … || die` never fires.
  local cfg="$1" uuid="$2" f
  [[ -n "$cfg" && -n "$uuid" ]] || return 0
  ( shopt -s nullglob
    for f in "$cfg"/projects/*/"$uuid".jsonl; do
      [[ -f "$f" ]] || continue
      printf '%s\n' "$f"
    done )
}

_sidecar_matches() {   # cfgdir uuid -> every <cfgdir>/projects/*/<uuid>/ sidecar dir, no trailing slash.
  # Globbed in its OWN right, not "beside each jsonl": two of the incident's
  # sidecars sit in project dirs that hold no .jsonl for that uuid at all. The
  # trailing slash in the glob is what restricts it to directories. The
  # stripped slash on the way OUT gives every caller the same bare `<uuid>`
  # path — it is NOT what stops `cp -a src/ dst` nesting: measured, `cp -al
  # src/<uuid> dst/<uuid>` onto an ALREADY-EXISTING destination nests
  # regardless of either side's trailing slash. The real guard is "the
  # destination must not already exist before the copy runs", and that is the
  # copying caller's job (Task 2), not this locator's.
  local cfg="$1" uuid="$2" d
  [[ -n "$cfg" && -n "$uuid" ]] || return 0
  ( shopt -s nullglob
    for d in "$cfg"/projects/*/"$uuid"/; do
      [[ -d "$d" ]] || continue
      printf '%s\n' "${d%/}"
    done )
}

_swap_carry_jsonl() {   # srccfg dstcfg uuid mdir sanitize(0|1) -> rc 0 carried, rc 1 nothing found.
  # Destination slots = each match's MIRRORED relative dir (so the target account
  # looks like where Claude Code actually had the file) plus `mdir`, the munge of
  # the resolved registry workdir — the directory the resumed process starts in,
  # and the first address it reads. Where two matches want one slot the newest
  # source mtime wins, which is the rule that makes the mdir slot safe: a session
  # that moved has a STALE transcript still sitting at its old startup munge,
  # which for many rows IS mdir, and copying both while preserving directories
  # would land the stale one at exactly the address that matters.
  #
  # One copy per distinct INODE (one inode wore three names in production, at
  # 70MB); every other slot for that inode is a hardlink to the copy. Every
  # destination write unlinks first (`cp -p --remove-destination`, `ln -f`): a
  # previous swap onto this account left its names hardlinked to EACH OTHER, so a
  # plain cp writes through the shared inode and rewrites siblings this swap
  # never claimed, and a plain ln fails EEXIST — which, with no `set -e`, this
  # script would sail straight past.
  #
  # A cp across config dirs, never a link from source to destination: the
  # transcript is the one file that gets APPENDED to, so an aliased source would
  # grow a conversation that account never had. `-p` because two of this design's
  # rules read mtimes and a plain cp stamps every copy with the time of the swap.
  local srccfg="$1" dstcfg="$2" uuid="$3" mdir="$4" sanitize="${5:-0}"
  local -a matches=()
  # C-collated: the glob itself carries no order guarantee, and ccd runs from
  # an interactive shell, from `systemd-run --user`, and from the auto-swap
  # dispatcher — three environments, three possible locales. Left unpinned,
  # which match wins an equal-mtime tie (below) would depend on who triggered
  # the swap. Pinning here is what makes that tie-break reproducible; the
  # `LC_ALL=C sort` on the slot list further down is the same reasoning
  # applied one step later.
  mapfile -t matches < <(_transcript_matches "$srccfg" "$uuid" | LC_ALL=C sort)
  (( ${#matches[@]} )) || return 1

  local -A mtime_of=() ino_of=() winner=()
  local f pdir mt s cur
  for f in "${matches[@]}"; do
    # Parameter expansion, not `basename "$(dirname …)"`: every munged project
    # dir starts with `-`, and GNU basename would read `-data-projects-x` as
    # options.
    pdir="${f%/*}"; pdir="${pdir##*/}"
    mt=$(stat -c %Y "$f" 2>/dev/null); [[ "$mt" =~ ^[0-9]+$ ]] || mt=0
    mtime_of["$f"]="$mt"
    # device:inode, not inode alone — an inode number is unique only WITHIN a
    # filesystem, and two distinct transcripts on different devices could
    # otherwise collide and get treated as the same content.
    ino_of["$f"]=$(stat -c '%d:%i' "$f" 2>/dev/null)
    [[ -n "${ino_of[$f]}" ]] || ino_of["$f"]="path:$f"
    # Its own mirrored dir, and — for every match — the mdir slot, UNLESS mdir
    # is empty: `_reg_get`'s `cat … 2>/dev/null` yields "" for a missing
    # `.workdir` file, and `winner[""]=...` on an empty subscript is a FATAL
    # bash error under `set -u` that kills the interpreter mid-loop, not a
    # recoverable one — no rc, nothing after it runs. `${mdir:+"$mdir"}` drops
    # the slot instead of ever writing to it. Strictly greater, so an
    # equal-mtime tie keeps the first match in (C-sorted, see above) order,
    # and the answer stays deterministic.
    for s in "$pdir" ${mdir:+"$mdir"}; do
      cur="${winner[$s]:-}"
      if [[ -z "$cur" ]] || (( mt > ${mtime_of[$cur]} )); then winner["$s"]="$f"; fi
    done
  done

  # Sorted, and C-collated, so which slot holds the physical copy is reproducible
  # rather than a function of bash's hash order.
  local -a slots=()
  mapfile -t slots < <(printf '%s\n' "${!winner[@]}" | LC_ALL=C sort)

  local -A copied=()
  local carried=0 slot src ino dst
  for slot in "${slots[@]}"; do
    src="${winner[$slot]}"; ino="${ino_of[$src]}"
    dst="$dstcfg/projects/$slot/$uuid.jsonl"
    mkdir -p "$dstcfg/projects/$slot"
    if [[ -n "${copied[$ino]:-}" ]]; then
      ln -f "${copied[$ino]}" "$dst" 2>/dev/null \
        || cp -p --remove-destination "${copied[$ino]}" "$dst" 2>/dev/null \
        || { echo "ccd: warn: could not place transcript at $dst" >&2; continue; }
    else
      cp -p --remove-destination "$src" "$dst" 2>/dev/null \
        || { echo "ccd: warn: could not carry transcript $src -> $dst" >&2; continue; }
      # Order is load-bearing: _sanitize_anthropic rewrites through os.replace,
      # which BREAKS hardlinks — the replaced name gets a new inode and every
      # sibling keeps the unsanitized one. Copy -> sanitize -> link.
      [[ "$sanitize" == 1 ]] && _sanitize_anthropic "$dst"
      copied["$ino"]="$dst"; carried=$((carried + 1))
    fi
  done
  (( carried > 0 )) || return 1
  echo "$(date '+%F %T') carry $uuid: ${#matches[@]} match(es), $carried copy/copies, ${#slots[@]} destination(s)" \
    >> "$REG/swap.log"
  return 0
}
```

> **This block is the code as it stands after Task 1's review**, not the original draft.
> The first draft died on an empty `mdir` (`arr[""]=x` is a fatal bash error), let glob
> collation decide an equal-mtime tie, and claimed a stripped trailing slash prevented
> `cp -a` nesting. All three were found by execution, not by reading. Treat it the same way.


- [ ] **Step 4: Run the new suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts` (`timeout: 600000`)
Expected: PASS (15 cases — the count of `it()` blocks in Step 1, which is the authority; never add a
case to make a count match)

- [ ] **Step 5: Run the gates**

Run: `bash -n ccd/ccd && cd server && ./node_modules/.bin/vitest run test/ccd-swap-carry.test.ts test/ccd-workspaces.test.ts test/ccd-forget.test.ts test/wsaudit.test.ts test/verb-gate.test.ts test/whitelist-subset.test.ts` (`timeout: 600000`)

Expected: PASS all. The last three are the cross-package drift pins: this task adds no verb, no argv token and no reap-protocol refusal shape, so any movement in them is a mistake rather than a migration.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-swap-carry.test.ts
git commit -m "fix(ccd): a swap finds the transcript by uuid, not by one guessed directory"
```

---

### Task 2: cmd_swap carries the whole conversation, sidecars included

Implements spec §2.2 (steps 5-7 wired into the verb) and §2.3 (*sidecars*). Task 1 built the locator; this task makes `cmd_swap` use it, and adds the one carry it never had at all: the sidecar directory `<projects dir>/<uuid>/`, which holds `subagents`, `tool-results` and `workflows` and measured **188MB** for the incident session (M3). It is carried as a hardlink tree because those contents are write-once artifacts and the alternative is a swap that takes minutes and fills the disk.

Three things stay exactly as they are, and the tests pin all three: the tasks-dir copy (ccd:7050-7060 — keyed by uuid, never subject to D1, keeps its `cp -r` and its copy-don't-move reasoning), the `gpt` → Anthropic sanitize condition, and the fact that the sanitize runs on the copy **before** any hardlink is made.

**Files:**
- Modify: `ccd/ccd` (add `_swap_carry_sidecars` directly after Task 1's `_swap_carry_jsonl`; replace `cmd_swap`'s copy block — the `if [[ -f "$srccfg/projects/$mdir/$uuid.jsonl" ]] … fi` at ccd:7037-7049 in the pre-Task-1 numbering)
- Test: `server/test/ccd-swap.test.ts` (create)

Task 1 inserts ~95 lines above `cmd_swap`, so those anchors have moved: **find the block by its text** (`if [[ -f "$srccfg/projects/$mdir/$uuid.jsonl" ]]`), not by line number. The tasks-dir block that follows it (`# The task list lives at <configdir>/tasks/<uuid>/ …`) is the boundary — nothing at or below it changes.

**Interfaces:**
- Consumes: `_transcript_matches`, `_sidecar_matches`, `_swap_carry_jsonl` (Task 1); `_sanitize_anthropic` (ccd:6988, unchanged); `_cfg_dir` (ccd:6526).
- Produces: `_swap_carry_sidecars <srccfg> <dstcfg> <uuid>` (always rc 0; logs the mode it used to `$REG/swap.log`), and a `cmd_swap` whose entire copy step is two helper calls — the seam Task 3's pre-flight and refusal wrap without re-deriving any of this.

- [ ] **Step 1: Write the failing test(s)**

Create `server/test/ccd-swap.test.ts`:

```ts
/**
 * `ccd swap` carries the whole conversation.
 *
 * Task 1 proved the locator in isolation; this drives the real verb. The two
 * things a swap does to the world that a test must not are systemd and tmux,
 * so both are shell functions that LOG — the `cmd_stop` idiom from
 * ccd-workspaces.test.ts, verbatim. Everything else (the registry writes, the
 * config-dir mapping, the copies, the sanitize) runs for real against an
 * isolated HOME.
 *
 * The sidecar directory is the object this file exists for: 188MB of
 * subagents/tool-results/workflows that NOTHING copied before this build, in
 * project dirs that do not always hold a .jsonl for the same uuid.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-'); });
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const ID = 'claude-demo';
const EMPTY_TEXT = '{"message":{"content":[{"type":"text","text":""}]}}';

/** systemd and tmux log instead of acting. `sleep` is stubbed because
 *  cmd_swap's flush wait is a second of real time per case and nothing here
 *  depends on it. TMUX is emptied at the call site so the detached-self-swap
 *  branch — which re-execs ccd under `systemd-run` — can never be taken from a
 *  suite that may itself be running inside tmux. */
const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; '
  + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';

const runSwap = (target = 'claude-dev0'): string =>
  h.sh(`${SWAP} cmd_swap ${ID} ${target}`, { TMUX: '' });

/** The registry row cmd_swap reads. Returns `mdir` — the munge of the resolved
 *  workdir, computed here exactly as ccd's `tr '/._' '---'` computes it. */
const seed = (wrapper: string): string => {
  const wd = path.join(h.home, 'projects', 'demo');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper ${wrapper}
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir ${wd}`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};

const plant = (cfg: string, pdir: string, body: string): string => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${UUID}.jsonl`);
  fs.writeFileSync(f, body);
  return f;
};

const sidecar = (cfg: string, pdir: string, rel: string, body: string): string => {
  const f = path.join(h.home, cfg, 'projects', pdir, UUID, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  return f;
};

/** A path inside the DESTINATION account's project dir. */
const dstAt = (pdir: string, rel: string): string =>
  path.join(h.home, '.claude-dev0', 'projects', pdir, rel);

const swapLog = (): string => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};

describe('cmd_swap carries the transcript', () => {
  it('carries a transcript from a directory mdir never names', () => {
    // The 2026-08-11 incident, as a test: the session had moved into a
    // worktree, so the ONE path cmd_swap looked at did not exist, and the swap
    // completed anyway with a warning nobody read.
    const mdir = seed('claude');
    plant('.claude', '-w-quiet-mesa', 'HISTORY\n');
    expect(runSwap()).toContain('swapped claude-demo: claude -> claude-dev0');
    expect(fs.readFileSync(dstAt('-w-quiet-mesa', `${UUID}.jsonl`), 'utf8')).toBe('HISTORY\n');
    // …and the slot the resumed process reads first is covered too.
    expect(fs.readFileSync(dstAt(mdir, `${UUID}.jsonl`), 'utf8')).toBe('HISTORY\n');
    expect(h.reg(ID, 'wrapper')).toBe('claude-dev0');
  });

  it('a gpt -> Anthropic swap sanitizes the copy, and every carried name IS that file', () => {
    // Unchanged contract (ccd:7044), re-pinned at the verb: the Codex lane
    // writes EMPTY assistant text blocks, which the Anthropic API rejects on
    // the next turn. Ordering it before the hardlinks is what stops a sibling
    // name keeping the unsanitized inode.
    const mdir = seed('gpt');
    const a = plant('.claude-gpt', mdir, `${EMPTY_TEXT}\n`);
    fs.mkdirSync(path.join(h.home, '.claude-gpt', 'projects', '-w-quiet-mesa'), { recursive: true });
    fs.linkSync(a, path.join(h.home, '.claude-gpt', 'projects', '-w-quiet-mesa', `${UUID}.jsonl`));
    runSwap();
    for (const d of [mdir, '-w-quiet-mesa']) {
      expect(fs.readFileSync(dstAt(d, `${UUID}.jsonl`), 'utf8'), `${d} kept the unsanitized file`)
        .toContain('"..."');
    }
    expect(fs.statSync(dstAt(mdir, `${UUID}.jsonl`)).ino)
      .toBe(fs.statSync(dstAt('-w-quiet-mesa', `${UUID}.jsonl`)).ino);
    expect(fs.readFileSync(a, 'utf8'), 'no move, ever — the source keeps its own')
      .toBe(`${EMPTY_TEXT}\n`);
  });

  it('an Anthropic -> Anthropic swap rewrites nothing', () => {
    const mdir = seed('claude');
    plant('.claude', mdir, `${EMPTY_TEXT}\n`);
    runSwap();
    expect(fs.readFileSync(dstAt(mdir, `${UUID}.jsonl`), 'utf8')).toBe(`${EMPTY_TEXT}\n`);
  });
});

describe('cmd_swap carries the sidecars', () => {
  it('carries a sidecar whose project dir holds no .jsonl at all', () => {
    // M3: two of the incident's sidecars sat in dirs with no transcript for
    // that uuid. Kills any implementation that iterates transcript matches and
    // looks for a sidecar beside each one.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', '-lonely-worktree', 'tool-results/r.json', 'RESULT\n');
    runSwap();
    expect(fs.readFileSync(dstAt('-lonely-worktree', path.join(UUID, 'tool-results/r.json')), 'utf8'))
      .toBe('RESULT\n');
  });

  it('lands each sidecar at the mirror of its OWN source directory', () => {
    // Not "beside the transcript" and not "at mdir": the mirror is what makes
    // the brief's "beside each jsonl" true wherever a sibling exists and still
    // carries the ones where it does not.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', '-w-quiet-mesa', 'subagents/a.jsonl', 'SUB\n');
    runSwap();
    expect(fs.existsSync(dstAt('-w-quiet-mesa', path.join(UUID, 'subagents/a.jsonl')))).toBe(true);
    expect(fs.existsSync(dstAt(mdir, UUID)),
      'the sidecar was relocated to mdir instead of mirrored').toBe(false);
  });

  it('carries the sidecar as a hardlink tree, and says so', () => {
    // 188MB per sidecar: the difference between a swap that takes a moment and
    // one that takes minutes and fills the disk. The contents are write-once
    // artifacts, so sharing inodes between the two accounts is safe — and the
    // log line is the evidence, if a future defect ever implicates a shared
    // checkpoint.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    const src = sidecar('.claude', mdir, 'tool-results/r.json', 'RESULT\n');
    runSwap();
    expect(fs.statSync(dstAt(mdir, path.join(UUID, 'tool-results/r.json'))).ino)
      .toBe(fs.statSync(src).ino);
    expect(swapLog()).toContain('(link)');
  });

  it('leaves an existing destination sidecar alone — a tree is not replaced in one step', () => {
    // Deliberately the OPPOSITE of §2.2's unlink-first rule for the
    // transcript, which is one file replaceable in one step.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    sidecar('.claude', mdir, 'tool-results/r.json', 'SOURCE\n');
    sidecar('.claude-dev0', mdir, 'tool-results/r.json', 'ALREADY THERE\n');
    runSwap();
    expect(fs.readFileSync(dstAt(mdir, path.join(UUID, 'tool-results/r.json')), 'utf8'))
      .toBe('ALREADY THERE\n');
    expect(swapLog()).toContain('(kept)');
  });
});

describe('cmd_swap keeps carrying the task list', () => {
  it('still copies <configdir>/tasks/<uuid>/, untouched by any of this', () => {
    // Keyed by uuid rather than by a munged directory, so it was never subject
    // to D1's defect: it keeps its `cp -r` and its copy-don't-move reasoning.
    // Pinned because the rewrite above it is where it would get lost.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    const tasks = path.join(h.home, '.claude', 'tasks', UUID);
    fs.mkdirSync(tasks, { recursive: true });
    fs.writeFileSync(path.join(tasks, 'plan.json'), 'PLAN\n');
    runSwap();
    expect(fs.readFileSync(path.join(h.home, '.claude-dev0', 'tasks', UUID, 'plan.json'), 'utf8'))
      .toBe('PLAN\n');
    expect(fs.readFileSync(path.join(tasks, 'plan.json'), 'utf8'),
      'copy, don\'t move: a reverted swap still needs the old lane\'s copy').toBe('PLAN\n');
  });

  it('stops the unit before killing the pane, and starts it again at the end', () => {
    // Restart=always resurrects the session under the OLD wrapper if the pane
    // dies first. Unchanged ordering, pinned because this task rewrites the
    // lines between those two calls.
    const mdir = seed('claude');
    plant('.claude', mdir, 'HISTORY\n');
    runSwap();
    expect(h.calls()).toEqual([
      'systemctl --user stop claude-session@claude-demo',
      'tmux kill-session -t cc-claude-demo',
      'systemctl --user start claude-session@claude-demo',
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts` (`timeout: 600000`)

Expected: FAIL — 6 of 9. The transcript cases fail with `ENOENT: no such file or directory, open '…/.claude-dev0/projects/-w-quiet-mesa/<uuid>.jsonl'` (cmd_swap still copies only the `mdir` path); every sidecar case fails the same way on its sidecar path, because nothing copies sidecars today. The tasks-dir case and the systemctl-ordering case PASS from the start — they are regression pins, and a red one here means the harness is wrong.

- [ ] **Step 3: Add `_swap_carry_sidecars`**

In `ccd/ccd`, directly after Task 1's `_swap_carry_jsonl` and before `cmd_swap`:

```bash
_swap_carry_sidecars() {   # srccfg dstcfg uuid — carry every sidecar as a hardlink tree. Always rc 0.
  # <projects dir>/<uuid>/ holds subagents, tool-results and workflows, and was
  # copied by NOTHING before this build: 188MB of the incident session's state,
  # left behind on the account it was swapped off. Globbed in its own right
  # because sidecars exist in project dirs with no .jsonl for the same uuid, and
  # each lands at the mirror of its OWN source dir.
  #
  # `cp -al` — a hardlink tree, the one place a source inode is shared across
  # accounts, and the asymmetry with §2.2 is deliberate: the transcript is
  # appended to, a sidecar's contents are write-once artifacts read after they
  # are written. `cp -a` without `-l` is the fallback the moment linking fails
  # (a cross-device destination), so the degradation is a slow correct copy
  # rather than nothing — and it is the whole remedy if the write-once property
  # is ever disproved: delete one flag, pay the bytes, change nothing else. The
  # mode is logged so the evidence exists if a future defect implicates a shared
  # checkpoint.
  #
  # An existing destination sidecar is LEFT ALONE rather than merged — the
  # opposite of the transcript's unlink-first rule, because a tree can be
  # half-merged where a single file is replaced in one step. `_sidecar_matches`
  # strips the source's trailing slash; the anti-nesting guard is that `$dst`
  # (the `<uuid>` directory itself, not just its parent) must not already
  # exist before a copy attempt runs — measured: `cp -al src/<uuid> dst/<uuid>`
  # (and `cp -a`, identically) onto an ALREADY-EXISTING destination nests the
  # tree inside itself regardless of either path's trailing slash. `mkdir -p`
  # below only creates the PARENT (`$dstcfg/projects/$pdir`), never `$dst`
  # itself, so the FIRST attempt (`cp -al`) always starts clean.
  #
  # The SECOND attempt does not start clean on its own, and this is the
  # subtle half of the guard: `cp -al` builds the destination directory
  # skeleton before it fails on the first unlinkable file — measured on this
  # box, a cross-device `$dst` gets every subdirectory created and every file
  # missing, `cp` exits nonzero, and `$dst` now EXISTS where a moment ago it
  # did not. Falling back to `cp -a "$src" "$dst"` against that survivor nests
  # the whole tree one level down (`$dst/$uuid/…`) exactly as the top-of-loop
  # case does, leaving the real path full of empty directories — and because
  # `$dst` now exists, EVERY later swap onto this account hits the top-of-loop
  # guard and logs `(kept)`, permanently, never repairing it. The fallback
  # therefore clears any partial `$dst` immediately before it copies.
  #
  # Success is read from `cp`'s own exit status, not `[[ -d "$dst" ]]`: a
  # same-device partial failure (one unreadable member, ENOSPC, EMLINK) can
  # leave `$dst` populated as a directory before `cp -al` reports failure, so
  # a directory-existence check would read a half-linked tree as a clean
  # success — and log `(link)` for a tree that is only partly shared. Clearing
  # `$dst` before the fallback and always doing a full `cp -a` on ANY first-
  # attempt failure means the logged mode never overstates what is shared:
  # `(link)` only when the whole tree is hardlinks to `$src`, `(copy)`
  # whenever any part of it needed a real copy.
  #
  # C-collated sort: no destination is ever contested (each sidecar's `pdir`
  # comes from a distinct source project directory), so ordering never changes
  # WHAT is carried — only the order of the swap.log lines a human reads
  # afterward. Sorted anyway so that order is reproducible rather than a
  # function of glob/readdir order, which is locale- and filesystem-dependent.
  local srccfg="$1" dstcfg="$2" uuid="$3" src pdir dst mode rc
  local -a sidecars=()
  mapfile -t sidecars < <(_sidecar_matches "$srccfg" "$uuid" | LC_ALL=C sort)
  (( ${#sidecars[@]} )) || return 0
  for src in "${sidecars[@]}"; do
    # Parameter expansion, not `basename "$(dirname …)"`: every munged project
    # dir starts with `-`, and GNU basename would read it as options.
    pdir="${src%/*}"; pdir="${pdir##*/}"
    dst="$dstcfg/projects/$pdir/$uuid"
    if [[ -e "$dst" ]]; then
      echo "ccd: sidecar already present at $dst — left alone (not merged)" >&2
      echo "$(date '+%F %T') sidecar $uuid -> $dst (kept)" >> "$REG/swap.log"
      continue
    fi
    mkdir -p "$dstcfg/projects/$pdir"
    mode=link
    cp -al "$src" "$dst" 2>/dev/null; rc=$?
    if (( rc != 0 )); then
      mode=copy
      # $dst may already exist here — a partial skeleton the failed `cp -al`
      # left behind — and `cp -a` onto an existing $dst nests instead of
      # landing at the real path. Clear it first every time, unconditionally.
      [[ -e "$dst" ]] && rm -rf "$dst"
      cp -a "$src" "$dst" 2>/dev/null; rc=$?
    fi
    if (( rc == 0 )); then
      echo "$(date '+%F %T') sidecar $uuid -> $dst ($mode)" >> "$REG/swap.log"
    else
      echo "ccd: warn: could not carry sidecar $src -> $dst" >&2
      # Do not leave a half-built $dst behind on total failure either: the
      # top-of-loop existence check would read it as "already carried" and
      # this sidecar would never be retried by a later swap.
      [[ -e "$dst" ]] && rm -rf "$dst" 2>/dev/null
    fi
  done
  return 0
}
```

> **This block is the code as it stands after Task 2's review**, not the original draft.
> The draft fell back to `cp -a` without clearing the destination that the failed `cp -al`
> had already created, so a cross-device carry landed the tree one level down and left the
> real path holding empty directories — while logging success. Found by execution, against a
> real `/tmp` vs `/dev/shm` device pair. Treat this block the same way.


- [ ] **Step 4: Rewrite cmd_swap's copy block**

In `cmd_swap`, the block currently reading (pre-Task-1 anchor ccd:7037-7049; find it by its `if [[ -f …` line):

```bash
  if [[ -f "$srccfg/projects/$mdir/$uuid.jsonl" ]]; then
    mkdir -p "$dstcfg/projects/$mdir"
    cp "$srccfg/projects/$mdir/$uuid.jsonl" "$dstcfg/projects/$mdir/"
    # gpt -> Anthropic: the Codex lane (via LiteLLM) writes assistant messages with
    # EMPTY text blocks, which the Anthropic API rejects on the next turn ("text
    # content blocks must be non-empty" -> every turn 400s). Fill them so the
    # resumed session is valid. Anthropic -> Anthropic and *-> gpt need no fixup.
    if [[ "$cur" == gpt && "$target" != gpt ]]; then
      _sanitize_anthropic "$dstcfg/projects/$mdir/$uuid.jsonl"
    fi
  else
    echo "ccd: warn: transcript $uuid.jsonl not found under $cur config; session may resume without history" >&2
  fi
```

becomes:

```bash
  # Find the conversation by uuid, never by one guessed directory. Claude Code
  # writes under the munge of ITS cwd; the line this replaces munged the
  # REGISTRY workdir, and the two diverge the moment a session moves. On
  # 2026-08-11 that miss cost a session its entire history and said so only in a
  # log file nobody reads.
  # gpt -> Anthropic: the Codex lane (via LiteLLM) writes assistant messages with
  # EMPTY text blocks, which the Anthropic API rejects on the next turn ("text
  # content blocks must be non-empty" -> every turn 400s). Fill them so the
  # resumed session is valid. Anthropic -> Anthropic and *-> gpt need no fixup.
  # The carry runs it on the COPY and BEFORE the hardlinks, because
  # _sanitize_anthropic rewrites through os.replace and that breaks links.
  local sanitize=0
  [[ "$cur" == gpt && "$target" != gpt ]] && sanitize=1
  _swap_carry_jsonl "$srccfg" "$dstcfg" "$uuid" "$mdir" "$sanitize" \
    || echo "ccd: warn: transcript $uuid.jsonl not found under $cur config; session may resume without history" >&2
  # Unconditional, and separate: sidecars are globbed in their own right and
  # exist in project dirs that hold no .jsonl for this uuid at all.
  _swap_carry_sidecars "$srccfg" "$dstcfg" "$uuid"
```

Everything below this — the tasks-dir copy, the two `_reg_set` calls, the `swap.log` line, the `systemctl --user start` with its `cmd_ensure` fallback, and the `notify.sh` hook — is **unchanged**. (Task 3 replaces the `|| echo … warn …` arm with the pre-flight refusal, the `swapblocked` field and the restart-where-it-was path; leave it as a warning here.)

- [ ] **Step 5: Run the new suite to verify it passes**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts` (`timeout: 600000`)
Expected: PASS (9 cases)

- [ ] **Step 6: Run the gates**

Run: `bash -n ccd/ccd && cd server && ./node_modules/.bin/vitest run test/ccd-swap.test.ts test/ccd-swap-carry.test.ts test/ccd-workspaces.test.ts test/ccd-forget.test.ts test/ccd-limits.test.ts test/wsaudit.test.ts test/verb-gate.test.ts test/whitelist-subset.test.ts` (`timeout: 600000`)

Expected: PASS all. `ccd-limits.test.ts` is in the list because it pins `_gpt_status`'s strings verbatim and this task touches the `gpt` branch of `cmd_swap`; the three drift pins must not move, since this task still adds no verb and no argv token.

- [ ] **Step 7: Commit**

```bash
git add ccd/ccd server/test/ccd-swap.test.ts
git commit -m "fix(ccd): a swap carries the whole conversation — every transcript name, and the sidecars beside them"
```

---

### Task 3: a swap that cannot carry the conversation refuses instead of completing

This implements spec §2.4 in full — the half of D1 that is a *decision* rather than a locator. Task 1 gave the swap a way to find transcripts by uuid and Task 2 gave it a way to carry them; this task says what happens when there is nothing to find. Today `cmd_swap` tears the session down first (`systemctl --user stop` at ccd:7034, `tmux kill-session` at ccd:7035, `sleep 1` at ccd:7036) and only then looks (ccd:7037), so a miss produces a session that is dead *and* historyless, announced by one `>&2` line (ccd:7047-7048) that the detached path redirects into `$REG/swap.log` where nobody reads it. That is precisely the 2026-08-11 incident: a swap traded a session's entire history for a rate-limit reprieve and printed `swapped` afterwards.

**The exit code is the least important channel here, and that is why this task is mostly about the other two.** The common way a swap is invoked is from inside the session being swapped: `cmd_swap` detaches a transient `systemd-run` unit and **returns 0 to its caller at ccd:7022-7028**, before the real swap has begun. By the time the pre-flight runs in the detached process, the caller is gone — killed by the very swap it asked for. So a refusal that only sets `$?` and writes stderr reaches nobody. The durable channels carry it instead: `$REG/<id>.swapblocked` (on the fleet wire within one 2s watcher tick, spec M9), the `$REG/notify.sh` banner (the same hook the successful swap already fires at ccd:7068, so it rides a deployed working pipeline), and the `swap.log` line beside every other swap decision.

**Files:**
- Modify: `ccd/ccd` (tuning constants, after `SWAP_COOLDOWN` at ccd:30 — new `SWAPBLOCK_COOLDOWN`)
- Modify: `ccd/ccd` (new `_swap_refuse` immediately above `cmd_swap`, ccd:7012)
- Modify: `ccd/ccd` (`cmd_swap` head ccd:7012-7033: flag strip + advisory pre-flight; carry gate at ccd:7037-7049; `rm -f` the field in the success tail near ccd:7061)
- Modify: `ccd/ccd` (`_auto_swap_check` guard, ccd:6733-6735)
- Test: `server/test/ccd-swap-refuse.test.ts` (create)

**Interfaces:**
- Consumes: `_transcript_matches <cfgdir> <uuid>` (Task 1); `_swap_carry_jsonl <srccfg> <dstcfg> <uuid> <mdir> <sanitize>` with its rc 1 = zero matches contract, and `_swap_carry_sidecars <srccfg> <dstcfg> <uuid>` (Task 2).
- Produces: registry field `$REG/<id>.swapblocked` = `<epoch> <reason>`, cleared by a completed swap here (the `cmd_start`/`cmd_enable`/`cmd_ensure` clears the contract also names belong to the D2 task, which is where those verbs are rewritten); constant `SWAPBLOCK_COOLDOWN=1800`; the private helper `_swap_refuse <id> <cur> <target> <reason> <restart 0|1>`, which is **task-local** — no later task calls it, and it is not part of the cross-task contract.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-swap-refuse.test.ts`. The harness is `makeCcdHarness` from `ccdWsHelpers.ts` — the real `ccd` executed against a fixture HOME, never the live one — following `ccd-forget.test.ts`'s shape verbatim (its `shFail` wrapper, its stub-and-log idiom, its `h.reg` registry reads).

```ts
/**
 * `ccd swap` refuses rather than completing when it cannot carry the
 * conversation (spec §2.4). A swap exists to MOVE a conversation; completing
 * one with nothing found trades a session's entire history for a rate-limit
 * reprieve, which is exactly the trade that made the 2026-08-11 incident.
 *
 * The exit code is the weakest channel and these tests barely lean on it. The
 * common invocation is from inside the session being swapped, where cmd_swap
 * detaches a transient unit and returns 0 to a caller that the swap then kills
 * (ccd:7022-7028) — so the refusal is asserted where it actually survives:
 * the `swapblocked` registry field, the notify.sh banner, and swap.log.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-refuse-'); });
afterEach(() => { h.cleanup(); });

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

/** Everything cmd_swap reaches that must not leave the fixture: systemd, tmux,
 *  the flush sleep, and the ensure fallback. Each one LOGS, because half of
 *  these tests are assertions about which of them ran and which did not. */
const SWAP_STUBS = `
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  cmd_ensure() { echo "cmd_ensure $*" >> "$HOME/ccd-calls"; return 0; };
`;

const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** A live-looking wrapper session on `claude`, written with `_reg_set` — the
 *  same writer ccd uses — rather than `cmd_start`, which would want tmux. */
const seed = (uuid = UUID_A, id = 'claude-demo'): string => {
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
  h.sh(`_reg_set ${id} uuid ${uuid}
    _reg_set ${id} project demo
    _reg_set ${id} workdir "$HOME/projects/demo"
    _reg_set ${id} wrapper claude
    _reg_set ${id} started 1`);
  return id;
};

/** A transcript in a project dir that is deliberately NOT the munge of the
 *  registry workdir — the uuid locator is what finds it, which is the whole
 *  point of D1. */
const plantTranscript = (account: string, munge: string, uuid: string): string => {
  const dir = path.join(h.home, account, 'projects', munge);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${uuid}.jsonl`);
  fs.writeFileSync(f, '{"type":"message"}\n');
  return f;
};

const plantNotify = (): void => {
  fs.writeFileSync(path.join(h.home, '.cc-sessions', 'notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const swapLog = (): string =>
  fs.existsSync(path.join(h.home, '.cc-sessions', 'swap.log'))
    ? fs.readFileSync(path.join(h.home, '.cc-sessions', 'swap.log'), 'utf8') : '';

describe('a swap that cannot carry the conversation', () => {
  it('refuses BEFORE anything is torn down, and the session stays where it is', () => {
    // Kills the pre-fix order (stop -> kill -> sleep -> look, ccd:7034-7037),
    // which turned a miss into a session that was dead AND historyless. The
    // glob is a read, so it costs nothing above the teardown.
    const id = seed();
    plantNotify();
    const r = shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(`refusing to swap ${id}`);
    expect(h.calls().join('\n')).not.toContain(`stop claude-session@${id}`);
    expect(h.calls().join('\n')).not.toContain('kill-session');
    expect(h.reg(id, 'wrapper'), 'a refusal must not flip the account').toBe('claude');
  });

  it('leaves a durable field, a banner and a log line — the channels a detached swap needs', () => {
    // Mutant killed: "the stderr line is enough". It is not — the detached
    // self-swap path has already returned 0 to a caller it then kills.
    const id = seed();
    plantNotify();
    shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'swapblocked'))
      .toMatch(new RegExp(`^\\d{10} no transcript found for ${UUID_A} under claude$`));
    expect(notices()).toContain(`cc swap BLOCKED: ${id} stays on claude`);
    expect(swapLog()).toContain(`swap-refused ${id}: claude -> claude2`);
  });

  it('does NOT write lastswap — a refusal must not read as a swap landing', () => {
    // _spawn (ccd:6905-6910) treats a spawn within 300s of `lastswap` as the
    // swap ARRIVING, and answers the big-transcript resume gate with "resume
    // from summary" — an auto-compaction. A refusal that stamped lastswap
    // would compact the very history it refused in order to protect.
    const id = seed();
    shFail(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'lastswap')).toBeNull();
  });

  it('re-reads the uuid after the flush and decides on THAT one — a /clear rotates it', () => {
    // The pre-flight is ADVISORY. Here uuid-A has a transcript and passes it;
    // the teardown rotates the registry to uuid-B (what _sync_uuid does after
    // a /clear), and uuid-B has nothing. Carrying A would hand the resumed
    // session a file it will never ask for. Kills both the mutant that globs
    // once and the mutant that keeps the pre-flight's uuid.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    plantNotify();
    const rotate = `tmux() { [[ "\${1:-}" == kill-session ]] && _reg_set ${id} uuid ${UUID_B};
      echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };`;
    const r = shFail(`${SWAP_STUBS} ${rotate} cmd_swap ${id} claude2`);
    expect(r.code).not.toBe(0);
    expect(h.reg(id, 'swapblocked'))
      .toContain(`no transcript found for ${UUID_B} under claude after flush`);
    expect(h.reg(id, 'wrapper')).toBe('claude');
    expect(h.reg(id, 'lastswap')).toBeNull();
    // Registry `wrapper` was never touched, so the unit puts it back exactly
    // where it was — on the account that still holds its history.
    expect(h.calls().join('\n')).toContain(`--user start claude-session@${id}`);
  });

  it('falls back to cmd_ensure when the unit will not start', () => {
    // The same `|| cmd_ensure` tail the successful swap already carries at
    // ccd:7064. A box with no unit installed still gets its session back.
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    const noUnit = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 1; };`;
    const rotate = `tmux() { [[ "\${1:-}" == kill-session ]] && _reg_set ${id} uuid ${UUID_B};
      echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };`;
    shFail(`${SWAP_STUBS} ${noUnit} ${rotate} cmd_swap ${id} claude2`);
    expect(h.calls().join('\n')).toContain(`cmd_ensure ${id}`);
  });

  it('a completed swap clears a standing refusal', () => {
    // A control that revives a row and leaves its refusal banner standing
    // teaches the operator to ignore banners (spec §2.4).
    const id = seed(UUID_A);
    plantTranscript('.claude', '-x-projects-demo', UUID_A);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', `${id}.swapblocked`), '1754000000 stale');
    h.sh(`${SWAP_STUBS} cmd_swap ${id} claude2`);
    expect(h.reg(id, 'swapblocked')).toBeNull();
    expect(h.reg(id, 'wrapper')).toBe('claude2');
  });
});

describe('ccd swap --force', () => {
  it('restores the old behavior: nothing to carry, swap completes anyway', () => {
    // The operator has looked and decided there is genuinely nothing to carry.
    const id = seed();
    plantNotify();
    const out = h.sh(`${SWAP_STUBS} cmd_swap --force ${id} claude2`);
    expect(out).toContain(`swapped ${id}: claude -> claude2`);
    expect(h.reg(id, 'wrapper')).toBe('claude2');
    expect(h.reg(id, 'lastswap')).toMatch(/^\d{10}$/);
    expect(h.reg(id, 'swapblocked'), 'a forced swap is not a blocked one').toBeNull();
  });

  it('takes the flag on either side of the positionals, and never as a target', () => {
    // Flags are stripped BEFORE the positional parse. Without that,
    // `ccd swap --force <id> <target>` reads as a swap of a session named
    // "--force". Second lock: _is_valid_wrapper rejects the literal, so even
    // past the stripper (`--`) it cannot land in the target slot.
    const a = seed(UUID_A, 'claude-demo');
    h.sh(`${SWAP_STUBS} cmd_swap --force ${a} claude2`);
    expect(h.reg(a, 'wrapper')).toBe('claude2');

    const b = seed(UUID_A, 'claude-demo2');
    h.sh(`${SWAP_STUBS} cmd_swap ${b} claude2 --force`);
    expect(h.reg(b, 'wrapper')).toBe('claude2');

    const c = seed(UUID_A, 'claude-demo3');
    expect(shFail(`${SWAP_STUBS} cmd_swap ${c} --force`).code).not.toBe(0);
    expect(h.reg(c, 'wrapper'), 'a bare flag is a usage error, not a swap').toBe('claude');
    expect(shFail(`${SWAP_STUBS} cmd_swap ${c} -- --force`).stderr)
      .toContain("unknown wrapper '--force'");
  });
});

describe('_auto_swap_check and a refused session', () => {
  /** Everything past the cooldown gate, so the test is about the gate alone:
   *  a hard-blocked pane (matched by the REAL _pane_hard_blocked), a target,
   *  headroom, and a dispatch that logs instead of running systemd-run. */
  const AUTO_STUBS = `
    tmux() { case "\${1:-}" in capture-pane) echo "API Error: 429 Too Many Requests";; esac; return 0; };
    _swap_target() { echo claude2; }; _avail() { return 0; };
    _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
  `;

  it('skips a refusal younger than 1800s and stops skipping at the boundary', () => {
    // The supervise loop ticks every 5 seconds. Without this gate one refusal
    // becomes 720 banners and 720 swap.log lines an hour. Both sides of the
    // boundary are asserted so 1800 cannot drift to 900 (the swap cooldown it
    // sits beside) and `-lt` cannot become `-le` unnoticed.
    const id = seed();
    const stamp = (age: number): void => {
      h.sh(`_reg_set ${id} swapblocked "$(( $(date +%s) - ${age} )) no transcript found"`);
    };

    stamp(1799);
    h.sh(`${AUTO_STUBS} _auto_swap_check ${id}`);
    expect(h.calls().join('\n')).not.toContain('dispatch');

    stamp(1801);
    h.sh(`${AUTO_STUBS} _auto_swap_check ${id}`);
    expect(h.calls().join('\n')).toContain(`dispatch ${id} -> claude2`);
  });

  it('a garbage stamp does not gate and does not emit an unbound-variable line', () => {
    // ccd runs under `set -u`: `$(( now - garbage ))` on a hand-edited or
    // half-written field errors on EVERY tick. The timestamp is validated as
    // digits rather than trusted.
    const id = seed();
    h.sh(`_reg_set ${id} swapblocked "not-an-epoch whatever"`);
    const r = shFail(`${AUTO_STUBS} _auto_swap_check ${id}`);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('unbound variable');
    expect(h.calls().join('\n')).toContain(`dispatch ${id} -> claude2`);
  });
});

describe('the refusal vocabulary', () => {
  it("stays out of the reap protocol's harvested token shapes", () => {
    // server/test/wsaudit.test.ts greps THIS FILE for four literal emission
    // shapes (its header lists them) and requires every token it harvests to
    // have a sentence in wsaudit.ts's SENTENCES map, in BOTH directions. That
    // vocabulary answers a machine; a swap refusal answers a human on stderr
    // and a row in the registry. The tempting way to spell "refused" in this
    // codebase is one of those four shapes, and reaching for it here would
    // fail wsaudit.test.ts for a reason its author would not expect — so the
    // choice is PINNED here rather than remembered.
    const src = fs.readFileSync(CCD, 'utf8');
    const from = src.indexOf('_swap_refuse() {');
    const to = src.indexOf('cmd_swap_self() {');
    expect(from, '_swap_refuse was not found in ccd').toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const slice = src.slice(from, to);
    expect(slice.length, 'the refusal slice collapsed — this test would pass vacuously')
      .toBeGreaterThan(500);
    for (const shape of [/_reap_refuse\s/, /"refused":"/, /"verdict":"/, /'!/]) {
      expect(slice, `the swap refusal is written in a harvested shape: ${shape}`)
        .not.toMatch(shape);
    }

    // And nothing anywhere in ccd emits a swap-flavoured token into that map.
    const tokens = new Set<string>();
    for (const m of src.matchAll(/_reap_refuse\s+([a-zA-Z][a-zA-Z0-9_-]*)\b/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/"refused":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/'!([a-zA-Z0-9-]+)/g)) tokens.add(m[1]!);
    for (const m of src.matchAll(/"verdict":"([a-zA-Z0-9-]+)"/g)) tokens.add(m[1]!);
    expect([...tokens].filter((t) => /swap|carry|transcript|blocked/i.test(t))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-refuse.test.ts` (`timeout: 600000`)

Expected: FAIL — the first test errors with the current `cmd_swap` completing instead of refusing: `expected 0 not to be 0` on `r.code`, and `h.reg(id, 'swapblocked')` is `null` in the second. If instead the failure is `_transcript_matches: command not found`, Task 1 has not landed — stop and finish it first.

- [ ] **Step 3: Add the auto-swap back-off constant**

In `ccd/ccd`, in the account-swap tuning block, directly after the `SWAP_COOLDOWN` line (ccd:30):

```bash
SWAP_COOLDOWN=900               # min seconds between swaps of one session
SWAPBLOCK_COOLDOWN=1800         # min seconds before auto-swap retries a session whose last swap REFUSED
```

- [ ] **Step 4: Add `_swap_refuse` immediately above `cmd_swap`**

Insert this directly before `cmd_swap() {` (ccd:7012), after `_sanitize_anthropic`'s closing `}`. The wording of the wsaudit paragraph is load-bearing in a way that is easy to undo: it must not itself contain any of the four harvested literals, or Step 1's slice assertion turns red and — worse — the reap-token regexes would harvest a word out of a comment and demand a `SENTENCES` entry for it.

```bash
_swap_refuse() {   # id cur target reason restart(0|1) — a swap that cannot carry the
  # conversation is refused, not completed (spec §2.4). A swap exists to MOVE a
  # conversation; completing one with nothing found trades a session's entire history
  # for a rate-limit reprieve, which is exactly the trade that made the 2026-08-11
  # incident. Refusing keeps the session on an account that may be throttled but still
  # holds its file, and puts a human in the loop.
  #
  # THREE channels, because the loudest one is the one nobody hears. The common
  # invocation is from inside the session being swapped, where cmd_swap detaches a
  # transient unit and returns 0 to its caller (see the systemd-run arm below) — the
  # caller is dead, killed by this very swap, long before this function runs. So:
  #   - $REG/<id>.swapblocked = "<epoch> <reason>" — the DURABLE one. On the fleet wire
  #     within one 2s watcher tick and rendered on the row (spec M9). Survives nobody
  #     watching, which /api/notify does not.
  #   - $REG/notify.sh — the banner for whoever IS watching; the same hook the successful
  #     swap already fires, so it rides a pipeline that is deployed and working.
  #   - $REG/swap.log — the forensic trail beside every other swap decision.
  #
  # This refusal is deliberately NOT written in any of the four literal emission shapes
  # server/test/wsaudit.test.ts harvests out of this file (its header lists them). Those
  # belong to the workspace audit/reap protocol, which answers a MACHINE over a closed
  # vocabulary that must have a matching sentence in wsaudit.ts, in both directions. A
  # swap refusal answers a human. Pinned by server/test/ccd-swap-refuse.test.ts so the
  # choice survives whoever edits this next.
  local id="$1" cur="$2" target="$3" reason="$4" restart="${5:-0}"
  _reg_set "$id" swapblocked "$(date +%s) $reason"
  echo "$(date '+%F %T') swap-refused $id: $cur -> $target ($reason)" >> "$REG/swap.log"
  [[ -x "$REG/notify.sh" ]] && "$REG/notify.sh" "cc swap BLOCKED: $id stays on $cur — $reason" >/dev/null 2>&1
  # NO `_reg_set lastswap` here, and the omission is load-bearing: _spawn reads lastswap
  # and treats a spawn within 300s as the swap LANDING, answering the big-transcript
  # resume gate with "resume from summary" — an auto-compaction. A refusal that stamped
  # lastswap would compact the very history it refused in order to protect. lastswap is
  # written only by a swap that completed.
  if [[ "$restart" == 1 ]]; then
    # Registry `wrapper` was never touched, so this puts the session back exactly where
    # it was: same account, same unit, still holding its file. Same `|| cmd_ensure`
    # fallback the successful swap's own tail uses for a box with no unit installed.
    systemctl --user start "claude-session@$id" 2>/dev/null || cmd_ensure "$id"
  fi
  echo "ccd: refusing to swap $id: $reason — it stays on $cur. If there is genuinely nothing to carry: ccd swap --force $id $target" >&2
  return 1
}
```

- [ ] **Step 5: Strip flags, pre-flight before the teardown, gate the carry**

Rewrite `cmd_swap`'s head and its copy block. **This block is shape-authoritative, not text-authoritative:** Task 2 already replaced the old `if [[ -f "$srccfg/projects/$mdir/$uuid.jsonl" ]]` arm (ccd:7037-7049) with calls to `_swap_carry_jsonl`/`_swap_carry_sidecars`, and the tasks-directory block (ccd:7050-7060) is untouched by both tasks. Read the live function first and reconcile — what this task adds is the flag stripper, the pre-flight, the uuid re-read, the `if ! …` gate around the carry, and one `rm -f` in the success tail.

```bash
cmd_swap() {   # [--force] id target-wrapper — move a session to another account, conversation intact.
  # Transcripts are plain JSONL with no account binding (validated 2026-07-03): carry the
  # session's transcripts into the target config dir, flip the registry wrapper, restart.
  # Manual swaps may target ANY valid wrapper; the pool policy only constrains auto-swaps.
  #
  # Flags are stripped BEFORE the positional parse, so `ccd swap <id> <target> --force`
  # and `ccd swap --force <id> <target>` mean the same thing and neither lets "--force"
  # land in $1 or $2 — the same rule §4.1 needs for `ccd stop --surface`, applied here for
  # the same reason. `--force` is an operator's word and stays one: _auto_swap_check never
  # passes it and no CCD_ARGV entry builds it, so no server route can reach it; and
  # _is_valid_wrapper rejects the literal, which is the second lock on the target slot.
  local force="" args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force) force=1; shift ;;
      --)      shift; args+=("$@"); break ;;
      *)       args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"    # bash >= 4.4 (the fleet host runs 5.2): an empty array here is
                         # not an unbound-variable error under `set -u`.
  local id="${1:?usage: ccd swap [--force] <id> <target-wrapper>}" target="${2:?usage: ccd swap [--force] <id> <target-wrapper>}"
  _is_valid_wrapper "$target" || die "unknown wrapper '$target' (valid: ${VALID_WRAPPERS[*]})"
  [[ -f "$REG/$id.uuid" ]] || die "no registry for '$id'"
  local cur; cur=$(_reg_get "$id" wrapper)
  [[ "$target" != "$cur" ]] || die "'$id' is already on $cur"
  [[ -x "$WRAPPER_DIR/$target" ]] || die "wrapper missing: $WRAPPER_DIR/$target"
  # Invoked from inside the session being swapped (Claude's own Bash tool)? The swap kills
  # its caller mid-flight — detach an orphan to finish the job after we return. The
  # detached process re-enters this function and runs the pre-flight itself; its refusal
  # reaches the operator through swapblocked + notify.sh, never through this return code,
  # which nothing is waiting for by then. --force rides along or the detached retry would
  # silently drop the operator's decision.
  if [[ -n "${TMUX:-}" && "$(tmux display-message -p '#S' 2>/dev/null)" == "$(_tmux "$id")" && -z "${CCD_SWAP_DETACHED:-}" ]]; then
    systemd-run --user --collect --quiet bash -c "sleep 2; CCD_SWAP_DETACHED=1 exec '$HOME/.local/bin/ccd' swap ${force:+--force} '$id' '$target' >>'$REG/swap.log' 2>&1"
    echo "detached: $id will restart under $target in a few seconds (this session dies with the swap — that's expected)"
    return 0
  fi
  local uuid wd srccfg dstcfg mdir
  uuid=$(_reg_get "$id" uuid); wd=$(readlink -f "$(_reg_get "$id" workdir)")
  srccfg=$(_cfg_dir "$cur"); dstcfg=$(_cfg_dir "$target")
  [[ -n "$srccfg" && -n "$dstcfg" ]] || die "no config-dir mapping for '$cur' -> '$target'"
  mdir=$(echo "$wd" | tr '/._' '---')
  # PRE-FLIGHT — advisory, and it runs BEFORE the teardown. The glob is a read, so a
  # refusal here costs nothing and leaves the session alive on the account that still
  # holds its file; the pre-fix order looked only after stopping the unit and killing the
  # pane, so a miss produced a session that was dead AND historyless. Advisory rather than
  # authoritative because the file the swap actually carries is the one that exists after
  # Claude Code has flushed below.
  if [[ -z "$force" && -z "$(_transcript_matches "$srccfg" "$uuid")" ]]; then
    _swap_refuse "$id" "$cur" "$target" "no transcript found for $uuid under $cur" 0
    return 1
  fi
  systemctl --user stop "claude-session@$id" 2>/dev/null   # first, or Restart=always resurrects under the old wrapper
  tmux kill-session -t "$(_tmux "$id")" 2>/dev/null
  sleep 1                                                  # let claude flush its final transcript entries
  # AUTHORITATIVE. Two things changed across that sleep and both matter. The transcript
  # gained the session's final entries — for a session being moved mid-turn, the most
  # valuable lines in it, which is the whole reason the sleep exists. And the uuid may
  # have ROTATED: a /clear does not delete the file, it mints a new uuid, and _sync_uuid
  # writes that into the registry — so a swap that pre-flighted uuid-A can arrive here
  # owning uuid-B. Re-read it; uuid-B is the one the resumed session will ask for.
  uuid=$(_reg_get "$id" uuid)
  local sanitize=0; [[ "$cur" == gpt && "$target" != gpt ]] && sanitize=1
  if ! _swap_carry_jsonl "$srccfg" "$dstcfg" "$uuid" "$mdir" "$sanitize"; then
    if [[ -z "$force" ]]; then
      # Registry `wrapper` is still $cur — nothing has been flipped — so _swap_refuse's
      # restart puts the session back on the account that still holds its history.
      _swap_refuse "$id" "$cur" "$target" "no transcript found for $uuid under $cur after flush" 1
      return 1
    fi
    echo "ccd: warn: no transcript for $uuid under $cur config; --force: $id resumes without history" >&2
  fi
  _swap_carry_sidecars "$srccfg" "$dstcfg" "$uuid"
  # ── the tasks-directory block (ccd:7050-7060) is UNCHANGED; keep it verbatim ──
  # …
  _reg_set "$id" wrapper "$target"
  _reg_set "$id" lastswap "$(date +%s)"
  rm -f "$REG/$id.swapblocked"   # a completed swap supersedes an earlier refusal: a
                                 # banner left standing on a row that just worked teaches
                                 # the operator to ignore banners.
  echo "$(date '+%F %T') swap $id: $cur -> $target (uuid $uuid)" >> "$REG/swap.log"
  systemctl --user start "claude-session@$id" 2>/dev/null || cmd_ensure "$id"
  # …the notify.sh call and the final `echo swapped …` (ccd:7065-7069) are UNCHANGED.
}
```

- [ ] **Step 6: Teach `_auto_swap_check` the back-off**

In `_auto_swap_check` (ccd:6728), extend the `local` line and add the gate directly after the existing `SWAP_COOLDOWN` check at ccd:6735. Current text to match:

```bash
  local id="$1" wrapper home now last pane target hard_blocked=""
  wrapper=$(_reg_get "$id" wrapper); home=$(_home_for "$id")
  now=$(date +%s); last=$(_reg_get "$id" lastswap)
  [[ -n "$last" && $((now - last)) -lt "$SWAP_COOLDOWN" ]] && return 0
```

becomes:

```bash
  local id="$1" wrapper home now last pane target hard_blocked="" blocked bts
  wrapper=$(_reg_get "$id" wrapper); home=$(_home_for "$id")
  now=$(date +%s); last=$(_reg_get "$id" lastswap)
  [[ -n "$last" && $((now - last)) -lt "$SWAP_COOLDOWN" ]] && return 0
  # A refused swap is not retried on the 5-second supervise tick. cmd_swap writes
  # $REG/<id>.swapblocked as "<epoch> <reason>" when it cannot carry the conversation
  # (spec §2.4); without this gate one refusal would produce 720 banners an hour, each
  # one a notify.sh call and a swap.log line. The epoch is VALIDATED as digits rather
  # than trusted: ccd runs under `set -u`, where `$(( now - garbage ))` on a hand-edited
  # or half-written field emits an unbound-variable line on every single tick.
  blocked=$(_reg_get "$id" swapblocked); bts="${blocked%% *}"
  [[ "$bts" =~ ^[0-9]+$ && $((now - bts)) -lt "$SWAPBLOCK_COOLDOWN" ]] && return 0
```

- [ ] **Step 7: Run the new suite**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-swap-refuse.test.ts` (`timeout: 600000`) — Expected: PASS (all 10)

- [ ] **Step 8: Run the gates**

Run: `bash -n ccd/ccd && cd server && ./node_modules/.bin/vitest run test/ccd-swap-refuse.test.ts test/wsaudit.test.ts test/ccd-ws-reap.test.ts test/ccd-ws-audit.test.ts test/whitelist-subset.test.ts test/verb-gate.test.ts test/ccd-archive.test.ts test/ccd-forget.test.ts` (`timeout: 600000`)

Expected: PASS all. `wsaudit.test.ts` is the one to watch: this task adds no token to its vocabulary, so any movement in its harvested set means a comment or a string in Step 4/Step 5 accidentally spelled one of the four shapes. `whitelist-subset`, `verb-gate` and the caps↔dispatcher parity in `ccd-archive.test.ts` must be untouched — `--force` is deliberately never enrolled, so any change there is a mistake, not a migration.

- [ ] **Step 9: Commit**

```bash
git add ccd/ccd server/test/ccd-swap-refuse.test.ts
git commit -m "fix(ccd): a swap that cannot carry the conversation refuses instead of completing"
```

---

### Task 4: a spawn reports what actually happened

Implements spec §3.3, and kills M6 — the silent success. `_accept_first_run_prompts` (ccd:6835-6894) polls `tmux capture-pane` 450 times; when the tmux session is gone the capture fails, `$pane` is empty, no branch matches, and after ~15 minutes the `for` loop falls out returning the status of its last `sleep 2` — **0**. `_spawn` (ccd:6896-6933) returns that, and `cmd_ensure` prints `ensured`. That is exactly how the 21:32:17 spawn failed quietly. After this task the classifier has four verdicts, a vanished session costs one probe instead of a quarter of an hour, `_spawn` writes `$REG/<id>.spawn` = `<epoch> <rc>` **always** before returning, and the two verbs that call it stop printing a success line over a failure.

Two notes an implementer must carry into the diff. First, the loop bound becomes `SPAWN_GATE_TRIES` — a plain shell variable with the production default 450, deliberately **not** an env override: existing tests already stub `sleep`, which makes the window instant in wall-clock terms, but 450 iterations still fork ~4,500 processes (measured: 7.3 s on this box) for the one assertion that the window expires. A test that sources ccd assigns the variable after the source; nothing on the wire can reach it, exactly like `PROJECTS_ROOT`'s no-override rule at ccd:8-13. Second, `rm -f "$REG/$id.stopped"` on rc 0 is the contract's "cleared by any successful spawn"; `.stopped` is D3's field, and `rm -f` on an absent file is a no-op, so this line is correct whether or not the D3 stamp task has landed yet — if it landed first and already wrote this line, keep the one that is there rather than adding a second.

**Files:**
- Modify: `ccd/ccd` — new `SPAWN_GATE_TRIES` tunable immediately above `SPAWN_EFFORT` (ccd:36); `_accept_first_run_prompts` head and tail (ccd:6850-6852 and ccd:6892-6894); `_spawn` tail (ccd:6922-6933); `cmd_start`'s spawn line (ccd:6967); `cmd_ensure`'s spawn line (ccd:6976)
- Test: `server/test/ccd-spawn-verdict.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_accept_first_run_prompts` rc table `0 | 2 | 3 | 4`; `$REG/<id>.spawn` = `<epoch> <rc>`, written on every verdict; `_spawn` returning that rc; the `SPAWN_GATE_TRIES` variable. Task 5's `_supervised_start` polls the `spawn` field and is the only way a verdict raised inside the supervisor reaches a `ccd start` in another process; §4.3's `orphan` rung reads the same fact.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-spawn-verdict.test.ts`:

```ts
// §3.3: a spawn reports what actually happened. M6 is the defect this file
// exists for — with the tmux session gone, `tmux capture-pane` fails, `$pane`
// is empty, no branch of `_accept_first_run_prompts` matches, and ~15 minutes
// later the `for` loop falls out returning its last `sleep 2`'s status: 0.
// `_spawn` propagated that and `cmd_ensure` printed `ensured` over a session
// that never came up.
//
// Harness: the ccd-login-screen.test.ts idiom — source ccd under an isolated
// HOME and shadow `tmux` with a shell function, so every argv lands in
// $HOME/ccd-calls and `capture-pane` answers from $PANE_TEXT. Nothing here
// reaches a real tmux server, a real unit, or the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-spawn-'); });
afterEach(() => { h.cleanup(); });

/** The tmux substrate modelled by ONE file, $HOME/pane-up: `new-session`
 *  creates it, `kill-session` removes it, `has-session` answers from it. That
 *  is what makes "the session vanished mid-poll" expressible at all — the
 *  older stub answered has-session with a logged 0 forever, so no test could
 *  see M6. `SPAWN_MAKES_PANE=0` is the 21:32:17 shape: new-session returns,
 *  no pane is ever there. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  [[ "\${SPAWN_MAKES_PANE:-1}" == 1 ]] && : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-}" ;;
    esac
  };`;

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The registry `_spawn` demands (`incomplete registry` dies otherwise). */
const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
};

const rcOf = (snippet: string, env: NodeJS.ProcessEnv = {}): number =>
  Number(/rc=(\d+)/.exec(h.sh(`${TMUX} rm -f "$HOME/pane-up"; ${snippet}; echo "rc=$?"`, env))![1]);

describe('_accept_first_run_prompts: four verdicts, no silent success', () => {
  it('returns 3 the moment the tmux session is gone — one probe, not a 15-minute wait (M6)', () => {
    // Kills two mutants at once: dropping the has-session probe (the pre-fix
    // code, which polls a dead session for the full window and then answers 0)
    // and probing AFTER the capture (which would burn a capture on nothing).
    expect(rcOf('_accept_first_run_prompts cc-test 0')).toBe(3);
    expect(h.calls().filter((c) => c.includes('capture-pane'))).toEqual([]);
    expect(h.calls().filter((c) => c.includes('has-session')).length).toBe(1);
  });

  it('returns 4 when the window expires with no live marker, and polls exactly SPAWN_GATE_TRIES times', () => {
    // The literal M6 mutant: `done` followed by nothing, so the function's exit
    // status is the loop's last `sleep`. And the bound must be the variable —
    // a hardcoded 450 here would make this assertion 450, not 3.
    const rc = rcOf(': > "$HOME/pane-up"; SPAWN_GATE_TRIES=3; _accept_first_run_prompts cc-test 0',
      { PANE_TEXT: 'a pane with nothing this function recognises' });
    expect(rc).toBe(4);
    expect(h.calls().filter((c) => c.includes('capture-pane')).length).toBe(3);
  });

  it('still returns 0 on a live marker and 2 on a login screen — the other two rows of the table', () => {
    // Re-pinned from ccd-login-screen.test.ts because these are no longer two
    // isolated behaviors but two rows of one four-row contract: a mutant that
    // renumbered the table would pass over there and fail here.
    expect(rcOf(': > "$HOME/pane-up"; _accept_first_run_prompts cc-test 0',
      { PANE_TEXT: '? for shortcuts' })).toBe(0);
    expect(rcOf(': > "$HOME/pane-up"; _accept_first_run_prompts cc-test 0',
      { PANE_TEXT: 'Please run /login' })).toBe(2);
  });
});

describe('_spawn: the verdict becomes a fact before it becomes a return code', () => {
  const spawnStamp = (id: string, env: NodeJS.ProcessEnv): string | null => {
    seed(id);
    // Trailing `; :` for the ccd-login-screen reason: _spawn's exit code is now
    // the verdict, so a correct rc 2 or rc 3 would make h.sh throw.
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn ${id} new; :`, env);
    return h.reg(id, 'spawn');
  };

  it('writes $REG/<id>.spawn = "<epoch> <rc>" on EVERY verdict, before returning', () => {
    // §3.1: this is the only channel from a spawn inside the supervisor to a
    // `ccd start` in another process (Task 5 reads it). A stamp written only on
    // success would leave the failures — the whole point — unreadable.
    expect(spawnStamp('healthy', { PANE_TEXT: '? for shortcuts' })).toMatch(/^\d{10} 0$/);
    expect(spawnStamp('gated', { PANE_TEXT: 'Please run /login' })).toMatch(/^\d{10} 2$/);
    expect(spawnStamp('vanished', { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' })).toMatch(/^\d{10} 3$/);
  });

  it('propagates the verdict as its own exit code', () => {
    // Kills a `_spawn` that stamps and then returns the status of its last
    // command — the shape it had before this task.
    seed('myid');
    expect(rcOf('_spawn myid new', { PANE_TEXT: '? for shortcuts' })).toBe(0);
    expect(rcOf('_spawn myid new', { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' })).toBe(3);
  });

  it('skips the /effort injection on every non-zero verdict, not just the login screen', () => {
    // The pre-fix guard was `prompt_rc != 2`, written when 2 was the only
    // non-zero code. Left alone it would type a slash command at a session
    // that does not exist.
    seed('myid');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn myid new; :`, { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(h.calls().some((c) => c.includes('/effort'))).toBe(false);
  });

  it('a successful spawn clears a stop stamp; a failed one leaves it standing', () => {
    // Contract: $REG/<id>.stopped is cleared by any SUCCESSFUL spawn (§4.1 —
    // reviving a session supersedes the earlier stop). A failed spawn revived
    // nothing, so it must not erase the record of who stopped it.
    seed('myid');
    h.sh(`_reg_set myid stopped '1786500000 pwa'`);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn myid new; :`, { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(h.reg('myid', 'stopped')).toBe('1786500000 pwa');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn myid new; :`, { PANE_TEXT: '? for shortcuts' });
    expect(h.reg('myid', 'stopped')).toBeNull();
  });
});

describe('the callers M6 actually lied through', () => {
  // CCD_IN_UNIT=1 is set in these snippets so they pin the DIRECT spawn path
  // both before and after Task 5, which gives both verbs a supervised branch.
  // Until that task lands the variable is inert; after it, it is what selects
  // the path these assertions are about.
  it('ccd ensure prints no success line and exits with the verdict when the session never came up', () => {
    seed('myid');
    const r = shFail(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_ensure myid`,
      { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(r.code).toBe(3);
    expect(r.stdout).not.toContain('ensured');
    expect(r.stderr).toContain('ensure failed for myid (spawn rc 3)');
    expect(h.reg('myid', 'spawn')).toMatch(/^\d{10} 3$/);
  });

  it('ccd start does the same — and both still report success on a healthy spawn', () => {
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const bad = shFail(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_start claude2 demo`,
      { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(bad.code).toBe(3);
    expect(bad.stdout).not.toContain('started claude2-demo');
    expect(bad.stderr).toContain('start failed for claude2-demo (spawn rc 3)');
    // Positive control: without it, "never print a success line" passes.
    const good = h.sh(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_start claude2 demo`,
      { PANE_TEXT: '? for shortcuts' });
    expect(good).toContain('started claude2-demo (new)');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-spawn-verdict.test.ts` (`timeout: 600000`)
Expected: FAIL — the first case reports `expected 0 to be 3` (the pre-fix function answers 0 for a vanished session), and the stamp cases report `expected null to match /^\d{10} 0$/` because `$REG/<id>.spawn` is never written.

- [ ] **Step 3: Add the loop bound as a tunable**

In `ccd/ccd`, in the header tuning block, immediately **above** `SPAWN_EFFORT="ultracode"` (ccd:36):

```bash
SPAWN_GATE_TRIES=450            # capture-pane polls before the startup-gate window expires (~15 min
                                # at the 2s tick). A plain shell variable with the production default,
                                # deliberately NOT an env override — HOME is ccd's only isolation
                                # boundary (see PROJECTS_ROOT above) and nothing on the wire can set
                                # a shell variable. A test that sources ccd assigns it afterwards,
                                # which is what keeps the rc-4 case a 3-poll assertion instead of a
                                # 4,500-process one.
```

- [ ] **Step 4: Give `_accept_first_run_prompts` its four verdicts**

Two edits inside ccd:6835-6894. The middle of the function — every gate branch, ccd:6856-6891 — is **untouched**; do not retype it. First, extend the docstring and the loop head (ccd:6850-6852):

```bash
  # rc 0 = a live marker appeared (the TUI is up); 2 = an auth screen (below); 3 = the tmux session
  # vanished mid-poll; 4 = the window expired with no marker. 3 and 4 both used to be "0 after ~15
  # minutes" (M6): the caller printed `started`/`ensured` over a session that was never there.
  local t="$1" fromswap="${2:-0}" i pane
  for i in $(seq 1 "$SPAWN_GATE_TRIES"); do
    # BEFORE the capture, and this order is the fix: `capture-pane` against a dead session fails into
    # an EMPTY $pane, which matches no branch below, so the loop used to poll a corpse for the full
    # window and then answer success. `has-session` is the one probe that distinguishes "not ready
    # yet" from "not there", and it costs one call.
    tmux has-session -t "$t" 2>/dev/null || return 3
    pane=$(tmux capture-pane -t "$t" -p 2>/dev/null)
```

Then the tail (ccd:6892-6894):

```bash
    sleep 2
  done
  # The window expired. An explicit verdict, because falling out of a `for` loop under `set -uo
  # pipefail` with no `-e` returns the status of the last command — `sleep 2`, i.e. 0. That is M6.
  return 4
}
```

- [ ] **Step 5: Make `_spawn` record and propagate the verdict**

In `ccd/ccd`, replace `_spawn`'s tail (ccd:6922-6933, from `local prompt_rc` to the closing brace):

```bash
  local prompt_rc
  _accept_first_run_prompts "$tname" "$fromswap"; prompt_rc=$?
  # The verdict becomes a FACT before it becomes a return code (§3.1). This costs nothing — _spawn
  # already runs inside the supervisor — and it is the ONLY channel from a spawn that happened
  # inside the unit to a `ccd start` running in another process, which is what Task 5's
  # _supervised_start polls. $REG is on the fleet wire within one 2s watcher tick (M9); an exit code
  # is on nothing's wire at all.
  _reg_set "$id" spawn "$(date +%s) $prompt_rc"
  case "$prompt_rc" in
    # A revival supersedes an earlier deliberate stop (§4.1). `rm -f` on an absent file is a no-op,
    # so this is correct whether or not the .stopped stamp itself has landed yet.
    0) rm -f "$REG/$id.stopped" ;;
    # $id and $wrapper are only in scope HERE, not inside _accept_first_run_prompts (which knows
    # only the tmux name), so the operator-facing warnings — naming both, spec §5 — live on this
    # side of the return.
    2) echo "warn: $id is waiting for login on $wrapper — attach and run /login" >&2 ;;
    3) echo "ccd: $id: the tmux session vanished during startup — nothing is running" >&2 ;;
    4) echo "ccd: $id: startup window expired with no live TUI marker" >&2 ;;
  esac
  # /effort ultracode is a Claude-model effort tier; skip it on the gpt lane (the GPT backend
  # doesn't take it and the injection would just error into the prompt box). The guard used to read
  # `!= 2` because 2 was the only non-zero code — with 3 and 4 in the table that would type a slash
  # command at a session that does not exist, so it is `== 0`: inject only into a TUI we watched
  # come up.
  [[ "$wrapper" != gpt && "$prompt_rc" == 0 ]] && _inject_spawn_effort "$tname"
  return "$prompt_rc"
}
```

- [ ] **Step 6: Stop the two verbs reporting a success they did not observe**

In `cmd_start` (ccd:6967), replace `_spawn "$id" "$mode"; _reg_set "$id" started 1` and the line after it:

```bash
  local rc; _spawn "$id" "$mode"; rc=$?
  # `started` stays unconditional: it records that this row has HAD a session, which is what §4.3's
  # never-started rung reads. A spawn that failed is still a row that was started — it classifies
  # `orphan`, which is the honest answer, not `never-started`.
  _reg_set "$id" started 1
  if [[ "$rc" -eq 3 || "$rc" -eq 4 ]]; then
    echo "ccd: start failed for $id (spawn rc $rc) — see $REG/$id.spawn" >&2
    return "$rc"
  fi
  echo "started $id ($mode) — discover on claude.ai by name: $id"
```

And the same shape in `cmd_ensure` (ccd:6976):

```bash
  local rc; _spawn "$id" "$mode"; rc=$?
  _reg_set "$id" started 1
  if [[ "$rc" -eq 3 || "$rc" -eq 4 ]]; then
    echo "ccd: ensure failed for $id (spawn rc $rc) — see $REG/$id.spawn" >&2
    return "$rc"
  fi
  echo "ensured $id ($mode)"
```

rc 2 keeps its success line deliberately: a login screen means the pane **is** up and a human has one step to take, which is what §3.3's table says the caller does with it.

- [ ] **Step 7: Run the gates**

Run: `bash -n ccd/ccd && cd server && ./node_modules/.bin/vitest run test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ccd-workspaces.test.ts test/ccd-archive.test.ts` (`timeout: 600000`)
Expected: PASS all. `ccd-login-screen.test.ts` is the one at risk: its `SPAWN_STUB` routes `has-session` to the `*)` arm, which logs and returns 0, so the new probe succeeds and its Down/Enter ordering assertion (which indexes `calls[downIdx + 1]`) is unaffected by the interleaved `has-session` lines. If any of its four `_spawn` wiring cases go red, reconcile there before proceeding — the stub, not the classifier, is what moved.

- [ ] **Step 8: Commit**

```bash
git add ccd/ccd server/test/ccd-spawn-verdict.test.ts
git commit -m "fix(ccd): a spawn reports what actually happened, and records it where another process can read it"
```

---

### Task 5: the human start path restores supervision instead of routing around it

Implements spec §3.1 and §3.2. `cmd_start` (ccd:6951) and `cmd_ensure` (ccd:6971) both call `_spawn` directly while `cmd_stop` (ccd:7101) is `systemctl --user disable --now` — so stop-then-start yields a tmux pane with **no unit**: no supervise loop, therefore no `_sync_uuid`, no `_auto_swap_check`, no `_auto_compact_check`, and no record when it dies. That is how `claude-corp-data-internal` ran 22 unsupervised minutes and died with nothing recording it, and M5 measured three rows still in the adjacent state. After this task the verbs ask the unit to spawn and wait on observables, `cmd_supervise` heals its own boot-persistence at entry, and the unit fails fast instead of looping invisibly.

Three things to carry into the diff. `cmd_swap`'s tail (ccd:7064) falls back to `cmd_ensure`, and after this task that fallback goes through the unit — which is correct and is precisely why §3.2 rejects `INVOCATION_ID` as the recursion guard: `_dispatch_swap` (ccd:6564) runs `ccd swap` inside its own transient `systemd-run` unit, a context that genuinely *should* reach systemd. `cmd_ws_add` (ccd:1123) and `cmd_ws_restore` (ccd:2183) keep their **supervision** wiring untouched: they call `_spawn` and then `_ws_supervise`, which is already `systemctl --user enable --now`, so they never had D2's missing-unit defect.

**They do, however, still discard `_spawn`'s return code, and this task must fix that.** Task 4's reviewer constructed the case against a real git repo with a stubbed spawn and got `cmd_ws_add rc=0` with the success line — `workspace demo-probe on claude — …` — printed over a session that never came up, immediately after `_spawn`'s own `the tmux session vanished during startup — nothing is running` warning. That is M6's silent success surviving on the workspace path, and it is exactly what §3.3's caller column forbids. It was not in the original scope of any task in this plan; it is folded in here because this task owns the start paths and the spawn-rc plumbing. Both verbs must capture the rc, refuse to print their success line on rc 3 or rc 4, and return non-zero — the same contract `cmd_start` and `cmd_ensure` now hold — and each needs a test that fails against the current code. And `cmd_stop` is untouched here — D3 adds its stamp and surface — but either way it emits the same `systemctl --user disable --now` argv that Test 1 below pins, and `ccd-workspaces.test.ts`'s two `cmd_stop` sequences must stay green.

**The start-limit keys go in `[Unit]`, not `[Service]`, and the spec's §3.3 sentence is wrong about that for the systemd the fleet host runs.** Measured on systemd 255 (`systemd-analyze verify`): `StartLimitIntervalSec=` in `[Service]` produces *"Unknown key name 'StartLimitIntervalSec' in section 'Service', ignoring"*, while `StartLimitBurst=` in `[Service]` is silently accepted for legacy compatibility. Following the spec literally would therefore honor the burst against systemd's **default 10 s** interval — a rate limit nobody chose, arrived at silently. Both keys go in `[Unit]`, and the test below pins the section.

**Files:**
- Modify: `ccd/ccd` — `SUPERVISED_START_WAIT` tunable beside `SPAWN_GATE_TRIES` (ccd:36); new `_have_systemctl` and `_supervised_start` immediately above `cmd_start`; `cmd_start` (ccd:6951); `cmd_ensure` (ccd:6971); `cmd_supervise` (ccd:6980); `cmd_enable` (ccd:7090)
- Modify: `ccd/claude-session@.service` (`[Unit]` gains the start limit, after `Wants=`)
- Test: `server/test/ccd-supervised-start.test.ts` (create)
- Test: `agent/test/deploy-verify.test.ts` (one `it` appended to `describe('the verification is actually wired into the deploy, and can observe a restart', …)`, after the RestartSec-window test at :217)

**Interfaces:**
- Consumes: Task 4's `$REG/<id>.spawn` = `<epoch> <rc>` and `_spawn`'s propagated rc; `SPAWN_GATE_TRIES`.
- Produces: `_supervised_start <id>` (rc 0 = a pane is alive), `_have_systemctl`, the `CCD_IN_UNIT` in-process guard, `SUPERVISED_START_WAIT`, and a unit that enters `failed` on a crash loop — which is the state §4.3 classifies `orphan` and §3.1's `reset-failed` is what reverses.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-supervised-start.test.ts`:

```ts
// §3.1/§3.2: the human start path goes through the unit instead of around it.
// Before this, `ccd stop` was `systemctl --user disable --now` and `ccd start`
// was a bare `_spawn`, so stop-then-start left a pane with no unit: no
// supervise loop, therefore no _sync_uuid, no _auto_swap_check, no
// _auto_compact_check, and nothing to record its death.
//
// The unit is modelled by ONE file, $HOME/pane-up: `systemctl … enable --now`
// creates it (that is what a unit does — starts a supervisor that spawns a
// pane), `disable --now` removes it, and `tmux has-session` answers from it.
// Every systemctl and tmux argv lands in $HOME/ccd-calls, which is where "left
// the unit enabled" reads its evidence. Nothing here reaches real systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-supstart-'); });
afterEach(() => { h.cleanup(); });

const UNIT = `sleep() { :; };
  systemctl() {
    echo "systemctl $*" >> "$HOME/ccd-calls"
    case "$*" in
      "--user enable --now "*)  : > "$HOME/pane-up" ;;
      "--user disable --now "*) rm -f "$HOME/pane-up" ;;
    esac
    return 0
  };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' '? for shortcuts' ;;
    esac
  };`;

/** A substrate where no pane ever appears. `cmd_supervise`'s watch loop then
 *  exits on its first `_alive`, which is what makes the supervisor's own
 *  startup observable without leaving a `while` running under the test. */
const NO_PANE = `sleep() { :; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in has-session) return 1 ;; capture-pane) printf '' ;; esac
  };`;

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

const sysCalls = (): string[] => h.calls().filter((c) => c.startsWith('systemctl '));

const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
};

/** The dispatcher run as a PROGRAM with tmux and systemctl shadowed on PATH —
 *  the only way to stub `cmd_attach`'s final `exec tmux attach`, which replaces
 *  the shell and so cannot see a shell function. Same idiom as
 *  ccd-archive.test.ts's runCcd, and through ghContainedEnv so this PATH cannot
 *  displace the poisoned `gh`. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const stub = path.join(h.home, 'stubbin');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'tmux'),
    '#!/bin/sh\necho "tmux $*" >> "$HOME/ccd-calls"\n'
    + 'case "$1" in\n'
    + '  has-session) [ -e "$HOME/pane-up" ] || exit 1 ;;\n'
    + "  capture-pane) printf '%s' '? for shortcuts' ;;\n"
    + 'esac\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'systemctl'),
    '#!/bin/sh\necho "systemctl $*" >> "$HOME/ccd-calls"\n'
    + 'case "$*" in\n  "--user enable --now "*) : > "$HOME/pane-up" ;;\nesac\nexit 0\n', { mode: 0o755 });
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

describe('stop then start leaves the unit ENABLED', () => {
  it('emits exactly disable --now, reset-failed, enable --now — never a bare `start`', () => {
    // THE defect, in one sequence. A `systemctl --user start` here would bring
    // the pane back with the unit still disabled — supervised until the next
    // reboot and then gone — which is the shape M5 measured three of. And
    // reset-failed must PRECEDE the enable: §3.3 deliberately creates failed
    // units, and a failed unit refuses to start until its failure is cleared,
    // so without that link the verb advertised as "what revives it" would not.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_stop claude2-demo; cmd_start claude2 demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user disable --now claude-session@claude2-demo',
      'systemctl --user reset-failed claude-session@claude2-demo',
      'systemctl --user enable --now claude-session@claude2-demo',
    ]);
    expect(out).toContain('started claude2-demo');
    // The verb did not spawn anything itself — the unit did.
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(false);
  });

  it('ccd enable is ccd start under another name — one enable, not a second act', () => {
    // §3.1: `enable` keeps its name because the agent whitelist and CCD_ARGV
    // grant both words separately and whitelist-subset layer 3 fails on a grant
    // no route builds. A leftover second `enable --now` in cmd_enable would be
    // a redundant systemd round-trip on every create.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_enable claude2 demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude2-demo',
      'systemctl --user enable --now claude-session@claude2-demo',
    ]);
    expect(out).toContain('enabled boot-persistence for claude2-demo');
  });
});

describe('the recursion guard is an in-process variable', () => {
  it('an ensure INSIDE the unit spawns directly and issues no systemctl at all', () => {
    // If ensure re-entered `systemctl start` on its own unit, the supervisor
    // would be asking systemd to start the thing systemd is currently starting.
    seed('myid');
    const out = h.sh(`${UNIT} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_ensure myid`);
    expect(out).toBe('ensured myid (new)');
    expect(sysCalls()).toEqual([]);
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
  });

  it('cmd_supervise heals its own boot-persistence at entry — enable, no --now — and its ensure adds nothing', () => {
    // §3.2's self-heal: creating the enable symlink is idempotent and safe from
    // inside the unit, and that one line fixes M5's three rows the next time
    // each supervisor restarts, with no fleet-wide scan. Exactly one systemctl
    // call, and it carries no `--now`: an `--now` here is the recursion.
    seed('myid');
    const r = shFail(`${NO_PANE} cmd_supervise myid`);
    expect(r.code).toBe(1);   // no session -> the watch loop exits for systemd
    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@myid']);
  });
});

describe('the start waits on observables', () => {
  it('reports the unit\'s own verdict, read from the registry rather than guessed', () => {
    // Task 4's $REG/<id>.spawn is the only channel from a spawn inside the
    // supervisor to a `ccd start` in another process. Here the "unit" spawns
    // and fails: no pane ever appears, and the stamp is what the verb reports.
    seed('myid');
    const r = shFail(`sleep() { :; };
      systemctl() {
        echo "systemctl $*" >> "$HOME/ccd-calls"
        case "$*" in "--user enable --now "*) echo "$(date +%s) 3" > "$REG/myid.spawn" ;; esac
        return 0
      };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
      cmd_ensure myid`);
    expect(r.code).toBe(3);
    expect(r.stdout).not.toContain('ensured');
    expect(r.stderr).toContain('failed to start: spawn rc 3');
  });

  it('a STALE failure stamp is not this call\'s verdict', () => {
    // Kills the mutant that drops the "newer than the moment we started" check
    // and reports the last failure this row ever had as though it were now's.
    // SUPERVISED_START_WAIT=3 so a lost bound fails fast instead of hanging.
    seed('myid');
    h.sh(`_reg_set myid spawn '1 3'`);
    const r = shFail(`${NO_PANE} SUPERVISED_START_WAIT=3; cmd_ensure myid`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no pane appeared within 3s');
    expect(r.stderr).not.toContain('spawn rc 3');
  });

  it('attach revives a dead row through the unit and lands on a pane that exists', () => {
    // ccd:7180 is `_alive || cmd_ensure` then `exec tmux attach` — delegating
    // the spawn made that asynchronous, so without the wait the attach races a
    // pane that is not there yet.
    seed('claude2-demo');
    const r = runCcd('attach', 'claude2', 'demo');
    expect(r.code).toBe(0);
    const calls = h.calls();
    const enableAt = calls.indexOf('systemctl --user enable --now claude-session@claude2-demo');
    const attachAt = calls.indexOf('tmux attach -t cc-claude2-demo');
    expect(enableAt).toBeGreaterThan(-1);
    expect(attachAt).toBeGreaterThan(enableAt);
  });
});

describe('when systemd is not there, the start still happens and says so', () => {
  it('falls back to a direct spawn and warns that nothing is watching', () => {
    // §3.1: a start that cannot be supervised is still better than no start; a
    // start that is SILENTLY unsupervised is the defect. _have_systemctl is its
    // own function for the reason _ws_supervise is: a test can stub it.
    seed('myid');
    const out = h.sh(`${UNIT} _have_systemctl() { return 1; }; rm -f "$HOME/pane-up"; cmd_ensure myid 2>&1`);
    expect(out).toContain('systemctl not found — starting myid UNSUPERVISED');
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    expect(sysCalls()).toEqual([]);
  });

  it('an enable that fails takes the same lane, warning and all', () => {
    // No unit installed, no lingering: `enable --now` is what answers non-zero,
    // and a silent swallow here is the old behavior wearing a new name.
    seed('myid');
    const out = h.sh(`sleep() { :; };
      systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; case "$2" in enable) return 1 ;; esac; return 0; };
      tmux() {
        echo "tmux $*" >> "$HOME/ccd-calls"
        case "$1" in
          new-session) : > "$HOME/pane-up" ;;
          has-session) [[ -e "$HOME/pane-up" ]] ;;
          capture-pane) printf '%s' '? for shortcuts' ;;
        esac
      };
      cmd_ensure myid 2>&1`);
    expect(out).toContain('could not enable unit claude-session@myid — starting myid UNSUPERVISED');
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts` (`timeout: 600000`)
Expected: FAIL — the first case reports the systemctl list as `[ 'systemctl --user disable --now claude-session@claude2-demo' ]` against the expected three, because `cmd_start` still spawns directly; the `_have_systemctl` cases fail with `_have_systemctl: command not found`.

- [ ] **Step 3: Add the wait bound, the probe, and `_supervised_start`**

In `ccd/ccd`, beside Task 4's tunable in the header block (ccd:36):

```bash
SUPERVISED_START_WAIT=30        # seconds `ccd start`/`ccd ensure` wait for the unit's pane to appear.
                                # A bound on FAILURE REPORTING, not a cost anybody normally pays: a
                                # pane shows up about a second after the unit starts.
```

Then, immediately **above** `cmd_start` (ccd:6951):

```bash
# Its own function for the same reason _ws_supervise and _ws_unsupervise are (ccd:212-216): a test
# harness can stub it, and `command -v` finds a shell function before it finds a binary, so nothing
# else could.
_have_systemctl() { command -v systemctl >/dev/null 2>&1; }

_supervised_start() {   # id — ask the UNIT to spawn, then WAIT for an observable verdict.
  # `ccd start`/`ccd ensure` outside a unit become `systemctl --user enable --now`, and the unit's
  # ExecStart (`ccd supervise %i`) does the spawning it already does. That is what makes a restarted
  # session a SUPERVISED one — with _sync_uuid, _auto_swap_check and _auto_compact_check running and
  # something to record its death — instead of the bare pane stop-then-start used to leave.
  #
  # `local a=1 b="$a"` does NOT see `a`: local expands all its arguments before assigning any of
  # them, and under `set -u` that is a fatal unbound-variable error. Hence the second line.
  local id="$1" since i st at rc unit
  unit="claude-session@$id"
  since=$(date +%s)
  if ! _have_systemctl; then
    echo "ccd: warn: systemctl not found — starting $id UNSUPERVISED (no auto-swap, no uuid-sync, nothing to restart it)" >&2
    local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
    _spawn "$id" "$mode"; rc=$?
    _reg_set "$id" started 1
    return "$rc"
  fi
  # §3.3 deliberately creates failed units — that is the point of the start limit — and a unit
  # sitting in `failed` refuses to start again until its failure is cleared. Without this, the very
  # verb §4.4 advertises as "what revives it" would not.
  systemctl --user reset-failed "$unit" 2>/dev/null
  if ! systemctl --user enable --now "$unit" 2>/dev/null; then
    echo "ccd: warn: could not enable unit $unit — starting $id UNSUPERVISED (unit installed? lingering?)" >&2
    local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
    _spawn "$id" "$mode"; rc=$?
    _reg_set "$id" started 1
    return "$rc"
  fi
  # `enable --now` returns when systemd has STARTED THE UNIT, not when a pane exists — but
  # `ccd attach` and `ccd menu` exec `tmux attach` on the next line, and §3.3 requires a failed
  # spawn to be reported rather than assumed. So wait on two observables: the pane (success, exactly
  # as today, since the TUI may still be working through a long resume) or a spawn stamp NEWER than
  # this call carrying a non-zero rc. The freshness test is what stops the last failure this row
  # ever had from being reported as this one's; a stale stamp written in the same second as `since`
  # can only mean an operator is retrying a session that is failing right now, where reporting the
  # failure is still the right answer.
  for i in $(seq 1 "$SUPERVISED_START_WAIT"); do
    _alive "$id" && return 0
    st=$(_reg_get "$id" spawn)
    if [[ -n "$st" ]]; then
      at="${st%% *}"; rc="${st##* }"
      if [[ "$at" =~ ^[0-9]+$ && "$at" -ge "$since" && "$rc" != 0 ]]; then
        echo "ccd: $id failed to start: spawn rc $rc (see $REG/$id.spawn)" >&2
        return "$rc"
      fi
    fi
    sleep 1
  done
  echo "ccd: $id: unit started but no pane appeared within ${SUPERVISED_START_WAIT}s — systemctl --user status $unit" >&2
  return 1
}

```

- [ ] **Step 4: Route the verbs through it**

Four edits. In `cmd_start` (ccd:6951), after `_ws_seed_home "$id" "$wrapper"` and **before** the `local mode=new` line Task 4 rewrote:

```bash
  if [[ "${CCD_IN_UNIT:-}" != 1 ]]; then
    _supervised_start "$id" || return $?
    # No `($mode)` and no `started` write here: neither is this process's to know. The spawn
    # happened inside the unit, and the in-unit cmd_ensure below is what recorded both.
    echo "started $id — discover on claude.ai by name: $id"
    return 0
  fi
```

In `cmd_ensure` (ccd:6971), directly after the `if _alive "$id"; then echo "alive: $id"; return 0; fi` line:

```bash
  # Inside the unit (cmd_supervise sets CCD_IN_UNIT in its own process) this IS the spawn; anywhere
  # else it is a REQUEST for one, and the request goes through the unit so the session comes back
  # supervised. `cmd_swap`'s tail (ccd:7064) reaches this from inside a transient systemd-run unit
  # and correctly takes the supervised branch — which is why the guard is not INVOCATION_ID.
  if [[ "${CCD_IN_UNIT:-}" != 1 ]]; then
    _supervised_start "$id" || return $?
    echo "ensured $id"
    return 0
  fi
```

In `cmd_supervise` (ccd:6980), replace `cmd_ensure "$id"` with:

```bash
  # §3.2's self-heal: creating the enable symlink is idempotent and safe from inside the unit
  # (`enable` without `--now` asks systemd for nothing else), and this one line heals M5's three
  # boot-persistence-less rows the next time each supervisor restarts — which the deploy's
  # `try-restart "claude-session@*"` sweep makes fleet-wide and automatic.
  systemctl --user enable "claude-session@$id" 2>/dev/null \
    || echo "ccd: warn: could not enable boot-persistence for $id" >&2
  # The recursion guard, in-process. `local` is dynamically scoped in bash, so cmd_ensure sees it
  # and the caller does not; it is never exported and never an argv token, so — unlike an added
  # argv word, which the agent's prefix-matching exec whitelist would permit — it is not
  # addressable from the wire at all.
  local CCD_IN_UNIT=1
  cmd_ensure "$id"
```

And `cmd_enable` (ccd:7090) collapses to what it now is:

```bash
cmd_enable() {   # start (if needed) + make boot-persistent + supervise now
  # Behaviorally an ALIAS of cmd_start since §3.1 — the start path itself is
  # `systemctl --user enable --now`, so there is no second act left for this verb to perform. It
  # keeps its name because the agent whitelist and CCD_ARGV grant `enable` and `start` separately,
  # and whitelist-subset.test.ts layer 3 fails on a grant no route builds.
  local wrapper="${1:?}" project="${2:?}" workdir="${3:-}"
  cmd_start "$wrapper" "$project" "$workdir" || return $?
  echo "enabled boot-persistence for $(_id "$wrapper" "$project")"
}
```

- [ ] **Step 5: Run the ccd tests**

Run: `bash -n ccd/ccd && cd server && ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ccd-workspaces.test.ts test/ccd-archive.test.ts` (`timeout: 600000`)
Expected: PASS all. `ccd-workspaces.test.ts`'s two `cmd_stop` argv sequences are the ones to watch — this task does not touch `cmd_stop`, so they must be untouched too.

- [ ] **Step 6: Write the failing unit-file test**

Append to `describe('the verification is actually wired into the deploy, and can observe a restart', …)` in `agent/test/deploy-verify.test.ts`, after the `it('the observation window is longer than EVERY unit's RestartSec…')` case:

```ts
  it('a session that dies instantly becomes a FAILED unit — and the keys sit in [Unit], where systemd reads them', () => {
    // Spec §3.3. The section is not cosmetic, and the spec's own sentence ("the
    // unit's [Service] gains…") is wrong for the systemd this fleet runs.
    // Measured on systemd 255 with `systemd-analyze verify`:
    //   StartLimitIntervalSec= in [Service] -> "Unknown key name
    //     'StartLimitIntervalSec' in section 'Service', ignoring."
    //   StartLimitBurst=       in [Service] -> silently accepted (legacy compat)
    // Split across the two sections, the burst would be honored against
    // systemd's DEFAULT 10s interval: a rate limit nobody chose, arrived at
    // without a word. Both keys live in [Unit].
    const unit = readFileSync(path.join(deployDir, '..', 'ccd', 'claude-session@.service'), 'utf8');
    const unitSection = /\[Unit\]([\s\S]*?)(?=\n\[)/.exec(unit)?.[1] ?? '';
    expect(unitSection).toMatch(/^StartLimitIntervalSec=\d+$/m);
    expect(unitSection).toMatch(/^StartLimitBurst=\d+$/m);
    expect(/^StartLimit/m.test(unit.slice(unit.indexOf('[Service]'))),
      'a StartLimit key sits in [Service], where systemd 255 ignores it').toBe(false);
    // And the limit must be reachable at THIS unit's restart cadence or it is
    // decoration: RestartSec=3 means a crash loop spends ~3s per attempt, so
    // the whole burst has to fit inside the interval.
    const burst = Number(/^StartLimitBurst=(\d+)$/m.exec(unitSection)![1]);
    const interval = Number(/^StartLimitIntervalSec=(\d+)$/m.exec(unitSection)![1]);
    const restartSec = Number(/^RestartSec=(\d+)$/m.exec(unit)![1]);
    expect(burst * restartSec, 'the burst cannot be spent inside the interval — the unit never fails')
      .toBeLessThan(interval);
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts -t 'FAILED unit'` (`timeout: 600000`)
Expected: FAIL — `expected '\nDescription=Durable Claude Code session…' to match /^StartLimitIntervalSec=\d+$/m`

- [ ] **Step 8: Add the start limit to the unit**

In `ccd/claude-session@.service`, in `[Unit]`, after `Wants=network-online.target`:

```ini
# A session whose pane dies instantly must become a FAILED unit rather than an
# invisible restart loop (spec §3.3): with RestartSec=3 a crash loop spends its
# 5 starts in ~15s, well inside this 120s window, and systemd stops trying. A
# failed unit heartbeats nothing, so §4.3 classifies the row `orphan` — nothing
# is bringing this back — and `ccd start <id>` is what would: its
# `systemctl --user reset-failed` (§3.1) is what makes that sentence true
# rather than aspirational.
#
# These two keys belong to [Unit], not [Service]. Measured on systemd 255 with
# `systemd-analyze verify`: StartLimitIntervalSec= in [Service] is reported
# "Unknown key name … ignoring", while StartLimitBurst= there is still accepted
# for legacy compatibility — so splitting them would honor the burst against
# systemd's DEFAULT 10s interval, a limit nobody chose.
StartLimitIntervalSec=120
StartLimitBurst=5
```

Reconcile against the live file: the `[Unit]` section carries `Description=`, `After=network-online.target tailscaled.service` and `Wants=network-online.target`, and `[Service]` keeps `Type=simple`, `ExecStart=%h/.local/bin/ccd supervise %i`, `Restart=always`, `RestartSec=3`, `TimeoutStartSec=90` and `KillMode=process` unchanged — `KillMode=process` in particular, since the deploy's supervisor sweep depends on the tmux substrate surviving a supervisor restart.

- [ ] **Step 9: Run the gates**

Run: `bash -n ccd/ccd && systemd-analyze verify ccd/claude-session@.service` — Expected: no line naming `claude-session@.service` (other units on this box may warn; ignore anything not naming this file)
Run: `cd server && ./node_modules/.bin/vitest run test/ccd-supervised-start.test.ts test/ccd-spawn-verdict.test.ts test/ccd-login-screen.test.ts test/ccd-workspaces.test.ts test/ccd-archive.test.ts` (`timeout: 600000`) — Expected: PASS
Run: `cd agent && ./node_modules/.bin/vitest run test/deploy-verify.test.ts` (`timeout: 600000`) — Expected: PASS (the RestartSec-window test reads the same unit and must stay green)

- [ ] **Step 10: Commit**

```bash
git add ccd/ccd ccd/claude-session@.service server/test/ccd-supervised-start.test.ts agent/test/deploy-verify.test.ts
git commit -m "fix(ccd): a human start goes through the unit, so the session that comes back is a supervised one"
```

---

### Task 6: start stops minting a second id for a swapped session

This implements spec §3.4, the second half of D2. `cmd_start` (ccd:6959) and `cmd_enable` (ccd:7098) only take `<wrapper> <project>`, and they recompute the id from those two words. A session keeps the id it was born with across every swap — `claude2-expoAI-assistant` is still that id while its `wrapper` field reads `claude-dev0` — so an operator reading the account off the board and typing it back **mints a second id** for a session that already exists. Worse, `cmd_start` then unconditionally `_reg_set`s `wrapper` from its argument (ccd:6971), pointing the row at a config dir that does not hold the transcript: exactly the shape of the 2026-08-11 incident, one verb later. `cmd_stop` grew the one-argument id form for the same reason and records it in its own comment (ccd:7109-7118); this task gives `start` and `enable` the same form, and makes the registry's account win over the argument.

**Files:**
- Modify: `ccd/ccd` — `cmd_start` (ccd:6959-6977, whole body replaced), `cmd_enable` (ccd:7098-7107, whole body replaced)
- Test: `server/test/ccd-start-id.test.ts` (create)

**Interfaces:**
- Consumes: `_supervised_start <id>` (the unit-driven start from §3.1) and the `rm -f "$REG/$id.swapblocked"` clear, both already in `cmd_start` when this task begins.
- Produces: `ccd start <id>` / `ccd enable <id>` one-argument forms; the invariant that **only `ccd swap` writes `$REG/<id>.wrapper`** for an existing row. §4.4's revive story ("`ccd start <id>` is what would bring this back") depends on both.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-start-id.test.ts`:

```ts
/**
 * `ccd start <id>` / `ccd enable <id>` — the one-argument form, and a start
 * that stops rewriting the account (spec §3.4, D2).
 *
 * Two defects, one verb. `<wrapper> <project>` recomputes `<wrapper>-<project>`,
 * but a session keeps its birth id across every swap, so an operator reading
 * `claude-dev0` off the board and typing it back mints a SECOND row. And the
 * unconditional `_reg_set wrapper` then pointed the ORIGINAL row at an account
 * whose config dir does not hold its transcript — the 21:32 incident's own
 * mechanism, reachable from a keyboard.
 *
 * Nothing here may reach systemd or tmux: `_supervised_start` (§3.1) logs its
 * argv instead, and `_alive` answers "no" so every case takes the start path
 * rather than the already-running short-circuit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-start-id-'); });
afterEach(() => { h.cleanup(); });

const STUBS = `_supervised_start() { echo "supervised_start $*" >> "$HOME/ccd-calls"; }; `
  + `_alive() { return 1; };`;

/** The harness's own `sh` pipes stderr straight to the parent, and the warning
 *  under test is emitted on a SUCCESSFUL run — so this runner captures all
 *  three. `timeout` so a parse bug hangs the case, not the suite. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** A registry row exactly as the incident left it: the id says `claude2`, the
 *  `wrapper` field says `claude-dev0`, because auto-swap moved it. */
const seedRow = (id: string, wrapper: string, project: string): void => {
  fs.mkdirSync(path.join(h.home, 'projects', project), { recursive: true });
  h.sh(`_reg_set ${id} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199
    _reg_set ${id} project ${project}
    _reg_set ${id} workdir "$HOME/projects/${project}"
    _reg_set ${id} wrapper ${wrapper}
    _reg_set ${id} started 1`);
};

describe('ccd start — the one-argument id form', () => {
  it('starts the id it was given whole, without re-deriving one', () => {
    // Kills the mutant that still runs `_id "$1" "$2"` on a single argument:
    // that starts `<id>-` (or dies), never the row the operator named.
    seedRow('claude2-expoAI-assistant', 'claude-dev0', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_start claude2-expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(h.calls()).toEqual(['supervised_start claude2-expoAI-assistant']);
    expect(r.stdout).toContain('started claude2-expoAI-assistant (resume)');
    // A workspace id (`<project>-<slug>`, no wrapper prefix) is the case the
    // two-argument form cannot express at all.
    expect(h.reg('claude2-expoAI-assistant', 'wrapper')).toBe('claude-dev0');
  });

  it('refuses a single argument it has no row for, and says how to create one', () => {
    // Kills the mutant that invents `PROJECTS_ROOT/<id>`: there is no workdir
    // to derive from an id alone, so the refusal names the creating form.
    const r = run(`${STUBS} cmd_start never-seen-this`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("no registry for 'never-seen-this'");
    expect(r.stderr).toContain('ccd start <wrapper> <project> [workdir]');
    expect(h.calls()).toEqual([]);
  });

  it('refuses an empty argv with a usage line naming both forms', () => {
    const r = run(`${STUBS} cmd_start`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd start <id> | ccd start <wrapper> <project> [workdir]');
  });

  it('rejects an id shape that would escape the registry directory', () => {
    // Same guard, same spelling as cmd_forget/cmd_ws_hold: the id becomes a
    // path under $REG.
    const r = run(`${STUBS} cmd_start '../../etc'`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('bad session id');
  });
});

describe('ccd start — the registry account wins over the argument', () => {
  it('leaves wrapper alone and warns when the two-argument form disagrees', () => {
    // THE INCIDENT, exactly: auto-swap moved claude2-expoAI-assistant to
    // claude-dev0; the operator typed the account off the board back in; the
    // unconditional `_reg_set wrapper` pointed the row at a config dir that
    // does not hold the transcript. Kills the mutant that keeps the write.
    seedRow('claude2-expoAI-assistant', 'claude-dev0', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_start claude2 expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(h.reg('claude2-expoAI-assistant', 'wrapper')).toBe('claude-dev0');
    expect(r.stderr).toContain('lives on claude-dev0, not claude2');
    expect(r.stderr).toContain('ccd swap claude2-expoAI-assistant claude2');
    // And it really started — a refusal here would strand the row.
    expect(h.calls()).toEqual(['supervised_start claude2-expoAI-assistant']);
  });

  it('does not warn when the argument agrees with the row', () => {
    // Kills the mutant that warns unconditionally, which teaches the operator
    // to ignore the one warning that matters.
    seedRow('claude2-expoAI-assistant', 'claude2', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_start claude2 expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain('warn');
  });

  it('still creates a brand-new session from the two-argument form', () => {
    // The id form cannot create; this path still can, and the account it
    // names is the one that lands. Kills an over-eager "registry always wins"
    // that would leave a new row with no wrapper at all.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    const r = run(`${STUBS} cmd_start claude-corp demo`);
    expect(r.code).toBe(0);
    expect(h.reg('claude-corp-demo', 'wrapper')).toBe('claude-corp');
    expect(h.reg('claude-corp-demo', 'workdir')).toBe(path.join(h.home, 'projects', 'demo'));
    expect(h.reg('claude-corp-demo', 'started')).toBe('1');
    expect(r.stdout).toContain('started claude-corp-demo (new)');
  });

  it('honours an explicit workdir on the creating form', () => {
    fs.mkdirSync(path.join(h.home, 'elsewhere'), { recursive: true });
    const r = run(`${STUBS} cmd_start claude-corp demo "$HOME/elsewhere"`);
    expect(r.code).toBe(0);
    expect(h.reg('claude-corp-demo', 'workdir')).toBe(path.join(h.home, 'elsewhere'));
  });
});

describe('ccd enable', () => {
  it('takes the id form too — after §3.1 the two verbs are one act', () => {
    seedRow('claude2-expoAI-assistant', 'claude-dev0', 'expoAI-assistant');
    const r = run(`${STUBS} cmd_enable claude2-expoAI-assistant`);
    expect(r.code).toBe(0);
    expect(h.calls()).toEqual(['supervised_start claude2-expoAI-assistant']);
  });

  it('keeps its own usage line rather than borrowing start\'s', () => {
    // The verb is NOT retired: the agent whitelist and CCD_ARGV grant `start`
    // and `enable` separately, and layer 3 of whitelist-subset.test.ts fails
    // on a grant no route builds. If it stays, it answers as itself.
    const r = run(`${STUBS} cmd_enable`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd enable <id> | ccd enable <wrapper> <project> [workdir]');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-start-id.test.ts` (`timeout: 600000`)
Expected: FAIL — the first case dies at `ccd: usage: ccd start <wrapper> <project> [workdir]` (today's one-argument refusal), and the disagreement case reports `expected 'claude2' to be 'claude-dev0'`. Confirm both failure texts before proceeding.

- [ ] **Step 3: Rewrite `cmd_start`**

Replace the whole of `cmd_start` (ccd:6959-6977). This block is **shape-authoritative, not text-authoritative**: `_supervised_start "$id"` and the `swapblocked` clear are §3.1's lines, already present when this task runs — reconcile the tail against the live tree rather than reverting it to `_spawn`.

```bash
cmd_start() {   # <id>  |  <wrapper> <project> [workdir]
  # THE ONE-ARGUMENT FORM IS THE CORRECT ONE FOR ANYTHING THAT ALREADY EXISTS.
  # `<wrapper> <project>` recomputes `<wrapper>-<project>`, and a session keeps
  # the id it was born with across every swap — `claude2-expoAI-assistant` is
  # still that id while its `wrapper` field reads `claude-dev0`. So an operator
  # reading the account off the board and typing it back MINTS A SECOND ID for
  # a session that already exists. `cmd_stop` grew this form first, for the
  # same reason, and its own comment records it.
  #
  # There is no id form for CREATION: a new session needs an account and a
  # project, and there is NO WORKDIR TO INVENT from an id alone. A single
  # argument with no registry row is therefore refused with the creating
  # form's usage in the message, never resolved to `$PROJECTS_ROOT/<id>`.
  local id wrapper="" project="" workdir=""
  if [[ $# -ge 2 ]]; then
    wrapper="$1"; project="$2"; workdir="${3:-}"
    [[ -n "$wrapper" && -n "$project" ]] \
      || die "usage: ccd start <id> | ccd start <wrapper> <project> [workdir]"
    _is_valid_wrapper "$wrapper" || die "unknown wrapper '$wrapper' (valid: ${VALID_WRAPPERS[*]})"
    [[ "$project" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid project '$project' (allowed chars: A-Za-z0-9 . _ -)"
    id=$(_id "$wrapper" "$project")
  else
    id="${1:?usage: ccd start <id> | ccd start <wrapper> <project> [workdir]}"
    # The id becomes a path under $REG, so its shape is checked exactly as
    # cmd_forget and cmd_ws_hold check theirs.
    [[ "$id" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad session id"
    [[ -f "$REG/$id.uuid" ]] \
      || die "no registry for '$id' — a new session needs its account and project: ccd start <wrapper> <project> [workdir]"
  fi

  # THE REGISTRY WINS OVER THE ARGUMENT, FOR THE ACCOUNT ONLY (spec §3.4).
  # `_reg_set "$id" wrapper "$wrapper"` used to be unconditional, so
  # `ccd start claude2 expoAI-assistant` on a session auto-swap had moved to
  # claude-dev0 rewrote the row to an account whose config dir does not hold
  # the transcript — the resumed session then finds no history under the very
  # account it was just told it lives on. `ccd swap` is the ONLY verb that
  # moves a session between accounts; a differing argument is a warning, and
  # the warning names the verb that would actually do what was asked.
  local regw; regw=$(_reg_get "$id" wrapper)
  if [[ -n "$regw" ]]; then
    [[ -z "$wrapper" || "$wrapper" == "$regw" ]] \
      || echo "ccd: warn: $id lives on $regw, not $wrapper — starting it on $regw (to move it: ccd swap $id $wrapper)" >&2
    wrapper="$regw"
  fi
  [[ -n "$wrapper" ]] || die "no wrapper recorded for '$id' and none given"
  [[ -x "$WRAPPER_DIR/$wrapper" ]] || die "wrapper missing: $WRAPPER_DIR/$wrapper"

  # The workdir stays the creating form's third argument to set. An id alone
  # carries no directory, so the id form READS what the row already has and
  # writes nothing back over it.
  if [[ -n "$project" ]]; then
    [[ -z "$workdir" ]] && workdir="$PROJECTS_ROOT/$project"
  else
    project=$(_reg_get "$id" project); workdir=$(_reg_get "$id" workdir)
  fi
  [[ "$workdir" != *\'* ]] || die "workdir must not contain a single quote: $workdir"
  [[ -d "$workdir" ]] || die "workdir missing: $workdir"

  if _alive "$id"; then echo "already running: $id (find on claude.ai by name: $id)"; return 0; fi
  local uuid; uuid=$(_reg_get "$id" uuid); [[ -z "$uuid" ]] && uuid=$(cat /proc/sys/kernel/random/uuid)
  _reg_set "$id" wrapper "$wrapper"
  [[ -n "$project" ]] && _reg_set "$id" project "$project"
  _reg_set "$id" workdir "$workdir"; _reg_set "$id" uuid "$uuid"
  _ws_seed_home "$id" "$wrapper"
  local mode=new; [[ "$(_reg_get "$id" started)" == "1" ]] && mode=resume
  # A deliberate revival supersedes a refused swap's banner (§2.4).
  rm -f "$REG/$id.swapblocked"
  _supervised_start "$id"; _reg_set "$id" started 1
  echo "started $id ($mode) — discover on claude.ai by name: $id"
}
```

- [ ] **Step 4: Rewrite `cmd_enable`**

Replace the whole of `cmd_enable` (ccd:7098-7107):

```bash
cmd_enable() {   # <id>  |  <wrapper> <project> [workdir]
  # §3.1 made `start` go through the unit, so `enable` is now the same act.
  # The word is NOT retired and this is NOT dead code: the agent's exec
  # whitelist and `CCD_ARGV` grant `start` and `enable` separately, and layer
  # 3 of whitelist-subset.test.ts fails on a grant no route builds. It stays
  # as one delegation, with its own usage line so a mistyped `ccd enable`
  # answers as the verb the operator actually typed.
  [[ $# -ge 1 ]] || die "usage: ccd enable <id> | ccd enable <wrapper> <project> [workdir]"
  cmd_start "$@"
}
```

- [ ] **Step 5: Run the gates**

Run:
```bash
bash -n ccd/ccd \
  && cd server && ./node_modules/.bin/vitest run \
       test/ccd-start-id.test.ts test/ccd-workspaces.test.ts test/ccd-forget.test.ts \
       test/verb-gate.test.ts test/whitelist-subset.test.ts test/lifecycle.test.ts
```
(`timeout: 600000`) — Expected: PASS all. `lifecycle.test.ts:62` pins `['enable', 'claude', 'foo']` as the argv `POST /api/sessions` builds, and the two-argument form is unchanged, so it must stay green; `verb-gate` and `whitelist-subset` are the drift pins — this task adds **no verb**, so any movement there is a mistake, not a migration.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-start-id.test.ts
git commit -m "fix(ccd): start takes the id a swapped session actually has, and stops rewriting its account"
```

---

### Task 7: a deliberate stop becomes a fact, and ccd ls stops conflating three kinds of dead

This implements spec §4.1, §4.2 and the ccd half of §4.3/§4.4 — D3. Nothing reconciles registry rows against reality: `ccd ls` prints `ALIVE=no` for a session somebody deliberately stopped, one that died unwatched, and one that never started. Three different facts, one word — and at 21:39:53 on 2026-08-11 the first of the three was indistinguishable from the second. Two one-line changes at the `_ws_supervise`/`_ws_unsupervise` choke point (ccd:216-218) cover **every** stop path in the file: `ws-rm` (ccd:1289), `ws-archive` (ccd:1814), `ws-reap` (ccd:5681) and `forget` (ccd:7163) already reach systemd through it, and `cmd_stop` (ccd:7109) is rewritten to join them. `cmd_supervise` (ccd:6988) publishes a heartbeat because the server cannot ask systemd anything (§4.2), and `_session_state` is the bash twin of §4.3's classifier that `cmd_ls` (ccd:7169) prints.

Two decisions worth reading before the code. **`cmd_stop` keeps its own `tmux kill-session` line** rather than moving it into `_ws_unsupervise`: every other call site already runs the pair `_ws_unsupervise` then `tmux kill-session`, so folding the kill inward would double-kill at five sites and change observable `calls()` ordering that four suites pin. What is removed from `cmd_stop` is the *inlined systemctl*, so the stamp cannot be bypassed. **`_spawn` clears `.stopped` on attempt, not on success** — a slight tightening of the contract's "any successful spawn", and the honest one: a failed revival should classify `orphan` ("nothing is watching this, and `ccd start <id>` is what would"), not `stopped` ("somebody stopped it"), and the failure rc is recorded separately in `$REG/<id>.spawn`.

**Files:**
- Modify: `ccd/ccd` — `_ws_supervise` / `_ws_unsupervise` (ccd:216-218, both bodies replaced); new `_session_state` inserted directly after them; `_spawn` (ccd:6900, one line after the registry-completeness guard); `cmd_supervise` (ccd:6988-6994, two `_reg_set … supervised` additions); `cmd_swap` (ccd:7020, two re-stamps); `cmd_stop` (ccd:7109-7126, whole body replaced); `cmd_ls` (ccd:7169-7182, ALIVE column becomes STATE)
- Test: `server/test/ccd-session-state.test.ts` (create)

**Interfaces:**
- Consumes: `CCD_IN_UNIT=1` and the `systemctl --user enable` self-heal already in `cmd_supervise` (§3.2); the `$REG/<id>.spawn` verdict already in `_spawn` (§3.1); `cmd_swap`'s post-D1 body with its uuid locator and carry.
- Produces: `$REG/<id>.stopped` = `<epoch> <surface>`, surface ∈ `cli pwa agent ccd unknown`; `$REG/<id>.supervised` = `<epoch>`, freshness window 120 s, heartbeat 30 s; `_ws_unsupervise <id> [surface]`; `_session_state <id>` → `running|unsupervised|stopped|restarting|orphan|never-started`; `ccd stop [--surface <word>]`. The server-side `sessionLifecycle` and its cross-language fixture, the four new `buildRecord` reads, and `CCD_ARGV`'s `--surface` enrolment in `whitelist-subset.test.ts`'s `EXPECTED` all consume these and land in later tasks. The agent's exec whitelist already grants `['stop']` as an argv **prefix** (`agent/src/whitelist.ts:311`), so `--surface` needs no new grant.

- [ ] **Step 1: Write the failing tests**

Create `server/test/ccd-session-state.test.ts`:

```ts
/**
 * D3: a deliberate stop becomes a recorded fact, supervision is measured by a
 * heartbeat, and a dead row says WHICH KIND of dead it is (spec §4.1-§4.4).
 *
 * On 2026-08-11 an agent-surface `stop` removed a session's boot persistence
 * and the row went dead-but-listed, indistinguishable from a crash. Meanwhile
 * a second session ran for 22 minutes with a tmux pane and NO systemd unit —
 * no auto-swap, no uuid-sync, no auto-compact — and died with nothing
 * recording that it had. `ALIVE=no` was the one word `ccd ls` had for both,
 * plus for a row that had never started at all.
 *
 * The server cannot ask systemd anything (the agent's read whitelist permits
 * ~/.cc-sessions and ~/.claude*, not ~/.config/systemd), so the supervisor
 * PUBLISHES what it knows and both sides read one directory. These tests drive
 * the bash twin; the TypeScript twin and the shared fixture land later.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-session-state-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-mesa';
const REGDIR = (): string => path.join(h.home, '.cc-sessions');

/** Captures stderr on a SUCCESSFUL run too (the harness's `sh` pipes it to the
 *  parent), and times out so an argv-parse bug hangs one case, not the suite. */
const run = (snippet: string): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${snippet}`], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }),
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

describe('_ws_unsupervise records a deliberate stop', () => {
  const NOSYS = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; };`;

  it('stamps epoch plus the default surface `ccd`, and drops the heartbeat', () => {
    // The default is `ccd` because the four internal call sites — ws-rm,
    // ws-archive, ws-reap and forget — ARE ccd acting on its own account.
    // Kills the mutant that stamps nowhere but cmd_stop: without the stamp
    // inside this choke point every archived workspace classifies `orphan`
    // for ever.
    fs.writeFileSync(path.join(REGDIR(), `${ID}.supervised`), String(Math.floor(Date.now() / 1000)));
    h.sh(`${NOSYS} _ws_unsupervise ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} ccd$/);
    expect(h.reg(ID, 'supervised')).toBeNull();
    expect(h.calls()).toEqual([`systemctl --user disable --now claude-session@${ID}`]);
  });

  it('records the surface it was handed', () => {
    h.sh(`${NOSYS} _ws_unsupervise ${ID} pwa`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} pwa$/);
  });

  it('normalizes a word outside the closed set to `unknown` — it is text off the wire', () => {
    // Kills the mutant that writes the caller's word through unvalidated,
    // which would put arbitrary wire text (spaces and all) into a registry
    // field the server parses as two fields.
    expect(h.sh(`${NOSYS} _ws_unsupervise ${ID} 'pwa hax'; cat "$REG/${ID}.stopped"`))
      .toMatch(/^\d{10} unknown$/);
  });

  it('stamps even when systemd refuses — the intent is a fact either way', () => {
    // The disable is already swallowed (`2>/dev/null || true`), so a box with
    // no lingering must still record that somebody stopped this row. Kills
    // the mutant that stamps only after a successful systemctl.
    h.sh(`systemctl() { return 1; }; _ws_unsupervise ${ID} cli`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
  });

  it('_ws_supervise clears the stamp — supervision supersedes an earlier stop', () => {
    h.sh(`${NOSYS} _ws_unsupervise ${ID} pwa`);
    h.sh(`${NOSYS} _ws_supervise ${ID}`);
    expect(h.reg(ID, 'stopped')).toBeNull();
  });

  it('a spawn clears it too — a revival supersedes the stop, even a failed one', () => {
    // Attempt, not success: a spawn that fails should classify `orphan`
    // ("nothing is watching this; ccd start <id> is what would"), never
    // `stopped` ("somebody stopped it"). The rc is recorded separately in
    // $REG/<id>.spawn by §3.1.
    h.sh(`_reg_set ${ID} wrapper claude2
      _reg_set ${ID} workdir "$HOME"
      _reg_set ${ID} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199`);
    h.sh(`systemctl() { :; }; _ws_unsupervise ${ID} agent`);
    expect(h.reg(ID, 'stopped')).not.toBeNull();
    h.sh(`_accept_first_run_prompts() { return 0; }; _inject_spawn_effort() { :; };
      tmux() { :; }; _spawn ${ID} resume`);
    expect(h.reg(ID, 'stopped')).toBeNull();
  });
});

describe('cmd_stop', () => {
  const STOP = `systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; `
    + `tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; };`;

  it('strips the flag BEFORE the arity rule — `ccd stop <id> --surface pwa` is a one-id stop', () => {
    // THE case that breaks if the order is wrong: with the flag still in
    // argv, `$# -ge 2` reads this as a two-argument stop and `_id` mints
    // `<id>---surface`, aiming the stop at a session that does not exist
    // while the real one keeps running.
    expect(h.sh(`${STOP} cmd_stop ${ID} --surface pwa`)).toBe(`stopped ${ID}`);
    expect(h.calls()).toEqual([
      `systemctl --user disable --now claude-session@${ID}`,
      `tmux kill-session -t cc-${ID}`,
    ]);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} pwa$/);
  });

  it('takes the flag before the id as well', () => {
    expect(h.sh(`${STOP} cmd_stop --surface agent ${ID}`)).toBe(`stopped ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} agent$/);
  });

  it('still recomputes <wrapper>-<project> for the legacy two-argument form, flag and all', () => {
    expect(h.sh(`${STOP} cmd_stop claude2 demo --surface pwa`)).toBe('stopped claude2-demo');
    expect(h.reg('claude2-demo', 'stopped')).toMatch(/^\d{10} pwa$/);
  });

  it('records `cli` when nobody declared a surface', () => {
    // A declaration, not an authentication. A session shelling `ccd stop`
    // from its own Bash tool passes no flag and is honestly `cli` — which is
    // exactly what it looks like from the box. Kills the mutant that lets
    // cmd_stop fall through to _ws_unsupervise's internal `ccd` default.
    h.sh(`${STOP} cmd_stop ${ID}`);
    expect(h.reg(ID, 'stopped')).toMatch(/^\d{10} cli$/);
  });

  it('refuses a --surface with nothing after it instead of spinning on a failed shift', () => {
    // ccd runs under `set -uo pipefail` with NO `-e`: a bare `shift 2` at the
    // end of argv fails, shifts nothing, and the parse loop never terminates.
    const r = run(`${STOP} cmd_stop ${ID} --surface`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
  });

  it('refuses an empty argv once the flags are gone', () => {
    const r = run(`${STOP} cmd_stop --surface pwa`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd stop');
  });
});

describe('the supervisor heartbeat', () => {
  it('stamps BEFORE cmd_ensure, which can block for fifteen minutes', () => {
    // §4.2: cmd_ensure sits inside _accept_first_run_prompts for up to 15
    // minutes while a 700k-token resume works through its gates. A heartbeat
    // that started with the watch loop would classify every large resume
    // `unsupervised` — the loudest possible false alarm, fired precisely when
    // the fleet is doing the most work. The stub reads the stamp from inside
    // ensure, so "after" cannot pass.
    h.sh(`_reg_set ${ID} uuid u`);
    const r = run(`_alive() { return 1; }; systemctl() { :; }; sleep() { :; };
      cmd_ensure() { echo "ensure saw: $(cat "$HOME/.cc-sessions/$1.supervised" 2>/dev/null || echo none)"; };
      cmd_supervise ${ID}`);
    expect(r.stdout).toMatch(/ensure saw: \d{10}/);
  });

  it('re-stamps from the watch loop, not only at entry', () => {
    // The loop ticks every 5s and the freshness window is 120s, so a
    // supervisor that stamped once at entry would go stale UNDER ITS OWN
    // LIVE SESSION after two minutes. Eight simulated ticks cross the 30s
    // beat exactly once: entry stamp + one loop stamp = 2.
    h.sh(`_reg_set ${ID} uuid u`);
    run(`n=0; _alive() { n=$((n+1)); (( n <= 8 )); };
      systemctl() { :; }; sleep() { :; }; cmd_ensure() { :; };
      _sync_uuid() { :; }; _auto_swap_check() { :; }; _auto_compact_check() { :; };
      _reg_set() { printf '%s' "$3" > "$REG/$1.$2"; echo "stamp $2" >> "$HOME/ccd-calls"; };
      cmd_supervise ${ID}`);
    expect(h.calls().filter((l) => l === 'stamp supervised').length).toBe(2);
  });

  it('a swap re-stamps while it carries, so the window classifies `restarting`', () => {
    // §4.2: cmd_swap stops the unit, carries the files and starts it again.
    // Between those the row is not alive and, after 120s of a `cp -a`
    // fallback over a 188MB sidecar, would stop looking watched — "the fleet
    // marked a session abandoned while it was being carefully moved". No
    // `.supervised` is planted here, so the only stamp is the swap's own:
    // delete the re-stamps and this reads `orphan`.
    fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
    h.sh(`_reg_set ${ID} uuid b7001948-0000-4c2f-9a1b-0cfc0dc3d199
      _reg_set ${ID} project demo
      _reg_set ${ID} workdir "$HOME/projects/demo"
      _reg_set ${ID} wrapper claude-dev0
      _reg_set ${ID} started 1`);
    // A real transcript where the post-D1 locator will find it, so the swap
    // carries rather than refusing (§2.4).
    h.sh(`wd=$(readlink -f "$HOME/projects/demo"); mdir=$(echo "$wd" | tr '/._' '---')
      mkdir -p "$HOME/.claude-dev0/projects/$mdir"
      printf '{"type":"message"}\\n' > "$HOME/.claude-dev0/projects/$mdir/b7001948-0000-4c2f-9a1b-0cfc0dc3d199.jsonl"`);
    run(`CCD_SWAP_DETACHED=1
      _alive() { return 1; }; tmux() { :; }; cmd_ensure() { :; }; sleep() { :; };
      systemctl() { [[ "$*" == *"start claude-session@"* ]] \
        && echo "start:$(_session_state ${ID})" >> "$HOME/ccd-calls"; return 0; };
      cmd_swap ${ID} claude2`);
    expect(h.calls()).toContain('start:restarting');
  });
});

describe('_session_state drives §4.3\'s table', () => {
  /** Plant exactly the four inputs the table takes, then ask ccd. `_alive` is
   *  stubbed because a tmux pane is the one input a unit test cannot have;
   *  every other input is a real file in a real registry. */
  const askState = (o: {
    alive: boolean;
    supervisedAgo: number | null;   // seconds; null = no heartbeat file at all
    stopped: boolean;
    started: boolean;
  }): string => {
    const reg = REGDIR();
    for (const f of ['supervised', 'stopped', 'started']) {
      fs.rmSync(path.join(reg, `${ID}.${f}`), { force: true });
    }
    fs.writeFileSync(path.join(reg, `${ID}.uuid`), 'u');
    const now = Math.floor(Date.now() / 1000);
    if (o.supervisedAgo !== null) {
      fs.writeFileSync(path.join(reg, `${ID}.supervised`), String(now - o.supervisedAgo));
    }
    if (o.stopped) fs.writeFileSync(path.join(reg, `${ID}.stopped`), `${now - 300} pwa`);
    if (o.started) fs.writeFileSync(path.join(reg, `${ID}.started`), '1');
    return h.sh(`_alive() { return ${o.alive ? 0 : 1}; }; _session_state ${ID}`);
  };

  it('a live pane under a fresh heartbeat is `running`', () => {
    expect(askState({ alive: true, supervisedAgo: 5, stopped: false, started: true })).toBe('running');
  });

  it('a live pane with a stale heartbeat is `unsupervised`', () => {
    // What a pre-fix `ccd start` minted: a pane with no unit — no auto-swap,
    // no auto-compact, no uuid-sync, and nothing to record its death. Kills
    // the mutant that answers `running` for any live pane, which would erase
    // the entire defect this column exists to name.
    expect(askState({ alive: true, supervisedAgo: 600, stopped: false, started: true })).toBe('unsupervised');
  });

  it('a live pane with no heartbeat at all is `unsupervised`, not `running`', () => {
    expect(askState({ alive: true, supervisedAgo: null, stopped: false, started: true })).toBe('unsupervised');
  });

  it('a dead row with a stop stamp is `stopped`, even while the heartbeat is still fresh', () => {
    // §4.3's ordering rule as a test: the stop stamp is checked BEFORE the
    // heartbeat in the not-alive branch, so a stop taken inside the 120s
    // freshness window reads `stopped` immediately instead of `restarting`.
    expect(askState({ alive: false, supervisedAgo: 5, stopped: true, started: true })).toBe('stopped');
    expect(askState({ alive: false, supervisedAgo: null, stopped: true, started: false })).toBe('stopped');
  });

  it('a dead row under a fresh heartbeat and no stop stamp is `restarting`', () => {
    // Between Restart=always cycles, or mid-swap. Not a fault.
    expect(askState({ alive: false, supervisedAgo: 5, stopped: false, started: true })).toBe('restarting');
  });

  it('a dead row with nothing watching and a start on record is `orphan`', () => {
    expect(askState({ alive: false, supervisedAgo: 600, stopped: false, started: true })).toBe('orphan');
    expect(askState({ alive: false, supervisedAgo: null, stopped: false, started: true })).toBe('orphan');
  });

  it('a row that never had a session is `never-started`, never `orphan`', () => {
    // Kills the mutant that drops the `started` test: every fresh registry
    // row would otherwise print `orphan` the moment it is created.
    expect(askState({ alive: false, supervisedAgo: 600, stopped: false, started: false })).toBe('never-started');
    expect(askState({ alive: false, supervisedAgo: null, stopped: false, started: false })).toBe('never-started');
  });

  it('the freshness window is 120 seconds, checked from both sides', () => {
    // 120 -> 10 makes the 60s heartbeat stale (`orphan`); 120 -> 300 makes
    // the 200s one fresh (`restarting`). Both margins are wide enough that
    // the clock ccd reads a beat later cannot flake either assertion.
    expect(askState({ alive: false, supervisedAgo: 60, stopped: false, started: true })).toBe('restarting');
    expect(askState({ alive: false, supervisedAgo: 200, stopped: false, started: true })).toBe('orphan');
  });

  it('a garbage heartbeat is no heartbeat, not a fresh one', () => {
    // The field is ccd's own, but it is a file on disk: a truncated or
    // hand-edited stamp must degrade to "nobody is watching", never to a
    // silently-fresh `running`.
    fs.writeFileSync(path.join(REGDIR(), `${ID}.uuid`), 'u');
    fs.writeFileSync(path.join(REGDIR(), `${ID}.supervised`), 'not-a-number');
    fs.writeFileSync(path.join(REGDIR(), `${ID}.started`), '1');
    expect(h.sh(`_alive() { return 0; }; _session_state ${ID}`)).toBe('unsupervised');
    expect(h.sh(`_alive() { return 1; }; _session_state ${ID}`)).toBe('orphan');
  });
});

describe('ccd ls', () => {
  it('replaces the ALIVE column with STATE and leaves the gpt trailer verbatim', () => {
    // §4.4: `ALIVE=no` said the same word about a session somebody stopped,
    // one that died unwatched and one that never started. Nothing parses
    // `ccd ls` — no server/agent/pwa caller, no other test — but
    // ccd-limits.test.ts pins _gpt_status's strings verbatim, so the trailer
    // is NOT this task's to touch, and that is asserted here rather than
    // hoped for.
    h.sh(`_reg_set ${ID} uuid u
      _reg_set ${ID} wrapper claude-dev0
      _reg_set ${ID} workdir /data/projects/demo
      _reg_set ${ID} started 1`);
    const out = run(`_alive() { return 1; }; cmd_ls`).stdout;
    expect(out).toContain('STATE');
    expect(out).not.toContain('ALIVE');
    expect(out).toMatch(new RegExp(`${ID}\\s+claude-dev0\\s+orphan\\s+/data/projects/demo`));
    expect(out).toContain('gpt overflow lane: not installed  —  0 session(s) currently on it');
  });

  it('prints the same word for a stopped row that _session_state does', () => {
    h.sh(`_reg_set ${ID} uuid u
      _reg_set ${ID} wrapper claude-dev0
      _reg_set ${ID} workdir /data/projects/demo
      _reg_set ${ID} started 1`);
    h.sh(`systemctl() { :; }; _ws_unsupervise ${ID} pwa`);
    const out = run(`_alive() { return 1; }; cmd_ls`).stdout;
    expect(out).toMatch(new RegExp(`${ID}\\s+claude-dev0\\s+stopped\\s+`));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-session-state.test.ts` (`timeout: 600000`)
Expected: FAIL — the first case reports `expected null to match /^\d{10} ccd$/` (no stamp is written today), and the `_session_state` cases fail with `bash: _session_state: command not found`. Confirm both before proceeding.

- [ ] **Step 3: Stamp at the choke point, and add the classifier beside it**

Replace `_ws_supervise` / `_ws_unsupervise` (ccd:216-218) and insert `_session_state` directly after them, keeping the existing "the systemd calls live in their own functions so the test harness can stub them" comment above:

```bash
_ws_supervise()   { rm -f "$REG/$1.stopped"                                   # supervision supersedes an earlier stop
                    systemctl --user enable  --now "claude-session@$1" 2>/dev/null \
                      || echo "warn: could not enable unit claude-session@$1" >&2; }

_ws_unsupervise() {   # id [surface] — disable the unit AND RECORD THAT SOMEBODY MEANT TO.
  # THE SINGLE CHOKE POINT, which is why the stamp lives here and not in
  # cmd_stop: ws-rm, ws-archive, ws-reap and forget all reach systemd through
  # this function, and an archived workspace with no stamp would classify
  # `orphan` for ever (§4.1). The surface defaults to `ccd` because those four
  # call sites ARE ccd acting on its own account; `cmd_stop` passes its own.
  #
  # The word is text from the wire, so it is validated against the closed set
  # on arrival and anything else becomes `unknown` — it is a DECLARATION, not
  # an authentication, and `--surface pwa` means only that the caller said so.
  #
  # Epoch and surface share ONE field: the registry is read per-field per
  # session on a 2s tick, and packing them keeps `stopped` one read instead of
  # two. The stamp is written BEFORE the disable, because the intent is a fact
  # whether or not systemd cooperates — the disable is already swallowed.
  local id="$1" surface="${2:-ccd}"
  case "$surface" in cli|pwa|agent|ccd) ;; *) surface=unknown ;; esac
  printf '%s %s' "$(date +%s)" "$surface" > "$REG/$id.stopped"
  rm -f "$REG/$id.supervised"
  systemctl --user disable --now "claude-session@$id" 2>/dev/null || true
}

_session_state() {   # id -> running|unsupervised|stopped|restarting|orphan|never-started
  # The bash twin of shared/'s `sessionLifecycle` (spec §4.3). A pure function
  # of four inputs — pane alive, heartbeat freshness, stop stamp, `started` —
  # evaluated in this exact order; both implementations are driven from one
  # fixture, so the order and the 120-second window are the contract, not an
  # implementation detail.
  #
  # `unmeasurable` is the ONE row of the table this side cannot reach: ccd
  # reads $REG off local disk, where a read either works or the file is
  # genuinely absent. That state exists only on the server's side of the seam,
  # where remote `readFile` collapses missing/forbidden/disconnected into one
  # null and an unreadable registry must never print `orphan`.
  local id="$1" sup fresh=0
  sup=$(_reg_get "$id" supervised)
  # A garbage stamp is NO stamp: this field is ccd's own, but it is a file on
  # disk, and a truncated one must degrade to "nobody is watching" rather than
  # to a silently-fresh `running`.
  [[ "$sup" =~ ^[0-9]+$ ]] && (( $(date +%s) - sup < 120 )) && fresh=1
  if _alive "$id"; then
    (( fresh )) && { echo running; return 0; }
    # A pane with no supervisor: no auto-swap, no auto-compact, no uuid-sync,
    # and nothing to record its death. What a pre-fix `ccd start` minted.
    echo unsupervised; return 0
  fi
  # The stop stamp is checked BEFORE the heartbeat so that a stop taken inside
  # the 120s freshness window reads `stopped` immediately, not `restarting`.
  # `-e` not `-f`: present-but-unreadable still means somebody stopped this.
  [[ -e "$REG/$id.stopped" ]] && { echo stopped; return 0; }
  (( fresh )) && { echo restarting; return 0; }
  [[ "$(_reg_get "$id" started)" == "1" ]] && { echo orphan; return 0; }
  echo never-started
}
```

- [ ] **Step 4: Rewrite `cmd_stop` around the choke point**

Replace the whole of `cmd_stop` (ccd:7109-7126):

```bash
cmd_stop() {   # [--surface <word>] <id>  |  [--surface <word>] <wrapper> <project>
  # FLAGS ARE STRIPPED BEFORE THE ARITY RULE, and that order is the whole
  # correctness argument. `$# -ge 2` means wrapper-plus-project, so with the
  # flag left in argv `ccd stop <id> --surface pwa` reads as a two-argument
  # stop and `_id` mints `<id>---surface` — aiming the stop at a session that
  # does not exist while the real one keeps running.
  #
  # The surface arrives as an argv flag because nothing else can carry it: the
  # exec seam is `(cmd, args) => Promise<ExecResult>` with no env, and the
  # agent's wire ExecReq carries {cmd, args, timeoutMs} and nothing else — a
  # CCD_SURFACE variable would report the server process's own environment,
  # identically for every caller in the fleet.
  #
  # cmd_stop's OWN default is `cli`, not _ws_unsupervise's `ccd`: a session
  # shelling `ccd stop` from its own Bash tool passes no flag, and `cli` is
  # exactly what that looks like from the box.
  local surface=cli args=()
  while (( $# )); do
    case "$1" in
      # An explicit arity check, not a bare `shift 2`: ccd runs under
      # `set -uo pipefail` with NO `-e`, so a shift past the end of argv fails,
      # shifts nothing, and this loop never terminates.
      --surface)   [[ $# -ge 2 ]] || die "usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>"
                   surface="$2"; shift 2 ;;
      --surface=*) surface="${1#--surface=}"; shift ;;
      *)           args+=("$1"); shift ;;
    esac
  done
  set -- "${args[@]}"

  # The two-argument form is the legacy one and recomputes `<wrapper>-<project>`.
  # That only works for ids that ENCODE a wrapper; a workspace id is
  # `<project>-<slug>`, so a caller forced to reverse one guesses a wrapper and
  # aims the stop at a different, live session. The one-argument form takes the
  # id directly, exactly as `ccd ensure` does.
  local id
  if [[ $# -ge 2 ]]; then
    local wrapper="${1:?}" project="${2:?}"
    id=$(_id "$wrapper" "$project")
  else
    id="${1:?usage: ccd stop [--surface <word>] <id> | ccd stop [--surface <word>] <wrapper> <project>}"
  fi
  # Through the choke point, never around it: the inlined `systemctl --user
  # disable --now` this replaces was the one stop path in the file that left
  # no record, which is how the 21:39:53 stop became indistinguishable from a
  # crash. The pane kill stays HERE rather than moving inward, because every
  # other call site already runs these two as a pair.
  _ws_unsupervise "$id" "$surface"
  tmux kill-session -t "$(_tmux "$id")" 2>/dev/null || true
  echo "stopped $id"
}
```

- [ ] **Step 5: Heartbeat the supervisor, and let a spawn supersede a stop**

Replace `cmd_supervise` (ccd:6988-6994). This block is **shape-authoritative**: `CCD_IN_UNIT=1` and the `systemctl --user enable` self-heal are §3.2's lines and are already there — reconcile against the live tree; this task adds only the two `_reg_set … supervised` lines and the `beat` accounting.

```bash
cmd_supervise() {   # systemd ExecStart: ensure then block until the session dies
  local id="${1:?usage: ccd supervise <id>}"
  # THE FIRST STAMP GOES BEFORE cmd_ensure, NOT AFTER IT. `cmd_ensure` can sit
  # inside `_accept_first_run_prompts` for up to fifteen minutes while a 700k-
  # token resume works through its gates, and a heartbeat that started with the
  # watch loop would leave every large resume reading `unsupervised` for those
  # fifteen minutes — the loudest possible false alarm, fired precisely when
  # the fleet is doing the most work (§4.2).
  #
  # The stamp is how the SERVER learns this at all: the agent's read whitelist
  # permits ~/.cc-sessions and ~/.claude*, and nothing under ~/.config/systemd,
  # so rather than widen a security boundary to learn a fact, the supervisor
  # publishes it. And it is strictly better than an enable symlink: the symlink
  # promises a start at next boot, this proves auto-swap, uuid-sync and
  # auto-compact are running for this row right now.
  _reg_set "$id" supervised "$(date +%s)"
  CCD_IN_UNIT=1                                            # §3.2 recursion guard, in-process only
  systemctl --user enable "claude-session@$id" 2>/dev/null || true   # §3.2 self-heal, idempotent, no --now
  cmd_ensure "$id"
  # Re-stamped every 30s from the 5-second tick this loop already runs, so the
  # 120-second freshness window never expires under a live supervisor.
  local beat=0
  while _alive "$id"; do
    _sync_uuid "$id"; _auto_swap_check "$id"; _auto_compact_check "$id"
    beat=$((beat + 5))
    (( beat >= 30 )) && { _reg_set "$id" supervised "$(date +%s)"; beat=0; }
    sleep 5
  done
  echo "session $id ended; exiting for systemd restart" >&2
  exit 1
}
```

In `_spawn` (ccd:6900), insert one line immediately after the registry-completeness guard, before `tname=$(_tmux "$id")`:

```bash
  [[ -n "$wrapper" && -n "$workdir" && -n "$uuid" ]] || die "incomplete registry for '$id'"
  # A spawn IS a revival, and it supersedes any earlier deliberate stop (§4.1).
  # Cleared on ATTEMPT rather than on success, deliberately: a spawn that fails
  # should classify `orphan` — nothing is watching this, and `ccd start <id>`
  # is what would — not `stopped`, which would claim a human meant this. The
  # failure itself is recorded separately, as the rc in $REG/<id>.spawn.
  rm -f "$REG/$id.stopped"
```

- [ ] **Step 6: Keep the heartbeat alive across a swap**

In `cmd_swap` (ccd:7020), two insertions. The surrounding lines are D1's rewritten body — **reconcile the anchors against the live tree**; what matters is that one stamp lands after the teardown and one immediately before the unit is started again.

After the post-teardown flush (`sleep 1  # let claude flush its final transcript entries`), before the carry:

```bash
  # A SWAP IS NOT AN ABANDONMENT. Between the stop and the start this row is
  # not alive and, after 120 seconds, would also stop looking watched — and
  # §2.3's `cp -a` fallback over a 188MB sidecar can take that long. Re-stamped
  # here and again below so the window classifies `restarting`, which is
  # exactly what it is. Note the swap does NOT write `.stopped`: it is not a
  # deliberate stop, which is why it goes round `_ws_unsupervise` rather than
  # through it.
  _reg_set "$id" supervised "$(date +%s)"
```

And immediately before the restart (`systemctl --user start "claude-session@$id" 2>/dev/null || cmd_ensure "$id"`):

```bash
  _reg_set "$id" supervised "$(date +%s)"   # the carry may have taken minutes
```

- [ ] **Step 7: `ccd ls` prints STATE**

Replace the header and row `printf`s in `cmd_ls` (ccd:7169-7182). The `_gpt_status` trailer and the `CLAUDE_AI_BASE` line are **untouched** — `server/test/ccd-limits.test.ts:69-167` pins those strings verbatim.

```bash
cmd_ls() {
  # STATE, not ALIVE: `no` was one word for three different facts — a session
  # somebody deliberately stopped, one that died with nothing watching it, and
  # a row that never had a session at all (§4.4). The column is 13 wide because
  # `never-started` is 13 characters. Nothing parses this output — no server,
  # agent or pwa caller shells `ccd ls`, and `cmd_menu` formats its own list —
  # so the rename costs no parser. The gpt trailer below is a different matter:
  # its exact strings are pinned by ccd-limits.test.ts and are not touched here.
  printf '%-28s %-12s %-13s %s\n' "ID" "WRAPPER" "STATE" "WORKDIR"
  local f id; shopt -s nullglob
  local files=("$REG"/*.uuid)
  [[ ${#files[@]} -eq 0 ]] && { echo "(no sessions)"; return 0; }
  local gpt_here=0
  for f in "${files[@]}"; do
    id=$(basename "$f" .uuid); local state; state=$(_session_state "$id")
    local w; w=$(_reg_get "$id" wrapper); [[ "$w" == gpt ]] && gpt_here=$((gpt_here+1))
    printf '%-28s %-12s %-13s %s\n' "$id" "$w" "$state" "$(_reg_get "$id" workdir)"
  done
  echo "gpt overflow lane: $(_gpt_status)  —  $gpt_here session(s) currently on it"
  echo "(open $CLAUDE_AI_BASE in the matching account and pick the session whose name == ID)"
}
```

- [ ] **Step 8: Run the gates**

Run:
```bash
bash -n ccd/ccd \
  && cd server && ./node_modules/.bin/vitest run \
       test/ccd-session-state.test.ts test/ccd-workspaces.test.ts test/ccd-limits.test.ts \
       test/ccd-forget.test.ts test/ccd-hold.test.ts test/ccd-archive.test.ts \
       test/ccd-ws-reap.test.ts test/ccd-ws-gc.test.ts test/ccd-ws-audit.test.ts \
       test/ccd-prhistory.test.ts test/wsaudit.test.ts test/verb-gate.test.ts \
       test/whitelist-subset.test.ts
```
(`timeout: 600000`) — Expected: PASS all. Three of these are the load-bearing checks: `ccd-workspaces.test.ts`'s existing `cmd_stop` block still asserts `calls()` equals exactly the systemctl-then-tmux pair, and it must stay green because `_ws_unsupervise` issues the identical systemctl line; `ccd-limits.test.ts` proves the `_gpt_status` trailer is untouched; `wsaudit.test.ts` proves the stamp did not enter the reap protocol's refusal-token vocabulary (it is not written in any of that test's four emission shapes). Every other ccd suite stubs `_ws_unsupervise`, so the signature change reaches them only as a no-op — run them anyway, because "stubs it" is a claim about the tree, not a fact until measured.

- [ ] **Step 9: Commit**

```bash
git add ccd/ccd server/test/ccd-session-state.test.ts
git commit -m "feat(ccd): a stop records who meant it, a supervisor publishes its heartbeat, and ccd ls names which kind of dead"
```

---

### Task 8: one classification, proved in two languages from one fixture

Implements spec §4.3 — "One classification, two implementations, one fixture". The defect it kills is the one §4 names in its first sentence: `ccd ls` prints `ALIVE=no` for a session that was deliberately stopped, one that died, and one that never started, and the server has no vocabulary at all for the difference. This task adds the vocabulary and the pure ladder to `shared/`, then proves the bash twin `_session_state` (already shipped by the ccd D3 task) answers the identical table — row for row, from **one** fixture array that both suites iterate, per the architecture doc's cross-language fixture-test idiom that `server/test/wrapper-roster-fixture.test.ts` already enforces for the account roster.

Two rulings this task encodes, both from the spec:

- `unmeasurable` is produced by **any lifecycle field appearing in `unmeasured`** — the discrimination between "absent" and "unreadable" happens in the registry reader (Task 9), never in the classifier, which stays pure. This is architecture rule (b): remote `readFile` collapses missing/forbidden/disconnected into one `null` (`remote/io.ts`), and an unreadable registry must never print `orphan`.
- `unmeasurable` is the one row the bash twin cannot reach (ccd reads `$REG` off local disk, where a read either works or the file is genuinely absent), so the fixture marks that row **server-only with a reason**, and an invariant test pins that it is the *only* exemption — a fixture with an unexplained exemption is how a second exemption gets added later.

**Files:**
- Modify: `shared/api.ts` (one contiguous block appended immediately after `sessionBucket`'s closing brace, ~line 772, before `type RawObj`)
- Create: `server/test/sessionLifecycleFixture.ts` (the §4.3 table as data, plus its `LifecycleInput` projection)
- Create: `server/test/session-lifecycle.test.ts` (the TypeScript side)
- Create: `server/test/ccd-session-lifecycle.test.ts` (the bash side, real `_session_state` against fixture HOMEs)

**Interfaces:**
- Consumes: ccd's `_session_state <id>` and the registry stamps `$REG/<id>.stopped` (`<epoch> <surface>`), `$REG/<id>.supervised` (`<epoch>`), `$REG/<id>.started` (`1`), all from the ccd D3 task; `makeCcdHarness` / `CcdHarness` from `server/test/ccdWsHelpers.ts`.
- Produces: `SessionLifecycle`, `SESSION_LIFECYCLES`, `isSessionLifecycle`, `StopSurface`, `isStopSurface`, `LifecycleField`, `LIFECYCLE_FIELDS`, `SUPERVISED_FRESH_MS`, `LifecycleInput`, `sessionLifecycle` — all exported from `shared/api.ts`; and `LifecycleFixtureRow`, `LIFECYCLE_FIXTURE`, `lifecycleInputOf`, `FIXTURE_NOW_MS`, `FIXTURE_NOW_SEC` from `server/test/sessionLifecycleFixture.ts`. Task 9 consumes all of them.

- [ ] **Step 1: Write the failing test(s)**

The fixture lives in `server/test/`, not in `shared/`: both consumers are server-side test files, and `shared/` is production code that ships inside the PWA bundle. It is still the single source of truth — neither suite hand-writes a table.

Create `server/test/sessionLifecycleFixture.ts`:

```ts
/**
 * The §4.3 classification table, as DATA — the single source of truth both the
 * TypeScript ladder (`session-lifecycle.test.ts`) and the bash twin
 * (`ccd-session-lifecycle.test.ts`) are driven against. Two hand-written lists
 * is exactly the drift the architecture doc's cross-language fixture-test idiom
 * exists to stop (`wrapper-roster-fixture.test.ts` is the same mechanism over
 * the account roster).
 *
 * Rows are stated in REGISTRY-NATIVE terms — a pane that is alive or not, plus
 * stamp AGES in whole seconds — because that is the one vocabulary both sides
 * can be built from: the TS side projects a row into a `LifecycleInput` via
 * `lifecycleInputOf`, the bash side plants `$REG/<id>.supervised`,
 * `$REG/<id>.stopped` and `$REG/<id>.started` and stubs `_alive`. Whole
 * seconds, never fractions, because ccd's stamps are `date +%s` and the two
 * implementations must agree at the 120-second boundary to the second.
 */
import type { LifecycleInput, SessionLifecycle, StopSurface } from '../../shared/api.js';

/** Fixed clock. Both suites pin it: the TS side passes it as `nowMs`, the bash
 *  side stubs `date +%s` with its seconds form, so the freshness boundary is an
 *  EXACT assertion on both sides instead of a wall-clock race that flakes one
 *  time in a thousand and gets marked skipped. */
export const FIXTURE_NOW_MS = 1_785_300_000_000;
export const FIXTURE_NOW_SEC = FIXTURE_NOW_MS / 1000;

/** The ONE exemption, said out loud (spec §4.3). Shared by every `unmeasurable`
 *  row rather than retyped, so a second exemption cannot be smuggled in wearing
 *  a vaguer sentence — and `session-lifecycle.test.ts` pins the biconditional
 *  (`serverOnly !== null` iff `expect === 'unmeasurable'`), so it cannot be
 *  smuggled in at all. */
export const SERVER_ONLY_UNMEASURABLE =
  'ccd reads $REG off local disk, where a read either works or the file is genuinely absent. '
  + '`unmeasurable` exists only on the SERVER side of the remote-io seam, where `readFile` '
  + 'collapses missing/forbidden/agent-disconnected into one null (remote/io.ts).';

export interface LifecycleFixtureRow {
  /** Doubles as the `it` title in both suites. */
  readonly name: string;
  readonly alive: boolean;
  /** Seconds since the supervisor heartbeat; null = no stamp on disk at all. */
  readonly supervisedAgoSec: number | null;
  /** Seconds since the stop stamp; null = no stamp on disk at all. */
  readonly stoppedAgoSec: number | null;
  readonly stopSurface: StopSurface | null;
  readonly started: boolean;
  /** Registry field names that were LISTED but unreadable this pass. */
  readonly unmeasured: readonly string[];
  readonly expect: SessionLifecycle;
  /** Why the bash twin cannot answer this row. Null = it must. */
  readonly serverOnly: string | null;
}

export const LIFECYCLE_FIXTURE: readonly LifecycleFixtureRow[] = [
  { name: 'alive with a fresh heartbeat is running',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'running', serverOnly: null },

  { name: 'a heartbeat 119s old is still fresh — the boundary, from the inside',
    alive: true, supervisedAgoSec: 119, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'running', serverOnly: null },

  { name: 'a heartbeat 120s old is stale — the boundary, from the outside',
    alive: true, supervisedAgoSec: 120, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  { name: 'alive with a stale heartbeat is unsupervised — what a pre-fix `ccd start` minted',
    alive: true, supervisedAgoSec: 600, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  { name: 'alive with no heartbeat at all is unsupervised',
    alive: true, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'unsupervised', serverOnly: null },

  { name: 'a stop stamp on a dead row is stopped, and the row says who and when',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: 90, stopSurface: 'pwa',
    started: true, unmeasured: [], expect: 'stopped', serverOnly: null },

  { name: 'a stop taken INSIDE the freshness window still reads stopped — the stamp is checked before the heartbeat',
    alive: false, supervisedAgoSec: 5, stoppedAgoSec: 5, stopSurface: 'agent',
    started: true, unmeasured: [], expect: 'stopped', serverOnly: null },

  { name: 'dead, unstopped, freshly heartbeat is restarting — between Restart=always cycles, not a fault',
    alive: false, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'restarting', serverOnly: null },

  { name: 'dead, unstopped, stale heartbeat, started is orphan',
    alive: false, supervisedAgoSec: 600, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'orphan', serverOnly: null },

  { name: 'dead, unstopped, no heartbeat at all, started is orphan',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: [], expect: 'orphan', serverOnly: null },

  { name: 'dead, unstopped, no heartbeat, never started is never-started',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'never-started', serverOnly: null },

  { name: 'a stale heartbeat does not promote a never-started row to orphan',
    alive: false, supervisedAgoSec: 600, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: [], expect: 'never-started', serverOnly: null },

  { name: 'an unmeasured field OUTSIDE the lifecycle set changes nothing',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: ['branch'], expect: 'running', serverOnly: null },

  { name: 'an unreadable supervised stamp is unmeasurable, never orphan',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: ['supervised'], expect: 'unmeasurable',
    serverOnly: SERVER_ONLY_UNMEASURABLE },

  { name: 'an unreadable stop stamp is unmeasurable even for a plainly-alive, plainly-supervised pane',
    alive: true, supervisedAgoSec: 5, stoppedAgoSec: null, stopSurface: null,
    started: true, unmeasured: ['stopped'], expect: 'unmeasurable',
    serverOnly: SERVER_ONLY_UNMEASURABLE },

  { name: 'an unreadable started flag is unmeasurable, never never-started',
    alive: false, supervisedAgoSec: null, stoppedAgoSec: null, stopSurface: null,
    started: false, unmeasured: ['started'], expect: 'unmeasurable',
    serverOnly: SERVER_ONLY_UNMEASURABLE },
];

/** One fixture row → the classifier's own input shape. Ages become absolute
 *  epoch-MS stamps against the fixed clock; nothing else is derived. */
export function lifecycleInputOf(
  row: LifecycleFixtureRow,
  nowMs: number = FIXTURE_NOW_MS,
): LifecycleInput {
  return {
    alive: row.alive,
    supervisedAt: row.supervisedAgoSec === null ? null : nowMs - row.supervisedAgoSec * 1000,
    stoppedAt: row.stoppedAgoSec === null ? null : nowMs - row.stoppedAgoSec * 1000,
    stopSurface: row.stopSurface,
    started: row.started,
    unmeasured: row.unmeasured,
    nowMs,
  };
}
```

Create `server/test/session-lifecycle.test.ts`:

```ts
// Spec §4.3. The pure ladder, driven from the SAME fixture the bash twin is
// driven from (ccd-session-lifecycle.test.ts). Everything a single fixture row
// cannot state — "no surface changes the answer", "unmeasurable wins over
// everything" — is a separate case below, because a mutation that only shows up
// under a combination the table does not enumerate is exactly what a
// table-shaped test misses.
import { describe, it, expect } from 'vitest';
import {
  LIFECYCLE_FIELDS, SESSION_LIFECYCLES, SUPERVISED_FRESH_MS,
  isSessionLifecycle, isStopSurface, sessionLifecycle,
  type LifecycleInput, type SessionLifecycle, type StopSurface,
} from '../../shared/api.js';
import {
  FIXTURE_NOW_MS, LIFECYCLE_FIXTURE, lifecycleInputOf,
} from './sessionLifecycleFixture.js';

/** A row that classifies `running`, used as the base for the combination cases
 *  below — every one of them mutates ONE field, so the assertion is about that
 *  field and nothing else. */
const running: LifecycleInput = {
  alive: true, supervisedAt: FIXTURE_NOW_MS - 5_000, stoppedAt: null,
  stopSurface: null, started: true, unmeasured: [], nowMs: FIXTURE_NOW_MS,
};

describe('sessionLifecycle — the §4.3 table, driven from the fixture', () => {
  for (const row of LIFECYCLE_FIXTURE) {
    // Each row kills the mutant that collapses its rung into the one above it.
    it(row.name, () => {
      expect(sessionLifecycle(lifecycleInputOf(row))).toBe(row.expect);
    });
  }
});

describe('the fixture is complete, and its one exemption is the only one', () => {
  it('covers every SessionLifecycle member — a state with no row is a state nobody tests', () => {
    // Kills the mutant that deletes a rung: with a member uncovered, deleting
    // its branch would leave every remaining row green.
    const covered = new Set(LIFECYCLE_FIXTURE.map((r) => r.expect));
    expect([...covered].sort()).toEqual([...SESSION_LIFECYCLES].sort());
  });

  it('exempts the bash twin from exactly the unmeasurable rows, and from nothing else', () => {
    // Spec §4.3's own warning, made mechanical: "a fixture with an unexplained
    // exemption is how a second exemption gets added later." Biconditional, so
    // marking an inconvenient row server-only to make ccd green fails HERE.
    for (const row of LIFECYCLE_FIXTURE) {
      expect(row.serverOnly !== null, row.name).toBe(row.expect === 'unmeasurable');
      if (row.serverOnly !== null) expect(row.serverOnly.length, row.name).toBeGreaterThan(40);
    }
  });

  it('SESSION_LIFECYCLES is the whole union and nothing else', () => {
    // The runtime list is DERIVED from `Record<SessionLifecycle, true>` (the
    // PR_REASONS technique), so a member added to the type without a key here
    // is TS2739 rather than a list one short. This pins the runtime half.
    expect([...SESSION_LIFECYCLES].sort()).toEqual([
      'never-started', 'orphan', 'restarting', 'running', 'stopped', 'unmeasurable', 'unsupervised',
    ]);
  });

  it('LIFECYCLE_FIELDS names exactly the three REGISTRY fields the ladder reads', () => {
    // `alive` is deliberately absent: it comes from tmux, not from `$REG`, and
    // is taken as a plain boolean. A field in this list that the ladder does not
    // read would make an unrelated degraded read print `unmeasurable`.
    expect([...LIFECYCLE_FIELDS].sort()).toEqual(['started', 'stopped', 'supervised']);
  });

  it('SUPERVISED_FRESH_MS is the contract\'s 120 seconds, in ms', () => {
    expect(SUPERVISED_FRESH_MS).toBe(120_000);
  });
});

describe('sessionLifecycle — the rungs one fixture row cannot state', () => {
  it('no stop surface changes the answer — the ladder reads the STAMP, never who wrote it', () => {
    // Kills a mutant that special-cases one surface (e.g. treating `ccd` — the
    // ws-archive default — as "not really stopped", which would put every
    // archived workspace in the fleet back on the orphan rung).
    const surfaces: readonly StopSurface[] = ['cli', 'pwa', 'agent', 'ccd', 'unknown'];
    for (const s of surfaces) {
      expect(sessionLifecycle({
        ...running, alive: false, stoppedAt: FIXTURE_NOW_MS - 5_000, stopSurface: s,
      }), s).toBe('stopped');
    }
  });

  it('a stop with a null surface is still stopped — the epoch is the evidence', () => {
    expect(sessionLifecycle({
      ...running, alive: false, stoppedAt: FIXTURE_NOW_MS - 5_000, stopSurface: null,
    })).toBe('stopped');
  });

  it('a future-dated heartbeat counts as fresh — a skewed clock must not read as abandoned', () => {
    // Kills `Math.abs(...)` and `>= 0 &&` mutants alike: the honest reading of a
    // stamp from the future is "a supervisor wrote this", not "nobody is watching".
    expect(sessionLifecycle({ ...running, supervisedAt: FIXTURE_NOW_MS + 60_000 })).toBe('running');
  });

  it('unmeasurable wins over every other rung, whatever else is true', () => {
    // Rule (b): an unreadable registry must NEVER be laundered into an
    // affirmative claim. Kills a mutant that moves the unmeasured check below
    // the alive check — which is precisely the shape that prints `orphan` for a
    // fleet host that dropped one agent-WS round trip.
    for (const row of LIFECYCLE_FIXTURE.filter((r) => r.serverOnly === null)) {
      expect(sessionLifecycle({ ...lifecycleInputOf(row), unmeasured: ['supervised'] }), row.name)
        .toBe('unmeasurable');
    }
  });

  it('an empty unmeasured list never yields unmeasurable', () => {
    // Kills `.some(...)` inverted to `.every(...)`, which answers true for [].
    expect(sessionLifecycle({ ...running, unmeasured: [] })).toBe('running');
  });

  it('every lifecycle field name, on its own, yields unmeasurable', () => {
    for (const f of LIFECYCLE_FIELDS) {
      expect(sessionLifecycle({ ...running, unmeasured: [f] }), f).toBe('unmeasurable');
    }
  });
});

describe('the validators are the only door onto the two vocabularies', () => {
  it('isSessionLifecycle accepts every member and rejects a stray token or a non-string', () => {
    for (const s of SESSION_LIFECYCLES) expect(isSessionLifecycle(s), s).toBe(true);
    expect(isSessionLifecycle('blocked')).toBe(false);
    expect(isSessionLifecycle('')).toBe(false);
    expect(isSessionLifecycle(null)).toBe(false);
    expect(isSessionLifecycle(3)).toBe(false);
  });

  it('isStopSurface accepts the closed set and rejects a word from the wire', () => {
    // §4.1: the surface is text from the wire being written into the registry —
    // ccd validates on write AND the server validates on read, because a
    // version-skewed ccd is the ordinary case on this box, not the exotic one.
    for (const s of ['cli', 'pwa', 'agent', 'ccd', 'unknown']) expect(isStopSurface(s), s).toBe(true);
    expect(isStopSurface('slack')).toBe(false);
    expect(isStopSurface('')).toBe(false);
    expect(isStopSurface(undefined)).toBe(false);
  });
});

// The lifecycle vocabulary must not have leaked into either union M10 names —
// a new `SessionStatus`/`SessionBucket` member CRASHES an already-deployed PWA
// (`DOT[status].cls` throws; `RANK[bucket]` is a NaN comparator). Task 9 pins
// the same claim behaviourally, through `sessionBucket`; this is the cheap
// structural half, here because this file is where the new words are defined.
describe('the new vocabulary is a FIELD, not a status or a bucket (M10)', () => {
  it('no SessionLifecycle member is also a SessionStatus or SessionBucket token', () => {
    const statuses = ['busy', 'idle', 'dead'];
    const buckets = ['attention', 'working', 'done', 'idle', 'cleanup', 'archived', 'dead'];
    for (const lc of SESSION_LIFECYCLES) {
      expect(statuses.includes(lc), lc).toBe(false);
      expect(buckets.includes(lc), lc).toBe(false);
    }
  });
});

// Compile-time half of the exhaustiveness claim: a member added to
// `SessionLifecycle` without a row here is TS2739 in the tests project
// (typecheck-tests.test.ts runs it), not a silently-short runtime list.
const _EXHAUSTIVE: Record<SessionLifecycle, true> = {
  running: true, unsupervised: true, stopped: true, restarting: true,
  orphan: true, 'never-started': true, unmeasurable: true,
};
void _EXHAUSTIVE;
```

Create `server/test/ccd-session-lifecycle.test.ts`:

```ts
/**
 * The bash half of §4.3's one classification — ccd's `_session_state`, EXECUTED
 * for real against a fixture HOME, driven from the same `LIFECYCLE_FIXTURE` the
 * TypeScript ladder is driven from.
 *
 * Harness: `makeCcdHarness` (ccdWsHelpers.ts), the isolated-HOME idiom every ccd
 * test file uses — HOME is the ONLY isolation boundary ccd has, and `$REG` is
 * `$HOME/.cc-sessions`, so planting stamps there is planting them where the real
 * function reads. THE LIVE HOME IS NEVER TOUCHED.
 *
 * Two stubs, both structural rather than convenient:
 *   - `_alive` — tmux does not exist under test, and the pane's liveness is a
 *     fixture INPUT, not something to measure.
 *   - `date` — stubbed for `+%s` only (everything else falls through to
 *     `command date`), so the 120-second freshness boundary is an exact
 *     assertion. A wall-clock read would make the 119s/120s rows race the
 *     second hand and flake roughly one run in a thousand, which is how a
 *     boundary case gets marked skipped and the boundary stops being tested.
 *
 * THIS FILE IS NOT RED-THEN-GREEN ON THE BASH SIDE. `_session_state` already
 * exists (ccd D3 task); this file is red only on the missing `shared/` imports
 * until Step 3 lands. After that it either confirms the twin agrees row for row,
 * or it names the row where the two implementations already disagree — which is
 * the entire reason the fixture exists. If it goes red on a ROW, fix ccd. Never
 * the fixture.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SESSION_LIFECYCLES } from '../../shared/api.js';
import {
  FIXTURE_NOW_SEC, LIFECYCLE_FIXTURE, type LifecycleFixtureRow,
} from './sessionLifecycleFixture.js';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-lifecycle-'); });
afterEach(() => { h.cleanup(); });

const ID = 'demo-quiet-basin';

/** The fixed-clock preamble every snippet opens with. `${1:-}` rather than `$1`
 *  because ccd runs under `set -uo pipefail`: a bare `$1` in a function called
 *  with no arguments is an unbound-variable error, and with no `-e` the script
 *  would sail past it having answered nothing. */
const CLOCK = [
  `now=${FIXTURE_NOW_SEC}`,
  `date() { if [[ "\${1:-}" == "+%s" ]]; then echo "$now"; else command date "$@"; fi; }`,
].join('\n');

/** One fixture row → a bash snippet that plants the registry stamps the row
 *  describes and then asks ccd for its verdict. */
const plantAndAsk = (row: LifecycleFixtureRow): string => {
  const lines = [
    CLOCK,
    `rm -f "$REG/${ID}".*`,
    row.alive ? '_alive() { return 0; }' : '_alive() { return 1; }',
  ];
  if (row.supervisedAgoSec !== null) {
    lines.push(`printf '%s' "$((now-${row.supervisedAgoSec}))" > "$REG/${ID}.supervised"`);
  }
  if (row.stoppedAgoSec !== null) {
    lines.push(`printf '%s %s' "$((now-${row.stoppedAgoSec}))" '${row.stopSurface ?? 'ccd'}' > "$REG/${ID}.stopped"`);
  }
  if (row.started) lines.push(`printf 1 > "$REG/${ID}.started"`);
  lines.push(`_session_state ${ID}`);
  return lines.join('\n');
};

describe('ccd _session_state answers the §4.3 table, row for row', () => {
  for (const row of LIFECYCLE_FIXTURE) {
    if (row.serverOnly !== null) {
      // NOT silently dropped: the exemption is named, with its reason, in the
      // suite output. `session-lifecycle.test.ts` pins that this is the only
      // kind of row that may carry one.
      it.skip(`${row.name} — SERVER ONLY: ${row.serverOnly}`, () => { /* see reason */ });
      continue;
    }
    // Each row kills the bash mutant that collapses its rung into the next:
    // dropping the stop-stamp check answers `restarting`/`orphan` for a
    // deliberate stop; dropping the freshness arithmetic answers `running` for
    // a pane whose supervisor died two hours ago.
    it(row.name, () => {
      expect(h.sh(plantAndAsk(row))).toBe(row.expect);
    });
  }

  it('actually drove the bash twin — an all-skipped fixture would pass vacuously', () => {
    expect(LIFECYCLE_FIXTURE.filter((r) => r.serverOnly === null).length).toBeGreaterThan(6);
  });
});

// The OTHER direction, and the one a per-row loop cannot cover: a state ccd
// grows that `shared/` never heard of. `wrapper-roster-fixture.test.ts`'s header
// states the rule — every comparison is a SET equality over ccd's own answer
// space, "parsed or enumerated", never "each fixture row got a matching answer".
// Enumerated here rather than parsed: the full plantable input space is 24
// combinations, so ccd's complete answer space is measurable by RUNNING it,
// which is stronger than reading its source and cannot be fooled by an `echo`
// this file's regex did not anticipate.
describe("ccd -> shared: _session_state's answer space is exactly SESSION_LIFECYCLES minus unmeasurable", () => {
  const ENUMERATE = [
    CLOCK,
    'for a in 0 1; do',
    '  for s in none fresh stale; do',
    '    for k in none yes; do',
    '      for t in none yes; do',
    '        rm -f "$REG/probe".*',
    "        [[ \"$s\" == fresh ]] && printf '%s' \"$((now-5))\" > \"$REG/probe.supervised\"",
    "        [[ \"$s\" == stale ]] && printf '%s' \"$((now-600))\" > \"$REG/probe.supervised\"",
    "        [[ \"$k\" == yes ]] && printf '%s ccd' \"$((now-90))\" > \"$REG/probe.stopped\"",
    '        [[ "$t" == yes ]] && printf 1 > "$REG/probe.started"',
    '        if [[ "$a" == 1 ]]; then _alive() { return 0; }; else _alive() { return 1; }; fi',
    '        _session_state probe',
    '      done',
    '    done',
    '  done',
    'done',
  ].join('\n');

  it('enumerates every state ccd can produce, over the full plantable input space', () => {
    const answers = h.sh(ENUMERATE).split('\n').map((l) => l.trim()).filter(Boolean);
    // 2 alive x 3 heartbeat x 2 stop x 2 started — the whole space, so a state
    // ccd can reach cannot hide in a combination this test did not try.
    expect(answers).toHaveLength(24);
    const got = [...new Set(answers)].sort();
    const want = SESSION_LIFECYCLES.filter((s) => s !== 'unmeasurable').slice().sort();
    expect(got).toEqual(want);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/session-lifecycle.test.ts test/ccd-session-lifecycle.test.ts` (`timeout: 600000`)

Expected: FAIL — both files, on module resolution:
`SyntaxError: The requested module '/…/shared/api.ts' does not provide an export named 'SESSION_LIFECYCLES'`

(The exact name in the message is whichever value import the transform resolves first — `SESSION_LIFECYCLES`, `sessionLifecycle`, `SUPERVISED_FRESH_MS` or `LIFECYCLE_FIELDS`. Confirm the failure is about the missing `shared/` exports and not a typo in the fixture before proceeding.)

- [ ] **Step 3: Add the lifecycle vocabulary and the ladder to `shared/api.ts`**

Shape-authoritative, not text-authoritative: append this block immediately after `sessionBucket`'s closing brace and before `type RawObj = Record<string, unknown>;` — reconcile the anchor against the live file rather than trusting a line number. The two ladders sit adjacent on purpose: they are the two pure decisions this module owns, and a reader who finds one must find the other.

```ts
/* ---------------------------------------------------------------------------
 * Session lifecycle — WHY a row is not alive.
 *
 * Spec §4.3. `ccd ls` used to print `ALIVE=no` for a session that was
 * deliberately stopped, one that died, and one that never started: three
 * different facts, one word. This is the vocabulary for the difference, and the
 * single pure ladder both producers run — `fleet.ts`'s live assembly here, and
 * ccd's bash twin `_session_state` on the fleet host, pinned against this one
 * by `server/test/ccd-session-lifecycle.test.ts` from a fixture neither side
 * writes by hand.
 *
 * A NEW FIELD, NOT A NEW `SessionStatus` OR `SessionBucket` MEMBER (M10). The
 * live fleet frame is cast, not revived (`asFleetMsg`), so an unknown bucket
 * reaches `RANK[bucket]` as a NaN comparator, `WORD[bucket]` as `undefined`,
 * and `DOT[status]`, where `dot.className = DOT[status].cls` THROWS in an
 * already-deployed PWA. A dead row's KIND of dead is a qualifier on the row,
 * never a new sorting class.
 *
 * PURE, and deliberately clock-free: `nowMs` is an input, so the whole table is
 * testable with no timers and the bash twin can be driven against the identical
 * fixed clock. State — the heartbeat's freshness window aside — lives at the
 * caller.
 * ------------------------------------------------------------------------- */

export type SessionLifecycle =
  | 'running' | 'unsupervised' | 'stopped' | 'restarting'
  | 'orphan' | 'never-started' | 'unmeasurable';

/** Derived from the type, not restated beside it — `Record<SessionLifecycle,
 *  true>` makes a member added to the union fail LOUDLY here (TS2739) instead
 *  of silently producing a list one short, and fails the other way too (TS2353)
 *  on a key the union does not have. Same technique, same reasoning, as
 *  `PR_REASONS` above. */
const SESSION_LIFECYCLE_MAP: Record<SessionLifecycle, true> = {
  running: true, unsupervised: true, stopped: true, restarting: true,
  orphan: true, 'never-started': true, unmeasurable: true,
};
export const SESSION_LIFECYCLES: readonly SessionLifecycle[] =
  Object.keys(SESSION_LIFECYCLE_MAP) as SessionLifecycle[];

/** The only way to narrow an untrusted string to a `SessionLifecycle` — the
 *  snapshot-revival path reads one out of a cache an OLDER OR NEWER build
 *  wrote. `unknown` parameter so nothing can be smuggled in by claiming it is
 *  already a lifecycle, and the CONSTANT is cast rather than the input, exactly
 *  as `isPrPhase`'s own docstring insists. */
export function isSessionLifecycle(v: unknown): v is SessionLifecycle {
  return typeof v === 'string' && (SESSION_LIFECYCLES as readonly string[]).includes(v);
}

/** Who asked for the stop — a DECLARATION, not an authentication (spec §4.1).
 *  `--surface pwa` means the caller said it was the PWA; a session that shells
 *  `ccd stop` from its own Bash tool passes no flag and records `cli`, which is
 *  honest — that is exactly what it looks like from the box. */
export type StopSurface = 'cli' | 'pwa' | 'agent' | 'ccd' | 'unknown';

const STOP_SURFACE_MAP: Record<StopSurface, true> = {
  cli: true, pwa: true, agent: true, ccd: true, unknown: true,
};
/** MODULE-PRIVATE, for the reason `PR_PHASES`' own docstring gives at length:
 *  with the list unexported, `STOP_SURFACES.includes(raw as StopSurface)`
 *  cannot be written in `registry.ts` at all — it is TS2459 before the casts
 *  are even considered — so `isStopSurface` is the only door. */
const STOP_SURFACES: readonly StopSurface[] = Object.keys(STOP_SURFACE_MAP) as StopSurface[];

export function isStopSurface(v: unknown): v is StopSurface {
  return typeof v === 'string' && (STOP_SURFACES as readonly string[]).includes(v);
}

/** The REGISTRY fields the ladder below reads. `alive` is deliberately not one:
 *  it comes from tmux, not from `$REG`, and arrives as a plain boolean. Naming
 *  a field here that the ladder does not read would make an unrelated degraded
 *  read (a stuck `.branch`) print `unmeasurable` over a perfectly measured row. */
export type LifecycleField = 'started' | 'stopped' | 'supervised';
const LIFECYCLE_FIELD_MAP: Record<LifecycleField, true> = {
  started: true, stopped: true, supervised: true,
};
export const LIFECYCLE_FIELDS: readonly LifecycleField[] =
  Object.keys(LIFECYCLE_FIELD_MAP) as LifecycleField[];

/** A `$REG/<id>.supervised` stamp younger than this means A SUPERVISOR IS
 *  WATCHING RIGHT NOW (spec §4.2) — strictly more useful than an enable
 *  symlink, which only promises a start at next boot. ccd re-stamps every 30
 *  seconds, so the window is four heartbeats wide: one missed tick is not an
 *  alarm, four is. The bash twin carries the same number in seconds. */
export const SUPERVISED_FRESH_MS = 120_000;

export interface LifecycleInput {
  /** A tmux pane exists for this id. */
  readonly alive: boolean;
  /** Epoch ms of the supervisor heartbeat; null = no stamp on disk. */
  readonly supervisedAt: number | null;
  /** Epoch ms of the stop stamp; null = no stamp on disk. */
  readonly stoppedAt: number | null;
  /** Who declared the stop. Carried so the input IS the stamp as read, rather
   *  than a lossy projection of it — the ladder deliberately does not branch on
   *  it (`session-lifecycle.test.ts` pins that no surface changes the answer),
   *  because "somebody stopped it" is the fact, and who is the row's copy. */
  readonly stopSurface: StopSurface | null;
  /** `$REG/<id>.started` reads `1` — this row ever had a session. */
  readonly started: boolean;
  /** Registry field names this pass could not MEASURE — listed in the registry
   *  directory but their bytes never came back. Three-valued input, collapsed
   *  to a name list: the present/absent/unreadable discrimination happens in
   *  the registry reader, which has the directory listing to do it with; this
   *  function only reads the verdict. Any member of `LIFECYCLE_FIELDS` here
   *  makes the answer `unmeasurable`; anything else is ignored. */
  readonly unmeasured: readonly string[];
  readonly nowMs: number;
}

/**
 * §4.3's table, in order. The order is the specification:
 *
 *   alive + fresh heartbeat            -> running
 *   alive + stale/absent heartbeat     -> unsupervised
 *   dead  + stop stamp                 -> stopped
 *   dead  + fresh heartbeat            -> restarting
 *   dead  + started                    -> orphan
 *   dead                               -> never-started
 *   any lifecycle field unreadable     -> unmeasurable   (checked FIRST)
 *
 * `unmeasurable` is checked before everything because architecture rule (b)
 * forbids a seam value that stands for more than one condition: remote
 * `readFile` collapses "missing", "forbidden" and "agent disconnected" into one
 * `null` (`remote/io.ts`), and an unreadable registry must NOT print `orphan` —
 * the one answer that says "nothing is watching this session" about a session
 * nobody managed to look at.
 *
 * The stop stamp is checked before the heartbeat in the not-alive branch so a
 * stop taken INSIDE the 120-second freshness window reads `stopped`
 * immediately, rather than spending two minutes claiming to be `restarting`.
 *
 * WHAT `orphan` CLAIMS, AND WHAT IT DOES NOT: it says nothing is watching this
 * session and nobody recorded stopping it. It does NOT claim the unit file is
 * absent — the server cannot see systemd at all (§4.2 chose a heartbeat over
 * introspection precisely so the agent's read whitelist stayed unwidened) — so
 * a unit that is enabled but `failed` and one that was never enabled both land
 * here. That conflation is deliberate and safe: the two have the same answer,
 * `ccd start <id>`.
 */
export function sessionLifecycle(input: LifecycleInput): SessionLifecycle {
  if (input.unmeasured.some((f) => (LIFECYCLE_FIELDS as readonly string[]).includes(f))) {
    return 'unmeasurable';
  }
  // A stamp from the FUTURE counts as fresh: the honest reading of clock skew
  // between the box that stamps and the box that reads is "a supervisor wrote
  // this", never "nobody is watching".
  const supervised = input.supervisedAt !== null
    && input.nowMs - input.supervisedAt < SUPERVISED_FRESH_MS;
  if (input.alive) return supervised ? 'running' : 'unsupervised';
  if (input.stoppedAt !== null) return 'stopped';
  if (supervised) return 'restarting';
  return input.started ? 'orphan' : 'never-started';
}
```

- [ ] **Step 4: Run both suites — the TypeScript side green, and the bash twin measured against it**

Run: `cd server && ./node_modules/.bin/vitest run test/session-lifecycle.test.ts test/ccd-session-lifecycle.test.ts` (`timeout: 600000`)

Expected: PASS both, with the three `unmeasurable` rows reported as skipped-with-a-reason in `ccd-session-lifecycle.test.ts`.

If a ROW fails on the bash side, the two implementations disagree and **ccd is what changes** — the fixture is the spec table and the TypeScript ladder is proved against it by the file that just passed. Do not relax a row to make the twin green.

- [ ] **Step 5: Run the gates**

Run: `cd server && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` (`timeout: 600000`) — Expected: PASS all. `typecheck-tests.test.ts` runs `server/test/tsconfig.tests.json`, whose include is `./**/*.ts`, so the new fixture module and both test files are typechecked by the suite itself.

Run: `cd pwa && ./node_modules/.bin/tsc --noEmit` (`timeout: 600000`) — Expected: PASS. `pwa/tsconfig.json` includes `../shared`, and this task's additions are purely additive (no field added to any interface the PWA constructs), so nothing there moves. This gate is cheap insurance that stays honest; Task 9 is where it actually bites.

- [ ] **Step 6: Commit**

```bash
git add shared/api.ts server/test/sessionLifecycleFixture.ts server/test/session-lifecycle.test.ts server/test/ccd-session-lifecycle.test.ts
git commit -m "feat(shared): one lifecycle ladder, proved in two languages from one fixture"
```

---

### Task 9: the fleet row carries its lifecycle without touching the bucket ladder

Implements spec §4.4's wire half — "On the wire, lifecycle is a **new optional field on `FleetSession`**, not a new `SessionStatus` or `SessionBucket` member." The defect it kills is the second half of D3: ccd now records *why* a session is not alive (§4.1's stop stamp, §4.2's heartbeat, §2.4's swap refusal, §3.1's spawn verdict), and nothing on the server reads any of it, so the PWA still shows one undifferentiated dead row.

Three rulings this task encodes:

- **M10 is a hard constraint, not a preference.** A new `SessionStatus`/`SessionBucket` member crashes an already-deployed PWA — `dot.className = DOT[status].cls` throws, `RANK[bucket]` is a NaN comparator, and snapshot revival rejects the whole cache. So: no new member, no change to `sessionBucket`'s ladder, and a negative test that a `stopped`/`orphan` row is still bucketed `dead`.
- **An older cache must still revive.** `~/.ccrc/state-cache.json` and the PWA's `ccrc.fleet-snapshot.v1` are read back by whatever build starts NEXT — older, same, or newer. An absent `lifecycle` degrades to `null`, and that is asserted explicitly, because it is the compatibility contract this whole field rides on.
- **`unmeasurable` is produced in the reader, not the classifier.** `buildRecord` already distinguishes listed-but-unreadable from absent for the identity triple, using the directory listing as evidence `field()` alone does not have. The three lifecycle fields get the same ladder, and their verdict is what `sessionLifecycle` reads.

**Files:**
- Modify: `shared/api.ts` (`FleetSession` gains three fields, after `unmeasured` at ~line 107; `reviveFleetSession`'s `revived` literal at ~line 1000 gains the same three, plus their validators near `BUCKETS` at ~line 865)
- Modify: `server/src/registry.ts` (`SessionRecord` at ~line 16; `buildRecord`'s `Promise.all` at ~line 278; the parse + lifecycle-unmeasured ladder before the returned literal at ~line 314)
- Modify: `server/src/fleet.ts` (`assembleFleet`, between the `hs` read at ~line 214 and the `session` literal at ~line 215)
- Modify: `server/test/registry.test.ts` (new describe; the `toHaveLength(17)` read-count pin at line 252)
- Modify: `server/test/bucket.test.ts` (the negative)
- Modify: `server/test/fleetstate.test.ts` (revival compatibility; the `session()` builder at line 13)
- Modify: `server/test/fleet-health.test.ts` (the `session()` builder at line 34)
- Modify: `server/test/hold-gate.test.ts` (the one `SessionRecord` literal, line 224)
- Modify: 17 `pwa/test/*` FleetSession builders (Step 6 — enumerated mechanically, not from this list)
- Create: `server/test/fleet-lifecycle.test.ts` (assembleFleet's end of the wire)

**Interfaces:**
- Consumes: `SessionLifecycle`, `StopSurface`, `isSessionLifecycle`, `isStopSurface`, `LifecycleInput`, `sessionLifecycle`, `SESSION_LIFECYCLES` (Task 8); ccd's `$REG/<id>.stopped`, `.supervised`, `.swapblocked`, `.spawn` (the ccd D1/D2/D3 tasks); `unreadableField(id, field)` — the listed-but-unreadable `FleetIO` idiom already in `registry.test.ts`.
- Produces: `SessionRecord.stopped` / `.supervisedAt` / `.swapBlocked` / `.spawn` / `.lifecycleUnmeasured` and `SWAP_BLOCKED_NO_REASON`, all from `server/src/registry.ts`; `FleetSession.lifecycle` / `.stoppedBy` / `.swapBlocked` on the wire. The PWA task (stage 3) renders them; nothing else consumes `spawn` yet, which is what makes that task purely additive.

- [ ] **Step 1: Write the failing test(s)**

Append to `server/test/registry.test.ts` (the file's `seed` helper and the `unreadableField` idiom from the identity-ladder describe are reused verbatim — hoist `unreadableField` to module scope if it is still nested, rather than writing a second copy):

```ts
// D3, spec §4.1/§4.2/§2.4/§3.1. Four stamps ccd writes and nothing read: the
// deliberate stop (`<epoch> <surface>`), the supervisor heartbeat (`<epoch>`),
// the swap refusal (`<epoch> <reason>`) and the last spawn verdict
// (`<epoch> <rc>`). Epoch and payload share ONE field per stamp on purpose —
// the registry is read per-field per-session on a 2s tick, and packing is what
// keeps `stopped` one read instead of two.
describe('the lifecycle stamps (D3)', () => {
  let home: string;
  let reg: string;
  beforeEach(() => {
    home = mkTmp('ccrc-');
    reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    seed(reg, 'demo-quiet-basin', {
      uuid: 'a'.repeat(36), wrapper: 'claude', workdir: '/w', project: 'demo',
    });
  });

  const read = async (io = localIO) =>
    (await readRegistry(io, loadConfig({ CCRC_HOME: home })))[0]!;

  it('reads all four stamps off disk, splitting epoch from payload', () => {
    // Kills the mutant that reads the whole file as the epoch (NaN -> null,
    // so every stamp in the fleet would vanish) and the one that reads the
    // whole file as the payload (a surface of "1785300000 pwa").
    seed(reg, 'demo-quiet-basin', {
      stopped: '1785300000 pwa',
      supervised: '1785300100',
      swapblocked: '1785299000 no transcript found for uuid under claude',
      spawn: '1785299500 4',
    });
    return read().then((r) => {
      expect(r.stopped).toEqual({ at: 1785300000, surface: 'pwa' });
      expect(r.supervisedAt).toBe(1785300100);
      expect(r.swapBlocked).toEqual({
        at: 1785299000, reason: 'no transcript found for uuid under claude',
      });
      expect(r.spawn).toEqual({ at: 1785299500, rc: 4 });
      expect(r.lifecycleUnmeasured).toEqual([]);
    });
  });

  it('normalizes a stop surface this build does not know, and one that is missing entirely, to `unknown`', async () => {
    // §4.1: the word is text FROM THE WIRE being written into the registry, so
    // it is validated on read as well as on write — a version-skewed ccd is the
    // ordinary case on this box. `unknown` is a real member of the union, so
    // there is somewhere honest to land; the epoch survives either way.
    seed(reg, 'demo-quiet-basin', { stopped: '1785300000 slack' });
    expect((await read()).stopped).toEqual({ at: 1785300000, surface: 'unknown' });
    seed(reg, 'demo-quiet-basin', { stopped: '1785300000' });
    expect((await read()).stopped).toEqual({ at: 1785300000, surface: 'unknown' });
  });

  it('nulls a stamp whose epoch is missing or non-numeric — a torn write is not a fact', async () => {
    // An interrupted `_reg_set` leaves a zero-byte or half-written field.
    // `Number('')` is 0, and `stoppedAt: 0` classifies a live session as
    // stopped-in-1970 — the same silent lie `numOrNull` exists to refuse.
    for (const bad of ['', '   ', 'pwa', 'notanepoch pwa']) {
      seed(reg, 'demo-quiet-basin', { stopped: bad, supervised: bad });
      const r = await read();
      expect(r.stopped, JSON.stringify(bad)).toBeNull();
      expect(r.supervisedAt, JSON.stringify(bad)).toBeNull();
    }
  });

  it('gives a swap refusal with no reason a sentence, never an empty display string', async () => {
    // Same ruling as HOLD_NO_REASON, for the same reason: the reason string IS
    // the display (spec §2.4 — the field is the durable half of the refusal,
    // rendered on the row), and `reason: ''` renders as a banner with nothing
    // in it on every surface while every consumer still shows it.
    seed(reg, 'demo-quiet-basin', { swapblocked: '1785299000' });
    expect((await read()).swapBlocked).toEqual({ at: 1785299000, reason: SWAP_BLOCKED_NO_REASON });
    seed(reg, 'demo-quiet-basin', { swapblocked: '1785299000    ' });
    expect((await read()).swapBlocked).toEqual({ at: 1785299000, reason: SWAP_BLOCKED_NO_REASON });
  });

  it('nulls a spawn stamp whose rc is not a number — a verdict that does not parse is not a verdict', async () => {
    seed(reg, 'demo-quiet-basin', { spawn: '1785299500 exploded' });
    expect((await read()).spawn).toBeNull();
    seed(reg, 'demo-quiet-basin', { spawn: '1785299500' });
    expect((await read()).spawn).toBeNull();
  });

  it('marks a LISTED but unreadable lifecycle field unmeasured — never absent', async () => {
    // The identity ladder's own evidence rule, applied to the three fields
    // §4.3's classifier reads: the directory listing proves PRESENCE
    // independently of whether the bytes came back. Without this the ladder
    // sees "no stop stamp" for a stop that was recorded and prints `orphan` —
    // rule (b)'s exact prohibition.
    seed(reg, 'demo-quiet-basin', { stopped: '1785300000 pwa', supervised: '1785300100', started: '1' });
    for (const f of ['stopped', 'supervised', 'started']) {
      const r = await read(unreadableField('demo-quiet-basin', f));
      expect(r.lifecycleUnmeasured, f).toEqual([f]);
    }
  });

  it('leaves every stamp null and lifecycleUnmeasured empty on a session that has none of them', async () => {
    // The overwhelming majority of rows the day this ships, and every row a
    // pre-D3 ccd ever wrote. Absence is absence.
    const r = await read();
    expect([r.stopped, r.supervisedAt, r.swapBlocked, r.spawn]).toEqual([null, null, null, null]);
    expect(r.lifecycleUnmeasured).toEqual([]);
  });
});
```

Add `SWAP_BLOCKED_NO_REASON` to that file's `../src/registry.js` import, and `beforeEach`/`mkdirSync`/`unreadableField` as needed.

In the same file, **edit the existing read-count pin in place** (around line 252). This is not a new
test: keep its whole body — the counting io fake, the fixture registry it builds, and the
`readRegistryMeasured` call — and change only the three lines shown. The two `17`s become `21`, and
the title's number with them. Read the case before you edit it; if its body no longer looks like
this, the counts are still what must change.

```ts
  it('costs exactly one readdir plus the one id\'s 21 field reads — never a per-session Promise.all for a sibling', async () => {
    // …the existing body is unchanged, down to the assertions below…
    expect(readdirCalls).toBe(1);
    // 17 + D3's four stamps (stopped, supervised, swapblocked, spawn). The
    // number is pinned rather than derived because it IS the remote-mode cost:
    // one round trip each, per session, per 2-second tick.
    expect(fieldReads).toHaveLength(21);
```

Append to `server/test/bucket.test.ts`:

```ts
// §4.4 and non-goal §6: "No new SessionStatus/SessionBucket member, and no
// bucket-ladder change." M10 is why — the live fleet frame is CAST, not
// revived, so an unknown bucket reaches `RANK[bucket]` as a NaN comparator and
// `DOT[status].cls` THROWS in an already-deployed PWA. A dead row's kind of
// dead is a qualifier ON the row, never a new sorting class.
describe('the lifecycle field moves no bucket (M10)', () => {
  it('a dead row is `dead` whatever its lifecycle says — all seven of them', () => {
    for (const lc of SESSION_LIFECYCLES) {
      // Assigned to a const first: a fresh object literal at the call site
      // would trip excess-property checking, which is the compiler telling us
      // `BucketInput` does not name this field — exactly the property this
      // test exists to keep true.
      const s = { ...base, status: 'dead' as const, statusUpdatedAt: 42, lifecycle: lc };
      expect(sessionBucket(s, null), lc).toEqual({ bucket: 'dead', bucketSince: 42 });
    }
  });

  it('an archived, merged row still routes to cleanup with a lifecycle set — the archived rungs come first', () => {
    // §4.3: "An archived row never reaches this table." `ws-archive` stamps
    // `.stopped` through `_ws_unsupervise`, so an archived workspace DOES carry
    // `lifecycle: 'stopped'` on the wire — and it must still bucket `cleanup`,
    // because the archived rungs are tested before `dead` for the reason this
    // file's first test already states.
    const s = {
      ...base, status: 'dead' as const, archivedAt: 1700,
      pr: { phase: 'merged' } as never, lifecycle: 'stopped' as const,
    };
    expect(sessionBucket(s, null).bucket).toBe('cleanup');
  });
});
```

Add `SESSION_LIFECYCLES` to that file's `../../shared/api.js` import.

Append to `server/test/fleetstate.test.ts`'s `describe('loadSnapshot revives a cache written by an older build', …)`:

```ts
  it('revives `lifecycle`/`stoppedBy`/`swapBlocked` — absent degrades to null, and the CACHE STILL REVIVES', async () => {
    // THE COMPATIBILITY CONTRACT, spec §4.4: "Snapshot revival treats an absent
    // lifecycle as null, which is what every cached row written before this
    // build will carry." The load-bearing assertion is the first one — every
    // state-cache.json and every ccrc.fleet-snapshot.v1 on disk the day this
    // ships lacks all three fields, and a rejection here empties degraded mode
    // at exactly the moment it is the only data there is.
    //
    // NOT derived the way `bucket` is: the ladder needs `alive` and a heartbeat
    // no snapshot ever carried. A timestamp for an episode we cannot date is a
    // claim; null is the reading.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [v1Session('claude-quiet-basin')]);
    const snap = await loadSnapshot(cachePath);
    expect(snap, 'an older cache must still revive').not.toBeNull();
    const s = snap?.sessions[0];
    expect(s?.lifecycle).toBeNull();
    expect(s?.stoppedBy).toBeNull();
    expect(s?.swapBlocked).toBeNull();
    // Present as KEYS, not merely undefined: `undefined !== null` is true, and
    // that is the exact shape this whole revival module exists to prevent.
    expect(Object.keys(s ?? {})).toEqual(expect.arrayContaining(['lifecycle', 'stoppedBy', 'swapBlocked']));
  });

  it('round-trips a populated lifecycle triple', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    const populated: FleetSession = {
      ...session('claude-quiet-basin'),
      lifecycle: 'stopped',
      stoppedBy: { at: 1785300000000, surface: 'pwa' },
      swapBlocked: { at: 1785299000000, reason: 'no transcript found under claude' },
    };
    await saveSnapshot([populated], cachePath);
    expect((await loadSnapshot(cachePath))?.sessions[0]).toEqual(populated);
  });

  it('degrades a stop surface this build does not know to `unknown` — the union HAS a designated ignorance member', async () => {
    // Same stance as `pr.phase` -> 'unchecked', and for the same reason: the
    // vocabulary carries a member that means "we cannot say", so version skew
    // degrades rather than rejecting a whole fleet's worth of cache.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{
      ...v1Session('claude-quiet-basin'),
      lifecycle: 'stopped', stoppedBy: { at: 1785300000000, surface: 'slack' },
    }]);
    expect((await loadSnapshot(cachePath))?.sessions[0]?.stoppedBy)
      .toEqual({ at: 1785300000000, surface: 'unknown' });
  });

  it('rejects a lifecycle token this build does not recognise — absence is ignorance, a stray token is not', async () => {
    // The opposite stance from absence, and the same one `bucket` and
    // `hookState` take: `null` here is an AFFIRMATIVE claim ("this build never
    // measured a lifecycle"), so laundering a token we cannot parse into it
    // would put a confident blank where a future build put a fact.
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), lifecycle: 'zombie' }]);
    expect(await loadSnapshot(cachePath)).toBeNull();
  });

  it('rejects a malformed stoppedBy/swapBlocked rather than laundering it into null', async () => {
    const cachePath = path.join(tmpDir(), 'state-cache.json');
    for (const bad of [
      { stoppedBy: 'yesterday' },
      { stoppedBy: { surface: 'pwa' } },                    // no `at`
      { stoppedBy: { at: 'soon', surface: 'pwa' } },
      { swapBlocked: { at: 1785299000000 } },               // no `reason`
      { swapBlocked: { at: 1785299000000, reason: 7 } },
    ]) {
      writeRaw(cachePath, [{ ...v1Session('claude-quiet-basin'), ...bad }]);
      expect(await loadSnapshot(cachePath), JSON.stringify(bad)).toBeNull();
    }
  });
```

Create `server/test/fleet-lifecycle.test.ts`:

```ts
// §4.4's wire half, end to end: registry stamps on disk -> `buildRecord` ->
// `sessionLifecycle` -> the `FleetSession` the PWA receives. The unit ladder is
// pinned in session-lifecycle.test.ts and the bash twin in
// ccd-session-lifecycle.test.ts; what is only provable HERE is that
// `assembleFleet` wires the right evidence into it, on the right timebase, and
// moves nothing else while doing so.
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { assembleFleet } from '../src/fleet.js';
import { Tmux, type Runner } from '../src/exec.js';
import { localIO } from '../src/io.js';
import { mkTmp } from './tmpHelpers.js';

const NOW_SEC = 1785300000;
const ID = 'demo-quiet-basin';

/** A registry with one session and whatever stamps the case wants. `alive`
 *  drives the tmux stub, exactly as the fixture rows drive `_alive` on the bash
 *  side — the pane's liveness is an input here too. */
const fixture = (fields: Record<string, string>, alive: boolean) => {
  const home = mkTmp('ccrc-lifecycle-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const base = { uuid: 'a'.repeat(36), wrapper: 'claude', project: 'demo', workdir: '/w' };
  for (const [k, v] of Object.entries({ ...base, ...fields })) {
    writeFileSync(path.join(reg, `${ID}.${k}`), v);
  }
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: alive ? 0 : 1, stdout: '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { cfg: loadConfig({ CCRC_HOME: home }), tmux: new Tmux(run) };
};

const one = async (fields: Record<string, string>, alive: boolean) => {
  const { cfg, tmux } = fixture(fields, alive);
  const fleet = await assembleFleet(localIO, cfg, tmux, NOW_SEC);
  return fleet.find((s) => s.id === ID)!;
};

describe('assembleFleet ships the lifecycle', () => {
  it('classifies a live, freshly-supervised session as running', async () => {
    // Kills the seconds/milliseconds mutant in BOTH directions: a heartbeat 5
    // seconds old is fresh only if `supervisedAt` and `nowMs` are on the same
    // timebase. Forget one `* 1000` and the age becomes ~1.785 billion ms
    // (unsupervised) or ~ -1.785 billion (running for the wrong reason, which
    // the stale case below then catches).
    const s = await one({ supervised: String(NOW_SEC - 5), started: '1' }, true);
    expect(s.lifecycle).toBe('running');
  });

  it('classifies a live session whose supervisor stopped heartbeating as unsupervised', async () => {
    const s = await one({ supervised: String(NOW_SEC - 600), started: '1' }, true);
    expect(s.lifecycle).toBe('unsupervised');
  });

  it('classifies a stopped row as stopped, and says who and when — in epoch MS', async () => {
    // The wire timebase is MS, matching `statusUpdatedAt`/`bucketSince` and the
    // PWA's relative-time helpers. (`archivedAt` is the one exception, in
    // seconds, because it shipped that way; a second exception would make the
    // unit a coin toss at every call site.)
    const s = await one({ stopped: `${NOW_SEC - 90} pwa` }, false);
    expect(s.lifecycle).toBe('stopped');
    expect(s.stoppedBy).toEqual({ at: (NOW_SEC - 90) * 1000, surface: 'pwa' });
  });

  it('classifies a dead, unstopped, unwatched row that once ran as orphan', async () => {
    const s = await one({ started: '1' }, false);
    expect(s.lifecycle).toBe('orphan');
    expect(s.stoppedBy).toBeNull();
  });

  it('classifies a registry row that never had a session as never-started', async () => {
    expect((await one({}, false)).lifecycle).toBe('never-started');
  });

  it('never infers orphan from an unreadable stamp — the whole point of rule (b)', async () => {
    // The remote-mode shape: the file is LISTED, its bytes never come back.
    // Before the ladder existed this row printed a confident `orphan` about a
    // session nobody managed to look at.
    const { cfg, tmux } = fixture({ stopped: `${NOW_SEC - 90} pwa`, started: '1' }, false);
    const blind = { ...localIO, readFile: async (p: string) =>
      (p.endsWith(`${ID}.stopped`) ? null : localIO.readFile(p)) };
    const fleet = await assembleFleet(blind, cfg, tmux, NOW_SEC);
    expect(fleet.find((s) => s.id === ID)!.lifecycle).toBe('unmeasurable');
  });

  it('carries a swap refusal onto the wire, with its reason verbatim', async () => {
    // §2.4/M9: the registry is the durable channel — a notify banner raised
    // with no socket open is gone, and this field is what is still there for
    // whoever was not watching.
    const s = await one({ swapblocked: `${NOW_SEC - 300} no transcript found under claude` }, false);
    expect(s.swapBlocked).toEqual({
      at: (NOW_SEC - 300) * 1000, reason: 'no transcript found under claude',
    });
  });

  it('leaves all three fields null for a row with no stamps, and never undefined', async () => {
    const s = await one({ started: '1' }, true);
    expect(s.lifecycle).toBe('unsupervised');   // measured, not null: no heartbeat is evidence
    expect(s.stoppedBy).toBeNull();
    expect(s.swapBlocked).toBeNull();
    expect(Object.keys(s)).toEqual(expect.arrayContaining(['lifecycle', 'stoppedBy', 'swapBlocked']));
  });

  it('moves neither status nor bucket — a stopped row is still `dead`/`dead` (M10)', async () => {
    // The negative this whole task is bounded by. The bucket ladder is
    // untouched; the qualifier rides beside it.
    const s = await one({ stopped: `${NOW_SEC - 90} agent` }, false);
    expect(s.status).toBe('dead');
    expect(s.bucket).toBe('dead');
    expect(s.lifecycle).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/registry.test.ts test/bucket.test.ts test/fleetstate.test.ts test/fleet-lifecycle.test.ts` (`timeout: 600000`)

Expected: FAIL, in this shape —
- `registry.test.ts`: `SyntaxError: The requested module '…/src/registry.ts' does not provide an export named 'SWAP_BLOCKED_NO_REASON'`
- `bucket.test.ts`: `… does not provide an export named 'SESSION_LIFECYCLES'` if Task 8 is not merged; otherwise the two new cases pass already (`sessionBucket` genuinely does not read the field) — that is a characterization test and it is fine for it to be green from the start; say so rather than manufacturing a red.
- `fleetstate.test.ts`: `expected undefined to be null` on `s?.lifecycle`
- `fleet-lifecycle.test.ts`: `expected undefined to be 'running'`

- [ ] **Step 3: Add the three wire fields and their revival to `shared/api.ts`**

In `FleetSession`, immediately after `unmeasured` (shape-authoritative — reconcile the anchor against the live file):

```ts
  /**
   * WHY this row is not alive — spec §4.3's classification, computed by
   * `sessionLifecycle` in `fleet.ts` from the pane plus three registry stamps.
   *
   * A NEW FIELD, NOT A NEW `SessionStatus`/`SessionBucket` MEMBER (M10). The
   * bucket ladder is untouched: a dead row stays in the `dead` bucket and gains
   * a qualifier — "stopped by pwa, 2d ago", "orphan — nothing is watching it",
   * "running unsupervised".
   *
   * `null` means NO LIFECYCLE WAS RECORDED, which today is exactly one thing: a
   * snapshot written before this build. It is never a fourth classification —
   * `unmeasurable` is what "we could not measure" looks like, and it is a
   * member of the union, not this null.
   */
  readonly lifecycle: SessionLifecycle | null;
  /** The deliberate stop, as recorded (§4.1). Epoch MS — the timebase
   *  `statusUpdatedAt`/`bucketSince` already use, NOT `archivedAt`'s seconds.
   *  Null when no stop was recorded. The surface is a DECLARATION: it says the
   *  caller claimed to be the PWA, not that anything authenticated it. */
  readonly stoppedBy: { readonly at: number; readonly surface: StopSurface } | null;
  /** The last swap refusal (§2.4), epoch MS and the reason verbatim. Null when
   *  no refusal stands — cleared by a successful swap and by any deliberate
   *  revival (`ccd start`/`enable`/`ensure`), because a revive control that
   *  leaves the refusal banner standing on the row it just revived teaches the
   *  operator to ignore banners. */
  readonly swapBlocked: { readonly at: number; readonly reason: string } | null;
```

Next to the `BUCKETS` constant, add the revival validators:

```ts
/** `stoppedBy.surface` splits from `lifecycle` right below it, and takes the
 *  `pr.phase` ruling rather than the `bucket` one: `StopSurface` HAS a
 *  designated "we cannot say" member (`unknown`), so a surface from a newer ccd
 *  degrades onto it instead of rejecting a whole fleet's cache. `lifecycle` has
 *  no such member available — `null` there means "never recorded", an
 *  affirmative claim about this build — so an unrecognised token rejects, the
 *  same stance `bucket`/`hookState`/`checks` take three constants up. */
const reviveStoppedBy = (o: RawObj, k: string): { at: number; surface: StopSurface } | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = asObj(v, k);
  const surfaceRaw = optStr(s, 'surface');
  return { at: reqNum(s, 'at'), surface: isStopSurface(surfaceRaw) ? surfaceRaw : 'unknown' };
};

/** No vocabulary to degrade onto: the reason is free text ccd wrote, and it IS
 *  the display. Absent → null; present-but-malformed rejects the session. */
const reviveSwapBlocked = (o: RawObj, k: string): { at: number; reason: string } | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const s = asObj(v, k);
  return { at: reqNum(s, 'at'), reason: reqStr(s, 'reason') };
};
```

In `reviveFleetSession`, beside the `bucketRaw` validation:

```ts
    // Absent → null (an older cache predates the field entirely — THE
    // compatibility contract, pinned in fleetstate.test.ts). NOT derived the
    // way `bucket` is: the ladder needs `alive` and a supervisor heartbeat no
    // snapshot ever carried, and a classification computed from fields we do
    // not have would be a claim, not a reading.
    const lifecycleRaw = optStr(o, 'lifecycle');
    if (lifecycleRaw !== null && !isSessionLifecycle(lifecycleRaw)) {
      throw new MalformedSnapshot('lifecycle');
    }
```

and in the `revived` literal, after `unmeasured`:

```ts
      lifecycle: lifecycleRaw,
      stoppedBy: reviveStoppedBy(o, 'stoppedBy'),
      swapBlocked: reviveSwapBlocked(o, 'swapBlocked'),
```

(`lifecycleRaw` is already narrowed to `SessionLifecycle | null` by the guard above — no cast.)

- [ ] **Step 4: Read the four stamps in `server/src/registry.ts`**

Add to `SessionRecord`, after `held` and before `unmeasured`:

```ts
  /** `$REG/<id>.stopped` — `<epoch> <surface>`, written by `_ws_unsupervise`
   *  (the single choke point every deliberate unsupervise reaches systemd
   *  through: `cmd_stop`, `ws-rm`, `ws-archive`, `ws-reap`, `forget`) and
   *  cleared by `_ws_supervise` and any successful spawn. Epoch SECONDS, as
   *  ccd writes it (`date +%s`, exactly like `archivedAt`); `fleet.ts` is the
   *  one place it becomes ms. A surface outside the closed set — a newer ccd,
   *  a hand-edited file — normalizes to `unknown` here, never leaks. */
  stopped: { at: number; surface: StopSurface } | null;
  /** `$REG/<id>.supervised` — epoch SECONDS, re-stamped by `cmd_supervise`
   *  every 30s and by `cmd_swap` while it carries files. Younger than
   *  `SUPERVISED_FRESH_MS` means a supervisor is watching RIGHT NOW, which is
   *  strictly more than an enable symlink promises (§4.2). The server cannot
   *  ask systemd anything — the agent's read whitelist covers `~/.cc-sessions`
   *  and not `~/.config/systemd` — so the supervisor publishes instead. */
  supervisedAt: number | null;
  /** `$REG/<id>.swapblocked` — `<epoch> <reason>`, the durable half of §2.4's
   *  refusal (M9: a notify banner with no socket open is gone). */
  swapBlocked: { at: number; reason: string } | null;
  /** `$REG/<id>.spawn` — `<epoch> <rc>`, written by `_spawn` ALWAYS, before
   *  returning (§3.1). Read here so the verdict a supervisor raised in its own
   *  process is a fact this side of the seam can see; no wire field carries it
   *  yet, which is what makes the PWA task purely additive. */
  spawn: { at: number; rc: number } | null;
  /** Which of `started`/`stopped`/`supervised` were LISTED but unreadable this
   *  pass — the same evidence rule `unmeasured` uses for the identity triple,
   *  over the three fields §4.3's classifier reads. Kept SEPARATE from
   *  `unmeasured` on purpose: that array is typed `IdentityField[]`, is carried
   *  onto the wire verbatim, and is validated against the identity triple by
   *  `reviveFleetSession` — widening it would reject every snapshot. The
   *  visible consequence of this one is `lifecycle: 'unmeasurable'`, which is
   *  the honest thing to show and the only thing a viewer can act on. */
  lifecycleUnmeasured: readonly string[];
}
```

Import `isStopSurface` and `type StopSurface` from `../../shared/api.js` (the file already imports `isPrPhase` and types from there).

Add the constant beside `HOLD_NO_REASON`:

```ts
/**
 * The reason a swap refusal carries when `$REG/<id>.swapblocked` records an
 * epoch and nothing after it. Same ruling as `HOLD_NO_REASON` and for the same
 * reason: §2.4's refusal is durable precisely so somebody who was not watching
 * finds out WHY, and `reason: ''` renders as a marker with an empty
 * explanation on every surface — visible enough to alarm, empty enough to
 * ignore.
 */
export const SWAP_BLOCKED_NO_REASON = '<swap refusal recorded no reason>';
```

Add the packed-stamp parser beside `numOrNull`:

```ts
/** `<epoch> <rest>` — the packed two-token stamp shape every D3 field uses.
 *  Epoch and payload share ONE registry file on purpose (§4.1): the registry is
 *  read per-field per-session on a 2s tick, and packing is what keeps `stopped`
 *  one read instead of two. A stamp whose epoch does not parse is NOT a stamp —
 *  an interrupted `_reg_set` leaves a zero-byte file, and `Number('')` is 0,
 *  which would date a live session's stop to 1970. */
function packedStamp(raw: string | null): { at: number; rest: string } | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  const sp = trimmed.indexOf(' ');
  const at = numOrNull(sp === -1 ? trimmed : trimmed.slice(0, sp));
  if (at === null) return null;
  return { at, rest: sp === -1 ? '' : trimmed.slice(sp + 1).trim() };
}
```

In `buildRecord`, extend the `Promise.all` destructuring and its reads (append to the existing array — the order of the destructured names must stay aligned with the order of the `field()` calls):

```ts
  const [wrapper, project, workdir, uuid, started, home, pool, lastswap, workspace, branch,
    base, prPhaseRaw, prNumberRaw, prCheckedAtRaw, archivedRaw, manifestRaw, holdRaw,
    stoppedRaw, supervisedRaw, swapBlockedRaw, spawnRaw] = await Promise.all([
    …existing seventeen, unchanged…
    field(io, cfg.registryDir, id, 'stopped'), field(io, cfg.registryDir, id, 'supervised'),
    field(io, cfg.registryDir, id, 'swapblocked'), field(io, cfg.registryDir, id, 'spawn'),
  ]);
```

After the identity-triple ladder and before the returned literal:

```ts
  // §4.3's three-valued read, over the three fields the lifecycle classifier
  // consumes. Same evidence as the identity ladder above: `names` is the
  // listing this function opened with, so it proves PRESENCE independently of
  // whether the bytes came back — the one thing `field()` alone cannot tell
  // you. Without it a stop that WAS recorded but could not be read looks like
  // no stop at all, and the classifier prints `orphan` about a session nobody
  // managed to look at. That is rule (b)'s exact prohibition, and it is why the
  // discrimination lives here rather than in the pure function.
  const lifecycleUnmeasured: string[] = [];
  for (const [f, raw] of [
    ['started', started], ['stopped', stoppedRaw], ['supervised', supervisedRaw],
  ] as const) {
    if (raw === null && names.includes(`${id}.${f}`)) lifecycleUnmeasured.push(f);
  }

  const stopStamp = packedStamp(stoppedRaw);
  const swapStamp = packedStamp(swapBlockedRaw);
  const spawnStamp = packedStamp(spawnRaw);
  const spawnRc = spawnStamp === null ? null : numOrNull(spawnStamp.rest);
```

and in the returned object, after `held`:

```ts
    // The surface is validated on READ as well as on write (`cmd_stop`
    // validates its `--surface` argv). Both, not either: this box runs a ccd
    // that is routinely a deploy ahead of or behind the server, so a word from
    // a vocabulary this build does not have is the ordinary case, not the
    // exotic one. `unknown` is a real member, so there is somewhere honest to
    // put it — and the epoch, which is the part the ladder reads, survives.
    stopped: stopStamp === null
      ? null
      : { at: stopStamp.at, surface: isStopSurface(stopStamp.rest) ? stopStamp.rest : 'unknown' },
    supervisedAt: numOrNull(supervisedRaw),
    swapBlocked: swapStamp === null
      ? null
      : { at: swapStamp.at, reason: swapStamp.rest === '' ? SWAP_BLOCKED_NO_REASON : swapStamp.rest },
    // An rc that does not parse is not a verdict. `_spawn` writes the stamp
    // ALWAYS, before returning, so a half-written one means a torn write, not
    // an ambiguous outcome — and `rc: NaN` on the wire renders as `null` while
    // typing as `number`, the silent lie `numOrNull` exists to refuse.
    spawn: spawnStamp === null || spawnRc === null ? null : { at: spawnStamp.at, rc: spawnRc },
    lifecycleUnmeasured,
    unmeasured,
```

- [ ] **Step 5: Compute the lifecycle in `server/src/fleet.ts`**

Extend the `../../shared/api.js` imports with `sessionLifecycle` (value) and `type LifecycleInput`. Then, in `assembleFleet`, after `const hs = hookStates?.get(r.id) ?? null;` and before `const session: FleetSession = {`:

```ts
    // §4.3's ladder, on the evidence THIS assembly measured: the pane it just
    // asked tmux about, plus the three registry stamps `buildRecord` read in
    // the same pass — one observation, never two reads that could disagree
    // (the same reasoning this function's `records` parameter already states).
    //
    // THE UNIT CONVERSION LIVES HERE AND NOWHERE ELSE. Registry stamps are
    // epoch SECONDS (ccd writes `date +%s`, exactly as `archived` does);
    // `LifecycleInput` is epoch MS. `now` is this call's own second-resolution
    // clock, so the whole comparison happens on one timebase and a stale
    // heartbeat cannot read as fresh because two operands disagreed by 1000x.
    const lifecycleInput: LifecycleInput = {
      alive,
      supervisedAt: r.supervisedAt === null ? null : r.supervisedAt * 1000,
      stoppedAt: r.stopped === null ? null : r.stopped.at * 1000,
      stopSurface: r.stopped?.surface ?? null,
      started: r.started,
      unmeasured: r.lifecycleUnmeasured,
      nowMs: now * 1000,
    };
```

and in the `session` literal, after `unmeasured: r.unmeasured,`:

```ts
      // §4.4: a NEW FIELD, never a new `SessionStatus`/`SessionBucket` member
      // (M10 — an unknown bucket reaches `RANK[bucket]` as a NaN comparator and
      // `DOT[status].cls` THROWS in an already-deployed PWA). The bucket ladder
      // two lines down is untouched, and `bucket.test.ts` pins that.
      //
      // Computed for EVERY row, archived ones included. `ws-archive`
      // unsupervises through `_ws_unsupervise`, which stamps, so an archived
      // workspace honestly reads `stopped`; the bucket ladder routes it to
      // `archived`/`cleanup` and the renderer does not show the qualifier
      // there. Suppressing the MEASUREMENT here would be a lie told to make a
      // renderer simpler.
      lifecycle: sessionLifecycle(lifecycleInput),
      // Epoch MS on the wire — the timebase `statusUpdatedAt`/`bucketSince`
      // already use and the PWA's relative-time helpers already read.
      // `archivedAt` is the one exception, in seconds, because it shipped that
      // way; a second exception would make the unit a coin toss at every site.
      stoppedBy: r.stopped === null ? null : { at: r.stopped.at * 1000, surface: r.stopped.surface },
      swapBlocked: r.swapBlocked === null
        ? null
        : { at: r.swapBlocked.at * 1000, reason: r.swapBlocked.reason },
```

- [ ] **Step 6: Bring every full literal and every read-count claim up to date**

Three required-and-nullable fields on `FleetSession` means every place that builds a COMPLETE one must name them — which is the point of `reviveFleetSession` returning a literal rather than a spread (its own docstring: "a field added to the interface and forgotten here is a compile error rather than a fourth outage"). Enumerate the sites mechanically rather than trusting this plan's snapshot:

```bash
grep -rn "bucketSince: null" server/src server/test pwa/test pwa/src shared --include=*.ts --include=*.tsx
grep -rn "SessionRecord = {" server/test --include=*.ts
```

As measured at plan time that is: `server/test/fleetstate.test.ts:13`, `server/test/fleet-health.test.ts:34`, and 17 `pwa/test` builders (`app.test.tsx`, `fleet-screen.test.tsx`, `groupFleet.test.ts`, `header.test.tsx`, `lifecycle-ui.test.tsx`, `offline.test.ts`, `polish.test.tsx`, `pr-sheet.test.tsx`, `project-card.test.tsx`, `reap-sheet.test.tsx`, `runs-screen.test.tsx`, `session-actions-sheet.test.tsx`, `session-line.test.tsx`, `sortFleet.test.ts`, `stores.test.ts`, `tap-targets.test.tsx`, `typed-label.test.tsx`). Each gets the same three keys added beside `unmeasured: []`:

```ts
  lifecycle: null, stoppedBy: null, swapBlocked: null,
```

`pwa/tsconfig.json` includes `test`, and `npm run build` there is `tsc --noEmit && vite build`, so a builder left short is a broken PWA build, not a quiet one. These are fixture edits only — the PWA's rendering of the new fields is the stage-3 task and is deliberately not here.

The one `SessionRecord` literal, `server/test/hold-gate.test.ts:224`, gains the five record fields:

```ts
      prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
      stopped: null, supervisedAt: null, swapBlocked: null, spawn: null, lifecycleUnmeasured: [],
      unmeasured: ['wrapper'],
```

Then the read-count prose. `buildRecord` now fires 21 field reads per session, not 17, and a comment that states a measured cost is a comment a future author copies:

```bash
grep -rn '~17\|17 field\|17 reads\|17 fields\|409 round' server/src server/test
```

Update each hit to the new numbers — 21 reads per session, ~22 round trips for `readSessionRecord` (21 + one `readdir`), and 505 for a 24-session whole-fleet sweep (24 × 21 + 1) where 409 appears. Sites at plan time: `server/src/registry.ts` (:119, :172, :382, :429), `server/src/fleet.ts:170`, `server/src/watch.ts:572`, `server/src/server.ts:425`, `server/test/hold-gate.test.ts` (:82, :362), `server/test/push-copy.test.ts:310`, `server/test/routes.test.ts:128`, plus `server/test/registry.test.ts` (:166 and the title/assertion already changed in Step 1). Recompute rather than sed — one of them counts round trips, not reads.

- [ ] **Step 7: Run the gates**

Run: `cd server && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` (`timeout: 600000`) — Expected: PASS all. Watch specifically that `fleet.test.ts`, `fleetws.test.ts`, `hold-gate.test.ts` and `routes.test.ts` stay green: they exercise `readRegistry`/`assembleFleet` end to end and are the suites a mis-ordered `Promise.all` destructuring would break silently (every field would shift by four).

Run: `cd pwa && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run` (`timeout: 600000`) — Expected: PASS. The typecheck is the real gate here — `shared/api.ts` is in the PWA's include, so a builder left short of the three new fields fails here and nowhere else.

- [ ] **Step 8: Commit**

```bash
git add shared/api.ts server/src/registry.ts server/src/fleet.ts server/src/watch.ts server/src/server.ts server/test/registry.test.ts server/test/bucket.test.ts server/test/fleetstate.test.ts server/test/fleet-health.test.ts server/test/hold-gate.test.ts server/test/push-copy.test.ts server/test/routes.test.ts server/test/fleet-lifecycle.test.ts pwa/test
git commit -m "feat(server): the fleet row carries why it is dead, and the bucket ladder never hears about it"
```

---

### Task 10: the resolver climbs a ladder and answers with a typed outcome

Implements spec §5.1 (the seven-rung ladder), §5.2 (the outcome union, `found` vs `fallback`, and `complete`), §5.4 (the structural short-circuit plus the memo) and §5.5 (remote degradation, stated rather than accidental). It kills D4's half of the incident: `resolveTranscriptFile` (`server/src/transcript/resolve.ts:55-65`) munges **one** directory, tries its resolved and raw forms, and gives up — so M4's live session whose cwd moved into a worktree renders "No messages yet" over a 70MB transcript, and M2's 17-of-23 rows of cross-account residue are unreachable by construction.

This task changes **no caller**. `resolveTranscriptFile` survives as a thin wrapper that takes `.path` off the union, so `sessionws.ts`, `watch.ts` and `commands.ts` compile and behave exactly as today, and the existing `server/test/transcript-parse.test.ts` — five cases built against real symlink chains on `localIO` — is left untouched deliberately: it is the proof that the wrapper is faithful. Task 11 moves the callers, deletes the wrapper, and migrates those five cases onto the union.

**Files:**
- Modify: `server/src/transcript/resolve.ts` (keep `transcriptPath` and `resolveDir` as they are; add the union, the ladder, the glob helpers, the rung order and the memo; rewrite `resolveTranscriptFile` at :55-65 into a wrapper)
- Test: `server/test/transcript-ladder.test.ts` (create)
- Untouched on purpose: `server/test/transcript-parse.test.ts`

**Interfaces:**
- Consumes: `FleetIO` (`server/src/io.ts:11-31`) — note `stat` answers `{ mtimeMs, size } | null` and there is **no inode on this seam**; `readdir` answers `string[] | null`; `realpath` answers `null` unconditionally in remote mode (`server/src/remote/io.ts:24-26`). `mungePath` (`server/src/munge.ts`).
- Produces, for Tasks 11 and 12: `TranscriptRung`, `TranscriptResolution`, `ResolveOpts`, `resolveTranscript(io, o)`, `TranscriptResolver` (the memo), `RUNG_ORDER`, `rungRank(r)`, `GlobHit`, `collapseHits(hits)`, `pickNewest(hits)`, `RESOLVER_BACKOFF_MS`, `MEMO_MAX`. `transcriptPath` stays exported and unchanged.

- [ ] **Step 1: Write the failing test(s)**

Create `server/test/transcript-ladder.test.ts`:

```ts
// D4, spec §5.1-§5.5: the resolver stops betting the render on one path.
// The ladder is existence-first and its ORDER is the product, so every rung
// gets a fixture where each earlier rung MISSES and it alone hits — a mutant
// that reorders two rungs, drops one, or short-circuits early fails here.
// Real files on real disk against `localIO`, the idiom `transcript-parse.test.ts`
// already establishes for this module; `FleetIO` spread-fakes (the
// `unlistableIO` shape from `sessionws.test.ts`) cover the seams disk cannot.
import { describe, it, expect } from 'vitest';
import { mkdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import {
  collapseHits, MEMO_MAX, pickNewest, resolveTranscript, RUNG_ORDER, rungRank,
  transcriptPath, TranscriptResolver, type GlobHit, type ResolveOpts,
} from '../src/transcript/resolve.js';
import { mkTmp } from './tmpHelpers.js';

const UUID = 'u'.repeat(36);

interface Box {
  root: string; cfg: string;
  liveLink: string; livePhys: string;
  regLink: string; regPhys: string;
}

/** The production chain in miniature — `<root>/data -> <root>/volume`, same
 *  shape as `transcript-parse.test.ts`'s own `build()` — with a SECOND project
 *  dir so the live cwd and the registry workdir can genuinely differ (M8: a
 *  worktree tool chdir'd the process without a `/cd`). The root is realpath'd
 *  so `/tmp` being a symlink on some hosts cannot make rung 1 fire by accident. */
const box = (): Box => {
  const root = realpathSync(mkTmp('ccrc-ladder-'));
  mkdirSync(path.join(root, 'volume', 'projects', 'demo'), { recursive: true });
  mkdirSync(path.join(root, 'volume', 'projects', 'other'), { recursive: true });
  symlinkSync(path.join(root, 'volume'), path.join(root, 'data'));
  return {
    root,
    cfg: path.join(root, '.claude'),
    liveLink: path.join(root, 'data', 'projects', 'demo'),
    livePhys: path.join(root, 'volume', 'projects', 'demo'),
    regLink: path.join(root, 'data', 'projects', 'other'),
    regPhys: path.join(root, 'volume', 'projects', 'other'),
  };
};

/** Plant a transcript and STAMP its mtime — newest-wins must be a fact of the
 *  fixture, never of how fast the test ran. */
const plant = (file: string, mtimeSec: number, body = '{}\n'): string => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
  utimesSync(file, mtimeSec, mtimeSec);
  return file;
};

const opts = (b: Box, over: Partial<ResolveOpts> = {}): ResolveOpts => ({
  configDir: b.cfg, dir: b.liveLink, registryWorkdir: b.regLink, uuid: UUID, ...over,
});

/** A glob-only address: a project dir no munge of any fixture path produces, so
 *  only rung 5/6 can ever reach it. */
const stranded = (cfg: string, uuid = UUID): string =>
  path.join(cfg, 'projects', '-a-directory-no-munge-produces', `${uuid}.jsonl`);

const hit = (over: Partial<GlobHit>): GlobHit =>
  ({ path: '/p', size: 10, mtimeMs: 1000, account: null, order: 0, ...over });

describe('resolveTranscript — the ladder, rung by rung (spec §5.1)', () => {
  it('rung 1: the RESOLVED munge of the directory given wins when the file is there', async () => {
    // Kills a mutant that drops the realpath walk — today's rung 1, the fix
    // that made dead sessions behind a symlinked workdir render at all.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.livePhys, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'live-resolved', account: null });
  });

  it('rung 2: the RAW munge of the directory given wins when only IT exists', async () => {
    // Kills a mutant that returns the resolved path unconditionally: every
    // session whose workdir has no symlink in it lives here.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.liveLink, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'live-raw', account: null });
  });

  it('rung 3: the RESOLVED munge of the REGISTRY workdir rescues a live session whose cwd moved (M4)', async () => {
    // THE reproduced production failure: the process reports a worktree cwd in
    // <configDir>/sessions/<pid>.json while Claude Code keeps appending under
    // its startup directory. Kills a mutant that never crosses from `dir` to
    // `registryWorkdir` — which is exactly what the old resolver could not do.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.regPhys, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'registry-resolved', account: null });
  });

  it('rung 4: the RAW munge of the registry workdir, when nothing above it exists', async () => {
    // Kills a mutant that only ever resolves the registry workdir and never
    // tries it raw.
    const b = box();
    const f = plant(transcriptPath(b.cfg, b.regLink, UUID), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'registry-raw', account: null });
  });

  it('rung 5: the uuid glob finds a transcript that moved inside its own account', async () => {
    // Kills a mutant that stops after the four exact addresses. `account` is
    // null: this is the session's OWN config dir, so there is nothing to banner.
    const b = box();
    const f = plant(stranded(b.cfg), 1000);
    expect(await resolveTranscript(localIO, opts(b))).toEqual(
      { kind: 'found', path: f, rung: 'uuid-glob', account: null });
  });

  it('rung 5 picks the NEWEST of several own-account matches', async () => {
    // Kills a mutant that returns the first readdir entry — readdir order is
    // not a preference, and M2's copies differ by weeks.
    const b = box();
    plant(path.join(b.cfg, 'projects', '-old', `${UUID}.jsonl`), 1000, 'old\n');
    const fresh = plant(path.join(b.cfg, 'projects', '-new', `${UUID}.jsonl`), 9000, 'fresher\n');
    const r = await resolveTranscript(localIO, opts(b));
    expect(r).toEqual({ kind: 'found', path: fresh, rung: 'uuid-glob', account: null });
  });

  it('rung 6: a foreign account is used ONLY when 1-5 all miss, and names the account holding it', async () => {
    // The stranded-history case (M2: 17 of 23 rows carry residue under other
    // accounts). Kills a mutant that forgets `account`, which is the entire
    // input to the PWA's banner — a foreign hit rendered silently is the quiet
    // wrongness this spec exists to remove.
    const b = box();
    const personal = path.join(b.root, '.claude-personal');
    const corp = path.join(b.root, '.claude-corp');
    plant(stranded(personal), 2000, 'older foreign\n');
    const newest = plant(stranded(corp), 3000, 'newer foreign\n');
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true }); // own account: listable, empty
    const r = await resolveTranscript(localIO, opts(b, {
      foreign: [{ account: 'claude2', configDir: personal }, { account: 'claude-corp', configDir: corp }],
    }));
    expect(r).toEqual({ kind: 'found', path: newest, rung: 'foreign-glob', account: 'claude-corp' });
  });

  it('an own-account answer beats a NEWER foreign one — rung 6 is never reached while rung 5 hits', async () => {
    // Kills the mutant that pools own and foreign together: M2's five copies of
    // one uuid would then render another account's frozen history for most of
    // the fleet.
    const b = box();
    const personal = path.join(b.root, '.claude-personal');
    plant(stranded(personal), 9000, 'newer, but foreign\n');
    const own = plant(stranded(b.cfg), 1000, 'older, but ours\n');
    const r = await resolveTranscript(localIO, opts(b, {
      foreign: [{ account: 'claude2', configDir: personal }],
    }));
    expect(r).toEqual({ kind: 'found', path: own, rung: 'uuid-glob', account: null });
  });

  it('a foreign mtime tie breaks by roster declaration order, then by path — deterministic, so a test can pin it', async () => {
    // Kills a mutant that leaves the tie to readdir/Map order. `cp -p` carries
    // mtime AND size across accounts (§2.2), so exact ties are ordinary.
    const b = box();
    const first = path.join(b.root, '.claude-first');
    const second = path.join(b.root, '.claude-second');
    const a = plant(stranded(first), 5000, 'same bytes\n');
    plant(stranded(second), 5000, 'same bytes\n');
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true });
    const r = await resolveTranscript(localIO, opts(b, {
      foreign: [{ account: 'first', configDir: first }, { account: 'second', configDir: second }],
    }));
    expect(r).toEqual({ kind: 'found', path: a, rung: 'foreign-glob', account: 'first' });
  });

  it('rung 7: nothing anywhere is a COMPLETE fallback at the raw munge of the directory given', async () => {
    // Kills a mutant that returns null/throws when nothing exists: a tailer
    // pointed at a not-yet-written path must keep working, exactly as today.
    const b = box();
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true }); // listable and empty: the search RAN
    expect(await resolveTranscript(localIO, opts(b))).toEqual({
      kind: 'fallback', path: transcriptPath(b.cfg, b.liveLink, UUID), complete: true,
    });
  });

  it('a null readdir marks the fallback INCOMPLETE — never read as an absence (§5.5)', async () => {
    // The rule (b) case, and the whole reason `complete` exists: remote readdir
    // answers null for a missing directory, a forbidden path and a disconnected
    // agent alike (remote/io.ts). Kills the mutant that hardcodes
    // `complete: true`, which would render a confident empty chat over a fleet
    // host the server simply could not reach.
    const b = box();
    const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };
    expect(await resolveTranscript(unlistableIO, opts(b))).toEqual({
      kind: 'fallback', path: transcriptPath(b.cfg, b.liveLink, UUID), complete: false,
    });
  });

  it('a foreign account that cannot be listed also marks the answer incomplete', async () => {
    // Kills a mutant that only tracks completeness for the own-account glob.
    const b = box();
    const io: FleetIO = {
      ...localIO,
      readdir: async (p) => (p.includes('.claude-personal') ? null : localIO.readdir(p)),
    };
    mkdirSync(path.join(b.cfg, 'projects'), { recursive: true });
    const r = await resolveTranscript(io, opts(b, {
      foreign: [{ account: 'claude2', configDir: path.join(b.root, '.claude-personal') }],
    }));
    expect(r).toEqual({ kind: 'fallback', path: transcriptPath(b.cfg, b.liveLink, UUID), complete: false });
  });

  it('remote mode (realpath always null) collapses 1 into 2 and 3 into 4, and the uuid glob still works (§5.5)', async () => {
    // Documented degradation, pinned rather than assumed: a transcript under
    // the PHYSICAL munge is unreachable by the exact rungs remotely, and rung 5
    // is what still finds it — with no widening of the agent read whitelist.
    const b = box();
    const remoteish: FleetIO = { ...localIO, realpath: async () => null };
    const phys = plant(transcriptPath(b.cfg, b.livePhys, UUID), 1000);
    const r = await resolveTranscript(remoteish, opts(b));
    expect(r).toEqual({ kind: 'found', path: phys, rung: 'uuid-glob', account: null });
  });
});

describe('rung order and candidate collapse (spec §5.1)', () => {
  it('rungRank is strictly increasing in ladder order and a fallback ranks after every rung', () => {
    // §5.3's "strictly better rung" comparator reads this order. Kills a mutant
    // that reorders RUNG_ORDER or ranks a fallback as a hit.
    expect(RUNG_ORDER).toEqual([
      'live-resolved', 'live-raw', 'registry-resolved', 'registry-raw', 'uuid-glob', 'foreign-glob',
    ]);
    const ranks = RUNG_ORDER.map((rung) => rungRank({ kind: 'found', path: '/p', rung, account: null }));
    expect(ranks).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rungRank({ kind: 'fallback', path: '/p', complete: true })).toBe(RUNG_ORDER.length);
  });

  it('collapseHits folds identical (size, mtimeMs) names into ONE candidate (M1)', () => {
    // The fleet holds one inode wearing three names right now. Three names for
    // one file must not read as three candidates. Kills a mutant that dedupes
    // on path (which never collapses anything) or on size alone (which would
    // fold two genuinely different files).
    const names = ['/c.jsonl', '/a.jsonl', '/b.jsonl'].map((p) => hit({ path: p, size: 70, mtimeMs: 42 }));
    const collapsed = collapseHits([...names, hit({ path: '/d.jsonl', size: 70, mtimeMs: 43 })]);
    expect(collapsed).toHaveLength(2);
    // The survivor of a collapsed group is the lowest (order, path) — stable,
    // so the rendered path does not wander between ticks.
    expect(collapsed.map((h) => h.path).sort()).toEqual(['/a.jsonl', '/d.jsonl']);
  });

  it('pickNewest: newest mtime wins, ties by roster order, then by path', () => {
    // Kills mutants that sort ascending, that skip the order tiebreak, or that
    // leave the final tie to input order.
    expect(pickNewest([])).toBeNull();
    expect(pickNewest([
      hit({ path: '/old', mtimeMs: 1 }), hit({ path: '/new', mtimeMs: 2 }),
    ])!.path).toBe('/new');
    expect(pickNewest([
      hit({ path: '/second', mtimeMs: 5, size: 1, order: 1 }),
      hit({ path: '/first', mtimeMs: 5, size: 2, order: 0 }),
    ])!.path).toBe('/first');
    expect(pickNewest([
      hit({ path: '/zzz', mtimeMs: 5, size: 2, order: 0 }),
      hit({ path: '/aaa', mtimeMs: 5, size: 1, order: 0 }),
    ])!.path).toBe('/aaa');
  });
});

describe('TranscriptResolver — the memo (spec §5.4)', () => {
  /** A counting FleetIO. The stat/readdir counts ARE §5.4's cost claim: steady
   *  state must be ONE stat per session per tick, cheaper than today's found
   *  case, or the ladder is a regression on every open socket. */
  const counting = (inner: FleetIO = localIO) => {
    const n = { stat: 0, readdir: 0 };
    const io: FleetIO = {
      ...inner,
      stat: (p) => { n.stat += 1; return inner.stat(p); },
      readdir: (p) => { n.readdir += 1; return inner.readdir(p); },
    };
    return { io, n };
  };

  /** A dead-session box: dir === registryWorkdir and the dir is its own
   *  realpath, so all four exact rungs collapse to ONE candidate — the
   *  four-to-two collapse §5.1 promises, here at its floor. */
  const flat = (): { cfg: string; dir: string } => {
    const root = realpathSync(mkTmp('ccrc-memo-'));
    const dir = path.join(root, 'projects', 'demo');
    mkdirSync(dir, { recursive: true });
    return { cfg: path.join(root, '.claude'), dir };
  };

  it('re-validates a found answer with exactly ONE stat and no readdir at all', async () => {
    const { cfg, dir } = flat();
    const f = plant(stranded(cfg), 1000);
    mkdirSync(path.join(cfg, 'projects', '-b'), { recursive: true });
    const { io, n } = counting();
    const r = new TranscriptResolver(io);
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };

    const first = await r.resolve(o);
    expect(first).toEqual({ kind: 'found', path: f, rung: 'uuid-glob', account: null });
    // One exact candidate + one readdir + one stat per listed project dir.
    expect(n.readdir).toBe(1);
    const afterFirst = n.stat;
    expect(afterFirst).toBeGreaterThan(1);

    expect(await r.resolve(o)).toEqual(first);
    expect(n.stat - afterFirst).toBe(1);   // the whole point: ONE stat
    expect(n.readdir).toBe(1);             // and the search does not re-run
  });

  it('re-ladders the moment its winner vanishes', async () => {
    // Kills a mutant that trusts the memo blindly — the session would tail a
    // deleted path forever and the chat would freeze mid-conversation.
    const { cfg, dir } = flat();
    const f = plant(stranded(cfg), 1000);
    const { io, n } = counting();
    const r = new TranscriptResolver(io);
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };
    expect((await r.resolve(o)).path).toBe(f);
    const readdirs = n.readdir;

    rmSync(f);
    expect(await r.resolve(o)).toEqual({
      kind: 'fallback', path: transcriptPath(cfg, dir, UUID), complete: true,
    });
    expect(n.readdir).toBe(readdirs + 1); // the full ladder actually re-ran
  });

  it('a changed key re-ladders; the key is (configDir, uuid, dir)', async () => {
    // Kills a mutant with a single-slot memo or a key missing the uuid — a
    // /clear rotates the uuid and would otherwise keep rendering the old file.
    const { cfg, dir } = flat();
    const a = plant(stranded(cfg), 1000);
    const other = 'o'.repeat(36);
    const b = plant(stranded(cfg, other), 1000);
    const r = new TranscriptResolver(localIO);
    expect((await r.resolve({ configDir: cfg, dir, registryWorkdir: dir, uuid: UUID })).path).toBe(a);
    expect((await r.resolve({ configDir: cfg, dir, registryWorkdir: dir, uuid: other })).path).toBe(b);
  });

  it('a fallback re-ladders only when its back-off expires — and then finds what appeared elsewhere', async () => {
    // §5.4's back-off, pinned with an injected clock so the test never sleeps.
    // Kills both mutants: one that re-ladders every call (the 2 s full-search
    // regression this memo exists to prevent) and one that never re-ladders
    // (a swapped-in transcript would never appear).
    const { cfg, dir } = flat();
    mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    let clock = 1_000_000;
    const { io, n } = counting();
    const r = new TranscriptResolver(io, { backoffMs: 30_000, now: () => clock });
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };

    expect((await r.resolve(o)).kind).toBe('fallback');
    const readdirs = n.readdir;

    const f = plant(stranded(cfg), 1000);   // a swap lands somewhere the exact rungs cannot see
    clock += 29_000;
    expect((await r.resolve(o)).kind).toBe('fallback'); // still inside the back-off
    expect(n.readdir).toBe(readdirs);

    clock += 2_000;
    expect(await r.resolve(o)).toEqual({ kind: 'found', path: f, rung: 'uuid-glob', account: null });
    expect(n.readdir).toBe(readdirs + 1);
  });

  it('a fallback whose own path appears re-ladders immediately, back-off or not', async () => {
    // The common heal: the session finally writes at the address the tailer is
    // already pointed at. Kills a mutant that makes the back-off the ONLY exit
    // from a fallback, which would delay every new session's first render.
    const { cfg, dir } = flat();
    mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    const r = new TranscriptResolver(localIO, { backoffMs: 30_000, now: () => 1_000_000 });
    const o: ResolveOpts = { configDir: cfg, dir, registryWorkdir: dir, uuid: UUID };
    const raw = transcriptPath(cfg, dir, UUID);
    expect((await r.resolve(o)).kind).toBe('fallback');
    plant(raw, 1000);
    expect(await r.resolve(o)).toEqual({ kind: 'found', path: raw, rung: 'live-raw', account: null });
  });

  it('the memo is bounded — a rotating uuid cannot grow it without limit', async () => {
    // The watcher's sweep shares ONE resolver across every row, and a /clear
    // mints a fresh uuid on every rotation: an unbounded Map is a slow leak in
    // a process that runs for weeks.
    const { cfg, dir } = flat();
    mkdirSync(path.join(cfg, 'projects'), { recursive: true });
    const r = new TranscriptResolver(localIO);
    for (let i = 0; i < MEMO_MAX + 20; i += 1) {
      await r.resolve({ configDir: cfg, dir, registryWorkdir: dir, uuid: `${i}`.padStart(36, '0') });
    }
    expect((r as unknown as { memo: Map<string, unknown> }).memo.size).toBeLessThanOrEqual(MEMO_MAX);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts` (`timeout: 600000`)
Expected: FAIL — the module has none of these exports yet, so the file fails at import:
`SyntaxError: The requested module '../src/transcript/resolve.js' does not provide an export named 'resolveTranscript'` (vitest reports it as an unhandled error collecting the file, zero tests run). Confirm that exact shape before writing any implementation — a failure for a different reason means the fixture is wrong, not the code.

- [ ] **Step 3: Add the union, the rung order and the glob helpers**

In `server/src/transcript/resolve.ts`, keep the file's first 31 lines exactly as they are (`transcriptPath` and the private `resolveDir` are unchanged and both stay), and append below them. Code is shape-authoritative — reconcile the imports and the surrounding lines against the live file:

```ts
/** WHICH rung of §5.1's ladder produced an answer. It travels in the outcome
 *  rather than being recomputed by callers because §5.3's re-point rule is
 *  "strictly better rung", and a caller that recomputed it would be deciding
 *  the same question twice with two implementations. */
export type TranscriptRung =
  | 'live-resolved' | 'live-raw' | 'registry-resolved' | 'registry-raw'
  | 'uuid-glob' | 'foreign-glob';

/** §5.1's ladder as DATA: the index is the rung's rank, so the order lives in
 *  one place and a test can read it back. */
export const RUNG_ORDER: readonly TranscriptRung[] = [
  'live-resolved', 'live-raw', 'registry-resolved', 'registry-raw', 'uuid-glob', 'foreign-glob',
];

/**
 * What the resolver answers. A bare `string` cannot carry this and rule (b)
 * (architecture doc: no overloaded null at a seam) forbids inventing one:
 *
 *   - `found` names the rung, so `SessionStream` can tell a better answer from
 *     a different one, and the `account` for a rung-6 hit, so the PWA can say
 *     "stranded history, held by `claude`" instead of rendering another
 *     account's frozen copy silently. `account` is null for every other rung.
 *   - `fallback` is the raw munge of the directory given — the address a tailer
 *     keeps working against for a session that later writes there — plus the
 *     one bit rule (b) is really about: whether the search was COMPLETE.
 *     "I looked everywhere and there is nothing" and "a readdir answered null
 *     so rungs 5 and 6 never ran" are different facts, and §5.5 makes the
 *     second one routine in remote mode. A `complete: false` fallback renders
 *     as "can't read the fleet host right now", never as "no messages yet".
 */
export type TranscriptResolution =
  | { readonly kind: 'found'; readonly path: string; readonly rung: TranscriptRung;
      readonly account: string | null }
  | { readonly kind: 'fallback'; readonly path: string; readonly complete: boolean };

/** Ladder position, for §5.3's "strictly better" comparison. A fallback ranks
 *  after every rung: it is not a hit. */
export function rungRank(r: TranscriptResolution): number {
  return r.kind === 'fallback' ? RUNG_ORDER.length : RUNG_ORDER.indexOf(r.rung);
}

export interface ResolveOpts {
  readonly configDir: string;
  /** The live cwd when the session is live, else the registry workdir. */
  readonly dir: string;
  readonly registryWorkdir: string;
  readonly uuid: string;
  /** The OTHER accounts, in roster declaration order — rung 6's input and its
   *  tiebreak. Absent means "do not search other accounts", which is what the
   *  name sweep and the slash-command listing pass (§5.2): a derived name must
   *  never come from another account's frozen copy. The list comes from the
   *  caller, never a literal of account names in this module (architecture
   *  rule (a): config is data). */
  readonly foreign?: readonly { readonly account: string; readonly configDir: string }[];
}

/** One existing `<configDir>/projects/<something>/<uuid>.jsonl`. */
export interface GlobHit {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  /** The account this came from, or null for the session's own config dir. */
  readonly account: string | null;
  /** Roster declaration order — the first tiebreak after mtime. */
  readonly order: number;
}

/**
 * Fold candidates that agree on `(size, mtimeMs)` into one.
 *
 * THE TWO SIDES OF THIS FIX DEDUPE DIFFERENTLY, DELIBERATELY. `FleetIO.stat`
 * answers `{ mtimeMs, size } | null` (`io.ts:16`) — there is no inode on this
 * seam and the remote `stat` op does not carry one — so the server collapses on
 * `(size, mtimeMs)`: hardlinked names share both exactly (M1: one inode wore
 * three names in production), and two genuinely distinct files agreeing on size
 * to the byte AND mtime to the millisecond are, for the purpose of "which of
 * these do I open", the same answer. ccd is not on this seam and uses the real
 * inode (`stat -c %i`, §2.1), because there the dedupe decides whether 70MB is
 * copied three times rather than which of two identical files is displayed.
 *
 * The survivor of a group is its lowest `(order, path)`, so the rendered path
 * is stable across ticks rather than wandering with readdir order.
 */
export function collapseHits(hits: readonly GlobHit[]): GlobHit[] {
  const byIdentity = new Map<string, GlobHit>();
  for (const h of hits) {
    const key = `${h.size}:${h.mtimeMs}`;
    const kept = byIdentity.get(key);
    if (kept === undefined || h.order < kept.order || (h.order === kept.order && h.path < kept.path)) {
      byIdentity.set(key, h);
    }
  }
  return [...byIdentity.values()];
}

/** Newest mtime wins; ties break by roster declaration order, then by path —
 *  so the answer is deterministic and a test can pin it. M2's five copies of
 *  one uuid differ by weeks, and the newest is the one the operator means. */
export function pickNewest(hits: readonly GlobHit[]): GlobHit | null {
  let best: GlobHit | null = null;
  for (const h of collapseHits(hits)) {
    if (best === null) { best = h; continue; }
    if (h.mtimeMs > best.mtimeMs) { best = h; continue; }
    if (h.mtimeMs < best.mtimeMs) continue;
    if (h.order < best.order) { best = h; continue; }
    if (h.order === best.order && h.path < best.path) best = h;
  }
  return best;
}

/** `<configDir>/projects/*​/<uuid>.jsonl`, existence-checked. `complete: false`
 *  means the directory could not be LISTED — never that it held nothing. */
async function globByUuid(
  io: FleetIO, configDir: string, uuid: string, account: string | null, order: number,
): Promise<{ hits: GlobHit[]; complete: boolean }> {
  const root = path.join(configDir, 'projects');
  const names = await io.readdir(root);
  if (names === null) return { hits: [], complete: false };
  const hits: GlobHit[] = [];
  for (const name of names) {
    const p = path.join(root, name, `${uuid}.jsonl`);
    const st = await io.stat(p);
    if (st !== null) hits.push({ path: p, size: st.size, mtimeMs: st.mtimeMs, account, order });
  }
  return { hits, complete: true };
}
```

- [ ] **Step 4: Implement the ladder**

Append to the same file:

```ts
/**
 * The transcript a reader should actually open, as a typed outcome (§5.1/§5.2).
 *
 * Existence-first, first hit wins:
 *   1. resolved munge of the directory given (the live cwd when live);
 *   2. raw munge of the directory given;
 *   3. resolved munge of the REGISTRY workdir;
 *   4. raw munge of the registry workdir;
 *   5. `<configDir>/projects/*​/<uuid>.jsonl`, newest wins, duplicates collapsed;
 *   6. the same glob across the OTHER accounts, pooled, newest winning globally
 *      — only when 1-5 all miss, and always carrying the account so the UI can
 *      banner it;
 *   7. otherwise the raw munge of the directory given, as a fallback.
 *
 * THE ORDER IS LIVENESS-DEPENDENT ON PURPOSE. A live session's rungs 1-2 are
 * its live cwd and its 3-4 the registry workdir; a dead session's caller passes
 * the registry workdir as `dir`, so 1-2 and 3-4 coincide and four candidates
 * collapse to two (the dedupe below is what makes that literally true, not just
 * morally). A session with transcripts at both addresses therefore renders one
 * file while alive and the other once dead — the correct preference, not a
 * wobble: while the process is up, the cwd it publishes in
 * `<configDir>/sessions/<pid>.json` is direct evidence about where it is
 * working; the registry workdir is only where it was started. When that
 * evidence expires the ladder falls back to the durable fact.
 *
 * COST (§5.4): rungs 5 and 6 run only when 1-4 have all missed, so a healthy
 * session pays one realpath walk and one or two stats — what today already
 * costs. Only a session with nothing at any exact path pays for a search, and
 * `TranscriptResolver` below is what stops it paying every two seconds.
 *
 * Remote mode has no resolver (`io.realpath` answers null unconditionally), so
 * rungs 1 and 3 collapse into 2 and 4 — today's documented behavior, unchanged.
 * Rungs 5 and 6 need `readdir`+`stat`, which the remote io implements and which
 * `checkPath`'s `.claude*` glob already permits, so the uuid search works
 * remotely with NO widening of the agent read whitelist.
 */
export async function resolveTranscript(io: FleetIO, o: ResolveOpts): Promise<TranscriptResolution> {
  const exact: { rung: TranscriptRung; path: string }[] = [];
  const add = (rung: TranscriptRung, p: string): void => {
    // Dedupe keeps the FIRST rung to claim a path, which is what makes a dead
    // session's four candidates two stats instead of four.
    if (!exact.some((c) => c.path === p)) exact.push({ rung, path: p });
  };
  const pair = (resolvedRung: TranscriptRung, rawRung: TranscriptRung, dir: string, resolved: string | null): void => {
    const raw = transcriptPath(o.configDir, dir, o.uuid);
    if (resolved !== null) {
      const real = transcriptPath(o.configDir, resolved, o.uuid);
      // A workdir with no symlink in it munges identically both ways: it is
      // rung 2/4, today's behavior wherever today's behavior was right.
      if (real !== raw) add(resolvedRung, real);
    }
    add(rawRung, raw);
  };

  const liveResolved = await resolveDir(io, o.dir);
  // One realpath walk, not two, when the caller passed the same directory twice
  // — which is every DEAD session.
  const regResolved = o.registryWorkdir === o.dir ? liveResolved : await resolveDir(io, o.registryWorkdir);
  pair('live-resolved', 'live-raw', o.dir, liveResolved);
  pair('registry-resolved', 'registry-raw', o.registryWorkdir, regResolved);

  for (const c of exact) {
    if ((await io.stat(c.path)) !== null) {
      return { kind: 'found', path: c.path, rung: c.rung, account: null };
    }
  }

  const own = await globByUuid(io, o.configDir, o.uuid, null, 0);
  let complete = own.complete;
  const bestOwn = pickNewest(own.hits);
  if (bestOwn !== null) return { kind: 'found', path: bestOwn.path, rung: 'uuid-glob', account: null };

  // Pooled across accounts, newest winning globally — M2's five copies of one
  // uuid differ by weeks. Reached only when everything above missed.
  const pooled: GlobHit[] = [];
  for (const [order, acct] of (o.foreign ?? []).entries()) {
    const g = await globByUuid(io, acct.configDir, o.uuid, acct.account, order);
    if (!g.complete) complete = false;
    pooled.push(...g.hits);
  }
  const bestForeign = pickNewest(pooled);
  if (bestForeign !== null) {
    return { kind: 'found', path: bestForeign.path, rung: 'foreign-glob', account: bestForeign.account };
  }

  return { kind: 'fallback', path: transcriptPath(o.configDir, o.dir, o.uuid), complete };
}
```

- [ ] **Step 5: Implement the memo**

Append to the same file:

```ts
/** How long a "keep looking" answer — a fallback, or a foreign-account hit —
 *  is trusted before the full ladder runs again (§5.4). */
export const RESOLVER_BACKOFF_MS = 30_000;

/** Memo entries are keyed per `(configDir, uuid, dirGiven)`; a uuid rotates on
 *  every `/clear` and a workspace slug is recycled by `ws-reap`, so keys
 *  accumulate for the life of a process that runs for weeks. Insertion-ordered
 *  eviction past this cap keeps that a bounded cost. */
export const MEMO_MAX = 256;

/**
 * The ladder, memoized (§5.4). One instance per `SessionStream` and one for the
 * watcher's name sweep.
 *
 * `SessionStream` resolves on every 2-second poll for the life of every open
 * socket, and the name sweep resolves per eligible row on its own tick; a
 * seven-rung ladder run naively at that cadence would be a real regression, and
 * it would fall hardest on exactly the sessions this work is for — the ones
 * where rungs 1-4 miss. So a subsequent call re-validates the last winner with
 * a SINGLE stat and returns it. Steady state is one stat per session per tick,
 * which is cheaper than today's found case.
 *
 * The full ladder re-runs when: the winner has vanished (a `found` whose file
 * is gone), a fallback's own path has APPEARED (the common heal — the session
 * finally wrote where the tailer is already pointed), the key changed, or a
 * back-off expired. The back-off applies only to the two answers that mean
 * "keep looking": a `fallback`, and a `foreign-glob` hit.
 *
 * HONEST LIMIT, stated rather than discovered: a memoized rung-5 answer whose
 * file still exists is NOT re-laddered when a better rung starts hitting, and
 * the key does not include `registryWorkdir`. Both follow §5.4 exactly. The
 * uuid is in the key, so the case this work is really for — a swap landing —
 * re-ladders the moment the uuid rotates, and a fallback re-ladders on its
 * back-off.
 *
 * The memo is STATE, so it lives here and not in the ladder: `resolveTranscript`
 * stays pure — narrow deps in, typed union out, testable with no clock — which
 * is the ring boundary this repo already draws between deciding and acting.
 */
export class TranscriptResolver {
  private readonly memo = new Map<string, { answer: TranscriptResolution; at: number }>();
  private readonly backoffMs: number;
  private readonly now: () => number;

  constructor(
    private readonly io: FleetIO,
    opts?: { readonly backoffMs?: number; readonly now?: () => number },
  ) {
    this.backoffMs = opts?.backoffMs ?? RESOLVER_BACKOFF_MS;
    this.now = opts?.now ?? Date.now;
  }

  async resolve(o: ResolveOpts): Promise<TranscriptResolution> {
    const key = `${o.configDir}\u0000${o.uuid}\u0000${o.dir}`;
    const held = this.memo.get(key);
    if (held !== undefined && !this.staleByBackoff(held)) {
      const st = await this.io.stat(held.answer.path);
      // A `found` stays true while its file exists; a `fallback` stays true
      // while its path still does NOT.
      const stillTrue = held.answer.kind === 'found' ? st !== null : st === null;
      if (stillTrue) return held.answer;
    }
    const answer = await resolveTranscript(this.io, o);
    this.remember(key, answer);
    return answer;
  }

  private staleByBackoff(e: { answer: TranscriptResolution; at: number }): boolean {
    const keepsLooking = e.answer.kind === 'fallback' || e.answer.rung === 'foreign-glob';
    return keepsLooking && this.now() - e.at >= this.backoffMs;
  }

  private remember(key: string, answer: TranscriptResolution): void {
    this.memo.delete(key);                       // re-insert so Map order is recency
    this.memo.set(key, { answer, at: this.now() });
    while (this.memo.size > MEMO_MAX) {
      const oldest = this.memo.keys().next();
      if (oldest.done === true) break;
      this.memo.delete(oldest.value);
    }
  }
}
```

- [ ] **Step 6: Rewrite `resolveTranscriptFile` as a wrapper so no caller changes yet**

Replace the whole of the existing `resolveTranscriptFile` (`resolve.ts:33-65` — the docstring and the function). Its five-case suite in `transcript-parse.test.ts` must stay green **unedited**; that is the point of this step:

```ts
/**
 * TRANSITIONAL (removed in Task 11). The pre-ladder signature, answering the
 * ladder's path with `dir` doubling as the registry workdir and no foreign
 * accounts — so `sessionws.ts`, `watch.ts` and `commands.ts` keep compiling and
 * behaving as they do today while the ladder lands on its own. Task 11 moves
 * all three onto `resolveTranscript`, each deciding for itself what it will
 * accept, and deletes this.
 */
export async function resolveTranscriptFile(
  io: FleetIO, configDir: string, dir: string, uuid: string,
): Promise<string> {
  const r = await resolveTranscript(io, { configDir, dir, registryWorkdir: dir, uuid });
  return r.path;
}
```

- [ ] **Step 7: Run the gates**

Run: `cd server && ./node_modules/.bin/vitest run test/transcript-ladder.test.ts test/transcript-parse.test.ts test/sessionws.test.ts test/name-sweep.test.ts test/commands.test.ts` (`timeout: 600000`)
Expected: PASS — every new ladder test, and every pre-existing case in the other four files unchanged. `transcript-parse.test.ts`'s five `resolveTranscriptFile` cases passing through the wrapper is the evidence that the ladder subsumes today's behavior.

Run: `cd server && ./node_modules/.bin/tsc --noEmit` (`timeout: 600000`)
Expected: PASS (no output).

- [ ] **Step 8: Commit**

```bash
git add server/src/transcript/resolve.ts server/test/transcript-ladder.test.ts
git commit -m "fix(server): the transcript resolver climbs a ladder and says which rung answered"
```

---

### Task 11: an open stream follows the answer when it changes

Implements spec §5.3 and finishes §5.2's "all three callers take the path off the union, and each decides what it will accept". Today `SessionStream.tick()` re-points its tailer only when `data.uuid !== this.uuid` (`sessionws.ts:473-478`), because the transcript path used to be a pure function of `(cwd, uuid)`. A ladder makes the path free to change while the uuid stays put — most usefully when a swap lands and rung 5 starts hitting where rung 1 was missing a moment ago — and the current code would keep tailing the old address forever. The resume contract has the matching hole: `since` is `{ uuid, offset }` (`sessionws.ts:126`), honored on a bare uuid match (`:137-139`), so a reconnect can replay an offset taken in one file against a different one and render a transcript from its middle.

**Which callers ask for what, and why they differ.** The session stream passes `foreign` — it can show the operator a banner naming the account that holds the history. `watch.ts`'s name sweep and `commands.ts` do **not**: a derived branch name is written into the row with no banner attached to it, and a name silently taken from another account's frozen copy is the quiet wrongness this whole spec exists to remove. Rungs 1-5 are unconditional for all three.

**Wire shapes that change here, and only here:**
- `GET /ws/session/:id` gains an optional query parameter `sinceFile=<url-encoded absolute path>` alongside the existing `since=<uuid>:<offset>`. A client that sends no `sinceFile` keeps today's uuid-only resume exactly — the rollout window (server ships before the PWA) must not resend every backlog in the fleet, and that client is no worse off than it is today.
- The `backlog` frame (`shared/api.ts:1524`) gains two optional fields: `foreignAccount?: string | null` (the account a rung-6 hit came from; null for every own-account answer) and `searchComplete?: boolean` (false when a `readdir` answered null, so `missing: true` with `searchComplete: false` reads as "can't read the fleet host right now", never "no messages yet"). Both optional, both ignorable, so an older PWA build is unaffected — and no `SessionStatus`/`SessionBucket` member moves.

**The PWA half lands in Task 12**: sending `sinceFile` on reconnect, rendering the stranded-history banner from `foreignAccount`, and distinguishing an incomplete search from an empty one. Nothing in this task renders anything.

**Files:**
- Modify: `server/src/sessionws.ts` (the resolver instance + `Resolved.resolution`; `resolve()` at :346-410; `start()` at :129-150; `sendBacklogAndTail` at :417-423; `tick()` at :452-495; `parseSince` at :540-549; new exported `shouldRepoint` and `foreignConfigDirs`)
- Modify: `server/src/server.ts` (`:355` — read `sinceFile` off the query)
- Modify: `server/src/watch.ts` (`:1238` — the name sweep's resolve, plus one resolver field on `FleetWatcher`)
- Modify: `server/src/commands.ts` (`:65` — the slash-command listing's resolve)
- Modify: `server/src/transcript/resolve.ts` (delete the transitional `resolveTranscriptFile` wrapper Task 10 left)
- Modify: `shared/api.ts` (the two optional `backlog` fields)
- Modify: `server/test/transcript-parse.test.ts` (its five `resolveTranscriptFile` cases move onto `resolveTranscript`)
- Test: `server/test/sessionws.test.ts` (append)

**Interfaces:**
- Consumes: Task 10's `resolveTranscript`, `TranscriptResolver`, `TranscriptResolution`, `rungRank`.
- Produces: `shouldRepoint(cur, next, tailedExists)` and `foreignConfigDirs(cfg, own)` exported from `server/src/sessionws.ts`; `parseSince(raw, rawFile)` returning `{ uuid, offset, file: string | null }`; the `sinceFile` query parameter and the two `backlog` fields — all four consumed by Task 12.

- [ ] **Step 1: Write the failing test(s)**

Append to `server/test/sessionws.test.ts`. The first block goes at module scope beside the other pure-decision describes; the rest reuse this file's own `seed`, `mkLadderDeps`, `pollOnce`, `streamTailer`, `collect`, `opened` and `nextIgnoringAsk` helpers:

```ts
// §5.3: an open stream follows the answer when it changes. The re-point rule is
// a pure decision, exported and table-tested here for the same reason
// `nextDialogFrame` and `parseSince` are — the io-bound half (does the tailed
// file still exist?) is the ONE fact the caller measures and passes in.
describe('shouldRepoint (spec §5.3)', () => {
  const found = (rung: TranscriptRung, p: string): TranscriptResolution =>
    ({ kind: 'found', path: p, rung, account: null });

  it('re-points to a strictly better rung even while the tailed file still exists', () => {
    // THE case the uuid-only gate could never see: a swap lands, the exact
    // address starts existing, and the stream must move off the glob answer.
    expect(shouldRepoint(found('uuid-glob', '/a'), found('live-raw', '/b'), true)).toBe(true);
  });

  it('does not re-point to a WORSE rung while the tailed file is still there', () => {
    // Kills the mutant that re-points on any difference: a transient glob
    // answer must not drag a healthy stream off its exact-address transcript.
    expect(shouldRepoint(found('live-raw', '/a'), found('uuid-glob', '/b'), true)).toBe(false);
  });

  it('re-points to a worse rung once the file being tailed is GONE', () => {
    // The other half of the rule: a deleted/reaped transcript is not something
    // to keep tailing just because its rung outranks the alternative.
    expect(shouldRepoint(found('live-raw', '/a'), found('uuid-glob', '/b'), false)).toBe(true);
  });

  it('a same-rung, same-path answer changes nothing — the common case every tick', () => {
    // Kills a mutant that re-points on object identity rather than on the
    // answer: every open socket would resend its backlog every two seconds.
    expect(shouldRepoint(found('live-raw', '/a'), found('live-raw', '/a'), true)).toBe(false);
    expect(shouldRepoint(found('live-raw', '/a'), found('live-raw', '/a'), false)).toBe(false);
  });

  it('a fallback ranks below every rung, and a fallback→fallback flip is not a re-point', () => {
    // `complete` flipping (the fleet host became unreadable) is not a reason to
    // rotate the client's chat.
    const fb = (complete: boolean): TranscriptResolution => ({ kind: 'fallback', path: '/a', complete });
    expect(shouldRepoint(fb(true), found('uuid-glob', '/b'), true)).toBe(true);
    expect(shouldRepoint(fb(true), fb(false), true)).toBe(false);
  });
});

describe('foreignConfigDirs (spec §5.2)', () => {
  it('lists every OTHER account in roster order, and never the session\'s own', () => {
    // Kills two mutants: one that includes the own account (rung 6 would then
    // shadow rung 5 on a tie) and one that hand-types the account list instead
    // of reading the roster — which is how `claude-dev0`, the account holding
    // the incident's recovered transcript, would silently drop out.
    const cfg = loadConfig({ CCRC_HOME: mkTmp('ccrc-foreign-') });
    const others = foreignConfigDirs(cfg, 'claude2');
    expect(others.map((o) => o.account)).not.toContain('claude2');
    expect(others.map((o) => o.account)).toContain('claude-dev0');
    expect(others.map((o) => o.account)).toEqual(
      Object.keys(cfg.wrappers).filter((w) => w !== 'claude2'));
    expect(others.every((o) => o.configDir === cfg.wrappers[o.account as keyof typeof cfg.wrappers])).toBe(true);
  });
});

describe('the stream follows a changed answer (spec §5.3)', () => {
  it('re-points and resends backlog when the SAME uuid resolves to a better rung', async () => {
    // The transcript starts findable only by the uuid glob (rung 5) — a
    // pre-fix swap's residue, or a session whose file moved inside its own
    // account. When it lands at the exact address the stream must follow it,
    // with the EXISTING `rotated` frame and a fresh backlog. RED against the
    // old code, whose only re-point trigger was `data.uuid !== this.uuid`.
    const home = mkTmp('ccrc-repoint-');
    seed(home);
    const exact = path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`);
    const glob = path.join(home, '.claude-personal', 'projects', '-elsewhere', `${UUID_A}.jsonl`);
    rmSync(exact);
    mkdirSync(path.dirname(glob), { recursive: true });
    writeFileSync(glob, userLine('g1', 'stranded'));

    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const first = frames.find((f) => f.type === 'backlog');
      expect(first.file).toBe(glob);
      expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['g1']);
      frames.length = 0;

      // The carry lands at the address the resumed session actually reads.
      rmSync(glob);
      writeFileSync(exact, userLine('e1', 'carried'));
      await pollOnce(stream);

      expect(frames.filter((f) => f.type === 'rotated')).toEqual([{ type: 'rotated', uuid: UUID_A }]);
      const second = frames.find((f) => f.type === 'backlog');
      expect(second.file).toBe(exact);
      expect(second.uuid).toBe(UUID_A);            // same uuid — a re-point, not a rotation
      expect(second.events.map((e: { uuid: string }) => e.uuid)).toEqual(['e1']);
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('an unchanged answer re-points NOTHING — same tailer instance, no frames', async () => {
    // Kills the mutant that re-resolves and re-points unconditionally: this is
    // what every tick of every healthy session does, ~43,000 times a day.
    const home = mkTmp('ccrc-repoint-');
    seed(home);
    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const tailerBefore = streamTailer(stream);
      frames.length = 0;
      await pollOnce(stream);
      await pollOnce(stream);
      expect(frames.filter((f) => f.type === 'rotated' || f.type === 'backlog')).toEqual([]);
      expect(streamTailer(stream)).toBe(tailerBefore);   // SAME instance, never rebuilt
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('the backlog frame carries the foreign account and search completeness', async () => {
    // Task 12 renders both. Kills a mutant that drops `foreignAccount` (the
    // banner disappears and another account's frozen history renders as this
    // session's own) or hardcodes `searchComplete: true` (an unreadable fleet
    // host renders as an empty chat).
    const home = mkTmp('ccrc-foreignframe-');
    seed(home);
    rmSync(path.join(home, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`));
    const held = path.join(home, '.claude-corp', 'projects', '-stranded', `${UUID_A}.jsonl`);
    mkdirSync(path.dirname(held), { recursive: true });
    writeFileSync(held, userLine('f1', 'another account holds this'));

    const deps = mkLadderDeps(home, localIO);
    const frames: any[] = [];
    const stream = new SessionStream(deps, new Bus(), ID, (m) => frames.push(m));
    try {
      await stream.start();
      const backlog = frames.find((f) => f.type === 'backlog');
      expect(backlog.file).toBe(held);
      expect(backlog.foreignAccount).toBe('claude-corp');
      expect(backlog.searchComplete).toBe(true);
    } finally {
      stream.stop();
      rmSync(home, { recursive: true, force: true });
    }

    // And the unmeasured case: a null readdir must not read as an empty chat.
    const home2 = mkTmp('ccrc-foreignframe-');
    seed(home2);
    rmSync(path.join(home2, '.claude-personal', 'projects', MUNGED, `${UUID_A}.jsonl`));
    const frames2: any[] = [];
    const stream2 = new SessionStream(mkLadderDeps(home2, unlistableIO), new Bus(), ID, (m) => frames2.push(m));
    try {
      await stream2.start();
      const backlog = frames2.find((f) => f.type === 'backlog');
      expect(backlog).toBeDefined();
      expect(backlog.missing).toBe(true);
      expect(backlog.searchComplete).toBe(false);
    } finally {
      stream2.stop();
      rmSync(home2, { recursive: true, force: true });
    }
  });
});
```

And inside the existing `describe('session WS', …)` block (the one with `home`/`port`/`fileA`, `sessionws.test.ts:509`), immediately after the `reconnect with ?since=<uuid>:<offset>` test at `:577`:

```ts
  it('a `since` naming a DIFFERENT file resends the backlog instead of resuming at the offset', { timeout: 15_000 }, async () => {
    // §5.3: one uuid can now resolve to different files, so an offset taken in
    // one file replayed against another renders a transcript from its middle.
    // RED against the old code, which honored any offset on a bare uuid match.
    const offset = statSync(fileA).size;
    const url = `ws://127.0.0.1:${port}/ws/session/${ID}`
      + `?since=${UUID_A}:${offset}&sinceFile=${encodeURIComponent('/some/other/place.jsonl')}`;
    const ws = new WebSocket(url);
    const next = collect(ws);
    await opened(ws);

    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('backlog');                    // NOT a silent resume
    expect(first.file).toBe(fileA);
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u1', 'u2']);
    ws.close();
  });

  it('a `since` naming the file it is about to tail resumes with no backlog', { timeout: 15_000 }, async () => {
    // The other direction: the echo MATCHING must not cost a redundant backlog.
    const offset = statSync(fileA).size;
    const url = `ws://127.0.0.1:${port}/ws/session/${ID}`
      + `?since=${UUID_A}:${offset}&sinceFile=${encodeURIComponent(fileA)}`;
    const ws = new WebSocket(url);
    const next = collect(ws);
    await opened(ws);

    appendFileSync(fileA, userLine('u9', 'after resume'));
    const first = await nextIgnoringAsk(next, 6000);
    expect(first.type).toBe('events');
    expect(first.events.map((e: { uuid: string }) => e.uuid)).toEqual(['u9']);
    ws.close();
  });
```

The test file needs these added to its imports (reconcile against what is already there):

```ts
import { SessionStream, foreignConfigDirs, nextDialogFrame, shouldRepoint, type DialogSeen } from '../src/sessionws.js';
import type { TranscriptResolution, TranscriptRung } from '../src/transcript/resolve.js';
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && ./node_modules/.bin/vitest run test/sessionws.test.ts` (`timeout: 600000`)
Expected: FAIL — the file fails at import with
`SyntaxError: The requested module '../src/sessionws.js' does not provide an export named 'shouldRepoint'`, so zero tests run. Confirm that exact text before implementing.

- [ ] **Step 3: Widen the `backlog` frame**

In `shared/api.ts`, replace the `backlog` arm of `SessionStreamMsg` (`:1524`):

```ts
  /** `missing: true` → no transcript file at `file`; the UI shows a diagnostic
   *  banner. D4 (§5.2) adds the two facts that banner cannot be honest without,
   *  both OPTIONAL so an older PWA build ignores them and an older server that
   *  never sends them is not a protocol violation:
   *    - `foreignAccount`: the account a rung-6 answer was found under — the
   *      "stranded history, held by `claude`" banner. Null for every
   *      own-account answer, which is all of them until a pre-fix swap's
   *      residue is the only copy left.
   *    - `searchComplete`: false when a `readdir` answered null, so rungs 5/6
   *      never ran. `missing: true` with `searchComplete: false` is "can't read
   *      the fleet host right now" — NEVER "no messages yet". Remote `readdir`
   *      returns null for a missing directory, a forbidden path and a
   *      disconnected agent alike, and this build refuses to render that
   *      ambiguity as a confident empty chat. */
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean;
      foreignAccount?: string | null; searchComplete?: boolean }
```

- [ ] **Step 4: Move `SessionStream` onto the resolver**

In `server/src/sessionws.ts`. Imports first:

```ts
import { configDirFor, type CcrcConfig } from './config.js';
import {
  rungRank, TranscriptResolver, type TranscriptResolution,
} from './transcript/resolve.js';
```
(the `resolveTranscriptFile` import at `:6` goes away entirely).

`Resolved` (`:18-24`) gains the outcome beside the path it already carried:

```ts
interface Resolved {
  uuid: string;
  file: string;
  /** The outcome `file` came off. §5.3's re-point rule compares RUNGS, not
   *  paths, and the backlog frame reports the account and the completeness —
   *  none of which a bare string can carry. */
  resolution: TranscriptResolution;
  cfgDir: string;
  status: SessionStatus;
  statusUpdatedAt: number | null;
}
```

Two new fields and a constructor body on the class (`:52-127`). The assignment is in the body and reads the *parameter* `deps`, not `this.deps` — the same shape `FleetWatcher`'s constructor already uses (`watch.ts:410-412`), and the reason is class-field initialization order:

```ts
  /** One memo per stream (§5.4): steady state is ONE stat per tick for this
   *  session, and a session with nothing at any exact address pays for a full
   *  search on a back-off rather than every two seconds. */
  private readonly transcripts: TranscriptResolver;
  /** The outcome the open tailer was built from — the left-hand side of
   *  §5.3's re-point comparison. Null until the first tailer exists. */
  private tailed: TranscriptResolution | null = null;
```
and, replacing the empty-bodied constructor at `:121-127`:

```ts
  constructor(
    private readonly deps: Deps,
    private readonly bus: Bus,
    private readonly id: string,
    private readonly send: (m: SessionStreamMsg) => void,
    /** `file` is the transcript the client's `offset` was taken in (§5.3).
     *  OPTIONAL: a client from before this build names no file, and gets
     *  today's uuid-only resume — no worse than today, and Task 12 closes it. */
    private readonly since?: { uuid: string; offset: number; file?: string | null },
  ) {
    this.transcripts = new TranscriptResolver(deps.io);
  }
```

In `resolve()`, replace the return at `:406-409`:

```ts
    const resolution = await this.transcripts.resolve({
      configDir: cfgDir,
      dir: cwd,
      registryWorkdir: identity.workdir,
      uuid: identity.uuid,
      // Only this caller asks for rung 6: it is the one surface that can show
      // the operator a banner naming whose history it is rendering (§5.2).
      foreign: foreignConfigDirs(this.deps.cfg, identity.wrapper),
    });
    return {
      ok: true,
      data: { uuid: identity.uuid, file: resolution.path, resolution, cfgDir, status, statusUpdatedAt },
    };
```

`start()` (`:137-139`) — the resume gate learns the file, and the tailed outcome is recorded on both branches:

```ts
      this.tailed = r.data.resolution;
      const echoed = this.since?.file ?? null;
      if (this.since && this.since.uuid === r.data.uuid && (echoed === null || echoed === r.data.file)) {
        // Resume — no backlog. A null echo is an older client (§5.3's honest
        // compatibility window); a MATCHING echo proves the offset belongs to
        // the file about to be tailed.
        this.startTailer(r.data.file, r.data.uuid, this.since.offset);
      } else {
        await this.sendBacklogAndTail(r.data);
      }
```

`sendBacklogAndTail` (`:417-423`) records the outcome and reports it:

```ts
  private async sendBacklogAndTail(r: Resolved): Promise<void> {
    const missing = (await this.deps.io.stat(r.file)) === null;
    const { events, offset } = await readBacklog(this.deps.io, r.file, BACKLOG_N);
    if (this.stopped) return;
    this.tailed = r.resolution;
    this.send({
      type: 'backlog', uuid: r.uuid, events, offset, file: r.file, missing,
      foreignAccount: r.resolution.kind === 'found' ? r.resolution.account : null,
      searchComplete: r.resolution.kind === 'fallback' ? r.resolution.complete : true,
    });
    this.startTailer(r.file, r.uuid, offset);
  }
```

`tick()` (`:473-478`) gains the re-point arm:

```ts
      if (data.uuid !== this.uuid) {
        const appeared = this.uuid === null; // record was unknown/unmeasurable at start
        this.uuid = data.uuid;
        if (!appeared) this.send({ type: 'rotated', uuid: data.uuid });
        await this.sendBacklogAndTail(data);
      } else if (await this.repointNeeded(data.resolution)) {
        // §5.3: the uuid did not move but the ANSWER did — a swap landed, or
        // the file this stream was tailing is gone. The client is told with the
        // frame it already understands.
        this.send({ type: 'rotated', uuid: data.uuid });
        await this.sendBacklogAndTail(data);
      }
      if (this.stopped) return;
```

and the private method, next to `claimAskRead`:

```ts
  /** §5.3's rule, with the one io-bound fact measured here. The stat is spent
   *  ONLY when the answer actually differs — a same-rung, same-path answer is
   *  every tick of every healthy session and must cost nothing extra. */
  private async repointNeeded(next: TranscriptResolution): Promise<boolean> {
    const cur = this.tailed;
    if (cur === null) return false;
    if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;
    if (rungRank(next) < rungRank(cur)) return true;
    return (await this.deps.io.stat(cur.path)) === null;
  }
```

- [ ] **Step 5: The two pure helpers and the `since` parser**

At module scope in `server/src/sessionws.ts`, beside `nextDialogFrame` and `parseSince`:

```ts
/**
 * §5.3's re-point decision, pure: re-point when the answer CHANGED and either
 * the new rung is strictly better or the file being tailed is gone.
 *
 * "Better" is §5.1's rung order, which is why the rung travels in the union
 * rather than being recomputed here. A same-rung, same-path answer changes
 * nothing — the common case every tick — and a worse rung never drags a healthy
 * stream off an exact-address transcript that still exists.
 */
export function shouldRepoint(
  cur: TranscriptResolution, next: TranscriptResolution, tailedExists: boolean,
): boolean {
  if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;
  if (rungRank(next) < rungRank(cur)) return true;
  return !tailedExists;
}

/**
 * Every OTHER account's config dir, in roster declaration order — rung 6's
 * input and its tiebreak (§5.1).
 *
 * Read off `cfg.wrappers`, which `loadConfig` DERIVES from `ACCOUNTS` (see its
 * own comment on why: a hand-typed copy is how `claude-dev0` was missing for
 * the account's entire life — and `~/.claude-dev0` is precisely where the
 * incident's recovered transcript sits today). Never a literal list of account
 * names in this module: architecture rule (a), config is data.
 *
 * ONLY the session stream builds one. `watch.ts`'s name sweep and
 * `commands.ts` pass no `foreign` at all, because a derived name is written
 * into the row with no banner attached to it (§5.2).
 */
export function foreignConfigDirs(
  cfg: CcrcConfig, own: string,
): { account: string; configDir: string }[] {
  return Object.entries(cfg.wrappers)
    .filter(([wrapper]) => wrapper !== own)
    .map(([account, configDir]) => ({ account, configDir }));
}
```

And `parseSince` (`:540-549`) learns the file:

```ts
/** Parse `since=<uuid>:<offset>` plus its companion `sinceFile=<path>`;
 *  malformed `since` → undefined. The file rides its OWN parameter rather than
 *  a third colon-delimited field: a path may contain a colon, and the offset is
 *  parsed off the LAST one. An absent file is `null`, meaning "this client did
 *  not name one" — honored as today's uuid-only resume, never as a mismatch. */
export function parseSince(
  raw: string | undefined, rawFile?: string | undefined,
): { uuid: string; offset: number; file: string | null } | undefined {
  if (!raw) return undefined;
  const i = raw.lastIndexOf(':');
  if (i <= 0) return undefined;
  const uuid = raw.slice(0, i);
  const offset = Number(raw.slice(i + 1));
  if (!Number.isFinite(offset) || offset < 0) return undefined;
  return { uuid, offset, file: rawFile && rawFile !== '' ? rawFile : null };
}
```

In `server/src/server.ts:355`:

```ts
    const q = req.query as { since?: string; sinceFile?: string };
    const since = parseSince(q.since, q.sinceFile);
```

- [ ] **Step 6: Move the name sweep and the slash-command listing, and delete the wrapper**

In `server/src/watch.ts`, drop the `resolveTranscriptFile` import (`:20`) for `import { TranscriptResolver } from './transcript/resolve.js';`, add the field beside the other lane state (`:255`):

```ts
  /** The sixth lane's transcript memo (§5.4) — ONE per watcher, shared across
   *  rows, keyed per `(configDir, uuid, dir)`. This lane resolves per eligible
   *  row on a 10 s clock; without the memo, every row with no transcript at its
   *  exact address would run a full uuid search on every sweep, forever. */
  private readonly transcripts: TranscriptResolver;
```
initialized in the constructor body (`:410-412`), from the parameter, beside `this.cachePath`:

```ts
    this.transcripts = new TranscriptResolver(deps.io);
```
and `:1238` becomes:

```ts
      // NO `foreign`: a derived branch name is written into the row with no
      // banner attached to it, and a name taken from another account's frozen
      // copy is exactly the quiet wrongness this spec removes (§5.2). Rungs 1-5
      // are unconditional — a title should follow a transcript that moved
      // inside its own account.
      const file = (await this.transcripts.resolve({
        configDir: cfgDir, dir: identity.workdir, registryWorkdir: identity.workdir, uuid: identity.uuid,
      })).path;
      // `claimTitleRead` already refuses a null stat, so a `fallback` path costs
      // one stat and reads nothing — no extra branch needed here.
      if (!this.claimTitleRead(r.id, file, await this.deps.io.stat(file))) continue;
```

In `server/src/commands.ts`, swap the import at `:4` for `import { resolveTranscript } from './transcript/resolve.js';` and rewrite `:65`:

```ts
    // One-shot per HTTP request, so the bare ladder rather than a memo — and no
    // `foreign` for the same reason the name sweep passes none (§5.2). The
    // registry workdir is passed alongside the live cwd, which is what gains
    // this route rungs 3-5: a live session whose cwd moved into a worktree used
    // to list no skills at all.
    const res = await resolveTranscript(deps.io, {
      configDir: cfgDir, dir: cwd, registryWorkdir: rec.workdir, uuid: rec.uuid,
    });
    const jsonl = await deps.io.readFile(res.path);
```

Then delete the transitional `resolveTranscriptFile` wrapper from `server/src/transcript/resolve.ts` entirely (Task 10, Step 6), and move `transcript-parse.test.ts`'s `describe('resolveTranscriptFile', …)` block onto the union — keep its docstring, which records the production incident, and change its title and its five assertions:

```ts
describe('resolveTranscript — the symlink-munge mismatch it was born fixing', () => {
  // …`build()` and `plant()` unchanged…
  /** The pre-ladder call shape: one directory doubling as the registry workdir,
   *  no foreign accounts — so these five cases still say exactly what they said
   *  before the ladder existed. */
  const at = (cfg: string, dir: string, uuid: string): Promise<TranscriptResolution> =>
    resolveTranscript(localIO, { configDir: cfg, dir, registryWorkdir: dir, uuid });

  it('finds the transcript behind a symlinked workdir — the munge Claude actually wrote', async () => {
    const { root, cfg, linkDir, realDir } = build();
    try {
      const real = transcriptPath(cfg, realDir, 'u-1');
      plant(real);
      expect(await at(cfg, linkDir, 'u-1')).toEqual(
        { kind: 'found', path: real, rung: 'live-resolved', account: null });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('prefers the raw munge whenever the transcript actually lives there', async () => {
    const { root, cfg, linkDir } = build();
    try {
      const raw = transcriptPath(cfg, linkDir, 'u-1');
      plant(raw);
      expect((await at(cfg, linkDir, 'u-1')).path).toBe(raw);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('resolves through the longest existing prefix when the leaf directory is gone', async () => {
    const { root, cfg } = build();
    try {
      const real = transcriptPath(cfg, path.join(root, 'volume', 'projects', 'gone'), 'u-1');
      plant(real);
      expect((await at(cfg, path.join(root, 'data', 'projects', 'gone'), 'u-1')).path).toBe(real);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('leaves a workdir with no symlink anywhere in it exactly alone', async () => {
    const raw = transcriptPath('/h/.claude', '/nonexistent-ccrc/projects/x', 'u-1');
    expect(await at('/h/.claude', '/nonexistent-ccrc/projects/x', 'u-1')).toEqual(
      { kind: 'fallback', path: raw, complete: false });
  });

  it('keeps the raw path when neither candidate exists — no behavior change for a truly missing transcript', async () => {
    const { root, cfg, linkDir } = build();
    try {
      expect((await at(cfg, linkDir, 'u-1')).path).toBe(transcriptPath(cfg, linkDir, 'u-1'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
```
with the file's import at `:7` becoming
`import { resolveTranscript, transcriptPath, type TranscriptResolution } from '../src/transcript/resolve.js';`.

- [ ] **Step 7: Run the gates**

Run: `cd server && ./node_modules/.bin/vitest run test/sessionws.test.ts test/transcript-parse.test.ts test/transcript-ladder.test.ts test/name-sweep.test.ts test/commands.test.ts test/fleetws.test.ts` (`timeout: 600000`)
Expected: PASS — including the pre-existing `reconnect with ?since=<uuid>:<offset>` case at `:577` (a client naming no file still resumes with no backlog), the rotation case, and the dead-session-behind-a-symlink case, all unedited.

Run: `cd server && ./node_modules/.bin/tsc --noEmit && cd ../pwa && ./node_modules/.bin/tsc --noEmit` (`timeout: 600000`)
Expected: PASS both — the two `backlog` fields are optional, so no PWA code has to change here; Task 12 is what starts reading them.

Run: `cd server && ./node_modules/.bin/vitest run` (`timeout: 600000`)
Expected: PASS, the whole server suite. Report the real printed counts.

- [ ] **Step 8: Commit**

```bash
git add server/src/sessionws.ts server/src/server.ts server/src/watch.ts server/src/commands.ts \
        server/src/transcript/resolve.ts shared/api.ts \
        server/test/sessionws.test.ts server/test/transcript-parse.test.ts
git commit -m "fix(server): an open stream follows the transcript when the answer changes, and a resume names the file it left off in"
```

---

### Task 12: the row says which kind of dead it is, and stranded history says whose it is

The PWA half of D3 and D4 — spec §4.4 ("Where it surfaces, and what revives what") and §5.2 ("The answer becomes a typed outcome, not a bare path"). Three surfaces, one rule each. The fleet row states *which kind* of dead it is without moving buckets, which is M10's hard constraint: `asFleetMsg` casts the live frame instead of reviving it, so an unknown `SessionBucket` reaches `RANK[bucket]` (NaN comparator), `WORD[bucket]` (renders `undefined`) and `DOT[status].cls` (**throws**) — the lifecycle vocabulary is therefore a qualifier cell on the row, never a new bucket and never a new sorting class. The orphan row's control names the verb that revives it (`ccd start <id>`) while posting to the `POST /api/sessions/:id/ensure` route that already exists, because §3.1 made `ensure` restore supervision. And a chat whose transcript was found somewhere else says so, instead of the incident's own failure mode: 70MB of intact history rendering as "No messages yet".

This task kills the last surface of the 2026-08-11 incident — the one the operator actually looked at.

**Files:**
- Create: `pwa/src/fleet/lifecycleWords.ts` (the lifecycle → row-qualifier table, and the only place that vocabulary is spelled)
- Create: `pwa/test/session-lifecycle.test.tsx` (row qualifier, revive control, stranded/incomplete banners)
- Modify: `pwa/src/fleet/SessionLine.tsx` (two new `.sess-meta` cells, inserted after the `session.held` block at ~:248-252)
- Modify: `pwa/src/fleet/fleet.css` (the `.sess-held` rule at :1080 gains two selectors — no new declarations, no new contrast pair)
- Modify: `pwa/src/fleet/SessionActionsSheet.tsx` (an orphan note beside the existing `Restart session` button at :230, whose `restart()` at :115-129 already posts `/ensure`)
- Modify: `pwa/src/stores/session.ts` (two new state fields off the `backlog` frame — `SessionState` ~:70, `SessionSnapshot` ~:87, the reducer's `backlog` arm ~:136, `snapshotOf` ~:202, initial state ~:363)
- Modify: `pwa/src/screens/SessionScreen.tsx` (selectors ~:58, the `empty` derivation ~:129, the banner stack ~:210-217)
- Modify: `shared/api.ts` (the `backlog` frame at :1524 — **only if the server task did not already add these two fields**; see Step 6)
- Modify: 19 PWA test fixtures + `pwa/test/stores.test.ts`'s `emptySnap()` (Step 8)
- Test: `pwa/test/session-lifecycle.test.tsx`

**Interfaces:**
- Consumes: `SessionLifecycle`, `StopSurface`, and `FleetSession.lifecycle` / `FleetSession.stoppedBy` / `FleetSession.swapBlocked` from the shared task; the `backlog` frame's `account` and `complete` fields from the session-stream task; `api.ensure(id)` → `POST /api/sessions/:id/ensure` (`pwa/src/lib/api.ts:196`, unchanged); `accountLabel` (`pwa/src/lib/accounts.ts:17`); `RANK` / `BUCKET_ORDER` / `sortFleet` (`pwa/src/fleet/sortFleet.ts`), all three **unchanged by this task**.
- Produces: `lifecycleQualifier(session, now?)` exported from `pwa/src/fleet/lifecycleWords.ts`; the `.sess-lifecycle` and `.sess-swapblocked` row cells; `SessionState.strandedAccount` and `SessionState.searchComplete`. Task 13's sweep table names every one of these tests by title.

- [ ] **Step 1: Write the failing test(s)**

Create `pwa/test/session-lifecycle.test.tsx`:

```tsx
// Task 12 — the PWA half of D3 and D4 (spec §4.4, §5.2). Three surfaces:
// the fleet row says WHICH KIND of dead it is without moving buckets (M10),
// the orphan row's control names the verb that revives it, and a chat whose
// transcript came from somewhere else says so instead of claiming there is
// nothing to show. The last one is the incident's own surface: 70MB of
// intact history rendered as "No messages yet" on 2026-08-11.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ChatEvent, FleetSession, SessionLifecycle, SessionStreamMsg } from '../../shared/api';
import { BUCKET_ORDER, RANK, sortFleet } from '../src/fleet/sortFleet';
import { lifecycleQualifier } from '../src/fleet/lifecycleWords';
import { SessionLine } from '../src/fleet/SessionLine';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createSessionStore, type SessionStore } from '../src/stores/session';

// SessionScreen renders ChatList, and Virtuoso needs a real viewport jsdom
// does not have — the same stand-in chat.test.tsx installs, for the reason
// its own comment gives.
vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: {
      totalCount: number;
      itemContent: (i: number) => ReactNode;
      computeItemKey?: (i: number) => string | number;
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: props.computeItemKey?.(i) ?? i }, props.itemContent(i)),
        ),
      ),
  };
});

// vitest runs without globals, so RTL's auto-cleanup never registers itself.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// — fixtures —

const MIN = 60_000;
const TS = '2026-08-11T21:32:00.000Z';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, ...over,
});

const line = (session: FleetSession): void => {
  render(<SessionLine session={session} onOpen={() => {}} onActions={() => {}} />);
};

const makeStore = (id = 'claude:OpenClawHetzner'): SessionStore =>
  createSessionStore(id, {
    makeSocket: () =>
      ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
    api: { prompt: vi.fn().mockResolvedValue(undefined) },
  });

type Backlog = Extract<SessionStreamMsg, { type: 'backlog' }>;

/** Drives the REAL wire→reducer→store→screen path rather than setState-ing
 *  the answer in, so a reducer that drops the new fields fails here. */
const applyBacklog = (store: SessionStore, msg: Backlog): void => {
  act(() => {
    store.getState().apply(msg);
  });
};

const someEvent: ChatEvent = { kind: 'user', uuid: 'e1', ts: TS, text: 'the history that was never lost' };

// — the qualifier itself —

describe('lifecycleQualifier', () => {
  // Kills a mutant that reads Date.now() inside the function: the row's
  // "2d ago" would then be untestable and the pure table would not be pure.
  it('reads the stop stamp against the clock it is handed, not a hidden Date.now()', () => {
    const now = 1_800_000_000_000;
    expect(lifecycleQualifier({ lifecycle: 'stopped', stoppedBy: { at: now - 90 * MIN, surface: 'agent' } }, now))
      .toBe('stopped by agent, 1h ago');
  });

  // Kills `stoppedBy!.surface` — a stop whose stamp was half-read still has a
  // word, and the row must not throw to say it.
  it('a stop with no stamp still says stopped', () => {
    expect(lifecycleQualifier({ lifecycle: 'stopped', stoppedBy: null }, 0)).toBe('stopped');
  });
});

// — the row —

describe('the row says which kind of dead it is', () => {
  // Kills a mutant that prints the raw epoch, or drops the surface: this is
  // the 21:39:53 agent-surface stop, finally legible on the row it killed.
  it('a stopped row names the surface and how long ago', () => {
    const at = Date.now() - 2 * 24 * 60 * MIN;
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'stopped', stoppedBy: { at, surface: 'pwa' } }));
    expect(screen.getByText('stopped by pwa, 2d ago')).toBeInTheDocument();
  });

  // Kills a mutant that renders 'stopped' for orphan too — the whole point of
  // the field is that these are different facts with different remedies.
  it('an orphan row says nothing is watching it', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' }));
    expect(screen.getByText('orphan — nothing is watching it')).toBeInTheDocument();
  });

  // Kills `dead && qualifier !== null` — 'running unsupervised' describes a
  // LIVE pane with no supervisor (what a pre-fix `ccd start` minted), and a
  // dead-only gate would make the one state D2 exists for invisible.
  it('a LIVE unsupervised row says so — the qualifier is not gated on dead', () => {
    line(s({ status: 'idle', bucket: 'idle', lifecycle: 'unsupervised' }));
    expect(screen.getByText('running unsupervised')).toBeInTheDocument();
  });

  // Kills a table that gives `running` a word: a healthy row has nothing to
  // qualify, and a chip on every row is a chip nobody reads.
  it('a healthy running row says nothing', () => {
    line(s({ lifecycle: 'running' }));
    expect(screen.queryByText(/unsupervised|nothing is watching|stopped by/)).not.toBeInTheDocument();
  });

  // Spec §4.3's hard rule, on the render surface: an unreadable registry must
  // never print `orphan`. Kills a mutant folding unmeasurable into orphan.
  it('an unmeasurable lifecycle says the field is unreadable — never orphan', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'unmeasurable' }));
    expect(screen.getByText('lifecycle unreadable')).toBeInTheDocument();
    expect(screen.queryByText(/orphan/)).not.toBeInTheDocument();
  });

  // M10's own hazard pointed the other way: a NEWER server minting a token
  // this build has never heard of. Kills `QUALIFIER[lc]!` and any throwing
  // default — same lesson runWords.ts's `runState` records.
  it('a lifecycle this build has never heard of renders no qualifier and does not throw', () => {
    line(s({ status: 'dead', bucket: 'dead', lifecycle: 'quantum' as SessionLifecycle }));
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  // The live `fleet` frame is CAST, not revived (`stores/fleet.ts`'s
  // asFleetMsg), so a row from a server that predates this field genuinely
  // lacks the keys at runtime even though the type says otherwise — exactly
  // the TypeError `unmeasuredFields`' docstring records. Kills a direct
  // `session.stoppedBy.surface` read and a dropped `?? null`.
  it('a row from a server that predates the field renders no qualifier', () => {
    const older = s({ status: 'dead', bucket: 'dead' }) as Record<string, unknown>;
    delete older['lifecycle'];
    delete older['stoppedBy'];
    delete older['swapBlocked'];
    line(older as unknown as FleetSession);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  // M10, stated as a pin. Kills adding `orphan` (or any lifecycle word) to
  // RANK, and kills a WORD table that switches on lifecycle.
  it('the qualifier changes NO bucket: dead+orphan sorts and reads exactly like dead', () => {
    expect(Object.keys(RANK).sort()).toEqual(
      ['archived', 'attention', 'cleanup', 'dead', 'done', 'idle', 'working']);
    expect(BUCKET_ORDER).toHaveLength(7);
    expect(BUCKET_ORDER.at(-1)).toBe('dead');

    const orphan = s({ id: 'a', status: 'dead', bucket: 'dead', lifecycle: 'orphan', statusUpdatedAt: 2 });
    const plain = s({ id: 'b', status: 'dead', bucket: 'dead', lifecycle: null, statusUpdatedAt: 1 });
    const live = s({ id: 'c', status: 'idle', bucket: 'idle', statusUpdatedAt: 3 });
    expect(sortFleet([orphan, plain, live]).map((x) => x.id)).toEqual(['c', 'a', 'b']);

    line(orphan);
    expect(screen.getByText('exited')).toBeInTheDocument();
  });

  // §2.4: the refusal's DURABLE channel is a registry field, not the notice
  // (M9 — a notice raised with no socket open is gone). Kills rendering it as
  // a toast, and kills a cell that clears itself on the next fleet tick.
  it('a blocked swap states its reason on the row, and keeps stating it', () => {
    const reason = 'no transcript found for uuid b7001948';
    const blocked = s({ swapBlocked: { at: Date.now() - 5 * MIN, reason } });
    const { rerender } = render(<SessionLine session={blocked} onOpen={() => {}} onActions={() => {}} />);
    expect(document.querySelector('.sess-swapblocked')?.getAttribute('title')).toBe(reason);
    expect(screen.getByText(`swap blocked — ${reason}`)).toBeInTheDocument();
    rerender(<SessionLine session={blocked} onOpen={() => {}} onActions={() => {}} />);
    expect(screen.getByText(`swap blocked — ${reason}`)).toBeInTheDocument();
  });

  it('says nothing about swaps when none was refused', () => {
    line(s());
    expect(document.querySelector('.sess-swapblocked')).toBeNull();
  });
});

// — the revive control —

describe("the orphan row's control names what revives it", () => {
  // §4.4: no new argv, no new grant, no new caps line — the button that
  // already exists becomes the revive button because §3.1 made `ensure`
  // restore supervision. Kills a mutant that mints a new route or a new verb.
  it('names ccd start <id> and posts to the existing ensure route', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SessionActionsSheet session={s({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/ccd start demo-quiet-mesa/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Restart session'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/sessions/demo-quiet-mesa/ensure');
  });

  // Kills a note rendered unconditionally: a healthy session is not orphaned
  // and telling its operator "nothing is watching this" would be a lie.
  it('a session nobody orphaned gets no revive note', () => {
    render(<SessionActionsSheet session={s({ lifecycle: 'running' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/ccd start/)).not.toBeInTheDocument();
  });
});

// — the chat —

describe('a chat that had to look elsewhere says so', () => {
  // Rung 6 (§5.1): the file is real and it renders, but never silently —
  // M2 measured 17 of 23 rows carrying residue under 1-4 OTHER accounts.
  // Kills a resolver answer whose `account` is dropped on the way to the UI.
  it('a transcript found under ANOTHER account is bannered by name', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'b7001948', offset: 120, missing: false,
      file: '/home/rc/.claude/projects/-data-projects-x/b7001948.jsonl',
      account: 'claude', complete: true, events: [someEvent],
    });
    expect(screen.getByText(/Stranded history — read from team·max/)).toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });

  it('a transcript found on this session own account raises no banner', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 10, missing: false,
      file: '/home/rc/.claude/projects/x/u1.jsonl',
      account: null, complete: true, events: [someEvent],
    });
    expect(screen.queryByText(/Stranded history/)).not.toBeInTheDocument();
  });

  // §5.2's whole point, and rule (b): an UNMEASURED absence is not a measured
  // one. Kills one sentence serving both failures.
  it("an unfinished search says the fleet host is unreadable — a DIFFERENT sentence from 'no messages'", () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', complete: false, events: [],
    });
    expect(screen.getByText("Can't read the fleet host right now")).toBeInTheDocument();
    expect(screen.queryByText("Can't find this session's transcript")).not.toBeInTheDocument();
    expect(screen.queryByText('No messages yet')).not.toBeInTheDocument();
  });

  // The other half of the same pair. Kills a mutant that always prints the
  // host-unreadable sentence, and one that always suppresses the empty state.
  it('a COMPLETE search that found nothing keeps today sentence and today empty state', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', complete: true, events: [],
    });
    expect(screen.getByText("Can't find this session's transcript")).toBeInTheDocument();
    expect(screen.queryByText("Can't read the fleet host right now")).not.toBeInTheDocument();
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  // Kills `complete: msg.complete ?? false`, which would make every session on
  // every pre-field server report the fleet host unreadable.
  it('an older server that sends neither field is a COMPLETE search', () => {
    const store = makeStore();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} />);
    applyBacklog(store, {
      type: 'backlog', uuid: 'u1', offset: 0, missing: true,
      file: '/home/rc/.claude/projects/x/u1.jsonl', events: [],
    } as Backlog);
    expect(screen.getByText("Can't find this session's transcript")).toBeInTheDocument();
    expect(screen.queryByText("Can't read the fleet host right now")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd pwa && ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx` (`timeout: 600000`)
Expected: FAIL — `Failed to resolve import "../src/fleet/lifecycleWords"`. Confirm that exact text before proceeding; a different first failure means the shared task's field names differ from the contract and this file must be reconciled to them, not the other way round.

- [ ] **Step 3: The lifecycle vocabulary gets exactly one table**

Create `pwa/src/fleet/lifecycleWords.ts`:

```ts
// The ROW's lifecycle qualifier — the sentence a dead (or unsupervised) row
// adds beside its state word. Its own small table, deliberately NOT
// SessionLine's `WORD` and deliberately not a `SessionBucket` member: M10
// measured what a new bucket token does to an already-deployed PWA (the live
// fleet frame is cast, not revived, so an unknown bucket reaches RANK as NaN,
// WORD as `undefined`, and `DOT[status].cls` as a THROW). A qualifier is
// additive by construction — an older build that has never heard of it
// renders one cell fewer and nothing else changes.
//
// Same shape as runWords.ts's RUN_WORD/`runState` pair, for the same reason:
// the table is total over the union, and the door into it tolerates a token
// this build was never compiled to know.
import type { FleetSession, SessionLifecycle } from '../../../shared/api';

/** Every lifecycle except `stopped`, which needs the stamp to say anything
 *  useful and is handled in the function below. `running` maps to `null` on
 *  purpose: a healthy row has nothing to qualify, and a chip on every row is
 *  a chip nobody reads. */
const QUALIFIER: Record<Exclude<SessionLifecycle, 'stopped'>, string | null> = {
  running: null,
  unsupervised: 'running unsupervised',
  restarting: 'restarting',
  orphan: 'orphan — nothing is watching it',
  'never-started': 'never started',
  /** Spec §4.3: an unreadable registry must NEVER print `orphan`. The two
   *  states have opposite remedies — one says "nothing is bringing this
   *  back", the other says "we could not look". */
  unmeasurable: 'lifecycle unreadable',
};

/** '<1m' | '5m' | '3h' | '2d'. Same shape as SessionLine's `subagentElapsed`
 *  and PrKeycap's `rel()` — reimplemented locally for the reason both of
 *  those already record: there is no shared time-formatting module to import
 *  from yet. Unlike `rel()` this never returns null; a stop always has an
 *  age, even a fresh one. */
function elapsed(at: number, now: number): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/**
 * The row's qualifier, or null when there is nothing to add.
 *
 * Both fields are read through `?? null` rather than directly, and that is
 * not defensive noise: `pwa/src/stores/fleet.ts`'s `asFleetMsg` validates
 * only `Array.isArray(sessions)` and casts, so a row from a server that
 * predates these fields lacks the keys at RUNTIME even though `FleetSession`
 * types them as present. `unmeasuredFields`' own docstring in shared/api.ts
 * records what that cost the last time (a TypeError that took the renderer
 * down, not one cell). The parameter type is structural for the same reason.
 *
 * `now` is a parameter, not a `Date.now()` call inside: the ladder-shaped
 * decisions in this repo stay clock-free so their tests can be too.
 */
export function lifecycleQualifier(
  session: { lifecycle?: FleetSession['lifecycle']; stoppedBy?: FleetSession['stoppedBy'] },
  now: number = Date.now(),
): string | null {
  const lifecycle = session.lifecycle ?? null;
  if (lifecycle === null) return null;
  if (lifecycle === 'stopped') {
    const by = session.stoppedBy ?? null;
    // The surface is a DECLARATION, not an authentication (§4.1) — rendered
    // verbatim, the same rule `.sess-held` follows for the hold reason.
    return by === null ? 'stopped' : `stopped by ${by.surface}, ${elapsed(by.at, now)} ago`;
  }
  return QUALIFIER[lifecycle] ?? null;
}
```

- [ ] **Step 4: The row carries the two new cells**

In `pwa/src/fleet/SessionLine.tsx`, extend the imports (the existing `sessionLabel` import at ~:26 is the anchor):

```tsx
import { lifecycleQualifier } from './lifecycleWords';
```

Below `const label = sessionLabel(session);` (~:92), add:

```tsx
  // The row's lifecycle qualifier (§4.4) and the swap refusal's durable
  // marker (§2.4). Neither touches `state` above: the bucket ladder is
  // untouched, a dead row stays `exited`, and these are cells beside it.
  const qualifier = lifecycleQualifier(session);
  const swapBlocked = session.swapBlocked ?? null;
  const swapNote = swapBlocked === null ? null : `swap blocked — ${swapBlocked.reason}`;
```

Inside `<span className="sess-meta">`, immediately after the `session.held !== null && (…)` block (which ends at ~:252, before the `cleanupFacts.map` block), insert:

```tsx
          {/* WHICH KIND of dead, as a cell rather than a bucket (spec §4.4,
              M10). Same quiet register as .sess-held next door — no new ink,
              no new banner: the row already says the session is not running,
              and this says why and what would fix it. Not gated on `dead`:
              `running unsupervised` describes a LIVE pane with no supervisor,
              which is precisely the state D2 exists to make visible. */}
          {qualifier !== null && (
            <span
              className="sess-lifecycle"
              data-lifecycle={session.lifecycle ?? undefined}
              title={qualifier}
            >
              {qualifier}
            </span>
          )}

          {/* The swap this session refused, still refused (§2.4). M9 is why
              this is a registry-sourced ROW cell and not a notice: a notice
              raised at 21:32 with no socket open is gone, and the operator
              who was not watching is exactly the one who needs to know. THE
              REASON STRING IS THE DISPLAY — rendered verbatim, never parsed,
              `title` carrying the full text past the cell's own ellipsis,
              same contract as .sess-held. */}
          {swapNote !== null && swapBlocked !== null && (
            <span className="sess-swapblocked" data-swapblocked="true" title={swapBlocked.reason}>
              {swapNote}
            </span>
          )}
```

In `pwa/src/fleet/fleet.css`, extend the existing `.sess-held` rule (:1076-1087) — **the selector list only; not one declaration changes**:

```css
/* The program's claim, as its own meta cell — reuses .sess-ask's
   ink-tertiary token (below), so it needs no new contrast pair. Truncates
   like .sess-acct next door; the reason can run long ("program:x wave:2/4")
   and the row has no room to wrap it.

   .sess-lifecycle and .sess-swapblocked JOIN this selector rather than
   minting rules of their own. They are the same kind of cell — a long,
   truncating, ink-tertiary note whose full text lives in `title` — and a
   separate rule would be a new colour pair for design/contrast-check.mjs to
   price for no gain. If either ever needs its own ink it needs its own
   audited pair first: do not fork the declarations and keep the token. */
.sess-held,
.sess-lifecycle,
.sess-swapblocked {
  font-family: var(--font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ink-tertiary);
}
```

(Shape-authoritative: reconcile the declaration block against whatever `.sess-held` actually holds in the live tree — copy it, do not retype it from here.)

- [ ] **Step 5: The orphan row's control names the verb**

In `pwa/src/fleet/SessionActionsSheet.tsx`, immediately after the `Restart session` button (the block at :230-232) insert:

```tsx
          {/* §4.4: "what would revive it" is a sentence the row can print and
              a button the operator already has. The button above posts
              POST /api/sessions/:id/ensure (`restart()`, this file) — already
              keyed by id, already whitelisted, already ungated by decision —
              and §3.1 made `ensure` restore supervision, so it needs no new
              argv, no new grant and no new caps line. The note names the
              terminal spelling too, because §3.4's operator (the one who read
              the account off the board and minted a DIFFERENT id) is exactly
              who needs the one-argument form. */}
          {session.lifecycle === 'orphan' && (
            <p className="sess-sheet-note">
              {`Nothing is watching this session — no supervisor, so no auto-swap, no auto-compact and no record when it dies. Restart session revives it: the same thing ccd start ${session.id} does at a terminal.`}
            </p>
          )}
```

- [ ] **Step 6: The resolver's answer reaches the store**

First check whether the server task already widened the frame:

```bash
grep -n "type: 'backlog'" shared/api.ts
```

If the line at `shared/api.ts:1524` does **not** already carry `account` and `complete`, widen it (and reconcile the store below to whatever spelling is actually there — the server is the writer, this side is the reader):

```ts
  /** `missing=true` → the resolver answered its `fallback` arm and no file
   *  exists at `file`. `account` is set ONLY when the winning rung was
   *  `foreign-glob` (§5.1 rung 6) — the OTHER account whose config dir holds
   *  this history. `complete=false` says the search could not be finished (a
   *  remote `readdir` answered null, §5.5) and must never be read as an
   *  absence. Both optional: an older server omits them and an omission is
   *  "own account, search complete", which is what every pre-ladder server
   *  was in fact reporting. */
  | { type: 'backlog'; uuid: string; events: ChatEvent[]; offset: number; file: string; missing: boolean;
      account?: string | null; complete?: boolean }
```

In `pwa/src/stores/session.ts`, add to `SessionState` beside `missingFile` (~:70):

```ts
  /** The OTHER account this transcript was read from — set only when the
   *  resolver answered at its foreign-glob rung (§5.1 rung 6). Null on every
   *  ordinary session, which is what "own account" looks like on the wire. */
  strandedAccount: string | null;
  /** Whether the resolver finished looking. False means a rung was SKIPPED
   *  because the fleet host could not be read — rule (b): an unmeasured
   *  absence is a different fact from a measured one, and collapsing them
   *  would reproduce this whole spec's defect one seam further out. Absent on
   *  the wire reads as `true`: every pre-ladder server did complete its
   *  (shorter) search. */
  searchComplete: boolean;
```

Extend `SessionSnapshot` (~:87) — the `& { … }` tail is where `missingFile` already lives:

```ts
> & { missingFile: string | null; strandedAccount: string | null; searchComplete: boolean };
```

In the reducer's `backlog` arm (~:136), beside the existing `missingFile` line:

```ts
        missingFile: msg.missing ? msg.file : null,
        strandedAccount: msg.account ?? null,
        searchComplete: msg.complete ?? true,
```

In `snapshotOf` (~:202), beside `missingFile: s.missingFile,`:

```ts
  strandedAccount: s.strandedAccount,
  searchComplete: s.searchComplete,
```

In the store's initial state (~:363), beside `missingFile: null,`:

```ts
      strandedAccount: null,
      searchComplete: true,
```

- [ ] **Step 7: The chat says where the history came from**

In `pwa/src/screens/SessionScreen.tsx`, extend the accounts import (~:13):

```tsx
import { accountColorVar, accountLabel } from '../lib/accounts';
```

Add two selectors beside `missingFile` (~:58):

```tsx
  const strandedAccount = useStore((s) => s.strandedAccount);
  const searchComplete = useStore((s) => s.searchComplete);
```

Change the `empty` derivation (~:129):

```tsx
  // An UNMEASURED absence is not an empty chat. When the resolver could not
  // finish looking (§5.2's `complete: false`, which §5.5 makes routine in
  // remote mode) the banner below states the real fact and this screen says
  // nothing further — "No messages yet" over a host nobody could read is
  // exactly the confident empty chat this spec exists to delete. A COMPLETE
  // search that found nothing keeps the empty state: there genuinely is no
  // transcript, and that is worth saying.
  const empty = !loading && events.length === 0 && pending.length === 0 && searchComplete;
```

Replace the `missingFile !== null && (…)` banner block (~:210-217) with the stranded banner plus the two-sentence missing banner:

```tsx
      {/* Rung 6 landed (§5.1, §5.2): the transcript being tailed lives under
          ANOTHER account's config dir — history a pre-fix swap left frozen
          where it was (M2: 17 of 23 rows carry residue like this on disk
          right now). It is real history and it renders; it is never rendered
          SILENTLY, because the operator has to know whose file this is before
          reading it as this account's conversation. */}
      {strandedAccount !== null && (
        <div className="chat-banner" data-stranded="true" role="status">
          <span className="banner-copy">
            {`Stranded history — read from ${accountLabel(strandedAccount)}, not this session's own account.`}
          </span>
        </div>
      )}

      {/* Two different facts, two different sentences. A COMPLETE search that
          found nothing keeps today's wording. An INCOMPLETE one says the host
          could not be read — never "there is no transcript", which is the
          overloaded null rule (b) forbids at a seam. */}
      {missingFile !== null && (
        <div className="chat-banner chat-banner--missing" role="status">
          <span>
            {searchComplete
              ? "Can't find this session's transcript"
              : "Can't read the fleet host right now"}
          </span>
          <span className="banner-path">{missingFile}</span>
          <button type="button" className="btn-ghost" onClick={openTerminal}>
            Open terminal
          </button>
        </div>
      )}
```

(The stranded banner deliberately carries no modifier class: `.chat-banner`'s own rule at `chat.css:327` is fully styled and already audited, so this adds zero colour pairs. `data-stranded` is the hook if it ever needs one.)

- [ ] **Step 8: Reconcile the FleetSession and SessionSnapshot fixtures**

`pwa/tsconfig.json`'s `include` is `["src", "test", "vite.config.ts", "../shared"]`, so every test fixture that builds a full `FleetSession` literal must carry the three new fields. Run the typecheck FIRST — if the shared task already did this, the whole step is a no-op:

```bash
cd pwa && ./node_modules/.bin/tsc --noEmit
```

If it reports missing properties, apply the mechanical fix. Measured on this tree: exactly 19 files contain exactly 19 occurrences of the base-fixture tail `bucketSince: null, unmeasured: []`, one per file, and no other line matches it:

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa
grep -rl 'bucketSince: null, unmeasured: \[\]' pwa/test \
  | xargs sed -i 's/bucketSince: null, unmeasured: \[\]/bucketSince: null, unmeasured: [], lifecycle: null, stoppedBy: null, swapBlocked: null/'
grep -rc 'lifecycle: null, stoppedBy: null, swapBlocked: null' pwa/test | grep -v ':0' | wc -l   # expect 20 (19 + the new file)
```

Then `pwa/test/stores.test.ts`'s `emptySnap()` (:47-58) — the one `SessionSnapshot` literal in the tree:

```ts
const emptySnap = (): SessionSnapshot => ({
  events: [],
  offset: 0,
  uuid: null,
  status: null,
  statusUpdatedAt: null,
  dialog: null,
  ask: null,
  tasks: [],
  mail: [],
  missingFile: null,
  strandedAccount: null,
  searchComplete: true,
});
```

- [ ] **Step 9: Run the gates**

Run, foreground, in order:

```bash
cd pwa && ./node_modules/.bin/vitest run test/session-lifecycle.test.tsx test/session-line.test.tsx test/session-actions-sheet.test.tsx test/chat.test.tsx test/stores.test.ts test/fleet-screen.test.tsx test/sortFleet.test.ts
```
(`timeout: 600000`) — Expected: PASS. `sortFleet.test.ts` and `fleet-screen.test.tsx` are the no-regression controls for M10: the bucket ladder and its ordering must be untouched.

```bash
node design/contrast-check.mjs && cd pwa && ./node_modules/.bin/vitest run test/contrast.test.ts test/fleet-css.test.ts
```
(`timeout: 600000`) — Expected: PASS. `fleet.css` gained two selectors and zero declarations; if the gate flags anything here, the fix is to reuse an already-audited rule, never to add a token.

```bash
cd pwa && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit
```
(`timeout: 600000`) — Expected: PASS, whole package, no type errors.

- [ ] **Step 10: Commit**

```bash
git add pwa/src/fleet/lifecycleWords.ts pwa/src/fleet/SessionLine.tsx pwa/src/fleet/fleet.css \
        pwa/src/fleet/SessionActionsSheet.tsx pwa/src/stores/session.ts \
        pwa/src/screens/SessionScreen.tsx shared/api.ts pwa/test
git commit -m "feat(pwa): a dead row says which kind of dead it is, and stranded history says whose it is"
```

---

---

### Task 13: ccd's own resolver stops recording a path it never checked

Implements spec §2.5. `_transcript_path` (ccd:300-320) munges the resolved registry workdir, prints
it, and never asks whether a file is there — the same single-guess shape D1 and D4 fix elsewhere.
Its three consumers are `_ws_archive_manifest` (ccd:2123), `cmd_ws_audit` (ccd:4032) and
`_ws_tombstone` (ccd:4704): the durable records written when a workspace is archived, audited and
reaped. The tombstone outlives the registry row it describes — its own docstring says it exists "so
a reap never has to be reconstructed from an escaped path after the registry is gone" — so a
session that moved gets a permanent record naming a directory that does not hold its transcript.

**This task belongs to the ccd half and may be executed any time after Task 1**, whose
`_transcript_matches` it consumes. It is numbered here only so the numbers assigned to Tasks 1-12
before this defect was ruled into scope stay stable.

Two existing tests pin this helper (`server/test/ccd-archive.test.ts:289-311`) and **both must keep
passing untouched** — that is the compatibility claim of this task. The first uses a workdir that
does not exist, so `_ws_realpath` returns it unchanged and no candidate file exists; the ladder
falls to its last rung and prints exactly what it prints today. The second asserts a missing field
still yields a non-zero return and empty stdout. If either needs editing, the ladder has changed
the contract and you have gone too far — stop and re-read §2.5.

**Files:**
- Modify: `ccd/ccd` (`_transcript_path`, ccd:300-320 — the body only; the signature, the return-1
  guard and the printed shape are unchanged)
- Test: `server/test/ccd-archive.test.ts` (extend the existing `describe('_transcript_path')` at
  :289 — the tests for this helper already live there, and splitting them across files would leave
  a reader of either half thinking they had seen the contract)

**Interfaces:**
- Consumes: `_transcript_matches <cfgdir> <uuid>` from Task 1 — one absolute path per line,
  `nullglob`-safe, empty output when nothing matches.
- Produces: nothing new. `_transcript_path <id>` keeps its contract exactly: one path on stdout,
  return 1 only when the registry cannot answer. What changes is *which* path.

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe('_transcript_path')` block in `server/test/ccd-archive.test.ts`.
`WS_ADD` is already imported there; `mungePath` and `path` are already in scope at the top of the
file — reconcile the imports against the tree rather than adding duplicates.

```ts
  /** Plant a transcript at an exact <cfg>/projects/<dir>/<uuid>.jsonl and return its path. */
  const plant = (cfg: string, dir: string, uuid: string, body = '{}\n'): string => {
    const p = path.join(h.home, cfg, 'projects', dir, `${uuid}.jsonl`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  };

  it('prefers the resolved munge when a file is actually there', () => {
    // Rung 1, and the only rung that ever fired before this task. Kills the
    // mutant that drops the existence check and returns rung 1 unconditionally
    // — that mutant passes every OTHER test in this block, because they are all
    // cases where rung 1 is also the right answer.
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t1 wrapper claude; _reg_set t1 workdir '${wd}'; _reg_set t1 uuid u-1`);
    const want = plant('.claude', mungePath(fs.realpathSync(wd)), 'u-1');
    expect(h.sh('_transcript_path t1')).toBe(want);
  });

  it('falls to the RAW munge when only the unresolved path has the file', () => {
    // A workdir reached through a symlink whose transcript sits under the
    // symlinked spelling. Kills "resolve, then never look at the raw form".
    const real = path.join(h.home, 'volume', 'demo');
    const link = path.join(h.home, 'projects-link');
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.join(h.home, 'volume'), link);
    const wd = path.join(link, 'demo');
    h.sh(`_reg_set t2 wrapper claude; _reg_set t2 workdir '${wd}'; _reg_set t2 uuid u-2`);
    const want = plant('.claude', mungePath(wd), 'u-2');   // the RAW spelling
    expect(h.sh('_transcript_path t2')).toBe(want);
  });

  it('finds a transcript that moved, by uuid, under its own config dir', () => {
    // The defect this task exists for: the session relocated into a worktree,
    // so neither munge of the registry workdir has anything. Kills a ladder that
    // stops after the two exact candidates.
    const wd = path.join(h.home, 'projects', 'moved');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t3 wrapper claude; _reg_set t3 workdir '${wd}'; _reg_set t3 uuid u-3`);
    const want = plant('.claude', '-somewhere-else-entirely', 'u-3');
    expect(h.sh('_transcript_path t3')).toBe(want);
  });

  it('takes the NEWEST when the uuid matches in more than one project dir', () => {
    // Kills "first glob hit wins", which is alphabetical and therefore
    // arbitrary. The spec's rule is newest mtime, the same one §5.1 uses.
    const wd = path.join(h.home, 'projects', 'multi');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t4 wrapper claude; _reg_set t4 workdir '${wd}'; _reg_set t4 uuid u-4`);
    const older = plant('.claude', '-aaa-older', 'u-4');
    const newer = plant('.claude', '-zzz-newer', 'u-4');
    fs.utimesSync(older, new Date(1_600_000_000_000), new Date(1_600_000_000_000));
    fs.utimesSync(newer, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(h.sh('_transcript_path t4')).toBe(newer);
  });

  it('never crosses into another account to answer', () => {
    // The one thing the ladder must NOT do. A session on `claude` whose only
    // copy sits under `.claude-corp` gets the canonical unchecked address, not
    // another account's file — that is D4's bannered rung, and it belongs to a
    // surface that can show the banner, not to a tombstone that cannot.
    const wd = path.join(h.home, 'projects', 'lonely');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t5 wrapper claude; _reg_set t5 workdir '${wd}'; _reg_set t5 uuid u-5`);
    plant('.claude-corp', mungePath(fs.realpathSync(wd)), 'u-5');
    expect(h.sh('_transcript_path t5')).toBe(
      path.join(h.home, '.claude', 'projects', mungePath(fs.realpathSync(wd)), 'u-5.jsonl'),
    );
  });

  it('still prints the resolved munge when nothing exists anywhere', () => {
    // Rung 4, and the reason the two pre-existing tests in this block keep
    // passing: a session that has written nothing yet records the canonical
    // address, never an empty string.
    const wd = path.join(h.home, 'projects', 'fresh');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set t6 wrapper claude; _reg_set t6 workdir '${wd}'; _reg_set t6 uuid u-6`);
    expect(h.sh('_transcript_path t6')).toBe(
      path.join(h.home, '.claude', 'projects', mungePath(fs.realpathSync(wd)), 'u-6.jsonl'),
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t "_transcript_path"` (`timeout: 600000`)

Expected: FAIL — four of the six fail. `prefers the resolved munge`, `still prints the resolved
munge` and the two pre-existing tests PASS already (rung 1 and rung 4 are today's single answer);
`falls to the RAW munge`, `finds a transcript that moved`, `takes the NEWEST` and
`never crosses into another account` fail with the received value being the resolved-munge path
that holds no file. If `never crosses into another account` passes at this point, that is expected
too — it is a guard against a mutation, not against today's code.

- [ ] **Step 3: Give `_transcript_path` the ladder**

Replace the body below the field guard. Keep the docstring — extend it, do not delete the paragraph
explaining the resolve, which is still rung 1's justification.

```bash
_transcript_path() {   # id -> the Claude Code transcript for its CURRENT uuid
  # <cfg>/projects/<workdir with / . _ all mapped to ->/<uuid>.jsonl — the same
  # munge server/src/munge.ts applies. Recorded so a reap never has to be
  # reconstructed from an escaped path after the registry is gone.
  #
  # The workdir is RESOLVED first (`_ws_realpath`, longest existing prefix):
  # Claude Code munges its physical cwd — node's process.cwd() resolves
  # symlinks — while the registry keeps the path ccd wrote, and on this box
  # `~/projects -> /data/projects -> /mnt/...`, so the raw munge named a
  # projects dir Claude never writes.
  #
  # EXISTENCE-FIRST (spec §2.5). Resolving is necessary and was never
  # sufficient: a session that moves relocates its transcript, and this
  # function's answer is written into archive manifests and reap TOMBSTONES,
  # which outlive the registry row they describe. An unchecked guess there is
  # a permanent wrong address. So: the resolved munge if that file exists, then
  # the raw munge if that one does, then the uuid itself — newest match under
  # THIS account's config dir — and only then today's unchecked answer, so a
  # session that has written nothing yet still records the canonical address
  # rather than an empty string.
  #
  # Deliberately no live-cwd rung and no cross-account rung. These callers run
  # at archive, audit and reap time, when the session is stopped or idle and the
  # registry workdir is the durable fact; and a foreign account's copy needs a
  # banner naming it (D4 rung 6), which a tombstone has nowhere to put.
  local id="$1" wrapper cfg workdir uuid munged raw newest
  wrapper=$(_reg_get "$id" wrapper); workdir=$(_reg_get "$id" workdir); uuid=$(_reg_get "$id" uuid)
  cfg=$(_cfg_dir "$wrapper")
  [[ -n "$cfg" && -n "$workdir" && -n "$uuid" ]] || return 1
  raw=$(printf '%s' "$workdir" | tr './_' '---')
  workdir=$(_ws_realpath "$workdir")
  munged=$(printf '%s' "$workdir" | tr './_' '---')
  if [[ -f "$cfg/projects/$munged/$uuid.jsonl" ]]; then
    printf '%s/projects/%s/%s.jsonl\n' "$cfg" "$munged" "$uuid"; return 0
  fi
  if [[ -f "$cfg/projects/$raw/$uuid.jsonl" ]]; then
    printf '%s/projects/%s/%s.jsonl\n' "$cfg" "$raw" "$uuid"; return 0
  fi
  # Newest by mtime among every project dir holding this uuid. `stat -c %Y` per
  # candidate rather than `ls -t`: the paths are ccd-controlled but a project
  # dir name is a munged workdir, and parsing `ls` output is how a space in one
  # becomes a silently wrong answer.
  newest=$(_transcript_matches "$cfg" "$uuid" \
    | while IFS= read -r f; do printf '%s\t%s\n' "$(stat -c %Y "$f" 2>/dev/null || printf 0)" "$f"; done \
    | sort -rn -k1,1 | head -1 | cut -f2-)
  if [[ -n "$newest" ]]; then printf '%s\n' "$newest"; return 0; fi
  printf '%s/projects/%s/%s.jsonl\n' "$cfg" "$munged" "$uuid"
}
```

- [ ] **Step 4: Run the helper's own tests**

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts -t "_transcript_path"` (`timeout: 600000`)

Expected: PASS — all six, including the two that existed before this task and were not edited.

- [ ] **Step 5: Run every suite that touches the three consumers**

The manifest, the audit and the tombstone all embed this helper's answer, and their fixtures use
workdirs that exist. If any of them planted a transcript at one address and asserted another, the
ladder will now find the planted one — which is the fix working, but it must be *seen* rather than
discovered later.

Run: `cd server && ./node_modules/.bin/vitest run test/ccd-archive.test.ts test/ccd-ws-audit.test.ts test/ccd-ws-reap.test.ts` (`timeout: 600000`)

Expected: PASS. `ccd-ws-reap.test.ts:700` asserts the tombstone's transcript merely
`toContain(<cfg>/projects/)`, which every rung satisfies; `ccd-archive.test.ts:728` asserts an exact
path built from the munged workdir, and its fixture plants nothing, so rung 4 answers it unchanged.
If either fails, read the fixture before touching the assertion.

- [ ] **Step 6: Commit**

```bash
git add ccd/ccd server/test/ccd-archive.test.ts
git commit -m "fix(ccd): the tombstone records where the transcript is, not where it was started"
```

---

### Task 14: the gates, the sweep, and the docs that describe the old behavior

The wave gate. Nothing here adds behavior; everything here proves the behavior added by Tasks 1-12 is actually pinned, that no cross-package contract drifted, and that the README stops describing a fleet that no longer exists. The spec's own closing paragraph names the standard: "Every behavior above is proved by a test before it is written, the whole diff is mutation-swept with literal mutants, and the cross-package drift pins must stay green."

**Read this before starting:** the sweep table below names test files and `it` titles created by earlier tasks in this plan. Those names are this plan's intent, not a measurement of the tree. Before running the sweep, list what actually exists (`ls server/test | grep -E 'ccd-swap|ccd-spawn|ccd-stop|ccd-supervised|session-state|transcript-resolve'`) and **fix this table to match the tree** — never the reverse, and never delete a row because its named test is missing. A missing test is a missing proof and the row stays until one exists.

**Files:**
- Modify: `README.md` (six ranges, listed in Step 4)
- Test: no new files. This task RUNS `server/test/whitelist-subset.test.ts`, `server/test/verb-gate.test.ts`, `server/test/single-definition.test.ts`, `server/test/ccd-archive.test.ts`, `server/test/readme-holds.test.ts` and all three package suites.

**Interfaces:**
- Consumes: every construct Tasks 1-12 produced — `_transcript_matches`, `_sidecar_matches`, `_swap_carry_jsonl`, `_swap_carry_sidecars`, `_session_state`, `_supervised_start`, the changed `_ws_unsupervise`/`_ws_supervise`/`_accept_first_run_prompts`/`_spawn`, `CCD_IN_UNIT`, `sessionLifecycle`, `resolveTranscript`, `TranscriptResolver`, `lifecycleQualifier`.
- Produces: a green three-package gate, four green drift pins, a README that describes the shipped fleet, and a recorded list of what this plan does NOT prove.

- [ ] **Step 1: Run the mutation sweep**

For every row: apply the literal mutant to the source, run the named test, confirm it goes RED, revert. A row whose test stays green is a defect in the test, not in the table — fix the test in that task's file and re-sweep the row.

| construct | mutant | killed by |
|---|---|---|
| uuid locator globs every project dir (§2.1) | glob only `$srccfg/projects/$mdir/$uuid.jsonl` (today's code, ccd:7037) | `server/test/ccd-swap-carry.test.ts` — `it('carries a transcript written under a directory the registry never named')` |
| `nullglob` + explicit zero branch (§2.1) | drop `shopt -s nullglob`, keep `[[ -f ]]` | `ccd-swap-carry` — `it('a literal * path is not a match: zero hits is a state, not a filename')` |
| inode grouping (`stat -c %i`, §2.1) | copy every match, no grouping | `ccd-swap-carry` — `it('three hardlinked source names cost one copy and two links')` (asserts one destination inode, link count 3) |
| unlink-first content write (`cp -p --remove-destination`, §2.2) | plain `cp -p` | `ccd-swap-carry` — `it('a re-swap onto an account that already holds hardlinked names re-establishes the topology')` (two distinct sources; each destination must hold its OWN bytes) |
| unlink-first link write (`ln -f`, §2.2) | bare `ln` | `ccd-swap-carry` — `it('a destination name left by a previous swap is re-pointed, not EEXIST-skipped')` (ccd has no `set -e`; the bare `ln` fails silently) |
| sanitize-before-link order (§2.2) | link all names first, sanitize afterwards | `ccd-swap-carry` — `it('a gpt→anthropic swap sanitizes the file every destination name points at')` (`_sanitize_anthropic`'s `os.replace` breaks hardlinks; asserts identical inode AND sanitized bytes on every name) |
| newest-wins per destination slot (§2.2) | first match wins / oldest wins | `ccd-swap-carry` — `it('when a stale startup transcript and the relocated one both want mdir, the newer lands there')` |
| `cp -p` mtime preservation (§2.2) | plain `cp` | `ccd-swap-carry` — `it('a carried transcript keeps its source mtime')` (newest-wins and resolver rungs 5/6 both read mtimes) |
| the `mdir` slot is always covered (§2.2) | mirror source dirs only | `ccd-swap-carry` — `it('the resumed process own start directory always holds the newest carry')` |
| sidecars globbed in their own right (§2.3) | glob sidecars only beside a matched `.jsonl` | `ccd-swap-carry` — `it('carries a sidecar from a project dir that holds no jsonl for this uuid')` (M3) |
| sidecar carried as a hardlink tree (§2.3) | `cp -a` unconditionally | `ccd-swap-carry` — `it('a carried sidecar shares inodes with its source and logs the link mode')` |
| existing destination sidecar left alone (§2.3) | merge into it | `ccd-swap-carry` — `it('an existing destination sidecar is left alone, and the swap says so')` |
| zero matches refuse, before teardown (§2.4) | complete the swap anyway | `server/test/ccd-swap-refuse.test.ts` — `it('refuses, leaves wrapper unchanged, restarts on the original account, stamps swapblocked')` |
| refusal does not stamp `lastswap` (§2.4) | write `lastswap` on the refusal path | `ccd-swap-refuse` — `it('a refusal does not stamp lastswap — a restart must not read as a swap arrival')` (a `lastswap` inside 300s makes `_spawn` resume-from-summary, i.e. compact the very history the refusal protected) |
| authoritative glob runs AFTER the flush (§2.4) | act on the pre-flight glob | `ccd-swap-refuse` — `it('the carry re-globs after the pane is killed, so the final turn travels')` |
| locator re-reads the uuid after teardown (§2.4) | keep the pre-flight uuid | `ccd-swap-refuse` — `it('a /clear between pre-flight and copy carries the NEW uuid')` |
| refusal is NOT written in the reap protocol's four shapes (§2.4) | `printf '{"refused":"noswap",…}'` | `server/test/wsaudit.test.ts` — its existing source-grep totality check goes red on an unmapped token |
| auto-swap 1800s cooldown on `swapblocked` (§2.4) | drop the check | `ccd-swap-refuse` — `it('_auto_swap_check skips a session whose swapblocked stamp is younger than 30 minutes')` |
| rc 3 — tmux session vanished (§3.3) | fall through to the loop's `sleep 2` status (M6's rc 0) | `server/test/ccd-spawn-verdict.test.ts` — `it('a vanished tmux session returns 3 and stops polling immediately')` |
| rc 4 — window expired (§3.3) | return 0 | `ccd-spawn-verdict` — `it('an exhausted window returns 4 and the caller does not print started/ensured')` |
| rc 2 keeps suppressing `/effort` (§3.3) | inject on 2 | `server/test/ccd-login-screen.test.ts` (existing) — its `/effort`-suppression case |
| `$REG/<id>.spawn` written ALWAYS (§3.1) | write only on failure | `ccd-spawn-verdict` — `it('every spawn records <epoch> <rc>, success included')` |
| `CCD_IN_UNIT` guard, not `INVOCATION_ID` (§3.2) | discriminate on `INVOCATION_ID` | `server/test/ccd-supervised-start.test.ts` — `it('ensure inside the unit spawns directly, while a swap under systemd-run still goes through systemd')` |
| `reset-failed` before `enable --now` (§3.1) | drop it | `ccd-supervised-start` — `it('a failed unit is revived by start')` |
| supervisor self-enables at startup (§3.2) | drop the `systemctl --user enable` line | `ccd-supervised-start` — `it('a supervisor with no default.target.wants symlink creates its own')` (M5's three rows) |
| start waits on observables (§3.1) | return immediately after `enable --now` | `ccd-supervised-start` — `it('start returns only once the pane exists or a newer non-zero spawn stamp lands')` |
| one-arg id form (§3.4) | keep the two-arg-only form | `ccd-supervised-start` — `it('ccd start <id> revives a swapped session under the id it was born with')` |
| two-arg start stops clobbering `wrapper` (§3.4) | keep the unconditional `_reg_set wrapper` | `ccd-supervised-start` — `it('a differing wrapper argument warns; the registry wrapper wins')` |
| flag-strip BEFORE the arity rule (§4.1) | strip after / not at all | `server/test/ccd-stop-stamp.test.ts` — `it('ccd stop <id> --surface pwa stops <id>, not a session named --surface')` |
| surface validated against the closed set (§4.1) | write the raw word | `ccd-stop-stamp` — `it('a surface outside cli/pwa/agent/ccd normalizes to unknown')` |
| stamp lives inside `_ws_unsupervise` (§4.1) | stamp in `cmd_stop` only | `ccd-stop-stamp` — `it('ws-archive stamps too, so an archived workspace never reads orphan')` |
| `_ws_supervise` clears the stamp (§4.1) | leave it | `ccd-stop-stamp` — `it('a revive clears the stop stamp')` |
| heartbeat stamped BEFORE `cmd_ensure` (§4.2) | stamp when the watch loop starts | `ccd-supervised-start` — `it('a 15-minute resume never reads unsupervised')` |
| heartbeat freshness = 120s (§4.2) | `>=`↔`>`, or 12s/1200s | `server/test/session-state-fixture.test.ts` — fixture rows at 119 999 ms (fresh) and 120 001 ms (stale) |
| stop stamp checked BEFORE the heartbeat in the not-alive branch (§4.3) | reorder | `session-state-fixture` — the row `alive=no, supervised=fresh, stopped=present` → `stopped`, not `restarting` |
| `unmeasurable` is never `orphan` (§4.3) | fold an unreadable field into the orphan branch | `session-state-fixture` — `it('an unreadable field yields unmeasurable, never orphan')` |
| one rule, two implementations (§4.3) | let the bash twin drift from the TS function | `session-state-fixture` — the whole table driven row-for-row through BOTH |
| rung 1 `live-resolved` (§5.1) | delete the rung | `server/test/transcript-resolve.test.ts` — `it('rung 1: the resolved munge of the directory given wins')` |
| rung 2 `live-raw` | delete the rung | `transcript-resolve` — `it('rung 2: the raw munge answers when realpath does not')` |
| rung 3 `registry-resolved` | delete the rung | `transcript-resolve` — `it('rung 3 rescues a LIVE session whose cwd moved into a worktree')` (M4's reproduced failure) |
| rung 4 `registry-raw` | delete the rung | `transcript-resolve` — `it('rung 4 answers when the registry workdir does not resolve')` |
| rung 5 `uuid-glob`, own account only (§5.1) | let it sweep other accounts too | `transcript-resolve` — `it('an own-account answer always beats a foreign one')` (M2: five copies of one uuid at five sizes) |
| rung 6 `foreign-glob` pooled, newest-wins (§5.1) | first-account-in-roster-order wins | `transcript-resolve` — `it('five copies across five accounts: the newest wins globally; ties break by roster order, then path')` |
| rung 6 only when 1-5 all miss (§5.1) | consult it earlier | `transcript-resolve` — `it('rung 6 never runs while any own-account rung hits')` |
| rung 6 asked for only by the session stream (§5.2) | let the name sweep ask for it | `server/test/name-sweep.test.ts` — `it('a derived name is never taken from another account frozen copy')` |
| rung 7 fallback is the DIRECTORY GIVEN's raw munge (§5.1) | fall back to the registry munge | `transcript-resolve` — `it('the fallback path is the raw munge of the directory given, so a tailer keeps working')` |
| `(size, mtimeMs)` candidate collapse (§5.1) | collapse on size alone / mtime alone | `transcript-resolve` — `it('three hardlinked names read as one candidate; two files agreeing on size but not mtime read as two')` |
| `complete: false` on a null `readdir` (§5.2, §5.5) | mark every fallback complete | `transcript-resolve` — `it('a null readdir yields an incomplete fallback, never an absence')` |
| memo re-validates with ONE stat (§5.4) | re-run the whole ladder each call | `transcript-resolve` — `it('a steady-state resolve costs exactly one stat')` (counts `io.stat` calls) |
| memo re-ladders when its winner vanishes (§5.4) | keep returning the memoized path | `transcript-resolve` — `it('the memo re-ladders the moment its winner disappears')` |
| memo re-ladders on a key change (§5.4) | key on `(configDir, uuid)` only | `transcript-resolve` — `it('a changed dirGiven is a different memo key')` |
| memo back-off (30 000 ms) for `fallback`/`foreign-glob` (§5.4) | memoize those two forever | `transcript-resolve` — `it('a fallback re-ladders after the back-off, not before')` |
| stream re-points on a strictly better rung (§5.3) | re-point on any change / never | `server/test/sessionws.test.ts` — `it('a swap landing moves the tail from the fallback to rung 5 and resends backlog')` |
| resume offset discarded when the echoed file differs (§5.3) | honour `since` on uuid alone | `sessionws.test.ts` — `it('a reconnect whose echoed file does not match resends the full backlog')` |
| PWA qualifier not gated on `dead` (§4.4) | gate it | `pwa/test/session-lifecycle.test.tsx` — `it('a LIVE unsupervised row says so — the qualifier is not gated on dead')` |
| PWA touches NO bucket (M10) | add a lifecycle key to `RANK` / switch `WORD` on lifecycle | `session-lifecycle` — `it('the qualifier changes NO bucket: dead+orphan sorts and reads exactly like dead')` |
| PWA tolerates an unknown lifecycle (M10, mirrored) | index the table without `?? null` | `session-lifecycle` — `it('a lifecycle this build has never heard of renders no qualifier and does not throw')` |
| PWA tolerates a pre-field row (cast, not revived) | read `session.stoppedBy.surface` directly | `session-lifecycle` — `it('a row from a server that predates the field renders no qualifier')` |
| PWA: two sentences for two facts (§5.2) | one sentence for both fallbacks | `session-lifecycle` — the incomplete/complete pair |
| PWA: absent `complete` means complete | `msg.complete ?? false` | `session-lifecycle` — `it('an older server that sends neither field is a COMPLETE search')` |
| PWA: `swapBlocked` is persistent, not a notice (M9) | render it as a toast | `session-lifecycle` — `it('a blocked swap states its reason on the row, and keeps stating it')` |
| PWA revive posts the EXISTING route (§4.4) | mint a new route or verb | `session-lifecycle` — `it('names ccd start <id> and posts to the existing ensure route')` |

**Gaps — recorded, not earned.** Four mutants this plan cannot kill, written down so the next reader finds an argument instead of an omission:

- **G1 — the `cp -al` → `cp -a` sidecar fallback (§2.3).** A cross-device destination cannot be produced inside a fixture HOME, so only the linking path and the logged mode string are proven; deleting the fallback survives the suite. Mitigation is the log line itself: the swap records which mode it used, so a fleet occurrence is diagnosable after the fact.
- **G2 — the 30-second start-path poll bound (§3.1).** The tests prove the two EXITS (a pane appeared; a newer non-zero `spawn` stamp landed) and not the bound. A mutant changing 30 to 3 or 300 survives without a wall-clock test, which this repo does not run.
- **G3 — `unmeasurable` in the bash twin (§4.3).** ccd reads `$REG` off local disk, where a read either works or the file is genuinely absent, so the state is unreachable from the bash side. The fixture marks the row server-only **and says why**; that exemption is the proof's boundary, and a second unexplained exemption is how this becomes a hole.
- **G4 — `_accept_first_run_prompts`' 450-iteration / ~15-minute window (§3.3, M6).** rc 4 is proven by shrinking the window through the harness, not by waiting it out, so a mutant changing 450 to 45 survives.

- [ ] **Step 2: Run the full suites, foreground, and report the printed counts**

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa/server && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit
```
(`timeout: 600000`)

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa/agent && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit
```
(`timeout: 600000`)

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa/pwa && ./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit
```
(`timeout: 600000`)

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa && bash -n ccd/ccd && node design/contrast-check.mjs
```
(`timeout: 600000`)

Expected: PASS everywhere. **Report the REAL printed counts** — copy vitest's own `Test Files N passed (N) / Tests M passed (M)` lines for each package into the wave report, verbatim. Do not paraphrase them, do not carry a count forward from an earlier run, and do not report a number this step did not print. A count nobody measured is the forgery class this repo bans by name; if a suite is skipped or filtered, say which and why.

- [ ] **Step 3: The four cross-package drift pins**

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa/server && ./node_modules/.bin/vitest run \
  test/whitelist-subset.test.ts test/verb-gate.test.ts test/single-definition.test.ts test/ccd-archive.test.ts
```
(`timeout: 600000`) — Expected: PASS. Then read each result against what this work was allowed to change:

1. **`whitelist-subset.test.ts`** — the ONE enrolment this whole design costs. Its layer-2c `EXPECTED` table (`server/test/whitelist-subset.test.ts:259-282`) pins every `CCD_ARGV` builder token-for-token, and two rows move:
   ```ts
       stopId: ['stop', 'demo-quiet-basin', '--surface', 'pwa'],
       stopPair: ['stop', 'claude', 'demo', '--surface', 'pwa'],
   ```
   Confirm both rows changed and **nothing else did**. Layer 3 (a grant no route builds fails) is why `cmd_enable` keeps its name in §3.1 rather than becoming a deleted alias. If any OTHER row in that table moved, an argv drifted that this spec never authorised — stop and find out which task did it.
2. **`verb-gate.test.ts`** — this work adds **no new ccd verb**, so no call site gains a `verbSupported` gate and no entry joins `UNGATED_BY_DECISION`. A diff here means a verb was added behind the spec's back (§6 rejects `ccd doctor` by name, and prices it: a caps line, a dispatcher arm, a `CCD_ARGV` entry, an agent grant and four drift tests).
3. **`single-definition.test.ts`** — `SessionLifecycle`, `SESSION_LIFECYCLES` and `sessionLifecycle` exist **once**, in `shared/api.ts`. The bash twin `_session_state` is the deliberate second implementation and is policed by the cross-language fixture instead — that is the architecture doc's named enforcement idiom, not an exemption from this one. A copy of the union in `server/` or `pwa/` fails here, which is the whole point.
4. **`ccd-archive.test.ts`'s caps↔dispatcher parity** (`:129-150`) — it parses the dispatcher's case arms, splits `|` aliases and asserts set-equality with `cmd_caps`' 30-line heredoc. **This work adds no verb, so the caps list must not move.** Any movement here is a mistake, not a migration.

- [ ] **Step 4: The README sweep**

Read `README.md` in full first. The ranges below are a snapshot at plan-writing time on a 817-line file — **re-anchor each one by its sentence, not by its number**, then rewrite it. Every one of these currently describes behavior this plan changed.

| lines | the sentence today | what the new sentence must say |
|---|---|---|
| **3-5** | "It follows sessions across account swaps — the thing the official claude.ai app can't do." | The claim gets stronger and more specific: the swap now carries the *conversation*, located **by uuid** across every project directory in the source account rather than by one guessed path, and a swap that can find nothing **refuses** instead of completing. Say that the PWA also still finds history a pre-fix swap stranded on another account, under a banner naming it. |
| **56** | "`notify.sh` (ccd swap hook → `/api/notify`), `deploy.sh`." | The hook now fires on a swap **refusal** as well as a landing, and the refusal's durable half is the registry field `$REG/<id>.swapblocked`, not the notice — M9: a notice raised with no socket open is gone, and the operator who was not watching is the one who needs to know. |
| **162-168** (the ladder paragraph under "### The attention bucket") | "The ladder tests, in order: `archivedAt` … then `dead` … then `idle`." | Add one sentence and change nothing else: a session's **lifecycle** (`running`, `unsupervised`, `stopped`, `restarting`, `orphan`, `never-started`, `unmeasurable`) is a new optional FIELD and a qualifier on the row — **never** a new `SessionBucket` member and never a change to this ladder — because the live fleet frame is cast rather than revived and an unknown bucket token throws in an already-deployed PWA. |
| **332-368**, specifically **351-353** ("Manual placement (`ccd start`, `ccd swap`, `ccd prefer`) bypasses the gate entirely") | placement is an operator override, full stop | Keep the override, add the correction §3.4 makes: `ccd start` no longer **rewrites** an existing row's account. For an existing id the registry `wrapper` wins and a differing argument is a warning; `ccd swap` stays the only verb that moves a session between accounts. Also state the one-argument id form (`ccd start <id>`, `ccd enable <id>`) and why it exists — a swapped session keeps the id it was born with, so an operator reading the account off the board and typing it back used to mint a *different* id. |
| **394-417** ("### Login screens get no keystrokes, and lost auth joins the rescue lane") | rc 2 and the login-screen check, described as the only non-zero verdict | The verdict table is now four-valued: `0` a live marker appeared, `2` a login screen (unchanged), `3` the tmux session vanished mid-poll, `4` the window expired with no marker. Say that rc 3 ends the wait **immediately** (a vanished pane used to cost a quarter of an hour), that a non-zero verdict is recorded in `$REG/<id>.spawn` as `<epoch> <rc>` so it reaches a `ccd start` running in another process, and that the unit's `StartLimitIntervalSec`/`StartLimitBurst` turn an instant-death restart loop into a **failed** unit — which heartbeats nothing and therefore reads as `orphan`, with `ccd start <id>` (and its `reset-failed`) as what revives it. |
| **550-580**, specifically the exec-whitelist bullet at **560-568** | "most `ccd` verbs are still a bare first token (`start`, `enable`, `ensure`, `stop`, `swap`, `ws-add`)" | `stop` gains a validated `--surface <word>` flag — **the single enrolment this whole design costs** — and `whitelist-subset.test.ts`'s `EXPECTED` table pins it token-for-token. Say why it is an argv flag and not an env var: the exec seam is `Runner = (cmd, args) => …` with no env, and the agent's wire `ExecReq` carries `{cmd, args, timeoutMs}` only, so a `CCD_SURFACE` variable would report the server process's own environment identically for every caller. Say too that it records a **declaration, not an authentication**. |
| **582-586** (the path-whitelist bullet) | reads: `$HOME/.cc-sessions/`, `$HOME/.cc-limits/`, `$HOME/.cc-clips/`, `$HOME/.claude*/`, the projects root | **No change to the list** — state affirmatively that the resolver's uuid search (rungs 5 and 6) rides the existing `$HOME/.claude*` grant, and that §4.2 chose a supervisor heartbeat over systemd introspection precisely so nothing under `~/.config/systemd` had to be added. A whitelist that did not widen is worth saying out loud. |

Then **add one new subsection** after "### The attention bucket", documenting what an operator now reads off a row: the four registry fields (`.stopped` = `<epoch> <surface>`, `.supervised` = `<epoch>`, `.swapblocked` = `<epoch> <reason>`, `.spawn` = `<epoch> <rc>`), the 120-second freshness window and 30-second heartbeat, the seven lifecycle states with the four inputs that decide them, `ccd ls`'s `ALIVE` column becoming `STATE`, and the deliberate absence of any reconciler daemon or `ccd doctor` (§6: the incident's stop was deliberate, and an unattended restarter is the one component that could have fought it).

Verify the prose pin that already exists is untouched:

```bash
cd /home/you/worktrees/ccrc-pwa/quiet-mesa/server && ./node_modules/.bin/vitest run test/readme-holds.test.ts
```
(`timeout: 600000`) — Expected: PASS. That test greps ccd itself and pins the "### Workspace holds & programs" section to the shipped rungs; none of the edits above are inside it, and if it goes red an edit landed in the wrong section.

- [ ] **Step 5: The deploy note — confirm the two things this work rides on**

No file changes. Read `deploy/deploy.sh` and confirm all three anchors still hold (line numbers verified on this tree; re-anchor by text if they moved):

```bash
sed -n '205p;256p;281p;283p' deploy/deploy.sh
```

Expected, in order:
- `:205` — `&& cp ~/ccrc/ccd/claude-session@.service ~/.config/systemd/user/ \` — inside `AGENT_BUILD_CMD`, so the unit's new `StartLimitIntervalSec`/`StartLimitBurst` (§3.3) ship by the same path every other unit change has.
- `:256` — `&& systemctl --user daemon-reload && systemctl --user enable --now ccrc-agent.service \` — systemd re-reads the changed unit in the same run.
- `:281` — `&& systemctl --user try-restart "claude-session@*" \` — the supervisor sweep. This is what makes §3.2's "the supervisor creates its own enable symlink at startup" run **fleet-wide on the first deploy**: every live supervisor is otherwise still executing the pre-deploy ccd, and M5's three unsupervised rows heal without anyone typing anything.
- `:283` — `bash ~/ccrc/deploy/verify-service.sh "$u" || exit 1; done'` — `verify-service.sh` runs **per unit** after the sweep, so a supervisor that fails to come back under the new unit fails the deploy rather than the fleet.

One property the sweep depends on and §3.1 must not have broken: `KillMode=process` keeps the tmux substrate alive across a `try-restart`, and `cmd_ensure` re-attaches rather than spawning a second session — so the sweep stays a no-op for healthy rows. `cmd_ensure`'s in-unit path (the `CCD_IN_UNIT` branch) is exactly what the sweep re-enters, so read that branch once more against this claim before shipping.

Record the post-deploy check the rollout will run (§8's own done-condition, not run here):

```bash
ls ~/.config/systemd/user/default.target.wants/ | grep 'claude-session@'
# expect ccrc-pwa-calm-mesa, data-internal-plain-harbor and data-internal-still-prairie
# to appear after the first agent deploy, with nobody having typed anything (M5)
```

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs(readme): the fleet the readme describes is the one that now runs — swaps carry, starts supervise, dead rows say why"
```

## Self-Review Notes (spec → plan coverage)

**Every spec section maps to a task:**

| Spec | Task |
|---|---|
| §2.1 the uuid locator, inode grouping, `nullglob` | 1 |
| §2.2 destination map, newest-wins slot, `cp -p --remove-destination`, `ln -f`, sanitize-before-link | 1 (helpers), 2 (`cmd_swap` uses them) |
| §2.3 sidecars: own glob, mirrored destination, hardlink tree, leave-existing, the frozen-source asymmetry, tasks dir unchanged | 2 |
| §2.4 advisory pre-flight, post-flush re-glob, refusal, restart on the original account, no `lastswap`, `swapblocked`, notify, cooldown, `--force`, the wsaudit non-entry | 3 |
| §2.5 `_transcript_path`'s existence-first ladder, no live-cwd rung, no cross-account rung | 13 |
| §3.1 unit-delegated start, wait on observables, `reset-failed`, systemd-absent fallback | 5 |
| §3.2 `CCD_IN_UNIT` guard, enable-symlink self-heal | 5 |
| §3.3 rc 0/2/3/4, the `spawn` stamp | 4 (verdicts), 5 (unit `StartLimit`) |
| §3.4 one-arg id form, registry `wrapper` wins | 6 |
| §4.1 stop stamp, `--surface` with flags stripped before arity, `_ws_unsupervise` as the choke point | 7 |
| §4.2 heartbeat at supervisor entry and every 30s, swap re-stamps | 7 |
| §4.3 the classification table | 7 (bash `_session_state`), 8 (shared function + the one fixture both are driven from) |
| §4.4 `ccd ls` STATE column, the wire field, revive via the existing `/ensure` route | 7 (ls), 9 (wire), 12 (PWA) |
| §5.1 the ladder, rung 6 pooling and ties, the dedupe asymmetry | 10 |
| §5.2 the typed outcome, `complete` | 10 |
| §5.3 re-point rule, `since` carries the resolved file | 11 |
| §5.4 short-circuit and memo | 10 |
| §5.5 remote degradation | 10 |
| §6 non-goals | 13 asserts the caps list did not move and no verb was added |
| §7 artifact lifecycle | nothing to build — the declaration is satisfied by §2.1's inode rule and §2.3's link tree, both implemented in Tasks 1-2 |
| §8 rollout, acceptance, drift pins | 13 |

**Deliberate non-touches, recorded so they are choices:**

- **`server/src/exec.ts`'s `Runner` signature stays env-less.** Adding a per-call env would be the
  other way to carry the stop surface; §4.1 chose the argv flag instead, and widening the exec seam
  for a label is not worth the blast radius.
- **`FleetIO.stat` is not extended with an inode.** §5.1 explains the `(size, mtimeMs)` collapse
  that makes it unnecessary; extending the port would mean a wire change, an agent release and a
  rollout ordering constraint, for a distinction that only decides which of two identical files is
  displayed.
- **The bucket ladder, `SessionStatus` and `SessionBucket` are untouched.** Task 9 ships a negative
  test that says so.

**One adjacent defect was found while planning and ruled INTO scope:**

`_transcript_path` (ccd:300-320) is ccd's own copy of the same resolution, with the same
single-guess shape: it munges the resolved registry workdir and stops there, never asking whether a
file is present. Its three consumers are `_ws_archive_manifest` (ccd:2123), `cmd_ws_audit`
(ccd:4032) and `_ws_tombstone` (ccd:4704) — the durable records written when a workspace is
archived, audited and reaped — so a session whose transcript moved gets a tombstone naming a path
that does not hold it, in the one artifact built to outlive the registry row. Surfaced during
planning, ruled in by the operator the same day, specified as §2.5 and implemented as Task 13,
which consumes Task 1's `_transcript_matches`. Its two pre-existing tests
(`server/test/ccd-archive.test.ts:289-311`) must keep passing unedited — that is the task's
compatibility claim, and it holds because both use a fixture where no candidate file exists, so the
ladder falls through to the answer the helper gives today.
