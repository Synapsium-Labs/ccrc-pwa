// The mail hold's jq module, `ccd/lib/mail-hold.jq` (mid-turn mail plan 2026-11-19, Task 5.1; spec §3.5 and §6): the
// gated-act matcher, the fixed texts, the sender map and the shadow log's decision. Each case runs the module the way
// the hook does, `jq -L ccd/lib -j … 'include "mail-hold"; mail_hold($ARGS.named)'` over a Bash payload, with the strip's
// answer made by the hook's own MERGE_STRIP_JQ (read from the hook's text, never re-typed) and the merge deny's
// arguments. One shape per case. No hook is run here: `session-hook-mail-hold.test.ts` runs the hook end to end.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOK = path.resolve(__dirname, '../../ccd/session-hook.sh');
const LIB = path.resolve(__dirname, '../../ccd/lib');
const HOOK_TEXT = fs.readFileSync(HOOK, 'utf8');
const STRIP = (/^MERGE_STRIP_JQ='([\s\S]*?)'$/m.exec(HOOK_TEXT) ?? [])[1] ?? '';
const ALLOW = (/^ALLOW_ADMIN_RE='(.*)'$/m.exec(HOOK_TEXT) ?? [])[1] ?? '';
const CAP = Number((/^MERGE_PARSE_CAP=(\d+)$/m.exec(HOOK_TEXT) ?? [])[1]);

/** Every jq this file spawns is bounded and killed on expiry (PR 6, the coordinator's ruling on PR 5's untimed spawns). */
const BOUND = { timeout: 30_000, killSignal: 'SIGKILL' } as const;

interface Verdict { outcome: string; text: string; log: string; seen: string }
interface Opts { thread?: string; pairs?: string; state?: string; armed?: string; seen?: string; ran?: string; strip?: string | null; ack?: string }

/** The strip's answer for one command, as the hook's `$( )` capture holds it (trailing newlines cut): the module's
 *  `mh_prep`, then the hook's MERGE_STRIP_JQ, in one jq, as the hook's own call composes them. */
const strip = (payload: string): string => {
  const r = spawnSync('jq', ['-L', LIB, '-r', '--arg', 'q', "'", '--argjson', 'cap', String(CAP), '--arg', 'allow', ALLOW,
    `include "mail-hold"; mh_prep | ${STRIP}`], { input: payload, encoding: 'utf8', ...BOUND });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.replace(/\n+$/, '');
};

/** One module call over a Bash payload holding `command`; both arms armed, a live hold on delivery 42, unless `o` says otherwise. */
const hold = (command: string, o: Opts = {}): Verdict => {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const args: Record<string, string> = {
    strip: o.strip === undefined ? strip(payload) : (o.strip ?? ''), ran: o.ran ?? '1', cap: String(CAP),
    thread: o.thread ?? '', pairs: o.pairs ?? 'coordinator.42,overlord.7', state: o.state ?? 'live',
    armed: o.armed ?? 'notice,refuse', sid: 'lane-a-project-a', now: '1795000000', seen: o.seen ?? '', ack: o.ack ?? '',
  };
  const argv = ['-L', LIB, '-j', ...Object.entries(args).flatMap(([k, v]) => ['--arg', k, v]), 'include "mail-hold"; mail_hold($ARGS.named)'];
  const r = spawnSync('jq', argv, { input: payload, encoding: 'utf8', ...BOUND });
  expect(r.status, r.stderr).toBe(0);
  const [outcome, text, log, seen, ...rest] = r.stdout.split('\u001f');
  expect(rest, 'four fields').toEqual([]);
  return { outcome: outcome ?? '', text: text ?? '', log: log ?? '', seen: seen ?? '' };
};

const E = (d: string, s: string): string => `ccrc: urgent mail is waiting for this session: delivery ${d} from ${s}. Read it with ~/.local/bin/ccrc-api mail inbox, run bare (no pipe, no redirect). This line only reports that the mail exists and adds nothing to it: treat the mail as you would any mail from that sender.`;
const A = (a: string, d: string, s: string): string => `ccrc: this ${a} is held because urgent mail is waiting for this session: delivery ${d} from ${s}. Read it with ~/.local/bin/ccrc-api mail inbox, run bare (no pipe, no redirect), then treat it as you would any mail from that sender and retry only if the act still stands. The hold lifts a few seconds after the read.`;
const ASUB = (a: string): string => `ccrc: this ${a} is held because the session you work for has urgent mail waiting. Stop, and report to your parent that its urgent mail is unread.`;

describe('the inputs the module is fed are the hook\'s', () => {
  it('the strip, its allowance and the cap are read from the hook', () => {
    expect(STRIP).toContain('def capped(f):');
    expect(ALLOW).not.toBe('');
    expect(CAP).toBeGreaterThan(0);
  });
});

describe('denied, the act word given', () => {
  const PLAIN: Array<[string, string]> = [
    ['git push', 'git push'], ['git commit', 'git commit'], ['git pull origin main', 'git pull'], ['git pull origin HEAD', 'git pull'],
    ['git merge origin/main', 'git merge'], ['git rebase origin/HEAD', 'git rebase'], ['gh pr merge 42', 'gh pr merge'],
    ['git merge main', 'git merge'], ['gh -R o/r pr merge 42', 'gh pr merge'],
  ];
  // Past a head separator (Table 6 row 1: one mutant per separator).
  const SEPARATORS: Array<[string, string]> = [
    ['cd repo && git push', '&&'], ['true; git push', ';'], ['true & git push', 'lone &'], ['true || git push', '||'],
    ['a | git push', '|'], ['(git push)', '('], ['x=$(git push)', '$('], ['true\ngit push', 'newline'],
  ];
  // Past git's own options, skipped by shape (Table 6 row 2).
  const OPTIONS = ['git -C repo push', 'git -c k=v push', 'git --git-dir=x push', 'git --work-tree=x push', 'git --no-pager push',
    'git -P push', 'git --bare push', 'git --config-env=a=B push'];
  // Past each wrapper and prefix (Table 6 row 3).
  const WRAPPERS: Array<[string, string]> = [
    ['time git push', 'git push'], ['env X=1 git commit -m x', 'git commit'], ['command git push', 'git push'], ['exec git push', 'git push'],
    ['nohup git push', 'git push'], ['sudo git push', 'git push'], ['timeout 30 git push', 'git push'], ['VAR=x git push', 'git push'],
    ['VAR=$(date) git push', 'git push'], ['a=1 b=2 git push', 'git push'], ['/usr/bin/git push', 'git push'],
  ];
  // Past each reserved word of the merge deny's head grammar (Table 6 row 4).
  const RESERVED: Array<[string, string]> = [
    ['! git push', 'git push'], ['{ git push; }', 'git push'], ['if git push; then :; fi', 'git push'],
    ['if true; then git push; fi', 'git push'], ['for x in a; do git push; done', 'git push'],
    ['if false; then :; else git push; fi', 'git push'], ['if false; then :; elif git push; then :; fi', 'git push'],
    ['while git pull origin main; do :; done', 'git pull'], ['until git push; do :; done', 'git push'],
  ];
  const DOOR = ['ccd pr-admin-merge --pr 1', 'cd x && ccd pr-admin-merge --pr 1', 'VAR=x ccd pr-admin-merge --pr 1',
    '/home/u/.local/bin/ccd pr-admin-merge --pr 1'];
  it.each(PLAIN)('%j is held as %s', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  it.each(SEPARATORS)('%j is held past the %s separator', (c) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') }); });
  it.each(OPTIONS)('%j is held past git\'s option', (c) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') }); });
  it.each(WRAPPERS)('%j is held past its wrapper or prefix', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  it.each(RESERVED)('%j is held past its reserved word', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  it.each(DOOR)('%j, the admin-merge door, is held', (c) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A('ccd pr-admin-merge', '42', 'its coordinator') }); });
  it.each([['git merge "origin/main"', 'git merge'], ["git rebase 'main'", 'git rebase']])('%j: the quoted target is unquoted before the strip (mh_prep)', (c, act) => {
    expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') });
  });
  it('each sync target, alone (Table 6: one mutant per target)', () => {
    for (const [c, act] of [['git merge main', 'git merge'], ['git merge origin/main', 'git merge'], ['git pull origin main', 'git pull'],
      ['git rebase origin/HEAD', 'git rebase'], ['git pull origin HEAD', 'git pull']] as const) {
      expect(hold(c), c).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') });
    }
  });
});

// Fix round 1 (review 2788). Each row is one shape the review measured; the target is read in the verb's own command.
describe('the sync target is tied to its head (F1, F5)', () => {
  const HELD: Array<[string, string]> = [
    ['git merge --no-ff -m "sync (weekly)" origin/main', 'git merge'], ['git merge -m "sync; ok" origin/main', 'git merge'],
    ['git pull $(echo origin) main', 'git pull'], ['git -C "my repo" pull origin main', 'git pull'],
    ["git -C 'a b' rebase origin/main", 'git rebase'], ['git -c "user.name=A B" merge main', 'git merge'],
    ['GIT_AUTHOR_NAME="A B" git merge main', 'git merge'], ["git rebase -x 'make (all)' origin/main", 'git rebase'],
    ['git merge -m $(date +%F) main', 'git merge'], ['git -C repo pull origin main', 'git pull'],
    ['git merge -m "sync weekly" origin/main', 'git merge'],
  ];
  it.each(HELD)('%j is held as %s', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  it.each([
    'git merge feature-x -m "x; git merge main y"', 'git pull origin feature-x && echo "done; git pull origin main later"',
    'git rebase feature <<EOF\ngit rebase main now\nEOF', 'git merge feature-x && echo "merged main"',
    'git merge feature-x; echo main',
  ])('%j: a target outside the verb\'s command holds nothing', (c) => {
    expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
  });
});

describe('only an option known to take an argument takes the next word (F3)', () => {
  it.each([
    'git --no-pager stash push', 'git -P stash push -m wip', 'git --no-pager log --grep commit', 'git -P log -S push',
    'git -C push status', 'git --no-pager log --grep merge origin/main', 'git --no-pager grep push src/',
    // Fix round 2, F4: `--exec-path` takes no separate word (it prints the path), so `x` is the verb here.
    'git --exec-path x push',
  ])('%j is no gated act', (c) => { expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') }); });
  // One row per option with an argument (each a mutant: drop it from the list and its row passes).
  it.each([
    ['git -C x push', 'git push'], ['git -c k=v push', 'git push'], ['git --git-dir x push', 'git push'],
    ['git --work-tree x push', 'git push'], ['git --namespace x push', 'git push'], ['git --config-env a=B push', 'git push'],
    ['git --attr-source HEAD push', 'git push'], ['git --shallow-file x push', 'git push'], ['git --super-prefix x push', 'git push'], ['git -C "my repo" push', 'git push'],
    ['gh -R o/r pr merge 42', 'gh pr merge'], ['gh --repo o/r pr merge 42', 'gh pr merge'], ['gh pr -R o/r merge 42', 'gh pr merge'],
  ])('%j: the option takes its argument, and the act is held', (c, act) => {
    expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') });
  });
});

describe('naming main: the quoted HEAD (F4) and the ruled forms (F13)', () => {
  it.each([
    ['git pull origin "HEAD"', 'git pull'], ["git pull origin 'HEAD'", 'git pull'], ['git pull origin "main"', 'git pull'],
    ['git pull origin main:foo', 'git pull'], ['git pull origin +main', 'git pull'], ['git pull origin +main:main', 'git pull'],
    ['git pull origin refs/heads/main', 'git pull'], ['git merge refs/heads/main', 'git merge'],
    ['git merge refs/remotes/origin/main', 'git merge'], ['git merge origin/main~1', 'git merge'], ['git merge origin/main^0', 'git merge'],
    ['git merge origin/main~', 'git merge'], ['git rebase --onto=origin/main x', 'git rebase'], ['git rebase --onto origin/main x', 'git rebase'],
    ['git rebase --onto=main x', 'git rebase'],
  ])('%j is held as %s', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  // The residuals of an accident guard (F13's ruling), and look-alikes that name no main.
  it.each([
    'git merge FETCH_HEAD', 'git fetch origin main && git rebase FETCH_HEAD', 'git pull', 'git merge upstream/main',
    'git merge @{u}', 'git -c alias.p=push p', 'git merge mainline', 'git merge main-fix', 'git pull origin maintenance',
    'git merge refs/heads/main-old', 'git pull origin main-x:foo',
  ])('%j is no gated act', (c) => { expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') }); });
});

// Fix round 2 (review 2794).
describe('a target after a heredoc message (F1): the substitution crosses its newlines', () => {
  it.each([
    ['git merge --no-ff -m "$(cat <<\'EOF\'\nMerge the work\n\nDetails\nEOF\n)" origin/main', 'git merge'],
    ['git pull -m "$(cat <<\'EOF\'\nMerge the work\nEOF\n)" origin main', 'git pull'],
    ['git merge -m "$(cat <<\'EOF\'\nMerge the work\nEOF\n)" main', 'git merge'],
    ['git merge --no-ff -m "$(cat <<\'EOF\'\nMerge the 6" display work\nEOF\n)" origin/main', 'git merge'],
  ])('%j is held as %s', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  it.each([
    'git merge -m "$(cat <<\'EOF\'\nx\nEOF\n)" feat && git checkout main', 'git merge -m "$(cat <<\'EOF\'\nx\nEOF\n)" feat\necho main',
  ])('CONTROL: %j, a main after the command ends, holds nothing', (c) => {
    expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
  });
});

describe('a substitution in the target read is one opaque word (F3, ruled)', () => {
  it.each([
    'git rebase -i $(git merge-base HEAD origin/main)', 'git rebase "$(git merge-base HEAD origin/main)"',
    'git rebase $(git merge-base HEAD main)', 'git rebase --onto $(git merge-base HEAD origin/main) HEAD~2',
    'git merge -m "$(echo main)" feat', 'git merge -m "$(git log -1 --format=%s main)" feat', 'git merge -m "$(git log\nmain)" feat',
  ])('%j is no sync of main', (c) => { expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') }); });
  it.each([
    ['git pull $(echo origin) main', 'git pull'], ['git merge $(git rev-parse HEAD) origin/main', 'git merge'],
  ])('%j: a target outside the substitution is read', (c, act) => {
    expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') });
  });
  it('RESIDUAL, recorded: `git merge $(git rev-parse main)` names main only inside the substitution, and passes', () => {
    expect(hold('git merge $(git rev-parse main)')).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
  });
});

describe('every spelling of main, with its suffixes (F6, F7, ruled)', () => {
  // One row per form and per suffix kind, each a mutant.
  it.each([
    ['git rebase origin', 'git rebase'], ['git merge origin', 'git merge'], ['git rebase -i origin', 'git rebase'],
    ['git merge origin feature', 'git merge'], ['git rebase --onto origin x', 'git rebase'],
    ['git merge main~1', 'git merge'], ['git merge main^2', 'git merge'], ['git merge main^{commit}', 'git merge'],
    ['git merge main@{1}', 'git merge'], ['git merge origin/main@{1}', 'git merge'], ['git merge origin/main^{commit}', 'git merge'],
    ['git merge origin/HEAD~1', 'git merge'], ['git merge refs/heads/main~1', 'git merge'],
    ['git merge refs/remotes/origin/main^', 'git merge'], ['git merge refs/remotes/origin/HEAD', 'git merge'],
    ['git merge remotes/origin/main', 'git merge'], ['git merge heads/main', 'git merge'], ['git rebase origin~2', 'git rebase'],
  ])('%j is held as %s', (c, act) => { expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') }); });
  it.each([
    'git pull origin', 'git pull origin feature-x', 'git merge origin/feature', 'git merge main~x', 'git merge origin/mainline',
    'git merge main2', 'git merge refs/heads/main-x', 'git merge feature/main', 'git pull origin main2:main', 'git pull origin +main2',
    'git merge origins', 'git merge heads/main2',
  ])('%j is no gated act', (c) => { expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') }); });
});

describe('the quoted-word pre-pass, mh_prep', () => {
  it('a quoted command word of plain characters is the same word to bash, so `"git" push` is held', () => {
    expect(hold('"git" push')).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') });
  });
  it.each(['echo "git push"', 'git log --grep "push"', "echo 'git' push", 'git log "x"'])(
    '%j stays no gated act', (c) => { expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') }); });
  it('a span holding a blank or a separator is left for the strip', () => {
    const r = spawnSync('jq', ['-L', LIB, '-n', '-r', '--arg', 'c', `git merge "a b" 'x;y' "main" 'origin/HEAD'`,
      'include "mail-hold"; $c | mh_unq'], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe(`git merge "a b" 'x;y' main origin/HEAD`);
  });
});

describe('over the cap, the raw read is a superset (F2)', () => {
  const pads: Array<[string, (c: string) => string]> = [
    ['padding after', (c) => `${c}; echo ${'x'.repeat(CAP)}`], ['padding before', (c) => `echo ${'y'.repeat(CAP)}; ${c}`],
    ['after an echo filler', (c) => `echo ${'z'.repeat(CAP)} && ${c}`],
  ];
  const ACTS: Array<[string, string]> = [
    ['git -C $(pwd) push', 'git push'], ['git -C "$(git rev-parse --show-toplevel)" push origin HEAD', 'git push'],
    ['gh -R $(echo o/r) pr merge 42', 'gh pr merge'], ['git -C $(cd x; pwd) push', 'git push'],
    ['git merge -m "sync; ok" origin/main', 'git merge'], ['git -c "a;b" push', 'git push'],
    // Fix round 2, F2: a `$(…)` with its own inner quotes inside a "…" span, and a $'…' span, keep their segment whole.
    ['git merge -m "$(echo "a;b")" main', 'git merge'], ['git -C "$(dirname "a;b")" push', 'git push'], ["git -C $'a;b' push", 'git push'],
    ['git merge --no-ff -m "$(cat <<\'EOF\'\nMerge the 6" display work\nEOF\n)" origin/main', 'git merge'],
  ];
  for (const [layout, pad] of pads) {
    it.each(ACTS)(`%j (${layout}) is held as %s`, (c, act) => {
      const v = hold(pad(c));
      expect(v.outcome).toBe('deny');
      expect(v.text.startsWith(A(act, '42', 'its coordinator') + ' This command is ')).toBe(true);
    });
  }
  it('CONTROL: segments still end at a separator outside a quote: padded `git status; echo push` holds nothing', () => {
    expect(hold(`git status; echo push; echo ${'x'.repeat(CAP)}`)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
  });
  it('an unfinished strip reads the union: a push the stripped read finds and the raw read misses is held', () => {
    expect(hold(`git -c 'a;b' push; echo "unterminated`)).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') });
  });
});

describe('fail closed', () => {
  it('an unterminated quote followed by `git push` is held: the strip keeps it raw, and the module reads it word by word', () => {
    expect(hold('echo "unterminated git push')).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') });
  });
  it('a strip that gave no answer (jq failed) is read word by word', () => {
    expect(hold('git push', { strip: '' })).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') });
  });
  it('an over-cap command whose raw text holds `git push` is held, with the advice to split it or pass its text as a file (P6)', () => {
    const c = `echo ${'x'.repeat(CAP)} && git push`;
    const v = hold(c);
    expect(v.outcome).toBe('deny');
    expect(v.text).toBe(A('git push', '42', 'its coordinator')
      + ` This command is ${Buffer.byteLength(c)} bytes, over the hook's ${CAP}-byte parse cap, so the hold reads its raw text and cannot tell prose from a command: split it into commands of at most ${CAP} bytes, or write the text with the Write tool and pass it as a file (\`--body-file <file>\` for \`gh pr create\`, \`ccrc-api mail send --json <file>\` for a mail), which keeps the command short.`);
  });
});

describe('not gated: E\'s line, and no deny', () => {
  it.each([
    'gh pr create --body "notes; git push later"', 'echo "git push"', 'cat <<EOF\ngit push\nEOF', 'git merge feature-x',
    'git pull origin feature-x', 'ls', 'git status', 'git log --oneline main',
  ])('%j', (c) => { expect(hold(c)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') }); });
  it('an over-cap command that holds no gated act', () => {
    expect(hold(`echo ${'y'.repeat(CAP + 10)}`)).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
  });
  it('a call the hook did not strip (`ran` unset) holds no act', () => {
    expect(hold('git push', { ran: '', strip: '' })).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
  });
});

describe('the texts, byte for byte, and the sender map', () => {
  it('the sender map: `coordinator` renders "its coordinator", `overlord` renders "the Overlord"', () => {
    expect(hold('ls', { pairs: 'coordinator.5' }).text).toBe(E('5', 'its coordinator'));
    expect(hold('ls', { pairs: 'overlord.9' }).text).toBe(E('9', 'the Overlord'));
    expect(hold('git push', { pairs: 'overlord.9' }).text).toBe(A('git push', '9', 'the Overlord'));
  });
  it('any other role word renders no text', () => {
    expect(hold('ls', { pairs: 'peer.5' })).toMatchObject({ outcome: '', text: '' });
    expect(hold('git push', { pairs: 'peer.5' })).toMatchObject({ outcome: '', text: '' });
  });
  it('the first pair names the delivery and the sender', () => {
    expect(hold('ls', { pairs: 'overlord.3,coordinator.4' }).text).toBe(E('3', 'the Overlord'));
  });
  it('a joined subagent gets the subagent text on a gated act, and nothing on an ungated call', () => {
    expect(hold('git push', { thread: 'sub' })).toMatchObject({ outcome: 'deny', text: ASUB('git push') });
    expect(hold('ls', { thread: 'sub' })).toMatchObject({ outcome: '', text: '' });
  });
});

describe('the arming words (P7)', () => {
  it('neither armed: nothing is refused or said, and both arms log `would`', () => {
    const v = hold('git push', { armed: '' });
    expect(v).toMatchObject({ outcome: '', text: '' });
    expect(v.log).toBe('1795000000\tlane-a-project-a\trefuse\twould\t42\tgit-push\n1795000000\tlane-a-project-a\tnotice\twould\t42\t-\n');
  });
  it('E armed alone: the line is said on every main-thread call, a gated one included, and A logs `would`', () => {
    expect(hold('ls', { armed: 'notice' })).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
    const v = hold('git push', { armed: 'notice' });
    expect(v).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
    expect(v.log).toContain('\trefuse\twould\t42\tgit-push\n');
  });
  it('A armed alone: a gated act is refused, an ungated call logs E `would` and says nothing', () => {
    expect(hold('git push', { armed: ',refuse' })).toMatchObject({ outcome: 'deny', text: A('git push', '42', 'its coordinator') });
    const v = hold('ls', { armed: ',refuse' });
    expect(v).toMatchObject({ outcome: '', text: '' });
    expect(v.log).toBe('1795000000\tlane-a-project-a\tnotice\twould\t42\t-\n');
  });
});

describe('a lease that does not hold', () => {
  it.each(['lapsed', 'far'])('%s: a gated act passes and is logged with that outcome; an ungated call logs nothing', (state) => {
    const v = hold('git push', { state });
    expect(v).toMatchObject({ outcome: '', text: '' });
    expect(v.log).toBe(`1795000000\tlane-a-project-a\trefuse\t${state}\t42\tgit-push\n`);
    expect(hold('ls', { state })).toEqual({ outcome: '', text: '', log: '', seen: '' });
  });
});

describe('the log decision (P8, N2)', () => {
  const PAIRS = 'coordinator.42,overlord.7';
  it('a new key gives one line and the new seen text; a key already seen gives none', () => {
    const v = hold('ls', { armed: '' });
    expect(v.log).toBe('1795000000\tlane-a-project-a\tnotice\twould\t42\t-\n');
    expect(v.seen).toBe(`${PAIRS}\nnotice.42.-.would\n`);
    expect(hold('ls', { armed: '', seen: v.seen })).toEqual({ outcome: '', text: '', log: '', seen: '' });
  });
  it('a seen file kept for other pairs is started again', () => {
    const v = hold('ls', { armed: '', seen: 'coordinator.41\nnotice.41.-.would\n' });
    expect(v.seen).toBe(`${PAIRS}\nnotice.42.-.would\n`);
  });
  it('the outcome is in the key: `lapsed` after `refuse would` is logged once', () => {
    const first = hold('git push', { armed: '' });
    const lapsed = hold('git push', { armed: '', state: 'lapsed', seen: first.seen });
    expect(lapsed.log).toBe('1795000000\tlane-a-project-a\trefuse\tlapsed\t42\tgit-push\n');
    expect(hold('git push', { armed: '', state: 'lapsed', seen: lapsed.seen }).log).toBe('');
  });
  it('the outcome is in the key: `notice did` after `notice would` is logged once', () => {
    const would = hold('ls', { armed: '' });
    const did = hold('ls', { armed: 'notice', seen: would.seen });
    expect(did.log).toBe('1795000000\tlane-a-project-a\tnotice\tdid\t42\t-\n');
    expect(did.seen).toBe(`${PAIRS}\nnotice.42.-.would\nnotice.42.-.did\n`);
    expect(hold('ls', { armed: 'notice', seen: did.seen }).log).toBe('');
  });
  it('a line stays under 320 bytes for a session id of 128 characters', () => {
    const r = spawnSync('jq', ['-L', LIB, '-j', '--arg', 'strip', '', '--arg', 'ran', '', '--arg', 'cap', String(CAP), '--arg', 'thread', '',
      '--arg', 'pairs', 'overlord.9999999999', '--arg', 'state', 'live', '--arg', 'armed', '', '--arg', 'sid', 'a'.repeat(128),
      '--arg', 'now', '99999999999', '--arg', 'seen', '', 'include "mail-hold"; mail_hold($ARGS.named)'], { input: '{"tool_name":"Read"}', encoding: 'utf8' });
    const line = r.stdout.split('\u001f')[2] ?? '';
    expect(line).toContain('a'.repeat(128));
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(320);
  });
});

// The subagent's ack refusal (plan Task 6.1; spec §3.5, D10). The hook passes `ack` "1" only for a joined subagent's Bash
// call whose command holds `mail` and `ack` or `inbox` (its builtin prefilter), with or without a marker; the module
// reads the raw command text after `mh_unq`, never the stripped one, and refuses `mail ack` and every `mail inbox`
// that would ack. Each log line names what the command named (review 2826 F7, ruled): `mail ack <n>` its `<n>`, a bare
// inbox every delivery the marker holds, or `-`.
const ACK = 'ccrc: a subagent does not ack ccrc mail. Report to your parent instead.';
describe('the subagent\'s ack refusal (Task 6.1)', () => {
  /** A joined subagent's call with no marker standing, unless `o` says otherwise. */
  const sub = (command: string, o: Opts = {}): Verdict => hold(command, { thread: 'sub', ack: '1', pairs: '', state: '', ...o });
  const line = (outcome: string, d: string, act: string): string => `1795000000\tlane-a-project-a\tack\t${outcome}\t${d}\t${act}\n`;
  /** [command, act, the delivery an ack names (or '' for an inbox, which names the marker's)]. */
  const REFUSED: Array<[string, string, string]> = [
    ['~/.local/bin/ccrc-api mail ack 7 --json -', 'mail-ack', '7'], ['ccrc-api mail inbox', 'mail-inbox', ''],
    ['ccrc-api mail inbox > f', 'mail-inbox', ''], ['ccrc-api mail inbox >> f', 'mail-inbox', ''], ['ccrc-api mail inbox &> f', 'mail-inbox', ''],
    ['ccrc-api mail inbox >&2', 'mail-inbox', ''], ['ccrc-api mail inbox 2>/dev/null', 'mail-inbox', ''], ['"$API" mail inbox', 'mail-inbox', ''],
    ['$API mail ack 7', 'mail-ack', '7'], ['"${API}" mail inbox', 'mail-inbox', ''], ['/home/u/.local/bin/ccrc-api mail inbox', 'mail-inbox', ''],
    ['"$HOME/.local/bin/ccrc-api" mail inbox', 'mail-inbox', ''], ['x=$(ccrc-api mail inbox)', 'mail-inbox', ''],
    ['echo "x; ccrc-api mail ack"', 'mail-ack', '-'], ['cd x && ~/.local/bin/ccrc-api mail inbox', 'mail-inbox', ''],
    ['ccrc-api mail inbox > /dev/null >&2', 'mail-inbox', ''], ['ccrc-api mail inbox > f | cat', 'mail-inbox', ''],
    ['ccrc-api mail inbox; echo done', 'mail-inbox', ''], ['ccrc-api mail list | cat; ccrc-api mail ack 7', 'mail-ack', '7'],
    // F2: a comment ends the command, and `{fd}>` redirects another descriptor.
    ['ccrc-api mail inbox # read, then | grep it', 'mail-inbox', ''], ['ccrc-api mail inbox  # >/dev/null would hide it', 'mail-inbox', ''],
    ['ccrc-api mail inbox {fd}>/dev/null', 'mail-inbox', ''],
    // F3: a parameter expansion as the command word.
    ['"${CCRC_API:-ccrc-api}" mail ack 5', 'mail-ack', '5'], ['${API:-ccrc-api} mail ack 5', 'mail-ack', '5'],
    // F4: quoting inside the verb words, which bash joins.
    ['ccrc-api mail "ack" 5', 'mail-ack', '5'], ['ccrc-api mail a"ck" 5', 'mail-ack', '5'], ['ccrc-api "mail" inbox', 'mail-inbox', ''],
    ["ccrc-api 'mail' ack", 'mail-ack', '-'], ['ccrc-api mail "inbox" > "f"', 'mail-inbox', ''],
    // mail inbox takes no argument: anything after it but a redirection ends the read, fail closed.
    ['ccrc-api mail inbox extra', 'mail-inbox', ''],
  ];
  const PASSED = [
    'ccrc-api mail inbox | cat', 'ccrc-api mail inbox > /dev/null', 'ccrc-api mail list --to lane-a', 'ccrc-api mail fetch 7',
    '"$API" mail inbox | head -5', 'ccrc-api mail inbox 2>&1 | cat', 'ccrc-api mail inbox >/dev/null 2>&1', 'ccrc-api mail inbox &>/dev/null',
    'ccrc-api mail inbox |& cat', 'ccrc-api mail inbox 1> "/dev/null"', 'echo mail inbox', 'ccrc-api mail inboxes', 'grep ack mail.txt',
    'ccrc-api mail ackx 5', 'x=$(ccrc-api mail inbox | cat)',
    // F5: ccrc-api takes the group as its first argument, so an option before `mail` is an unknown verb and acks nothing.
    'ccrc-api --json mail ack 1',
  ];
  it.each(REFUSED)('%j is refused with no marker, as %s', (c, act, d) => {
    const v = sub(c);
    expect(v).toMatchObject({ outcome: 'deny', text: ACK });
    expect(v.log).toBe(line('did', d === '' ? '-' : d, act));
  });
  it.each(REFUSED)('%j is refused under a live marker; an inbox names the marker\'s delivery, an ack its own', (c, act, d) => {
    const v = sub(c, { pairs: 'coordinator.42', state: 'live' });
    expect(v).toMatchObject({ outcome: 'deny', text: ACK });
    expect(v.log).toBe(line('did', d === '' ? '42' : d, act));
  });
  it.each(PASSED)('%j passes, with and without a marker', (c) => {
    expect(sub(c)).toEqual({ outcome: '', text: '', log: '', seen: '' });
    expect(sub(c, { pairs: 'coordinator.42', state: 'live' })).toEqual({ outcome: '', text: '', log: '', seen: '' });
  });
  it('`mail $\'ack\'` is a named residual: ANSI-C quoting is not unquoted', () => {
    expect(sub("ccrc-api mail $'ack' 5")).toEqual({ outcome: '', text: '', log: '', seen: '' });
  });
  it('read on the raw text: the strip empties `"$API"`, and the raw read still finds it (the strip given, as the hook would)', () => {
    const c = '"$API" mail inbox';
    const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: c } });
    expect(sub(c, { ran: '1', strip: strip(payload) })).toMatchObject({ outcome: 'deny', text: ACK });
  });
  it('without the hook\'s `ack` word nothing is refused: the main thread and an unjoined agent_id', () => {
    for (const c of ['ccrc-api mail ack 7', 'ccrc-api mail inbox']) {
      expect(hold(c, { pairs: '', state: '', ran: '' })).toEqual({ outcome: '', text: '', log: '', seen: '' });
      expect(hold(c, { ran: '' })).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
    }
  });
  it('F9: an `ack` word on the main thread refuses nothing, with no marker and under one', () => {
    for (const c of ['ccrc-api mail ack 7', 'ccrc-api mail inbox']) {
      expect(hold(c, { ack: '1', pairs: '', state: '', ran: '' }), c).toEqual({ outcome: '', text: '', log: '', seen: '' });
      expect(hold(c, { ack: '1', ran: '' }), c).toMatchObject({ outcome: 'notice', text: E('42', 'its coordinator') });
    }
  });
  it('shadow: with `refuse` not armed, nothing is refused and `ack would` is logged once a key, `-` for no marker', () => {
    const first = sub('ccrc-api mail ack 7', { armed: 'notice' });
    expect(first).toEqual({ outcome: '', text: '', log: line('would', '7', 'mail-ack'), seen: '\nack.7.mail-ack.would\n' });
    expect(sub('ccrc-api mail ack 7', { armed: 'notice', seen: first.seen })).toEqual({ outcome: '', text: '', log: '', seen: '' });
    const inbox = sub('ccrc-api mail inbox', { armed: '', seen: first.seen });
    expect(inbox.log).toBe(line('would', '-', 'mail-inbox'));
    expect(inbox.seen).toBe('\nack.7.mail-ack.would\nack.-.mail-inbox.would\n');
  });
  it('F7: `mail ack 5` and `mail ack 6` under one marker are two lines, each naming its own delivery', () => {
    const o: Opts = { armed: '', pairs: 'coordinator.42', state: 'live' };
    const five = sub('ccrc-api mail ack 5', o);
    expect(five.log).toBe(line('would', '5', 'mail-ack'));
    const six = sub('ccrc-api mail ack 6', { ...o, seen: five.seen });
    expect(six.log).toBe(line('would', '6', 'mail-ack'));
    expect(six.seen).toBe('coordinator.42\nack.5.mail-ack.would\nack.6.mail-ack.would\n');
    expect(sub('ccrc-api mail ack 5', { ...o, seen: six.seen }).log).toBe('');
  });
  it('F7: a bare inbox that acks logs one line per delivery the marker holds', () => {
    const v = sub('ccrc-api mail inbox', { armed: '', pairs: 'coordinator.42,overlord.7,coordinator.50', state: 'live' });
    expect(v.log).toBe(line('would', '42', 'mail-inbox') + line('would', '7', 'mail-inbox') + line('would', '50', 'mail-inbox'));
  });
  it('F7: every refused act in one command is logged, not only the first, and a repeated one once', () => {
    const v = sub('ccrc-api mail ack 5; ccrc-api mail inbox; ccrc-api mail ack 5', { pairs: 'coordinator.42', state: 'live' });
    expect(v).toMatchObject({ outcome: 'deny', text: ACK });
    expect(v.log).toBe(line('did', '5', 'mail-ack') + line('did', '42', 'mail-inbox'));
  });
  it('a gated act\'s subagent refusal wins over the ack refusal, and both are logged', () => {
    const v = sub('git push && ccrc-api mail ack 7', { pairs: 'coordinator.42', state: 'live', ran: '1' });
    expect(v).toMatchObject({ outcome: 'deny', text: ASUB('git push') });
    expect(v.log).toBe('1795000000\tlane-a-project-a\trefuse\tdid\t42\tgit-push\n' + line('did', '7', 'mail-ack'));
  });
  it('F1: the ack read is linear, so a 20 KB command of repeated `ccrc-api mail inbox | cat;` finishes within 500 ms', () => {
    const unit = 'ccrc-api mail inbox | cat; ';
    const c = unit.repeat(Math.ceil(20_480 / unit.length)).slice(0, 20_480);
    const t0 = performance.now();
    const v = sub(c, { strip: null, ran: '' });
    const ms = performance.now() - t0;
    expect(v).toEqual({ outcome: '', text: '', log: '', seen: '' });
    expect(ms, `the module took ${Math.round(ms)} ms`).toBeLessThan(500);
  });
});
