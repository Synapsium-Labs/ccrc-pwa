// The artifact wrapper (native Docs HTML artifacts X5, plan Task A3.1; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md sections 3.4, 4.1, 4.2 and 4.5).
// Ring L1: pure decisions. It builds the one fixed HTML document `GET /a/:token` answers, and the six headers that go with it,
// from a capability the store has already found live. It makes no I/O, reads no clock and imports only the sandbox vocabulary,
// a type of the store, and `node:crypto` for the stylesheet's hash, computed once at module load.
//
// WHAT THE WRAPPER IS. A new top-level tab (spec 4.1, option c) holds this page, and the page's own code runs in the frame it
// holds, on the content host, which is another site. The bar above the frame is cross-origin to the page, so the page cannot alter
// it. The document has NO script: the only things it does are show the bar and frame the page. Its header CSP pins what the frame
// may navigate to (this capability's own path on the content host, and `/clear`), so a page that sets its frame's location to
// anywhere else is refused by the browser.
//
// WHAT IT NEVER HOLDS. Every value from the capability is HTML-escaped, in text and in attributes. The document and its headers
// carry the token (already in the tab's URL), the content origin, and the capability's provenance, and nothing else: no session
// id hash, no box token, no account name, and never the console's origin (spec 4.5, "Secrets to the page").
import { createHash } from 'node:crypto';
import { ARTIFACT_SANDBOX_BASE, ARTIFACT_SANDBOX_WINDOWS } from '../../../shared/artifacts.js';
import type { Capability } from './store.js';

/** The name of the wrapper's frame. The "Clear this host's data" link names it as its `target`, so the clearing page loads into
 *  the frame and replaces the page there. */
export const WRAPPER_FRAME_NAME = 'artifact';

/** The fixed page a wrapper request answers with for any link that no longer works (spec 3.4, the review focus on a tab left
 *  open): one sentence, no script, no reference to anything. Byte-identical for an unknown, malformed, revoked, idle, expired or
 *  session-ended token, so the answer says nothing about which. */
export const ARTIFACT_ENDED_BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>ccrc artifacts</title></head><body><p>This artifact link has ended. Open it again from ccrc.</p></body></html>';

/** The bar's stylesheet, as one constant: the document's CSP admits it by its hash (`style-src 'sha256-…'`), so nothing else can
 *  style the page, and it loads nothing (no `url()`, no `@import`). Whatever is written here is exactly what the `<style>` holds. */
export const WRAPPER_STYLE =
  ':root{color-scheme:light dark}'
  + 'html,body{height:100%;margin:0}'
  + 'body{display:flex;flex-direction:column;font:14px/1.4 system-ui,sans-serif;background:#fff;color:#111}'
  + '.bar{display:flex;flex-wrap:wrap;align-items:center;gap:4px 16px;padding:6px 12px;background:#fff4c2;color:#3b2a00;'
  + 'border-bottom:2px solid #b45309}'
  + '.warn{font-weight:600}'
  + '.bar a{color:#7c2d12}'
  + 'iframe{flex:1 1 auto;width:100%;border:0;background:#fff}'
  + '@media (prefers-color-scheme:dark){'
  + 'body{background:#111;color:#eee}'
  + '.bar{background:#3b2a00;color:#ffedb3;border-bottom-color:#f59e0b}'
  + '.bar a{color:#fcd34d}'
  + '}';

/** The bar's close hint (spec 4.2, "a Close hint"). Closing the tab does NOT end the link: the capability lives until Revoke, its
 *  idle hour, its absolute expiry, its session's end or a restart (spec 3.3, and 7's A11: a URL carried out of the page keeps
 *  working while someone uses it). So the hint says where the link is ended, never that closing ends it. */
export const WRAPPER_CLOSE_HINT = 'Close this tab when you are done; Revoke in ccrc ends the link.';

/** The CSP source for the stylesheet: `'sha256-<base64 of the sha256 of exactly WRAPPER_STYLE>'`, computed once. */
export const WRAPPER_STYLE_SOURCE = `'sha256-${createHash('sha256').update(WRAPPER_STYLE).digest('base64')}'`;

/** Whether a request's `Sec-Fetch-Dest` is the one a navigation to the wrapper carries: exactly `document`. An absent header, an
 *  `iframe` (a page framing the wrapper), `empty` (a `fetch`) or any other value is refused, so a script cannot read the wrapper
 *  and a page cannot frame it (spec 3.4). */
export function wrapperDestOk(dest: string | undefined): boolean {
  return dest === 'document';
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** A value made safe in HTML text and in a quoted attribute. */
const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);

/** The page's path relative to the capability's directory, each segment percent-encoded: the content URL's path after
 *  `/c/<token>/` is relative to `dir`, and the page is always directly in it. */
function pagePathInDir(c: Pick<Capability, 'dir' | 'page'>): string {
  const rel = c.dir !== '' && c.page.startsWith(`${c.dir}/`) ? c.page.slice(c.dir.length + 1) : c.page;
  return rel.split('/').map(encodeURIComponent).join('/');
}

/** The wrapper for a live capability: the document, and its six headers (lower-case names, nothing more). `token` is the
 *  capability's token as it came in the request, which the caller has just looked up; `contentOrigin` is the configured one. */
export function wrapperDocument(
  c: Capability, token: string, contentOrigin: string,
): { html: string; headers: Record<string, string> } {
  const framePath = `${contentOrigin}/c/${token}/`;
  const clearUrl = `${contentOrigin}/clear`;
  const sandbox = (c.windows ? [...ARTIFACT_SANDBOX_BASE, ARTIFACT_SANDBOX_WINDOWS] : [...ARTIFACT_SANDBOX_BASE]).join(' ');
  const where = `${c.section}/${c.page}`;
  const pinText = c.pin.kind === 'committed' ? `at ${c.pin.commit.slice(0, 7)}` : 'draft';
  const what = `Artifact · ${esc(c.project)} · ${esc(where)} · ${esc(pinText)}`;
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${what}</title>`
    + `<style>${WRAPPER_STYLE}</style></head><body>`
    + `<div class="bar"><span class="what">${what}</span>`
    + '<span class="warn">Runs its own code · This is not ccrc: never type your ccrc passphrase here</span>'
    + `<a class="clear" href="${esc(clearUrl)}" target="${WRAPPER_FRAME_NAME}">Clear this host's data</a>`
    + `<span class="hint">${WRAPPER_CLOSE_HINT}</span></div>`
    + `<iframe name="${WRAPPER_FRAME_NAME}" src="${esc(`${framePath}${pagePathInDir(c)}`)}" sandbox="${sandbox}"`
    + ' allow="fullscreen; clipboard-write" referrerpolicy="no-referrer" title="The artifact\'s page"></iframe>'
    + '</body></html>';
  const headers: Record<string, string> = {
    'content-security-policy': `default-src 'none'; style-src ${WRAPPER_STYLE_SOURCE}; img-src data:; `
      + `frame-src ${framePath} ${clearUrl}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow',
  };
  return { html, headers };
}
