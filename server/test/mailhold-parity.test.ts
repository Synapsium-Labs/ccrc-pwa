// The parity of the `mailhold` grammar's readers (mid-turn mail plan 2026-11-19, Task 3.3; spec §3.3 "one owner of the
// grammar"): every row of `fixtures/mailhold-grammar.json` gets the same accept or refuse from `parseMailHold`
// (`shared/mailHold.ts`, the owner) and from ccd's `_route_valid mailhold` (fixture HOME), bounds, digit widths and the
// eight-pair edge included, as `_hook_server_cap`'s copies are held to `parseServerCaps`. The session hook's builtin
// parse joins this file as a third reader in the hook's own pull request (plan Task 5.2).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { MAILHOLD_REACH_S, MAILHOLD_RE_BODY, parseMailHold } from '../../shared/mailHold.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CCD_SRC = readFileSync(path.join(HERE, '..', '..', 'ccd', 'ccd'), 'utf8');
const CORPUS = (JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'mailhold-grammar.json'), 'utf8')) as {
  rows: { name: string; value: string; ok: boolean }[];
}).rows;

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-mailhold-parity-'); });
afterEach(() => { h.cleanup(); });

describe('ccd\'s _route_valid mailhold and parseMailHold agree on every corpus row', () => {
  it('the corpus has both answers, and no NUL (a value reaches ccd only through argv)', () => {
    expect(CORPUS.some((r) => r.ok) && CORPUS.some((r) => !r.ok)).toBe(true);
    for (const r of CORPUS) expect(r.value.includes('\0'), r.name).toBe(false);
  });

  it('every row, in one shell, fed NUL-separated so a newline or a tab reaches the reader whole', () => {
    const file = path.join(h.home, 'mailhold-values');
    writeFileSync(file, CORPUS.map((r) => `${r.value}\0`).join(''));
    const out = h.sh(`while IFS= read -r -d '' x; do _route_valid mailhold "$x"; printf '%s\\n' "$?"; done < ${JSON.stringify(file)}`);
    const rcs = out.split('\n');
    expect(rcs).toHaveLength(CORPUS.length);
    CORPUS.forEach((r, i) => {
      expect(rcs[i], `${r.name}: ccd`).toBe(r.ok ? '0' : '1');
      expect(parseMailHold(r.value).ok, `${r.name}: parseMailHold`).toBe(r.ok);
    });
  });

  it('the same under a UTF-8 locale, where a range could collate other digits in', () => {
    const file = path.join(h.home, 'mailhold-values');
    writeFileSync(file, CORPUS.map((r) => `${r.value}\0`).join(''));
    const out = h.sh(`while IFS= read -r -d '' x; do _route_valid mailhold "$x"; printf '%s\\n' "$?"; done < ${JSON.stringify(file)}`,
      { LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' });
    CORPUS.forEach((r, i) => { expect(out.split('\n')[i], r.name).toBe(r.ok ? '0' : '1'); });
  });
});

describe('the copies are the owner\'s', () => {
  it('ccd\'s mailhold row is MAILHOLD_RE_BODY, character for character', () => {
    const rows = CCD_SRC.split('\n').filter((l) => /^\s*mailhold\) \[\[ "\$v" =~ /.test(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.trim()).toBe(`mailhold) [[ "$v" =~ ${MAILHOLD_RE_BODY} ]] ;;`);
  });

  it('ccd\'s reach is MAILHOLD_REACH_S', () => {
    expect(h.sh('printf %s "$MAILHOLD_REACH_S"')).toBe(String(MAILHOLD_REACH_S));
  });

  it('ccd compares until base 10 at its write site (plan P14)', () => {
    const bound = CCD_SRC.split('\n').filter((l) => l.includes('mailhold-far:'));
    expect(bound).toHaveLength(1);
    expect(bound[0]).toContain('(( 10#${v%%:*} <= now + MAILHOLD_REACH_S ))');
  });
});
