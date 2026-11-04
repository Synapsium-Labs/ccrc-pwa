// The reader lab's frames (native Docs reader, the reader lab plan of 2026-11-03, Task 6; the rich-docs spec's rows
// M10.9, M10.10, M10.11, M10.16): `readerLab/frames.ts`, `readerLab/frameScripts.ts`, `readerLab/battery.ts` and
// `docs/reader/labPolicy.ts` in jsdom. Every frame is the reader frame's shape; only the wall frame carries a policy, the
// library's own with exactly two sources added; every URL a frame can form is the console's origin plus this run's
// probe path; the battery is L0's 27 channels in order.
import { afterEach, describe, expect, it } from 'vitest';
import { frameCsp } from '@synapsium-labs/docserver/frame';
import { LAB_BATTERY_CHANNELS, LAB_PROBE_NAMES, readerLabProbeBase } from '../../shared/readerLab';
import { LAB_BATTERY_CHANNELS_JS } from '../src/readerLab/battery';
import { AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, LAB_FRAME_SCRIPTS } from '../src/readerLab/frameScripts';
import { LAB_SANDBOX, labDataText, labSrcdoc, mountLabFrame } from '../src/readerLab/frames';
import { labWallCsp } from '../src/docs/reader/labPolicy';

const ORIGIN = 'https://box.example';
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const BASE = `${ORIGIN}${readerLabProbeBase(NONCE)}`;
const CANARY = `${BASE}csp-canary`;
const SCRIPT_NONCE = 'Zm9vYmFyYmF6cXV4MTIzNA';
const SVG_NS = 'http://www.w3.org/2000/svg';

afterEach(() => {
  document.body.replaceChildren();
});

/** A policy's directives, each name to its sources. */
const directives = (p: string): Map<string, string[]> => new Map(p.split(';').map((d) => d.trim()).filter((d) => d !== '')
  .map((d): [string, string[]] => {
    const [name, ...sources] = d.split(/\s+/);
    return [name ?? '', sources];
  }));

const stage = (): HTMLElement => {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
};

describe('the reader lab frames (reader lab plan, Task 6)', () => {
  it("every lab frame is the reader frame's shape: sandbox exactly allow-scripts, a srcdoc, no-referrer, nothing that loads (M10.9)", () => {
    expect(LAB_SANDBOX).toBe('allow-scripts');
    const s = stage();
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) {
      const f = mountLabFrame(s, { script, config: { base: BASE } }, () => SCRIPT_NONCE);
      const el = s.querySelector('iframe');
      expect(el, name).not.toBeNull();
      expect(el!.getAttribute('sandbox'), name).toBe('allow-scripts');
      expect(el!.getAttribute('referrerpolicy'), name).toBe('no-referrer');
      expect(el!.getAttribute('srcdoc'), name).toContain(script);
      for (const a of ['src', 'name', 'allow', 'allowfullscreen', 'csp']) expect(el!.hasAttribute(a), `${name} ${a}`).toBe(false);
      f.remove();
      expect(s.querySelector('iframe'), name).toBeNull();
    }
  });

  it('the data block is the element just before the one script, and its text can end neither its element nor its line', () => {
    const hostile = { base: BASE, label: '</script><script>x()</script>\u2028\u2029' };
    const doc = new DOMParser().parseFromString(labSrcdoc({ script: BUSY_SCRIPT, config: hostile }, null, null), 'text/html');
    const scripts = [...doc.body.querySelectorAll('script')];
    expect(scripts).toHaveLength(2);
    expect(scripts[0]!.getAttribute('type')).toBe('application/json');
    expect(scripts[0]!.nextElementSibling).toBe(scripts[1]);
    expect(scripts[1]!.textContent).toBe(BUSY_SCRIPT);
    expect(labDataText(hostile)).not.toMatch(/[<\u2028\u2029]/);
    expect(JSON.parse(scripts[0]!.textContent ?? '')).toEqual(hostile);
  });

  it('only the wall frame carries a policy: frameCsp() plus its nonce in script-src and the canary in img-src, as the meta and the csp attribute (M10.10)', () => {
    const s = stage();
    mountLabFrame(s, { script: BATTERY_SCRIPT, config: { base: BASE, prefix: 'csp-', canary: true }, wall: { canary: CANARY } }, () => SCRIPT_NONCE);
    const el = s.querySelector('iframe')!;
    const policy = el.getAttribute('csp') ?? '';
    const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(policy);
    const got = directives(policy);
    const lib = directives(frameCsp());
    expect([...got.keys()]).toEqual([...lib.keys()]);
    for (const [name, sources] of lib) {
      const extra = name === 'script-src' ? [`'nonce-${SCRIPT_NONCE}'`] : name === 'img-src' ? [CANARY] : [];
      expect(got.get(name), name).toEqual([...sources, ...extra]);
    }
    expect(doc.body.querySelectorAll('script')[1]?.getAttribute('nonce')).toBe(SCRIPT_NONCE);
  });

  it('labWallCsp refuses anything but one nonce source and one URL with no separator in it', () => {
    const cases: readonly (readonly [string, string])[] = [
      ["'unsafe-inline'", CANARY], ["'nonce-abc def'", CANARY], [`'nonce-${SCRIPT_NONCE}'`, 'https://a.example; connect-src *'],
      [`'nonce-${SCRIPT_NONCE}'`, '*'], [`'nonce-${SCRIPT_NONCE}'`, "https://a.example/x'"], [`'nonce-${SCRIPT_NONCE}'`, 'https://a.example/x y'],
    ];
    for (const [source, canary] of cases) expect(() => labWallCsp(source, canary), `${source} ${canary}`).toThrow(TypeError);
  });

  it('every URL any lab frame can form is the console origin plus this run\'s probe path (M10.11)', () => {
    const urlsIn = (t: string): string[] => t.match(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`)<>\\]*/gi) ?? [];
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) {
      expect(urlsIn(script), `${name} spells a URL of its own`).toEqual(script.includes(SVG_NS) ? [SVG_NS] : []);
      const policy = name === 'battery' ? labWallCsp(`'nonce-${SCRIPT_NONCE}'`, CANARY) : null;
      for (const url of urlsIn(labSrcdoc({ script, config: { base: BASE } }, policy, null))) {
        expect(url === SVG_NS || url.startsWith(BASE), `${name}: ${url}`).toBe(true);
      }
    }
  });

  it("the battery source names L0's 27 channels, in order, and is what the battery script inlines (M10.16)", () => {
    const keys = [...LAB_BATTERY_CHANNELS_JS.matchAll(/^\s*'([a-z-]+)': \(u\)/gm)].map((m) => m[1]);
    expect(keys).toEqual([...LAB_BATTERY_CHANNELS]);
    expect(BATTERY_SCRIPT).toContain(LAB_BATTERY_CHANNELS_JS);
  });

  it('every probe a script names is in the vocabulary, and the ambient keys are the seven the vocabulary holds', () => {
    const named = Object.values(LAB_FRAME_SCRIPTS)
      .flatMap((s) => [...s.matchAll(/'((?:cookie|ambient|csp|ctl|popup|top|self|busy|strays|hostile)-[a-z-]+)'/g)].map((m) => m[1]!));
    expect(named.length).toBeGreaterThan(20);
    for (const n of named) expect(LAB_PROBE_NAMES, n).toContain(n);
    const keys = [...AMBIENT_SCRIPT.matchAll(/report\('([a-z]+)'/g)].map((m) => m[1]);
    expect([...new Set(keys)]).toEqual(['parent', 'origin', 'cookie', 'local', 'session', 'idb', 'caches']);
  });

  it('no script holds a script close, and the builder refuses one', () => {
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) expect(script.toLowerCase().includes('</script'), name).toBe(false);
    expect(() => labSrcdoc({ script: 'x</script>y', config: { base: BASE } }, null, null)).toThrow();
  });
});
