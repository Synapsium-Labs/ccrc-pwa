// The reader's appearance map, as pure rules (native Docs reader, appearance continuity, Task 2; design 2026-11-18 §2, §3
// and §7). `readerAppearanceOf` builds the library's raw contract from token text exactly as the document root answers
// it, passes it through the library's own `parseAppearance`, and returns the verdict: these rows pin that it checks no
// range or grammar of its own (each refused value below is first shown refused BY THE LIBRARY, so a fixture never
// stands in for a range ccrc spells itself). `resolvePaletteTokens` is the helper the source scan and these rows read
// real palettes through.
import { describe, expect, it, vi } from 'vitest';
import { APPEARANCE_CONTRACT, APPEARANCE_SLOTS, parseAppearance } from '@synapsium-labs/pinax-lib/frame';
import {
  READER_APPEARANCE_CONTRACTS, READER_APPEARANCE_LABEL, READER_APPEARANCE_MAP, readerAppearanceOf,
  readerAppearanceSupported, type HostToken,
} from '../src/docs/reader/appearance';
import { resolvePaletteTokens } from './helpers/paletteTokens';
import { SKINS, THEMES } from '@ccrc/ui';

// A spy over the library's validator that still calls it: the "text as read" row reads what it was handed.
vi.mock('@synapsium-labs/pinax-lib/frame', async (importOriginal) => {
  const real = await importOriginal<typeof import('@synapsium-labs/pinax-lib/frame')>();
  return { ...real, parseAppearance: vi.fn(real.parseAppearance) };
});

/** A reader answering a real palette's tokens, with some answered otherwise. */
function readerOf(over: Readonly<Record<string, string>> = {}, theme = 'phosphor', skin = 'refined', pointer: 'fine' | 'coarse' = 'coarse'):
  (token: HostToken) => string {
  const { tokens } = resolvePaletteTokens(theme, skin, pointer);
  return (token) => over[token] ?? tokens.get(token) ?? '';
}

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

describe('readerAppearanceOf', () => {
  it('every mapped token: the colour and skin keys equal the library slots both ways, nothing refused, the label is ccrc\'s', () => {
    const out = readerAppearanceOf(readerOf(), 'dark');
    expect(out.value.mode).toBe('dark');
    expect(sorted(Object.keys(out.value.colour ?? {}))).toEqual(sorted(APPEARANCE_SLOTS.colour));
    expect(sorted(Object.keys(out.value.skin ?? {}))).toEqual(sorted(APPEARANCE_SLOTS.skin));
    expect(out.refused).toEqual([]);
    expect(out.dropped).toBeNull();
    expect(out.value.label).toBe(READER_APPEARANCE_LABEL);
  });

  it('one colour token answering \'\' gives a value with mode set, no colour group, and colour-unreadable naming the token', () => {
    const out = readerAppearanceOf(readerOf({ '--bg-raised': '' }), 'dark');
    expect(out.value.mode).toBe('dark');
    expect(out.value.colour).toBeUndefined();
    expect(out.dropped).toEqual({ why: 'colour-unreadable', token: '--bg-raised' });
    // The skin and the label are not touched by a colour that cannot be read.
    expect(Object.keys(out.value.skin ?? {})).toHaveLength(APPEARANCE_SLOTS.skin.length);
    expect(out.value.label).toBe(READER_APPEARANCE_LABEL);
  });

  it('a colour the verdict refuses: mode set, no colour group, colour-refused naming the token, refused naming the slot', () => {
    const bad = 'rgb(1, 2, 3)';
    const colours = Object.fromEntries(APPEARANCE_SLOTS.colour.map((s) => [s, '#102030']));
    // The fixture is only a fixture if the library itself refuses it.
    const lib = parseAppearance({ mode: 'dark', colour: { ...colours, accent: bad } });
    expect(lib.refused.map((r) => r.key)).toContain('colour.accent');
    expect(lib.appearance.colour).toBeUndefined();

    const out = readerAppearanceOf(readerOf({ '--accent': bad }), 'dark');
    expect(out.value.mode).toBe('dark');
    expect(out.value.colour).toBeUndefined();
    expect(out.dropped).toEqual({ why: 'colour-refused', token: '--accent' });
    expect(out.refused.map((r) => r.key)).toContain('colour.accent');
  });

  it('an unreadable skin token keeps every colour, leaves that slot out, and drops nothing', () => {
    const out = readerAppearanceOf(readerOf({ '--r-md': '' }), 'dark');
    expect(Object.keys(out.value.colour ?? {})).toHaveLength(APPEARANCE_SLOTS.colour.length);
    expect(out.value.skin).toBeDefined();
    expect(out.value.skin).not.toHaveProperty('radius');
    expect(out.value.skin).toHaveProperty('radiusSmall');
    expect(out.dropped).toBeNull();
  });

  it('support is decided once: contract 1 is supported, a library with none and one newer than ccrc knows are not', () => {
    expect(readerAppearanceSupported(1)).toBe(true);
    expect(readerAppearanceSupported('none')).toBe(false);
    expect(readerAppearanceSupported(2)).toBe(false);
    // The installed library's own contract is one ccrc supports.
    expect(READER_APPEARANCE_CONTRACTS).toContain(APPEARANCE_CONTRACT);
  });

  it('a colour scheme of \'normal\' or \'\' gives mode auto, no colour group, and scheme-unreadable; the scheme is trimmed', () => {
    for (const scheme of ['normal', '']) {
      const out = readerAppearanceOf(readerOf(), scheme);
      expect(out.value.mode).toBe('auto');
      expect(out.value.colour).toBeUndefined();
      expect(out.dropped?.why).toBe('scheme-unreadable');
    }
    const padded = readerAppearanceOf(readerOf(), ' light ');
    expect(padded.value.mode).toBe('light');
    expect(padded.dropped).toBeNull();
  });

  it('a skin token whose value the library refuses is left out by the verdict, and every colour stays', () => {
    // `--row-h` answering 60px: the library's own range refuses it (28 to 56), not ccrc.
    expect(parseAppearance({ mode: 'dark', skin: { controlRow: '60px' } }).refused.map((r) => r.key)).toContain('skin.controlRow');
    const out = readerAppearanceOf(readerOf({ '--row-h': '60px' }), 'dark');
    expect(out.value.skin).not.toHaveProperty('controlRow');
    expect(out.value.skin).toHaveProperty('radius');
    expect(out.refused.map((r) => r.key)).toContain('skin.controlRow');
    expect(Object.keys(out.value.colour ?? {})).toHaveLength(APPEARANCE_SLOTS.colour.length);
    expect(out.dropped).toBeNull();
  });

  it('text as read: the raw contract carries each token exactly as read, and the verdict (not ccrc) drops the outer spaces', () => {
    const spy = vi.mocked(parseAppearance);
    spy.mockClear();
    const out = readerAppearanceOf(readerOf({ '--bg-page': '#2E3440', '--r-md': ' 10px' }), 'dark');
    const raw = spy.mock.calls.at(-1)?.[0] as { colour: Record<string, string>; skin: Record<string, string> };
    expect(raw.colour.bg).toBe('#2E3440');
    expect(raw.skin.radius).toBe(' 10px');
    expect(out.value.colour?.bg).toBe('#2E3440');
    expect(out.value.skin?.radius).toBe('10px');
    expect(out.refused).toEqual([]);
  });

  it('strings only: every leaf of the built raw contract is a string, sectionWeight included', () => {
    const spy = vi.mocked(parseAppearance);
    spy.mockClear();
    readerAppearanceOf(readerOf(), 'dark');
    const raw = spy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    const leaves: unknown[] = [];
    const walk = (x: unknown): void => {
      if (typeof x === 'object' && x !== null) for (const v of Object.values(x)) walk(v);
      else leaves.push(x);
    };
    walk(raw);
    expect(leaves.length).toBeGreaterThan(40);
    expect(leaves.every((v) => typeof v === 'string')).toBe(true);
    expect((raw['skin'] as Record<string, unknown>)['sectionWeight']).toBe('600');
  });

  it('section family: the same text as --family-mono is mono, as --family-ui is sans, any other text leaves the slot out', () => {
    const base = { '--family-mono': 'MONO STACK', '--family-ui': 'UI STACK' };
    expect(readerAppearanceOf(readerOf({ ...base, '--family-section': 'MONO STACK' }), 'dark').value.skin?.sectionFamily).toBe('mono');
    expect(readerAppearanceOf(readerOf({ ...base, '--family-section': 'UI STACK' }), 'dark').value.skin?.sectionFamily).toBe('sans');
    const other = readerAppearanceOf(readerOf({ ...base, '--family-section': 'SOMETHING ELSE' }), 'dark');
    expect(other.value.skin).not.toHaveProperty('sectionFamily');
    expect(other.dropped).toBeNull();
  });

  it('its serialised value is at most 4096 bytes, in every palette, skin and pointer', () => {
    let widest = 0;
    for (const t of THEMES) for (const s of SKINS) for (const p of ['fine', 'coarse'] as const) {
      const { tokens, colourScheme } = resolvePaletteTokens(t.id, s.id, p);
      const out = readerAppearanceOf((tok) => tokens.get(tok) ?? '', colourScheme);
      widest = Math.max(widest, new TextEncoder().encode(JSON.stringify(out.value)).length);
    }
    expect(widest).toBeGreaterThan(0);
    expect(widest).toBeLessThanOrEqual(4096);
  });

  it('the mapping table names a ccrc token for every slot', () => {
    for (const group of [READER_APPEARANCE_MAP.colour, READER_APPEARANCE_MAP.skin]) {
      for (const token of Object.values(group)) expect(token).toMatch(/^--[a-z0-9-]+$/);
    }
  });
});

describe('resolvePaletteTokens', () => {
  it('phosphor, refined, coarse answers --r-md as 10px (the second default block) and a dark colour scheme', () => {
    const r = resolvePaletteTokens('phosphor', 'refined', 'coarse');
    expect(r.tokens.get('--r-md')).toBe('10px');
    expect(r.colourScheme).toBe('dark');
  });

  it('nord, instrument, fine answers --row-h as 32px and --bg-page as #2E3440', () => {
    const r = resolvePaletteTokens('nord', 'instrument', 'fine');
    expect(r.tokens.get('--row-h')).toBe('32px');
    expect(r.tokens.get('--bg-page')).toBe('#2E3440');
    // The coarse pointer keeps the tap floor.
    expect(resolvePaletteTokens('nord', 'instrument', 'coarse').tokens.get('--row-h')).toBe('44px');
  });

  it('a var() chain is followed: --status-done answers a hex in light', () => {
    const r = resolvePaletteTokens('light', 'refined', 'coarse');
    expect(r.tokens.get('--status-done')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(r.colourScheme).toBe('light');
    // The light palette overrides the default page colour without copying the palette's value into the test.
    expect(r.tokens.get('--bg-page')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(r.tokens.get('--bg-page')).not.toBe(resolvePaletteTokens('phosphor', 'refined', 'coarse').tokens.get('--bg-page'));
  });
});
