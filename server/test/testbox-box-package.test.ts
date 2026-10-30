// D-7409, D-7423, D-7424, D-7451, D-7456, D-7501, D-7568 (plan docs/superpowers/plans/2026-10-29-test-box.md, Task
// TB7; spec §2.0, §2.2, §2.3, §9). The box package: the static system units under deploy/testbox/systemd/, the polkit
// rule, the egress firewall, the prepare and egress scripts, and the root installer deploy/testbox/install.sh.
//
// The rows: every unit's properties equal spec §2.3's "Static units" and "Network" bullets, parsed and literal, and no
// unit has an EnvironmentFile= or a CCRC_TESTBOX_* Environment= line; `systemd-analyze verify` over the rendered units
// where it is installed (a printed notice otherwise); the polkit regex accepts exactly the names agent/src/testbox/
// systemd.ts starts and refuses every other; the firewall names every row of spec §2.0's table and no other
// destination; the installer into a fixture root: the phases in order with the firewall and the service last, the
// tree root's with no group or other write, the owners and modes, idempotence, each refusal before anything is
// written (the box file's owner with an empty TB_SYS log, D-7456; a MANIFEST mismatch; build.json's version; another
// tag; a non-XFS root; a root without reflink=1; another distribution), a node checksum mismatch that stops before
// <tools>/current and a re-run that completes, and a TB_SYS log with no `ccrc install`, no `systemctl --user` and no
// ccrc server, agent or user unit; the prepare and egress scripts against fixture mirrors and resolvers; and the
// TB_FIXTURE_ census.
//
// Every installer run is the test user's, with TB_FIXTURE_ROOT, TB_FIXTURE_OWNER_UID=$(id -u) (D-7456) and TB_SYS at
// server/test/fixtures/testbox-sys-driver.sh, so nothing runs systemctl, writes a real polkit rule, loads a real
// firewall, adds a user or contacts a host: nodejs.org is a fixture HTTPS server reached through the fixture home's
// .curlrc.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { units, UNIT_NAME } from '../../agent/src/testbox/systemd.js';
import { encodeSpec, type RunSpec } from '../../agent/src/testbox/spec.js';
import {
  BOOT_NODE, BOOT_TAG, makeBox, makeWorld, install, exec, REPO, releaseTree, run, sysLog, treeOf, unitProps, UID, writeManifest,
  type Box, type World,
} from './testboxBoxFixture.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();

const PKG = path.join(REPO, 'deploy', 'testbox');
const SYSTEMD = path.join(PKG, 'systemd');
const SPEC = path.join(REPO, 'docs', 'superpowers', 'specs', '2026-10-28-test-box-design.md');
const read = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const unit = (n: string): string[] => unitProps(read(path.join(SYSTEMD, n)));

let W: World;
beforeAll(async () => { W = await makeWorld(); }, 180_000);
afterAll(async () => { await W?.close(); });

// ---------------------------------------------------------------------------------------------------------------
// The units, literally (spec §2.3).
// ---------------------------------------------------------------------------------------------------------------

/** The sandbox spec §2.3 gives the prepare and run templates and, for `install/run`, the install unit. */
const SANDBOX = (rw: string): string[] => [
  '[Service] ProtectProc=invisible', '[Service] NoNewPrivileges=yes', '[Service] PrivateDevices=yes', '[Service] PrivateTmp=yes',
  '[Service] RemoveIPC=yes', '[Service] ProtectSystem=strict', `[Service] ReadWritePaths=${rw}`,
];
const LOOPBACK = ['[Service] IPAddressDeny=any', '[Service] IPAddressAllow=127.0.0.1/32 ::1/128'];

describe('the static units equal spec §2.3, literally (D-7409, D-7451, D-7501)', () => {
  it('the tree holds the eight units and the three slices, and nothing else', () => {
    expect(existsSync(SYSTEMD) ? readdirSync(SYSTEMD).sort() : []).toEqual([
      'ccrc-testbox-clean@.service', 'ccrc-testbox-egress.service', 'ccrc-testbox-egress.timer', 'ccrc-testbox-install.service',
      'ccrc-testbox-install.slice', 'ccrc-testbox-prepare@.service', 'ccrc-testbox-run.slice', 'ccrc-testbox-run@.service',
      'ccrc-testbox-tools.service', 'ccrc-testbox.service', 'ccrc-testbox.slice',
    ]);
  });

  it('prepare@: User=ccrc-tb-%i, its run slice, the privileged prestart, the fixed ExecStart, out/%i/ output, loopback and the proxy, the sandbox', () => {
    expect(unit('ccrc-testbox-prepare@.service')).toEqual([
      "[Unit] Description=ccrc test box: run %i's prepare",
      '[Service] Type=exec', '[Service] User=ccrc-tb-%i', '[Service] Slice=ccrc-testbox-run-%i.slice',
      '[Service] ExecStartPre=+@@TREE@@/deploy/testbox/bin/prestart @@ROOT@@/specs/%i',
      '[Service] ExecStart=@@TREE@@/deploy/testbox/bin/prepare @@ROOT@@/specs/%i',
      '[Service] StandardOutput=truncate:@@ROOT@@/out/%i/prepare.stdout', '[Service] StandardError=truncate:@@ROOT@@/out/%i/prepare.stderr',
      ...LOOPBACK, ...SANDBOX('@@ROOT@@/runs/%i/run'),
    ]);
  });

  it('run@: the runner, its own network namespace (PrivateNetwork=yes) with IPAddressDeny=any as the second fence, out/%i/stdout and stderr', () => {
    expect(unit('ccrc-testbox-run@.service')).toEqual([
      "[Unit] Description=ccrc test box: run %i's command",
      '[Service] Type=exec', '[Service] User=ccrc-tb-%i', '[Service] Slice=ccrc-testbox-run-%i.slice',
      '[Service] ExecStart=@@TREE@@/deploy/testbox/bin/runner @@ROOT@@/specs/%i',
      '[Service] StandardOutput=truncate:@@ROOT@@/out/%i/stdout', '[Service] StandardError=truncate:@@ROOT@@/out/%i/stderr',
      '[Service] PrivateNetwork=yes', ...LOOPBACK, ...SANDBOX('@@ROOT@@/runs/%i/run'),
    ]);
  });

  it('install: the install user, its slice, install-pre, runner and install-post, the prepare\'s network and the sandbox for install/run', () => {
    expect(unit('ccrc-testbox-install.service')).toEqual([
      '[Unit] Description=ccrc test box: a pristine install',
      '[Service] Type=exec', '[Service] User=ccrc-tb-install', '[Service] Slice=ccrc-testbox-install.slice',
      '[Service] ExecStartPre=+@@TREE@@/deploy/testbox/bin/install-pre @@ROOT@@/specs/install',
      '[Service] ExecStart=@@TREE@@/deploy/testbox/bin/runner @@ROOT@@/specs/install',
      '[Service] ExecStartPost=+@@TREE@@/deploy/testbox/bin/install-post @@ROOT@@/specs/install',
      '[Service] StandardOutput=truncate:@@ROOT@@/out/install/stdout', '[Service] StandardError=truncate:@@ROOT@@/out/install/stderr',
      ...LOOPBACK, ...SANDBOX('@@ROOT@@/install/run'),
    ]);
  });

  it('clean@, tools, the service, egress and its timer: root\'s fixed scripts from the installed release; the service restarts always (D-7426)', () => {
    expect(unit('ccrc-testbox-clean@.service')).toEqual([
      '[Unit] Description=ccrc test box: clean %i', '[Service] Type=exec', '[Service] ExecStart=@@TREE@@/deploy/testbox/bin/clean @@ROOT@@/specs/%i',
    ]);
    expect(unit('ccrc-testbox-tools.service')).toEqual([
      '[Unit] Description=ccrc test box: the tool sync', '[Service] Type=exec',
      '[Service] ExecStart=@@TREE@@/deploy/testbox/bin/tools-sync @@ROOT@@/specs/tools', '[Service] NFTSet=cgroup:inet:ccrc_testbox:tools_cg',
    ]);
    const svc = unit('ccrc-testbox.service');
    expect(svc).toContain('[Service] Restart=always');
    expect(svc).toContain('[Service] ExecStartPre=+@@TREE@@/deploy/testbox/bin/tools-sync --takeover-ended');
    expect(svc).toContain('[Service] ExecStart=@@TOOLS@@/current/node @@TREE@@/agent/dist/agent/src/testbox/main.js');
    expect(svc).toContain('[Service] NFTSet=cgroup:inet:ccrc_testbox:service_cg');
    expect(unit('ccrc-testbox-egress.service')).toContain('[Service] ExecStart=@@TREE@@/deploy/testbox/bin/egress @@ETC@@/egress');
    expect(unit('ccrc-testbox-egress.timer')).toContain('[Timer] Unit=ccrc-testbox-egress.service');
  });

  it('no unit sets ProcSubset (it would hide /proc/meminfo and /proc/stat, spec §2.3)', () => {
    for (const f of readdirSync(SYSTEMD)) expect(unit(f).filter((l) => l.includes('ProcSubset')), f).toEqual([]);
  });

  it('census (D-7451): no file under deploy/testbox/ has an EnvironmentFile= line or a CCRC_TESTBOX_* Environment= line', () => {
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        for (const l of readFileSync(p, 'utf8').split('\n')) {
          if (/^\s*EnvironmentFile\s*=/.test(l) || /^\s*Environment\s*=.*CCRC_TESTBOX_/.test(l)) hits.push(`${path.relative(REPO, p)}: ${l}`);
        }
      }
    };
    walk(PKG);
    expect(hits).toEqual([]);
  });

  it('census (D-7456): no unit and no script under deploy/testbox/ names a TB_FIXTURE_ variable', () => {
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = path.join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (readFileSync(p, 'utf8').includes('TB_FIXTURE_')) hits.push(path.relative(REPO, p));
      }
    };
    walk(PKG);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The polkit rule (spec §2.3).
// ---------------------------------------------------------------------------------------------------------------

describe('the polkit rule: the service user starts and stops the static units and nothing else (D-7409)', () => {
  const RULE = read(path.join(PKG, 'polkit', '50-ccrc-testbox.rules'));
  const re = (): RegExp => {
    const m = /\.test\(unit\)/.test(RULE) ? /\/(\^ccrc-testbox-[^/]+\$)\/\.test\(unit\)/.exec(RULE) : null;
    expect(m, 'the rule tests the unit against one regex literal').not.toBeNull();
    return new RegExp(m![1]!);
  };

  it('its regex is systemd.ts#UNIT_NAME, character for character', () => {
    expect(re().source).toBe(UNIT_NAME.source);
  });

  it('accepts every name systemd.ts starts', () => {
    const names = [units.prepare(1), units.prepare(12), units.run(1), units.run(4), units.clean(3), units.clean('install'), units.install(), units.tools()];
    for (const n of names) expect(re().test(n), n).toBe(true);
  });

  it('refuses the service itself, a non-numeric instance and every other name', () => {
    for (const n of [
      'ccrc-testbox.service', 'ccrc-testbox-run@x.service', 'ccrc-testbox-run@.service', 'ccrc-testbox-prepare@install.service',
      'ccrc-testbox-clean@.service', 'ccrc-testbox-egress.service', 'ccrc-testbox-egress.timer', 'ccrc-testbox-run@1.service.d',
      'ccrc-testbox-tools.service2', 'xccrc-testbox-tools.service', 'sshd.service', 'ccrc.service', 'ccrc-agent.service',
      'ccrc-testbox-install@1.service', 'ccrc-testbox-run@1.slice',
    ]) expect(re().test(n), n).toBe(false);
  });

  it('grants start and stop only, to the service user only', () => {
    expect(RULE).toContain('action.id !== "org.freedesktop.systemd1.manage-units" || subject.user !== "@@SERVICE_USER@@"');
    expect(RULE).toContain('(verb === "start" || verb === "stop")');
    expect(RULE.match(/polkit\.Result\.YES/g)?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The firewall (spec §2.0).
// ---------------------------------------------------------------------------------------------------------------

/** Spec §2.0's egress table: each row's first cell and who uses it. */
function egressTable(): { name: string; who: string }[] {
  const text = read(SPEC);
  const start = text.indexOf('| name | for | who uses it |');
  expect(start, "spec §2.0's table is there").toBeGreaterThan(0);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end).split('\n').slice(2).map((l) => {
    const c = l.split('|').map((s) => s.trim());
    return { name: c[1]!, who: c[3]! };
  });
}
/** The firewall's set for each row of the table, by the row's own words. */
const ROW_SET: [RegExp, string][] = [
  [/^`github\.com`$/, 'github'], [/npm upstream/, 'registry'], [/release host/, 'release'], [/^`nodejs\.org`$/, 'nodejs'],
  [/storage\.googleapis\.com/, 'chrome'], [/OS package mirror/, 'osmirror'],
];

describe('the firewall names every row of spec §2.0\'s table, from the unit the table names, and no other destination (D-7409, D-7568)', () => {
  const NFT = read(path.join(PKG, 'nft', 'ccrc-testbox.nft'));
  const code = NFT.split('\n').filter((l) => !/^\s*#/.test(l));

  it('one v4 and one v6 address set per row, and no other address set', () => {
    const table = egressTable();
    expect(table.length).toBe(6);
    const sets = table.map((r) => ROW_SET.find(([re]) => re.test(r.name))?.[1]);
    expect(sets).toEqual(['github', 'registry', 'release', 'nodejs', 'chrome', 'osmirror']);
    const declared = code.map((l) => /^\s*set (\w+) \{ type (ipv4_addr|ipv6_addr)/.exec(l)).filter((m) => m !== null).map((m) => m![1]);
    expect(declared).toEqual(sets.flatMap((s) => [`${s}_v4`, `${s}_v6`]));
  });

  it('each row is reachable from the unit the table names: the service for the mirror and the registry, the tools unit for the rest', () => {
    for (const [i, r] of egressTable().entries()) {
      const set = ROW_SET[i]![1];
      const cg = /the service|the registry proxy only/.test(r.who) ? 'service_cg' : /the tools unit only/.test(r.who) ? 'tools_cg' : null;
      expect(cg, r.name).not.toBeNull();
      const rules = code.filter((l) => l.includes(`@${set}_v`));
      expect(rules.length, set).toBe(2);
      for (const l of rules) expect(l, set).toContain(`socket cgroupv2 level 2 @${cg} `);
    }
  });

  it('no destination address or other set is named: every daddr is a row\'s set or the listen address the installer writes', () => {
    const daddrs = code.flatMap((l) => [...l.matchAll(/\b(?:ip6?) daddr (\S+)/g)].map((m) => m[1]!));
    expect(daddrs.filter((d) => !/^@(github|registry|release|nodejs|chrome|osmirror)_v[46]$/.test(d))).toEqual([]);
    expect(code.join('\n')).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(code.filter((l) => /tcp dport/.test(l) && !/@\w+_v[46]|@@LISTEN_MATCH@@|dport 53/.test(l))).toEqual([]);
  });

  it('the output and input policies drop; inbound is ssh and the service port on the tailnet address only', () => {
    expect(code.filter((l) => /policy/.test(l)).map((l) => l.trim())).toEqual([
      'type filter hook output priority filter; policy drop;', 'type filter hook input priority filter; policy drop;',
    ]);
    expect(code.filter((l) => /dport \{ 22/.test(l)).map((l) => l.trim())).toEqual(['@@LISTEN_MATCH@@ tcp dport { 22, @@LISTEN_PORT@@ } accept']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The installer into a fixture root (D-7424, D-7456).
// ---------------------------------------------------------------------------------------------------------------

const lines = (b: Box): string[] => sysLog(b).map((l) => l.join(' '));
const indexOf = (l: string[], re: RegExp): number => l.findIndex((x) => re.test(x));
const lastIndexOf = (l: string[], re: RegExp): number => { for (let i = l.length - 1; i >= 0; i--) if (re.test(l[i]!)) return i; return -1; };
/** The TB_SYS lines phase 1 makes (its two queries) and nothing else. */
const QUERIES = (b: Box, made = false): string[] => [
  `findmnt -n -o FSTYPE,TARGET -T ${made ? b.tbRoot : path.join(b.root, 'srv')}`, 'xfs_info /srv',
];

describe('the installer: a first install into a fixture root (D-7409, D-7424)', () => {
  let b: Box;
  let first: Awaited<ReturnType<typeof install>>;
  beforeAll(async () => {
    b = makeBox(W);
    first = await install(b, { staging: W.staging });
  }, 240_000);

  it('completes, and runs the phases in order with the firewall and the service last and the marker after them', () => {
    expect(first.code, first.stderr).toBe(0);
    expect(first.stderr.split('\n').filter((l) => / phase \d:/.test(l)).map((l) => /phase (\d)/.exec(l)![1])).toEqual(['2', '3', '4', '5', '6']);
    const l = lines(b);
    const nft = indexOf(l, /^nft -f /);
    const start = indexOf(l, /^systemctl enable --now ccrc-testbox\.service ccrc-testbox-egress\.timer$/);
    expect(nft).toBeGreaterThan(lastIndexOf(l, /^(useradd|groupadd|usermod|chown) /));
    expect(nft).toBeGreaterThan(lastIndexOf(l, /etc\/systemd\/system\/.*\.(service|slice|timer|conf)$/));
    expect(start).toBeGreaterThan(nft);
    expect(lastIndexOf(l, /etc\/ccrc-testbox\/installed$/)).toBe(l.length - 1);
    expect(l.filter((x) => x.startsWith('systemctl '))).toEqual([
      'systemctl daemon-reload', 'systemctl enable nftables.service', 'systemctl enable --now ccrc-testbox.service ccrc-testbox-egress.timer',
      'systemctl start ccrc-testbox-egress.service',
    ]);
    expect(readFileSync(path.join(b.root, 'etc', 'ccrc-testbox', 'installed'), 'utf8')).toBe(
      `release\t${BOOT_TAG}\nbox-sha256\t${run('shasum', ['-a', '256', b.boxFile]).split(' ')[0]}\n`,
    );
  });

  it('the release lands root\'s at <tools>/release/<tag>, named by installed, with no group or other write anywhere in it', () => {
    expect(readFileSync(path.join(b.tools, 'release', BOOT_TAG, 'build.json'), 'utf8')).toBe(readFileSync(path.join(W.staging, 'build.json'), 'utf8'));
    const writable = treeOf(path.join(b.tools, 'release', BOOT_TAG)).filter((x) => { const m = x.split(' '); return m[1] !== 'l' && (Number.parseInt(m[2]!, 8) & 0o022) !== 0; });
    expect(writable).toEqual([]);
    expect(lines(b)).toContain(`chown -R -h root:root ${path.join(b.tools, 'release', `.stage.${BOOT_TAG}`)}`);
    expect(treeOf(path.join(b.tools, 'release')).filter((x) => x.startsWith('installed '))).toEqual([`installed l ${BOOT_TAG}`]);
  });

  it('node is the fixture\'s checked tarball at <tools>/node/<v> with spec §2.2\'s npmrc, and <tools>/current is the bootstrap set holding only node', () => {
    expect(treeOf(path.join(b.tools, 'sets'))).toEqual(['s.bootstrap d 755', `s.bootstrap/node l ../../node/${BOOT_NODE}/bin/node`]);
    expect(treeOf(b.tools).filter((x) => x.startsWith('current '))).toEqual(['current l sets/s.bootstrap']);
    expect(readFileSync(path.join(b.tools, 'node', BOOT_NODE, 'etc', 'npmrc'), 'utf8')).toBe(
      `registry=http://127.0.0.2:4873/\ncache=\${HOME}/.npm\nnodedir=${path.join(b.tools, 'node', BOOT_NODE)}\n`,
    );
  });

  it('the release\'s server/ dependencies: npm ci --omit=dev --ignore-scripts straight from the upstream registry, under that node', () => {
    const npm = read(path.join(W.log, 'npm-argv')).split('\n').filter((l) => l.startsWith(path.join(b.tools, 'release', BOOT_TAG, 'server')));
    expect(npm).toEqual([`${path.join(b.tools, 'release', BOOT_TAG, 'server')}\tci --omit=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`]);
    expect(existsSync(path.join(b.tools, 'release', BOOT_TAG, 'server', 'node_modules', '.fixture-ci'))).toBe(true);
  });

  it('the users, the groups and the owners and modes the installer gives (phase 5), the box file\'s chown and chmod through TB_SYS (D-7451)', () => {
    const l = lines(b);
    expect(l.filter((x) => /^(useradd|groupadd|usermod) /.test(x)).map((x) => x.replace(b.root, '<root>'))).toEqual([
      'groupadd --system ccrc-tb-git',
      'useradd --system --user-group --home-dir <root>/var/lib/ccrc-tb-svc --shell /usr/sbin/nologin --create-home ccrc-tb-svc',
      'useradd --system --user-group --home-dir <root>/var/lib/ccrc-tb-push --shell /usr/bin/git-shell ccrc-tb-push',
      'useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin ccrc-tb-1',
      'useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin ccrc-tb-2',
      'useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin ccrc-tb-install',
      'usermod -a -G ccrc-tb-git ccrc-tb-svc', 'usermod -a -G ccrc-tb-git ccrc-tb-push',
    ]);
    expect(l).toContain(`chown root:ccrc-tb-svc ${b.boxFile}`);
    expect(l).toContain(`chmod 0640 ${b.boxFile}`);
    expect((statSync(b.boxFile).mode & 0o777).toString(8)).toBe('640');
    const dirs = l.filter((x) => x.startsWith('install -d ') && (x.endsWith(b.tbRoot) || x.includes(`${b.tbRoot}/`))).map((x) => x.replace('install -d ', '').replace(b.tbRoot, '<root>'));
    expect(dirs).toEqual([
      '-m 0755 -o root -g root <root>', '-m 0755 -o root -g root <root>/runs', '-m 0755 -o root -g root <root>/install',
      '-m 0755 -o root -g root <root>/pristine', '-m 0755 -o root -g root <root>/runs/1', '-m 0755 -o root -g root <root>/runs/2',
      '-m 0755 -o ccrc-tb-svc -g ccrc-tb-svc <root>/specs',
      ...['results', 'logs', 'out', 'registry', 'handover', 'out/1', 'out/2', 'out/install'].map((d) => `-m 0750 -o ccrc-tb-svc -g ccrc-tb-svc <root>/${d}`),
    ]);
  });

  it('the push user\'s one key: restrict,command= the installed forced command and the repository table, the key without its comment', () => {
    const ak = path.join(b.root, 'var', 'lib', 'ccrc-tb-push', '.ssh', 'authorized_keys');
    expect(readFileSync(ak, 'utf8')).toBe(
      `restrict,command="${path.join(b.tools, 'release', 'installed', 'deploy', 'testbox', 'git', 'push-command')} ${b.repos}" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureFixtureFixtureFixtureFixtureFixture0000\n`,
    );
  });

  it('the mirror: bare, core.sharedRepository=0664, group ccrc-tb-git, root\'s config, hooksPath the installed release\'s TB3 hook, fetched by the service only', () => {
    const cfg = (k: string): string => run('git', ['config', '--file', path.join(b.mirror, 'config'), k]).trim();
    expect(cfg('core.bare')).toBe('true');
    expect(cfg('core.sharedRepository')).toBe('0664');
    expect(cfg('core.hooksPath')).toBe(path.join(b.tools, 'release', 'installed', 'deploy', 'testbox', 'git'));
    expect(existsSync(path.join(cfg('core.hooksPath'), 'pre-receive'))).toBe(true);
    expect(cfg('remote.origin.url')).toBe('https://testbox.invalid/project-a.git');
    expect(cfg('remote.origin.fetch')).toBe('+refs/heads/*:refs/remotes/origin/*');
    const l = lines(b);
    expect(l).toContain(`chown -R ccrc-tb-svc:ccrc-tb-git ${b.mirror}`);
    expect(l).toContain(`chown root:root ${path.join(b.mirror, 'config')}`);
    expect((statSync(b.mirror).mode & 0o7777).toString(8)).toBe('3775');
    expect(readFileSync(path.join(b.repos, 'project-a.json'), 'utf8')).toBe(readFileSync(b.rowFile, 'utf8'));
  });

  it('the units carry the installed tree\'s and <tools>/current/node\'s absolute paths, and the drop-ins the box file\'s values', () => {
    const sys = path.join(b.root, 'etc', 'systemd', 'system');
    const svc = readFileSync(path.join(sys, 'ccrc-testbox.service'), 'utf8');
    expect(svc).toContain(`ExecStart=${path.join(b.tools, 'current', 'node')} ${path.join(b.tools, 'release', 'installed', 'agent', 'dist', 'agent', 'src', 'testbox', 'main.js')}\n`);
    expect(readFileSync(path.join(sys, 'ccrc-testbox-run@.service'), 'utf8')).toContain(`ReadWritePaths=${path.join(b.tbRoot, 'runs')}/%i/run\n`);
    for (const f of readdirSync(sys)) if (statSync(path.join(sys, f)).isFile()) expect(readFileSync(path.join(sys, f), 'utf8'), f).not.toContain('@@');
    const drop = (u: string): string[] => unitProps(readFileSync(path.join(sys, `${u}.d`, '50-ccrc-testbox.conf'), 'utf8'));
    expect(drop('ccrc-testbox.service')).toEqual(['[Service] User=ccrc-tb-svc', '[Service] Group=ccrc-tb-svc']);
    expect(drop('ccrc-testbox-prepare@.service')).toEqual(['[Service] User=ccrc-tb-%i', '[Service] IPAddressAllow=127.0.0.2/32', '[Service] RuntimeMaxSec=1h']);
    expect(drop('ccrc-testbox-run@.service')).toEqual(['[Service] User=ccrc-tb-%i', '[Service] RuntimeMaxSec=1h']);
    expect(drop('ccrc-testbox-clean@.service')).toEqual(['[Service] RuntimeMaxSec=1h']);
    expect(drop('ccrc-testbox-install.service')).toEqual(['[Service] User=ccrc-tb-install', '[Service] IPAddressAllow=127.0.0.2/32', '[Service] RuntimeMaxSec=1h']);
    for (const s of ['ccrc-testbox-run-.slice', 'ccrc-testbox-install.slice']) {
      expect(drop(s)).toEqual(['[Slice] MemoryMax=4G', '[Slice] MemorySwapMax=1G', '[Slice] CPUQuota=200%']);
    }
    expect(readFileSync(path.join(b.root, 'etc', 'polkit-1', 'rules.d', '50-ccrc-testbox.rules'), 'utf8')).toContain('subject.user !== "ccrc-tb-svc"');
    expect(readFileSync(path.join(b.root, 'etc', 'ccrc-testbox', 'ccrc-testbox.nft'), 'utf8')).toContain('    ip daddr 127.0.0.9 tcp dport { 22, 7443 } accept\n');
    expect(readFileSync(path.join(b.root, 'etc', 'ccrc-testbox', 'egress'), 'utf8')).toBe([
      'github\tgithub.com', 'nodejs\tnodejs.org', 'chrome\tstorage.googleapis.com', 'registry\tregistry.npmjs.org', 'release\tgithub.com',
      'osmirror\tmirror.testbox.invalid', '',
    ].join('\n'));
  });

  it('the TB_SYS log holds no `ccrc install`, no `systemctl --user`, and no write of a ccrc server, agent or user unit file (D-7424)', () => {
    const l = lines(b);
    expect(l.filter((x) => /ccrc install|install\.sh/.test(x) && !x.includes('ccrc-testbox'))).toEqual([]);
    expect(l.filter((x) => /^systemctl .*--user/.test(x))).toEqual([]);
    const written = sysLog(b).filter((a) => a[0] === 'install' && !a.includes('-d')).map((a) => a[a.length - 1]!);
    expect(written.filter((p) => /\.config\/systemd\/user|\/ccrc(-agent)?\.service$|ccrc-server/.test(p))).toEqual([]);
    expect(written.filter((p) => p.includes(`${path.sep}systemd${path.sep}`)).map((p) => path.basename(p.endsWith('.conf') ? path.dirname(p) : p))
      .filter((n) => !n.startsWith('ccrc-testbox') && n !== 'nftables.service.d')).toEqual([]);
  });

  it('systemd-analyze verify accepts the rendered units, where it is installed', () => {
    const which = spawnSync('sh', ['-c', 'command -v systemd-analyze'], { encoding: 'utf8' });
    if (which.status !== 0) {
      console.log('testbox-box-package: systemd-analyze is not installed here; the verify row is skipped (it runs where it is)');
      return;
    }
    const sys = path.join(b.root, 'etc', 'systemd', 'system');
    const dir = mkTmp('ccrc-tb-verify-');
    const files: string[] = [];
    for (const f of readdirSync(sys)) {
      const p = path.join(sys, f);
      if (!statSync(p).isFile()) continue;
      const inst = f.includes('@.') ? f.replace('@.', '@1.') : f;
      cpSync(p, path.join(dir, inst));
      files.push(path.join(dir, inst));
    }
    const r = spawnSync('systemd-analyze', ['verify', '--man=no', ...files], { encoding: 'utf8', env: { ...process.env, SYSTEMD_UNIT_PATH: `${dir}:` } });
    console.log(`testbox-box-package: systemd-analyze verify: exit ${String(r.status)}\n${r.stdout}${r.stderr}`);
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
  });

  it('a second run with the same tag and an unchanged box file changes nothing: the same tree, owners and modes, and only phase 1\'s two queries', async () => {
    const before = treeOf(b.root);
    const n = sysLog(b).length;
    const again = await install(b, { staging: W.staging });
    expect(again.code, again.stderr).toBe(0);
    expect(again.stderr).toContain('nothing to do');
    expect(treeOf(b.root)).toEqual(before);
    expect(lines(b).slice(n)).toEqual(QUERIES(b, true));
  });

  it('a second run naming another tag is refused before anything is written (later releases come only through the tool sync)', async () => {
    const other = releaseTree(mkTmp('ccrc-tb-other-'), 'v0.0.2');
    const before = treeOf(b.root);
    const n = sysLog(b).length;
    const r = await install(b, { staging: other, release: 'v0.0.2' });
    expect([r.code, r.stderr.trim()]).toEqual([1, `ccrc-testbox-install: refused: ${path.join(b.tools, 'release', 'installed')} names ${BOOT_TAG}, not v0.0.2: later releases come only through the tool sync; nothing was written`]);
    expect(treeOf(b.root)).toEqual(before);
    expect(sysLog(b).length).toBe(n);
  });
});

describe('the installer\'s refusals, each before anything is written (D-7423, D-7424, D-7456)', () => {
  const refused = async (b: Box, o: Parameters<typeof install>[1], why: string, queries: boolean): Promise<void> => {
    const before = treeOf(b.root);
    const r = await install(b, { staging: W.staging, ...o });
    expect([r.code, r.stderr.trim()]).toEqual([1, `ccrc-testbox-install: refused: ${why}; nothing was written`]);
    expect(treeOf(b.root)).toEqual(before);
    expect(lines(b)).toEqual(queries ? QUERIES(b) : []);
  };

  it('the box file\'s owner, with TB_FIXTURE_OWNER_UID unset: refused by name with an empty TB_SYS log (D-7456)', async () => {
    const b = makeBox(W, { env: { TB_FIXTURE_OWNER_UID: '' } });
    await refused(b, {}, `the box file: ${b.boxFile} is owned by uid ${UID}, not uid 0`, false);
    expect(existsSync(b.sysLog)).toBe(false);
  });

  it('a box file writable by group or other, and a value that is not its setting\'s shape', async () => {
    const b = makeBox(W);
    chmodSync(b.boxFile, 0o660);
    await refused(b, {}, `the box file: ${b.boxFile} is writable by group or other (mode 660)`, false);
    const c = makeBox(W, { boxLines: ['CCRC_TESTBOX_RUNS=zero'] });
    const before = treeOf(c.root);
    const r = await install(c, { staging: W.staging });
    expect([r.code, r.stderr.trim().split('\n')]).toEqual([1, [
      `ccrc-testbox-install: WARN: CCRC_TESTBOX_RUNS=zero (from the ${c.boxFile}) is not a whole number from 1 to 99; using its default 2`,
      'ccrc-testbox-install: refused: the box file holds a value that is not its setting\'s shape (above); nothing was written',
    ]]);
    expect(treeOf(c.root)).toEqual(before);
    expect(lines(c)).toEqual([]);
  });

  it('a staging tree that does not match its MANIFEST', async () => {
    const st = path.join(mkTmp('ccrc-tb-tamper-'), 'staging');
    cpSync(W.staging, st, { recursive: true });
    appendFileSync(path.join(st, 'ccd', 'ccrc-test'), '\n# tampered\n');
    await refused(makeBox(W), { staging: st }, 'the staging tree does not match its MANIFEST', false);
  });

  it('a build.json whose version is not --release, and a --node that is not a version', async () => {
    await refused(makeBox(W), { release: 'v0.0.9' }, `build.json's version ${BOOT_TAG} is not --release v0.0.9`, false);
    await refused(makeBox(W), { node: 'latest' }, '--node latest is not a version', false);
  });

  it('a run root that is not on XFS, and one on XFS without reflink=1 (fixture findmnt and xfs_info)', async () => {
    const b = makeBox(W, { findmnt: 'ext4 /\n' });
    const before = treeOf(b.root);
    const r = await install(b, { staging: W.staging });
    expect([r.code, r.stderr.trim()]).toEqual([1, `ccrc-testbox-install: refused: CCRC_TESTBOX_ROOT=${b.tbRoot} is on ext4, not XFS; nothing was written`]);
    expect(treeOf(b.root)).toEqual(before);
    expect(lines(b)).toEqual([QUERIES(b)[0]]);
    const c = makeBox(W, { xfs: 'meta-data=/dev/fixture isize=512\n         =   reflink=0    bigtime=1\n' });
    await refused(c, {}, `CCRC_TESTBOX_ROOT=${c.tbRoot} is on XFS without reflink=1`, true);
  });

  it('a box that is not the distribution release --distro names (D-7423)', async () => {
    const b = makeBox(W);
    writeFileSync(path.join(b.root, 'etc', 'os-release'), 'ID=debian\nVERSION_ID="12"\n');
    await refused(b, {}, 'the box runs debian-12, not --distro ubuntu-24.04', true);
  });

  it('a listen address that is not set or not an IP address, and an egress name that is no row of spec §2.0\'s table', async () => {
    await refused(makeBox(W, { paths: false, boxLines: [`CCRC_TESTBOX_ROOT=/srv/x`, `CCRC_TESTBOX_REPOS=/srv/y`, `CCRC_TESTBOX_TOOLS_DIR=/opt/z`] }), {},
      'CCRC_TESTBOX_LISTEN is not set: the service listens on the tailnet address only', false);
    await refused(makeBox(W, { boxLines: ['CCRC_TESTBOX_LISTEN=testbox.invalid:7443'] }), {}, 'CCRC_TESTBOX_LISTEN=testbox.invalid:7443 does not name an IP address', false);
    await refused(makeBox(W, { boxLines: ['CCRC_TESTBOX_EGRESS_ALLOW="github.com example.invalid"'] }), {}, 'CCRC_TESTBOX_EGRESS_ALLOW names example.invalid, which is no row of spec §2.0\'s table', false);
  });

  it('a box path that is not absolute: the root installer has no reader\'s home to resolve ~/ against (D-7568)', async () => {
    await refused(makeBox(W, { boxLines: ['CCRC_TESTBOX_ROOT="~/.ccrc/testbox"'] }), {}, 'CCRC_TESTBOX_ROOT=~/.ccrc/testbox is not an absolute path (the installer has no reader\'s home)', false);
  });
});

describe('the installer refuses a release tree that is not root\'s alone (D-7424)', () => {
  it('a tree at <tools>/release/<tag> with a group-writable file fails phase 2 by name, and installed is never linked to it', async () => {
    const b = makeBox(W);
    const dst = path.join(b.tools, 'release', BOOT_TAG);
    cpSync(W.staging, dst, { recursive: true });
    chmodSync(path.join(dst, 'build.json'), 0o664);
    const r = await install(b, { staging: W.staging });
    expect([r.code, r.stderr.trim().split('\n').at(-1)]).toEqual([1, `ccrc-testbox-install: failed: ${path.join(dst, 'build.json')} is writable by someone other than root`]);
    expect(existsSync(path.join(b.tools, 'release', 'installed'))).toBe(false);
    expect(lines(b).filter((x) => /^(nft|systemctl|useradd) /.test(x))).toEqual([]);
  });
});

describe('the installer: a node checksum mismatch stops before <tools>/current, and a re-run completes (D-7424, D-7425)', () => {
  it('the mismatch fails at node with nothing under <tools>/current; with the checksum right, the same command completes', async () => {
    const v = '22.0.7';
    W.serveNode(v, true);
    const b = makeBox(W);
    const r = await install(b, { staging: W.staging, node: v });
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split('\n').at(-1)).toMatch(new RegExp(`^ccrc-testbox-install: failed: node: checksum mismatch for node-v${v.replace(/\./g, '\\.')}-linux-x64\\.tar\\.xz `));
    expect(existsSync(path.join(b.tools, 'current'))).toBe(false);
    expect(existsSync(path.join(b.tools, 'node', v))).toBe(false);
    expect(lines(b).filter((x) => /^(nft|systemctl|useradd) /.test(x))).toEqual([]);
    expect(existsSync(path.join(b.root, 'etc', 'ccrc-testbox', 'installed'))).toBe(false);
    W.serveNode(v);
    const again = await install(b, { staging: W.staging, node: v });
    expect(again.code, again.stderr).toBe(0);
    expect(treeOf(b.tools).filter((x) => x.startsWith('current ') || x.startsWith('sets/'))).toEqual([
      'current l sets/s.bootstrap', 'sets/s.bootstrap d 755', `sets/s.bootstrap/node l ../../node/${v}/bin/node`,
    ]);
    expect(existsSync(path.join(b.root, 'etc', 'ccrc-testbox', 'installed'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The prepare and egress scripts.
// ---------------------------------------------------------------------------------------------------------------

const RUN_ID = 'c'.repeat(32);
const gitEnv = (): NodeJS.ProcessEnv => {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) e[k] = v;
  return { ...e, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@testbox.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@testbox.invalid' };
};
/** A bare mirror holding one run's head ref, and the run's spec. */
function prepareFixture(o: { installs?: { pkg: string; argv: string[] }[]; outputs?: string[]; mirror?: string } = {}): { spec: string; runDir: string } {
  const fx = mkTmp('ccrc-tb-prepare-');
  const work = path.join(fx, 'work');
  const mirror = path.join(fx, 'mirror.git');
  run('git', ['init', '-q', work], undefined, gitEnv());
  mkdirSync(path.join(work, 'server'));
  writeFileSync(path.join(work, 'server', 'package.json'), '{}\n');
  run('git', ['-C', work, 'add', '.'], undefined, gitEnv());
  run('git', ['-C', work, 'commit', '-q', '-m', 'fixture'], undefined, gitEnv());
  run('git', ['init', '-q', '--bare', mirror], undefined, gitEnv());
  run('git', ['-C', work, 'push', '-q', mirror, `HEAD:refs/ccrc-test/${RUN_ID}/head`], undefined, gitEnv());
  const runDir = path.join(fx, 'runs', '1', 'run');
  mkdirSync(path.join(runDir, 'home'), { recursive: true });
  const spec: RunSpec = {
    runId: RUN_ID, k: 1, runUser: 'ccrc-tb-1', runDir, cwd: path.join(runDir, 'checkout', 'server'), resultsDir: path.join(fx, 'results', RUN_ID),
    reportMaxBytes: 1024, serviceUser: 'ccrc-tb-svc', package: 'server', mirror: o.mirror ?? mirror, fetchUrl: 'https://testbox.invalid/project-a.git',
    branch: 'main', refs: ['head'], outputs: o.outputs ?? [],
    env: [['PATH', process.env.PATH ?? '/usr/bin:/bin'], ['HOME', path.join(runDir, 'home')], ['TMPDIR', path.join(fx, 'tmp', 'r')]],
    argv: ['./node_modules/.bin/vitest', 'run'], workers: 1, localDefault: null,
    installs: (o.installs ?? []).map((s) => ({ package: s.pkg, key: null, mode: 'install', dir: path.join(runDir, 'checkout', s.pkg), argv: s.argv })),
  };
  const file = path.join(fx, 'spec');
  writeFileSync(file, encodeSpec(spec));
  return { spec: file, runDir };
}
const PREPARE = path.join(PKG, 'bin', 'prepare');
const lastLine = (s: string): string => s.trim().split('\n').at(-1) ?? '';

describe('prepare: the prepare unit\'s fixed ExecStart (D-7409, D-7501, D-7568)', () => {
  it('checks out the run\'s refs on the session\'s branch and runs each install step in order in its directory', () => {
    const f = prepareFixture({ installs: [{ pkg: 'server', argv: ['git', 'rev-parse', '--abbrev-ref', 'HEAD'] }, { pkg: 'server', argv: ['true'] }] });
    const r = spawnSync(PREPARE, [f.spec], { encoding: 'utf8', env: gitEnv() });
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(path.join(f.runDir, 'checkout', 'server', 'package.json'), 'utf8')).toBe('{}\n');
    expect(r.stderr).toContain('main\n');
  });

  it('a failed checkout ends on the prepare-failed words; a failed install on install-failed; a build output on build-failed', () => {
    const bad = prepareFixture({ mirror: '/nonexistent/mirror.git' });
    const a = spawnSync(PREPARE, [bad.spec], { encoding: 'utf8', env: gitEnv() });
    expect(a.status).toBe(3);
    expect(lastLine(a.stderr)).toMatch(/^test box: prepare failed \(git fetch: /);
    const inst = prepareFixture({ installs: [{ pkg: 'server', argv: ['false'] }] });
    const b = spawnSync(PREPARE, [inst.spec], { encoding: 'utf8', env: gitEnv() });
    expect([b.status, lastLine(b.stderr)]).toEqual([4, 'test box: install failed (server, exit 1)']);
    const out = prepareFixture({ outputs: ['server/dist'] });
    const c = spawnSync(PREPARE, [out.spec], { encoding: 'utf8', env: gitEnv() });
    expect([c.status, lastLine(c.stderr)]).toEqual([5, 'test box: build failed (server/dist, exit 2)']);
  });

  it('refuses a file that is not a test box spec, and reads no config file and no test box variable', () => {
    const f = path.join(mkTmp('ccrc-tb-prepare-bad-'), 'spec');
    writeFileSync(f, 'not a spec\0');
    const r = spawnSync(PREPARE, [f], { encoding: 'utf8' });
    expect([r.status, r.stderr.trim()]).toEqual([2, `ccrc-testbox-prepare: not a test box spec: ${f}`]);
    expect(read(PREPARE)).not.toMatch(/CCRC_TESTBOX_|ccrc\.env|BOX_ENV_FILE/);
  });
});

describe('egress: the allowlist\'s names into the firewall\'s sets, in one transaction (D-7409, D-7568)', () => {
  const EGRESS = path.join(PKG, 'bin', 'egress');
  it('replaces each row\'s two sets with its names\' addresses; a row with a name that did not resolve is kept as it was, and the unit fails', async () => {
    const b = makeBox(W);
    const names = path.join(b.fx, 'egress');
    writeFileSync(names, 'github\tgithub.com\nnodejs\tnodejs.org\nchrome\tstorage.googleapis.com\n');
    const hosts = b.env.TBS_HOSTS!;
    writeFileSync(path.join(hosts, 'ahostsv4-github.com'), '192.0.2.10      STREAM github.com\n192.0.2.10      DGRAM\n192.0.2.11      STREAM\n');
    writeFileSync(path.join(hosts, 'ahostsv6-github.com'), '2001:db8::10    STREAM github.com\n');
    writeFileSync(path.join(hosts, 'ahostsv4-nodejs.org'), '198.51.100.7    STREAM nodejs.org\n');
    const r = await exec(EGRESS, [names], b.env);
    expect([r.code, r.stderr.trim()]).toEqual([1, 'ccrc-testbox-egress: storage.googleapis.com (chrome) did not resolve; its addresses are kept']);
    const tx = readFileSync(`${b.sysLog}.nft`, 'utf8');
    expect(tx).toBe([
      'flush set inet ccrc_testbox github_v4', 'flush set inet ccrc_testbox github_v6',
      'add element inet ccrc_testbox github_v4 { 192.0.2.10, 192.0.2.11 }', 'add element inet ccrc_testbox github_v6 { 2001:db8::10 }',
      ...['registry', 'release'].flatMap((s) => [`flush set inet ccrc_testbox ${s}_v4`, `flush set inet ccrc_testbox ${s}_v6`]),
      'flush set inet ccrc_testbox nodejs_v4', 'flush set inet ccrc_testbox nodejs_v6', 'add element inet ccrc_testbox nodejs_v4 { 198.51.100.7 }',
      'flush set inet ccrc_testbox osmirror_v4', 'flush set inet ccrc_testbox osmirror_v6', '',
    ].join('\n'));
    expect(lines(b).filter((x) => x.startsWith('nft '))).toEqual(['nft -f -']);
  });

  it('refuses a row that is not in the table, before any nft call', async () => {
    const b = makeBox(W);
    const names = path.join(b.fx, 'egress');
    writeFileSync(names, 'elsewhere\texample.invalid\n');
    const r = await exec(EGRESS, [names], b.env);
    expect([r.code, r.stderr.trim()]).toEqual([2, 'ccrc-testbox-egress: not a row of the egress table: elsewhere']);
    expect(lines(b)).toEqual([]);
  });

  it('its rows are the firewall\'s and the installer\'s', () => {
    const rows = /^ROWS=\(([^)]*)\)$/m.exec(read(EGRESS))?.[1]?.split(' ');
    expect(rows).toEqual(['github', 'registry', 'release', 'nodejs', 'chrome', 'osmirror']);
    for (const r of rows ?? []) expect(read(path.join(PKG, 'install.sh')), r).toContain(`"${r}"$'\\t'`);
  });
});

describe('the counted exits (D-7409)', () => {
  it('system units 8, slices 3, polkit rules 1, EnvironmentFile= lines 0, and the box config file a box reader reads is one', () => {
    const files = existsSync(SYSTEMD) ? readdirSync(SYSTEMD) : [];
    expect(files.filter((f) => /\.(service|timer)$/.test(f)).length).toBe(8);
    expect(files.filter((f) => f.endsWith('.slice')).length).toBe(3);
    expect(existsSync(path.join(PKG, 'polkit')) ? readdirSync(path.join(PKG, 'polkit')).filter((f) => f.endsWith('.rules')) : []).toEqual(['50-ccrc-testbox.rules']);
    const ins = read(path.join(PKG, 'install.sh'));
    expect(ins).toContain('BOXFILE=$(_tb_box_env_file)');
    expect(ins.match(/\/etc\/ccrc-testbox\/ccrc\.env/g) ?? []).toEqual([]);
  });

  it('the MANIFEST the staging fixture carries is the one deploy/build-release.sh would write', () => {
    const t = path.join(mkTmp('ccrc-tb-manifest-'), 'tree');
    cpSync(W.staging, t, { recursive: true });
    const m = readFileSync(path.join(t, 'MANIFEST'), 'utf8');
    writeManifest(t);
    expect(readFileSync(path.join(t, 'MANIFEST'), 'utf8')).toBe(m);
  });
});
