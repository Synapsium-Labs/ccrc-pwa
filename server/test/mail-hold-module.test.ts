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

interface Verdict { outcome: string; text: string; log: string; seen: string }
interface Opts { thread?: string; pairs?: string; state?: string; armed?: string; seen?: string; ran?: string; strip?: string | null }

/** The strip's answer for one command, as the hook's `$( )` capture holds it (trailing newlines cut). */
const strip = (payload: string): string => {
  const r = spawnSync('jq', ['-r', '--arg', 'q', "'", '--argjson', 'cap', String(CAP), '--arg', 'allow', ALLOW, STRIP],
    { input: payload, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.replace(/\n+$/, '');
};

/** One module call over a Bash payload holding `command`; both arms armed, a live hold on delivery 42, unless `o` says otherwise. */
const hold = (command: string, o: Opts = {}): Verdict => {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  const args: Record<string, string> = {
    strip: o.strip === undefined ? strip(payload) : (o.strip ?? ''), ran: o.ran ?? '1', cap: String(CAP),
    thread: o.thread ?? '', pairs: o.pairs ?? 'coordinator.42,overlord.7', state: o.state ?? 'live',
    armed: o.armed ?? 'notice,refuse', sid: 'lane-a-project-a', now: '1795000000', seen: o.seen ?? '',
  };
  const argv = ['-L', LIB, '-j', ...Object.entries(args).flatMap(([k, v]) => ['--arg', k, v]), 'include "mail-hold"; mail_hold($ARGS.named)'];
  const r = spawnSync('jq', argv, { input: payload, encoding: 'utf8' });
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
  it.each([['git merge "origin/main"', 'git merge'], ["git rebase 'main'", 'git rebase']])('%j: the quoted target is read on the raw text', (c, act) => {
    expect(hold(c)).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') });
  });
  it('each sync target, alone (Table 6: one mutant per target)', () => {
    for (const [c, act] of [['git merge main', 'git merge'], ['git merge origin/main', 'git merge'], ['git pull origin main', 'git pull'],
      ['git rebase origin/HEAD', 'git rebase'], ['git pull origin HEAD', 'git pull']] as const) {
      expect(hold(c), c).toMatchObject({ outcome: 'deny', text: A(act, '42', 'its coordinator') });
    }
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
