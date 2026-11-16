/**
 * The session hook's test-route arm (D-7298): tests and typechecks run through `ccrc test`. On a
 * PreToolUse a Bash call that starts `systemd-run` with a test or typecheck word is denied, with a reason that names
 * `ccrc test`; `ccrc test` itself, a systemd-run of anything else, and a test file whose name only mentions systemd-run
 * pass untouched, and a payload the arm cannot read fails open. A heredoc body is text unless something can run it
 * (D-8052).
 *
 * Runs `ccd/session-hook.sh` for real in a fixture HOME. Never the live HOME.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { platformContrast } from './platformFixtures.js';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const CCRC_TEST = path.resolve(__dirname, '../../ccd/ccrc-test');
const GENERATION = '0189abcd-1234-5678-9abc-0123456789ab';
const TOP = 'project-a-calm-mesa';
const CWD = '/srv/work/project-a';

let home: string;
beforeAll(() => {
  home = mkTmp('ccrc-test-route-hook-');
  const reg = path.join(home, '.cc-sessions');
  fs.mkdirSync(reg, { recursive: true });
  fs.writeFileSync(path.join(reg, `${TOP}.generation`), GENERATION);
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\nprintf "cc-%s\\n" "${TMUX_PANE#%}"\n', { mode: 0o755 });
  // `ccrc test` is the real wrapper: the arm asks its classifier, the one ccrc has.
  fs.writeFileSync(path.join(bin, 'ccrc'), `#!/bin/sh\n[ "$1" = test ] || exit 2\nshift\nexec bash '${CCRC_TEST}' "$@"\n`, { mode: 0o755 });
});
afterAll(() => { fs.rmSync(home, { recursive: true, force: true }); });

const env = (): NodeJS.ProcessEnv => ({
  ...process.env, HOME: home, PATH: `${path.join(home, 'bin')}:${process.env['PATH'] ?? ''}`,
  TMUX_PANE: `%${TOP}`, CLAUDE_CODE_SESSION_ID: 'uuid-1', CLAUDE_PID: '4242', CCRC_SESSION_GENERATION: GENERATION,
});
const run = (stdin: string): string => {
  const r = spawnSync('bash', [HOOK], { input: stdin, encoding: 'utf8', env: env() });
  expect(r.status, 'exit 0 on every path').toBe(0);
  expect(r.stderr, 'silent on stderr').toBe('');
  return r.stdout.trim();
};
/** The deny reason, or null when the hook printed no deny. */
const bash = (command: string): string | null => {
  const out = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: CWD }));
  if (out === '') return null;
  const e = JSON.parse(out) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
  return e.hookSpecificOutput.permissionDecision === 'deny' ? String(e.hookSpecificOutput.permissionDecisionReason) : null;
};

describe('the test-route arm denies a test or typecheck under a systemd-run of its own (D-7298)', () => {
  it.each([
    'systemd-run --user --scope -p MemoryMax=8G npx vitest run',
    'systemd-run --user --scope --slice=app.slice -- npx tsc --noEmit -p test/tsconfig.tests.json',
    'cd server && systemd-run --user --unit=t1 npm test',
    'env -u GIT_DIR systemd-run --user --scope npm run test:browser',
    '/usr/bin/systemd-run --user --scope ./node_modules/.bin/vitest run test/foo.test.ts',
    'systemd-run --user --scope npx playwright test',
    'systemd-run --user --scope npm run typecheck-tests',
    'true; systemd-run --user --scope npx stryker run',
    'S=systemd-run; $S --user --scope npx vitest run',
    // The reader is the wrapper's own classifier, so every spelling it reads as a test is denied under systemd-run.
    '"systemd-run" --user --scope npx vitest run',
    'systemd-run --user --scope bun test',
    'systemd-run --user --scope npm t',
    'systemd-run --user --scope npm --prefix server test',
    'systemd-run --user --scope pnpm -r test',
    'systemd-run --user --scope tsgo -p .',
    'systemd-run --user --scope make test',
    "sh -c 'systemd-run --user --scope npx tsc'",
    // `ccrc test` around a systemd-run of one's own is read through the same wrapped check.
    'ccrc test -- systemd-run --user --scope npx vitest run',
    'cd server && ccrc test --heavy -- systemd-run --user --scope -- npx tsc --noEmit -p test/tsconfig.tests.json',
  ])('%s is denied, with a reason that names ccrc test', (cmd) => {
    const why = bash(cmd);
    expect(why).toMatch(/run tests and typechecks through `ccrc test -- <command>`/);
    expect(why).toContain('never under a systemd-run of your own');
  });
});

describe('the test-route arm allows what is not a hand-placed test run (D-7298)', () => {
  it.each([
    'ccrc test -- npx vitest run --maxWorkers=2 test/foo.test.ts',
    'ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json',
    './node_modules/.bin/vitest run test/systemd-run.test.ts',
    'systemd-run --user --scope sleep 1',
    'systemd-run --user --scope ccrc test -- npx vitest run',
    'grep -n systemd-run ccd/ccrc-test',
    'npx vitest run test/foo.test.ts',
  ])('%s is allowed', (cmd) => {
    expect(bash(cmd)).toBeNull();
  });
  it('a non-Bash tool naming systemd-run and vitest is allowed', () => {
    const out = run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/x/systemd-run vitest' }, cwd: CWD }));
    expect(out).not.toMatch(/ccrc test/);
  });
});

// A heavy test or typecheck started in command position outside `ccrc test` runs in the session's own pane scope, past
// the slice and the queue. On a fleet box (Linux, a registered session) the arm denies it; macOS has no slice to send
// it to, so it is allowed there.
const BARE_HEAVY = [
  'npx vitest run',
  'cd server && npx tsc --noEmit -p test/tsconfig.tests.json',
  'npm test',
  'env -u GIT_DIR npx vitest run --maxWorkers=2 test/',
  "tmux new-window 'npx vitest run'",
  "bash -c 'npm run typecheck'",
  'setsid npx vitest run',
  'sudo -u ci npx tsc --noEmit',
  "flock -w 5 /tmp/l -c 'npm test'",
  'eval "npx vitest run"',
  'make test',
];
platformContrast('a bare heavy test run', {
  darwin: ['is allowed: no slice to send it to', () => {
    for (const cmd of BARE_HEAVY) expect(bash(cmd), cmd).toBeNull();
  }],
  linux: ['is denied, with a reason that names ccrc test', () => {
    for (const cmd of BARE_HEAVY) {
      const why = bash(cmd);
      expect(why, cmd).toMatch(/starts a heavy test or typecheck outside `ccrc test`/);
      expect(why, cmd).toContain('ccrc test -- <command>');
    }
  }],
});

describe('the bare-heavy arm leaves light and contained runs alone (D-7298)', () => {
  it.each([
    'ccrc test -- npx vitest run',
    'cd server && ccrc test -- npx tsc --noEmit -p test/tsconfig.tests.json',
    'npx vitest run --maxWorkers=2 test/foo.test.ts',
    'grep -rn vitest server/test',
    "git commit -m 'npx vitest run'",
    'npm run build',
  ])('%s is allowed', (cmd) => {
    expect(bash(cmd)).toBeNull();
  });
});

// A heredoc's body is text unless something can run it (D-8052). The classifier drops a body only when it can read the
// whole line and every command on it is one that does not run the body; anything else keeps the old reading, in which
// the body's lines are commands. The rows are run through the classifier on every platform, since macOS has no bare-heavy
// arm, and through the hook on a fleet box.
const lines = (...l: string[]): string => l.join('\n');
const classify = (line: string): string =>
  spawnSync('bash', [CCRC_TEST, '--classify-shell', '--', line], { encoding: 'utf8', env: env() }).stdout.trim();
const TICKED = '- [x] `npm run typecheck`';
const BODY_IS_TEXT = [
  // The two measured false positives.
  lines("gh pr create --title t --body-file - <<'EOF'", TICKED, 'EOF'),
  lines("node - <<'EOF'", "const { chromium } = require('playwright');", 'EOF'),
  // Each reader that does not run its stdin as shell.
  lines("python3 - <<'PY'", 'npm test', 'PY'),
  lines("cat <<'EOF'", 'npm test', 'EOF'),
  lines("cat > notes.md <<'EOF'", 'npx tsc --noEmit', 'EOF'),
  lines("cat <<'EOF' > notes.md", 'npx tsc --noEmit', 'EOF'),
  lines("tee notes.md <<'EOF'", 'make test', 'EOF'),
  lines("git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines("sudo tee /etc/notes <<'EOF'", 'npm test', 'EOF'),
  lines("read -r -d '' BODY <<'EOF' || true", 'npm test', 'EOF'),
  // A body in a command substitution used as an argument.
  lines('gh pr create --title t --body "$(cat <<\'EOF\'', TICKED, 'EOF', ')"'),
  lines('gh pr create --title t --body "$(cat <<EOF', 'npm test', 'EOF', ')" --base main'),
  lines('git commit -m "$(cat <<\'EOF\'', 'fix: the thing', '', TICKED, 'EOF', ')"'),
  lines('GIT_AUTHOR_NAME=a env -u GIT_DIR git commit -m "$(cat <<\'EOF\'', 'npm test', 'EOF', ')" && git push'),
  lines("gh pr create --body $(cat <<'EOF'", 'npm test', 'EOF', ')'),
  lines('BODY="$(cat <<\'EOF\'', 'npm test', 'EOF', ')"', 'gh pr create --body "$BODY"'),
  // Delimiter spellings.
  lines('cat <<EOF', 'npm test', 'EOF'),
  lines('cat <<"EOF"', 'npm test', 'EOF'),
  lines('cat <<\\EOF', 'npm test', 'EOF'),
  lines("cat << 'EOF'", 'npm test', 'EOF'),
  lines("cat <<'E'OF", 'npm test', 'EOF'),
  lines("cat <<-'EOF'", '\tnpm test', '\tEOF'),
  lines('cat <<-EOF', '\tnpm test', '\t\tEOF'),
  // A line indented by spaces, or a tab without the dash, ends nothing.
  lines("cat <<-'EOF'", '  EOF', 'npm test', 'EOF'),
  lines("cat <<'EOF'", '\tEOF', 'npm test', 'EOF'),
  // More than one heredoc on a line, read in order.
  lines("cat <<'A' <<'B'", 'npm test', 'A', 'npx tsc', 'B'),
  lines("cat <<'A'; cat <<'B'", 'npm test', 'A', 'npx tsc', 'B'),
  // An unquoted body is expanded, but text with no live substitution in it, or only an escaped one, is still text.
  lines('cat <<EOF', '$HOME ${HOME} npm', 'npm test', 'EOF'),
  lines('cat <<EOF', '\\$(npm test) \\`npm test\\`', 'EOF'),
  lines('cat <<EOF', '\\\\\\$(npm test)', 'EOF'),
  // A quoted body is not expanded at all.
  lines("cat <<'EOF'", '$(npm test)', '`npm test`', 'EOF'),
  // A shell string is read on its first line only, so a nested heredoc is `cat <<EOF` with no body: a known limit.
  "sh -c 'cat <<EOF\nnpm test\nEOF'",
  // The real line is read as it was: these are light, so the line is.
  lines("npx vitest run --maxWorkers=2 test/foo.test.ts && gh pr create --body-file - <<'EOF'", TICKED, 'EOF'),
  lines("gh pr create --body-file - <<'EOF'", TICKED, 'EOF', 'npx vitest run --maxWorkers=2 test/foo.test.ts'),
  lines("cd server && npm run build && git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines('ccrc test -- npx vitest run && git commit -m "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines("if [ -f x ]; then", "  cat <<'EOF'", 'npm test', 'EOF', 'fi'),
  lines('git commit -F - <<< "msg" && cat <<\'EOF\'', 'npm test', 'EOF'),
  // A body naming systemd-run is text too, where the arm that sees it runs on every session.
  lines("gh pr create --body-file - <<'EOF'", 'systemd-run --user --scope npx vitest run', 'EOF'),
  // A command line continued over a backslash-newline is one line.
  lines('gh pr create --title t \\', "  --body-file - <<'EOF'", TICKED, 'EOF'),
  lines("git commit \\", "  -F - <<'EOF'", 'npm test', 'EOF'),
  lines("cat <<'EOF' \\", '  > notes.md', 'npm test', 'EOF'),
  lines('cd server && \\', "  git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines('gh pr create --title "a \\', 'b" --body-file - <<\'EOF\'', 'npm test', 'EOF'),
  // A test program by name, or a package script by name, stands beside a body.
  lines("npm ci && git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines("yarn run build && git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines("pnpm lint && git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines("ccrc test --heavy -- npx vitest run && git commit -F - <<'EOF'", 'npm test', 'EOF'),
  // A substitution in an argument, or before the real command, leaves that command the one that is read.
  lines("gh pr create --title \"$(git log -1 --format=%s)\" --body-file - <<'EOF'", TICKED, 'EOF'),
  lines('gh pr create --body "$(cat <<\'EOF\'', TICKED, 'EOF', ')" --base "$(git rev-parse --abbrev-ref HEAD)"'),
  lines('gh pr edit 1 --body "$(cat <<\'EOF\'', TICKED, 'EOF', ')"'),
  lines('REV="$(git rev-parse HEAD)"', "gh pr edit 1 --body-file - <<'EOF'", TICKED, 'EOF'),
  lines("X=\"$(true)\" git commit -F - <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(date)\" cat <<'EOF'", 'npm test', 'EOF'),
  // A plain `>&2` or `2>&1` beside a reader changes nothing.
  lines(">&2 cat <<'EOF'", 'npm test', 'EOF'),
  lines("git commit -F - <<'EOF' 2>&1", 'npm test', 'EOF'),
  // A word that holds a newline is one word, and what follows it is the command.
  lines("X='a", "b' cat <<'EOF'", 'npm test', 'EOF'),
  lines("git commit -m 'one", "two' && cat <<'EOF'", 'npm test', 'EOF'),
  lines("echo $'it\\'s' && cat <<'EOF'", 'npm test', 'EOF'),
];
const BODY_RUNS_OR_UNREAD = [
  // Fed to a shell.
  lines('bash <<EOF', 'npm test', 'EOF'),
  lines("sh <<'EOF'", 'npx vitest run', 'EOF'),
  lines("zsh <<'EOF'", 'npm test', 'EOF'),
  lines("dash <<'EOF'", 'npm test', 'EOF'),
  lines("bash -s <<'EOF'", 'npm test', 'EOF'),
  lines("bash -s -- one two <<'EOF'", 'npm test', 'EOF'),
  lines("/bin/bash <<'EOF'", 'npm test', 'EOF'),
  lines("ssh box <<'EOF'", 'npm test', 'EOF'),
  lines("ssh -T box bash -s <<'EOF'", 'npm test', 'EOF'),
  lines("sudo -u ci bash <<'EOF'", 'npm test', 'EOF'),
  lines("env A=1 bash <<'EOF'", 'npm test', 'EOF'),
  lines("timeout 60 sh <<'EOF'", 'npm test', 'EOF'),
  lines("exec bash <<'EOF'", 'npm test', 'EOF'),
  lines("sudo -s <<'EOF'", 'npm test', 'EOF'),
  lines("<<'EOF' bash", 'npm test', 'EOF'),
  lines("bash<<'EOF'", 'npm test', 'EOF'),
  lines("bash <<-'EOF'", '\tnpm test', '\tEOF'),
  lines("source /dev/stdin <<'EOF'", 'npm test', 'EOF'),
  lines(". /dev/stdin <<'EOF'", 'npm test', 'EOF'),
  lines("make -f - <<'EOF'", 'all:', 'npm test', 'EOF'),
  lines("xargs -I{} sh -c {} <<'EOF'", 'npm test', 'EOF'),
  lines("while read -r c; do $c; done <<'EOF'", 'npm test', 'EOF'),
  // A reader whose output, or whose file, a shell then takes.
  lines("cat <<'EOF' | bash", 'npm test', 'EOF'),
  lines("cat <<'EOF' | sudo sh -s", 'npm test', 'EOF'),
  lines("tee run.sh <<'EOF' | bash", 'npm test', 'EOF'),
  lines("cat <<'EOF' | ssh box", 'npm test', 'EOF'),
  lines("cat <<'EOF' | xargs -I{} sh -c {}", 'npm test', 'EOF'),
  lines("cat <<'EOF' | npx bash", 'npm test', 'EOF'),
  lines("cat > run.sh <<'EOF'", 'npm test', 'EOF', 'bash run.sh'),
  lines("cat > run.sh <<'EOF'", 'npm test', 'EOF', 'chmod +x run.sh && ./run.sh'),
  lines("{ cat <<'EOF'", 'npm test', 'EOF', '} | bash'),
  // A substitution whose text is a command, or a shell's argument.
  lines('bash -c "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('eval "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('ssh box "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('$(cat <<\'EOF\'', 'npm test', 'EOF', ')'),
  lines('"$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('A=1 $(cat <<\'EOF\'', 'npm test', 'EOF', ')'),
  lines('nohup $(cat <<\'EOF\'', 'npm test', 'EOF', ')'),
  lines('if true; then $(cat <<\'EOF\'', 'npm test', 'EOF', '); fi'),
  lines('npx bash -c "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('X="$(cat <<\'EOF\'', 'npm test', 'EOF', ')"', '$X'),
  lines('X="$(cat <<\'EOF\'', 'npm test', 'EOF', ')"', 'eval "$X"'),
  lines('X="$(cat <<\'EOF\'', 'npm test', 'EOF', ')"', 'npx bash -c "$X"'),
  lines("read -r X <<'EOF'", 'npm test', 'EOF', '$X'),
  lines("bash <(cat <<'EOF'", 'npm test', 'EOF', ')'),
  lines("npx bash <(cat <<'EOF'", 'npm test', 'EOF', ')'),
  lines("tee >(npx bash) <<'EOF'", 'npm test', 'EOF'),
  // An unquoted body's substitutions are run, whatever reads the body: bash runs these before `cat` sees them.
  lines('cat <<EOF', '$(npm test)', 'EOF'),
  lines('cat <<EOF', '`npm test`', 'EOF'),
  lines('cat <<EOF', '\\\\$(npm test)', 'EOF'),
  lines('gh pr create --body-file - <<EOF', TICKED, 'EOF'),
  lines('gh pr create --body "$(cat <<EOF', TICKED, 'EOF', ')"'),
  // The real line, before, beside and after a body.
  lines('npx tsc --noEmit && cat <<EOF', 'hello', 'EOF'),
  lines('cat <<EOF && npx vitest run', 'hello', 'EOF'),
  lines('cat <<EOF; npm test', 'hello', 'EOF'),
  lines('cat <<EOF', 'hello', 'EOF', 'npx vitest run'),
  lines('cat <<EOF', 'hello', 'EOF', 'cd server && npm run typecheck'),
  lines("cat <<'A'", 'hello', 'A', "cat <<'B'", 'hello', 'B', 'make test'),
  lines("(cat <<'EOF'", 'hello', 'EOF', ') && npm test'),
  lines('echo "$(cat <<EOF', 'hello', 'EOF', ')" "$(npx tsc --noEmit)"'),
  lines('gh pr create --body "$(cat <<EOF', 'hello', 'EOF', ')" && npm test'),
  lines('node node_modules/vitest/vitest.mjs run <<EOF', 'hello', 'EOF'),
  // Text that only looks like a heredoc, so what follows it is a command.
  lines("echo '<<EOF'", 'npm test', 'EOF'),
  lines("echo '<<EOF '", 'npm test', 'EOF'),
  lines('echo "<<EOF"', 'npm test', 'EOF'),
  lines('echo "<<EOF "', 'npm test', 'EOF'),
  lines('echo \\<<EOF', 'npm test', 'EOF'),
  lines('echo hi # <<EOF', 'npm test', 'EOF'),
  lines('cat <<<EOF', 'npm test', 'EOF'),
  lines('echo $((1<<2))', 'npm test', '2'),
  lines('echo $[1<<2]', 'npm test', '2'),
  lines('echo $[1<<2 ]', 'npm test', '2'),
  lines('((x=1<<2))', 'npm test', '2'),
  lines('echo "${X:-"<<EOF"}"', 'npm test', 'EOF'),
  lines('echo "${X:-"<<EOF "}"', 'npm test', 'EOF'),
  // A body that cannot be read with confidence keeps the old reading.
  lines('cat <<EOF', 'npm test'),
  lines('cat <<EOF', 'npm test', 'EOF '),
  lines('cat <<EOF', 'npm test', 'EOFX'),
  lines('X=$(cat <<EOF', 'hello', 'EOF) && npm test', 'EOF'),
  lines('X=$(cat <<EOF', 'hello', 'EOF) && npm test', 'EOF', ')'),
  lines('cat <<EOF', 'EOF\\', '', 'npm test', 'EOF'),
  lines('cat <<EOF', 'E\\', 'OF', 'npm test', 'EOF'),
  lines('cat <<$X', 'npm test', '$X'),
  lines("cat <<''", 'npm test', ''),
  lines('cat <<', 'npm test', 'EOF'),
  lines('echo `cat <<EOF', 'npm test', 'EOF', '`'),
  lines('cat <<A $(cat <<B', 'npm test', 'B', ')', 'npm test', 'A'),
  lines('cat $(echo <<EOF)', 'npm test', 'EOF'),
  lines('gh --a "$(echo <<EOF)" --b "$(true', 'npm test', 'EOF', ')"'),
  lines('cat <<A $(cat <<B', 'x', 'A', 'npm test', 'B', ')'),
  // After a backslash-newline a `#` is inside a word, and the quote it opens hides the heredoc: `npm test` runs.
  lines('echo a\\', "#'", 'echo <<EOF', "'", 'npm test', 'EOF'),
  // A line the reader knows only part of keeps the old reading whole, here a body beside one that does run.
  lines("cat <<'A'", 'npm test', 'A', "bash <<'B'", 'echo hello', 'B'),
  lines("docker ps && gh pr create --body-file - <<'EOF'", TICKED, 'EOF'),
  // A backslash-newline joins two lines, so the command after it is the one that takes the body.
  lines('cd /tmp && \\', "  bash -s <<'EOF'", 'npm test', 'EOF'),
  lines('true && \\', "  sh <<'EOF'", 'npm test', 'EOF'),
  lines('A=1 \\', "  bash <<'EOF'", 'npm test', 'EOF'),
  lines("cat <<'EOF' | \\", '  bash', 'npm test', 'EOF'),
  lines("cat <<'EOF' | \\", '  xargs -I{} sh -c {}', 'npm test', 'EOF'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'true && \\', '  bash r.sh'),
  lines('true && \\', '  eval "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('true && \\', '  bash -c "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('true && \\', "  ssh box bash -s <<'EOF'", 'npm test', 'EOF'),
  lines("cat <<'EOF' | \\", '  sudo bash', 'npm test', 'EOF'),
  // A backslash-newline inside a word: bash joins the word, and the reader does not follow it.
  lines('ba\\', "sh <<'EOF'", 'npm test', 'EOF'),
  lines('$\\', "(cat <<'EOF'", 'npm test', 'EOF', ')'),
  lines("echo <\\", "<'EOF'", 'npm test', 'EOF'),
  // A body that reaches a program through a group, a loop or a continuation hangs on it all the same.
  lines("{ npx bash; } <<'EOF'", 'npm test', 'EOF'),
  lines("( npx bash ) <<'EOF'", 'npm test', 'EOF'),
  lines("if true; then npx bash; fi <<'EOF'", 'npm test', 'EOF'),
  lines('{', '  npx bash', "} <<'EOF'", 'npm test', 'EOF'),
  lines("{ pnpm exec bash; } <<'EOF'", 'npm test', 'EOF'),
  lines("{ npm exec -- bash; } <<'EOF'", 'npm test', 'EOF'),
  lines("while read -r c; do npx bash -c \"$c\"; done <<'EOF'", 'npm test', 'EOF'),
  lines("while read -r c; do npx $c; done <<'EOF'", 'vitest run', 'EOF'),
  lines('npx bash \\', "  <<'EOF'", 'npm test', 'EOF'),
  lines('npx \\', "  bash <<'EOF'", 'npm test', 'EOF'),
  // And so does a test program by name: no body feeds a group, a loop or a test program.
  lines("{ npx vitest run a.test.ts; } <<'EOF'", 'npm test', 'EOF'),
  lines("( npx vitest run a.test.ts ) <<'EOF'", 'npm test', 'EOF'),
  lines("if true; then npx vitest run a.test.ts; fi <<'EOF'", 'npm test', 'EOF'),
  lines("while read -r c; do npx vitest run a.test.ts; done <<'EOF'", 'npm test', 'EOF'),
  lines('npx vitest run a.test.ts \\', "  <<'EOF'", 'npm test', 'EOF'),
  // A body held in a variable reaches a test program through any spelling of the variable.
  lines("read -r X <<'EOF'", 'vitest run', 'EOF', 'npx $X'),
  lines("read -r X <<'EOF'", 'npm test', 'EOF', 'npx bash -c "$X"'),
  lines('printf -v X %s "$(cat <<\'EOF\'', 'vitest run', 'EOF', ')"', 'npx $X'),
  lines('X=" $(cat <<\'EOF\'', 'vitest run', 'EOF', ')"', 'npx $X'),
  lines('X=a"$(cat <<\'EOF\'', 'npm test', 'EOF', ')"', 'npx bash -c "${X#a}"'),
  lines("read -r X <<'EOF'", 'test/*.test.ts', 'EOF', 'npx vitest run $X'),
  lines("read -r X <<'EOF'", 'npm test', 'EOF', 'A=$X npx vitest run a.test.ts'),
  // A body written to a file and run through a test program.
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npx bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npx sh < r.sh'),
  lines("tee r.sh <<'EOF' >/dev/null", 'npm test', 'EOF', 'chmod +x r.sh; npx ./r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npm exec -- bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'bunx bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'pnpm exec bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'pnpx bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'pnpm dlx bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'yarn bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'yarn run bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'bun run r.sh'),
  lines("cat > build.sh <<'EOF'", 'npm test', 'EOF', 'bun run build.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'bun r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', "npx -c 'bash r.sh'"),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'ccrc test -- bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'ccrc other vitest'),
  // An assignment before the command hides nothing: a substitution in it, or a newline in it, leaves the command the
  // next word, whatever is left of the assignment around it.
  lines("X=\"$(true)\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("REV=\"$(git rev-parse HEAD)\" bash -s <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(date)\" sh <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" sudo bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" ssh box bash -s <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" npx bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" npm exec -- bash <<'EOF'", 'npm test', 'EOF'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'X="$(true)" bash r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'chmod +x r.sh; X="$(true)" ./r.sh'),
  lines("cat <<'EOF' | X=\"$(true)\" bash", 'npm test', 'EOF'),
  lines('X="$(true)" eval "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines('X="$(true)" bash -c "$(cat <<\'EOF\'', 'npm test', 'EOF', ')"'),
  lines("if X=\"$(true)\" bash <<'EOF'", 'npm test', 'EOF', 'then :; fi'),
  lines("X='a", "' bash <<'EOF'", 'npm test', 'EOF'),
  lines('X="a', "\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("X='a", "' npx bash <<'EOF'", 'npm test', 'EOF'),
  lines("X='a", "cat' sh <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\"cat bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=$(true)cat bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"a$(true)b\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)$(true)\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true \"a\")\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" Y=\"$(true)\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("env X=\"$(true)\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("nohup env X=\"$(true)\" bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" command bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=$'a", "cat' sh <<'EOF'", 'npm test', 'EOF'),
  // What the check cleared is what is classified, so a heavy command behind such a prefix is not lost with the body.
  lines("X=\"$(true)\" node node_modules/vitest/vitest.mjs run <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"$(true)\" npm test && cat <<'EOF'", 'npm test', 'EOF'),
  lines("X=\"a$(true)\" npm test && cat <<'EOF'", 'npm test', 'EOF'),
  lines("X='a", "cat' npm test && cat <<'EOF'", 'npm test', 'EOF'),
  // A body assigned to a variable can reach a test program through its environment, whatever is around it in the word.
  lines('NODE_OPTIONS="$(cat <<\'EOF\'', 'npm test', 'EOF', ')"', 'export NODE_OPTIONS', 'npx vitest run a.test.ts'),
  lines('export NODE_OPTIONS=" $(cat <<\'EOF\'', 'npm test', 'EOF', ')"', 'npx vitest run a.test.ts'),
  // `$'…'` closes where bash closes it, so what comes after it is seen. The `#` makes the body one that really runs.
  lines("echo $'\\'' ; bash <<\"EOF\"", "#'", 'npm test', 'EOF'),
  lines("echo $'\\'' ; npm test; cat <<'EOF'", 'hi', 'EOF'),
  // A prefix with a path is the file at that path, and `env -S` runs a string.
  lines("cat > time <<'EOF'", 'npm test', 'EOF', 'chmod +x time; ./time cat'),
  lines("cat > env <<'EOF'", 'npm test', 'EOF', 'chmod +x env; X=1 ./env cat'),
  lines("env -S'bash -s' cat <<'EOF'", 'npm test', 'EOF'),
  lines("env -iS'bash -s' cat <<'EOF'", 'npm test', 'EOF'),
  lines("env '--split-string=bash -s' cat <<'EOF'", 'npm test', 'EOF'),
  lines("env --split='bash -s' cat <<'EOF'", 'npm test', 'EOF'),
  // A `>&` target that goes on after its digits is a file, and the next word is the command.
  lines(">&1cat bash <<'EOF'", 'npm test', 'EOF'),
  lines("X=1 >&1cat bash <<'EOF'", 'npm test', 'EOF'),
  lines("{ >&1cat bash; } <<'EOF'", 'npm test', 'EOF'),
  lines('>&1"cat" bash <<\'EOF\'', 'npm test', 'EOF'),
  // A script shell makes any package script a run of the file it names.
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npm run build --script-shell ./r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npm run build --script-shell=./r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npm run build --script-sh=./r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'pnpm build --script-shell=./r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'ccrc test -- npm run build --script-shell=./r.sh'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'npm_config_script_shell=./r.sh npm run build'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'NPM_CONFIG_SCRIPT_SHELL=./r.sh npm run build'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'export npm_config_script_shell=./r.sh; npm run build'),
  lines("cat > r.sh <<'EOF'", 'npm test', 'EOF', 'env npm_config_script_shell=./r.sh npm run build'),
];
describe('a heredoc body that nothing runs is text (D-8052)', () => {
  it.each(BODY_IS_TEXT)('%j reads light and is allowed', (cmd) => {
    expect(classify(cmd)).toBe('light');
    expect(bash(cmd)).toBeNull();
  });
});
describe('a long heredoc body is skipped, not walked (D-8052)', () => {
  // The arm bounds the classifier at 5 seconds and fails open past it, and a walk of this body takes far longer. It stays
  // under 128 KiB, the most Linux passes in one argument.
  it('a 120 KB body reads light well inside the bound', () => {
    const body = Array.from({ length: 2000 }, (_, i) => `- [x] line ${i} with \`npm run typecheck\` and more words here`);
    expect(classify(lines("gh pr create --body-file - <<'EOF'", ...body, 'EOF'))).toBe('light');
  });
});
describe('a heredoc body that can run, or that cannot be read, is still read as commands (D-8052)', () => {
  it.each(BODY_RUNS_OR_UNREAD)('%j reads heavy', (cmd) => {
    expect(classify(cmd)).toBe('heavy');
  });
  it.each([
    lines("systemd-run --user --scope npx vitest run test/foo.test.ts && cat <<'EOF'", 'hello', 'EOF'),
    lines("cat <<'EOF'", 'hello', 'EOF', 'systemd-run --user --scope npx tsc'),
    lines("bash <<'EOF'", 'systemd-run --user --scope npx vitest run', 'EOF'),
    lines('cat <<EOF', '$(systemd-run --user --scope npx vitest run)', 'EOF'),
  ])('%j reads wrapped and is denied on every platform', (cmd) => {
    expect(classify(cmd)).toBe('wrapped');
    expect(bash(cmd)).toMatch(/never under a systemd-run of your own/);
  });
});
// One test per row: every row runs the real hook, so one loop over all of them outgrew the 20 s limit on a loaded runner.
for (const cmd of BODY_RUNS_OR_UNREAD) {
  platformContrast(`a heavy run a heredoc does not hide: ${JSON.stringify(cmd)}`, {
    darwin: ['is allowed: no slice to send it to', () => {
      expect(bash(cmd), cmd).toBeNull();
    }],
    linux: ['is denied, with a reason that names ccrc test', () => {
      expect(bash(cmd), cmd).toMatch(/starts a heavy test or typecheck outside `ccrc test`/);
    }],
  });
}

describe('the test-route arm fails open (D-7298)', () => {
  it('with no ccrc on PATH there is no ccrc test to send a run to, so nothing is denied', () => {
    const r = spawnSync('bash', [HOOK], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'systemd-run --user --scope npx vitest run' }, cwd: CWD }),
      encoding: 'utf8', env: { ...env(), PATH: '/usr/bin:/bin' },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/ccrc test/);
  });
  it('a malformed payload that names systemd-run prints nothing and exits 0', () => {
    expect(run('{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"systemd-run vitest"')).toBe('');
  });
});
