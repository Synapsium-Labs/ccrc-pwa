// server/test/dashIdFixture.ts
//
// THE FLAG-SPELLED IDS AND THE DECOYS THEY REDIRECT TO (path-identity spec §2.1, §2.2). Every suite that asks "does
// a verb bind an id the server's own flags spelled" reads its ids from here, so a ninth decision flag is added once.
// Test-only: it imports nothing from `server/src`, and it never runs ccd. A row is planted with node:fs because
// ccd's own writers refuse, or will refuse, the very ids these suites need on disk.
//
// FIXTURE HOME ONLY: every path below derives from the `home` a caller passes, which is a harness HOME.
import fs from 'node:fs';
import path from 'node:path';
import { lcDir } from './lifecycleHelpers.js';

/** Every flag the server's builders append after an id, and every identity key a verb's loop consumes: an id
 *  spelled as any of these is a flag spelling, never an id. */
export const DASH_IDS = ['--actor', '--surface', '--reason', '--expect', '--defer-expired', '--session', '--branch', '--child-of'] as const;
export type DashId = (typeof DASH_IDS)[number];
/** The surface words a redirect lands on: the sweeps' `agent` and the console's `pwa`. */
export const DECOY_IDS = ['agent', 'pwa'] as const;

export const regDirOf = (home: string): string => path.join(home, '.cc-sessions');

/** The `.uuid` a planted row carries unless the caller names one. */
const FIXTURE_UUID = '00000000-0000-4000-8000-000000000000';

/** One path component, or a throw: a planted name never leaves `$REG`. */
function component(what: string, name: string): string {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error(`plantRow: the ${what} ${JSON.stringify(name)} is not one path component`);
  }
  return name;
}

/** Writes `<id>.uuid` and each `<id>.<field>` with node:fs, never through ccd, so an id may spell a flag. Values are
 *  written as `_reg_set` writes them, with no trailing newline. A `uuid` in `fields` replaces the fixture's. */
export function plantRow(home: string, id: string, fields: Readonly<Record<string, string>> = {}): void {
  const reg = regDirOf(home);
  fs.mkdirSync(reg, { recursive: true });
  const rowId = component('id', id);
  const all: Record<string, string> = { uuid: FIXTURE_UUID, ...fields };
  for (const [field, value] of Object.entries(all)) {
    fs.writeFileSync(path.join(reg, `${rowId}.${component('field', field)}`), value);
  }
}

/** The registry's entries, unsorted; `[]` when the directory does not exist. */
function listing(home: string): string[] {
  const reg = regDirOf(home);
  return fs.existsSync(reg) ? fs.readdirSync(reg) : [];
}

/** Every `.reap-*.lock` under $REG, sorted: the permanent locks a refusal must not create. */
export function reapLocks(home: string): string[] {
  return listing(home).filter((n) => n.startsWith('.reap-') && n.endsWith('.lock')).sort();
}

/** The $REG listing, sorted, `.lifecycle` excluded. */
export function regListing(home: string): string[] {
  const journal = path.basename(lcDir(home));
  return listing(home).filter((n) => n !== journal).sort();
}

/** A UTF-8 locale whose `[A-Za-z]` admits `é` under bash's `=~`, or '' (the case then skips). Found by MEASURING
 *  that property through the caller's own contained shell, never by a locale's name, the way `wideDigitLocale`
 *  finds its digit-widening locale. Assigning `LC_ALL` in bash takes effect at once, so the subshell measures
 *  exactly what a `pre` of `LC_ALL=<loc>;` does to a sourced helper. */
export function wideLetterLocale(h: { sh(snippet: string): string }): string {
  return h.sh(`for l in $(locale -a 2>/dev/null | grep -iE 'utf-?8$'); do`
    + ` ( LC_ALL=$l; [[ "é" =~ ^[A-Za-z]$ ]] ) 2>/dev/null && { printf '%s' "$l"; break; }; done; true`);
}
