// `ccd/ccrc-node` — the node selection library. Sourced in `bash -c` under a
// FIXTURE HOME with a stub nvm tree, a stub `node` on PATH and a stub
// `systemctl`; the real nvm, node and systemd are never reached.
//
// THE TTY SEAM: the library asks `_node_is_tty` (a one-line `[ -t 0 ]`), and a
// case that needs a terminal redefines that function after sourcing. Chosen over
// `script -qc` because `script`'s flags differ between util-linux and BSD.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkTmp } from './tmpHelpers';

const LIB = path.resolve(__dirname, '../../ccd/ccrc-node');

function exe(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

interface Fx { home: string; nvm: string; bin: string; sysctlLog: string; installLog: string }

/** `versions` are installed under the stub nvm; `def` is the alias target (null = none). */
function fixture(versions: string[], def: string | null, nvm = true): Fx {
  const home = mkTmp('ccrc-node-');
  const nvmDir = path.join(home, '.nvm');
  const bin = path.join(home, 'stubbin');
  const installLog = path.join(home, 'nvm-install.log');
  const sysctlLog = path.join(home, 'systemctl.log');
  mkdirSync(bin, { recursive: true });
  exe(path.join(bin, 'systemctl'), `echo "$@" >> "${sysctlLog}"`);
  if (nvm) {
    mkdirSync(nvmDir, { recursive: true });
    for (const v of versions) mkVersion(nvmDir, v);
    writeFileSync(path.join(home, 'default'), def ?? '');
    writeFileSync(path.join(nvmDir, 'nvm.sh'), `
nvm() {
  case "$1" in
    version) if [ "$2" = default ]; then v=$(cat "${home}/default"); if [ -n "$v" ]; then echo "$v"; else echo N/A; return 3; fi; fi ;;
    install) echo "$@" >> "${installLog}"; [ -e "${home}/install-fails" ] && return 5; mkdir -p "$NVM_DIR/versions/node/v99.0.0/bin"
             for b in node npm npx; do printf '#!/bin/sh\\necho v99.0.0\\n' > "$NVM_DIR/versions/node/v99.0.0/bin/$b"; chmod +x "$NVM_DIR/versions/node/v99.0.0/bin/$b"; done ;;
  esac
}
`);
  }
  return { home, nvm: nvmDir, bin, sysctlLog, installLog };
}

function mkVersion(nvmDir: string, v: string): void {
  for (const b of ['node', 'npm', 'npx']) exe(path.join(nvmDir, 'versions/node', v, 'bin', b), `echo ${v}`);
}

function run(fx: Fx, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', ['-c', `. "${LIB}"; ${script}`], {
    encoding: 'utf8',
    env: { HOME: fx.home, NVM_DIR: fx.nvm, PATH: `${fx.bin}:/usr/bin:/bin`, ...env },
  });
  return { rc: r.status, out: r.stdout.trim(), err: r.stderr };
}

describe('_node_ver_ge', () => {
  const ge = (a: string, b: string) => spawnSync('bash', ['-c', `. "${LIB}"; _node_ver_ge ${a} ${b}`]).status === 0;
  it('compares numerically and accepts a v prefix', () => {
    expect(ge('v22.16.0', '22.16.0')).toBe(true);
    expect(ge('22.15.9', '22.16.0')).toBe(false);
    expect(ge('v9.0.0', '22.16.0')).toBe(false);
    expect(ge('v22.100.0', '22.16.0')).toBe(true);
  });
});

describe('_node_pick', () => {
  const pick = (args: string) => {
    const r = spawnSync('bash', ['-c', `. "${LIB}"; _node_pick ${args}`], { encoding: 'utf8' });
    return { rc: r.status, out: r.stdout.trim() };
  };
  it('prefers a qualifying default', () => {
    expect(pick('22.16.0 v22.17.0 v22.17.0 v24.1.0')).toEqual({ rc: 0, out: 'v22.17.0' });
  });
  it('else the numerically highest qualifying, never lexical', () => {
    expect(pick('22.16.0 v20.0.0 v9.0.0 v22.16.0 v24.1.0 v100.0.0')).toEqual({ rc: 0, out: 'v100.0.0' });
    expect(pick('22.16.0 "" v9.9.9 v22.16.1')).toEqual({ rc: 0, out: 'v22.16.1' });
  });
  it('rc 1 when none qualifies', () => {
    expect(pick('22.16.0 v20.0.0 v9.0.0').rc).toBe(1);
    expect(pick('22.16.0 ""').rc).toBe(1);
  });
});

describe('_node_floor', () => {
  const fx = fixture([], null, false);
  const floor = (json: string) => {
    const f = path.join(fx.home, 'package.json');
    writeFileSync(f, json);
    return run(fx, `_node_floor "${f}"; echo "rc=$? floor=$NODE_FLOOR why=$NODE_WHY"`);
  };
  it('reads a multi-line engines block without node', () => {
    expect(floor('{\n  "name": "x",\n  "engines": {\n    "node": ">=22.16.0"\n  }\n}').out).toBe('rc=0 floor=22.16.0 why=');
  });
  it('ignores a "node" key outside engines', () => {
    expect(floor('{"dependencies":{"node":">=1.0.0"},"engines":{"node":">=22.16.0"}}').out).toContain('floor=22.16.0');
    expect(floor('{"dependencies":{"node":">=1.0.0"}}').out).toMatch(/^rc=1 floor= why=\S/);
  });
  it('rc 1 with a reason for malformed, absent and unreadable', () => {
    for (const j of ['{"engines":{"node":"^22"}}', '{"engines":{"node":">=22.16.0 <25"}}', '{"engines":{}}']) {
      expect(floor(j).out, j).toMatch(/^rc=1 floor= why=.+/);
    }
    expect(run(fx, '_node_floor /nonexistent/p.json; echo "rc=$? $NODE_WHY"').out).toMatch(/^rc=1 .+/);
  });
});

describe('_node_select under nvm', () => {
  const sel = (fx: Fx, extra = ':', env: Record<string, string> = {}) =>
    run(fx, `${extra}; _node_select 22.16.0; echo "rc=$? ver=$NODE_VERSION dir=$NODE_BIN_DIR why=$NODE_WHY"; command -v node`, env);

  it('chooses the default when it qualifies', () => {
    const fx = fixture(['v22.16.0', 'v24.1.0'], 'v22.16.0');
    const r = sel(fx);
    expect(r.out).toContain(`rc=0 ver=v22.16.0 dir=${fx.nvm}/versions/node/v22.16.0/bin`);
    expect(r.out.split('\n')[1]).toBe(`${fx.nvm}/versions/node/v22.16.0/bin/node`);
  });
  it('default below the floor: the newest qualifying, alias untouched', () => {
    const fx = fixture(['v20.1.0', 'v22.16.0', 'v22.100.0', 'v9.0.0'], 'v20.1.0');
    expect(sel(fx).out).toContain('rc=0 ver=v22.100.0');
    expect(readFileSync(path.join(fx.home, 'default'), 'utf8')).toBe('v20.1.0');
  });
  it('none qualifies + TTY: installs once, re-picks, alias untouched', () => {
    const fx = fixture(['v20.1.0'], 'v20.1.0');
    const r = sel(fx, '_node_is_tty() { return 0; }');
    expect(r.out).toContain('rc=0 ver=v99.0.0');
    expect(readFileSync(fx.installLog, 'utf8').trim().split('\n')).toEqual(['install --lts']);
    expect(readFileSync(path.join(fx.home, 'default'), 'utf8')).toBe('v20.1.0');
  });
  it('none qualifies + no TTY: rc 1, no install, says interactive ccrc install', () => {
    const fx = fixture(['v20.1.0'], null);
    const r = sel(fx, '_node_is_tty() { return 1; }');
    expect(r.out).toMatch(/rc=1 ver= dir= why=.*floor.*interactive/s);
    expect(existsSync(fx.installLog)).toBe(false);
  });
  it('NODE_NO_INSTALL=1 never installs, even with a TTY', () => {
    const fx = fixture(['v20.1.0'], null);
    const r = sel(fx, '_node_is_tty() { return 0; }', { NODE_NO_INSTALL: '1' });
    expect(r.out).toContain('rc=1');
    expect(existsSync(fx.installLog)).toBe(false);
  });
  it('does not exit, change shell options, or leak locals', () => {
    const fx = fixture(['v22.16.0'], 'v22.16.0');
    const r = run(fx, `set +e; before=$(set +o | md5sum); vars=$(compgen -v | sort | md5sum); _node_select 22.16.0; after=$(set +o | md5sum); [ "$before" = "$after" ] && echo same; compgen -v | grep -E '^(v|vers|dir|best|list|d)$'; echo alive`);
    expect(r.out).toBe('same\nalive');
  });
});

describe('_node_select: nvm present, but a qualifying PATH node is the second choice', () => {
  const sel = (fx: Fx, extra = ':', env: Record<string, string> = {}) =>
    run(fx, `${extra}; _node_select 22.16.0; echo "rc=$? ver=$NODE_VERSION dir=$NODE_BIN_DIR why=$NODE_WHY"`, env);
  const pathNode = (fx: Fx, v: string) => { for (const b of ['node', 'npm', 'npx']) exe(path.join(fx.bin, b), `echo ${v}`); };
  it('no nvm versions + qualifying PATH node, unattended: the PATH dir, no install', () => {
    const fx = fixture([], null);
    pathNode(fx, 'v22.20.0');
    expect(sel(fx, '_node_is_tty() { return 1; }').out).toBe(`rc=0 ver=v22.20.0 dir=${fx.bin} why=`);
    expect(existsSync(fx.installLog)).toBe(false);
  });
  it('only below-floor versions + below-floor PATH node + TTY: installs', () => {
    const fx = fixture(['v20.1.0'], 'v20.1.0');
    pathNode(fx, 'v20.0.0');
    expect(sel(fx, '_node_is_tty() { return 0; }').out).toContain('rc=0 ver=v99.0.0');
    expect(readFileSync(fx.installLog, 'utf8').trim()).toBe('install --lts');
  });
  it('same with NODE_NO_INSTALL=1: refuses, naming the nvm versions and the PATH node', () => {
    const fx = fixture(['v20.1.0'], 'v20.1.0');
    pathNode(fx, 'v20.0.0');
    const o = sel(fx, '_node_is_tty() { return 0; }', { NODE_NO_INSTALL: '1' }).out;
    expect(o).toMatch(/rc=1 ver= dir= why=.*NODE_NO_INSTALL.*the node on PATH: node v20\.0\.0 .*below the floor/);
    expect(existsSync(fx.installLog)).toBe(false);
  });
});

describe('_node_select without nvm', () => {
  it('uses the directory of the PATH node as found, never resolving a shim', () => {
    const fx = fixture([], null, false);
    const real = path.join(fx.home, 'opt/real/bin');
    exe(path.join(real, 'node'), 'echo v22.20.0');
    for (const b of ['npm', 'npx']) exe(path.join(real, b), 'true');
    symlinkSync(path.join(real, 'node'), path.join(fx.bin, 'node'));
    for (const b of ['npm', 'npx']) exe(path.join(fx.bin, b), 'true');
    const r = run(fx, '_node_select 22.16.0; echo "rc=$? ver=$NODE_VERSION dir=$NODE_BIN_DIR"');
    expect(r.out).toBe(`rc=0 ver=v22.20.0 dir=${fx.bin}`);
  });
  it('rc 1 when the PATH node is below the floor', () => {
    const fx = fixture([], null, false);
    exe(path.join(fx.bin, 'node'), 'echo v20.0.0');
    expect(run(fx, '_node_select 22.16.0; echo "rc=$? why=$NODE_WHY"').out).toMatch(/^rc=1 why=.+/);
  });
  it('rc 1 when there is no node at all', () => {
    const fx = fixture([], null, false);
    expect(run(fx, '_node_select 22.16.0; echo "rc=$? why=$NODE_WHY"').out).toMatch(/^rc=1 why=.+/);
  });
});

describe('_node_publish', () => {
  const publish = (fx: Fx, dir: string) => run(fx, `NODE_BIN_DIR="${dir}"; _node_publish; echo "rc=$?"`);
  const links = (fx: Fx) => path.join(fx.home, '.local/libexec/ccrc/node-bin');
  const frag = (fx: Fx) => path.join(fx.home, '.config/environment.d/50-ccrc-node.conf');

  it('publishes three links, the fragment and a reload; idempotent; re-points', () => {
    const fx = fixture(['v22.16.0', 'v24.1.0'], null);
    const a = path.join(fx.nvm, 'versions/node/v22.16.0/bin');
    const b = path.join(fx.nvm, 'versions/node/v24.1.0/bin');
    expect(publish(fx, a).out).toBe('rc=0');
    for (const n of ['node', 'npm', 'npx']) expect(readlinkSync(path.join(links(fx), n))).toBe(path.join(a, n));
    const text = readFileSync(frag(fx), 'utf8');
    expect(text).toMatch(/^#.*ccrc/m);
    expect(text).toContain(`PATH=${links(fx)}:\${PATH}\n`);
    expect(lstatSync(frag(fx)).mode & 0o777).toBe(0o644);
    expect(readFileSync(fx.sysctlLog, 'utf8')).toContain('--user daemon-reload');
    publish(fx, a);
    publish(fx, b);
    expect(readlinkSync(path.join(links(fx), 'node'))).toBe(path.join(b, 'node'));
    const ls = spawnSync('ls', ['-A', links(fx), path.dirname(frag(fx))], { encoding: 'utf8' }).stdout;
    expect(ls).not.toMatch(/\.tmp\./);
  });
  it('re-points each link by rename of a temp link, never in place', () => {
    const fx = fixture(['v22.16.0'], null);
    const log = path.join(fx.home, 'mv.log');
    exe(path.join(fx.bin, 'mv'), `echo "$@" >> "${log}"; exec /bin/mv "$@"`);
    publish(fx, path.join(fx.nvm, 'versions/node/v22.16.0/bin'));
    const calls = readFileSync(log, 'utf8');
    for (const n of ['node', 'npm', 'npx']) expect(calls).toMatch(new RegExp(`${n}\\.tmp\\.\\d+ \\S*node-bin/${n}\\n`));
  });
  it('a box with no user manager: files written, no reload, rc 0', () => {
    const fx = fixture(['v22.16.0'], null);
    exe(path.join(fx.bin, 'systemctl'), `echo "$@" >> "${fx.sysctlLog}"; [ "$2" = show-environment ] && exit 1; exit 0`);
    const r = publish(fx, path.join(fx.nvm, 'versions/node/v22.16.0/bin'));
    expect(r.out).toBe('rc=0');
    expect(existsSync(frag(fx))).toBe(true);
    expect(readFileSync(fx.sysctlLog, 'utf8')).not.toContain('daemon-reload');
  });
  it('darwin: publishes nothing, rc 0', () => {
    const fx = fixture(['v22.16.0'], null);
    exe(path.join(fx.bin, 'uname'), 'echo Darwin');
    const r = publish(fx, path.join(fx.nvm, 'versions/node/v22.16.0/bin'));
    expect(r.out).toBe('rc=0');
    expect(existsSync(links(fx))).toBe(false);
    expect(existsSync(frag(fx))).toBe(false);
  });
});

describe('_node_select: distinct refusals', () => {
  const sel = (fx: Fx, extra = ':', env: Record<string, string> = {}) =>
    run(fx, `${extra}; _node_select 22.16.0; echo "rc=$? why=$NODE_WHY"`, env);
  it('a failed interactive install says so, with its rc', () => {
    const fx = fixture(['v20.1.0'], null);
    writeFileSync(path.join(fx.home, 'install-fails'), '');
    expect(sel(fx, '_node_is_tty() { return 0; }').out).toMatch(/rc=1 why=.*nvm install --lts failed \(rc 5\)/);
  });
  it('NODE_NO_INSTALL names itself, not "not interactive"', () => {
    const fx = fixture(['v20.1.0'], null);
    const o = sel(fx, '_node_is_tty() { return 0; }', { NODE_NO_INSTALL: '1' }).out;
    expect(o).toMatch(/NODE_NO_INSTALL/);
    expect(sel(fixture(['v20.1.0'], null), '_node_is_tty() { return 1; }').out).not.toMatch(/NODE_NO_INSTALL/);
  });
  it('an nvm.sh that fails to source is not "no node meets the floor"', () => {
    const fx = fixture(['v22.16.0'], null);
    writeFileSync(path.join(fx.nvm, 'nvm.sh'), 'return 1\n');
    const o = sel(fx).out;
    expect(o).toMatch(/rc=1 why=.*nvm\.sh/);
    expect(o).not.toMatch(/meets the floor/);
  });
  it('an unreadable versions directory is its own refusal', () => {
    const fx = fixture(['v22.16.0'], null);
    const d = path.join(fx.nvm, 'versions/node');
    chmodSync(d, 0o000);
    try {
      const o = sel(fx).out;
      expect(o).toMatch(/rc=1 why=.*not readable/);
      expect(o).not.toMatch(/meets the floor/);
    } finally { chmodSync(d, 0o755); }
  });
  it('npm or npx missing beside node: that version is skipped, and named when none is left', () => {
    const fx = fixture(['v22.16.0'], 'v22.16.0');
    exe(path.join(fx.nvm, 'versions/node/v24.0.0/bin/node'), 'echo v24.0.0');
    expect(sel(fx).out).toBe('rc=0 why=');
    const fx2 = fixture([], null);
    exe(path.join(fx2.nvm, 'versions/node/v24.0.0/bin/node'), 'echo v24.0.0');
    expect(sel(fx2).out).toMatch(/rc=1 why=.*npm.*v24\.0\.0/);
  });
  it('no-nvm: npm missing next to node is named', () => {
    const fx = fixture([], null, false);
    exe(path.join(fx.bin, 'node'), 'echo v22.20.0');
    expect(sel(fx).out).toMatch(/rc=1 why=.*npm/);
  });
  it('a node that prints no version is its own refusal', () => {
    const fx = fixture([], null, false);
    for (const b of ['node', 'npm', 'npx']) exe(path.join(fx.bin, b), 'echo not-a-version');
    const o = sel(fx).out;
    expect(o).toMatch(/rc=1 why=.*not a version/);
    expect(o).not.toMatch(/below the floor/);
  });
});

describe('errexit safety: a caller under set -euo pipefail calls bare', () => {
  const strict = (fx: Fx, body: string) =>
    run(fx, `set -euo pipefail; _node_is_tty() { return 1; }; ${body}; echo survived`);
  it('no default alias (nvm answers N/A and fails): bare select survives and picks', () => {
    const fx = fixture(['v22.16.0'], null);
    expect(strict(fx, '_node_select 22.16.0; echo "ver=$NODE_VERSION"').out).toBe('ver=v22.16.0\nsurvived');
  });
  it('a broken last version dir and an empty versions dir: bare select survives', () => {
    const fx = fixture(['v22.16.0'], 'v22.16.0');
    mkdirSync(path.join(fx.nvm, 'versions/node/v99.9.9'), { recursive: true });
    expect(strict(fx, '_node_select 22.16.0; echo "ver=$NODE_VERSION"').out).toBe('ver=v22.16.0\nsurvived');
    const fx2 = fixture([], null);
    mkdirSync(path.join(fx2.nvm, 'versions/node'), { recursive: true });
    expect(strict(fx2, 'rc=0; _node_select 22.16.0 || rc=$?; echo "rc=$rc"').out).toBe('rc=1\nsurvived');
  });
  it('no user manager: bare publish survives with rc 0', () => {
    const fx = fixture(['v22.16.0'], null);
    exe(path.join(fx.bin, 'systemctl'), 'exit 1');
    expect(strict(fx, `NODE_BIN_DIR="${fx.nvm}/versions/node/v22.16.0/bin"; _node_publish; echo "why=$NODE_WHY"`).out).toMatch(/^why=.+\nsurvived$/);
  });
  it('bare floor read of a good file survives; a bad one is caught by || rc=$?', () => {
    const fx = fixture([], null, false);
    const f = path.join(fx.home, 'package.json');
    writeFileSync(f, '{"engines":{"node":">=22.16.0"}}');
    expect(strict(fx, `_node_floor "${f}"; echo "$NODE_FLOOR"`).out).toBe('22.16.0\nsurvived');
    writeFileSync(f, '{}');
    expect(strict(fx, `rc=0; _node_floor "${f}" || rc=$?; echo "rc=$rc"`).out).toBe('rc=1\nsurvived');
  });
});
