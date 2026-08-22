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
