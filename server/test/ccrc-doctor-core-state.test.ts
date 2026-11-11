// `ccrc doctor`, part: core-state (D-6767): the transcripts, update-sync, config and land-probe checks. They moved here unchanged
// from `ccrc-doctor-core.test.ts`, itself a part of what was one 17,000-line file, which ran about 410 s on a CI runner and past the
// trace job's 1560 s budget under `strace -f`; the fixtures the parts share are in `ccrc-doctorFixture.ts`.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, symlinkSync, rmSync, chmodSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { removeTmpFixturesEachTest } from './tmpHelpers.js';
import { seedAccountsSh } from './ccdWsHelpers.js';
import { writeShippedTimer } from './shippedTimers.js';
import { describeLinux, itLinux } from './platformFixtures.js';
import { installDoctorHooks, REPO, CHECKS_SRC, BASH, stubBin, linkReal, shq, writeCcrcEnv, unitDirOf, unitFileOf, writeUnitFile, removeUnitFile, doctorEnv, runDoctor, healthy, lineFor, anyVerdictFor, HEALTHY_SKIPS } from './ccrc-doctorFixture.js';

// Each case's homes go when the case ends, not in a file-wide end sweep (R100, review 518's S1): that sweep overran vitest's 20 s
// hook timeout on the one file this family was split from. Registered before `installDoctorHooks()`'s root `afterEach` (the codex
// lanes' process kill) because vitest runs after-hooks in reverse order of registration: that kill still sees its home.
removeTmpFixturesEachTest();
installDoctorHooks();

// ── transcripts: the operator's signal for a forked-session marker ────────
// Task 8 of the 2026-09-20-forked-session-transcript plan. Claude Code forks
// a live session into a background PTY under a new sessionId and writes a
// `continued-in` pointer as the last line of the transcript it abandons; a
// registry `ccd` has not yet followed still names that abandoned file, and
// the operator's chat freezes silently. This check counts how many registry
// sessions are in that state; it must read 0 on a converged box.
//
// `healthy()` owns no `$HOME/.cc-sessions` at all (no test in this file needs
// a registry), which is exactly the "nothing to measure" shape this check's
// vacuous PASS is for — and it never writes `~/.ccrc/accounts.sh` either, so
// a fixture that plants real sessions must seed both itself.
const TRANSCRIPT_ROSTER = { version: 1, accounts: [
  { id: 'claude', label: 'claude', configDirSuffix: '.claude', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
] };

/** Compact JSON, exactly the shape `_dr_continued_in` and `_continued_in_of`
 *  both key on — `JSON.stringify` with no replacer/space produces no space
 *  after `:`, which is the literal both bash readers match. */
const continuedInLine = (from: string, to: string): string =>
  `${JSON.stringify({ type: 'continued-in', sessionId: from, continuedInSessionId: to })}\n`;
const turnLine = (text: string): string =>
  `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;

/** One registry row, in the three flat files `_check_transcripts` reads
 *  itself (`<id>.uuid`, `<id>.wrapper`, `<id>.workdir`) — no ccd invoked, this
 *  check is deliberately readable with nothing but `cat`. */
function writeTranscriptSession(home: string, id: string, wrapper: string, workdir: string, uuid: string): void {
  const reg = join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  writeFileSync(join(reg, `${id}.uuid`), `${uuid}\n`);
  writeFileSync(join(reg, `${id}.wrapper`), `${wrapper}\n`);
  writeFileSync(join(reg, `${id}.workdir`), `${workdir}\n`);
}

/** The transcript file itself, munged the same way `ccd/ccd`'s `_munge_wd`
 *  and `server/src/munge.ts`'s `mungePath` both do — `tr './_' '---'` over the
 *  workdir. `forRawSpelling` writes under the UNRESOLVED munge (what a
 *  symlinked workdir sometimes writes under on the real fleet box, per
 *  `ccd-sync-uuid.test.ts`'s "follows a chain whose CURRENT transcript sits
 *  only at the raw spelling"); the default writes under the plain munge,
 *  which is both spellings at once whenever `workdir` carries no symlink. */
function writeTranscript(
  home: string, cfgSuffix: string, workdir: string, uuid: string, body: string,
): string {
  const munged = workdir.replace(/[/._]/g, '-');
  const dir = join(home, cfgSuffix, 'projects', munged);
  mkdirSync(dir, { recursive: true });
  const f = join(dir, `${uuid}.jsonl`);
  writeFileSync(f, body, 'utf8');
  return f;
}

/** `~/.ccrc/update-intent`, in `_upd_intent_state`'s own nine-line grammar
 *  (`updateIntentFixtures.ts`'s `readIntent` reads the same shape back;
 *  `update-intent-cross-side.test.ts` plants an identical document by hand
 *  for the same reason: a fixture writer belongs beside the check it feeds,
 *  not behind an import that would register a second file's tests here). */
function plantUpdateIntent(home: string, overrides: Partial<{
  epoch: number; issued: number; lease: number; channel: string;
  desired: string; desiredStable: string; desiredDev: string; auto: string;
}> = {}): void {
  const now = Math.floor(Date.now() / 1000);
  const o = {
    epoch: 1, issued: now, lease: now + 900, channel: 'stable',
    desired: 'v0.0.11', desiredStable: 'v0.0.11', desiredDev: 'v0.0.12', auto: 'off',
    ...overrides,
  };
  mkdirSync(join(home, '.ccrc'), { recursive: true });
  writeFileSync(join(home, '.ccrc', 'update-intent'), [
    `epoch ${o.epoch}`, `issued ${o.issued}`, `lease ${o.lease}`, `channel ${o.channel}`,
    `desired ${o.desired}`, `desired-stable ${o.desiredStable}`, `desired-dev ${o.desiredDev}`,
    `auto ${o.auto}`, 'end', '',
  ].join('\n'), { mode: 0o600 });
}


describe('ccrc doctor: transcripts', () => {
  it('passes on a registry whose sessions all read a live transcript', () => {
    const home = healthy('ccrc-doctor-transcripts-pass-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    // `_dr_continued_in` shells one real `tail -c` per examined transcript —
    // the one external process its pure-bash rewrite could not avoid (there
    // is no bash-only way to read a file's last N bytes). `healthy()`'s
    // contained PATH holds nothing but explicitly-fixtured binaries, so a
    // real `tail` has to be asked for by name, the same way it asks for
    // `realpath`, `jq` and `git` elsewhere in this file.
    linkReal(home, 'tail');
    const wdA = join(home, 'projects', 'demo-a');
    const wdB = join(home, 'projects', 'demo-b');
    mkdirSync(wdA, { recursive: true });
    mkdirSync(wdB, { recursive: true });
    const uuidA = 'a'.repeat(36), uuidB = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-a', 'claude', wdA, uuidA);
    writeTranscriptSession(home, 'sess-b', 'claude', wdB, uuidB);
    writeTranscript(home, '.claude', wdA, uuidA, turnLine('hello'));
    writeTranscript(home, '.claude', wdB, uuidB, turnLine('hi'));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: 2 session\(s\)/);
    // No overall-`.code` assertion here, deliberately: `seedAccountsSh`
    // hands `healthy()` a real account it was built without, so per-account
    // checks this test does not touch (`graphify`'s skill stamp, `memory`'s
    // session-hook reachability) now have a subject they were not
    // provisioned for and FAIL on their own account — collateral of seeding
    // a roster, not a finding about `transcripts`. `describe('ccrc doctor:
    // routing …')` establishes the same precedent for the same reason: once
    // a fixture adds a roster `healthy()` did not ship, only the ONE check's
    // own verdict line is asserted, never the whole run's exit code.
  });

  it('warns and names the session reading a superseded transcript', () => {
    const home = healthy('ccrc-doctor-transcripts-warn-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wdLive = join(home, 'projects', 'live-one');
    const wdFrozen = join(home, 'projects', 'frozen-one');
    mkdirSync(wdLive, { recursive: true });
    mkdirSync(wdFrozen, { recursive: true });
    const uuidLive = 'c'.repeat(36), uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-live', 'claude', wdLive, uuidLive);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wdFrozen, uuidOld);
    writeTranscript(home, '.claude', wdLive, uuidLive, turnLine('still going'));
    writeTranscript(home, '.claude', wdFrozen, uuidOld,
      `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    // The successor is WRITTEN: ccd would take this hop, so a registry still
    // on the old id is one ccd has not followed (DR2 — an unwritten successor
    // is named apart, below).
    writeTranscript(home, '.claude', wdFrozen, uuidNew, turnLine('after the fork'));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-frozen');
    expect(line, 'the live session must not be named').not.toContain('sess-live');
    expect(out).toMatch(/remedy: .+supervise tick/);
    // No overall-`.code` assertion — see the same note on the test above.
  });

  it('passes vacuously on a box with no sessions', () => {
    // The doctor's own healthy fixture has no `$HOME/.cc-sessions` at all — a
    // SKIP there is a check that cannot be counted (`_check_routing`'s rule:
    // it must state its own PASS in the same words a populated registry
    // would use, just with the count at zero).
    const home = healthy('ccrc-doctor-transcripts-vacuous-');
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: 0 session\(s\)/);
    expect(runDoctor(home).code).toBe(0);
  });

  it.skipIf(process.getuid?.() === 0)('fails when the registry cannot be searched', () => {
    const home = healthy('ccrc-doctor-transcripts-unsearchable-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    const reg = join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    writeFileSync(join(reg, 'sess-a.uuid'), `${'f'.repeat(36)}\n`);
    chmodSync(reg, 0o000);
    try {
      const out = runDoctor(home).stdout;
      const line = lineFor(out, 'transcripts');
      expect(line, out).toMatch(/^FAIL transcripts: /);
      expect(line).toContain('not a readable, searchable directory');
      expect(out).toContain('remedy: fix its mode');
      expect(runDoctor(home).code).toBe(1);   // a FAIL always fails the overall run
    } finally {
      chmodSync(reg, 0o755);
    }
  });

  it('warns when the roster projection cannot be read but sessions exist to measure', () => {
    // The reordering that keeps the vacuous-PASS case above vacuous: an
    // unreadable/absent roster is only this check's business once there is
    // at least one session for `_ccrc_cfg_dir` to have resolved. `healthy()`
    // itself never writes `~/.ccrc/accounts.sh` — this test plants a session
    // WITHOUT seeding one, which is the one shape that must still WARN.
    const home = healthy('ccrc-doctor-transcripts-no-roster-');
    writeTranscriptSession(home, 'sess-a', 'claude', join(home, 'projects', 'demo'), 'a'.repeat(36));
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('roster projection');
    expect(runDoctor(home).code).toBe(0);
  });

  it('finds the transcript through the RAW spelling when the workdir is reached through a symlink and the resolved munge has nothing (cross-task hazard, Task 6 review)', () => {
    // `_transcript_path` and `_ci_addrs`/`_ci_extant` (ccd/ccd) both try the
    // REALPATH-resolved munge FIRST and the raw munge SECOND, because Claude
    // Code munges its own physical cwd while the registry keeps the path ccd
    // wrote. A doctor that only tried the raw spelling — or only the resolved
    // one — would measure a file ccd does not, on a box shaped like this one.
    const home = healthy('ccrc-doctor-transcripts-raw-spelling-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    // A `realpath` that RESOLVES (`-m`), or the two spellings collapse into one
    // and this test cannot tell them apart: macOS's own `realpath` has no `-m`,
    // so the check falls back to the raw path there (#189 round 2: measured — a
    // lookup at one spelling only stayed green on this fixture without it).
    const gnu = ['grealpath', 'realpath'].map((n) => spawnSync('bash', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim())
      .find((p) => p !== '' && spawnSync(p, ['-m', '/nonexistent/x'], { encoding: 'utf8' }).status === 0);
    if (gnu !== undefined) { rmSync(join(stubBin(home), 'realpath'), { force: true }); symlinkSync(gnu, join(stubBin(home), 'realpath')); }
    const real = join(home, 'volume', 'demo');
    const link = join(home, 'projects-link');
    mkdirSync(real, { recursive: true });
    symlinkSync(join(home, 'volume'), link);
    const wd = join(link, 'demo');   // resolves to <home>/volume/demo
    const uuidOld = 'a'.repeat(36), uuidNew = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-raw', 'claude', wd, uuidOld);
    // Written under the RAW (unresolved) munge only — nothing exists at the
    // resolved (`volume/demo`) spelling at all.
    writeTranscript(home, '.claude', wd, uuidOld,
      `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));   // also at the raw spelling only (DR2)
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-raw');
    expect(line).toContain('Claude Code has superseded');
  });

  it('says how many rows it could NOT look at, and never counts them clean (whole-branch review, F4)', () => {
    // The check tries the two DIRECT spellings and `continue`d on a miss —
    // while still counting that row into the number it then reported as
    // "every registry uuid names a transcript Claude Code has not
    // superseded". A swapped session's row therefore read as healthy with
    // nothing having measured it, which is why the server's own ladder has a
    // uuid-glob rung and a foreign-account rung at all: that miss is routine.
    //
    // Fixture: one row that CAN be measured and is clean, and one whose
    // transcript exists at NEITHER spelling — planted under a project
    // directory no munge of its workdir produces, the same "stranded" idiom
    // `transcript-ladder.test.ts` uses for the glob rungs. The verdict must
    // name both counts.
    const home = healthy('ccrc-doctor-transcripts-skipped-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wdOk = join(home, 'projects', 'measurable');
    const wdSwapped = join(home, 'projects', 'swapped-away');
    mkdirSync(wdOk, { recursive: true });
    mkdirSync(wdSwapped, { recursive: true });
    const uuidOk = 'a'.repeat(36), uuidSwapped = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-ok', 'claude', wdOk, uuidOk);
    writeTranscriptSession(home, 'sess-swapped', 'claude', wdSwapped, uuidSwapped);
    writeTranscript(home, '.claude', wdOk, uuidOk, turnLine('hello'));
    // The swapped row's transcript, at an address neither spelling names.
    const stranded = join(home, '.claude', 'projects', '-a-directory-no-munge-produces');
    mkdirSync(stranded, { recursive: true });
    writeFileSync(join(stranded, `${uuidSwapped}.jsonl`), turnLine('carried elsewhere'), 'utf8');

    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: /);
    expect(line, 'the measured count').toContain('1 session(s) measured');
    expect(line, 'and the count it could not look at').toContain('1 not measured');
    // The overclaim this finding is about: a run with skipped rows must not
    // say EVERY registry uuid is healthy, in those words.
    expect(line, 'never the unqualified claim')
      .not.toContain('every registry uuid names a transcript Claude Code has not superseded');
  });

  it('refuses a marker whose sessionId is present but not a valid 36-character value — absence permits, a malformed author does not', () => {
    // The review-round finding `_continued_in_of` (ccd/ccd) was fixed for:
    // extracting `claims` straight through `grep -oE` with no presence check
    // first cannot tell "absent" from "present but malformed" — both leave
    // the extraction empty, and absence-permits would then wave a garbled
    // authorship claim through as if nobody had claimed it. This plants a
    // `sessionId` that is present and short, so a naive reader treats it as
    // absent and (wrongly) still follows the pointer; the fixed reader must
    // refuse the whole marker instead, leaving this session a PASS.
    const home = healthy('ccrc-doctor-transcripts-malformed-author-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'demo-malformed');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'a'.repeat(36), uuidNew = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-malformed', 'claude', wd, uuidOld);
    const badMarker = `${JSON.stringify({ type: 'continued-in', sessionId: 'not-a-real-uuid', continuedInSessionId: uuidNew })}\n`;
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before')}${badMarker}`);
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^PASS transcripts: 1 session\(s\)/);
    expect(out, 'the malformed author must not be waved through as stale').not.toMatch(/^WARN transcripts: /m);
  });

  // ── D-4940: the doctor reads the marker by the rule all three readers share
  it('counts a marker followed by the metadata Claude Code re-stamps at exit as superseded (D-4940)', () => {
    // Claude Code re-stamps last-prompt / ai-title records when its process
    // exits, and its own reader scans backwards past them. The old last-line
    // reader called this transcript live; ccd now follows it, so the doctor
    // must call it superseded until ccd has.
    const home = healthy('ccrc-doctor-transcripts-restamped-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'restamped');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'a'.repeat(36), uuidNew = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-restamped', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`
      + `${JSON.stringify({ type: 'last-prompt', lastPrompt: 'go on', sessionId: uuidOld })}\n`
      + `${JSON.stringify({ type: 'ai-title', aiTitle: 'a title', sessionId: uuidOld })}\n`);
    writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));
    const line = lineFor(runDoctor(home).stdout, 'transcripts');
    expect(line).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-restamped');
    expect(line).toContain('Claude Code has superseded');
  });

  it('never calls a session superseded over a marker-shaped object nested in a tool call (D-4940, review F1)', () => {
    const home = healthy('ccrc-doctor-transcripts-nested-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'nested');
    mkdirSync(wd, { recursive: true });
    const uuidA = 'a'.repeat(36), uuidB = 'b'.repeat(36);
    writeTranscriptSession(home, 'sess-nested', 'claude', wd, uuidA);
    writeTranscript(home, '.claude', wd, uuidA, `${turnLine('call a tool')}${JSON.stringify({
      parentUuid: 'u-1',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__x__y',
        input: { type: 'continued-in', continuedInSessionId: uuidB } }], stop_reason: 'tool_use' },
      type: 'assistant', sessionId: uuidA,
    })}\n`);
    const line = lineFor(runDoctor(home).stdout, 'transcripts');
    expect(line).toMatch(/^PASS transcripts: 1 session\(s\)/);
  });

  // ── D-4941: a measurement the doctor did not make is never reported as one
  it.skipIf(process.getuid?.() === 0)('a transcript whose tail cannot be read is NOT MEASURED, never counted clean (D-4941, review F2)', () => {
    // The PR's own stale fixture, made unreadable. `_dr_continued_in` used to
    // fold the failed `tail` into "not superseded", and the row was counted
    // inside "every registry uuid names a transcript Claude Code has not
    // superseded" — a PASS over a transcript nobody had read, which here is
    // in fact superseded.
    const home = healthy('ccrc-doctor-transcripts-unreadable-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');   // see the "passes on a registry…" test above
    const wd = join(home, 'projects', 'frozen-one');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
    const f = writeTranscript(home, '.claude', wd, uuidOld,
      `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    chmodSync(f, 0o000);
    try {
      const line = lineFor(runDoctor(home).stdout, 'transcripts');
      expect(line).toMatch(/^PASS transcripts: 0 session\(s\) measured, 1 not measured/);
      expect(line, 'and it says why').toContain('could not be read');
      expect(line, 'never the unqualified claim')
        .not.toContain('every registry uuid names a transcript Claude Code has not superseded');
    } finally {
      chmodSync(f, 0o600);
    }
  });

  it('a box whose PATH has no `tail` measures nothing, and says so rather than passing every row (D-4941, review F2)', () => {
    const home = healthy('ccrc-doctor-transcripts-no-tail-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    // deliberately NO linkReal(home, 'tail')
    const wd = join(home, 'projects', 'frozen-one');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    const line = lineFor(runDoctor(home).stdout, 'transcripts');
    expect(line).toMatch(/^PASS transcripts: 0 session\(s\) measured, 1 not measured/);
    expect(line).toContain('could not be read');
  });

  it('`_dr_continued_in` answers 2 for a failed read even when the file that sources it never set pipefail (D-4941)', () => {
    // `ccrc` sources this file under `set -uo pipefail`, so a whole-doctor run
    // cannot tell whether the reader sets it itself. Sourced bare here, with
    // no `tail` on the contained PATH: without its own `pipefail`, the failed
    // `tail` hides behind a jq that parsed nothing and the answer is 1.
    const home = healthy('ccrc-doctor-transcripts-bare-source-');
    const f = join(home, 'some.jsonl');
    writeFileSync(f, continuedInLine('a'.repeat(36), 'b'.repeat(36)));
    const r = spawnSync(BASH, ['-c',
      `. ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _dr_continued_in ${shq(f)} ${'a'.repeat(36)}; echo "rc=$?"`],
      { env: doctorEnv(home), encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('rc=2');
  });

  // ── D-4941: an unlistable registry is a FAIL, in the file's own idiom
  for (const [what, plant] of [
    ['searchable but not readable (0300)', (reg: string) => { chmodSync(reg, 0o300); }],
    ['readable but not searchable (0600)', (reg: string) => { chmodSync(reg, 0o600); }],
  ] as const) {
    it.skipIf(process.getuid?.() === 0)(`fails when the registry is ${what} (D-4941, review F3)`, () => {
      // The pre-scan's glob needs BOTH bits: without r it lists nothing,
      // without x it can stat nothing it lists — either way `any` stays 0 and
      // the check used to print the vacuous PASS over real, superseded rows.
      const home = healthy('ccrc-doctor-transcripts-mode-');
      seedAccountsSh(home, TRANSCRIPT_ROSTER);
      linkReal(home, 'tail');
      const wd = join(home, 'projects', 'frozen-one');
      mkdirSync(wd, { recursive: true });
      const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
      writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
      writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
      const reg = join(home, '.cc-sessions');
      plant(reg);
      try {
        const line = lineFor(runDoctor(home).stdout, 'transcripts');
        expect(line).toMatch(/^FAIL transcripts: /);
        expect(line).toContain('not a readable, searchable directory');
      } finally {
        chmodSync(reg, 0o755);
      }
    });
  }

  it('fails when the registry path is a file, or a symlink to nothing (D-4941)', () => {
    for (const shape of ['file', 'dangling'] as const) {
      const home = healthy(`ccrc-doctor-transcripts-${shape}-`);
      seedAccountsSh(home, TRANSCRIPT_ROSTER);
      const reg = join(home, '.cc-sessions');
      // EXECUTABLE and readable, so only the not-a-directory test can catch it.
      if (shape === 'file') writeFileSync(reg, 'not a directory\n', { mode: 0o755 });
      else symlinkSync(join(home, 'gone'), reg);
      const out = runDoctor(home).stdout;
      const line = lineFor(out, 'transcripts');
      expect(line, shape).toMatch(/^FAIL transcripts: /);
      // The remedy must be one that CAN clear this FAIL (D-4941). `chmod`
      // cannot turn a file into a directory or give a dangling link a target,
      // so a mode remedy here sends the operator round in a loop.
      expect(line, shape).toContain('is not a directory');
      const remedy = out.split('\n')[out.split('\n').indexOf(line!) + 1];
      expect(remedy, shape).toMatch(/^ {2}remedy: /);
      expect(remedy, shape).not.toContain('chmod');
      expect(remedy, shape).toContain(`ls -ld ${reg}`);
    }
  });

  // ── D-4941: the remedy is honest for rows no supervisor ticks
  it('a superseded STOPPED or ARCHIVED row is told it will be followed at its next resume, not to restart anything (D-4941)', () => {
    // No `ccd supervise` ticks a stopped or archived row, so "clears itself on
    // the next supervise tick … roll the fleet box forward" could never come
    // true for one. ccd follows the chain when such a session is next resumed
    // (D-4944), and the remedy says so.
    const home = healthy('ccrc-doctor-transcripts-parked-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const uuidNew = 'e'.repeat(36);
    const parked: [string, string, string][] = [['sess-stopped', 'stopped', 'a'.repeat(36)], ['sess-archived', 'archived', 'b'.repeat(36)]];
    for (const [id, stamp, uuid] of parked) {
      const wd = join(home, 'projects', id);
      mkdirSync(wd, { recursive: true });
      writeTranscriptSession(home, id, 'claude', wd, uuid);
      writeFileSync(join(home, '.cc-sessions', `${id}.${stamp}`), '');
      writeTranscript(home, '.claude', wd, uuid, `${turnLine('before the fork')}${continuedInLine(uuid, uuidNew)}`);
      writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));   // written: a hop ccd would take (DR2)
    }
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts');
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain('sess-stopped');
    expect(line).toContain('sess-archived');
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy, out).toContain('next resume');
    expect(remedy, 'no restart is prescribed for a row nothing supervises').not.toMatch(/supervise tick|roll the fleet box forward/);
  });

  it('names live and parked superseded rows apart, each with its own remedy clause (D-4941)', () => {
    const home = healthy('ccrc-doctor-transcripts-mixed-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const uuidNew = 'e'.repeat(36);
    for (const [id, uuid, stamp] of [['sess-live', 'a'.repeat(36), ''], ['sess-stopped', 'b'.repeat(36), 'stopped']] as const) {
      const wd = join(home, 'projects', id);
      mkdirSync(wd, { recursive: true });
      writeTranscriptSession(home, id, 'claude', wd, uuid);
      if (stamp !== '') writeFileSync(join(home, '.cc-sessions', `${id}.${stamp}`), '');
      writeTranscript(home, '.claude', wd, uuid, `${turnLine('before the fork')}${continuedInLine(uuid, uuidNew)}`);
      writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));   // written: a hop ccd would take (DR2)
    }
    const out = runDoctor(home).stdout;
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy, out).toMatch(/sess-live.*supervise tick/);
    expect(remedy, out).toMatch(/sess-stopped.*next resume/);
  });

  // ── #189 review round 2 ───────────────────────────────────────────────────
  /** `_check_transcripts` alone, sourced the way `ccrc` sources it, under a
   *  deadline: a check that blocks in open(2) is one failed case, not a hung
   *  suite (and not a hung `ccrc install`/`ccrc update`, which run the doctor
   *  at their tail). */
  const runTranscripts = (home: string): { code: number; stdout: string; stderr: string; hung: boolean } => {
    const r = spawnSync(BASH, ['-c',
      `set -uo pipefail; . ${shq(join(home, 'ccrc', 'ccd', 'ccrc-doctor-checks'))}; _check_transcripts`],
      { env: doctorEnv(home), encoding: 'utf8', timeout: 10000 });
    return { code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '', hung: r.error !== undefined || r.signal !== null };
  };
  /** One measurable, clean row beside the bad one, so a verdict is printed
   *  whatever the bad row does. */
  const goodRow = (home: string): void => {
    const wd = join(home, 'projects', 'good');
    mkdirSync(wd, { recursive: true });
    writeTranscriptSession(home, 'sess-good', 'claude', wd, 'a'.repeat(36));
    writeTranscript(home, '.claude', wd, 'a'.repeat(36), turnLine('hello'));
  };
  const badRow = (home: string): string => {
    const wd = join(home, 'projects', 'bad');
    mkdirSync(wd, { recursive: true });
    writeTranscriptSession(home, 'sess-bad', 'claude', wd, 'b'.repeat(36));
    writeTranscript(home, '.claude', wd, 'b'.repeat(36), turnLine('hello'));
    return join(home, '.cc-sessions');
  };

  for (const field of ['uuid', 'wrapper', 'workdir'] as const) {
    it(`a FIFO at a row's .${field} never blocks the check, and the row is counted apart (DR1)`, () => {
      const home = healthy(`ccrc-doctor-transcripts-fifo-${field}-`);
      seedAccountsSh(home, TRANSCRIPT_ROSTER);
      linkReal(home, 'tail');
      goodRow(home);
      const reg = badRow(home);
      rmSync(join(reg, `sess-bad.${field}`));
      execFileSync('mkfifo', [join(reg, `sess-bad.${field}`)]);
      const r = runTranscripts(home);
      expect(r.hung, 'the check blocked opening a FIFO').toBe(false);
      expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
      expect(r.stdout).toContain('own registry row could not be read');
      expect(r.stdout, 'not the account-swap reason').not.toContain('at neither direct spelling');
      expect(r.stderr).toBe('');
    });
  }

  it('a .uuid that is a symlink to a device never blocks the check (DR1)', () => {
    const home = healthy('ccrc-doctor-transcripts-devlink-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    rmSync(join(reg, 'sess-bad.uuid'));
    symlinkSync('/dev/zero', join(reg, 'sess-bad.uuid'));
    const r = runTranscripts(home);
    expect(r.hung).toBe(false);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
  });

  it.skipIf(process.getuid?.() === 0)('an unreadable .uuid prints nothing on stderr, and is not explained as an account swap (DR1)', () => {
    const home = healthy('ccrc-doctor-transcripts-mode000-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    chmodSync(join(reg, 'sess-bad.uuid'), 0o000);
    try {
      const r = runTranscripts(home);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('own registry row could not be read');
      expect(r.stdout).not.toContain('at neither direct spelling');
    } finally {
      chmodSync(join(reg, 'sess-bad.uuid'), 0o600);
    }
  });

  it('a row with no .wrapper (a `ccd forget` mid-walk) prints nothing on stderr, and is counted apart (DR1)', () => {
    const home = healthy('ccrc-doctor-transcripts-nowrapper-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    rmSync(join(reg, 'sess-bad.wrapper'));
    const r = runTranscripts(home);
    expect(r.stderr).toBe('');
    expect(r.stdout).toContain('own registry row could not be read');
  });

  it('a .uuid that is a DANGLING symlink is still a row — counted apart, never silently dropped (DR1, verifier D-V1)', () => {
    // The loop's guard is `-e || -L`: `-e` alone follows the link, finds
    // nothing, and the row vanished from the count — a PASS that says every
    // row was measured over a row nobody looked at.
    const home = healthy('ccrc-doctor-transcripts-dangling-uuid-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    rmSync(join(reg, 'sess-bad.uuid'));
    symlinkSync(join(home, 'nowhere', 'gone.uuid'), join(reg, 'sess-bad.uuid'));
    const r = runTranscripts(home);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
    expect(r.stdout).toContain('own registry row could not be read');
    expect(r.stderr).toBe('');
  });

  it('a row whose .workdir is EMPTY is counted apart — not explained as an account swap (DR1, verifier D-V2)', () => {
    const home = healthy('ccrc-doctor-transcripts-empty-workdir-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    writeFileSync(join(reg, 'sess-bad.workdir'), '');
    const r = runTranscripts(home);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
    expect(r.stdout).toContain('own registry row could not be read');
    expect(r.stdout, 'not the account-swap reason').not.toContain('at neither direct spelling');
  });

  it('a row whose wrapper the roster does not know is counted apart — not explained as an account swap (DR1, verifier D-V3)', () => {
    const home = healthy('ccrc-doctor-transcripts-unknown-wrapper-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    goodRow(home);
    const reg = badRow(home);
    writeFileSync(join(reg, 'sess-bad.wrapper'), 'claude-nosuch\n');
    const r = runTranscripts(home);
    expect(r.stdout).toMatch(/^PASS transcripts: 1 session\(s\) measured, 1 not measured/m);
    expect(r.stdout).toContain('own registry row could not be read');
    expect(r.stdout, 'not the account-swap reason').not.toContain('at neither direct spelling');
  });

  it('a marker whose successor was never written is NOT called superseded — it is named apart, with a remedy that can clear it (DR2)', () => {
    // ccd declines such a hop (D-4942) and a resume stays on the row's own
    // transcript (D-4944), so "roll the fleet box forward" and "the next
    // supervise tick" could never clear this WARN. 2.1.296 writes the marker
    // on its queued-for-later path too, and a worker killed before its first
    // line leaves the same state for good.
    const home = healthy('ccrc-doctor-transcripts-unwritten-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'forked');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-forked', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts') ?? '';
    expect(line, out).toMatch(/^WARN transcripts: /);
    expect(line).toContain(`names a successor never written here (sess-forked -> ${uuidNew} on claude)`);
    expect(line).not.toContain('Claude Code has superseded');
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy).toContain('first prompt it answers');
    expect(remedy).not.toMatch(/roll the fleet box forward|supervise tick|next resume/);
  });

  it('a successor that exists but is EMPTY is not one ccd would hop to either (DR2)', () => {
    const home = healthy('ccrc-doctor-transcripts-empty-successor-');
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'forked');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-forked', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    writeTranscript(home, '.claude', wd, uuidNew, '');
    const line = lineFor(runDoctor(home).stdout, 'transcripts') ?? '';
    expect(line).toContain('names a successor never written here');
  });

  it('a pending row on a lane that is not the default names ITS wrapper — `<wrapper> agents`, never `claude agents` (review round 3)', () => {
    // A background job lives under its own config dir's `jobs/`, so `claude
    // agents` on a `lane-b` row lists the DEFAULT config dir's agents: the
    // fork's starting job is not there, the operator concludes it "failed or
    // is gone", and the prompt they then send cancels the pointer while the
    // job is in fact still starting.
    const home = healthy('ccrc-doctor-transcripts-pending-lane-');
    seedAccountsSh(home, { version: 1, accounts: [
      ...TRANSCRIPT_ROSTER.accounts,
      { id: 'lane-b', label: 'lane-b', configDirSuffix: '.claude-lane-b',
        exec: { kind: 'generated', secretsFile: '.cc-secrets/lane-b-oauth.env' }, homeAble: true, hue: 'violet', telemetry: 'anthropic' },
    ] });
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'forked');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-forked', 'lane-b', wd, uuidOld);
    writeTranscript(home, '.claude-lane-b', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    const out = runDoctor(home).stdout;
    const line = lineFor(out, 'transcripts') ?? '';
    expect(line, out).toContain(`(sess-forked -> ${uuidNew} on lane-b)`);
    const remedy = /^WARN transcripts: .*\n\s+remedy: (.*)$/m.exec(out)?.[1] ?? '';
    expect(remedy).toContain('`<wrapper> agents`');
    expect(remedy).not.toContain('claude agents');
  });

  it('SKIPs on a server-role box — it hosts no sessions, so a registry left behind is not measured (review round 3)', () => {
    // A box that changed role from fleet to server and kept its old registry
    // would otherwise be told to "roll the fleet box forward" about rows no
    // supervisor runs for — and a box with no registry would print a vacuous
    // clean PASS the README's server-role rule says is not printed.
    const home = healthy('ccrc-doctor-transcripts-server-');
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    seedAccountsSh(home, TRANSCRIPT_ROSTER);
    linkReal(home, 'tail');
    const wd = join(home, 'projects', 'frozen');
    mkdirSync(wd, { recursive: true });
    const uuidOld = 'd'.repeat(36), uuidNew = 'e'.repeat(36);
    writeTranscriptSession(home, 'sess-frozen', 'claude', wd, uuidOld);
    writeTranscript(home, '.claude', wd, uuidOld, `${turnLine('before the fork')}${continuedInLine(uuidOld, uuidNew)}`);
    writeTranscript(home, '.claude', wd, uuidNew, turnLine('after the fork'));
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^SKIP transcripts: this box records CCRC_ROLE=server, so it hosts no sessions/m);
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) transcripts:/m);
  });
});


// ── update-sync: the EFFECT check, fix round 1 item 6 / review 155 C3 ─────
// `services` (above) measures the TIMER's own activation state, which stays
// `active` while its oneshot fails every run — this describe block is the
// ARTIFACT check that catches that, the identical shape `pool-sync` (above)
// is for its own sibling timer: `_upd_intent_state`'s own verdict on
// `~/.ccrc/update-intent`, never the timer's reported state. `healthy()`
// installs no `ccd-update-sync.timer` at all (see `HEALTHY_SKIPS`'s own
// docstring), so every test below plants the unit itself where the scenario
// needs a FLEET box, and the "no puller by configuration" SKIP is the one
// `healthy()` already proves on its own.
describe('ccrc doctor: update-sync', () => {
  it('SKIPs — no puller by configuration — on a box with no ccd-update-sync.timer installed at all', () => {
    const home = healthy('ccrc-doctor-update-sync-no-unit-');
    const line = lineFor(runDoctor(home).stdout, 'update-sync');
    expect(line).toBeUndefined();   // lineFor is PASS/WARN/FAIL only
    const any = anyVerdictFor(runDoctor(home).stdout, 'update-sync') ?? '';
    expect(any).toMatch(/^SKIP update-sync: /);
    expect(any).toContain('no puller here');
    expect(runDoctor(home).code).toBe(0);
  });

  itLinux('WARNs — not yet synced — when the timer was installed within its grace window and ~/.ccrc/update-intent has not been written yet', () => {
    const home = healthy('ccrc-doctor-update-sync-not-yet-synced-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-not-yet-synced');
    expect(lines[i]).toContain('has not been written yet');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(0);
  });

  itLinux('FAILs — never synced — when the timer was installed past its grace window and ~/.ccrc/update-intent has never been written', () => {
    const home = healthy('ccrc-doctor-update-sync-never-synced-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    // Past the check's 120s grace window (two of the timer's own 60s
    // periods) — the "had its chance and still never synced" case, not the
    // fresh-install case above.
    const past = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(join(unitDirOf(home), unitFileOf('ccd-update-sync.timer')), past, past);
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-unreadable');
    expect(lines[i]).toContain('never synced');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  itLinux('FAILs — stale — when the projection is past its lease, even though services still reports the timer active', () => {
    const home = healthy('ccrc-doctor-update-sync-stale-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    plantUpdateIntent(home, { issued: 1, lease: 1 });   // 1970 — long past its lease
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-stale');
    // `_upd_intent_state`'s own words (item 6's own instruction to reuse
    // them), not pool-sync's "past its lease" phrasing — this check never
    // re-derives its own verdict text.
    expect(lines[i]).toContain('its lease ended');
    // `services` still says the timer is fine — the exact false-PASS gap
    // this check exists to close, on the SAME box, in the SAME run.
    expect(lineFor(r.stdout, 'services')).toMatch(/^PASS services: /);
    expect(r.code).toBe(1);
  });

  itLinux('FAILs — malformed — when the timer is installed but the projection does not parse (never a WARN: this is the "every update refuses" class, not pool-sync\'s self-healing one)', () => {
    const home = healthy('ccrc-doctor-update-sync-malformed-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    mkdirSync(join(home, '.ccrc'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'update-intent'), 'not a projection at all\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-malformed');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: \S/);
    expect(r.code).toBe(1);
  });

  itLinux('PASSes when the timer is installed and the projection is fresh', () => {
    const home = healthy('ccrc-doctor-update-sync-fresh-');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    plantUpdateIntent(home);
    const line = lineFor(runDoctor(home).stdout, 'update-sync') ?? '';
    expect(line).toMatch(/^PASS update-sync: /);
    expect(line).toContain('within its lease');
    expect(runDoctor(home).code).toBe(0);
  });

  // Batch E review fix round 1, M3: the remedy is `_upd_intent_say`'s own,
  // role-aware — never a hard-coded puller remedy. The one box where the
  // hard-coded remedy was wrong: a server/both box carrying a LEFTOVER
  // `ccd-update-sync.timer` file (a role changed after install — `CCRC_ROLE`
  // is seed-once). There `_upd_intent_state` answers `unreadable (absent)`,
  // never `never synced` (that WHY is the fleet/no-role arm's own), so this
  // check's grace window never applies and falls straight to FAIL with the
  // SERVER remedy, not the puller's.
  itLinux('a leftover ccd-update-sync.timer on a server/both box gets the SERVER remedy from _upd_intent_say, never the puller one (M3)', () => {
    const home = healthy('ccrc-doctor-update-sync-leftover-timer-');
    writeCcrcEnv(home, 'CCRC_FLEET=local\nCCRC_HOST=127.0.0.1\nCCRC_PORT=7788\nCCRC_ROLE=server\n');
    writeUnitFile(home, 'ccd-update-sync.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-update-sync.timer'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL update-sync: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('update-sync-unreadable');
    expect(lines[i]).toContain('absent');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: ~\/\.ccrc\/update-intent is unreadable \(absent\) — restart ccrc\.service/);
    expect(lines[i + 1]).not.toContain('ccd-update-sync.service');
  });

  // Batch E review fix round 1, M4: the loaded-guard every sibling check
  // that calls a function declared in `ccrc` carries. Sourced bare (this
  // file alone, never `ccrc`), `_upd_intent_state` is undefined.
  it('says so, rather than guessing, when ccrc\'s own update-intent reader is not loaded', () => {
    const nowhere = join(REPO, 'no-such-home-for-check-update-sync');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_update-sync`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL update-sync: ccrc's own update-intent reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });
});


// ── the box's own config file ─────────────────────────────────────────────
// Stage 2d, Task 2, and the one check whose FAIL is a REPRODUCTION: a
// `CCRC_FLEET=remote` with no agent URL or token makes the server print one
// line and exit 1 at boot (server/src/index.ts#main). Before this check, that
// state was visible only as a service that would not come up.
//
// MUTATIONS MEASURED (applied to the shipped check, run, reverted):
//   - the `[ -r ]` guard deleted -> RED, "a ccrc.env it cannot READ is its own
//     answer…", `to match /^WARN config: .*cannot be read/`.
//   - the CCRC_AGENT_URL/TOKEN gap check deleted -> RED ×4, every "fails a
//     remote box where …" case (`expected -1 to be greater than -1` — no FAIL
//     line at all, i.e. the boot-refusal state passing).
//   - the mode classification made stricter than `config.ts` (`!= remote` ->
//     `-z "$mode"`, so any non-empty value reads as remote) -> RED ×2, "passes
//     a local box…" and "never quotes a value out of the file…".
//   - the absent-file WARN downgraded to a PASS -> RED, "warns, and names ccrc
//     install, when the box has no ccrc.env at all".
//   - D-86, fix round 1: the topology branch reverted (`if false`) -> RED,
//     "SKIPS an env-less FLEET-ROLE box…", `expected -1 to be greater than -1`
//     (the box gets the server-role WARN again — the finding itself).
//   - D-86: the `ccrc-agent.service` half of the conjunction dropped, so "no
//     ccrc.service" alone reads as the fleet role -> RED, "still WARNS a dev
//     checkout with no units at all…". BOTH halves are pinned, which is what
//     the branch's own comment claims.

describe('ccrc doctor: config', () => {
  it('warns, and names ccrc install, when the box has no ccrc.env at all', () => {
    const home = healthy('ccrc-doctor-config-none-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN config: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('defaults apply: local mode on 127.0.0.1:7788');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: .*ccrc install/);
    expect(runDoctor(home).code).toBe(0);
  });

  it('SKIPS an env-less FLEET-ROLE box rather than advising it to install a server', () => {
    // D-86, from the Task 2 review. THE LIVE FLEET HOST IS THIS FIXTURE: it has
    // no `ccrc.env` (this suite and `_check_fleet` both say so — it carries
    // `~/.ccrc/agent.env` instead), and `ccrc` ships there (deploy.sh (the ccrc install)), so
    // before the fix every doctor run on it printed "the server's defaults
    // apply: local mode on 127.0.0.1:7788" — about a server that does not run
    // there — with the remedy `ccrc install`, which is the single-box
    // SERVER-role installer. Wrong sentence and wrong instruction, on the one
    // box in the topology that has neither.
    //
    // The evidence is the unit-file topology `_check_services` already reads,
    // and nothing else: no new file, no new declaration, no guess.
    const home = healthy('ccrc-doctor-config-fleetrole-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    removeUnitFile(home, 'ccrc.service');
    writeUnitFile(home, 'ccrc-agent.service');
    writeFileSync(join(home, 'fixture-unit-ccrc-agent.service'), 'active\n');
    const r = runDoctor(home);
    const lines = r.stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('SKIP config: '));
    expect(i, r.stdout).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccrc-agent.service');
    expect(lines[i]).toMatch(/no .*ccrc\.env/);
    // The SKIP contract, all three halves: no verdict line, NO REMEDY under it
    // (a remedy reads as "there is something here to fix", and there is not),
    // and the runner counts it against checks rather than verdicts.
    expect(r.stdout).not.toMatch(/^(PASS|WARN|FAIL) config: /m);
    expect(lines[i + 1] ?? '').not.toMatch(/^ {2}remedy: /);
    expect(r.stdout).not.toMatch(/ccrc install/);
    // `fleet` skips on the same box for its own reason (no server address),
    // `auth` for a third (the session gate is the server's, and nothing on a
    // fleet host reads `~/.ccrc/auth.scrypt`), `build` for a fourth
    // (Stage 4, Task 9: no address means no server of its own to compare
    // against) — and `update-exposure` for a fifth (W4, design 2026-09-20
    // §12: a box with no server serves no update route to gate), so the
    // summary proves the runner accepted ALL FIVE skips.
    expect(r.stdout).toMatch(/^SKIP auth: .*ccrc-agent\.service/m);
    expect(r.stdout).toMatch(/^SKIP build: /m);
    expect(r.stdout).toMatch(/^SKIP update-exposure: .*ccrc-agent\.service/m);
    expect(r.stdout).toMatch(
      new RegExp(`^summary: \\d+ checks \\(${6 + HEALTHY_SKIPS} skipped\\)`, 'm'));
    expect(r.code).toBe(0);
  });

  it('still WARNS a dev checkout with no units at all — absence of units is not the fleet role', () => {
    // The other side of the same branch: "no ccrc.service" alone must not mean
    // "fleet host". A checkout that has never installed anything has no units
    // either, and for it the defaults sentence is exactly right.
    const home = healthy('ccrc-doctor-config-nounits-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    rmSync(unitDirOf(home), { recursive: true, force: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN config: .*defaults apply/m);
    expect(r.stdout).not.toMatch(/^SKIP config: /m);
  });

  it.each([
    ['neither key is there', 'CCRC_FLEET=remote\n'],
    ['the URL is empty', 'CCRC_FLEET=remote\nCCRC_AGENT_URL=\nCCRC_AGENT_TOKEN=t0ken\n'],
    ['the token is empty', 'CCRC_FLEET=remote\nCCRC_AGENT_URL=ws://fleet.invalid:7789\nCCRC_AGENT_TOKEN=\n'],
    ['only the URL is set', 'CCRC_FLEET=remote\nCCRC_AGENT_URL=ws://fleet.invalid:7789\n'],
  ] as const)('fails a remote box where %s — the server exits at boot in exactly this state', (_what, text) => {
    // server/src/index.ts#main: `if (!cfg.agentUrl || !cfg.agentToken) … exit(1)`.
    // Both halves of that condition are reachable here, because "empty" and
    // "absent" are the same thing to `config.ts#loadConfig` and must be the same
    // thing here.
    const home = healthy(`ccrc-doctor-config-remote-${_what.replace(/\W+/g, '-')}-`);
    writeCcrcEnv(home, text);
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('FAIL config: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toMatch(/CCRC_FLEET=remote/);
    expect(lines[i + 1]).toBe(
      '  remedy: set both CCRC_AGENT_URL and CCRC_AGENT_TOKEN in ~/.ccrc/ccrc.env, or set CCRC_FLEET=local');
    expect(runDoctor(home).code).toBe(1);
  });

  it('passes a coherent remote box — doctor judges the file, not the agent', () => {
    // Reachability is the `fleet` check's question and it has its own three
    // answers for it. This one asserts only what the file says, which is the
    // thing the server reads at boot.
    const home = healthy('ccrc-doctor-config-remote-ok-');
    writeCcrcEnv(home, [
      'CCRC_FLEET=remote',
      'CCRC_AGENT_URL=ws://fleet.invalid:7789',
      'CCRC_AGENT_TOKEN=ccrc-canary-agent-1f4d9',
      'CCRC_HOST=ccrc-fixture.invalid',
      'CCRC_PORT=7788',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    const line = lineFor(r.stdout, 'config') ?? '';
    expect(line).toMatch(/^PASS config: /);
    expect(line).toContain('fleet mode remote');
    // …and the token it had to READ to say so never reaches the terminal.
    expect(r.stdout).not.toContain('ccrc-canary-agent-1f4d9');
    expect(r.stderr).not.toContain('ccrc-canary-agent-1f4d9');
  });

  it('passes a local box, naming the mode it measured', () => {
    const home = healthy('ccrc-doctor-config-local-');
    expect(lineFor(runDoctor(home).stdout, 'config')).toMatch(/^PASS config: .*fleet mode local/);
  });

  it('reads an ABSENT CCRC_FLEET as local — the same default config.ts applies', () => {
    // `server/src/config.ts#loadConfig`: `env.CCRC_FLEET === 'remote' ? 'remote' : 'local'`.
    // A check stricter than the config reader would report a box that runs
    // perfectly well as misconfigured.
    const home = healthy('ccrc-doctor-config-nofleet-');
    writeCcrcEnv(home, 'CCRC_HOST=ccrc-fixture.invalid\nCCRC_PORT=7788\n');
    const line = lineFor(runDoctor(home).stdout, 'config') ?? '';
    expect(line).toMatch(/^PASS config: .*fleet mode local/);
    expect(line).toMatch(/CCRC_FLEET/);              // it says WHY local, rather than asserting a key that is not there
  });

  it('reads a value systemd would NOT set as absent, not as a mode', () => {
    // The same one-directional subset rule `_box_env_value`'s header states and
    // the fleet check pins for CCRC_HOST: `\vCCRC_FLEET=remote` is a line
    // systemd's EnvironmentFile parser does not turn into an environment
    // variable, so the server boots in LOCAL mode — and a reader that skipped
    // the \v anyway would demand agent credentials for a mode this box is not
    // in.
    const home = healthy('ccrc-doctor-config-vtab-');
    writeCcrcEnv(home, '\vCCRC_FLEET=remote\n');
    const line = lineFor(runDoctor(home).stdout, 'config') ?? '';
    expect(line).toMatch(/^PASS config: .*fleet mode local/);
  });

  it('never quotes a value out of the file — it holds the agent token', () => {
    const home = healthy('ccrc-doctor-config-secrets-');
    writeCcrcEnv(home, [
      'CCRC_FLEET=local',
      'CCRC_AGENT_TOKEN=ccrc-canary-token-77c1a',
      'CCRC_VAPID_PRIVATE=ccrc-canary-vapid-2e8b0',
      '',
    ].join('\n'));
    const r = runDoctor(home);
    expect(lineFor(r.stdout, 'config')).toMatch(/^PASS config: /);
    for (const canary of ['ccrc-canary-token-77c1a', 'ccrc-canary-vapid-2e8b0']) {
      expect(r.stdout).not.toContain(canary);
      expect(r.stderr).not.toContain(canary);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'a ccrc.env it cannot READ is its own answer, and bash does not diagnose it on stderr', () => {
      // Without the `-r` guard the read fails, bash puts its own message on
      // stderr (which doctor deliberately does not capture) and every key comes
      // back empty — which is indistinguishable from a file that declares
      // nothing, i.e. a confident PASS on a box nobody measured.
      const home = healthy('ccrc-doctor-config-unreadable-');
      chmodSync(join(home, '.ccrc', 'ccrc.env'), 0o000);
      const r = runDoctor(home);
      expect(r.stdout).toMatch(/^WARN config: .*cannot be read/m);
      expect(r.stdout).not.toMatch(/^PASS config: /m);
      expect(r.stderr).toBe('');
    });

  it('a ccrc.env that is not a regular file is its own answer too', () => {
    const home = healthy('ccrc-doctor-config-dir-');
    rmSync(join(home, '.ccrc', 'ccrc.env'), { force: true });
    mkdirSync(join(home, '.ccrc', 'ccrc.env'), { recursive: true });
    const r = runDoctor(home);
    expect(r.stdout).toMatch(/^WARN config: .*is not a regular file/m);
    expect(r.stdout).not.toMatch(/defaults apply/);   // that is the OTHER answer
    expect(r.stderr).toBe('');
  });

  it('says so, rather than guessing, when ccrc\'s own config reader is not loaded', () => {
    // D-85: the check reads `BOX_ENV_FILE` and `_box_env_value`, both declared
    // once in `ccrc` (ccrc:91-101 says outright that doctor is one of the three
    // readers that must not re-spell the path). Sourced by anything that is not
    // `ccrc`, it says that in a verdict line — the shape `_check_fleet` already
    // uses for the same absence — rather than re-implementing either.
    const nowhere = join(REPO, 'no-such-home-for-check-config');
    const r = spawnSync(BASH, ['-c', `set -uo pipefail; . ${shq(CHECKS_SRC)}; _check_config`],
      { encoding: 'utf8', env: { HOME: nowhere, PATH: nowhere, LC_ALL: 'C' } });
    expect(r.stdout).toMatch(/^FAIL config: ccrc's own config reader is not loaded/m);
    expect(r.stdout).toMatch(/^ {2}remedy: this is a bug in ccrc/m);
    expect(r.status).toBe(1);
  });
});
// ── land-probe (landing order wave 3b) ──────────────────────────────────────
// `_check_land-probe` READS the two files `ccd-land-probe` rewrites every tick and never runs git or gh: a box whose fixture
// has neither on PATH still answers. `healthy()` writes no landing conf, so the check SKIPs there (counted in `HEALTHY_SKIPS`);
// every case below plants the conf and the files it needs.
describeLinux('ccrc doctor: land-probe', () => {
  const iso = (agoS: number): string => new Date(Date.now() - agoS * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const SHA = 'a'.repeat(40);
  const store = (count: number): object => ({ count, size: 0, inPack: 4, packs: 1 });
  const probeDoc = (agoS: number, over: Record<string, unknown> = {}): object => ({
    v: 1, project: 'proj-a', at: iso(agoS), state: 'measured', base: { ref: 'main', sha: SHA },
    heads: [
      { pr: 12, head: SHA, branch: 'ws/alpha', id: 'lane-a-proj-a-alpha', base: { state: 'clean' } },
      { pr: 13, head: SHA, branch: 'feature/x', id: null, base: { state: 'conflict', paths: ['README.md'], pathsCut: false } },
      { pr: 14, head: SHA, branch: 'ws/beta', id: null, base: { state: 'clean' } },
    ],
    headsCut: false, pairs: [], pairHeads: [14, 13, 12], pairsCut: false,
    store: { before: store(0), after: store(0) }, scratch: { sizeKiB: 12 }, elapsedMs: 1234, ...over,
  });
  const mainDoc = (agoS: number, over: Record<string, unknown> = {}): object => ({
    v: 1, project: 'proj-a', at: iso(agoS), sha: SHA, state: 'green', required: [{ name: 'build', app: null }], failing: [], pending: [], ...over,
  });
  /** One opted-in project: its conf, and (unless `null`) the two files, each as the object or the raw text given. */
  const plant = (home: string, project = 'proj-a', files: { probe?: object | string | null; main?: object | string | null } = {}, confAgeS = 3600): string => {
    mkdirSync(join(home, '.ccrc', 'landing'), { recursive: true });
    const confFile = join(home, '.ccrc', 'landing', `${project}.conf`);
    writeFileSync(confFile, 'lineage=off\n');
    const confTime = new Date(Date.now() - confAgeS * 1000);
    utimesSync(confFile, confTime, confTime);   // an opt-in older than ten minutes: a missing probe is then the radar's fault, not a fresh opt-in's
    const dir = join(home, '.cc-sessions', 'landing', project);
    mkdirSync(dir, { recursive: true });
    const put = (name: string, v: object | string | null | undefined, dflt: object): void => {
      if (v === null) return;
      const body = v === undefined ? dflt : v;
      writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
    };
    put('probe', files.probe, probeDoc(60));
    put('main-health', files.main, mainDoc(60));
    return dir;
  };
  const verdict = (home: string, extraEnv: NodeJS.ProcessEnv = {}): string => anyVerdictFor(runDoctor(home, ['doctor'], extraEnv).stdout, 'land-probe') ?? '';
  const ageUnit = (home: string, agoS: number): void => {
    writeUnitFile(home, 'ccd-land-probe.timer');
    const t = new Date(Date.now() - agoS * 1000);
    utimesSync(join(unitDirOf(home), unitFileOf('ccd-land-probe.timer')), t, t);
  };

  it('PASSes on fresh files, and says what it read: heads, conflicts, the base, the store delta and the scratch', () => {
    const home = healthy('ccrc-doctor-land-probe-pass-');
    plant(home);
    const out = runDoctor(home);
    expect(lineFor(out.stdout, 'land-probe')).toBe('PASS land-probe: proj-a: 3 heads, 1 conflicting with main, main green; store +0 objects, scratch 12 KiB this tick');
    expect(out.code).toBe(0);
  });

  it('reads the store delta as objects gained over the tick, loose and packed together', () => {
    const home = healthy('ccrc-doctor-land-probe-delta-');
    plant(home, 'proj-a', { probe: probeDoc(60, { store: { before: store(3), after: store(20) } }) });
    expect(verdict(home)).toContain('store +17 objects');
  });

  it('PASSes a red or a pending base: that is the repository\'s fact, which the line states, not the probe\'s fault', () => {
    const red = healthy('ccrc-doctor-land-probe-red-');
    plant(red, 'proj-a', { main: mainDoc(60, { state: 'red', failing: ['build'] }) });
    expect(verdict(red)).toMatch(/^PASS land-probe: proj-a: 3 heads, 1 conflicting with main, main red; /);
    const pending = healthy('ccrc-doctor-land-probe-pending-');
    plant(pending, 'proj-a', { main: mainDoc(60, { state: 'unmeasured', why: 'pending' }) });
    expect(verdict(pending)).toMatch(/^PASS land-probe: .*main pending; /);
  });

  it('names every opted-in project on one line', () => {
    const home = healthy('ccrc-doctor-land-probe-two-');
    plant(home, 'proj-a');
    plant(home, 'proj-b', { probe: probeDoc(60, { heads: [] }) });
    const line = lineFor(runDoctor(home).stdout, 'land-probe') ?? '';
    expect(line).toMatch(/^PASS land-probe: proj-a: 3 heads, .* \| proj-b: 0 heads, 0 conflicting with main, main green; /);
  });

  it('SKIPs on a server-role box, however stale its files', () => {
    const home = healthy('ccrc-doctor-land-probe-server-');
    plant(home, 'proj-a', { probe: probeDoc(86400) });
    writeCcrcEnv(home, ['CCRC_ROLE=server', 'CCRC_FLEET=local', 'CCRC_HOST=ccrc-fixture.invalid', 'CCRC_PORT=7788', ''].join('\n'));
    expect(verdict(home)).toMatch(/^SKIP land-probe: this box records CCRC_ROLE=server/);
  });

  it('SKIPs with no conf: nobody opted in, which is every box until the operator does', () => {
    const home = healthy('ccrc-doctor-land-probe-noconf-');
    expect(verdict(home)).toMatch(/^SKIP land-probe: no project is opted in /);
    mkdirSync(join(home, '.ccrc', 'landing'), { recursive: true });
    writeFileSync(join(home, '.ccrc', 'landing', 'notes.txt'), 'not a conf');
    expect(verdict(home), 'only <project>.conf files opt a project in').toMatch(/^SKIP land-probe: no project is opted in /);
  });

  it('SKIPs while the operator has paused the probe: its files then age by design, never a stopped timer', () => {
    const home = healthy('ccrc-doctor-land-probe-paused-');
    plant(home, 'proj-a', { probe: probeDoc(86400) });
    writeFileSync(join(home, '.cc-sessions', 'land-probe-paused'), '');
    expect(verdict(home)).toMatch(/^SKIP land-probe: paused by the operator /);
  });

  it('SKIPs when every opted-in project is paused, and measures the one that is not', () => {
    const home = healthy('ccrc-doctor-land-probe-project-paused-');
    const a = plant(home, 'proj-a', { probe: probeDoc(86400) });
    writeFileSync(join(a, 'paused'), '');
    expect(verdict(home)).toMatch(/^SKIP land-probe: every opted-in project is paused /);
    plant(home, 'proj-b');
    const line = verdict(home);
    expect(line).toMatch(/^PASS land-probe: proj-b: 3 heads/);
    expect(line, 'a paused project is not measured').not.toContain('proj-a');
  });

  it('WARNs land-probe-not-yet inside ten minutes of the timer unit landing, and land-probe-never after', () => {
    const fresh = healthy('ccrc-doctor-land-probe-notyet-');
    plant(fresh, 'proj-a', { probe: null, main: null });
    ageUnit(fresh, 30);
    const out = runDoctor(fresh).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(i, out.join('\n')).toBeGreaterThan(-1);
    expect(out[i]).toContain('land-probe-not-yet: proj-a has no probe file yet and ccd-land-probe.timer was installed ');
    expect(out[i], 'the first-tick sentence names no number').toContain(' ago - its first tick follows the timer\'s arming delay, so this is expected right after an install');
    expect(out[i + 1], 'the remedy names the shipped timer\'s period (300 s)').toMatch(/^ {2}remedy: wait for the first tick \(the timer fires every 5 minutes\), then re-run doctor/);

    const old = healthy('ccrc-doctor-land-probe-never-');
    plant(old, 'proj-a', { probe: null, main: null });
    ageUnit(old, 11 * 60);
    const o = runDoctor(old).stdout.split('\n');
    const j = o.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(o[j]).toContain('land-probe-never: proj-a is opted in but the radar has never written its probe, so no PR conflict is measured');
    expect(o[j]).not.toContain('land-probe-not-yet');
    expect(o[j + 1]).toMatch(/^ {2}remedy: systemctl --user status ccd-land-probe\.timer ccd-land-probe\.service/);

    const none = healthy('ccrc-doctor-land-probe-never-nounit-');
    plant(none, 'proj-a', { probe: null, main: null });
    expect(verdict(none), 'no timer unit file at all is a radar that was never installed').toContain('land-probe-never: proj-a');
  });

  it('WARNs land-probe-unreadable for a file that is not a v1 record, a missing main-health, a symlink and a future time', () => {
    const cases: Array<[string, { probe?: object | string | null; main?: object | string | null }, RegExp]> = [
      ['garbled', { probe: '{not json' }, /land-probe-unreadable: proj-a: the probe file under .* is not a regular v1 record with a readable time/],
      ['later-format', { probe: probeDoc(60, { v: 2 }) }, /land-probe-unreadable: proj-a: the probe file/],
      ['no-time', { probe: probeDoc(60, { at: 'yesterday' }) }, /land-probe-unreadable: proj-a: the probe file/],
      ['main-health-missing', { main: null }, /land-probe-unreadable: proj-a: the main-health file under .* is missing beside a probe/],
      ['main-health-garbled', { main: '[]' }, /land-probe-unreadable: proj-a: the main-health file/],
      ['future', { probe: probeDoc(-3600) }, /land-probe-unreadable: proj-a: the probe file under .* is dated in the future/],
      ['wrong-shape', { probe: probeDoc(60, { heads: 'three' }) }, /land-probe-unreadable: proj-a: the probe file/],
    ];
    for (const [name, files, re] of cases) {
      const home = healthy(`ccrc-doctor-land-probe-unreadable-${name}-`);
      plant(home, 'proj-a', files);
      const out = runDoctor(home).stdout.split('\n');
      const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
      expect(out.join('\n'), name).toMatch(re);
      expect(out[i + 1], name).toMatch(/^ {2}remedy: let the probe rewrite its files: systemctl --user start ccd-land-probe\.service/);
    }
    const link = healthy('ccrc-doctor-land-probe-unreadable-symlink-');
    const dir = plant(link, 'proj-a', { probe: null });
    writeFileSync(join(link, 'elsewhere.json'), JSON.stringify(probeDoc(60)));
    symlinkSync(join(link, 'elsewhere.json'), join(dir, 'probe'));
    expect(verdict(link), 'a symlink is not a regular file').toContain('land-probe-unreadable: proj-a: the probe file');
  });

  it('WARNs land-probe-stale past CCRC_LAND_PROBE_STALE_S (default four periods of the shipped timer, 1200 s), for either file, and the knob moves the line', () => {
    const home = healthy('ccrc-doctor-land-probe-stale-');
    plant(home, 'proj-a', { probe: probeDoc(1500) });
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toMatch(/land-probe-stale: proj-a: the probe file is 1[0-9]{3}s old - the radar ticks every 5 minutes, so it has stopped/);
    expect(out[i + 1]).toMatch(/^ {2}remedy: systemctl --user status ccd-land-probe\.timer ccd-land-probe\.service; journalctl --user -u ccd-land-probe\.service/);
    expect(verdict(home, { CCRC_LAND_PROBE_STALE_S: '3600' })).toMatch(/^PASS land-probe: /);
    expect(verdict(home, { CCRC_LAND_PROBE_STALE_S: 'abc' }), 'a non-number falls back to the default').toContain('land-probe-stale');
    const mh = healthy('ccrc-doctor-land-probe-stale-main-');
    // A tick in progress (its probe has no store.after yet) beside a main-health from long ago: the main-health is stale.
    plant(mh, 'proj-a', { probe: probeDoc(60, { store: { before: store(0), after: null }, scratch: { sizeKiB: null } }), main: mainDoc(1500) });
    expect(verdict(mh)).toContain('land-probe-stale: proj-a: the main-health file is ');
    // A FINISHED probe beside a main-health older than it is the sharper fact: the tick stopped before writing it.
    const inc = healthy('ccrc-doctor-land-probe-incomplete-');
    plant(inc, 'proj-a', { main: mainDoc(1500) });
    expect(verdict(inc)).toMatch(/^WARN land-probe: land-probe-incomplete: proj-a: the main-health file is 14[0-9]{2}s older than the probe file, so the last tick wrote its probe and stopped before its main-health/);
    const edge = healthy('ccrc-doctor-land-probe-stale-edge-');
    plant(edge, 'proj-a', { probe: probeDoc(1100), main: mainDoc(1100) });
    expect(verdict(edge), 'inside the bound is fresh').toMatch(/^PASS land-probe: /);
  });

  it('an unreadable ccd-land-probe.timer: the bounds it would have set are not invented, and the WARN names the unit (D-7054, OA-C8c (a))', () => {
    // The shipped unit file is gone from the box's tree (the same fixture seam the other cadence rows use), so no period can be read.
    const noTimer = (prefix: string): string => {
      const h = healthy(prefix);
      writeShippedTimer(join(h, 'ccrc'), 'ccd-land-probe.timer', null);
      return h;
    };
    const lines = (h: string, env: NodeJS.ProcessEnv = {}): string[] => {
      const out = runDoctor(h, ['doctor'], env).stdout.split(h).join('<home>').split('\n');
      return out.flatMap((l, i) => (l.startsWith('WARN land-probe: ') || l.startsWith('PASS land-probe: ') ? [l, out[i + 1] ?? ''] : []));
    };
    const unreadSentence = (what: string): string =>
      `ccd-land-probe.timer's cadence could not be read from the shipped unit file (<home>/ccrc/deploy/systemd/ccd-land-probe.timer), so ${what} is unmeasured`;
    const unreadFix = '  remedy: the shipped tree at <home>/ccrc is incomplete or damaged';

    // No override: there is no stale bound, so a file 1500 s old is not called stale and a fresh one is not a PASS.
    const old = noTimer('ccrc-doctor-land-probe-unread-old-');
    plant(old, 'proj-a', { probe: probeDoc(1500), main: mainDoc(1500) });
    const o = lines(old);
    expect(o, o.join('\n')).toHaveLength(2);
    expect(o[0]).toBe(`WARN land-probe: ${unreadSentence("the stale bound (four of the timer's periods; the stale arm did not run)")}`);
    expect(o[1]).toContain(unreadFix);
    const fresh = noTimer('ccrc-doctor-land-probe-unread-fresh-');
    plant(fresh, 'proj-a');
    expect(lines(fresh)[0], 'a PASS would claim a freshness nothing measured').toBe(o[0]);

    // An override stands without the period: a fresh file PASSes, unchanged.
    expect(lines(fresh, { CCRC_LAND_PROBE_STALE_S: '3600' })[0]).toMatch(/^PASS land-probe: proj-a: 3 heads/);
    // ... and a stale one is called stale by the override, its sentence dropping the period it cannot name.
    const ov = lines(old, { CCRC_LAND_PROBE_STALE_S: '1000' });
    expect(ov[0]).toMatch(/^WARN land-probe: land-probe-stale: proj-a: the probe file is 1[0-9]{3}s old - the radar has stopped, and its conflict and base-health readings are stale$/);
    expect(ov.join('\n')).toContain(unreadSentence('the period the stale sentence names'));

    // An absent probe has no not-yet window to be judged by: it reads never, and the WARN says the window is unmeasured.
    const none = noTimer('ccrc-doctor-land-probe-unread-window-');
    plant(none, 'proj-a', { probe: null, main: null }, 30);
    ageUnit(none, 30);
    const n = lines(none, { CCRC_LAND_PROBE_STALE_S: '3600' });
    expect(n[0]).toContain('land-probe-never: proj-a');
    expect(n.join('\n')).not.toContain('land-probe-not-yet');
    expect(n.join('\n')).toContain(unreadSentence("the not-yet window (two of the timer's periods; the not-yet arm did not run)"));
  });

  it('F2 counts the heads that came back unmeasured on the PASS line, and WARNs land-probe-unmeasured when every head did', () => {
    const heads = (states: Array<object>): object[] => states.map((base, n) => ({ pr: 20 + n, head: SHA, branch: `feature/${n}`, id: null, base }));
    const some = healthy('ccrc-doctor-land-probe-some-unmeasured-');
    plant(some, 'proj-a', { probe: probeDoc(60, { heads: heads([{ state: 'clean' }, { state: 'conflict', paths: ['x'], pathsCut: false }, { state: 'unmeasured', why: 'budget' }, { state: 'unmeasured', why: 'timeout' }]) }) });
    expect(verdict(some)).toBe('PASS land-probe: proj-a: 4 heads, 1 conflicting with main, 2 unmeasured, main green; store +0 objects, scratch 12 KiB this tick');
    const none = healthy('ccrc-doctor-land-probe-none-unmeasured-');
    plant(none, 'proj-a', { probe: probeDoc(60, { heads: heads([{ state: 'clean' }, { state: 'conflict', paths: ['x'], pathsCut: false }]) }) });
    expect(verdict(none), 'K = 0 leaves the PASS text as it was').toBe('PASS land-probe: proj-a: 2 heads, 1 conflicting with main, main green; store +0 objects, scratch 12 KiB this tick');
    const all = healthy('ccrc-doctor-land-probe-all-unmeasured-');
    plant(all, 'proj-a', { probe: probeDoc(60, { heads: heads([{ state: 'unmeasured', why: 'budget' }, { state: 'unmeasured', why: 'rc-128' }, { state: 'unmeasured', why: 'timeout' }]) }) });
    const out = runDoctor(all).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toContain('land-probe-unmeasured: proj-a: all 3 of its open PR heads came back unmeasured against the base');
    expect(out.join('\n')).not.toMatch(/^PASS land-probe/m);
    const zero = healthy('ccrc-doctor-land-probe-zero-heads-');
    plant(zero, 'proj-a', { probe: probeDoc(60, { heads: [] }) });
    expect(verdict(zero), 'no heads at all is nothing to measure, not an unmeasured radar').toMatch(/^PASS land-probe: proj-a: 0 heads, 0 conflicting with main, main green; /);
  });

  it('F3 reads a conf written under ten minutes ago as not-yet, never land-probe-never', () => {
    const fresh = healthy('ccrc-doctor-land-probe-newconf-');
    plant(fresh, 'proj-a', { probe: null, main: null }, 30);
    ageUnit(fresh, 3 * 3600);   // the timer is old: only the conf is new
    const out = runDoctor(fresh).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toContain('land-probe-not-yet: proj-a has no probe file yet and its conf was written ');
    expect(out[i]).not.toContain('land-probe-never');
    expect(out[i], 'the next-tick clause is read from the shipped timer').toContain('the next tick (the timer fires every 5 minutes) is the first to measure it');
    expect(out[i + 1]).toMatch(/^ {2}remedy: wait for the first tick \(the timer fires every 5 minutes\), then re-run doctor/);
    // The window is two periods of the shipped timer (2 x 300 s), so 600 s is the edge this fixture's unit file puts it at.
    const old = healthy('ccrc-doctor-land-probe-oldconf-');
    plant(old, 'proj-a', { probe: null, main: null }, 601);
    ageUnit(old, 3 * 3600);
    expect(verdict(old), 'a conf past ten minutes with no probe is the radar\'s fault').toContain('land-probe-never: proj-a');
  });

  it('M5 the never and stale remedy names an invalid conf or a missing checkout as a reason the writes stop', () => {
    const home = healthy('ccrc-doctor-land-probe-remedy-');
    plant(home, 'proj-a', { probe: null, main: null });
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i + 1]).toMatch(/an invalid conf or a missing checkout under .*\/projects also stops them, and the journal names it$/);
  });

  it('WARNs land-probe-unmeasured when the probe ran and could not measure, with the why it gave', () => {
    const home = healthy('ccrc-doctor-land-probe-unmeasured-');
    plant(home, 'proj-a', { probe: probeDoc(60, { state: 'unmeasured', why: 'fetch-failed', heads: [], pairs: [] }) });
    const out = runDoctor(home).stdout.split('\n');
    const i = out.findIndex((l) => l.startsWith('WARN land-probe: '));
    expect(out[i], out.join('\n')).toContain('land-probe-unmeasured: proj-a: the probe ran and could not measure its probe (why: fetch-failed), so no conflict reading stands for this project');
    expect(out[i], 'M4: the sentence is limited to what the file names').not.toContain('base-health');
    expect(out[i + 1]).toMatch(/^ {2}remedy: read why the tick could not measure: journalctl --user -u ccd-land-probe\.service/);
    expect(out.join('\n')).not.toMatch(/^PASS land-probe/m);

    const gh = healthy('ccrc-doctor-land-probe-unmeasured-main-');
    plant(gh, 'proj-a', { main: mainDoc(60, { state: 'unmeasured', why: 'gh-failed' }) });
    expect(verdict(gh)).toContain('the probe ran and could not measure its main-health (why: gh-failed), so no base-health reading stands for this project');
    expect(verdict(gh), 'M4: a main-health that could not be measured says nothing of the conflict reading').not.toContain('conflict reading');

    const odd = healthy('ccrc-doctor-land-probe-unmeasured-why-');
    plant(odd, 'proj-a', { probe: probeDoc(60, { state: 'unmeasured', why: 'x'.repeat(200) }) });
    expect(verdict(odd), 'a reason that is not a short word is never echoed').toContain('(why: no-reason)');
  });

  it('is the verdict when one project is fine and another is not: the fine one is not hidden, the bad one is named', () => {
    const home = healthy('ccrc-doctor-land-probe-mixed-');
    plant(home, 'proj-a');
    plant(home, 'proj-b', { probe: probeDoc(5000) });
    const line = verdict(home);
    expect(line).toMatch(/^WARN land-probe: land-probe-stale: proj-b: /);
    expect(line).not.toContain('proj-a');
  });

  it('services: an installed, stopped ccd-land-probe.timer WARNS with its own consequence', () => {
    const home = healthy('ccrc-doctor-services-land-probe-timer-');
    writeUnitFile(home, 'ccd-land-probe.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-land-probe.timer'), 'inactive\n');
    const lines = runDoctor(home).stdout.split('\n');
    const i = lines.findIndex((l) => l.startsWith('WARN services: '));
    expect(i, lines.join('\n')).toBeGreaterThan(-1);
    expect(lines[i]).toContain('ccd-land-probe.timer is installed but inactive');
    expect(lines[i]).toContain('no open PR is measured for a conflict with the base');
    expect(lines[i]).not.toContain('the job it fires is not running');
    expect(lines[i + 1]).toMatch(/^ {2}remedy: systemctl --user enable --now ccd-land-probe\.timer$/);
  });

  it('services: an active ccd-land-probe.timer is named among the PASSes', () => {
    const home = healthy('ccrc-doctor-services-land-probe-timer-ok-');
    writeUnitFile(home, 'ccd-land-probe.timer');
    writeFileSync(join(home, 'fixture-unit-ccd-land-probe.timer'), 'active\n');
    expect(lineFor(runDoctor(home).stdout, 'services')).toContain('ccd-land-probe.timer is active');
  });
});
