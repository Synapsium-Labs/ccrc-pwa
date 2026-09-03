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
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, linkSync, symlinkSync, chmodSync, readdirSync } from 'node:fs';
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
 *  rather than sourced.
 *
 *  BOTH ANCHORS ARE SENTINEL COMMENTS, deliberately. The first cut of this
 *  helper ended the slice at `_svc_run_detached() {` — one function's NAME —
 *  which meant a helper appended after that function fell outside the
 *  compared region (measured: two divergent copies of a `_svc_new_helper`
 *  left the suite green), and moving that function earlier in the block
 *  silently shrank the region to almost nothing while every assertion still
 *  passed. A sentinel the block itself carries cannot be outgrown, and the
 *  every-definition-inside check below catches the day someone deletes it. */
function platformBlock(src: string): string {
  const start = src.indexOf('# ── THE PLATFORM LAYER');
  const end = src.indexOf('# ── END PLATFORM LAYER');
  expect(start, 'the platform block must be findable by its header').toBeGreaterThan(-1);
  expect(end, 'the block must end at its END sentinel — a file that lost it has an unbounded, uncompared tail').toBeGreaterThan(start);
  return src.slice(start, end);
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

  it('holds every _plat_/_svc_ definition INSIDE the sentinels, in both files', () => {
    // The pin above compares only the sliced region, so it is exactly as
    // strong as the region is complete. This is the check that makes
    // appending a helper below the END sentinel a red suite instead of a
    // quiet gap — and that notices a deleted or relocated sentinel, because
    // the definitions it used to enclose are then "outside".
    for (const [name, src] of [['ccd', ccd], ['ccrc', ccrc]] as const) {
      const start = src.indexOf('# ── THE PLATFORM LAYER');
      const end = src.indexOf('# ── END PLATFORM LAYER');
      expect(end, `${name}: END sentinel missing`).toBeGreaterThan(start);
      for (const m of src.matchAll(/^(?:_plat_|_svc_)[a-z0-9_]+\(\)/gm)) {
        expect(m.index, `${name}: ${m[0]} sits outside the platform-block sentinels`)
          .toBeGreaterThan(start);
        expect(m.index, `${name}: ${m[0]} sits outside the platform-block sentinels`)
          .toBeLessThan(end);
      }
    }
  });
});

describe('no call site outside the platform block runs a GNU-only command bare', () => {
  // THE SWEEP, STANDING. The port was a whole-file sweep against a snapshot
  // of main; anything main adds later merges cleanly with nothing prompting a
  // BSD-compatibility review. Measured on the very first rebase: PR #16's
  // `_gh_pr_checks` landed a bare `timeout` and PR #17's ccrc-api a bare
  // `mktemp`, both silently — three conflict hunks out of ~600 imported
  // lines, and neither of these was in one. This scan is that review as a
  // mechanism: strip comments, cut the platform block itself out of ccd and
  // ccrc (the shims legitimately spell both arms), and refuse the GNU-only
  // spellings the block exists to wrap.
  //
  // `readlink -f` is deliberately NOT in the table: the tree's one live call
  // site (cmd_swap) predates the port on both sides, and macOS ships
  // `readlink -f` from 12.3 — a floor the port accepts rather than shims.
  // `systemctl`/`journalctl` are not here either: the `_svc_` layer and the
  // doctor's remedy STRINGS spell them legitimately, and the doctor's
  // platform-awareness has its own tests.
  const gnuOnly: Array<[string, RegExp]> = [
    // `--timeout 5` in a message must not hit (the lookbehind rejects the
    // preceding dash); `_plat_timeout` must not hit; `-` in the class
    // catches the flag-first form (`timeout -k 2 5 cmd`) that a bare
    // digit-anchored class let through.
    ['bare timeout',    /(?<![-_a-zA-Z])timeout\s+[-"'$0-9]/],
    // A template containing XXXX is the portable spelling (BSD mktemp
    // ignores $TMPDIR without one); only the TEMPLATE-LESS call is refused,
    // and only at command position ($(…, start of line, or after |;&=`).
    ['bare mktemp',     /(?:\$\(|^|[|;&=`])\s*mktemp\b(?![^)\n]*XXXX)/],
    ['GNU/BSD stat',    /(?<![-_a-zA-Z])stat\s+-[cf]/],
    ['GNU du -b',       /(?<![-_a-zA-Z])du\s+-s[cb]/],
    ['sha256sum',       /(?<![-_a-zA-Z])sha256sum\b/],
    ['GNU date %N',     /date\s+\+%s%3N/],
    ['GNU date -d',     /(?<![-_a-zA-Z])date\s+(-u\s+)?(-d|--date)[\s='"]/],
    ['cp --remove-destination', /cp\s+(-[a-zA-Z]+\s+)*--remove-destination/],
    ['mv -T',           /(?<![-_a-zA-Z])mv\s+-[a-zA-Z]*T/],
    ['uuidgen',         /(?<![-_a-zA-Z])uuidgen\b/],
  ];

  /** Executable text only: the platform block cut out (where present) and
   *  WHOLE-LINE comments dropped. Deliberately not a tail strip: a `#` may
   *  sit inside a quoted string (`msg="see PR #11" && timeout 5 …`), and a
   *  tail strip from it discards the real code sharing the line — scanning
   *  LESS text is exactly the direction that hides a freshly imported call
   *  site (this guard's own adversarial review demonstrated it). Trailing
   *  comments therefore stay in the scanned text; the command-position
   *  anchors on the patterns are what keep their prose from matching. */
  function executableText(src: string): string {
    const start = src.indexOf('# ── THE PLATFORM LAYER');
    const end = src.indexOf('# ── END PLATFORM LAYER');
    const body = start >= 0 && end > start ? src.slice(0, start) + src.slice(end) : src;
    return body
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
  }

  const HOOK = 'session-hook.sh';

  /** `session-hook.sh`'s ONE legitimate GNU spelling, cut the way the platform
   *  block is cut out of ccd and ccrc. The hook is installed ALONE into
   *  ~/.cc-sessions with no ccd to source, so it carries a local copy of
   *  `_plat_epoch_ms` named `_hook_epoch_ms` — and that copy legitimately
   *  spells both arms, including the `date +%s%3N` fallback this table
   *  otherwise refuses. It is exempt because it is ALREADY pinned elsewhere:
   *  the body-equality test below ties it byte-for-byte to ccd's
   *  `_plat_epoch_ms`, which lives inside ccd's platform block. Nothing else
   *  in the file is exempt. The cut is a FUNCTION, not a region a later edit
   *  can grow into (pinned below), and a renamed function makes the cut MISS —
   *  which surfaces as a `GNU date %N` hit rather than a silently wider
   *  exemption. */
  const HOOK_EPOCH_COPY = /^_hook_epoch_ms\(\) \{\n[\s\S]*?\n\}\n/m;

  /** THE CORPUS IS THE DIRECTORY, not a hand-kept list of four. It WAS four —
   *  the files the port itself had touched — which quietly made this sweep an
   *  audit of the past instead of a guard over the present. MEASURED
   *  (D-1250): the graphify read-side branch added 91 lines of shell to
   *  `ccd/session-hook.sh`, and five GNU-only spellings planted in them
   *  (`stat -c %Y`, `date +%s%3N`, `sha256sum`, `uuidgen`, a bare `timeout`)
   *  left this file green, because the hook was in no corpus — the hot-path
   *  file whose own header (:12-27) names a BSD `date` answering `…3N` as the
   *  worst way it can fail: jq rejects the non-number, `|| exit 0` swallows
   *  it, THE HOOK WRITES NOTHING, and every session on the box reads as
   *  unsupervised while looking healthy from the inside. Deriving the list
   *  makes the next file added to `ccd/` a decision someone records here
   *  rather than a gap nobody sees. */
  const shebangged = readdirSync(ccdRoot, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((n) => readFileSync(path.join(ccdRoot, n), 'utf8').startsWith('#!'))
    .sort();

  /** The shell ccd/ ships that this sweep does NOT own yet, each named with
   *  what it still spells (measured 2026-09-02). Sitting outside the corpus is
   *  a recorded decision, not an omission: the census below refuses a
   *  shebang'd file that is in neither list, and the ratchet below refuses a
   *  name kept here after its GNU-only calls are gone. */
  const unowned: Record<string, string> = {
    'ccclip': 'a template-less `mktemp -t ccclip`',
    'ccd-graph-sweep': '`stat -c %Y`/`stat -c %s`, `date +%s%3N`, a bare `timeout` and a template-less `mktemp`',
    'ccrc-adopt': 'a template-less `mktemp`',
  };

  /** One file's scanned text: the platform block cut where the file carries
   *  one, and the pinned epoch copy cut out of the hook. */
  function scannedText(name: string): string {
    const src = readFileSync(path.join(ccdRoot, name), 'utf8');
    return executableText(name === HOOK ? src.replace(HOOK_EPOCH_COPY, '') : src);
  }

  function gnuHits(text: string): string[] {
    const hits: string[] = [];
    for (const [label, re] of gnuOnly) {
      for (const line of text.split('\n')) {
        if (re.test(line)) hits.push(`${label}: ${line.trim()}`);
      }
    }
    return hits;
  }

  const corpora = shebangged.filter((n) => !(n in unowned));

  it('the corpus is derived, and still holds every file the port touched', () => {
    // The list generates the `it`s below, so a wrong `ccdRoot` or a broken
    // filter would emit ZERO of them and leave this describe silently green.
    // This is the floor under the derivation: the four the sweep shipped with,
    // plus the hook the derivation was written to catch.
    expect(corpora).toEqual(expect.arrayContaining(
      ['ccd', 'ccrc', 'ccrc-doctor-checks', 'ccrc-api', HOOK]));
    for (const name of Object.keys(unowned)) {
      expect(shebangged, `ccd/${name} is exempted but no longer ships — drop its \`unowned\` entry`)
        .toContain(name);
    }
  });

  for (const name of corpora) {
    it(`ccd/${name} carries no un-shimmed GNU call`, () => {
      const hits = gnuHits(scannedText(name));
      expect(hits, `ccd/${name} runs a GNU-only command outside the platform block — route it through the _plat_ shim (or an explicit template, for a file that cannot source the block)`).toEqual([]);
    });
  }

  for (const [name, spells] of Object.entries(unowned)) {
    it(`ccd/${name} is exempt on the record, and still needs to be`, () => {
      // A ratchet, not a permanent pass. The day this file's GNU-only calls
      // are ported, the exemption is a lie about the tree and the sweep should
      // be scanning the file instead.
      expect(gnuHits(scannedText(name)).length,
        `ccd/${name} no longer spells ${spells} — delete its \`unowned\` entry so the sweep owns the file`)
        .toBeGreaterThan(0);
    });
  }

  it(`ccd/${HOOK}'s exemption is the epoch copy, and nothing else`, () => {
    // The anti-widening half. The cut is what lets the hook into the corpus at
    // all; unbounded, it would be a second way for the file to go unscanned.
    const src = readFileSync(path.join(ccdRoot, HOOK), 'utf8');
    const m = HOOK_EPOCH_COPY.exec(src);
    expect(m, '_hook_epoch_ms must be findable — the exemption is meant to be exact').not.toBeNull();
    const cut = m![0]!;
    expect(cut.match(/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/gm),
      'the exemption must be ONE function, not a region that grew').toEqual(['_hook_epoch_ms() {']);
    expect(gnuHits(executableText(cut)),
      'the exemption buys exactly one spelling: the VALIDATED `date +%s%3N` fallback')
      .toEqual(['GNU date %N: local t; t=$(date +%s%3N 2>/dev/null)']);
    // … and the rest of the file really is scanned: one anchor from the event
    // dispatch, one from the read counter, one from the write.
    const text = scannedText(HOOK);
    for (const anchor of ['case "$event" in', 'GRAPH_QUERY_RE=', 'out=$(jq -cn']) {
      expect(text, `the cut swallowed the hook's body around \`${anchor}\``).toContain(anchor);
    }
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
    ['_plat_mode', /else stat -c%a "\$@"; fi/],
    ['_plat_bytes', /du -sb "\$1" \| head -n1 \| cut -f1/],
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

describe('_plat_epoch_ms — the one capability-branched helper, and its fallback', () => {
  // `_plat_epoch_ms` branches on `${EPOCHREALTIME:-}` rather than on $CCD_OS
  // — the only helper in the block that does — and EPOCHREALTIME is bash 5.0+
  // while the declared floor is 4.4. So the `date +%s%3N` fallback is
  // REACHABLE on a supported box, and on BSD it used to answer `<epoch>3N`:
  // not a number, `jq --argjson` rejects it, and in the session hook the
  // `|| exit 0` swallowed that — no hookstate file, every session on the box
  // reading as unsupervised. The fallback now VALIDATES and degrades to
  // whole seconds ×1000. These run the REAL function body on every platform:
  // `unset EPOCHREALTIME` strips the dynamic builtin for the rest of the
  // shell, exactly as bash 4.x simply not having it.
  const runBlock = (expr: string, env: NodeJS.ProcessEnv = {}): string =>
    execFileSync('bash', ['-c', `${platformBlock(ccd)}\n${expr}\n`], {
      encoding: 'utf8', env: { ...process.env, ...env },
    }).trim();

  it('answers 13 digits through a working GNU date, EPOCHREALTIME unset', () => {
    const out = runBlock('unset EPOCHREALTIME; _plat_epoch_ms');
    expect(out).toMatch(/^[0-9]{13}$/);
  });

  it('a BSD-shaped date (literal 3N) degrades to whole seconds ×1000 — a NUMBER, never the 3N string', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-epoch-'));
    try {
      const bin = path.join(d, 'bin');
      mkdirSync(bin);
      // BSD date: `%N` is not a format — the letter is printed literally.
      writeFileSync(path.join(bin, 'date'), [
        '#!/bin/sh',
        'case "$1" in',
        '  +%s%3N) echo "$(/bin/date +%s)3N" ;;',
        '  +%s) /bin/date +%s ;;',
        '  *) /bin/date "$@" ;;',
        'esac',
      ].join('\n') + '\n', { mode: 0o755 });
      const out = runBlock('unset EPOCHREALTIME; _plat_epoch_ms',
        { PATH: `${bin}:${process.env.PATH}` });
      expect(out).toMatch(/^[0-9]{10}000$/);
      expect(out).not.toContain('N');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('the session hook\'s local copy carries the SAME body — the third copy cannot drift', () => {
    // session-hook.sh is installed alone and sources nothing, so its
    // `_hook_epoch_ms` is a deliberate local copy; this is the pin that
    // makes "deliberate copy" different from "a copy that drifts". The name
    // differs, the body may not.
    const hook = readFileSync(path.join(ccdRoot, 'session-hook.sh'), 'utf8');
    const body = (src: string, name: string): string => {
      const m = new RegExp(`${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)\\n\\}`).exec(src);
      expect(m, `${name} not found`).not.toBeNull();
      return m![1]!;
    };
    expect(body(hook, '_hook_epoch_ms')).toBe(body(ccd, '_plat_epoch_ms'));
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

  it('_plat_mode answers the same twelve bits GNU %a prints — special bits kept, leading zeros shed', () => {
    // The narrowing this pins against: `%Lp` alone is the low NINE bits, so
    // a setuid file answered `755` here and `4755` on Linux — an adapter
    // narrowing a distinction it received. And `%Mp` prints a literal `0`
    // for an ordinary file, which the caller's `= 600` comparison must
    // never see.
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mode-'));
    try {
      const f = path.join(d, 'f');
      writeFileSync(f, 'x');
      chmodSync(f, 0o4755);
      expect(inBlock(`_plat_mode -- '${f}'`), 'the setuid bit was dropped').toBe('4755');
      chmodSync(f, 0o600);
      expect(inBlock(`_plat_mode -- '${f}'`), 'a leading zero survived').toBe('600');
      chmodSync(f, 0o7);
      expect(inBlock(`_plat_mode -- '${f}'`), 'GNU prints bare digits, no padding').toBe('7');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('_plat_bytes counts a hard-linked inode ONCE and a symlink\'s own size — du -sb\'s meaning, not a stat sum', () => {
    // Measured against GNU du 9.4 on the identical fixture: one 10-byte
    // inode wearing two names + a 10-char symlink = 20, directories 0. The
    // first cut summed `-type f` sizes with no inode tracking and answered
    // 30 — every hardlink name counted again, so the ws-gc report's "rows
    // can sum to more than the total" sentence was false on this platform.
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-bytes-'));
    try {
      writeFileSync(path.join(d, 'a'), '0123456789');
      linkSync(path.join(d, 'a'), path.join(d, 'b'));
      symlinkSync('target-str', path.join(d, 'l'));
      mkdirSync(path.join(d, 'sub'));
      expect(inBlock(`_plat_bytes '${d}'`)).toBe('20');
      // The aggregate call dedups ACROSS arguments too — the reason ws-gc
      // passes every worktree in one invocation.
      const d2 = path.join(d, 'sub');
      linkSync(path.join(d, 'a'), path.join(d2, 'c'));
      expect(inBlock(`_plat_bytes '${d}' '${d2}'`),
        'an inode shared between the arguments was counted per name').toBe('20');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
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
