// server/test/ccd-reg-id-ok.test.ts
//
// `_reg_id_ok`, THE ONE RULE FOR AN ID A VERB MAY BIND (path-identity spec §2.4). A dash-leading word is a flag
// spelling: every decision flag the server appends after an id begins `--`, so an id that spells one is how a verb
// came to act on the session the flag's VALUE names (spec §2.1, §2.2). This file pins the helper alone, as a truth
// table through the sourced ccd. The verbs that call it are pinned in their own files.
//
// What it must NOT refuse is pinned beside what it must: a dot-leading id still passes, because the dot rule
// belongs to the token verbs and their audits (spec §2.6), and the `--session` verbs keep accepting what they
// accept today.
//
// FIXTURE HOME ONLY: one `makeCcdHarness` HOME for the whole file. Nothing here writes a row or runs a verb.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { DASH_IDS, wideLetterLocale } from './dashIdFixture.js';

/** The definition line's shape, with or without the `function` keyword. A call never carries the parentheses. */
const REG_ID_OK_DEF = /^\s*(?:function\s+)?_reg_id_ok\s*\(\s*\)/;
const ccdLines = (): string[] => fs.readFileSync(CCD, 'utf8').split('\n');
/** One shell word, single-quoted. */
const sq = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

describe('_reg_id_ok: the id a verb may bind is never dash-leading (path-identity spec §2.4)', () => {
  let h: CcdHarness;
  beforeAll(() => { h = makeCcdHarness('ccrc-reg-id-ok-'); });
  afterAll(() => { h.cleanup(); });

  /** `_reg_id_ok`'s rc for each word, keyed by the word. ONE sourced shell answers them all; `pre` runs first. */
  const rcOf = (words: readonly string[], pre = ''): Record<string, number> => {
    const out = h.sh(`${pre} for w in ${words.map(sq).join(' ')}; do _reg_id_ok "$w"; printf '%s\\n' "$?"; done`);
    const rcs = out === '' ? [] : out.split('\n');
    expect(rcs, `one rc line per word, and nothing else on stdout:\n${out}`).toHaveLength(words.length);
    return Object.fromEntries(words.map((w, i) => [w, Number(rcs[i])]));
  };
  const each = (words: readonly string[], rc: number): Record<string, number> =>
    Object.fromEntries(words.map((w) => [w, rc]));

  it('accepts every id ccd mints', () => {
    // `claude-a-demo` is the harness roster's wrapper plus a project, as `ccd-workspaces.test.ts` composes it.
    // `a--b` is an inner double dash, which a wrapper ending in `-` may legally compose.
    const MINTED = ['demo-quiet-basin', 'claude-a-demo', 'p.v2-quiet-mesa', 'a--b'];
    expect(rcOf(MINTED)).toEqual(each(MINTED, 0));
  });

  it('refuses every flag spelling the server\'s builders append', () => {
    const FLAGS = [...DASH_IDS, '-', '-x'];
    expect(rcOf(FLAGS)).toEqual(each(FLAGS, 1));
  });

  it('refuses what the registry charset refuses', () => {
    // A control byte is outside the charset too, a trailing newline included: bash's `=~` anchors `$` at the end of
    // the word, never before a final newline. The bytes are built with String.fromCharCode, so no escape is decoded.
    const ctl = (code: number): string => String.fromCharCode(code);
    const OUTSIDE = ['', 'a/b', 'a b', 'a=b', `demo-quiet-basin${ctl(10)}`, `demo${ctl(9)}quiet`, `demo${ctl(27)}[0m`];
    expect(rcOf(OUTSIDE)).toEqual(each(OUTSIDE, 1));
    // No argument at all is refused too. Under ccd's own `set -u` the helper neither dies nor prints: it is a
    // predicate, and every caller writes its own refusal.
    expect(h.sh(`_reg_id_ok; printf '%s' "$?"`), 'no argument').toBe('1');
    expect(h.sh(`{ _reg_id_ok --actor; _reg_id_ok demo-quiet-basin; _reg_id_ok ''; _reg_id_ok; } 2>&1; printf '%s' alive`),
      'it printed something, or a call ended the shell').toBe('alive');
  });

  it('accepts a dot-leading id: the dot rule belongs to the token verbs alone', () => {
    // The token verbs and their audits refuse a dot-leading id at their own entries (spec §2.6). Folding that rule
    // in here would narrow the `--session` verbs, which accept `.hidden` today.
    expect(rcOf(['.hidden'])).toEqual({ '.hidden': 0 });
  });

  it('refuses a non-ASCII letter even under a locale whose ranges admit it', (ctx) => {
    const loc = wideLetterLocale(h);
    if (loc === '') { ctx.skip(); return; }
    const pre = `LC_ALL=${loc};`;
    expect(h.sh(`${pre} [[ 'é-x' =~ ^[A-Za-z0-9._-]+$ ]]; printf '%s' "$?"`),
      `CONTROL: under ${loc} the bare charset admits é-x, so this row can see the shadow`).toBe('0');
    expect(rcOf(['é-x'], pre)).toEqual({ 'é-x': 1 });
  });

  it('carries local LC_ALL=C in its own body', () => {
    // BEHAVIOUR FIRST, and soft, so a non-local shadow reports its leak beside the text pin below. The property is
    // that the caller's locale is restored when the local goes out of scope: the caller keeps counting what it
    // counted (the `_lc_dec_ok` pin in `ccd-actor-flags.test.ts` has the same shape).
    const out = h.sh(`LC_ALL=C.UTF-8; s=$'caf\\u00e9'; before=\${#s}; _reg_id_ok "$s"; after=\${#s}; `
      + `printf '%s %s' "$before" "$after"`);
    const [before, after] = out.split(' ');
    expect.soft(after, 'the helper leaked its LC_ALL into the caller').toBe(before);
    expect.soft(before, 'under the locale this snippet pinned, and only there').toBe('4');
    // THE TEXT PIN: deterministic on any box, including one with no locale that widens a range.
    const defs = ccdLines().filter((l) => REG_ID_OK_DEF.test(l));
    expect(defs, 'one definition line').toHaveLength(1);
    expect(defs[0], 'the shadow is in the body, so no caller locale decides the charset').toContain('local LC_ALL=C');
  });

  it('is defined exactly once', () => {
    const ccdDir = path.dirname(CCD);
    const files = fs.readdirSync(ccdDir, { encoding: 'utf8', recursive: true })
      .map((f) => path.join(ccdDir, f))
      .filter((f) => !f.endsWith('.md') && fs.statSync(f).isFile());
    const holders = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')
      .flatMap((l, i) => (REG_ID_OK_DEF.test(l) ? [`${path.relative(ccdDir, f)}:${i + 1}`] : [])));
    expect(holders.map((x) => x.replace(/:\d+$/, '')), `definitions:\n${holders.join('\n')}`).toEqual(['ccd']);
    // WHERE: below every line the compaction-card corpus cites, and above the temp-root id predicate's comment
    // block. Later definitions of the same family may stand between the two, never above this one.
    const lines = ccdLines();
    const at = lines.findIndex((l) => REG_ID_OK_DEF.test(l));
    const above = lines.findIndex((l) => l.startsWith('_ws_tmproot_witness_file() {'));
    const below = lines.findIndex((l) => l.startsWith('# THE ID A WITNESS MAY BE NAMED FOR'));
    expect(above, 'anchor: _ws_tmproot_witness_file').toBeGreaterThan(-1);
    expect(at, 'below _ws_tmproot_witness_file').toBeGreaterThan(above);
    expect(below, 'above the temp-root id predicate\'s comment block').toBeGreaterThan(at);
  });
});
