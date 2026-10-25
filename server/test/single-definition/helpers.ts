// Structural guards for the "one definition, imported everywhere" findings.
//
// Both of these started life as a COMMENT asking the next reader not to copy
// something, and both were copied anyway — `UNCHECKED_PR`'s own docstring said
// "a second copy would drift" and by the time the integration review ran there
// were three. So the guard is a test that reads the sources, in the suite that
// already reaches outside its own package (`module-format.test.ts` walks
// `shared/`, the ccd tests execute `../../ccd/ccd`). A
// comment is a request; a red suite is a mechanism.
//
// These scan TEXT, deliberately, and that is a limitation worth stating: they
// catch the copy that looks like the original, which is the copy people
// actually write. A determined author can evade either one (build the object
// field-by-field, spell the union across a type alias in another file). The
// bar is "a reasonable person adding a fourth copy in the ordinary way is
// stopped before review", not "unforgeable".
//
// WHERE A NEW GUARD GOES (D-TBD-named-anchors). This guard used to be one file that could only be appended to,
// because `session-hook.test.ts` cited it by line, and every new row landed in the same hunk. It is split by area
// into `server/test/single-definition/<area>.test.ts`, the shared walkers live in `./helpers.ts`, and code is
// cited by anchor (`file#@name`, resolved by `anchors.test.ts`), not by line. Add a guard to the area file it
// belongs to, wherever it reads best. Older block comments that say a block is APPENDED, or that this file is cited
// by line, record why it sat where it did; they no longer bind anyone.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';


export const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ccrcRoot = path.resolve(here, '..', '..');


/** Every source root any of the three definitions could be copied into. The
 *  pwa is in this list because that is where the ORIGINAL lived and where the
 *  drift began; the agent because it is the third consumer of `shared/`. */
export const ROOTS = [
  path.join(ccrcRoot, 'shared'),
  path.join(ccrcRoot, 'server', 'src'),
  path.join(ccrcRoot, 'pwa', 'src'),
  path.join(ccrcRoot, 'agent', 'src'),
];


export function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    // `__`-prefixed entries are TRANSIENT mutants written by a parallel suite
    // (`boot.test.ts` writes `server/src/__boot_control_mutant__.ts` for ~15s).
    // Two failure modes, not one: `statSync`/`readFileSync` ENOENT on a file
    // that vanished mid-walk, and — while it exists — it is a verbatim copy of
    // `index.ts`, so a value this suite pins as appearing ONCE momentarily
    // appears twice, i.e. a false "second copy" in the very test whose job is
    // to fail the build on a second copy. Same guard, same reason, as
    // `run-routes.test.ts`'s `sourcesUnder`.
    if (e.startsWith('__')) continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...sources(p)); continue; }
    if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}


export const ALL = ROOTS.flatMap(sources);

export const rel = (p: string): string => path.relative(ccrcRoot, p);


/* `prose` and `passage` live at MODULE scope, not inside the one describe that
 * first needed them. They were block-locals 245 lines BELOW the bare
 * `store.slice(store.indexOf(OPEN), store.indexOf(CLOSE))` pair at the
 * abandonment-predicate test — so the cure this file defines was out of reach
 * of the fourth instance of the disease, in the file that defines the cure
 * (D-1439). Hoisting is the fix that also prevents the fifth: any describe here
 * can now anchor a passage without writing the pair again, and writing it again
 * in THIS file would be a second copy of a helper — the exact thing every other
 * assertion in this suite forbids. */
/** A docstring as a reader sees it: leading ` * ` gone, wrapping collapsed —
 *  `coordinator-skill.test.ts`'s `flat()` lesson, applied to a JSDoc block.
 *  Without it, "the ingress route\n   * ONLY" walks past every `toContain`. */
export const prose = (t: string): string =>
  t.split('\n').map((l) => l.replace(/^\s*\*\s?/, '')).join(' ').replace(/\s+/g, ' ');

/** A named docstring slice between two literal anchors, flattened by `prose`.
 *  `ledger-sweep.test.ts`'s `passage()`, copied for its reason as much as
 *  its shape — and copied LATE: the three cases below shipped as a bare
 *  `store.slice(store.indexOf(OPEN), store.indexOf(CLOSE))` pair, which this
 *  file's own header cites the lesson against without applying it (D-1426).
 *
 *  The failure is worse than the `''` the header warns about, and in the
 *  opposite direction. A lost OPENING anchor does yield `''`. A lost CLOSING
 *  one yields `-1`, and `String.slice(a, -1)` means "to length − 1" — so the
 *  docstring silently becomes THE WHOLE REST OF THE FILE, and every
 *  `toContain` below is satisfied by a blob that contains the entire module.
 *  Measured 2026-09-04 by reverting each anchor with a one-word edit to
 *  `store.ts`: the three slices ran to 197,980 / 76,803 / 160,592 chars and
 *  all three cases stayed GREEN. The `> 300` floor was written for the empty
 *  case and MAKES THAT WORSE rather than catching it — a 160KB blob clears a
 *  300-char floor without slowing down. So both anchors are asserted, and the
 *  closing one is searched for AFTER the opening one and must follow it. */
export const passage = (name: string, text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a, `${name}: the opening anchor is gone`).toBeGreaterThan(-1);
  const b = text.indexOf(to, a + from.length);
  expect(b, `${name}: the closing anchor is gone`).toBeGreaterThan(a);
  const out = prose(text.slice(a, b));
  expect(out.length, `${name} is too short to be the passage`).toBeGreaterThan(300);
  return out;
};

export const REACH = /\b(?:coord|store)\.db\s*[.,)]/;


// ── the bash side of "one definition", shared by the scans below ─────────
// Two describes read the same two trees now (the build stamp, and stage 2e's
// remote-control flag), so the walk lives here rather than inside either — a
// second copy of the scanner, in the file whose whole subject is second
// copies, would be the joke this suite exists to prevent.
export const bashRoots = [path.join(ccrcRoot, 'ccd'), path.join(ccrcRoot, 'deploy')];

export const isBash = (p: string): boolean => {
  if (/\.(sh|bash)$/.test(p)) return true;
  if (/\.[A-Za-z0-9]+$/.test(p)) return false;   // .mjs/.service/.json/.conf …
  return /^#!.*\b(ba)?sh\b/.test(readFileSync(p, 'utf8').split('\n')[0] ?? '');
};

export const bashFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...bashFiles(p)); continue; }
    if (isBash(p)) out.push(p);
  }
  return out;
};

// `install.sh` is not under any bash ROOT — it sits at the repo top, because
// that is where `curl … | bash` fetches it from. It was therefore outside this
// corpus entirely, so every "spelled once" rule below had been blind to the
// one script a stranger runs first. Folded in globally rather than per-rule:
// the seven pre-existing rules (build.json's two readers, `.ccrc/remote-control`,
// `.ccrc/exposure.env`, `.ccrc/Caddyfile`, `/etc/caddy/Caddyfile`, `ccrc-ddns`,
// the `KillMode=process` sweep) all want to see it too. `.filter(existsSync)`
// so a checkout without it fails the liveness row below, not every rule.
export const bashExtra = [path.join(ccrcRoot, 'install.sh')].filter((f) => existsSync(f));

export const BASH = [...bashRoots.flatMap(bashFiles), ...bashExtra];

/** One notion of a bash comment line, shared by every scan in this file that drops them (codeLines, the USAGE_PROSE describe's code()). */
export const isBashComment = (l: string): boolean => l.trim().startsWith('#');

/** A bash line that is not a comment. Either path is discussed in prose all
 *  over these tools; only an actual line of shell is a reader or a writer. */
export const codeLines = (f: string): string[] =>
  readFileSync(f, 'utf8').split('\n').filter((l) => !isBashComment(l));

export const holdersOf = (needle: string): string[] =>
  BASH.filter((f) => codeLines(f).some((l) => l.includes(needle))).map(rel).sort();


// ── Worker stall watch, wave 1 (spec 2026-09-29 §9.14 and §4.2 "Spelled once").
// (Formerly APPENDED after the last describe so no cited line moved; see the note at the head of this file.)

/** Comment LINES removed — the filter the setDeliveryEnvelope describe keeps
 *  block-local as `codeOnly` (hoisting it would move this file's cited lines,
 *  so the two stall describes below share this appended copy) — so a sentence
 *  ABOUT a name is never counted as spelling it. */
export const stallCodeText = (t: string): string =>
  t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

export const stallCode = (f: string): string => stallCodeText(readFileSync(f, 'utf8'));


// CCRC HISTORY (spec 2026-10-05 §9.11 O13, O14; §10.1 Seams). The history modules are imported dynamically inside
// each case.
export const HISTORY_DIR = path.join(ccrcRoot, 'ccd', 'history');

/** Every `.mjs` under a root: never a `.d.mts` (a type mirror declares types, it defines nothing), and the
 *  `__`-prefixed mutants and node_modules skipped — the MODELS_CORPUS walk, restated because that one is scoped
 *  to its own describe. */
export const mjsUnder = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e.startsWith('__') || e === 'node_modules') continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { out.push(...mjsUnder(p)); continue; }
    if (/\.mjs$/.test(p)) out.push(p);
  }
  return out;
};

export const HISTORY_MJS = mjsUnder(HISTORY_DIR);

/** Any `.mjs` a writer could live in: ccd/ (compact-card and history), deploy/, shared/. */
export const ALL_MJS = [...new Set([...mjsUnder(path.join(ccrcRoot, 'ccd')), ...mjsUnder(path.join(ccrcRoot, 'deploy')),
  ...mjsUnder(path.join(ccrcRoot, 'shared'))])];
