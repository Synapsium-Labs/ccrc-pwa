// The macOS port's own contract.
//
// ccd and ccrc were written against GNU/Linux and systemd. This file pins the
// three properties that make a second platform safe to add, and it is
// deliberately split into checks that run EVERYWHERE and checks that need a
// real Darwin userland underneath them:
//
//   • the Linux arms are unchanged — the port is not allowed to rewrite the
//     platform both production fleet boxes run on, and "unchanged" is a claim
//     a test can hold rather than a promise a comment makes;
//   • the two copies of the platform block stay identical, because ccd must
//     stay self-contained (it is installed as a COPY on PATH, where a sourced
//     sibling would not be there) and a drifting copy is the failure mode that
//     shape invites;
//   • the policy systemd enforces declaratively and launchd cannot — the start
//     limit — is the SAME policy on both, read from the unit file rather than
//     restated here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js';

const IS_DARWIN = process.platform === 'darwin';
const ccdRoot = path.dirname(CCD);
const ccd = readFileSync(CCD, 'utf8');
const ccrc = readFileSync(path.join(ccdRoot, 'ccrc'), 'utf8');
const unitFile = readFileSync(path.join(ccdRoot, 'claude-session@.service'), 'utf8');

/** The shared block, sliced out of a file by its two anchors. Both files
 *  carry it verbatim; see the block's own header for why it is duplicated
 *  rather than sourced. */
function platformBlock(src: string): string {
  const start = src.indexOf('# ── THE PLATFORM LAYER');
  const end = src.indexOf('_svc_run_detached() {');
  expect(start, 'the platform block must be findable by its header').toBeGreaterThan(-1);
  expect(end, 'the block must end at its last function').toBeGreaterThan(start);
  // To the end of that last function, not just to its opening line.
  const close = src.indexOf('\n}\n', end);
  return src.slice(start, close + 3);
}

describe('the platform block is one definition, spelled in two files', () => {
  it('is byte-identical in ccd and ccrc', () => {
    // ccd is installed as a COPY into ~/.local/bin (see `_inst_bins`, which
    // explains why it is a copy and ccrc is a launcher), so it cannot source a
    // sibling: on a box whose tree has moved, a sourced ccd would stop
    // working where today it keeps running. Two copies plus this test is the
    // same trade `_inst_shim` and deploy.sh already make for the launcher's
    // bytes.
    expect(platformBlock(ccd)).toBe(platformBlock(ccrc));
  });

  it('spells the registry path identically to ccd\'s own $REG', () => {
    // `_SVC_REG` exists so the block is self-contained. It is the same
    // directory ccd calls $REG, and a drift between them would point the
    // `failed` stamp at a directory nothing else reads.
    expect(ccd).toMatch(/^_SVC_REG="\$HOME\/\.cc-sessions"$/m);
    expect(ccd).toMatch(/^REG="\$HOME\/\.cc-sessions"$/m);
  });
});

describe('the Linux arms are the original GNU commands', () => {
  // THE POINT OF THIS BLOCK. Every one of these ran as a bare command at a
  // call site before the port; each must still run as that exact command when
  // `uname` says Linux, or the port has changed the platform it was not asked
  // to touch.
  const arms: Array<[string, RegExp]> = [
    ['_plat_mv_notdir', /else\s*\n\s*mv -fT -- "\$1" "\$2"/],
    ['_plat_mtime', /else stat -c %Y "\$@"; fi/],
    ['_plat_size', /else stat -c %s "\$@"; fi/],
    ['_plat_devino', /else stat -c '%d:%i' "\$@"; fi/],
    ['_plat_sha256', /else sha256sum "\$@"; fi/],
    ['_plat_sha256_check', /else sha256sum -c "\$@"; fi/],
    ['_plat_uuid', /else cat \/proc\/sys\/kernel\/random\/uuid; fi/],
    ['_plat_ppid', /sed -n 's\/\^PPid:\[\[:space:\]\]\*\/\/p' "\/proc\/\$\{1-\}\/status"/],
    ['_plat_cgroup', /sed -n 's\/\^0::\/\/p' "\/proc\/\$\$\/cgroup"/],
    ['_svc_run_detached', /systemd-run --user --collect --quiet "\$@"/],
  ];
  for (const [name, re] of arms) {
    it(`${name} still runs the GNU command on Linux`, () => {
      expect(ccd, `${name}'s Linux arm changed`).toMatch(re);
    });
  }

  it('every _svc_ verb reaches systemctl unchanged when not on Darwin', () => {
    // Read as a set rather than one-by-one: the property is that no verb
    // silently lost its systemd call, and a list is how a NEW verb added
    // without one gets noticed.
    const verbs = [
      'systemctl --user enable --now "$1"',
      'systemctl --user enable "$1"',
      'systemctl --user disable --now "$1"',
      'systemctl --user start "$1"',
      'systemctl --user stop "$1"',
      'systemctl --user restart "$1"',
      'systemctl --user try-restart "$1"',
      'systemctl --user is-active "$1"',
      'systemctl --user reset-failed "$1"',
    ];
    for (const v of verbs) expect(ccd, `missing Linux arm: ${v}`).toContain(v);
  });
});

describe('the start limit is one policy, not two', () => {
  it('ccd\'s Darwin constants equal the unit file systemd enforces', () => {
    // launchd has no start limit, so `cmd_supervise` counts its own starts.
    // That emulation is only correct while it agrees with the declaration on
    // the platform that does enforce it — otherwise one fault leaves a
    // session `failed` on Linux and looping on macOS.
    const burst = /^StartLimitBurst=(\d+)$/m.exec(unitFile)?.[1];
    const interval = /^StartLimitIntervalSec=(\d+)$/m.exec(unitFile)?.[1];
    expect(burst, 'the unit must declare StartLimitBurst').toBeDefined();
    expect(interval, 'the unit must declare StartLimitIntervalSec').toBeDefined();
    expect(ccd).toMatch(new RegExp(`^SUPERVISE_START_LIMIT_BURST=${burst}\\b`, 'm'));
    expect(ccd).toMatch(new RegExp(`^SUPERVISE_START_LIMIT_S=${interval}\\b`, 'm'));
  });

  it('KillMode=process has a launchd counterpart in the session plist', () => {
    // The tmux server is the durable substrate: it MUST survive a supervisor
    // restart. `KillMode=process` says so on Linux; `AbandonProcessGroup` is
    // the only key that says it on macOS, and without it a restart of one
    // supervisor takes every pane in its group with it.
    expect(unitFile).toMatch(/^KillMode=process$/m);
    expect(ccd).toContain('<key>AbandonProcessGroup</key><true/>');
  });
});

// ── Everything below needs a real Darwin userland ────────────────────────
describe.skipIf(!IS_DARWIN)('the Darwin arms, run for real', () => {
  /** Source just the platform block into a bash and run one expression
   *  against it. Uses the repo's own bytes, not a copy. */
  function inBlock(expr: string, env: NodeJS.ProcessEnv = {}): string {
    const block = platformBlock(ccd);
    const script = `${block}\n${expr}\n`;
    return execFileSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    }).trim();
  }

  it('detects the platform as darwin', () => {
    expect(inBlock('echo "$CCD_OS"')).toBe('darwin');
  });

  it('maps a session unit to its launchd label and plist path', () => {
    expect(inBlock('_svc_label claude-session@proj-slug.service'))
      .toBe('app.ccrc.session.proj-slug');
    expect(inBlock('_svc_label ccrc.service')).toBe('app.ccrc.ccrc');
    expect(inBlock('HOME=/tmp/h _svc_plist claude-session@x.service'))
      .toBe('/tmp/h/Library/LaunchAgents/app.ccrc.session.x.plist');
  });

  it('_plat_mv_notdir REFUSES a directory destination, as GNU mv -T does', () => {
    // The refusal is load-bearing: `ccd-hold.test.ts` stands in for an
    // unwritable registry with a DIRECTORY at the destination, and a plain
    // `mv -f` would move the tmp inside it and report success.
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-'));
    try {
      writeFileSync(path.join(d, 'src'), 'x');
      mkdirSync(path.join(d, 'dst'));
      const rc = inBlock(`_plat_mv_notdir '${d}/src' '${d}/dst'; echo $?`);
      expect(rc, 'a directory destination must be refused').toBe('1');
      const ok = inBlock(`_plat_mv_notdir '${d}/src' '${d}/plain'; echo $?`);
      expect(ok, 'an ordinary rename must still succeed').toBe('0');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('_plat_uuid answers lowercase, like /proc does', () => {
    // The uuid is a session's identity — it lands in the registry, in
    // --session-id and in the transcript filename a swap searches BY. uuidgen
    // emits uppercase; two spellings of one uuid is a swap that finds nothing.
    const u = inBlock('_plat_uuid');
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('_plat_sha256 agrees with the digest sha256sum would have printed', () => {
    expect(inBlock("printf hi | _plat_sha256 | cut -d' ' -f1"))
      .toBe('8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4');
  });

  it('writes a session plist that plutil accepts and launchd would understand', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-plist-'));
    try {
      inBlock('_svc_write_session_plist claude-session@demo.service', { HOME: home });
      const p = path.join(home, 'Library/LaunchAgents/app.ccrc.session.demo.plist');
      execFileSync('plutil', ['-lint', p]);          // throws if malformed
      const body = readFileSync(p, 'utf8');
      expect(body).toContain('<string>app.ccrc.session.demo</string>');
      expect(body).toContain('<string>supervise</string>');
      expect(body).toContain('<key>KeepAlive</key><true/>');
      expect(body).toContain('<key>AbandonProcessGroup</key><true/>');
      // PATH is carried explicitly: a LaunchAgent inherits launchd's minimal
      // PATH, which holds neither Homebrew's bash nor tmux.
      expect(body).toMatch(/<key>PATH<\/key>/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('REFUSES to drive the real launchd from a sandbox HOME', () => {
    // MEASURED, NOT THEORISED: the first full run of this port's suite left
    // five live jobs registered in the developer's own gui/<uid> domain, with
    // their plists already deleted along with the temp homes that wrote them.
    // launchctl ignores $HOME — its domain is keyed on the UID — so every
    // other isolation this suite relies on does not apply to it.
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-guard-'));
    try {
      const rc = inBlock('_svc_launchctl print gui/$(id -u) >/dev/null 2>&1; echo $?',
        { HOME: home });
      expect(rc, 'a sandbox HOME must not reach the system launchctl').toBe('1');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('lets a STUBBED launchctl through, so a harness keeps control', () => {
    // The escape hatch is PATH, exactly as it is for systemctl on Linux: a
    // test that plants its own launchctl gets to observe every call.
    const home = mkdtempSync(path.join(tmpdir(), 'ccrc-stub-'));
    try {
      const bin = path.join(home, 'bin');
      mkdirSync(bin, { recursive: true });
      const stub = path.join(bin, 'launchctl');
      writeFileSync(stub, '#!/bin/sh\necho "STUB $*"\n', { mode: 0o755 });
      const out = inBlock('_svc_launchctl print gui/1',
        { HOME: home, PATH: `${bin}:${process.env.PATH}` });
      expect(out).toBe('STUB print gui/1');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
