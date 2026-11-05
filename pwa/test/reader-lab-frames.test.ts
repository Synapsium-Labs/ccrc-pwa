// The reader lab's frames (native Docs reader, the reader lab plan of 2026-11-03, Task 6; the rich-docs spec's rows
// M10.9, M10.10, M10.11, M10.16): `readerLab/frames.ts`, `readerLab/frameScripts.ts`, `readerLab/battery.ts` and
// `docs/reader/labPolicy.ts` in jsdom. Every frame is the reader frame's shape; only the wall frame carries a policy, the
// library's own with exactly two sources added; every URL a frame can form is the console's origin plus this run's
// probe path; the battery is L0's 27 channels in order.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { frameCsp } from '@synapsium-labs/docserver/frame';
import { LAB_BATTERY_CHANNELS, LAB_PROBE_NAMES, readerLabProbeBase } from '../../shared/readerLab';
import { LAB_BATTERY_CHANNELS_JS } from '../src/readerLab/battery';
import {
  AMBIENT_SCRIPT, BATTERY_SCRIPT, BUSY_SCRIPT, LAB_FRAME_SCRIPTS, LAB_IMPORT_CHANNEL, LAB_IMPORT_MARK, LAB_IMPORT_SCRIPT, LAB_IMPORT_SCRIPT_SHA256,
} from '../src/readerLab/frameScripts';
import { LAB_SANDBOX, labDataText, labSrcdoc, mountLabFrame } from '../src/readerLab/frames';
import { labWallCsp } from '../src/docs/reader/labPolicy';

const ORIGIN = 'https://box.example';
const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA';
const BASE = `${ORIGIN}${readerLabProbeBase(NONCE)}`;
const CANARY = `${BASE}csp-canary`;
const SCRIPT_NONCE = 'Zm9vYmFyYmF6cXV4MTIzNA';
const SVG_NS = 'http://www.w3.org/2000/svg';
const HASH_SOURCE = `'${LAB_IMPORT_SCRIPT_SHA256}'`;

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

  it('only the wall frame carries a policy: frameCsp() plus its nonce and the import script\'s hash in script-src and the canary in img-src, as the meta and the csp attribute (M10.10)', () => {
    const s = stage();
    mountLabFrame(s, { script: BATTERY_SCRIPT, config: { base: BASE, prefix: 'csp-', canary: true }, importChannel: true, wall: { canary: CANARY } }, () => SCRIPT_NONCE);
    const el = s.querySelector('iframe')!;
    const policy = el.getAttribute('csp') ?? '';
    const doc = new DOMParser().parseFromString(el.getAttribute('srcdoc') ?? '', 'text/html');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toBe(policy);
    const got = directives(policy);
    const lib = directives(frameCsp());
    expect([...got.keys()]).toEqual([...lib.keys()]);
    for (const [name, sources] of lib) {
      const extra = name === 'script-src' ? [`'nonce-${SCRIPT_NONCE}'`, HASH_SOURCE] : name === 'img-src' ? [CANARY] : [];
      expect(got.get(name), name).toEqual([...sources, ...extra]);
    }
    const scripts = [...doc.body.querySelectorAll('script')];
    expect(scripts.map((x) => x.getAttribute('nonce'))).toEqual([null, null, null, SCRIPT_NONCE]);
  });

  it('labWallCsp accepts exactly one nonce, one sha256 and one URL with no separator in it, and refuses anything else', () => {
    const nonce = `'nonce-${SCRIPT_NONCE}'`;
    const cases: readonly (readonly [string, string, string])[] = [
      ["'unsafe-inline'", HASH_SOURCE, CANARY], ["'nonce-abc def'", HASH_SOURCE, CANARY], [nonce, HASH_SOURCE, 'https://a.example; connect-src *'],
      [nonce, HASH_SOURCE, '*'], [nonce, HASH_SOURCE, "https://a.example/x'"], [nonce, HASH_SOURCE, 'https://a.example/x y'],
      [nonce, "'unsafe-inline'", CANARY], [nonce, `'sha256-${'A'.repeat(42)}='`, CANARY], [nonce, `'sha512-${'A'.repeat(43)}='`, CANARY],
      [nonce, `${HASH_SOURCE} 'sha256-${'B'.repeat(43)}='`, CANARY], [nonce, `'sha256-${'A'.repeat(43)}=' *`, CANARY], [nonce, '', CANARY],
    ];
    for (const [source, hash, canary] of cases) expect(() => labWallCsp(source, hash, canary), `${source} ${hash} ${canary}`).toThrow(TypeError);
    const got = directives(labWallCsp(nonce, HASH_SOURCE, CANARY));
    const lib = directives(frameCsp());
    expect(got.get('script-src')).toEqual([...(lib.get('script-src') ?? []), nonce, HASH_SOURCE]);
    expect(got.get('img-src')).toEqual([...(lib.get('img-src') ?? []), CANARY]);
    for (const [name, sources] of lib) if (name !== 'script-src' && name !== 'img-src') expect(got.get(name), name).toEqual(sources);
  });

  it('the import script\'s hash constant is the sha256 of the shipped text, and the text is what the frame inlines without a nonce', () => {
    expect(`sha256-${createHash('sha256').update(LAB_IMPORT_SCRIPT, 'utf8').digest('base64')}`).toBe(LAB_IMPORT_SCRIPT_SHA256);
    const doc = new DOMParser().parseFromString(labSrcdoc({ script: BATTERY_SCRIPT, config: { base: BASE, prefix: 'csp-', canary: true }, importChannel: true }, null, SCRIPT_NONCE), 'text/html');
    const scripts = [...doc.body.querySelectorAll('script')];
    expect(scripts.map((x) => x.getAttribute('type'))).toEqual(['application/json', null, 'application/json', null]);
    expect(scripts[1]!.textContent).toBe(LAB_IMPORT_SCRIPT);
    expect(scripts[1]!.getAttribute('nonce')).toBeNull();
    expect(scripts[1]!.previousElementSibling).toBe(scripts[0]);
    expect(scripts[3]!.previousElementSibling).toBe(scripts[2]);
    expect(scripts[2]!.textContent).toBe(scripts[0]!.textContent);
    expect(scripts[3]!.getAttribute('nonce')).toBe(SCRIPT_NONCE);
    // A frame without the channel carries neither the import script nor a second data block.
    const plain = new DOMParser().parseFromString(labSrcdoc({ script: BATTERY_SCRIPT, config: { base: BASE } }, null, null), 'text/html');
    expect(plain.body.querySelectorAll('script')).toHaveLength(2);
    expect(plain.body.innerHTML).not.toContain(LAB_IMPORT_SCRIPT);
  });

  /** Runs a frame script's own text with a stub document and the requests it makes recorded. `channels` replaces the
   *  battery's channel object, so no channel does anything; the gate and the loop are the script's own. */
  const run = (script: string, config: Record<string, unknown>, win: Record<string, unknown>) => {
    const requested: string[] = [];
    class FakeImage {
      set src(v: string) {
        requested.push(v);
      }
    }
    const document = { currentScript: { previousElementSibling: { textContent: JSON.stringify(config) } } };
    new Function('document', 'window', 'Image', script)(document, win, FakeImage);
    return requested;
  };

  it('the battery asks for its canary only after the import script ran, and runs no import channel itself; the import script marks, then imports', () => {
    const bare = BATTERY_SCRIPT.replace(LAB_BATTERY_CHANNELS_JS, '{}');
    expect(bare).not.toBe(BATTERY_SCRIPT);
    const wall = { base: BASE, prefix: 'csp-', canary: true };
    expect(run(bare, wall, { [LAB_IMPORT_MARK]: true })).toEqual([`${BASE}csp-canary`]);
    // The hash script did not run: no mark, so no canary and the wall reads "canary missing", never "holds".
    expect(run(bare, wall, {})).toEqual([]);
    expect(run(bare, wall, { [LAB_IMPORT_MARK]: false })).toEqual([]);
    expect(run(bare, { base: BASE, prefix: 'ctl-', canary: false }, { [LAB_IMPORT_MARK]: true })).toEqual([]);
    // With the channels in, the import channel is the one the battery leaves to its own script.
    const names: string[] = [];
    const spy = BATTERY_SCRIPT.replace(LAB_BATTERY_CHANNELS_JS, `new Proxy({}, { ownKeys: () => ${JSON.stringify(['fetch-cors', LAB_IMPORT_CHANNEL, 'image'])}, getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }), get: (t, k) => (u) => names.push(String(k) + '=' + u) })`);
    new Function('document', 'window', 'Image', 'names', spy)({ currentScript: { previousElementSibling: { textContent: JSON.stringify(wall) } } }, {}, class {}, names);
    expect(names).toEqual([`fetch-cors=${BASE}csp-fetch-cors`, `image=${BASE}csp-image`]);
    // The import script: the mark is set before the import is asked for, and the URL is the data block's.
    const win: Record<string, unknown> = {};
    const imported: string[] = [];
    const importing = LAB_IMPORT_SCRIPT.replace('import(', 'importStub(');
    new Function('document', 'window', 'importStub', importing)(
      { currentScript: { previousElementSibling: { textContent: JSON.stringify(wall) } } }, win,
      (u: string) => {
        expect(win[LAB_IMPORT_MARK]).toBe(true);
        imported.push(u);
        return Promise.resolve();
      },
    );
    expect(imported).toEqual([`${BASE}csp-${LAB_IMPORT_CHANNEL}`]);
  });

  it('every URL any lab frame can form is the console origin plus this run\'s probe path (M10.11)', () => {
    const urlsIn = (t: string): string[] => t.match(/[a-z][a-z0-9+.-]*:\/\/[^\s'"`)<>\\]*/gi) ?? [];
    for (const [name, script] of Object.entries(LAB_FRAME_SCRIPTS)) {
      expect(urlsIn(script), `${name} spells a URL of its own`).toEqual(script.includes(SVG_NS) ? [SVG_NS] : []);
      const policy = name === 'battery' ? labWallCsp(`'nonce-${SCRIPT_NONCE}'`, HASH_SOURCE, CANARY) : null;
      for (const url of urlsIn(labSrcdoc({ script, config: { base: BASE }, importChannel: name === 'battery' }, policy, null))) {
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
