// The exact-https-origin grammar (native Docs HTML artifacts X5, plan Task A1.1). L0: imports nothing. It is the ONE thing
// the walls tier (the mockup viewer) and the artifact tier share; no policy constant is shared, only this grammar.

/** The one host grammar (mockup base 5.6.4, hardened in review): lower-case LDH labels, each 1 to 63 characters and neither
 *  starting nor ending with `-`, at least two labels, at most 253 characters in all. A trailing dot is refused: `new URL`
 *  keeps it (`https://a.example.` is its own origin), but a CSP host-source has no such form, so it would break the
 *  directive. An origin validator and a policy builder both ask this ONE function, so an origin the first accepts can
 *  never make the second throw. */
export function isExactHttpsHost(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(l));
}

/** Whether `raw` is exactly `https://<host>` or `https://<host>:<port>` with a host `isExactHttpsHost` accepts and a port of
 *  1 to 5 digits. The shape of an origin as a CSP source: nothing here can end or widen a directive. */
export function isExactHttpsOrigin(raw: string): boolean {
  if (!raw.startsWith('https://')) return false;
  const rest = raw.slice('https://'.length);
  const colon = rest.indexOf(':');
  if (colon < 0) return isExactHttpsHost(rest);
  const port = rest.slice(colon + 1);
  return /^\d{1,5}$/.test(port) && Number(port) <= 65535 && isExactHttpsHost(rest.slice(0, colon));
}
