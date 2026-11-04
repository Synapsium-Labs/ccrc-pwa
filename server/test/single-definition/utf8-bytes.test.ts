// The UTF-8 byte counter has one home (desktop-polish carry, review 1389 A6, D-7950): `shared/utf8.ts`, L0, which the
// ledgers, the docs paths, the test box's log line, the workspace title and the PWA's render gates import. A hand-written
// counter anywhere else (the code-point arithmetic, or a function wrapping an encoder's length in the shared kernel or the
// PWA) is a second definition, and this file reds on it.
// KNOWN WIDTH: the arithmetic is found by its one spelling (`< 0x800 ? 2`); a counter written another way is not seen. An
// inline use of the platform's own counter (`Buffer.byteLength`, an encoder's `.length` at the one place it is checked, as
// `shared/api.ts`'s route value bound does) is not a definition and is not counted.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ALL, ccrcRoot, rel } from './helpers.js';

const HOME = 'shared/utf8.ts';
/** The code-point arithmetic of a hand-written counter. */
const ARITHMETIC = /<\s*0x800\s*\?\s*2/;
/** A named counter that wraps an encoder's length: `const f = (s) => new TextEncoder().encode(s).length`. */
const ENCODER_WRAPPER = /(?:const|let|function)\s+\w+\s*=?\s*\(\s*\w+\s*(?::\s*string)?\s*\)\s*(?::\s*number)?\s*(?:=>)?\s*\{?\s*(?:return\s+)?new TextEncoder\(\)\.encode\(\s*\w+\s*\)\.length/;
const L0_AND_PWA = (f: string): boolean => /^(?:shared|pwa\/src)\//.test(rel(f));

describe('the UTF-8 byte counter is defined once, in shared/utf8.ts (review 1389 A6)', () => {
  it('CONTROL: the patterns see a counter and pass over a use', () => {
    expect(ARITHMETIC.test('n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;')).toBe(true);
    expect(ARITHMETIC.test('if (utf8Bytes(s) <= WS_TITLE_MAX_BYTES) return s;')).toBe(false);
    expect(ENCODER_WRAPPER.test('const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;')).toBe(true);
    expect(ENCODER_WRAPPER.test('|| new TextEncoder().encode(value).length > ROUTE_VALUE_MAX_BYTES) {')).toBe(false);
  });
  it('the code-point arithmetic is spelled in the home alone', () => {
    expect(ALL.filter((f) => ARITHMETIC.test(readFileSync(f, 'utf8'))).map(rel).sort()).toEqual([HOME]);
  });
  it('no file of the shared kernel or the PWA wraps an encoder\'s length in a counter of its own', () => {
    expect(ALL.filter(L0_AND_PWA).filter((f) => ENCODER_WRAPPER.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
  });
  it('the home imports nothing, and the readers import it', () => {
    expect(readFileSync(path.join(ccrcRoot, HOME), 'utf8')).not.toMatch(/^\s*import\b/m);
    for (const f of ['shared/ledgers.ts', 'shared/docs.ts', 'shared/testbox.ts', 'shared/slug.ts']) {
      expect(readFileSync(path.join(ccrcRoot, f), 'utf8'), f).toMatch(/import \{ utf8Bytes \} from '\.\/utf8\.js';/);
    }
    expect(readFileSync(path.join(ccrcRoot, 'pwa/src/lib/markdownGuard.ts'), 'utf8'))
      .toMatch(/export \{ utf8Bytes as utf8ByteLength \} from '\.\.\/\.\.\/\.\.\/shared\/utf8';/);
  });
});
