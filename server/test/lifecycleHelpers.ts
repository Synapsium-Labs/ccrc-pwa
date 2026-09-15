// server/test/lifecycleHelpers.ts
//
// ONE READER FOR EVERY LIFECYCLE TEST FILE. Seven files in waves 2-3 read the
// journal; seven hand-rolled copies are seven chances to sort generation names
// with a bare `.sort()` — the exact defect `compareGenerations` exists to
// prevent — and `single-definition.test.ts` exists because this repo has paid
// for the second copy before. The names come from L0: a test that hard-codes
// `.lifecycle` or `.ndjson` is a second home for a value wave 1 owns.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect } from 'vitest';
import {
  LC_DIR_NAME, LC_GEN_PREFIX, LC_GEN_SUFFIX, compareGenerations, looksLikeGenerationFile,
  parseLifecycleGeneration,
} from '../../shared/api.js';

export const lcDir = (home: string): string =>
  path.join(home, '.cc-sessions', LC_DIR_NAME);

/** Every event in every generation, in GENERATION order then file order. */
export const readJournal = (home: string): Record<string, unknown>[] => {
  const dir = lcDir(home);
  if (!fs.existsSync(dir)) return [];
  const gens = fs.readdirSync(dir)
    .filter((f) => looksLikeGenerationFile(f))
    .map((f) => [parseLifecycleGeneration(f), f] as const)
    .filter((p): p is readonly [string, string] => p[0] !== null)
    .sort((a, b) => compareGenerations(a[0], b[0]))
    .map(([, f]) => f);
  return gens.flatMap((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>));
};

export const actsOf = (home: string): string[] =>
  readJournal(home).map((e) => String(e['act']));

export const eventsOf = (home: string, act: string): Record<string, unknown>[] =>
  readJournal(home).filter((e) => e['act'] === act);

export const outcomesOf = (home: string, act: string): string[] =>
  eventsOf(home, act).map((e) => String(e['outcome']));

/** `refusal` and `detail` are TOP-LEVEL on the wire, never inside `meas` — the
 *  canonical shape, and the one this repo's readers must not "fix". */
export const refusalsOf = (home: string): { act: string; token: string }[] =>
  readJournal(home).filter((e) => e['outcome'] === 'refused')
    .map((e) => ({ act: String(e['act']), token: String(e['refusal']) }));

export const measOf = (e: Record<string, unknown>): Record<string, string> =>
  (e['meas'] ?? {}) as Record<string, string>;

export const decOf = (e: Record<string, unknown>): Record<string, string> =>
  (e['dec'] ?? {}) as Record<string, string>;

/** Belt to the harness's braces: a snippet that must answer `no-tmux` rather
 *  than the harness poison's `not-listed` prepends this. */
export const NO_TMUX = 'tmux() { return 1; };';

/** The generation filenames present, in order. */
export const generationsOf = (home: string): string[] => {
  const dir = lcDir(home);
  return (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((f) => looksLikeGenerationFile(f) && f.endsWith(LC_GEN_SUFFIX))
    .map((f) => [parseLifecycleGeneration(f), f] as const)
    .filter((p): p is readonly [string, string] => p[0] !== null)
    .sort((a, b) => compareGenerations(a[0], b[0]))
    .map(([, f]) => f);
};

/** `journal-<gen>.ndjson`, built from L0's two halves rather than from a
 *  literal. Four test files in this wave plant generation files; four spellings
 *  of the name is four chances to differ, in a repo whose
 *  `single-definition.test.ts` exists for exactly that. */
export const genFile = (gen: string): string => `${LC_GEN_PREFIX}${gen}${LC_GEN_SUFFIX}`;

/** The row's permanent compaction mutex (D-2605). ONE spelling of this
 *  pathname for the whole suite: two test files now drive a caller against a
 *  genuinely held lock, and a second copy of the name is the drift
 *  `single-definition.test.ts` exists to refuse. */
export const compactLockPath = (home: string, id: string): string =>
  path.join(home, '.cc-sessions', `.${id}.compactions.lock`);

/** Hold that mutex from a REAL process, resolving only once the child reports
 *  it HAS it — so the caller under test races a genuinely held lock rather than
 *  a hoped-for one. Returns the release. */
export const holdCompactLock = async (home: string, id: string, secs: number): Promise<() => void> => {
  const lock = compactLockPath(home, id);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.closeSync(fs.openSync(lock, 'a'));
  const child = spawn('bash', ['-c',
    `exec 9<>"$1" || exit 1; flock 9 || exit 1; echo held; exec sleep ${secs}`, '_', lock]);
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('holder never took the lock')), 10_000);
    child.stdout.on('data', (d: Buffer) => { if (d.toString().includes('held')) { clearTimeout(t); res(); } });
    child.on('error', (e) => { clearTimeout(t); rej(e); });
  });
  return () => { try { child.kill('SIGKILL'); } catch { /* gone */ } };
};

/** THE CONTENTION ARM'S RE-RUN CLAUSE IS THE VERB'S, AND IT IS A CLAIM
 *  (r8 R8-I1) — `expectSurvivingState`'s twin for the OTHER half of the verb
 *  dispatch. `_compact_lock_why_remedy`'s EMPTY-`WHY` arm is the most-travelled
 *  path of the four durable purge callers, reached by no token at all, and it
 *  selects its RE-RUN clause from a NESTED `case "$verb"` whose two
 *  verb-specific labels nothing measured. MEASURED at this round's base:
 *  renaming `'ws-gc --prune')` left `ccd-lifecycle-purge` + `ccd-ws-gc` GREEN
 *  125/125 while the declining sweep's DURABLE detail prescribed
 *  `re-run ccd ws-gc --prune <id>` — and `cmd_ws_gc` inspects `${1:-}` ONLY, so
 *  that command silently discards the id and runs a FLEET-WIDE prune sweep;
 *  renaming `ws-reap)` left `ccd-lifecycle-purge` + `ccd-ws-reap` GREEN 144/144
 *  while a reap that had already completed was told to re-run itself, the exact
 *  claim the helper's own docstring says that arm exists to avoid.
 *
 *  IT LIVES HERE, BESIDE `holdCompactLock`, for that function's own reason: two
 *  test files assert this dispatch — `ccd-lifecycle-purge.test.ts` on three
 *  verbs and `ccd-ws-reap.test.ts` on the fourth through the real verb — and a
 *  second copy of the clause set is the drift `single-definition.test.ts`
 *  exists to refuse.
 *
 *  ASSERTED IN BOTH DIRECTIONS, because a renamed label does not delete a
 *  sentence: it falls through to the inner `*)` default, which satisfies the
 *  POSITIVE form of whichever arm it landed in. Only the absences separate
 *  them. */
export const expectContentionClauses = (verb: string, id: string, detail: string): void => {
  // THE ARM ITSELF, FIRST: every empty-`WHY` sentence opens by blaming the lock
  // it waited on, so this separates the contention arm from a tokened one and
  // from the fail-closed fallback before the clause assertions below run.
  expect(detail, `${verb}: the contention sentence names the lock it waited on`)
    .toContain('was unavailable');
  if (verb === 'ws-gc --prune') {
    expect(detail, `${verb}: the sweep declines before anything irreversible`)
      .toContain('the registry row is untouched');
    expect(detail, `${verb}: a sweep has no single row to wait for, so it prescribes no wait`)
      .not.toContain('once the compaction settles');
    expect(detail, `${verb}: and no command — ccd ws-gc --prune <id> discards the id and sweeps the whole fleet`)
      .not.toContain('re-run');
  } else if (verb === 'ws-reap') {
    expect(detail, `${verb}: the wait IS the remedy here, and it ends`)
      .toContain('re-run once the compaction settles');
    expect(detail, `${verb}: but nothing about a completed reap is re-run, so no command is named`)
      .not.toContain('re-run ccd');
  } else {
    expect(detail, `${verb}: this verb names itself and its own row in the command it prescribes`)
      .toContain(`re-run ccd ${verb} ${id} once the compaction settles`);
  }
};
