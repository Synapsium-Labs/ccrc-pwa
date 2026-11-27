// The artifact tier's L0 vocabulary (native Docs HTML artifacts X5; spec docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md,
// plan Task A1.1). L0: imports only `./docs.js` and `./httpsOrigin.js`, no `node:*`, no package, so the PWA bundles it and the server compiles it.
// Nothing here is shared with the walls tier (the mockup viewer): no `MOCKUP_` name, and the mockup policy never imports this.
import { DOCS_RASTER_EXT, DOCS_RASTER_TYPES, type DocListPin, type DocSectionSlug } from './docs.js';
import { isExactHttpsOrigin } from './httpsOrigin.js';

// ---- The origin rule (spec sections 3.2 and 6.2): ONE owner, asked by the mint and by the launch sheet ------------------

/** The host part of an origin or of a `Host` value (`host`, `host:port`, `scheme://host:port/...`), lower-cased with one trailing dot
 *  dropped; `''` for text with none. */
export function hostnameOfOrigin(origin: string): string {
  const rest = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const end = rest.search(/[:/?#]/);
  const host = (end < 0 ? rest : rest.slice(0, end)).toLowerCase();
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/** Whether a browser would read `hostname` as an IPv4 address (the URL standard's "ends in a number": the last label is all
 *  digits, or `0x` and hex). Such a host is rewritten before use, so it is never compared as a name. */
export function looksNumericHost(hostname: string): boolean {
  const last = hostname.slice(hostname.lastIndexOf('.') + 1);
  return /^\d+$/.test(last) || /^0x[0-9a-f]*$/i.test(last);
}

/** Whether `origin` may be a capability's confirmed external origin: an exact https origin (`isExactHttpsOrigin`) whose HOSTNAME
 *  is none of `ours` (the console, the artifact and the content hosts, each as an origin or a `Host` value), on any port, since a
 *  page allowed to call one of those hosts would void the path scoping of spec 4.3. A host a browser reads as an IPv4 address
 *  (`127.0.0.2`, `10.1`, `0x7f.0.0.1`) is rewritten before use, so it could name one of ours under a spelling the string compare
 *  never sees: refused. Refuses too much, never too little. The mint (`originAdmission`) and the launch sheet (`sheetOrigins`)
 *  both ask this one function. */
export function originAdmitted(origin: string, ours: readonly string[]): boolean {
  if (!isExactHttpsOrigin(origin)) return false;
  const host = hostnameOfOrigin(origin);
  if (looksNumericHost(host)) return false;
  return !ours.some((o) => hostnameOfOrigin(o) === host);
}

// ---- Limits (spec section 4, plan Global Constraints "Capability") ----------------------------------------------------

/** A capability ends after this long without a request: one hour (spec section 4). */
export const ARTIFACT_IDLE_MS = 3600000;
/** A capability's absolute age cap: twelve hours (spec section 4). */
export const ARTIFACT_MAX_AGE_MS = 43200000;
/** The age cap for a capability minted over a draft pin: two hours (spec section 4). */
export const ARTIFACT_MAX_AGE_DRAFT_MS = 7200000;
/** The most live capabilities on the box (spec section 4). */
export const ARTIFACT_MAX_LIVE = 32;
/** The most live capabilities one session may hold (spec section 4). */
export const ARTIFACT_MAX_LIVE_PER_SESSION = 16;
/** The most extra origins one capability may carry (spec section 4). */
export const ARTIFACT_MAX_ORIGINS = 8;
/** The most requests one capability runs at once (spec section 5). */
export const ARTIFACT_MAX_INFLIGHT = 4;
/** The most requests the whole box runs at once for this tier (spec section 5). */
export const ARTIFACT_MAX_INFLIGHT_BOX = 16;
/** The most requests one capability may have queued (spec section 5). */
export const ARTIFACT_QUEUE_PER_CAPABILITY = 64;
/** The longest a request waits in the queue (spec section 5). */
export const ARTIFACT_QUEUE_WAIT_MS = 90000;
/** The longest a response may go without a frame before it ends (spec section 5). */
export const ARTIFACT_FRAME_STALL_MS = 30000;
/** The longest one response may run in all (spec section 5). */
export const ARTIFACT_RESPONSE_MAX_MS = 600000;
/** The bytes one capability may be served in an hour: 1 GiB, per capability and not across the box (spec section 5, "Per-capability
 *  budget"). */
export const ARTIFACT_HOURLY_BYTES = 1073741824;

// ---- The site rule and the sandbox (spec sections 2 and 3) ------------------------------------------------------------

/** The public suffixes the site rule accepts, measured on the Public Suffix List 2026-11-19 (spec section 2). Never derived
 *  from `PUBLIC_SUFFIX_TRAPS`. */
export const ARTIFACT_PUBLIC_SUFFIXES: readonly string[] = Object.freeze(['duckdns.org']);

/** The artifact frame's sandbox tokens, always present (spec section 3). It never holds a top-navigation or popup token. */
export const ARTIFACT_SANDBOX_BASE: readonly string[] = Object.freeze([
  'allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-modals', 'allow-downloads', 'allow-pointer-lock',
]);

/** The one token a capability minted with windows adds to the base (spec section 3). */
export const ARTIFACT_SANDBOX_WINDOWS = 'allow-popups';

// ---- MIME (spec section 5) --------------------------------------------------------------------------------------------

/** The response MIME by lowered extension (spec section 5): the raster types come from `DOCS_RASTER_TYPES`, never a copy.
 *  Frozen: it decides inline against attachment, so no importer may add a row at run time. */
export const ARTIFACT_MIME: Readonly<Record<string, string>> = Object.freeze({
  ...Object.fromEntries(Object.entries(DOCS_RASTER_EXT).map(([ext, type]) => [ext, DOCS_RASTER_TYPES[type].mime])),
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  wasm: 'application/wasm',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
});

/** The MIME for `path`'s final extension (the text after its last `.`, lowered `A-Z` only; none for no extension or a
 *  dotfile), and whether the response is an attachment: a table hit is inline, anything else is octet-stream and an
 *  attachment (spec section 5). */
export function artifactMime(path: string): { mime: string; attachment: boolean } {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    let ext = '';
    for (const ch of name.slice(dot + 1)) {
      const c = ch.charCodeAt(0);
      ext += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : ch;
    }
    if (Object.prototype.hasOwnProperty.call(ARTIFACT_MIME, ext)) return { mime: ARTIFACT_MIME[ext]!, attachment: false };
  }
  return { mime: 'application/octet-stream', attachment: true };
}

// ---- Wire types (spec section 6) --------------------------------------------------------------------------------------

/** The console's ask to mint a capability (spec section 6). The pin is a listing pin: a draft the listing could not fingerprint
 *  (`fp: null` with its `stat`) can be asked, and the mint refuses it `draft-too-large` before any tree read (X5 A2.3). */
export interface ArtifactMintAsk { pin: DocListPin; project: string; origins: string[]; windows: boolean }

/** The availability read's answer (spec section 6): whether a mint could work now, why not when it could not, and the live
 *  capabilities as rows (never a token or a URL). */
export interface ArtifactListOk { ok: true; available: boolean; why?: ArtifactOffWhy; live: ArtifactRow[] }

/** The scope answer: what a mint would carry (spec section 6), and the tier's two hosts as a `Host` header names them (the
 *  hostname, plus `:<port>` when the origin states one), so the launch sheet names the artifact host in its "What runs" line and
 *  never offers an outside origin on either host (X5 A5, D-9162). */
export interface ArtifactScopeOk {
  ok: true; files: number; uncommitted: number; unsized: number; bytes: number; artifactHost: string; contentHost: string;
}

/** The mint answer (spec section 6). */
export interface ArtifactMintOk { ok: true; id: string; url: string; expiresAt: number; files: number; uncommitted: number; unsized: number }

/** The revoke doors' answer: one capability's revoke answers 0 or 1, Revoke all the count ended (spec section 3.3). */
export interface ArtifactRevokeOk { ok: true; revoked: number }

/** One live capability as the console lists it, never its token (spec section 6). */
export interface ArtifactRow {
  id: string; project: string; section: DocSectionSlug; path: string; pinLabel: string;
  mintedAt: number; lastAt: number; expiresAt: number; windows: boolean; origins: string[];
}

/** Why a scope or a mint is refused (spec section 6). */
export type ArtifactRefusal =
  | 'auth-off' | 'insecure-origin' | 'unauthenticated' | 'unsupported' | 'artifact-host-unset' | 'artifact-listener-down'
  | 'not-html' | 'too-many' | 'bad-origin' | 'unmeasured' | 'pin-moved' | 'page-too-large' | 'draft-too-large';

/** The runtime list, derived from the type (`SESSION_ROLE_MAP`'s idiom): a member added with no key here fails to compile. */
const ARTIFACT_REFUSAL_MAP: Record<ArtifactRefusal, true> = {
  'auth-off': true, 'insecure-origin': true, 'unauthenticated': true, 'unsupported': true, 'artifact-host-unset': true,
  'artifact-listener-down': true, 'not-html': true, 'too-many': true, 'bad-origin': true, 'unmeasured': true,
  'pin-moved': true, 'page-too-large': true, 'draft-too-large': true,
};
export const ARTIFACT_REFUSALS: readonly ArtifactRefusal[] = Object.keys(ARTIFACT_REFUSAL_MAP) as ArtifactRefusal[];

/** Why the availability read answers `available: false` (spec section 6). */
export type ArtifactOffWhy = 'unset' | 'partial' | 'invalid' | 'by-address' | 'auth-off' | 'listener-down';

/** The runtime list, derived from the type (`SESSION_ROLE_MAP`'s idiom). */
const ARTIFACT_OFF_WHY_MAP: Record<ArtifactOffWhy, true> = {
  'unset': true, 'partial': true, 'invalid': true, 'by-address': true, 'auth-off': true, 'listener-down': true,
};
export const ARTIFACT_OFF_WHYS: readonly ArtifactOffWhy[] = Object.keys(ARTIFACT_OFF_WHY_MAP) as ArtifactOffWhy[];
