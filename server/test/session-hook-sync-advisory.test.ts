// The landing-order advisory (spec 2026-09-23 §5.1, "The hook reaches sessions
// the skills do not"): on a Bash call that merges, pulls or rebases `main` into
// the current branch — or asks GitHub to do it with update-branch — the
// PreToolUse arm of `ccd/session-hook.sh` emits `additionalContext` naming the
// three triggers and the probe command. It NEVER denies: 27% of sync episodes
// came from sessions that load no ccrc skill, and this is the only text those
// sessions see; a deny would be a merge gate this spec does not ship.
//
// A FILE OF ITS OWN, not a describe in `session-hook.test.ts`, for two measured
// reasons: that suite is a known load flake (CLAUDE.md), and it is itself a
// CITED file whose lines the frozen compaction-card corpus names up to
// `:7043-7056` — every line added above that moves an anchor. The harness below
// is the same one it uses (fixture HOME, stub tmux on PATH, payload on stdin).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
let home: string;
beforeEach(() => {
  home = mkTmp('ccrc-hook-sync-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.generation'), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "cc-demo-quiet-basin"\n', { mode: 0o755 });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const hook = (payload: object): { stdout: string; stderr: string } => {
  const r = spawnSync('bash', [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
      TMUX_PANE: '%1', CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242',
      CCRC_SESSION_GENERATION: GENERATION },
  });
  expect(r.status, 'the hook contract: exit 0 on every path').toBe(0);
  return { stdout: r.stdout, stderr: r.stderr };
};
const bash = (command: string): object =>
  ({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: home });
/** Exactly one line of JSON on stdout, or a failed assertion. */
const oneLine = (stdout: string): any => {
  const lines = stdout.trim().split('\n').filter((l) => l !== '');
  expect(lines, 'the hook printed nothing, or more than one line').toHaveLength(1);
  return JSON.parse(lines[0]!);
};

const SYNCS = [
  'git merge origin/main',
  'git merge --no-edit origin/main',
  'git pull origin main',
  'git pull --rebase origin main',
  'git rebase origin/main',
  'git -C /w/demo merge origin/main',
  'cd /w/demo && git merge origin/main && npm test',
  'git fetch origin && git merge -X theirs origin/HEAD',
  'git merge main',
  'gh pr update-branch 42',
  'gh api -X PUT repos/o/r/pulls/42/update-branch',
  // The review round's additions: a quoted ref, git's global options, an
  // env-var prefix, a newline separator, the remote's HEAD by name, and the
  // GraphQL spelling of GitHub's branch update.
  'git merge "origin/main"',
  "git merge 'origin/main'",
  'git -c merge.conflictstyle=diff3 merge origin/main',
  'git --no-pager merge origin/main',
  'GIT_EDITOR=true git merge origin/main',
  'git status\ngit merge origin/main',
  'git pull origin HEAD',
  // `(` and `{` are separators, and real syncs: the token classes stop AT them
  // (the timing pin's reason) but a sync opened by one still advises.
  '(cd /w/demo && git merge origin/main)',
  '{ git merge origin/main; }',
  `gh api graphql -f query='mutation { updatePullRequestBranch(input: {pullRequestId: "X"}) { clientMutationId } }'`,
];
const NOT_SYNCS = [
  'git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD',
  'git merge-base --is-ancestor HEAD origin/main',
  'git fetch origin main',
  'git log --oneline origin/main..HEAD',
  'git diff origin/main',
  'git merge feature/other',
  'git checkout main-feature',
  'echo "git merge origin/main"',
  'git pull',
  // A sync MENTIONED, not run: `git` is not in command position in any of
  // these, so the separator rule keeps them silent.
  'git commit -m "Workers now git merge origin/main only on a conflict"',
  "echo 'run git rebase origin/main first'",
  'gh pr comment 5 --body "please git merge origin/main and re-run"',
  'git pull origin feature/x',
  // A newline is a separator BEFORE `git` and plain text nowhere else: the
  // arguments of one line never run on into the next. Each advised before the
  // regex stopped treating a newline as argument whitespace.
  'git rebase -i HEAD~3\ngit push origin HEAD',
  'git pull\ngit push origin main',
  'git merge --no-edit feature/x\ngit push origin main',
  'git merge feature/x\ngit log origin main',
];

describe('session-hook: the landing-order advisory on a sync of main', () => {
  it.each(SYNCS)('advises on `%s` — additionalContext, never a decision', (command) => {
    const env = oneLine(hook(bash(command)).stdout);
    const out = env.hookSpecificOutput;
    expect(out.hookEventName).toBe('PreToolUse');
    expect(out, 'the advisory never denies, asks or allows').not.toHaveProperty('permissionDecision');
    const text: string = out.additionalContext;
    // The three triggers, each by the phrase that names it, and the probe.
    expect(text).toContain('three triggers');
    expect(text).toContain('(1) the branch conflicts');
    expect(text).toContain('(2) a required check on the PR is red while main');
    expect(text).toContain('(3) the coordinator');
    expect(text).toContain('git merge-tree --write-tree --name-only --no-messages HEAD origin/HEAD');
    // Both halves of the conflict answer, in clause 16's words: git 2.43 exits
    // 1 for an unresolvable ref too, so "exit 1" alone would license a typo.
    expect(text).toContain('exit 1 with a tree id on the first line');
    expect(text).toContain('any other answer is unmeasured and licenses nothing');
  });

  it.each(NOT_SYNCS)('stays silent on `%s`', (command) => {
    expect(hook(bash(command)).stdout).toBe('');
  });

  it('stays silent when the tool is not Bash, even when its input carries a sync command', () => {
    // The tool NAME is the one guard: the command is read from `tool_input`
    // whatever the tool, so this payload reaches the regex unless the name
    // stops it first.
    expect(hook({ hook_event_name: 'PreToolUse', tool_name: 'Task',
      tool_input: { prompt: 'sync the branch', command: 'git merge origin/main' }, cwd: home }).stdout).toBe('');
  });

  // PermissionRequest is the one that bites: its arm reads `tool` exactly as
  // PreToolUse's does, so only the EVENT test keeps a PreToolUse envelope off
  // a permission prompt for the same Bash call.
  it.each(['PostToolUse', 'PermissionRequest'])('stays silent on %s — the advisory is for the call about to run', (event) => {
    expect(hook({ hook_event_name: event, tool_name: 'Bash',
      tool_input: { command: 'git merge origin/main' }, cwd: home }).stdout).toBe('');
  });

  it('still writes the session state it always wrote, and says nothing on stderr', () => {
    const r = hook(bash('git merge origin/main'));
    expect(r.stderr).toBe('');
    const state = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json'), 'utf8'));
    expect(state.state).toBe('working');
    expect(state.event).toBe('PreToolUse');
  });

  it('does not depend on the graph gate: it advises with the gate switched off and a hookstate that will not parse', () => {
    // The graph arm is skipped for BOTH conditions (`$GRAPH_GATE_OFF`, and
    // `hs_unreadable`); the advisory reads neither.
    fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(home, '.ccrc', 'graph-gate-off'), '');   // `$GRAPH_GATE_OFF`
    fs.writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json'), '{not json');
    const env = oneLine(hook(bash('git pull origin main')).stdout);
    expect(env.hookSpecificOutput.additionalContext).toContain('three triggers');
  });

  // The hot path. A newline-separated run of `git merge a` lines gave the
  // arguments group a quadratic walk (3.5 s on 36 KB measured) while the same
  // text with `;` separators took 18 ms. The first fix covered the newline
  // only: `(` and `{` are in the leading separator class too, and the argument
  // token class did not exclude them, so every `(` or `{` opened a new start
  // position that walked to the end of the line (4.5 s on 39 KB measured). The
  // option and env-value token classes had the same walk for EVERY separator,
  // on a payload with no whitespace in it. So the pin runs every separator
  // through every class that takes an unbounded token, and a new separator or
  // class that is not on the list is the next hole. The bound is generous on
  // purpose: it names a complexity class, not a speed, and a loaded box must
  // not flake it. The tail carries `merge` and `origin` so the prefilter lets
  // the regex run; none of the payloads syncs main.
  const SEPARATORS: Array<[string, string]> = [
    ['newline', '\n'], ['semicolon', ';'], ['ampersand', '&'], ['pipe', '|'],
    ['open paren', '('], ['open brace', '{'],
  ];
  const SHAPES: Array<[string, (sep: string) => string]> = [
    ['arguments', (sep) => `${sep}git merge a `],
    ['option value', (sep) => `${sep}git --a=`],
    ['-C directory', (sep) => `${sep}git -C `],
    ['env-var value', (sep) => `${sep}a=`],
  ];
  const ADVERSARIAL = SEPARATORS.flatMap(([sepName, sep]) =>
    SHAPES.map(([shapeName, unit]): [string, string] =>
      [`${sepName} x ${shapeName}`, unit(sep).repeat(Math.ceil(36000 / unit(sep).length)) + '\n# merge origin']));
  it.each(ADVERSARIAL)('answers a 36 KB adversarial command (%s) inside a generous bound', (_name, command) => {
    expect(command.length).toBeGreaterThan(36000);
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout, 'no line of it merges main').toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });

  // QUOTE-DENSE, AT THE MERGE DENY'S PAYLOAD CAP (landing-order wave 3). The
  // deny's quote strip runs on every Bash call that carries `merge`, held or
  // not, and pays per quoted span and per quoted substitution: bare `"` took
  // 1584 ms at 36 KB, over this bound. The deny parses nothing longer than
  // MERGE_PARSE_CAP bytes, so these are the costliest commands it still reads:
  // each shape at exactly the cap, the cap READ from the hook. Raising the cap
  // past what the strip can afford reds here. The landing advisory's own regex
  // is linear on these shapes (100 KB of each, ~130 ms, measured), so it has
  // no cap. The tail carries `merge` so the strip runs; no hold, so no deny.
  const CAP = ((): number => {
    const m = /^MERGE_PARSE_CAP=(\d+)$/m.exec(fs.readFileSync(HOOK, 'utf8'));
    if (m === null) throw new Error('the hook no longer defines MERGE_PARSE_CAP as a bare integer');
    return Number(m[1]);
  })();
  const QUOTE_DENSE: Array<[string, string]> = [
    ['bare double quotes', '"'], ["bare single quotes", "'"], ['$( runs', '$('],
    ['quoted substitutions holding a quote', '"$(\'\')"'], ['quoted substitutions holding a <', '"$(<)"'],
  ];
  it.each(QUOTE_DENSE)('answers a quote-dense command at the merge deny\'s cap (%s) inside the bound', (_name, unit) => {
    const tail = '\n# merge origin';
    const command = unit.repeat(Math.ceil(CAP / unit.length)).slice(0, CAP - tail.length) + tail;
    expect(Buffer.byteLength(command)).toBe(CAP);
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout).toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });
  // The same shapes at 36 KB, far over the cap and holding no `gh`: the deny
  // passes them unparsed after one linear regex scan (`MERGE_OVERCAP_RE`:
  // they spell no `gh pr merge`), so what this clock times is the landing
  // advisory's own regex on quote runs. It is linear there (measured above);
  // a regex that walked from every quote would not be.
  it.each(QUOTE_DENSE)('answers a 36 KB quote-dense command (%s): the deny passes it unparsed, the advisory reads it inside the bound', (_name, unit) => {
    const command = unit.repeat(Math.ceil(36000 / unit.length)) + '\n# merge origin';
    expect(command.length).toBeGreaterThan(36000);
    expect(command, 'a `gh` would make the deny refuse it unread in a held session; this case times the advisory').not.toContain('gh');
    const t0 = Date.now();
    const r = hook(bash(command));
    const ms = Date.now() - t0;
    expect(r.stdout, 'no line of it merges main').toBe('');
    expect(ms, `the whole hook took ${ms} ms`).toBeLessThan(1500);
  });

  // PRECEDENCE. One envelope per event, and a graph-arm deny wins: a compound
  // call that is a search at its HEAD (the gate's question) and a sync later
  // on one line meets BOTH arms. Without the `-z "$pre_json"` conjunct the
  // advisory would overwrite the deny after the arm had already charged the
  // session a denial, so the session would see advice and lose the deny.
  it('prints the graph arm deny, not the advisory, when one call meets both', () => {
    const tree = path.join(home, 'tree');
    fs.mkdirSync(tree, { recursive: true });
    const git = (...a: string[]): string => execFileSync('git', ['-C', tree, '-c', 'user.email=f@example.invalid',
      '-c', 'user.name=fixture', ...a], { encoding: 'utf8' }).trim();
    git('init', '-q');
    fs.writeFileSync(path.join(tree, 'c0.txt'), '0\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'c0');
    const out = path.join(tree, 'graphify-out');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'graph.json'),
      `{\n  "hyperedges": [],\n  "built_at_commit": "${git('rev-parse', 'HEAD')}"\n}\n`);
    fs.writeFileSync(path.join(out, 'GRAPH_REPORT.md'), '# Graph Report - demo\n\n## Summary\n- 4242 nodes · 1 edges · 1 communities\n');
    const payload = { hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'grep -rn foo .; git merge origin/main' }, cwd: tree };
    const j = oneLine(hook(payload).stdout);
    expect(JSON.stringify(j), 'the advisory overwrote the graph arm deny').not.toContain('landing advisory');
    expect(j.hookSpecificOutput.permissionDecision, 'the graph arm did not deny: the fixture is wrong').toBe('deny');
    expect(j.hookSpecificOutput.permissionDecisionReason).toContain('graphify gate:');
    const state = JSON.parse(fs.readFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hookstate.json'), 'utf8'));
    expect(state.graphGateDenials, 'the denial that was charged is the one that was said').toBe(1);
  });
});
