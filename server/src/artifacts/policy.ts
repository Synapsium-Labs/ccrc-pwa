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
  ARTIFACT_MAX_INFLIGHT, ARTIFACT_MAX_INFLIGHT_BOX, ARTIFACT_QUEUE_PER_CAPABILITY, ARTIFACT_SANDBOX_BASE, ARTIFACT_SANDBOX_WINDOWS,
  ARTIFACT_MAX_ORIGINS, ARTIFACT_PUBLIC_SUFFIXES, ARTIFACT_QUEUE_WAIT_MS, ARTIFACT_HOURLY_BYTES, ARTIFACT_RESPONSE_MAX_MS, artifactMime, type ArtifactListOk, type ArtifactMintOk, type ArtifactOffWhy,
  type ArtifactRefusal, type ArtifactRevokeOk, type ArtifactRow, type ArtifactScopeOk,
} from '../../../shared/artifacts.js';
import {
  DOCS_MAX_FILE_BYTES, DOCS_PIN_KEYS, DOCS_RANGE_MAX_BYTES, contentClass, parseDocsRef, statPin,
  type DocPin, type DocsEntry, type DocsFailureBody, type DocsRangePin, type DocsRefSpec, type DocsTreeOk,
} from '../../../shared/docs.js';
import {
  DOCS_LANE_LARGE_RAW, badQuery, docsOwn as own, firstUnknownKey, isDocsRecord as isRecord, parseDocsProjectParam, parseFilePin, type DocsSignIn,
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
 *  only key names, the values the operator wrote and the rule's words, since it goes to a boot warning.
 *  `masks` says whether the console's answer mask would alter a string (the caller hands in the shape-only masker, its one
 *  home; absent, nothing is masked). Last, after the site rule: an origin it would alter is `invalid`, naming the key but never
 *  the value, because a mint answer carries the artifact origin and the mask would alter every one, so no link could reach the
 *  operator (D-9161). The live masker can also alter a string holding a stored secret's exact bytes; that is not known here,
 *  and the mint's draws still answer `unmeasured` for it. */
export function artifactConfig(
  env: { origin?: string; content?: string; port?: string; exposeMode?: string },
  consoleOrigin: string,
  consolePort: number,
  masks: (value: string) => boolean = () => false,
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
  // The artifact origin is in every mint's answer, so a name the mask alters means no link can reach the operator. The content
  // origin is in no masked answer today (the wrapper and the page's headers come from the artifact listener, unmasked); it is held
  // to the same rule so the two hosts are one rule and no later answer that names it is ever altered (the coordinator's ruling).
  if (masks(origin)) {
    return invalid(`${KEY_ORIGIN} has a name the console's answer mask would alter (it has a credential's shape), so no link `
      + 'could reach you; choose another label');
  }
  if (masks(content)) {
    return invalid(`${KEY_CONTENT} has a name the console's answer mask would alter (it has a credential's shape); both artifact `
      + 'hosts are held to the same rule; choose another label');
  }
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

/** The status of an answer for a request Node could not parse (its `clientError` code), as Node's own default answers it: an
 *  oversized header is 431, a chunk extension past Node's limit is 413, a request that outlived Node's request timeout is 408,
 *  anything else is 400 (X5 A3 took the 413 from the A1 review, which measured 400 here where Node answers 413). */
export function clientErrorStatus(code: unknown): 400 | 408 | 413 | 431 {
  if (code === 'HPE_HEADER_OVERFLOW') return 431;
  if (code === 'HPE_CHUNK_EXTENSIONS_OVERFLOW') return 413;
  if (code === 'ERR_HTTP_REQUEST_TIMEOUT') return 408;
  return 400;
}

/** What the artifact instance does with a request Node could not parse, by Node's own rule (`socketOnError` in its HTTP server):
 *  answer with `clientErrorStatus` only while the socket is writable and the response in flight on it, if any, has not sent its
 *  headers. A connection reset, a socket that cannot be written, or a response already under way (its headers on the wire, its
 *  body streaming) is destroyed with nothing written, because a status line written then would land inside that response's
 *  body (X5 A3, from the A1 review). */
export function clientErrorAction(code: unknown, writable: boolean, headersSent: boolean):
  { kind: 'answer'; status: 400 | 408 | 413 | 431 } | { kind: 'destroy' } {
  if (code === 'ECONNRESET' || !writable || headersSent) return { kind: 'destroy' };
  return { kind: 'answer', status: clientErrorStatus(code) };
}

/** The status of Fastify's own answer to an error it raises before any hook runs (its `frameworkErrors` codes), as Fastify's
 *  defaults answer it: a malformed percent-escape in the path is 400, an over-long path parameter is 414, anything else (an
 *  async constraint's failure) is 500. Both instances answer with this status and fixed words, never the default body, whose
 *  `message` echoes the request path, and a path on this tier holds a capability token (X5 A3, from the A1 reviews). */
export function frameworkErrorStatus(code: unknown): 400 | 414 | 500 {
  if (code === 'FST_ERR_BAD_URL') return 400;
  if (code === 'FST_ERR_MAX_PARAM_LENGTH') return 414;
  return 500;
}

/** The fixed `error` words of the console's answer to a framework error: the runtime's own reason phrase for each status
 *  `frameworkErrorStatus` can answer (Node's `http.STATUS_CODES`, and Fastify's default), so the console's 414 reads `URI Too
 *  Long`, not `Bad Request`. A literal table, with no import of `node:http` here; the answer still echoes nothing of the path
 *  (X5 A3 fix round 1, review 4050 A4). */
export function frameworkErrorPhrase(status: 400 | 414 | 500): string {
  if (status === 400) return 'Bad Request';
  if (status === 414) return 'URI Too Long';
  return 'Internal Server Error';
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

/** The scope read's answer: the manifest's counts, nothing minted, and the tier's two hosts (D-9162: the launch sheet names the
 *  artifact host and offers no outside origin on either; the mint still refuses such an origin `bad-origin` itself). */
export function scopeAnswer(scope: ManifestScope, cfg: ArtifactTierOn): ArtifactScopeOk {
  return {
    ok: true, files: scope.entries.length, uncommitted: scope.uncommitted, unsized: scope.unsized, bytes: scope.bytes,
    artifactHost: cfg.artifactHost, contentHost: cfg.contentHost,
  };
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

// ---- The content door's policy: CSP, headers, fetch fences, cache, ranges, admission (X5 A3.2; spec 4.3 and 5) -----------------
// Pure decisions the content door (`routes.ts`, L4) applies and never makes itself. Every directive, header and fence row is the
// design's text; a change here is a change to the design.

/** The header CSP of every content response (spec 4.3, directives in the design's order). `S` is the capability path on the content
 *  host, so a source never admits another capability's files, and `'self'` is never used. The confirmed `origins` go to script,
 *  style, image and font only, never to `connect-src` (or media, worker, frame or child): a page that fetches from an outside API
 *  still fails. The `sandbox` directive repeats the frame's, so a content URL opened top-level is sandboxed too; `allow-popups`
 *  joins it only for a capability minted with windows. */
export function contentCsp(
  contentOrigin: string, artifactOrigin: string, token: string, origins: readonly string[], windows: boolean,
): string {
  const s = `${contentOrigin}/c/${token}/`;
  const o = origins.length === 0 ? '' : ` ${origins.join(' ')}`;
  const sandbox = windows ? [...ARTIFACT_SANDBOX_BASE, ARTIFACT_SANDBOX_WINDOWS] : [...ARTIFACT_SANDBOX_BASE];
  return [
    `default-src 'none'`,
    `script-src ${s} 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:${o}`,
    `style-src ${s} 'unsafe-inline' data:${o}`,
    `img-src ${s} data: blob:${o}`,
    `font-src ${s} data:${o}`,
    `media-src ${s} data: blob:`,
    `connect-src ${s} data: blob:`,
    `worker-src ${s} blob:`,
    `frame-src ${s}`,
    `child-src ${s} blob:`,
    `manifest-src 'none'`,
    `object-src 'none'`,
    `base-uri ${s}`,
    `form-action 'none'`,
    `frame-ancestors ${artifactOrigin} ${contentOrigin}`,
    `sandbox ${sandbox.join(' ')}`,
  ].join('; ');
}

/** The other headers on every content response (spec 4.3 and 5), lower-case names. No `access-control-allow-origin`: every
 *  legitimate request is same-origin. Frozen, so no importer adds a header to it at run time. */
export const CONTENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-dns-prefetch-control': 'off',
  'x-robots-tag': 'noindex, nofollow',
  'accept-ranges': 'bytes',
  'permissions-policy':
    'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=(), display-capture=(), fullscreen=(self), clipboard-write=(self)',
  // D-9145 (the coordinator's ruling of 2026-11-27): a browser's HTTP cache must never stand in for the service-worker fence. A
  // response stored for a script tag or a fetch was asked with another `Sec-Fetch-Dest` and no `Service-Worker` header, so it never
  // answers a worker's script request, which goes to the network and meets `fetchFence`.
  vary: 'Sec-Fetch-Dest, Service-Worker',
});

/** Every JavaScript MIME type essence a browser accepts as a script (the MIME Sniffing standard's list), the one place the tier
 *  names them: `cacheKind` reads it for every type the MIME table can answer, so a script extension added to the table later is
 *  never stored either (D-9145). */
const JAVASCRIPT_ESSENCES: ReadonlySet<string> = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3',
  'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
]);

/** Whether a MIME type essence is an XML MIME type in the MIME Sniffing standard's sense: `text/xml`, `application/xml`, or any
 *  essence whose SUBTYPE ends in `+xml` (`image/svg+xml`, `application/xhtml+xml`, `application/rss+xml`, ...). The caller passes
 *  the essence, so a parameter such as `x=+xml` never reaches the test. The one place the tier names them (D-9149).
 *  The MIME table (`ARTIFACT_MIME`, `shared/artifacts.ts`) has no row for `xsl`, `xslt`, `rdf` or `xml` today (review 4062), so
 *  every such file is an octet-stream attachment. A row added for one of them must be looked at here: its type must be one this
 *  test catches (`text/xml`, `application/xml` or a `+xml` subtype such as `application/xslt+xml`), never an older spelling such
 *  as `text/xsl`, or a document that runs script would be cached under the `other` rule. */
function isXmlEssence(essence: string): boolean {
  if (essence === 'text/xml' || essence === 'application/xml') return true;
  const subtype = essence.slice(essence.indexOf('/') + 1);
  return essence.includes('/') && subtype.endsWith('+xml');
}

/** Which cache rule a served file takes, by its MIME type's essence (the type less any parameter, trimmed, lower-cased): `html`
 *  for a document a browser opens and runs script in, which is the MIME Sniffing standard's HTML MIME type (`text/html`) and
 *  every XML MIME type (an SVG, an XHTML page or an XSLT sheet run script on the content origin when opened as a document;
 *  D-9149), `script` for a JavaScript type a browser runs as a script, `other` for everything else (D-9145). */
export function cacheKind(mime: string): 'html' | 'script' | 'other' {
  const essence = mime.split(';')[0]!.trim().toLowerCase();
  if (essence === 'text/html' || isXmlEssence(essence)) return 'html';
  return JAVASCRIPT_ESSENCES.has(essence) ? 'script' : 'other';
}

/** The fetch-metadata fence (spec 4.3's table), decided before a byte is read. The first row that matches wins. The caller passes
 *  the header values lower-cased, as browsers send them. A client that is not a browser can send any header, so for such a client
 *  the capability is the whole check (spec 7). */
export function fetchFence(
  h: { dest?: string; mode?: string; site?: string; serviceWorker?: string }, windows: boolean,
): 'ok' | 'refused' {
  // Fails closed: all three fetch-metadata headers must be there.
  if (!h.dest || !h.mode || !h.site) return 'refused';
  // A `Service-Worker` header, even an empty one, is a service worker's script fetch.
  if (h.serviceWorker !== undefined) return 'refused';
  if (h.dest === 'serviceworker' || h.dest === 'embed' || h.dest === 'object') return 'refused';
  if (h.mode === 'navigate') {
    if (h.dest === 'iframe') return 'ok';
    if (h.dest === 'document') return windows ? 'ok' : 'refused';
    // A download the page starts (`<a download>`) is sent as a navigation with dest `empty`, from the same origin only.
    if (h.dest === 'empty') return h.site === 'same-origin' ? 'ok' : 'refused';
    return 'refused';
  }
  return h.site === 'same-origin' ? 'ok' : 'refused';
}

/** The browser cache rule (spec 5, "Browser cache", amended by D-9145 and D-9149): a response of kind `html`, a document that can
 *  run script (HTML or any XML type), is never cached, so a dead capability cannot start a page, nor can Back/Forward or a
 *  reload replay one; a script is never cached either, so a worker's script fetch always reaches the network and the
 *  service-worker fence, whatever a browser does with `Vary` (D-9145); any other file is cached for the seconds the capability
 *  may still live, at most an hour, because a pin's bytes never change. `cacheKind` picks the kind from the MIME type. */
export function cacheControl(kind: 'html' | 'script' | 'other', secondsLeft: number): string {
  if (kind === 'html' || kind === 'script') return 'no-store';
  // A value that is not a number (a missing expiry) is 0, never a malformed `max-age=NaN`.
  const n = Number.isFinite(secondsLeft) ? Math.min(3600, Math.max(0, Math.floor(secondsLeft))) : 0;
  return `private, max-age=${n}, immutable`;
}

/** What a `Range` header asks of a file of `size` bytes (spec 5, "Ranges"; RFC 9110 section 14). `end` is inclusive. A header that
 *  is not one `bytes=` range spec is ignored (the whole file), which RFC 9110 lets a server do with a Range it cannot parse;
 *  several ranges, or one the file cannot satisfy, are unsatisfiable (416). */
export function parseRange(
  header: string | undefined, size: number,
): { kind: 'whole' } | { kind: 'one'; start: number; end: number } | { kind: 'unsatisfiable' } {
  const whole = { kind: 'whole' } as const;
  const unsatisfiable = { kind: 'unsatisfiable' } as const;
  if (header === undefined) return whole;
  if (!header.startsWith('bytes=')) return whole;
  const spec = header.slice('bytes='.length);
  if (spec.includes(',')) return unsatisfiable;
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (m === null) return whole;
  const [, a, b] = m as unknown as [string, string, string];
  if (a === '' && b === '') return whole;
  // More than 15 digits can pass `Number.MAX_SAFE_INTEGER`; such a spec is ignored.
  if (a.length > 15 || b.length > 15) return whole;
  if (a === '') {
    const n = Number(b);
    if (n === 0 || size === 0) return unsatisfiable;
    return { kind: 'one', start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  if (b !== '') {
    const end = Number(b);
    if (start > end) return whole;
    if (start >= size) return unsatisfiable;
    return { kind: 'one', start, end: Math.min(end, size - 1) };
  }
  if (start >= size) return unsatisfiable;
  return { kind: 'one', start, end: size - 1 };
}

/** The `Content-Type` a served file carries: its MIME, with the charset on served text, so a browser never guesses one. */
export function artifactContentType(mime: string): string {
  return mime.startsWith('text/') || mime === 'application/json' || mime === 'image/svg+xml' ? `${mime}; charset=utf-8` : mime;
}

/** A new request's admission (spec 5, "Waiting, not refusing"): it runs when nothing of its capability waits and both the
 *  capability and the box have room; else it waits in its capability's queue; past the queue's bound it is refused (429). */
export function admitLoad(c: { inflight: number; queued: number }, boxInflight: number): 'run' | 'wait' | 'full' {
  if (c.queued === 0 && c.inflight < ARTIFACT_MAX_INFLIGHT && boxInflight < ARTIFACT_MAX_INFLIGHT_BOX) return 'run';
  return c.queued < ARTIFACT_QUEUE_PER_CAPABILITY ? 'wait' : 'full';
}

/** Whether a request already at the head of its capability's queue may start now: the same two bounds, with no queue to look at. */
export function admitQueued(c: { inflight: number }, boxInflight: number): boolean {
  return c.inflight < ARTIFACT_MAX_INFLIGHT && boxInflight < ARTIFACT_MAX_INFLIGHT_BOX;
}

// ---- The content door's route decisions (X5 A3.3; spec 3.4, 4.3 and 5) -----------------------------------------------------
// Pure decisions `content.ts` (L4) applies and never makes itself: the raw path, which host a route answers on, the fences'
// input, every fixed answer, the whole header set, the prepare slot and what a failed read becomes.

/** The path of a content request from the RAW request URL, never from the router's `*` parameter (which may already be decoded).
 *  The query and fragment are cut first; the path must be `/c/<token>/<rest>`; `token` is the raw segment (not decoded) and `rest`
 *  is decoded ONCE. `null` for a malformed escape, and for any segment that is empty, `.` or `..` or holds `\` or NUL, so a
 *  traversal spelling is never a lookup. No file-system path is ever built from the answer. */
export function contentRequestPath(rawUrl: string): { token: string; rel: string } | null {
  let path = rawUrl;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  if (!path.startsWith('/c/')) return null;
  const rest = path.slice('/c/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const raw = rest.slice(slash + 1);
  if (raw === '') return null;
  let rel: string;
  try {
    rel = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (rel.split('/').some((s) => s === '' || s === '.' || s === '..' || s.includes('\\') || s.includes('\u0000'))) return null;
  return { token: rest.slice(0, slash), rel };
}

/** The manifest key of a request path: the manifest is keyed by SECTION-relative path, a capability's `dir` is the page's directory
 *  in its section (`''` at the root), and the request's path is relative to `dir`. */
export function contentKey(dir: string, rel: string): string {
  return dir === '' ? rel : `${dir}/${rel}`;
}

/** Which host each route answers on (spec 3.4's table): the wrapper on the artifact host, the content door and `/clear` on the
 *  content host, `GET /` on either. A wrong host on a known route is that route's identical 404, never a 421: the 421 stays the
 *  fence's, for a host that is neither. */
export function routeHostOk(
  route: 'wrapper' | 'content' | 'clear' | 'root', host: string | undefined, cfg: { artifactHost: string; contentHost: string },
): boolean {
  if (route === 'wrapper') return hostMatches(host, [cfg.artifactHost]);
  if (route === 'root') return hostMatches(host, [cfg.artifactHost, cfg.contentHost]);
  return hostMatches(host, [cfg.contentHost]);
}

/** `/clear` is loaded only into the wrapper's frame: exactly `iframe`. */
export function clearDestOk(dest: string | undefined): boolean {
  return dest === 'iframe';
}

/** The CSP of `/clear`'s page (spec 3.4): nothing loads, and only the artifact host may frame it. */
export function CLEAR_CSP(artifactOrigin: string): string {
  return `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${artifactOrigin}`;
}

/** The fence's input from the request's raw header values: the three `Sec-Fetch-*` values lower-cased, and a `Service-Worker`
 *  header of ANY value, an empty one included, as present. The fence itself is `fetchFence`. */
export function contentFence(
  h: { dest?: string | string[]; mode?: string | string[]; site?: string | string[]; serviceWorker?: string | string[] },
  windows: boolean,
): 'ok' | 'refused' {
  const low = (v: string | string[] | undefined): string | undefined =>
    v === undefined ? undefined : (Array.isArray(v) ? v.join(',') : v).toLowerCase();
  return fetchFence({ dest: low(h.dest), mode: low(h.mode), site: low(h.site), serviceWorker: low(h.serviceWorker) }, windows);
}

/** The artifact prepare slot (spec 5, "Prepare busy" and "Box budget"): at most this many prepares run at once, and this many start
 *  in any minute, half of ccd's box-wide 2 and 6, so console prepares keep the other half. (The docs lane already holds one artifact
 *  job at a time, but its own wait is 10 s, shorter than the minute, so the window is the door's, inside the request's wait.) */
export const ARTIFACT_PREPARES_AT_ONCE = 1;
export const ARTIFACT_PREPARES_PER_MINUTE = 3;
/** The pause before a prepare asks ccd again after its `prepare-busy`. */
export const ARTIFACT_PREPARE_RETRY_MS = 2000;
const PREPARE_WINDOW_MS = 60000;

/** Whether a prepare may start now, from whether one runs and when the recent ones started: a running one makes it wait with no
 *  time to wake at (it wakes when that one ends); three starts within the last minute make it wait until the oldest counted one is
 *  a minute old; else it starts. */
export function prepareSlot(state: { running: boolean; starts: readonly number[] }, now: number):
  { kind: 'start' } | { kind: 'wait'; until: number | null } {
  if (state.running) return { kind: 'wait', until: null };
  const recent = state.starts.filter((t) => now - t < PREPARE_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length >= ARTIFACT_PREPARES_PER_MINUTE) {
    return { kind: 'wait', until: recent[recent.length - ARTIFACT_PREPARES_PER_MINUTE]! + PREPARE_WINDOW_MS };
  }
  return { kind: 'start' };
}

/** Whether a manifest entry is read as range frames with a snapshot: above `DOCS_LANE_LARGE_RAW`, derived, never restated. A
 *  smaller one is one whole show cut to the range. */
export function artifactFramed(entry: { size: number }): boolean {
  return entry.size > DOCS_LANE_LARGE_RAW;
}

/** How long a request that arrived at `arrivedAt` may still wait, at `now`: `ARTIFACT_QUEUE_WAIT_MS` from its arrival, never below 0. */
export function queueWaitLeft(arrivedAt: number, now: number): number {
  return Math.max(0, ARTIFACT_QUEUE_WAIT_MS - (now - arrivedAt));
}

/** Whole seconds a capability may still live at `now`, from its expiry: never below 0. */
export function secondsLeftOf(expiresAtMs: number, now: number): number {
  return Math.max(0, Math.floor((expiresAtMs - now) / 1000));
}

/** The bytes a response carries: the range's length, or the whole file's. `range` is inclusive. */
export function responseLength(range: { start: number; end: number } | null, size: number): number {
  return range === null ? size : range.end - range.start + 1;
}

/** Whether a frame of `length` bytes still fits in a response of `total` bytes of which `sent` are out: a response never sends
 *  past its `Content-Length`. */
export function frameFits(sent: number, length: number, total: number): boolean {
  return sent + length <= total;
}

/** The whole header set of a 200 or a 206 (spec 4.3 and 5): the type (with its charset on text), the length, the CSP built for this
 *  capability, every `CONTENT_HEADERS` entry, the cache rule by the file's MIME kind, an attachment disposition for a file the
 *  MIME table does not know, and for a range the `Content-Range`. No `set-cookie` and no `access-control-*`. */
export function contentHeaders(i: {
  key: string; entry: { mime: string; size: number }; range: { start: number; end: number } | null;
  contentOrigin: string; artifactOrigin: string; token: string; origins: readonly string[]; windows: boolean; secondsLeft: number;
}): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': artifactContentType(i.entry.mime),
    'content-length': String(responseLength(i.range, i.entry.size)),
    'content-security-policy': contentCsp(i.contentOrigin, i.artifactOrigin, i.token, i.origins, i.windows),
    ...CONTENT_HEADERS,
    'cache-control': cacheControl(cacheKind(i.entry.mime), i.secondsLeft),
  };
  if (artifactMime(i.key).attachment) h['content-disposition'] = 'attachment';
  if (i.range !== null) h['content-range'] = `bytes ${i.range.start}-${i.range.end}/${i.entry.size}`;
  return h;
}

/** The content door's fixed answers other than the identical 404: a status, a fixed text body and the headers. None echoes
 *  anything of the request. Each carries the `Vary` of `CONTENT_HEADERS` (D-9145). `wait-out` is the 503 of a wait that ran out or
 *  a lane that is busy; `too-many` the 429 of a full queue or a spent hour. */
export type ContentAnswerKind = 'forbidden' | 'too-many' | 'wait-out' | 'draft-changed';
export function contentAnswer(kind: ContentAnswerKind): { status: number; body: string; headers: Record<string, string> } {
  const vary = { vary: CONTENT_HEADERS['vary']! };
  switch (kind) {
    case 'forbidden': return { status: 403, body: 'Forbidden.', headers: vary };
    case 'too-many': return { status: 429, body: 'Too many requests.', headers: vary };
    case 'wait-out': return { status: 503, body: 'Busy. Try again shortly.', headers: { ...vary, 'retry-after': '5' } };
    case 'draft-changed': return { status: 409, body: 'This draft file changed since the page was opened.', headers: vary };
  }
}

/** The 416 of a range the file cannot satisfy, or several (RFC 9110: `Content-Range: bytes * /size`). */
export function unsatisfiableAnswer(size: number): { status: 416; body: string; headers: Record<string, string> } {
  return { status: 416, body: 'Range not satisfiable.', headers: { vary: CONTENT_HEADERS['vary']!, 'content-range': `bytes */${size}` } };
}

/** What a failed READ becomes. `wrote` is whether a byte is out already; `reprepared` whether the snapshot was already prepared
 *  once more for this response. A `snapshot-gone` the first time is a re-prepare (before a byte or after, reading on from the next
 *  unsent byte). After a byte every other failure destroys the socket short of `Content-Length`, never a short 200. Before one:
 *  `draft-changed` is the 409, `busy` the 503 (kept apart from `unreadable`), anything else the identical 404. */
export type ReadFailureAction =
  { kind: 'status'; status: 404 | 409 | 503 } | { kind: 'reprepare' } | { kind: 'destroy' };
export function readFailureAction(error: string, wrote: boolean, reprepared: boolean): ReadFailureAction {
  if (error === 'snapshot-gone' && !reprepared) return { kind: 'reprepare' };
  if (wrote) return { kind: 'destroy' };
  if (error === 'draft-changed') return { kind: 'status', status: 409 };
  if (error === 'busy') return { kind: 'status', status: 503 };
  return { kind: 'status', status: 404 };
}

/** What a failed PREPARE becomes: `prepare-busy` (ccd's own word) is asked again after `ARTIFACT_PREPARE_RETRY_MS`, inside the
 *  request's wait; the rest are `readFailureAction`'s before a byte, and after one the socket is destroyed. */
export function prepareFailureAction(error: string, wrote: boolean): ReadFailureAction | { kind: 'retry' } {
  if (error === 'prepare-busy') return { kind: 'retry' };
  return readFailureAction(error, wrote, true);
}

// ---- The content door's small decisions, fix round of X5 A3.3 -----------------------------------------------------------

/** The hour's byte budget is a window that restarts this long after its start: the store's rule, spelled once here and read by it. */
export const ARTIFACT_BUDGET_WINDOW_MS = 3600000;

/** Whether a capability's byte budget is already spent at `now` (spec 5: "1 GiB served an hour"): the window has not restarted and
 *  the bytes served in it have reached the budget. A request is refused (429) only then; what it is then served is charged frame by
 *  frame, so a ranged read that stops early costs only what it was sent. */
export function budgetSpent(c: { servedThisHour: number; hourStart: number }, now: number): boolean {
  return now - c.hourStart < ARTIFACT_BUDGET_WINDOW_MS && c.servedThisHour >= ARTIFACT_HOURLY_BYTES;
}

/** The status of a 200 or 206 head: a range is 206, the whole file 200. The one place that says so. */
export function contentStatus(range: { start: number; end: number } | null): 200 | 206 {
  return range === null ? 200 : 206;
}

/** What a read that answered `ok` becomes: the response is complete only when exactly its `Content-Length` was sent; any other
 *  count is a cut socket, never a short 200. */
export function readEndVerdict(sent: number, total: number): 'complete' | 'destroy' {
  return sent === total ? 'complete' : 'destroy';
}

/** What a prepare whose wait ran out becomes: the 503 before a byte, a cut socket after one. */
export function prepareTimeoutAction(wrote: boolean): 'wait-out' | 'destroy' {
  return wrote ? 'destroy' : 'wait-out';
}

/** The answer a status from `readFailureAction` stands for: the identical 404 or one of the fixed answers. */
export function statusAnswerKind(status: 404 | 409 | 503): 'not-found' | 'draft-changed' | 'wait-out' {
  return status === 404 ? 'not-found' : status === 409 ? 'draft-changed' : 'wait-out';
}

/** The prepare starts still counted at `now`, with this one added: only those inside the prepare window are kept. */
export function withPrepareStart(starts: readonly number[], now: number): number[] {
  return [...starts.filter((t) => now - t < PREPARE_WINDOW_MS), now];
}

/** The instant a request's wait for a snapshot ends. The first prepare gets `ARTIFACT_QUEUE_WAIT_MS` from the request's arrival. A
 *  re-prepare after `snapshot-gone`, which can come long after that, gets a fresh wait from `now`, never past the response
 *  deadline (`ARTIFACT_RESPONSE_MAX_MS` from admission). */
export function prepareWaitUntil(kind: 'first' | 'again', arrivedAt: number, admittedAt: number, now: number): number {
  if (kind === 'first') return arrivedAt + ARTIFACT_QUEUE_WAIT_MS;
  return Math.min(now + ARTIFACT_QUEUE_WAIT_MS, admittedAt + ARTIFACT_RESPONSE_MAX_MS);
}
