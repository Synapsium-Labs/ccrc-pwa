// The reader lab's frames (native Docs reader, the reader lab plan of 2026-11-03, Task 6, refinement (h); the rich-docs
// spec's rows A24, M10.9, M10.10). The one place in `pwa/src` outside the Docs reader that builds an iframe or a srcdoc.
// Every frame is the reader frame's shape: `sandbox="allow-scripts"` and nothing else, a `srcdoc`,
// `referrerpolicy="no-referrer"`. Only the wall frame carries a policy, the library's own with its script nonce,
// fixed import hash and canary added (`docs/reader/labPolicy.ts`), as a meta and as the iframe's `csp` attribute, as the reader frame does. A
// frame's script is one of `frameScripts.ts`' constants; what varies per run travels in a JSON data block just before it,
// which no policy runs. A battery frame also carries the constant import script, first, with a data block of its own just
// before it; the wall policy allows that script by its hash and the battery's by the frame's nonce. No frame is handed a port, and nothing here listens for a message: a frame reports only through
// the door. Ring L4: it makes DOM elements.
import { labWallCsp } from '../docs/reader/labPolicy';
import { LAB_IMPORT_SCRIPT, LAB_IMPORT_SCRIPT_SHA256 } from './frameScripts';

/** The one sandbox a lab frame carries: the reader frame's, exactly (M10.9). */
export const LAB_SANDBOX = 'allow-scripts';

/** One lab frame: its constant script, the data the script reads, and, for the battery's wall frame only, its canary. */
export interface LabFrameSpec {
  readonly script: string;
  /** `base` is always this run's probe path on the console's origin. */
  readonly config: Readonly<Record<string, string | number | boolean>>;
  readonly wall?: { readonly canary: string };
  /** True for a battery frame, wall or control: the import channel's constant script runs before the frame's own. */
  readonly importChannel?: boolean;
}

/** A mounted lab frame. */
export interface LabFrame {
  /** How many `load` events the frame has fired: its srcdoc's, then any navigation's. */
  loads(): number;
  /** Removes the frame. Idempotent. */
  remove(): void;
}

/** The data block's text: `<`, U+2028 and U+2029 escaped, so it can end neither its element nor a line of script. */
export function labDataText(config: LabFrameSpec['config']): string {
  return JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const attr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A lab frame's srcdoc: the policy's meta when there is one, then, in the body, the data block and the frame's script
 *  (carrying `nonce` when there is one); for an `importChannel` frame the import script, with its own copy of the data
 *  block just before it, comes first and carries no nonce. Throws on a script that would end its own element. */
export function labSrcdoc(spec: LabFrameSpec, policy: string | null, nonce: string | null): string {
  if (spec.script.toLowerCase().includes('</script')) throw new Error('a lab frame script holds a script close');
  const meta = policy === null ? '' : `<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">`;
  const nonceAttr = nonce === null ? '' : ` nonce="${attr(nonce)}"`;
  const data = `<script type="application/json">${labDataText(spec.config)}</script>`;
  const importing = spec.importChannel === true ? `${data}<script>${LAB_IMPORT_SCRIPT}</script>` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${meta}<title>reader lab</title></head><body>`
    + `${importing}${data}<script${nonceAttr}>${spec.script}</script></body></html>`;
}

/** Mounts one lab frame at the end of `stage`. `nonce` makes the wall frame's script nonce; no other frame asks for one. The hash source is the constant import script's. */
export function mountLabFrame(stage: HTMLElement, spec: LabFrameSpec, nonce: () => string): LabFrame {
  const el = document.createElement('iframe');
  el.setAttribute('sandbox', LAB_SANDBOX);
  el.setAttribute('referrerpolicy', 'no-referrer');
  el.setAttribute('title', 'reader lab frame');
  let policy: string | null = null;
  let scriptNonce: string | null = null;
  if (spec.wall !== undefined) {
    scriptNonce = nonce();
    policy = labWallCsp(`'nonce-${scriptNonce}'`, `'${LAB_IMPORT_SCRIPT_SHA256}'`, spec.wall.canary);
    el.setAttribute('csp', policy);
  }
  let loads = 0;
  el.addEventListener('load', () => {
    loads += 1;
  });
  el.setAttribute('srcdoc', labSrcdoc(spec, policy, scriptNonce));
  stage.append(el);
  el.scrollIntoView({ block: 'nearest' });
  return {
    loads: () => loads,
    remove: () => {
      el.remove();
    },
  };
}
