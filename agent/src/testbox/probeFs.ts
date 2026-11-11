// D-8290 (plan docs/superpowers/plans/2026-11-11-live-probe-budget.md). L3: the probe desk's reads and writes of the
// file system. It decides nothing: `probes.ts` judges every path these return.
//
//   realPathOf        a path with every symlink in its longest existing prefix followed, so a link into a fleet
//                     account's config directory is judged as where it leads.
//   fleetConfigDirs   the fleet accounts' config directories the given homes name: Claude Code's default `.claude`,
//                     and each roster account's `$HOME/<configDirSuffix>` when the home holds a roster that parses
//                     (`shared/roster.ts#parseRoster`, the roster's one reader). A home without one adds its default.
//   fileBudgetStore   the day's count, `<probe root>/budget.json`, written by a temporary file and a rename.
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseRoster } from '../../../shared/roster.js';
import { parseBudget, type ProbeBudget } from './probes.js';

/** `p` resolved: its longest existing prefix through `realpath`, the rest appended as written. */
export function realPathOf(p: string): string {
  let head = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(head), ...rest);
    } catch {
      const up = path.dirname(head);
      if (up === head) return path.join(head, ...rest);
      rest.unshift(path.basename(head));
      head = up;
    }
  }
}

/** The roster file under a home (`~/.ccrc/accounts.json`, `server/src/config.ts`'s path). */
const rosterFile = (home: string): string => path.join(home, '.ccrc', 'accounts.json');

/** Every fleet account config directory the homes name, resolved. */
export function fleetConfigDirs(homes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const home of homes) {
    out.add(realPathOf(path.join(home, '.claude')));
    const file = rosterFile(home);
    if (!existsSync(file)) continue;
    try {
      for (const a of parseRoster(JSON.parse(readFileSync(file, 'utf8')) as unknown).accounts) out.add(realPathOf(path.join(home, a.configDirSuffix)));
    } catch {
      // A roster that does not parse names no directory beyond the default; the name rule still holds every lane's.
    }
  }
  return [...out];
}

/** Where the day's count is kept, and its reads and writes. */
export interface BudgetStore {
  readonly file: string;
  read(): ProbeBudget | null;
  write(b: ProbeBudget): void;
}

export function fileBudgetStore(file: string): BudgetStore {
  return {
    file,
    read: () => {
      try { return parseBudget(readFileSync(file, 'utf8')); } catch { return null; }
    },
    write: (b) => {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(b)}\n`, { mode: 0o600 });
      renameSync(tmp, file);
    },
  };
}
