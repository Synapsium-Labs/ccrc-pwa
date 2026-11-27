// `ccrc expose artifacts`, step 1: the bash mirror of the artifact tier's site rule and config decision. `ccd/ccrc`'s
// `_art_site_problem` and `_art_config` must refuse exactly what `server/src/artifacts/policy.ts` refuses and accept exactly
// what it accepts, so the `expose artifacts` arm and doctor's check (the next steps) never write or bless a set the server
// would turn off at boot. This file proves it from the ONE table both read, `fixtures/artifact-site-rule.json`: that the
// accept list in the bash is the table's, and that every site and config case in the table answers the same in bash.
// `artifacts-config.test.ts` runs the same table against the TypeScript.
//
// ── HOW THE FIXTURE CONTAINS IT (ccrc-expose.test.ts's harness) ───────────
//  1. HOME is a throwaway `mkTmp` directory, and bash runs with it as cwd. The mirror reads and writes no file and names
//     no external binary; the one process only sources `ccd/ccrc` and loops over an input file kept in that HOME.
//  2. `ghContainedEnv` (with `net`) plants the poisoned `gh`, `ssh`, `scp` and `curl` and the fixture user bus, and `curl`
//     and `systemctl` are poisoned beside it in the same form `ccrc-expose.test.ts` writes them, so a stray call from
//     the sourced file could neither reach a server nor the box's systemd. The teardown fails the test if one was met.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { ledgerHitLine, takeExpectedPoison } from './containedTools.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '..', '..');
const CCRC_SRC = path.resolve(REPO, 'ccd', 'ccrc');

/** bash's absolute path, resolved once under this process's real PATH. */
const BASH = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();

const genLabel = (): string => 't' + randomBytes(6).toString('hex');

/** Whether en_US.UTF-8 is installed: `locale -a` spells it en_US.utf8 on glibc and en_US.UTF-8 on macOS. */
const HAS_EN_US = (spawnSync('locale', ['-a'], { encoding: 'utf8' }).stdout ?? '').split('\n')
  .some((l: string): boolean => l.trim().toLowerCase().replace('-', '') === 'en_us.utf8');

interface SiteCheck { console: string; host: string; accepted: boolean; detailHas?: string[]; detailLacks?: string[] }
interface SiteCase { case: string; checks: SiteCheck[] }
interface ConfigEnv { origin?: string; content?: string; port?: string; exposeMode?: string }
interface ConfigCheck {
  console: string; consolePort: number; env: ConfigEnv; state: 'on' | 'off';
  why?: string; detailHas?: string[]; detailLacks?: string[]; hosts?: { artifact: string; content: string };
}
interface ConfigCase { describe?: string; case: string; checks: ConfigCheck[] }
interface Table { about: string; acceptList: string[]; siteCases: SiteCase[]; configCases: ConfigCase[] }

const table = JSON.parse(readFileSync(join(here, 'fixtures', 'artifact-site-rule.json'), 'utf8')) as Table;

/** One check with its placeholders filled: `{a}` to `{d}` are labels drawn fresh for this check (one label per token within
 *  it), `{A}` is `{a}` in upper case. The JSON text is substituted whole, then parsed back. */
function fresh<T>(check: T): T {
  const labels: Record<string, string> = { a: genLabel(), b: genLabel(), c: genLabel(), d: genLabel() };
  const text = JSON.stringify(check).replace(/\{([a-dA-D])\}/g,
    (_m: string, k: string): string => (k === k.toLowerCase() ? labels[k]! : labels[k.toLowerCase()]!.toUpperCase()));
  return JSON.parse(text) as T;
}

/** The env of the fixture box: contained like `ccrc-expose.test.ts`'s own, with its `curl` and `systemctl` poisons. */
function fixtureEnv(home: string): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home }, { net: true });
  for (const [name, says] of [
    ['curl', 'ccrc tests must never reach a real server'],
    ['systemctl', 'ccrc tests must never touch this box\'s real systemd'],
  ] as const) {
    writeFileSync(join(home, '.local', 'bin', name),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n${ledgerHitLine(`${name}-poison`)}\n`
      + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  }
  return e;
}

/** Every line of the driver is one check; fields are cut by parameter expansion because a tab is IFS whitespace, which
 *  `read` would collapse, losing an empty field. */
const DRIVER = [
  'source "$1"',
  'while IFS= read -r line; do',
  '  f=(); rest="$line$TAB"',
  '  while [[ -n $rest ]]; do f+=("${rest%%"$TAB"*}"); rest=${rest#*"$TAB"}; done',
  '  if [[ ${f[0]} == site ]]; then',
  '    if p=$(_art_site_problem "${f[1]}" "${f[2]}"); then echo accepted; else printf "refused\\t%s\\n" "$p"; fi',
  '  else',
  '    ART_STATE="" ART_DETAIL="" ART_HOST="" ART_CONTENT_HOST=""',
  '    _art_config "${f[1]}" "${f[2]}" "${f[3]}" "${f[4]}" "${f[5]}" "${f[6]}"',
  '    printf "%s\\t%s\\t%s\\t%s\\n" "$ART_STATE" "$ART_DETAIL" "$ART_HOST" "$ART_CONTENT_HOST"',
  '  fi',
  'done < "$2"',
].join('\n');

type Planned =
  | { kind: 'site'; check: SiteCheck }
  | { kind: 'config'; check: ConfigCheck };

describe('ccrc expose artifacts: the bash site rule mirrors the server\'s', () => {
  it('site rule: the bash accept list is the table\'s', () => {
    const lines = readFileSync(CCRC_SRC, 'utf8').split('\n')
      .map((l: string): RegExpExecArray | null => /^_ART_PUBLIC_SUFFIXES='([^']*)'$/.exec(l))
      .filter((m: RegExpExecArray | null): m is RegExpExecArray => m !== null);
    expect(lines).toHaveLength(1);
    expect(lines[0]![1]!.split(' ')).toEqual(table.acceptList);
  });

  /** Every check of the table through the bash mirror, in one process under the given LC_ALL. */
  const tableAnswersSameInBash = (lcAll: string): void => {
    const planned: Planned[] = [
      ...table.siteCases.flatMap((sc: SiteCase): Planned[] =>
        sc.checks.map((c: SiteCheck): Planned => ({ kind: 'site', check: fresh(c) }))),
      ...table.configCases.flatMap((cc: ConfigCase): Planned[] =>
        cc.checks.map((c: ConfigCheck): Planned => ({ kind: 'config', check: fresh(c) }))),
    ];
    const input = planned.map((p: Planned): string => (p.kind === 'site'
      ? ['site', p.check.console, p.check.host]
      : ['config', p.check.console, String(p.check.consolePort), p.check.env.origin ?? '', p.check.env.content ?? '',
        p.check.env.port ?? '', p.check.env.exposeMode ?? '']).join('\t')).join('\n') + '\n';

    const home = mkTmp('artbash-');
    const inputPath = join(home, 'artifact-checks.tsv');
    writeFileSync(inputPath, input);
    const r = spawnSync(BASH, ['-c', DRIVER, '_', CCRC_SRC, inputPath], {
      env: { ...fixtureEnv(home), TAB: '\t', LC_ALL: lcAll }, cwd: home, encoding: 'utf8',
    });
    expect(r.stderr, 'bash stderr').toBe('');
    expect(r.status, 'bash exit code').toBe(0);

    const out = r.stdout.split('\n');
    out.pop(); // the newline after the last line
    expect(out, 'one result line per check').toHaveLength(planned.length);

    planned.forEach((p: Planned, i: number): void => {
      const msg = JSON.stringify(p.check);
      const cols = out[i]!.split('\t');
      if (p.kind === 'site') {
        const c = p.check;
        expect(cols[0] === 'accepted', msg).toBe(c.accepted);
        const problem = cols[1] ?? '';
        for (const w of c.detailHas ?? []) expect(problem, msg).toContain(w);
        for (const w of c.detailLacks ?? []) expect(problem, msg).not.toContain(w);
        return;
      }
      const c = p.check;
      const [state, detail, host, contentHost] = [cols[0] ?? '', cols[1] ?? '', cols[2] ?? '', cols[3] ?? ''];
      expect(state === 'on' ? 'on' : 'off', msg).toBe(c.state);
      if (c.state === 'on') {
        if (c.hosts) {
          expect(host, msg).toBe(c.hosts.artifact);
          expect(contentHost, msg).toBe(c.hosts.content);
        }
        return;
      }
      expect(state, msg).toBe(c.why);
      for (const w of c.detailHas ?? []) expect(detail, msg).toContain(w);
      for (const w of c.detailLacks ?? []) expect(detail, msg).not.toContain(w);
    });
  };

  it('site rule: every table case answers the same in bash', () => tableAnswersSameInBash('C'));

  // A UTF-8 LC_ALL, as an ssh session may forward one: under it a bracket range like [a-z] can match letters outside
  // ASCII, so the mirror pins its own collation. Where the locale is not installed, bash falls back to C and also warns
  // on stderr (`setlocale: LC_ALL: cannot change locale`) at start and each time a function's `local LC_ALL=C` unwinds,
  // so the case would test nothing and fail on the warning: it is skipped there, by a probe of `locale -a` (review 4022 F6).
  it.skipIf(!HAS_EN_US)('site rule: every table case answers the same in bash under en_US.UTF-8 (skipped where that locale is not installed)',
    () => tableAnswersSameInBash('en_US.UTF-8'));
});

// ── the arm itself: `ccrc expose artifacts` ───────────────────────────────
// The harness is `ccrc-expose.test.ts`'s in the same form (that file stays unedited): a fixture HOME, `ccrc` through a
// symlink in a deployed-box tree, a pty for the prompts, and `curl` poisoned. Every artifacts-arm run below is under a
// RECORDER for `systemctl` and `launchctl` (argv and the run's own `XDG_RUNTIME_DIR`, one line per call), never the
// poison. A console-arm run used only to seed a box may run under the poison, with the existing file's allowance.

const TOKEN = 'fixture-duckdns-token-9c2e41';   // a FIXTURE value, never a real credential
const IP_ADDR = '198.51.100.7';                 // TEST-NET-2
const BIND = '203.0.113.9';                     // TEST-NET-3
const FORCE_LINUX = { OSTYPE: 'linux-gnu' };
const FORCE_DARWIN = { OSTYPE: 'darwin23' };
const HEADER = "# ccrc exposure config — regenerated by 'ccrc expose'; delete it to go dark.";

const ccrcIn = (home: string): string => join(home, 'ccrc', 'ccd', 'ccrc');
const exposurePath = (home: string): string => join(home, '.ccrc', 'exposure.env');
const caddyfilePath = (home: string): string => join(home, '.ccrc', 'Caddyfile');
const bytesAt = (p: string): string | null => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const ccrcDirEntries = (home: string): string[] =>
  (existsSync(join(home, '.ccrc')) ? readdirSync(join(home, '.ccrc')).sort() : []);

/** The three console-only exposure files, in the exact bytes `_exp_env_write` writes. */
const duckdnsEnv = (sub: string, bind = ''): string => [
  HEADER, `CCRC_ORIGIN=https://${sub}.duckdns.org`, `CCRC_RP_ID=${sub}.duckdns.org`, 'CCRC_AUTH=on',
  ...(bind ? [`CCRC_CADDY_BIND=${bind}`] : []),
  'CCRC_DDNS_PROVIDER=duckdns', `CCRC_DDNS_DOMAIN=${sub}.duckdns.org`, `CCRC_DDNS_TOKEN=${TOKEN}`,
].join('\n') + '\n';
const byoEnv = (origin: string, rpid: string): string =>
  [HEADER, `CCRC_ORIGIN=${origin}`, `CCRC_RP_ID=${rpid}`, 'CCRC_AUTH=on'].join('\n') + '\n';
const ipEnv = (addr: string): string =>
  [HEADER, `CCRC_ORIGIN=https://${addr}`, 'CCRC_AUTH=on', 'CCRC_EXPOSE_MODE=ip', `CCRC_EXPOSE_ADDR=${addr}`].join('\n') + '\n';
/** The artifact tier's three keys, as the file's last three lines. */
const artKeys = (a: string, c: string, port = 7790): string =>
  [`CCRC_ARTIFACT_ORIGIN=${a}`, `CCRC_ARTIFACT_CONTENT_ORIGIN=${c}`, `CCRC_ARTIFACT_PORT=${port}`].join('\n') + '\n';
/** The duckdns file with its artifact names: the updater's list gains both labels, console first. */
const duckdnsArtEnv = (sub: string, a: string, c: string, bind = ''): string =>
  duckdnsEnv(sub, bind).replace(`CCRC_DDNS_DOMAIN=${sub}.duckdns.org`,
    `CCRC_DDNS_DOMAIN=${sub}.duckdns.org,${a}.duckdns.org,${c}.duckdns.org`)
  + artKeys(`https://${a}.duckdns.org`, `https://${c}.duckdns.org`);

/** The console's block, exactly as the console-only Caddyfile is. */
const caddyfile = (host: string, bind = ''): string =>
  `${host} {\n${bind ? `    bind ${bind}\n` : ''}    reverse_proxy 127.0.0.1:7788\n}\n`;
const ipCaddyfile = (addr: string): string => `https://${addr} {\n    tls internal\n    reverse_proxy 127.0.0.1:7788\n}\n`;
/** The global options block: the log filter, in tabs. */
const LOG_BLOCK = [
  '{', '\tlog default {', '\t\toutput stderr', '\t\tformat filter {', '\t\t\twrap json', '\t\t\tfields {',
  '\t\t\t\trequest>uri delete', '\t\t\t\trequest>headers delete', '\t\t\t}', '\t\t}', '\t\tlevel INFO', '\t}', '}',
].join('\n') + '\n\n';
const artBlock = (aHost: string, cHost: string, bind = '', port = 7790): string =>
  `\n${aHost}, ${cHost} {\n${bind ? `    bind ${bind}\n` : ''}    reverse_proxy 127.0.0.1:${port}\n}\n`;
const artCaddyfile = (host: string, aHost: string, cHost: string, bind = ''): string =>
  LOG_BLOCK + caddyfile(host, bind) + artBlock(aHost, cHost, bind);

/** A box with the tree `ccrc expose` needs (`deploy/systemd` linked, for the console arm's updater units). */
function box(prefix: string): string {
  const home = mkTmp(prefix);
  mkdirSync(join(home, 'ccrc', 'ccd'), { recursive: true });
  symlinkSync(CCRC_SRC, join(home, 'ccrc', 'ccd', 'ccrc'));
  mkdirSync(join(home, 'ccrc', 'deploy'), { recursive: true });
  symlinkSync(join(REPO, 'deploy', 'systemd'), join(home, 'ccrc', 'deploy', 'systemd'));
  return home;
}

interface RunOpts { rec?: 'ok' | 'fail'; extra?: Record<string, string> }
interface Result { code: number; stdout: string; stderr: string }

/** The run's env: contained, with `systemctl` and `launchctl` as recorders (`rec`) or `systemctl` as the poison. The run's
 *  own `XDG_RUNTIME_DIR` and bus address are removed, so a call that logs one set it itself. */
function env(home: string, opts: RunOpts): NodeJS.ProcessEnv {
  const e = ghContainedEnv(home, { ...process.env, HOME: home }, { net: true });
  const poison = (name: string, says: string): void => writeFileSync(join(home, '.local', 'bin', name),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/${name}-poison"\n${ledgerHitLine(`${name}-poison`)}\n`
    + `echo "${says}" >&2\nexit 97\n`, { mode: 0o755 });
  poison('curl', 'ccrc tests must never reach a real server');
  if (opts.rec) {
    for (const name of ['systemctl', 'launchctl']) {
      writeFileSync(join(home, '.local', 'bin', name),
        `#!/bin/sh\nprintf '%s XDG=%s\\n' "$*" "\${XDG_RUNTIME_DIR-unset}" >> "$HOME/${name}-calls"\n`
        + `exit ${opts.rec === 'ok' ? 0 : 1}\n`, { mode: 0o755 });
    }
  } else {
    poison('systemctl', 'ccrc tests must never touch this box\'s real systemd');
  }
  for (const k of ['CCRC_ADDR', 'CCRC_HEALTH_TIMEOUT', 'CCRC_DOCTOR_GH_TIMEOUT', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) delete e[k];
  return { ...e, ...(opts.extra ?? {}) };
}

/** What a recorder saw: one line per call, or none. */
const calls = (home: string, name: 'systemctl' | 'launchctl'): string[] => {
  const p = join(home, `${name}-calls`);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};

/** The poison runs meet `daemon-reload` and `enable --now` by design (no session bus): both runners take them. */
const DEGRADED_SYSTEMCTL = /^--user (?:daemon-reload|enable --now [A-Za-z0-9@._-]+|is-active [A-Za-z0-9@._-]+)$/;

function runPiped(home: string, args: string[], opts: RunOpts = { rec: 'ok', extra: FORCE_LINUX }): Result {
  const r = spawnSync(BASH, [ccrcIn(home), ...args], { env: env(home, opts), encoding: 'utf8', input: '' });
  takeExpectedPoison(home, 'systemctl', DEGRADED_SYSTEMCTL);
  return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const PROMPTS = new RegExp('(DuckDNS subdomain|DuckDNS token|Public origin|Passkey rp id|Address for caddy to bind'
  + '|Artifact host DuckDNS label|Content host DuckDNS label)', 'g');

/** `ccrc expose <args>` on a real terminal, typing `entries` at the prompts, one per prompt seen. */
function runTty(home: string, args: string[], entries: string[], opts: RunOpts = { rec: 'ok', extra: FORCE_LINUX }): Promise<Result> {
  return runOnTty(home, ['expose', ...args], entries, opts);
}

/** `ccrc <argv>` on a real terminal. CLAUDECODE, TMUX and TMUX_PANE are removed, as `ccrc-auth.test.ts` removes them, so
 *  the operator-only verb `ccrc auth` gets past its speed bumps when this suite itself runs inside a session. */
function runOnTty(home: string, argv: string[], entries: string[], opts: RunOpts): Promise<Result> {
  const e = env(home, opts);
  for (const k of ['CLAUDECODE', 'TMUX', 'TMUX_PANE']) delete e[k];
  return new Promise((resolve) => {
    const p = pty.spawn(BASH, [ccrcIn(home), ...argv], {
      name: 'xterm-color', cols: 200, rows: 40, cwd: home, env: e as Record<string, string>,
    });
    let out = '';
    let sent = 0;
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      takeExpectedPoison(home, 'systemctl', DEGRADED_SYSTEMCTL);
      resolve({ code, stdout: out.replace(/\r/g, ''), stderr: '' });   // a pty merges the two streams
    };
    const timer = setTimeout(() => { p.kill(); finish(-1); }, 20_000);
    p.onData((d) => {
      out += d;
      const seen = (out.match(PROMPTS) ?? []).length;
      while (sent < seen && sent < entries.length) p.write(`${entries[sent++]}\r`);
    });
    p.onExit(({ exitCode }) => finish(exitCode));
  });
}

/** Planted `ss` answering no listener, so the console arm's :443 sentence is the fixture's. */
function quietSs(home: string): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'ss'),
    '#!/bin/sh\necho "State Recv-Q Send-Q Local Address:Port Peer Address:Port"\nexit 0\n', { mode: 0o755 });
}

/** `hostname -I` answering the given line. */
function stubHostname(home: string, line: string): void {
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  writeFileSync(join(home, '.local', 'bin', 'hostname'),
    `#!/bin/sh\nif [ "$1" = "-I" ]; then printf '%s\\n' "${line}"; exit 0; fi\nexit 1\n`, { mode: 0o755 });
}

/** The console arms, run for real on the pty under the poison, to seed a box. */
const POISON: RunOpts = { extra: FORCE_LINUX };
async function seedDuckdns(home: string, sub: string, bind = ''): Promise<void> {
  quietSs(home);
  const r = await runTty(home, ['duckdns'], [sub, TOKEN, bind], POISON);
  expect(r.code, r.stdout).toBe(0);
  expect(bytesAt(exposurePath(home))).toBe(duckdnsEnv(sub, bind));
}
async function seedByo(home: string, origin: string, rpid: string): Promise<void> {
  quietSs(home);
  const r = await runTty(home, ['byo'], [origin, rpid, ''], POISON);
  expect(r.code, r.stdout).toBe(0);
  expect(bytesAt(exposurePath(home))).toBe(byoEnv(origin, rpid));
}
async function seedIp(home: string): Promise<void> {
  quietSs(home);
  stubHostname(home, IP_ADDR);
  const r = await runTty(home, ['ip'], [''], POISON);
  expect(r.code, r.stdout).toBe(0);
  expect(bytesAt(exposurePath(home))).toBe(ipEnv(IP_ADDR));
}
/** A duckdns box written directly, in the bytes the arm writes: no console run, no service call. */
function seedFile(home: string, text: string): void {
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(exposurePath(home), text, { mode: 0o600 });
}

const lines = (t: string): string[] => t.replace(/\r/g, '').split('\n').filter((l: string): boolean => l !== '');
const uid = (): string => String(process.getuid?.() ?? spawnSync('id', ['-u'], { encoding: 'utf8' }).stdout.trim());
/** The run's text with the sandbox HOME and the uid replaced by placeholders. */
const normal = (home: string, text: string): string =>
  text.split(home).join('<HOME>').split(`gui/${uid()}`).join('gui/<uid>');

/** The artifacts arm's landing, in full: five lines, with the fixture's values. */
const landing = (aOrigin: string, cOrigin: string, restart: string): string[] => [
  'expose: artifacts: this run started NO system service (the commands below are printed, not run). Three steps are yours:',
  "expose:   1. sudo install -m 0644 <HOME>/.ccrc/Caddyfile /etc/caddy/Caddyfile   (a COPY, as for the console's block)",
  'expose:   2. sudo systemctl reload caddy   (Caddy then obtains the two new certificates)',
  `expose:   3. restart the server so it starts the artifact listener: ${restart}`,
  `expose: once all of the above are done, ${aOrigin} and ${cOrigin} serve artifacts; ccrc doctor measures each piece`,
];
const LINUX_RESTART = 'systemctl --user restart ccrc.service';
const DARWIN_RESTART = 'launchctl kickstart -k gui/<uid>/app.ccrc.ccrc';

describe('ccrc expose artifacts: the arm', () => {
  it('expose: the duckdns arm writes the keys and the block', async () => {
    const home = box('ccrc-art-duck-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    const consoleBlock = bytesAt(caddyfilePath(home));
    expect(consoleBlock).toBe(caddyfile(`${sub}.duckdns.org`));
    const r = await runTty(home, ['artifacts'], [a, c]);
    expect(r.code, r.stdout).toBe(0);
    expect(bytesAt(exposurePath(home))).toBe(duckdnsArtEnv(sub, a, c));
    expect(bytesAt(caddyfilePath(home))).toBe(artCaddyfile(`${sub}.duckdns.org`, `${a}.duckdns.org`, `${c}.duckdns.org`));
    expect(bytesAt(caddyfilePath(home))).toContain(consoleBlock!);
    expect(r.stdout).toContain(`artifacts at https://${a}.duckdns.org and https://${c}.duckdns.org`);
    expect(ccrcDirEntries(home)).toEqual(['Caddyfile', 'exposure.env']);
  });

  it('expose: the artifact block carries the bind', async () => {
    const home = box('ccrc-art-bind-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub, BIND);
    const r = await runTty(home, ['artifacts'], [a, c]);
    expect(r.code, r.stdout).toBe(0);
    expect(bytesAt(exposurePath(home))).toBe(duckdnsArtEnv(sub, a, c, BIND));
    const got = bytesAt(caddyfilePath(home))!;
    expect(got).toBe(artCaddyfile(`${sub}.duckdns.org`, `${a}.duckdns.org`, `${c}.duckdns.org`, BIND));
    expect(got.split(`    bind ${BIND}\n`)).toHaveLength(3);
  });

  it('expose: the log filter is written', async () => {
    const withArt = box('ccrc-art-log-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(withArt, sub);
    expect((await runTty(withArt, ['artifacts'], [a, c])).code).toBe(0);
    const got = bytesAt(caddyfilePath(withArt))!;
    expect(got.startsWith(LOG_BLOCK)).toBe(true);
    for (const w of ['\t\t\t\trequest>uri delete\n', '\t\t\t\trequest>headers delete\n', '\t\tlevel INFO\n']) expect(got).toContain(w);
    expect(got.slice(LOG_BLOCK.length), 'no site block holds a log directive').not.toContain('log');
    const plain = box('ccrc-art-nolog-');
    await seedDuckdns(plain, sub);
    const bare = bytesAt(caddyfilePath(plain))!;
    expect(bare).toBe(caddyfile(`${sub}.duckdns.org`));
    expect(bare.split('\n')[0]).not.toBe('{');
  });

  it('expose: a re-run carries the artifact keys', async () => {
    // duckdns: the same console label, the same bytes.
    const home = box('ccrc-art-rerun-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    expect((await runTty(home, ['artifacts'], [a, c])).code).toBe(0);
    const [envBefore, cfBefore] = [bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))];
    const again = await runTty(home, ['duckdns'], [sub, TOKEN, ''], POISON);
    expect(again.code, again.stdout).toBe(0);
    expect(again.stdout).not.toContain('turned off');
    expect(bytesAt(exposurePath(home))).toBe(envBefore);
    expect(bytesAt(caddyfilePath(home))).toBe(cfBefore);
    expect(envBefore).toBe(duckdnsArtEnv(sub, a, c));

    // byo: another console name on a .example.test domain keeps names on .example.invalid.
    const byo = box('ccrc-art-rerun-byo-');
    await seedByo(byo, 'https://ccrc.example.test', 'example.test');
    const ao = 'https://art.example.invalid';
    const co = 'https://content.example.invalid';
    const first = runPiped(byo, ['expose', 'artifacts', '--artifact-origin', ao, '--content-origin', co]);
    expect(first.code, first.stderr).toBe(0);
    const moved = await runTty(byo, ['byo'], ['https://box.example.test', 'example.test', ''], POISON);
    expect(moved.code, moved.stdout).toBe(0);
    expect(moved.stdout).not.toContain('turned off');
    expect(bytesAt(exposurePath(byo))).toBe(byoEnv('https://box.example.test', 'example.test') + artKeys(ao, co));
    expect(bytesAt(caddyfilePath(byo)))
      .toBe(artCaddyfile('box.example.test', 'art.example.invalid', 'content.example.invalid'));

    // byo: a console name on the artifact names' own domain is the same site, so the names are dropped, said once.
    const same = await runTty(byo, ['byo'], ['https://box.example.invalid', 'example.invalid', ''], POISON);
    expect(same.code, same.stdout).toBe(0);
    expect(same.stdout).toContain('artifacts turned off: CCRC_ARTIFACT_ORIGIN=');
    expect(same.stdout).toContain('shares the site example.invalid with the console');
    expect(bytesAt(exposurePath(byo))).toBe(byoEnv('https://box.example.invalid', 'example.invalid'));
    expect(bytesAt(caddyfilePath(byo))).toBe(caddyfile('box.example.invalid'));

    // ip, from a duckdns box with its names: no second site, so everything of the tier goes, said once: the three keys,
    // the two extra names on the updater's list (the address form writes no list at all), the second block and the
    // global log block. Both files equal the address form's console-only bytes.
    const ip = box('ccrc-art-rerun-ip-');
    const [ipSub, ipA, ipC] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(ip, ipSub);
    expect((await runTty(ip, ['artifacts'], [ipA, ipC])).code).toBe(0);
    expect(bytesAt(exposurePath(ip))).toBe(duckdnsArtEnv(ipSub, ipA, ipC));
    stubHostname(ip, IP_ADDR);
    const gone = await runTty(ip, ['ip'], [''], POISON);
    expect(gone.code, gone.stdout).toBe(0);
    expect(gone.stdout).toContain('artifacts turned off: an address has no second site');
    const ipEnvAfter = bytesAt(exposurePath(ip)) ?? '';
    expect(ipEnvAfter).toBe(ipEnv(IP_ADDR));
    for (const gonePart of ['CCRC_ARTIFACT_', 'CCRC_DDNS_DOMAIN', `${ipA}.duckdns.org`, `${ipC}.duckdns.org`]) {
      expect(ipEnvAfter, gonePart).not.toContain(gonePart);
    }
    const ipCf = bytesAt(caddyfilePath(ip)) ?? '';
    expect(ipCf).toBe(ipCaddyfile(IP_ADDR));
    expect(ipCf).not.toContain('log default');
    expect(ipCf).not.toContain(`${ipA}.duckdns.org`);
  });

  it('expose: labels equal to the console\'s or to each other refuse', async () => {
    const home = box('ccrc-art-labels-');
    const [sub, a] = [genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    const before = [bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))];
    const own = await runTty(home, ['artifacts'], [sub.toUpperCase(), a]);
    expect(own.code, own.stdout).toBe(1);
    expect(own.stdout).toContain('console\'s own name');
    const same = await runTty(home, ['artifacts'], [a, a.toUpperCase()]);
    expect(same.code, same.stdout).toBe(1);
    expect(same.stdout).toContain('the artifact host already');
    expect([bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))]).toEqual(before);
    expect(ccrcDirEntries(home)).toEqual(['Caddyfile', 'exposure.env']);
    expect(calls(home, 'systemctl')).toEqual([]);
  });

  it('expose: the byo arm applies the site rule', async () => {
    const home = box('ccrc-art-byo-');
    await seedByo(home, 'https://ccrc.example.test', 'example.test');
    const before = [bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))];
    const bad = runPiped(home, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.test',
      '--content-origin', 'https://content.example.invalid']);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('shares the site example.test');
    expect(bad.stderr).toContain('Nothing was written.');
    expect([bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))]).toEqual(before);
    const ok = runPiped(home, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid',
      '--content-origin', 'https://content.example.invalid']);
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('expose: artifacts: art.example.invalid and content.example.invalid must sit on a registrable '
      + 'domain of their own: page code can set cookies on its own registrable domain, which on a domain you share would '
      + 'reach your other services');
    expect(bytesAt(exposurePath(home)))
      .toBe(byoEnv('https://ccrc.example.test', 'example.test') + artKeys('https://art.example.invalid', 'https://content.example.invalid'));
  });

  it('expose: the ip arm refuses', async () => {
    const home = box('ccrc-art-ip-');
    await seedIp(home);
    const before = [bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))];
    const r = runPiped(home, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid',
      '--content-origin', 'https://content.example.invalid']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('this box is exposed by address, which has no second site; artifacts need names');
    expect([bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))]).toEqual(before);
    expect(bytesAt(caddyfilePath(home))).not.toContain('reverse_proxy 127.0.0.1:7790');
  });

  it('expose: the arm never stands alone', () => {
    // Beside a named console exposure that arms sign-in, or nowhere: every other box is refused with nothing written,
    // and `--off` there changes nothing and says there is nothing to turn off.
    const full = byoEnv('https://ccrc.example.test', 'example.test');
    const cases: [string, string | null, string][] = [
      ['no exposure file', null, 'this box has no exposure file yet'],
      ['an exposure file that records no console', `${HEADER}\n`, 'does not carry the console\'s sign-in'],
      ['no CCRC_AUTH', full.replace('CCRC_AUTH=on\n', ''), 'does not carry the console\'s sign-in'],
      ['CCRC_AUTH not on', full.replace('CCRC_AUTH=on\n', 'CCRC_AUTH=off\n'), 'does not carry the console\'s sign-in'],
      ['no CCRC_RP_ID', full.replace('CCRC_RP_ID=example.test\n', ''), 'does not carry the console\'s sign-in'],
      ['no CCRC_ORIGIN', full.replace('CCRC_ORIGIN=https://ccrc.example.test\n', ''), 'does not carry the console\'s sign-in'],
      ['an address', ipEnv(IP_ADDR), 'this box is exposed by address'],
    ];
    for (const [what, text, says] of cases) {
      const home = box('ccrc-art-alone-');
      if (text !== null) seedFile(home, text);
      const before = { dir: ccrcDirEntries(home), env: bytesAt(exposurePath(home)), cf: bytesAt(caddyfilePath(home)) };
      const r = runPiped(home, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid',
        '--content-origin', 'https://content.example.invalid']);
      expect(r.code, `${what}: ${r.stderr}`).toBe(1);
      expect(r.stderr, what).toContain(says);
      expect(r.stderr, what).toContain('run ccrc expose duckdns or ccrc expose byo first');
      expect(r.stderr, what).toContain('Nothing was written.');
      const off = runPiped(home, ['expose', 'artifacts', '--off']);
      expect(off.code, `${what} --off: ${off.stderr}`).toBe(0);
      expect(off.stdout, what).toContain(`expose: artifacts: nothing to turn off — `);
      expect(off.stdout, what).toContain(says);
      expect({ dir: ccrcDirEntries(home), env: bytesAt(exposurePath(home)), cf: bytesAt(caddyfilePath(home)) }, what).toEqual(before);
    }
  });

  it('expose: --off removes the keys, the labels and the block', async () => {
    const home = box('ccrc-art-off-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    expect((await runTty(home, ['artifacts'], [a, c])).code).toBe(0);
    const off = runPiped(home, ['expose', 'artifacts', '--off']);
    expect(off.code, off.stderr).toBe(0);
    expect(bytesAt(exposurePath(home))).toBe(duckdnsEnv(sub));
    expect(bytesAt(caddyfilePath(home))).toBe(caddyfile(`${sub}.duckdns.org`));
    expect(lines(normal(home, off.stdout)).slice(-4)).toEqual([
      'expose: artifacts turned off: this run started NO system service (the commands below are printed, not run). Three steps are yours:',
      "expose:   1. sudo install -m 0644 <HOME>/.ccrc/Caddyfile /etc/caddy/Caddyfile   (a COPY, as for the console's block)",
      'expose:   2. sudo systemctl reload caddy',
      `expose:   3. restart the server so it stops the artifact listener: ${LINUX_RESTART}`,
    ]);
    expect(calls(home, 'systemctl'), '--off starts nothing').toHaveLength(1);
    // a byo box goes back to its console-only bytes too
    const byo = box('ccrc-art-off-byo-');
    await seedByo(byo, 'https://ccrc.example.test', 'example.test');
    expect(runPiped(byo, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid',
      '--content-origin', 'https://content.example.invalid']).code).toBe(0);
    expect(runPiped(byo, ['expose', 'artifacts', '--off']).code).toBe(0);
    expect(bytesAt(exposurePath(byo))).toBe(byoEnv('https://ccrc.example.test', 'example.test'));
    expect(bytesAt(caddyfilePath(byo))).toBe(caddyfile('ccrc.example.test'));
  });

  it('expose: status prints both artifact origins', async () => {
    const home = box('ccrc-art-status-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    const plain = runPiped(home, ['expose', 'status']);
    expect(plain.stdout).toContain('expose: artifacts: not set (ccrc expose artifacts names them; a box exposed by address has none)');
    expect((await runTty(home, ['artifacts'], [a, c])).code).toBe(0);
    const set = runPiped(home, ['expose', 'status']);
    expect(set.code).toBe(0);
    expect(set.stdout).toContain(`expose: artifacts: https://${a}.duckdns.org and https://${c}.duckdns.org, served by the listener on 127.0.0.1:7790`);
  });

  it('expose: no run prints the DuckDNS token', async () => {
    const home = box('ccrc-art-token-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    const outs = [
      (await runTty(home, ['artifacts'], [a, c])).stdout,
      (await runTty(home, ['duckdns'], [sub, TOKEN, ''], POISON)).stdout,
      runPiped(home, ['expose', 'artifacts', '--off']).stdout,
      runPiped(home, ['expose', 'status']).stdout,
    ];
    expect(bytesAt(exposurePath(home))).toContain(TOKEN);
    for (const o of outs) expect(o).not.toContain(TOKEN);
  });

  it('expose: the artifacts arm\'s landing text', async () => {
    // duckdns, Linux: one start of the updater, printed before the steps, with the bus default set by the arm itself.
    const home = box('ccrc-art-landing-');
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    await seedDuckdns(home, sub);
    const r = await runTty(home, ['artifacts'], [a, c]);
    expect(r.code, r.stdout).toBe(0);
    const out = lines(normal(home, r.stdout));
    expect(out.slice(-5)).toEqual(landing(`https://${a}.duckdns.org`, `https://${c}.duckdns.org`, LINUX_RESTART));
    expect(r.stdout).not.toContain('enable --now');
    expect(r.stdout).not.toContain('RE-ENROL');
    const started = out.findIndex((l: string): boolean => l.startsWith('expose: started ccrc-ddns.service once'));
    const step1 = out.findIndex((l: string): boolean => l.includes('1. sudo install'));
    expect(started, r.stdout).toBeGreaterThan(-1);
    expect(started).toBeLessThan(step1);
    const seen = calls(home, 'systemctl');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^--user start ccrc-ddns\.service XDG=\/run\/user\/\d+$/);
    expect(calls(home, 'launchctl')).toEqual([]);

    // duckdns, forced Darwin: one kickstart of the job.
    const mac = box('ccrc-art-landing-mac-');
    seedFile(mac, duckdnsEnv(sub));
    const m = await runTty(mac, ['artifacts'], [a, c], { rec: 'ok', extra: FORCE_DARWIN });
    expect(m.code, m.stdout).toBe(0);
    expect(lines(normal(mac, m.stdout)).slice(-5))
      .toEqual(landing(`https://${a}.duckdns.org`, `https://${c}.duckdns.org`, DARWIN_RESTART));
    expect(calls(mac, 'launchctl').map((l: string): string => normal(mac, l.replace(/ XDG=.*$/, ''))))
      .toEqual(['kickstart gui/<uid>/app.ccrc.ccrc-ddns']);
    expect(calls(mac, 'systemctl')).toEqual([]);

    // byo: no updater, so neither manager is asked anything.
    const byo = box('ccrc-art-landing-byo-');
    seedFile(byo, byoEnv('https://ccrc.example.test', 'example.test'));
    const b = runPiped(byo, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid',
      '--content-origin', 'https://content.example.invalid']);
    expect(b.code, b.stderr).toBe(0);
    expect(lines(normal(byo, b.stdout)).slice(-5))
      .toEqual(landing('https://art.example.invalid', 'https://content.example.invalid', LINUX_RESTART));
    expect(calls(byo, 'systemctl')).toEqual([]);
    expect(calls(byo, 'launchctl')).toEqual([]);
  });

  it('expose: a refused DDNS start degrades', async () => {
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    const cases: Array<{ os: Record<string, string>; cmd: string; restart: string }> = [
      { os: FORCE_LINUX, cmd: 'systemctl --user start ccrc-ddns.service', restart: LINUX_RESTART },
      { os: FORCE_DARWIN, cmd: 'launchctl kickstart gui/<uid>/app.ccrc.ccrc-ddns', restart: DARWIN_RESTART },
    ];
    for (const k of cases) {
      const home = box('ccrc-art-degrade-');
      seedFile(home, duckdnsEnv(sub));
      const r = await runTty(home, ['artifacts'], [a, c], { rec: 'fail', extra: k.os });
      expect(r.code, r.stdout).toBe(0);
      const out = lines(normal(home, r.stdout));
      expect(out).toContain(`expose: DEGRADED — could not start the DuckDNS update now; its timer runs it within 5 minutes, or run: ${k.cmd}`);
      expect(out.slice(-5)).toEqual(landing(`https://${a}.duckdns.org`, `https://${c}.duckdns.org`, k.restart));
      expect(bytesAt(exposurePath(home))).toBe(duckdnsArtEnv(sub, a, c));
    }
  });

  it('expose: a ccrc.env artifact key is a shadow', () => {
    for (const args of [['artifacts', '--off'], ['byo']]) {
      const home = box('ccrc-art-shadow-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), 'CCRC_ARTIFACT_PORT=7790\n');
      const r = runPiped(home, ['expose', ...args]);
      expect(r.code).toBe(1);
      expect(r.stderr).toMatch(/refusing to write .*already sets CCRC_ARTIFACT_PORT/);
      expect(r.stderr).toContain('Nothing was written.');
      expect(ccrcDirEntries(home)).toEqual(['ccrc.env']);
    }
  });

  it('expose: the ccrc auth off hint is not said beside an artifact key', () => {
    // The lines `ccrc auth on` writes, its marker line first; `ccrc auth off` removes those and never an artifact key.
    const authLines = '# ccrc auth on: sign-in at http://localhost:7788 (\'ccrc auth off\' removes these lines)\n'
      + 'CCRC_AUTH=on\nCCRC_RP_ID=localhost\nCCRC_ORIGIN=http://localhost:7788\nCCRC_COOKIE_INSECURE=on\n';
    const hint = 'These are the lines ccrc auth on writes: run ccrc auth off first';
    for (const [extra, said] of [['', true], ['CCRC_ARTIFACT_PORT=7790\n', false]] as const) {
      const home = box('ccrc-art-hint-');
      mkdirSync(join(home, '.ccrc'), { recursive: true });
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), authLines + extra);
      const r = runPiped(home, ['expose', 'byo']);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/refusing to write .*already sets CCRC_ORIGIN CCRC_RP_ID CCRC_AUTH/);
      expect(r.stderr.includes(hint), r.stderr).toBe(said);
      expect(ccrcDirEntries(home)).toEqual(['ccrc.env']);
    }
  });

  it('expose: ccrc auth answers the same beside the artifact tier', async () => {
    // The sign-in verb (#3405) refuses on a box reached from elsewhere, through the one reach reader, and on a Mac before
    // it reads the box. Adding the artifact tier to a console exposure must change neither answer and write nothing:
    // the tier adds no file the reader reads (the exposure file and the Caddyfile already stand), and never the server
    // unit or job file. The verb runs on a pty with `systemctl` and `launchctl` recording, as an operator would run it.
    const [sub, a, c] = [genLabel(), genLabel(), genLabel()];
    for (const os of [FORCE_LINUX, FORCE_DARWIN]) {
      const home = box('ccrc-art-auth-');
      if (os === FORCE_LINUX) await seedDuckdns(home, sub); else seedFile(home, duckdnsEnv(sub));
      const unitDir = join(home, os === FORCE_DARWIN ? 'Library/LaunchAgents' : '.config/systemd/user');
      mkdirSync(unitDir, { recursive: true });
      writeFileSync(join(unitDir, os === FORCE_DARWIN ? 'app.ccrc.ccrc.plist' : 'ccrc.service'),
        readFileSync(join(REPO, 'deploy', 'ccrc.service')));
      const ask = async (): Promise<string[]> => {
        const out: string[] = [];
        for (const sub2 of ['off', 'on']) {
          const files = (): Array<string | null> =>
            [bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home)), bytesAt(join(home, '.ccrc', 'ccrc.env'))];
          const before = files();
          const r = await runOnTty(home, ['auth', sub2], [], { rec: 'ok', extra: os });
          expect(r.code, r.stdout).toBe(1);
          expect(files()).toEqual(before);
          out.push(normal(home, r.stdout));
        }
        expect(calls(home, 'systemctl'), 'the verb restarts nothing').toEqual([]);
        expect(calls(home, 'launchctl')).toEqual([]);
        return out;
      };
      const without = await ask();
      expect(without[0], 'the reach refusal, or the Mac one').toMatch(os === FORCE_DARWIN
        ? /auth off: this verb does not act on a Mac yet/ : /auth off: this box is reached from elsewhere \(.*<HOME>\/\.ccrc\/exposure\.env exists/);
      expect(without[1]).toMatch(os === FORCE_DARWIN ? /auth on: this verb does not act on a Mac yet/ : /auth on: this box is reached from elsewhere/);
      expect((await runTty(home, ['artifacts'], [a, c], { rec: 'ok', extra: os })).code).toBe(0);
      // The tier is set (the other cases pin the file's bytes); what it must not change is the verb's answer, below.
      expect(bytesAt(exposurePath(home))).toContain(artKeys(`https://${a}.duckdns.org`, `https://${c}.duckdns.org`));
      for (const name of ['systemctl', 'launchctl']) {
        const p = join(home, `${name}-calls`);
        if (existsSync(p)) writeFileSync(p, '');   // the arm's own DuckDNS start; the verb's calls are counted afresh
      }
      expect(await ask()).toEqual(without);
    }
  });

  it('expose: a CCRC_PORT that is not plain digits refuses', () => {
    // config.ts reads CCRC_PORT with Number(): 07788 is 7788 and 07790 is 7790, ' 7790' is 7790, and abc or 70000 fall
    // back to 7788. The bash reader takes none of them as a port and never guesses which the server took: it refuses,
    // writing nothing, and only unset or empty is the default (review 4022 F1, the coordinator's rule). This case was
    // `expose: an unusable CCRC_PORT is the default, as the server reads it`, which expected 7788 for abc, 07788 and 70000.
    const flags = ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid', '--content-origin', 'https://content.example.invalid'];
    for (const port of ['abc', '07788', '07790', '70000', ' 7790']) {
      const home = box('ccrc-art-badport-');
      seedFile(home, byoEnv('https://ccrc.example.test', 'example.test'));
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), `CCRC_PORT=${port}\n`);
      const r = runPiped(home, flags);
      expect(r.code, `${port}: ${r.stderr}`).toBe(1);
      expect(r.stderr, port).toContain(`CCRC_PORT="${port}" is not a plain port number: write it as digits only (1 to 65535, no leading zero). Nothing was written.`);
      expect(bytesAt(exposurePath(home)), port).toBe(byoEnv('https://ccrc.example.test', 'example.test'));
    }
    for (const line of ['CCRC_PORT=\n', 'CCRC_PORT=7789\n']) {
      const home = box('ccrc-art-port-');
      seedFile(home, byoEnv('https://ccrc.example.test', 'example.test'));
      writeFileSync(join(home, '.ccrc', 'ccrc.env'), line);
      const r = runPiped(home, flags);
      expect(r.code, `${line}: ${r.stderr}`).toBe(0);
      expect(bytesAt(exposurePath(home)), line).toContain('CCRC_ARTIFACT_PORT=7790\n');
    }
  });

  it('expose: a stored artifact port the console cannot keep names --off', () => {
    // The arm has no port flag, so a bare re-run keeps the stored port; --off clears it and the next run writes 7790.
    const home = box('ccrc-art-storedport-');
    const [ao, co] = ['https://art.example.invalid', 'https://content.example.invalid'];
    seedFile(home, byoEnv('https://ccrc.example.test', 'example.test') + artKeys(ao, co, 7788));
    const flags = ['expose', 'artifacts', '--artifact-origin', ao, '--content-origin', co];
    const r = runPiped(home, flags);
    expect(r.code, r.stderr).toBe(1);
    expect(r.stderr).toContain('CCRC_ARTIFACT_PORT="7788" is the console\'s own port. Turn the tier off first '
      + '(ccrc expose artifacts --off), then run ccrc expose artifacts again. Nothing was written.');
    expect(runPiped(home, ['expose', 'artifacts', '--off']).code).toBe(0);
    expect(runPiped(home, flags).code).toBe(0);
    expect(bytesAt(exposurePath(home))).toContain('CCRC_ARTIFACT_PORT=7790\n');
  });

  it('expose: artifacts flags that do not fit are usage errors or refusals', async () => {
    const home = box('ccrc-art-flags-');
    const sub = genLabel();
    await seedDuckdns(home, sub);
    const before = [bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))];
    for (const args of [['--bogus'], ['--off', '--artifact-origin', 'https://x.example.invalid'], ['--artifact-origin']]) {
      expect(runPiped(home, ['expose', 'artifacts', ...args]).code, args.join(' ')).toBe(2);
    }
    const flagged = runPiped(home, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid']);
    expect(flagged.code, 'a DuckDNS box takes labels at the prompt, never flags').toBe(1);
    expect(flagged.stderr).toContain('two more DuckDNS labels, asked at the prompt');
    expect(runPiped(home, ['expose', 'artifacts']).code, 'a pipe cannot answer the label prompts').toBe(1);
    const byo = box('ccrc-art-flags-byo-');
    seedFile(byo, byoEnv('https://ccrc.example.test', 'example.test'));
    const miss = runPiped(byo, ['expose', 'artifacts', '--artifact-origin', 'https://art.example.invalid']);
    expect(miss.code).toBe(1);
    expect(miss.stderr).toContain('a byo box names both artifact origins');
    expect([bytesAt(exposurePath(home)), bytesAt(caddyfilePath(home))]).toEqual(before);
    expect(bytesAt(exposurePath(byo))).toBe(byoEnv('https://ccrc.example.test', 'example.test'));
  });
});
