// The private-name matcher's unit pins (`private-names.mjs`, the one tokenizer,
// hasher and matcher behind `topology-clean`'s hashed class and the local scan).
//
// Every token here is SYNTHETIC (`zz-…`, `zed quux`): this file is part of the
// public tree that class scans, so a real entry spelled here would be the very
// leak the class exists to stop. The entries are built the way `hash --list`
// builds them from the local list — the tokens of the text, hashed joined by
// `-`, plus the first token's own hash and the token count — so a pin that
// passes here passes for the committed entries too.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXEMPTIONS, PRIVATE_NAMES, PRIVATE_NAMES_DIGEST, entriesDigest, entryKey, hashEntry, matchLine, tokens, entryOf,
  entriesOf, hitsIn, maskText, pairHits,
} from './private-names.mjs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const e = (text: string, mode: 'part' | 'exact' | 'run' | 'words') => {
  const ts = tokens(text).map((x) => x.t);
  return { h: hashEntry(ts.join('-')), f: hashEntry(ts[0]!), n: ts.length, mode };
};
const h8 = (x: { h: string }) => x.h.slice(0, 8);

describe('matchLine', () => {
  it('part matches a token or a window of a run, case-blind, across - . _ and middle dot', () => {
    const a = e('zz-alpha', 'part');
    for (const s of ['see zz-alpha-quiet-mesa', 'ZZ-Alpha', 'zz_alpha', 'zz.alpha', 'zz·alpha'])
      expect(matchLine(s, [a])).toEqual([h8(a)]);
    expect(matchLine('zz-alphabet', [a])).toEqual([]);
  });

  it('part splits camelCase, so an identifier built on the token is caught', () => {
    const b = e('zz9', 'part');
    expect(matchLine('const zz9Row = 1', [b])).toEqual([h8(b)]);
  });

  it('run matches only a whole run', () => {
    const c = e('zz-beta', 'run');
    expect(matchLine('host zz-beta.', [c])).toEqual([h8(c)]);
    expect(matchLine('zz-beta-hierarchy-design.md', [c])).toEqual([]);
  });

  it('words matches a phrase across any whitespace', () => {
    const d = e('zed quux', 'words');
    expect(matchLine('by Zed\n  Quux today', [d])).toEqual([h8(d)]);
  });

  it('never returns text', () => {
    expect(JSON.stringify(matchLine('zz-alpha', [e('zz-alpha', 'part')]))).not.toMatch(/alpha/i);
  });

  it('run refuses a run joined on either side, by any joiner part accepts', () => {
    const c = e('zz-beta', 'run');
    for (const s of ['x-zz-beta', 'x.zz-beta', 'x_zz-beta', 'x·zz-beta', 'xZzBeta', 'zz-beta_x', 'zz-beta.x'])
      expect(matchLine(s, [c]), s).toEqual([]);
    for (const s of ['(zz-beta)', '`zz-beta`', 'zz-beta, then', '/zz-beta/'])
      expect(matchLine(s, [c]), s).toEqual([h8(c)]);
  });

  it('run and exact match the joiners a name is listed with; part does not care', () => {
    // A name whose tokens another product spelling also uses, joined otherwise
    // (`zz_beta` as an identifier, `zz.beta` as a file name), is listed `run` or
    // `exact` so that spelling stays out.
    const c = e('zz-beta', 'run');
    expect(matchLine('ZZ-BETA', [c])).toEqual([h8(c)]);
    expect(matchLine('ZZ_BETA=1', [c])).toEqual([]);
    expect(matchLine('zz.beta', [c])).toEqual([]);
    const p = e('zz-beta', 'part');
    expect(matchLine('ZZ_BETA=1', [p])).toEqual([h8(p)]);
  });

  it('exact matches anywhere in a run, but only with the listed joiners', () => {
    const x = e('zz-beta', 'exact');
    for (const s of ['zz-beta.local', 'my-zz-beta', 'ZZ-BETA-2', 'zz-beta_x'])
      expect(matchLine(s, [x]), s).toEqual([h8(x)]);
    for (const s of ['zz.beta', 'zz_beta', 'zzBeta', 'zz beta'])
      expect(matchLine(s, [x]), s).toEqual([]);
  });

  it('words joins across whitespace only, never across a hyphen', () => {
    const d = e('zed quux', 'words');
    expect(matchLine('zed-quux', [d])).toEqual([]);
    expect(matchLine('zedquux', [d])).toEqual([]);
  });

  it('a compatibility form folds to the token (NFKC): fullwidth letters are caught', () => {
    const a = e('zz-alpha', 'part');
    expect(matchLine('ｚｚ-ａｌｐｈａ', [a])).toEqual([h8(a)]);
  });

  it('a Unicode hyphen joins like -, and an invisible character splits nothing', () => {
    const rows = entriesOf('zz-alpha', 'part');
    for (const s of ['zz‐alpha', 'zz‑alpha', 'zz–alpha', 'zz−alpha', 'zz​-alpha', 'zz-⁠alpha', 'zz­alpha'])
      expect(matchLine(s, rows), JSON.stringify(s)).not.toEqual([]);
  });

  it('every default-ignorable character splits nothing, wherever it falls (D-5287)', () => {
    // One case per class the fold once missed (LRM, RLM, LRI, CGJ, MVS) and the
    // ones it always dropped (ZWSP, SHY, WJ), each inside ONE token: a name
    // split by any of them must still match whole. Across a line break, the
    // pairHits pins below.
    const rows = entriesOf('zzomega', 'part');
    for (const c of ['\u200e', '\u200f', '\u2066', '\u034f', '\u180e', '\u200b', '\u00ad', '\u2060'])
      expect(matchLine(`x zz${c}omega y`, rows), `U+${c.codePointAt(0)!.toString(16)}`).toEqual([h8(rows[0]!)]);
  });

  it('a format character that is not default-ignorable still ends a token (D-5287)', () => {
    // U+0600 is format (Cf) and visible: dropped, it would join `zzomega` to the
    // `x` after it, and the hit would be lost.
    const rows = entriesOf('zzomega', 'part');
    expect(matchLine('zzomega\u0600x', rows)).toEqual([h8(rows[0]!)]);
    // The U+200B sends this line down the fold's slow path, where INVISIBLE is read.
    expect(matchLine('zzomega\u0600x\u200b', rows)).toEqual([h8(rows[0]!)]);
  });

  it('a row spelled in camelCase finds its lower-case spelling, and a lower-case row its camelCase one', () => {
    // The tree writes one name both ways (`ZzOmega` in prose, `zzomega-42` as
    // a derived handle): a split-only matcher missed whichever form the list
    // row did not use.
    const camel = entriesOf('ZzOmega', 'part');
    expect(camel.map(h8)).toEqual([h8(e('zz-omega', 'part')), h8(e('zzomega', 'part'))]);
    expect(matchLine('handle zzomega-42', camel)).toEqual([h8(camel[1]!)]);
    expect(matchLine('see ZzOmega here', camel)).toEqual([h8(camel[0]!)]);
    const lower = entriesOf('zzomega', 'part');
    expect(lower).toHaveLength(1);
    expect(matchLine('see ZzOmega here', lower)).toEqual([h8(lower[0]!)]);
    expect(matchLine('ZZOMEGA', lower)).toEqual([h8(lower[0]!)]);
  });

  it('a one-word row is found inside a longer camelCase identifier', () => {
    const lower = entriesOf('zzomega', 'part');
    for (const s of ['useZzOmega()', 'ZzOmegaClient', 'ZZOMEGAWidget', 'const myZzOmegaRow = 1'])
      expect(matchLine(s, lower), s).toEqual([h8(lower[0]!)]);
    expect(matchLine('ZzOmegaxClient', lower)).toEqual([]);
  });

  it('a row with several tokens is also found run together', () => {
    // A name written with its separators removed (`zzalpha-evidence` for
    // `zz-alpha`) is the same name: every multi-token row commits that form.
    const rows = entriesOf('zz-alpha', 'part');
    expect(rows.map((x) => x.n)).toEqual([2, 1]);
    expect(matchLine('see zzalpha-evidence-archive', rows)).toEqual([h8(rows[1]!)]);
    expect(matchLine('zzalphabet', rows)).toEqual([]);
  });

  it('a run row spelled in camelCase keeps its one-token form', () => {
    const rows = entriesOf('ZzBeta', 'run');
    expect(rows.some((x) => x.n === 1)).toBe(true);
    for (const s of ['zzbeta', 'ZZBETA', 'Zzbeta', 'ZzBeta']) expect(matchLine(s, rows), s).not.toEqual([]);
    expect(matchLine('zzbeta-x', rows)).toEqual([]);
  });

  it('reports each matched entry once per line, in order of first occurrence', () => {
    const a = e('zz-alpha', 'part');
    const b = e('zz9', 'part');
    expect(matchLine('zz9 zz-alpha zz9 zz-alpha', [a, b])).toEqual([h8(b), h8(a)]);
  });
});

describe('the class and scan helpers', () => {
  it('maskText prints a path with every hit replaced by its #h8', () => {
    const rows = entriesOf('zz-alpha', 'part');
    expect(maskText('docs/zz-alpha-notes.md', rows)).toBe(`docs/#${h8(rows[0]!)}-notes.md`);
    expect(maskText('see ｚｚ-alpha now', rows)).toBe(`see #${h8(rows[0]!)} now`);
    expect(maskText('nothing here', rows)).toBe('nothing here');
  });

  it('maskText masks overlapping hits as one span, whatever their order', () => {
    const zz = entriesOf('zz', 'part');
    const pair = entriesOf('zz-alpha', 'part');
    for (const rows of [[...zz, ...pair], [...pair, ...zz]]) {
      const out = maskText('docs/zz-alpha-notes.md', rows);
      expect(out).toMatch(/^docs\/#[0-9a-f]{8}-notes\.md$/);
    }
    const tail = entriesOf('alpha-beta', 'part');
    const out = maskText('a zz-alpha-beta b', [...pair, ...tail]);
    expect(out).toMatch(/^a #[0-9a-f]{8} b$/);
  });

  it('pairHits finds a phrase broken across two lines, and only that', () => {
    const rows = entriesOf('zed quux', 'words');
    expect(pairHits('written by Zed', 'Quux on Monday', 'x.md', rows)).toEqual([h8(rows[0]!)]);
    expect(pairHits('by Zed Quux', 'on Monday', 'x.md', rows)).toEqual([]);
  });

  it('pairHits reads through a wrapped comment or quote marker and trailing blanks', () => {
    const rows = entriesOf('zed quux', 'words');
    for (const [a, b] of [['// written by Zed', '// Quux on Monday'], [' * written by Zed', ' * Quux on Monday'],
      ['# written by Zed', '# Quux on Monday'], ['> written by Zed', '> Quux on Monday'],
      [`written by Zed${' '.repeat(100)}`, 'Quux on Monday'], ['written by Zed\u00ad', 'Quux on Monday']]) {
      expect(pairHits(a, b, 'x.md', rows), JSON.stringify([a.slice(0, 20), b])).toEqual([h8(rows[0]!)]);
    }
  });

  it('pairHits reads through an invisible character that ends the first line (D-5287)', () => {
    const rows = entriesOf('zed quux', 'words');
    expect(pairHits('written by Zed\u200e', 'Quux on Monday', 'x.md', rows)).toEqual([h8(rows[0]!)]);
  });

  it('pairHits reads through an invisible character before the next line\'s marker (D-5287)', () => {
    const rows = entriesOf('zed quux', 'words');
    expect(pairHits('// written by Zed', '\u200b// Quux on Monday', 'x.md', rows)).toEqual([h8(rows[0]!)]);
  });

  it('pairHits reads through an invisible character after the next line\'s marker (D-5287)', () => {
    const rows = entriesOf('zed quux', 'words');
    expect(pairHits('// written by Zed', '// \u200bQuux on Monday', 'x.md', rows)).toEqual([h8(rows[0]!)]);
  });

  // A facing character that NFKC folds to a letter (circled U+24D0, U+24E0) ends or
  // starts a word, as it does on one line: the gate reads the facing ends folded,
  // with or without a default-ignorable letter beside it (D-5287).
  it.each([
    ['ends on a folded letter, then U+3164', 'x zzomeg\u24d0\u3164', 'qqalpha y'],
    ['ends on a folded letter, then U+115F', 'x zzomeg\u24d0\u115f', 'qqalpha y'],
    ['ends on a folded letter, then U+1160', 'x zzomeg\u24d0\u1160', 'qqalpha y'],
    ['ends on a folded letter, then U+FFA0', 'x zzomeg\u24d0\uffa0', 'qqalpha y'],
    ['starts with U+3164, then a folded letter', 'x zzomega', '\u3164\u24e0qalpha y'],
    ['ends on a folded letter', 'x zzomeg\u24d0', 'qqalpha y'],
    ['starts with a folded letter', 'x zzomega', '\u24e0qalpha y'],
  ])('pairHits reads the facing ends folded: %s (D-5287)', (_name, prev, line) => {
    const rows = entriesOf('zzomega qqalpha', 'words');
    expect(pairHits(prev, line, 'x.md', rows)).toEqual([h8(rows[0]!)]);
    expect(hitsIn(`${prev} ${line}`, 'x.md', rows)).toEqual([h8(rows[0]!)]);
  });

  it('the exemptions hold only in a history-programme document under docs/', () => {
    // The upstream entry's own h8, exactly as private-names.mjs names it; the hit
    // object stands in for one the matcher would build on `<name>@abcdef01`.
    const hit = { h8: '4dda1e70', start: 0, end: 4, folded: 'xxxx@abcdef01', origStart: 0, origEnd: 4 };
    expect(EXEMPTIONS.some((x) => x.applies('docs/superpowers/specs/x-ccrc-history-y.md', hit))).toBe(true);
    for (const f of ['server/src/ccrc-history.ts', 'ccd/ccrc-history-x', 'docs/superpowers/specs/x-design.md'])
      expect(EXEMPTIONS.some((x) => x.applies(f, hit)), f).toBe(false);
  });

  it('the exemptions are the upstream citation only: any other entry is a hit even there', () => {
    const rows = entriesOf('zz-alpha', 'part');
    expect(hitsIn('`zz-alpha@abcdef01:src/x.ts' + ':1`', 'docs/superpowers/specs/x-ccrc-history-y.md', rows))
      .toEqual([h8(rows[0]!)]);
    expect(hitsIn('lossless-claw, an zz-alpha plugin', 'docs/superpowers/specs/x-ccrc-history-y.md', rows))
      .toEqual([h8(rows[0]!)]);
  });
});

describe('tokens and hashEntry', () => {
  it('records the joiner before each token', () => {
    expect(tokens('aB-c.d_e·f g/h').map((x) => [x.t, x.joinerBefore])).toEqual([
      ['a', ''], ['b', 'case'], ['c', '-'], ['d', '.'], ['e', '_'], ['f', '·'], ['g', 'space'], ['h', 'other'],
    ]);
  });

  it('splits an upper-case run before its last capital when a lower-case letter follows', () => {
    expect(tokens('ZZALPHAWidget').map((x) => x.t)).toEqual(['zzalpha', 'widget']);
  });

  it('hashEntry is 32 lower-case hex and keyed (not a bare sha256 of the text)', () => {
    expect(hashEntry('zz-alpha')).toMatch(/^[0-9a-f]{32}$/);
    expect(hashEntry('zz-alpha')).not.toBe(hashEntry('zz-alphb'));
  });

  it('entryOf builds the entry hash --list would commit for a row', () => {
    expect(entryOf('ZZ-Alpha', 'part')).toEqual(e('zz-alpha', 'part'));
  });
});

describe('the committed entries and the exemptions are pinned (D-5288)', () => {
  it('PRIVATE_NAMES is exactly what `hash --list` printed beside its digest', () => {
    expect(entriesDigest(PRIVATE_NAMES), `${PRIVATE_NAMES.length} entries: regenerate both with \`node `
      + 'server/test/private-names.mjs hash --list <path>`, and paste its literal and its digest line together')
      .toBe(PRIVATE_NAMES_DIGEST);
  });

  it('the digest moves when one entry is deleted or weakened', () => {
    expect(entriesDigest(PRIVATE_NAMES.slice(1))).not.toBe(PRIVATE_NAMES_DIGEST);
    const weakened = PRIVATE_NAMES.map((x, i) => (i === 1 ? { ...x, mode: 'words' as const } : x));
    expect(entriesDigest(weakened)).not.toBe(PRIVATE_NAMES_DIGEST);
  });

  it('the plugin-phrase exemption holds only in a history-programme document', () => {
    const plugin = EXEMPTIONS.find((x) => x.name === 'upstream plugin phrase')!;
    const hit = { h8: '4dda1e70', start: 18, end: 22, folded: 'lossless-claw, an xxxx plugin', origStart: 18, origEnd: 22 };
    expect(plugin.applies('docs/superpowers/specs/x-ccrc-history-y.md', hit)).toBe(true);
    for (const f of ['docs/superpowers/specs/x-design.md', 'server/src/ccrc-history.ts'])
      expect(plugin.applies(f, hit), f).toBe(false);
  });

  it('the revision-citation exemption needs seven or more hex digits after the @', () => {
    const rev = EXEMPTIONS.find((x) => x.name === 'upstream revision citation')!;
    const at = (tail: string) => ({ h8: '4dda1e70', start: 0, end: 4, folded: `xxxx${tail}`, origStart: 0, origEnd: 4 });
    const doc = 'docs/superpowers/specs/x-ccrc-history-y.md';
    expect(rev.applies(doc, at('@abcdef0'))).toBe(true);
    for (const tail of ['@abcdef', '@abcdefg', '@abc', '@'])
      expect(rev.applies(doc, at(tail)), tail).toBe(false);
  });

  const doc = 'docs/superpowers/specs/x-ccrc-history-y.md';
  const plugin = () => EXEMPTIONS.find((x) => x.name === 'upstream plugin phrase')!;
  const hitIn = (folded: string) => {
    const start = folded.indexOf('xxxx');
    return { h8: '4dda1e70', start, end: start + 4, folded, origStart: start, origEnd: start + 4 };
  };

  it('the plugin-phrase exemption needs the phrase\'s prefix', () => {
    expect(plugin().applies(doc, hitIn('lossless-claw, an xxxx plugin'))).toBe(true);
    expect(plugin().applies(doc, hitIn('a rewrite, an xxxx plugin'))).toBe(false);
  });

  it('the plugin-phrase exemption needs the phrase\'s suffix', () => {
    expect(plugin().applies(doc, hitIn('lossless-claw, an xxxx library'))).toBe(false);
  });

  it('the plugin-phrase exemption needs ccrc-history in the path, not only history', () => {
    expect(plugin().applies('docs/superpowers/specs/x-history-y.md', hitIn('lossless-claw, an xxxx plugin')))
      .toBe(false);
  });

  it('the revision-citation exemption needs the @ to follow the name directly', () => {
    const rev = EXEMPTIONS.find((x) => x.name === 'upstream revision citation')!;
    expect(rev.applies(doc, hitIn('xxxx@abcdef01'))).toBe(true);
    expect(rev.applies(doc, hitIn('xxxx, pinned at x@abcdef01'))).toBe(false);
  });

  it('`hash --list` prints the canary first, no local row, and the digest of exactly what it printed', () => {
    // A fixture list of synthetic tokens only, in the local list's five columns.
    // No local row shares an entry with a pub row, so a local entry printed is a
    // leak of the row, not a coincidence.
    const dir = mkTmp('ccrc-private-names-');
    try {
      const list = path.join(dir, 'list');
      writeFileSync(list, [
        '# mode\ttoken\tstand-in\tclass\tvisibility',
        'part\tzz-pubone\tproject-a\tproject\tpub',
        'words\tzed pubtwo\ta person\tperson\tpub',
        'part\tqq-localone\tproject-b\tproject\tlocal',
        'run\tqq-localtwo\tlane-a\tlane\tlocal',
        '',
      ].join('\n'));
      const pub = [...entriesOf('zz-pubone', 'part'), ...entriesOf('zed pubtwo', 'words')].map(entryKey);
      const local = [...entriesOf('qq-localone', 'part'), ...entriesOf('qq-localtwo', 'run')].map(entryKey);
      expect(local.filter((k) => pub.includes(k))).toEqual([]);
      const mjs = fileURLToPath(new URL('./private-names.mjs', import.meta.url));
      const out = execFileSync(process.execPath, [mjs, 'hash', '--list', list], { encoding: 'utf8' })
        .trimEnd().split('\n');
      const digestLine = out.pop()!;
      const printed = out.map((line) => {
        const m = /^ {2}\{ h: '([0-9a-f]{32})', f: '([0-9a-f]{32})', n: (\d+), mode: '([a-z]+)' \},(?: \/\/ CANARY)?$/
          .exec(line);
        expect(m, line).not.toBeNull();
        return { h: m![1]!, f: m![2]!, n: Number(m![3]), mode: m![4]! as 'part' | 'exact' | 'run' | 'words' };
      });
      expect(out[0]).toMatch(/\/\/ CANARY$/);
      expect(entryKey(printed[0]!)).toBe(entryKey(PRIVATE_NAMES[0]!));
      expect(printed.slice(1).map(entryKey).sort()).toEqual([...new Set(pub)].sort());
      expect(digestLine).toBe(`export const PRIVATE_NAMES_DIGEST = '${entriesDigest(printed)}';`);
    } finally {
      removeTmpFixtures();
    }
  });
});
