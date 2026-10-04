// The Docs value grammars in L0 `shared/docs.ts` (design 2026-10-01, section 2 (a); mutation rows 2 and 63, their
// TypeScript halves). Each grammar is an accept/refuse corpus here. Row 2's proof that the bare-ref grammar is a
// strict subset of git runs real `git check-ref-format` over a seeded fuzz corpus, in ONE bash loop reading stdin.
// The python halves (the same corpus through ccd's helper) are `docs-parity.test.ts`'s.
//
// Every non-ASCII sample is built with `String.fromCodePoint`, so this file stays ASCII like the file it tests.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  DOC_SECTION_SLUGS, isDocsSection,
  DOCS_PROJECT_RE_BODY, DOCS_BARE_REF_RE_BODY, DOCS_REF_MAX_CHARS, DOCS_QUALIFIED_PREFIX_RE_BODY,
  DOCS_QUALIFIED_REF_RE_BODY, DOCS_SHA_RE_BODY, DOCS_FINGERPRINT_RE_BODY, DOCS_MAX_BYTES_RE_BODY,
  DOCS_SECTION_RE_BODY, DOCS_REL_PATH_RE_BODY, DOCS_PATH_EXCLUDED_CATEGORIES, DOCS_PATH_EXCLUDED_RANGES,
  DOCS_PATH_MAX_BYTES, DOCS_PATH_MAX_COMPONENT_BYTES, DOCS_PATH_MAX_DEPTH,
  isDocsProject, isDocsBareRef, isDocsQualifiedRef, isDocsCommit, isDocsRelPath, isDocsFingerprint, isDocsMaxBytes,
  parseDocsRef, docsRefText, type DocsRefSpec,
} from '../../shared/docs.js';

/** The matcher shape `shared/docs.ts` builds, rebuilt here only to run a body this file has edited. */
const full = (body: string): RegExp => new RegExp('^(?:' + body + ')$', 'u');
const cp = (n: number): string => String.fromCodePoint(n);
/** A sample as a readable label: non-ASCII code points as U+XXXX, long runs shortened. */
const label = (s: string): string => {
  const shown = [...s].map((c) => {
    const n = c.codePointAt(0) ?? 0;
    return n >= 0x20 && n < 0x7f ? c : `<U+${n.toString(16).toUpperCase().padStart(4, '0')}>`;
  }).join('');
  return shown.length > 60 ? `${shown.slice(0, 40)}... (${s.length} units)` : shown;
};
const name = (n: number): string => 'a'.repeat(n);

const H40 = '0123456789abcdef'.repeat(3).slice(0, 40);
const H64 = '0123456789abcdef'.repeat(4);

describe('the project grammar', () => {
  const ACCEPT = ['demo', 'example-project', '_a', 'a.b-c_d', '0', name(100)];
  const REFUSE = ['', '..', '.', '.git', 'a/b', '-x', 'a b', name(101), cp(0xe9)];

  it.each(ACCEPT.map((s) => [label(s), s]))('accepts %s', (_l, s) => expect(isDocsProject(s)).toBe(true));
  it.each(REFUSE.map((s) => [label(s), s]))('refuses %s', (_l, s) => expect(isDocsProject(s)).toBe(false));

  it('its body is the declared literal', () => {
    expect(DOCS_PROJECT_RE_BODY).toBe('[A-Za-z0-9_][A-Za-z0-9._-]{0,99}');
  });
});

describe('the bare-ref grammar', () => {
  const ACCEPT = ['main', 'ws/foo', 'ws/a', 'HEADX', 'a.lock.b', 'release-1.2_x', name(DOCS_REF_MAX_CHARS)];
  const REFUSE = [
    '-x', 'main~1', 'main:docs', 'a..b', 'x.lock/y', 'x.lock', 'HEAD', 'refs/tags/v', 'refs/heads/x', cp(0xe9),
    '@{-1}', 'a/', '/a', 'a.', 'a/.b', 'a//b', '', 'a b', 'a*b', 'a^b', name(DOCS_REF_MAX_CHARS + 1),
  ];

  it.each(ACCEPT.map((s) => [label(s), s]))('accepts %s', (_l, s) => expect(isDocsBareRef(s)).toBe(true));
  it.each(REFUSE.map((s) => [label(s), s]))('refuses %s', (_l, s) => expect(isDocsBareRef(s)).toBe(false));

  it('bounds a name at 200 characters', () => {
    expect(DOCS_REF_MAX_CHARS).toBe(200);
  });
});

describe('the qualified-ref grammar', () => {
  const ACCEPT = [
    'refs/heads/x', 'refs/heads/ws/a', 'refs/remotes/origin/x', 'refs/remotes/origin/x/y',
    'refs/heads/' + name(DOCS_REF_MAX_CHARS),
  ];
  /** In the qualified body's own language, refused only by the bound on the branch part. */
  const OVER = 'refs/heads/' + name(DOCS_REF_MAX_CHARS + 1);
  const REFUSE = [
    'refs/remotes/upstream/x', 'refs/tags/x', 'refs/heads/', 'refs/remotes/origin/', 'refs/heads/HEAD',
    'refs/heads/refs/x', 'refs/heads/a..b', 'refs/heads//x', 'refs/heads/-x', 'x', 'ws/a', 'refs/remotes/x', OVER,
  ];

  it.each(ACCEPT.map((s) => [label(s), s]))('accepts %s', (_l, s) => expect(isDocsQualifiedRef(s)).toBe(true));
  it.each(REFUSE.map((s) => [label(s), s]))('refuses %s', (_l, s) => expect(isDocsQualifiedRef(s)).toBe(false));

  it('the 200-character bound applies to the branch part, not to the whole ref', () => {
    const longest = 'refs/remotes/origin/' + name(DOCS_REF_MAX_CHARS);
    expect(longest.length).toBeGreaterThan(DOCS_REF_MAX_CHARS);
    expect(isDocsQualifiedRef(longest)).toBe(true);
  });

  it('the qualified body is the prefix body plus the bare body, and its whole match agrees with the predicate', () => {
    expect(DOCS_QUALIFIED_PREFIX_RE_BODY).toBe('(?:refs/heads/|refs/remotes/origin/)');
    expect(DOCS_QUALIFIED_REF_RE_BODY).toBe(DOCS_QUALIFIED_PREFIX_RE_BODY + DOCS_BARE_REF_RE_BODY);
    const re = full(DOCS_QUALIFIED_REF_RE_BODY);
    // The bound is a length check beside the body, so the one case past it is compared on its own.
    for (const s of [...ACCEPT, ...REFUSE].filter((x) => x !== OVER)) expect(re.test(s), label(s)).toBe(isDocsQualifiedRef(s));
    expect(re.test(OVER)).toBe(true);
  });
});

describe('the commit, fingerprint and max-bytes grammars', () => {
  it('a commit is lowercase hex of exactly 40 or 64 characters', () => {
    for (const s of [H40, H64]) expect(isDocsCommit(s), s).toBe(true);
    for (const s of [H40.slice(1), H40 + 'a', H64.slice(1), H64 + 'a', H40.toUpperCase(), 'g' + H40.slice(1), '',
      H40 + '\n', H40.slice(0, 7)]) {
      expect(isDocsCommit(s), label(s)).toBe(false);
    }
    expect(DOCS_SHA_RE_BODY).toBe('[0-9a-f]{40}|[0-9a-f]{64}');
  });

  it('a fingerprint is lowercase hex of exactly 64 characters', () => {
    expect(isDocsFingerprint(H64)).toBe(true);
    for (const s of [H40, H64.toUpperCase(), H64.slice(1), H64 + '0', '']) expect(isDocsFingerprint(s), label(s)).toBe(false);
    expect(DOCS_FINGERPRINT_RE_BODY).toBe('[0-9a-f]{64}');
  });

  it('max-bytes is one to eight digits with no leading zero', () => {
    for (const s of ['1', '9', '10', '2097152', '12345678', '99999999']) expect(isDocsMaxBytes(s), s).toBe(true);
    for (const s of ['0', '012', '123456789', '', '-1', '1e6', ' 1', '1.0', '1\n']) expect(isDocsMaxBytes(s), label(s)).toBe(false);
    expect(DOCS_MAX_BYTES_RE_BODY).toBe('[1-9][0-9]{0,7}');
  });
});

describe('the section grammar', () => {
  it('is generated from DOC_SECTIONS and agrees with isDocsSection', () => {
    expect(DOCS_SECTION_RE_BODY).toBe('specs|plans|product-design|conventions');
    expect(DOCS_SECTION_RE_BODY).toBe(DOC_SECTION_SLUGS.join('|'));
    const re = full(DOCS_SECTION_RE_BODY);
    for (const s of [...DOC_SECTION_SLUGS, 'Specs', 'spec', 'specsx', 'plans|specs', 'product', '']) {
      expect(re.test(s), s).toBe(isDocsSection(s));
    }
  });
});

describe('the relative-path grammar', () => {
  const E = cp(0xe9);           // 2 UTF-8 bytes
  const GRIN = cp(0x1f600);     // 4 UTF-8 bytes, a surrogate pair in a JS string
  const deep = (n: number): string => Array.from({ length: n }, () => 'a').join('/');
  const ACCEPT = [
    'x.md', 'a/b/c.md', '2026-10-01-design.md', '.hidden.md', 'a/..x', E + '.md', cp(0x6587) + '.md', GRIN + '.png',
    [204, 204, 204, 204, 204].map(name).join('/'),        // 1024 bytes
    [E.repeat(102), E.repeat(102), E.repeat(102), E.repeat(102), E.repeat(102)].join('/'),        // 1024 bytes, 514 code points
    name(DOCS_PATH_MAX_COMPONENT_BYTES),
    E.repeat(127) + 'a',                                   // 255 bytes, 128 code points
    GRIN.repeat(63) + 'abc',                               // 255 bytes, 66 code points
    deep(DOCS_PATH_MAX_DEPTH),
  ];
  /** Refused by a byte or depth bound alone: each is at most 1024 code points, so the grammar admits it. */
  const BOUND_REFUSED = [
    [E.repeat(102), E.repeat(102), E.repeat(102), E.repeat(102), E.repeat(102) + 'a'].join('/'),  // 1025 bytes, 515 code points
    [E.repeat(103), E.repeat(103), E.repeat(103), E.repeat(103), E.repeat(103)].join('/'),        // 1034 bytes, 519 code points
    name(DOCS_PATH_MAX_COMPONENT_BYTES + 1),
    E.repeat(128),                                         // 256 bytes, 128 code points
    GRIN.repeat(64),                                       // 256 bytes, 64 code points
    deep(DOCS_PATH_MAX_DEPTH + 1),
  ];
  const REFUSE = [
    '', '../../README.md', '..', '.', 'a/../b', 'a/./b', './a', 'a/..', 'a//b', 'a/', '/a',
    'a' + cp(0x00) + 'b', 'a' + cp(0x1f) + 'b', 'a' + cp(0x7f) + 'b', 'a' + cp(0x85) + 'b', 'a' + cp(0x9f) + 'b', 'a\nb',
    'a' + cp(0x202e) + 'b.md',
    [204, 204, 204, 204, 205].map(name).join('/'),        // 1025 bytes
    ...BOUND_REFUSED,
  ];

  it.each(ACCEPT.map((s) => [label(s), s]))('accepts %s', (_l, s) => expect(isDocsRelPath(s)).toBe(true));
  it.each(REFUSE.map((s) => [label(s), s]))('refuses %s', (_l, s) => expect(isDocsRelPath(s)).toBe(false));

  it('holds the declared bounds', () => {
    expect([DOCS_PATH_MAX_BYTES, DOCS_PATH_MAX_COMPONENT_BYTES, DOCS_PATH_MAX_DEPTH]).toEqual([1024, 255, 16]);
  });

  it('CONTROL: the bound cases are refused by the bounds, since the grammar alone admits every one of them', () => {
    const re = full(DOCS_REL_PATH_RE_BODY);
    for (const s of BOUND_REFUSED) expect(re.test(s), label(s)).toBe(true);
  });
});

describe('the path category check (row 63, TypeScript half)', () => {
  const REFUSED: readonly number[] = [
    0x200b,            // ZERO WIDTH SPACE, Cf
    0x2028, 0x2029,    // LINE and PARAGRAPH SEPARATOR, Zl and Zp
    0xe000, 0xf0000,   // private use, Co
    0x0378, 0xfdd0,    // unassigned in every Unicode version, and a noncharacter: Cn
    0xfe0f, 0xfe00,    // variation selectors (Mn), refused by the first range
    0xe0100, 0xe01ef,  // variation selectors supplement (Mn), refused by the second range
    0x061c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff,   // bidi controls and the BOM, Cf
  ];
  const ACCEPTED: readonly number[] = [0xe9, 0x6587, 0x1f600];
  const LONE_SURROGATES = [String.fromCharCode(0xd800), String.fromCharCode(0xdfff)];
  const inName = (ch: string): string => 'a' + ch + 'b.md';

  it('declares the five categories and the two selector ranges', () => {
    expect(DOCS_PATH_EXCLUDED_CATEGORIES).toEqual(['Cf', 'Zl', 'Zp', 'Co', 'Cn']);
    expect(DOCS_PATH_EXCLUDED_RANGES).toEqual([[0xfe00, 0xfe0f], [0xe0100, 0xe01ef]]);
  });

  it.each(REFUSED.map((n) => [label(cp(n)), n]))('refuses %s inside a name', (_l, n) => {
    expect(isDocsRelPath(inName(cp(n)))).toBe(false);
  });

  it.each(LONE_SURROGATES.map((s) => [label(s), s]))('refuses the lone surrogate %s', (_l, s) => {
    expect(isDocsRelPath(inName(s))).toBe(false);
  });

  it.each(ACCEPTED.map((n) => [label(cp(n)), n]))('accepts %s inside a name', (_l, n) => {
    expect(isDocsRelPath(inName(cp(n)))).toBe(true);
  });

  it('CONTROL: the grammar alone admits every refused sample, so each refusal is the category check', () => {
    const re = full(DOCS_REL_PATH_RE_BODY);
    for (const n of REFUSED) expect(re.test(inName(cp(n))), label(cp(n))).toBe(true);
    for (const s of LONE_SURROGATES) expect(re.test(inName(s)), label(s)).toBe(true);
  });

  it('CONTROL: the selectors and the lone surrogates carry no excluded category, so the ranges and Cs are load-bearing', () => {
    const cats = new RegExp('[' + DOCS_PATH_EXCLUDED_CATEGORIES.map((c) => '\\p{' + c + '}').join('') + ']', 'u');
    for (const n of [0xfe0f, 0xfe00, 0xe0100, 0xe01ef]) expect(cats.test(cp(n)), label(cp(n))).toBe(false);
    for (const s of LONE_SURROGATES) expect(cats.test(s), label(s)).toBe(false);
  });
});

describe('parseDocsRef and docsRefText', () => {
  it('classifies a bare name and a qualified ref, and answers null for anything in neither grammar', () => {
    expect(parseDocsRef('ws/foo')).toEqual({ kind: 'bare', name: 'ws/foo' });
    expect(parseDocsRef('main')).toEqual({ kind: 'bare', name: 'main' });
    expect(parseDocsRef('refs/heads/ws/foo')).toEqual({ kind: 'qualified', ref: 'refs/heads/ws/foo' });
    expect(parseDocsRef('refs/remotes/origin/main')).toEqual({ kind: 'qualified', ref: 'refs/remotes/origin/main' });
    for (const s of ['', '-x', 'HEAD', 'refs/tags/v', 'refs/remotes/upstream/x', 'a..b', '@{-1}', name(201)]) {
      expect(parseDocsRef(s), label(s)).toBeNull();
    }
  });

  it('round-trips every ref either grammar admits', () => {
    for (const s of ['main', 'ws/a', 'HEADX', 'a.lock.b', name(200), 'refs/heads/x', 'refs/remotes/origin/x/y']) {
      const spec = parseDocsRef(s);
      expect(spec, s).not.toBeNull();
      expect(docsRefText(spec as DocsRefSpec)).toBe(s);
    }
    expect(docsRefText({ kind: 'bare', name: 'ws/a' })).toBe('ws/a');
    expect(docsRefText({ kind: 'qualified', ref: 'refs/heads/ws/a' })).toBe('refs/heads/ws/a');
  });
});

describe('every predicate refuses a non-string at runtime', () => {
  // `RegExp.prototype.test` coerces: without the guard, a repeated query key (`['demo']`) tests as `demo`.
  const PREDICATES = { isDocsProject, isDocsBareRef, isDocsQualifiedRef, isDocsCommit, isDocsRelPath, isDocsFingerprint, isDocsMaxBytes, isDocsSection };
  const VALUES: unknown[] = [null, undefined, 9, ['demo'], ['specs'], ['x.md'], [H40], { toString: () => 'demo' }];

  it.each(Object.entries(PREDICATES))('%s', (_n, p) => {
    for (const v of VALUES) expect((p as (s: unknown) => boolean)(v), String(v)).toBe(false);
  });

  it('parseDocsRef answers null for one', () => {
    expect(parseDocsRef(['main'] as unknown as string)).toBeNull();
  });
});

/** mulberry32: a seeded PRNG, so the fuzz corpus is the same on every run and every box. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_ALPHABET = 'ab.-_/09@{}~^:';
/** The draw: the eight characters the grammar can accept, weighted four to one over the six it never can, so that
 *  enough of the corpus reaches the grammar's own lookaheads for the proof to say something. */
const FUZZ_DRAW = FUZZ_ALPHABET.slice(0, 8).repeat(4) + FUZZ_ALPHABET.slice(8);

function fuzzCorpus(): string[] {
  const rnd = mulberry32(0x5eed);
  const out: string[] = [];
  for (let i = 0; i < 5000; i += 1) {
    const len = 1 + Math.floor(rnd() * 12);
    let s = '';
    for (let j = 0; j < len; j += 1) s += FUZZ_DRAW.charAt(Math.floor(rnd() * FUZZ_DRAW.length));
    out.push(s);
  }
  return out;
}

/** ONE bash loop over stdin: it prints each name real git refuses as `refs/heads/<name>`. */
const GIT_REFUSALS =
  'while IFS= read -r n; do git check-ref-format "refs/heads/$n" >/dev/null 2>&1 || printf \'%s\\n\' "$n"; done';

function gitRefuses(names: readonly string[]): Set<string> {
  const r = spawnSync('bash', ['-c', GIT_REFUSALS], {
    input: names.join('\n') + '\n', encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' },
  });
  expect(r.status, r.stderr).toBe(0);
  return new Set(r.stdout.split('\n').filter((l) => l !== ''));
}

describe('row 2: the bare-ref grammar is a strict subset of git check-ref-format', () => {
  it('every fuzz string the grammar accepts passes real git; with (?!.*\\.\\.) dropped, git refuses one', () => {
    const corpus = fuzzCorpus();
    expect(corpus).toHaveLength(5000);
    expect([...new Set(corpus.join(''))].every((c) => FUZZ_ALPHABET.includes(c)), 'the corpus stays in the alphabet').toBe(true);

    const accepted = [...new Set(corpus.filter(isDocsBareRef))];
    const LOOKAHEAD = String.raw`(?!.*\.\.)`;
    expect(DOCS_BARE_REF_RE_BODY.split(LOOKAHEAD), 'the dropped lookahead occurs exactly once').toHaveLength(2);
    const widenedRe = full(DOCS_BARE_REF_RE_BODY.replace(LOOKAHEAD, ''));
    const widened = [...new Set(corpus.filter((s) => s.length <= DOCS_REF_MAX_CHARS && widenedRe.test(s)))];

    // The instrument's own control rides in the same loop: one name git refuses, one it accepts.
    const refused = gitRefuses([...new Set([...accepted, ...widened, 'a..b', 'ws/a'])]);
    expect(refused.has('a..b'), 'the loop reports a refusal').toBe(true);
    expect(refused.has('ws/a'), 'the loop reports only refusals').toBe(false);

    expect(accepted.length, 'enough distinct accepted names for the proof to say something').toBeGreaterThanOrEqual(200);
    expect(accepted.filter((s) => refused.has(s))).toEqual([]);
    expect(widened.filter((s) => refused.has(s)).length, 'CONTROL: the widened grammar admits a name git refuses')
      .toBeGreaterThan(0);
  }, 120000);
});
