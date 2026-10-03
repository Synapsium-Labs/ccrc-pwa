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

/** One PreToolUse Bash call through the real hook. Exit 0 and a silent stderr
 *  are the hook's standing contract, asserted on every call. */
const bash = (command: string): { deny: string | null; stdout: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: home }),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  expect(r.stderr, 'the hook contract: silent on stderr').toBe('');
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

  it('answers a 100 KB adversarial command in bounded time — the head match restarts at every separator', () => {
    // A token class that can cross a separator, or a blank class that includes
    // the newline, makes every `;a=` / `\na=` / `;gh -R ` start walk to the end
    // of the payload: 5 to 9 s at 36 KB, and 1.6 s at 36 KB for the gh-flag
    // classes alone (so 100 KB, where a walk costs ~12 s and the fix ~0.2 s). An
    // unterminated `<<a` is the strip's own walk: a heredoc that had to find its
    // terminator would scan to the end once per `<<`. The tail carries `merge`
    // outside any quote or comment, so the prefilter lets the match run and a
    // regex that matched any `merge` would deny; none is a merge. The hold makes
    // a wrong match a deny this case can see (review 241 F6).
    hold(WAVE_HOLD);
    const units = [';', '\n'].flatMap((sep) => ['a=', 'gh ', 'gh -R ', 'timeout 1 '].map((unit) => `${sep}${unit}`));
    for (const u of [...units, '<<a\n']) {
      const t0 = Date.now();
      const r = bash(u.repeat(Math.ceil(100000 / u.length)) + '\necho merge origin');
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u)}`).toBeLessThan(3000);
    }
  }, 60000);

  it('strips a heredoc line of many `<<` and a body of unclosed `$(` in bounded time — no recursion per `<<`', () => {
    // A heredoc's rest-of-line is stripped WITHOUT a second heredoc, and a `$(`
    // that never closes is kept raw, not stripped again: either one recursing
    // walks the rest of the payload once per `<<` (2.4 to 3.8 s and 0.4 to
    // 0.6 GB at 16 KB, measured on the strip alone; 15 s and 2.9 GB at 36 KB).
    hold(WAVE_HOLD);
    // The `$(` units sit in an unquoted heredoc body, where the substitution
    // reader meets an unclosed `$(`, stops there and keeps the rest raw (the
    // top level has no `$(` arm of its own).
    for (const [pre, u] of [['', '<<a '], ['cat <<a\n', '$(cat <<a\n']]) {
      const t0 = Date.now();
      const r = bash(pre + u.repeat(Math.ceil(16000 / u.length)) + '\necho merge origin');
      const ms = Date.now() - t0;
      expect(r.deny, `a non-merge was denied: ${JSON.stringify(u)}`).toBeNull();
      expect(ms, `the hook took ${ms} ms on ${JSON.stringify(u)}`).toBeLessThan(1500);
    }
  }, 60000);

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
  // merge` merges the current branch's PR, a worker's own wave PR).
  it.each([
    ['gh pr merge;echo ok'], ['gh pr merge&&echo ok'], ['x=$(gh pr merge)'], ['(gh pr merge)'],
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
