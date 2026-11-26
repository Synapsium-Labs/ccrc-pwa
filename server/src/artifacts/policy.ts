// The artifact tier's config decision and the site rule (native Docs HTML artifacts X5, plan Task A1.2; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md section 2.3). L1 policy: pure decisions, no I/O, no `node:*`,
// no console. It imports only L0 (`shared/httpsOrigin.ts`, `shared/artifacts.ts`) and never `server/src/auth/webauthn.ts`
// (L3) or its `PUBLIC_SUFFIX_TRAPS`, which refuses bad passkey scopes and would reverse its safety direction as an accept list.
//
// ALL OR NOTHING: the three keys are either all present and valid, or the tier is off. A partial or invalid set is never an
// error at boot; the caller (`config.ts`) logs one warning line and the tier stays dark. The site rule refuses too much,
// never too little: its one way to be wrong is a refusal.
import { isExactHttpsOrigin } from '../../../shared/httpsOrigin.js';
import { ARTIFACT_PUBLIC_SUFFIXES } from '../../../shared/artifacts.js';

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
    if (p === null) return { ok: false, detail: `${key}=${shown(value)} writes its port with a leading zero` };
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
