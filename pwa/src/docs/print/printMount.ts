// Where the print view is mounted (X2 P6.1 Step 1, part B; spec 4.6 "How"). Ring L4: it owns the one DOM node of the print view,
// `div.docs-print-root`, appended to `document.body` once (and again if something removed it), and a React root over it. `beforeprint`
// mounts the view into it synchronously (`flushSync`), from what is already prepared, so a handler that cannot wait for anything
// still has the whole view in the document when the browser lays the page out; `afterprint` renders nothing into it. The node
// stays, empty. On screen it is `display: none`, and under print everything else in `body` is (`docs.css`).
//
// While a view is mounted, `body` also carries `data-docs-printing` and `data-theme="light"` (its own value put back when the view
// goes). The print sheet hides the console by the mark as well as by `:has()` (an engine without it still prints the view alone),
// and the light tokens reach the page's ground through `body`, not only the root. Nothing watches `body` for either attribute
// (the appearance observer watches `html`), so the console does not see a theme change.
//
// `flushSync` is refused while React is rendering or committing, and it only SCHEDULES there: a caller inside an effect must not use
// `mountPrint`/`unmountPrint` and expect the node to be filled when it returns. `usePrint` mounts from an event handler or a timer.
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
/** `body`'s own `data-theme` while the view is marked: a string, or `null` for absent; `undefined`: body is not marked. */
let bodyTheme: string | null | undefined;

/** The root over the print node, made on first use. A node something took out of the document is put back. */
function printRoot(): Root {
  if (host === null || root === null) {
    host = document.createElement('div');
    host.className = 'docs-print-root';
    // The light palette's tokens for the printed page, whatever theme the console shows (`docs.css`).
    host.setAttribute('data-theme', 'light');
    root = createRoot(host);
  }
  if (!host.isConnected) document.body.appendChild(host);
  return root;
}

function mark(): void {
  const body = document.body;
  if (bodyTheme !== undefined) return;
  bodyTheme = body.getAttribute('data-theme');
  body.setAttribute('data-docs-printing', '');
  body.setAttribute('data-theme', 'light');
}

function unmark(): void {
  if (bodyTheme === undefined) return;
  const body = document.body;
  body.removeAttribute('data-docs-printing');
  if (bodyTheme === null) body.removeAttribute('data-theme');
  else body.setAttribute('data-theme', bodyTheme);
  bodyTheme = undefined;
}

/** Draws `view` into the print node now (synchronously), replacing what it held. Not from an effect (see the header). */
export function mountPrint(view: ReactElement): void {
  const r = printRoot();
  mark();
  flushSync(() => r.render(view));
}

/** Empties the print node now (synchronously) and unmarks `body`; the node stays. Nothing happens when nothing was ever mounted. */
export function unmountPrint(): void {
  unmark();
  if (root === null) return;
  const r = root;
  flushSync(() => r.render(null));
}

/** Empties the print node as soon as React is free and unmarks `body`: for a caller that is itself inside a commit (an effect's
 *  cleanup), where a synchronous flush is refused. The node stays. */
export function clearPrint(): void {
  unmark();
  root?.render(null);
}
