/**
 * The worker merge deny (landing-order wave 2, spec §5.2, ruling R5): the
 * session hook's PreToolUse arm DENIES `gh pr merge` in a session whose hold
 * names a programme wave, and in any workspace that carries the child marker
 * (`$REG/<id>.child`, which only a dispatch writes) — a child whose run has
 * let it go keeps its pane until the reclaim, and it is still a worker. A merge
 * without `--admin` passes outside a held or child session: the coordinator's
 * `gh pr merge <n> --match-head-commit <sha>` is how it enqueues. `--admin` and
 * `gh api` merges (wave 2b, the describes below) are refused in every session.
 * A deny never replaces the graph gate's, which has already counted the denial
 * it prints (D-1689).
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME, the way
 * `session-hook.test.ts` does: a stub `tmux` answers the session name, stdin
 * carries the payload, stdout is the one PreToolUse envelope (or nothing).
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const ID = 'demo-quiet-basin';
const WAVE_HOLD = 'program:landing-order wave:2/5 run:17';

let home: string;
/** The fixture HOME's prefix. Wave 2's cases keep a HOME whose path holds `merge` (so the arm's
 *  substring prefilter always passes); the bypass describe sets one that does not. */
let homePrefix = 'ccrc-mergedeny-';
beforeEach(() => {
  home = mkTmp(homePrefix);
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

/** One PreToolUse Bash call through the real hook; `cwd` is the payload's working directory (the
 *  fixture HOME unless a case names another). Exit 0 and a silent stderr
 *  are the hook's standing contract, asserted on every call. */
const bash = (command: string, nulStderr = false, cwd: string = home): { deny: string | null; stdout: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  // A NUL in the command makes bash warn on stderr when a read of the payload decodes it: the
  // graph-search read (a payload matching rg|grep|ag|ack|find|fd) and the merge arm (a payload
  // holding `merge`). `echo hi\0there` is silent; this fixture's cwd carries `merge` (and so
  // `rg`), so a NUL command here warns from both reads under the cap, and from the graph-search
  // read only over it (over the cap `capped` hands the merge arm nothing to decode).
  if (!nulStderr) expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
  const line = r.stdout.trim();
  if (line === '') return { deny: null, stdout: '' };
  const j = JSON.parse(line) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return {
    deny: j.hookSpecificOutput.permissionDecision === 'deny' ? String(j.hookSpecificOutput.permissionDecisionReason) : null,
    stdout: line,
  };
};

/** Wave 2's parseable spellings of the merge command at a command head: every one is refused to a
 *  wave session, and the bypass describe below rewrites each with `--admin`. */
const SPELLINGS: string[] = [
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
];

/** Wave 2's mentions and other-gh commands: none is a merge at a command head. Three name
 *  `--admin`; the bypass describe runs the list again, with no hold. */
const MENTIONS: string[] = [
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
];

describe('the worker merge deny', () => {
  it('refuses a worker\'s merge, naming the hold and who lands instead', () => {
    hold(WAVE_HOLD);
    const r = bash('gh pr merge 42');
    expect(r.deny, 'a wave session\'s gh pr merge went through').not.toBeNull();
    expect(r.deny).toContain(WAVE_HOLD);
    expect(r.deny).toContain('the coordinator merges, workers never do');
  });

  it('lets a coordinator\'s enqueue through — a session with no wave hold and no child marker is never asked the wave-2 question', () => {
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
    for (const c of SPELLINGS) {
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
      // bash strips NUL from command text and warns on stderr: under the cap from both reads (the
      // graph-search read, the payload holding `merge` and so `rg`, and the merge arm's read);
      // over the cap from the graph-search read only, since `ocwords` is false there.
      expect(bash('gh pr merge\u0000 42', true).deny, 'under the cap the strip reads it').not.toBeNull();
      expect(bash(over('gh pr merge\u0000 42'), true).deny, 'the listed pass was refused: update the hook header\'s list').toBeNull();
    });

    it('reads a merge after multi-byte text: the in-order search slices by codepoint offsets', () => {
      hold(WAVE_HOLD);
      expect(bash(over('é😀 gh -R o/r pr merge 42')).deny, 'a multi-byte prefix misaligned the slice').not.toBeNull();
      expect(bash(over('é😀 gh pr view 3 merged')).deny).toBeNull();
    });

    // The case above cannot red for a byte-offset slice: its ` -R o/r` between `gh` and
    // `pr` absorbs the 4-character overshoot a byte slice makes after `é😀` (review 273 F1).
    // This fixture has nothing between the words to absorb it.
    it('reads a TIGHT `gh pr merge` after multi-byte text: a byte-offset slice misses it (review 273 F1)', () => {
      hold(WAVE_HOLD);
      const d = bash(over('é😀 gh pr merge 42')).deny;
      expect(d, 'a byte-offset slice after é😀 skipped past the `pr` and let the merge through').not.toBeNull();
      expect(d).toContain('parse cap');
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
    // measured ~600 ms once (review 267 F3). Three of the six (`;` only, `gh;`
    // repeated, newlines only) never reach the split: the whole-command
    // `contains("gh") and contains("merge")` prefilter is false for each, so
    // the `splits` timings describe a rule without the prefilter. What guards
    // `splits` is the structural `splits(` ban below and mutation row SP, not
    // these three clocks (review 273 F5 (b)).
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

    it('refuses only where the deny applies: a session with no wave hold and no marker is never asked the wave-2 question', () => {
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
      // The way out for a long MAIL is named, not only a PR body's (review 273 F2): the file
      // goes to `ccrc-api mail send --json`, which keeps the command short.
      expect(d, 'the refusal does not name the mail file way out').toContain('send it with `ccrc-api mail send --json <file>`');
      expect(d).toContain('gh pr create --body-file <file>');
      expect(d).toContain('prose that names gh, pr and merge in that order reads as one');
      expect(d).toContain('A landing is the operator\'s, from their own shell.');
    });

    // THE ACCEPTED CLASS (review 273 F2, ruling 3510): over the cap, any ONE segment that names
    // `gh`, then `pr`, then `merge` as words is refused, prose included. Not a closure and not a
    // bug: it is the hook header's THE COST sentence. A narrowing (only flags between the words)
    // would need a repeated group, the nested quantifier the rule exists to avoid.
    it.each([
      ['a one-line JSON mail body that only MENTIONS the words in that order', (pad: number): string =>
        'ccrc-api mail send --json - <<JSON\n{"body":"' + sized('the wave is done and the suite is green. ', '', pad) +
        'I read PR state with gh pr view 248 and gh pr checks, and the coordinator may merge it after the panel"}\nJSON'],
      ['a trailing `# comment` that says merge', (pad: number): string =>
        'gh pr create --title x --body-file /tmp/b.md --base main ' + sized('--label wave ', '', pad) + ' # merge later'],
    ])('refuses %s over the cap, the ACCEPTED cost (review 273 F2, ruling 3510: see the hook header\'s THE COST sentence) — and passes it under the cap', (_n, build) => {
      hold(WAVE_HOLD);
      const short = build(0);
      expect(Buffer.byteLength(short), 'the unpadded shape is under the cap').toBeLessThanOrEqual(CAP);
      expect(bash(short).deny, 'under the cap the parse reads it as text or a non-merge').toBeNull();
      const c = build(CAP);
      expect(Buffer.byteLength(c)).toBeGreaterThan(CAP);
      const d = bash(c).deny;
      expect(d, 'the accepted over-cap class was let through: the hook header\'s THE COST sentence is stale').not.toBeNull();
      expect(d).toContain('parse cap');
      expect(d).toContain('send it with `ccrc-api mail send --json <file>`');
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
    for (const c of MENTIONS) {
      expect(bash(c).deny, `denied: ${c}`).toBeNull();
    }
  });
});

// ---- the bypass deny (landing-order wave 2b, Task 1): `--admin` in EVERY session ----
// The merge arm's second question. Wave 2 asks whether the session is a worker (a wave hold or the
// child marker); this one asks every session whether the merge it runs carries `--admin`, read from
// the RAW command (quotes included) once the stripped text holds a real merge head. One project may
// keep `--admin` by the operator's allowance file, and only for a command that is exactly one admin
// merge of a PR named by number (`ALLOW_ADMIN_RE`). The fixture HOME's path holds no `merge`, so a
// command that does not spell the word does not reach the arm at all.
const US = '\u001f';
const SHA = '0123456789abcdef0123456789abcdef01234567';

/** `ALLOW_ADMIN_RE`, READ from the hook (never re-typed here): a single-quoted shell assignment. */
const allowRe = (): string => {
  const m = /^ALLOW_ADMIN_RE='([^']*)'$/m.exec(fs.readFileSync(HOOK, 'utf8'));
  if (m === null) throw new Error('the hook no longer defines ALLOW_ADMIN_RE as a single-quoted assignment');
  return m[1] as string;
};
/** The strip's jq program, extracted from the hook the way the `as` checker below extracts it. */
const stripProgram = (): string => {
  const p = jqPrograms(fs.readFileSync(HOOK, 'utf8')).find((x) => x.name === 'MERGE_STRIP_JQ');
  if (p === undefined) throw new Error('the hook no longer keeps MERGE_STRIP_JQ as a single-quoted assignment');
  return p.body;
};
/** One direct run of `MERGE_STRIP_JQ` over a Bash command: the answer line, without jq's newline. */
const strip = (command: string): string => {
  const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--argjson', 'cap', String(CAP), '--arg', 'allow', allowRe(), stripProgram()], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8',
  });
  expect(r.status, `jq failed: ${r.stderr}`).toBe(0);
  return r.stdout.replace(/\n$/, '');
};
/** The flags of an under-cap answer `=<flags><US><stripped>`. */
const flagsOf = (command: string): string => {
  const out = strip(command);
  expect(out.startsWith('='), `not an under-cap answer: ${JSON.stringify(out.slice(0, 40))}`).toBe(true);
  return out.slice(1, out.indexOf(US));
};

const ADMIN = `gh pr merge 42 --admin --match-head-commit ${SHA}`;
/** What `ALLOW_ADMIN_RE` admits: exactly one admin merge of a PR named by number. */
const S_SET = [
  'gh pr merge 42 --admin', ADMIN, 'gh pr merge 42 --squash --admin -d', 'gh pr merge 42 --merge --admin --delete-branch',
  'gh pr merge 42 --rebase --admin', ' gh pr merge 42 --admin \n',
];
const SEPARATORS = [';echo', '&echo', '&&echo', '||echo', '|cat', '\necho'];
/** What it does not: each of these is an `--admin` merge the grammar refuses. */
const S_UNSET = [
  'gh pr merge 42 --admin --repo o/other', 'gh pr merge 42 -R o/other --admin', 'GH_REPO=o/x gh pr merge 42 --admin',
  'gh pr merge https://github.com/o/other/pull/7 --admin', 'gh pr merge ws/alpha --admin', 'gh pr merge --admin 42',
  "gh pr merge '42' --admin", "gh pr merge 42 '--admin'", 'gh pr merge 42 --admin -sA x', 'gh pr merge 42 --subject x --admin',
  'gh pr merge 42 --admin --repo=o/other', 'gh pr merge 42 -Ro/other --admin', 'gh pr merge 42 --auto --admin',
  'gh pr merge ٤٢ --admin', // Arabic-Indic digits
  'cd ../other && gh pr merge 42 --admin', 'echo x; gh pr merge 42 --admin', 'echo x\ngh pr merge 42 --admin',
  'gh pr merge 42 --match-head-commit abc --admin',
  ...SEPARATORS.flatMap((s) => [`gh pr merge 42 --admin${s}`, `gh pr merge 42 --admin ${s}`]),
  '(gh pr merge 42 --admin)', '$(gh pr merge 42 --admin)',
];
/** Wave 2's reason for a hold, byte for byte. */
const waveReason = (h: string): string => `ccrc: this workspace's hold reads \`${h}\` — a programme wave's session, and a wave's session never merges (landing-order R5: the coordinator merges, workers never do). Report wave-done to your coordinator; it lands the PR.`;

// ---- the gh api half (Task 2) ----
/** The four GraphQL mutations that merge or enqueue; two of them hold no lowercase `merge`. */
const MUTATIONS = ['mergePullRequest', 'enqueuePullRequest', 'enablePullRequestAutoMerge', 'mergeBranch'];
const gqlMutation = (word: string): string => `gh api graphql -f query='mutation { ${word}(input: {pullRequestId: "x"}) { clientMutationId } }'`;

const LIFECYCLE = path.resolve(__dirname, '../../ccd/coordinator-skill/references/wave-lifecycle.md');
/** Review Focus 1's first source: every backticked `gh …` span of the lifecycle reference's paragraph
 *  "Landing on a native-queue project", extracted by its anchors, never retyped. A span may wrap across
 *  a line break in the Markdown, so the paragraph's lines are trimmed and joined with a space first. */
const landingSpans = (): string[] => {
  const lines = fs.readFileSync(LIFECYCLE, 'utf8').split('\n');
  const from = lines.findIndex((l) => l.includes('**Landing on a native-queue project**'));
  const to = lines.findIndex((l, i) => i > from && l.includes('**Same project:**'));
  if (from < 0 || to < 0) throw new Error('the lifecycle reference no longer has the paragraph "Landing on a native-queue project" before "Same project:"');
  const text = lines.slice(from, to).map((l) => l.trim()).join(' ');
  const spans = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string).filter((s) => s.startsWith('gh '));
  if (spans.length === 0) throw new Error('the landing paragraph spells no backticked `gh` command');
  return spans;
};
/** Review Focus 1's second source: the landing verdict block, the fenced bash block that follows the
 *  `### 5b` heading, from the line that begins `( # The landing verdict` to before its closing fence. */
const verdictBlock = (): string => {
  const lines = fs.readFileSync(LIFECYCLE, 'utf8').split('\n');
  const heading = lines.findIndex((l) => l.startsWith('### 5b'));
  const start = lines.findIndex((l, i) => i > heading && l.startsWith('( # The landing verdict'));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('```'));
  if (heading < 0 || start < 0 || end < 0) throw new Error('the lifecycle reference no longer has the landing verdict block under "### 5b"');
  return lines.slice(start, end).join('\n');
};

/** `bash()` with the wall time of the call. */
const timed = (command: string): { deny: string | null; ms: number } => {
  const t0 = Date.now();
  const r = bash(command);
  return { deny: r.deny, ms: Date.now() - t0 };
};

describe('the bypass deny (wave 2b)', () => {
  beforeAll(() => { homePrefix = 'ccrc-bypass-'; });
  afterAll(() => { homePrefix = 'ccrc-mergedeny-'; });
  beforeEach(() => { expect(home, 'this describe\'s HOME must not spell the trigger word').not.toContain('merge'); });
  const reg = (...p: string[]): string => path.join(home, '.cc-sessions', ...p);
  const project = (text: string): void => { fs.writeFileSync(reg(`${ID}.project`), text); };
  const allow = (name: string): void => {
    fs.mkdirSync(reg('admin-merge-allowed'), { recursive: true });
    fs.writeFileSync(reg('admin-merge-allowed', name), '');
  };
  const over = (c: string): string => `${c} ${'a'.repeat(CAP)}`;

  it('refuses --admin in a session with no hold and no marker, naming the queue landing, the read, the door and the wide reading', () => {
    const r = bash('gh pr merge 42 --admin');
    expect(r.deny, 'an --admin merge went through').not.toBeNull();
    expect(r.deny).toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
    expect(r.deny).toContain('gh pr merge <n> --match-head-commit <sha>');
    expect(r.deny).toContain('gh pr view <n> --json state,mergedAt');
    expect(r.deny).toContain('R9\'s door');
    expect(r.deny).toContain('the operator\'s own shell or GitHub\'s UI');
    expect(r.deny).toContain('the whole command is read');
    expect(r.deny, 'the reason never claims landing is the operator\'s alone').not.toContain('landing is the operator');
    expect(r.deny, 'the reason does not mention the allowance').not.toMatch(/allow/i);
  });

  it('refuses every parseable merge spelling with --admin inserted after merge', () => {
    const rewritten = SPELLINGS.map((c) => c.replace(/\bmerge /, 'merge --admin '));
    SPELLINGS.forEach((c, i) => expect(rewritten[i], `the rewrite changed nothing: ${c}`).not.toBe(c));
    expect(rewritten).toContain('gh pr merge --admin --auto 42');
    // Wave 2's comment entry holds its first `merge ` inside the `#` comment: that entry is denied
    // through the RAW reading (the strip removes the comment, the raw text still holds `--admin`),
    // its real merge head being `gh pr merge 42`.
    for (const c of rewritten) expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
  });

  it.each([
    ['gh pr merge --admin 42'], ['gh pr merge 42 --admin=true'], ["gh pr merge 42 '--admin'"], ['gh pr merge 42 "--admin"'],
    ['gh pr merge 42 --match-head-commit "$(git rev-parse HEAD)" --admin'], ['gh pr merge $(echo 42) --admin'],
    ['gh pr merge 42 \\\n  --admin'],
    // The wide `a` reading: the flag is the raw SUBSTRING `--admin`, not the word, so a flag that
    // only begins with it is refused too (D-7111). A false refusal here is the named cost.
    ['gh pr merge 42 --admin-foo'],
  ])('refuses the --admin spelling the raw text shows: %j', (c) => {
    expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
  });

  it('a worker\'s --admin still reads as the worker deny — wave 2\'s reason, byte for byte', () => {
    hold(WAVE_HOLD);
    expect(bash('gh pr merge 42 --admin').deny).toBe(waveReason(WAVE_HOLD));
    marker();
    fs.rmSync(reg(`${ID}.hold`));
    expect(bash('gh pr merge 42 --admin').deny).toContain('the child marker');
  });

  it('the coordinator\'s landing passes: clause 15\'s spelling, extracted from the skill, and --disable-auto', () => {
    const skill = fs.readFileSync(path.resolve(__dirname, '../../ccd/coordinator-skill/SKILL.md'), 'utf8');
    const line = skill.split('\n').find((l) => l.startsWith('15. '));
    if (line === undefined) throw new Error('the skill no longer has a clause 15');
    const spans = [...line.matchAll(/`(gh pr merge[^`]*)`/g)].map((m) => m[1] as string);
    if (spans.length === 0) throw new Error('clause 15 no longer spells a `gh pr merge` command in backticks');
    const forms = spans.flatMap((sp) => [sp,
      sp.replace('--<method>', '--squash').replace(/<n>/g, '42').replace(/<handoffCommit>/g, SHA)]);
    for (const f of forms) expect(bash(f).deny, `the coordinator's landing was refused: ${f}`).toBeNull();
    expect(bash('gh pr merge 42 --disable-auto').deny).toBeNull();
  });

  it('the wide reading\'s cost, named: a real merge and an unrelated --admin mention in one command is refused', () => {
    const r = bash(`gh pr merge 42 --match-head-commit ${SHA} && git commit -m "never --admin"`);
    expect(r.deny, 'a quoted --admin beside a real merge went through').not.toBeNull();
    expect(r.deny).toContain('the whole command is read');
  });

  it('mentions with no merge head pass: wave 2\'s list (three of its texts name --admin), and the other --admin mentions', () => {
    expect(MENTIONS.filter((c) => c.includes('--admin')), 'the list lost one of its three --admin texts').toHaveLength(3);
    for (const c of [...MENTIONS, 'echo --admin', 'grep -- --admin docs', 'gh pr view 42 --json mergedAt']) {
      expect(bash(c).deny, `denied: ${c}`).toBeNull();
    }
  });

  it('LISTED pass: a flag word broken by quoting is not the word --admin in the raw text', () => {
    expect(bash("gh pr merge 42 --adm''in").deny, 'the listed pass was refused: update the hook header\'s list').toBeNull();
  });

  it('the answer format: =<flags><US><stripped> under the cap, !<bytes>:<kinds> over it', () => {
    expect(strip('gh pr merge 42 --auto')).toBe(`=${US}gh pr merge 42 --auto`);
    expect(strip('gh pr merge 42 --admin')).toBe(`=as${US}gh pr merge 42 --admin`);
    const longAdmin = over('gh pr merge 42 --admin');
    expect(strip(longAdmin)).toBe(`!${Buffer.byteLength(longAdmin)}:merge,admin`);
    const longPlain = over('gh pr merge 42');
    expect(strip(longPlain)).toBe(`!${Buffer.byteLength(longPlain)}:merge`);
    // `--admin` over the cap with no merge command in it is no kind at all.
    expect(strip(over('echo --admin'))).toBe('');
    // The stripped text still removes the quoted --admin, while the flag reads the raw text.
    expect(strip("gh pr merge 42 '--admin'")).toBe(`=a${US}gh pr merge 42 `);
  });

  it('the allowance flag s: set for exactly one admin merge of a PR named by number, unset for every other spelling', () => {
    for (const c of S_SET) expect(flagsOf(c), `s not set: ${JSON.stringify(c)}`).toContain('s');
    for (const c of S_UNSET) {
      const f = flagsOf(c);
      expect(f, `s set: ${JSON.stringify(c)}`).not.toContain('s');
    }
    // The flag `a` is set by the raw word wherever it stands, quoted or not.
    for (const c of S_UNSET) expect(flagsOf(c), `a not set: ${JSON.stringify(c)}`).toContain('a');
  });

  describe('the operator\'s allowance lets --admin through for that one project', () => {
    it('passes one admin merge, in the grammar, for a session of the allowed project', () => {
      project('proj-a');
      allow('proj-a');
      for (const c of S_SET) expect(bash(c).deny, `refused: ${JSON.stringify(c)}`).toBeNull();
      // The project file may end in a newline, as `ccd` writes it.
      project('proj-a\n');
      expect(bash(ADMIN).deny).toBeNull();
    });

    it('still refuses every spelling the grammar refuses', () => {
      project('proj-a');
      allow('proj-a');
      for (const c of S_UNSET) expect(bash(c).deny, `not denied: ${JSON.stringify(c)}`).not.toBeNull();
    });

    it('still refuses a session of another project, and one whose cwd is named for the allowed project', () => {
      allow('proj-a');
      project('proj-b');
      expect(bash(ADMIN).deny, 'the allowance of proj-a lifted proj-b').not.toBeNull();
      const cwd = path.join(home, 'proj-a');
      fs.mkdirSync(cwd);
      expect(bash(ADMIN, false, cwd).deny, 'the allowance was read from the cwd\'s name').not.toBeNull();
    });

    it('reads the project through the project check: a value that walks out of the directory is refused', () => {
      allow('proj-a');
      project('../admin-merge-allowed/proj-a');
      expect(fs.existsSync(reg('admin-merge-allowed', '..', 'admin-merge-allowed', 'proj-a')), 'the fixture must reach the file').toBe(true);
      expect(bash(ADMIN).deny, 'a project value with a slash reached the allowance').not.toBeNull();
      project('x'.repeat(65));
      allow('x'.repeat(65));
      expect(bash(ADMIN).deny, 'a project value over the bound reached the allowance').not.toBeNull();
    });

    it('refuses an allowance that is a symlink to a regular file, or a directory', () => {
      project('proj-a');
      fs.mkdirSync(reg('admin-merge-allowed'), { recursive: true });
      fs.writeFileSync(reg('real-file'), '');
      fs.symlinkSync(reg('real-file'), reg('admin-merge-allowed', 'proj-a'));
      expect(bash(ADMIN).deny, 'a symlinked allowance lifted the deny').not.toBeNull();
      fs.rmSync(reg('admin-merge-allowed', 'proj-a'));
      fs.mkdirSync(reg('admin-merge-allowed', 'proj-a'));
      expect(bash(ADMIN).deny, 'a directory lifted the deny').not.toBeNull();
    });

    it('refuses a session whose .project is unreadable, empty or absent, though an allowance named for its id stands', () => {
      allow(ID);
      expect(bash(ADMIN).deny, 'an absent .project fell back to the session id').not.toBeNull();
      project('');
      expect(bash(ADMIN).deny, 'an empty .project fell back to the session id').not.toBeNull();
      project('\n');
      expect(bash(ADMIN).deny, 'a blank .project fell back to the session id').not.toBeNull();
      fs.rmSync(reg(`${ID}.project`));
      fs.mkdirSync(reg(`${ID}.project`));
      expect(bash(ADMIN).deny, 'an unreadable .project fell back to the session id').not.toBeNull();
    });

    it('does not lift the over-cap form of the allowed command, padded past the cap so that it still matches the grammar', () => {
      project('proj-a');
      allow('proj-a');
      const padded = ADMIN + ' --squash'.repeat(Math.ceil(CAP / 9));
      expect(Buffer.byteLength(padded)).toBeGreaterThan(CAP);
      // `\A` and `\z` are Oniguruma's; JS spells the same anchors `^` and `$` (no `m` flag).
      const js = new RegExp(allowRe().replace('\\A', '^').replace('\\z', '$'));
      expect(js.test(padded), 'the padded command must still match the grammar').toBe(true);
      const d = bash(padded).deny;
      expect(d, 'an over-cap command lifted the deny').not.toBeNull();
      expect(d).toContain('parse cap');
    });

    it('does not lift wave 2: a worker of the allowed project is refused with wave 2\'s reason', () => {
      project('proj-a');
      allow('proj-a');
      hold(WAVE_HOLD);
      expect(bash(ADMIN).deny).toBe(waveReason(WAVE_HOLD));
    });

    it('never lifts the gh api half: from an allowed session a REST merge call alone is refused', () => {
      project('proj-a');
      allow('proj-a');
      expect(bash('gh pr merge 42 --admin').deny, 'the fixture must be an allowed session').toBeNull();
      const d = bash('gh api -X PUT repos/o/r/pulls/42/merge').deny;
      expect(d, 'the allowance lifted the gh api half').not.toBeNull();
      expect(d).toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
      expect(bash(gqlMutation('enqueuePullRequest')).deny, 'the allowance lifted a GraphQL mutation').not.toBeNull();
    });

    it('lets an allowed session\'s admin merge through from another checkout: the repository gh resolves from ambient state is a LISTED pass (D-7249)', () => {
      project('proj-a');
      allow('proj-a');
      const other = path.join(home, 'another-checkout');
      fs.mkdirSync(other);
      expect(bash('gh pr merge 42 --admin', false, other).deny, 'the listed pass was refused: update the hook header\'s list').toBeNull();
      // The class is named in the header's gh api list, found by its phrase like the other LISTED rows.
      const hk = fs.readFileSync(HOOK, 'utf8');
      const list = hk.slice(hk.indexOf('# WHAT PASSES UNPARSED, the `gh api` half'), hk.indexOf('# The hook is a contract the fleet honours'));
      expect(list, 'the header list does not name the allowance\'s ambient-state class').toContain('a repository gh resolves from ambient');
    });
  });

  describe('over the cap, every session is asked', () => {
    it('refuses an over-cap admin merge in a session with no hold, giving both byte counts and the ways out', () => {
      const c = over('gh pr merge 42 --admin');
      const d = bash(c).deny;
      expect(d, 'an over-cap admin merge went through').not.toBeNull();
      expect(d).toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
      expect(d).toContain(`${Buffer.byteLength(c)} bytes`);
      expect(d).toContain(`${CAP}-byte parse cap`);
      expect(d).toContain('cannot tell prose from a command');
      expect(d).toContain('Write tool');
      expect(d).toContain('--body-file');
      expect(d).toContain('ccrc-api mail send --json <file>');
      expect(d).toContain('R9\'s door');
      expect(d, 'the over-cap reason never claims landing is the operator\'s alone').not.toContain('landing is the operator');
    });

    it('reads --admin anywhere in the raw text once an over-cap segment spells a merge, prose included (the accepted cost)', () => {
      expect(bash(over('gh pr merge 42; echo --admin')).deny).not.toBeNull();
      expect(bash(over('echo "the coordinator never runs gh pr merge 42 --admin"')).deny).not.toBeNull();
    });

    it('passes an over-cap command that is not a merge, or that is a merge with no --admin', () => {
      expect(bash(over('echo --admin')).deny, '--admin with no merge command in it').toBeNull();
      expect(bash(over('gh pr merge 42')).deny, 'an over-cap merge with no --admin: wave 2 asks workers only').toBeNull();
      expect(bash(over('gh pr view 42 --admin')).deny).toBeNull();
    });

    it('asks wave 2 first: a held session\'s over-cap admin merge gets wave 2\'s over-cap reason', () => {
      hold(WAVE_HOLD);
      const d = bash(over('gh pr merge 42 --admin')).deny;
      expect(d).toContain(WAVE_HOLD);
      expect(d).toContain('the coordinator merges, workers never do');
      expect(d).toContain('A landing is the operator\'s, from their own shell.');
    });
  });

  // ---- the gh api half (landing-order wave 2b, Task 2) ----
  // A `gh … api` command head whose RAW text names one of four GraphQL mutations (`w`) or one of two
  // REST merge paths, quotes removed (`p`), is refused in every session by any method, a GET included.
  // The allowance never lifts it. The classes it cannot read are LISTED passes, each pinned below.
  describe('the gh api deny', () => {
    const hookText = fs.readFileSync(HOOK, 'utf8');
    /** The header's gh api list of what passes unparsed, between its heading and the paragraph after it. */
    const listText = (): string => {
      const a = hookText.indexOf('# WHAT PASSES UNPARSED, the `gh api` half');
      const b = hookText.indexOf('# The hook is a contract the fleet honours', a);
      if (a < 0 || b < 0) throw new Error('the hook header no longer has the gh api list of what passes unparsed');
      return hookText.slice(a, b);
    };
    const heredocQuery = (word: string): string =>
      `gh api graphql --input - <<'EOF'\n{"query":"mutation { ${word}(input: {pullRequestId: \\"x\\"}) { clientMutationId } }"}\nEOF`;

    it('refuses each mutation word, the two with no lowercase merge included', () => {
      for (const word of MUTATIONS) {
        const forms = [
          gqlMutation(word),
          `gh api graphql --raw-field query='mutation { ${word}(input: {pullRequestId: "x"}) { clientMutationId } }'`,
          heredocQuery(word),
        ];
        for (const c of forms) {
          const d = bash(c).deny;
          expect(d, `not denied: ${JSON.stringify(c)}`).not.toBeNull();
          expect(d).toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
        }
      }
    });

    it('writes the mutation set once, in the jq program', () => {
      const program = stripProgram();
      for (const word of MUTATIONS) expect(program.split(word).length - 1, `${word} must appear once in the strip's program`).toBe(1);
    });

    it('refuses either path by any method', () => {
      for (const c of [
        'gh api -X PUT repos/o/r/pulls/42/merge', 'gh api --method PUT "repos/{owner}/{repo}/pulls/42/merge"',
        'gh api repos/o/r/pulls/42/merge -f merge_method=squash',
        'gh api -X GET -X PUT repos/o/r/pulls/42/merge', "gh api -X PUT repos/o/r/pulls/42/merge -f commit_title='-X GET'",
        'gh api --method GET repos/o/r/pulls/42/merge',
        'gh api -X POST repos/o/r/merges -f base=main -f head=x',
        'gh api -X PUT repos/o/r/pulls/"$n"/merge', "gh api -X PUT repos/o/r/pulls/42/'merge'",
      ]) expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
    });

    // I1: a word spelled with adjacent quotes or a backslash is the same word to the shell, so the text is
    // tested with every quote and backslash removed. Each spelling keeps `merge` or `Merge` in the payload
    // (the arm's prefilter reads the payload as JSON text, so a word broken inside `enqueue…` skips the arm: LISTED below).
    const BROKEN: Array<[string, string]> = [['merge', 'PullRequest'], ['merge', 'Branch'], ['enablePullRequestAuto', 'Merge']];
    const IN_WORD = ['""', "''", '\\'];
    it('refuses a mutation word broken by adjacent quotes or a backslash, under the cap and over it', () => {
      const cases: string[] = [
        'gh api graphql -f query="mutation { merge""PullRequest(input: {pullRequestId: 1}) { clientMutationId } }"',
        'gh api graphql -f query="mutation { merge"\'PullRequest\'"(input: {pullRequestId: 1}) { clientMutationId } }"',
        "gh api graphql -f query=merge'PullRequest'",
        'gh api graphql -f query="mutation { merge\\PullRequest }"',
        // Formerly a LISTED pass: with its quotes removed its text holds the word whole, so it is read now.
        'q="merge""PullRequest"; gh api graphql -f query="mutation { $q }"',
      ];
      for (const [a, b] of BROKEN) for (const sep of IN_WORD) cases.push(`gh api graphql -f query=${a}${sep}${b}`);
      for (const c of cases) {
        expect(flagsOf(c), `no w flag: ${c}`).toContain('w');
        expect(bash(c).deny, `not denied under the cap: ${c}`).not.toBeNull();
        const long = over(c);
        expect(strip(long), `no api kind over the cap: ${c}`).toMatch(/:api$/);
        expect(bash(long).deny, `not denied over the cap: ${c}`).not.toBeNull();
      }
    });

    // I2: a path segment runs to the next `/` or separator, so a `$(…)` operand is read as part of the path.
    it('refuses a path whose number is a command substitution', () => {
      for (const c of [
        'gh api -X PUT repos/o/r/pulls/$(gh pr view --json number -q .number)/merge',
        'gh api -X PUT repos/o/r/pulls/$(echo 42)/merge',
        'gh api -X PUT repos/$(echo o)/$(echo r)/merges',
      ]) {
        expect(flagsOf(c), `no p flag: ${c}`).toContain('p');
        expect(bash(c).deny, `not denied: ${c}`).not.toBeNull();
      }
    });

    // M3: a backslash in the word or the path is dropped like a quote, once the payload wakes the arm
    // (`-f merge_method=squash` holds the `merge` the payload needs).
    it('refuses a path broken by a backslash, under the cap and over it', () => {
      const c = 'gh api -X PUT repos/o/r/pulls/42/m\\erge -f merge_method=squash';
      expect(flagsOf(c)).toContain('p');
      expect(bash(c).deny).not.toBeNull();
      expect(bash(over(c)).deny).not.toBeNull();
    });

    it('answers a cap-sized run of path starts with long segments, and no merge path, in bounded time', () => {
      // `pulls/` and `repos/` repeated with long runs between them, and the `merge` the payload needs for the
      // arm to run: each start reads its own segments once, so the cost is linear in the command.
      for (const unit of ['pulls/' + 'a b'.repeat(40) + ' ', 'repos/' + 'a'.repeat(100) + '/', 'pulls/$(' + 'x '.repeat(50) + ')']) {
        const c = sized('gh api x ' + unit, ' echo merge', CAP);
        expect(Buffer.byteLength(c)).toBe(CAP);
        const r = timed(c);
        expect(r.deny, `a non-merge was denied: ${JSON.stringify(unit)}`).toBeNull();
        expect(r.ms, `the hook took ${r.ms} ms on ${JSON.stringify(unit)}`).toBeLessThan(1500);
      }
    }, 60000);

    // M6: the reason spells the four words by hand; it must name exactly the set the jq program tests.
    it('the reason names exactly the mutation words the jq program tests', () => {
      const d = bash('gh api --method GET repos/o/r/pulls/42/merge').deny ?? '';
      const named = /a merge mutation \(([^)]*)\)/.exec(d);
      expect(named, 'the reason no longer names the mutation words in parentheses').not.toBeNull();
      const inReason = [...(named?.[1] ?? '').matchAll(/`(\w+)`/g)].map((m) => m[1]).sort();
      const set = /def MUT: \[([^\]]*)\];/.exec(stripProgram());
      expect(set, 'the jq program no longer defines MUT as a list').not.toBeNull();
      const inProgram = [...(set?.[1] ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
      expect(inProgram).toHaveLength(4);
      expect(inReason, 'the reason and the jq program name different mutation words').toEqual(inProgram);
      expect(inProgram).toEqual([...MUTATIONS].sort());
    });

    it('names the substitute for the GET it refuses, and its own sentence for the wide reading', () => {
      const d = bash('gh api --method GET repos/o/r/pulls/42/merge').deny;
      expect(d).toContain('gh pr view <n> --json state,mergedAt');
      expect(d).toContain('a GET included');
      expect(d).toContain('the whole command is read');
    });

    it('passes every read of the landing route, extracted by anchor from the lifecycle reference', () => {
      const spans = landingSpans();
      expect(spans.some((s) => s.startsWith('gh api graphql')), 'the queue read-back is among the spans').toBe(true);
      expect(spans.some((s) => s.startsWith('gh pr merge <pr> --match-head-commit')), 'the enqueue is among the spans').toBe(true);
      for (const sp of spans) {
        const substituted = sp.replace(/<pr>/g, '42').replace(/<handoffCommit>/g, SHA);
        for (const f of [sp, substituted]) expect(bash(f).deny, `the landing route was refused: ${f}`).toBeNull();
      }
    });

    it('passes the landing verdict block whole, in a session with no hold and in a held one, and each of its gh api lines alone', () => {
      const block = verdictBlock();
      // Its comments name `--admin`, and it is over the cap: the over-cap reading must still pass it.
      expect(block).toContain('--admin');
      expect(Buffer.byteLength(block), 'the block is over the cap').toBeGreaterThan(CAP);
      expect(bash(block).deny, 'the whole verdict block was refused with no hold').toBeNull();
      const apiLines = block.split('\n').filter((l) => l.includes('gh api'));
      expect(apiLines.length, 'the verdict block no longer holds a gh api read').toBeGreaterThan(0);
      for (const l of apiLines) expect(bash(l).deny, `a verdict gh api read was refused: ${l}`).toBeNull();
      hold(WAVE_HOLD);
      expect(bash(block).deny, 'a held coordinator runs the verdict, and it was refused').toBeNull();
    });

    it.each([
      ['gh api repos/o/r/pulls/42'],
      ['gh api repos/o/r/pulls/42/merges/x'], // not end-bounded, so not the path
      ['gh api repos/o/r/pulls/42/merge-queue'],
      ['gh api graphql -F p=42 -f query=\'query { repository(owner: "o", name: "r") { pullRequest(number: 42) { mergeQueueEntry { state } } } }\''],
      ['gh api repos/o/r/pulls/42 --jq .merged_at # merge state'],
    ])('passes a read that is not a merge call: %j', (c) => {
      expect(bash(c).deny, `refused: ${c}`).toBeNull();
    });

    it('passes a mutation word or a path in text that has no gh api head', () => {
      for (const c of [
        'git commit -m "never call enqueuePullRequest by hand"',
        "gh pr create --title t --body-file - <<'EOF'\nThe hook refuses mergePullRequest, enqueuePullRequest, enablePullRequestAutoMerge and mergeBranch,\nand the paths repos/o/r/pulls/42/merge and repos/o/r/merges.\nEOF",
        "ccrc-api mail send --json - <<'J'\n{\"body\":\"gh api -X PUT repos/o/r/pulls/42/merge and enqueuePullRequest are refused\"}\nJ",
        'gh pr create --title t --body "uses gh api repos/o/r/pulls/42/merge"',
        'echo gh api -X PUT repos/o/r/pulls/42/merge', 'grep -rn "enablePullRequestAutoMerge" docs',
        'cat <<EOF\ngh api -X PUT repos/o/r/pulls/42/merge\nEOF',
      ]) expect(bash(c).deny, `refused: ${c}`).toBeNull();
    });

    it('the wide reading\'s cost, named: a real gh api call and an unrelated mutation word in one command is refused', () => {
      const d = bash('gh api repos/o/r/pulls/42; echo enqueuePullRequest').deny;
      expect(d, 'a real gh api head beside an unrelated mutation word went through').not.toBeNull();
      expect(d).toContain('a real `gh api` call and an unrelated mention of a mutation word or merge path in one command is refused too');
    });

    // The classes the hook cannot read, each passing and each named in the hook header's
    // WHAT PASSES UNPARSED list (the phrase is searched for there), so a later change that closes one
    // turns this case red and updates the list.
    it.each([
      ['gh api graphql -F query=@mutation.graphql', 'a query or body read from a file'],
      ['gh api graphql --input body.json', 'a query or body read from a file'],
      ['cat f | gh api graphql --input -', 'a query or body read from a file'],
      // The word is assembled in variables, so the text never holds it whole, with or without its quotes.
      ['q=merge; r=PullRequest; gh api graphql -f query="mutation { $q$r }"', 'a word or path assembled at run time'],
      ['gh api -X PUT repos/o/r/pulls/$(cat /tmp/n)/merge', 'a word or path assembled at run time'],
      ['gh api -X PUT repos/o/r/pulls/42/m""erge', 'a word or path broken by quotes or a backslash'],
      ['xargs gh api -X PUT repos/o/r/pulls/42/merge', 'the head grammar\'s own classes'],
      ['gh api -X PUT repos/o/r/pulls/42/%6derge', 'an encoded or non-canonical merge path'],
      ['gh api -X PUT repos/o/r/pulls/42//merge', 'an encoded or non-canonical merge path'],
      ['gh api -X POST repos/o/r//merges -f base=main -f head=x', 'an encoded or non-canonical merge path'],
      ['gh api -X PUT repos/o/r/pulls/42/Merge', 'an encoded or non-canonical merge path'],
      ['gh api graphql --input - <<\'EOF\'\n{"query":"mutation { \\u0065nqueuePullRequest(input: {pullRequestId: \\"x\\"}) { clientMutationId } }"}\nEOF',
        'a mutation word written with JSON `\\u` escapes'],
      ['gh api graphql -f query=\'mutation { \\u006dergePullRequest(input: {pullRequestId: 1}) { clientMutationId } }\'',
        'a mutation word written with JSON `\\u` escapes'],
      ['$GH api -X PUT repos/o/r/pulls/42/merge', 'a variable or quoted command word'],
      ['"gh" api -X PUT repos/o/r/pulls/42/merge', 'a variable or quoted command word'],
      ["gh alias set m 'api -X PUT'", 'a `gh alias`'],
      ['gh api -X PATCH repos/o/r/git/refs/heads/main -f sha=x', 'ways to move `main` that are not merges'],
      ['gh api graphql -f query=\'mutation { updateRef(input: {refId: "x", oid: "y"}) { clientMutationId } }\'', 'ways to move `main` that are not merges'],
      ['git push origin HEAD:main', 'ways to move `main` that are not merges'],
    ])('LISTED pass: %j (%s)', (c, cls) => {
      expect(bash(c).deny, 'the listed pass was refused: update the hook header\'s list').toBeNull();
      expect(listText(), `the hook header's gh api list of what passes unparsed does not name the class "${cls}"`).toContain(cls);
    });

    it('the head grammar is GH_MERGE_RE\'s with `api` for `pr … merge`, derived from its text', () => {
      const defs = ['GH_MERGE_RE', 'GH_API_CUT', 'GH_API_RE'].map((n) => {
        const m = new RegExp(`^${n}=.*$`, 'm').exec(hookText);
        if (m === null) throw new Error(`the hook no longer defines ${n} on one line`);
        return m[0];
      }).join('\n');
      const run = (script: string, ...args: string[]): string => {
        const r = spawnSync('bash', ['-c', `${defs}\n${script}`, 'x', ...args], { encoding: 'utf8' });
        expect(r.status, r.stderr).toBe(0);
        return r.stdout;
      };
      const [mergeRe, apiRe] = run('printf "%s\\0%s" "$GH_MERGE_RE" "$GH_API_RE"').split('\0') as [string, string];
      const headEnd = apiRe.indexOf('[ \t]+api(');
      expect(headEnd, 'the api tail follows the head').toBeGreaterThan(0);
      expect(mergeRe.startsWith(apiRe.slice(0, headEnd)), 'GH_API_RE\'s head is GH_MERGE_RE\'s, character for character').toBe(true);
      expect(apiRe.slice(0, headEnd)).not.toContain('[ \t]+pr(');
      const verdicts = (cmds: string[]): boolean[] =>
        run('for c in "$@"; do if [[ "$c" =~ $GH_API_RE ]]; then echo 1; else echo 0; fi; done', ...cmds).trim().split('\n').map((x) => x === '1');
      const yes = ['gh api x', 'GH_TOKEN=x gh -R o/r api x', 'env gh api x', 'gh api', 'echo ok; gh api x', 'x=$(gh api y)', 'timeout 60 gh api x',
        '/usr/bin/gh api x', 'gh --hostname h api x', 'gh api;echo'];
      const no = ['gh apix', 'gh pr view', 'echo gh api x', 'ghx api x', 'gh pr merge 42', 'gh alias set m api', 'gh -R o/r pr view api'];
      expect(verdicts(yes), `matched: ${yes.join(' | ')}`).toEqual(yes.map(() => true));
      expect(verdicts(no), `matched: ${no.join(' | ')}`).toEqual(no.map(() => false));
    });

    it('answers the api flags from the raw text: `w` for a mutation word, `p` for a path with its quotes removed', () => {
      expect(flagsOf('gh api graphql -f query=\'mutation { mergeBranch }\'')).toContain('w');
      expect(flagsOf('gh api -X PUT repos/o/r/pulls/42/merge')).toContain('p');
      expect(flagsOf('gh api --method PUT "repos/{owner}/{repo}/pulls/42/merge"'), 'the path is read from the raw text, quotes removed').toContain('p');
      expect(flagsOf("gh api -X PUT repos/o/r/pulls/42/'merge'")).toContain('p');
      expect(flagsOf('gh api -X POST repos/o/r/merges')).toContain('p');
      expect(flagsOf('gh api repos/o/r/pulls/42/merges/x'), 'not end-bounded').not.toContain('p');
      expect(flagsOf('gh api repos/o/r/pulls/42')).not.toMatch(/[wp]/);
    });
  });

  describe('over the cap, the gh api kind', () => {
    const pad = (n: number): string => sized('pad ', '', n);
    it('refuses an over-cap REST merge call, answering inside the existing bound', () => {
      const c = over('gh api -X PUT repos/o/r/pulls/42/merge');
      expect(strip(c)).toBe(`!${Buffer.byteLength(c)}:api`);
      const r = timed(c);
      expect(r.deny, 'an over-cap REST merge went through').not.toBeNull();
      expect(r.deny).toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
      expect(r.deny).toContain(`${Buffer.byteLength(c)} bytes`);
      expect(r.deny).toContain(`${CAP}-byte parse cap`);
      expect(r.deny).toContain('cannot tell prose from a command');
      expect(r.ms, `the hook took ${r.ms} ms`).toBeLessThan(1500);
    });

    it('refuses an over-cap heredoc body that names a mutation, and an over-cap multi-line -f query', () => {
      for (const word of MUTATIONS) {
        const heredoc = `gh api graphql --input - <<'EOF'\n${pad(CAP)}\n${word}\nEOF`;
        const multi = `gh api graphql -f query='mutation {\n  ${word}(input: {pullRequestId: "x"}) { clientMutationId }\n}' ${pad(CAP)}`;
        for (const c of [heredoc, multi]) {
          expect(Buffer.byteLength(c)).toBeGreaterThan(CAP);
          const r = timed(c);
          expect(r.deny, `an over-cap ${word} went through: ${JSON.stringify(c.slice(0, 60))}`).not.toBeNull();
          expect(r.deny).toContain('parse cap');
          expect(r.ms, `the hook took ${r.ms} ms`).toBeLessThan(1500);
        }
      }
    });

    it('refuses the two mutations that hold no lowercase merge, from a HOME whose path holds none, over the cap too', () => {
      expect(home).not.toContain('merge');
      for (const word of ['enqueuePullRequest', 'enablePullRequestAutoMerge']) {
        expect(bash(over(gqlMutation(word))).deny, `an over-cap ${word} went through`).not.toBeNull();
      }
    });

    it('passes an over-cap command that holds neither a mutation word nor /merge, or no gh api head', () => {
      expect(bash(over('gh api repos/o/r/pulls/42')).deny, 'a gh api read').toBeNull();
      expect(bash(over('echo hello')).deny).toBeNull();
      expect(bash(over('echo enqueuePullRequest')).deny, 'a mutation word with no gh api in it').toBeNull();
      expect(bash(over('echo gh pr view; echo /merge')).deny, '/merge with no gh api in it').toBeNull();
      expect(bash(over('gh pr merge 42')).deny, 'wave 2\'s reading, unchanged').toBeNull();
    });

    it('reads the api words in order, in one segment: another segment\'s gh does not pair with this one\'s api', () => {
      expect(bash(over('gh pr view 42; api /merge')).deny).toBeNull();
      expect(bash(over('api gh /merge')).deny).toBeNull();
      expect(bash(over('gh x api /merge')).deny, '`api` as a later word of the segment reads as an api call').not.toBeNull();
    });

    it('answers 100 KB of api shapes in bounded time', () => {
      // Many segments that pass the whole-command prefilter and the per-segment one: the first segment
      // that reads as an api call ends the search; the reversed words never do.
      // The quote-dense and backslash-dense shapes cost the three fixed-string split-and-joins that make
      // the quote-free text the api kind reads; each ends in a real api command, so the kind is reached.
      for (const [unit, tail, denied] of [['gh api x/merge;', '', true], ['api gh;', '/merge', false], ['gh api;', '', false],
        ['"', '\ngh api x/merge', true], ["'", '\ngh api x/merge', true], ['\\', '\ngh api x/merge', true]] as const) {
        const c = sized(unit, tail, 100000);
        const r = timed(c);
        expect(r.deny !== null, `${JSON.stringify(unit)}: denied ${r.deny !== null}`).toBe(denied);
        expect(r.ms, `the hook took ${r.ms} ms on 100 KB of ${JSON.stringify(unit)}`).toBeLessThan(1500);
      }
    }, 60000);

    it('a held session\'s over-cap api-only command gets the bypass reason, not wave 2\'s', () => {
      hold(WAVE_HOLD);
      const d = bash(over('gh api -X PUT repos/o/r/pulls/42/merge')).deny;
      expect(d).toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
      expect(d, 'wave 2 fired without a merge in the kinds').not.toContain(WAVE_HOLD);
      expect(d).not.toContain('the coordinator merges, workers never do');
    });

    it('over the cap, the coordinator\'s long prose that quotes an admin merge is refused (the named cost)', () => {
      const body = `${pad(CAP)} and then the coordinator never runs gh pr merge 42 --admin`;
      const c = `gh pr create --title t --body '${body}'`;
      expect(Buffer.byteLength(c)).toBeGreaterThan(CAP);
      const d = bash(c).deny;
      expect(d, 'over the cap the hook cannot tell prose from a command').not.toBeNull();
      expect(d).toContain('cannot tell prose from a command');
      expect(d).toContain('Split it into commands of at most');
      expect(d).toContain('--body-file');
    });

    it('over the cap, prose that quotes a gh api merge is refused the same way', () => {
      const c = `gh pr create --title t --body '${pad(CAP)} and then run gh api -X PUT repos/o/r/pulls/42/merge'`;
      const d = bash(c).deny;
      expect(d).not.toBeNull();
      expect(d).toContain('cannot tell prose from a command');
      expect(d).toContain('`gh … api`');
    });
  });

  describe('the deny\'s precedence', () => {
    // Wave 2's two precedence cases, re-run for the bypass deny: it supersedes a sync advisory, and it
    // never replaces the graph gate's counted deny.
    it.each([
      ['an admin merge', 'git merge origin/main && gh pr merge 42 --admin'],
      ['an api merge', 'git merge origin/main && gh api -X PUT repos/o/r/pulls/42/merge'],
    ])('supersedes a sync advisory on the same call — one line, and it is the deny: %s', (_n, c) => {
      const r = bash(c);
      expect(r.stdout.split('\n')).toHaveLength(1);
      expect(r.deny, 'the advisory won and the bypass went through').toMatch(/^ccrc: `--admin` and `gh api` merges are refused in every session/);
    });

    it.each([
      ['an admin merge', 'rg assembleFleet src && gh pr merge 42 --admin'],
      ['an api merge', 'rg assembleFleet src && gh api -X PUT repos/o/r/pulls/42/merge'],
    ])('never replaces the graph gate\'s counted deny: %s', (_n, command) => {
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
        input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: tree }),
        encoding: 'utf8',
        env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
          TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
      });
      expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
      expect(r.stdout.trim(), 'the gate did not fire — this case went blind').not.toBe('');
      const reason = String(JSON.parse(r.stdout.trim()).hookSpecificOutput.permissionDecisionReason);
      expect(reason, 'the bypass deny replaced the graph gate\'s counted deny').toContain('Denial 1 of 3');
    });
  });

  describe('the arm\'s budget', () => {
    /** A `jq` first on PATH that logs each call's option words, then runs the real one. */
    const countJq = (): void => {
      const real = (process.env['PATH'] ?? '').split(':').map((d) => path.join(d, 'jq')).find((p) => fs.existsSync(p));
      if (real === undefined) throw new Error('no jq on PATH');
      fs.writeFileSync(path.join(home, 'bin', 'jq'),
        `#!/bin/sh\nl=""\nfor a in "$@"; do case "$a" in -*|cap|allow) l="$l $a";; esac; done\necho "$l" >> "${path.join(home, 'jq.calls')}"\nexec ${real} "$@"\n`,
        { mode: 0o755 });
    };
    const calls = (): string[] => {
      const f = path.join(home, 'jq.calls');
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l !== '') : [];
    };
    const lines = (c: string): string[] => { fs.rmSync(path.join(home, 'jq.calls'), { force: true }); bash(c); return calls(); };

    it('one strip per payload: a merge command costs exactly one more jq than the same command with its trigger words replaced, and it carries --argjson cap', () => {
      countJq();
      bash('echo warm'); // the first call in a fresh HOME does one-time work of its own
      // The coordinator's landing: it is not denied, so no deny envelope (which costs its own jq) is built.
      const withMerge = lines(`gh pr merge 42 --match-head-commit ${SHA}`);
      // `marge` keeps the letters `rg` that `merge` carries, so the graph-search read, which the word
      // `merge` also wakes, is the same on both sides and the difference is the arm's own call.
      const without = lines(`gh pr marge 42 --match-head-commit ${SHA}`);
      expect(withMerge.length - without.length, 'the arm made more than one jq call, or none').toBe(1);
      expect(withMerge.filter((l) => l.includes('--argjson cap')), 'the one extra call carries the cap').toHaveLength(1);
      expect(without.filter((l) => l.includes('--argjson cap'))).toHaveLength(0);
      expect(withMerge.filter((l) => l.includes('--arg allow')), 'the allowance grammar rides the same call').toHaveLength(1);
    });

    it('the prefilter also lets `Merge` and `enqueuePullRequest` reach the strip, and nothing else does', () => {
      countJq();
      bash('echo warm');
      expect(lines('echo Merge').length - lines('echo Marge').length, 'a capitalised Merge').toBe(1);
      expect(lines('echo enqueuePullRequest').length - lines('echo enqueuePullRequezt').length, 'the enqueue mutation').toBe(1);
      expect(lines('echo enablePullRequestAutoMerge').length - lines('echo enablePullRequestAutoMarge').length,
        'the auto-merge mutation (it holds `Merge`)').toBe(1);
      expect(lines('echo mergeBranch').length - lines('echo margeBranch').length, 'the branch mutation (it holds `merge`)').toBe(1);
      // The control: two different commands that wake no trigger word cost the same number of jq calls.
      expect(lines('echo hello').length - lines('echo world').length, 'the control').toBe(0);
    });
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
 *  binds `as` to the nearest term, jq 1.8 to the whole chain, so most of these mean
 *  two different programs. It flags every binary operator, including one both
 *  versions read alike (`,`), so a reader never has to know which. The source ends at an unmatched opener, a `|`, `;`, `:`,
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

  it('the checker flags an `as` after a binary operator, whether jq 1.7 and 1.8 read it differently (`//`) or alike (`,`), and accepts a parenthesised or leading `as`', () => {
    for (const bad of [
      '1 + (2) as $x | $x', 'true and ((.w) + ")") as $wp | $wp',
      'if . then 1 else 2 + (3) as $x | $x end', '"\\(1 + (2) as $x | $x)"',
    ]) expect(jqAmbiguousAs(bad), `flagged: ${bad}`).not.toEqual([]);
    // Measured on {"a":5,"b":2} (review 273 F5 (c)): jq 1.7 and 1.8.2 read `//` differently,
    // `.a // (.b) as $x | [$x]` giving `5` on 1.7 and `[5]` on 1.8.2 (with a bare `| $x` body
    // both give `5`, which hides it). They read `,` alike: `.a, (.b) as $x | [$x]` gives `5`
    // then `[2]` on both. The checker flags both, so a reader never has to know which
    // operators bind loosely.
    for (const flagged of ['.a // (.b) as $x | [$x]', '.a // (.b) as $x | $x', '.a, (.b) as $x | $x']) {
      expect(jqAmbiguousAs(flagged), `flagged: ${flagged}`).not.toEqual([]);
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

  // The delegation spool's jq definitions (`DSP_DEFS`, delegation broker wave 3) are a 28-binding program the hook keeps in a
  // variable and splices into the payload parse only for a payload that names a delegation tool or event. The extractor reads a
  // `NAME='…'` span only when NAME is upper-case and opens the line (the form the hook's other kept programs use); the same text
  // under a lower-case name, or after another statement, is outside it, and the coverage equality below then reds. These rows pin
  // the form the spool uses, and that the guard is not blind to the form it must not use.
  it('the extractor reads a kept program that is an upper-case NAME=\'…\' opening its line, and not the same text after another statement or under a lower-case name', () => {
    const program = ".k as $k | $k";
    const seen = (sh: string): string[] => jqPrograms(sh).map((p) => p.name);
    expect(seen(`DSP_DEFS='${program}'; other="x"`), 'opening the line').toEqual(['DSP_DEFS']);
    expect(seen(`other="x"; DSP_DEFS='${program}'`), 'after another statement').toEqual([]);
    expect(seen(`dsp_defs='${program}'`), 'under a lower-case name').toEqual([]);
    // What a hidden binding does to the coverage equality: the count of `as $` in the non-comment lines exceeds the extracted one.
    const bindings = (sh: string): { extracted: number; inText: number } => ({
      extracted: asBindings(jqPrograms(sh)),
      inText: sh.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').match(/\bas \$/g)?.length ?? 0,
    });
    const reads = bindings(`DSP_DEFS='${program}'; x=1`);
    expect(reads.extracted, 'read').toBe(reads.inText);
    const hidden = bindings(`x=1; dsp_defs='${program}'`);
    expect(hidden.extracted, 'hidden').toBeLessThan(hidden.inText);
  });

  it('the spool\'s definitions are read as a program of their own, with their bindings counted, and no binding in them follows a binary operator', () => {
    const hook = fs.readFileSync(HOOK, 'utf8');
    const lines = hook.split('\n');
    const at = lines.filter((l) => l.startsWith("DSP_DEFS='"));
    expect(at, 'exactly one line opens with the assignment').toHaveLength(1);
    const defs = jqPrograms(hook).filter((p) => p.name === 'DSP_DEFS');
    expect(defs, 'and the extractor reads it once').toHaveLength(1);
    expect((defs[0]!.body.match(/\bas \$/g) ?? []).length, 'its bindings are in the count (not zero, not hidden)').toBeGreaterThanOrEqual(20);
    expect(defs[0]!.body.startsWith('def maxline:') && defs[0]!.body.endsWith('end;'), 'the whole program, definition to definition').toBe(true);
    expect(jqAmbiguousAs(defs[0]!.body), 'every `as` in it is parenthesised on its own').toEqual([]);
    // The parse line takes it by expansion, between the two spans of the parse program, and no other line holds a copy.
    expect(lines.filter((l) => l.includes('"$dsp_defs"')), 'one expansion, in the parse').toHaveLength(1);
    expect(lines.filter((l) => /^\s*[^#]*\bdef spool:/.test(l)), 'one copy of the program').toHaveLength(1);
  });

  it('no jq program in ccd/session-hook.sh binds `as` to a binary chain', () => {
    const hook = fs.readFileSync(HOOK, 'utf8');
    const programs = jqPrograms(hook);
    expect(programs.map((p) => p.name), 'the merge strip is among them').toContain('MERGE_STRIP_JQ');
    // A FLOOR, so the scan can never go vacuous: a deleted jq call lowers these, and the
    // number is then re-measured here rather than silently accepted.
    // FLOOR 52, composition (the extractor's count, measured at each ref): 52 at the base of the stall-watch work
    // (the Start/Stop arm read the file with `.ask // null` and `.interrupted == true`); 54 after D-4039 added two
    // programs (the arm's `.waitBy` read and the tool-event carry's own three-field read); 51 after D-4041 removed
    // four (those three Start/Stop reads and the carry's read) and added one, the shared `_hook_fresh_read`; 52 once
    // merged, since the role-skill deny (D-4934, #392) had added one on `main` first, its read of the skill's name
    // (`main` stood at 53 against a floor of 52). The 33 `as $` bindings below were 33 at every ref.
    // FLOOR 54 programs and 61 bindings once the delegation spool (wave 3, Task 5) landed, measured at its merge with #189's
    // forked-session work: +2 programs (the payload parse is now two single-quoted spans around the `$dsp_defs` expansion where it
    // was one, and `DSP_DEFS` is the spool's definitions, an upper-case variable opening its line so this extractor reads it) and
    // +28 bindings, every one of them in `DSP_DEFS` (the two parse spans hold none). The bindings stayed 33 and the programs 52
    // everywhere else. Two rows above pin the form `DSP_DEFS` uses, since the same text under another spelling is invisible here.
    expect(programs.length, 'jq programs found').toBeGreaterThanOrEqual(54);
    expect(asBindings(programs), '`as $` bindings found').toBeGreaterThanOrEqual(61);
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
