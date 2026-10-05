/**
 * The worker merge deny (landing-order wave 2, spec §5.2, ruling R5): the
 * session hook's PreToolUse arm DENIES `gh pr merge` in a session whose hold
 * names a programme wave, and in any workspace that carries the child marker
 * (`$REG/<id>.child`, which only a dispatch writes) — a child whose run has
 * let it go keeps its pane until the reclaim, and it is still a worker. Every
 * other session's merge passes: the coordinator's `gh pr merge <n>
 * --match-head-commit <sha>` is how it enqueues. A deny never replaces the
 * graph gate's, which has already counted the denial it prints (D-1689).
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, the way
 * `session-hook.test.ts` does: a stub `tmux` answers the session name, stdin
 * carries the payload, stdout is the one PreToolUse envelope (or nothing).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';
const WAVE_HOLD = 'program:landing-order wave:2/5 run:17';

let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-mergedeny-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\necho "cc-${ID}"\n`, { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hold = (text: string): void => { fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.hold`), text); };
/** The child marker, as `cmd_ws_add --child 17` writes it. */
const marker = (): void => { fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.child`), '17'); };

/** The payload cap, READ from the hook (never re-typed here): a command longer
 *  than this many bytes is never parsed (landing-order wave 3). */
const CAP = ((): number => {
  const m = /^MERGE_PARSE_CAP=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8'));
  if (m === null) throw new Error('the hook no longer defines MERGE_PARSE_CAP as a bare integer');
  return Number(m[1]);
})();
/** `unit` repeated, then `tail`, cut to exactly `bytes` bytes (ASCII units). */
const sized = (unit: string, tail: string, bytes: number): string =>
  unit.repeat(Math.ceil(bytes / unit.length)).slice(0, bytes - tail.length) + tail;

/** One PreToolUse Bash call through the real hook. Exit 0 and a silent stderr
 *  are the hook's standing contract, asserted on every call. */
const bash = (command: string, nulStderr = false): { deny: string | null; stdout: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: home }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  // A NUL in the command makes bash warn on stderr, on any command, at a line before the merge arm.
  if (!nulStderr) expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return { deny: null, stdout: '' };
  const j = JSON.parse(line) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return {
    deny: j.hookSpecificOutput.permissionDecision === 'deny' ? String(j.hookSpecificOutput.permissionDecisionReason) : null,
    stdout: line,
  };
};

describe('the worker merge deny', () => {
  it('refuses a worker\'s merge, naming the hold and who lands instead', () => {
    hold(WAVE_HOLD);
    const r = bash('gh pr merge 42');
    expect(r.deny, 'a wave session\'s gh pr merge went through').not.toBeNull();
    expect(r.deny).toContain(WAVE_HOLD);
    expect(r.deny).toContain('the coordinator merges, workers never do');
  });

  it('lets a coordinator\'s enqueue through — a session with no wave hold and no child marker is never asked', () => {
    expect(bash('gh pr merge 42 --match-head-commit ' + 'a'.repeat(40)).deny).toBeNull();
    expect(bash('gh pr merge 42').deny).toBeNull();
  });

  it('refuses a released child — the marker outlives the hold, in the window before the reclaim', () => {
    marker();
    const r = bash('gh pr merge 42');
    expect(r.deny, 'a child whose run let it go merged').not.toBeNull();
    expect(r.deny).toContain('child');
    expect(r.deny).toContain('the coordinator merges, workers never do');
  });

  it('a child marker that cannot be read is still a child — it is the marker\'s existence that counts', () => {
    fs.mkdirSync(path.join(home, '.cc-sessions', `${ID}.child`));
    expect(bash('gh pr merge 42').deny).not.toBeNull();
  });

  it('refuses a close-claimed hold too — `wave:N` with no run is still a wave', () => {
    hold('program:landing-order wave:3/5');
    expect(bash('gh pr merge 42').deny).not.toBeNull();
  });

  it('lets a hold that names no programme wave through, and an unreadable or oversized one', () => {
    hold('operator: debugging the lockfile');
    expect(bash('gh pr merge 42').deny, 'a hand hold is not a worker wave').toBeNull();
    // 152 characters whose FIRST 128 — all `_ct_read` returns — still match
    // the wave grammar: only the bound tells this hold was cut.
    hold(`program:${'x'.repeat(100)} wave:1/2 run:${'1'.repeat(30)}`);
    expect(bash('gh pr merge 42').deny, 'an oversized hold is unspeakable, never a wave').toBeNull();
    fs.rmSync(path.join(home, '.cc-sessions', `${ID}.hold`));
    fs.mkdirSync(path.join(home, '.cc-sessions', `${ID}.hold`));
    expect(bash('gh pr merge 42').deny, 'an unreadable hold is not a worker wave').toBeNull();
  });

  it('refuses every spelling it can parse at a command head', () => {
    hold(WAVE_HOLD);
    for (const c of [
      'gh pr merge 42 --squash', 'gh pr merge --auto 42', 'cd /tmp && gh pr merge 42',
      `gh pr merge 42 --match-head-commit ${'a'.repeat(40)}`,
      'GH_TOKEN=x gh pr merge 42', 'env gh pr merge 42', 'command gh pr merge 42',
      '/usr/bin/gh pr merge 42', 'gh -R owner/repo pr merge 42', 'echo ok; gh pr merge 42',
      'x=$(gh pr merge 42)', 'echo ok\ngh pr merge 42',
      // The heads an agent writes for "wait for checks, then merge": reserved
      // words, grouping, and the wrappers a command can sit behind.
      'if gh pr checks 42 --watch; then gh pr merge 42; fi', 'for n in 42; do gh pr merge $n; done',
      'while true; do gh pr merge 42; done', '{ gh pr merge 42; }', '! gh pr merge 42',
      'time gh pr merge 42', 'timeout 60 gh pr merge 42', 'nohup gh pr merge 42',
      'env GH_TOKEN=x gh pr merge 42', 'gh pr --repo o/r merge 42',
      // A "…" span that holds a `$(` keeps that substitution, which runs; and a
      // quote INSIDE a "…" span does not open a '…' one.
      'x="$(gh pr merge 42)"', 'echo "it\'s" && gh pr merge 42',
      // A `#` comment and a backslash-escaped quote open no '…' span: bash
      // reads neither as a quote, so neither may hide the merge after it.
      '# don\'t merge before CI is green\ngh pr merge 42\necho \'done\'',
      "echo it\\'s time; gh pr merge 42; echo 'ok'",
    ]) {
      expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
    }
  });

  it('a deny supersedes a sync advisory on the same call — one line, and it is the deny', () => {
    // Landing-order wave 1's PreToolUse advisory answers a sync of `main` with
    // `additionalContext`; a merge in the SAME command is still refused, and the
    // hook still prints exactly one envelope.
    hold(WAVE_HOLD);
    const r = bash('git merge origin/main && gh pr merge 42');
    expect(r.stdout.split('\n')).toHaveLength(1);
    expect(r.deny, 'the advisory won and the merge went through').not.toBeNull();
  });

  it('never replaces the graph gate\'s counted deny — a search that is also a merge keeps the gate\'s reason', () => {
    // The gate has already COUNTED the denial it prints (D-1689); a merge deny
    // written over it would spend the session's bound on a denial it never saw.
    hold(WAVE_HOLD);
    const tree = path.join(home, 'tree');
    fs.mkdirSync(tree, { recursive: true });
    const git = (...a: string[]): string => spawnSync('git',
      ['-C', tree, '-c', 'user.email=f@example.invalid', '-c', 'user.name=fixture', ...a], { encoding: 'utf8' }).stdout.trim();
    git('init', '-q');
    fs.writeFileSync(path.join(tree, 'c.txt'), '0\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'c');
    fs.mkdirSync(path.join(tree, 'graphify-out'));
    fs.writeFileSync(path.join(tree, 'graphify-out', 'graph.json'),
      `{\n  "hyperedges": [],\n  "built_at_commit": "${git('rev-parse', 'HEAD')}"\n}\n`);
    fs.writeFileSync(path.join(tree, 'graphify-out', '.graphify_engine'), '0.9.9\n');
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash',
        tool_input: { command: 'rg assembleFleet src && gh pr merge 42' }, cwd: tree }),
      encoding: 'utf8',
      env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
        TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
    });
    expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
    expect(r.stdout.trim(), 'the gate did not fire — this case went blind').not.toBe('');
    const reason = String(JSON.parse(r.stdout.trim()).hookSpecificOutput.permissionDecisionReason);
    expect(reason, 'the merge deny replaced the graph gate\'s counted deny').toContain('Denial 1 of 3');
  });

  it('refuses a head whose VAR= or flag value runs a substitution — a `$(…)` is part of the word', () => {
    // The head match keeps every token class off `;&|()` so that it stays linear;
    // a value that holds a `$(…)` is the one place a `(` is still part of the
    // word, and `GH_TOKEN=$(<tok) gh pr merge` is how a worker would borrow a token.
    hold(WAVE_HOLD);
    for (const c of [
      'GH_TOKEN=$(<tok) gh pr merge 42', 'X=$(date) gh pr merge 42', 'gh --repo=$(cat r) pr merge 42',
      'env GH_TOKEN=$(cat) gh pr merge 42', 'X="$(date)" gh pr merge 42', 'X=$((1+2)) gh pr merge 42',
      'gh -R $(cat r) pr merge 42', 'timeout $(echo 5) gh pr merge 42',
    ]) {
      expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
    }
  });

  it('denies none of a cap-sized adversarial command, in bounded time — the separator walks the cap now bounds', () => {
    // A token class that can cross a separator, or a blank class that includes
    // the newline, makes every `;a=` / `\na=` / `;gh -R ` start walk to the end
    // of the payload: 5 to 9 s at 36 KB, and 1.6 s at 36 KB for the gh-flag
    // classes alone, before the payload cap. Since the cap nothing longer than
    // MERGE_PARSE_CAP bytes is parsed, so these run at exactly the cap, the
    // largest command the strip and the head match still read; the cap's own
    // cases below keep everything longer out. At this size those walks cost too
    // little for the clock to catch (wave 2's rows H20, H21 and H39 measure
    // green here, at 2048 and at 8192): the cap, not this clock, is their guard
    // now, and this case is the no-false-deny and time check at the cap; the
    // boundary itself is held by the payload cap's boundary case.
    // An unterminated `<<a` is the strip's own walk. The tail carries `merge`
    // outside any quote or comment, so the prefilter lets the match run and a
    // regex that matched any `merge` would deny; none is a merge. The hold
    // makes a wrong match a deny this case can see (review 241 F6).
    hold(WAVE_HOLD);
    const units = [';', '\n'].flatMap((sep) => ['a=', 'gh ', 'gh -R ', 'timeout 1 '].map((unit) => `${sep}${unit}`));
    for (const u of [...units, '<<a\n']) {
      const c = sized(u, '\necho merge origin', CAP);
      expect(Buffer.byteLength(c)).toBe(CAP);
      const t0 = Date.now();
      const r = bash(c);
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u)}`).toBeLessThan(1500);
    }
  }, 60000);

  it('strips a heredoc line of many `<<` and a body of unclosed `$(` in bounded time — no recursion per `<<`', () => {
    // A heredoc's rest-of-line is stripped WITHOUT a second heredoc, and a `$(`
    // that never closes is kept raw, not stripped again: either one recursing
    // walks the rest of the payload once per `<<` (2.4 to 3.8 s and 0.4 to
    // 0.6 GB at 16 KB, measured on the strip alone; 15 s and 2.9 GB at 36 KB).
    // Each payload is whole units up to the cap, the largest command parsed.
    hold(WAVE_HOLD);
    // The second payload's heredoc never terminates, so the strip keeps the
    // whole text raw from its `<<` without reading the `$(`s (the top level
    // has no `$(` arm of its own). The third has its `a` terminator line
    // (review 249 F1): the heredoc completes, its unquoted body goes to the
    // substitution reader, and the first `$(` there never closes, so it is
    // kept raw once. Re-stripping it would cost ~300 ms here against ~80
    // (measured at the cap), inside any bound a loaded box can hold, so the
    // next case pins the rule itself.
    for (const [pre, u, end] of [['', '<<a ', '\n'], ['cat <<a\n', '$(cat <<a\n', ''], ['cat <<a\n', '$(cat <<a\n', 'a\n']]) {
      const tail = `${end}echo merge origin`;
      const c = pre + u.repeat(Math.floor((CAP - pre.length - tail.length) / u.length)) + tail;
      expect(Buffer.byteLength(c)).toBeLessThanOrEqual(CAP);
      const t0 = Date.now();
      const r = bash(c);
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u + end)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u + end)}`).toBeLessThan(1500);
    }
  }, 60000);

  // THE PAYLOAD CAP (landing-order wave 3). Over MERGE_PARSE_CAP bytes nothing
  // is parsed: the raw command is asked only whether, in one segment of it
  // (split on the four command separators `;` `&` `|` and the newline,
  // fixed-string), `gh`, `pr` and `merge` stand as words in that order
  // (`ocwords`), and a held or child session's command that does is refused
  // unread.
  describe('the payload cap', () => {
    /** `c`, then a filler of `a`s that carries it past the cap and touches no
     *  separator, so the segment holding `c` is the one the rule reads. */
    const over = (c: string): string => `${c} ${'a'.repeat(CAP)}`;
    const MENTION = 'echo "then gh pr merge 42 later" ';
    it('parses a command of exactly the cap, and refuses one byte more unread — naming both numbers', () => {
      hold(WAVE_HOLD);
      expect(bash(sized(MENTION, 'x', CAP)).deny, 'at the cap the strip reads the quoted mention as text').toBeNull();
      const refused = bash(sized(MENTION, 'x', CAP + 1)).deny;
      expect(refused, 'one byte over the cap, a command spelling `gh pr merge` was let through').not.toBeNull();
      expect(refused).toContain(`this command is ${CAP + 1} bytes`);
      expect(refused).toContain(`${CAP}-byte parse cap`);
      expect(refused).toContain(WAVE_HOLD);
      expect(refused).toContain('the coordinator merges, workers never do');
      expect(refused).toContain('or rephrase it');
      // A real merge at the cap is read, and refused for what it is.
      const real = bash(sized('gh pr merge 42 ', ' ', CAP)).deny;
      expect(real).not.toBeNull();
      expect(real, 'a merge at the cap was refused unread: the parse did not run').not.toContain('parse cap');
    });

    it('counts bytes, not characters', () => {
      hold(WAVE_HOLD);
      // Each `é` is two bytes: fewer characters than the cap, more bytes.
      const c = 'echo gh pr merge ' + 'é'.repeat(Math.ceil(CAP / 2));
      expect(c.length).toBeLessThan(CAP);
      expect(Buffer.byteLength(c)).toBeGreaterThan(CAP);
      const d = bash(c).deny;
      expect(d, 'a command over the cap in BYTES was parsed as if it were under it').not.toBeNull();
      expect(d).toContain(`this command is ${Buffer.byteLength(c)} bytes`);
    });

    it('lets an over-cap command through unparsed unless its raw text spells a word-bounded `gh pr merge`', () => {
      hold(WAVE_HOLD);
      // The fixture's cwd carries `merge`, so the arm's substring prefilter
      // passes whatever the command says, and the jq program is reached.
      expect(home).toContain('merge');
      // Prose holding both substrings: the rule the coordinator replaced
      // would have refused this (landing-order wave 3's amendment).
      expect(bash(sized('though the branch merged, the high road held; ', ' ', CAP + 1)).deny, 'prose holding `gh` and `merge` as substrings').toBeNull();
      expect(bash(sized('echo merge ', ' ', CAP + 1)).deny, 'no `gh` in it').toBeNull();
      expect(bash(sized('gh pr view 42; echo merge ', ' ', CAP + 1)).deny, 'gh and merge, but not `gh pr merge`').toBeNull();
      expect(bash(sized('echo xgh pr merge 42 ', ' ', CAP + 1)).deny, 'a `gh` that is the tail of another word').toBeNull();
      expect(bash(sized('echo gh pr merged it ', ' ', CAP + 1)).deny, 'a `merge` that is the head of another word').toBeNull();
    });

    it.each([
      'gh -R o/r pr merge 42',
      'gh --repo o/r pr merge 42',
      'gh --repo=o/r pr merge 42',
      'gh pr -R o/r merge 42',
    ])('refuses gh\'s own flags between the words over the cap, as main\'s full parse does — %s (review 267 F3)', (c) => {
      hold(WAVE_HOLD);
      const d = bash(over(c)).deny;
      expect(d, `an over-cap ${c} was let through`).not.toBeNull();
      expect(d).toContain('parse cap');
      expect(d).toContain('or rephrase it');
    });

    it.each([
      ['an operator after `merge`: `;`', 'gh pr merge;echo ok'],
      ['an operator after `merge`: `)` closing a substitution', 'x=$(gh pr merge)'],
      ['an operator after `merge`: a bare `)`', 'gh pr merge)'],
      ['an operator after `merge`: `|`', 'gh pr merge|cat'],
      ['an operator after `merge`: `&&`', 'gh pr merge&&echo ok'],
      ['a redirection after `merge`: `>`', 'gh pr merge>out'],
      ['a redirection after `merge`: `<`', 'gh pr merge<in'],
      ['a paren after `merge`: `(`', 'gh pr merge(x)'],
      ['a subshell: `(gh pr merge)`', '(gh pr merge)'],
      ['a TAB between the words', 'gh\tpr\tmerge 42'],
    ])('refuses %s over the cap (review 267 F4)', (_n, c) => {
      hold(WAVE_HOLD);
      const d = bash(over(c)).deny;
      expect(d, `an over-cap ${JSON.stringify(c)} was let through`).not.toBeNull();
      expect(d).toContain('parse cap');
    });

    // A flag's VALUE may hold a substitution, a redirection or a paren, and main's
    // full parse refuses all of them (review 267 I1): only `;` `&` `|` and the newline
    // split a command, so none of these splits the three words apart.
    it.each([
      'gh -R $(echo o/r) pr merge 42',
      'gh -R "$(git remote get-url origin)" pr merge 42',
      'gh --repo=$(echo o/r) pr merge 42',
      'gh pr -R $(echo o/r) merge 42',
      'gh -R o/r<x pr merge 42',
      'gh pr --repo o/r>x merge 42',
    ])('refuses a flag value that holds a substitution or a redirection over the cap — %s (review 267 I1)', (c) => {
      hold(WAVE_HOLD);
      const d = bash(over(c)).deny;
      expect(d, `an over-cap ${c} was let through`).not.toBeNull();
      expect(d).toContain('parse cap');
    });

    it.each([
      ['a separator inside a quoted flag value', 'gh pr -R "a;b" merge 42'],
    ])('LISTED over-cap pass, not a closure: %s', (_n, c) => {
      hold(WAVE_HOLD);
      expect(bash(over(c)).deny, `the listed pass ${JSON.stringify(c)} was refused: update the hook header's list`).toBeNull();
    });

    it('LISTED over-cap pass, not a closure: a NUL next to the word is denied under the cap and passes over it', () => {
      hold(WAVE_HOLD);
      // bash strips NUL from command text (and warns on stderr, for any command holding one).
      expect(bash('gh pr merge\u0000 42', true).deny, 'under the cap the strip reads it').not.toBeNull();
      expect(bash(over('gh pr merge\u0000 42'), true).deny, 'the listed pass was refused: update the hook header\'s list').toBeNull();
    });

    it('reads a merge after multi-byte text: the in-order search slices by codepoint offsets', () => {
      hold(WAVE_HOLD);
      expect(bash(over('é😀 gh -R o/r pr merge 42')).deny, 'a multi-byte prefix misaligned the slice').not.toBeNull();
      expect(bash(over('é😀 gh pr view 3 merged')).deny).toBeNull();
    });

    it('refuses a bare backtick `gh pr merge` over the cap — a STRICTER over-cap reading, not a closure: under the cap it passes', () => {
      hold(WAVE_HOLD);
      expect(bash('echo `gh pr merge`').deny, 'under the cap a legacy backtick is the listed pass').toBeNull();
      const d = bash(over('echo `gh pr merge`')).deny;
      expect(d, 'the end class holds a backtick, so the over-cap rule reads it').not.toBeNull();
      expect(d).toContain('parse cap');
    });

    it.each([
      ['prose with `gh` and `merge` inside other words', 'though it merged high'],
      ['`gh` but not a merge', 'gh pr view 3'],
      ['`(merge)` is not a merge word: a blank must precede it', 'gh pr view 3 (merge)'],
      ['a `gh` that is the tail of another word', 'sigh pr merge it'],
      ['`gh`, `pr` and `merge` on three lines: bash reads three commands, none a merge', 'gh\npr\nmerge'],
    ])('lets an over-cap command through that is not a merge — %s', (_n, c) => {
      hold(WAVE_HOLD);
      expect(bash(over(c)).deny, `an over-cap ${JSON.stringify(c)} was refused`).toBeNull();
    });

    // Each at 100 KB, through the whole hook, held: none is a merge, and each
    // must clear the 1500 ms whole-hook bound the sync advisory is held to.
    // `splits` over `;` or `gh;` took 43 to 52 s and 14 s here (jq 1.7); the
    // fixed-string split and the prefilter cost 90 to 320 ms (the first five
    // shapes), and 343 to 384 ms on the costliest, at load ~15; a review
    // measured ~600 ms once (review 267 F3).
    // The last shape is the costliest measured: many segments that pass the prefilter.
    it.each([
      ['`;` only', ';'],
      ['`gh;` repeated', 'gh;'],
      ['`gh pr merged;` repeated', 'gh pr merged;'],
      ['newlines only', '\n'],
      ['one long line holding `gh` and `merge` as words, no separator', 'gh merge '],
      ['`gh merge;` repeated: many segments that pass the prefilter (the costliest shape measured)', 'gh merge;'],
    ])('answers 100 KB of %s over the cap in bounded time, denying none of it', (_n, unit) => {
      hold(WAVE_HOLD);
      const c = sized(unit, '', 100000);
      expect(Buffer.byteLength(c)).toBe(100000);
      const t0 = Date.now();
      const r = bash(c);
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(unit)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on 100 KB of ${JSON.stringify(unit)}`).toBeLessThan(1500);
    }, 60000);

    it('refuses only where the deny applies: a session with no wave hold and no marker is never asked', () => {
      expect(bash(sized('gh pr merge 42 ', ' ', CAP + 1)).deny).toBeNull();
      marker();
      const r = bash(sized('gh pr merge 42 ', ' ', CAP + 1)).deny;
      expect(r, 'a marked child\'s over-cap merge went through').not.toBeNull();
      expect(r).toContain('child marker');
      expect(r).toContain('parse cap');
    });

    it('refuses an over-cap body that QUOTES `gh pr merge` — the accepted cost — and says to split or rephrase', () => {
      hold(WAVE_HOLD);
      const mail = (pad: number): string => "ccrc-api mail send --json - <<'J'\n" +
        sized('the wave is done and the suite is green. ', '', pad) + '\nthe coordinator then runs `gh pr merge 42`.\nJ';
      // Under the cap the same body is a quoted heredoc's text, and passes.
      expect(bash(mail(200)).deny, 'a short quoted body was refused: the parse did not run').toBeNull();
      const c = mail(CAP);
      expect(Buffer.byteLength(c)).toBeGreaterThan(CAP);
      const d = bash(c).deny;
      expect(d, 'an over-cap body spelling `gh pr merge` went through').not.toBeNull();
      expect(d).toContain('parse cap');
      expect(d).toContain('or rephrase it');
      expect(d).toContain('Write tool');
    });

    it('answers an over-cap quote-dense command in bounded time — the strip never reads it', () => {
      // `"$(<)"` repeated is the costliest shape measured per byte (one nested
      // strip per span): ~350 ms of CPU at 2048 bytes, so 36 KB parsed would
      // take seconds. Over the cap it costs one linear regex scan.
      hold(WAVE_HOLD);
      for (const [unit, tail, denied] of [['"$(<)"', '\ngh pr merge 42', true], ['"', '\necho merge origin', false]] as const) {
        const c = sized(unit, tail, 36000);
        const t0 = Date.now();
        const r = bash(c);
        const ms = Date.now() - t0;
        expect(r.deny !== null, `${JSON.stringify(unit)}: denied ${r.deny !== null}`).toBe(denied);
        expect(ms, `the hook took ${ms} ms on 36 KB of ${JSON.stringify(unit)}`).toBeLessThan(1500);
      }
    }, 60000);
  });

  // Review 249 F1, pinned as a rule rather than a clock: a `$(` that never
  // closes inside an UNQUOTED heredoc body (which the substitution reader
  // reads) keeps its RAW text, and is never stripped again. Re-stripping it
  // would drop the '…' span below and the merge line inside it. Bash runs
  // neither (it stops at the unclosed `$(`), so this deny is the fail-closed
  // rule's named cost; what the case proves is that the raw text is kept.
  it.each([
    ['a \'…\' span', "cat <<a\n$(echo 'x\ngh pr merge 42\n'\na"],
    ['a "…" span', 'cat <<a\n$(echo "x\ngh pr merge 42\n"\na'],
  ])('keeps an unclosed `$(` in an unquoted heredoc body raw, never stripped again — %s (review 249 F1)', (_n, c) => {
    hold(WAVE_HOLD);
    expect(bash(c).deny, `the unclosed $( was stripped again: ${c}`).not.toBeNull();
  });

  // Review 241 F1: the strip once kept a "…" span that held a `$(` whole, so
  // its CLOSING quote opened a new span that swallowed the merge after it; and
  // a heredoc body's apostrophe opened a '…' span the same way. Each shape is
  // its own case, so a mutation names every shape it lets through.
  it.each([
    ['X="$(date)"; gh pr merge 42; echo "ok"'],
    ['echo "$(date)" && gh pr merge 42 --squash && echo "merged"'],
    ['echo "it\'s $(date)"; gh pr merge 42; echo \'x\''],
    ['cat <<\'EOF\'\nit\'s green\nEOF\ngh pr merge 42\necho \'ok\''],
    ['sha="$(git rev-parse HEAD)"\ngh pr merge 42 --match-head-commit "$sha"'],
    ['echo "hi"; gh pr merge 42; echo "ok"'],
  ])('refuses a merge after a quoted substitution or a heredoc: %j', (c) => {
    hold(WAVE_HOLD);
    expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
  });

  // The strip's own edges, each read as bash reads it: an unquoted heredoc's
  // body runs its substitutions; a heredoc inside `$(…)` may end at `EOF)`; a
  // `<<` in arithmetic (or before a word that is not a name) opens no heredoc;
  // a backtick span, a `#` comment, an escaped quote and a nested "…" span
  // inside a "…" span end where bash ends them; `<<-` lets its terminator be
  // indented with tabs; a `$'…'` string's `\'` does not close it; a `${…}`
  // inside a "…" span holds its own quotes; a top-level heredoc ends only at
  // its whole terminator line (`EOF)` ends one only inside `$(…)`, top-level
  // `$(…)` included); `$$` is a word, never the `$` of a `$'…'`; arithmetic is
  // kept as written, never dropped, so a `$(…)` inside it still runs.
  it.each([
    ['cat <<EOF\n$(gh pr merge 42)\nEOF'],
    ['echo "$(cat <<EOF\nit\'s\nEOF)"; gh pr merge 42; echo \'x\''],
    ['X=$((x<<y))\ngh pr merge 42; echo \'z\''], ['(( x << y ))\ngh pr merge 42; echo \'z\''],
    ['(( $(gh pr merge 42) ))'], ['echo $(( $(gh pr merge 42) ))'], ['echo "$(( $(gh pr merge 42) ))"'],
    ['echo $(( (a+(b+(c))) << 2 ))\ngh pr merge 42; echo \'z\''],
    ['echo "`echo "it\'s"`"; gh pr merge 42; echo \'x\''],
    ['echo "$(date # it\'s\n)"; gh pr merge 42; echo \'x\''],
    ['echo "a \\" $(date)"; gh pr merge 42; echo "b"'],
    ['echo "$(echo "a)b")"; gh pr merge 42; echo "y"'],
    ['cat <<-\'EOF\'\n\tit\'s\n\tEOF\ngh pr merge 42\necho \'ok\''],
    ['echo $\'it\\\'s\'; gh pr merge 42; echo \'x\''],
    ['echo "${x:-"it\'s"}"; gh pr merge 42; echo \'x\''],
    ['echo "${x//"\'"/}"; gh pr merge 42; echo \'x\''],
    ['cat <<\'EOF\'\nEOF)\nit\'s\nEOF\ngh pr merge 42\necho \'x\''],
    ['cat <<EOF\nEOF) and more\nit\'s\nEOF\ngh pr merge 42\necho \'x\''],
    ['x=$(cat <<EOF\nit\'s\nEOF)\ngh pr merge 42; echo \'y\''],
    ['echo $$\'\\\'; gh pr merge 42; echo \'x\''],
    ['echo "$(echo $$\'\\\')"; gh pr merge 42; echo \'x\''],
    ['echo "$(echo ${x:-)} "it\'s" )"; gh pr merge 42; echo \'z\''],
    // `pe` reads `$$` and `$'…'` inside a `${…}` as `sb` does (review 247's re-review I1).
    ['echo "$(echo ${v:-$${})"; gh pr merge 42; echo "})"'],
    ['echo "$(echo ${v:-$${})"\ngh pr merge 42\necho "})"'],
    ['echo "$(echo ${v:-$\'\\\'\'})"\ngh pr merge 42\necho "\'})"'],
  ])('reads a quote, heredoc or arithmetic edge as bash does: %j', (c) => {
    hold(WAVE_HOLD);
    expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
  });

  // Fail closed (fix round 2): what the strip cannot COMPLETE keeps its raw
  // text, so a merge after it is still seen. A heredoc with no exact
  // terminator line keeps its body (bash ends one at `EOF)` inside a `$(…)`
  // the strip may not have parsed); an unclosed span keeps its text; `$` pairs
  // are read from the start of a run; a `${…}` inside a quoted `$(…)` holds its `(`; a
  // `<<` line that leaves a quote open keeps its body; a line of two heredocs
  // is read from the last; a quoted delimiter may hold a blank, and a bare
  // one may start with any word character; a body line `EOF)` keeps the body
  // (bash ends a heredoc there inside a `$(…)` the strip does not parse). Any
  // heredoc opener the strip sees but cannot complete keeps everything from it
  // to the end RAW. An escape takes the rest of its word, so `\ #` opens no
  // comment; a `#` right after `${` or in `"${…}"` is part of the expansion (a
  // ` #` or `(#` inside an UNQUOTED top-level `${…}` is still read as a comment,
  // which the deny's header lists).
  it.each([
    ['cat <<EOF\nit\'s\ngh pr merge 42'],
    ['echo $$$\'\\\'\'; gh pr merge 42; echo \'x\''],
    ['echo $$$$$\'\\\'\'; gh pr merge 42; echo \'x\''],
    ['x=$(cd "$(git rev-parse --show-toplevel 2>/dev/null)" && cat <<EOF\nhi\nEOF)\ngh pr merge 42'],
    ['x=$(echo ")"; cat <<EOF\nhi\nEOF)\ngh pr merge 42'],
    ['x=$(\ncat <<EOF\nhi\nEOF)\ngh pr merge 42'],
    [`x=$(true ${'a'.repeat(210)}; cat <<EOF\nhi\nEOF)\ngh pr merge 42`],
    ['echo "$(cat <<EOF\nhi\nEOF\necho ${y/(/z})"; gh pr merge 42; echo "k)"'],
    ['echo "$(echo ${y/(/z})"\ngh pr merge 42\necho "k)"'],
    ['x=$(cat <<EOF\nhi\nEOF\necho z\ngh pr merge 42'],
    ['echo "unterminated; gh pr merge 42'],
    ['cat <<EOF "x\ny"; gh pr merge 42\nbody\nEOF\necho z'],
    ['cat <<A <<B\nit\'s\nA\nit\'s\nB\ngh pr merge 42\necho \'x\''],
    ['cat <<\'MY EOF\'\nit\'s\nMY EOF\ngh pr merge 42\necho \'x\''],
    ['cat <<1\nit\'s\n1\ngh pr merge 42\necho \'x\''],
    ['x=$(cat <<EOF\nhi\nEOF)\ngh pr merge 42\nEOF'],
    ['cat <<A \'<<\'\nit\'s\nA\ngh pr merge 42\necho \'x\''],
    ['cat <<A # <<\nit\'s\nA\ngh pr merge 42\necho \'x\''],
    ['echo a\\ #; gh pr merge 42'], ['echo a\\\t#x; gh pr merge 42'],
    ['echo ${#x}; gh pr merge 42'], ['echo "${x#y}"; gh pr merge 42'],
    ['echo "$(echo ${x##*/})"; gh pr merge 42; echo \'x\''],
  ])('keeps what it cannot complete, so a merge after it is seen: %j', (c) => {
    hold(WAVE_HOLD);
    expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
  });

  // The merge word may be followed by an operator with no blank between: `;`
  // `&` `|` `(` `)` `<` `>` end it as a blank does (review 247 F3; bare `gh pr
  // merge` merges the current branch's PR, a worker's own wave PR). Every
  // member of the end class has its own case (review 249 F2).
  it.each([
    ['gh pr merge;echo ok'], ['gh pr merge&&echo ok'], ['x=$(gh pr merge)'], ['(gh pr merge)'],
    ['gh pr merge|cat'], ['gh pr merge>/tmp/o'], ['gh pr merge</dev/null'],
  ])('refuses a merge word that an operator ends: %j', (c) => {
    hold(WAVE_HOLD);
    expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
  });

  it('leaves every other gh and every mention of the words alone', () => {
    hold(WAVE_HOLD);
    for (const c of [
      'gh pr view 42', 'gh pr list --search merge', 'gh pr merged 42',
      "grep -rn 'gh pr merge' docs", 'echo "gh pr merge 42"', 'ghx pr merge 42',
      'echo run gh pr merge later', 'echo hi # gh pr merge 42 after the CI run',
      // A closing backtick is no command head: bash runs `echo <date> gh …`.
      'echo `date` gh pr merge 42',
      // What a wave on THIS feature writes about it: commit messages and PR
      // bodies that quote the command, in Markdown code spans and in prose.
      'git commit -m "docs (gh pr merge 42 enqueues)"',
      'git commit -m "fix; gh pr merge is the coordinator\'s"',
      'git commit -m "the coordinator lands with `gh pr merge <n>`, never --admin"',
      "git commit -m \"$(cat <<'MSG'\nfeat(hook): deny `gh pr merge --admin` in every session\nMSG\n)\"",
      "gh pr create --title t --body 'landing is `gh pr merge <n>` with no --admin'",
      // A plain quoted mention, and one holding a separator; a heredoc body is
      // text up to its terminator line — bash runs none of it, even a line
      // that begins `gh pr merge`.
      'echo "gh pr merge"', 'git commit -m "docs; gh pr merge 42 is how"',
      "git commit -F - <<'EOF'\nfix: it's the strip\ngh pr merge 42 enqueues\nEOF",
      "gh pr create --body \"$(cat <<'EOF'\n## Summary\n- it's (part of it\ngh pr merge 42 lands it\nEOF\n)\"",
      "x=$(cat <<'EOF'\nbody: gh pr merge 42 lands it\nEOF\n)",
      // Precision, now that what the strip cannot complete is kept raw: each of
      // these is parsed to its end, so the heredoc mention after it stays text.
      "gh pr create --body \"$(cat <<'EOF'\nit's\ngh pr merge 42 lands it\nEOF)\"",
      "(( x << y ))\ngit commit -F - <<'EOF'\ngh pr merge 42 is how\nEOF",
      "x=\"$(date # it's\n)\"\ngit commit -F - <<'EOF'\ngh pr merge 42 is how\nEOF",
      "git commit -F - <<-'EOF'\n\tgh pr merge 42 is how\n\tEOF\necho done",
      "echo \"${x:-\"a\"}\" && git commit -F - <<'EOF'\ngh pr merge 42 is how\nEOF",
      "echo \"$(echo $$'\\')\" && git commit -F - <<'EOF'\ngh pr merge 42 is how\nEOF",
      "git commit -F - <<'MY EOF'\ngh pr merge 42 is how\nMY EOF",
      "git commit -F - <<1\ngh pr merge 42 is how\n1",
    ]) {
      expect(bash(c).deny, `denied: ${c}`).toBeNull();
    }
  });
});

// ---- the jq `as` checker, used by the last describe in this file ----
type JqTok = { k: 'str' | 'op' | 'open' | 'close' | 'stop' | 'as' | 'word'; s: string };
/** The binary operators (`and` and `or` are words, read in the identifier arm
 *  below), longest first: `//=` before `//` before `/`. `|` is a stop, not one. */
const JQ_SYMBOLS = ['?//', '//=', '|=', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '//',
  '+', '-', '*', '/', '%', '<', '>', '=', ','];
const JQ_STOP_WORDS = new Set(['then', 'else', 'elif', 'if', 'reduce', 'foreach', 'label', 'def', 'catch']);

/** The index just past the jq string literal that opens at `i` (a `"`); each
 *  `\(…)` interpolation's source is pushed on `subs`, so it is checked too. */
const jqString = (src: string, i: number, subs: string[]): number => {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"') return j + 1;
    if (ch === '\\' && src[j + 1] === '(') {
      let depth = 1;
      let k = j + 2;
      while (k < src.length && depth > 0) {
        if (src[k] === '"') { k = jqString(src, k, subs); continue; }
        if (src[k] === '(') depth++;
        else if (src[k] === ')') depth--;
        k++;
      }
      subs.push(src.slice(j + 2, k - 1));
      j = k;
    } else j += ch === '\\' ? 2 : 1;
  }
  throw new Error(`an unterminated jq string in: ${src.slice(i, i + 60)}`);
};

const jqTokens = (src: string, subs: string[]): JqTok[] => {
  const out: JqTok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    const c = src[i] as string;
    let m: RegExpExecArray | null;
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') { i = jqString(src, i, subs); out.push({ k: 'str', s: '"' }); continue; }
    if ((m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)) !== null) { out.push({ k: 'word', s: m[0] }); i += m[0].length; continue; }
    if ((m = /^\.\.|^\.[A-Za-z_][A-Za-z0-9_]*|^\$[A-Za-z_][A-Za-z0-9_:]*/.exec(rest)) !== null) { out.push({ k: 'word', s: m[0] }); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*/.exec(rest)) !== null) {
      const w = m[0];
      out.push({ k: w === 'as' ? 'as' : w === 'and' || w === 'or' ? 'op' : JQ_STOP_WORDS.has(w) ? 'stop' : 'word', s: w });
      i += w.length; continue;
    }
    if (c === '(' || c === '[' || c === '{') { out.push({ k: 'open', s: c }); i++; continue; }
    if (c === ')' || c === ']' || c === '}') { out.push({ k: 'close', s: c }); i++; continue; }
    if (c === ';' || c === ':') { out.push({ k: 'stop', s: c }); i++; continue; }
    if (rest.startsWith('|') && !rest.startsWith('|=')) { out.push({ k: 'stop', s: '|' }); i++; continue; }
    const sym = JQ_SYMBOLS.find((s) => rest.startsWith(s));
    if (sym !== undefined) { out.push({ k: 'op', s: sym }); i += sym.length; continue; }
    out.push({ k: 'word', s: c }); i++;
  }
  return out;
};

/** Every `as` binding in `program` whose source term, read leftwards from the
 *  keyword to where the term starts, holds a binary operator at depth 0: jq 1.7
 *  binds `as` to the nearest term, jq 1.8 to the whole chain, so it means two
 *  different programs. The source ends at an unmatched opener, a `|`, `;`, `:`,
 *  or a keyword that precedes a term (`then`, `reduce`, …), or the start. */
const jqAmbiguousAs = (program: string): Array<{ binding: string; op: string }> => {
  const subs: string[] = [];
  const t = jqTokens(program, subs);
  const found: Array<{ binding: string; op: string }> = [];
  t.forEach((tok, i) => {
    if (tok.k !== 'as') return;
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
      const x = t[j] as JqTok;
      if (x.k === 'close') depth++;
      else if (x.k === 'open') { if (depth === 0) break; depth--; }
      else if (depth > 0) continue;
      else if (x.k === 'stop') break;
      else if (x.k === 'op') { found.push({ binding: `as ${(t[i + 1] as JqTok | undefined)?.s ?? ''}`, op: x.s }); break; }
    }
  });
  for (const sub of subs) found.push(...jqAmbiguousAs(sub));
  return found;
};

/** Every jq program in a shell script: a single-quoted span on a line that holds
 *  `jq`, and a single-quoted `NAME='…'` assignment (the programs the hook keeps
 *  in variables). Comments and double-quoted text are skipped, so an apostrophe
 *  in either opens nothing; a `$'…'` span is skipped with its `\'` escapes. */
const jqPrograms = (sh: string): Array<{ name: string; body: string }> => {
  const out: Array<{ name: string; body: string }> = [];
  let i = 0;
  let lineStart = 0;
  while (i < sh.length) {
    const c = sh[i] as string;
    if (c === '\n') { lineStart = ++i; continue; }
    if (c === '\\') { i += 2; continue; }
    if (c === '#' && (i === 0 || /\s/.test(sh[i - 1] as string))) { while (i < sh.length && sh[i] !== '\n') i++; continue; }
    if (c === '"') {
      i++;
      while (i < sh.length && sh[i] !== '"') { if (sh[i] === '\\') i++; if (sh[i] === '\n') lineStart = i + 1; i++; }
      i++; continue;
    }
    if (c === '\'') {
      const ansi = sh[i - 1] === '$';
      const prefix = sh.slice(lineStart, i);
      let j = i + 1;
      while (j < sh.length && sh[j] !== '\'') { if (ansi && sh[j] === '\\') j++; j++; }
      const named = /^[A-Z][A-Z0-9_]*=$/.exec(prefix);
      if (!ansi && (named !== null || /(^|[^A-Za-z0-9_])jq([^A-Za-z0-9_]|$)/.test(prefix))) {
        const line = sh.slice(0, i).split('\n').length;
        out.push({ name: named !== null ? prefix.slice(0, -1) : `jq at line ${line}`, body: sh.slice(i + 1, j) });
      }
      for (let k = i; k < j; k++) if (sh[k] === '\n') lineStart = k + 1;
      i = j + 1; continue;
    }
    i++;
  }
  return out;
};

describe('every jq `as $name` binding in the hook is parenthesised on its own (jq 1.8 binds `as` to the whole binary chain left of it)', () => {
  const asBindings = (programs: Array<{ body: string }>): number =>
    programs.reduce((n, p) => n + (p.body.match(/\bas \$/g) ?? []).length, 0);

  it('the checker flags what jq 1.7 and 1.8 read differently, flags two more conservatively, and accepts what they read alike', () => {
    for (const bad of [
      '1 + (2) as $x | $x', 'true and ((.w) + ")") as $wp | $wp',
      'if . then 1 else 2 + (3) as $x | $x end', '"\\(1 + (2) as $x | $x)"',
    ]) expect(jqAmbiguousAs(bad), `flagged: ${bad}`).not.toEqual([]);
    // jq 1.7 and 1.8 read these two alike; the checker refuses them anyway, so a
    // reader never has to know which operators bind loosely.
    for (const conservative of ['.a // (.b) as $x | $x', '.a, (.b) as $x | $x']) {
      expect(jqAmbiguousAs(conservative), `flagged conservatively: ${conservative}`).not.toEqual([]);
    }
    expect(jqAmbiguousAs('true and ((.w) + ")") as $wp | $wp').map((f) => f.op)).toEqual(['and']);
    for (const ok of [
      '1 + ((2) as $x | $x)', '(.a + .b) as $x | $x', '.x as $v | $v', 'reduce (1, 2) as $s (0; . + $s)',
      '"a and b" as $s | $s', '.a | (.b + 1) as $y | $y', 'def f(a; b): (a + b) as $z | $z; 1',
      '[.[] | select(. > 1) as $v | $v]', 'foreach (1, 2) as $i (0; . + $i)', '"\\((.a + 1) as $x | $x)"',
    ]) expect(jqAmbiguousAs(ok), `accepted: ${ok}`).toEqual([]);
  });

  it('the extractor reads a jq program in a quote, a variable, a multi-line quote or after a backslash-newline, and nothing in a comment or a double quote', () => {
    const sh = [
      '# a jq that isn\'t here: \'x as $a\'',
      "NAME='1 + (2) as $x | $x'",
      "echo \"it's\" # it's a comment",
      "v=$(jq -r --arg n \"$n\" '.a as $b",
      "  | $b' <<<\"$p\")",
      "printf '%s' \"$x\" | jq -c \"$DEFS\"'.k as $k | $k'",
      // The shape the hook's program near line 1908 relies on: the program
      // opens on the line AFTER a backslash-newline that continues `jq -r`.
      "w=$(jq -r \\",
      "  '.c as $c | $c' <<<\"$p\")",
    ].join('\n');
    expect(jqPrograms(sh).map((p) => [p.name, p.body])).toEqual([
      ['NAME', '1 + (2) as $x | $x'], ['jq at line 4', '.a as $b\n  | $b'], ['jq at line 6', '.k as $k | $k'],
      ['jq at line 8', '.c as $c | $c'],
    ]);
  });

  it('no jq program in ccd/session-hook.sh binds `as` to a binary chain', () => {
    const hook = fs.readFileSync(HOOK, 'utf8');
    const programs = jqPrograms(hook);
    expect(programs.map((p) => p.name), 'the merge strip is among them').toContain('MERGE_STRIP_JQ');
    // A FLOOR, so the scan can never go vacuous: a deleted jq call lowers these, and the
    // number is then re-measured here rather than silently accepted.
    expect(programs.length, 'jq programs found').toBeGreaterThanOrEqual(52);
    expect(asBindings(programs), '`as $` bindings found').toBeGreaterThanOrEqual(33);
    // Coverage by EQUALITY, not floors: every `as $` in a non-comment line of the hook
    // sits inside a program the extractor read, so a binding it cannot reach reds here.
    const bindingsInHook = hook.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').match(/\bas \$/g)!.length;
    expect(asBindings(programs), 'every `as $` in the hook\'s non-comment lines is inside an extracted program').toBe(bindingsInHook);
    expect(hook.split('\n').filter((l) => /\bjq\b[^'\n#]*"[^"\n]*\bas \$/.test(l)),
      'a double-quoted jq program with a binding is outside the extractor').toEqual([]);
    // The over-cap rule splits on FIXED strings: `splits` is a regex-global walk, measured
    // superlinear on jq 1.7 (43 to 52 s at 100 KB of `;`), and a timeout fails the deny open.
    expect(programs.filter((p) => p.body.includes('splits(')).map((p) => p.name),
      'a jq program uses `splits(`: split on a fixed string with `split(` (review 267 F3)').toEqual([]);
    expect(programs.find((p) => p.name === 'MERGE_STRIP_JQ')?.body, 'the over-cap rule splits on a fixed string').toContain('map(split($s))');
    const findings = programs.flatMap((p) => jqAmbiguousAs(p.body).map((f) => `${p.name}: \`${f.binding}\` follows \`${f.op}\``));
    expect(findings, 'an `as` after a binary operator reads differently on jq 1.7 and 1.8: parenthesise it on its own').toEqual([]);
  });
});
