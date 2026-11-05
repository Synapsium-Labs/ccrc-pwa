// The reader lab frames' scripts (native Docs reader, the reader lab plan of 2026-11-03, Task 6; the reader lab design,
// section 3). Text, never run in the console: `frames.ts` inlines one of these into each lab frame's srcdoc, after a JSON
// data block the script reads by position (the element just before it), so a script's text never varies and nothing
// about a run is spelled in it. Every script reports only by loading `<base><name>` as an image, `base` being this run's
// probe path on the console's own origin (M10.11); a name says what happened (`…-held`, `…-broke`), and no value a script
// reads is ever sent. A store a script manages to open is deleted at once. Classic scripts, ES2017 at most.
// Ring L1: string constants.
import { LAB_BATTERY_CHANNELS_JS, LAB_BATTERY_PRELUDE_JS } from './battery';

/** Reads the data block and defines `url(name)` and `hit(name)`. Every script starts with it. */
const PRELUDE = [
  'var cfg = JSON.parse(document.currentScript.previousElementSibling.textContent);',
  "var url = function (name) { return cfg.base + name; };",
  'var hit = function (name) { var i = new Image(); i.src = url(name); return i; };',
].join('\n');

/** Opaque origin and ambient state (lab 1-2, M8.B3): `held` when the frame cannot reach the thing, `broke` when it can. */
export const AMBIENT_SCRIPT = `(function () {
${PRELUDE}
var report = function (key, held) { hit('ambient-' + key + (held ? '-held' : '-broke')); };
try { void parent.document.title; report('parent', false); } catch (e) { report('parent', true); }
report('origin', String(self.origin) === 'null');
try { report('cookie', document.cookie === ''); } catch (e) { report('cookie', true); }
try { void localStorage.length; report('local', false); } catch (e) { report('local', true); }
try { void sessionStorage.length; report('session', false); } catch (e) { report('session', true); }
try {
  var r = indexedDB.open('ccrc-reader-lab');
  r.onsuccess = function () { try { r.result.close(); indexedDB.deleteDatabase('ccrc-reader-lab'); } catch (e) {} report('idb', false); };
  r.onerror = function () { report('idb', true); };
} catch (e) { report('idb', true); }
try {
  if (typeof caches === 'undefined') { report('caches', true); } else {
    caches.open('ccrc-reader-lab').then(function () { caches.delete('ccrc-reader-lab'); report('caches', false); }, function () { report('caches', true); });
  }
} catch (e) { report('caches', true); }
})();`;

/** No cookie on frame requests (lab 1-2, M8.B2): every credentialed channel to the door, then a sign that it ran. */
export const COOKIE_SCRIPT = `(function () {
${PRELUDE}
var none = function () {};
try { fetch(url('cookie-fetch'), { credentials: 'include' }).catch(none); } catch (e) {}
try { var h = {}; h[cfg.marker] = cfg.markerValue; fetch(url('cookie-fetch-marker'), { credentials: 'include', headers: h }).catch(none); } catch (e) {}
try { var x = new XMLHttpRequest(); x.open('GET', url('cookie-xhr')); x.withCredentials = true; x.send(); } catch (e) {}
try { navigator.sendBeacon(url('cookie-beacon'), 'x'); } catch (e) {}
try { var w = new WebSocket(url('cookie-websocket').replace(/^http/, 'ws')); w.onerror = none; } catch (e) {}
try { hit('cookie-image'); } catch (e) {}
setTimeout(function () { hit('cookie-ran'); }, 300);
})();`;

/** The one channel that does not run in the battery: a dynamic import takes its nonce from the script that calls it, so
 *  from the battery's nonce'd script it would reach what the reader frame's hash-only scripts cannot. It runs from its
 *  own constant script, `LAB_IMPORT_SCRIPT`, which the wall policy allows by hash. */
export const LAB_IMPORT_CHANNEL = 'import-dynamic';

/** The window property the import script sets before it imports: the battery's sign that the script ran. */
export const LAB_IMPORT_MARK = 'ccrcLabImportRan';

/** The dynamic-import channel's script (the reader lab design, section 3.1; the lab's wall frame allows it by hash, as the
 *  reader frame allows its own scripts). Constant text on one line each: its sha256 below is of exactly this text. It
 *  reads the data block just before it, sets the mark, and imports `<base><prefix>import-dynamic`. It runs in both the
 *  wall frame and the control frame, before the battery. */
export const LAB_IMPORT_SCRIPT = [
  '(function () {',
  'var cfg = JSON.parse(document.currentScript.previousElementSibling.textContent);',
  `window.${LAB_IMPORT_MARK} = true;`,
  `import(cfg.base + cfg.prefix + '${LAB_IMPORT_CHANNEL}').catch(function () {});`,
  '})();',
].join('\n');

/** The CSP hash source of `LAB_IMPORT_SCRIPT`, declared once. No run-time hashing: `crypto.subtle` needs a secure context
 *  and a box over plain HTTP is not one. `reader-lab-frames.test.ts` hashes the shipped text and pins it equal. */
export const LAB_IMPORT_SCRIPT_SHA256 = 'sha256-RUqyX54BLN90Rd98EvQDICTn0kVK5pAY31kNiLY5E2E=';

/** The frame CSP battery (M8.B1): the wall frame first requests its canary, the one URL its policy allows, and only when
 *  the import script ran before it (so a wall frame whose hash script never ran reads "canary missing", never "holds");
 *  then every channel but the import to `<base><prefix><channel>`; the control frame, with no policy, the same channels
 *  under its own prefix. */
export const BATTERY_SCRIPT = `(function () {
${PRELUDE}
${LAB_BATTERY_PRELUDE_JS}
var channels = ${LAB_BATTERY_CHANNELS_JS};
if (cfg.canary === true && window.${LAB_IMPORT_MARK} === true) hit('csp-canary');
Object.keys(channels).forEach(function (name) { if (name === '${LAB_IMPORT_CHANNEL}') return; try { channels[name](url(cfg.prefix + name)); } catch (e) {} });
})();`;

/** No popup, no top navigation (E1, M8.B4), after the operator's tap: every target is a door URL answering 204. */
export const POPUP_SCRIPT = `(function () {
${PRELUDE}
var b = document.createElement('button');
b.type = 'button';
b.textContent = cfg.label;
b.style.cssText = 'font: inherit; padding: 12px 20px; margin: 16px; min-height: 44px;';
(document.body || document.documentElement).append(b);
var done = false;
b.addEventListener('click', function () {
  if (done) return;
  done = true;
  var w = null;
  try { w = window.open(url('popup-open'), '_blank'); } catch (e) {}
  hit(w === null || w === undefined ? 'popup-null' : 'popup-window');
  try { void top.location.href; hit('top-read-broke'); } catch (e) { hit('top-read-held'); }
  try { top.location = url('top-nav'); hit('top-write-returned'); } catch (e) { hit('top-write-threw'); }
  try { var a = document.createElement('a'); a.href = url('popup-blank'); a.target = '_blank'; (document.body || document.documentElement).append(a); a.click(); } catch (e) {}
  setTimeout(function () { hit('popup-ran'); }, 300);
});
})();`;

/** The frame cannot navigate itself (E11): it says it tried, then sets its own location to a door URL. */
export const SELF_NAV_SCRIPT = `(function () {
${PRELUDE}
hit('self-nav-tried');
setTimeout(function () { location.href = url('self-nav'); }, 200);
})();`;

/** A busy frame (E17): it marks its start, spins for the configured time, and marks its end. */
export const BUSY_SCRIPT = `(function () {
${PRELUDE}
hit('busy-start');
var t = Date.now();
while (Date.now() - t < cfg.spinMs) { /* the console's thread is measured while this spins */ }
hit('busy-end');
})();`;

/** How many stray messages the stray frame posts (the result's detail). */
export const LAB_STRAYS_POSTED = 8;

/** Stray messages (M8.B5's stray half): well-formed ops, an unknown one and an oversize one, each on the window. */
export const STRAYS_SCRIPT = `(function () {
${PRELUDE}
var post = function (m) { try { parent.postMessage(m, '*'); } catch (e) {} };
post({ t: 'navigate', href: 'stray.md' });
post({ t: 'hash', id: 'reader-lab-stray' });
post({ t: 'copy', text: 'reader lab stray' });
post({ t: 'store.set', key: 'pref:prefs', value: '{}' });
post({ t: 'ready', v: 1, nonce: '00000000000000000000000000000000' });
post({ t: 'error', why: 'boot' });
post({ t: 'reader-lab-unknown' });
post({ t: 'navigate', href: new Array(5001).join('x') });
hit('strays-sent');
})();`;

/** Every frame script, by name: the tests and the scans walk it. */
export const LAB_FRAME_SCRIPTS: Readonly<Record<string, string>> = {
  ambient: AMBIENT_SCRIPT, cookie: COOKIE_SCRIPT, import: LAB_IMPORT_SCRIPT, battery: BATTERY_SCRIPT, popup: POPUP_SCRIPT,
  selfNav: SELF_NAV_SCRIPT, busy: BUSY_SCRIPT, strays: STRAYS_SCRIPT,
};
