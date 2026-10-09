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
//   • the two copies of the platform block stay identical, because the
//     generated Bash BODY (`ccd/ccd`, which the installed launcher starts from
//     `~/.local/libexec/ccrc/ccd`) must stay self-contained — it is installed as
//     a COPY, where a sourced sibling would not be there — and a drifting copy is
//     the failure mode that shape invites. The Python launcher template
//     (`ccd/ccd-entry.py`) is NOT a third copy: it carries none of the block, and
//     a test below holds that rather than a comment;
//   • the policy systemd enforces declaratively and launchd cannot — the start
//     limit — is the SAME policy on both, read from the unit file rather than
//     restated here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process'; import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, linkSync, symlinkSync, chmodSync, readdirSync, lstatSync, existsSync, readlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CCD } from './ccdWsHelpers.js'; import { mkTmp } from './tmpHelpers.js';
import { itLinux } from './platformFixtures.js';

const IS_DARWIN = process.platform === 'darwin';
const ccdRoot = path.dirname(CCD);
const ccd = readFileSync(CCD, 'utf8');
const ccrc = readFileSync(path.join(ccdRoot, 'ccrc'), 'utf8');
/** The launcher TEMPLATE — rendered into `~/.local/bin/ccd` on the box. Python,
 *  not Bash: the platform block is Bash and has no business here. */
const ccdEntry = readFileSync(path.join(ccdRoot, 'ccd-entry.py'), 'utf8');
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
    // `ccd` here is the generated Bash BODY, `ccd/ccd`. It is installed as a
    // COPY (to `~/.local/libexec/ccrc/ccd`, behind the rendered launcher in
    // `~/.local/bin/ccd`), so it cannot source a sibling: on a box whose tree
    // has moved, a sourced body would stop working where today it keeps
    // running. Two copies plus this test is the same trade `_inst_shim` and
    // deploy.sh already make for the launcher's bytes.
    expect(platformBlock(ccd)).toBe(platformBlock(ccrc));
  });

  it('is NOT duplicated into the Python launcher template — two copies, not three', () => {
    // The launcher decides the protected argv shapes before Bash exists and
    // then starts the body; it needs no platform shim, and a Python file holding
    // a third spelling of a Bash block would be a copy nothing above compares.
    // Measured three ways, so deleting any one reds a different one: neither
    // sentinel is present; no `_plat_`/`_svc_` DEFINITION line is present; and
    // none of the NAMES the block defines (derived from the block, not listed
    // here) appears in the launcher's code — its comments may talk about them.
    expect(ccdEntry, 'the launcher carries the block\'s opening sentinel').not.toContain('# ── THE PLATFORM LAYER');
    expect(ccdEntry, 'the launcher carries the block\'s closing sentinel').not.toContain('# ── END PLATFORM LAYER');
    expect(ccdEntry.match(/^(?:_plat_|_svc_)[a-z0-9_]+\(\)/gm) ?? [], 'the launcher defines a platform helper').toEqual([]);
    const names = [...platformBlock(ccd).matchAll(/^((?:_plat_|_svc_)[a-z0-9_]+)\(\)/gm)].map((m) => m[1]!);
    expect(names.length, 'the block defines no helper — the derivation above went blind').toBeGreaterThan(5);
    const code = ccdEntry.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    for (const name of names) {
      expect(code, `the launcher's code mentions ${name}, a platform-block helper`).not.toContain(name);
    }
  });

  it('spells the registry path identically to ccd\'s own $REG', () => {
    // `_SVC_REG` exists so the block is self-contained. It is the same
    // directory ccd calls $REG, and a drift between them would point the
    // `failed` stamp at a directory nothing else reads.
    expect(ccd).toMatch(/^_SVC_REG="\$HOME\/\.cc-sessions"$/m);
    expect(ccd).toMatch(/^REG="\$HOME\/\.cc-sessions"$/m);
  });

  // NO EXEMPTION SET, and that is the point (controller ruling S3-R1). Routing
  // slice 3 briefly shipped `_svc_gate` — the serviceability keep-or-take gate
  // — outside the sentinels, and paid for it with a name-only entry here. An
  // exemption set is a hole the width of whatever is in it: the guard exists
  // to make a genuine platform helper appended below the END sentinel a red
  // suite, and every name it is told to ignore is one that cannot red. The
  // helper was renamed `_class_gate` instead, which is what it is named for
  // anyway — the CLASS it gates, not launchd/systemd's "service".

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
  // `readlink -f` is deliberately NOT in the table: its live call sites (ccd's
  // cmd_swap, which predates the port, and ccrc's own `_mem_apply`, the
  // graphify-engine reads, `_inst_graph_always_on_off` and — since versioned
  // installs — `_ver_running_names`, the GC's running-unit check, where an
  // empty answer is read as unmeasured) all run on a macOS that ships
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
    // The telemetry keepalive (spec 2026-09-07 §C). Linux-only by PRODUCT
    // shape as well as userland — its timer never installs on the Darwin arm,
    // the same carve-out the sweep has — and its two GNU spellings are both
    // load-bearing rather than incidental: the turn's deadline has no
    // `--max-time` to borrow the way `ccd-account-health` borrows curl's, and
    // the per-account `duration_ms` the census reports is milliseconds. The
    // file's own PORTABILITY header names this entry, so the exemption is
    // written down on both sides rather than only here.
    'ccd-telemetry-keepalive': 'a bare `timeout` and `date +%s%3N`',
    'ccrc-adopt': 'a template-less `mktemp`',
  };

  /** `ccd`'s ONE legitimate GNU spelling outside the platform block: the temp-root
   *  collector's rename, `_ws_collect_mv` (its COLLECT region), `mv -T -n
   *  --no-copy` — one renameat2(RENAME_NOREPLACE) that never falls back to a copy
   *  (spec 2026-09-22 §5.10). It stays out of the platform block by design (that
   *  block is byte-identical in `ccd` and `ccrc`, and the rename is the collector's
   *  alone), and it is LINUX-ONLY by construction: the function's first line
   *  answers 2 on Darwin before `mv` is reached. Cut exactly as the hook's epoch
   *  copy is — ONE function, pinned below — so a renamed function makes the cut
   *  MISS, which surfaces as an `mv -T` hit, never a silently wider exemption. */
  const COLLECT_MV = /^_ws_collect_mv\(\) \{[^\n]*\n[\s\S]*?\n\}\n/m;

  /** One file's scanned text: the platform block cut where the file carries
   *  one, the pinned epoch copy cut out of the hook, and the pinned rename cut
   *  out of ccd. */
  function scannedText(name: string): string {
    const src = readFileSync(path.join(ccdRoot, name), 'utf8');
    if (name === HOOK) return executableText(src.replace(HOOK_EPOCH_COPY, ''));
    return executableText(name === 'ccd' ? src.replace(COLLECT_MV, '') : src);
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

  it('ccd/ccd’s exemption is the collector’s rename, and nothing else', () => {
    // The anti-widening half, as the hook's: ONE function, ONE spelling, and
    // its first executable line refuses Darwin before `mv` is reached.
    const src = readFileSync(path.join(ccdRoot, 'ccd'), 'utf8');
    const m = COLLECT_MV.exec(src);
    expect(m, '_ws_collect_mv must be findable — the exemption is meant to be exact').not.toBeNull();
    const cut = m![0]!;
    expect(cut.match(/^[A-Za-z_][A-Za-z0-9_]*\(\) \{/gm),
      'the exemption must be ONE function, not a region that grew').toEqual(['_ws_collect_mv() {']);
    expect(gnuHits(executableText(cut)), 'the exemption buys exactly one spelling: the no-copy rename')
      .toEqual(['mv -T: mv -T -n --no-copy -- "$1" "$2"']);
    expect(executableText(cut).split('\n')[1]?.trim(), 'its first line refuses Darwin')
      .toBe('[[ "$CCD_OS" != darwin ]] || return 2');
    // … and the rest of ccd really is scanned: the cut ends at the function.
    const text = scannedText('ccd');
    for (const anchor of ['_ws_collect_mv_ok() {', '_ws_collect_move() {']) {
      expect(text, `the cut swallowed ccd around \`${anchor}\``).toContain(anchor);
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
    ['_plat_ln_swap', /else\s*\n\s*mv -fT -- "\$2\.new" "\$2"/],
    ['_plat_mtime', /else stat -c %Y "\$@"; fi/],
    ['_plat_size', /else stat -c %s "\$@"; fi/],
    ['_plat_devino', /else stat -c '%d:%i' "\$@"; fi/],
    ['_plat_sha256', /else sha256sum "\$@"; fi/],
    ['_plat_sha256_check', /else sha256sum -c "\$@"; fi/],
    ['_plat_uuid', /else cat \/proc\/sys\/kernel\/random\/uuid; fi/],
    ['_plat_ppid', /sed -n 's\/\^PPid:\[\[:space:\]\]\*\/\/p' "\/proc\/\$\{1-\}\/status"/],
    ['_plat_cgroup', /sed -n 's\/\^0::\/\/p' "\/proc\/\$\$\/cgroup"/],
    ['_plat_mode', /else stat -c%a "\$@"; fi/],
    // D-3524's ctime, the one timestamp a credential restore cannot backdate.
    // New rather than ported, so the row binds the NAME as well as the arm.
    ['_plat_ctime', /^_plat_ctime\(\) \{ if \[ "\$CCD_OS" = darwin \]; then stat -f %c "\$@"; else stat -c %Z "\$@"; fi; \}/m],
    // The temp-root witness's birth time (child-reclamation wave 6). New rather
    // than ported, so the row binds the NAME as well as the arm.
    ['_plat_btime', /^_plat_btime\(\) \{ if \[ "\$CCD_OS" = darwin \]; then stat -f %B "\$@"; else stat -c %W "\$@"; fi; \}/m],
    ['_plat_bytes', /du -sb "\$1" \| head -n1 \| cut -f1/],
    ['_svc_run_detached', /systemd-run --user --collect --quiet "\$@"/],
    ['_svc_have_user_manager', /command -v systemd-run >\/dev\/null 2>&1 && systemctl --user show-environment >\/dev\/null 2>&1/],
    ['_svc_run_supervised', /local -a sr=\(--user --collect --quiet "--unit=\$unit" --slice=app\.slice "--working-directory=\$HOME"\n\s+-p Restart=always -p RestartSec=3 -p StartLimitIntervalSec=300 -p StartLimitBurst=20\n\s+-p "StandardOutput=append:\$log" -p "StandardError=append:\$log"\)/],
    ['_svc_run_supervised (the call)', /systemctl --user reset-failed "\$unit" >\/dev\/null 2>&1\n\s+systemd-run "\$\{sr\[@\]\}" -- "\$@" \|\| return \$\?/],
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

// UNCONDITIONAL — runs on every box, including the Linux CI box that is the
// only one that ever executes this suite. `CCD_OS` is computed ONCE, from
// `$OSTYPE`, at the moment the platform block is sourced (ccd/ccd's own
// comment above `_plat_mv_notdir`); an env var of that name handed to the
// child process is overwritten before any function exists to read it, so it
// does nothing. The only assignment that survives is one made AFTER the
// source, in the SAME bash payload — exactly the rule
// `ccd-account-auth.test.ts:794-796` states and `:806` uses
// (`fn('CCD_OS=linux; _auth_script_argv …')`). That is how the Darwin arm of
// `_plat_mv_notdir` (D-2187) gets driven here without a real Darwin
// userland, rather than inside the `describe.skipIf(!IS_DARWIN)` block below,
// which never executes on this box (D-2188).
describe('_plat_mv_notdir\'s Darwin arm, forced from Linux (D-2187)', () => {
  function darwinBlock(expr: string): string {
    const script = `${platformBlock(ccd)}\nCCD_OS=darwin\n${expr}\n`;
    return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
  }

  it('answers 0 only if src is now AT a dest that was a symlink to a directory', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-'));
    try {
      const real = path.join(d, 'real-dir');
      mkdirSync(real);
      const dst = path.join(d, 'dst');
      symlinkSync(real, dst);
      const src = path.join(d, 'src');
      writeFileSync(src, 'payload-9d3f');
      const rc = darwinBlock(`_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'the call must report an exit code').toBe('0');
      // The postcondition, not just the exit status: <src> must now be AT
      // <dest>. Before the fix, GNU `mv -f` (no `-T`) follows the symlink and
      // moves `src` INSIDE the linked directory, leaving `dest` the same
      // symlink it always was — rc 0 with the postcondition false.
      expect(lstatSync(dst).isSymbolicLink(), 'dest must no longer be the symlink it was — the contract is 0 iff src is now AT dest').toBe(false);
      expect(lstatSync(dst).isFile(), 'dest must now be a regular file').toBe(true);
      expect(readFileSync(dst, 'utf8')).toBe('payload-9d3f');
      expect(readdirSync(real), 'nothing may have been moved inside the linked directory').toEqual([]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('refuses a real directory destination and leaves it untouched', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-dir-'));
    try {
      const dst = path.join(d, 'dst');
      mkdirSync(dst);
      const src = path.join(d, 'src');
      writeFileSync(src, 'payload');
      const rc = darwinBlock(`_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'a real directory destination must be refused').toBe('1');
      expect(lstatSync(dst).isDirectory()).toBe(true);
      expect(readdirSync(dst), 'the destination directory must stay empty').toEqual([]);
      expect(readdirSync(d)).toContain('src');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  // R1 (fix round 2): the narrowed ccd-reg-set-atomic scan cannot prove the
  // `rm` is CONTAINED in its guard — it only sees that the tokens exist
  // somewhere in the body, and the pre-existing, untouched refusal guard
  // supplies both of them unconditionally. These two cases are the
  // behavioural replacement: neither dest shape below is a directory (the
  // refusal guard never fires for them), so whether the `rm` actually ran —
  // and whether it ran on a shape it was never meant to touch — is visible
  // ONLY in whether the destination survives a `mv` that then fails.
  it('refuses when src is missing and leaves a plain-file dest untouched, byte-for-byte', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-plainfile-'));
    try {
      const dst = path.join(d, 'dst');
      writeFileSync(dst, 'original-bytes-7a2c');
      const src = path.join(d, 'src'); // deliberately never created
      const rc = darwinBlock(`_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'a missing src must not report success').not.toBe('0');
      // A plain file is neither `-L` nor `-d`, so the guarded `rm` must never
      // fire here. An UNCONDITIONAL `rm` (the mutant the narrowed scan
      // cannot see, because the untouched refusal guard supplies both
      // `-L "$2"` and `-d "$2"` tokens elsewhere in the body) removes `dst`
      // before the doomed `mv` runs, so this is the case that reds it.
      expect(lstatSync(dst).isFile(), 'dest must still be a plain file').toBe(true);
      expect(readFileSync(dst, 'utf8'), 'dest bytes must be exactly what they were').toBe('original-bytes-7a2c');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('refuses when src is missing and leaves a symlink-to-file dest resolvable', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-symfile-'));
    try {
      const real = path.join(d, 'real-file');
      writeFileSync(real, 'target-bytes-4e1b');
      const dst = path.join(d, 'dst');
      symlinkSync(real, dst);
      const src = path.join(d, 'src'); // deliberately never created
      const rc = darwinBlock(`_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'a missing src must not report success').not.toBe('0');
      // A symlink-to-FILE is `-L` but not `-d`, so a guard narrowed to `-L`
      // alone (dropping the `-d` half) fires here where the real guard would
      // not — that is exactly the mutation this case reds.
      expect(existsSync(dst), 'the name must still be resolvable — nothing may unlink it out from under a failed mv').toBe(true);
      expect(lstatSync(dst).isSymbolicLink(), 'dest must still be the same symlink').toBe(true);
      expect(readFileSync(dst, 'utf8'), 'the link target must be unchanged').toBe('target-bytes-4e1b');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  // Final-round item 4 — the two disclosed prices this wave's own fix and
  // header carry, pinned so neither can silently change in either direction.
  // `chmod` is what makes the unlink FAIL below, and root defeats chmod.
  it.skipIf(process.getuid?.() === 0)(
    'when the guarded rm FAILS, the function does not answer 0 — the rm-fails price', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-rmfail-'));
    const parent = path.join(d, 'parent');
    try {
      mkdirSync(parent);
      const real = path.join(d, 'real-dir');
      mkdirSync(real);
      const dst = path.join(parent, 'dst');
      symlinkSync(real, dst);
      // No write permission on the PARENT: unlink(2) needs it on the
      // directory that holds the name, not on the symlink itself, so this
      // makes `rm -f -- "$2"` fail without touching the symlink at all.
      chmodSync(parent, 0o555);
      const src = path.join(d, 'src');
      writeFileSync(src, 'payload-rmfail-6c2a');
      const rc = darwinBlock(`_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'a failing unlink must not report success — this is the fix for D-2187\'s recurrence').not.toBe('0');
      expect(lstatSync(dst).isSymbolicLink(), 'dest must still be the untouched symlink — the rm never removed it').toBe(true);
      expect(readdirSync(dst), 'nothing was moved into the linked directory').toEqual([]);
      expect(readFileSync(src, 'utf8'), 'src must be untouched — the mv this rm gates was never reached').toBe('payload-rmfail-6c2a');
    } finally {
      chmodSync(parent, 0o755);
      rmSync(d, { recursive: true, force: true });
    }
  });

  // F10 (review run 69): the case ABOVE is the only pin on MUST-FIX 1's
  // `|| return 1`, and it is `skipIf(uid === 0)` — so on a root runner the
  // thing this fix's own header calls "a mechanism rather than a comment" is
  // held by nothing. A skipped case is not a pin. The conjunct is about a
  // FAILING `rm`; chmod is merely one way to cause that, and it is the way
  // root defeats. Shadowing the binary causes the same condition for every
  // uid, so this case runs everywhere and the guarantee is never unheld.
  it('when the guarded rm fails for a reason chmod cannot cause, the function still does not answer 0 — the rm-fails price, pinned at every uid', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-rmstub-'));
    try {
      const real = path.join(d, 'real-dir');
      mkdirSync(real);
      const dst = path.join(d, 'dst');
      symlinkSync(real, dst);
      const src = path.join(d, 'src');
      writeFileSync(src, 'payload-rmstub-1f9e');
      const stubDir = path.join(d, 'bin');
      mkdirSync(stubDir);
      writeFileSync(path.join(stubDir, 'rm'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const rc = darwinBlock(
        `export PATH='${stubDir}':"$PATH"\n_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'a failing unlink must not report success, whoever is running').not.toBe('0');
      // Without `|| return 1` the failing `rm` falls through to the unchanged
      // `mv`, which moves `src` INSIDE the linked directory and answers 0 —
      // D-2187's recurrence exactly. Both assertions below red on that mutant.
      expect(lstatSync(dst).isSymbolicLink(), 'dest must still be the untouched symlink').toBe(true);
      expect(readdirSync(real), 'nothing may be moved INTO the linked directory').toEqual([]);
      expect(readFileSync(src, 'utf8'), 'src must be untouched — the mv this rm gates was never reached').toBe('payload-rmstub-1f9e');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('when src is absent, a symlink-to-directory dest is left GONE — the destination-gone price, disclosed', () => {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-mv-darwin-gone-'));
    try {
      const real = path.join(d, 'real-dir');
      mkdirSync(real);
      const dst = path.join(d, 'dst');
      symlinkSync(real, dst);
      const src = path.join(d, 'src'); // deliberately never created
      const rc = darwinBlock(`_plat_mv_notdir '${src}' '${dst}'; echo $?`);
      expect(rc, 'a missing src must not report success').not.toBe('0');
      // Unlike the symlink-to-FILE case above, which stays resolvable: the
      // guarded `rm` fires for THIS shape (symlink-to-directory) whether or
      // not `src` exists, so a missing `src` leaves `dest` gone rather than
      // intact — the pre-fix code left the symlink alone here. Disclosed in
      // the header above `_plat_mv_notdir`; pinned here so it cannot drift
      // in either direction without this case moving.
      expect(existsSync(dst), 'the destination is GONE — the guarded rm ran before the doomed mv').toBe(false);
      expect(readdirSync(real), 'the linked directory itself is untouched').toEqual([]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

// W6 Task 1 — `_plat_ln_swap`, the flip of `$HOME/ccrc` (spec 2026-09-20 §11
// Pins: "the flip is `mv -T` (argv pinned)"; §18 "the flip is a rename").
// Every case runs the REAL platform block, sliced out of ccd, under `bash -c`
// with `CCD_OS` assigned AFTER the source (the rule the describe above
// states), and with RECORDING `ln`/`mv`/`rm`/`python3` wrappers first on PATH
// that `exec` the real tool — so what is pinned is the argv the helper
// issued AND what the filesystem looks like afterwards, never one without
// the other. The argv alone would pass a wrapper that lied; the
// postcondition alone would pass a non-atomic unlink-then-symlink.
describe('_plat_ln_swap: one rename, both arms (W6 Task 1)', () => {
  type Os = 'linux' | 'darwin';
  const PY = 'import os, sys; os.replace(sys.argv[1], sys.argv[2])';

  interface Fx { d: string; bin: string; log: string; old: string; next: string; link: string }

  /** Whether a NAME exists — a dangling link included, which `existsSync`
   *  (it follows links) would call absent. */
  const lexists = (p: string): boolean => {
    try { lstatSync(p); return true; } catch { return false; }
  };

  // The real tools, resolved ONCE and BEFORE any wrapper is on PATH (a
  // wrapper that `exec`d the bare name would find itself) — and WITHOUT a
  // throw: `execFileSync` throws on `command -v`'s rc 1, so a runner with no
  // python3 would red all fourteen cases, the GNU-arm ones that never call it
  // included (the rule the Global Constraints set for the harness stubs).
  const REAL: Record<string, string> = Object.fromEntries(['ln', 'mv', 'rm', 'python3'].map((t) => [
    t, spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim(),
  ]));
  /** The forced-Darwin cases whose rename runs the REAL `os.replace` skip on
   *  a runner with no python3; every other case, on both arms, still runs. */
  const itPy = it.skipIf(REAL.python3 === '');

  /** A scratch dir holding two version-shaped directories (`old` carries a
   *  marker file, so "its listing is unchanged" has something to compare),
   *  `link` → `old` (absolute, as the tree's link is), and the recording
   *  wrappers. `fail` names tools whose wrapper exits 1 WITHOUT running the
   *  real one — how a failing rename is caused on either arm, so that case
   *  needs no real python3 either. */
  function fixture(fail: string[] = []): Fx {
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-ln-swap-'));
    const bin = path.join(d, 'bin');
    mkdirSync(bin);
    const log = path.join(d, 'calls.log');
    for (const tool of ['ln', 'mv', 'rm', 'python3']) {
      const real = REAL[tool]!;
      // Nothing to `exec`: plant no wrapper (only python3 can be missing).
      if (real === '' && !fail.includes(tool)) continue;
      writeFileSync(path.join(bin, tool), [
        '#!/bin/sh',
        // One line per call, argv TAB-separated: the python3 program text
        // has spaces in it, and no path here has a tab.
        `printf '%s' '${tool}' >> '${log}'`,
        `for a in "$@"; do printf '\\t%s' "$a" >> '${log}'; done`,
        `printf '\\n' >> '${log}'`,
        fail.includes(tool) ? 'exit 1' : `exec '${real}' "$@"`,
      ].join('\n') + '\n', { mode: 0o755 });
    }
    const old = path.join(d, 'versions', 'v0.0.1');
    const next = path.join(d, 'versions', 'v0.0.2');
    mkdirSync(old, { recursive: true });
    mkdirSync(next);
    writeFileSync(path.join(old, 'OLD-MARKER'), 'old');
    writeFileSync(path.join(next, 'NEW-MARKER'), 'new');
    const link = path.join(d, 'ccrc');
    symlinkSync(old, link);
    return { d, bin, log, old, next, link };
  }

  function swap(os: Os, f: Fx, target: string = f.next, link: string = f.link):
    { rc: number | null; out: string; calls: string[][] } {
    const script = `${platformBlock(ccd)}\nCCD_OS=${os}\nexport PATH='${f.bin}':"$PATH"\n`
      + `_plat_ln_swap '${target}' '${link}'\n`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    const calls = existsSync(f.log)
      ? readFileSync(f.log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'))
      : [];
    return { rc: r.status, out: `${r.stdout}${r.stderr}`, calls };
  }

  /** The postcondition both arms owe on success. */
  function flipped(f: Fx, target: string = f.next): void {
    expect(lstatSync(f.link).isSymbolicLink(), 'the link must still be a symlink — never a copied tree').toBe(true);
    expect(readlinkSync(f.link), 'the link\'s value must be the target, verbatim').toBe(target);
    expect(readdirSync(f.old), 'nothing may be moved INSIDE the old version (D-2187\'s shape)').toEqual(['OLD-MARKER']);
    expect(lexists(`${f.link}.new`), 'the staged <link>.new must be gone').toBe(false);
  }

  // PLATFORM-ONLY: this arm's rename is GNU `mv -fT`, and BSD `mv` has no `-T`
  // — on the macOS runner there is no binary for it to run. Its pair is the
  // forced-Darwin case below, which runs on BOTH runners.
  itLinux('the Linux arm is the spec\'s argv — ln -sfn to <link>.new, then mv -fT over <link>', () => {
    const f = fixture();
    try {
      const r = swap('linux', f);
      expect(r.rc, r.out).toBe(0);
      expect(r.out, 'the helper prints nothing — the caller owns the sentence').toBe('');
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['mv', '-fT', '--', `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  itPy('the Darwin arm stages the same link and renames it with os.replace — no mv, no rm of <link>', () => {
    const f = fixture();
    try {
      const r = swap('darwin', f);
      expect(r.rc, r.out).toBe(0);
      expect(r.out).toBe('');
      // `_plat_mv_notdir`'s Darwin arm would show here as an `rm` of <link>
      // followed by a `mv -f` — the window this helper exists to close.
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['python3', '-c', PY, `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  for (const os of ['linux', 'darwin'] as const) {
    for (const kind of ['directory', 'file'] as const) {
      it(`refuses a real ${kind} at <link> and touches nothing (${os} arm)`, () => {
        const f = fixture();
        try {
          rmSync(f.link);
          if (kind === 'directory') {
            mkdirSync(f.link);
            writeFileSync(path.join(f.link, 'LIVE'), 'pre-versioned tree');
          } else {
            writeFileSync(f.link, 'not a tree');
          }
          const before = statSync(f.link).mtimeMs;
          const r = swap(os, f);
          expect(r.rc, 'a real directory is the migration\'s case, and a file nobody\'s — never the flip\'s').toBe(1);
          expect(r.out).toBe('');
          expect(r.calls, 'refused BEFORE anything is staged').toEqual([]);
          if (kind === 'directory') {
            expect(lstatSync(f.link).isDirectory()).toBe(true);
            expect(readdirSync(f.link)).toEqual(['LIVE']);
          } else {
            expect(lstatSync(f.link).isFile()).toBe(true);
            expect(readFileSync(f.link, 'utf8')).toBe('not a tree');
          }
          expect(statSync(f.link).mtimeMs).toBe(before);
          expect(lexists(`${f.link}.new`), 'nothing may be left staged').toBe(false);
        } finally {
          rmSync(f.d, { recursive: true, force: true });
        }
      });
    }

    for (const kind of ['file', 'directory'] as const) {
      it(`refuses a ${kind} at <link>.new, and leaves both names alone (${os} arm)`, () => {
        // `ln -sfn`'s `-f` would delete a file here and a directory would take
        // the new link inside it — neither is this function's to touch.
        const f = fixture();
        try {
          const staged = `${f.link}.new`;
          if (kind === 'file') writeFileSync(staged, 'not ours');
          else { mkdirSync(staged); writeFileSync(path.join(staged, 'THEIRS'), 'not ours'); }
          const r = swap(os, f);
          expect(r.rc).toBe(1);
          expect(r.out).toBe('');
          expect(r.calls, 'refused BEFORE `ln` runs').toEqual([]);
          if (kind === 'file') expect(readFileSync(staged, 'utf8')).toBe('not ours');
          else expect(readdirSync(staged), 'nothing may be linked inside it').toEqual(['THEIRS']);
          expect(readlinkSync(f.link), 'the running version is still the one pointed at').toBe(f.old);
        } finally {
          rmSync(f.d, { recursive: true, force: true });
        }
      });
    }

    it(`a failed rename leaves <link> where it was and removes the staged name (${os} arm)`, () => {
      // The rename tool's wrapper exits 1 without running it, so this case
      // needs no GNU `mv` and runs on both runners for both arms.
      const f = fixture([os === 'darwin' ? 'python3' : 'mv']);
      try {
        const r = swap(os, f);
        expect(r.rc).toBe(1);
        expect(readlinkSync(f.link), 'the running version is still the one pointed at').toBe(f.old);
        expect(lexists(`${f.link}.new`), 'the staged link must be cleaned up').toBe(false);
        expect(r.calls.at(-1), 'the clean-up is the last act').toEqual(['rm', '-f', '--', `${f.link}.new`]);
      } finally {
        rmSync(f.d, { recursive: true, force: true });
      }
    });
  }

  itPy('replaces a stale symlink left at <link>.new (Darwin arm)', () => {
    const f = fixture();
    try {
      symlinkSync(f.old, `${f.link}.new`);
      const r = swap('darwin', f);
      expect(r.rc, r.out).toBe(0);
      // `ln -sfn` replaces the stale link itself; nothing else is called.
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['python3', '-c', PY, `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  // PLATFORM-ONLY: the rename is GNU `mv -fT` (see the first case's marker);
  // the Darwin twin is the case directly above.
  itLinux('replaces a stale symlink left at <link>.new (Linux arm)', () => {
    const f = fixture();
    try {
      symlinkSync(f.old, `${f.link}.new`);
      const r = swap('linux', f);
      expect(r.rc, r.out).toBe(0);
      expect(r.calls).toEqual([
        ['ln', '-sfn', '--', f.next, `${f.link}.new`],
        ['mv', '-fT', '--', `${f.link}.new`, f.link],
      ]);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  itPy('places the link when nothing stands at <link> yet (Darwin arm)', () => {
    const f = fixture();
    try {
      rmSync(f.link);
      const r = swap('darwin', f);
      expect(r.rc, r.out).toBe(0);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });

  // PLATFORM-ONLY: GNU `mv -fT`, as above; the Darwin twin is directly above.
  itLinux('places the link when nothing stands at <link> yet (Linux arm)', () => {
    const f = fixture();
    try {
      rmSync(f.link);
      const r = swap('linux', f);
      expect(r.rc, r.out).toBe(0);
      flipped(f);
    } finally {
      rmSync(f.d, { recursive: true, force: true });
    }
  });
});

// ── _svc_have_user_manager / _svc_run_supervised: both arms, on whichever box runs this ──
// UNCONDITIONAL. Every behavioural case sources the REAL block and FORCES
// `CCD_OS` in the same payload — the idiom the describe above uses — so the
// Linux arms run on the macOS leg and the Darwin arm runs here. Nothing below
// is platform-gated. The one case that sources nothing is the PF-3 literal
// pin, a text match over ccd's bytes like the `arms` rows above.
//
// CONTAINMENT, THREE LAYERS, because a leaked call would start a real transient
// unit on the developer's own user manager: recording `systemd-run` and
// `systemctl` first on PATH in EVERY case, including the ones whose subject
// never reaches them (a mutant that does must meet a recorder); a preamble that
// exits 99 unless `command -v` resolves each name to its stub; and a bus address
// that points at nothing. No fixture unit carries a real lane's unit prefix.
describe('_svc_run_supervised and _svc_have_user_manager — both arms, forced, on whichever box runs this', () => {
  type Fx = { home: string; bin: string; runLog: string; ctlLog: string };

  /** A fixture HOME with RECORDING `systemd-run` and `systemctl` in `stub-bin/`. */
  function svcFixture(opts: { withSystemdRun?: boolean } = {}): Fx {
    const home = mkTmp('ccrc-svc-sup-');
    const bin = path.join(home, 'stub-bin');
    mkdirSync(bin);
    const runLog = path.join(home, 'systemd-run.argv');
    const ctlLog = path.join(home, 'systemctl.calls');
    if (opts.withSystemdRun !== false) {
      // ONE ARGV ELEMENT PER LINE and a terminator per call: an element that
      // carries a space stays one element, and `toEqual` sees the order.
      writeFileSync(path.join(bin, 'systemd-run'), [
        '#!/bin/sh',
        `for a in "$@"; do printf '%s\\n' "$a"; done >> '${runLog}'`,
        `printf '%s\\n' '--end-of-call--' >> '${runLog}'`,
        'exit "${SVC_RUN_RC:-0}"',
      ].join('\n') + '\n', { mode: 0o755 });
    }
    writeFileSync(path.join(bin, 'systemctl'), [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> '${ctlLog}'`,
      'case "$*" in "--user show-environment") exit "${SVC_SHOWENV_RC:-0}" ;; esac',
      'exit 0',
    ].join('\n') + '\n', { mode: 0o755 });
    return { home, bin, runLog, ctlLog };
  }

  const lines = (f: string): string[] =>
    (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : []);
  /** Every `systemd-run` call, each as its own argv. */
  const runCalls = (fx: Fx): string[][] => {
    const calls: string[][] = [];
    let cur: string[] = [];
    for (const l of lines(fx.runLog)) {
      if (l === '--end-of-call--') { calls.push(cur); cur = []; } else cur.push(l);
    }
    return calls;
  };
  /** Everything either manager binary was asked, in one list — empty means "never asked". */
  const managerCalls = (fx: Fx): string[] =>
    [...lines(fx.ctlLog), ...runCalls(fx).map((a) => `systemd-run ${a.join(' ')}`)];
  const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
  /** Bounded wait; the caller asserts afterwards, so a timeout reds with the caller's message. */
  const until = (pred: () => boolean, ms = 10_000): void => {
    const end = Date.now() + ms;
    while (!pred() && Date.now() < end) pause(50);
  };
  const argsOf = (pid: number): string =>
    (spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).stdout ?? '').trim();
  const reap = (pid: number): void => { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } };

  /** Source the block, force the platform, put the stubs first on PATH, and
   *  refuse (99) unless every manager name resolves to its stub. `stubsOnly`
   *  replaces PATH with the stub directory alone — the one way to model "no
   *  systemd-run on this box" on a box that has one. */
  function svc(fx: Fx, os: 'linux' | 'darwin', expr: string,
    opts: { env?: NodeJS.ProcessEnv; stubsOnly?: boolean; cwd?: string } = {}):
    { status: number | null; stdout: string; stderr: string } {
    const run = path.join(fx.bin, 'systemd-run');
    const ctl = path.join(fx.bin, 'systemctl');
    const script = [
      'set -uo pipefail',
      platformBlock(ccd),
      `CCD_OS=${os}`,
      opts.stubsOnly ? `export PATH='${fx.bin}'` : `export PATH='${fx.bin}':"$PATH"`,
      `[ "$(command -v systemctl)" = '${ctl}' ] || { echo 'containment: systemctl is not the stub' >&2; exit 99; }`,
      opts.stubsOnly
        ? `[ -z "$(command -v systemd-run)" ] || { echo 'containment: a systemd-run is reachable' >&2; exit 99; }`
        : `[ "$(command -v systemd-run)" = '${run}' ] || { echo 'containment: systemd-run is not the stub' >&2; exit 99; }`,
      expr,
    ].join('\n') + '\n';
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf8', timeout: 15_000, cwd: opts.cwd ?? fx.home,
      env: {
        ...process.env,
        HOME: fx.home,
        XDG_RUNTIME_DIR: path.join(fx.home, 'no-runtime-dir'),
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(fx.home, 'no-bus')}`,
        ...opts.env,
      },
    });
    expect(r.status, `the payload's containment preamble refused: ${r.stderr}`).not.toBe(99);
    return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
  }

  it('_svc_have_user_manager answers 0 only off Darwin, with systemd-run on PATH AND a manager that answers', () => {
    // The probe the live launcher runs, and the one `_svc_run_detached` never
    // had: "systemctl installed, no user bus" must answer NO, which is the row
    // PATH presence alone gets wrong.
    const rows: Array<{ os: 'linux' | 'darwin'; sr: boolean; showEnvRc: number; want: string; asked: string[] }> = [
      { os: 'linux', sr: true, showEnvRc: 0, want: 'rc=0', asked: ['--user show-environment'] },
      { os: 'linux', sr: true, showEnvRc: 1, want: 'rc=1', asked: ['--user show-environment'] },
      { os: 'linux', sr: false, showEnvRc: 0, want: 'rc=1', asked: [] },
      { os: 'darwin', sr: true, showEnvRc: 0, want: 'rc=1', asked: [] },
    ];
    for (const row of rows) {
      const fx = svcFixture({ withSystemdRun: row.sr });
      const r = svc(fx, row.os, '_svc_have_user_manager; echo "rc=$?"',
        { stubsOnly: !row.sr, env: { SVC_SHOWENV_RC: String(row.showEnvRc) } });
      const label = JSON.stringify(row);
      expect(r.stdout, label).toBe(row.want);
      expect(lines(fx.ctlLog), `${label}: what the probe asked the manager`).toEqual(row.asked);
    }
  });

  it('the systemd arm: one transient unit, its whole argv in order, and no key material anywhere', () => {
    const fx = svcFixture();
    // GENERATED, never asserted by value — only its ABSENCE is asserted, and
    // with a boolean so a failure does not print it either.
    const key = `sk-${randomBytes(24).toString('hex')}`;
    const envfile = path.join(fx.home, 'runtime.env');
    writeFileSync(envfile, `LITELLM_MASTER_KEY=${key}\n`, { mode: 0o600 });
    const log = path.join(fx.home, 'logs', 'litellm.log');
    mkdirSync(path.dirname(log));
    const tokDir = path.join(fx.home, '.local/share/ccrc/codex/codex-a');
    const cfg = path.join(fx.home, 'a dir', 'litellm.yaml');
    const r = svc(fx, 'linux', [
      `_svc_run_supervised fixture-codex-a-litellm.service '${log}' '${envfile}' \\`,
      `  CCGPT_ACCOUNT_ID=codex-a 'CHATGPT_TOKEN_DIR=${tokDir}' LITELLM_LOCAL_MODEL_COST_MAP=True 'HOME=${fx.home}' \\`,
      `  -- /fixture/runtime/bin/python -m litellm.proxy.proxy_cli --config '${cfg}'`,
      'echo "rc=$?"',
    ].join('\n'));
    // KEY ABSENCE FIRST, as booleans, before anything that prints what it
    // compared: a key that leaked into the argv must red HERE, not on the
    // census `toEqual` below, whose failure would print the argv — key
    // included (final-review residue).
    for (const [where, text] of [
      ['the systemd-run argv', readFileSync(fx.runLog, 'utf8')],
      ['the systemctl calls', readFileSync(fx.ctlLog, 'utf8')],
      ['stdout', r.stdout], ['stderr', r.stderr],
    ] as const) {
      expect(text.includes(key), `the gateway key reached ${where}`).toBe(false);
    }
    expect(r.stdout, r.stderr).toBe('systemd fixture-codex-a-litellm.service\nrc=0');
    // THE ARGV IS THE PIN, not a `systemctl show` listing (D-3491):
    // a planted property answer would prove only what this file typed into it.
    expect(runCalls(fx)).toEqual([[
      '--user', '--collect', '--quiet',
      '--unit=fixture-codex-a-litellm.service', '--slice=app.slice', `--working-directory=${fx.home}`,
      '-p', 'Restart=always', '-p', 'RestartSec=3',
      '-p', 'StartLimitIntervalSec=300', '-p', 'StartLimitBurst=20',
      '-p', `StandardOutput=append:${log}`, '-p', `StandardError=append:${log}`,
      '-p', `EnvironmentFile=${envfile}`,
      '--setenv=CCGPT_ACCOUNT_ID=codex-a', `--setenv=CHATGPT_TOKEN_DIR=${tokDir}`,
      '--setenv=LITELLM_LOCAL_MODEL_COST_MAP=True', `--setenv=HOME=${fx.home}`,
      '--',
      '/fixture/runtime/bin/python', '-m', 'litellm.proxy.proxy_cli', '--config', cfg,
    ]]);
    expect(lines(fx.ctlLog), 'the probe first, then clear a failed unit of the same name, then nothing')
      .toEqual(['--user show-environment', '--user reset-failed fixture-codex-a-litellm.service']);
  });

  it('the systemd arm with envfile `-` and no pairs carries neither, and relays a refused start as its own rc with no `systemd` line', () => {
    const fx = svcFixture();
    const log = path.join(fx.home, 'shim.log');
    const ok = svc(fx, 'linux',
      `_svc_run_supervised fixture-codex-a-shim.service '${log}' - -- /fixture/python -I /fixture/proxy.py; echo "rc=$?"`);
    expect(ok.stdout, ok.stderr).toBe('systemd fixture-codex-a-shim.service\nrc=0');
    const [argv] = runCalls(fx);
    expect(argv!.slice(argv!.indexOf(`StandardError=append:${log}`) + 1),
      'nothing between the log and `--`: no EnvironmentFile, no --setenv')
      .toEqual(['--', '/fixture/python', '-I', '/fixture/proxy.py']);
    const refused = svc(fx, 'linux',
      `_svc_run_supervised fixture-codex-a-shim.service '${log}' - -- /fixture/python; echo "rc=$?"`,
      { env: { SVC_RUN_RC: '5' } });
    expect(refused.stdout, 'systemd-run\'s refusal is the rc, and nothing claims a start').toBe('rc=5');
  });

  it('Linux with no user manager takes the nohup arm: the log is APPENDED, `nohup <pid>` is the COMMAND, env and cwd agree with the systemd arm', () => {
    const fx = svcFixture();
    const log = path.join(fx.home, 'shim.log');
    writeFileSync(log, 'an-earlier-line\n');
    const envfile = path.join(fx.home, 'runtime.env');
    writeFileSync(envfile, 'FROM_ENVFILE=file-value\nSHARED=from-file\n', { mode: 0o600 });
    const elsewhere = mkTmp('ccrc-svc-cwd-');
    const r = svc(fx, 'linux', [
      '_svc_have_user_manager() { return 1; }',
      `_svc_run_supervised fixture-codex-a-shim.service '${log}' '${envfile}' SVC_PAIR=pair-value SHARED=from-pair \\`,
      `  -- sh -c 'echo "pair=$SVC_PAIR file=$FROM_ENVFILE shared=$SHARED cwd=$(pwd -P)"; exec sleep 30'`,
      'echo "rc=$?"',
    ].join('\n'), { cwd: elsewhere });
    const m = /^nohup (\d+)\nrc=0$/.exec(r.stdout);
    expect(m, `stdout: ${r.stdout} / stderr: ${r.stderr}`).not.toBeNull();
    const pid = Number(m![1]);
    try {
      until(() => readFileSync(log, 'utf8').includes('pair='));
      // THE ENVFILE BEATS A PAIR — systemd documents EnvironmentFile= over
      // Environment=, and the two arms must agree. The cwd is $HOME, as
      // --working-directory is, and NOT the caller's.
      expect(readFileSync(log, 'utf8'))
        .toBe(`an-earlier-line\npair=pair-value file=file-value shared=from-file cwd=${fx.home}\n`);
      // EXACT, not a substring: every shell in the chain carries `sleep 30` in
      // its own argv (the payload's text, the wrapper's "$@"), so only the
      // whole line tells the command from a shell that forgot to `exec`.
      until(() => argsOf(pid) === 'sleep 30');
      expect(argsOf(pid), 'the printed pid IS the command — the exec chain kept it').toBe('sleep 30');
      expect(runCalls(fx), 'the nohup arm never reaches systemd-run').toEqual([]);
    } finally {
      reap(pid);
    }
  });

  it('the nohup arm starts from a SCRUBBED environment: a variable the caller exported never reaches the child; HOME, PATH, the pairs and a set LANG do', () => {
    // A unit's environment is the manager's, never the caller's, so the nohup
    // child starts from `env -i` too. The sentinel belongs to NO family on
    // purpose: `env -i` names none, and a sentinel named `CLAUDE_…` would also
    // pass a mutant that scrubbed only `CLAUDE_*`. The child prints NAMED
    // variables only, never `env`, so a mutant that leaks the caller's whole
    // environment cannot copy a developer's own token into this log or a diff.
    const fx = svcFixture();
    const rows: Array<{ lang: string | undefined; want: string }> = [
      { lang: 'C', want: 'lang=C' },
      // `${LANG:+…}`: a caller with no LANG gives the child no LANG, not an empty one.
      { lang: undefined, want: 'lang=absent' },
    ];
    for (const row of rows) {
      const log = path.join(fx.home, `scrub-${row.lang ?? 'unset'}.log`);
      const r = svc(fx, 'linux', [
        '_svc_have_user_manager() { return 1; }',
        // THE CONTROL: the plant reached the caller, or the absence below is vacuous.
        'echo "caller=${SVC_CALLER_SENTINEL-absent}"',
        `_svc_run_supervised fixture-scrub.service '${log}' - SVC_PAIR=pair-value \\`,
        `  -- sh -c 'echo "sentinel=\${SVC_CALLER_SENTINEL-absent} pair=\${SVC_PAIR-absent} home=\${HOME-absent} path-head=\${PATH%%:*} lang=\${LANG-absent}"'`,
        'echo "rc=$?"',
      ].join('\n'), { env: { SVC_CALLER_SENTINEL: 'planted-by-the-caller', LANG: row.lang } });
      const m = /^caller=planted-by-the-caller\nnohup (\d+)\nrc=0$/.exec(r.stdout);
      expect(m, `${row.want}: stdout: ${r.stdout} / stderr: ${r.stderr}`).not.toBeNull();
      const pid = Number(m![1]);
      try {
        until(() => readFileSync(log, 'utf8').includes('sentinel='));
        expect(readFileSync(log, 'utf8'), row.want)
          .toBe(`sentinel=absent pair=pair-value home=${fx.home} path-head=${fx.bin} ${row.want}\n`);
      } finally {
        reap(pid);
      }
    }
    expect(runCalls(fx), 'the nohup arm never reaches systemd-run').toEqual([]);
  });

  it('the nohup arm SOURCES the envfile inside its own `sh`, never lists the file\'s lines as `env` argv — a literal pin (PF-3)', () => {
    // NO BEHAVIOURAL CASE CAN SEE THIS. Listed as `env` arguments after the
    // pairs, the file's lines give the child the SAME environment, file after
    // pairs, so every case in this describe stays green on that mutant — but
    // the gateway key would then sit in `env`'s argv, which `ps` shows to every
    // user on the box for the life of that process. That is the one channel the
    // secret refusal exists to close, so the sourcing line is pinned by its
    // TEXT, together with the argument line that makes its `$1` the envfile's
    // PATH. The price is a red on a pure reformat of those two lines; a red
    // beats a disclosure.
    expect(ccd, 'the nohup arm no longer sources the envfile by path inside its `sh -c`').toContain(
      `      sh -c 'if [ "$1" != - ]; then set -a; . "$1" || exit 1; set +a; fi; shift; exec nohup "$@"' \\\n      sh "$envfile" "$@"\n`);
  });

  it('forced Darwin: a missing command answers 1 and backgrounds NOTHING — probed before the `&`', () => {
    const fx = svcFixture();
    const log = path.join(fx.home, 'never.log');
    const r = svc(fx, 'darwin', [
      `_svc_run_supervised fixture-x.service '${log}' - -- ccrc-fixture-no-such-command-7c1e --flag`,
      'rc=$?; echo "rc=$rc jobs=$(jobs -p | wc -l | tr -d \' \')"',
    ].join('\n'));
    // A bare `nohup … &` answers 0 and leaves a job in the table: both are
    // read in the SAME shell, immediately, so neither waits on a race.
    expect(r.stdout).toBe('rc=1 jobs=0');
    expect(r.stderr.split('\n'), 'one line').toHaveLength(1);
    expect(r.stderr).toContain('ccrc-fixture-no-such-command-7c1e');
    expect(existsSync(log) ? readFileSync(log, 'utf8') : '', 'nothing ran, so nothing wrote').toBe('');
    expect(managerCalls(fx), 'Darwin never asks systemd').toEqual([]);
  });

  it('forced Darwin: a real command takes the nohup arm even with systemd-run on PATH, and asks systemd nothing', () => {
    const fx = svcFixture();
    const log = path.join(fx.home, 'darwin.log');
    const r = svc(fx, 'darwin',
      `_svc_run_supervised fixture-x.service '${log}' - -- sh -c 'echo darwin-arm-ran'; echo "rc=$?"`);
    const m = /^nohup (\d+)\nrc=0$/.exec(r.stdout);
    expect(m, `stdout: ${r.stdout} / stderr: ${r.stderr}`).not.toBeNull();
    const pid = Number(m![1]);
    try {
      until(() => readFileSync(log, 'utf8').includes('darwin-arm-ran'));
      expect(readFileSync(log, 'utf8')).toBe('darwin-arm-ran\n');
      expect(managerCalls(fx), 'the Darwin answer is decided before the manager is asked').toEqual([]);
    } finally {
      reap(pid);
    }
  });

  it('refuses a NAME whose last _-segment ends with a secret word, in any case — 64, one stderr line naming it, its value never echoed, nothing asked', () => {
    // ALL FIVE ALTERNATIVES, each named by at least one row, so deleting any
    // one of them reds a row here: KEY (`LITELLM_MASTER_KEY`, `OPENAI_APIKEY`),
    // TOKEN (`ANTHROPIC_AUTH_TOKEN`), SECRET (`CLIENT_SECRET`), PASSWORD
    // (`DB_PASSWORD`) and PASSWD (`DB_PASSWD`). The name that PASSES is the
    // next case. Each is spelled as written AND lowercased: the rule is
    // case-insensitive, and only the lowercase spelling makes that a pinned
    // fact rather than a comment.
    const fx = svcFixture();
    const log = path.join(fx.home, 'refused.log');
    const value = `sk-${randomBytes(24).toString('hex')}`;
    for (const written of ['LITELLM_MASTER_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_APIKEY', 'CLIENT_SECRET', 'DB_PASSWORD', 'DB_PASSWD']) {
      for (const name of [written, written.toLowerCase()]) {
        const r = svc(fx, 'linux',
          `_svc_run_supervised fixture-x.service '${log}' - FIXTURE_OK=1 '${name}=${value}' -- /fixture/py; echo "rc=$?"`);
        expect(r.stdout, name).toBe('rc=64');
        expect(r.stderr.split('\n'), `${name}: one line`).toHaveLength(1);
        expect(r.stderr, name).toContain(name);
        expect(r.stderr.includes(value), `${name}: the value was echoed`).toBe(false);
      }
    }
    expect(managerCalls(fx), 'a refusal asks and starts nothing').toEqual([]);
    expect(existsSync(log), 'a refusal is decided before the log is touched').toBe(false);
  });

  it('passes CHATGPT_TOKEN_DIR, in any case — its last segment is DIR, so there is nothing to refuse and nothing to exempt', () => {
    // The lane's own litellm start passes this name. It is LiteLLM's variable
    // and says WHERE a credential lives; the rule reads the tail, and the
    // `TOKEN` inside it is not the tail. The fifth of the plan's five names.
    const fx = svcFixture();
    const log = path.join(fx.home, 'dir.log');
    for (const name of ['CHATGPT_TOKEN_DIR', 'chatgpt_token_dir']) {
      const r = svc(fx, 'linux',
        `_svc_run_supervised fixture-x.service '${log}' - ${name}=/fixture/tok -- /fixture/py; echo "rc=$?"`);
      expect(r.stdout, `${name}: ${r.stderr}`).toBe('systemd fixture-x.service\nrc=0');
    }
    expect(runCalls(fx).map((argv) => argv.filter((a) => a.startsWith('--setenv='))),
      'each spelling reached its unit as a pair, and nothing else did')
      .toEqual([['--setenv=CHATGPT_TOKEN_DIR=/fixture/tok'], ['--setenv=chatgpt_token_dir=/fixture/tok']]);
  });

  it('refuses a malformed argv — 64, one stderr line naming what is wrong, never an argument, nothing asked or started', () => {
    const fx = svcFixture();
    const log = path.join(fx.home, 'shape.log');
    const stray = `sk-${randomBytes(24).toString('hex')}`;
    const rows: Array<[string, string, string]> = [
      ['no arguments at all', '', 'fewer than three arguments'],
      ['two arguments', `u.service '${log}'`, 'fewer than three arguments'],
      ['an empty unit', `'' '${log}' - -- /fixture/py`, 'the unit name is empty'],
      ['an empty log', `u.service '' - -- /fixture/py`, 'the log must be an absolute path'],
      ['a relative log', `u.service logs/x.log - -- /fixture/py`, 'the log must be an absolute path'],
      ['an empty envfile', `u.service '${log}' '' -- /fixture/py`, 'the envfile must be - or an absolute path'],
      ['a relative envfile', `u.service '${log}' runtime.env -- /fixture/py`, 'the envfile must be - or an absolute path'],
      ["systemd's ignore-if-missing envfile form", `u.service '${log}' '-${fx.home}/runtime.env' -- /fixture/py`,
        'the envfile must be - or an absolute path'],
      ['no -- (the command read as a pair)', `u.service '${log}' - A=1 /fixture/py`, 'argument 5 is not NAME=value'],
      ['no -- and no command', `u.service '${log}' - A=1`, 'no -- before the command'],
      ['nothing after --', `u.service '${log}' - --`, 'nothing to run after --'],
      ['a stray value with no NAME=', `u.service '${log}' - '${stray}' -- /fixture/py`, 'argument 4 is not NAME=value'],
      ['a NAME starting with a digit', `u.service '${log}' - 1BAD=x -- /fixture/py`, 'argument 4 is not NAME=value'],
      ['a NAME with a dash', `u.service '${log}' - BAD-NAME=x -- /fixture/py`, 'argument 4 is not NAME=value'],
      ['an empty NAME', `u.service '${log}' - =x -- /fixture/py`, 'argument 4 is not NAME=value'],
      ['a non-ASCII NAME', `u.service '${log}' - NAMÉ=x -- /fixture/py`, 'argument 4 is not NAME=value'],
    ];
    for (const [label, args, why] of rows) {
      const r = svc(fx, 'linux', `_svc_run_supervised ${args}; echo "rc=$?"`);
      expect(r.stdout, label).toBe('rc=64');
      expect(r.stderr.split('\n'), `${label}: one line`).toHaveLength(1);
      expect(r.stderr, label).toContain(why);
      expect(r.stderr.includes(stray), `${label}: an argument was echoed`).toBe(false);
    }
    expect(managerCalls(fx), 'a malformed argv asks and starts nothing').toEqual([]);
    expect(existsSync(log), 'and touches no log').toBe(false);
  });

  it('probes the states neither arm can report later — 1, one stderr line, before the manager is asked or anything backgrounds', () => {
    const fx = svcFixture();
    const log = path.join(fx.home, 'state.log');
    const envDir = path.join(fx.home, 'env-is-a-dir');
    mkdirSync(envDir);
    // A REGULAR FILE THE CALLER CANNOT READ. The two rows above are refused by
    // `-f` alone, so this is the row that makes the `-r` conjunct a pinned fact:
    // without it, a mode-000 key file reaches the manager and starts a unit
    // that cannot read its own environment. ROOT READS MODE 000, so under root
    // the row would be a false red and is left out; CI's runners are not root.
    const unreadable = path.join(fx.home, 'unreadable.env');
    writeFileSync(unreadable, 'FIXTURE_OK=1\n');
    chmodSync(unreadable, 0o000);
    const asRoot = process.getuid?.() === 0;
    const rows: Array<[string, 'linux' | 'darwin', string, string]> = [
      ['an absent envfile', 'linux', `fixture-x.service '${log}' '${fx.home}/absent.env' -- /fixture/py`, 'absent.env'],
      ['an envfile that is a directory', 'linux', `fixture-x.service '${log}' '${envDir}' -- /fixture/py`, 'env-is-a-dir'],
      ...(asRoot ? [] : [['an envfile with mode 000', 'linux',
        `fixture-x.service '${log}' '${unreadable}' -- /fixture/py`, 'unreadable.env'] as [string, 'linux' | 'darwin', string, string]]),
      ['a log whose directory is missing (systemd arm)', 'linux',
        `fixture-x.service '${fx.home}/no-such-dir/x.log' - -- /fixture/py`, 'no-such-dir'],
      ['a log whose directory is missing (nohup arm)', 'darwin',
        `fixture-x.service '${fx.home}/no-such-dir/x.log' - -- sh -c true`, 'no-such-dir'],
    ];
    for (const [label, os, args, names] of rows) {
      const r = svc(fx, os,
        `_svc_run_supervised ${args}\nrc=$?; echo "rc=$rc jobs=$(jobs -p | wc -l | tr -d ' ')"`);
      expect(r.stdout, label).toBe('rc=1 jobs=0');
      expect(r.stderr.split('\n'), `${label}: one line`).toHaveLength(1);
      expect(r.stderr, label).toContain(names);
    }
    expect(managerCalls(fx), 'every state is decided before the manager is asked').toEqual([]);
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

  it('_plat_ln_swap repoints a symlink-to-directory in one rename, with CCD_OS as the block computed it', () => {
    // The forced-Darwin cases above prove the argv and the postcondition on
    // Linux's rename(2); this is the same postcondition on APFS, through the
    // python3 the runner really has.
    const d = mkdtempSync(path.join(tmpdir(), 'ccrc-ln-swap-real-'));
    try {
      const old = path.join(d, 'v0.0.1');
      const next = path.join(d, 'v0.0.2');
      mkdirSync(old);
      mkdirSync(next);
      writeFileSync(path.join(old, 'OLD-MARKER'), 'old');
      const link = path.join(d, 'ccrc');
      symlinkSync(old, link);
      expect(inBlock(`_plat_ln_swap '${next}' '${link}'; echo $?`)).toBe('0');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe(next);
      expect(readdirSync(old), 'nothing may be moved inside the old version').toEqual(['OLD-MARKER']);
      expect(readdirSync(d).sort(), 'no staged <link>.new may be left').toEqual(['ccrc', 'v0.0.1', 'v0.0.2']);
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

// ── A PLATFORM CLAIM OWES THE OTHER PLATFORM AN ANSWER (D-2765) ───────────
// A case written as `itDarwin('BSD: it still ends a child that IGNORES
// SIGTERM')` red on macOS and was reported as a BSD fact. It was UNIVERSAL —
// Linux behaved identically, and the control that would have said so was never
// written.
//
// WHAT COULD NOT HAVE CAUGHT IT, and this is why the rule is shaped the way it
// is: the file already carried `itLinux` cases, and so did the same `describe`.
// Every coarser scan — "this file tests both platforms", "this describe tests
// both" — passes that case. The claim had no control; the FILE did. So the
// rule is per-CLAIM and it has exactly two satisfying forms:
//
//   • `platformContrast(subject, { darwin: […], linux: […] })`, where the two
//     arms cannot be separated because TypeScript refuses a missing key; or
//   • a bare `itDarwin`/`itLinux` carrying `PLATFORM-ONLY:` above it, naming
//     why the other platform has no counterpart.
//
// The second escape is deliberate and is not a weakening. Some platform cases
// are genuinely unpairable — an input only one kernel can produce, a binary
// only one userland ships — and forcing those into a contrast would manufacture
// a symmetry that is not there, which is its own kind of lie. What the rule
// refuses is the SILENT single-platform claim: the author must either write the
// other arm or say why there isn't one.
describe('a platform-asserting test title owes the other platform an answer (D-2765)', () => {
  const TEST_DIR = path.join(__dirname);
  // A title that NAMES a userland is making a comparative claim. A title that
  // merely happens to run on one platform is not, which is why this matches the
  // name-then-punctuation shape ("BSD:", "GNU —") rather than any mention.
  const ASSERTS_PLATFORM = /\b(BSD|macOS|darwin|GNU|util-linux|Linux|launchd|systemd)\b\s*[:—-]/i;
  const CASE = /\b(itDarwin|itLinux|describeDarwin|describeLinux)\(\s*(['"`])([\s\S]*?)\2/g;
  const MARKER = 'PLATFORM-ONLY:';

  it('every one of them is a platformContrast, or says why it cannot be', () => {
    const files = readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts')).sort();
    const offenders: string[] = [];

    for (const f of files) {
      const raw = readFileSync(path.join(TEST_DIR, f), 'utf8');
      const lines = raw.split('\n');
      // COMMENTS ARE BLANKED, not searched. This very scan's own prose quotes
      // the case that taught D-2765, and without this it reports itself —
      // measured, on the first run. Blanking rather than deleting keeps every
      // line number pointing where the reader expects.
      const src = lines
        .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l))
        .join('\n');
      for (const m of src.matchAll(CASE)) {
        const title = m[3]!;
        if (!ASSERTS_PLATFORM.test(title)) continue;
        // The marker has to be NEAR the case, not anywhere in the file — a
        // reason eight lines up is still about this case; one 300 lines up is
        // about something else.
        const lineNo = src.slice(0, m.index).split('\n').length;
        const above = lines.slice(Math.max(0, lineNo - 9), lineNo).join('\n');
        if (above.includes(MARKER)) continue;
        offenders.push(`${f}:${lineNo}  ${m[1]}(${JSON.stringify(title.slice(0, 70))})`);
      }
    }

    expect(
      offenders,
      'These name a platform in their title, so they assert that platform behaves a particular way — and\n'
      + 'nothing here answers for the other one. That is D-2765: the case that taught this red on macOS and\n'
      + 'was reported as a BSD fact when Linux did exactly the same thing.\n\n'
      + 'Either make it a `platformContrast(subject, { darwin: [...], linux: [...] })` from\n'
      + '`platformFixtures.ts`, which cannot be written with one arm — or, if the other platform genuinely\n'
      + 'has no counterpart, put a `PLATFORM-ONLY: <why>` comment within 8 lines above it.\n\n'
      + offenders.join('\n'),
    ).toEqual([]);
  });
});
