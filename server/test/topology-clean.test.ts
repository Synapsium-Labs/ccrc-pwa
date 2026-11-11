// The topology-clean RATCHET (Stage 5, spec §3): the tree is owner-agnostic
// and box-agnostic, and this suite is the mechanism that keeps it so — the
// 2026-08-22 sensitive-info scan cleared these classes, and reintroduction
// ANYWHERE a `git ls-files` walk reaches (code, test, doc, fixture) is a red
// build. Each sweep task of the stage ADDS its pattern class to `FORBIDDEN`
// red-first, sweeps the tree to green, and the class can never return; the
// pre-flip re-scan is then confirmation, not the mechanism.
//
// The one subtlety spec §3 settles: a suite that spelled the forbidden tokens
// verbatim would itself publish them. So a class forbids by PATTERN — a shape,
// plus the committed placeholders the docs are allowed to speak in — or, for
// names no shape can express, by keyed HASH (the hashed class below), and never
// names a real host, address or id. The synthetic tokens in each class's
// `catches` list live only in THIS file, which the walk excludes by path (the
// hashed class reads it anyway: it carries only hashes); rename this file and
// the walk scans it, and the suite goes loudly red until `SELF` is updated.
//
// No allowlist of files at ship — an empty allowlist IS the claim. A class's
// `allowed` predicate admits only the documented placeholder VOCABULARY
// (`mybox.duckdns.org`, the committed EXAMPLE session id), never a path. Any
// future exception must be argued into this file next to the pattern it
// excuses, not waved through in review.
//
// Mutation ceremony (measured at ship, re-measured at Task 10): plant a
// class's first `catches` token on a line of a TRACKED doc → exactly 1 red;
// revert by editing. Ship measurement 2026-08-23: 1 red (public IPv4 planted
// in README.md), suite green on revert. Task 8 re-measure (scopes dropped,
// operator-residue class added): 1 red (the residue class's first token
// planted in README.md), 30/30 on revert. Task 10 final close 2026-08-23:
// one token each of 3 classes (public IPv4, CGNAT, duckdns) planted on one
// README.md line → exactly 3 reds, one per class; 30/30 on revert.
// Whole-branch review re-measure 2026-08-23 (D-206 case flags, D-207 path
// corpus): with both gaps probed at once — a case-variant of each name class
// planted in README.md AND a tracked file NAMED after the tailnet residue —
// the pre-fix suite ran 30/30 GREEN (both blindnesses demonstrated), the
// fixed suite exactly 3 reds (tailnet content, duckdns content, tailnet
// path — one per probe), and 38/38 on revert.
// D-208 range ceremony 2026-08-24: a public IPv4 planted in README.md by one
// commit and REMOVED by the next — tip clean, history dirty, the exact state
// the tip walk cannot see. The pre-guard suite ran 39/39 GREEN on it (the
// blindness, measured rather than argued); the guarded suite ran exactly 1 red,
// `README.md:2250: 1.2.3.4` on the public-IPv4 RANGE row, with all 47 other
// rows — every tip row included — still green; 48/48 on revert.
// D-5878 2026-10-19: the private-tracker-id class landed red-first — exactly
// 1 red (its tree row, listing 8 ids in 7 files), 60/61; 61/61 after the scrub.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANARY, EXEMPTIONS, MODES, PRIVATE_NAMES, entriesOf, entryKey, entryOf, hitsIn, maskText, pairHits,
} from './private-names.mjs';
import {
  EXAMPLE_SESSION_ID, PUBLIC_TEXT_CLASSES, privateTrackerKeysOf, publicTextClassesFor, type PublicTextClass,
} from '../src/linking/publicTextClasses.js';

/** The private tracker keys whose ticket ids this public tree may not carry
 *  (D-5878, CLAUDE.md's "This repository is public" rule): a reader cannot
 *  open a private ticket, so its id is a dead pointer that also maps the
 *  private workspace. The tracker syncs each ticket to a GitHub issue, and the
 *  tree refers to ccrc work by that `#n`. No key is spelled here (D-8181): the
 *  keys are the installer's, read from the same setting the server reads,
 *  `CCRC_PRIVATE_TRACKER_KEYS` (`privateTrackerKeysOf`), so an operator's run of
 *  this suite scans for that operator's keys. `FIXTURE_TRACKER_KEY` is a neutral
 *  stand-in the class's own rows below assert, and the tree measures zero ids
 *  under it too. */
const FIXTURE_TRACKER_KEY = 'ACME';
const PRIVATE_TRACKER_KEYS: readonly string[] = [
  FIXTURE_TRACKER_KEY,
  ...privateTrackerKeysOf(process.env.CCRC_PRIVATE_TRACKER_KEYS).keys.filter((k) => k !== FIXTURE_TRACKER_KEY),
];
/** The classes the walk applies: the runtime list, with the tracker class built over those keys. */
const TREE_CLASSES: readonly PublicTextClass[] = publicTextClassesFor(PRIVATE_TRACKER_KEYS);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

/** This suite, excluded from its own scan BY PATH — the only path-shaped
 *  exclusion the walk has, because its `catches` fixtures are forbidden
 *  tokens by design. */
const SELF = 'server/test/topology-clean.test.ts';

/** Skipped by EXTENSION, not by path: bytes that are not text. Reading a PNG
 *  as utf8 yields mojibake whose digit runs could score phantom IPs. */
// Anything whose bytes are not text. Wider than what the tree tracks today
// (only .png/.ico/.woff2/.db exist): a binary read as utf8 scores phantom
// dotted quads and duckdns-shaped runs out of compressed noise, so the first
// asset someone commits should not red the ratchet for a leak that is not
// there. The set is pinned by the exclusion row below, so widening it is a
// diff a reviewer sees rather than a quiet loosening.
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.db', '.sqlite', '.pdf', '.zip', '.gz', '.tgz', '.wasm',
]);

// `git ls-files` from the repo root IS the corpus definition: every tracked
// file, nothing registered by hand — a new file needs no wiring to be
// scanned, which is what makes this a ratchet rather than a checklist.
const trackedPaths: string[] = execFileSync('git', ['ls-files', '-z'], {
  cwd: root, maxBuffer: 64 * 1024 * 1024,
})
  .toString('utf8').split('\0').filter(Boolean);

const trackedFiles: string[] = trackedPaths
  .filter((f) => f !== SELF && !BINARY_EXT.has(path.extname(f)));

interface CorpusFile { file: string; lines: string[] }

const CORPUS: CorpusFile[] = [];
for (const file of trackedFiles) {
  let text: string;
  try {
    text = readFileSync(path.join(root, file), 'utf8');
  } catch (e) {
    // A tracked file deleted from the working tree mid-development has no
    // content to leak; anything else (EACCES, EISDIR) stays a loud throw.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
    throw e;
  }
  CORPUS.push({ file, lines: text.split('\n') });
}

/** Every tracked PATH as its own one-line pseudo-file, fed through the same
 *  classes (D-207, whole-branch review): a tracked file NAMED after a
 *  forbidden token with clean contents evaded the contents-only walk — the
 *  name ships in every clone as loudly as the bytes do. No exclusion at all
 *  here: SELF and the binary extensions are skipped from CORPUS because their
 *  BYTES are forbidden-by-design or not text; their NAMES enjoy no such
 *  license, so even this suite's own path is scanned. */
const PATH_CORPUS: CorpusFile[] = trackedPaths.map((p) => ({ file: p, lines: [p] }));

/** ─── THE PUBLISHED HISTORY, NOT JUST THE TIP (D-208) ────────────────────────
 *
 *  Everything above walks `git ls-files`: the TIP. That is the tree as it
 *  stands, and it is NOT the whole of what a push publishes. A commit that
 *  introduces a forbidden token and a later commit that removes it leave the
 *  tip clean and the BLOB permanent — reachable from the commit that added it
 *  forever, and on GitHub from `refs/pull/N/head` and the PR's own commits
 *  view even after the branch is deleted and even after a SQUASH merge. So the
 *  tip scan can be green while the artifact this repo publishes is not.
 *
 *  Measured, which is why this is a row and not a comment asking for one: on
 *  2026-08-24 a finished 128-commit branch ran this suite 30/30 GREEN with 13
 *  of its own commits carrying residue in intermediate states — 326
 *  occurrences of one class in the first commit alone. The tip was genuinely
 *  clean, the history was not, and nothing in the tree could tell anybody. The
 *  repo had gone public that morning; the remedy for a published leak is
 *  another `filter-repo` over every ref, and this project has run two.
 *
 *  The same classes, then, over every blob the range INTRODUCES. */

/** The base this branch is measured against. `origin/main` is the answer in a
 *  clone and in CI; `$CCRC_HISTORY_BASE` overrides it where the base is
 *  elsewhere. This returns null rather than guessing, and the row below turns
 *  that null RED: a guard that quietly measures nothing is the exact failure
 *  mode this file argues against, and a shallow `actions/checkout` (the
 *  default, depth 1, where `origin/main` does not exist) is precisely how it
 *  would happen. CI therefore carries `fetch-depth: 0`, and deleting it makes
 *  this suite red instead of making it vacuous. */
function resolveBase(cwd: string): string | null {
  // D-2732, and `deviation-refs.test.ts` says it copied this function from here,
  // so both drop the third candidate together. Local `main` on the fleet host is
  // a fossil another worktree parks — measured 356 commits behind `origin/main` —
  // and a transient `packed-refs` rewrite from any of ~10 sibling worktrees is
  // enough to make `origin/main` fail to resolve and hand this scan the fossil
  // silently. The null-base refusal below is the honest answer.
  const candidates = [process.env.CCRC_HISTORY_BASE, 'origin/main']
    .filter((r): r is string => Boolean(r));
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        { cwd, stdio: 'pipe' });
      return ref;
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** Every blob introduced by `range`, as a pseudo-file keyed on the path git
 *  records for it. Intermediate states are the POINT: a blob is published by
 *  the commit that adds it, not by surviving to the tip.
 *
 *  `file` is the bare path, deliberately NOT decorated with the blob sha —
 *  every class's `scope` and `skipLine` predicate matches on it (the
 *  `package-lock.json` line skip, a `docs/` scope), and a decorated label
 *  would stop those matching and manufacture false positives the tip walk does
 *  not have. One path therefore appears once per version, which is correct. To
 *  find the commit behind a row: `git rev-list --objects <range> | grep <path>`.
 *
 *  SELF is excluded for the tip walk's reason plus one more: a HISTORICAL copy
 *  of this suite carries the same `catches` fixtures, so a range touching this
 *  file would score its own liveness tokens. */
function rangeCorpus(cwd: string, range: string): CorpusFile[] {
  const listed = execFileSync('git', ['rev-list', '--objects', range],
    { cwd, maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
  const pathOf = new Map<string, string>();
  for (const line of listed.split('\n')) {
    const sp = line.indexOf(' ');
    if (sp > 0) pathOf.set(line.slice(0, sp), line.slice(sp + 1));
  }
  if (pathOf.size === 0) return [];

  const checked = execFileSync('git', ['cat-file', '--batch-check'],
    { cwd, input: `${[...pathOf.keys()].join('\n')}\n`, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8');
  const blobs: string[] = [];
  for (const line of checked.split('\n')) {
    const [sha, type] = line.split(' ');
    if (type !== 'blob') continue;
    const p = pathOf.get(sha);
    if (!p || p === SELF || BINARY_EXT.has(path.extname(p))) continue;
    blobs.push(sha);
  }
  if (blobs.length === 0) return [];

  const buf = execFileSync('git', ['cat-file', '--batch'],
    { cwd, input: `${blobs.join('\n')}\n`, maxBuffer: 512 * 1024 * 1024 });
  const out: CorpusFile[] = [];
  let pos = 0;
  for (const sha of blobs) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) break;
    const size = Number(buf.subarray(pos, nl).toString('utf8').split(' ')[2]);
    if (!Number.isFinite(size)) break;
    const body = buf.subarray(nl + 1, nl + 1 + size);
    pos = nl + 1 + size + 1;
    out.push({ file: pathOf.get(sha) as string, lines: body.toString('utf8').split('\n') });
  }
  return out;
}

/** A `+++` header's new path, or null for a deletion: git appends a TAB to a
 *  name containing a space, and C-quotes a name with a quote, a backslash or a
 *  control character (octal escapes for its bytes). */
function dstPath(raw: string): string | null {
  let p = raw.endsWith('\t') ? raw.slice(0, -1) : raw;
  if (p.startsWith('"') && p.endsWith('"')) {
    const bytes: number[] = [];
    const body = p.slice(1, -1);
    const named: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (c !== '\\') { bytes.push(...Buffer.from(c, 'utf8')); continue; }
      const d = body[++i] ?? '';
      if (/[0-7]/.test(d)) { bytes.push(parseInt(body.slice(i, i + 3), 8)); i += 2; } else bytes.push(named[d] ?? d.charCodeAt(0));
    }
    p = Buffer.from(bytes).toString('utf8');
  }
  return p.startsWith('b/') ? p.slice(2) : null;
}

/** The lines a branch ADDS, net of its own later edits: the `+` lines of
 *  `git diff <base>...HEAD` (from the merge-base), keyed on each new path, at
 *  their line numbers in the tip. The hashed class charges a branch for this and
 *  not for `rangeCorpus`: once that class lands, every open branch whose
 *  intermediate commits still carry an old name would be red for blobs its tip
 *  no longer has, and could never clear by editing — the sweep's own branch
 *  first. So an open branch answers for what its tip adds, and clears by
 *  editing its tip. Commit messages and branch names are not read here: the
 *  plan's pre-push grep covers them, and the hook will after this PR merges.
 *
 *  Diff configuration is pinned on the command line (no colour, no external
 *  diff or textconv, `a/`/`b/` prefixes, unquoted paths, no renames), so a
 *  developer's git config cannot change what this parses. SELF and the binary
 *  extensions are skipped for the reasons the walks above skip them. */
function netAddedCorpus(cwd: string, base: string): CorpusFile[] {
  const text = execFileSync('git', [
    '-c', 'color.ui=never', '-c', 'core.quotePath=false',
    '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.relative=false',
    'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=0',
    '--src-prefix=a/', '--dst-prefix=b/', `${base}...HEAD`,
  ], { cwd, maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  const out: CorpusFile[] = [];
  let cur: CorpusFile | null = null;
  let oldLeft = 0, newLeft = 0, newNo = 0;
  for (const line of text.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      // Inside a hunk, counted by its header: a removed line that itself
      // begins `-- ` must not read as a `--- ` file header.
      if (line.startsWith('+')) { if (cur) cur.lines[newNo - 1] = line.slice(1); newNo++; newLeft--; }
      else if (line.startsWith('-')) oldLeft--;
      else if (line.startsWith(' ')) { newNo++; newLeft--; oldLeft--; }
      continue;
    }
    if (line.startsWith('+++ ')) {
      const file = dstPath(line.slice(4));
      cur = file && file !== SELF && !BINARY_EXT.has(path.extname(file)) ? { file, lines: [] } : null;
      if (cur) out.push(cur);
      continue;
    }
    const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      oldLeft = m[1] === undefined ? 1 : Number(m[1]);
      newNo = Number(m[2]);
      newLeft = m[3] === undefined ? 1 : Number(m[3]);
    }
  }
  for (const f of out) f.lines = Array.from(f.lines, (l) => l ?? '');
  return out;
}

const HISTORY_BASE: string | null = resolveBase(root);
const HISTORY_CORPUS: CorpusFile[] =
  HISTORY_BASE ? rangeCorpus(root, `${HISTORY_BASE}..HEAD`) : [];
const NET_ADDED_CORPUS: CorpusFile[] = HISTORY_BASE ? netAddedCorpus(root, HISTORY_BASE) : [];

/** The hashed class reads this suite too: its entries are hashes, so SELF
 *  carries nothing it matches unless somebody adds a name here. */
const CORPUS_WITH_SELF: CorpusFile[] =
  [...CORPUS, { file: SELF, lines: readFileSync(path.join(root, SELF), 'utf8').split('\n') }];

/** A forbidden class as this suite runs it: the class from `server/src/linking/publicTextClasses.ts` (the one home of
 *  its pattern, vocabulary and `why`, which the server's public-text check reads too) and its liveness fixtures, which
 *  stay HERE: each `catches` list holds tokens the walk forbids, and this file is the one it excludes by path. */
interface ForbiddenClass extends PublicTextClass {
  /** files the class does not (yet) reach — Tasks 3/4/5 landed scoped (`!file.startsWith('docs/')`) and Task 8 dropped
   *  every scope; the field stays for any future class that must land the same way. Absent means the whole corpus, and
   *  NO class carries one. A tree-walk concern, so it lives here and not in the server's class. */
  scope?: (file: string) => boolean;
  /** liveness fixtures: each must score a violation on a synthetic line — the guard on the guard, so a pattern edit
   *  that goes vacuous turns its own row red instead of the tree scan quietly green. The FIRST entry is the
   *  mutation-ceremony token. */
  catches: string[];
  /** and each of these must NOT score — the placeholders and carve-outs, pinned so a pattern edit cannot silently
   *  widen into them either */
  passes: string[];
}

/** The class-9 entries' only non-hashed member, by construction: the canary
 *  is synthetic, and `PRIVATE_NAMES[0]` is its entry (pinned below). */
const CANARY_H8 = entryOf(CANARY, 'part').h.slice(0, 8);

const FIXTURES: Record<string, { catches: string[]; passes: string[] }> = {
  'public IPv4': {
    catches: ['1.2.3.4', '100.200.0.1', '172.32.0.1'],
    passes: ['203.0.113.7', '198.51.100.7', '192.0.2.1', '10.1.2.3', '127.0.0.1',
      '192.168.7.7', '172.31.255.1', '100.100.1.1', '0.0.0.0'],
  },
  'claude.ai session id': {
    // Constructed, not spelled: a verbatim 24-char id-shaped literal in this
    // file would be exactly the noise the suite exists to prevent.
    catches: ['session_01' + 'A'.repeat(22)],
    passes: [EXAMPLE_SESSION_ID],
  },
  'CGNAT tailnet IP': {
    catches: ['100.64.7.7', '100.127.3.4', '100.100.1.2'],
    passes: ['100.100.1.1', '100.63.0.1', '100.128.0.1', '203.0.113.7', '10.64.0.1'],
  },
  'tailnet name': {
    catches: ['fixture-box.ts.net', 'Fixture-Box.TS.NET'],
    passes: ['mybox.example.com', 'ts.net', '*.ts.net', '<tailnet>.ts.net',
      '<other-box>.<tailnet>.ts.net', 'tailscale.net'],
  },
  'duckdns subdomain': {
    catches: ['realbox.duckdns.org', 'RealBox.DuckDNS.org'],
    passes: ['mybox.duckdns.org', 'otherbox.duckdns.org', 'fixture.duckdns.org',
      'subdomain.duckdns.org', 'www.duckdns.org', '<sub>.duckdns.org', '<name>.duckdns.org'],
  },
  'email address': {
    // Constructed so this public test never carries a contiguous plausible
    // personal address; runtime liveness still exercises lower, mixed, plus,
    // and dotted local-part forms under non-reserved domains.
    catches: [
      ['person', '@', 'acme', '.', 'pro'].join(''),
      ['Person', '@', 'Acme', '.', 'Pro'].join(''),
      ['first.last', '+tag', '@', 'team', '.', 'engineering'].join(''),
      ['first.last', '+tag', '@', 'team', '.', 'engineering'].join('').toUpperCase(),
    ],
    passes: [
      'you@example.com', 'you@sub.example.com',
      'you@example.org', 'you@sub.example.org',
      'you@example.net', 'you@sub.example.net',
      'you@host.example', 'you@nested.host.example',
      'you@host.invalid', 'you@nested.host.invalid',
      'you@host.test', 'you@nested.host.test',
      'you@host.localhost', 'you@nested.host.localhost', 'you@localhost',
      'noreply@anthropic.com', 'git@github.com',
      ['*', '@evil.com'].join(''), ['8080', '@evil.com'].join(''),
      ['pass', '@evil.com'].join(''), 'i@izs.me',
      'ccrc-agent@worker.service', 'ccrc-agent@worker.timer',
      'ccrc-agent@worker.slice', 'ccrc-agent@worker.socket',
      'ccrc-agent@worker.target', 'ccrc-agent@worker.scope',
      'ccrc-agent@worker.path', 'ccrc-agent@worker.mount',
      'ccrc-agent@worker.device', 'ccrc-agent@worker.swap',
      'ccrc-agent@worker.automount', '<your-email>', 'user@host',
    ],
  },
  'private name (hashed)': {
    catches: [CANARY],
    // ccrc's own components and roster words, the house stand-ins, and the
    // vocabulary the two removed classes pinned as their replacements.
    passes: ['ccrc', 'ccd', 'ccgpt', 'ccrc-codex', 'gpt', 'claude', 'claude-a', 'project-a', 'lane-a',
      'example-org/example-repo', 'Synapsium-Labs', 'the fleet box', '<fleet-host>', '<projects-root>',
      'team·max', 'alt·max', 'team·shared', 'lab·dev0', 'orchard-api',
      'you@<server-host>', '/home/you', '/home/u', '/srv/projects', '~/.ssh/<your-key>'],
  },
  'private tracker id': {
    catches: [
      ...PRIVATE_TRACKER_KEYS.map((k) => `${k}-1`),
      `${FIXTURE_TRACKER_KEY}-12345`,
      `${FIXTURE_TRACKER_KEY.toLowerCase()}-120`,
      ['linear.app', 'some-workspace'].join('/'),
    ],
    passes: [...PRIVATE_TRACKER_KEYS, `${FIXTURE_TRACKER_KEY}-`, `${FIXTURE_TRACKER_KEY}-n`,
      'D-5878', 'ARCH-21', 'OA-2', 'SHA-256', 'UTF-8', 'CVE-2024-3094', 'GitHub #548', 'linear.app',
      'https://linear.app/'],
  },
};

const FORBIDDEN: ForbiddenClass[] = TREE_CLASSES.map((cls) => {
  const fixtures = FIXTURES[cls.name];
  if (!fixtures) throw new Error(`class ${cls.name} has no fixtures`);
  return { ...cls, ...fixtures };
});

/** The scan: every violation as `file:line: token` — or `file:line #h8` for a
 *  hashed class, which never prints the text it matched — and when a sweep task
 *  lands its class red-first, this list IS the work-list. The corpus parameter
 *  exists for the liveness rows below: `scoresOn` proves a PATTERN is alive,
 *  but only a call through THIS function proves the scan is — a neutered
 *  `violationsOf` returns `[]` and every tree test stays green, so each class
 *  pins it against a one-file synthetic corpus. */
function violationsOf(cls: ForbiddenClass, corpus: CorpusFile[] = CORPUS): string[] {
  const out: string[] = [];
  for (const { file, lines } of corpus) {
    if (cls.scope && !cls.scope(file)) continue;
    const shown = cls.printPath ? cls.printPath(file) : file;
    lines.forEach((line, i) => {
      if (cls.skipLine?.(line, file)) return;
      if (cls.match) {
        for (const h of cls.match(line, file)) out.push(`${shown}:${i + 1} #${h}`);
        if (cls.matchPair && i + 1 < lines.length) {
          for (const h of cls.matchPair(line, lines[i + 1]!, file)) out.push(`${shown}:${i + 1} #${h}`);
        }
        return;
      }
      for (const m of line.matchAll(cls.pattern!)) {
        if (cls.allowed?.(m[0])) continue;
        out.push(`${file}:${i + 1}: ${m[0]}`);
      }
    });
  }
  return out;
}

/** What a class would say about one synthetic line — the liveness harness. */
function scoresOn(cls: ForbiddenClass, token: string): number {
  const line = `a line carrying ${token} in prose`;
  if (cls.match) return cls.match(line, 'server/synthetic.md').length;
  return [...line.matchAll(cls.pattern!)]
    .filter((m) => !cls.allowed?.(m[0])).length;
}

/** The tree row's corpus and the branch row's, per class (see `match`). */
const treeCorpusOf = (cls: ForbiddenClass): CorpusFile[] => (cls.match ? CORPUS_WITH_SELF : CORPUS);
const branchCorpusOf = (cls: ForbiddenClass): CorpusFile[] => (cls.match ? NET_ADDED_CORPUS : HISTORY_CORPUS);

describe('the corpus this walks', () => {
  it('registers exactly eight forbidden classes', () => {
    // A loop-generated describe disappears with a deleted row, so this is the
    // permanent registration pin for each class the ratchet claims to carry.
    // Eight: eight, less the two classes made only of base64 literals, plus the
    // hashed class that replaced them and the private tracker id class (D-5878).
    expect(FORBIDDEN).toHaveLength(8);
    // D-5878: the newest class, pinned by name so a rename cannot drop it.
    expect(FORBIDDEN.map((c) => c.name)).toContain('private tracker id');
  });

  it('the fixtures are keyed by exactly the classes the module registers', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(PUBLIC_TEXT_CLASSES.map((c) => c.name).sort());
  });

  it('every class sets exactly one of pattern and match', () => {
    for (const cls of FORBIDDEN) {
      expect(Boolean(cls.pattern) !== Boolean(cls.match), `${cls.name} sets both or neither`).toBe(true);
    }
  });

  it('actually walked the tree — a scan over an empty list passes everything', () => {
    // The single-definition idiom: a moved root or a broken `git ls-files`
    // must turn THIS red rather than silently disarm every class below.
    expect(CORPUS.length).toBeGreaterThan(400);
    const files = CORPUS.map((c) => c.file);
    for (const f of ['README.md', 'CLAUDE.md', 'ccd/ccrc', 'server/src/index.ts',
      'deploy/deploy.sh', 'docs/superpowers/specs/2026-08-22-stage5-oss-polish-design.md',
      'server/test/fixtures/panes/ask-user-question-real.txt']) {
      expect(files, f).toContain(f);
    }
  });

  it('every class states a remedy a stranger can act on', () => {
    // `why` is rendered into the failure message, so it is the entire
    // instruction someone gets at 2am when the ratchet reds on their branch.
    // A class added with `why: 'no'` is a class nobody can clear.
    for (const cls of FORBIDDEN) {
      expect(cls.why.length, `${cls.name}'s \`why\` is too short to act on`).toBeGreaterThan(30);
    }
    // …and no two classes share one. A `why` copied from the row above is how
    // a class ends up telling somebody to fix the wrong thing.
    const whys = FORBIDDEN.map((c) => c.why);
    expect(new Set(whys).size, 'two classes share a `why`').toBe(whys.length);
  });

  it('excludes exactly this file and the binary extensions, nothing else', () => {
    const files = CORPUS.map((c) => c.file);
    expect(files).not.toContain(SELF);
    for (const f of files) {
      expect(BINARY_EXT.has(path.extname(f)), `${f} is binary-extensioned yet scanned`).toBe(false);
    }
    // …and the exclusion is not covering for a rename: the file this suite
    // excludes is the file it lives in.
    expect(path.relative(root, fileURLToPath(import.meta.url))).toBe(SELF);
  });

  it('the path corpus reaches even the files whose CONTENTS are excluded', () => {
    // D-207: the content walk's two escapes (SELF, binary extensions) are
    // byte-arguments, so the path corpus must cover MORE than CORPUS does —
    // this suite's own path included.
    const paths = PATH_CORPUS.map((c) => c.file);
    expect(paths).toContain(SELF);
    expect(paths.length).toBeGreaterThanOrEqual(CORPUS.length);
  });
});

describe('the published history, not just the tip', () => {
  it('resolved a base to measure against — a missing one is RED, never vacuous', () => {
    expect(HISTORY_BASE,
      'no $CCRC_HISTORY_BASE or origin/main resolved (D-2732 removed the local-main fallback, which was a fossil): a shallow checkout cannot guard history, and this refuses to report a range nobody measured')
      .not.toBeNull();
  });

  it('demonstrates the blindness it closes — a clean tip over a dirty history', () => {
    // The guard on the guard, and the only row that proves the two walks are
    // DIFFERENT. A throwaway repo whose final tree is clean and whose middle
    // commit is not: the tip walk passes it, the range walk must not. If these
    // two ever agree, this file has stopped measuring anything.
    //
    // Fixture HOME discipline: git runs with both config scopes pointed at
    // /dev/null and identity supplied per-process, so this can neither read
    // nor write the developer's real git config.
// RESOLVED — see tmpHelpers' mkTmp: on macOS the temp root lives under a
// symlink (/var -> /private/var), and ccd resolves paths deliberately, so an
// unresolved fixture path compares two spellings of one directory.
    const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'ccrc-hist-')));
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
      };
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: tmp, stdio: 'pipe', env });
      };
      const stage = (body: string): void => {
        writeFileSync(path.join(tmp, 'f.md'), body);
        git('add', '-A');
      };
      git('init', '-q', '-b', 'main');
      stage('nothing here\n');
      git('commit', '-qm', 'base');
      const planted = FORBIDDEN[0].catches[0];
      stage(`a line carrying ${planted} in prose\n`);
      git('commit', '-qm', 'dirty middle');
      stage('nothing here again\n');
      git('commit', '-qm', 'clean tip');

      // The tip walk over that repo: blind, by construction.
      const tip: CorpusFile[] = [{
        file: 'f.md',
        lines: readFileSync(path.join(tmp, 'f.md'), 'utf8').split('\n'),
      }];
      expect(violationsOf(FORBIDDEN[0], tip),
        'the tip walk should see nothing here — that blindness IS the gap').toEqual([]);

      // The range walk over the same three commits: not blind.
      const found = violationsOf(FORBIDDEN[0], rangeCorpus(tmp, 'main~2..main'));
      expect(found.length, `the range walk missed the planted ${planted}`).toBeGreaterThan(0);
      expect(found.join('\n')).toContain(planted);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

for (const cls of FORBIDDEN) {
  describe(`forbidden class: ${cls.name}`, () => {
    it(`the pattern is alive — it scores each synthetic token (${cls.why})`, () => {
      for (const token of cls.catches) {
        expect(scoresOn(cls, token), `pattern went vacuous for: ${token}`).toBeGreaterThan(0);
      }
    });

    it('and admits exactly the documented placeholders', () => {
      for (const token of cls.passes) {
        expect(scoresOn(cls, token), `placeholder now scores: ${token}`).toBe(0);
      }
    });

    it('the scan itself is alive — a synthetic corpus yields its work-list row', () => {
      // Through violationsOf, not scoresOn: this is the row that goes red if
      // the tree scan is neutered (the push deleted, an early return added)
      // while every pattern stays healthy. It also pins the work-list format
      // sweep tasks read.
      // The synthetic file sits under server/ so it stays inside any scope
      // a class could carry — while Tasks 3/4/5 ran scoped, both the
      // exclusion-scoped classes (CGNAT) and the inclusion-scoped one
      // (tailnet name) reached it, so a scope predicate could not quietly
      // blind this liveness row; no class is scoped since Task 8.
      const synthetic: CorpusFile[] = [
        { file: 'server/synthetic.md', lines: [`a line carrying ${cls.catches[0]} in prose`] },
      ];
      // A hashed class names its entry, never the text: the leak pin is the
      // second assertion, because CI logs on a public repository are public.
      const found = violationsOf(cls, synthetic);
      if (cls.match) {
        expect(found).toEqual([`server/synthetic.md:1 #${CANARY_H8}`]);
        expect(found.join('\n')).not.toContain(cls.catches[0]);
      } else {
        expect(found).toEqual([`server/synthetic.md:1: ${cls.catches[0]}`]);
      }
    });

    it('nothing in the tree speaks it', () => {
      expect(violationsOf(cls, treeCorpusOf(cls))).toEqual([]);
    });

    it('and nothing this branch ADDS speaks it (every blob of the range; a hashed class: its net added lines)', () => {
      // D-208: the rows above pass over a branch whose MIDDLE commits are
      // dirty. This one reads every blob `<base>..HEAD` introduces, so a token
      // added and later removed still reds the branch that would publish it.
      // The hashed class reads the branch's NET added lines instead
      // (`netAddedCorpus` says why).
      expect(violationsOf(cls, branchCorpusOf(cls))).toEqual([]);
    });

    it('and no tracked path is NAMED after it', () => {
      // D-207: the pseudo-line rides the same violationsOf machinery as the
      // content scan, so the liveness rows above cover this walk too — a
      // neutered violationsOf reds them before it could quietly green this.
      expect(violationsOf(cls, PATH_CORPUS)).toEqual([]);
    });
  });
}

describe('the hashed class: its entries, its exemptions, its branch corpus', () => {
  it('opens with the canary, then entries sorted, none repeated, each well formed', () => {
    // `hash --list` prints exactly this order; a hand-edited row shows here.
    expect(PRIVATE_NAMES[0]).toEqual(entryOf(CANARY, 'part'));
    const rest = PRIVATE_NAMES.slice(1).map(entryKey);
    expect(rest).toEqual([...rest].sort());
    expect(new Set(rest).size).toBe(rest.length);
    for (const e of PRIVATE_NAMES) {
      expect(e.h).toMatch(/^[0-9a-f]{32}$/);
      expect(e.f).toMatch(/^[0-9a-f]{32}$/);
      expect(MODES).toContain(e.mode);
      expect(Number.isInteger(e.n) && e.n >= 1, `n is ${e.n}`).toBe(true);
      if (e.n === 1) expect(e.f, 'a one-token entry is its own first token').toBe(e.h);
    }
  });

  it('prints a path with each hit masked, and reads a phrase broken across a line', () => {
    const cls = FORBIDDEN.find((c) => c.match)!;
    const synthetic: CorpusFile[] = [{ file: `server/${CANARY}.md`, lines: [`a line carrying ${CANARY}`, 'and none'] }];
    const found = violationsOf(cls, synthetic);
    expect(found).toEqual([`server/#${CANARY_H8}.md:1 #${CANARY_H8}`]);
    expect(found.join('\n')).not.toContain(CANARY);
    // The scan reads a phrase across a line break through `violationsOf`: the
    // class with a synthetic phrase in place of its entries, so a deleted
    // pair loop reds here.
    const phrase = entriesOf('zed quux', 'words');
    const probe: ForbiddenClass = { ...cls, match: (line, file) => hitsIn(line, file, phrase),
      matchPair: (prev, line, file) => pairHits(prev, line, file, phrase) };
    expect(violationsOf(probe, [{ file: 'server/synthetic.md', lines: ['written by Zed', 'Quux on Monday'] }]))
      .toEqual([`server/synthetic.md:1 #${phrase[0]!.h.slice(0, 8)}`]);
  });

  it('keeps its exemptions at three or fewer', () => {
    // Each exemption is a hole in the class; a fourth must be argued into this
    // pin as well as into private-names.mjs, not waved through in review.
    expect(EXEMPTIONS.length).toBeLessThanOrEqual(3);
  });

  it('charges a branch only for the lines its tip adds', () => {
    // A throwaway repo, the fixture discipline of the blindness row above: both
    // config scopes at /dev/null, identity per process.
    const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), 'ccrc-net-')));
    try {
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
        GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
        GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
      };
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: tmp, stdio: 'pipe', env });
      };
      const commit = (file: string, body: string, msg: string): void => {
        execFileSync('mkdir', ['-p', path.dirname(path.join(tmp, file))]);
        writeFileSync(path.join(tmp, file), body);
        git('add', '-A');
        git('commit', '-qm', msg);
      };
      const cls = FORBIDDEN.find((c) => c.match)!;
      git('init', '-q', '-b', 'main');
      commit('f.md', 'nothing here\n', 'base');

      // Added by the middle commit and removed by the last: the tip adds nothing.
      git('checkout', '-q', '-b', 'cleared', 'main');
      commit('f.md', `a line carrying ${CANARY} in prose\n`, 'dirty middle');
      commit('f.md', 'nothing here again\n', 'clean tip');
      expect(violationsOf(cls, netAddedCorpus(tmp, 'main'))).toEqual([]);

      // Still added at the tip: exactly one row, at its line in the tip.
      git('checkout', '-q', '-b', 'dirty', 'main');
      commit('f.md', `nothing here\na line carrying ${CANARY} in prose\n`, 'dirty tip');
      expect(violationsOf(cls, netAddedCorpus(tmp, 'main'))).toEqual([`f.md:2 #${CANARY_H8}`]);

      // Added to this suite's own path: SELF's lines are the tree row's to read.
      git('checkout', '-q', '-b', 'self', 'main');
      commit(SELF, `a line carrying ${CANARY} in prose\n`, 'self');
      expect(violationsOf(cls, netAddedCorpus(tmp, 'main'))).toEqual([]);

      // Paths git decorates in a diff header: a space (a trailing TAB) and a
      // quote (C-quoted). Both are still read, at their own names.
      git('checkout', '-q', '-b', 'names', 'main');
      commit('a b.md', `${CANARY}\n`, 'space');
      commit('q"x.md', `${CANARY}\n`, 'quote');
      expect(violationsOf(cls, netAddedCorpus(tmp, 'main')).sort())
        .toEqual([`a b.md:1 #${CANARY_H8}`, `q"x.md:1 #${CANARY_H8}`]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
