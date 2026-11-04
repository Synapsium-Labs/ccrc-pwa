// The frame CSP battery's channels, as frame-side JavaScript (native Docs reader, the reader lab plan of 2026-11-03,
// Task 6; the rich-docs spec's rows M8.B1 and M10.16): one object literal whose keys are L0's LAB_BATTERY_CHANNELS, in
// order, each a function of one URL that tries to load from it or send to it. Text, never run in the console: the reader
// lab's wall and control frames inline it (`frameScripts.ts`), and the desktop browser leg
// (`pwa/browser/reader-frame.browser.test.ts`) evaluates the same text inside the reader frame, so both run one battery.
// Ring L1: two string constants.

/** What the channels need in scope: the SVG namespace (a name, not a URL anything loads) and `mount`. */
export const LAB_BATTERY_PRELUDE_JS = "const ns = 'http://www.w3.org/2000/svg';\n"
  + 'const mount = (el) => { (document.body || document.documentElement).append(el); return el; };';

/** The 27 channels. */
export const LAB_BATTERY_CHANNELS_JS = `{
  'fetch-cors': (u) => fetch(u, { mode: 'cors' }).catch(() => 0),
  'fetch-nocors': (u) => fetch(u, { mode: 'no-cors' }).catch(() => 0),
  'fetch-credentials': (u) => fetch(u, { mode: 'cors', credentials: 'include' }).catch(() => 0),
  'fetch-post': (u) => fetch(u, { method: 'POST', body: 'x', mode: 'no-cors' }).catch(() => 0),
  'fetch-keepalive': (u) => fetch(u, { keepalive: true, mode: 'no-cors' }).catch(() => 0),
  'xhr-get': (u) => { const x = new XMLHttpRequest(); x.open('GET', u); x.send(); },
  'xhr-post': (u) => { const x = new XMLHttpRequest(); x.open('POST', u); x.send('x'); },
  'beacon': (u) => { navigator.sendBeacon(u, 'x'); },
  'websocket': (u) => { const w = new WebSocket(u.replace('http', 'ws')); w.onerror = () => {}; },
  'eventsource': (u) => { const s = new EventSource(u); s.onerror = () => s.close(); },
  'image': (u) => { const i = new Image(); i.src = u; },
  'image-srcset': (u) => { const i = document.createElement('img'); i.srcset = u + ' 1x'; mount(i); },
  'script': (u) => { const s = document.createElement('script'); s.src = u; mount(s); },
  'script-module': (u) => { const s = document.createElement('script'); s.type = 'module'; s.src = u; mount(s); },
  'link-stylesheet': (u) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u; mount(l); },
  'link-prefetch': (u) => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = u; mount(l); },
  'link-preload': (u) => { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = u; mount(l); },
  'link-modulepreload': (u) => { const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = u; mount(l); },
  'style-import': (u) => { const s = document.createElement('style'); s.textContent = '@import url("' + u + '");'; mount(s); },
  'css-background': (u) => { const d = document.createElement('div'); d.style.cssText = 'width:10px;height:10px;background-image:url("' + u + '")'; mount(d); },
  'css-font-face': (u) => {
    const s = document.createElement('style'); s.textContent = '@font-face{font-family:bat;src:url("' + u + '")}.bat{font-family:bat}'; mount(s);
    const p = document.createElement('p'); p.className = 'bat'; p.textContent = 'x'; mount(p);
  },
  'css-content-url': (u) => {
    const s = document.createElement('style'); s.textContent = '.cu::before{content:url("' + u + '")}'; mount(s);
    const d = document.createElement('div'); d.className = 'cu'; d.textContent = 'x'; mount(d);
  },
  'audio': (u) => { const a = new Audio(); a.preload = 'auto'; a.src = u; a.load(); },
  'video': (u) => { const v = document.createElement('video'); v.preload = 'auto'; v.src = u; mount(v); v.load(); },
  'svg-image': (u) => {
    const s = document.createElementNS(ns, 'svg'); const i = document.createElementNS(ns, 'image');
    i.setAttribute('href', u); i.setAttribute('width', '10'); i.setAttribute('height', '10'); s.append(i); mount(s);
  },
  'import-dynamic': (u) => import(u).catch(() => 0),
  'iframe': (u) => { const f = document.createElement('iframe'); f.src = u; mount(f); },
}`;
