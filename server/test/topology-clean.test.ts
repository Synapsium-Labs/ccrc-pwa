// The topology-clean RATCHET (Stage 5, spec §3): the tree is owner-agnostic
// and box-agnostic, and this suite is the mechanism that keeps it so — the
// 2026-08-22 sensitive-info scan cleared these classes, and reintroduction
// ANYWHERE a `git ls-files` walk reaches (code, test, doc, fixture) is a red
// build. Each sweep task of the stage ADDS its pattern class to `FORBIDDEN`
// red-first, sweeps the tree to green, and the class can never return; the
// pre-flip re-scan is then confirmation, not the mechanism.
//
// The one subtlety spec §3 settles: a suite that spelled the forbidden tokens
// verbatim would itself publish them. So every class forbids by PATTERN —
// a shape, plus the committed placeholders the docs are allowed to speak in —
// and never names a real host, address or id. The synthetic tokens in each
// class's `catches` list live only in THIS file, which the walk excludes by
// path; rename this file and the walk scans it, its own fixtures score, and
// the suite goes loudly red until `SELF` is updated — a safe failure mode,
// left deliberately.
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
// in README.md), suite green on revert.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const trackedFiles: string[] = execFileSync('git', ['ls-files', '-z'], {
  cwd: root, maxBuffer: 64 * 1024 * 1024,
})
  .toString('utf8').split('\0').filter(Boolean)
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

/** One forbidden class. Later stage-5 tasks APPEND to `FORBIDDEN` — the
 *  table is the ratchet's whole registration surface. */
interface ForbiddenClass {
  /** the slug the red output carries */
  name: string;
  /** applied per LINE; must carry the `g` flag (matchAll requires it) */
  pattern: RegExp;
  /** why this class can never return */
  why: string;
  /** files the class does not (yet) reach — sweep tasks land scoped
   *  (`!file.startsWith('docs/')`) and Task 8 drops the scope. Absent means
   *  the whole corpus. */
  scope?: (file: string) => boolean;
  /** lines the class does not read at all — the narrowest escape there is,
   *  and each one is argued where it is written */
  skipLine?: (line: string, file: string) => boolean;
  /** the documented placeholder vocabulary — a token this admits is not a
   *  violation. Never a file path. */
  allowed?: (token: string) => boolean;
  /** liveness fixtures: each must score a violation on a synthetic line —
   *  the guard on the guard, so a pattern edit that goes vacuous turns its
   *  own row red instead of the tree scan quietly green. The FIRST entry is
   *  the mutation-ceremony token. */
  catches: string[];
  /** and each of these must NOT score — the placeholders and carve-outs,
   *  pinned so a pattern edit cannot silently widen into them either */
  passes: string[];
}

/** The committed EXAMPLE session id — the one `session_01…`-shaped literal
 *  the tree may speak (`server/test/fixtures/panes/ask-user-question-real.txt`
 *  renders it; the stage-5 plan quotes it). 23 alnum after the prefix where a
 *  real id carries 22, which is why the pattern is greedy + equality here
 *  rather than the plan's `{22}` exact (D-190) — an exact-22 match would
 *  extract this example's own first 22 characters and flag the example as a
 *  leak. The run length is `{10,}` rather than `{22,}`: a TRUNCATED id, half
 *  pasted out of a log or an error message, still names the account it came
 *  from, and greedy-plus-equality keeps the committed example green either
 *  way. Nothing shorter than 10 is id-shaped enough to matter (D-201,
 *  superseding D-190's run length; the greedy+equality shape it argued for
 *  is unchanged). */
const EXAMPLE_SESSION_ID = 'session_01EXAMPLEEXAMPLEEXAMPLE00';

/** The duckdns placeholder vocabulary (D-189 — the shipped set, not the
 *  plan's draft): `mybox`/`otherbox`/`fixture`/`subdomain` are the
 *  documentation and fixture names; `www` is DuckDNS's OWN update endpoint
 *  (`https://www.duckdns.org/update?…`), load-bearing in the shipped
 *  `deploy/systemd/ccrc-ddns.service` and pinned verbatim by
 *  `ccrc-expose.test.ts` — a service hostname, not anybody's box name.
 *  Bracket placeholders (`<sub>.duckdns.org`, `<name>.duckdns.org`) need no
 *  entry: the `>` breaks adjacency with `.duckdns.org`, so the pattern never
 *  matches them at all — pinned in `passes` below. */
const DUCKDNS_PLACEHOLDERS = new Set(['mybox', 'otherbox', 'fixture', 'subdomain', 'www']);

/** The reference fleet's own two name tokens — its tailnet's DNS label and
 *  its server host's name — BASE64-ENCODED, spec §3's residue idiom: a
 *  pattern can say `*.ts.net` without naming anybody, but these two are
 *  concrete values a pattern cannot express, and a suite that spelled them
 *  verbatim would itself publish the strings it exists to hunt. Encoding
 *  breaks casual greppability; the values are already public-by-ruling in
 *  the retained commit-author history, so this is noise-prevention, not
 *  secrecy. Decoded once, fed to the pattern and the liveness fixtures. */
const TAILNET_RESIDUE: string[] = ['dGFpbDMzZjExYw==', 'Y2xhdWRlLXJj']
  .map((b) => Buffer.from(b, 'base64').toString('utf8'));

/** Task 4's scope: the runtime tree — code, tests, executables, deploy and
 *  scripts — plus install.sh. The docs corpus (docs/, README.md, CLAUDE.md,
 *  scratch/, .github/) waits for Task 8, for D-193's reason: the gitignored
 *  operator file that keeps the real reach values must exist BEFORE the
 *  tree-wide sweep erases them, and scratch/ is pruned whole, not sanitised. */
const RUNTIME_ROOTS = ['server/', 'agent/', 'pwa/', 'shared/', 'ccd/', 'deploy/', 'scripts/'];

const FORBIDDEN: ForbiddenClass[] = [
  {
    name: 'public IPv4',
    // Any dotted quad OUTSIDE: RFC 1918 (10/8, 172.16/12, 192.168/16),
    // loopback (127/8), CGNAT (100.64/10 — Task 3 adds that range as its own
    // class; this one deliberately leaves it), the RFC 5737 documentation
    // ranges (192.0.2/24, 198.51.100/24, 203.0.113/24 — the ONLY ranges a
    // doc example may speak), and 0/8. A public address in this tree is
    // somebody's real box.
    pattern: /\b(?!(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])|203\.0\.113|198\.51\.100|192\.0\.2|0)\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    why: 'a public IP names a reachable machine — examples speak RFC 5737, fixtures speak RFC 1918',
    // package-lock.json's "version"/"resolved" lines carry npm's own dotted
    // strings, none of them addresses; nothing else gets the line skip.
    skipLine: (line, file) =>
      file.endsWith('package-lock.json') &&
      (line.includes('"version"') || line.includes('"resolved"')),
    catches: ['1.2.3.4', '100.200.0.1', '172.32.0.1'],
    passes: ['203.0.113.7', '198.51.100.7', '192.0.2.1', '10.1.2.3', '127.0.0.1',
      '192.168.7.7', '172.31.255.1', '100.100.1.1', '0.0.0.0'],
  },
  {
    name: 'claude.ai session id',
    // The shape of a real session id: `session_01` + 22+ base62. Greedy so
    // the 23-character committed EXAMPLE matches WHOLE and the equality
    // below can admit it — see EXAMPLE_SESSION_ID's docstring.
    pattern: /session_01[A-Za-z0-9]{10,}/g,
    why: 'a real session id is a pointer into somebody\'s claude.ai account — only the committed EXAMPLE may appear',
    allowed: (token) => token === EXAMPLE_SESSION_ID,
    // Constructed, not spelled: a verbatim 24-char id-shaped literal in this
    // file would be exactly the noise the suite exists to prevent.
    catches: ['session_01' + 'A'.repeat(22)],
    passes: [EXAMPLE_SESSION_ID],
  },
  {
    name: 'CGNAT tailnet IP',
    // 100.64/10 (RFC 6598) is the range tailscale hands out, so every dotted
    // quad in it names some real tailnet's box — the reference fleet's own
    // addresses lived here until Task 3 swept them. The public-IPv4 class
    // above deliberately excludes this range; this class owns it.
    pattern: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
    why: 'a CGNAT 100.64/10 literal is a real tailnet box — fixtures speak 203.0.113.x, or the one documented placeholder',
    // Task 3 lands SCOPED (D-193): the docs corpus is Task 8/9's sweep, which
    // FIRST moves the real values into gitignored deploy/reference-fleet.md
    // so operations lose nothing, and then drops this scope. The plan's own
    // predicate said `!docs/` alone, but README.md, CLAUDE.md and scratch/
    // sit outside docs/ while their sweep is owned by Tasks 8-9 — scrubbing
    // them here would erase the operator's reach values before the file that
    // keeps them exists (and pre-empt Task 8's prune of scratch/).
    scope: (file) => !file.startsWith('docs/') && !file.startsWith('scratch/')
      && file !== 'README.md' && file !== 'CLAUDE.md',
    // The ONE sanctioned CGNAT literal (D-193): `_dr_ip4_global`'s whole
    // point is classifying this range, so ccrc-doctor.test.ts's CGNAT-arm
    // fixture cannot speak 203.0.113.x — the class admits exactly one
    // obviously-synthetic placeholder instead. It is nobody's box: CGNAT
    // addresses are not publicly routable, so the leak this class prevents
    // is fleet topology, which a fixed placeholder does not carry.
    allowed: (token) => token === '100.100.1.1',
    catches: ['100.64.7.7', '100.127.3.4', '100.100.1.2'],
    passes: ['100.100.1.1', '100.63.0.1', '100.128.0.1', '203.0.113.7', '10.64.0.1'],
  },
  {
    name: 'tailnet name',
    // Any `<label>.ts.net` name plus the reference fleet's two bare tokens
    // (TAILNET_RESIDUE — base64-argued above). A tailnet DNS name locates a
    // real box on a real person's tailnet; examples speak `mybox.example.com`
    // (the plan's rpId vocabulary — a `.ts.net` placeholder would match this
    // very ban), and prose that needs the tailnet SHAPE speaks bracket forms
    // (`<tailnet>.ts.net`), which the `>` keeps out of the pattern's reach.
    // Bare `ts.net` stays legal: it is the PUBLIC SUFFIX, load-bearing in
    // webauthn.ts's PUBLIC_SUFFIX_TRAPS and every PSL discussion.
    pattern: new RegExp(`[a-z0-9-]+\\.ts\\.net|${TAILNET_RESIDUE.join('|')}`, 'g'),
    why: 'a tailnet DNS name or a reference-fleet host token locates somebody\'s real box — say mybox.example.com, or a role name',
    // Task 4 lands SCOPED to the runtime tree; Task 8 drops the scope with
    // the rest (see RUNTIME_ROOTS' docstring).
    scope: (file) => RUNTIME_ROOTS.some((p) => file.startsWith(p)) || file === 'install.sh',
    catches: ['fixture-box.ts.net', TAILNET_RESIDUE[0]!, TAILNET_RESIDUE[1]!],
    passes: ['mybox.example.com', 'ts.net', '*.ts.net', '<tailnet>.ts.net',
      '<other-box>.<tailnet>.ts.net', 'tailscale.net'],
  },
  {
    name: 'duckdns subdomain',
    // DuckDNS names are claimed by a person — any subdomain outside the
    // placeholder vocabulary is somebody's real, resolvable box.
    pattern: /[a-z0-9-]+\.duckdns\.org/g,
    why: 'a duckdns subdomain resolves to somebody\'s real box — docs and fixtures speak mybox/otherbox/fixture/subdomain',
    allowed: (token) => DUCKDNS_PLACEHOLDERS.has(token.replace(/\.duckdns\.org$/, '')),
    catches: ['realbox.duckdns.org'],
    passes: ['mybox.duckdns.org', 'otherbox.duckdns.org', 'fixture.duckdns.org',
      'subdomain.duckdns.org', 'www.duckdns.org', '<sub>.duckdns.org', '<name>.duckdns.org'],
  },
];

/** The scan: every violation as `file:line: token` — when a sweep task lands
 *  its class red-first, this list IS the work-list. The corpus parameter
 *  exists for the liveness rows below: `scoresOn` proves a PATTERN is alive,
 *  but only a call through THIS function proves the scan is — a neutered
 *  `violationsOf` returns `[]` and every tree test stays green, so each class
 *  pins it against a one-file synthetic corpus. */
function violationsOf(cls: ForbiddenClass, corpus: CorpusFile[] = CORPUS): string[] {
  const out: string[] = [];
  for (const { file, lines } of corpus) {
    if (cls.scope && !cls.scope(file)) continue;
    lines.forEach((line, i) => {
      if (cls.skipLine?.(line, file)) return;
      for (const m of line.matchAll(cls.pattern)) {
        if (cls.allowed?.(m[0])) continue;
        out.push(`${file}:${i + 1}: ${m[0]}`);
      }
    });
  }
  return out;
}

/** What a class would say about one synthetic line — the liveness harness. */
function scoresOn(cls: ForbiddenClass, token: string): number {
  return [...`a line carrying ${token} in prose`.matchAll(cls.pattern)]
    .filter((m) => !cls.allowed?.(m[0])).length;
}

describe('the corpus this walks', () => {
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

    it('the scan itself is alive — a synthetic corpus yields the file:line: token row', () => {
      // Through violationsOf, not scoresOn: this is the row that goes red if
      // the tree scan is neutered (the push deleted, an early return added)
      // while every pattern stays healthy. It also pins the work-list format
      // sweep tasks read.
      // The synthetic file sits under server/ so it is inside EVERY class's
      // scope — the exclusion-scoped classes (CGNAT) admit it and the
      // inclusion-scoped ones (tailnet name) reach it, so a scope predicate
      // cannot quietly blind this liveness row.
      const synthetic: CorpusFile[] = [
        { file: 'server/synthetic.md', lines: [`a line carrying ${cls.catches[0]} in prose`] },
      ];
      expect(violationsOf(cls, synthetic)).toEqual([`server/synthetic.md:1: ${cls.catches[0]}`]);
    });

    it('nothing in the tree speaks it', () => {
      expect(violationsOf(cls)).toEqual([]);
    });
  });
}
