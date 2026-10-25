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
import { hasMenu, parseDialog } from '../src/pane/dialog.js';
import { draftOfMeasured } from '../src/inject/send.js';
import { parseTranscriptLine } from '../src/transcript/parse.js';

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
