// The artifact tier's config decision and the site rule (native Docs HTML artifacts X5, plan Task A1.2; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md section 2.3). L1 policy: pure decisions, no I/O, no `node:*`,
// no console. It imports L0 (`shared/httpsOrigin.ts`, `shared/artifacts.ts`, `shared/docs.ts`), the docs plugin's own pin and
// project parsers (`../docs/policy.ts`, L1, the same context) and two types of the tier's store; never `server/src/auth/webauthn.ts`
// (L3) or its `PUBLIC_SUFFIX_TRAPS`, which refuses bad passkey scopes and would reverse its safety direction as an accept list.
//
// ALL OR NOTHING: the three keys are either all present and valid, or the tier is off. A partial or invalid set is never an
// error at boot; the caller (`config.ts`) logs one warning line and the tier stays dark. The site rule refuses too much,
// never too little: its one way to be wrong is a refusal.
import { isExactHttpsOrigin } from '../../../shared/httpsOrigin.js';
import {
  ARTIFACT_MAX_ORIGINS, ARTIFACT_PUBLIC_SUFFIXES, artifactMime, type ArtifactListOk, type ArtifactMintOk, type ArtifactOffWhy,
  type ArtifactRefusal, type ArtifactRevokeOk, type ArtifactRow, type ArtifactScopeOk,
} from '../../../shared/artifacts.js';
import {
  DOCS_MAX_FILE_BYTES, DOCS_PIN_KEYS, DOCS_RANGE_MAX_BYTES, contentClass, parseDocsRef, statPin,
  type DocPin, type DocsEntry, type DocsFailureBody, type DocsRangePin, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs.js';
import {
  badQuery, docsOwn as own, firstUnknownKey, isDocsRecord as isRecord, parseDocsProjectParam, parseFilePin, type DocsSignIn,
} from '../docs/policy.js';
import type { ArtifactManifestEntry, CapabilityInput } from './store.js';

/** The tier's config: on with its two origins, the loopback port and the `Host` values the fences compare against (a browser's
 *  `Host` header: the hostname lower-cased, plus `:<port>` when the origin states one), or off with the reason. */
export type ArtifactConfig =
  | { state: 'on'; artifactOrigin: string; contentOrigin: string; port: number; artifactHost: string; contentHost: string }
  | { state: 'off'; why: 'unset' | 'partial' | 'invalid' | 'by-address'; detail: string };

const KEY_ORIGIN = 'CCRC_ARTIFACT_ORIGIN';
const KEY_CONTENT = 'CCRC_ARTIFACT_CONTENT_ORIGIN';
const KEY_PORT = 'CCRC_ARTIFACT_PORT';
const KEY_CONSOLE = 'CCRC_ORIGIN';

/** Lower-case, one trailing dot dropped, split into labels. */
function labelsOf(host: string): string[] {
  const h = host.toLowerCase();
  return (h.endsWith('.') ? h.slice(0, -1) : h).split('.');
}

/** Why `artifactHost` may not sit beside `consoleHost`, or null when the site rule accepts it (spec 2.3, "The site rule, without
 *  the Public Suffix List"). Hostnames only, no port. The equal-or-below-or-above clause comes FIRST, so an accept-list host
 *  above the console (console `<label>.duckdns.org`, artifact `duckdns.org`) is refused: only that clause stops it. Then the
 *  longest common run of trailing labels S: empty or one label (a top-level domain) is accepted, an entry of
 *  `ARTIFACT_PUBLIC_SUFFIXES` is accepted, anything else is the same site and refused. */
export function siteRuleProblem(consoleHost: string, artifactHost: string): string | null {
  const k = labelsOf(consoleHost);
  const a = labelsOf(artifactHost);
  const kj = k.join('.');
  const aj = a.join('.');
  if (kj === aj) return `${aj} is the console host`;
  if (aj.endsWith('.' + kj)) return `${aj} is below the console host ${kj}`;
  if (kj.endsWith('.' + aj)) return `${aj} is above the console host ${kj}`;
  let n = 0;
  while (n < k.length && n < a.length && k[k.length - 1 - n] === a[a.length - 1 - n]) n++;
  if (n <= 1) return null;
  const shared = k.slice(k.length - n).join('.');
  if (ARTIFACT_PUBLIC_SUFFIXES.includes(shared)) return null;
  return `${aj} shares the site ${shared} with the console`;
}

/** A value as the operator wrote it, bounded, for a detail line. */
function shown(v: string): string {
  return JSON.stringify(v.length > 80 ? v.slice(0, 80) + '...' : v);
}

/** Whether a browser would read `hostname` as an IPv4 address (the URL standard's "ends in a number": the last label is all
 *  digits, or `0x` and hex). Such a host is rewritten before use, so it is never compared as a name here. */
function looksNumeric(hostname: string): boolean {
  const last = hostname.slice(hostname.lastIndexOf('.') + 1);
  return /^\d+$/.test(last) || /^0x[0-9a-f]*$/i.test(last);
}

/** A port written the one way a browser serializes it: digits with no leading zero, 1 to 65535. `0443` or `07790` would
 *  pass a looser check yet name the same origin as `443` or `7790`, so two "different" origins could be one. */
function portOf(digits: string): number | null {
  if (!/^[1-9]\d{0,4}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= 1 && n <= 65535 ? n : null;
}

/** Why `digits` fails `portOf`, in the words of the detail line (a failure of the origin's grammar; `portOf` stays the one test). */
function badPortWords(digits: string): string {
  if (/^0+$/.test(digits)) return 'names port 0, which is not a port';
  if (/^0\d+$/.test(digits)) return 'writes its port with a leading zero';
  return 'is not a port (1 to 65535)';
}

const CONSOLE_LOOPBACK_RE = /^http:\/\/localhost:(\d+)$/;
const ARTIFACT_LOOPBACK_RE = /^http:\/\/127\.0\.0\.1:(\d+)$/;

/** The host of an exact https origin, as a browser's `Host` header carries it: hostname (already lower-case by the grammar),
 *  plus `:<port>` when the origin states one. Call only after `isExactHttpsOrigin`. */
function httpsHostOf(origin: string): { hostname: string; host: string } {
  const rest = origin.slice('https://'.length);
  const colon = rest.indexOf(':');
  return { hostname: colon < 0 ? rest : rest.slice(0, colon), host: rest };
}

type Checked = { ok: true; host: string } | { ok: false; detail: string };

/** One artifact-tier origin against the console: its shape, and, for an https one, the site rule. */
function checkOrigin(key: string, value: string, consoleLoopback: boolean, consoleHostname: string, consolePort: number): Checked {
  if (consoleLoopback) {
    // Loopback is for development and the browser suite only (spec 2.3): beside it, nothing but a 127.0.0.1 origin, on a
    // port other than the console's.
    const m = ARTIFACT_LOOPBACK_RE.exec(value);
    const p = m ? portOf(m[1]!) : null;
    if (p !== null && p === consolePort) {
      return { ok: false, detail: `${key}=${shown(value)} is on the console's own port` };
    }
    if (p !== null) return { ok: true, host: value.slice('http://'.length) };
    return { ok: false, detail: `${key}=${shown(value)}: beside a loopback console only http://127.0.0.1:<port> is accepted` };
  } else if (ARTIFACT_LOOPBACK_RE.test(value)) {
    return { ok: false, detail: `${key}=${shown(value)} is a loopback origin, which only a console at http://localhost:<port> may have` };
  }
  if (!isExactHttpsOrigin(value)) {
    return { ok: false, detail: `${key}=${shown(value)} is not a bare https origin (https://<host>, lower case, no path, no trailing slash)` };
  }
  const { hostname, host } = httpsHostOf(value);
  // A name, never an address: a browser reads a host whose last label is numeric (`10.0.0.01`, `10.1`, `0x7f.1`) as an
  // IPv4 address and rewrites it, so the string checks below would compare a spelling the browser never uses.
  if (looksNumeric(hostname)) return { ok: false, detail: `${key}=${shown(value)} is an address; artifacts need names` };
  const colon = host.indexOf(':');
  if (colon >= 0) {
    // One spelling per origin: a leading zero names the same port as without it, and a browser drops the default port from
    // its `Host` header and its serialized origin, so `:443` written out would meet the host fence's 421 on every request.
    const p = portOf(host.slice(colon + 1));
    if (p === null) return { ok: false, detail: `${key}=${shown(value)} ${badPortWords(host.slice(colon + 1))}` };
    if (p === 443) return { ok: false, detail: `${key}=${shown(value)} names the default port; write it without :443` };
  }
  const problem = siteRuleProblem(consoleHostname, hostname);
  if (problem !== null) return { ok: false, detail: `${key}=${shown(value)}: ${problem}` };
  return { ok: true, host };
}

/** The tier's one config decision (spec 2.3). Never throws. Order: an address (`CCRC_EXPOSE_MODE=ip`) has no second site, so
 *  it is off whatever keys stand; no keys is unset; some keys is partial; all three are validated and any failure is invalid. A
 *  key counts as present only when it is a non-empty string (an EnvironmentFile's bare `KEY=` line is absent). A detail holds
 *  only key names, the values the operator wrote and the rule's words, since it goes to a boot warning. */
export function artifactConfig(
  env: { origin?: string; content?: string; port?: string; exposeMode?: string },
  consoleOrigin: string,
  consolePort: number,
): ArtifactConfig {
  if (env.exposeMode === 'ip') {
    return { state: 'off', why: 'by-address', detail: 'this box is reached by address, and artifacts need names' };
  }
  const origin = typeof env.origin === 'string' && env.origin !== '' ? env.origin : null;
  const content = typeof env.content === 'string' && env.content !== '' ? env.content : null;
  const portRaw = typeof env.port === 'string' && env.port !== '' ? env.port : null;
  if (origin === null && content === null && portRaw === null) return { state: 'off', why: 'unset', detail: '' };
  if (origin === null || content === null || portRaw === null) {
    const missing = [origin === null ? KEY_ORIGIN : null, content === null ? KEY_CONTENT : null, portRaw === null ? KEY_PORT : null]
      .filter((k): k is string => k !== null);
    return { state: 'off', why: 'partial', detail: `missing ${missing.join(', ')}; all three keys are needed` };
  }
  const invalid = (detail: string): ArtifactConfig => ({ state: 'off', why: 'invalid', detail });

  const port = portOf(portRaw);
  if (port === null) return invalid(`${KEY_PORT}=${shown(portRaw)} is not a port (digits only, no leading zero, 1 to 65535)`);
  if (port === consolePort) return invalid(`${KEY_PORT}=${shown(portRaw)} is the console's own port`);

  const loopback = CONSOLE_LOOPBACK_RE.exec(consoleOrigin);
  const consoleLoopback = loopback !== null && portOf(loopback[1]!) !== null;
  if (!consoleLoopback && !isExactHttpsOrigin(consoleOrigin)) {
    return invalid(`${KEY_CONSOLE}=${shown(consoleOrigin)} is neither a bare https origin nor http://localhost:<port>`);
  }
  const consoleHostname = consoleLoopback ? 'localhost' : httpsHostOf(consoleOrigin).hostname;
  // A console reached by address has no second site (spec 2.5), whatever `CCRC_EXPOSE_MODE` says.
  if (looksNumeric(consoleHostname)) {
    return { state: 'off', why: 'by-address', detail: 'this box is reached by address, and artifacts need names' };
  }

  if (origin === consoleOrigin) return invalid(`${KEY_ORIGIN}=${shown(origin)} is the console origin`);
  if (content === consoleOrigin) return invalid(`${KEY_CONTENT}=${shown(content)} is the console origin`);
  if (content === origin) return invalid(`${KEY_CONTENT}=${shown(content)} is the same origin as ${KEY_ORIGIN}`);

  const a = checkOrigin(KEY_ORIGIN, origin, consoleLoopback, consoleHostname, consolePort);
  if (!a.ok) return invalid(a.detail);
  const c = checkOrigin(KEY_CONTENT, content, consoleLoopback, consoleHostname, consolePort);
  if (!c.ok) return invalid(c.detail);
  return { state: 'on', artifactOrigin: origin, contentOrigin: content, port, artifactHost: a.host, contentHost: c.host };
}

// ---- The listeners' host and method decisions (plan Task A1.3, spec 2.2 and 3.4) ----

/** A `Host` value as both sides of a comparison are read: lower-cased, and ONE trailing dot dropped from the hostname part (the
 *  part before a `:port`, if there is one). A port is kept as written, never defaulted: a browser omits the default port, so
 *  `host:443` is not a spelling of `host`. */
function normalizeHost(host: string): string {
  const h = host.toLowerCase();
  const m = /^(.*?)(:[^:]*)?$/.exec(h);
  const name = m![1]!;
  const port = m![2] ?? '';
  return (name.endsWith('.') ? name.slice(0, -1) : name) + port;
}

/** Whether `host` (a request's `Host` header) is one of `hosts`. A missing or empty header matches nothing, and so does an empty
 *  entry. */
export function hostMatches(host: string | undefined, hosts: readonly string[]): boolean {
  if (host === undefined || host === '') return false;
  const want = normalizeHost(host);
  return hosts.some((h) => h !== '' && normalizeHost(h) === want);
}

/** The console's side of the fence, which REFUSES, so it reads wider than `hostMatches`: an https artifact host is matched by
 *  HOSTNAME whatever port the request writes (`host`, `host:443`, `host:9999`, `host:`, `HOST.:8443`), also when the origin was
 *  configured with a port of its own (`https://host:8443`), because a reverse proxy's host matcher ignores the port and a
 *  refusal list must refuse too much, never too little. Only the loopback pair (a configured host whose hostname is
 *  `127.0.0.1`, the one loopback form the config admits) is matched exactly, `host:port` against `host:port`: beside a loopback
 *  console the console and the artifact origins share an address and differ by port alone, so the console's own
 *  `127.0.0.1:<port>` must still answer. A bracketed request (`[host]`, `[host]:443`) is read without its one pair of
 *  brackets first (`withoutBrackets`), because `hostnameOf` returns a bracketed value whole: before X5 A2 such a spelling of
 *  an artifact host matched nothing here and reached the console. */
export function namesArtifactHost(host: string | undefined, artifactHosts: readonly string[]): boolean {
  if (host === undefined || host === '') return false;
  const want = normalizeHost(withoutBrackets(host));
  const wantName = hostnameOf(want);
  return artifactHosts.some((h) => {
    if (h === '') return false;
    const n = normalizeHost(h);
    const name = hostnameOf(n);
    return name === LOOPBACK_HOSTNAME ? n === want : name === wantName;
  });
}

const LOOPBACK_HOSTNAME = '127.0.0.1';

/** The console's side only: one pair of surrounding brackets taken off a request's `Host`, so `[host]` reads as `host` and
 *  `[host]:<port>` as `host:<port>`. It only widens the refusal: no configured artifact host is bracketed (the origin grammar
 *  admits none), so a bracketed `Host` matched no artifact host before, and now matches the one its inside names. The artifact
 *  side's allow list never calls it, so a bracketed `Host` there still fails shut. */
function withoutBrackets(host: string): string {
  const m = /^\[([^\]]*)\](:[^:]*)?$/.exec(host);
  return m === null ? host : m[1]! + (m[2] ?? '');
}

/** The hostname part of a normalized `Host` (the text before a `:port`, if any). */
function hostnameOf(normalized: string): string {
  const colon = normalized.lastIndexOf(':');
  return colon < 0 || normalized.startsWith('[') ? normalized : normalized.slice(0, colon);
}

/** The artifact listener's fence: it ALLOWS its own two hosts, exactly, and anything else is `misdirected` (421). Strict on
 *  purpose: an allow list fails shut. The console's side, which refuses, is `namesArtifactHost`. */
export function hostFence(host: string | undefined, allowed: readonly string[]): 'ok' | 'misdirected' {
  return hostMatches(host, allowed) ? 'ok' : 'misdirected';
}

/** The artifact listener serves reads only: GET, and HEAD, which Fastify adds beside every GET route. */
export function artifactMethodAllowed(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/** The status of an answer for a request Node could not parse (its `clientError` code): an oversized header is 431, a request
 *  that outlived Node's request timeout is 408 (both of Node's own defaults answer so), anything else is 400. Node's own
 *  default maps a few more codes to other statuses (a chunk-extension overflow to 413, for one); here those are 400, with the
 *  same fixed words. */
export function clientErrorStatus(code: unknown): 400 | 408 | 431 {
  if (code === 'HPE_HEADER_OVERFLOW') return 431;
  if (code === 'ERR_HTTP_REQUEST_TIMEOUT') return 408;
  return 400;
}

// ---- The availability read, the scope read and the mint (plan Task A2.3, spec 3.2) ----
//
// The console doors in `server/src/docs/routes.ts` (L4) decide NOTHING: every verdict below is this file's, and the route sends
// what it answers. The order of the steps is the route's, and the design's: the account gate, the tier, the parse, the page's
// class, the origins (a mint only), the tree read, then the pin and the manifest.

/** The listener's three states, spelled once: `pending` until the listen has run, then `listening` or `down`. */
export type ArtifactListenWord = 'pending' | 'listening' | 'down';

/** The availability read's verdict (spec 3.2 and 6): sign-in dark first (a capability is bound to a session), then why the tier
 *  is off (its config's own word), then a listener that is not listening (`pending` or `down`). `storeReady` is whether the
 *  tier's store exists; the composition root builds one whenever the tier is on, so a missing one reads as unset. */
export function artifactAvailability(signIn: DocsSignIn, cfg: ArtifactConfig, listener: ArtifactListenWord | null, storeReady: boolean):
  { available: true } | { available: false; why: ArtifactOffWhy } {
  if (signIn === 'dark') return { available: false, why: 'auth-off' };
  if (cfg.state !== 'on') return { available: false, why: cfg.why };
  if (!storeReady) return { available: false, why: 'unset' };
  if (listener !== 'listening') return { available: false, why: 'listener-down' };
  return { available: true };
}

/** The tier's config when it is on. */
export type ArtifactTierOn = Extract<ArtifactConfig, { state: 'on' }>;

/** The scope read's and the mint's tier step, after the account gate: the tier off (or no store) is `artifact-host-unset`; a
 *  tier on whose listener is not listening is `artifact-listener-down`, a word of its own, never the first. Otherwise it hands
 *  back the config and the store, so a caller never reads either from a tier that is off. */
export function tierStep<S>(cfg: ArtifactConfig, listener: ArtifactListenWord | null, store: S | null):
  { ok: true; cfg: ArtifactTierOn; store: S } | { ok: false; error: 'artifact-host-unset' | 'artifact-listener-down' } {
  if (cfg.state !== 'on' || store === null) return { ok: false, error: 'artifact-host-unset' };
  if (listener !== 'listening') return { ok: false, error: 'artifact-listener-down' };
  return { ok: true, cfg, store };
}

/** The origins a confirmed origin may not share a host with: the console's, and the artifact and content origins when the tier is on. */
export function ownOrigins(consoleOrigin: string, cfg: ArtifactTierOn): string[] {
  return [consoleOrigin, cfg.artifactOrigin, cfg.contentOrigin];
}

/** A tree read that failed in any way is `unmeasured`: nothing is minted, and a failed read is never a page with no files. */
export const TREE_FAILURE_REFUSAL = 'unmeasured' as const satisfies ArtifactRefusal;

/** The docs failure body the tree port answers for a read that threw. The read's adapters never throw, so this is a defect's
 *  answer: it keeps the port's contract (it never throws) and is never read as an empty tree. */
export function artifactTreeDefect(): DocsFailureBody {
  return { ok: false, failure: 'helper-failed' };
}

/** A failure of the scope read's or the mint's own parse: the docs parser's body (`bad-project`, `bad-query`, `bad-commit`, ...,
 *  sent as it came) or one of this tier's refusals (`draft-too-large`). */
export type ArtifactParseFailure = DocsFailureBody | { ok: false; error: ArtifactRefusal };

/** The keys a pin may carry, listed once: the pin keys the file read takes, then `section` and `path`. */
const PIN_PLACE_KEYS: readonly string[] = [...DOCS_PIN_KEYS, 'section', 'path'];

/** What the scope read and the mint hand on once their input parsed: the project and the pin the page was opened at. */
export interface ArtifactPinAsk { project: string; pin: DocPin }

/** The scope read's query, by the file read's own pin parser (`parseFilePin`) and project check (`parseDocsProjectParam`), so a
 *  mixed pin is `bad-query` `pin-shape` and a bad value its `bad-*`. The keys are the pin keys and `project`, and `stat`, which
 *  only a draft's pin may carry (`docsApi.artifactScope`: a draft the listing could not fingerprint names `stat` in place of
 *  `fp`). A stat-pinned draft is refused `draft-too-large` AFTER the project check and BEFORE the pin parser, which would
 *  otherwise read its missing `fp` as a malformed pin (plan m3, part 3): ccd fingerprints a draft only up to
 *  `DOCS_MAX_FILE_BYTES`, so such a draft's version cannot be checked. */
export function parseScopeQuery(query: Readonly<Record<string, unknown>>): ({ ok: true } & ArtifactPinAsk) | ArtifactParseFailure {
  const unknown = firstUnknownKey(query, ['project', 'stat', ...PIN_PLACE_KEYS]);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const p = parseDocsProjectParam(own(query, 'project'));
  if (!p.ok) return p;
  if (Object.hasOwn(query, 'stat')) {
    if (!Object.hasOwn(query, 'branch') || !Object.hasOwn(query, 'head')) return badQuery('pin-shape');
    if (!Object.hasOwn(query, 'fp')) return { ok: false, error: 'draft-too-large' };
  }
  const pin = parseFilePin(query);
  return pin.ok ? { ok: true, project: p.project, pin: pin.pin } : pin;
}

/** The mint's body (`ArtifactMintAsk`), checked the same way before any tree read: a body that is not an object, `origins` that
 *  is not an array of strings and `windows` that is not a boolean are `bad-query` `body`; `project` is checked by
 *  `parseDocsProjectParam`; a stat-pinned draft (`pin.kind` `draft` with `pin.fp` null) is `draft-too-large` before the parser;
 *  every other pin goes through `parseFilePin` over its own fields, and its `kind` must be the kind its keys name, else
 *  `pin-shape`. The origins are returned as asked: whether each is admitted is `originsRefusal`'s, which comes later. */
export function parseMintBody(body: unknown):
  ({ ok: true; origins: string[]; windows: boolean } & ArtifactPinAsk) | ArtifactParseFailure {
  if (!isRecord(body)) return badQuery('body');
  const unknown = firstUnknownKey(body, ['project', 'pin', 'origins', 'windows']);
  if (unknown !== undefined) return badQuery('unknown', unknown);
  const origins = own(body, 'origins');
  if (!Array.isArray(origins) || !origins.every((o): o is string => typeof o === 'string')) return badQuery('body');
  const windows = own(body, 'windows');
  if (typeof windows !== 'boolean') return badQuery('body');
  const p = parseDocsProjectParam(own(body, 'project'));
  if (!p.ok) return p;
  const asked = own(body, 'pin');
  if (!isRecord(asked)) return badQuery('pin-shape');
  const kind = own(asked, 'kind');
  if (kind === 'draft' && own(asked, 'fp') === null) return { ok: false, error: 'draft-too-large' };
  const unknownPin = firstUnknownKey(asked,['kind', 'stat', ...PIN_PLACE_KEYS]);
  if (unknownPin !== undefined) return badQuery('unknown', unknownPin);
  const pin = parseFilePin(asked);
  if (!pin.ok) return pin;
  if (pin.pin.kind !== kind) return badQuery('pin-shape');
  return { ok: true, project: p.project, pin: pin.pin, origins, windows };
}

/** Only an HTML page runs as an artifact: any other class of the pin's path is `not-html`. */
export function htmlRefusal(pin: DocPin): 'not-html' | null {
  return contentClass(pin.path) === 'html' ? null : 'not-html';
}

/** The host part of an origin, lower-cased with one trailing dot dropped, whatever its scheme and port; `''` for text with none. */
function hostnameOfOrigin(origin: string): string {
  const rest = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const end = rest.search(/[:/?#]/);
  const host = (end < 0 ? rest : rest.slice(0, end)).toLowerCase();
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/** Whether `origin` may be a capability's confirmed external origin: an exact https origin (`isExactHttpsOrigin`) whose HOSTNAME
 *  is none of `ours` (the console, the artifact and the content origins), on any port, since a page allowed to call one of
 *  those hosts would void the path scoping of spec 4.3. Refuses too much, never too little. */
export function originAdmission(origin: string, ours: readonly string[]): boolean {
  if (!isExactHttpsOrigin(origin)) return false;
  const host = hostnameOfOrigin(origin);
  // A host a browser reads as an IPv4 address (`127.0.0.2`, `10.1`, `0x7f.0.0.1`) is rewritten before use, so it could name one
  // of ours under a spelling the string compare below never sees: refused, as the config refuses an address for an origin.
  if (looksNumeric(host)) return false;
  return !ours.some((o) => hostnameOfOrigin(o) === host);
}

/** The mint's origin step: more than `ARTIFACT_MAX_ORIGINS` origins, or any that `originAdmission` refuses, is `bad-origin`. */
export function originsRefusal(origins: readonly string[], ours: readonly string[]): 'bad-origin' | null {
  if (origins.length > ARTIFACT_MAX_ORIGINS) return 'bad-origin';
  return origins.every((o) => originAdmission(o, ours)) ? null : 'bad-origin';
}

/** The ref the tree read names for a pin: a committed pin's `servedRef` (qualified, as the tree answer carried it), a draft
 *  pin's `branch` (bare), each through `parseDocsRef`. A pin the parser admitted is always in its grammar; the failure arm is
 *  the defensive answer for one that is not, and never a read of the default ref. */
export function artifactTreeRef(pin: DocPin): { ok: true; ref: DocsRefSpec } | DocsFailureBody {
  const ref = parseDocsRef(pin.kind === 'committed' ? pin.servedRef : pin.branch);
  return ref === null ? { ok: false, failure: 'bad-ref' } : { ok: true, ref };
}

/** The tree entry of the pin's page: its section and its section-relative path. */
function pageEntry(pin: DocPin, tree: DocsTreeOk): DocsEntry | undefined {
  return tree.entries.find((e) => e.section === pin.section && e.path === pin.path);
}

/** Whether the tree read is the version the pin names (spec 3.2: the tree read takes a ref NAME and answers what the ref holds
 *  now). A committed pin holds when the tree's commit is the pin's `commit`. A draft pin holds when the tree's commit is the
 *  pin's `head` AND the page's own entry carries the pin's `fp` (a deleted page, one replaced by a symlink and any other null
 *  `fp` never equal it). */
export function pinHolds(pin: DocPin, tree: DocsTreeOk): boolean {
  if (pin.kind === 'committed') return tree.ref.commit === pin.commit;
  if (tree.ref.commit !== pin.head) return false;
  const page = pageEntry(pin, tree);
  return page !== undefined && page.draft !== null && page.draft.fp === pin.fp;
}

/** A draft page that is a regular file above `DOCS_MAX_FILE_BYTES` has no fingerprint in the tree (ccd hashes a draft only up
 *  to that size, so its `fp` is null), and nothing can show that its pin still holds. It is checked BEFORE `pinHolds`, which
 *  would read that null as a moved pin. A page deleted, replaced by a symlink or unreadable is not this: it is `pin-moved`. */
export function draftTooLarge(pin: DocPin, tree: DocsTreeOk): boolean {
  if (pin.kind !== 'draft') return false;
  const d = pageEntry(pin, tree)?.draft ?? null;
  return d !== null && d.kind === 'file' && d.fp === null && d.size !== null && d.size > DOCS_MAX_FILE_BYTES;
}

/** What one scope or mint carries: the manifest's entries and what was left out. `page` is how the page's own entry stands: `ok`
 *  (in the manifest), `too-large` (above `DOCS_RANGE_MAX_BYTES`) or `unsized` (left out for a null size, or no entry to pin). */
export interface ManifestScope {
  entries: ArtifactManifestEntry[];
  unsized: number;
  uncommitted: number;
  bytes: number;
  page: 'ok' | 'too-large' | 'unsized';
}

type EntryRead = 'out' | 'unsized' | { pin: DocsRangePin; size: number; committed: boolean };

/** An entry read at its committed blob: a regular file (`file` or `exec`) only; a symlink or a submodule is out, uncounted. */
function committedRead(e: DocsEntry): EntryRead {
  const c = e.committed;
  if (c === null || (c.kind !== 'file' && c.kind !== 'exec')) return 'out';
  return c.size === null ? 'unsized' : { pin: { kind: 'blob', sha: c.blob }, size: c.size, committed: true };
}

/** An entry read in a draft pin's view: its draft when it has one (a deleted entry or one that is not a regular file is out; a
 *  fingerprint is the `fp` pin; none is the stat pin, and none of those is `unsized`), else its committed blob. */
function draftRead(e: DocsEntry): EntryRead {
  const d = e.draft;
  if (d === null) return committedRead(e);
  if (d.state === 'deleted' || d.kind !== 'file') return 'out';
  if (d.fp !== null) return d.size === null ? 'unsized' : { pin: { kind: 'fp', sha: d.fp }, size: d.size, committed: false };
  const stat = statPin(d.size, d.mtimeNs);
  return stat === null || stat.kind !== 'stat' ? 'unsized' : { pin: stat, size: stat.size, committed: false };
}

/** The manifest of the pin's page (spec 3.2): the entries of the pin's section, in the page's directory and below, with no
 *  segment `.`, `..` or empty. A page directly in its section's root leaves out every Markdown file (`contentClass` `markdown`:
 *  `.md` and `.markdown`), root or nested (the specs and plans beside it are documents to read, not its assets). Each entry is pinned as the pin's kind reads it (`committedRead`,
 *  `draftRead`). An entry with no size, or above `DOCS_RANGE_MAX_BYTES` (the tier's one per-file ceiling, the page included), is
 *  left out and counted in `unsized`. The walls' 2 MiB HTML cap is never consulted. `pagePath` is the pin's own `path`. */
export function manifestScope(pin: DocPin, pagePath: string, entries: readonly DocsEntry[]): ManifestScope {
  const slash = pagePath.lastIndexOf('/');
  const dir = slash < 0 ? '' : pagePath.slice(0, slash);
  const prefix = dir === '' ? '' : dir + '/';
  const out: ManifestScope = { entries: [], unsized: 0, uncommitted: 0, bytes: 0, page: 'unsized' };
  for (const e of entries) {
    if (e.section !== pin.section || !e.path.startsWith(prefix)) continue;
    if (e.path.split('/').some((s) => s === '' || s === '.' || s === '..')) continue;
    if (dir === '' && contentClass(e.path) === 'markdown') continue;
    const read = pin.kind === 'committed' ? committedRead(e) : draftRead(e);
    if (read === 'out') continue;
    const isPage = e.path === pagePath;
    if (read === 'unsized' || read.size > DOCS_RANGE_MAX_BYTES) {
      out.unsized++;
      if (isPage && read !== 'unsized') out.page = 'too-large';
      continue;
    }
    out.entries.push({ rel: e.path, pin: read.pin, size: read.size, mime: artifactMime(e.path).mime, committed: read.committed });
    out.bytes += read.size;
    if (!read.committed) out.uncommitted++;
    if (isPage) out.page = 'ok';
  }
  return out;
}

/** Everything after the tree read, in the design's order: a draft page above 4 MiB (`draft-too-large`, before `pinHolds`), a pin
 *  that does not hold (`pin-moved`), then the manifest and the page's own standing: above the ceiling is `page-too-large`, one
 *  left out for want of a size or an entry is `unmeasured`. */
export function scopeOfTree(pin: DocPin, tree: DocsTreeOk): { ok: true; scope: ManifestScope } | { ok: false; error: ArtifactRefusal } {
  if (draftTooLarge(pin, tree)) return { ok: false, error: 'draft-too-large' };
  if (!pinHolds(pin, tree)) return { ok: false, error: 'pin-moved' };
  const scope = manifestScope(pin, pin.path, tree.entries);
  if (scope.page === 'too-large') return { ok: false, error: 'page-too-large' };
  if (scope.page === 'unsized') return { ok: false, error: 'unmeasured' };
  return { ok: true, scope };
}

/** The scope read's answer: the manifest's counts, nothing minted. */
export function scopeAnswer(scope: ManifestScope): ArtifactScopeOk {
  return { ok: true, files: scope.entries.length, uncommitted: scope.uncommitted, unsized: scope.unsized, bytes: scope.bytes };
}

/** The list read's answer: whether a mint could work now and, when it could not, the reason (`artifactAvailability`'s), beside the
 *  live capabilities as rows (`null` is no store at all, so none). */
export function listAnswer(
  verdict: { available: true } | { available: false; why: ArtifactOffWhy }, live: readonly ArtifactRow[] | null,
): ArtifactListOk {
  const rows = [...(live ?? [])];
  return verdict.available ? { ok: true, available: true, live: rows } : { ok: true, available: false, why: verdict.why, live: rows };
}

/** The revoke doors' answer: what the store ended, as the door read it. `null` is no store (nothing to end: 0), a boolean is one
 *  capability's revoke (1 or 0), a number is Revoke all's count. */
export function revokeAnswer(ended: boolean | number | null): ArtifactRevokeOk {
  return { ok: true, revoked: ended === null ? 0 : typeof ended === 'number' ? ended : ended ? 1 : 0 };
}

/** The wrapper URL a mint answers once (spec 3.2). */
export function artifactUrl(artifactOrigin: string, token: string): string {
  return `${artifactOrigin}/a/${token}`;
}

/** The mint's answer: the URL (the one place the token is ever written out), the expiry and the manifest's counts. */
export function mintAnswer(artifactOrigin: string, token: string, id: string, expiresAt: number, scope: ManifestScope): ArtifactMintOk {
  return {
    ok: true, id, url: artifactUrl(artifactOrigin, token), expiresAt, files: scope.entries.length,
    uncommitted: scope.uncommitted, unsized: scope.unsized,
  };
}

/** What the store is handed to mint (spec 3.3): the session, the page's place, the tree read's ref, the manifest keyed by its
 *  section-relative path, and the origins and windows as asked. `drafts` is the store's to count. */
export function capabilityInput(
  sessionIdHash: string, ask: ArtifactPinAsk, tree: DocsTreeOk, scope: ManifestScope, origins: readonly string[], windows: boolean,
): CapabilityInput {
  const slash = ask.pin.path.lastIndexOf('/');
  return {
    sessionIdHash, project: ask.project, pin: ask.pin, ref: { commit: tree.ref.commit, served: tree.ref.served },
    section: ask.pin.section, dir: slash < 0 ? '' : ask.pin.path.slice(0, slash), page: ask.pin.path,
    manifest: new Map(scope.entries.map((e) => [e.rel, e])), origins: [...origins], windows,
  };
}
