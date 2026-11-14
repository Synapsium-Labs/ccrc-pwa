// `ccrc doctor`, part: fleet-wrappers (D-6767): the wrappers and credentials checks. They moved here unchanged from
// `ccrc-doctor-fleet.test.ts`, itself a part of what was one 17,000-line file, which ran about 386 s on a CI runner and past the
// trace job's 1560 s budget under `strace -f`; the fixtures the parts share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, openSync, writeSync, ftruncateSync, closeSync } from 'node:fs';
import path, { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { generateWrapperBody } from '../../shared/wrapper.mjs';
import { markGenerated } from '../../shared/mark.mjs';
import { installDoctorHooks, here, CCRC_SRC, CHECKS_SRC, LIB_SRC, unstub, linkReal, stubNodeRosterExit, UPSTREAM, writeRoster, writeRawRoster, entry, rawRoster, UP_JSON, binDir, writeWrapper, writeBinary, writeSymlinkWrapper, runDoctor, healthy, itCodex, healthyCodexBox, tableNames, lineFor, HEALTHY_SKIPS } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ── the roster against the wrappers on disk ───────────────────────────────
// Task 5. Deliberately stronger than the spec's "wrappers present and
// executable", because presence was never the failure mode: D-69 is a wrapper
// that is present, executable, and sourcing a secrets file its roster entry
// does not mention — which is invisible to every check that only stats a file.

describe('ccrc doctor: wrappers', () => {
  it('fails when a generated account declares no secretsFile but its wrapper sources one', () => {
    // D-69, reproduced as a fixture: the exact live shape on the fleet host,
    // where `claude-acme` is `{"kind":"generated"}` and its wrapper really does
    // source .cc-secrets/claude-acme-oauth.env.
    const home = healthy('ccrc-doctor-wrappers-d69-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/sources \.cc-secrets\/acct-a\.env.*roster declares none/);
  });

  it('fails the other direction too — the roster declares a secretsFile the wrapper does not source', () => {
    const home = healthy('ccrc-doctor-wrappers-reverse-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });                    // no secrets line
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    // The SENTENCE, not just the path: "acct-a sources  but the roster declares
    // …" is what a single catch-all comparison produces, and a verdict with a
    // hole in it is a verdict an operator has to guess at. Measured — deleting
    // this direction's own branch left every looser assertion green.
    expect(r.stdout).toMatch(/acct-a sources no secrets file but the roster declares \.cc-secrets\/acct-a\.env/);
    expect(r.code).toBe(1);
  });

  it('fails the THIRD way too — both name a secrets file and they are different files', () => {
    // The arm the whole-branch review found unpinned, and the one a real box
    // reaches by the most ordinary route there is: somebody renamed the
    // credentials file and updated one side. Measured before the fix — with
    // this arm deleted the suite was 169/169 GREEN and doctor answered
    // `PASS wrappers: 2 accounts … match`, which is a wrapper loading
    // credentials nobody wrote down reported as a healthy box.
    //
    // The two paths are a NEAR MISS on purpose (the live shape is
    // `claude-acme-oauth.env`): unrelated names would also pass a comparison
    // that had been loosened to a prefix or substring test.
    const home = healthy('ccrc-doctor-wrappers-secrets-differ-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a-oauth.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /acct-a sources \.cc-secrets\/acct-a\.env but the roster declares \.cc-secrets\/acct-a-oauth\.env/);
    // BOTH paths, and the roster's one named rather than called "none": an
    // operator has to know which of the two files to go and look at, and this
    // arm collapsing into the first one's wording would say something false
    // about a roster that does declare a file.
    expect(r.stdout).not.toMatch(/acct-a sources .* but the roster declares none/);
    expect(r.code).toBe(1);
  });

  it('fails when a roster account has no wrapper at all', () => {
    const home = healthy('ccrc-doctor-wrappers-ghost-');
    writeRoster(home, [{ id: 'ghost', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    // `$HOME` as written, not as resolved: it is how the wrapper spells its own
    // paths, so the operator can grep for the same string.
    expect(r.stdout).toMatch(/FAIL wrappers: ghost .*no executable at \$HOME\/\.local\/bin\/ghost/);
  });

  // ── D-82: absent is not disagreement ────────────────────────────────────
  // "nothing exists on disk for `ccrc wrappers` to refuse" and "the roster and
  // the wrapper on disk describe two different things" are two findings an
  // operator fixes with two different commands — `ccrc wrappers` writes the
  // first kind from nothing, but does not touch a file `ccrc wrappers` would
  // itself refuse to overwrite, so pointing an absent-wrapper operator at "make
  // the roster and the wrapper agree" sends them looking for a wrapper that was
  // never written in the first place.
  it('fails an absent generated wrapper with the ccrc-wrappers remedy, not the roster-sync one (D-82)', () => {
    // MEASURED RED (before the split): `_dr_wr_present` appended the absent
    // finding to `wr_hard` same as every disagreement, so the FAIL's remedy
    // was the generic "the roster is the source of truth … 'ccrc adopt
    // --out /tmp/accounts.json' prints what a rediscovery from disk would
    // say" sentence — the wrong instruction for an account nothing on disk
    // has ever tried to be.
    const home = healthy('ccrc-doctor-wrappers-absent-remedy-');
    writeRoster(home, [{ id: 'ghost', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: run: ccrc wrappers/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    expect(r.code).toBe(1);
  });

  it('reports an absent wrapper and a disagreeing one as two separate FAIL lines, each its own remedy (D-82)', () => {
    // MEASURED RED (before the split): one bucket, one `_dr_join`, one FAIL
    // line carrying both sentences ("ghost has no executable …; acct-a's
    // wrapper sets CLAUDE_CONFIG_DIR to .somewhere-else but the roster
    // declares .acct-a") and one remedy — the roster-sync sentence, wrong for
    // the absent half. `failIdx.length` was 1, not 2.
    //
    // MUTATION MEASURED (Step 5): re-merging `wr_absent` into `wr_hard` in the
    // working tree (both `_dr_wr_present` call sites passing `wr_hard`, and
    // dropping the `wr_absent` verdict block) turned this test and the one
    // above RED again, byte-identical to the pre-fix failures above — same
    // combined FAIL sentence, same wrong remedy, `failIdx.length` back to 1.
    // Reverted after the measurement; both tests are green against the
    // restored split.
    const home = healthy('ccrc-doctor-wrappers-absent-and-hard-');
    // ghost: generated, declared, nothing on disk at all — the ABSENT class.
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [
      { id: 'ghost', exec: { kind: 'generated' } },
      // acct-a: generated, present, but its wrapper's CLAUDE_CONFIG_DIR
      // disagrees with the roster's configDirSuffix — the DISAGREEMENT class.
      { id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } },
    ]);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const failIdx = lines.reduce<number[]>((acc, l, idx) => {
      if (l.startsWith('FAIL wrappers: ')) acc.push(idx);
      return acc;
    }, []);
    expect(failIdx.length, r.stdout).toBe(2);
    const [absentIdx, hardIdx] = failIdx;
    // The absent line comes FIRST — the verdict assembly's own ordering.
    expect(lines[absentIdx]).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(lines[absentIdx + 1]).toMatch(/^ {2}remedy: run: ccrc wrappers/);
    expect(lines[hardIdx]).toContain('acct-a');
    expect(lines[hardIdx]).toMatch(/\.somewhere-else.*\.acct-a/);
    // The DISAGREEMENT remedy stays the verbatim roster sentence (the pin at
    // ccrc-doctor-checks:1012 / the "keeps a soft finding OFF the FAIL line"
    // test above) — the split must not have touched wr_hard's own wording.
    expect(lines[hardIdx + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
    expect(r.code).toBe(1);
  });

  it('describes the account it is talking about, not whichever one came last in the roster', () => {
    // The finding names an id AND describes a file; both have to be the same
    // account. A `local dir="$1" id="$2" p="…/$id"` builds `p` from the
    // CALLER's `id` — bash expands the whole `local` before any name becomes
    // local — so the missing account got measured against the LAST roster
    // entry's wrapper and was reported with the wrong sentence. Invisible
    // whenever the missing account happens to be last, which is why this
    // fixture puts a real, present wrapper after it.
    const home = healthy('ccrc-doctor-wrappers-wrong-account-');
    writeSymlinkWrapper(home, 'zz-last', 'zz-bespoke');
    writeRoster(home, [
      { id: 'ghost', exec: { kind: 'generated' } },
      { id: 'zz-last', exec: { kind: 'external' } },
    ]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/ghost has no executable at \$HOME\/\.local\/bin\/ghost/);
    expect(r.stdout).not.toMatch(/ghost is declared generated but/);
  });

  it('fails when the wrapper points at a config dir the roster does not declare', () => {
    const home = healthy('ccrc-doctor-wrappers-cfgdir-');
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/\.somewhere-else.*\.acct-a/);
    expect(r.code).toBe(1);
  });

  it('fails when a generated wrapper execs something other than the roster\'s upstream account', () => {
    const home = healthy('ccrc-doctor-wrappers-target-');
    writeWrapper(home, 'acct-a', { target: 'some-other-binary' });
    writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a/);
    expect(r.stdout).toMatch(/some-other-binary/);
    expect(r.code).toBe(1);
  });

  it('leaves an external account alone — ccrc records it and never touches it', () => {
    // `gpt` on the reference box is a symlink to a bespoke script. It has no
    // generated shape and must not be reported as broken for lacking one — nor
    // may its symlink TARGET be reported as an account of its own.
    const home = healthy('ccrc-doctor-wrappers-external-');
    writeSymlinkWrapper(home, 'ext-a', 'bespoke-tool');
    writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-a/);
    expect(r.stdout).not.toMatch(/bespoke-tool/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
  });

  it('passes when the upstream account is a non-script binary, which is its normal shape', () => {
    const home = healthy('ccrc-doctor-wrappers-upstream-');
    writeBinary(home, 'up');                       // the real claude is a 300MB ELF
    writeRoster(home, [{ id: 'up', exec: { kind: 'upstream' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/FAIL wrappers/);
    expect(r.code).toBe(0);
  });

  it('names what it measured when everything agrees, never the bare word "ok"', () => {
    const home = healthy('ccrc-doctor-wrappers-ok-');
    writeWrapper(home, 'acct-a', { secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{
      id: 'acct-a', exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const line = lineFor(runDoctor(home).stdout, 'wrappers');
    expect(line).toMatch(/^PASS wrappers: /);
    expect(line).toMatch(/2 accounts/);
    expect(line).toContain('accounts.json');
  });

  itCodex('a correctly installed Codex lane passes the wrappers check and reports its one lane', async () => {
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-healthy-');
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'wrappers');
    expect(line, r.stdout).toMatch(/^PASS wrappers: /);
    expect(line).toMatch(/\(1 upstream, 0 generated, 0 external, 1 Codex\)$/);
    expect(r.code).toBe(0);
  });

  itCodex('a Codex launcher execing the upstream account instead of ccrc-codex fails and names both', async () => {
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-target-');
    writeWrapper(home, 'codex-a', { cfgDir: '.claude-codex-a', target: 'claude' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /FAIL wrappers: codex-a's wrapper execs \$HOME\/\.local\/bin\/claude, not ccrc-codex/);
    expect(r.code).toBe(1);
  });

  itCodex('a Codex launcher execing ccgpt — another repository\'s launcher on the fleet box — fails and names ccrc-codex (D-3478)', async () => {
    // The one wrong target that LOOKS right: Plan 1 shipped `ccgpt` as the
    // expected value, and on the fleet box that name is another repository's
    // live launcher, which picks its own first lane when none is named.
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-ccgpt-');
    writeWrapper(home, 'codex-a', { cfgDir: '.claude-codex-a', target: 'ccgpt' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(
      /FAIL wrappers: codex-a's wrapper execs \$HOME\/\.local\/bin\/ccgpt, not ccrc-codex/);
    expect(r.code).toBe(1);
  });

  itCodex('the launcher the writer generates for a Codex lane passes — writer and checker name one target', async () => {
    // The literal cases above pin each side's spelling; this pins that the two
    // sides AGREE, through the real writer, so renaming one side alone reds here.
    const { generateWrapperBody } = await import('../../shared/wrapper.mjs');
    const { markGenerated } = await import('../../shared/mark.mjs');
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-writer-');
    writeFileSync(join(binDir(home), 'codex-a'), markGenerated(generateWrapperBody(
      { id: 'codex-a', configDirSuffix: '.claude-codex-a', execKind: 'codex' }, 'claude')), { mode: 0o755 });
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'wrappers'), r.stdout).toMatch(/^PASS wrappers: /);
    expect(r.code).toBe(0);
  });

  itCodex('an absent Codex launcher fails in the absent bucket with the ccrc-wrappers remedy', async () => {
    const home = await healthyCodexBox('ccrc-doctor-wrappers-codex-absent-');
    rmSync(join(binDir(home), 'codex-a'), { force: true });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/codex-a has no executable at \$HOME\/\.local\/bin\/codex-a/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: run: ccrc wrappers/);
    expect(lines[i + 1]).toMatch(/writes every generated and Codex account's wrapper/);
    expect(r.code).toBe(1);
  });

  it('WARNS about a wrapper on disk the roster describes nowhere — reported, never resolved', () => {
    // adopt's bias rule (ccrc-adopt:41-48), carried over: the ambiguous case is
    // REPORTED. It is not a FAIL — keeping a launcher the fleet does not drive
    // is a legitimate thing to do — but a silent pass would hide the account
    // that was added to disk and never written down.
    const home = healthy('ccrc-doctor-wrappers-undeclared-');
    writeWrapper(home, 'stray', { cfgDir: '.stray' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: .*stray/m);
    expect(r.code).toBe(0);
  });

  it('does not count a symlink alias of a declared wrapper as a second account', () => {
    // The measured shape: `gpt -> ccgpt`, both in ~/.local/bin, one file. The
    // alias is not an undeclared account, and saying it is would make the WARN
    // above fire on every box that has one.
    const home = healthy('ccrc-doctor-wrappers-alias-');
    writeSymlinkWrapper(home, 'ext-a', 'ccgpt-like');
    writeRoster(home, [{ id: 'ext-a', exec: { kind: 'external' } }]);
    expect(runDoctor(home).stdout).not.toMatch(/ccgpt-like/);
  });

  it('fails when this box has no roster at all, rather than reporting agreement nobody measured', () => {
    const home = healthy('ccrc-doctor-wrappers-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    const r = runDoctor(home);
    // "absent" and "there is something there but it is not a file" are two
    // conditions an operator acts on differently, so the message is asserted,
    // not just the FAIL: measured, deleting the absent branch left the file's
    // NEXT guard answering for it with the wrong sentence, and every looser
    // assertion stayed green.
    expect(r.stdout).toMatch(/^FAIL wrappers: no account roster at \$HOME\/\.ccrc\/accounts\.json/m);
    expect(r.code).toBe(1);
  });

  it('refuses a roster with zero accounts rather than reporting agreement nobody measured', () => {
    // A scan over an empty list passes everything — this suite's own recurring
    // failure mode, and the reason `runs every check in the table` exists.
    const home = healthy('ccrc-doctor-wrappers-empty-');
    writeFileSync(join(home, '.ccrc', 'accounts.json'), JSON.stringify({ version: 1, accounts: [] }));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*zero accounts/m);
    expect(r.code).toBe(1);
  });

  it('a secrets guard that TESTS one path and SOURCES another is not the generated shape', () => {
    // The bug class `_wrap_parse_shape` reconstructs-and-compares to avoid
    // (ccrc-wrapper-shape, "EACH SIGNIFICANT LINE IS CHECKED BY STRIPPING"): a
    // regex capturing two occurrences of the same path in one line silently
    // accepts a MISMATCHED pair, and a wrapper that guards on a file it does
    // not load is a wrapper that starts unauthenticated with no error at all.
    const home = healthy('ccrc-doctor-wrappers-mismatched-pair-');
    writeFileSync(join(binDir(home), 'acct-a'), [
      '#!/usr/bin/env bash',
      'export CLAUDE_CONFIG_DIR="$HOME/.acct-a"',
      '[ -r "$HOME/.cc-secrets/acct-a.env" ] && . "$HOME/.cc-secrets/OTHER.env"',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{
      id: 'acct-a', configDirSuffix: '.acct-a',
      exec: { kind: 'generated', secretsFile: '.cc-secrets/acct-a.env' },
    }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a .*not the generated wrapper shape/);
    expect(r.code).toBe(1);
  });

  // D-81, the doctor side. `_wrap_parse_shape` (ccd/ccrc-wrapper-shape) reads
  // a candidate WHOLE (`mapfile -t lines < "$f"`) — unlike `_wrap_is_script`'s
  // two-byte gate, it has no bound at all. `ccrc wrappers` never asks it about
  // a genuinely oversize file post-D-81 (`deploy/gen-wrappers.mjs` classifies
  // one `oversize` before bash ever sees the disk path), but `_check_wrappers`
  // is a pure-bash roster-vs-disk comparison with no node-side gate ahead of
  // it, so it needs its own.
  //
  // The fixture starts with a real shebang and a real, EARLY, correctly
  // terminated `export CLAUDE_CONFIG_DIR=` line — so `_wrap_is_script` and
  // `_wrap_declares_config_dir` (the `wr_cands` scan, both cheap: the match is
  // found on line 2, before either reads a byte of the padding) admit it into
  // `wr_seen`, and the shape loop reaches it — then a SPARSE tail
  // (`ftruncateSync`, no real disk cost) pushes the file well past 1 MiB.
  // Without the gate, `_wrap_parse_shape` answers `no` too (the padding makes
  // `body` the wrong length), so a bare "REFUSE"-shaped assertion would not
  // distinguish "fixed" from "unfixed" — the SENTENCE is the pin, because it
  // is the one thing that changes: "over 1 MiB … never read" only appears once
  // the size gate exists to say it, in place of the generic "not the generated
  // shape" wording the unbounded read would otherwise reach.
  //
  // The gate is `command -v stat`-guarded (this file's own `df`/`git`/`gh`
  // idiom), and `healthy()`'s fixture PATH has no real coreutils at all — so
  // this test links the box's REAL `stat` in, the same way `linkReal(home,
  // 'timeout')`/`linkReal(home, 'jq')` do elsewhere in the doctor suite for a check
  // that genuinely needs the real tool. Every OTHER wrapper test in this file
  // runs with no `stat` on PATH and is unaffected by this change: the guard's
  // fallback (fall through to the pre-D-81 unbounded read) is exactly what
  // every pre-existing green test already exercises, which is why none of
  // them needed to change.
  it('an oversize wrapper candidate fails with its own sentence, never read whole (D-81)', () => {
    const home = healthy('ccrc-doctor-wrappers-oversize-');
    linkReal(home, 'stat');
    const p = join(binDir(home), 'acct-a');
    const fd = openSync(p, 'w');
    try {
      const header = '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.acct-a"\n';
      writeSync(fd, header, 0, 'utf8');
      ftruncateSync(fd, 1024 * 1024 + header.length + 1); // over 1 MiB, sparse
    } finally {
      closeSync(fd);
    }
    chmodSync(p, 0o755);
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a's \$HOME\/\.local\/bin\/acct-a is over 1 MiB/);
    expect(r.stdout).toMatch(/never read/);
    expect(r.stdout).not.toMatch(/not the generated shape/);
  });

  // D-160, recorded on 2026-08-21 and fixed here. The gate above measured the
  // LINK, not the target: `stat -c%s` without `-L` answers the length of the
  // target-path STRING for a symlink. Measured live on the fleet box at the
  // time: `stat -c%s gpt` = 33 while the `ccgpt` behind it is 7.8 KB.
  //
  // So a wrapper that is a symlink to a huge file sailed through the size gate
  // and was then `mapfile`d whole by `_wrap_parse_shape` — reintroducing
  // exactly the unbounded read D-81 added the gate to close, through the one
  // shape the gate could not see. `ccd/ccrc-adopt`'s own scans have always used
  // `stat -L`; this one did not, and nothing said so.
  //
  // Symlinked wrappers are not hypothetical here: `~/.local/bin` is where the
  // upstream launcher and every account wrapper live side by side, and linking
  // one to another is the ordinary way a box gets a second name for a binary.
  it('measures a symlinked wrapper by its TARGET, not the link (D-160)', () => {
    const home = healthy('ccrc-doctor-wrappers-symlink-oversize-');
    linkReal(home, 'stat');
    // The oversize file lives OUTSIDE bin/, so the only thing the scan can see
    // in `~/.local/bin` is the link — which is the whole point. A copy in bin/
    // would be found by the plain `stat` too and prove nothing.
    const target = join(home, 'big-wrapper');
    const fd = openSync(target, 'w');
    try {
      const header = '#!/usr/bin/env bash\nexport CLAUDE_CONFIG_DIR="$HOME/.acct-a"\n';
      writeSync(fd, header, 0, 'utf8');
      ftruncateSync(fd, 1024 * 1024 + header.length + 1); // over 1 MiB, sparse
    } finally {
      closeSync(fd);
    }
    chmodSync(target, 0o755);
    symlinkSync(target, join(binDir(home), 'acct-a'));
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    // Same pin as the plain-file case above, and for the same reason: without
    // the gate `_wrap_parse_shape` also answers `no`, so only the SENTENCE
    // distinguishes "refused after measuring" from "refused after reading it
    // all". A link whose target-path string is short enough would otherwise
    // reach the generic wording.
    expect(r.stdout).toMatch(/FAIL wrappers: acct-a's \$HOME\/\.local\/bin\/acct-a is over 1 MiB/);
    expect(r.stdout).toMatch(/never read/);
    expect(r.stdout).not.toMatch(/not the generated shape/);
  });

  it('a roster that does not parse is its own answer, not "no roster"', () => {
    const home = healthy('ccrc-doctor-wrappers-badjson-');
    writeFileSync(join(home, '.ccrc', 'accounts.json'), 'not json at all');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*does not parse/m);
    expect(r.stdout).not.toMatch(/no account roster/);
  });

  it('fails loudly, and names the file, when the wrapper-shape library did not ship', () => {
    // THE THIRD FILE. `ccrc` reaches its siblings through `${BASH_SOURCE[0]}`,
    // which bash does not resolve through a symlink, so `ccrc`,
    // `ccrc-doctor-checks` and `ccrc-wrapper-shape` must be installed into one
    // directory together. This is that requirement as a mechanism rather than a
    // sentence in a report.
    const home = healthy('ccrc-doctor-wrappers-nolib-');
    rmSync(join(home, 'ccrc', 'ccd', 'ccrc-wrapper-shape'), { force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*ccrc-wrapper-shape/m);
    expect(r.code).toBe(1);
  });

  // ── two classes of finding, two verdict lines ───────────────────────────
  // The reference box's own reading: one real defect (D-69) plus two launchers
  // somebody keeps on purpose. Joined into one FAIL sentence that read as three
  // defects, told the operator to reconcile the roster with launchers that are
  // not accounts, threw away the remedy that belonged to them, and let the
  // summary print `0 warned` with warn-class findings on the screen.
  /** The two-class fixture: a hard finding (D-69) and a soft one (an
   *  undeclared launcher) in the same run. */
  function twoClasses(prefix: string): string {
    const home = healthy(prefix);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeWrapper(home, 'stray', { cfgDir: '.stray' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    return home;
  }

  it('keeps a soft finding OFF the FAIL line — a launcher nobody declared is not a defect', () => {
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-fail-');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('acct-a sources .cc-secrets/acct-a.env');
    // THE PIN: the soft finding must not be laundered into the FAIL sentence.
    expect(lines[i]).not.toContain('stray');
    // …nor may the FAIL's remedy be the soft one's. "Make the roster and the
    // wrapper agree" is the wrong instruction for a deliberate launcher.
    expect(lines[i + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
  });

  it('still reports the soft findings when a hard one is present — its own line, its own remedy', () => {
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-warn-');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN wrappers: '));
    // THE OTHER PIN: dropping the soft findings whenever a hard one exists is
    // silent, and silence is the failure mode this check exists to end.
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('stray');
    expect(lines[i]).not.toContain('acct-a');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: either describe it/);
    expect(r.code).toBe(1);          // the worse class still decides the exit
  });

  it('counts BOTH lines in the summary — a run with a warning does not say "0 warned"', () => {
    // The count is over verdict LINES, so a check that answered in two classes
    // is counted in both and the totals may exceed the number of checks. That
    // is the honest shape: it is what happened.
    const home = twoClasses('ccrc-doctor-wrappers-two-classes-summary-');
    const r = runDoctor(home);
    const last = r.stdout.split('\n').filter(Boolean).pop() ?? '';
    const m = /^summary: (\d+) checks \((\d+) skipped\), (\d+) verdicts — (\d+) passed, (\d+) warned, (\d+) failed$/.exec(last);
    expect(m, `last line was: ${last}`).toBeTruthy();
    const [total, skipped, verdicts, pass, warn, fail] = m!.slice(1).map(Number);
    expect(total).toBe(tableNames().length);
    expect(skipped).toBe(HEALTHY_SKIPS);
    expect(warn).toBeGreaterThanOrEqual(1);
    expect(fail).toBeGreaterThanOrEqual(1);
    // BOTH nouns, because they are different numbers here: twelve checks
    // answered with thirteen verdicts. The line says which is which so that the
    // sum not matching the leading number reads as the fact it is rather than
    // as an arithmetic bug somebody should go and "fix".
    expect(pass + warn + fail).toBe(verdicts);
    // The comparison is against the checks that ANSWERED WITH A VERDICT, not
    // against every check in the table. A skip subtracts a verdict without
    // subtracting a check, so on a platform that legitimately skips some
    // (every platform: `models`; macOS also: `scopes`) the two-class check's
    // extra verdict is cancelled exactly, and `verdicts > total` reads
    // 26 > 26 — a red leg reporting arithmetic that was never wrong. On
    // Linux `HEALTHY_SKIPS` is 1 (`models`) and this is the assertion it
    // always was, just no longer over a zero skip count.
    expect(verdicts).toBeGreaterThan(total - HEALTHY_SKIPS);
  });

  // ── an external account: existence, and nothing else ────────────────────
  it('passes a COMPILED external launcher — an external account\'s content is never read', () => {
    // The measured defect: `wr_seen` demanded a script carrying a literal
    // `export CLAUDE_CONFIG_DIR=` line, so a legitimate external account was
    // reported as `ext-bin is declared external but … is not a script`.
    const home = healthy('ccrc-doctor-wrappers-extcompiled-');
    writeBinary(home, 'ext-bin');
    writeRoster(home, [{ id: 'ext-bin', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-bin/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
    expect(r.code).toBe(0);
  });

  it('passes an external launcher that spells CLAUDE_CONFIG_DIR its own way', () => {
    // `CLAUDE_CONFIG_DIR=… exec claude "$@"` is a perfectly good launcher and
    // matches no `^\s*export\s+CLAUDE_CONFIG_DIR=` line. ccrc does not write
    // external wrappers, so it has no standing to demand a spelling of one.
    const home = healthy('ccrc-doctor-wrappers-extinline-');
    writeFileSync(join(binDir(home), 'ext-sh'), [
      '#!/usr/bin/env bash',
      'CLAUDE_CONFIG_DIR="$HOME/.ext-sh" exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{ id: 'ext-sh', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).not.toMatch(/ext-sh/);
    expect(lineFor(r.stdout, 'wrappers')).toMatch(/^PASS wrappers: /);
  });

  it('fails an external account with no executable at all — presence IS checked', () => {
    // The other half of the rule. "Never read" is not "never look".
    const home = healthy('ccrc-doctor-wrappers-ext-missing-');
    writeRoster(home, [{ id: 'ext-gone', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: ext-gone has no executable at \$HOME\/\.local\/bin\/ext-gone/);
    expect(r.code).toBe(1);
  });

  // ── the upstream account: the same presence triad ───────────────────────
  // A2-NEW: the absent-class arms of this triad (no file at all, a dangling
  // symlink) route to `wr_upstream`, not `wr_hard` — a fresh box that has
  // never had Claude Code installed is told to install it, not to reconcile a
  // roster that is already correct. The DETAIL sentence is unchanged (same
  // `_dr_wr_present` wording as the generated/external arms); only the
  // REMEDY moves. Present-but-wrong (not executable) is the one arm that
  // stays `wr_hard` — `_dr_wr_present` hard-wires that arm regardless of
  // which bucket the caller names, so a file on disk that disagrees is still
  // a roster/wrapper disagreement, not an absent binary.
  it('fails when the upstream account has no executable at all — told to install it, not sync the roster (A2-NEW)', () => {
    const home = healthy('ccrc-doctor-wrappers-up-missing-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude has no executable at \$HOME\/\.local\/bin\/claude/);
    // MEASURED RED (before A2-NEW's split): the remedy here was the generic
    // "the roster is the source of truth … 'ccrc adopt --out /tmp/accounts.json'"
    // sentence — the wrong instruction for a binary nothing on disk has ever
    // tried to be, and one a fresh-VM operator cannot act on.
    expect(lines[i + 1]).toMatch(/install Claude Code/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is a symlink to a path that does not exist — same install remedy (A2-NEW)', () => {
    const home = healthy('ccrc-doctor-wrappers-up-dangling-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    symlinkSync(join(home, '.local', 'share', 'claude', 'versions', 'gone'), join(binDir(home), 'claude'));
    const r = runDoctor(home);
    // The measured shape of a real upstream account is exactly this symlink,
    // pointing at a versions/ directory an update can remove.
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude's \$HOME\/\.local\/bin\/claude is a symlink to a path that does not exist/);
    expect(lines[i]).not.toMatch(/claude has no executable/);
    expect(lines[i + 1]).toMatch(/install Claude Code/);
    expect(lines[i + 1]).not.toMatch(/ccrc adopt/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is present but not executable — stays the roster-sync remedy', () => {
    // The DELIBERATE asymmetry, pinned from the other side: present-but-wrong
    // is a file on disk that disagrees, which `_dr_wr_present` hard-wires to
    // `wr_hard` no matter which bucket the caller names — a `chmod` is not an
    // install, so this one keeps the OLD remedy.
    const home = healthy('ccrc-doctor-wrappers-up-noexec-');
    chmodSync(join(binDir(home), 'claude'), 0o644);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL wrappers: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/claude's \$HOME\/\.local\/bin\/claude is not executable/);
    expect(lines[i + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
    expect(lines[i + 1]).not.toMatch(/install Claude Code/);
    expect(r.code).toBe(1);
  });

  it('both buckets in one run: an absent upstream binary and a disagreeing generated wrapper — two FAIL lines, distinct remedies, upstream first (A2-NEW)', () => {
    const home = healthy('ccrc-doctor-wrappers-upstream-and-hard-');
    // claude: upstream, declared, nothing on disk at all — the wr_upstream class.
    rmSync(join(binDir(home), 'claude'), { force: true });
    // acct-a: generated, present, but its wrapper's CLAUDE_CONFIG_DIR disagrees
    // with the roster's configDirSuffix — the wr_hard (disagreement) class.
    writeWrapper(home, 'acct-a', { cfgDir: '.somewhere-else' });
    writeRoster(home, [
      UPSTREAM,
      { id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } },
    ]);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const failIdx = lines.reduce<number[]>((acc, l, idx) => {
      if (l.startsWith('FAIL wrappers: ')) acc.push(idx);
      return acc;
    }, []);
    expect(failIdx.length, r.stdout).toBe(2);
    const [upstreamIdx, hardIdx] = failIdx;
    // The upstream line comes FIRST — the verdict assembly's own ordering,
    // most-actionable leads.
    expect(lines[upstreamIdx]).toMatch(/claude has no executable at \$HOME\/\.local\/bin\/claude/);
    expect(lines[upstreamIdx + 1]).toMatch(/install Claude Code/);
    expect(lines[hardIdx]).toContain('acct-a');
    expect(lines[hardIdx]).toMatch(/\.somewhere-else.*\.acct-a/);
    expect(lines[hardIdx + 1]).toMatch(/^ {2}remedy: the roster is the source of truth/);
    expect(r.code).toBe(1);
  });

  it('fails when the upstream account is ITSELF a script that sets CLAUDE_CONFIG_DIR', () => {
    // The upstream account is invoked with CLAUDE_CONFIG_DIR unset by
    // definition (ccrc-adopt's header). A wrapper there means every other
    // account's exec lands in whatever config dir this one exports.
    const home = healthy('ccrc-doctor-wrappers-up-is-wrapper-');
    writeWrapper(home, 'claude', { cfgDir: '.claude' });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: claude is the roster's upstream account, but \$HOME\/\.local\/bin\/claude is a script that sets CLAUDE_CONFIG_DIR/);
    expect(r.code).toBe(1);
  });

  // ── the four-way a-only split, pinned where it is easiest to collapse ────
  it('a generated account whose wrapper is a DANGLING SYMLINK says so, not "no executable"', () => {
    const home = healthy('ccrc-doctor-wrappers-gen-dangling-');
    symlinkSync(join(home, '.local', 'bin', 'nothing-here'), join(binDir(home), 'acct-a'));
    writeRoster(home, [{ id: 'acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is a symlink to a path that does not exist/);
    expect(r.stdout).not.toMatch(/acct-a has no executable/);
    expect(r.stdout).not.toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is not executable/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper is NOT EXECUTABLE says so, not "no executable"', () => {
    // A `chmod` and a reinstall are different actions, so these are different
    // sentences. The check's own comment calls this four-way split an
    // anti-overloaded-seam design; these two tests are what makes that true.
    const home = healthy('ccrc-doctor-wrappers-gen-noexec-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    chmodSync(join(binDir(home), 'acct-a'), 0o644);
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's \$HOME\/\.local\/bin\/acct-a is not executable/);
    expect(r.stdout).not.toMatch(/acct-a has no executable/);
    expect(r.stdout).not.toMatch(/is a symlink to a path that does not exist/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper is NOT A SCRIPT says so', () => {
    // Present, executable, and an ELF: the roster claims ccrc generated this
    // wrapper, and what is there was never generated by anything. Unpinned
    // until the round-2 review measured it — blanking this whole inner branch
    // left the suite green while a real defect went unreported.
    const home = healthy('ccrc-doctor-wrappers-gen-notscript-');
    writeBinary(home, 'acct-a');
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a is declared generated but \$HOME\/\.local\/bin\/acct-a is not a script/);
    expect(r.code).toBe(1);
  });

  it('a generated account whose wrapper sets NO CLAUDE_CONFIG_DIR says so', () => {
    // A script, executable, and it launches something — but it exports no
    // config dir, so it runs in whatever directory the caller had. That is a
    // different repair from "this is not a script at all".
    const home = healthy('ccrc-doctor-wrappers-gen-nocfgdir-');
    writeFileSync(join(binDir(home), 'acct-a'), [
      '#!/usr/bin/env bash',
      '# no export line at all',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a is declared generated but \$HOME\/\.local\/bin\/acct-a sets no CLAUDE_CONFIG_DIR/);
    expect(r.stdout).not.toMatch(/is not a script/);
    expect(r.code).toBe(1);
  });

  it('keeps the two shape sentences DISTINCT when both defects are on one box', () => {
    // The merge this pins against is the one-liner a tidy-minded reader
    // reaches for: `… is not a wrapper` covering both. One run, both defects,
    // and the operator has to be able to tell which file needs which repair —
    // reinstall the wrapper, versus add the line it is missing.
    const home = healthy('ccrc-doctor-wrappers-shape-distinct-');
    writeBinary(home, 'acct-elf');
    writeFileSync(join(binDir(home), 'acct-sh'), [
      '#!/usr/bin/env bash',
      'exec "$HOME/.local/bin/claude" "$@"',
      '',
    ].join('\n'), { mode: 0o755 });
    writeRoster(home, [
      { id: 'acct-elf', configDirSuffix: '.acct-elf', exec: { kind: 'generated' } },
      { id: 'acct-sh', configDirSuffix: '.acct-sh', exec: { kind: 'generated' } },
    ]);
    const line = lineFor(runDoctor(home).stdout, 'wrappers') ?? '';
    expect(line).toContain('acct-elf is declared generated but $HOME/.local/bin/acct-elf is not a script');
    expect(line).toContain('acct-sh is declared generated but $HOME/.local/bin/acct-sh sets no CLAUDE_CONFIG_DIR');
    // Two findings, two sentences, and neither account is described by the
    // other's words.
    expect(line).not.toMatch(/acct-elf[^;]*sets no CLAUDE_CONFIG_DIR/);
    expect(line).not.toMatch(/acct-sh[^;]*is not a script/);
  });

  it('fails when what is at $HOME/.local/bin/<id> is a DIRECTORY, for either kind', () => {
    // A directory is `-e` and `-x` both — that is what the execute bit means
    // on one — so a presence check written as "exists and is executable" reads
    // `mkdir` as a healthy account. Both kinds that share `_dr_wr_present` are
    // in this one fixture, because the narrowing was in the shared helper.
    const home = healthy('ccrc-doctor-wrappers-dir-');
    rmSync(join(binDir(home), 'claude'), { force: true });
    mkdirSync(join(binDir(home), 'claude'), { recursive: true });
    mkdirSync(join(binDir(home), 'ext-dir'), { recursive: true });
    writeRoster(home, [{ id: 'ext-dir', exec: { kind: 'external' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/ext-dir's \$HOME\/\.local\/bin\/ext-dir is not a regular file/);
    expect(r.stdout).toMatch(/claude's \$HOME\/\.local\/bin\/claude is not a regular file/);
    expect(lineFor(r.stdout, 'wrappers')).not.toMatch(/^PASS/);
    expect(r.code).toBe(1);
  });

  // ── the roster as a document: every way it can be wrong ─────────────────
  it('fails when the same id is declared twice in the roster', () => {
    // Two entries, one wrapper: whichever one an operator edits, the other is
    // still there. A silent "last one wins" is how a fixed account stays broken.
    const home = healthy('ccrc-doctor-wrappers-dup-id-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    const e = entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } });
    writeRawRoster(home, rawRoster(UP_JSON, e, e));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*acct-a is declared twice in the roster/);
    expect(r.code).toBe(1);
  });

  it('fails when a roster entry has no id at all', () => {
    const home = healthy('ccrc-doctor-wrappers-no-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ configDirSuffix: '.x', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*the roster holds an account with no id/);
    expect(r.code).toBe(1);
  });

  it('refuses an id that is not an id, instead of inventing a plausible one', () => {
    // The reader used to squash `\t` to a space, so `"acct\tb"` was reported as
    // `acct b has no executable at …` — a sentence about an account that does
    // not exist, naming a file nobody could create. WRAPPER_ID_RE is the same
    // rule the disk side is held to; the id is echoed back as it was spelled.
    const home = healthy('ccrc-doctor-wrappers-illegal-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'acct\tb', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/FAIL wrappers: .*is not a legal account id/);
    expect(r.stdout).toContain('acct\\tb');
    expect(r.stdout).not.toMatch(/acct b/);
    expect(r.code).toBe(1);
  });

  it('escapes EVERY control byte, not the three that would break its own TSV', () => {
    // The verdict line is read by a human on a terminal that ACTS on control
    // bytes: `claude-x<BS>acme` renders as an account that exists. Escaping only
    // \t \r \n left the invented-id failure reachable through any other C0
    // byte, so the whole range is escaped and none of it reaches the output.
    const home = healthy('ccrc-doctor-wrappers-c0-id-');
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'claude-x\bacme', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toContain('claude-x\\x08acme');
    expect(r.stdout).toMatch(/is not a legal account id/);
    expect(r.stdout).not.toContain('\b');
    expect(r.stderr).not.toContain('\b');
  });

  it('escapes the backslash too, so an escaped id cannot be forged by a real one', () => {
    // Injectivity, which is the whole value of an escaped rendering: without
    // the backslash escape, an id spelled with a literal backslash-t and an id
    // carrying a real tab print IDENTICALLY, and the operator cannot tell
    // which of the two is in the file they are about to edit.
    const home = healthy('ccrc-doctor-wrappers-escape-injective-');
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'acct\tb', exec: { kind: 'generated' } }),        // a real TAB
      entry({ id: 'acct\\tb', exec: { kind: 'generated' } })));     // a literal backslash-t
    const line = lineFor(runDoctor(home).stdout, 'wrappers') ?? '';
    expect(line).toContain('acct\\tb');       // the tab, escaped
    expect(line).toContain('acct\\\\tb');     // the backslash, escaped — a different string
  });

  it('fails when a generated entry declares no configDirSuffix for its wrapper to match', () => {
    const home = healthy('ccrc-doctor-wrappers-no-suffix-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(UP_JSON, entry({ id: 'acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's roster entry declares no configDirSuffix, so its wrapper's \.acct-a answers to nothing/);
    expect(r.code).toBe(1);
  });

  it('fails on an exec.kind it does not understand rather than skipping the entry', () => {
    // The `*)` arm. An entry this check cannot classify is an entry it did not
    // check, and a doctor that silently skips one reports a box it never
    // measured.
    const home = healthy('ccrc-doctor-wrappers-bad-kind-');
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'weird' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/acct-a's roster entry declares no exec\.kind this check understands \("weird"\)/);
    expect(r.code).toBe(1);
  });

  it('WARNS when the roster declares no upstream account for an exec target to be checked against', () => {
    const home = healthy('ccrc-doctor-wrappers-no-upstream-');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: the roster declares no upstream account/m);
    expect(r.code).toBe(0);
  });

  it('WARNS when the roster declares more than one upstream account, and names the one it used', () => {
    const home = healthy('ccrc-doctor-wrappers-two-upstream-');
    writeBinary(home, 'claude-b');
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a' });
    writeRawRoster(home, rawRoster(UP_JSON,
      entry({ id: 'claude-b', configDirSuffix: '.claude-b', exec: { kind: 'upstream' } }),
      entry({ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } })));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN wrappers: the roster declares 2 upstream accounts; every exec target was checked against the first, claude$/m);
    expect(r.code).toBe(0);
  });

  it('fails when the roster parses but declares no accounts array', () => {
    const home = healthy('ccrc-doctor-wrappers-no-array-');
    writeRawRoster(home, '{"version":1}');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*parses but declares no accounts array/m);
    expect(r.stdout).not.toMatch(/does not parse/);
    expect(r.code).toBe(1);
  });

  it('fails when the roster path is not a regular file, rather than reading a directory', () => {
    const home = healthy('ccrc-doctor-wrappers-notafile-');
    rmSync(join(home, '.ccrc', 'accounts.json'), { force: true });
    mkdirSync(join(home, '.ccrc', 'accounts.json'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/no account roster at/);
    expect(r.code).toBe(1);
  });

  it.skipIf(process.getuid?.() === 0)(
    'a roster it cannot READ is its own answer, not "does not parse"', () => {
      // A mode/ownership fix and a restore-from-backup are different actions.
      // Skipped as root, where 000 is not a permission at all.
      const home = healthy('ccrc-doctor-wrappers-unreadable-');
      chmodSync(join(home, '.ccrc', 'accounts.json'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^FAIL wrappers: .*cannot be read \(EACCES\)/m);
      expect(r.stdout).not.toMatch(/does not parse/);
      expect(r.stdout).toMatch(/^ {2}remedy: .*ls -l/m);
      expect(r.code).toBe(1);
    });

  it('says node is missing, in its own words, rather than blaming the roster', () => {
    // A check must not fail for a reason that belongs to another check: with no
    // interpreter there is nothing wrong with the roster, and the remedy points
    // at the node check rather than at accounts.json.
    const home = healthy('ccrc-doctor-wrappers-nonode-');
    unstub(home, 'node');
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: node is not on PATH/m);
    expect(r.stdout).not.toMatch(/does not parse/);
    expect(r.code).toBe(1);
  });

  it('an unknown exit from the roster reader is called a bug in ccrc, not a fact about the box', () => {
    // The reader answers 0/3/4/5/6 and this arm is what happens when it one day
    // answers something else. Reached by making the interpreter itself fail for
    // the roster read only.
    const home = healthy('ccrc-doctor-wrappers-weird-exit-');
    stubNodeRosterExit(home, 7);
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: reading \$HOME\/\.ccrc\/accounts\.json exited 7 — this check does not know what that means/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.code).toBe(1);
  });

  it('fails when there is no $HOME/.local/bin at all', () => {
    const home = healthy('ccrc-doctor-wrappers-nobindir-');
    rmSync(join(home, '.local', 'bin'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^FAIL wrappers: no \$HOME\/\.local\/bin at all/m);
    expect(r.code).toBe(1);
  });

  it('never tells a deployed box to run a script from a checkout it does not have', () => {
    const text = readFileSync(CHECKS_SRC, 'utf8');
    // `ccrc adopt` execs ccrc-adopt where it ships; a remedy naming a repo-
    // relative path is an instruction only a developer can follow, and doctor's
    // whole job is the box that is not a developer's.
    expect(text).not.toMatch(/bash ccd\/ccrc-adopt/);
  });

  it('tells an operator with a missing wrapper which verb writes one', () => {
    // The a-only side of the roster/disk difference used to end in a paragraph
    // about what an account is. It is now a command.
    expect(readFileSync(CHECKS_SRC, 'utf8')).toMatch(/ccrc wrappers/);
  });

  // ── the security boundary ───────────────────────────────────────────────
  it('does not read, print, or hash the contents of any secrets file', () => {
    // The check compares PATHS. Reading the token would put it in a log — and
    // doctor's output is exactly the thing an operator pastes into a ticket.
    // Scanned across all three shipped files, not just the check's own: the
    // wrapper-shape library is where the secrets PATH is parsed out.
    for (const f of [CHECKS_SRC, LIB_SRC, CCRC_SRC]) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/cat\s+[^\n]*cc-secrets|\$\(<[^\n]*cc-secrets/);
      // The generic forms, not just the literal directory name: `$secrets` is
      // what the parsed path is called, and every way of opening it is banned.
      expect(src, f).not.toMatch(/(?:cat|source|md5sum|sha\d+sum|head|tail|mapfile|readarray)\s+[^\n|]*\$\{?(?:w?secrets|SECRETS)\b/);
      expect(src, f).not.toMatch(/<\s*"?\$\{?(?:w?secrets|SECRETS)\b/);
    }
  });

  it('never emits the contents of a secrets file it names — measured with a canary', () => {
    // The source scan above catches the copy someone would write; this catches
    // it however it was written. The file exists, it is readable, it is named
    // in the verdict, and its content must not appear anywhere in the output.
    const home = healthy('ccrc-doctor-wrappers-canary-');
    const canary = 'sk-ccrc-canary-do-not-print-e4f19b';
    mkdirSync(join(home, '.cc-secrets'), { recursive: true });
    writeFileSync(join(home, '.cc-secrets', 'acct-a.env'), `CLAUDE_CODE_OAUTH_TOKEN=${canary}\n`);
    writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
    writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    const r = runDoctor(home);
    expect(r.stdout).toContain('.cc-secrets/acct-a.env');   // the PATH is named
    expect(r.stdout).not.toContain(canary);                 // the CONTENT is not
    expect(r.stderr).not.toContain(canary);
  });

  it('answers the same whether the secrets file exists or not — it is a path, not a fact about a file', () => {
    // Two boxes, one roster, one wrapper: with the secrets file present and
    // absent. A check that stat'ed the path would answer differently, and would
    // then be reporting on the token's existence rather than on the roster.
    const withFile = healthy('ccrc-doctor-wrappers-sec-present-');
    const without = healthy('ccrc-doctor-wrappers-sec-absent-');
    for (const home of [withFile, without]) {
      writeWrapper(home, 'acct-a', { cfgDir: '.acct-a', secrets: '.cc-secrets/acct-a.env' });
      writeRoster(home, [{ id: 'acct-a', configDirSuffix: '.acct-a', exec: { kind: 'generated' } }]);
    }
    mkdirSync(join(withFile, '.cc-secrets'), { recursive: true });
    writeFileSync(join(withFile, '.cc-secrets', 'acct-a.env'), 'TOKEN=x\n');
    const line = lineFor(runDoctor(withFile).stdout, 'wrappers');
    // Not two undefineds: this fixture is the D-69 shape, so there IS a verdict
    // and it is a FAIL. Without this the comparison below passes on a box where
    // the check never ran at all.
    expect(line).toMatch(/^FAIL wrappers: acct-a /);
    expect(line).toBe(lineFor(runDoctor(without).stdout, 'wrappers'));
  });
});


describe('ccrc doctor: credentials', () => {
  it('passes on a healthy box and names what it measured', () => {
    const home = healthy('ccrc-doctor-cred-ok-');
    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('goes red — LOUDLY — when an expected token file is absent', () => {
    // THE WHOLE REASON THIS CHECK EXISTS. The roster structurally cannot declare
    // where an `upstream` account's credential lives, so the probe derives the
    // path by convention. A convention with no measurement is a silent skip
    // waiting to happen: the probe would refuse that account for ever and the
    // only place saying so would be a journal nobody reads.
    const home = healthy('ccrc-doctor-cred-missing-');
    rmSync(join(home, '.cc-secrets', 'claude-oauth.env'));
    const r = runDoctor(home);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude/m);
    expect(r.stdout).toMatch(/\.cc-secrets\/claude-oauth\.env/);
  });

  it('goes red on an EMPTY token file — E4: an empty bearer answers 429, not an auth error', () => {
    const home = healthy('ccrc-doctor-cred-empty-');
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'), '');
    expect(runDoctor(home).stdout).toMatch(/^FAIL credentials: claude/m);
  });

  it('never prints a byte of the file', () => {
    const home = healthy('ccrc-doctor-cred-quiet-');
    writeFileSync(join(home, '.cc-secrets', 'claude-oauth.env'),
      'export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-SENTINEL\n');
    const r = runDoctor(home);
    expect(r.stdout).not.toContain('SENTINEL');
    expect(r.stderr).not.toContain('SENTINEL');
  });

  it('uses a declared upstream setup-token path rather than the legacy filename', () => {
    const home = healthy('ccrc-doctor-cred-upstream-declared-');
    writeRoster(home, [{ id: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream', secretsFile: '.private/claude-setup.env' }, telemetry: 'anthropic' }]);
    mkdirSync(join(home, '.private'), { recursive: true });
    writeFileSync(join(home, '.private', 'claude-setup.env'), 'TOKEN=x\n');
    rmSync(join(home, '.cc-secrets', 'claude-oauth.env'));

    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('does not accept a stale legacy upstream file when its declaration is absent', () => {
    const home = healthy('ccrc-doctor-cred-upstream-declared-missing-');
    writeRoster(home, [{ id: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream', secretsFile: '.private/claude-setup.env' }, telemetry: 'anthropic' }]);

    const r = runDoctor(home);

    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude has no readable token at \$HOME\/\.private\/claude-setup\.env/m);
  });

  it('fails an invalid declared setup-token path rather than falling back to legacy OAuth', () => {
    const home = healthy('ccrc-doctor-cred-invalid-declared-');
    writeRoster(home, [{ id: 'claude', configDirSuffix: '.claude',
      exec: { kind: 'upstream', secretsFile: '.cc-secrets/../outside.env' }, telemetry: 'anthropic' }]);

    const r = runDoctor(home);

    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^FAIL credentials: claude has an invalid declared setup-token credential path/m);
  });

  it('checks a declared generated Anthropic setup token but ignores API-key and login lanes', () => {
    const home = healthy('ccrc-doctor-cred-subjects-');
    writeRoster(home, [UPSTREAM,
      { id: 'setup', exec: { kind: 'generated', provider: 'anthropic', secretsFile: '.private/setup.env' }, telemetry: 'anthropic' },
      { id: 'api', exec: { kind: 'generated', provider: 'openrouter', secretsFile: '.cc-secrets/api-openrouter.env' }, telemetry: 'anthropic' },
      { id: 'login', exec: { kind: 'generated', provider: 'anthropic' }, telemetry: 'anthropic' }]);
    mkdirSync(join(home, '.private'), { recursive: true });
    writeFileSync(join(home, '.private', 'setup.env'), 'TOKEN=x\n');

    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 2 account/m);
  });

  it('ignores a telemetry:none account — it has no Anthropic credential to have', () => {
    const home = healthy('ccrc-doctor-cred-none-');
    writeRoster(home, [UPSTREAM,
      { id: 'other-lane', exec: { kind: 'external' }, telemetry: 'none' }]);
    expect(runDoctor(home).stdout).toMatch(/^PASS credentials: 1 account/m);
  });

  it('SKIPs rather than PASSing when there is no roster — `wrappers` owns that fact', () => {
    // Two checks measuring one thing is how they come to disagree, and a doctor
    // that reports agreement it measured nothing is the worst failure this verb
    // has. No remedy under a skip, by this file's own contract.
    const home = healthy('ccrc-doctor-cred-noroster-');
    rmSync(join(home, '.ccrc', 'accounts.json'));
    expect(runDoctor(home).stdout).toMatch(/^SKIP credentials: /m);
  });

  it('SKIPs rather than FAILing when $HOME/.cc-secrets does not exist at all — the box is not provisioned yet', () => {
    // THE REGRESSION THIS TEST PINS. `ccrc install` runs `cmd_doctor` and dies
    // on any FAIL, so on every fresh box — and every install fixture — where
    // credentials have not been provisioned yet, this check must not be the
    // thing that blocks the install that has to happen BEFORE provisioning
    // can. "Not provisioned yet" is unmeasurable, and unmeasurable SKIPS; it is
    // a DIFFERENT finding from "provisioned, and this account's file happens
    // to be missing", which stays a FAIL (see the tests above and below this
    // one — they must stay red-on-delete for the arm to mean anything).
    const home = healthy('ccrc-doctor-cred-noprovision-');
    rmSync(join(home, '.cc-secrets'), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP credentials: /m);
    expect(r.stdout).not.toMatch(/^FAIL credentials: /m);
    expect(r.stdout).toMatch(/\.cc-secrets/);
  });
});
