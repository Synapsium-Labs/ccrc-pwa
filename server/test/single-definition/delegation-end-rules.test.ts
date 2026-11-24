// Session helpers S2 (D-8874; plan docs/superpowers/plans/2026-11-20-broker-helper-ends.md, Task S2): review 3026 F9's two rules,
// each with ONE writer.
//   - The canonical instant maximum, `maxInstant` (canonical UTC millisecond instants order as strings): written once, in
//     `delegation-model.ts` beside the instant's own format and parse. S1 restated it as `delegation-end-basis.ts`'s `later`, beside
//     `delegation-checkpoint.ts`'s module-private copy.
//   - What makes a task notification FINAL (any status but `unknown`): written once, in `delegation-end-basis.ts`
//     (`isFinalNotification`). S1's arm restated `foldNotification`'s test of it.
// Against `main` (137f96672c) both cases are red: each body is spelled in two files. A text scan, as the other guards of this
// directory are: the body is matched, not a name, so a copy under another name is still a second writer.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ccrcRoot } from './helpers.js';

const COORD = path.join(ccrcRoot, 'server', 'src', 'coord');
const sources = (): { file: string; text: string }[] =>
  readdirSync(COORD).filter((f) => f.endsWith('.ts')).map((f) => ({ file: f, text: readFileSync(path.join(COORD, f), 'utf8') }));
const holders = (re: RegExp): string[] => sources().filter((s) => re.test(s.text)).map((s) => s.file).sort();

describe('review 3026 F9: one writer each for the instant maximum and the final-status rule (D-8874)', () => {
  it('the instant maximum, `(a >= b ? a : b)` over instants, is written in delegation-model.ts alone', () => {
    expect(holders(/\(\s*a\s*>=\s*b\s*\?\s*a\s*:\s*b\s*\)/)).toEqual(['delegation-model.ts']);
  });

  it('the final-status rule, a notification status compared with `unknown`, is written in delegation-end-basis.ts alone', () => {
    expect(holders(/status\s*[!=]==\s*'unknown'/)).toEqual(['delegation-end-basis.ts']);
  });

  it('the scan sees a planted copy (the control)', () => {
    const planted = 'const later = (a: string, b: string): string => (a >= b ? a : b);\nif (n.status !== \'unknown\') return;';
    expect(/\(\s*a\s*>=\s*b\s*\?\s*a\s*:\s*b\s*\)/.test(planted)).toBe(true);
    expect(/status\s*[!=]==\s*'unknown'/.test(planted)).toBe(true);
  });
});
