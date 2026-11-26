// The PDF frame's bootstrap (X2 spec 2026-11-18 section 4.4; plan Task P3.2): the one script of ccrc's own that runs
// INSIDE the frame, after the viewer (pdf.js's display layer, its `build/pdf.min.mjs`, which sets
// `globalThis.pdfjsLib`). Ring L1: a constant, its text hashed by the assets loader for the frame's policy.
//
// What it does, and what it never does:
//   - It reads the seed (the PDF's bytes, the parser's text, the standard fonts and the CMaps, all inline) and draws
//     each page on a canvas, lazily, one column at the frame's width, with Fit width, smaller and larger.
//   - The parser runs in a worker made from a `blob:` URL of its text inside the frame, so the worker inherits the
//     frame's policy and has no network. Where the engine will not start that worker (a module worker in an opaque
//     origin), it runs the same text on the frame's own thread, as a hashed inline script (spec 4.4's fallback).
//   - Fonts and CMaps come from the seed through a binary-data factory, `useWorkerFetch` off, so nothing is fetched.
//     `useSystemFonts` is off too: with it on, pdf.js names a standard font's file by URL in an `@font-face` (measured in
//     Chromium: a request for `fonts/LiberationSans-Regular.ttf`, which the policy refused), instead of reading it here.
//     WebAssembly is off (`useWasm: false`); XFA, scripting and the rendering worker are off.
//   - A link annotation is drawn as a box with NO `href`: tapping it shows its target as text, to read or copy, and a
//     link to a place in the same PDF scrolls there. No link is followed: the frame has no channel to the console and
//     never navigates.
//   - The bootstrap listens only for readiness on the Worker object it created, never on any Window or external port.
// The status rides `data-state` (`loading`, `shown`, `failed`) and `data-parser` (`worker`, `own-thread`) on `<body>`,
// which the browser tests read; so does `data-refused`, the count of the frame's own policy refusals (a later pdf.js
// that needs a source the policy lacks reds the browser row that reads it).

import { DOCS_IMAGE_VIEW_MAX_PIXELS } from '../../../../shared/docs';

/** Inert seed marker for the pixel-limit reason, not an image codec. */
export const PDF_IMAGE_OVER_LIMIT = 'over-limit';

/** Plain ES2017 in one IIFE. The assets loader hashes the final text, including the shared image limit. */
export const PDF_BOOT_JS = `(function () {
  'use strict';
  // Frame-local marks for the browser lab; they are never sent to the host.
  performance.mark('pdf-boot');
  var body = document.body;
  var pagesEl = document.getElementById('pdf-pages');
  var noteEl = document.getElementById('pdf-note');
  var linkEl = document.getElementById('pdf-link');
  function state(s) { body.setAttribute('data-state', s); }
  function note(text) { noteEl.textContent = text; noteEl.hidden = text === ''; }
  state('loading');
  var refused = 0;
  document.addEventListener('securitypolicyviolation', function (e) {
    refused += 1;
    body.setAttribute('data-refused', String(refused));
    body.setAttribute('data-refused-last', String(e.effectiveDirective) + ' ' + String(e.blockedURI));
  });
  function fromB64(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  var seedEl = document.getElementById('pdf-seed');
  var seed;
  try { seed = JSON.parse(seedEl.textContent); } catch (e) { state('failed'); note('The PDF viewer could not read its page.'); return; }
  seedEl.textContent = '';
  var lib = globalThis.pdfjsLib;
  if (!lib) { state('failed'); note('The PDF viewer did not start.'); return; }
  var data = fromB64(seed.pdf);
  seed.pdf = '';
  var overLimit = ${JSON.stringify(PDF_IMAGE_OVER_LIMIT)};
  var codecs = seed.undrawn.filter(function (kind) { return kind !== overLimit; });
  var imageReasons = [];
  if (seed.undrawn.includes(overLimit)) imageReasons.push('one or more are larger than the reader’s image limit');
  if (codecs.length > 0) imageReasons.push(codecs.join(', ') + ' images need WebAssembly, which this viewer keeps off');
  if (imageReasons.length > 0) {
    note('Some images in this PDF are not shown here: ' + imageReasons.join('; ') + '. Download the file to see them.');
  }
  function SeedFactory() {}
  SeedFactory.prototype.fetch = function (req) {
    var table = req.kind === 'cMapUrl' ? seed.cmaps : req.kind === 'standardFontDataUrl' ? seed.fonts : null;
    var hit = table !== null && Object.prototype.hasOwnProperty.call(table, req.filename) ? table[req.filename] : null;
    if (hit === null) return Promise.reject(new Error('not in this page: ' + req.filename));
    return Promise.resolve(fromB64(hit));
  };
  function params() {
    return {
      data: data.slice(), useWasm: false, useWorkerFetch: false, disableWorkerRendering: true, enableXfa: false,
      isOffscreenCanvasSupported: false, cMapUrl: 'cmaps/', cMapPacked: true, standardFontDataUrl: 'fonts/',
      BinaryDataFactory: SeedFactory, stopAtErrors: false, useSystemFonts: false,
      maxImageSize: ${DOCS_IMAGE_VIEW_MAX_PIXELS},
      // Eligible RGB JPEGs can still take the native ImageDecoder path without off-screen canvas rendering.
      // This is its resize target, not an allocation limit.
      canvasMaxAreaInBytes: 4 * MAX_CANVAS_PIXELS,
    };
  }
  var doc = null;
  var scale = 1;
  var boxes = [];
  var sizes = [];
  var laidWidth = 0;
  var laidScale = 0;
  var viewPending = false;
  var stores = new Map();
  var NEAR_MARGIN = 800;
  var MAX_CANVASES = 4;
  var MAX_CANVAS_PIXELS = 4 * 1024 * 1024;
  var MAX_CANVAS_SIDE = 4096;
  function showTarget(text) {
    linkEl.textContent = text;
    linkEl.hidden = false;
    var range = document.createRange();
    range.selectNodeContents(linkEl);
    var sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }
  function linkTarget(a) {
    if (typeof a.url === 'string' && a.url !== '') return { text: a.url };
    if (typeof a.unsafeUrl === 'string' && a.unsafeUrl !== '') return { text: a.unsafeUrl };
    if (a.dest) return { text: 'A place in this PDF', dest: a.dest };
    if (a.action) return { text: 'A ' + a.action + ' action (not run)' };
    if (a.attachment || a.attachmentDest) return { text: 'A file attached to this PDF (not opened)' };
    return { text: 'A link this viewer does not follow' };
  }
  function goTo(dest) {
    var named = typeof dest === 'string' ? doc.getDestination(dest) : Promise.resolve(dest);
    named.then(function (d) {
      if (!Array.isArray(d) || d.length === 0) return null;
      var ref = d[0];
      return typeof ref === 'number' ? ref : doc.getPageIndex(ref);
    }).then(function (i) {
      if (typeof i === 'number' && boxes[i]) boxes[i].scrollIntoView();
    }, function () { /* an unknown place: nothing moves */ });
  }
  function drawLinks(page, vp, box, store) {
    return page.getAnnotations({ intent: 'display' }).then(function (annots) {
      if (stores.get(box) !== store) return;
      annots.forEach(function (a) {
        if (a.subtype !== 'Link' || !Array.isArray(a.rect)) return;
        var t = linkTarget(a);
        var p1 = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
        var p2 = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
        var r = lib.Util.normalizeRect([p1[0], p1[1], p2[0], p2[1]]);
        var tag = document.createElement('span');
        tag.className = 'pdf-link';
        tag.setAttribute('role', 'button');
        tag.setAttribute('tabindex', '0');
        tag.setAttribute('data-target', t.text);
        tag.setAttribute('aria-label', 'Link: ' + t.text);
        tag.title = t.text;
        tag.style.left = r[0] + 'px';
        tag.style.top = r[1] + 'px';
        tag.style.width = (r[2] - r[0]) + 'px';
        tag.style.height = (r[3] - r[1]) + 'px';
        function act(e) {
          e.preventDefault();
          if (t.dest) goTo(t.dest);
          showTarget(t.text);
        }
        tag.addEventListener('click', act);
        tag.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') act(e); });
        box.appendChild(tag);
      });
    });
  }
  function release(box, store) {
    stores.delete(box);
    if (store.task) store.task.cancel();
    if (store.page) store.page.cleanup();
    if (store.canvas) {
      // Release the backing pixels now, even while pdf.js or the browser still holds the element.
      store.canvas.width = 0;
      store.canvas.height = 0;
    }
    box.textContent = '';
  }
  function drawPage(box, i) {
    if (stores.has(box)) return Promise.resolve();
    var store = { canvas: null, task: null, page: null };
    stores.set(box, store);
    return doc.getPage(i + 1).then(function (page) {
      if (stores.get(box) !== store) return;
      store.page = page;
      var vp = page.getViewport({ scale: Number(box.getAttribute('data-scale')) });
      if (!(vp.width > 0 && vp.height > 0 && Number.isFinite(vp.width * vp.height))) throw new Error('invalid page size');
      var ratio = Math.min(window.devicePixelRatio || 1, 2, MAX_CANVAS_SIDE / Math.max(vp.width, vp.height),
        Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height)));
      var canvas = document.createElement('canvas');
      store.canvas = canvas;
      canvas.width = Math.max(1, Math.floor(vp.width * ratio));
      canvas.height = Math.max(1, Math.floor(vp.height * ratio));
      canvas.style.width = Math.floor(vp.width) + 'px';
      canvas.style.height = Math.floor(vp.height) + 'px';
      box.appendChild(canvas);
      store.task = page.render({ canvas: canvas, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
      return store.task.promise.then(function () {
        if (stores.get(box) !== store) return;
        store.task = null;
        return drawLinks(page, vp, box, store);
      });
    }).catch(function (err) {
      if (stores.get(box) !== store) return;
      release(box, store);
      throw err;
    });
  }
  function drawLater(box) {
    var i = Number(box.getAttribute('data-page')) - 1;
    return drawPage(box, i).catch(function () {
      if (!stores.has(box)) box.textContent = 'This page could not be drawn. Download the PDF to open it.';
    });
  }
  // Boxes are in page order. Find the nearby run without walking every page on each scroll.
  function pageAt(y) {
    var lo = 0;
    var hi = boxes.length;
    while (lo < hi) {
      var i = Math.floor((lo + hi) / 2);
      if (boxes[i].getBoundingClientRect().bottom <= y) lo = i + 1;
      else hi = i;
    }
    return lo;
  }
  function chooseNear() {
    var height = window.innerHeight;
    var mid = height / 2;
    var near = [];
    for (var i = pageAt(-NEAR_MARGIN); i < boxes.length; i += 1) {
      var box = boxes[i];
      var r = box.getBoundingClientRect();
      if (r.top >= height + NEAR_MARGIN) break;
      near.push({ box: box, distance: Math.max(r.top - mid, mid - r.bottom, 0) });
    }
    near.sort(function (a, b) { return a.distance - b.distance; });
    var keep = near.slice(0, MAX_CANVASES).map(function (item) { return item.box; });
    stores.forEach(function (store, box) { if (!keep.includes(box)) release(box, store); });
    keep.forEach(drawLater);
  }
  function fitWidth() {
    return Math.max(1, (pagesEl.clientWidth || document.documentElement.clientWidth || 600) - 16);
  }
  function sizePages(width) {
    stores.forEach(function (store, box) { release(box, store); });
    var pixels = width * scale;
    boxes.forEach(function (box, i) {
      var base = sizes[i];
      box.setAttribute('data-scale', String(pixels / base.width));
      box.style.width = Math.floor(pixels) + 'px';
      box.style.height = Math.max(1, Math.floor(pixels * (base.height / base.width))) + 'px';
    });
    laidWidth = width;
    laidScale = scale;
    document.getElementById('pdf-zoom').textContent = Math.round(scale * 100) + '%';
  }
  function preparePages() {
    var chain = Promise.resolve();
    for (var n = 1; n <= doc.numPages; n += 1) {
      (function (n) {
        chain = chain.then(function () { return doc.getPage(n); }).then(function (page) {
          var base = page.getViewport({ scale: 1 });
          if (!(base.width > 0 && base.height > 0 && Number.isFinite(base.width * base.height))) throw new Error('invalid page size');
          var box = document.createElement('div');
          box.className = 'pdf-page';
          box.setAttribute('data-page', String(n));
          pagesEl.appendChild(box);
          boxes.push(box);
          sizes.push(base);
        });
      })(n);
    }
    return chain.then(function () {
      if (body.getAttribute('data-state') !== 'loading') return;
      body.setAttribute('data-pages', String(doc.numPages));
      sizePages(fitWidth());
      // Do not report a draw until the first canvas has actually painted.
      return drawPage(boxes[0], 0);
    });
  }
  function updateView() {
    if (viewPending || body.getAttribute('data-state') !== 'shown') return;
    viewPending = true;
    window.requestAnimationFrame(function () {
      viewPending = false;
      if (body.getAttribute('data-state') !== 'shown') return;
      var width = fitWidth();
      if (width !== laidWidth || scale !== laidScale) {
        var y = window.innerHeight / 2;
        var box = boxes[Math.min(pageAt(y), boxes.length - 1)];
        var before = box.getBoundingClientRect();
        var fraction = Math.max(0, Math.min(1, (y - before.top) / before.height));
        sizePages(width);
        var after = box.getBoundingClientRect();
        window.scrollBy(0, after.top + after.height * fraction - y);
      }
      chooseNear();
    });
  }
  function zoomTo(next) {
    if (body.getAttribute('data-state') !== 'shown') return;
    scale = Math.max(0.5, Math.min(4, next));
    updateView();
  }
  window.addEventListener('resize', updateView);
  window.addEventListener('scroll', updateView, { passive: true });
  document.getElementById('pdf-smaller').addEventListener('click', function () { zoomTo(scale * 0.8); });
  document.getElementById('pdf-larger').addEventListener('click', function () { zoomTo(scale * 1.25); });
  document.getElementById('pdf-fit').addEventListener('click', function () { zoomTo(1); });
  var pinch = null;
  function span(touches) {
    return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
  }
  pagesEl.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 2) { pinch = null; return; }
    e.preventDefault();
    pinch = { span: Math.max(1, span(e.touches)), scale: scale };
  }, { passive: false });
  pagesEl.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    zoomTo(pinch.scale * span(e.touches) / pinch.span);
  }, { passive: false });
  pagesEl.addEventListener('touchend', function () { pinch = null; });
  pagesEl.addEventListener('touchcancel', function () { pinch = null; });
  function failed(e) {
    state('failed');
    stores.forEach(function (store, box) { release(box, store); });
    var name = e && e.name ? e.name : '';
    note(name === 'PasswordException' ? 'This PDF needs a password, which this viewer does not ask for. Download it to open it.'
      : name === 'InvalidPDFException' ? 'This file is not a PDF this viewer can read. Download it to open it elsewhere.'
        : 'This PDF could not be drawn here. Download it to open it.');
  }
  function shown(d) {
    if (body.getAttribute('data-state') !== 'loading') return;
    performance.mark('pdf-parsed');
    doc = d;
    return preparePages().then(function () {
      if (body.getAttribute('data-state') !== 'loading') return;
      performance.mark('pdf-first-page');
      state('shown');
      updateView();
    });
  }
  function ownThread() {
    body.setAttribute('data-parser', 'own-thread');
    var s = document.createElement('script');
    s.type = 'module';
    s.textContent = seed.worker;
    document.head.appendChild(s);
    var tries = 0;
    (function wait() {
      if (globalThis.pdfjsWorker) {
        performance.mark('pdf-parse');
        lib.getDocument(params()).promise.then(shown).catch(failed);
        return;
      }
      tries += 1;
      if (tries > 400) { failed(new Error('the parser did not start')); return; }
      setTimeout(wait, 25);
    })();
  }
  // The pinned module executes local text only. Wait for its hello, not for the document to finish parsing.
  var WORKER_START_DEADLINE_MS = 2000;
  var workerUrl = null;
  var worker;
  try {
    workerUrl = URL.createObjectURL(new Blob([seed.worker], { type: 'text/javascript' }));
    worker = new Worker(workerUrl, { type: 'module' });
  } catch (e) {
    if (workerUrl !== null) URL.revokeObjectURL(workerUrl);
    ownThread();
    return;
  }
  var starting = true;
  var deadline = setTimeout(startFallback, WORKER_START_DEADLINE_MS);
  function endStartup() {
    starting = false;
    clearTimeout(deadline);
    URL.revokeObjectURL(workerUrl);
    worker.removeEventListener('message', workerReady);
    worker.removeEventListener('error', startFallback);
  }
  function startFallback() {
    if (!starting) return;
    endStartup();
    worker.terminate();
    ownThread();
  }
  function workerReady(e) {
    var m = e.data;
    // PDF.js 6.5.438's WorkerMessageHandler.initializeFromPort handshake. No Window listener.
    if (!starting || !m || m.sourceName !== 'worker' || m.targetName !== 'main' || m.action !== 'ready'
      || !(m.data instanceof Uint8Array)) return;
    endStartup();
    body.setAttribute('data-parser', 'worker');
    worker.addEventListener('error', function (err) { worker.terminate(); failed(err); }, { once: true });
    try {
      var p = params();
      p.worker = new lib.PDFWorker({ port: worker });
      performance.mark('pdf-parse');
      lib.getDocument(p).promise.then(shown).catch(failed);
    } catch (err) {
      worker.terminate();
      failed(err);
    }
  }
  worker.addEventListener('message', workerReady);
  worker.addEventListener('error', startFallback);
})();
`;
