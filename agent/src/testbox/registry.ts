// D-7407, D-7429 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task TB5; spec §2.3 "Network"). L3: the test
// service's own caching, read-only npm registry, the one thing on the box with egress to the upstream registry. It
// listens on `CCRC_TESTBOX_REGISTRY_PROXY` (a loopback address of its own, reachable from the prepare and install
// units only) and answers GET and HEAD for packuments and tarballs; any other method is 405 and any other path 404.
//
// - A packument is fetched from `CCRC_TESTBOX_REGISTRY_UPSTREAM` on every request (a new version must be seen), its
//   tarball URLs rewritten to the proxy, and kept under `<CCRC_TESTBOX_ROOT>/registry/packuments/`; the kept copy
//   answers only when the upstream cannot.
// - A tarball is immutable: a cached one answers with no upstream call. A fetched one is cached only when its bytes
//   match its packument's `dist.integrity` (or, for a version that has none, `dist.shasum`); a mismatch, or a version
//   the packument does not list, is not cached and answers 502.
// It never accepts a write: there is no publish, no login and no dist-tag route.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';

/** The two settings this proxy reads (`config.ts`'s `lines`). */
export const REGISTRY_KNOBS = ['CCRC_TESTBOX_REGISTRY_PROXY', 'CCRC_TESTBOX_REGISTRY_UPSTREAM'] as const;

export interface RegistryOpts {
  readonly host: string;
  readonly port: number;
  /** The upstream registry's base URL, `https://registry.npmjs.org` by the box's default. */
  readonly upstream: string;
  /** `<CCRC_TESTBOX_ROOT>/registry`. */
  readonly cacheDir: string;
  /** The longest one upstream request may take. */
  readonly timeoutMs: number;
  /** The upstream fetch; tests pass one that counts its calls. */
  readonly fetch?: typeof fetch;
}

export interface RunningRegistry { readonly port: number; close(): Promise<void> }

/** The proxy's settings from the printer's lines. A missing key refuses with its name. */
export function registrySettings(
  lines: ReadonlyMap<string, { readonly value: string }>, hostPort: (key: string, value: string) => { host: string; port: number },
): { readonly host: string; readonly port: number; readonly upstream: string } {
  const v = (k: (typeof REGISTRY_KNOBS)[number]): string => {
    const l = lines.get(k);
    if (l === undefined) throw new Error(`the settings printer gave no ${k}`);
    return l.value;
  };
  const upstream = v('CCRC_TESTBOX_REGISTRY_UPSTREAM').replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(upstream)) throw new Error(`CCRC_TESTBOX_REGISTRY_UPSTREAM=${JSON.stringify(upstream)}: not an http(s) URL`);
  return { ...hostPort('CCRC_TESTBOX_REGISTRY_PROXY', v('CCRC_TESTBOX_REGISTRY_PROXY')), upstream };
}

/** A package name as npm spells it: `name` or `@scope/name`, lower case. */
const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const TARBALL_FILE = /^[a-z0-9][a-z0-9._~-]*\.tgz$/;

export type RegistryPath =
  | { readonly kind: 'packument'; readonly name: string }
  | { readonly kind: 'tarball'; readonly name: string; readonly file: string };

/** A request path to what it names, or `null`: `/<name>`, `/@scope%2fname` or `/@scope/name` for a packument,
 *  `/<name>/-/<file>.tgz` for a tarball. */
export function parseRegistryPath(url: string): RegistryPath | null {
  const raw = url.split('?')[0] ?? '';
  let p: string;
  try { p = decodeURIComponent(raw); } catch { return null; }
  if (!p.startsWith('/') || p.includes('\0')) return null;
  const segs = p.slice(1).split('/');
  const scoped = segs[0]?.startsWith('@') === true;
  const nameSegs = scoped ? 2 : 1;
  const name = segs.slice(0, nameSegs).join('/');
  if (!NAME.test(name)) return null;
  const rest = segs.slice(nameSegs);
  if (rest.length === 0) return { kind: 'packument', name };
  if (rest.length === 2 && rest[0] === '-' && TARBALL_FILE.test(rest[1]!)) return { kind: 'tarball', name, file: rest[1]! };
  return null;
}

/** Whether `bytes` match an SRI string (`sha512-<base64>`, several allowed, any one matching) or a sha1 hex. */
export function integrityMatches(bytes: Uint8Array, integrity: string | null, shasum: string | null): boolean {
  if (integrity !== null) {
    for (const part of integrity.trim().split(/\s+/)) {
      const m = /^(sha512|sha384|sha256|sha1)-([A-Za-z0-9+/=]+)$/.exec(part);
      if (m !== null && createHash(m[1]!).update(bytes).digest('base64') === m[2]) return true;
    }
    return false;
  }
  if (shasum !== null) return /^[0-9a-f]{40}$/.test(shasum) && createHash('sha1').update(bytes).digest('hex') === shasum;
  return false;
}

interface Dist { readonly integrity: string | null; readonly shasum: string | null }

/** The `dist` of the packument's version whose tarball is `file`, or `null`. */
export function distFor(packument: unknown, file: string): Dist | null {
  if (typeof packument !== 'object' || packument === null) return null;
  const versions = (packument as { versions?: unknown }).versions;
  if (typeof versions !== 'object' || versions === null) return null;
  for (const v of Object.values(versions as Record<string, unknown>)) {
    const dist = (v as { dist?: { tarball?: unknown; integrity?: unknown; shasum?: unknown } } | null)?.dist;
    if (typeof dist?.tarball !== 'string' || !dist.tarball.endsWith(`/-/${file}`)) continue;
    return { integrity: typeof dist.integrity === 'string' ? dist.integrity : null, shasum: typeof dist.shasum === 'string' ? dist.shasum : null };
  }
  return null;
}

const safeName = (name: string): string => encodeURIComponent(name);

/** Written whole: a temporary file renamed over the target. */
function keep(file: string, bytes: Uint8Array): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, bytes, { mode: 0o644 });
  renameSync(tmp, file);
}

export class Registry {
  private readonly fetch: typeof fetch;
  constructor(private readonly o: RegistryOpts) { this.fetch = o.fetch ?? globalThis.fetch; }

  private packumentFile(name: string): string { return path.join(this.o.cacheDir, 'packuments', `${safeName(name)}.json`); }
  private tarballFile(name: string, file: string): string { return path.join(this.o.cacheDir, 'tarballs', safeName(name), file); }

  private async upstream(p: string): Promise<{ status: number; bytes: Uint8Array }> {
    const r = await this.fetch(`${this.o.upstream}/${p}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(this.o.timeoutMs), redirect: 'error' });
    return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
  }

  /** The packument as the upstream has it now (kept), else the kept copy, else `null` with the upstream's status. */
  async packument(name: string, origin: string): Promise<{ status: number; body: Uint8Array | null; json: unknown }> {
    const file = this.packumentFile(name);
    let up: { status: number; bytes: Uint8Array } | null = null;
    try { up = await this.upstream(name.replace('/', '%2f')); } catch { up = null; }
    if (up !== null && up.status === 200) {
      let json: unknown;
      try { json = JSON.parse(Buffer.from(up.bytes).toString('utf8')); } catch { return { status: 502, body: null, json: null }; }
      keep(file, up.bytes);
      return { status: 200, body: this.rewrite(json, origin), json };
    }
    if (up !== null && up.status === 404) return { status: 404, body: null, json: null };
    if (!existsSync(file)) return { status: 502, body: null, json: null };
    const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return { status: 200, body: this.rewrite(json, origin), json };
  }

  /** Tarball URLs pointed at the proxy, so an install never reaches past it. */
  private rewrite(json: unknown, origin: string): Uint8Array {
    const text = JSON.stringify(json);
    return Buffer.from(text.split(`${this.o.upstream}/`).join(`${origin}/`), 'utf8');
  }

  /** The tarball: from the cache, or fetched and checked against its packument before it is kept. */
  async tarball(name: string, file: string, origin: string): Promise<{ status: number; body: Uint8Array | null }> {
    const cached = this.tarballFile(name, file);
    if (existsSync(cached)) return { status: 200, body: readFileSync(cached) };
    const pk = await this.packument(name, origin);
    if (pk.status !== 200) return { status: pk.status === 404 ? 404 : 502, body: null };
    const dist = distFor(pk.json, file);
    if (dist === null) return { status: 502, body: null };
    let up: { status: number; bytes: Uint8Array };
    try { up = await this.upstream(`${name}/-/${file}`); } catch { return { status: 502, body: null }; }
    if (up.status === 404) return { status: 404, body: null };
    if (up.status !== 200 || !integrityMatches(up.bytes, dist.integrity, dist.shasum)) return { status: 502, body: null };
    keep(cached, up.bytes);
    return { status: 200, body: up.bytes };
  }

  async handle(req: IncomingMessage, res: ServerResponse, origin: string): Promise<void> {
    const method = req.method ?? '';
    if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    const p = parseRegistryPath(req.url ?? '');
    if (p === null) { res.writeHead(404).end(); return; }
    const r = p.kind === 'packument' ? await this.packument(p.name, origin) : await this.tarball(p.name, p.file, origin);
    if (r.status !== 200 || r.body === null) { res.writeHead(r.status).end(); return; }
    res.writeHead(200, {
      'content-type': p.kind === 'packument' ? 'application/json' : 'application/octet-stream', 'content-length': String(r.body.length),
    });
    res.end(method === 'HEAD' ? undefined : r.body);
  }
}

/** The proxy's HTTP server on its own address. */
export async function startRegistry(o: RegistryOpts): Promise<RunningRegistry> {
  const reg = new Registry(o);
  const server: Server = createServer();
  let origin = '';
  server.on('request', (req, res) => {
    reg.handle(req, res, origin).catch(() => { if (!res.headersSent) res.writeHead(502); res.end(); });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, o.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : o.port;
  origin = `http://${o.host.includes(':') ? `[${o.host}]` : o.host}:${port}`;
  return { port, close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))) };
}
