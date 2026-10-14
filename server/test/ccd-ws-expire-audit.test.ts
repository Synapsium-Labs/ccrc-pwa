// `ws-audit --session <id> --expire` — the token `ws-expire` spends (workspace lifecycle spec 2026-09-24 §5.3), read
// as the server will read it: one JSON document, exit 1 when a probe could not run. Its ladder is `_ws_expire_eval`
// (`ccd-ws-expire-ladder.test.ts` holds it rung by rung); this file holds the document, the exits, the journal and the
// containment. FIXTURE HOME ONLY (`wsExpireFixture.ts`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';
import { eventsOf, refusalsOf } from './lifecycleHelpers.js';
import { childIndex, hookRuns, plantRepoPrograms, plantTmux } from './childReclaimFixture.js';
import {
  EXP_ID, EXP_STUBS, NOW, OLD, WEEK, archiveAt, expireAudit, expireEvalOf, expireToken, expireVerb, holdCwd, makeArchived,
} from './wsExpireFixture.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ws-expire-audit-'); });
afterEach(() => { h.cleanup(); });

const reg = (field: string): string => path.join(h.home, '.cc-sessions', `${EXP_ID}.${field}`);

describe('ws-audit --expire — the token the verb spends', () => {
  it('prints mode, archivedAt and the SAME token the ladder mints', () => {
    makeArchived(h);
    const r = expireAudit(h);
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(['session', 'mode', 'archivedAt', 'expiresAt', 'alive', 'exists', 'reaping', 'sensitive', 'verdict', 'detail', 'token']);
    expect(doc).toMatchObject({ session: EXP_ID, mode: 'expire', archivedAt: OLD, expiresAt: OLD + WEEK, alive: false, exists: true, reaping: null, verdict: 'expirable' });
    expect(doc['token']).toBe(expireEvalOf(h).token);
  }, 60_000);

  it('the audit’s token IS the verb’s consent — end to end', () => {
    const a = makeArchived(h);
    const r = expireVerb(h, expireToken(h));
    expect(JSON.parse(r.stdout)['expired']).toBe(EXP_ID);
    expect(fs.existsSync(a.wt)).toBe(false);
  }, 120_000);

  it('lists what the pin will drop: every secret-shaped path, untracked or ignored', () => {
    const a = makeArchived(h);
    fs.writeFileSync(path.join(a.wt, '.env'), 'KEY=live');
    expect(JSON.parse(expireAudit(h).stdout)['sensitive']).toEqual(['.env']);
  }, 60_000);

  it('a refusal carries no token, and archivedAt is null when no archive could be read', () => {
    makeArchived(h);
    archiveAt(h, NOW - 60);
    const young = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(young['verdict']).toBe('not-expired');
    expect(young['token']).toBeUndefined();
    fs.rmSync(reg('archived'));
    const gone = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(gone['verdict']).toBe('not-archived');
    expect(gone['archivedAt']).toBeNull();
    expect(gone['expiresAt'], 'no archive, no instant').toBeNull();
  }, 60_000);

  // WAVE 3b's THRESHOLD, CARRIED BY THE DOCUMENT (the coordinator's ruling (C)): the server never types the seven
  // days. `expiresAt` is `archivedAt + WS_EXPIRE_AFTER_S`, from the ONE ccd definition, on `expirable` AND on
  // `not-expired` — whose `archivedAt` is now set too, since the stamp WAS read (wave 3's Carried row).
  it('`not-expired` carries the archive it read and the instant it expires', () => {
    makeArchived(h);
    archiveAt(h, NOW - 60);
    const young = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(young['verdict']).toBe('not-expired');
    expect(young['archivedAt']).toBe(NOW - 60);
    expect(young['expiresAt']).toBe(NOW - 60 + WEEK);
  }, 60_000);

  it('`expiresAt` is ccd’s own threshold: raise WS_EXPIRE_AFTER_S and the instant moves with it', () => {
    makeArchived(h);
    const doc = JSON.parse(expireAudit(h, { pre: 'WS_EXPIRE_AFTER_S=1209600;' }).stdout) as Record<string, unknown>;
    expect(doc['verdict'], 'eight days old is young against fourteen').toBe('not-expired');
    expect(doc['expiresAt']).toBe(OLD + 1_209_600);
  }, 60_000);

  it('a refusal PAST the age still carries both — the lane reads when it became due, whatever holds it', () => {
    makeArchived(h);
    fs.writeFileSync(reg('hold'), 'x');
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('held');
    expect(doc).toMatchObject({ archivedAt: OLD, expiresAt: OLD + WEEK });
  }, 60_000);

  it('a probe that could not RUN exits 1 — the document says unmeasured, no token, and nothing is journaled', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('archived'), 'soon\n');
    const r = expireAudit(h);
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('unmeasured');
    expect(doc['token']).toBeUndefined();
    expect(doc['archivedAt'], 'a stamp that is not an epoch is no archive').toBeNull();
    expect(doc['expiresAt'], 'and no instant').toBeNull();
    expect(r.stderr).toContain('ws-audit --expire measured nothing');
    expect(refusalsOf(h.home)).toEqual([]);
    expect(fs.existsSync(a.wt)).toBe(true);
  }, 60_000);

  it('journals a TERMINAL refusal — and a retryable one not at all', () => {
    const a = makeArchived(h);
    fs.writeFileSync(reg('hold'), 'x');
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('held');
    expect(refusalsOf(h.home), 'a retryable word a pass would bury the journal').toEqual([]);
    fs.rmSync(reg('hold'));
    fs.rmSync(path.join(a.main, '.git', 'worktrees', 'quiet-dune'), { recursive: true, force: true });
    expect(JSON.parse(expireAudit(h).stdout)['verdict']).toBe('no-worktree-record');
    expect(refusalsOf(h.home)).toEqual([{ act: 'expire', token: 'no-worktree-record' }]);
    expect(eventsOf(h.home, 'expire')[0]!['verb']).toBe('ws-audit');
  }, 60_000);

  it('answers the RESUME token on an `expire:` breadcrumb, names the phase — and asserts its argv', () => {
    const a = makeArchived(h);
    h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_eval ${EXP_ID} >/dev/null`
      + ` && _ws_reclaim_pin ${EXP_ID} "${a.wt}" "${a.main}" "$REAP_BRANCH" "$EXPIRE_ARCHIVED_AT"`
      + ` && _ws_tombstone ${EXP_ID} '[]' "$(_ws_reclaim_tomb_fields "$EXPIRE_ARCHIVED_AT")" >/dev/null`
      + ` && _reg_set ${EXP_ID} reaping expire:worktree`);
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['resume']).toBe('worktree');
    expect(doc['reaping']).toBe('expire:worktree');
    expect(doc['token']).toBe(h.sh(`${EXP_STUBS} _WS_RCL_ACT=expire; _ws_expire_resume_eval ${EXP_ID} worktree >/dev/null;`
      + ' printf "%s" "$REAP_TOKEN"'));
    for (const extra of ['--defer-expired', '--expire']) {
      const bad = h.run(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID} --expire ${extra}`);
      expect(bad.code, extra).toBe(1);
      expect(bad.stderr).toContain('usage: ccd ws-audit --session <id> [--reclaim [--defer-expired] | --expire | --collect]');
    }
  }, 90_000);

  it('the plain audit never takes the hand-off — no mode, and never the expiry’s verdict', () => {
    makeArchived(h);
    const plain = JSON.parse(h.sh(`${EXP_STUBS} cmd_ws_audit --session ${EXP_ID}`)) as Record<string, unknown>;
    expect(plain['mode'], 'the plain audit carries no mode').toBeUndefined();
    expect(plain['verdict']).toBeTypeOf('string');
    expect(plain['verdict'], 'the plain audit answers ws-reap’s question, never the expiry’s').not.toBe('expirable');
  }, 60_000);
});

// RULING (D) AT THE ENTRY WAVE 3b's LANE READS FIRST: the audit is where the server learns a workspace is expirable,
// so a live archived workspace is refused here too — asked by the binding, with no flavour set by the audit.
describe('the audit refuses a live archived workspace — `live`, no token', () => {
  it('a running unit with no pane', () => {
    makeArchived(h);
    const doc = JSON.parse(expireAudit(h, { pre: '_svc_is_active() { printf active; };' }).stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('live');
    expect(doc['token']).toBeUndefined();
  }, 60_000);

  it('a detached `cc-<id>` pane', () => {
    makeArchived(h);
    plantTmux(h, { sessions: [`cc-${EXP_ID}`] });
    const doc = JSON.parse(expireAudit(h).stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('live');
    expect(doc['alive']).toBe(true);
    expect(doc['token']).toBeUndefined();
  }, 60_000);
});

describe('the audit refuses an archived workspace a process is working in — `in-use`, no token', () => {
  it('a `sleep` with its cwd in the worktree', () => {
    const a = makeArchived(h);
    const sleeper = holdCwd(a.wt);
    try {
      const r = expireAudit(h);
      expect(r.code, 'a retryable refusal is an answer: exit 0').toBe(0);
      const doc = JSON.parse(r.stdout) as Record<string, unknown>;
      expect(doc['verdict'], String(doc['detail'])).toBe('in-use');
      expect(doc['token']).toBeUndefined();
      // WHAT IT IS, NOT ONLY ITS NUMBER (the coordinator's ruling (G)): the lane's operator text names the pid, its
      // command and the path, because the fleet's own tmux server is also a `tmux: server` and a pid alone invites
      // the wrong kill. The document carries them as data; the detail sentence names the command too.
      expect(doc['inUse']).toEqual([{ pid: sleeper.pid, comm: 'sleep', cwd: fs.realpathSync(a.wt) }]);
      expect(String(doc['detail'])).toContain(`process ${sleeper.pid} (sleep) has its working directory at `);
    } finally { sleeper.stop(); }
  }, 60_000);

  it('`inUse` appears only on an `in-use` refusal', () => {
    makeArchived(h);
    expect(JSON.parse(expireAudit(h).stdout)['inUse']).toBeUndefined();
  }, 60_000);

  // THE RECORD IS JSON AT ITS SOURCE (the coordinator's security ruling, binding on wave 3b): the probe's python prints
  // each `inUse` record already `json.dumps`-encoded — the pid an integer, every string as read (surrogateescape) — and
  // the shell keeps it as printed, never splicing a field. A cwd and a command are chosen by whoever owns the process,
  // so a newline, a tab or a quote in them yields ONE record, valid JSON, with the exact bytes — never a second record
  // whose "pid" is text the process chose. A FAKE /proc names the process (`_ws_expire_proc_root`): ccd's own pid is
  // planted by the shell, which alone knows it; pid 4242 by the test, with exact bytes.
  const FAKE_PROC = 'CCD_OS=linux; mkdir -p "$HOME/fp/$$"; ln -sfn "$HOME" "$HOME/fp/$$/cwd";'
    + ' _ws_expire_proc_root() { printf %s "$HOME/fp"; };';
  const plantProcess = (cwd: string, comm: Buffer | null): void => {
    const d = path.join(h.home, 'fp', '4242');
    fs.mkdirSync(d, { recursive: true });
    fs.symlinkSync(cwd, path.join(d, 'cwd'));
    fs.writeFileSync(path.join(d, 'stat'), '4242 (x) S 1 1 1 0\n');
    if (comm !== null) fs.writeFileSync(path.join(d, 'comm'), comm);
  };

  it('a cwd and a command carrying a newline, a tab and a quote are ONE record — valid JSON, the exact bytes', () => {
    const a = makeArchived(h);
    const dir = path.join(fs.realpathSync(a.wt), 'a\nb\tc"d');
    fs.mkdirSync(dir);
    plantProcess(dir, Buffer.from('x\ty\n"z\n'));   // the kernel ends `comm` with one newline of its own
    const r = expireAudit(h, { pre: FAKE_PROC });
    expect(r.code, r.stderr).toBe(0);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict'], String(doc['detail'])).toBe('in-use');
    expect(doc['inUse']).toEqual([{ pid: 4242, comm: 'x\ty\n"z', cwd: dir }]);
    // The detail sentence is one line: a control character is written there as its escape.
    expect(String(doc['detail'])).toContain('process 4242 (x\\ty\\n"z) has its working directory at ');
  }, 60_000);

  it('a command that is not UTF-8 keeps its bytes (surrogateescape) — never a replacement character', () => {
    const a = makeArchived(h);
    const dir = fs.realpathSync(a.wt);
    plantProcess(dir, Buffer.from([0x71, 0xff, 0x71, 0x0a]));
    const doc = JSON.parse(expireAudit(h, { pre: FAKE_PROC }).stdout) as Record<string, unknown>;
    expect(doc['inUse']).toEqual([{ pid: 4242, comm: 'q\udcffq', cwd: dir }]);
  }, 60_000);

  it('a command the box could not read is "" — the record keeps its cwd, and the sentence names the path', () => {
    const a = makeArchived(h);
    const dir = fs.realpathSync(a.wt);
    plantProcess(dir, null);
    const doc = JSON.parse(expireAudit(h, { pre: FAKE_PROC }).stdout) as Record<string, unknown>;
    expect(doc['inUse']).toEqual([{ pid: 4242, comm: '', cwd: dir }]);
    expect(String(doc['detail'])).toContain(`process 4242 has its working directory at ${dir} — `);
  }, 60_000);

  it('and an unlistable /proc is the audit’s `unmeasured`: exit 1, no token', () => {
    makeArchived(h);
    // A Linux scenario (a fake /proc root), forced as one so a macOS host does not take the lsof arm instead.
    const r = expireAudit(h, { pre: 'CCD_OS=linux; _ws_expire_proc_root() { printf %s "$HOME/no-such-proc"; };' });
    expect(r.code).toBe(1);
    const doc = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(doc['verdict']).toBe('unmeasured');
    expect(doc['token']).toBeUndefined();
  }, 60_000);
});

describe('the audit reads the archived tree CONTAINED — no hook, no fsmonitor, no index rewrite', () => {
  it('runs none of the repository’s programs and leaves the stale index byte-identical', () => {
    const a = makeArchived(h);
    plantRepoPrograms(h, a);
    const before = childIndex(h, a);
    expect(expireAudit(h).code).toBe(0);
    expect(hookRuns(h)).toEqual([]);
    expect(childIndex(h, a).bytes).toBe(before.bytes);
    // The CONTROL: an uncontained status of the same tree runs the hook and rewrites the index.
    h.git(a.wt, 'status');
    expect(hookRuns(h).length).toBeGreaterThan(0);
  }, 90_000);
});
