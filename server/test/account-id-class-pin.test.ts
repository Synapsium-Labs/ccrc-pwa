// D-8126 wave A7 (review 2807, F9): the account-id class is spelled three times, and nothing structural can hold the
// spellings equal. `shared/roster.ts` keeps `ID_RE` private (`parseRoster` is its one reader), `CCD_ARGV.skillEnsure`'s
// `accountIdArg` (`server/src/ccdargv.ts`) copies it to refuse a hostile id before sending, and `cmd_skill_ensure`
// (`ccd/ccd`) copies it in bash, where nothing from this repository can be imported (departure
// `account-id-class-copied`). This file pins both copies to the roster's spelling, EXACTLY ONE occurrence each, so a
// widened roster class reds here before the builder starts refusing a valid account and the lane records `failed`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ccdSource } from './ccdWsHelpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const text = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');

/** Every capture of `re` in `src`, so a second spelling is seen, never skipped. */
const all = (src: string, re: RegExp): string[] => [...src.matchAll(re)].map((m) => m[1]!);

describe('the account-id class: one spelling, two pinned copies (D-8126)', () => {
  const roster = all(text('shared/roster.ts'), /^const ID_RE = \/(.+)\/;$/gm);

  it('the roster spells its class exactly once', () => {
    expect(roster).toHaveLength(1);
  });

  it('the server builder\'s copy (`accountIdArg`) is the roster\'s class', () => {
    const copies = all(text('server/src/ccdargv.ts'), /^const accountIdArg = \(id: string\): string => \{\n {2}if \(!\/(.+)\/\.test\(id\)\)/gm);
    expect(copies).toEqual(roster);
  });

  it('ccd\'s `skill-ensure` copy is the roster\'s class', () => {
    const copies = all(ccdSource(), /^ {2}\[\[ "\$w" =~ (.+) \]\] \|\| \{ echo "ccd: bad wrapper id: \$w" >&2; exit 2; \}$/gm);
    expect(copies).toEqual(roster);
  });
});
