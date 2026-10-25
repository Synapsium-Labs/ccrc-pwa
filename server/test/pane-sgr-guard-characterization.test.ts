/**
 * ARCH-63 characterization (green on the code before the collapse): every SGR stripper and
 * `hasMenu(strip) ? parseDialog(pane) : null` guard copy in `watch.ts`, `sessionws.ts` and
 * `inject/send.ts` read the same inputs as `parseDialog(pane)` alone, because `parseDialog`
 * opens with that same gate. The five strippers are the same regex, `/\x1b\[[0-9;]*m/g`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { hasMenu, parseDialog, stripSgr } from '../src/pane/dialog.js';
import { draftOfMeasured } from '../src/inject/send.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';
import { REPO, walkSrc } from './rings/walkSrc.js';

const panesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
const OLD_SGR = /\x1b\[[0-9;]*m/g; // the regex all five declarations spell
const guard = (pane: string) => (hasMenu(pane.replace(OLD_SGR, '')) ? parseDialog(pane) : null);

const MENU = '● Which one?\n\n❯ 1. Alpha\n  2. Beta\n  3. Gamma\n\nEnter to confirm · Esc to cancel\n';
const inputs: Array<[string, string]> = [
  ['plain menu', MENU],
  ['no menu', 'just scrollback\n❯ \n'],
  ['empty', ''],
  ['bold colour menu rows', MENU.replace('Alpha', '\x1b[1;36mAlpha\x1b[0m')],
  ['SGR splits the footer phrase', MENU.replace('Enter to confirm', 'Enter to \x1b[2mconfirm\x1b[22m')],
  ['non-SGR CSI is not stripped', MENU.replace('Beta', 'Be\x1b[2Kta')],
  ...readdirSync(panesDir).filter((f) => f.endsWith('.txt')).map((f): [string, string] => [f, readFileSync(path.join(panesDir, f), 'utf8')]),
];

describe('the hasMenu(strip) ? parseDialog : null guard equals parseDialog alone', () => {
  for (const [name, pane] of inputs) {
    it(name, () => { expect(parseDialog(pane)).toEqual(guard(pane)); });
  }
});

describe('SGR is stripped identically at the other sites', () => {
  it('the box draft read drops colour and dim runs', () => {
    const pane = '\x1b[2m────\x1b[0m\n\x1b[1m❯\x1b[0m hello \x1b[2mghost\x1b[22m\n\x1b[2m────\x1b[0m\n';
    expect(draftOfMeasured(pane)).toMatchSnapshot();
  });
  it('a command stdout row loses its SGR and keeps non-SGR escapes out of the strip', () => {
    const rec = (c: string) => JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: c } });
    expect(parseTranscriptLine(rec('<local-command-stdout>\x1b[2mDone\x1b[22m\x1b[2K</local-command-stdout>'))).toMatchSnapshot();
  });
});

describe('ARCH-63: one SGR stripper, no guard copy', () => {
  it('stripSgr removes every SGR run and nothing else', () => {
    expect(stripSgr('\x1b[1;36mA\x1b[0m b \x1b[2mc\x1b[22m')).toBe('A b c');
    expect(stripSgr('x\x1b[2Ky\x1b[?25l')).toBe('x\x1b[2Ky\x1b[?25l');
    expect(stripSgr('')).toBe('');
    expect(stripSgr('a\x1b[0mb')).toBe(stripSgr(stripSgr('a\x1b[0mb'))); // repeated calls: the /g regex keeps no lastIndex
  });
  const SRC = path.resolve(__dirname, '../src');
  const code = (rel: string) => readFileSync(path.join(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // A whole-SGR stripper spelled anywhere, as a regex literal or a `new RegExp` string (backslashes doubled): an ESC
  // escape (`\x1b`, `\u001b`, `\u{1b}`, `\033`, `\e`), `\[`, ONE character class with a `*`/`+` quantifier, then
  // `m` closing the literal. Partial SGR matchers that pin a parameter (`\x1b\[0;…m`, send.ts's DIM_REOPEN and
  // DIM_SPAN) are not strippers and do not match. Files are read raw, comments included: stripping comments with a
  // regex could eat a literal that contains `//`. A comment that quotes the regex in backticks (send.ts's DIM note) is
  // not a literal: the closing backtick is not a terminator here.
  const STRIPPER_RE = /\\\\?(?:x1[bB]|u001[bB]|u\{1[bB]\}|033|e)\\\\?\[\[[^\]\n]*\][*+]\??m[/'"]/;
  it('the stripper pattern sees the declaration it pins (and its spelling variants)', () => {
    expect(code('pane/dialog.ts')).toMatch(STRIPPER_RE);
    for (const v of ['/\\x1b\\[[0-9;]*m/g', '/\\u001b\\[[\\d;]+m/g', '/\\x1B\\[[0-9;]*?m/', "new RegExp('\\\\x1b\\\\[[0-9;]*m', 'g')"]) {
      expect(v).toMatch(STRIPPER_RE);
    }
    expect('/\\x1b\\[0;(?:1;)?2(?:;[0-9;]*)?m/g').not.toMatch(STRIPPER_RE);
  });
  it('only pane/dialog.ts declares an SGR stripper, across server/src, shared, pwa/src and agent/src', () => {
    const files = walkSrc({ roots: ['server/src', 'shared', 'pwa/src', 'agent/src'], min: 400 });
    const hits = files.filter((f) => f !== 'server/src/pane/dialog.ts')
      .filter((f) => STRIPPER_RE.test(readFileSync(path.join(REPO, f), 'utf8')));
    expect(hits).toEqual([]);
  });
  it('no former site keeps an SGR binding of its own', () => {
    for (const rel of ['inject/send.ts', 'sessionws.ts', 'watch.ts', 'transcript/parse.ts']) {
      expect(code(rel), rel).not.toMatch(/\bSGR\b/);
    }
  });
  it('no site spells hasMenu(strip) ? parseDialog(...) : null', () => {
    for (const rel of ['inject/send.ts', 'sessionws.ts', 'watch.ts']) {
      expect(code(rel), rel).not.toMatch(/hasMenu\([^)]*\)\)?\s*\?\s*parseDialog/);
    }
  });
});
