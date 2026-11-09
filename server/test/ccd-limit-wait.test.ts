// `ccd limit-wait <id>`: the operator's "Wait until reset" choice (D-8123, limit-swap-autofix Task 10; operator ruling 4).
//
// The fleet limit watchdog (Task 9) writes `$REG/<id>.limitwait` when no account has measured room:
// `state=open since=<epoch> reset=<epoch|-> account=<wrapper> sign=<sign>`. The Waiting on you row (Task 11) carries a
// "Wait until reset" control, and this verb is the one door behind it: it appends ` choice=wait at=<now>` to an OPEN
// record and refuses any other state with `not-waiting`. A landing swap (`cmd_swap`'s success tail) or a pass with no
// sign closes the record, so a choice made after either is refused rather than recorded against nothing.
//
// Nothing here sends a key: the verb reads and appends one registry line. FIXTURE HOME ONLY (`makeCcdHarness`), the
// clock is ccd's own seam (`FAKE_NOW`), neutral ids only (public repository).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-wait-'); });
afterEach(() => { h.cleanup(); });
// Registered after the cleanup, so it runs first: the pin every ccd test file in this plan ends with.
afterEach(() => { expect(h.calls().filter((l) => /send-keys|paste-buffer/.test(l)), 'limit-wait sent a key').toEqual([]); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000aa';
const T0 = 1_900_000_000;
const OPEN = `state=open since=${T0 - 600} reset=${T0 + 3600} account=claude sign=menu`;

const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const record = (): string | null => h.reg(ID, 'limitwait');
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const NOW = `date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };`;
/** `ccd limit-wait` as the dispatcher runs it: a subshell, so a `die` ends only it; prints its words and `rc=`. */
const wait = (args: string, now = T0): string =>
  h.sh(`${NOW} ( cmd_limit_wait ${args} ) 2>&1; echo "rc=$?"`, { FAKE_NOW: String(now) });

const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
};
const put = (line: string): void => { fs.writeFileSync(regFile(`${ID}.limitwait`), line + '\n'); };

describe('ccd limit-wait records the operator\'s choice on an open record', () => {
  it('an open record gains ` choice=wait at=<now>` and the verb exits 0', () => {
    seed(); put(OPEN);
    const out = wait(ID);
    expect(out).toMatch(/rc=0$/);
    expect(record()).toBe(`${OPEN} choice=wait at=${T0}`);
  });

  it('says which session now waits, once, on stdout', () => {
    seed(); put(OPEN);
    expect(wait(ID)).toMatch(new RegExp(`^limit-wait: ${ID} waits until the limit resets`));
  });

  it('is idempotent: a second tap keeps the first choice and its time', () => {
    seed(); put(OPEN);
    wait(ID, T0);
    const out = wait(ID, T0 + 90);
    expect(out).toMatch(/rc=0$/);
    expect(record()).toBe(`${OPEN} choice=wait at=${T0}`);
  });

  it('logs the choice in swap.log, once', () => {
    seed(); put(OPEN);
    wait(ID, T0); wait(ID, T0 + 5);
    expect(swapLog().split('\n').filter((l) => / limit-wait /.test(l))).toEqual([
      expect.stringMatching(new RegExp(`limit-wait ${ID}: choice=wait account=claude sign=menu$`))]);
  });
});

describe('ccd limit-wait refuses every other state with `not-waiting`', () => {
  it('a closed record is refused and left as it was', () => {
    seed();
    const closed = `${OPEN.replace('state=open', 'state=closed')} end=swap until=${T0 - 5}`;
    put(closed);
    const out = wait(ID);
    expect(out).toMatch(/not-waiting/);
    expect(out).toMatch(/rc=[1-9]/);
    expect(record()).toBe(closed);
  });

  it('no record at all is refused, and none is created', () => {
    seed();
    expect(wait(ID)).toMatch(/not-waiting[\s\S]*rc=[1-9]/);
    expect(record()).toBeNull();
  });

  it('a malformed line is refused and never evaluated', () => {
    seed(); put('state=open since=$(touch /tmp/never) reset=-');
    const out = wait(ID);
    expect(out).toMatch(/not-waiting[\s\S]*rc=[1-9]/);
    expect(record()).toBe('state=open since=$(touch /tmp/never) reset=-');
  });

  it('a record whose state is not exactly `open` is refused', () => {
    seed(); put(`state=opened since=${T0} reset=- account=claude sign=menu`);
    expect(wait(ID)).toMatch(/not-waiting[\s\S]*rc=[1-9]/);
  });

  it('the refusal word is on stderr-visible output and nothing else is appended', () => {
    seed();
    const out = wait(ID);
    expect(out.split('\n')[0]).toMatch(/^ccd: not-waiting: /);
  });
});

describe('ccd limit-wait is exact about its argument', () => {
  it('no argument and two arguments are usage errors, and touch nothing', () => {
    seed(); put(OPEN);
    expect(wait('')).toMatch(/usage: ccd limit-wait <id>[\s\S]*rc=[1-9]/);
    expect(wait(`${ID} extra`)).toMatch(/usage: ccd limit-wait <id>[\s\S]*rc=[1-9]/);
    expect(record()).toBe(OPEN);
  });

  it.each(['../etc/passwd', 'a b', '-x', 'lane-a;touch x', 'a/b'])('the id %j is refused before any path is built', (bad) => {
    seed(); put(OPEN);
    expect(wait(JSON.stringify(bad))).toMatch(/rc=[1-9]/);
    expect(record()).toBe(OPEN);
  });

  it('an id with no registry row is not-waiting', () => {
    expect(wait('lane-a-project-z')).toMatch(/not-waiting[\s\S]*rc=[1-9]/);
  });
});

describe('the record closes when the session lands or the sign clears', () => {
  const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
    + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "${1:-}" in has-session) echo "can\'t find session: x" >&2; return 1 ;; esac; }; sleep() { :; };';
  const field = (rec: string | null, k: string): string | null => {
    const m = new RegExp(`(?:^| )${k}=([^ ]*)`).exec(rec ?? '');
    return m === null ? null : m[1]!;
  };

  it('cmd_swap\'s landing closes an open record `swap`, choice and all', () => {
    seed(); put(`${OPEN} choice=wait at=${T0 - 60}`);
    const mdir = fs.realpathSync(path.join(h.home, 'projects', 'project-a')).replace(/[/._]/g, '-');
    const dir = path.join(h.home, '.claude', 'projects', mdir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(field(record(), 'state')).toBe('closed');
    expect(field(record(), 'end')).toBe('swap');
    expect(field(record(), 'until')).toMatch(/^\d+$/);
    expect(field(record(), 'choice')).toBe('wait');   // what the operator chose stays in the record
  });

  it('a REFUSED swap leaves it open: nothing moved', () => {
    seed(); put(OPEN);
    h.sh(`${SWAP} cmd_swap ${ID} claude-d >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(field(record(), 'state')).toBe('open');
  });

  it('after the landing a late tap is refused: not-waiting', () => {
    seed(); put(OPEN);
    h.sh(`_limitwait_close ${ID} swap`);
    expect(wait(ID)).toMatch(/not-waiting[\s\S]*rc=[1-9]/);
  });

  it('`_watchdog_clear` (a pass with no sign) closes it `clear`', () => {
    seed(); put(OPEN);
    h.sh(`_watchdog_clear ${ID}`);
    expect(field(record(), 'state')).toBe('closed');
    expect(field(record(), 'end')).toBe('clear');
  });
});

describe('the verb is wired where every ccd verb is', () => {
  it('ccd caps lists it', () => {
    expect(h.sh('cmd_caps')).toMatch(/^limit-wait$/m);
  });

  it('the dispatcher reaches cmd_limit_wait: ccd run as a program answers its usage line', () => {
    const out = h.sh('bash "$CCD_PROGRAM" limit-wait 2>&1; echo "rc=$?"', { CCD_PROGRAM: CCD });
    expect(out).toMatch(/usage: ccd limit-wait <id>[\s\S]*rc=[1-9]/);
  });
});
