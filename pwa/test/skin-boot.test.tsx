// THE SKIN'S APP HALF: storage -> document, at boot and on a choice (D-5093).
//
// `skin-catalogue.test.ts` covers @ccrc/ui's pure half. This covers what the
// app owns: the stored choice and its fallbacks when storage throws, the
// `useSkin()` subscription W2's shells will branch on, and the pre-paint
// snippet in `index.html`, which runs before the bundle exists and so cannot
// import a single constant. That snippet is a second copy by necessity, so it
// is BOUND here: it is run for real, against the same stored values `initSkin`
// sees, and the two must stamp the same thing — except for garbage, where the
// snippet stamps verbatim (it never re-lists the catalogue) and the frame
// renders `:root`, which is Refined, until `initSkin` corrects the attribute.
//
// And the per-device default's app half (D-5096): the device is read ONCE per
// page load, at `initSkin()`, and never subscribed to or re-read on any event,
// so a skin never flips under the person using it; the snippet carries the
// same rule behind a literal that mirrors Instrument's preview flag, bound
// here to `skins.ts`. Instrument stopped being a preview in S18 (D-5096,
// D-6389), so the shipped catalogue and the snippet as committed are the world
// in which a desk boots into Instrument; the PREVIEW world, which a future skin
// may need again, is pinned by injection (`asPreview`, `snippetAsPreview`), so
// the `!instrument.preview` half of `resolveSkin` stays guarded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AUTO, DEVICE_QUERY, INSTRUMENT, REFINED, SKINS, SKIN_STORAGE_KEY } from '@ccrc/ui';
import { initSkin, setSkin, useSkin } from '../src/lib/skin';

const INDEX = path.join(import.meta.dirname, '..', 'index.html');
const SKINS_CSS = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'skins.css');

const stamped = (): string | null => document.documentElement.getAttribute('data-skin');

/** The one inline pre-paint script that stamps `data-skin`. Exactly one: a
 *  second would be a second copy of the rule, and none is a page whose first
 *  frame cannot know the stored skin. */
function skinSnippet(): string {
  const html = readFileSync(INDEX, 'utf8');
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1] as string);
  const hits = inline.filter((s) => /data-skin/.test(s));
  expect(hits, 'index.html carries no pre-paint skin stamp').toHaveLength(1);
  return hits[0] as string;
}

/** The primary input a test boots on: a desk answers DEVICE_QUERY, a touch
 *  device does not, and an unreadable one has a `matchMedia` that throws (an
 *  old engine, a locked-down embed) — which both halves read as not a desk. */
type Device = 'desk' | 'touch' | 'unreadable';
const DEVICES: readonly Device[] = ['desk', 'touch', 'unreadable'];

/** A `matchMedia` for `device` that records every query it is asked. Only the
 *  exact DEVICE_QUERY matches on a desk, so a snippet asking anything else is
 *  read as a touch device — and the matrix below sees the disagreement. */
function deviceMedia(device: Device, asked: string[] = []): (q: string) => MediaQueryList {
  return (q: string) => {
    asked.push(q);
    if (device === 'unreadable') throw new Error('matchMedia unavailable');
    return {
      matches: device === 'desk' && q === DEVICE_QUERY, media: q, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

/** What the snippet stamps, run as the browser runs it: against a storage
 *  stub, a device and a fresh <html>. `null` from `getItem` is a missing
 *  value. `code` defaults to the snippet as committed. */
function runSnippet(
  getItem: (key: string) => string | null,
  device: Device = 'touch',
  code: string = skinSnippet(),
  asked: string[] = [],
): string | null {
  const el = document.createElement('html');
  new Function('localStorage', 'document', 'matchMedia', code)(
    { getItem }, { documentElement: el }, deviceMedia(device, asked));
  return el.getAttribute('data-skin');
}

/** The snippet's code with its comments gone — what the browser runs, and what
 *  the literal censuses below read. */
const bare = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The snippet's preview literal: `AUTO_DESK = <true|false>`, exactly once. */
const AUTO_DESK = /\bAUTO_DESK\s*=\s*(true|false)\b/g;

/** The snippet in the PREVIEW world: the literal set to `false`, the flag's
 *  other half, as it stood before S18 and as it would stand again for a skin
 *  whose shell has not landed. Reds if the literal is not there to set. */
function snippetAsPreview(): string {
  const code = bare(skinSnippet());
  expect([...code.matchAll(AUTO_DESK)], 'the snippet carries no AUTO_DESK literal').toHaveLength(1);
  return code.replace(AUTO_DESK, 'AUTO_DESK = false');
}

/** Run `fn` with Instrument a preview again — the world before S18 — and
 *  restore the flag after. The flag is set on the catalogue's own entry, so
 *  every reader sees it, `resolveSkin`'s default catalogue included. The
 *  shipped catalogue is the other world and needs no injection. */
function asPreview<T>(fn: () => T): T {
  const entry = SKINS.find((s) => s.id === INSTRUMENT) as { preview: boolean } | undefined;
  expect(entry, 'the catalogue has no Instrument entry to flip').toBeDefined();
  const was = entry!.preview;
  entry!.preview = true;
  try {
    return fn();
  } finally {
    entry!.preview = was;
  }
}

/** The ids skins.css answers — a stamped value outside this set renders `:root`. */
const answered = (): string[] =>
  [...readFileSync(SKINS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/\[data-skin='([^']+)'\]/g)].map((m) => m[1] as string);

const throwingStorage = {
  getItem(): never { throw new Error('denied'); },
  setItem(): never { throw new Error('denied'); },
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-skin');
  initSkin();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  initSkin();
});

describe('the skin at boot', () => {
  it('initSkin stamps the stored choice', () => {
    localStorage.setItem(SKIN_STORAGE_KEY, INSTRUMENT);
    initSkin();
    expect(stamped()).toBe(INSTRUMENT);
    localStorage.setItem(SKIN_STORAGE_KEY, REFINED);
    initSkin();
    expect(stamped()).toBe(REFINED);
  });

  it('with nothing stored, a skin is stamped — never left absent (refined where the device is not a desk)', () => {
    // No `matchMedia` stub here: `test/setup.ts` shims one that matches
    // nothing, so the device is not a desk and the stamp is Refined and, above
    // all, PRESENT.
    localStorage.removeItem(SKIN_STORAGE_KEY);
    document.documentElement.removeAttribute('data-skin');
    initSkin();
    expect(stamped()).toBe(REFINED);
  });

  it('storage that throws leaves refined stamped, and nothing throws', () => {
    // Private windows, previews and thumbnail capture throw on storage, and
    // this runs before first render: an exception here is a blank app.
    document.documentElement.setAttribute('data-skin', INSTRUMENT);
    vi.stubGlobal('localStorage', throwingStorage);
    expect(() => initSkin()).not.toThrow();
    expect(stamped()).toBe(REFINED);
    // A choice still applies for the session; it just will not survive a reload.
    expect(() => setSkin(INSTRUMENT)).not.toThrow();
    expect(stamped()).toBe(INSTRUMENT);
  });
});

describe('main.tsx', () => {
  /** Boot the real `main.tsx` once, from a fresh module registry, with the
   *  page as the pre-paint snippet left it. The mount is a stub that records
   *  the stamp at the moment React would first render; the app itself and the
   *  service worker are not this test's business (`main-bootstrap` has them). */
  async function boot(stored: string | null, prestamped: string | null): Promise<string | null | undefined> {
    let atRender: string | null | undefined;
    vi.resetModules();
    vi.doMock('virtual:pwa-register', () => ({ registerSW: () => {} }));
    vi.doMock('react-dom/client', () => ({
      createRoot: () => ({ render: () => { atRender = stamped(); }, unmount: () => {} }),
    }));
    vi.doMock('../src/app', () => ({ App: () => null }));
    try {
      document.body.innerHTML = '<div id="root"></div>';
      localStorage.clear();
      if (stored !== null) localStorage.setItem(SKIN_STORAGE_KEY, stored);
      if (prestamped === null) document.documentElement.removeAttribute('data-skin');
      else document.documentElement.setAttribute('data-skin', prestamped);
      await import('../src/main');
      return atRender;
    } finally {
      vi.doUnmock('virtual:pwa-register');
      vi.doUnmock('react-dom/client');
      vi.doUnmock('../src/app');
      vi.resetModules();
      document.body.innerHTML = '';
    }
  }

  it('resolves the stored skin before the app first renders', async () => {
    // WIRED, not just written: `initSkin` is correct in isolation (above), and
    // nothing in that proves `main.tsx` calls it. Without the call, the
    // snippet's verbatim stamp of an unknown value stays on the page — `:root`
    // renders, while `useSkin()` answers Refined from its own state — and a
    // page whose snippet never ran (blocked inline script) boots unstamped.
    // Recorded AT the render, so a call moved after `render(...)` reds too.
    const stale = 'skin-from-a-newer-build';
    expect(await boot(stale, stale), 'an unknown stored value is corrected before render').toBe(REFINED);
    expect(await boot(INSTRUMENT, null), 'the stored choice is stamped before render').toBe(INSTRUMENT);
    expect(await boot(null, null), 'nothing stored is stamped refined, never left absent').toBe(REFINED);
  });
});

describe('a choice', () => {
  function Probe(): ReactNode {
    return <span data-testid="skin">{useSkin()}</span>;
  }

  it('setSkin re-renders a useSkin consumer with the new id', () => {
    render(<Probe />);
    expect(screen.getByTestId('skin').textContent).toBe(REFINED);
    act(() => setSkin(INSTRUMENT));
    expect(screen.getByTestId('skin').textContent).toBe(INSTRUMENT);
    expect(stamped()).toBe(INSTRUMENT);
    expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(INSTRUMENT);
    act(() => setSkin(REFINED));
    expect(screen.getByTestId('skin').textContent).toBe(REFINED);
    expect(stamped()).toBe(REFINED);
  });

  it('an unknown id resolves to refined rather than stamping an attribute no block answers', () => {
    act(() => setSkin('soft-glass'));
    expect(stamped()).toBe(REFINED);
  });
});

describe('the per-device default (D-5096)', () => {
  /** A `matchMedia` whose answer can change under the page — a tablet docking
   *  a keyboard, device emulation toggled in a desktop browser — and which
   *  records every query it is asked (`reads`) and every way a caller could
   *  subscribe to it: `addEventListener`, the legacy `addListener`, and
   *  `onchange`. */
  function liveDevice(desk: boolean): {
    matchMedia: (q: string) => MediaQueryList;
    change: (next: boolean) => void;
    subscribers: () => number;
    reads: () => readonly string[];
  } {
    let isDesk = desk;
    type Heard = (e: { matches: boolean; media: string }) => void;
    const heard: Heard[] = [];
    const lists: { onchange: Heard | null }[] = [];
    const asked: string[] = [];
    return {
      matchMedia: (q: string) => {
        asked.push(q);
        const list = {
          get matches(): boolean { return isDesk && q === DEVICE_QUERY; },
          media: q,
          onchange: null as Heard | null,
          addEventListener: (_type: string, cb: Heard): void => { heard.push(cb); },
          addListener: (cb: Heard): void => { heard.push(cb); },
          removeEventListener: (): void => {},
          removeListener: (): void => {},
          dispatchEvent: (): boolean => false,
        };
        lists.push(list);
        return list as unknown as MediaQueryList;
      },
      change: (next: boolean) => {
        isDesk = next;
        const e = { matches: next, media: DEVICE_QUERY };
        for (const cb of heard) cb(e);
        for (const list of lists) list.onchange?.(e);
      },
      subscribers: () => heard.length + lists.filter((l) => l.onchange !== null).length,
      reads: () => [...asked],
    };
  }

  /** What else fires around a device change while the page lives, each a way
   *  to re-resolve WITHOUT subscribing to the query: a resize (a docked
   *  keyboard, devtools' device toolbar, a rotated tablet), a rotation, the
   *  tab coming back to the foreground, the window regaining focus, a
   *  back-forward cache restore, and a minute of timers for a poll. Each is
   *  fired at `window` or `document` as the browser fires it. */
  const NUDGES: readonly (readonly [name: string, fire: () => void])[] = [
    ['resize', () => window.dispatchEvent(new Event('resize'))],
    ['orientationchange', () => window.dispatchEvent(new Event('orientationchange'))],
    ['visibilitychange', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['focus', () => window.dispatchEvent(new Event('focus'))],
    ['pageshow', () => window.dispatchEvent(new Event('pageshow'))],
    ['a minute of timers', () => vi.advanceTimersByTime(60_000)],
  ];

  it('AUTO is resolved once per load: a device change mid-session changes nothing, whatever fires, and a reload re-resolves', async () => {
    // O2: a skin never flips under the person using it. Under W2's
    // `SKIN_SETS[useSkin()].Shell` a live re-resolve would remount the shell
    // mid-task — which is why this departs from `initTheme`, which does follow
    // the colour scheme live. Run against the shipped catalogue, in which the
    // device decides anything (while Instrument was a preview, AUTO was Refined
    // everywhere and a flip would have been invisible).
    //
    // ONCE is pinned two ways. The device is READ once — `matchMedia` is asked
    // DEVICE_QUERY at boot and never again until a reload, whatever fires — so
    // a re-read from any trigger reds even when it happens to answer the same.
    // And the STAMP never changes after boot, after the device change and
    // after each nudge in turn, so a re-resolve from any trigger reds by name.
    // A subscription is the third way, counted at the end. Fake timers are
    // installed before the boot, so a poll the boot starts is under them.
    // Each nudge is followed by an awaited zero-time advance, which drains the
    // microtask queue too, so a re-stamp the handler defers (an `await`, a
    // `queueMicrotask`) is seen as well; that is why the case is async.
    const device = liveDevice(true);
    vi.stubGlobal('matchMedia', device.matchMedia);
    vi.useFakeTimers();
    try {
      localStorage.removeItem(SKIN_STORAGE_KEY);
      initSkin();
      expect(stamped(), 'a desk with nothing stored boots into Instrument').toBe(INSTRUMENT);
      expect(device.reads(), 'the boot did not read the device exactly once').toEqual([DEVICE_QUERY]);

      device.change(false);
      expect(stamped(), 'the skin flipped under the person using it').toBe(INSTRUMENT);
      for (const [name, fire] of NUDGES) {
        fire();
        await vi.advanceTimersByTimeAsync(0);
        expect(stamped(), `the skin flipped under the person using it on ${name}`).toBe(INSTRUMENT);
        expect(device.reads(), `the device was read again on ${name}`).toEqual([DEVICE_QUERY]);
      }

      // "Match this device", chosen now, resolves against the BOOT reading,
      // and is remembered as the choice itself rather than as its answer.
      setSkin(AUTO);
      expect(stamped(), 'Match this device re-read the device mid-session').toBe(INSTRUMENT);
      expect(localStorage.getItem(SKIN_STORAGE_KEY)).toBe(AUTO);
      expect(device.reads(), 'Match this device read the device again').toEqual([DEVICE_QUERY]);

      // A reload is a new reading — the one other read there is.
      initSkin();
      expect(stamped(), 'a reload re-resolves').toBe(REFINED);
      expect(device.reads(), 'a reload reads the device once more').toEqual([DEVICE_QUERY, DEVICE_QUERY]);
    } finally {
      vi.useRealTimers();
    }
    expect(device.subscribers(), 'something subscribed to the device query').toBe(0);
  });

  it('a desk boots into Instrument with nothing stored, and a touch device into Refined', () => {
    // S18 (D-5096, D-6389): the shipped catalogue has no preview, so the
    // per-device default selects people. Every spelling of "no choice" — nothing
    // stored, empty, `auto`, a skin from a newer build — answers by the device.
    for (const v of [null, '', AUTO, 'skin-from-a-newer-build']) {
      localStorage.clear();
      if (v !== null) localStorage.setItem(SKIN_STORAGE_KEY, v);
      vi.stubGlobal('matchMedia', liveDevice(true).matchMedia);
      initSkin();
      expect(stamped(), `${String(v)} on a desk`).toBe(INSTRUMENT);
      vi.stubGlobal('matchMedia', liveDevice(false).matchMedia);
      initSkin();
      expect(stamped(), `${String(v)} on a touch device`).toBe(REFINED);
    }
  });

  it('a desk boots into Refined while Instrument is a preview: AUTO waits for the flag', () => {
    // The preview world, by injection: a skin whose shell has not landed is
    // selectable but never the default, so `resolveSkin`'s `!preview` half
    // stays pinned now that the shipped catalogue no longer exercises it.
    vi.stubGlobal('matchMedia', liveDevice(true).matchMedia);
    asPreview(() => {
      for (const v of [null, '', AUTO, 'skin-from-a-newer-build']) {
        localStorage.clear();
        if (v !== null) localStorage.setItem(SKIN_STORAGE_KEY, v);
        initSkin();
        expect(stamped(), String(v)).toBe(REFINED);
      }
    });
  });
});

describe("index.html's pre-paint stamp", () => {
  /** A stored value: `value` under the skin key (absent: nothing stored), or a
   *  store that throws, as a private window's does. */
  interface Stored { readonly name: string; readonly value?: string; readonly throws?: true }
  const STORED: readonly Stored[] = [
    { name: 'missing' },
    { name: 'empty', value: '' },
    { name: 'auto', value: AUTO },
    { name: 'refined', value: REFINED },
    { name: 'instrument', value: INSTRUMENT },
    { name: 'garbage', value: 'skin-from-a-newer-build' },
    { name: 'throwing', throws: true },
  ];
  const getItemOf = (s: Stored) => (key: string): string | null => {
    if (s.throws) throw new Error('denied');
    return key === SKIN_STORAGE_KEY && s.value !== undefined ? s.value : null;
  };

  /** What `initSkin` stamps at a fresh boot on this storage and device. */
  function bootStamp(s: Stored, device: Device): string | null {
    vi.stubGlobal('localStorage', {
      getItem: getItemOf(s), setItem: () => {}, removeItem: () => {}, clear: () => {},
    });
    vi.stubGlobal('matchMedia', deviceMedia(device));
    try {
      initSkin();
      return stamped();
    } finally {
      vi.unstubAllGlobals();
    }
  }

  /** The skin each cell must boot into, said once, here, so the two halves
   *  cannot agree on a wrong answer. */
  function expected(s: Stored, device: Device, preview: boolean): string {
    if (s.value === REFINED || s.value === INSTRUMENT) return s.value;
    return !preview && device === 'desk' ? INSTRUMENT : REFINED;
  }

  it('the pre-paint snippet renders what initSkin renders across stored ∈ {missing, empty, auto, refined, instrument, garbage, throwing} × device ∈ {desk, touch, unreadable}', () => {
    // Twice. As shipped, where Instrument is no longer a preview and a desk
    // boots into Instrument; and in the preview world, both halves set back —
    // the flag in skins.ts, the literal in the snippet — where AUTO is Refined
    // on every device. The second world is never committed: it proves the
    // snippet's RULE is the one initSkin runs, not merely its literal.
    for (const preview of [false, true]) {
      const code = preview ? snippetAsPreview() : skinSnippet();
      for (const s of STORED) {
        for (const d of DEVICES) {
          const cell = `${preview ? 'as a preview' : 'as shipped'}: ${s.name} on ${d}`;
          let fromSnippet: string | null = null;
          expect(() => { fromSnippet = runSnippet(getItemOf(s), d, code); }, cell).not.toThrow();
          const fromBoot = preview ? asPreview(() => bootStamp(s, d)) : bootStamp(s, d);
          expect(fromBoot, cell).toBe(expected(s, d, preview));
          if (s.name === 'garbage') {
            // VERBATIM: the snippet never re-lists the catalogue. No block in
            // skins.css answers the value, so the first frame is `:root` —
            // Refined — and initSkin then stamps the resolution.
            expect(fromSnippet, cell).toBe(s.value);
            expect(answered(), cell).not.toContain(s.value);
          } else {
            expect(fromSnippet, cell).toBe(fromBoot);
          }
        }
      }
    }
  });

  it("the snippet's query is DEVICE_QUERY and its AUTO_DESK is !preview", () => {
    // The literal MIRRORS the flag, so a commit that changes Instrument's
    // `preview` reds here until it changes this literal too: the one commit
    // moves the desktop default in both halves at once, and the first frame
    // agrees with the boot (S18 set both, D-5096) for every value this build
    // knows. A stored value it does not know is the one exception: on a desk
    // the snippet paints Refined (`:root`) for one frame, before the boot
    // resolves it to Instrument (D-6721, index.html).
    const literal = [...bare(skinSnippet()).matchAll(AUTO_DESK)];
    expect(literal, 'AUTO_DESK is not one literal').toHaveLength(1);
    const preview = SKINS.find((s) => s.id === INSTRUMENT)?.preview;
    expect(preview).toBeTypeOf('boolean');
    expect(literal[0]?.[1], 'AUTO_DESK is not !preview').toBe(String(!preview));

    // The query, read at RUN time, where it matters: the snippet as committed
    // asks matchMedia exactly DEVICE_QUERY, once, and only a desk that answers
    // it gets Instrument. In the preview world it asks nothing at all, and a
    // desk gets Refined.
    const asked: string[] = [];
    expect(runSnippet(() => null, 'desk', skinSnippet(), asked)).toBe(INSTRUMENT);
    expect(asked, 'the snippet asks a query other than DEVICE_QUERY').toEqual([DEVICE_QUERY]);
    asked.length = 0;
    expect(runSnippet(() => null, 'touch', skinSnippet(), asked)).toBe(REFINED);
    expect(asked).toEqual([DEVICE_QUERY]);
    asked.length = 0;
    expect(runSnippet(() => null, 'desk', snippetAsPreview(), asked), 'a preview is never the default').toBe(REFINED);
    expect(asked, 'the preview world still asks the device').toEqual([]);
  });

  it("the snippet names SKIN_STORAGE_KEY, AUTO and DEVICE_QUERY, and REFINED and INSTRUMENT once each as the device rule's results — no other skin id", () => {
    // The bound literals. The snippet cannot import the catalogue, so the key,
    // AUTO, the query and the rule's two results are a second copy by
    // necessity, checked here. Each is said ONCE. A second REFINED or
    // INSTRUMENT would be the snippet comparing what it read against the
    // catalogue — validating, which it never does: a stored value is stamped
    // verbatim — and any OTHER id would be the start of a re-listed catalogue,
    // which single-definition forbids and which this file refuses first.
    const literals = [...bare(skinSnippet()).matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((m) => m[1] ?? m[2]);
    const count = (v: string): number => literals.filter((l) => l === v).length;
    expect(count(SKIN_STORAGE_KEY), 'the storage key').toBe(1);
    expect(count(AUTO), "'auto', Match this device").toBe(1);
    expect(count(DEVICE_QUERY), 'the device query').toBe(1);
    expect(count(REFINED), "refined, the device rule's default").toBe(1);
    expect(count(INSTRUMENT), "instrument, the device rule's desk result").toBe(1);
    const others = new Set<string>(SKINS.map((s) => s.id).filter((id) => id !== REFINED && id !== INSTRUMENT));
    expect(literals.filter((l) => l !== undefined && others.has(l))).toEqual([]);
  });
});
