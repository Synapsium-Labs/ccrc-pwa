// The PDF frame's walls (X2 spec 2026-11-18 section 4.4; plan Task P3.2; mutation rows M11.16 and M11.17). Ring L1:
// constants and pure functions, no I/O, no DOM, no timer. It shares nothing with the reader frame's `frameCsp()` or the
// mockup frame's `MOCKUP_CSP`: the PDF frame is a surface of its own, and its policy is written here once.
//   - The sandbox is exactly `allow-scripts`: no `allow-same-origin` (so the frame's origin is opaque and it reaches
//     neither the console's storage nor its session), no popup, top-navigation, modal, form or download token.
//   - The policy names its scripts by hash only: the click guard, the viewer, the bootstrap and the parser. There is no
//     `'unsafe-inline'` for scripts and no eval source of any kind (`'unsafe-eval'`, `'wasm-unsafe-eval'`), so pdf.js's
//     WebAssembly image decoders stay off and no text the PDF carries can become code.
//   - `default-src 'none'` covers `connect-src`, `frame-src`, `object-src`, `media-src` and `manifest-src`: the frame,
//     and any worker it starts (a `blob:` worker inherits this policy), has no network at all.
import { metaFor } from '../mockup/policy';

/** The PDF frame's `sandbox` attribute: exactly this one token and no other (spec 4.4, M11.16). */
export const PDF_SANDBOX = 'allow-scripts';

/** The base64 SHA-256 of each script the frame may run, in the policy's order: the click guard, the viewer, the
 *  bootstrap, and the parser (run as a script only on the frame's own thread, when its worker does not start). */
export interface PdfScriptHashes {
  readonly guard: string;
  readonly viewer: string;
  readonly boot: string;
  readonly worker: string;
}

/** One SHA-256 digest as a CSP hash source carries it: 43 base64 characters and one `=` (32 bytes). */
const SHA256_B64 = /^[A-Za-z0-9+/]{43}=$/;

/** The PDF frame's policy (spec 4.4, verbatim but for the hashes): `script-src` holds one `'sha256-…'` source per digest
 *  given, in order, a digest given twice once. THROWS on an empty list or a value that is not a base64 SHA-256 digest, so
 *  a policy that runs no script, or one a caller could widen through a digest argument, is never built. */
export function pdfCsp(hashes: readonly string[]): string {
  const sources: string[] = [];
  for (const h of hashes) {
    if (!SHA256_B64.test(h)) throw new RangeError(`pdfCsp: '${h}' is not a base64 SHA-256 digest`);
    const s = `'sha256-${h}'`;
    if (!sources.includes(s)) sources.push(s);
  }
  if (sources.length === 0) throw new RangeError('pdfCsp: no script hashes');
  return `default-src 'none'; script-src ${sources.join(' ')}; style-src 'unsafe-inline'; img-src data: blob:; `
    + "font-src data:; worker-src blob:; base-uri 'none'; form-action 'none'";
}

/** The meta tag that carries the policy, first in the frame's bytes (the mockup frame's escaping, `metaFor`). */
export function pdfMeta(csp: string): string {
  return metaFor(csp);
}

/** The click guard's script text, the frame's second element (spec 4.4: the meta first, the guard second). The viewer
 *  draws no anchor, so the guard is the second wall, never the first (the shell's `frame-src 'none'` and the sandbox
 *  are): any click on a link or an image map area, any middle click on one, and any form submission is stopped before
 *  the engine acts on it. */
export const PDF_CLICK_GUARD_JS = "(function(){function stop(e){var t=e.target;var a=t&&t.closest&&t.closest('a,area');"
  + "if(a){e.preventDefault();e.stopPropagation();}}document.addEventListener('click',stop,true);"
  + "document.addEventListener('auxclick',stop,true);"
  + "document.addEventListener('submit',function(e){e.preventDefault();e.stopPropagation();},true);})();";
