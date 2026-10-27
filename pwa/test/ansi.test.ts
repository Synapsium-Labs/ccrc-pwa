// The ANSI colour reader for tool wells (T4a, D-6387): what a transcript record's SGR codes become, and that
// nothing of the escape bytes survives. The hue table is also pinned against the drawer's GLASS_ANSI, read from
// `tokens.css` through the shared reader (`cssRule.ts#rootBody`), so a palette retune or a retargeted token reds here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ANSI_HUE_TOKEN, ansiClass, ansiRuns, hasSgr, type AnsiHue } from '../src/lib/ansi';
import * as ansi from '../src/lib/ansi';
import { GLASS_ANSI } from '../src/session/drawerModel';
import { declValue, rootBody } from './cssRule';

const ESC = '\x1b';
const TOKENS_CSS = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'tokens.css'), 'utf8');

/** The hue a lone coloured word reads as, the well's ink (null) included. */
const hueOf = (codes: string): AnsiHue | null => {
  const runs = ansiRuns(`${ESC}[${codes}mx`);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.text).toBe('x');
  return runs[0]!.hue;
};

describe('ANSI detection and display helpers', () => {
  it('detects SGR including empty and colon parameters', () => {
    expect(hasSgr(`a${ESC}[31mb`)).toBe(true);
    expect(hasSgr(`${ESC}[m`)).toBe(true);
    expect(hasSgr(`${ESC}[38:5:1m`)).toBe(true);
  });
  it('does not detect SGR in non-SGR CSI', () => {
    expect(hasSgr(`${ESC}[2K${ESC}[?25l`)).toBe(false);
  });
  it('does not detect SGR in plain text', () => {
    expect(hasSgr('plain [31m')).toBe(false);
  });
  it('detects only SGR encountered by the transcript scanner', () => {
    const text = `${ESC}]title${ESC}[31mred`;
    expect(hasSgr(text)).toBe(true);
    expect(ansiRuns(text)).toEqual([{ text: 'red', hue: 'red' }]);
  });
  it('detects any escape, not just SGR', () => {
    const fn = (ansi as Record<string, unknown>).hasEscape;
    expect(typeof fn).toBe('function');
    if (typeof fn !== 'function') return;
    expect(fn(`a${ESC}[2Kb`)).toBe(true);
    expect(fn('plain')).toBe(false);
  });
  it('escapes a reversible single-line header', () => {
    const fn = (ansi as Record<string, unknown>).escapeHeader;
    expect(typeof fn).toBe('function');
    if (typeof fn !== 'function') return;
    const value = '"\\\n\u007f\u0085\u009f  ';
    const escaped = fn(value) as string;
    expect(escaped).toBe('\\"\\\\\\n\\u007f\\u0085\\u009f\\u2028\\u2029');
    expect(JSON.parse(`"${escaped}"`)).toBe(value);
  });
});

describe('ansiRuns', () => {
  it('a run with no escape is one plain run, byte for byte', () => {
    const text = 'plain \t text\nwith [brackets] and ] and m\r\n';
    expect(ansiRuns(text)).toEqual([{ text, hue: null }]);
    expect(ansiRuns('')).toEqual([]);
    expect(hasSgr(text)).toBe(false);
    expect(hasSgr(`a${ESC}[31mb`)).toBe(true);
    expect(hasSgr(`a${ESC}[mb`)).toBe(true);
    expect(hasSgr(`a${ESC}[2Kb`)).toBe(false);
  });

  it("31–36 and 91–96 map to the six hues; 30, 90 and 2 to the muted ink; 37, 39 and 0 to the well's ink", () => {
    const six: AnsiHue[] = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
    six.forEach((hue, i) => {
      expect(hueOf(String(31 + i))).toBe(hue);
      expect(hueOf(String(91 + i))).toBe(hue);
    });
    expect(hueOf('30')).toBe('muted');
    expect(hueOf('90')).toBe('muted');
    expect(hueOf('2')).toBe('muted');
    expect(ansiRuns(`${ESC}[2ma${ESC}[22mb`)).toEqual([{ text: 'a', hue: 'muted' }, { text: 'b', hue: null }]);
    expect(ansiRuns(`${ESC}[31ma${ESC}[2mb`)).toEqual([{ text: 'ab', hue: 'red' }]);
    for (const reset of ['37', '97', '39', '0', '']) {
      expect(ansiRuns(`${ESC}[31ma${ESC}[${reset}mb`)).toEqual([{ text: 'a', hue: 'red' }, { text: 'b', hue: null }]);
    }
    // a reset also ends dim; a combined list is read left to right
    expect(ansiRuns(`${ESC}[2ma${ESC}[0mb`)).toEqual([{ text: 'a', hue: 'muted' }, { text: 'b', hue: null }]);
    expect(hueOf('1;32')).toBe('green');
    expect(hueOf('31;42')).toBe('red');
    // reverse video, bold, italic, underline and unknown parameters change nothing
    for (const ignored of ['1', '3', '4', '7', '27', '53', '999']) expect(hueOf(ignored)).toBeNull();
    // runs of the same hue merge and empty runs are dropped
    expect(ansiRuns(`${ESC}[31ma${ESC}[1mb${ESC}[31m${ESC}[0m${ESC}[31mc`)).toEqual([{ text: 'abc', hue: 'red' }]);
  });

  it('a background code paints nothing', () => {
    for (const bg of ['41', '47', '49', '100', '107', '48;5;1', '48;5;200', '48;2;255;0;0']) {
      expect(hueOf(bg)).toBeNull();
      expect(ansiRuns(`${ESC}[32;${bg}mx`)).toEqual([{ text: 'x', hue: 'green' }]);
    }
    // a background's parameters are consumed, not read as foregrounds
    expect(hueOf('48;5;1')).toBeNull();
    expect(hueOf('48;2;31;32;33')).toBeNull();
  });

  it('38;5;n below 16 maps as its basic hue; any other 256 or truecolour value takes the default ink', () => {
    const basic: (AnsiHue | null)[] = ['muted', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', null];
    basic.forEach((hue, n) => {
      expect(hueOf(`38;5;${n}`)).toBe(hue);
      expect(hueOf(`38;5;${n + 8}`)).toBe(hue);
    });
    for (const n of [16, 21, 200, 231, 255, 256]) expect(hueOf(`38;5;${n}`)).toBeNull();
    expect(ansiRuns(`${ESC}[31ma${ESC}[38;5;200mb`)).toEqual([{ text: 'a', hue: 'red' }, { text: 'b', hue: null }]);
    expect(hueOf('38;2;255;0;0')).toBeNull();
    // the parameters are consumed: 38;2;1;2;3 is not a bold-red-green-ish run
    expect(hueOf('38;2;31;32;33')).toBeNull();
    expect(hueOf('38;5;1;32')).toBe('green');
  });

  it('no ESC byte survives: cursor and erase sequences, OSC, and a lone ESC are removed', () => {
    const noEsc = (s: string): string => ansiRuns(s).map((r) => r.text).join('');
    expect(noEsc(`a${ESC}[2Kb${ESC}[1;1Hc${ESC}[?25ld${ESC}[Je`)).toBe('abcde');
    expect(noEsc(`a${ESC}]0;title\x07b${ESC}]8;;http://x${ESC}\\c`)).toBe('abc');
    expect(noEsc(`a${ESC}Pdata${ESC}\\b${ESC}Xs${ESC}\\c${ESC}^p${ESC}\\d${ESC}_q${ESC}\\e`)).toBe('abcde');
    expect(noEsc(`a${ESC}(Bb${ESC})0c${ESC}*Ad${ESC}+Be`)).toBe('abcde');
    expect(noEsc(`a${ESC}7b${ESC}=c`)).toBe('abc');
    expect(noEsc(`a${ESC}`)).toBe('a');
    expect(noEsc(`a${ESC}${ESC}[31mb`)).toBe('ab');
    expect(noEsc(`a${ESC}[31`)).toBe('a');
    expect(noEsc(`a${ESC}]0;never ended`)).toBe('a');
    expect(noEsc(`a${ESC}[`)).toBe('a');
    for (const s of [`${ESC}`, `${ESC}[2K${ESC}`, `x${ESC}]0;t\x07${ESC}[31my${ESC}Pq`]) {
      for (const r of ansiRuns(s)) expect(r.text).not.toContain(ESC);
    }
    // an erase between two coloured words keeps their colour and merges them
    expect(ansiRuns(`${ESC}[31ma${ESC}[2Kb`)).toEqual([{ text: 'ab', hue: 'red' }]);
  });

  it('the hue table matches GLASS_ANSI[1..6]', () => {
    const root = rootBody(TOKENS_CSS);
    const six: AnsiHue[] = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
    six.forEach((hue, i) => {
      const token = ANSI_HUE_TOKEN[hue];
      expect(token, hue).toMatch(/^--[a-z-]+$/);
      const value = declValue(root, token);
      expect(value, `${token} in :root`).not.toBeNull();
      expect(value!.toLowerCase(), hue).toBe(GLASS_ANSI[i + 1]!.toLowerCase());
    });
    expect(ansiClass('red')).toBe('ansi-red');
    expect(ANSI_HUE_TOKEN.muted).toBe('--syn-comment');
    expect(Object.keys(ANSI_HUE_TOKEN)).toHaveLength(7);
  });
});
