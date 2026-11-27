// Writes guard-cases.jsonl: one hook payload a line, the inputs testdata/gen-guard-golden.sh runs MERGE_STRIP_JQ and
// APPROVAL_FORBIDDEN_JQ over (real jq) and guard_test.go runs attention.MergeStrip and attention.Forbidden over. Four
// sources, in this order:
//   1. every payload the suites ran (guard-suite-payloads.jsonl: recorded by running the deny, merge, quiz, prune, mail
//      hold and keep-awake suites with CCRC_GUARD_CORPUS set, server/test/guardCorpus.ts);
//   2. the suites' fixture corpora: fixtures/account-deny/must-allow.json, fixtures/prune-deny/*.json and
//      fixtures/approvals/guard-corpus.json;
//   3. hand rows per rule family, written from the hook's own residual lists (D-6064, D-6202, review 1493 and the
//      merge deny's): path spellings, quoting, `$VAR`, separators, newlines (a trailing `\n` and `\n\n` in each family),
//      Unicode blanks, case folds and payload shapes;
//   4. a seeded walk over the same families' tokens, so a divergence in a combination shows as a failing case.
// Deterministic: the same files give the same output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = path.resolve(here, '../../../../../server/test/fixtures');
const out = [];
const seen = new Set();
const add = (p) => { const s = JSON.stringify(p); if (!seen.has(s)) { seen.add(s); out.push(s); } };
const bash = (command, extra = {}) => add({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, ...extra });
const tool = (tool_name, tool_input) => add({ hook_event_name: 'PreToolUse', tool_name, tool_input });

// 1. what the suites ran
const rec = path.join(here, 'guard-suite-payloads.jsonl');
if (fs.existsSync(rec)) {
  for (const l of fs.readFileSync(rec, 'utf8').split('\n')) {
    if (l === '') continue;
    try { const v = JSON.parse(JSON.parse(l)); if (v !== null && typeof v === 'object' && !Array.isArray(v)) add(v); } catch { /* not one JSON object: the hook stops before the arms */ }
  }
}
// 2. the fixtures
const j = (f) => JSON.parse(fs.readFileSync(path.join(fix, f), 'utf8'));
for (const r of j('account-deny/must-allow.json')) tool(r.tool, r.input);
for (const f of ['prune-deny/must-allow.json', 'prune-deny/must-deny.json', 'prune-deny/own-pr-body.json']) for (const c of j(f)) bash(c);
for (const r of j('approvals/guard-corpus.json')) tool(r.tool, r.input);

// 3. hand rows
const NL = ['', '\n', '\n\n', '\r\n'];
const BLANK = [' ', '\t', '  ', ' ', ' ', '\u0085', '\u000b', '　', '﻿', ' '];
const SEP = ['; ', ' && ', ' | ', ' || ', '\n', ' & ', ';', '|', '&'];
const fam = {
  merge: ['gh pr merge 5', 'gh pr merge 12 --admin', 'gh pr merge 7 --match-head-commit 0123456789abcdef0123456789abcdef01234567',
    'gh pr merge 3 --squash --admin', 'sudo gh pr merge 1', 'env A=1 gh -R o/r pr merge 9', 'timeout 5 gh pr merge 2',
    'gh api repos/o/r/pulls/5/merge -X PUT', 'gh api graphql -f query=mergePullRequest', 'gh api repos/o/r/merges',
    'ccd pr-admin-merge --repo o/r --pr 3 --head abc', 'echo "gh pr merge 5"', "echo 'gh pr merge 5'", 'git merge main',
    'gh pr view 5 --json state,mergedAt', 'gh api "repos/o/r/pulls/5/merge"', 'gh api repos/o/r/pulls/$N/merge',
    'X=$(gh pr merge 5)', '(gh pr merge 5)', '{ gh pr merge 5; }', 'if true; then gh pr merge 5; fi', '! gh pr merge 5',
    '/usr/bin/gh pr merge 5', 'gh pr  merge 5', 'gh\tpr\tmerge 5', 'gh pr merge', 'gh pr merge;', 'gh pr merge>x', 'gh enqueuePullRequest'],
  quote: [`echo 'a'`, `echo "a"`, `echo "$(gh pr merge 5)"`, `echo "$(echo "gh pr merge 5")"`, `echo $'gh\\tpr'`, `echo "a`,
    `echo 'a`, `echo $'a`, `echo "$(gh pr merge`, `echo "\${x:-gh pr merge}"`, 'echo `gh pr merge 5`', 'echo "`gh pr merge 5`"',
    `echo \\"gh pr merge 5\\"`, `echo a\\`, `echo "a\\"`, `echo $((1+2)) gh pr merge`, `echo ((1+2))`, `echo $[1+2]`, `echo $$`,
    `echo "$$ $'x' \${a} $(b)"`, `echo # gh pr merge 5`, `echo a#b gh pr merge 5`, `x=1 #c`, `echo "$((1+(2)))"`, `echo "$(( (1)+2 ))"`,
    `echo "\${a"`, `echo "\${a$(b)}"`, `echo "\${a\`x\`}"`, `echo "\${a\`x}"`, `echo "$("`, `echo "$(a"b")"`, `echo "$(a 'b)' c)"`,
    `echo "$(a # c )" gh pr merge 5`, `echo "$(cat <<EOF\ngh pr merge 5\nEOF\n)"`, `echo "$(cat <<'EOF'\nx)\nEOF\n)"`, `echo "$(a <<< b)"`,
    `echo "$(a << b`, `echo "$(a (b) c)"`, `echo "$(a ((b)) c)"`, `echo "$(a ((b c)"`, `echo "\\$(gh pr merge)"`, `echo "$\\(x)"`],
  heredoc: [`cat <<EOF\ngh pr merge 5\nEOF`, `cat <<-EOF\n\tgh pr merge 5\n\tEOF`, `cat <<'EOF'\n$(gh pr merge 5)\nEOF`,
    `cat <<"EOF"\nx\nEOF\ngh pr merge 5`, `cat <<\\EOF\nx\nEOF`, `cat <<EOF\nx`, `cat <<EOF`, `cat << EOF\n$(gh pr merge 5)\nEOF`,
    `cat <<EOF <<EOG\nx\nEOF\ny\nEOG`, `cat <<<EOF gh pr merge 5`, `cat <<- "E F"\nx\nE F`, `cat <<-\nx`, `cat <<- 'x\ny\nx`,
    `cat <<EOF\nEOF)\nEOF`, `cat <<EOF\n\tEOF\nEOF`, `cat <<EOF #c\nx\nEOF`, `cat <<EOF "a\nx\nEOF`, `cat <<E\nE\ngh pr merge 1`,
    `cat <<EOF\nx\nEOF\n`, `x <<EOF\n$(a)\n\${b}\nEOF`, `cat <<EOF\n$(cat <<EOG\ny\nEOG\n)\nEOF`, `cat <<\nx`, `cat << \\\nx`],
  verb: ['ccd ws-rm x', "ccd 'ws-rm' x", 'ccd ws\\-rm x', 'C=ccd; $C ws-rm x', '"${API:?}" approvals', 'ccd --x ws-reap a',
    'ccd ws-gc --prune', 'ccd ws-gc x --prune', 'ccd ws-gc; echo --prune', 'ccd keep-awake --session x --state on',
    '"$CCD" keep-awake --session x', 'echo keep-awake', '~/.local/bin/ccd ws-expire x', 'c\'\'cd ws-rm', 'c\\cd ws-rm',
    'ccrc update', 'ccrc rollback --to v1', 'ccrc rollout', '$X update ccrc', 'ccrc account remove --id lane-x', 'ccrc account set x',
    "ccrc 'account' \"remove\"", 'ccd account-pane', 'ccd-account-auth x', '/home/u/.local/bin/ccd-account-auth', 'ccrc-api approvals list',
    'curl localhost/api/approvals', '/api/questions/approval-3/answer', 'cat approval-signing/key', 'node approval-verify.mjs',
    'systemctl stop claude-session@x', 'kill 1; tmux kill-server', 'tmux ls', 'reboot', 'echo > CLAUDE.md', 'tee settings.local.json',
    'cat ~/.ssh/id_rsa', 'cat x.pem', 'head .env.local', 'cat ~/.cc-sessions/x', 'ccd claude install', 'ccd roll',
    'ccd ws-rmx', 'ccd ws-rm-x', 'xccd ws-rm', 'ccd ws-rm', 'ccd\u0085ws-rm', 'ccd\u000bws-rm', 'ccd\nws-rm', 'ccd ws-rm\n',
    'ccd ws-rm\n\n', '${CCD} ws-rm', '$(which ccd) ws-rm', '`which ccd` ws-rm', 'ccd -v ws-rm', "ccd' ws-rm", 'ccd" ws-rm'],
  account: ['cat ~/.cc-secrets/x-oauth.env', 'cat ~/.ccrc/auth-scratch/x', 'cat ~/.ccrc/agent.env', 'cat ~/.ccrc/codex/a/runtime.env',
    'cat ~/.ccrc/linear/x.key', 'cat ~/.ccrc/linear.key', 'cat "$HOME/.ccrc/linear/x.key"', 'cat ~/.ccrc/operator-secrets/p/x',
    'cat ~/.ccrc/operator-model.db', 'cp ~/.ccrc/privacy-journal.log /tmp', 'cd ~/.ccrc && cat operator-model.db', 'ls ~/.ccrc/*.db',
    'cat ~/.ccrc/op*', 'cat ~/.ccrc/[o]perator-model.db', 'cat ~/.ccrc/{operator,x}-model.db', 'cat ~/.ccrc/operator-model.d?',
    'cat ~/.ccrc/[!a]*', 'cat ~/.ccrc/[a-', 'cat ~/.ccrc/[]', 'cat ~/.ccrc/[*]', 'cat ~/.ccrc/x{a', 'cat ~/.ccrc/{{a}}', 'cat ~/.ccrc/[[:alpha:]]*',
    'cat ~/.ccrc/[z-a]*', 'cat ~/.ccrc/p*.l?g', 'cat ~/.ccrc/*.torn', 'rm ~/.ccrc/*', 'tar c ~/.ccrc', 'cp -r ~/.ccrc /tmp/x',
    'cp -t /tmp ~/.ccrc', 'grep -r x ~/.ccrc/', 'rsync ~/.ccrc x', 'echo > ~/.cc-sessions/.auth/x', 'mv a ~/.cc-sessions/.accounts/b',
    'echo x > ~/.ccrc/accounts.json', 'sed -i s/a/b/ ~/.ccrc/accounts.sh', 'cat ~/.ccrc/accounts.json', 'node deploy/account-op.mjs',
    'account-op.mjs set', 'cat account-op.mjs', 'env', 'printenv', 'env -0', 'printenv --null', 'env FOO=1 ccd swap-self lane-b',
    'printenv TMUX', 'echo $(env)', 'echo `printenv`', 'bash -c env', 'sh -c printenv', 'X=1 env', '(env)', 'exec env', '/usr/bin/env',
    'env | grep X', 'ccd swap-self lane-b', 'ccd prefer x', 'ccd swap x', 'ccrc account roster', 'ls ~/.cc-sessions/.door',
    'cat ~/ccrc-backups/x/operator-model.db', 'cat ~/.ccrc/coordination-restore.stage/x/operator-model.db'],
  quiz: ['ccrc-api quiz record', 'ccrc-api quiz confirm x', 'ccrc-api quiz status', 'ccrc-api quiz live', '$API quiz record',
    'ccrc-api quiz $ACT', 'ccrc quiz-record', 'ccrc-quiz-record', '~/.local/bin/ccrc-quiz-record x', 'bash ccrc-quiz-record',
    'env -u X ccrc-quiz-record', 'cat ~/.local/bin/ccrc-quiz-record', 'git add bin/ccrc-quiz-record', '$C quiz-record ccrc',
    'echo quiz record', 'ccrc-api "quiz" record', 'ccrc-api quiz\nrecord'],
  prune: ['git worktree prune', 'git worktree prune -n', 'git worktree prune --dry-run', 'git worktree prune --no-d',
    'git -C a worktree prune', "git -C 'a b' worktree prune", 'git --git-dir=$(x) worktree prune', 'sudo git worktree prune',
    'echo "git worktree prune"', 'echo "`git worktree prune`"', 'cat <<EOF\ngit worktree prune\nEOF', 'cat <<EOF\n$(git worktree prune)\nEOF',
    "bash -c 'git worktree prune'", 'git worktree prune # x', 'git worktree prune $X', 'git worktree prune -n $X', 'g\'i\'t worktree prune',
    'git work"tree" pr\'une\'', 'echo prune worktree', 'git worktree list; git worktree prune', 'git worktree prune\r\n',
    'git worktree   prune\n', 'cd x && git worktree prune -v', 'X="a b" git worktree prune', "echo 'a\nb' && git worktree prune",
    'git worktree prune --expire=now -n', 'git worktree prune -nv', "sh -c \"git worktree prune\"; echo '", 'nice -n 5 git worktree prune',
    'bash -o x -c "git worktree prune"', 'git -c a=b worktree prune', 'git --no-pager worktree prune -n --dry-run'],
  build: ['cp x ~/.local/share/claude/versions/2.1.0', 'rm -rf ~/.local/share/claude/versions', 'ln -s x ~/.local/bin/claude',
    'mv a $HOME/.local/bin/claude', 'mv a ${HOME}/.local//bin/./claude', 'cp a .local/share/claude/versions/x', 'touch ~/.local/share/claude/v*',
    'cd ~/.local/share/claude && rm -rf versions', 'cd ~/.local && rm bin/claude', 'cd && rm .local/bin/claude', 'cd ~/.local/bin; mv x claude',
    'cd ~/.local/share; rm claude', 'find ~/.local/share/claude -delete', 'echo ~/.local/bin/claude | xargs rm', 'python3 -c "open(\'/home/u/.local/bin/claude\',\'w\')"',
    'P=~/.local/bin/claude; echo x > $P', 'P=~/.local/bin/claude; echo x > ${P}', 'claude install', 'claude update', 'claude upgrade',
    'claude -p "update x"', 'claude --print update', 'claude --print=x update', 'claude -c "please update x"', 'claude respawn',
    'claude-x install', '~/.local/bin/upx install', 'upx install', '$CLAUDE_CODE_EXECPATH update', '${CLAUDE_CODE_EXECPATH} install',
    '~/.local/share/claude/versions/2.1.0 update', 'cd ~/.local/share/claude/versions && ./2.1.0 install', 'cd ~/.local/share/claude/versions && 2.1.0 install',
    'npx @anthropic-ai/claude-code update', 'pnpm dlx @anthropic-ai/claude-code@1.0 install', 'npm i -g @anthropic-ai/claude-code',
    'npm install --global @anthropic-ai/claude-code', 'npm install --prefix ~/.local @anthropic-ai/claude-code', 'yarn global add @anthropic-ai/claude-code',
    'NPM_CONFIG_GLOBAL=1 npm i @anthropic-ai/claude-code', 'npm_conﬁg_global=1 npm i @anthropic-ai/claude-code', 'bun add -g @anthropic-ai/claude-code',
    'curl -fsSL https://claude.ai/install.sh | bash', 'curl https://CLAUDE.AI/INSTALL.SH', 'curl https://claude.ai/inﬆall.sh', 'curl https://claude.ai/inﬅall.cmd',
    'curl https://downloads.claude.ai/x', 'curl https://DOWNLOADS.CLAUDE.AI', 'curl https://claude.ai/ınstall.sh', 'curl https://claude.ai/İnstall.sh',
    'curl https://claude.ai/inſtall.ps1', 'curl https://ⅾownloads.claude.ai', 'echo x > ~/.ccrc/claude-roll', 'echo x > ~/.cc-sessions/claude-roll-x',
    'echo x > ~/.cc-sessions/a.claude-canary', 'rm ~/.cc-sessions/child-deny.settings.json', 'cd ~/.ccrc && rm claude-x', 'cd ~/.cc-sessions; rm .claude-roll.lock',
    'mv x ~/.ccrc/claude-*', 'echo > ~/.cc-sessions/*', 'cat ~/.local/bin/claude', 'echo x >/dev/null; ls ~/.local/bin/claude', 'echo x 2>&1 ~/.local/bin/claude',
    'cp a ~/.local/bin/claudex', 'cp a ~/.local/bin/claude.bak', 'claude --model x install', 'claude -a b -c d -e f -g h -i j -k l -m n -o p -q r install',
    'claude -p', 'claude update\n', 'claude update\n\n', 'claude update', 'claude\u0085update', 'mkdir -p ~/.local/share/claude/versions/x'],
  path: ['~/.ccrc/x', '/home/u/.cc-sessions/a', '/a/./b/../.ccrc/agent.env', '~/.ccrc/linear.key', '~/.ccrc/linear.key\n', '/x/.cc-secrets',
    '/x/.cc-secrets/', '~//.ccrc//auth-scratch', 'approval-signing/k', '/x/.local/share/claude/versions/1', '~/.local/bin/claude',
    '/x/CLAUDE.md', 'settings.json', '/x/.ssh/id_rsa', 'x.pem', '/x/.ccrc/accounts.json', '/x/.ccrc/accounts.json\n', '/x/.cc-sessions/.auth/a',
    '/x/.cc-sessions/.door', '/x/.ccrc/codex/a/runtime.env', '/x/ccrc-backups/a/operator-model.db-wal', '~/.cc-sessions/child-deny.settings.json',
    '/x/../../.ccrc/operator-secrets/a', '~x/.ccrc/agent.env', 'relative/.ccrc/agent.env', '/x/.ccrc/privacy-journal.torn/a'],
};
for (const [name, rows] of Object.entries(fam)) {
  for (const r of rows) {
    if (name === 'path') {
      for (const t of ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Grep', 'Glob', 'Bash']) {
        tool(t, t === 'Bash' ? { command: `cat ${r}` } : t === 'NotebookEdit' ? { notebook_path: r } : t === 'Glob' ? { pattern: r } : t === 'Grep' ? { path: r } : { file_path: r });
      }
      continue;
    }
    for (const nl of NL) bash(r + nl);
  }
}
// payload shapes: a command or tool_input of another type, a tool name of another type, MCP calls
for (const c of [null, 1, true, false, [], ['ccd ws-rm'], { a: 'ccd ws-rm' }, '']) add({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: c } });
for (const ti of [null, 'ccd ws-rm', 1, [], ['x']]) add({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: ti });
for (const tn of [null, 1, 'bash', 'mcp__x__y', ['Bash']]) add({ hook_event_name: 'PreToolUse', tool_name: tn, tool_input: { command: 'ccd ws-rm x', file_path: '/x/.ccrc/agent.env' } });
add({ hook_event_name: 'PreToolUse', tool_name: 'mcp__s__t', tool_input: { a: { b: ['x', 'ccd ws-rm y'] } } });
add({ hook_event_name: 'PreToolUse', tool_name: 'mcp__s__t', tool_input: { a: 'git worktree prune' } });
add({ hook_event_name: 'PreToolUse', tool_name: 'mcp__s__t', tool_input: { a: 'tmux ls' } });
add({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 1, path: '/x/.ccrc/agent.env' } });
add({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: null, notebook_path: '/x/approval-signing/k' } });
add({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'gh pr merge 5' } }); // no other keys
add({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 5 --admin' } });

// 3b. the review's families (task 5 review F1, F2, F3, F5), each beside its real-merge mirror: a quoted heredoc then an
// unquoted one in the same `$(…)` (Oniguruma's sticky `qs`/`qst` captures), nests deep enough to meet Oniguruma's
// call-nesting limit, many-star globs under ~/.ccrc, and a non-ASCII blank in a merge.
const REVIEW = [
  "echo \"$(cat <<'A'\nx\nA\ncat <<B\ny\nB\n)\ngh pr merge 5\"",
  "x=$(cat <<C\n$(cat <<'A'\nx\nA\ncat <<B\ny\nB\n)\"; gh pr merge 5 --admin\nC\n)",
  "echo \"$(cat <<'A'\nx\nA\ncat <<B\ny\nB\n)\ngh api repos/o/r/pulls/5/merge\"",
  "echo \"$(cat <<'A'\nx\nA\ncat <<B\ny\nB\ngh pr merge 5\n)\"",
  "echo \"$(echo \"$(echo \"$(echo \"$(echo \"$(echo \"$(echo \"$(x)\")\")\")\")\")\")\ngh pr merge 5\"",
  "\"${''\"$((\"${${''$(((\"$((\"$((", "\"\\&$(\"$((\"${\"$(\"$(((\"$((",
  'cat ~/.ccrc/***********Q; printenv', 'cat ~/.ccrc/***********Q; cp x ~/.local/bin/claude', 'gh pr merge\u20035',
];
for (const r of REVIEW) bash(r);
const H1 = ["<<'A'", '<<"A"', '<<A', '<<\\A', "<<-'A'", '<<-A', '<<-"A"', "<< 'A'"];
const H2 = ['<<B', '<<\\B', "<<'B'", '<<-B', "<<-'B'", '<<"B"', '<< B'];
const TAIL = ['gh pr merge 5', 'gh pr merge 5 --admin', 'gh api repos/o/r/pulls/5/merge'];
const hbody = (op, w) => `cat ${op}\n${w === 'A' ? 'x' : 'y'}\n${op.includes('-') ? '\t' : ''}${w}\n`;
for (const a of H1) for (const b of H2) for (const t of TAIL) {
  const inner = hbody(a, 'A') + hbody(b, 'B');
  bash(`echo "$(${inner})\n${t}"`);
  bash(`echo "$(${inner}${t}\n)"`);
  bash(`x="\${y:-$(${inner})}"\n${t}`);
  bash(`cat <<C\n$(${inner})\n${t}\nC`);
  bash(`echo "$(${inner})" "$(${hbody(b, 'B')})"\n${t}`);
  bash(`echo "\${y:-$(${hbody(a, 'A')})}$(${hbody(b, 'B')})"\n${t}`);
  bash(`echo "$(${hbody(a, 'A')}x"\n$(${hbody(b, 'B')})"\n${t}`);
}
const NEST = [['echo "$(', ')"', 'x'], ['${a:-', '}', 'x'], ['$(', ')', 'x'], ['(', ')', 'x'], ['( ', ' )', 'x'], ['$(echo "', '")', 'x'],
  ['"$(', ')"', 'x'], ['${a:-$(', ')}', 'x'], ['$(cat <<A\n', '\nA\n)', 'x'], ['`', '`', 'x']];
for (const [o, c, mid] of NEST) {
  for (let n = 1; n <= 26; n++) {
    for (const t of ['gh pr merge 5', 'gh pr merge 5 --admin']) {
      bash(`echo "${o.repeat(n)}${mid}${c.repeat(n)}\n${t}"`);
      bash(`echo "${o.repeat(n)}${t}${c.repeat(n)}"`);
      bash(`echo "${o.repeat(n)}${mid}\n${t}"`);
      bash(`${o.repeat(n)}${mid}${c.repeat(n)}\n${t}`);
    }
  }
}
for (let n = 1; n <= 70; n += n < 16 ? 1 : 6) for (const tail of ['Q', 'operator-model.db', 'privacy-journal.torn']) {
  bash(`cat ~/.ccrc/${'*'.repeat(n)}${tail}; printenv`);
  bash(`cat ~/.ccrc/${'*a'.repeat(Math.ceil(n / 2))}${tail}`);
}

// review round 1, F9: many stars before an alternation, where Oniguruma's retry limit is the pattern's answer
for (let n = 2; n <= 16; n++) for (const t of ['{a,b}Q', '{a,b,c}', 'b', '{a,b}Q; printenv']) bash(`cat ~/.ccrc/${'*'.repeat(n)}${t}`);

// review round 2, F9: the reviewer's rows, a store-name letter beside a long run, a split run before an alternation or a class
for (const c of ['**********o?Q', '*o**********Q', '**********o?Q; ls', 'o**********Q', 'p**********x', '**?*******{a,b}Q', '***?******{x,y}', '**??*******{a,b}Q', '****o*******[0-9]', '*****r******[0-9]']) bash(`cat ~/.ccrc/${c}`);

// 4. the seeded walk
let seed = 0x2545f491;
const rnd = (n) => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed % n; };
const pick = (a) => a[rnd(a.length)];
const TOK = ['ccd', 'ccrc', 'gh', 'pr', 'merge', 'api', 'ws-rm', 'ws-gc', '--prune', 'account', 'remove', 'quiz', 'record', 'git', 'worktree',
  'prune', '-n', 'claude', 'install', 'update', '-p', '--print', 'cd', '~/.local', '~/.local/share/claude/versions', '.local/bin/claude',
  '~/.ccrc', '~/.cc-sessions', '.ccrc/claude-x', 'rm', 'cp', 'mv', '>', '>>', '&>', '>&2', '2>&1', '>/dev/null', '> /dev/null', 'tee', 'find', '-delete',
  'xargs', 'node', 'python3', 'env', 'printenv', '$X', '${X}', '$(x)', '`x`', 'X=1', 'P=~/.local/bin/claude', '$P', 'sudo', 'bash -c', 'sh', '-c',
  "'", '"', '\\', '$\'', '$"', '#', '<<', '<<-', 'EOF', '$((', '))', '((', '$[', ']', '(', ')', '{', '}', '*', '?', '[a]', '{a,b}', 'tmux',
  'approvals', 'ccrc-api', '/api/approvals', 'mergePullRequest', 'repos/o/r/pulls/1/merge', '--admin', 'cat', 'operator-model.db', 'account-op.mjs'];
const JOIN = [' ', ' ', ' ', '', ...SEP, ...BLANK];
for (let i = 0; i < 4000; i++) {
  let c = '';
  const n = 1 + rnd(9);
  for (let k = 0; k < n; k++) c += (k ? pick(JOIN) : '') + pick(TOK);
  bash(c);
}
// the walk's heredoc and quote shapes, line by line
const LINES = ['cat <<EOF', 'cat <<-EOF', "cat <<'EOF'", 'EOF', '\tEOF', 'EOF)', 'git worktree prune', 'gh pr merge 1', '$(gh pr merge 2)',
  'echo "a', 'b"', "echo 'a", "b'", 'x \\', 'ccd ws-rm', 'echo "$(git worktree prune)"', 'bash <<EOF', '(', ')'];
for (let i = 0; i < 1500; i++) {
  const n = 1 + rnd(6);
  const ls = [];
  for (let k = 0; k < n; k++) ls.push(pick(LINES));
  bash(ls.join('\n'));
}
process.stdout.write(out.map((l) => `${l}\n`).join(''));
